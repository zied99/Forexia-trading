/* Forexia — événements de marché.
 *
 * 1) Une base d'événements historiques qui ont marqué le marché des changes (banques centrales, crises,
 *    élections, décisions monétaires…), avec les devises concernées et leur effet.
 * 2) La détection automatique des mouvements exceptionnels dans les cours chargés : chaque nouveau choc détecté
 *    est ajouté aux événements (« détecté »), rapproché d'un événement connu proche s'il y en a un, et peut être
 *    nommé et expliqué par l'utilisateur. Ainsi la base s'enrichit au fil des simulations.
 * Calcul local, pas de service externe. */
(function (root) {
  'use strict';
  const F = root.Forexia = root.Forexia || {};

  // imp : 3 = majeur, 2 = important. cut : utilisé comme coupure d'époque par défaut.
  // cur : devises concernées ('*' = toutes).
  const BUILTIN = [
    { date: '1971-08-15', imp: 3, cur: ['*'], kind: 'Système monétaire', title: 'Fin de Bretton Woods', text: 'Les États-Unis suspendent la convertibilité du dollar en or : fin des parités fixes, début du marché des changes moderne.' },
    { date: '1973-03-01', imp: 2, cur: ['*'], kind: 'Système monétaire', title: 'Changes flottants généralisés', text: 'Les grandes devises flottent librement les unes contre les autres.' },
    { date: '1979-10-06', imp: 3, cur: ['USD'], kind: 'Banque centrale', title: 'Choc Volcker', text: 'La Fed relève fortement ses taux pour casser l\'inflation : le dollar s\'envole au début des années 1980.' },
    { date: '1985-09-22', imp: 3, cur: ['USD', 'JPY', 'DEM', 'EUR', 'GBP', 'CHF'], kind: 'Accord international', title: 'Accords du Plaza', text: 'Le G5 organise la baisse du dollar, devenu trop fort : le dollar baisse fortement pendant deux ans, le yen et le mark montent.' },
    { date: '1987-02-22', imp: 2, cur: ['USD', 'JPY', 'DEM', 'EUR'], kind: 'Accord international', title: 'Accords du Louvre', text: 'Le G6 cherche à stabiliser le dollar après sa chute.' },
    { date: '1987-10-19', imp: 2, cur: ['*'], kind: 'Crise', title: 'Krach du « lundi noir »', text: 'Chute brutale des bourses mondiales ; fuite vers les valeurs refuges.' },
    { date: '1992-09-16', imp: 3, cur: ['GBP', 'EUR', 'DEM'], kind: 'Crise de change', title: 'Mercredi noir', text: 'La livre sterling est éjectée du Système monétaire européen après des attaques spéculatives : forte dévaluation de la livre.' },
    { date: '1993-08-02', imp: 2, cur: ['EUR', 'DEM', 'FRF'], kind: 'Système monétaire', title: 'Élargissement des marges du SME', text: 'Les marges de fluctuation du SME passent à ±15 % après une nouvelle crise (franc).' },
    { date: '1994-02-04', imp: 2, cur: ['USD'], kind: 'Banque centrale', title: 'Hausse surprise des taux de la Fed', text: 'Début d\'un cycle de hausses rapides : krach obligataire de 1994.' },
    { date: '1997-07-02', imp: 3, cur: ['JPY', 'AUD', 'NZD', 'USD'], kind: 'Crise', title: 'Crise financière asiatique', text: 'Dévaluation du baht thaïlandais, contagion aux devises asiatiques : fuite des capitaux des pays émergents.' },
    { date: '1998-08-17', imp: 2, cur: ['*'], kind: 'Crise', title: 'Crise russe et LTCM', text: 'Défaut de la Russie puis quasi-faillite du fonds LTCM : forte volatilité, débouclage du carry trade en yen (octobre 1998).' },
    { date: '1999-01-01', imp: 3, cur: ['EUR'], kind: 'Système monétaire', title: 'Lancement de l\'euro', cut: true, text: 'L\'euro remplace les monnaies nationales sur les marchés (vers 1,17 dollar) ; il baisse ensuite pendant près de deux ans.' },
    { date: '2000-03-10', imp: 2, cur: ['USD', '*'], kind: 'Crise', title: 'Éclatement de la bulle internet', text: 'Le Nasdaq atteint son sommet puis s\'effondre : récession américaine de 2001.' },
    { date: '2000-09-22', imp: 3, cur: ['EUR', 'USD', 'JPY'], kind: 'Intervention', title: 'Intervention pour soutenir l\'euro', text: 'BCE, Fed et banque du Japon achètent des euros ; l\'euro touche son plus bas historique (vers 0,82 dollar) en octobre 2000.' },
    { date: '2001-01-03', imp: 2, cur: ['USD'], kind: 'Banque centrale', title: 'La Fed commence à baisser ses taux', text: 'Baisses rapides jusqu\'à 1 % en 2003 : le dollar entre dans une longue phase de baisse (2002–2008).' },
    { date: '2001-09-11', imp: 3, cur: ['*'], kind: 'Géopolitique', title: 'Attentats du 11 septembre', text: 'Fermeture des marchés américains, baisse des taux, fuite vers les valeurs refuges (franc suisse, or).' },
    { date: '2002-01-01', imp: 2, cur: ['EUR'], kind: 'Système monétaire', title: 'Pièces et billets en euros', text: 'L\'euro devient la monnaie de tous les jours ; il commence une longue hausse contre le dollar.' },
    { date: '2003-03-20', imp: 2, cur: ['USD', '*'], kind: 'Géopolitique', title: 'Guerre en Irak', text: 'Hausse du pétrole, dollar faible.' },
    { date: '2004-06-30', imp: 2, cur: ['USD'], kind: 'Banque centrale', title: 'La Fed reprend la hausse des taux', text: '17 hausses d\'un quart de point jusqu\'en 2006.' },
    { date: '2007-08-09', imp: 3, cur: ['*'], kind: 'Crise', title: 'Début de la crise des subprimes', text: 'BNP Paribas gèle des fonds exposés aux crédits immobiliers américains : crise de liquidité, débouclage du carry trade.' },
    { date: '2008-07-15', imp: 2, cur: ['EUR', 'USD'], kind: 'Marché', title: 'Euro au plus haut historique', text: 'L\'euro dépasse 1,60 dollar puis chute de plus de 20 % en quelques mois avec la crise.' },
    { date: '2008-09-15', imp: 3, cur: ['*'], kind: 'Crise', title: 'Faillite de Lehman Brothers', cut: true, text: 'Panique financière mondiale : le dollar et le yen montent (valeurs refuges), les devises à haut rendement (AUD, NZD) s\'effondrent. Volatilité record.' },
    { date: '2008-12-16', imp: 3, cur: ['USD'], kind: 'Banque centrale', title: 'Fed à taux zéro et rachats d\'actifs (QE1)', text: 'Taux directeur entre 0 et 0,25 % ; la Fed achète massivement des titres.' },
    { date: '2010-05-02', imp: 3, cur: ['EUR'], kind: 'Crise', title: 'Crise de la dette de la zone euro', text: 'Premier plan d\'aide à la Grèce ; l\'euro baisse fortement, la crise dure jusqu\'en 2012.' },
    { date: '2010-05-06', imp: 2, cur: ['USD', '*'], kind: 'Marché', title: 'Flash crash', text: 'Chute éclair des marchés américains en quelques minutes.' },
    { date: '2011-08-05', imp: 2, cur: ['USD', 'CHF', 'JPY'], kind: 'Crise', title: 'Perte du triple A des États-Unis', text: 'S&P abaisse la note américaine : ruée vers le franc suisse et le yen.' },
    { date: '2011-09-06', imp: 3, cur: ['CHF'], kind: 'Banque centrale', title: 'Plancher EUR/CHF à 1,20', text: 'La Banque nationale suisse fixe un cours plancher pour freiner la hausse du franc.' },
    { date: '2012-07-26', imp: 3, cur: ['EUR'], kind: 'Banque centrale', title: '« Whatever it takes » (Draghi)', text: 'La BCE promet de tout faire pour sauver l\'euro : fin de la phase aiguë de la crise de la dette.' },
    { date: '2013-04-04', imp: 3, cur: ['JPY'], kind: 'Banque centrale', title: 'Abenomics : rachats massifs de la banque du Japon', cut: true, text: 'Assouplissement quantitatif et qualitatif : le yen baisse fortement (USD/JPY de 95 à 120 en deux ans). Ère des taux zéro et des rachats d\'actifs.' },
    { date: '2013-05-22', imp: 2, cur: ['USD', 'AUD', 'NZD'], kind: 'Banque centrale', title: '« Taper tantrum »', text: 'La Fed évoque la réduction de ses achats : hausse des taux longs, devises émergentes en baisse.' },
    { date: '2014-06-05', imp: 2, cur: ['EUR'], kind: 'Banque centrale', title: 'Taux de dépôt négatif à la BCE', text: 'Première grande banque centrale en taux négatifs ; l\'euro baisse de 1,39 à 1,05 dollar jusqu\'en mars 2015.' },
    { date: '2014-11-27', imp: 2, cur: ['CAD', 'NOK', 'RUB', 'USD'], kind: 'Matières premières', title: 'Effondrement du pétrole', text: 'L\'OPEP ne réduit pas sa production : chute du pétrole, baisse des devises pétrolières (CAD, NOK).' },
    { date: '2015-01-15', imp: 3, cur: ['CHF', 'EUR'], kind: 'Banque centrale', title: 'Fin du plancher EUR/CHF', text: 'La BNS abandonne sans prévenir le cours plancher : le franc suisse bondit de 20 à 30 % en quelques minutes, des courtiers font faillite.' },
    { date: '2015-01-22', imp: 3, cur: ['EUR'], kind: 'Banque centrale', title: 'Rachats d\'actifs de la BCE (QE)', text: 'La BCE lance un programme de 60 milliards d\'euros par mois : euro faible.' },
    { date: '2015-08-11', imp: 2, cur: ['CNY', 'AUD', 'NZD', '*'], kind: 'Crise de change', title: 'Dévaluation du yuan', text: 'La Chine dévalue sa monnaie : panique sur les marchés en août 2015.' },
    { date: '2015-12-16', imp: 2, cur: ['USD'], kind: 'Banque centrale', title: 'Première hausse des taux de la Fed depuis 2006', text: 'Début de la normalisation monétaire américaine.' },
    { date: '2016-06-23', imp: 3, cur: ['GBP', 'EUR'], kind: 'Politique', title: 'Référendum du Brexit', text: 'Victoire du « leave » : la livre chute de plus de 10 % en une nuit.' },
    { date: '2016-10-07', imp: 2, cur: ['GBP'], kind: 'Marché', title: 'Flash crash de la livre', text: 'La livre perd environ 6 % en quelques minutes pendant la séance asiatique.' },
    { date: '2016-11-08', imp: 2, cur: ['USD', 'MXN', '*'], kind: 'Politique', title: 'Élection de Donald Trump', text: 'Forte hausse du dollar et des taux américains fin 2016.' },
    { date: '2018-03-22', imp: 2, cur: ['USD', 'CNY', 'AUD', '*'], kind: 'Politique', title: 'Guerre commerciale États-Unis – Chine', text: 'Droits de douane réciproques : dollar fort, devises liées à la Chine en baisse.' },
    { date: '2019-07-31', imp: 2, cur: ['USD'], kind: 'Banque centrale', title: 'La Fed baisse ses taux', text: 'Première baisse depuis 2008, par prudence face au ralentissement.' },
    { date: '2020-03-11', imp: 3, cur: ['*'], kind: 'Crise', title: 'Pandémie de Covid-19', cut: true, text: 'Krach de mars 2020, volatilité extrême, ruée sur le dollar puis rachats massifs des banques centrales. Suivent l\'inflation de 2021–2022 et la hausse rapide des taux.' },
    { date: '2020-03-15', imp: 3, cur: ['USD'], kind: 'Banque centrale', title: 'Fed à taux zéro et rachats illimités', text: 'Taux ramenés à 0 % et rachats d\'actifs sans limite (23 mars) : le dollar baisse jusqu\'en 2021.' },
    { date: '2022-02-24', imp: 3, cur: ['EUR', 'RUB', 'CHF', '*'], kind: 'Géopolitique', title: 'Invasion de l\'Ukraine par la Russie', text: 'Envolée du gaz et du pétrole, inflation, euro en forte baisse.' },
    { date: '2022-03-16', imp: 3, cur: ['USD'], kind: 'Banque centrale', title: 'La Fed commence ses hausses de taux', text: 'Hausses les plus rapides depuis les années 1980 (jusqu\'à 5,25–5,50 % en juillet 2023) : dollar très fort en 2022.' },
    { date: '2022-07-12', imp: 2, cur: ['EUR', 'USD'], kind: 'Marché', title: 'L\'euro passe sous la parité', text: 'Un euro vaut moins d\'un dollar pour la première fois depuis 2002 (plus bas vers 0,95 fin septembre 2022).' },
    { date: '2022-07-21', imp: 2, cur: ['EUR'], kind: 'Banque centrale', title: 'Première hausse des taux de la BCE depuis 2011', text: 'Fin des taux négatifs en zone euro.' },
    { date: '2022-09-23', imp: 3, cur: ['GBP'], kind: 'Politique', title: 'Mini-budget britannique', text: 'Plan budgétaire non financé : la livre touche son plus bas historique (vers 1,035 dollar le 26 septembre).' },
    { date: '2022-09-22', imp: 2, cur: ['JPY'], kind: 'Intervention', title: 'Le Japon intervient pour soutenir le yen', text: 'Première intervention depuis 1998, le yen étant au plus bas depuis 24 ans.' },
    { date: '2023-03-10', imp: 2, cur: ['USD', '*'], kind: 'Crise', title: 'Faillite de Silicon Valley Bank', text: 'Crise bancaire régionale aux États-Unis puis rachat de Credit Suisse par UBS (19 mars).' },
    { date: '2024-03-19', imp: 2, cur: ['JPY'], kind: 'Banque centrale', title: 'La banque du Japon sort des taux négatifs', text: 'Première hausse de taux japonaise depuis 2007.' },
    { date: '2024-06-06', imp: 2, cur: ['EUR'], kind: 'Banque centrale', title: 'Première baisse des taux de la BCE', text: 'Début de l\'assouplissement en zone euro.' },
    { date: '2024-08-05', imp: 3, cur: ['JPY', '*'], kind: 'Marché', title: 'Débouclage du carry trade en yen', text: 'Hausse brutale du yen et krach de la bourse japonaise après une hausse de taux au Japon.' },
    { date: '2024-09-18', imp: 2, cur: ['USD'], kind: 'Banque centrale', title: 'Première baisse des taux de la Fed (cycle 2024)', text: 'Baisse d\'un demi-point.' },
    { date: '2024-11-05', imp: 2, cur: ['USD', '*'], kind: 'Politique', title: 'Réélection de Donald Trump', text: 'Dollar en hausse jusqu\'en janvier 2025.' },
    { date: '2025-04-02', imp: 3, cur: ['USD', '*'], kind: 'Politique', title: 'Droits de douane américains généralisés', text: 'Annonce de droits de douane sur la plupart des pays : forte volatilité, baisse du dollar en 2025.' },
  ].map((e, i) => Object.assign({ id: 'b' + i, source: 'base' }, e));

  /** Devises d'une paire « EUR/USD » → ['EUR', 'USD'] (l'ancien mark, franc… comptent avec l'euro). */
  function currencies(pair) {
    const c = String(pair || '').toUpperCase().match(/[A-Z]{3}/g) || [];
    return c.concat(c.includes('EUR') ? ['DEM', 'FRF'] : []);
  }
  function relevant(ev, pair) {
    if (!pair) return true;
    if (ev.pair && ev.source === 'auto') return ev.pair === pair;
    const cs = currencies(pair);
    return (ev.cur || ['*']).some((c) => c === '*' || cs.includes(c));
  }
  /** Événements (base + enregistrés) pour une paire, triés par date ; options {from, to (AAAA-MM-JJ), minImp}. */
  function list(stored, pair, o) {
    o = o || {};
    const all = BUILTIN.map((e) => Object.assign({}, e, (stored && stored.edits && stored.edits[e.id]) || {})).filter((e) => !e.hidden)
      .concat(((stored && stored.items) || []).filter((e) => !e.hidden));
    return all.filter((e) => relevant(e, pair) && (!o.from || e.date >= o.from) && (!o.to || e.date <= o.to) && (!o.minImp || (e.imp || 1) >= o.minImp))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  /** Années de coupure suggérées par la base (événements « cut »). */
  function cutEvents() { return BUILTIN.filter((e) => e.cut); }

  /**
   * Mouvements exceptionnels dans des bougies quotidiennes ou plus longues : variation d'une bougie supérieure
   * à k fois la variation habituelle (écart absolu médian sur ~1 an). Les chocs proches (moins de 5 bougies) sont
   * regroupés. Renvoie [{date, index, movePct, ratio}], du plus fort au plus faible (au plus max).
   */
  function detect(bars, o) {
    o = o || {};
    const k = o.k || 6, max = o.max || 40, n = bars.length, out = [];
    if (n < 60) return out;
    const r = [];
    for (let i = 1; i < n; i++) r.push(bars[i - 1].close > 0 ? (bars[i].close - bars[i - 1].close) / bars[i - 1].close : 0);
    const W = 250;
    for (let i = 30; i < r.length; i++) {
      const lo = Math.max(0, i - W), win = r.slice(lo, i).map(Math.abs).sort((a, b) => a - b);
      const mad = win[win.length >> 1] || 0;
      if (mad <= 0) continue;
      const ratio = Math.abs(r[i]) / mad;
      if (ratio >= k) out.push({ date: String(bars[i + 1].date).slice(0, 10), index: i + 1, movePct: r[i] * 100, ratio: ratio });
    }
    // regroupe les chocs à moins de 5 bougies d'écart (on garde le plus fort)
    const merged = [];
    for (const e of out) {
      const last = merged[merged.length - 1];
      if (last && e.index - last.index < 5) { if (e.ratio > last.ratio) merged[merged.length - 1] = e; } else merged.push(e);
    }
    return merged.sort((a, b) => b.ratio - a.ratio).slice(0, max);
  }
  /** Événement connu le plus proche d'une date (± days jours) pour une paire, ou null. */
  function nearest(stored, pair, date, days) {
    const t = Date.parse(date), d = (days || 5) * 864e5;
    let best = null;
    for (const e of list(stored, pair)) {
      if (e.source === 'auto') continue;
      const dt = Math.abs(Date.parse(e.date) - t);
      if (dt <= d && (!best || dt < best.dt)) best = { e: e, dt: dt };
    }
    return best ? best.e : null;
  }
  /**
   * Ajoute aux événements enregistrés les chocs détectés pas encore connus. Renvoie {stored, added: [événements]}.
   * Un choc est « connu » s'il existe déjà un événement détecté pour cette paire à ± 3 jours.
   */
  function learn(stored, bars, pair, o) {
    const s = { items: ((stored && stored.items) || []).slice(), edits: (stored && stored.edits) || {} };
    const added = [];
    for (const d of detect(bars, o)) {
      const t = Date.parse(d.date);
      if (s.items.some((e) => e.source === 'auto' && e.pair === pair && Math.abs(Date.parse(e.date) - t) <= 3 * 864e5)) continue;
      const near = nearest(s, pair, d.date, 5);
      const mv = (d.movePct >= 0 ? '+' : '−') + Math.abs(d.movePct).toFixed(2).replace('.', ',') + ' %';
      const ev = {
        id: 'a' + pair.replace(/\W/g, '') + d.date.replace(/-/g, ''), source: 'auto', pair: pair, date: d.date, imp: d.ratio >= 10 ? 3 : 2, cur: currencies(pair).slice(0, 2),
        kind: 'Mouvement détecté', title: 'Mouvement exceptionnel ' + pair + ' (' + mv + ')',
        text: pair + ' a bougé de ' + mv + ' en une bougie, ' + d.ratio.toFixed(0) + ' fois la variation habituelle.' + (near ? ' Probablement lié à : ' + near.title + ' (' + near.date + ').' : ' Cause inconnue : vous pouvez la renseigner.'),
        linked: near ? near.id : '', detectedAt: new Date().toISOString().slice(0, 10),
      };
      s.items.push(ev); added.push(ev);
    }
    return { stored: s, added: added };
  }

  F.events = { BUILTIN, currencies, relevant, list, cutEvents, detect, nearest, learn };
})(typeof window !== 'undefined' ? window : globalThis);
