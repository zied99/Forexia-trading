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

  const PERIOD = '(?:\\s*\\(?\\s*(?:sur\\s+|de\\s+)?(\\d+)\\s*\\)?(?:\\s*(?:periodes?|jours|bougies|seances))?)?';
  const MENTIONS = [
    { re: /(?:le\s+)?(?:%d|stoch\w*\s+%?d\b|ligne\s+%?d\b|signal\s+du\s+stoch\w*)/g, make: () => ind('STOCH_D', stochCtx.slice(), 'STOCH') },
    { re: /histogramme(?:\s+du)?(?:\s+macd)?/g, make: () => ind('MACD_HIST', macdCtx.slice(), 'MACD') },
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
    { re: /(?:la\s+)?(?:bande\s+(?:de\s+)?bollinger\s+(?:haute|superieure|du haut)|bande\s+(?:haute|superieure)(?:\s+de\s+bollinger)?|bollinger\s+(?:haute|superieure|haut))/g, make: () => ind('BB_UPPER', [20, 2], 'BB') },
    { re: /(?:la\s+)?(?:bande\s+(?:de\s+)?bollinger\s+(?:basse|inferieure|du bas)|bande\s+(?:basse|inferieure)(?:\s+de\s+bollinger)?|bollinger\s+(?:basse|inferieure|bas))/g, make: () => ind('BB_LOWER', [20, 2], 'BB') },
    { re: /(?:la\s+)?(?:(?:bande|ligne|moyenne)\s+(?:mediane|centrale|du milieu)(?:\s+de\s+bollinger)?|moyenne\s+de\s+bollinger|bollinger\s+(?:mediane|centrale|milieu))/g, make: () => ind('BB_MIDDLE', [20, 2], 'BB') },
    { re: new RegExp('(?:la\\s+)?(?:moyenne\\s+mobile\\s+exponentielle|mm\\s+exponentielle|mme|ema)' + PERIOD, 'g'), make: (m) => ind('EMA', [toInt(m[1], 20)], 'PRICE') },
    { re: new RegExp('(?:la\\s+)?(?:moyenne\\s+mobile(?:\\s+simple|\\s+arithmetique)?|mms|mm|sma|ma(?=\\s*\\(?\\d))' + PERIOD, 'g'), make: (m) => ind('SMA', [toInt(m[1], 20)], 'PRICE') },
    { re: /cci(?:\s*\(?\s*(\d+)\s*\)?)?/g, make: (m) => ind('CCI', remember('CCI', m[1], 20)) },
    { re: /williams(?:\s*%?\s*r)?(?:\s*\(?\s*(\d+)\s*\)?)?/g, make: (m) => ind('WILLR', remember('WILLR', m[1], 14)) },
    { re: /atr(?:\s*\(?\s*(\d+)\s*\)?)?/g, make: (m) => ind('ATR', remember('ATR', m[1], 14)) },
    { re: /momentum(?:\s*\(?\s*(\d+)\s*\)?)?/g, make: (m) => ind('MOM', remember('MOM', m[1], 10)) },
    { re: /\b(?:le\s+|la\s+)?(?:prix|cours|cloture|close|bougie|paire)\b/g, make: () => ind('CLOSE', null, 'PRICE') },
  ];

  function findMentions(clause) {
    let masked = clause;
    const found = [];
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
    return { ops: found.map((f) => f.op), masked: masked };
  }

  function renderOp(o) {
    if (o.num !== undefined) return String(o.num);
    if (!o.args) return o.ind;
    return o.ind + '(' + o.args.join(',') + ')';
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
  function mirrorOp(o, fam) {
    if (o.num !== undefined) return { num: mirrorNum(o.num, fam) };
    if (o.ind === 'BB_UPPER') return ind('BB_LOWER', o.args, 'BB');
    if (o.ind === 'BB_LOWER') return ind('BB_UPPER', o.args, 'BB');
    return o;
  }
  function mirrorClause(c) {
    const fam = c.a.fam;
    switch (c.kind) {
      case 'cross': return { kind: 'cross', dir: -c.dir, a: mirrorOp(c.a, fam), b: mirrorOp(c.b, fam) };
      case 'cmp': return { kind: 'cmp', op: { '>': '<', '<': '>', '==': '==' }[c.op], a: mirrorOp(c.a, fam), b: mirrorOp(c.b, fam) };
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
    if (!out.longEntry && !out.shortEntry) out.warnings.push('Aucune règle d\'entrée trouvée. Commencez une phrase par « Acheter quand… » ou « Vendre quand… ».');
    out.plots = derivePlots(out);
    return out;
  }
  const LABELS = { longEntry: 'Entrée achat', longExit: 'Sortie achat', shortEntry: 'Entrée vente', shortExit: 'Sortie vente' };

  // ---------- Indicateurs à tracer ----------
  function derivePlots(rules) {
    const seen = [];
    const re = /\b(SMA|EMA|RSI|MACD_SIGNAL|MACD_HIST|MACD|STOCH_K|STOCH_D|BB_UPPER|BB_MIDDLE|BB_LOWER|CCI|WILLR|ATR|MOM|ROC)\(([^()]*)\)/g;
    for (const k of ['longEntry', 'longExit', 'shortEntry', 'shortExit']) {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(rules[k] || ''))) {
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

  root.Forexia = root.Forexia || {};
  root.Forexia.french = { parse, randomStrategy, derivePlots, normalize };
})(typeof window !== 'undefined' ? window : globalThis);
