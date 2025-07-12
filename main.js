const summaryEls = {
  count: document.getElementById("sum-count"),
  invest: document.getElementById("sum-invest"),
  market: document.getElementById("sum-market"),
  profit: document.getElementById("sum-profit"),
};

const inputCode = document.getElementById("input-code");
const inputShares = document.getElementById("input-shares");
const inputPrice = document.getElementById("input-price");
const btnAdd = document.getElementById("btn-add");
const btnRefresh = document.getElementById("btn-refresh");
const btnReset = document.getElementById("btn-reset");
const tableBody = document.getElementById("table-body");

const LS_KEY = "tw_stock_portfolio";
let portfolio = JSON.parse(localStorage.getItem(LS_KEY) || "[]");

// Utility: format money
const fmt = (n) =>
  `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// Fetch price & name from TWSE monthly API (last close)
async function fetchQuote(code) {
  try {
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(
      today.getMonth() + 1
    ).padStart(2, "0")}01`;
    const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${dateStr}&stockNo=${code}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.stat !== "OK") throw new Error(data.stat || "API error");
    const rows = data.data;
    if (!rows || rows.length === 0) throw new Error("No data");
    const lastRow = rows[rows.length - 1];
    const price = parseFloat(lastRow[6].replace(/,/g, ""));
    let name = "-";
    if (data.title) {
      const parts = data.title.split(code);
      if (parts.length > 1) name = parts[1].trim().split(" ")[0];
    }
    return { price, name };
  } catch (err) {
    console.error("fetchQuote", code, err);
    return { price: null, name: null };
  }
}

function save() {
  localStorage.setItem(LS_KEY, JSON.stringify(portfolio));
}

function calcAndRender() {
  // Summary
  const totalInvest = portfolio.reduce(
    (s, p) => s + p.totalShares * p.avgPrice,
    0
  );
  const totalMarket = portfolio.reduce(
    (s, p) => s + (p.currentPrice ?? p.avgPrice) * p.totalShares,
    0
  );
  const profit = totalMarket - totalInvest;

  summaryEls.count.textContent = portfolio.length;
  summaryEls.invest.textContent = fmt(totalInvest);
  summaryEls.market.textContent = fmt(totalMarket);
  summaryEls.profit.textContent = fmt(profit);

  // Table
  tableBody.innerHTML = "";
  portfolio.forEach((p) => {
    // 顯示各筆購入記錄
    p.purchases.forEach((purchase, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${p.code}</td>
        <td><span class="stock-name clickable" data-code="${p.code}">${
        p.name || "-"
      }</span></td>
        <td>${purchase.date}</td>
        <td>${purchase.shares.toLocaleString()}</td>
        <td>${fmt(purchase.price)}</td>
        <td>${p.currentPrice != null ? fmt(p.currentPrice) : "載入中"}</td>
        <td>${fmt(purchase.shares * purchase.price)}</td>
        <td>${
          p.currentPrice != null ? fmt(purchase.shares * p.currentPrice) : "-"
        }</td>
        <td class="${
          p.currentPrice != null
            ? p.currentPrice - purchase.price >= 0
              ? "profit"
              : "loss"
            : ""
        }">
          ${
            p.currentPrice != null
              ? fmt((p.currentPrice - purchase.price) * purchase.shares)
              : "-"
          }
        </td>
        <td><button class="danger" data-action="remove" data-code="${
          p.code
        }" data-index="${idx}">移除</button></td>
      `;
      tableBody.appendChild(tr);
    });

    // 顯示總計行
    const totalTr = document.createElement("tr");
    totalTr.className = "total-row";
    totalTr.innerHTML = `
      <td><strong>${p.code}</strong></td>
      <td><strong>${p.name || "-"} (總計)</strong></td>
      <td>-</td>
      <td><strong>${p.totalShares.toLocaleString()}</strong></td>
      <td><strong>${fmt(p.avgPrice)}</strong></td>
      <td>${p.currentPrice != null ? fmt(p.currentPrice) : "載入中"}</td>
      <td><strong>${fmt(p.totalShares * p.avgPrice)}</strong></td>
      <td>${
        p.currentPrice != null ? fmt(p.totalShares * p.currentPrice) : "-"
      }</td>
      <td class="${
        p.currentPrice != null
          ? p.currentPrice - p.avgPrice >= 0
            ? "profit"
            : "loss"
          : ""
      }">
        ${
          p.currentPrice != null
            ? fmt((p.currentPrice - p.avgPrice) * p.totalShares)
            : "-"
        }
      </td>
      <td>-</td>
    `;
    tableBody.appendChild(totalTr);
  });
}

async function refreshPricesForAll() {
  if (portfolio.length === 0) return;
  await Promise.all(
    portfolio.map(async (p) => {
      const { price, name } = await fetchQuote(p.code);
      p.currentPrice = price;
      if (!p.name && name) p.name = name;
    })
  );
  save();
  calcAndRender();
}

btnAdd.addEventListener("click", async () => {
  const code = inputCode.value.trim();
  const shares = Number(inputShares.value);
  const priceVal = inputPrice.value.trim();
  if (!code || !shares || shares <= 0) {
    alert("請輸入正確的股票代碼與股數");
    return;
  }
  let buyPrice = priceVal ? Number(priceVal) : null;
  let name = null;
  if (buyPrice == null) {
    const quote = await fetchQuote(code);
    buyPrice = quote.price;
    name = quote.name;
  }

  // 新增日期
  const addDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // 檢查是否已有該股票
  const existing = portfolio.find((p) => p.code === code);
  if (existing) {
    // 已有該股票，新增一筆購入記錄
    existing.purchases.push({
      date: addDate,
      shares: Number(shares),
      price: Number(buyPrice),
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
    if (!existing.name && name) existing.name = name;
  } else {
    // 新增股票
    portfolio.push({
      code,
      name,
      purchases: [
        {
          date: addDate,
          shares: Number(shares),
          price: Number(buyPrice),
        },
      ],
      totalShares: Number(shares),
      avgPrice: Number(buyPrice),
      currentPrice: null,
    });
  }

  save();
  await refreshPricesForAll();
  // 清空輸入
  inputCode.value = "";
  inputPrice.value = "";
});

// 彈窗顯示與關閉邏輯
const stockModal = document.getElementById("stock-modal");
const modalBody = document.getElementById("modal-body");
const modalClose = document.getElementById("modal-close");
modalClose.addEventListener("click", () => {
  stockModal.style.display = "none";
});
window.addEventListener("click", (e) => {
  if (e.target === stockModal) stockModal.style.display = "none";
});

tableBody.addEventListener("click", async (e) => {
  if (e.target.matches('button[data-action="remove"]')) {
    const code = e.target.getAttribute("data-code");
    const index = e.target.getAttribute("data-index");
    const stock = portfolio.find((p) => p.code === code);

    if (index !== null) {
      // 移除特定購入記錄
      stock.purchases.splice(Number(index), 1);
      if (stock.purchases.length === 0) {
        // 若無購入記錄，移除整個股票
        portfolio = portfolio.filter((p) => p.code !== code);
      } else {
        // 重新計算總股數與平均價格
        const totalShares = stock.purchases.reduce(
          (sum, p) => sum + p.shares,
          0
        );
        const totalCost = stock.purchases.reduce(
          (sum, p) => sum + p.shares * p.price,
          0
        );
        stock.totalShares = totalShares;
        stock.avgPrice = totalCost / totalShares;
      }
    } else {
      // 移除整個股票
      portfolio = portfolio.filter((p) => p.code !== code);
    }
    save();
    calcAndRender();
  }
  // 股票名稱點擊事件
  if (e.target.matches(".stock-name.clickable")) {
    const code = e.target.getAttribute("data-code");
    try {
      const resp = await fetch(`/api/stock/${code}/basic`);
      const data = await resp.json();
      // 彈窗內容
      if (data.error) {
        modalBody.innerHTML = `<p style='color:red;'>${data.error}</p>`;
      } else {
        const fields = [
          { key: "出表日期", label: "出表日期" },
          { key: "年度", label: "年度" },
          { key: "季別", label: "季別" },
          { key: "公司代號", label: "公司代號" },
          { key: "公司名稱", label: "公司名稱" },
          { key: "產業別", label: "產業別" },
          { key: "基本每股盈餘(元)", label: "基本每股盈餘(元)" },
          { key: "普通股每股面額", label: "普通股每股面額" },
          { key: "營業收入", label: "營業收入" },
          { key: "營業利益", label: "營業利益" },
          { key: "營業外收入及支出", label: "營業外收入及支出" },
          { key: "稅後淨利", label: "稅後淨利" },
        ];
        modalBody.innerHTML = `
          <h2>${
            data["公司名稱"] || data["公司簡稱"] || data["公司代號"] || "-"
          }</h2>
          <table style="width:100%;text-align:left;margin-top:0.5em;">
            ${fields
              .map(
                (f) =>
                  `<tr><th style='width:8em;'>${f.label}</th><td>${
                    data[f.key] ?? "-"
                  }</td></tr>`
              )
              .join("")}
          </table>
        `;
      }
      stockModal.style.display = "flex";
    } catch (err) {
      modalBody.innerHTML = '<p style="color:red;">取得基本資料失敗</p>';
      stockModal.style.display = "flex";
    }
  }
});

btnReset.addEventListener("click", () => {
  if (confirm("確定要清空投資組合？")) {
    portfolio = [];
    save();
    calcAndRender();
  }
});

btnRefresh.addEventListener("click", async () => {
  await refreshPricesForAll();
});

// Initial
refreshPricesForAll().then(calcAndRender);
