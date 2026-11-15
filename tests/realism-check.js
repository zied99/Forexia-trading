/* Mesure le réalisme de Forexia sur de vraies bougies (par exemple un export MT5).
 *
 * Compare, pour 200 stratégies avec stop-loss, le backtest sur les vraies bougies avec :
 *   - les mêmes données réduites à un prix par bougie (comme les cours BCE) ;
 *   - ces données avec mèches estimées (option par défaut de Forexia).
 *
 * Usage : node tests/realism-check.js chemin/vers/bougies.csv [paire]
 * Exemple : node tests/realism-check.js GBPUSD_D1.csv GBP/USD */
'use strict';
const fs = require('fs'), path = require('path');
for (const f of ['indicators', 'expr', 'backtest', 'data', 'presets', 'french', 'enhancer']) require(path.join(__dirname, '..', 'js', f + '.js'));
const { data: D, backtest: B, presets: P, french: FR, enhancer: E } = globalThis.Forexia;

const file = process.argv[2];
if (!file) { console.log('Usage : node tests/realism-check.js bougies.csv [paire]'); process.exit(1); }
const pair = process.argv[3] || 'EUR/USD';
const real = D.parseCSV(fs.readFileSync(file, 'utf8').replace(/^,/, 'date,'));
if (!D.hasRealRange(real)) { console.log('Ce fichier n\'a pas de vrais plus hauts / plus bas : comparaison impossible.'); process.exit(1); }
const closeOnly = D.barsFromCloses(real.map((b) => ({ date: b.date, close: b.close })));
const estimated = D.estimateWicks(closeOnly);
const tf = D.detectTimeframe(real);

let seed = 11;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const strats = [];
for (const p of P.list) for (const st of ['none', 'scalping', 'short']) strats.push(st === 'none' ? p : E.adaptToStyle(p, st));
while (strats.length < 200) {
  const s = E.adaptToStyle(FR.randomStrategy(rnd), ['scalping', 'short', 'medium'][Math.floor(rnd() * 3)], { rnd });
  if (s.stopLossPips) strats.push(s);
}
// Stops proportionnels à la volatilité de l'unité de temps (les styles sont pensés pour du D1).
let amp = 0;
for (let i = 1; i < real.length; i++) amp += real[i].high - real[i].low;
const pip = B.pipSizeFor(pair), ampPips = amp / (real.length - 1) / pip, scale = Math.max(0.05, ampPips / 90);
for (const s of strats) { s.stopLossPips = Math.max(1, Math.round(s.stopLossPips * scale)); s.takeProfitPips = Math.round(s.takeProfitPips * scale); }

const set = { capital: 10000, leverage: 10, exposurePct: 100, spreadPips: 1, pair: pair, startIndex: Math.min(300, Math.floor(real.length / 3)) };
console.log(path.basename(file) + ' : ' + real.length + ' bougies ' + tf + ', amplitude moyenne ' + ampPips.toFixed(1) + ' pips, ' + strats.length + ' stratégies\n');
function compare(name, bars) {
  let err = 0, errN = 0, sign = 0, k = 0, slR = 0, slM = 0;
  for (const s of strats) {
    const a = B.runBacktest(real, s, set), b = B.runBacktest(bars, s, set);
    if (!a.trades.length) continue;
    k++;
    err += Math.abs(a.stats.returnPct - b.stats.returnPct);
    errN += Math.abs(a.trades.length - b.trades.length) / a.trades.length;
    if (Math.sign(a.stats.returnPct) === Math.sign(b.stats.returnPct)) sign++;
    slR += a.trades.filter((t) => t.reason === 'Stop-loss').length;
    slM += b.trades.filter((t) => t.reason === 'Stop-loss').length;
  }
  console.log(name.padEnd(30) + ' écart de rendement ' + (err / k).toFixed(1).padStart(5) + ' pts | écart du nombre de trades ' +
    (100 * errN / k).toFixed(0).padStart(3) + ' % | même sens (gain/perte) ' + (100 * sign / k).toFixed(0) + ' % | stops touchés ' + slM + ' (réel ' + slR + ')');
}
compare('Un prix par bougie (type BCE)', closeOnly);
compare('Avec mèches estimées', estimated);
