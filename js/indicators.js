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

  root.Forexia = root.Forexia || {};
  root.Forexia.indicators = {
    sma, ema, rma, rsi, macd, stochastic, bollinger, atr, cci, williamsR, momentum, roc, highest, lowest, stdev,
  };
})(typeof window !== 'undefined' ? window : globalThis);
