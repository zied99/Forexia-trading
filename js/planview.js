/* Forexia — carte d'un plan d'investissement, telle que le client la voit (page client et aperçu dans Forexia).
 * plan : objet produit par F.fxcore.fxPublic (montants en % du capital investi) ; amount : capital choisi par le client. */
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

  /** Fourchette « 1 fois sur 10 / le plus souvent / 1 fois sur 10 » sur une barre, avec la ligne du capital de départ. */
  function rangeBar(lo, mid, hi) {
    const a = Math.min(lo, 100) - 5, b = Math.max(hi, 100) + 5, x = (v) => ((v - a) / (b - a)) * 100;
    return '<div class="pv-range" aria-hidden="true"><span class="pv-range-band" style="left:' + x(lo) + '%;width:' + (x(hi) - x(lo)) + '%"></span>' +
      '<span class="pv-range-cap" style="left:' + x(100) + '%" title="capital investi"></span><span class="pv-range-mid" style="left:' + x(mid) + '%"></span></div>';
  }
  function riskScale(n) {
    let h = '<span class="pv-risk" aria-label="Risque ' + n + ' sur 7">';
    for (let i = 1; i <= 7; i++) h += '<i class="' + (i <= n ? 'on r' + n : '') + '">' + i + '</i>';
    return h + '</span>';
  }
  function row(label, value, more) {
    return '<div class="pv-row"><dt>' + label + '</dt><dd>' + value + (more ? '<details class="pv-more"><summary>Voir plus</summary>' + more + '</details>' : '') + '</dd></div>';
  }

  /** opts = {chosen: bool, preview: bool, actions: bool} */
  function cardHtml(p, amount, opts) {
    opts = opts || {};
    const A = Math.max(p.minCapital, Number(amount) || p.minCapital), y = p.oneYear, R = p.recoMonths, ww = p.withWithdrawal, nw = p.withoutWithdrawal, c = p.confidence;
    let h = '<article class="pv-card" data-plan="' + esc(p.fxId) + '">' +
      '<header class="pv-head"><div><h3>' + esc(p.title) + '</h3>' + (p.pitch ? '<p>' + esc(p.pitch) + '</p>' : '') + '</div>' +
      '<div class="pv-badges"><span class="pv-badge r' + p.risk.note + '">Risque ' + p.risk.note + '/7</span><span class="pv-badge conf">Confiance ' + c.score + ' %</span></div></header>';
    h += '<div class="pv-amount"><label>Montant investi<span class="pv-input"><input type="number" inputmode="numeric" min="' + p.minCapital + '" step="' + (p.minCapital >= 1000 ? 100 : 10) + '" value="' + Math.round(A) + '" data-pv-amount="' + esc(p.fxId) + '"><b>€</b></span></label><small>Capital minimum : <b>' + money.format(p.minCapital) + '</b></small></div>';
    // l'essentiel : au bout d'un an
    h += '<div class="pv-hero"><span class="pv-hero-k">Au bout d\'un an</span><span class="pv-hero-v"><b>' + eur(A, y.usual) + '</b> <em class="' + tone(y.usual) + '">' + gainPct(y.usual) + '</em></span>' +
      '<span class="pv-hero-s">le plus souvent, retraits compris</span>' + rangeBar(y.bad, y.usual, y.good) +
      '<details class="pv-more"><summary>Voir les niveaux</summary><ul class="pv-levels">' +
      '<li><span>Si ça se passe bien (1 fois sur 10 au moins)</span><b class="' + tone(y.good) + '">' + eur(A, y.good) + ' · ' + gainPct(y.good) + '</b></li>' +
      '<li><span>Le plus souvent</span><b class="' + tone(y.usual) + '">' + eur(A, y.usual) + ' · ' + gainPct(y.usual) + '</b></li>' +
      '<li><span>Si ça se passe mal (1 fois sur 10)</span><b class="' + tone(y.bad) + '">' + eur(A, y.bad) + ' · ' + gainPct(y.bad) + '</b></li>' +
      '<li><span>Pire cas observé</span><b class="' + tone(y.worst) + '">' + eur(A, y.worst) + ' · ' + gainPct(y.worst) + '</b></li></ul></details></div>';
    h += '<dl class="pv-rows">';
    h += row('Période d\'investissement recommandée', '<b>' + months(R) + '</b>');
    // estimation à la fin de la période
    let est = '<div class="pv-est">';
    if (ww) est += '<div class="pv-est-box"><span>Avec retrait régulier</span><b>' + eur(A, ww.kept) + '</b><small>sur le compte</small>' + (ww.withdrawn >= 0.5 ? '<b class="up">+ ' + eur(A, ww.withdrawn) + '</b><small>retirés pendant la période</small>' : '<small>le plus souvent, pas de retrait (gains sous le seuil)</small>') + '<span class="pv-est-tot">Total ' + eur(A, ww.total) + ' · <em class="' + tone(ww.total) + '">' + gainPct(ww.total) + '</em></span></div>';
    if (nw) est += '<div class="pv-est-box"><span>Sans retrait régulier</span><b class="' + tone(nw.usual) + '">' + gainEur(A, nw.usual) + '</b><small>capital et bénéfice : ' + eur(A, nw.usual) + ' au total</small><span class="pv-est-tot">soit <em class="' + tone(nw.usual) + '">' + gainPct(nw.usual) + '</em> du capital investi' + (nw.estimated ? ' (estimation)' : '') + '</span></div>';
    est += '</div>';
    h += row('Estimation après ' + months(R) + ' (le plus souvent)', est);
    h += row('Type de retrait possible', esc(p.withdrawal.text));
    h += row('Arrêt du robot trader', '<b>À tout moment</b>' + (p.stop.aboveMedian ? '<small class="pv-note">Recommandé si votre capital dépasse ' + eur(A, p.stop.aboveMedian) + ' (résultat le plus courant à la fin de la période).</small>' : ''));
    h += row('Risque', riskScale(p.risk.note) + ' <b>' + p.risk.note + '/7</b> · ' + esc(p.risk.text) + '<small class="pv-note">Score basé sur les pires périodes testées.</small>',
      '<ul class="pv-levels"><li><span>Pire capital après la période</span><b class="' + tone(p.risk.worstEnd) + '">' + eur(A, p.risk.worstEnd) + ' · ' + gainPct(p.risk.worstEnd) + '</b></li>' +
      '<li><span>1 fois sur 10, à la fin, moins de</span><b class="' + tone(p.risk.badEnd) + '">' + eur(A, p.risk.badEnd) + '</b></li>' +
      (p.risk.usualDip != null ? '<li><span>Baisse habituelle en cours de route</span><b class="down">−' + num1.format(p.risk.usualDip) + ' %</b></li><li><span>Plus forte baisse en cours de route</span><b class="down">−' + num1.format(p.risk.worstDip) + ' %</b></li>' : '') + '</ul>');
    h += row('Confiance', '<b>' + c.score + ' %</b> <small class="pv-note">Testé sur ' + c.periods + ' périodes' + (c.of ? ', ' + c.won + ' ' + (c.unit === 'année' ? 'année' : 'époque') + (c.won > 1 ? 's' : '') + ' gagnante' + (c.won > 1 ? 's' : '') + ' sur ' + c.of : '') + (c.years ? ' (' + c.years[0] + '–' + c.years[1] + ')' : '') + (c.synthetic ? ' · données simulées' : '') + '.</small>');
    h += row('Réinvestissement sur le même plan', 'Accessible tous les <b>' + p.reinvestMonths + ' mois</b><small class="pv-note">Recommandé si le couvreur l\'indique.</small>');
    h += '</dl>';
    if (opts.actions !== false) h += '<footer class="pv-foot">' + (opts.chosen ? '<span class="pv-chosen">✓ Dans votre portefeuille</span>' : '') +
      '<button type="button" class="pv-choose" data-pv-choose="' + esc(p.fxId) + '"' + (opts.preview ? ' title="Aperçu : le choix n\'est pas enregistré"' : '') + '>' + (opts.chosen ? 'Ajouter encore' : 'Choisir ce plan') + '</button></footer>';
    h += '<p class="pv-legal">Résultats de simulations sur des périodes passées, sans garantie pour l\'avenir. Vous pouvez perdre tout ou partie du capital investi.</p></article>';
    return h;
  }

  F.planview = { cardHtml, money, num1, esc, eur, gainPct, months };
})(typeof window !== 'undefined' ? window : globalThis);
