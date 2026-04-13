const dom = {
  form: document.getElementById("analyze-form"),
  csvFile: document.getElementById("csv-file"),
  topN: document.getElementById("top-n"),
  returnsScale: document.getElementById("returns-scale"),
  weights: document.getElementById("weights"),
  sectorNeutral: document.getElementById("sector-neutral"),
  sectorColumn: document.getElementById("sector-column"),
  runBacktest: document.getElementById("run-backtest"),
  backtestForward: document.getElementById("backtest-forward-column"),
  backtestScore: document.getElementById("backtest-score-column"),
  exportBtn: document.getElementById("export-btn"),
  errorBanner: document.getElementById("error-banner"),
  resultsSection: document.getElementById("results-section"),
  resultMeta: document.getElementById("result-meta"),
  resultsBody: document.querySelector("#results-table tbody"),
  scoreChart: document.getElementById("score-chart"),
  factorChart: document.getElementById("factor-chart"),
  backtestSection: document.getElementById("backtest-section"),
  backtestSummary: document.getElementById("backtest-summary"),
  backtestChart: document.getElementById("backtest-chart")
};

let allRows = [];
let visibleRows = [];
let scoreChart = null;
let factorChart = null;
let backtestChart = null;

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read CSV file."));
    reader.readAsText(file);
  });
}

function formatScore(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return Number(value).toFixed(3);
}

function formatPct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function parseTopN() {
  const raw = Number(dom.topN.value);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 20;
  }
  return Math.floor(raw);
}

function showError(message) {
  dom.errorBanner.textContent = message;
  dom.errorBanner.hidden = false;
}

function clearError() {
  dom.errorBanner.textContent = "";
  dom.errorBanner.hidden = true;
}

function average(values) {
  const valid = values.filter((v) => Number.isFinite(v));
  if (valid.length === 0) {
    return 0;
  }
  return valid.reduce((acc, value) => acc + value, 0) / valid.length;
}

function renderResultsTable(rows) {
  dom.resultsBody.innerHTML = "";
  rows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${row.ticker || ""}</td>
      <td>${formatScore(row.composite)}</td>
      <td>${formatScore(row.sector_neutral)}</td>
      <td>${formatScore(row.income)}</td>
      <td>${formatScore(row.risk)}</td>
      <td>${formatScore(row.momentum)}</td>
      <td>${formatScore(row.value)}</td>
      <td>${formatScore(row.quality)}</td>
      <td>${row.recommendation || ""}</td>
    `;
    dom.resultsBody.appendChild(tr);
  });
  dom.resultsSection.hidden = rows.length === 0;
}

function renderScoreChart(rows) {
  if (scoreChart) {
    scoreChart.destroy();
  }
  scoreChart = new Chart(dom.scoreChart, {
    type: "bar",
    data: {
      labels: rows.map((r) => r.ticker),
      datasets: [
        {
          label: "Composite",
          data: rows.map((r) => Number(r.composite || 0)),
          backgroundColor: "rgba(37, 99, 235, 0.7)"
        },
        {
          label: "Sector-Neutral",
          data: rows.map((r) => Number(r.sector_neutral || 0)),
          backgroundColor: "rgba(16, 185, 129, 0.7)"
        }
      ]
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true, max: 1 } }
    }
  });
}

function renderFactorChart(rows) {
  const factors = ["income", "risk", "momentum", "value", "quality"];
  const values = factors.map((factor) => average(rows.map((r) => Number(r[factor]))));
  if (factorChart) {
    factorChart.destroy();
  }
  factorChart = new Chart(dom.factorChart, {
    type: "radar",
    data: {
      labels: factors.map((f) => f.charAt(0).toUpperCase() + f.slice(1)),
      datasets: [
        {
          label: "Average factor score (Top N)",
          data: values,
          backgroundColor: "rgba(59, 130, 246, 0.2)",
          borderColor: "rgb(59, 130, 246)",
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      scales: { r: { min: 0, max: 1 } }
    }
  });
}

function renderBacktest(backtest) {
  dom.backtestSection.hidden = false;
  if (!backtest || !backtest.summary) {
    dom.backtestSummary.innerHTML = "<p class=\"small\">Not enough valid rows. Include multiple dates and forward returns.</p>";
    if (backtestChart) {
      backtestChart.destroy();
      backtestChart = null;
    }
    return;
  }

  const summary = backtest.summary;
  dom.backtestSummary.innerHTML = `
    <ul>
      <li>Periods: ${summary.periods}</li>
      <li>Average spread: ${formatPct(summary.avg_long_short_spread)}</li>
      <li>Median spread: ${formatPct(summary.median_long_short_spread)}</li>
      <li>Final cumulative long-short: ${formatPct(summary.final_cumulative_long_short)}</li>
      <li>Final cumulative long-only: ${formatPct(summary.final_cumulative_long_only)}</li>
    </ul>
  `;

  const periods = Array.isArray(backtest.periods) ? backtest.periods : [];
  if (backtestChart) {
    backtestChart.destroy();
  }
  backtestChart = new Chart(dom.backtestChart, {
    type: "line",
    data: {
      labels: periods.map((p) => p.date),
      datasets: [
        {
          label: "Long-Short Cumulative",
          data: periods.map((p) => Number(p.cumulative_long_short || 0)),
          borderColor: "rgb(199, 72, 72)",
          backgroundColor: "rgba(199, 72, 72, 0.2)",
          tension: 0.25
        },
        {
          label: "Long-Only Cumulative",
          data: periods.map((p) => Number(p.cumulative_long_only || 0)),
          borderColor: "rgb(75, 75, 192)",
          backgroundColor: "rgba(75, 75, 192, 0.2)",
          tension: 0.25
        }
      ]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          ticks: {
            callback: (value) => `${(Number(value) * 100).toFixed(1)}%`
          }
        }
      }
    }
  });
}

function rowsToCsv(rows) {
  if (!rows.length) {
    return "";
  }
  const fields = [
    "ticker",
    "composite",
    "sector_neutral",
    "income",
    "risk",
    "momentum",
    "value",
    "quality",
    "recommendation"
  ];
  const lines = [fields.join(",")];
  for (const row of rows) {
    const line = fields
      .map((field) => {
        const raw = row[field] ?? "";
        const value = typeof raw === "number" ? raw.toString() : String(raw);
        if (value.includes(",") || value.includes("\"")) {
          return `"${value.replaceAll("\"", "\"\"")}"`;
        }
        return value;
      })
      .join(",");
    lines.push(line);
  }
  return lines.join("\n");
}

function downloadVisibleRows() {
  if (!visibleRows.length) {
    showError("No rows to export yet. Run an analysis first.");
    return;
  }
  const content = rowsToCsv(visibleRows);
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "scored_stocks.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function onAnalyze(event) {
  event.preventDefault();
  clearError();
  const file = dom.csvFile.files && dom.csvFile.files[0];
  if (!file) {
    showError("Please select a CSV file.");
    return;
  }

  try {
    const csvText = await readFileAsText(file);
    const payload = {
      csv_text: csvText,
      returns_scale: dom.returnsScale.value,
      weights: dom.weights.value.trim(),
      sector_neutral: dom.sectorNeutral.checked,
      sector_column: dom.sectorColumn.value.trim() || "sector",
      backtest: dom.runBacktest.checked,
      backtest_forward_column: dom.backtestForward.value.trim() || "forward_return_1m",
      backtest_score_column: dom.backtestScore.value
    };

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Request failed.");
    }

    allRows = Array.isArray(data.results) ? data.results : [];
    visibleRows = allRows.slice(0, parseTopN());
    renderResultsTable(visibleRows);
    renderScoreChart(visibleRows);
    renderFactorChart(visibleRows);
    dom.resultMeta.textContent = `${allRows.length} stocks scored. Showing top ${visibleRows.length}.`;

    if (payload.backtest) {
      renderBacktest(data.backtest);
    } else {
      dom.backtestSection.hidden = true;
      if (backtestChart) {
        backtestChart.destroy();
        backtestChart = null;
      }
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : "Unexpected error.");
  }
}

dom.form.addEventListener("submit", onAnalyze);
dom.exportBtn.addEventListener("click", downloadVisibleRows);
