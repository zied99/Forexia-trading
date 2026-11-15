/* Tests du moteur : node tests/run-tests.js */
'use strict';
const path = require('path');
for (const f of ['indicators', 'expr', 'backtest', 'data', 'presets']) require(path.join(__dirname, '..', 'js', f + '.js'));
const { indicators: I, rules: R, backtest: B, data: D, presets: P } = globalThis.Forexia;

let failed = 0, passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  ÉCHEC ' + name + '\n       ' + e.message); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ' attendu ' + b + ', obtenu ' + a); }
function near(a, b, tol, msg) { if (!(Math.abs(a - b) <= tol)) throw new Error((msg || '') + ' attendu ≈' + b + ', obtenu ' + a); }
function bar(date, c, o) { o = o ?? c; return { date, open: o, high: Math.max(o, c), low: Math.min(o, c), close: c }; }
function series(closes) { return closes.map((c, i) => bar('2024-01-' + String(i + 1).padStart(2, '0'), c, i ? closes[i - 1] : c)); }

console.log('Indicateurs');
test('SMA', () => { const s = I.sma([1, 2, 3, 4, 5], 3); eq(Number.isNaN(s[1]), true); eq(s[2], 2); eq(s[4], 4); });
test('EMA amorcée par la SMA', () => { const e = I.ema([1, 2, 3, 4, 5], 3); eq(e[2], 2); eq(e[3], 3); eq(e[4], 4); });
test('RSI de Wilder (référence classique)', () => {
  const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
  const r = I.rsi(c, 14);
  near(r[14], 70.46, 0.05, 'RSI[14]');
  near(r[15], 66.25, 0.05, 'RSI[15]');
});
test('RSI = 100 en hausse continue', () => { const r = I.rsi([1, 2, 3, 4, 5, 6], 3); eq(r[5], 100); });
test('MACD = EMA rapide − EMA lente', () => {
  const c = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 3);
  const m = I.macd(c, 12, 26, 9), f = I.ema(c, 12), s = I.ema(c, 26);
  near(m.macd[40], f[40] - s[40], 1e-12); near(m.hist[50], m.macd[50] - m.signal[50], 1e-12);
  eq(Number.isNaN(m.signal[25 + 7]), true); eq(Number.isFinite(m.signal[25 + 8]), true);
});
test('Stochastique bornée 0–100', () => {
  const c = Array.from({ length: 50 }, (_, i) => 1 + Math.sin(i) * 0.1);
  const st = I.stochastic(c, c, c, 14, 3, 3);
  for (const v of st.k.concat(st.d)) if (Number.isFinite(v) && (v < 0 || v > 100)) throw new Error('hors bornes ' + v);
});
test('Bollinger symétrique', () => {
  const b = I.bollinger([1, 2, 3, 4, 5], 5, 2); near(b.upper[4] - b.middle[4], b.middle[4] - b.lower[4], 1e-12); eq(b.middle[4], 3);
});

console.log('Langage de règles');
const ctx = R.makeContext(series([1, 2, 3, 4, 5, 4, 3, 2, 3, 4]));
test('Comparaison simple', () => { const s = R.evaluateRule('CLOSE > 3', ctx); eq(s.filter(Boolean).length, 4); });
test('AND / OR / NOT et mots français', () => {
  eq(R.evaluateRule('CLOSE > 2 ET CLOSE < 5', ctx).filter(Boolean).length, 6);
  eq(R.evaluateRule('close < 2 or close >= 5', ctx).filter(Boolean).length, 2);
  eq(R.evaluateRule('NOT (CLOSE > 3)', ctx).filter(Boolean).length, 6);
});
test('CROSS_UP / CROSS_DOWN', () => {
  const up = R.evaluateRule('CROSS_UP(CLOSE, 3.5)', ctx), dn = R.evaluateRule('CROSS_DOWN(CLOSE, 3.5)', ctx);
  eq(up.map(Number).join(''), '0001000001'); eq(dn.map(Number).join(''), '0000001000');
});
test('Indicateur sur indicateur + arithmétique', () => {
  eq(R.validate('SMA(RSI(14), 9) > 50 AND (CLOSE - SMA(20)) / ATR(14) > 1'), null);
});
test('Paramètres par défaut', () => { eq(R.validate('RSI < 30 AND MACD > MACD_SIGNAL'), null); });
test('Erreurs lisibles', () => {
  if (!/inconnue/.test(R.validate('FOO(3) > 1'))) throw new Error('fonction inconnue non détectée');
  if (!R.validate('RSI(14) >')) throw new Error('règle incomplète non détectée');
  if (!R.validate('SMA(0) > 1')) throw new Error('période 0 non détectée');
});
test('Tous les modèles de stratégie sont valides', () => {
  for (const p of P.list) for (const k of ['longEntry', 'longExit', 'shortEntry', 'shortExit']) {
    const err = R.validate(p[k]); if (err) throw new Error(p.name + ' / ' + k + ' : ' + err);
  }
});

console.log('Backtest');
const base = { capital: 10000, leverage: 10, exposurePct: 100, spreadPips: 0, pair: 'EUR/USD', startIndex: 1 };
test('Achat exécuté à l\'ouverture suivante, soldé en fin de période', () => {
  const bars = series([1.0, 1.0, 1.0, 1.1, 1.1]);
  const r = B.runBacktest(bars, { longEntry: 'CLOSE >= 1 AND CLOSE < 1.05' }, base);
  eq(r.trades.length, 1); eq(r.trades[0].entryIndex, 2); eq(r.trades[0].reason, 'Fin de période');
  // notionnel 100 000, +10 % => +10 000
  near(r.stats.finalEquity, 20000, 1e-6);
});
test('Levier appliqué et spread déduit', () => {
  const bars = series([1, 1, 1, 1.01, 1.01]);
  const r = B.runBacktest(bars, { longEntry: 'CLOSE < 1.005' }, Object.assign({}, base, { spreadPips: 1 }));
  // notionnel 100 000 ; gain 1 % = 1000 ; spread 1 pip = 0.0001/1 * 100 000 = 10
  near(r.stats.netProfit, 990, 1e-6);
});
test('Vente à découvert gagnante en baisse', () => {
  const bars = series([1, 1, 1, 0.9, 0.9]);
  const r = B.runBacktest(bars, { shortEntry: 'CLOSE > 0.95' }, base);
  eq(r.trades[0].dir, -1); near(r.stats.netProfit, 10000, 1e-6); // notionnel 100 000 × 10 %
});
test('Stop-loss en pips', () => {
  const bars = series([1, 1, 1, 0.99, 0.98]);
  const r = B.runBacktest(bars, { longEntry: 'CLOSE >= 1', stopLossPips: 50 }, base);
  eq(r.trades[0].reason, 'Stop-loss'); near(r.trades[0].exitPrice, 0.995, 1e-12);
});
test('Take-profit en pips', () => {
  const bars = series([1, 1, 1, 1.02, 1.03]);
  const r = B.runBacktest(bars, { longEntry: 'CLOSE <= 1', takeProfitPips: 100 }, base);
  eq(r.trades[0].reason, 'Take-profit'); near(r.trades[0].exitPrice, 1.01, 1e-12);
});
test('Margin call avec fort levier', () => {
  const bars = series([1, 1, 1, 0.98, 0.97]);
  const r = B.runBacktest(bars, { longEntry: 'CLOSE >= 1' }, Object.assign({}, base, { leverage: 100 }));
  eq(r.trades[0].reason, 'Margin call');
  near(r.stats.finalEquity, 5000, 1e-6); // clôture à 50 % de la marge (10 000)
});
test('Signal opposé : retournement de position', () => {
  const bars = series([1, 1, 1.1, 1.2, 1.1, 1.0, 1.0]);
  const r = B.runBacktest(bars, { longEntry: 'CROSS_UP(CLOSE, 1.05)', shortEntry: 'CROSS_DOWN(CLOSE, 1.15)' }, base);
  eq(r.trades.length, 2); eq(r.trades[0].dir, 1); eq(r.trades[1].dir, -1); eq(r.trades[1].entryIndex, r.trades[0].exitIndex);
});
test('Stratégie sur données simulées : statistiques cohérentes', () => {
  const to = new Date('2025-06-30'), rg = D.periodRange('2y', to);
  const bars = D.generateSynthetic('EUR/USD', rg.fetchStart, rg.end);
  for (const p of P.list) {
    const r = B.runBacktest(bars, p, Object.assign({}, base, { startIndex: D.indexFrom(bars, rg.start), spreadPips: 1 }));
    const s = r.stats;
    near(s.finalEquity, s.initialCapital + r.trades.reduce((a, t) => a + t.pnl, 0), 1e-6, p.name + ' : somme des trades');
    eq(s.wins + s.losses, s.trades);
    if (s.maxDrawdownPct < 0 || s.maxDrawdownPct > 100) throw new Error('drawdown invalide');
  }
});

console.log('Données');
test('CSV MT4 avec en-tête', () => {
  const rows = ['<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>'];
  for (let i = 1; i <= 31; i++) rows.push('2024.01.' + String(i).padStart(2, '0') + ',00:00,1.1,1.2,1.0,1.15');
  const b = D.parseCSV(rows.join('\n')); eq(b.length, 31); eq(b[0].date, '2024-01-01 00:00'); eq(b[0].close, 1.15);
});
test('CSV sans en-tête, séparateur ; et virgule décimale', () => {
  const rows = []; for (let i = 1; i <= 31; i++) rows.push('2024-01-' + String(i).padStart(2, '0') + ';1,1;1,2;1,0;1,15');
  eq(D.parseCSV(rows.join('\n'))[3].high, 1.2);
});

console.log('\n' + passed + ' réussis, ' + failed + ' échoués');
process.exit(failed ? 1 : 0);
