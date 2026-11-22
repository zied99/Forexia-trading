/* Forexia — analyseur d'une simulation.
 *
 * Explique le résultat d'un backtest : d'où vient la plus forte baisse (choc de volatilité, marché sans
 * tendance pour une stratégie de tendance, tendance forte pour une stratégie de retour à la moyenne, trade
 * contre la tendance de fond, levier / appel de marge, absence de stop…), où la stratégie gagne et perd
 * (régime de marché, sens, volatilité, durée des trades), et propose des corrections à tester.
 * Calcul local et transparent : uniquement les cours, les indicateurs et les trades de la simulation. */
(function (root) {
  'use strict';
  const F = root.Forexia;

  const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const pct = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ',') + ' %';
  const fr = (v, d) => Number(v).toFixed(d == null ? 1 : d).replace('.', ',');
  const frDate = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : d; };

  /** Type de la stratégie d'après ses règles : tendance, retour à la moyenne ou mixte. */
  function strategyKind(strat) {
    const txt = ['longEntry', 'shortEntry'].map((k) => strat[k] || '').join(' ');
    const trend = (txt.match(/CROSS_(UP|DOWN)\((EMA|SMA)\(|CROSS_(UP|DOWN)\(CLOSE, (EMA|SMA|SUPERTREND|DONCHIAN|PSAR|KIJUN|TENKAN|LINE)|MACD|SUPERTREND|DONCHIAN|PSAR|SLOPE\(|ADX\(\d+\) >|TENKAN|KIJUN|CLOSE > (EMA|SMA)|CLOSE < (EMA|SMA)|@(D1|W1|MN|H4)/g) || []).length;
    const rev = (txt.match(/RSI\(\d+\)\s*[<>]=?\s*\d|CROSS_(UP|DOWN)\(RSI|STOCH|BB_(UPPER|LOWER)|CCI\(|WILLR|ADX\(\d+\) </g) || []).length;
    if (trend && rev) return trend >= rev * 2 ? 'trend' : rev >= trend * 2 ? 'reversion' : 'mixed';
    return trend ? 'trend' : rev ? 'reversion' : 'mixed';
  }
  const KIND_LABEL = { trend: 'de suivi de tendance', reversion: 'de retour à la moyenne (contre-tendance)', mixed: 'mixte (tendance + retour à la moyenne)' };

  /**
   * bars, strat, settings, result : la simulation (comme dans Forexia).
   * Renvoie { verdict, kind, drop, sections: [{title, level, items}], groups, proposals: [{id, title, why, change}] }
   * change : {strat: {...champs}, settings: {...champs}, entryAnd: 'condition'} appliqué par applyProposal().
   */
  function analyze(bars, strat, settings, result) {
    const R = F.rules, I = F.indicators;
    const ctx = R.makeContext(bars), n = bars.length, st0 = result.startIndex;
    const adx = R.evaluateSeries('ADX(14)', ctx), atr = I.atr(ctx.high, ctx.low, ctx.close, 14), ema200 = I.ema(ctx.close, 200);
    const atrMed = median(atr.slice(st0)), pip = /JPY/.test(settings.pair || '') ? 0.01 : 0.0001;
    const s = result.stats, trades = result.trades || [], kind = strategyKind(strat);
    const lev = settings.leverage || 1, effLev = settings.broker || settings.sizing === 'fixed' || settings.sizing === 'risk' ? null : (lev * (settings.exposurePct || 100)) / 100;
    const hasStop = strat.stopLossPips > 0 || strat.stopAtr > 0;
    const sections = [], proposals = [];
    const regimeOf = (i) => (!Number.isFinite(adx[i]) ? 'inconnu' : adx[i] >= 25 ? 'tendance' : adx[i] < 20 ? 'sans tendance' : 'intermédiaire');

    // ---- contexte de chaque trade (à la bougie qui a donné le signal)
    const T = trades.map((t) => {
      const i = Math.max(0, t.entryIndex - 1), withTrend = Number.isFinite(ema200[i]) ? (t.dir > 0 ? ctx.close[i] > ema200[i] : ctx.close[i] < ema200[i]) : null;
      const vol = Number.isFinite(atr[i]) && atrMed > 0 ? atr[i] / atrMed : NaN;
      // plus grand gain latent (en ATR) pendant le trade
      let mfe = 0;
      for (let j = t.entryIndex; j <= t.exitIndex && j < n; j++) mfe = Math.max(mfe, ((t.dir > 0 ? bars[j].high : bars[j].low) - t.entryPrice) * t.dir);
      return Object.assign({}, t, { regime: regimeOf(i), adx: adx[i], withTrend: withTrend, vol: vol, mfeAtr: atr[i] > 0 ? mfe / atr[i] : 0, lossAtr: atr[i] > 0 ? ((t.exitPrice - t.entryPrice) * t.dir) / atr[i] : 0 });
    });

    // ---- la plus forte baisse (du sommet au creux) et la chute la plus brutale (une bougie)
    const w = result.wealth || result.equity, cap = s.initialCapital;
    let peak = cap, peakJ = -1, best = { dd: 0 }, worstBar = { d: 0 };
    for (let j = 0; j < w.length; j++) {
      if (w[j] > peak) { peak = w[j]; peakJ = j; }
      const dd = peak > 0 ? (peak - w[j]) / peak : 0;
      if (dd > best.dd) best = { dd: dd, from: peakJ, to: j, peak: peak, trough: w[j] };
      const prev = j ? w[j - 1] : cap, d = prev > 0 ? (w[j] - prev) / prev : 0;
      if (d < worstBar.d) worstBar = { d: d, j: j };
    }
    const dateAt = (j) => String(bars[st0 + Math.max(0, j)].date).slice(0, 10);
    const drop = best.dd > 0 ? { pct: best.dd * 100, from: dateAt(best.from), to: dateAt(best.to), fromJ: best.from, toJ: best.to } : null;
    if (drop) {
      const inDD = T.filter((t) => t.exitIndex - st0 > best.from && t.exitIndex - st0 <= best.to);
      const losers = inDD.filter((t) => t.pnl < 0).sort((a, b) => a.pnl - b.pnl);
      const items = ['Baisse de ' + pct(-drop.pct) + ' du ' + frDate(drop.from) + ' au ' + frDate(drop.to) + ' (' + inDD.length + ' trade' + (inDD.length > 1 ? 's' : '') + ' clôturé' + (inDD.length > 1 ? 's' : '') + ', ' + losers.length + ' perdant' + (losers.length > 1 ? 's' : '') + ').'];
      const big = losers[0];
      if (big) {
        const share = losers.length ? (big.pnl / sum(losers.map((x) => x.pnl))) * 100 : 0;
        const reasons = [];
        if (big.reason === 'Margin call') reasons.push('la position a été <b>liquidée (appel de marge)</b> : le levier effectif était trop élevé pour l\'amplitude du mouvement');
        if (!hasStop && big.reason !== 'Stop-loss') reasons.push('il n\'y avait <b>aucun stop-loss</b> : la perte a continué jusqu\'au signal de sortie');
        if (Number.isFinite(big.vol) && big.vol >= 1.4) reasons.push('la volatilité était <b>' + fr(big.vol) + ' fois</b> plus forte que d\'habitude (choc de marché, annonce…)');
        if (kind === 'trend' && big.regime === 'sans tendance') reasons.push('la stratégie suit la tendance mais le marché était <b>sans tendance</b> (ADX ' + fr(big.adx, 0) + ') : faux signal dans un marché qui oscille');
        if (kind === 'reversion' && big.regime === 'tendance') reasons.push('la stratégie joue le retour à la moyenne mais le marché était <b>en forte tendance</b> (ADX ' + fr(big.adx, 0) + ') : le prix a continué sans revenir');
        if (big.withTrend === false) reasons.push('le trade allait <b>contre la tendance de fond</b> (' + (big.dir > 0 ? 'achat sous' : 'vente au-dessus de') + ' la moyenne mobile 200)');
        if (big.mfeAtr >= 1) reasons.push('le trade a d\'abord été gagnant (jusqu\'à ' + fr(big.mfeAtr) + ' ATR) avant de se retourner : un <b>stop suiveur</b> ou un stop au prix d\'entrée l\'aurait protégé');
        items.push('Le plus gros trade perdant : ' + (big.dir > 0 ? 'achat' : 'vente') + ' du ' + frDate(big.entryDate) + ' au ' + frDate(big.exitDate) + ', ' + fr(big.pips, 0) + ' pips, ' +
          pct((big.pnl / Math.max(1e-9, w[Math.max(0, big.entryIndex - st0 - 1)] || cap)) * 100) + ' du compte, sortie : ' + big.reason + ' (' + Math.round(share) + ' % des pertes de la période).');
        items.push(reasons.length ? 'Pourquoi : ' + reasons.join(' ; ') + '.' : 'Pourquoi : rien d\'anormal sur ce trade (volatilité, régime et sens habituels) : c\'est une série de pertes « normales » pour cette stratégie.');
      }
      const wb = worstBar.j != null ? worstBar : null;
      if (wb && wb.d < -0.05) {
        const i = st0 + wb.j, mv = Math.abs(bars[i].close - bars[i].open), m = atr[i - 1] > 0 ? mv / atr[i - 1] : 0;
        items.push('Chute la plus brutale : ' + pct(wb.d * 100) + ' en une seule bougie, le ' + frDate(String(bars[i].date).slice(0, 10)) +
          (m >= 2 ? ' — le prix a bougé de ' + fr(m) + ' ATR en une bougie : <b>mouvement exceptionnel</b> (gap, annonce, choc).' : ' — mouvement de prix ordinaire, amplifié par la taille de la position.'));
      }
      sections.push({ title: 'La plus forte baisse', level: drop.pct > 30 ? 'bad' : drop.pct > 15 ? 'warn' : 'ok', items: items });
    }

    // ---- risque : levier, liquidation, stop
    const risk = [];
    if (result.ruined || trades.some((t) => t.reason === 'Margin call')) risk.push('<b>Compte liquidé ou appel de marge</b> : ' + trades.filter((t) => t.reason === 'Margin call').length + ' position(s) fermée(s) de force.');
    if (effLev) {
      const ruinMove = 100 / effLev;
      risk.push('Levier ' + lev + ' × exposition ' + (settings.exposurePct || 100) + ' % = <b>levier effectif ' + fr(effLev, 0) + '</b> : un mouvement de ' + fr(ruinMove) + ' % contre la position (≈ ' +
        Math.round(((bars[n - 1].close * ruinMove) / 100) / pip) + ' pips) efface tout le capital.' + (effLev > 20 ? ' C\'est beaucoup trop pour une stratégie qui reste en position plusieurs jours.' : ''));
    }
    if (!hasStop) risk.push('Aucun stop-loss : chaque position perdante peut coûter sans limite jusqu\'au signal de sortie.');
    if (s.maxLossStreak >= 5) risk.push(s.maxLossStreak + ' pertes de suite au pire moment.');
    if (risk.length) sections.push({ title: 'Risque', level: result.ruined || (effLev && effLev > 20) ? 'bad' : 'warn', items: risk });

    // ---- type de stratégie et régime de marché
    const grp = (f) => {
      const m = new Map();
      for (const t of T) { const k = f(t); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
      return [...m].map(([k, l]) => ({ label: k, n: l.length, pnl: sum(l.map((x) => x.pnl)), winRate: (l.filter((x) => x.pnl > 0).length / l.length) * 100 }));
    };
    const groups = {
      regime: grp((t) => (t.regime === 'inconnu' ? null : t.regime)),
      direction: grp((t) => (t.dir > 0 ? 'achats' : 'ventes')),
      trend: grp((t) => (t.withTrend == null ? null : t.withTrend ? 'dans le sens de la tendance de fond' : 'contre la tendance de fond')),
      volatility: grp((t) => (!Number.isFinite(t.vol) ? null : t.vol >= 1.3 ? 'volatilité forte' : t.vol <= 0.8 ? 'volatilité faible' : 'volatilité normale')),
      duration: grp((t) => (t.bars <= 3 ? '≤ 3 bougies' : t.bars <= 10 ? '4 à 10 bougies' : t.bars <= 30 ? '11 à 30 bougies' : '> 30 bougies')),
    };
    const g = (arr, label) => arr.find((x) => x.label === label);
    const kindItems = ['Stratégie ' + KIND_LABEL[kind] + '.'];
    const rRange = g(groups.regime, 'sans tendance'), rTrend = g(groups.regime, 'tendance');
    if (kind === 'trend' && rRange && rRange.pnl < 0 && (!rTrend || rRange.pnl / rRange.n < rTrend.pnl / rTrend.n)) kindItems.push('Elle perd ' + Math.round(-rRange.pnl) + ' sur ' + rRange.n + ' trades en marché sans tendance (ADX < 20) : c\'est là que naissent ses faux signaux.');
    if (kind === 'reversion' && rTrend && rTrend.pnl < 0 && (!rRange || rTrend.pnl / rTrend.n < rRange.pnl / rRange.n)) kindItems.push('Elle perd ' + Math.round(-rTrend.pnl) + ' sur ' + rTrend.n + ' trades en marché en tendance (ADX ≥ 25) : le prix ne revient pas à la moyenne.');
    if (kind === 'trend' && rTrend && rTrend.pnl < 0 && rRange && rTrend.pnl < rRange.pnl) kindItems.push('Fait notable : elle perd surtout <b>en tendance</b> (' + Math.round(rTrend.pnl) + ') — elle entre souvent trop tard, au moment où la tendance s\'essouffle, ou à contre-sens de la tendance de fond.');
    if (rTrend && rRange) kindItems.push('Résultat en tendance : ' + Math.round(rTrend.pnl) + ' (' + rTrend.n + ' trades) ; sans tendance : ' + Math.round(rRange.pnl) + ' (' + rRange.n + ' trades).');
    const mkt = Number.isFinite(adx[n - 1]) ? 'Marché actuel : ' + regimeOf(n - 1) + ' (ADX ' + fr(adx[n - 1], 0) + ')' : '';
    if (mkt) kindItems.push(mkt + '.');
    sections.push({ title: 'Type de stratégie et marché', level: 'info', items: kindItems });

    // ---- sorties et efficacité
    const exits = {};
    for (const t of trades) exits[t.reason] = (exits[t.reason] || 0) + 1;
    const lost = T.filter((t) => t.pnl < 0), giveBack = lost.filter((t) => t.mfeAtr >= 1);
    const eff = ['Sorties : ' + Object.keys(exits).map((k) => k + ' ' + exits[k]).join(', ') + '.',
      'Gain moyen ' + fr(s.avgWin, 2) + ' contre perte moyenne ' + fr(-s.avgLoss, 2) + ' (' + fr(s.winRate, 0) + ' % de trades gagnants).'];
    if (giveBack.length) eff.push(giveBack.length + ' trade(s) perdant(s) sur ' + lost.length + ' ont d\'abord été gagnants d\'au moins 1 ATR : des gains rendus au marché.');
    sections.push({ title: 'Trades et sorties', level: 'info', items: eff });

    // ---- propositions (testées ensuite par l'application)
    const add = (id, title, why, change) => proposals.push({ id: id, title: title, why: why, change: change });
    if (effLev && (effLev > 10 || result.ruined || (drop && drop.pct > 50))) {
      const target = [1, 2, 5, 10, 20, 30, 50, 100].filter((l) => (l * (settings.exposurePct || 100)) / 100 <= 5).pop() || 1;
      if (target < lev) add('lev', 'Réduire le levier à 1:' + target, 'Levier effectif ' + fr(effLev, 0) + ' : une baisse ordinaire suffit à vider le compte.', { settings: { leverage: target } });
    }
    if (!hasStop) add('sl', 'Ajouter un stop-loss à 2 ATR', 'Limite la perte de chaque trade à 2 fois l\'amplitude moyenne d\'une bougie.', { strat: { stopAtr: 2, atrPeriod: strat.atrPeriod || 14 } });
    if (kind !== 'reversion' && rRange && rRange.pnl < 0) add('adx', 'N\'entrer que si l\'ADX 14 dépasse 25', 'La stratégie suit la tendance et perd surtout en marché sans tendance.', { entryAnd: 'ADX(14) > 25' });
    if (kind === 'reversion' && rTrend && rTrend.pnl < 0) add('adxlow', 'N\'entrer que si l\'ADX 14 est sous 20', 'Le retour à la moyenne marche dans un marché qui oscille, pas en forte tendance.', { entryAnd: 'ADX(14) < 20' });
    const against = g(groups.trend, 'contre la tendance de fond');
    if (against && against.pnl < 0 && against.n >= 2 && !/EMA\(200\)/.test(strat.longEntry + strat.shortEntry)) add('ema200', 'Acheter seulement au-dessus de l\'EMA 200, vendre seulement en dessous', 'Les trades contre la tendance de fond perdent ' + Math.round(-against.pnl) + '.', { longAnd: 'CLOSE > EMA(200)', shortAnd: 'CLOSE < EMA(200)' });
    const longs = g(groups.direction, 'achats'), shorts = g(groups.direction, 'ventes');
    if (longs && shorts && strat.longEntry && strat.shortEntry) {
      if (shorts.pnl < 0 && longs.pnl > 0) add('onlylong', 'Ne prendre que les achats', 'Les ventes perdent ' + Math.round(-shorts.pnl) + ', les achats gagnent ' + Math.round(longs.pnl) + '.', { onlyLong: true });
      if (longs.pnl < 0 && shorts.pnl > 0) add('onlyshort', 'Ne prendre que les ventes', 'Les achats perdent ' + Math.round(-longs.pnl) + ', les ventes gagnent ' + Math.round(shorts.pnl) + '.', { onlyShort: true });
    }
    const hiVol = g(groups.volatility, 'volatilité forte');
    if (hiVol && hiVol.pnl < 0) add('vol', 'Ne pas entrer quand la volatilité dépasse 1,5 fois sa moyenne', 'Les trades ouverts en forte volatilité perdent ' + Math.round(-hiVol.pnl) + '.', { entryAnd: 'ATR(14) < 1.5 * SMA(ATR(14), 50)' });
    if (giveBack.length >= Math.max(2, lost.length * 0.3) && !(strat.trailAtr > 0 || strat.trailPips > 0)) add('trail', 'Stop suiveur à 2 ATR', giveBack.length + ' trades perdants avaient d\'abord été gagnants.', { strat: { trailAtr: 2, atrPeriod: strat.atrPeriod || 14 } });
    if (giveBack.length >= 2 && !(strat.breakevenAtr > 0 || strat.breakevenPips > 0)) add('be', 'Remonter le stop au prix d\'entrée après 1 ATR de gain', 'Un trade bien parti ne doit pas finir en perte.', { strat: { breakevenAtr: 1, atrPeriod: strat.atrPeriod || 14 } });
    const longHold = g(groups.duration, '> 30 bougies');
    if (longHold && longHold.pnl < 0 && !(strat.maxBars > 0)) add('maxbars', 'Fermer les positions après 30 bougies', 'Les trades qui durent plus de 30 bougies perdent ' + Math.round(-longHold.pnl) + '.', { strat: { maxBars: 30 } });
    if (s.maxLossStreak >= 4 && !(strat.pauseLosses > 0)) add('pause', 'Pause de 5 bougies après 3 pertes de suite', 'Série noire de ' + s.maxLossStreak + ' pertes.', { strat: { pauseLosses: 3, pauseBars: 5 } });

    // ---- verdict
    const verdict = [];
    verdict.push('Résultat ' + pct(s.returnPct) + ', drawdown maximal ' + pct(-s.maxDrawdownPct) + ', ' + s.trades + ' trades, ' + fr(s.winRate, 0) + ' % gagnants, facteur de profit ' + (Number.isFinite(s.profitFactor) ? fr(s.profitFactor, 2) : '∞') + '.');
    if (result.ruined || s.returnPct <= -90) verdict.push('Le compte a été vidé (ou presque) : le problème principal est la gestion du risque (levier et stop), avant même les règles d\'entrée.');
    else if (drop && drop.pct > 40 && s.returnPct > 0) verdict.push('La stratégie gagne au final, mais une seule mauvaise phase a effacé ' + Math.round(drop.pct) + ' % du compte : priorité à la limitation des pertes.');
    else if (drop && drop.pct > 40) verdict.push('Les pertes s\'accumulent sur une longue phase défavorable : les règles d\'entrée ne conviennent pas au marché de cette période.');
    if (s.trades < 10) verdict.push('Peu de trades : ce résultat dépend beaucoup du hasard ; vérifiez sur d\'autres périodes (lot de tests aléatoires).');
    return { verdict: verdict, kind: kind, drop: drop, sections: sections, groups: groups, proposals: proposals };
  }

  /** Applique une proposition : {strat, settings} modifiés. */
  function applyProposal(strat, settings, p) {
    const s = Object.assign({}, strat), se = Object.assign({}, settings), c = p.change, E = F.enhancer;
    if (c.strat) Object.assign(s, c.strat);
    if (c.settings) Object.assign(se, c.settings);
    if (c.entryAnd) { if (s.longEntry) s.longEntry = E.andWith(s.longEntry, c.entryAnd); if (s.shortEntry) s.shortEntry = E.andWith(s.shortEntry, c.entryAnd); }
    if (c.longAnd && s.longEntry) s.longEntry = E.andWith(s.longEntry, c.longAnd);
    if (c.shortAnd && s.shortEntry) s.shortEntry = E.andWith(s.shortEntry, c.shortAnd);
    if (c.onlyLong) { s.longExit = E.orWith(s.longExit, s.shortEntry); s.shortEntry = ''; s.shortExit = ''; }
    if (c.onlyShort) { s.shortExit = E.orWith(s.shortExit, s.longEntry); s.longEntry = ''; s.longExit = ''; }
    return { strat: s, settings: se };
  }

  // ---------- Analyseur d'époque : qu'est-ce qui a changé entre deux époques ? ----------
  /** Caractéristiques du marché sur la partie testée d'une simulation (de startIndex à la fin). */
  function marketFeatures(bars, startIndex) {
    const R = F.rules, I = F.indicators, ctx = R.makeContext(bars), n = bars.length, s0 = Math.max(1, startIndex || 1);
    const adx = R.evaluateSeries('ADX(14)', ctx), atr = I.atr(ctx.high, ctx.low, ctx.close, 14), ema = I.ema(ctx.close, 200);
    const c0 = bars[s0].close, c1 = bars[n - 1].close;
    const years = Math.max(1 / 12, (Date.parse(String(bars[n - 1].date).slice(0, 10)) - Date.parse(String(bars[s0].date).slice(0, 10))) / (365.25 * 864e5));
    let path = 0, ups = 0, shocks = 0, above = 0, nAbove = 0, k = 0;
    const rets = [], adxs = [], vols = [];
    for (let i = s0; i < n; i++) {
      const d = bars[i].close - bars[i - 1].close;
      path += Math.abs(d); if (d > 0) ups++;
      rets.push(d / bars[i - 1].close);
      if (Number.isFinite(adx[i])) adxs.push(adx[i]);
      if (Number.isFinite(atr[i - 1]) && atr[i - 1] > 0) { vols.push((atr[i] / bars[i].close) * 100); if (Math.abs(bars[i].close - bars[i].open) > 2.5 * atr[i - 1]) shocks++; }
      if (Number.isFinite(ema[i])) { nAbove++; if (bars[i].close > ema[i]) above++; }
      k++;
    }
    let num = 0, den = 0;
    const mr = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
    for (let i = 1; i < rets.length; i++) { num += (rets[i] - mr) * (rets[i - 1] - mr); }
    for (let i = 0; i < rets.length; i++) den += (rets[i] - mr) ** 2;
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
    return {
      trendYear: ((Math.pow(c1 / c0, 1 / years) - 1) * 100), // variation du prix par an, en %
      adx: avg(adxs), trendShare: adxs.length ? (adxs.filter((v) => v >= 25).length / adxs.length) * 100 : NaN,
      vol: avg(vols), efficiency: path > 0 ? Math.abs(c1 - c0) / path : 0, autocorr: den > 0 ? num / den : 0,
      shocks: k ? (shocks / k) * 100 : 0, upShare: k ? (ups / k) * 100 : 50, aboveEma: nAbove ? (above / nAbove) * 100 : NaN,
    };
  }
  /** Trades d'une simulation résumés en pips (comparables d'une simulation à l'autre). */
  function tradeFeatures(bars, result) {
    const R = F.rules, ctx = R.makeContext(bars), adx = R.evaluateSeries('ADX(14)', ctx);
    return (result.trades || []).map((t) => { const a = adx[Math.max(0, t.entryIndex - 1)]; return { dir: t.dir, pips: t.pips, win: t.pnl > 0, bars: t.bars, regime: !Number.isFinite(a) ? '' : a >= 25 ? 'trend' : a < 20 ? 'range' : 'mid', reason: t.reason }; });
  }
  /**
   * Compare deux époques. A et B : listes de { features, trades, returnPct } (une par simulation rechargée).
   * Renvoie { rows: [{label, a, b, fmt}], causes: [{score, text}], tradeRows, A:{...}, B:{...} }.
   */
  function compareEras(A, B, strat, labels) {
    const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN; };
    const f = (L, k) => med(L.map((x) => x.features[k]));
    const keys = ['trendYear', 'aboveEma', 'adx', 'trendShare', 'efficiency', 'autocorr', 'vol', 'shocks'];
    const agg = (L) => { const o = { n: L.length, ret: med(L.map((x) => x.returnPct)), win: (L.filter((x) => x.returnPct > 0).length / Math.max(1, L.length)) * 100 }; for (const k of keys) o[k] = f(L, k); const T = L.flatMap((x) => x.trades); o.trades = T; return o; };
    const a = agg(A), b = agg(B), kind = strategyKind(strat), la = labels[0], lb = labels[1];
    const tr = (T, filt) => { const l = T.filter(filt); return { n: l.length, win: l.length ? (l.filter((t) => t.win).length / l.length) * 100 : NaN, pips: l.length ? l.reduce((s, t) => s + t.pips, 0) / l.length : NaN }; };
    const tradeRows = [
      ['Tous les trades', () => true], ['Achats', (t) => t.dir > 0], ['Ventes', (t) => t.dir < 0],
      ['Marché en tendance (ADX ≥ 25)', (t) => t.regime === 'trend'], ['Marché sans tendance (ADX < 20)', (t) => t.regime === 'range'],
    ].map(([label, fn]) => ({ label: label, a: tr(a.trades, fn), b: tr(b.trades, fn) }));
    const pc = (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d == null ? 1 : d).replace('.', ',');
    const dirOf = (v) => (v > 3 ? 'haussier' : v < -3 ? 'baissier' : 'sans direction nette');
    const rows = [
      { label: 'Direction du prix (variation par an)', a: a.trendYear, b: b.trendYear, fmt: (v) => pc(v) + ' %/an (' + dirOf(v) + ')' },
      { label: 'Temps passé au-dessus de l\'EMA 200', a: a.aboveEma, b: b.aboveEma, fmt: (v) => Math.round(v) + ' %' },
      { label: 'Force de la tendance (ADX 14 moyen)', a: a.adx, b: b.adx, fmt: (v) => v.toFixed(0) },
      { label: 'Temps en tendance (ADX ≥ 25)', a: a.trendShare, b: b.trendShare, fmt: (v) => Math.round(v) + ' %' },
      { label: 'Netteté du mouvement (0 = va-et-vient, 1 = ligne droite)', a: a.efficiency, b: b.efficiency, fmt: (v) => v.toFixed(2).replace('.', ',') },
      { label: 'Retour à la moyenne (autocorrélation, < 0 = le prix revient)', a: a.autocorr, b: b.autocorr, fmt: (v) => pc(v, 2) },
      { label: 'Volatilité (ATR en % du prix)', a: a.vol, b: b.vol, fmt: (v) => v.toFixed(2).replace('.', ',') + ' %' },
      { label: 'Chocs (bougies > 2,5 ATR, pour 100 bougies)', a: a.shocks, b: b.shocks, fmt: (v) => v.toFixed(1).replace('.', ',') },
    ];
    const causes = [], add = (score, text) => causes.push({ score: score, text: text });
    const ok = (v) => Number.isFinite(v);
    // direction
    if (ok(a.trendYear) && ok(b.trendYear) && dirOf(a.trendYear) !== dirOf(b.trendYear)) {
      const T = tradeRows;
      let t = 'Le marché a changé de direction : <b>' + dirOf(a.trendYear) + '</b> ' + la + ' (' + pc(a.trendYear) + ' %/an), <b>' + dirOf(b.trendYear) + '</b> ' + lb + ' (' + pc(b.trendYear) + ' %/an).';
      if (ok(T[1].a.pips) && ok(T[2].a.pips)) {
        const dA = dirOf(a.trendYear), longWorse = T[1].a.pips < T[2].a.pips;
        t += ' ' + la[0].toUpperCase() + la.slice(1) + ', les achats font ' + pc(T[1].a.pips, 0) + ' pips en moyenne et les ventes ' + pc(T[2].a.pips, 0) + ' pips' +
          (longWorse && dA === 'baissier' ? ' : la stratégie achetait trop dans un marché qui baissait.' : !longWorse && dA === 'haussier' ? ' : la stratégie vendait trop dans un marché qui montait.' :
            dA === 'sans direction nette' ? ' : sans direction nette, ni les achats ni les ventes ne profitent d\'un mouvement durable.' : '.');
      }
      add(2 + Math.min(3, Math.abs(a.trendYear - b.trendYear) / 5), t);
    }
    // force de la tendance
    if (ok(a.trendShare) && ok(b.trendShare) && Math.abs(a.trendShare - b.trendShare) >= 8) {
      const moreTrendB = b.trendShare > a.trendShare;
      let t = 'Le marché était ' + (moreTrendB ? '<b>moins en tendance</b> ' + la : '<b>plus en tendance</b> ' + la) + ' : ' + Math.round(a.trendShare) + ' % du temps en tendance contre ' + Math.round(b.trendShare) + ' % ' + lb + '.';
      if (kind === 'trend' && moreTrendB) t += ' Pour une stratégie de tendance, un marché qui oscille donne de faux signaux.';
      if (kind === 'reversion' && !moreTrendB) t += ' Pour une stratégie de retour à la moyenne, une tendance forte fait perdre : le prix ne revient pas.';
      add(1 + Math.abs(a.trendShare - b.trendShare) / 10 + ((kind === 'trend' && moreTrendB) || (kind === 'reversion' && !moreTrendB) ? 1.5 : 0), t);
    }
    // netteté / retour à la moyenne
    if (ok(a.efficiency) && ok(b.efficiency) && Math.abs(a.efficiency - b.efficiency) >= 0.08) {
      const choppyA = a.efficiency < b.efficiency;
      add(1 + Math.abs(a.efficiency - b.efficiency) * 8, 'Les mouvements étaient ' + (choppyA ? '<b>plus heurtés</b> (va-et-vient) ' + la : '<b>plus nets</b> ' + la) + ' : netteté ' + a.efficiency.toFixed(2).replace('.', ',') + ' contre ' + b.efficiency.toFixed(2).replace('.', ',') + '.' +
        (kind === 'trend' && choppyA ? ' Une stratégie de tendance entre puis se fait sortir à contre-temps.' : ''));
    }
    if (ok(a.autocorr) && ok(b.autocorr) && Math.abs(a.autocorr - b.autocorr) >= 0.05) {
      add(0.8 + Math.abs(a.autocorr - b.autocorr) * 10, 'Le prix ' + (a.autocorr < b.autocorr ? '<b>revenait davantage en arrière</b>' : '<b>prolongeait davantage ses mouvements</b>') + ' ' + la + ' (autocorrélation ' + pc(a.autocorr, 2) + ' contre ' + pc(b.autocorr, 2) + ').');
    }
    // volatilité
    if (ok(a.vol) && ok(b.vol) && a.vol > 0 && b.vol > 0 && Math.max(a.vol / b.vol, b.vol / a.vol) >= 1.25) {
      const r = a.vol / b.vol;
      add(1 + Math.abs(Math.log(r)) * 3, 'La volatilité était <b>' + (r > 1 ? r.toFixed(1).replace('.', ',') + ' fois plus forte' : (1 / r).toFixed(1).replace('.', ',') + ' fois plus faible') + '</b> ' + la + ' : ' + (r > 1 ? 'des stops et des réglages calibrés pour un marché calme sont touchés plus souvent.' : 'les mouvements sont trop petits pour couvrir le spread et atteindre les objectifs.'));
    }
    if (ok(a.shocks) && ok(b.shocks) && a.shocks - b.shocks >= 0.5) add(1 + (a.shocks - b.shocks), 'Plus de <b>chocs</b> ' + la + ' : ' + a.shocks.toFixed(1).replace('.', ',') + ' bougies exceptionnelles pour 100, contre ' + b.shocks.toFixed(1).replace('.', ',') + '.');
    // trades
    const ta = tradeRows[0].a, tb = tradeRows[0].b;
    if (ok(ta.win) && ok(tb.win)) {
      add(0.5 + Math.abs(ta.win - tb.win) / 15, 'Côté trades : ' + Math.round(ta.win) + ' % de trades gagnants ' + la + ' (' + pc(ta.pips, 0) + ' pips en moyenne) contre ' + Math.round(tb.win) + ' % ' + lb + ' (' + pc(tb.pips, 0) + ' pips).' +
        (ta.n && tb.n && Math.abs(ta.n / A.length - tb.n / B.length) > 0.3 * (tb.n / B.length) ? ' Nombre de trades par simulation : ' + (ta.n / A.length).toFixed(1).replace('.', ',') + ' contre ' + (tb.n / B.length).toFixed(1).replace('.', ',') + '.' : ''));
    }
    const rr = tradeRows[4], rt = tradeRows[3];
    if (ok(rr.a.pips) && rr.a.n >= 3 && rr.a.pips < 0 && (!ok(rt.a.pips) || rt.a.pips > rr.a.pips)) add(1.2, 'Les pertes ' + la + ' viennent surtout des trades pris en marché <b>sans tendance</b> (' + pc(rr.a.pips, 0) + ' pips en moyenne sur ' + rr.a.n + ' trades).');
    if (ok(rt.a.pips) && rt.a.n >= 3 && rt.a.pips < 0 && (!ok(rr.a.pips) || rr.a.pips > rt.a.pips)) add(1.2, 'Les pertes ' + la + ' viennent surtout des trades pris en marché <b>en tendance</b> (' + pc(rt.a.pips, 0) + ' pips en moyenne sur ' + rt.a.n + ' trades).');
    causes.sort((x, y) => y.score - x.score);
    return { rows: rows, causes: causes, tradeRows: tradeRows, A: a, B: b, kind: kind };
  }
  /** Corrections à tester entre deux époques (mêmes formats que les propositions de l'analyseur). */
  function eraCandidates(strat, cmp) {
    const out = [], hasStop = strat.stopLossPips > 0 || strat.stopAtr > 0;
    out.push({ id: 'adx25', title: 'N\'entrer que si l\'ADX 14 dépasse 25 (marché en tendance)', change: { entryAnd: 'ADX(14) > 25' } });
    out.push({ id: 'adx20', title: 'N\'entrer que si l\'ADX 14 est sous 20 (marché sans tendance)', change: { entryAnd: 'ADX(14) < 20' } });
    if (!/EMA\(200\)/.test((strat.longEntry || '') + (strat.shortEntry || ''))) out.push({ id: 'ema200', title: 'Suivre la tendance de fond : acheter au-dessus de l\'EMA 200, vendre en dessous', change: { longAnd: 'CLOSE > EMA(200)', shortAnd: 'CLOSE < EMA(200)' } });
    if (strat.longEntry && strat.shortEntry) {
      out.push({ id: 'long', title: 'Ne prendre que les achats', change: { onlyLong: true } });
      out.push({ id: 'short', title: 'Ne prendre que les ventes', change: { onlyShort: true } });
    }
    out.push({ id: 'volhi', title: 'Ne pas entrer quand la volatilité dépasse 1,5 fois sa moyenne', change: { entryAnd: 'ATR(14) < 1.5 * SMA(ATR(14), 50)' } });
    out.push({ id: 'vollo', title: 'Ne pas entrer quand le marché est trop calme (ATR sous 0,8 fois sa moyenne)', change: { entryAnd: 'ATR(14) > 0.8 * SMA(ATR(14), 100)' } });
    out.push({ id: 'slope', title: 'Acheter seulement si l\'EMA 50 monte, vendre seulement si elle baisse', change: { longAnd: 'SLOPE(EMA(50), 10) > 0', shortAnd: 'SLOPE(EMA(50), 10) < 0' } });
    if (!hasStop) out.push({ id: 'sl', title: 'Stop-loss à 2 ATR', change: { strat: { stopAtr: 2, atrPeriod: strat.atrPeriod || 14 } } });
    if (!(strat.trailAtr > 0)) out.push({ id: 'trail', title: 'Stop suiveur à 2 ATR', change: { strat: { trailAtr: 2, atrPeriod: strat.atrPeriod || 14 } } });
    return out;
  }

  F.analyzer = { analyze, applyProposal, strategyKind, marketFeatures, tradeFeatures, compareEras, eraCandidates };
})(typeof window !== 'undefined' ? window : globalThis);
