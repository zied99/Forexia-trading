/* Forexia — génération d'un Expert Advisor MetaTrader 5 (.mq5) à partir d'une stratégie.
 *
 * Les indicateurs sont recalculés dans l'EA avec exactement les mêmes formules que le
 * backtest de la page (et non avec les indicateurs intégrés de MT5, dont certains
 * diffèrent : la ligne de signal du MACD de MT5 est une moyenne simple, par exemple).
 * Le code de calcul est encadré par FX-CALC-BEGIN / FX-CALC-END : les tests le compilent
 * en C++ pour vérifier qu'il donne les mêmes signaux que le moteur JavaScript. */
(function (root) {
  'use strict';
  const F = root.Forexia;

  // ---------- Bibliothèque de calcul (MQL5, compatible C++ après adaptation) ----------
  const CALC_LIB = String.raw`
bool FxOk(const double x) { return x != EMPTY_VALUE && MathIsValidNumber(x); }
bool FxTruthy(const double x) { return FxOk(x) && x != 0.0; }
void FxInit(double &a[], const int n) { ArrayResize(a, n); ArrayInitialize(a, EMPTY_VALUE); }
void FxConst(double &a[], const int n, const double v) { ArrayResize(a, n); ArrayInitialize(a, v); }
int FxFirst(const double &src[])
  {
   int n = ArraySize(src);
   for(int i = 0; i < n; i++) if(FxOk(src[i])) return i;
   return -1;
  }
// op : 0 +, 1 -, 2 *, 3 /, 4 >, 5 <, 6 >=, 7 <=, 8 ==, 9 !=, 10 ET, 11 OU
double FxBin(const int op, const double x, const double y)
  {
   bool ok = FxOk(x) && FxOk(y);
   switch(op)
     {
      case 0: return ok ? x + y : EMPTY_VALUE;
      case 1: return ok ? x - y : EMPTY_VALUE;
      case 2: return ok ? x * y : EMPTY_VALUE;
      case 3: return (ok && y != 0.0) ? x / y : EMPTY_VALUE;
      case 4: return (ok && x > y) ? 1.0 : 0.0;
      case 5: return (ok && x < y) ? 1.0 : 0.0;
      case 6: return (ok && x >= y) ? 1.0 : 0.0;
      case 7: return (ok && x <= y) ? 1.0 : 0.0;
      case 8: return (ok && MathAbs(x - y) < 1e-12) ? 1.0 : 0.0;
      case 9: return (ok && MathAbs(x - y) >= 1e-12) ? 1.0 : 0.0;
      case 10: return (FxTruthy(x) && FxTruthy(y)) ? 1.0 : 0.0;
      case 11: return (FxTruthy(x) || FxTruthy(y)) ? 1.0 : 0.0;
     }
   return EMPTY_VALUE;
  }
void FxSMA(const double &src[], const int p, double &out[])
  {
   int n = ArraySize(src);
   FxInit(out, n);
   double sum = 0.0;
   int count = 0;
   for(int i = 0; i < n; i++)
     {
      double v = src[i];
      if(!FxOk(v)) { sum = 0.0; count = 0; continue; }
      sum += v;
      count++;
      if(count > p) { sum -= src[i - p]; count = p; }
      if(count == p) out[i] = sum / p;
     }
  }
void FxEMA(const double &src[], const int p, double &out[])
  {
   int n = ArraySize(src);
   FxInit(out, n);
   int st = FxFirst(src);
   if(st < 0 || st + p > n) return;
   double k = 2.0 / (p + 1);
   double prev = 0.0;
   for(int i = st; i < st + p; i++) prev += src[i];
   prev /= p;
   out[st + p - 1] = prev;
   for(int i = st + p; i < n; i++)
     {
      double v = src[i];
      if(!FxOk(v)) { out[i] = prev; continue; }
      prev = v * k + prev * (1.0 - k);
      out[i] = prev;
     }
  }
void FxRMA(const double &src[], const int p, double &out[])
  {
   int n = ArraySize(src);
   FxInit(out, n);
   int st = FxFirst(src);
   if(st < 0 || st + p > n) return;
   double prev = 0.0;
   for(int i = st; i < st + p; i++) prev += src[i];
   prev /= p;
   out[st + p - 1] = prev;
   for(int i = st + p; i < n; i++)
     {
      prev = (prev * (p - 1) + src[i]) / p;
      out[i] = prev;
     }
  }
void FxRSI(const double &src[], const int p, double &out[])
  {
   int n = ArraySize(src);
   double g[];
   double ls[];
   FxInit(g, n);
   FxInit(ls, n);
   for(int i = 1; i < n; i++)
     {
      double d = (FxOk(src[i]) && FxOk(src[i - 1])) ? src[i] - src[i - 1] : 0.0;
      g[i] = d > 0.0 ? d : 0.0;
      ls[i] = d < 0.0 ? -d : 0.0;
     }
   double ag[];
   double al[];
   FxRMA(g, p, ag);
   FxRMA(ls, p, al);
   FxInit(out, n);
   for(int i = 0; i < n; i++)
     {
      if(!FxOk(ag[i]) || !FxOk(al[i])) continue;
      if(al[i] == 0.0) out[i] = (ag[i] == 0.0) ? 50.0 : 100.0;
      else out[i] = 100.0 - 100.0 / (1.0 + ag[i] / al[i]);
     }
  }
void FxMACD(const double &c[], const int f, const int s, const int g, double &m[], double &sg[], double &hi[])
  {
   int n = ArraySize(c);
   double ef[];
   double es[];
   FxEMA(c, f, ef);
   FxEMA(c, s, es);
   FxInit(m, n);
   for(int i = 0; i < n; i++) if(FxOk(ef[i]) && FxOk(es[i])) m[i] = ef[i] - es[i];
   FxEMA(m, g, sg);
   FxInit(hi, n);
   for(int i = 0; i < n; i++) if(FxOk(m[i]) && FxOk(sg[i])) hi[i] = m[i] - sg[i];
  }
void FxHighest(const double &src[], const int p, double &out[])
  {
   int n = ArraySize(src);
   FxInit(out, n);
   for(int i = p - 1; i < n; i++)
     {
      double mx = -DBL_MAX;
      bool ok = true;
      for(int j = i - p + 1; j <= i; j++) { if(!FxOk(src[j])) { ok = false; break; } if(src[j] > mx) mx = src[j]; }
      if(ok) out[i] = mx;
     }
  }
void FxLowest(const double &src[], const int p, double &out[])
  {
   int n = ArraySize(src);
   FxInit(out, n);
   for(int i = p - 1; i < n; i++)
     {
      double mn = DBL_MAX;
      bool ok = true;
      for(int j = i - p + 1; j <= i; j++) { if(!FxOk(src[j])) { ok = false; break; } if(src[j] < mn) mn = src[j]; }
      if(ok) out[i] = mn;
     }
  }
void FxStoch(const double &h[], const double &l[], const double &c[], const int kp, const int dp, const int sm, double &k[], double &d[])
  {
   int n = ArraySize(c);
   double hh[];
   double ll[];
   double raw[];
   FxHighest(h, kp, hh);
   FxLowest(l, kp, ll);
   FxInit(raw, n);
   for(int i = 0; i < n; i++)
     {
      if(!FxOk(hh[i]) || !FxOk(ll[i])) continue;
      double range = hh[i] - ll[i];
      raw[i] = (range == 0.0) ? 50.0 : 100.0 * (c[i] - ll[i]) / range;
     }
   if(sm > 1) FxSMA(raw, sm, k);
   else ArrayCopy(k, raw);
   FxSMA(k, dp, d);
  }
void FxBB(const double &c[], const int p, const double mult, double &up[], double &mid[], double &lo[])
  {
   int n = ArraySize(c);
   FxSMA(c, p, mid);
   FxInit(up, n);
   FxInit(lo, n);
   for(int i = 0; i < n; i++)
     {
      if(!FxOk(mid[i])) continue;
      double s = 0.0;
      for(int j = i - p + 1; j <= i; j++) s += (c[j] - mid[i]) * (c[j] - mid[i]);
      double sd = MathSqrt(s / p);
      up[i] = mid[i] + mult * sd;
      lo[i] = mid[i] - mult * sd;
     }
  }
void FxATR(const double &h[], const double &l[], const double &c[], const int p, double &out[])
  {
   int n = ArraySize(c);
   double tr[];
   FxInit(tr, n);
   for(int i = 0; i < n; i++)
     {
      double hl = h[i] - l[i];
      tr[i] = (i == 0) ? hl : MathMax(hl, MathMax(MathAbs(h[i] - c[i - 1]), MathAbs(l[i] - c[i - 1])));
     }
   FxRMA(tr, p, out);
  }
void FxCCI(const double &h[], const double &l[], const double &c[], const int p, double &out[])
  {
   int n = ArraySize(c);
   double tp[];
   double m[];
   FxInit(tp, n);
   for(int i = 0; i < n; i++) tp[i] = (h[i] + l[i] + c[i]) / 3.0;
   FxSMA(tp, p, m);
   FxInit(out, n);
   for(int i = 0; i < n; i++)
     {
      if(!FxOk(m[i])) continue;
      double md = 0.0;
      for(int j = i - p + 1; j <= i; j++) md += MathAbs(tp[j] - m[i]);
      md /= p;
      out[i] = (md == 0.0) ? 0.0 : (tp[i] - m[i]) / (0.015 * md);
     }
  }
void FxWillR(const double &h[], const double &l[], const double &c[], const int p, double &out[])
  {
   int n = ArraySize(c);
   double hh[];
   double ll[];
   FxHighest(h, p, hh);
   FxLowest(l, p, ll);
   FxInit(out, n);
   for(int i = 0; i < n; i++)
     {
      if(!FxOk(hh[i])) continue;
      double r = hh[i] - ll[i];
      out[i] = (r == 0.0) ? -50.0 : -100.0 * (hh[i] - c[i]) / r;
     }
  }
void FxMom(const double &src[], const int p, double &out[])
  {
   int n = ArraySize(src);
   FxInit(out, n);
   for(int i = p; i < n; i++) if(FxOk(src[i]) && FxOk(src[i - p])) out[i] = src[i] - src[i - p];
  }
void FxRoc(const double &src[], const int p, double &out[])
  {
   int n = ArraySize(src);
   FxInit(out, n);
   for(int i = p; i < n; i++) if(FxOk(src[i]) && FxOk(src[i - p]) && src[i - p] != 0.0) out[i] = 100.0 * (src[i] - src[i - p]) / src[i - p];
  }
void FxPrev(const double &src[], const int p, double &out[])
  {
   int n = ArraySize(src);
   FxInit(out, n);
   for(int i = p; i < n; i++) out[i] = src[i - p];
  }
void FxCross(const double &a[], const double &b[], const int dir, double &out[])
  {
   int n = ArraySize(a);
   FxConst(out, n, 0.0);
   for(int i = 1; i < n; i++)
     {
      if(!FxOk(a[i]) || !FxOk(b[i]) || !FxOk(a[i - 1]) || !FxOk(b[i - 1])) continue;
      if(dir > 0) out[i] = (a[i] > b[i] && a[i - 1] <= b[i - 1]) ? 1.0 : 0.0;
      else out[i] = (a[i] < b[i] && a[i - 1] >= b[i - 1]) ? 1.0 : 0.0;
     }
  }
`;

  // ---------- Traduction des règles en MQL5 ----------
  const OPS = { '+': 0, '-': 1, '*': 2, '/': 3, '>': 4, '<': 5, '>=': 6, '<=': 7, '==': 8, '!=': 9, AND: 10, OR: 11 };
  const DEF = { SMA: 20, EMA: 20, RSI: 14, MOM: 10, ROC: 10, HIGHEST: 20, LOWEST: 20, ATR: 14, CCI: 20, WILLR: 14 };
  const SRC_FN = { SMA: 'FxSMA', EMA: 'FxEMA', RSI: 'FxRSI', MOM: 'FxMom', ROC: 'FxRoc', HIGHEST: 'FxHighest', LOWEST: 'FxLowest' };
  const HLC_FN = { ATR: 'FxATR', CCI: 'FxCCI', WILLR: 'FxWillR' };
  const SERIES = { CLOSE: 'c', PRICE: 'c', OPEN: 'o', HIGH: 'h', LOW: 'l' };

  function fmtNum(v) {
    if (!Number.isFinite(v)) throw new Error('nombre invalide');
    const s = String(v);
    return /[.e]/.test(s) ? s : s + '.0';
  }

  function Compiler() {
    const lines = [];
    const cache = new Map();
    let id = 0;
    const newVar = () => 's' + ++id;

    // Valeur constante (nombre, -nombre, calcul entre nombres) ou null.
    function constant(node) {
      if (node.k === 'num') return node.v;
      if (node.k === 'neg') { const v = constant(node.a); return v === null ? null : -v; }
      if (node.k === 'bin' && ['+', '-', '*', '/'].includes(node.op)) {
        const a = constant(node.a), b = constant(node.b);
        if (a === null || b === null) return null;
        return { '+': a + b, '-': a - b, '*': a * b, '/': a / b }[node.op];
      }
      return null;
    }
    function intParam(node, def, fname) {
      if (node === undefined) return def;
      const v = constant(node);
      if (v === null || !Number.isInteger(v) || v < 1 || v > 1000) throw new Error(fname + ' : période invalide');
      return v;
    }
    function numParam(node, def) {
      if (node === undefined) return def;
      const v = constant(node);
      if (v === null) throw new Error('paramètre non constant');
      return v;
    }
    function series(r) { // résultat -> nom de tableau
      if (r.s) return r.s;
      const v = newVar();
      lines.push('   double ' + v + '[];', '   FxConst(' + v + ', n, ' + r.k + ');');
      return v;
    }
    const at = (r) => (r.s ? r.s + '[i]' : r.k);

    function gen(node) {
      const c = constant(node);
      if (c !== null) return { k: fmtNum(c) };
      const key = F.rules.stringify(node);
      if (cache.has(key)) return cache.get(key);
      const r = genUncached(node);
      cache.set(key, r);
      return r;
    }
    function loop(expr) {
      const v = newVar();
      lines.push('   double ' + v + '[];', '   FxInit(' + v + ', n);', '   for(int i = 0; i < n; i++) ' + v + '[i] = ' + expr + ';');
      return { s: v };
    }
    function multi(key, make) { // indicateurs à plusieurs sorties, calculés une fois
      if (!cache.has(key)) cache.set(key, make());
      return cache.get(key);
    }

    function genUncached(node) {
      switch (node.k) {
        case 'series': return { s: SERIES[node.name] };
        case 'neg': { const a = gen(node.a); return loop('(FxOk(' + at(a) + ') ? -' + at(a) + ' : EMPTY_VALUE)'); }
        case 'not': { const a = gen(node.a); return a.s ? loop('(FxTruthy(' + at(a) + ') ? 0.0 : 1.0)') : { k: '(FxTruthy(' + a.k + ') ? 0.0 : 1.0)' }; }
        case 'bin': {
          const a = gen(node.a), b = gen(node.b);
          const e = 'FxBin(' + OPS[node.op] + ', ' + at(a) + ', ' + at(b) + ')';
          return a.s || b.s ? loop(e) : { k: e };
        }
        case 'call': return genCall(node);
      }
      throw new Error('élément non pris en charge');
    }

    function genCall(node) {
      const name = node.name, a = node.args;
      if (SRC_FN[name]) {
        let src = 'c', pNode = a[0];
        if (a.length && constant(a[0]) === null) { src = series(gen(a[0])); pNode = a[1]; }
        const p = intParam(pNode, DEF[name], name), v = newVar();
        lines.push('   double ' + v + '[];', '   ' + SRC_FN[name] + '(' + src + ', ' + p + ', ' + v + ');');
        return { s: v };
      }
      if (HLC_FN[name]) {
        const p = intParam(a[0], DEF[name], name), v = newVar();
        lines.push('   double ' + v + '[];', '   ' + HLC_FN[name] + '(h, l, c, ' + p + ', ' + v + ');');
        return { s: v };
      }
      if (/^MACD/.test(name)) {
        const f = intParam(a[0], 12, 'MACD'), s = intParam(a[1], 26, 'MACD'), g = intParam(a[2], 9, 'MACD');
        const o = multi('MACD:' + [f, s, g], () => {
          const m = newVar(), sg = newVar(), hi = newVar();
          lines.push('   double ' + m + '[];', '   double ' + sg + '[];', '   double ' + hi + '[];',
            '   FxMACD(c, ' + f + ', ' + s + ', ' + g + ', ' + m + ', ' + sg + ', ' + hi + ');');
          return { MACD: m, MACD_SIGNAL: sg, MACD_HIST: hi };
        });
        return { s: o[name] };
      }
      if (/^STOCH_/.test(name)) {
        const k = intParam(a[0], 14, 'STOCH'), d = intParam(a[1], 3, 'STOCH'), sm = intParam(a[2], 3, 'STOCH');
        const o = multi('STOCH:' + [k, d, sm], () => {
          const kv = newVar(), dv = newVar();
          lines.push('   double ' + kv + '[];', '   double ' + dv + '[];', '   FxStoch(h, l, c, ' + k + ', ' + d + ', ' + sm + ', ' + kv + ', ' + dv + ');');
          return { STOCH_K: kv, STOCH_D: dv };
        });
        return { s: o[name] };
      }
      if (/^BB_/.test(name)) {
        const p = intParam(a[0], 20, 'BB'), m = numParam(a[1], 2);
        const o = multi('BB:' + [p, m], () => {
          const up = newVar(), mid = newVar(), lo = newVar();
          lines.push('   double ' + up + '[];', '   double ' + mid + '[];', '   double ' + lo + '[];',
            '   FxBB(c, ' + p + ', ' + fmtNum(m) + ', ' + up + ', ' + mid + ', ' + lo + ');');
          return { BB_UPPER: up, BB_MIDDLE: mid, BB_LOWER: lo };
        });
        return { s: o[name] };
      }
      if (name === 'PREV') {
        const src = series(gen(a[0])), p = intParam(a[1], 1, 'PREV'), v = newVar();
        lines.push('   double ' + v + '[];', '   FxPrev(' + src + ', ' + p + ', ' + v + ');');
        return { s: v };
      }
      if (name === 'CROSS_UP' || name === 'CROSS_DOWN') {
        const x = series(gen(a[0])), y = series(gen(a[1])), v = newVar();
        lines.push('   double ' + v + '[];', '   FxCross(' + x + ', ' + y + ', ' + (name === 'CROSS_UP' ? 1 : -1) + ', ' + v + ');');
        return { s: v };
      }
      throw new Error('fonction ' + name + ' non prise en charge');
    }

    return {
      rule(text, outVar) {
        if (!text || !text.trim()) { lines.push('   ' + outVar + ' = false;'); return; }
        lines.push('   // ' + text.replace(/\s+/g, ' '));
        const r = gen(F.rules.parse(text));
        lines.push('   ' + outVar + ' = ' + (r.s ? 'FxTruthy(' + r.s + '[n - 1])' : 'FxTruthy(' + r.k + ')') + ';');
      },
      lines: lines,
    };
  }

  /** Fonction MQL5 FxSignals(...) qui calcule les 4 signaux sur la dernière bougie close. */
  function signalsFunction(strategy) {
    const comp = Compiler();
    comp.rule(strategy.longEntry, 'le');
    comp.rule(strategy.longExit, 'lx');
    comp.rule(strategy.shortEntry, 'se');
    comp.rule(strategy.shortExit, 'sx');
    return 'void FxSignals(const double &o[], const double &h[], const double &l[], const double &c[], const int n,\n' +
      '               bool &le, bool &lx, bool &se, bool &sx)\n  {\n' + comp.lines.join('\n') + '\n  }\n';
  }

  // ---------- Rapport de test (OnTester) ----------
  const ONTESTER = String.raw`   int fh = FileOpen(FX_REPORT, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(fh == INVALID_HANDLE)
     {
      PrintFormat("Rapport Forexia impossible à écrire (%d)", GetLastError());
      return TesterStatistics(STAT_PROFIT);
     }
   string js = "{";
   js += "\"deposit\":" + DoubleToString(TesterStatistics(STAT_INITIAL_DEPOSIT), 2);
   js += ",\"profit\":" + DoubleToString(TesterStatistics(STAT_PROFIT), 2);
   js += ",\"trades\":" + IntegerToString((int)TesterStatistics(STAT_TRADES));
   js += ",\"profitTrades\":" + IntegerToString((int)TesterStatistics(STAT_PROFIT_TRADES));
   js += ",\"profitFactor\":" + DoubleToString(TesterStatistics(STAT_PROFIT_FACTOR), 4);
   js += ",\"maxDrawdownPct\":" + DoubleToString(TesterStatistics(STAT_EQUITY_DDREL_PERCENT), 2);
   js += ",\"sharpe\":" + DoubleToString(TesterStatistics(STAT_SHARPE_RATIO), 4);
   js += ",\"symbol\":\"" + _Symbol + "\",\"period\":\"" + EnumToString(InpTimeframe) + "\"";
   js += ",\"diag\":{\"signals\":" + IntegerToString(g_cntSignals) + ",\"spreadDelayed\":" + IntegerToString(g_cntSpreadDelayed) +
         ",\"spreadMissed\":" + IntegerToString(g_cntSpreadMissed) + ",\"lotsTooSmall\":" + IntegerToString(g_cntLots) +
         ",\"orderFailed\":" + IntegerToString(g_cntFailed) + "}";
   js += ",\"deals\":[";
   bool first = true;
   if(HistorySelect(0, TimeCurrent()))
     {
      int total = HistoryDealsTotal();
      for(int i = 0; i < total; i++)
        {
         ulong t = HistoryDealGetTicket(i);
         if(t == 0) continue;
         long entry = HistoryDealGetInteger(t, DEAL_ENTRY);
         if(entry != DEAL_ENTRY_IN && entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_INOUT) continue;
         double pnl = HistoryDealGetDouble(t, DEAL_PROFIT) + HistoryDealGetDouble(t, DEAL_SWAP) + HistoryDealGetDouble(t, DEAL_COMMISSION);
         js += (first ? "" : ",") + "{\"time\":\"" + TimeToString((datetime)HistoryDealGetInteger(t, DEAL_TIME), TIME_DATE | TIME_MINUTES) + "\"";
         js += ",\"entry\":" + IntegerToString(entry);
         js += ",\"type\":" + IntegerToString(HistoryDealGetInteger(t, DEAL_TYPE));
         js += ",\"volume\":" + DoubleToString(HistoryDealGetDouble(t, DEAL_VOLUME), 2);
         js += ",\"price\":" + DoubleToString(HistoryDealGetDouble(t, DEAL_PRICE), _Digits);
         js += ",\"profit\":" + DoubleToString(pnl, 2);
         js += ",\"reason\":" + IntegerToString(HistoryDealGetInteger(t, DEAL_REASON)) + "}";
         first = false;
        }
     }
   js += "]}";
   FileWriteString(fh, js);
   FileClose(fh);`;

  // ---------- Fichier .mq5 complet ----------
  function mqlString(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"'; }
  function asciiName(s) {
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Strategie';
  }
  function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  const TIMEFRAMES = ['PERIOD_M1', 'PERIOD_M5', 'PERIOD_M15', 'PERIOD_M30', 'PERIOD_H1', 'PERIOD_H4', 'PERIOD_D1', 'PERIOD_W1'];
  const SIZING = { backtest: 'FX_SIZING_BACKTEST', fixed: 'FX_SIZING_FIXED', risk: 'FX_SIZING_RISK' };

  /**
   * @param strategy {name, longEntry, longExit, shortEntry, shortExit, stopLossPips, takeProfitPips, frenchText, style}
   * @param o        {pair, leverage, exposurePct, capital, periodLabel, stats, timeframe, sizing, fixedLots, riskPct, maxLots, maxSpreadPips}
   */
  function generate(strategy, o) {
    for (const k of ['longEntry', 'longExit', 'shortEntry', 'shortExit']) {
      const err = F.rules.validate(strategy[k]);
      if (err) throw new Error('Règle invalide (' + k + ') : ' + err);
    }
    if (!strategy.longEntry && !strategy.shortEntry) throw new Error('La stratégie n\'a aucune règle d\'entrée.');
    const fn = signalsFunction(strategy);
    const name = strategy.name || 'Stratégie Forexia';
    const pairCode = String(o.pair || '').replace('/', '');
    const baseName = 'Forexia_' + asciiName(name);
    const magic = 100000 + (hash(name + pairCode) % 900000);
    const tf = TIMEFRAMES.includes(o.timeframe) ? o.timeframe : 'PERIOD_D1';
    const st = o.stats;
    const date = new Date().toISOString().slice(0, 10);
    const comment = (txt) => String(txt || '').split('\n').map((l) => '//   ' + l).join('\n');
    const header = [
      '//+------------------------------------------------------------------+',
      '//| ' + name,
      '//| Expert Advisor généré par Forexia le ' + date,
      '//| https://zied99.github.io/Forexia-trading/',
      '//+------------------------------------------------------------------+',
      '// Stratégie :',
      strategy.frenchText ? comment(strategy.frenchText) : '//   (pas de description en français)',
      '// Règles :',
      '//   Entrée achat : ' + (strategy.longEntry || '-'),
      '//   Sortie achat : ' + (strategy.longExit || '-'),
      '//   Entrée vente : ' + (strategy.shortEntry || '-'),
      '//   Sortie vente : ' + (strategy.shortExit || '-'),
      '// Backtest Forexia : ' + (o.pair || '?') + ', levier 1:' + o.leverage + ', exposition ' + o.exposurePct + ' %, ' + (o.periodLabel || '') +
        (st ? ', résultat ' + (st.returnPct >= 0 ? '+' : '') + st.returnPct.toFixed(2) + ' %, ' + st.trades + ' trades, drawdown max -' + st.maxDrawdownPct.toFixed(2) + ' %' : ''),
      '//',
      '// Fonctionnement : à chaque nouvelle bougie de l\'unité de temps choisie, l\'EA calcule les',
      '// signaux sur la bougie qui vient de se fermer, puis ferme / ouvre la position au marché,',
      '// comme le backtest (signal à la clôture, exécution à l\'ouverture suivante).',
      '// Testez-le d\'abord dans le testeur de stratégie de MT5, puis sur un compte DÉMO.',
      '//+------------------------------------------------------------------+',
    ].join('\n');

    const code = header + `
#property copyright "Forexia"
#property link      "https://zied99.github.io/Forexia-trading/"
#property version   "1.00"
#property description ${mqlString(('Forexia : ' + name).slice(0, 200))}

#include <Trade\\Trade.mqh>

enum ENUM_FX_SIZING
  {
   FX_SIZING_BACKTEST = 0, // Comme le backtest (capital x exposition x levier)
   FX_SIZING_FIXED = 1,    // Lots fixes
   FX_SIZING_RISK = 2      // Pourcentage du capital risqué par trade (avec stop-loss)
  };

input group "Stratégie"
input ENUM_TIMEFRAMES InpTimeframe = ${tf}; // Unité de temps des bougies (backtest : D1)
input double InpStopLossPips = ${strategy.stopLossPips || 0}; // Stop-loss en pips (0 = aucun)
input double InpTakeProfitPips = ${strategy.takeProfitPips || 0}; // Take-profit en pips (0 = aucun)
input bool InpAllowLong = ${strategy.longEntry ? 'true' : 'false'}; // Autoriser les achats
input bool InpAllowShort = ${strategy.shortEntry ? 'true' : 'false'}; // Autoriser les ventes

input group "Taille des positions"
input ENUM_FX_SIZING InpSizing = ${SIZING[o.sizing] || 'FX_SIZING_FIXED'}; // Mode de calcul de la taille
input double InpLeverage = ${o.leverage || 10}; // Levier (mode « comme le backtest »)
input double InpExposurePct = ${o.exposurePct || 100}; // Exposition en % (mode « comme le backtest »)
input double InpFixedLots = ${o.fixedLots || 0.01}; // Lots (mode lots fixes)
input double InpRiskPct = ${o.riskPct || 1}; // Risque par trade en % (mode risque)
input double InpMaxLots = ${o.maxLots || 1}; // Plafond de lots par position (sécurité)

input group "Sécurité"
input double InpMaxSpreadPips = ${o.maxSpreadPips ?? 5}; // Spread maximum pour ouvrir (pips, 0 = sans limite)
input bool InpTradeOnStart = false; // Agir sur la dernière bougie close dès le lancement
input int InpHistoryBars = 1000; // Nombre de bougies pour calculer les indicateurs
input ulong InpMagic = ${magic}; // Identifiant des ordres de cet EA
input bool InpAllowRealAccount = false; // Autoriser le trading sur un compte RÉEL

#define FX_NAME ${mqlString(name)}
#define FX_PAIR ${mqlString(pairCode)}
#define FX_COMMENT ${mqlString(('Forexia ' + asciiName(name)).slice(0, 31))}
#define FX_REPORT "Forexia\\\\${baseName}.json"

CTrade   g_trade;
datetime g_lastBar = 0;
string   g_last = "aucun calcul pour l'instant";
int      g_pendDir = 0;          // ouverture en attente pendant la bougie en cours (1 achat, -1 vente)
bool     g_pendDelayed = false;
int      g_cntSignals = 0, g_cntSpreadDelayed = 0, g_cntSpreadMissed = 0, g_cntLots = 0, g_cntFailed = 0;

//--- FX-CALC-BEGIN
${CALC_LIB}
${fn}//--- FX-CALC-END

double FxPip()
  {
   int d = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   return (d == 3 || d == 5) ? 10.0 * _Point : _Point;
  }

// Sens de la position ouverte par cet EA sur ce symbole : 1 achat, -1 vente, 0 aucune.
int FxPositionDir()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol || (ulong)PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      return (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? 1 : -1;
     }
   return 0;
  }

bool FxCloseAll()
  {
   bool ok = true;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol || (ulong)PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if(!g_trade.PositionClose(ticket))
        {
         PrintFormat("Échec de la fermeture de la position %I64u : %u %s", ticket, g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription());
         ok = false;
        }
      else PrintFormat("Position %I64u fermée (signal de sortie)", ticket);
     }
   return ok;
  }

double FxLots(const double price)
  {
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double lots = InpFixedLots;
   if(InpSizing == FX_SIZING_BACKTEST && tickValue > 0.0 && tickSize > 0.0)
     {
      // Valeur d'un lot dans la devise du compte = prix / taille du tick x valeur du tick.
      double notionalPerLot = price / tickSize * tickValue;
      lots = equity * InpExposurePct / 100.0 * InpLeverage / notionalPerLot;
     }
   else if(InpSizing == FX_SIZING_RISK)
     {
      if(InpStopLossPips <= 0.0 || tickValue <= 0.0 || tickSize <= 0.0)
         Print("Mode risque sans stop-loss : la taille en lots fixes est utilisée.");
      else
         lots = equity * InpRiskPct / 100.0 / (InpStopLossPips * FxPip() / tickSize * tickValue);
     }
   lots = MathMin(lots, InpMaxLots);
   double margin1 = 0.0;
   if(OrderCalcMargin(ORDER_TYPE_BUY, _Symbol, 1.0, price, margin1) && margin1 > 0.0)
      lots = MathMin(lots, AccountInfoDouble(ACCOUNT_MARGIN_FREE) * 0.9 / margin1);
   if(step <= 0.0) step = 0.01;
   lots = MathFloor(lots / step + 1e-9) * step;
   if(lots < vmin) return 0.0;
   lots = MathMin(lots, vmax);
   int volDigits = (int)MathMax(0.0, MathCeil(-MathLog10(step) - 1e-9));
   return NormalizeDouble(lots, volDigits);
  }

// Ouvre au marché. Renvoie 1 si ouvert, 0 si taille trop petite, -1 si refusé par le courtier.
int FxOpen(const int dir, const MqlTick &tk)
  {
   double pip = FxPip();
   double price = (dir > 0) ? tk.ask : tk.bid;
   double lots = FxLots(price);
   if(lots <= 0.0)
     {
      Print("Taille de position inférieure au minimum du courtier : ordre annulé.");
      return 0;
     }
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double sl = (InpStopLossPips > 0.0) ? NormalizeDouble(price - dir * InpStopLossPips * pip, digits) : 0.0;
   double tp = (InpTakeProfitPips > 0.0) ? NormalizeDouble(price + dir * InpTakeProfitPips * pip, digits) : 0.0;
   bool sent = (dir > 0) ? g_trade.Buy(lots, _Symbol, price, sl, tp, FX_COMMENT)
                         : g_trade.Sell(lots, _Symbol, price, sl, tp, FX_COMMENT);
   uint rc = g_trade.ResultRetcode();
   if(!sent || (rc != TRADE_RETCODE_DONE && rc != TRADE_RETCODE_PLACED))
     {
      PrintFormat("Échec de l'ordre : %u %s", rc, g_trade.ResultRetcodeDescription());
      return -1;
     }
   PrintFormat("%s %.2f lots %s à %s (SL %s, TP %s)", (dir > 0) ? "Achat" : "Vente", lots, _Symbol,
               DoubleToString(price, digits), DoubleToString(sl, digits), DoubleToString(tp, digits));
   return 1;
  }

// Tente l'ouverture en attente. Si le spread est trop large (bascule de minuit, annonce...),
// l'EA réessaie au prix suivant, jusqu'à la fin de la bougie.
void FxTryOpen()
  {
   if(g_pendDir == 0) return;
   if(FxPositionDir() != 0) { g_pendDir = 0; return; }
   MqlTick tk;
   if(!SymbolInfoTick(_Symbol, tk)) return;
   double spread = (tk.ask - tk.bid) / FxPip();
   if(InpMaxSpreadPips > 0.0 && spread > InpMaxSpreadPips)
     {
      if(!g_pendDelayed)
        {
         g_pendDelayed = true;
         g_cntSpreadDelayed++;
         PrintFormat("Spread trop élevé (%.1f pips) : ordre reporté au prix suivant.", spread);
        }
      return;
     }
   int res = FxOpen(g_pendDir, tk);
   if(res == 0) g_cntLots++;
   if(res < 0) g_cntFailed++;
   g_pendDir = 0;
  }

void FxStatus()
  {
   int dir = FxPositionDir();
   Comment(FX_NAME, "\\n",
           "Unité de temps : ", EnumToString(InpTimeframe), "   Position : ", (dir > 0) ? "achat" : (dir < 0) ? "vente" : "aucune", "\\n",
           "Dernier calcul : ", g_last);
  }

// Calcule les signaux sur la dernière bougie close et agit. Renvoie false si les données manquent.
bool FxProcess()
  {
   MqlRates r[];
   ArraySetAsSeries(r, false);
   int n = CopyRates(_Symbol, InpTimeframe, 1, InpHistoryBars, r);
   if(n < 60)
     {
      g_last = "historique insuffisant (" + IntegerToString(n) + " bougies)";
      FxStatus();
      return false;
     }
   double o[];
   double h[];
   double l[];
   double c[];
   ArrayResize(o, n);
   ArrayResize(h, n);
   ArrayResize(l, n);
   ArrayResize(c, n);
   for(int i = 0; i < n; i++)
     {
      o[i] = r[i].open;
      h[i] = r[i].high;
      l[i] = r[i].low;
      c[i] = r[i].close;
     }
   if(g_pendDir != 0)
     {
      g_cntSpreadMissed++;
      Print("Ordre non exécuté : spread trop élevé pendant toute la bougie.");
      g_pendDir = 0;
     }
   bool le = false, lx = false, se = false, sx = false;
   FxSignals(o, h, l, c, n, le, lx, se, sx);
   bool wantLong = le && !se;
   bool wantShort = se && !le;
   int dir = FxPositionDir();
   int toOpen = 0;
   if(dir > 0 && (lx || wantShort))
     {
      if(!FxCloseAll()) return true;
      if(wantShort && InpAllowShort) toOpen = -1;
     }
   else if(dir < 0 && (sx || wantLong))
     {
      if(!FxCloseAll()) return true;
      if(wantLong && InpAllowLong) toOpen = 1;
     }
   else if(dir == 0)
     {
      if(wantLong && InpAllowLong) toOpen = 1;
      else if(wantShort && InpAllowShort) toOpen = -1;
     }
   if(toOpen != 0)
     {
      g_cntSignals++;
      g_pendDir = toOpen;
      g_pendDelayed = false;
      FxTryOpen();
     }
   g_last = TimeToString(r[n - 1].time) + "  achat:" + (le ? "oui" : "non") + " sortie achat:" + (lx ? "oui" : "non") +
            " vente:" + (se ? "oui" : "non") + " sortie vente:" + (sx ? "oui" : "non");
   FxStatus();
   return true;
  }

int OnInit()
  {
   if(InpHistoryBars < 100)
     {
      Print("InpHistoryBars doit valoir au moins 100.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(!MQLInfoInteger(MQL_TESTER) && AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_REAL && !InpAllowRealAccount)
     {
      Alert(FX_NAME, " : compte RÉEL détecté. Activez le paramètre « Autoriser le trading sur un compte RÉEL » pour trader en réel.");
      return INIT_FAILED;
     }
   g_trade.SetExpertMagicNumber(InpMagic);
   g_trade.SetDeviationInPoints(30);
   g_trade.SetTypeFillingBySymbol(_Symbol);
   if(StringLen(FX_PAIR) > 0 && StringFind(_Symbol, FX_PAIR) != 0)
      PrintFormat("Attention : stratégie testée sur %s, EA lancé sur %s.", FX_PAIR, _Symbol);
   g_lastBar = InpTradeOnStart ? 0 : iTime(_Symbol, InpTimeframe, 0);
   g_last = "en attente de la prochaine bougie";
   FxStatus();
   PrintFormat("%s démarré sur %s (%s).", FX_NAME, _Symbol, EnumToString(InpTimeframe));
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   Comment("");
  }

// Fin d'un test dans le testeur de stratégie : résultats écrits pour la passerelle Forexia
// (dossier commun des terminaux : ...\MetaQuotes\Terminal\Common\Files\Forexia).
double OnTester()
  {
${ONTESTER}
   return TesterStatistics(STAT_PROFIT);
  }

void OnTick()
  {
   datetime t = iTime(_Symbol, InpTimeframe, 0);
   if(t != 0 && t != g_lastBar)
     {
      if(FxProcess()) g_lastBar = t;
      return;
     }
   if(g_pendDir != 0) FxTryOpen();
  }
//+------------------------------------------------------------------+
`;
    return { code: code, fileName: baseName + '.mq5', baseName: baseName, magic: magic };
  }

  // ---------- Relecture d'un EA Forexia (.mq5) ----------
  const PERIOD_KEYS = { '1 mois': '1m', '2 mois': '2m', '3 mois': '3m', '6 mois': '6m', '1 an': '1y', '2 ans': '2y' };
  const SIZING_KEYS = { FX_SIZING_BACKTEST: 'backtest', FX_SIZING_FIXED: 'fixed', FX_SIZING_RISK: 'risk' };
  /** Retrouve la stratégie et les réglages d'un EA généré par Forexia. Renvoie null si ce n'en est pas un. */
  function parseEA(text) {
    const code = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    if (!/Expert Advisor généré par Forexia/.test(code) || !/void FxSignals\(/.test(code)) return null;
    const lines = code.split('\n');
    const nameDef = /^#define FX_NAME "((?:[^"\\]|\\.)*)"/m.exec(code);
    const name = nameDef ? nameDef[1].replace(/\\(.)/g, '$1') : (lines[1] || '').replace(/^\/\/\|\s*/, '').trim();
    const iStrat = lines.indexOf('// Stratégie :'), iRules = lines.indexOf('// Règles :');
    let frenchText = '';
    if (iStrat >= 0 && iRules > iStrat) {
      frenchText = lines.slice(iStrat + 1, iRules).map((l) => l.replace(/^\/\/ {3}/, '')).join('\n').trim();
      if (/^\(pas de description en français\)$/.test(frenchText)) frenchText = '';
    }
    const rule = (label) => { const m = new RegExp('^//   ' + label + ' : (.*)$', 'm').exec(code); return m && m[1].trim() !== '-' ? m[1].trim() : ''; };
    const input = (n) => { const m = new RegExp('^input\\s+\\w+\\s+' + n + '\\s*=\\s*([^;]+);', 'm').exec(code); return m ? m[1].trim() : null; };
    const num = (n, d) => { const v = Number(input(n)); return Number.isFinite(v) ? v : d; };
    const strategy = {
      name: name, frenchText: frenchText,
      longEntry: rule('Entrée achat'), longExit: rule('Sortie achat'), shortEntry: rule('Entrée vente'), shortExit: rule('Sortie vente'),
      stopLossPips: num('InpStopLossPips', 0), takeProfitPips: num('InpTakeProfitPips', 0),
    };
    if (input('InpAllowLong') === 'false') { strategy.longEntry = ''; strategy.longExit = ''; }
    if (input('InpAllowShort') === 'false') { strategy.shortEntry = ''; strategy.shortExit = ''; }
    const config = { leverage: num('InpLeverage', 10), exposurePct: num('InpExposurePct', 100) };
    const bt = /^\/\/ Backtest Forexia : ([A-Z]{3}\/[A-Z]{3})?,?\s*(.*)$/m.exec(code);
    if (bt) {
      if (bt[1]) config.pair = bt[1];
      const parts = bt[2].split(', ');
      const per = parts.find((x) => PERIOD_KEYS[x] || /^du \d{2}\/\d{2}\/\d{4} au \d{2}\/\d{2}\/\d{4}$/.test(x));
      if (per && PERIOD_KEYS[per]) config.period = PERIOD_KEYS[per];
      else if (per) {
        const d = per.match(/\d{2}\/\d{2}\/\d{4}/g).map((x) => x.split('/').reverse().join('-'));
        Object.assign(config, { period: 'custom', dateFrom: d[0], dateTo: d[1] });
      }
      const res = /résultat ([+-]?[\d.]+) %/.exec(bt[2]);
      if (res) config.resultPct = Number(res[1]);
    }
    const tf = input('InpTimeframe');
    config.timeframe = tf ? tf.replace('PERIOD_', '') : 'D1';
    config.broker = {
      sizing: SIZING_KEYS[input('InpSizing')] || 'backtest', lots: num('InpFixedLots', 0.01), risk: num('InpRiskPct', 1),
      maxLots: num('InpMaxLots', 1), maxSpread: num('InpMaxSpreadPips', 5),
    };
    for (const k of ['longEntry', 'longExit', 'shortEntry', 'shortExit']) {
      const err = F.rules.validate(strategy[k]);
      if (err) throw new Error('Règle illisible dans l\'EA (' + k + ') : ' + err);
    }
    return { strategy: strategy, config: config };
  }

  F.mql5 = { generate, signalsFunction, CALC_LIB, TIMEFRAMES, parseEA };
})(typeof window !== 'undefined' ? window : globalThis);
