/* Test du serveur MCP Forexia (transport stdio, données simulées) : node tests/mcp-check.js */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forexia-mcp-'));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'forexia-mcp.js')], { env: Object.assign({}, process.env, { FOREXIA_MCP_DATA: dataDir }), stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '', id = 0;
const waiting = new Map();
srv.stdout.on('data', (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1); const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m); } }
});
const rpc = (method, params) => new Promise((res) => { const i = ++id; waiting.set(i, res); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method: method, params: params }) + '\n'); });
const call = async (name, args) => { const r = await rpc('tools/call', { name: name, arguments: args }); if (r.result.isError) throw new Error(name + ' : ' + r.result.content[0].text); return JSON.parse(r.result.content[0].text); };

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('  ÉCHEC ' + name + '\n       ' + e.message); } }
const ok = (c, m) => { if (!c) throw new Error(m || 'condition fausse'); };
const SYN = { pair: 'EUR/USD', source: 'synthetic', dateFrom: '2019-01-01', dateTo: '2020-12-31', capital: 10000, leverage: 10 };

(async () => {
  console.log('Serveur MCP Forexia');
  await test('initialize + tools/list', async () => {
    const i = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    ok(i.result.serverInfo.name === 'forexia' && i.result.capabilities.tools, JSON.stringify(i));
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const l = await rpc('tools/list', {});
    const names = l.result.tools.map((t) => t.name);
    for (const n of ['forexia_help', 'run_backtest', 'random_batch', 'enhance_strategy', 'apply_improvements', 'recommend', 'generate_ea', 'save_strategy']) ok(names.includes(n), 'outil absent : ' + n);
  });
  await test('forexia_help et list_presets', async () => {
    const h = await call('forexia_help', {}); ok(h.ruleFunctions.includes('ADX') && h.pairs.includes('EUR/USD'));
    const p = await call('list_presets', {}); ok(p.length >= 9 && p[0].longEntry);
  });
  await test('translate_french', async () => {
    const t = await call('translate_french', { text: 'Acheter quand le RSI 14 passe au-dessus de 30. Vendre dans le cas inverse. Stop loss 50 pips.' });
    ok(t.longEntry === 'CROSS_UP(RSI(14), 30)' && t.stopLossPips === 50, JSON.stringify(t));
  });
  let bt;
  await test('run_backtest (modèle, règles, français)', async () => {
    bt = await call('run_backtest', { strategy: { preset: 'macd' }, market: SYN, includeTrades: true, maxTrades: 5 });
    ok(bt.stats.trades > 0 && Number.isFinite(bt.stats.returnPct) && Object.keys(bt.monthlyReturnsPct).length >= 20 && bt.trades.length === 5, JSON.stringify(bt.stats));
    const fr = await call('run_backtest', { strategy: { frenchText: 'Acheter quand le RSI 14 passe au-dessus de 30. Vendre dans le cas inverse.', name: 'RSI fr' }, market: SYN });
    ok(fr.stats.trades > 0);
    const bad = await rpc('tools/call', { name: 'run_backtest', arguments: { strategy: { longEntry: 'RSI(14 > 30' }, market: SYN } });
    ok(bad.result.isError && /invalide/.test(bad.result.content[0].text), JSON.stringify(bad.result));
  });
  await test('mêmes résultats que le moteur du site', async () => {
    for (const f of ['indicators', 'expr', 'trade', 'backtest', 'data', 'presets']) require(path.join(__dirname, '..', 'js', f + '.js'));
    const Fx = globalThis.Forexia, r = Fx.data.customRange('2019-01-01', '2020-12-31'), bars = Fx.data.generateSynthetic('EUR/USD', r.fetchStart, r.end);
    const res = Fx.backtest.runBacktest(bars, Fx.presets.list.find((x) => x.id === 'macd'), { capital: 10000, leverage: 10, exposurePct: 100, spreadPips: 1, pair: 'EUR/USD', startIndex: Fx.data.indexFrom(bars, r.start), sizing: 'backtest' });
    ok(Math.abs(Math.round(res.stats.returnPct * 100) / 100 - bt.stats.returnPct) < 1e-9, res.stats.returnPct + ' vs ' + bt.stats.returnPct);
  });
  await test('random_batch (durée fixe 6 mois)', async () => {
    const r = await call('random_batch', { strategy: { preset: 'macd' }, market: { pair: 'EUR/USD', source: 'synthetic' }, n: 6, duration: { kind: 'exact', months: 6 } });
    ok(r.runs.length === 6 && r.runs.every((x) => x.months === 6) && r.summary.n === 6, JSON.stringify(r.summary));
  });
  let sugg;
  await test('enhance_strategy + apply_improvements', async () => {
    sugg = await call('enhance_strategy', { strategy: { preset: 'macd' }, market: SYN });
    ok(sugg.suggestions.length > 0 && sugg.suggestions[0].id, JSON.stringify(sugg).slice(0, 200));
    const ids = sugg.suggestions.filter((x) => x.group !== 'Combinaison recommandée').slice(0, 1).map((x) => x.id);
    const a = await call('apply_improvements', { strategy: { preset: 'macd' }, market: SYN, ids: ids, customText: 'Stop suiveur 2 ATR', name: 'MACD v2' });
    ok(a.after && a.strategy.name === 'MACD v2' && a.strategy.trailAtr === 2 && a.applied.length === 2, JSON.stringify(a).slice(0, 300));
  });
  await test('test_other_pairs', async () => {
    const r = await call('test_other_pairs', { strategy: { preset: 'macd' }, market: SYN, pairs: ['EUR/USD', 'GBP/USD', 'USD/JPY'] });
    ok(r.runs.length === 3 && r.tested === 3);
  });
  await test('stratégies enregistrées', async () => {
    await call('save_strategy', { strategy: { preset: 'rsi', name: 'Agent RSI', stopLossPips: 40 }, market: { pair: 'GBP/USD' }, notes: 'test' });
    const l = await call('list_strategies', {}); ok(l.length === 1 && l[0].name === 'Agent RSI' && l[0].stopLossPips === 40);
    const b = await call('run_backtest', { strategy: { saved: 'Agent RSI' }, market: SYN }); ok(b.strategy.name === 'Agent RSI');
    ok((await call('delete_strategy', { name: 'Agent RSI' })).deleted === 1);
  });
  await test('recommend + list_evaluations + clear_evaluations', async () => {
    const r = await call('recommend', {}); ok(r.simulations >= 8 && r.recommendations.some((x) => x.topic === 'Meilleure stratégie'), JSON.stringify(r).slice(0, 300));
    const l = await call('list_evaluations', { limit: 3 }); ok(l.length === 3);
    const c = await call('clear_evaluations', {}); ok(c.removed >= 8 && c.remaining === 0);
  });
  await test('generate_ea (code et fichier)', async () => {
    const e = await call('generate_ea', { strategy: { preset: 'supertrend' }, pair: 'EUR/USD', timeframe: 'H1', outputPath: dataDir });
    ok(fs.existsSync(e.writtenTo) && /FxSignals/.test(fs.readFileSync(e.writtenTo, 'utf8')) && !e.code);
  });
  await test('get_market_data, find_levels, make_trend_line', async () => {
    const d = await call('get_market_data', { market: SYN, indicators: ['EMA(50)', 'RSI(14)'], last: 30 });
    ok(d.rows.length === 30 && d.rows[29]['RSI(14)'] > 0 && d.rows[0].t > 0, JSON.stringify(d.rows[0]));
    const w = await call('get_market_data', { market: SYN, timeframe: 'W1', last: 10 }); ok(w.rows.length === 10 && w.timeframe === 'W1');
    const l = await call('find_levels', { market: SYN });
    ok(Array.isArray(l.supportsResistances) && Array.isArray(l.trendLines), JSON.stringify(l).slice(0, 200));
    const tl = await call('make_trend_line', { date1: '2020-03-02', price1: 1.08, date2: '2020-01-02', price2: 1.1 });
    ok(/^LINE\(1577923200, 1.1, 1583107200, 1.08\)$/.test(tl.expression), tl.expression);
    const b = await call('run_backtest', { strategy: { preset: 'macd', longEntry: 'CROSS_UP(MACD(12,26,9), MACD_SIGNAL(12,26,9)) AND CLOSE > ' + tl.expression }, market: SYN, record: false });
    ok(b.stats.trades >= 0 && !b.evaluationKey);
  });
  await test('edit_conditions (retirer une ligne de tendance)', async () => {
    const L = 'LINE(1577923200, 1.1, 1583107200, 1.08)';
    const st = { name: 'x', longEntry: '(CROSS_UP(CLOSE, SMA(200)) AND MACD_HIST(12,26,9) > 0 OR LOW <= ' + L + ' AND CLOSE > ' + L + ') AND ADX(14) < 20', shortEntry: 'CROSS_DOWN(CLOSE, SMA(200))' };
    const l = await call('edit_conditions', { strategy: st }); ok(l.conditions.longEntry.length === 5, JSON.stringify(l.conditions));
    const r = await call('edit_conditions', { strategy: st, remove: [{ match: 'LINE(' }] });
    ok(r.strategy.longEntry === 'CROSS_UP(CLOSE, SMA(200)) AND MACD_HIST(12,26,9) > 0 AND ADX(14) < 20', r.strategy.longEntry);
    const one = await call('edit_conditions', { strategy: st, remove: [{ rule: 'longEntry', path: '1' }] });
    const L2 = L.replace(/ /g, '');
    ok(one.strategy.longEntry === '(CROSS_UP(CLOSE, SMA(200)) AND MACD_HIST(12,26,9) > 0) OR (LOW <= ' + L2 + ' AND CLOSE > ' + L2 + ')', one.strategy.longEntry);
  });
  await test('stress_test (prolonger, raccourcir, découper, capital)', async () => {
    const r = await call('stress_test', { strategy: { preset: 'macd' }, market: SYN, extendMonths: 6, shortenMonths: 6, splitMonths: 6, capitals: [1000, 50000] });
    ok(r.original.returnPct !== undefined && /^2021-0[67]/.test(r.extended.to) && /^2020-0[67]/.test(r.shortened.to) && r.slices.length === 4 && r.capitals.length === 2, JSON.stringify(r).slice(0, 300));
  });
  await test('improve_across_periods (+ apply)', async () => {
    const r = await call('improve_across_periods', { strategy: { preset: 'macd' }, market: { pair: 'EUR/USD', source: 'synthetic' }, randomN: 5, duration: { kind: 'exact', months: 12 } });
    ok(r.periods.length === 5 && Array.isArray(r.highImpact), JSON.stringify(r).slice(0, 200));
    const pick = (r.highImpact[0] || r.commonToLosers[0]);
    if (pick) {
      const a = await call('improve_across_periods', { strategy: { preset: 'macd' }, market: { pair: 'EUR/USD', source: 'synthetic' }, periods: r.periods.map((p) => ({ dateFrom: p.from, dateTo: p.to })), apply: [pick.id] });
      ok(a.after.length === 5 && a.improvedStrategy, JSON.stringify(a).slice(0, 200));
    }
  });
  await test('ligne de commande (mcp/cli.js)', async () => {
    const { execFileSync } = require('child_process');
    const out = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '..', 'mcp', 'cli.js'), 'run_backtest', JSON.stringify({ strategy: { preset: 'rsi' }, market: SYN, record: false })], { env: Object.assign({}, process.env, { FOREXIA_MCP_DATA: dataDir }) }).toString());
    ok(out.stats.trades > 0);
  });
  // ---------------- démarche FX (batchs, époques, analyseurs, retraits, FX, chercheur)
  const MK = { pair: 'EUR/USD', source: 'synthetic', capital: 10000, leverage: 10 };
  let B1, B2, B3, FXID;
  await test('fx_method', async () => { const m = await call('fx_method', {}); ok(m.steps.length >= 8 && m.tools.includes('run_batch')); });
  await test('run_batch : 16 périodes de 9 mois, plage 2005–2020, reproductible', async () => {
    const r = await call('run_batch', { strategy: { preset: 'ma' }, market: MK, n: 16, months: 9, yearFrom: 2005, yearTo: 2020, seed: 7 });
    B1 = r.batch.id;
    ok(r.simulations.length === 16 && r.simulations.every((s) => s.months === 9 && s.from >= '2005' && s.to <= '2020-12-31'), JSON.stringify(r.simulations.slice(0, 2)));
    ok(r.batch.stats.n === 16 && Number.isFinite(r.batch.stats.medianReturnPct));
    const again = await call('run_batch', { strategy: { preset: 'ma' }, market: MK, n: 16, months: 9, yearFrom: 2005, yearTo: 2020, seed: 7, name: 'copie' });
    ok(again.simulations.map((s) => s.from).join() === r.simulations.map((s) => s.from).join(), 'même graine, mêmes périodes');
  });
  await test('run_batch sameAs (levier 20) + compare_batches période par période', async () => {
    const r = await call('run_batch', { strategy: { preset: 'ma' }, market: Object.assign({}, MK, { leverage: 20 }), sameAs: B1 });
    B2 = r.batch.id;
    ok(r.batch.periodsOf === B1 && r.simulations.length === 16);
    const c = await call('compare_batches', { ids: [B1, B2] });
    ok(c.batches.length === 2 && c.headToHead.length === 1 && c.headToHead[0].samePeriods === 16 && c.ranking.length === 2, JSON.stringify(c.headToHead));
  });
  await test('list_batches / get_batch / rename_batch', async () => {
    const l = await call('list_batches', {}); ok(l.length === 3);
    const g = await call('get_batch', { id: B1 }); ok(g.simulations.length === 16 && g.strategy.longEntry && g.market.source === 'synthetic');
    const n = await call('rename_batch', { id: B1, name: 'MA levier 10', note: 'référence' }); ok(n.name === 'MA levier 10' && n.note === 'référence');
  });
  await test('time_analysis + set_eras / get_eras', async () => {
    const t = await call('time_analysis', { id: B1 });
    ok(t.byYear.length >= 5 && t.byEra.length >= 2 && t.verdict.length && !/<b>/.test(t.verdict.join(' ')), JSON.stringify(t).slice(0, 300));
    ok(t.byEra.some((e) => e.events.length), 'événements par époque');
    await call('set_eras', { eras: [{ name: 'Avant crise', from: '', to: '2008-08-31' }, { name: 'Crise et après', from: '2008-09-01', to: '2014-12-31' }, { name: 'Récent', from: '2015-01-01', to: '' }] });
    const g = await call('get_eras', {}); ok(g.custom && g.eras.length === 3 && g.eras[0].name === 'Avant crise');
    const t2 = await call('time_analysis', { ids: [B1, B2] }); ok(t2.n === 32 && t2.byEra.map((e) => e.era).join() === 'Avant crise,Crise et après,Récent', t2.byEra.map((e) => e.era).join());
  });
  await test('market_events (+ détection)', async () => {
    const e = await call('market_events', { pair: 'EUR/USD', from: '2008-01-01', to: '2009-12-31', minImportance: 3 });
    ok(e.events.some((x) => /Lehman/i.test(x.title)), JSON.stringify(e.events.map((x) => x.title)));
    const d = await call('market_events', { pair: 'EUR/USD', source: 'synthetic', detect: true }); ok(Array.isArray(d.detected));
  });
  await test('analyze_simulation + apply_proposal sur tout le batch', async () => {
    const g = await call('get_batch', { id: B1 }), worst = g.simulations.slice().sort((a, b) => a.returnPct - b.returnPct)[0].index;
    const a = await call('analyze_simulation', { id: B1, index: worst });
    ok(a.verdict && a.sections.length && Array.isArray(a.proposals), JSON.stringify(a).slice(0, 300));
    const r = await call('apply_proposal', { id: B1, index: worst, proposal: 'ema200', scope: 'batch', saveAsBatch: true });
    ok(r.simulations.length === 16 && r.summary.n === 16 && r.newBatch && r.newBatch.periodsOf === B1 && /EMA\(200\)/.test(r.strategyAfter.longEntry), JSON.stringify(r.summary));
    B3 = r.newBatch.id;
  });
  await test('era_analysis', async () => {
    const r = await call('era_analysis', { id: B1, maxPerEra: 4 });
    ok(r.eras.length >= 2 && r.market.length >= 6 && r.fixes.length >= 5 && r.fixes[0].perEra.length === r.eras.length, JSON.stringify(r).slice(0, 300));
  });
  await test('simulate_withdrawal + compare_withdrawals + save_withdraw_mechanic', async () => {
    const s = await call('simulate_withdrawal', { id: B1, mechanic: { mode: 'periodic', every: 'month', type: 'excess', value: 50 } });
    ok(s.simulations.length === 16 && s.overall.withdrawnPerMonthEur >= 0 && s.desc.includes('excédent'), JSON.stringify(s.overall));
    const c = await call('compare_withdrawals', { id: B1 });
    ok(c.ranking.length >= 7 && c.best && c.ranking[0].score >= c.ranking[c.ranking.length - 1].score, JSON.stringify(c.ranking.map((x) => x.mechanic)));
    const p = await call('save_withdraw_mechanic', { name: 'Excédent 50', mechanic: { mode: 'periodic', type: 'excess', value: 50 } });
    ok(p.id && (await call('list_withdraw_mechanics', {})).length === 1);
  });
  await test('build_fx (mécanique enregistrée, capital 25 000) + fx_projection + list / get / rename / delete', async () => {
    const f = await call('build_fx', { id: B1, mechanic: 'Excédent 50', capital: 25000, save: true });
    FXID = f.id;
    ok(f.saved && f.capital === 25000 && f.recommendedMonths >= 1 && f.confidence.score >= 0 && f.scenarios.length === 7 && f.income.method === 'Excédent 50', JSON.stringify(f).slice(0, 400));
    ok(f.backAtEndEur.usual > 0 && f.backAtEndEur.worst <= f.backAtEndEur.good && /simul/.test(f.solidity));
    const p = await call('fx_projection', { id: FXID, capital: 50000, q: 0.9 }); ok(p.capital === 50000 && p.q === 0.9 && Number.isFinite(p.backEur));
    const low = await call('fx_projection', { id: FXID, capital: 100 }); ok(low.capital === 10000 && low.note, 'capital minimum');
    const l = await call('list_fx', {}); ok(l.length === 1 && l[0].by === 'agent');
    const g = await call('get_fx', { id: FXID }); ok(g.strategyRules && g.strategyRules.longEntry && g.withdrawMechanic.type === 'excess');
    ok((await call('rename_fx', { id: FXID, name: 'Plan prudent' })).name === 'Plan prudent');
    const nf = await call('build_fx', { id: B3, mechanic: 'none' }); ok(!nf.saved && nf.income.desc === 'sans retrait');
  });
  await test('mine_fx (rapide, synthétique) + save_fx avec la stratégie créée', async () => {
    const r = await call('mine_fx', { budget: 5000, maxRisk: 5, minConf: 30, months: 9, maxLev: 20, pair: 'GBP/USD', source: 'synthetic', effort: 'fast' });
    ok(r.combinations > 100 && r.candidates.length >= 1 && r.trials > r.combinations && r.candidates[0].pair === 'GBP/USD', JSON.stringify(r).slice(0, 300));
    const gen = r.candidates.findIndex((c) => c.createdStrategy) + 1 || 1;
    const s = await call('save_fx', { candidate: gen, saveStrategy: true });
    ok(s.saved.id && (await call('list_fx', {})).length === 2);
    if (r.candidates[gen - 1].createdStrategy) ok(s.strategySaved && (await call('list_strategies', {})).some((x) => x.name === s.strategySaved));
  });
  await test('modify_strategy : ajout progressif, réglage, gestion, style, sauvegarde', async () => {
    const r = await call('modify_strategy', { strategy: { preset: 'rsi' }, add: [{ rule: 'entries', condition: 'CLOSE > EMA(200)', shortCondition: 'CLOSE < EMA(200)' }, { rule: 'longEntry', condition: 'ADX(14) < 30' }],
      replace: [{ from: 'RSI(14)', to: 'RSI(10)' }], set: { stopAtr: 2, atrPeriod: 14, trailAtr: 3 }, name: 'RSI affiné', save: true });
    ok(/EMA\(200\)/.test(r.strategy.longEntry) && /CLOSE < EMA\(200\)/.test(r.strategy.shortEntry) && /ADX\(14\) < 30/.test(r.strategy.longEntry) && /RSI\(10\)/.test(r.strategy.longEntry) && !/RSI\(14\)/.test(r.strategy.longEntry), JSON.stringify(r.strategy));
    ok(r.strategy.stopAtr === 2 && r.strategy.trailAtr === 3 && r.changes.length >= 5 && r.conditions.longEntry.length >= 3 && r.saved);
    const r2 = await call('modify_strategy', { strategy: { saved: 'RSI affiné' }, remove: [{ match: 'ADX' }], only: 'long', style: 'long', name: 'RSI long terme' });
    ok(!/ADX/.test(r2.strategy.longEntry) && !r2.strategy.shortEntry && r2.strategy.stopLossPips > 0, JSON.stringify(r2.strategy));
    const bad = await rpc('tools/call', { name: 'modify_strategy', arguments: { strategy: { preset: 'rsi' }, add: [{ rule: 'longEntry', condition: 'FOO(3) >' }] } });
    ok(bad.result.isError && /invalide/.test(bad.result.content[0].text));
  });
  await test('vary_batch : levier, budget, durée, stratégie sur les mêmes périodes', async () => {
    const ref = await call('run_batch', { strategy: { preset: 'macd' }, market: MK, n: 10, months: 12, seed: 3 });
    const v = await call('vary_batch', { id: ref.batch.id, param: 'leverage', values: [5, 20] });
    ok(v.batches.length === 3 && v.headToHead.length === 3 && v.headToHead.every((h) => h.samePeriods === 10) && v.ranking.length === 3, JSON.stringify(v.headToHead));
    const c = await call('vary_batch', { id: ref.batch.id, param: 'capital', values: [25000] }); ok(c.batches[1].stats.avgStartCapital === 25000);
    const d = await call('vary_batch', { id: ref.batch.id, param: 'months', values: [6] }); ok(d.batches[1].stats.monthsMax === 6 && d.batches[1].stats.from === d.batches[0].stats.from);
    const s = await call('vary_batch', { id: ref.batch.id, param: 'strategy', values: [{ saved: 'RSI affiné' }] }); ok(s.batches[1].stats.strategies[0] === 'RSI affiné');
    const w = await call('vary_batch', { id: ref.batch.id, param: 'withdraw', values: [{ mode: 'periodic', type: 'excess', value: 50 }] }); ok(w.batches[1].stats.totalWithdrawn >= 0);
  });
  await test('improve_batch (+ apply → batch amélioré comparé)', async () => {
    const r = await call('improve_batch', { id: B1 });
    ok(r.periods.length === 16 && Array.isArray(r.highImpact), JSON.stringify(r).slice(0, 200));
    const pick = r.highImpact[0] || r.commonToLosers[0];
    if (pick) { const a = await call('improve_batch', { id: B1, apply: [pick.id] }); ok(a.newBatch && a.newBatch.periodsOf === B1 && a.comparison && a.comparison.samePeriods === 16, JSON.stringify(a.comparison)); }
  });
  await test('apply_proposal : plusieurs corrections combinées', async () => {
    const r = await call('apply_proposal', { id: B1, proposals: ['ema200', 'trail'], scope: 'batch' });
    ok(r.summary.n === 16 && /EMA\(200\)/.test(r.strategyAfter.longEntry) && r.strategyAfter.trailAtr === 2, JSON.stringify(r.strategyAfter));
  });
  await test('subset_batch + retraits par époque', async () => {
    const s = await call('subset_batch', { id: B1, era: 'Récent' }); ok(s.stats.n >= 1 && s.stats.from >= '2014');
    const w = await call('simulate_withdrawal', { id: B1, mechanic: { mode: 'periodic', type: 'fixed', value: 50 }, era: 'Avant crise' });
    ok(w.byEra.length === 1 && w.byEra[0].era === 'Avant crise', JSON.stringify(w.byEra));
    const c = await call('compare_withdrawals', { id: B1, byEra: true, mechanics: [{ mode: 'periodic', type: 'excess', value: 25 }, { mode: 'periodic', type: 'fixed', value: 100 }, 'none'] });
    ok(c.byEra.length >= 2 && c.byEra[0].ranking.length === 3 && c.byEra[0].best, JSON.stringify(c.byEra[0]));
  });
  await test('import_ea (EA généré puis relu)', async () => {
    const g = await call('generate_ea', { strategy: { saved: 'RSI affiné' }, pair: 'EUR/USD' });
    const r = await call('import_ea', { code: g.code, save: false });
    ok(r.strategy.name === 'RSI affiné' && /RSI\(10\)/.test(r.strategy.longEntry), JSON.stringify(r.strategy));
  });
  await test('market_events : événement ajouté par l\'agent', async () => {
    const r = await call('market_events', { pair: 'EUR/USD', add: { date: '2016-06-24', title: 'Test agent', importance: 3 }, from: '2016-06-01', to: '2016-06-30' });
    ok(r.added && r.events.some((e) => e.title === 'Test agent'));
  });
  await test('note_add / note_list', async () => {
    await call('note_add', { text: 'Levier 20 : plus de pertes que levier 10 sur les mêmes périodes', tags: ['levier'], refs: [B1, B2] });
    await call('note_add', { text: 'Le filtre EMA 200 aide surtout avant 2008', tags: ['époques'] });
    ok((await call('note_list', { tag: 'levier' })).length === 1 && (await call('note_list', { query: 'ema' })).length === 1);
  });
  await test('delete_fx / delete_batch', async () => {
    ok((await call('delete_fx', { id: FXID })).deleted === 'Plan prudent');
    const nb = (await call('list_batches', {})).length; await call('delete_batch', { id: B3 }); ok((await call('list_batches', {})).length === nb - 1);
  });
  await test('forexia_sync sans passerelle : message clair', async () => {
    const r = await rpc('tools/call', { name: 'forexia_sync', arguments: {} });
    ok(r.result.isError && /FOREXIA_BRIDGE_TOKEN/.test(r.result.content[0].text));
  });
  await test('outils MT5 sans passerelle : message clair', async () => {
    const r = await rpc('tools/call', { name: 'mt5_status', arguments: {} });
    ok(r.result.isError && /FOREXIA_BRIDGE_TOKEN/.test(r.result.content[0].text));
  });
  srv.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log('\n' + passed + ' réussis, ' + failed + ' échoués');
  process.exit(failed ? 1 : 0);
})();
