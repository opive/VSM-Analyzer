// ── State ──
let processCount = 0;
let ctChart = null;
let wasteChart = null;

// ── Initialization ──
document.addEventListener("DOMContentLoaded", () => {
  // Pre-load three example processes (a realistic stamping line)
  addProcess({ name: "Stamping",   cycle_time: 45,  wait_time: 0,   workers: 2, defect_rate: 0.02, value_added: true });
  addProcess({ name: "Welding",    cycle_time: 90,  wait_time: 120, workers: 3, defect_rate: 0.05, value_added: true });
  addProcess({ name: "Inspection", cycle_time: 30,  wait_time: 60,  workers: 1, defect_rate: 0,    value_added: false });
  addProcess({ name: "Assembly",   cycle_time: 75,  wait_time: 180, workers: 4, defect_rate: 0.01, value_added: true });
  addProcess({ name: "Shipping",   cycle_time: 20,  wait_time: 300, workers: 1, defect_rate: 0,    value_added: false });

  updateTaktPreview();

  document.getElementById("add-process-btn").addEventListener("click", () => addProcess());
  document.getElementById("analyze-btn").addEventListener("click", runAnalysis);
  document.getElementById("daily-demand").addEventListener("input", updateTaktPreview);
  document.getElementById("available-time").addEventListener("input", updateTaktPreview);
});

// ── Takt Time Live Preview ──
function updateTaktPreview() {
  const demand = parseFloat(document.getElementById("daily-demand").value) || 1;
  const time   = parseFloat(document.getElementById("available-time").value) || 28800;
  const takt   = time / demand;
  document.getElementById("takt-preview").textContent = takt.toFixed(1) + "s";
}

// ── Add Process Row ──
function addProcess(defaults = {}) {
  processCount++;
  const idx = processCount;

  const row = document.createElement("div");
  row.className = "process-row";
  row.dataset.id = idx;

  row.innerHTML = `
    <div class="process-row-header">
      <div class="process-number">${idx}</div>
      <input class="process-name-input" type="text" placeholder="Process name (e.g. Welding)"
             value="${defaults.name || ""}" />
      <button class="remove-btn" onclick="removeProcess(${idx})">✕</button>
    </div>
    <div class="process-fields">
      <div class="process-field">
        <label>Cycle Time <span style="color:#4f8ef7">(seconds)</span></label>
        <input type="number" class="f-ct" min="0" step="0.1" value="${defaults.cycle_time ?? ""}" placeholder="e.g. 60" />
      </div>
      <div class="process-field">
        <label>Wait / Queue Time <span style="color:#f7a34f">(seconds)</span></label>
        <input type="number" class="f-wait" min="0" step="0.1" value="${defaults.wait_time ?? 0}" placeholder="e.g. 120" />
      </div>
      <div class="process-field">
        <label>Operators</label>
        <input type="number" class="f-workers" min="1" step="1" value="${defaults.workers ?? 1}" />
      </div>
      <div class="process-field">
        <label>Defect Rate <span style="color:#f74f4f">(%)</span></label>
        <input type="number" class="f-defect" min="0" max="100" step="0.1"
               value="${defaults.defect_rate != null ? (defaults.defect_rate * 100).toFixed(1) : 0}" />
      </div>
      <div class="process-field">
        <label>Value-Added?</label>
        <div class="va-toggle">
          <input type="checkbox" class="f-va" id="va-${idx}"
                 ${defaults.value_added !== false ? "checked" : ""} />
          <label for="va-${idx}">Customer pays for this step</label>
        </div>
      </div>
    </div>
  `;

  document.getElementById("processes-list").appendChild(row);
}

function removeProcess(id) {
  const row = document.querySelector(`.process-row[data-id="${id}"]`);
  if (row) row.remove();
}

// ── Collect Form Data ──
function collectProcesses() {
  const rows = document.querySelectorAll(".process-row");
  return Array.from(rows).map(row => ({
    name:        row.querySelector(".process-name-input").value.trim() || "Unnamed",
    cycle_time:  parseFloat(row.querySelector(".f-ct").value)      || 0,
    wait_time:   parseFloat(row.querySelector(".f-wait").value)     || 0,
    workers:     parseInt(row.querySelector(".f-workers").value)    || 1,
    defect_rate: (parseFloat(row.querySelector(".f-defect").value)  || 0) / 100,
    value_added: row.querySelector(".f-va").checked,
  }));
}

// ── Main Analysis Call ──
async function runAnalysis() {
  const processes = collectProcesses();
  if (processes.length === 0) {
    alert("Add at least one process step first.");
    return;
  }

  const payload = {
    processes,
    daily_demand:   parseInt(document.getElementById("daily-demand").value)   || 240,
    available_time: parseInt(document.getElementById("available-time").value) || 28800,
  };

  document.getElementById("loading").classList.remove("hidden");
  document.getElementById("results-section").classList.add("hidden");
  document.getElementById("analyze-btn").disabled = true;

  try {
    const res  = await fetch("/api/analyze", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();

    if (data.error) {
      alert("Error: " + data.error);
      return;
    }

    renderResults(data);
  } catch (err) {
    alert("Request failed: " + err.message);
  } finally {
    document.getElementById("loading").classList.add("hidden");
    document.getElementById("analyze-btn").disabled = false;
  }
}

// ── Render All Results ──
function renderResults(data) {
  const { analysis, ai_recommendations, takt_time } = data;
  const { summary, processes, kaizen_opportunities, waste_breakdown } = analysis;

  renderMetrics(summary);
  renderCTChart(processes, takt_time);
  renderWasteChart(waste_breakdown, summary);
  renderKaizenList(kaizen_opportunities);
  renderVSMFlow(processes, summary.bottleneck_name, takt_time);
  renderAI(ai_recommendations);

  document.getElementById("results-section").classList.remove("hidden");
  document.getElementById("results-section").scrollIntoView({ behavior: "smooth" });
}

// ── Metrics Cards ──
function renderMetrics(s) {
  const efficiency = s.process_efficiency;
  const effClass = efficiency < 10 ? "danger" : efficiency < 25 ? "warn" : "highlight";

  const cards = [
    { label: "Total Lead Time",      value: s.total_lead_time + "s",  cls: "" },
    { label: "Value-Added Time",     value: s.total_va_time + "s",    cls: "highlight" },
    { label: "Non-Value-Added Time", value: s.total_nva_time + "s",   cls: "warn" },
    { label: "Process Efficiency",   value: efficiency + "%",          cls: effClass },
    { label: "Takt Time",            value: s.takt_time + "s",        cls: "" },
    { label: "Bottleneck",           value: s.bottleneck_name,        cls: "danger" },
    { label: "Total Wait Time",      value: s.total_wait_time + "s",  cls: "warn" },
    { label: "Process Steps",        value: s.num_processes,          cls: "" },
  ];

  const grid = document.getElementById("metrics-grid");
  grid.innerHTML = cards.map(c => `
    <div class="metric-card ${c.cls}">
      <div class="metric-label">${c.label}</div>
      <div class="metric-value">${c.value}</div>
    </div>
  `).join("");
}

// ── Cycle Time Chart ──
function renderCTChart(processes, taktTime) {
  const ctx = document.getElementById("ct-chart").getContext("2d");
  if (ctChart) ctChart.destroy();

  const labels = processes.map(p => p.name);
  const ctData = processes.map(p => p.effective_cycle_time);
  const colors = processes.map(p =>
    p.effective_cycle_time > taktTime ? "rgba(247,79,79,0.85)" :
    p.utilization > 80               ? "rgba(247,163,79,0.85)" :
                                       "rgba(79,142,247,0.85)"
  );

  ctChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Cycle Time (s)",
          data: ctData,
          backgroundColor: colors,
          borderRadius: 6,
        },
        {
          label: "Takt Time (s)",
          data: Array(processes.length).fill(taktTime),
          type: "line",
          borderColor: "#f74f4f",
          borderDash: [6, 4],
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: "#e4e8f0", font: { size: 12 } } },
        tooltip: {
          callbacks: {
            afterLabel: (ctx) => {
              const p = processes[ctx.dataIndex];
              if (!p) return "";
              return `Utilization: ${p.utilization}% | Workers: ${p.workers}`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: "#8a90a8" }, grid: { color: "#2e3347" } },
        y: {
          ticks: { color: "#8a90a8" },
          grid: { color: "#2e3347" },
          title: { display: true, text: "seconds", color: "#8a90a8" },
        },
      },
    },
  });
}

// ── Waste Breakdown Chart ──
function renderWasteChart(waste, summary) {
  const ctx = document.getElementById("waste-chart").getContext("2d");
  if (wasteChart) wasteChart.destroy();

  const vaTime = summary.total_va_time;
  wasteChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Value-Added", "Waiting", "Defect Rework", "NVA Processing"],
      datasets: [{
        data: [vaTime, waste.waiting, waste.defects, waste.non_value_added_processing],
        backgroundColor: ["#00d2aa", "#f7a34f", "#f74f4f", "#8a90a8"],
        borderWidth: 2,
        borderColor: "#1a1d27",
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#e4e8f0", font: { size: 11 }, padding: 10 },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = ((ctx.parsed / total) * 100).toFixed(1);
              return ` ${ctx.label}: ${ctx.parsed}s (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

// ── Kaizen List ──
function renderKaizenList(opportunities) {
  const list = document.getElementById("kaizen-list");
  if (opportunities.length === 0) {
    list.innerHTML = `<p style="color:var(--muted);font-size:13px">No critical kaizen opportunities detected.</p>`;
    return;
  }
  list.innerHTML = opportunities.map(k => `
    <div class="kaizen-item ${k.severity}">
      <div class="kaizen-header">
        <span class="kaizen-type">${k.type}</span>
        <span class="kaizen-process">@ ${k.process}</span>
        <span class="severity-badge ${k.severity}">${k.severity}</span>
      </div>
      <div class="kaizen-desc">${k.description}</div>
    </div>
  `).join("");
}

// ── VSM Flow Diagram ──
function renderVSMFlow(processes, bottleneckName, taktTime) {
  const flow = document.getElementById("vsm-flow");

  let html = `
    <div class="vsm-supplier">
      <div class="vsm-icon">🏭</div>
      <div class="vsm-label">Supplier</div>
    </div>
  `;

  processes.forEach((p, i) => {
    const isBN = p.name === bottleneckName && p.effective_cycle_time > taktTime;
    const isOL = !isBN && p.effective_cycle_time > taktTime;
    const isNV = !p.value_added;

    let boxClass = "";
    let badge = "";
    if (isBN) { boxClass = "bottleneck"; badge = `<span class="vsm-badge bn">BOTTLENECK</span>`; }
    else if (isOL) { boxClass = "overloaded"; badge = `<span class="vsm-badge ol">OVERLOADED</span>`; }
    else if (isNV) { boxClass = "non-va"; badge = `<span class="vsm-badge nv">NVA</span>`; }

    html += `
      <div class="vsm-arrow">→</div>
      <div class="vsm-process-box">
        ${p.wait_time > 0 ? `<div class="vsm-wait">⏳ ${p.wait_time}s wait</div>` : ""}
        <div class="vsm-box ${boxClass}">
          ${badge}
          <div class="vsm-box-name">${p.name}</div>
          <div class="vsm-box-ct">${p.effective_cycle_time}</div>
          <div class="vsm-box-unit">seconds CT</div>
          <div class="vsm-box-workers">👷 ${p.workers} worker${p.workers > 1 ? "s" : ""}</div>
        </div>
      </div>
    `;
  });

  html += `
    <div class="vsm-arrow">→</div>
    <div class="vsm-customer">
      <div class="vsm-icon">📦</div>
      <div class="vsm-label">Customer</div>
    </div>
  `;

  flow.innerHTML = html;
}

// ── AI Recommendations ──
function renderAI(text) {
  const el = document.getElementById("ai-recommendations");
  el.textContent = text;
}
