/* Forexia — styles de trading et suggestions d'amélioration.
 *
 * Chaque suggestion est réellement backtestée sur les mêmes données que la
 * simulation d'origine avant d'être proposée, avec son résultat chiffré. */
(function (root) {
  'use strict';
  const F = root.Forexia;
  const R = F.rules, B = F.backtest, FR = F.french;

  // ---------- Styles ----------
  // factor : multiplicateur des périodes d'indicateurs par rapport aux modèles (calibrés « moyen terme »).
  const STYLES = {
    none: { label: 'Aucun', factor: 1, slGrid: [20, 30, 50, 80, 120, 200], trend: [50, 100, 200] },
    scalping: { label: 'Scalping', factor: 0.4, sl: 12, slGrid: [8, 10, 12, 15, 20, 25], trend: [20, 50, 100],
      desc: 'Trades de quelques minutes à quelques heures, stops serrés et indicateurs rapides. À tester sur des données intraday (M1 à M15) importées en CSV.' },
    short: { label: 'Court terme', factor: 0.6, sl: 40, slGrid: [20, 30, 40, 50, 60, 80], trend: [50, 100],
      desc: 'Positions de quelques jours : indicateurs plutôt rapides, stops de 20 à 80 pips.' },
    medium: { label: 'Moyen terme', factor: 1, sl: 100, slGrid: [50, 80, 100, 120, 150, 200], trend: [100, 200],
      desc: 'Positions de quelques semaines : réglages classiques, stops de 50 à 200 pips.' },
    long: { label: 'Long terme', factor: 2, sl: 300, slGrid: [150, 200, 250, 300, 400, 500], trend: [200, 300],
      desc: 'Positions de plusieurs mois : indicateurs lents, filtres de tendance, stops larges.' },
  };

  const SINGLE_PERIOD = ['SMA', 'EMA', 'RSI', 'MOM', 'ROC', 'HIGHEST', 'LOWEST', 'CCI', 'WILLR', 'ATR'];
  const DEFAULTS = { MACD: [12, 26, 9], STOCH: [14, 3, 3], BB: [20, 2], RSI: [14], SMA: [20], EMA: [20], CCI: [20], WILLR: [14], ATR: [14], MOM: [10], ROC: [10] };
  const famOf = (name) => (/^MACD/.test(name) ? 'MACD' : /^STOCH/.test(name) ? 'STOCH' : /^BB_/.test(name) ? 'BB' : name);
  const num = (v) => ({ k: 'num', v: v });
  const scaleP = (v, f) => Math.max(2, Math.round(v * f));

  /** Paramètres effectifs d'un appel d'indicateur (valeurs par défaut complétées), ou null. */
  function paramsOf(node) {
    if (node.k !== 'call') return null;
    const fam = famOf(node.name);
    if (!DEFAULTS[fam]) return null;
    if (SINGLE_PERIOD.includes(node.name) && node.args[0] && node.args[0].k !== 'num') return null; // SMA(RSI(14), 9)
    const vals = DEFAULTS[fam].slice();
    node.args.forEach((a, i) => { if (a.k === 'num' && i < vals.length) vals[i] = a.v; });
    return { fam: fam, vals: vals };
  }
  function scaledVals(fam, vals, f) {
    if (fam === 'MACD') { const fast = scaleP(vals[0], f), slow = Math.max(fast + 1, scaleP(vals[1], f)); return [fast, slow, scaleP(vals[2], f)]; }
    if (fam === 'STOCH' || fam === 'BB') return [scaleP(vals[0], f)].concat(vals.slice(1));
    return [scaleP(vals[0], f)];
  }
  function mapRule(rule, fn) { return rule ? R.stringify(R.mapNodes(R.parse(rule), fn)) : ''; }
  const RULE_KEYS = ['longEntry', 'longExit', 'shortEntry', 'shortExit'];
  function mapRules(strat, fn) { const s = Object.assign({}, strat); for (const k of RULE_KEYS) s[k] = mapRule(strat[k], fn); return s; }

  /** Multiplie toutes les périodes d'indicateurs par f. */
  function scaleStrategy(strat, f) {
    if (f === 1) return Object.assign({}, strat);
    return mapRules(strat, (n) => {
      const p = paramsOf(n);
      if (!p) return undefined;
      return Object.assign({}, n, { args: scaledVals(p.fam, p.vals, f).map(num) });
    });
  }

  /** Adapte une stratégie à un style (périodes, stop-loss, take-profit). fromStyle : style déjà appliqué. */
  function adaptToStyle(strat, styleKey, opts) {
    opts = opts || {};
    const st = STYLES[styleKey] || STYLES.none, from = STYLES[opts.fromStyle] || STYLES.none;
    let s = scaleStrategy(strat, st.factor / from.factor);
    if (styleKey !== 'none') {
      const rnd = opts.rnd;
      const sl = rnd ? st.slGrid[Math.floor(rnd() * st.slGrid.length)] : st.sl;
      const hadTp = strat.takeProfitPips > 0;
      const tpMult = rnd ? [0, 1.5, 2, 3][Math.floor(rnd() * 4)] : hadTp ? 2 : 0;
      s.stopLossPips = sl;
      s.takeProfitPips = tpMult ? Math.round(sl * tpMult) : 0;
    }
    s.name = String(strat.name || 'Ma stratégie').replace(/ · (Scalping|Court terme|Moyen terme|Long terme)$/, '') + (styleKey !== 'none' ? ' · ' + st.label : '');
    s.style = styleKey;
    s.plots = FR.derivePlots(s);
    s.frenchText = FR.toFrench(s) || '';
    return s;
  }

  // ---------- Suggestions ----------
  function run(bars, strat, settings) {
    try { return B.runBacktest(bars, strat, settings).stats; } catch (e) { return null; }
  }
  // Rendement ajusté du risque : on pénalise la moitié du drawdown maximal.
  // Moins de 3 trades : résultat dû au hasard, on ne le propose pas.
  function score(st) { return st ? st.returnPct - 0.5 * st.maxDrawdownPct - (st.trades < 3 ? 1000 : 0) : -Infinity; }
  function orWith(a, b) {
    if (!a) return b;
    if (!b) return a;
    const wrap = (x) => { const t = R.parse(x); return t.k === 'bin' && (t.op === 'OR' || t.op === 'AND') ? '(' + R.stringify(t) + ')' : R.stringify(t); };
    return wrap(a) + ' OR ' + wrap(b);
  }

  function andWith(rule, extra) {
    if (!rule) return '';
    const ast = R.parse(rule);
    return (ast.k === 'bin' && ast.op === 'OR' ? '(' + R.stringify(ast) + ')' : R.stringify(ast)) + ' AND ' + extra;
  }
  const maName = (t, n) => (t === 'EMA' ? 'la moyenne mobile exponentielle ' : 'la moyenne mobile ') + n;
  const LEVERAGES = [1, 2, 5, 10, 20, 30, 50, 100, 200, 500];
  const ORACLE_CENTER = { RSI: 50, STOCH: 50, WILLR: -50, CCI: 0 };

  function collectCalls(strat) {
    const fams = new Map();
    for (const k of RULE_KEYS) {
      if (!strat[k]) continue;
      R.mapNodes(R.parse(strat[k]), (n) => {
        const p = paramsOf(n);
        if (p && p.fam !== 'ATR') { const key = p.fam + ':' + p.vals.join(','); if (!fams.has(key)) fams.set(key, p); }
        return undefined;
      });
    }
    return [...fams.values()];
  }
  function describeParams(p) {
    if (p.fam === 'MACD') return 'MACD (' + p.vals.join(',') + ')';
    if (p.fam === 'STOCH') return 'stochastique (' + p.vals.join(',') + ')';
    if (p.fam === 'BB') return 'Bollinger ' + p.vals[0];
    if (p.fam === 'SMA') return 'moyenne mobile ' + p.vals[0];
    if (p.fam === 'EMA') return 'moyenne mobile exponentielle ' + p.vals[0];
    if (p.fam === 'WILLR') return 'Williams %R ' + p.vals[0];
    return p.fam + ' ' + p.vals[0];
  }

  // Seuils comparés à un oscillateur borné (RSI 30, stochastique 80…).
  function thresholdTransform(k) {
    return (strat) => mapRules(strat, (n) => {
      const isCmp = n.k === 'bin' && ['>', '<', '>=', '<='].includes(n.op);
      const isCross = n.k === 'call' && (n.name === 'CROSS_UP' || n.name === 'CROSS_DOWN');
      if (!isCmp && !isCross) return undefined;
      const [x, y] = isCmp ? [n.a, n.b] : n.args;
      const osc = [x, y].find((o) => o.k === 'call' && ORACLE_CENTER[famOf(o.name)] !== undefined);
      const lit = [x, y].find((o) => o.k === 'num');
      if (!osc || !lit) return undefined;
      const c = ORACLE_CENTER[famOf(osc.name)];
      if (lit.v === c) return undefined;
      let v = Math.round(c + (lit.v - c) * k);
      if (famOf(osc.name) === 'RSI' || famOf(osc.name) === 'STOCH') v = Math.min(95, Math.max(5, v));
      if (famOf(osc.name) === 'WILLR') v = Math.min(-5, Math.max(-95, v));
      const nl = num(v);
      if (isCmp) return Object.assign({}, n, x === lit ? { a: nl } : { b: nl });
      return Object.assign({}, n, { args: n.args.map((a) => (a === lit ? nl : a)) });
    });
  }
  function thresholdsOf(strat) {
    const out = new Set();
    thresholdTransform(1)(Object.assign({}, strat)); // validation de syntaxe
    for (const k of RULE_KEYS) {
      if (!strat[k]) continue;
      R.mapNodes(R.parse(strat[k]), (n) => {
        const args = n.k === 'bin' ? [n.a, n.b] : n.k === 'call' && /^CROSS_/.test(n.name) ? n.args : null;
        if (!args) return undefined;
        const osc = args.find((o) => o.k === 'call' && ORACLE_CENTER[famOf(o.name)] !== undefined);
        const lit = args.find((o) => o.k === 'num');
        if (osc && lit && lit.v !== ORACLE_CENTER[famOf(osc.name)]) out.add(lit.v);
        return undefined;
      });
    }
    return [...out].sort((a, b) => a - b);
  }

  /**
   * Calcule les suggestions. Renvoie { base, suggestions: [{id, group, title, detail, stats, risk, apply}] }.
   * apply({strat, settings}) -> {strat, settings}
   */
  function suggest(bars, strat, settings, styleKey) {
    const st = STYLES[styleKey] || STYLES.none;
    const base = run(bars, strat, settings);
    const baseScore = score(base);
    const groups = [];
    const add = (group, variants) => groups.push({ group: group, variants: variants.filter(Boolean) });
    const S = (fn) => ({ strat, settings }) => ({ strat: fn(strat), settings: settings });

    // 1. Réglage des périodes de chaque indicateur
    for (const p of collectCalls(strat).slice(0, 5)) {
      add('Réglage des indicateurs', [0.5, 0.75, 1.25, 1.5, 2].map((f) => {
        const nv = scaledVals(p.fam, p.vals, f);
        if (nv.join() === p.vals.join()) return null;
        const np = { fam: p.fam, vals: nv };
        return {
          id: 'p-' + p.fam + p.vals.join('-') + '-' + f, title: 'Régler ' + describeParams(p) + ' → ' + describeParams(np),
          detail: f < 1 ? 'Indicateur plus rapide : réagit plus tôt, mais donne plus de faux signaux.' : 'Indicateur plus lent : moins de signaux, mais plus fiables.',
          apply: S((s) => mapRules(s, (n) => {
            const q = paramsOf(n);
            if (!q || q.fam !== p.fam || q.vals.join() !== p.vals.join()) return undefined;
            return Object.assign({}, n, { args: nv.map(num) });
          })),
        };
      }));
    }
    // 2. Seuils des oscillateurs
    const th = thresholdsOf(strat);
    if (th.length) {
      add('Seuils des oscillateurs', [0.6, 0.8, 1.2, 1.4].map((k) => {
        const after = thresholdsOf(thresholdTransform(k)(strat));
        if (after.join() === th.join()) return null;
        return {
          id: 'th-' + k, title: (k > 1 ? 'Seuils plus extrêmes : ' : 'Seuils moins extrêmes : ') + th.join(' / ') + ' → ' + after.join(' / '),
          detail: k > 1 ? 'N\'entre que sur des excès plus marqués : moins de trades, mieux placés.' : 'Entre plus tôt : plus de trades.',
          apply: S(thresholdTransform(k)),
        };
      }));
    }
    // 3. Filtre de tendance
    const canon = RULE_KEYS.map((k) => R.canonical(strat[k] || '')).join(' ');
    if (!/CLOSE > (S|E)MA\(/.test(canon) && (strat.longEntry || strat.shortEntry)) {
      const variants = [];
      for (const n of st.trend) for (const t of ['EMA', 'SMA']) {
        variants.push({
          id: 'tr-' + t + n, title: 'Filtre de tendance : acheter seulement au-dessus de ' + maName(t, n) + ', vendre seulement en dessous',
          detail: 'Évite de trader à contre-courant de la tendance de fond.',
          apply: S((s) => Object.assign({}, s, { longEntry: andWith(s.longEntry, 'CLOSE > ' + t + '(' + n + ')'), shortEntry: andWith(s.shortEntry, 'CLOSE < ' + t + '(' + n + ')') })),
        });
      }
      add('Filtre de tendance', variants);
    }
    // 4. Confirmation par le momentum (RSI)
    if (!/RSI\(\d+\) > 5\d/.test(canon)) {
      const rp = scaleP(14, st.factor);
      add('Confirmation', [50, 55].map((lvl) => ({
        id: 'mo-' + lvl, title: 'Confirmer avec le RSI ' + rp + ' : acheter seulement s\'il est au-dessus de ' + lvl + ', vendre s\'il est en dessous de ' + (100 - lvl),
        detail: 'Ne prend que les signaux soutenus par l\'élan du marché.',
        apply: S((s) => Object.assign({}, s, { longEntry: andWith(s.longEntry, 'RSI(' + rp + ') > ' + lvl), shortEntry: andWith(s.shortEntry, 'RSI(' + rp + ') < ' + (100 - lvl)) })),
      })));
    }
    // 5. Règle de sortie
    if (!strat.longExit && !strat.shortExit) {
      const rp = scaleP(14, st.factor);
      add('Sortie', [[65, 35], [70, 30], [75, 25]].map(([h, l]) => ({
        id: 'ex-' + h, title: 'Sortir sur excès : clôturer l\'achat quand le RSI ' + rp + ' dépasse ' + h + ', la vente quand il passe sous ' + l,
        detail: 'Encaisse les gains avant le retournement au lieu d\'attendre le signal inverse.',
        apply: S((s) => Object.assign({}, s, { longExit: s.longEntry ? 'RSI(' + rp + ') > ' + h : '', shortExit: s.shortEntry ? 'RSI(' + rp + ') < ' + l : '' })),
      })));
    }
    // 6. Sens des positions
    if (strat.longEntry && strat.shortEntry) {
      add('Sens des positions', [
        // Le signal de vente, qui fermait les achats, devient leur signal de sortie (et inversement).
        { id: 'dir-long', title: 'Ne prendre que les achats', detail: 'Supprime les ventes, perdantes sur cette période ; le signal de vente sert seulement à sortir des achats.',
          apply: S((s) => Object.assign({}, s, { longExit: orWith(s.longExit, s.shortEntry), shortEntry: '', shortExit: '' })) },
        { id: 'dir-short', title: 'Ne prendre que les ventes', detail: 'Supprime les achats, perdants sur cette période ; le signal d\'achat sert seulement à sortir des ventes.',
          apply: S((s) => Object.assign({}, s, { shortExit: orWith(s.shortExit, s.longEntry), longEntry: '', longExit: '' })) },
      ]);
    }
    // 7. Stop-loss
    const curSl = strat.stopLossPips || 0, curTp = strat.takeProfitPips || 0;
    add('Stop-loss', st.slGrid.filter((v) => v !== curSl).map((v) => ({
      id: 'sl-' + v, title: (curSl ? 'Stop-loss : ' + curSl + ' → ' + v + ' pips' : 'Ajouter un stop-loss de ' + v + ' pips'),
      detail: 'Limite la perte maximale de chaque trade.', apply: S((s) => Object.assign({}, s, { stopLossPips: v })),
    })).concat(curSl ? [{ id: 'sl-0', title: 'Retirer le stop-loss (' + curSl + ' pips)', detail: 'Le stop coupait des trades qui seraient revenus gagnants.', apply: S((s) => Object.assign({}, s, { stopLossPips: 0 })) }] : []));
    // 8. Take-profit
    const tpBase = curSl || st.slGrid[Math.floor(st.slGrid.length / 2)];
    add('Take-profit', [1, 1.5, 2, 3].map((m) => Math.round(tpBase * m)).filter((v) => v !== curTp).map((v) => ({
      id: 'tp-' + v, title: (curTp ? 'Take-profit : ' + curTp + ' → ' + v + ' pips' : 'Ajouter un take-profit de ' + v + ' pips'),
      detail: 'Sécurise les gains à un objectif fixe.', apply: S((s) => Object.assign({}, s, { takeProfitPips: v })),
    })).concat(curTp ? [{ id: 'tp-0', title: 'Retirer le take-profit (' + curTp + ' pips)', detail: 'Laisse courir les trades gagnants.', apply: S((s) => Object.assign({}, s, { takeProfitPips: 0 })) }] : []));

    // Contrôle hors échantillon : la période de même durée juste avant la période testée.
    const st0 = settings.startIndex, len = bars.length - st0, vStart = st0 - len;
    const vBars = vStart >= 250 ? bars.slice(0, st0) : null;
    const vSet = vBars ? Object.assign({}, settings, { startIndex: vStart }) : null;
    const vBase = vBars ? run(vBars, strat, vSet) : null;
    function validate(sg) {
      if (!vBase) return null;
      const r = sg.apply({ strat: strat, settings: vSet });
      const stats = run(vBars, r.strat, r.settings);
      return stats ? { stats: stats, base: vBase, confirmed: score(stats) > score(vBase) } : null;
    }

    // Pour chaque groupe, on garde la meilleure variante si elle améliore le résultat.
    const suggestions = [];
    for (const g of groups) {
      let best = null;
      for (const v of g.variants) {
        const r = v.apply({ strat: strat, settings: settings });
        const stats = run(bars, r.strat, r.settings);
        if (stats && (!best || score(stats) > best.score)) best = Object.assign({}, v, { group: g.group, stats: stats, score: score(stats) });
      }
      if (best && best.stats.trades >= 3 && best.score > baseScore + 0.5) suggestions.push(best);
    }
    // 9. Levier : proposé dès que le risque est élevé, même si le rendement baisse.
    if (base && (base.maxDrawdownPct > 25 || base.finalEquity <= 0)) {
      const lower = LEVERAGES.filter((l) => l < settings.leverage);
      let pickL = null;
      for (const l of lower) {
        const stats = run(bars, strat, Object.assign({}, settings, { leverage: l }));
        if (stats && stats.maxDrawdownPct <= 20) pickL = { l: l, stats: stats };
      }
      if (!pickL && lower.length) pickL = { l: lower[0], stats: run(bars, strat, Object.assign({}, settings, { leverage: lower[0] })) };
      if (pickL && pickL.stats) {
        suggestions.push({
          id: 'lev-' + pickL.l, group: 'Gestion du risque', risk: true, stats: pickL.stats, score: score(pickL.stats),
          title: 'Réduire le levier : 1:' + settings.leverage + ' → 1:' + pickL.l,
          detail: 'Le drawdown actuel (−' + base.maxDrawdownPct.toFixed(1).replace('.', ',') + ' %) est très élevé. Moins de gain possible, mais un risque maîtrisé.',
          apply: ({ strat: s, settings: se }) => ({ strat: s, settings: Object.assign({}, se, { leverage: pickL.l }) }),
        });
      }
    }
    for (const sg of suggestions) sg.validation = validate(sg);
    const conf = (sg) => (sg.validation && sg.validation.confirmed ? 1 : 0);
    suggestions.sort((a, b) => (b.risk ? 1 : 0) - (a.risk ? 1 : 0) || conf(b) - conf(a) || b.score - a.score);
    return { base: base, suggestions: suggestions, validation: vBars ? { bars: vBars, settings: vSet, base: vBase } : null };
  }

  // Ordre d'application : réglages, seuils, filtres, sorties, sens, stop/objectif, levier.
  const ORDER = ['Réglage des indicateurs', 'Seuils des oscillateurs', 'Filtre de tendance', 'Confirmation', 'Sortie', 'Sens des positions', 'Stop-loss', 'Take-profit', 'Gestion du risque'];
  function combine(strat, settings, selected) {
    let cur = { strat: Object.assign({}, strat), settings: Object.assign({}, settings) };
    for (const s of selected.slice().sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group))) cur = s.apply(cur);
    return cur;
  }

  F.enhancer = { STYLES, adaptToStyle, scaleStrategy, suggest, combine, score, run };
})(typeof window !== 'undefined' ? window : globalThis);
