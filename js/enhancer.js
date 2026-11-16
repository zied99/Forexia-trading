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
  // settings.broker présent : moteur « courtier » (identique au testeur MT5), sinon moteur standard.
  function run(bars, strat, settings) {
    try {
      return settings.broker ? F.broker.runBrokerBacktest(bars, strat, settings, settings.broker).stats : B.runBacktest(bars, strat, settings).stats;
    } catch (e) { return null; }
  }
  /**
   * Note d'une simulation (Forexia 1.2) :
   *  - rendement ajusté du risque : rendement − ½ drawdown maximal ;
   *  - régularité : + 0,1 point par point de « mois gagnants » au-dessus de 50 % (dès 3 mois) ;
   *  - facteur de profit : + 2 points par unité au-dessus de 1 (plafonné à 3) ;
   *  - peu de trades : − ½ point par trade manquant sous 10 ; moins de 3 trades : écarté (hasard).
   */
  function score(st) {
    if (!st) return -Infinity;
    let v = st.returnPct - 0.5 * st.maxDrawdownPct;
    if (st.trades < 3) return v - 1000;
    if (st.months >= 3) v += 0.1 * (st.winMonthsPct - 50);
    const pf = Number.isFinite(st.profitFactor) ? st.profitFactor : 3;
    v += 2 * (Math.min(pf, 3) - 1);
    if (st.trades < 10) v -= 0.5 * (10 - st.trades);
    return v;
  }
  const HIGHER_TF = { M1: 'M15', M5: 'H1', M15: 'H1', M30: 'H4', H1: 'H4', H4: 'D1', D1: 'W1', W1: 'MN' };
  const TF_LABEL = { M15: '15 minutes', H1: '1 heure', H4: '4 heures', D1: 'journalière', W1: 'hebdomadaire', MN: 'mensuelle' };
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
    const add = (group, variants, robust) => groups.push({ group: group, variants: variants.filter(Boolean), robust: !!robust });
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
    // 3. Tendance : prix au-dessus d'une moyenne, pente, alignement, force (ADX), unité de temps supérieure
    const canon = RULE_KEYS.map((k) => R.canonical(strat[k] || '')).join(' ');
    const hasEntry = !!(strat.longEntry || strat.shortEntry);
    const both = (id, title, detail, longCond, shortCond) => ({
      id: id, title: title, detail: detail,
      apply: S((s) => Object.assign({}, s, { longEntry: andWith(s.longEntry, longCond), shortEntry: andWith(s.shortEntry, shortCond) })),
    });
    const P = (v) => scaleP(v, st.factor);
    if (hasEntry && !/CLOSE > (S|E)MA\(/.test(canon)) {
      const variants = [];
      for (const n of st.trend) for (const t of ['EMA', 'SMA']) {
        variants.push(both('tr-' + t + n, 'Filtre de tendance : acheter seulement au-dessus de ' + maName(t, n) + ', vendre seulement en dessous',
          'Évite de trader à contre-courant de la tendance de fond.', 'CLOSE > ' + t + '(' + n + ')', 'CLOSE < ' + t + '(' + n + ')'));
      }
      add('Filtre de tendance', variants);
    }
    if (hasEntry && !/SLOPE\(/.test(canon)) {
      add('Pente de la moyenne', [].concat(...st.trend.map((n) => [3, 10].map((k) => both('sl-' + n + '-' + k,
        'Pente : acheter seulement si ' + maName('EMA', n) + ' monte (sur ' + k + ' bougies), vendre si elle baisse',
        'La moyenne doit aller dans le sens du trade : la tendance est en cours, pas seulement passée.',
        'SLOPE(EMA(' + n + '), ' + k + ') > 0', 'SLOPE(EMA(' + n + '), ' + k + ') < 0')))));
    }
    if (hasEntry) {
      const sets = [[20, 50, 200], [10, 20, 50], [50, 100, 200]].map((x) => x.map(P)).filter((x) => x[0] < x[1] && x[1] < x[2]);
      add('Alignement des moyennes', sets.map(([a, b, c]) => both('al-' + a + '-' + b + '-' + c,
        'Alignement : acheter seulement si EMA ' + a + ' > EMA ' + b + ' > EMA ' + c + ', vendre si l\'ordre est inverse',
        'Les trois moyennes rangées dans l\'ordre signalent une tendance installée sur plusieurs horizons.',
        'EMA(' + a + ') > EMA(' + b + ') AND EMA(' + b + ') > EMA(' + c + ')', 'EMA(' + a + ') < EMA(' + b + ') AND EMA(' + b + ') < EMA(' + c + ')')));
    }
    if (hasEntry && !/ADX\(/.test(canon)) {
      const ap = P(14);
      add('Force de la tendance (ADX)', [20, 25, 30].map((lv) => ({
        id: 'adx-' + lv, title: 'Force de tendance : n\'entrer que si l\'ADX ' + ap + ' dépasse ' + lv,
        detail: 'Évite les marchés sans direction, où les signaux se contredisent.',
        apply: S((s) => Object.assign({}, s, { longEntry: andWith(s.longEntry, 'ADX(' + ap + ') > ' + lv), shortEntry: andWith(s.shortEntry, 'ADX(' + ap + ') > ' + lv) })),
      })).concat([both('dmi', 'Direction (DMI) : acheter seulement si +DI > −DI, vendre si −DI > +DI', 'La pression acheteuse doit dominer pour acheter (et inversement).',
        'PLUS_DI(' + ap + ') > MINUS_DI(' + ap + ')', 'MINUS_DI(' + ap + ') > PLUS_DI(' + ap + ')')]));
    }
    if (hasEntry && !/ADX\(/.test(canon)) {
      const ap = P(14);
      add('Régime de marché', [20, 25].map((lv) => ({
        id: 'rg-' + lv, title: 'Régime : n\'entrer que si le marché est sans tendance (ADX ' + ap + ' sous ' + lv + ')',
        detail: 'Pour les stratégies de retour à la moyenne (RSI, stochastique, Bollinger) : elles marchent dans les marchés qui oscillent, pas dans les tendances fortes.',
        apply: S((s) => Object.assign({}, s, { longEntry: andWith(s.longEntry, 'ADX(' + ap + ') < ' + lv), shortEntry: andWith(s.shortEntry, 'ADX(' + ap + ') < ' + lv) })),
      })));
    }
    const htf = HIGHER_TF[settings.timeframe || 'D1'];
    if (hasEntry && htf && !/@/.test(canon)) {
      add('Tendance supérieure', [20, 50].map((n) => both('htf-' + htf + n,
        'Unité de temps supérieure : acheter seulement si, en ' + (TF_LABEL[htf] || htf) + ', le prix est au-dessus de l\'EMA ' + n + ' (vente : en dessous)',
        'Le trade va dans le sens de la tendance de l\'unité de temps supérieure (bougies closes uniquement, sans regarder le futur).',
        'CLOSE@' + htf + ' > EMA(' + n + ')@' + htf, 'CLOSE@' + htf + ' < EMA(' + n + ')@' + htf)));
    }
    // 3 bis. Croisements de moyennes : comme entrée (alternative), comme confirmation, prix / moyenne
    if (hasEntry) {
      const pairs = [[9, 21], [20, 50], [50, 200]].map((x) => x.map(P)).filter((x) => x[0] < x[1]);
      add('Croisement de moyennes (entrée)', pairs.map(([f, l]) => ({
        id: 'xe-' + f + '-' + l, title: 'Entrée supplémentaire : acheter quand l\'EMA ' + f + ' croise l\'EMA ' + l + ' à la hausse, vendre au croisement à la baisse',
        detail: 'Ajoute le croisement comme second signal d\'entrée (l\'un ou l\'autre suffit).',
        apply: S((s) => Object.assign({}, s, {
          longEntry: s.longEntry ? orWith(s.longEntry, 'CROSS_UP(EMA(' + f + '), EMA(' + l + '))') : '',
          shortEntry: s.shortEntry ? orWith(s.shortEntry, 'CROSS_DOWN(EMA(' + f + '), EMA(' + l + '))') : '' })),
      })).concat(st.trend.map((n) => ({
        id: 'xp-' + n, title: 'Entrée supplémentaire : acheter quand le prix croise l\'EMA ' + n + ' à la hausse, vendre au croisement à la baisse',
        detail: 'Le franchissement de la moyenne par le prix devient un signal d\'entrée de plus.',
        apply: S((s) => Object.assign({}, s, {
          longEntry: s.longEntry ? orWith(s.longEntry, 'CROSS_UP(CLOSE, EMA(' + n + '))') : '',
          shortEntry: s.shortEntry ? orWith(s.shortEntry, 'CROSS_DOWN(CLOSE, EMA(' + n + '))') : '' })),
      }))));
      // Confirmation : grille des périodes, choisie de façon robuste (bonne sur la période testée ET la précédente).
      const grid = [];
      for (const f of [5, 9, 12, 20].map(P)) for (const l of [21, 30, 50, 100, 200].map(P)) if (l >= f * 1.5 && !grid.some((g) => g[0] === f && g[1] === l)) grid.push([f, l]);
      add('Croisement de moyennes (confirmation)', grid.map(([f, l]) => both('xc-' + f + '-' + l,
        'Confirmation : acheter seulement si l\'EMA ' + f + ' est au-dessus de l\'EMA ' + l + ', vendre si elle est en dessous',
        'Meilleures périodes cherchées dans une grille de ' + grid.length + ' combinaisons, en retenant celle qui tient aussi sur la période précédente.',
        'EMA(' + f + ') > EMA(' + l + ')', 'EMA(' + f + ') < EMA(' + l + ')')), true);
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
    // 8 bis. Gestion des trades (1.2)
    const fmt = (v) => String(v).replace('.', ',');
    add('Stops selon la volatilité (ATR)', [].concat(...[1.5, 2, 3].map((k) => [0, 2, 3].map((m) => ({
      id: 'atr-' + k + '-' + m, title: 'Stop-loss à ' + fmt(k) + ' ATR' + (m ? ', take-profit à ' + fmt(m * k) + ' ATR' : ' (sans take-profit)'),
      detail: 'Les distances s\'adaptent à la volatilité du moment (ATR 14 de la bougie précédant l\'entrée) au lieu d\'un nombre de pips fixe.',
      apply: S((s) => Object.assign({}, s, { stopAtr: k, takeAtr: m * k, atrPeriod: s.atrPeriod || 14 })),
    })))));
    add('Stop suiveur', [1.5, 2, 3].map((k) => ({
      id: 'tra-' + k, title: 'Stop suiveur à ' + fmt(k) + ' ATR du meilleur prix atteint',
      detail: 'Le stop suit le prix quand il avance et ne recule jamais : on laisse courir les gains en les protégeant.',
      apply: S((s) => Object.assign({}, s, { trailAtr: k, trailPips: 0, atrPeriod: s.atrPeriod || 14 })),
    })).concat(st.slGrid.slice(1, 4).map((v) => ({
      id: 'trp-' + v, title: 'Stop suiveur à ' + v + ' pips du meilleur prix atteint', detail: 'Le stop suit le prix quand il avance et ne recule jamais.',
      apply: S((s) => Object.assign({}, s, { trailPips: v, trailAtr: 0 })),
    }))));
    add('Passage à l\'équilibre', [1, 1.5, 2].map((k) => ({
      id: 'be-' + k, title: 'Remonter le stop au prix d\'entrée après un gain de ' + fmt(k) + ' ATR',
      detail: 'Un trade bien parti ne peut plus finir en perte.', apply: S((s) => Object.assign({}, s, { breakevenAtr: k, breakevenPips: 0, atrPeriod: s.atrPeriod || 14 })),
    })));
    add('Durée maximale', [5, 10, 20, 40].map((k) => Math.max(2, Math.round(k * st.factor))).filter((k, i, a) => a.indexOf(k) === i).map((k) => ({
      id: 'mb-' + k, title: 'Fermer les positions après ' + k + ' bougies', detail: 'Libère le capital des trades qui ne partent pas.',
      apply: S((s) => Object.assign({}, s, { maxBars: k })),
    })));
    if (hasEntry && !/ATR\(/.test(canon)) {
      const ap = P(14), lp = P(50);
      add('Filtre de volatilité', [
        { id: 'vol-min', cond: 'ATR(' + ap + ') > SMA(ATR(' + ap + '), ' + lp + ')', title: 'N\'entrer que si la volatilité (ATR ' + ap + ') dépasse sa moyenne sur ' + lp + ' bougies', detail: 'Évite les marchés endormis, où les coûts mangent les gains.' },
        { id: 'vol-max', cond: 'ATR(' + ap + ') < 2 * SMA(ATR(' + ap + '), ' + lp + ')', title: 'Ne pas entrer si la volatilité dépasse le double de sa moyenne', detail: 'Évite les marchés agités (annonces, chocs) où les stops sautent.' },
      ].map((v) => ({ id: v.id, title: v.title, detail: v.detail,
        apply: S((s) => Object.assign({}, s, { longEntry: andWith(s.longEntry, v.cond), shortEntry: andWith(s.shortEntry, v.cond) })) })));
    }
    if (hasEntry && !/WEEKDAY|HOUR/.test(canon)) {
      const intraday = bars.length > 1 && String(bars[bars.length - 1].date).length > 10;
      const days = [[5, 'le vendredi'], [1, 'le lundi']].map(([d, l]) => ({ cond: 'WEEKDAY != ' + d, id: 'wd-' + d, title: 'Ne pas entrer ' + l, detail: 'Évite un jour de semaine défavorable à cette stratégie.' }));
      const hours = intraday ? [
        { cond: 'HOUR >= 7 AND HOUR < 17', id: 'h-ldn', title: 'N\'entrer qu\'entre 7 h et 17 h (heure du serveur)', detail: 'Séances de Londres et New York : plus de liquidité, spreads plus bas.' },
        { cond: 'HOUR >= 12 AND HOUR < 17', id: 'h-ny', title: 'N\'entrer qu\'entre 12 h et 17 h (chevauchement Londres / New York)', detail: 'La période la plus active de la journée.' },
        { cond: 'HOUR >= 1', id: 'h-mid', title: 'Ne pas entrer entre minuit et 1 h', detail: 'Évite les spreads élevés de la bascule de minuit chez le courtier.' },
      ] : [];
      add('Jours et heures', days.concat(hours).map((v) => ({ id: v.id, title: v.title, detail: v.detail,
        apply: S((s) => Object.assign({}, s, { longEntry: andWith(s.longEntry, v.cond), shortEntry: andWith(s.shortEntry, v.cond) })) })));
    }
    add('Pause après des pertes', [[2, 5], [3, 5], [3, 10]].map(([nl, nb]) => ({
      id: 'pz-' + nl + '-' + nb, title: 'Après ' + nl + ' pertes de suite, ne plus entrer pendant ' + nb + ' bougies',
      detail: 'Coupe les séries noires quand le marché ne convient plus à la stratégie.',
      apply: S((s) => Object.assign({}, s, { pauseLosses: nl, pauseBars: nb })),
    })));
    if (curSl > 0 || strat.stopAtr > 0) {
      add('Taille au risque', [0.5, 1, 2].map((r) => ({
        id: 'rk-' + r, title: 'Taille des positions : risquer ' + fmt(r) + ' % du capital par trade (jusqu\'au stop-loss)',
        detail: 'La taille s\'adapte à la distance du stop : chaque perte coûte le même pourcentage du compte.',
        apply: ({ strat: s, settings: se }) => ({ strat: s, settings: Object.assign({}, se, { sizing: 'risk', riskPct: r }) }),
      })));
    }
    if (settings.newsCalendar && settings.newsCalendar.length && !(settings.news && settings.news.times)) {
      add('Annonces économiques', [['block', 30, 30], ['block', 60, 60], ['close', 30, 30]].map(([mode, bf, af]) => ({
        id: 'news-' + mode + bf, title: (mode === 'close' ? 'Fermer les positions et ne pas entrer' : 'Ne pas entrer') + ' de ' + bf + ' min avant à ' + af + ' min après une annonce à fort impact',
        detail: 'Annonces de ' + (settings.newsCurrencies || 'la paire') + ' tirées du calendrier économique de MetaTrader 5.',
        apply: ({ strat: s, settings: se }) => ({ strat: s, settings: Object.assign({}, se, { news: { times: se.newsCalendar, before: bf, after: af, mode: mode } }) }),
      })));
    }

    // Contrôle hors échantillon (« walk-forward ») : jusqu'à 3 périodes de même durée juste avant la période testée,
    // qui n'ont pas servi à choisir les suggestions.
    const folds = makeFolds(bars, settings).map((f) => Object.assign(f, { base: run(f.bars, strat, f.settings) })).filter((f) => f.base);
    const vBars = folds.length ? folds[0].bars : null, vSet = folds.length ? folds[0].settings : null;
    const validate = (sg) => validateOn(folds, strat, sg.apply);

    // Pour chaque groupe, on garde la meilleure variante si elle améliore le résultat.
    // Groupe « robuste » (grille) : note = la moins bonne entre la période testée et la précédente.
    const suggestions = [];
    for (const g of groups) {
      let best = null;
      for (const v of g.variants) {
        const r = v.apply({ strat: strat, settings: settings });
        const stats = run(bars, r.strat, r.settings);
        if (!stats) continue;
        let rank = score(stats);
        if (g.robust && folds.length) {
          const f = folds[0], rv = v.apply({ strat: strat, settings: f.settings }), vs = run(f.bars, rv.strat, rv.settings);
          rank = Math.min(rank, vs ? score(vs) - score(f.base) + baseScore : -Infinity);
        }
        if (!best || rank > best.rank) best = Object.assign({}, v, { group: g.group, stats: stats, score: score(stats), rank: rank });
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
    // Combinaison : on cumule les suggestions confirmées, une par une, tant que la note progresse
    // sur la période testée sans se dégrader sur les périodes de contrôle.
    const combo = bestCombination(bars, strat, settings, suggestions.filter((x) => !x.risk), folds, baseScore);
    if (combo) { combo.validation = validate(combo); suggestions.unshift(combo); }
    return { base: base, suggestions: suggestions, folds: folds,
      validation: vBars ? { bars: vBars, settings: vSet, base: folds[0].base, folds: folds } : null };
  }

  /** Jusqu'à n périodes de contrôle de même durée que la période testée, juste avant elle (la plus récente d'abord). */
  function makeFolds(bars, settings, n) {
    const st0 = settings.startIndex, len = bars.length - st0, out = [];
    for (let k = 1; k <= (n || 3); k++) {
      const end = st0 - (k - 1) * len, start = end - len;
      if (start < 250) break; // assez d'historique pour amorcer les indicateurs
      out.push({ bars: bars.slice(0, end), settings: Object.assign({}, settings, { startIndex: start }), k: k });
    }
    return out;
  }
  /** Résultat d'une modification sur chaque période de contrôle ; « confirmée » si elle gagne sur la majorité. */
  function validateOn(folds, strat, apply) {
    if (!folds.length) return null;
    const res = [];
    for (const f of folds) {
      const r = apply({ strat: strat, settings: f.settings }), stats = run(f.bars, r.strat, r.settings);
      // meilleure : note supérieure, sans payer un gain plus faible par un risque plus élevé
      if (stats) res.push({ stats: stats, base: f.base, better: score(stats) > score(f.base) && (stats.returnPct >= f.base.returnPct || stats.maxDrawdownPct < f.base.maxDrawdownPct) });
    }
    if (!res.length) return null;
    const wins = res.filter((x) => x.better).length;
    return { stats: res[0].stats, base: res[0].base, folds: res, wins: wins, total: res.length, confirmed: wins * 2 > res.length };
  }
  function bestCombination(bars, strat, settings, list, folds, baseScore) {
    const pool = list.filter((x) => !folds.length || (x.validation && x.validation.confirmed)).slice(0, 8);
    if (pool.length < 2) return null;
    let chosen = [], cur = baseScore;
    const foldScore = (sel) => folds.reduce((a, f) => { const c = combine(strat, f.settings, sel), st = run(f.bars, c.strat, c.settings); return a + score(st); }, 0);
    let curFold = folds.length ? foldScore([]) : 0;
    for (const sg of pool.slice().sort((a, b) => b.score - a.score)) {
      if (chosen.some((c) => c.group === sg.group)) continue;
      const trial = chosen.concat([sg]), c = combine(strat, settings, trial), st = run(bars, c.strat, c.settings), sc = score(st);
      if (sc <= cur + 0.5) continue;
      const fs = folds.length ? foldScore(trial) : 0;
      if (folds.length && fs < curFold) continue;
      chosen = trial; cur = sc; curFold = fs;
    }
    if (chosen.length < 2) return null;
    const c = combine(strat, settings, chosen), stats = run(bars, c.strat, c.settings);
    return {
      id: 'combo-' + chosen.map((x) => x.id).join('+'), group: 'Combinaison recommandée', combo: chosen,
      title: chosen.map((x) => x.title).join(' + '),
      detail: chosen.length + ' améliorations cumulées une par une, gardées seulement si elles progressent ensemble sur la période testée et sur les périodes de contrôle.',
      stats: stats, score: score(stats), apply: (ctx) => { let cur2 = ctx; for (const x of chosen.slice().sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group))) cur2 = x.apply(cur2); return cur2; },
    };
  }

  // Ordre d'application : réglages, seuils, filtres, sorties, sens, stop/objectif, levier.
  const ORDER = ['Réglage des indicateurs', 'Seuils des oscillateurs', 'Filtre de tendance', 'Pente de la moyenne', 'Alignement des moyennes', 'Force de la tendance (ADX)', 'Régime de marché',
    'Tendance supérieure', 'Croisement de moyennes (entrée)', 'Croisement de moyennes (confirmation)', 'Confirmation', 'Filtre de volatilité', 'Jours et heures', 'Sortie',
    'Sens des positions', 'Stop-loss', 'Take-profit', 'Stops selon la volatilité (ATR)', 'Stop suiveur', 'Passage à l\'équilibre', 'Durée maximale', 'Pause après des pertes',
    'Taille au risque', 'Annonces économiques', 'Gestion du risque', 'Combinaison recommandée', 'Mon amélioration'];

  /**
   * Amélioration écrite par l'utilisateur, en français (« Acheter seulement si le RSI 14 est au-dessus de 50 »,
   * « Stop loss 40 pips »…). mode : 'and' (condition supplémentaire), 'or' (alternative) ou 'replace'.
   * Les règles de sortie s'ajoutent toujours en alternative (n'importe laquelle déclenche la sortie).
   * Renvoie une suggestion testée comme les autres, ou { error }.
   */
  function customSuggestion(bars, strat, settings, text, mode) {
    if (!String(text || '').trim()) return { error: 'Écrivez votre amélioration.' };
    const parsed = FR.parse(text);
    const notes = parsed.warnings.filter((w) => !/Aucune règle d'entrée/.test(w));
    const LABEL = { longEntry: 'Entrée achat', shortEntry: 'Entrée vente', longExit: 'Sortie achat', shortExit: 'Sortie vente' };
    const changes = [];
    for (const k of ['longEntry', 'shortEntry', 'longExit', 'shortExit']) {
      if (!parsed[k]) continue;
      const isExit = /Exit$/.test(k);
      if (mode === 'and' && !isExit && !strat[k]) {
        notes.push('La stratégie ne prend pas de ' + (k === 'longEntry' ? 'achats' : 'ventes') + ' : condition ignorée (choisissez « Remplacer la règle » pour en ajouter).');
        continue;
      }
      changes.push({ k: k, rule: parsed[k], isExit: isExit });
    }
    if (parsed.stopLossPips) changes.push({ k: 'sl', v: parsed.stopLossPips });
    if (parsed.takeProfitPips) changes.push({ k: 'tp', v: parsed.takeProfitPips });
    const TM = { stopAtr: 'Stop-loss (ATR)', takeAtr: 'Take-profit (ATR)', atrPeriod: 'Période ATR', trailPips: 'Stop suiveur (pips)', trailAtr: 'Stop suiveur (ATR)',
      breakevenPips: 'Stop à l\'entrée après (pips)', breakevenAtr: 'Stop à l\'entrée après (ATR)', maxBars: 'Durée maximale (bougies)', pauseLosses: 'Pause après (pertes)', pauseBars: 'Durée de pause (bougies)' };
    for (const f of Object.keys(TM)) if (parsed[f]) changes.push({ k: 'tm', f: f, v: parsed[f], label: TM[f] });
    if (!changes.length) {
      return { error: (notes.length ? notes.join(' ') + ' ' : '') + 'Rien à appliquer : commencez par « Acheter… », « Vendre… », « Sortir… », « Stop loss … pips », « Stop suiveur 2 ATR » ou « Fermer après 10 bougies ».' };
    }
    const apply = ({ strat: s, settings: se }) => {
      const o = Object.assign({}, s);
      for (const c of changes) {
        if (c.k === 'sl') o.stopLossPips = c.v;
        else if (c.k === 'tp') o.takeProfitPips = c.v;
        else if (c.k === 'tm') o[c.f] = c.v;
        else if (mode === 'replace' || !o[c.k]) o[c.k] = c.rule;
        else if (c.isExit || mode === 'or') o[c.k] = orWith(o[c.k], c.rule);
        else o[c.k] = andWith(o[c.k], c.rule);
      }
      return { strat: o, settings: se };
    };
    const out = apply({ strat: strat, settings: settings });
    for (const k of ['longEntry', 'longExit', 'shortEntry', 'shortExit']) { const e = R.validate(out.strat[k]); if (e) return { error: 'Règle invalide : ' + e }; }
    const stats = run(bars, out.strat, out.settings);
    if (!stats) return { error: 'Simulation impossible avec cette amélioration.' };
    const how = { and: 'ET', or: 'OU', replace: 'remplacée par' };
    const detail = changes.map((c) => (c.k === 'sl' ? 'Stop-loss : ' + c.v + ' pips' : c.k === 'tp' ? 'Take-profit : ' + c.v + ' pips' : c.k === 'tm' ? c.label + ' : ' + c.v
      : LABEL[c.k] + (mode === 'replace' || !strat[c.k] ? ' : ' : c.isExit ? ' OU ' : ' ' + how[mode] + ' ') + c.rule)).join(' · ');
    // contrôle sur la période précédente, comme les suggestions automatiques
    const folds = makeFolds(bars, settings).map((f) => Object.assign(f, { base: run(f.bars, strat, f.settings) })).filter((f) => f.base);
    const validation = validateOn(folds, strat, apply);
    return {
      id: 'custom-' + Date.now() + '-' + Math.floor(Math.random() * 1e6), group: 'Mon amélioration', custom: true,
      title: String(text).trim().replace(/\s+/g, ' ').slice(0, 160), detail: detail, notes: notes,
      stats: stats, score: score(stats), apply: apply, validation: validation,
    };
  }
  function combine(strat, settings, selected) {
    let cur = { strat: Object.assign({}, strat), settings: Object.assign({}, settings) };
    // une combinaison cochée avec l'une de ses composantes : chaque amélioration n'est appliquée qu'une fois
    const flat = [], seen = new Set();
    for (const s of selected) for (const x of s.combo || [s]) if (!seen.has(x.id)) { seen.add(x.id); flat.push(x); }
    for (const s of flat.sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group))) cur = s.apply(cur);
    return cur;
  }

  /** Robustesse : la même stratégie sur d'autres paires. runs = [{pair, stats}] -> résumé. */
  function robustness(runs) {
    const ok = runs.filter((r) => r.stats);
    const pos = ok.filter((r) => r.stats.returnPct > 0).length;
    return { runs: runs, tested: ok.length, positive: pos, robust: ok.length >= 3 && pos * 3 >= ok.length * 2 };
  }

  F.enhancer = { STYLES, adaptToStyle, scaleStrategy, suggest, combine, score, run, customSuggestion, makeFolds, validateOn, robustness, ORDER, andWith, orWith };
})(typeof window !== 'undefined' ? window : globalThis);
