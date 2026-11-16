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
  await test('outils MT5 sans passerelle : message clair', async () => {
    const r = await rpc('tools/call', { name: 'mt5_status', arguments: {} });
    ok(r.result.isError && /FOREXIA_BRIDGE_TOKEN/.test(r.result.content[0].text));
  });
  srv.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log('\n' + passed + ' réussis, ' + failed + ' échoués');
  process.exit(failed ? 1 : 0);
})();
