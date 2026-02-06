// ======================================================
// ESTADO ÚNICO DA USINA (FONTE DA VERDADE NO FRONT)
// ======================================================
const PLANT_STATE = {
  name: "Usina Acopiara",

  // dados globais
  rated_power_kwp: 2070.0,
  active_power_kw: 985.9,
  capacity_percent: 47.6,

  // disponibilidade
  inverter_total: 8,
  inverter_online: 7,

  // PR (mock)
  pr_percent: 47.6
};

// ======================================================
// CONFIGURAÇÃO DO DIA (GRÁFICO)
// ======================================================
const POINTS = 288;            // 24h / 5min
const STEP_MINUTES = 5;

const SUNRISE = 6 * 12;        // 06:00
const SUNSET  = 18 * 12;       // 18:00

const PEAK_IRRADIANCE = 950;   // W/m²
const PEAK_POWER = 1200;       // kW

// ======================================================
// FUNÇÕES AUXILIARES
// ======================================================
function smoothNoise(range) {
  return (Math.random() - 0.5) * range;
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

// ======================================================
// GERADOR DIÁRIO REALISTA
// ======================================================
function generateDailySeries() {
  const labels = [];
  const irradiance = [];
  const activePower = [];

  const dayLength = SUNSET - SUNRISE;

  for (let i = 0; i < POINTS; i++) {
    const totalMinutes = i * STEP_MINUTES;
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;

    labels.push(
      `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
    );

    if (i < SUNRISE || i > SUNSET) {
      irradiance.push(0);
      activePower.push(0);
      continue;
    }

    const x = ((i - SUNRISE) / dayLength) * Math.PI;

    const irr =
      PEAK_IRRADIANCE * Math.sin(x) +
      smoothNoise(20);

    irradiance.push(Math.round(clamp(irr, 0, PEAK_IRRADIANCE)));

    const thermalLag = Math.sin(Math.max(x - 0.12, 0));

    let power =
      PEAK_POWER * thermalLag * 0.92 +
      smoothNoise(15);

    power = clamp(power, 0, PEAK_POWER * 0.98);
    activePower.push(Math.round(power));
  }

  return { labels, activePower, irradiance };
}

// ======================================================
// MOCKS DE SÉRIE
// ======================================================
const DAILY = generateDailySeries();

const MONTHLY = {
  labels: ["01", "05", "10", "15", "20", "25", "30"],
  energy: [1200, 1800, 2200, 2600, 2800, 3000, 3200]
};

// ======================================================
// RENDER — HEADER DA USINA
// ======================================================
function renderHeaderSummary() {
  const elRated = document.getElementById("headerRatedPower");
  const elActive = document.getElementById("headerActivePower");
  const elCapacity = document.getElementById("headerCapacity");

  if (!elRated || !elActive || !elCapacity) return;

  elRated.textContent =
    `${PLANT_STATE.rated_power_kwp.toFixed(1)} kWp`;

  elActive.textContent =
    `${PLANT_STATE.active_power_kw.toFixed(1)} kW`;

  elCapacity.textContent =
    `${PLANT_STATE.capacity_percent.toFixed(1)} %`;
}

// ======================================================
// RENDER — FAIXA OPERACIONAL
// ======================================================
function renderSummaryStrip() {
  const elActive = document.getElementById("summaryActivePower");
  const elRated = document.getElementById("summaryRatedPower");
  const elInv = document.getElementById("summaryInverters");
  const elPR = document.getElementById("summaryPR");

  if (!elActive || !elRated || !elInv || !elPR) return;

  elActive.textContent =
    `${PLANT_STATE.active_power_kw.toFixed(1)} kW`;

  elRated.textContent =
    `${PLANT_STATE.rated_power_kwp.toFixed(1)} kWp`;

  elInv.textContent =
    `${PLANT_STATE.inverter_online} / ${PLANT_STATE.inverter_total} Online`;

  elPR.textContent =
    `${PLANT_STATE.pr_percent.toFixed(1)} %`;
}

// ======================================================
// GRÁFICO DIÁRIO
// ======================================================
function renderDailyChart() {
  const canvas = document.getElementById("plantMainChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  const greenGradient = ctx.createLinearGradient(0, 0, 0, 320);
  greenGradient.addColorStop(0, "rgba(57,229,140,0.55)");
  greenGradient.addColorStop(0.6, "rgba(57,229,140,0.35)");
  greenGradient.addColorStop(1, "rgba(57,229,140,0.05)");

  const yellowGradient = ctx.createLinearGradient(0, 0, 0, 320);
  yellowGradient.addColorStop(0, "rgba(255,216,77,0.45)");
  yellowGradient.addColorStop(1, "rgba(255,216,77,0.05)");

  new Chart(ctx, {
    type: "line",
    data: {
      labels: DAILY.labels,
      datasets: [
        {
          data: DAILY.activePower,
          borderColor: "#39e58c",
          backgroundColor: greenGradient,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2,
          yAxisID: "yPower"
        },
        {
          data: DAILY.irradiance,
          borderColor: "#ffd84d",
          backgroundColor: yellowGradient,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
          yAxisID: "yIrr"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: "#9adbb8", maxTicksLimit: 12 },
          grid: { color: "rgba(255,255,255,0.04)" }
        },
        yPower: {
          position: "left",
          ticks: { color: "#39e58c" },
          grid: { color: "rgba(255,255,255,0.05)" }
        },
        yIrr: {
          position: "right",
          ticks: { color: "#ffd84d" },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

// ======================================================
// GRÁFICO MENSAL
// ======================================================
function renderMonthlyChart() {
  const canvas = document.getElementById("plantMonthlyChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  const barGradient = ctx.createLinearGradient(0, 0, 0, 300);
  barGradient.addColorStop(0, "rgba(200,200,200,0.85)");
  barGradient.addColorStop(1, "rgba(120,120,120,0.6)");

  new Chart(ctx, {
    data: {
      labels: MONTHLY.labels,
      datasets: [
        {
          type: "bar",
          data: MONTHLY.energy,
          backgroundColor: barGradient,
          borderRadius: 6,
          barThickness: 26
        },
        {
          type: "line",
          data: MONTHLY.energy.map(v => v * 0.92),
          borderColor: "#cfd8dc",
          borderDash: [6, 6],
          pointRadius: 0,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: "#9adbb8" },
          grid: { display: false }
        },
        y: {
          ticks: { color: "#9adbb8" },
          grid: { color: "rgba(255,255,255,0.04)" }
        }
      }
    }
  });
}

// ======================================================
// INIT
// ======================================================
document.addEventListener("DOMContentLoaded", () => {
  renderHeaderSummary();
  renderSummaryStrip();
  renderDailyChart();
  renderMonthlyChart();
});
