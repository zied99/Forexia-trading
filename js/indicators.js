/* Forexia — indicateurs techniques.
 * Toutes les fonctions renvoient des tableaux alignés sur les barres d'entrée,
 * avec NaN tant que l'indicateur n'a pas assez d'historique. */
(function (root) {
  'use strict';

  function nanArray(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = NaN; return a; }
  function firstValid(src) { for (let i = 0; i < src.length; i++) if (Number.isFinite(src[i])) return i; return -1; }

  function sma(src, period) {
    const n = src.length, out = nanArray(n);
    let sum = 0, count = 0;
    for (let i = 0; i < n; i++) {
      const v = src[i];
      if (!Number.isFinite(v)) { sum = 0; count = 0; continue; }
      sum += v; count++;
      if (count > period) { sum -= src[i - period]; count = period; }
      if (count === period) out[i] = sum / period;
    }
    return out;
  }

  // EMA initialisée par la SMA des `period` premières valeurs valides.
  function ema(src, period) {
    const n = src.length, out = nanArray(n);
    const start = firstValid(src);
    if (start < 0 || start + period > n) return out;
    const k = 2 / (period + 1);
    let prev = 0;
    for (let i = start; i < start + period; i++) prev += src[i];
    prev /= period;
    out[start + period - 1] = prev;
    for (let i = start + period; i < n; i++) {
      const v = src[i];
      if (!Number.isFinite(v)) { out[i] = prev; continue; }
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  // Lissage de Wilder (RMA) utilisé par le RSI et l'ATR.
  function rma(src, period) {
    const n = src.length, out = nanArray(n);
    const start = firstValid(src);
    if (start < 0 || start + period > n) return out;
    let prev = 0;
    for (let i = start; i < start + period; i++) prev += src[i];
    prev /= period;
    out[start + period - 1] = prev;
    for (let i = start + period; i < n; i++) {
      prev = (prev * (period - 1) + src[i]) / period;
      out[i] = prev;
    }
    return out;
  }

  function rsi(close, period) {
    const n = close.length, gains = nanArray(n), losses = nanArray(n);
    for (let i = 1; i < n; i++) {
      const d = close[i] - close[i - 1];
      gains[i] = d > 0 ? d : 0;
      losses[i] = d < 0 ? -d : 0;
    }
    const ag = rma(gains, period), al = rma(losses, period), out = nanArray(n);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(ag[i]) || !Number.isFinite(al[i])) continue;
      out[i] = al[i] === 0 ? (ag[i] === 0 ? 50 : 100) : 100 - 100 / (1 + ag[i] / al[i]);
    }
    return out;
  }

  function macd(close, fast, slow, signal) {
    const ef = ema(close, fast), es = ema(close, slow), n = close.length;
    const line = nanArray(n);
    for (let i = 0; i < n; i++) if (Number.isFinite(ef[i]) && Number.isFinite(es[i])) line[i] = ef[i] - es[i];
    const sig = ema(line, signal), hist = nanArray(n);
    for (let i = 0; i < n; i++) if (Number.isFinite(line[i]) && Number.isFinite(sig[i])) hist[i] = line[i] - sig[i];
    return { macd: line, signal: sig, hist: hist };
  }

  function highest(src, period) {
    const n = src.length, out = nanArray(n);
    for (let i = period - 1; i < n; i++) {
      let m = -Infinity;
      for (let j = i - period + 1; j <= i; j++) { if (!Number.isFinite(src[j])) { m = NaN; break; } if (src[j] > m) m = src[j]; }
      out[i] = m;
    }
    return out;
  }
  function lowest(src, period) {
    const n = src.length, out = nanArray(n);
    for (let i = period - 1; i < n; i++) {
      let m = Infinity;
      for (let j = i - period + 1; j <= i; j++) { if (!Number.isFinite(src[j])) { m = NaN; break; } if (src[j] < m) m = src[j]; }
      out[i] = m;
    }
    return out;
  }

  // Oscillateur stochastique : %K (lissé) et %D.
  function stochastic(high, low, close, kPeriod, dPeriod, smooth) {
    const n = close.length, hh = highest(high, kPeriod), ll = lowest(low, kPeriod), raw = nanArray(n);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(hh[i]) || !Number.isFinite(ll[i])) continue;
      const range = hh[i] - ll[i];
      raw[i] = range === 0 ? 50 : (100 * (close[i] - ll[i])) / range;
    }
    const k = smooth > 1 ? sma(raw, smooth) : raw;
    return { k: k, d: sma(k, dPeriod) };
  }

  function stdev(src, period) {
    const n = src.length, mean = sma(src, period), out = nanArray(n);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(mean[i])) continue;
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += (src[j] - mean[i]) * (src[j] - mean[i]);
      out[i] = Math.sqrt(s / period);
    }
    return out;
  }

  function bollinger(close, period, mult) {
    const mid = sma(close, period), sd = stdev(close, period), n = close.length;
    const upper = nanArray(n), lower = nanArray(n);
    for (let i = 0; i < n; i++) if (Number.isFinite(mid[i])) { upper[i] = mid[i] + mult * sd[i]; lower[i] = mid[i] - mult * sd[i]; }
    return { upper: upper, middle: mid, lower: lower };
  }

  function trueRange(high, low, close) {
    const n = close.length, tr = nanArray(n);
    for (let i = 0; i < n; i++) {
      const hl = high[i] - low[i];
      tr[i] = i === 0 ? hl : Math.max(hl, Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
    }
    return tr;
  }
  function atr(high, low, close, period) { return rma(trueRange(high, low, close), period); }

  function cci(high, low, close, period) {
    const n = close.length, tp = nanArray(n);
    for (let i = 0; i < n; i++) tp[i] = (high[i] + low[i] + close[i]) / 3;
    const m = sma(tp, period), out = nanArray(n);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(m[i])) continue;
      let md = 0;
      for (let j = i - period + 1; j <= i; j++) md += Math.abs(tp[j] - m[i]);
      md /= period;
      out[i] = md === 0 ? 0 : (tp[i] - m[i]) / (0.015 * md);
    }
    return out;
  }

  function williamsR(high, low, close, period) {
    const n = close.length, hh = highest(high, period), ll = lowest(low, period), out = nanArray(n);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(hh[i])) continue;
      const r = hh[i] - ll[i];
      out[i] = r === 0 ? -50 : (-100 * (hh[i] - close[i])) / r;
    }
    return out;
  }

  function momentum(src, period) {
    const n = src.length, out = nanArray(n);
    for (let i = period; i < n; i++) out[i] = src[i] - src[i - period];
    return out;
  }
  function roc(src, period) {
    const n = src.length, out = nanArray(n);
    for (let i = period; i < n; i++) out[i] = (100 * (src[i] - src[i - period])) / src[i - period];
    return out;
  }

  // ---------- Forexia 1.2 : nouveaux indicateurs ----------

  // ADX / DMI (Wilder) : force de la tendance et directions.
  function dmi(high, low, close, period) {
    const n = close.length, pdm = nanArray(n), mdm = nanArray(n), tr = nanArray(n);
    for (let i = 1; i < n; i++) {
      const up = high[i] - high[i - 1], down = low[i - 1] - low[i];
      pdm[i] = up > down && up > 0 ? up : 0;
      mdm[i] = down > up && down > 0 ? down : 0;
      tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
    }
    const atr = rma(tr, period), sp = rma(pdm, period), sm = rma(mdm, period);
    const plus = nanArray(n), minus = nanArray(n), dx = nanArray(n);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(atr[i]) || atr[i] === 0) continue;
      plus[i] = (100 * sp[i]) / atr[i];
      minus[i] = (100 * sm[i]) / atr[i];
      const sum = plus[i] + minus[i];
      dx[i] = sum === 0 ? 0 : (100 * Math.abs(plus[i] - minus[i])) / sum;
    }
    return { adx: rma(dx, period), plus: plus, minus: minus };
  }

  // SAR parabolique (Wilder).
  function psar(high, low, step, max) {
    const n = high.length, out = nanArray(n);
    if (n < 2) return out;
    let up = high[1] + low[1] >= high[0] + low[0];
    let sar = up ? low[0] : high[0], ep = up ? high[1] : low[1], af = step;
    out[1] = sar;
    for (let i = 2; i < n; i++) {
      sar = sar + af * (ep - sar);
      if (up) {
        sar = Math.min(sar, low[i - 1], low[i - 2]);
        if (low[i] < sar) { up = false; sar = ep; ep = low[i]; af = step; }
        else if (high[i] > ep) { ep = high[i]; af = Math.min(af + step, max); }
      } else {
        sar = Math.max(sar, high[i - 1], high[i - 2]);
        if (high[i] > sar) { up = true; sar = ep; ep = high[i]; af = step; }
        else if (low[i] < ep) { ep = low[i]; af = Math.min(af + step, max); }
      }
      out[i] = sar;
    }
    return out;
  }

  // SuperTrend : ligne et direction (1 haussière, -1 baissière).
  function supertrend(high, low, close, period, mult) {
    const n = close.length, a = atr(high, low, close, period), line = nanArray(n), dir = nanArray(n);
    let fu = NaN, fl = NaN, d = 1;
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(a[i])) continue;
      const hl2 = (high[i] + low[i]) / 2, bu = hl2 + mult * a[i], bl = hl2 - mult * a[i];
      if (!Number.isFinite(fu)) { fu = bu; fl = bl; d = 1; }
      else {
        const pc = close[i - 1];
        fu = bu < fu || pc > fu ? bu : fu;
        fl = bl > fl || pc < fl ? bl : fl;
        d = d > 0 ? (close[i] < fl ? -1 : 1) : (close[i] > fu ? 1 : -1);
      }
      line[i] = d > 0 ? fl : fu;
      dir[i] = d;
    }
    return { line: line, dir: dir };
  }

  function donchian(high, low, period) {
    const up = highest(high, period), lo = lowest(low, period), n = high.length, mid = nanArray(n);
    for (let i = 0; i < n; i++) if (Number.isFinite(up[i]) && Number.isFinite(lo[i])) mid[i] = (up[i] + lo[i]) / 2;
    return { upper: up, lower: lo, middle: mid };
  }

  function keltner(high, low, close, period, mult, atrPeriod) {
    const mid = ema(close, period), a = atr(high, low, close, atrPeriod), n = close.length, up = nanArray(n), lo = nanArray(n);
    for (let i = 0; i < n; i++) if (Number.isFinite(mid[i]) && Number.isFinite(a[i])) { up[i] = mid[i] + mult * a[i]; lo[i] = mid[i] - mult * a[i]; }
    return { upper: up, middle: mid, lower: lo };
  }

  // Ichimoku : Tenkan, Kijun et nuage (Senkou A / B) tel qu'il se trouve au-dessus de la bougie courante
  // (valeurs calculées « shift » bougies plus tôt, donc sans regarder le futur).
  function midRange(high, low, period) {
    const hh = highest(high, period), ll = lowest(low, period), n = high.length, out = nanArray(n);
    for (let i = 0; i < n; i++) if (Number.isFinite(hh[i]) && Number.isFinite(ll[i])) out[i] = (hh[i] + ll[i]) / 2;
    return out;
  }
  function ichimoku(high, low, tenkanP, kijunP, senkouP) {
    const n = high.length, tenkan = midRange(high, low, tenkanP), kijun = midRange(high, low, kijunP), b = midRange(high, low, senkouP);
    const spanA = nanArray(n), spanB = nanArray(n);
    for (let i = kijunP; i < n; i++) {
      const j = i - kijunP;
      if (Number.isFinite(tenkan[j]) && Number.isFinite(kijun[j])) spanA[i] = (tenkan[j] + kijun[j]) / 2;
      if (Number.isFinite(b[j])) spanB[i] = b[j];
    }
    return { tenkan: tenkan, kijun: kijun, spanA: spanA, spanB: spanB };
  }

  // Points pivots classiques à partir du plus haut / plus bas / clôture de la journée précédente.
  function pivots(high, low, close, dayKeys) {
    const n = close.length, P = nanArray(n), R1 = nanArray(n), S1 = nanArray(n), R2 = nanArray(n), S2 = nanArray(n);
    let curDay = null, h = -Infinity, l = Infinity, c = NaN, prev = null;
    for (let i = 0; i < n; i++) {
      if (dayKeys[i] !== curDay) {
        if (curDay !== null) prev = { h: h, l: l, c: c };
        curDay = dayKeys[i]; h = -Infinity; l = Infinity;
      }
      if (prev) {
        const p = (prev.h + prev.l + prev.c) / 3;
        P[i] = p; R1[i] = 2 * p - prev.l; S1[i] = 2 * p - prev.h; R2[i] = p + (prev.h - prev.l); S2[i] = p - (prev.h - prev.l);
      }
      h = Math.max(h, high[i]); l = Math.min(l, low[i]); c = close[i];
    }
    return { P: P, R1: R1, S1: S1, R2: R2, S2: S2 };
  }

  function heikinAshi(open, high, low, close) {
    const n = close.length, ho = nanArray(n), hc = nanArray(n), hh = nanArray(n), hl = nanArray(n);
    for (let i = 0; i < n; i++) {
      hc[i] = (open[i] + high[i] + low[i] + close[i]) / 4;
      ho[i] = i === 0 ? (open[i] + close[i]) / 2 : (ho[i - 1] + hc[i - 1]) / 2;
      hh[i] = Math.max(high[i], ho[i], hc[i]);
      hl[i] = Math.min(low[i], ho[i], hc[i]);
    }
    return { open: ho, close: hc, high: hh, low: hl };
  }

  // Figures de bougies : 1 si la figure apparaît sur la bougie, 0 sinon.
  function candlePattern(open, high, low, close, kind) {
    const n = close.length, out = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const o = open[i], c = close[i], h = high[i], l = low[i], body = Math.abs(c - o), range = h - l;
      const upper = h - Math.max(o, c), lower = Math.min(o, c) - l;
      if (kind === 'BULL_ENGULF') out[i] = i > 0 && close[i - 1] < open[i - 1] && c > o && o <= close[i - 1] && c >= open[i - 1] ? 1 : 0;
      else if (kind === 'BEAR_ENGULF') out[i] = i > 0 && close[i - 1] > open[i - 1] && c < o && o >= close[i - 1] && c <= open[i - 1] ? 1 : 0;
      else if (kind === 'HAMMER') out[i] = range > 0 && lower >= 2 * body && upper <= 0.25 * range ? 1 : 0;
      else if (kind === 'SHOOTING_STAR') out[i] = range > 0 && upper >= 2 * body && lower <= 0.25 * range ? 1 : 0;
    }
    return out;
  }

  // Divergence : le prix fait un nouveau plus bas (plus haut) sur « period » bougies, plus bas (haut) que la fenêtre
  // précédente, mais l'oscillateur ne confirme pas.
  function divergence(price, osc, period, dir) {
    const n = price.length, out = new Array(n).fill(0);
    for (let i = 2 * period - 1; i < n; i++) {
      let curExt = price[i], prevExt = dir > 0 ? Infinity : -Infinity, prevOsc = dir > 0 ? Infinity : -Infinity, ok = Number.isFinite(osc[i]);
      for (let j = i - period + 1; j <= i && ok; j++) if (dir > 0 ? price[j] < curExt : price[j] > curExt) ok = false; // bougie courante = extrême de la fenêtre
      for (let j = i - 2 * period + 1; j <= i - period && ok; j++) {
        if (!Number.isFinite(osc[j])) { ok = false; break; }
        if (dir > 0) { prevExt = Math.min(prevExt, price[j]); prevOsc = Math.min(prevOsc, osc[j]); }
        else { prevExt = Math.max(prevExt, price[j]); prevOsc = Math.max(prevOsc, osc[j]); }
      }
      if (!ok) continue;
      out[i] = dir > 0 ? (curExt < prevExt && osc[i] > prevOsc ? 1 : 0) : (curExt > prevExt && osc[i] < prevOsc ? 1 : 0);
    }
    return out;
  }

  // Pente moyenne sur « period » bougies.
  function slope(src, period) {
    const n = src.length, out = nanArray(n);
    for (let i = period; i < n; i++) if (Number.isFinite(src[i]) && Number.isFinite(src[i - period])) out[i] = (src[i] - src[i - period]) / period;
    return out;
  }

  root.Forexia = root.Forexia || {};
  root.Forexia.indicators = {
    dmi, psar, supertrend, donchian, keltner, ichimoku, pivots, heikinAshi, candlePattern, divergence, slope, trueRange,
    sma, ema, rma, rsi, macd, stochastic, bollinger, atr, cci, williamsR, momentum, roc, highest, lowest, stdev,
  };
})(typeof window !== 'undefined' ? window : globalThis);
