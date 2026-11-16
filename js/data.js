/* Forexia — sources de données de cours.
 *  1. Frankfurter (taux de référence BCE, journaliers, gratuit, sans clé).
 *  2. Import CSV (OHLC, n'importe quelle unité de temps : export MT4/MT5, etc.).
 *  3. Données simulées (marche aléatoire reproductible) en secours. */
(function (root) {
  'use strict';

  const PAIRS = [
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD',
    'EUR/GBP', 'EUR/JPY', 'GBP/JPY', 'EUR/CHF', 'AUD/JPY', 'EUR/AUD', 'GBP/CHF',
  ];
  const TYPICAL = {
    'EUR/USD': 1.08, 'GBP/USD': 1.27, 'USD/JPY': 150, 'USD/CHF': 0.88, 'AUD/USD': 0.66, 'USD/CAD': 1.36,
    'NZD/USD': 0.61, 'EUR/GBP': 0.85, 'EUR/JPY': 162, 'GBP/JPY': 190, 'EUR/CHF': 0.95, 'AUD/JPY': 99,
    'EUR/AUD': 1.64, 'GBP/CHF': 1.12,
  };
  const PERIODS = { '1m': 1, '2m': 2, '3m': 3, '6m': 6, '1y': 12, '2y': 24 };
  const WARMUP_DAYS = 800; // historique supplémentaire pour initialiser les indicateurs (EMA 200, SMA 400 du long terme…)

  function iso(d) { return d.toISOString().slice(0, 10); }
  function addMonths(d, m) { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + m); return x; }
  function addDays(d, k) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + k); return x; }

  function periodRange(periodKey, endDate) {
    const end = endDate ? new Date(endDate) : new Date();
    const start = addMonths(end, -PERIODS[periodKey]);
    return { start: start, end: end, fetchStart: addDays(start, -WARMUP_DAYS) };
  }

  /** Période choisie librement (dates ISO « AAAA-MM-JJ »). */
  function customRange(fromIso, toIso) {
    const start = new Date(fromIso + 'T00:00:00Z'), end = new Date(toIso + 'T00:00:00Z');
    if (isNaN(start) || isNaN(end)) throw new Error('Dates de début et de fin invalides.');
    if (end <= start) throw new Error('La date de fin doit être après la date de début.');
    if ((end - start) / 864e5 < 30) throw new Error('Choisissez une période d\'au moins 30 jours.');
    return { start: start, end: end, fetchStart: addDays(start, -WARMUP_DAYS) };
  }

  // Les taux BCE n'ont qu'une valeur par jour : on construit des barres OHLC
  // avec ouverture = clôture précédente.
  function barsFromCloses(points) {
    const bars = [];
    for (let i = 0; i < points.length; i++) {
      const c = points[i].close, o = i ? points[i - 1].close : c;
      bars.push({ date: points[i].date, open: o, high: Math.max(o, c), low: Math.min(o, c), close: c });
    }
    return bars;
  }

  const ECB_FIRST_DATE = '1999-01-04';

  async function fetchChunk(base, quote, from, to) {
    const path = '/' + iso(from) + '..' + iso(to) + '?from=' + base + '&to=' + quote;
    const hosts = ['https://api.frankfurter.dev/v1', 'https://api.frankfurter.app'];
    let lastErr;
    for (const h of hosts) {
      try {
        const res = await fetch(h + path);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        return Object.keys(json.rates || {}).map((d) => ({ date: d, close: Number(json.rates[d][quote]) }));
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  // Les cours sont demandés par tranches d'un an (en parallèle) puis fusionnés,
  // pour garder des cotations journalières même sur de longues périodes.
  async function fetchFrankfurter(pair, from, to) {
    const [base, quote] = pair.split('/');
    const first = new Date(ECB_FIRST_DATE + 'T00:00:00Z');
    if (from < first) from = first;
    const chunks = [];
    for (let s = new Date(from); s <= to; s = addDays(s, 366)) {
      const e = addDays(s, 365);
      chunks.push([s, e < to ? e : to]);
    }
    try {
      const parts = await Promise.all(chunks.map(([s, e]) => fetchChunk(base, quote, s, e)));
      const byDate = new Map();
      for (const p of parts.flat()) if (Number.isFinite(p.close)) byDate.set(p.date, p.close);
      const points = [...byDate.keys()].sort().map((d) => ({ date: d, close: byDate.get(d) }));
      if (points.length < 30) throw new Error('trop peu de cotations reçues');
      return barsFromCloses(points);
    } catch (e) {
      throw new Error('Impossible de récupérer les cours en ligne (' + e.message + ')');
    }
  }

  // Générateur pseudo-aléatoire reproductible (mulberry32).
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  // Données simulées : une seule série par paire, générée depuis une date fixe, pour que la même date donne
  // toujours le même prix quelle que soit la période demandée (relancer ou prolonger une simulation reste comparable).
  const SYNTH_ORIGIN = Date.UTC(1995, 0, 2);
  function generateSynthetic(pair, from, to) {
    const rand = rng(hash('synth|' + pair));
    const gauss = () => { const u = rand() || 1e-9, v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const dailyVol = (/JPY/.test(pair) ? 0.0065 : 0.005);
    const typical = TYPICAL[pair] || 1;
    let price = typical, drift = 0;
    const bars = [], fromT = new Date(from).getTime();
    for (let d = new Date(Math.min(SYNTH_ORIGIN, fromT)); d <= to; d = addDays(d, 1)) {
      const wd = d.getUTCDay();
      if (wd === 0 || wd === 6) continue;
      drift = 0.97 * drift + 0.03 * gauss() * dailyVol * 0.6; // régimes de tendance
      const open = price;
      // léger rappel vers le prix habituel de la paire, pour rester réaliste sur 30 ans
      const close = open * Math.exp(drift + gauss() * dailyVol - 0.0015 * Math.log(open / typical));
      const high = Math.max(open, close) * (1 + Math.abs(gauss()) * dailyVol * 0.5);
      const low = Math.min(open, close) * (1 - Math.abs(gauss()) * dailyVol * 0.5);
      if (d.getTime() >= fromT) bars.push({ date: iso(d), open: open, high: high, low: low, close: close });
      price = close;
    }
    return bars;
  }

  // CSV : colonnes date, open, high, low, close (en-tête facultatif, séparateur , ; ou tabulation).
  function parseCSV(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error('Fichier CSV vide');
    const sep = [';', '\t', ','].find((s) => lines[0].includes(s)) || ',';
    let cols = { date: 0, time: -1, open: 1, high: 2, low: 3, close: 4, spread: -1 };
    let startLine = 0;
    const head = lines[0].split(sep).map((h) => h.replace(/[<>"']/g, '').trim().toLowerCase());
    if (head.some((h) => /date|time|open|close|ouv|clot|clôt/.test(h))) {
      const find = (re) => head.findIndex((h) => re.test(h));
      cols = {
        date: find(/date|^time$|timestamp|^dt$/), time: find(/^time$|heure/),
        open: find(/open|ouv/), high: find(/high|haut/), low: find(/low|bas/), close: find(/close|clot|clôt|^price$|^prix$/),
        spread: find(/^spread$/),
      };
      if (cols.time === cols.date) cols.time = -1;
      if (cols.date < 0 || cols.close < 0) throw new Error('Colonnes « date » et « close » introuvables dans l\'en-tête');
      startLine = 1;
    }
    const num = (s) => Number(String(s).replace(/"/g, '').replace(',', '.'));
    const bars = [];
    for (let i = startLine; i < lines.length; i++) {
      const f = lines[i].split(sep);
      const close = num(f[cols.close]);
      if (!Number.isFinite(close)) continue;
      const open = cols.open >= 0 ? num(f[cols.open]) : close;
      const high = cols.high >= 0 ? num(f[cols.high]) : Math.max(open, close);
      const low = cols.low >= 0 ? num(f[cols.low]) : Math.min(open, close);
      let date = String(f[cols.date]).replace(/"/g, '').trim().replace(/\./g, '-');
      if (cols.time >= 0 && f[cols.time]) date += ' ' + String(f[cols.time]).replace(/"/g, '').trim();
      const bar = { date: date, open: open, high: Math.max(high, open, close), low: Math.min(low, open, close), close: close };
      if (cols.spread >= 0) { const sp = num(f[cols.spread]); if (Number.isFinite(sp)) bar.spreadPoints = sp; }
      bars.push(bar);
    }
    if (bars.length < 30) throw new Error('Le CSV doit contenir au moins 30 lignes de cotations valides');
    bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return bars;
  }

  /**
   * Mèches estimées pour des données à un seul prix par bougie (cours BCE).
   * L'amplitude d'une bougie vaut en moyenne 2 fois la variation moyenne d'une clôture à l'autre
   * (valeur théorique d'une marche aléatoire, mesurée à 1,9-2,0 sur EUR/USD réel en H1 et D1).
   * Sur 200 stratégies avec stop-loss, cette estimation divise par deux l'écart de rendement
   * avec les vraies bougies et ramène l'écart du nombre de trades de 34 % à 8 % (voir README).
   */
  const WICK_FACTOR = 2.0, WICK_LOOKBACK = 20;
  function estimateWicks(bars, factor, lookback) {
    factor = factor || WICK_FACTOR; lookback = lookback || WICK_LOOKBACK;
    const out = [];
    let sum = 0;
    const diffs = [];
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      if (i > 0) { const d = Math.abs(b.close - bars[i - 1].close); diffs.push(d); sum += d; if (diffs.length > lookback) sum -= diffs.shift(); }
      const range = diffs.length ? factor * sum / diffs.length : 0;
      const top = Math.max(b.open, b.close), bottom = Math.min(b.open, b.close);
      const wick = Math.max(0, range - (top - bottom)) / 2;
      out.push(Object.assign({}, b, { high: Math.max(b.high, top + wick), low: Math.min(b.low, bottom - wick), estimated: true }));
    }
    return out;
  }
  /** Vrai si les bougies ont de vrais plus hauts / plus bas (et pas seulement ouverture et clôture). */
  function hasRealRange(bars) {
    let k = 0;
    for (const b of bars) if (b.high > Math.max(b.open, b.close) + 1e-12 || b.low < Math.min(b.open, b.close) - 1e-12) k++;
    return bars.length > 0 && k / bars.length > 0.3;
  }
  /** Unité de temps détectée d'après l'écart médian entre deux bougies. */
  function detectTimeframe(bars) {
    const t = (s) => Date.parse(s.length > 10 ? s.replace(' ', 'T').slice(0, 19) + 'Z' : s + 'T00:00:00Z');
    const gaps = [];
    for (let i = 1; i < Math.min(bars.length, 400); i++) { const g = (t(bars[i].date) - t(bars[i - 1].date)) / 60000; if (g > 0) gaps.push(g); }
    gaps.sort((a, b) => a - b);
    const m = gaps[Math.floor(gaps.length / 2)] || 1440;
    const TF = [[1, 'M1'], [5, 'M5'], [15, 'M15'], [30, 'M30'], [60, 'H1'], [240, 'H4'], [1440, 'D1'], [10080, 'W1']];
    return TF.reduce((best, x) => (Math.abs(Math.log(x[0] / m)) < Math.abs(Math.log(best[0] / m)) ? x : best))[1];
  }
  // Spreads habituels (pips) d'un courtier standard, utilisés par défaut.
  const TYPICAL_SPREAD = {
    'EUR/USD': 1.0, 'GBP/USD': 1.5, 'USD/JPY': 1.2, 'USD/CHF': 1.6, 'AUD/USD': 1.4, 'USD/CAD': 1.8, 'NZD/USD': 1.9,
    'EUR/GBP': 1.6, 'EUR/JPY': 2.0, 'GBP/JPY': 3.0, 'EUR/CHF': 2.0, 'AUD/JPY': 2.2, 'EUR/AUD': 2.6, 'GBP/CHF': 3.2,
  };

  /** Index de la première barre dont la date >= start (les barres précédentes servent d'historique). */
  // ---------- Unités de temps (graphique) ----------
  const TF_SECONDS = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400, W1: 604800, MN: 2592000 };
  const TF_ORDER = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN'];
  function barTime(b) {
    if (b.t !== undefined) return b.t;
    const d = String(b.date);
    return Date.parse(d.length > 10 ? d.slice(0, 10) + 'T' + d.slice(11, 16) + ':00Z' : d.slice(0, 10) + 'T00:00:00Z') / 1000;
  }
  function tfBucket(t, tf) {
    if (tf === 'W1') return Math.floor((t / 86400 + 3) / 7); // semaines du lundi au dimanche
    if (tf === 'MN') { const d = new Date(t * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
    return Math.floor(t / TF_SECONDS[tf]);
  }
  /** Regroupe des bougies dans une unité de temps supérieure (H4, D1, W1, MN…), comme MT4 / MT5. */
  function resample(bars, tf) {
    const out = [];
    let key = null;
    for (const b of bars) {
      const t = barTime(b), k = tfBucket(t, tf);
      if (k !== key) {
        key = k;
        out.push({ date: tf === 'D1' || tf === 'W1' || tf === 'MN' ? String(b.date).slice(0, 10) : b.date, t: t, open: b.open, high: b.high, low: b.low, close: b.close, spread: b.spread });
      } else {
        const x = out[out.length - 1];
        if (b.high > x.high) x.high = b.high;
        if (b.low < x.low) x.low = b.low;
        x.close = b.close;
      }
    }
    return out;
  }

  function indexFrom(bars, startDate) {
    const s = iso(startDate);
    const i = bars.findIndex((b) => b.date.slice(0, 10) >= s);
    return i < 0 ? bars.length : i;
  }

  root.Forexia.data = {
    TF_SECONDS, TF_ORDER, barTime, resample,
    PAIRS, PERIODS, ECB_FIRST_DATE, TYPICAL_SPREAD, WICK_FACTOR, periodRange, customRange, estimateWicks, hasRealRange, detectTimeframe, fetchFrankfurter, generateSynthetic, parseCSV, indexFrom, barsFromCloses, iso, addMonths,
  };
})(typeof window !== 'undefined' ? window : globalThis);
