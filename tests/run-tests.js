/* Tests du moteur : node tests/run-tests.js */
'use strict';
const path = require('path');
for (const f of ['indicators', 'expr', 'trade', 'backtest', 'data', 'presets', 'french', 'enhancer', 'mql5', 'broker']) require(path.join(__dirname, '..', 'js', f + '.js'));
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

console.log('Indicateurs 1.2');
function hourly(n, f) {
  const out = []; let p = 1.1;
  for (let i = 0; i < n; i++) { const o = p; p = f ? f(i, p) : p * (1 + Math.sin(i / 7) * 0.002); out.push({ t: 1704067200 + i * 3600, open: o, high: Math.max(o, p) + 0.0005, low: Math.min(o, p) - 0.0005, close: p }); }
  return out;
}
test('Unité supérieure (@H4) : dernière bougie H4 close, jamais la bougie en cours', () => {
  const bars = hourly(40), ctx = R.makeContext(bars);
  const v = R.evaluateSeries('CLOSE@H4', ctx);
  for (let i = 0; i < 40; i++) {
    const bucket = Math.floor(bars[i].t / 14400), lastOfBucket = i + 1 < 40 && Math.floor(bars[i + 1].t / 14400) !== bucket;
    // bougie H4 close à i : celle de i si i est sa dernière heure, sinon la précédente
    let j = lastOfBucket ? i : i - (i % 4) - 1;
    const expect = j >= 0 ? bars[j].close : NaN;
    if (!(Number.isNaN(expect) ? Number.isNaN(v[i]) : Math.abs(v[i] - expect) < 1e-12)) throw new Error('bougie ' + i + ' : ' + v[i] + ' au lieu de ' + expect);
  }
  // la dernière bougie : close seulement si on sait que la suivante ouvre une nouvelle H4
  eq(Number.isNaN(R.evaluateSeries('CLOSE@H4', R.makeContext(bars.slice(0, 4)))[3]), true);
  near(R.evaluateSeries('CLOSE@H4', R.makeContext(bars.slice(0, 4), { nextTime: bars[4].t }))[3], bars[3].close, 1e-12);
  // modifier une bougie future ne change rien au passé
  const a = R.evaluateSeries('RSI(3)@H4', R.makeContext(bars)), changed = bars.map((b, i) => (i === 30 ? Object.assign({}, b, { close: 5 }) : b));
  const b = R.evaluateSeries('RSI(3)@H4', R.makeContext(changed));
  for (let i = 0; i < 30; i++) if (!(a[i] === b[i] || (Number.isNaN(a[i]) && Number.isNaN(b[i])))) throw new Error('regard vers le futur à ' + i);
});
test('Pivots : calculés sur la journée précédente', () => {
  const bars = hourly(60), ctx = R.makeContext(bars), P = R.evaluateSeries('PIVOT', ctx);
  const d0 = bars.filter((b) => Math.floor(b.t / 86400) === Math.floor(bars[0].t / 86400));
  const H = Math.max(...d0.map((b) => b.high)), L = Math.min(...d0.map((b) => b.low)), C = d0[d0.length - 1].close;
  eq(Number.isNaN(P[0]), true); near(P[24], (H + L + C) / 3, 1e-12);
});
test('Divergence haussière : prix plus bas, oscillateur plus haut', () => {
  const low = [10, 9, 8, 7, 8, 9, 9.5, 9, 8.5, 6.5], osc = [50, 40, 30, 20, 30, 40, 45, 40, 35, 25];
  const d = I.divergence(low, osc, 5, 1);
  eq(d[9], 1); eq(I.divergence(low, osc.map((x, i) => (i === 9 ? 15 : x)), 5, 1)[9], 0);
});
test('ADX, SuperTrend, SAR parabolique, Ichimoku, Donchian, Keltner : valeurs cohérentes', () => {
  const up = hourly(200, (i, p) => p * 1.001), ctx = R.makeContext(up); // forte hausse continue
  const last = (e) => { const v = R.evaluateSeries(e, ctx); return v[v.length - 1]; };
  if (!(last('ADX(14)') > 50 && last('PLUS_DI(14)') > last('MINUS_DI(14)'))) throw new Error('ADX');
  eq(last('SUPERTREND_DIR(10,3)'), 1); if (!(last('SUPERTREND(10,3)') < last('CLOSE'))) throw new Error('SuperTrend');
  if (!(last('PSAR()') < last('LOW'))) throw new Error('SAR');
  if (!(last('TENKAN(9)') > last('KIJUN(26)') && last('CLOSE') > last('SENKOU_A(9,26)'))) throw new Error('Ichimoku');
  near(last('DONCHIAN_UPPER(20)'), Math.max(...up.slice(-20).map((b) => b.high)), 1e-12);
  if (!(last('KELTNER_UPPER(20,2,10)') > last('KELTNER_MIDDLE(20,2,10)'))) throw new Error('Keltner');
  if (!(last('SLOPE(EMA(50), 5)') > 0)) throw new Error('pente');
});
test('Heure, jour de la semaine, figures de bougies', () => {
  const ctx = R.makeContext(hourly(30));
  eq(R.evaluateSeries('HOUR', ctx)[5], 5); eq(R.evaluateSeries('WEEKDAY', ctx)[0], 1); // 1er janvier 2024 = lundi
  const eng = [{ t: 0, open: 1.10, high: 1.11, low: 1.09, close: 1.095 }, { t: 3600, open: 1.094, high: 1.12, low: 1.093, close: 1.115 }];
  eq(R.evaluateRule('BULL_ENGULF', R.makeContext(eng))[1], true);
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

test('Retrait fictif : gain retiré au seuil, compte remis au capital, total conservé', () => {
  // +10 % par trade : 10 000 -> 11 000 -> 12 100 (≥ +20 % ? non : 21 %, oui) …
  const closes = [1, 1, 1, 1.01, 1.01, 1.0201, 1.0201, 1.030301, 1.030301];
  const bars = series(closes);
  const strat = { longEntry: 'CLOSE == PREV(CLOSE, 1)', longExit: 'CLOSE > PREV(CLOSE, 1)' };
  const set = Object.assign({}, base, { withdrawPct: 20, withdrawShare: 100 });
  const r = B.runBacktest(bars, strat, set), plain = B.runBacktest(bars, strat, base);
  eq(r.withdrawals.length, 1); near(r.withdrawals[0].amount, 2100, 1e-6); near(r.withdrawals[0].accountAfter, 10000, 1e-6);
  near(r.stats.totalWithdrawn, 2100, 1e-6);
  // après le retrait, le trade suivant est plus petit : +1 000 au lieu de +1 210
  near(r.stats.finalAccount, 11000, 1e-6); near(r.stats.finalEquity, 13100, 1e-6);
  near(plain.stats.finalEquity, 13310, 1e-6);
  near(r.stats.finalEquity, base.capital + r.trades.reduce((a, t) => a + t.pnl, 0), 1e-6);
  const half = B.runBacktest(bars, strat, Object.assign({}, set, { withdrawShare: 50 }));
  near(half.withdrawals[0].amount, 1050, 1e-6);
});
test('Retrait fictif : aussi dans le moteur courtier', () => {
  const bars = [1, 1, 1, 1.01, 1.01, 1.0201, 1.0201].map((c, i, a) => ({ date: '2024-01-0' + (i + 1), t: 1704067200 + i * 86400, open: i ? a[i - 1] : c, high: Math.max(c, i ? a[i - 1] : c), low: Math.min(c, i ? a[i - 1] : c), close: c, spread: 0 }));
  const spec = { digits: 5, point: 0.00001, contract: 100000, volumeMin: 1e-9, volumeStep: 1e-9, volumeMax: 1e9, swapMode: 0 };
  const r = BK.runBrokerBacktest(bars, { longEntry: 'CLOSE == PREV(CLOSE, 1)', longExit: 'CLOSE > PREV(CLOSE, 1)' },
    { capital: 10000, leverage: 10, exposurePct: 100, sizing: 'backtest', maxLots: 1e9, maxSpreadPips: 0, startIndex: 1, withdrawPct: 15 }, { spec });
  // limite de 90 % de la marge (comme l'EA) : +9 % par trade -> 10 000 -> 10 900 -> 11 881 ≥ 11 500 -> 1 881 retirés
  eq(r.withdrawals.length, 1); near(r.stats.totalWithdrawn, 1881, 1e-3); near(r.stats.finalAccount, 10000, 1e-3);
});

test('Retrait « dès le seuil » : position clôturée quand le compte atteint +2 %', () => {
  const bars = series([1, 1, 1, 1.05, 1.10, 1.10]);
  const strat = { longEntry: 'CLOSE == 1' };
  const set = Object.assign({}, base, { withdrawPct: 2, withdrawWhen: 'immediate' });
  const r = B.runBacktest(bars, strat, set);
  eq(r.trades[0].reason, 'Retrait'); near(r.trades[0].exitPrice, 1.002, 1e-12);
  eq(r.withdrawals.length, 1); near(r.withdrawals[0].amount, 200, 1e-6); near(r.stats.finalEquity, 10200, 1e-6);
  near(r.stats.finalAccount, 10000, 1e-6); // retrait immédiat, compte remis à niveau tout de suite
  // arrondi : seuil atteint à 1e-12 près -> retrait quand même
  const close = B.makeWithdrawals({ capital: 100, withdrawPct: 2 }, [{ date: 'x' }]);
  let taken = 0; close.check(0, 101.99999999999, (a) => { taken = a; }); if (!(taken > 1.99)) throw new Error('retrait manqué à cause de l\'arrondi');
  // mode par défaut : retrait seulement à la clôture du trade (ici en fin de période, à +10 %)
  const late = B.runBacktest(bars, strat, Object.assign({}, set, { withdrawWhen: 'close' }));
  eq(late.trades[0].reason, 'Fin de période'); near(late.withdrawals[0].amount, 10000, 1e-6);
  // le take-profit plus proche de l'entrée passe avant le seuil
  const tp = B.runBacktest(bars, Object.assign({}, strat, { takeProfitPips: 10 }), set);
  eq(tp.trades[0].reason, 'Take-profit');
  // moteur courtier
  const bb = bars.map((b, i) => Object.assign({}, b, { t: 1704067200 + i * 86400, spread: 0 }));
  const spec = { digits: 5, point: 0.00001, contract: 100000, volumeMin: 1e-9, volumeStep: 1e-9, volumeMax: 1e9, swapMode: 0 };
  const rb = BK.runBrokerBacktest(bb, strat, { capital: 10000, leverage: 10, exposurePct: 50, sizing: 'backtest', maxLots: 1e9, maxSpreadPips: 0, startIndex: 1, withdrawPct: 2, withdrawWhen: 'immediate' }, { spec });
  eq(rb.trades[0].reason, 'Retrait'); near(rb.withdrawals[0].amount, 200, 1e-6);
});

console.log('Gestion des trades 1.2');
// bougies explicites : [open, high, low, close]
function ohlc(rows) { return rows.map((r, i) => ({ date: '2024-02-' + String(i + 1).padStart(2, '0'), open: r[0], high: r[1], low: r[2], close: r[3] })); }
const brokerSpec = { digits: 5, point: 0.00001, contract: 100000, volumeMin: 1e-9, volumeStep: 1e-9, volumeMax: 1e9, swapMode: 0 };
const brokerSet = { capital: 10000, leverage: 10, exposurePct: 100, sizing: 'backtest', maxLots: 1e9, maxSpreadPips: 0, startIndex: 1 };
const withT = (bars) => bars.map((b, i) => Object.assign({}, b, { t: 1706745600 + i * 86400, spread: 0 }));
test('Distances en pips ou en multiples d\'ATR', () => {
  const T = globalThis.Forexia.trade;
  const d = T.distances({ stopLossPips: 20, stopAtr: 2, takeProfitPips: 50, trailPips: 10 }, 0.0015, 0.0001);
  near(d.sl, 0.003, 1e-12); near(d.tp, 0.005, 1e-12); near(d.trail, 0.001, 1e-12); eq(d.be, 0);
  // ATR indisponible : retour aux pips
  near(T.distances({ stopLossPips: 20, stopAtr: 2 }, NaN, 0.0001).sl, 0.002, 1e-12);
});
test('Stop suiveur, passage à l\'équilibre, durée maximale (moteur standard)', () => {
  const rows = [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1.01, 1, 1.01], [1.01, 1.03, 1.01, 1.03], [1.03, 1.03, 1.025, 1.028], [1.028, 1.028, 0.99, 0.99], [0.99, 0.99, 0.99, 0.99]];
  const bars = ohlc(rows), strat = { longEntry: 'PREV(CLOSE, 1) == 1 AND CLOSE == 1' };
  const set = Object.assign({}, base, { exposurePct: 10 });
  const tr = B.runBacktest(bars, Object.assign({}, strat, { trailPips: 100 }), set).trades[0];
  eq(tr.reason, 'Stop-loss'); eq(tr.entryIndex, 2); near(tr.exitPrice, 1.02, 1e-12);
  const be = B.runBacktest(bars, Object.assign({}, strat, { breakevenPips: 200 }), set).trades[0];
  eq(be.reason, 'Stop-loss'); near(be.exitPrice, 1, 1e-12);
  const none = B.runBacktest(bars, strat, set).trades[0];
  eq(none.reason, 'Fin de période');
  const mb = B.runBacktest(bars, Object.assign({}, strat, { maxBars: 2 }), set).trades[0];
  eq(mb.reason, 'Durée max'); eq(mb.exitIndex - mb.entryIndex, 2);
});
test('Mêmes règles dans le moteur courtier', () => {
  const rows = [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1.01, 1, 1.01], [1.01, 1.03, 1.01, 1.03], [1.03, 1.03, 1.025, 1.028], [1.028, 1.028, 0.99, 0.99], [0.99, 0.99, 0.99, 0.99]];
  const bars = withT(ohlc(rows)), strat = { longEntry: 'PREV(CLOSE, 1) == 1 AND CLOSE == 1' };
  const run = (x) => BK.runBrokerBacktest(bars, Object.assign({}, strat, x), Object.assign({}, brokerSet, { exposurePct: 10 }), { spec: brokerSpec }).trades[0];
  const tr = run({ trailPips: 100 }); eq(tr.reason, 'Stop-loss'); near(tr.exitPrice, 1.02, 1e-9);
  const be = run({ breakevenPips: 200 }); near(be.exitPrice, 1, 1e-9);
  const mb = run({ maxBars: 2 }); eq(mb.reason, 'Durée max'); eq(mb.exitIndex - mb.entryIndex, 2);
});
test('Stops en multiples d\'ATR', () => {
  // ATR(2) constant = 0.01 ; stop à 1 ATR sous l'entrée
  const rows = []; for (let i = 0; i < 8; i++) rows.push([1, 1.005, 0.995, 1]);
  rows.push([1, 1.0, 0.985, 0.985], [0.985, 0.985, 0.985, 0.985]);
  const r = B.runBacktest(ohlc(rows), { longEntry: 'DAY == 5', stopAtr: 1, atrPeriod: 2 }, Object.assign({}, base, { exposurePct: 10 }));
  eq(r.trades[0].reason, 'Stop-loss'); near(r.trades[0].exitPrice, 0.99, 1e-9);
});
test('Pause après des pertes consécutives', () => {
  const T = globalThis.Forexia.trade;
  const p = T.makePause({ pauseLosses: 2, pauseBars: 3 });
  p.onClose(5, -1); eq(p.blocked(6), false); p.onClose(7, -1);
  eq(p.blocked(8), true); eq(p.blocked(10), true); eq(p.blocked(11), false);
  p.onClose(12, -1); p.onClose(13, 5); p.onClose(14, -1); eq(p.blocked(15), false);
  // dans le moteur : la perte suivante bloque les entrées et l'indique dans le diagnostic
  const rows = [[1, 1, 1, 1]]; for (let i = 0; i < 12; i++) rows.push(i % 2 ? [0.99, 1, 0.99, 1] : [1, 1, 0.99, 0.99]);
  const r = B.runBacktest(ohlc(rows), { longEntry: 'CLOSE == 1', longExit: 'CLOSE < 1', pauseLosses: 1, pauseBars: 3 }, Object.assign({}, base, { exposurePct: 10 }));
  if (!(r.diag.paused > 0)) throw new Error('aucune entrée bloquée');
  const free = B.runBacktest(ohlc(rows), { longEntry: 'CLOSE == 1', longExit: 'CLOSE < 1' }, Object.assign({}, base, { exposurePct: 10 }));
  if (!(r.trades.length < free.trades.length)) throw new Error('la pause ne réduit pas le nombre de trades');
});
test('Calendrier économique : entrée bloquée ou position fermée', () => {
  const bars = series([1, 1, 1, 1.01, 1.02, 1.03, 1.03]);
  const t0 = Date.parse('2024-01-04T00:00:00Z') / 1000; // jour de l'entrée
  const strat = { longEntry: 'DAY == 3' };
  const blocked = B.runBacktest(bars, strat, Object.assign({}, base, { news: { times: [t0 + 14 * 3600], before: 30, after: 30, mode: 'block' } }));
  eq(blocked.trades.length, 0); eq(blocked.diag.newsBlocked, 1);
  // annonce la veille à 23h50, fenêtre de 30 min après : touche aussi le jour d'entrée
  eq(B.runBacktest(bars, strat, Object.assign({}, base, { news: { times: [t0 - 600], before: 0, after: 30 } })).trades.length, 0);
  eq(B.runBacktest(bars, strat, Object.assign({}, base, { news: { times: [t0 - 3600], before: 0, after: 30 } })).trades.length, 1);
  const closed = B.runBacktest(bars, strat, Object.assign({}, base, { news: { times: [t0 + 86400 * 2 + 3600], before: 30, after: 30, mode: 'close' } }));
  eq(closed.trades[0].reason, 'Annonce'); eq(closed.trades[0].exitIndex, 5);
  const bb = withT(bars).map((b, i) => Object.assign(b, { t: Date.parse(b.date + 'T00:00:00Z') / 1000 }));
  const rb = BK.runBrokerBacktest(bb, strat, Object.assign({}, brokerSet, { news: { times: [t0 + 86400 * 2 + 3600], before: 30, after: 30, mode: 'close' } }), { spec: brokerSpec });
  eq(rb.trades[0].reason, 'Annonce'); eq(rb.trades[0].exitIndex, 5);
});
test('Commission par lot et taille au risque (moteur standard)', () => {
  const rows = [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 0.99, 0.99], [0.99, 0.99, 0.99, 0.99]];
  const strat = { longEntry: 'DAY == 2', stopLossPips: 50 };
  const r = B.runBacktest(ohlc(rows), strat, Object.assign({}, base, { sizing: 'risk', riskPct: 2 }));
  near(r.trades[0].pnl, -200, 1e-6); near(r.trades[0].lots, 0.4, 1e-9);
  const c = B.runBacktest(ohlc(rows), strat, Object.assign({}, base, { sizing: 'risk', riskPct: 2, commissionPerLot: 7 }));
  near(c.trades[0].pnl, -202.8, 1e-6);
  const f = B.runBacktest(ohlc(rows), strat, Object.assign({}, base, { sizing: 'fixed', fixedLots: 0.5 }));
  near(f.trades[0].pnl, -250, 1e-6);
  const rb = BK.runBrokerBacktest(withT(ohlc(rows)), strat, Object.assign({}, brokerSet, { sizing: 'risk', riskPct: 2, commissionPerLot: 7 }), { spec: brokerSpec });
  near(rb.trades[0].pnl, -202.8, 1e-6);
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
test('Ma propre amélioration : ET, OU, remplacement, sorties, stop-loss', () => {
  const rg = D.periodRange('1y', new Date('2025-06-30'));
  const bars = D.generateSynthetic('EUR/USD', rg.fetchStart, rg.end);
  const set = Object.assign({}, base, { startIndex: D.indexFrom(bars, rg.start) });
  const macd = P.list.find((p) => p.id === 'macd');
  const txt = 'Acheter seulement si le RSI 14 est au-dessus de 50. Vendre dans le cas inverse.';
  const and = E.customSuggestion(bars, macd, set, txt, 'and');
  const sA = and.apply({ strat: macd, settings: set }).strat;
  eq(sA.longEntry, 'CROSS_UP(MACD(12,26,9), MACD_SIGNAL(12,26,9)) AND RSI(14) > 50'); eq(sA.shortEntry, 'CROSS_DOWN(MACD(12,26,9), MACD_SIGNAL(12,26,9)) AND RSI(14) < 50');
  near(and.stats.returnPct, E.run(bars, sA, set).returnPct, 1e-9); if (!and.validation) throw new Error('pas de contrôle');
  const or = E.customSuggestion(bars, macd, set, 'Acheter quand le RSI sort de la zone de survente', 'or').apply({ strat: macd, settings: set }).strat;
  eq(or.longEntry, 'CROSS_UP(MACD(12,26,9), MACD_SIGNAL(12,26,9)) OR CROSS_UP(RSI(14), 30)'); eq(or.shortEntry, macd.shortEntry);
  const rep = E.customSuggestion(bars, macd, set, 'Acheter quand la moyenne mobile 20 passe au-dessus de la moyenne mobile 50', 'replace').apply({ strat: macd, settings: set }).strat;
  eq(rep.longEntry, 'CROSS_UP(SMA(20), SMA(50))');
  const ex = E.customSuggestion(bars, macd, set, "Sortir de l'achat quand le RSI dépasse 70. Stop loss 40 pips, take profit 90 pips", 'and').apply({ strat: macd, settings: set }).strat;
  eq(ex.longExit, 'RSI(14) > 70'); eq(ex.stopLossPips, 40); eq(ex.takeProfitPips, 90);
  const rsi = P.list.find((p) => p.id === 'rsi');
  eq(E.customSuggestion(bars, rsi, set, "Sortir de l'achat quand le prix passe sous la moyenne mobile 20", 'and').apply({ strat: rsi, settings: set }).strat.longExit, 'RSI(14) > 60 OR CROSS_DOWN(CLOSE, SMA(20))');
  const longOnly = Object.assign({}, macd, { shortEntry: '', shortExit: '' });
  const ign = E.customSuggestion(bars, longOnly, set, 'Vendre seulement si le RSI est en dessous de 50', 'and');
  if (!ign.error || !/ne prend pas de ventes/.test(ign.error)) throw new Error('vente ignorée non signalée : ' + JSON.stringify(ign.error));
  if (!E.customSuggestion(bars, macd, set, 'la lune est pleine', 'and').error) throw new Error('texte incompris accepté');
  const c = E.combine(macd, set, [and, { group: 'Stop-loss', apply: ({ strat, settings }) => ({ strat: Object.assign({}, strat, { stopLossPips: 10 }), settings }) }]);
  eq(c.strat.stopLossPips, 10); eq(c.strat.longEntry, sA.longEntry);
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

test('Courtier : spread trop large à minuit -> ordre reporté (comme l\'EA), ou non exécuté', () => {
  const D1 = [0, 1, 2].map((i) => ({ date: '2024-01-0' + (i + 1), t: Date.UTC(2024, 0, 1 + i) / 1000, open: 1.1, high: 1.1, low: 1.1, close: 1.1, spread: 10 }));
  const sub = (spreads) => spreads.map((x, k) => ({ t: D1[2].t + k * 900, open: 1.1 + k * 0.0001, high: 1.1 + k * 0.0001, low: 1.1 + k * 0.0001, close: 1.1 + k * 0.0001, spread: x }));
  const spec = Object.assign({}, idealSpec, { volumeMin: 0.01, volumeStep: 0.01 });
  const set = { capital: 10000, leverage: 100, sizing: 'fixed', fixedLots: 1, maxLots: 5, maxSpreadPips: 5, startIndex: 1 };
  const a = BK.runBrokerBacktest(D1, { longEntry: 'CLOSE > 0' }, set, { spec, sub: sub([250, 120, 12, 11]) });
  eq(a.diag.spreadDelayed, 1); near(a.trades[0].entryPrice, 1.1002 + 0.00012, 1e-12); // 3e bougie M15 : prix 1,1002 + spread 1,2 pip
  const b = BK.runBrokerBacktest(D1, { longEntry: 'CLOSE > 0' }, set, { spec, sub: sub([250, 120, 90, 80]) });
  eq(b.trades.length, 0); eq(b.diag.spreadMissed, 1);
});

test('Courtier : spread réel, fixe ou réel + marge', () => {
  const bars = [0, 1, 2, 3, 4].map((i) => ({ date: '2024-01-0' + (i + 1), t: 1704067200 + i * 86400, open: 1.1, high: 1.1, low: 1.1, close: 1.1, spread: 20 }));
  const spec = { digits: 5, point: 0.00001, contract: 100000, volumeMin: 0.01, volumeStep: 0.01, volumeMax: 100, swapMode: 0 };
  const run = (mode, pips) => BK.runBrokerBacktest(bars, { longEntry: 'CLOSE > 0' }, { capital: 10000, leverage: 100, sizing: 'fixed', fixedLots: 1, maxLots: 10, maxSpreadPips: 0, startIndex: 1, spreadMode: mode, spreadPips: pips }, { spec }).stats.netProfit;
  near(run(undefined, 5), -20, 1e-6); // réel : 2 pips × 10 $
  near(run('fixed', 5), -50, 1e-6);
  near(run('add', 1), -30, 1e-6);
});
console.log('Expert Advisor MT5');
test('EA généré pour chaque modèle : paramètres repris de la stratégie', () => {
  for (const p of P.list) {
    const r = MQ.generate(p, { pair: 'EUR/USD', leverage: 20, exposurePct: 50, sizing: 'risk', riskPct: 2, maxLots: 3 });
    if (!/^Forexia_[A-Za-z0-9_]+\.mq5$/.test(r.fileName)) throw new Error('nom de fichier ' + r.fileName);
    for (const needle of ['void OnTick()', 'int OnInit()', 'FxSignals(o, h, l, c, tm, n, iTime(_Symbol, InpTimeframe, 0), le, lx, se, sx)', 'InpSizing = FX_SIZING_RISK', 'InpLeverage = 20',
      'InpExposurePct = 50', 'InpRiskPct = 2', 'InpMaxLots = 3', 'InpStopLossPips = ' + (p.stopLossPips || 0), 'FX_PAIR "EURUSD"']) {
      if (!r.code.includes(needle)) throw new Error(p.id + ' : « ' + needle + ' » absent');
    }
    eq(r.code.includes('InpAllowShort = ' + (p.shortEntry ? 'true' : 'false')), true);
  }
});
test('EA relu : stratégie, réglages et période retrouvés à l\'identique', () => {
  for (const p of P.list.concat([E.adaptToStyle(P.list[5], 'scalping'), FR.randomStrategy()])) {
    const s = Object.assign({}, p, { name: 'Zied3-EURUSD "amélioré" (améliorée)' });
    const opts = { pair: 'EUR/USD', leverage: 100, exposurePct: 80, periodLabel: 'du 17/11/2025 au 13/11/2026', sizing: 'risk', riskPct: 2, maxLots: 3,
      maxSpreadPips: 4, timeframe: 'PERIOD_H1', stats: { returnPct: 65.61, trades: 17, maxDrawdownPct: 33.82 } };
    const code = '\ufeff' + MQ.generate(s, opts).code.replace(/\n/g, '\r\n'); // fichier tel que téléchargé
    const r = MQ.parseEA(code);
    for (const k of ['name', 'frenchText', 'longEntry', 'longExit', 'shortEntry', 'shortExit', 'stopLossPips', 'takeProfitPips']) eq(r.strategy[k] || '', s[k] || '', p.id + '.' + k);
    eq(r.config.pair, 'EUR/USD'); eq(r.config.leverage, 100); eq(r.config.exposurePct, 80); eq(r.config.period, 'custom');
    eq(r.config.dateFrom, '2025-11-17'); eq(r.config.dateTo, '2026-11-13'); eq(r.config.timeframe, 'H1'); eq(r.config.resultPct, 65.61);
    eq(r.config.broker.sizing, 'risk'); eq(r.config.broker.risk, 2); eq(r.config.broker.maxLots, 3); eq(r.config.broker.maxSpread, 4);
  }
  eq(MQ.parseEA(MQ.generate(P.list[0], { pair: 'GBP/USD', periodLabel: '1 an' }).code).config.period, '1y');
  eq(MQ.parseEA('// un autre EA\nvoid OnTick() {}'), null);
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
  test('EA 1.2 : gestion des trades et calendrier relus depuis le .mq5', () => {
  const st = { name: 'T12', longEntry: 'CLOSE > SMA(CLOSE, 20)', longExit: 'CLOSE < SMA(CLOSE, 20)', stopAtr: 2, atrPeriod: 10, trailPips: 15, breakevenAtr: 1, maxBars: 12, pauseLosses: 3, pauseBars: 5 };
  const ea = MQ.generate(st, { pair: 'EUR/USD', leverage: 10, exposurePct: 50, news: { enabled: true, mode: 'close', before: 45, after: 15 } });
  for (const k of ['input double InpStopAtr = 2;', 'input int InpMaxBars = 12;', 'input bool InpNewsFilter = true;', 'input ENUM_FX_NEWS InpNewsMode = FX_NEWS_CLOSE;', 'input string InpNewsCurrencies = "EUR,USD";', 'CalendarValueHistory', 'Forexia\\\\calendar.csv', 'void OnTradeTransaction'])
    if (!ea.code.includes(k)) throw new Error('absent : ' + k);
  const back = MQ.parseEA(ea.code);
  for (const k of ['stopAtr', 'atrPeriod', 'trailPips', 'breakevenAtr', 'maxBars', 'pauseLosses', 'pauseBars']) eq(back.strategy[k], st[k], k);
  eq(back.config.news.mode, 'close'); eq(back.config.news.before, 45); eq(back.config.news.currencies, 'EUR,USD');
});
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
