/* Forexia — contrôleur de l'interface. */
(function () {
  'use strict';
  const F = window.Forexia;
  const $ = (id) => document.getElementById(id);
  const RULE_FIELDS = ['longEntry', 'longExit', 'shortEntry', 'shortExit'];
  const STORE_KEY = 'forexia.strategies';
  const LEVERAGES = [1, 2, 5, 10, 20, 30, 50, 100, 200, 500];
  const SERIES_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
  const PERIOD_LABEL = { '1m': '1 mois', '2m': '2 mois', '3m': '3 mois', '6m': '6 mois', '1y': '1 an', '2y': '2 ans', custom: 'Période personnalisée' };

  const money = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const num2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signed = (v, f) => (v > 0 ? '+' : v < 0 ? '−' : '') + f.format(Math.abs(v));
  const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const frDate = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(d); return m ? m[3] + '/' + m[2] + '/' + m[1] + m[4] : d; };
  const shortDate = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d); return m ? ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][+m[2] - 1] + ' ' + m[1].slice(2) : d; };

  const storage = {
    get() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (e) { return []; } },
    set(list) { try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); return true; } catch (e) { return false; } },
  };

  let lastFocusedRule = $('longEntry');
  let csvBars = null, csvName = '';
  const onlineCache = new Map();

  // ---------- Initialisation du formulaire ----------
  function fillSelect(sel, items, selected) {
    sel.innerHTML = items.map((it) => '<option value="' + esc(it.value) + '"' + (it.value === selected ? ' selected' : '') + '>' + esc(it.label) + '</option>').join('');
  }
  fillSelect($('pair'), F.data.PAIRS.map((p) => ({ value: p, label: p })), 'EUR/USD');
  fillSelect($('leverage'), LEVERAGES.map((l) => ({ value: String(l), label: '1:' + l })), '10');

  function refreshPresetSelect(selected) {
    const saved = storage.get();
    let html = '<optgroup label="Modèles">' + F.presets.list.map((p) => '<option value="preset:' + p.id + '">' + esc(p.name) + '</option>').join('') + '</optgroup>';
    if (saved.length) html += '<optgroup label="Mes stratégies">' + saved.map((s, i) => '<option value="saved:' + i + '">' + esc(s.name) + '</option>').join('') + '</optgroup>';
    html += '<option value="custom">Stratégie vierge…</option><option value="mine" hidden>Ma stratégie (non enregistrée)</option>';
    $('preset').innerHTML = html;
    if (selected) $('preset').value = selected;
  }

  const E = F.enhancer;
  let appliedStyle = 'none'; // style auquel les règles du formulaire sont réglées

  function currentStrategy() {
    const s = { name: $('stratName').value.trim() || 'Ma stratégie', plots: $('plots').value.trim(), frenchText: $('frenchText').value.trim(), style: appliedStyle };
    for (const f of RULE_FIELDS) s[f] = $(f).value.trim();
    s.stopLossPips = Number($('stopLoss').value) || 0;
    s.takeProfitPips = Number($('takeProfit').value) || 0;
    return s;
  }
  function loadStrategy(s) {
    $('stratName').value = s.name || '';
    for (const f of RULE_FIELDS) $(f).value = s[f] || '';
    $('stopLoss').value = s.stopLossPips || '';
    $('takeProfit').value = s.takeProfitPips || '';
    $('plots').value = s.plots || '';
    $('frenchText').value = s.frenchText || '';
    $('presetDesc').textContent = s.description || '';
    appliedStyle = s.style || 'none';
    if (s.style !== undefined || !s.longEntry && !s.shortEntry) $('style').value = appliedStyle === 'none' && !s.style ? $('style').value : appliedStyle;
    frenchDirty = false;
    renderTranslation(s.frenchText ? F.french.parse(s.frenchText) : null);
    validateAll();
  }
  // ---------- Configuration (paire, levier, capital…) enregistrée avec la stratégie ----------
  function currentConfig() {
    return {
      pair: $('pair').value, leverage: Number($('leverage').value), capital: Number($('capital').value),
      exposurePct: Number($('exposure').value), spreadPips: Number($('spread').value) || 0,
      period: periodValue(), dateFrom: $('dateFrom').value, dateTo: $('dateTo').value, source: sourceValue(),
      estimateWicks: $('estimateWicks').checked,
    };
  }
  function applyConfig(c) {
    if (!c) return;
    if (F.data.PAIRS.includes(c.pair)) $('pair').value = c.pair;
    if (LEVERAGES.includes(c.leverage)) $('leverage').value = String(c.leverage);
    if (c.capital) $('capital').value = c.capital;
    if (c.exposurePct) $('exposure').value = c.exposurePct;
    if (c.spreadPips !== undefined) $('spread').value = c.spreadPips;
    const per = document.querySelector('input[name=period][value="' + c.period + '"]');
    if (per) { per.checked = true; syncPeriodUI(); }
    if (c.period === 'custom' && c.dateFrom && c.dateTo) { $('dateFrom').value = c.dateFrom; $('dateTo').value = c.dateTo; }
    // Le fichier CSV n'est pas conservé par le navigateur : on ne restaure que les autres sources.
    const src = c.source !== 'csv' && document.querySelector('input[name=source][value="' + c.source + '"]');
    if (src) { src.checked = true; $('csvField').hidden = true; }
    if (c.estimateWicks !== undefined) $('estimateWicks').checked = c.estimateWicks;
    updateWicksField();
  }
  function describeConfig(c) {
    if (!c) return '';
    const per = c.period === 'custom' ? 'du ' + frDate(c.dateFrom) + ' au ' + frDate(c.dateTo) : PERIOD_LABEL[c.period];
    return c.pair + ' · levier 1:' + c.leverage + ' · capital ' + money.format(c.capital) +
      (c.exposurePct !== 100 ? ' · exposition ' + c.exposurePct + ' %' : '') + ' · ' + per;
  }
  function describeSaved(s) {
    let d = 'Enregistrée le ' + (s.savedAt ? new Date(s.savedAt).toLocaleDateString('fr-FR') : '?');
    if (s.style && s.style !== 'none') d += ' · ' + E.STYLES[s.style].label;
    if (s.config) d += ' · ' + describeConfig(s.config);
    if (s.lastResult) d += ' · résultat : ' + signed(s.lastResult.returnPct, num2) + ' % (' + s.lastResult.trades + ' trades, drawdown max −' + num2.format(s.lastResult.maxDrawdownPct) + ' %)';
    return d + '.';
  }
  let lastRunCtx = null; // données et réglages du dernier backtest, pour « Améliorer »
  let lastRun = null; // { key, stats } du dernier backtest, pour joindre son résultat à l'enregistrement

  function applyPresetSelection() {
    const v = $('preset').value;
    $('deleteStrat').hidden = !v.startsWith('saved:');
    if (v === 'custom') { loadStrategy({ name: '' }); $('longEntry').focus(); return; }
    if (v.startsWith('preset:')) {
      const preset = F.presets.list.find((p) => 'preset:' + p.id === v), style = $('style').value;
      loadStrategy(style === 'none' ? Object.assign({ style: 'none' }, preset) : E.adaptToStyle(preset, style));
      if (style !== 'none') $('presetDesc').textContent = preset.description + ' Réglée pour le ' + E.STYLES[style].label.toLowerCase() + '.';
    }
    if (v.startsWith('saved:')) {
      const saved = storage.get()[+v.slice(6)];
      loadStrategy(saved);
      applyConfig(saved.config);
      $('presetDesc').textContent = describeSaved(saved);
    }
    updateStyleHint();
  }

  // ---------- Style de trading ----------
  function hasRules() { return RULE_FIELDS.some((f) => $(f).value.trim()); }
  function updateStyleHint() {
    const style = $('style').value, v = $('preset').value;
    $('styleHint').hidden = style === 'none' && appliedStyle === 'none';
    $('styleDesc').textContent = style === 'none' ? 'Réglages d\'origine de la stratégie.' : E.STYLES[style].desc;
    $('adaptStyle').hidden = v.startsWith('preset:') || style === appliedStyle || !hasRules();
    $('adaptStyle').textContent = style === 'none' ? 'Revenir aux réglages d\'origine' : 'Adapter ma stratégie au ' + E.STYLES[style].label.toLowerCase();
  }
  $('style').addEventListener('change', () => {
    if ($('preset').value.startsWith('preset:')) applyPresetSelection();
    updateStyleHint();
  });
  $('adaptStyle').addEventListener('click', () => {
    if (frenchDirty && $('frenchText').value.trim()) translateFrench();
    const style = $('style').value, before = currentStrategy();
    const s = E.adaptToStyle(before, style, { fromStyle: appliedStyle });
    s.name = before.name === 'Ma stratégie' && !$('stratName').value.trim() ? '' : s.name;
    loadStrategy(s);
    $('preset').value = 'mine';
    $('deleteStrat').hidden = true;
    $('presetDesc').textContent = 'Stratégie adaptée : périodes des indicateurs ×' + (E.STYLES[style].factor / E.STYLES[before.style || 'none'].factor).toFixed(2).replace(/\.?0+$/, '') +
      (style !== 'none' ? ', stop-loss ' + s.stopLossPips + ' pips' + (s.takeProfitPips ? ', take-profit ' + s.takeProfitPips + ' pips' : '') : '') + '.' +
      (s.frenchText ? '' : ' Le texte français ne peut pas décrire ces réglages : voir « Règles techniques ».');
    if (!s.frenchText) $('rulesDetails').open = true;
    updateStyleHint();
  });
  $('preset').addEventListener('change', applyPresetSelection);

  // Enregistre la stratégie du formulaire (ou celle du dernier backtest) dans le navigateur.
  function saveStrategy(strat, config, stats) {
    const s = Object.assign({}, strat || currentStrategy());
    if (!strat && frenchDirty && s.frenchText) { translateFrench(); Object.assign(s, currentStrategy()); }
    s.config = config || currentConfig();
    if (!stats && lastRun && lastRun.key === JSON.stringify([s.longEntry, s.longExit, s.shortEntry, s.shortExit, s.stopLossPips, s.takeProfitPips, s.config])) stats = lastRun.stats;
    s.lastResult = stats ? { returnPct: stats.returnPct, trades: stats.trades, winRate: stats.winRate, maxDrawdownPct: stats.maxDrawdownPct, finalEquity: stats.finalEquity } : null;
    s.savedAt = new Date().toISOString();
    if (!strat && !validateAll()) { $('formError').textContent = 'Corrigez les règles en rouge avant d\'enregistrer.'; return null; }
    if (!s.longEntry && !s.shortEntry) { $('formError').textContent = 'Rien à enregistrer : aucune règle d\'entrée.'; return null; }
    const list = storage.get();
    const idx = list.findIndex((x) => x.name === s.name);
    delete s.description;
    if (idx >= 0) list[idx] = s; else list.push(s);
    if (!storage.set(list)) { $('formError').textContent = 'Impossible d\'enregistrer : le stockage du navigateur est bloqué (navigation privée ?).'; return null; }
    if ($('stratName').value.trim() === s.name || !$('stratName').value.trim()) {
      refreshPresetSelect('saved:' + (idx >= 0 ? idx : list.length - 1));
      $('deleteStrat').hidden = false;
      $('presetDesc').textContent = '« ' + s.name + ' » est enregistrée avec sa configuration (' + describeConfig(s.config) + '). Retrouvez-la dans Modèle → Mes stratégies.';
    } else {
      refreshPresetSelect($('preset').value);
    }
    return s;
  }
  $('saveStrat').addEventListener('click', () => { $('formError').textContent = ''; saveStrategy(); });
  $('deleteStrat').addEventListener('click', () => {
    const v = $('preset').value;
    if (!v.startsWith('saved:')) return;
    const list = storage.get();
    const [removed] = list.splice(+v.slice(6), 1);
    storage.set(list);
    refreshPresetSelect('preset:' + F.presets.list[0].id);
    applyPresetSelection();
    $('presetDesc').textContent = '« ' + (removed && removed.name) + ' » supprimée.';
  });

  // ---------- Validation en direct ----------
  function validateField(f) {
    const err = F.rules.validate($(f).value);
    document.querySelector('.err[data-for="' + f + '"]').textContent = err || '';
    $(f).classList.toggle('invalid', !!err);
    return !err;
  }
  function validateAll() { RULE_FIELDS.forEach((f) => autoGrow($(f))); return RULE_FIELDS.map(validateField).every(Boolean); }
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; }
  for (const f of RULE_FIELDS) {
    $(f).addEventListener('input', () => { autoGrow($(f)); validateField(f); markCustom(); });
    $(f).addEventListener('focus', () => { lastFocusedRule = $(f); });
  }

  function markCustom() {
    if ($('preset').value !== 'mine' && !$('preset').value.startsWith('saved:')) { $('preset').value = 'mine'; $('presetDesc').textContent = ''; }
  }

  // ---------- Stratégie en français ----------
  let frenchDirty = false;
  const KEY_CLASS = { longEntry: 'long', longExit: 'long', shortEntry: 'short', shortExit: 'short' };
  function renderTranslation(r) {
    const box = $('frenchResult');
    if (!r) { box.innerHTML = ''; return; }
    let html = '';
    if (r.understood.length) {
      html += '<div class="tr-head">Ce que j\'ai compris</div>';
      html += r.understood.map((u) => '<div class="tr-row"><b class="' + (KEY_CLASS[u.key] || '') + '">' + esc(u.label) + '</b><code>' + esc(u.rule) + '</code></div>').join('');
    }
    html += r.warnings.map((w) => '<div class="tr-warn">' + esc(w) + '</div>').join('');
    box.innerHTML = html;
  }
  function translateFrench() {
    const text = $('frenchText').value.trim();
    frenchDirty = false;
    if (!text) { renderTranslation(null); return null; }
    const r = F.french.parse(text);
    renderTranslation(r);
    if (r.longEntry || r.shortEntry) {
      for (const f of RULE_FIELDS) $(f).value = r[f];
      $('stopLoss').value = r.stopLossPips || '';
      $('takeProfit').value = r.takeProfitPips || '';
      $('plots').value = r.plots;
      validateAll();
    }
    return r;
  }
  $('frenchText').addEventListener('input', () => { frenchDirty = true; markCustom(); });
  $('translateBtn').addEventListener('click', () => { $('formError').textContent = ''; translateFrench(); });

  // ---------- Stratégie aléatoire ----------
  $('randomBtn').addEventListener('click', () => {
    const style = $('style').value;
    let s = F.french.randomStrategy();
    if (style !== 'none') s = E.adaptToStyle(s, style, { rnd: Math.random });
    else s.style = 'none';
    loadStrategy(s);
    $('preset').value = 'mine';
    $('deleteStrat').hidden = true;
    $('presetDesc').textContent = s.description;
    $('form').requestSubmit();
  });

  // ---------- Aide : éléments insérables ----------
  const CHIPS = [
    ['Indicateurs', ['RSI(14)', 'MACD(12,26,9)', 'MACD_SIGNAL(12,26,9)', 'MACD_HIST(12,26,9)', 'SMA(50)', 'EMA(20)',
      'STOCH_K(14,3,3)', 'STOCH_D(14,3,3)', 'BB_UPPER(20,2)', 'BB_MIDDLE(20,2)', 'BB_LOWER(20,2)', 'CCI(20)', 'WILLR(14)', 'ATR(14)', 'MOM(10)', 'ROC(10)']],
    ['Prix et outils', ['CLOSE', 'OPEN', 'HIGH', 'LOW', 'PREV(CLOSE, 1)', 'HIGHEST(HIGH, 20)', 'LOWEST(LOW, 20)']],
    ['Croisements', ['CROSS_UP(a, b)', 'CROSS_DOWN(a, b)']],
    ['Logique', ['AND', 'OR', 'NOT', '>', '<', '>=', '<=']],
  ];
  $('chips').innerHTML = CHIPS.map(([g, items]) => '<span class="group">' + g + '</span>' +
    items.map((t) => '<button type="button" data-ins="' + esc(t) + '">' + esc(t) + '</button>').join('')).join('');
  $('chips').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-ins]');
    if (!b) return;
    const ta = lastFocusedRule, txt = b.dataset.ins;
    const s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? ta.value.length;
    const before = ta.value.slice(0, s), after = ta.value.slice(en);
    const pad = (before && !/\s$/.test(before) ? ' ' : '') + txt + (after && !/^\s/.test(after) ? ' ' : '');
    ta.value = before + pad + after;
    ta.focus();
    const caret = (before + pad).length;
    ta.setSelectionRange(caret, caret);
    autoGrow(ta);
    validateField(ta.id);
  });

  // ---------- Source des données ----------
  function sourceValue() { return document.querySelector('input[name=source]:checked').value; }
  function periodValue() { return document.querySelector('input[name=period]:checked').value; }

  // ---------- Période : 6 mois / 1 an / 2 ans ou dates libres ----------
  const todayIso = () => F.data.iso(new Date());
  function setDates(from, to) { $('dateFrom').value = F.data.iso(from); $('dateTo').value = F.data.iso(to); }
  function syncPeriodUI() {
    const custom = periodValue() === 'custom';
    $('customRange').hidden = !custom;
    $('quickRanges').hidden = !custom;
    $('dateFrom').max = $('dateTo').max = todayIso();
    if (!custom) {
      // Les dates suivent le choix rapide : en passant à « Dates », on part de cette période.
      const r = F.data.periodRange(periodValue(), new Date(todayIso() + 'T00:00:00Z'));
      setDates(r.start, r.end);
    }
  }
  document.querySelectorAll('input[name=period]').forEach((r) => r.addEventListener('change', syncPeriodUI));
  $('quickRanges').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const now = new Date(todayIso() + 'T00:00:00Z');
    if (b.dataset.years) setDates(F.data.addMonths(now, -12 * +b.dataset.years), now);
    else if (b.dataset.year === 'last') { const y = now.getUTCFullYear() - 1; setDates(new Date(Date.UTC(y, 0, 1)), new Date(Date.UTC(y, 11, 31))); }
    else if (b.dataset.year === 'ytd') setDates(new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), now);
  });
  syncPeriodUI();

  function rangeFor(periodKey, defaultEnd) {
    if (periodKey === 'custom') return F.data.customRange($('dateFrom').value, $('dateTo').value);
    return F.data.periodRange(periodKey, defaultEnd);
  }
  document.querySelectorAll('input[name=source]').forEach((r) => r.addEventListener('change', () => { $('csvField').hidden = sourceValue() !== 'csv'; }));
  let csvMeta = null; // { timeframe, real, spreadPips }
  $('csvFile').addEventListener('change', async () => {
    const file = $('csvFile').files[0];
    csvBars = null; csvMeta = null;
    $('csvInfo').textContent = '';
    if (!file) { updateWicksField(); return; }
    try {
      csvBars = F.data.parseCSV(await file.text());
      csvName = file.name;
      const spreads = csvBars.map((b) => b.spreadPoints).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
      // MT5 exporte le spread en points ; 1 pip = 10 points chez les courtiers à 5 (ou 3) décimales.
      const spreadPips = spreads.length ? spreads[Math.floor(spreads.length / 2)] / 10 : null;
      csvMeta = { timeframe: F.data.detectTimeframe(csvBars), real: F.data.hasRealRange(csvBars), spreadPips: spreadPips };
      if (spreadPips) $('spread').value = +spreadPips.toFixed(1);
      $('csvInfo').textContent = csvBars.length.toLocaleString('fr-FR') + ' bougies ' + csvMeta.timeframe + ' du ' + frDate(csvBars[0].date.slice(0, 10)) +
        ' au ' + frDate(csvBars[csvBars.length - 1].date.slice(0, 10)) + (csvMeta.real ? ', avec plus hauts / plus bas' : ', sans plus hauts / plus bas') +
        (spreadPips ? ', spread médian ' + num1.format(spreadPips) + ' pip (repris dans « Spread »)' : '') + '.';
      $('formError').textContent = '';
    } catch (e) { $('formError').textContent = 'CSV : ' + e.message; }
    updateWicksField();
  });
  function updateWicksField() {
    const src = sourceValue();
    $('wicksField').hidden = !(src === 'online' || (src === 'csv' && csvMeta && !csvMeta.real));
  }
  document.querySelectorAll('input[name=source]').forEach((r) => r.addEventListener('change', updateWicksField));
  $('pair').addEventListener('change', () => {
    if (!(sourceValue() === 'csv' && csvMeta && csvMeta.spreadPips)) $('spread').value = F.data.TYPICAL_SPREAD[$('pair').value] || 1.5;
  });
  updateWicksField();

  async function loadBars(pair, periodKey) {
    const src = sourceValue();
    if (src === 'csv') {
      if (!csvBars) throw new Error('Choisissez un fichier CSV valide.');
      const last = new Date(csvBars[csvBars.length - 1].date.slice(0, 10) + 'T00:00:00Z');
      const range = rangeFor(periodKey, last);
      const est = !csvMeta.real && $('estimateWicks').checked;
      return { bars: est ? F.data.estimateWicks(csvBars) : csvBars, range: range, timeframe: csvMeta.timeframe,
        source: 'Fichier « ' + csvName + ' » (' + csvMeta.timeframe + (est ? ', mèches estimées' : '') + ')' };
    }
    const today = new Date(F.data.iso(new Date()) + 'T00:00:00Z');
    const range = rangeFor(periodKey, today);
    if (range.end > today) range.end = today;
    if (src === 'online') {
      if (F.data.iso(range.end) < F.data.ECB_FIRST_DATE) throw new Error('Les cours BCE commencent le 04/01/1999 : choisissez une période plus récente.');
      const key = pair + '|' + F.data.iso(range.fetchStart) + '|' + F.data.iso(range.end);
      try {
        if (!onlineCache.has(key)) onlineCache.set(key, await F.data.fetchFrankfurter(pair, range.fetchStart, range.end));
        const est = $('estimateWicks').checked;
        return {
          bars: est ? F.data.estimateWicks(onlineCache.get(key)) : onlineCache.get(key), range: range, timeframe: 'D1',
          source: 'Cours BCE journaliers' + (est ? ' + mèches estimées' : ''),
          info: 'Cours de référence BCE : un prix par jour (14 h 15), différent des bougies de votre courtier (clôture à minuit, vrais plus hauts / plus bas, spread). ' +
            (est ? 'Les mèches sont estimées pour que les stop-loss soient réalistes. ' : '<b>Mèches non estimées : les stop-loss et take-profit sont sous-estimés.</b> ') +
            'Pour un résultat au plus près de MetaTrader 5, importez l\'export des bougies de votre courtier (source « Mon fichier CSV »).',
        };
      } catch (e) {
        return {
          bars: F.data.generateSynthetic(pair, range.fetchStart, range.end), range: range, source: 'Données simulées', timeframe: 'D1',
          warning: e.message + '. Le backtest a été lancé sur des <b>données simulées</b> : les résultats ne reflètent pas le marché réel.',
        };
      }
    }
    return { bars: F.data.generateSynthetic(pair, range.fetchStart, range.end), range: range, timeframe: 'D1', source: 'Données simulées (marche aléatoire)' };
  }

  // ---------- Lancement ----------
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('formError').textContent = '';
    if (frenchDirty && $('frenchText').value.trim()) {
      const r = translateFrench();
      if (!r.longEntry && !r.shortEntry) { $('formError').textContent = 'Je n\'ai pas compris votre stratégie en français : voir les remarques sous le texte.'; return; }
    }
    const strat = currentStrategy();
    if (!validateAll()) { $('rulesDetails').open = true; $('formError').textContent = 'Corrigez les règles en rouge.'; return; }
    if (!strat.longEntry && !strat.shortEntry) { $('formError').textContent = 'Indiquez au moins une règle d\'entrée (achat ou vente).'; return; }
    const capital = Number($('capital').value), exposure = Number($('exposure').value), spread = Number($('spread').value) || 0;
    if (!(capital >= 100)) { $('formError').textContent = 'Le capital doit être d\'au moins 100.'; return; }
    if (!(exposure > 0 && exposure <= 100)) { $('formError').textContent = 'L\'exposition doit être comprise entre 1 et 100 %.'; return; }

    const pair = $('pair').value, periodKey = periodValue(), leverage = Number($('leverage').value);
    const btn = $('runBtn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Calcul en cours…';
    try {
      const loaded = await loadBars(pair, periodKey);
      const endIso = F.data.iso(loaded.range.end);
      const bars = loaded.bars.filter((b) => b.date.slice(0, 10) <= endIso);
      const startIndex = F.data.indexFrom(bars, loaded.range.start);
      if (bars.length - startIndex < 10) {
        const all = loaded.bars;
        throw new Error('Pas assez de cotations sur la période choisie. Données disponibles du ' + frDate(all[0].date.slice(0, 10)) +
          ' au ' + frDate(all[all.length - 1].date.slice(0, 10)) + '.');
      }
      const settings = { capital, leverage, exposurePct: exposure, spreadPips: spread, pair, startIndex };
      const result = F.backtest.runBacktest(bars, strat, settings);
      const warnings = [];
      if (loaded.warning) warnings.push(loaded.warning);
      if (loaded.info) warnings.push({ info: true, html: loaded.info });
      if (leverage > 30) warnings.push({ info: true, html: 'Levier 1:' + leverage + ' : en Europe, le levier est plafonné à 1:30 sur les grandes paires pour un particulier. Vérifiez le levier réel de votre compte.' });
      if (startIndex < 200) warnings.push('Historique antérieur limité (' + startIndex + ' bougies) : les indicateurs à longue période (ex. EMA 200) peuvent être indisponibles en début de test.');
      if (strat.style === 'scalping' && sourceValue() !== 'csv') {
        warnings.push('<b>Scalping sur données journalières</b> : le scalping se joue sur des bougies de quelques minutes. Pour un test réaliste, importez un CSV en M1 à M15 (source « Mon fichier CSV »).');
      }
      if (result.ruined) warnings.push('<b>Compte liquidé</b> : le capital a été entièrement perdu. Réduisez le levier ou l\'exposition.');
      const config = currentConfig();
      lastRunCtx = { bars, strat, settings, config, timeframe: loaded.timeframe || 'D1' };
      lastRun = { key: JSON.stringify([strat.longEntry, strat.longExit, strat.shortEntry, strat.shortExit, strat.stopLossPips, strat.takeProfitPips, config]), stats: result.stats };
      render({ bars, strat, settings, result, loaded, periodKey, warnings, config });
    } catch (err) {
      $('formError').textContent = err.message;
    } finally {
      btn.disabled = false; btn.textContent = 'Lancer le backtest';
    }
  });

  // ---------- Rendu des résultats ----------
  function splitTopLevel(text) {
    const out = []; let depth = 0, cur = '';
    for (const c of text) {
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim()).filter(Boolean);
  }

  function render(ctx) {
    const { bars, strat, settings, result, loaded, periodKey, warnings, config } = ctx;
    const s = result.stats, st = result.startIndex;
    const view = bars.slice(st);
    const dates = view.map((b) => b.date);
    const dec = /JPY/.test(settings.pair) ? 3 : 5;
    const pfmt = (v) => v.toFixed(dec);

    let html = '';
    for (const w of warnings) html += '<div class="banner ' + (w.info ? 'info' : 'warn') + '">' + (w.info ? w.html : w) + '</div>';
    html += '<div class="panel card save-card"><div><b>Cette stratégie vous plaît ?</b> <span class="hint">Sinon, « Améliorer » propose des réglages testés.</span><div class="hint">' + esc(strat.frenchText || strat.longEntry || strat.shortEntry).replace(/\n/g, '<br>') + '</div>' +
      '<div class="hint save-config">Configuration enregistrée avec : ' + esc(describeConfig(config)) + '</div>' +
      '</div><div class="save-actions">' +
      '<button type="button" class="enhance" id="enhanceBtn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>Améliorer</button>' +
      '<button type="button" class="deploy" id="deployBtn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>Déployer</button>' +
      '<button type="button" class="primary inline-save" id="saveFromResults">Enregistrer</button></div></div>';
    html += '<div class="summary-head"><h2>' + esc(strat.name) + ' · ' + esc(settings.pair) + '</h2>' +
      '<span class="meta">' + PERIOD_LABEL[periodKey] + ' · du ' + frDate(dates[0]) + ' au ' + frDate(dates[dates.length - 1]) +
      ' · levier 1:' + settings.leverage + ' · ' + esc(loaded.source) + ' · ' + view.length + ' bougies</span></div>';

    const kpi = (label, value, sub, c) => '<div class="panel kpi"><div class="label">' + label + '</div><div class="value ' + (c || '') + '">' + value + '</div><div class="sub">' + (sub || '&nbsp;') + '</div></div>';
    html += '<div class="kpis">' +
      kpi('Capital final', money.format(s.finalEquity), 'départ ' + money.format(s.initialCapital)) +
      kpi('Profit net', signed(s.netProfit, money), signed(s.returnPct, num2) + ' %', cls(s.netProfit)) +
      kpi('Trades', String(s.trades), num1.format(s.winRate) + ' % gagnants') +
      kpi('Profit factor', Number.isFinite(s.profitFactor) ? num2.format(s.profitFactor) : '∞', 'gains / pertes', s.profitFactor >= 1 ? 'pos' : s.trades ? 'neg' : '') +
      kpi('Drawdown max', '−' + num2.format(s.maxDrawdownPct) + ' %', '−' + money.format(s.maxDrawdownAmount), s.maxDrawdownPct > 0 ? 'neg' : '') +
      kpi('Ratio de Sharpe', signed(s.sharpe, num2), 'annualisé', cls(s.sharpe)) +
      '</div>';

    html += '<div class="panel card"><div class="card-head"><h3>Évolution du capital</h3>' +
      '<div class="legend"><span><i style="background:var(--s1)"></i>Capital</span><span><i style="background:var(--muted)"></i>Capital initial</span></div></div><div id="equityChart"></div></div>';

    html += '<div class="panel card"><div class="card-head"><h3>Cours et positions</h3><div class="legend" id="priceLegend"></div></div><div id="priceChart"></div></div>';

    const row = (k, v, c) => '<div><dt>' + k + '</dt><dd class="' + (c || '') + '">' + v + '</dd></div>';
    html += '<div class="panel card"><div class="card-head"><h3>Statistiques détaillées</h3></div><div class="stats-grid"><dl>' +
      row('Rendement', signed(s.returnPct, num2) + ' %', cls(s.returnPct)) +
      row('Variation de la paire (sans levier)', signed(s.buyHoldPct, num2) + ' %', cls(s.buyHoldPct)) +
      row('Trades gagnants / perdants', s.wins + ' / ' + s.losses) +
      row('Positions longues / courtes', s.longTrades + ' / ' + s.shortTrades) +
      row('Temps en position', num1.format(s.timeInMarketPct) + ' %') +
      row('Pertes consécutives max', String(s.maxLossStreak)) +
      '</dl><dl>' +
      row('Gain moyen', signed(s.avgWin, money), cls(s.avgWin)) +
      row('Perte moyenne', signed(s.avgLoss, money), cls(s.avgLoss)) +
      row('Espérance par trade', signed(s.expectancy, money), cls(s.expectancy)) +
      row('Meilleur trade', signed(s.bestTrade, money), cls(s.bestTrade)) +
      row('Pire trade', signed(s.worstTrade, money), cls(s.worstTrade)) +
      row('Frais de spread payés', money.format(s.totalCosts)) +
      '</dl></div></div>';

    html += '<div class="panel card"><div class="card-head"><h3>Historique des trades (' + result.trades.length + ')</h3>' +
      (result.trades.length ? '<button type="button" class="secondary small" id="exportCsv">Exporter en CSV</button>' : '') + '</div>';
    if (result.trades.length) {
      html += '<div class="table-wrap"><table><thead><tr><th>#</th><th>Sens</th><th class="l">Entrée</th><th>Prix</th><th class="l">Sortie</th><th>Prix</th><th>Pips</th><th>P&amp;L</th><th class="l">Motif</th></tr></thead><tbody>' +
        result.trades.map((t, k) => '<tr><td>' + (k + 1) + '</td><td><span class="badge ' + (t.dir > 0 ? 'long">Achat' : 'short">Vente') + '</span></td>' +
          '<td class="l">' + frDate(t.entryDate) + '</td><td>' + pfmt(t.entryPrice) + '</td><td class="l">' + frDate(t.exitDate) + '</td><td>' + pfmt(t.exitPrice) + '</td>' +
          '<td class="' + cls(t.pips) + '">' + signed(t.pips, num1) + '</td><td class="' + cls(t.pnl) + '">' + signed(t.pnl, money) + '</td><td class="l">' + t.reason + '</td></tr>').join('') +
        '</tbody></table></div>';
    } else {
      html += '<p class="hint">Aucun trade : les conditions d\'entrée ne se sont jamais réalisées sur cette période.</p>';
    }
    html += '</div>';

    $('results').innerHTML = html;

    // Graphique du capital
    F.chart.mount($('equityChart'), {
      labels: dates, formatLabel: shortDate, ariaLabel: 'Évolution du capital',
      panels: [{
        height: 220, format: (v, full) => (full ? money.format(v) : compact(v)),
        series: [{ name: 'Capital', values: result.equity, color: 'var(--s1)', width: 2, fill: true }],
        refLines: [{ value: settings.capital, color: 'var(--muted)' }],
      }],
    });

    // Graphique des cours, indicateurs et trades
    const ctxR = F.rules.makeContext(bars);
    const overlays = [], oscillators = [];
    const closes = view.map((b) => b.close);
    const pMin = Math.min(...closes), pMax = Math.max(...closes);
    let colorIdx = 0;
    for (const expr of splitTopLevel(strat.plots || '')) {
      let values;
      try { values = F.rules.evaluateSeries(expr, ctxR).slice(st); } catch (e) { continue; }
      const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
      if (!finite.length) continue;
      const med = finite[Math.floor(finite.length / 2)];
      const ser = { name: expr.replace(/\s+/g, ''), values: values, color: SERIES_COLORS[colorIdx++ % SERIES_COLORS.length], width: 1.4 };
      if (med > pMin * 0.7 && med < pMax * 1.3) overlays.push(ser); else oscillators.push(ser);
    }
    const markers = [];
    for (const t of result.trades) {
      const ei = t.entryIndex - st, xi = t.exitIndex - st;
      markers.push({ i: ei, value: t.entryPrice, shape: t.dir > 0 ? 'up' : 'down', color: t.dir > 0 ? 'var(--up)' : 'var(--down)',
        title: (t.dir > 0 ? 'Achat' : 'Vente') + ' ' + frDate(t.entryDate) + ' à ' + pfmt(t.entryPrice) });
      markers.push({ i: xi, value: t.exitPrice, shape: 'dot', color: t.pnl > 0 ? 'var(--up)' : 'var(--down)',
        title: 'Sortie (' + t.reason + ') ' + frDate(t.exitDate) + ' à ' + pfmt(t.exitPrice) + ' : ' + signed(t.pnl, money) });
    }
    const panels = [{ height: 280, format: pfmt, series: [{ name: settings.pair, values: closes, color: 'var(--price)', width: 1.5 }].concat(overlays), markers: markers }];
    // Regroupe les oscillateurs de même famille (ex. MACD + signal) dans un même panneau.
    const groups = new Map();
    for (const o of oscillators) {
      const fam = o.name.replace(/\(.*$/, '').replace(/_(SIGNAL|HIST|K|D)$/, '');
      if (!groups.has(fam)) groups.set(fam, []);
      groups.get(fam).push(o);
    }
    for (const [fam, series] of groups) {
      const refs = /^(RSI)$/.test(fam) ? [30, 70] : /^STOCH$/.test(fam) ? [20, 80] : /^(CCI)$/.test(fam) ? [-100, 100] : /^WILLR$/.test(fam) ? [-80, -20] : /^(MACD|MOM|ROC)$/.test(fam) ? [0] : [];
      const small = Math.max(...series.map((x) => Math.max(...x.values.filter(Number.isFinite).map(Math.abs)))) < 0.1;
      panels.push({
        height: 110, title: fam, series: series, refLines: refs.map((v) => ({ value: v })),
        format: (v) => (small ? v.toFixed(dec) : num2.format(v)),
      });
    }
    F.chart.mount($('priceChart'), {
      labels: dates, formatLabel: shortDate, panels: panels, ariaLabel: 'Cours de ' + settings.pair + ' avec les trades',
      extraTip: (i) => {
        const t = result.trades.find((tr) => tr.entryIndex - st === i || tr.exitIndex - st === i);
        if (!t) return '';
        const isEntry = t.entryIndex - st === i;
        return '<div style="margin-top:4px"><b class="' + (isEntry ? (t.dir > 0 ? 'pos' : 'neg') : cls(t.pnl)) + '">' +
          (isEntry ? (t.dir > 0 ? '▲ Achat' : '▼ Vente') : '● Sortie : ' + signed(t.pnl, money)) + '</b></div>';
      },
    });
    $('priceLegend').innerHTML = '<span><i style="background:var(--price)"></i>' + esc(settings.pair) + '</span>' +
      overlays.map((o) => '<span><i style="background:' + o.color + '"></i>' + esc(o.name) + '</span>').join('') +
      '<span><i class="tri-up"></i>Achat</span><span><i class="tri-dn"></i>Vente</span><span><i class="dot" style="background:var(--muted)"></i>Sortie</span>';

    $('enhanceBtn').addEventListener('click', openEnhancer);
    $('deployBtn').addEventListener('click', openDeploy);
    $('saveFromResults').addEventListener('click', () => {
      const saved = saveStrategy(strat, config, s);
      if (saved) { $('saveFromResults').textContent = 'Enregistrée ✓'; $('saveFromResults').disabled = true; }
    });
    const exp = $('exportCsv');
    if (exp) exp.addEventListener('click', () => exportTrades(result.trades, strat, settings));
    if (window.matchMedia('(max-width: 900px)').matches) $('results').scrollIntoView({ behavior: 'smooth' });
  }

  function compact(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return num1.format(v / 1e6) + ' M';
    if (a >= 1e4) return num1.format(v / 1e3) + ' k';
    return Math.round(v).toLocaleString('fr-FR');
  }

  function exportTrades(trades, strat, settings) {
    const head = 'numero;sens;date_entree;prix_entree;date_sortie;prix_sortie;pips;pnl;motif';
    const rows = trades.map((t, k) => [k + 1, t.dir > 0 ? 'achat' : 'vente', t.entryDate, t.entryPrice, t.exitDate, t.exitPrice,
      t.pips.toFixed(1), t.pnl.toFixed(2), t.reason].join(';'));
    const blob = new Blob(['﻿' + [head].concat(rows).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = ('trades-' + settings.pair.replace('/', '') + '-' + strat.name).replace(/[^\w.-]+/g, '_') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Fenêtre « Améliorer » ----------
  let enh = null; // { suggestions, base }
  const pct = (v) => signed(v, num1) + ' %';
  function statLine(st) {
    return '<span class="' + cls(st.returnPct) + '">' + pct(st.returnPct) + '</span> · drawdown −' + num1.format(st.maxDrawdownPct) + ' % · ' + st.trades + (st.trades > 1 ? ' trades' : ' trade');
  }
  function openEnhancer() {
    if (!lastRunCtx) return;
    const m = $('enhanceModal');
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    $('enhanceSub').textContent = 'Chaque suggestion a été testée sur ' + lastRunCtx.settings.pair + ', sur la même période. Cochez celles à appliquer.';
    $('enhanceBody').innerHTML = '<div class="modal-loading"><span class="spinner"></span>Test des améliorations possibles…</div>';
    $('enhanceCombined').innerHTML = '';
    $('enhanceApply').disabled = true;
    $('enhanceModal').querySelector('.close').focus();
    setTimeout(() => {
      const { bars, strat, settings } = lastRunCtx;
      enh = E.suggest(bars, strat, settings, strat.style || $('style').value);
      const base = enh.base;
      let html = '<div class="modal-note"><b>Résultat actuel :</b> ' + statLine(base) + '</div>';
      if (!enh.suggestions.length) {
        html += '<p>Aucune des modifications testées (réglages des indicateurs, seuils, filtre de tendance, stop-loss, take-profit, sens des positions…) n\'améliore ce résultat sur cette période.</p>';
      }
      html += enh.suggestions.map((sg, i) => {
        const d = sg.stats.returnPct - base.returnPct;
        return '<label class="sugg"><input type="checkbox" data-i="' + i + '"><div>' +
          '<div class="grp' + (sg.risk ? ' risk' : '') + '">' + esc(sg.group) + '</div><b>' + esc(sg.title) + '</b><p>' + esc(sg.detail) + '</p>' +
          '<div class="res">Seule : ' + statLine(sg.stats) + ' <span class="delta ' + cls(d) + '">' + signed(d, num1) + ' pts</span></div>' + validationLine(sg.validation) + '</div></label>';
      }).join('');
      if (enh.suggestions.length) {
        if (enh.validation) html += '<p class="modal-note">Chaque suggestion est aussi testée sur la <b>période précédente</b> de même durée, qui n\'a pas servi à la choisir. Privilégiez les suggestions « confirmées ».</p>';
        html += '<p class="modal-note">Ces améliorations sont calculées sur la période testée. Plus vous en cumulez, plus le risque de « sur-optimisation » est grand : la stratégie colle au passé sans être meilleure à l\'avenir. Vérifiez ensuite le résultat sur une autre période (bouton « Dates »).</p>';
      }
      $('enhanceBody').innerHTML = html;
      updateCombined();
    }, 30);
  }
  function validationLine(v) {
    if (!v) return '';
    return '<div class="val ' + (v.confirmed ? 'ok' : 'ko') + '">Période précédente : ' + pct(v.stats.returnPct) + ' au lieu de ' + pct(v.base.returnPct) +
      (v.confirmed ? ' : confirmée' : ' : non confirmée, peut-être un hasard') + '</div>';
  }
  function selectedSuggestions() {
    return [...$('enhanceBody').querySelectorAll('input[type=checkbox]:checked')].map((c) => enh.suggestions[+c.dataset.i]);
  }
  function updateCombined() {
    const sel = selectedSuggestions();
    $('enhanceApply').disabled = !sel.length;
    if (!sel.length) { $('enhanceCombined').innerHTML = enh.suggestions.length ? '<span class="hint">Cochez une ou plusieurs améliorations.</span>' : ''; return; }
    const { bars, strat, settings } = lastRunCtx;
    const c = E.combine(strat, settings, sel);
    const st = E.run(bars, c.strat, c.settings);
    let html = st ? '<b>Avec ' + (sel.length > 1 ? 'ces ' + sel.length + ' améliorations' : 'cette amélioration') + ' :</b> ' + statLine(st) +
      ' <span class="hint">(au lieu de ' + pct(enh.base.returnPct) + ')</span>' : '';
    if (st && enh.validation) {
      const v = enh.validation, cv = E.combine(strat, v.settings, sel), vs = E.run(v.bars, cv.strat, cv.settings);
      if (vs) html += '<div class="val ' + (E.score(vs) > E.score(v.base) ? 'ok' : 'ko') + '">Sur la période précédente : ' + pct(vs.returnPct) + ' au lieu de ' + pct(v.base.returnPct) + '</div>';
    }
    $('enhanceCombined').innerHTML = html;
  }
  $('enhanceBody').addEventListener('change', updateCombined);
  function closeEnhancer() { $('enhanceModal').hidden = true; document.body.style.overflow = ''; }
  $('enhanceModal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeEnhancer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('enhanceModal').hidden) closeEnhancer(); });
  $('enhanceApply').addEventListener('click', () => {
    const sel = selectedSuggestions();
    if (!sel.length) return;
    const { strat, settings } = lastRunCtx;
    const c = E.combine(strat, settings, sel);
    const s = Object.assign({}, c.strat);
    s.name = String(strat.name).replace(/ \(améliorée\)$/, '') + ' (améliorée)';
    s.plots = F.french.derivePlots(s);
    s.frenchText = F.french.toFrench(s) || '';
    loadStrategy(s);
    if (c.settings.leverage !== settings.leverage) $('leverage').value = String(c.settings.leverage);
    $('preset').value = 'mine';
    $('deleteStrat').hidden = true;
    $('presetDesc').textContent = 'Améliorations appliquées : ' + sel.map((x) => x.title).join(' ; ') + '.' +
      (s.frenchText ? '' : ' Le texte français ne peut pas décrire ces réglages : voir « Règles techniques ».');
    if (!s.frenchText) $('rulesDetails').open = true;
    updateStyleHint();
    closeEnhancer();
    $('form').requestSubmit();
  });

  // ---------- Fenêtre « Déployer sur MetaTrader 5 » ----------
  let deployed = null; // { code, fileName }
  function deployOptions() {
    const { strat, settings, config } = lastRunCtx;
    return {
      pair: settings.pair, leverage: settings.leverage, exposurePct: settings.exposurePct, capital: settings.capital,
      periodLabel: config.period === 'custom' ? 'du ' + frDate(config.dateFrom) + ' au ' + frDate(config.dateTo) : PERIOD_LABEL[config.period],
      stats: lastRun && lastRun.stats, timeframe: $('depTimeframe').value, sizing: $('depSizing').value,
      fixedLots: Number($('depLots').value) || 0.01, riskPct: Number($('depRisk').value) || 1,
      maxLots: Number($('depMaxLots').value) || 1, maxSpreadPips: Number($('depSpread').value) || 0, strat: strat,
    };
  }
  function refreshDeploy() {
    const o = deployOptions();
    $('depLotsField').hidden = o.sizing !== 'fixed';
    $('depRiskField').hidden = o.sizing !== 'risk';
    const notional = o.capital * o.exposurePct / 100 * o.leverage;
    $('depSizingHint').textContent = o.sizing === 'backtest'
      ? 'Taille = capital du compte × ' + o.exposurePct + ' % × levier ' + o.leverage + '. Avec ' + money.format(o.capital) + ' : ≈ ' + num2.format(notional / 100000) +
        ' lot(s) standard (' + Math.round(notional).toLocaleString('fr-FR') + ' unités), limité par le plafond.'
      : o.sizing === 'risk' ? 'La taille est calculée pour perdre ' + num1.format(o.riskPct) + ' % du capital si le stop-loss (' + (o.strat.stopLossPips || 0) + ' pips) est touché.' +
        (o.strat.stopLossPips ? '' : ' Cette stratégie n\'a pas de stop-loss : l\'EA utilisera les lots fixes.')
      : 'Chaque position fait ' + num2.format(o.fixedLots) + ' lot(s), quel que soit le capital.';
    $('depError').textContent = '';
    try {
      deployed = F.mql5.generate(o.strat, o);
      $('depCode').textContent = deployed.code;
      $('depFileName').textContent = deployed.fileName;
      $('depDownload').disabled = $('depCopy').disabled = false;
    } catch (e) {
      deployed = null;
      $('depError').textContent = 'Impossible de générer l\'EA : ' + e.message;
      $('depDownload').disabled = $('depCopy').disabled = true;
    }
  }
  function openDeploy() {
    if (!lastRunCtx) return;
    const { strat, settings } = lastRunCtx;
    $('deploySub').textContent = '« ' + strat.name + ' » sur ' + settings.pair + ' : un Expert Advisor qui applique ces règles sur votre compte MT5.';
    document.querySelectorAll('.dep-pair').forEach((e) => { e.textContent = settings.pair.replace('/', ''); });
    $('depTimeframe').value = 'PERIOD_' + (lastRunCtx.timeframe || 'D1');
    $('depNotice').textContent = '';
    refreshDeploy();
    $('deployModal').hidden = false;
    document.body.style.overflow = 'hidden';
    $('deployModal').querySelector('.close').focus();
  }
  ['depTimeframe', 'depSizing', 'depLots', 'depRisk', 'depMaxLots', 'depSpread'].forEach((id) => $(id).addEventListener('input', refreshDeploy));
  function closeDeploy() { $('deployModal').hidden = true; document.body.style.overflow = ''; }
  $('deployModal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDeploy(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('deployModal').hidden) closeDeploy(); });
  $('depDownload').addEventListener('click', () => {
    if (!deployed) return;
    // BOM UTF-8 : MetaEditor lit alors correctement les accents.
    const blob = new Blob(['\ufeff' + deployed.code.replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = deployed.fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('depNotice').textContent = 'Fichier « ' + deployed.fileName + ' » téléchargé. Suivez les étapes ci-dessous pour l\'installer.';
  });
  $('depCopy').addEventListener('click', async () => {
    if (!deployed) return;
    try {
      await navigator.clipboard.writeText(deployed.code);
      $('depNotice').textContent = 'Code copié. Dans MetaEditor : Fichier → Nouveau → Expert Advisor, collez le code à la place du modèle, enregistrez sous « ' + deployed.fileName + ' », puis compilez.';
    } catch (e) {
      const det = $('depCode').closest('details'); det.open = true;
      const range = document.createRange(); range.selectNodeContents($('depCode'));
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      $('depNotice').textContent = 'Copie automatique impossible : le code est sélectionné, copiez-le avec Ctrl+C.';
    }
  });

  // ---------- Thème ----------
  $('themeToggle').addEventListener('click', () => {
    const rootEl = document.documentElement;
    const dark = rootEl.dataset.theme ? rootEl.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    rootEl.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('forexia.theme', rootEl.dataset.theme); } catch (e) { /* ignoré */ }
  });
  try { const t = localStorage.getItem('forexia.theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignoré */ }

  refreshPresetSelect('preset:' + F.presets.list[0].id);
  applyPresetSelection();
  updateStyleHint();
})();
