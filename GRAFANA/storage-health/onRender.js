// =============================================================================
// storage-health.component.js
// Storage Health — NOC (Dell PowerEdge / PERC / MegaCLI)
// Plugin: HTML graphics (gapit-htmlgraphics-panel) — campo onRender
// Fonte: Zabbix (alexanderzobnin-zabbix-datasource)
//   Hosts: /.*/
//   Itens: /^(SSD .*: .*|Slot .*: (Erros de midia|Outros erros|Falhas previstas)|BBU .*: (Carga|Temperatura))$/
//
// Estrutura (Angular-like):
//   CONFIG ............ valores padrão (sobrescritos pelo "Code data" = @Input)
//   Pipes ............. formatação (number, date, escape…)
//   Icons ............. ícones SVG inline
//   ZabbixDataService . lê os frames do Grafana → séries + problemas
//   StorageModel ...... hosts → discos / slots / BBUs + regras de estado
//   LineChartDirective  gráfico SVG (curvas suaves, gradiente, legenda Mín/Máx/Média/Atual)
//   StorageHealthComponent  ngOnChanges → render() → templates *Tpl()
//   Bootstrap ......... instancia o componente a cada onRender
// =============================================================================

// -----------------------------------------------------------------------------
// CONFIG — padrões; "Code data" do painel sobrescreve
// -----------------------------------------------------------------------------
const CONFIG = {
  thresholds: {
    tempWarn: 45, tempCrit: 55,
    lifeWarn: 80, lifeCrit: 20,
    bbuChargeWarn: 80, bbuChargeCrit: 50,
    bbuTempWarn: 45, bbuTempCrit: 55,
    staleMinutes: 15
  },
  defaultHost: {
    modelo: 'Dell PowerEdge', controladora: 'PERC H700', firmware: '',
    raid: '—', capacidade: '—', composicao: '', cachePadrao: 'WriteBack', vd: 'Virtual Disk 0'
  },
  hosts: {},
  problemFilter: 'BBU|Bateria|Battery|SSD|Slot|Disk|Disco|RAID|PERC|MegaCLI|Cache|WriteThrough|Virtual|Controladora|Controller|SMART|Media|Predictive',
  zabbixLabel: 'Zabbix Server',
  outputFile: '/var/log/megacli_status.json',
  daemon: 'Daemon: zabbix-agent2 (UserParameter MegaCLI sudo wrapper)',
  defaultHostName: 'zabbix-host'
};

const COLORS = { ok: '#73BF69', warn: '#FF9830', crit: '#F2495C', info: '#5794F2', txt: '#F4F5F7' };
const SERIES_COLORS = ['#FF9830', '#5794F2', '#F2CC0C', '#73BF69', '#B877D9', '#8AB8FF', '#FF7383', '#56A64B', '#FADE2A', '#CA95E5'];

const RX = {
  item: /^(?:(.+?):\s)?((?:SSD|Slot|BBU)\s.+)$/,
  bbu: /bbu|bateria|battery/i,
  cache: /write\s*-?\s*through|cache/i,
  volume: /(virtual\s*disk|volume|\bvd\b|\bld\b|raid|array).*(degrad|offline|fail|falha|partial|parcial|rebuild)/i
};

// Palavras-chave do nome "SSD <id>: <métrica>" → campo do disco (ordem importa)
const SSD_METRICS = [
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

const SEVERITIES = [['NÃO CLASSIF.', 'mute'], ['INFO', 'info'], ['AVISO', 'warn'], ['MÉDIA', 'warn'], ['ALTA', 'critl'], ['DESASTRE', 'crit']];

// -----------------------------------------------------------------------------
// Pipes — formatação
// -----------------------------------------------------------------------------
const Pipes = {
  toArray: v => (v == null ? [] : Array.isArray(v) ? v : typeof v.toArray === 'function' ? v.toArray() : Array.from(v)),
  num: v => (v == null || v === '' ? null : typeof v === 'number' ? v : (isNaN(parseFloat(v)) ? null : parseFloat(v))),
  esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  number: (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })),
  pad2: n => String(n).padStart(2, '0'),
  hhmm: t => { const d = new Date(t); return Pipes.pad2(d.getHours()) + ':' + Pipes.pad2(d.getMinutes()); },
  hhmmss: t => Pipes.hhmm(t) + ':' + Pipes.pad2(new Date(t).getSeconds()),
  ago: t => {
    if (!t) return '—';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'há ' + Math.round(s) + ' s';
    if (s < 3600) return 'há ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'há ' + Math.floor(s / 3600) + 'h ' + Math.round((s % 3600) / 60) + 'm';
    return 'há ' + Math.floor(s / 86400) + 'd';
  },
  age: t => {
    const s = Math.max(0, (Date.now() - t) / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  },
  dayLabel: t => {
    const d = new Date(t), n = new Date();
    return d.toDateString() === n.toDateString() ? 'Hoje às ' + Pipes.hhmmss(t) : d.toLocaleDateString('pt-BR') + ' ' + Pipes.hhmmss(t);
  },
  shortHost: h => String(h).replace(/^node/i, '')
};
const { esc, num } = Pipes;
const fmtN = Pipes.number;

// -----------------------------------------------------------------------------
// Icons — SVG inline
// -----------------------------------------------------------------------------
const Icons = (() => {
  const paths = {
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
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16h.01"/>',
    pct: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="1"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>'
  };
  return (name, cls = '', style = '') =>
    `<svg class="ic ${cls}" style="${style}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
})();

// -----------------------------------------------------------------------------
// ZabbixDataService — frames do Grafana → séries (host/item) + problemas
// -----------------------------------------------------------------------------
class ZabbixDataService {
  constructor(config) {
    this.config = config;
  }

  parse(panelData) {
    const series = new Map();
    const problems = [];
    for (const frame of (panelData && panelData.series) || []) {
      const fields = frame.fields || [];
      const timeField = fields.find(f => f.type === 'time');
      const times = timeField ? Pipes.toArray(timeField.values) : [];
      for (const field of fields) {
        if (field === timeField) continue;
        const values = Pipes.toArray(field.values);
        if (this.isProblemField(values)) {
          values.forEach(v => v && typeof v === 'object' && problems.push(v));
          continue;
        }
        const s = this.toSeries(frame, field, values, times);
        if (!s) continue;
        const key = s.host + '\u0000' + s.item;
        const prev = series.get(key);
        if (!prev || s.lastTs >= prev.lastTs) series.set(key, s);
      }
    }
    return { series: [...series.values()], problems: this.normalizeProblems(problems) };
  }

  isProblemField(values) {
    const o = values.find(v => v && typeof v === 'object');
    return !!o && ('triggerid' in o || 'eventid' in o || 'severity' in o || 'priority' in o);
  }

  // Descobre host e item pelos labels (backend) ou pelo nome "host: item"
  toSeries(frame, field, values, times) {
    const labels = field.labels || {};
    const cfg = field.config || {};
    const candidates = [];
    if (labels.item) candidates.push((labels.host ? labels.host + ': ' : '') + labels.item);
    [cfg.displayNameFromDS, cfg.displayName, field.state && field.state.displayName, frame.name, field.name]
      .forEach(c => c && candidates.push(String(c)));

    let host = labels.host || null;
    let item = null;
    for (const c of candidates) {
      const m = c.match(RX.item);
      if (m) { item = m[2].trim(); if (!host && m[1]) host = m[1].trim(); break; }
    }
    if (!item) return null;

    const pts = [];
    values.forEach((v, i) => {
      if (v === null || v === undefined || v === '' || (typeof v === 'number' && isNaN(v))) return;
      pts.push([times[i] != null ? +times[i] : Date.now(), v]);
    });
    pts.sort((a, b) => a[0] - b[0]);
    return {
      host: host || this.config.defaultHostName,
      item,
      pts,
      first: pts.length ? pts[0][1] : null,
      last: pts.length ? pts[pts.length - 1][1] : null,
      lastTs: pts.length ? pts[pts.length - 1][0] : 0
    };
  }

  normalizeProblems(raw) {
    const filter = new RegExp(this.config.problemFilter, 'i');
    return raw.map(p => {
      const hosts = (p.hosts || []).map(x => x.name || x.host).filter(Boolean);
      if (p.host) hosts.push(p.host);
      if (p.hostTechName) hosts.push(p.hostTechName);
      let ts = +(p.lastchangeUnix || p.lastchange || p.timestamp || p.clock || 0);
      if (ts && ts < 1e12) ts *= 1000;
      return {
        hosts: [...new Set(hosts)],
        sev: +(p.severity != null ? p.severity : p.priority != null ? p.priority : 0),
        desc: p.name || p.description || '',
        ts
      };
    }).filter(p => p.desc && filter.test(p.desc));
  }
}

// -----------------------------------------------------------------------------
// StorageModel — hosts → discos / slots / BBUs + regras de estado
// -----------------------------------------------------------------------------
class StorageModel {
  constructor(parsed, config) {
    this.cfg = config;
    this.th = config.thresholds;
    this.problems = parsed.problems;
    this.hosts = new Map();
    this.series = parsed.series;
    parsed.series.forEach(s => this.addSeries(s));
  }

  host(name) {
    if (!this.hosts.has(name)) this.hosts.set(name, { name, disks: new Map(), bbus: new Map(), items: 0, lastTs: 0 });
    return this.hosts.get(name);
  }

  static slotId(key) {
    const s = String(key).trim();
    const m = s.match(/\[\s*\d+\s*:\s*(\d+)\s*\]/) || s.match(/\d+\s*:\s*(\d+)\s*$/) || s.match(/(\d+)(?!.*\d)/);
    return m ? m[1] : s;
  }

  disk(hostName, key) {
    const h = this.host(hostName), id = StorageModel.slotId(key);
    if (!h.disks.has(id)) h.disks.set(id, { host: hostName, id, m: {}, extra: {} });
    return h.disks.get(id);
  }

  addSeries(s) {
    const h = this.host(s.host);
    h.items++;
    h.lastTs = Math.max(h.lastTs, s.lastTs);
    let m;
    if ((m = s.item.match(/^SSD\s+(.+?):\s+(.+)$/))) {
      const d = this.disk(s.host, m[1]);
      d.label = d.label || m[1];
      const metric = m[2];
      const hit = SSD_METRICS.find(([, rx]) => rx.test(metric));
      if (!hit) d.extra[metric] = s;
      else if (hit[0] === 'life' && /usad|used|consum|gast/i.test(metric) && !/restante|remaining|left/i.test(metric)) d.m.life = Object.assign({}, s, { inv: true });
      else d.m[hit[0]] = s;
    } else if ((m = s.item.match(/^Slot\s+(.+?):\s+(.+)$/))) {
      const d = this.disk(s.host, m[1]);
      if (/m[ií]dia/i.test(m[2])) d.m.media = s;
      else if (/outros/i.test(m[2])) d.m.other = s;
      else if (/previst/i.test(m[2])) d.m.pred = s;
    } else if ((m = s.item.match(/^BBU\s+(.+?):\s+(.+)$/))) {
      const id = m[1].trim();
      if (!h.bbus.has(id)) h.bbus.set(id, { host: s.host, id, m: {} });
      const b = h.bbus.get(id);
      if (/carga|charge/i.test(m[2])) b.m.charge = s;
      else if (/temp/i.test(m[2])) b.m.temp = s;
    }
  }

  // ---- acessores ----
  get hostNames() { return [...this.hosts.keys()].sort((a, b) => a.localeCompare(b)); }
  hostInfo(name) { return Object.assign({}, this.cfg.defaultHost, this.cfg.hosts[name] || {}); }
  sortedDisks(h) {
    return [...h.disks.values()].sort((a, b) => (isNaN(a.id) || isNaN(b.id) ? String(a.id).localeCompare(String(b.id)) : a.id - b.id));
  }
  value(d, k) { const s = d.m[k]; if (!s) return null; const v = num(s.last); return v == null ? null : s.inv ? 100 - v : v; }
  text(d, k) { return d.m[k] && d.m[k].last != null ? String(d.m[k].last) : null; }
  delta(d, k) { const s = d.m[k]; if (!s) return null; const a = num(s.first), b = num(s.last); return a == null || b == null ? null : b - a; }
  points(s, inv) { return s ? s.pts.map(p => [p[0], inv ? 100 - num(p[1]) : num(p[1])]).filter(p => p[1] != null) : []; }
  hostProblems(name, rx) { return this.problems.filter(p => p.hosts.includes(name) && (!rx || rx.test(p.desc))); }

  // ---- regras de estado ----
  diskState(d) {
    const st = this.text(d, 'state');
    const pred = this.value(d, 'pred'), media = this.value(d, 'media'), life = this.value(d, 'life'), temp = this.value(d, 'temp');
    if (st) {
      if (/online|optimal|ok|ativo|normal|spun up|jbod|hot.?spare/i.test(st) && !/fail|offline|missing|falha|bad/i.test(st)) {
        if ((pred || 0) > 0) return { txt: 'PRED. FAIL', cls: 'crit' };
        return { txt: /hot.?spare/i.test(st) ? 'HOT-SPARE' : 'ONLINE', cls: 'ok' };
      }
      if (/rebuild|copyback|reconstr/i.test(st)) return { txt: 'REBUILD', cls: 'warn' };
      return { txt: st.split(/[,(]/)[0].trim().toUpperCase().slice(0, 14), cls: 'crit' };
    }
    if ((pred || 0) > 0) return { txt: 'PRED. FAIL', cls: 'crit' };
    if ((life != null && life < this.th.lifeCrit) || (temp != null && temp >= this.th.tempCrit)) return { txt: 'CRÍTICO', cls: 'crit' };
    if ((media || 0) > 0) return { txt: 'ATENÇÃO', cls: 'warn' };
    if (!Object.keys(d.m).length) return { txt: 'SEM DADOS', cls: 'mute' };
    return { txt: 'ONLINE', cls: 'ok' };
  }

  bbuState(b) {
    const th = this.th;
    const ch = num(b.m.charge && b.m.charge.last), tp = num(b.m.temp && b.m.temp.last);
    const prob = this.hostProblems(b.host, RX.bbu).length > 0;
    const failed = prob || (ch != null && ch < th.bbuChargeCrit) || (tp != null && tp >= th.bbuTempCrit);
    const degraded = !failed && ((ch != null && ch < th.bbuChargeWarn) || (tp != null && tp >= th.bbuTempWarn));
    return { ch, tp, prob, failed, degraded };
  }

  controller(h) {
    const bb = [...h.bbus.values()].map(b => this.bbuState(b));
    const bbuFailed = bb.some(x => x.failed);
    const bbuDeg = bb.some(x => x.degraded);
    const cacheProb = this.hostProblems(h.name, RX.cache).length > 0;
    const volProbs = this.hostProblems(h.name, RX.volume).filter(p => !RX.cache.test(p.desc));
    const disks = this.sortedDisks(h);
    const online = disks.filter(d => this.diskState(d).cls === 'ok').length;
    const volBad = volProbs.length > 0 || disks.some(d => this.diskState(d).cls === 'crit');
    const info = this.hostInfo(h.name);
    const writeThrough = cacheProb || bbuFailed;
    return { bb, bbuFailed, bbuDeg, cacheProb, volProbs, disks, online, volBad, info, writeThrough, cacheNow: writeThrough ? 'WriteThrough' : info.cachePadrao };
  }

  // ---- classes CSS por limiar ----
  tempCls(v) { return v == null ? '' : v >= this.th.tempCrit ? 'c-crit' : v >= this.th.tempWarn ? 'c-warn' : ''; }
  tempColor(v) { return v >= this.th.tempCrit ? COLORS.crit : v >= this.th.tempWarn ? COLORS.warn : COLORS.ok; }
  lifeColor(v) { return v == null ? '#4D5358' : v < this.th.lifeCrit ? COLORS.crit : v < this.th.lifeWarn ? COLORS.warn : COLORS.ok; }
  lifeCls(v) { return v == null ? '' : v < this.th.lifeCrit ? 'c-crit' : v < this.th.lifeWarn ? 'c-warn' : 'c-ok'; }
}

// -----------------------------------------------------------------------------
// LineChartDirective — séries temporais em SVG
//   • curvas suavizadas (monotone cubic), quebra de linha em falhas de coleta
//   • preenchimento em gradiente, faixa de limiar, ponto do último valor
//   • crosshair com marcadores + tooltip ordenado
//   • legenda em tabela (Mín / Máx / Média / Atual); clique isola a série,
//     Ctrl/Shift+clique liga/desliga (igual ao Grafana)
// -----------------------------------------------------------------------------
class LineChartDirective {
  static render(wrap, spec, range, state) {
    state.hidden = state.hidden || {};
    const hidden = new Set(state.hidden[spec.id] || []);
    const plot = wrap.querySelector('.chart');
    const legend = wrap.querySelector('.legend-tb');
    const visible = spec.series.filter(s => !hidden.has(s.name));

    LineChartDirective.drawPlot(plot, spec, visible, range);
    legend.innerHTML = LineChartDirective.legendTpl(spec, hidden);

    // @HostListener('click') na legenda
    legend.onclick = e => {
      const row = e.target.closest('[data-s]');
      if (!row) return;
      const name = row.dataset.s;
      const names = spec.series.map(s => s.name);
      let next;
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        next = new Set(hidden);
        next.has(name) ? next.delete(name) : next.add(name);
        if (next.size === names.length) next.clear();
      } else {
        const isolated = hidden.size === names.length - 1 && !hidden.has(name);
        next = isolated ? new Set() : new Set(names.filter(n => n !== name));
      }
      state.hidden[spec.id] = [...next];
      LineChartDirective.render(wrap, spec, range, state);
    };
  }

  static stats(s) {
    const v = s.pts.map(p => p[1]);
    if (!v.length) return { min: null, max: null, avg: null, last: null };
    return { min: Math.min(...v), max: Math.max(...v), avg: v.reduce((a, b) => a + b, 0) / v.length, last: v[v.length - 1] };
  }

  static fmt(v, spec) {
    if (v == null) return '—';
    const d = spec.decimals != null ? spec.decimals : (Math.abs(v % 1) > 0.001 ? 1 : 0);
    return fmtN(v, d) + (spec.unit === '%' ? '%' : ' ' + spec.unit);
  }

  static legendTpl(spec, hidden) {
    if (!spec.series.length) return '';
    const rows = spec.series
      .map(s => ({ s, st: LineChartDirective.stats(s) }))
      .sort((a, b) => (b.st.last == null ? -Infinity : b.st.last) - (a.st.last == null ? -Infinity : a.st.last))
      .map(({ s, st }) => {
        const col = spec.status && st.last != null ? spec.status(st.last) : COLORS.txt;
        return `<tr data-s="${esc(s.name)}" class="${hidden.has(s.name) ? 'off' : ''}">
          <td class="nm"><i style="background:${s.color}"></i>${esc(s.name)}</td>
          <td>${LineChartDirective.fmt(st.min, spec)}</td>
          <td>${LineChartDirective.fmt(st.max, spec)}</td>
          <td>${LineChartDirective.fmt(st.avg, spec)}</td>
          <td class="cur" style="color:${col}">${LineChartDirective.fmt(st.last, spec)}</td>
        </tr>`;
      }).join('');
    return `<table class="lg"><thead><tr><th>Série</th><th>Mín</th><th>Máx</th><th>Média</th><th>Atual</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // Fritsch–Carlson: curva suave sem "overshoot" (não inventa picos)
  static monotonePath(p) {
    const n = p.length;
    if (n < 3) return p.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('');
    const dx = [], m = [];
    for (let i = 0; i < n - 1; i++) {
      dx[i] = p[i + 1][0] - p[i][0];
      m[i] = dx[i] ? (p[i + 1][1] - p[i][1]) / dx[i] : 0;
    }
    const t = [m[0]];
    for (let i = 1; i < n - 1; i++) {
      t[i] = m[i - 1] * m[i] <= 0 ? 0 : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    }
    t[n - 1] = m[n - 2];
    let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += `C${(p[i][0] + h).toFixed(1)},${(p[i][1] + t[i] * h).toFixed(1)} ${(p[i + 1][0] - h).toFixed(1)},${(p[i + 1][1] - t[i + 1] * h).toFixed(1)} ${p[i + 1][0].toFixed(1)},${p[i + 1][1].toFixed(1)}`;
    }
    return d;
  }

  // Quebra a série onde o intervalo entre amostras > 5× a mediana
  static segments(pts) {
    if (pts.length < 3) return [pts];
    const gaps = pts.slice(1).map((p, i) => p[0] - pts[i][0]).sort((a, b) => a - b);
    const limit = gaps[Math.floor(gaps.length / 2)] * 5;
    const out = [[pts[0]]];
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][0] - pts[i - 1][0] > limit) out.push([]);
      out[out.length - 1].push(pts[i]);
    }
    return out;
  }

  static drawPlot(el, spec, series, range) {
    const W = Math.max(240, el.clientWidth || 600), Hh = spec.h || 180;
    const P = { l: 44, r: 12, t: 14, b: 24 };
    const t0 = range.from, t1 = range.to > range.from ? range.to : range.from + 1;
    const pw = W - P.l - P.r, bottom = Hh - P.b;
    const X = t => P.l + (t - t0) / (t1 - t0) * pw;
    const Y = v => P.t + (1 - (Math.max(spec.yMin, Math.min(spec.yMax, v)) - spec.yMin) / (spec.yMax - spec.yMin || 1)) * (bottom - P.t);
    const uid = 'c-' + spec.id;

    let ticks = spec.ticks;
    if (!ticks) { ticks = []; for (let v = Math.ceil(spec.yMin / spec.step) * spec.step; v <= spec.yMax; v += spec.step) ticks.push(v); }

    let defs = '', g = '';

    // faixas de limiar (acima/abaixo)
    (spec.th || []).forEach(th => {
      if (th.v < spec.yMin || th.v > spec.yMax) return;
      const y = Y(th.v);
      if (th.zone === 'above') g += `<rect x="${P.l}" y="${P.t}" width="${pw}" height="${y - P.t}" fill="${th.color}" opacity=".06"/>`;
      if (th.zone === 'below') g += `<rect x="${P.l}" y="${y}" width="${pw}" height="${bottom - y}" fill="${th.color}" opacity=".06"/>`;
    });

    // grade Y
    ticks.forEach(v => {
      g += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#2C3235" stroke-opacity=".6"/>`;
      g += `<text x="${P.l - 8}" y="${Y(v) + 3}" text-anchor="end" class="ax">${v}${spec.unit === '%' ? '%' : spec.unit}</text>`;
    });

    // grade X
    const nx = Math.max(2, Math.min(8, Math.floor(pw / 100)));
    for (let i = 0; i <= nx; i++) {
      const t = t0 + (t1 - t0) * i / nx;
      const date = t1 - t0 > 2 * 86400e3 ? new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' : '';
      if (i > 0 && i < nx) g += `<line x1="${X(t)}" x2="${X(t)}" y1="${P.t}" y2="${bottom}" stroke="#2C3235" stroke-opacity=".35"/>`;
      g += `<text x="${X(t)}" y="${Hh - 7}" text-anchor="${i === 0 ? 'start' : i === nx ? 'end' : 'middle'}" class="ax">${date}${Pipes.hhmm(t)}</text>`;
    }
    g += `<line x1="${P.l}" x2="${W - P.r}" y1="${bottom}" y2="${bottom}" stroke="#363D44"/>`;

    // séries
    const fillOpacity = series.length <= 2 ? 0.28 : series.length <= 4 ? 0.14 : 0.06;
    series.forEach((s, i) => {
      if (!s.pts.length) return;
      defs += `<linearGradient id="${uid}-g${i}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${s.color}" stop-opacity="${fillOpacity}"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`;
      LineChartDirective.segments(s.pts).forEach(seg => {
        const xy = seg.map(p => [X(p[0]), Y(p[1])]);
        const line = LineChartDirective.monotonePath(xy);
        if (xy.length > 1) g += `<path d="${line}L${xy[xy.length - 1][0].toFixed(1)},${bottom}L${xy[0][0].toFixed(1)},${bottom}Z" fill="url(#${uid}-g${i})"/>`;
        g += `<path d="${line}" fill="none" stroke="${s.color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`;
      });
      const lp = s.pts[s.pts.length - 1];
      g += `<circle cx="${X(lp[0])}" cy="${Y(lp[1])}" r="2.6" fill="${s.color}" stroke="#111217" stroke-width="1"/>`;
    });

    // linhas de limiar por cima das séries
    (spec.th || []).forEach(th => {
      if (th.v < spec.yMin || th.v > spec.yMax) return;
      const y = Y(th.v);
      g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" stroke="${th.color}" stroke-width="1" stroke-dasharray="5 4"/>`;
      g += `<rect x="${W - P.r - 6 - th.label.length * 6.1}" y="${y - 15}" width="${th.label.length * 6.1 + 6}" height="13" rx="2" fill="#111217" opacity=".85"/>`;
      g += `<text x="${W - P.r - 3}" y="${y - 5}" text-anchor="end" fill="${th.color}" class="thl">${esc(th.label)}</text>`;
    });

    if (!series.some(s => s.pts.length)) {
      g += `<text x="${W / 2}" y="${Hh / 2}" text-anchor="middle" class="nd">Sem dados no período</text>`;
    }

    g += `<g class="hv" visibility="hidden"><line class="xh" x1="0" x2="0" y1="${P.t}" y2="${bottom}" stroke="#8E8E93" stroke-dasharray="2 2"/>
      ${series.map((s, i) => `<circle class="hd" data-i="${i}" r="3.6" fill="${s.color}" stroke="#111217" stroke-width="1.5"/>`).join('')}</g>`;
    el.innerHTML = `<svg width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}"><defs>${defs}</defs>${g}</svg><div class="tt"></div>`;

    // @HostListener('mousemove') / ('mouseleave')
    const tt = el.querySelector('.tt'), hv = el.querySelector('.hv'), xh = el.querySelector('.xh');
    const dots = [...el.querySelectorAll('.hd')];
    const hide = () => { tt.style.display = 'none'; hv.setAttribute('visibility', 'hidden'); };
    el.onmouseleave = hide;
    el.onmousemove = e => {
      const x = e.clientX - el.getBoundingClientRect().left;
      if (x < P.l || x > W - P.r || !series.length) return hide();
      const t = t0 + (x - P.l) / pw * (t1 - t0);
      let tShow = t;
      const hits = series.map((s, i) => {
        let best = null;
        for (const p of s.pts) if (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
        if (best) {
          tShow = best[0];
          dots[i].setAttribute('cx', X(best[0])); dots[i].setAttribute('cy', Y(best[1]));
          dots[i].setAttribute('visibility', 'visible');
        } else dots[i].setAttribute('visibility', 'hidden');
        return best ? { s, v: best[1] } : null;
      }).filter(Boolean).sort((a, b) => b.v - a.v);
      const xs = X(tShow);
      xh.setAttribute('x1', xs); xh.setAttribute('x2', xs);
      hv.setAttribute('visibility', 'visible');
      tt.innerHTML = `<div class="tt-h">${new Date(tShow).toLocaleString('pt-BR')}</div>` + hits.map(h =>
        `<div class="tt-r"><span><i style="background:${h.s.color}"></i>${esc(h.s.name)}</span><b style="color:${spec.status ? spec.status(h.v) : COLORS.txt}">${LineChartDirective.fmt(h.v, spec)}</b></div>`).join('');
      tt.style.display = 'block';
      const tw = tt.offsetWidth, th = tt.offsetHeight;
      tt.style.left = (xs + 14 + tw > W ? xs - tw - 14 : xs + 14) + 'px';
      tt.style.top = Math.max(4, Math.min(Hh - th - 4, e.clientY - el.getBoundingClientRect().top - th / 2)) + 'px';
    };
  }
}

// -----------------------------------------------------------------------------
// StorageHealthComponent
// -----------------------------------------------------------------------------
class StorageHealthComponent {
  constructor(host, state) {
    this.host = host;                                  // ShadowRoot (htmlNode)
    this.root = host.getElementById('sh-root');        // template root
    this.state = state;                                // { hosts: string[]|null, disk: 'all'|'host#slot' }
    this.charts = [];
  }

  // ---- lifecycle ----
  ngOnChanges({ data, codeData }) {
    this.config = StorageHealthComponent.mergeConfig(codeData);
    this.th = this.config.thresholds;
    this.data = data;
    this.model = new StorageModel(new ZabbixDataService(this.config).parse(data), this.config);
    this.range = this.timeRange(data);
    this.bindEvents();
    this.render();
  }

  static mergeConfig(codeData) {
    let cd = codeData;
    if (typeof cd === 'string') { try { cd = JSON.parse(cd); } catch (e) { cd = {}; } }
    cd = cd || {};
    return Object.assign({}, CONFIG, cd, {
      thresholds: Object.assign({}, CONFIG.thresholds, cd.thresholds || {}),
      defaultHost: Object.assign({}, CONFIG.defaultHost, cd.defaultHost || {}),
      hosts: cd.hosts || {}
    });
  }

  timeRange(data) {
    const tr = data && data.timeRange;
    const all = this.model.series.flatMap(s => s.pts.map(p => p[0]));
    return {
      raw: tr && tr.raw,
      from: tr && tr.from ? +tr.from.valueOf() : all.length ? Math.min(...all) : Date.now() - 6 * 3600e3,
      to: tr && tr.to ? +tr.to.valueOf() : Date.now()
    };
  }

  // ---- view model (getters recalculados a cada render) ----
  get allHosts() { return this.model.hostNames; }
  get selected() {
    const sel = (this.state.hosts || []).filter(h => this.model.hosts.has(h));
    return sel.length ? sel : this.allHosts;
  }
  get selectedHosts() { return this.selected.map(h => this.model.hosts.get(h)); }
  get allDisks() { return this.selectedHosts.flatMap(h => this.model.sortedDisks(h)); }
  get disks() { return this.state.disk === 'all' ? this.allDisks : this.allDisks.filter(d => this.diskKey(d) === this.state.disk); }
  get bbus() { return this.selectedHosts.flatMap(h => [...h.bbus.values()]); }
  get lastTs() { return Math.max(0, ...this.selectedHosts.map(h => h.lastTs)); }
  get stale() { return !this.lastTs || Date.now() - this.lastTs > this.th.staleMinutes * 60e3; }
  diskKey(d) { return d.host + '#' + d.id; }
  diskName(d) { return `${Pipes.shortHost(d.host)}-s${d.id}`; }
  bbuName(b) { return `${b.host}${b.id && !/^0?$/.test(b.id) ? ' #' + b.id : ''}`; }

  // ---- render ----
  render() {
    this.charts = [];
    if (!this.model.hosts.size) {
      this.root.innerHTML = this.emptyTpl();
      return;
    }
    this.ctl = new Map(this.selectedHosts.map(h => [h.name, this.model.controller(h)]));
    this.root.innerHTML = `<div class="stack">
      ${this.toolbarTpl()}
      ${this.kpisTpl()}
      ${this.hostCardsTpl()}
      ${this.slotMapTpl()}
      ${this.ssdChartsTpl()}
      ${this.inventoryTpl()}
      ${this.smartTpl()}
      ${this.volumesTpl()}
      ${this.bbuTpl()}
      <div class="grid-bottom">${this.problemsTpl()}${this.diagnosticsTpl()}</div>
    </div>`;
    this.root.querySelectorAll('[data-chart]').forEach(el => LineChartDirective.render(el, this.charts[+el.dataset.chart], this.range, this.state));
  }

  // ---- event binding: (click) / (change) ----
  bindEvents() {
    this.root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      if (t.dataset.act === 'host') this.onHostToggle(t.dataset.h);
      else if (t.dataset.act === 'refresh') this.onRefresh();
    };
    this.root.onchange = e => {
      const t = e.target.closest('[data-act="disk"]');
      if (t) this.onDiskChange(t.value);
    };
  }

  onHostToggle(name) {
    let cur = this.selected.slice();
    cur = cur.includes(name) ? cur.filter(x => x !== name) : cur.concat(name);
    this.state.hosts = cur.length && cur.length < this.allHosts.length ? cur : null;
    this.state.disk = 'all';
    this.render();
  }

  onDiskChange(value) {
    this.state.disk = value;
    this.render();
  }

  onRefresh() {
    const btn = document.querySelector('[data-testid="data-testid RefreshPicker run button"]')
      || document.querySelector('button[aria-label="Refresh dashboard"]')
      || document.querySelector('button[aria-label="Atualizar painel"]');
    if (btn) btn.click(); else window.location.reload();
  }

  // ===========================================================================
  // Templates
  // ===========================================================================

  // ---- partials ----
  chartTpl(spec) {
    this.charts.push(spec);
    return `<div class="chart-wrap" data-chart="${this.charts.length - 1}">
      <div class="chart" style="height:${spec.h || 180}px"></div>
      <div class="legend-tb"></div>
    </div>`;
  }

  barTpl(pct, color) {
    return `<div class="bar-t"><i style="width:${Math.max(0, Math.min(100, pct || 0))}%;background:${color}"></i></div>`;
  }

  kpiTpl({ label, icon, acc, value, color, unit = '', extra = '', foot = '', alert = false }) {
    return `<div class="kpi${alert ? ' alert' : ''}" style="--acc:${acc}">
      <div class="kpi-h"><span class="lbl${alert ? ' c-crit' : ''}">${label}</span>${Icons(icon)}</div>
      <div class="kpi-v"><span class="big" style="color:${color || COLORS.txt}">${value}</span><span class="u">${unit}</span>${extra}</div>
      <div class="kpi-f"><span>${foot}</span></div>
    </div>`;
  }

  gaugeTpl(pct, color) {
    const r = 30, cir = 2 * Math.PI * r, v = Math.max(0, Math.min(100, pct || 0));
    return `<svg width="76" height="76" viewBox="0 0 76 76">
      <circle cx="38" cy="38" r="${r}" fill="none" stroke="#2a2f35" stroke-width="7"/>
      <circle cx="38" cy="38" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-dasharray="${cir * v / 100} ${cir}" transform="rotate(-90 38 38)"/>
      <text x="38" y="40" text-anchor="middle" class="g-v">${pct == null ? '—' : fmtN(pct) + '%'}</text>
      <text x="38" y="52" text-anchor="middle" class="g-l">CARGA</text></svg>`;
  }

  emptyTpl() {
    return `<div class="nodata">${Icons('warn', '', 'width:28px;height:28px;color:#FF9830')}<br/><br/>
      Nenhum item encontrado.<br/>Verifique a consulta Zabbix (hosts <b>/.*/</b> e o regex de itens SSD / Slot / BBU)<br/>e se o período selecionado contém dados.</div>`;
  }

  // ---- <sh-toolbar> ----
  toolbarTpl() {
    const sel = this.selected, all = this.allDisks, last = this.lastTs, stale = this.stale;
    const diskOpts = [`<option value="all">Todos os discos (${all.length})</option>`]
      .concat(all.map(d => `<option value="${esc(this.diskKey(d))}" ${this.state.disk === this.diskKey(d) ? 'selected' : ''}>${esc(d.host)} · Slot ${esc(d.id)}</option>`))
      .join('');
    let refresh = '';
    try { refresh = new URLSearchParams(window.location.search).get('refresh') || ''; } catch (e) { /* sem URL */ }
    return `<div class="bar stack">
      <div class="row">
        <span class="ctl"><span class="lab">Servidores:</span>
          ${this.allHosts.map(h => `<span class="chip ${sel.includes(h) ? 'on' : ''}" data-act="host" data-h="${esc(h)}">${sel.includes(h) ? '✓' : ''} ${esc(h)}</span>`).join('')}
        </span>
        <span class="ctl"><span class="lab">Disco:</span><select class="sel" data-act="disk">${diskOpts}</select></span>
        <span class="ctl"><span class="lab">Período:</span><span class="pill">${esc(this.rangeLabel())}</span></span>
        <span class="sp"></span>
        ${stale ? '<span class="bdg crit">● COLETOR ATRASADO</span>' : '<span class="bdg solidok">● COLETOR ATIVO</span>'}
        <span class="meta">Último poll: ${last ? Pipes.hhmmss(last) : '—'}</span>
      </div>
      <div class="row">
        ${stale ? `<span class="bdg warn">● DADOS DESATUALIZADOS (&gt; ${this.th.staleMinutes} min)</span>` : '<span class="bdg ok">● DADOS ATUALIZADOS / MEGACLI OK</span>'}
        <span class="meta">Última coleta controladora: <b class="hi">${last ? Pipes.dayLabel(last) : '—'}</b> (${Pipes.ago(last)})</span>
        <button class="btn" data-act="refresh">${Icons('refresh', '', 'width:13px;height:13px')} Atualizar agora</button>
        <span class="meta dim3">Auto-refresh: ${esc(refresh || 'off')}</span>
      </div>
    </div>`;
  }

  rangeLabel() {
    const r = this.range.raw;
    if (r && typeof r.from === 'string' && r.to === 'now') {
      const m = r.from.match(/^now-(\d+)([smhdwMy])$/);
      if (m) return `Últimas ${m[1]} ${{ s: 'seg', m: 'min', h: 'horas', d: 'dias', w: 'semanas', M: 'meses', y: 'anos' }[m[2]]}`;
    }
    return `${new Date(this.range.from).toLocaleString('pt-BR')} → ${new Date(this.range.to).toLocaleString('pt-BR')}`;
  }

  // ---- <sh-kpi> x6 ----
  kpisTpl() {
    const M = this.model, th = this.th, disks = this.disks, bbus = this.bbus, hosts = this.selectedHosts;
    const lifeVals = disks.map(d => ({ d, v: M.value(d, 'life') })).filter(x => x.v != null);
    const tempVals = disks.map(d => ({ d, v: M.value(d, 'temp') })).filter(x => x.v != null);
    const minLife = lifeVals.length ? lifeVals.reduce((a, b) => (b.v < a.v ? b : a)) : null;
    const maxTemp = tempVals.length ? tempVals.reduce((a, b) => (b.v > a.v ? b : a)) : null;
    const volOut = [...this.ctl.values()].filter(c => c.volBad).length;
    const bbuFail = bbus.map(b => M.bbuState(b)).filter(b => b.failed).length;
    const perHost = hosts.map(h => h.disks.size + ' ' + Pipes.shortHost(h.name).replace(/dc\d+$/i, '')).join(' + ');
    const where = x => `<span class="dim">${esc(x.d.host)} (Slot ${esc(x.d.id)})</span>`;
    const tColor = maxTemp ? M.tempColor(maxTemp.v) : COLORS.info;

    return `<div class="grid6">
      ${this.kpiTpl({ label: 'Servidores selecionados', icon: 'server', acc: COLORS.info, value: hosts.length, unit: 'hosts', foot: esc(this.selected.join(' / ')) })}
      ${this.kpiTpl({ label: 'Discos descobertos', icon: 'disk', acc: COLORS.info, value: this.allDisks.length, unit: 'SSDs', foot: esc(perHost) })}
      ${this.kpiTpl({
        label: 'Volumes fora de optimal', icon: 'shield', acc: volOut ? COLORS.crit : COLORS.ok, value: volOut, color: volOut ? COLORS.crit : COLORS.ok,
        extra: volOut ? '<span class="bdg crit">DEGRADADO</span>' : '<span class="bdg solidok">100% OK</span>',
        foot: volOut ? `<span class="c-crit">● ${volOut} volume(s) com alerta</span>` : '<span class="c-ok">● Todos os volumes Optimal</span>'
      })}
      ${this.kpiTpl({
        label: 'Baterias com falha', icon: 'battery', acc: bbuFail ? COLORS.crit : COLORS.ok, value: bbuFail, color: bbuFail ? COLORS.crit : COLORS.ok, alert: bbuFail > 0,
        extra: bbuFail ? '<span class="bdg crit">CRÍTICO</span>' : bbus.length ? '<span class="bdg solidok">OK</span>' : '',
        foot: bbuFail ? `<span class="c-crit">Substituição Necessária (${bbuFail}/${bbus.length})</span>`
          : bbus.length ? `<span class="c-ok">${bbus.length}/${bbus.length} baterias saudáveis</span>` : '<span class="dim">Sem itens BBU</span>'
      })}
      ${this.kpiTpl({
        label: 'Menor vida (SSD)', icon: 'gauge', acc: minLife ? M.lifeColor(minLife.v) : COLORS.info,
        value: minLife ? fmtN(minLife.v) + '%' : '—', color: minLife ? M.lifeColor(minLife.v) : COLORS.txt,
        unit: minLife ? `&gt;${th.lifeCrit}% Limiar` : '', foot: minLife ? where(minLife) : '<span class="dim">Sem item de vida</span>'
      })}
      ${this.kpiTpl({
        label: 'Maior temp. SSD', icon: 'thermo', acc: tColor,
        value: maxTemp ? fmtN(maxTemp.v) + ' °C' : '—', color: maxTemp ? tColor : COLORS.txt,
        unit: !maxTemp ? '' : maxTemp.v >= th.tempCrit ? `≥ ${th.tempCrit} °C Crítico` : maxTemp.v >= th.tempWarn ? `≥ ${th.tempWarn} °C Atenção` : `&lt; ${th.tempCrit} °C Normal`,
        foot: maxTemp ? where(maxTemp) : ''
      })}
    </div>`;
  }

  // ---- <sh-host-card> ----
  hostCardsTpl() {
    const cards = this.selectedHosts.map(h => {
      const c = this.ctl.get(h.name), inf = c.info, n = c.disks.length;
      const pct = n ? Math.round(c.online / n * 100) : 0;
      const stale = Date.now() - h.lastTs > this.th.staleMinutes * 60e3;
      const bbuBadge = !h.bbus.size ? '<span class="bdg mute">SEM BBU</span>'
        : c.bbuFailed ? `<span class="bdg crit">${Icons('alert', '', 'width:11px;height:11px')} BBU FAILED</span> <span class="c-crit">Substituição Obrigatória</span>`
        : c.bbuDeg ? '<span class="bdg warn">BBU DEGRADADA</span> <span class="c-warn">Verificar ciclo de aprendizado</span>'
        : '<span class="bdg ok">BBU OK</span> <span class="c-ok">Bateria saudável</span>';
      return `<div class="pnl hc">
        <div class="hc-h">${Icons('server', '', 'color:#D8D9DA')}<span class="nm">${esc(h.name)}</span><span class="meta">${esc(inf.modelo)}</span><span class="sp"></span>
          <span class="pill" style="color:#aac7ff">${esc(inf.controladora)}${inf.firmware ? ' (FW: ' + esc(inf.firmware) + ')' : ''}</span></div>
        <div class="hc-b">
          <div>
            <div class="lbl">Volume RAID principal</div>
            <div class="kv">${c.volBad ? '<span class="bdg critl">Degraded</span>' : '<span class="bdg ok" style="text-transform:none">Optimal</span>'} <b class="hi">${esc(inf.raid)}</b></div>
            <div class="kv dim">Capacidade: <b class="hi">${esc(inf.capacidade)}</b>${inf.composicao ? ' (' + esc(inf.composicao) + ')' : ''}</div>
            <div class="kv ${pct === 100 ? 'c-ok' : 'c-warn'}">${n} Discos Descobertos / ${c.online} Online (${pct}%)</div>
          </div>
          <div>
            <div class="lbl">Controladora &amp; cache</div>
            <div class="kv">${bbuBadge}</div>
            <div class="kv dim">Cache: <span class="bdg ${c.writeThrough ? 'warn' : 'ok'}" style="text-transform:none">${esc(c.cacheNow)}</span> (Padrão: ${esc(inf.cachePadrao)})</div>
            ${c.writeThrough
              ? `<div class="kv c-warn">${c.bbuFailed ? 'Downgrade de segurança ativado por falha na BBU' : 'Política de cache degradada (trigger ativa)'}</div>`
              : '<div class="kv c-ok">Cache de escrita protegido por BBU</div>'}
          </div>
        </div>
        <div class="hc-f"><span><span class="dot ${stale ? 'crit' : ''}"></span> MegaCLI Zabbix Agent — ${h.items} itens de storage</span><span>Poll síncrono: ${Pipes.ago(h.lastTs)}</span></div>
      </div>`;
    }).join('');
    return `<div class="grid2">${cards}</div>
      <div class="note">${Icons('info', '', 'width:13px;height:13px')} Aviso: A saúde dos componentes é independente (Volume Optimal vs BBU Failed). Estados correspondem à última coleta síncrona via MegaCLI.</div>`;
  }

  // ---- <sh-slot-map> ----
  slotMapTpl() {
    const M = this.model;
    const groups = this.selectedHosts.map((h, i) => {
      const all = M.sortedDisks(h);
      const ds = all.filter(d => this.state.disk === 'all' || this.state.disk === this.diskKey(d));
      if (!ds.length) return '';
      return `<div class="hostlbl"><span class="dot" style="background:${i % 2 ? COLORS.info : '#D8D9DA'}"></span>${esc(h.name)}
          <span class="dim">— ${h.disks.size} Slots Reportados (${all.map(d => esc(d.id)).join(', ')})</span></div>
        <div class="grid4">${ds.map(d => this.slotTpl(d)).join('')}</div>`;
    }).join('');
    return `<div class="pnl">
      <div class="ph"><h2>${Icons('chip', '', 'color:#D8D9DA')} Mapeamento de Baias &amp; Slots Lógicos da PERC</h2><span class="sp"></span>
        <span class="meta">Slots reportados pela controladora (numeração lógica de hardware, não reflete necessariamente posição física de baias)</span></div>
      ${groups}
    </div>`;
  }

  slotTpl(d) {
    const M = this.model, st = M.diskState(d), life = M.value(d, 'life'), temp = M.value(d, 'temp');
    const sn = M.text(d, 'serial') || M.text(d, 'model') || 'SSD ' + (d.label || d.id);
    return `<div class="slot ${st.cls === 'crit' ? 'crit' : st.cls === 'warn' ? 'warn' : ''}">
      <div class="t">Slot ${esc(d.id)}<span class="bdg ${st.cls}">${esc(st.txt)}</span></div>
      <div class="sn" title="${esc(sn)}">${esc(sn)}</div>
      <div class="m"><span class="dim">Temp: <b class="hi ${M.tempCls(temp)}">${temp == null ? '—' : fmtN(temp) + ' °C'}</b></span>
        <span class="dim">Vida: <b class="${M.lifeCls(life)}">${life == null ? '—' : fmtN(life) + '%'}</b></span></div>
      ${this.barTpl(life, M.lifeColor(life))}
    </div>`;
  }

  // ---- <sh-chart> SSD ----
  ssdChartsTpl() {
    const M = this.model, th = this.th, disks = this.disks;
    const temp = disks.filter(d => d.m.temp).map((d, i) => ({ name: this.diskName(d), color: SERIES_COLORS[i % SERIES_COLORS.length], pts: M.points(d.m.temp), unit: '°C' }));
    const life = disks.filter(d => d.m.life).map((d, i) => ({ name: this.diskName(d), color: SERIES_COLORS[(i + 3) % SERIES_COLORS.length], pts: M.points(d.m.life, d.m.life.inv), unit: '%' }));
    const tv = temp.flatMap(s => s.pts.map(p => p[1]));
    const yMin = Math.min(25, tv.length ? Math.floor((Math.min(...tv) - 5) / 10) * 10 : 25);
    const yMax = Math.max(th.tempCrit + 5, tv.length ? Math.ceil((Math.max(...tv) + 5) / 5) * 5 : 60);
    // vida: aproxima a escala dos valores reais (limiar de troca aparece quando estiver na faixa)
    const lv = life.flatMap(s => s.pts.map(p => p[1]));
    const lMin = lv.length ? Math.max(0, Math.min(Math.floor((Math.min(...lv) - 10) / 10) * 10, 60)) : 0;
    return `<div class="grid2">
      <div class="pnl">
        <div class="ph"><h2>${Icons('thermo', '', 'color:#FF9830')} Temperatura dos SSDs ao Longo do Tempo (°C)</h2><span class="sp"></span><span class="pill warn">Limiar Crítico: ${th.tempCrit} °C</span></div>
        ${this.chartTpl({
          id: 'ssd-temp', series: temp, yMin, yMax, step: 10, unit: '°C', h: 200, status: v => M.tempColor(v),
          th: [{ v: th.tempWarn, label: `Atenção ${th.tempWarn} °C`, color: COLORS.warn }, { v: th.tempCrit, label: `Threshold ${th.tempCrit} °C`, color: COLORS.crit, zone: 'above' }]
        })}
      </div>
      <div class="pnl">
        <div class="ph"><h2>${Icons('pct', '', 'color:#5794F2')} Vida Restante Estimada dos SSDs (% MWI)</h2><span class="sp"></span><span class="pill warn">Alerta Desgaste: &lt; ${th.lifeCrit}%</span></div>
        ${this.chartTpl({
          id: 'ssd-life', series: life, yMin: lMin, yMax: 100, step: 100 - lMin > 40 ? 20 : 10, unit: '%', h: 200, status: v => M.lifeColor(v),
          th: [{ v: th.lifeCrit, label: `${th.lifeCrit}% Limiar Troca`, color: COLORS.crit, zone: 'below' }]
        })}
      </div>
    </div>
    <div class="note">${Icons('info', '', 'width:13px;height:13px')} Nota técnica: A vida restante é calculada a partir do atributo SMART Media Wearout Indicator dos SSDs. Não representa espaço em disco livre/utilizado.</div>`;
  }

  // ---- <sh-table> inventário ----
  inventoryTpl() {
    const M = this.model, disks = this.disks;
    const rows = disks.length ? disks.map(d => {
      const st = M.diskState(d), life = M.value(d, 'life'), temp = M.value(d, 'temp'), poh = M.value(d, 'poh');
      return `<tr>
        <td class="h">${esc(d.host)}</td>
        <td class="l">Slot ${esc(d.id)}</td>
        <td class="m">${esc(M.text(d, 'serial') || '—')}</td>
        <td><span class="bdg ${st.cls}">${esc(st.txt)}</span></td>
        <td class="${M.tempCls(temp)}">${temp == null ? '—' : fmtN(temp) + ' °C'}</td>
        <td><span class="ibar">${this.barTpl(life, M.lifeColor(life))}<b class="${M.lifeCls(life)}">${life == null ? '—' : fmtN(life) + '%'}</b></span></td>
        <td class="dim">${poh == null ? '—' : fmtN(poh) + 'h'}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="7" class="empty">Nenhum disco no filtro atual</td></tr>';
    return `<div class="pnl">
      <div class="ph"><h2>Inventário e Telemetria Detalhada dos ${disks.length} SSDs</h2><span class="sp"></span><span class="meta">Smartctl / MegaCLI -adpallinfo / -pdlist -aALL</span></div>
      <div class="tablewrap"><table class="tb">
        <thead><tr><th>Servidor</th><th>Slot lógico</th><th>Número de série</th><th>Estado</th><th>Temperatura</th><th>Vida útil restante</th><th>Horas ligado (POH)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  }

  // ---- <sh-counter> SMART / MegaCLI ----
  aggregate(k) {
    const M = this.model, ds = this.disks.filter(d => d.m[k]);
    if (!ds.length) return null;
    return {
      tot: ds.reduce((a, d) => a + (M.value(d, k) || 0), 0),
      dl: ds.reduce((a, d) => a + (M.delta(d, k) || 0), 0),
      where: ds.filter(d => (M.value(d, k) || 0) > 0).map(d => `${Pipes.shortHost(d.host)} s${d.id}`)
    };
  }

  smartTpl() {
    const smart = [
      { k: 'realloc', label: 'NAND Reallocated', sev: 'crit', ok: 'Nenhum bloco realocado', bad: x => `${fmtN(x.tot)} blocos (${x.where.join(', ')})` },
      { k: 'uncorr', label: 'Erros Incorrigíveis', sev: 'crit', ok: '0 Uncorrectable ECC', bad: x => `ECC em ${x.where.join(', ')}` },
      { k: 'pending', label: 'ECC Pendentes', sev: 'crit', ok: 'Current Pending Sector 0', bad: x => `Pendentes: ${x.where.join(', ')}` },
      { k: 'crc', label: 'CRC Interface (UDMA)', sev: 'warn', ok: 'Sem erros de interface', bad: x => `${x.where.join(', ')} (${x.dl ? 'Δ ' + fmtN(x.dl) : 'Estável'})` },
      { k: 'powerloss', label: 'Perda Inesp. Energia', sev: 'none', ok: 'Nenhum evento', bad: () => 'Contador acumulado' },
      { k: 'progerase', label: 'Program / Erase Fail', sev: 'crit', ok: 'NAND sem falha física', bad: x => `Falha em ${x.where.join(', ')}` }
    ];
    const hw = [
      { k: 'media', label: 'Media Error Count', ok: 'Zero Setores Defeituosos', bad: x => `${fmtN(x.tot)} erro(s): ${x.where.join(', ')}` },
      { k: 'other', label: 'Other Error Count', ok: 'Sem falhas de barramento', bad: x => `${fmtN(x.tot)} erro(s): ${x.where.join(', ')}` },
      { k: 'pred', label: 'Predictive Failure Count', ok: 'Nenhum disco em SMART Trip', bad: x => `SMART Trip: ${x.where.join(', ')}` }
    ];
    return `<div class="pnl">
      <div class="ph"><h2>${Icons('shield', '', 'color:#D8D9DA')} Painel de Confiabilidade &amp; Telemetria SMART / MegaCLI</h2><span class="sp"></span>
        <span class="pill">Exibindo contadores acumulados e variações do período (Δ)</span></div>
      <div class="sub first">Contadores SMART de desgaste e integridade</div>
      <div class="grid6">${smart.map(c => this.smartCounterTpl(c)).join('')}</div>
      <div class="sub">Contadores de hardware da controladora (LSI MegaRAID SAS-2 / PERC)</div>
      <div class="grid3">${hw.map(c => this.hwCounterTpl(c)).join('')}</div>
    </div>`;
  }

  smartCounterTpl({ k, label, sev, ok, bad }) {
    const x = this.aggregate(k);
    if (!x) return `<div class="ctr"><div class="l">${label}</div><div class="v"><b class="dim3">—</b><span></span></div><div class="s dim">Item não coletado</div></div>`;
    const isBad = x.tot > 0;
    const col = !isBad ? COLORS.ok : sev === 'crit' ? COLORS.crit : sev === 'warn' ? COLORS.warn : COLORS.txt;
    return `<div class="ctr"><div class="l">${label}</div>
      <div class="v"><b style="color:${col}">${fmtN(x.tot)}</b><span>Δ ${fmtN(x.dl)}</span></div>
      <div class="s" style="color:${isBad ? (sev === 'none' ? '#8E8E93' : col) : COLORS.ok}">${esc(isBad ? bad(x) : ok)}</div></div>`;
  }

  hwCounterTpl({ k, label, ok, bad }) {
    const x = this.aggregate(k);
    if (!x) return `<div class="ctr wide"><div class="l">${label}</div><div class="v"><b class="dim3">—</b><span class="pill">Item não coletado</span></div></div>`;
    const isBad = x.tot > 0;
    return `<div class="ctr wide"><div class="l">${label}</div>
      <div class="v"><b style="color:${isBad ? (k === 'other' ? COLORS.warn : COLORS.crit) : COLORS.ok}">${fmtN(x.tot)}</b>
      <span class="pill ${isBad ? 'crit' : 'ok'}">${esc(isBad ? bad(x) : ok)}</span></div></div>`;
  }

  // ---- <sh-table> volumes virtuais ----
  volumesTpl() {
    const M = this.model;
    const anyWT = [...this.ctl.values()].some(c => c.writeThrough);
    const rows = this.selectedHosts.map(h => {
      const c = this.ctl.get(h.name), inf = c.info;
      const media = c.disks.reduce((a, d) => a + (M.value(d, 'media') || 0), 0);
      return `<tr>
        <td class="h">${esc(h.name)}</td>
        <td class="l">${esc(inf.vd)}</td>
        <td class="hi b">${esc(inf.raid)}</td>
        <td class="hi">${esc(inf.capacidade)}</td>
        <td>${c.volBad ? '<span class="bdg critl">Degraded</span>' : '<span class="bdg ok" style="text-transform:none">Optimal</span>'}</td>
        <td class="${media ? 'c-crit' : 'c-ok'}">${media ? 'Sim (' + fmtN(media) + ')' : 'No'}</td>
        <td class="dim">${esc(inf.cachePadrao)}</td>
        <td>${c.writeThrough
          ? `<span class="bdg warn" style="text-transform:none">WriteThrough${c.bbuFailed ? ' (Fallback BBU)' : ''}</span>`
          : `<span class="bdg ok" style="text-transform:none">${esc(inf.cachePadrao)}</span>`}</td>
      </tr>`;
    }).join('');
    return `<div class="pnl">
      <div class="ph"><h2>${Icons('grid', '', 'color:#5794F2')} Volumes Virtuais (RAID) e Políticas de Cache em Execução</h2><span class="sp"></span><span class="meta">MegaCLI -LDInfo -Lall -aALL</span></div>
      <div class="tablewrap"><table class="tb">
        <thead><tr><th>Servidor</th><th>Volume virtual</th><th>Nível RAID</th><th>Capacidade</th><th>Estado operacional</th><th>Bad blocks</th><th>Cache padrão</th><th>Cache atual efetivo</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${anyWT ? `<div class="warnline">${Icons('warn', '', 'width:13px;height:13px')} Aviso da Controladora: Cache de escrita com downgrade automático para WriteThrough ativado para proteção contra perda de dados em falta de energia enquanto as BBUs estiverem inoperantes.</div>` : ''}
    </div>`;
  }

  // ---- <sh-bbu-card> ----
  bbuTpl() {
    const M = this.model, th = this.th, bbus = this.bbus;
    const fail = bbus.filter(b => M.bbuState(b).failed).length;
    const charge = bbus.filter(b => b.m.charge).map((b, i) => ({ name: this.bbuName(b), color: SERIES_COLORS[(i + 1) % SERIES_COLORS.length], pts: M.points(b.m.charge), unit: '%' }));
    const temp = bbus.filter(b => b.m.temp).map((b, i) => ({ name: this.bbuName(b), color: SERIES_COLORS[(i * 3) % SERIES_COLORS.length], pts: M.points(b.m.temp), unit: '°C' }));
    const tv = temp.flatMap(s => s.pts.map(p => p[1]));
    const tMin = Math.min(20, tv.length ? Math.floor(Math.min(...tv) / 5) * 5 - 5 : 20);
    const tMax = Math.max(th.bbuTempCrit + 5, tv.length ? Math.ceil(Math.max(...tv) / 5) * 5 + 5 : 60);
    const status = !bbus.length ? '<span class="pill">Sem itens BBU</span>'
      : fail ? `<span class="pill crit">${fail}/${bbus.length} Baterias em Falha de Hardware</span>`
      : `<span class="pill ok">${bbus.length}/${bbus.length} Baterias Operacionais</span>`;
    return `<div class="pnl${fail ? ' alert' : ''}">
      <div class="ph"><h2>${Icons('battery', '', 'color:#F2495C')} Telemetria de Baterias de Backup (LSI iBBU / PERC)</h2><span class="sp"></span>${status}</div>
      <div class="grid2">${bbus.map(b => this.bbuCardTpl(b)).join('')}</div>
      <div class="grid2" style="margin-top:10px">
        <div>
          <div class="ph sm"><h3>Carga da Bateria ao Longo do Tempo (%)</h3><span class="sp"></span><span class="meta">Zabbix · BBU: Carga</span></div>
          ${this.chartTpl({
            id: 'bbu-charge', series: charge, yMin: 0, yMax: 100, ticks: [0, th.bbuChargeCrit, th.bbuChargeWarn, 100], unit: '%', h: 150,
            status: v => (v < th.bbuChargeCrit ? COLORS.crit : v < th.bbuChargeWarn ? COLORS.warn : COLORS.ok),
            th: [{ v: th.bbuChargeWarn, label: `${th.bbuChargeWarn}%`, color: COLORS.warn }, { v: th.bbuChargeCrit, label: `${th.bbuChargeCrit}% crítico`, color: COLORS.crit, zone: 'below' }]
          })}
        </div>
        <div>
          <div class="ph sm"><h3>Temperatura das Baterias BBU (°C)</h3><span class="sp"></span><span class="meta">Zabbix · BBU: Temperatura</span></div>
          ${this.chartTpl({
            id: 'bbu-temp', series: temp, yMin: tMin, yMax: tMax, step: 10, unit: '°C', h: 150,
            status: v => (v >= th.bbuTempCrit ? COLORS.crit : v >= th.bbuTempWarn ? COLORS.warn : COLORS.ok),
            th: [{ v: th.bbuTempWarn, label: `Alerta ${th.bbuTempWarn} °C`, color: COLORS.warn }, { v: th.bbuTempCrit, label: `${th.bbuTempCrit} °C`, color: COLORS.crit, zone: 'above' }]
          })}
        </div>
      </div>
    </div>`;
  }

  bbuCardTpl(b) {
    const M = this.model, th = this.th, s = M.bbuState(b), inf = M.hostInfo(b.host);
    const stTxt = s.failed ? 'FAILED' : s.degraded ? 'DEGRADADA' : 'OPTIMAL';
    const stCls = s.failed ? 'critl' : s.degraded ? 'warn' : 'ok';
    const lowCap = s.ch != null && s.ch < th.bbuChargeWarn;
    const gColor = s.failed ? (s.ch != null && s.ch >= th.bbuChargeWarn ? COLORS.info : COLORS.crit) : s.degraded ? COLORS.warn : COLORS.ok;
    let msg;
    if (s.prob && s.ch != null && s.ch >= th.bbuChargeWarn) {
      msg = { t: `Atenção Operacional: Carga de ${fmtN(s.ch)}% não indica bateria saudável`, s: 'BBU reprovada por trigger ativa no Zabbix (impedância interna / ciclo de vida excedido no gas-gauge LSI).', c: COLORS.warn };
    } else if (s.failed) {
      msg = { t: lowCap ? 'Carga química degradada' : 'Falha de hardware da BBU', s: `Retenção de buffer comprometida (limiar operacional: ${th.bbuChargeCrit}%). Risco de perda de cache volátil.`, c: COLORS.crit };
    } else if (s.degraded) {
      msg = { t: 'Bateria em degradação', s: `Carga < ${th.bbuChargeWarn}% ou temperatura ≥ ${th.bbuTempWarn} °C. Acompanhar ciclo de aprendizado.`, c: COLORS.warn };
    } else {
      msg = { t: 'Bateria saudável', s: 'Carga e temperatura dentro dos limites operacionais.', c: COLORS.ok };
    }
    const yn = (v, bad) => `<b class="${bad ? 'c-crit' : 'c-ok'}">${v}</b>`;
    const tCls = s.tp == null ? '' : s.tp >= th.bbuTempCrit ? 'c-crit' : s.tp >= th.bbuTempWarn ? 'c-warn' : 'hi';
    return `<div class="bbu">
      <div class="bh"><span>${esc(b.host)} (${esc(inf.controladora)} BBU${b.id && !/^0?$/.test(b.id) ? ' ' + esc(b.id) : ''})</span><span class="bdg ${stCls}">${stTxt}</span></div>
      <div class="cells">
        <div class="cell">Substituição:${yn(s.failed ? 'SIM' : 'NÃO', s.failed)}</div>
        <div class="cell">Cap. Baixa:${yn(lowCap ? 'SIM' : 'NÃO', lowCap)}</div>
        <div class="cell">Saúde:${yn(s.failed ? 'REPROVADA' : s.degraded ? 'ATENÇÃO' : 'APROVADA', s.failed || s.degraded)}</div>
        <div class="cell">Temperatura:<b class="${tCls}">${s.tp == null ? '—' : fmtN(s.tp) + ' °C'}</b></div>
      </div>
      <div class="gz">${this.gaugeTpl(s.ch, gColor)}<div class="msg"><b style="color:${msg.c}">${esc(msg.t)}</b><span>${esc(msg.s)}</span></div></div>
    </div>`;
  }

  // ---- <sh-table> problemas ----
  problemsTpl() {
    const sel = this.selected;
    const component = d => (RX.bbu.test(d) ? 'BBU Battery'
      : RX.cache.test(d) || /virtual|raid|perc|controller|controladora|\bld\b/i.test(d) ? 'PERC Controller'
      : /ssd|slot|disk|disco|smart|media|predictive/i.test(d) ? 'SSD / Disco' : 'Hardware');
    const probs = this.model.problems.filter(p => p.hosts.some(h => sel.includes(h))).sort((a, b) => b.sev - a.sev || b.ts - a.ts);
    const rows = probs.length ? probs.map(p => {
      const s = SEVERITIES[Math.max(0, Math.min(5, p.sev))] || SEVERITIES[0];
      return `<tr>
        <td><span class="bdg ${s[1]}">${s[0]}</span></td>
        <td class="h">${esc(p.hosts.filter(h => sel.includes(h)).join(', '))}</td>
        <td class="dim">${component(p.desc)}</td>
        <td style="color:${p.sev >= 4 ? COLORS.crit : p.sev >= 2 ? COLORS.warn : '#D8D9DA'}">${esc(p.desc)}</td>
        <td class="dim">${p.ts ? Pipes.age(p.ts) : '—'}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="5" class="empty"><span class="c-ok">✓ Nenhum problema de storage ativo para os hosts selecionados</span></td></tr>';
    return `<div class="pnl">
      <div class="ph"><h2>${Icons('bell', '', 'color:#F2495C')} Problemas Ativos no Zabbix (Triggers Disparadas)</h2><span class="sp"></span><span class="meta">${probs.length} problema(s) · ${esc(this.config.zabbixLabel)}</span></div>
      <div class="tablewrap"><table class="tb">
        <thead><tr><th>Severidade</th><th>Host</th><th>Componente</th><th>Descrição do problema</th><th>Idade</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  }

  // ---- <sh-diagnostics> ----
  diagnosticsTpl() {
    const stale = this.stale, hosts = this.selectedHosts;
    const items = hosts.reduce((a, h) => a + h.items, 0);
    return `<div class="pnl">
      <div class="ph"><h2>${Icons('term', '', 'color:#73BF69')} Diagnóstico da Coleta</h2><span class="sp"></span>${stale ? '<span class="bdg crit">STALE</span>' : '<span class="bdg ok">CRON OK</span>'}</div>
      <div class="kvl" style="display:block">Arquivo de saída:<br/><b>${esc(this.config.outputFile)}</b></div>
      <div class="kvl">Última execução: <b class="${stale ? 'c-crit' : 'c-ok'}">${Pipes.ago(this.lastTs).replace('há ', 'Há ')} (${stale ? 'ATRASO' : 'OK'})</b></div>
      <div class="kvl">Limiar de stale file: <b>${this.th.staleMinutes} minutos</b></div>
      <div class="kvl">Estado da sincronização: <b class="${stale ? 'c-crit' : 'c-ok'}">${stale ? 'Dessincronizado' : 'Sincronizado'}</b></div>
      <div class="kvl">Itens coletados (Zabbix): <b class="c-ok">${items} itens / ${hosts.length} host(s)</b></div>
      <div class="daemon">${Icons('code', '', 'width:12px;height:12px')} ${esc(this.config.daemon)}</div>
    </div>`;
  }
}

// -----------------------------------------------------------------------------
// Bootstrap — HTML graphics chama onRender a cada atualização de dados/tamanho.
// O estado de filtros fica no htmlNode para sobreviver entre renders.
// -----------------------------------------------------------------------------
// Fontes: o Grafana já carrega Inter e Roboto Mono; o link abaixo é só fallback
// (@font-face não funciona dentro do Shadow DOM, por isso vai no <head>).
if (!document.getElementById('sh-fonts')) {
  const link = document.createElement('link');
  link.id = 'sh-fonts';
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto+Mono:wght@400;500;600;700&display=swap';
  document.head.appendChild(link);
}

if (htmlNode.getElementById('sh-root')) {
  const state = htmlNode.__shState || (htmlNode.__shState = { hosts: null, disk: 'all' });
  new StorageHealthComponent(htmlNode, state).ngOnChanges({
    data,
    codeData: typeof codeData !== 'undefined' ? codeData : {}
  });
}
