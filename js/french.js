/* Forexia — stratégies écrites en français.
 *
 * parse(texte)       : traduit une description en français en règles techniques.
 * randomStrategy()   : génère une stratégie aléatoire (texte français + règles).
 * derivePlots(règles): indicateurs à tracer sur le graphique.
 *
 * Exemple compris :
 *   Acheter quand le RSI 14 passe au-dessus de 30 et que le prix est au-dessus de la moyenne mobile 200.
 *   Vendre dans le cas inverse.
 *   Sortir de l'achat quand le RSI dépasse 70.
 *   Stop loss 50 pips, take profit 100 pips. */
(function (root) {
  'use strict';

  // ---------- Normalisation ----------
  function normalize(text) {
    return String(text)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[’`´]/g, "'")
      .replace(/œ/g, 'oe')
      .replace(/([a-z])-([a-z])/g, '$1 $2')
      .replace(/>=/g, ' au dessus de ').replace(/<=/g, ' en dessous de ')
      .replace(/>/g, ' au dessus de ').replace(/</g, ' en dessous de ')
      .replace(/[ \t]+/g, ' ');
  }

  // ---------- Opérandes ----------
  // {ind, args, fam} pour un indicateur, {num} pour un nombre.
  const ind = (name, args, fam) => ({ ind: name, args: args, fam: fam || name });
  const toInt = (s, d) => (s === undefined || s === '' ? d : parseInt(s, 10));
  let macdCtx = [12, 26, 9];
  let stochCtx = [14, 3, 3];
  let periodCtx = {};
  // Réutilise la dernière période citée : « le RSI 9 … le RSI repasse sous 50 » = RSI(9).
  const remember = (name, m1, def) => (m1 ? (periodCtx[name] = [+m1]) : periodCtx[name] || [def]).slice();

  const bbMake = (name) => (m) => ind(name, [toInt(m[1], 20), m[2] ? Number(m[2].replace(',', '.')) : 2], 'BB');
  const PERIOD = '(?:\\s*\\(?\\s*(?:sur\\s+|de\\s+)?(\\d+)\\s*\\)?(?:\\s*(?:periodes?|jours|bougies|seances))?)?';
  const MENTIONS = [
    { re: /divergence\s+haussiere(?:\s+(?:du|sur\s+le|de)\s+rsi(?:\s*\(?\s*(\d+)\s*\)?)?)?/g, make: (m) => raw('BULL_DIV(RSI(' + remember('RSI', m[1], 14)[0] + '), 14)', 'PATTERN') },
    { re: /divergence\s+baissiere(?:\s+(?:du|sur\s+le|de)\s+rsi(?:\s*\(?\s*(\d+)\s*\)?)?)?/g, make: (m) => raw('BEAR_DIV(RSI(' + remember('RSI', m[1], 14)[0] + '), 14)', 'PATTERN') },
    { re: /(?:le\s+)?(?:%d|stoch\w*\s+%?d\b|ligne\s+%?d\b|signal\s+du\s+stoch\w*)/g, make: () => ind('STOCH_D', stochCtx.slice(), 'STOCH') },
    { re: /histogramme(?:\s+du)?(?:\s+macd)?(?:\s*\(?\s*(\d+)\s*[,;/ ]\s*(\d+)\s*[,;/ ]\s*(\d+)\s*\)?)?/g, make: (m) => {
      if (m[1]) macdCtx = [+m[1], +m[2], +m[3]];
      return ind('MACD_HIST', macdCtx.slice(), 'MACD');
    } },
    { re: /macd(?:\s*\(?\s*(\d+)\s*[,;/ ]\s*(\d+)\s*[,;/ ]\s*(\d+)\s*\)?)?/g, make: (m) => {
      if (m[1]) macdCtx = [+m[1], +m[2], +m[3]];
      return ind('MACD', macdCtx.slice(), 'MACD');
    } },
    { re: /(?:(?:sa|la)\s+)?(?:ligne\s+de\s+)?signal(?:\s+du\s+macd)?/g, make: () => ind('MACD_SIGNAL', macdCtx.slice(), 'MACD') },
    { re: /rsi(?:\s*\(?\s*(?:sur\s+)?(\d+)\s*\)?(?:\s*(?:periodes?|jours|bougies|seances))?)?/g, make: (m) => ind('RSI', remember('RSI', m[1], 14)) },
    { re: /(?:oscillateur\s+)?(?:stochastique|stoch)(?:\s*%?k\b)?(?:\s*\(?\s*(\d+)(?:\s*[,;/]\s*(\d+))?(?:\s*[,;/]\s*(\d+))?\s*\)?)?|%k/g, make: (m) => {
      if (m[1]) stochCtx = [+m[1], toInt(m[2], 3), toInt(m[3], 3)];
      return ind('STOCH_K', stochCtx.slice(), 'STOCH');
    } },
    { re: /(?:la\s+)?(?:bande\s+(?:de\s+)?bollinger\s+(?:haute|superieure|du haut)|bande\s+(?:haute|superieure)(?:\s+de\s+bollinger)?|bollinger\s+(?:haute|superieure|haut))(?:\s*\(?\s*(\d+)\s*[,;/]\s*(\d+(?:[.,]\d+)?)\s*\)?)?/g, make: bbMake('BB_UPPER') },
    { re: /(?:la\s+)?(?:bande\s+(?:de\s+)?bollinger\s+(?:basse|inferieure|du bas)|bande\s+(?:basse|inferieure)(?:\s+de\s+bollinger)?|bollinger\s+(?:basse|inferieure|bas))(?:\s*\(?\s*(\d+)\s*[,;/]\s*(\d+(?:[.,]\d+)?)\s*\)?)?/g, make: bbMake('BB_LOWER') },
    { re: /(?:la\s+)?(?:(?:bande|ligne|moyenne)\s+(?:mediane|centrale|du milieu)(?:\s+de\s+bollinger)?|moyenne\s+de\s+bollinger|bollinger\s+(?:mediane|centrale|milieu))(?:\s*\(?\s*(\d+)\s*[,;/]\s*(\d+(?:[.,]\d+)?)\s*\)?)?/g, make: bbMake('BB_MIDDLE') },
    { re: new RegExp('(?:la\\s+)?(?:moyenne\\s+mobile\\s+exponentielle|mm\\s+exponentielle|mme|ema)' + PERIOD, 'g'), make: (m) => ind('EMA', [toInt(m[1], 20)], 'PRICE') },
    { re: new RegExp('(?:la\\s+)?(?:moyenne\\s+mobile(?:\\s+simple|\\s+arithmetique)?|mms|mm|sma|ma(?=\\s*\\(?\\d))' + PERIOD, 'g'), make: (m) => ind('SMA', [toInt(m[1], 20)], 'PRICE') },
    { re: /cci(?:\s*\(?\s*(\d+)\s*\)?)?/g, make: (m) => ind('CCI', remember('CCI', m[1], 20)) },
    { re: /williams(?:\s*%?\s*r)?(?:\s*\(?\s*(\d+)\s*\)?)?/g, make: (m) => ind('WILLR', remember('WILLR', m[1], 14)) },
    { re: /atr(?:\s*\(?\s*(\d+)\s*\)?)?/g, make: (m) => ind('ATR', remember('ATR', m[1], 14)) },
    { re: /momentum(?:\s*\(?\s*(\d+)\s*\)?)?/g, make: (m) => ind('MOM', remember('MOM', m[1], 10)) },
    // Forexia 1.2
    { re: /(?:une\s+)?(?:bougie\s+)?(?:englobante\s+haussiere|avalement\s+haussier|engulfing\s+haussier)/g, make: () => ind('BULL_ENGULF', null, 'PATTERN') },
    { re: /(?:une\s+)?(?:bougie\s+)?(?:englobante\s+baissiere|avalement\s+baissier|engulfing\s+baissier)/g, make: () => ind('BEAR_ENGULF', null, 'PATTERN') },
    { re: /(?:un\s+)?(?:marteau|hammer)/g, make: () => ind('HAMMER', null, 'PATTERN') },
    { re: /(?:une\s+)?(?:etoile\s+filante|shooting\s+star)/g, make: () => ind('SHOOTING_STAR', null, 'PATTERN') },
    { re: /(?:l'\s*)?adx(?:\s*\(?\s*(\d+)\s*\)?)?/g, make: (m) => ind('ADX', remember('ADX', m[1], 14)) },
    { re: /(?:le\s+)?(?:\+\s*di|di\s*\+|di\s+plus|di\s+positif)(?:\s*\(?\s*(\d+)\s*\)?)?/g, make: (m) => ind('PLUS_DI', remember('DI', m[1], 14), 'DMI') },
    { re: /(?:le\s+)?(?:-\s*di|−\s*di|di\s*-|di\s+moins|di\s+negatif)(?:\s*\(?\s*(\d+)\s*\)?)?/g, make: (m) => ind('MINUS_DI', remember('DI', m[1], 14), 'DMI') },
    { re: /(?:le\s+)?(?:sar\s+parabolique|parabolique\s+sar|parabolic\s+sar|psar|sar)\b/g, make: () => ind('PSAR', null, 'PRICE') },
    { re: /(?:le\s+)?super\s*trend(?:\s*\(?\s*(\d+)\s*[,;/ ]\s*(\d+(?:[.,]\d+)?)\s*\)?)?/g, make: (m) => ind('SUPERTREND', [toInt(m[1], 10), m[2] ? Number(m[2].replace(',', '.')) : 3], 'PRICE') },
    { re: /(?:le\s+|la\s+)?(?:canal\s+(?:de\s+)?)?donchian\s+(haut|haute|superieur|superieure|bas|basse|inferieur|inferieure|median|mediane)(?:\s*\(?\s*(\d+)\s*\)?)?/g,
      make: (m) => ind(/^(haut|sup)/.test(m[1]) ? 'DONCHIAN_UPPER' : /^(bas|inf)/.test(m[1]) ? 'DONCHIAN_LOWER' : 'DONCHIAN_MIDDLE', [toInt(m[2], 20)], 'PRICE') },
    { re: /(?:le\s+|la\s+)?(?:canal\s+(?:de\s+)?|bande\s+(?:de\s+)?)?keltner\s+(haut|haute|superieur|superieure|bas|basse|inferieur|inferieure)/g,
      make: (m) => ind(/^(haut|sup)/.test(m[1]) ? 'KELTNER_UPPER' : 'KELTNER_LOWER', null, 'PRICE') },
    { re: /(?:la\s+)?(?:resistance\s*1|r1)\b/g, make: () => ind('PIVOT_R1', null, 'PRICE') },
    { re: /(?:le\s+)?(?:support\s*1|s1)\b/g, make: () => ind('PIVOT_S1', null, 'PRICE') },
    { re: /(?:la\s+)?(?:resistance\s*2|r2)\b/g, make: () => ind('PIVOT_R2', null, 'PRICE') },
    { re: /(?:le\s+)?(?:support\s*2|s2)\b/g, make: () => ind('PIVOT_S2', null, 'PRICE') },
    { re: /(?:le\s+)?point\s+pivot|(?:le\s+)?pivot\b/g, make: () => ind('PIVOT', null, 'PRICE') },
    { re: /(?:la\s+)?tenkan(?:\s+sen)?(?:\s*\(?\s*(\d+)\s*\)?)?/g, make: (m) => ind('TENKAN', [toInt(m[1], 9)], 'PRICE') },
    { re: /(?:la\s+)?kijun(?:\s+sen)?(?:\s*\(?\s*(\d+)\s*\)?)?/g, make: (m) => ind('KIJUN', [toInt(m[1], 26)], 'PRICE') },
    { re: /(?:la\s+)?(?:cloture\s+)?heikin\s*ashi/g, make: () => ind('HA_CLOSE', null, 'PRICE') },
    { re: /\b(?:le\s+|la\s+)?(?:prix|cours|cloture|close|bougie|paire)\b/g, make: () => ind('CLOSE', null, 'PRICE') },
  ];
  const raw = (text, fam) => ({ ind: text, raw: text, fam: fam });
  // Unité de temps citée après un indicateur : « la moyenne mobile 50 en H4 », « le prix en journalier ».
  const TF_WORDS = { journalier: 'D1', quotidien: 'D1', hebdomadaire: 'W1', hebdo: 'W1', mensuel: 'MN' };
  const TF_RE = /\b(?:en|sur\s+le|sur\s+l'unite|unite)\s+(m1|m5|m15|m30|h1|h4|d1|w1|mn|journalier|quotidien|hebdomadaire|hebdo|mensuel)\b/g;

  function findMentions(clause) {
    // Les paramètres explicites (MACD (5,35,5), stochastique (9,3,3)) valent pour toute la condition,
    // y compris « sa ligne de signal » / « sa ligne %D » citées avant ou après.
    const mm = /macd\s*\(?\s*(\d+)\s*[,;/ ]\s*(\d+)\s*[,;/ ]\s*(\d+)/.exec(clause);
    if (mm) macdCtx = [+mm[1], +mm[2], +mm[3]];
    const sm = /(?:stochastique|stoch)\s*%?k?\s*\(\s*(\d+)(?:\s*[,;/]\s*(\d+))?(?:\s*[,;/]\s*(\d+))?/.exec(clause);
    if (sm) stochCtx = [+sm[1], toInt(sm[2], 3), toInt(sm[3], 3)];
    let masked = clause;
    const found = [];
    const tfs = [];
    masked = masked.replace(TF_RE, (all, tf, pos) => { tfs.push({ tf: TF_WORDS[tf] || tf.toUpperCase(), pos: pos }); return ' '.repeat(all.length); });
    for (const def of MENTIONS) {
      def.re.lastIndex = 0;
      let m;
      while ((m = def.re.exec(masked))) {
        if (!m[0].trim()) { def.re.lastIndex++; continue; }
        found.push({ op: def.make(m), pos: m.index });
        masked = masked.slice(0, m.index) + ' '.repeat(m[0].length) + masked.slice(m.index + m[0].length);
      }
    }
    const numRe = /(^|[^\w%])(-?\d+(?:[.,]\d+)?)(?![\w%])/g;
    let m;
    while ((m = numRe.exec(masked))) found.push({ op: { num: Number(m[2].replace(',', '.')) }, pos: m.index + m[1].length });
    found.sort((a, b) => a.pos - b.pos);
    // l'unité de temps s'applique à l'indicateur cité juste avant
    for (const t of tfs) {
      const prev = found.filter((f) => f.op.ind && f.pos < t.pos).pop();
      if (prev) prev.op = Object.assign({}, prev.op, { tf: t.tf });
    }
    // « la pente de la moyenne mobile 50 » : variation de la moyenne sur 5 bougies
    if (/\bpente\b/.test(clause)) {
      const ma = found.find((f) => f.op.ind === 'SMA' || f.op.ind === 'EMA');
      if (ma) ma.op = { ind: 'SLOPE', inner: ma.op, args: [5], fam: 'SLOPE' };
    }
    return { ops: found.map((f) => f.op), masked: masked };
  }

  function renderOp(o) {
    if (o.num !== undefined) return String(o.num);
    const base = o.raw ? o.raw : o.inner ? o.ind + '(' + renderOp(o.inner) + ', ' + o.args.join(', ') + ')' : !o.args ? o.ind : o.ind + '(' + o.args.join(',') + ')';
    return o.tf ? base + '@' + o.tf : base;
  }

  // Zones de surachat / survente usuelles.
  const ZONES = { RSI: [30, 70], STOCH: [20, 80], CCI: [-100, 100], WILLR: [-80, -20] };

  // ---------- Analyse d'une condition ----------
  const CROSS_VERB = /\b(passe|passent|repasse|remonte|redescend|franchit|traverse|casse|croise|croisent|coupe|sort|perce|devient|redevient|bascule)\b/;
  const UP = /(au dessus|a la hausse|vers le haut|par le bas|en hausse|remonte|superieur|plus grand|plus haut|depasse|excede)/;
  const DOWN = /(en dessous|au dessous|\bsous\b|a la baisse|vers le bas|par le haut|en baisse|redescend|inferieur|plus petit|plus bas|descend)/;

  function parseClause(raw, last) {
    let text = raw.replace(/^\s*(?:que|qu')\s*/, '').trim();
    if (!text) return null;
    text = text.replace(/\bentre\s+(-?\d+(?:[.,]\d+)?)\s+et\s+(-?\d+(?:[.,]\d+)?)/, 'entre $1 _ $2');
    const { ops, masked } = findMentions(text);
    const indOps = ops.filter((o) => o.ind);
    let a = indOps[0] || (last && last.subject);
    if (!a) return { error: true };
    const others = ops.filter((o) => o !== a);
    let b = others[0];

    if (/\bentre\b/.test(masked)) {
      const nums = ops.filter((o) => o.num !== undefined);
      if (nums.length >= 2) return { kind: 'between', a: a, lo: Math.min(nums[0].num, nums[1].num), hi: Math.max(nums[0].num, nums[1].num) };
    }
    // figure de bougie ou divergence : vraie (1) ou fausse (0)
    if (a.fam === 'PATTERN' && !b) return { kind: 'cmp', op: '>', a: a, b: { num: 0 } };
    const zone = ZONES[a.fam] || [30, 70];
    const cross = CROSS_VERB.test(masked);
    if (/surven|survendu/.test(masked)) {
      if (cross && /\bsort|quitte|remonte/.test(masked)) return { kind: 'cross', dir: 1, a: a, b: { num: zone[0] } };
      return { kind: 'cmp', op: '<', a: a, b: { num: zone[0] } };
    }
    if (/surach/.test(masked)) {
      if (cross && /\bsort|quitte|redescend/.test(masked)) return { kind: 'cross', dir: -1, a: a, b: { num: zone[1] } };
      return { kind: 'cmp', op: '>', a: a, b: { num: zone[1] } };
    }
    if (/positi/.test(masked) && !b) return { kind: cross ? 'cross' : 'cmp', dir: 1, op: '>', a: a, b: { num: 0 } };
    if (/negati/.test(masked) && !b) return { kind: cross ? 'cross' : 'cmp', dir: -1, op: '<', a: a, b: { num: 0 } };
    // Croisement implicite : « le MACD croise sa ligne de signal », « le stochastique croise à la hausse ».
    if (!b && cross) {
      if (a.ind === 'MACD') b = ind('MACD_SIGNAL', a.args, 'MACD');
      else if (a.ind === 'STOCH_K') b = ind('STOCH_D', a.args, 'STOCH');
    }
    const up = UP.test(masked), down = DOWN.test(masked);
    if (!b) {
      if (/(haussier|monte|augmente|progresse|grimpe|en hausse)/.test(masked)) return { kind: 'trend', dir: 1, a: a };
      if (/(baissier|descend|diminue|recule|chute|en baisse)/.test(masked)) return { kind: 'trend', dir: -1, a: a };
      return { error: true };
    }
    let dir = 0;
    const iu = masked.search(UP), id = masked.search(DOWN);
    if (up && !down) dir = 1; else if (down && !up) dir = -1; else if (up && down) dir = iu < id ? 1 : -1;
    if (!dir && cross && /(franchit|casse|perce|traverse|croise|coupe)/.test(masked)) {
      dir = b.ind === 'BB_LOWER' ? -1 : 1; // « casse la bande haute » = vers le haut
    }
    if (!dir) {
      if (/(egal|vaut|=)/.test(masked)) return { kind: 'cmp', op: '==', a: a, b: b };
      return { error: true };
    }
    if (cross && !/\b(est|reste|sont|restent|se trouve|se situe)\b/.test(masked)) return { kind: 'cross', dir: dir, a: a, b: b };
    return { kind: 'cmp', op: dir > 0 ? '>' : '<', a: a, b: b };
  }

  function renderClause(c) {
    switch (c.kind) {
      case 'cross': return (c.dir > 0 ? 'CROSS_UP(' : 'CROSS_DOWN(') + renderOp(c.a) + ', ' + renderOp(c.b) + ')';
      case 'cmp': return renderOp(c.a) + ' ' + c.op + ' ' + renderOp(c.b);
      case 'between': return renderOp(c.a) + ' > ' + c.lo + ' AND ' + renderOp(c.a) + ' < ' + c.hi;
      case 'trend': return renderOp(c.a) + (c.dir > 0 ? ' > ' : ' < ') + 'PREV(' + renderOp(c.a) + ', 1)';
    }
    return '';
  }

  // Symétrique d'une condition (pour « vendre dans le cas inverse »).
  function mirrorNum(n, fam) {
    if (fam === 'RSI' || fam === 'STOCH') return 100 - n;
    if (fam === 'WILLR') return -100 - n;
    if (fam === 'PRICE' || fam === 'BB' || fam === 'ATR') return n;
    return -n;
  }
  const MIRROR_PAT = { BULL_ENGULF: 'BEAR_ENGULF', BEAR_ENGULF: 'BULL_ENGULF', HAMMER: 'SHOOTING_STAR', SHOOTING_STAR: 'HAMMER', PLUS_DI: 'MINUS_DI', MINUS_DI: 'PLUS_DI',
    DONCHIAN_UPPER: 'DONCHIAN_LOWER', DONCHIAN_LOWER: 'DONCHIAN_UPPER', KELTNER_UPPER: 'KELTNER_LOWER', KELTNER_LOWER: 'KELTNER_UPPER',
    PIVOT_R1: 'PIVOT_S1', PIVOT_S1: 'PIVOT_R1', PIVOT_R2: 'PIVOT_S2', PIVOT_S2: 'PIVOT_R2' };
  function mirrorOp(o, fam) {
    if (o.num !== undefined) return { num: fam === 'PATTERN' ? o.num : mirrorNum(o.num, fam) };
    if (o.raw && /^BULL_DIV/.test(o.raw)) return Object.assign({}, o, { raw: o.raw.replace('BULL_DIV', 'BEAR_DIV'), ind: o.raw.replace('BULL_DIV', 'BEAR_DIV') });
    if (o.raw && /^BEAR_DIV/.test(o.raw)) return Object.assign({}, o, { raw: o.raw.replace('BEAR_DIV', 'BULL_DIV'), ind: o.raw.replace('BEAR_DIV', 'BULL_DIV') });
    if (MIRROR_PAT[o.ind]) return Object.assign({}, o, { ind: MIRROR_PAT[o.ind] });
    if (o.ind === 'BB_UPPER') return ind('BB_LOWER', o.args, 'BB');
    if (o.ind === 'BB_LOWER') return ind('BB_UPPER', o.args, 'BB');
    return o;
  }
  function mirrorClause(c) {
    const fam = c.a.fam;
    switch (c.kind) {
      case 'cross': return { kind: 'cross', dir: -c.dir, a: mirrorOp(c.a, fam), b: mirrorOp(c.b, fam) };
      case 'cmp': return fam === 'PATTERN' || (fam === 'ADX' && c.b.num !== undefined) || (fam === 'DMI' && c.b.fam === 'DMI') ? { kind: 'cmp', op: c.op, a: mirrorOp(c.a, fam), b: c.b.num !== undefined ? c.b : mirrorOp(c.b, fam) }
        : { kind: 'cmp', op: { '>': '<', '<': '>', '==': '==' }[c.op], a: mirrorOp(c.a, fam), b: mirrorOp(c.b, fam) };
      case 'between': { const x = mirrorNum(c.lo, fam), y = mirrorNum(c.hi, fam); return { kind: 'between', a: c.a, lo: Math.min(x, y), hi: Math.max(x, y) }; }
      case 'trend': return { kind: 'trend', dir: -c.dir, a: c.a };
    }
    return c;
  }

  function renderGroups(groups) {
    const parts = groups.map((g) => g.map(renderClause).join(' AND '));
    return parts.length > 1 ? parts.map((p, i) => (groups[i].length > 1 ? '(' + p + ')' : p)).join(' OR ') : parts[0] || '';
  }

  // Découpe « A et B ou C » en groupes OU de conditions ET.
  function parseCondition(text, warnings, original) {
    const groups = [];
    const last = { subject: null };
    const protectedText = text
      .replace(/\([^()]*\)/g, (m) => m.replace(/,/g, '\u00a4'))
      .replace(/\bentre\s+(-?\d+(?:[.,]\d+)?)\s+et\s+/g, 'entre $1 _ ');
    for (const orPart of protectedText.split(/\s+ou\s+(?:bien\s+)?(?:si\s+|quand\s+|lorsque\s+)?/)) {
      const group = [];
      for (const andPart of orPart.split(/\s+et\s+(?:si\s+|quand\s+|lorsque\s+)?|,\s*(?:et\s+)?/)) {
        if (!andPart.trim()) continue;
        const c = parseClause(andPart.replace(/entre (\S+) _ /, 'entre $1 et ').replace(/\u00a4/g, ','), last);
        if (!c) continue;
        if (c.error) { warnings.push('Condition non comprise : « ' + andPart.replace(/\u00a4/g, ',').trim() + ' » (dans « ' + original.trim() + ' »)'); continue; }
        last.subject = c.a;
        group.push(c);
      }
      if (group.length) groups.push(group);
    }
    return groups;
  }

  // ---------- Analyse d'un texte complet ----------
  const EXIT = /\b(sortir|sors|sortie|sorties|fermer|ferme|fermeture|cloturer|cloture|clore|couper|coupe|quitter|quitte|liquider|solder)\b/;
  const LONG = /\b(acheter|achete|achat|achats|acheteur|acheteuse|long|longue|buy|haussiere)\b/;
  const SHORT = /\b(vendre|vends|vend|vente|ventes|vendeur|vendeuse|short|sell|decouvert|baissiere)\b/;
  const WHEN = /\b(quand|lorsque|lorsqu'|si|s'il|des que|des qu'|au moment ou|une fois que|a condition que|chaque fois que|apres que)\s*/;
  const MIRROR = /\b(inverse|contraire|symetrique|oppose|meme chose|pareil|idem)\b/;

  function parse(text) {
    macdCtx = [12, 26, 9]; stochCtx = [14, 3, 3]; periodCtx = {};
    const out = { longEntry: '', longExit: '', shortEntry: '', shortExit: '', stopLossPips: 0, takeProfitPips: 0, warnings: [], understood: [] };
    let t = normalize(text);
    const num = '(\\d+(?:[.,]\\d+)?)';
    const sl = new RegExp('\\b(?:stop\\s*loss|stop|sl)\\b\\s*(?:de|a|:|=|fixe a|place a)?\\s*' + num + '\\s*(?:pips?|points?)?', 'g');
    const tp = new RegExp('\\b(?:take\\s*profit|tp|objectif(?:\\s+de\\s+gain)?|prise\\s+de\\s+(?:profits?|benefices?)|prendre\\s+(?:les\\s+|le\\s+)?(?:profits?|benefices?|gains?))\\b\\s*(?:de|a|:|=|fixe a|place a)?\\s*' + num + '\\s*(?:pips?|points?)?', 'g');
    const nv = (v) => Number(v.replace(',', '.'));
    const UNIT = '\\s*(pips?|points?|x?\\s*atr(?:\\s*(\\d+))?|fois\\s+l\'?\\s*atr(?:\\s*(\\d+))?)';
    const isAtr = (u) => /atr/.test(u);
    const atrP = (a, b) => { const p = toInt(a || b, 0); if (p && p !== 14) out.atrPeriod = p; };
    // Forexia 1.2 : stop suiveur, stop au prix d'entrée, distances en ATR, durée maximale, pause après des pertes
    t = t.replace(new RegExp('\\b(?:stop\\s+suiveur|trailing(?:\\s+stop)?|stop\\s+glissant)\\b\\s*(?:de|a|:|=)?\\s*' + num + UNIT, 'g'), (_, v, u, p1, p2) => {
      if (isAtr(u)) { out.trailAtr = nv(v); atrP(p1, p2); } else out.trailPips = nv(v); return ' . ';
    });
    t = t.replace(new RegExp('\\b(?:(?:remonter|mettre|placer|deplacer)\\s+)?(?:le\\s+)?(?:stop\\s+)?(?:au\\s+|a\\s+l\'|a\\s+)?(?:point\\s+mort|equilibre|break\\s*even|prix\\s+d\'entree)\\s*(?:apres|des|a\\s+partir\\s+de|au\\s+dela\\s+de)?\\s*(?:un\\s+gain\\s+de\\s*|\\+\\s*)?' + num + UNIT, 'g'), (_, v, u, p1, p2) => {
      if (isAtr(u)) { out.breakevenAtr = nv(v); atrP(p1, p2); } else out.breakevenPips = nv(v); return ' . ';
    });
    t = t.replace(new RegExp('\\b(?:stop\\s*loss|stop|sl)\\b\\s*(?:de|a|:|=)?\\s*' + num + '\\s*(?:x\\s*|fois\\s+l\'?\\s*)?atr(?:\\s*(\\d+))?', 'g'), (_, v, p) => { out.stopAtr = nv(v); atrP(p); return ' . '; });
    t = t.replace(new RegExp('\\b(?:take\\s*profit|tp|objectif)\\b\\s*(?:de|a|:|=)?\\s*' + num + '\\s*(?:x\\s*|fois\\s+l\'?\\s*)?atr(?:\\s*(\\d+))?', 'g'), (_, v, p) => { out.takeAtr = nv(v); atrP(p); return ' . '; });
    const BARS = '\\s*(?:bougies?|barres?|periodes?|jours?|seances?)';
    t = t.replace(new RegExp('\\b(?:(?:fermer|cloturer|sortir|couper)\\w*\\s+(?:de\\s+)?(?:la\\s+position\\s+|les\\s+positions\\s+)?(?:apres|au\\s+bout\\s+de)|duree\\s+max(?:imale)?\\s*(?:de|:)?)\\s*(\\d+)' + BARS, 'g'), (_, v) => { out.maxBars = +v; return ' . '; });
    t = t.replace(new RegExp('\\bpause\\s+(?:de\\s+)?(\\d+)' + BARS + '\\s+(?:apres|au\\s+bout\\s+de)\\s+(\\d+)\\s+pertes?(?:\\s+(?:consecutives?|de\\s+suite|d\'affilee))?', 'g'), (_, b, l) => { out.pauseBars = +b; out.pauseLosses = +l; return ' . '; });
    t = t.replace(new RegExp('\\bapres\\s+(\\d+)\\s+pertes?(?:\\s+(?:consecutives?|de\\s+suite|d\'affilee))?\\s*,?\\s*(?:faire\\s+)?(?:une\\s+)?(?:pause\\s+(?:de\\s+)?|ne\\s+plus\\s+(?:entrer|trader|prendre\\s+de\\s+position)\\s+pendant\\s+)(\\d+)' + BARS, 'g'), (_, l, b) => { out.pauseBars = +b; out.pauseLosses = +l; return ' . '; });
    t = t.replace(sl, (_, v) => { out.stopLossPips = Number(v.replace(',', '.')); return ' . '; });
    t = t.replace(tp, (_, v) => { out.takeProfitPips = Number(v.replace(',', '.')); return ' . '; });

    const parsed = { longEntry: null, longExit: null, shortEntry: null, shortExit: null };
    const mirrors = [];
    const sentences = t.split(/\.(?!\d)|(?<!\d)\.|\n|;|!|\?/).map((s) => s.trim()).filter((s) => s && /[a-z]/.test(s));
    for (const s of sentences) {
      if (/^(et\s+)?(pas de|sans)\s+(stop|take|tp|sl)/.test(s)) continue;
      const isExit = EXIT.test(s), isLong = LONG.test(s), isShort = SHORT.test(s);
      let targets = [];
      if (isExit) {
        if (isLong) targets.push('longExit');
        if (isShort) targets.push('shortExit');
        if (!targets.length) targets = ['longExit', 'shortExit'];
      } else {
        if (isLong) targets.push('longEntry');
        if (isShort) targets.push('shortEntry');
      }
      if (!targets.length) { out.warnings.push('Phrase ignorée (ni achat, ni vente, ni sortie) : « ' + s + ' »'); continue; }
      const w = WHEN.exec(s);
      let cond = w ? s.slice(w.index + w[0].length) : s.replace(/^.*?(?::|\bsi\b)/, '');
      if (!w && cond === s) {
        cond = s.replace(EXIT, ' ').replace(LONG, ' ').replace(SHORT, ' ').replace(/\b(de l'|du|de la|position|a l'|a la)\b/g, ' ');
      }
      if (MIRROR.test(s) && targets.length === 1 && !findMentions(cond).ops.some((o) => o.ind)) {
        mirrors.push(targets[0]);
        continue;
      }
      const groups = parseCondition(cond, out.warnings, s);
      if (!groups.length) continue;
      for (const k of targets) parsed[k] = parsed[k] ? parsed[k].concat(groups) : groups;
    }
    const opposite = { shortEntry: 'longEntry', longEntry: 'shortEntry', shortExit: 'longExit', longExit: 'shortExit' };
    for (const k of mirrors) {
      const src = parsed[opposite[k]];
      if (src) parsed[k] = src.map((g) => g.map(mirrorClause));
      else out.warnings.push('« Inverse » sans règle de départ pour ' + LABELS[k].toLowerCase() + '.');
    }
    for (const k of Object.keys(parsed)) {
      if (!parsed[k]) continue;
      out[k] = renderGroups(parsed[k]);
      out.understood.push({ key: k, label: LABELS[k], rule: out[k] });
    }
    if (out.stopLossPips) out.understood.push({ key: 'sl', label: 'Stop-loss', rule: out.stopLossPips + ' pips' });
    if (out.takeProfitPips) out.understood.push({ key: 'tp', label: 'Take-profit', rule: out.takeProfitPips + ' pips' });
    const fr = (v) => String(v).replace('.', ',');
    const atrTxt = ' ATR' + (out.atrPeriod ? ' ' + out.atrPeriod : '');
    if (out.stopAtr) out.understood.push({ key: 'slAtr', label: 'Stop-loss', rule: fr(out.stopAtr) + atrTxt });
    if (out.takeAtr) out.understood.push({ key: 'tpAtr', label: 'Take-profit', rule: fr(out.takeAtr) + atrTxt });
    if (out.trailPips || out.trailAtr) out.understood.push({ key: 'trail', label: 'Stop suiveur', rule: out.trailAtr ? fr(out.trailAtr) + atrTxt : out.trailPips + ' pips' });
    if (out.breakevenPips || out.breakevenAtr) out.understood.push({ key: 'be', label: 'Stop au prix d\'entrée après', rule: out.breakevenAtr ? fr(out.breakevenAtr) + atrTxt : out.breakevenPips + ' pips' });
    if (out.maxBars) out.understood.push({ key: 'mb', label: 'Durée maximale', rule: out.maxBars + ' bougies' });
    if (out.pauseLosses) out.understood.push({ key: 'pz', label: 'Pause', rule: out.pauseBars + ' bougies après ' + out.pauseLosses + ' pertes de suite' });
    if (!out.longEntry && !out.shortEntry) out.warnings.push('Aucune règle d\'entrée trouvée. Commencez une phrase par « Acheter quand… » ou « Vendre quand… ».');
    out.plots = derivePlots(out);
    return out;
  }
  const LABELS = { longEntry: 'Entrée achat', longExit: 'Sortie achat', shortEntry: 'Entrée vente', shortExit: 'Sortie vente' };

  // ---------- Indicateurs à tracer ----------
  function derivePlots(rules) {
    const seen = [];
    const re = /\b(SMA|EMA|RSI|MACD_SIGNAL|MACD_HIST|MACD|STOCH_K|STOCH_D|BB_UPPER|BB_MIDDLE|BB_LOWER|CCI|WILLR|ATR|MOM|ROC|ADX|PLUS_DI|MINUS_DI|SUPERTREND|DONCHIAN_UPPER|DONCHIAN_MIDDLE|DONCHIAN_LOWER|KELTNER_UPPER|KELTNER_LOWER|TENKAN|KIJUN|SENKOU_A|SENKOU_B)\(([^()]*)\)(?!@)|\b(PSAR|PIVOT|PIVOT_R1|PIVOT_S1|KELTNER_UPPER|KELTNER_LOWER)\b(?![(@])/g;
    for (const k of ['longEntry', 'longExit', 'shortEntry', 'shortExit']) {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(rules[k] || ''))) {
        if (m[3]) { if (!seen.includes(m[3])) seen.push(m[3]); continue; }
        const s = m[1] + '(' + m[2].replace(/\s+/g, '') + ')';
        if (!seen.includes(s)) seen.push(s);
        if (/^BB_/.test(m[1])) for (const b of ['BB_UPPER', 'BB_MIDDLE', 'BB_LOWER']) { const x = b + '(' + m[2].replace(/\s+/g, '') + ')'; if (!seen.includes(x)) seen.push(x); }
        if (m[1] === 'MACD') { const x = 'MACD_SIGNAL(' + m[2].replace(/\s+/g, '') + ')'; if (!seen.includes(x)) seen.push(x); }
      }
    }
    return seen.slice(0, 6).join(', ');
  }

  // ---------- Stratégie aléatoire ----------
  function pick(arr, rnd) { return arr[Math.floor(rnd() * arr.length)]; }

  const SIGNALS = [
    { tag: 'RSI', make: (r) => { const p = pick([7, 9, 14, 21], r), lo = pick([20, 25, 30, 35], r);
      return { long: 'le RSI ' + p + ' passe au-dessus de ' + lo, short: 'le RSI ' + p + ' passe en dessous de ' + (100 - lo),
        exitLong: 'le RSI ' + p + ' dépasse ' + pick([60, 65, 70, 75], r), rsiP: p }; } },
    { tag: 'MACD', make: (r) => { const [f, s, g] = pick([[12, 26, 9], [8, 21, 5], [5, 35, 5], [10, 30, 7]], r);
      return { long: 'le MACD (' + f + ',' + s + ',' + g + ') croise sa ligne de signal à la hausse',
        short: 'le MACD (' + f + ',' + s + ',' + g + ') croise sa ligne de signal à la baisse' }; } },
    { tag: 'croisement de moyennes', make: (r) => { const [a, b] = pick([[5, 20], [9, 21], [10, 30], [20, 50], [50, 100], [20, 100]], r);
      const t = pick(['', ' exponentielle'], r);
      return { long: 'la moyenne mobile' + t + ' ' + a + ' passe au-dessus de la moyenne mobile' + t + ' ' + b,
        short: 'la moyenne mobile' + t + ' ' + a + ' passe en dessous de la moyenne mobile' + t + ' ' + b }; } },
    { tag: 'prix / moyenne', make: (r) => { const n = pick([20, 30, 50, 100], r), t = pick(['', ' exponentielle'], r);
      return { long: 'le prix passe au-dessus de la moyenne mobile' + t + ' ' + n, short: 'le prix passe en dessous de la moyenne mobile' + t + ' ' + n }; } },
    { tag: 'stochastique', make: (r) => { const k = pick([5, 9, 14], r), lo = pick([15, 20, 25], r);
      return { long: 'le stochastique (' + k + ',3,3) passe au-dessus de ' + lo, short: 'le stochastique (' + k + ',3,3) passe en dessous de ' + (100 - lo),
        exitLong: 'le stochastique (' + k + ',3,3) dépasse ' + pick([70, 80], r) }; } },
    { tag: 'Bollinger', make: () => ({ long: 'le prix passe sous la bande de Bollinger basse', short: 'le prix passe au-dessus de la bande de Bollinger haute',
      exitLong: 'le prix passe au-dessus de la bande médiane de Bollinger' }) },
    { tag: 'CCI', make: (r) => { const p = pick([14, 20], r);
      return { long: 'le CCI ' + p + ' passe au-dessus de -100', short: 'le CCI ' + p + ' passe en dessous de 100' }; } },
  ];
  const FILTERS = [
    { tag: 'tendance', make: (r) => { const n = pick([100, 200], r), t = pick(['', ' exponentielle'], r);
      return { long: 'le prix est au-dessus de la moyenne mobile' + t + ' ' + n, short: 'le prix est en dessous de la moyenne mobile' + t + ' ' + n }; } },
    { tag: 'filtre RSI', make: () => ({ long: 'le RSI 14 est au-dessus de 50', short: 'le RSI 14 est en dessous de 50' }) },
    { tag: 'filtre MACD', make: () => ({ long: "l'histogramme du MACD est positif", short: "l'histogramme du MACD est négatif" }) },
  ];

  function randomStrategy(rnd) {
    rnd = rnd || Math.random;
    const sigDef = pick(SIGNALS, rnd);
    const sig = sigDef.make(rnd);
    let filt = null, filtDef = null;
    if (rnd() < 0.5) {
      const choices = FILTERS.filter((f) => !(f.tag === 'filtre RSI' && sigDef.tag === 'RSI') && !(f.tag === 'filtre MACD' && sigDef.tag === 'MACD'));
      filtDef = pick(choices, rnd); filt = filtDef.make(rnd);
    }
    const sides = rnd() < 0.7 ? 'both' : rnd() < 0.5 ? 'long' : 'short';
    const lines = [];
    const join = (a, b) => a + (b ? ' et que ' + b : '');
    if (sides !== 'short') lines.push('Acheter quand ' + join(sig.long, filt && filt.long) + '.');
    if (sides === 'both') lines.push('Vendre dans le cas inverse.');
    if (sides === 'short') lines.push('Vendre quand ' + join(sig.short, filt && filt.short) + '.');
    if (sig.exitLong && rnd() < 0.6) {
      if (sides !== 'short') lines.push("Sortir de l'achat quand " + sig.exitLong + '.');
      if (sides === 'both') lines.push('Sortir de la vente dans le cas inverse.');
    }
    const sl = pick([0, 30, 50, 80, 100, 150], rnd);
    const tp = sl ? pick([0, Math.round(sl * 1.5), sl * 2, sl * 3], rnd) : pick([0, 0, 100, 200], rnd);
    const risk = [];
    if (sl) risk.push('stop loss ' + sl + ' pips');
    if (tp) risk.push('take profit ' + tp + ' pips');
    if (risk.length) lines.push(risk[0][0].toUpperCase() + risk.join(', ').slice(1) + '.');
    const text = lines.join('\n');
    const rules = parse(text);
    const name = 'Aléatoire · ' + sigDef.tag + (filtDef ? ' + ' + filtDef.tag : '') + (sides === 'long' ? ' (achat seul)' : sides === 'short' ? ' (vente seule)' : '') + ' #' + Math.floor(rnd() * 9000 + 1000);
    return Object.assign({ name: name, frenchText: text, description: 'Stratégie tirée au hasard. Si elle vous plaît, cliquez sur « Enregistrer ».' }, rules);
  }

  // ---------- Règles techniques -> français ----------
  const R = () => root.Forexia.rules;
  const PAT_FR = { BULL_ENGULF: 'une englobante haussière', BEAR_ENGULF: 'une englobante baissière', HAMMER: 'un marteau', SHOOTING_STAR: 'une étoile filante' };
  const SIMPLE_FR = { PSAR: 'le SAR parabolique', PIVOT: 'le point pivot', PIVOT_R1: 'la résistance 1', PIVOT_S1: 'le support 1', PIVOT_R2: 'la résistance 2', PIVOT_S2: 'le support 2',
    HA_CLOSE: 'la clôture Heikin Ashi', KELTNER_UPPER: 'le canal de Keltner haut', KELTNER_LOWER: 'le canal de Keltner bas' };
  const TF_FR = { D1: 'journalier', W1: 'hebdomadaire', MN: 'mensuel' };
  function opFr(n) {
    if (n.k === 'tf') return opFr(n.a) + ' en ' + (TF_FR[n.tf] || n.tf);
    if (n.k === 'num') return String(n.v);
    if (n.k === 'series' && PAT_FR[n.name]) return PAT_FR[n.name];
    if (n.k === 'call' && PAT_FR[n.name] && !n.args.length) return PAT_FR[n.name];
    if ((n.k === 'series' || (n.k === 'call' && !n.args.length)) && SIMPLE_FR[n.name]) return SIMPLE_FR[n.name];
    if (n.k === 'call' && n.name === 'SLOPE' && n.args.length === 2 && n.args[1].k === 'num' && n.args[1].v === 5 && n.args[0].k === 'call' && /^(SMA|EMA)$/.test(n.args[0].name)) return 'la pente de ' + opFr(n.args[0]);
    if (n.k === 'call' && /^(BULL|BEAR)_DIV$/.test(n.name) && n.args.length === 2 && n.args[0].k === 'call' && n.args[0].name === 'RSI' && n.args[1].v === 14) {
      return 'une divergence ' + (n.name === 'BULL_DIV' ? 'haussière' : 'baissière') + ' du RSI ' + (n.args[0].args.length ? n.args[0].args[0].v : 14);
    }
    if (n.k === 'neg' && n.a.k === 'num') return String(-n.a.v);
    if (n.k === 'series' && (n.name === 'CLOSE' || n.name === 'PRICE')) return 'le prix';
    if (n.k !== 'call' || n.args.some((a) => a.k !== 'num')) throw new Error('non traduisible');
    const a = n.args.map((x) => x.v);
    const p = (d) => (a[0] !== undefined ? a[0] : d);
    switch (n.name) {
      case 'RSI': return 'le RSI ' + p(14);
      case 'SMA': return 'la moyenne mobile ' + p(20);
      case 'EMA': return 'la moyenne mobile exponentielle ' + p(20);
      case 'MACD': return 'le MACD (' + (a.length ? a : [12, 26, 9]).join(',') + ')';
      case 'MACD_SIGNAL': return 'sa ligne de signal';
      case 'MACD_HIST': return "l'histogramme du MACD (" + (a.length ? a : [12, 26, 9]).join(',') + ')';
      case 'STOCH_K': return 'le stochastique (' + (a.length ? a : [14, 3, 3]).join(',') + ')';
      case 'STOCH_D': return 'sa ligne %D';
      case 'BB_UPPER': return 'la bande de Bollinger haute (' + (a.length ? a : [20, 2]).join(',') + ')';
      case 'BB_LOWER': return 'la bande de Bollinger basse (' + (a.length ? a : [20, 2]).join(',') + ')';
      case 'BB_MIDDLE': return 'la bande médiane de Bollinger (' + (a.length ? a : [20, 2]).join(',') + ')';
      case 'CCI': return 'le CCI ' + p(20);
      case 'WILLR': return 'le Williams %R ' + p(14);
      case 'ATR': return "l'ATR " + p(14);
      case 'MOM': return 'le momentum ' + p(10);
      case 'ADX': return "l'ADX " + p(14);
      case 'PLUS_DI': return 'le +DI ' + p(14);
      case 'MINUS_DI': return 'le -DI ' + p(14);
      case 'SUPERTREND': return 'le SuperTrend (' + (a.length ? a : [10, 3]).join(',') + ')';
      case 'DONCHIAN_UPPER': return 'le Donchian haut ' + p(20);
      case 'DONCHIAN_LOWER': return 'le Donchian bas ' + p(20);
      case 'DONCHIAN_MIDDLE': return 'le Donchian médian ' + p(20);
      case 'TENKAN': return 'la Tenkan ' + p(9);
      case 'KIJUN': return 'la Kijun ' + p(26);
      case 'PSAR': if (!a.length) return 'le SAR parabolique'; break;
      case 'KELTNER_UPPER': if (!a.length) return 'le canal de Keltner haut'; break;
      case 'KELTNER_LOWER': if (!a.length) return 'le canal de Keltner bas'; break;
    }
    throw new Error('non traduisible');
  }
  const isNum = (n) => n.k === 'num' || (n.k === 'neg' && n.a.k === 'num');
  function clauseFr(n) {
    const S = R().stringify;
    if (n.k === 'call' && (n.name === 'CROSS_UP' || n.name === 'CROSS_DOWN') && n.args.length === 2) {
      let [x, y] = n.args, up = n.name === 'CROSS_UP';
      if (isNum(x) && !isNum(y)) { [x, y] = [y, x]; up = !up; }
      return opFr(x) + (up ? ' passe au-dessus de ' : ' passe en dessous de ') + opFr(y);
    }
    if (n.k === 'bin' && (n.op === '>' || n.op === '<' || n.op === '==')) {
      let x = n.a, y = n.b, op = n.op;
      if (y.k === 'call' && y.name === 'PREV' && y.args.length === 2 && y.args[1].v === 1 && S(y.args[0]) === S(x) && op !== '==') {
        return opFr(x) + (op === '>' ? ' monte' : ' descend');
      }
      if (isNum(x) && !isNum(y)) { [x, y] = [y, x]; op = { '>': '<', '<': '>', '==': '==' }[op]; }
      const patName = x.k === 'call' ? x.name : x.k === 'series' ? x.name : '';
      if (op === '>' && y.k === 'num' && y.v === 0 && (PAT_FR[patName] || /^(BULL|BEAR)_DIV$/.test(patName))) return opFr(x) + ' apparaît';
      if (x.k === 'call' && x.name === 'SLOPE' && y.k === 'num' && y.v === 0 && op !== '==') return opFr(x) + (op === '>' ? ' est positive' : ' est négative');
      return opFr(x) + (op === '>' ? ' est au-dessus de ' : op === '<' ? ' est en dessous de ' : ' vaut ') + opFr(y);
    }
    throw new Error('non traduisible');
  }
  function splitBin(n, op) { return n.k === 'bin' && n.op === op ? splitBin(n.a, op).concat(splitBin(n.b, op)) : [n]; }
  function conditionFr(rule) {
    return splitBin(R().parse(rule), 'OR').map((g) => splitBin(g, 'AND').map(clauseFr).join(' et que ')).join(' ou que ')
      .replace(/\bde le /g, 'du ').replace(/\bà le /g, 'au ');
  }

  /** Décrit une stratégie en français. Renvoie null si le texte ne redonne pas exactement les mêmes règles. */
  function toFrench(strategy) {
    const lines = [];
    const PREFIX = { longEntry: 'Acheter quand ', shortEntry: 'Vendre quand ', longExit: "Sortir de l'achat quand ", shortExit: 'Sortir de la vente quand ' };
    try {
      for (const k of ['longEntry', 'shortEntry', 'longExit', 'shortExit']) if (strategy[k]) lines.push(PREFIX[k] + conditionFr(strategy[k]) + '.');
    } catch (e) { return null; }
    const risk = [];
    if (strategy.stopLossPips > 0) risk.push('stop loss ' + strategy.stopLossPips + ' pips');
    if (strategy.takeProfitPips > 0) risk.push('take profit ' + strategy.takeProfitPips + ' pips');
    const fr = (v) => String(v).replace('.', ',');
    const atr = ' ATR' + (strategy.atrPeriod && strategy.atrPeriod !== 14 ? ' ' + strategy.atrPeriod : '');
    if (strategy.stopAtr > 0) risk.push('stop loss ' + fr(strategy.stopAtr) + atr);
    if (strategy.takeAtr > 0) risk.push('take profit ' + fr(strategy.takeAtr) + atr);
    if (strategy.trailAtr > 0) risk.push('stop suiveur ' + fr(strategy.trailAtr) + atr); else if (strategy.trailPips > 0) risk.push('stop suiveur ' + strategy.trailPips + ' pips');
    if (strategy.breakevenAtr > 0) risk.push('stop au prix d\'entrée après ' + fr(strategy.breakevenAtr) + atr); else if (strategy.breakevenPips > 0) risk.push('stop au prix d\'entrée après ' + strategy.breakevenPips + ' pips');
    if (strategy.maxBars > 0) risk.push('fermer après ' + strategy.maxBars + ' bougies');
    if (strategy.pauseLosses > 0 && strategy.pauseBars > 0) risk.push('pause de ' + strategy.pauseBars + ' bougies après ' + strategy.pauseLosses + ' pertes de suite');
    if (risk.length) lines.push(risk[0][0].toUpperCase() + risk.join(', ').slice(1) + '.');
    const text = lines.join('\n');
    const back = parse(text);
    if (back.warnings.length) return null;
    for (const k of ['longEntry', 'shortEntry', 'longExit', 'shortExit']) if (R().canonical(back[k]) !== R().canonical(strategy[k] || '')) return null;
    if ((back.stopLossPips || 0) !== (strategy.stopLossPips || 0) || (back.takeProfitPips || 0) !== (strategy.takeProfitPips || 0)) return null;
    const usesAtr = ['stopAtr', 'takeAtr', 'trailAtr', 'breakevenAtr'].some((k) => strategy[k] > 0);
    for (const k of ['stopAtr', 'takeAtr', 'trailPips', 'trailAtr', 'breakevenPips', 'breakevenAtr', 'maxBars']) if ((back[k] || 0) !== (strategy[k] || 0)) return null;
    if (strategy.pauseLosses > 0 && strategy.pauseBars > 0 && (back.pauseLosses !== strategy.pauseLosses || back.pauseBars !== strategy.pauseBars)) return null;
    if (usesAtr && (back.atrPeriod || 14) !== (strategy.atrPeriod || 14)) return null;
    return text;
  }

  root.Forexia = root.Forexia || {};
  root.Forexia.french = { parse, randomStrategy, derivePlots, normalize, toFrench };
})(typeof window !== 'undefined' ? window : globalThis);
