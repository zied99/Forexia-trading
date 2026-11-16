/* Vérifie que le calcul des signaux de l'EA MQL5 généré donne exactement les mêmes
 * signaux que le moteur de backtest JavaScript.
 *
 * Le bloc FX-CALC du fichier .mq5 est adapté en C++ (les tableaux MQL5 deviennent des
 * std::vector), compilé avec g++, puis exécuté bougie par bougie.
 * Usage : node tests/mql5-check.js   (nécessite g++ ; sinon le test est ignoré) */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
for (const f of ['indicators', 'expr', 'trade', 'backtest', 'data', 'presets', 'french', 'enhancer', 'mql5']) require(path.join(__dirname, '..', 'js', f + '.js'));
const { rules: R, data: D, presets: P, french: FR, enhancer: E, mql5: M } = globalThis.Forexia;

try { execFileSync('g++', ['--version'], { stdio: 'ignore' }); } catch (e) { console.log('g++ absent : vérification MQL5 ignorée.'); process.exit(0); }

const SHIM = `
#include <vector>
#include <cmath>
#include <cfloat>
#include <cstdio>
#include <algorithm>
#include <ctime>
typedef std::vector<double> DArr;
typedef long long datetime;
typedef std::vector<datetime> TArr;
typedef std::vector<int> IArr;
#define EMPTY_VALUE DBL_MAX
template <class T> static int ArraySize(const std::vector<T> &a) { return (int)a.size(); }
template <class T> static void ArrayResize(std::vector<T> &a, int n) { a.resize(n); }
static double MathFloor(double x) { return std::floor(x); }
static double MathMin(double a, double b) { return a < b ? a : b; }
struct MqlDateTime { int year, mon, day, hour, min, sec, day_of_week, day_of_year; };
static void TimeToStruct(datetime t, MqlDateTime &d) {
  time_t tt = (time_t)t; struct tm g; gmtime_r(&tt, &g);
  d.year = g.tm_year + 1900; d.mon = g.tm_mon + 1; d.day = g.tm_mday; d.hour = g.tm_hour; d.min = g.tm_min; d.sec = g.tm_sec; d.day_of_week = g.tm_wday; d.day_of_year = g.tm_yday;
}
static void ArrayInitialize(DArr &a, double v) { std::fill(a.begin(), a.end(), v); }
static void ArrayCopy(DArr &d, const DArr &s) { d = s; }
static bool MathIsValidNumber(double x) { return std::isfinite(x); }
static double MathAbs(double x) { return std::fabs(x); }
static double MathSqrt(double x) { return std::sqrt(x); }
static double MathMax(double a, double b) { return a > b ? a : b; }
`;

function toCpp(mql) {
  return mql
    .replace(/const datetime &(\w+)\[\]/g, 'const TArr &$1')
    .replace(/datetime &(\w+)\[\]/g, 'TArr &$1')
    .replace(/datetime (\w+)\[\];/g, 'TArr $1;')
    .replace(/const int &(\w+)\[\]/g, 'const IArr &$1')
    .replace(/int &(\w+)\[\]/g, 'IArr &$1')
    .replace(/int (\w+)\[\];/g, 'IArr $1;')
    .replace(/const double &(\w+)\[\]/g, 'const DArr &$1')
    .replace(/double &(\w+)\[\]/g, 'DArr &$1')
    .replace(/double (\w+)\[\];/g, 'DArr $1;');
}

function check(label, strategy, bars) {
  const code = M.generate(strategy, { pair: 'EUR/USD', leverage: 10, exposurePct: 100, sizing: 'backtest' }).code;
  const calc = code.split('//--- FX-CALC-BEGIN')[1].split('//--- FX-CALC-END')[0];
  const main = `
int main() {
  int N; if (scanf("%d", &N) != 1) return 1;
  DArr O(N), H(N), L(N), C(N); TArr T(N);
  for (int i = 0; i < N; i++) if (scanf("%lld %lf %lf %lf %lf", &T[i], &O[i], &H[i], &L[i], &C[i]) != 5) return 1;
  for (int t = 2; t <= N; t++) {
    DArr o(O.begin(), O.begin() + t), h(H.begin(), H.begin() + t), l(L.begin(), L.begin() + t), c(C.begin(), C.begin() + t);
    TArr tm(T.begin(), T.begin() + t);
    datetime tnext = t < N ? T[t] : 0;
    bool le = false, lx = false, se = false, sx = false;
    FxSignals(o, h, l, c, tm, t, tnext, le, lx, se, sx);
    printf("%d%d%d%d\\n", le, lx, se, sx);
  }
  return 0;
}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fxmql-'));
  const src = path.join(dir, 'ea.cpp'), bin = path.join(dir, 'ea');
  fs.writeFileSync(src, SHIM + toCpp(calc) + main);
  try { execFileSync('g++', ['-O2', '-w', '-o', bin, src], { stdio: 'pipe' }); }
  catch (e) { throw new Error('compilation C++ : ' + e.stderr.toString().split('\n').slice(0, 15).join('\n')); }
  const input = bars.length + '\n' + bars.map((b) => [b.t].concat([b.open, b.high, b.low, b.close].map((v) => v.toPrecision(17))).join(' ')).join('\n');
  const out = execFileSync(bin, { input: input, maxBuffer: 1 << 26 }).toString().trim().split('\n');
  fs.rmSync(dir, { recursive: true, force: true });
  // Référence JavaScript : même calcul sur chaque début d'historique (comme l'EA en direct).
  let mismatches = 0, active = 0;
  const keys = ['longEntry', 'longExit', 'shortEntry', 'shortExit'];
  for (let t = 2; t <= bars.length; t++) {
    if (t % 7 && t !== bars.length) continue; // échantillon : 1 bougie sur 7 (le moteur JS est plus lent)
    const ctx = R.makeContext(bars.slice(0, t), { nextTime: t < bars.length ? bars[t].t : null });
    const js = keys.map((k) => (R.evaluateRule(strategy[k] || '', ctx)[t - 1] ? 1 : 0)).join('');
    if (js.includes('1')) active++;
    if (js !== out[t - 2]) { if (mismatches < 3) console.log('    bougie ' + t + ' : JS ' + js + ' / MQL5 ' + out[t - 2]); mismatches++; }
  }
  if (mismatches) throw new Error(label + ' : ' + mismatches + ' signaux différents');
  return active;
}

const rg = D.periodRange('1y', new Date('2025-06-30'));
const bars = D.generateSynthetic('EUR/USD', rg.fetchStart, rg.end).slice(-420).map((b) => Object.assign({ t: Date.parse(b.date + 'T00:00:00Z') / 1000 }, b));
// bougies H1 (avec mèches, week-ends compris) pour les règles multi-unités de temps et horaires
const hbars = [];
{ let p = 1.1, s2 = 3; const rnd = () => { s2 = (s2 * 1103515245 + 12345) % 2147483648; return s2 / 2147483648; };
  for (let i = 0; i < 1100; i++) { const t = 1704067200 + i * 3600, o = p; p = p * (1 + (rnd() - 0.5) * 0.004 + Math.sin(i / 60) * 0.0004);
    hbars.push({ t: t, date: new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' '), open: o, high: Math.max(o, p) + rnd() * 0.001, low: Math.min(o, p) - rnd() * 0.001, close: p }); } }
const cases = [];
for (const p of P.list) cases.push([p.name, p]);
for (const st of ['scalping', 'long']) for (const p of P.list) cases.push([p.name + ' · ' + st, E.adaptToStyle(p, st)]);
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
for (let i = 0; i < 6; i++) { const s = FR.randomStrategy(rnd); cases.push([s.name, s]); }
cases.push(['Règles avancées', {
  longEntry: '(SMA(RSI(14), 9) > 50 OR CCI(20) < -100) AND NOT CLOSE < LOWEST(LOW, 20) AND (CLOSE - SMA(20)) / ATR(14) > -1',
  longExit: 'WILLR(14) > -20 OR MOM(10) < 0 OR ROC(5) < -0.5',
  shortEntry: 'CROSS_DOWN(STOCH_K(9,3,3), STOCH_D(9,3,3)) AND CLOSE < BB_MIDDLE(30,2.5) AND HIGH < PREV(HIGHEST(HIGH, 10), 1)',
  shortExit: 'CROSS_UP(MACD_HIST(5,35,5), 0) OR CLOSE > BB_UPPER(20,2)',
}]);

// Rapport OnTester : le JSON écrit par l'EA doit être valide.
function checkReport() {
  const code = M.generate(P.list[0], { pair: 'GBP/USD' }).code;
  const lines = code.split('\n');
  const a = lines.findIndex((l) => l.startsWith('double OnTester()'));
  let b = a + 1; while (lines[b] !== '  }') b++;
  const body = lines.slice(a, b + 1).join('\n').replace(/\(first \? "" : ","\)/g, 'string(first ? "" : ",")');
  const shim = `
#include <string>
#include <cstdio>
typedef std::string string; typedef unsigned long ulong; typedef long datetime;
#define FX_REPORT "x"
enum { FILE_WRITE = 1, FILE_TXT = 2, FILE_ANSI = 4, FILE_COMMON = 8, INVALID_HANDLE = -1 };
enum { STAT_INITIAL_DEPOSIT, STAT_PROFIT, STAT_TRADES, STAT_PROFIT_TRADES, STAT_PROFIT_FACTOR, STAT_EQUITY_DDREL_PERCENT, STAT_SHARPE_RATIO };
enum { DEAL_ENTRY, DEAL_TYPE, DEAL_TIME, DEAL_REASON }; enum { DEAL_PROFIT, DEAL_SWAP, DEAL_COMMISSION, DEAL_VOLUME, DEAL_PRICE };
enum { DEAL_ENTRY_IN, DEAL_ENTRY_OUT, DEAL_ENTRY_INOUT }; enum { TIME_DATE = 1, TIME_MINUTES = 2 };
static double TesterStatistics(int k) { double v[] = { 100, 110.81, 25, 6, 1.44, 46.27, 0.82 }; return v[k]; }
static int FileOpen(const char *, int) { return 1; }
static string OUT; static void FileWriteString(int, const string &s) { OUT = s; } static void FileClose(int) {}
static string DoubleToString(double v, int d) { char b[64]; snprintf(b, 64, "%.*f", d, v); return b; }
static string IntegerToString(long v) { return std::to_string(v); }
static string _Symbol = "GBPUSD"; static int _Digits = 5; static int InpTimeframe = 0;
static string EnumToString(int) { return "PERIOD_D1"; }
static bool HistorySelect(long, long) { return true; } static long TimeCurrent() { return 0; }
static int HistoryDealsTotal() { return 4; } static ulong HistoryDealGetTicket(int i) { return i + 1; }
static long HistoryDealGetInteger(ulong t, int p) { if (p == DEAL_ENTRY) return t % 2 ? DEAL_ENTRY_IN : DEAL_ENTRY_OUT; if (p == DEAL_REASON) return 4; return 1; }
static double HistoryDealGetDouble(ulong, int p) { return p == DEAL_PRICE ? 1.27123 : -12.5; }
static string TimeToString(datetime, int) { return "2025.01.02 00:00"; }
static void PrintFormat(const char *, ...) {} static int GetLastError() { return 0; }
static int g_cntSignals = 12, g_cntSpreadDelayed = 9, g_cntSpreadMissed = 3, g_cntLots = 0, g_cntFailed = 0, g_cntPaused = 2, g_cntNews = 1;
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fxrep-'));
  fs.writeFileSync(path.join(dir, 'r.cpp'), shim + body + '\nint main() { OnTester(); puts(OUT.c_str()); return 0; }\n');
  try { execFileSync('g++', ['-w', '-o', path.join(dir, 'r'), path.join(dir, 'r.cpp')], { stdio: 'pipe' }); }
  catch (e) { throw new Error('compilation : ' + e.stderr.toString().split('\n').slice(0, 10).join('\n')); }
  const out = execFileSync(path.join(dir, 'r')).toString();
  fs.rmSync(dir, { recursive: true, force: true });
  const j = JSON.parse(out);
  if (j.trades !== 25 || j.deals.length !== 4 || j.deals[1].entry !== 1 || j.diag.spreadMissed !== 3 || j.deals[0].reason !== 4 || j.symbol !== 'GBPUSD') throw new Error('contenu inattendu : ' + out);
}

const cases12 = [
  ['1.2 : ADX, DMI, SAR, SuperTrend', { longEntry: 'ADX(14) > 20 AND PLUS_DI(14) > MINUS_DI(14) AND CLOSE > PSAR(0.02,0.2)', longExit: 'CROSS_DOWN(SUPERTREND_DIR(10,3), 0)',
    shortEntry: 'CROSS_DOWN(CLOSE, SUPERTREND(7,2.5)) AND ADX(10) > 15', shortExit: 'CLOSE > PSAR()' }],
  ['1.2 : Donchian, Keltner, Ichimoku, pente', { longEntry: 'CROSS_UP(CLOSE, PREV(DONCHIAN_UPPER(20), 1)) AND CLOSE > SENKOU_A(9,26) AND CLOSE > SENKOU_B(52,26)',
    longExit: 'CLOSE < KELTNER_MIDDLE(20,2,10) OR TENKAN(9) < KIJUN(26)', shortEntry: 'CLOSE < KELTNER_LOWER(20,1.5,10) AND SLOPE(EMA(50), 5) < 0', shortExit: 'CLOSE > DONCHIAN_MIDDLE(10)' }],
  ['1.2 : bougies, Heikin-Ashi, divergences', { longEntry: '(BULL_ENGULF OR HAMMER OR BULL_DIV(RSI(14), 10)) AND HA_CLOSE > HA_OPEN', longExit: 'BEAR_ENGULF OR SHOOTING_STAR',
    shortEntry: 'BEAR_DIV(RSI(7), 7) OR (HA_CLOSE < HA_OPEN AND HA_HIGH == HA_OPEN)', shortExit: 'BULL_DIV(STOCH_K(14,3,3), 10)' }],
  ['Repères dessinés : ligne de tendance et niveau', (() => {
    const L = 'LINE(' + bars[150].t + ', ' + bars[150].low + ', ' + bars[300].t + ', ' + bars[300].low + ')';
    const lv = bars[200].close;
    return { longEntry: '(LOW <= ' + L + ' AND CLOSE > ' + L + ') OR CROSS_UP(CLOSE, ' + lv + ')', longExit: 'HIGH >= ' + (lv * 1.02),
      shortEntry: 'CROSS_DOWN(CLOSE, ' + L + ')', shortExit: 'LOW <= ' + (lv * 0.98) };
  })()],
];
const casesH1 = [
  ['1.2 : multi-unités de temps (@H4, @D1) et horaires', { longEntry: 'RSI(14)@H4 > 50 AND (EMA(20) > EMA(50))@H4 AND CLOSE > EMA(10)@D1 AND HOUR >= 7 AND HOUR < 20',
    longExit: 'CROSS_DOWN(MACD(12,26,9)@H4, MACD_SIGNAL(12,26,9)@H4) OR WEEKDAY == 5', shortEntry: 'CLOSE < PIVOT AND CLOSE@D1 < PIVOT_S1@H4 AND ADX(14)@H4 > 20',
    shortExit: 'CLOSE > PIVOT_R1 OR (MINUTE == 0 AND DAY == 15) OR MONTH == 2' }],
  ['1.2 : pivots et SuperTrend en H4', { longEntry: 'CROSS_UP(CLOSE, PIVOT) AND SUPERTREND_DIR(10,3)@H4 > 0', longExit: 'CLOSE > PIVOT_R2 OR CLOSE < PIVOT_S2',
    shortEntry: 'CROSS_DOWN(CLOSE, PIVOT) AND SUPERTREND_DIR(10,3)@H4 < 0', shortExit: 'HIGH@W1 > 1.2' }],
];

let failed = 0;
try { checkReport(); console.log('  ok  Rapport de test (OnTester) : JSON valide'); }
catch (e) { failed++; console.log('  ÉCHEC Rapport de test (OnTester)\n       ' + e.message); }
console.log('Vérification de l\'EA MQL5 (compilé en C++) contre le moteur JavaScript');
for (const [label, s, b] of cases.concat(cases12).concat(casesH1.map((x) => x.concat([hbars])))) {
  try { const a = check(label, s, b || bars); console.log('  ok  ' + label + ' (' + a + ' bougies avec signal)'); }
  catch (e) { failed++; console.log('  ÉCHEC ' + label + '\n       ' + e.message); }
}
const total = cases.length + cases12.length + casesH1.length + 1;
console.log('\n' + (total - failed) + ' réussis, ' + failed + ' échoués');
process.exit(failed ? 1 : 0);
