// =============================================================================
// API FETCH COM CONTEXTO DO USUÁRIO LOGADO (CORRIGIDO - VERSÃO FINAL)
// =============================================================================
// 🔧 AJUSTE CRÍTICO: Usar localStorage em vez de sessionStorage
// 
// ✅ O backend agora exige:
//    - X-Customer-Id para operadores (multi-tenant)
//    - X-Is-Superuser: true para admins (acesso total)
// 
// ⚠️ IMPORTANTE: O arquivo de login DEVE fazer isso quando o usuário faz login:
//    localStorage.setItem("user", JSON.stringify(user));
//    Onde user contém: { id, username, customer_id, is_superuser }
// =============================================================================

const API_BASE = "https://jgeg9i0js1.execute-api.us-east-1.amazonaws.com";

function apiFetch(path, options = {}) {
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const headers = {
    ...(options.headers || {})
  };

  // Operador (multi-tenant)
  if (user.customer_id) {
    headers["X-Customer-Id"] = user.customer_id;
  }

  // Admin (acesso total)
  if (user.is_superuser === true) {
    headers["X-Is-Superuser"] = "true";
  }

  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });
}

// =============================================================================
// CONFIGURAÇÃO GLOBAL E ESTADO
// =============================================================================
let eventsInterval = null;
let allEvents = []; // Estado global de events (legado)
let lastValidPlants = []; // 🔒 CACHE DE ÚLTIMO PORTFÓLIO VÁLIDO (SCADA-GRADE)

// =============================================================================
// FUNÇÕES DE UTILIDADE (SCADA INDUSTRIAL)
// =============================================================================

/**
 * Retorna o valor ou um traço se o valor for nulo/indefinido.
 */
function valueOrDash(v) {
  return v === null || v === undefined || v === "" ? "—" : v;
}

/**
 * Normaliza o evento para garantir que payload e deviceId sejam encontrados.
 */
function normalizeEvent(ev) {
  const payload = ev.payload || ev.data || ev.message || {};
  const deviceId = ev.device_id || ev.device || ev.source || ev.tags?.device_id;
  return { deviceId, payload };
}

/**
 * Deriva o nome do equipamento a partir do device_id.
 */
function getEquipmentFromDeviceId(deviceId) {
  if (!deviceId) return "—";
  const parts = deviceId.split(".");
  const type = parts[parts.length - 2]; // inverter | relay
  const id = parts[parts.length - 1];   // 1 | 2 | 3 ...
  if (type === "inverter") return `Inversor ${id}`;
  if (type === "relay") return `Relay ${id}`;
  return deviceId;
}

/**
 * Mapeia códigos de alarme para descrições humanas.
 */
function severityColor(sev) {
  if (sev === "high") return "#f44336";
  if (sev === "medium") return "#ff9800";
  if (sev === "low") return "#4caf50";
  return "#ccc";
}

function getAlarmDescription(eventCode) {
  const map = {
    17: "Falha geral",
    59: "Proteção acionada",
    7: "Subtensão",
    9: "Sobretensão"
  };
  return map[eventCode] || `Evento ${eventCode}`;
}

/**
 * Deriva informações de ponto e descrição a partir do payload do evento.
 */
function deriveEventInfoFromPayload(p) {
  if (!p || !p.asset_type) {
    return { point: "—", description: "—", state: "CLEARED" };
  }

  if (p.asset_type === "relay") {
    if (p.trip_circuit_fail == 1) return { point: "Trip circuit", description: "Falha circuito de trip", state: "ACTIVE" };
    if (p.relay_synchronism_status == 1) return { point: "Synchronism", description: "Relé sincronizado", state: "ACTIVE" };
    
    for (const key of Object.keys(p)) {
      if (!key.startsWith("flag_")) continue;
      if (p[key] == 1 || p[key] == 28 || p[key] === true) {
        const flag = key.replace("flag_", "");
        return { point: `Flag ${flag}`, description: `Proteção ${flag} acionada`, state: "ACTIVE" };
      }
    }
    return { point: "Status", description: "Relé normalizado", state: "CLEARED" };
  }

  if (p.asset_type === "inverter") {
    for (let i = 1; i <= 10; i++) {
      const key = i < 10 ? `fault_0${i}` : `fault_${i}`;
      if (p[key] == 1) return { point: `Fault ${i}`, description: `Fault ${i} ativo`, state: "ACTIVE" };
    }
    if (p.fault_code && Number(p.fault_code) !== 0) {
      return { point: `Fault ${p.fault_code}`, description: `Falha do inversor (code ${p.fault_code})`, state: "ACTIVE" };
    }
    return { point: "Status", description: "Inversor normalizado", state: "CLEARED" };
  }

  return { point: "—", description: "—", state: "CLEARED" };
}

// =============================================================================
// CONTROLE DE TEMA E RELÓGIO
// =============================================================================
const themeToggleBtn = document.getElementById("themeToggleBtn");
const themeIcon = document.getElementById("themeIcon");
const body = document.body;

const savedTheme = localStorage.getItem("theme") || "light";
body.classList.add(`theme-${savedTheme}`);
if (themeIcon) themeIcon.className = savedTheme === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";

themeToggleBtn?.addEventListener("click", () => {
  const isDark = body.classList.contains("theme-dark");
  const newTheme = isDark ? "light" : "dark";
  body.classList.remove("theme-light", "theme-dark");
  body.classList.add(`theme-${newTheme}`);
  localStorage.setItem("theme", newTheme);
  if (themeIcon) themeIcon.className = newTheme === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";
});

function updateClock() {
  const el = document.getElementById("clock");
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleDateString("pt-BR") + " • " + now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
setInterval(updateClock, 1000);
updateClock();

// =============================================================================
// CONSUMO DE API (CONTRATO OFICIAL E NORMALIZAÇÃO LAMBDA)
// =============================================================================

/**
 * Busca a lista de usinas e seus indicadores consolidados.
 * Endpoint: /plants
 */
async function fetchPlants() {
  const res = await apiFetch("/plants");
  if (!res.ok) throw new Error("Erro ao buscar plantas");

  const data = await res.json();

  // 🔴 NORMALIZAÇÃO OBRIGATÓRIA (LAMBDA PROXY)
  if (data && data.body) {
    const parsed = typeof data.body === "string"
      ? JSON.parse(data.body)
      : data.body;
    return Array.isArray(parsed) ? parsed : [];
  }

  return Array.isArray(data) ? data : [];
}

/**
 * Busca alarmes ativos.
 * Endpoint: /alarms/active
 */
async function fetchActiveAlarms() {
  const res = await apiFetch("/alarms/active");
  if (!res.ok) throw new Error("Erro ao buscar alarmes ativos");
  
  const data = await res.json();
  
  if (data && data.body) {
    const parsed = typeof data.body === "string" ? JSON.parse(data.body) : data.body;
    return Array.isArray(parsed) ? parsed : [];
  }
  return Array.isArray(data) ? data : [];
}

/**
 * Busca alarmes reconhecidos (ACK / histórico).
 * Endpoint: /alarms/history
 */
async function fetchAcknowledgedAlarms() {
  const res = await apiFetch("/alarms/history");
  if (!res.ok) throw new Error("Erro ao buscar alarmes reconhecidos");

  const data = await res.json();

  if (data && data.body) {
    const parsed = typeof data.body === "string" ? JSON.parse(data.body) : data.body;
    return Array.isArray(parsed) ? parsed : [];
  }

  return Array.isArray(data) ? data : [];
}

/**
 * Reconhece um alarme.
 */
async function acknowledgeAlarm(alarmId) {
  await apiFetch(`/alarms/${alarmId}/ack`, {
    method: "POST"
  });
}

/**
 * Busca eventos (Legado - Desabilitado).
 */
async function fetchEvents(filters = {}) {
  const qs = new URLSearchParams(filters).toString();
  const res = await apiFetch(
    `/events?${qs}`
  );

  if (!res.ok) throw new Error("Erro ao buscar eventos");

  const data = await res.json();

  // Normalização Lambda proxy
  if (data && data.body) {
    const parsed = typeof data.body === "string"
      ? JSON.parse(data.body)
      : data.body;
    return Array.isArray(parsed) ? parsed : [];
  }

  return Array.isArray(data) ? data : [];
}

// =============================================================================
// RENDERIZAÇÃO DA INTERFACE (UI)
// =============================================================================

/**
 * Renderiza a tabela de alarmes (Ativos ou Reconhecidos).
 */
async function renderAlarmsTable(isRecognized = false) {
  const tbody = document.getElementById("alarmsTbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  
  let alarms = [];
  try {
    // 🟢 PASSO 2: Escolher a API correta com base na aba
    alarms = isRecognized
      ? (await fetchAcknowledgedAlarms()).filter(a => {
          const state = a.alarm_state || a.state;
          return state === "ACK" || state === "CLEARED";
        })
      : await fetchActiveAlarms();
  } catch (err) {
    console.error("Erro ao buscar alarmes:", err);
  }

  if (!alarms || alarms.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; opacity:0.6; padding:40px;">${isRecognized ? "Nenhum alerta reconhecido" : "Nenhum alerta ativo"}</td></tr>`;
    return;
  }

  alarms.forEach(alarm => {
    const tr = document.createElement("tr");
    
    // 🟢 PASSO 3: Corrigir timestamp (compatível com ACTIVE e ACK)
    const timestamp =
      alarm.ack_at ||
      alarm.cleared_at ||
      alarm.last_event_ts ||
      alarm.started_at ||
      "—";
      
    const tsFormatted = timestamp !== "—" ? new Date(timestamp).toLocaleString("pt-BR") : "—";
    
    const state = alarm.alarm_state || alarm.state || "—";
    const stateColor =
      state === "ACTIVE" ? "#f44336" :
      state === "ACK"    ? "#ff9800" :
      state === "CLEARED"? "#4caf50" :
      "#ccc";

    const plantLabel = alarm.power_plant_name
      ? alarm.power_plant_name
      : "—";
    const deviceLabel = alarm.device_type && alarm.device_name
      ? `${alarm.device_type} • ${alarm.device_name}`
      : (alarm.device_name || alarm.device_id || "—");

    tr.innerHTML = `
      <td>${plantLabel} • ${deviceLabel}</td>
      <td>${getAlarmDescription(alarm.event_code)}</td>
      <td style="font-weight:bold; color:${stateColor};">
        ${state}
      </td>
      <td>${tsFormatted}</td>
    `;
    
    if (!isRecognized) {
      tr.style.cursor = "pointer";
      tr.title = "Clique duplo para reconhecer";
      tr.addEventListener("dblclick", async () => {
        try {
          await acknowledgeAlarm(alarm.id);
          // 🟢 PASSO 4: Forçar refresh da aba correta após ACK
          await renderAlarmsTable(false);
        } catch (err) {
          console.error("Erro ao reconhecer alarme:", err);
        }
      });
    }
    tbody.appendChild(tr);
  });
}

/**
 * Renderiza a tabela de eventos (API REST).
 */
async function loadEvents() {
  const tbody = document.getElementById("eventsTbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  let events = [];
  try {
    events = await fetchEvents({ limit: 100 });
  } catch (err) {
    console.error("Erro ao buscar eventos:", err);
  }

  if (!events || events.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center; opacity:0.6; padding:40px;">
          Nenhum evento registrado
        </td>
      </tr>
    `;
    return;
  }

  events.forEach(ev => {
    const tr = document.createElement("tr");

    const ts = ev.event_ts
      ? new Date(ev.event_ts).toLocaleString("pt-BR")
      : "—";

    const deviceLabel =
      ev.device_type && ev.device_name
        ? `${ev.device_type} • ${ev.device_name}`
        : (ev.device_name || ev.device_id || "—");

    tr.innerHTML = `
      <td>${ts}</td>
      <td>${valueOrDash(ev.power_plant_name)}</td>
      <td>${deviceLabel}</td>
      <td>${valueOrDash(ev.event_type)}</td>
      <td style="font-weight:bold; color:${severityColor(ev.severity)};">
        ${valueOrDash(ev.severity)}
      </td>
    `;

    tbody.appendChild(tr);
  });
}

/**
 * Atualiza o resumo do topo do dashboard (Summary).
 */
function updateSummaryUI(plants) {
  const validPlants = Array.isArray(plants) ? plants : [];

  let totalActivePower = 0;
  let totalRatedPower  = 0;

  validPlants.forEach(p => {
    totalActivePower += Number(p.active_power_kw || 0);
    totalRatedPower  += Number(p.rated_power_kw || 0);
  });

  const loadPct =
    totalRatedPower > 0
      ? (totalActivePower / totalRatedPower) * 100
      : 0;

  const elActive  = document.querySelector("#activePower");
  const elRated   = document.querySelector("#ratedPower");
  const elPercent = document.querySelector("#progressPercent");

  if (elActive)  elActive.innerText  = totalActivePower.toFixed(1) + " kW";
  if (elRated)   elRated.innerText   = totalRatedPower.toFixed(1) + " kWp";
  if (elPercent) elPercent.innerText = loadPct.toFixed(1) + "%";

  const elPsfActive  = document.getElementById("psfActivePower");
  const elPsfRated   = document.getElementById("psfRatedPower");
  const elPsfPercent = document.getElementById("psfCapacityPct");

  if (elPsfActive)  elPsfActive.textContent  = totalActivePower.toFixed(1) + " kW";
  if (elPsfRated)   elPsfRated.textContent   = totalRatedPower.toFixed(1) + " kWp";
  if (elPsfPercent) elPsfPercent.textContent = loadPct.toFixed(1) + "%";
}

/**
 * Renderiza a tabela de portfólio de usinas.
 */
function renderPortfolioTable(plants) {
  const tbody = document.getElementById("portfolioTbody");
  if (!tbody) return;

  const validPlants = Array.isArray(plants) ? plants : [];
  if (validPlants.length === 0) return;

  tbody.innerHTML = "";

  validPlants.forEach(plant => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${valueOrDash(plant.power_plant_name)}</td>
      <td>${Number(plant.rated_power_kw ?? 0).toFixed(1)} kWp</td>
      <td>${Number(plant.active_power_kw ?? 0).toFixed(1)} kW</td>
      <td>${Number(plant.energy_today_kwh ?? 0).toFixed(1)} kWh</td>
      <td>${valueOrDash(plant.irradiance_wm2)} W/m²</td>
      <td>${plant.inverter_availability_pct != null ? (plant.inverter_availability_pct * 100).toFixed(1) + "%" : "—"}</td>
      <td>${plant.relay_availability_pct != null ? (plant.relay_availability_pct * 100).toFixed(1) + "%" : "—"}</td>
      <td>${plant.performance_ratio != null ? Number(plant.performance_ratio).toFixed(1) + "%" : "—"}</td>

      <td style="text-align:center;">
        <button
          class="plant-link-btn"
          title="Abrir usina"
          data-plant-id="${plant.power_plant_id}"
          style="background:none;border:none;cursor:pointer;color:#00e676;"
        >
          <i class="fa-solid fa-arrow-up-right-from-square"></i>
        </button>
      </td>
    `;

    tr.querySelector(".plant-link-btn").addEventListener("click", () => {
      window.location.href = `plant.html?plant_id=${plant.power_plant_id}`;
    });

    tbody.appendChild(tr);
  });
}

// =============================================================================
// NAVEGAÇÃO E INICIALIZAÇÃO
// =============================================================================
const views = {
  overview: document.getElementById("overviewView"),
  alarms: document.getElementById("alarmsView"),
  events: document.getElementById("eventsView"),
  diagram: document.getElementById("diagramView")
};

function showView(viewName) {
  localStorage.setItem("currentView", viewName);
  Object.values(views).forEach(v => { if (v) v.classList.add("hidden"); });
  if (views[viewName]) views[viewName].classList.remove("hidden");

  document.querySelectorAll(".sidebar-btn").forEach(b => b.classList.remove("active"));
  const activeBtn = document.getElementById(`btn${viewName.charAt(0).toUpperCase()}${viewName.slice(1)}`);
  if (activeBtn) activeBtn.classList.add("active");

  const topSummary = document.getElementById("topSummary");
  if (topSummary) topSummary.classList.remove("hidden");

  if (viewName === "events") {
    loadEvents();
  }
}

document.getElementById("btnOverview")?.addEventListener("click", () => showView("overview"));
document.getElementById("btnAlarms")?.addEventListener("click", async () => {
  showView("alarms");
  // Resetar abas de alarmes para mostrar "Alertas" (Ativos) por padrão
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  const firstTab = document.querySelector(".tab-btn");
  if (firstTab) firstTab.classList.add("active");
  await renderAlarmsTable(false);
});
document.getElementById("btnEvents")?.addEventListener("click", () => showView("events"));

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const isRecognized = btn.textContent.includes("RECONHECIDOS");
    await renderAlarmsTable(isRecognized);
  });
});

/**
 * 🔒 REFRESH DASHBOARD (SCADA-GRADE)
 */
async function refreshDashboard() {
  try {
    const plants = await fetchPlants();
    if (Array.isArray(plants) && plants.length > 0) {
      lastValidPlants = plants;
    }
    updateSummaryUI(lastValidPlants);
    renderPortfolioTable(lastValidPlants);
  } catch (err) {
    console.error("Erro ao atualizar dashboard:", err);
    updateSummaryUI(lastValidPlants);
    renderPortfolioTable(lastValidPlants);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const savedView = localStorage.getItem("currentView") || "overview";
  showView(savedView);
  await refreshDashboard();
  setInterval(refreshDashboard, 30000);
});
