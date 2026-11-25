/* Forexia — outils MCP de la démarche « FX » : ce qu'un humain fait dans la page pour trouver un plan.
 *
 *   batchs (lots de simulations sur des périodes choisies ou tirées au hasard, mêmes périodes qu'un autre batch),
 *   comparaison de batchs, analyse temporelle (années, époques, rupture, événements de marché), époques personnalisées,
 *   analyseur d'une simulation (d'où vient la baisse, corrections) et d'époques (ce qui change entre époques),
 *   retraits fictifs (resimulation, comparaison de mécaniques), FX (plan d'investissement : scénarios, risque,
 *   confiance, revenu, projection pour un capital), chercheur de FX, carnet de déductions de l'agent et
 *   synchronisation avec la page Forexia (base de la passerelle MT5).
 *
 * Mêmes calculs que la page : js/fxcore.js, js/advisor.js, js/analyzer.js, js/events.js, js/confidence.js. */
'use strict';

module.exports = function fxTools(ctx) {
  const { callTool, F, D, E, readJson, writeJson, store, resolveStrategy, strategyView, statsView, settingsOf, fail, r2, iso, today, onlineHistory, csvHistory, bridge, bridgeTerminal, toBar, subBars, obj, strategySchema, marketSchema } = ctx;
  const FC = F.fxcore, A = F.analyzer, ADV = F.advisor, EV = F.events;
  const path = require('path');

  // ---------------------------------------------------------------- stockage (mêmes formats que la page)
  const S = (name, def) => ({ get: () => readJson(name, def), set: (v) => writeJson(name, v) });
  const batches = S('batches.json', []), fxs = S('fx.json', []), eraStore = S('eras.json', []), wdp = S('wdPresets.json', []);
  const evStore = S('events.json', { items: [], edits: {}, scanned: {} }), notes = S('notes.json', []);
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const dayOf = (b) => String(b.date).slice(0, 10);
  const strip = (t) => String(t == null ? '' : t).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  const TM = ['stopAtr', 'takeAtr', 'atrPeriod', 'trailPips', 'trailAtr', 'breakevenPips', 'breakevenAtr', 'maxBars', 'pauseLosses', 'pauseBars'];
  const median = FC.median, mean = FC.mean;

  /** Démarche Forexia (guide proposé) : mcp/guide-demarche.md, aussi affichée dans la page. */
  function methodText() {
    try { return require('fs').readFileSync(path.join(__dirname, 'guide-demarche.md'), 'utf8'); } catch (e) { return null; }
  }
  // Guide de recherche choisi par l'utilisateur dans la page (bouton « 🧭 Guide agent ») :
  // { active: 'free' | 'forexia' | id, items: [{id, name, text}] } — clé « forexia.agentGuide » de la base de la passerelle.
  const guideStore = S('agentGuide.json', { active: 'free', items: [] });
  /** Guide en vigueur : lu en direct dans la base de la passerelle si elle est configurée, sinon la dernière copie. */
  async function activeGuide() {
    let g = guideStore.get(), src = 'copie locale';
    if (process.env.FOREXIA_BRIDGE_TOKEN) {
      try {
        const r = await bridge('POST', '/db/kv/list', {}), it = ((r && r.items) || []).find((x) => x.key === 'forexia.agentGuide');
        if (it && it.data) { g = it.data; guideStore.set(g); src = 'page Forexia (passerelle)'; }
      } catch (e) { src = 'copie locale (passerelle injoignable)'; }
    }
    g = { active: g.active || 'free', items: Array.isArray(g.items) ? g.items : [] };
    const item = g.items.find((x) => x.id === g.active);
    if (g.active === 'forexia') return { mode: 'guide', name: 'Démarche Forexia', text: methodText(), source: src, all: g };
    if (item && String(item.text || '').trim()) return { mode: 'guide', name: item.name || 'Guide', text: item.text, source: src, all: g };
    return { mode: 'free', name: 'Liberté de l\'agent', text: null, source: src, all: g };
  }

  // ---------------------------------------------------------------- historique complet d'une paire (chargé une fois)
  const hcache = new Map();
  async function history(m) {
    const pair = m.pair || 'EUR/USD';
    if (!D.PAIRS.includes(pair)) fail('Paire inconnue : ' + pair + '. Paires : ' + D.PAIRS.join(', '));
    const src = m.source || 'online', wicks = m.estimateWicks !== false;
    const key = [src, pair, m.csvPath || '', m.symbol || '', m.timeframe || '', wicks, iso(today())].join('|');
    if (hcache.has(key)) return hcache.get(key);
    let h;
    if (src === 'synthetic') h = { bars: D.generateSynthetic(pair, new Date('1998-01-01T00:00:00Z'), today()), label: 'Données simulées (marche aléatoire)', timeframe: 'D1', synthetic: true };
    else if (src === 'online') { const b = await onlineHistory(pair); h = { bars: wicks ? D.estimateWicks(b) : b, label: 'Cours BCE journaliers' + (wicks ? ' + mèches estimées' : ''), timeframe: 'D1' }; }
    else if (src === 'csv') { if (!m.csvPath) fail('source csv : indiquez csvPath.'); const c = csvHistory(m.csvPath); h = { bars: c.bars, label: 'Fichier ' + path.basename(m.csvPath) + ' (' + c.timeframe + ')', timeframe: c.timeframe }; }
    else if (src === 'broker') {
      const term = await bridgeTerminal(), timeframe = m.timeframe || 'D1', symbol = m.symbol || pair.replace('/', '');
      const r = await bridge('POST', '/bars', { terminalId: term.id, symbol: symbol, timeframe: timeframe, from: '2012-01-01', to: iso(today()), testFrom: '2013-01-01', intrabar: m.intrabar !== false });
      if (!r.ok) fail(r.message || 'Données du courtier indisponibles.');
      h = { bars: r.bars.map((x) => toBar(x, timeframe !== 'D1')), timeframe: timeframe, symbol: r.symbol, broker: { spec: r.spec, account: r.account, conv: r.conv, sub: subBars(r.sub) },
        label: 'Courtier MT5 ' + r.account.server + ' · ' + r.symbol + ' ' + timeframe + ' · montants en ' + r.account.currency };
    } else fail('source inconnue : online | synthetic | csv | broker');
    if (!h.bars.length) fail('Aucune cotation pour ' + pair + '.');
    h.pair = pair; h.source = src; h.first = dayOf(h.bars[0]); h.last = dayOf(h.bars[h.bars.length - 1]);
    hcache.set(key, h);
    return h;
  }
  /** Une simulation de from à to. w : undefined = retrait du marché (m.withdraw), null = sans retrait, objet = mécanique. */
  function simulate(h, strat, m, from, to, w) {
    const bars = h.bars, n = bars.length;
    let s0 = 0; while (s0 < n && dayOf(bars[s0]) < from) s0++;
    let s1 = s0; while (s1 + 1 < n && dayOf(bars[s1 + 1]) <= to) s1++;
    if (s0 >= n || s1 - s0 < 10) return null;
    const WARM = h.timeframe === 'D1' ? 300 : 1200, a = Math.max(0, s0 - WARM), sl = bars.slice(a, s1 + 1);
    let se = settingsOf(m, { pair: h.pair, startIndex: s0 - a, timeframe: h.timeframe, broker: h.broker, symbol: h.symbol });
    if (w !== undefined) se = FC.wdApply(se, w);
    try {
      const res = h.broker ? F.broker.runBrokerBacktest(sl, strat, se, h.broker) : F.backtest.runBacktest(sl, strat, se);
      return { bars: sl, settings: se, res: res };
    } catch (e) { return null; }
  }
  /** Mécanique de retrait : objet {mode:'periodic', every, days, type, value} ou {pct, share, when}, ou nom / id enregistré. */
  function normW(x) {
    if (x == null || x === 'none' || x === false) return null;
    if (typeof x === 'string') {
      const p = wdp.get().find((q) => q.id === x || q.name === x);
      if (!p) fail('Mécanique de retrait inconnue : « ' + x + ' » (outil list_withdraw_mechanics).');
      return Object.assign({ on: true }, p.w);
    }
    if (x.w) return normW(x.w);
    if (x.type === 'none' || x.on === false) return null;
    if (x.mode === 'periodic' || x.type) return { on: true, mode: 'periodic', every: x.every || 'month', days: Math.max(15, Number(x.days) || 30), type: x.type || 'pct', value: Number(x.value) || 0 };
    if (Number(x.pct) > 0) return { on: true, mode: 'threshold', pct: Number(x.pct), share: Number(x.share) || 100, when: x.when || 'close' };
    fail('Mécanique de retrait invalide : {mode:"periodic", every:"month"|"days", days, type:"pct"|"fixed"|"excess", value} ou {pct, share, when}.');
  }
  const wName = (x, w) => (x && typeof x === 'object' && x.name) || (typeof x === 'string' ? (wdp.get().find((q) => q.id === x || q.name === x) || {}).name || x : null) || FC.wdDesc(w);
  /** Marché (réglages d'un batch) à partir de la configuration d'une simulation enregistrée (page ou agent). */
  function marketOfEntry(e) {
    const c = e.config || {}, b = c.broker || {}, w = c.withdraw || {};
    const m = { pair: e.pair || c.pair, source: c.source || (/simul/i.test(e.data || '') ? 'synthetic' : /MT5/.test(e.data || '') ? 'broker' : 'online'), capital: Number(c.capital || e.capital) || 10000,
      leverage: Number(c.leverage || e.leverage) || 10, exposurePct: Number(c.exposurePct) || 100, estimateWicks: c.estimateWicks !== false, commissionPerLot: Number(c.commission || c.commissionPerLot) || 0 };
    if (c.spreadPips != null && c.spreadPips !== '') m.spreadPips = Number(c.spreadPips);
    if (m.source === 'broker') Object.assign(m, { symbol: b.symbol || c.symbol, timeframe: b.tf || c.timeframe, sizing: b.sizing || c.sizing, fixedLots: Number(b.lots || c.fixedLots) || undefined, riskPct: Number(b.risk || c.riskPct) || undefined, maxLots: Number(b.maxLots || c.maxLots) || undefined, maxSpreadPips: b.maxSpread != null ? Number(b.maxSpread) : c.maxSpreadPips });
    if (m.source === 'csv') m.csvPath = c.csvPath;
    if (w.on) m.withdraw = w.mode === 'periodic' ? { mode: 'periodic', every: w.every, days: Number(w.days), type: w.type, value: Number(w.value) } : { pct: Number(w.pct), share: Number(w.share), when: w.when };
    return m;
  }
  /** Simulation enregistrée (format de la page) à partir d'un résultat. */
  function entryOf(strat, m, h, sim) {
    const s = sim.res.stats, st = sim.res.startIndex, se = sim.settings, bars = sim.bars, w = m.withdraw || {};
    const eq = sim.res.wealth || sim.res.equity, avg = eq.length ? eq.reduce((a, b) => a + b, 0) / eq.length : se.capital;
    const at = new Date().toISOString();
    const e = {
      at: at, name: strat.name, pair: h.pair, style: strat.style || 'none', from: dayOf(bars[st]), to: dayOf(bars[bars.length - 1]), period: 'Personnalisée',
      data: h.label, leverage: se.leverage, capital: se.capital, returnPct: s.returnPct, avgGainPct: ((avg - se.capital) / se.capital) * 100, withdrawn: s.totalWithdrawn || 0,
      trades: s.trades, winRate: s.winRate, maxDrawdownPct: s.maxDrawdownPct, profitFactor: Number.isFinite(s.profitFactor) ? s.profitFactor : null,
      rules: [strat.longEntry, strat.longExit, strat.shortEntry, strat.shortExit, strat.stopLossPips, strat.takeProfitPips].concat(TM.map((f) => strat[f] || 0)).join('|'),
      strategy: Object.assign({}, strat), source: 'mcp',
      config: { pair: h.pair, leverage: se.leverage, capital: se.capital, exposurePct: m.exposurePct || 100, spreadPips: se.spreadPips, period: 'custom', dateFrom: dayOf(bars[st]), dateTo: dayOf(bars[bars.length - 1]),
        source: h.source, estimateWicks: m.estimateWicks !== false, commission: m.commissionPerLot || 0, csvPath: m.csvPath,
        withdraw: { on: !!(w.pct > 0 || w.mode === 'periodic'), mode: w.mode || 'threshold', pct: w.pct, share: w.share, when: w.when, every: w.every, days: w.days, type: w.type, value: w.value },
        broker: h.broker ? { symbol: h.symbol, tf: h.timeframe, sizing: m.sizing || 'backtest', lots: m.fixedLots, risk: m.riskPct, maxLots: m.maxLots, maxSpread: m.maxSpreadPips, intrabar: m.intrabar !== false } : undefined },
    };
    e.key = at + '|' + e.name + '|' + Math.random().toString(36).slice(2, 7);
    return e;
  }
  /** Recharge une simulation enregistrée : {e, h, strat, m, sim}. */
  async function reload(e, w) {
    const m = marketOfEntry(e), h = await history(m), strat = resolveStrategy(Object.assign({}, e.strategy, { name: e.name || (e.strategy || {}).name }));
    const sim = simulate(h, strat, m, e.from, e.to, w);
    return sim ? { e: e, h: h, strat: strat, m: m, sim: sim } : null;
  }

  // ---------------------------------------------------------------- périodes
  /** Périodes tirées au hasard (graine fixe = reproductible) : durée en mois, années de début / fin. */
  function randomPeriods(h, n, months, o) {
    let seed = (Number(o.seed) || 12345) % 2147483647; if (seed <= 0) seed += 2147483646;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const lo = new Date(Math.max(Date.parse(h.first + 'T00:00:00Z') + 400 * 864e5, o.yearFrom ? Date.UTC(o.yearFrom, 0, 1) : 0));
    const hiEnd = new Date(Math.min(Date.parse(h.last + 'T00:00:00Z'), o.yearTo ? Date.UTC(o.yearTo, 11, 31) : Infinity));
    const out = [];
    for (let k = 0; k < n; k++) {
      const mm = Array.isArray(months) ? months[Math.floor(rnd() * months.length)] : months;
      const latest = D.addMonths(hiEnd, -mm);
      if (latest <= lo) fail('Plage trop courte pour des périodes de ' + mm + ' mois (' + iso(lo) + ' → ' + iso(hiEnd) + ').');
      // réparties sur toute la plage (une par tranche), position au hasard dans la tranche
      const t = lo.getTime() + ((k + rnd()) / n) * (latest.getTime() - lo.getTime());
      const start = new Date(Math.floor(t / 864e5) * 864e5), end = new Date(D.addMonths(start, mm).getTime() - 864e5);
      out.push({ from: iso(start), to: iso(end), months: mm });
    }
    return out;
  }

  // ---------------------------------------------------------------- batchs
  const getBatch = (id) => { const b = batches.get().find((x) => x.id === id || x.name === id); if (!b) fail('Batch introuvable : « ' + id + ' » (outil list_batches).'); return b; };
  function batchStats(L) {
    const n = L.length, ret = L.map((e) => e.returnPct), finals = L.map((e) => (e.capital || 0) * (1 + e.returnPct / 100));
    const months = L.map((e) => Math.max(1, Math.round(FC.durationDays(e.from, e.to) / 30.4375)));
    return {
      n: n, strategies: [...new Set(L.map((e) => e.name))], pairs: [...new Set(L.map((e) => e.pair))], data: [...new Set(L.map((e) => e.data))], leverage: [...new Set(L.map((e) => e.leverage))],
      from: L.map((e) => e.from).sort()[0], to: L.map((e) => e.to).sort().pop(), monthsMin: Math.min(...months), monthsMax: Math.max(...months),
      winRatePct: r2(n ? (L.filter((e) => e.returnPct > 0).length / n) * 100 : 0), medianReturnPct: r2(median(ret)), meanReturnPct: r2(mean(ret)),
      worstReturnPct: r2(Math.min(...ret)), bestReturnPct: r2(Math.max(...ret)), p10ReturnPct: r2(FC.pctile(ret, 0.1)), p90ReturnPct: r2(FC.pctile(ret, 0.9)),
      medianMonthlyPct: r2(median(L.map((e, i) => e.returnPct / months[i]))), meanMaxDrawdownPct: r2(mean(L.map((e) => e.maxDrawdownPct || 0))), worstMaxDrawdownPct: r2(Math.max(...L.map((e) => e.maxDrawdownPct || 0))),
      gapBetweenSimulations: (() => { const S = L.map((e) => e.from).sort(), d = S.slice(1).map((f, i) => FC.durationDays(S[i], f)); if (!d.length) return null; const m = mean(d), sd = Math.sqrt(d.reduce((a, v) => a + (v - m) ** 2, 0) / Math.max(1, d.length - 1)); return { meanDays: r2(m), stdDays: r2(sd), minDays: Math.min(...d), maxDays: Math.max(...d) }; })(),
      avgStartCapital: r2(mean(L.map((e) => e.capital || 0))), avgFinalCapital: r2(mean(finals)), meanTrades: r2(mean(L.map((e) => e.trades || 0))), totalWithdrawn: r2(L.reduce((a, e) => a + (e.withdrawn || 0), 0)),
    };
  }
  const simRow = (e, i) => ({ index: i, from: e.from, to: e.to, months: Math.max(1, Math.round(FC.durationDays(e.from, e.to) / 30.4375)), returnPct: r2(e.returnPct), maxDrawdownPct: r2(e.maxDrawdownPct), trades: e.trades, winRate: r2(e.winRate), withdrawn: r2(e.withdrawn || 0) });
  const batchHead = (b) => ({ id: b.id, name: b.name, at: b.at, by: b.by || (b.entries.some((e) => e.source === 'mcp') ? 'agent' : 'page'), periodsOf: b.periodsOf, note: b.note, stats: batchStats(b.entries) });
  /** Simulations d'un batch choisies par index (défaut : toutes). */
  /** Simulations d'un batch : par index, puis filtres facultatifs f = {era (nom), yearFrom, yearTo, minReturn, maxReturn}. */
  function pickEntries(b, idx, f) {
    let L = idx && idx.length ? idx.map((i) => b.entries[i] || fail('Index ' + i + ' hors du batch (0 à ' + (b.entries.length - 1) + ').')) : b.entries;
    f = f || {};
    if (f.era) { const er = ADV.normEras(erasNow()).find((x) => x.label === f.era) || fail('Époque inconnue : « ' + f.era + ' » (get_eras).'); L = L.filter((e) => { const m = ADV.midDate(e); return m >= er.fromD && m <= er.toD; }); }
    if (f.yearFrom) L = L.filter((e) => +e.from.slice(0, 4) >= f.yearFrom);
    if (f.yearTo) L = L.filter((e) => +e.to.slice(0, 4) <= f.yearTo);
    if (f.minReturn != null) L = L.filter((e) => e.returnPct >= f.minReturn);
    if (f.maxReturn != null) L = L.filter((e) => e.returnPct <= f.maxReturn);
    if (!L.length) fail('Aucune simulation ne correspond à ce choix.');
    return L;
  }

  async function runBatch(a) {
    const strat = resolveStrategy(a.strategy), m = Object.assign({}, a.market || {});
    delete m.period; delete m.dateFrom; delete m.dateTo;
    const h = await history(m);
    let periods;
    if (a.sameAs) periods = getBatch(a.sameAs).entries.map((e) => ({ from: e.from, to: e.to }));
    else if (a.periods && a.periods.length) periods = a.periods.map((p) => ({ from: p.from || p.dateFrom, to: p.to || p.dateTo }));
    else {
      const n = Math.max(1, Math.min(200, Math.round(a.n || 20)));
      const months = a.monthsList && a.monthsList.length ? a.monthsList.map(Number) : Math.max(1, Math.min(120, Math.round(a.months || 12)));
      periods = randomPeriods(h, n, months, { seed: a.seed, yearFrom: a.yearFrom, yearTo: a.yearTo });
    }
    const entries = [], skipped = [];
    for (const p of periods) {
      const sim = simulate(h, strat, m, p.from, p.to);
      if (!sim) { skipped.push(p.from + ' → ' + p.to); continue; }
      entries.push(entryOf(strat, m, h, sim));
    }
    if (!entries.length) fail('Aucune simulation possible sur ces périodes (historique ' + h.first + ' → ' + h.last + ').');
    const L = store.evaluations(); L.push(...entries); store.setEvaluations(L.slice(-5000));
    const st = batchStats(entries);
    const b = { id: uid(''), at: new Date().toISOString(), by: 'agent', entries: entries, periodsOf: a.sameAs ? getBatch(a.sameAs).id : undefined, note: a.note,
      name: a.name || strat.name + ' · ' + h.pair + ' · 1:' + (m.leverage || 10) + ' · ' + entries.length + ' simulations' + (a.yearFrom || a.yearTo ? ' · ' + (a.yearFrom || '…') + '–' + (a.yearTo || '…') : '') };
    const all = batches.get(); all.push(b); batches.set(all);
    return { batch: batchHead(b), simulations: entries.map(simRow), skipped: skipped, data: h.label, history: h.first + ' → ' + h.last,
      hint: 'Mêmes périodes pour une autre stratégie / un autre levier : run_batch avec sameAs="' + b.id + '". Puis compare_batches, time_analysis, simulate_withdrawal.' };
  }

  function compareBatches(B, eras) {
    const out = { batches: B.map((b) => Object.assign(batchHead(b), { byEra: timeAnalysis(b.entries, eras, b.entries[0].pair).byEra.map((x) => ({ era: x.era, n: x.n, winRatePct: x.winRatePct, medianReturnPct: x.medianReturnPct })) })) };
    const per = (b) => new Map(b.entries.map((e) => [e.from + '|' + e.to, e]));
    out.headToHead = [];
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const P = per(B[i]), Q = per(B[j]), common = [...P.keys()].filter((k) => Q.has(k));
      if (common.length < 3) continue;
      const d = common.map((k) => Q.get(k).returnPct - P.get(k).returnPct);
      out.headToHead.push({ a: B[i].name, b: B[j].name, samePeriods: common.length, bBetterIn: d.filter((v) => v > 0).length, aBetterIn: d.filter((v) => v < 0).length, medianDiffPct: r2(median(d)), meanDiffPct: r2(mean(d)) });
    }
    const rank = B.map((b) => { const s = batchStats(b.entries); return { name: b.name, id: b.id, robust: r2(s.medianReturnPct + 0.2 * (s.winRatePct - 50) - 0.3 * s.meanMaxDrawdownPct) }; }).sort((x, y) => y.robust - x.robust);
    out.ranking = rank;
    out.note = 'robust = rendement médian + 0,2 × (part gagnante − 50) − 0,3 × baisse maximale moyenne : préfère la régularité à un gros résultat isolé.';
    return out;
  }

  // ---------------------------------------------------------------- analyse temporelle et époques
  const erasNow = (x) => (x && x.length ? x : eraStore.get().length ? eraStore.get() : ADV.DEFAULT_CUTS);
  function eraView(T, pair) {
    return T.byEra.map((g) => ({ era: g.label, from: g.era.fromD.startsWith('0000') ? null : g.era.fromD, to: g.era.toD.startsWith('9999') ? null : g.era.toD, n: g.n,
      winRatePct: r2(g.posRate), medianReturnPct: r2(g.medianRet), meanReturnPct: r2(g.meanRet), meanMaxDrawdownPct: r2(g.meanDD), robust: r2(g.robust),
      events: EV.list(evStore.get(), pair, { from: g.era.fromD.startsWith('0000') ? undefined : g.era.fromD, to: g.era.toD.startsWith('9999') ? undefined : g.era.toD, minImp: 3 }).slice(0, 8).map((x) => x.date + ' ' + x.title) }));
  }
  function timeAnalysis(L, eras, pair) {
    const T = ADV.timeline(L, erasNow(eras));
    return {
      n: T.n, years: T.minYear + ' → ' + T.maxYear,
      byYear: T.byYear.map((g) => ({ year: g.year, n: g.n, winRatePct: r2(g.posRate), medianReturnPct: r2(g.medianRet), meanMaxDrawdownPct: r2(g.meanDD) })),
      byEra: eraView(T, pair), emptyEras: T.emptyEras, outsideEras: T.outside,
      split: T.split ? { year: T.split.year, before: { n: T.split.before.n, winRatePct: r2(T.split.before.posRate), medianReturnPct: r2(T.split.before.medianRet) }, after: { n: T.split.after.n, winRatePct: r2(T.split.after.posRate), medianReturnPct: r2(T.split.after.medianRet) } } : null,
      trendWithYears: r2(T.corr), weak: T.weak, strong: T.strong, gapsWithoutSimulation: T.gaps, verdict: T.verdict.map(strip),
    };
  }

  // ---------------------------------------------------------------- retraits fictifs
  const wdCache = new Map(); // clé de mécanique + simulation → ligne
  async function wdRows(L, w, onSkip) {
    const R = [], k = w ? FC.wdKey(w) : 'none';
    for (const e of L) {
      const ck = k + '#' + e.key;
      if (wdCache.has(ck)) { R.push(wdCache.get(ck)); continue; }
      const c = await reload(e, null);
      if (!c) { if (onSkip) onSkip(e); continue; }
      const wd = w ? simulate(c.h, c.strat, c.m, e.from, e.to, w) : c.sim;
      if (!wd) { if (onSkip) onSkip(e); continue; }
      const row = FC.wdRow(e, c.sim.settings.capital, c.sim.res, wd.res);
      wdCache.set(ck, row); R.push(row);
    }
    return R;
  }
  function aggView(g, capital) {
    return { score: r2(g.score), meanResultPct: r2(g.ret), oneYearPct: r2(g.year), finalAccountMedianPct: r2(g.finalMed), meanMaxDrawdownPct: r2(g.dd), withdrawnPerMonthEur: r2(g.perMonth),
      withdrawnPerMonthPct: r2((g.perMonth / capital) * 100), yearlyIncomePct: r2(g.yearly), monthsWithWithdrawalPct: r2(g.withPct), firstWithdrawalMonth: r2(g.first),
      capitalKept: g.kept + ' / ' + g.n, halfLost: g.ruined + ' / ' + g.n };
  }

  /** Retraits époque par époque : ce que la mécanique donne dans chaque époque. */
  function wdByEra(R, capital) {
    const eras = ADV.normEras(erasNow()), out = [];
    for (const er of eras) {
      const G = R.filter((r) => { const m = ADV.midDate(r); return m >= er.fromD && m <= er.toD; });
      if (!G.length) continue;
      const g = FC.wdAgg(G);
      out.push({ era: er.label, n: G.length, score: r2(g.score), usualBackPct: r2(median(G.map((r) => r.w.ret))), worstBackPct: r2(Math.min(...G.map((r) => r.w.ret))),
        incomePerMonthEur: r2(g.perMonth), meanMaxDrawdownPct: r2(g.dd), capitalKept: g.kept + ' / ' + g.n });
    }
    return out;
  }
  // ---------------------------------------------------------------- FX
  function trialsFor(name, extra) {
    const base = String(name || '').replace(/ \(améliorée\)$/, '').split(' + ')[0];
    const v = new Set(store.evaluations().filter((e) => e.name === name || String(e.name).startsWith(base)).map((e) => e.rules));
    return Math.max(1, v.size) * 2 + (extra || 0);
  }
  function fxView(fx, capital, detail) {
    const conf = FC.fxConfidence(fx), c = capital || fx.capital, eur = (pct) => Math.round((c * pct) / 100);
    const pr = (q) => FC.fxProjection(fx, c, q);
    const med = pr(0.5);
    const o = {
      id: fx.id, name: fx.name, strategy: fx.strategy.name, pair: fx.strategy.pair, leverage: fx.strategy.leverage, data: fx.strategy.dataLabel, principle: fx.principle,
      minCapital: Math.round(fx.capital), capital: c, simulations: fx.n, years: fx.years.join('–'), recommendedMonths: fx.duration.reco, testedMonths: fx.duration.min + ' à ' + fx.duration.max,
      winRatePct: r2(fx.winRate), annualMedianPct: r2(fx.annual), riskNote: fx.riskNote + '/7 (' + FC.RISK_TXT[fx.riskNote] + ')',
      confidence: { score: conf.score, dsr: r2(conf.parts.dsr), student: r2(conf.parts.student), eras: r2(conf.parts.eras), dataFactor: conf.data, trials: fx.trials || 1 },
      backAtEndEur: { worst: eur(fx.scenarios.worst), bad: eur(fx.scenarios.p10), usual: eur(fx.scenarios.med), good: eur(fx.scenarios.p90) },
      backAtEndPct: { worst: r2(fx.scenarios.worst - 100), bad: r2(fx.scenarios.p10 - 100), usual: r2(fx.scenarios.med - 100), good: r2(fx.scenarios.p90 - 100) },
      income: { method: fx.income.name, desc: fx.income.desc, perMonthEurUsual: med.incomePerMonthEur, yearlyPct: r2(fx.income.yearly), betterThan: fx.income.other },
      capitalAfterOneYear: { withWithdrawalEur: med.oneYearEur, withWithdrawalPct: r2(med.oneYearPct), withoutWithdrawalPct: r2(med.oneYearNoWithdrawPct), estimated: med.estimated },
      drawdown: { medianPct: r2(fx.drawdown.med), maxPct: r2(fx.drawdown.max) }, solidity: fx.solidity.score + '/100' + (fx.solidity.synthetic ? ' (données simulées : à refaire sur cours réels)' : ''),
      erasWon: fx.solidity.eraWin + ' / ' + fx.solidity.eras,
    };
    if (detail) {
      o.scenarios = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map((q) => { const p = pr(q); return { q: q, backEur: p.backEur, backPct: r2(p.backPct), incomePerMonthEur: p.incomePerMonthEur, accountEur: p.accountEur, oneYearPct: r2(p.oneYearPct) }; });
      o.path = fx.path.filter((x, i) => i % 3 === 2 || i === fx.path.length - 1).map((x, i) => ({ month: (i + 1) * 3, usualPct: r2(x.med - 100), badPct: r2(x.p10 - 100), goodPct: r2(x.p90 - 100), withdrawnPct: r2(x.wd) }));
      o.confidenceDetails = { sharpeMonthly: r2(conf.details.sr), sharpeAnnual: r2(conf.details.srAnnual), sharpeChanceThreshold: r2(conf.details.sr0), distinctMonths: conf.details.T, nEff: r2(conf.details.nEff), oneYearMeanPct: r2(conf.details.y1Mean) };
      o.strategyRules = fx.strategy.data ? strategyView(fx.strategy.data) : null;
      o.withdrawMechanic = fx.income.w;
    }
    return o;
  }
  const getFx = (id) => { const f = fxs.get().find((x) => x.id === id || x.name === id); if (!f) fail('FX introuvable : « ' + id + ' » (outil list_fx).'); return f; };
  function saveFx(fx, name) {
    const o = Object.assign({}, fx); delete o._w; delete o._sims;
    if (name) o.name = String(name).slice(0, 80);
    o.by = 'agent';
    const l = fxs.get().filter((x) => x.id !== o.id); l.push(o); fxs.set(l);
    return o;
  }

  // ---------------------------------------------------------------- chercheur de FX
  let lastMine = null;

  // ---------------------------------------------------------------- synchronisation avec la page (passerelle MT5, table kv)
  const SYNC = { 'forexia.agentGuide': guideStore, 'forexia.fx': fxs, 'forexia.batches': batches, 'forexia.eras': eraStore, 'forexia.wdPresets': wdp, 'forexia.events': evStore };
  const idOf = (x) => (x && (x.id || x.key || x.name)) || JSON.stringify(x);
  function union(a, b) { const map = new Map(); (a || []).forEach((x) => map.set(idOf(x), x)); (b || []).forEach((x) => map.set(idOf(x), x)); return [...map.values()]; }

  const strategyArg = strategySchema, marketArg = marketSchema;
  const wArg = { description: 'Mécanique de retrait : nom ou id enregistré (list_withdraw_mechanics), ou {mode:"periodic", every:"month"|"days", days, type:"excess"|"fixed"|"pct", value} (excess = % du gain du mois au-dessus du capital, fixed = somme en €, pct = % du compte), ou {pct, share, when} (au seuil de gain), ou "none".' };
  const idx = { type: 'array', items: { type: 'number' }, description: 'Index des simulations du batch (défaut : toutes).' };
  const FILT = { era: { type: 'string', description: 'ne garder que les simulations de cette époque (nom, voir get_eras)' }, yearFrom: { type: 'number' }, yearTo: { type: 'number' },
    minReturn: { type: 'number', description: 'rendement minimum (%)' }, maxReturn: { type: 'number', description: 'rendement maximum (%)' } };

  return [
    {
      name: 'fx_method',
      description: 'À APPELER EN PREMIER pour toute recherche de stratégie ou de FX : indique le guide de recherche choisi par l\'utilisateur dans la page Forexia (à suivre étape par étape), ou « liberté de l\'agent » (par défaut : méthode libre). Donne aussi les outils et les précautions.',
      inputSchema: obj({}),
      handler: async () => {
        const g = await activeGuide();
        return {
          mode: g.mode === 'guide' ? 'guide de l\'utilisateur' : 'liberté de l\'agent',
          guideName: g.name,
          instruction: g.mode === 'guide'
            ? 'L\'utilisateur a choisi le guide « ' + g.name + ' » : suis-le étape par étape pour cette recherche. Tu choisis chaque essai, dans le cadre de ce guide. Ne t\'en écarte que si l\'utilisateur le demande, et dis-le.'
            : 'Aucun guide imposé : cherche avec ta propre méthode et ton jugement, en utilisant librement tous les outils. (Guide proposé, facultatif : outil agent_guide.)',
          guide: g.text,
          source: g.source,
          goal: 'Un FX = stratégie + paire + levier + capital + durée de placement (mois) + manière de retirer, testé sur de nombreuses périodes passées. Il donne ce que le client récupère au bout de la durée (pire cas, mauvais, le plus souvent, bon), le revenu mensuel, le risque (1 à 7) et un score de confiance statistique (DSR, Student, époques, corrigé du nombre d\'essais).',
          cautions: [
            'N\'invente aucun chiffre : cite les sorties des outils.',
            'Plus on essaie de combinaisons, plus un bon résultat peut venir du hasard : le score de confiance en tient compte.',
            'Les données simulées (source synthetic) servent à tester la mécanique, pas le marché : conclure sur cours réels.',
            'Levier au-delà de 1:30 : hors limite européenne pour les particuliers.',
          ],
          tools: ['modify_strategy', 'run_batch', 'vary_batch', 'improve_batch', 'subset_batch', 'list_batches', 'get_batch', 'compare_batches', 'time_analysis', 'get_eras', 'set_eras', 'market_events', 'analyze_simulation', 'apply_proposal', 'era_analysis',
            'simulate_withdrawal', 'compare_withdrawals', 'save_withdraw_mechanic', 'list_withdraw_mechanics', 'build_fx', 'fx_projection', 'list_fx', 'get_fx', 'save_fx', 'rename_fx', 'delete_fx', 'mine_fx', 'note_add', 'note_list', 'forexia_sync', 'import_ea', 'agent_guide'],
          currentEras: erasNow(),
        };
      },
    },
    {
      name: 'agent_guide',
      description: 'Guides de recherche de l\'utilisateur (bouton « 🧭 Guide agent » de la page) : liste, guide choisi, texte d\'un guide (show), ou choix d\'un autre guide si l\'utilisateur le demande dans la conversation (select : nom du guide, "forexia" pour la Démarche Forexia, "free" pour la liberté de l\'agent).',
      inputSchema: obj({ show: { type: 'string', description: 'nom du guide à afficher' }, select: { type: 'string' } }),
      handler: async (a) => {
        const g = await activeGuide(), all = g.all;
        const list = [{ id: 'free', name: 'Liberté de l\'agent (par défaut)' }, { id: 'forexia', name: 'Démarche Forexia' }].concat(all.items.map((x) => ({ id: x.id, name: x.name })));
        const find = (n) => list.find((x) => x.id === n || x.name === n || x.name.toLowerCase() === String(n).toLowerCase()) || fail('Guide inconnu : « ' + n + ' ». Guides : ' + list.map((x) => x.name).join(', '));
        if (a.select) {
          const x = find(a.select), v = { active: x.id, items: all.items, updatedAt: new Date().toISOString() };
          guideStore.set(v);
          let pushed = false;
          if (process.env.FOREXIA_BRIDGE_TOKEN) { try { await bridge('POST', '/db/kv/put', { key: 'forexia.agentGuide', data: v, updatedAt: v.updatedAt }); pushed = true; } catch (e) { /* page mise à jour plus tard */ } }
          return { selected: x.name, sentToPage: pushed };
        }
        const out = { active: g.name, mode: g.mode, source: g.source, guides: list.map((x) => ({ name: x.name, active: x.id === all.active || (x.id === 'free' && g.mode === 'free' && !['forexia'].concat(all.items.map((i) => i.id)).includes(all.active)) })) };
        if (a.show) { const x = find(a.show); out.text = x.id === 'forexia' ? methodText() : x.id === 'free' ? null : all.items.find((i) => i.id === x.id).text; }
        return out;
      },
    },
    // ------------------------------------------------------------ batchs
    {
      name: 'run_batch',
      description: 'Lance un batch : la même stratégie et les mêmes réglages sur plusieurs périodes passées, enregistré (comme « Lancer un lot » puis « Enregistrer un batch »). Périodes : tirées au hasard (n, months = durée en mois ou monthsList, plage yearFrom–yearTo, seed pour reproduire), données (periods), ou LES MÊMES qu\'un autre batch (sameAs) pour comparer en ne changeant qu\'une chose.',
      inputSchema: obj({ strategy: strategyArg, market: marketArg, n: { type: 'number', description: '1 à 200 (défaut 20)' }, months: { type: 'number', description: 'durée de chaque période en mois (défaut 12)' },
        monthsList: { type: 'array', items: { type: 'number' }, description: 'durées possibles (tirées au hasard), à la place de months' }, yearFrom: { type: 'number' }, yearTo: { type: 'number' }, seed: { type: 'number' },
        periods: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } } }, sameAs: { type: 'string', description: 'id ou nom d\'un batch' }, name: { type: 'string' }, note: { type: 'string' } }, ['strategy']),
      handler: runBatch,
    },
    {
      name: 'list_batches', description: 'Batchs enregistrés (par l\'agent et, après forexia_sync pull, ceux de la page) avec leurs chiffres : rendement médian, part gagnante, capital moyen, période.',
      inputSchema: obj({ strategy: { type: 'string' }, pair: { type: 'string' } }),
      handler: async (a) => batches.get().filter((b) => (!a.strategy || b.entries.some((e) => e.name === a.strategy)) && (!a.pair || b.entries.some((e) => e.pair === a.pair))).map(batchHead),
    },
    {
      name: 'get_batch', description: 'Détail d\'un batch : chiffres, chaque simulation (index, dates, rendement, baisse maximale…), stratégie et réglages.',
      inputSchema: obj({ id: { type: 'string' } }, ['id']),
      handler: async (a) => { const b = getBatch(a.id), e0 = b.entries[0] || {}; return Object.assign(batchHead(b), { strategy: e0.strategy ? strategyView(e0.strategy) : null, market: e0.config ? marketOfEntry(e0) : null, simulations: b.entries.map(simRow) }); },
    },
    {
      name: 'rename_batch', description: 'Renomme un batch ou change sa note.', inputSchema: obj({ id: { type: 'string' }, name: { type: 'string' }, note: { type: 'string' } }, ['id']),
      handler: async (a) => { const l = batches.get(), b = l.find((x) => x.id === a.id || x.name === a.id) || fail('Batch introuvable.'); if (a.name) b.name = a.name; if (a.note != null) b.note = a.note; batches.set(l); return batchHead(b); },
    },
    {
      name: 'delete_batch', description: 'Supprime un batch.', inputSchema: obj({ id: { type: 'string' } }, ['id']),
      handler: async (a) => { const b = getBatch(a.id); batches.set(batches.get().filter((x) => x.id !== b.id)); return { deleted: b.name }; },
    },
    {
      name: 'compare_batches',
      description: 'Compare des batchs côte à côte (chiffres, époques) ; si deux batchs ont les mêmes périodes (sameAs), comparaison période par période : qui gagne le plus souvent, écart médian. Pour déduire quel levier, quelle durée, quelle stratégie ou quelle paire est meilleure.',
      inputSchema: obj({ ids: { type: 'array', items: { type: 'string' } }, eras: { type: 'array', items: {}, description: 'époques (sinon celles enregistrées)' } }, ['ids']),
      handler: async (a) => { const B = (a.ids || []).map(getBatch); if (B.length < 2) fail('Indiquez au moins deux batchs.'); return compareBatches(B, a.eras); },
    },
    {
      name: 'time_analysis',
      description: 'Analyse temporelle d\'un batch (ou de plusieurs réunis) : résultats par année et par époque, rupture dans le temps, tendance avec les années, années sans simulation, grands événements de marché de chaque époque, verdict.',
      inputSchema: obj({ id: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } }, eras: { type: 'array', items: {}, description: 'années de coupure [2000, 2008, …] ou [{name, from, to}] ; défaut : époques enregistrées' } }),
      handler: async (a) => {
        const B = (a.ids && a.ids.length ? a.ids : [a.id || fail('Indiquez id ou ids.')]).map(getBatch), L = B.flatMap((b) => b.entries);
        return Object.assign({ batches: B.map((b) => b.name) }, timeAnalysis(L, a.eras, L[0] && L[0].pair));
      },
    },
    {
      name: 'get_eras', description: 'Époques utilisées par l\'analyse temporelle (définies par l\'agent ou par l\'utilisateur dans la page, sinon par défaut : coupures 2000, 2008, 2013, 2020).',
      inputSchema: obj({}),
      handler: async () => ({ eras: ADV.normEras(erasNow()).map((e) => ({ name: e.label, from: e.fromD.startsWith('0000') ? null : e.fromD, to: e.toD.startsWith('9999') ? null : e.toD })), custom: eraStore.get().length > 0, suggestedCuts: EV.cutEvents().map((e) => e.date + ' ' + e.title) }),
    },
    {
      name: 'set_eras', description: 'Définit les époques : [{name, from:"AAAA-MM-JJ" ou "", to:"AAAA-MM-JJ" ou ""}] ou années de coupure [2000, 2008, 2015] ; [] remet les époques par défaut.',
      inputSchema: obj({ eras: { type: 'array', items: {} } }, ['eras']),
      handler: async (a) => {
        const l = (a.eras || []).map((e, i) => (typeof e === 'number' ? e : { id: 'e' + Date.now().toString(36) + i, name: e.name || 'Époque ' + (i + 1), from: e.from || '', to: e.to || '' }));
        if (l.length && typeof l[0] === 'number') { const er = ADV.erasFromCuts(l); eraStore.set(er.map((e, i) => ({ id: 'e' + Date.now().toString(36) + i, name: e.label, from: e.fromD.startsWith('0000') ? '' : e.fromD, to: e.toD.startsWith('9999') ? '' : e.toD }))); }
        else eraStore.set(l);
        return { eras: ADV.normEras(erasNow()).map((e) => e.label) };
      },
    },
    {
      name: 'market_events',
      description: 'Grands événements du marché des changes (base de Forexia depuis 1971 + mouvements exceptionnels détectés) pour une paire et une période. detect=true cherche les nouveaux mouvements exceptionnels dans l\'historique et les ajoute ; add ajoute un événement.',
      inputSchema: obj({ pair: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, minImportance: { type: 'number', description: '1 à 3' }, detect: { type: 'boolean' },
        add: { type: 'object', description: 'ajoute un événement (constaté par l\'agent) : {date, title, text, importance 1–3, currencies ["USD"]}' }, source: { type: 'string', enum: ['online', 'synthetic', 'csv', 'broker'] } }),
      handler: async (a) => {
        const pair = a.pair || 'EUR/USD', out = {};
        if (a.detect) {
          const h = await history({ pair: pair, source: a.source || 'online' }), daily = h.timeframe === 'D1' ? h.bars : D.resample(h.bars, 'D1');
          const r = EV.learn(evStore.get(), daily, pair); r.stored.scanned = Object.assign({}, evStore.get().scanned || {}, { [pair]: { from: h.first, to: h.last } });
          evStore.set(r.stored); out.detected = r.added.map((e) => e.date + ' ' + e.title);
        }
        if (a.add) {
          const x = a.add; if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date || '') || !x.title) fail('add : date (AAAA-MM-JJ) et title requis.');
          const st = evStore.get(), ev = { id: 'u' + Date.now().toString(36), source: 'user', date: x.date, imp: Math.max(1, Math.min(3, Number(x.importance) || 2)), cur: x.currencies && x.currencies.length ? x.currencies : pair.split('/'), kind: 'Ajouté par l\'agent', title: x.title, text: x.text || '' };
          st.items = (st.items || []).concat(ev); evStore.set(st); out.added = ev;
        }
        out.events = EV.list(evStore.get(), pair, { from: a.from, to: a.to, minImp: a.minImportance }).map((e) => ({ date: e.date, importance: e.imp, kind: e.kind, title: e.title, text: e.text, source: e.source }));
        return out;
      },
    },
    // ------------------------------------------------------------ analyseurs
    {
      name: 'analyze_simulation',
      description: 'Analyseur d\'une simulation (bouton « Analyseur ») : d\'où vient la plus forte baisse, où la stratégie gagne et perd (régime de marché, sens, volatilité), et corrections proposées (ids pour apply_proposal). Simulation d\'un batch (id + index) ou stratégie + marché + dates.',
      inputSchema: obj({ id: { type: 'string', description: 'batch' }, index: { type: 'number' }, strategy: strategyArg, market: marketArg }),
      handler: async (a) => {
        let c;
        if (a.id) { const b = getBatch(a.id), e = b.entries[a.index || 0] || fail('Index hors du batch.'); c = await reload(e); }
        else {
          const m = a.market || {}; if (!m.dateFrom || !m.dateTo) fail('Indiquez market.dateFrom et market.dateTo (ou un batch).');
          const strat = resolveStrategy(a.strategy), h = await history(m), sim = simulate(h, strat, m, m.dateFrom, m.dateTo); c = sim ? { strat: strat, sim: sim, h: h } : null;
        }
        if (!c) fail('Simulation impossible à recharger.');
        const r = A.analyze(c.sim.bars, c.strat, c.sim.settings, c.sim.res);
        return { period: dayOf(c.sim.bars[c.sim.res.startIndex]) + ' → ' + dayOf(c.sim.bars[c.sim.bars.length - 1]), result: statsView(c.sim.res.stats), kind: r.kind, verdict: strip(r.verdict),
          drop: r.drop ? JSON.parse(JSON.stringify(r.drop, (k, v) => (typeof v === 'string' ? strip(v) : typeof v === 'number' ? r2(v) : v))) : null,
          sections: r.sections.map((s) => ({ title: strip(s.title), level: s.level, items: (s.items || []).map(strip) })),
          proposals: r.proposals.map((p) => ({ id: p.id, title: strip(p.title), why: strip(p.why) })) };
      },
    },
    {
      name: 'apply_proposal',
      description: 'Teste une correction de l\'analyseur (id de analyze_simulation) ou de l\'analyseur d\'époque (adx25, adx20, ema200, long, short, volhi, vollo, slope, sl, trail) sur une simulation ou sur tout le batch : résultat avant / après pour chaque simulation. saveAsBatch=true enregistre le batch corrigé (mêmes périodes).',
      inputSchema: obj({ id: { type: 'string' }, proposal: { type: 'string' }, index: { type: 'number', description: 'simulation où la proposition a été trouvée (défaut 0)' }, proposals: { type: 'array', items: { type: 'string' }, description: 'plusieurs corrections combinées (à la place de proposal)' }, scope: { type: 'string', enum: ['one', 'batch'] }, saveAsBatch: { type: 'boolean' } }, ['id']),
      handler: async (a) => {
        const b = getBatch(a.id), e0 = b.entries[a.index || 0] || fail('Index hors du batch.'), c0 = await reload(e0);
        if (!c0) fail('Simulation impossible à recharger.');
        const P = A.analyze(c0.sim.bars, c0.strat, c0.sim.settings, c0.sim.res).proposals.concat(A.eraCandidates(c0.strat, null));
        const ids = a.proposals && a.proposals.length ? a.proposals : [a.proposal || fail('Indiquez proposal ou proposals.')];
        const PS = ids.map((id) => P.find((x) => x.id === id) || fail('Proposition inconnue : ' + id + ' (disponibles : ' + P.map((x) => x.id).join(', ') + ').'));
        const p = { title: PS.map((x) => strip(x.title)).join(' + ') };
        const T = a.scope === 'batch' ? b.entries : [e0], rows = [], newEntries = [];
        let stratAfter = null;
        for (const e of T) {
          const c = e === e0 ? c0 : await reload(e);
          if (!c) continue;
          const y = PS.reduce((acc, q) => A.applyProposal(acc.strat, acc.settings, q), { strat: c.strat, settings: c.sim.settings });
          stratAfter = stratAfter || Object.assign({}, y.strat, { name: c.strat.name + ' + ' + strip(p.title).slice(0, 40) });
          const res = c.h.broker ? F.broker.runBrokerBacktest(c.sim.bars, y.strat, y.settings, c.h.broker) : F.backtest.runBacktest(c.sim.bars, y.strat, y.settings);
          rows.push({ from: e.from, to: e.to, before: r2(e.returnPct), after: r2(res.stats.returnPct), ddBefore: r2(e.maxDrawdownPct), ddAfter: r2(res.stats.maxDrawdownPct) });
          if (a.saveAsBatch) { const ne = entryOf(stratAfter, c.m, c.h, { bars: c.sim.bars, settings: y.settings, res: res }); newEntries.push(ne); }
        }
        const out = { proposal: strip(p.title), simulations: rows, summary: { n: rows.length, winBefore: rows.filter((r) => r.before > 0).length, winAfter: rows.filter((r) => r.after > 0).length, medianBefore: r2(median(rows.map((r) => r.before))), medianAfter: r2(median(rows.map((r) => r.after))), improved: rows.filter((r) => r.after > r.before).length },
          strategyAfter: stratAfter ? strategyView(stratAfter) : null };
        if (a.saveAsBatch && newEntries.length) {
          const nb = { id: uid(''), at: new Date().toISOString(), by: 'agent', periodsOf: b.id, entries: newEntries, name: b.name + ' + ' + strip(p.title).slice(0, 40) };
          const l = batches.get(); l.push(nb); batches.set(l); out.newBatch = batchHead(nb);
        }
        return out;
      },
    },
    {
      name: 'era_analysis',
      description: 'Analyseur d\'époque (comme dans la page) : recharge les simulations d\'un batch dans chaque époque, compare le marché des époques perdantes et gagnantes (direction, tendance, volatilité, chocs, trades) et teste les corrections sur chaque époque.',
      inputSchema: obj({ id: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } }, maxPerEra: { type: 'number', description: '2 à 30 (défaut 8)' }, eras: { type: 'array', items: {} } }),
      handler: async (a) => {
        const L = (a.ids && a.ids.length ? a.ids : [a.id || fail('Indiquez id.')]).map(getBatch).flatMap((b) => b.entries);
        const names = {}; L.forEach((e) => { names[e.name] = (names[e.name] || 0) + 1; });
        const name = Object.keys(names).sort((x, y) => names[y] - names[x])[0], max = Math.max(2, Math.min(30, Math.round(a.maxPerEra || 8)));
        const T = ADV.timeline(L, erasNow(a.eras)), inEra = (e, er) => { const m = ADV.midDate(e); return m >= er.fromD && m <= er.toD; };
        const pick = (X) => { if (X.length <= max) return X; const o = []; for (let i = 0; i < max; i++) o.push(X[Math.floor((i * X.length) / max)]); return o; };
        const groups = [];
        for (const g of T.byEra) {
          const items = [];
          for (const e of pick(L.filter((x) => x.name === name && inEra(x, g.era)))) {
            const c = await reload(e);
            if (c) items.push({ ctx: { bars: c.sim.bars, strat: c.strat, settings: c.sim.settings }, features: A.marketFeatures(c.sim.bars, c.sim.res.startIndex), trades: A.tradeFeatures(c.sim.bars, c.sim.res), returnPct: c.sim.res.stats.returnPct });
          }
          if (items.length) groups.push({ label: g.label, items: items, med: median(items.map((x) => x.returnPct)), win: (items.filter((x) => x.returnPct > 0).length / items.length) * 100 });
        }
        if (groups.length < 2) fail('Il faut des simulations de « ' + name + ' » dans au moins deux époques (lancez un batch sur une plage plus large).');
        let bad = groups.filter((g) => g.med <= 0), good = groups.filter((g) => g.med > 0), mode = 'perdantes contre gagnantes';
        if (!bad.length || !good.length) { const s = groups.slice().sort((x, y) => x.med - y.med); bad = [s[0]]; good = [s[s.length - 1]]; mode = 'la moins bonne contre la meilleure'; }
        const strat = groups[0].items[0].ctx.strat;
        const cmp = A.compareEras(bad.flatMap((g) => g.items), good.flatMap((g) => g.items), strat, [bad.length > 1 ? 'dans les époques perdantes' : 'pendant « ' + bad[0].label + ' »', good.length > 1 ? 'dans les époques gagnantes' : 'pendant « ' + good[0].label + ' »']);
        const fixes = A.eraCandidates(strat, cmp).map((p) => {
          let tr0 = 0, tr1 = 0;
          const per = groups.map((g) => {
            const after = g.items.map((x) => { const y = A.applyProposal(x.ctx.strat, x.ctx.settings, p), s2 = E.run(x.ctx.bars, y.strat, y.settings); tr0 += x.trades.length; tr1 += s2 ? s2.trades : 0; return s2 ? s2.returnPct : NaN; });
            return { era: g.label, before: r2(g.med), after: r2(median(after)) };
          });
          const dBad = mean(per.filter((x, i) => bad.includes(groups[i])).map((x) => x.after - x.before)), dGood = mean(per.filter((x, i) => good.includes(groups[i])).map((x) => x.after - x.before));
          const few = tr0 ? tr1 / tr0 < 0.35 : false;
          return { id: p.id, title: p.title, perEra: per, gainInLosingEras: r2(dBad), gainInWinningEras: r2(dGood), tooFewTrades: few, recommended: !few && dBad > 1 && dGood >= -Math.max(5, Math.abs(mean(good.map((g) => g.med))) * 0.25) };
        }).sort((x, y) => (y.recommended - x.recommended) || (y.gainInLosingEras + Math.min(0, y.gainInWinningEras)) - (x.gainInLosingEras + Math.min(0, x.gainInWinningEras)));
        return { strategy: name, comparison: mode, eras: groups.map((g) => ({ era: g.label, reloaded: g.items.length, winRatePct: r2(g.win), medianReturnPct: r2(g.med) })),
          causes: cmp.causes.slice(0, 6).map((x) => strip(x.text)), market: cmp.rows.map((r) => ({ what: r.label, losing: Number.isFinite(r.a) ? strip(r.fmt(r.a)) : null, winning: Number.isFinite(r.b) ? strip(r.fmt(r.b)) : null })),
          fixes: fixes, hint: 'Correction recommandée : apply_proposal (id du batch, proposal, scope batch, saveAsBatch) puis time_analysis du nouveau batch.' };
      },
    },
    // ------------------------------------------------------------ retraits fictifs
    {
      name: 'simulate_withdrawal',
      description: '« Resimuler avec un retrait » : relance les simulations d\'un batch (toutes ou certaines) avec une mécanique de retrait ; pour chacune : ce qui reste sur le compte, retiré au total, capital au bout d\'un an avec et sans retrait ; et les indicateurs d\'ensemble.',
      inputSchema: obj(Object.assign({ id: { type: 'string' }, mechanic: wArg, indexes: idx }, FILT), ['id', 'mechanic']),
      handler: async (a) => {
        const b = getBatch(a.id), w = normW(a.mechanic), L = pickEntries(b, a.indexes, a), skipped = [];
        const R = await wdRows(L, w, (e) => skipped.push(e.from));
        if (!R.length) fail('Simulations impossibles à relancer.');
        const cap = median(R.map((r) => r.capital));
        return { mechanic: wName(a.mechanic, w), desc: FC.wdDesc(w), capital: cap, overall: aggView(FC.wdAgg(R), cap), byEra: wdByEra(R, cap), skipped: skipped,
          simulations: FC.fxSimsFromRows(R).map((s) => ({ from: s.from, to: s.to, months: s.m, backPct: r2(s.b - 100), withdrawnTotalPct: r2(s.tot), incomePerMonthEur: r2((s.inc * cap) / 100), accountAtEndPct: r2(s.acc - 100), oneYearWithPct: r2(s.y1), oneYearWithoutPct: r2(s.y1b), estimatedOneYear: s.est })) };
      },
    },
    {
      name: 'compare_withdrawals',
      description: 'Compare plusieurs mécaniques de retrait sur les mêmes simulations d\'un batch (bouton « Comparer ») et désigne la meilleure (note d\'équilibre : rapporte, risque, capital préservé). Sans mechanics : excédent 25/50/75 %, somme fixe 0,5/1/2 % du capital par mois, 1 % du compte par mois.',
      inputSchema: obj(Object.assign({ id: { type: 'string' }, mechanics: { type: 'array', items: {}, description: 'liste de mécaniques (voir simulate_withdrawal)' }, indexes: idx, byEra: { type: 'boolean', description: 'meilleure mécanique pour chaque époque' } }, FILT), ['id']),
      handler: async (a) => {
        const b = getBatch(a.id), L = pickEntries(b, a.indexes, a), cap0 = median(L.map((e) => e.capital || 10000));
        const list = a.mechanics && a.mechanics.length ? a.mechanics : FC.minerMechs({ budget: cap0, prefs: { excess: true, fixed: true, pct: true, none: true } }).map((x) => x.w ? Object.assign({ name: x.name }, x.w) : 'none');
        const out = [];
        for (const x of list) {
          const w = normW(x), R = await wdRows(L, w);
          if (R.length) out.push(Object.assign({ mechanic: x === 'none' ? 'Sans retrait' : wName(x, w), desc: FC.wdDesc(w), w: w }, aggView(FC.wdAgg(R), median(R.map((r) => r.capital)))));
        }
        out.sort((p, q) => q.score - p.score);
        let perEra;
        if (a.byEra) {
          perEra = {};
          for (const x of list) {
            const w = normW(x), R = await wdRows(L, w), name = x === 'none' ? 'Sans retrait' : wName(x, w);
            for (const g of wdByEra(R, median(R.map((r) => r.capital)))) (perEra[g.era] = perEra[g.era] || []).push(Object.assign({ mechanic: name }, g));
          }
          for (const k of Object.keys(perEra)) perEra[k].sort((p, q) => q.score - p.score);
          perEra = Object.keys(perEra).map((k) => ({ era: k, best: perEra[k][0].mechanic, ranking: perEra[k].map((x) => ({ mechanic: x.mechanic, score: x.score, usualBackPct: x.usualBackPct, incomePerMonthEur: x.incomePerMonthEur, capitalKept: x.capitalKept })) }));
        }
        return { simulations: L.length, ranking: out, byEra: perEra, best: out[0] ? out[0].mechanic : null, note: 'score = rendement total (compte + retraits) − ½ baisse maximale + 20 × part du capital préservé − 25 × part des cas où la moitié est perdue.' };
      },
    },
    {
      name: 'save_withdraw_mechanic', description: 'Enregistre une mécanique de retrait sous un nom (visible dans la page après forexia_sync push).',
      inputSchema: obj({ name: { type: 'string' }, mechanic: wArg }, ['name', 'mechanic']),
      handler: async (a) => { const w = normW(a.mechanic) || fail('Une mécanique « sans retrait » ne s\'enregistre pas.'); const l = wdp.get().filter((p) => p.name !== a.name), p = { id: 'w' + Date.now().toString(36), name: a.name, w: w }; l.push(p); wdp.set(l); return p; },
    },
    {
      name: 'list_withdraw_mechanics', description: 'Mécaniques de retrait enregistrées.', inputSchema: obj({}),
      handler: async () => wdp.get().map((p) => ({ id: p.id, name: p.name, desc: FC.wdDesc(p.w), w: p.w })),
    },
    // ------------------------------------------------------------ FX
    {
      name: 'build_fx',
      description: 'Construit un FX (plan d\'investissement) à partir d\'un batch et d\'une mécanique de retrait : durée recommandée (mois), part de réussite, scénarios (pire, mauvais, le plus souvent, bon) en € pour le capital, revenu mensuel, capital au bout d\'un an avec / sans retrait, risque 1–7, score de confiance (DSR, Student, époques, corrigé du nombre d\'essais). save=true l\'enregistre.',
      inputSchema: obj(Object.assign({ id: { type: 'string' }, mechanic: wArg, indexes: idx, capital: { type: 'number', description: 'capital du client (€) pour les montants (≥ capital des simulations)' }, name: { type: 'string' }, save: { type: 'boolean' },
        trials: { type: 'number', description: 'nombre d\'essais à déclarer pour la confiance (défaut : variantes de la stratégie dans l\'historique × 2 + batchs comparés)' } }, FILT), ['id', 'mechanic']),
      handler: async (a) => {
        const b = getBatch(a.id), w = normW(a.mechanic), L = pickEntries(b, a.indexes, a), R = await wdRows(L, w);
        if (R.length < 3) fail('Il faut au moins 3 simulations relancées (batch plus grand).');
        const e0 = L[0], nameW = a.mechanic === 'none' || !w ? 'Sans retrait' : wName(a.mechanic, w);
        const fx = FC.fxFromRows(R, { name: e0.name, strategy: e0.strategy, config: e0.config, pair: e0.pair, leverage: e0.leverage, dataLabel: e0.data, synthetic: L.some((e) => /simul/i.test(e.data || '')),
          mech: { name: nameW, w: w || { on: false, mode: 'periodic', type: 'none', value: 0 } }, other: { name: '—' }, trials: a.trials || trialsFor(e0.name, batches.get().length), eras: eraStore.get().length ? eraStore.get() : undefined });
        if (!w) fx.income = Object.assign(fx.income, { desc: 'pas de retrait partiel durant la période de trading', perMonthPct: 0, fixedPct: null });
        fx.name = a.name || 'FX ' + e0.name + ' · ' + e0.pair + ' · 1:' + e0.leverage + ' · ' + nameW;
        fx.batch = b.id; fx.keys = R.map((r) => r.key);
        const capital = Math.max(fx.capital, Number(a.capital) || fx.capital);
        if (a.save) saveFx(fx);
        return Object.assign({ saved: !!a.save }, fxView(fx, capital, true));
      },
    },
    {
      name: 'fx_projection', description: 'Ce qu\'un FX enregistré donne pour un capital et un scénario : q = 0 (pire cas), 0,1 (si ça se passe mal), 0,5 (le plus souvent), 0,9 (si ça se passe bien), 1 (au mieux) — comme le point à glisser sur la carte FX.',
      inputSchema: obj({ id: { type: 'string' }, capital: { type: 'number' }, q: { type: 'number' } }, ['id']),
      handler: async (a) => { const fx = getFx(a.id), c = Math.max(fx.capital, Number(a.capital) || fx.capital); return Object.assign({ minCapital: Math.round(fx.capital), note: Number(a.capital) < fx.capital ? 'capital relevé au minimum du FX' : undefined }, FC.fxProjection(fx, c, a.q)); },
    },
    {
      name: 'list_fx', description: 'FX enregistrés (par l\'agent et, après forexia_sync pull, ceux de la page) : résumé de chacun.',
      inputSchema: obj({}),
      handler: async () => fxs.get().filter((f) => f.v === 2).map((f) => { const v = fxView(f); return { id: v.id, name: v.name, by: f.by || 'page', pair: v.pair, leverage: v.leverage, capital: v.minCapital, recommendedMonths: v.recommendedMonths, winRatePct: v.winRatePct, usualBackEur: v.backAtEndEur.usual, riskNote: v.riskNote, confidence: v.confidence.score, income: v.income.desc }; }),
    },
    {
      name: 'get_fx', description: 'Détail complet d\'un FX enregistré (scénarios, évolution, confiance, règles de la stratégie), pour un capital donné.',
      inputSchema: obj({ id: { type: 'string' }, capital: { type: 'number' } }, ['id']),
      handler: async (a) => { const fx = getFx(a.id); return fxView(fx, Math.max(fx.capital, Number(a.capital) || fx.capital), true); },
    },
    {
      name: 'save_fx', description: 'Enregistre un FX proposé par mine_fx (candidate = numéro dans la liste, à partir de 1) ; avec saveStrategy=true, enregistre aussi la stratégie créée par le chercheur.',
      inputSchema: obj({ candidate: { type: 'number' }, name: { type: 'string' }, saveStrategy: { type: 'boolean' } }, ['candidate']),
      handler: async (a) => {
        if (!lastMine) fail('Lancez d\'abord mine_fx.');
        const c = lastMine.pick[(a.candidate || 1) - 1] || fail('Candidat inconnu (1 à ' + lastMine.pick.length + ').');
        const fx = saveFx(c.fx, a.name), out = { saved: fxView(fx) };
        if (a.saveStrategy && c.fx.strategy.data && c.fx.strategy.data.generated) {
          const l = store.strategies().filter((s) => s.name !== c.fx.strategy.data.name); l.push(Object.assign({}, strategyView(c.fx.strategy.data), { generated: c.fx.strategy.data.generated, description: c.fx.strategy.data.description })); store.setStrategies(l);
          out.strategySaved = c.fx.strategy.data.name;
        }
        return out;
      },
    },
    {
      name: 'rename_fx', description: 'Renomme un FX enregistré.', inputSchema: obj({ id: { type: 'string' }, name: { type: 'string' } }, ['id', 'name']),
      handler: async (a) => { const l = fxs.get(), f = l.find((x) => x.id === a.id || x.name === a.id) || fail('FX introuvable.'); f.name = String(a.name).slice(0, 80); fxs.set(l); return { id: f.id, name: f.name }; },
    },
    {
      name: 'delete_fx', description: 'Supprime un FX enregistré.', inputSchema: obj({ id: { type: 'string' } }, ['id']),
      handler: async (a) => { const f = getFx(a.id); fxs.set(fxs.get().filter((x) => x.id !== f.id)); return { deleted: f.name }; },
    },
    {
      name: 'mine_fx',
      description: 'Chercheur de FX : essaie toutes les combinaisons stratégies (modèles + stratégies enregistrées + variantes qu\'il crée) × leviers × manières de retirer, sur les mêmes périodes passées de la durée choisie, et propose les plans qui respectent les critères (sinon les plus proches). Peut prendre de quelques secondes (synthetic) à plusieurs minutes (toutes les paires, cours réels).',
      inputSchema: obj({
        budget: { type: 'number', description: 'capital à investir en € (défaut 10000)' }, maxRisk: { type: 'number', description: '1 à 7 (défaut 4)' }, minConf: { type: 'number', description: 'confiance minimum 0–100 (défaut 50)' },
        months: { type: 'number', description: 'durée du placement en mois (défaut 12)' }, income: { type: 'number', description: 'revenu souhaité en € par mois (facultatif)' }, maxLev: { type: 'number', description: 'levier maximum (3 à 500, défaut 30 ; > 30 hors limite UE particuliers)' },
        prefs: { type: 'object', description: 'manières de retirer acceptées : {excess, fixed, pct, none} (booléens ; défaut excédent + somme fixe)' }, pair: { type: 'string', description: 'paire, ou "*" pour toutes (plus long)' },
        source: { type: 'string', enum: ['online', 'synthetic', 'csv', 'broker'] }, effort: { type: 'string', enum: ['fast', 'normal', 'deep'], description: '12, 20 ou 40 périodes' }, create: { type: 'boolean', description: 'créer des variantes de stratégies (défaut oui)' },
        includeSaved: { type: 'boolean', description: 'inclure les stratégies enregistrées (défaut oui)' }, strategies: { type: 'array', items: strategyArg, description: 'limiter la recherche à ces stratégies' }, market: marketArg,
      }),
      handler: async (a) => {
        const o = { budget: Math.max(100, Number(a.budget) || 10000), maxRisk: Number(a.maxRisk) || 4, minConf: a.minConf != null ? Number(a.minConf) : 50, months: Math.max(1, Math.min(120, Math.round(a.months || 12))), income: a.income || '',
          prefs: Object.assign({ excess: true, fixed: true, pct: false, none: false }, a.prefs || {}), create: a.create !== false, effort: a.effort || 'normal', maxLev: Number(a.maxLev) || 30, pair: a.pair || 'EUR/USD' };
        const mechs = FC.minerMechs(o); if (!mechs.length) fail('Acceptez au moins une manière de retirer (prefs).');
        const strats = a.strategies && a.strategies.length ? a.strategies.map(resolveStrategy)
          : F.presets.list.map((p) => Object.assign({}, p)).concat(a.includeSaved === false ? [] : store.strategies().map((s) => { try { return resolveStrategy(s); } catch (e) { return null; } }).filter(Boolean)).filter((s) => s.longEntry || s.shortEntry);
        const levs = FC.MINER_LEV.filter((l) => l <= o.maxLev), K = { fast: 12, normal: 20, deep: 40 }[o.effort] || 20, pairs = o.pair === '*' ? D.PAIRS.slice() : [o.pair];
        const found = [], skipped = [], t0 = Date.now();
        let screened = 0, created = 0, done = 0, combos = 0, synthetic = false;
        const score = (fx, oo, w) => FC.minerScore(fx, oo, w);
        for (const pair of pairs) {
          const m = Object.assign({}, a.market || {}, { pair: pair, source: a.source || (a.market && a.market.source) || 'online', capital: o.budget });
          let h; try { h = await history(m); } catch (e) { if (pairs.length === 1) throw e; skipped.push(pair + ' : ' + e.message); continue; }
          const base = settingsOf(Object.assign({}, m, { withdraw: undefined }), { pair: pair, startIndex: 0, timeframe: h.timeframe, broker: h.broker, symbol: h.symbol });
          delete base.startIndex;
          let r;
          try { r = await FC.minePair({ bars: h.bars, base: base, pair: pair, strats: strats, levs: levs, mechs: mechs, o: o, K: K, dataLabel: h.label, synthetic: !!h.synthetic, score: score, eras: eraStore.get().length ? eraStore.get() : undefined,
            config: { pair: pair, source: h.source, capital: o.budget, exposurePct: m.exposurePct || 100, spreadPips: base.spreadPips, estimateWicks: m.estimateWicks !== false, commission: m.commissionPerLot || 0, period: 'custom' } }); }
          catch (e) { if (pairs.length === 1) throw e; skipped.push(pair + ' : ' + e.message); continue; }
          synthetic = synthetic || !!h.synthetic; found.push(...r.found); screened += r.screened; created += r.created.length; done += r.done; combos += r.combos;
        }
        if (!found.length) fail('Aucune combinaison n\'a pu être testée. ' + skipped.join(' · '));
        const trialsAll = Math.max(1, combos + screened * levs.length * mechs.length), sel = FC.minerPick(found, o, trialsAll, score, 6);
        lastMine = sel;
        return { criteria: o, combinations: done, pairs: pairs.length, skipped: skipped, periods: K, strategiesCreated: created, variantsScreened: screened, trials: trialsAll, seconds: Math.round((Date.now() - t0) / 1000), synthetic: synthetic,
          matching: sel.found.filter((x) => x.ok).length,
          candidates: sel.pick.map((c, i) => Object.assign({ candidate: i + 1, ok: !!c.ok, missing: c.miss, createdStrategy: c.fx.strategy.data && c.fx.strategy.data.generated ? c.fx.strategy.data.description : undefined }, fxView(c.fx, o.budget))),
          hint: 'save_fx (candidate) pour garder un plan ; avant de conclure, refaire un run_batch de la stratégie retenue (plus de périodes, cours réels) puis time_analysis et build_fx.' };
      },
    },
    // ------------------------------------------------------------ affiner pas à pas
    {
      name: 'modify_strategy',
      description: 'Modifie une stratégie pas à pas, comme dans l\'éditeur de la page : ajouter un indicateur / une condition (ET ou OU) à une règle ou aux deux entrées, remplacer un réglage (ex. "RSI(14)" → "RSI(10)", "> 30" → "> 25"), retirer des conditions, régler la gestion des trades (stop, objectif, stop suiveur, break-even, durée max, pause), ne garder que les achats ou les ventes, adapter au style (scalping, court, moyen, long terme), renommer. Renvoie la stratégie validée, sa description en français et ses conditions ; save=true l\'enregistre.',
      inputSchema: obj({
        strategy: strategyArg,
        add: { type: 'array', items: { type: 'object', properties: { rule: { type: 'string', enum: ['longEntry', 'longExit', 'shortEntry', 'shortExit', 'entries', 'exits'], description: 'entries = les deux entrées, exits = les deux sorties' }, condition: { type: 'string', description: 'ex. ADX(14) > 25, CLOSE > EMA(200)' }, shortCondition: { type: 'string', description: 'avec entries / exits : condition miroir pour les ventes (sinon la même)' }, join: { type: 'string', enum: ['AND', 'OR'] } } } },
        replace: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, rule: { type: 'string' } } } },
        remove: { type: 'array', items: { type: 'object', properties: { match: { type: 'string' }, rule: { type: 'string' }, path: { type: 'string' } } } },
        set: { type: 'object', description: 'gestion des trades : stopLossPips, takeProfitPips, stopAtr, takeAtr, atrPeriod, trailPips, trailAtr, breakevenPips, breakevenAtr, maxBars, pauseLosses, pauseBars (0 = désactivé)' },
        only: { type: 'string', enum: ['long', 'short'] }, style: { type: 'string', enum: ['none', 'scalping', 'short', 'medium', 'long'] }, name: { type: 'string' }, save: { type: 'boolean' },
      }, ['strategy']),
      handler: async (a) => {
        let s = Object.assign({}, resolveStrategy(a.strategy));
        const before = strategyView(s), changes = [];
        for (const x of a.add || []) {
          if (!x.condition) continue;
          const err = F.rules.validate(x.condition); if (err) fail('Condition invalide « ' + x.condition + ' » : ' + err);
          const keys = x.rule === 'entries' ? ['longEntry', 'shortEntry'] : x.rule === 'exits' ? ['longExit', 'shortExit'] : [x.rule || 'longEntry'];
          for (const k of keys) {
            const c = k.startsWith('short') && x.shortCondition ? x.shortCondition : x.condition;
            if (k.endsWith('Entry') && !s[k]) continue;
            s[k] = x.join === 'OR' ? E.orWith(s[k], c) : s[k] ? E.andWith(s[k], c) : c;
            changes.push(k + ' ' + (x.join === 'OR' ? 'OU ' : 'ET ') + c);
          }
        }
        for (const x of a.replace || []) {
          let n = 0;
          for (const k of ['longEntry', 'longExit', 'shortEntry', 'shortExit']) if ((!x.rule || x.rule === k) && s[k] && s[k].includes(x.from)) { s[k] = s[k].split(x.from).join(x.to); n++; }
          if (!n) fail('« ' + x.from + ' » ne figure dans aucune règle.');
          changes.push('« ' + x.from + ' » → « ' + x.to + ' »');
        }
        if (a.remove && a.remove.length) { const r = await callTool('edit_conditions', { strategy: Object.assign({}, s, { saved: undefined, preset: undefined }), remove: a.remove }); s = Object.assign(s, resolveStrategy(r.strategy)); changes.push('conditions retirées : ' + a.remove.map((x) => x.match || x.path).join(', ')); }
        if (a.set) for (const [k, v] of Object.entries(a.set)) { if (!TM.concat(['stopLossPips', 'takeProfitPips']).includes(k)) fail('Réglage inconnu : ' + k); s[k] = Number(v) || 0; changes.push(k + ' = ' + s[k]); }
        if (a.only) { const y = A.applyProposal(s, {}, { change: a.only === 'long' ? { onlyLong: true } : { onlyShort: true } }); s = y.strat; changes.push(a.only === 'long' ? 'achats seulement' : 'ventes seulement'); }
        if (a.style) { s = E.adaptToStyle(s, a.style, { fromStyle: s.style }); changes.push('style ' + a.style); }
        if (a.name) s.name = a.name;
        const v = resolveStrategy(strategyView(s));
        const view = strategyView(v), cond = (await callTool('edit_conditions', { strategy: view })).conditions;
        if (a.save) await callTool('save_strategy', { strategy: view });
        return { strategy: view, before: before, changes: changes, conditions: cond, saved: !!a.save, hint: 'Tester : run_batch avec sameAs (mêmes périodes que le batch de référence) puis compare_batches.' };
      },
    },
    {
      name: 'vary_batch',
      description: 'Fait varier UN élément à partir d\'un batch de référence, sur les mêmes périodes : levier, capital (budget), durée en mois (mêmes dates de début), exposition, taille de position, spread, paire, stratégie, ou retrait. Crée un batch par valeur et renvoie la comparaison (période par période, époques, classement). Pour décider « quel levier / quel budget / quelle durée / quelle stratégie ».',
      inputSchema: obj({ id: { type: 'string', description: 'batch de référence' }, param: { type: 'string', enum: ['leverage', 'capital', 'months', 'exposurePct', 'riskPct', 'fixedLots', 'sizing', 'spreadPips', 'pair', 'strategy', 'withdraw', 'timeframe'] },
        values: { type: 'array', items: {}, description: 'valeurs à essayer (stratégies : objets stratégie ; retrait : mécaniques)' } }, ['id', 'param', 'values']),
      handler: async (a) => {
        const ref = getBatch(a.id), e0 = ref.entries[0], ids = [ref.id];
        for (const v of a.values) {
          const m = marketOfEntry(e0);
          let strat = Object.assign({}, e0.strategy, { name: e0.name }), periods = ref.entries.map((e) => ({ from: e.from, to: e.to })), label;
          if (a.param === 'strategy') { strat = resolveStrategy(v); label = strat.name; }
          else if (a.param === 'months') { periods = ref.entries.map((e) => ({ from: e.from, to: iso(new Date(D.addMonths(new Date(e.from + 'T00:00:00Z'), Number(v)).getTime() - 864e5)) })); label = v + ' mois'; }
          else if (a.param === 'withdraw') { const w = normW(v); m.withdraw = w ? (w.mode === 'periodic' ? { mode: 'periodic', every: w.every, days: w.days, type: w.type, value: w.value } : { pct: w.pct, share: w.share, when: w.when }) : undefined; label = w ? wName(v, w) : 'sans retrait'; }
          else { m[a.param] = typeof v === 'string' && a.param !== 'pair' && a.param !== 'sizing' && a.param !== 'timeframe' ? Number(v) : v; label = a.param + ' ' + v; }
          const r = await runBatch({ strategy: strat, market: m, periods: periods, name: ref.name + ' · ' + label });
          const l = batches.get(), nb = l.find((x) => x.id === r.batch.id); nb.periodsOf = ref.id; nb.variedFrom = { batch: ref.id, param: a.param, value: v }; batches.set(l);
          ids.push(r.batch.id);
        }
        return Object.assign({ param: a.param, reference: ref.name }, compareBatches(ids.map(getBatch)));
      },
    },
    {
      name: 'improve_batch',
      description: '« Améliorer » sur tout un batch (comme la sélection de simulations dans l\'évaluation) : cherche les améliorations (réglages, filtres, stops, sorties, jours / heures…) communes aux simulations perdantes et celles à fort impact sur toutes ; avec apply (ids), crée le batch amélioré sur les mêmes périodes et le compare au batch d\'origine.',
      inputSchema: obj({ id: { type: 'string' }, apply: { type: 'array', items: { type: 'string' } }, indexes: idx }, ['id']),
      handler: async (a) => {
        const b = getBatch(a.id), L = pickEntries(b, a.indexes), e0 = L[0], m = marketOfEntry(e0);
        const strat = Object.assign(strategyView(Object.assign({}, e0.strategy, { name: e0.name })), {});
        const r = await callTool('improve_across_periods', { strategy: strat, market: m, periods: L.map((e) => ({ dateFrom: e.from, dateTo: e.to })), apply: a.apply });
        if (a.apply && a.apply.length && r.improvedStrategy) {
          const nb = await runBatch({ strategy: r.improvedStrategy, market: m, periods: L.map((e) => ({ from: e.from, to: e.to })), name: b.name + ' · améliorée' });
          const l = batches.get(), x = l.find((y) => y.id === nb.batch.id); x.periodsOf = b.id; batches.set(l);
          r.newBatch = batchHead(x);
          r.comparison = compareBatches([b, x]).headToHead[0] || null;
        }
        return r;
      },
    },
    {
      name: 'subset_batch',
      description: 'Crée un batch à partir d\'une partie d\'un autre (index, époque, années, rendement mini / maxi) : pour étudier séparément les périodes perdantes, une époque, etc.',
      inputSchema: obj(Object.assign({ id: { type: 'string' }, indexes: idx, name: { type: 'string' } }, FILT), ['id']),
      handler: async (a) => {
        const b = getBatch(a.id), L = pickEntries(b, a.indexes, a);
        const nb = { id: uid(''), at: new Date().toISOString(), by: 'agent', periodsOf: b.id, entries: L.map((e) => Object.assign({}, e)), name: a.name || b.name + ' · extrait (' + L.length + ')' };
        const l = batches.get(); l.push(nb); batches.set(l);
        return batchHead(nb);
      },
    },
    {
      name: 'import_ea',
      description: 'Relit un Expert Advisor généré par Forexia (.mq5, comme « Importer un EA Forexia » dans la page) : retrouve la stratégie et ses réglages. save=true enregistre la stratégie.',
      inputSchema: obj({ path: { type: 'string' }, code: { type: 'string' }, save: { type: 'boolean' } }),
      handler: async (a) => {
        const code = a.code || (a.path ? require('fs').readFileSync(a.path, 'utf8') : fail('Indiquez path ou code.'));
        const r = F.mql5.parseEA(code) || fail('Ce fichier n\'est pas un EA généré par Forexia.');
        const st = strategyView(resolveStrategy(Object.assign({}, r.strategy || r, { name: (r.strategy || r).name || 'EA importé' })));
        if (a.save) await callTool('save_strategy', { strategy: st });
        return { strategy: st, settings: r.config || r.settings || null, saved: !!a.save };
      },
    },
    // ------------------------------------------------------------ carnet de déductions
    {
      name: 'note_add', description: 'Carnet de l\'agent : note une déduction (ce qui marche, ce qui ne marche pas, sur quelle base) pour s\'en servir dans les itérations suivantes.',
      inputSchema: obj({ text: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, refs: { type: 'array', items: { type: 'string' }, description: 'ids de batchs / FX' } }, ['text']),
      handler: async (a) => { const l = notes.get(), n = { id: uid('n'), at: new Date().toISOString(), text: a.text, tags: a.tags || [], refs: a.refs || [] }; l.push(n); notes.set(l.slice(-2000)); return n; },
    },
    {
      name: 'note_list', description: 'Relit le carnet de déductions (filtre par mot ou étiquette).', inputSchema: obj({ query: { type: 'string' }, tag: { type: 'string' }, last: { type: 'number' } }),
      handler: async (a) => notes.get().filter((n) => (!a.tag || n.tags.includes(a.tag)) && (!a.query || n.text.toLowerCase().includes(String(a.query).toLowerCase()))).slice(-(a.last || 50)),
    },
    // ------------------------------------------------------------ page Forexia
    {
      name: 'forexia_sync',
      description: 'Échange avec la page Forexia via la base de la passerelle MT5 (FOREXIA_BRIDGE_TOKEN) : pull = récupère les stratégies, FX, batchs, époques, mécaniques de retrait et événements de l\'utilisateur ; push = y envoie ceux de l\'agent (ils apparaissent dans la page) ; both (défaut) = les deux, en réunissant les listes.',
      inputSchema: obj({ direction: { type: 'string', enum: ['pull', 'push', 'both'] } }),
      handler: async (a) => {
        const dir = a.direction || 'both', r = await bridge('POST', '/db/kv/list', {});
        if (r.ok === false) fail(r.message || 'Base de la passerelle indisponible (version 1.6 requise).');
        const remote = new Map((r.items || []).map((x) => [x.key, x])), out = {};
        for (const [k, st] of Object.entries(SYNC)) {
          const rv = remote.get(k), rd = rv ? rv.data : null, local = st.get();
          let merged;
          if (k === 'forexia.events') merged = { items: union(rd && rd.items, local.items), edits: Object.assign({}, rd && rd.edits, local.edits), scanned: Object.assign({}, rd && rd.scanned, local.scanned) };
          else merged = union(dir === 'push' ? [] : rd, local);
          if (k === 'forexia.agentGuide') merged = rd && (dir !== 'push' || !local.updatedAt || (rd.updatedAt || '') >= local.updatedAt) ? rd : local; // le choix fait dans la page prime
          if (k === 'forexia.eras' && dir !== 'push' && Array.isArray(rd) && rd.length) merged = rd; // les époques de l'utilisateur priment
          if (dir !== 'push') st.set(merged);
          if (dir !== 'pull') {
            const send = dir === 'push' && Array.isArray(merged) ? union(rd, merged) : merged;
            if (JSON.stringify(send) !== JSON.stringify(rd)) { const p = await bridge('POST', '/db/kv/put', { key: k, data: send, updatedAt: new Date().toISOString() }); if (p.ok === false) fail(p.message || 'Écriture refusée.'); }
          }
          out[k.replace('forexia.', '')] = k === 'forexia.agentGuide' ? (merged.active || 'free') : Array.isArray(merged) ? merged.length : (merged.items || []).length;
        }
        // stratégies (table « strategies » de la base) : la plus récente l'emporte, nom par nom
        const rs = await bridge('POST', '/db/strategies/list', {}), remoteS = new Map(((rs && rs.items) || []).map((x) => [x.name, x])), localS = store.strategies();
        let pulled = 0, pushed = 0;
        if (dir !== 'push') for (const [name, x] of remoteS) { const i = localS.findIndex((y) => y.name === name); if (i < 0 || (x.data.savedAt || x.updatedAt || '') > (localS[i].savedAt || '')) { const d = Object.assign({}, x.data); if (i < 0) localS.push(d); else localS[i] = d; pulled++; } }
        if (dir !== 'push') store.setStrategies(localS);
        if (dir !== 'pull') for (const l of localS) { const r = remoteS.get(l.name); if (!r || (l.savedAt || '') > (r.data.savedAt || r.updatedAt || '')) { const d = Object.assign({}, l, { savedAt: l.savedAt || new Date().toISOString() }); if (d.config && !d.config.withdraw) delete d.config; await bridge('POST', '/db/strategies/put', { name: d.name, data: d, updatedAt: d.savedAt }); pushed++; } }
        out.strategies = { pulled: pulled, pushed: pushed, total: localS.length };
        return { direction: dir, counts: out, note: 'La page reprend ces données à sa prochaine connexion à la passerelle (ou en rechargeant la page).' };
      },
    },
  ];
};
