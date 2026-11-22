/* Forexia — analyse de l'historique des évaluations et recommandations.
 *
 * Calcul local et transparent (pas de modèle externe) : les simulations sont regroupées par stratégie,
 * paire, durée de période, type de retrait et levier ; chaque groupe reçoit une note « robuste »
 * qui tient compte du nombre de simulations (un seul bon résultat ne suffit pas). */
(function (root) {
  'use strict';
  const F = root.Forexia = root.Forexia || {};

  const DAY = 864e5;
  function days(e) { return Math.max(1, Math.round((Date.parse(e.to) - Date.parse(e.from)) / DAY)); }
  function months(e) { return days(e) / 30.4375; }
  // Note d'une simulation : rendement − ½ drawdown (comme « Améliorer »).
  function scoreOf(e) { return e.returnPct - 0.5 * e.maxDrawdownPct; }
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; }

  /** Durée de la période testée, par tranche. */
  function horizonOf(e) {
    const m = months(e);
    return m <= 3.2 ? 'court' : m <= 12.5 ? 'moyen' : 'long';
  }
  const HORIZON_LABEL = { court: 'Court terme (≤ 3 mois)', moyen: 'Moyen terme (3 à 12 mois)', long: 'Long terme (> 1 an)' };

  /** Type de retrait d'une simulation, en clair. */
  function withdrawOf(e) {
    const w = e.config && e.config.withdraw;
    if (!w || !w.on) return { key: 'none', label: 'Sans retrait', kind: 'none' };
    if (w.mode === 'periodic') {
      const every = w.every === 'days' ? 'tous les ' + w.days + ' jours' : 'chaque mois';
      const what = w.type === 'fixed' ? w.value + ' (somme fixe)' : w.type === 'excess' ? w.value + ' % de l\'excédent' : w.value + ' % du compte';
      return { key: 'p|' + w.type + '|' + w.value + '|' + every, label: 'Régulier : ' + what + ' ' + every, kind: w.type === 'excess' ? 'excess' : 'constant' };
    }
    return { key: 't|' + w.pct + '|' + w.share + '|' + w.when, label: 'Au seuil : +' + w.pct + ' % de gain' + (Number(w.share) < 100 ? ', ' + w.share + ' % du gain' : '') +
      (w.when === 'immediate' ? ' (dès le seuil)' : ' (à la clôture)'), kind: 'gain' };
  }

  /** Statistiques d'un groupe ; « robust » rapproche de 0 les groupes de peu de simulations. */
  function groupStats(key, label, list) {
    const ret = list.map((e) => e.returnPct), sc = list.map(scoreOf);
    const n = list.length;
    return {
      key: key, label: label, n: n, entries: list,
      meanRet: mean(ret), medianRet: median(ret), posRate: (list.filter((e) => e.returnPct > 0).length / n) * 100,
      meanDD: mean(list.map((e) => e.maxDrawdownPct)), meanScore: mean(sc), medianScore: median(sc),
      // note robuste : médiane (insensible à un résultat extrême), part de gagnantes, et moins de poids si peu de simulations
      robust: (median(sc) + 0.2 * ((list.filter((e) => e.returnPct > 0).length / n) * 100 - 50)) * (n / (n + 2)),
      perMonth: mean(list.map((e) => e.returnPct / months(e))), withdrawn: mean(list.map((e) => e.withdrawn || 0)),
      withdrawnPerMonth: mean(list.map((e) => (e.withdrawn || 0) / months(e))), medianPerMonth: median(list.map((e) => e.returnPct / months(e))),
    };
  }
  function groupBy(list, keyFn, labelFn) {
    const m = new Map();
    for (const e of list) {
      const k = keyFn(e);
      if (!m.has(k)) m.set(k, { label: labelFn ? labelFn(e) : k, list: [] });
      m.get(k).list.push(e);
    }
    return [...m].map(([k, g]) => groupStats(k, g.label, g.list)).sort((a, b) => b.robust - a.robust);
  }
  const confidence = (n) => (n >= 8 ? 'forte' : n >= 4 ? 'moyenne' : 'faible');

  /**
   * list : évaluations (tableau d'objets du tableau « Évaluation »).
   * Renvoie { groups: {strategy, pair, horizon, withdraw, leverage}, recos: [{title, text, level, confidence}], warnings }.
   */
  function analyze(list) {
    const out = { n: list.length, groups: {}, recos: [], warnings: [] };
    if (!list.length) return out;
    const G = out.groups;
    G.strategy = groupBy(list, (e) => e.name);
    G.pair = groupBy(list, (e) => e.pair);
    G.horizon = groupBy(list, horizonOf, (e) => HORIZON_LABEL[horizonOf(e)]);
    G.withdraw = groupBy(list, (e) => withdrawOf(e).key, (e) => withdrawOf(e).label);
    G.leverage = groupBy(list, (e) => '1:' + e.leverage);
    G.data = groupBy(list, (e) => e.data);
    const fmt = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ',') + ' %';
    const line = (g) => 'résultat médian ' + fmt(g.medianRet) + (g.n > 2 && Math.abs(g.meanRet - g.medianRet) > 5 ? ' (moyenne ' + fmt(g.meanRet) + ', tirée par des résultats extrêmes)' : '') +
      ' sur ' + g.n + ' simulation' + (g.n > 1 ? 's' : '') + ', ' + Math.round(g.posRate) + ' % gagnantes, drawdown moyen −' + g.meanDD.toFixed(1).replace('.', ',') + ' %';

    // 1. Stratégie
    const bestS = G.strategy[0];
    if (G.strategy.length > 1 || bestS.n > 1) {
      const second = G.strategy[1];
      out.recos.push({
        id: 'strategy', title: 'Meilleure stratégie', pick: bestS.label, confidence: confidence(bestS.n), level: bestS.medianRet > 0 && bestS.posRate >= 50 ? 'good' : 'warn',
        text: '« ' + bestS.label + ' » : ' + line(bestS) + '.' + (second ? ' Ensuite : « ' + second.label + ' » (médiane ' + fmt(second.medianRet) + ', ' + second.n + ' simulation' + (second.n > 1 ? 's' : '') + ').' : '') +
          (bestS.medianRet <= 0 ? ' Aucune stratégie n\'est gagnante dans la majorité des cas : améliorez-la avant de la déployer.' : bestS.n < 4 ? ' Trop peu de simulations pour conclure : lancez un lot de tests aléatoires.' : ''),
      });
    }
    // 2. Paire (pour la meilleure stratégie si elle a été testée sur plusieurs paires)
    const pairs = groupBy(bestS.entries, (e) => e.pair);
    const pairSrc = pairs.length > 1 ? pairs : G.pair;
    if (pairSrc.length > 1) {
      const p = pairSrc[0], worst = pairSrc[pairSrc.length - 1];
      out.recos.push({
        id: 'pair', title: 'Meilleure paire', pick: p.label, confidence: confidence(p.n), level: p.medianRet > 0 ? 'good' : 'warn',
        text: p.label + (pairs.length > 1 ? ' pour « ' + bestS.label + ' »' : '') + ' : ' + line(p) + '. À éviter : ' + worst.label + ' (médiane ' + fmt(worst.medianRet) + ').',
      });
    } else out.recos.push({ id: 'pair', title: 'Meilleure paire', pick: G.pair[0].label, confidence: 'faible', level: 'info',
      text: 'Une seule paire testée (' + G.pair[0].label + ') : testez la stratégie sur d\'autres paires pour vérifier qu\'elle n\'est pas propre à celle-ci (bouton « Améliorer » → « Tester sur d\'autres paires »).' });

    // 3. Horizon : court, moyen ou long terme (sur la meilleure stratégie si possible)
    const hz = groupBy(bestS.entries.length >= 4 ? bestS.entries : list, horizonOf, (e) => HORIZON_LABEL[horizonOf(e)]).filter((g) => g.n >= 2);
    if (hz.length >= 2) {
      // comparaison à durée égale : réussite et rendement par mois
      hz.sort((a, b) => (b.posRate - a.posRate) || (b.medianPerMonth - a.medianPerMonth));
      const h = hz[0], other = hz[hz.length - 1];
      const kind = h.key === 'long' ? 'une stratégie de long terme' : h.key === 'court' ? 'une stratégie de court terme' : 'une stratégie de moyen terme';
      out.recos.push({
        id: 'horizon', title: 'Court ou long terme ?', pick: h.label, confidence: confidence(Math.min(h.n, other.n)), level: h.posRate > other.posRate + 10 ? 'good' : 'info',
        text: 'Plutôt ' + kind + ' : ' + h.label.toLowerCase() + ', ' + Math.round(h.posRate) + ' % de périodes gagnantes (médiane ' + fmt(h.medianPerMonth) + ' par mois) contre ' + Math.round(other.posRate) + ' % sur ' +
          other.label.toLowerCase() + ' (médiane ' + fmt(other.medianPerMonth) + ' par mois).' + (h.posRate - other.posRate <= 10 ? ' Écart faible : la durée compte peu pour cette stratégie.' : ''),
      });
    } else {
      out.recos.push({ id: 'horizon', title: 'Court ou long terme ?', confidence: 'faible', level: 'info',
        text: 'Pas assez de périodes de durées différentes. Lancez un lot de tests aléatoires « au plus 3 mois », puis un autre « au moins 1 an », et comparez.' });
    }
    // 4. Retraits : comparés sur la meilleure stratégie si elle a été testée avec plusieurs réglages, sinon sur tout l'historique
    const wdOwn = groupBy(bestS.entries, (e) => withdrawOf(e).key, (e) => withdrawOf(e).label);
    const wd = wdOwn.length >= 2 ? wdOwn : G.withdraw;
    if (wd.length >= 2) {
      const w = wd[0], second = wd[1];
      const gain = wd.filter((g) => g.key.startsWith('t|'))[0], regular = wd.filter((g) => g.key.startsWith('p|'))[0], none = wd.find((g) => g.key === 'none');
      const per = (g) => (g.withdrawnPerMonth > 0 ? ', ' + Math.round(g.withdrawnPerMonth) + ' retirés par mois en moyenne' : '');
      let cmp = ' Ensuite : ' + second.label.toLowerCase() + ' (médiane ' + fmt(second.medianRet) + per(second) + ').';
      if (gain && regular) {
        cmp += ' Retrait suite à un gain : médiane ' + fmt(gain.medianRet) + per(gain) + ' ; retrait régulier : médiane ' + fmt(regular.medianRet) + per(regular) + '. ' +
          (gain.robust >= regular.robust ? 'Le retrait au seuil préserve mieux le capital.' : 'Le retrait régulier donne un revenu plus stable sans trop pénaliser le capital.');
      } else if (none && (gain || regular) && w.key !== 'none') cmp += ' Retirer ne dégrade pas le résultat global : vous pouvez encaisser une partie des gains.';
      else if (none && w.key === 'none') cmp += ' Laisser les gains travailler (sans retrait) donne ici le meilleur résultat.';
      out.recos.push({ id: 'withdraw', title: 'Quel retrait ?', pick: w.label, confidence: confidence(Math.min(w.n, second.n)), level: w.medianRet > 0 ? 'good' : 'warn',
        text: w.label + (wdOwn.length >= 2 ? ' pour « ' + bestS.label + ' »' : '') + ' : ' + line(w) + ' (compte + retraits).' + cmp +
          (wdOwn.length < 2 ? ' Comparaison faite sur des stratégies différentes : à confirmer en relançant la même stratégie avec chaque type de retrait.' : '') });
    } else {
      out.recos.push({ id: 'withdraw', title: 'Quel retrait ?', confidence: 'faible', level: 'info',
        text: 'Toutes ces simulations utilisent le même réglage de retrait (' + (wd[0] ? wd[0].label.toLowerCase() : 'aucun') + '). Relancez avec un retrait au seuil (ex. +10 %) puis un retrait régulier mensuel pour les comparer.' });
    }
    // 5. Levier
    if (G.leverage.length >= 2) {
      const l = G.leverage[0], risky = G.leverage.slice().sort((a, b) => b.meanDD - a.meanDD)[0];
      out.recos.push({ id: 'leverage', title: 'Quel levier ?', pick: l.label, confidence: confidence(l.n), level: l.meanDD < 25 ? 'good' : 'warn',
        text: 'Levier ' + l.label + ' : ' + line(l) + '.' + (risky.key !== l.key ? ' Le levier ' + risky.label + ' a le drawdown le plus fort (−' + risky.meanDD.toFixed(1).replace('.', ',') + ' %).' : '') });
    }
    // Mises en garde
    const synth = list.filter((e) => /simul/i.test(e.data)).length;
    if (synth) out.warnings.push(synth + ' simulation' + (synth > 1 ? 's' : '') + ' sur ' + list.length + ' utilisent des données simulées (marche aléatoire) : elles ne disent rien du marché réel.');
    if (list.length < 10) out.warnings.push('Seulement ' + list.length + ' simulation' + (list.length > 1 ? 's' : '') + ' : les recommandations sont fragiles. Un lot de 10 à 20 tests aléatoires les rend plus fiables.');
    return out;
  }

  // ---------- Analyse temporelle : la stratégie marche-t-elle mieux à certaines époques ? ----------
  /** Année du milieu de la période testée (une simulation de 2 ans compte pour l'année de son milieu). */
  function midYear(e) { return new Date((Date.parse(e.from) + Date.parse(e.to)) / 2).getUTCFullYear(); }
  const ERAS = [
    { from: -Infinity, to: 1999, label: 'Avant 2000' },
    { from: 2000, to: 2007, label: '2000 – 2007' },
    { from: 2008, to: 2012, label: '2008 – 2012 (crise financière)' },
    { from: 2013, to: 2019, label: '2013 – 2019' },
    { from: 2020, to: Infinity, label: 'Depuis 2020' },
  ];
  /** Corrélation de rang (Spearman) entre l'année et le résultat : > 0 = meilleur avec le temps. */
  function rankCorr(xs, ys) {
    const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(a.length); for (let k = 0; k < idx.length;) { let j = k; while (j + 1 < idx.length && idx[j + 1][0] === idx[k][0]) j++; for (let t = k; t <= j; t++) r[idx[t][1]] = (k + j) / 2; k = j + 1; } return r; };
    const rx = rank(xs), ry = rank(ys), mx = mean(rx), my = mean(ry);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < xs.length; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
    return dx && dy ? num / Math.sqrt(dx * dy) : 0;
  }
  /**
   * list : évaluations. Renvoie {
   *   minYear, maxYear, byYear: [groupStats + year], byEra: [groupStats + era], corr,
   *   split: {year, before, after} (rupture la plus nette, au moins 3 simulations de chaque côté) ou null,
   *   verdict: [phrases], weak: {from, to, label} | null, strong: idem, gaps: [{from, to}] }
   */
  function timeline(list) {
    const L = list.filter((e) => e.from && e.to);
    const out = { n: L.length, byYear: [], byEra: [], corr: 0, split: null, verdict: [], weak: null, strong: null, gaps: [] };
    if (!L.length) return out;
    out.minYear = Math.min(...L.map((e) => +e.from.slice(0, 4)));
    out.maxYear = Math.max(...L.map((e) => +e.to.slice(0, 4)));
    const yrs = new Map();
    for (const e of L) { const y = midYear(e); if (!yrs.has(y)) yrs.set(y, []); yrs.get(y).push(e); }
    out.byYear = [...yrs].sort((a, b) => a[0] - b[0]).map(([y, l]) => Object.assign(groupStats(String(y), String(y), l), { year: y }));
    out.byEra = ERAS.map((er) => { const l = L.filter((e) => { const y = midYear(e); return y >= er.from && y <= er.to; }); return l.length ? Object.assign(groupStats(er.label, er.label, l), { era: er }) : null; }).filter(Boolean);
    if (L.length >= 4) out.corr = rankCorr(L.map(midYear), L.map((e) => e.returnPct));
    // rupture : l'année qui sépare le mieux les bons et les mauvais résultats
    const cands = [...new Set(L.map(midYear))].sort((a, b) => a - b).slice(1);
    let best = null;
    for (const y of cands) {
      const b = L.filter((e) => midYear(e) < y), a = L.filter((e) => midYear(e) >= y);
      if (b.length < 4 || a.length < 4) continue;
      const sb = groupStats('b', 'avant ' + y, b), sa = groupStats('a', 'depuis ' + y, a);
      const gap = Math.abs(sa.posRate - sb.posRate) / 100 + Math.abs(Math.tanh((sa.medianRet - sb.medianRet) / 50));
      const m = Math.min(a.length, b.length), w = gap * (m / (m + 2));
      if (!best || w > best.w) best = { year: y, before: sb, after: sa, gap: gap, w: w };
    }
    if (best && best.gap >= 0.5) out.split = best;
    // trous : années sans aucune simulation entre la première et la dernière
    const cover = new Set();
    for (const e of L) for (let y = +e.from.slice(0, 4); y <= +e.to.slice(0, 4); y++) cover.add(y);
    let g = null;
    for (let y = out.minYear; y <= out.maxYear; y++) {
      if (!cover.has(y)) { if (!g) g = { from: y, to: y }; else g.to = y; } else if (g) { out.gaps.push(g); g = null; }
    }
    if (g) out.gaps.push(g);
    // verdict
    const pc = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(0) + ' %';
    const desc = (st) => st.n + ' simulation' + (st.n > 1 ? 's' : '') + ', ' + Math.round(st.posRate) + ' % gagnantes, résultat médian ' + pc(st.medianRet);
    out.verdict.push('Simulations de ' + out.minYear + ' à ' + out.maxYear + ' (classées selon l\'année du milieu de leur période).');
    if (out.split) {
      const { year, before, after } = out.split, better = after.robust > before.robust;
      out.verdict.push('<b>Rupture vers ' + year + '</b> : la stratégie marche ' + (better ? 'nettement mieux depuis ' + year : 'nettement moins bien depuis ' + year) + '. ' +
        'Avant ' + year + ' : ' + desc(before) + '. Depuis ' + year + ' : ' + desc(after) + '.');
      out.weak = better ? { from: out.minYear, to: year - 1, label: 'avant ' + year } : { from: year, to: out.maxYear, label: 'depuis ' + year };
      out.strong = better ? { from: year, to: out.maxYear, label: 'depuis ' + year } : { from: out.minYear, to: year - 1, label: 'avant ' + year };
      if (Math.min(before.n, after.n) < 5) out.verdict.push('Confiance ' + confidence(Math.min(before.n, after.n)) + ' : peu de simulations d\'un côté de la rupture, lancez un lot sur chaque époque pour confirmer.');
    } else if (L.length >= 6) out.verdict.push('Pas de rupture nette dans le temps : les résultats ne dépendent pas clairement de l\'époque.');
    if (Math.abs(out.corr) >= 0.4) out.verdict.push('Tendance générale : les résultats ' + (out.corr > 0 ? 's\'améliorent' : 'se dégradent') + ' avec les années (corrélation de rang ' + out.corr.toFixed(2).replace('.', ',') + ').');
    if (out.byEra.length >= 2) {
      const sorted = out.byEra.slice().sort((a, b) => b.robust - a.robust);
      out.verdict.push('Meilleure époque : <b>' + sorted[0].label + '</b> (' + desc(sorted[0]) + ') ; la plus difficile : <b>' + sorted[sorted.length - 1].label + '</b> (' + desc(sorted[sorted.length - 1]) + ').');
    }
    if (L.length < 8) out.verdict.push('Seulement ' + L.length + ' simulation' + (L.length > 1 ? 's' : '') + ' : l\'analyse temporelle est indicative.');
    return out;
  }

  F.advisor = { timeline, midYear, ERAS, analyze, horizonOf, withdrawOf, groupBy, scoreOf, months, HORIZON_LABEL };
})(typeof window !== 'undefined' ? window : globalThis);
