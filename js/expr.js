/* Forexia — mini-langage de règles de trading.
 *
 * Exemples :
 *   RSI(14) < 30
 *   CROSS_UP(SMA(20), SMA(50)) AND CLOSE > EMA(200)
 *   MACD_HIST(12,26,9) > 0 OR STOCH_K(14,3,3) < 20
 *
 * Une règle est évaluée sur toutes les barres et produit une série de 0/1. */
(function (root) {
  'use strict';
  const I = root.Forexia.indicators;

  class RuleError extends Error {}

  // ---------- Analyse lexicale ----------
  function tokenize(src) {
    const tokens = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++;
        const text = src.slice(i, j), v = Number(text);
        if (!Number.isFinite(v)) throw new RuleError('Nombre invalide : « ' + text + ' »');
        tokens.push({ t: 'num', v: v, pos: i }); i = j; continue;
      }
      if (/[A-Za-z_%]/.test(c)) {
        let j = i; while (j < src.length && /[A-Za-z0-9_%]/.test(src[j])) j++;
        const word = src.slice(i, j).toUpperCase();
        if (word === 'AND' || word === 'ET') tokens.push({ t: 'op', v: 'AND', pos: i });
        else if (word === 'OR' || word === 'OU') tokens.push({ t: 'op', v: 'OR', pos: i });
        else if (word === 'NOT' || word === 'NON') tokens.push({ t: 'op', v: 'NOT', pos: i });
        else tokens.push({ t: 'id', v: word, pos: i });
        i = j; continue;
      }
      const two = src.slice(i, i + 2);
      if (['>=', '<=', '==', '!=', '&&', '||'].includes(two)) {
        tokens.push({ t: 'op', v: two === '&&' ? 'AND' : two === '||' ? 'OR' : two, pos: i }); i += 2; continue;
      }
      if ('<>+-*/=!'.includes(c)) { tokens.push({ t: 'op', v: c === '=' ? '==' : c === '!' ? 'NOT' : c, pos: i }); i++; continue; }
      if (c === '(' || c === ')' || c === ',') { tokens.push({ t: c, pos: i }); i++; continue; }
      throw new RuleError('Caractère inattendu « ' + c + ' » (position ' + (i + 1) + ')');
    }
    tokens.push({ t: 'eof', pos: src.length });
    return tokens;
  }

  // ---------- Analyse syntaxique (descente récursive) ----------
  function parse(src) {
    const tk = tokenize(src);
    let p = 0;
    const peek = () => tk[p];
    const isOp = (v) => peek().t === 'op' && peek().v === v;
    function expect(t) {
      if (peek().t !== t) throw new RuleError('« ' + t + ' » attendu (position ' + (peek().pos + 1) + ')');
      return tk[p++];
    }
    function orExpr() {
      let left = andExpr();
      while (isOp('OR')) { p++; left = { k: 'bin', op: 'OR', a: left, b: andExpr() }; }
      return left;
    }
    function andExpr() {
      let left = notExpr();
      while (isOp('AND')) { p++; left = { k: 'bin', op: 'AND', a: left, b: notExpr() }; }
      return left;
    }
    function notExpr() {
      if (isOp('NOT')) { p++; return { k: 'not', a: notExpr() }; }
      return cmpExpr();
    }
    function cmpExpr() {
      const left = addExpr();
      const t = peek();
      if (t.t === 'op' && ['>', '<', '>=', '<=', '==', '!='].includes(t.v)) { p++; return { k: 'bin', op: t.v, a: left, b: addExpr() }; }
      return left;
    }
    function addExpr() {
      let left = mulExpr();
      while (isOp('+') || isOp('-')) { const op = tk[p++].v; left = { k: 'bin', op: op, a: left, b: mulExpr() }; }
      return left;
    }
    function mulExpr() {
      let left = unary();
      while (isOp('*') || isOp('/')) { const op = tk[p++].v; left = { k: 'bin', op: op, a: left, b: unary() }; }
      return left;
    }
    function unary() {
      if (isOp('-')) { p++; return { k: 'neg', a: unary() }; }
      if (isOp('+')) { p++; return unary(); }
      return primary();
    }
    function primary() {
      const t = peek();
      if (t.t === 'num') { p++; return { k: 'num', v: t.v }; }
      if (t.t === '(') { p++; const e = orExpr(); expect(')'); return e; }
      if (t.t === 'id') {
        p++;
        const name = ALIASES[t.v] || t.v;
        if (peek().t === '(') {
          p++;
          const args = [];
          if (peek().t !== ')') {
            args.push(orExpr());
            while (peek().t === ',') { p++; args.push(orExpr()); }
          }
          expect(')');
          if (!FUNCS[name]) throw new RuleError('Fonction inconnue : ' + t.v);
          return { k: 'call', name: name, args: args };
        }
        if (SERIES[name]) return { k: 'series', name: name };
        if (FUNCS[name]) return { k: 'call', name: name, args: [] }; // ex. « RSI » seul = RSI(14)
        throw new RuleError('Identifiant inconnu : ' + t.v);
      }
      if (t.t === 'eof') throw new RuleError('Règle incomplète');
      throw new RuleError('Élément inattendu (position ' + (t.pos + 1) + ')');
    }
    const ast = orExpr();
    if (peek().t !== 'eof') throw new RuleError('Élément en trop (position ' + (peek().pos + 1) + ')');
    return ast;
  }

  // ---------- Évaluation ----------
  const SERIES = { CLOSE: 'close', OPEN: 'open', HIGH: 'high', LOW: 'low', PRICE: 'close' };
  const ALIASES = {
    MA: 'SMA', MM: 'SMA', MME: 'EMA', CROSSOVER: 'CROSS_UP', CROSSUNDER: 'CROSS_DOWN', CROSS_ABOVE: 'CROSS_UP',
    CROSS_BELOW: 'CROSS_DOWN', CROISE_HAUSSE: 'CROSS_UP', CROISE_BAISSE: 'CROSS_DOWN', MACD_LINE: 'MACD',
    STOCH: 'STOCH_K', BB_MID: 'BB_MIDDLE', WILLIAMS: 'WILLR', WPR: 'WILLR', PRIX: 'PRICE',
  };

  function isSeries(v) { return Array.isArray(v); }
  function constArg(args, idx, def, fname) {
    const v = args[idx];
    if (v === undefined) return def;
    if (isSeries(v)) throw new RuleError(fname + ' : le paramètre ' + (idx + 1) + ' doit être un nombre');
    if (!(v > 0)) throw new RuleError(fname + ' : le paramètre ' + (idx + 1) + ' doit être positif');
    return v;
  }
  function period(v, fname) {
    if (!Number.isInteger(v) || v < 1 || v > 1000) throw new RuleError(fname + ' : période invalide (' + v + ')');
    return v;
  }
  // SMA(20) ou SMA(RSI(14), 9) : une série en 1er argument sert de source.
  function srcAndPeriod(ctx, args, def, fname) {
    if (args.length && isSeries(args[0])) return [args[0], period(constArg(args, 1, def, fname), fname)];
    return [ctx.close, period(constArg(args, 0, def, fname), fname)];
  }

  const FUNCS = {
    SMA: (c, a) => { const [s, n] = srcAndPeriod(c, a, 20, 'SMA'); return I.sma(s, n); },
    EMA: (c, a) => { const [s, n] = srcAndPeriod(c, a, 20, 'EMA'); return I.ema(s, n); },
    RSI: (c, a) => { const [s, n] = srcAndPeriod(c, a, 14, 'RSI'); return I.rsi(s, n); },
    MOM: (c, a) => { const [s, n] = srcAndPeriod(c, a, 10, 'MOM'); return I.momentum(s, n); },
    ROC: (c, a) => { const [s, n] = srcAndPeriod(c, a, 10, 'ROC'); return I.roc(s, n); },
    MACD: (c, a) => macdOf(c, a, 'macd'),
    MACD_SIGNAL: (c, a) => macdOf(c, a, 'signal'),
    MACD_HIST: (c, a) => macdOf(c, a, 'hist'),
    STOCH_K: (c, a) => stochOf(c, a, 'k'),
    STOCH_D: (c, a) => stochOf(c, a, 'd'),
    BB_UPPER: (c, a) => bbOf(c, a, 'upper'),
    BB_MIDDLE: (c, a) => bbOf(c, a, 'middle'),
    BB_LOWER: (c, a) => bbOf(c, a, 'lower'),
    ATR: (c, a) => I.atr(c.high, c.low, c.close, period(constArg(a, 0, 14, 'ATR'), 'ATR')),
    CCI: (c, a) => I.cci(c.high, c.low, c.close, period(constArg(a, 0, 20, 'CCI'), 'CCI')),
    WILLR: (c, a) => I.williamsR(c.high, c.low, c.close, period(constArg(a, 0, 14, 'WILLR'), 'WILLR')),
    HIGHEST: (c, a) => { const [s, n] = srcAndPeriod(c, a, 20, 'HIGHEST'); return I.highest(s, n); },
    LOWEST: (c, a) => { const [s, n] = srcAndPeriod(c, a, 20, 'LOWEST'); return I.lowest(s, n); },
    PREV: (c, a) => {
      if (!a.length) throw new RuleError('PREV(x, n) : série manquante');
      const s = toSeries(c, a[0]), n = period(constArg(a, 1, 1, 'PREV'), 'PREV'), out = new Array(c.n).fill(NaN);
      for (let i = n; i < c.n; i++) out[i] = s[i - n];
      return out;
    },
    CROSS_UP: (c, a) => crossOf(c, a, 1, 'CROSS_UP'),
    CROSS_DOWN: (c, a) => crossOf(c, a, -1, 'CROSS_DOWN'),
  };

  function macdOf(c, a, key) {
    const f = period(constArg(a, 0, 12, 'MACD'), 'MACD'), s = period(constArg(a, 1, 26, 'MACD'), 'MACD');
    const g = period(constArg(a, 2, 9, 'MACD'), 'MACD');
    return c.cached('MACD:' + f + ':' + s + ':' + g, () => I.macd(c.close, f, s, g))[key];
  }
  function stochOf(c, a, key) {
    const k = period(constArg(a, 0, 14, 'STOCH'), 'STOCH'), d = period(constArg(a, 1, 3, 'STOCH'), 'STOCH');
    const sm = period(constArg(a, 2, 3, 'STOCH'), 'STOCH');
    return c.cached('STOCH:' + k + ':' + d + ':' + sm, () => I.stochastic(c.high, c.low, c.close, k, d, sm))[key];
  }
  function bbOf(c, a, key) {
    const n = period(constArg(a, 0, 20, 'BB'), 'BB'), m = constArg(a, 1, 2, 'BB');
    return c.cached('BB:' + n + ':' + m, () => I.bollinger(c.close, n, m))[key];
  }
  function crossOf(c, a, dir, fname) {
    if (a.length !== 2) throw new RuleError(fname + '(a, b) attend 2 arguments');
    const x = toSeries(c, a[0]), y = toSeries(c, a[1]), out = new Array(c.n).fill(0);
    for (let i = 1; i < c.n; i++) {
      if (![x[i], y[i], x[i - 1], y[i - 1]].every(Number.isFinite)) continue;
      out[i] = dir > 0 ? (x[i] > y[i] && x[i - 1] <= y[i - 1] ? 1 : 0) : (x[i] < y[i] && x[i - 1] >= y[i - 1] ? 1 : 0);
    }
    return out;
  }
  function toSeries(c, v) { return isSeries(v) ? v : new Array(c.n).fill(v); }

  function truthy(v) { return Number.isFinite(v) && v !== 0; }
  function binary(op, x, y) {
    switch (op) {
      case '+': return x + y;
      case '-': return x - y;
      case '*': return x * y;
      case '/': return y === 0 ? NaN : x / y;
      case '>': return Number.isFinite(x) && Number.isFinite(y) ? (x > y ? 1 : 0) : 0;
      case '<': return Number.isFinite(x) && Number.isFinite(y) ? (x < y ? 1 : 0) : 0;
      case '>=': return Number.isFinite(x) && Number.isFinite(y) ? (x >= y ? 1 : 0) : 0;
      case '<=': return Number.isFinite(x) && Number.isFinite(y) ? (x <= y ? 1 : 0) : 0;
      case '==': return Number.isFinite(x) && Number.isFinite(y) ? (Math.abs(x - y) < 1e-12 ? 1 : 0) : 0;
      case '!=': return Number.isFinite(x) && Number.isFinite(y) ? (Math.abs(x - y) >= 1e-12 ? 1 : 0) : 0;
      case 'AND': return truthy(x) && truthy(y) ? 1 : 0;
      case 'OR': return truthy(x) || truthy(y) ? 1 : 0;
    }
    throw new RuleError('Opérateur inconnu ' + op);
  }

  function evalNode(node, ctx) {
    switch (node.k) {
      case 'num': return node.v;
      case 'series': return ctx[SERIES[node.name]];
      case 'neg': { const v = evalNode(node.a, ctx); return isSeries(v) ? v.map((x) => -x) : -v; }
      case 'not': { const v = evalNode(node.a, ctx); return isSeries(v) ? v.map((x) => (truthy(x) ? 0 : 1)) : truthy(v) ? 0 : 1; }
      case 'bin': {
        const x = evalNode(node.a, ctx), y = evalNode(node.b, ctx);
        if (!isSeries(x) && !isSeries(y)) return binary(node.op, x, y);
        const out = new Array(ctx.n);
        for (let i = 0; i < ctx.n; i++) out[i] = binary(node.op, isSeries(x) ? x[i] : x, isSeries(y) ? y[i] : y);
        return out;
      }
      case 'call': {
        const args = node.args.map((a) => evalNode(a, ctx));
        const key = node.name + '(' + args.map((a) => (isSeries(a) ? '#' + ctx.idOf(a) : a)).join(',') + ')';
        return ctx.cached(key, () => FUNCS[node.name](ctx, args));
      }
    }
    throw new RuleError('Nœud inconnu');
  }

  function makeContext(bars) {
    const cache = new Map(), ids = new Map();
    const ctx = {
      n: bars.length,
      open: bars.map((b) => b.open), high: bars.map((b) => b.high),
      low: bars.map((b) => b.low), close: bars.map((b) => b.close),
      cached(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); },
      idOf(arr) { if (!ids.has(arr)) ids.set(arr, ids.size); return ids.get(arr); },
    };
    return ctx;
  }

  /** Évalue une règle textuelle ; renvoie un tableau de booléens (vide => jamais vrai). */
  function evaluateRule(text, ctx) {
    if (!text || !text.trim()) return new Array(ctx.n).fill(false);
    const v = evalNode(parse(text), ctx);
    return isSeries(v) ? v.map(truthy) : new Array(ctx.n).fill(truthy(v));
  }

  /** Évalue une expression numérique (pour tracer un indicateur). */
  function evaluateSeries(text, ctx) {
    const v = evalNode(parse(text), ctx);
    return isSeries(v) ? v : new Array(ctx.n).fill(v);
  }

  /** Vérifie la syntaxe sans données ; renvoie null ou le message d'erreur. */
  function validate(text) {
    if (!text || !text.trim()) return null;
    try {
      const fake = [];
      for (let i = 0; i < 5; i++) fake.push({ open: 1, high: 1, low: 1, close: 1 });
      evalNode(parse(text), makeContext(fake));
      return null;
    } catch (e) { return e.message; }
  }

  // ---------- Réécriture : arbre -> texte ----------
  const PREC = { OR: 1, AND: 2, '>': 4, '<': 4, '>=': 4, '<=': 4, '==': 4, '!=': 4, '+': 5, '-': 5, '*': 6, '/': 6 };
  const SPACED_ARGS = { CROSS_UP: 1, CROSS_DOWN: 1, PREV: 1 };
  function stringify(node, parentPrec, isRight) {
    parentPrec = parentPrec || 0;
    switch (node.k) {
      case 'num': return String(node.v);
      case 'series': return node.name === 'PRICE' ? 'CLOSE' : node.name;
      case 'neg': return '-' + stringify(node.a, 7);
      case 'not': { const t = 'NOT ' + stringify(node.a, 3); return parentPrec > 3 ? '(' + t + ')' : t; }
      case 'call': {
        const spaced = SPACED_ARGS[node.name] || (node.args[0] && node.args[0].k !== 'num');
        return node.name + '(' + node.args.map((x) => stringify(x, 0)).join(spaced ? ', ' : ',') + ')';
      }
      case 'bin': {
        const p = PREC[node.op];
        const t = stringify(node.a, p) + ' ' + node.op + ' ' + stringify(node.b, p + (p >= 4 ? 1 : 0), true);
        return parentPrec > p || (isRight && parentPrec === p && p >= 4) ? '(' + t + ')' : t;
      }
    }
    throw new RuleError('Nœud inconnu');
  }
  /** Applique fn à chaque nœud (de bas en haut) ; fn renvoie un nœud de remplacement ou undefined. */
  function mapNodes(node, fn) {
    let n = node;
    if (node.k === 'bin') n = Object.assign({}, node, { a: mapNodes(node.a, fn), b: mapNodes(node.b, fn) });
    else if (node.k === 'neg' || node.k === 'not') n = Object.assign({}, node, { a: mapNodes(node.a, fn) });
    else if (node.k === 'call') n = Object.assign({}, node, { args: node.args.map((x) => mapNodes(x, fn)) });
    const r = fn(n);
    return r === undefined ? n : r;
  }
  /** Forme canonique d'une règle (pour comparer deux écritures). */
  function canonical(text) { return text && text.trim() ? stringify(parse(text)) : ''; }

  root.Forexia.rules = {
    parse, evaluateRule, evaluateSeries, makeContext, validate, stringify, mapNodes, canonical, RuleError, FUNCTIONS: Object.keys(FUNCS),
  };
})(typeof window !== 'undefined' ? window : globalThis);
