/* Forexia — un plan d'investissement tel que le client le voit (page client et aperçu dans Forexia).
 * plan : objet produit par F.fxcore.fxPublic (montants en % du capital investi) ; amount : capital choisi par le client.
 *  - summaryHtml : carte compacte de la liste des plans ;
 *  - detailHtml  : le détail (simulation sur le montant choisi, scénarios, fin de période, risque, conditions). */
(function (root) {
  'use strict';
  const F = (root.Forexia = root.Forexia || {});
  const money = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const num1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = (amount, pct) => money.format((amount * pct) / 100);
  const gainPct = (pct) => (pct >= 100 ? '+' : '−') + num1.format(Math.abs(pct - 100)) + ' %';
  const gainEur = (amount, pct) => (pct >= 100 ? '+' : '−') + money.format(Math.abs((amount * (pct - 100)) / 100));
  const tone = (pct) => (pct >= 100 ? 'up' : 'down');
  const months = (m) => (m % 12 === 0 && m >= 24 ? m / 12 + ' ans' : m + ' mois');
  const riskTone = (n) => (n <= 2 ? 'low' : n <= 4 ? 'mid' : 'high');

  function riskDots(n) {
    let h = '<span class="pv-dots" aria-hidden="true">';
    for (let i = 1; i <= 7; i++) h += '<i class="' + (i <= n ? riskTone(n) : '') + '"></i>';
    return h + '</span>';
  }

  /** Carte compacte : l'essentiel pour comparer les plans entre eux. */
  function summaryHtml(p, opts) {
    opts = opts || {};
    const y = p.oneYear;
    return '<article class="pv-sum" data-plan="' + esc(p.fxId) + '">' +
      '<div class="pv-sum-top"><h3>' + esc(p.title) + '</h3>' + (opts.chosen ? '<span class="pv-tag">✓ Dans votre portefeuille</span>' : '') + '</div>' +
      (p.pitch ? '<p class="pv-pitch">' + esc(p.pitch) + '</p>' : '') +
      '<div class="pv-sum-main"><span class="pv-big ' + tone(y.usual) + '">' + gainPct(y.usual) + '</span><span class="pv-big-l">en un an, le plus souvent</span></div>' +
      '<ul class="pv-facts">' +
      '<li><span>Dès</span><b>' + money.format(p.minCapital) + '</b></li>' +
      '<li><span>Durée</span><b>' + months(p.recoMonths) + '</b></li>' +
      '<li><span>Risque</span><b>' + riskDots(p.risk.note) + p.risk.note + '/7</b></li>' +
      '<li><span>Confiance</span><b>' + p.confidence.score + ' %</b></li></ul>' +
      '<div class="pv-sum-acts"><button type="button" class="pv-btn ghost" data-pv-open="' + esc(p.fxId) + '">Voir le détail</button>' +
      '<button type="button" class="pv-btn" data-pv-choose="' + esc(p.fxId) + '">Choisir ce plan</button></div></article>';
  }

  /** Le détail du plan pour un montant. opts = {preview, chosen} */
  function detailHtml(p, amount, opts) {
    opts = opts || {};
    const A = Math.max(p.minCapital, Number(amount) || p.minCapital), y = p.oneYear, R = p.recoMonths, ww = p.withWithdrawal, nw = p.withoutWithdrawal, c = p.confidence, r = p.risk;
    const scen = (cls, label, sub, pct) => '<div class="pv-scen ' + cls + '"><span class="pv-scen-l">' + label + '</span><b>' + eur(A, pct) + '</b><span class="pv-scen-g ' + tone(pct) + '">' + gainPct(pct) + '</span><small>' + sub + '</small></div>';
    let h = '<div class="pv-det" data-plan="' + esc(p.fxId) + '">';
    h += '<header class="pv-det-head"><h2>' + esc(p.title) + '</h2>' + (p.pitch ? '<p class="pv-pitch">' + esc(p.pitch) + '</p>' : '') + '</header>';
    // montant
    h += '<section class="pv-block pv-amount"><label for="pvAmt-' + esc(p.fxId) + '">Je souhaite investir</label><div class="pv-amount-row"><span class="pv-input"><input id="pvAmt-' + esc(p.fxId) + '" type="number" inputmode="numeric" min="' + p.minCapital + '" step="' + (p.minCapital >= 1000 ? 100 : 10) + '" value="' + Math.round(A) + '" data-pv-amount="' + esc(p.fxId) + '"><b>€</b></span>' +
      '<small>minimum ' + money.format(p.minCapital) + '</small></div></section>';
    // au bout d'un an : trois scénarios
    h += '<section class="pv-block"><h4>Au bout d\'un an</h4><p class="pv-hint">Valeur de votre placement, retraits déjà perçus compris.</p><div class="pv-scens">' +
      scen('bad', 'Année difficile', '1 fois sur 10, moins que ça', y.bad) +
      scen('usual', 'Le plus souvent', 'résultat le plus fréquent', y.usual) +
      scen('good', 'Bonne année', '1 fois sur 10, plus que ça', y.good) + '</div>' +
      '<p class="pv-hint">Pire cas observé sur les tests : <b class="' + tone(y.worst) + '">' + eur(A, y.worst) + ' (' + gainPct(y.worst) + ')</b>.</p></section>';
    // fin de la période
    h += '<section class="pv-block"><h4>Après ' + months(R) + ' (durée conseillée)</h4><p class="pv-hint">Le plus souvent, selon que vous retirez ou non vos gains en cours de route.</p><div class="pv-ends">';
    if (ww) {
      h += '<div class="pv-end"><span class="pv-end-l">Avec retrait régulier</span><b>' + eur(A, ww.total) + '</b><span class="pv-end-g ' + tone(ww.total) + '">' + gainPct(ww.total) + '</span>' +
        '<ul><li><span>Sur le compte</span><b>' + eur(A, ww.kept) + '</b></li><li><span>Déjà retiré</span><b>' + (ww.withdrawn >= 0.5 ? eur(A, ww.withdrawn) : '—') + '</b></li></ul>' +
        (ww.withdrawn < 0.5 ? '<small>Le plus souvent, les gains restent sous le seuil de retrait.</small>' : '') + '</div>';
    }
    if (nw) {
      h += '<div class="pv-end"><span class="pv-end-l">Sans retrait</span><b>' + eur(A, nw.usual) + '</b><span class="pv-end-g ' + tone(nw.usual) + '">' + gainPct(nw.usual) + '</span>' +
        '<ul><li><span>Capital investi</span><b>' + money.format(A) + '</b></li><li><span>Bénéfice</span><b class="' + tone(nw.usual) + '">' + gainEur(A, nw.usual) + '</b></li></ul>' + (nw.estimated ? '<small>Estimation.</small>' : '') + '</div>';
    }
    h += '</div></section>';
    // risque et confiance
    h += '<section class="pv-block pv-two"><div class="pv-meter"><h4>Risque</h4><div class="pv-meter-v">' + riskDots(r.note) + '<b>' + r.note + '/7</b><span>' + esc(r.text) + '</span></div>' +
      '<ul class="pv-list"><li><span>Pire capital à la fin</span><b class="' + tone(r.worstEnd) + '">' + eur(A, r.worstEnd) + '</b></li>' +
      (r.usualDip != null ? '<li><span>Baisse habituelle en cours de route</span><b>−' + num1.format(r.usualDip) + ' %</b></li><li><span>Plus forte baisse en cours de route</span><b>−' + num1.format(r.worstDip) + ' %</b></li>' : '') +
      '</ul><small>Note calculée sur les pires périodes testées.</small></div>' +
      '<div class="pv-meter"><h4>Confiance</h4><div class="pv-meter-v"><span class="pv-ring" style="--v:' + c.score + '"><b>' + c.score + ' %</b></span></div>' +
      '<ul class="pv-list"><li><span>Périodes testées</span><b>' + c.periods + '</b></li>' + (c.of ? '<li><span>' + (c.unit === 'année' ? 'Années' : 'Époques') + ' gagnantes</span><b>' + c.won + ' sur ' + c.of + '</b></li>' : '') +
      (c.years ? '<li><span>Historique</span><b>' + c.years[0] + '–' + c.years[1] + '</b></li>' : '') + '</ul>' + (c.synthetic ? '<small>Tests sur données simulées.</small>' : '') + '</div></section>';
    // conditions
    h += '<section class="pv-block"><h4>Conditions</h4><dl class="pv-conds">' +
      '<div><dt>Retrait possible</dt><dd>' + esc(p.withdrawal.text) + '</dd></div>' +
      '<div><dt>Arrêt du robot</dt><dd>À tout moment' + (p.stop.aboveMedian ? '. Conseillé dès que votre capital dépasse <b>' + eur(A, p.stop.aboveMedian) + '</b>, le résultat le plus courant en fin de période.' : '.') + '</dd></div>' +
      '<div><dt>Réinvestir dans ce plan</dt><dd>Possible tous les <b>' + p.reinvestMonths + ' mois</b>, conseillé si le couvreur l\'indique.</dd></div></dl></section>';
    h += '<div class="pv-det-acts">' + (opts.chosen ? '<span class="pv-tag">✓ Déjà dans votre portefeuille</span>' : '') +
      '<button type="button" class="pv-btn big" data-pv-choose="' + esc(p.fxId) + '">' + (opts.chosen ? 'Ajouter encore' : 'Choisir ce plan') + ' · ' + money.format(A) + '</button></div>';
    h += '<p class="pv-legal">Résultats de simulations sur des périodes passées, sans garantie pour l\'avenir. Vous pouvez perdre tout ou partie du capital investi.</p></div>';
    return h;
  }

  F.planview = { summaryHtml, detailHtml, money, num1, esc, eur, gainPct, months, riskDots };
})(typeof window !== 'undefined' ? window : globalThis);
