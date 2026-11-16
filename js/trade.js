/* Forexia 1.2 — gestion des trades commune aux moteurs (standard et courtier) et reproduite par l'EA :
 * distances en pips ou en multiples d'ATR, stop suiveur, passage à l'équilibre, pause après des pertes,
 * filtre d'annonces économiques. */
(function (root) {
  'use strict';
  const F = root.Forexia;

  /** Vrai si la stratégie utilise l'ATR (stops, objectif, stop suiveur ou passage à l'équilibre). */
  function usesAtr(st) { return st.stopAtr > 0 || st.takeAtr > 0 || st.trailAtr > 0 || st.breakevenAtr > 0; }
  function atrSeries(bars, st) { return usesAtr(st) ? F.indicators.atr(bars.map((b) => b.high), bars.map((b) => b.low), bars.map((b) => b.close), st.atrPeriod || 14) : null; }

  /** Distances (en prix) : multiple d'ATR si demandé et disponible, sinon pips ; 0 = aucune. */
  function distances(st, atrValue, pip) {
    const a = Number.isFinite(atrValue) ? atrValue : 0;
    const pick = (mult, pips) => (mult > 0 && a > 0 ? mult * a : pips > 0 ? pips * pip : 0);
    return { sl: pick(st.stopAtr, st.stopLossPips), tp: pick(st.takeAtr, st.takeProfitPips), trail: pick(st.trailAtr, st.trailPips), be: pick(st.breakevenAtr, st.breakevenPips) };
  }

  /**
   * Stop suiveur et passage à l'équilibre, mis à jour après chaque bougie (ou bougie fine) avec le meilleur prix atteint.
   * pos : {dir, sl, trail, be, beDone}, entry : prix d'entrée.
   */
  function updateStops(pos, entry, best) {
    if (pos.trail > 0) {
      const ns = best - pos.dir * pos.trail;
      if (pos.sl === null || (pos.dir > 0 ? ns > pos.sl : ns < pos.sl)) pos.sl = ns;
    }
    if (pos.be > 0 && !pos.beDone && (best - entry) * pos.dir >= pos.be) {
      pos.beDone = true;
      if (pos.sl === null || (pos.dir > 0 ? entry > pos.sl : entry < pos.sl)) pos.sl = entry;
    }
  }

  /** Pause : après N pertes consécutives, pas de nouvelle entrée pendant P bougies. */
  function makePause(st) {
    const N = st.pauseLosses > 0 ? st.pauseLosses : 0, P = st.pauseBars > 0 ? st.pauseBars : 0;
    let streak = 0, until = -1;
    return {
      onClose(i, pnl) {
        if (!N) return;
        streak = pnl < 0 ? streak + 1 : 0;
        if (streak >= N) { until = i + P; streak = 0; }
      },
      blocked(k) { return N > 0 && k <= until; },
    };
  }

  /**
   * Annonces économiques : news = {times: [secondes triées], before: minutes, after: minutes, mode: 'block' | 'close'}.
   * hits(start, end) : vrai si la fenêtre [annonce - before, annonce + after] croise [start, end).
   */
  function makeNews(news) {
    const times = news && news.times && news.times.length ? news.times : null;
    const before = ((news && news.before) || 0) * 60, after = ((news && news.after) || 0) * 60;
    function hits(start, end) {
      if (!times) return false;
      let lo = 0, hi = times.length;
      const from = start - after;
      while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] < from) lo = m + 1; else hi = m; }
      return lo < times.length && times[lo] < end + before;
    }
    return { active: !!times, closeMode: !!times && news.mode === 'close', hits: hits };
  }

  F.trade = { usesAtr, atrSeries, distances, updateStops, makePause, makeNews };
})(typeof window !== 'undefined' ? window : globalThis);
