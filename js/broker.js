/* Forexia — backtest « courtier » : reproduit l'Expert Advisor dans le testeur de MetaTrader 5.
 *
 * Données : bougies du courtier (prix bid + spread en points), bougies plus fines pour le
 * déroulé intra-bougie (comme le mode « 1 minute OHLC » de MT5), caractéristiques du
 * symbole (contrat, lots, swap) et du compte (devise), taux de conversion vers la devise du compte.
 *
 * Règles (identiques à l'EA généré par js/mql5.js) :
 *  - signaux calculés à la clôture d'une bougie, ordre exécuté à l'ouverture de la suivante ;
 *  - achat au prix ask (bid + spread), vente au prix bid ; un achat se clôture au bid, une vente à l'ask ;
 *  - taille : comme le backtest (capital × exposition × levier), lots fixes ou % de risque,
 *    plafonnée, limitée à 90 % de la marge libre, arrondie au pas de lot du courtier ;
 *  - ordre annulé si le spread dépasse le maximum ; stop-loss / take-profit testés bougie fine
 *    par bougie fine (le stop d'abord si les deux sont touchés dans la même) ;
 *  - swap à chaque passage de minuit (jour de semaine), triplé le jour indiqué par le courtier ;
 *  - clôture forcée si les fonds propres tombent sous le niveau de stop-out du courtier. */
(function (root) {
  'use strict';
  const F = root.Forexia;

  function pipOf(spec) { return spec.digits === 3 || spec.digits === 5 ? 10 * spec.point : spec.point; }
  function roundTo(v, digits) { const m = Math.pow(10, digits); return Math.round(v * m) / m; }

  /** Facteur devise de cotation -> devise du compte à l'instant t (conv : {rates: [[t, close]], divide}). */
  function convFactor(conv, t) {
    if (!conv || !conv.rates || !conv.rates.length) return 1;
    const r = conv.rates;
    let lo = 0, hi = r.length - 1;
    if (t <= r[0][0]) lo = 0;
    else {
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (r[mid][0] <= t) lo = mid; else hi = mid - 1; }
    }
    const rate = r[lo][1];
    return conv.divide ? 1 / rate : rate;
  }

  // Nombre de swaps entre deux instants (secondes, heure du serveur) : un par minuit franchi
  // après un jour de semaine, triple pour le jour indiqué par le courtier (mercredi en général).
  function swapNights(t0, t1, triple) {
    let n = 0;
    for (let d = Math.floor(t0 / 86400); d < Math.floor(t1 / 86400); d++) {
      const wd = new Date(d * 86400000).getUTCDay();
      if (wd >= 1 && wd <= 5) n += wd === triple ? 3 : 1;
    }
    return n;
  }

  /**
   * @param bars     [{date, t, open, high, low, close, spread}] bougies du courtier (bid)
   * @param strategy règles + stopLossPips / takeProfitPips
   * @param s        {capital, leverage, exposurePct, sizing, fixedLots, riskPct, maxLots, maxSpreadPips, startIndex}
   * @param broker   {spec, account, conv, sub}
   */
  function runBrokerBacktest(bars, strategy, s, broker) {
    const n = bars.length, start = Math.max(1, s.startIndex || 0);
    if (n - start < 2) throw new Error('Pas assez de données sur la période choisie.');
    const spec = broker.spec, point = spec.point, pip = pipOf(spec), C = spec.contract;
    const step = spec.volumeStep || 0.01, vmin = spec.volumeMin || 0.01, vmax = spec.volumeMax || 100;
    const volDigits = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
    const soLevel = (broker.account && broker.account.marginSoSo ? broker.account.marginSoSo : 50) / 100;
    const slPips = strategy.stopLossPips > 0 ? strategy.stopLossPips : 0;
    const tpPips = strategy.takeProfitPips > 0 ? strategy.takeProfitPips : 0;
    const { signals: S } = F.backtest.compileStrategy(strategy, bars);
    const sub = broker.sub && broker.sub.length ? broker.sub : null;
    const notes = new Set();
    const diag = { signals: 0, spreadDelayed: 0, spreadMissed: 0, lotsTooSmall: 0, orderFailed: 0 };

    let balance = s.capital, pos = null, pending = null, ruined = false, barsInMarket = 0, subIdx = 0;
    const trades = [], equity = [], dates = [];
    const wd = F.backtest.makeWithdrawals(s, bars);

    const sp = (b) => (b.spread || 0) * point;
    const conv = (t) => convFactor(broker.conv, t);

    function lotsFor(entry, t, eq) {
      const k = conv(t);
      const perLot = entry * C * k; // valeur d'un lot dans la devise du compte
      let lots = s.fixedLots || 0.01;
      if (s.sizing === 'backtest') lots = (eq * (s.exposurePct || 100) / 100 * s.leverage) / perLot;
      else if (s.sizing === 'risk') {
        if (slPips > 0) lots = (eq * (s.riskPct || 1) / 100) / (slPips * pip * C * k);
        else notes.add('Mode risque sans stop-loss : lots fixes utilisés.');
      }
      lots = Math.min(lots, s.maxLots || 1);
      const margin1 = perLot / s.leverage;
      lots = Math.min(lots, (eq * 0.9) / margin1);
      lots = Math.floor(lots / step + 1e-9) * step;
      if (lots < vmin) return 0;
      return roundTo(Math.min(lots, vmax), volDigits);
    }
    function pnlAt(price, t) { return (price - pos.entry) * pos.dir * C * pos.lots * conv(t) + pos.swap; }

    function open(dir, i, bid, spread, t) {
      const entry = roundTo(dir > 0 ? bid + spread : bid, spec.digits);
      const lots = lotsFor(entry, t, balance);
      if (lots <= 0) { diag.lotsTooSmall++; notes.add('Ordres annulés : taille inférieure au minimum du courtier (' + vmin + ' lot).'); return; }
      pos = {
        dir: dir, entry: entry, lots: lots, entryIndex: i, entryT: t, swap: 0, lastT: t,
        sl: slPips ? roundTo(entry - dir * slPips * pip, spec.digits) : null,
        tp: tpPips ? roundTo(entry + dir * tpPips * pip, spec.digits) : null,
        spreadCost: spread * C * lots * conv(t), margin: (entry * C * conv(t) / s.leverage) * lots,
      };
    }
    function close(i, price, reason, t) {
      const gross = (price - pos.entry) * pos.dir * C * pos.lots * conv(t);
      const pnl = gross + pos.swap;
      balance += pnl;
      trades.push({
        dir: pos.dir, entryDate: bars[pos.entryIndex].date, exitDate: bars[i].date, entryIndex: pos.entryIndex, exitIndex: i,
        entryPrice: pos.entry, exitPrice: price, lots: pos.lots, pips: (price - pos.entry) * pos.dir / pip,
        pnl: pnl, swap: pos.swap, cost: pos.spreadCost, reason: reason, bars: i - pos.entryIndex, notional: pos.lots * C,
      });
      pos = null;
      if (balance <= 0) { balance = 0; ruined = true; }
      wd.check(i, balance, (amount) => { balance -= amount; });
    }
    function chargeSwap(t) {
      if (!pos || t <= pos.lastT) return;
      const nights = swapNights(pos.lastT, t, spec.swapRollover3days == null ? 3 : spec.swapRollover3days);
      pos.lastT = t;
      if (!nights) return;
      const rate = pos.dir > 0 ? spec.swapLong || 0 : spec.swapShort || 0;
      const mode = spec.swapMode, k = conv(t);
      let perLot = 0;
      if (mode === 1) perLot = rate * point * C * k; // en points
      else if (mode === 2 || mode === 3) perLot = rate * pos.entry * k; // devise de base / de marge
      else if (mode === 4) perLot = rate; // devise du compte
      else if (mode) notes.add('Mode de swap du courtier non pris en charge : swaps ignorés.');
      pos.swap += perLot * pos.lots * nights;
    }

    // Déroulé intra-bougie : stops testés sur chaque bougie fine.
    function checkStops(i, b, first) {
      const spr = sp(b);
      if (pos.dir > 0) {
        if (pos.sl !== null && b.low <= pos.sl) { close(i, first && b.open <= pos.sl ? b.open : pos.sl, 'Stop-loss', b.t); return; }
        if (pos.tp !== null && b.high >= pos.tp) { close(i, first && b.open >= pos.tp ? b.open : pos.tp, 'Take-profit', b.t); return; }
      } else {
        const aH = b.high + spr, aL = b.low + spr, aO = b.open + spr;
        if (pos.sl !== null && aH >= pos.sl) { close(i, first && aO >= pos.sl ? aO : pos.sl, 'Stop-loss', b.t); return; }
        if (pos.tp !== null && aL <= pos.tp) { close(i, first && aO <= pos.tp ? aO : pos.tp, 'Take-profit', b.t); return; }
      }
      // stop-out : fonds propres au pire prix de la bougie fine
      const worst = pos.dir > 0 ? b.low : b.high + spr;
      if (balance + pnlAt(worst, b.t) < soLevel * pos.margin) close(i, worst, 'Margin call', b.t);
    }

    for (let i = start; i < n; i++) {
      const bar = bars[i], tNext = i + 1 < n ? bars[i + 1].t : Infinity;
      const subs = [];
      if (sub) {
        while (subIdx < sub.length && sub[subIdx].t < bar.t) subIdx++;
        let j = subIdx;
        while (j < sub.length && sub[j].t < tNext) subs.push(sub[j++]);
      }
      if (!subs.length) subs.push(bar);
      chargeSwap(bar.t);
      const first = subs[0], spread0 = sp(first);
      let fromK = 0;
      if (pending && !ruined) {
        if (pending.exit && pos) close(i, pos.dir > 0 ? first.open : roundTo(first.open + spread0, spec.digits), 'Signal', bar.t);
        if (pending.enter && !pos && !ruined) {
          // Comme l'EA : si le spread est trop large, nouvel essai à la bougie fine suivante, jusqu'à la fin de la bougie.
          diag.signals++;
          let k = 0;
          while (k < subs.length && s.maxSpreadPips > 0 && sp(subs[k]) / pip > s.maxSpreadPips) k++;
          if (k > 0) diag.spreadDelayed++;
          if (k < subs.length) { open(pending.enter, i, subs[k].open, sp(subs[k]), subs[k].t); fromK = k; }
          else { diag.spreadMissed++; notes.add('Ordres non exécutés : spread supérieur à ' + s.maxSpreadPips + ' pips pendant toute la bougie.'); }
        }
        pending = null;
      }
      if (pos) {
        barsInMarket++;
        for (let k = fromK; k < subs.length && pos; k++) {
          if (k > fromK) chargeSwap(subs[k].t);
          checkStops(i, subs[k], k === fromK);
        }
      }
      const last = subs[subs.length - 1];
      if (i === n - 1) {
        if (pos) close(i, pos.dir > 0 ? bar.close : roundTo(bar.close + sp(last), spec.digits), 'Fin de période', bar.t);
      } else if (!ruined) {
        const le = S.longEntry[i], se = S.shortEntry[i];
        const wantLong = le && !se, wantShort = se && !le;
        if (pos) {
          const exit = pos.dir > 0 ? S.longExit[i] || wantShort : S.shortExit[i] || wantLong;
          if (exit) pending = { exit: true, enter: pos.dir > 0 ? (wantShort ? -1 : 0) : wantLong ? 1 : 0 };
        } else if (wantLong || wantShort) {
          pending = { exit: false, enter: wantLong ? 1 : -1 };
        }
      }
      equity.push(pos ? balance + pnlAt(pos.dir > 0 ? bar.close : bar.close + sp(last), bar.t) : balance);
      dates.push(bar.date);
      wd.mark();
    }
    const res = wd.finish({ trades: trades, equity: equity, dates: dates, startIndex: start, ruined: ruined, notes: [...notes], diag: diag }, barsInMarket);
    res.stats.totalSwap = trades.reduce((a, t) => a + t.swap, 0);
    return res;
  }

  F.broker = { runBrokerBacktest, convFactor, swapNights, pipOf };
})(typeof window !== 'undefined' ? window : globalThis);
