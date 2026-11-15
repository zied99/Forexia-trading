/* Forexia — contrôleur de l'interface. */
(function () {
  'use strict';
  const F = window.Forexia;
  const $ = (id) => document.getElementById(id);
  const RULE_FIELDS = ['longEntry', 'longExit', 'shortEntry', 'shortExit'];
  const STORE_KEY = 'forexia.strategies';
  const LEVERAGES = [1, 2, 5, 10, 20, 30, 50, 100, 200, 500];
  const SERIES_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
  const PERIOD_LABEL = { '6m': '6 mois', '1y': '1 an', '2y': '2 ans' };

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
    html += '<option value="custom">Stratégie vierge…</option>';
    $('preset').innerHTML = html;
    if (selected) $('preset').value = selected;
  }

  function currentStrategy() {
    const s = { name: $('stratName').value.trim() || 'Ma stratégie', plots: $('plots').value.trim() };
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
    $('presetDesc').textContent = s.description || '';
    validateAll();
  }
  function applyPresetSelection() {
    const v = $('preset').value;
    $('deleteStrat').hidden = !v.startsWith('saved:');
    if (v === 'custom') { loadStrategy({ name: '' }); $('longEntry').focus(); return; }
    if (v.startsWith('preset:')) loadStrategy(F.presets.list.find((p) => 'preset:' + p.id === v));
    if (v.startsWith('saved:')) loadStrategy(storage.get()[+v.slice(6)]);
  }
  $('preset').addEventListener('change', applyPresetSelection);

  $('saveStrat').addEventListener('click', () => {
    const s = currentStrategy();
    if (!validateAll()) return;
    const list = storage.get();
    const idx = list.findIndex((x) => x.name === s.name);
    s.description = 'Stratégie enregistrée.';
    if (idx >= 0) list[idx] = s; else list.push(s);
    if (!storage.set(list)) { $('formError').textContent = 'Impossible d\'enregistrer (stockage du navigateur indisponible).'; return; }
    refreshPresetSelect('saved:' + (idx >= 0 ? idx : list.length - 1));
    $('deleteStrat').hidden = false;
    $('presetDesc').textContent = '« ' + s.name + ' » enregistrée dans ce navigateur.';
  });
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
    $(f).addEventListener('input', () => { autoGrow($(f)); validateField(f); if (!$('preset').value.startsWith('saved:')) $('presetDesc').textContent = ''; });
    $(f).addEventListener('focus', () => { lastFocusedRule = $(f); });
  }

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
  document.querySelectorAll('input[name=source]').forEach((r) => r.addEventListener('change', () => { $('csvField').hidden = sourceValue() !== 'csv'; }));
  $('csvFile').addEventListener('change', async () => {
    const file = $('csvFile').files[0];
    csvBars = null;
    if (!file) return;
    try {
      csvBars = F.data.parseCSV(await file.text());
      csvName = file.name;
      $('formError').textContent = '';
    } catch (e) { $('formError').textContent = 'CSV : ' + e.message; }
  });

  async function loadBars(pair, periodKey) {
    const src = sourceValue();
    if (src === 'csv') {
      if (!csvBars) throw new Error('Choisissez un fichier CSV valide.');
      const last = new Date(csvBars[csvBars.length - 1].date.slice(0, 10) + 'T00:00:00Z');
      const range = F.data.periodRange(periodKey, last);
      return { bars: csvBars, range: range, source: 'Fichier « ' + csvName + ' »' };
    }
    const today = new Date(F.data.iso(new Date()) + 'T00:00:00Z');
    const range = F.data.periodRange(periodKey, today);
    if (src === 'online') {
      const key = pair + '|' + periodKey + '|' + F.data.iso(today);
      try {
        if (!onlineCache.has(key)) onlineCache.set(key, await F.data.fetchFrankfurter(pair, range.fetchStart, range.end));
        return { bars: onlineCache.get(key), range: range, source: 'Cours BCE journaliers (Frankfurter)' };
      } catch (e) {
        return {
          bars: F.data.generateSynthetic(pair, range.fetchStart, range.end), range: range, source: 'Données simulées',
          warning: e.message + '. Le backtest a été lancé sur des <b>données simulées</b> : les résultats ne reflètent pas le marché réel.',
        };
      }
    }
    return { bars: F.data.generateSynthetic(pair, range.fetchStart, range.end), range: range, source: 'Données simulées (marche aléatoire)' };
  }

  // ---------- Lancement ----------
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('formError').textContent = '';
    const strat = currentStrategy();
    if (!validateAll()) { $('formError').textContent = 'Corrigez les règles en rouge.'; return; }
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
      if (bars.length - startIndex < 10) throw new Error('Pas assez de cotations sur la période choisie.');
      const settings = { capital, leverage, exposurePct: exposure, spreadPips: spread, pair, startIndex };
      const result = F.backtest.runBacktest(bars, strat, settings);
      const warnings = [];
      if (loaded.warning) warnings.push(loaded.warning);
      if (startIndex < 200) warnings.push('Historique antérieur limité (' + startIndex + ' bougies) : les indicateurs à longue période (ex. EMA 200) peuvent être indisponibles en début de test.');
      if (result.ruined) warnings.push('<b>Compte liquidé</b> : le capital a été entièrement perdu. Réduisez le levier ou l\'exposition.');
      render({ bars, strat, settings, result, loaded, periodKey, warnings });
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
    const { bars, strat, settings, result, loaded, periodKey, warnings } = ctx;
    const s = result.stats, st = result.startIndex;
    const view = bars.slice(st);
    const dates = view.map((b) => b.date);
    const dec = /JPY/.test(settings.pair) ? 3 : 5;
    const pfmt = (v) => v.toFixed(dec);

    let html = '';
    for (const w of warnings) html += '<div class="banner warn">' + w + '</div>';
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
})();
