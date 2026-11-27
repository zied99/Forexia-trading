/* Forexia — cœur des FX, sans interface : utilisé par la page (app.js) et par le serveur MCP (agent).
 *
 *  - retraits fictifs : réglages (wdApply), clé d'une mécanique (wdKey), ligne d'une simulation relancée (wdRow),
 *    indicateurs d'une mécanique sur un ensemble de simulations (wdAgg) ;
 *  - FX (plan d'investissement) à partir de ces lignes (fxFromRows), scénarios (fxPoint), score de confiance ;
 *  - chercheur de FX : manières de retirer (minerMechs), note d'un candidat (minerScore), recherche sur une paire
 *    (minePair) et sélection finale (minerPick). */
(function (root) {
  'use strict';
  const F = root.Forexia = root.Forexia || {};

  // ---------- outils ----------
  const pctile = (a, q) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); if (!v.length) return NaN; const k = (v.length - 1) * q, lo = Math.floor(k), hi = Math.ceil(k); return v[lo] + (v[hi] - v[lo]) * (k - lo); };
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const median = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN; };
  function durationDays(from, to) { return Math.round((Date.parse(String(to).slice(0, 10)) - Date.parse(String(from).slice(0, 10))) / 864e5); }
  const money = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const CUR_NAME = { EUR: 'l\'euro', USD: 'le dollar', GBP: 'la livre sterling', JPY: 'le yen', CHF: 'le franc suisse', CAD: 'le dollar canadien', AUD: 'le dollar australien', NZD: 'le dollar néo-zélandais' };
  const RISK_TXT = ['', 'très faible', 'faible', 'modéré', 'moyen', 'assez élevé', 'élevé', 'très élevé'];

  // ---------- retraits fictifs ----------
  /** Réglages de simulation avec la mécanique de retrait w (null = sans retrait). */
  function wdApply(se, w) {
    const s = Object.assign({}, se);
    for (const k of ['withdrawMode', 'withdrawEvery', 'withdrawDays', 'withdrawType', 'withdrawValue', 'withdrawPct', 'withdrawShare', 'withdrawWhen']) delete s[k];
    if (w && w.on && w.mode !== 'none') {
      if (w.mode === 'periodic') Object.assign(s, { withdrawMode: 'periodic', withdrawEvery: w.every || 'month', withdrawDays: Math.max(15, Number(w.days) || 30), withdrawType: w.type || 'pct', withdrawValue: Number(w.value) || 0 });
      else Object.assign(s, { withdrawPct: Number(w.pct) || 0, withdrawShare: Number(w.share) || 100, withdrawWhen: w.when || 'close' });
    }
    return s;
  }
  /** Clé d'une mécanique (seuls les champs utiles) : sert à retrouver les résultats déjà calculés. */
  const wdKey = (w) => (!w || w.on === false || w.mode === 'none' ? ['none'] : w.mode === 'periodic' ? ['p', w.every, w.every === 'days' ? Math.max(15, Number(w.days) || 30) : '', w.type, Number(w.value)] : ['t', Number(w.pct), Number(w.share), w.when]).join('|');
  function withdrawLabel(se) {
    if (se.withdrawMode !== 'periodic') return 'seuil +' + se.withdrawPct + ' %, ' + (se.withdrawWhen === 'immediate' ? 'dès le seuil' : 'à la clôture');
    const v = se.withdrawType === 'fixed' ? money.format(se.withdrawValue) : se.withdrawValue + ' %' + (se.withdrawType === 'excess' ? ' de l\'excédent' : ' du compte');
    return v + (se.withdrawEvery === 'days' ? ' tous les ' + se.withdrawDays + ' jours' : ' chaque mois');
  }
  const wdDesc = (w) => (w && w.on && w.mode !== 'none' ? withdrawLabel(wdApply({}, w)) + (w.mode !== 'periodic' && Number(w.share) < 100 ? ', ' + w.share + ' % du gain retiré' : '') : 'sans retrait');
  /** Ligne d'une simulation relancée : e = {key, from, to}, base = résultat sans retrait, wd = avec retrait. */
  function wdRow(e, capital, base, wd) {
    const curve = [], dates = wd.dates || [], bDates = base.dates || [];
    // fin de chaque mois : compte avec retrait, retraits cumulés, compte sans retrait (en % du capital de départ)
    const bEnd = {};
    for (let j = 0; j < base.equity.length; j++) bEnd[String(bDates[j] || '').slice(0, 7) || String(j)] = base.equity[j];
    let key = null;
    for (let j = 0; j < wd.equity.length; j++) {
      const d = String(dates[j] || '').slice(0, 7) || String(j);
      const pt = { m: d, acc: Math.round((wd.equity[j] / capital) * 1000) / 10, wd: Math.round(((wd.wealth[j] - wd.equity[j]) / capital) * 1000) / 10, b: bEnd[d] != null ? Math.round((bEnd[d] / capital) * 1000) / 10 : null };
      if (d !== key) { curve.push(pt); key = d; } else curve[curve.length - 1] = pt;
    }
    const s = wd.stats;
    return { key: e.key, from: e.from, to: e.to, capital: capital, t: Date.now(),
      b: { ret: base.stats.returnPct, dd: base.stats.maxDrawdownPct },
      w: { ret: s.returnPct, dd: s.maxDrawdownPct, wd: s.totalWithdrawn || 0, n: s.withdrawals || 0, months: Math.max(1, s.months || 1), final: s.finalAccount }, curve: curve };
  }
  /** Chiffres dérivés d'une simulation relancée : retraits mois par mois, premier retrait, rente annuelle. */
  function wdDerive(r) {
    const monthly = r.curve.map((p, k) => Math.max(0, p.wd - (k ? r.curve[k - 1].wd : 0))); // % du capital retiré ce mois-là
    const first = monthly.findIndex((v) => v > 0);
    const years = Math.max(1 / 12, r.curve.length / 12);
    return { monthly: monthly, first: first >= 0 ? first + 1 : null, withMonths: monthly.filter((v) => v > 0).length, yearly: (r.w.wd / r.capital) * 100 / years, finalPct: (r.w.final / r.capital) * 100 };
  }
  /** Indicateurs d'une mécanique sur un ensemble de simulations. */
  function wdAgg(R) {
    const D = R.map(wdDerive), n = R.length;
    const year = R.map((r) => { const k = Math.min(11, r.curve.length - 1), p = r.curve[k]; return p.acc + p.wd - 100; });
    const months = R.reduce((a, r) => a + r.w.months, 0), totM = D.reduce((a, d) => a + d.monthly.length, 0), withM = D.reduce((a, d) => a + d.withMonths, 0), firsts = D.map((d) => d.first).filter(Boolean);
    const o = {
      wd: R.reduce((a, r) => a + r.w.wd, 0), perMonth: R.reduce((a, r) => a + r.w.wd, 0) / Math.max(1, months), yearly: mean(D.map((d) => d.yearly)),
      ret: mean(R.map((r) => r.w.ret)), year: mean(year), finalMed: median(D.map((d) => d.finalPct)), kept: R.filter((r) => r.w.final >= r.capital).length,
      ruined: R.filter((r) => r.w.final < r.capital * 0.5).length, dd: mean(R.map((r) => r.w.dd)), withPct: (withM / Math.max(1, totM)) * 100,
      first: firsts.length ? mean(firsts) : NaN, n: n,
    };
    // note d'équilibre : ce que la méthode rapporte au total (compte + retraits), moins le risque, plus la préservation du capital
    o.score = o.ret - 0.5 * o.dd + 20 * (o.kept / Math.max(1, n)) - 25 * (o.ruined / Math.max(1, n));
    return o;
  }

  /** Ligne recalée sur le résultat enregistré (« résultat actuel » du tableau) quand la simulation relancée diffère
   *  (données du courtier mises à jour, autre version…) : résultat et baisse maximale enregistrés, courbe mensuelle ajustée
   *  progressivement (chaque mois reçoit la même part de l'écart, la forme de la courbe est gardée). */
  function fxRowFromRecord(r, e) {
    if (!e || !Number.isFinite(e.returnPct) || Math.abs(r.b.ret - e.returnPct) <= 0.5) return r;
    const L = r.curve.length, last = L ? r.curve[L - 1].acc + r.curve[L - 1].wd - 100 : 0, target = e.returnPct;
    const g = Math.max(1e-6, 100 + target) / Math.max(1e-6, 100 + last);
    const fix = (v, k) => (v == null ? v : Math.max(0, v) * Math.pow(g, (k + 1) / Math.max(1, L)));
    const curve = r.curve.map((pt, k) => Object.assign({}, pt, { acc: Math.round(fix(pt.acc + pt.wd, k) * 10) / 10 - pt.wd, b: pt.b == null ? null : Math.round(fix(pt.b, k) * 10) / 10 }));
    const dd = Number.isFinite(e.maxDrawdownPct) ? e.maxDrawdownPct : r.w.dd;
    return Object.assign({}, r, { curve: curve, b: { ret: target, dd: dd }, w: Object.assign({}, r.w, { ret: target, dd: dd, final: r.capital * (1 + target / 100) - (r.w.wd || 0) }) });
  }

  /** Écart dans le temps entre deux simulations (dates de début rangées) : moyenne, écart type, extrêmes (jours), part
   *  des simulations qui chevauchent la suivante. L : [{from, to}]. */
  function spacingOf(L) {
    const S = L.filter((x) => x && x.from && x.to).slice().sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    if (S.length < 3) return null;
    const d = [];
    let over = 0;
    for (let i = 1; i < S.length; i++) { d.push(durationDays(S[i - 1].from, S[i].from)); if (S[i].from <= S[i - 1].to) over++; }
    const m = mean(d), sd = Math.sqrt(d.reduce((a, v) => a + (v - m) * (v - m), 0) / Math.max(1, d.length - 1));
    return { meanDays: m, sdDays: sd, minDays: Math.min(...d), maxDays: Math.max(...d), overlapPct: (over / d.length) * 100, from: S[0].from, to: S[S.length - 1].to };
  }

  // ---------- FX ----------
  function fxPrinciple(strat, pair) {
    const [a, b] = String(pair || '').toUpperCase().split('/'), na = CUR_NAME[a] || a, nb = CUR_NAME[b] || b;
    const vs = na && nb ? na + ' face ' + (nb.startsWith('le ') ? 'au ' + nb.slice(3) : 'à ' + nb) : pair;
    const kind = strat && F.analyzer ? F.analyzer.strategyKind(strat) : 'mixed';
    return kind === 'trend' ? 'Suit les grandes tendances de ' + vs + ' : il achète quand le marché monte durablement, vend quand il baisse.'
      : kind === 'reversion' ? 'Profite des rebonds de ' + vs + ' : il achète après une baisse excessive, vend après une hausse excessive.'
        : 'Combine tendances et rebonds de ' + vs + ' pour entrer au bon moment.';
  }
  /** Note de risque de 1 (très faible) à 7 (très élevé), d'après les pertes possibles et les baisses en cours de route. */
  function fxRiskNote(loss10, ddMed, worstLoss) {
    const m = Math.max(loss10, ddMed * 0.7, worstLoss * 0.5);
    return m <= 2 ? 1 : m <= 5 ? 2 : m <= 10 ? 3 : m <= 20 ? 4 : m <= 35 ? 5 : m <= 60 ? 6 : 7;
  }
  /** Détail par simulation d'un FX, rangé du pire au meilleur, en % du capital : b = récupéré (compte + revenus),
   *  inc = revenu moyen par mois, tot = revenus touchés au total, acc = reste sur le compte, y1 = gain au bout d'un an. */
  function fxSimsFromRows(R) {
    return R.map((r) => {
      const L = Math.max(1, r.curve.length), p = r.curve[Math.min(11, L - 1)], full = L >= 12, b = 100 + r.w.ret;
      const m = Math.max(1, Math.round(durationDays(r.from, r.to) / 30.4375)), tot = (r.w.wd / r.capital) * 100;
      const ann = (v) => (Math.pow(Math.max(0.0001, v / 100), 12 / m) - 1) * 100;
      // rendements mensuels de la valeur totale (compte + revenus touchés)
      const mr = r.curve.map((c, k) => { const v = c.acc + c.wd, pv = k ? r.curve[k - 1].acc + r.curve[k - 1].wd : 100; return pv > 0 ? Math.round((v / pv - 1) * 1e5) / 1e5 : 0; });
      return { from: r.from, to: r.to, m: m, mr: mr, b: b, bb: r.b ? 100 + r.b.ret : null, inc: tot / L, tot: tot, acc: (r.w.final / r.capital) * 100, y1: full ? p.acc + p.wd - 100 : ann(b),
        y1b: full && p.b != null ? p.b - 100 : ann(100 + r.b.ret), est: !full };
    }).sort((x, y) => x.b - y.b);
  }
  /**
   * FX à partir des simulations relancées avec une mécanique de retrait (rows : voir wdRow).
   * meta = {name, strategy, config, pair, leverage, dataLabel, synthetic, mech: {name, w}, other: {name}, trials, eras}
   */
  function fxFromRows(R, meta) {
    const n = R.length, cfg = meta.config || {}, mech = meta.mech, other = meta.other || { name: '—' };
    const first = { name: meta.name || '', strategy: meta.strategy || null, config: meta.config || null, pair: meta.pair || '', leverage: meta.leverage || cfg.leverage || null, data: meta.dataLabel || '' };
    const capital = pctile(R.map((r) => r.capital), 0.5);
    // ce que le client récupère à la fin (compte + retraits), en % du capital investi
    const back = R.map((r) => 100 + r.w.ret);
    const months = R.map((r) => Math.max(1, Math.round(durationDays(r.from, r.to) / 30.4375)));
    const annual = R.map((r, i) => (Math.pow(Math.max(0.0001, back[i] / 100), 12 / months[i]) - 1) * 100);
    const dds = R.map((r) => r.w.dd), agg = wdAgg(R);
    // durée recommandée : la durée testée qui réussit le mieux
    const groups = {};
    R.forEach((r, i) => { const m = months[i], k = m <= 3 ? 3 : m <= 6 ? 6 : m <= 12 ? 12 : m <= 24 ? 24 : 36; (groups[k] = groups[k] || []).push(r.w.ret); });
    const scored = Object.keys(groups).map((k) => ({ m: +k, n: groups[k].length, score: mean(groups[k]) * (groups[k].filter((v) => v > 0).length / groups[k].length) })).sort((x, y) => y.score - x.score);
    const reco = scored.length > 1 && scored[0].n >= 2 ? Math.min(scored[0].m, Math.max(...months)) : Math.round(pctile(months, 0.5));
    // évolution typique, mois par mois (valeur totale = compte + retraits ; retraits cumulés), en % du capital
    const M = Math.max(...R.map((r) => r.curve.length)), path = [];
    for (let k = 0; k < M; k++) {
      const tot = R.filter((r) => r.curve.length > k).map((r) => r.curve[k].acc + r.curve[k].wd), wd = R.filter((r) => r.curve.length > k).map((r) => r.curve[k].wd);
      if (tot.length < Math.max(2, n * 0.3)) break;
      path.push({ p10: pctile(tot, 0.1), med: pctile(tot, 0.5), p90: pctile(tot, 0.9), wd: pctile(wd, 0.5) });
    }
    // solidité : nombre de simulations, années et époques couvertes, régularité d'une époque à l'autre, données réelles
    const years = new Set(), eraRes = {};
    const eras = F.advisor.normEras(meta.eras);
    R.forEach((r) => { for (let y = +r.from.slice(0, 4); y <= +r.to.slice(0, 4); y++) years.add(y); const m = F.advisor.midDate(r), er = eras.find((x) => m >= x.fromD && m <= x.toD); if (er) (eraRes[er.label] = eraRes[er.label] || []).push(r.w.ret); });
    let eraKeys = Object.keys(eraRes), eraUnit = 'époque';
    // toutes les simulations dans une seule époque (période choisie volontairement) : la régularité se mesure année par
    // année à l'intérieur de cette période (l'année du milieu de chaque simulation)
    if (eraKeys.length < 2) {
      const byYear = {};
      R.forEach((r) => { const y = F.advisor.midDate(r).slice(0, 4); (byYear[y] = byYear[y] || []).push(r.w.ret); });
      if (Object.keys(byYear).length >= 2) { for (const k of Object.keys(eraRes)) delete eraRes[k]; Object.assign(eraRes, byYear); eraKeys = Object.keys(eraRes); eraUnit = 'année'; }
    }
    const eraWin = eraKeys.filter((k) => pctile(eraRes[k], 0.5) > 0).length;
    const synthetic = !!meta.synthetic;
    const parts = {
      simulations: Math.min(1, n / 40) * 30,
      annees: Math.min(1, years.size / 15) * 25,
      epoques: Math.min(1, eraKeys.length / 4) * 20,
      regularite: eraKeys.length ? (eraWin / eraKeys.length) * 15 : 0,
      donnees: synthetic ? 0 : 10,
    };
    // données simulées : elles ne disent rien du marché réel, la solidité est plafonnée à 40
    const solidity = Math.min(synthetic ? 40 : 100, Math.round(Object.values(parts).reduce((a, b) => a + b, 0)));
    const p10 = pctile(back, 0.1), med = pctile(back, 0.5), p90 = pctile(back, 0.9), worst = Math.min(...back), ddMed = pctile(dds, 0.5);
    const w = mech.w || { on: false }, fixedPct = w.mode === 'periodic' && w.type === 'fixed' ? (Number(w.value) / capital) * 100 : null;
    return {
      v: 2, id: 'fx' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), createdAt: new Date().toISOString(), trials: meta.trials || undefined,
      keys: meta.keys || undefined, // simulations de l'historique d'où vient le FX (pour les rouvrir)
      name: 'FX ' + (first.name || 'stratégie') + ' · ' + mech.name,
      strategy: { name: first.name || '', data: first.strategy || null, config: first.config || null, pair: first.pair || '', leverage: first.leverage || cfg.leverage || null, dataLabel: first.data || '' },
      principle: fxPrinciple(first.strategy, first.pair),
      capital: capital, n: n, years: [Math.min(...years), Math.max(...years)],
      duration: { min: Math.min(...months), max: Math.max(...months), reco: reco },
      winRate: (back.filter((v) => v > 100).length / n) * 100,
      annual: pctile(annual, 0.5),
      scenarios: { worst: worst, p10: p10, med: med, p90: p90 }, // en % du capital investi
      outcomes: back.slice().sort((x, y) => x - y),
      sims: fxSimsFromRows(R),
      drawdown: { med: ddMed, max: Math.max(...dds) },
      riskNote: fxRiskNote(Math.max(0, 100 - p10), ddMed, Math.max(0, 100 - worst)),
      income: { name: mech.name, w: w, desc: wdDesc(w), perMonthPct: (agg.perMonth / capital) * 100, fixedPct: fixedPct, yearly: agg.yearly, kept: agg.kept, other: other.name },
      path: path,
      solidity: { score: solidity, parts: parts, synthetic: synthetic, eras: eraKeys.length, eraWin: eraWin, unit: eraUnit },
      spacing: spacingOf(R),
      conditions: { leverage: first.leverage || cfg.leverage || null, spread: cfg.spreadPips != null ? cfg.spreadPips : null, commission: cfg.commission || 0, source: first.data || '' },
    };
  }
  /** Simulations d'un FX (détail enregistré, sinon reconstitué à partir de ses résultats). */
  function simsOf(fx) {
    if (fx.sims && fx.sims.length) return fx.sims;
    if (!fx.outcomes || !fx.outcomes.length) return null;
    const m = Math.max(1, (fx.duration && fx.duration.reco) || 12), inc = fx.income.fixedPct != null ? fx.income.fixedPct : fx.income.perMonthPct;
    return fx.outcomes.map((b) => ({ m: m, b: b, inc: inc, tot: inc * m, acc: b - inc * m, y1: (Math.pow(Math.max(0.0001, b / 100), 12 / m) - 1) * 100, est: true, approx: true }));
  }
  /** Scénario au rang q (0 = pire cas, 1 = meilleur cas), interpolé entre les simulations rangées. S : simulations. */
  function fxPoint(fx, q, S) {
    S = S || simsOf(fx);
    if (!S || !S.length) return { b: fx.scenarios.med, inc: fx.income.perMonthPct, y1: fx.annual, est: true };
    const t = Math.max(0, Math.min(1, q)) * (S.length - 1), i = Math.floor(t), f = t - i, a = S[i], b = S[Math.min(S.length - 1, i + 1)];
    const lerp = (k) => a[k] + (b[k] - a[k]) * f;
    return { b: lerp('b'), inc: lerp('inc'), tot: a.tot != null ? lerp('tot') : null, acc: a.acc != null ? lerp('acc') : null, y1: lerp('y1'),
      y1b: a.y1b != null && b.y1b != null ? lerp('y1b') : null, m: a.m != null && b.m != null ? Math.round(lerp('m')) : null, est: a.est || b.est, approx: !!a.approx };
  }
  /** Score de confiance d'un FX (voir confidence.js). trials : nombre d'essais si le FX ne le précise pas. */
  function fxConfidence(fx, trials, S) {
    S = S || simsOf(fx) || [];
    const real = S.filter((x) => x.mr);
    return F.confidence.score({
      monthly: real.flatMap((x) => x.mr), periods: real.map((x) => ({ from: x.from, to: x.to })), oneYear: S.map((x) => x.y1),
      eras: { win: fx.solidity.eraWin, total: fx.solidity.eras }, synthetic: fx.solidity.synthetic, trials: fx.trials || trials || 1,
    });
  }
  /** Ce que le FX donne pour un capital et un scénario q (0 = pire, 0,5 = le plus souvent, 1 = meilleur), en euros. */
  function fxProjection(fx, capital, q) {
    const p = fxPoint(fx, q == null ? 0.5 : q), c = capital || fx.capital, eur = (pct) => Math.round((c * pct) / 100);
    return { capital: c, q: q == null ? 0.5 : q, months: (fx.duration && fx.duration.reco) || p.m, backEur: eur(p.b), backPct: p.b - 100, incomePerMonthEur: eur(p.inc || 0),
      incomeTotalEur: p.tot != null ? eur(p.tot) : null, accountEur: p.acc != null ? eur(p.acc) : null, oneYearPct: p.y1, oneYearEur: eur(100 + p.y1),
      oneYearNoWithdrawPct: p.y1b, estimated: !!p.est };
  }

  // ---------- chercheur de FX ----------
  const MINER_LEV = [3, 5, 10, 20, 30, 50, 100, 200, 300, 500];
  /** Manières de retirer essayées, d'après les préférences o.prefs {excess, fixed, pct, none} et le revenu souhaité. */
  function minerMechs(o) {
    const out = [], inc = Number(o.income) || 0;
    if (o.prefs.excess) for (const v of [25, 50, 75]) out.push({ name: 'Retrait de l\'excédent ' + v + ' %', w: { on: true, mode: 'periodic', every: 'month', days: 30, type: 'excess', value: v } });
    if (o.prefs.fixed) {
      const sums = inc > 0 ? [inc] : [0.005, 0.01, 0.02].map((f) => Math.max(5, Math.round((o.budget * f) / 5) * 5));
      for (const v of [...new Set(sums)]) out.push({ name: 'Somme fixe ' + v + ' € / mois', w: { on: true, mode: 'periodic', every: 'month', days: 30, type: 'fixed', value: v } });
    }
    if (o.prefs.pct) for (const v of [0.5, 1, 2]) out.push({ name: v.toString().replace('.', ',') + ' % du compte / mois', w: { on: true, mode: 'periodic', every: 'month', days: 30, type: 'pct', value: v } });
    if (o.prefs.none) out.push({ name: 'Sans retrait', w: null });
    return out;
  }
  /** Note d'un candidat par rapport aux critères o = {budget, maxRisk, minConf, income}. conf : score de confiance déjà calculé (facultatif). */
  function minerScore(fx, o, w, conf) {
    conf = conf != null ? conf : fxConfidence(fx).score;
    const pt = fxPoint(fx, 0.5), incEur = (o.budget * (pt.inc || 0)) / 100, want = Number(o.income) || 0;
    const miss = [];
    if (fx.riskNote > o.maxRisk) miss.push('risque ' + fx.riskNote + '/7 (max ' + o.maxRisk + ')');
    if (conf < o.minConf) miss.push('confiance ' + conf + ' (min ' + o.minConf + ')');
    if (want > 0 && w && w.on !== false && incEur < want * 0.9) miss.push('revenu ≈ ' + Math.round(incEur) + ' €/mois (souhaité ' + want + ')');
    // classement : capital au bout de la durée le plus souvent (compte + revenus), puis confiance
    const rank = fx.scenarios.med + conf * 0.2 + fx.winRate * 0.1;
    const dist = Math.max(0, fx.riskNote - o.maxRisk) * 15 + Math.max(0, o.minConf - conf) + (want > 0 ? Math.max(0, want - incEur) / Math.max(1, want) * 30 : 0) - fx.scenarios.med * 0.05;
    return { fx: fx, conf: conf, incEur: incEur, ok: miss.length ? 0 : 1, miss: miss, rank: rank, dist: dist };
  }
  const SHORT = { adx25: 'filtre ADX > 25', adx20: 'filtre ADX < 20', ema200: 'filtre EMA 200', long: 'achats seulement', short: 'ventes seulement', volhi: 'sans forte volatilité', vollo: 'sans marché calme', slope: 'pente EMA 50', sl: 'stop 2 ATR', trail: 'stop suiveur 2 ATR' };
  /**
   * Recherche sur une paire. c = {
   *   bars, base (réglages de simulation sans levier ni retrait), pair, strats, levs, mechs, o (critères, o.months, o.create),
   *   K (nombre de périodes), dataLabel, synthetic, config (configuration enregistrée avec le FX), score(fx, o, w) facultatif,
   *   stop() → true pour arrêter, progress({phase, msg, done, screened, created, strat, lev}) → peut être async
   * }
   * Renvoie { found: [notes], screened, created: [stratégies], combos, done } ou lève une Error (historique trop court).
   */
  async function minePair(c) {
    const { bars, base, pair, levs, mechs, o, K } = c, WARM = 300, stop = c.stop || (() => false), score = c.score || minerScore;
    const dayOf = (b) => String(b.date).slice(0, 10);
    // périodes d'essai : mêmes dates pour toutes les combinaisons
    const lastIdx = bars.length - 1, starts = [];
    const endOf = (i) => { const d = new Date(dayOf(bars[i]) + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + o.months); const iso = F.data.iso(d); let j = i; while (j < lastIdx && dayOf(bars[j + 1]) <= iso) j++; return dayOf(bars[j]) >= F.data.iso(new Date(d.getTime() - 5 * 864e5)) ? j : -1; };
    const cand = []; for (let i = WARM; i <= lastIdx; i++) { const j = endOf(i); if (j > 0) cand.push([i, j]); else break; }
    if (cand.length < 5) throw new Error('Historique trop court pour des placements de ' + o.months + ' mois.');
    let seed = 12345; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < K; k++) starts.push(cand[Math.floor(((k + rnd()) / K) * cand.length) % cand.length]); // réparties sur tout l'historique
    let lastYield = Date.now();
    const tick = async (info) => { if (Date.now() - lastYield > 60) { if (c.progress) await c.progress(info); lastYield = Date.now(); } };
    const run = (strat, se, s0, s1) => {
      const from = Math.max(0, s0 - WARM), sl = bars.slice(from, s1 + 1), st = Object.assign({}, se, { startIndex: s0 - from });
      try { return se.broker ? F.broker.runBrokerBacktest(sl, strat, st, se.broker) : F.backtest.runBacktest(sl, strat, st); } catch (e) { return null; }
    };
    let strats = c.strats.slice(), screened = 0, created = [];
    // 🧪 création de stratégies : chaque modèle + un filtre ou une protection, testées sur les mêmes périodes ;
    // seules celles qui font mieux que leur modèle d'origine entrent dans la recherche complète
    if (o.create) {
      const lev0 = levs.includes(10) ? 10 : levs[Math.floor(levs.length / 2)], se0 = Object.assign({}, base, { leverage: lev0 });
      const quick = (st) => {
        const rs = starts.map(([s0, s1]) => run(st, wdApply(se0, null), s0, s1)).filter((r) => r && r.stats);
        if (rs.length < Math.max(5, starts.length * 0.6)) return -Infinity;
        const back = rs.map((r) => 100 + r.stats.returnPct), dd = rs.map((r) => r.stats.maxDrawdownPct);
        return pctile(back, 0.5) - 0.3 * pctile(dd, 0.5) + 0.1 * (back.filter((v) => v > 100).length / back.length) * 100;
      };
      const pool = [];
      for (const b of strats) {
        if (stop()) break;
        const sb = quick(b);
        for (const x of F.analyzer.eraCandidates(b, null)) {
          const v = F.analyzer.applyProposal(b, se0, x).strat;
          if (['longEntry', 'longExit', 'shortEntry', 'shortExit'].some((k) => v[k] && F.rules.validate(v[k]))) continue;
          v.name = b.name + ' + ' + (SHORT[x.id] || x.title);
          v.generated = { parent: b.name, change: x.title, at: new Date().toISOString() };
          delete v.id; v.description = 'Créée par le chercheur de FX : « ' + b.name + ' » + ' + x.title.charAt(0).toLowerCase() + x.title.slice(1) + '.';
          try { v.plots = F.french.derivePlots(v); v.frenchText = F.french.toFrench(v) || ''; } catch (e) { /* texte facultatif */ }
          const sv = quick(v); screened++;
          if (sv > sb + 1) pool.push({ v: v, sc: sv });
          await tick({ phase: 'create', screened: screened, kept: pool.length });
        }
      }
      created = pool.sort((a, b) => b.sc - a.sc).slice(0, 8).map((x) => x.v);
      strats = strats.concat(created);
    }
    const combos = strats.length * levs.length * mechs.length, found = [];
    let done = 0;
    for (const strat of strats) for (const lev of levs) {
      if (stop()) break;
      const se = Object.assign({}, base, { leverage: lev });
      // sans retrait : une fois par période
      const bases = starts.map(([s0, s1]) => run(strat, wdApply(se, null), s0, s1));
      for (const m of mechs) {
        if (stop()) break;
        const R = [];
        starts.forEach(([s0, s1], k) => {
          const b = bases[k], w = m.w ? run(strat, wdApply(se, m.w), s0, s1) : b;
          if (b && w && w.equity && w.equity.length) R.push(wdRow({ key: 'mn' + k, from: dayOf(bars[s0]), to: dayOf(bars[s1]) }, o.budget, b, w));
        });
        done++;
        if (R.length >= Math.max(5, K * 0.6)) {
          const wn = m.w || { on: false };
          const fx = fxFromRows(R, { name: strat.name, strategy: strat, config: Object.assign({}, c.config || {}, { pair: pair, leverage: lev, capital: o.budget }), pair: pair, leverage: lev, dataLabel: c.dataLabel,
            synthetic: c.synthetic, mech: { name: m.name, w: m.w ? m.w : { on: false, mode: 'periodic', type: 'none', value: 0 } }, other: { name: mechs.length - 1 + ' autre' + (mechs.length > 2 ? 's' : '') + ' manière' + (mechs.length > 2 ? 's' : '') }, trials: 1, eras: c.eras });
          fx.name = 'FX ' + strat.name + ' · ' + pair + ' · 1:' + lev + ' · ' + m.name;
          fx._w = wn;
          if (!m.w) fx.income = Object.assign(fx.income, { desc: 'pas de retrait partiel durant la période de trading', perMonthPct: 0, fixedPct: null });
          found.push(score(fx, o, wn));
        }
        await tick({ phase: 'search', done: done, combos: combos, strat: strat.name, lev: lev });
      }
    }
    return { found: found, screened: screened, created: created, combos: combos, done: done };
  }
  /**
   * Fin de recherche : nombre d'essais exact (toutes combinaisons et variantes, toutes paires) appliqué à chaque FX,
   * nouvelle note, puis propositions variées (la meilleure de chaque stratégie et paire d'abord). Renvoie {found, pick}.
   */
  function minerPick(found, o, trialsAll, score, max) {
    score = score || minerScore;
    for (let i = 0; i < found.length; i++) { found[i].fx.trials = trialsAll; found[i] = score(found[i].fx, o, found[i].fx._w); }
    const order = (a, b) => (b.ok - a.ok) || (b.ok ? b.rank - a.rank : a.dist - b.dist);
    found.sort(order);
    const seen = new Set(), pick = [];
    for (const x of found) { const k = x.fx.strategy.name + '|' + x.fx.strategy.pair; if (!seen.has(k)) { seen.add(k); pick.push(x); } }
    for (const x of found) if (pick.length < (max || 6) && !pick.includes(x)) pick.push(x);
    pick.sort(order);
    return { found: found, pick: pick.slice(0, max || 6) };
  }

  /** Reprise du gain (deep évaluation) : rets = résultats (%) des évaluations dans l'ordre des dates.
   * runs = longueurs des séries d'évaluations perdantes terminées par une gagnante (en pas), ongoing = série perdante en cours à la fin. */
  function deepRecovery(rets) {
    const runs = [];
    let cur = 0, a = 0, b = 0;
    rets.forEach((r, i) => { if (r > 0) { if (cur) runs.push(cur); cur = 0; } else cur++; if (r <= 0 && i + 1 < rets.length) { a++; if (rets[i + 1] > 0) b++; } });
    return { runs: runs, ongoing: cur, losses: rets.filter((r) => r <= 0).length, nextWinAfterLoss: a ? (b / a) * 100 : NaN,
      avg: runs.length ? mean(runs) : NaN, median: runs.length ? median(runs) : NaN, max: runs.length ? Math.max(...runs) : NaN };
  }

  /** Plan d'une deep évaluation : départs tous les `step` jours de `from`, chacune de `months` mois, jamais au-delà de `to`.
   * addMonths(date, n) fourni par l'appelant (F.data.addMonths). few : explication et correctifs quand il y a moins de 6 évaluations. */
  function deepStarts(from, to, step, months, addMonths) {
    const out = [], DAY = 864e5, iso = (d) => d.toISOString().slice(0, 10);
    for (let t = Date.parse(from + 'T00:00:00Z'); out.length <= 2000; t += step * DAY) {
      const st = new Date(t), en = new Date(addMonths(st, months).getTime() - DAY);
      if (iso(en) > to) break;
      out.push({ from: iso(st), to: iso(en) });
    }
    return out;
  }
  function deepFew(plan, today) {
    const n = plan.starts.length;
    if (n >= 6) return null;
    const DAY = 864e5, span = (Date.parse(plan.to) - Date.parse(plan.from)) / DAY, room = span - plan.months * 30.4375;
    const step = room > 14 ? Math.max(7, Math.floor(room / 11)) : 0;
    return { evaluations: n, periodDays: Math.max(0, Math.round(span)), marginDays: Math.max(0, Math.round(room)),
      shorterStepDays: step && step < plan.step ? step : null, evaluationsWithShorterStep: step && step < plan.step ? Math.floor(room / step) + 1 : null,
      extendTo: Date.parse(today) - Date.parse(plan.to) > 60 * DAY ? today : null };
  }
  /** Résumé d'une deep évaluation enregistrée, gardé sur le FX (fx.deepRef). */
  function deepRef(d) {
    const r = d.rows.map((x) => x.ret), rc = deepRecovery(r);
    return { id: d.id, name: d.name, at: new Date().toISOString(), from: d.plan.from, to: d.plan.to, step: d.plan.step, months: d.plan.months, n: r.length,
      winPct: Math.round((r.filter((v) => v > 0).length / Math.max(1, r.length)) * 100), medianPct: median(r), p10Pct: pctile(r, 0.1),
      recoAvg: rc.avg, recoMax: rc.max, nextWinPct: rc.nextWinAfterLoss };
  }

  /** Retrait expliqué à un client (sans jargon). */
  function wdClient(w) {
    if (!w || w.on === false || w.mode === 'none') return 'Aucun retrait pendant la période : tout reste investi jusqu\'à la fin';
    if (w.mode !== 'periodic') return 'Retrait d\'une partie des gains quand le compte gagne ' + w.pct + ' %' + (Number(w.share) < 100 ? ' (' + w.share + ' % du gain)' : '');
    const when = w.every === 'days' ? 'tous les ' + w.days + ' jours' : 'chaque mois';
    if (w.type === 'excess') return (Number(w.value) >= 100 ? 'Tout l\'excédent au-dessus du capital' : w.value + ' % de l\'excédent au-dessus du capital') + ', ' + when;
    if (w.type === 'fixed') return 'Une somme fixe ' + when;
    return w.value + ' % du compte ' + when;
  }
  /**
   * Plan d'investissement présenté à un client (« ⭐ Mettre en avant ») : seulement ce qu'un client doit voir, en % du capital
   * investi (la page client le convertit pour le montant choisi). Pas de levier, de règles ni de nom de stratégie.
   * opt = {title, pitch}. Réinvestissement : calculé (pas de la deep évaluation de référence, sinon écart type entre les simulations).
   */
  /** Délai de réinvestissement sur le même plan, tiré du FX : pas de sa deep évaluation de référence, sinon écart type entre ses simulations. */
  function reinvestOf(fx) {
    const g = fx.spacing || spacingOf((simsOf(fx) || []).filter((x) => x.from && x.to));
    const days = fx.deepRef && fx.deepRef.step ? fx.deepRef.step : g && g.sdDays ? g.sdDays : null;
    return days ? { months: Math.max(1, Math.round(days / 30.4375)), from: fx.deepRef && fx.deepRef.step ? 'deep' : 'spacing' } : { months: 3, from: 'default' };
  }
  function fxPublic(fx, opt) {
    opt = opt || {};
    const S = (simsOf(fx) || []).slice(), q = (k, x) => pctile(S.map((s) => s[k]).filter(Number.isFinite), x), w = fx.income && fx.income.w;
    const noWd = !w || w.on === false || w.mode === 'none', reco = (fx.duration && fx.duration.reco) || 12;
    const conf = fxConfidence(fx), sol = fx.solidity || {};
    // sans retrait sur la période : simulé si connu, sinon estimé à partir de l'année sans retrait
    const bb = S.map((s) => (noWd ? s.b : s.bb)).filter(Number.isFinite);
    const noWdEnd = bb.length ? { usual: pctile(bb, 0.5), bad: pctile(bb, 0.1), good: pctile(bb, 0.9), estimated: false }
      : (() => { const y = S.map((s) => s.y1b).filter(Number.isFinite), g = (v) => 100 * Math.pow(Math.max(0.0001, 1 + v / 100), reco / 12); return y.length ? { usual: g(pctile(y, 0.5)), bad: g(pctile(y, 0.1)), good: g(pctile(y, 0.9)), estimated: true } : null; })();
    const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
    return {
      v: 1, fxId: fx.id, title: (opt.title || fx.name || 'Plan').slice(0, 80), pitch: String(opt.pitch || '').slice(0, 280), publishedAt: new Date().toISOString(),
      minCapital: Math.round(fx.capital), currency: 'EUR', recoMonths: reco, testedMonths: fx.duration ? [fx.duration.min, fx.duration.max] : null,
      // au bout d'un an : valeur totale (compte + retraits déjà touchés), en % du capital
      oneYear: { usual: r1(100 + q('y1', 0.5)), bad: r1(100 + q('y1', 0.1)), good: r1(100 + q('y1', 0.9)), worst: r1(100 + Math.min(...S.map((s) => s.y1))) },
      withWithdrawal: noWd ? null : { kept: r1(q('acc', 0.5)), withdrawn: r1(q('tot', 0.5)), total: r1(q('b', 0.5)), bad: r1(q('b', 0.1)), good: r1(q('b', 0.9)) },
      withoutWithdrawal: noWdEnd ? { usual: r1(noWdEnd.usual), bad: r1(noWdEnd.bad), good: r1(noWdEnd.good), estimated: noWdEnd.estimated } : null,
      withdrawal: { possible: !noWd, text: wdClient(w) },
      // arrêt conseillé quand le compte dépasse son niveau habituel de fin de période (seulement si ce niveau est au-dessus du capital investi)
      stop: { anytime: true, aboveMedian: (() => { const v = noWd ? q('b', 0.5) : q('acc', 0.5); return v > 100.5 ? r1(v) : null; })() },
      risk: { note: fx.riskNote, text: RISK_TXT[fx.riskNote] || '', worstEnd: r1(q('b', 0)), badEnd: r1(q('b', 0.1)), usualDip: r1(fx.drawdown ? fx.drawdown.med : null), worstDip: r1(fx.drawdown ? fx.drawdown.max : null) },
      confidence: { score: conf.score, periods: fx.n, won: sol.eraWin, of: sol.eras, unit: sol.unit || 'époque', years: fx.years, synthetic: !!sol.synthetic },
      reinvestMonths: reinvestOf(fx).months, reinvestFrom: reinvestOf(fx).from,
    };
  }

  F.fxcore = {
    wdClient, fxPublic, reinvestOf,
    deepRecovery, deepStarts, deepFew, deepRef,
    pctile, mean, median, durationDays, CUR_NAME, RISK_TXT, MINER_LEV,
    wdApply, wdKey, wdDesc, withdrawLabel, wdRow, wdDerive, wdAgg, fxRowFromRecord, spacingOf,
    fxPrinciple, fxRiskNote, fxSimsFromRows, fxFromRows, simsOf, fxPoint, fxConfidence, fxProjection,
    minerMechs, minerScore, minePair, minerPick,
  };
})(typeof window !== 'undefined' ? window : globalThis);
