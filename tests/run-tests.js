/* Tests du moteur : node tests/run-tests.js */
'use strict';
const path = require('path');
for (const f of ['indicators', 'expr', 'backtest', 'data', 'presets', 'french', 'enhancer', 'mql5', 'broker']) require(path.join(__dirname, '..', 'js', f + '.js'));
const { indicators: I, rules: R, backtest: B, data: D, presets: P, french: FR, enhancer: E, mql5: MQ, broker: BK } = globalThis.Forexia;

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

console.log('Réécriture, styles et améliorations');
test('Réécriture des règles stable (texte -> arbre -> texte)', () => {
  for (const t of ['(RSI(14) > 30 OR RSI(14) < 20) AND CLOSE > SMA(200)', '(CLOSE - SMA(20)) / ATR(14) > 1', 'SMA(RSI(14), 9) > 50', 'CROSS_UP(MACD(12,26,9), MACD_SIGNAL(12,26,9))']) eq(R.canonical(t), t);
});
test('Règles -> français -> règles : identiques (modèles, styles, 300 aléatoires)', () => {
  for (const p of P.list) for (const st of Object.keys(E.STYLES)) if (!E.adaptToStyle(p, st).frenchText) throw new Error(p.id + ' / ' + st);
  for (let i = 0; i < 300; i++) { const s = FR.randomStrategy(); if (!FR.toFrench(s)) throw new Error(s.longEntry); }
});
test('Styles : périodes et stops adaptés', () => {
  const ma = P.list.find((p) => p.id === 'ma');
  const sc = E.adaptToStyle(ma, 'scalping'), lg = E.adaptToStyle(ma, 'long');
  eq(sc.longEntry, 'CROSS_UP(SMA(8), SMA(20))'); eq(sc.stopLossPips, 12);
  eq(lg.longEntry, 'CROSS_UP(SMA(40), SMA(100))'); eq(lg.stopLossPips, 300);
  eq(E.adaptToStyle(sc, 'medium', { fromStyle: 'scalping' }).longEntry, 'CROSS_UP(SMA(20), SMA(50))');
  const macd = E.adaptToStyle(P.list.find((p) => p.id === 'macd'), 'scalping');
  const m = /MACD\((\d+),(\d+)/.exec(macd.longEntry); if (!(+m[1] < +m[2])) throw new Error('MACD rapide >= lente');
});
test('Périodes de 1, 2 et 3 mois', () => {
  const end = new Date('2025-06-30T00:00:00Z');
  eq(D.iso(D.periodRange('1m', end).start), '2025-05-30'); eq(D.iso(D.periodRange('3m', end).start), '2025-03-30');
});
test('Améliorer : chaque suggestion est testée, meilleure que l\'actuel, et combinable', () => {
  const rg = D.periodRange('1y', new Date('2025-06-30'));
  const bars = D.generateSynthetic('EUR/USD', rg.fetchStart, rg.end);
  const set = Object.assign({}, base, { leverage: 20, spreadPips: 1, startIndex: D.indexFrom(bars, rg.start) });
  let total = 0;
  for (const p of P.list) {
    const r = E.suggest(bars, p, set, 'none');
    for (const sg of r.suggestions) {
      total++;
      const out = sg.apply({ strat: p, settings: set });
      const st = E.run(bars, out.strat, out.settings);
      near(st.returnPct, sg.stats.returnPct, 1e-9, sg.title);
      if (!sg.risk && !(E.score(st) > E.score(r.base))) throw new Error('pas une amélioration : ' + sg.title);
      if (!sg.risk && st.trades < 3) throw new Error('trop peu de trades : ' + sg.title);
      for (const k of ['longEntry', 'longExit', 'shortEntry', 'shortExit']) { const e = R.validate(out.strat[k]); if (e) throw new Error(e); }
    }
    const c = E.combine(p, set, r.suggestions);
    if (!E.run(bars, c.strat, c.settings)) throw new Error('combinaison invalide ' + p.id);
  }
  if (!total) throw new Error('aucune suggestion');
});
test('« Ne prendre que les achats » garde une sortie', () => {
  const rg = D.periodRange('1y', new Date('2025-06-30'));
  const bars = D.generateSynthetic('EUR/USD', rg.fetchStart, rg.end);
  const macd = P.list.find((p) => p.id === 'macd');
  const r = E.suggest(bars, macd, Object.assign({}, base, { startIndex: D.indexFrom(bars, rg.start) }), 'none');
  const dir = r.suggestions.find((x) => /^dir-/.test(x.id));
  if (dir) { const o = dir.apply({ strat: macd, settings: base }).strat; if (!o.longExit && !o.shortExit) throw new Error('pas de sortie'); }
});

console.log('Réalisme des données');
test('Mèches estimées : amplitude ≈ 2 × variation moyenne, corps conservé', () => {
  const rg = D.periodRange('1y', new Date('2025-06-30'));
  const real = D.generateSynthetic('EUR/USD', rg.fetchStart, rg.end);
  const co = D.barsFromCloses(real.map((b) => ({ date: b.date, close: b.close })));
  eq(D.hasRealRange(real), true); eq(D.hasRealRange(co), false);
  const est = D.estimateWicks(co);
  eq(D.hasRealRange(est), true);
  let r = 0, d = 0;
  for (let i = 30; i < est.length; i++) {
    r += est[i].high - est[i].low; d += Math.abs(est[i].close - est[i - 1].close);
    if (est[i].open !== co[i].open || est[i].close !== co[i].close) throw new Error('corps modifié');
  }
  near(r / d, 2, 0.25, 'rapport amplitude / variation');
});
test('Mèches estimées : un stop serré est touché plus souvent', () => {
  const rg = D.periodRange('1y', new Date('2025-06-30'));
  const co = D.barsFromCloses(D.generateSynthetic('GBP/USD', rg.fetchStart, rg.end).map((b) => ({ date: b.date, close: b.close })));
  const s = { longEntry: 'CROSS_UP(SMA(5), SMA(20))', shortEntry: 'CROSS_DOWN(SMA(5), SMA(20))', stopLossPips: 20 };
  const set = Object.assign({}, base, { pair: 'GBP/USD', startIndex: D.indexFrom(co, rg.start) });
  const sl = (bars) => B.runBacktest(bars, s, set).trades.filter((t) => t.reason === 'Stop-loss').length;
  if (!(sl(D.estimateWicks(co)) > sl(co))) throw new Error('pas plus de stops');
});
test('Export MT5 : colonnes, spread et unité de temps reconnus', () => {
  const d1 = ['<DATE>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>'];
  for (let i = 0; i < 40; i++) { const d = new Date(Date.UTC(2024, 0, 1 + i)); d1.push(D.iso(d).replace(/-/g, '.') + '\t1.27000\t1.27800\t1.26500\t1.27300\t52000\t0\t' + (12 + (i % 3))); }
  const b = D.parseCSV(d1.join('\r\n'));
  eq(b.length, 40); eq(b[0].date, '2024-01-01'); eq(b[0].high, 1.278); eq(b[0].spreadPoints, 12); eq(D.detectTimeframe(b), 'D1'); eq(D.hasRealRange(b), true);
  const h1 = ['<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>'];
  for (let i = 0; i < 40; i++) h1.push('2024.01.0' + (2 + Math.floor(i / 24)) + '\t' + String(i % 24).padStart(2, '0') + ':00:00\t1.1\t1.2\t1.0\t1.15\t10\t0\t7');
  const c = D.parseCSV(h1.join('\n'));
  eq(c[0].date, '2024-01-02 00:00:00'); eq(D.detectTimeframe(c), 'H1');
});
test('Améliorer : contrôle sur la période précédente', () => {
  const rg = D.periodRange('1y', new Date('2025-06-30'));
  const bars = D.generateSynthetic('EUR/USD', rg.fetchStart, rg.end);
  const r = E.suggest(bars, P.list[2], Object.assign({}, base, { leverage: 20, startIndex: D.indexFrom(bars, rg.start) }), 'none');
  if (!r.validation) throw new Error('pas de période de contrôle');
  for (const sg of r.suggestions) if (!sg.validation || typeof sg.validation.confirmed !== 'boolean') throw new Error('suggestion non contrôlée : ' + sg.title);
});

console.log('Backtest courtier (MT5)');
function brokerFixture(pair) {
  const rg = D.periodRange('1y', new Date('2025-06-30'));
  const r5 = (v) => Math.round(v * 1e5) / 1e5; // prix à 5 décimales, comme chez un courtier
  const bars = D.generateSynthetic(pair, rg.fetchStart, rg.end).map((b) => ({ date: b.date, t: Date.parse(b.date + 'T00:00:00Z') / 1000, open: r5(b.open), high: r5(b.high), low: r5(b.low), close: r5(b.close), spread: 0 }));
  return { bars, start: D.indexFrom(bars, rg.start) };
}
const idealSpec = { digits: 5, point: 0.00001, contract: 100000, volumeMin: 1e-9, volumeStep: 1e-9, volumeMax: 1e9, swapMode: 0 };
test('Courtier idéal (spread 0, sans swap, lots continus) = moteur standard', () => {
  const { bars, start } = brokerFixture('EUR/USD');
  for (const p of P.list) {
    const set = { capital: 10000, leverage: 10, exposurePct: 50, spreadPips: 0, pair: 'EUR/USD', startIndex: start };
    const a = B.runBacktest(bars, p, set);
    const b = BK.runBrokerBacktest(bars, p, Object.assign({}, set, { sizing: 'backtest', maxLots: 1e9, maxSpreadPips: 0 }), { spec: idealSpec, account: { marginSoSo: 50 } });
    eq(b.trades.length, a.trades.length, p.id + ' trades');
    near(b.stats.finalEquity, a.stats.finalEquity, 1e-9 * a.stats.finalEquity, p.id + ' capital final');
  }
});
test('Courtier : spread payé à l\'achat (ask) et à la vente (clôture à l\'ask)', () => {
  const bars = [0, 1, 2, 3, 4].map((i) => ({ date: '2024-01-0' + (i + 1), t: 1704067200 + i * 86400, open: 1.1, high: 1.1, low: 1.1, close: 1.1, spread: 20 }));
  const spec = Object.assign({}, idealSpec, { volumeMin: 0.01, volumeStep: 0.01 });
  const set = { capital: 10000, leverage: 100, sizing: 'fixed', fixedLots: 1, maxLots: 10, maxSpreadPips: 0, startIndex: 1 };
  const L = BK.runBrokerBacktest(bars, { longEntry: 'CLOSE > 0' }, set, { spec });
  near(L.trades[0].entryPrice, 1.1002, 1e-12); near(L.stats.netProfit, -20, 1e-6); // 2 pips × 1 lot × 10 $/pip
  const Sh = BK.runBrokerBacktest(bars, { shortEntry: 'CLOSE > 0' }, set, { spec });
  near(Sh.trades[0].exitPrice, 1.1002, 1e-12); near(Sh.stats.netProfit, -20, 1e-6);
});
test('Courtier : lots arrondis, plafond et marge comme l\'EA', () => {
  const bars = [0, 1, 2, 3].map((i) => ({ date: '2024-01-0' + (i + 1), t: 1704067200 + i * 86400, open: 1.25, high: 1.25, low: 1.25, close: 1.25, spread: 0 }));
  const spec = Object.assign({}, idealSpec, { volumeMin: 0.01, volumeStep: 0.01 });
  const run = (o) => BK.runBrokerBacktest(bars, { longEntry: 'CLOSE > 0' }, Object.assign({ capital: 100, leverage: 100, exposurePct: 100, sizing: 'backtest', maxLots: 1, maxSpreadPips: 0, startIndex: 1 }, o), { spec }).trades[0];
  eq(run({}).lots, 0.07); // 100 × 100 / 125 000 = 0,08 lot, limité à 90 % de la marge -> 0,072 -> 0,07
  eq(run({ capital: 1000000 }).lots, 1); // plafond
  eq(run({ capital: 5 }), undefined); // sous le minimum : pas d'ordre
});
test('Courtier : swaps (triple le mercredi) et conversion de devise', () => {
  eq(BK.swapNights(Date.UTC(2024, 0, 1) / 1000, Date.UTC(2024, 0, 8) / 1000, 3), 7); // lun -> lun : 4 × 1 + 3
  near(BK.convFactor({ rates: [[0, 1.10], [100, 1.20]], divide: true }, 150), 1 / 1.2, 1e-12);
  const bars = [0, 1, 2, 3, 4, 5].map((i) => ({ date: '2024-01-0' + (i + 1), t: Date.UTC(2024, 0, 1 + i) / 1000, open: 1.25, high: 1.25, low: 1.25, close: 1.25, spread: 0 }));
  const spec = Object.assign({}, idealSpec, { volumeMin: 0.01, volumeStep: 0.01, swapMode: 1, swapLong: -10, swapShort: 2, swapRollover3days: 3 });
  const r = BK.runBrokerBacktest(bars, { longEntry: 'CLOSE > 0' }, { capital: 10000, leverage: 100, sizing: 'fixed', fixedLots: 1, maxLots: 5, maxSpreadPips: 0, startIndex: 1 }, { spec, conv: { rates: [[0, 1.25]], divide: true } });
  // signal le 2/1, entrée mer. 3/1, sortie sam. 6/1 : nuits mer (×3), jeu, ven = 5 ; -10 points × 0,00001 × 100 000 = -10 USD / nuit -> -50 USD = -40 EUR
  eq(r.trades[0].entryDate, '2024-01-03'); near(r.trades[0].swap, -40, 1e-9);
});
test('Courtier : bougies fines -> ordre stop / objectif selon le déroulé réel', () => {
  // Bougie D1 qui touche les deux niveaux : l'objectif d'abord (bougie H1 n°1), le stop ensuite.
  const D1 = [0, 1, 2].map((i) => ({ date: '2024-01-0' + (i + 1), t: Date.UTC(2024, 0, 1 + i) / 1000, open: 1.1, high: i === 2 ? 1.103 : 1.1, low: i === 2 ? 1.097 : 1.1, close: 1.1, spread: 0 }));
  const H1 = [{ t: D1[2].t, open: 1.1, high: 1.103, low: 1.1, close: 1.1025, spread: 0 }, { t: D1[2].t + 3600, open: 1.1025, high: 1.1025, low: 1.097, close: 1.1, spread: 0 }];
  const spec = Object.assign({}, idealSpec, { volumeMin: 0.01, volumeStep: 0.01 });
  const set = { capital: 10000, leverage: 100, sizing: 'fixed', fixedLots: 1, maxLots: 5, maxSpreadPips: 0, startIndex: 1 };
  const strat = { longEntry: 'CLOSE > 0', stopLossPips: 20, takeProfitPips: 20 };
  eq(BK.runBrokerBacktest(D1, strat, set, { spec }).trades[0].reason, 'Stop-loss'); // sans détail : prudent
  eq(BK.runBrokerBacktest(D1, strat, set, { spec, sub: H1 }).trades[0].reason, 'Take-profit');
});

console.log('Expert Advisor MT5');
test('EA généré pour chaque modèle : paramètres repris de la stratégie', () => {
  for (const p of P.list) {
    const r = MQ.generate(p, { pair: 'EUR/USD', leverage: 20, exposurePct: 50, sizing: 'risk', riskPct: 2, maxLots: 3 });
    if (!/^Forexia_[A-Za-z0-9_]+\.mq5$/.test(r.fileName)) throw new Error('nom de fichier ' + r.fileName);
    for (const needle of ['void OnTick()', 'int OnInit()', 'FxSignals(o, h, l, c, n, le, lx, se, sx)', 'InpSizing = FX_SIZING_RISK', 'InpLeverage = 20',
      'InpExposurePct = 50', 'InpRiskPct = 2', 'InpMaxLots = 3', 'InpStopLossPips = ' + (p.stopLossPips || 0), 'FX_PAIR "EURUSD"']) {
      if (!r.code.includes(needle)) throw new Error(p.id + ' : « ' + needle + ' » absent');
    }
    eq(r.code.includes('InpAllowShort = ' + (p.shortEntry ? 'true' : 'false')), true);
  }
});
test('EA : stratégie sans entrée ou règle invalide refusée', () => {
  let n = 0;
  for (const s of [{ longExit: 'RSI(14) > 70' }, { longEntry: 'RSI(14) >' }]) { try { MQ.generate(s, {}); } catch (e) { n++; } }
  eq(n, 2);
});
test('EA : accolades et parenthèses équilibrées', () => {
  const code = MQ.generate(P.list[5], { pair: 'EUR/USD' }).code.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/\/\/.*$/gm, '');
  for (const [o, c] of [['{', '}'], ['(', ')'], ['[', ']']]) eq(code.split(o).length, code.split(c).length, o + c);
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
