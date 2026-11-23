/* Forexia — score de confiance d'un plan (FX).
 *
 * Mesures de la littérature, calculées sur les simulations Forexia du plan :
 *  1. Deflated Sharpe Ratio (Bailey & López de Prado, 2014), construit sur le Probabilistic Sharpe Ratio
 *     (Bailey & López de Prado, 2012) : probabilité que le vrai ratio de Sharpe mensuel soit > 0, en tenant compte
 *     de la durée d'historique, de l'asymétrie et de l'aplatissement des rendements, et du nombre d'essais
 *     (plus on a testé de variantes, plus le meilleur résultat peut être dû au hasard).
 *  2. Test de Student (unilatéral) sur le résultat à un an : probabilité que le résultat moyen soit > 0, avec un
 *     nombre effectif de simulations corrigé du chevauchement des périodes.
 *  3. Cohérence entre époques (à la manière d'une validation « walk-forward ») : part des époques de marché où le
 *     plan gagne, lissée par la règle de succession de Laplace.
 *  Score = 100 × moyenne géométrique des trois probabilités × facteur données (1 pour des cours réels,
 *  0,4 pour des données simulées). */
(function (root) {
  'use strict';
  const F = root.Forexia = root.Forexia || {};
  const EULER = 0.5772156649;

  // Loi normale : fonction de répartition (Abramowitz & Stegun 7.1.26) et quantile (algorithme d'Acklam).
  function normCdf(x) {
    const s = x < 0 ? -1 : 1, z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return 0.5 * (1 + s * y);
  }
  function normInv(p) {
    if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  // Loi de Student : fonction de répartition via la fonction bêta incomplète régularisée (fraction continue).
  function lgamma(x) {
    const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, tmp = x + 5.5, ser = 1.000000000190015;
    tmp -= (x + 0.5) * Math.log(tmp);
    for (let j = 0; j < 6; j++) ser += g[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }
  function betacf(a, b, x) {
    let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - (qab * x) / qap;
    if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d; let h = d;
    for (let m = 1; m <= 200; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; h *= d * c;
      aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < 3e-12) break;
    }
    return h;
  }
  function betai(a, b, x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
  }
  function tCdf(t, df) {
    if (!(df > 0)) return NaN;
    const x = df / (df + t * t), p = 0.5 * betai(df / 2, 0.5, x);
    return t >= 0 ? 1 - p : p;
  }
  /** Moyenne, écart-type, asymétrie (γ3) et aplatissement (γ4, non centré : 3 pour une loi normale). */
  function moments(a) {
    const n = a.length;
    if (n < 2) return { n: n, mean: n ? a[0] : 0, sd: 0, skew: 0, kurt: 3 };
    const m = a.reduce((s, v) => s + v, 0) / n;
    let m2 = 0, m3 = 0, m4 = 0;
    for (const v of a) { const d = v - m; m2 += d * d; m3 += d * d * d; m4 += d * d * d * d; }
    m2 /= n; m3 /= n; m4 /= n;
    const sd = Math.sqrt(m2);
    return { n: n, mean: m, sd: Math.sqrt((m2 * n) / (n - 1)), skew: sd > 0 ? m3 / Math.pow(sd, 3) : 0, kurt: sd > 0 ? m4 / (m2 * m2) : 3 };
  }
  /** Écart-type de l'estimateur du ratio de Sharpe (Mertens 2002 ; Bailey & López de Prado 2012). */
  function srStd(sr, T, skew, kurt) {
    const v = (1 - skew * sr + ((kurt - 1) / 4) * sr * sr) / Math.max(1, T - 1);
    return Math.sqrt(Math.max(1e-12, v));
  }
  /** Probabilistic Sharpe Ratio : P(vrai Sharpe > sr0). */
  function psr(sr, T, skew, kurt, sr0) { return normCdf((sr - (sr0 || 0)) / srStd(sr, T, skew, kurt)); }
  /** Seuil du Deflated Sharpe Ratio : Sharpe maximal attendu par hasard parmi N essais. */
  function dsrThreshold(N, sigmaSR) {
    if (!(N > 1)) return 0;
    return sigmaSR * ((1 - EULER) * normInv(1 - 1 / N) + EULER * normInv(1 - 1 / (N * Math.E)));
  }
  /**
   * Score de confiance d'un plan.
   * input = { monthly: [rendements mensuels, en fraction], periods: [{from, to}] (une par simulation),
   *           oneYear: [résultat à un an, en %] (une par simulation), eras: {win, total}, synthetic, trials }
   */
  function score(input) {
    const out = { parts: {}, details: {} };
    // nombre effectif d'observations : mois distincts couverts (les périodes qui se chevauchent comptent une fois)
    const months = new Set(); let sumM = 0;
    for (const p of input.periods || []) {
      const a = new Date(p.from), b = new Date(p.to);
      for (let y = a.getUTCFullYear(), m = a.getUTCMonth(); y < b.getUTCFullYear() || (y === b.getUTCFullYear() && m <= b.getUTCMonth()); m++) { if (m > 11) { m = 0; y++; } months.add(y * 12 + m); sumM++; }
    }
    const T = Math.max(2, months.size), overlap = sumM ? months.size / sumM : 1;
    out.details.T = T; out.details.overlap = overlap;
    // 1) Deflated Sharpe Ratio sur les rendements mensuels
    const mr = (input.monthly || []).filter(Number.isFinite);
    if (mr.length >= 6) {
      const mo = moments(mr), sr = mo.sd > 0 ? mo.mean / mo.sd : 0, N = Math.max(1, input.trials || 1);
      const sig = srStd(sr, T, mo.skew, mo.kurt), sr0 = dsrThreshold(N, sig);
      out.parts.dsr = normCdf((sr - sr0) / sig);
      Object.assign(out.details, { sr: sr, srAnnual: sr * Math.sqrt(12), skew: mo.skew, kurt: mo.kurt, sigmaSR: sig, sr0: sr0, trials: N, psr: psr(sr, T, mo.skew, mo.kurt, 0), nMonthly: mr.length });
    }
    // 2) Test de Student unilatéral sur le résultat à un an, avec n effectif
    const y1 = (input.oneYear || []).filter(Number.isFinite);
    if (y1.length >= 2) {
      const mo = moments(y1), nEff = Math.max(2, y1.length * Math.min(1, overlap));
      const t = mo.sd > 0 ? mo.mean / (mo.sd / Math.sqrt(nEff)) : (mo.mean > 0 ? 10 : -10);
      out.parts.student = tCdf(t, nEff - 1);
      Object.assign(out.details, { y1Mean: mo.mean, y1Sd: mo.sd, nEff: nEff, t: t });
    }
    // 3) Cohérence entre époques (Laplace)
    const er = input.eras || { win: 0, total: 0 };
    out.parts.eras = (er.win + 1) / (er.total + 2);
    out.details.eras = er;
    // score : moyenne géométrique × facteur données
    const ps = Object.values(out.parts).map((p) => Math.min(0.999, Math.max(0.001, p)));
    const geo = Math.exp(ps.reduce((s, p) => s + Math.log(p), 0) / ps.length);
    out.data = input.synthetic ? 0.4 : 1;
    out.score = Math.round(100 * geo * out.data);
    return out;
  }

  F.confidence = { score, psr, srStd, dsrThreshold, moments, normCdf, normInv, tCdf };
})(typeof window !== 'undefined' ? window : globalThis);
