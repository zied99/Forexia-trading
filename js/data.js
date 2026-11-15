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

  function generateSynthetic(pair, from, to) {
    const rand = rng(hash(pair + iso(to)));
    const gauss = () => { const u = rand() || 1e-9, v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const dailyVol = (/JPY/.test(pair) ? 0.0065 : 0.005);
    let price = TYPICAL[pair] || 1, drift = 0;
    const bars = [];
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
      const wd = d.getUTCDay();
      if (wd === 0 || wd === 6) continue;
      drift = 0.97 * drift + 0.03 * gauss() * dailyVol * 0.6; // régimes de tendance
      const open = price;
      const close = open * Math.exp(drift + gauss() * dailyVol);
      const high = Math.max(open, close) * (1 + Math.abs(gauss()) * dailyVol * 0.5);
      const low = Math.min(open, close) * (1 - Math.abs(gauss()) * dailyVol * 0.5);
      bars.push({ date: iso(d), open: open, high: high, low: low, close: close });
      price = close;
    }
    return bars;
  }

  // CSV : colonnes date, open, high, low, close (en-tête facultatif, séparateur , ; ou tabulation).
  function parseCSV(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error('Fichier CSV vide');
    const sep = [';', '\t', ','].find((s) => lines[0].includes(s)) || ',';
    let cols = { date: 0, time: -1, open: 1, high: 2, low: 3, close: 4 };
    let startLine = 0;
    const head = lines[0].split(sep).map((h) => h.replace(/[<>"']/g, '').trim().toLowerCase());
    if (head.some((h) => /date|time|open|close|ouv|clot|clôt/.test(h))) {
      const find = (re) => head.findIndex((h) => re.test(h));
      cols = {
        date: find(/date|^time$|timestamp|^dt$/), time: find(/^time$|heure/),
        open: find(/open|ouv/), high: find(/high|haut/), low: find(/low|bas/), close: find(/close|clot|clôt|^price$|^prix$/),
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
      bars.push({ date: date, open: open, high: Math.max(high, open, close), low: Math.min(low, open, close), close: close });
    }
    if (bars.length < 30) throw new Error('Le CSV doit contenir au moins 30 lignes de cotations valides');
    bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return bars;
  }

  /** Index de la première barre dont la date >= start (les barres précédentes servent d'historique). */
  function indexFrom(bars, startDate) {
    const s = iso(startDate);
    const i = bars.findIndex((b) => b.date.slice(0, 10) >= s);
    return i < 0 ? bars.length : i;
  }

  root.Forexia.data = {
    PAIRS, PERIODS, ECB_FIRST_DATE, periodRange, customRange, fetchFrankfurter, generateSynthetic, parseCSV, indexFrom, barsFromCloses, iso, addMonths,
  };
})(typeof window !== 'undefined' ? window : globalThis);
