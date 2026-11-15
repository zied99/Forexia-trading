/* Tests du moteur : node tests/run-tests.js */
'use strict';
const path = require('path');
for (const f of ['indicators', 'expr', 'backtest', 'data', 'presets', 'french']) require(path.join(__dirname, '..', 'js', f + '.js'));
const { indicators: I, rules: R, backtest: B, data: D, presets: P, french: FR } = globalThis.Forexia;

let failed = 0, passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  ÉCHEC ' + name + '\n       ' + e.message); }
}
async function atest(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
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

test('Période personnalisée : dates et contrôles', () => {
  const r = D.customRange('2015-03-01', '2018-06-30');
  eq(D.iso(r.start), '2015-03-01'); eq(D.iso(r.end), '2018-06-30');
  if (!(r.fetchStart < r.start)) throw new Error('pas d\'historique de préchauffage');
  for (const [a, b] of [['2020-01-01', '2019-01-01'], ['2020-01-01', '2020-01-10'], ['', '2020-01-01']]) {
    let threw = false; try { D.customRange(a, b); } catch (e) { threw = true; }
    if (!threw) throw new Error('aurait dû refuser ' + a + ' → ' + b);
  }
});

console.log('Stratégies en français');
const PHRASES = [
  ["J'achète lorsque le RSI est inférieur à 30", { longEntry: 'RSI(14) < 30' }],
  ['Achat si RSI(14) < 25 et prix > MM200', { longEntry: 'RSI(14) < 25 AND CLOSE > SMA(200)' }],
  ['Je vends quand le RSI 9 est supérieur à 75. Je sors quand le RSI repasse sous 50',
    { shortEntry: 'RSI(9) > 75', shortExit: 'CROSS_DOWN(RSI(9), 50)', longExit: 'CROSS_DOWN(RSI(9), 50)' }],
  ["Acheter dès que la MME 9 croise à la hausse la MME 21. Vendre à l'inverse. Objectif 120 pips, stop à 60 pips",
    { longEntry: 'CROSS_UP(EMA(9), EMA(21))', shortEntry: 'CROSS_DOWN(EMA(9), EMA(21))', stopLossPips: 60, takeProfitPips: 120 }],
  ["Entrer à l'achat quand le prix casse la bande de Bollinger haute", { longEntry: 'CROSS_UP(CLOSE, BB_UPPER(20,2))' }],
  ['Position longue quand le RSI est entre 40 et 60 et que le MACD est positif', { longEntry: 'RSI(14) > 40 AND RSI(14) < 60 AND MACD(12,26,9) > 0' }],
  ['Vendre quand le stochastique sort de la zone de surachat', { shortEntry: 'CROSS_DOWN(STOCH_K(14,3,3), 80)' }],
  ['Acheter quand le RSI sort de la zone de survente', { longEntry: 'CROSS_UP(RSI(14), 30)' }],
  ['Achète si le MACD croise sa ligne de signal à la hausse ou si le RSI est en zone de survente',
    { longEntry: 'CROSS_UP(MACD(12,26,9), MACD_SIGNAL(12,26,9)) OR RSI(14) < 30' }],
  ['Acheter quand le RSI 7 passe au-dessus de 20. Vendre dans le cas inverse',
    { longEntry: 'CROSS_UP(RSI(7), 20)', shortEntry: 'CROSS_DOWN(RSI(7), 80)' }],
  ['Acheter quand le prix passe sous la bande de Bollinger basse. Vendre à l\'inverse',
    { longEntry: 'CROSS_DOWN(CLOSE, BB_LOWER(20,2))', shortEntry: 'CROSS_UP(CLOSE, BB_UPPER(20,2))' }],
  ['Achat quand la moyenne mobile 50 est haussière', { longEntry: 'SMA(50) > PREV(SMA(50), 1)' }],
];
for (const [text, expected] of PHRASES) {
  test('« ' + text.slice(0, 60) + (text.length > 60 ? '…' : '') + ' »', () => {
    const r = FR.parse(text);
    if (r.warnings.length) throw new Error('avertissements : ' + r.warnings.join(' | '));
    for (const k in expected) eq(r[k], expected[k], k);
  });
}
test('Texte incompréhensible : avertissement, aucune règle', () => {
  const r = FR.parse('Acheter quand la lune est pleine');
  eq(r.longEntry, ''); if (!r.warnings.length) throw new Error('aucun avertissement');
});
test('La description française de chaque modèle donne exactement ses règles', () => {
  for (const p of P.list) {
    const r = FR.parse(p.frenchText);
    if (r.warnings.length) throw new Error(p.id + ' : ' + r.warnings.join(' | '));
    for (const k of ['longEntry', 'longExit', 'shortEntry', 'shortExit', 'stopLossPips', 'takeProfitPips']) eq(r[k] || 0, p[k] || 0, p.id + '.' + k);
  }
});
test('500 stratégies aléatoires : toutes valides et testables', () => {
  let seed = 42;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const to = new Date('2025-06-30'), rg = D.periodRange('1y', to);
  const bars = D.generateSynthetic('GBP/USD', rg.fetchStart, rg.end);
  for (let i = 0; i < 500; i++) {
    const s = FR.randomStrategy(rnd);
    if (s.warnings.length) throw new Error(s.frenchText + ' → ' + s.warnings.join(' | '));
    if (!s.longEntry && !s.shortEntry) throw new Error('pas d\'entrée : ' + s.frenchText);
    for (const k of ['longEntry', 'longExit', 'shortEntry', 'shortExit']) { const e = R.validate(s[k]); if (e) throw new Error(s[k] + ' : ' + e); }
    if (i % 25 === 0) B.runBacktest(bars, s, Object.assign({}, base, { pair: 'GBP/USD', startIndex: D.indexFrom(bars, rg.start) }));
  }
});

(async () => {
  console.log('Téléchargement des cours (API simulée)');
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const m = /\/(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/.exec(url);
    const rates = {};
    for (let d = new Date(m[1]); d <= new Date(m[2]); d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() % 6) rates[d.toISOString().slice(0, 10)] = { USD: 1.1 };
    }
    return { ok: true, json: async () => ({ rates }) };
  };
  await atest('Longue période : découpée par années, cotations journalières sans doublon', async () => {
    const bars = await D.fetchFrankfurter('EUR/USD', new Date('2010-01-01'), new Date('2015-12-31'));
    if (calls.length < 6) throw new Error(calls.length + ' requêtes seulement');
    const dates = bars.map((b) => b.date);
    eq(new Set(dates).size, dates.length, 'doublons');
    eq(dates.join() === [...dates].sort().join(), true, 'ordre');
    if (bars.length < 1500) throw new Error(bars.length + ' bougies seulement');
  });
  await atest('Pas de requête avant 1999 (début des cours BCE)', async () => {
    calls.length = 0;
    const bars = await D.fetchFrankfurter('EUR/USD', new Date('1990-01-01'), new Date('1999-06-30'));
    eq(bars[0].date >= '1999-01-04', true); if (!calls.every((u) => !/199[0-8]-/.test(u))) throw new Error('requête avant 1999');
  });
  console.log('\n' + passed + ' réussis, ' + failed + ' échoués');
process.exit(failed ? 1 : 0);
})();
