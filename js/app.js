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
  // ---------- Toutes les données dans la base : passerelle (base SQLite sur votre PC) et compte en ligne ----------
  // Chaque donnée gardée dans le navigateur est aussi enregistrée dans la base dès qu'elle change, et récupérée
  // à la connexion (la version la plus récente l'emporte ; à la première connexion d'un appareil, les listes sont réunies).
  const SYNC_KEYS = ['forexia.agentGuide', 'forexia.fx', 'forexia.batches', 'forexia.eras', 'forexia.events', 'forexia.wdPresets', 'forexia.wdResults', 'forexia.drawings', 'forexia.lastRun'];
  const SYNC_META = 'forexia.syncMeta';
  const syncMeta = () => { try { return JSON.parse(localStorage.getItem(SYNC_META)) || {}; } catch (e) { return {}; } };
  let syncMuted = false, syncTimer = null, kvOldBridge = false;
  const syncDirty = new Set();
  // Le navigateur n'est qu'une copie : chaque donnée de Forexia est gardée en mémoire pendant la session et envoyée à
  // la base. Si le stockage du navigateur est plein, l'écriture n'échoue pas : la donnée reste en mémoire et dans la
  // base, et sa vieille copie est retirée du navigateur (elle sera reprise de la base au prochain chargement).
  const lsMem = new Map();
  let lsFullKeys = new Set();
  const isQuota = (e) => /quota|exceed|full/i.test((e && (e.name + ' ' + e.message)) || '');
  (function watchStorage() {
    const P = Storage.prototype, set = P.setItem, get = P.getItem, rem = P.removeItem;
    const ours = (st, k) => st === window.localStorage && String(k).startsWith('forexia.');
    P.setItem = function (k, v) {
      if (!ours(this, k)) return set.call(this, k, v);
      v = String(v); lsMem.set(k, v);
      try { set.call(this, k, v); lsFullKeys.delete(k); }
      catch (e) {
        if (!isQuota(e)) throw e;
        try { rem.call(this, k); } catch (x) { /* ignoré */ }
        lsFullKeys.add(k); storageFullNotice();
      }
      if (!syncMuted && SYNC_KEYS.includes(k)) kvDirty(k);
    };
    P.getItem = function (k) { return ours(this, k) && lsMem.has(k) ? lsMem.get(k) : get.call(this, k); };
    P.removeItem = function (k) { if (ours(this, k)) { lsMem.delete(k); lsFullKeys.delete(k); } rem.call(this, k); if (!syncMuted && SYNC_KEYS.includes(k) && this === window.localStorage) kvDirty(k); };
  })();
  /** Stockage du navigateur plein : sans base connectée, les nouvelles données seraient perdues au rechargement. */
  let storageNoticeAt = 0;
  function storageFullNotice() {
    setTimeout(() => {
      if (typeof dbOn !== 'undefined' && (dbOn || cloudOn())) return; // tout est dans la base : rien à signaler
      if (Date.now() - storageNoticeAt < 60000) return;
      storageNoticeAt = Date.now();
      toast('Stockage du navigateur plein et aucune base connectée : vos dernières données ne sont gardées que jusqu\'à la fermeture de la page. Connectez la base (bouton « Base de données » : passerelle MT5, ou compte en ligne) pour tout y garder.', false);
    }, 2500); // après le message de l'action en cours
  }
  function kvDirty(k) {
    const m = syncMeta(); m[k] = new Date().toISOString();
    try { localStorage.setItem(SYNC_META, JSON.stringify(m)); } catch (e) { /* ignoré */ }
    syncDirty.add(k);
    clearTimeout(syncTimer); syncTimer = setTimeout(kvFlush, 1200);
  }
  const kvRead = (k) => { try { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } };
  function kvWrite(k, data, at) {
    syncMuted = true;
    try {
      if (data == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(data));
      const m = syncMeta(); m[k] = at; localStorage.setItem(SYNC_META, JSON.stringify(m));
    } catch (e) { /* ignoré */ } finally { syncMuted = false; }
  }
  async function kvToBridge(items) {
    if (!dbOn || kvOldBridge) return;
    for (const it of items) {
      try { await dbCall('kv/put', it); }
      catch (e) { if (/Inconnu/.test(e.message)) { kvOldBridge = true; toast('Mettez à jour la passerelle MT5 (version 1.6) pour enregistrer aussi les FX, batchs, époques… dans la base.', false); } return; }
    }
  }
  async function kvToCloud(items) {
    if (!cloudOn()) return;
    const st = await C.getSettings();
    st.kv = st.kv || {};
    for (const it of items) st.kv[it.key] = { data: it.data, updatedAt: it.updatedAt };
    await C.putSettings(st);
  }
  async function kvFlush() {
    const keys = [...syncDirty]; syncDirty.clear();
    if (!keys.length) return;
    const m = syncMeta(), items = keys.map((k) => ({ key: k, data: kvRead(k), updatedAt: m[k] || new Date().toISOString() }));
    await kvToBridge(items);
    if (cloudOn()) cloudPush(() => kvToCloud(items));
  }
  window.addEventListener('beforeunload', () => { if (syncDirty.size) kvFlush(); });
  // listes d'objets identifiés (FX, batchs, époques, mécaniques…) : réunion des deux côtés
  function kvUnion(local, remote) {
    if (!Array.isArray(local) || !Array.isArray(remote)) return remote;
    const id = (x) => (x && (x.id || x.key || x.name)) || JSON.stringify(x), map = new Map();
    remote.forEach((x) => map.set(id(x), x)); local.forEach((x) => map.set(id(x), x));
    return [...map.values()];
  }
  /** Fusion avec une base : remote = [{key, data, updatedAt}] ; push(items) enregistre côté base. */
  async function kvSync(remote, push) {
    const m = syncMeta(), out = [];
    let changed = false;
    for (const k of SYNC_KEYS) {
      const r = remote.find((x) => x.key === k), l = kvRead(k), lAt = m[k];
      if (!r) { if (l != null) out.push({ key: k, data: l, updatedAt: lAt || new Date().toISOString() }); continue; }
      if (!lAt) {
        // jamais synchronisée sur cet appareil : on réunit
        const d = l == null ? r.data : kvUnion(l, r.data);
        kvWrite(k, d, r.updatedAt || new Date().toISOString()); changed = true;
        if (JSON.stringify(d) !== JSON.stringify(r.data)) { const at = new Date().toISOString(); kvWrite(k, d, at); out.push({ key: k, data: d, updatedAt: at }); }
      } else if ((r.updatedAt || '') > lAt || (l == null && r.data != null)) { kvWrite(k, r.data, r.updatedAt); changed = true; }
      else if (lAt > (r.updatedAt || '')) out.push({ key: k, data: l, updatedAt: lAt });
    }
    if (out.length) await push(out);
    if (changed) kvRefreshUi();
  }
  function kvRefreshUi() {
    try { updateFxCount(); refreshWdPresetPick(); updateBatchCount(); updateAgBtn(); } catch (e) { /* ignoré */ }
    if (!$('agModal').hidden && !$('agModal').contains(document.activeElement)) openAgent();
    if (!$('fxModal').hidden) openFx();
    if (!$('evalModal').hidden) renderEvaluation();
  }
  async function kvSyncBridge() {
    if (!dbOn) return;
    let r;
    try { r = await dbCall('kv/list'); } catch (e) { if (/Inconnu/.test(e.message)) kvOldBridge = true; return; }
    kvOldBridge = false;
    await kvSync(r.items || [], kvToBridge);
  }
  async function kvSyncCloud() {
    if (!cloudOn()) return;
    const st = await C.getSettings(), kv = st.kv || {};
    await kvSync(Object.keys(kv).map((k) => ({ key: k, data: kv[k].data, updatedAt: kv[k].updatedAt })), kvToCloud);
  }

  /** Écrit une donnée de Forexia (mémoire + navigateur si possible + base) : réussit toujours. */
  function lsSet(key, text) { localStorage.setItem(key, text); return true; }
  function lsFullToast() { storageFullNotice(); }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const frDate = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(d); return m ? m[3] + '/' + m[2] + '/' + m[1] + m[4] : d; };
  const shortDate = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d); return m ? ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][+m[2] - 1] + ' ' + m[1].slice(2) : d; };

  const storage = {
    get() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (e) { return []; } },
    set(list) { try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); return true; } catch (e) { return false; } },
  };

  let lastFocusedRule = $('longEntry');
  const BRIDGE_URL = 'http://127.0.0.1:8787';
  const BRIDGE_MIN = '1.6'; // version minimale de la passerelle attendue par cette page
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
    renderPresetPick();
  }

  // ---------- Liste « Modèle » personnalisée : choisir, renommer ✏️ ou supprimer 🗑 une stratégie enregistrée ----------
  // (une liste déroulante native ne peut pas contenir de boutons ; la <select> cachée reste la source de vérité)
  (function () {
    const sel = $('preset'), proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(sel, 'value', { get() { return proto.get.call(this); }, set(v) { proto.set.call(this, v); renderPresetPick(); } });
  })();
  function renderPresetPick() {
    const sel = $('preset'), opt = sel.selectedOptions[0];
    $('presetBtn').textContent = opt ? opt.textContent : 'Choisir…';
    if ($('presetList').hidden) return;
    let html = '';
    const item = (o) => {
      const saved = o.value.startsWith('saved:');
      return '<div class="pick-item' + (o.value === sel.value ? ' on' : '') + '" role="option" aria-selected="' + (o.value === sel.value) + '">' +
        (saved ? '<button type="button" class="pick-ico" data-del="' + o.value + '" title="Supprimer « ' + esc(o.textContent) + ' »" aria-label="Supprimer « ' + esc(o.textContent) + ' »">🗑</button>' +
          '<button type="button" class="pick-ico" data-ren="' + o.value + '" title="Renommer « ' + esc(o.textContent) + ' »" aria-label="Renommer « ' + esc(o.textContent) + ' »">✏️</button>' : '') +
        '<button type="button" class="pick-name" data-val="' + esc(o.value) + '">' + esc(o.textContent) + '</button></div>';
    };
    for (const ch of sel.children) {
      if (ch.tagName === 'OPTGROUP') html += '<div class="pick-group">' + esc(ch.label) + '</div>' + [...ch.children].map(item).join('');
      else if (!ch.hidden) html += item(ch);
    }
    $('presetList').innerHTML = html;
  }
  function openPresetPick(open) {
    $('presetList').hidden = !open;
    $('presetBtn').setAttribute('aria-expanded', String(open));
    if (open) {
      renderPresetPick();
      const on = $('presetList').querySelector('.pick-item.on .pick-name') || $('presetList').querySelector('.pick-name');
      if (on) { on.scrollIntoView({ block: 'nearest' }); on.focus(); }
    }
  }
  $('presetBtn').addEventListener('click', () => openPresetPick($('presetList').hidden));
  // (un bouton redessiné pendant le clic n'est plus dans la page : ce n'est pas un clic « en dehors »)
  document.addEventListener('click', (e) => { if (!$('presetList').hidden && e.target.isConnected && !e.target.closest('#presetPick')) openPresetPick(false); });
  $('presetList').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { openPresetPick(false); $('presetBtn').focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const names = [...$('presetList').querySelectorAll('.pick-name')], k = names.indexOf(document.activeElement);
      const n = names[Math.max(0, Math.min(names.length - 1, k + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (n) n.focus(); e.preventDefault();
    }
  });
  $('presetList').addEventListener('click', (e) => {
    const pick = e.target.closest('[data-val]'), del = e.target.closest('[data-del]'), ren = e.target.closest('[data-ren]');
    if (pick) {
      openPresetPick(false);
      $('preset').value = pick.dataset.val;
      $('preset').dispatchEvent(new Event('change'));
      $('presetBtn').focus();
    } else if (del) deleteSavedStrategy(+del.dataset.del.slice(6));
    else if (ren) renameSavedStrategy(+ren.dataset.ren.slice(6));
  });
  function deleteSavedStrategy(i) {
    const list = storage.get(), s = list[i];
    if (!s || !confirm('Supprimer la stratégie « ' + s.name + ' » ? (Ctrl+Z juste après pour annuler)')) return;
    undoable('Suppression de « ' + s.name + ' »', () => {
      const cur = $('preset').value, wasSelected = cur === 'saved:' + i;
      list.splice(i, 1);
      storage.set(list);
      dbPush('strategies/delete', { name: s.name }); cloudPush(() => C.deleteStrategy(s.name));
      logEvent('strategy.deleted', 'Stratégie supprimée : ' + s.name, { strategy: s });
      if (wasSelected) { refreshPresetSelect('preset:' + F.presets.list[0].id); applyPresetSelection(); $('presetDesc').textContent = '« ' + s.name + ' » supprimée.'; }
      else {
        const k = cur.startsWith('saved:') ? +cur.slice(6) : -1;
        refreshPresetSelect(k > i ? 'saved:' + (k - 1) : cur);
      }
    });
    toast('« ' + s.name + ' » supprimée.', true);
    openPresetPick(true);
  }
  function renameSavedStrategy(i) {
    const list = storage.get(), s = list[i];
    if (!s) return;
    const nm = (prompt('Nouveau nom de la stratégie :', s.name) || '').trim().slice(0, 80);
    if (!nm || nm === s.name) return;
    if (list.some((x, k) => k !== i && x.name === nm)) { alert('Une stratégie « ' + nm + ' » existe déjà.'); return; }
    const old = s.name;
    undoable('Renommage de « ' + old + ' »', () => {
      s.name = nm;
      storage.set(list);
      dbPush('strategies/delete', { name: old }); dbPush('strategies/put', { name: nm, data: s, updatedAt: s.savedAt });
      cloudPush(() => C.deleteStrategy(old)); cloudPush(() => C.putStrategy(s));
      // les simulations de cette stratégie suivent le nouveau nom
      const ev = evalList(), moved = [];
      for (const e of ev) if (e.name === old) { e.name = nm; if (e.strategy) e.strategy = Object.assign({}, e.strategy, { name: nm }); moved.push(e); }
      if (moved.length) { evalSave(ev); dbPush('simulations/put', { items: moved }); cloudPush(() => C.putSimulations(moved)); }
      if ($('stratName').value.trim() === old) $('stratName').value = nm;
      logEvent('strategy.renamed', 'Stratégie renommée : ' + old + ' → ' + nm, { from: old, to: nm });
      refreshPresetSelect($('preset').value);
    });
    toast('« ' + old + ' » renommée en « ' + nm + ' ».', true);
    openPresetPick(true);
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
    updateSaveCard();
  }
  /** La carte « Cette stratégie vous plaît ? » suit la stratégie choisie dans la liste ; si ce n'est pas celle des résultats affichés, on le signale. */
  function updateSaveCard() {
    const d = document.getElementById('saveCardDesc');
    try { if (!d || !lastRunCtx) return; } catch (e) { return; } // tout premier chargement : variable pas encore initialisée
    const s = currentStrategy();
    d.innerHTML = esc(s.frenchText || [s.longEntry, s.shortEntry].filter(Boolean).join('  ·  ')).replace(/\n/g, '<br>');
    $('saveCardConfig').textContent = 'Configuration : ' + describeConfig(currentConfig());
    const r = lastRunCtx.strat, same = RULE_FIELDS.every((k) => (r[k] || '') === (s[k] || '')) && r.name === s.name;
    $('saveCardStale').hidden = same;
    $('saveCardStale').innerHTML = same ? '' : '« ' + esc(s.name) + ' » n\'est pas encore simulée : les résultats ci-dessous sont ceux de « ' + esc(r.name) + ' ». <button type="button" class="link" id="saveCardRun">Lancer le backtest</button>';
    const b = document.getElementById('saveCardRun'); if (b) b.addEventListener('click', () => $('form').requestSubmit());
  }
  // ---------- Configuration (paire, levier, capital…) enregistrée avec la stratégie ----------
  function currentConfig() {
    return {
      pair: $('pair').value, leverage: Number($('leverage').value), capital: Number($('capital').value),
      exposurePct: Number($('exposure').value), spreadPips: Number($('spread').value) || 0,
      period: periodValue(), randomSpan: $('randomSpan').value, dateFrom: $('dateFrom').value, dateTo: $('dateTo').value, source: sourceValue(),
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
    if (c.randomSpan !== undefined) {
      if (/^exact:\d+$/.test(c.randomSpan) && ![...$('randomSpan').options].some((o) => o.value === c.randomSpan)) {
        $('randomFixedGroup').insertBefore(new Option(c.randomSpan.slice(6) + ' mois', c.randomSpan), $('randomFixedGroup').querySelector('option[value="exact:x"]'));
      }
      $('randomSpan').value = c.randomSpan;
    }
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

  // ---------- Événements de marché : base intégrée + mouvements détectés automatiquement + les vôtres ----------
  const EV_KEY = 'forexia.events';
  const evEmpty = () => ({ items: [], edits: {}, scanned: {} });
  const evStore = {
    get() { try { return Object.assign(evEmpty(), JSON.parse(localStorage.getItem(EV_KEY)) || {}); } catch (e) { return evMem || evEmpty(); } },
    set(s) { evMem = s; try { localStorage.setItem(EV_KEY, JSON.stringify(s)); } catch (e) { /* ignoré */ } },
  };
  let evMem = null, newEvents = []; // newEvents : détectés lors de la dernière simulation
  function eventsFor(pair, o) { return F.events.list(evStore.get(), pair, o); }
  /** Cherche les mouvements exceptionnels dans les cours chargés et ajoute les nouveaux aux événements. */
  function learnEvents(bars, pair, timeframe) {
    if (!bars || bars.length < 60 || !pair) return [];
    const sec = F.data.TF_SECONDS[timeframe] || 86400;
    const daily = sec < 86400 ? F.data.resample(bars, 'D1') : bars;
    if (daily.length < 60) return [];
    const st = evStore.get(), a = String(daily[0].date).slice(0, 10), b = String(daily[daily.length - 1].date).slice(0, 10), sc = st.scanned[pair];
    if (sc && sc.from <= a && sc.to >= b) return []; // déjà analysés
    const r = F.events.learn(st, daily, pair);
    r.stored.scanned = Object.assign({}, st.scanned, { [pair]: { from: sc && sc.from < a ? sc.from : a, to: sc && sc.to > b ? sc.to : b } });
    evStore.set(r.stored);
    if (r.added.length) logEvent('events.detected', r.added.length + ' mouvement(s) exceptionnel(s) détecté(s) sur ' + pair, { dates: r.added.map((e) => e.date) });
    return r.added;
  }
  const evBadge = (e) => '<span class="ev-badge ' + e.source + '">' + (e.source === 'auto' ? 'détecté' : e.source === 'user' ? 'ajouté par vous' : esc(e.kind || 'événement')) + '</span>';
  function evLine(e, num) {
    return '<li class="ev-item imp' + (e.imp || 1) + '">' + (num ? '<span class="ev-num">' + num + '</span>' : '') + '<span class="ev-date">' + frDate(e.date) + '</span> <b>' + esc(e.title) + '</b> ' + evBadge(e) +
      '<div class="hint">' + esc(e.text || '') + '</div></li>';
  }
  /** Panneau des résultats : événements pendant la période testée. */
  function eventsPanelHtml(pair, from, to) {
    const L = eventsFor(pair, { from: from, to: to }).filter((e) => (e.imp || 1) >= 2 || e.source !== 'base');
    const fresh = newEvents.filter((e) => e.pair === pair);
    return '<details class="panel card ev-panel"' + (fresh.length ? ' open' : '') + '><summary><b>📰 Événements pendant la période</b> <span class="hint">(' + L.length + ' · ' + esc(pair) + ')</span></summary>' +
      (fresh.length ? '<div class="banner info"><b>🆕 ' + fresh.length + ' mouvement' + (fresh.length > 1 ? 's exceptionnels détectés' : ' exceptionnel détecté') + '</b> dans les cours de ' + esc(pair) + ' et ajouté' + (fresh.length > 1 ? 's' : '') +
        ' aux événements (dorénavant affichés sur les graphiques). Vous pouvez leur donner un nom et une explication dans « Tous les événements ».</div>' : '') +
      (L.length ? '<ul class="ev-list">' + L.map((e) => evLine(e)).join('') + '</ul>' : '<p class="hint">Aucun événement marquant connu pendant cette période.</p>') +
      '<div class="row buttons"><button type="button" class="secondary small" data-ev-open="' + esc(pair) + '">Tous les événements…</button></div>' +
      '<p class="hint">Sur le graphique des cours, chaque événement est un losange violet ◆ (survolez-le). Forexia connaît les grands événements depuis 1971 et ajoute tout seul les nouveaux mouvements exceptionnels qu\'il détecte dans les cours.</p></details>';
  }
  // ----- Fenêtre « Événements de marché » -----
  let evOpt = { pair: '', src: '', q: '', edit: '' };
  function openEvents(pair) {
    evOpt = { pair: pair || $('pair').value, src: '', q: '', edit: '' };
    $('evModal').hidden = false; document.body.style.overflow = 'hidden';
    renderEvents();
    loadUpcoming();
  }
  function closeEvents() { $('evModal').hidden = true; if ($('evalModal').hidden && $('eraModal').hidden) document.body.style.overflow = ''; }
  function renderEvents() {
    const st = evStore.get();
    let L = F.events.list(st, evOpt.pair || null);
    if (evOpt.src) L = L.filter((e) => e.source === evOpt.src);
    if (evOpt.q) { const q = evOpt.q.toLowerCase(); L = L.filter((e) => (e.title + ' ' + (e.text || '') + ' ' + e.date).toLowerCase().includes(q)); }
    L = L.slice().reverse();
    const pairs = [...new Set([$('pair').value].concat([...$('pair').options].map((o) => o.value)))];
    const nAuto = st.items.filter((e) => e.source === 'auto' && !e.hidden).length, nUser = st.items.filter((e) => e.source === 'user' && !e.hidden).length;
    let h = '<div class="ev-filters"><label class="field">Paire<select id="evPair"><option value="">Toutes les devises</option>' + pairs.map((p) => '<option' + (p === evOpt.pair ? ' selected' : '') + '>' + esc(p) + '</option>').join('') + '</select></label>' +
      '<label class="field">Origine<select id="evSrc">' + [['', 'Toutes'], ['base', 'Base Forexia (' + F.events.BUILTIN.length + ')'], ['auto', 'Détectés dans les cours (' + nAuto + ')'], ['user', 'Ajoutés par vous (' + nUser + ')']].map(([v, l]) => '<option value="' + v + '"' + (v === evOpt.src ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
      '<label class="field">Recherche<input id="evQ" type="search" value="' + esc(evOpt.q) + '" placeholder="ex. Fed, Brexit, 2015"></label></div>';
    h += '<details class="ev-add"><summary><b>＋ Ajouter un événement</b></summary><div class="ev-form"><label class="field">Date<input id="evNDate" type="date"></label><label class="field">Titre<input id="evNTitle" type="text" maxlength="120" placeholder="ex. Décision surprise de la BCE"></label>' +
      '<label class="field">Devises<input id="evNCur" type="text" value="' + esc((F.events.currencies(evOpt.pair || $('pair').value).slice(0, 2)).join(', ')) + '" placeholder="EUR, USD (vide = toutes)"></label>' +
      '<label class="field">Importance<select id="evNImp"><option value="3">Majeure</option><option value="2" selected>Importante</option><option value="1">Mineure</option></select></label>' +
      '<label class="field ev-wide">Explication<textarea id="evNText" rows="2" placeholder="Ce qui s\'est passé et l\'effet sur les cours"></textarea></label>' +
      '<button type="button" class="primary small" id="evNAdd">Ajouter</button></div></details>';
    h += '<div id="evUpcoming"></div>';
    h += '<p class="hint">' + L.length + ' événement' + (L.length > 1 ? 's' : '') + (evOpt.pair ? ' concernant ' + esc(evOpt.pair) : '') + ', du plus récent au plus ancien. Les mouvements « détectés » sont trouvés automatiquement dans les cours à chaque simulation (variation d\'une bougie au moins 6 fois plus forte que d\'habitude).</p>';
    h += '<ul class="ev-list ev-all">' + L.map((e) => {
      if (evOpt.edit === e.id) return '<li class="ev-item editing"><span class="ev-date">' + frDate(e.date) + '</span><input id="evETitle" type="text" value="' + esc(e.title) + '"><textarea id="evEText" rows="3">' + esc(e.text || '') + '</textarea>' +
        '<div class="row buttons"><button type="button" class="primary small" data-ev-save="' + esc(e.id) + '">Enregistrer</button><button type="button" class="secondary small" data-ev-cancel>Annuler</button></div></li>';
      return '<li class="ev-item imp' + (e.imp || 1) + '"><span class="ev-date">' + frDate(e.date) + '</span> <b>' + esc(e.title) + '</b> ' + evBadge(e) + ' <span class="ev-cur">' + esc((e.cur || []).filter((c) => c !== '*' && !['DEM', 'FRF'].includes(c)).join(' · ') || 'toutes devises') + '</span>' +
        '<span class="ev-acts"><button type="button" class="ghost small" data-ev-edit="' + esc(e.id) + '" title="Modifier le titre et l\'explication">✏️</button><button type="button" class="ghost small" data-ev-del="' + esc(e.id) + '" title="' + (e.source === 'base' ? 'Masquer' : 'Supprimer') + '">🗑</button></span>' +
        '<div class="hint">' + esc(e.text || '') + '</div></li>';
    }).join('') + '</ul>';
    $('evBody').innerHTML = h;
  }
  /** Prochaines annonces importantes du calendrier économique MT5 (si la passerelle est connectée). */
  async function loadUpcoming() {
    const box = $('evUpcoming');
    if (!box) return;
    if (!bridgeToken) { box.innerHTML = '<p class="hint">📅 Prochaines annonces : connectez la passerelle MT5 pour afficher les annonces économiques importantes à venir (calendrier de MetaTrader 5).</p>'; return; }
    const now = Math.floor(Date.now() / 1000), ev = await loadCalendar(now, now + 14 * 86400);
    if (!$('evUpcoming')) return;
    if (!ev) { $('evUpcoming').innerHTML = '<p class="hint">📅 Calendrier MT5 indisponible : exportez-le (section « Éviter les annonces économiques »).</p>'; return; }
    const cs = evOpt.pair ? F.events.currencies(evOpt.pair) : null;
    const up = ev.filter((e) => e.importance >= 3 && (!cs || cs.includes(e.currency))).slice(0, 40);
    $('evUpcoming').innerHTML = '<details class="ev-add" open><summary><b>📅 Prochaines annonces importantes (14 jours, MT5)</b> (' + up.length + ')</summary>' +
      (up.length ? '<ul class="ev-list">' + up.map((e) => '<li class="ev-item"><span class="ev-date">' + new Date(e.t * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) + '</span> <b>' + esc(e.currency) + '</b> · annonce à fort impact</li>').join('') + '</ul>' : '<p class="hint">Aucune annonce à fort impact dans les 14 jours.</p>') + '</details>';
  }
  $('evModal').addEventListener('click', (ev) => {
    const t = ev.target;
    if (t.closest('[data-close]')) return closeEvents();
    const st = evStore.get();
    const ed = t.closest('[data-ev-edit]'); if (ed) { evOpt.edit = ed.dataset.evEdit; return renderEvents(); }
    if (t.closest('[data-ev-cancel]')) { evOpt.edit = ''; return renderEvents(); }
    const sv = t.closest('[data-ev-save]');
    if (sv) {
      const id = sv.dataset.evSave, title = $('evETitle').value.trim().slice(0, 140), text = $('evEText').value.trim().slice(0, 1000);
      if (!title) return;
      const it = st.items.find((e) => e.id === id);
      if (it) { it.title = title; it.text = text; if (it.source === 'auto') it.named = true; } else st.edits[id] = Object.assign({}, st.edits[id], { title: title, text: text });
      evStore.set(st); evOpt.edit = ''; return renderEvents();
    }
    const dl = t.closest('[data-ev-del]');
    if (dl) {
      const id = dl.dataset.evDel, it = st.items.find((e) => e.id === id);
      // un mouvement détecté supprimé reste masqué (pour ne pas être redétecté) ; un événement de la base est masqué
      if (it) { if (it.source === 'auto') it.hidden = true; else st.items = st.items.filter((e) => e.id !== id); } else st.edits[id] = Object.assign({}, st.edits[id], { hidden: true });
      evStore.set(st); return renderEvents();
    }
    if (t.id === 'evNAdd') {
      const date = $('evNDate').value, title = $('evNTitle').value.trim().slice(0, 140);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) return toast('Indiquez une date et un titre.', false);
      const cur = ($('evNCur').value.toUpperCase().match(/[A-Z]{3}/g) || ['*']);
      st.items.push({ id: 'u' + Date.now().toString(36), source: 'user', date: date, title: title, text: $('evNText').value.trim().slice(0, 1000), cur: cur, imp: +$('evNImp').value, kind: 'Ajouté' });
      evStore.set(st); logEvent('events.added', 'Événement ajouté : ' + date + ' ' + title);
      toast('Événement ajouté : il apparaîtra sur les graphiques.', false);
      return renderEvents();
    }
  });
  $('evModal').addEventListener('change', (ev) => {
    if (ev.target.id === 'evPair') { evOpt.pair = ev.target.value; renderEvents(); loadUpcoming(); }
    if (ev.target.id === 'evSrc') { evOpt.src = ev.target.value; renderEvents(); loadUpcoming(); }
  });
  $('evModal').addEventListener('input', (ev) => {
    if (ev.target.id === 'evQ') { evOpt.q = ev.target.value; const pos = ev.target.selectionStart; renderEvents(); loadUpcoming(); const q = $('evQ'); q.focus(); q.setSelectionRange(pos, pos); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('evModal').hidden) closeEvents(); });
  document.addEventListener('click', (ev) => { const b = ev.target.closest('[data-ev-open]'); if (b) openEvents(b.dataset.evOpen); });

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
  // Stratégie choisie dans la liste : sa dernière simulation (même période, capital, levier, source…) s'affiche tout de suite.
  $('preset').addEventListener('change', () => {
    const v = $('preset').value;
    if (!v.startsWith('saved:') && !v.startsWith('preset:')) return;
    showLastSimulation(false);
  });
  /** Affiche la dernière simulation de la stratégie du formulaire (atStart : à l'ouverture de la page, sans message d'erreur). */
  function showLastSimulation(atStart) {
    const name = currentStrategy().name;
    const last = evalList().filter((e) => e.name === name && e.config).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    if (!last) return;
    const c = last.config, okD = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
    const from = okD(c.dateFrom) ? c.dateFrom : last.from, to = okD(c.dateTo) ? c.dateTo : last.to;
    restoring = true; // pas d'étape d'annulation séparée : fait partie du choix de la stratégie
    try {
      applyConfig(Object.assign({}, c, { period: 'custom', dateFrom: from, dateTo: to }));
      document.querySelector('input[name=period][value=custom]').checked = true;
      syncPeriodUI(); $('dateFrom').value = from; $('dateTo').value = to;
    } finally { restoring = false; }
    if (atStart && c.source === 'broker' && !bridgeToken) return;
    runFromForm({ noRecord: true }).then((ok) => { // déjà dans le tableau d'évaluation
      if (!ok && atStart) { $('formError').textContent = ''; return; }
      $('presetDesc').textContent = (ok ? 'Dernière simulation affichée : ' : 'Dernière simulation : ') + frDate(from) + ' → ' + frDate(to) + ' · ' + esc(c.pair || '') +
        ' · capital ' + money.format(c.capital || 0) + ' · levier 1:' + (c.leverage || '?') + ' · lancée le ' + new Date(last.at).toLocaleDateString('fr-FR') + ' (' + signed(last.returnPct, num1) + ' %).';
    }).finally(() => { syncFormState(); });
  }

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
  document.querySelectorAll('input[name=period]').forEach((r) => r.addEventListener('change', () => {
    if (periodValue() === 'random') { pickRandomPeriod(); return; }
    $('randomPeriodNote').hidden = true;
    syncPeriodUI();
  }));
  // Période aléatoire : une durée (1 mois à 2 ans) et une date de début tirées au hasard dans l'historique disponible,
  // en gardant assez de données avant le début pour amorcer les indicateurs.
  const RANDOM_DURATIONS = [[1, '1 mois'], [2, '2 mois'], [3, '3 mois'], [4, '4 mois'], [6, '6 mois'], [9, '9 mois'], [12, '1 an'], [18, '18 mois'],
    [24, '2 ans'], [36, '3 ans'], [48, '4 ans'], [60, '5 ans']];
  // « Au moins N mois » : de N mois à 5 ans ; « au plus N mois » : de 1 mois à N mois ; sinon 1 mois à 2 ans.
  function randomDurations() {
    const [kind, v] = ($('randomSpan').value || ':').split(':');
    const n = Number(v);
    if (kind === 'exact' && n > 0) {
      const known = RANDOM_DURATIONS.find(([m]) => m === n);
      return [known || [n, n % 12 === 0 ? n / 12 + ' an' + (n > 12 ? 's' : '') : n + ' mois']];
    }
    if (kind === 'min') return RANDOM_DURATIONS.filter(([m]) => m >= n);
    if (kind === 'max') return RANDOM_DURATIONS.filter(([m]) => m <= n);
    return RANDOM_DURATIONS.filter(([m]) => m <= 24);
  }
  function pickRandomPeriod() {
    const day = 86400000, today = new Date(todayIso() + 'T00:00:00Z');
    const src = sourceValue();
    let min = new Date(src === 'broker' ? '2015-01-01T00:00:00Z' : src === 'synthetic' ? '2005-01-01T00:00:00Z' : '2001-01-01T00:00:00Z'), max = today;
    if (src === 'csv' && csvBars && csvBars.length) {
      min = F.data.addMonths(new Date(csvBars[0].date.slice(0, 10) + 'T00:00:00Z'), 12);
      max = new Date(csvBars[csvBars.length - 1].date.slice(0, 10) + 'T00:00:00Z');
    }
    // années choisies (« Années de la période aléatoire ») : limitent le tirage
    const yf = Math.round(Number($('randomYFrom').value)) || 0, yt = Math.round(Number($('randomYTo').value)) || 0;
    const floor = src === 'synthetic' ? Date.UTC(1996, 0, 1) : src === 'ecb' ? Date.UTC(2000, 0, 1) : src === 'csv' ? min.getTime() : Date.UTC(1971, 0, 1);
    let yearsNote = '';
    if (yf || yt) {
      const nmin = new Date(Math.max(floor, yf ? Date.UTC(yf, 0, 1) : min.getTime())), nmax = new Date(Math.min(max.getTime(), yt ? Date.UTC(yt, 11, 31) : max.getTime()));
      if (nmax - nmin >= 32 * day) { min = nmin; max = nmax; yearsNote = ' entre ' + min.getUTCFullYear() + ' et ' + max.getUTCFullYear(); }
      else yearsNote = ' (années choisies hors de l\'historique disponible : ignorées)';
    }
    const pool = randomDurations();
    let choices = pool.filter(([m]) => F.data.addMonths(min, m) <= max);
    let short = false;
    if (!choices.length) { choices = [pool[0]]; short = true; }
    const [months, label] = choices[Math.floor(Math.random() * choices.length)];
    const latestStart = new Date(Math.min(F.data.addMonths(max, -months).getTime(), max.getTime() - 32 * day));
    const span = Math.max(0, latestStart - min);
    const start = new Date(min.getTime() + Math.floor((Math.random() * span) / day) * day);
    // au moins 31 jours (un « mois » de février en fait 28, sous le minimum de 30 jours)
    let end = new Date(Math.max(F.data.addMonths(start, months).getTime() - day, start.getTime() + 31 * day));
    if (end > max) end = max;
    document.querySelector('input[name=period][value=custom]').checked = true;
    syncPeriodUI();
    setDates(start, end);
    $('randomPeriodNote').hidden = false;
    $('randomPeriodNote').textContent = '🎲 Période tirée au hasard' + yearsNote + ' : ' + label + ', du ' + frDate(F.data.iso(start)) + ' au ' + frDate(F.data.iso(end)) +
      (/^exact:/.test($('randomSpan').value) ? ' (durée fixe)' : $('randomSpan').value ? ' (' + $('randomSpan').selectedOptions[0].textContent.toLowerCase() + ')' : '') +
      (short ? ', historique trop court pour cette durée : période raccourcie' : '') +
      '. Cliquez de nouveau sur « Période aléatoire » pour en tirer une autre.';
  }
  // changer la contrainte de durée retire tout de suite une nouvelle période
  let lastSpan = $('randomSpan').value;
  $('randomSpan').addEventListener('change', () => {
    // « x mois… » : durée fixe saisie, ajoutée à la liste
    if ($('randomSpan').value === 'exact:x') {
      const x = Math.round(Number(prompt('Durée fixe de la période aléatoire, en mois (1 à 120) :', '9')));
      if (!(x >= 1 && x <= 120)) { $('randomSpan').value = lastSpan; return; }
      if (![...$('randomSpan').options].some((o) => o.value === 'exact:' + x)) {
        const o = new Option(x + ' mois', 'exact:' + x);
        $('randomFixedGroup').insertBefore(o, $('randomFixedGroup').querySelector('option[value="exact:x"]'));
      }
      $('randomSpan').value = 'exact:' + x;
    }
    lastSpan = $('randomSpan').value;
    if (!$('randomPeriodNote').hidden) pickRandomPeriod();
  });

  // Lot de tests aléatoires : N backtests sur N périodes tirées au hasard, tous enregistrés dans « Évaluation ».
  let batchRunning = false, batchStop = false;
  $('batchRun').addEventListener('click', async () => {
    if (batchRunning) { batchStop = true; $('batchRun').textContent = 'Arrêt…'; return; }
    const n = Math.max(1, Math.min(100, Math.round(Number($('batchCount').value) || 10)));
    $('batchCount').value = n;
    batchRunning = true; batchStop = false;
    $('batchRun').textContent = 'Arrêter';
    const res = [], lot = startLotBatch(n);
    let fails = 0;
    let attempts = 0;
    for (let k = 0; k < n && !batchStop && attempts++ < n * 3; k++) {
      $('batchStatus').textContent = 'Test ' + (k + 1) + ' sur ' + n + '…';
      setRunLabel('Test ' + (k + 1) + ' / ' + n);
      pickRandomPeriod();
      const before = evalList().length;
      const ok = await runFromForm();
      if (ok && lastRun && evalList().length > before) { res.push(lastRun.stats.returnPct); addToLotBatch(lot, evalList()[evalList().length - 1]); }
      else if (ok) k--; // même simulation que la précédente (période identique) : on en tire une autre
      else if (++fails >= Math.max(3, Math.ceil(n / 3))) { $('batchStatus').textContent = 'Lot interrompu : ' + $('formError').textContent; break; }
      else { console.warn('Test du lot ignoré :', $('formError').textContent); k--; } // période inutilisable : on en tire une autre
      await new Promise((r) => setTimeout(r, 30)); // laisse la page se redessiner
    }
    batchRunning = false;
    setRunLabel('');
    $('batchRun').textContent = 'Lancer le lot';
    if (!res.length) dropLotBatch(lot);
    if (res.length) {
      const pos = res.filter((v) => v > 0).length, avg = res.reduce((a, b) => a + b, 0) / res.length;
      $('batchStatus').innerHTML = '<b>' + res.length + ' test' + (res.length > 1 ? 's' : '') + ' enregistré' + (res.length > 1 ? 's' : '') + '</b> dans « Évaluation » : ' +
        pos + ' gagnant' + (pos > 1 ? 's' : '') + ' sur ' + res.length + ', résultat moyen <span class="' + cls(avg) + '">' + signed(avg, num1) + ' %</span> (de ' + signed(Math.min(...res), num1) + ' à ' + signed(Math.max(...res), num1) + ' %). ' +
        '<br>Nouveau batch : <b id="lotName">« ' + esc(lot.name) + ' »</b> · <button type="button" class="link" id="batchOpenLot">Voir le batch</button> · ' +
        '<button type="button" class="link" id="batchOpenEval">Recommandations</button> · <button type="button" class="link" id="batchRenLot">Renommer</button>';
      $('batchOpenLot').addEventListener('click', () => openEvaluation('charts'));
      $('batchOpenEval').addEventListener('click', () => openEvaluation('reco'));
      $('batchRenLot').addEventListener('click', () => {
        const list = batchStore.get(), b = list.find((x) => x.id === lot.id);
        if (!b) return;
        const nm = (prompt('Nom du batch :', b.name) || '').trim().slice(0, 100);
        if (nm) { b.name = nm; lot.name = nm; batchStore.set(list); $('lotName').textContent = '« ' + nm + ' »'; }
      });
      logEvent('simulation.batch', 'Lot de ' + res.length + ' tests aléatoires : ' + pos + ' gagnants, moyenne ' + signed(avg, num1) + ' %', { results: res });
    }
  });
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
  async function loadBrokerBars(range, opt) {
    if (!bridgeToken) throw new Error('Connectez la passerelle MT5 (section Données) pour utiliser les données de votre courtier.');
    const tf = $('brokerTf').value, symbol = ((opt && opt.symbol) || $('brokerSymbol').value).trim(), code = ((opt && opt.pair) || $('pair').value).replace('/', '');
    if (symbol.toUpperCase().indexOf(code) !== 0) {
      throw new Error('Le symbole MT5 « ' + symbol + ' » ne correspond pas à la paire ' + ((opt && opt.pair) || $('pair').value) + ' : corrigez « Symbole dans MT5 » (section Données).');
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
  $('form').addEventListener('submit', (e) => { e.preventDefault(); if (!batchRunning) runFromForm(); });
  // Compteur affiché dans le bouton pendant un lot ou une vérification (« Test 3 / 10 »)
  let runLabel = '';
  let runBarSpot = null;
  function setRunLabel(t) {
    runLabel = t;
    // bouton « Arrêter » visible pendant un lot, une prolongation, un découpage ou un changement de capital
    $('runStop').hidden = !t || t === 'Analyse';
    // pendant un calcul, les boutons passent devant les fenêtres (en bas à droite de l'écran) :
    // la barre est déplacée au niveau de la page (sinon elle reste sous les fenêtres), puis remise à sa place
    const bar = document.querySelector('.run-bar');
    if (t && !runBarSpot) { runBarSpot = document.createComment('run-bar'); bar.parentNode.insertBefore(runBarSpot, bar); document.body.appendChild(bar); }
    if (!t && runBarSpot) { runBarSpot.parentNode.insertBefore(bar, runBarSpot); runBarSpot.remove(); runBarSpot = null; }
    bar.classList.toggle('running', !!t);
    if (!t) { $('runBtn').disabled = false; $('runBtn').textContent = 'Lancer le backtest'; $('runStop').disabled = false; $('runStop').textContent = '■ Arrêter'; }
  }
  $('runStop').addEventListener('click', () => {
    batchStop = true; checkStop = true;
    $('runStop').disabled = true; $('runStop').textContent = 'Arrêt…';
    if (batchRunning) $('batchRun').textContent = 'Arrêt…';
  });
  /** Lance le backtest du formulaire. Renvoie true si la simulation a abouti. */
  async function runFromForm(opts) {
    // « ne pas enregistrer » est décidé au lancement, pour ce calcul-là (une autre simulation en parallèle ne le change pas)
    const noRecord = !!((opts && opts.noRecord) || evalNoRecord);
    $('formError').textContent = '';
    if (frenchDirty && $('frenchText').value.trim()) {
      const r = translateFrench();
      if (!r.longEntry && !r.shortEntry) { $('formError').textContent = 'Je n\'ai pas compris votre stratégie en français : voir les remarques sous le texte.'; return false; }
    }
    const strat = currentStrategy();
    if (!validateAll()) { $('rulesDetails').open = true; $('formError').textContent = 'Corrigez les règles en rouge.'; return false; }
    if (!strat.longEntry && !strat.shortEntry) { $('formError').textContent = 'Indiquez au moins une règle d\'entrée (achat ou vente).'; return false; }
    const capital = Number($('capital').value), exposure = Number($('exposure').value), spread = Number($('spread').value) || 0;
    if (!(capital >= 100)) { $('formError').textContent = 'Le capital doit être d\'au moins 100.'; return false; }
    if (!(exposure > 0 && exposure <= 100)) { $('formError').textContent = 'L\'exposition doit être comprise entre 1 et 100 %.'; return false; }

    const pair = $('pair').value, periodKey = periodValue(), leverage = Number($('leverage').value);
    const btn = $('runBtn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>' + (runLabel ? esc(runLabel) + ' · calcul en cours…' : 'Calcul en cours…');
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
      lastRunCtx = { bars, strat, settings, config, timeframe: loaded.timeframe || 'D1', lastTrades: result.trades, diag: result.diag, result };
      // nouveaux mouvements exceptionnels dans les cours réels : ajoutés aux événements
      newEvents = [];
      if (sourceValue() !== 'synthetic') { try { newEvents = learnEvents(bars, settings.pair, loaded.timeframe || 'D1'); } catch (e) { console.warn('Détection des événements :', e); } }
      lastRun = { key: runKey(strat, config), stats: result.stats };
      render({ bars, strat, settings, result, loaded, periodKey, warnings, config });
      syncFormState();
      if (!noRecord || evalReplaceKey) recordEvaluation({ bars, strat, settings, result, loaded, periodKey, config }, noRecord);
      // Filet de sécurité : la dernière stratégie simulée est gardée, même non enregistrée.
      const lastRunRec = { at: new Date().toISOString(), strategy: strat, config: config };
      try { localStorage.setItem('forexia.lastRun', JSON.stringify(lastRunRec)); } catch (e) { /* ignoré */ }
      cloudPush(async () => { const st = await C.getSettings(); await C.putSettings(Object.assign({}, st, { lastRun: lastRunRec })); }); // garde les autres données du compte
      refreshPresetSelect($('preset').value);
      return true;
    } catch (err) {
      $('formError').textContent = err.message;
      return false;
    } finally {
      btn.disabled = false;
      if (runLabel) btn.innerHTML = '<span class="spinner"></span>' + esc(runLabel); else btn.textContent = 'Lancer le backtest';
    }
  }

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
    html += '<div class="panel card save-card"><div><b>Cette stratégie vous plaît ?</b> <span class="hint">Sinon, « Améliorer » propose des réglages testés.</span><div class="hint" id="saveCardDesc">' + esc(strat.frenchText || strat.longEntry || strat.shortEntry).replace(/\n/g, '<br>') + '</div>' +
      '<div class="hint save-config" id="saveCardConfig">Configuration enregistrée avec : ' + esc(describeConfig(config)) + '</div><div class="stale-note" id="saveCardStale" hidden></div>' +
      '</div><div class="save-actions">' +
      '<button type="button" class="enhance" id="enhanceBtn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>Améliorer</button>' +
      '<button type="button" class="analyze" id="anaBtn"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>Analyseur</button>' +
      '<button type="button" class="deploy" id="deployBtn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>Déployer</button>' +
      '<button type="button" class="primary inline-save" id="saveFromResults">Enregistrer</button>' +
      '<button type="button" class="secondary small edit-conds" id="editConds">✎ Modifier les conditions</button></div></div>' +
      '<div class="panel card cond-panel" id="condPanel" hidden></div>';
    html += '<div class="summary-head"><h2>' + esc(strat.name) + ' · ' + esc(settings.pair) + '</h2>' +
      '<span class="meta">' + PERIOD_LABEL[periodKey] + ' · du ' + frDate(dates[0]) + ' au ' + frDate(dates[dates.length - 1]) +
      ' · levier 1:' + settings.leverage + ' · ' + esc(loaded.source) + ' · ' + view.length + ' bougies</span></div>';
    html += eventsPanelHtml(settings.pair, String(dates[0]).slice(0, 10), String(dates[dates.length - 1]).slice(0, 10));

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
    // événements de marché : losange violet en haut du graphique, trait vertical, détail au survol
    if (chartState.events !== false) {
      for (const ev of eventsFor(settings.pair)) {
        if ((ev.imp || 1) < 2 && ev.source === 'base') continue;
        const t = Date.parse(ev.date + 'T00:00:00Z') / 1000;
        if (!inView(t)) continue;
        const i = idxOf(t);
        if (i < 0) continue;
        markers.push({ i: i, value: closes[i], shape: 'event', title: frDate(ev.date) + ' · ' + ev.title + (ev.text ? ' — ' + ev.text : '') });
        tipAt.set(i, (tipAt.has(i) ? tipAt.get(i) + '<br>' : '') + '<b style="color:var(--event)">◆ ' + esc(ev.title) + '</b>');
      }
    }
    const drawSeries = drawingsFor(settings.pair).map((d, k) => ({
      name: drawingName(d, k), values: visT.map((t) => drawingValue(d, t)), color: DRAW_COLORS[k % DRAW_COLORS.length],
      dash: d.type === 'h' ? '6 4' : '', noScale: true, label: String(k + 1), width: 2.2,
    }));
    // repères utilisés par les règles de la stratégie (lignes de tendance LINE(...) et niveaux de prix), en violet : R1, R2…
    const ruleSeries = ruleMarks(currentStrategy(), pMin, pMax).map((m, k) => ({
      name: 'R' + (k + 1) + ' · ' + m.label, values: visT.map((t) => (m.type === 'line' ? (t >= m.t1 ? m.v1 + ((m.v2 - m.v1) * (t - m.t1)) / (m.t2 - m.t1) : NaN) : m.v)),
      color: '#9333ea', dash: m.type === 'line' ? '7 3' : '3 3', noScale: true, label: 'R' + (k + 1), width: 2,
    }));
    const panels = [{ height: 300, format: pfmt, series: [{ name: settings.pair + ' ' + got.tf, values: closes, color: 'var(--price)', width: 1.5 }].concat(overlays, drawSeries, ruleSeries), markers: markers }];
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
      ruleSeries.map((o) => '<span title="Repère utilisé par les règles de la stratégie"><i style="background:#9333ea"></i>' + esc(o.name) + '</span>').join('') +
      '<span><i class="tri-up"></i>Achat</span><span><i class="tri-dn"></i>Vente</span><span><i class="dot" style="background:var(--muted)"></i>Sortie</span>' +
      '<button type="button" class="chip ev-toggle" id="evToggle" aria-pressed="' + (chartState.events !== false) + '" title="Afficher ou masquer les événements de marché">◆ Événements</button>';
    $('evToggle').addEventListener('click', () => { chartState.events = chartState.events === false; drawPrice(); });
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
    $('anaBtn').addEventListener('click', () => openAnalyzer());
    $('deployBtn').addEventListener('click', openDeploy);
    $('editConds').addEventListener('click', () => { $('condPanel').hidden = !$('condPanel').hidden; if (!$('condPanel').hidden) { renderCondPanel(); $('condPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } });
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

  // ---------- Conditions des règles : afficher, retirer une condition, voir les repères sur le graphique ----------
  const RULE_LABEL = { longEntry: 'Entrée achat', longExit: 'Sortie achat', shortEntry: 'Entrée vente', shortExit: 'Sortie vente' };
  // règle -> groupes OU de conditions ET
  function ruleGroups(rule) {
    if (!rule || !rule.trim()) return [];
    const R = F.rules, split = (n, op) => (n.k === 'bin' && n.op === op ? split(n.a, op).concat(split(n.b, op)) : [n]);
    return split(R.parse(rule), 'OR').map((g) => split(g, 'AND').map((n) => R.stringify(n)));
  }
  function groupsRule(groups) {
    const gs = groups.filter((g) => g.length);
    const wrap = (c) => (/\b(OR|AND)\b/.test(F.rules.canonical(c)) && !/^\(.*\)$/.test(c) ? '(' + c + ')' : c);
    return gs.map((g) => (g.length > 1 && gs.length > 1 ? '(' + g.map(wrap).join(' AND ') + ')' : g.map(wrap).join(' AND '))).join(' OR ');
  }
  function lineInfo(txt) {
    const m = /LINE\(\s*(\d+)\s*,\s*(-?[\d.]+)\s*,\s*(\d+)\s*,\s*(-?[\d.]+)\s*\)/.exec(txt);
    return m ? { type: 'line', t1: +m[1], v1: +m[2], t2: +m[3], v2: +m[4] } : null;
  }
  const dayFr = (t) => frDate(new Date(t * 1000).toISOString().slice(0, 10));
  function condLabel(c) {
    const L = lineInfo(c), pf = (v) => (chartView ? chartView.pfmt(v) : String(v));
    if (L) return c.replace(/LINE\([^)]*\)/g, 'ligne de tendance (' + dayFr(L.t1) + ' ' + pf(L.v1) + ' → ' + dayFr(L.t2) + ' ' + pf(L.v2) + ')');
    return c;
  }
  /** Repères des règles : lignes LINE(...) et niveaux de prix comparés à CLOSE / HIGH / LOW. */
  function ruleMarks(strat, pMin, pMax) {
    const out = [], seen = new Set();
    for (const k of RULE_FIELDS) {
      const txt = strat[k] || '';
      for (const m of txt.matchAll(/LINE\([^)]*\)/g)) {
        const L = lineInfo(m[0]);
        if (L && !seen.has(m[0])) { seen.add(m[0]); out.push(Object.assign(L, { label: 'ligne ' + dayFr(L.t1) + ' → ' + dayFr(L.t2) })); }
      }
      for (const m of txt.matchAll(/\b(?:CLOSE|HIGH|LOW|OPEN)\s*(?:[<>]=?|==)\s*(\d+\.\d+)|CROSS_(?:UP|DOWN)\(\s*CLOSE\s*,\s*(\d+\.\d+)\s*\)/g)) {
        const v = +(m[1] || m[2]);
        if (v > pMin * 0.8 && v < pMax * 1.2 && !seen.has('h' + v)) { seen.add('h' + v); out.push({ type: 'h', v: v, label: 'niveau ' + (chartView ? chartView.pfmt(v) : v) }); }
      }
    }
    return out;
  }
  // Arbre d'une règle : {op: 'AND' | 'OR', items: [...]} ou une condition (texte) ; chaque condition, à toute profondeur, peut être retirée.
  function condTree(rule) {
    const R = F.rules, split = (n, op) => (n.k === 'bin' && n.op === op ? split(n.a, op).concat(split(n.b, op)) : [n]);
    const build = (n) => (n.k === 'bin' && (n.op === 'AND' || n.op === 'OR') ? { op: n.op, items: split(n, n.op).map(build) } : R.stringify(n));
    return rule && rule.trim() ? build(R.parse(rule)) : null;
  }
  function treeStr(t, parentOp) {
    if (typeof t === 'string') return t;
    const sstr = t.items.map((x) => treeStr(x, t.op)).join(' ' + t.op + ' ');
    return parentOp ? '(' + sstr + ')' : sstr;
  }
  // retire les conditions pour lesquelles drop(texte) est vrai ; simplifie les groupes vides ou à un seul élément
  function treeDrop(t, drop) {
    if (t === null) return null;
    if (typeof t === 'string') return drop(t) ? null : t;
    // un sous-groupe devenu du même type que son parent (ex. ET dans ET) est fusionné : pas de parenthèses inutiles
    const items = t.items.map((x) => treeDrop(x, drop)).filter((x) => x !== null).flatMap((x) => (typeof x !== 'string' && x.op === t.op ? x.items : [x]));
    return !items.length ? null : items.length === 1 ? items[0] : { op: t.op, items: items };
  }
  function treeAt(t, path) { return path.reduce((n, i) => n.items[i], t); }
  function renderCondPanel() {
    const box = $('condPanel'), st = currentStrategy();
    let html = '<div class="cond-head"><h3>Conditions de la stratégie</h3><span class="hint">Cliquez sur × pour retirer une condition. Les lignes et niveaux des règles sont tracés en violet (R1, R2…) sur le graphique des cours.</span></div>';
    // lignes de tendance utilisées : bouton pour retirer d'un coup toutes les conditions qui s'en servent
    const marks = ruleMarks(st, -Infinity, Infinity).filter((m) => m.type === 'line');
    if (marks.length) {
      html += '<div class="cond-lines">' + marks.map((m, k) => {
        const txt = 'LINE(' + m.t1 + ',', n = RULE_FIELDS.reduce((a, f) => a + ((st[f] || '').split(txt).length - 1), 0);
        return '<button type="button" class="secondary small" data-dropline="' + m.t1 + '|' + m.t2 + '">🗑 Retirer la ligne R' + (k + 1) + ' (' + dayFr(m.t1) + ' → ' + dayFr(m.t2) + ', ' + n + ' condition' + (n > 1 ? 's' : '') + ')</button>';
      }).join('') + '</div>';
    }
    const chip = (c, k, path) => '<span class="cond-chip' + (lineInfo(c) ? ' line' : '') + '" title="' + esc(c) + '">' + esc(condLabel(c)) +
      '<button type="button" data-cond="' + k + ':' + path.join('.') + '" aria-label="Retirer cette condition">×</button></span>';
    const node = (t, k, path, top) => {
      if (typeof t === 'string') return chip(t, k, path);
      const sep = '<span class="cond-' + (t.op === 'OR' ? 'or">OU' : 'and">ET') + '</span>';
      const inner = t.items.map((x, i) => (i ? sep : '') + node(x, k, path.concat(i), false)).join('');
      return top ? inner : '<span class="cond-group">' + inner + '</span>';
    };
    let any = false;
    for (const k of RULE_FIELDS) {
      let t;
      try { t = condTree(st[k]); } catch (e) { t = null; }
      if (!t) continue;
      any = true;
      html += '<div class="cond-rule"><b>' + RULE_LABEL[k] + '</b><div class="cond-body">' + node(t, k, [], true) + '</div></div>';
    }
    if (!any) html += '<p class="hint">Aucune condition.</p>';
    html += '<div class="row buttons cond-actions"><button type="button" class="primary small" id="condRun">▶ Relancer le backtest</button>' +
      '<button type="button" class="secondary small" id="condDraw">╱ Dessiner un nouveau repère</button></div>';
    box.innerHTML = html;
  }
  /** Applique un retrait de conditions aux 4 règles (drop(k, texte) -> vrai pour retirer). */
  function dropConditions(label, drop) {
    const st = currentStrategy(), next = {};
    for (const k of RULE_FIELDS) { const t = condTree(st[k]); next[k] = t ? treeStr(treeDrop(t, (c) => drop(k, c)) || '') : ''; if (next[k] === '') next[k] = ''; }
    if (!next.longEntry && !next.shortEntry) { toast('Il faut au moins une règle d\'entrée : condition non retirée.'); return; }
    undoable(label, () => {
      for (const k of RULE_FIELDS) $(k).value = next[k];
      $('frenchText').value = F.french.toFrench(currentStrategy()) || ''; // texte français impossible avec des repères LINE : on l'efface plutôt que de le laisser faux
      $('plots').value = F.french.derivePlots(currentStrategy()) || $('plots').value;
      markCustom();
      validateAll();
      $('presetDesc').textContent = label + '. Relancez le backtest pour voir l\'effet.';
    });
    renderCondPanel();
    drawPrice();
  }
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('#condPanel [data-cond]');
    if (b) {
      const [k, ps] = b.dataset.cond.split(':'), path = ps ? ps.split('.').map(Number) : [];
      const t = condTree($(k).value), target = treeAt(t, path);
      let done = false; // retire uniquement cette occurrence
      return dropConditions('Condition retirée (' + RULE_LABEL[k].toLowerCase() + ') : ' + condLabel(target), (kk, c) => { if (kk === k && !done && c === target) { done = true; return true; } return false; });
    }
    const dl = ev.target.closest('#condPanel [data-dropline]');
    if (dl) {
      const [t1, t2] = dl.dataset.dropline.split('|');
      const re = new RegExp('LINE\\(\\s*' + t1 + '\\s*,[^)]*,\\s*' + t2 + '\\s*,');
      return dropConditions('Ligne de tendance retirée de la stratégie', (k, c) => re.test(c));
    }
    if (ev.target.id === 'condRun') { $('form').requestSubmit(); return; }
    if (ev.target.id === 'condDraw') { $('drawLine').scrollIntoView({ behavior: 'smooth', block: 'center' }); setDrawMode('line'); }
  });
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

  // ---------- Fenêtre « Analyseur » ----------
  let ana = null; // { report, tested: [{p, stats}], best }
  let anaCtx = null, anaOrigin = null; // simulation analysée ; anaOrigin = { e } si elle vient d'une barre de l'évaluation
  function anaCurve(res, drop) {
    const w = (res.wealth || res.equity).filter(Number.isFinite);
    if (w.length < 2) return '';
    const W = 640, H = 120, min = Math.min(...w), max = Math.max(...w), rg = max - min || 1;
    const x = (j) => (j / (w.length - 1)) * W, y = (v) => H - 4 - ((v - min) / rg) * (H - 8);
    const path = w.map((v, j) => (j ? 'L' : 'M') + x(j).toFixed(1) + ' ' + y(v).toFixed(1)).join('');
    const shade = drop ? '<rect class="ana-dd" x="' + x(drop.fromJ).toFixed(1) + '" y="0" width="' + Math.max(2, x(drop.toJ) - x(drop.fromJ)).toFixed(1) + '" height="' + H + '"/>' : '';
    const base = res.stats.initialCapital, yb = y(base);
    return '<svg class="ana-curve" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Évolution du compte, la plus forte baisse en rouge">' + shade +
      (yb >= 0 && yb <= H ? '<line class="ana-base" x1="0" x2="' + W + '" y1="' + yb.toFixed(1) + '" y2="' + yb.toFixed(1) + '"/>' : '') + '<path d="' + path + '"/></svg>';
  }
  function anaGroupTable(title, rows) {
    if (!rows || !rows.length) return '';
    return '<table class="ana-table"><thead><tr><th>' + title + '</th><th>Trades</th><th>Gagnants</th><th>Résultat</th></tr></thead><tbody>' +
      rows.map((r) => '<tr><td>' + esc(r.label) + '</td><td>' + r.n + '</td><td>' + Math.round(r.winRate) + ' %</td><td class="' + cls(r.pnl) + '">' + signed(r.pnl, num1) + '</td></tr>').join('') + '</tbody></table>';
  }
  function showAnaModal() {
    const m = $('anaModal');
    m.hidden = false; document.body.style.overflow = 'hidden';
    $('anaApplyBest').disabled = true; $('anaApplyBestAll').disabled = true; $('anaBest').innerHTML = '';
    $('anaApplyBestAll').hidden = !anaOrigin;
    $('anaApplyBest').textContent = anaOrigin ? 'Appliquer à cette simulation' : 'Appliquer la meilleure combinaison';
    m.querySelector('.close').focus();
  }
  /** Simulations du « batch » auxquelles une correction peut être appliquée : celles affichées, de la même stratégie. */
  function anaBatchKeys() {
    if (!anaOrigin) return [];
    return evalFiltered(evalList()).map((x) => x.e).filter((x) => x.strategy && x.config && !x.tag && x.name === anaOrigin.e.name).map((x) => x.key);
  }
  async function analyzeBar(key) {
    const e = evalList().find((x) => x.key === key);
    if (checkRunning || !e || !e.strategy || !e.config) return;
    anaOrigin = { e: e }; anaCtx = null;
    showAnaModal();
    const idx = evalList().findIndex((x) => x.key === key) + 1;
    $('anaSub').textContent = '#' + idx + ' · ' + e.name + ' · ' + e.pair + ' · ' + frDate(e.from) + ' → ' + frDate(e.to);
    $('anaBody').innerHTML = '<div class="modal-loading"><span class="spinner"></span>Chargement de la simulation #' + idx + '…</div>';
    const saved = captureForm();
    checkRunning = 'ana';
    let c = null;
    try { c = await ctxOf(e); if (c) c.result = lastRunCtx.result; } finally {
      checkRunning = ''; setRunLabel('');
      restoring = true;
      try { loadStrategy(saved.strat); applyConfig(saved.config); $('style').value = saved.style; $('preset').value = [...$('preset').options].some((o) => o.value === saved.preset) ? saved.preset : 'mine'; $('presetDesc').textContent = saved.desc; updateWithdrawUI(); syncFormState(); }
      finally { restoring = false; }
    }
    if (!c || !c.result) { $('anaBody').innerHTML = '<p class="err">Simulation impossible : ' + esc($('formError').textContent || 'données indisponibles') + '</p>'; return; }
    openAnalyzer({ bars: c.bars, strat: c.strat, settings: c.settings, result: c.result }, anaOrigin);
  }
  function openAnalyzer(ctx, origin) {
    anaCtx = ctx && ctx.result ? ctx : lastRunCtx; anaOrigin = origin || null;
    if (!anaCtx || !anaCtx.result) return;
    if ($('anaModal').hidden || !origin) showAnaModal();
    const { bars, strat, settings, result } = anaCtx;
    if (!origin) $('anaSub').textContent = strat.name + ' · ' + settings.pair + ' · levier 1:' + settings.leverage;
    $('anaBody').innerHTML = '<div class="modal-loading"><span class="spinner"></span>Analyse de la simulation…</div>';
    setTimeout(() => {
      let rep;
      try { rep = F.analyzer.analyze(bars, strat, settings, result); } catch (e) { $('anaBody').innerHTML = '<p class="err">Analyse impossible : ' + esc(e.message) + '</p>'; return; }
      ana = { report: rep, tested: [], best: null };
      const lv = { bad: '⛔', warn: '⚠️', ok: '✅', info: 'ℹ️' };
      let html = '<div class="modal-note ana-verdict">' + rep.verdict.map((v) => '<p>' + v + '</p>').join('') + '</div>' + anaCurve(result, rep.drop);
      for (const s of rep.sections) html += '<section class="ana-sec ' + s.level + '"><h3>' + lv[s.level] + ' ' + esc(s.title) + '</h3><ul>' + s.items.map((x) => '<li>' + x + '</li>').join('') + '</ul></section>';
      html += '<details class="ana-sec"><summary><b>Où la stratégie gagne et perd</b></summary><div class="ana-tables">' +
        anaGroupTable('Marché (ADX 14)', rep.groups.regime) + anaGroupTable('Sens', rep.groups.direction) + anaGroupTable('Tendance de fond (EMA 200)', rep.groups.trend) +
        anaGroupTable('Volatilité à l\'entrée', rep.groups.volatility) + anaGroupTable('Durée', rep.groups.duration) + '</div></details>';
      html += '<section class="ana-sec"><h3>💡 Propositions</h3><p class="hint">Chaque proposition est testée sur la même période. ' + (anaOrigin ? '« Cette simulation » la relance avec la correction ; « Tout le batch » relance les ' + anaBatchKeys().length + ' simulations affichées de cette stratégie. Ensuite, vous pouvez l\'ajouter à la stratégie.' : '« Appliquer » modifie la stratégie dans le formulaire et relance la simulation.') + '</p><div id="anaProps">' +
        (rep.proposals.length ? '<div class="modal-loading"><span class="spinner"></span>Test des propositions…</div>' : '<p>Aucune correction évidente : la stratégie se comporte comme attendu sur cette période. Essayez « Améliorer » pour régler les indicateurs.</p>') + '</div></section>';
      $('anaBody').innerHTML = html;
      if (rep.proposals.length) setTimeout(testAnaProposals, 20);
    }, 30);
  }
  function testAnaProposals() {
    const { bars, strat, settings, result } = anaCtx, base = result.stats, A = F.analyzer;
    const score = (st) => (st ? E.score(st) : -Infinity);
    ana.tested = ana.report.proposals.map((p) => { const x = A.applyProposal(strat, settings, p); return { p: p, stats: E.run(bars, x.strat, x.settings) }; });
    ana.tested.sort((a, b) => score(b.stats) - score(a.stats));
    // meilleure combinaison : on empile les propositions tant que la note progresse
    let cur = { strat: strat, settings: settings }, curStats = base, picked = [];
    for (const t of ana.tested) {
      if (!t.stats || score(t.stats) <= score(base)) continue;
      const x = A.applyProposal(cur.strat, cur.settings, t.p), st = E.run(bars, x.strat, x.settings);
      if (st && score(st) > score(curStats)) { cur = x; curStats = st; picked.push(t.p); }
    }
    ana.best = picked.length ? { list: picked, strat: cur.strat, settings: cur.settings, stats: curStats } : null;
    $('anaProps').innerHTML = ana.tested.map((t, i) => {
      const st = t.stats, better = st && score(st) > score(base);
      return '<div class="ana-prop ' + (better ? 'good' : 'bad') + '"><div><b>' + esc(t.p.title) + '</b><div class="hint">' + t.p.why + '</div>' +
        '<div class="ana-ba">Avant : ' + statLine(base) + '<br>Après : ' + (st ? statLine(st) : 'échec du test') + (better ? ' <span class="pos">✓ mieux</span>' : ' <span class="hint">pas mieux sur cette période</span>') + '</div></div>' +
        (anaOrigin ? '<div class="ana-btns"><button type="button" class="' + (better ? 'primary' : 'secondary') + ' small" data-ana-apply="' + i + '">Cette simulation</button>' +
          '<button type="button" class="secondary small" data-ana-all="' + i + '">Tout le batch (' + anaBatchKeys().length + ')</button></div>'
          : '<button type="button" class="' + (better ? 'primary' : 'secondary') + ' small" data-ana-apply="' + i + '">Appliquer</button>') + '</div>';
    }).join('');
    $('anaBest').innerHTML = ana.best ? '<b>Meilleure combinaison :</b> ' + ana.best.list.map((p) => esc(p.title)).join(' + ') + ' → ' + statLine(ana.best.stats) : 'Aucune proposition n\'améliore le résultat sur cette période.';
    $('anaApplyBest').disabled = !ana.best;
    $('anaApplyBestAll').disabled = !ana.best;
    $('anaApplyBestAll').textContent = 'Appliquer à tout le batch (' + anaBatchKeys().length + ')';
  }
  /** Correction de l'analyseur appliquée à des simulations de l'évaluation (relancées sur place). */
  async function applyAnaToSims(st, se, titles, all, keysOverride) {
    const e = anaOrigin.e, keys = keysOverride || (all ? anaBatchKeys() : [e.key]);
    if (!keys.length || checkRunning) return;
    const base = e.strategy, before = keys.map((k) => ({ key: k, r: (evalList().find((x) => x.key === k) || {}).returnPct }));
    const lev = se.leverage !== anaCtx.settings.leverage ? se.leverage : 0;
    closeAnalyzer();
    pushUndo('Analyseur sur ' + keys.length + ' simulation(s)');
    barSel = new Set([e.key]);
    improveWhere = 'panel'; improveHtml = '<div class="modal-loading"><span class="spinner"></span>Nouvelle simulation avec la correction de l\'analyseur…</div>';
    renderEvaluation();
    await rerunWithStrategy(keys, Object.assign({}, st, { name: base.name }), lev ? { leverage: lev } : null);
    const after = evalList().filter((x) => keys.includes(x.key));
    const row = (x) => { const b = before.find((y) => y.key === x.key); return '<li>#' + (evalList().findIndex((y) => y.key === x.key) + 1) + ' : ' + pctFine(b.r) + ' → ' + pctFine(x.returnPct) + '</li>'; };
    const better = after.filter((x) => x.returnPct > before.find((y) => y.key === x.key).r).length;
    const text = titles.join(' + ');
    improveCtx = { kind: 'manual', strat: Object.assign({}, st, { name: base.name }), base: base, text: text, leverage: lev };
    improveHtml = '<div class="imp-proposal"><p><b>Correction de l\'analyseur :</b> ' + esc(text) + (lev ? ' (levier 1:' + lev + ')' : '') + '</p>' +
      '<p class="val ' + (better * 2 >= after.length ? 'ok' : 'ko') + '">' + better + ' simulation' + (better > 1 ? 's' : '') + ' sur ' + after.length + ' meilleure' + (better > 1 ? 's' : '') + ' :</p><ul class="imp-list">' + after.map(row).join('') + '</ul>' +
      '<p>Ajouter cette correction à la stratégie ?</p>' +
      '<div class="row buttons"><button type="button" class="primary small" id="manToCurrent">Ajouter à la stratégie en cours</button><button type="button" class="secondary small" id="manAsNew">Créer une nouvelle stratégie</button></div>' +
      '<p class="hint">Les barres montrent le résultat d\'origine en plein et le nouveau en pointillé. Ctrl+Z pour revenir aux résultats d\'avant.</p></div>';
    renderEvaluation();
    if ($('improveOut')) $('improveOut').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function applyAnalysis(st, se, titles) {
    undoable('Analyseur : ' + titles.join(' ; '), () => {
      const { strat, settings } = lastRunCtx;
      const s = Object.assign({}, st);
      s.name = String(strat.name).replace(/ \(améliorée\)$/, '') + ' (améliorée)';
      s.plots = F.french.derivePlots(s);
      s.frenchText = F.french.toFrench(s) || '';
      loadStrategy(s);
      if (se.leverage !== settings.leverage) $('leverage').value = String(se.leverage);
      $('preset').value = 'mine';
      $('deleteStrat').hidden = true;
      $('presetDesc').textContent = 'Corrections de l\'analyseur : ' + titles.join(' ; ') + '.';
      if (!s.frenchText) $('rulesDetails').open = true;
      logEvent('strategy.enhanced', 'Analyseur appliqué à ' + strat.name + ' : ' + titles.join(' ; '), { before: strat, after: s, leverage: se.leverage });
      updateStyleHint();
      closeAnalyzer();
      $('form').requestSubmit();
    });
  }
  function closeAnalyzer() { $('anaModal').hidden = true; if ($('evalModal').hidden) document.body.style.overflow = ''; }
  $('anaModal').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeAnalyzer();
    const b = e.target.closest('[data-ana-apply],[data-ana-all]');
    if (b && ana && anaCtx) {
      const t = ana.tested[Number(b.dataset.anaApply != null ? b.dataset.anaApply : b.dataset.anaAll)], x = F.analyzer.applyProposal(anaCtx.strat, anaCtx.settings, t.p);
      if (anaOrigin) applyAnaToSims(x.strat, x.settings, [t.p.title], b.dataset.anaAll != null);
      else applyAnalysis(x.strat, x.settings, [t.p.title]);
    }
  });
  $('anaApplyBest').addEventListener('click', () => {
    if (!ana || !ana.best) return;
    const titles = ana.best.list.map((p) => p.title);
    if (anaOrigin) applyAnaToSims(ana.best.strat, ana.best.settings, titles, false); else applyAnalysis(ana.best.strat, ana.best.settings, titles);
  });
  $('anaApplyBestAll').addEventListener('click', () => { if (ana && ana.best && anaOrigin) applyAnaToSims(ana.best.strat, ana.best.settings, ana.best.list.map((p) => p.title), true); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('anaModal').hidden) closeAnalyzer(); });

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
    await kvSyncCloud(); // FX, batchs, époques, événements, mécaniques de retrait, dessins…
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
    for (const k of ['forexia.strategies', 'forexia.evaluations', 'forexia.lastRun', 'forexia.batches']) { try { localStorage.removeItem(k); } catch (e) { /* ignoré */ } }
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
    await kvSyncBridge(); // FX, batchs, époques, événements, mécaniques de retrait, dessins…
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
      $('dbStatus').innerHTML = '<p><b>Base non connectée.</b> Vos stratégies, simulations, FX, batchs, époques, événements et mécaniques de retrait sont pour l\'instant seulement dans ce navigateur.</p>' +
        '<p class="hint">Lancez la passerelle (version 1.6 ou plus, fichiers dans <i>Déployer → Envoi direct</i>) et connectez-la : tout sera enregistré dans une base SQLite sur votre PC ' +
        '(<code>%APPDATA%\\Forexia\\forexia.db</code>), y compris ce qui est déjà dans ce navigateur.</p>';
      $('dbBody').innerHTML = ''; $('dbExport').disabled = true;
      return;
    }
    try { dbInfo = await dbCall('info'); } catch (e) { /* on garde les derniers chiffres */ }
    const c = dbInfo.counts;
    $('dbStatus').innerHTML = '<p><b>Base connectée</b> : <code>' + esc(dbInfo.path) + '</code> (' + num1.format(dbInfo.size / 1024) + ' Ko)</p>' +
      '<div class="db-counts"><span><b>' + c.strategies + '</b> stratégies</span><span><b>' + c.simulations + '</b> simulations</span><span><b>' + c.events + '</b> actions au journal</span></div>' + kvCountsHtml(!kvOldBridge);
    $('dbExport').disabled = false;
    renderJournal((await dbCall('events/list', { limit: 1000 })).items);
  }
  /** Les autres données (FX, batchs…) aussi enregistrées dans la base. */
  function kvCountsHtml(ok) {
    const n = (k) => { const v = kvRead(k); return Array.isArray(v) ? v.length : v ? 1 : 0; };
    const ev = kvRead('forexia.events') || {}, evN = (ev.items || []).filter((e) => !e.hidden).length;
    const parts = [[n('forexia.fx'), 'FX'], [n('forexia.batches'), 'batchs'], [n('forexia.eras'), 'époques'], [n('forexia.wdPresets'), 'mécaniques de retrait'], [evN, 'événements de marché ajoutés ou détectés'],
      [Object.keys(kvRead('forexia.wdResults') || {}).length, 'résultats de retrait calculés'], [Object.keys(kvRead('forexia.drawings') || {}).length, 'paires avec des tracés']];
    return '<p class="hint db-kv">' + (ok ? 'Aussi enregistrés dans la base : ' : '<b>Passerelle à mettre à jour (version 1.6)</b> pour enregistrer aussi : ') + parts.map(([v, l]) => '<b>' + v + '</b> ' + l).join(' · ') + ', et la dernière simulation.</p>';
  }
  async function renderCloudDatabase() {
    const u = C.user;
    let events = [];
    try {
      const c = await C.counts();
      $('dbStatus').innerHTML = '<p><b>Compte en ligne « ' + esc(u.name) + ' »</b> : vos données sont enregistrées en ligne et retrouvées sur tous vos appareils.</p>' +
        '<div class="db-counts"><span><b>' + c.strategies + '</b> stratégies</span><span><b>' + c.simulations + '</b> simulations</span><span><b>' + c.events + '</b> actions au journal</span></div>' + kvCountsHtml(true) +
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
        ? { exportedAt: new Date().toISOString(), account: C.user.name, strategies: await C.listStrategies(), simulations: await C.listSimulations(), events: await C.listEvents(10000), data: ((await C.getSettings()).kv || {}) }
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
    set(list) { lsSet(EVAL_KEY, JSON.stringify(list.slice(-5000))); },
  };
  let evalMemory = null; // repli si le stockage du navigateur est indisponible
  function evalList() { const l = evalStore.get(); return l.length || !evalMemory ? l : evalMemory; }
  function evalSave(list) { evalMemory = list; evalStore.set(list); updateEvalCount(); }
  // Onglet « Stratégie en cours » (par défaut) ou « Historique complet ».
  let evalScope = 'current';
  // ---------- Époques modifiables et « Analyseur d'époque » ----------
  // Vos époques : [{id, name, from, to}] (dates AAAA-MM-JJ ; '' = début / aujourd'hui). Vide = époques par défaut de Forexia.
  const ERA_KEY = 'forexia.eras';
  function userEras() { try { const c = JSON.parse(localStorage.getItem(ERA_KEY)); return Array.isArray(c) ? c.filter((x) => x && typeof x === 'object') : []; } catch (e) { return eraMem || []; } }
  let eraMem = null, eraDraft = null; // eraDraft : époque en cours de saisie {id?, name, from, to}
  function setUserEras(l) { eraMem = l; try { if (l && l.length) localStorage.setItem(ERA_KEY, JSON.stringify(l)); else localStorage.removeItem(ERA_KEY); } catch (e) { /* ignoré */ } eraDraft = null; renderEvaluation(); }
  function activeEras() { const u = userEras(); return u.length ? u : F.advisor.DEFAULT_CUTS; }
  const eraFromNorm = (er) => ({ id: 'e' + Math.random().toString(36).slice(2, 8), name: er.label, from: er.fromD === '0000-01-01' ? '' : er.fromD, to: er.toD === '9999-12-31' ? '' : er.toD });
  const eraSpan = (er) => (er.from ? frDate(er.from) : 'le début') + ' → ' + (er.to ? frDate(er.to) : 'aujourd\'hui');
  function eraFormHtml(d) {
    return '<div class="era-form" id="eraForm"><b>' + (d.id ? 'Modifier l\'époque' : 'Nouvelle époque') + '</b>' +
      '<label class="field">Nom<input id="eraFName" type="text" maxlength="60" value="' + esc(d.name || '') + '" placeholder="ex. Dollar fort, Après Covid…"></label>' +
      '<label class="field">Du<input id="eraFFrom" type="date" value="' + esc(d.from || '') + '"></label>' +
      '<label class="field">Au<input id="eraFTo" type="date" value="' + esc(d.to || '') + '"></label>' +
      '<button type="button" class="primary small" id="eraFSave">' + (d.id ? 'Enregistrer' : 'Ajouter l\'époque') + '</button><button type="button" class="secondary small" id="eraFCancel">Annuler</button>' +
      '<span class="hint">Date vide = depuis le début / jusqu\'à aujourd\'hui.</span></div>';
  }
  function eraEditorHtml(T, list) {
    const mine = userEras(), isMine = mine.length > 0;
    const count = (er) => { const n = F.advisor.normEras([er])[0]; return list.filter((e) => { const m = F.advisor.midDate(e); return m >= n.fromD && m <= n.toD; }).length; };
    let h = '<div class="era-edit" id="eraEdit"><div class="era-title"><b>Époques</b> <span class="ev-badge ' + (isMine ? 'user' : '') + '">' + (isMine ? 'vos époques' : 'par défaut (Forexia)') + '</span></div>' +
      '<p class="hint">Une simulation compte dans l\'époque qui contient le <b>milieu</b> de sa période. ' +
      (isMine ? '' : 'Époques par défaut, aux grands changements du marché des changes : ' + F.advisor.DEFAULT_CUTS.map((y, k) => { const e = F.events.cutEvents()[k]; return '<b>' + y + '</b> : ' + (e ? esc(e.title) + ' (' + frDate(e.date) + ')' : ''); }).join(' ; ') + '. ') +
      '<b>Pour définir vos époques : glissez la souris sur la frise ci-dessus</b> pour sélectionner une plage, ou ajoutez-les à la main. L\'analyseur d\'époque utilise ensuite vos époques.</p>';
    if (isMine) h += '<table class="ana-table era-table"><thead><tr><th>Époque</th><th>Plage</th><th>Simulations</th><th></th></tr></thead><tbody>' + mine.map((er) =>
      '<tr><td><b>' + esc(er.name) + '</b></td><td>' + eraSpan(er) + '</td><td>' + count(er) + '</td><td class="era-acts"><button type="button" class="ghost small" data-era-edit="' + esc(er.id) + '" title="Modifier">✏️</button><button type="button" class="ghost small" data-era-del="' + esc(er.id) + '" title="Supprimer">🗑</button></td></tr>').join('') + '</tbody></table>' +
      (T.outside ? '<p class="hint">' + T.outside + ' simulation' + (T.outside > 1 ? 's' : '') + ' en dehors de vos époques (non comptée' + (T.outside > 1 ? 's' : '') + ').</p>' : '');
    if (eraDraft) h += eraFormHtml(eraDraft);
    h += '<div class="row buttons era-row"><button type="button" class="secondary small" id="eraAddManual">＋ Ajouter une époque à la main</button>' +
      '<span class="era-quick">Découper par années : <input id="eraCutsIn" type="text" placeholder="ex. 2015, 2020" aria-label="Années de coupure"><button type="button" class="secondary small" id="eraApply">Créer</button></span>' +
      (T.split ? '<button type="button" class="ghost small" id="eraSplit" title="Deux époques : avant et depuis la rupture détectée">Couper à la rupture (' + T.split.year + ')</button>' : '') +
      (isMine ? '<button type="button" class="ghost small" id="eraDefault">Revenir aux époques par défaut</button>' : '') + '</div>';
    h += '<div class="era-ctx"><b>Ce qui s\'est passé dans chaque époque</b>' + T.byEra.map((g) => {
      const L = eventsFor(T.pair, { from: g.era.fromD < T.minYear + '-01-01' ? T.minYear + '-01-01' : g.era.fromD, to: g.era.toD > T.maxYear + '-12-31' ? T.maxYear + '-12-31' : g.era.toD, minImp: 3 }).filter((e) => e.source !== 'auto' || e.named);
      return '<div class="era-ctx-row"><span class="era-ctx-name">' + esc(g.label) + '</span>' + (L.length ? L.map((e) => '<span class="ev-chip" title="' + esc(frDate(e.date) + ' · ' + (e.text || '')) + '">' + e.date.slice(0, 4) + ' · ' + esc(e.title) + '</span>').join('') : '<span class="hint">aucun événement majeur connu</span>') + '</div>';
    }).join('') + '</div></div>';
    return h;
  }
  /** Sélection d'une plage à la souris (ou au doigt) sur la frise : propose une nouvelle époque. */
  function wireTimeline() {
    const svg = document.querySelector('#timeSection svg.tl-sel');
    if (!svg) return;
    const x0 = +svg.dataset.x0, x1 = +svg.dataset.x1, L = +svg.dataset.l, R = +svg.dataset.r, W = +svg.dataset.w, H = +svg.dataset.h;
    const vx = (cx) => { const b = svg.getBoundingClientRect(); return ((cx - b.left) / b.width) * W; };
    const toT = (v) => x0 + Math.max(0, Math.min(1, (v - L) / (W - L - R))) * (x1 - x0);
    let start = null, rect = null;
    svg.addEventListener('pointerdown', (ev) => {
      if (ev.button) return;
      start = Math.max(L, Math.min(W - R, vx(ev.clientX)));
      rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('class', 'tl-selrect'); rect.setAttribute('y', '0'); rect.setAttribute('height', String(H)); rect.setAttribute('x', String(start)); rect.setAttribute('width', '0');
      svg.appendChild(rect); svg.setPointerCapture(ev.pointerId); ev.preventDefault();
    });
    svg.addEventListener('pointermove', (ev) => {
      if (start == null) return;
      const v = Math.max(L, Math.min(W - R, vx(ev.clientX)));
      rect.setAttribute('x', String(Math.min(start, v))); rect.setAttribute('width', String(Math.abs(v - start)));
    });
    svg.addEventListener('pointerup', (ev) => {
      if (start == null) return;
      const v = Math.max(L, Math.min(W - R, vx(ev.clientX))), a = toT(Math.min(start, v)), b = toT(Math.max(start, v));
      start = null;
      if (b - a < 20 * 864e5) { rect.remove(); return; } // simple clic
      // arrondi au mois : début au 1er du mois le plus proche, fin au dernier jour du mois
      const d0 = new Date(a + 15 * 864e5), d1 = new Date(b - 15 * 864e5);
      const from = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1)), to = new Date(Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth() + 1, 0));
      const iso = (t) => t.toISOString().slice(0, 10);
      eraDraft = { name: 'Époque ' + (userEras().length + 1), from: iso(from), to: iso(to > from ? to : new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0))) };
      renderEvaluation();
      const f = $('eraForm'); if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('eraFName').select(); }
    });
  }
  // Analyseur d'époque : analyse toutes les époques affichées sous « Par époque » (vos époques, sinon celles par défaut).
  let eraState = null; // { list, T, max, status, msg, res }
  const ERA_KEYS = ['trendYear', 'aboveEma', 'adx', 'trendShare', 'efficiency', 'autocorr', 'vol', 'shocks'];
  function openEraAnalyzer(list) {
    const T = F.advisor.timeline(list, activeEras());
    if (T.byEra.length < 2) return toast('Il faut des simulations dans au moins deux époques (voir « Époques » sous le graphique).', false);
    eraState = { list: list, T: T, max: 8, status: 'idle' };
    $('eraModal').hidden = false; document.body.style.overflow = 'hidden';
    runEraAnalysis();
  }
  function renderEraModal() {
    const st = eraState;
    let h = '<div class="era-intro"><p>Analyse des <b>' + st.T.byEra.length + ' époques</b> affichées sous « Par époque » : ' + st.T.byEra.map((g) => '<b>' + esc(g.label) + '</b> (' + g.n + ')').join(', ') + '.</p>' +
      '<p class="hint">Les simulations de chaque époque sont rechargées (mêmes données, mêmes réglages) pour mesurer le marché (direction, tendance, va-et-vient, volatilité, chocs) et les trades, puis des corrections sont testées sur toutes les époques. ' +
      'Simulations rechargées par époque : <input id="eraMax" type="number" min="2" max="30" value="' + st.max + '"> <button type="button" class="secondary small" id="eraRun"' + (st.status === 'run' ? ' disabled' : '') + '>Relancer l\'analyse</button></p></div>';
    if (st.status === 'run') h += '<div class="modal-loading"><span class="spinner"></span>' + esc(st.msg || '') + '</div>';
    if (st.status === 'err') h += '<p class="val ko">' + esc(st.msg) + '</p>';
    if (st.status === 'done') h += eraResultHtml(st);
    $('eraBody').innerHTML = h;
  }
  async function runEraAnalysis() {
    const st = eraState;
    if (checkRunning || st.status === 'run') return;
    if ($('eraMax')) st.max = Math.max(2, Math.min(30, Math.round(+$('eraMax').value) || 8));
    const usable = st.list.filter((e) => e.strategy && e.config && !e.tag);
    const names = {}; usable.forEach((e) => { names[e.name] = (names[e.name] || 0) + 1; });
    const name = Object.keys(names).sort((x, y) => names[y] - names[x])[0];
    const pick = (L) => { if (L.length <= st.max) return L; const o = []; for (let i = 0; i < st.max; i++) o.push(L[Math.floor((i * L.length) / st.max)]); return o; };
    const inEra = (e, er) => { const m = F.advisor.midDate(e); return m >= er.fromD && m <= er.toD; };
    const plan = st.T.byEra.map((g) => ({ g: g, sims: pick(usable.filter((e) => e.name === name && inEra(e, g.era))), items: [] })).filter((p) => p.sims.length);
    if (plan.length < 2) { st.status = 'err'; st.msg = 'Il faut des simulations de « ' + name + ' » dans au moins deux époques.'; return renderEraModal(); }
    st.status = 'run'; renderEraModal();
    const saved = captureForm(), total = plan.reduce((a, p) => a + p.sims.length, 0);
    let k = 0;
    checkRunning = 'era'; checkStop = false;
    try {
      for (const p of plan) for (const e of p.sims) {
        if (checkStop) break;
        st.msg = 'Rechargement de la simulation ' + (++k) + ' / ' + total + ' (' + p.g.label + ')…'; renderEraModal(); setRunLabel('Époques ' + k + ' / ' + total);
        const c = await ctxOf(e);
        if (c && lastRunCtx && lastRunCtx.result) {
          const r = lastRunCtx.result;
          p.items.push({ e: e, ctx: { bars: c.bars, strat: c.strat, settings: c.settings }, features: F.analyzer.marketFeatures(c.bars, r.startIndex), trades: F.analyzer.tradeFeatures(c.bars, r), returnPct: r.stats.returnPct });
        }
      }
    } finally {
      checkRunning = ''; setRunLabel('');
      restoring = true;
      try { loadStrategy(saved.strat); applyConfig(saved.config); $('style').value = saved.style; $('preset').value = [...$('preset').options].some((o) => o.value === saved.preset) ? saved.preset : 'mine'; $('presetDesc').textContent = saved.desc; updateWithdrawUI(); syncFormState(); }
      finally { restoring = false; }
    }
    const groups = plan.filter((p) => p.items.length);
    if (groups.length < 2) { st.status = 'err'; st.msg = 'Simulations impossibles à recharger : ' + ($('formError').textContent || 'données indisponibles'); return renderEraModal(); }
    st.msg = 'Comparaison des époques et test des corrections…'; renderEraModal();
    await new Promise((r) => setTimeout(r, 20));
    const A = F.analyzer, strat = groups[0].items[0].ctx.strat;
    const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN; };
    for (const g of groups) { g.med = med(g.items.map((x) => x.returnPct)); g.win = (g.items.filter((x) => x.returnPct > 0).length / g.items.length) * 100; g.agg = A.compareEras(g.items, g.items, strat, ['', '']); }
    // époques perdantes contre époques gagnantes (sinon la pire contre la meilleure)
    let bad = groups.filter((g) => g.med <= 0), good = groups.filter((g) => g.med > 0);
    let mode = 'winlose';
    if (!bad.length || !good.length) { const s = groups.slice().sort((x, y) => x.med - y.med); bad = [s[0]]; good = [s[s.length - 1]]; mode = 'worstbest'; }
    const nm = (L) => L.map((g) => '« ' + g.g.label + ' »').join(', ');
    const la = bad.length > 1 ? 'dans les époques perdantes' : 'pendant « ' + bad[0].g.label + ' »', lb = good.length > 1 ? 'dans les époques gagnantes' : 'pendant « ' + good[0].g.label + ' »';
    const cmp = A.compareEras(bad.flatMap((g) => g.items), good.flatMap((g) => g.items), strat, [la, lb]);
    const fixes = A.eraCandidates(strat, cmp).map((p) => {
      let tr0 = 0, tr1 = 0;
      const per = groups.map((g) => {
        const after = g.items.map((x) => { const y = A.applyProposal(x.ctx.strat, x.ctx.settings, p), s2 = E.run(x.ctx.bars, y.strat, y.settings); tr0 += x.trades.length; tr1 += s2 ? s2.trades : 0; return s2 ? s2.returnPct : NaN; });
        return { before: g.med, after: med(after), win: (after.filter((v) => v > 0).length / Math.max(1, after.length)) * 100 };
      });
      const dBad = mean(groups.map((g, i) => (bad.includes(g) ? per[i].after - per[i].before : null)).filter((v) => v != null));
      const dGood = mean(groups.map((g, i) => (good.includes(g) ? per[i].after - per[i].before : null)).filter((v) => v != null));
      const few = tr0 ? tr1 / tr0 < 0.35 : false;
      const ok = !few && dBad > 1 && dGood >= -Math.max(5, Math.abs(mean(good.map((g) => g.med))) * 0.25);
      return { p: p, per: per, dBad: dBad, dGood: dGood, few: few, tradeRatio: tr0 ? tr1 / tr0 : 1, good: ok, score: dBad + Math.min(0, dGood) - (few ? 1000 : 0) };
    }).sort((x, y) => (y.good - x.good) || (y.score - x.score));
    st.res = { groups: groups, bad: bad, good: good, cmp: cmp, fixes: fixes, strat: strat, nmBad: nm(bad), nmGood: nm(good), mode: mode };
    st.status = 'done'; renderEraModal();
  }
  function eraResultHtml(st) {
    const r = st.res, G = r.groups, pc = (v) => (Number.isFinite(v) ? '<span class="' + cls(v) + '">' + signed(v, num1) + ' %</span>' : '—');
    const head = '<tr><th></th>' + G.map((g) => '<th class="' + (r.bad.includes(g) ? 'neg' : r.good.includes(g) ? 'pos' : '') + '">' + esc(g.g.label) + '</th>').join('') + '</tr>';
    let h = '<div class="era-cards">' + G.map((g) => '<div class="era-card ' + (g.med > 0 ? 'good' : 'bad') + '"><b>' + esc(g.g.label) + '</b>' + g.items.length + ' simulation' + (g.items.length > 1 ? 's' : '') + ' rechargée' + (g.items.length > 1 ? 's' : '') + ' · ' + Math.round(g.win) + ' % gagnantes · médiane ' + pc(g.med) + '</div>').join('') + '</div>';
    h += '<section class="ana-sec warn"><h3>Ce qui a fait la différence</h3><p class="hint">' + (r.mode === 'winlose' ? 'Comparaison des époques perdantes (' + esc(r.nmBad) + ') et des époques gagnantes (' + esc(r.nmGood) + ').' :
      'Toutes les époques ' + (r.groups.every((g) => g.med <= 0) ? 'perdent' : 'gagnent') + ' : comparaison de la moins bonne (' + esc(r.nmBad) + ') et de la meilleure (' + esc(r.nmGood) + ').') + '</p>' +
      (r.cmp.causes.length ? '<ol>' + r.cmp.causes.slice(0, 6).map((x) => '<li>' + x.text + '</li>').join('') + '</ol>' : '<p>Pas de différence marquée du marché entre ces époques : l\'écart vient peut-être du hasard. Rechargez plus de simulations par époque.</p>') +
      '<p class="hint">Stratégie ' + ({ trend: 'de suivi de tendance', reversion: 'de retour à la moyenne', mixed: 'mixte' })[r.cmp.kind] + '. Les différences sont classées par importance.</p></section>';
    h += '<details class="ana-sec" open><summary><b>Le marché dans chaque époque</b> (médiane des simulations rechargées)</summary><div class="table-wrap"><table class="ana-table era-grid"><thead>' + head + '</thead><tbody>' +
      r.cmp.rows.map((row, k) => '<tr><td>' + esc(row.label) + '</td>' + G.map((g) => { const v = g.agg.A[ERA_KEYS[k]]; return '<td>' + (Number.isFinite(v) ? row.fmt(v) : '—') + '</td>'; }).join('') + '</tr>').join('') + '</tbody></table></div></details>';
    const tcell = (t) => (t.n ? t.n + ' · ' + Math.round(t.win) + ' % · <span class="' + cls(t.pips) + '">' + signed(t.pips, num1) + ' pips</span>' : '—');
    h += '<details class="ana-sec" open><summary><b>Les trades</b> (nombre · gagnants · gain moyen)</summary><div class="table-wrap"><table class="ana-table era-grid"><thead>' + head + '</thead><tbody>' +
      r.cmp.tradeRows.map((row, k) => '<tr><td>' + esc(row.label) + '</td>' + G.map((g) => '<td>' + tcell(g.agg.tradeRows[k].a) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></details>';
    h += '<details class="ana-sec"><summary><b>📰 Ce qui s\'est passé dans chaque époque</b> (événements de marché)</summary>' + G.map((g) => {
      const L = g.items.map((x) => x.e), f = L.map((e) => e.from).sort()[0], t = L.map((e) => e.to).sort().pop();
      const ev = eventsFor(L[0].pair, { from: f, to: t, minImp: 2 }).filter((e) => (e.source !== 'auto' || e.named || e.imp >= 3) && L.some((x) => e.date >= x.from && e.date <= x.to)).slice(-8);
      return '<div class="era-ctx-row"><span class="era-ctx-name">' + esc(g.g.label) + '</span>' + (ev.length ? ev.map((e) => '<span class="ev-chip" title="' + esc(frDate(e.date) + ' · ' + (e.text || '')) + '">' + e.date.slice(0, 4) + ' · ' + esc(e.title) + '</span>').join('') : '<span class="hint">aucun événement connu</span>') + '</div>';
    }).join('') + '</details>';
    const n = G.reduce((a, g) => a + g.items.length, 0);
    h += '<section class="ana-sec"><h3>💡 Corrections testées sur toutes les époques</h3><p class="hint">Résultat médian de chaque époque, avant → après. « Recommandée » : améliore ' + (r.mode === 'winlose' ? 'les époques perdantes sans dégrader les gagnantes' : 'la moins bonne époque sans dégrader la meilleure') + '.</p>' +
      '<div class="table-wrap"><table class="ana-table era-grid era-fixes"><thead><tr><th>Correction</th>' + G.map((g) => '<th>' + esc(g.g.label) + '</th>').join('') + '<th></th></tr></thead><tbody>' +
      r.fixes.map((f, i) => '<tr class="' + (f.good ? 'rec' : '') + '"><td><b>' + esc(f.p.title) + '</b>' + (f.good ? ' <span class="pos">✓ recommandée</span>' : '') + (f.few ? '<div class="hint">✗ supprime ' + Math.round((1 - f.tradeRatio) * 100) + ' % des trades</div>' : '') + '</td>' +
        f.per.map((x) => '<td>' + pc(x.before) + ' → ' + pc(x.after) + '</td>').join('') +
        '<td><button type="button" class="' + (f.good ? 'primary' : 'secondary') + ' small" data-era-fix="' + i + '">Appliquer (' + n + ')</button></td></tr>').join('') + '</tbody></table></div>' +
      '<p class="hint">« Appliquer » relance les ' + n + ' simulations rechargées avec la correction (Ctrl+Z pour revenir), puis propose de l\'ajouter à la stratégie.</p></section>';
    return h;
  }
  function applyEraFix(i) {
    const r = eraState && eraState.res, f = r && r.fixes[i];
    if (!f) return;
    const all = r.groups.flatMap((g) => g.items), first = all[0], y = F.analyzer.applyProposal(first.ctx.strat, first.ctx.settings, f.p);
    anaOrigin = { e: first.e }; anaCtx = first.ctx;
    closeEraModal();
    applyAnaToSims(y.strat, y.settings, [f.p.title], true, all.map((x) => x.e.key));
  }
  function closeEraModal() { $('eraModal').hidden = true; if ($('evalModal').hidden) document.body.style.overflow = ''; }
  $('eraModal').addEventListener('click', (ev) => {
    if (ev.target.closest('[data-close]')) { if (checkRunning === 'era') checkStop = true; return closeEraModal(); }
    if (ev.target.id === 'eraRun') return runEraAnalysis();
    const fx = ev.target.closest('[data-era-fix]');
    if (fx) applyEraFix(+fx.dataset.eraFix);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('eraModal').hidden) closeEraModal(); });
  $('evalBody').addEventListener('click', (ev) => {
    const id = ev.target.id;
    const listNow = () => evalFiltered(evalList()).map((x) => x.e);
    if (id === 'eraApply') {
      const c = ($('eraCutsIn').value.match(/\d{4}/g) || []).map(Number).filter((y) => y >= 1971 && y <= 2100);
      if (!c.length) return toast('Indiquez au moins une année de coupure (ex. 2020).', false);
      return setUserEras(F.advisor.erasFromCuts([...new Set(c)]).map(eraFromNorm));
    }
    if (id === 'eraDefault') return setUserEras([]);
    if (id === 'eraSplit') { const T = F.advisor.timeline(listNow(), activeEras()); if (T.split) setUserEras(F.advisor.erasFromCuts([T.split.year]).map(eraFromNorm)); return; }
    if (id === 'eraAddManual') { eraDraft = { name: 'Époque ' + (userEras().length + 1), from: '', to: '' }; renderEvaluation(); const f = $('eraForm'); if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('eraFName').select(); } return; }
    if (id === 'eraFCancel') { eraDraft = null; return renderEvaluation(); }
    if (id === 'eraFSave') {
      const name = $('eraFName').value.trim().replace(/\|/g, '/').slice(0, 60) || 'Époque', from = $('eraFFrom').value, to = $('eraFTo').value;
      if (from && to && from > to) return toast('La date de début doit précéder la date de fin.', false);
      const l = userEras().slice();
      // première époque personnalisée : on part de zéro (les époques par défaut ne sont pas recopiées)
      if (eraDraft && eraDraft.id) { const k = l.findIndex((x) => x.id === eraDraft.id); if (k >= 0) l[k] = { id: eraDraft.id, name: name, from: from, to: to }; }
      else l.push({ id: 'e' + Date.now().toString(36), name: name, from: from, to: to });
      l.sort((x, y) => (x.from || '0000') < (y.from || '0000') ? -1 : 1);
      return setUserEras(l);
    }
    const ed = ev.target.closest('[data-era-edit]');
    if (ed) { const er = userEras().find((x) => x.id === ed.dataset.eraEdit); if (er) { eraDraft = Object.assign({}, er); renderEvaluation(); const f = $('eraForm'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'center' }); } return; }
    const dl = ev.target.closest('[data-era-del]');
    if (dl) return setUserEras(userEras().filter((x) => x.id !== dl.dataset.eraDel));
    if (id === 'eraAnalyze') return openEraAnalyzer(evalFiltered(evalList()).map((x) => x.e));
  });
  $('evalBody').addEventListener('keydown', (ev) => {
    if (ev.target.id === 'eraCutsIn' && ev.key === 'Enter') $('eraApply').click();
    if (['eraFName', 'eraFFrom', 'eraFTo'].includes(ev.target.id) && ev.key === 'Enter') $('eraFSave').click();
  });

  // ---------- « Resimuler avec un retrait » : simulations relancées avec un retrait fictif des gains ----------
  const WD_KEY = 'forexia.wdPresets', WD_RES_KEY = 'forexia.wdResults';
  const wdPresets = () => { try { const l = JSON.parse(localStorage.getItem(WD_KEY)); return Array.isArray(l) ? l : []; } catch (e) { return wdPresetMem || []; } };
  let wdPresetMem = null, wdResMem = {};
  /** Mécaniques proposées à la comparaison : les mécaniques enregistrées + « Sans retrait ». */
  const wdChoices = () => wdPresets().concat({ id: 'none', name: 'Sans retrait', w: { on: false, mode: 'none' } });
  function setWdPresets(l) { wdPresetMem = l; if (!lsSet(WD_KEY, JSON.stringify(l))) lsFullToast('la mécanique de retrait'); refreshWdPresetPick(); }
  /** Réglages de simulation avec la mécanique de retrait w ({on, mode, pct, share, when, every, days, type, value}). */
  function wdApply(se, w) { return F.fxcore.wdApply(se, w); }
  const wdDesc = (w) => F.fxcore.wdDesc(w);
  // clé d'une mécanique (seuls les champs utiles) : sert à retrouver les résultats déjà calculés
  const wdKey = (w) => F.fxcore.wdKey(w);
  const wdFromForm = () => ({ on: true, mode: $('withdrawMode').value, pct: $('withdrawPct').value, share: $('withdrawShare').value, when: $('withdrawWhen').value, every: $('withdrawEvery').value, days: $('withdrawDays').value, type: $('withdrawType').value, value: $('withdrawValue').value });
  function wdToForm(w) {
    $('withdrawOn').checked = true; $('withdrawMode').value = w.mode || 'threshold'; $('withdrawPct').value = w.pct || 20; $('withdrawShare').value = w.share || 100; $('withdrawWhen').value = w.when || 'close';
    $('withdrawEvery').value = w.every || 'month'; $('withdrawDays').value = w.days || 30; $('withdrawType').value = w.type || 'pct'; $('withdrawValue').value = w.value || 5;
    updateWithdrawUI();
  }
  // Résultats déjà calculés : par mécanique et par simulation (gardés dans ce navigateur, 400 au plus)
  const wdResStore = {
    get() { try { return JSON.parse(localStorage.getItem(WD_RES_KEY)) || {}; } catch (e) { return wdResMem; } },
    set(o) { wdResMem = o; const k = Object.keys(o); if (k.length > 400) k.sort((a, b) => (o[a].t || 0) - (o[b].t || 0)).slice(0, k.length - 400).forEach((x) => delete o[x]); try { localStorage.setItem(WD_RES_KEY, JSON.stringify(o)); } catch (e) { /* ignoré */ } },
  };
  // Liste des mécaniques enregistrées, aussi dans la section « Retrait fictif » du formulaire
  function refreshWdPresetPick() {
    const l = wdPresets(), sel = $('wdPresetPick');
    if (!sel) return;
    sel.innerHTML = '<option value="">Mécanique enregistrée…</option>' + l.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>').join('');
    sel.closest('label').hidden = !l.length;
  }
  $('wdPresetPick').addEventListener('change', () => {
    const p = wdPresets().find((x) => x.id === $('wdPresetPick').value);
    if (p) undoable('Mécanique de retrait « ' + p.name + ' »', () => wdToForm(p.w));
    $('wdPresetPick').value = '';
  });
  refreshWdPresetPick();
  let wdState = null; // { all, scope, w, status, msg, rows, presetId, ran }
  function openWdModal() {
    const all = evalFiltered(evalList()).map((x) => x.e).filter((e) => e.strategy && e.config && !e.tag);
    if (!all.length) return toast('Aucune simulation à resimuler.', false);
    const sel = all.filter((e) => barSel.has(e.key));
    wdState = { all: all, sel: (sel.length ? sel : all).map((e) => e.key), w: $('withdrawOn').checked ? wdFromForm() : { on: true, mode: 'periodic', every: 'month', days: 30, type: 'pct', value: 5, pct: 20, share: 100, when: 'close' }, status: 'idle', rows: null };
    $('wdModal').hidden = false; document.body.style.overflow = 'hidden';
    wdShowCached();
  }
  function closeWdModal() { if (checkRunning === 'wd') checkStop = true; $('wdModal').hidden = true; if ($('evalModal').hidden) document.body.style.overflow = ''; }
  /** Simulations visées : toutes celles affichées (le batch), la sélection, ou une seule. */
  function wdTargets() {
    const st = wdState;
    return st.all.filter((e) => st.sel.includes(e.key));
  }
  // Résultats déjà calculés pour cette mécanique et ces simulations : affichés tout de suite, sinon calcul.
  function wdShowCached(autoRun) {
    if (wdState.view === 'compare') { wdState.cmp.status = 'idle'; wdState.cmp.msg = ''; return renderWdModal(); }
    const st = wdState, T = wdTargets(), cache = wdResStore.get(), k = wdKey(st.w);
    const rows = T.map((e) => cache[k + '#' + e.key]).filter(Boolean);
    // résultats déjà calculés (tous ou une partie) : affichés sans relancer ; le reste se calcule avec « Resimuler »
    st.missing = T.length - rows.length; st.focus = null;
    if (rows.length) { st.rows = rows.map((r) => Object.assign({}, r, { idx: evalList().findIndex((x) => x.key === r.key) + 1 })); st.status = 'done'; st.ran = Object.assign({}, st.w); st.cached = true; renderWdModal(); return; }
    st.rows = null; st.status = 'idle'; st.cached = false;
    renderWdModal();
    if (autoRun) runWd();
  }
  function wdReadForm() {
    const w = wdState.w, v = (id) => ($(id) ? $(id).value : undefined);
    if (!$('wdMode')) return;
    // seuls les champs affichés sont lus : les autres gardent leur valeur
    const map = { mode: 'wdMode', pct: 'wdPct', share: 'wdShare', when: 'wdWhen', every: 'wdEvery', days: 'wdDays', type: 'wdType', value: 'wdValue' };
    for (const k in map) { const x = v(map[k]); if (x !== undefined) w[k] = x; }
    w.on = w.mode !== 'none';
  }
  const wdMechHint = (w) => 'Mécanique : <b>' + esc(w.mode === 'none' ? 'aucun retrait : le capital et les gains restent sur le compte jusqu\'à la fin de la période' : wdDesc(w)) + '</b>. Comme chez un courtier, seule la marge libre peut être retirée : si une position bloque la marge, le retrait attend sa clôture.';
  function wdFormHtml(w) {
    const st = wdState, opt = (cur, list) => list.map(([v, l]) => '<option value="' + v + '"' + (String(cur) === v ? ' selected' : '') + '>' + l + '</option>').join('');
    const per = w.mode === 'periodic', pres = wdPresets(), all = evalList();
    const n = wdTargets().length;
    return '<div class="wd-form"><div class="wd-scope"><div class="wd-scope-head"><b>Appliquer à</b> <span id="wdSelCount">' + wdSelLabel() + '</span>' +
      '<button type="button" class="secondary small" id="wdSelAll">Tout le batch (' + st.all.length + ')</button><button type="button" class="ghost small" id="wdSelNone">Aucune</button></div>' +
      '<p class="hint">Cliquez sur une simulation pour la choisir seule ; <b>glissez la souris</b> pour en choisir plusieurs à la suite ; <b>Maj</b> (ou Ctrl) + clic pour en ajouter ou retirer une à une.</p>' +
      '<ul class="wd-pick" id="wdPick">' + st.all.map((e, i) => '<li data-i="' + i + '" class="' + (st.sel.includes(e.key) ? 'on' : '') + '"><span class="wd-chk"></span><b>#' + (all.findIndex((x) => x.key === e.key) + 1) + '</b> ' + frDate(e.from) + ' → ' + frDate(e.to) +
        ' <small>' + durationLabel(e.from, e.to) + '</small> <span class="' + cls(e.returnPct) + '">' + signed(e.returnPct, num1) + ' %</span></li>').join('') + '</ul></div>' +
      '<div class="wd-presets"><label class="field">Mécanique enregistrée<select id="wdPreset"><option value="">—</option>' + pres.map((p) => '<option value="' + esc(p.id) + '"' + (st.presetId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></label>' +
      (st.presetId ? '<button type="button" class="ghost small" id="wdPresetDel" title="Supprimer cette mécanique">🗑</button>' : '') +
      '<button type="button" class="secondary small" id="wdSave">💾 Enregistrer cette mécanique</button><button type="button" class="secondary small wd-cmp-btn" id="wdCmp" title="Comparer deux mécaniques enregistrées sur les simulations choisies">⚖️ Comparer</button><button type="button" class="ghost small" id="wdToForm" title="Mettre cette mécanique dans la section « Retrait fictif des gains » du formulaire">Utiliser dans le formulaire</button></div>' +
      '<div class="wd-fields"><label class="field">Type de retrait<select id="wdMode">' + opt(w.mode, [['threshold', 'Quand le gain atteint un seuil'], ['periodic', 'Régulier : chaque mois ou tous les X jours'], ['none', 'Aucun retrait pendant la période']]) + '</select></label>' +
      (w.mode === 'none' ? '' : per ? '<label class="field">Fréquence<select id="wdEvery">' + opt(w.every, [['month', 'Chaque mois'], ['days', 'Tous les X jours']]) + '</select></label>' +
        (w.every === 'days' ? '<label class="field">Tous les (jours, min. 15)<input id="wdDays" type="number" min="15" max="366" value="' + esc(w.days) + '"></label>' : '') +
        '<label class="field">Montant retiré<select id="wdType">' + opt(w.type, [['pct', '% du compte'], ['fixed', 'Somme fixe'], ['excess', '% de l\'excédent sur le capital de départ']]) + '</select></label>' +
        '<label class="field">' + (w.type === 'fixed' ? 'Somme' : 'Pourcentage (%)') + '<input id="wdValue" type="number" min="0" step="any" value="' + esc(w.value) + '"></label>'
        : '<label class="field">Seuil de gain (%)<input id="wdPct" type="number" min="1" max="1000" value="' + esc(w.pct) + '"></label><label class="field">Part du gain retirée (%)<input id="wdShare" type="number" min="1" max="100" value="' + esc(w.share) + '"></label>' +
        '<label class="field">Moment<select id="wdWhen">' + opt(w.when, [['immediate', 'Dès le seuil (position clôturée)'], ['close', 'À la clôture du trade']]) + '</select></label>') +
      '<button type="button" class="primary" id="wdRun"' + (st.status === 'run' || !n ? ' disabled' : '') + '>▶ Resimuler ' + (n > 1 ? 'les ' + n + ' simulations' : n ? 'la simulation' : '(choisissez des simulations)') + '</button></div>' +
      '<p class="hint" id="wdMechHint">' + wdMechHint(w) + '</p></div>';
  }
  function renderWdModal() {
    const st = wdState, n = wdTargets().length;
    let h = '<div class="modal-note"><b>Ce qu\'on fait :</b> ' + (n > 1 ? 'chaque simulation choisie (' + n + ') est relancée' : 'la simulation choisie est relancée') + ' sur les <b>mêmes dates</b> et avec les <b>mêmes réglages</b>, une fois <b>sans retrait</b> et une fois avec la <b>mécanique de retrait fictif</b> ci-dessous : l\'argent retiré est mis à l\'abri et ne sert plus à trader. ' +
      'Le résultat « avec retrait » compte le compte final <b>plus</b> les sommes retirées. Les simulations du tableau ne sont pas modifiées.</div>' + wdFormHtml(st.w);
    if (st.view === 'compare') {
      const pick = $('wdPick'), sc = pick ? pick.scrollTop : 0;
      $('wdBody').innerHTML = h + wdCompareHtml(st);
      if ($('wdPick')) $('wdPick').scrollTop = sc;
      return mountWdCompare(st);
    }
    if (st.status === 'run') h += '<div class="modal-loading"><span class="spinner"></span>' + esc(st.msg || '') + ' <button type="button" class="secondary small" id="wdStop">Arrêter</button></div>';
    if (st.status === 'err') h += '<p class="val ko">' + esc(st.msg) + '</p>';
    if (st.status === 'idle' && !st.rows) h += '<p class="hint wd-idle">' + (st.presetId ? 'Cette mécanique n\'a pas encore de résultats sur ' + (n > 1 ? 'ces simulations' : 'cette simulation') + ' : cliquez sur « Resimuler ».' : 'Choisissez la mécanique puis « Resimuler ».') + ' Les résultats calculés sont gardés : en rechoisissant la mécanique, ils s\'affichent sans relancer.</p>';
    if (st.status === 'done' && st.cached && st.missing > 0) h += '<p class="banner info wd-partial">Résultats déjà calculés pour ' + st.rows.length + ' simulation' + (st.rows.length > 1 ? 's' : '') + ' sur ' + n + '. « Resimuler » calcule seulement les ' + st.missing + ' autre' + (st.missing > 1 ? 's' : '') + '.</p>';
    if (st.rows && st.rows.length) h += wdResultHtml(st);
    const pick = $('wdPick'), sc = pick ? pick.scrollTop : 0;
    $('wdBody').innerHTML = h;
    if ($('wdPick')) $('wdPick').scrollTop = sc; // la liste garde sa position
    if (st.rows && st.rows.length && st.status !== 'run') mountWdCharts(st);
  }
  /** Résumé compact d'une simulation relancée (gardé en mémoire : assez pour tous les graphiques). */
  function wdRow(e, capital, base, wd) { return F.fxcore.wdRow(e, capital, base, wd); }
  /** Chiffres dérivés d'une simulation relancée : retraits mois par mois, premier retrait, rente annuelle. */
  function wdDerive(r) { return F.fxcore.wdDerive(r); }
  /** Relance les simulations T avec la mécanique w (celles déjà calculées sont reprises). onStep(i, n) pour la progression. */
  async function wdCompute(w, T, onStep) {
    const saved = captureForm(), rows = [], cache = wdResStore.get(), k = wdKey(w);
    checkRunning = 'wd'; checkStop = false;
    try {
      for (let i = 0; i < T.length && !checkStop; i++) {
        const e = T[i];
        if (cache[k + '#' + e.key]) { rows.push(cache[k + '#' + e.key]); continue; }
        if (onStep) onStep(i, T.length); setRunLabel('Retrait ' + (i + 1) + ' / ' + T.length);
        const c = await ctxOf(e);
        if (!c) continue;
        const run = (se) => { try { return se.broker ? F.broker.runBrokerBacktest(c.bars, c.strat, se, se.broker) : F.backtest.runBacktest(c.bars, c.strat, se); } catch (err) { return null; } };
        const base = run(wdApply(c.settings, null)), wd = run(wdApply(c.settings, w));
        if (base && wd) { const row = wdRow(e, c.settings.capital, base, wd); rows.push(row); cache[k + '#' + e.key] = row; }
      }
    } finally {
      checkRunning = ''; setRunLabel('');
      restoring = true;
      try { loadStrategy(saved.strat); applyConfig(saved.config); $('style').value = saved.style; $('preset').value = [...$('preset').options].some((o) => o.value === saved.preset) ? saved.preset : 'mine'; $('presetDesc').textContent = saved.desc; updateWithdrawUI(); syncFormState(); }
      finally { restoring = false; }
    }
    wdResStore.set(cache);
    return rows.map((r) => Object.assign({}, r, { idx: evalList().findIndex((x) => x.key === r.key) + 1 }));
  }
  // ----- Comparer deux mécaniques enregistrées sur les mêmes simulations -----
  function openWdCompare() {
    const pres = wdChoices(), st = wdState;
    if (pres.length < 2) return toast('Enregistrez au moins une mécanique de retrait (💾) pour la comparer à « Sans retrait » ou à une autre.', false);
    if (!wdTargets().length) return toast('Choisissez au moins une simulation dans la liste.', false);
    st.view = 'compare';
    st.cmp = st.cmp && pres.some((p) => p.id === st.cmp.a) && pres.some((p) => p.id === st.cmp.b) ? st.cmp : { a: pres[0].id, b: pres[1].id };
    runWdCompare();
  }
  async function runWdCompare() {
    const st = wdState, c = st.cmp, pres = wdChoices(), T = wdTargets();
    const A = pres.find((p) => p.id === c.a), B = pres.find((p) => p.id === c.b);
    if (!A || !B || A.id === B.id) { c.status = 'err'; c.msg = 'Choisissez deux mécaniques différentes.'; return renderWdModal(); }
    if (checkRunning) return;
    c.status = 'run'; c.ra = c.rb = null; renderWdModal();
    const cache = wdResStore.get(), miss = (w) => T.filter((e) => !cache[wdKey(w) + '#' + e.key]).length, total = miss(A.w) + miss(B.w);
    if (total > 60 && !confirm(total + ' simulations à calculer pour la comparaison. Continuer ?')) { c.status = 'idle'; return renderWdModal(); }
    let done = 0;
    const step = (name) => () => { done++; c.msg = 'Calcul de « ' + name + ' » : simulation ' + done + ' / ' + total + '…'; renderWdModal(); };
    c.ra = await wdCompute(A.w, T, step(A.name));
    if (!checkStop) c.rb = await wdCompute(B.w, T, step(B.name));
    c.status = c.ra && c.rb && c.ra.length && c.rb.length ? 'done' : 'err';
    if (c.status === 'err') c.msg = checkStop ? 'Comparaison arrêtée.' : 'Simulations impossibles à relancer : ' + ($('formError').textContent || 'données indisponibles');
    c.A = A; c.B = B;
    renderWdModal();
  }
  /** Indicateurs d'une mécanique sur un ensemble de simulations. */
  function wdAgg(R) { return F.fxcore.wdAgg(R); }
  function wdCompareHtml(st) {
    const c = st.cmp, pres = wdChoices(), T = wdTargets();
    const sel = (id, cur) => '<select id="' + id + '">' + pres.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === cur ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select>';
    let h = '<section class="wd-cmp"><div class="wd-cmp-head"><h3>⚖️ Comparer deux mécaniques de retrait</h3><button type="button" class="secondary small" id="wdCmpBack">← Retour aux résultats</button></div>' +
      '<div class="wd-cmp-pick"><label class="field"><span><i class="wd-dot a"></i>Mécanique A</span>' + sel('wdCmpA', c.a) + '</label><span class="wd-vs">contre</span><label class="field"><span><i class="wd-dot b"></i>Mécanique B</span>' + sel('wdCmpB', c.b) + '</label>' +
      '<button type="button" class="primary small" id="wdCmpRun"' + (c.status === 'run' ? ' disabled' : '') + '>Comparer</button></div>' +
      '<p class="hint">Sur ' + (T.length > 1 ? 'les ' + T.length + ' simulations choisies dans la liste ci-dessus' : 'la simulation choisie') + ' (même stratégie, mêmes dates). Les simulations jamais calculées avec une mécanique sont relancées une fois, puis gardées.</p>';
    if (c.status === 'run') return h + '<div class="modal-loading"><span class="spinner"></span>' + esc(c.msg || 'Comparaison…') + ' <button type="button" class="secondary small" id="wdStop">Arrêter</button></div></section>';
    if (c.status === 'err') return h + '<p class="val ko">' + esc(c.msg) + '</p></section>';
    if (c.status !== 'done') return h + '</section>';
    const keys = c.ra.map((r) => r.key).filter((k) => c.rb.some((r) => r.key === k));
    const RA = keys.map((k) => c.ra.find((r) => r.key === k)), RB = keys.map((k) => c.rb.find((r) => r.key === k));
    const a = wdAgg(RA), b = wdAgg(RB), nA = esc(c.A.name), nB = esc(c.B.name);
    const pc = (v) => (Number.isFinite(v) ? signed(v, num1) + ' %' : '—');
    // lignes : [libellé, valeur A, valeur B, format, plus grand = mieux ?]
    const rows = [
      ['Total retiré', a.wd, b.wd, (v) => money.format(v), true],
      ['Retrait moyen par mois', a.perMonth, b.perMonth, (v) => money.format(v), true],
      ['Rente annuelle moyenne (% du capital)', a.yearly, b.yearly, (v) => num1.format(v) + ' %', true],
      ['Résultat moyen (compte + retraits)', a.ret, b.ret, pc, true],
      ['Gain moyen après 1 an (compte + retraits)', a.year, b.year, pc, true],
      ['Compte final médian (% du capital)', a.finalMed, b.finalMed, (v) => num1.format(v) + ' %', true],
      ['Capital de départ préservé', a.kept, b.kept, (v) => v + ' / ' + keys.length, true],
      ['Comptes sous 50 % du capital', a.ruined, b.ruined, (v) => v + ' / ' + keys.length, false],
      ['Drawdown moyen', a.dd, b.dd, (v) => '−' + num1.format(v) + ' %', false],
      ['Mois avec un retrait', a.withPct, b.withPct, (v) => Math.round(v) + ' %', null],
      ['Délai moyen avant le premier retrait', a.first, b.first, (v) => (Number.isFinite(v) ? num1.format(v) + ' mois' : '—'), false],
    ];
    const winA = rows.filter((r) => r[4] !== null && (r[4] ? r[1] > r[2] : r[1] < r[2])).length, winB = rows.filter((r) => r[4] !== null && (r[4] ? r[2] > r[1] : r[2] < r[1])).length;
    const best = a.score >= b.score ? 'a' : 'b';
    c.bestSide = best;
    const cell = (v, other, f, up, side) => { const better = up === null || v === other || !Number.isFinite(v) || !Number.isFinite(other) ? '' : (up ? v > other : v < other) ? ' win' : ''; return '<td class="wd-' + side + better + '">' + f(v) + '</td>'; };
    h += '<div class="wd-cmp-verdict"><div class="wd-cmp-card ' + (best === 'a' ? 'best' : '') + '"><i class="wd-dot a"></i><b>' + nA + '</b><span>' + esc(wdDesc(c.A.w)) + '</span><span>Meilleure sur ' + winA + ' critère' + (winA > 1 ? 's' : '') + '</span></div>' +
      '<div class="wd-cmp-card ' + (best === 'b' ? 'best' : '') + '"><i class="wd-dot b"></i><b>' + nB + '</b><span>' + esc(wdDesc(c.B.w)) + '</span><span>Meilleure sur ' + winB + ' critère' + (winB > 1 ? 's' : '') + '</span></div></div>';
    const X = best === 'a' ? a : b, Y = best === 'a' ? b : a, nX = best === 'a' ? nA : nB, nY = best === 'a' ? nB : nA;
    const lines = ['<b>Pour cette stratégie, « ' + nX + ' » est la meilleure méthode de retrait</b> sur ces ' + keys.length + ' simulation' + (keys.length > 1 ? 's' : '') + ' (équilibre entre ce qui est gagné au total, le risque et la préservation du capital).'];
    if (Y.wd > X.wd * 1.05) lines.push('« ' + nY + ' » retire plus d\'argent (' + money.format(Y.wd) + ' contre ' + money.format(X.wd) + '), mais ' + (Y.kept < X.kept ? 'préserve moins souvent le capital de départ (' + Y.kept + ' contre ' + X.kept + ')' : Y.ret < X.ret ? 'son résultat global est moins bon (' + pc(Y.ret) + ' contre ' + pc(X.ret) + ')' : 'avec plus de risque') + '.');
    else if (X.wd > Y.wd * 1.05) lines.push('« ' + nX + ' » retire aussi plus d\'argent : ' + money.format(X.wd) + ' contre ' + money.format(Y.wd) + '.');
    if (Math.abs(a.ret - b.ret) < 2 && Math.abs(a.wd - b.wd) < 0.05 * Math.max(a.wd, b.wd, 1)) lines.push('Les deux méthodes donnent des résultats très proches : choisissez selon le rythme de retrait qui vous convient.');
    if (X.ruined) lines.push('Attention : même avec « ' + nX + ' », ' + X.ruined + ' simulation' + (X.ruined > 1 ? 's finissent' : ' finit') + ' sous la moitié du capital de départ.');
    if (keys.length < 5) lines.push('Peu de simulations : élargissez la sélection (Tout le batch) pour une conclusion plus sûre.');
    h += '<div class="modal-note wd-cmp-note">' + lines.map((x) => '<p>' + x + '</p>').join('') + '</div>' +
      '<div class="fx-save"><button type="button" class="primary small" id="wdFxSave">💼 Enregistrer un FX</button><span class="hint">Plan d\'investissement à présenter à un client : stratégie, capital, probabilité, confiance, risque, durée et retrait « ' + esc(best === 'a' ? c.A.name : c.B.name) + ' ».</span></div>';
    h += '<div class="table-wrap"><table class="ana-table wd-cmp-table"><thead><tr><th>Critère</th><th class="wd-a"><i class="wd-dot a"></i>' + nA + '</th><th class="wd-b"><i class="wd-dot b"></i>' + nB + '</th></tr></thead><tbody>' +
      rows.map((r) => '<tr><td>' + r[0] + '</td>' + cell(r[1], r[2], r[3], r[4], 'a') + cell(r[2], r[1], r[3], r[4], 'b') + '</tr>').join('') + '</tbody></table></div>';
    h += '<div class="eval-charts-grid wd-charts">' +
      '<section class="eval-chart"><h4>Résultat par simulation (compte + retraits)</h4><p class="hint">Plein : A ; pointillé : B.</p><div id="wdCmpRet"></div></section>' +
      '<section class="eval-chart"><h4>Somme retirée par simulation</h4><p class="hint">Plein : A ; pointillé : B.</p><div id="wdCmpWd"></div></section>' +
      '<section class="eval-chart"><h4>Compte final (% du capital de départ)</h4><p class="hint">Plein : A ; pointillé : B. Au-dessus de 100 % : capital intact.</p><div id="wdCmpFinal"></div></section>' +
      '<section class="eval-chart"><h4>Évolution moyenne, mois par mois</h4><p class="hint">En % du capital : compte et retraits cumulés de A et de B.</p><div id="wdCmpCurve"></div>' +
      '<div class="legend"><span><i style="background:var(--accent)"></i>Compte A</span><span><i style="background:#d97706"></i>Compte B</span><span><i style="background:#60a5fa"></i>Retraits A</span><span><i style="background:#fbbf24"></i>Retraits B</span></div></section></div>';
    h += '<div class="table-wrap"><table class="eval wd-cmp-sims"><thead><tr><th>#</th><th class="l">Période</th><th class="wd-a">Retiré A</th><th class="wd-b">Retiré B</th><th class="wd-a">Résultat A</th><th class="wd-b">Résultat B</th><th class="wd-a">Compte final A</th><th class="wd-b">Compte final B</th><th>Meilleure</th></tr></thead><tbody>' +
      RA.map((r, i) => { const q = RB[i], sa = r.w.ret - 0.5 * r.w.dd + (r.w.final >= r.capital ? 10 : 0), sb = q.w.ret - 0.5 * q.w.dd + (q.w.final >= q.capital ? 10 : 0);
        return '<tr><td>' + r.idx + '</td><td class="l">' + frDate(r.from) + ' → ' + frDate(r.to) + '</td><td>' + money.format(r.w.wd) + '</td><td>' + money.format(q.w.wd) + '</td><td class="' + cls(r.w.ret) + '">' + pc(r.w.ret) + '</td><td class="' + cls(q.w.ret) + '">' + pc(q.w.ret) + '</td>' +
          '<td class="' + (r.w.final >= r.capital ? 'pos' : 'neg') + '">' + money.format(r.w.final) + '</td><td class="' + (q.w.final >= q.capital ? 'pos' : 'neg') + '">' + money.format(q.w.final) + '</td><td><b>' + (Math.abs(sa - sb) < 0.5 ? '=' : sa > sb ? 'A' : 'B') + '</b></td></tr>'; }).join('') + '</tbody></table></div>';
    st.cmpRows = { RA: RA, RB: RB };
    return h + '</section>';
  }
  function mountWdCompare(st) {
    const R = st.cmpRows;
    if (!R || !$('wdCmpRet')) return;
    const { RA, RB } = R, labels = RA.map((r) => '#' + r.idx);
    const pair = (id, va, vb, fmt, tt) => F.chart.mountBars($(id), { labels: labels, values: va, format: fmt, height: 190, ghosts: vb.map((v, i) => ({ i: i, value: v, kind: v >= 0 ? 'up' : 'blue' })), titles: labels.map((l, i) => tt(i)) });
    const abs = RA.map((r) => Math.abs(r.w.ret)).concat(RB.map((r) => Math.abs(r.w.ret))).sort((x, y) => x - y), cap = Math.max(20, 2 * (abs[Math.floor(abs.length * 0.9)] || 20)), clip = (v) => Math.max(-cap, Math.min(cap, v));
    pair('wdCmpRet', RA.map((r) => clip(r.w.ret)), RB.map((r) => clip(r.w.ret)), (v) => num1.format(v) + ' %', (i) => labels[i] + ' · A ' + signed(RA[i].w.ret, num1) + ' % · B ' + signed(RB[i].w.ret, num1) + ' %');
    pair('wdCmpWd', RA.map((r) => r.w.wd), RB.map((r) => r.w.wd), wdCompact, (i) => labels[i] + ' · A ' + money.format(RA[i].w.wd) + ' · B ' + money.format(RB[i].w.wd));
    pair('wdCmpFinal', RA.map((r) => (r.w.final / r.capital) * 100 - 100), RB.map((r) => (r.w.final / r.capital) * 100 - 100), (v) => num1.format(v + 100) + ' %', (i) => labels[i] + ' · A ' + num1.format((RA[i].w.final / RA[i].capital) * 100) + ' % · B ' + num1.format((RB[i].w.final / RB[i].capital) * 100) + ' %');
    const M = Math.max(...RA.concat(RB).map((r) => r.curve.length));
    const avgAt = (L, k, f) => { const v = L.filter((r) => r.curve.length > k).map((r) => f(r.curve[k])); return v.length ? mean(v) : NaN; };
    const lab = [], s = [[], [], [], []];
    for (let k = 0; k < M; k++) { lab.push('M' + (k + 1)); s[0].push(avgAt(RA, k, (p) => p.acc)); s[1].push(avgAt(RB, k, (p) => p.acc)); s[2].push(avgAt(RA, k, (p) => p.wd)); s[3].push(avgAt(RB, k, (p) => p.wd)); }
    F.chart.mount($('wdCmpCurve'), { labels: lab, panels: [{ height: 210, format: (v) => num1.format(v) + ' %', refLines: [{ value: 100, color: 'var(--muted)' }],
      series: [{ name: 'Compte A', values: s[0], color: 'var(--accent)', width: 2 }, { name: 'Compte B', values: s[1], color: '#d97706', width: 2 }, { name: 'Retraits A', values: s[2], color: '#60a5fa', width: 1.5, dash: '5 3' }, { name: 'Retraits B', values: s[3], color: '#fbbf24', width: 1.5, dash: '5 3' }] }],
      ariaLabel: 'Compte et retraits cumulés moyens des deux mécaniques' });
  }
  // ---------- FX : plan d'investissement présentable à un client ----------
  const FX_KEY = 'forexia.fx';
  let fxMem = null;
  const fxList = () => { try { const l = JSON.parse(localStorage.getItem(FX_KEY)); return Array.isArray(l) ? l : []; } catch (e) { return fxMem || []; } };
  function setFxList(l) { fxMem = l; const ok = lsSet(FX_KEY, JSON.stringify(l)); if (!ok) lsFullToast('le FX'); updateFxCount(); return ok; }
  function updateFxCount() { if ($('fxCount')) $('fxCount').textContent = fxList().length; }
  const pctile = (a, q) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); if (!v.length) return NaN; const k = (v.length - 1) * q, lo = Math.floor(k), hi = Math.ceil(k); return v[lo] + (v[hi] - v[lo]) * (k - lo); };
  // Nom des devises pour la phrase « Le principe »
  const CUR_NAME = { EUR: 'l\'euro', USD: 'le dollar', GBP: 'la livre sterling', JPY: 'le yen', CHF: 'le franc suisse', CAD: 'le dollar canadien', AUD: 'le dollar australien', NZD: 'le dollar néo-zélandais' };
  function fxPrinciple(strat, pair) { return F.fxcore.fxPrinciple(strat, pair); }
  /** Note de risque de 1 (très faible) à 7 (très élevé), d'après les pertes possibles et les baisses en cours de route. */
  function fxRiskNote(loss10, ddMed, worstLoss) { return F.fxcore.fxRiskNote(loss10, ddMed, worstLoss); }
  /** FX à partir des simulations relancées avec une mécanique de retrait (rows : voir wdRow). */
  function fxFromRows(R, meta) { return F.fxcore.fxFromRows(R, meta); }
  const NO_WD = 'pas de retrait partiel durant la période de trading';
  const wdNone = (w) => !w || w.on === false || w.mode === 'none';
  /** Enregistre un FX construit à partir de simulations relancées (rows) et d'une mécanique (sans retrait possible). */
  function saveFxRows(R, mech, other) {
    if (!R || !R.length) return toast('Aucune simulation calculée pour ce FX.', false);
    const all = evalList(), sims = R.map((r) => all.find((e) => e.key === r.key)), first = sims.find(Boolean) || {};
    const fx = fxFromRows(R, { name: first.name, strategy: first.strategy, config: first.config, pair: first.pair, leverage: first.leverage, dataLabel: first.data,
      synthetic: sims.some((e) => e && /simul/i.test(e.data || '')), mech: mech, other: other || null, keys: R.map((r) => r.key) });
    if (wdNone(mech.w)) { fx.income = Object.assign(fx.income, { desc: NO_WD, perMonthPct: 0, fixedPct: null, other: other ? other.name : null }); fx.name = 'FX ' + (first.name || 'stratégie') + ' · sans retrait'; }
    else if (!other) fx.income.other = null;
    const name = (prompt('Nom du FX (plan d\'investissement) :', fx.name) || '').trim().slice(0, 80);
    if (!name) return;
    fx.name = name;
    if (!setFxList(fxList().concat(fx)) || !fxList().some((x) => x.id === fx.id)) return;
    logEvent('fx.saved', 'FX enregistré : ' + name, { id: fx.id });
    toast('FX « ' + name + ' » enregistré.', false);
    // la liste des FX s'ouvre sur le nouveau plan
    openFx();
    const card = $('fxBody').querySelector('.fx-card[data-fx="' + fx.id + '"]');
    if (card) { card.classList.add('fx-new'); card.scrollIntoView({ block: 'start' }); setTimeout(() => card.classList.remove('fx-new'), 2500); }
  }
  function saveFxFromCompare() {
    const c = wdState.cmp;
    if (!c || c.status !== 'done' || !wdState.cmpRows) return;
    const best = c.bestSide === 'b' ? 'b' : 'a', mech = best === 'a' ? c.A : c.B, other = best === 'a' ? c.B : c.A;
    saveFxRows(best === 'a' ? wdState.cmpRows.RA : wdState.cmpRows.RB, mech, other);
  }
  // ----- Fenêtre « FX » : les plans sous forme de cartes -----
  const stars = (score) => { const s = Math.round(score / 20 * 2) / 2; let h = ''; for (let i = 1; i <= 5; i++) h += '<span class="fx-star ' + (s >= i ? 'on' : s >= i - 0.5 ? 'half' : '') + '">★</span>'; return h; };
  const confLabel = (s) => (s >= 80 ? 'Très élevé' : s >= 65 ? 'Élevé' : s >= 50 ? 'Moyen' : s >= 35 ? 'Faible' : 'Très faible');
  const riskLevel = (lossPct) => (lossPct <= 10 ? ['Faible', 'low'] : lossPct <= 30 ? ['Modéré', 'mid'] : ['Élevé', 'high']);
  const durTxt = (m) => (m >= 12 && m % 12 === 0 ? m / 12 + ' an' + (m > 12 ? 's' : '') : m + ' mois');
  function fxCardHtmlV1(fx) { // FX enregistrés avant la version 2
    const p = fx.probability, r = fx.risk, c = fx.confidence, lossPct = 100 - r.p10, [rl, rc] = riskLevel(lossPct);
    const row = (k, v, sub, tip) => '<div class="fx-row"' + (tip ? ' title="' + esc(tip) + '"' : '') + '><span class="fx-k">' + k + '</span><span class="fx-v">' + v + (sub ? '<small>' + sub + '</small>' : '') + '</span></div>';
    const tipConf = 'Score ' + c.score + '/100 : nombre de simulations ' + Math.round(c.parts.echantillon) + '/20, réussite ' + Math.round(c.parts.reussite) + '/25, régularité ' + Math.round(c.parts.regularite) + '/15, risque ' + Math.round(c.parts.risque) + '/20, capital préservé ' + Math.round(c.parts.capital) + '/10, diversité des périodes ' + Math.round(c.parts.periodes) + '/10.';
    return '<article class="fx-card" data-fx="' + esc(fx.id) + '"><header><textarea class="fx-name" rows="2" data-fx-name="' + esc(fx.id) + '" aria-label="Nom du FX" title="Cliquez pour modifier le nom" spellcheck="false">' + esc(fx.name) + '</textarea><span class="fx-badge">FX</span></header>' +
      row('Stratégie', esc(fx.strategy.name), esc([fx.strategy.pair, fx.strategy.leverage ? 'levier 1:' + fx.strategy.leverage : ''].filter(Boolean).join(' · '))) +
      row('Capital à investir', money.format(fx.capital)) +
      row('Probabilité', '<b class="' + (p.winRate >= 50 ? 'pos' : 'neg') + '">' + Math.round(p.winRate) + ' %</b> de réussite × gain moyen <b class="' + cls(p.gainMoy) + '">' + signed(p.gainMoy, num1) + ' %</b>',
        'quand ça gagne : ' + signed(p.gainWin, num1) + ' % · quand ça perd : ' + signed(p.lossMoy, num1) + ' %', 'Sur ' + fx.n + ' simulations, retraits compris (compte final + sommes retirées).') +
      row('Taux de confiance', '<span class="fx-stars">' + stars(c.score) + '</span> <b>' + c.score + '/100</b>', confLabel(c.score), tipConf) +
      row('Risque', '<span class="fx-risk ' + rc + '">' + rl + '</span> · capital restitué au moins <b>' + money.format((fx.capital * Math.min(100, r.p10)) / 100) + '</b>',
        'dans 9 cas sur 10 (perte possible ' + money.format(r.atRisk) + ') · pire cas testé : ' + money.format((fx.capital * r.worst) / 100) + ' restitués', 'Capital à restituer au client dans un mauvais scénario : ce qu\'il récupère (compte + retraits) dans les 10 % de simulations les plus défavorables.') +
      row('Durée recommandée', '<b>' + durTxt(fx.duration.reco) + '</b>', 'testé de ' + durTxt(fx.duration.min) + ' à ' + durTxt(fx.duration.max)) +
      row('Retrait type', '<b>' + esc(fx.withdraw.desc) + '</b>', 'rente ≈ ' + num1.format(fx.withdraw.yearly) + ' % du capital par an · ≈ ' + money.format(fx.withdraw.perMonth) + ' / mois · meilleure que « ' + esc(fx.withdraw.other) + ' »') +
      '<footer><span class="hint">' + fx.n + ' simulations · ' + fx.years[0] + '–' + fx.years[1] + ' · ' + esc(fx.strategy.dataLabel || '') + ' · créé le ' + new Date(fx.createdAt).toLocaleDateString('fr-FR') + '</span>' +
      '<span class="fx-acts">' + (fx.strategy.data ? '<button type="button" class="secondary small" data-fx-load="' + esc(fx.id) + '" title="Charger la stratégie et ouvrir les simulations de ce FX dans l\'évaluation (recalculées si besoin)">📂 Voir les simulations</button>' +
        '<button type="button" class="secondary small" data-fx-ea="' + esc(fx.id) + '" title="Télécharger l\'Expert Advisor MetaTrader 5 de ce FX (stratégie, paire, levier, capital)">⬇ EA (.mq5)</button>' : '') +
      '<button type="button" class="ghost small" data-fx-del="' + esc(fx.id) + '" title="Supprimer ce FX" aria-label="Supprimer">🗑</button></span></footer></article>';
  }
  let FX_BASE = 10000; // capital du FX en cours d'affichage (les montants sont calculés pour ce capital)
  const FX_CUR = 'EUR'; // devise affichée sur les FX (paramétrable plus tard)
  const money0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: FX_CUR, minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fxMoney = (pct) => money0.format(Math.round((FX_BASE * pct) / 100));
  const durTxt2 = (m) => (m >= 12 && m % 12 === 0 ? m / 12 + ' an' + (m > 12 ? 's' : '') : m + ' mois');
  /** Sur 10 cas : pastilles vertes (gagnant) et rouges (perdant). */
  function fxTenSvg(winRate) {
    const w = Math.round(winRate / 10);
    let g = '';
    for (let i = 0; i < 10; i++) {
      const x = 14 + i * 26, on = i < w;
      g += '<g class="' + (on ? 'win' : 'lose') + '"><circle cx="' + x + '" cy="9" r="6"/><path d="M' + (x - 9) + ' 30 q9 -14 18 0z"/></g>';
    }
    return '<svg class="fx-ten" viewBox="0 0 264 32" role="img" aria-label="' + w + ' cas gagnants sur 10">' + g + '</svg>';
  }
  /** Fourchette des scénarios : du pire cas au scénario favorable, avec le capital investi. */
  /** Détail par simulation d'un FX, rangé du pire au meilleur, en % du capital : b = récupéré (compte + revenus),
   *  inc = revenu moyen par mois, tot = revenus touchés au total, acc = reste sur le compte, y1 = gain au bout d'un an. */
  function fxSimsFromRows(R) { return F.fxcore.fxSimsFromRows(R); }
  /** Simulations d'un FX. FX enregistré sans ce détail : retrouvées dans les résultats de retrait gardés (même
   *  mécanique, même stratégie, même capital) ; à défaut, reconstituées à partir de ses résultats. */
  function fxSims(fx) {
    if (fx.sims && fx.sims.length && fx.sims[0].mr) return fx.sims;
    if (fx._sims) return fx._sims;
    const w = fx.income ? fx.income.w : fx.withdraw && fx.withdraw.w;
    if (w) {
      const cache = wdResStore.get(), pre = wdKey(w) + '#', all = evalList();
      const R = Object.keys(cache).filter((k) => k.startsWith(pre)).map((k) => cache[k])
        .filter((r) => { const e = all.find((x) => x.key === r.key); return e && e.name === fx.strategy.name && Math.abs(r.capital - fx.capital) <= fx.capital * 0.01; });
      if (R.length >= 2) return (fx._sims = fxSimsFromRows(R));
    }
    if (fx.sims && fx.sims.length) return (fx._sims = fx.sims);
    if (!fx.outcomes || !fx.outcomes.length) return null;
    const m = Math.max(1, (fx.duration && fx.duration.reco) || 12), inc = fx.income.fixedPct != null ? fx.income.fixedPct : fx.income.perMonthPct;
    return (fx._sims = fx.outcomes.map((b) => ({ m: m, b: b, inc: inc, tot: inc * m, acc: b - inc * m, y1: (Math.pow(Math.max(0.0001, b / 100), 12 / m) - 1) * 100, est: true, approx: true })));
  }
  /** Scénario au rang q (0 = pire cas, 1 = meilleur cas), interpolé entre les simulations rangées. */
  function fxPoint(fx, q) {
    const S = fxSims(fx);
    if (!S || !S.length) return { b: fx.scenarios.med, inc: fx.income.perMonthPct, y1: fx.annual, est: true };
    const t = Math.max(0, Math.min(1, q)) * (S.length - 1), i = Math.floor(t), f = t - i, a = S[i], b = S[Math.min(S.length - 1, i + 1)];
    const lerp = (k) => a[k] + (b[k] - a[k]) * f;
    return { b: lerp('b'), inc: lerp('inc'), tot: a.tot != null ? lerp('tot') : null, acc: a.acc != null ? lerp('acc') : null, y1: lerp('y1'),
      y1b: a.y1b != null && b.y1b != null ? lerp('y1b') : null, m: a.m != null && b.m != null ? Math.round(lerp('m')) : null, est: a.est || b.est, approx: !!a.approx };
  }
  /** Rang q d'un résultat v (inverse de fxPoint). */
  function fxRank(fx, v) {
    const S = fxSims(fx);
    if (!S || S.length < 2) return 0.5;
    if (v <= S[0].b) return 0;
    for (let i = 0; i < S.length - 1; i++) if (v <= S[i + 1].b) return (i + (S[i + 1].b > S[i].b ? (v - S[i].b) / (S[i + 1].b - S[i].b) : 0)) / (S.length - 1);
    return 1;
  }
  const fxQ = new Map(); // rang choisi pour chaque carte (médian par défaut)
  const fxRange = (fx) => { const sc = fx.scenarios, top = fxSims(fx) ? fxPoint(fx, 0.95).b : sc.p90; return { lo: Math.min(sc.worst, 100) - 4, hi: Math.max(sc.p90, top, 100) + 4 }; };
  function fxScenarioSvg(sc, fx) {
    const W = 360, rg = fxRange(fx), lo = rg.lo, hi = rg.hi, x = (v) => 12 + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (W - 24);
    const pt = fxPoint(fx, fxQ.has(fx.id) ? fxQ.get(fx.id) : 0.5);
    const dot = (v, cls) => '<circle class="sc ' + cls + '" cx="' + x(v).toFixed(1) + '" cy="30" r="' + (cls === 'med' ? 8 : 6) + '"/>';
    return '<svg class="fx-sc" viewBox="0 0 ' + W + ' ' + (fxSims(fx) ? 64 : 46) + '" role="img" aria-label="Scénarios pour ' + money0.format(FX_BASE) + ' investis">' +
      '<defs><linearGradient id="fxGrad" x1="0" x2="1"><stop offset="0" stop-color="var(--down)"/><stop offset=".5" stop-color="#f59e0b"/><stop offset="1" stop-color="var(--up)"/></linearGradient></defs>' +
      '<rect x="' + x(sc.worst).toFixed(1) + '" y="26" width="' + Math.max(2, x(sc.p90) - x(sc.worst)).toFixed(1) + '" height="8" rx="4" fill="url(#fxGrad)" opacity=".85"/>' +
      '<line class="sc-cap" x1="' + x(100).toFixed(1) + '" x2="' + x(100).toFixed(1) + '" y1="14" y2="44"/><text x="' + x(100).toFixed(1) + '" y="10" text-anchor="middle" class="sc-cap-l">investi ' + money0.format(FX_BASE) + '</text>' +
      dot(sc.worst, 'worst') + dot(sc.p10, 'p10') + dot(sc.p90, 'p90') + dot(sc.med, 'med') +
      (fxSims(fx) ? '<rect class="sc-hit" data-fx-hit="' + esc(fx.id) + '" x="0" y="10" width="' + W + '" height="54"/>' +
        '<g class="sc-handle" data-fx-h="' + esc(fx.id) + '" transform="translate(' + x(pt.b).toFixed(1) + ' 0)"><line x1="0" x2="0" y1="16" y2="44"/><circle cx="0" cy="30" r="12"/><circle class="in" cx="0" cy="30" r="4.5"/>' +
          '<text class="sc-drag" x="0" y="58" text-anchor="middle">◀ glissez ▶</text></g>' : '') + '</svg>' +
      '<div class="fx-sc-vals">' + [['worst', 'Au pire', sc.worst], ['p10', 'Si ça se passe mal', sc.p10], ['med', 'Le plus souvent', sc.med], ['p90', 'Si ça se passe bien', sc.p90]].map(([c, l, v]) =>
        '<div><i class="' + c + '"></i><span>' + l + '</span><b class="' + (v >= 100 ? 'pos' : 'neg') + '">' + fxMoney(v) + '</b></div>').join('') + '</div>' +
      (fxSims(fx) ? '<div class="fx-pick" data-fx-pick="' + esc(fx.id) + '">' + fxPickHtml(fx, fxQ.has(fx.id) ? fxQ.get(fx.id) : 0.5) + '</div>' : '');
  }
  // gain au bout d'un an, en % : avec retrait (compte + revenus touchés) et sans retrait
  const fxGainEur = (pct) => ' (' + signed((FX_BASE * pct) / 100, money0) + ')';
  // capital au bout d'un an (compte + revenus touchés), suivi de l'évolution en %
  const fxCap1 = (pct) => money0.format(Math.round(FX_BASE * (1 + pct / 100))) + ' <span class="' + cls(pct) + '">(' + signed(pct, num1) + ' %)</span>';
  const fxY1Html = (pt) => fxCap1(pt.y1);
  const fxY1Sub = (pt) => (pt.y1b != null ? 'sans retrait : <b>' + fxCap1(pt.y1b) + '</b>' : '');
  /** Manière de retirer, en clair (ex. « Retrait de l'excédent (50 %) »). */
  function fxMethodLabel(w) {
    if (!w || !w.on) return 'Sans retrait';
    if (w.mode !== 'periodic') return 'Retrait au seuil de +' + w.pct + ' % de gain' + (Number(w.share) < 100 ? ' (' + w.share + ' % du gain)' : '');
    const when = w.every === 'days' ? ' tous les ' + Math.max(15, Number(w.days) || 30) + ' jours' : ' chaque mois';
    return w.type === 'excess' ? 'Retrait de l\'excédent (' + w.value + ' %)' + when : w.type === 'fixed' ? 'Retrait d\'une somme fixe' + when : 'Retrait de ' + w.value + ' % du compte' + when;
  }
  function fxScenarioName(q) {
    const better = Math.round((1 - q) * 10);
    return q <= 0.02 ? 'au pire' : Math.abs(q - 0.5) < 0.03 ? 'le plus souvent' : q <= 0.12 ? 'si ça se passe mal' : q >= 0.98 ? 'au mieux' : q >= 0.88 ? 'si ça se passe bien' : better + ' chance' + (better > 1 ? 's' : '') + ' sur 10 de faire mieux';
  }
  function fxPickHtml(fx, q) {
    const pt = fxPoint(fx, q), y1 = (FX_BASE * pt.y1) / 100;
    const nm = fxScenarioName(q);
    return '<span class="fx-pick-name">' + nm.charAt(0).toUpperCase() + nm.slice(1) + '</span>' +
      '<span>Au bout de la durée (' + fx.duration.reco + ' mois) : <b class="' + (pt.b >= 100 ? 'pos' : 'neg') + '">' + fxMoney(pt.b) + '</b></span>' +
      (wdNone(fx.income && fx.income.w) ? '<span>Au bout d\'un an : <b class="' + cls(pt.y1) + '">' + signed(pt.y1, num1) + ' %' + fxGainEur(pt.y1) + '</b>' + (pt.est ? ' <small>estimé</small>' : '') + '</span><span>Aucun retrait pendant la période : tout reste sur le compte.</span>' :
      '<span>Revenu : <b>≈ ' + fxMoney(pt.inc) + ' / mois</b>' + (pt.approx ? ' <small>(moyenne du plan)</small>' : '') + '</span>' +
      (pt.tot != null ? '<span>Revenus touchés au total : <b>' + fxMoney(pt.tot) + '</b></span><span>Reste sur le compte : <b class="' + (pt.acc >= 100 ? 'pos' : 'neg') + '">' + fxMoney(pt.acc) + '</b></span>' : '') +
      '<span>Au bout d\'un an : <b class="' + cls(pt.y1) + '">' + signed(pt.y1, num1) + ' %' + fxGainEur(pt.y1) + '</b> avec retrait' + (pt.y1b != null ? ' · <b class="' + cls(pt.y1b) + '">' + signed(pt.y1b, num1) + ' %' + fxGainEur(pt.y1b) + '</b> sans retrait' : '') + (pt.est ? ' <small>estimé</small>' : '') + '</span>');
  }
  /** Met à jour la carte quand on déplace le point (sans tout redessiner). */
  function fxSetQ(id, q) {
    const fx = fxFind(id), card = document.querySelector('.fx-card[data-fx="' + id + '"]');
    if (!fx || !card) return;
    fxQ.set(id, q); FX_BASE = fxInvest(fx);
    const pt = fxPoint(fx, q), rg = fxRange(fx), x = 12 + ((Math.max(rg.lo, Math.min(rg.hi, pt.b)) - rg.lo) / (rg.hi - rg.lo)) * 336;
    const h = card.querySelector('.sc-handle'); if (h) h.setAttribute('transform', 'translate(' + x.toFixed(1) + ' 0)');
    const pk = card.querySelector('.fx-pick'); if (pk) pk.innerHTML = fxPickHtml(fx, q);
    const y1 = (FX_BASE * pt.y1) / 100;
    const d = (k) => card.querySelector('[data-fx-d="' + k + '"]');
    if (d('y1')) d('y1').innerHTML = fxY1Html(pt);
    if (d('y1s')) d('y1s').innerHTML = fxY1Sub(pt);
    if (d('inc') && !wdNone(fx.income && fx.income.w)) d('inc').textContent = '≈ ' + fxMoney(pt.inc) + ' / mois';
  }
  /** Évolution typique de 10 000 : fourchette (1 cas sur 10 fait pire / mieux), cas médian et revenus déjà touchés. */
  function fxPathSvg(path) {
    if (!path || path.length < 2) return '';
    const W = 360, H = 150, L = 46, Rm = 8, T = 10, B = 22, n = path.length;
    const lo = Math.min(...path.map((p) => p.p10), 0, 100) , hi = Math.max(...path.map((p) => p.p90), 100);
    const x = (k) => L + (k / (n - 1)) * (W - L - Rm), y = (v) => T + ((hi - v) / (hi - lo || 1)) * (H - T - B);
    const line = (f) => path.map((p, k) => (k ? 'L' : 'M') + x(k).toFixed(1) + ' ' + y(f(p)).toFixed(1)).join('');
    const band = line((p) => p.p90) + path.slice().reverse().map((p, k) => 'L' + x(n - 1 - k).toFixed(1) + ' ' + y(p.p10).toFixed(1)).join('') + 'Z';
    const wdArea = line((p) => p.wd) + 'L' + x(n - 1).toFixed(1) + ' ' + y(0).toFixed(1) + 'L' + x(0).toFixed(1) + ' ' + y(0).toFixed(1) + 'Z';
    const tick = (v) => { const amt = (FX_BASE * v) / 100; return '<text x="' + (L - 4) + '" y="' + (y(v) + 3).toFixed(1) + '" text-anchor="end" class="ax">' + (amt >= 10000 ? num1.format(amt / 1000) + ' k' : Math.round(amt)) + '</text>'; };
    const last = path[n - 1];
    return '<svg class="fx-path" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Évolution typique de 10 000 investis">' +
      '<path class="band" d="' + band + '"/><path class="wd" d="' + wdArea + '"/>' +
      '<line class="cap" x1="' + L + '" x2="' + (W - Rm) + '" y1="' + y(100).toFixed(1) + '" y2="' + y(100).toFixed(1) + '"/>' +
      '<path class="med" d="' + line((p) => p.med) + '"/>' + tick(100) + tick(0) + (hi > 130 ? tick(Math.round(hi / 10) * 10) : '') +
      '<circle class="med-end" cx="' + x(n - 1).toFixed(1) + '" cy="' + y(last.med).toFixed(1) + '" r="3.5"/>' +
      '<text x="' + L + '" y="' + (H - 6) + '" class="ax">mois 1</text><text x="' + (W - Rm) + '" y="' + (H - 6) + '" text-anchor="end" class="ax">mois ' + n + '</text></svg>' +
      '<div class="fx-legend"><span><i class="l-med"></i>le plus souvent (compte + revenus)</span><span><i class="l-band"></i>zone où se trouvent 8 essais sur 10</span><span><i class="l-wd"></i>revenus déjà touchés</span></div>';
  }
  function fxRiskScale(note) {
    let h = '<div class="fx-scale" title="Note de risque de 1 (très faible) à 7 (très élevé)">';
    for (let i = 1; i <= 7; i++) h += '<span class="s' + i + (i === note ? ' on' : '') + '">' + i + '</span>';
    return h + '</div>';
  }
  const RISK_TXT = ['', 'très faible', 'faible', 'modéré', 'moyen', 'assez élevé', 'élevé', 'très élevé'];
  // capital choisi pour la carte : au moins le capital du plan (montant minimum testé)
  const fxInvest = (fx) => Math.max(fx.capital, Number(fx.invest) || fx.capital);
  const fxStep = (c) => (c >= 20000 ? 1000 : c >= 2000 ? 100 : 10);
  function fxCardHtml(fx) {
    if (fx.v !== 2) return fxCardHtmlV1(fx);
    FX_BASE = fxInvest(fx); // tous les montants de la carte sont pour le capital choisi (au moins le capital du plan)
    const sc = fx.scenarios, sol = fx.solidity, inc = fx.income, cd = fx.conditions;
    const kf = (k, v, sub, dk) => '<div class="fx-kf"><span>' + k + '</span><b' + (dk ? ' data-fx-d="' + dk + '"' : '') + '>' + v + '</b>' + (sub ? '<small' + (dk ? ' data-fx-d="' + dk + 's"' : '') + '>' + sub + '</small>' : '') + '</div>';
    const q0 = fxQ.has(fx.id) ? fxQ.get(fx.id) : 0.5, pt0 = fxPoint(fx, q0), y1v = (FX_BASE * pt0.y1) / 100;
    const noWd = wdNone(inc.w);
    const incomeTxt = inc.w.mode === 'periodic' && inc.w.type === 'fixed' ? '≈ ' + fxMoney(inc.fixedPct) + ' / mois' : '≈ ' + fxMoney(inc.perMonthPct) + ' / mois en moyenne';
    const incomeSub = (inc.w.mode === 'periodic' && inc.w.type === 'excess' ? 'part des gains au-dessus du capital : variable, parfois nul' : inc.w.mode === 'periodic' && inc.w.type === 'fixed' ? 'somme fixe : ' + num1.format(inc.fixedPct) + ' % du capital par mois, soit ' + fxMoney(inc.fixedPct) + ' pour ' + money0.format(FX_BASE) : inc.desc) +
      ' · capital préservé ' + inc.kept + ' fois sur ' + fx.n;
    const solTxt = 'testé sur ' + fx.n + ' périodes de ' + fx.years[0] + ' à ' + fx.years[1] + ' · ' + sol.eraWin + ' époque' + (sol.eraWin > 1 ? 's' : '') + ' gagnante' + (sol.eraWin > 1 ? 's' : '') + ' sur ' + sol.eras;
    const tipSol = 'Solidité ' + sol.score + '/100 : simulations ' + Math.round(sol.parts.simulations) + '/30, années couvertes ' + Math.round(sol.parts.annees) + '/25, époques ' + Math.round(sol.parts.epoques) + '/20, régularité ' + Math.round(sol.parts.regularite) + '/15, données réelles ' + Math.round(sol.parts.donnees) + '/10.';
    return '<article class="fx-card fx2" data-fx="' + esc(fx.id) + '">' +
      '<header><textarea class="fx-name" rows="2" data-fx-name="' + esc(fx.id) + '" aria-label="Nom du FX" title="Cliquez pour modifier le nom" spellcheck="false">' + esc(fx.name) + '</textarea><span class="fx-badge">FX</span></header>' +
      (sol.synthetic ? '<p class="fx-warn">⚠ Construit sur des données simulées : à refaire avec les cours réels (MT5) avant de le présenter à un client.</p>' : '') +
      '<p class="fx-principle"><b>Le principe :</b> ' + esc(fx.principle) + ' <small>(' + esc(fx.strategy.name) + ' · ' + esc(fx.strategy.pair) + ')</small></p>' +
      '<div class="fx-kfs">' + '<div class="fx-kf fx-invest"><span>Capital investi</span><label class="fx-inv"><input type="number" inputmode="numeric" data-fx-invest="' + esc(fx.id) + '" min="' + Math.ceil(fx.capital) + '" step="' + fxStep(fx.capital) + '" value="' + Math.round(FX_BASE) + '" aria-label="Capital investi (minimum ' + money0.format(fx.capital) + ')"><b>€</b></label><small>minimum ' + money0.format(fx.capital) + ' · modifiable</small></div>' + kf('Durée recommandée', durTxt2(fx.duration.reco), 'testé de ' + durTxt2(fx.duration.min) + ' à ' + durTxt2(fx.duration.max)) +
        (noWd ? kf('Capital au bout d\'un an', fxY1Html(pt0), '', 'y1') + kf('Revenu régulier', 'Aucun', 'pas de retrait partiel : tout reste sur le compte jusqu\'à la fin') :
        kf('Capital au bout d\'un an, avec retrait', fxY1Html(pt0), fxY1Sub(pt0), 'y1') +
        kf('Revenu régulier', fxSims(fx) ? '≈ ' + fxMoney(pt0.inc) + ' / mois' : incomeTxt, esc(fxMethodLabel(inc.w)), 'inc')) + '</div>' +
      '<section class="fx-sec"><h5>Chances de gain</h5><div class="fx-ten-row">' + fxTenSvg(fx.winRate) + '<span><b>' + Math.round(fx.winRate / 10) + ' fois sur 10</b> le plan finit gagnant<small>' + Math.round((fx.winRate * fx.n) / 100) + ' essais gagnants sur ' + fx.n + ' faits sur des périodes passées</small></span></div></section>' +
      '<section class="fx-sec"><h5>Ce que vous récupérez au bout de la durée recommandée (' + fx.duration.reco + ' mois)</h5><p class="hint">Pour ' + money0.format(FX_BASE) + ' investis, compte + revenus déjà touchés.</p>' + fxScenarioSvg(sc, fx) + '</section>' +
      '<section class="fx-sec"><h5>Évolution typique</h5>' + fxPathSvg(fx.path) + '</section>' +
      '<section class="fx-sec fx-two"><div><h5>Risque</h5>' + fxRiskScale(fx.riskNote) + '<small>' + RISK_TXT[fx.riskNote] + ' · pire moment en cours de route : en général <b>−' + num1.format(fx.drawdown.med) + ' %</b>, au pire −' + num1.format(fx.drawdown.max) + ' %</small></div>' +
        (() => { const cf = fxConfidence(fx); return '<div class="fx-conf" tabindex="0" aria-describedby="fxTip-' + esc(fx.id) + '"><h5>Score de confiance <span class="fx-info" aria-hidden="true">ⓘ</span></h5><span class="fx-stars">' + stars(cf.score) + '</span> <b>' + cf.score + '/100</b><small>' + solTxt + (sol.synthetic ? ' · données simulées' : '') + '</small>' +
          '<div class="fx-tip" role="tooltip" id="fxTip-' + esc(fx.id) + '">' + fxConfidenceTip(fx, cf) + '</div></div>'; })() + '</section>' +
      '<section class="fx-sec"><h5>Revenu régulier</h5><p class="fx-inc">' + (noWd ? '<b>' + esc(NO_WD.charAt(0).toUpperCase() + NO_WD.slice(1)) + '</b> — le capital et les gains restent sur le compte ; vous récupérez le tout à la fin (ou quand vous sortez).' :
        '<b>' + (inc.w.mode === 'periodic' && inc.w.type === 'fixed' ? fxMoney(inc.fixedPct) + ' chaque mois' : esc(inc.desc)) + '</b> — ' + incomeSub + '.') + (inc.other && inc.other !== '—' ? ' <small>Choisi par comparaison : meilleur que « ' + esc(inc.other) + ' ».</small>' : '') + '</p></section>' +
      '<section class="fx-sec"><h5>Conditions</h5><p class="fx-cond">' + [cd.leverage ? 'Levier 1:' + cd.leverage : '', cd.spread != null ? 'spread ' + num1.format(cd.spread) + ' pip' + (cd.spread > 1 ? 's' : '') + ' par trade' : '', cd.commission ? 'commission ' + num1.format(cd.commission) + ' par lot' : 'sans commission', 'données : ' + (cd.source || '—'), 'sortie possible à tout moment (positions fermées au prix du marché)'].filter(Boolean).map(esc).join(' · ') + '</p></section>' +
      '<p class="fx-disclaimer">Résultats de simulations passées, sans garantie pour l\'avenir. Vous pouvez perdre tout ou partie du capital investi.</p>' +
      '<footer><span class="hint">créé le ' + new Date(fx.createdAt).toLocaleDateString('fr-FR') + '</span><span class="fx-acts">' + (fx.strategy.data ? '<button type="button" class="secondary small" data-fx-load="' + esc(fx.id) + '" title="Charger la stratégie et ouvrir les simulations de ce FX dans l\'évaluation (recalculées si besoin)">📂 Voir les simulations</button>' +
        '<button type="button" class="secondary small" data-fx-ea="' + esc(fx.id) + '" title="Télécharger l\'Expert Advisor MetaTrader 5 de ce FX (stratégie, paire, levier, capital)">⬇ EA (.mq5)</button>' : '') +
      '<button type="button" class="ghost small" data-fx-del="' + esc(fx.id) + '" title="Supprimer ce FX" aria-label="Supprimer">🗑</button></span></footer></article>';
  }
  function openFx() {
    const l = fxList();
    $('fxBody').innerHTML = l.length ? '<div class="fx-grid">' + l.slice().reverse().map(fxCardHtml).join('') + '</div>' +
      '<p class="hint fx-note">Chiffres issus de simulations passées (backtests) : ils ne garantissent pas les résultats futurs. « Probabilité » et « Risque » comptent les retraits (compte final + sommes retirées).</p>'
      : '<p class="eval-empty">Aucun FX pour l\'instant. Utilisez le <b>⛏️ Chercheur de FX</b> ci-dessus, ou, dans Évaluation › « 💸 Resimuler avec un retrait », comparez deux mécaniques (⚖️ Comparer) puis cliquez sur « 💼 Enregistrer un FX ».</p>';
    $('fxModal').hidden = false; document.body.style.overflow = 'hidden';
  }
  function closeFx() { $('fxModal').hidden = true; if ($('evalModal').hidden && $('wdModal').hidden) document.body.style.overflow = ''; }
  $('fxBtn').addEventListener('click', openFx);
  $('fxModal').addEventListener('click', (ev) => {
    const t = ev.target;
    if (t.closest('[data-close]')) return closeFx();
    const del = t.closest('[data-fx-del]');
    if (del) { const fx = fxList().find((x) => x.id === del.dataset.fxDel); if (fx && confirm('Supprimer le FX « ' + fx.name + ' » ?')) { setFxList(fxList().filter((x) => x.id !== fx.id)); openFx(); } return; }
    const ld = t.closest('[data-fx-load]');
    if (ld) { const fx = fxFind(ld.dataset.fxLoad); if (fx) openFxSims(fx); return; }
    const ea = t.closest('[data-fx-ea]');
    if (ea) { const fx = fxFind(ea.dataset.fxEa); if (fx) downloadFxEa(fx); }
  });
  /** Remet la stratégie, le capital et le retrait du FX dans le formulaire. */
  function fxToForm(fx) {
    loadStrategy(fx.strategy.data); if (fx.strategy.config) applyConfig(fx.strategy.config);
    const wd = fx.v === 2 ? fx.income : fx.withdraw;
    $('capital').value = Math.round(fx.capital * 100) / 100;
    if (fx.strategy.leverage && LEVERAGES.includes(Number(fx.strategy.leverage))) $('leverage').value = String(fx.strategy.leverage);
    if (wd && wd.w && wd.w.on !== false && wd.w.type !== 'none') wdToForm(wd.w); else { $('withdrawOn').checked = false; updateWithdrawUI(); }
    $('preset').value = 'mine'; $('deleteStrat').hidden = true;
    $('presetDesc').textContent = 'FX « ' + fx.name + ' » : ' + fx.strategy.name + ', capital ' + money.format(fx.capital) + ', retrait ' + ((wd && wd.desc) || 'aucun') + ', durée recommandée ' + durTxt(fx.duration.reco) + '.';
    updateStyleHint();
  }
  /** Simulations du FX déjà dans l'historique : batch de l'agent, clés enregistrées, ou mêmes dates et même stratégie. */
  function fxExistingSims(fx) {
    const all = evalList(), byKey = new Map(all.map((e) => [e.key, e]));
    if (fx.batch) { const b = batchStore.get().find((x) => x.id === fx.batch); if (b && b.entries.length) return { batch: b }; }
    if (fx.keys && fx.keys.length) { const L = fx.keys.map((k) => byKey.get(k)).filter(Boolean); if (L.length >= Math.min(2, fx.keys.length)) return { entries: L }; }
    const S = (fx.sims || []).filter((x) => x.from && x.to), near = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) <= 6 * 864e5;
    if (S.length) {
      const L = [];
      for (const x of S) { const e = all.find((y) => y.name === fx.strategy.name && y.strategy && near(y.from, x.from) && near(y.to, x.to) && !L.includes(y)); if (e) L.push(e); }
      if (L.length >= Math.max(2, Math.ceil(S.length * 0.8))) return { entries: L };
    }
    return null;
  }
  /** « Voir les simulations » : charge le FX dans le formulaire et ouvre ses simulations dans l'évaluation (batch du FX). */
  async function openFxSims(fx) {
    if (checkRunning || batchRunning) return toast('Un calcul est déjà en cours : attendez la fin ou arrêtez-le.', false);
    if (!fx.strategy.data) return toast('Ce FX n\'a pas gardé sa stratégie : impossible de rejouer ses simulations.', false);
    // la mécanique de retrait du FX devient une mécanique enregistrée (Resimuler avec un retrait)
    const w = fx.v === 2 ? fx.income && fx.income.w : fx.withdraw && fx.withdraw.w;
    if (w && w.on !== false && w.type !== 'none' && !wdPresets().some((p) => wdKey(p.w) === wdKey(w))) setWdPresets(wdPresets().concat({ id: 'w' + Date.now().toString(36), name: (fx.income && fx.income.name) || wdDesc(w), w: Object.assign({ on: true }, w) }));
    const found = fxExistingSims(fx);
    let b = found && found.batch;
    if (!b && found) {
      b = batchStore.get().find((x) => x.fx === fx.id);
      if (!b) { b = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), fx: fx.id, name: '💼 ' + fx.name, entries: found.entries.map((e) => Object.assign({}, e)) }; const l = batchStore.get(); l.push(b); batchStore.set(l); updateBatchCount(); }
    }
    if (!b) {
      // simulations jamais faites dans cette page (chercheur de FX, autre appareil) : on les recalcule, sans retrait comme dans l'évaluation
      const S = (fx.sims || []).filter((x) => x.from && x.to);
      if (!S.length) { closeFx(); undoable('FX « ' + fx.name + ' » chargé', () => fxToForm(fx)); return toast('FX chargé dans le formulaire. Ses périodes ne sont pas connues : lancez un lot pour le tester.', false); }
      if (!confirm('Les ' + S.length + ' simulations de ce FX ne sont pas dans votre historique. Les recalculer maintenant (' + S.length + ' backtests, sur les mêmes dates) ?')) return;
      closeFx();
      fxToForm(fx); $('withdrawOn').checked = false; updateWithdrawUI();
      const e0 = { strategy: fx.strategy.data, config: Object.assign({}, currentConfig(), fx.strategy.config || {}, { capital: fx.capital, leverage: Number(fx.strategy.leverage) || currentConfig().leverage, withdraw: { on: false } }) };
      b = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), fx: fx.id, auto: true, name: '💼 ' + fx.name, entries: [] };
      const l = batchStore.get(); l.push(b); batchStore.set(l); updateBatchCount();
      checkRunning = 'fx'; checkStop = false;
      let done = 0;
      try {
        for (const x of S) {
          if (checkStop) break;
          setRunLabel('FX : simulation ' + (++done) + ' / ' + S.length);
          const before = evalList().length;
          await rerunEntry(e0, dateOf(x.from), dateOf(x.to), '', false);
          if (evalList().length > before) addToLotBatch(b, evalList()[evalList().length - 1]);
          await new Promise((r) => setTimeout(r, 20));
        }
      } finally { checkRunning = ''; setRunLabel(''); }
      b = batchStore.get().find((x) => x.id === b.id);
      if (!b || !b.entries.length) { batchStore.set(batchStore.get().filter((x) => x.id !== (b && b.id))); updateBatchCount(); return toast('Simulations impossibles à recalculer : ' + ($('formError').textContent || 'données indisponibles') + '.', false); }
      fxSaveKeys(fx, b.entries.map((e) => e.key));
    } else closeFx();
    loadBatch(b);
    fxToForm(fx);
    openEvaluation('charts');
    toast('FX « ' + fx.name + ' » : ' + b.entries.length + ' simulations ouvertes. « 💸 Resimuler avec un retrait » applique sa mécanique de retrait.', false);
  }
  function fxSaveKeys(fx, keys) { const l = fxList(), x = l.find((y) => y.id === fx.id); if (x) { x.keys = keys; setFxList(l); } }
  /** EA MetaTrader 5 du FX : sa stratégie, sa paire, son levier et son capital (taille des positions comme le backtest). */
  function downloadFxEa(fx) {
    if (!fx.strategy.data) return toast('Ce FX n\'a pas gardé sa stratégie : EA impossible à générer.', false);
    const c = fx.strategy.config || {}, br = c.broker || {};
    try {
      const ea = F.mql5.generate(Object.assign({}, fx.strategy.data, { name: fx.strategy.data.name || fx.strategy.name }), {
        pair: fx.strategy.pair || c.pair || 'EUR/USD', leverage: Number(fx.strategy.leverage || c.leverage) || 10, exposurePct: Number(c.exposurePct) || 100, capital: fx.capital,
        periodLabel: 'FX « ' + fx.name + ' »', stats: null, timeframe: 'PERIOD_' + (br.tf || 'D1'), sizing: 'backtest', fixedLots: Number(br.lots) || 0.01, riskPct: Number(br.risk) || 1,
        maxLots: Number(br.maxLots) || 10, maxSpreadPips: br.maxSpread != null && br.maxSpread !== '' ? Number(br.maxSpread) : 5,
        news: { enabled: !!(c.news && c.news.on), mode: (c.news && c.news.mode) || 'block', before: (c.news && c.news.before) || 0, after: (c.news && c.news.after) || 0, impact: (c.news && c.news.impact) || 'high' },
      });
      const blob = new Blob(['\ufeff' + ea.code.replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = ea.fileName; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('EA « ' + ea.fileName + ' » téléchargé (le retrait du FX se fait à la main : l\'EA ne retire pas d\'argent). Testez-le d\'abord en compte démo.', false);
      logEvent('ea.downloaded', 'EA du FX « ' + fx.name + ' » téléchargé : ' + ea.fileName, { fx: fx.id });
    } catch (e) { toast('EA impossible à générer : ' + e.message, false); }
  }
  // ---------- Chercheur de FX : essaie les combinaisons (stratégie × levier × retrait) et propose les plans proches des critères ----------
  let minerState = { open: false, status: 'idle', res: null };
  const fxFind = (id) => fxList().find((x) => x.id === id) || ((minerState.res && minerState.res.cands) || []).map((c) => c.fx).find((x) => x.id === id);
  const MINER_LEV = F.fxcore.MINER_LEV;
  function minerDefaults() {
    return { budget: Math.max(100, Number($('capital').value) || 10000), maxRisk: 4, minConf: 50, months: 12, income: '', prefs: { excess: true, fixed: true, pct: false, none: false },
      saved: true, create: true, effort: 'normal', maxLev: 30, pair: $('pair').value };
  }
  let minerOpt = null;
  function minerFormHtml() {
    const o = minerOpt, chk = (k, l) => '<label class="check"><input type="checkbox" data-mp="' + k + '"' + (o.prefs[k] ? ' checked' : '') + '><span>' + l + '</span></label>';
    const src = sourceValue(), srcTxt = { broker: 'cours de votre courtier MT5', online: 'cours BCE en ligne', csv: 'votre fichier CSV', synthetic: 'données simulées' }[src] || src;
    return '<div class="miner-form"><div class="miner-grid">' +
      '<label class="field">Budget à investir (€)<input id="mnBudget" type="number" min="100" step="100" value="' + esc(o.budget) + '"></label>' +
      '<label class="field">Risque maximum<select id="mnRisk">' + [1, 2, 3, 4, 5, 6, 7].map((r) => '<option value="' + r + '"' + (r === o.maxRisk ? ' selected' : '') + '>' + r + ' / 7 — ' + RISK_TXT[r] + '</option>').join('') + '</select></label>' +
      '<label class="field">Confiance minimum<select id="mnConf">' + [[30, '30 — faible acceptée'], [40, '40 — moyenne'], [50, '50'], [60, '60 — bonne'], [70, '70'], [80, '80 — élevée']].map(([v, l]) => '<option value="' + v + '"' + (v === o.minConf ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
      '<label class="field">Durée du placement (mois)<input id="mnMonths" type="number" min="1" max="120" step="1" value="' + esc(o.months) + '" list="mnMonthsList"><datalist id="mnMonthsList"><option value="3"><option value="6"><option value="12"><option value="18"><option value="24"><option value="36"></datalist></label>' +
      '<label class="field">Revenu souhaité (€ / mois, facultatif)<input id="mnIncome" type="number" min="0" step="10" value="' + esc(o.income) + '" placeholder="ex. 100"></label>' +
      '<label class="field">Paire de devises<select id="mnPair">' + [...$('pair').options].map((x) => '<option value="' + esc(x.value) + '"' + (x.value === o.pair ? ' selected' : '') + '>' + esc(x.value) + '</option>').join('') +
        '<option value="*"' + (o.pair === '*' ? ' selected' : '') + '>Toutes les paires (' + $('pair').options.length + ', plus long)</option></select></label>' +
      '<label class="field">Levier maximum<select id="mnLev">' + MINER_LEV.map((l) => '<option value="' + l + '"' + (l === o.maxLev ? ' selected' : '') + '>1:' + l + (l > 30 ? ' — hors limite UE particuliers' : '') + '</option>').join('') + '</select></label></div>' +
      (o.maxLev > 30 ? '<p class="miner-warn">⚠ Au-delà de 1:30, le levier est interdit aux particuliers sur les grandes paires dans l\'Union européenne, et le risque de tout perdre augmente fortement.</p>' : '') +
      '<div class="miner-prefs"><b>Manières de retirer acceptées</b>' + chk('excess', 'Retrait de l\'excédent') + chk('fixed', 'Somme fixe chaque mois') + chk('pct', '% du compte chaque mois') + chk('none', 'Sans retrait') + '</div>' +
      '<div class="miner-prefs"><b>Recherche</b><label class="check"><input type="checkbox" id="mnSaved"' + (o.saved ? ' checked' : '') + '><span>Inclure mes stratégies enregistrées</span></label>' +
      '<label class="check"><input type="checkbox" id="mnCreate"' + (o.create !== false ? ' checked' : '') + '><span>🧪 Créer de nouvelles stratégies (variantes testées par le chercheur)</span></label>' +
      '<select id="mnEffort"><option value="fast"' + (o.effort === 'fast' ? ' selected' : '') + '>Rapide (12 essais par combinaison)</option><option value="normal"' + (o.effort === 'normal' ? ' selected' : '') + '>Normale (20 essais)</option><option value="deep"' + (o.effort === 'deep' ? ' selected' : '') + '>Approfondie (40 essais)</option></select></div>' +
      '<p class="hint">Données : <b>' + esc(srcTxt) + '</b> (réglages de la page d\'accueil). Chaque combinaison est essayée sur des périodes passées tirées au hasard, de la durée choisie ; les mêmes périodes servent à toutes les combinaisons pour les comparer équitablement.</p>' +
      '<div class="row buttons"><button type="button" class="primary small" id="mnRun"' + (minerState.status === 'run' ? ' disabled' : '') + '>⛏️ Lancer la recherche</button>' + (minerState.status === 'run' ? '<button type="button" class="secondary small" id="mnStop">Arrêter</button>' : '') + '</div></div>';
  }
  function renderMiner() {
    const box = $('fxMiner');
    if (!minerState.open) { box.hidden = true; return; }
    box.hidden = false;
    let h = '<section class="miner"><div class="miner-head"><h3>⛏️ Chercheur de FX</h3><button type="button" class="ghost small" id="mnClose">Fermer le chercheur</button></div>' +
      '<p class="hint">Indiquez vos critères : le chercheur essaie toutes les combinaisons (stratégies × levier × manière de retirer) sur l\'historique, calcule pour chacune le risque, le score de confiance et ce qu\'elle rapporte, puis propose les plans les plus proches de vos critères.</p>' + minerFormHtml();
    if (minerState.status === 'run') h += '<div class="modal-loading"><span class="spinner"></span>' + esc(minerState.msg || '') + '<div class="miner-bar"><i style="width:' + Math.round((minerState.pct || 0) * 100) + '%"></i></div></div>';
    if (minerState.status === 'err') h += '<p class="val ko">' + esc(minerState.msg) + '</p>';
    if (minerState.res) h += minerResultsHtml(minerState.res);
    box.innerHTML = h + '</section>';
  }
  function minerRead() {
    const o = minerOpt;
    o.budget = Math.max(100, Math.round(Number($('mnBudget').value) || 0)); o.maxRisk = +$('mnRisk').value; o.minConf = +$('mnConf').value; o.months = Math.max(1, Math.min(120, Math.round(Number($('mnMonths').value) || 12)));
    o.income = $('mnIncome').value; o.maxLev = +$('mnLev').value; o.pair = $('mnPair').value; o.saved = $('mnSaved').checked; o.create = $('mnCreate').checked; o.effort = $('mnEffort').value;
    document.querySelectorAll('#fxMiner [data-mp]').forEach((x) => { o.prefs[x.dataset.mp] = x.checked; });
  }
  /** Manières de retirer à essayer, selon les préférences et le budget. */
  function minerMechs(o) { return F.fxcore.minerMechs(o); }
  /** Historique de cours pour la recherche (source choisie sur la page d'accueil). */
  async function minerBars(pair) {
    const src = sourceValue(), today = new Date(F.data.iso(new Date()) + 'T00:00:00Z');
    const y0 = src === 'broker' ? 2012 : src === 'online' ? 2000 : 1998, start = new Date(Date.UTC(y0, 0, 1)), fetchStart = new Date(Date.UTC(y0 - 2, 0, 1));
    if (src === 'broker') {
      // symbole MT5 de la paire : celui de la page d'accueil, avec le code de la paire remplacé (ex. EURUSD.m → GBPUSD.m)
      const cur = $('pair').value.replace('/', ''), code = pair.replace('/', ''), sym0 = $('brokerSymbol').value.trim();
      const symbol = sym0.toUpperCase().indexOf(cur) === 0 ? code + sym0.slice(cur.length) : code;
      const l = await loadBrokerBars({ start: start, end: today }, { pair: pair, symbol: symbol }); return { bars: l.bars, broker: l.broker, tf: l.timeframe, label: 'MT5', synthetic: false, symbol: l.symbol }; }
    if (src === 'csv') { if (!csvBars) throw new Error('Choisissez d\'abord un fichier CSV (page d\'accueil, section Données).'); return { bars: csvBars, tf: csvMeta.timeframe, label: 'CSV', synthetic: false }; }
    if (src === 'online') {
      try {
        const key = pair + '|' + F.data.iso(fetchStart) + '|' + F.data.iso(today);
        if (!onlineCache.has(key)) onlineCache.set(key, await F.data.fetchFrankfurter(pair, fetchStart, today));
        return { bars: $('estimateWicks').checked ? F.data.estimateWicks(onlineCache.get(key)) : onlineCache.get(key), tf: 'D1', label: 'BCE', synthetic: false };
      } catch (e) { /* cours en ligne indisponibles : données simulées */ }
    }
    return { bars: F.data.generateSynthetic(pair, fetchStart, today), tf: 'D1', label: 'Simulées', synthetic: true };
  }
  async function runMiner() {
    if (checkRunning || minerState.status === 'run') return;
    minerRead();
    const o = minerOpt, mechs = minerMechs(o);
    if (!mechs.length) { minerState.status = 'err'; minerState.msg = 'Cochez au moins une manière de retirer.'; return renderMiner(); }
    const baseStrats = F.presets.list.map((p) => Object.assign({}, p)).concat(o.saved ? storage.get().map((s) => Object.assign({}, s)) : []).filter((s) => s.longEntry || s.shortEntry);
    const levs = MINER_LEV.filter((l) => l <= o.maxLev), K = { fast: 12, normal: 20, deep: 40 }[o.effort] || 20;
    const pairs = o.pair === '*' ? [...$('pair').options].map((x) => x.value) : [o.pair || $('pair').value];
    minerState = { open: true, status: 'run', msg: 'Chargement des cours de ' + pairs[0] + '…', pct: 0, res: null };
    renderMiner();
    checkRunning = 'miner'; checkStop = false; setRunLabel('Chercheur de FX');
    const found = [], skipped = [];
    let screened = 0, createdN = 0, done = 0, synthetic = false, allCombos = 0;
    try {
      for (let pi = 0; pi < pairs.length && !checkStop; pi++) {
        const pair = pairs[pi], tag = pairs.length > 1 ? ' (' + pair + ', paire ' + (pi + 1) + ' / ' + pairs.length + ')' : '';
        minerState.msg = 'Chargement des cours de ' + pair + '…'; renderMinerProgress();
        let data;
        try { data = await minerBars(pair); } catch (e) { if (pairs.length === 1) throw e; skipped.push(pair + ' : ' + e.message); continue; }
        const base = {
          capital: o.budget, exposurePct: Number($('exposure').value) || 100, spreadPips: Number($('spread').value) || 0, pair: pair, timeframe: data.tf || 'D1',
          sizing: $('brokerSizing').value, fixedLots: Number($('brokerLots').value) || 0.01, riskPct: Number($('brokerRisk').value) || 1, commissionPerLot: Number($('commission').value) || 0,
        };
        if (data.broker) Object.assign(base, { broker: data.broker, symbol: data.symbol, spreadMode: $('spreadMode').value, maxLots: Number($('brokerMaxLots').value) || 1, maxSpreadPips: Number($('brokerMaxSpread').value) || 0 });
        let r;
        try {
          r = await F.fxcore.minePair({
            bars: data.bars, base: base, pair: pair, strats: baseStrats, levs: levs, mechs: mechs, o: o, K: K, dataLabel: data.label, synthetic: data.synthetic,
            config: currentConfig(), score: minerScore, stop: () => checkStop,
            progress: async (p) => {
              if (p.phase === 'create') { minerState.msg = '🧪 Création de stratégies' + tag + ' : ' + p.screened + ' variantes testées, ' + p.kept + ' meilleures que leur modèle'; minerState.pct = 0; }
              else { minerState.pct = (pi + p.done / Math.max(1, p.combos)) / pairs.length; minerState.msg = 'Essai ' + (done + p.done) + ' combinaisons' + tag + ' · ' + p.strat + ' · levier 1:' + p.lev; }
              renderMinerProgress(); await new Promise((res) => setTimeout(res, 0));
            },
          });
        } catch (e) { if (pairs.length === 1) throw e; skipped.push(pair + ' : historique trop court'); continue; }
        synthetic = synthetic || data.synthetic;
        found.push(...r.found); screened += r.screened; createdN += r.created.length; done += r.done; allCombos += r.combos;
      }
      if (!found.length) throw new Error('Aucune combinaison n\'a pu être testée.' + (skipped.length ? ' ' + skipped.join(' · ') : ''));
      // nombre d'essais (correction de la chance) : toutes les combinaisons et variantes testées, toutes paires confondues
      const trialsAll = Math.max(1, (allCombos || done) + screened * levs.length * mechs.length);
      const sel = F.fxcore.minerPick(found, o, trialsAll, minerScore, 6);
      minerState = { open: true, status: 'done', res: { cands: sel.pick, total: sel.found.length, ok: sel.found.filter((x) => x.ok).length, trials: done, done: done, screened: screened, created: createdN, stopped: checkStop, K: K, opt: JSON.parse(JSON.stringify(o)), synthetic: synthetic, pairs: pairs, skipped: skipped } };
      logEvent('fx.miner', 'Chercheur de FX : ' + done + ' combinaisons, ' + minerState.res.ok + ' conformes', { opt: o });
    } catch (e) {
      minerState = { open: true, status: 'err', msg: e.message, res: null };
    } finally {
      checkRunning = ''; setRunLabel('');
    }
    renderMiner();
    const r = $('fxMiner').querySelector('.miner-res'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function renderMinerProgress() {
    const box = $('fxMiner').querySelector('.modal-loading');
    if (!box) return renderMiner();
    box.innerHTML = '<span class="spinner"></span>' + esc(minerState.msg || '') + '<div class="miner-bar"><i style="width:' + Math.round((minerState.pct || 0) * 100) + '%"></i></div>';
  }
  /** Note d'un candidat par rapport aux critères. */
  function minerScore(fx, o, w) {
    FX_BASE = fx.capital;
    const conf = fxConfidence(fx).score, pt = fxPoint(fx, 0.5), incEur = (o.budget * (pt.inc || 0)) / 100, want = Number(o.income) || 0;
    const miss = [];
    if (fx.riskNote > o.maxRisk) miss.push('risque ' + fx.riskNote + '/7 (max ' + o.maxRisk + ')');
    if (conf < o.minConf) miss.push('confiance ' + conf + ' (min ' + o.minConf + ')');
    if (want > 0 && w && w.on !== false && incEur < want * 0.9) miss.push('revenu ≈ ' + Math.round(incEur) + ' €/mois (souhaité ' + want + ')');
    // classement : capital au bout de la durée le plus souvent (compte + revenus), puis confiance
    const rank = fx.scenarios.med + conf * 0.2 + fx.winRate * 0.1;
    const dist = Math.max(0, fx.riskNote - o.maxRisk) * 15 + Math.max(0, o.minConf - conf) + (want > 0 ? Math.max(0, want - incEur) / Math.max(1, want) * 30 : 0) - fx.scenarios.med * 0.05;
    return { fx: fx, conf: conf, incEur: incEur, ok: miss.length ? 0 : 1, miss: miss, rank: rank, dist: dist };
  }
  function minerResultsHtml(res) {
    const o = res.opt;
    let h = '<div class="miner-res"><h4>' + (res.ok ? '✅ ' + res.ok + ' plan' + (res.ok > 1 ? 's' : '') + ' respecte' + (res.ok > 1 ? 'nt' : '') + ' vos critères' : '⚠ Aucun plan ne respecte tous vos critères : voici les plus proches') + '</h4>' +
      '<p class="hint">' + res.done + ' combinaisons essayées' + (res.stopped ? ' (recherche arrêtée)' : '') + (res.pairs && res.pairs.length > 1 ? ' sur ' + res.pairs.length + ' paires' : res.pairs ? ' sur ' + res.pairs[0] : '') + ', ' + res.K + ' périodes passées de ' + o.months + ' mois chacune.' + (res.skipped && res.skipped.length ? ' Paires ignorées : ' + esc(res.skipped.join(' · ')) + '.' : '') + ' Le score de confiance tient compte du nombre de combinaisons essayées (plus on cherche, plus le hasard peut faire briller un plan).' +
      (res.screened ? ' 🧪 ' + res.screened + ' nouvelles stratégies créées et testées, ' + res.created + ' retenues dans la recherche.' : '') +
      (res.synthetic ? ' <b>Données simulées : à refaire avec les cours réels (MT5) avant de présenter un plan.</b>' : '') + '</p><div class="miner-list">';
    for (const c of res.cands) {
      const fx = c.fx, pt = fxPoint(fx, 0.5);
      FX_BASE = fx.capital;
      const gen = fx.strategy.data && fx.strategy.data.generated, savedS = gen && storage.get().some((x) => x.name === fx.strategy.name);
      h += '<article class="miner-card ' + (c.ok ? 'ok' : 'near') + '" data-mn="' + esc(fx.id) + '"><header><b>' + esc(fx.strategy.name) + '</b><span>' + esc(fx.strategy.pair) + ' · levier 1:' + fx.strategy.leverage + ' · ' + esc(fx.income.name) + '</span></header>' +
        (gen ? '<p class="miner-gen">🧪 Stratégie créée par le chercheur : « ' + esc(gen.parent) + ' » + ' + esc(gen.change.charAt(0).toLowerCase() + gen.change.slice(1)) + '.' + (savedS ? ' <b>Enregistrée.</b>' : '') + '</p>' : '') +
        '<div class="miner-kpis"><div><span>Le plus souvent, au bout de ' + o.months + ' mois</span><b class="' + (fx.scenarios.med >= 100 ? 'pos' : 'neg') + '">' + fxMoney(fx.scenarios.med) + '</b></div>' +
        '<div><span>Revenu</span><b>≈ ' + fxMoney(pt.inc || 0) + ' / mois</b></div><div><span>Risque</span><b>' + fx.riskNote + ' / 7</b></div><div><span>Confiance</span><b>' + c.conf + ' / 100</b></div><div><span>Chances de gain</span><b>' + Math.round(fx.winRate / 10) + ' sur 10</b></div></div>' +
        (c.ok ? '<p class="miner-ok">✓ Respecte vos critères</p>' : '<p class="miner-miss">✗ ' + c.miss.map(esc).join(' · ') + '</p>') +
        '<div class="row buttons"><button type="button" class="secondary small" data-mn-view="' + esc(fx.id) + '">Voir le FX complet</button><button type="button" class="primary small" data-mn-save="' + esc(fx.id) + '">💼 Enregistrer ce FX</button>' +
        (gen && !savedS ? '<button type="button" class="secondary small" data-mn-strat="' + esc(fx.id) + '">💾 Enregistrer la stratégie</button>' : '') + '</div>' +
        '<div class="miner-full" id="mnFull-' + esc(fx.id) + '" hidden></div></article>';
    }
    return h + '</div></div>';
  }
  $('fxMinerBtn').addEventListener('click', () => {
    minerState.open = !minerState.open;
    if (!minerOpt) minerOpt = minerDefaults();
    renderMiner();
    if (minerState.open) $('fxMiner').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('fxMiner').addEventListener('click', (ev) => {
    const t = ev.target;
    if (t.id === 'mnClose') { minerState.open = false; return renderMiner(); }
    if (t.id === 'mnRun') return runMiner();
    if (t.id === 'mnStop') { checkStop = true; return; }
    const v = t.closest('[data-mn-view]');
    if (v) {
      const fx = fxFind(v.dataset.mnView), box = $('mnFull-' + fx.id);
      box.hidden = !box.hidden;
      if (!box.hidden) { box.innerHTML = fxCardHtml(fx); v.textContent = 'Masquer le FX complet'; } else v.textContent = 'Voir le FX complet';
      return;
    }
    const sv = t.closest('[data-mn-save]');
    if (sv) {
      const fx = fxFind(sv.dataset.mnSave);
      if (!fx || fxList().some((x) => x.id === fx.id)) return toast('Ce FX est déjà enregistré.', false);
      const name = (prompt('Nom du FX (plan d\'investissement) :', fx.name) || '').trim().slice(0, 80);
      if (!name) return;
      fx.name = name;
      // stratégie créée par le chercheur : proposée à l'enregistrement avec le FX
      const gs = fx.strategy.data && fx.strategy.data.generated;
      if (gs && !storage.get().some((x) => x.name === fx.strategy.name) && confirm('Ce FX utilise une stratégie créée par le chercheur (« ' + fx.strategy.name + ' »). L\'enregistrer aussi dans vos stratégies ?')) minerSaveStrategy(fx);
      setFxList(fxList().concat(fx));
      logEvent('fx.saved', 'FX enregistré depuis le chercheur : ' + name, { id: fx.id });
      sv.textContent = '✓ Enregistré'; sv.disabled = true;
      openFx(); renderMiner();
      toast('FX « ' + name + ' » enregistré.', false);
    }
  });
  $('fxMiner').addEventListener('change', (ev) => { if (ev.target.closest('.miner-form')) { minerRead(); if (ev.target.id === 'mnLev') renderMiner(); } });
  /** Enregistre la stratégie créée par le chercheur dans « Mes stratégies ». */
  function minerSaveStrategy(fx) {
    const s = Object.assign({}, fx.strategy.data, { name: fx.strategy.name });
    if (storage.get().some((x) => x.name === s.name)) return false;
    saveStrategy(s, fx.strategy.config || currentConfig());
    refreshPresetSelect($('preset').value);
    logEvent('strategy.saved', 'Stratégie créée par le chercheur de FX : ' + s.name, { strategy: s });
    return true;
  }
  $('fxMiner').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-mn-strat]');
    if (!b) return;
    const fx = fxFind(b.dataset.mnStrat);
    if (fx && minerSaveStrategy(fx)) { toast('Stratégie « ' + fx.strategy.name + ' » enregistrée dans vos stratégies.', false); renderMiner(); }
  });

  // point blanc des scénarios : glisser (souris ou doigt) pour choisir un scénario
  let fxDrag = null;
  function fxDragAt(ev) {
    const fx = fxFind(fxDrag.id), svg = fxDrag.svg;
    if (!fx) return;
    const b = svg.getBoundingClientRect(), vx = ((ev.clientX - b.left) / b.width) * 360, rg = fxRange(fx);
    const v = rg.lo + ((vx - 12) / 336) * (rg.hi - rg.lo);
    fxSetQ(fx.id, fxRank(fx, v));
  }
  $('fxModal').addEventListener('pointerdown', (ev) => {
    const t = ev.target.closest('[data-fx-hit],[data-fx-h]');
    if (!t) return;
    fxDrag = { id: t.dataset.fxHit || t.dataset.fxH, svg: t.closest('svg') };
    t.closest('svg').setPointerCapture(ev.pointerId);
    ev.preventDefault(); fxDragAt(ev);
  });
  $('fxModal').addEventListener('pointermove', (ev) => { if (fxDrag) fxDragAt(ev); });
  $('fxModal').addEventListener('pointerup', () => { fxDrag = null; });
  $('fxModal').addEventListener('pointercancel', () => { fxDrag = null; });
  /** Nombre d'essais (pour corriger la chance) : variantes de la stratégie testées × mécaniques de retrait comparées. */
  function fxTrials(fx) {
    const base = String(fx.strategy.name || '').replace(/ \(améliorée\)$/, '');
    const variants = new Set(evalList().filter((e) => e.name === fx.strategy.name || String(e.name).startsWith(base)).map((e) => e.rules));
    return Math.max(1, variants.size) * 2;
  }
  /** Score de confiance d'un FX (mesures statistiques de la littérature, voir js/confidence.js). */
  function fxConfidence(fx) {
    const S = fxSims(fx) || [], real = S.filter((x) => x.mr);
    return F.confidence.score({
      monthly: real.flatMap((x) => x.mr), periods: real.map((x) => ({ from: x.from, to: x.to })), oneYear: S.map((x) => x.y1),
      eras: { win: fx.solidity.eraWin, total: fx.solidity.eras }, synthetic: fx.solidity.synthetic, trials: fx.trials || fxTrials(fx),
    });
  }
  const pc0 = (p) => Math.round(p * 100) + ' %';
  function fxConfidenceTip(fx, c) {
    const d = c.details, lvl = c.score >= 80 ? 'élevée' : c.score >= 60 ? 'bonne' : c.score >= 40 ? 'moyenne' : 'faible';
    let h = '<b>Score de confiance : ' + c.score + '/100 (' + lvl + ')</b><p>Il dit à quel point on peut se fier aux résultats du plan. Trois mesures statistiques reconnues, calculées sur les ' + fx.n + ' essais du plan sur des périodes passées :</p><ol>';
    if (c.parts.dsr != null) h += '<li><b>Ratio de Sharpe « dégonflé »</b> (Bailey et López de Prado) : <b>' + pc0(c.parts.dsr) + '</b>. Probabilité que le plan gagne vraiment plus qu\'il ne risque, mois après mois, une fois corrigé de la durée d\'historique (' + d.T + ' mois distincts), des mois extrêmes et des ' + d.trials + ' essais faits pour le trouver (le meilleur de nombreux essais peut être dû au hasard).</li>';
    if (c.parts.student != null) h += '<li><b>Test de Student</b> sur le capital au bout d\'un an : <b>' + pc0(c.parts.student) + '</b>. Probabilité que le résultat moyen à un an soit positif (' + signed(d.y1Mean, num1) + ' % en moyenne ; les essais dont les périodes se recouvrent comptent moins, soit l\'équivalent de ' + num1.format(d.nEff) + ' essais indépendants).</li>';
    h += '<li><b>Cohérence entre époques</b> : <b>' + pc0(c.parts.eras) + '</b>. Le plan gagne dans ' + d.eras.win + ' époque' + (d.eras.win > 1 ? 's' : '') + ' de marché sur ' + d.eras.total + ' (lissé pour ne pas surestimer avec peu d\'époques).</li></ol>';
    h += '<p>Score = moyenne géométrique des mesures (une seule mesure faible fait baisser le score)' + (c.data < 1 ? ' × 0,4 car le plan est construit sur des données simulées.' : '.') + '</p><p class="fx-tip-scale">Moins de 40 : faible · 40 à 60 : moyenne · 60 à 80 : bonne · plus de 80 : élevée.</p>';
    return h;
  }
  // capital investi modifiable sur la carte (jamais sous le minimum du plan)
  $('fxModal').addEventListener('change', (ev) => {
    const id = ev.target.dataset && ev.target.dataset.fxInvest;
    if (!id || !ev.target.isConnected || fxInvBusy) return; // déjà traité (Entrée puis perte du focus)
    const l = fxList(), fx = l.find((x) => x.id === id) || fxFind(id);
    if (!fx) return;
    fxInvBusy = true;
    try { fxInvestApply(ev, l, fx, id); } finally { fxInvBusy = false; }
  });
  let fxInvBusy = false;
  function fxInvestApply(ev, l, fx, id) {
    let v = Math.round(Number(ev.target.value) || 0);
    if (v < fx.capital) { v = Math.ceil(fx.capital); toast('Montant minimum pour ce plan : ' + money0.format(fx.capital) + '.', false); }
    fx.invest = v; if (l.includes(fx)) setFxList(l); // FX proposé par le chercheur : pas encore enregistré
    const card = document.querySelector('.fx-card[data-fx="' + id + '"]');
    if (card) card.outerHTML = fxCardHtml(fx);
  }
  $('fxModal').addEventListener('keydown', (ev) => { if (ev.target.dataset && ev.target.dataset.fxInvest && ev.key === 'Enter') ev.target.dispatchEvent(new Event('change', { bubbles: true })); });
  $('fxModal').addEventListener('click', (ev) => {
    const c = ev.target.closest('.fx-conf');
    document.querySelectorAll('.fx-conf.open').forEach((x) => { if (x !== c) x.classList.remove('open'); });
    if (c) c.classList.toggle('open');
  });
  // nom du FX modifiable directement sur la carte
  $('fxModal').addEventListener('change', (ev) => {
    const id = ev.target.dataset && ev.target.dataset.fxName;
    if (!id) return;
    const name = ev.target.value.trim().slice(0, 80), l = fxList(), fx = l.find((x) => x.id === id);
    if (!fx) return;
    if (!name) { ev.target.value = fx.name; return; }
    fx.name = name; setFxList(l); toast('Nom du FX modifié.', false);
  });
  $('fxModal').addEventListener('keydown', (ev) => { if (ev.target.dataset && ev.target.dataset.fxName && ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('fxModal').hidden) closeFx(); });

  // ---------- Guide de recherche de l'agent IA (lu par l'agent via l'outil MCP fx_method) ----------
  // { active: 'free' | 'forexia' | id, items: [{id, name, text}], updatedAt } — un seul guide appliqué à la fois
  const AG_KEY = 'forexia.agentGuide';
  let agMem = null, agDemarche = null, agTimer = null;
  function agGet() {
    try { const v = JSON.parse(localStorage.getItem(AG_KEY)); if (v && typeof v === 'object') return { active: v.active || 'free', items: Array.isArray(v.items) ? v.items : [], updatedAt: v.updatedAt }; } catch (e) { /* ignoré */ }
    return agMem || { active: 'free', items: [] };
  }
  function agSet(v) {
    v.updatedAt = new Date().toISOString(); agMem = v;
    if (!lsSet(AG_KEY, JSON.stringify(v))) lsFullToast('le guide');
    updateAgBtn();
  }
  function agActiveName(g) {
    g = g || agGet();
    if (g.active === 'forexia') return 'Démarche Forexia';
    const it = g.items.find((x) => x.id === g.active);
    return it ? it.name || 'Mon guide' : '';
  }
  function updateAgBtn() { const n = agActiveName(); $('agNow').textContent = n ? (n.length > 18 ? n.slice(0, 17) + '…' : n) : 'libre'; $('agNow').classList.toggle('on', !!n); }
  async function agLoadDemarche() {
    if (agDemarche != null) return agDemarche;
    try { const r = await fetch('mcp/guide-demarche.md', { cache: 'no-cache' }); agDemarche = r.ok ? await r.text() : ''; } catch (e) { agDemarche = ''; }
    return agDemarche;
  }
  function agStatus() {
    const n = agActiveName();
    $('agStatus').innerHTML = (n ? 'Guide appliqué : <b>' + esc(n) + '</b>. ' : 'Appliqué : <b>liberté de l\'agent</b>. ') +
      (dbOn ? 'Transmis à l\'agent par la passerelle MT5 : il le lit au début de chaque recherche.' : 'Passerelle MT5 non connectée : l\'agent ne voit ce choix qu\'une fois la passerelle connectée (ou utilisez « 📋 Copier pour l\'agent »).');
  }
  async function openAgent() {
    const g = agGet(), d = await agLoadDemarche();
    const opt = (id, title, desc, extra) => '<div class="ag-opt' + (g.active === id || (id === 'free' && !agActiveName(g)) ? ' on' : '') + '" data-ag="' + esc(id) + '">' +
      '<label class="ag-pick"><input type="radio" name="agActive" value="' + esc(id) + '"' + (g.active === id || (id === 'free' && !agActiveName(g)) ? ' checked' : '') + '><span>' + title + '</span></label>' + (desc ? '<p class="hint">' + desc + '</p>' : '') + (extra || '') + '</div>';
    let h = '<div class="ag-list">' +
      opt('free', '🧠 Liberté de l\'agent <small>(par défaut)</small>', 'L\'agent cherche avec sa propre méthode et son jugement, en utilisant librement tous les outils de Forexia.') +
      opt('forexia', '📘 Démarche Forexia', 'Démarche proposée : choix de la stratégie, ajout progressif d\'indicateurs selon les constats, comparaisons sur les mêmes périodes, confirmation sur des périodes neuves, levier / durée / budget, puis retraits réglés selon l\'analyse temporelle.',
        '<details class="ag-view"><summary>Voir le texte</summary><pre>' + esc(d || 'Texte indisponible (mcp/guide-demarche.md).') + '</pre></details><div class="ag-acts"><button type="button" class="secondary small" data-ag-dup>📄 Copier dans un nouveau guide pour la modifier</button></div>');
    for (const it of g.items) {
      h += opt(it.id, '✍️ <input class="ag-name" data-ag-name="' + esc(it.id) + '" value="' + esc(it.name || '') + '" placeholder="Nom du guide" aria-label="Nom du guide">', '',
        '<textarea class="ag-text" data-ag-text="' + esc(it.id) + '" rows="10" placeholder="Écrivez votre démarche : par où commencer, quoi constater, quoi changer et dans quel ordre, quand passer aux retraits, ce que vous voulez en sortie…" spellcheck="true">' + esc(it.text || '') + '</textarea>' +
        '<div class="ag-acts"><button type="button" class="secondary small" data-ag-copy="' + esc(it.id) + '">📋 Copier pour l\'agent</button><button type="button" class="ghost small" data-ag-del="' + esc(it.id) + '" title="Supprimer ce guide" aria-label="Supprimer">🗑</button></div>');
    }
    h += '</div><button type="button" class="primary small ag-new" data-ag-new>＋ Nouveau guide</button>';
    $('agBody').innerHTML = h;
    agStatus();
    $('agModal').hidden = false; document.body.style.overflow = 'hidden';
  }
  function closeAgent() { clearTimeout(agTimer); agFlushText(); $('agModal').hidden = true; document.body.style.overflow = ''; }
  function agFlushText() {
    const g = agGet(); let ch = false;
    $('agBody').querySelectorAll('[data-ag-name]').forEach((x) => { const it = g.items.find((i) => i.id === x.dataset.agName); if (it && it.name !== x.value) { it.name = x.value.slice(0, 80); ch = true; } });
    $('agBody').querySelectorAll('[data-ag-text]').forEach((x) => { const it = g.items.find((i) => i.id === x.dataset.agText); if (it && it.text !== x.value) { it.text = x.value; ch = true; } });
    if (ch) { agSet(g); agStatus(); }
  }
  $('agBtn').addEventListener('click', openAgent);
  $('agModal').addEventListener('click', async (ev) => {
    const t = ev.target;
    if (t.closest('[data-close]')) return closeAgent();
    if (t.closest('[data-ag-new]') || t.closest('[data-ag-dup]')) {
      agFlushText();
      const g = agGet(), dup = !!t.closest('[data-ag-dup]'), it = { id: 'g' + Date.now().toString(36), name: dup ? 'Ma démarche' : 'Mon guide ' + (g.items.length + 1), text: dup ? await agLoadDemarche() : '' };
      g.items.push(it); g.active = it.id; agSet(g); await openAgent();
      const ta = $('agBody').querySelector('[data-ag-text="' + it.id + '"]'); if (ta) { ta.scrollIntoView({ block: 'center' }); ta.focus(); }
      return;
    }
    const del = t.closest('[data-ag-del]');
    if (del) {
      const g = agGet(), it = g.items.find((x) => x.id === del.dataset.agDel);
      if (it && confirm('Supprimer le guide « ' + (it.name || 'sans nom') + ' » ?')) { g.items = g.items.filter((x) => x.id !== it.id); if (g.active === it.id) g.active = 'free'; agSet(g); openAgent(); }
      return;
    }
    const cp = t.closest('[data-ag-copy]');
    if (cp) {
      agFlushText();
      const it = agGet().items.find((x) => x.id === cp.dataset.agCopy);
      const txt = 'Pour cette recherche, suis ce guide étape par étape :\n\n' + ((it && it.text) || '');
      try { await navigator.clipboard.writeText(txt); toast('Guide copié : collez-le dans la conversation avec l\'agent.', false); } catch (e) { toast('Copie impossible : sélectionnez le texte du guide et copiez-le.', false); }
      return;
    }
    // un clic dans un guide (hors champ) le choisit
    const o = t.closest('.ag-opt');
    if (o && !t.closest('textarea, input:not([type=radio]), details, button')) { const r = o.querySelector('input[type=radio]'); if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); } }
  });
  $('agModal').addEventListener('change', (ev) => {
    if (ev.target.name !== 'agActive') return;
    agFlushText();
    const g = agGet(); g.active = ev.target.value; agSet(g);
    $('agBody').querySelectorAll('.ag-opt').forEach((x) => x.classList.toggle('on', x.dataset.ag === g.active));
    agStatus();
  });
  $('agModal').addEventListener('input', (ev) => {
    if (!ev.target.closest('[data-ag-name],[data-ag-text]')) return;
    clearTimeout(agTimer); agTimer = setTimeout(agFlushText, 600);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('agModal').hidden) closeAgent(); });
  updateAgBtn();
  updateFxCount();
  async function runWd() {
    const st = wdState;
    if (checkRunning) return;
    wdReadForm();
    const w = st.w, T = wdTargets();
    if (w.mode === 'periodic' ? !(Number(w.value) > 0) : !(Number(w.pct) > 0)) { st.status = 'err'; st.msg = 'Indiquez ' + (w.mode === 'periodic' ? 'le montant du retrait.' : 'le seuil de gain.'); return renderWdModal(); }
    if (T.length > 60 && !confirm(T.length + ' simulations à relancer : cela peut prendre un moment. Continuer ?')) return;
    st.status = 'run'; st.rows = null; st.focus = null; st.view = null;
    const rows = await wdCompute(w, T, (i, n) => { st.msg = 'Simulation ' + (i + 1) + ' / ' + n + '…'; renderWdModal(); });
    st.rows = rows;
    st.status = rows.length ? 'done' : 'err'; st.cached = false;
    if (!rows.length) st.msg = 'Aucune simulation n\'a pu être relancée : ' + ($('formError').textContent || 'données indisponibles');
    st.ran = Object.assign({}, w);
    renderWdModal();
  }
  function wdResultHtml(st) {
    const R = st.rows, n = R.length, pc = (v) => '<span class="' + cls(v) + '">' + signed(v, num1) + ' %</span>';
    const wdT = R.reduce((a, r) => a + r.w.wd, 0), months = R.reduce((a, r) => a + r.w.months, 0), avg = (f) => mean(R.map(f));
    const kept = R.filter((r) => r.w.final >= r.capital).length, withW = R.filter((r) => r.w.n > 0).length;
    const kpi = (label, value, sub, c) => '<div class="panel kpi"><div class="label">' + label + '</div><div class="value ' + (c || '') + '">' + value + '</div><div class="sub">' + (sub || '&nbsp;') + '</div></div>';
    let h = '<h3 class="wd-h">Résultats avec « ' + esc(wdDesc(st.ran || st.w)) + ' »' + (n > 1 ? '' : ' · simulation #' + R[0].idx) + (st.cached ? ' <span class="ev-badge">déjà calculés</span>' : '') + '</h3>' +
      '<div class="fx-save"><button type="button" class="primary small" id="wdFxSaveRun">💼 Enregistrer un FX</button><span class="hint">Plan d\'investissement avec ' + (wdNone(st.ran || st.w) ? '« ' + NO_WD + ' »' : 'ce retrait (« ' + esc(wdDesc(st.ran || st.w)) + ' »)') + ', sur ' + (n > 1 ? 'ces ' + n + ' simulations' : 'cette simulation') + '.</span></div>' +
      '<div class="kpis wd-kpis">' +
      kpi('Total retiré', money.format(wdT), n > 1 ? 'sur ' + n + ' simulations' : 'en ' + R[0].w.n + ' retrait' + (R[0].w.n > 1 ? 's' : '')) +
      kpi('Retrait moyen par mois', money.format(wdT / Math.max(1, months)), n > 1 ? 'moyenne de toutes les simulations' : R[0].w.months + ' mois') +
      (n > 1 ? kpi('Simulations avec retrait', withW + ' / ' + n, Math.round((withW / n) * 100) + ' %') : '') +
      kpi(n > 1 ? 'Résultat moyen' : 'Résultat', pc(avg((r) => r.w.ret)), 'sans retrait : ' + signed(avg((r) => r.b.ret), num1) + ' %') +
      kpi(n > 1 ? 'Drawdown moyen' : 'Drawdown', '−' + num1.format(avg((r) => r.w.dd)) + ' %', 'sans retrait : −' + num1.format(avg((r) => r.b.dd)) + ' %') +
      kpi('Capital de départ préservé', n > 1 ? kept + ' / ' + n : (kept ? 'oui' : 'non'), 'compte final ≥ capital de départ', kept * 2 >= n ? 'pos' : 'neg') + '</div>';
    h += '<section class="eval-chart"><h4>Résultat ' + (n > 1 ? 'de chaque simulation' : 'de la simulation') + '</h4><p class="hint">Barre pleine : sans retrait ; pointillé : avec retrait (compte + retraits), vert s\'il reste gagnant, bleu sinon. Au-dessus : le résultat avec retrait et la somme retirée.' +
      (n > 1 ? ' <b>Cliquez sur une barre</b> (ou glissez sur plusieurs) pour afficher son détail et ses courbes ci-dessous ; recliquez pour revenir à l\'ensemble.' : '') + '</p><div id="wdBars"></div></section>';
    h += '<section class="eval-chart wd-focus" id="wdFocus"></section>';
    h += '<div class="table-wrap"><table class="eval wd-table"><thead><tr><th>#</th><th class="l">Période</th><th>Capital</th><th>Sans retrait</th><th>Avec retrait</th><th>Retiré</th><th>Retraits</th><th>Par mois</th><th>1er retrait</th><th>Rente / an</th><th>Compte final</th><th>Drawdown</th></tr></thead><tbody>' +
      R.map((r) => { const d = wdDerive(r); return '<tr data-wd-row="' + esc(r.key) + '" class="' + ((st.focus || []).includes(r.key) ? 'focus' : '') + '"><td>' + r.idx + '</td><td class="l">' + frDate(r.from) + ' → ' + frDate(r.to) + ' <small class="eval-tag">' + durationLabel(r.from, r.to) + '</small></td><td>' + money.format(r.capital) + '</td><td>' + pc(r.b.ret) + '</td><td>' + pc(r.w.ret) + '</td>' +
        '<td>' + (r.w.wd ? money.format(r.w.wd) : '—') + '</td><td>' + r.w.n + '</td><td>' + (r.w.wd ? money.format(r.w.wd / r.w.months) : '—') + '</td><td>' + (d.first ? 'mois ' + d.first : '—') + '</td><td>' + num1.format(d.yearly) + ' %</td>' +
        '<td class="' + (r.w.final >= r.capital ? 'pos' : 'neg') + '">' + money.format(r.w.final) + '</td><td>−' + num1.format(r.w.dd) + ' %</td></tr>'; }).join('') +
      '</tbody>' + (n > 1 ? '<tfoot><tr><td colspan="3" class="l">Moyenne (' + n + ')</td><td>' + pc(avg((r) => r.b.ret)) + '</td><td>' + pc(avg((r) => r.w.ret)) + '</td><td>' + money.format(wdT / n) + '</td><td>' + num1.format(avg((r) => r.w.n)) + '</td><td>' + money.format(wdT / Math.max(1, months)) + '</td><td>' +
        (R.some((r) => wdDerive(r).first) ? 'mois ' + num1.format(mean(R.map((r) => wdDerive(r).first).filter(Boolean))) : '—') + '</td><td>' + num1.format(avg((r) => wdDerive(r).yearly)) + ' %</td><td>' + money.format(avg((r) => r.w.final)) + '</td><td>−' + num1.format(avg((r) => r.w.dd)) + ' %</td></tr></tfoot>' : '') + '</table></div>';
    h += '<div id="wdBottom"></div>';
    return h;
  }
  /** Bas de la fenêtre : chiffres et 4 graphiques. Ensemble / sélection : une barre par simulation ;
   *  une seule simulation choisie : une barre par mois de cette simulation. */
  function renderWdBottom(st) {
    const box = $('wdBottom');
    if (!box) return;
    const all = st.rows, foc = st.focus && st.focus.length ? all.filter((r) => st.focus.includes(r.key)) : all, one = foc.length === 1 ? foc[0] : null;
    const li = (k, v, c) => '<li><span>' + k + '</span><b class="' + (c || '') + '">' + v + '</b></li>';
    const sec = (id, title, hint) => '<section class="eval-chart"><h4>' + title + '</h4>' + (hint ? '<p class="hint">' + hint + '</p>' : '') + '<div id="' + id + '"></div></section>';
    const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN; };
    if (!one) {
      const D = foc.map(wdDerive), title = foc.length === all.length ? 'Sur l\'ensemble' : 'Sur la sélection (' + foc.map((r) => '#' + r.idx).join(', ') + ')';
      const best = foc.slice().sort((a, b) => b.w.wd - a.w.wd)[0], worst = foc.slice().sort((a, b) => a.w.final / a.capital - b.w.final / b.capital)[0];
      const totMonths = D.reduce((a, d) => a + d.monthly.length, 0), withM = D.reduce((a, d) => a + d.withMonths, 0), firsts = D.map((d) => d.first).filter(Boolean);
      box.innerHTML = '<section class="eval-chart wd-summary"><h4>' + esc(title) + '</h4><p class="hint">Cliquez sur une barre pour passer aux mois de cette simulation.</p><ul class="wd-facts">' +
        li('Somme retirée médiane', money.format(med(foc.map((r) => r.w.wd)))) +
        li('Rente annuelle moyenne', num1.format(mean(D.map((d) => d.yearly))) + ' % du capital par an') +
        li('Mois avec un retrait', Math.round((withM / Math.max(1, totMonths)) * 100) + ' % (' + withM + ' sur ' + totMonths + ')') +
        li('Délai moyen avant le premier retrait', firsts.length ? num1.format(mean(firsts)) + ' mois' : 'aucun retrait') +
        li('Retrait le plus élevé', '#' + best.idx + ' : ' + money.format(best.w.wd)) +
        li('Compte final le plus bas', '#' + worst.idx + ' : ' + num1.format(wdDerive(worst).finalPct) + ' % du capital') +
        li('Compte final médian', num1.format(med(D.map((d) => d.finalPct))) + ' % du capital') +
        li('Écart moyen avec / sans retrait', signed(mean(foc.map((r) => r.w.ret - r.b.ret)), num1) + ' points') + '</ul></section>' +
        '<div class="eval-charts-grid wd-charts">' + sec('wdAmounts', 'Somme retirée par simulation') + sec('wdFinal', 'Compte final (en % du capital de départ)', 'Au-dessus de 100 % : le capital de départ est intact malgré les retraits.') +
        sec('wdYearly', 'Rente annuelle (retraits par an, % du capital)') + sec('wdFirst', 'Délai avant le premier retrait (mois)') + '</div>';
      const labels = foc.map((r) => '#' + r.idx);
      const click = (i) => { st.focus = [foc[i].key]; mountWdCharts(st); wdPaintRows(st); $('wdBottom').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      const range = (a, b) => { st.focus = foc.slice(a, b + 1).map((r) => r.key); mountWdCharts(st); wdPaintRows(st); };
      const small = (id, values, fmt, titles) => F.chart.mountBars($(id), { labels: labels, values: values, format: fmt, height: 170, titles: titles, onBarClick: click, onBarRange: range });
      small('wdAmounts', foc.map((r) => r.w.wd), wdCompact, foc.map((r) => '#' + r.idx + ' : ' + money.format(r.w.wd) + ' retirés en ' + r.w.n + ' fois'));
      small('wdFinal', D.map((d) => d.finalPct - 100), (v) => num1.format(v + 100) + ' %', foc.map((r, i) => '#' + r.idx + ' : compte final ' + money.format(r.w.final) + ' (' + num1.format(D[i].finalPct) + ' % du capital de départ)'));
      small('wdYearly', D.map((d) => d.yearly), (v) => num1.format(v) + ' %', foc.map((r, i) => '#' + r.idx + ' : ' + num1.format(D[i].yearly) + ' % du capital retiré par an'));
      small('wdFirst', D.map((d) => d.first || 0), (v) => num1.format(v), foc.map((r, i) => '#' + r.idx + ' : ' + (D[i].first ? 'premier retrait au mois ' + D[i].first : 'aucun retrait')));
      box.insertAdjacentHTML('beforeend', wdVerdict({ rows: foc }));
      return;
    }
    // une seule simulation : les mois de la vraie simulation
    const r = one, d = wdDerive(r), C = r.curve, cap = r.capital;
    const lab = C.map((p, k) => (/^\d{4}-\d{2}$/.test(p.m || '') ? p.m.slice(5, 7) + '/' + p.m.slice(2, 4) : 'M' + (k + 1)));
    const long = C.map((p, k) => (/^\d{4}-\d{2}$/.test(p.m || '') ? monthLong(p.m) : 'Mois ' + (k + 1)));
    const amt = d.monthly.map((v) => (v * cap) / 100);
    const accPct = C.map((p) => p.acc);
    const ofAcc = C.map((p, k) => (d.monthly[k] > 0 ? (d.monthly[k] / (p.acc + d.monthly[k])) * 100 : 0)); // part du compte retirée ce mois-là
    const gain = C.map((p, k) => { const prev = k ? C[k - 1].acc : 100; return prev > 0 ? ((p.acc + d.monthly[k] - prev) / prev) * 100 : 0; }); // résultat du mois avant retrait
    const gainB = C.map((p, k) => { const prev = k ? C[k - 1].b : 100; return p.b != null && prev > 0 ? ((p.b - prev) / prev) * 100 : null; });
    const kMax = amt.indexOf(Math.max(...amt)), kLow = accPct.indexOf(Math.min(...accPct)), kBest = gain.indexOf(Math.max(...gain)), kWorst = gain.indexOf(Math.min(...gain));
    const wd = amt.filter((v) => v > 0);
    box.innerHTML = '<section class="eval-chart wd-summary"><h4>Sur la simulation #' + r.idx + ', mois par mois</h4><p class="hint">' + frDate(r.from) + ' → ' + frDate(r.to) + ' · ' + C.length + ' mois. ' + (all.length > 1 ? 'Recliquez sur sa barre (ou « Revenir à l\'ensemble ») pour revenir aux graphiques de l\'ensemble.' : '') + '</p><ul class="wd-facts">' +
      li('Retrait mensuel médian', wd.length ? money.format(med(wd)) : '—') +
      li('Mois avec un retrait', d.withMonths + ' sur ' + C.length) +
      li('Plus gros retrait', wd.length ? long[kMax] + ' : ' + money.format(amt[kMax]) : '—') +
      li('Premier retrait', d.first ? long[d.first - 1] : 'aucun') +
      li('Meilleur mois', long[kBest] + ' : ' + signed(gain[kBest], num1) + ' %', 'pos') +
      li('Pire mois', long[kWorst] + ' : ' + signed(gain[kWorst], num1) + ' %', 'neg') +
      li('Compte le plus bas', long[kLow] + ' : ' + num1.format(accPct[kLow]) + ' % du capital', accPct[kLow] < 100 ? 'neg' : '') +
      li('Compte final', money.format(r.w.final) + ' (' + num1.format(d.finalPct) + ' %)', d.finalPct >= 100 ? 'pos' : 'neg') + '</ul></section>' +
      '<div class="eval-charts-grid wd-charts">' + sec('wdAmounts', 'Somme retirée chaque mois') + sec('wdFinal', 'Compte en fin de mois (en % du capital de départ)', 'Au-dessus de 100 % : le capital de départ est intact.') +
      sec('wdYearly', 'Part du compte retirée chaque mois (%)') + sec('wdFirst', 'Résultat de chaque mois (%)', 'Plein : avec retrait (avant le retrait du mois) ; pointillé : sans retrait.') + '</div>';
    const bars = (id, values, fmt, titles, extra) => F.chart.mountBars($(id), Object.assign({ labels: lab, values: values, format: fmt, height: 170, titles: titles }, extra || {}));
    bars('wdAmounts', amt, wdCompact, amt.map((v, k) => long[k] + ' : ' + money.format(v) + ' retirés'));
    bars('wdFinal', accPct.map((v) => v - 100), (v) => num1.format(v + 100) + ' %', accPct.map((v, k) => long[k] + ' : compte à ' + num1.format(v) + ' % du capital (' + money.format((v * cap) / 100) + ')'));
    bars('wdYearly', ofAcc, (v) => num1.format(v) + ' %', ofAcc.map((v, k) => long[k] + ' : ' + num1.format(v) + ' % du compte retiré'));
    bars('wdFirst', gain, (v) => num1.format(v) + ' %', gain.map((v, k) => long[k] + ' : ' + signed(v, num1) + ' % avec retrait' + (gainB[k] != null ? ', ' + signed(gainB[k], num1) + ' % sans retrait' : '')),
      { ghosts: gainB.map((v, i) => (v == null ? null : { i: i, value: v, kind: v > 0 ? 'up' : 'blue' })).filter(Boolean) });
    box.insertAdjacentHTML('beforeend', wdVerdict({ rows: [r] }));
  }
  function wdVerdict(st) {
    const R = st.rows, d = mean(R.map((r) => r.w.ret - r.b.ret)), ruined = R.filter((r) => r.w.final < r.capital * 0.5).length, t = [];
    t.push((R.length > 1 ? 'En moyenne, le' : 'Le') + ' retrait ' + (d < -1 ? 'réduit le résultat global de ' + num1.format(-d) + ' points : l\'argent retiré ne produit plus d\'intérêts composés.' : d > 1 ? 'améliore le résultat global de ' + num1.format(d) + ' points : les gains mis à l\'abri ne sont pas reperdus ensuite.' : 'change peu le résultat global.'));
    if (ruined) t.push(R.length > 1 ? ruined + ' simulation' + (ruined > 1 ? 's finissent' : ' finit') + ' avec moins de la moitié du capital de départ sur le compte : ce rythme de retrait est trop élevé pour elle' + (ruined > 1 ? 's' : '') + '.' : 'Le compte finit avec moins de la moitié du capital de départ : ce rythme de retrait est trop élevé.');
    const flat = R.filter((r) => !r.w.n).length;
    if (flat) t.push(R.length > 1 ? flat + ' simulation' + (flat > 1 ? 's' : '') + ' sans aucun retrait (seuil jamais atteint ou marge toujours bloquée).' : 'Aucun retrait (seuil jamais atteint ou marge toujours bloquée).');
    return '<div class="modal-note wd-verdict">' + t.map((x) => '<p>' + x + '</p>').join('') + '</div>';
  }
  const wdCompact = (v) => (v >= 1e6 ? num1.format(v / 1e6) + ' M' : v >= 1e4 ? Math.round(v / 1e3) + ' k' : Math.round(v).toString());
  function mountWdCharts(st) {
    const R = st.rows, abs = R.map((r) => Math.abs(r.b.ret)).concat(R.map((r) => Math.abs(r.w.ret))).sort((a, b) => a - b);
    const cap = Math.max(20, 2 * (abs[Math.floor(abs.length * 0.9)] || 20)), clip = (v) => Math.max(-cap, Math.min(cap, v));
    const foc = st.focus || [], sel = R.map((r, i) => (foc.includes(r.key) ? i : -1)).filter((i) => i >= 0);
    // clic sur une barre : détail de cette simulation ; glisser : plusieurs ; reclic : retour à l'ensemble
    const click = (i) => { const k = R[i].key; st.focus = foc.length === 1 && foc[0] === k ? null : [k]; mountWdCharts(st); wdPaintRows(st); };
    const range = (a, b) => { st.focus = R.slice(a, b + 1).map((r) => r.key); mountWdCharts(st); wdPaintRows(st); };
    const many = R.length > 1;
    F.chart.mountBars($('wdBars'), {
      labels: R.map((r) => '#' + r.idx), values: R.map((r) => clip(r.b.ret)), format: (v) => num1.format(v) + ' %', height: 210,
      ghosts: R.map((r, i) => ({ i: i, value: clip(r.w.ret), kind: r.w.ret > 0 ? 'up' : 'blue' })),
      topLabels: R.map((r) => ({ long: signed(r.w.ret, num1) + ' %', short: signed(Math.round(r.w.ret), num1), cls: r.w.ret > 0 ? 'pos' : 'neg', sub: r.w.wd ? 'retiré ' + wdCompact(r.w.wd) : 'aucun retrait', subShort: r.w.wd ? wdCompact(r.w.wd) : '0' })),
      titles: R.map((r) => '#' + r.idx + ' · sans retrait ' + signed(r.b.ret, num1) + ' % · avec retrait ' + signed(r.w.ret, num1) + ' % · retiré ' + money.format(r.w.wd) + ' en ' + r.w.n + ' fois'),
      selected: sel, onBarClick: many ? click : null, onBarRange: many ? range : null,
    });
    renderWdBottom(st);
    renderWdFocus(st);
  }
  function wdPaintRows(st) { document.querySelectorAll('#wdBody tr[data-wd-row]').forEach((tr) => tr.classList.toggle('focus', (st.focus || []).includes(tr.dataset.wdRow))); }
  /** Détail de la simulation choisie (ou moyenne de l'ensemble / de la sélection) : indicateurs et courbes. */
  function renderWdFocus(st) {
    const box = $('wdFocus');
    if (!box) return;
    const all = st.rows, F0 = st.focus && st.focus.length ? all.filter((r) => st.focus.includes(r.key)) : all, one = F0.length === 1 ? F0[0] : null;
    const D = F0.map(wdDerive);
    const title = one ? 'Détail de la simulation #' + one.idx + ' · ' + frDate(one.from) + ' → ' + frDate(one.to) : F0.length === all.length ? (all.length > 1 ? 'Évolution moyenne de l\'ensemble (' + all.length + ' simulations)' : 'Évolution de la simulation') : 'Évolution moyenne de la sélection (' + F0.length + ' simulations : ' + F0.map((r) => '#' + r.idx).join(', ') + ')';
    const fact = (k, v, c) => '<div><span>' + k + '</span><b class="' + (c || '') + '">' + v + '</b></div>';
    const wdSum = F0.reduce((a, r) => a + r.w.wd, 0);
    let h = '<div class="wd-focus-head"><h4>' + esc(title) + '</h4>' + (st.focus && st.focus.length && all.length > 1 ? '<button type="button" class="secondary small" id="wdFocusAll">Revenir à l\'ensemble</button>' : '') + '</div>' +
      '<div class="wd-focus-facts">' +
      fact(one ? 'Retiré' : 'Retiré (total)', money.format(wdSum)) +
      fact('Retraits', one ? one.w.n + ' fois' : num1.format(mean(F0.map((r) => r.w.n))) + ' en moyenne') +
      fact('Premier retrait', one ? (D[0].first ? 'mois ' + D[0].first : 'aucun') : (D.some((d) => d.first) ? 'mois ' + num1.format(mean(D.map((d) => d.first).filter(Boolean))) + ' en moyenne' : 'aucun')) +
      fact('Rente annuelle', num1.format(mean(D.map((d) => d.yearly))) + ' % du capital') +
      fact('Résultat sans → avec retrait', signed(mean(F0.map((r) => r.b.ret)), num1) + ' % → ' + signed(mean(F0.map((r) => r.w.ret)), num1) + ' %', cls(mean(F0.map((r) => r.w.ret)))) +
      (() => {
        // gain au bout de 12 mois (fin du 12e mois), sans retrait et avec retrait (compte + sommes retirées)
        const at = (r) => { const k = Math.min(11, r.curve.length - 1), p = r.curve[k]; return { m: k + 1, b: p.b != null ? p.b - 100 : null, w: p.acc + p.wd - 100 }; };
        const G = F0.map(at), full = G.filter((g) => g.m === 12), use = full.length ? full : G;
        const bs = use.map((g) => g.b).filter((v) => v != null), wv = mean(use.map((g) => g.w));
        const label = 'Gain après 1 an sans → avec retrait' + (full.length ? '' : ' (' + (one ? use[0].m + ' mois seulement' : 'moins d\'un an') + ')');
        const txt = (bs.length ? signed(mean(bs), num1) + ' %' : '—') + ' → ' + signed(wv, num1) + ' %';
        const sub = one ? ' (' + (bs.length ? signed((mean(bs) * one.capital) / 100, money) : '—') + ' → ' + signed((wv * one.capital) / 100, money) + ')' : (full.length < F0.length && full.length ? ' · ' + full.length + ' simulation' + (full.length > 1 ? 's' : '') + ' d\'au moins un an' : '');
        return fact(label, txt + '<small class="wd-sub">' + sub + '</small>', cls(wv));
      })() +
      fact('Compte final', one ? money.format(one.w.final) + ' (' + num1.format(D[0].finalPct) + ' %)' : num1.format(mean(D.map((d) => d.finalPct))) + ' % du capital', mean(D.map((d) => d.finalPct)) >= 100 ? 'pos' : 'neg') +
      fact('Drawdown sans → avec retrait', '−' + num1.format(mean(F0.map((r) => r.b.dd))) + ' % → −' + num1.format(mean(F0.map((r) => r.w.dd))) + ' %') + '</div>' +
      '<div class="eval-charts-grid"><section><h5>Compte et retraits, mois par mois</h5><p class="hint">En % du capital de départ' + (one ? '' : ' (moyenne des simulations encore en cours ce mois-là)') + '.</p><div id="wdCurve"></div>' +
      '<div class="legend"><span><i style="background:var(--accent)"></i>Compte avec retrait</span><span><i style="background:var(--muted)"></i>Compte sans retrait</span><span><i style="background:var(--star-edge)"></i>Retraits cumulés</span><span><i style="background:var(--grid)"></i>Capital de départ (100 %)</span></div></section>' +
      (one ? '' : '<section><h5>Retrait de chaque mois</h5><p class="hint">Moyenne, en % du capital de départ.</p><div id="wdMonthly"></div></section>') + '</div>';
    box.innerHTML = h;
    const M = Math.max(...F0.map((r) => r.curve.length));
    const avgAt = (k, f) => { const v = F0.filter((r) => r.curve.length > k).map((r) => f(r.curve[k], r)).filter((x) => x != null && Number.isFinite(x)); return v.length ? mean(v) : NaN; };
    const lab = [], acc = [], wd = [], base = [], mon = [];
    for (let k = 0; k < M; k++) {
      lab.push(one && one.curve[k] && /^\d{4}-\d{2}$/.test(one.curve[k].m) ? one.curve[k].m : 'Mois ' + (k + 1));
      acc.push(avgAt(k, (p) => p.acc)); wd.push(avgAt(k, (p) => p.wd)); base.push(avgAt(k, (p) => (p.b == null ? null : p.b)));
      mon.push(one ? (D[0].monthly[k] || 0) * one.capital / 100 : mean(F0.map((r, i) => (r.curve.length > k ? D[i].monthly[k] : null)).filter((x) => x != null)));
    }
    const series = [{ name: 'Compte avec retrait (% du capital)', values: acc, color: 'var(--accent)', width: 2 }];
    if (base.some(Number.isFinite)) series.push({ name: 'Compte sans retrait (% du capital)', values: base, color: 'var(--muted)', width: 1.5, dash: '5 4' });
    series.push({ name: 'Retraits cumulés (% du capital)', values: wd, color: 'var(--star-edge)', width: 2, fill: true });
    F.chart.mount($('wdCurve'), {
      labels: lab, formatLabel: (s) => (/^\d{4}-\d{2}$/.test(s) ? s.slice(5, 7) + '/' + s.slice(2, 4) : s.replace('Mois ', 'M')),
      panels: [{ height: 220, format: (v) => num1.format(v) + ' %', series: series, refLines: [{ value: 100, color: 'var(--muted)' }] }],
      ariaLabel: 'Compte et retraits cumulés, mois par mois',
    });
    if ($('wdMonthly')) F.chart.mountBars($('wdMonthly'), { labels: lab.map((s) => (/^\d{4}-\d{2}$/.test(s) ? s.slice(5, 7) + '/' + s.slice(2, 4) : s.replace('Mois ', 'M'))), values: mon.map((v) => (Number.isFinite(v) ? v : 0)), height: 200,
      format: one ? (v) => wdCompact(v) : (v) => num1.format(v) + ' %', titles: mon.map((v, k) => lab[k] + ' : ' + (one ? money.format(v || 0) : num1.format(v || 0) + ' % du capital')) });
  }
  $('wdModal').addEventListener('click', (ev) => {
    const t = ev.target;
    if (t.closest('[data-close]')) return closeWdModal();
    if (t.id === 'wdRun') return runWd();
    if (t.id === 'wdStop') { checkStop = true; return; }
    if (t.id === 'wdCmp') return openWdCompare();
    if (t.id === 'wdFxSave') return saveFxFromCompare();
    if (t.id === 'wdFxSaveRun') { const st = wdState, w = st.ran || st.w; return saveFxRows(st.rows, wdNone(w) ? { name: 'Sans retrait', w: { on: false, mode: 'none' } } : { name: (wdPresets().find((p) => p.id === st.presetId) || {}).name || wdDesc(w), w: Object.assign({}, w) }, null); }
    if (t.id === 'wdCmpBack') { wdState.view = null; return wdShowCached(); }
    if (t.id === 'wdCmpRun') { wdState.cmp.a = $('wdCmpA').value; wdState.cmp.b = $('wdCmpB').value; return runWdCompare(); }
    if (t.id === 'wdFocusAll') { wdState.focus = null; mountWdCharts(wdState); return wdPaintRows(wdState); }
    const tr = t.closest('tr[data-wd-row]');
    if (tr && wdState.rows && wdState.rows.length > 1) { const k = tr.dataset.wdRow; wdState.focus = wdState.focus && wdState.focus.length === 1 && wdState.focus[0] === k ? null : [k]; mountWdCharts(wdState); wdPaintRows(wdState); $('wdFocus').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (t.id === 'wdSelAll') { wdState.sel = wdState.all.map((e) => e.key); return wdCommitSel(); }
    if (t.id === 'wdSelNone') { wdState.sel = []; wdPaint(); wdState.rows = null; wdState.status = 'idle'; return renderWdModal(); }
    if (t.id === 'wdSave') {
      wdReadForm();
      const name = (prompt('Nom de cette mécanique de retrait :', wdDesc(wdState.w)) || '').trim().slice(0, 80);
      if (!name) return;
      const l = wdPresets().filter((p) => p.name !== name), p = { id: 'w' + Date.now().toString(36), name: name, w: Object.assign({}, wdState.w) };
      l.push(p); setWdPresets(l); wdState.presetId = p.id;
      logEvent('withdraw.preset', 'Mécanique de retrait enregistrée : ' + name, { w: p.w });
      toast('Mécanique « ' + name + ' » enregistrée : elle est aussi proposée dans « Retrait fictif des gains » du formulaire.', false);
      return renderWdModal();
    }
    if (t.id === 'wdPresetDel') {
      const p = wdPresets().find((x) => x.id === wdState.presetId);
      if (p && confirm('Supprimer la mécanique « ' + p.name + ' » ?')) { setWdPresets(wdPresets().filter((x) => x.id !== p.id)); wdState.presetId = ''; renderWdModal(); }
      return;
    }
    if (t.id === 'wdToForm') {
      wdReadForm();
      const w = Object.assign({}, wdState.w);
      undoable('Mécanique de retrait mise dans le formulaire', () => wdToForm(w));
      return toast('Mécanique mise dans « Retrait fictif des gains » : elle s\'appliquera aux prochaines simulations.', false);
    }
  });
  $('wdModal').addEventListener('change', (ev) => {
    const id = ev.target.id;
    if (checkRunning === 'wd') return;
    if (id === 'wdCmpA' || id === 'wdCmpB') { wdState.cmp[id === 'wdCmpA' ? 'a' : 'b'] = ev.target.value; return; }
    // mécanique enregistrée rechoisie : ses résultats s'affichent (calculés au besoin)
    if (id === 'wdPreset') { const p = wdPresets().find((x) => x.id === ev.target.value); wdState.presetId = ev.target.value; if (p) { wdState.w = Object.assign({}, p.w); return wdShowCached(false); } return renderWdModal(); }
    if (['wdMode', 'wdEvery', 'wdType'].includes(id)) { wdReadForm(); wdState.presetId = ''; return wdShowCached(); }
    // valeur saisie (montant, %, jours) : pas de redessin, sinon le clic qui suit (Resimuler, Enregistrer) serait perdu
    if (['wdValue', 'wdPct', 'wdShare', 'wdDays'].includes(id)) {
      wdReadForm(); wdState.presetId = '';
      if ($('wdPreset')) $('wdPreset').value = '';
      if ($('wdMechHint')) $('wdMechHint').innerHTML = wdMechHint(wdState.w);
      return;
    }
    if (id && id.startsWith('wd')) { wdReadForm(); wdState.presetId = ''; return wdShowCached(); }
  });
  function wdSelLabel() { const n = wdState.sel.length, a = wdState.all.length; return n === a ? 'tout le batch (' + a + ' simulations)' : n ? n + ' simulation' + (n > 1 ? 's' : '') + ' sur ' + a : 'aucune simulation'; }
  let wdDrag = null; // { anchor, base:Set, moved }
  function wdPaint() {
    document.querySelectorAll('#wdPick li').forEach((li) => li.classList.toggle('on', wdState.sel.includes(wdState.all[+li.dataset.i].key)));
    const c = $('wdSelCount'); if (c) c.textContent = wdSelLabel();
  }
  function wdCommitSel() { if (checkRunning === 'wd') return; wdShowCached(); }
  $('wdModal').addEventListener('pointerdown', (ev) => {
    const li = ev.target.closest('#wdPick li');
    if (!li || ev.button || checkRunning === 'wd') return;
    ev.preventDefault();
    const i = +li.dataset.i, key = wdState.all[i].key;
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
      // une par une : ajoute ou retire cette simulation
      wdState.sel = wdState.sel.includes(key) ? wdState.sel.filter((k) => k !== key) : wdState.sel.concat(key);
      wdPaint(); return wdCommitSel();
    }
    wdDrag = { anchor: i, last: i };
    wdState.sel = [key]; wdPaint();
  });
  $('wdModal').addEventListener('pointerover', (ev) => {
    if (!wdDrag) return;
    const li = ev.target.closest('#wdPick li');
    if (!li) return;
    const i = +li.dataset.i;
    if (i === wdDrag.last) return;
    wdDrag.last = i;
    const a = Math.min(wdDrag.anchor, i), b = Math.max(wdDrag.anchor, i);
    wdState.sel = wdState.all.slice(a, b + 1).map((e) => e.key); wdPaint();
  });
  document.addEventListener('pointerup', () => { if (wdDrag) { wdDrag = null; wdCommitSel(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('wdModal').hidden) closeWdModal(); });
  $('evalWdBtn').addEventListener('click', () => openWdModal());
  // « Enregistrer un FX » depuis l'évaluation : simulations affichées (ou sélectionnées), sans préférence de retrait
  $('evalFxBtn').addEventListener('click', async () => {
    if (checkRunning || batchRunning) return toast('Un calcul est déjà en cours : attendez la fin ou arrêtez-le.', false);
    const all = evalFiltered(evalList()).map((x) => x.e).filter((e) => e.strategy && e.config && !e.tag);
    const sel = all.filter((e) => barSel.has(e.key)), T = sel.length ? sel : all;
    if (T.length < 3) return toast('Il faut au moins 3 simulations affichées (ou sélectionnées) pour un FX.', false);
    if (new Set(T.map((e) => e.name)).size > 1) return toast('Les simulations affichées mélangent plusieurs stratégies : choisissez-en une (filtre « Stratégie » ou un batch).', false);
    const none = { on: false, mode: 'none' }, cache = wdResStore.get(), miss = T.filter((e) => !cache[wdKey(none) + '#' + e.key]).length;
    if (miss > 60 && !confirm(miss + ' simulations à recalculer pour construire le FX. Continuer ?')) return;
    if (miss) toast('Construction du FX : ' + miss + ' simulation' + (miss > 1 ? 's' : '') + ' à recalculer, patientez…', false);
    let R = [];
    try { R = await wdCompute(none, T, (i, n) => { $('evalFxBtn').textContent = '💼 Calcul ' + (i + 1) + ' / ' + n + '…'; }); }
    finally { $('evalFxBtn').textContent = '💼 Enregistrer un FX'; }
    if (R.length < 3) return toast('Simulations impossibles à relancer : ' + ($('formError').textContent || 'données indisponibles') + '.', false);
    try { saveFxRows(R, { name: 'Sans retrait', w: none }, null); } catch (e) { console.error(e); toast('FX impossible à construire : ' + e.message, false); }
  });

  // ---------- Analyse temporelle (graphiques de l'évaluation) ----------
  const tDate = (d) => Date.parse(String(d).slice(0, 10) + 'T00:00:00Z');
  /** Frise : chaque simulation est un trait de sa date de début à sa date de fin, à la hauteur de son résultat. */
  function timelineSvg(list, T, cap) {
    const W = 800, H = 256, L = 46, R = 10, TOP = 40, B = 26;
    const x0 = Date.UTC(T.minYear, 0, 1), x1 = Date.UTC(T.maxYear + 1, 0, 1);
    const x = (t) => L + ((t - x0) / (x1 - x0)) * (W - L - R), y = (v) => TOP + ((cap - Math.max(-cap, Math.min(cap, v))) / (2 * cap)) * (H - TOP - B);
    let g = '';
    const band = (z, c) => z ? '<rect class="tl-band ' + c + '" x="' + x(Date.UTC(z.from, 0, 1)).toFixed(1) + '" y="' + TOP + '" width="' + (x(Date.UTC(z.to + 1, 0, 1)) - x(Date.UTC(z.from, 0, 1))).toFixed(1) + '" height="' + (H - TOP - B) + '"><title>Époque ' + (c === 'weak' ? 'faible' : 'forte') + ' : ' + esc(z.label) + '</title></rect>' : '';
    const mine = T.eras.filter((er) => er.custom);
    if (mine.length) {
      // vos époques : bandes colorées avec leur nom
      const xs = (d) => x(Math.max(x0, Math.min(x1, Date.parse(d === '0000-01-01' ? '1900-01-01' : d === '9999-12-31' ? '2999-12-31' : d))));
      mine.forEach((er, k) => {
        const a = xs(er.fromD), b = xs(er.toD);
        if (b - a < 1) return;
        g += '<rect class="tl-era c' + (k % 4) + '" x="' + a.toFixed(1) + '" y="' + TOP + '" width="' + (b - a).toFixed(1) + '" height="' + (H - TOP - B) + '"><title>' + esc(er.label) + '</title></rect>' +
          '<text class="tl-era-label" x="' + (a + 4).toFixed(1) + '" y="' + (H - B - 6) + '">' + esc(er.label.length > Math.max(4, (b - a) / 6.5) ? er.label.slice(0, Math.max(3, Math.floor((b - a) / 6.5))) + '…' : er.label) + '</text>';
      });
    } else g += band(T.weak, 'weak') + band(T.strong, 'strong');
    for (const gp of T.gaps) g += '<rect class="tl-gap" x="' + x(Date.UTC(gp.from, 0, 1)).toFixed(1) + '" y="' + TOP + '" width="' + (x(Date.UTC(gp.to + 1, 0, 1)) - x(Date.UTC(gp.from, 0, 1))).toFixed(1) + '" height="' + (H - TOP - B) + '"><title>Aucune simulation en ' + (gp.from === gp.to ? gp.from : gp.from + '–' + gp.to) + '</title></rect>';
    const span = T.maxYear - T.minYear + 1, step = Math.max(1, Math.ceil(span / 12));
    for (let yv = T.minYear; yv <= T.maxYear + 1; yv += step) g += '<line class="tl-grid" x1="' + x(Date.UTC(yv, 0, 1)).toFixed(1) + '" x2="' + x(Date.UTC(yv, 0, 1)).toFixed(1) + '" y1="' + TOP + '" y2="' + (H - B) + '"/>' + (yv <= T.maxYear ? '<text class="tl-tick" x="' + x(Date.UTC(yv, 6, 1)).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + yv + '</text>' : '');
    for (const v of [cap, cap / 2, 0, -cap / 2, -cap]) g += '<text class="tl-tick" x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + (v > 0 ? '+' : v < 0 ? '−' : '') + Math.round(Math.abs(v)) + '%</text>';
    g += '<line class="tl-zero" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"/>';
    // numéros des événements sur deux rangées quand ils sont trop proches
    const lastX = [-1e9, -1e9];
    (T.events || []).forEach((ev, k) => {
      const xv = x(tDate(ev.date)), row = xv - lastX[0] >= 18 ? 0 : xv - lastX[1] >= 18 ? 1 : 0;
      lastX[row] = xv;
      const cy = row ? TOP - 28 : TOP - 10, xe = xv.toFixed(1);
      g += '<g class="tl-ev"><line x1="' + xe + '" x2="' + xe + '" y1="' + (cy + 8) + '" y2="' + (H - B) + '"/><circle cx="' + xe + '" cy="' + cy + '" r="8"/><text x="' + xe + '" y="' + (cy + 3.5) + '" text-anchor="middle">' + (k + 1) + '</text>' +
        '<title>' + frDate(ev.date) + ' · ' + esc(ev.title) + '</title></g>';
    });
    const all = evalList();
    for (const e of list) {
      const xa = x(tDate(e.from)), xb = Math.max(xa + 3, x(tDate(e.to))), yy = y(e.returnPct).toFixed(1);
      g += '<line class="tl-run ' + (e.returnPct > 0 ? 'up' : 'down') + '" x1="' + xa.toFixed(1) + '" x2="' + xb.toFixed(1) + '" y1="' + yy + '" y2="' + yy + '"><title>#' + (all.findIndex((z) => z.key === e.key) + 1) + ' · ' + frDate(e.from) + ' → ' + frDate(e.to) + ' : ' + signed(e.returnPct, num1) + ' %</title></line>';
    }
    return '<svg class="tl-svg tl-sel" viewBox="0 0 ' + W + ' ' + H + '" data-x0="' + x0 + '" data-x1="' + x1 + '" data-l="' + L + '" data-r="' + R + '" data-w="' + W + '" data-h="' + H + '" role="img" aria-label="Résultat de chaque simulation selon sa période ; glissez pour sélectionner une époque">' + g + '</svg>';
  }
  /** Barres par année (année du milieu de la période) : résultat médian, et part de gagnantes au-dessus. */
  function yearBarsSvg(T, cap) {
    const W = 800, H = 170, L = 46, R = 10, TOP = 22, B = 24, n = T.byYear.length;
    const bw = (W - L - R) / n, y = (v) => TOP + ((cap - Math.max(-cap, Math.min(cap, v))) / (2 * cap)) * (H - TOP - B), y0 = y(0);
    let g = '<line class="tl-zero" x1="' + L + '" x2="' + (W - R) + '" y1="' + y0.toFixed(1) + '" y2="' + y0.toFixed(1) + '"/>';
    const lab = Math.max(1, Math.ceil(n / 16));
    T.byYear.forEach((st, i) => {
      const cx = L + i * bw, yv = y(st.medianRet), top = Math.min(yv, y0), h = Math.max(1, Math.abs(yv - y0));
      g += '<rect class="yb ' + (st.medianRet > 0 ? 'up' : 'down') + '" x="' + (cx + bw * 0.15).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + h.toFixed(1) + '"><title>' + st.year + ' : ' + st.n + ' simulation' + (st.n > 1 ? 's' : '') +
        ', ' + Math.round(st.posRate) + ' % gagnantes, médiane ' + signed(st.medianRet, num1) + ' % (moyenne ' + signed(st.meanRet, num1) + ' %)</title></rect>';
      if (bw >= 26) g += '<text class="yb-rate ' + (st.posRate >= 50 ? 'up' : 'down') + '" x="' + (cx + bw / 2).toFixed(1) + '" y="' + (TOP - 8) + '" text-anchor="middle">' + Math.round(st.posRate) + '%</text>';
      if (i % lab === 0) g += '<text class="tl-tick" x="' + (cx + bw / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + st.year + '</text>';
    });
    for (const v of [cap, 0, -cap]) g += '<text class="tl-tick" x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + (v > 0 ? '+' : v < 0 ? '−' : '') + Math.round(Math.abs(v)) + '%</text>';
    return '<svg class="tl-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Résultat médian par année">' + g + '</svg>';
  }
  let timeLotOpt = null; // {n, from, to} proposé dans la section
  function timeSectionHtml(list) {
    const T = F.advisor.timeline(list, activeEras());
    if (T.n < 2) return '';
    const mainPair = (() => { const c = {}; list.forEach((e) => { c[e.pair] = (c[e.pair] || 0) + 1; }); return Object.keys(c).sort((a, b) => c[b] - c[a])[0]; })();
    T.pair = mainPair;
    T.events = eventsFor(mainPair, { from: T.minYear + '-01-01', to: T.maxYear + '-12-31', minImp: 3 }).filter((e) => e.source !== 'auto' || e.named);
    const abs = list.map((e) => Math.abs(e.returnPct)).sort((a, b) => a - b);
    const cap = Math.max(20, Math.min(2 * (abs[Math.floor(abs.length * 0.9)] || 20), abs[abs.length - 1] || 20));
    const mt5 = list.some((e) => /^MT5/.test(e.data)), ecb = list.some((e) => /^BCE/.test(e.data));
    const warn = [];
    if (mt5 && T.minYear >= 2014) warn.push('Les tirages aléatoires avec MetaTrader 5 commencent en 2015 par défaut : aucune simulation ne couvre les années d\'avant. Pour tester par exemple 1997, choisissez les années ci-dessous (l\'historique de votre courtier MT5 doit remonter jusque-là).');
    if (ecb) warn.push('Les cours BCE commencent en 1999 : pour des années plus anciennes, utilisez MT5 ou un fichier CSV.');
    if (T.gaps.length) warn.push('Années sans simulation : ' + T.gaps.map((g) => (g.from === g.to ? g.from : g.from + '–' + g.to)).join(', ') + ' (zones hachurées).');
    // lot proposé : l'époque faible, sinon le premier trou, sinon les années anciennes
    const def = T.weak ? { from: T.weak.from, to: T.weak.to } : T.gaps.length ? { from: T.gaps[0].from, to: T.gaps[0].to } : { from: Math.max(1996, T.minYear - 10), to: T.minYear };
    timeLotOpt = timeLotOpt && timeLotOpt.list === list.length ? timeLotOpt : { n: 10, from: def.from, to: def.to, list: list.length };
    const weakList = T.weak ? list.filter((e) => { const y = F.advisor.midYear(e); return y >= T.weak.from && y <= T.weak.to; }) : [];
    const worst = weakList.filter((e) => e.strategy && e.config).sort((a, b) => a.returnPct - b.returnPct)[0];
    const lotBtn = (z, txt) => '<button type="button" class="secondary small" data-time-lot="' + z.from + '-' + z.to + '">🎲 ' + txt + '</button>';
    return '<section class="eval-chart time-sec" id="timeSection"><h4>📅 Analyse temporelle</h4>' +
      '<p class="hint">La stratégie marche-t-elle mieux à certaines époques ? Chaque simulation est placée selon ses dates.</p>' +
      '<div class="modal-note">' + T.verdict.map((v) => '<p>' + v + '</p>').join('') + '</div>' +
      (warn.length ? '<div class="banner warn">' + warn.map((w) => '<p>' + w + '</p>').join('') + '</div>' : '') +
      '<h5>Résultat de chaque simulation selon sa période</h5><p class="hint">Un trait = une simulation (du début à la fin de sa période), en hauteur son résultat.' + (T.eras.some((er) => er.custom) ? ' Bandes colorées : vos époques.' : T.weak ? ' Fond rouge : époque faible ; vert : époque forte.' : '') + ' Numéros violets : grands événements de marché (' + esc(mainPair) + '). <b>Glissez la souris sur la frise pour définir une époque.</b></p>' + timelineSvg(list, T, cap) +
      (T.events.length ? '<details class="ev-legend"><summary>Événements numérotés sur la frise (' + T.events.length + ')</summary><ul class="ev-list">' + T.events.map((e, k) => evLine(e, k + 1)).join('') + '</ul></details>' : '') +
      '<div class="row buttons"><button type="button" class="secondary small" data-ev-open="' + esc(mainPair) + '">📰 Tous les événements de ' + esc(mainPair) + '</button></div>' +
      '<h5>Par année</h5><p class="hint">Résultat médian des simulations dont la période est centrée sur l\'année ; au-dessus, la part de gagnantes.</p>' + yearBarsSvg(T, cap) +
      '<div class="era-head"><h5>Par époque</h5><button type="button" class="primary small" id="eraAnalyze">🔬 Analyseur d\'époque</button></div>' +
      '<p class="hint">L\'analyseur d\'époque analyse les époques ci-dessous (marché, trades, événements) pour expliquer ce qui a fait la différence, et teste des corrections sur chacune.</p>' +
      '<div class="eval-charts-grid">' + hbars('Résultat médian par époque', T.byEra) + '</div>' +
      (T.emptyEras.length ? '<p class="hint">Sans simulation : ' + T.emptyEras.map(esc).join(', ') + '.</p>' : '') + eraEditorHtml(T, list) +
      '<div class="time-actions"><b>Vérifier une époque</b><p class="hint">Lance un lot de tests aléatoires limité à ces années (un nouveau batch). Comparez ensuite les deux époques dans « Voir toutes les simulations ».</p>' +
      '<div class="row buttons">' + T.eras.filter((er) => er.custom).map((er) => lotBtn({ from: er.from === -Infinity ? Math.max(1996, T.minYear) : er.from, to: er.to === Infinity ? new Date().getUTCFullYear() : er.to }, '10 tests sur « ' + esc(er.label) + ' »')).join('') +
      (T.weak && !T.eras.some((er) => er.custom) ? lotBtn(T.weak, '10 tests ' + T.weak.label + ' (' + T.weak.from + '–' + T.weak.to + ')') + lotBtn(T.strong, '10 tests ' + T.strong.label + ' (' + T.strong.from + '–' + T.strong.to + ')') : '') +
      (worst ? '<button type="button" class="secondary small" data-time-ana="' + esc(worst.key) + '">🔍 Analyser la pire simulation ' + esc(T.weak.label) + ' (#' + (evalList().findIndex((z) => z.key === worst.key) + 1) + ')</button>' : '') + '</div>' +
      '<div class="row buttons time-lot">Lot de <input id="tlN" type="number" min="1" max="100" value="' + timeLotOpt.n + '"> tests entre <input id="tlFrom" type="number" min="1970" max="2100" value="' + timeLotOpt.from + '"> et <input id="tlTo" type="number" min="1970" max="2100" value="' + timeLotOpt.to + '">' +
      '<button type="button" class="primary small" id="tlRun">🎲 Lancer</button></div></div></section>';
  }
  function launchTimeLot(from, to, n) {
    if (batchRunning || checkRunning) return;
    from = Math.round(from); to = Math.round(to);
    if (!(from >= 1970 && to >= from)) return toast('Années invalides.', false);
    $('randomYFrom').value = from; $('randomYTo').value = to;
    $('batchCount').value = Math.max(1, Math.min(100, Math.round(n) || 10));
    closeEvaluation();
    $('batchCount').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('batchRun').click();
  }
  $('evalBody').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-time-lot],[data-time-ana],#tlRun');
    if (!b) return;
    if (b.dataset.timeLot) { const [f, t] = b.dataset.timeLot.split('-').map(Number); return launchTimeLot(f, t, 10); }
    if (b.dataset.timeAna) return analyzeBar(b.dataset.timeAna);
    if (b.id === 'tlRun') launchTimeLot(+$('tlFrom').value, +$('tlTo').value, +$('tlN').value);
  });
  $('evalBody').addEventListener('input', (ev) => {
    if (!timeLotOpt) return;
    if (ev.target.id === 'tlN') timeLotOpt.n = +ev.target.value; if (ev.target.id === 'tlFrom') timeLotOpt.from = +ev.target.value; if (ev.target.id === 'tlTo') timeLotOpt.to = +ev.target.value;
  });
  /** Mini-frise d'un batch (onglet Batchs) : un point par simulation, à l'année de son milieu, vert ou rouge. */
  function batchDotsSvg(entries, y0, y1) {
    const W = 140, H = 26, span = Math.max(1, y1 - y0 + 1), x = (t) => 4 + ((t - Date.UTC(y0, 0, 1)) / (Date.UTC(y0 + span, 0, 1) - Date.UTC(y0, 0, 1))) * (W - 8);
    let g = '<line class="tl-zero" x1="2" x2="' + (W - 2) + '" y1="13" y2="13"/>';
    for (const e of entries) {
      const m = (tDate(e.from) + tDate(e.to)) / 2;
      g += '<circle class="' + (e.returnPct > 0 ? 'up' : 'down') + '" cx="' + x(m).toFixed(1) + '" cy="' + (e.returnPct > 0 ? 8 : 18) + '" r="3"><title>' + frDate(e.from) + ' → ' + frDate(e.to) + ' : ' + signed(e.returnPct, num1) + ' %</title></circle>';
    }
    return '<svg class="batch-dots" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Simulations du batch dans le temps">' + g + '</svg><small class="eval-tag">' + y0 + ' → ' + y1 + '</small>';
  }

  // ---------- Batchs : lots de simulations enregistrés, rechargeables ----------
  const BATCH_KEY = 'forexia.batches';
  const batchStore = {
    get() { try { return JSON.parse(localStorage.getItem(BATCH_KEY)) || []; } catch (e) { return batchMemory || []; } },
    set(list) { batchMemory = list; if (!lsSet(BATCH_KEY, JSON.stringify(list))) lsFullToast('le batch'); },
  };
  let batchMemory = null;
  let evalBatch = null; // batch rechargé : { id, keys:Set } — le tableau et les graphiques ne montrent que ses simulations
  /** Chiffres d'un batch : devise(s), durées extrêmes, rendement, probabilité de gain, capital moyen. */
  function batchStats(entries) {
    const n = entries.length, days = entries.map((e) => durationDays(e.from, e.to));
    const dmin = Math.min(...days), dmax = Math.max(...days);
    const lmin = durationFromDays(dmin), lmax = durationFromDays(dmax);
    const finals = entries.map((e) => (e.capital || 0) * (1 + e.returnPct / 100));
    const cap = entries.reduce((a, e) => a + (e.capital || 0), 0), gain = entries.reduce((a, e) => a + ((e.capital || 0) * e.returnPct) / 100, 0);
    return {
      n: n, pairs: [...new Set(entries.map((e) => e.pair))].join(', '), data: [...new Set(entries.map((e) => e.data))].join(', '),
      strategies: [...new Set(entries.map((e) => e.name))],
      span: lmin === lmax ? lmin : 'entre ' + lmin + ' et ' + lmax,
      from: entries.map((e) => e.from).sort()[0], to: entries.map((e) => e.to).sort().pop(),
      winRate: n ? (entries.filter((e) => e.returnPct > 0).length / n) * 100 : 0,
      avgReturn: mean(entries.map((e) => e.returnPct)), globalReturn: cap > 0 ? (gain / cap) * 100 : 0,
      avgStart: mean(entries.map((e) => e.capital || 0)), avgFinal: mean(finals), avgGainPct: mean(entries.map((e) => e.avgGainPct || 0)),
      avgDD: mean(entries.map((e) => e.maxDrawdownPct || 0)), leverage: [...new Set(entries.map((e) => '1:' + e.leverage))].join(', '),
    };
  }
  function saveBatch(entries, name) {
    if (!entries.length) return null;
    const st = batchStats(entries);
    const def = (st.strategies.length === 1 ? st.strategies[0] : 'Plusieurs stratégies') + ' · ' + st.pairs + ' · ' + st.n + ' simulations';
    const nm = name || (prompt('Nom du batch :', def) || '').trim().slice(0, 100);
    if (!nm) return null;
    const b = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: nm, at: new Date().toISOString(), entries: entries.map((e) => Object.assign({}, e)) };
    const list = batchStore.get(); list.push(b); batchStore.set(list);
    logEvent('batch.saved', 'Batch enregistré : ' + nm + ' (' + st.n + ' simulations, ' + Math.round(st.winRate) + ' % gagnantes)', { id: b.id });
    toast('Batch « ' + nm + ' » enregistré (' + st.n + ' simulations).', false);
    updateBatchCount();
    return b;
  }
  // Un lot de tests aléatoires crée automatiquement son batch, rempli au fur et à mesure ; l'évaluation s'ouvre dessus.
  let activeBatchId = '';
  function startLotBatch(n) {
    const st = currentStrategy(), d = new Date();
    const b = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: d.toISOString(), auto: true, entries: [],
      name: st.name + ' · ' + $('pair').value + ' · lot de ' + n + ($('randomYFrom').value || $('randomYTo').value ? ' · ' + ($('randomYFrom').value || '…') + '–' + ($('randomYTo').value || '…') : '') + ' · ' + d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) };
    const list = batchStore.get(); list.push(b); batchStore.set(list);
    activeBatchId = b.id;
    evalBatch = { id: b.id, keys: new Set() };
    updateBatchCount();
    return b;
  }
  function addToLotBatch(lot, e) {
    if (!e) return;
    const list = batchStore.get(), b = list.find((x) => x.id === lot.id);
    if (!b) return;
    b.entries.push(Object.assign({}, e)); batchStore.set(list);
    if (evalBatch && evalBatch.id === b.id) evalBatch.keys.add(e.key);
    if (!$('evalModal').hidden) renderEvaluation();
  }
  function dropLotBatch(lot) {
    batchStore.set(batchStore.get().filter((x) => x.id !== lot.id));
    if (activeBatchId === lot.id) activeBatchId = '';
    if (evalBatch && evalBatch.id === lot.id) evalBatch = null;
    updateBatchCount();
  }
  function updateBatchCount() { const n = batchStore.get().length; if ($('evalScopeBatchN')) $('evalScopeBatchN').textContent = n; }
  function batchSaveButton(id) { return '<button type="button" class="secondary small batch-save" id="' + id + '" title="Enregistrer les simulations affichées comme un lot (Batch) que vous pourrez recharger">💾 Enregistrer un batch</button>'; }
  function renderBatches() {
    const list = batchStore.get();
    if (!list.length) {
      $('evalBody').innerHTML = '<p class="eval-empty">Aucun batch enregistré. Lancez un lot de tests (section « Période de backtesting »), puis « 💾 Enregistrer un batch » ' +
        'dans les onglets « Stratégie en cours » ou « Historique complet ».</p>';
      return;
    }
    const p = (v) => '<span class="' + cls(v) + '">' + signed(v, num1) + ' %</span>';
    const allE = list.flatMap((b) => b.entries), gy0 = Math.min(...allE.map((e) => +e.from.slice(0, 4))), gy1 = Math.max(...allE.map((e) => +e.to.slice(0, 4)));
    const rows = list.map((b, i) => {
      const s = batchStats(b.entries);
      return '<tr><td class="l name" title="' + esc(b.name) + '"><b>' + esc(b.name) + '</b><small class="eval-tag">' + (s.strategies.length > 1 || b.name.indexOf(s.strategies[0]) < 0 ? esc(s.strategies.join(', ')) + ' · ' : '') + 'enregistré le ' +
        new Date(b.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) + '</small></td>' +
        '<td class="l">' + esc(s.pairs) + '</td><td class="l">' + esc(s.span) + '<small class="eval-tag">' + frDate(s.from) + ' → ' + frDate(s.to) + '</small></td>' +
        '<td>' + s.n + '</td><td title="Moyenne des résultats de chaque simulation (rendement global : ' + signed(s.globalReturn, num1) + ' %)">' + p(s.avgReturn) + '</td>' +
        '<td><span class="batch-rate ' + (s.winRate >= 50 ? 'pos' : 'neg') + '">' + Math.round(s.winRate) + ' %</span></td>' +
        '<td title="Capital de départ moyen : ' + money.format(s.avgStart) + '">' + money.format(s.avgFinal) + '<small class="eval-tag">départ ' + money.format(s.avgStart) + '</small></td>' +
        '<td>−' + num1.format(s.avgDD) + ' %</td><td class="l">' + (b.entries.length ? batchDotsSvg(b.entries, gy0, gy1) : '') + '</td>' +
        '<td class="batch-acts"><button type="button" class="reload" data-batch-load="' + i + '">Recharger</button>' +
        '<button type="button" class="ghost small" data-batch-ren="' + i + '" title="Renommer" aria-label="Renommer le batch">✏️</button>' +
        '<button type="button" class="ghost small" data-batch-del="' + i + '" title="Supprimer" aria-label="Supprimer le batch">🗑</button></td></tr>';
    }).join('');
    $('evalBody').innerHTML = '<p class="hint">Un batch est un lot de simulations enregistré ensemble (par exemple un lot de tests aléatoires). « Recharger » remet la stratégie dans le formulaire ' +
      'et affiche les simulations du batch dans les graphiques (avec l\'analyse temporelle), où vous pouvez les prolonger, les améliorer, etc.</p>' +
      '<div class="table-wrap"><table class="eval batch-table"><thead><tr><th class="l">Batch</th><th class="l">Devise</th><th class="l">Période des simulations</th><th>Simulations</th>' +
      '<th>Rendement moyen</th><th>Probabilité de gain</th><th>Capital moyen (final)</th><th>Drawdown moyen</th><th class="l" title="Un point par simulation, placé à l\'année du milieu de sa période (même échelle pour tous les batchs) ; en haut vert = gagnante, en bas rouge = perdante">Dans le temps</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function loadBatch(b) {
    // les simulations du batch retournent dans l'historique si elles en ont été effacées
    const list = evalList(), have = new Set(list.map((e) => e.key));
    const missing = b.entries.filter((e) => !have.has(e.key));
    if (missing.length) evalSave(list.concat(missing.map((e) => Object.assign({}, e))));
    const first = b.entries.find((e) => e.strategy);
    if (first) undoable('Batch rechargé', () => {
      loadStrategy(first.strategy); if (first.config) applyConfig(first.config);
      $('preset').value = 'mine'; $('deleteStrat').hidden = true;
      $('presetDesc').textContent = 'Batch « ' + b.name + ' » rechargé (' + b.entries.length + ' simulations).';
      updateStyleHint();
    });
    evalBatch = { id: b.id, keys: new Set(b.entries.map((e) => e.key)) };
    activeBatchId = b.id;
    evalScope = 'current';
    evalView = 'charts';
    document.querySelectorAll('.eval-views [data-view]').forEach((x) => x.setAttribute('aria-selected', x.dataset.view === 'charts'));
    renderEvaluation();
  }
  function batchBanner() {
    if (!evalBatch) return '';
    const b = batchStore.get().find((x) => x.id === evalBatch.id);
    if (!b) { evalBatch = null; return ''; }
    return '<div class="banner info batch-banner"><span>Batch <b>« ' + esc(b.name) + ' »</b> : seules ses ' + evalBatch.keys.size + ' simulations sont affichées.</span>' +
      '<span class="row buttons"><button type="button" class="secondary small" id="batchUpdate" title="Enregistrer dans ce batch l\'état actuel de ses simulations (prolongées, améliorées…)">Mettre à jour le batch</button>' +
      '<button type="button" class="secondary small" id="batchLeave">Voir toutes les simulations</button></span></div>';
  }
  $('evalModal').addEventListener('click', (e) => {
    const t = e.target.closest('[data-batch-load],[data-batch-ren],[data-batch-del],#batchUpdate,#batchLeave,.batch-save');
    if (!t) return;
    const list = batchStore.get();
    if (t.dataset.batchLoad != null) return loadBatch(list[+t.dataset.batchLoad]);
    if (t.dataset.batchRen != null) {
      const b = list[+t.dataset.batchRen], nm = (prompt('Nouveau nom du batch :', b.name) || '').trim().slice(0, 100);
      if (nm) { b.name = nm; batchStore.set(list); renderEvaluation(); }
      return;
    }
    if (t.dataset.batchDel != null) {
      const b = list[+t.dataset.batchDel];
      if (!confirm('Supprimer le batch « ' + b.name + ' » ? Ses simulations restent dans l\'historique.')) return;
      list.splice(+t.dataset.batchDel, 1); batchStore.set(list);
      if (evalBatch && evalBatch.id === b.id) evalBatch = null;
      if (activeBatchId === b.id) activeBatchId = '';
      updateBatchCount(); renderEvaluation();
      return;
    }
    if (t.id === 'batchUpdate' && evalBatch) {
      const b = list.find((x) => x.id === evalBatch.id), cur = evalList().filter((x) => evalBatch.keys.has(x.key));
      if (b && cur.length) { b.entries = cur.map((x) => Object.assign({}, x)); b.updatedAt = new Date().toISOString(); batchStore.set(list); toast('Batch « ' + b.name + ' » mis à jour.', false); }
      return;
    }
    if (t.id === 'batchLeave') { evalBatch = null; activeBatchId = ''; return renderEvaluation(); }
    if (t.classList.contains('batch-save')) {
      const shown = evalFiltered(evalList()).map((x) => x.e);
      if (saveBatch(shown) && evalScope === 'batch') renderEvaluation();
    }
  });
  $('evalScopeBatch').addEventListener('click', () => setEvalScope('batch'));

  function currentStratName() { return currentStrategy().name; }
  function updateEvalCount() {
    const all = evalList(), name = currentStratName(), n = all.filter((e) => e.name === name).length;
    $('evalCount').textContent = n;
    $('evalBtn').title = n + ' simulation(s) de « ' + name + ' » · ' + all.length + ' au total dans l\'historique';
  }
  function setEvalScope(scope) {
    evalScope = scope;
    evalBatch = null; activeBatchId = '';
    $('evalScopeCurrent').setAttribute('aria-selected', scope === 'current');
    $('evalScopeAll').setAttribute('aria-selected', scope === 'all');
    $('evalScopeBatch').setAttribute('aria-selected', scope === 'batch');
    renderEvaluation();
  }
  function dataLabel(loaded, settings) {
    if (loaded.broker) return 'MT5 ' + (settings.symbol || '') + ' ' + (loaded.timeframe || '');
    if (/^Fichier/.test(loaded.source)) return 'CSV ' + (loaded.timeframe || '');
    if (/BCE/.test(loaded.source)) return 'BCE' + (/mèches/.test(loaded.source) ? ' + mèches' : '');
    return 'Simulées';
  }
  function recordEvaluation(c, noRecord) {
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
    if ((noRecord || evalNoRecord) && !evalReplaceKey) return; // simulation d'analyse (« Améliorer » depuis un rapport) : rien n'est ajouté au tableau
    if (evalTag) entry.tag = evalTag;
    entry.key = entry.at + '|' + entry.name;
    const list = evalList();
    // Prolongation : la simulation d'origine est remplacée (même ligne), en gardant son résultat de départ.
    const ri = evalReplaceKey ? list.findIndex((x) => x.key === evalReplaceKey) : -1;
    if (ri >= 0) {
      const old = list[ri];
      entry.key = old.key; entry.at = old.at;
      entry.extended = old.extended || { from: old.from, to: old.to, returnPct: old.returnPct, maxDrawdownPct: old.maxDrawdownPct, trades: old.trades, capital: old.capital };
      if (old.tag) entry.tag = old.tag;
      if (evalMarkImproved || old.improved) entry.improved = true;
      list[ri] = entry;
      evalSave(list);
      const fullR = Object.assign({}, entry, { tradeList: c.result.trades.map((t) => ({
        dir: t.dir, entryDate: t.entryDate, exitDate: t.exitDate, entryPrice: t.entryPrice, exitPrice: t.exitPrice, lots: t.lots, pips: t.pips, pnl: t.pnl, reason: t.reason })) });
      dbPush('simulations/put', fullR);
      cloudPush(() => C.putSimulations([fullR]));
      return;
    }
    const last = list[list.length - 1];
    // Même stratégie, mêmes réglages, même résultat : on ne compte pas deux fois la même simulation.
    const same = (a, b) => a && ['name', 'pair', 'from', 'to', 'data', 'leverage', 'capital', 'rules'].every((k) => a[k] === b[k]) && Math.abs(a.returnPct - b.returnPct) < 1e-9;
    // simulation identique déjà dans le tableau (ex. rechargée puis relancée) : pas de doublon
    if (same(last, entry) || list.some((x) => same(x, entry))) return;
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
    if (evalBatch) return list.map((e, i) => ({ e: e, i: i })).filter(({ e }) => evalBatch.keys.has(e.key));
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
    updateBatchCount();
    const isBatch = evalScope === 'batch';
    document.querySelector('.eval-views').hidden = isBatch;
    $('evalSaveBatch').hidden = isBatch || !!evalBatch;
    $('evalClear').hidden = $('evalExport').hidden = isBatch;
    if (evalBatch) { $('evalScopeCurrent').setAttribute('aria-selected', 'false'); $('evalScopeAll').setAttribute('aria-selected', 'false'); $('evalScopeBatch').setAttribute('aria-selected', 'true'); }
    if (isBatch) {
      $('evalTitle').textContent = 'Batchs enregistrés';
      $('evalFilters').hidden = true; $('evalExport').disabled = true;
      return renderBatches();
    }
    $('evalTitle').textContent = evalBatch ? 'Batch « ' + ((batchStore.get().find((x) => x.id === evalBatch.id) || {}).name || '') + ' »' : evalScope === 'current' ? 'Évaluation de « ' + name + ' »' : 'Historique des simulations';
    // dans l'onglet « Stratégie en cours », le choix de stratégie et la recherche n'ont pas lieu d'être
    $('evalFStratField').hidden = evalScope === 'current';
    $('evalFSearch').closest('label').hidden = evalScope === 'current';
    $('evalFilters').hidden = !all.length || !!evalBatch;
    $('evalClear').disabled = $('evalResetAll').disabled = !all.length;
    $('evalFReset').hidden = !['evalFStrat', 'evalFPair', 'evalFData', 'evalFResult'].some((id) => $(id).value) && !$('evalFSearch').value;
    if (!all.length) { $('evalExport').disabled = true; $('evalBody').innerHTML = '<p class="eval-empty">Aucune simulation pour l\'instant : lancez un backtest, il s\'ajoutera ici.</p>'; return; }
    const shown = evalFiltered(all);
    $('evalExport').disabled = !shown.length;
    $('evalSaveBatch').disabled = !shown.length;
    if (!shown.length) {
      $('evalBody').innerHTML = evalScope === 'current' && !mineN
        ? '<p class="eval-empty">Aucune simulation de « ' + esc(name) + ' » pour l\'instant : lancez un backtest. Les ' + all.length + ' simulations précédentes sont dans <button type="button" class="link" id="evalGoAll">l\'historique complet</button>.</p>'
        : '<p class="eval-empty">Aucune simulation ne correspond à ces filtres.</p>';
      const go = $('evalGoAll'); if (go) go.addEventListener('click', () => setEvalScope('all'));
      return;
    }
    const list = shown.map((x) => x.e);
    const filt = shown.length < all.length && !evalBatch;
    if (evalView === 'charts') { renderEvalCharts(list, filt); wireTimeline(); return addBatchBanner(); }
    if (evalView === 'reco') { renderEvalReco(list, filt); return addBatchBanner(); }
    const p = (v) => '<span class="' + cls(v) + '">' + signed(v, num2) + ' %</span>';
    const rows = shown.map(({ e, i }) => '<tr>' +
      '<td>' + (i + 1) + '</td><td class="l">' + new Date(e.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) + '</td>' +
      '<td class="name" title="' + esc(e.name + (e.tag ? ' — ' + e.tag : '')) + '">' + esc(e.name) + (e.tag ? '<small class="eval-tag">' + esc(e.tag) + '</small>' : '') +
        (e.extended ? '<small class="eval-tag">' + changeLabel(e) + ' (origine ' + frDate(e.extended.from) + ' → ' + frDate(e.extended.to) +
          (e.extended.capital && e.extended.capital !== e.capital ? ', capital ' + money.format(e.extended.capital) : '') + ' : ' + signed(e.extended.returnPct, num1) + ' %)</small>' : '') + '</td><td class="l">' + esc(e.pair) + '</td>' +
      '<td class="l">' + frDate(e.from) + ' → ' + frDate(e.to) + '</td><td class="l" title="' + durationDays(e.from, e.to) + ' jours">' + durationLabel(e.from, e.to) + '</td>' +
      '<td class="l">' + esc(e.data) + '</td>' +
      '<td>1:' + e.leverage + '</td><td>' + money.format(e.capital) + '</td>' +
      '<td>' + p(e.returnPct) + '</td><td class="avg-col">' + p(e.avgGainPct) + '</td><td class="' + cls(e.monthlyGain || 0) + '">' + (e.monthlyGain == null ? '—' : signed(e.monthlyGain, money)) + '</td><td>' + (e.withdrawn ? money.format(e.withdrawn) : '—') + '</td>' +
      '<td>' + e.trades + '</td><td>' + num1.format(e.winRate) + ' %</td><td>−' + num1.format(e.maxDrawdownPct) + ' %</td>' +
      '<td>' + (e.strategy ? '<button type="button" class="reload" data-reload="' + i + '" title="Remettre cette stratégie et ses réglages dans le formulaire">Recharger</button>' : '') + '</td>' +
      '<td><button type="button" class="del" data-del="' + i + '" title="Retirer cette ligne" aria-label="Retirer la simulation ' + (i + 1) + '">✕</button></td></tr>').join('');
    const filtered = evalScope === 'all' && shown.length < all.length && !evalBatch;
    const foot = '<tr><td colspan="5" class="l">Moyenne sur ' + list.length + ' simulation' + (list.length > 1 ? 's' : '') + (filtered ? ' (filtrées)' : '') + '</td><td class="l">' + durationFromDays(mean(list.map((e) => durationDays(e.from, e.to)))) + '</td><td colspan="3"></td>' +
      '<td>' + p(mean(list.map((e) => e.returnPct))) + '</td><td class="avg-col" title="Moyenne des gains moyens">' + p(mean(list.map((e) => e.avgGainPct))) + '</td><td>' + signed(mean(list.filter((e) => e.monthlyGain != null).map((e) => e.monthlyGain)), money) + '</td><td>' + money.format(mean(list.map((e) => e.withdrawn || 0))) + '</td>' +
      '<td>' + num1.format(mean(list.map((e) => e.trades))) + '</td><td>' + num1.format(mean(list.map((e) => e.winRate))) + ' %</td>' +
      '<td>−' + num1.format(mean(list.map((e) => e.maxDrawdownPct))) + ' %</td><td></td><td></td></tr>';
    $('evalBody').innerHTML = (filtered ? '<p class="eval-count">' + shown.length + ' simulation(s) affichée(s) sur ' + all.length + '</p>' : '') + spacingHtml(list) + '<div class="table-wrap"><table class="eval"><thead><tr><th>#</th><th class="l">Date</th><th class="l">Stratégie</th><th class="l">Paire</th>' +
      '<th class="l">Période testée</th><th class="l">Durée</th><th class="l">Données</th><th>Levier</th><th>Capital</th><th>Résultat</th><th class="avg-col">Gain moyen</th><th>Par mois</th><th>Retiré</th>' +
      '<th>Trades</th><th>Gagnants</th><th>Drawdown</th><th></th><th></th></tr></thead><tbody>' + rows + '</tbody><tfoot>' + foot + '</tfoot></table></div>';
    addBatchBanner();
  }
  function addBatchBanner() { const h = batchBanner(); if (h) $('evalBody').insertAdjacentHTML('afterbegin', h); }
  // ---------- Graphiques et recommandations (sur les simulations affichées) ----------
  let evalView = 'table';
  document.querySelectorAll('.eval-views [data-view]').forEach((b) => b.addEventListener('click', () => {
    evalView = b.dataset.view;
    document.querySelectorAll('.eval-views [data-view]').forEach((x) => x.setAttribute('aria-selected', x === b));
    renderEvaluation();
  }));
  const pctTxt = (v) => signed(v, num1) + ' %';
  /** Barres horizontales : résultat médian par groupe (vert gagnant, rouge perdant), avec le détail en clair. */
  function hbars(title, groups, note) {
    if (!groups.length) return '';
    const max = Math.max(1e-9, ...groups.map((g) => Math.abs(g.medianRet)));
    const neg = groups.some((g) => g.medianRet < 0);
    return '<section class="eval-chart"><h4>' + esc(title) + '</h4>' + (note ? '<p class="hint">' + note + '</p>' : '') + '<div class="hbars' + (neg ? ' has-neg' : '') + '">' +
      groups.slice(0, 12).map((g) => {
        const w = (Math.abs(g.medianRet) / max) * (neg ? 50 : 100);
        const detail = g.n + ' simulation' + (g.n > 1 ? 's' : '') + ' · ' + Math.round(g.posRate) + ' % gagnantes · drawdown moyen −' + num1.format(g.meanDD) + ' %';
        return '<div class="hbar" title="' + esc(g.label + ' : médiane ' + pctTxt(g.medianRet) + ' (moyenne ' + pctTxt(g.meanRet) + ') · ' + detail) + '">' +
          '<div class="hb-label"><span class="nm">' + esc(g.label) + '</span><span class="dt">' + esc(detail) + '</span></div>' +
          '<div class="hb-track"><span class="hb-fill ' + (g.medianRet >= 0 ? 'up' : 'down') + '" style="' + (neg ? (g.medianRet >= 0 ? 'left:50%;' : 'right:50%;') : 'left:0;') + 'width:' + w.toFixed(1) + '%"></span></div>' +
          '<div class="hb-val ' + cls(g.medianRet) + '">' + pctTxt(g.medianRet) + '</div></div>';
      }).join('') + '</div></section>';
  }
  /** Cercle : simulations gagnantes / perdantes, et au centre le rendement global (gains cumulés / capitaux engagés). */
  function winDonut(listIn) {
    const n = listIn.length;
    if (!n) return '';
    // aperçu d'une amélioration (« ✨ Améliorer et simuler » pas encore ajoutée) : le cercle montre les résultats prévus
    const pv = improveCtx && improveCtx.kind === 'sel' && improveCtx.after ? improveCtx : null;
    const before = pv ? { rate: Math.round((listIn.filter((e) => e.returnPct > 0).length / n) * 100), avg: listIn.reduce((a, e) => a + e.returnPct, 0) / n } : null;
    const list = pv ? listIn.map((e) => { const k = pv.T.findIndex((c) => c.e.key === e.key); return k >= 0 ? Object.assign({}, e, { returnPct: pv.after[k].returnPct }) : e; }) : listIn;
    const win = list.filter((e) => e.returnPct > 0).length, lose = n - win;
    const cap = list.reduce((a, e) => a + (e.capital || 0), 0), gain = list.reduce((a, e) => a + (e.capital || 0) * e.returnPct / 100, 0);
    const glob = cap > 0 ? (gain / cap) * 100 : 0;
    const avg = list.reduce((a, e) => a + e.returnPct, 0) / n; // moyenne des résultats de chaque simulation
    const rate = Math.round((win / n) * 100);
    const big = (v) => signed(v, Math.abs(v) < 10 ? num1 : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })) + ' %';
    const R = 34, C = 2 * Math.PI * R, fw = (win / n) * C;
    const arc = (len, off, color) => len > 0 ? '<circle r="' + R + '" cx="50" cy="50" fill="none" stroke="' + color + '" stroke-width="12" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) +
      '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 50 50)"/>' : '';
    const gap = win && lose ? 1.5 : 0;
    return '<div class="win-donut" title="' + win + ' simulation(s) gagnante(s), ' + lose + ' perdante(s) · gain moyen ' + signed(avg, num1) + ' % par simulation · gains cumulés ' + signed(gain, money) + ' sur ' + money.format(cap) + ' engagés (' + signed(glob, num1) + ' %)">' +
      '<svg viewBox="0 0 100 100" role="img" aria-label="' + rate + ' % de simulations gagnantes (' + win + ' sur ' + n + '), gain moyen ' + signed(avg, num1) + ' %">' +
      '<circle r="' + R + '" cx="50" cy="50" fill="none" class="donut-track" stroke-width="12"/>' +
      arc(Math.max(0, fw - gap), gap / 2, 'var(--up)') + arc(Math.max(0, C - fw - gap), fw + gap / 2, 'var(--down)') +
      '<text x="50" y="50" text-anchor="middle" class="donut-val">' + rate + ' %</text>' +
      '<text x="50" y="63" text-anchor="middle" class="donut-sub">' + (pv ? 'aperçu' : 'de réussite') + '</text></svg>' +
      '<div class="donut-legend"><span><i style="background:var(--up)"></i>' + win + ' gagnante' + (win > 1 ? 's' : '') + '</span><span><i style="background:var(--down)"></i>' + lose + ' perdante' + (lose > 1 ? 's' : '') + '</span>' +
      '<span class="donut-avg">Gain moyen : <b class="' + cls(avg) + '">' + big(avg) + '</b></span>' +
      (pv ? '<span class="hint donut-before">Avant l\'amélioration : ' + before.rate + ' % de réussite, gain moyen ' + big(before.avg) + '</span>' : '') + '</div></div>';
  }
  /** Écart dans le temps entre deux simulations (dates de début rangées dans l'ordre) : moyenne, écart type, extrêmes,
   *  et part des simulations qui chevauchent la suivante. */
  function spacingStats(list) {
    const L = list.filter((e) => e.from && e.to).slice().sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    if (L.length < 3) return null;
    const d = [];
    let over = 0;
    for (let i = 1; i < L.length; i++) { d.push(durationDays(L[i - 1].from, L[i].from)); if (L[i].from <= L[i - 1].to) over++; }
    const m = mean(d), sd = Math.sqrt(d.reduce((a, v) => a + (v - m) * (v - m), 0) / Math.max(1, d.length - 1));
    return { n: L.length, mean: m, sd: sd, min: Math.min(...d), max: Math.max(...d), overlap: (over / d.length) * 100, from: L[0].from, to: L[L.length - 1].to };
  }
  const spanTxt = (days) => (days < 60 ? Math.round(days) + ' j' : num1.format(days / 30.4375) + ' mois');
  function spacingHtml(list) {
    const g = spacingStats(list);
    if (!g) return '';
    return '<p class="eval-count eval-spacing" title="Dates de début des simulations rangées dans l\'ordre du temps ; écart entre chacune et la suivante. Un écart type faible = simulations régulièrement réparties ; élevé = regroupées par endroits avec des trous.">' +
      '⏱ Écart entre deux simulations : <b>' + spanTxt(g.mean) + '</b> en moyenne, écart type <b>' + spanTxt(g.sd) + '</b> (de ' + spanTxt(g.min) + ' à ' + spanTxt(g.max) + ') · ' +
      Math.round(g.overlap) + ' % chevauchent la suivante · du ' + frDate(g.from) + ' au ' + frDate(g.to) + '</p>';
  }
  function renderEvalCharts(list, filtered) {
    const A = F.advisor.analyze(list), G = A.groups;
    $('evalBody').innerHTML = (filtered ? '<p class="eval-count">Graphiques sur les ' + list.length + ' simulations affichées (filtres appliqués).</p>' : '') + spacingHtml(list) +
      '<section class="eval-chart"><div class="runs-head"><div><h4>Résultat de chaque simulation</h4><p class="hint">Dans l\'ordre où elles ont été lancées ; survolez une barre pour le détail.</p></div><div class="runs-side">' + winDonut(list) + (evalBatch ? '' : batchSaveButton('chartSaveBatch')) + '</div></div><div id="evalRunsChart"></div>' +
      checkToolsHtml(list) + '</section>' + timeSectionHtml(list) +
      '<p class="hint">Les barres ci-dessous montrent le résultat <b>médian</b> (la moitié des simulations fait mieux, l\'autre moins bien) : un résultat extrême ne fausse pas la comparaison. La moyenne est dans l\'info-bulle.</p>' +
      '<div class="eval-charts-grid">' +
      hbars('Résultat médian par stratégie', G.strategy) +
      hbars('Résultat médian par paire', G.pair) +
      hbars('Selon la durée de la période', G.horizon, 'Une stratégie de long terme réussit surtout sur les longues périodes, une de court terme sur les courtes.') +
      hbars('Selon le retrait', G.withdraw, 'Résultat « compte + retraits ».') +
      hbars('Selon le levier', G.leverage) +
      hbars('Selon les données', G.data) + '</div>';
    // valeurs extrêmes coupées pour que les autres barres restent lisibles (valeur exacte dans l'info-bulle)
    const absSorted = list.map((e) => Math.max(Math.abs(e.returnPct), e.extended ? Math.abs(e.extended.returnPct) : 0)).sort((a, b) => a - b);
    const cap = Math.max(20, 2 * absSorted[Math.floor(absSorted.length * 0.9)] || 20);
    const clipped = list.filter((e) => Math.abs(e.returnPct) > cap).length;
    if (clipped) $('evalRunsChart').insertAdjacentHTML('beforebegin', '<p class="hint">' + clipped + ' barre' + (clipped > 1 ? 's coupées' : ' coupée') + ' à ±' + Math.round(cap) + ' % (résultat extrême, valeur exacte au survol).</p>');
    const clip = (v) => Math.max(-cap, Math.min(cap, v));
    // simulation prolongée : barre pleine = résultat d'origine, pointillé = résultat après prolongation (vert rattrapé, bleu non)
    F.chart.mountBars($('evalRunsChart'), {
      labels: list.map((e, i) => '#' + (i + 1)), values: list.map((e) => clip(e.extended ? e.extended.returnPct : e.returnPct)), format: (v) => num1.format(v) + ' %', height: 200,
      ghosts: list.map((e, i) => {
        // aperçu d'une amélioration pas encore ajoutée : pointillé sur la barre ciblée
        const pv = improveCtx && improveCtx.kind === 'sel' && improveCtx.after ? improveCtx.T.findIndex((c) => c.e.key === e.key) : -1;
        if (pv >= 0) { const v = improveCtx.after[pv].returnPct; return { i: i, value: clip(v), kind: (v > 0 ? 'up' : 'blue') + ' preview' }; }
        return e.extended ? { i: i, value: clip(e.returnPct), kind: e.returnPct > 0 ? 'up' : 'blue' } : null;
      }).filter(Boolean),
      pending: list.findIndex((e) => e.key === checkCurrentKey),
      selected: list.map((e, i) => (barSel.has(e.key) ? i : -1)).filter((i) => i >= 0),
      // clic : une simulation ; Ctrl / Cmd + clic : ajouter ou retirer ; Maj + clic ou glisser : une plage
      onBarClick: (i, ev) => {
        const k = list[i].key, now = Date.now();
        // double-clic (2 clics sur la même barre en moins de 0,4 s) : rechargement sur l'écran principal
        if (lastBarClick.k === k && now - lastBarClick.t < 400) { lastBarClick = { k: '', t: 0 }; return reloadToMain(list[i]); }
        lastBarClick = { k: k, t: now };
        if (ev && (ev.ctrlKey || ev.metaKey)) { if (barSel.has(k)) barSel.delete(k); else barSel.add(k); }
        else if (ev && ev.shiftKey && barLast >= 0) { for (let j = Math.min(barLast, i); j <= Math.max(barLast, i); j++) barSel.add(list[j].key); }
        else barSel = barSel.size === 1 && barSel.has(k) ? new Set() : new Set([k]);
        barLast = i;
        if (improveWhere === 'panel') { improveHtml = ''; improveCtx = null; }
        renderEvaluation();
        // défilement vers le panneau un peu après, pour ne pas gêner un double-clic
        setTimeout(() => { if (lastBarClick.k === k && barSel.size && $('barPanel') && !$('evalModal').hidden) $('barPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 450);
      },
      // double-clic : la simulation est rechargée sur l'écran principal (stratégie, réglages, période) et relancée
      onBarDblClick: (i) => reloadToMain(list[i]),
      onBarRange: (a, b, ev) => {
        if (!(ev && (ev.ctrlKey || ev.metaKey))) barSel = new Set();
        for (let j = a; j <= b; j++) barSel.add(list[j].key);
        barLast = b;
        renderEvaluation();
        if ($('barPanel')) $('barPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      },
      // nombre de mois de test au-dessus de chaque barre
      // gain au-dessus de chaque barre, durée en petit au-dessus
      topLabels: list.map((e) => {
        const m = Math.max(1, Math.round(durationDays(e.from, e.to) / 30.4375)), v = e.returnPct, a = Math.abs(v);
        const g = (a < 0.005 ? '0' : signed(v, a < 10 ? num1 : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }))) + ' %';
        return { long: g, short: a >= 100 ? (v > 0 ? '+' : '−') + Math.round(a) : g.replace(' %', ''), cls: v > 0 ? 'pos' : v < 0 ? 'neg' : '', sub: m + ' mois', subShort: m + 'm' };
      }),
      titles: list.map((e, i) => '#' + (i + 1) + ' ' + e.name + ' · ' + e.pair + ' · capital ' + money.format(e.capital) + ' · ' + (e.extended ? 'origine ' + frDate(e.extended.from) + ' → ' + frDate(e.extended.to) +
        (e.extended.capital && e.extended.capital !== e.capital ? ' avec ' + money.format(e.extended.capital) : '') + ' : ' + pctTxt(e.extended.returnPct) + ' ; ' + changeLabel(e) + ' (' + frDate(e.from) + ' → ' + frDate(e.to) + ') : ' : frDate(e.from) + ' → ' + frDate(e.to) + ' : ') +
        pctTxt(e.returnPct) + ', drawdown −' + num1.format(e.maxDrawdownPct) + ' %'),
      ariaLabel: 'Résultat de chaque simulation',
    });
  }
  function changeLabel(e) {
    const x = e.extended, parts = [];
    if (x.from !== e.from || x.to !== e.to) parts.push(e.to < x.to ? 'raccourcie' : 'prolongée');
    if (x.capital && x.capital !== e.capital) parts.push('capital ' + money.format(x.capital) + ' → ' + money.format(e.capital));
    if (e.improved) parts.push('stratégie améliorée');
    return parts.join(', ') || 'relancée';
  }
  // ---------- Vérifier long terme / court terme sur les simulations affichées ----------
  let evalMarkImproved = false;
  let evalNoRecord = false, improveHtml = '', improveWhere = 'report'; // résultat d'amélioration : sous le rapport, ou dans le panneau de la sélection
  let evalTag = '', evalReplaceKey = '', checkRunning = '', checkStop = false, checkReport = '', checkStatusText = '', checkCurrentKey = '';
  const MONTH_CHOICES = [[1, '1 mois'], [2, '2 mois'], [3, '3 mois'], [6, '6 mois'], [12, '1 an'], [24, '2 ans']];
  // choix gardés quand le graphique se redessine (pendant une vérification)
  const checkSel = { extWhich: 'red', extMonths: '6', cutWhich: 'all', cutMonths: '1', capWhich: 'all', capMode: 'pct', capValue: '100' };
  function monthsSelect(id, def, list) {
    const cur = checkSel[id] || String(def);
    const known = list.some(([m]) => String(m) === cur);
    return '<select id="' + id + '">' + list.map(([m, l]) => '<option value="' + m + '"' + (String(m) === cur ? ' selected' : '') + '>' + l + '</option>').join('') +
      (known || cur === 'x' ? '' : '<option value="' + cur + '" selected>' + cur + ' mois</option>') + '<option value="x">x mois…</option></select>';
  }
  // Panneau d'une simulation choisie en cliquant sur sa barre : prolonger, raccourcir, changer le capital de départ.
  let barSel = new Set(), barLast = -1;
  let lastBarClick = { k: '', t: 0 };
  const barOpt = { durDir: 'longer', dur: '6', capMode: 'pct', capValue: '100', manual: '', manualMode: 'and' };
  // idées d'améliorations « à la main » (cliquables, modifiables dans la zone de texte)
  const MANUAL_IDEAS = ['Stop suiveur 2 ATR', 'Stop loss 2 ATR', 'Take profit 3 ATR', 'Stop au prix d\'entrée après 1 ATR', 'Fermer après 20 bougies',
    'Acheter seulement si le prix est au-dessus de la moyenne mobile exponentielle 200. Vendre dans le cas inverse',
    'Acheter seulement si l\'ADX 14 est au-dessus de 25. Vendre seulement si l\'ADX 14 est au-dessus de 25',
    'Acheter seulement si le RSI 14 est au-dessus de 50. Vendre dans le cas inverse',
    'Pause de 5 bougies après 3 pertes de suite'];
  function deleteSims(keys) {
    if (!keys.length || !confirm('Supprimer ' + (keys.length > 1 ? 'ces ' + keys.length + ' simulations' : 'cette simulation') + ' du tableau d\'évaluation ? (Ctrl+Z pour annuler)')) return;
    pushUndo('Suppression de ' + keys.length + ' simulation(s)');
    const set = new Set(keys);
    evalSave(evalList().filter((e) => !set.has(e.key)));
    for (const k of keys) { dbPush('simulations/delete', { key: k }); cloudPush(() => C.deleteSimulation(k)); }
    barSel = new Set(); improveHtml = ''; improveCtx = null;
    toast(keys.length > 1 ? keys.length + ' simulations supprimées.' : 'Simulation supprimée.', true);
    renderEvaluation();
  }
  // Amélioration écrite par l'utilisateur, appliquée aux simulations choisies puis resimulées sur place
  async function manualImprove(keys) {
    const text = ($('bpManual').value || '').trim(), mode = $('bpManualMode').value;
    barOpt.manual = text; barOpt.manualMode = mode;
    if (!text || checkRunning) return;
    const sims = evalList().filter((e) => keys.includes(e.key) && e.strategy);
    if (!sims.length) return;
    // l'amélioration est construite sur la stratégie de la 1re simulation (même stratégie pour toutes)
    const base = sims[0].strategy, before = sims.map((e) => ({ key: e.key, r: e.returnPct }));
    const fake = E.customChange(base, text, mode);
    if (fake.error) { improveWhere = 'panel'; improveHtml = '<p class="val ko">' + esc(fake.error) + '</p>'; return renderEvaluation(); }
    const improved = fake.apply({ strat: Object.assign({}, base), settings: {} }).strat;
    for (const k of RULE_FIELDS) { const err = F.rules.validate(improved[k]); if (err) { improveWhere = 'panel'; improveHtml = '<p class="val ko">Règle invalide : ' + esc(err) + '</p>'; return renderEvaluation(); } }
    pushUndo('Amélioration à la main sur ' + sims.length + ' simulation(s)');
    improveWhere = 'panel'; improveHtml = '<div class="modal-loading"><span class="spinner"></span>Nouvelle simulation avec votre amélioration…</div>';
    await rerunWithStrategy(sims.map((e) => e.key), Object.assign({}, improved, { name: base.name }));
    const after = evalList().filter((e) => keys.includes(e.key));
    const row = (e) => { const b = before.find((x) => x.key === e.key); return '<li>#' + (evalList().findIndex((x) => x.key === e.key) + 1) + ' : ' + pctFine(b.r) + ' → ' + pctFine(e.returnPct) + '</li>'; };
    const better = after.filter((e) => e.returnPct > before.find((x) => x.key === e.key).r).length;
    improveCtx = { kind: 'manual', strat: improved, base: base, text: text };
    improveHtml = '<div class="imp-proposal"><p><b>Votre amélioration :</b> ' + esc(fake.detail) + '</p>' + (fake.notes && fake.notes.length ? '<p class="hint">' + esc(fake.notes.join(' ')) + '</p>' : '') +
      '<p class="val ' + (better * 2 >= after.length ? 'ok' : 'ko') + '">' + better + ' simulation' + (better > 1 ? 's' : '') + ' sur ' + after.length + ' meilleure' + (better > 1 ? 's' : '') + ' :</p><ul class="imp-list">' + after.map(row).join('') + '</ul>' +
      '<div class="row buttons"><button type="button" class="primary small" id="manToCurrent">Ajouter à la stratégie en cours</button><button type="button" class="secondary small" id="manAsNew">Créer une nouvelle stratégie</button></div>' +
      '<p class="hint">Les barres montrent le résultat d\'origine en plein et le nouveau en pointillé. Ctrl+Z pour revenir aux résultats d\'avant.</p></div>';
    renderEvaluation();
  }
  function saveManual(asNew) {
    const r = improveCtx; if (!r || r.kind !== 'manual') return;
    const name = asNew ? (prompt('Nom de la nouvelle stratégie :', newStratName(r.base.name)) || '').trim() : r.base.name;
    if (!name) return;
    undoable(asNew ? 'Nouvelle stratégie « ' + name + ' »' : 'Amélioration ajoutée à « ' + name + ' »', () => {
      if (asNew && !storage.get().some((x) => x.name === r.base.name)) saveStrategy(r.base, currentConfig());
      const s = Object.assign({}, r.strat, { name: name });
      s.frenchText = F.french.toFrench(s) || ''; s.plots = F.french.derivePlots(s);
      loadStrategy(s);
      if (r.leverage) $('leverage').value = String(r.leverage);
      if (asNew || storage.get().some((x) => x.name === name)) saveStrategy(s, currentConfig()); else $('preset').value = 'mine';
      $('presetDesc').textContent = 'Amélioration ajoutée : ' + r.text;
      logEvent('strategy.enhanced', (asNew ? 'Nouvelle stratégie ' : 'Amélioration ajoutée à ') + name + ' : ' + r.text, { name: name });
    });
    improveHtml = '<p class="val ok">' + (asNew ? '« ' + esc(name) + ' » créée et chargée.' : 'Amélioration ajoutée à « ' + esc(name) + ' ».') + '</p>';
    improveCtx = null;
    toast(asNew ? '« ' + name + ' » créée.' : 'Amélioration ajoutée à « ' + name + ' ».', true);
    renderEvaluation();
  }
  function barPanelHtml(list) {
    const chosen = list.filter((x) => barSel.has(x.key));
    if (!chosen.length) return '<p class="hint bar-hint">Cliquez sur une barre pour modifier cette simulation (durée ou capital de départ). Plusieurs : glissez la souris sur les barres, ou Ctrl+clic.</p>';
    const all = evalList(), num = (x) => '#' + (all.findIndex((y) => y.key === x.key) + 1);
    const e = chosen[0], many = chosen.length > 1;
    const idx = num(e).slice(1), m = Math.max(1, Math.round(durationDays(e.from, e.to) / 30.4375));
    const durSel = '<select id="bpDur">' + [[1, '1 mois'], [2, '2 mois'], [3, '3 mois'], [6, '6 mois'], [12, '1 an'], [24, '2 ans']].map(([v, l]) => '<option value="' + v + '"' + (String(v) === barOpt.dur ? ' selected' : '') + '>' + l + '</option>').join('') +
      ([1, 2, 3, 6, 12, 24].includes(+barOpt.dur) ? '' : '<option value="' + barOpt.dur + '" selected>' + barOpt.dur + ' mois</option>') + '<option value="x">x mois…</option></select>';
    const busy = !!checkRunning;
    const head = many
      ? '<b>' + chosen.length + ' simulations sélectionnées</b> (' + chosen.map(num).join(', ') + ') · ' + ((g, r) => g + (g > 1 ? ' vertes, ' : ' verte, ') + r + (r > 1 ? ' rouges' : ' rouge'))(chosen.filter((x) => x.returnPct > 0).length, chosen.filter((x) => x.returnPct <= 0).length)
      : '<b>#' + idx + '</b> ' + esc(e.name) + ' · ' + esc(e.pair) + ' · ' + frDate(e.from) + ' → ' + frDate(e.to) + ' (' + m + ' mois) · capital ' + money.format(e.capital) +
        ' · <span class="' + cls(e.returnPct) + '">' + signed(e.returnPct, num1) + ' %</span>' + (e.extended ? ' <small class="eval-tag">' + esc(changeLabel(e)) + '</small>' : '');
    return '<div class="bar-panel" id="barPanel"><div class="bp-head">' + head +
      '<button type="button" class="ghost bp-close" id="bpClose" aria-label="Fermer">✕</button></div>' +
      '<div class="bp-row"><b>Durée</b><select id="bpDurDir">' + [['none', 'ne pas changer'], ['longer', 'prolonger de'], ['shorter', 'raccourcir de']].map(([v, l]) => '<option value="' + v + '"' + (barOpt.durDir === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
      (barOpt.durDir === 'none' ? '' : durSel + '<button type="button" class="secondary small" id="bpDurRun"' + (busy ? ' disabled' : '') + '>' + (barOpt.durDir === 'shorter' ? 'Raccourcir' : 'Prolonger') + ' et simuler</button>') + '</div>' +
      '<div class="bp-row"><b>Capital de départ</b><select id="bpCapMode">' + [['none', 'ne pas changer'], ['set', 'le porter à'], ['pct', 'l\'augmenter de (%)']].map(([v, l]) => '<option value="' + v + '"' + (barOpt.capMode === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
      (barOpt.capMode === 'none' ? '' : '<input id="bpCapValue" type="number" min="1" step="any" value="' + esc(barOpt.capValue) + '" aria-label="Montant ou pourcentage">' +
        '<button type="button" class="secondary small" id="bpCap"' + (busy ? ' disabled' : '') + '>' + (barOpt.capMode === 'set' ? 'Changer' : 'Augmenter') + ' et simuler</button>') + '</div>' +
      '<div class="bp-row bp-mix"><button type="button" class="primary small" id="bpMix"' + (busy ? ' disabled' : '') + '>▶ Resimuler</button><span class="hint">' + esc(mixSummary(many ? chosen.length : 1)) + '</span></div>' +
      '<div class="bp-row bp-mix"><button type="button" class="primary small bp-improve" id="bpImprove"' + (busy ? ' disabled' : '') + '>✨ Améliorer et simuler</button><span class="hint">Cherche ce qui améliore ' +
      (many ? 'ces simulations' : 'cette simulation') + ' sans dégrader les autres simulations de la stratégie, puis la resimule. Si le résultat vous convient, vous l\'ajoutez à la stratégie en cours.</span></div>' +
      '<div class="bp-row bp-mix"><button type="button" class="secondary small bp-analyze" id="bpAnalyze"' + (busy ? ' disabled' : '') + '>🔍 Analyseur</button><span class="hint">Explique le résultat de ' +
      (many ? 'la simulation ' + num(e) + ' (la première sélectionnée)' : 'cette simulation') + ' (chute, levier, marché…) et propose des corrections, à appliquer à cette simulation ou à tout le batch.</span></div>' +
      '<div class="bp-row bp-mix"><button type="button" class="secondary small" id="bpWithdraw"' + (busy ? ' disabled' : '') + '>💸 Resimuler avec un retrait</button><span class="hint">Relance ' + (many ? 'ces simulations' : 'cette simulation') + ' avec un retrait fictif des gains (vous pourrez aussi choisir tout le batch).</span></div>' +
      '<div class="bp-row bp-mix bp-manual"><b>Ma propre amélioration</b>' +
      '<div class="bp-ideas">' + MANUAL_IDEAS.map((x) => '<button type="button" class="chip" data-idea="' + esc(x) + '">' + esc(x) + '</button>').join('') + '</div>' +
      '<textarea id="bpManual" class="prose" rows="2" placeholder="ex. Acheter seulement si l\'ADX 14 est au-dessus de 25. Vendre dans le cas inverse.&#10;ou : Stop suiveur 2 ATR, fermer après 20 bougies">' + esc(barOpt.manual || '') + '</textarea>' +
      '<select id="bpManualMode"><option value="and"' + (barOpt.manualMode === 'and' ? ' selected' : '') + '>comme condition (ET)</option><option value="or"' + (barOpt.manualMode === 'or' ? ' selected' : '') + '>comme alternative (OU)</option>' +
      '<option value="replace"' + (barOpt.manualMode === 'replace' ? ' selected' : '') + '>remplace la règle</option></select>' +
      '<button type="button" class="primary small" id="bpManualRun"' + (busy ? ' disabled' : '') + '>Tester et simuler</button>' +
      '<span class="hint">Appliquée à ' + (many ? 'ces ' + chosen.length + ' simulations' : 'cette simulation') + ', relancée' + (many ? 's' : '') + ' sur place (Ctrl+Z pour revenir) ; ensuite, vous pouvez l\'ajouter à la stratégie.</span></div>' +
      improveInPanel() +
      '<div class="bp-row bp-del"><button type="button" class="secondary small danger" id="bpDelete"' + (busy ? ' disabled' : '') + '>🗑 Supprimer ' + (many ? 'ces ' + chosen.length + ' simulations' : 'cette simulation') + '</button>' +
      '<span class="hint">Retire ' + (many ? 'ces lignes' : 'cette ligne') + ' du tableau d\'évaluation (Ctrl+Z pour la remettre).</span></div>' +
      '<p class="hint">' + (many ? 'Ces ' + chosen.length + ' simulations sont modifiées' : 'La simulation #' + idx + ' est modifiée') + ' sur place (mêmes numéros) ; Ctrl+Z pour revenir en arrière. Glisser ou Ctrl+clic pour changer la sélection.</p></div>';
  }
  function mixSummary(n) {
    const parts = [];
    if (barOpt.durDir !== 'none') parts.push((barOpt.durDir === 'shorter' ? 'raccourcir de ' : 'prolonger de ') + barOpt.dur + ' mois');
    if (barOpt.capMode === 'set') parts.push('porter le capital de départ à ' + money.format(Number(barOpt.capValue) || 0));
    if (barOpt.capMode === 'pct') parts.push('augmenter le capital de départ de ' + (Number(barOpt.capValue) || 0) + ' %');
    const what = n > 1 ? 'les ' + n + ' simulations' : 'la simulation';
    return parts.length ? 'Relance ' + what + ' en une fois : ' + parts.join(' et ') + '.' : 'Relance ' + what + ' telle quelle (mêmes dates, même capital).';
  }
  $('evalBody').addEventListener('change', (ev) => {
    if (ev.target.id === 'bpDurDir') { barOpt.durDir = ev.target.value; renderEvaluation(); }
    if (ev.target.id === 'bpDur') {
      if (ev.target.value === 'x') {
        const x = Math.round(Number(prompt('Nombre de mois :', '9')));
        if (x >= 1 && x <= 120) barOpt.dur = String(x);
        renderEvaluation();
      } else barOpt.dur = ev.target.value;
    }
    if (ev.target.id === 'bpCapMode') { barOpt.capMode = ev.target.value; renderEvaluation(); }
    if (ev.target.id === 'bpManualMode') barOpt.manualMode = ev.target.value;
  });
  $('evalBody').addEventListener('input', (ev) => {
    if (ev.target.id === 'bpManual') barOpt.manual = ev.target.value;
    if (ev.target.id === 'bpCapValue') { barOpt.capValue = ev.target.value; const h = document.querySelector('.bp-mix .hint'); if (h) h.textContent = mixSummary(barSel.size); }
  });
  $('evalBody').addEventListener('click', (ev) => {
    const id = ev.target.id;
    if (id === 'bpClose') { barSel = new Set(); renderEvaluation(); }
    if (id === 'bpDurRun') runChecks('ext', { keys: [...barSel], months: +barOpt.dur, sign: barOpt.durDir === 'shorter' ? -1 : 1 });
    if (id === 'bpCap') runChecks('cap', { keys: [...barSel], capMode: barOpt.capMode, capVal: barOpt.capValue });
    if (id === 'bpImprove') improveSelection([...barSel]);
    if (id === 'bpWithdraw') openWdModal();
    if (id === 'bpAnalyze') { const k = evalFiltered(evalList()).map((x) => x.e).find((x) => barSel.has(x.key)); if (k) analyzeBar(k.key); }
    if (id === 'bpManualRun') manualImprove([...barSel]);
    if (id === 'bpDelete') deleteSims([...barSel]);
    const idea = ev.target.closest('[data-idea]');
    if (idea) { const ta = $('bpManual'); ta.value = (ta.value.trim() ? ta.value.trim().replace(/\.?$/, '. ') : '') + idea.dataset.idea; barOpt.manual = ta.value; ta.focus(); }
    if (id === 'bpMix') runChecks('mix', { keys: [...barSel], months: barOpt.durDir === 'none' ? 0 : +barOpt.dur, sign: barOpt.durDir === 'shorter' ? -1 : 1, capMode: barOpt.capMode, capVal: barOpt.capValue });
  });
  function checkToolsHtml(list) {
    const base = list.filter((e) => !e.tag); // les tranches d'un découpage ne sont pas reprises
    const red = base.filter((e) => e.returnPct <= 0).length, green = base.length - red;
    const which = (id) => { const d = checkSel[id]; return '<select id="' + id + '"><option value="red"' + (d === 'red' ? ' selected' : '') + '>rouges (' + red + ')</option><option value="green"' + (d === 'green' ? ' selected' : '') + '>vertes (' + green + ')</option><option value="all"' + (d === 'all' ? ' selected' : '') + '>toutes (' + base.length + ')</option></select>'; };
    return barPanelHtml(list) + improveSectionHtml(list) + '<div class="check-tools">' +
      '<div class="check-row"><b>Long terme ?</b> Prolonger les simulations ' + which('extWhich', 'red') + ' de ' + monthsSelect('extMonths', 6, MONTH_CHOICES.slice(2)) +
      '<button type="button" class="secondary small" id="extRun">' + (checkRunning === 'ext' ? 'Arrêter' : 'Prolonger') + '</button>' +
      '<span class="hint">Même début, fin repoussée : chaque simulation est <b>modifiée</b> (pas de nouvelle ligne). Sur le graphique, la nouvelle longueur s\'affiche en pointillé : ' +
      '<span class="lg-up">vert</span> si la perte est rattrapée, <span class="lg-blue">bleu</span> si elle ne l\'est pas. Ctrl+Z pour revenir aux résultats d\'origine.</span></div>' +
      '<div class="check-row"><b>Court terme ?</b> Découper les simulations ' + which('cutWhich', 'all') + ' en tranches de ' + monthsSelect('cutMonths', 1, MONTH_CHOICES.slice(0, 4)) +
      '<button type="button" class="secondary small" id="cutRun">' + (checkRunning === 'cut' ? 'Arrêter' : 'Découper') + '</button>' +
      '<span class="hint">Chaque tranche est simulée seule : une stratégie de court terme doit gagner sur la plupart des tranches.</span></div>' +
      '<div class="check-row"><b>Budget ?</b> Changer le capital de départ des simulations ' + which('capWhich') + ' : ' +
      '<select id="capMode"><option value="set"' + (checkSel.capMode === 'set' ? ' selected' : '') + '>le porter à</option><option value="pct"' + (checkSel.capMode === 'pct' ? ' selected' : '') + '>l\'augmenter de (%)</option></select>' +
      '<input id="capValue" type="number" min="1" step="any" value="' + esc(checkSel.capValue) + '" aria-label="Montant ou pourcentage">' +
      '<button type="button" class="secondary small" id="capRun">' + (checkRunning === 'cap' ? 'Arrêter' : (checkSel.capMode === 'set' ? 'Changer' : 'Augmenter') + ' et simuler') + '</button>' +
      '<span class="hint">Même période, autre capital de départ : chaque simulation est <b>modifiée</b> (même numéro), nouveau résultat en pointillé. Avec une taille en % du capital, le résultat en % change peu ; ' +
      'il change surtout en lots fixes, avec les minimums de lots du courtier, les retraits en somme fixe ou la commission.</span></div>' +
      '<p class="hint" id="checkStatus">' + esc(checkStatusText) + '</p>' + (checkReport ? '<div class="check-report">' + checkReport + '</div>' : '') +
      (improveHtml && improveWhere === 'report' ? '<div class="improve-out" id="improveOut">' + improveHtml + '</div>' : '') + '</div>';
  }
  function monthsValue(id) {
    const v = $(id).value;
    if (v !== 'x') return +v;
    const x = Math.round(Number(prompt('Nombre de mois :', '9')));
    if (x >= 1 && x <= 120) { checkSel[id] = String(x); return x; }
    return 0;
  }
  $('evalBody').addEventListener('change', (ev) => {
    if (checkSel[ev.target.id] !== undefined && ev.target.value !== 'x') checkSel[ev.target.id] = ev.target.value;
    if (ev.target.id === 'capMode' && $('capRun') && !checkRunning) $('capRun').textContent = (ev.target.value === 'set' ? 'Changer' : 'Augmenter') + ' et simuler';
  });
  $('evalBody').addEventListener('input', (ev) => { if (ev.target.id === 'capValue') checkSel.capValue = ev.target.value; });
  const isoD = (d) => F.data.iso(d), dateOf = (s) => new Date(s.slice(0, 10) + 'T00:00:00Z');
  /** Relance une simulation de l'historique (même stratégie, mêmes réglages) sur d'autres dates ; renvoie ses statistiques. */
  async function rerunEntry(e, from, to, tag, replace, extra, stratOverride) {
    loadStrategy(stratOverride || e.strategy);
    applyConfig(Object.assign({}, e.config, { period: 'custom', dateFrom: isoD(from), dateTo: isoD(to) }, extra || {}));
    document.querySelector('input[name=period][value=custom]').checked = true;
    $('dateFrom').value = isoD(from); $('dateTo').value = isoD(to);
    evalTag = tag; evalReplaceKey = replace ? e.key : '';
    try { const ok = await runFromForm(); return ok && lastRun ? lastRun.stats : null; } finally { evalTag = ''; evalReplaceKey = ''; }
  }
  /** ov (une seule simulation, depuis un clic sur sa barre) : {key, months, sign, capMode, capVal} */
  // petits résultats : 2 décimales (évite « −0 % »)
  const pctFine = (v) => '<span class="' + cls(Math.abs(v) < 0.005 ? 0 : v) + '">' + (Math.abs(v) < 0.005 ? '0' : signed(v, Math.abs(v) < 1 ? num2 : num1)) + ' %</span>';
  async function runChecks(kind, ov) {
    if (checkRunning) { checkStop = true; return; }
    const shown = evalFiltered(evalList()).map((x) => x.e);
    const which = ov ? 'all' : $(kind === 'ext' ? 'extWhich' : kind === 'cap' ? 'capWhich' : 'cutWhich').value;
    const sel = ov ? shown.filter((e) => ov.keys.includes(e.key) && e.strategy && e.config)
      : shown.filter((e) => e.strategy && e.config && !e.tag && (which === 'all' || (which === 'red' ? e.returnPct <= 0 : e.returnPct > 0)));
    const capMode = kind === 'cap' || kind === 'mix' ? (ov ? ov.capMode : $('capMode').value) : '', capVal = kind === 'cap' || kind === 'mix' ? Number(ov ? ov.capVal : $('capValue').value) : 0;
    if ((kind === 'cap' || kind === 'mix' && capMode !== 'none') && !(capVal > 0)) { $('checkStatus').textContent = 'Indiquez un montant ou un pourcentage.'; return; }
    const newCap = (e) => Math.round((capMode === 'set' ? capVal : e.capital * (1 + capVal / 100)) * 100) / 100;
    const months = kind === 'cap' ? 1 : ov ? ov.months : monthsValue(kind === 'ext' ? 'extMonths' : 'cutMonths');
    const sign = ov && ov.sign < 0 ? -1 : 1; // -1 : raccourcir
    if (!months && kind !== 'mix') return;
    if (!sel.length) { $('checkStatus').textContent = 'Aucune simulation à vérifier (les tranches issues d\'un découpage ne sont pas reprises).'; return; }
    const saved = captureForm(), today = dateOf(todayIso()), DAYMS = 864e5;
    // tâches : une prolongation par simulation, ou toutes les tranches de chaque simulation
    const jobs = [];
    for (const e of sel) {
      // dates demandées à l'origine (la 1re et la dernière bougie peuvent tomber un peu après / avant, ex. week-end)
      const c = e.config || {}, okD = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
      const idx = evalList().findIndex((x) => x.key === e.key) + 1, f0 = dateOf(okD(c.dateFrom) ? c.dateFrom : e.from), t0 = dateOf(okD(c.dateTo) ? c.dateTo : e.to);
      if (kind === 'mix') {
        // durée et capital ensemble (ou relance à l'identique)
        let from = f0, to = t0;
        if (months && sign < 0) { to = new Date(Math.max(F.data.addMonths(t0, -months).getTime(), f0.getTime() + 30 * DAYMS)); if (to >= t0) continue; }
        else if (months) { to = F.data.addMonths(t0, months); if (to > today) { const lack = to - today; to = today; from = new Date(f0.getTime() - lack); } }
        jobs.push({ e: e, idx: idx, from: from, to: to, cap: capMode === 'none' ? null : newCap(e) });
      } else if (kind === 'cap') {
        jobs.push({ e: e, idx: idx, from: f0, to: t0, cap: newCap(e) });
      } else if (kind === 'ext' && sign < 0) {
        // raccourcir : même début, fin avancée (30 jours au minimum)
        const to = new Date(Math.max(F.data.addMonths(t0, -months).getTime(), f0.getTime() + 30 * DAYMS));
        if (to >= t0) continue; // trop courte pour être raccourcie (30 jours minimum)
        jobs.push({ e: e, idx: idx, from: f0, to: to });
      } else if (kind === 'ext') {
        let to = F.data.addMonths(t0, months), from = f0;
        if (to > today) { const lack = to - today; to = today; from = new Date(f0.getTime() - lack); } // pas d'avenir : on recule le début
        jobs.push({ e: e, idx: idx, from: from, to: to, tag: 'prolongée +' + months + ' mois (de #' + idx + ')' });
      } else {
        for (let a = f0; a < t0;) {
          const b = new Date(Math.min(Math.max(F.data.addMonths(a, months).getTime() - DAYMS, a.getTime() + 30 * DAYMS), t0.getTime()));
          if (b - a >= 30 * DAYMS) jobs.push({ e: e, idx: idx, from: a, to: b, tag: 'tranche ' + months + ' mois de #' + idx });
          a = new Date(b.getTime() + DAYMS);
        }
      }
    }
    if (!jobs.length) { $('checkStatus').textContent = 'Simulation(s) trop courte(s) pour être raccourcie(s) (30 jours minimum).'; return; }
    if (jobs.length > 150 && !confirm(jobs.length + ' simulations à lancer : continuer ?')) return;
    if (kind === 'ext') pushUndo((sign < 0 ? 'Raccourcissement' : 'Prolongation') + ' de ' + sel.length + ' simulation(s)');
    if (kind === 'cap') pushUndo('Changement de capital de ' + sel.length + ' simulation(s)');
    if (kind === 'mix') pushUndo('Nouvelle simulation de ' + sel.length + ' simulation(s)');
    checkRunning = kind; checkStop = false; checkReport = ''; improveHtml = '';
    const out = new Map();
    const live = () => { if (!$('evalModal').hidden && evalView === 'charts') renderEvaluation(); };
    try {
      for (let k = 0; k < jobs.length && !checkStop; k++) {
        const j = jobs[k];
        const what = kind === 'mix' ? 'Simulation ' : kind === 'ext' ? (sign < 0 ? 'Raccourcissement ' : 'Prolongation ') : kind === 'cap' ? 'Capital ' : 'Tranche ';
        checkStatusText = what + (k + 1) + ' sur ' + jobs.length + '…';
        checkCurrentKey = j.e.key;
        setRunLabel(what + (k + 1) + ' / ' + jobs.length);
        live();
        const st = await rerunEntry(j.e, j.from, j.to, kind === 'cut' ? j.tag : '', kind !== 'cut', j.cap ? { capital: j.cap } : null);
        if (!out.has(j.e)) out.set(j.e, []);
        out.get(j.e).push({ from: j.from, to: j.to, st: st, cap: j.cap });
        live(); // la barre s'allonge tout de suite
        await new Promise((r) => setTimeout(r, kind === 'cut' ? 20 : 250));
      }
    } finally {
      checkRunning = ''; checkStatusText = ''; checkCurrentKey = ''; setRunLabel('');
      // le formulaire revient à son état d'avant la vérification
      restoring = true;
      try { loadStrategy(saved.strat); applyConfig(saved.config); $('style').value = saved.style; $('preset').value = [...$('preset').options].some((o) => o.value === saved.preset) ? saved.preset : 'mine'; $('presetDesc').textContent = saved.desc; updateWithdrawUI(); syncFormState(); }
      finally { restoring = false; }
    }
    // rapport
    const p = pctFine;
    let rows = '', good = 0, total = 0;
    const diffs = [];
    for (const [e, rs] of out) {
      const idx = evalList().findIndex((x) => x.key === e.key) + 1;
      if (kind === 'mix') {
        const r = rs[0]; if (!r.st) continue; total++;
        const ok = r.st.returnPct > 0; if (ok) good++;
        const cap1 = r.cap || e.capital;
        rows += '<tr><td>#' + idx + '</td><td class="l">' + frDate(e.from) + ' → ' + frDate(e.to) + '</td><td>' + money.format(e.capital) + '</td><td>' + p(e.returnPct) + '</td><td class="l">' + frDate(isoD(r.from)) + ' → ' + frDate(isoD(r.to)) +
          '</td><td>' + money.format(cap1) + '</td><td>' + p(r.st.returnPct) + '</td><td class="l">' + (ok ? (e.returnPct <= 0 ? '✓ passe au vert' : '✓ reste gagnante') : e.returnPct > 0 ? '✗ passe au rouge' : '✗ reste perdante') + '</td>' +
          (ok ? '<td></td>' : '<td><button type="button" class="secondary small imp-btn" data-imp="' + esc(e.key) + '" data-from="' + isoD(r.from) + '" data-to="' + isoD(r.to) + '" data-cap="' + (r.cap || '') + '">Améliorer et simuler</button></td>') + '</tr>';
      } else if (kind === 'cap') {
        const r = rs[0]; if (!r.st) continue; total++;
        const ok = r.st.returnPct > 0; if (ok) good++;
        const g0 = e.capital * e.returnPct / 100, g1 = r.st.netProfit != null ? r.st.netProfit : r.cap * r.st.returnPct / 100;
        diffs.push(Math.abs(r.st.returnPct - e.returnPct));
        rows += '<tr><td>#' + idx + '</td><td class="l">' + frDate(e.from) + ' → ' + frDate(e.to) + '</td><td>' + money.format(e.capital) + '</td><td>' + p(e.returnPct) + '</td><td class="' + cls(g0) + '">' + signed(g0, money) +
          '</td><td>' + money.format(r.cap) + '</td><td>' + p(r.st.returnPct) + '</td><td class="' + cls(g1) + '">' + signed(g1, money) + '</td><td class="l">' +
          (ok ? (e.returnPct <= 0 ? '✓ passe au vert' : '✓ reste gagnante') : e.returnPct > 0 ? '✗ passe au rouge' : '✗ reste perdante') + '</td>' + '<td>' + (ok ? '' : '<button type="button" class="secondary small imp-btn" data-imp="' + esc(e.key) + '" data-from="' + isoD(r.from) + '" data-to="' + isoD(r.to) + '" data-cap="' + (r.cap || '') + '">Améliorer et simuler</button>') + '</td>' + '</tr>';
      } else if (kind === 'ext') {
        const r = rs[0]; if (!r.st) continue; total++;
        const ok = r.st.returnPct > 0; if (ok) good++;
        rows += '<tr><td>#' + idx + '</td><td class="l">' + frDate(e.from) + ' → ' + frDate(e.to) + '</td><td>' + p(e.returnPct) + '</td><td class="l">' + frDate(isoD(r.from)) + ' → ' + frDate(isoD(r.to)) +
          '</td><td>' + p(r.st.returnPct) + '</td><td class="l">' + (ok ? (e.returnPct <= 0 ? '✓ perte rattrapée' : '✓ reste gagnante') : e.returnPct > 0 ? '✗ gain perdu' : '✗ toujours perdante') + '</td>' + '<td>' + (ok ? '' : '<button type="button" class="secondary small imp-btn" data-imp="' + esc(e.key) + '" data-from="' + isoD(r.from) + '" data-to="' + isoD(r.to) + '" data-cap="' + (r.cap || '') + '">Améliorer et simuler</button>') + '</td>' + '</tr>';
      } else {
        const ok = rs.filter((r) => r.st), pos = ok.filter((r) => r.st.returnPct > 0).length; if (!ok.length) continue;
        total += ok.length; good += pos;
        const med = ok.map((r) => r.st.returnPct).sort((a, b) => a - b)[ok.length >> 1];
        rows += '<tr><td>#' + idx + '</td><td class="l">' + frDate(e.from) + ' → ' + frDate(e.to) + '</td><td>' + p(e.returnPct) + '</td><td>' + ok.length + '</td><td>' + pos + ' / ' + ok.length +
          '</td><td>' + p(med) + '</td></tr>';
      }
    }
    const rate = total ? Math.round((good / total) * 100) : 0;
    const capTxt = capMode === 'set' ? 'porté à ' + money.format(capVal) : 'augmenté de ' + num1.format(capVal) + ' %';
    const sameRet = diffs.length && diffs.reduce((a, b) => a + b, 0) / diffs.length < 0.5;
    const verdict = kind === 'mix'
      ? (total === 1 ? 'Nouvelle simulation : ' + (good ? 'gagnante.' : 'perdante.') : 'Nouvelles simulations : ' + good + ' gagnante' + (good > 1 ? 's' : '') + ' sur ' + total + '.')
      : kind === 'cap'
      ? 'Capital de départ ' + capTxt + ' : ' + good + ' simulation' + (good > 1 ? 's' : '') + ' gagnante' + (good > 1 ? 's' : '') + ' sur ' + total + '.' +
        (sameRet ? ' Le résultat en % ne bouge presque pas (la taille des positions suit le capital) : seul le gain en argent change, dans la même proportion.' : ' Le résultat en % change avec le capital : la taille des positions ne lui est pas proportionnelle (lots fixes, minimum de lots, retraits en somme fixe, commission).')
      : kind === 'ext' && sign < 0
      ? (total === 1 ? 'Raccourcie de ' + months + ' mois : ' + (good ? 'gagnante.' : 'perdante.') : 'Raccourcies de ' + months + ' mois : ' + good + ' sur ' + total + ' gagnantes.')
      : kind === 'ext' && total === 1
      ? 'Prolongée de ' + months + ' mois : ' + (good ? 'gagnante.' : 'toujours perdante.')
      : kind === 'ext'
      ? (rate >= 60 ? 'Prolongées, ' + good + ' sur ' + total + ' finissent gagnantes : la stratégie se comporte comme une stratégie de <b>long terme</b> (les pertes se rattrapent avec le temps).'
        : 'Prolongées, seulement ' + good + ' sur ' + total + ' finissent gagnantes : allonger la durée ne suffit pas, ce n\'est pas (seulement) une question de long terme.')
      : (rate >= 60 ? good + ' tranches gagnantes sur ' + total + ' (' + rate + ' %) : la stratégie fonctionne aussi sur des périodes <b>courtes</b>.'
        : 'Seulement ' + good + ' tranches gagnantes sur ' + total + ' (' + rate + ' %) : sur des périodes courtes, le résultat dépend beaucoup du moment ; plutôt une stratégie de long terme (ou à revoir).');
    checkReport = '<p class="val ' + (rate >= 60 || kind === 'cap' && rate >= 50 ? 'ok' : 'ko') + '">' + verdict + (checkStop ? ' (vérification arrêtée avant la fin)' : '') + '</p><div class="table-wrap"><table class="eval mini">' +
      (kind === 'mix' ? '<thead><tr><th>#</th><th class="l">Avant</th><th>Capital</th><th>Résultat</th><th class="l">Après</th><th>Capital</th><th>Résultat</th><th class="l">Verdict</th><th></th></tr></thead>'
        : kind === 'cap' ? '<thead><tr><th>#</th><th class="l">Période</th><th>Capital de départ</th><th>Résultat</th><th>Gain</th><th>Nouveau capital de départ</th><th>Résultat</th><th>Gain</th><th class="l">Verdict</th><th></th></tr></thead>'
        : kind === 'ext' ? '<thead><tr><th>#</th><th class="l">Période d\'origine</th><th>Résultat</th><th class="l">Période ' + (sign < 0 ? 'raccourcie (−' : 'prolongée (+') + months + ' mois)</th><th>Résultat</th><th class="l">Verdict</th><th></th></tr></thead>'
        : '<thead><tr><th>#</th><th class="l">Période d\'origine</th><th>Résultat</th><th>Tranches de ' + months + ' mois</th><th>Gagnantes</th><th>Médiane</th></tr></thead>') +
      '<tbody>' + rows + '</tbody></table></div><p class="hint">' + (kind === 'cap' || kind === 'mix' ? 'Les simulations ont été modifiées dans le tableau (capital et résultat), sans nouvelle ligne ; leur résultat d\'origine reste en plein sur le graphique. Ctrl+Z pour annuler.' : kind === 'ext' ? 'Les simulations prolongées ont été modifiées dans le tableau (période et résultat), sans nouvelle ligne ; leur résultat d\'origine reste affiché en plein sur le graphique. Ctrl+Z pour annuler.'
        : 'Les tranches sont enregistrées dans le tableau, marquées « tranche ».') + '</p>';
    logEvent('evaluation.check', (kind === 'mix' ? 'Nouvelle simulation de ' : kind === 'ext' ? 'Prolongation de ' : kind === 'cap' ? 'Changement de capital de ' : 'Découpage de ') + out.size + ' simulations : ' + good + '/' + total + ' gagnantes', { kind: kind, months: months });
    if (!$('evalModal').hidden) renderEvaluation();
  }
  $('evalBody').addEventListener('click', (ev) => {
    if (ev.target.id === 'extRun') runChecks('ext');
    if (ev.target.id === 'cutRun') runChecks('cut');
    if (ev.target.id === 'capRun') runChecks('cap');
  });
  // ---------- « Améliorer » une simulation restée perdante ----------
  let improveCtx = null; // { e, strat, settings, config, sugg, pick, stats, base }
  async function improveFromReport(btn) {
    if (checkRunning) return;
    const e = evalList().find((x) => x.key === btn.dataset.imp);
    if (!e || !e.strategy) return;
    const saved = captureForm();
    checkRunning = 'imp'; improveWhere = 'report';
    improveHtml = '<div class="modal-loading"><span class="spinner"></span>Analyse de #' + (evalList().findIndex((x) => x.key === e.key) + 1) + ' : recherche des améliorations…</div>';
    renderEvaluation();
    setRunLabel('Analyse');
    let res = null;
    try {
      evalNoRecord = true;
      const st = await rerunEntry(e, dateOf(btn.dataset.from), dateOf(btn.dataset.to), '', false, btn.dataset.cap ? { capital: +btn.dataset.cap } : null);
      evalNoRecord = false;
      if (!st || !lastRunCtx) throw new Error($('formError').textContent || 'simulation impossible');
      const { bars, strat, settings, config } = lastRunCtx;
      await new Promise((r) => setTimeout(r, 20));
      const sg = E.suggest(bars, strat, settings, strat.style || 'none');
      // proposition : la combinaison recommandée si elle existe, sinon les meilleures suggestions confirmées (ou la meilleure)
      const combo = sg.suggestions.find((x) => x.group === 'Combinaison recommandée');
      // sinon : les améliorations (hors levier) cumulées une par une, gardées seulement si la note progresse
      let pick = [];
      if (combo) pick = [combo];
      else {
        const pool = sg.suggestions.filter((x) => !x.risk && x.group !== 'Combinaison recommandée').sort((x, y) => y.score - x.score).slice(0, 5);
        let cur = -Infinity;
        for (const x of pool) {
          if (pick.some((y) => y.group === x.group)) continue;
          const c = E.combine(strat, settings, pick.concat([x])), st2 = E.run(bars, c.strat, c.settings), sc = E.score(st2);
          if (sc > cur + 0.5) { pick.push(x); cur = sc; }
        }
        if (!pick.length) pick = sg.suggestions.filter((x) => x.risk).slice(0, 1); // en dernier recours : réduire le levier
      }
      let stats = null;
      res = { e: e, strat: strat, settings: settings, config: config, sugg: sg, pick: pick, stats: null, base: sg.base, from: btn.dataset.from, to: btn.dataset.to };
      if (pick.length) {
        // 2e temps : la stratégie améliorée est vraiment resimulée sur la même période (même chaîne que « Lancer le backtest »)
        improveHtml = '<div class="modal-loading"><span class="spinner"></span>Amélioration trouvée : nouvelle simulation avec la stratégie améliorée…</div>';
        renderEvaluation();
        setRunLabel('Simulation améliorée');
        const imp = improvedVersion(res);
        loadStrategy(imp.strat);
        applyConfig(imp.config);
        document.querySelector('input[name=period][value=custom]').checked = true;
        $('dateFrom').value = btn.dataset.from; $('dateTo').value = btn.dataset.to;
        evalNoRecord = true;
        const ok = await runFromForm();
        evalNoRecord = false;
        stats = ok && lastRun ? lastRun.stats : E.run(bars, imp.cStrat, imp.cSettings);
        res.stats = stats;
      }
    } catch (err) {
      improveHtml = '<p class="val ko">Analyse impossible : ' + esc(err.message) + '</p>';
    } finally {
      evalNoRecord = false; checkRunning = ''; setRunLabel('');
      restoring = true;
      try { loadStrategy(saved.strat); applyConfig(saved.config); $('style').value = saved.style; $('preset').value = [...$('preset').options].some((o) => o.value === saved.preset) ? saved.preset : 'mine'; $('presetDesc').textContent = saved.desc; updateWithdrawUI(); syncFormState(); }
      finally { restoring = false; }
    }
    if (res) { improveCtx = res; improveHtml = improveReportHtml(res); }
    renderEvaluation();
    if ($('improveOut')) $('improveOut').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function reloadToMain(e) {
    if (!e || !e.strategy || checkRunning) return;
    undoable('Simulation rechargée depuis l\'évaluation', () => {
      loadStrategy(e.strategy);
      const d = datesOf(e);
      applyConfig(Object.assign({}, e.config, { period: 'custom', dateFrom: isoD(d.from), dateTo: isoD(d.to) }));
      document.querySelector('input[name=period][value=custom]').checked = true;
      syncPeriodUI(); $('dateFrom').value = isoD(d.from); $('dateTo').value = isoD(d.to);
      $('preset').value = 'mine'; $('deleteStrat').hidden = true;
      $('presetDesc').textContent = 'Simulation #' + (evalList().findIndex((x) => x.key === e.key) + 1) + ' rechargée depuis l\'évaluation (' + frDate(isoD(d.from)) + ' → ' + frDate(isoD(d.to)) + ').';
      updateStyleHint();
    });
    closeEvaluation();
    runFromForm({ noRecord: true }).finally(() => { $('results').scrollIntoView({ behavior: 'smooth' }); }); // déjà dans le tableau
  }

  // ---------- Section « Améliorations » : communes aux rouges, et à fort impact ----------
  let impSec = null; // { status, name, ctxs, common, high, chosen:Set, done }
  function improveSectionHtml(list) {
    const busy = !!checkRunning;
    let h = '<section class="imp-section"><div class="imp-sec-head"><h4>Améliorations</h4>';
    if (!impSec || impSec.status === 'idle') {
      const red = list.filter((e) => e.returnPct <= 0 && !e.tag).length;
      return h + '<button type="button" class="secondary small" id="isAnalyze"' + (busy || !list.length ? ' disabled' : '') + '>Analyser</button></div>' +
        '<p class="hint">Cherche les améliorations communes aux ' + red + ' simulation' + (red > 1 ? 's' : '') + ' rouge' + (red > 1 ? 's' : '') + ' et celles qui rapportent le plus sur l\'ensemble, ' +
        'puis vous laisse choisir celles à appliquer et resimuler.</p></section>';
    }
    if (impSec.status === 'run') return h + '</div><div class="modal-loading"><span class="spinner"></span>' + esc(impSec.msg || 'Analyse…') + '</div></section>';
    if (impSec.status === 'err') return h + '<button type="button" class="secondary small" id="isAnalyze">Analyser</button></div><p class="val ko">' + esc(impSec.msg) + '</p></section>';
    const row = (c, kind) => {
      const on = impSec.chosen.has(c.s.id);
      const detail = kind === 'common'
        ? c.redBetter + ' rouge' + (c.redBetter > 1 ? 's' : '') + ' sur ' + c.redN + ' améliorée' + (c.redBetter > 1 ? 's' : '') + ' · ' + c.allBetter + ' / ' + c.n + ' au total'
        : 'résultat médian ' + pctFine(c.medBefore) + ' → ' + pctFine(c.medAfter) + ' · ' + c.allBetter + ' / ' + c.n + ' meilleures';
      return '<div class="is-row' + (on ? ' on' : '') + '"><button type="button" class="' + (on ? 'primary' : 'secondary') + ' small is-apply" data-is="' + esc(c.s.id) + '">' + (on ? '✓ Appliquée' : 'Appliquer') + '</button>' +
        '<div><span class="grp">' + esc(c.s.group) + '</span> ' + esc(c.s.title) + '<div class="hint">' + detail + '</div></div></div>';
    };
    h += '<button type="button" class="secondary small" id="isAnalyze"' + (busy ? ' disabled' : '') + '>Analyser de nouveau</button></div>' +
      '<p class="hint">Analyse sur ' + impSec.ctxs.length + ' simulations de « ' + esc(impSec.name) + ' » (' + impSec.redN + ' rouges).</p>' +
      '<h5>Communes aux rouges</h5>' + (impSec.common.length ? impSec.common.map((c) => row(c, 'common')).join('') : '<p class="hint">Aucune amélioration n\'aide la majorité des simulations rouges.</p>') +
      '<h5>À fort impact (sur toutes les simulations)</h5>' + (impSec.high.length ? impSec.high.map((c) => row(c, 'high')).join('') : '<p class="hint">Aucune amélioration ne fait progresser le résultat médian.</p>');
    const n = impSec.chosen.size;
    h += '<div class="is-foot"><button type="button" class="primary small" id="isResim"' + (!n || busy ? ' disabled' : '') + '>▶ Resimuler' + (n ? ' avec ' + n + ' amélioration' + (n > 1 ? 's' : '') : '') + '</button>' +
      '<span class="hint">Relance les ' + impSec.ctxs.length + ' simulations avec les améliorations choisies ; les barres du graphique se mettent à jour (nouveau résultat en pointillé). Ctrl+Z pour annuler.</span></div>';
    if (impSec.done) h += impSec.done;
    return h + '</section>';
  }
  const appliesSettings = (x, c) => x.apply({ strat: c.strat, settings: c.settings }).settings !== c.settings; // levier, taille, annonces : exclus
  async function analyzeImprovements() {
    if (checkRunning) return;
    const list = evalFiltered(evalList()).map((x) => x.e).filter((e) => e.strategy && e.config && !e.tag);
    const name = list.some((e) => e.name === currentStratName()) ? currentStratName() : (list[0] || {}).name;
    const sims = list.filter((e) => e.name === name).slice(-16);
    if (!sims.length) return;
    const saved = captureForm();
    checkRunning = 'isec'; checkStop = false;
    impSec = { status: 'run', msg: 'Chargement des simulations…' };
    renderEvaluation();
    try {
      const ctxs = [];
      for (const e of sims) {
        if (checkStop) break;
        impSec.msg = 'Chargement de la simulation ' + (ctxs.length + 1) + ' sur ' + sims.length + '…'; setRunLabel('Analyse ' + (ctxs.length + 1) + ' / ' + sims.length); renderEvaluation();
        const c = await ctxOf(e); if (c) { c.base = E.run(c.bars, c.strat, c.settings); ctxs.push(c); }
      }
      if (!ctxs.length) throw new Error('simulations impossibles à recharger');
      impSec.msg = 'Recherche des améliorations…'; renderEvaluation();
      await new Promise((r) => setTimeout(r, 20));
      const reds = ctxs.filter((c) => c.base.returnPct <= 0);
      // candidats : suggestions trouvées sur les simulations rouges (les 6 pires) et sur les 2 meilleures
      const srcs = reds.slice().sort((a, b) => a.base.returnPct - b.base.returnPct).slice(0, 6).concat(ctxs.slice().sort((a, b) => b.base.returnPct - a.base.returnPct).slice(0, 2));
      const cand = new Map();
      for (const c of srcs) {
        for (const x of E.suggest(c.bars, c.strat, c.settings, c.strat.style || 'none').suggestions) {
          if (x.risk || x.group === 'Combinaison recommandée' || cand.has(x.id) || appliesSettings(x, c)) continue;
          cand.set(x.id, x);
        }
      }
      const med = (a) => { const s2 = a.slice().sort((x, y) => x - y); return s2.length ? s2[s2.length >> 1] : 0; };
      const rated = [...cand.values()].map((x) => {
        const res = ctxs.map((c) => { const k = E.combine(c.strat, c.settings, [x]), st = E.run(c.bars, k.strat, k.settings); return { c: c, a: st, d: E.score(st) - E.score(c.base) }; });
        const r = res.filter((z) => z.c.base.returnPct <= 0);
        return { s: x, n: res.length, redN: r.length, redBetter: r.filter((z) => z.d > 0.5).length, allBetter: res.filter((z) => z.d > 0.5).length,
          meanGain: mean(res.map((z) => z.d)), medBefore: med(res.map((z) => z.c.base.returnPct)), medAfter: med(res.map((z) => z.a.returnPct)) };
      });
      const common = rated.filter((c) => c.redN && c.redBetter / c.redN >= 0.6).sort((a, b) => b.redBetter - a.redBetter || b.meanGain - a.meanGain).slice(0, 6);
      const high = rated.filter((c) => c.medAfter > c.medBefore && c.meanGain > 0).sort((a, b) => (b.medAfter - b.medBefore) - (a.medAfter - a.medBefore)).slice(0, 6);
      impSec = { status: 'ok', name: name, ctxs: ctxs, redN: reds.length, common: common, high: high, chosen: new Set(), byId: new Map(rated.map((c) => [c.s.id, c.s])) };
    } catch (err) {
      impSec = { status: 'err', msg: 'Analyse impossible : ' + err.message };
    } finally {
      checkRunning = ''; setRunLabel('');
      restoring = true;
      try { loadStrategy(saved.strat); applyConfig(saved.config); $('style').value = saved.style; $('preset').value = [...$('preset').options].some((o) => o.value === saved.preset) ? saved.preset : 'mine'; $('presetDesc').textContent = saved.desc; updateWithdrawUI(); syncFormState(); }
      finally { restoring = false; }
    }
    renderEvaluation();
  }
  async function resimWithChosen() {
    if (!impSec || !impSec.chosen.size || checkRunning) return;
    const pick = [...impSec.chosen].map((id) => impSec.byId.get(id)).filter(Boolean);
    const c0 = impSec.ctxs[0];
    const k = E.combine(c0.strat, c0.settings, pick);
    const strat = Object.assign({}, k.strat, { name: impSec.name, plots: F.french.derivePlots(k.strat), frenchText: F.french.toFrench(k.strat) || '' });
    const keys = impSec.ctxs.map((c) => c.e.key);
    pushUndo('Simulations relancées avec ' + pick.length + ' amélioration(s)');
    impSec.done = '';
    await rerunWithStrategy(keys, strat);
    const after = evalList().filter((e) => keys.includes(e.key));
    const pos = after.filter((e) => e.returnPct > 0).length;
    impSec.lastStrat = strat; impSec.lastPick = pick;
    impSec.done = '<div class="imp-proposal"><p class="val ' + (pos * 2 >= after.length ? 'ok' : 'ko') + '">Resimulées avec ' + esc(pick.map((x) => x.title).join(' + ')) + ' : ' + pos + ' gagnante' + (pos > 1 ? 's' : '') + ' sur ' + after.length + '.</p>' +
      '<div class="row buttons"><button type="button" class="primary small" id="isToCurrent">Ajouter à la stratégie en cours</button><button type="button" class="secondary small" id="isAsNew">Créer une nouvelle stratégie</button></div>' +
      '<p class="hint">Les barres montrent le résultat d\'origine en plein et le nouveau en pointillé. Ctrl+Z pour revenir aux résultats d\'avant.</p></div>';
    renderEvaluation();
  }
  function saveSectionStrategy(asNew) {
    const s0 = impSec.lastStrat, name = asNew ? (prompt('Nom de la nouvelle stratégie :', newStratName(impSec.name)) || '').trim() : impSec.name;
    if (!name) return;
    undoable(asNew ? 'Nouvelle stratégie « ' + name + ' »' : 'Améliorations ajoutées à « ' + name + ' »', () => {
      const old = impSec.ctxs[0].e.strategy;
      if (asNew && !storage.get().some((x) => x.name === old.name)) saveStrategy(old, impSec.ctxs[0].e.config);
      const s = Object.assign({}, s0, { name: name });
      loadStrategy(s);
      const isSaved = storage.get().some((x) => x.name === name);
      if (asNew || isSaved) saveStrategy(s, currentConfig()); else $('preset').value = 'mine';
      $('presetDesc').textContent = 'Améliorations : ' + impSec.lastPick.map((x) => x.title).join(' + ') + '.';
      logEvent('strategy.enhanced', (asNew ? 'Nouvelle stratégie ' : 'Améliorations ajoutées à ') + name + ' : ' + impSec.lastPick.map((x) => x.title).join(' + '), { name: name });
    });
    impSec.done = '<p class="val ok">' + (asNew ? '« ' + esc(name) + ' » créée et chargée dans le formulaire.' : 'Améliorations ajoutées à « ' + esc(name) + ' ».') + '</p>';
    toast(asNew ? '« ' + name + ' » créée.' : 'Améliorations ajoutées à « ' + name + ' ».', true);
    renderEvaluation();
  }
  $('evalBody').addEventListener('click', (ev) => {
    const t = ev.target;
    if (t.id === 'isAnalyze') return analyzeImprovements();
    const ap = t.closest('.is-apply');
    if (ap && impSec) {
      const id = ap.dataset.is;
      if (impSec.chosen.has(id)) impSec.chosen.delete(id);
      else {
        // une seule amélioration par type (deux stops suiveurs différents s'annuleraient)
        const g = impSec.byId.get(id).group;
        for (const o of [...impSec.chosen]) if (impSec.byId.get(o).group === g) impSec.chosen.delete(o);
        impSec.chosen.add(id);
      }
      return renderEvaluation();
    }
    if (t.id === 'isResim') return resimWithChosen();
    if (t.id === 'isToCurrent') return saveSectionStrategy(false);
    if (t.id === 'isAsNew') return saveSectionStrategy(true);
  });

  // ---------- « ✨ Améliorer » depuis la sélection du graphique ----------
  // Analyse « croisée » : les améliorations sont cherchées sur la ou les simulations choisies, puis vérifiées sur les autres
  // simulations affichées de la stratégie ; on ne garde que celles qui aident sans dégrader le reste.
  const datesOf = (e) => { const c = e.config || {}, ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || ''); return { from: dateOf(ok(c.dateFrom) ? c.dateFrom : e.from), to: dateOf(ok(c.dateTo) ? c.dateTo : e.to) }; };
  async function ctxOf(e) {
    const d = datesOf(e);
    evalNoRecord = true;
    try { const st = await rerunEntry(e, d.from, d.to, '', false, null); return st && lastRunCtx ? { e: e, bars: lastRunCtx.bars, strat: lastRunCtx.strat, settings: lastRunCtx.settings, config: lastRunCtx.config, d: d } : null; }
    finally { evalNoRecord = false; }
  }
  async function improveSelection(keys) {
    if (checkRunning || !keys.length) return;
    const shown = evalFiltered(evalList()).map((x) => x.e).filter((e) => e.strategy && e.config && !e.tag);
    const targets = shown.filter((e) => keys.includes(e.key));
    if (!targets.length) return;
    // autres simulations de la même stratégie (8 au plus, les plus récentes) pour vérifier qu'on ne les dégrade pas
    const others = shown.filter((e) => !keys.includes(e.key) && e.name === targets[0].name).slice(-8);
    const saved = captureForm();
    checkRunning = 'imp'; checkStop = false; improveWhere = 'panel';
    const step = (t) => { improveHtml = '<div class="modal-loading"><span class="spinner"></span>' + t + '</div>'; renderEvaluation(); };
    let res = null;
    try {
      step('Chargement de ' + targets.length + ' simulation(s) à améliorer et de ' + others.length + ' autre(s) pour contrôle…');
      const T = [], O = [];
      for (const e of targets) { setRunLabel('Analyse ' + (T.length + 1) + ' / ' + (targets.length + others.length)); const c = await ctxOf(e); if (c) T.push(c); }
      for (const e of others) { if (checkStop) break; setRunLabel('Analyse ' + (T.length + O.length + 1) + ' / ' + (targets.length + others.length)); const c = await ctxOf(e); if (c) O.push(c); }
      if (!T.length) throw new Error($('formError').textContent || 'simulation impossible');
      step('Recherche des améliorations…');
      await new Promise((r) => setTimeout(r, 20));
      // candidats : suggestions trouvées sur chaque simulation à améliorer (hors levier), dédoublonnées
      const cand = new Map();
      for (const c of T) for (const x of E.suggest(c.bars, c.strat, c.settings, c.strat.style || 'none').suggestions) {
        if (x.risk || x.group === 'Combinaison recommandée' || cand.has(x.id)) continue;
        cand.set(x.id, x);
      }
      const runOn = (c, pick) => { const k = E.combine(c.strat, c.settings, pick); return E.run(c.bars, k.strat, k.settings); };
      const base = (c) => (c.base = c.base || E.run(c.bars, c.strat, c.settings));
      const evalPick = (pick) => {
        const t = T.map((c) => ({ b: base(c), a: runOn(c, pick) })), o = O.map((c) => ({ b: base(c), a: runOn(c, pick) }));
        const d = (x) => E.score(x.a) - E.score(x.b);
        return { t: t, o: o, tGain: mean(t.map(d)), oGain: o.length ? mean(o.map(d)) : 0, oBetter: o.filter((x) => d(x) > 0).length, oWorse: o.filter((x) => d(x) < -0.5).length };
      };
      // chaque candidat, seul : effet sur la cible et sur les autres
      const rated = [...cand.values()].map((x) => Object.assign({ s: x }, evalPick([x]))).sort((a, b) => (b.tGain + 0.5 * b.oGain) - (a.tGain + 0.5 * a.oGain));
      // cumul glouton : on garde un candidat s'il aide la cible sans faire baisser la moyenne des autres
      let pick = [], cur = { tGain: 0, oGain: 0 };
      for (const r of rated.slice(0, 8)) {
        if (r.tGain <= 0 || pick.some((y) => y.group === r.s.group)) continue;
        const trial = evalPick(pick.concat([r.s]));
        if (trial.tGain > cur.tGain + 0.5 && trial.oGain >= Math.min(0, cur.oGain) - 0.5) { pick.push(r.s); cur = trial; }
      }
      res = { kind: 'sel', T: T, O: O, rated: rated.slice(0, 6), pick: pick, eval: pick.length ? cur : null, e: T[0].e, strat: T[0].strat, settings: T[0].settings, config: T[0].config };
      // nouvelle simulation réelle de la (des) simulation(s) avec la stratégie améliorée
      if (pick.length) {
        res.after = [];
        for (const c of T) {
          step('Nouvelle simulation avec la stratégie améliorée…');
          const imp = improvedVersion(Object.assign({}, res, { e: c.e, strat: c.strat, settings: c.settings, config: c.config }));
          loadStrategy(imp.strat); applyConfig(imp.config);
          document.querySelector('input[name=period][value=custom]').checked = true;
          $('dateFrom').value = isoD(c.d.from); $('dateTo').value = isoD(c.d.to);
          evalNoRecord = true;
          const ok = await runFromForm();
          evalNoRecord = false;
          res.after.push(ok && lastRun ? lastRun.stats : runOn(c, pick));
        }
      }
    } catch (err) {
      improveHtml = '<p class="val ko">Analyse impossible : ' + esc(err.message) + '</p>';
    } finally {
      evalNoRecord = false; checkRunning = ''; setRunLabel('');
      restoring = true;
      try { loadStrategy(saved.strat); applyConfig(saved.config); $('style').value = saved.style; $('preset').value = [...$('preset').options].some((o) => o.value === saved.preset) ? saved.preset : 'mine'; $('presetDesc').textContent = saved.desc; updateWithdrawUI(); syncFormState(); }
      finally { restoring = false; }
    }
    if (res) { improveCtx = res; improveHtml = selectionImproveHtml(res); }
    renderEvaluation();
    if ($('improveOut')) $('improveOut').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function selectionImproveHtml(r) {
    const p = pctFine, num = (e) => '#' + (evalList().findIndex((x) => x.key === e.key) + 1);
    const who = r.T.map((c) => num(c.e)).join(', ');
    let h = '<h4>✨ Améliorer ' + who + ' · ' + esc(r.e.name) + '</h4><p class="hint">Améliorations cherchées sur ' + who + ', puis vérifiées sur ' + r.O.length + ' autre' + (r.O.length > 1 ? 's' : '') +
      ' simulation' + (r.O.length > 1 ? 's' : '') + ' de la stratégie' + (r.O.length ? ' (' + r.O.map((c) => num(c.e)).join(', ') + ')' : '') + '.</p>';
    if (!r.rated.length) return h + '<p class="val ko">Aucune modification testée n\'améliore cette simulation.</p>';
    const base0 = r.T[0].base;
    h += '<p><b>Ce qui est améliorable :</b></p><ul class="imp-list">' + r.rated.map((x) => '<li><span class="grp">' + esc(x.s.group) + '</span> ' + esc(x.s.title) + ' → ' +
      (r.T.length === 1 ? p(x.t[0].a.returnPct) + ' <span class="hint">(au lieu de ' + p(base0.returnPct) + ')</span>' : 'note ' + signed(x.tGain, num1) + ' pts') +
      (r.O.length ? ' · autres simulations : <span class="' + (x.oWorse > x.oBetter ? 'neg' : 'pos') + '">' + x.oBetter + ' meilleure' + (x.oBetter > 1 ? 's' : '') + ', ' + x.oWorse + ' moins bonne' + (x.oWorse > 1 ? 's' : '') + '</span>' : '') + '</li>').join('') + '</ul>';
    if (!r.pick.length || !r.after) return h + '<p class="val ko">Aucune combinaison n\'améliore ' + who + ' sans dégrader les autres simulations : la stratégie est déjà au mieux pour ces modifications.</p>';
    const ev = r.eval, good = r.after.every((st) => st.returnPct > 0) || r.after.every((st, k) => st.returnPct > r.T[k].base.returnPct);
    h += '<div class="imp-proposal"><p><b>Amélioration retenue :</b> ' + esc(r.pick.map((x) => x.title).join(' + ')) + '.</p>' +
      r.T.map((c, k) => '<p class="val ' + (r.after[k].returnPct > 0 ? 'ok' : 'ko') + '"><b>Nouvelle simulation ' + num(c.e) + '</b> (' + frDate(isoD(c.d.from)) + ' → ' + frDate(isoD(c.d.to)) + ') : ' + p(r.after[k].returnPct) +
        ' au lieu de ' + p(c.base.returnPct) + ', drawdown −' + num1.format(r.after[k].maxDrawdownPct) + ' % (au lieu de −' + num1.format(c.base.maxDrawdownPct) + ' %), ' + r.after[k].trades + ' trades.</p>').join('') +
      (r.O.length ? '<p>Sur les ' + r.O.length + ' autres simulations : ' + ev.oBetter + ' meilleure' + (ev.oBetter > 1 ? 's' : '') + ', ' + ev.oWorse + ' moins bonne' + (ev.oWorse > 1 ? 's' : '') +
        ' ; résultat médian ' + p(ev.o.map((x) => x.b.returnPct).sort((a, b) => a - b)[ev.o.length >> 1]) + ' → ' + p(ev.o.map((x) => x.a.returnPct).sort((a, b) => a - b)[ev.o.length >> 1]) + '.</p>' : '') +
      '<p>' + (good ? 'Le résultat vous convient ?' : 'Résultat encore perdant, mais meilleur.') + ' Ajouter ces améliorations :</p>' +
      '<div class="row buttons"><button type="button" class="primary small" id="impApplyCurrent">Ajouter à la stratégie en cours</button>' +
      '<button type="button" class="secondary small" id="impAsNew">Créer une nouvelle stratégie</button><button type="button" class="secondary small" id="impCancel">Ignorer</button></div>' +
      '<p class="hint">« Ajouter à la stratégie en cours » modifie les règles de « ' + esc(r.e.name) + ' » (et l\'enregistre si elle est enregistrée) ; Ctrl+Z pour annuler. ' +
      'Relancez ensuite un lot de tests aléatoires pour vérifier.</p></div>';
    return h;
  }
  const improveInPanel = () => (improveHtml && improveWhere === 'panel' ? '<div class="improve-out" id="improveOut">' + improveHtml + '</div>' : '');
  function applyToCurrent() {
    const r = improveCtx; if (!r) return;
    const name = r.e.strategy.name;
    undoable('Améliorations ajoutées à « ' + name + ' »', () => {
      const imp = improvedVersion(r, name);
      const cur = captureForm();
      // règles et gestion des trades améliorées ; la configuration du formulaire est gardée, sauf les réglages améliorés
      loadStrategy(Object.assign({}, imp.strat, { name: name }));
      applyConfig(Object.assign({}, cur.config, { leverage: imp.config.leverage, broker: Object.assign({}, cur.config.broker, { sizing: imp.config.broker.sizing, risk: imp.config.broker.risk }) }, imp.config.news ? { news: imp.config.news } : {}));
      const isSaved = storage.get().some((x) => x.name === name);
      if (isSaved) saveStrategy(Object.assign({}, imp.strat, { name: name }), currentConfig());
      else { $('preset').value = 'mine'; }
      $('presetDesc').textContent = 'Améliorations ajoutées : ' + r.pick.map((x) => x.title).join(' + ') + (isSaved ? ' (stratégie enregistrée).' : '. Pensez à « Enregistrer la stratégie ».');
      logEvent('strategy.enhanced', 'Améliorations ajoutées à ' + name + ' depuis l\'évaluation : ' + r.pick.map((x) => x.title).join(' + '), { name: name });
    });
    improveCtx = null;
    toast('Améliorations ajoutées à « ' + name + ' ».', true);
    // les barres ciblées sont relancées avec la stratégie améliorée (mêmes numéros)
    const improved = currentStrategy();
    const targetKeys = (r.T || [{ e: r.e }]).map((c) => c.e.key);
    pushUndo('Simulations relancées avec « ' + name + ' » améliorée');
    improveHtml = '<div class="modal-loading"><span class="spinner"></span>Nouvelle simulation avec la version améliorée…</div>'; improveWhere = 'panel';
    rerunWithStrategy(targetKeys, improved).then(() => {
      const others = evalList().filter((e) => e.name === name && !e.tag && !targetKeys.includes(e.key)).map((e) => e.key);
      improveHtml = '<p class="val ok">Améliorations ajoutées à « ' + esc(name) + ' » : ' + esc(r.pick.map((x) => x.title).join(' + ')) + '. ' +
        (targetKeys.length > 1 ? 'Les simulations choisies ont' : 'La simulation choisie a') + ' été relancée' + (targetKeys.length > 1 ? 's' : '') + ' avec la nouvelle version.</p>' +
        (others.length ? '<p>Les ' + others.length + ' autres simulations de la stratégie portent encore sur l\'ancienne version.</p><div class="row buttons"><button type="button" class="primary small" id="impRerunOthers" data-keys="' +
          esc(others.join('\n')) + '">Resimuler les ' + others.length + ' autres avec la version améliorée</button></div>' : '');
      improveWhere = 'panel';
      renderEvaluation();
    });
  }
  /** Relance des simulations (mêmes dates, même capital) avec une autre version de la stratégie ; elles sont modifiées sur place. */
  async function rerunWithStrategy(keys, strat, extra) {
    if (checkRunning) return;
    const saved = captureForm();
    checkRunning = 'upd'; checkStop = false;
    try {
      for (let k = 0; k < keys.length && !checkStop; k++) {
        const e = evalList().find((x) => x.key === keys[k]);
        if (!e) continue;
        checkCurrentKey = e.key; setRunLabel('Simulation ' + (k + 1) + ' / ' + keys.length);
        if (!$('evalModal').hidden && evalView === 'charts') renderEvaluation();
        const d = datesOf(e);
        evalMarkImproved = true;
        try { await rerunEntry(e, d.from, d.to, '', true, extra || null, Object.assign({}, strat, { name: e.name })); } finally { evalMarkImproved = false; }
        if (!$('evalModal').hidden && evalView === 'charts') renderEvaluation();
        await new Promise((res) => setTimeout(res, 120));
      }
    } finally {
      checkRunning = ''; checkCurrentKey = ''; setRunLabel('');
      restoring = true;
      try { loadStrategy(saved.strat); applyConfig(saved.config); $('style').value = saved.style; $('preset').value = [...$('preset').options].some((o) => o.value === saved.preset) ? saved.preset : 'mine'; $('presetDesc').textContent = saved.desc; updateWithdrawUI(); syncFormState(); }
      finally { restoring = false; }
    }
  }
  function improveReportHtml(r) {
    const idx = evalList().findIndex((x) => x.key === r.e.key) + 1;
    const p = pctFine;
    const list = r.sugg.suggestions.filter((x) => x.group !== 'Combinaison recommandée').slice(0, 6);
    let h = '<h4>Améliorer #' + idx + ' · ' + esc(r.e.name) + '</h4><p class="hint">Analyse sur ' + frDate(r.from) + ' → ' + frDate(r.to) + ' : résultat actuel ' + p(r.base.returnPct) +
      ', drawdown −' + num1.format(r.base.maxDrawdownPct) + ' %, ' + r.base.trades + ' trades.</p>';
    if (!list.length) return h + '<p class="val ko">Aucune des modifications testées (réglages, filtres de tendance, stops, sorties, gestion des trades…) n\'améliore cette simulation : la stratégie ne convient pas à cette période.</p>';
    h += '<p><b>Ce qui a pu être amélioré :</b></p><ul class="imp-list">' + list.map((x) => '<li><span class="grp">' + esc(x.group) + '</span> ' + esc(x.title) + ' → ' + p(x.stats.returnPct) +
      ' <span class="hint">(au lieu de ' + p(r.base.returnPct) + ')</span>' + (x.validation ? ' <span class="' + (x.validation.confirmed ? 'pos' : 'hint') + '">' + (x.validation.confirmed ? '✓ confirmée sur ' + x.validation.wins + '/' + x.validation.total + ' périodes de contrôle' : 'non confirmée') + '</span>' : '') + '</li>').join('') + '</ul>';
    if (r.pick.length && r.stats) {
      const titles = r.pick.map((x) => x.title).join(' + ');
      const good = r.stats.returnPct > 0 && r.stats.returnPct > r.base.returnPct;
      h += '<div class="imp-proposal"><p><b>Amélioration appliquée :</b> ' + esc(titles) + '.</p>' +
        '<p class="val ' + (good ? 'ok' : 'ko') + '"><b>Nouvelle simulation</b> (' + frDate(r.from) + ' → ' + frDate(r.to) + ') : ' + p(r.stats.returnPct) + ' au lieu de ' + p(r.base.returnPct) +
        ', drawdown −' + num1.format(r.stats.maxDrawdownPct) + ' %, ' + r.stats.trades + ' trades. ' + (good ? '✓ C\'est bon : la simulation passe au vert.' : '✗ Pas suffisant : la simulation reste perdante.') + '</p>' +
        (good ? '<p>Ajouter ces améliorations dans une nouvelle stratégie ?</p>' : '<p class="hint">Vous pouvez quand même créer la nouvelle stratégie pour la tester sur d\'autres périodes.</p>') +
        '<label class="field imp-name">Nom de la nouvelle stratégie<input id="impName" type="text" maxlength="80" value="' + esc(newStratName(r.e.name)) + '"></label>' +
        '<div class="row buttons"><button type="button" class="' + (good ? 'primary' : 'secondary') + ' small" id="impCreate">' + (good ? 'Créer la nouvelle stratégie' : 'Créer quand même') + '</button><button type="button" class="secondary small" id="impCancel">Ignorer</button></div>' +
        '<p class="hint">« ' + esc(r.e.name) + ' » est enregistrée telle quelle ; la nouvelle stratégie est enregistrée à côté avec ces améliorations, puis chargée dans le formulaire. ' +
        'Ces améliorations ont été trouvées sur cette seule période : vérifiez la nouvelle stratégie avec un lot de tests aléatoires avant de la déployer.</p></div>';
    }
    return h;
  }
  /** Stratégie et configuration améliorées (règles + réglages comme levier, taille, annonces). */
  function improvedVersion(r, name) {
    const c = E.combine(r.strat, r.settings, r.pick);
    const s = Object.assign({}, c.strat, { name: name || r.e.name, style: r.strat.style || 'none' });
    s.plots = F.french.derivePlots(s);
    s.frenchText = F.french.toFrench(s) || '';
    const base = r.config || r.e.config;
    const config = Object.assign({}, base, { leverage: c.settings.leverage, capital: r.settings.capital, broker: Object.assign({}, base.broker, { sizing: c.settings.sizing, risk: c.settings.riskPct }) });
    if (c.settings.news) config.news = { on: true, mode: c.settings.news.mode, before: c.settings.news.before, after: c.settings.news.after, impact: (base.news || {}).impact || 'high' };
    return { strat: s, config: config, cStrat: c.strat, cSettings: c.settings };
  }
  function newStratName(name) {
    const base = String(name).replace(/ · v\d+$/, ''), taken = new Set(storage.get().map((x) => x.name));
    let k = 2; while (taken.has(base + ' · v' + k)) k++;
    return base + ' · v' + k;
  }
  function createImproved() {
    const r = improveCtx; if (!r) return;
    const name = ($('impName').value || '').trim() || newStratName(r.e.name);
    undoable('Nouvelle stratégie « ' + name + ' »', () => {
      // 1) l'ancienne est enregistrée telle quelle (si elle ne l'est pas déjà)
      const old = Object.assign({}, r.e.strategy);
      if (!storage.get().some((x) => x.name === old.name)) saveStrategy(old, r.e.config);
      // 2) la nouvelle : règles et réglages améliorés
      const imp = improvedVersion(r, name), s = imp.strat;
      // la nouvelle stratégie garde la configuration d'origine (période, capital…), avec les réglages améliorés
      const config = Object.assign({}, r.e.config, { leverage: imp.config.leverage, broker: imp.config.broker }, imp.config.news ? { news: imp.config.news } : {});
      loadStrategy(s);
      applyConfig(config);
      saveStrategy(s, config, r.stats);
      $('presetDesc').textContent = 'Nouvelle stratégie créée à partir de « ' + old.name + ' » (conservée) : ' + r.pick.map((x) => x.title).join(' + ') + '.';
      logEvent('strategy.improved', 'Nouvelle stratégie ' + name + ' créée depuis ' + old.name + ' : ' + r.pick.map((x) => x.title).join(' + '), { from: old.name, to: name });
    });
    improveHtml = '<p class="val ok">« ' + esc(name) + ' » est créée, enregistrée et chargée dans le formulaire ; « ' + esc(r.e.name) + ' » est conservée. Lancez un backtest ou un lot de tests pour la vérifier.</p>';
    improveCtx = null;
    toast('« ' + name + ' » créée et chargée ; « ' + r.e.name + ' » est conservée.', true);
    renderEvaluation();
  }
  $('evalBody').addEventListener('click', (ev) => {
    const b = ev.target.closest('.imp-btn');
    if (b) return improveFromReport(b);
    if (ev.target.id === 'impCreate') return createImproved();
    if (ev.target.id === 'impApplyCurrent') return applyToCurrent();
    if (ev.target.id === 'manToCurrent') return saveManual(false);
    if (ev.target.id === 'manAsNew') return saveManual(true);
    if (ev.target.id === 'impRerunOthers') {
      const keys = ev.target.dataset.keys.split('\n');
      pushUndo('Simulations relancées avec la version améliorée');
      improveHtml = '';
      return rerunWithStrategy(keys, currentStrategy()).then(() => {
        improveHtml = '<p class="val ok">' + keys.length + ' simulations relancées avec la version améliorée (barres mises à jour, résultat d\'origine en plein, nouveau en pointillé). Ctrl+Z pour annuler.</p>';
        improveWhere = 'panel'; renderEvaluation();
      });
    }
    if (ev.target.id === 'impAsNew') {
      // même création que depuis le rapport, avec un nom proposé
      const nm = prompt('Nom de la nouvelle stratégie :', newStratName(improveCtx.e.name));
      if (!nm) return;
      const box = document.createElement('input'); box.id = 'impName'; box.value = nm; box.hidden = true; $('evalBody').appendChild(box);
      return createImproved();
    }
    if (ev.target.id === 'impCancel') { improveHtml = ''; improveCtx = null; renderEvaluation(); }
  });
  function renderEvalReco(list, filtered) {
    const A = F.advisor.analyze(list);
    const conf = { forte: 'Confiance forte', moyenne: 'Confiance moyenne', faible: 'Confiance faible' };
    $('evalBody').innerHTML = '<div class="reco-head"><p>Analyse de ' + (filtered ? 'vos ' + list.length + ' simulations affichées' : 'vos ' + list.length + ' simulations') +
      ', calculée dans votre navigateur à partir de l\'historique : moyenne, médiane, part de simulations gagnantes et drawdown, en donnant moins de poids aux groupes testés peu de fois. Ce n\'est pas une garantie pour l\'avenir.</p></div>' +
      A.warnings.map((w) => '<p class="reco-warn">⚠ ' + esc(w) + '</p>').join('') +
      '<div class="reco-grid">' + A.recos.map((r) => '<article class="reco ' + r.level + '"><header><h4>' + esc(r.title) + '</h4>' + (r.confidence ? '<span class="conf ' + r.confidence + '">' + conf[r.confidence] + '</span>' : '') + '</header>' +
        (r.pick ? '<p class="pick">' + esc(r.pick) + '</p>' : '') + '<p>' + esc(r.text) + '</p>' +
        (r.id === 'strategy' ? '<button type="button" class="secondary small" id="recoLoad">Recharger cette stratégie (meilleure simulation)</button>' : '') + '</article>').join('') + '</div>' +
      '<div class="reco-actions"><button type="button" class="secondary" id="recoBatch">Lancer un lot de tests aléatoires</button>' +
      '<button type="button" class="secondary danger" id="recoReset">Réinitialiser les évaluations</button></div>';
    const best = A.groups.strategy && A.groups.strategy[0];
    const load = $('recoLoad');
    if (load && best) load.addEventListener('click', () => {
      const e = best.entries.slice().sort((a, b) => F.advisor.scoreOf(b) - F.advisor.scoreOf(a))[0];
      const i = evalList().indexOf(e);
      const btn = document.createElement('button'); btn.dataset.reload = String(i); $('evalBody').appendChild(btn); btn.click();
    });
    $('recoReset').addEventListener('click', () => { $('evalResetAll').click(); $('evalConfirm').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
    $('recoBatch').addEventListener('click', () => { closeEvaluation(); $('batchCount').focus(); $('batchCount').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  }
  $('evalScopeCurrent').addEventListener('click', () => setEvalScope('current'));
  $('evalScopeAll').addEventListener('click', () => setEvalScope('all'));
  function openEvaluation(view) {
    evalScope = 'current'; evalBatch = null;
    // dernier batch actif (lot aléatoire lancé, ou batch rechargé) : l'évaluation s'ouvre dessus
    const ab = activeBatchId && batchStore.get().find((x) => x.id === activeBatchId);
    if (ab) evalBatch = { id: ab.id, keys: new Set(ab.entries.map((e) => e.key)) }; else activeBatchId = '';
    if (typeof view === 'string') { evalView = view; document.querySelectorAll('.eval-views [data-view]').forEach((x) => x.setAttribute('aria-selected', x.dataset.view === view)); }
    $('evalScopeCurrent').setAttribute('aria-selected', 'true'); $('evalScopeAll').setAttribute('aria-selected', 'false'); $('evalScopeBatch').setAttribute('aria-selected', 'false');
    $('evalConfirm').hidden = true;
    renderEvaluation();
    $('evalModal').hidden = false;
    document.body.style.overflow = 'hidden';
    $('evalModal').querySelector('.close').focus();
  }
  function closeEvaluation() { $('evalModal').hidden = true; document.body.style.overflow = ''; }
  $('evalBtn').addEventListener('click', () => openEvaluation());
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
  // Effacement : toutes les simulations (« Tout effacer ») ou seulement celles de l'onglet (« Réinitialiser »).
  let pendingDelete = null; // null = tout ; sinon liste des clés à effacer
  function askClear(keys, who) {
    pendingDelete = keys;
    const n = keys ? keys.length : evalList().length;
    $('evalConfirmQ').textContent = 'Effacer ' + (n > 1 ? 'les ' + n + ' simulations' : n === 1 ? 'la simulation' : 'les simulations') + (keys ? ' ' + (n === 1 ? who.q.replace('affichées', 'affichée') : who.q) : ' du tableau') + ' ?';
    $('evalConfirmWho').textContent = keys ? who.note : 'Toutes les stratégies sont concernées';
    $('evalClearGo').textContent = keys ? 'Effacer' : 'Tout effacer';
    $('evalConfirm').hidden = false;
  }
  $('evalClear').addEventListener('click', () => askClear(null));
  // « Réinitialiser » : onglet « Stratégie en cours » = seulement cette stratégie ; « Historique complet » = les simulations affichées
  $('evalResetAll').addEventListener('click', () => {
    if (evalScope === 'current') {
      const name = currentStratName();
      askClear(evalList().filter((e) => e.name === name).map((e) => e.key), { q: 'de « ' + name + ' »', note: 'Les simulations des autres stratégies sont conservées' });
    } else {
      const shown = evalFiltered(evalList()).map((x) => x.e), all = evalList().length;
      if (shown.length === all) askClear(null);
      else askClear(shown.map((e) => e.key), { q: 'affichées (filtres appliqués)', note: 'Les ' + (all - shown.length) + ' autres simulations sont conservées' });
    }
    $('evalClearGo').focus();
    $('evalConfirm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('evalClearCancel').addEventListener('click', () => { $('evalConfirm').hidden = true; });
  $('evalClearGo').addEventListener('click', () => {
    if (pendingDelete) {
      const keys = new Set(pendingDelete), list = evalList();
      pushUndo('Effacement de ' + keys.size + ' simulation(s)');
      evalSave(list.filter((e) => !keys.has(e.key)));
      for (const k of keys) { dbPush('simulations/delete', { key: k }); cloudPush(() => C.deleteSimulation(k)); }
      toast(keys.size + ' simulation' + (keys.size > 1 ? 's effacées' : ' effacée') + '.', true);
      logEvent('simulation.cleared', keys.size + ' simulation(s) effacée(s) du tableau d\'évaluation');
      pendingDelete = null; checkReport = '';
      $('evalConfirm').hidden = true;
      renderEvaluation();
      return;
    }
    pushUndo('Effacement du tableau d\'évaluation');
    toast('Tableau d\'évaluation effacé.', true);
    const n = evalList().length;
    evalSave([]);
    dbPush('simulations/clear', {});
    cloudPush(() => C.clearSimulations());
    checkReport = '';
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
  // à l'ouverture : la dernière simulation de la stratégie affichée, s'il y en a une
  setTimeout(() => { try { if (!lastRunCtx) showLastSimulation(true); } catch (e) { /* ignoré */ } }, 400);
})();
