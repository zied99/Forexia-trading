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
for (const f of ['indicators', 'expr', 'backtest', 'data', 'presets', 'french', 'enhancer', 'mql5']) require(path.join(__dirname, '..', 'js', f + '.js'));
const { rules: R, data: D, presets: P, french: FR, enhancer: E, mql5: M } = globalThis.Forexia;

try { execFileSync('g++', ['--version'], { stdio: 'ignore' }); } catch (e) { console.log('g++ absent : vérification MQL5 ignorée.'); process.exit(0); }

const SHIM = `
#include <vector>
#include <cmath>
#include <cfloat>
#include <cstdio>
#include <algorithm>
typedef std::vector<double> DArr;
#define EMPTY_VALUE DBL_MAX
static int ArraySize(const DArr &a) { return (int)a.size(); }
static void ArrayResize(DArr &a, int n) { a.resize(n); }
static void ArrayInitialize(DArr &a, double v) { std::fill(a.begin(), a.end(), v); }
static void ArrayCopy(DArr &d, const DArr &s) { d = s; }
static bool MathIsValidNumber(double x) { return std::isfinite(x); }
static double MathAbs(double x) { return std::fabs(x); }
static double MathSqrt(double x) { return std::sqrt(x); }
static double MathMax(double a, double b) { return a > b ? a : b; }
`;

function toCpp(mql) {
  return mql
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
  DArr O(N), H(N), L(N), C(N);
  for (int i = 0; i < N; i++) if (scanf("%lf %lf %lf %lf", &O[i], &H[i], &L[i], &C[i]) != 4) return 1;
  for (int t = 2; t <= N; t++) {
    DArr o(O.begin(), O.begin() + t), h(H.begin(), H.begin() + t), l(L.begin(), L.begin() + t), c(C.begin(), C.begin() + t);
    bool le = false, lx = false, se = false, sx = false;
    FxSignals(o, h, l, c, t, le, lx, se, sx);
    printf("%d%d%d%d\\n", le, lx, se, sx);
  }
  return 0;
}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fxmql-'));
  const src = path.join(dir, 'ea.cpp'), bin = path.join(dir, 'ea');
  fs.writeFileSync(src, SHIM + toCpp(calc) + main);
  try { execFileSync('g++', ['-O2', '-w', '-o', bin, src], { stdio: 'pipe' }); }
  catch (e) { throw new Error('compilation C++ : ' + e.stderr.toString().split('\n').slice(0, 15).join('\n')); }
  const input = bars.length + '\n' + bars.map((b) => [b.open, b.high, b.low, b.close].map((v) => v.toPrecision(17)).join(' ')).join('\n');
  const out = execFileSync(bin, { input: input, maxBuffer: 1 << 26 }).toString().trim().split('\n');
  fs.rmSync(dir, { recursive: true, force: true });
  // Référence JavaScript : même calcul sur chaque début d'historique (comme l'EA en direct).
  let mismatches = 0, active = 0;
  const keys = ['longEntry', 'longExit', 'shortEntry', 'shortExit'];
  for (let t = 2; t <= bars.length; t++) {
    if (t % 7 && t !== bars.length) continue; // échantillon : 1 bougie sur 7 (le moteur JS est plus lent)
    const ctx = R.makeContext(bars.slice(0, t));
    const js = keys.map((k) => (R.evaluateRule(strategy[k] || '', ctx)[t - 1] ? 1 : 0)).join('');
    if (js.includes('1')) active++;
    if (js !== out[t - 2]) { if (mismatches < 3) console.log('    bougie ' + t + ' : JS ' + js + ' / MQL5 ' + out[t - 2]); mismatches++; }
  }
  if (mismatches) throw new Error(label + ' : ' + mismatches + ' signaux différents');
  return active;
}

const rg = D.periodRange('1y', new Date('2025-06-30'));
const bars = D.generateSynthetic('EUR/USD', rg.fetchStart, rg.end).slice(-420);
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
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fxrep-'));
  fs.writeFileSync(path.join(dir, 'r.cpp'), shim + body + '\nint main() { OnTester(); puts(OUT.c_str()); return 0; }\n');
  try { execFileSync('g++', ['-w', '-o', path.join(dir, 'r'), path.join(dir, 'r.cpp')], { stdio: 'pipe' }); }
  catch (e) { throw new Error('compilation : ' + e.stderr.toString().split('\n').slice(0, 10).join('\n')); }
  const out = execFileSync(path.join(dir, 'r')).toString();
  fs.rmSync(dir, { recursive: true, force: true });
  const j = JSON.parse(out);
  if (j.trades !== 25 || j.deals.length !== 2 || j.deals[0].reason !== 4 || j.symbol !== 'GBPUSD') throw new Error('contenu inattendu : ' + out);
}

let failed = 0;
try { checkReport(); console.log('  ok  Rapport de test (OnTester) : JSON valide'); }
catch (e) { failed++; console.log('  ÉCHEC Rapport de test (OnTester)\n       ' + e.message); }
console.log('Vérification de l\'EA MQL5 (compilé en C++) contre le moteur JavaScript');
for (const [label, s] of cases) {
  try { const a = check(label, s, bars); console.log('  ok  ' + label + ' (' + a + ' bougies avec signal)'); }
  catch (e) { failed++; console.log('  ÉCHEC ' + label + '\n       ' + e.message); }
}
console.log('\n' + (cases.length - failed) + ' réussis, ' + failed + ' échoués');
process.exit(failed ? 1 : 0);
