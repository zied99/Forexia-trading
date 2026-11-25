#!/usr/bin/env node
/* Forexia — serveur MCP (Model Context Protocol).
 *
 * Donne à un agent IA (Claude Code, Claude Desktop, ou tout client MCP) l'accès au moteur de Forexia :
 * backtests, lots de périodes aléatoires, « Améliorer », test sur d'autres paires, recommandations,
 * stratégies enregistrées, génération de l'Expert Advisor MT5 et, si la passerelle tourne sur le PC,
 * données du courtier, déploiement et test dans MetaTrader 5.
 *
 * Aucune dépendance : Node.js 18 ou plus.
 *   node mcp/forexia-mcp.js                    transport stdio (Claude Code / Claude Desktop)
 *   node mcp/forexia-mcp.js --http 3333        transport HTTP « streamable » sur http://127.0.0.1:3333/mcp
 *        [--host 0.0.0.0] [--token SECRET]     (jeton exigé : en-tête Authorization: Bearer SECRET)
 * Variables d'environnement :
 *   FOREXIA_MCP_DATA      dossier des stratégies et évaluations (défaut : ~/.forexia-mcp)
 *   FOREXIA_BRIDGE_URL    passerelle MT5 (défaut : http://127.0.0.1:8787)
 *   FOREXIA_BRIDGE_TOKEN  code d'appairage de la passerelle (ex. ABCD-EFGH) pour les outils MT5
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

// ---------------------------------------------------------------- moteur Forexia (mêmes fichiers que le site)
const ROOT = path.join(__dirname, '..');
for (const f of ['indicators', 'expr', 'trade', 'backtest', 'data', 'presets', 'french', 'enhancer', 'mql5', 'broker', 'advisor', 'analyzer', 'events', 'confidence', 'fxcore']) {
  require(path.join(ROOT, 'js', f + '.js'));
}
const F = globalThis.Forexia;
const D = F.data, B = F.backtest, E = F.enhancer, R = F.rules, FR = F.french;
const VERSION = '1.3';

// ---------------------------------------------------------------- stockage local (stratégies, évaluations)
const DATA_DIR = process.env.FOREXIA_MCP_DATA || path.join(os.homedir(), '.forexia-mcp');
function readJson(name, def) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')); } catch (e) { return def; }
}
function writeJson(name, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const p = path.join(DATA_DIR, name), tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  fs.renameSync(tmp, p);
}
const store = {
  strategies: () => readJson('strategies.json', []),
  setStrategies: (l) => writeJson('strategies.json', l),
  evaluations: () => readJson('evaluations.json', []),
  setEvaluations: (l) => writeJson('evaluations.json', l),
};

// ---------------------------------------------------------------- outils communs
const RULES = ['longEntry', 'longExit', 'shortEntry', 'shortExit'];
const TM = ['stopLossPips', 'takeProfitPips', 'stopAtr', 'takeAtr', 'atrPeriod', 'trailPips', 'trailAtr', 'breakevenPips', 'breakevenAtr', 'maxBars', 'pauseLosses', 'pauseBars'];
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v === Infinity ? 'infini' : v);
const iso = (d) => D.iso(d);
const today = () => new Date(iso(new Date()) + 'T00:00:00Z');
class UserError extends Error {}
const fail = (msg) => { throw new UserError(msg); };

/** Stratégie à partir de : {saved: nom} | {preset: id} | {frenchText} | règles techniques ; les champs fournis remplacent. */
function resolveStrategy(s) {
  if (!s || typeof s !== 'object') fail('« strategy » manquante.');
  let base = {};
  if (s.saved) {
    base = store.strategies().find((x) => x.name === s.saved);
    if (!base) fail('Stratégie enregistrée introuvable : « ' + s.saved + ' ». Outil list_strategies pour la liste.');
  } else if (s.preset) {
    base = F.presets.list.find((x) => x.id === s.preset);
    if (!base) fail('Modèle inconnu : « ' + s.preset + ' ». Outil list_presets pour la liste.');
  }
  const out = Object.assign({}, base);
  delete out.config; delete out.lastResult; delete out.description;
  if (s.frenchText && !RULES.some((k) => s[k])) {
    const p = FR.parse(s.frenchText);
    if (!p.longEntry && !p.shortEntry) fail('Texte français non compris : ' + p.warnings.join(' '));
    for (const k of RULES.concat(TM)) out[k] = p[k] || (TM.includes(k) ? 0 : '');
    out.frenchText = s.frenchText;
  }
  for (const k of RULES) if (s[k] !== undefined) out[k] = String(s[k] || '');
  for (const k of TM) if (s[k] !== undefined) out[k] = Number(s[k]) || 0;
  out.name = s.name || out.name || 'Stratégie agent';
  out.style = s.style || out.style || 'none';
  for (const k of RULES) {
    out[k] = out[k] || '';
    const err = R.validate(out[k]);
    if (err) fail('Règle « ' + k + ' » invalide : ' + err);
  }
  if (!out.longEntry && !out.shortEntry) fail('La stratégie n\'a aucune règle d\'entrée (longEntry ou shortEntry).');
  return out;
}
function strategyView(s) {
  const o = { name: s.name };
  for (const k of RULES) if (s[k]) o[k] = s[k];
  for (const k of TM) if (s[k]) o[k] = s[k];
  const fr = FR.toFrench(s);
  if (fr) o.frenchText = fr;
  return o;
}

// ---------------------------------------------------------------- données de cours
const cache = new Map();
async function onlineHistory(pair) {
  const key = 'online|' + pair + '|' + iso(today());
  if (!cache.has(key)) cache.set(key, D.fetchFrankfurter(pair, new Date(D.ECB_FIRST_DATE + 'T00:00:00Z'), today()));
  return cache.get(key);
}
function csvHistory(file) {
  const p = path.resolve(file), st = fs.statSync(p), key = 'csv|' + p + '|' + st.mtimeMs;
  if (!cache.has(key)) {
    const bars = D.parseCSV(fs.readFileSync(p, 'utf8'));
    cache.set(key, { bars: bars, timeframe: D.detectTimeframe(bars) });
  }
  return cache.get(key);
}
const BRIDGE = process.env.FOREXIA_BRIDGE_URL || 'http://127.0.0.1:8787';
async function bridge(method, p, body) {
  const token = process.env.FOREXIA_BRIDGE_TOKEN;
  if (!token) fail('Passerelle MT5 non configurée : définissez FOREXIA_BRIDGE_TOKEN (code d\'appairage affiché par la passerelle).');
  let res;
  try {
    res = await fetch(BRIDGE + p, { method: method, headers: Object.assign({ 'X-Forexia-Token': token }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  } catch (e) { fail('Passerelle MT5 injoignable sur ' + BRIDGE + ' : lancez demarrer-passerelle.bat sur le PC.'); }
  if (res.status === 401) fail('Code d\'appairage refusé par la passerelle (FOREXIA_BRIDGE_TOKEN).');
  return res.json();
}
async function bridgeTerminal() {
  const st = await bridge('GET', '/status');
  const t = (st.terminals || [])[0];
  if (!t) fail('MetaTrader 5 introuvable sur le PC de la passerelle.');
  return t;
}
const toBar = (r, intraday) => { const s = new Date(r[0] * 1000).toISOString(); return { t: r[0], date: intraday ? s.slice(0, 10) + ' ' + s.slice(11, 16) : s.slice(0, 10), open: r[1], high: r[2], low: r[3], close: r[4], spread: r[5] }; };
function subBars(sub) {
  if (!sub) return [];
  if (Array.isArray(sub)) return sub.map((x) => toBar(x, true));
  const out = new Array(sub.t.length);
  for (let i = 0; i < sub.t.length; i++) out[i] = { t: sub.t[i], open: sub.open[i], high: sub.high[i], low: sub.low[i], close: sub.close[i], spread: sub.spread[i] };
  return out;
}

/** Période : {period: '1m'|'2m'|'3m'|'6m'|'1y'|'2y'} ou {dateFrom, dateTo} (AAAA-MM-JJ). */
function rangeOf(m, endDefault) {
  if (m.dateFrom || m.dateTo) {
    if (!m.dateFrom || !m.dateTo) fail('Indiquez dateFrom et dateTo (AAAA-MM-JJ).');
    return D.customRange(m.dateFrom, m.dateTo);
  }
  const key = m.period || '1y';
  if (!D.PERIODS[key]) fail('period invalide (1m, 2m, 3m, 6m, 1y, 2y) ou utilisez dateFrom / dateTo.');
  const r = D.periodRange(key, endDefault || today());
  if (r.end > today()) r.end = today();
  return r;
}
async function loadMarket(m, range) {
  const pair = m.pair || 'EUR/USD';
  if (!D.PAIRS.includes(pair)) fail('Paire inconnue : ' + pair + '. Paires : ' + D.PAIRS.join(', '));
  const src = m.source || 'online';
  const between = (bars, from, to) => bars.filter((b) => { const d = String(b.date).slice(0, 10); return d >= iso(from) && d <= iso(to); });
  let bars, label, timeframe = 'D1', broker = null, symbol;
  if (src === 'synthetic') {
    bars = D.generateSynthetic(pair, range.fetchStart, range.end); label = 'Données simulées (marche aléatoire)';
  } else if (src === 'online') {
    const all = await onlineHistory(pair);
    bars = between(all, range.fetchStart, range.end);
    if (m.estimateWicks !== false) bars = D.estimateWicks(bars);
    label = 'Cours BCE journaliers' + (m.estimateWicks !== false ? ' + mèches estimées' : '');
  } else if (src === 'csv') {
    if (!m.csvPath) fail('source csv : indiquez csvPath (chemin du fichier sur la machine du serveur).');
    const c = csvHistory(m.csvPath);
    bars = between(c.bars, range.fetchStart, range.end); timeframe = c.timeframe; label = 'Fichier ' + path.basename(m.csvPath) + ' (' + timeframe + ')';
  } else if (src === 'broker') {
    const term = await bridgeTerminal();
    timeframe = m.timeframe || 'D1';
    symbol = m.symbol || pair.replace('/', '');
    const warm = timeframe === 'D1' ? 800 : 120;
    const from = new Date(range.start.getTime() - warm * 864e5), to = new Date(range.end.getTime() + 864e5);
    const r = await bridge('POST', '/bars', { terminalId: term.id, symbol: symbol, timeframe: timeframe, from: iso(from), to: iso(to), testFrom: iso(range.start), intrabar: m.intrabar !== false });
    if (!r.ok) fail(r.message || 'Données du courtier indisponibles.');
    bars = r.bars.map((x) => toBar(x, timeframe !== 'D1')).filter((b) => b.date.slice(0, 10) <= iso(range.end));
    broker = { spec: r.spec, account: r.account, conv: r.conv, sub: subBars(r.sub) };
    label = 'Courtier MT5 ' + r.account.server + ' · ' + r.symbol + ' ' + timeframe + ' · montants en ' + r.account.currency;
    symbol = r.symbol;
  } else fail('source inconnue : online | synthetic | csv | broker');
  const startIndex = D.indexFrom(bars, range.start);
  if (!bars.length || bars.length - startIndex < 10) fail('Pas assez de cotations sur la période (' + iso(range.start) + ' → ' + iso(range.end) + ').');
  return { bars: bars, startIndex: startIndex, label: label, timeframe: timeframe, broker: broker, symbol: symbol, pair: pair, source: src };
}
function settingsOf(m, md) {
  const w = m.withdraw || {};
  const s = {
    capital: m.capital || 10000, leverage: m.leverage || 10, exposurePct: m.exposurePct || 100,
    spreadPips: m.spreadPips != null ? m.spreadPips : D.TYPICAL_SPREAD[md.pair] || 1, pair: md.pair, startIndex: md.startIndex, timeframe: md.timeframe,
    sizing: m.sizing || 'backtest', fixedLots: m.fixedLots || 0.1, riskPct: m.riskPct || 1, commissionPerLot: m.commissionPerLot || 0,
  };
  if (w.mode === 'periodic') Object.assign(s, { withdrawMode: 'periodic', withdrawEvery: w.every || 'month', withdrawDays: Math.max(15, w.days || 30), withdrawType: w.type || 'pct', withdrawValue: w.value || 0 });
  else if (w.pct > 0) Object.assign(s, { withdrawPct: w.pct, withdrawShare: w.share || 100, withdrawWhen: w.when || 'close' });
  if (md.broker) Object.assign(s, { broker: md.broker, symbol: md.symbol, spreadMode: m.spreadMode || 'real', maxLots: m.maxLots || 1, maxSpreadPips: m.maxSpreadPips != null ? m.maxSpreadPips : 5 });
  return s;
}
function run(md, strat, settings) {
  return md.broker ? F.broker.runBrokerBacktest(md.bars, strat, settings, md.broker) : B.runBacktest(md.bars, strat, settings);
}
function statsView(st) {
  return {
    returnPct: r2(st.returnPct), finalEquity: r2(st.finalEquity), netProfit: r2(st.netProfit), maxDrawdownPct: r2(st.maxDrawdownPct),
    trades: st.trades, winRate: r2(st.winRate), profitFactor: r2(st.profitFactor), expectancy: r2(st.expectancy), sharpe: r2(st.sharpe),
    winMonthsPct: r2(st.winMonthsPct), months: st.months, maxLossStreak: st.maxLossStreak, timeInMarketPct: r2(st.timeInMarketPct),
    buyHoldPct: r2(st.buyHoldPct), totalCosts: r2(st.totalCosts), totalWithdrawn: r2(st.totalWithdrawn || 0), finalAccount: r2(st.finalAccount),
    score: r2(E.score(st)),
  };
}
function monthly(res, md) {
  const out = {}, w = res.wealth || res.equity;
  let prev = res.stats.initialCapital, key = null, end = prev;
  for (let j = 0; j < w.length; j++) {
    const k = String(md.bars[res.startIndex + j].date).slice(0, 7);
    if (key && k !== key) { out[key] = r2(((end - prev) / prev) * 100); prev = end; }
    key = k; end = w[j];
  }
  if (key) out[key] = r2(((end - prev) / prev) * 100);
  return out;
}
/** Enregistre la simulation dans l'historique (utilisé par recommend, comme l'onglet « Évaluation »). */
function record(strat, m, md, res) {
  const s = res.stats, w = m.withdraw || {};
  const e = {
    at: new Date().toISOString(), name: strat.name, pair: md.pair, from: String(md.bars[res.startIndex].date).slice(0, 10), to: String(md.bars[md.bars.length - 1].date).slice(0, 10),
    data: md.label, leverage: m.leverage || 10, capital: m.capital || 10000, returnPct: s.returnPct, maxDrawdownPct: s.maxDrawdownPct, winRate: s.winRate, trades: s.trades,
    profitFactor: Number.isFinite(s.profitFactor) ? s.profitFactor : null, withdrawn: s.totalWithdrawn || 0, source: 'mcp',
    strategy: strategyView(strat), config: { pair: md.pair, source: md.source, leverage: m.leverage || 10, capital: m.capital || 10000, exposurePct: m.exposurePct || 100,
      dateFrom: iso(md.range.start), dateTo: iso(md.range.end), withdraw: { on: !!(w.pct > 0 || w.mode === 'periodic'), mode: w.mode || 'threshold', pct: w.pct, share: w.share, when: w.when, every: w.every, days: w.days, type: w.type, value: w.value } },
  };
  e.key = e.at + '|' + e.name + '|' + Math.random().toString(36).slice(2, 7);
  const l = store.evaluations(); l.push(e); store.setEvaluations(l.slice(-5000));
  return e.key;
}
async function newsTimes(m, md) {
  const n = m.news, cur = md.pair.split('/'), min = n.impact === 'medium' ? 2 : 3;
  const t0 = Math.floor(D.barTime(md.bars[0])), t1 = Math.floor(D.barTime(md.bars[md.bars.length - 1])) + 2 * 86400;
  const r = await bridge('GET', '/calendar?from=' + t0 + '&to=' + t1);
  if (!r.ok) fail('Calendrier économique indisponible : ' + (r.message || '') + ' (outil mt5_export_calendar).');
  return r.events.filter((e) => cur.includes(e.currency) && e.importance >= min).map((e) => e.t).sort((a, b) => a - b);
}
async function backtest(stratIn, m, opt) {
  const strat = resolveStrategy(stratIn), range = rangeOf(m || {});
  const md = await loadMarket(m || {}, range); md.range = range;
  const settings = settingsOf(m || {}, md);
  if (m && m.news) settings.news = { times: await newsTimes(m, md), before: m.news.before != null ? m.news.before : 30, after: m.news.after != null ? m.news.after : 30, mode: m.news.mode || 'block' };
  const res = run(md, strat, settings);
  const key = opt && opt.record === false ? null : record(strat, m || {}, md, res);
  return { strat, md, settings, res, key };
}
function backtestView(b, opt) {
  const { strat, md, res } = b, o = opt || {};
  const out = {
    strategy: strategyView(strat), pair: md.pair, data: md.label, timeframe: md.timeframe,
    period: { from: String(md.bars[res.startIndex].date).slice(0, 10), to: String(md.bars[md.bars.length - 1].date).slice(0, 10), bars: md.bars.length - res.startIndex },
    stats: statsView(res.stats), monthlyReturnsPct: monthly(res, md),
    exitReasons: res.trades.reduce((a, t) => { a[t.reason] = (a[t.reason] || 0) + 1; return a; }, {}),
  };
  if (res.withdrawals && res.withdrawals.length) out.withdrawals = res.withdrawals.map((w) => ({ date: w.date, amount: r2(w.amount) }));
  if (res.notes && res.notes.length) out.notes = res.notes;
  if (res.diag) out.diagnostics = res.diag;
  if (o.includeTrades) out.trades = res.trades.slice(-(o.maxTrades || 50)).map((t) => ({ dir: t.dir > 0 ? 'achat' : 'vente', entry: t.entryDate, exit: t.exitDate, entryPrice: t.entryPrice, exitPrice: t.exitPrice, pips: r2(t.pips), pnl: r2(t.pnl), reason: t.reason }));
  if (b.key) out.evaluationKey = b.key;
  return out;
}

// ---------------------------------------------------------------- périodes aléatoires
const DURATIONS = [1, 2, 3, 4, 6, 9, 12, 18, 24, 36, 48, 60];
function randomRange(src, duration, csvSpan) {
  const day = 864e5;
  let min = new Date(src === 'broker' ? '2015-01-01T00:00:00Z' : src === 'synthetic' ? '2005-01-01T00:00:00Z' : '2001-01-01T00:00:00Z'), max = today();
  if (csvSpan) { min = D.addMonths(csvSpan.first, 12); max = csvSpan.last; }
  const d = duration || {}, n = Number(d.months) || 0;
  let pool = d.kind === 'exact' ? [n] : d.kind === 'min' ? DURATIONS.filter((x) => x >= n) : d.kind === 'max' ? DURATIONS.filter((x) => x <= n) : DURATIONS.filter((x) => x <= 24);
  pool = pool.filter((x) => x > 0 && D.addMonths(min, x) <= max);
  if (!pool.length) fail('Historique trop court pour cette durée.');
  const months = pool[Math.floor(Math.random() * pool.length)];
  const latest = new Date(Math.min(D.addMonths(max, -months).getTime(), max.getTime() - 32 * day));
  const start = new Date(min.getTime() + Math.floor((Math.random() * Math.max(0, latest - min)) / day) * day);
  const end = new Date(Math.min(Math.max(D.addMonths(start, months).getTime() - day, start.getTime() + 31 * day), max.getTime()));
  return { dateFrom: iso(start), dateTo: iso(end), months: months };
}

// ---------------------------------------------------------------- outils MCP
const strategySchema = {
  type: 'object', description: 'Stratégie : {saved: "nom"} (enregistrée), {preset: "macd"} (modèle), {frenchText: "Acheter quand …"} ou règles techniques. Les champs fournis remplacent ceux de la base.',
  properties: {
    name: { type: 'string' }, saved: { type: 'string' }, preset: { type: 'string' }, frenchText: { type: 'string' },
    longEntry: { type: 'string', description: 'ex. CROSS_UP(RSI(14), 30) AND CLOSE > EMA(200)' }, longExit: { type: 'string' },
    shortEntry: { type: 'string' }, shortExit: { type: 'string' },
    stopLossPips: { type: 'number' }, takeProfitPips: { type: 'number' }, stopAtr: { type: 'number' }, takeAtr: { type: 'number' }, atrPeriod: { type: 'number' },
    trailPips: { type: 'number' }, trailAtr: { type: 'number' }, breakevenPips: { type: 'number' }, breakevenAtr: { type: 'number' },
    maxBars: { type: 'number' }, pauseLosses: { type: 'number' }, pauseBars: { type: 'number' },
    style: { type: 'string', enum: ['none', 'scalping', 'short', 'medium', 'long'] },
  },
};
const marketSchema = {
  type: 'object', description: 'Marché, période, capital et réglages de simulation.',
  properties: {
    pair: { type: 'string', description: 'ex. EUR/USD (voir forexia_help)' },
    source: { type: 'string', enum: ['online', 'synthetic', 'csv', 'broker'], description: 'online = cours BCE journaliers (défaut) ; synthetic = marche aléatoire (tests hors ligne) ; csv = fichier ; broker = données du courtier via la passerelle MT5 (identique au testeur MT5)' },
    period: { type: 'string', enum: ['1m', '2m', '3m', '6m', '1y', '2y'], description: 'jusqu\'à aujourd\'hui (défaut 1y)' },
    dateFrom: { type: 'string', description: 'AAAA-MM-JJ (avec dateTo, remplace period)' }, dateTo: { type: 'string' },
    capital: { type: 'number' }, leverage: { type: 'number' }, exposurePct: { type: 'number' }, spreadPips: { type: 'number' },
    sizing: { type: 'string', enum: ['backtest', 'fixed', 'risk'] }, fixedLots: { type: 'number' }, riskPct: { type: 'number' }, commissionPerLot: { type: 'number' },
    withdraw: { type: 'object', description: 'Retrait fictif : {pct, share, when: immediate|close} (au seuil de gain) ou {mode: "periodic", every: month|days, days, type: pct|fixed|excess, value}' },
    csvPath: { type: 'string' }, estimateWicks: { type: 'boolean' },
    symbol: { type: 'string', description: 'broker : symbole MT5 (ex. EURUSD)' }, timeframe: { type: 'string', enum: ['M15', 'M30', 'H1', 'H4', 'D1'] },
    news: { type: 'object', description: 'Filtre des annonces économiques (calendrier MT5, passerelle requise) : {before, after (minutes), mode: block|close, impact: high|medium}' },
    intrabar: { type: 'boolean' }, spreadMode: { type: 'string', enum: ['real', 'fixed', 'add'] }, maxLots: { type: 'number' }, maxSpreadPips: { type: 'number' },
  },
};
const durationSchema = { type: 'object', description: 'Durée des périodes aléatoires : {kind: exact|min|max|any, months}', properties: { kind: { type: 'string', enum: ['exact', 'min', 'max', 'any'] }, months: { type: 'number' } } };
const obj = (props, req) => ({ type: 'object', properties: props, required: req || [] });

function suggestionView(x) {
  return { id: x.id, group: x.group, title: x.title, detail: x.detail, result: statsView(x.stats), outOfSample: x.validation ? { confirmed: x.validation.confirmed, wins: x.validation.wins, total: x.validation.total } : null };
}

const TOOLS = [
  {
    name: 'forexia_help',
    description: 'Mode d\'emploi : langage des règles (indicateurs, opérateurs, unités de temps), français compris, sources de données, méthode conseillée pour trouver une bonne stratégie. À lire en premier.',
    inputSchema: obj({}),
    handler: async () => ({
      version: VERSION,
      pairs: D.PAIRS,
      ruleFunctions: R.FUNCTIONS,
      ruleSeries: ['CLOSE', 'OPEN', 'HIGH', 'LOW', 'HOUR', 'MINUTE', 'WEEKDAY (1=lundi … 7)', 'DAY', 'MONTH'],
      ruleSyntax: [
        'Opérateurs : > < >= <= == != + - * / AND OR NOT, parenthèses.',
        'Signal calculé à la clôture de la bougie, exécuté à l\'ouverture suivante. Une seule position à la fois ; un signal d\'entrée inverse retourne la position.',
        'Exemples : CROSS_UP(RSI(14), 30) ; CROSS_UP(EMA(20), EMA(50)) AND ADX(14) > 25 ; CLOSE > EMA(50)@W1 (unité supérieure) ; SLOPE(EMA(50), 5) > 0 ; BULL_DIV(RSI(14), 14) ; CLOSE - PREV(CLOSE, 1) > 1.5 * ATR(14).',
        'Unités de temps supérieures : X@H4, X@D1, X@W1, X@MN (bougies closes uniquement, sans biais d\'anticipation).',
        'LINE(t1, prix1, t2, prix2) : ligne de tendance (heures en secondes Unix), prolongée à droite.',
      ],
      tradeManagement: 'stopLossPips, takeProfitPips, stopAtr/takeAtr (multiples d\'ATR, atrPeriod), trailPips/trailAtr (stop suiveur), breakevenPips/breakevenAtr, maxBars (fermeture après N bougies), pauseLosses/pauseBars.',
      frenchExamples: ['Acheter quand le RSI 14 passe au-dessus de 30. Vendre dans le cas inverse. Stop loss 50 pips.', 'Acheter quand la MME 9 croise à la hausse la MME 21 et que l\'ADX 14 est au-dessus de 25. Vendre dans le cas inverse. Stop suiveur 2 ATR.'],
      dataSources: { online: 'cours BCE journaliers depuis 1999 (Internet requis)', synthetic: 'marche aléatoire reproductible, pour tester le mécanisme, pas le marché', csv: 'export de bougies MT4/MT5 (csvPath)', broker: 'données du courtier via la passerelle MT5 (FOREXIA_BRIDGE_TOKEN), résultats identiques au testeur MT5' },
      scoring: 'score = rendement − ½ drawdown + régularité (mois gagnants) + facteur de profit − pénalité sous 10 trades. Plus haut = mieux.',
      method: [
        '1. Partir d\'un modèle (list_presets) ou d\'une idée en français (translate_french).',
        '2. run_backtest sur 1 à 2 ans (source online), puis random_batch (10 à 20 périodes) pour juger la robustesse : résultat médian, part de périodes gagnantes.',
        '3. enhance_strategy puis apply_improvements avec les suggestions « confirmées » hors échantillon ; revalider avec random_batch.',
        '4. test_other_pairs pour vérifier que ce n\'est pas propre à une paire ; recommend pour la synthèse de l\'historique.',
        '5. Méfiance envers la sur-optimisation : préférer une stratégie gagnante sur la plupart des périodes à un seul gros résultat.',
        '6. save_strategy pour garder la meilleure ; generate_ea pour l\'EA MT5 (tester d\'abord en démo).',
        '7. Pour construire un FX (plan d\'investissement) : outil fx_method.',
      ],
    }),
  },
  {
    name: 'list_presets', description: 'Modèles de stratégies fournis par Forexia (id, nom, règles).', inputSchema: obj({}),
    handler: async () => F.presets.list.map((p) => Object.assign({ id: p.id, description: p.description }, strategyView(p))),
  },
  {
    name: 'translate_french', description: 'Traduit une stratégie écrite en français en règles techniques (et signale ce qui n\'est pas compris).',
    inputSchema: obj({ text: { type: 'string' } }, ['text']),
    handler: async (a) => { const p = FR.parse(a.text); const o = { warnings: p.warnings }; for (const k of RULES.concat(TM)) if (p[k]) o[k] = p[k]; return o; },
  },
  {
    name: 'validate_strategy', description: 'Vérifie les règles d\'une stratégie et renvoie sa description en français.',
    inputSchema: obj({ strategy: strategySchema }, ['strategy']),
    handler: async (a) => ({ ok: true, strategy: strategyView(resolveStrategy(a.strategy)) }),
  },
  {
    name: 'run_backtest', description: 'Backtest d\'une stratégie sur une paire et une période. Renvoie les statistiques, la rentabilité mois par mois, les motifs de sortie (et les trades si includeTrades). Enregistré dans l\'historique (record=false pour ne pas l\'enregistrer).',
    inputSchema: obj({ strategy: strategySchema, market: marketSchema, includeTrades: { type: 'boolean' }, maxTrades: { type: 'number' }, record: { type: 'boolean' } }, ['strategy']),
    handler: async (a) => backtestView(await backtest(a.strategy, a.market || {}, { record: a.record }), a),
  },
  {
    name: 'random_batch', description: 'Lot de N backtests sur des périodes tirées au hasard (durée réglable), pour juger la robustesse. Renvoie chaque résultat et la synthèse (médiane, part gagnante, pire / meilleur). Enregistrés dans l\'historique.',
    inputSchema: obj({ strategy: strategySchema, market: marketSchema, n: { type: 'number', description: '1 à 50 (défaut 10)' }, duration: durationSchema }, ['strategy']),
    handler: async (a) => {
      const n = Math.max(1, Math.min(50, Math.round(a.n || 10))), m = Object.assign({}, a.market || {});
      delete m.period;
      let csvSpan = null;
      if (m.source === 'csv') { const c = csvHistory(m.csvPath); csvSpan = { first: new Date(c.bars[0].date.slice(0, 10) + 'T00:00:00Z'), last: new Date(c.bars[c.bars.length - 1].date.slice(0, 10) + 'T00:00:00Z') }; }
      const runs = [];
      for (let k = 0, tries = 0; k < n && tries < n * 3; tries++) {
        const rr = randomRange(m.source || 'online', a.duration, csvSpan);
        try {
          const b = await backtest(a.strategy, Object.assign({}, m, { dateFrom: rr.dateFrom, dateTo: rr.dateTo }));
          runs.push({ from: rr.dateFrom, to: rr.dateTo, months: rr.months, returnPct: r2(b.res.stats.returnPct), maxDrawdownPct: r2(b.res.stats.maxDrawdownPct), trades: b.res.stats.trades, winRate: r2(b.res.stats.winRate), score: r2(E.score(b.res.stats)) });
          k++;
        } catch (e) { if (!(e instanceof UserError) || !/Pas assez/.test(e.message)) throw e; }
      }
      const ret = runs.map((x) => x.returnPct).sort((x, y) => x - y);
      const med = ret.length ? ret[ret.length >> 1] : 0;
      return {
        runs: runs,
        summary: { n: runs.length, positive: runs.filter((x) => x.returnPct > 0).length, positivePct: r2((runs.filter((x) => x.returnPct > 0).length / (runs.length || 1)) * 100),
          medianReturnPct: med, meanReturnPct: r2(ret.reduce((s, v) => s + v, 0) / (ret.length || 1)), worstReturnPct: ret[0], bestReturnPct: ret[ret.length - 1],
          medianMaxDrawdownPct: r2(runs.map((x) => x.maxDrawdownPct).sort((x, y) => x - y)[runs.length >> 1] || 0) },
      };
    },
  },
  {
    name: 'enhance_strategy', description: 'Comme le bouton « Améliorer » : teste des dizaines de modifications (réglages, filtres de tendance, ADX, croisements, stops ATR, stop suiveur, sorties, jours / heures, taille au risque…) et renvoie celles qui améliorent le résultat, avec leur contrôle hors échantillon (périodes précédentes). Utiliser les id avec apply_improvements.',
    inputSchema: obj({ strategy: strategySchema, market: marketSchema }, ['strategy']),
    handler: async (a) => {
      const b = await backtest(a.strategy, a.market || {}, { record: false });
      const sg = E.suggest(b.md.bars, b.strat, b.settings, b.strat.style || 'none');
      return { base: statsView(sg.base), controlPeriods: (sg.folds || []).length, suggestions: sg.suggestions.map(suggestionView),
        note: 'Privilégier les suggestions dont outOfSample.confirmed = true ; « Combinaison recommandée » cumule les meilleures.' };
    },
  },
  {
    name: 'apply_improvements', description: 'Applique des suggestions de enhance_strategy (par id, même stratégie et même marché) et/ou une amélioration écrite en français ; renvoie la stratégie améliorée et le résultat avant / après.',
    inputSchema: obj({ strategy: strategySchema, market: marketSchema, ids: { type: 'array', items: { type: 'string' } }, customText: { type: 'string', description: 'ex. « Acheter seulement si l\'ADX 14 dépasse 25 » ou « Stop suiveur 2 ATR »' }, customMode: { type: 'string', enum: ['and', 'or', 'replace'] }, name: { type: 'string', description: 'nom de la stratégie améliorée' } }, ['strategy']),
    handler: async (a) => {
      const b = await backtest(a.strategy, a.market || {}, { record: false });
      const picks = [];
      if (a.ids && a.ids.length) {
        const sg = E.suggest(b.md.bars, b.strat, b.settings, b.strat.style || 'none');
        for (const id of a.ids) { const x = sg.suggestions.find((y) => y.id === id); if (!x) fail('Suggestion introuvable : ' + id + ' (relancez enhance_strategy avec la même stratégie et le même marché).'); picks.push(x); }
      }
      if (a.customText) {
        const c = E.customSuggestion(b.md.bars, b.strat, b.settings, a.customText, a.customMode || 'and');
        if (c.error) fail(c.error);
        picks.push(c);
      }
      if (!picks.length) fail('Indiquez ids et/ou customText.');
      const c = E.combine(b.strat, b.settings, picks);
      const improved = Object.assign({}, c.strat, { name: a.name || (b.strat.name + ' (améliorée)') });
      const after = run(b.md, improved, c.settings);
      const changedSettings = {};
      for (const k of ['leverage', 'sizing', 'riskPct']) if (c.settings[k] !== b.settings[k]) changedSettings[k] = c.settings[k];
      return { applied: picks.map((x) => x.title), before: statsView(b.res.stats), after: statsView(after.stats), strategy: strategyView(improved), changedMarketSettings: changedSettings,
        note: 'Vérifiez la stratégie améliorée avec random_batch avant de la retenir.' };
    },
  },
  {
    name: 'test_other_pairs', description: 'Robustesse : la même stratégie sur d\'autres paires, même période.',
    inputSchema: obj({ strategy: strategySchema, market: marketSchema, pairs: { type: 'array', items: { type: 'string' } } }, ['strategy']),
    handler: async (a) => {
      const pairs = a.pairs && a.pairs.length ? a.pairs : ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF', 'USD/CAD', 'EUR/GBP', 'NZD/USD'];
      const runs = [];
      for (const p of pairs) {
        try { const b = await backtest(a.strategy, Object.assign({}, a.market || {}, { pair: p, spreadPips: undefined }), { record: false }); runs.push({ pair: p, stats: b.res.stats }); }
        catch (e) { runs.push({ pair: p, stats: null, error: e.message }); }
      }
      const rb = E.robustness(runs);
      return { robust: rb.robust, positive: rb.positive, tested: rb.tested, runs: runs.map((x) => (x.stats ? { pair: x.pair, returnPct: r2(x.stats.returnPct), maxDrawdownPct: r2(x.stats.maxDrawdownPct), trades: x.stats.trades, winMonthsPct: r2(x.stats.winMonthsPct) } : { pair: x.pair, error: x.error })) };
    },
  },
  {
    name: 'recommend', description: 'Analyse de l\'historique des simulations (comme l\'onglet « Recommandations ») : meilleure stratégie, meilleure paire, court ou long terme, quel retrait, quel levier, avec un niveau de confiance.',
    inputSchema: obj({ name: { type: 'string', description: 'limiter à une stratégie' }, pair: { type: 'string' }, lastN: { type: 'number' } }),
    handler: async (a) => {
      let l = store.evaluations();
      if (a.name) l = l.filter((e) => e.name === a.name);
      if (a.pair) l = l.filter((e) => e.pair === a.pair);
      if (a.lastN) l = l.slice(-a.lastN);
      const A = F.advisor.analyze(l);
      const g = (arr) => (arr || []).slice(0, 8).map((x) => ({ label: x.label, n: x.n, medianReturnPct: r2(x.medianRet), meanReturnPct: r2(x.meanRet), positivePct: r2(x.posRate), meanMaxDrawdownPct: r2(x.meanDD) }));
      return { simulations: A.n, recommendations: A.recos.map((r) => ({ topic: r.title, pick: r.pick, confidence: r.confidence, text: r.text })), warnings: A.warnings,
        groups: A.n ? { byStrategy: g(A.groups.strategy), byPair: g(A.groups.pair), byHorizon: g(A.groups.horizon), byWithdraw: g(A.groups.withdraw), byLeverage: g(A.groups.leverage) } : {} };
    },
  },
  {
    name: 'list_evaluations', description: 'Historique des simulations enregistrées (les plus récentes en dernier).',
    inputSchema: obj({ name: { type: 'string' }, limit: { type: 'number' } }),
    handler: async (a) => {
      let l = store.evaluations();
      if (a.name) l = l.filter((e) => e.name === a.name);
      return l.slice(-(a.limit || 50)).map((e) => ({ key: e.key, at: e.at, name: e.name, pair: e.pair, from: e.from, to: e.to, data: e.data, capital: e.capital, leverage: e.leverage, returnPct: r2(e.returnPct), maxDrawdownPct: r2(e.maxDrawdownPct), trades: e.trades }));
    },
  },
  {
    name: 'clear_evaluations', description: 'Efface l\'historique des simulations (toutes, ou celles d\'une stratégie).',
    inputSchema: obj({ name: { type: 'string' } }),
    handler: async (a) => { const l = store.evaluations(), keep = a.name ? l.filter((e) => e.name !== a.name) : []; store.setEvaluations(keep); return { removed: l.length - keep.length, remaining: keep.length }; },
  },
  {
    name: 'save_strategy', description: 'Enregistre (ou remplace) une stratégie sous son nom, avec éventuellement le marché conseillé.',
    inputSchema: obj({ strategy: strategySchema, market: marketSchema, notes: { type: 'string' } }, ['strategy']),
    handler: async (a) => {
      const s = Object.assign({}, resolveStrategy(a.strategy));
      s.frenchText = FR.toFrench(s) || s.frenchText || '';
      s.plots = FR.derivePlots(s);
      if (a.market) s.config = a.market;
      if (a.notes) s.description = a.notes;
      s.savedAt = new Date().toISOString();
      const l = store.strategies(), i = l.findIndex((x) => x.name === s.name);
      if (i >= 0) l[i] = s; else l.push(s);
      store.setStrategies(l);
      return { saved: s.name, count: l.length, file: path.join(DATA_DIR, 'strategies.json') };
    },
  },
  {
    name: 'list_strategies', description: 'Stratégies enregistrées par l\'agent.', inputSchema: obj({}),
    handler: async () => store.strategies().map((s) => Object.assign(strategyView(s), { savedAt: s.savedAt, market: s.config, notes: s.description })),
  },
  {
    name: 'delete_strategy', description: 'Supprime une stratégie enregistrée.', inputSchema: obj({ name: { type: 'string' } }, ['name']),
    handler: async (a) => { const l = store.strategies(), keep = l.filter((x) => x.name !== a.name); store.setStrategies(keep); return { deleted: l.length - keep.length }; },
  },
  {
    name: 'generate_ea', description: 'Génère l\'Expert Advisor MetaTrader 5 (.mq5) de la stratégie : mêmes règles et même gestion des trades que le backtest. Écrit le fichier si outputPath est donné.',
    inputSchema: obj({
      strategy: strategySchema, pair: { type: 'string' }, timeframe: { type: 'string', enum: ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'] },
      sizing: { type: 'string', enum: ['backtest', 'fixed', 'risk'] }, fixedLots: { type: 'number' }, riskPct: { type: 'number' }, maxLots: { type: 'number' }, maxSpreadPips: { type: 'number' },
      leverage: { type: 'number' }, exposurePct: { type: 'number' }, news: { type: 'object', description: '{enabled, mode: block|close, before, after, impact: high|medium}' },
      outputPath: { type: 'string' }, includeCode: { type: 'boolean', description: 'renvoyer le code (défaut : oui si pas de outputPath)' },
    }, ['strategy']),
    handler: async (a) => {
      const s = resolveStrategy(a.strategy);
      const ea = F.mql5.generate(s, { pair: a.pair || 'EUR/USD', timeframe: 'PERIOD_' + (a.timeframe || 'D1'), sizing: a.sizing || 'fixed', fixedLots: a.fixedLots || 0.01, riskPct: a.riskPct || 1,
        maxLots: a.maxLots || 1, maxSpreadPips: a.maxSpreadPips != null ? a.maxSpreadPips : 5, leverage: a.leverage || 10, exposurePct: a.exposurePct || 100, news: a.news });
      const out = { fileName: ea.fileName, magic: ea.magic };
      if (a.outputPath) { const p = path.resolve(a.outputPath.endsWith('.mq5') ? a.outputPath : path.join(a.outputPath, ea.fileName)); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, '﻿' + ea.code); out.writtenTo = p; }
      if (a.includeCode !== false && (!a.outputPath || a.includeCode)) out.code = ea.code;
      out.note = 'À compiler dans MetaEditor puis tester dans le testeur de stratégie et sur un compte DÉMO avant tout compte réel.';
      return out;
    },
  },
  {
    name: 'get_market_data',
    description: 'Cours et indicateurs bougie par bougie (pour « regarder le graphique » comme un humain) : OHLC + les indicateurs demandés, dans l\'unité de temps voulue (D1, W1, MN… ; plus fin avec la source broker).',
    inputSchema: obj({ market: marketSchema, indicators: { type: 'array', items: { type: 'string' }, description: 'ex. ["EMA(50)", "RSI(14)", "ADX(14)", "BB_UPPER(20,2)"]' }, timeframe: { type: 'string', enum: ['D1', 'W1', 'MN'] }, last: { type: 'number', description: 'nombre de bougies renvoyées (défaut 120, max 1500)' } }),
    handler: async (a) => {
      const m = a.market || {}, range = rangeOf(m), md = await loadMarket(m, range);
      let bars = md.bars;
      if (a.timeframe && a.timeframe !== md.timeframe) bars = D.resample(bars, a.timeframe);
      const ctx = R.makeContext(bars), ind = {};
      for (const e of a.indicators || []) { const err = R.validate(e); if (err) fail('Indicateur invalide « ' + e + ' » : ' + err); ind[e] = R.evaluateSeries(e, ctx); }
      const n = Math.max(1, Math.min(1500, a.last || 120)), from = Math.max(0, bars.length - n);
      const rows = [];
      for (let i = from; i < bars.length; i++) {
        const b = bars[i], row = { date: b.date, t: ctx.t[i], open: b.open, high: b.high, low: b.low, close: b.close };
        for (const k in ind) row[k] = Number.isFinite(ind[k][i]) ? Math.round(ind[k][i] * 1e6) / 1e6 : null;
        rows.push(row);
      }
      return { pair: md.pair, data: md.label, timeframe: a.timeframe || md.timeframe, rows: rows, note: 't = heure de la bougie en secondes Unix (pour LINE)' };
    },
  },
  {
    name: 'find_levels',
    description: 'Comme un trader qui trace sur le graphique : supports, résistances (zones touchées plusieurs fois) et lignes de tendance (sommets / creux successifs), avec l\'expression prête à mettre dans une règle (niveau ou LINE(...)).',
    inputSchema: obj({ market: marketSchema, timeframe: { type: 'string', enum: ['D1', 'W1', 'MN'] }, swing: { type: 'number', description: 'bougies de chaque côté d\'un sommet / creux (défaut 5)' }, max: { type: 'number' } }),
    handler: async (a) => {
      const m = a.market || {}, range = rangeOf(m), md = await loadMarket(m, range);
      let bars = md.bars;
      if (a.timeframe && a.timeframe !== md.timeframe) bars = D.resample(bars, a.timeframe);
      const ctx = R.makeContext(bars), k = Math.max(2, a.swing || 5), atr = F.indicators.atr(ctx.high, ctx.low, ctx.close, 14);
      const from = Math.max(k, bars.length - Math.max(120, md.bars.length - md.startIndex)), highs = [], lows = [];
      for (let i = from; i < bars.length - k; i++) {
        let hi = true, lo = true;
        for (let j = i - k; j <= i + k; j++) { if (bars[j].high > bars[i].high) hi = false; if (bars[j].low < bars[i].low) lo = false; }
        if (hi) highs.push({ i: i, p: bars[i].high }); if (lo) lows.push({ i: i, p: bars[i].low });
      }
      const last = bars[bars.length - 1].close, tol = (atr[bars.length - 1] || last * 0.003) * 0.5, dec = /JPY/.test(md.pair) ? 3 : 5;
      const zones = [];
      for (const x of highs.map((h) => Object.assign({ kind: 'h' }, h)).concat(lows.map((l) => Object.assign({ kind: 'l' }, l)))) {
        const z = zones.find((z) => Math.abs(z.level - x.p) <= tol);
        if (z) { z.touches++; z.level = (z.level * (z.touches - 1) + x.p) / z.touches; z.lastIndex = Math.max(z.lastIndex, x.i); } else zones.push({ level: x.p, touches: 1, lastIndex: x.i });
      }
      const fmtLevel = (v) => +v.toFixed(dec);
      const lv = zones.filter((z) => z.touches >= 2).sort((x, y) => y.touches - x.touches || y.lastIndex - x.lastIndex).slice(0, a.max || 6).map((z) => ({
        type: z.level < last ? 'support' : 'résistance', level: fmtLevel(z.level), touches: z.touches, lastTouch: bars[z.lastIndex].date,
        examples: z.level < last ? ['(LOW <= ' + fmtLevel(z.level) + ' AND CLOSE > ' + fmtLevel(z.level) + ')  // rebond sur le support', 'CROSS_DOWN(CLOSE, ' + fmtLevel(z.level) + ')  // cassure']
          : ['(HIGH >= ' + fmtLevel(z.level) + ' AND CLOSE < ' + fmtLevel(z.level) + ')  // rejet sur la résistance', 'CROSS_UP(CLOSE, ' + fmtLevel(z.level) + ')  // cassure'],
      }));
      const line = (p1, p2, kind) => {
        if (!p1 || !p2) return null;
        const expr = 'LINE(' + ctx.t[p1.i] + ', ' + fmtLevel(p1.p) + ', ' + ctx.t[p2.i] + ', ' + fmtLevel(p2.p) + ')';
        return { type: kind, from: { date: bars[p1.i].date, price: fmtLevel(p1.p) }, to: { date: bars[p2.i].date, price: fmtLevel(p2.p) }, expression: expr,
          examples: kind === 'tendance haussière (creux)' ? ['(LOW <= ' + expr + ' AND CLOSE > ' + expr + ')', 'CLOSE > ' + expr] : ['(HIGH >= ' + expr + ' AND CLOSE < ' + expr + ')', 'CLOSE < ' + expr] };
      };
      const rising = lows.slice(-6).reduce((acc, x, idx, arr) => acc || (idx && arr[idx - 1].p < x.p ? [arr[idx - 1], x] : null), null);
      const falling = highs.slice(-6).reduce((acc, x, idx, arr) => acc || (idx && arr[idx - 1].p > x.p ? [arr[idx - 1], x] : null), null);
      return { pair: md.pair, lastClose: last, supportsResistances: lv,
        trendLines: [rising && line(rising[0], rising[1], 'tendance haussière (creux)'), falling && line(falling[0], falling[1], 'tendance baissière (sommets)')].filter(Boolean),
        note: 'Un niveau est un prix précis : valable pour cette paire et la période autour. Testez-le dans une règle avec run_backtest, puis random_batch.' };
    },
  },
  {
    name: 'make_trend_line', description: 'Construit l\'expression LINE(...) d\'une ligne de tendance passant par deux points (date, prix), comme si on la traçait à la main.',
    inputSchema: obj({ date1: { type: 'string' }, price1: { type: 'number' }, date2: { type: 'string' }, price2: { type: 'number' } }, ['date1', 'price1', 'date2', 'price2']),
    handler: async (a) => {
      const t = (d) => Math.floor(Date.parse(String(d).length > 10 ? String(d).replace(' ', 'T') + 'Z' : d + 'T00:00:00Z') / 1000);
      let p = [[t(a.date1), a.price1], [t(a.date2), a.price2]].sort((x, y) => x[0] - y[0]);
      if (!(p[1][0] > p[0][0])) fail('Les deux dates doivent être différentes.');
      const expr = 'LINE(' + p[0][0] + ', ' + p[0][1] + ', ' + p[1][0] + ', ' + p[1][1] + ')';
      return { expression: expr, examples: ['CLOSE > ' + expr + '  // au-dessus de la ligne', '(LOW <= ' + expr + ' AND CLOSE > ' + expr + ')  // rebond', 'CROSS_DOWN(CLOSE, ' + expr + ')  // cassure'] };
    },
  },
  {
    name: 'edit_conditions',
    description: 'Liste les conditions d\'une stratégie (arbre ET / OU, avec un chemin pour chacune) et en retire : une condition précise (rule + path), toutes celles qui contiennent un texte (match, ex. "LINE(" ou "ADX"). Renvoie la stratégie modifiée (non enregistrée : utilisez save_strategy).',
    inputSchema: obj({ strategy: strategySchema, remove: { type: 'array', items: { type: 'object', properties: { rule: { type: 'string', enum: RULES }, path: { type: 'string', description: 'ex. "0.2" (voir la liste)' }, match: { type: 'string' } } } } }, ['strategy']),
    handler: async (a) => {
      const st = resolveStrategy(a.strategy);
      const split = (n, op) => (n.k === 'bin' && n.op === op ? split(n.a, op).concat(split(n.b, op)) : [n]);
      const build = (n) => (n.k === 'bin' && (n.op === 'AND' || n.op === 'OR') ? { op: n.op, items: split(n, n.op).map(build) } : R.stringify(n));
      const str = (t, parent) => (typeof t === 'string' ? t : (parent ? '(' : '') + t.items.map((x) => str(x, t.op)).join(' ' + t.op + ' ') + (parent ? ')' : ''));
      const drop = (t, f, p) => {
        if (typeof t === 'string') return f(t, p) ? null : t;
        const items = t.items.map((x, i) => drop(x, f, p.concat(i))).filter((x) => x !== null).flatMap((x) => (typeof x !== 'string' && x.op === t.op ? x.items : [x]));
        return !items.length ? null : items.length === 1 ? items[0] : { op: t.op, items: items };
      };
      const list = (t, p, out) => { if (typeof t === 'string') out.push({ path: p.join('.'), condition: t }); else t.items.forEach((x, i) => list(x, p.concat(i), out)); return out; };
      const out = Object.assign({}, st);
      for (const k of RULES) {
        if (!st[k]) continue;
        let t = build(R.parse(st[k]));
        for (const r of a.remove || []) {
          if (r.rule && r.rule !== k) continue;
          t = t && drop(t, (c, p) => (r.match ? c.includes(r.match) : r.rule === k && p.join('.') === r.path), []);
        }
        out[k] = t ? str(t) : '';
      }
      if (!out.longEntry && !out.shortEntry) fail('Ce retrait supprimerait toutes les règles d\'entrée.');
      const conditions = {};
      for (const k of RULES) if (out[k]) conditions[k] = list(build(R.parse(out[k])), [], []);
      return { strategy: strategyView(out), conditions: conditions };
    },
  },
  {
    name: 'stress_test',
    description: 'Vérifications de l\'onglet Graphiques sur une période : prolonger (long terme ?), raccourcir, découper en tranches (court terme ?), changer le capital de départ. Renvoie le résultat d\'origine et chaque variante.',
    inputSchema: obj({ strategy: strategySchema, market: marketSchema, extendMonths: { type: 'number' }, shortenMonths: { type: 'number' }, splitMonths: { type: 'number' }, capitals: { type: 'array', items: { type: 'number' } } }, ['strategy', 'market']),
    handler: async (a) => {
      const m = a.market, r0 = rangeOf(m), f = iso(r0.start), t = iso(r0.end), day = 864e5;
      const go = async (extra, label) => { try { const b = await backtest(a.strategy, Object.assign({}, m, extra), { record: false }); return { label: label, from: extra.dateFrom || f, to: extra.dateTo || t, capital: extra.capital || m.capital || 10000, returnPct: r2(b.res.stats.returnPct), maxDrawdownPct: r2(b.res.stats.maxDrawdownPct), trades: b.res.stats.trades, netProfit: r2(b.res.stats.netProfit) }; } catch (e) { return { label: label, error: e.message }; } };
      const base = await go({ dateFrom: f, dateTo: t }, 'origine'), out = { original: base };
      if (a.extendMonths) { let to = D.addMonths(r0.end, a.extendMonths), from = r0.start; if (to > today()) { const lack = to - today(); to = today(); from = new Date(from - lack); } out.extended = await go({ dateFrom: iso(from), dateTo: iso(to) }, 'prolongée de ' + a.extendMonths + ' mois'); }
      if (a.shortenMonths) { const to = new Date(Math.max(D.addMonths(r0.end, -a.shortenMonths).getTime(), r0.start.getTime() + 31 * day)); out.shortened = await go({ dateFrom: f, dateTo: iso(to) }, 'raccourcie de ' + a.shortenMonths + ' mois'); }
      if (a.splitMonths) {
        out.slices = [];
        for (let s0 = r0.start; s0 < r0.end;) { const e = new Date(Math.min(Math.max(D.addMonths(s0, a.splitMonths).getTime() - day, s0.getTime() + 30 * day), r0.end.getTime())); if (e - s0 >= 30 * day) out.slices.push(await go({ dateFrom: iso(s0), dateTo: iso(e) }, 'tranche')); s0 = new Date(e.getTime() + day); }
        const ok = out.slices.filter((x) => !x.error);
        out.slicesSummary = { n: ok.length, positive: ok.filter((x) => x.returnPct > 0).length, verdict: ok.filter((x) => x.returnPct > 0).length >= ok.length * 0.6 ? 'fonctionne aussi sur des périodes courtes' : 'dépend du moment sur des périodes courtes' };
      }
      if (a.capitals && a.capitals.length) out.capitals = await Promise.all(a.capitals.map((c) => go({ dateFrom: f, dateTo: t, capital: c }, 'capital ' + c)));
      return out;
    },
  },
  {
    name: 'improve_across_periods',
    description: 'Section « Améliorations » de l\'évaluation : sur plusieurs périodes (fournies, ou tirées au hasard), cherche les améliorations communes aux périodes perdantes et celles à fort impact sur toutes ; avec apply (ids), resimule chaque période avec la stratégie améliorée.',
    inputSchema: obj({ strategy: strategySchema, market: marketSchema, periods: { type: 'array', items: { type: 'object', properties: { dateFrom: { type: 'string' }, dateTo: { type: 'string' } } } }, randomN: { type: 'number' }, duration: durationSchema, apply: { type: 'array', items: { type: 'string' } } }, ['strategy']),
    handler: async (a) => {
      const m = Object.assign({}, a.market || {}); delete m.period;
      let periods = a.periods && a.periods.length ? a.periods : [];
      if (!periods.length) for (let k = 0; k < Math.min(16, a.randomN || 8); k++) periods.push(randomRange(m.source || 'online', a.duration || { kind: 'exact', months: 12 }));
      const ctxs = [];
      for (const p of periods) { try { const b = await backtest(a.strategy, Object.assign({}, m, { dateFrom: p.dateFrom, dateTo: p.dateTo }), { record: false }); ctxs.push({ p: p, md: b.md, strat: b.strat, settings: b.settings, base: b.res.stats }); } catch (e) { /* période inutilisable */ } }
      if (!ctxs.length) fail('Aucune période utilisable.');
      const reds = ctxs.filter((c) => c.base.returnPct <= 0), srcs = reds.slice().sort((x, y) => x.base.returnPct - y.base.returnPct).slice(0, 6).concat(ctxs.slice().sort((x, y) => y.base.returnPct - x.base.returnPct).slice(0, 2));
      const cand = new Map();
      for (const c of srcs) for (const x of E.suggest(c.md.bars, c.strat, c.settings, c.strat.style || 'none').suggestions) {
        if (x.risk || x.group === 'Combinaison recommandée' || cand.has(x.id)) continue;
        if (x.apply({ strat: c.strat, settings: c.settings }).settings !== c.settings) continue;
        cand.set(x.id, x);
      }
      const runOn = (c, pick) => { const k = E.combine(c.strat, c.settings, pick); return run(c.md, k.strat, k.settings).stats; };
      const med = (v) => { const s2 = v.slice().sort((x, y) => x - y); return s2.length ? s2[s2.length >> 1] : 0; };
      const rated = [...cand.values()].map((x) => {
        const res = ctxs.map((c) => { const st = runOn(c, [x]); return { c: c, a: st, d: E.score(st) - E.score(c.base) }; }), rr = res.filter((z) => z.c.base.returnPct <= 0);
        return { id: x.id, group: x.group, title: x.title, redsImproved: rr.filter((z) => z.d > 0.5).length + ' / ' + rr.length, allImproved: res.filter((z) => z.d > 0.5).length + ' / ' + res.length,
          medianReturnPct: { before: r2(med(res.map((z) => z.c.base.returnPct))), after: r2(med(res.map((z) => z.a.returnPct))) }, _r: rr.length ? rr.filter((z) => z.d > 0.5).length / rr.length : 0, _g: res.reduce((s2, z) => s2 + z.d, 0) / res.length };
      });
      const clean = (x) => { const o = Object.assign({}, x); delete o._r; delete o._g; return o; };
      const out = { periods: ctxs.map((c) => ({ from: c.p.dateFrom, to: c.p.dateTo, returnPct: r2(c.base.returnPct) })), losing: reds.length,
        commonToLosers: rated.filter((x) => x._r >= 0.6).sort((x, y) => y._r - x._r || y._g - x._g).slice(0, 8).map(clean),
        highImpact: rated.filter((x) => x.medianReturnPct.after > x.medianReturnPct.before && x._g > 0).sort((x, y) => (y.medianReturnPct.after - y.medianReturnPct.before) - (x.medianReturnPct.after - x.medianReturnPct.before)).slice(0, 8).map(clean) };
      if (a.apply && a.apply.length) {
        const pick = a.apply.map((id) => cand.get(id) || fail('id inconnu : ' + id));
        const k = E.combine(ctxs[0].strat, ctxs[0].settings, pick);
        out.applied = pick.map((x) => x.title);
        out.after = ctxs.map((c) => ({ from: c.p.dateFrom, to: c.p.dateTo, before: r2(c.base.returnPct), after: r2(runOn(c, pick).returnPct) }));
        out.afterSummary = { positiveBefore: ctxs.filter((c) => c.base.returnPct > 0).length, positiveAfter: out.after.filter((x) => x.after > 0).length, medianBefore: r2(med(out.after.map((x) => x.before))), medianAfter: r2(med(out.after.map((x) => x.after))) };
        out.improvedStrategy = strategyView(Object.assign({}, k.strat, { name: ctxs[0].strat.name + ' (améliorée)' }));
      }
      return out;
    },
  },
  {
    name: 'mt5_export_calendar', description: 'Fait exporter le calendrier économique de MetaTrader 5 par la passerelle (MT5 est fermé puis relancé brièvement) ; nécessaire au filtre « news » du marché.',
    inputSchema: obj({ closeTerminal: { type: 'boolean' } }),
    handler: async (a) => { const term = await bridgeTerminal(); return bridge('POST', '/calendar/export', { terminalId: term.id, closeTerminal: !!a.closeTerminal }); },
  },
  {
    name: 'mt5_status', description: 'Passerelle MT5 (sur le PC de l\'utilisateur) : version, terminaux MetaTrader 5 détectés.', inputSchema: obj({}),
    handler: async () => bridge('GET', '/status'),
  },
  {
    name: 'mt5_deploy_ea', description: 'Envoie l\'EA de la stratégie dans MetaTrader 5 et le compile (passerelle MT5 requise).',
    inputSchema: obj({ strategy: strategySchema, pair: { type: 'string' }, timeframe: { type: 'string' }, sizing: { type: 'string' }, fixedLots: { type: 'number' }, riskPct: { type: 'number' }, maxLots: { type: 'number' }, maxSpreadPips: { type: 'number' } }, ['strategy']),
    handler: async (a) => {
      const s = resolveStrategy(a.strategy), term = await bridgeTerminal();
      const ea = F.mql5.generate(s, { pair: a.pair || 'EUR/USD', timeframe: 'PERIOD_' + (a.timeframe || 'D1'), sizing: a.sizing || 'fixed', fixedLots: a.fixedLots || 0.01, riskPct: a.riskPct || 1, maxLots: a.maxLots || 1, maxSpreadPips: a.maxSpreadPips != null ? a.maxSpreadPips : 5, leverage: 10, exposurePct: 100 });
      const r = await bridge('POST', '/deploy', { terminalId: term.id, fileName: ea.fileName, code: '﻿' + ea.code });
      return Object.assign({ fileName: ea.fileName }, r);
    },
  },
  {
    name: 'mt5_run_test', description: 'Lance le testeur de stratégie de MetaTrader 5 sur un EA déjà déployé (mt5_deploy_ea) et renvoie son rapport. MT5 doit pouvoir être fermé (closeTerminal=true).',
    inputSchema: obj({ fileName: { type: 'string' }, symbol: { type: 'string' }, period: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, deposit: { type: 'number' }, currency: { type: 'string' }, leverage: { type: 'number' }, closeTerminal: { type: 'boolean' } }, ['fileName', 'symbol', 'from', 'to']),
    handler: async (a) => {
      const term = await bridgeTerminal();
      const r = await bridge('POST', '/test', { terminalId: term.id, fileName: a.fileName, symbol: a.symbol, period: a.period || 'D1', from: a.from, to: a.to, deposit: a.deposit || 10000, currency: a.currency || 'EUR', leverage: a.leverage || 100, model: 1, closeTerminal: !!a.closeTerminal });
      if (r.result && r.result.deals) r.result.deals = r.result.deals.length + ' transactions';
      return r;
    },
  },
];

// ---------------------------------------------------------------- démarche FX (batchs, époques, retraits, FX, chercheur) : mcp/fx-tools.js
TOOLS.push(...require('./fx-tools')({ callTool: (n, x) => TOOLS.find((t) => t.name === n).handler(x), DATA_DIR, F, D, E, readJson, writeJson, store, resolveStrategy, strategyView, statsView, settingsOf, fail, r2, iso, today, onlineHistory, csvHistory, bridge, bridgeTerminal, toBar, subBars, obj, strategySchema, marketSchema }));

// ---------------------------------------------------------------- protocole MCP (JSON-RPC 2.0)
const INSTRUCTIONS = 'Forexia : backtests de stratégies Forex. IMPORTANT : pour toute recherche de stratégie ou de FX, appelez d\'abord fx_method et suivez sa démarche phase par phase (une variable à la fois, mêmes périodes, confirmation sur des périodes neuves, carnet note_add, point d\'étape à chaque phase). Commencez par forexia_help. Une stratégie se donne en règles techniques, en français (frenchText), ' +
  'par un modèle (preset) ou par une stratégie enregistrée (saved). Utilisez random_batch pour juger la robustesse avant de conclure, et méfiez-vous de la sur-optimisation. ' +
  'Pour chercher un FX (plan d\'investissement : stratégie, capital, durée, retrait), lisez fx_method : batchs sur les mêmes périodes (run_batch sameAs), compare_batches, time_analysis, era_analysis, compare_withdrawals, build_fx, mine_fx, note_add.';
async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => ({ jsonrpc: '2.0', id: id, result: result });
  const error = (code, message) => ({ jsonrpc: '2.0', id: id, error: { code: code, message: message } });
  if (id === undefined || id === null) return null; // notification
  try {
    switch (method) {
      case 'initialize':
        return reply({ protocolVersion: (params && params.protocolVersion) || '2025-06-18', capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'forexia', title: 'Forexia — backtest Forex', version: VERSION }, instructions: INSTRUCTIONS });
      case 'ping': return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
      case 'tools/call': {
        const tool = TOOLS.find((t) => t.name === (params && params.name));
        if (!tool) return error(-32602, 'Outil inconnu : ' + (params && params.name));
        try {
          const out = await tool.handler((params && params.arguments) || {});
          return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: Array.isArray(out) ? { items: out } : out });
        } catch (e) {
          if (!(e instanceof UserError)) process.stderr.write('[forexia-mcp] ' + (e.stack || e) + '\n');
          return reply({ content: [{ type: 'text', text: 'Erreur : ' + e.message }], isError: true });
        }
      }
      default: return error(-32601, 'Méthode non prise en charge : ' + method);
    }
  } catch (e) { return error(-32603, e.message); }
}

function startStdio() {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (e) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalide' } }) + '\n'); continue; }
      const list = Array.isArray(msg) ? msg : [msg];
      Promise.all(list.map(handle)).then((res) => {
        const out = res.filter(Boolean);
        if (out.length) process.stdout.write(JSON.stringify(Array.isArray(msg) ? out : out[0]) + '\n');
      });
    }
  });
  process.stderr.write('[forexia-mcp] ' + VERSION + ' prêt (stdio) — données : ' + DATA_DIR + '\n');
}

function startHttp(port, host, token) {
  const srv = http.createServer((req, res) => {
    const send = (code, body, headers) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers || {})); res.end(body ? JSON.stringify(body) : ''); };
    if (!req.url.startsWith('/mcp')) return send(404, { error: 'utilisez /mcp' });
    if (token && req.headers.authorization !== 'Bearer ' + token) return send(401, { error: 'jeton requis (Authorization: Bearer …)' });
    if (req.method === 'GET') return send(405, null, { Allow: 'POST' });
    if (req.method === 'DELETE') return send(200, {});
    if (req.method !== 'POST') return send(405, null, { Allow: 'POST' });
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 5e6) req.destroy(); });
    req.on('end', async () => {
      let msg;
      try { msg = JSON.parse(body); } catch (e) { return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalide' } }); }
      const list = Array.isArray(msg) ? msg : [msg];
      const out = (await Promise.all(list.map(handle))).filter(Boolean);
      if (!out.length) return send(202, null);
      send(200, Array.isArray(msg) ? out : out[0], { 'Mcp-Session-Id': 'forexia' });
    });
  });
  srv.listen(port, host, () => process.stderr.write('[forexia-mcp] ' + VERSION + ' prêt sur http://' + host + ':' + port + '/mcp' + (token ? ' (jeton requis)' : '') + ' — données : ' + DATA_DIR + '\n'));
}

if (require.main === module) {
  const argv = process.argv.slice(2), opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes('--http')) startHttp(Number(opt('--http')) || 3333, opt('--host') || '127.0.0.1', opt('--token') || process.env.FOREXIA_MCP_TOKEN);
  else startStdio();
}
module.exports = { TOOLS, handle };
