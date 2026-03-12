import * as http from 'node:http';
import type { PyramidConfig } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';
import { EGYPTIAN_THEME } from './theme.js';

export interface DashboardApp {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly isRunning: boolean;
  readonly port: number;
}

export interface DashboardAppOptions {
  config: PyramidConfig;
  logger: Logger;
}

function generateDashboardHtml(apiPort: number, apiKey: string): string {
  const { colors, fonts } = EGYPTIAN_THEME;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PYRAMID OS - Control Centre</title>
  <style>
    :root {
      --sandstone: ${colors.sandstone};
      --gold: ${colors.gold};
      --lapis: ${colors.lapis};
      --papyrus: ${colors.papyrus};
      --obsidian: ${colors.obsidian};
      --copper: ${colors.copper};
      --turquoise: ${colors.turquoise};
      --hieroglyph-red: ${colors.hieroglyphRed};
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background-color: var(--obsidian); color: var(--papyrus); font-family: ${fonts.body}; font-size: 13px; }
    h1, h2, h3 { font-family: ${fonts.heading}; color: var(--gold); }
    #app { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; padding: 12px; min-height: 100vh; }
    header {
      grid-column: 1 / -1;
      background: linear-gradient(135deg, var(--obsidian), var(--sandstone));
      border: 2px solid var(--gold);
      padding: 12px 16px;
      display: flex; align-items: center; justify-content: space-between;
    }
    header h1 { font-size: 1.3rem; }
    #ws-status { font-size: 11px; padding: 3px 8px; border-radius: 3px; background: rgba(0,0,0,0.4); }
    #ws-status.connected { color: var(--turquoise); border: 1px solid var(--turquoise); }
    #ws-status.disconnected { color: var(--hieroglyph-red); border: 1px solid var(--hieroglyph-red); }
    #ws-status.reconnecting { color: var(--gold); border: 1px solid var(--gold); }
    .panel {
      background-color: rgba(194,178,128,0.07);
      border: 1px solid var(--copper);
      border-radius: 4px;
      padding: 10px;
      overflow: hidden;
    }
    .panel h2 { font-size: 0.8rem; margin-bottom: 8px; border-bottom: 1px solid var(--copper); padding-bottom: 4px; letter-spacing: 1px; text-transform: uppercase; }
    .panel-content { min-height: 80px; }
    .dim { color: rgba(194,178,128,0.4); font-style: italic; font-size: 12px; }
    .ok { color: var(--turquoise); }
    .warn { color: var(--gold); }
    .err { color: var(--hieroglyph-red); }
    .row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; border-bottom: 1px solid rgba(194,178,128,0.1); }
    .row:last-child { border-bottom: none; }
    .badge { font-size: 10px; padding: 1px 5px; border-radius: 2px; background: rgba(0,0,0,0.3); }
    .badge.healthy { color: var(--turquoise); border: 1px solid var(--turquoise); }
    .badge.degraded { color: var(--gold); border: 1px solid var(--gold); }
    .badge.critical, .badge.error { color: var(--hieroglyph-red); border: 1px solid var(--hieroglyph-red); }
    .badge.idle { color: var(--sandstone); border: 1px solid var(--sandstone); }
    .badge.active, .badge.running { color: var(--turquoise); border: 1px solid var(--turquoise); }
    .progress-bar { height: 6px; background: rgba(194,178,128,0.15); border-radius: 3px; margin-top: 3px; }
    .progress-fill { height: 100%; border-radius: 3px; background: var(--gold); transition: width 0.5s; }
    .alert-item { padding: 4px 0; border-bottom: 1px solid rgba(194,178,128,0.1); font-size: 12px; }
    .alert-item:last-child { border-bottom: none; }
    .alert-item.critical { color: var(--hieroglyph-red); }
    .alert-item.warning { color: var(--gold); }
    .alert-item.info { color: var(--turquoise); }
    .sys-btn {
      background: rgba(194,178,128,0.1); border: 1px solid var(--copper); color: var(--papyrus);
      padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 12px; margin: 3px 2px;
      font-family: ${fonts.body};
    }
    .sys-btn:hover { background: rgba(194,178,128,0.2); border-color: var(--gold); }
    .sys-btn.danger { border-color: var(--hieroglyph-red); color: var(--hieroglyph-red); }
    .sys-btn.danger:hover { background: rgba(180,30,30,0.2); }
    #health-overall { font-size: 11px; margin-bottom: 6px; }
    .metric-val { color: var(--gold); font-weight: bold; }
    .civ-name { color: var(--gold); font-size: 1rem; }
  </style>
</head>
<body>
<div id="app">
  <header>
    <div>
      <h1>&#9650; PYRAMID OS Control Centre</h1>
      <div style="color:var(--sandstone);font-size:11px;margin-top:2px;" id="civ-header">Egyptian Civilization Multi-Agent Dashboard</div>
    </div>
    <div id="ws-status" class="disconnected">&#9679; Disconnected</div>
  </header>

  <div class="panel" id="panel-agents">
    <h2>&#129302; Agent Overview</h2>
    <div class="panel-content" id="agents-content"><span class="dim">Connecting...</span></div>
  </div>

  <div class="panel" id="panel-builds">
    <h2>&#127963; Build Progress</h2>
    <div class="panel-content" id="builds-content"><span class="dim">Connecting...</span></div>
  </div>

  <div class="panel" id="panel-resources">
    <h2>&#129518; Resources</h2>
    <div class="panel-content" id="resources-content"><span class="dim">Connecting...</span></div>
  </div>

  <div class="panel" id="panel-health">
    <h2>&#10084; System Health</h2>
    <div id="health-overall"></div>
    <div class="panel-content" id="health-content"><span class="dim">Connecting...</span></div>
  </div>

  <div class="panel" id="panel-alerts">
    <h2>&#9888; Alert Feed</h2>
    <div class="panel-content" id="alerts-content"><span class="dim">No alerts</span></div>
  </div>

  <div class="panel" id="panel-system">
    <h2>&#9881; System Controls</h2>
    <div class="panel-content" id="system-content">
      <div style="margin-bottom:8px;">
        <button class="sys-btn" onclick="sysAction('start')">&#9654; Start</button>
        <button class="sys-btn" onclick="sysAction('pause')">&#9646;&#9646; Pause</button>
        <button class="sys-btn danger" onclick="sysAction('stop')">&#9632; Stop</button>
      </div>
      <div>
        <span style="font-size:11px;color:var(--sandstone);">Mode: </span>
        <select id="mode-select" style="background:rgba(0,0,0,0.4);color:var(--papyrus);border:1px solid var(--copper);padding:3px 6px;border-radius:3px;font-size:12px;">
          <option value="structured">Structured</option>
          <option value="guided_autonomy">Guided Autonomy</option>
          <option value="free_thinking">Free Thinking</option>
        </select>
        <button class="sys-btn" onclick="setMode()" style="margin-left:4px;">Set</button>
      </div>
      <div id="sys-msg" style="margin-top:6px;font-size:11px;color:var(--turquoise);"></div>
    </div>
  </div>

  <div class="panel" id="panel-metrics">
    <h2>&#128200; Metrics</h2>
    <div class="panel-content" id="metrics-content"><span class="dim">Connecting...</span></div>
  </div>

  <div class="panel" id="panel-tasks">
    <h2>&#128203; Tasks</h2>
    <div class="panel-content" id="tasks-content"><span class="dim">Connecting...</span></div>
  </div>

  <div class="panel" id="panel-bots">
    <h2>&#129302; Bot Status</h2>
    <div class="panel-content" id="bots-content"><span class="dim">No bots connected</span></div>
  </div>
</div>

<script>
(function() {
  const API_PORT = ${apiPort};
  const API_KEY = '${apiKey}';
  const API_BASE = 'http://localhost:' + API_PORT;
  const WS_URL = 'ws://localhost:' + API_PORT + '/ws?x-api-key=' + API_KEY;
  const HEADERS = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };

  // ── State ──────────────────────────────────────────────────────────
  const state = {
    agents: [],
    agentActivity: new Map(), // agentId → { role, decision, timestamp }
    builds: [],
    resources: [],
    tasks: [],
    metrics: null,
    health: null,
    alerts: [],
    bots: new Map(),
    civilization: null,
  };

  // ── WebSocket ──────────────────────────────────────────────────────
  let ws = null;
  let wsReconnectTimer = null;
  let wsAttempts = 0;

  function connectWS() {
    if (ws && ws.readyState < 2) return;
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      wsAttempts = 0;
      setWsStatus('connected', '&#9679; Connected');
    };

    ws.onmessage = (e) => {
      try {
        const events = JSON.parse(e.data);
        const arr = Array.isArray(events) ? events : [events];
        arr.forEach(handleWsEvent);
      } catch {}
    };

    ws.onclose = () => {
      setWsStatus('reconnecting', '&#9679; Reconnecting...');
      const delay = Math.min(1000 * Math.pow(2, wsAttempts), 30000);
      wsAttempts++;
      wsReconnectTimer = setTimeout(connectWS, delay);
    };

    ws.onerror = () => {};
  }

  function setWsStatus(cls, text) {
    const el = document.getElementById('ws-status');
    el.className = cls;
    el.innerHTML = text;
  }

  function handleWsEvent(ev) {
    if (!ev || !ev.type) return;
    switch (ev.type) {
      case 'agent:state':
        updateAgentInState(ev.agentId, ev.state);
        renderAgents();
        break;
      case 'agent:activity':
        state.agentActivity.set(ev.agentId, { role: ev.role, decision: ev.decision, timestamp: ev.timestamp });
        renderAgents();
        break;
      case 'resource:update':
        updateResourceInState(ev.resourceType, ev.level);
        renderResources();
        break;
      case 'build:progress':
        updateBuildInState(ev.buildId, ev.percent);
        renderBuilds();
        break;
      case 'bot:connect':
        state.bots.set(ev.botId, { connected: true, server: ev.server });
        renderBots();
        break;
      case 'bot:disconnect':
        state.bots.set(ev.botId, { connected: false, reason: ev.reason });
        renderBots();
        break;
      case 'alert':
        state.alerts.unshift({ severity: ev.severity, message: ev.message, time: Date.now() });
        if (state.alerts.length > 20) state.alerts.pop();
        renderAlerts();
        break;
      case 'health:update':
        if (!state.health) state.health = { overall: 'healthy', checks: [], checkedAt: '' };
        const idx = state.health.checks.findIndex(c => c.component === ev.component);
        if (idx >= 0) state.health.checks[idx].status = ev.status;
        else state.health.checks.push({ component: ev.component, status: ev.status, message: '', latencyMs: 0, checkedAt: '' });
        renderHealth();
        break;
      case 'task:complete':
        fetchTasks();
        break;
    }
  }

  function updateAgentInState(id, agentState) {
    const idx = state.agents.findIndex(a => a.id === id);
    if (idx >= 0) state.agents[idx] = { ...state.agents[idx], status: agentState };
    else state.agents.push({ id, status: agentState });
  }

  function updateResourceInState(type, level) {
    const idx = state.resources.findIndex(r => r.resourceType === type);
    if (idx >= 0) state.resources[idx].quantity = level;
    else state.resources.push({ resourceType: type, quantity: level });
  }

  function updateBuildInState(id, percent) {
    const idx = state.builds.findIndex(b => b.id === id);
    if (idx >= 0) state.builds[idx].progress = percent;
    else state.builds.push({ id, progress: percent });
  }

  // ── REST polling ───────────────────────────────────────────────────
  async function apiFetch(path) {
    try {
      const r = await fetch(API_BASE + path, { headers: HEADERS });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  async function fetchAll() {
    const [agents, builds, resources, tasks, metrics, health, civ] = await Promise.all([
      apiFetch('/agents'),
      apiFetch('/builds'),
      apiFetch('/resources'),
      apiFetch('/tasks'),
      apiFetch('/metrics'),
      apiFetch('/health'),
      apiFetch('/civilizations/active'),
    ]);
    if (agents) state.agents = agents;
    if (builds) state.builds = builds;
    if (resources) state.resources = resources;
    if (tasks) state.tasks = tasks;
    if (metrics) state.metrics = metrics;
    if (health) state.health = health;
    if (civ && !civ.statusCode) state.civilization = civ;
    renderAll();
  }

  async function fetchTasks() {
    const tasks = await apiFetch('/tasks');
    if (tasks) { state.tasks = tasks; renderTasks(); }
  }

  // ── Render ─────────────────────────────────────────────────────────
  function renderAll() {
    renderAgents();
    renderBuilds();
    renderResources();
    renderTasks();
    renderMetrics();
    renderHealth();
    renderAlerts();
    renderBots();
    renderCiv();
  }

  function el(id) { return document.getElementById(id); }

  function renderCiv() {
    if (state.civilization) {
      el('civ-header').innerHTML = '&#127981; Active Civilization: <span class="civ-name">' + esc(state.civilization.name) + '</span>';
    }
  }

  function renderAgents() {
    const c = el('agents-content');
    if (!state.agents.length) { c.innerHTML = '<span class="dim">No agents registered</span>'; return; }
    c.innerHTML = state.agents.map(a => {
      const status = typeof a.status === 'string' ? a.status : (a.status?.phase ?? 'idle');
      const role = a.role ?? a.id ?? 'agent';
      const activity = state.agentActivity.get(a.id);
      const decisionHtml = activity?.decision
        ? '<div style="font-size:11px;color:var(--sandstone);margin-top:2px;padding-left:4px;border-left:2px solid var(--copper);white-space:pre-wrap;word-break:break-word;">' + esc(activity.decision) + '</div>'
        : '';
      const timeHtml = activity?.timestamp
        ? '<span style="font-size:10px;color:rgba(194,178,128,0.4);margin-left:6px;">' + new Date(activity.timestamp).toLocaleTimeString() + '</span>'
        : '';
      return '<div style="margin-bottom:6px;"><div class="row"><span style="font-weight:bold;">' + esc(role) + timeHtml + '</span><span class="badge ' + status + '">' + esc(status) + '</span></div>' + decisionHtml + '</div>';
    }).join('');
  }

  function renderBuilds() {
    const c = el('builds-content');
    if (!state.builds.length) { c.innerHTML = '<span class="dim">No active builds</span>'; return; }
    c.innerHTML = state.builds.map(b => {
      const pct = Math.round(b.progress?.percentComplete ?? b.progress ?? b.percentComplete ?? 0);
      const name = b.name || b.id || 'build';
      const type = b.type ? ' (' + esc(b.type) + ')' : '';
      return '<div style="margin-bottom:8px;"><div class="row"><span>' + esc(name) + type + '</span><span class="metric-val">' + pct + '%</span></div><div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div></div>';
    }).join('');
  }

  function renderResources() {
    const c = el('resources-content');
    if (!state.resources.length) { c.innerHTML = '<span class="dim">No resource data</span>'; return; }
    c.innerHTML = state.resources.map(r => {
      const qty = r.quantity ?? r.level ?? 0;
      const type = r.resourceType ?? r.type ?? 'unknown';
      return '<div class="row"><span>' + esc(type) + '</span><span class="metric-val">' + qty + '</span></div>';
    }).join('');
  }

  function renderTasks() {
    const c = el('tasks-content');
    if (!state.tasks.length) { c.innerHTML = '<span class="dim">No tasks</span>'; return; }
    c.innerHTML = state.tasks.slice(0, 8).map(t => {
      const status = t.status ?? 'unknown';
      const cls = status === 'completed' ? 'ok' : status === 'failed' ? 'err' : 'warn';
      return '<div class="row"><span style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(t.type || t.id || 'task') + '</span><span class="badge ' + cls + '">' + esc(status) + '</span></div>';
    }).join('');
  }

  function renderMetrics() {
    const c = el('metrics-content');
    if (!state.metrics) { c.innerHTML = '<span class="dim">No metrics</span>'; return; }
    const m = state.metrics;
    c.innerHTML = [
      '<div class="row"><span>Task completion rate</span><span class="metric-val">' + (m.taskCompletionRate ?? 0) + '/min</span></div>',
      '<div class="row"><span>Blocks placed/hr</span><span class="metric-val">' + (m.blocksPlacedPerHour ?? 0) + '</span></div>',
    ].join('');
  }

  function renderHealth() {
    const c = el('health-content');
    const oh = el('health-overall');
    if (!state.health) { c.innerHTML = '<span class="dim">No health data</span>'; return; }
    const overall = state.health.overall ?? 'unknown';
    const cls = overall === 'healthy' ? 'ok' : overall === 'degraded' ? 'warn' : 'err';
    oh.innerHTML = 'Overall: <span class="' + cls + '">' + overall.toUpperCase() + '</span>';
    if (!state.health.checks?.length) { c.innerHTML = '<span class="dim">No checks run yet</span>'; return; }
    c.innerHTML = state.health.checks.map(ch => {
      const s = ch.status ?? 'unknown';
      return '<div class="row"><span>' + esc(ch.component) + '</span><span class="badge ' + s + '">' + s + '</span></div>';
    }).join('');
  }

  function renderAlerts() {
    const c = el('alerts-content');
    if (!state.alerts.length) { c.innerHTML = '<span class="dim">No alerts</span>'; return; }
    c.innerHTML = state.alerts.slice(0, 10).map(a => {
      const t = new Date(a.time).toLocaleTimeString();
      return '<div class="alert-item ' + esc(a.severity) + '">[' + t + '] ' + esc(a.message) + '</div>';
    }).join('');
  }

  function renderBots() {
    const c = el('bots-content');
    if (!state.bots.size) { c.innerHTML = '<span class="dim">No bots connected</span>'; return; }
    const rows = [];
    state.bots.forEach((v, k) => {
      const cls = v.connected ? 'ok' : 'err';
      const label = v.connected ? 'online' : 'offline';
      rows.push('<div class="row"><span>' + esc(k) + '</span><span class="badge ' + cls + '">' + label + '</span></div>');
    });
    c.innerHTML = rows.join('');
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── System controls ────────────────────────────────────────────────
  window.sysAction = async function(action) {
    const msg = el('sys-msg');
    msg.textContent = 'Sending ' + action + '...';
    try {
      const r = await fetch(API_BASE + '/system/' + action, { method: 'POST', headers: HEADERS });
      const data = await r.json();
      msg.textContent = data.message ?? JSON.stringify(data);
      setTimeout(() => { msg.textContent = ''; }, 3000);
    } catch (e) { msg.textContent = 'Error: ' + e.message; }
  };

  window.setMode = async function() {
    const mode = document.getElementById('mode-select').value;
    const msg = el('sys-msg');
    try {
      const r = await fetch(API_BASE + '/system/mode', { method: 'POST', headers: HEADERS, body: JSON.stringify({ mode }) });
      const data = await r.json();
      msg.textContent = data.message ?? JSON.stringify(data);
      setTimeout(() => { msg.textContent = ''; }, 3000);
    } catch (e) { msg.textContent = 'Error: ' + e.message; }
  };

  // ── Boot ───────────────────────────────────────────────────────────
  connectWS();
  fetchAll();
  setInterval(fetchAll, 5000);
})();
</script>
</body>
</html>`;
}

export function createDashboardApp(options: DashboardAppOptions): DashboardApp {
  const { config, logger } = options;
  const port = config.controlCentre.port;
  let server: http.Server | null = null;
  let running = false;

  const html = generateDashboardHtml(config.api.port, config.api.apiKey);

  const requestHandler: http.RequestListener = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(html);
  };

  return {
    get isRunning() { return running; },
    get port() { return port; },
    async start() {
      if (running) { logger.warn('Dashboard app is already running'); return; }
      server = http.createServer(requestHandler);
      await new Promise<void>((resolve, reject) => {
        server!.on('error', reject);
        server!.listen(port, () => { running = true; logger.info(`Control Centre dashboard started on port ${port}`); resolve(); });
      });
    },
    async stop() {
      if (!running || !server) { logger.warn('Dashboard app is not running'); return; }
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => {
          if (err) { reject(err); } else { running = false; server = null; logger.info('Control Centre dashboard stopped'); resolve(); }
        });
      });
    },
  };
}
