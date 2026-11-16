/* Forexia — contrôleur de l'interface. */
(function () {
  'use strict';
  const F = window.Forexia;
  const $ = (id) => document.getElementById(id);
  const RULE_FIELDS = ['longEntry', 'longExit', 'shortEntry', 'shortExit'];
  // Gestion des trades (Forexia 1.2) : champ du formulaire = propriété de la stratégie.
  const TM_FIELDS = ['stopAtr', 'takeAtr', 'atrPeriod', 'trailPips', 'trailAtr', 'breakevenPips', 'breakevenAtr', 'maxBars', 'pauseLosses', 'pauseBars'];
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
  const BRIDGE_URL = 'http://127.0.0.1:8787';
  const BRIDGE_MIN = '1.5'; // version minimale de la passerelle attendue par cette page
  let bridgeToken = '';
  try { bridgeToken = localStorage.getItem('forexia.bridgeToken') || ''; } catch (e) { /* ignoré */ }
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
    let last = null;
    try { last = JSON.parse(localStorage.getItem('forexia.lastRun')); } catch (e) { /* ignoré */ }
    if (last && last.strategy) {
      html += '<optgroup label="Récupération"><option value="last">Dernière simulation : ' + esc(last.strategy.name) + ' (' +
        new Date(last.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) + ')</option></optgroup>';
    }
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
    for (const f of TM_FIELDS) { const v = Number($(f).value); if (v > 0) s[f] = v; }
    return s;
  }
  function loadStrategy(s) {
    $('stratName').value = s.name || '';
    for (const f of RULE_FIELDS) $(f).value = s[f] || '';
    $('stopLoss').value = s.stopLossPips || '';
    $('takeProfit').value = s.takeProfitPips || '';
    for (const f of TM_FIELDS) $(f).value = s[f] || '';
    if (TM_FIELDS.some((f) => s[f] > 0 && f !== 'atrPeriod')) $('tradeMgmt').open = true;
    $('plots').value = s.plots || '';
    $('frenchText').value = s.frenchText || '';
    $('presetDesc').textContent = s.description || '';
    appliedStyle = s.style || 'none';
    if (s.style !== undefined || !s.longEntry && !s.shortEntry) $('style').value = appliedStyle === 'none' && !s.style ? $('style').value : appliedStyle;
    frenchDirty = false;
    renderTranslation(s.frenchText ? F.french.parse(s.frenchText) : null);
    validateAll();
    try { updateEvalCount(); } catch (e) { /* pas encore initialisé au tout premier chargement */ }
  }
  // ---------- Configuration (paire, levier, capital…) enregistrée avec la stratégie ----------
  function currentConfig() {
    return {
      pair: $('pair').value, leverage: Number($('leverage').value), capital: Number($('capital').value),
      exposurePct: Number($('exposure').value), spreadPips: Number($('spread').value) || 0,
      period: periodValue(), dateFrom: $('dateFrom').value, dateTo: $('dateTo').value, source: sourceValue(),
      estimateWicks: $('estimateWicks').checked,
      withdraw: { on: $('withdrawOn').checked, pct: $('withdrawPct').value, share: $('withdrawShare').value, when: $('withdrawWhen').value,
        mode: $('withdrawMode').value, every: $('withdrawEvery').value, days: $('withdrawDays').value, type: $('withdrawType').value, value: $('withdrawValue').value },
      spreadMode: $('spreadMode').value, commission: Number($('commission').value) || 0,
      news: { on: $('newsOn').checked, mode: $('newsMode').value, impact: $('newsImpact').value, before: Number($('newsBefore').value) || 0, after: Number($('newsAfter').value) || 0 },
      broker: { symbol: $('brokerSymbol').value, tf: $('brokerTf').value, sizing: $('brokerSizing').value, lots: $('brokerLots').value,
        risk: $('brokerRisk').value, maxLots: $('brokerMaxLots').value, maxSpread: $('brokerMaxSpread').value, intrabar: $('brokerIntrabar').checked },
    };
  }
  function applyConfig(c) {
    if (!c) return;
    if (F.data.PAIRS.includes(c.pair)) { $('pair').value = c.pair; syncBrokerSymbol(false); }
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
    if (c.spreadMode) $('spreadMode').value = c.spreadMode;
    if (c.commission !== undefined) $('commission').value = c.commission;
    if (c.news) {
      $('newsOn').checked = !!c.news.on; $('newsMode').value = c.news.mode || 'block'; $('newsImpact').value = c.news.impact || 'high';
      $('newsBefore').value = c.news.before ?? 30; $('newsAfter').value = c.news.after ?? 30;
    }
    updateNewsUI();
    if (c.withdraw) {
      $('withdrawOn').checked = !!c.withdraw.on; $('withdrawPct').value = c.withdraw.pct; $('withdrawShare').value = c.withdraw.share;
      $('withdrawWhen').value = c.withdraw.when || 'close';
      $('withdrawMode').value = c.withdraw.mode || 'threshold'; $('withdrawEvery').value = c.withdraw.every || 'month';
      $('withdrawDays').value = c.withdraw.days || 30; $('withdrawType').value = c.withdraw.type || 'pct'; $('withdrawValue').value = c.withdraw.value || 5;
      updateWithdrawUI();
    }
    if (c.broker) {
      const b = c.broker;
      $('brokerSymbol').value = b.symbol; $('brokerTf').value = b.tf; $('brokerSizing').value = b.sizing; $('brokerLots').value = b.lots;
      $('brokerRisk').value = b.risk; $('brokerMaxLots').value = b.maxLots; $('brokerMaxSpread').value = b.maxSpread; $('brokerIntrabar').checked = b.intrabar;
      $('brokerSizing').dispatchEvent(new Event('change'));
      syncBrokerSymbol(false);
    }
    updateWicksField();
  }
  function updateWithdrawUI() {
    const on = $('withdrawOn').checked, periodic = $('withdrawMode').value === 'periodic';
    $('withdrawModeField').hidden = $('withdrawHint').hidden = !on;
    $('withdrawFields').hidden = $('withdrawWhenField').hidden = !on || periodic;
    $('withdrawPeriodic').hidden = !on || !periodic;
    $('withdrawDaysField').hidden = $('withdrawEvery').value !== 'days';
    const type = $('withdrawType').value;
    $('withdrawValueLabel').textContent = type === 'fixed' ? 'Somme (devise du compte)' : type === 'excess' ? 'Part de l\'excédent (%)' : 'Pourcentage du compte (%)';
    const cap = Number($('capital').value) || 0, pct = Number($('withdrawPct').value) || 0, share = Number($('withdrawShare').value) || 100;
    if (on && periodic) {
      const v = Number($('withdrawValue').value) || 0, days = Math.max(15, Number($('withdrawDays').value) || 30);
      const when = $('withdrawEvery').value === 'days' ? 'Tous les ' + days + ' jours' : 'Chaque mois (premier jour de cotation)';
      const what = type === 'fixed' ? money.format(v) + ' sont retirés, quel que soit le résultat'
        : type === 'excess' ? v + ' % de ce qui dépasse le capital de départ (' + money.format(cap) + ') est retiré ; rien si le compte est en dessous'
        : v + ' % du capital du compte est retiré, quel que soit le résultat (avec ' + money.format(cap) + ' : ' + money.format(cap * v / 100) + ' la première fois)';
      $('withdrawHint').textContent = when + ', ' + what + '. Comme chez un courtier, seule la marge libre peut être retirée : si une position bloque la marge, le retrait attend sa clôture. ' +
        'Chaque retrait est marqué d\'une étoile jaune sur les courbes.';
      return;
    }
    const now = $('withdrawWhen').value === 'immediate', target = money.format(cap * (1 + pct / 100));
    $('withdrawHint').textContent = !on ? '' : now
      ? 'Exemple : avec ' + money.format(cap) + ', dès que le compte touche ' + target + ', la position est clôturée et ' +
        (share >= 100 ? 'tout le gain est retiré (le compte revient à ' + money.format(cap) + ')' : share + ' % du gain est retiré') + '. Le trade suivant attend un nouveau signal.'
      : 'Exemple : avec ' + money.format(cap) + ', quand un trade se clôture avec le compte à ' + target + ' ou plus, ' +
        (share >= 100 ? 'tout le gain est retiré' : share + ' % du gain est retiré') + '. Le gain peut alors dépasser le seuil, car le trade continue jusqu\'à sa propre sortie.';
  }
  ['withdrawOn', 'withdrawPct', 'withdrawShare', 'withdrawWhen', 'capital', 'withdrawMode', 'withdrawEvery', 'withdrawDays', 'withdrawType', 'withdrawValue'].forEach((id) => { $(id).addEventListener('input', updateWithdrawUI); $(id).addEventListener('change', updateWithdrawUI); });
  updateWithdrawUI();
  function updateNewsUI() {
    $('newsFields').hidden = !$('newsOn').checked;
    const p = $('pair').value.split('/');
    $('newsHint').textContent = 'Annonces de ' + p.join(' et ') + ' seulement. Le calendrier vient de MetaTrader 5 (passerelle lancée et connectée) ; ' +
      'l\'EA déployé utilise le calendrier en direct, et dans le testeur MT5 le fichier exporté par la passerelle.';
  }
  $('newsOn').addEventListener('change', updateNewsUI);
  $('pair').addEventListener('change', updateNewsUI);
  updateNewsUI();

  // ---------- Calendrier économique (MT5, via la passerelle) ----------
  const calendarCache = new Map();
  /** Annonces [{t, currency, importance}] entre deux dates (secondes), ou null si la passerelle ne répond pas. */
  async function loadCalendar(from, to) {
    const key = from + '|' + to;
    if (calendarCache.has(key)) return calendarCache.get(key);
    if (!bridgeToken) return null;
    try {
      const r = await bridgeCall('GET', '/calendar?from=' + from + '&to=' + to);
      if (!r || !r.ok) return null;
      calendarCache.set(key, r.events || []);
      return r.events || [];
    } catch (e) { return null; }
  }
  async function refreshNewsStatus() {
    if (!bridgeToken) { $('newsStatus').textContent = 'Passerelle MT5 non connectée : connectez-la (source « Mon courtier » ou fenêtre « Déployer ») pour utiliser le calendrier.'; return; }
    try {
      const r = await bridgeCall('GET', '/calendar');
      if (r && r.ok) {
        const lo = r.events.reduce((m, e) => Math.min(m, e.t), Infinity), hi = r.events.reduce((m, e) => Math.max(m, e.t), 0);
        const day = (t) => frDate(new Date(t * 1000).toISOString().slice(0, 10));
        $('newsStatus').textContent = 'Calendrier MT5 : ' + r.events.length.toLocaleString('fr-FR') + ' annonces (impact moyen et fort)' +
          (r.events.length ? ', du ' + day(lo) + ' au ' + day(hi) : '') + ', exporté le ' + new Date(r.updated * 1000).toLocaleDateString('fr-FR') + '.';
      } else if (r && r.missing) $('newsStatus').textContent = 'Calendrier pas encore exporté : cliquez sur « Mettre à jour le calendrier depuis MT5 ».';
      else $('newsStatus').textContent = 'Passerelle à mettre à jour (version 1.5 ou plus) pour le calendrier économique.';
    } catch (e) { $('newsStatus').textContent = 'Passerelle MT5 injoignable : lancez-la sur votre PC.'; }
  }
  $('newsOn').addEventListener('change', () => { if ($('newsOn').checked) refreshNewsStatus(); });
  $('newsExport').addEventListener('click', async () => {
    if (!bridgeToken) { refreshNewsStatus(); return; }
    const btn = $('newsExport');
    btn.disabled = true; $('newsStatus').textContent = 'Export du calendrier par MetaTrader 5… (jusqu\'à quelques minutes)';
    try {
      const st = await bridgeCall('GET', '/status');
      const term = (st.terminals || [])[0];
      if (!term) throw new Error('MT5 introuvable sur ce PC.');
      const body = { terminalId: term.id, symbol: ($('brokerSymbol').value || $('pair').value.replace('/', '')) };
      let r = await bridgeCall('POST', '/calendar/export', body);
      if (r.needClose) {
        if (!confirm('MetaTrader 5 est ouvert : il va être fermé, puis relancé brièvement pour exporter le calendrier économique. Continuer ?')) { $('newsStatus').textContent = 'Export annulé.'; return; }
        r = await bridgeCall('POST', '/calendar/export', Object.assign(body, { closeTerminal: true }));
      }
      if (!r.ok) throw new Error(r.message || 'export impossible');
      calendarCache.clear();
      logEvent('calendar.exported', 'Calendrier économique exporté depuis MT5 : ' + r.count + ' annonces', { count: r.count });
      await refreshNewsStatus();
    } catch (e) {
      $('newsStatus').textContent = e.code === 401 ? 'Code de la passerelle incorrect : reconnectez-la.' : 'Échec : ' + e.message;
    } finally { btn.disabled = false; }
  });
  function newsTimes(events, pair, impact) {
    const cur = pair.split('/'), min = impact === 'medium' ? 2 : 3;
    return events.filter((e) => cur.includes(e.currency) && e.importance >= min).map((e) => e.t).sort((a, b) => a - b);
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
    if (v === 'last') {
      try {
        const last = JSON.parse(localStorage.getItem('forexia.lastRun'));
        loadStrategy(last.strategy); applyConfig(last.config);
        $('presetDesc').textContent = 'Dernière simulation récupérée. Pensez à « Enregistrer la stratégie ».';
      } catch (e) { /* ignoré */ }
      return;
    }
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
  $('adaptStyle').addEventListener('click', () => undoable('Adaptation au style', () => {
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
  }));
  $('preset').addEventListener('change', applyPresetSelection);

  function runKey(s, config) {
    return JSON.stringify([s.longEntry, s.longExit, s.shortEntry, s.shortExit, s.stopLossPips, s.takeProfitPips].concat(TM_FIELDS.map((f) => s[f] || 0), [config]));
  }
  // Enregistre la stratégie du formulaire (ou celle du dernier backtest) dans le navigateur.
  function saveStrategy(strat, config, stats) {
    const s = Object.assign({}, strat || currentStrategy());
    if (!strat && frenchDirty && s.frenchText) { translateFrench(); Object.assign(s, currentStrategy()); }
    s.config = config || currentConfig();
    if (!stats && lastRun && lastRun.key === runKey(s, s.config)) stats = lastRun.stats;
    s.lastResult = stats ? { returnPct: stats.returnPct, trades: stats.trades, winRate: stats.winRate, maxDrawdownPct: stats.maxDrawdownPct, finalEquity: stats.finalEquity } : null;
    s.savedAt = new Date().toISOString();
    if (!strat && !validateAll()) { $('formError').textContent = 'Corrigez les règles en rouge avant d\'enregistrer.'; return null; }
    if (!s.longEntry && !s.shortEntry) { $('formError').textContent = 'Rien à enregistrer : aucune règle d\'entrée.'; return null; }
    const list = storage.get();
    const idx = list.findIndex((x) => x.name === s.name);
    delete s.description;
    if (idx >= 0) list[idx] = s; else list.push(s);
    if (!storage.set(list) && !dbOn) { $('formError').textContent = 'Impossible d\'enregistrer : le stockage du navigateur est bloqué (navigation privée ?).'; return null; }
    dbPush('strategies/put', { name: s.name, data: s, updatedAt: s.savedAt });
    cloudPush(() => C.putStrategy(s));
    logEvent('strategy.saved', 'Stratégie enregistrée : ' + s.name + (s.config ? ' (' + describeConfig(s.config) + ')' : ''), { name: s.name });
    if ($('stratName').value.trim() === s.name || !$('stratName').value.trim()) {
      refreshPresetSelect('saved:' + (idx >= 0 ? idx : list.length - 1));
      $('deleteStrat').hidden = false;
      $('presetDesc').textContent = '« ' + s.name + ' » est enregistrée avec sa configuration (' + describeConfig(s.config) + '). Retrouvez-la dans Modèle → Mes stratégies.';
    } else {
      refreshPresetSelect($('preset').value);
    }
    return s;
  }
  $('saveStrat').addEventListener('click', () => undoable('Enregistrement de « ' + ($('stratName').value.trim() || 'Ma stratégie') + ' »', () => { $('formError').textContent = ''; saveStrategy(); }));
  $('deleteStrat').addEventListener('click', () => undoable('Suppression de la stratégie', () => {
    const v = $('preset').value;
    if (!v.startsWith('saved:')) return;
    const list = storage.get();
    const [removed] = list.splice(+v.slice(6), 1);
    storage.set(list);
    if (removed) { dbPush('strategies/delete', { name: removed.name }); cloudPush(() => C.deleteStrategy(removed.name)); logEvent('strategy.deleted', 'Stratégie supprimée : ' + removed.name, { strategy: removed }); toast('« ' + removed.name + ' » supprimée.', true); }
    refreshPresetSelect('preset:' + F.presets.list[0].id);
    applyPresetSelection();
    $('presetDesc').textContent = '« ' + (removed && removed.name) + ' » supprimée.';
  }));

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
      for (const f of TM_FIELDS) $(f).value = r[f] || '';
      if (TM_FIELDS.some((f) => r[f] > 0)) $('tradeMgmt').open = true;
      $('plots').value = r.plots;
      validateAll();
    }
    return r;
  }
  $('frenchText').addEventListener('input', () => { frenchDirty = true; markCustom(); });
  $('translateBtn').addEventListener('click', () => undoable('Traduction en règles', () => { $('formError').textContent = ''; translateFrench(); }));

  // ---------- Stratégie aléatoire ----------
  $('randomBtn').addEventListener('click', () => undoable('Stratégie aléatoire', () => {
    const style = $('style').value;
    let s = F.french.randomStrategy();
    if (style !== 'none') s = E.adaptToStyle(s, style, { rnd: Math.random });
    else s.style = 'none';
    loadStrategy(s);
    $('preset').value = 'mine';
    $('deleteStrat').hidden = true;
    $('presetDesc').textContent = s.description;
    logEvent('strategy.random', 'Stratégie aléatoire : ' + s.name, { strategy: s });
    $('form').requestSubmit();
  }));

  // ---------- Aide : éléments insérables ----------
  const CHIPS = [
    ['Indicateurs', ['RSI(14)', 'MACD(12,26,9)', 'MACD_SIGNAL(12,26,9)', 'MACD_HIST(12,26,9)', 'SMA(50)', 'EMA(20)',
      'STOCH_K(14,3,3)', 'STOCH_D(14,3,3)', 'BB_UPPER(20,2)', 'BB_MIDDLE(20,2)', 'BB_LOWER(20,2)', 'CCI(20)', 'WILLR(14)', 'ATR(14)', 'MOM(10)', 'ROC(10)']],
    ['Tendance (1.2)', ['ADX(14)', 'PLUS_DI(14)', 'MINUS_DI(14)', 'PSAR(0.02, 0.2)', 'SUPERTREND(10, 3)', 'SUPERTREND_DIR(10, 3)', 'SLOPE(EMA(50), 5)',
      'TENKAN(9)', 'KIJUN(26)', 'SENKOU_A(9, 26)', 'SENKOU_B(52, 26)']],
    ['Canaux et niveaux', ['DONCHIAN_UPPER(20)', 'DONCHIAN_LOWER(20)', 'KELTNER_UPPER(20, 2, 10)', 'KELTNER_LOWER(20, 2, 10)', 'PIVOT', 'PIVOT_R1', 'PIVOT_S1']],
    ['Bougies', ['HA_CLOSE', 'HA_OPEN', 'BULL_ENGULF', 'BEAR_ENGULF', 'HAMMER', 'SHOOTING_STAR', 'BULL_DIV(RSI(14), 14)', 'BEAR_DIV(RSI(14), 14)']],
    ['Prix et outils', ['CLOSE', 'OPEN', 'HIGH', 'LOW', 'PREV(CLOSE, 1)', 'HIGHEST(HIGH, 20)', 'LOWEST(LOW, 20)', 'ATR(14) * 2']],
    ['Temps', ['HOUR', 'WEEKDAY', 'DAY', 'MONTH', 'CLOSE@H4', 'EMA(50)@D1']],
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
  let brokerSpreadInfo = '';
  $('spreadMode').addEventListener('change', () => updateWicksField());
  function updateWicksField() {
    const src = sourceValue();
    $('wicksField').hidden = !(src === 'online' || (src === 'csv' && csvMeta && !csvMeta.real));
    $('brokerField').hidden = src !== 'broker';
    // Avec les données du courtier : spread réel bougie par bougie (par défaut), fixe, ou réel + marge.
    const mode = $('spreadMode').value;
    $('spreadModeField').hidden = src !== 'broker';
    $('spread').disabled = src === 'broker' && mode === 'real';
    $('spreadHint').hidden = src !== 'broker';
    $('spreadHint').textContent = src !== 'broker' ? '' : mode === 'real'
      ? 'Le spread historique de chaque bougie de votre courtier est utilisé, comme dans le testeur MT5' + (brokerSpreadInfo ? ' (médian sur la dernière simulation : ' + brokerSpreadInfo + ')' : '') + '. Choisissez « Fixe » ou « Réel + marge » pour saisir une valeur.'
      : mode === 'fixed' ? 'Chaque trade paie ce spread, quel que soit le moment : le résultat s\'écartera du testeur MT5.'
      : 'Le spread réel est augmenté de cette valeur : simulation plus prudente que le testeur MT5.';
    if (src === 'broker') brokerStatus();
  }
  document.querySelectorAll('input[name=source]').forEach((r) => r.addEventListener('change', updateWicksField));
  $('pair').addEventListener('change', () => {
    if (!(sourceValue() === 'csv' && csvMeta && csvMeta.spreadPips)) $('spread').value = F.data.TYPICAL_SPREAD[$('pair').value] || 1.5;
    syncBrokerSymbol(true);
  });
  // Le symbole MT5 suit la paire choisie ; un suffixe du courtier (GBPUSD.m, GBPUSDpro…) est conservé.
  function syncBrokerSymbol(force) {
    const code = $('pair').value.replace('/', ''), cur = $('brokerSymbol').value.trim();
    if (force || !cur || cur.toUpperCase().indexOf(code) !== 0) {
      const suffix = /^[A-Z]{6}(.*)$/i.exec(cur);
      $('brokerSymbol').value = code + (suffix ? suffix[1] : '');
    }
  }
  syncBrokerSymbol(false);
  $('brokerSizing').addEventListener('change', () => {
    $('brokerLotsField').hidden = $('brokerSizing').value !== 'fixed';
    $('brokerRiskField').hidden = $('brokerSizing').value !== 'risk';
  });

  // ---------- Données du courtier (via la passerelle) ----------
  let bridgeTerms = [];
  async function brokerStatus() {
    $('brokerConnectBox').hidden = true;
    $('brokerState').textContent = 'recherche…'; $('brokerState').className = 'pill';
    try {
      if (!bridgeToken) throw Object.assign(new Error('token'), { code: 401 });
      const st = await bridgeCall('GET', '/status');
      bridgeTerms = st.terminals || [];
      if (!bridgeTerms.length) throw new Error('MT5 introuvable');
      const old = !st.version || st.version < BRIDGE_MIN;
      if (!dbOn) dbConnect();
      $('brokerState').textContent = old ? 'passerelle à mettre à jour (v' + (st.version || '?') + ')' : 'connectée (v' + st.version + ')';
      $('brokerState').className = 'pill ' + (old ? 'ko' : 'ok');
      if (old) { $('brokerConnectBox').hidden = false; }
    } catch (e) {
      $('brokerState').textContent = e.code === 401 ? 'à connecter' : e.message === 'MT5 introuvable' ? 'MT5 introuvable' : 'passerelle non détectée';
      $('brokerState').className = 'pill ko';
      $('brokerConnectBox').hidden = false;
    }
  }
  $('brokerConnect').addEventListener('click', () => {
    bridgeToken = $('brokerToken').value.trim().toUpperCase();
    try { localStorage.setItem('forexia.bridgeToken', bridgeToken); } catch (e) { /* ignoré */ }
    brokerStatus();
  });
  const TF_MINUTES = { M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440 };
  const brokerCache = new Map();
  function toBar(r, intraday) {
    const iso = new Date(r[0] * 1000).toISOString();
    return { t: r[0], date: intraday ? iso.slice(0, 10) + ' ' + iso.slice(11, 16) : iso.slice(0, 10), open: r[1], high: r[2], low: r[3], close: r[4], spread: r[5] };
  }
  // Bougies fines reçues en colonnes -> objets (une seule fois par chargement).
  function subBars(sub) {
    if (!sub) return [];
    if (Array.isArray(sub)) return sub.map((x) => toBar(x, true));
    const out = new Array(sub.t.length);
    for (let i = 0; i < sub.t.length; i++) out[i] = { t: sub.t[i], open: sub.open[i], high: sub.high[i], low: sub.low[i], close: sub.close[i], spread: sub.spread[i] };
    return out;
  }
  async function loadBrokerBars(range) {
    if (!bridgeToken) throw new Error('Connectez la passerelle MT5 (section Données) pour utiliser les données de votre courtier.');
    const tf = $('brokerTf').value, symbol = $('brokerSymbol').value.trim(), code = $('pair').value.replace('/', '');
    if (symbol.toUpperCase().indexOf(code) !== 0) {
      throw new Error('Le symbole MT5 « ' + symbol + ' » ne correspond pas à la paire ' + $('pair').value + ' : corrigez « Symbole dans MT5 » (section Données).');
    }
    // Historique de préchauffage : 800 jours en D1, environ 1 300 bougies en intraday (l'EA en utilise 1 000).
    const warmDays = tf === 'D1' ? 800 : Math.ceil((1300 * TF_MINUTES[tf]) / 1440 * 7 / 5) + 4;
    const from = new Date(range.start); from.setUTCDate(from.getUTCDate() - warmDays);
    const to = new Date(range.end); to.setUTCDate(to.getUTCDate() + 1);
    const body = { terminalId: (bridgeTerms[0] || {}).id, symbol: symbol, timeframe: tf, from: F.data.iso(from), to: F.data.iso(to),
      testFrom: F.data.iso(range.start), intrabar: $('brokerIntrabar').checked };
    const key = JSON.stringify(body);
    if (!brokerCache.has(key)) {
      let r;
      try { r = await bridgeCall('POST', '/bars', body); } catch (e) {
        throw new Error(e.code === 401 ? 'Code d\'appairage refusé : reconnectez la passerelle (section Données).' : 'Passerelle MT5 injoignable : la fenêtre de la passerelle est-elle ouverte ?');
      }
      if (!r.ok) throw new Error(r.message || 'Données du courtier indisponibles.');
      brokerCache.set(key, r);
    }
    const r = brokerCache.get(key), intraday = tf !== 'D1';
    return {
      bars: r.bars.map((x) => toBar(x, intraday)), range: range, timeframe: tf, symbol: r.symbol,
      broker: { spec: r.spec, account: r.account, conv: r.conv, sub: subBars(r.sub) },
      source: 'Courtier MT5 ' + r.account.server + ' · ' + r.symbol + ' ' + tf + (r.subTimeframe ? ' (détail ' + r.subTimeframe + ')' : '') + ' · montants en ' + r.account.currency,
      info: 'Simulation avec les bougies, spreads et swaps de votre courtier, et les mêmes règles que l\'EA (lots arrondis, plafond, marge). ' +
        (r.conversionMissing ? '<b>Conversion vers ' + esc(r.account.currency) + ' introuvable : montants en ' + esc(r.spec.currencyProfit) + '.</b> ' : '') +
        (r.account.leverage !== Number($('leverage').value) ? 'Votre compte est en levier 1:' + r.account.leverage + ' ; le test utilise 1:' + $('leverage').value + ', comme le testeur MT5 lancé depuis Forexia.' : ''),
    };
  }
  updateWicksField();

  async function loadBars(pair, periodKey) {
    const src = sourceValue();
    if (src === 'broker') {
      const today = new Date(F.data.iso(new Date()) + 'T00:00:00Z');
      const range = rangeFor(periodKey, today);
      if (range.end > today) range.end = today;
      return loadBrokerBars(range);
    }
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
      const settings = {
        capital, leverage, exposurePct: exposure, spreadPips: spread, pair, startIndex, timeframe: loaded.timeframe || 'D1',
        sizing: $('brokerSizing').value, fixedLots: Number($('brokerLots').value) || 0.01, riskPct: Number($('brokerRisk').value) || 1,
        commissionPerLot: Number($('commission').value) || 0,
      };
      // Calendrier économique : chargé si la passerelle est là (filtre coché, ou pour le proposer dans « Améliorer »).
      const t0 = Math.floor(Date.parse(bars[0].date.slice(0, 10) + 'T00:00:00Z') / 1000), t1 = Math.floor(Date.parse(bars[bars.length - 1].date.slice(0, 10) + 'T00:00:00Z') / 1000) + 2 * 86400;
      const cal = await loadCalendar(t0, t1);
      if (cal) {
        settings.newsCalendar = newsTimes(cal, pair, $('newsImpact').value);
        settings.newsCurrencies = pair.split('/').join(' et ');
      }
      if ($('newsOn').checked) {
        if (cal) settings.news = { times: settings.newsCalendar, before: Number($('newsBefore').value) || 0, after: Number($('newsAfter').value) || 0, mode: $('newsMode').value };
      }
      if ($('withdrawOn').checked && $('withdrawMode').value === 'periodic') {
        settings.withdrawMode = 'periodic';
        settings.withdrawEvery = $('withdrawEvery').value;
        settings.withdrawDays = Math.max(15, Number($('withdrawDays').value) || 30);
        settings.withdrawType = $('withdrawType').value;
        settings.withdrawValue = Number($('withdrawValue').value) || 0;
        if (!(settings.withdrawValue > 0)) throw new Error('Indiquez le montant du retrait régulier.');
      } else if ($('withdrawOn').checked) {
        settings.withdrawPct = Number($('withdrawPct').value) || 0;
        settings.withdrawShare = Number($('withdrawShare').value) || 100;
        settings.withdrawWhen = $('withdrawWhen').value;
      }
      if (loaded.broker) {
        Object.assign(settings, {
          broker: loaded.broker, symbol: loaded.symbol, spreadMode: $('spreadMode').value,
          maxLots: Number($('brokerMaxLots').value) || 1, maxSpreadPips: Number($('brokerMaxSpread').value) || 0,
        });
      }
      const result = loaded.broker ? F.broker.runBrokerBacktest(bars, strat, settings, loaded.broker) : F.backtest.runBacktest(bars, strat, settings);
      const warnings = [];
      if (loaded.warning) warnings.push(loaded.warning);
      if (loaded.info) warnings.push({ info: true, html: loaded.info });
      if (leverage > 30) warnings.push({ info: true, html: 'Levier 1:' + leverage + ' : en Europe, le levier est plafonné à 1:30 sur les grandes paires pour un particulier. Vérifiez le levier réel de votre compte.' });
      if (startIndex < 200) warnings.push('Historique antérieur limité (' + startIndex + ' bougies) : les indicateurs à longue période (ex. EMA 200) peuvent être indisponibles en début de test.');
      if (strat.style === 'scalping' && sourceValue() !== 'csv' && !(loaded.broker && loaded.timeframe !== 'D1')) {
        warnings.push('<b>Scalping sur données journalières</b> : le scalping se joue sur des bougies de quelques minutes. Pour un test réaliste, importez un CSV en M1 à M15 (source « Mon fichier CSV »).');
      }
      for (const nt of result.notes || []) warnings.push({ info: true, html: esc(nt) });
      if (loaded.broker) {
        const sps = bars.slice(startIndex).map((b) => b.spread).filter((x) => x > 0).sort((a, b) => a - b);
        const pipPts = F.broker.pipOf(loaded.broker.spec) / loaded.broker.spec.point;
        brokerSpreadInfo = sps.length ? num1.format(sps[Math.floor(sps.length / 2)] / pipPts) + ' pip' : '';
        updateWicksField();
        if (settings.spreadMode !== 'real') {
          warnings.push({ info: true, html: (settings.spreadMode === 'fixed' ? 'Spread fixe de ' : 'Spread réel + ') + num1.format(spread) + (spread > 1 ? ' pips' : ' pip') +
            ' : choix volontaire, le résultat ne sera pas identique au testeur MT5 (qui utilise le spread historique).' });
        }
      }
      if ($('newsOn').checked && !settings.news) {
        warnings.push({ info: true, html: '<b>Annonces économiques non prises en compte</b> : le calendrier vient de MetaTrader 5, lancez et connectez la passerelle (source « Mon courtier » ou fenêtre « Déployer »).' });
      } else if (settings.news) {
        warnings.push({ info: true, html: 'Calendrier économique : ' + settings.news.times.length + ' annonces de ' + settings.newsCurrencies + ' sur la période' +
          (result.diag && result.diag.newsBlocked ? ', ' + result.diag.newsBlocked + ' entrée(s) évitée(s)' : '') + '.' +
          ((loaded.timeframe || 'D1') === 'D1' ? ' Heures du calendrier = heure du serveur MT5 ; avec des bougies journalières, le filtre couvre toute la journée de l\'annonce.' : '') });
      }
      if (result.diag && result.diag.paused) warnings.push({ info: true, html: 'Pause après des pertes : ' + result.diag.paused + ' entrée(s) évitée(s).' });
      if (settings.sizing === 'risk' && !(strat.stopLossPips > 0 || strat.stopAtr > 0)) warnings.push({ info: true, html: 'Taille « % du capital risqué » sans stop-loss : ' + (loaded.broker ? 'lots fixes utilisés.' : 'taille « capital × exposition × levier » utilisée.') });
      if (result.ruined) warnings.push('<b>Compte liquidé</b> : le capital a été entièrement perdu. Réduisez le levier ou l\'exposition.');
      const config = currentConfig();
      lastRunCtx = { bars, strat, settings, config, timeframe: loaded.timeframe || 'D1', lastTrades: result.trades, diag: result.diag };
      lastRun = { key: runKey(strat, config), stats: result.stats };
      render({ bars, strat, settings, result, loaded, periodKey, warnings, config });
      syncFormState();
      recordEvaluation({ bars, strat, settings, result, loaded, periodKey, config });
      // Filet de sécurité : la dernière stratégie simulée est gardée, même non enregistrée.
      const lastRunRec = { at: new Date().toISOString(), strategy: strat, config: config };
      try { localStorage.setItem('forexia.lastRun', JSON.stringify(lastRunRec)); } catch (e) { /* ignoré */ }
      cloudPush(() => C.putSettings({ lastRun: lastRunRec }));
      refreshPresetSelect($('preset').value);
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
    const dec = settings.broker ? settings.broker.spec.digits : /JPY/.test(settings.pair) ? 3 : 5;
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
    // Rentabilité mensuelle (indicateur + fenêtre de détail)
    const ms = monthlyStats(result, settings.capital);
    const hasWd = ms.totalWithdrawn > 0, wdOn = !!settings.withdrawPct || settings.withdrawMode === 'periodic';
    // Avec les retraits : le profit est ce qui a été retiré ; le résultat global (avec le capital restant) reste indiqué.
    const perMonth = wdOn ? ms.avgWithdrawn : ms.avg;
    html += '<div class="kpis">' +
      (wdOn
        ? kpi('Capital restant', money.format(s.finalAccount), 'départ ' + money.format(s.initialCapital), cls(s.finalAccount - s.initialCapital)) +
          kpi('Profit retiré', money.format(s.totalWithdrawn || 0), (s.withdrawals || 0) + ' retrait' + (s.withdrawals > 1 ? 's' : '') + ' · résultat global ' +
            signed(s.netProfit, money) + ' (' + signed(s.returnPct, num1) + ' %)', s.totalWithdrawn > 0 ? 'pos' : '')
        : kpi('Capital final', money.format(s.finalEquity), 'départ ' + money.format(s.initialCapital)) +
          kpi('Profit net', signed(s.netProfit, money), signed(s.returnPct, num2) + ' %', cls(s.netProfit))) +
      '<div class="panel kpi"><div class="label">Rentabilité mensuelle</div><div class="value ' + cls(perMonth) + '">' + (wdOn ? money.format(perMonth) : signed(perMonth, money)) +
        '<small> /mois</small></div><div class="sub">' + (wdOn ? 'retiré en moyenne · ' : '') + signed((perMonth / settings.capital) * 100, num2) + ' % du capital · ' +
        '<button type="button" class="link" id="monthlyBtn">Voir les détails</button></div></div>' +
      kpi('Trades', String(s.trades), num1.format(s.winRate) + ' % gagnants') +
      kpi('Profit factor', Number.isFinite(s.profitFactor) ? num2.format(s.profitFactor) : '∞', 'gains / pertes', s.profitFactor >= 1 ? 'pos' : s.trades ? 'neg' : '') +
      kpi('Drawdown max', '−' + num2.format(s.maxDrawdownPct) + ' %', '−' + money.format(s.maxDrawdownAmount), s.maxDrawdownPct > 0 ? 'neg' : '') +
      kpi('Ratio de Sharpe', signed(s.sharpe, num2), 'annualisé', cls(s.sharpe)) +
      '</div>';

    const mk = (label, value, sub, c) => '<div><div class="label">' + label + '</div><div class="value ' + (c || '') + '">' + value + '</div><div class="sub">' + (sub || '&nbsp;') + '</div></div>';
    const monthlyHtml = '<div class="card-head"><h3>Mois par mois</h3><div class="legend"><span><i style="background:var(--up)"></i>Mois gagnant</span>' +
      '<span><i style="background:var(--down)"></i>Mois perdant</span>' + (hasWd ? '<span><i class="star-ico"></i>Retrait</span>' : '') + '</div></div>' +
      '<div class="monthly-kpis">' +
      mk(hasWd ? 'Résultat global par mois (compte + retraits)' : 'Rapporte en moyenne par mois', signed(ms.avg, money), signed(ms.avgPct, num2) + ' % du capital de départ, sur ' + num1.format(ms.nMonths) + ' mois', cls(ms.avg)) +
      (hasWd ? mk('Retiré en moyenne par mois', money.format(ms.avgWithdrawn), 'total retiré ' + money.format(ms.totalWithdrawn), 'pos') : '') +
      mk('Mois gagnants', ms.positive + ' / ' + ms.months.length, num1.format((100 * ms.positive) / ms.months.length) + ' % des mois') +
      mk('Meilleur mois', signed(ms.best.gain, money), monthLong(ms.best.key), cls(ms.best.gain)) +
      mk('Pire mois', signed(ms.worst.gain, money), monthLong(ms.worst.key), cls(ms.worst.gain)) +
      '</div><div id="monthlyChart"></div>' +
      '<details class="help"><summary>Détail par mois</summary><div class="table-wrap"><table class="months"><thead><tr><th class="l">Mois</th><th>Gain</th><th>Variation</th>' +
      (hasWd ? '<th>Retiré</th>' : '') + '<th>' + (hasWd ? 'Compte + retraits' : 'Capital') + ' en fin de mois</th></tr></thead><tbody>' +
      ms.months.map((m) => '<tr><td class="l">' + monthLong(m.key) + '</td><td class="' + cls(m.gain) + '">' + signed(m.gain, money) + '</td><td class="' + cls(m.pct) + '">' +
        signed(m.pct, num1) + ' %</td>' + (hasWd ? '<td>' + (m.withdrawn ? money.format(m.withdrawn) : '—') + '</td>' : '') + '<td>' + money.format(m.end) + '</td></tr>').join('') +
      '</tbody></table></div></details>';

    // Capital moyen sur la période : moyenne de la courbe, et le gain moyen qu'elle représente.
    const hasW = result.withdrawals && result.withdrawals.length;
    const avg = averageGain(result.wealth || result.equity, settings.capital);
    html += '<div class="panel card"><div class="card-head"><h3>Évolution du capital</h3>' +
      '<div class="legend"><span><i style="background:var(--s1)"></i>' + (hasW ? 'Compte de trading' : 'Capital') + '</span>' +
      (hasW ? '<span><i style="background:var(--up)"></i>Compte + retraits</span><span><i class="star-ico"></i>Retrait</span>' : '') + '<span><i style="background:var(--s2)"></i>Moyenne : ' +
      money.format(avg.mean) + ' (<span class="' + cls(avg.pct) + '">' + signed(avg.pct, num1) + ' %</span>)</span>' +
      '<span><i style="background:var(--muted)"></i>Capital initial</span></div></div><div id="equityChart"></div></div>';

    html += '<div class="panel card"><div class="card-head"><h3>Cours et positions</h3><div class="legend" id="priceLegend"></div></div>' +
      '<div class="chart-tools"><div class="tf-bar" id="tfBar" role="group" aria-label="Unité de temps du graphique"></div>' +
      '<select id="histPick" aria-label="Historique affiché"><option value="test">Période testée</option><option value="1y">1 an</option><option value="3y">3 ans</option>' +
      '<option value="10y">10 ans</option><option value="all">Tout l\'historique</option></select>' +
      '<button type="button" class="chip" id="zoomOut" title="Dézoomer">−</button><button type="button" class="chip" id="zoomIn" title="Zoomer">+</button>' +
      '<button type="button" class="chip" id="zoomReset" title="Revenir à l\'historique choisi">⟲</button></div>' +
      '<p class="hint" id="chartNote"></p>' +
      '<div class="chart-tools"><select id="indPick" aria-label="Ajouter un indicateur"><option value="">+ Indicateur…</option>' +
      IND_CHOICES.map(([g, list]) => '<optgroup label="' + g + '">' + list.map((x) => '<option value="' + esc(x[1]) + '">' + esc(x[0]) + '</option>').join('') + '</optgroup>').join('') +
      '<option value="?">Autre (formule)…</option></select><span id="indChips"></span></div>' +
      '<div id="priceChart"></div>' +
      '<div class="chart-tools"><button type="button" class="chip" id="drawLine">╱ Ligne de tendance</button><button type="button" class="chip" id="drawH">― Support / résistance</button>' +
      '<span class="hint" id="drawHint"></span></div><div class="draw-list" id="drawList"></div></div>';

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
      (wdOn
        ? row('Total retiré', money.format(s.totalWithdrawn || 0), s.totalWithdrawn > 0 ? 'pos' : '') +
          row('Nombre de retraits (' + withdrawLabel(settings) + ')', String(s.withdrawals || 0)) +
          row('Solde final du compte de trading', money.format(s.finalAccount))
        : '') +
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

    monthlyView = { html: monthlyHtml, sub: strat.name + ' · ' + settings.pair + ' · du ' + frDate(dates[0]) + ' au ' + frDate(dates[dates.length - 1]), bars: {
      labels: ms.months.map((m) => monthLabel(m.key)), values: ms.months.map((m) => m.gain), ariaLabel: 'Gain de chaque mois',
      format: (v) => compact(v), stars: ms.months.map((m, i) => (m.withdrawn > 0 ? i : -1)).filter((i) => i >= 0),
      titles: ms.months.map((m) => monthLong(m.key) + ' : ' + signed(m.gain, money) + ' (' + signed(m.pct, num1) + ' %)' + (m.withdrawn ? ' · retiré ' + money.format(m.withdrawn) : '')),
    } };
    $('monthlyBtn').addEventListener('click', openMonthly);

    // Graphique du capital
    F.chart.mount($('equityChart'), {
      labels: dates, formatLabel: shortDate, ariaLabel: 'Évolution du capital',
      panels: [{
        height: 220, format: (v, full) => (full ? money.format(v) : compact(v)),
        series: [{ name: hasW ? 'Compte' : 'Capital', values: result.equity, color: 'var(--s1)', width: 2, fill: true }]
          .concat(hasW ? [{ name: 'Compte + retraits', values: result.wealth, color: 'var(--up)', width: 1.8, dash: '5 3' }] : []),
        // étoile jaune au sommet de la courbe, au moment du retrait
        markers: (result.withdrawals || []).map((w) => ({ i: w.index - result.startIndex, value: w.accountAfter + w.amount, shape: 'star', color: 'var(--star)',
          title: 'Retrait du ' + frDate(w.date) + ' : ' + money.format(w.amount) + ' (total ' + money.format(w.total) + ')' })),
        refLines: [{ value: settings.capital, color: 'var(--muted)' },
          { value: avg.mean, color: 'var(--s2)', strong: true, label: 'Moyenne ' + signed(avg.pct, num1) + ' %' }],
      }],
    });

    // Graphique des cours, indicateurs et trades : unité de temps, historique et zoom au choix (comme MT4 / MT5).
    const ctxR = F.rules.makeContext(bars);
    const baseTf = loaded.timeframe || 'D1';
    chartView = {
      bars: bars, st: st, ctxR: ctxR, pair: settings.pair, dec: dec, pfmt: pfmt, baseTf: baseTf, src: config.source,
      symbol: settings.symbol || loaded.symbol || $('brokerSymbol').value, runT: ctxR.t, testFromT: ctxR.t[st], testToT: ctxR.t[ctxR.t.length - 1],
      trades: result.trades, visT: [],
    };
    if (chartState.pair !== settings.pair || chartState.baseTf !== baseTf || chartState.src !== config.source) {
      Object.assign(chartState, { pair: settings.pair, baseTf: baseTf, src: config.source, tf: baseTf, hist: 'test', win: null });
    }
    let drawToken = 0;
    drawPrice = async () => {
    const token = ++drawToken;
    renderChartTools();
    let got;
    try { got = await chartBars(); } catch (e) { got = { bars: bars, tf: baseTf, note: 'Historique indisponible : ' + e.message }; chartState.tf = baseTf; }
    if (token !== drawToken) return;
    const cb = got.bars, ctxC = F.rules.makeContext(cb), tC = ctxC.t;
    const endT = tC[tC.length - 1];
    const def = { t0: Math.max(tC[0], histFrom()), t1: endT };
    const win = chartState.win || def;
    let i0 = tC.findIndex((t) => t >= win.t0); if (i0 < 0) i0 = 0;
    let i1 = tC.length - 1; while (i1 > 0 && tC[i1] > win.t1) i1--;
    if (i1 - i0 < 10) { i0 = Math.max(0, i1 - 10); }
    let capped = false;
    if (!chartState.win && i1 - i0 > 2000) { i0 = i1 - 2000; capped = true; } // comme MT4 : les plus récentes d'abord
    chartView.cbFirstT = tC[0]; chartView.cbLastT = endT; chartView.win = { t0: tC[i0], t1: tC[i1] };
    const vis = cb.slice(i0, i1 + 1), visT = tC.slice(i0, i1 + 1);
    chartView.visT = visT;
    const vdates = vis.map((b) => b.date);
    const overlays = [], oscillators = [];
    const closes = vis.map((b) => b.close);
    const pMin = Math.min(...closes), pMax = Math.max(...closes);
    let colorIdx = 0;
    for (const expr of splitTopLevel($('plots').value || '')) {
      let values;
      try { values = F.rules.evaluateSeries(expr, ctxC).slice(i0, i1 + 1); } catch (e) { continue; }
      const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
      if (!finite.length) continue;
      const med = finite[Math.floor(finite.length / 2)];
      const ser = { name: expr.replace(/\s+/g, ''), values: values, color: SERIES_COLORS[colorIdx++ % SERIES_COLORS.length], width: 1.4 };
      if (med > pMin * 0.7 && med < pMax * 1.3) overlays.push(ser); else oscillators.push(ser);
    }
    // trades placés sur la bougie (de l'unité affichée) qui contient leur heure
    const idxOf = (t) => { let lo = 0, hi = visT.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (visT[m] <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
    const markers = [], tipAt = new Map();
    const inView = (t) => t >= visT[0] && t <= visT[visT.length - 1] + (F.data.TF_SECONDS[got.tf] || 86400);
    for (const t of result.trades) {
      const te = chartView.runT[t.entryIndex], tx = chartView.runT[t.exitIndex];
      if (inView(te)) {
        const ei = idxOf(te);
        markers.push({ i: ei, value: t.entryPrice, shape: t.dir > 0 ? 'up' : 'down', color: t.dir > 0 ? 'var(--up)' : 'var(--down)',
          title: (t.dir > 0 ? 'Achat' : 'Vente') + ' ' + frDate(t.entryDate) + ' à ' + pfmt(t.entryPrice) });
        tipAt.set(ei, '<b class="' + (t.dir > 0 ? 'pos' : 'neg') + '">' + (t.dir > 0 ? '▲ Achat' : '▼ Vente') + '</b>');
      }
      if (inView(tx)) {
        const xi = idxOf(tx);
        markers.push({ i: xi, value: t.exitPrice, shape: 'dot', color: t.pnl > 0 ? 'var(--up)' : 'var(--down)',
          title: 'Sortie (' + t.reason + ') ' + frDate(t.exitDate) + ' à ' + pfmt(t.exitPrice) + ' : ' + signed(t.pnl, money) });
        tipAt.set(xi, '<b class="' + cls(t.pnl) + '">● Sortie : ' + signed(t.pnl, money) + '</b>');
      }
    }
    const drawSeries = drawingsFor(settings.pair).map((d, k) => ({
      name: drawingName(d, k), values: visT.map((t) => drawingValue(d, t)), color: DRAW_COLORS[k % DRAW_COLORS.length],
      dash: d.type === 'h' ? '6 4' : '', noScale: true, label: String(k + 1), width: 2.2,
    }));
    const panels = [{ height: 300, format: pfmt, series: [{ name: settings.pair + ' ' + got.tf, values: closes, color: 'var(--price)', width: 1.5 }].concat(overlays, drawSeries), markers: markers }];
    // Regroupe les oscillateurs de même famille (ex. MACD + signal) dans un même panneau.
    const groups = new Map();
    for (const o of oscillators) {
      const fam = o.name.replace(/@.*$/, '').replace(/\(.*$/, '').replace(/_(SIGNAL|HIST|K|D)$/, '').replace(/^(PLUS_DI|MINUS_DI)$/, 'ADX');
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
    // période testée grisée
    const sFrom = visT.findIndex((t) => t >= chartView.testFromT);
    const intraday = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4'].includes(got.tf);
    F.chart.mount($('priceChart'), {
      labels: vdates, formatLabel: (d) => (intraday && vis.length < 400 ? frDate(String(d).slice(0, 10)).slice(0, 5) + (String(d).length > 10 ? ' ' + String(d).slice(11, 16) : '') : shortDate(d)),
      panels: panels, ariaLabel: 'Cours de ' + settings.pair + ' en ' + got.tf + ' avec les trades',
      shade: sFrom >= 0 && (chartState.hist !== 'test' || chartState.win) ? { from: sFrom, to: vis.length - 1, label: 'Période testée' } : null,
      draw: drawMode ? { mode: drawMode, pending: drawPending, onPoint: onDrawPoint } : null,
      onZoom: chartZoom, onPan: chartPan,
      extraTip: (i) => (tipAt.has(i) ? '<div style="margin-top:4px">' + tipAt.get(i) + '</div>' : ''),
    });
    $('chartNote').textContent = (got.note ? got.note + ' ' : '') + (capped ? 'Les 2 000 dernières bougies (dézoomez ou défilez pour voir plus) : ' : '') + vis.length + ' bougies ' + got.tf + ', du ' + frDate(String(vdates[0]).slice(0, 10)) + ' au ' + frDate(String(vdates[vdates.length - 1]).slice(0, 10)) +
      ' · molette : zoom, glisser : défiler';
    $('priceLegend').innerHTML = '<span><i style="background:var(--price)"></i>' + esc(settings.pair) + ' ' + got.tf + '</span>' +
      overlays.map((o) => '<span><i style="background:' + o.color + '"></i>' + esc(o.name) + '</span>').join('') +
      '<span><i class="tri-up"></i>Achat</span><span><i class="tri-dn"></i>Vente</span><span><i class="dot" style="background:var(--muted)"></i>Sortie</span>';
    renderIndChips();
    renderDrawList();
    };
    drawPrice();
    $('indPick').addEventListener('change', onIndPick);
    $('histPick').addEventListener('change', () => { chartState.hist = $('histPick').value; chartState.win = null; drawPrice(); });
    $('zoomIn').addEventListener('click', () => chartZoom(0.6, 0.5));
    $('zoomOut').addEventListener('click', () => chartZoom(1.6, 0.5));
    $('zoomReset').addEventListener('click', () => { chartState.win = null; drawPrice(); });
    $('drawLine').addEventListener('click', () => setDrawMode(drawMode === 'line' ? null : 'line'));
    $('drawH').addEventListener('click', () => setDrawMode(drawMode === 'h' ? null : 'h'));
    setDrawMode(null, true);


    $('enhanceBtn').addEventListener('click', openEnhancer);
    $('deployBtn').addEventListener('click', openDeploy);
    $('saveFromResults').addEventListener('click', () => {
      let saved = null;
      undoable('Enregistrement de « ' + strat.name + ' »', () => { saved = saveStrategy(strat, config, s); });
      if (saved) { $('saveFromResults').textContent = 'Enregistrée ✓'; $('saveFromResults').disabled = true; }
    });
    const exp = $('exportCsv');
    if (exp) exp.addEventListener('click', () => exportTrades(result.trades, strat, settings));
    if (window.matchMedia('(max-width: 900px)').matches) $('results').scrollIntoView({ behavior: 'smooth' });
  }

  /**
   * Rentabilité mensuelle : gain de chaque mois = variation de « compte + retraits » sur le mois,
   * montants retirés par mois, et moyennes rapportées à la durée réelle de la période.
   */
  function monthlyStats(result, capital) {
    const w = result.wealth || result.equity, dates = result.dates, months = [];
    let cur = null;
    for (let j = 0; j < dates.length; j++) {
      const k = dates[j].slice(0, 7);
      if (!cur || cur.key !== k) { cur = { key: k, end: w[j], withdrawn: 0 }; months.push(cur); } else cur.end = w[j];
    }
    let prev = capital;
    for (const mo of months) { mo.gain = mo.end - prev; mo.pct = prev ? (mo.gain / prev) * 100 : 0; prev = mo.end; }
    for (const x of result.withdrawals || []) { const mo = months.find((m) => m.key === x.date.slice(0, 7)); if (mo) mo.withdrawn += x.amount; }
    const days = (Date.parse(dates[dates.length - 1].slice(0, 10)) - Date.parse(dates[0].slice(0, 10))) / 864e5;
    const nMonths = Math.max(1, days / 30.4375);
    const total = w[w.length - 1] - capital, totalW = months.reduce((a, m) => a + m.withdrawn, 0);
    const sorted = months.slice().sort((a, b) => a.gain - b.gain);
    return {
      months: months, nMonths: nMonths, avg: total / nMonths, avgPct: (total / nMonths / capital) * 100, avgWithdrawn: totalW / nMonths, totalWithdrawn: totalW,
      positive: months.filter((m) => m.gain > 0).length, best: sorted[sorted.length - 1], worst: sorted[0],
    };
  }
  const monthLabel = (key) => shortDate(key + '-01');
  const monthLong = (key) => { const d = new Date(key + '-01T00:00:00Z'); return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }); };

  // Fenêtre « Rentabilité mensuelle » : contenu préparé au rendu, graphique dessiné à l'ouverture (largeur connue).
  let monthlyView = null;
  function openMonthly() {
    if (!monthlyView) return;
    $('monthlySub').textContent = monthlyView.sub;
    $('monthlyBody').innerHTML = monthlyView.html;
    $('monthlyModal').hidden = false;
    document.body.style.overflow = 'hidden';
    F.chart.mountBars($('monthlyChart'), monthlyView.bars);
    $('monthlyModal').querySelector('.close').focus();
  }
  function closeMonthly() { $('monthlyModal').hidden = true; document.body.style.overflow = ''; }
  $('monthlyModal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeMonthly(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('monthlyModal').hidden) closeMonthly(); });

  // ---------- Indicateurs sous la courbe et repères dessinés ----------
  const IND_CHOICES = [
    ['Sous la courbe', [['RSI 14', 'RSI(14)'], ['MACD 12/26/9', 'MACD(12,26,9), MACD_SIGNAL(12,26,9), MACD_HIST(12,26,9)'], ['Stochastique 14/3/3', 'STOCH_K(14,3,3), STOCH_D(14,3,3)'],
      ['ADX 14 et DMI', 'ADX(14), PLUS_DI(14), MINUS_DI(14)'], ['ATR 14', 'ATR(14)'], ['CCI 20', 'CCI(20)'], ['Williams %R 14', 'WILLR(14)'], ['Momentum 10', 'MOM(10)'],
      ['ROC 10', 'ROC(10)'], ['Pente de l\'EMA 50', 'SLOPE(EMA(50), 5)'], ['Direction SuperTrend', 'SUPERTREND_DIR(10,3)']]],
    ['Sur la courbe', [['SMA 20', 'SMA(20)'], ['SMA 50', 'SMA(50)'], ['EMA 20', 'EMA(20)'], ['EMA 200', 'EMA(200)'], ['Bollinger 20/2', 'BB_UPPER(20,2), BB_MIDDLE(20,2), BB_LOWER(20,2)'],
      ['SuperTrend 10/3', 'SUPERTREND(10,3)'], ['SAR parabolique', 'PSAR(0.02,0.2)'], ['Donchian 20', 'DONCHIAN_UPPER(20), DONCHIAN_LOWER(20)'],
      ['Keltner 20', 'KELTNER_UPPER(20,2,10), KELTNER_LOWER(20,2,10)'], ['Ichimoku Tenkan / Kijun', 'TENKAN(9), KIJUN(26)'], ['Points pivots', 'PIVOT, PIVOT_R1, PIVOT_S1']]],
  ];
  const DRAW_COLORS = ['#ea580c', '#16a34a', '#e11d48', '#4f46e5', '#65a30d', '#b45309'];
  let chartView = null, drawPrice = () => {}, drawMode = null, drawPending = null;
  // Unité de temps, historique et fenêtre visible du graphique des cours
  const chartState = { tf: 'D1', hist: 'test', win: null, pair: null, baseTf: null, src: null };
  const chartCache = new Map();
  const YEAR = 365 * 86400;
  function histFrom() {
    const v = chartView, end = v.testToT;
    return { test: v.testFromT, '1y': end - YEAR, '3y': end - 3 * YEAR, '10y': end - 10 * YEAR, all: Date.parse(F.data.ECB_FIRST_DATE + 'T00:00:00Z') / 1000 }[chartState.hist];
  }
  function tfAllowed(tf) {
    const v = chartView;
    if (v.src === 'broker') return true; // MT5 fournit toutes les unités de temps
    return F.data.TF_ORDER.indexOf(tf) >= F.data.TF_ORDER.indexOf(v.baseTf);
  }
  function renderChartTools() {
    if (!$('tfBar')) return;
    $('tfBar').innerHTML = F.data.TF_ORDER.map((tf) => '<button type="button" data-tf="' + tf + '"' + (tf === chartState.tf ? ' class="on"' : '') +
      (tfAllowed(tf) ? '' : ' disabled title="Données trop peu détaillées : unité plus fine disponible avec la source « Mon courtier (MetaTrader 5) »"') + '>' + tf + '</button>').join('');
    $('tfBar').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { chartState.tf = b.dataset.tf; drawPrice(); }));
    $('histPick').value = chartState.hist;
  }
  /** Bougies du graphique dans l'unité choisie, avec l'historique demandé (récupéré si besoin). */
  async function chartBars() {
    const v = chartView, tf = chartState.tf, want = histFrom();
    const firstT = F.data.barTime(v.bars[0]), endDay = new Date(v.testToT * 1000 + 86400000);
    if (v.src === 'broker' && (tf !== v.baseTf || want < firstT)) {
      // MT5 : bougies demandées directement dans l'unité choisie (au plus ~40 000 bougies)
      const sec = F.data.TF_SECONDS[tf], from = Math.max(Math.min(want, firstT), v.testToT - 40000 * sec * 1.4);
      const body = { terminalId: (bridgeTerms[0] || {}).id, symbol: v.symbol, timeframe: tf === 'MN' ? 'MN1' : tf, from: F.data.iso(new Date(from * 1000)), to: F.data.iso(endDay), intrabar: false };
      const key = 'mt5|' + JSON.stringify(body);
      if (!chartCache.has(key)) {
        $('chartNote').textContent = 'Chargement des bougies ' + tf + ' depuis MT5…';
        const r = await bridgeCall('POST', '/bars', body);
        if (!r.ok) throw new Error(r.message || 'données MT5 indisponibles');
        chartCache.set(key, r.bars.map((x) => toBar(x, !['D1', 'W1', 'MN'].includes(tf))));
      }
      return { bars: chartCache.get(key), tf: tf };
    }
    let base = v.bars, note = '';
    if (want < firstT - 5 * 86400) {
      if (v.src === 'online') {
        const from = new Date(Math.max(want, Date.parse(F.data.ECB_FIRST_DATE + 'T00:00:00Z') / 1000) * 1000);
        const key = v.pair + '|' + F.data.iso(from) + '|' + F.data.iso(endDay);
        if (!onlineCache.has(key)) { $('chartNote').textContent = 'Téléchargement de l\'historique BCE…'; onlineCache.set(key, await F.data.fetchFrankfurter(v.pair, from, endDay)); }
        base = $('estimateWicks').checked ? F.data.estimateWicks(onlineCache.get(key)) : onlineCache.get(key);
      } else note = 'Historique limité aux données chargées (' + (v.src === 'csv' ? 'fichier CSV' : 'données simulées') + ').';
    }
    return { bars: tf === v.baseTf ? base : F.data.resample(base, tf), tf: tf, note: note };
  }
  let zoomRaf = 0;
  function chartZoom(f, frac) {
    const v = chartView; if (!v || !v.win) return;
    const span = v.win.t1 - v.win.t0, minSpan = 20 * (F.data.TF_SECONDS[chartState.tf] || 86400);
    const ns = Math.max(minSpan, Math.min(v.cbLastT - v.cbFirstT, span * f));
    let t0 = v.win.t0 + frac * span - frac * ns;
    t0 = Math.max(v.cbFirstT, Math.min(t0, v.cbLastT - ns));
    chartState.win = { t0: t0, t1: t0 + ns };
    cancelAnimationFrame(zoomRaf); zoomRaf = requestAnimationFrame(() => drawPrice());
  }
  function chartPan(d) {
    const v = chartView; if (!v || !v.win) return;
    const span = v.win.t1 - v.win.t0;
    let t0 = Math.max(v.cbFirstT, Math.min(v.win.t0 + d * span, v.cbLastT - span));
    chartState.win = { t0: t0, t1: t0 + span };
    drawPrice();
  }
  function plotList() { return splitTopLevel($('plots').value || '').map((x) => x.trim()).filter(Boolean); }
  function renderIndChips() {
    $('indChips').innerHTML = plotList().map((p, k) => '<span class="ind-chip">' + esc(p.replace(/\s+/g, '')) + '<button type="button" data-k="' + k + '" aria-label="Retirer ' + esc(p) + '">×</button></span>').join(' ');
    $('indChips').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => undoable('Indicateur retiré', () => {
      const l = plotList(); l.splice(+b.dataset.k, 1); $('plots').value = l.join(', '); drawPrice();
    })));
  }
  function onIndPick() {
    let v = $('indPick').value;
    $('indPick').value = '';
    if (!v) return;
    if (v === '?') { v = (prompt('Indicateur ou formule à afficher (ex. RSI(9), EMA(100), ATR(14) / CLOSE * 100) :') || '').trim(); if (!v) return; }
    for (const x of splitTopLevel(v)) { const err = F.rules.validate(x.trim()); if (err) { alert('Formule invalide : ' + err); return; } }
    undoable('Indicateur ajouté', () => {
      const l = plotList();
      for (const x of splitTopLevel(v).map((y) => y.trim())) if (!l.some((y) => y.replace(/\s+/g, '') === x.replace(/\s+/g, ''))) l.push(x);
      $('plots').value = l.join(', ');
      drawPrice();
    });
  }
  // Repères : par paire, en heure (secondes) et prix, pour rester valables quelle que soit la période affichée.
  function drawingsAll() { try { return JSON.parse(localStorage.getItem('forexia.drawings') || '{}'); } catch (e) { return {}; } }
  function drawingsFor(pair) { return drawingsAll()[pair] || []; }
  function saveDrawings(pair, list) {
    const all = drawingsAll(); all[pair] = list;
    try { localStorage.setItem('forexia.drawings', JSON.stringify(all)); } catch (e) { /* ignoré */ }
  }
  function drawingValue(d, t) { return d.type === 'h' ? d.v : t >= d.t1 ? d.v1 + ((d.v2 - d.v1) * (t - d.t1)) / (d.t2 - d.t1) : NaN; }
  const dayOf = (t) => frDate(new Date(t * 1000).toISOString().slice(0, 10));
  function drawingName(d, k) {
    const f = chartView ? chartView.pfmt : (v) => String(v);
    return (k + 1) + '. ' + (d.type === 'h' ? 'Niveau ' + f(d.v) : 'Tendance ' + dayOf(d.t1) + ' ' + f(d.v1) + ' → ' + dayOf(d.t2) + ' ' + f(d.v2));
  }
  function drawingExpr(d) {
    const r = (v) => +v.toFixed(chartView ? chartView.dec + 1 : 6);
    return d.type === 'h' ? String(r(d.v)) : 'LINE(' + d.t1 + ', ' + r(d.v1) + ', ' + d.t2 + ', ' + r(d.v2) + ')';
  }
  const ROLES = [
    ['buyBounce', 'Acheter sur rebond (support)', 'longEntry', 'or', (X) => '(LOW <= ' + X + ' AND CLOSE > ' + X + ')'],
    ['sellBounce', 'Vendre sur rejet (résistance)', 'shortEntry', 'or', (X) => '(HIGH >= ' + X + ' AND CLOSE < ' + X + ')'],
    ['buyBreak', 'Acheter à la cassure vers le haut', 'longEntry', 'or', (X) => 'CROSS_UP(CLOSE, ' + X + ')'],
    ['sellBreak', 'Vendre à la cassure vers le bas', 'shortEntry', 'or', (X) => 'CROSS_DOWN(CLOSE, ' + X + ')'],
    ['buyAbove', 'Filtre : acheter seulement au-dessus', 'longEntry', 'and', (X) => 'CLOSE > ' + X],
    ['sellBelow', 'Filtre : vendre seulement en dessous', 'shortEntry', 'and', (X) => 'CLOSE < ' + X],
    ['exitLong', 'Sortir de l\'achat quand le prix le touche (objectif)', 'longExit', 'or', (X) => 'HIGH >= ' + X],
    ['exitShort', 'Sortir de la vente quand le prix le touche (objectif)', 'shortExit', 'or', (X) => 'LOW <= ' + X],
    ['stopLong', 'Sortir de l\'achat s\'il passe dessous (stop)', 'longExit', 'or', (X) => 'CLOSE < ' + X],
    ['stopShort', 'Sortir de la vente s\'il passe dessus (stop)', 'shortExit', 'or', (X) => 'CLOSE > ' + X],
  ];
  function defaultRole(d) {
    if (d.type === 'line') return d.v2 >= d.v1 ? 'buyBounce' : 'sellBounce';
    const last = chartView.bars[chartView.bars.length - 1].close;
    return d.v < last ? 'buyBounce' : 'sellBounce';
  }
  function strategyWith(strat, d, role) {
    const R = ROLES.find((x) => x[0] === role), X = drawingExpr(d), cond = R[4](X), s = Object.assign({}, strat);
    if (R[3] === 'and') { if (!s[R[2]]) return { error: 'La stratégie n\'a pas de règle « ' + (R[2] === 'longEntry' ? 'entrée achat' : 'entrée vente') + ' » à filtrer.' }; s[R[2]] = E.andWith(s[R[2]], cond); }
    else s[R[2]] = s[R[2]] ? E.orWith(s[R[2]], cond) : cond;
    return { strat: s };
  }
  function setDrawMode(mode, silent) {
    drawMode = mode; drawPending = null;
    if (!$('drawLine')) return;
    $('drawLine').classList.toggle('active', mode === 'line');
    $('drawH').classList.toggle('active', mode === 'h');
    $('drawHint').textContent = mode === 'line' ? 'Cliquez sur 2 points du graphique des cours.' : mode === 'h' ? 'Cliquez à la hauteur du niveau.' : '';
    if (!silent) drawPrice();
  }
  function onDrawPoint(i, value) {
    const v = chartView, t = v.visT[i], pair = v.pair, list = drawingsFor(pair);
    const round = (x) => +x.toFixed(v.dec + 1);
    if (drawMode === 'h') {
      undoable('Repère ajouté', () => { list.push({ type: 'h', v: round(value) }); saveDrawings(pair, list); setDrawMode(null); });
    } else if (drawMode === 'line') {
      if (!drawPending) { drawPending = { i: i, value: value, t: t }; drawPrice(); return; }
      if (t === drawPending.t) return;
      const a = drawPending.t < t ? drawPending : { t: t, value: value }, b = drawPending.t < t ? { t: t, value: value } : drawPending;
      undoable('Ligne de tendance ajoutée', () => { list.push({ type: 'line', t1: a.t, v1: round(a.value), t2: b.t, v2: round(b.value) }); saveDrawings(pair, list); setDrawMode(null); });
    }
  }
  function renderDrawList() {
    if (!chartView || !$('drawList')) return;
    const list = drawingsFor(chartView.pair);
    $('drawList').innerHTML = list.length ? list.map((d, k) => '<div class="draw-item" data-k="' + k + '"><div class="head"><span><i style="background:' + DRAW_COLORS[k % DRAW_COLORS.length] + '"></i>' + esc(drawingName(d, k)) + '</span>' +
      '<button type="button" class="chip" data-act="del">Supprimer</button></div><div class="acts"><select data-act="role" aria-label="Rôle du repère dans la stratégie">' +
      ROLES.map((r) => '<option value="' + r[0] + '"' + (r[0] === (d.role || defaultRole(d)) ? ' selected' : '') + '>' + esc(r[1]) + '</option>').join('') + '</select>' +
      '<button type="button" class="secondary" data-act="add">Ajouter à la stratégie</button></div><div class="preview hint" data-act="preview"></div></div>').join('') +
      '<p class="hint">Un repère est un prix précis : il vaut pour ' + esc(chartView.pair) + ' et pour la période où il a du sens. Comparez le résultat avant de l\'ajouter (Ctrl+Z pour annuler).</p>'
      : '<p class="hint">Dessinez une ligne de tendance ou un support / une résistance sur le graphique des cours, puis ajoutez-le à la stratégie comme règle d\'entrée, de filtre ou de sortie.</p>';
    $('drawList').querySelectorAll('.draw-item').forEach((item) => {
      const k = +item.dataset.k, sel = item.querySelector('[data-act=role]');
      const preview = () => {
        const d = drawingsFor(chartView.pair)[k], out = item.querySelector('[data-act=preview]');
        if (!lastRunCtx || !d) return;
        const w = strategyWith(lastRunCtx.strat, d, sel.value);
        if (w.error) { out.textContent = w.error; return; }
        const st = E.run(lastRunCtx.bars, w.strat, lastRunCtx.settings), base = lastRun && lastRun.stats;
        out.innerHTML = st ? 'Avec ce repère : ' + statLine(st) + (base ? ' <span class="hint">(au lieu de ' + pct(base.returnPct) + ', ' + base.trades + ' trades)</span>' : '') : 'Simulation impossible.';
      };
      sel.addEventListener('change', () => { const l = drawingsFor(chartView.pair); l[k].role = sel.value; saveDrawings(chartView.pair, l); preview(); });
      item.querySelector('[data-act=del]').addEventListener('click', () => undoable('Repère supprimé', () => { const l = drawingsFor(chartView.pair); l.splice(k, 1); saveDrawings(chartView.pair, l); drawPrice(); }));
      item.querySelector('[data-act=add]').addEventListener('click', () => {
        const d = drawingsFor(chartView.pair)[k], w = strategyWith(lastRunCtx.strat, d, sel.value);
        if (w.error) { item.querySelector('[data-act=preview]').textContent = w.error; return; }
        undoable('Repère ajouté à la stratégie', () => {
          const s = Object.assign({}, currentStrategy(), { longEntry: w.strat.longEntry, longExit: w.strat.longExit, shortEntry: w.strat.shortEntry, shortExit: w.strat.shortExit });
          s.name = String(s.name).replace(/ \(repères\)$/, '') + ' (repères)';
          s.frenchText = F.french.toFrench(s) || '';
          loadStrategy(s);
          $('preset').value = 'mine';
          $('presetDesc').textContent = 'Repère ajouté : ' + ROLES.find((r) => r[0] === sel.value)[1].toLowerCase() + ' (' + drawingName(d, k) + '). Voir « Règles techniques ».';
          $('rulesDetails').open = true;
          logEvent('strategy.drawing', 'Repère ajouté à ' + s.name + ' : ' + drawingName(d, k), { drawing: d, role: sel.value });
        });
        $('form').requestSubmit();
      });
      preview();
    });
  }

  function withdrawLabel(se) {
    if (se.withdrawMode !== 'periodic') return 'seuil +' + se.withdrawPct + ' %, ' + (se.withdrawWhen === 'immediate' ? 'dès le seuil' : 'à la clôture');
    const v = se.withdrawType === 'fixed' ? money.format(se.withdrawValue) : se.withdrawValue + ' %' + (se.withdrawType === 'excess' ? ' de l\'excédent' : ' du compte');
    return v + (se.withdrawEvery === 'days' ? ' tous les ' + se.withdrawDays + ' jours' : ' chaque mois');
  }
  /** Capital moyen sur la période et gain moyen correspondant (en % du capital de départ). */
  function averageGain(equity, capital) {
    const mean = equity.length ? equity.reduce((a, b) => a + b, 0) / equity.length : capital;
    return { mean: mean, pct: ((mean - capital) / capital) * 100 };
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
      let html = '<div class="modal-note"><b>Résultat actuel :</b> ' + statLine(enh.base) + '</div>' +
        '<div class="custom-box"><b>Ma propre amélioration</b>' +
        '<p class="hint">Écrivez-la en français : elle est testée comme les suggestions, puis ajoutée à la liste.</p>' +
        '<textarea id="customText" class="prose" rows="2" spellcheck="true" placeholder="ex. Acheter seulement si le RSI 14 est au-dessus de 50. Vendre dans le cas inverse.&#10;ou : Stop loss 40 pips, take profit 100 pips"></textarea>' +
        '<div class="row buttons custom-actions"><select id="customMode" aria-label="Comment appliquer cette amélioration">' +
        '<option value="and">Ajouter comme condition (ET)</option><option value="or">Ajouter comme alternative (OU)</option><option value="replace">Remplacer la règle</option></select>' +
        '<button type="button" class="secondary" id="customTest">Tester</button></div><p class="err" id="customError"></p><p class="hint" id="customNotes"></p></div>' +
        '<div id="suggList"></div>' +
        '<div class="custom-box"><b>Robustesse : tester sur d\'autres paires</b><p class="hint">Une bonne stratégie gagne aussi sur des paires proches, pas seulement sur celle qui a servi à la régler. ' +
        'Même période, cours BCE (ou données simulées si c\'est la source choisie) ; les améliorations cochées sont incluses.</p><div class="row buttons"><button type="button" class="secondary" id="robustTest">Tester sur d\'autres paires</button></div><div id="robustOut"></div></div>';
      if (enh.suggestions.length) {
        if (enh.validation) html += '<p class="modal-note">Chaque suggestion est aussi testée sur ' + (enh.folds.length > 1 ? 'les <b>' + enh.folds.length + ' périodes précédentes</b>' : 'la <b>période précédente</b>') +
          ' de même durée, qui n\'ont pas servi à la choisir (contrôle « walk-forward »). Privilégiez les suggestions « confirmées ». La note tient compte du rendement, du drawdown, de la régularité (mois gagnants), du facteur de profit et du nombre de trades.</p>';
        html += '<p class="modal-note">Ces améliorations sont calculées sur la période testée. Plus vous en cumulez, plus le risque de « sur-optimisation » est grand : la stratégie colle au passé sans être meilleure à l\'avenir. Vérifiez ensuite le résultat sur une autre période (bouton « Dates »).</p>';
      }
      $('enhanceBody').innerHTML = html;
      renderSuggList(new Set());
      $('customTest').addEventListener('click', testCustom);
      $('robustTest').addEventListener('click', testOtherPairs);
      $('customText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) testCustom(); });
      updateCombined();
    }, 30);
  }
  // Liste des suggestions (les miennes en premier), en gardant les cases déjà cochées.
  function renderSuggList(checked) {
    const base = enh.base;
    $('suggList').innerHTML = (enh.suggestions.length ? '' : '<p>Aucune des modifications testées automatiquement (réglages des indicateurs, seuils, filtre de tendance, stop-loss, take-profit, sens des positions…) n\'améliore ce résultat sur cette période. Vous pouvez tester votre propre idée ci-dessus.</p>') +
      enh.suggestions.map((sg, i) => {
        const d = sg.stats.returnPct - base.returnPct;
        return '<label class="sugg' + (sg.custom ? ' mine' : '') + '"><input type="checkbox" data-i="' + i + '"' + (checked.has(sg.id) ? ' checked' : '') + '><div>' +
          '<div class="grp' + (sg.risk ? ' risk' : '') + '">' + esc(sg.group) + '</div><b>' + esc(sg.title) + '</b><p>' + esc(sg.detail) + '</p>' +
          '<div class="res">Seule : ' + statLine(sg.stats) + ' <span class="delta ' + cls(d) + '">' + signed(d, num1) + ' pts</span></div>' + validationLine(sg.validation, sg) + '</div></label>';
      }).join('');
  }
  function testCustom() {
    const text = $('customText').value, mode = $('customMode').value;
    $('customError').textContent = ''; $('customNotes').textContent = '';
    const { bars, strat, settings } = lastRunCtx;
    const sg = E.customSuggestion(bars, strat, settings, text, mode);
    if (sg.error) { $('customError').textContent = sg.error; return; }
    const checked = new Set(selectedSuggestions().map((x) => x.id));
    checked.add(sg.id);
    enh.suggestions.unshift(sg);
    renderSuggList(checked);
    $('customNotes').textContent = (sg.notes.length ? sg.notes.join(' ') + ' ' : '') + 'Ajoutée en tête de liste et cochée : comparez puis « Appliquer et relancer ».';
    $('customText').value = '';
    updateCombined();
  }
  function validationLine(v, sg) {
    if (!v) return '';
    // Mes améliorations peuvent être moins bonnes que l'actuel sur la période testée : on le dit.
    const worseNow = sg && sg.custom && sg.score <= E.score(enh.base);
    let verdict = worseNow ? (v.confirmed ? ' : moins bonne sur la période testée, meilleure sur la précédente' : ' : moins bonne sur les deux périodes')
      : v.confirmed ? ' : confirmée' : ' : non confirmée, peut-être un hasard';
    const many = v.total > 1;
    // « confirmée » se juge sur la note (rendement, drawdown, régularité…), pas sur le seul rendement
    if (v.confirmed && !worseNow && v.stats.returnPct < v.base.returnPct) verdict += ' (gain plus faible, mais drawdown plus faible : −' + num1.format(v.stats.maxDrawdownPct) + ' % au lieu de −' + num1.format(v.base.maxDrawdownPct) + ' %)';
    return '<div class="val ' + (v.confirmed && !worseNow ? 'ok' : 'ko') + '">' + (many ? 'Meilleure sur ' + v.wins + ' période(s) de contrôle sur ' + v.total + ' · ' : '') +
      'période précédente : ' + pct(v.stats.returnPct) + ' au lieu de ' + pct(v.base.returnPct) + (many ? verdict.replace('les deux périodes', 'la période testée et les contrôles').replace('la précédente', 'les contrôles') : verdict) + '</div>';
  }
  // Robustesse : stratégie (avec les améliorations cochées) sur les autres grandes paires, même période, cours BCE.
  async function testOtherPairs() {
    const btn = $('robustTest'), out = $('robustOut');
    const { strat, settings, bars } = lastRunCtx;
    const c = E.combine(strat, settings, selectedSuggestions());
    btn.disabled = true; out.innerHTML = '<div class="modal-loading"><span class="spinner"></span>Téléchargement des cours et simulations…</div>';
    const from = new Date(bars[0].date.slice(0, 10) + 'T00:00:00Z'), to = new Date(bars[bars.length - 1].date.slice(0, 10) + 'T00:00:00Z');
    const start = new Date(bars[settings.startIndex].date.slice(0, 10) + 'T00:00:00Z');
    const pairs = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF', 'USD/CAD', 'EUR/GBP', 'NZD/USD'].filter((p) => F.data.PAIRS.includes(p));
    const runs = [];
    for (const p of pairs) {
      try {
        let b;
        if (lastRunCtx.config.source === 'synthetic') b = F.data.generateSynthetic(p, from, to);
        else {
          const key = p + '|' + F.data.iso(from) + '|' + F.data.iso(to);
          if (!onlineCache.has(key)) onlineCache.set(key, await F.data.fetchFrankfurter(p, from, to));
          b = F.data.estimateWicks(onlineCache.get(key));
        }
        const se = Object.assign({}, c.settings, { pair: p, startIndex: F.data.indexFrom(b, start), timeframe: 'D1', pipSize: undefined });
        delete se.broker; delete se.news; delete se.newsCalendar;
        if (se.sizing === 'fixed') se.sizing = 'backtest';
        runs.push({ pair: p, stats: E.run(b, c.strat, se), same: p === settings.pair });
      } catch (e) { runs.push({ pair: p, stats: null, error: e.message }); }
    }
    const r = E.robustness(runs);
    out.innerHTML = '<table class="mini"><thead><tr><th>Paire</th><th>Résultat</th><th>Drawdown</th><th>Trades</th><th>Mois gagnants</th></tr></thead><tbody>' +
      runs.map((x) => '<tr' + (x.same ? ' class="same"' : '') + '><td>' + esc(x.pair) + (x.same ? ' (testée)' : '') + '</td>' + (x.stats
        ? '<td class="' + cls(x.stats.returnPct) + '">' + pct(x.stats.returnPct) + '</td><td>−' + num1.format(x.stats.maxDrawdownPct) + ' %</td><td>' + x.stats.trades + '</td><td>' + Math.round(x.stats.winMonthsPct) + ' %</td>'
        : '<td colspan="4" class="hint">' + esc(x.error || 'simulation impossible') + '</td>') + '</tr>').join('') + '</tbody></table>' +
      '<p class="val ' + (r.robust ? 'ok' : 'ko') + '">Gagnante sur ' + r.positive + ' paire(s) sur ' + r.tested + (r.robust ? ' : stratégie plutôt robuste.' : ' : résultat probablement propre à cette paire ou à cette période.') + '</p>';
    btn.disabled = false;
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
    if (st && enh.folds && enh.folds.length) {
      const v = E.validateOn(enh.folds, strat, (ctx) => E.combine(ctx.strat, ctx.settings, sel));
      if (v) html += '<div class="val ' + (v.confirmed ? 'ok' : 'ko') + '">' + (v.total > 1 ? 'Meilleure sur ' + v.wins + ' période(s) de contrôle sur ' + v.total + ' · ' : '') +
        'période précédente : ' + pct(v.stats.returnPct) + ' au lieu de ' + pct(v.base.returnPct) + '</div>';
    }
    $('enhanceCombined').innerHTML = html;
  }
  $('enhanceBody').addEventListener('change', updateCombined);
  function closeEnhancer() { $('enhanceModal').hidden = true; document.body.style.overflow = ''; }
  $('enhanceModal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeEnhancer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('enhanceModal').hidden) closeEnhancer(); });
  $('enhanceApply').addEventListener('click', () => undoable('Améliorations appliquées', () => {
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
    if (c.settings.sizing !== settings.sizing || c.settings.riskPct !== settings.riskPct) {
      $('brokerSizing').value = c.settings.sizing; $('brokerRisk').value = c.settings.riskPct; $('brokerSizing').dispatchEvent(new Event('change'));
    }
    if (c.settings.news && !settings.news) {
      $('newsOn').checked = true; $('newsMode').value = c.settings.news.mode; $('newsBefore').value = c.settings.news.before; $('newsAfter').value = c.settings.news.after;
      updateNewsUI();
    }
    $('preset').value = 'mine';
    $('deleteStrat').hidden = true;
    $('presetDesc').textContent = 'Améliorations appliquées : ' + sel.map((x) => x.title).join(' ; ') + '.' +
      (s.frenchText ? '' : ' Le texte français ne peut pas décrire ces réglages : voir « Règles techniques ».');
    if (!s.frenchText) $('rulesDetails').open = true;
    logEvent('strategy.enhanced', 'Améliorations appliquées à ' + strat.name + ' : ' + sel.map((x) => x.title).join(' ; '), { before: strat, after: s, leverage: c.settings.leverage, sizing: c.settings.sizing, riskPct: c.settings.riskPct, news: c.settings.news ? { mode: c.settings.news.mode, before: c.settings.news.before, after: c.settings.news.after } : null });
    updateStyleHint();
    closeEnhancer();
    $('form').requestSubmit();
  }));

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
      news: { enabled: $('newsOn').checked, mode: $('newsMode').value, before: Number($('newsBefore').value) || 0, after: Number($('newsAfter').value) || 0, impact: $('newsImpact').value },
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
      : o.sizing === 'risk' ? 'La taille est calculée pour perdre ' + num1.format(o.riskPct) + ' % du capital si le stop-loss (' +
          (o.strat.stopAtr > 0 ? num1.format(o.strat.stopAtr) + ' ATR' : (o.strat.stopLossPips || 0) + ' pips') + ') est touché.' +
        (o.strat.stopLossPips || o.strat.stopAtr ? '' : ' Cette stratégie n\'a pas de stop-loss : l\'EA utilisera les lots fixes.')
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
    $('depSizing').value = settings.sizing || 'backtest'; $('depLots').value = settings.fixedLots || 0.01; $('depRisk').value = settings.riskPct || 1;
    if (settings.broker) {
      // Mêmes réglages que la simulation « courtier », pour que l'EA et le testeur MT5 fassent pareil.
      $('depMaxLots').value = settings.maxLots; $('depSpread').value = settings.maxSpreadPips;
      const cur = settings.broker.account.currency;
      if (![...$('bridgeCurrency').options].some((o) => o.value === cur)) $('bridgeCurrency').add(new Option(cur, cur));
      $('bridgeCurrency').value = cur;
    }
    $('depNote').textContent = settings.broker
      ? 'Forexia a simulé avec les données de votre courtier et les règles de cet EA : le testeur MT5 doit donner le même résultat (le tableau « trade par trade » montre les éventuelles différences). Passez ensuite sur un compte démo avant le réel.'
      : 'Ce backtest Forexia n\'utilise pas les données de votre courtier : les résultats MT5 seront différents. Pour une simulation identique, choisissez la source « Mon courtier (MetaTrader 5) ». Testez toujours sur un compte démo avant le réel.';
    refreshDeploy();
    $('bridgeSymbol').value = settings.symbol || $('brokerSymbol').value || settings.pair.replace('/', '');
    $('bridgeLog').innerHTML = '';
    $('bridgeConfirm').hidden = true;
    checkBridge();
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
    logEvent('ea.downloaded', 'EA téléchargé : ' + deployed.fileName, { fileName: deployed.fileName, strategy: lastRunCtx.strat });
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

  // ---------- Passerelle MetaTrader 5 (programme local, voir bridge/) ----------
  async function bridgeCall(method, path, body) {
    const headers = { 'X-Forexia-Token': bridgeToken };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(BRIDGE_URL + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) { const e = new Error('code'); e.code = 401; throw e; }
    return res.json();
  }
  function bridgeState(text, cls) { $('bridgeState').textContent = text; $('bridgeState').className = 'pill ' + (cls || ''); }
  async function checkBridge() {
    $('bridgeSetup').hidden = $('bridgeReady').hidden = true;
    bridgeState('recherche…');
    try { await fetch(BRIDGE_URL + '/ping'); } catch (e) {
      bridgeState('passerelle non détectée', 'ko'); $('bridgeSetup').hidden = false; return;
    }
    if (!bridgeToken) { bridgeState('à connecter', 'ko'); $('bridgeSetup').hidden = false; return; }
    try {
      const st = await bridgeCall('GET', '/status');
      const terms = st.terminals || [];
      $('bridgeTerminal').innerHTML = terms.map((t) => '<option value="' + esc(t.id) + '">' + esc(t.name) + ' — ' + esc(t.dataDir) + '</option>').join('');
      if (!terms.length) { bridgeState('MT5 introuvable', 'ko'); $('bridgeSetup').hidden = false; return; }
      bridgeState(st.version && st.version < BRIDGE_MIN ? 'passerelle à mettre à jour' : 'connectée', st.version && st.version < BRIDGE_MIN ? 'ko' : 'ok');
      if (!dbOn) dbConnect();
      if (st.version && st.version < BRIDGE_MIN) { $('bridgeSetup').hidden = false; }
      $('bridgeReady').hidden = false;
    } catch (e) {
      bridgeState(e.code === 401 ? 'code incorrect' : 'erreur', 'ko');
      $('bridgeSetup').hidden = false;
    }
  }
  $('bridgeConnect').addEventListener('click', () => {
    bridgeToken = $('bridgeToken').value.trim().toUpperCase();
    try { localStorage.setItem('forexia.bridgeToken', bridgeToken); } catch (e) { /* ignoré */ }
    checkBridge();
  });
  $('bridgeTest').addEventListener('change', () => { $('bridgeTestOpts').hidden = !$('bridgeTest').checked; });

  function nextDay(iso) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return F.data.iso(d); }
  function compareHtml(r) {
    const f = lastRun.stats;
    const mt = { ret: r.deposit ? (100 * r.profit) / r.deposit : 0, trades: r.trades, win: r.trades ? (100 * r.profitTrades) / r.trades : 0, pf: r.profitFactor, dd: r.maxDrawdownPct };
    const reasons = { 3: 'Signal', 4: 'Stop-loss', 5: 'Take-profit', 6: 'Margin call' };
    const count = (list, key) => list.reduce((m, x) => { const k = key(x); m[k] = (m[k] || 0) + 1; return m; }, {});
    const fx = count(lastRunCtx.lastTrades || [], (t) => (t.reason === 'Fin de période' ? 'Signal' : t.reason));
    const m5 = count(r.deals || [], (d) => reasons[d.reason] || 'Autre');
    const row = (k, a, b) => '<tr><td>' + k + '</td><td>' + a + '</td><td>' + b + '</td></tr>';
    const exits = ['Signal', 'Stop-loss', 'Take-profit', 'Margin call'].filter((k) => fx[k] || m5[k]).map((k) => row('Sorties « ' + k + ' »', fx[k] || 0, m5[k] || 0)).join('');
    // Diagnostic : signaux d'ouverture et ordres retardés / perdus (spread, taille), des deux côtés.
    const fd = lastRunCtx.diag, md = r.diag;
    const diagRows = md ? [['Signaux d\'ouverture', 'signals'], ['Ordres reportés (spread trop large)', 'spreadDelayed'], ['Ordres perdus (spread toute la bougie)', 'spreadMissed'],
      ['Ordres annulés (taille trop petite)', 'lotsTooSmall'], ['Ordres refusés par le courtier', 'orderFailed']]
      .filter(([, k]) => (fd && fd[k]) || md[k] || k === 'signals').map(([label, k]) => row(label, fd ? fd[k] : '—', md[k])).join('') : '';
    return '<div class="table-wrap"><table class="compare"><thead><tr><th></th><th>Forexia</th><th>MetaTrader 5</th></tr></thead><tbody>' +
      row('Profit net', '<span class="' + cls(f.returnPct) + '">' + pct(f.returnPct) + '</span>', '<span class="' + cls(mt.ret) + '">' + pct(mt.ret) + '</span>') +
      row('Trades', f.trades, mt.trades) + row('Trades gagnants', num1.format(f.winRate) + ' %', num1.format(mt.win) + ' %') +
      row('Profit factor', Number.isFinite(f.profitFactor) ? num2.format(f.profitFactor) : '∞', num2.format(mt.pf)) +
      row('Drawdown max', '−' + num1.format(f.maxDrawdownPct) + ' %', '−' + num1.format(mt.dd) + ' %') + exits + diagRows +
      '</tbody></table></div><p class="hint">Résultats MT5 sur les bougies de votre courtier (' + esc(r.symbol) + ', ' + esc(String(r.period).replace('PERIOD_', '')) + ').' +
      (lastRunCtx.settings.broker ? '' : ' <b>Forexia n\'utilisait pas les données du courtier</b> : choisissez la source « Mon courtier (MetaTrader 5) » pour une comparaison à l\'identique.') + '</p>' +
      tradesCompareHtml(r);
  }
  // Trade par trade : entrées MT5 (DEAL_ENTRY_IN) associées à leur sortie, comparées aux trades Forexia par date d'entrée.
  function tradesCompareHtml(r) {
    const deals = r.deals || [];
    if (!deals.length || deals[0].entry === undefined) return '';
    const intraday = (lastRunCtx.timeframe || 'D1') !== 'D1';
    const bars = lastRunCtx.bars;
    // Date d'une transaction MT5 -> bougie Forexia qui la contient (même découpage des deux côtés).
    const key = (d) => {
      const x = String(d).replace(/\./g, '-');
      if (bars.length && bars[0].t !== undefined) {
        const t = Date.parse(x.slice(0, 10) + 'T' + (x.slice(11, 16) || '00:00') + ':00Z') / 1000;
        let lo = 0, hi = bars.length - 1;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bars[m].t <= t) lo = m; else hi = m - 1; }
        return bars[lo].date;
      }
      return intraday ? x.slice(0, 16) : x.slice(0, 10);
    };
    const reasons = { 3: 'Signal', 4: 'Stop-loss', 5: 'Take-profit', 6: 'Margin call' };
    const mt = [];
    let open = null;
    for (const d of deals) {
      if (d.entry === 0) open = { key: key(d.time), dir: d.type === 0 ? 1 : -1, price: d.price, lots: d.volume };
      else if (open) { mt.push(Object.assign(open, { exit: key(d.time), reason: reasons[d.reason] || 'Fin du test', pnl: d.profit })); open = null; }
    }
    const fx = (lastRunCtx.lastTrades || []).map((t) => ({ key: t.entryDate, dir: t.dir, exit: t.exitDate, reason: t.reason === 'Fin de période' ? 'Fin du test' : t.reason, pnl: t.pnl, lots: t.lots }));
    const keys = [...new Set(fx.map((t) => t.key).concat(mt.map((t) => t.key)))].sort();
    let same = 0;
    const side = (t) => (t ? (t.dir > 0 ? 'Achat' : 'Vente') + (t.lots ? ' ' + num2.format(t.lots) + ' lot' : '') + ' → ' + frDate(t.exit) + ', ' + t.reason + ', <span class="' + cls(t.pnl) + '">' + signed(t.pnl, money) + '</span>' : '—');
    const rows = keys.map((k) => {
      const a = fx.find((t) => t.key === k), b = mt.find((t) => t.key === k);
      const ok = a && b && a.dir === b.dir && a.exit === b.exit && a.reason === b.reason;
      if (ok) same++;
      return '<tr class="' + (ok ? '' : 'diff') + '"><td>' + frDate(k) + '</td><td class="l">' + side(a) + '</td><td class="l">' + side(b) + '</td></tr>';
    });
    return '<details class="help"' + (same === keys.length ? '' : ' open') + '><summary>Trade par trade : ' + same + ' identiques sur ' + keys.length + '</summary>' +
      '<div class="table-wrap"><table class="trades-cmp"><thead><tr><th>Entrée</th><th class="l">Forexia</th><th class="l">MetaTrader 5</th></tr></thead><tbody>' +
      rows.slice(0, 200).join('') + '</tbody></table></div><p class="hint">Lignes surlignées : trade absent d\'un côté, ou sortie différente (date ou motif).</p></details>';
  }
  function bridgeStep(cls, html) {
    const d = document.createElement('div');
    d.className = 'step-line ' + cls;
    d.innerHTML = '<div>' + html + '</div>';
    $('bridgeLog').appendChild(d);
    return { set(c, h) { d.className = 'step-line ' + c; d.innerHTML = '<div>' + h + '</div>'; }, remove() { d.remove(); } };
  }
  // resume = true : reprise après « Fermer MT5 et continuer » (l'EA est déjà compilé).
  async function bridgeDeploy(resume) {
    if (!deployed || !lastRunCtx) return;
    const termId = $('bridgeTerminal').value, symbol = $('bridgeSymbol').value.trim(), period = $('depTimeframe').value.replace('PERIOD_', '');
    const { bars, settings } = lastRunCtx;
    $('bridgeDeploy').disabled = true;
    let mayClose = !!resume;
    try {
      if (!resume) {
        $('bridgeLog').innerHTML = '';
        const s = bridgeStep('run', 'Compilation dans MetaEditor…');
        const r = await bridgeCall('POST', '/deploy', { terminalId: termId, fileName: deployed.fileName, code: deployed.code });
        if (!r.ok || !r.compiled) {
          s.set('ko', esc(r.message || 'Compilation échouée. ' + (r.summary || '')) + (r.errors && r.errors.length ? '<pre>' + esc(r.errors.join('\n')) + '</pre>' : ''));
          return;
        }
        s.set('ok', 'EA compilé et installé dans <code>MQL5\\Experts\\Forexia</code>' + (r.warnings.length ? ' (' + r.warnings.length + ' avertissement(s) sans gravité)' : '') + '.');
      }
      if ($('bridgeTest').checked && !$('bridgeLog').querySelector('.tested')) {
        const s = bridgeStep('run', 'Test dans MetaTrader 5 en cours… (la première fois, MT5 télécharge l\'historique : quelques minutes)');
        const r = await bridgeCall('POST', '/test', {
          terminalId: termId, fileName: deployed.fileName, symbol: symbol, period: period,
          from: bars[settings.startIndex].date.slice(0, 10), to: nextDay(bars[bars.length - 1].date.slice(0, 10)),
          deposit: settings.capital, currency: $('bridgeCurrency').value, leverage: settings.leverage,
          model: Number($('bridgeModel').value), closeTerminal: mayClose,
        });
        if (r.needClose) { s.remove(); $('bridgeConfirm').hidden = false; return; }
        if (!r.ok) { s.set('ko', esc(r.message)); return; }
        s.set('ok tested', 'Test MT5 terminé en ' + r.seconds + ' s.' + compareHtml(r.result));
        const f = lastRun.stats, m = r.result, same = (/(\d+) identiques sur (\d+)/.exec($('bridgeLog').textContent) || []);
        logEvent('mt5.comparison', 'Forexia ' + signed(f.returnPct, num2) + ' % / MT5 ' + signed(m.deposit ? (100 * m.profit) / m.deposit : 0, num2) + ' % · ' +
          f.trades + ' / ' + m.trades + ' trades' + (same[1] ? ' · ' + same[1] + ' identiques sur ' + same[2] : '') + ' — ' + lastRunCtx.strat.name,
          { strategy: lastRunCtx.strat.name, fileName: deployed.fileName, forexia: f, mt5: Object.assign({}, m, { deals: undefined }) });
        mayClose = true;
      }
      if ($('bridgeAttach').checked) {
        const s = bridgeStep('run', 'Ouverture de l\'EA sur un graphique…');
        const r = await bridgeCall('POST', '/attach', { terminalId: termId, fileName: deployed.fileName, symbol: symbol, period: period, closeTerminal: mayClose });
        if (r.needClose) { s.remove(); $('bridgeConfirm').hidden = false; return; }
        s.set(r.ok ? 'ok' : 'ko', esc(r.message) + (r.ok ? ' Vérifiez que le bouton « Algo Trading » est vert et que l\'EA affiche son état en haut à gauche du graphique.' : ''));
      }
    } catch (e) {
      bridgeStep('ko', e.code === 401 ? 'Code d\'appairage refusé : reconnectez la passerelle.' : 'Passerelle injoignable : la fenêtre de la passerelle est-elle toujours ouverte ?');
      if (e.code === 401) checkBridge();
    } finally {
      $('bridgeDeploy').disabled = false;
    }
  }
  $('bridgeDeploy').addEventListener('click', () => bridgeDeploy(false));
  $('bridgeCloseGo').addEventListener('click', () => { $('bridgeConfirm').hidden = true; bridgeDeploy(true); });
  $('bridgeCloseCancel').addEventListener('click', () => { $('bridgeConfirm').hidden = true; bridgeStep('ko', 'Annulé : MetaTrader 5 n\'a pas été fermé.'); });

  // ---------- Compte en ligne (Supabase) : connexion et synchronisation ----------
  const C = F.cloud;
  const GUEST_KEY = 'forexia.guest';
  function cloudOn() { return !!C.user; }
  function setSync(state, msg) {
    $('syncState').className = 'sync ' + state;
    $('syncState').title = { ok: 'Données synchronisées', run: 'Synchronisation…', ko: 'Synchronisation impossible : ' + (msg || '') }[state];
  }
  function cloudFail(e) {
    setSync('ko', e && e.message);
    if (e && e.code === 'schema') showCloudBanner();
    if (e && e.code === 'auth') { renderUser(); showGate(e.message); }
  }
  function cloudPush(fn) {
    if (!cloudOn()) return;
    setSync('run');
    fn().then(() => setSync('ok')).catch(cloudFail);
  }
  // Fusion appareil <-> compte : union des deux côtés, la version la plus récente l'emporte.
  async function cloudSync() {
    if (!cloudOn()) return;
    setSync('run');
    const remote = await C.listStrategies(), local = storage.get();
    const byName = new Map(local.map((s) => [s.name, s]));
    for (const r of remote) { const l = byName.get(r.name); if (!l || (r.savedAt || '') > (l.savedAt || '')) byName.set(r.name, r); }
    for (const l of local) {
      const r = remote.find((x) => x.name === l.name);
      if (!r || (l.savedAt || '') > (r.savedAt || '')) await C.putStrategy(Object.assign({}, l, { savedAt: l.savedAt || new Date().toISOString() }));
    }
    storage.set([...byName.values()]);
    const cur = $('preset').value;
    refreshPresetSelect(cur.startsWith('saved:') ? 'preset:' + F.presets.list[0].id : cur);
    const rs = await C.listSimulations();
    const ls = evalList().map((e) => (e.key ? e : Object.assign(e, { key: e.at + '|' + e.name })));
    const keys = new Set(rs.map((e) => e.key));
    const missing = ls.filter((e) => !keys.has(e.key));
    if (missing.length) await C.putSimulations(missing);
    const all = new Map(rs.map((e) => [e.key, e]));
    for (const e of ls) if (!all.has(e.key)) all.set(e.key, e);
    evalSave([...all.values()].map((e) => { const c = Object.assign({}, e); delete c.tradeList; return c; }).sort((a, b) => (a.at < b.at ? -1 : 1)));
    // Dernière simulation (récupération sur un autre appareil)
    const st = await C.getSettings();
    let localLast = null;
    try { localLast = JSON.parse(localStorage.getItem('forexia.lastRun')); } catch (e) { /* ignoré */ }
    if (st.lastRun && (!localLast || st.lastRun.at > localLast.at)) {
      try { localStorage.setItem('forexia.lastRun', JSON.stringify(st.lastRun)); } catch (e) { /* ignoré */ }
      refreshPresetSelect($('preset').value);
    } else if (localLast && (!st.lastRun || localLast.at > st.lastRun.at)) {
      await C.putSettings(Object.assign({}, st, { lastRun: localLast }));
    }
    setSync('ok');
  }
  // Tables absentes dans Supabase : bandeau avec le script à copier et le lien vers l'éditeur SQL du projet.
  function showCloudBanner(msg) {
    $('cloudBanner').hidden = false;
    $('cloudBannerMsg').textContent = msg || '';
  }
  $('openSql').href = 'https://supabase.com/dashboard/project/' + /https:\/\/([a-z0-9]+)\./.exec(C.CONFIG.url)[1] + '/sql/new';
  $('copySql').addEventListener('click', async () => {
    try {
      const sql = await (await fetch('supabase/schema.sql?v=' + document.documentElement.dataset.version)).text();
      await navigator.clipboard.writeText(sql);
      $('copySql').textContent = '1. Script copié ✓';
    } catch (e) {
      $('cloudBannerMsg').textContent = 'Copie impossible : ouvrez le fichier supabase/schema.sql du dépôt GitHub et copiez son contenu.';
    }
  });
  $('retryCloud').addEventListener('click', async () => {
    $('retryCloud').disabled = true;
    $('cloudBannerMsg').textContent = '';
    try {
      await cloudSync();
      $('cloudBanner').hidden = true;
      toast('Compte en ligne prêt : vos données sont synchronisées.');
    } catch (e) {
      $('cloudBannerMsg').textContent = e.code === 'schema' ? 'Les tables sont toujours introuvables : vérifiez que le script s\'est exécuté sans erreur (« Success. No rows returned »), puis réessayez.' : e.message;
    } finally { $('retryCloud').disabled = false; }
  });

  function renderUser() {
    const u = C.user;
    $('userChip').hidden = !u;
    $('loginBtn').hidden = !!u;
    if (u) { $('userName').textContent = u.name; $('userAvatar').textContent = u.name.slice(0, 1); }
  }
  let authMode = 'login';
  function setAuthMode(mode) {
    authMode = mode;
    const signup = mode === 'signup';
    $('authTitle').textContent = signup ? 'Créer mon compte' : 'Connexion';
    $('authConfirmField').hidden = !signup;
    $('authSubmit').textContent = signup ? 'Créer le compte' : 'Se connecter';
    $('authSwitchText').textContent = signup ? 'Déjà un compte ?' : 'Pas encore de compte ?';
    $('authSwitch').textContent = signup ? 'Se connecter' : 'Créer mon compte';
    $('authPassword').autocomplete = signup ? 'new-password' : 'current-password';
    $('authError').textContent = '';
  }
  function showGate(msg, info) {
    $('authGate').hidden = false;
    $('authError').textContent = msg || '';
    $('authError').classList.toggle('info', !!info);
    setTimeout(() => $('authLogin').focus(), 0);
  }
  $('authSwitch').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'signup' : 'login'));
  $('loginBtn').addEventListener('click', () => { setAuthMode('login'); showGate(); });
  $('authGuest').addEventListener('click', () => {
    try { sessionStorage.setItem(GUEST_KEY, '1'); } catch (e) { /* ignoré */ }
    $('authGate').hidden = true;
    renderUser();
  });
  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const login = $('authLogin').value, pw = $('authPassword').value;
    $('authError').textContent = '';
    $('authError').classList.remove('info');
    if (pw.length < 6) { $('authError').textContent = 'Mot de passe : 6 caractères minimum.'; return; }
    if (authMode === 'signup' && pw !== $('authConfirm').value) { $('authError').textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
    $('authSubmit').disabled = true;
    try {
      if (authMode === 'signup') await C.signUp(login, pw); else await C.signIn(login, pw);
      try { sessionStorage.removeItem(GUEST_KEY); } catch (err) { /* ignoré */ }
      $('authPassword').value = $('authConfirm').value = '';
      $('authGate').hidden = true;
      renderUser();
      await cloudSync().catch(cloudFail);
      logEvent('auth.login', (authMode === 'signup' ? 'Compte créé et connexion : ' : 'Connexion : ') + C.user.name + ' (' + navigator.platform + ')');
    } catch (err) {
      $('authError').textContent = err.message;
    } finally {
      $('authSubmit').disabled = false;
    }
  });
  $('logoutBtn').addEventListener('click', async () => {
    // On envoie ce qui reste, puis on retire de cet appareil les données du compte.
    await cloudSync().catch(() => {});
    logEvent('auth.logout', 'Déconnexion : ' + C.user.name);
    await C.signOut();
    for (const k of ['forexia.strategies', 'forexia.evaluations', 'forexia.lastRun']) { try { localStorage.removeItem(k); } catch (e) { /* ignoré */ } }
    evalMemory = null;
    updateEvalCount();
    refreshPresetSelect('preset:' + F.presets.list[0].id);
    applyPresetSelection();
    renderUser();
    setAuthMode('login');
    showGate('Vous êtes déconnecté.', true);
  });

  // ---------- Base de données (SQLite sur le PC, via la passerelle) ----------
  // Le navigateur garde une copie locale ; la base est mise à jour à chaque action et resynchronisée à la connexion.
  let dbOn = false, dbInfo = null;
  async function dbCall(path, body) {
    const r = await bridgeCall('POST', '/db/' + path, body || {});
    if (!r || r.ok === false) throw new Error((r && r.message) || 'Erreur de base de données');
    return r;
  }
  function dbPush(path, body) {
    if (!dbOn) return;
    dbCall(path, body).catch(() => { dbOn = false; dbBadge(); });
  }
  function logEvent(type, summary, data) {
    dbPush('events/put', { type: type, summary: summary, data: data });
    cloudPush(() => C.addEvent(type, summary, data));
  }
  function dbBadge() {
    $('dbDot').className = 'dot ' + (dbOn ? 'on' : 'off');
    $('dbBtn').title = dbOn ? 'Base de données connectée : ' + (dbInfo ? dbInfo.path : '') : 'Base de données non connectée (données dans ce navigateur seulement)';
  }
  async function dbConnect() {
    if (!bridgeToken) { dbOn = false; dbBadge(); return; }
    try {
      dbInfo = await dbCall('info');
      dbOn = true;
      await dbSyncAll();
      dbInfo = await dbCall('info');
    } catch (e) { dbOn = false; }
    dbBadge();
  }
  async function dbSyncAll() {
    // Stratégies : union des deux côtés, la plus récente l'emporte pour un même nom.
    const remote = (await dbCall('strategies/list')).items;
    const local = storage.get();
    const byName = new Map(local.map((s) => [s.name, s]));
    for (const r of remote) {
      const l = byName.get(r.name);
      if (!l || (r.data.savedAt || '') > (l.savedAt || '')) byName.set(r.name, r.data);
    }
    for (const l of local) {
      const r = remote.find((x) => x.name === l.name);
      if (!r || (l.savedAt || '') > (r.data.savedAt || '')) await dbCall('strategies/put', { name: l.name, data: l, updatedAt: l.savedAt });
    }
    const merged = [...byName.values()];
    storage.set(merged);
    const cur = $('preset').value;
    refreshPresetSelect(cur.startsWith('saved:') ? 'preset:' + F.presets.list[0].id : cur);
    // Simulations : union par identifiant (date + nom), ordre chronologique.
    // (anciennes entrées : liste des trades rangée dans « trades » -> « tradeList », « trades » = nombre)
    const rs = (await dbCall('simulations/list', { limit: 5000 })).items.map((e) =>
      (Array.isArray(e.trades) ? Object.assign({}, e, { tradeList: e.trades, trades: e.trades.length }) : e));
    const ls = evalList().map((e) => (e.key ? e : Object.assign(e, { key: e.at + '|' + e.name })));
    const keys = new Set(rs.map((e) => e.key));
    const missing = ls.filter((e) => !keys.has(e.key));
    if (missing.length) await dbCall('simulations/put', { items: missing });
    const all = new Map(rs.map((e) => [e.key, e]));
    for (const e of ls) all.set(e.key, e);
    evalSave([...all.values()].map((e) => { const c = Object.assign({}, e); delete c.tradeList; return c; }).sort((a, b) => (a.at < b.at ? -1 : 1)));
    if (cloudOn()) cloudSync().catch(cloudFail);
  }
  const EVENT_LABEL = {
    'strategy.saved': 'Enregistrement', 'strategy.deleted': 'Suppression', 'strategy.random': 'Aléatoire', 'strategy.enhanced': 'Amélioration',
    'strategy.imported': 'Import EA', simulation: 'Simulation', 'simulation.cleared': 'Évaluation effacée', 'ea.downloaded': 'EA téléchargé',
    'auth.login': 'Connexion', 'auth.logout': 'Déconnexion', 'mt5.compile': 'Compilation MT5', 'mt5.test': 'Test MT5', 'mt5.attach': 'Graphique MT5', 'mt5.comparison': 'Forexia / MT5',
  };
  async function openDatabase() {
    $('dbModal').hidden = false;
    document.body.style.overflow = 'hidden';
    $('dbModal').querySelector('.close').focus();
    await renderDatabase();
  }
  async function renderDatabase() {
    if (cloudOn()) return renderCloudDatabase();
    if (!dbOn) await dbConnect();
    if (!dbOn) {
      $('dbStatus').innerHTML = '<p><b>Base non connectée.</b> Vos stratégies et simulations sont pour l\'instant seulement dans ce navigateur.</p>' +
        '<p class="hint">Lancez la passerelle (version 1.4 ou plus, fichiers dans <i>Déployer → Envoi direct</i>) et connectez-la : tout sera enregistré dans une base SQLite sur votre PC ' +
        '(<code>%APPDATA%\\Forexia\\forexia.db</code>), y compris ce qui est déjà dans ce navigateur.</p>';
      $('dbBody').innerHTML = ''; $('dbExport').disabled = true;
      return;
    }
    try { dbInfo = await dbCall('info'); } catch (e) { /* on garde les derniers chiffres */ }
    const c = dbInfo.counts;
    $('dbStatus').innerHTML = '<p><b>Base connectée</b> : <code>' + esc(dbInfo.path) + '</code> (' + num1.format(dbInfo.size / 1024) + ' Ko)</p>' +
      '<div class="db-counts"><span><b>' + c.strategies + '</b> stratégies</span><span><b>' + c.simulations + '</b> simulations</span><span><b>' + c.events + '</b> actions au journal</span></div>';
    $('dbExport').disabled = false;
    renderJournal((await dbCall('events/list', { limit: 1000 })).items);
  }
  async function renderCloudDatabase() {
    const u = C.user;
    let events = [];
    try {
      const c = await C.counts();
      $('dbStatus').innerHTML = '<p><b>Compte en ligne « ' + esc(u.name) + ' »</b> : vos données sont enregistrées en ligne et retrouvées sur tous vos appareils.</p>' +
        '<div class="db-counts"><span><b>' + c.strategies + '</b> stratégies</span><span><b>' + c.simulations + '</b> simulations</span><span><b>' + c.events + '</b> actions au journal</span></div>' +
        (dbOn && dbInfo ? '<p class="hint">Copie également tenue à jour dans la base du PC (passerelle) : <code>' + esc(dbInfo.path) + '</code></p>' : '');
      $('dbExport').disabled = false;
      events = await C.listEvents(1000);
    } catch (e) {
      $('dbStatus').innerHTML = '<p class="err">' + esc(e.message) + '</p>' +
        (e.code === 'schema' ? '<p>Suivez les 3 étapes du bandeau jaune en haut de la page (script à copier, éditeur SQL de Supabase, réessayer).</p>' : '');
      if (e.code === 'schema') showCloudBanner();
      $('dbExport').disabled = true;
    }
    renderJournal(events);
  }
  function renderJournal(items) {
    const type = $('dbFilter').value;
    const ev = items.filter((e) => !type || e.type.indexOf(type) === 0);
    $('dbBody').innerHTML = ev.length ? '<div class="table-wrap"><table class="eval"><thead><tr><th class="l">Date</th><th class="l">Action</th><th class="l">Détail</th></tr></thead><tbody>' +
      ev.map((e) => '<tr><td class="l">' + new Date(e.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' }) + '</td><td class="l"><span class="badge ev">' +
        esc(EVENT_LABEL[e.type] || e.type) + '</span></td><td class="l wrap">' + esc(e.summary || '') + '</td></tr>').join('') + '</tbody></table></div>'
      : '<p class="eval-empty">Aucune action enregistrée pour l\'instant.</p>';
  }
  function closeDatabase() { $('dbModal').hidden = true; document.body.style.overflow = ''; }
  $('dbBtn').addEventListener('click', openDatabase);
  $('dbFilter').addEventListener('change', renderDatabase);
  $('dbRefresh').addEventListener('click', async () => {
    if (dbOn) { await dbSyncAll().catch(() => {}); dbInfo = await dbCall('info').catch(() => dbInfo); }
    if (cloudOn()) await cloudSync().catch(() => {});
    renderDatabase();
  });
  $('dbModal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDatabase(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('dbModal').hidden) closeDatabase(); });
  $('dbExport').addEventListener('click', async () => {
    try {
      const data = cloudOn()
        ? { exportedAt: new Date().toISOString(), account: C.user.name, strategies: await C.listStrategies(), simulations: await C.listSimulations(), events: await C.listEvents(10000) }
        : await dbCall('export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'forexia-base-' + F.data.iso(new Date()) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) { $('dbStatus').insertAdjacentHTML('beforeend', '<p class="err">' + esc(e.message) + '</p>'); }
  });

  // ---------- Import d'un EA Forexia ----------
  function importEA(parsed, fileName) { undoable('Import de « ' + fileName + ' »', () => importEAInner(parsed, fileName)); }
  function importEAInner(parsed, fileName) {
    const { strategy, config } = parsed;
    const s = Object.assign({ style: 'none' }, strategy);
    if (!s.frenchText) s.frenchText = F.french.toFrench(s) || '';
    s.plots = F.french.derivePlots(s);
    loadStrategy(s);
    const tfOk = [...$('brokerTf').options].some((o) => o.value === config.timeframe);
    applyConfig({
      pair: config.pair, leverage: config.leverage, exposurePct: config.exposurePct, period: config.period, dateFrom: config.dateFrom, dateTo: config.dateTo,
      broker: Object.assign({ symbol: (config.pair || $('pair').value).replace('/', ''), tf: tfOk ? config.timeframe : 'D1', intrabar: true }, config.broker),
      news: config.news ? Object.assign({ on: true }, config.news) : { on: false },
    });
    $('preset').value = 'mine';
    $('deleteStrat').hidden = true;
    $('presetDesc').textContent = 'Importée depuis « ' + fileName + ' »' + (config.resultPct != null ? ' (résultat au déploiement : ' + signed(config.resultPct, num2) + ' %)' : '') +
      '. Pensez à « Enregistrer la stratégie ».';
    $('importNotice').textContent = '« ' + s.name + ' » importée : vérifiez la source des données puis lancez le backtest.';
    logEvent('strategy.imported', 'EA importé : ' + fileName + ' → ' + s.name, { fileName: fileName, strategy: s, config: config });
    updateStyleHint();
    $('stratName').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function importFromText(text, fileName) {
    $('importError').textContent = ''; $('importNotice').textContent = '';
    try {
      const parsed = F.mql5.parseEA(text);
      if (!parsed) { $('importError').textContent = '« ' + fileName + ' » n\'est pas un EA généré par Forexia.'; return; }
      importEA(parsed, fileName);
    } catch (e) { $('importError').textContent = e.message; }
  }
  $('importFile').addEventListener('change', async () => {
    const f = $('importFile').files[0];
    if (f) importFromText(await f.text(), f.name);
    $('importFile').value = '';
  });
  $('importBox').addEventListener('toggle', async () => {
    if (!$('importBox').open || !bridgeToken) return;
    try {
      const st = await bridgeCall('GET', '/status');
      bridgeTerms = st.terminals || [];
      const r = await bridgeCall('POST', '/experts', { terminalId: (bridgeTerms[0] || {}).id });
      if (!r.ok || !r.experts || !r.experts.length) return;
      $('importList').innerHTML = r.experts.map((x) => '<option value="' + esc(x.fileName) + '">' + esc(x.fileName.replace(/^Forexia_|\.mq5$/g, '').replace(/_/g, ' ')) +
        ' — ' + new Date(x.modified * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) + '</option>').join('');
      $('importMt5').hidden = false;
    } catch (e) { /* passerelle absente ou ancienne : import par fichier seulement */ }
  });
  $('importFromMt5').addEventListener('click', async () => {
    const name = $('importList').value;
    try {
      const r = await bridgeCall('POST', '/experts', { terminalId: (bridgeTerms[0] || {}).id, fileName: name });
      const item = (r.experts || []).find((x) => x.fileName === name);
      if (!item || !item.code) throw new Error('EA introuvable dans MT5.');
      importFromText(item.code, name);
    } catch (e) { $('importError').textContent = e.message || 'Passerelle injoignable.'; }
  });

  // ---------- Évaluation : historique des simulations ----------
  const EVAL_KEY = 'forexia.evaluations';
  const evalStore = {
    get() { try { return JSON.parse(localStorage.getItem(EVAL_KEY)) || []; } catch (e) { return []; } },
    set(list) { try { localStorage.setItem(EVAL_KEY, JSON.stringify(list.slice(-500))); } catch (e) { /* ignoré */ } },
  };
  let evalMemory = null; // repli si le stockage du navigateur est indisponible
  function evalList() { const l = evalStore.get(); return l.length || !evalMemory ? l : evalMemory; }
  function evalSave(list) { evalMemory = list; evalStore.set(list); updateEvalCount(); }
  // Onglet « Stratégie en cours » (par défaut) ou « Historique complet ».
  let evalScope = 'current';
  function currentStratName() { return currentStrategy().name; }
  function updateEvalCount() {
    const all = evalList(), name = currentStratName(), n = all.filter((e) => e.name === name).length;
    $('evalCount').textContent = n;
    $('evalBtn').title = n + ' simulation(s) de « ' + name + ' » · ' + all.length + ' au total dans l\'historique';
  }
  function setEvalScope(scope) {
    evalScope = scope;
    $('evalScopeCurrent').setAttribute('aria-selected', scope === 'current');
    $('evalScopeAll').setAttribute('aria-selected', scope === 'all');
    renderEvaluation();
  }
  function dataLabel(loaded, settings) {
    if (loaded.broker) return 'MT5 ' + (settings.symbol || '') + ' ' + (loaded.timeframe || '');
    if (/^Fichier/.test(loaded.source)) return 'CSV ' + (loaded.timeframe || '');
    if (/BCE/.test(loaded.source)) return 'BCE' + (/mèches/.test(loaded.source) ? ' + mèches' : '');
    return 'Simulées';
  }
  function recordEvaluation(c) {
    const s = c.result.stats, st = c.result.startIndex;
    const avg = averageGain(c.result.wealth || c.result.equity, c.settings.capital);
    const entry = {
      at: new Date().toISOString(), name: c.strat.name, pair: c.settings.pair, style: c.strat.style || 'none',
      from: c.bars[st].date.slice(0, 10), to: c.bars[c.bars.length - 1].date.slice(0, 10), period: PERIOD_LABEL[c.periodKey],
      data: dataLabel(c.loaded, c.settings), leverage: c.settings.leverage, capital: c.settings.capital,
      returnPct: s.returnPct, avgGainPct: avg.pct, withdrawn: s.totalWithdrawn || 0, monthlyGain: monthlyStats(c.result, c.settings.capital).avg, trades: s.trades, winRate: s.winRate, maxDrawdownPct: s.maxDrawdownPct,
      profitFactor: Number.isFinite(s.profitFactor) ? s.profitFactor : null,
      rules: [c.strat.longEntry, c.strat.longExit, c.strat.shortEntry, c.strat.shortExit, c.strat.stopLossPips, c.strat.takeProfitPips].concat(TM_FIELDS.map((f) => c.strat[f] || 0)).join('|'),
      strategy: c.strat, config: c.config,
    };
    entry.key = entry.at + '|' + entry.name;
    const list = evalList();
    const last = list[list.length - 1];
    // Même stratégie, mêmes réglages, même résultat : on ne compte pas deux fois la même simulation.
    const same = (a, b) => a && ['name', 'pair', 'from', 'to', 'data', 'leverage', 'capital', 'rules'].every((k) => a[k] === b[k]) && Math.abs(a.returnPct - b.returnPct) < 1e-9;
    if (same(last, entry)) return;
    list.push(entry);
    evalSave(list);
    // Dans la base : la simulation complète, avec la liste de ses trades.
    const full = Object.assign({}, entry, { tradeList: c.result.trades.map((t) => ({
      dir: t.dir, entryDate: t.entryDate, exitDate: t.exitDate, entryPrice: t.entryPrice, exitPrice: t.exitPrice, lots: t.lots, pips: t.pips, pnl: t.pnl, reason: t.reason })) });
    dbPush('simulations/put', full);
    cloudPush(() => C.putSimulations([full]));
    logEvent('simulation', 'Simulation : ' + entry.name + ' · ' + entry.pair + ' · ' + entry.data + ' → ' + signed(entry.returnPct, num2) + ' % (gain moyen ' + signed(entry.avgGainPct, num1) + ' %)', { key: entry.key });
  }
  /** Durée lisible entre deux dates « AAAA-MM-JJ » : « 2 ans 1 mois », « 6 mois 12 j », « 45 jours ». */
  function durationDays(from, to) { return Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 864e5); }
  // À partir de 2 mois : arrondi au mois le plus proche (une période « 1 an » qui commence après un week-end fait 361 jours).
  function durationFromDays(days) {
    days = Math.round(days);
    if (days >= 60) {
      const total = Math.round(days / 30.4375), y = Math.floor(total / 12), m = total % 12;
      return y ? y + ' an' + (y > 1 ? 's' : '') + (m ? ' ' + m + ' mois' : '') : m + ' mois';
    }
    if (days >= 28) { const rest = days - 30; return rest > 2 ? '1 mois ' + rest + ' j' : '1 mois'; }
    return days + ' jour' + (days > 1 ? 's' : '');
  }
  function durationLabel(from, to) { return durationFromDays(durationDays(from, to)); }
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  // Filtres : stratégie, recherche, paire, source de données, résultat. Les moyennes portent sur les lignes affichées.
  function fillFilter(id, values) {
    const sel = $(id), cur = sel.value, first = sel.options[0].outerHTML;
    sel.innerHTML = first + values.map((v) => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
    sel.value = values.includes(cur) ? cur : '';
  }
  function evalFiltered(list) {
    const fs = evalScope === 'current' ? currentStratName() : $('evalFStrat').value;
    const q = evalScope === 'current' ? '' : $('evalFSearch').value.trim().toLowerCase(), fp = $('evalFPair').value, fd = $('evalFData').value, fr = $('evalFResult').value;
    return list.map((e, i) => ({ e: e, i: i })).filter(({ e }) => (!fs || e.name === fs) && (!q || e.name.toLowerCase().includes(q)) &&
      (!fp || e.pair === fp) && (!fd || e.data === fd) && (!fr || (fr === 'win' ? e.returnPct > 0 : e.returnPct <= 0)));
  }
  ['evalFStrat', 'evalFPair', 'evalFData', 'evalFResult'].forEach((id) => $(id).addEventListener('change', () => renderEvaluation()));
  $('evalFSearch').addEventListener('input', () => renderEvaluation());
  $('evalFReset').addEventListener('click', () => {
    ['evalFStrat', 'evalFPair', 'evalFData', 'evalFResult'].forEach((id) => { $(id).value = ''; });
    $('evalFSearch').value = '';
    renderEvaluation();
  });
  function renderEvaluation() {
    const all = evalList();
    const uniq = (f) => [...new Set(all.map(f))].sort((a, b) => a.localeCompare(b, 'fr'));
    fillFilter('evalFStrat', uniq((e) => e.name)); fillFilter('evalFPair', uniq((e) => e.pair)); fillFilter('evalFData', uniq((e) => e.data));
    const name = currentStratName(), mineN = all.filter((e) => e.name === name).length;
    $('evalScopeCurrentN').textContent = mineN; $('evalScopeAllN').textContent = all.length;
    $('evalTitle').textContent = evalScope === 'current' ? 'Évaluation de « ' + name + ' »' : 'Historique des simulations';
    // dans l'onglet « Stratégie en cours », le choix de stratégie et la recherche n'ont pas lieu d'être
    $('evalFStratField').hidden = evalScope === 'current';
    $('evalFSearch').closest('label').hidden = evalScope === 'current';
    $('evalFilters').hidden = !all.length;
    $('evalClear').disabled = !all.length;
    if (!all.length) { $('evalExport').disabled = true; $('evalBody').innerHTML = '<p class="eval-empty">Aucune simulation pour l\'instant : lancez un backtest, il s\'ajoutera ici.</p>'; return; }
    const shown = evalFiltered(all);
    $('evalExport').disabled = !shown.length;
    if (!shown.length) {
      $('evalBody').innerHTML = evalScope === 'current' && !mineN
        ? '<p class="eval-empty">Aucune simulation de « ' + esc(name) + ' » pour l\'instant : lancez un backtest. Les ' + all.length + ' simulations précédentes sont dans <button type="button" class="link" id="evalGoAll">l\'historique complet</button>.</p>'
        : '<p class="eval-empty">Aucune simulation ne correspond à ces filtres.</p>';
      const go = $('evalGoAll'); if (go) go.addEventListener('click', () => setEvalScope('all'));
      return;
    }
    const list = shown.map((x) => x.e);
    const p = (v) => '<span class="' + cls(v) + '">' + signed(v, num2) + ' %</span>';
    const rows = shown.map(({ e, i }) => '<tr>' +
      '<td>' + (i + 1) + '</td><td class="l">' + new Date(e.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) + '</td>' +
      '<td class="name" title="' + esc(e.name) + '">' + esc(e.name) + '</td><td class="l">' + esc(e.pair) + '</td>' +
      '<td class="l">' + frDate(e.from) + ' → ' + frDate(e.to) + '</td><td class="l" title="' + durationDays(e.from, e.to) + ' jours">' + durationLabel(e.from, e.to) + '</td>' +
      '<td class="l">' + esc(e.data) + '</td>' +
      '<td>1:' + e.leverage + '</td><td>' + money.format(e.capital) + '</td>' +
      '<td>' + p(e.returnPct) + '</td><td class="avg-col">' + p(e.avgGainPct) + '</td><td class="' + cls(e.monthlyGain || 0) + '">' + (e.monthlyGain == null ? '—' : signed(e.monthlyGain, money)) + '</td><td>' + (e.withdrawn ? money.format(e.withdrawn) : '—') + '</td>' +
      '<td>' + e.trades + '</td><td>' + num1.format(e.winRate) + ' %</td><td>−' + num1.format(e.maxDrawdownPct) + ' %</td>' +
      '<td>' + (e.strategy ? '<button type="button" class="reload" data-reload="' + i + '" title="Remettre cette stratégie et ses réglages dans le formulaire">Recharger</button>' : '') + '</td>' +
      '<td><button type="button" class="del" data-del="' + i + '" title="Retirer cette ligne" aria-label="Retirer la simulation ' + (i + 1) + '">✕</button></td></tr>').join('');
    const filtered = evalScope === 'all' && shown.length < all.length;
    const foot = '<tr><td colspan="5" class="l">Moyenne sur ' + list.length + ' simulation' + (list.length > 1 ? 's' : '') + (filtered ? ' (filtrées)' : '') + '</td><td class="l">' + durationFromDays(mean(list.map((e) => durationDays(e.from, e.to)))) + '</td><td colspan="3"></td>' +
      '<td>' + p(mean(list.map((e) => e.returnPct))) + '</td><td class="avg-col" title="Moyenne des gains moyens">' + p(mean(list.map((e) => e.avgGainPct))) + '</td><td>' + signed(mean(list.filter((e) => e.monthlyGain != null).map((e) => e.monthlyGain)), money) + '</td><td>' + money.format(mean(list.map((e) => e.withdrawn || 0))) + '</td>' +
      '<td>' + num1.format(mean(list.map((e) => e.trades))) + '</td><td>' + num1.format(mean(list.map((e) => e.winRate))) + ' %</td>' +
      '<td>−' + num1.format(mean(list.map((e) => e.maxDrawdownPct))) + ' %</td><td></td><td></td></tr>';
    $('evalBody').innerHTML = (filtered ? '<p class="eval-count">' + shown.length + ' simulation(s) affichée(s) sur ' + all.length + '</p>' : '') + '<div class="table-wrap"><table class="eval"><thead><tr><th>#</th><th class="l">Date</th><th class="l">Stratégie</th><th class="l">Paire</th>' +
      '<th class="l">Période testée</th><th class="l">Durée</th><th class="l">Données</th><th>Levier</th><th>Capital</th><th>Résultat</th><th class="avg-col">Gain moyen</th><th>Par mois</th><th>Retiré</th>' +
      '<th>Trades</th><th>Gagnants</th><th>Drawdown</th><th></th><th></th></tr></thead><tbody>' + rows + '</tbody><tfoot>' + foot + '</tfoot></table></div>';
  }
  $('evalScopeCurrent').addEventListener('click', () => setEvalScope('current'));
  $('evalScopeAll').addEventListener('click', () => setEvalScope('all'));
  function openEvaluation() {
    evalScope = 'current';
    $('evalScopeCurrent').setAttribute('aria-selected', 'true'); $('evalScopeAll').setAttribute('aria-selected', 'false');
    $('evalConfirm').hidden = true;
    renderEvaluation();
    $('evalModal').hidden = false;
    document.body.style.overflow = 'hidden';
    $('evalModal').querySelector('.close').focus();
  }
  function closeEvaluation() { $('evalModal').hidden = true; document.body.style.overflow = ''; }
  $('evalBtn').addEventListener('click', openEvaluation);
  $('evalModal').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeEvaluation();
    const re = e.target.closest('[data-reload]');
    if (re) {
      pushUndo('Rechargement depuis l\'évaluation');
      const entry = evalList()[+re.dataset.reload];
      loadStrategy(entry.strategy); applyConfig(entry.config);
      $('preset').value = 'mine'; $('deleteStrat').hidden = true;
      $('presetDesc').textContent = 'Rechargée depuis l\'évaluation (simulation du ' + new Date(entry.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) + '). Pensez à « Enregistrer la stratégie ».';
      updateStyleHint();
      return closeEvaluation();
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      pushUndo('Suppression d\'une simulation');
      toast('Simulation retirée du tableau.', true);
      const list = evalList();
      const [gone] = list.splice(+del.dataset.del, 1);
      evalSave(list);
      if (gone && gone.key) { dbPush('simulations/delete', { key: gone.key }); cloudPush(() => C.deleteSimulation(gone.key)); }
      renderEvaluation();
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('evalModal').hidden) closeEvaluation(); });
  $('evalClear').addEventListener('click', () => { $('evalConfirmN').textContent = evalList().length; $('evalConfirm').hidden = false; });
  $('evalClearCancel').addEventListener('click', () => { $('evalConfirm').hidden = true; });
  $('evalClearGo').addEventListener('click', () => {
    pushUndo('Effacement du tableau d\'évaluation');
    toast('Tableau d\'évaluation effacé.', true);
    const n = evalList().length;
    evalSave([]);
    dbPush('simulations/clear', {});
    cloudPush(() => C.clearSimulations());
    logEvent('simulation.cleared', 'Tableau d\'évaluation effacé (' + n + ' simulations)');
    $('evalConfirm').hidden = true;
    renderEvaluation();
  });
  $('evalExport').addEventListener('click', () => {
    const list = evalFiltered(evalList()).map((x) => x.e); // export des lignes affichées (filtres appliqués)
    const head = 'numero;date;strategie;paire;debut;fin;duree_jours;donnees;levier;capital;resultat_pct;gain_moyen_pct;gain_par_mois;retire;trades;gagnants_pct;drawdown_pct';
    const f2 = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
    const rows = list.map((e, i) => [i + 1, e.at.slice(0, 16).replace('T', ' '), '"' + e.name.replace(/"/g, '""') + '"', e.pair, e.from, e.to, durationDays(e.from, e.to), e.data, e.leverage,
      f2(e.capital), f2(e.returnPct), f2(e.avgGainPct), e.monthlyGain == null ? '' : f2(e.monthlyGain), f2(e.withdrawn || 0), e.trades, f2(e.winRate), f2(e.maxDrawdownPct)].join(';'));
    rows.push(['moyenne', '', '', '', '', '', Math.round(mean(list.map((e) => durationDays(e.from, e.to)))), '', '', '', f2(mean(list.map((e) => e.returnPct))), f2(mean(list.map((e) => e.avgGainPct))), f2(mean(list.filter((e) => e.monthlyGain != null).map((e) => e.monthlyGain))), f2(mean(list.map((e) => e.withdrawn || 0))),
      f2(mean(list.map((e) => e.trades))), f2(mean(list.map((e) => e.winRate))), f2(mean(list.map((e) => e.maxDrawdownPct)))].join(';'));
    const blob = new Blob(['\ufeff' + [head].concat(rows).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'forexia-evaluation.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  updateEvalCount();
  $('stratName').addEventListener('input', updateEvalCount);
  $('form').addEventListener('change', () => setTimeout(updateEvalCount, 0));
  dbBadge();
  // Au chargement : compte en ligne (ou écran de connexion), puis base du PC si la passerelle tourne.
  renderUser();
  let guest = false;
  try { guest = sessionStorage.getItem(GUEST_KEY) === '1'; } catch (e) { /* ignoré */ }
  if (cloudOn()) cloudSync().catch(cloudFail);
  else if (!guest) showGate();
  // Au chargement : connexion silencieuse à la base si la passerelle tourne déjà.
  if (bridgeToken) fetch(BRIDGE_URL + '/ping').then(() => dbConnect()).catch(() => {});

  // ---------- Annuler / rétablir (Ctrl+Z, Ctrl+Y) ----------
  // Chaque action enregistre l'état d'avant : formulaire (stratégie + réglages), stratégies enregistrées,
  // tableau d'évaluation. Annuler remet cet état et reporte les différences dans la base du PC et le compte en ligne.
  const undoStack = [], redoStack = [];
  let formState = null, restoring = false;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  function captureForm() {
    return { strat: currentStrategy(), config: currentConfig(), preset: $('preset').value, desc: $('presetDesc').textContent, style: $('style').value };
  }
  function capture(label, form) { return { label: label, form: clone(form || captureForm()), strategies: clone(storage.get()), evaluations: clone(evalList()) }; }
  function syncFormState() { formState = captureForm(); }
  function pushUndo(label, form) {
    undoStack.push(capture(label, form));
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
  }
  // Action programmée : état d'avant enregistré, action exécutée, nouvel état retenu.
  function undoable(label, fn) {
    if (restoring) return fn();
    pushUndo(label);
    const r = fn();
    if (r && typeof r.then === 'function') return r.finally(syncFormState);
    syncFormState();
    return r;
  }
  function restoreData(snap) {
    // Stratégies
    const cur = storage.get(), tgt = snap.strategies;
    for (const t of tgt) {
      const c = cur.find((x) => x.name === t.name);
      if (!c || JSON.stringify(c) !== JSON.stringify(t)) { dbPush('strategies/put', { name: t.name, data: t, updatedAt: t.savedAt }); cloudPush(() => C.putStrategy(t)); }
    }
    for (const c of cur) if (!tgt.some((t) => t.name === c.name)) { dbPush('strategies/delete', { name: c.name }); cloudPush(() => C.deleteStrategy(c.name)); }
    storage.set(tgt);
    // Évaluation
    const ce = evalList(), te = snap.evaluations;
    const back = te.filter((t) => t.key && !ce.some((c) => c.key === t.key));
    if (back.length) { dbPush('simulations/put', { items: back }); cloudPush(() => C.putSimulations(back)); }
    for (const c of ce) if (c.key && !te.some((t) => t.key === c.key)) { dbPush('simulations/delete', { key: c.key }); cloudPush(() => C.deleteSimulation(c.key)); }
    evalSave(te);
    if (!$('evalModal').hidden) renderEvaluation();
  }
  function restore(snap) {
    restoring = true;
    try {
      restoreData(snap);
      const f = snap.form;
      refreshPresetSelect('mine');
      loadStrategy(f.strat);
      applyConfig(f.config);
      $('style').value = f.style;
      appliedStyle = f.strat.style || 'none';
      $('preset').value = [...$('preset').options].some((o) => o.value === f.preset) ? f.preset : 'mine';
      $('deleteStrat').hidden = !$('preset').value.startsWith('saved:');
      $('presetDesc').textContent = f.desc;
      updateStyleHint();
      updateWithdrawUI();
      syncFormState();
    } finally { restoring = false; }
  }
  function undo() {
    const snap = undoStack.pop();
    if (!snap) return toast('Rien à annuler.');
    redoStack.push(capture(snap.label));
    restore(snap);
    toast('Annulé : ' + snap.label + ' — Ctrl+Y pour rétablir.');
  }
  function redo() {
    const snap = redoStack.pop();
    if (!snap) return toast('Rien à rétablir.');
    undoStack.push(capture(snap.label));
    restore(snap);
    toast('Rétabli : ' + snap.label + '.');
  }
  // Changements faits à la main dans le formulaire (listes, cases, champs) : l'état d'avant est celui retenu en dernier.
  function fieldLabel(el) {
    const lab = el.closest('label');
    const txt = lab ? (lab.querySelector('span b, span') ? lab.querySelector('span b, span').textContent : lab.childNodes[0].textContent) : el.name || el.id;
    return String(txt).replace(/\s+/g, ' ').trim().slice(0, 50);
  }
  $('form').addEventListener('change', (e) => {
    if (restoring || e.target.type === 'file' || !formState) return;
    pushUndo('Modification « ' + fieldLabel(e.target) + ' »', formState);
    setTimeout(syncFormState, 0); // après les réactions à ce changement (chargement de modèle…)
  });
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k !== 'z' && k !== 'y') return;
    const t = document.activeElement;
    // Dans une zone de saisie, Ctrl+Z garde son rôle habituel (annuler la frappe).
    if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|search|number|password|email)$/.test(t.type)))) return;
    if (!$('authGate').hidden) return;
    e.preventDefault();
    if (k === 'y' || e.shiftKey) redo(); else undo();
  });
  let toastTimer = null;
  function toast(msg, withUndo) {
    $('toastMsg').textContent = msg;
    $('toastUndo').hidden = !withUndo;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, withUndo ? 7000 : 3500);
  }
  $('toastUndo').addEventListener('click', () => { $('toast').hidden = true; undo(); });

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
  syncFormState();
})();
