// =====================================================================
// Storage Health — NOC (Dell PowerEdge / PERC / MegaCLI)
// Plugin: HTML graphics (gapit-htmlgraphics-panel) — onRender
// Fonte: Zabbix (alexanderzobnin-zabbix-datasource)
//   Hosts: /.*/
//   Itens: /^(SSD .*: .*|Slot .*: (Erros de midia|Outros erros|Falhas previstas)|BBU .*: (Carga|Temperatura))$/
// Configuração (modelo, controladora, RAID, limiares) em "Code data".
// =====================================================================
const ROOT = htmlNode.getElementById('sh-root');
if (!ROOT) return;

/* ---------- configuração ---------- */
let CD = typeof codeData !== 'undefined' ? codeData : {};
if (typeof CD === 'string') { try { CD = JSON.parse(CD); } catch (e) { CD = {}; } }
CD = CD || {};
const TH = Object.assign({
  tempWarn: 45, tempCrit: 55, lifeWarn: 80, lifeCrit: 20,
  bbuChargeWarn: 80, bbuChargeCrit: 50, bbuTempWarn: 45, bbuTempCrit: 55, staleMinutes: 15
}, CD.thresholds || {});
const HDEF = Object.assign({
  modelo: 'Dell PowerEdge', controladora: 'PERC H700', firmware: '', raid: '—', capacidade: '—',
  composicao: '', cachePadrao: 'WriteBack', vd: 'Virtual Disk 0'
}, CD.defaultHost || {});
const HINFO = h => Object.assign({}, HDEF, (CD.hosts || {})[h] || {});
const PROB_RX = new RegExp(CD.problemFilter || 'BBU|Bateria|Battery|SSD|Slot|Disk|Disco|RAID|PERC|MegaCLI|Cache|WriteThrough|Virtual|Controladora|Controller|SMART|Media|Predictive', 'i');
const RX_BBU = /bbu|bateria|battery/i;
const RX_CACHE = /write\s*-?\s*through|cache/i;
const RX_VOL = /(virtual\s*disk|volume|\bvd\b|\bld\b|raid|array).*(degrad|offline|fail|falha|partial|parcial|rebuild)/i;
const SERIES_COLORS = ['#FF9830', '#5794F2', '#F2CC0C', '#73BF69', '#B877D9', '#8AB8FF', '#FF7383', '#56A64B', '#FADE2A', '#CA95E5'];
const C = { ok: '#73BF69', warn: '#FF9830', crit: '#F2495C', info: '#5794F2', txt: '#F4F5F7' };

/* ---------- estado da UI (persiste entre refreshes) ---------- */
const ST = htmlNode.__shState || (htmlNode.__shState = { hosts: null, disk: 'all' });

/* ---------- utilidades ---------- */
const toArr = v => (v == null ? [] : Array.isArray(v) ? v : typeof v.toArray === 'function' ? v.toArray() : Array.from(v));
const num = v => (v == null || v === '' ? null : typeof v === 'number' ? v : (isNaN(parseFloat(v)) ? null : parseFloat(v)));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pad2 = n => String(n).padStart(2, '0');
const hhmm = t => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
const hhmmss = t => { const d = new Date(t); return hhmm(t) + ':' + pad2(d.getSeconds()); };
const ago = t => {
  if (!t) return '—';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'há ' + Math.round(s) + ' s';
  if (s < 3600) return 'há ' + Math.round(s / 60) + ' min';
  if (s < 86400) return 'há ' + Math.floor(s / 3600) + 'h ' + Math.round((s % 3600) / 60) + 'm';
  return 'há ' + Math.floor(s / 86400) + 'd';
};
const age = t => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};
const dayLbl = t => {
  const d = new Date(t), n = new Date();
  return d.toDateString() === n.toDateString() ? 'Hoje às ' + hhmmss(t) : d.toLocaleDateString('pt-BR') + ' ' + hhmmss(t);
};
const tempCls = v => (v == null ? '' : v >= TH.tempCrit ? 'c-crit' : v >= TH.tempWarn ? 'c-warn' : '');
const lifeColor = v => (v == null ? '#4D5358' : v < TH.lifeCrit ? C.crit : v < TH.lifeWarn ? C.warn : C.ok);
const lifeCls = v => (v == null ? '' : v < TH.lifeCrit ? 'c-crit' : v < TH.lifeWarn ? 'c-warn' : 'c-ok');
const shortHost = h => String(h).replace(/^node/i, '');

const I = (() => {
  const p = {
    server: '<rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/><path d="M7 7h.01M7 17h.01"/>',
    disk: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 14h.01M11 14h6"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    battery: '<rect x="7" y="4" width="10" height="17" rx="1.5"/><path d="M10 2h4M10 14h4"/>',
    gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
    thermo: '<path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0z"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2 6"/><path d="M20 4v7h-7"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
    term: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16h.01"/>',
    pct: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="1"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>',
    check: '<path d="M5 12l5 5 9-10"/>'
  };
  return (n, cls = '', style = '') => `<svg class="ic ${cls}" style="${style}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p[n] || ''}</svg>`;
})();

/* ---------- leitura dos frames do Zabbix ---------- */
const ITEM_RX = /^(?:(.+?):\s)?((?:SSD|Slot|BBU)\s.+)$/;
const seriesMap = new Map();
const problemsRaw = [];
const frames = (data && data.series) || [];
for (const fr of frames) {
  const fields = fr.fields || [];
  const tf = fields.find(f => f.type === 'time');
  const times = tf ? toArr(tf.values) : [];
  for (const f of fields) {
    if (f === tf) continue;
    const vals = toArr(f.values);
    const firstObj = vals.find(v => v && typeof v === 'object');
    if (firstObj && ('triggerid' in firstObj || 'eventid' in firstObj || 'severity' in firstObj || 'priority' in firstObj)) {
      vals.forEach(v => v && typeof v === 'object' && problemsRaw.push(v));
      continue;
    }
    const lb = f.labels || {};
    const cfg = f.config || {};
    const cands = [];
    if (lb.item) cands.push((lb.host ? lb.host + ': ' : '') + lb.item);
    [cfg.displayNameFromDS, cfg.displayName, f.state && f.state.displayName, fr.name, f.name].forEach(c => c && cands.push(String(c)));
    let host = lb.host || null, item = null;
    for (const c of cands) {
      const m = c.match(ITEM_RX);
      if (m) { item = m[2].trim(); if (!host && m[1]) host = m[1].trim(); break; }
    }
    if (!item) continue;
    host = host || CD.defaultHostName || 'zabbix-host';
    const pts = [];
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (v === null || v === undefined || v === '' || (typeof v === 'number' && isNaN(v))) continue;
      pts.push([times[i] != null ? +times[i] : Date.now(), v]);
    }
    pts.sort((a, b) => a[0] - b[0]);
    const s = {
      host, item, pts,
      last: pts.length ? pts[pts.length - 1][1] : null,
      lastTs: pts.length ? pts[pts.length - 1][0] : 0,
      first: pts.length ? pts[0][1] : null
    };
    const key = host + '\u0000' + item;
    const prev = seriesMap.get(key);
    if (!prev || s.lastTs >= prev.lastTs) seriesMap.set(key, s);
  }
}

/* ---------- modelo: hosts → discos / slots / BBUs ---------- */
const HOSTS = new Map();
const H = h => {
  if (!HOSTS.has(h)) HOSTS.set(h, { name: h, disks: new Map(), bbus: new Map(), items: 0, lastTs: 0 });
  return HOSTS.get(h);
};
const slotId = k => {
  const s = String(k).trim();
  const m = s.match(/\[\s*\d+\s*:\s*(\d+)\s*\]/) || s.match(/\d+\s*:\s*(\d+)\s*$/) || s.match(/(\d+)(?!.*\d)/);
  return m ? m[1] : s;
};
const D = (host, key) => {
  const h = H(host), id = slotId(key);
  if (!h.disks.has(id)) h.disks.set(id, { host, id, m: {}, extra: {} });
  return h.disks.get(id);
};
const METRICS = [
  ['temp', /temp/i],
  ['poh', /horas|hours|\bpoh\b|power.?on|ligad/i],
  ['realloc', /realoc|realloc/i],
  ['uncorr', /incorrig|uncorrect|irrecuper/i],
  ['pending', /pend/i],
  ['crc', /crc|udma/i],
  ['powerloss', /energia|power.?loss|unexpected|unsafe|desligamento/i],
  ['progerase', /program|erase/i],
  ['life', /vida|life|wear|mwi|desgaste|restante|remaining|endurance/i],
  ['serial', /s[eé]rie|serial|\bsn\b/i],
  ['model', /modelo|model|produto|product/i],
  ['fw', /firmware|\bfw\b/i],
  ['size', /capacidade|size|tamanho/i],
  ['state', /estado|status|state|condi/i]
];
for (const s of seriesMap.values()) {
  const h = H(s.host);
  h.items++;
  h.lastTs = Math.max(h.lastTs, s.lastTs);
  let m;
  if ((m = s.item.match(/^SSD\s+(.+?):\s+(.+)$/))) {
    const d = D(s.host, m[1]);
    d.label = d.label || m[1];
    const metric = m[2];
    const hit = METRICS.find(([, rx]) => rx.test(metric));
    if (hit) {
      const k = hit[0];
      if (k === 'life' && /usad|used|consum|gast/i.test(metric) && !/restante|remaining|left/i.test(metric)) {
        d.m.life = Object.assign({}, s, { inv: true });
      } else d.m[k] = s;
    } else d.extra[metric] = s;
  } else if ((m = s.item.match(/^Slot\s+(.+?):\s+(.+)$/))) {
    const d = D(s.host, m[1]);
    const metric = m[2];
    if (/m[ií]dia/i.test(metric)) d.m.media = s;
    else if (/outros/i.test(metric)) d.m.other = s;
    else if (/previst/i.test(metric)) d.m.pred = s;
  } else if ((m = s.item.match(/^BBU\s+(.+?):\s+(.+)$/))) {
    const id = m[1].trim();
    if (!h.bbus.has(id)) h.bbus.set(id, { host: s.host, id, m: {} });
    const b = h.bbus.get(id);
    if (/carga|charge/i.test(m[2])) b.m.charge = s;
    else if (/temp/i.test(m[2])) b.m.temp = s;
  }
}
const V = (d, k) => {
  const s = d.m[k];
  if (!s) return null;
  const v = num(s.last);
  return v == null ? null : s.inv ? 100 - v : v;
};
const T = (d, k) => (d.m[k] && d.m[k].last != null ? String(d.m[k].last) : null);
const DELTA = (d, k) => { const s = d.m[k]; if (!s) return null; const a = num(s.first), b = num(s.last); return a == null || b == null ? null : b - a; };
const PTS = (s, inv) => (s ? s.pts.map(p => [p[0], inv ? 100 - num(p[1]) : num(p[1])]).filter(p => p[1] != null) : []);

/* ---------- problemas do Zabbix ---------- */
const PROBLEMS = problemsRaw.map(p => {
  const hosts = (p.hosts || []).map(x => x.name || x.host).filter(Boolean);
  if (p.host) hosts.push(p.host);
  if (p.hostTechName) hosts.push(p.hostTechName);
  let ts = +(p.lastchangeUnix || p.lastchange || p.timestamp || p.clock || 0);
  if (ts && ts < 1e12) ts *= 1000;
  return { hosts: [...new Set(hosts)], sev: +(p.severity != null ? p.severity : p.priority != null ? p.priority : 0), desc: p.name || p.description || '', ts, ack: p.acknowledged };
}).filter(p => p.desc && PROB_RX.test(p.desc));

/* ---------- filtros ---------- */
const ALL_HOSTS = [...HOSTS.keys()].sort((a, b) => a.localeCompare(b));
if (ST.hosts) ST.hosts = ST.hosts.filter(h => HOSTS.has(h));
const SEL = (ST.hosts && ST.hosts.length ? ST.hosts : ALL_HOSTS).slice();
const selHosts = SEL.map(h => HOSTS.get(h));
const sortDisks = h => [...h.disks.values()].sort((a, b) => (isNaN(a.id) || isNaN(b.id) ? String(a.id).localeCompare(String(b.id)) : a.id - b.id));
const ALL_DISKS = selHosts.flatMap(sortDisks);
const DISKS = ST.disk === 'all' ? ALL_DISKS : ALL_DISKS.filter(d => d.host + '#' + d.id === ST.disk);
const hostProblems = (h, rx) => PROBLEMS.filter(p => p.hosts.includes(h) && (!rx || rx.test(p.desc)));
const BBUS = selHosts.flatMap(h => [...h.bbus.values()]);

/* ---------- derivações ---------- */
const diskState = d => {
  const st = T(d, 'state');
  const pred = V(d, 'pred'), media = V(d, 'media'), life = V(d, 'life'), temp = V(d, 'temp');
  if (st) {
    if (/online|optimal|ok|ativo|normal|spun up|jbod|hot.?spare/i.test(st) && !/fail|offline|missing|falha|bad/i.test(st)) {
      if ((pred || 0) > 0) return { txt: 'PRED. FAIL', cls: 'crit' };
      return { txt: /hot.?spare/i.test(st) ? 'HOT-SPARE' : 'ONLINE', cls: 'ok' };
    }
    if (/rebuild|copyback|reconstr/i.test(st)) return { txt: 'REBUILD', cls: 'warn' };
    return { txt: st.split(/[,(]/)[0].trim().toUpperCase().slice(0, 14), cls: 'crit' };
  }
  if ((pred || 0) > 0) return { txt: 'PRED. FAIL', cls: 'crit' };
  if ((life != null && life < TH.lifeCrit) || (temp != null && temp >= TH.tempCrit)) return { txt: 'CRÍTICO', cls: 'crit' };
  if ((media || 0) > 0) return { txt: 'ATENÇÃO', cls: 'warn' };
  if (!Object.keys(d.m).length) return { txt: 'SEM DADOS', cls: 'mute' };
  return { txt: 'ONLINE', cls: 'ok' };
};
const isOnline = d => diskState(d).cls === 'ok';
const bbuState = b => {
  const ch = num(b.m.charge && b.m.charge.last), tp = num(b.m.temp && b.m.temp.last);
  const prob = hostProblems(b.host, RX_BBU).length > 0;
  const failed = prob || (ch != null && ch < TH.bbuChargeCrit) || (tp != null && tp >= TH.bbuTempCrit);
  const degraded = !failed && ((ch != null && ch < TH.bbuChargeWarn) || (tp != null && tp >= TH.bbuTempWarn));
  return { ch, tp, prob, failed, degraded };
};
const hostCtl = h => {
  const bb = [...h.bbus.values()].map(bbuState);
  const bbuFailed = bb.some(x => x.failed);
  const bbuDeg = bb.some(x => x.degraded);
  const cacheProb = hostProblems(h.name, RX_CACHE).length > 0;
  const volProbs = hostProblems(h.name, RX_VOL).filter(p => !RX_CACHE.test(p.desc));
  const disks = sortDisks(h);
  const online = disks.filter(isOnline).length;
  const volBad = volProbs.length > 0 || disks.some(d => diskState(d).cls === 'crit');
  const info = HINFO(h.name);
  const writeThrough = cacheProb || bbuFailed;
  return { bb, bbuFailed, bbuDeg, cacheProb, volProbs, disks, online, volBad, info, writeThrough, cacheNow: writeThrough ? 'WriteThrough' : info.cachePadrao };
};

/* ---------- componentes ---------- */
const kpi = (label, icon, acc, value, unit, extra, foot, footR, alert) => `
  <div class="kpi${alert ? ' alert' : ''}" style="--acc:${acc}">
    <div class="kpi-h"><span class="caps" style="color:${alert ? C.crit : ''}">${label}</span>${I(icon)}</div>
    <div class="kpi-v"><span class="big" style="color:${value.color || C.txt}">${value.v}</span><span class="u">${unit || ''}</span>${extra || ''}</div>
    <div class="kpi-f"><span>${foot || ''}</span><span class="dim">${footR || ''}</span></div>
  </div>`;
const bar = (pct, color) => `<div class="bar-t"><i style="width:${Math.max(0, Math.min(100, pct || 0))}%;background:${color}"></i></div>`;

const CHARTS = [];
const chart = spec => { CHARTS.push(spec); return `<div class="chart" data-chart="${CHARTS.length - 1}" style="height:${spec.h || 150}px"></div>`; };

const tr = (data && data.timeRange) || null;
const ALL_TS = [...seriesMap.values()].flatMap(s => s.pts.map(p => p[0]));
const T0 = tr && tr.from ? +tr.from.valueOf() : ALL_TS.length ? Math.min(...ALL_TS) : Date.now() - 6 * 3600e3;
const T1 = tr && tr.to ? +tr.to.valueOf() : Date.now();
const LAST_TS = Math.max(0, ...selHosts.map(h => h.lastTs));
const STALE = !LAST_TS || Date.now() - LAST_TS > TH.staleMinutes * 60e3;

/* =========================== RENDER =========================== */
function render() {
  CHARTS.length = 0;
  if (!HOSTS.size) {
    ROOT.innerHTML = `<div class="nodata">${I('warn', '', 'width:28px;height:28px;color:#FF9830')}<br/><br/>
      Nenhum item encontrado.<br/>Verifique a consulta Zabbix (hosts <b>/.*/</b> e o regex de itens SSD / Slot / BBU)<br/>e se o período selecionado contém dados.</div>`;
    return;
  }
  const H_CTL = new Map(selHosts.map(h => [h.name, hostCtl(h)]));
  const ctls = [...H_CTL.values()];

  /* ---- KPIs ---- */
  const lifeVals = DISKS.map(d => ({ d, v: V(d, 'life') })).filter(x => x.v != null);
  const tempVals = DISKS.map(d => ({ d, v: V(d, 'temp') })).filter(x => x.v != null);
  const minLife = lifeVals.length ? lifeVals.reduce((a, b) => (b.v < a.v ? b : a)) : null;
  const maxTemp = tempVals.length ? tempVals.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const volOut = ctls.filter(c => c.volBad).length;
  const bbuSt = BBUS.map(bbuState);
  const bbuFail = bbuSt.filter(b => b.failed).length;
  const perHostCount = selHosts.map(h => h.disks.size + ' ' + shortHost(h.name).replace(/dc\d+$/i, '')).join(' + ');
  const models = [...new Set(DISKS.map(d => T(d, 'model')).filter(Boolean))];

  const kpis = `<div class="grid6">
    ${kpi('Servidores selecionados', 'server', C.info, { v: selHosts.length }, 'hosts', '', esc(SEL.join(' / ')), '')}
    ${kpi('Discos descobertos', 'disk', C.info, { v: ALL_DISKS.length }, 'SSDs', '', esc(perHostCount), esc(models[0] || ''))}
    ${kpi('Volumes fora de optimal', 'shield', volOut ? C.crit : C.ok, { v: volOut, color: volOut ? C.crit : C.ok }, '',
      volOut ? '<span class="bdg crit">DEGRADADO</span>' : '<span class="bdg solidok">100% OK</span>',
      volOut ? `<span class="c-crit">● ${volOut} volume(s) com alerta</span>` : '<span class="c-ok">● Todos os volumes Optimal</span>', '')}
    ${kpi('Baterias com falha', 'battery', bbuFail ? C.crit : C.ok, { v: bbuFail, color: bbuFail ? C.crit : C.ok }, '',
      bbuFail ? '<span class="bdg crit">CRÍTICO</span>' : BBUS.length ? '<span class="bdg solidok">OK</span>' : '',
      bbuFail ? `<span class="c-crit">Substituição Necessária (${bbuFail}/${BBUS.length})</span>` : BBUS.length ? `<span class="c-ok">${BBUS.length}/${BBUS.length} baterias saudáveis</span>` : '<span class="dim">Sem itens BBU</span>', '', bbuFail > 0)}
    ${kpi('Menor vida (SSD)', 'gauge', minLife ? lifeColor(minLife.v) : C.info, { v: minLife ? fmtN(minLife.v) + '%' : '—', color: minLife ? lifeColor(minLife.v) : C.txt }, minLife ? `&gt;${TH.lifeCrit}% Limiar` : '', '',
      minLife ? `<span class="dim">${esc(minLife.d.host)} (Slot ${esc(minLife.d.id)})</span>` : '<span class="dim">Sem item de vida</span>', '')}
    ${kpi('Maior temp. SSD', 'thermo', maxTemp ? (maxTemp.v >= TH.tempCrit ? C.crit : maxTemp.v >= TH.tempWarn ? C.warn : C.ok) : C.info,
      { v: maxTemp ? fmtN(maxTemp.v) + ' °C' : '—', color: maxTemp ? (maxTemp.v >= TH.tempCrit ? C.crit : maxTemp.v >= TH.tempWarn ? C.warn : C.ok) : C.txt },
      maxTemp ? (maxTemp.v >= TH.tempCrit ? `≥ ${TH.tempCrit} °C Crítico` : maxTemp.v >= TH.tempWarn ? `≥ ${TH.tempWarn} °C Atenção` : `&lt; ${TH.tempCrit} °C Normal`) : '', '',
      maxTemp ? `<span class="dim">${esc(maxTemp.d.host)} (Slot ${esc(maxTemp.d.id)})</span>` : '', '')}
  </div>`;

  /* ---- barra de filtros ---- */
  const diskOpts = [`<option value="all">Todos os discos (${ALL_DISKS.length})</option>`]
    .concat(ALL_DISKS.map(d => `<option value="${esc(d.host + '#' + d.id)}" ${ST.disk === d.host + '#' + d.id ? 'selected' : ''}>${esc(d.host)} · Slot ${esc(d.id)}</option>`)).join('');
  let refresh = '';
  try { refresh = new URLSearchParams(window.location.search).get('refresh') || ''; } catch (e) { /* ignore */ }
  const rangeTxt = (() => {
    const r = tr && tr.raw;
    if (r && typeof r.from === 'string' && /^now-/.test(r.from) && r.to === 'now') {
      const m = r.from.match(/^now-(\d+)([smhdwMy])$/);
      if (m) return `Últimas ${m[1]} ${{ s: 'seg', m: 'min', h: 'horas', d: 'dias', w: 'semanas', M: 'meses', y: 'anos' }[m[2]]}`;
    }
    return `${new Date(T0).toLocaleString('pt-BR')} → ${new Date(T1).toLocaleString('pt-BR')}`;
  })();
  const toolbar = `
  <div class="bar stack">
    <div class="row">
      <span class="ctl"><span class="caps lab">Servidores:</span>
        ${ALL_HOSTS.map(h => `<span class="chip ${SEL.includes(h) ? 'on' : ''}" data-act="host" data-h="${esc(h)}">${SEL.includes(h) ? '✓' : ''} ${esc(h)}</span>`).join('')}
      </span>
      <span class="ctl"><span class="caps lab">Disco:</span><select class="sel" data-act="disk">${diskOpts}</select></span>
      <span class="ctl"><span class="caps lab">Período:</span><span class="pill">${esc(rangeTxt)}</span></span>
      <span class="sp"></span>
      ${STALE ? '<span class="bdg crit">● COLETOR ATRASADO</span>' : '<span class="bdg solidok">● COLETOR ATIVO</span>'}
      <span class="mono dim">Último poll: ${LAST_TS ? hhmmss(LAST_TS) : '—'}</span>
    </div>
    <div class="row">
      ${STALE ? `<span class="bdg warn">● DADOS DESATUALIZADOS (&gt; ${TH.staleMinutes} min)</span>` : '<span class="bdg ok">● DADOS ATUALIZADOS / MEGACLI OK</span>'}
      <span class="mono dim">Última coleta controladora: <b class="hi">${LAST_TS ? dayLbl(LAST_TS) : '—'}</b> (${ago(LAST_TS)})</span>
      <button class="btn" data-act="refresh">${I('refresh', '', 'width:13px;height:13px')} Atualizar agora</button>
      <span class="mono dim3">Auto-refresh: ${esc(refresh || 'off')}</span>
    </div>
  </div>`;

  /* ---- cards de host ---- */
  const hostCards = `<div class="grid2">${selHosts.map(h => {
    const c = H_CTL.get(h.name), inf = c.info;
    const n = c.disks.length;
    const pct = n ? Math.round(c.online / n * 100) : 0;
    const bbuBadge = !h.bbus.size ? '<span class="bdg mute">SEM BBU</span>'
      : c.bbuFailed ? `<span class="bdg crit">${I('alert', '', 'width:11px;height:11px')} BBU FAILED</span> <span class="c-crit">Substituição Obrigatória</span>`
      : c.bbuDeg ? '<span class="bdg warn">BBU DEGRADADA</span> <span class="c-warn">Verificar ciclo de aprendizado</span>'
      : '<span class="bdg ok">BBU OK</span> <span class="c-ok">Bateria saudável</span>';
    return `<div class="pnl hc">
      <div class="hc-h">${I('server', '', 'color:#D8D9DA')}<span class="nm">${esc(h.name)}</span><span class="mono dim">${esc(inf.modelo)}</span><span class="sp"></span>
        <span class="pill" style="color:#aac7ff">${esc(inf.controladora)}${inf.firmware ? ' (FW: ' + esc(inf.firmware) + ')' : ''}</span></div>
      <div class="hc-b">
        <div><div class="caps dim" style="margin-bottom:4px">Volume RAID principal</div>
          <div class="kv">${c.volBad ? '<span class="bdg critl">Degraded</span>' : '<span class="bdg ok" style="text-transform:none">Optimal</span>'} <b class="hi">${esc(inf.raid)}</b></div>
          <div class="kv dim">Capacidade: <b class="hi">${esc(inf.capacidade)}</b>${inf.composicao ? ' (' + esc(inf.composicao) + ')' : ''}</div>
          <div class="kv ${pct === 100 ? 'c-ok' : 'c-warn'}">${n} Discos Descobertos / ${c.online} Online (${pct}%)</div>
        </div>
        <div><div class="caps dim" style="margin-bottom:4px">Controladora &amp; cache</div>
          <div class="kv">${bbuBadge}</div>
          <div class="kv dim">Cache: <span class="bdg ${c.writeThrough ? 'warn' : 'ok'}" style="text-transform:none">${esc(c.cacheNow)}</span> (Padrão: ${esc(inf.cachePadrao)})</div>
          ${c.writeThrough ? `<div class="kv c-warn">${c.bbuFailed ? 'Downgrade de segurança ativado por falha na BBU' : 'Política de cache degradada (trigger ativa)'}</div>` : '<div class="kv c-ok">Cache de escrita protegido por BBU</div>'}
        </div>
      </div>
      <div class="hc-f"><span><span class="dot ${Date.now() - h.lastTs > TH.staleMinutes * 60e3 ? 'crit' : ''}"></span> MegaCLI Zabbix Agent — ${h.items} itens de storage</span><span>Poll síncrono: ${ago(h.lastTs)}</span></div>
    </div>`;
  }).join('')}</div>
  <div class="note">${I('info', '', 'width:13px;height:13px')} Aviso: A saúde dos componentes é independente (Volume Optimal vs BBU Failed). Estados correspondem à última coleta síncrona via MegaCLI.</div>`;

  /* ---- mapa de slots ---- */
  const slotMap = `<div class="pnl">
    <div class="ph"><h2>${I('chip', '', 'color:#D8D9DA')} Mapeamento de Baias &amp; Slots Lógicos da PERC</h2><span class="sp"></span>
      <span class="mono dim" style="font-size:11px">Slots reportados pela controladora (numeração lógica de hardware, não reflete necessariamente posição física de baias)</span></div>
    ${selHosts.map((h, hi) => {
      const ds = sortDisks(h).filter(d => ST.disk === 'all' || ST.disk === d.host + '#' + d.id);
      if (!ds.length) return '';
      return `<div class="hostlbl"><span class="dot" style="background:${hi % 2 ? C.info : '#D8D9DA'}"></span>${esc(h.name)} <span class="dim">— ${h.disks.size} Slots Reportados (${sortDisks(h).map(d => esc(d.id)).join(', ')})</span></div>
      <div class="grid4">${ds.map(d => {
        const st = diskState(d), life = V(d, 'life'), temp = V(d, 'temp');
        return `<div class="slot ${st.cls === 'crit' ? 'crit' : st.cls === 'warn' ? 'warn' : ''}">
          <div class="t">Slot ${esc(d.id)}<span class="bdg ${st.cls}">${esc(st.txt)}</span></div>
          <div class="sn" title="${esc(T(d, 'serial') || d.label || '')}">${esc(T(d, 'serial') || T(d, 'model') || 'SSD ' + (d.label || d.id))}</div>
          <div class="m"><span class="dim">Temp: <b class="hi ${tempCls(temp)}">${temp == null ? '—' : fmtN(temp) + ' °C'}</b></span>
            <span class="dim">Vida: <b class="${lifeCls(life)}">${life == null ? '—' : fmtN(life) + '%'}</b></span></div>
          ${bar(life, lifeColor(life))}
        </div>`;
      }).join('')}</div>`;
    }).join('')}
  </div>`;

  /* ---- gráficos SSD ---- */
  const dName = d => `${shortHost(d.host)}-s${d.id}`;
  const tempSeries = DISKS.filter(d => d.m.temp).map((d, i) => ({ name: dName(d), color: SERIES_COLORS[i % SERIES_COLORS.length], pts: PTS(d.m.temp), unit: '°C' }));
  const lifeSeries = DISKS.filter(d => d.m.life).map((d, i) => ({ name: dName(d), color: SERIES_COLORS[(i + 3) % SERIES_COLORS.length], pts: PTS(d.m.life, d.m.life.inv), unit: '%' }));
  const tAll = tempSeries.flatMap(s => s.pts.map(p => p[1]));
  const tMin = Math.min(25, ...(tAll.length ? [Math.floor((Math.min(...tAll) - 5) / 10) * 10] : [25]));
  const tMax = Math.max(TH.tempCrit + 5, ...(tAll.length ? [Math.ceil((Math.max(...tAll) + 5) / 5) * 5] : [60]));
  const legend = ss => `<div class="legend">${ss.slice().sort((a, b) => (b.pts.length ? b.pts[b.pts.length - 1][1] : 0) - (a.pts.length ? a.pts[a.pts.length - 1][1] : 0))
    .map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}: ${s.pts.length ? fmtN(s.pts[s.pts.length - 1][1]) : '—'}${s.unit === '%' ? '%' : s.unit}</span>`).join('')}</div>`;
  const ssdCharts = `<div class="grid2">
    <div class="pnl"><div class="ph"><h2>${I('thermo', '', 'color:#FF9830')} Temperatura dos SSDs ao Longo do Tempo (°C)</h2><span class="sp"></span><span class="pill warn">Limiar Crítico: ${TH.tempCrit} °C</span></div>
      ${chart({ series: tempSeries, yMin: tMin, yMax: tMax, step: 10, unit: '°C', h: 160, th: [{ v: TH.tempCrit, label: `Threshold ${TH.tempCrit} °C`, color: C.crit }] })}
      ${legend(tempSeries)}</div>
    <div class="pnl"><div class="ph"><h2>${I('pct', '', 'color:#5794F2')} Vida Restante Estimada dos SSDs (% MWI)</h2><span class="sp"></span><span class="pill warn">Alerta Desgaste: &lt; ${TH.lifeCrit}%</span></div>
      ${chart({ series: lifeSeries, yMin: 0, yMax: 100, ticks: [TH.lifeCrit, 50, 75, 100], unit: '%', h: 160, th: [{ v: TH.lifeCrit, label: `${TH.lifeCrit}% Limiar Troca`, color: C.warn }] })}
      ${legend(lifeSeries)}</div>
  </div>
  <div class="note">${I('info', '', 'width:13px;height:13px')} Nota técnica: A vida restante é calculada a partir do atributo SMART Media Wearout Indicator dos SSDs. Não representa espaço em disco livre/utilizado.</div>`;

  /* ---- inventário ---- */
  const inventory = `<div class="pnl">
    <div class="ph"><h2>Inventário e Telemetria Detalhada dos ${DISKS.length} SSDs</h2><span class="sp"></span><span class="mono dim">Smartctl / MegaCLI -adpallinfo / -pdlist -aALL</span></div>
    <div class="tablewrap"><table class="tb"><thead><tr><th>Servidor</th><th>Slot lógico</th><th>Número de série</th><th>Estado</th><th>Temperatura</th><th>Vida útil restante</th><th>Horas ligado (POH)</th></tr></thead><tbody>
    ${DISKS.length ? DISKS.map(d => {
      const st = diskState(d), life = V(d, 'life'), temp = V(d, 'temp'), poh = V(d, 'poh');
      return `<tr><td class="h">${esc(d.host)}</td><td class="l">Slot ${esc(d.id)}</td><td>${esc(T(d, 'serial') || '—')}</td>
        <td><span class="bdg ${st.cls}">${esc(st.txt)}</span></td>
        <td class="${tempCls(temp)}">${temp == null ? '—' : fmtN(temp) + ' °C'}</td>
        <td><span class="ibar">${bar(life, lifeColor(life))}<b class="${lifeCls(life)}">${life == null ? '—' : fmtN(life) + '%'}</b></span></td>
        <td class="dim">${poh == null ? '—' : fmtN(poh) + 'h'}</td></tr>`;
    }).join('') : '<tr><td colspan="7" class="empty">Nenhum disco no filtro atual</td></tr>'}
    </tbody></table></div></div>`;

  /* ---- SMART / MegaCLI ---- */
  const agg = k => {
    const ds = DISKS.filter(d => d.m[k]);
    if (!ds.length) return null;
    const tot = ds.reduce((a, d) => a + (V(d, k) || 0), 0);
    const dl = ds.reduce((a, d) => a + (DELTA(d, k) || 0), 0);
    const where = ds.filter(d => (V(d, k) || 0) > 0).map(d => `${shortHost(d.host)} s${d.id}`);
    return { tot, dl, where };
  };
  const smartDefs = [
    ['realloc', 'NAND Reallocated', 'crit', 'Nenhum bloco realocado', x => `${fmtN(x.tot)} blocos (${x.where.join(', ')})`],
    ['uncorr', 'Erros Incorrigíveis', 'crit', '0 Uncorrectable ECC', x => `ECC em ${x.where.join(', ')}`],
    ['pending', 'ECC Pendentes', 'crit', 'Current Pending Sector 0', x => `Pendentes: ${x.where.join(', ')}`],
    ['crc', 'CRC Interface (UDMA)', 'warn', 'Sem erros de interface', x => `${x.where.join(', ')} (${x.dl ? 'Δ ' + fmtN(x.dl) : 'Estável'})`],
    ['powerloss', 'Perda Inesp. Energia', 'none', 'Nenhum evento', x => 'Contador acumulado'],
    ['progerase', 'Program / Erase Fail', 'crit', 'NAND sem falha física', x => `Falha em ${x.where.join(', ')}`]
  ];
  const ctrCard = ([k, label, sev, okTxt, badTxt]) => {
    const x = agg(k);
    if (!x) return `<div class="ctr"><div class="l">${label}</div><div class="v"><b class="dim3">—</b><span></span></div><div class="s dim">Item não coletado</div></div>`;
    const bad = x.tot > 0;
    const col = !bad ? C.ok : sev === 'crit' ? C.crit : sev === 'warn' ? C.warn : C.txt;
    return `<div class="ctr"><div class="l">${label}</div><div class="v"><b style="color:${col}">${fmtN(x.tot)}</b><span>Δ ${fmtN(x.dl)}</span></div>
      <div class="s" style="color:${bad ? (sev === 'none' ? '#8E8E93' : col) : C.ok}">${esc(bad ? badTxt(x) : okTxt)}</div></div>`;
  };
  const hwDefs = [
    ['media', 'Media Error Count', 'Zero Setores Defeituosos', x => `${fmtN(x.tot)} erro(s): ${x.where.join(', ')}`],
    ['other', 'Other Error Count', 'Sem falhas de barramento', x => `${fmtN(x.tot)} erro(s): ${x.where.join(', ')}`],
    ['pred', 'Predictive Failure Count', 'Nenhum disco em SMART Trip', x => `SMART Trip: ${x.where.join(', ')}`]
  ];
  const hwCard = ([k, label, okTxt, badTxt]) => {
    const x = agg(k);
    if (!x) return `<div class="ctr wide"><div class="l">${label}</div><div class="v"><b class="dim3">—</b><span class="pill">Item não coletado</span></div></div>`;
    const bad = x.tot > 0;
    return `<div class="ctr wide"><div class="l">${label}</div><div class="v"><b style="color:${bad ? (k === 'other' ? C.warn : C.crit) : C.ok}">${fmtN(x.tot)}</b>
      <span class="pill ${bad ? 'crit' : 'ok'}">${esc(bad ? badTxt(x) : okTxt)}</span></div></div>`;
  };
  const smart = `<div class="pnl">
    <div class="ph"><h2>${I('shield', '', 'color:#D8D9DA')} Painel de Confiabilidade &amp; Telemetria SMART / MegaCLI</h2><span class="sp"></span><span class="pill dim">Exibindo contadores acumulados e variações do período (Δ)</span></div>
    <div class="caps sub" style="margin-top:0">Contadores SMART de desgaste e integridade</div>
    <div class="grid6">${smartDefs.map(ctrCard).join('')}</div>
    <div class="caps sub">Contadores de hardware da controladora (LSI MegaRAID SAS-2 / PERC)</div>
    <div class="grid3">${hwDefs.map(hwCard).join('')}</div>
  </div>`;

  /* ---- volumes virtuais ---- */
  const anyWT = ctls.some(c => c.writeThrough);
  const volumes = `<div class="pnl">
    <div class="ph"><h2>${I('grid', '', 'color:#5794F2')} Volumes Virtuais (RAID) e Políticas de Cache em Execução</h2><span class="sp"></span><span class="mono dim">MegaCLI -LDInfo -Lall -aALL</span></div>
    <div class="tablewrap"><table class="tb"><thead><tr><th>Servidor</th><th>Volume virtual</th><th>Nível RAID</th><th>Capacidade</th><th>Estado operacional</th><th>Bad blocks</th><th>Cache padrão</th><th>Cache atual efetivo</th></tr></thead><tbody>
    ${selHosts.map(h => {
      const c = H_CTL.get(h.name), inf = c.info;
      const media = c.disks.reduce((a, d) => a + (V(d, 'media') || 0), 0);
      return `<tr><td class="h">${esc(h.name)}</td><td class="l">${esc(inf.vd)}</td><td class="hi b">${esc(inf.raid)}</td><td class="hi">${esc(inf.capacidade)}</td>
        <td>${c.volBad ? '<span class="bdg critl">Degraded</span>' : '<span class="bdg ok" style="text-transform:none">Optimal</span>'}</td>
        <td class="${media ? 'c-crit' : 'c-ok'}">${media ? 'Sim (' + fmtN(media) + ')' : 'No'}</td>
        <td class="dim">${esc(inf.cachePadrao)}</td>
        <td>${c.writeThrough ? `<span class="bdg warn" style="text-transform:none">WriteThrough${c.bbuFailed ? ' (Fallback BBU)' : ''}</span>` : `<span class="bdg ok" style="text-transform:none">${esc(inf.cachePadrao)}</span>`}</td></tr>`;
    }).join('')}
    </tbody></table></div>
    ${anyWT ? `<div class="warnline">${I('warn', '', 'width:13px;height:13px')} Aviso da Controladora: Cache de escrita com downgrade automático para WriteThrough ativado para proteção contra perda de dados em falta de energia enquanto as BBUs estiverem inoperantes.</div>` : ''}
  </div>`;

  /* ---- BBU ---- */
  const gauge = (pct, color) => {
    const r = 30, cir = 2 * Math.PI * r, v = Math.max(0, Math.min(100, pct || 0));
    return `<svg width="76" height="76" viewBox="0 0 76 76"><circle cx="38" cy="38" r="${r}" fill="none" stroke="#2a2f35" stroke-width="7"/>
      <circle cx="38" cy="38" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-dasharray="${cir * v / 100} ${cir}" transform="rotate(-90 38 38)" stroke-linecap="butt"/>
      <text x="38" y="40" text-anchor="middle" fill="#F4F5F7" font-size="15" font-weight="700" font-family="Inter,sans-serif">${pct == null ? '—' : fmtN(pct) + '%'}</text>
      <text x="38" y="52" text-anchor="middle" fill="#8E8E93" font-size="7" font-family="monospace">CARGA</text></svg>`;
  };
  const bbuCards = BBUS.map(b => {
    const s = bbuState(b), inf = HINFO(b.host);
    const stTxt = s.failed ? 'FAILED' : s.degraded ? 'DEGRADADA' : 'OPTIMAL';
    const stCls = s.failed ? 'critl' : s.degraded ? 'warn' : 'ok';
    const gColor = s.failed ? (s.ch != null && s.ch >= TH.bbuChargeWarn ? C.info : C.crit) : s.degraded ? C.warn : C.ok;
    let msgT, msgS, msgC;
    if (s.prob && s.ch != null && s.ch >= TH.bbuChargeWarn) { msgT = `Atenção Operacional: Carga de ${fmtN(s.ch)}% não indica bateria saudável`; msgS = 'BBU reprovada por trigger ativa no Zabbix (impedância interna / ciclo de vida excedido no gas-gauge LSI).'; msgC = C.warn; }
    else if (s.failed) { msgT = s.ch != null && s.ch < TH.bbuChargeWarn ? 'Carga química degradada' : 'Falha de hardware da BBU'; msgS = `Retenção de buffer comprometida (limiar operacional: ${TH.bbuChargeCrit}%). Risco de perda de cache volátil.`; msgC = C.crit; }
    else if (s.degraded) { msgT = 'Bateria em degradação'; msgS = `Carga < ${TH.bbuChargeWarn}% ou temperatura ≥ ${TH.bbuTempWarn} °C. Acompanhar ciclo de aprendizado.`; msgC = C.warn; }
    else { msgT = 'Bateria saudável'; msgS = 'Carga e temperatura dentro dos limites operacionais.'; msgC = C.ok; }
    const yn = (v, bad) => `<b class="${bad ? 'c-crit' : 'c-ok'}">${v}</b>`;
    return `<div class="bbu">
      <div class="bh"><span>${esc(b.host)} (${esc(inf.controladora)} BBU${b.id && !/^0?$/.test(b.id) ? ' ' + esc(b.id) : ''})</span><span class="bdg ${stCls}">${stTxt}</span></div>
      <div class="cells">
        <div class="cell">Substituição:${yn(s.failed ? 'SIM' : 'NÃO', s.failed)}</div>
        <div class="cell">Cap. Baixa:${yn(s.ch != null && s.ch < TH.bbuChargeWarn ? 'SIM' : 'NÃO', s.ch != null && s.ch < TH.bbuChargeWarn)}</div>
        <div class="cell">Saúde:${yn(s.failed ? 'REPROVADA' : s.degraded ? 'ATENÇÃO' : 'APROVADA', s.failed || s.degraded)}</div>
        <div class="cell">Temperatura:<b class="${s.tp == null ? '' : s.tp >= TH.bbuTempCrit ? 'c-crit' : s.tp >= TH.bbuTempWarn ? 'c-warn' : 'hi'}">${s.tp == null ? '—' : fmtN(s.tp) + ' °C'}</b></div>
      </div>
      <div class="gz">${gauge(s.ch, gColor)}<div class="msg"><b style="color:${msgC}">${esc(msgT)}</b><span>${esc(msgS)}</span></div></div>
    </div>`;
  });
  const bName = b => `${b.host}${b.id && !/^0?$/.test(b.id) ? ' #' + b.id : ''}`;
  const chSeries = BBUS.filter(b => b.m.charge).map((b, i) => ({ name: bName(b), color: SERIES_COLORS[(i + 1) % SERIES_COLORS.length], pts: PTS(b.m.charge), unit: '%' }));
  const btSeries = BBUS.filter(b => b.m.temp).map((b, i) => ({ name: bName(b), color: SERIES_COLORS[(i * 3) % SERIES_COLORS.length], pts: PTS(b.m.temp), unit: '°C' }));
  const btAll = btSeries.flatMap(s => s.pts.map(p => p[1]));
  const bbu = `<div class="pnl${bbuFail ? ' alert' : ''}">
    <div class="ph"><h2>${I('battery', '', 'color:#F2495C')} Telemetria de Baterias de Backup (LSI iBBU / PERC)</h2><span class="sp"></span>
      ${BBUS.length ? (bbuFail ? `<span class="pill crit">${bbuFail}/${BBUS.length} Baterias em Falha de Hardware</span>` : `<span class="pill ok">${BBUS.length}/${BBUS.length} Baterias Operacionais</span>`) : '<span class="pill">Sem itens BBU</span>'}</div>
    <div class="grid2">${bbuCards.join('')}</div>
    <div class="grid2" style="margin-top:10px">
      <div><div class="ph" style="margin-bottom:4px"><h3>Carga da Bateria ao Longo do Tempo (%)</h3><span class="sp"></span><span class="mono dim3" style="font-size:10px">Zabbix · BBU: Carga</span></div>
        ${chart({ series: chSeries, yMin: 0, yMax: 100, ticks: [TH.bbuChargeCrit, 100], unit: '%', h: 110, th: [{ v: TH.bbuChargeCrit, label: `${TH.bbuChargeCrit}%`, color: C.crit }] })}
        <div class="legend">${chSeries.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}: ${s.pts.length ? fmtN(s.pts[s.pts.length - 1][1]) + '%' : '—'}</span>`).join('')}</div></div>
      <div><div class="ph" style="margin-bottom:4px"><h3>Temperatura das Baterias BBU (°C)</h3><span class="sp"></span><span class="mono dim3" style="font-size:10px">Zabbix · BBU: Temperatura</span></div>
        ${chart({ series: btSeries, yMin: Math.min(20, ...(btAll.length ? [Math.floor(Math.min(...btAll) / 5) * 5 - 5] : [20])), yMax: Math.max(TH.bbuTempCrit + 5, ...(btAll.length ? [Math.ceil(Math.max(...btAll) / 5) * 5 + 5] : [60])), step: 10, unit: '°C', h: 110, th: [{ v: TH.bbuTempWarn, label: `${TH.bbuTempWarn} °C`, color: C.warn }] })}
        <div class="legend">${btSeries.map(s => { const l = s.pts.length ? s.pts[s.pts.length - 1][1] : null; return `<span><i style="background:${s.color}"></i>${esc(s.name)}: ${l == null ? '—' : fmtN(l) + ' °C'} (${l == null ? '' : l >= TH.bbuTempWarn ? 'Alerta' : 'Normal'})</span>`; }).join('')}</div></div>
    </div>
  </div>`;

  /* ---- problemas + diagnóstico ---- */
  const SEV = [['NÃO CLASSIF.', 'mute'], ['INFO', 'info'], ['AVISO', 'warn'], ['MÉDIA', 'warn'], ['ALTA', 'critl'], ['DESASTRE', 'crit']];
  const comp = d => (RX_BBU.test(d) ? 'BBU Battery' : RX_CACHE.test(d) || /virtual|raid|perc|controller|controladora|\bld\b/i.test(d) ? 'PERC Controller' : /ssd|slot|disk|disco|smart|media|predictive/i.test(d) ? 'SSD / Disco' : 'Hardware');
  const probs = PROBLEMS.filter(p => p.hosts.some(h => SEL.includes(h))).sort((a, b) => b.sev - a.sev || b.ts - a.ts);
  const problemsTbl = `<div class="pnl">
    <div class="ph"><h2>${I('bell', '', 'color:#F2495C')} Problemas Ativos no Zabbix (Triggers Disparadas)</h2><span class="sp"></span><span class="mono dim">${probs.length} problema(s) · ${esc(CD.zabbixLabel || 'Zabbix Server')}</span></div>
    <div class="tablewrap"><table class="tb"><thead><tr><th>Severidade</th><th>Host</th><th>Componente</th><th>Descrição do problema</th><th>Idade</th></tr></thead><tbody>
    ${probs.length ? probs.map(p => {
      const s = SEV[Math.max(0, Math.min(5, p.sev))] || SEV[0];
      return `<tr><td><span class="bdg ${s[1]}">${s[0]}</span></td><td class="h">${esc(p.hosts.filter(h => SEL.includes(h)).join(', '))}</td><td class="dim">${comp(p.desc)}</td>
        <td style="color:${p.sev >= 4 ? C.crit : p.sev >= 2 ? C.warn : '#D8D9DA'}">${esc(p.desc)}</td><td class="dim">${p.ts ? age(p.ts) : '—'}</td></tr>`;
    }).join('') : '<tr><td colspan="5" class="empty"><span class="c-ok">✓ Nenhum problema de storage ativo para os hosts selecionados</span></td></tr>'}
    </tbody></table></div></div>`;
  const totalItems = selHosts.reduce((a, h) => a + h.items, 0);
  const diag = `<div class="pnl">
    <div class="ph"><h2>${I('term', '', 'color:#73BF69')} Diagnóstico da Coleta</h2><span class="sp"></span>${STALE ? '<span class="bdg crit">STALE</span>' : '<span class="bdg ok">CRON OK</span>'}</div>
    <div class="kvl" style="display:block">Arquivo de saída:<br/><b>${esc(CD.outputFile || '/var/log/megacli_status.json')}</b></div>
    <div class="kvl">Última execução: <b class="${STALE ? 'c-crit' : 'c-ok'}">${ago(LAST_TS).replace('há ', 'Há ')} (${STALE ? 'ATRASO' : 'OK'})</b></div>
    <div class="kvl">Limiar de stale file: <b>${TH.staleMinutes} minutos</b></div>
    <div class="kvl">Estado da sincronização: <b class="${STALE ? 'c-crit' : 'c-ok'}">${STALE ? 'Dessincronizado' : 'Sincronizado'}</b></div>
    <div class="kvl">Itens coletados (Zabbix): <b class="c-ok">${totalItems} itens / ${selHosts.length} host(s)</b></div>
    <div class="daemon">${I('code', '', 'width:12px;height:12px')} ${esc(CD.daemon || 'Daemon: zabbix-agent2 (UserParameter MegaCLI sudo wrapper)')}</div>
  </div>`;

  ROOT.innerHTML = `<div class="stack">${toolbar}${kpis}${hostCards}${slotMap}${ssdCharts}${inventory}${smart}${volumes}${bbu}
    <div class="grid-bottom">${problemsTbl}${diag}</div></div>`;

  ROOT.querySelectorAll('[data-chart]').forEach(el => drawChart(el, CHARTS[+el.dataset.chart]));
}

/* ---------- gráfico de linhas SVG com tooltip ---------- */
function drawChart(el, sp) {
  const W = Math.max(240, el.clientWidth || 600), Hh = sp.h || 150;
  const P = { l: 40, r: 10, t: 12, b: 22 };
  const t0 = T0, t1 = T1 > T0 ? T1 : T0 + 1;
  const X = t => P.l + (t - t0) / (t1 - t0) * (W - P.l - P.r);
  const Y = v => P.t + (1 - (v - sp.yMin) / (sp.yMax - sp.yMin || 1)) * (Hh - P.t - P.b);
  let ticks = sp.ticks;
  if (!ticks) { ticks = []; for (let v = Math.ceil(sp.yMin / sp.step) * sp.step; v <= sp.yMax; v += sp.step) ticks.push(v); }
  let g = '';
  ticks.forEach(v => {
    g += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#22262B" stroke-dasharray="3 3"/>`;
    g += `<text x="${P.l - 6}" y="${Y(v) + 3}" text-anchor="end" fill="#8E8E93" font-size="9" font-family="monospace">${v}${sp.unit}</text>`;
  });
  const nx = Math.max(2, Math.min(8, Math.floor((W - P.l - P.r) / 90)));
  for (let i = 0; i <= nx; i++) {
    const t = t0 + (t1 - t0) * i / nx;
    g += `<text x="${X(t)}" y="${Hh - 6}" text-anchor="${i === 0 ? 'start' : i === nx ? 'end' : 'middle'}" fill="#8E8E93" font-size="9" font-family="monospace">${t1 - t0 > 2 * 86400e3 ? new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' : ''}${hhmm(t)}</text>`;
  }
  (sp.th || []).forEach(th => {
    if (th.v < sp.yMin || th.v > sp.yMax) return;
    g += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(th.v)}" y2="${Y(th.v)}" stroke="${th.color}" stroke-width="1" stroke-dasharray="4 3" opacity=".85"/>`;
    g += `<text x="${W - P.r - 4}" y="${Y(th.v) - 4}" text-anchor="end" fill="${th.color}" font-size="9" font-family="monospace">${esc(th.label)}</text>`;
  });
  const clampV = v => Math.max(sp.yMin, Math.min(sp.yMax, v));
  sp.series.forEach(s => {
    if (!s.pts.length) return;
    const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(clampV(p[1])).toFixed(1)}`).join('');
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.5" stroke-linejoin="round"/>`;
    if (s.pts.length === 1) g += `<circle cx="${X(s.pts[0][0])}" cy="${Y(clampV(s.pts[0][1]))}" r="2.5" fill="${s.color}"/>`;
  });
  if (!sp.series.some(s => s.pts.length)) g += `<text x="${W / 2}" y="${Hh / 2}" text-anchor="middle" fill="#8E8E93" font-size="11" font-family="monospace">Sem dados no período</text>`;
  g += `<line class="xh" x1="0" x2="0" y1="${P.t}" y2="${Hh - P.b}" stroke="#8E8E93" stroke-width="1" visibility="hidden"/>`;
  el.innerHTML = `<svg width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}">${g}</svg><div class="tt"></div>`;
  const tt = el.querySelector('.tt'), xh = el.querySelector('.xh');
  el.onmousemove = e => {
    const r = el.getBoundingClientRect(), x = e.clientX - r.left;
    if (x < P.l || x > W - P.r) { tt.style.display = 'none'; xh.setAttribute('visibility', 'hidden'); return; }
    const t = t0 + (x - P.l) / (W - P.l - P.r) * (t1 - t0);
    const rows = sp.series.map(s => {
      let best = null;
      for (const p of s.pts) if (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
      return best ? `<div><span style="color:${s.color}">●</span> ${esc(s.name)}: <b style="color:#F4F5F7">${fmtN(best[1], best[1] % 1 ? 1 : 0)}${s.unit}</b></div>` : '';
    }).join('');
    xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('visibility', 'visible');
    tt.innerHTML = `<div class="dim">${new Date(t).toLocaleString('pt-BR')}</div>${rows}`;
    tt.style.display = 'block';
    const tw = tt.offsetWidth;
    tt.style.left = (x + 12 + tw > W ? x - tw - 12 : x + 12) + 'px';
    tt.style.top = '6px';
  };
  el.onmouseleave = () => { tt.style.display = 'none'; xh.setAttribute('visibility', 'hidden'); };
}

/* ---------- interações ---------- */
ROOT.onclick = e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  if (t.dataset.act === 'host') {
    const h = t.dataset.h;
    let cur = ST.hosts && ST.hosts.length ? ST.hosts.slice() : ALL_HOSTS.slice();
    cur = cur.includes(h) ? cur.filter(x => x !== h) : cur.concat(h);
    ST.hosts = cur.length && cur.length < ALL_HOSTS.length ? cur : null;
    ST.disk = 'all';
    htmlNode.__shRerender && htmlNode.__shRerender();
  } else if (t.dataset.act === 'refresh') {
    const b = document.querySelector('[data-testid="data-testid RefreshPicker run button"]') || document.querySelector('button[aria-label="Refresh dashboard"]') || document.querySelector('button[aria-label="Atualizar painel"]');
    if (b) b.click(); else window.location.reload();
  }
};
ROOT.onchange = e => {
  const t = e.target.closest('[data-act="disk"]');
  if (!t) return;
  ST.disk = t.value;
  htmlNode.__shRerender && htmlNode.__shRerender();
};

/* Re-render local preservando os dados atuais (filtros não disparam nova consulta) */
htmlNode.__shRerender = () => {
  const s = ST;
  // recalcula listas filtradas sem refazer o parsing
  const sel = (s.hosts && s.hosts.length ? s.hosts : ALL_HOSTS).slice();
  SEL.length = 0; SEL.push(...sel);
  selHosts.length = 0; selHosts.push(...sel.map(h => HOSTS.get(h)));
  ALL_DISKS.length = 0; ALL_DISKS.push(...selHosts.flatMap(sortDisks));
  DISKS.length = 0; DISKS.push(...(s.disk === 'all' ? ALL_DISKS : ALL_DISKS.filter(d => d.host + '#' + d.id === s.disk)));
  BBUS.length = 0; BBUS.push(...selHosts.flatMap(h => [...h.bbus.values()]));
  render();
};
render();
