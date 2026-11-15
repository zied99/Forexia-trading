/* Forexia — moteur de backtest.
 *
 * Hypothèses :
 *  - Les signaux sont calculés à la clôture d'une barre et exécutés à l'ouverture
 *    de la barre suivante (pas de biais d'anticipation).
 *  - Une seule position à la fois. Un signal d'entrée opposé ferme la position
 *    en cours et ouvre la position inverse.
 *  - Taille : notionnel = capital disponible × exposition % × levier.
 *  - Le stop-loss / take-profit est testé en intra-barre (plus haut / plus bas).
 *    Si les deux sont touchés dans la même barre, on retient le stop (prudent).
 *  - Clôture forcée (« margin call ») quand les fonds propres tombent sous
 *    `marginCloseOut` % de la marge utilisée (50 % comme la règle ESMA).
 *  - Spread payé à l'ouverture de chaque position. */
(function (root) {
  'use strict';
  const R = root.Forexia.rules;

  function pipSizeFor(pair) { return /JPY/.test(pair) ? 0.01 : 0.0001; }

  function compileStrategy(strategy, bars) {
    const ctx = R.makeContext(bars);
    const sig = {};
    for (const key of ['longEntry', 'longExit', 'shortEntry', 'shortExit']) {
      try { sig[key] = R.evaluateRule(strategy[key] || '', ctx); }
      catch (e) { e.message = labelOf(key) + ' : ' + e.message; throw e; }
    }
    return { signals: sig, ctx: ctx };
  }
  function labelOf(key) {
    return { longEntry: 'Entrée achat', longExit: 'Sortie achat', shortEntry: 'Entrée vente', shortExit: 'Sortie vente' }[key];
  }

  /**
   * @param bars      [{date, open, high, low, close}] triées par date
   * @param strategy  {longEntry, longExit, shortEntry, shortExit, stopLossPips, takeProfitPips}
   * @param settings  {capital, leverage, exposurePct, spreadPips, pair, startIndex, marginCloseOut}
   */
  function runBacktest(bars, strategy, settings) {
    const n = bars.length;
    const start = Math.max(1, settings.startIndex || 0);
    if (n - start < 2) throw new Error('Pas assez de données sur la période choisie.');
    const pip = settings.pipSize || pipSizeFor(settings.pair || '');
    const leverage = settings.leverage, exposure = (settings.exposurePct ?? 100) / 100;
    const closeOutRatio = (settings.marginCloseOut ?? 50) / 100;
    const spread = (settings.spreadPips || 0) * pip;
    const slDist = strategy.stopLossPips > 0 ? strategy.stopLossPips * pip : 0;
    const tpDist = strategy.takeProfitPips > 0 ? strategy.takeProfitPips * pip : 0;
    const { signals: S } = compileStrategy(strategy, bars);

    let cash = settings.capital;
    let pos = null; // {dir, entryPrice, entryIndex, notional, margin, cost, sl, tp}
    let pending = null; // {exit: bool, enter: 1|-1|0}
    const trades = [], equity = [], dates = [];
    let ruined = false;

    function pnlAt(price) { return pos.notional * pos.dir * (price / pos.entryPrice - 1); }

    function open(dir, i) {
      if (cash <= 0) return;
      const price = bars[i].open;
      const notional = cash * exposure * leverage;
      const cost = notional * (spread / price);
      pos = {
        dir: dir, entryPrice: price, entryIndex: i, notional: notional, margin: notional / leverage, cost: cost,
        sl: slDist ? price - dir * slDist : null, tp: tpDist ? price + dir * tpDist : null,
      };
      cash -= cost;
    }

    function close(i, price, reason) {
      const pnl = pnlAt(price);
      cash += pnl;
      const net = pnl - pos.cost;
      trades.push({
        dir: pos.dir, entryDate: bars[pos.entryIndex].date, exitDate: bars[i].date, entryIndex: pos.entryIndex,
        exitIndex: i, entryPrice: pos.entryPrice, exitPrice: price, notional: pos.notional,
        pips: (pos.dir * (price - pos.entryPrice)) / pip, pnl: net, cost: pos.cost,
        returnPct: (net / pos.margin) * 100 * exposure, reason: reason, bars: i - pos.entryIndex,
      });
      pos = null;
      if (cash <= 0) { cash = 0; ruined = true; }
      wd.check(i, cash, (amount) => { cash -= amount; });
    }

    // Prix auquel les fonds propres atteignent le seuil de clôture forcée.
    function liquidationPrice() {
      const equityAtEntry = cash + 0; // les frais sont déjà déduits de cash
      const target = closeOutRatio * pos.margin; // fonds propres minimum
      // cash + notional*dir*(p/entry - 1) = target
      return pos.entryPrice * (1 + (target - equityAtEntry) / (pos.notional * pos.dir));
    }

    const wd = makeWithdrawals(settings, bars);
    let barsInMarket = 0;
    for (let i = start; i < n; i++) {
      const bar = bars[i];
      // 1) ordres en attente à l'ouverture
      if (pending && !ruined) {
        if (pending.exit && pos) close(i, bar.open, 'Signal');
        if (pending.enter && !pos && !ruined) open(pending.enter, i);
        pending = null;
      }
      // 2) stops intra-barre
      if (pos) {
        barsInMarket++;
        const liq = liquidationPrice();
        const worst = pos.dir > 0 ? bar.low : bar.high;
        const best = pos.dir > 0 ? bar.high : bar.low;
        const hit = (level) => level !== null && (pos.dir > 0 ? worst <= level : worst >= level);
        const fill = (level) => (pos.dir > 0 ? Math.min(bar.open, level) : Math.max(bar.open, level));
        // le niveau défavorable le plus proche est touché en premier
        const slFirst = pos.sl !== null && (pos.dir > 0 ? pos.sl >= liq : pos.sl <= liq);
        if (slFirst && hit(pos.sl)) close(i, fill(pos.sl), 'Stop-loss');
        else if (hit(liq)) close(i, fill(liq), 'Margin call');
        else if (pos.sl !== null && hit(pos.sl)) close(i, fill(pos.sl), 'Stop-loss');
        else {
          // Objectifs favorables : take-profit et, en mode « retrait dès le seuil », le prix où le compte atteint le seuil.
          // Le plus proche du prix d'entrée est touché en premier.
          const wLevel = wd.immediate ? pos.entryPrice * (1 + (wd.target - cash) / (pos.notional * pos.dir)) : null;
          const reach = (lv) => lv !== null && Number.isFinite(lv) && (pos.dir > 0 ? best >= lv : best <= lv);
          const tpOk = reach(pos.tp), wOk = reach(wLevel);
          const nearer = (a, b) => (pos.dir > 0 ? a <= b : a >= b);
          const at = (lv) => (pos.dir > 0 ? Math.max(bar.open, lv) : Math.min(bar.open, lv));
          if (wOk && (!tpOk || nearer(wLevel, pos.tp))) close(i, at(wLevel), 'Retrait');
          else if (tpOk) close(i, at(pos.tp), 'Take-profit');
        }
      }
      // 3) fin de période : on solde la position
      if (i === n - 1) {
        if (pos) close(i, bar.close, 'Fin de période');
      } else if (!ruined) {
        // 4) signaux à la clôture -> exécution à l'ouverture suivante
        const le = S.longEntry[i], se = S.shortEntry[i];
        const wantLong = le && !se, wantShort = se && !le;
        if (pos) {
          const exit = pos.dir > 0 ? S.longExit[i] || wantShort : S.shortExit[i] || wantLong;
          if (exit) pending = { exit: true, enter: pos.dir > 0 ? (wantShort ? -1 : 0) : wantLong ? 1 : 0 };
        } else if (wantLong || wantShort) {
          pending = { exit: false, enter: wantLong ? 1 : -1 };
        }
      }
      equity.push(pos ? cash + pnlAt(bar.close) : cash);
      dates.push(bar.date);
      wd.mark();
    }

    return wd.finish({ trades: trades, equity: equity, dates: dates, startIndex: start, ruined: ruined }, barsInMarket);
  }

  /**
   * Retraits fictifs : quand le compte atteint capital × (1 + seuil %), une part du gain est retirée
   * (à la clôture d'un trade, sans position ouverte) et mise à l'abri ; le compte repart plus petit.
   * Les statistiques portent alors sur « compte + retraits ».
   */
  function makeWithdrawals(settings, bars) {
    const threshold = settings.withdrawPct > 0 ? settings.withdrawPct / 100 : 0;
    const share = Math.min(100, Math.max(1, settings.withdrawShare == null ? 100 : settings.withdrawShare)) / 100;
    const base = settings.capital;
    // « Dès le seuil » : la position est clôturée quand le compte atteint le seuil (sinon : au prochain trade clôturé).
    const immediate = !!threshold && settings.withdrawWhen === 'immediate';
    let total = 0;
    const list = [], wealth = [];
    return {
      immediate: immediate, target: base * (1 + threshold),
      check(i, account, take) {
        // tolérance d'arrondi : une position clôturée pile au seuil donne 101,9999999… pour 102
        if (!threshold || account < base * (1 + threshold) - 1e-7 * base) return;
        const amount = (account - base) * share;
        if (amount <= 0) return;
        take(amount);
        total += amount;
        list.push({ index: i, date: bars[i].date, amount: amount, accountAfter: account - amount, total: total });
      },
      mark() { wealth.push(NaN); }, // complété dans finish()
      finish(res, barsInMarket) {
        // compte + retraits cumulés, bougie par bougie
        let k = 0, cum = 0;
        for (let j = 0; j < res.equity.length; j++) {
          const barIndex = res.startIndex + j;
          while (k < list.length && list[k].index <= barIndex) cum = list[k++].total;
          wealth[j] = res.equity[j] + cum;
        }
        res.wealth = wealth;
        res.withdrawals = list;
        res.stats = computeStats(base, wealth, res.trades, bars, res.startIndex, barsInMarket);
        res.stats.finalAccount = res.equity[res.equity.length - 1];
        res.stats.totalWithdrawn = total;
        res.stats.withdrawals = list.length;
        return res;
      },
    };
  }

  function computeStats(capital, equity, trades, bars, start, barsInMarket) {
    const final = equity[equity.length - 1];
    let peak = capital, maxDD = 0, maxDDAmount = 0;
    for (const e of equity) {
      if (e > peak) peak = e;
      const dd = peak > 0 ? (peak - e) / peak : 0;
      if (dd > maxDD) { maxDD = dd; maxDDAmount = peak - e; }
    }
    const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl <= 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = -losses.reduce((s, t) => s + t.pnl, 0);
    // rendements journaliers -> Sharpe annualisé (252 jours ouvrés)
    const rets = [];
    let prev = capital;
    for (const e of equity) { if (prev > 0) rets.push(e / prev - 1); prev = e; }
    const mean = rets.reduce((s, r) => s + r, 0) / (rets.length || 1);
    const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) * (r - mean), 0) / (rets.length || 1));
    let streak = 0, maxLossStreak = 0;
    for (const t of trades) { streak = t.pnl <= 0 ? streak + 1 : 0; maxLossStreak = Math.max(maxLossStreak, streak); }
    const first = bars[start].open, last = bars[bars.length - 1].close;
    return {
      initialCapital: capital, finalEquity: final, netProfit: final - capital,
      returnPct: ((final - capital) / capital) * 100,
      trades: trades.length, wins: wins.length, losses: losses.length,
      winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
      grossProfit: grossProfit, grossLoss: grossLoss,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      avgWin: wins.length ? grossProfit / wins.length : 0,
      avgLoss: losses.length ? -grossLoss / losses.length : 0,
      expectancy: trades.length ? (grossProfit - grossLoss) / trades.length : 0,
      bestTrade: trades.length ? Math.max(...trades.map((t) => t.pnl)) : 0,
      worstTrade: trades.length ? Math.min(...trades.map((t) => t.pnl)) : 0,
      maxDrawdownPct: maxDD * 100, maxDrawdownAmount: maxDDAmount,
      sharpe: sd > 0 ? (mean / sd) * Math.sqrt(252) : 0,
      maxLossStreak: maxLossStreak,
      timeInMarketPct: (barsInMarket / (bars.length - start)) * 100,
      totalCosts: trades.reduce((s, t) => s + t.cost, 0),
      buyHoldPct: ((last - first) / first) * 100,
      longTrades: trades.filter((t) => t.dir > 0).length, shortTrades: trades.filter((t) => t.dir < 0).length,
    };
  }

  root.Forexia.backtest = { runBacktest, compileStrategy, pipSizeFor, computeStats, makeWithdrawals };
})(typeof window !== 'undefined' ? window : globalThis);
