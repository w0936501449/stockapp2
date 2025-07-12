const express = require("express");
const path = require("path");
const app = express();
const axios = require("axios");

// Middleware
app.use(express.json());

// In-memory data store (replace with db for production)
let portfolio = [];

// Helper: Fetch latest close price & name from TWSE open API (monthly dataset)
async function fetchTwseQuote(code) {
  try {
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(
      today.getMonth() + 1
    ).padStart(2, "0")}01`;
    const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${dateStr}&stockNo=${code}`;
    const resp = await axios.get(url);
    const body = resp.data;
    if (body.stat !== "OK") throw new Error(body.stat || "TWSE API error");
    const rows = body.data;
    if (!rows || rows.length === 0) throw new Error("No data");
    const lastRow = rows[rows.length - 1];
    const closePriceStr = lastRow[6];
    const price = parseFloat(closePriceStr.replace(/,/g, ""));
    // Extract name from title: e.g., "113年07月 2330 台積電 各日成交資訊"
    let name = null;
    if (body.title) {
      const match = body.title.match(
        /\d+ \d+ (\\d{4})?\s*([0-9A-Za-z]+)\s*(.+?)\s/
      );
    }
    // simpler: after code there is name within the title; split by code
    if (body.title) {
      const parts = body.title.split(code);
      if (parts.length > 1) {
        name = parts[1].trim().split(" ")[0];
      }
    }
    return { price, name };
  } catch (err) {
    console.error("fetchTwseQuote error", code, err.message);
    console.error(err);
    return { price: null, name: null };
  }
}

// Helper to update current prices for stocks in portfolio
async function refreshPrices() {
  if (portfolio.length === 0) return;
  const promises = portfolio.map((s) => fetchTwseQuote(s.code));
  const results = await Promise.all(promises);
  results.forEach((res, idx) => {
    const stock = portfolio[idx];
    stock.currentPrice = res.price;
    if (!stock.name && res.name) stock.name = res.name;
  });
}

// Manual refresh endpoint
app.post("/api/refresh", async (req, res) => {
  await refreshPrices();
  res.json({ success: true, portfolio });
});

// Routes ------------------------------------------------------
// Get all stocks in portfolio
app.get("/api/stocks", async (req, res) => {
  await refreshPrices();
  res.json(portfolio);
});

// Add new stock
app.post("/api/stocks", async (req, res) => {
  const { code, shares, buyPrice } = req.body;
  if (!code || !shares) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  let finalBuyPrice = buyPrice;
  let fetchedName = null;
  if (finalBuyPrice === undefined || finalBuyPrice === null) {
    try {
      const symbol = code.includes(".") ? code : `${code}.TW`;
      const { price, name } = await fetchTwseQuote(code);
      finalBuyPrice = price;
      fetchedName = name;
    } catch (err) {
      console.error("Failed to fetch price for", code, err);
      return res
        .status(400)
        .json({ error: "無法取得股票現價，請手動輸入買入價格" });
    }
  }

  // 新增日期
  const addDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // 檢查是否已有該股票
  const existing = portfolio.find((s) => s.code === code);
  if (existing) {
    // 已有該股票，新增一筆購入記錄
    existing.purchases.push({
      date: addDate,
      shares: Number(shares),
      price: Number(finalBuyPrice),
    });
    // 更新總股數與平均價格
    const totalShares = existing.purchases.reduce(
      (sum, p) => sum + p.shares,
      0
    );
    const totalCost = existing.purchases.reduce(
      (sum, p) => sum + p.shares * p.price,
      0
    );
    existing.totalShares = totalShares;
    existing.avgPrice = totalCost / totalShares;
    if (!existing.name && fetchedName) {
      existing.name = fetchedName;
    }
  } else {
    // 新增股票
    portfolio.push({
      code,
      name: fetchedName,
      purchases: [
        {
          date: addDate,
          shares: Number(shares),
          price: Number(finalBuyPrice),
        },
      ],
      totalShares: Number(shares),
      avgPrice: Number(finalBuyPrice),
      currentPrice: null,
    });
  }

  // Update current prices before responding
  await refreshPrices();

  res.json({ success: true, portfolio });
});

// Delete stock by code
app.delete("/api/stocks/:code", async (req, res) => {
  const { code } = req.params;
  const originalLen = portfolio.length;
  portfolio = portfolio.filter((s) => s.code !== code);

  if (portfolio.length === originalLen) {
    return res.status(404).json({ error: "Stock not found" });
  }

  await refreshPrices();
  res.json({ success: true, portfolio });
});

// Reset portfolio
app.post("/api/reset", (_, res) => {
  portfolio = [];
  res.json({ success: true });
});

// 取得股票基本資料與財報（串接FinMind API）
app.get("/api/stock/:code/basic", async (req, res) => {
  const { code } = req.params;
  try {
    const token =
      "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJkYXRlIjoiMjAyNS0wNy0xMSAwMDozMjo1MSIsInVzZXJfaWQiOiJ3NTkzNzIyNyIsImlwIjoiMjAzLjc0LjE1Ni4yMTcifQ.0LbwLm9N5oWx50ZzksTY1ZgEWwEEtm-Jd1AWLDEZek8";

    // 取得公司基本資料
    const basicUrl = `https://api.finmindtrade.com/api/v4/data?token=${token}&dataset=TaiwanStockInfo`;
    const basicResp = await axios.get(basicUrl);
    const basicList = basicResp.data.data;
    const basic = basicList.find((item) => item.stock_id === code);

    // 取得最新財報資料
    const financialUrl = `https://api.finmindtrade.com/api/v4/data?token=${token}&dataset=TaiwanStockFinancialStatements&data_id=${code}&start_date=2023-01-01`;
    const financialResp = await axios.get(financialUrl);
    const financialList = financialResp.data.data;

    // 取最新一筆財報
    const latest =
      financialList.length > 0 ? financialList[financialList.length - 1] : null;

    if (!basic) throw new Error("查無公司基本資料");

    // 組合回傳資料
    const result = {
      公司代號: code,
      公司名稱: basic.stock_name || "-",
      產業別: basic.industry_category || "-",
      出表日期: latest ? latest.date : "-",
      年度: latest ? latest.date.split("-")[0] : "-",
      季別: latest ? Math.ceil(parseInt(latest.date.split("-")[1]) / 3) : "-",
      "基本每股盈餘(元)": latest ? latest.EPS : "-",
      普通股每股面額: basic.par_value || "-",
      營業收入: latest ? latest.Revenue : "-",
      營業利益: latest ? latest.Operating_Income : "-",
      營業外收入及支出: latest ? latest.Non_Operating_Income : "-",
      稅後淨利: latest ? latest.Net_Income : "-",
    };

    res.json(result);
  } catch (err) {
    console.error("FinMind API error:", err);
    res.status(500).json({ error: "取得公司財報失敗" });
  }
});

// Serve static front-end
app.use(express.static(path.join(__dirname)));

// Serve specific static files
app.get("/style.css", (req, res) => {
  res.sendFile(path.join(__dirname, "style.css"));
});

app.get("/main.js", (req, res) => {
  res.sendFile(path.join(__dirname, "main.js"));
});

// Fallback to index.html for client-side routing (if any)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Start server ------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
