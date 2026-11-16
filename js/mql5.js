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
// ---------- Forexia 1.2 ----------
void FxTime(const datetime &tm[], const int n, const int kind, double &out[])
  {
   FxInit(out, n);
   for(int i = 0; i < n; i++)
     {
      MqlDateTime d;
      TimeToStruct(tm[i], d);
      if(kind == 0) out[i] = d.hour;
      else if(kind == 1) out[i] = d.min;
      else if(kind == 2) out[i] = (d.day_of_week == 0) ? 7 : d.day_of_week;
      else if(kind == 3) out[i] = d.day;
      else out[i] = d.mon;
     }
  }
long FxBucket(const datetime t, const int tf)
  {
   if(tf == -1) return (long)MathFloor(((double)t / 86400.0 + 3.0) / 7.0);
   if(tf == -2) { MqlDateTime d; TimeToStruct(t, d); return (long)d.year * 12 + d.mon - 1; }
   return (long)t / tf;
  }
// Bougies d'unité supérieure ; map[i] = dernière bougie supérieure close à la bougie i (-1 sinon).
int FxResample(const datetime &tm[], const double &o[], const double &h[], const double &l[], const double &c[], const int n, const datetime tnext, const int tf,
               datetime &ht[], double &ho[], double &hh[], double &hl[], double &hc[], int &map[])
  {
   ArrayResize(ht, n);
   ArrayResize(ho, n);
   ArrayResize(hh, n);
   ArrayResize(hl, n);
   ArrayResize(hc, n);
   ArrayResize(map, n);
   int idx[];
   ArrayResize(idx, n);
   int m = -1;
   long prev = 0;
   for(int i = 0; i < n; i++)
     {
      long k = FxBucket(tm[i], tf);
      if(i == 0 || k != prev) { m++; ht[m] = tm[i]; ho[m] = o[i]; hh[m] = h[i]; hl[m] = l[i]; hc[m] = c[i]; }
      else { hh[m] = MathMax(hh[m], h[i]); hl[m] = MathMin(hl[m], l[i]); hc[m] = c[i]; }
      idx[i] = m;
      prev = k;
     }
   for(int i = 0; i < n; i++)
     {
      long k = FxBucket(tm[i], tf);
      bool known = (i + 1 < n) || (tnext > 0);
      long nk = (i + 1 < n) ? FxBucket(tm[i + 1], tf) : FxBucket(tnext, tf);
      map[i] = (known && nk != k) ? idx[i] : idx[i] - 1;
     }
   m++;
   ArrayResize(ht, m);
   ArrayResize(ho, m);
   ArrayResize(hh, m);
   ArrayResize(hl, m);
   ArrayResize(hc, m);
   return m;
  }
void FxMapBack(const double &src[], const int &map[], const int n, double &out[])
  {
   FxInit(out, n);
   for(int i = 0; i < n; i++) if(map[i] >= 0) out[i] = src[map[i]];
  }
void FxDMI(const double &h[], const double &l[], const double &c[], const int p, double &adx[], double &plus[], double &minus[])
  {
   int n = ArraySize(c);
   double pdm[];
   double mdm[];
   double tr[];
   FxInit(pdm, n);
   FxInit(mdm, n);
   FxInit(tr, n);
   for(int i = 1; i < n; i++)
     {
      double up = h[i] - h[i - 1], down = l[i - 1] - l[i];
      pdm[i] = (up > down && up > 0.0) ? up : 0.0;
      mdm[i] = (down > up && down > 0.0) ? down : 0.0;
      tr[i] = MathMax(h[i] - l[i], MathMax(MathAbs(h[i] - c[i - 1]), MathAbs(l[i] - c[i - 1])));
     }
   double at[];
   double sp[];
   double sm[];
   double dx[];
   FxRMA(tr, p, at);
   FxRMA(pdm, p, sp);
   FxRMA(mdm, p, sm);
   FxInit(plus, n);
   FxInit(minus, n);
   FxInit(dx, n);
   for(int i = 0; i < n; i++)
     {
      if(!FxOk(at[i]) || at[i] == 0.0) continue;
      plus[i] = 100.0 * sp[i] / at[i];
      minus[i] = 100.0 * sm[i] / at[i];
      double sum = plus[i] + minus[i];
      dx[i] = (sum == 0.0) ? 0.0 : 100.0 * MathAbs(plus[i] - minus[i]) / sum;
     }
   FxRMA(dx, p, adx);
  }
void FxPSAR(const double &h[], const double &l[], const double stp, const double mx, double &out[])
  {
   int n = ArraySize(h);
   FxInit(out, n);
   if(n < 2) return;
   bool up = h[1] + l[1] >= h[0] + l[0];
   double sar = up ? l[0] : h[0], ep = up ? h[1] : l[1], af = stp;
   out[1] = sar;
   for(int i = 2; i < n; i++)
     {
      sar = sar + af * (ep - sar);
      if(up)
        {
         sar = MathMin(sar, MathMin(l[i - 1], l[i - 2]));
         if(l[i] < sar) { up = false; sar = ep; ep = l[i]; af = stp; }
         else if(h[i] > ep) { ep = h[i]; af = MathMin(af + stp, mx); }
        }
      else
        {
         sar = MathMax(sar, MathMax(h[i - 1], h[i - 2]));
         if(h[i] > sar) { up = true; sar = ep; ep = h[i]; af = stp; }
         else if(l[i] < ep) { ep = l[i]; af = MathMin(af + stp, mx); }
        }
      out[i] = sar;
     }
  }
void FxSuperTrend(const double &h[], const double &l[], const double &c[], const int p, const double mult, double &line[], double &dir[])
  {
   int n = ArraySize(c);
   double a[];
   FxATR(h, l, c, p, a);
   FxInit(line, n);
   FxInit(dir, n);
   double fu = 0.0, fl = 0.0;
   bool started = false;
   int d = 1;
   for(int i = 0; i < n; i++)
     {
      if(!FxOk(a[i])) continue;
      double hl2 = (h[i] + l[i]) / 2.0, bu = hl2 + mult * a[i], bl = hl2 - mult * a[i];
      if(!started) { fu = bu; fl = bl; d = 1; started = true; }
      else
        {
         double pc = c[i - 1];
         fu = (bu < fu || pc > fu) ? bu : fu;
         fl = (bl > fl || pc < fl) ? bl : fl;
         if(d > 0) d = (c[i] < fl) ? -1 : 1;
         else d = (c[i] > fu) ? 1 : -1;
        }
      line[i] = (d > 0) ? fl : fu;
      dir[i] = d;
     }
  }
void FxKeltner(const double &h[], const double &l[], const double &c[], const int p, const double mult, const int ap, double &up[], double &mid[], double &lo[])
  {
   int n = ArraySize(c);
   double a[];
   FxEMA(c, p, mid);
   FxATR(h, l, c, ap, a);
   FxInit(up, n);
   FxInit(lo, n);
   for(int i = 0; i < n; i++) if(FxOk(mid[i]) && FxOk(a[i])) { up[i] = mid[i] + mult * a[i]; lo[i] = mid[i] - mult * a[i]; }
  }
void FxMidRange(const double &h[], const double &l[], const int p, double &out[])
  {
   int n = ArraySize(h);
   double hh[];
   double ll[];
   FxHighest(h, p, hh);
   FxLowest(l, p, ll);
   FxInit(out, n);
   for(int i = 0; i < n; i++) if(FxOk(hh[i]) && FxOk(ll[i])) out[i] = (hh[i] + ll[i]) / 2.0;
  }
void FxIchimoku(const double &h[], const double &l[], const int tp, const int kp, const int sp, double &tenkan[], double &kijun[], double &spanA[], double &spanB[])
  {
   int n = ArraySize(h);
   double b[];
   FxMidRange(h, l, tp, tenkan);
   FxMidRange(h, l, kp, kijun);
   FxMidRange(h, l, sp, b);
   FxInit(spanA, n);
   FxInit(spanB, n);
   for(int i = kp; i < n; i++)
     {
      int j = i - kp;
      if(FxOk(tenkan[j]) && FxOk(kijun[j])) spanA[i] = (tenkan[j] + kijun[j]) / 2.0;
      if(FxOk(b[j])) spanB[i] = b[j];
     }
  }
void FxPivots(const double &h[], const double &l[], const double &c[], const datetime &tm[], const int n,
              double &P[], double &R1[], double &S1[], double &R2[], double &S2[])
  {
   FxInit(P, n);
   FxInit(R1, n);
   FxInit(S1, n);
   FxInit(R2, n);
   FxInit(S2, n);
   long curDay = -1;
   double dh = -DBL_MAX, dl = DBL_MAX, dc = 0.0, ph = 0.0, pl = 0.0, pc = 0.0;
   bool havePrev = false;
   for(int i = 0; i < n; i++)
     {
      long day = (long)tm[i] / 86400;
      if(day != curDay)
        {
         if(curDay != -1) { ph = dh; pl = dl; pc = dc; havePrev = true; }
         curDay = day; dh = -DBL_MAX; dl = DBL_MAX;
        }
      if(havePrev)
        {
         double p = (ph + pl + pc) / 3.0;
         P[i] = p; R1[i] = 2.0 * p - pl; S1[i] = 2.0 * p - ph; R2[i] = p + (ph - pl); S2[i] = p - (ph - pl);
        }
      dh = MathMax(dh, h[i]); dl = MathMin(dl, l[i]); dc = c[i];
     }
  }
void FxHeikin(const double &o[], const double &h[], const double &l[], const double &c[], double &ho[], double &hh[], double &hl[], double &hc[])
  {
   int n = ArraySize(c);
   FxInit(ho, n);
   FxInit(hh, n);
   FxInit(hl, n);
   FxInit(hc, n);
   for(int i = 0; i < n; i++)
     {
      hc[i] = (o[i] + h[i] + l[i] + c[i]) / 4.0;
      ho[i] = (i == 0) ? (o[i] + c[i]) / 2.0 : (ho[i - 1] + hc[i - 1]) / 2.0;
      hh[i] = MathMax(h[i], MathMax(ho[i], hc[i]));
      hl[i] = MathMin(l[i], MathMin(ho[i], hc[i]));
     }
  }
// 0 avalement haussier, 1 avalement baissier, 2 marteau, 3 étoile filante
void FxPattern(const double &o[], const double &h[], const double &l[], const double &c[], const int kind, double &out[])
  {
   int n = ArraySize(c);
   FxConst(out, n, 0.0);
   for(int i = 0; i < n; i++)
     {
      double body = MathAbs(c[i] - o[i]), range = h[i] - l[i];
      double upper = h[i] - MathMax(o[i], c[i]), lower = MathMin(o[i], c[i]) - l[i];
      bool r = false;
      if(kind == 0) r = i > 0 && c[i - 1] < o[i - 1] && c[i] > o[i] && o[i] <= c[i - 1] && c[i] >= o[i - 1];
      else if(kind == 1) r = i > 0 && c[i - 1] > o[i - 1] && c[i] < o[i] && o[i] >= c[i - 1] && c[i] <= o[i - 1];
      else if(kind == 2) r = range > 0.0 && lower >= 2.0 * body && upper <= 0.25 * range;
      else r = range > 0.0 && upper >= 2.0 * body && lower <= 0.25 * range;
      out[i] = r ? 1.0 : 0.0;
     }
  }
void FxDivergence(const double &price[], const double &osc[], const int p, const int dir, double &out[])
  {
   int n = ArraySize(price);
   FxConst(out, n, 0.0);
   for(int i = 2 * p - 1; i < n; i++)
     {
      double cur = price[i], prevExt = (dir > 0) ? DBL_MAX : -DBL_MAX, prevOsc = (dir > 0) ? DBL_MAX : -DBL_MAX;
      bool ok = FxOk(osc[i]);
      for(int j = i - p + 1; j <= i && ok; j++) if((dir > 0) ? price[j] < cur : price[j] > cur) ok = false;
      for(int j = i - 2 * p + 1; j <= i - p && ok; j++)
        {
         if(!FxOk(osc[j])) { ok = false; break; }
         if(dir > 0) { prevExt = MathMin(prevExt, price[j]); prevOsc = MathMin(prevOsc, osc[j]); }
         else { prevExt = MathMax(prevExt, price[j]); prevOsc = MathMax(prevOsc, osc[j]); }
        }
      if(!ok) continue;
      if(dir > 0) out[i] = (cur < prevExt && osc[i] > prevOsc) ? 1.0 : 0.0;
      else out[i] = (cur > prevExt && osc[i] < prevOsc) ? 1.0 : 0.0;
     }
  }
void FxSlope(const double &src[], const int p, double &out[])
  {
   int n = ArraySize(src);
   FxInit(out, n);
   for(int i = p; i < n; i++) if(FxOk(src[i]) && FxOk(src[i - p])) out[i] = (src[i] - src[i - p]) / p;
  }
`;

  // ---------- Traduction des règles en MQL5 ----------
  const OPS = { '+': 0, '-': 1, '*': 2, '/': 3, '>': 4, '<': 5, '>=': 6, '<=': 7, '==': 8, '!=': 9, AND: 10, OR: 11 };
  const DEF = { SMA: 20, EMA: 20, RSI: 14, MOM: 10, ROC: 10, HIGHEST: 20, LOWEST: 20, ATR: 14, CCI: 20, WILLR: 14, SLOPE: 5 };
  const SRC_FN = { SMA: 'FxSMA', EMA: 'FxEMA', RSI: 'FxRSI', MOM: 'FxMom', ROC: 'FxRoc', HIGHEST: 'FxHighest', LOWEST: 'FxLowest', SLOPE: 'FxSlope' };
  const HLC_FN = { ATR: 'FxATR', CCI: 'FxCCI', WILLR: 'FxWillR' };
  const SERIES = { CLOSE: 'c', PRICE: 'c', OPEN: 'o', HIGH: 'h', LOW: 'l' };  // HOUR, WEEKDAY… : calculés depuis l'heure des bougies

  function fmtNum(v) {
    if (!Number.isFinite(v)) throw new Error('nombre invalide');
    const s = String(v);
    return /[.e]/.test(s) ? s : s + '.0';
  }

  // Unités de temps : secondes, ou -1 (semaine commençant le lundi) / -2 (mois).
  const TF_CODE = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400, W1: -1, MN: -2 };
  const TIME_KIND = { HOUR: 0, MINUTE: 1, WEEKDAY: 2, DAY: 3, MONTH: 4 };
  const PATTERN = { BULL_ENGULF: 0, BEAR_ENGULF: 1, HAMMER: 2, SHOOTING_STAR: 3 };

  function Compiler() {
    const lines = [];
    const cache = new Map();
    let id = 0;
    const newVar = () => 's' + ++id;
    // Cadre de calcul : bougies de base, ou bougies d'unité supérieure reconstruites (RSI(14)@H4).
    const BASE = { o: 'o', h: 'h', l: 'l', c: 'c', t: 'tm', n: 'n', id: '' };
    let frame = BASE;

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
    function series(r) {
      if (r.s) return r.s;
      const v = newVar();
      lines.push('   double ' + v + '[];', '   FxConst(' + v + ', ' + frame.n + ', ' + r.k + ');');
      return v;
    }
    const at = (r) => (r.s ? r.s + '[i]' : r.k);
    const F = () => frame;

    function gen(node) {
      const c = constant(node);
      if (c !== null) return { k: fmtNum(c) };
      const key = frame.id + '|' + root.Forexia.rules.stringify(node);
      if (cache.has(key)) return cache.get(key);
      const r = genUncached(node);
      cache.set(key, r);
      return r;
    }
    function loop(expr) {
      const v = newVar();
      lines.push('   double ' + v + '[];', '   FxInit(' + v + ', ' + frame.n + ');', '   for(int i = 0; i < ' + frame.n + '; i++) ' + v + '[i] = ' + expr + ';');
      return { s: v };
    }
    function multi(key, make) {
      key = frame.id + '|' + key;
      if (!cache.has(key)) cache.set(key, make());
      return cache.get(key);
    }
    function decl(names) { for (const nm of names) lines.push('   double ' + nm + '[];'); }

    function genUncached(node) {
      switch (node.k) {
        case 'series': {
          if (SERIES[node.name]) return { s: frame[SERIES[node.name]] };
          const v = newVar();
          lines.push('   double ' + v + '[];', '   FxTime(' + frame.t + ', ' + frame.n + ', ' + TIME_KIND[node.name] + ', ' + v + ');');
          return { s: v };
        }
        case 'neg': { const a = gen(node.a); return loop('(FxOk(' + at(a) + ') ? -' + at(a) + ' : EMPTY_VALUE)'); }
        case 'not': { const a = gen(node.a); return a.s ? loop('(FxTruthy(' + at(a) + ') ? 0.0 : 1.0)') : { k: '(FxTruthy(' + a.k + ') ? 0.0 : 1.0)' }; }
        case 'bin': {
          const a = gen(node.a), b = gen(node.b);
          const e = 'FxBin(' + OPS[node.op] + ', ' + at(a) + ', ' + at(b) + ')';
          return a.s || b.s ? loop(e) : { k: e };
        }
        case 'tf': return genTf(node);
        case 'call': return genCall(node);
      }
      throw new Error('élément non pris en charge');
    }

    // Bougies d'unité supérieure reconstruites une fois par unité, puis valeurs ramenées sur les bougies de base
    // (dernière bougie supérieure close, comme le moteur de backtest).
    function genTf(node) {
      if (frame !== BASE) throw new Error('unité de temps imbriquée non prise en charge');
      const tf = node.tf, sfx = '_' + tf;
      const hf = multi('TF:' + tf, () => {
        const f = { o: 'ho' + sfx, h: 'hh' + sfx, l: 'hl' + sfx, c: 'hc' + sfx, t: 'ht' + sfx, n: 'hn' + sfx, map: 'hmap' + sfx, id: tf };
        lines.push('   datetime ' + f.t + '[];', '   double ' + f.o + '[];', '   double ' + f.h + '[];', '   double ' + f.l + '[];', '   double ' + f.c + '[];', '   int ' + f.map + '[];',
          '   int ' + f.n + ' = FxResample(tm, o, h, l, c, n, tnext, ' + TF_CODE[tf] + ', ' + f.t + ', ' + f.o + ', ' + f.h + ', ' + f.l + ', ' + f.c + ', ' + f.map + ');');
        return f;
      });
      frame = hf;
      let r;
      try { r = gen(node.a); } finally { frame = BASE; }
      if (!r.s) return r;
      const v = newVar();
      lines.push('   double ' + v + '[];', '   FxMapBack(' + r.s + ', ' + hf.map + ', n, ' + v + ');');
      return { s: v };
    }

    function out1(fn, args) { const v = newVar(); lines.push('   double ' + v + '[];', '   ' + fn + '(' + args.concat([v]).join(', ') + ');'); return { s: v }; }

    function genCall(node) {
      const name = node.name, a = node.args, f = F();
      if (SRC_FN[name]) {
        let src = f.c, pNode = a[0];
        if (a.length && constant(a[0]) === null) { src = series(gen(a[0])); pNode = a[1]; }
        return out1(SRC_FN[name], [src, intParam(pNode, DEF[name], name)]);
      }
      if (HLC_FN[name]) return out1(HLC_FN[name], [f.h, f.l, f.c, intParam(a[0], DEF[name], name)]);
      if (/^MACD/.test(name)) {
        const fa = intParam(a[0], 12, 'MACD'), sl = intParam(a[1], 26, 'MACD'), g = intParam(a[2], 9, 'MACD');
        const o = multi('MACD:' + [fa, sl, g], () => {
          const m = newVar(), sg = newVar(), hi = newVar();
          decl([m, sg, hi]); lines.push('   FxMACD(' + f.c + ', ' + fa + ', ' + sl + ', ' + g + ', ' + m + ', ' + sg + ', ' + hi + ');');
          return { MACD: m, MACD_SIGNAL: sg, MACD_HIST: hi };
        });
        return { s: o[name] };
      }
      if (/^STOCH_/.test(name)) {
        const k = intParam(a[0], 14, 'STOCH'), d = intParam(a[1], 3, 'STOCH'), sm = intParam(a[2], 3, 'STOCH');
        const o = multi('STOCH:' + [k, d, sm], () => {
          const kv = newVar(), dv = newVar();
          decl([kv, dv]); lines.push('   FxStoch(' + [f.h, f.l, f.c, k, d, sm, kv, dv].join(', ') + ');');
          return { STOCH_K: kv, STOCH_D: dv };
        });
        return { s: o[name] };
      }
      if (/^BB_/.test(name)) {
        const p = intParam(a[0], 20, 'BB'), m = numParam(a[1], 2);
        const o = multi('BB:' + [p, m], () => {
          const up = newVar(), mid = newVar(), lo = newVar();
          decl([up, mid, lo]); lines.push('   FxBB(' + [f.c, p, fmtNum(m), up, mid, lo].join(', ') + ');');
          return { BB_UPPER: up, BB_MIDDLE: mid, BB_LOWER: lo };
        });
        return { s: o[name] };
      }
      if (name === 'ADX' || name === 'PLUS_DI' || name === 'MINUS_DI') {
        const p = intParam(a[0], 14, 'ADX');
        const o = multi('DMI:' + p, () => {
          const ad = newVar(), pl = newVar(), mi = newVar();
          decl([ad, pl, mi]); lines.push('   FxDMI(' + [f.h, f.l, f.c, p, ad, pl, mi].join(', ') + ');');
          return { ADX: ad, PLUS_DI: pl, MINUS_DI: mi };
        });
        return { s: o[name] };
      }
      if (name === 'PSAR') return out1('FxPSAR', [f.h, f.l, fmtNum(numParam(a[0], 0.02)), fmtNum(numParam(a[1], 0.2))]);
      if (name === 'SUPERTREND' || name === 'SUPERTREND_DIR') {
        const p = intParam(a[0], 10, 'SUPERTREND'), m = numParam(a[1], 3);
        const o = multi('ST:' + [p, m], () => {
          const ln = newVar(), dr = newVar();
          decl([ln, dr]); lines.push('   FxSuperTrend(' + [f.h, f.l, f.c, p, fmtNum(m), ln, dr].join(', ') + ');');
          return { SUPERTREND: ln, SUPERTREND_DIR: dr };
        });
        return { s: o[name] };
      }
      if (/^DONCHIAN_/.test(name)) {
        const p = intParam(a[0], 20, 'DONCHIAN');
        const o = multi('DON:' + p, () => {
          const up = newVar(), lo = newVar(), mid = newVar();
          decl([up, lo, mid]); lines.push('   FxHighest(' + f.h + ', ' + p + ', ' + up + ');', '   FxLowest(' + f.l + ', ' + p + ', ' + lo + ');',
            '   FxInit(' + mid + ', ' + f.n + ');', '   for(int i = 0; i < ' + f.n + '; i++) if(FxOk(' + up + '[i]) && FxOk(' + lo + '[i])) ' + mid + '[i] = (' + up + '[i] + ' + lo + '[i]) / 2.0;');
          return { DONCHIAN_UPPER: up, DONCHIAN_LOWER: lo, DONCHIAN_MIDDLE: mid };
        });
        return { s: o[name] };
      }
      if (/^KELTNER_/.test(name)) {
        const p = intParam(a[0], 20, 'KELTNER'), m = numParam(a[1], 2), ap = intParam(a[2], 10, 'KELTNER');
        const o = multi('KEL:' + [p, m, ap], () => {
          const up = newVar(), mid = newVar(), lo = newVar();
          decl([up, mid, lo]); lines.push('   FxKeltner(' + [f.h, f.l, f.c, p, fmtNum(m), ap, up, mid, lo].join(', ') + ');');
          return { KELTNER_UPPER: up, KELTNER_MIDDLE: mid, KELTNER_LOWER: lo };
        });
        return { s: o[name] };
      }
      if (['TENKAN', 'KIJUN', 'SENKOU_A', 'SENKOU_B'].includes(name)) {
        let t = 9, k = 26, sp = 52;
        if (name === 'TENKAN') t = intParam(a[0], 9, name);
        if (name === 'KIJUN') k = intParam(a[0], 26, name);
        if (name === 'SENKOU_A') { t = intParam(a[0], 9, name); k = intParam(a[1], 26, name); }
        if (name === 'SENKOU_B') { sp = intParam(a[0], 52, name); k = intParam(a[1], 26, name); }
        const o = multi('ICHI:' + [t, k, sp], () => {
          const te = newVar(), ki = newVar(), sa = newVar(), sb = newVar();
          decl([te, ki, sa, sb]); lines.push('   FxIchimoku(' + [f.h, f.l, t, k, sp, te, ki, sa, sb].join(', ') + ');');
          return { TENKAN: te, KIJUN: ki, SENKOU_A: sa, SENKOU_B: sb };
        });
        return { s: o[name] };
      }
      if (/^PIVOT/.test(name)) {
        const o = multi('PIV', () => {
          const P = newVar(), r1 = newVar(), s1 = newVar(), r2 = newVar(), s2 = newVar();
          decl([P, r1, s1, r2, s2]); lines.push('   FxPivots(' + [f.h, f.l, f.c, f.t, f.n, P, r1, s1, r2, s2].join(', ') + ');');
          return { PIVOT: P, PIVOT_R1: r1, PIVOT_S1: s1, PIVOT_R2: r2, PIVOT_S2: s2 };
        });
        return { s: o[name] };
      }
      if (/^HA_/.test(name)) {
        const o = multi('HA', () => {
          const ho = newVar(), hh = newVar(), hl = newVar(), hc = newVar();
          decl([ho, hh, hl, hc]); lines.push('   FxHeikin(' + [f.o, f.h, f.l, f.c, ho, hh, hl, hc].join(', ') + ');');
          return { HA_OPEN: ho, HA_HIGH: hh, HA_LOW: hl, HA_CLOSE: hc };
        });
        return { s: o[name] };
      }
      if (PATTERN[name] !== undefined) return out1('FxPattern', [f.o, f.h, f.l, f.c, PATTERN[name]]);
      if (name === 'BULL_DIV' || name === 'BEAR_DIV') {
        if (!a.length || constant(a[0]) !== null) throw new Error(name + ' : oscillateur manquant');
        const osc = series(gen(a[0]));
        return out1('FxDivergence', [name === 'BULL_DIV' ? f.l : f.h, osc, intParam(a[1], 14, name), name === 'BULL_DIV' ? 1 : -1]);
      }
      if (name === 'PREV') return out1('FxPrev', [series(gen(a[0])), intParam(a[1], 1, 'PREV')]);
      if (name === 'CROSS_UP' || name === 'CROSS_DOWN') return out1('FxCross', [series(gen(a[0])), series(gen(a[1])), name === 'CROSS_UP' ? 1 : -1]);
      throw new Error('fonction ' + name + ' non prise en charge');
    }

    return {
      rule(text, outVar) {
        if (!text || !text.trim()) { lines.push('   ' + outVar + ' = false;'); return; }
        lines.push('   // ' + text.replace(/\s+/g, ' '));
        const r = gen(root.Forexia.rules.parse(text));
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
    return 'void FxSignals(const double &o[], const double &h[], const double &l[], const double &c[], const datetime &tm[], const int n, const datetime tnext,\n' +
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
   datetime tm[];
   ArrayResize(tm, n);
   ArrayResize(o, n);
   ArrayResize(h, n);
   ArrayResize(l, n);
   ArrayResize(c, n);
   for(int i = 0; i < n; i++)
     {
      tm[i] = r[i].time;
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
   FxSignals(o, h, l, c, tm, n, iTime(_Symbol, InpTimeframe, 0), le, lx, se, sx);
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
