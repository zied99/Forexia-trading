/* Forexia — page admin (étape 1 : observation).
 * Les machines (PC Windows avec MT5) envoient leur état et leurs opérations via l'agent (bridge/forexia_agent.py)
 * dans Supabase : tables machines, trade_ops, trade_snaps. Ici on les lit, on rattache chaque numéro magique
 * (un EA) à un plan (table activations) et on signale ce qui demande attention. Rien n'est envoyé à MT5. */
(function () {
  'use strict';
  const F = window.Forexia, C = F.cloud, $ = (id) => document.getElementById(id);
  const REFRESH_S = 20, SILENT_S = 120, SNAP_DAYS = 7;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }).format(v || 0);
  const cur = (v, c) => { try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: c || 'EUR' }).format(v || 0); } catch (e) { return num(v) + ' ' + (c || ''); } };
  const signed = (v, c) => (v > 0.004 ? '+' : v < -0.004 ? '−' : '') + cur(Math.abs(v), c);
  const tone = (v) => (v > 0.004 ? 'up' : v < -0.004 ? 'down' : '');
  const dtf = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  const fdate = (s) => (s ? dtf.format(new Date(s)) : '—');
  function ago(s) {
    if (!s) return 'jamais';
    const x = Math.max(0, (Date.now() - new Date(s).getTime()) / 1000);
    if (x < 60) return 'il y a ' + Math.round(x) + ' s';
    if (x < 3600) return 'il y a ' + Math.round(x / 60) + ' min';
    if (x < 86400 * 2) return 'il y a ' + Math.round(x / 3600) + ' h';
    return 'il y a ' + Math.round(x / 86400) + ' j';
  }
  const TRADE_KINDS = new Set(['achat', 'vente']);

  let machines = [], acts = [], plans = [], view = 'overview', timer = null, snapAt = 0;
  const ops = {}, lastAt = {}, snaps = {};
  const opsF = { machine: '', magic: '', q: '' };
  let linking = null;

  function toast(msg) { const t = $('adToast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4000); }
  function show(which) {
    $('adLogin').hidden = which !== 'login';
    $('adOverview').hidden = which !== 'overview';
    $('adOps').hidden = which !== 'ops';
    $('adNav').hidden = which === 'login';
    $('adUser').hidden = which === 'login';
    document.querySelectorAll('.cl-tab').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === which)));
  }

  // ---------- calculs ----------
  const silent = (m) => !m.seen_at || (Date.now() - new Date(m.seen_at).getTime()) / 1000 > SILENT_S;
  const actOf = (mid, magic) => acts.find((a) => a.machine_id === mid && Number(a.magic) === Number(magic));
  const opNet = (o) => (o.profit || 0) + (o.swap || 0) + (o.commission || 0) + (o.fee || 0);

  /** Résumé par numéro magique : positions ouvertes, latent, réalisé, nombre de trades clôturés. */
  function byMagic(m) {
    const L = ops[m.id] ? Array.from(ops[m.id].values()) : [], res = new Map();
    const get = (k) => { if (!res.has(k)) res.set(k, { magic: k, open: 0, volume: 0, floating: 0, realized: 0, closed: 0, first: null, last: null }); return res.get(k); };
    let deposits = 0, withdrawals = 0;
    for (const o of L) {
      if (o.kind === 'solde') { if (o.profit >= 0) deposits += o.profit; else withdrawals -= o.profit; continue; }
      const r = get(TRADE_KINDS.has(o.kind) ? Number(o.magic) || 0 : 0);
      r.realized += opNet(o);
      if (TRADE_KINDS.has(o.kind) && o.entry !== 'in') r.closed++;
      if (!r.first || o.at < r.first) r.first = o.at;
      if (!r.last || o.at > r.last) r.last = o.at;
    }
    for (const p of m.positions || []) { const r = get(Number(p.magic) || 0); r.open++; r.volume += p.volume || 0; r.floating += (p.profit || 0) + (p.swap || 0); }
    for (const a of acts) if (a.machine_id === m.id) get(Number(a.magic));
    const rows = Array.from(res.values()).sort((a, b) => (a.magic === 0) - (b.magic === 0) || a.magic - b.magic);
    return { rows, deposits, withdrawals };
  }

  function alertsOf(m) {
    const i = m.info || {}, out = [], name = esc(m.name || m.id);
    if (silent(m)) out.push(['bad', '<b>' + name + '</b> : agent silencieux (dernier relevé ' + ago(m.seen_at) + '). Le PC, Internet ou l\'agent est arrêté.']);
    else if (i.mt5 === false) out.push(['bad', '<b>' + name + '</b> : MT5 injoignable. ' + esc(i.error || '')]);
    else {
      if (i.connected === false) out.push(['bad', '<b>' + name + '</b> : MT5 n\'est pas connecté au serveur du courtier.']);
      if (i.algoTrading === false) out.push(['warn', '<b>' + name + '</b> : le bouton « Trading algorithmique » de MT5 est désactivé, les EA ne tradent pas.']);
      if (i.accountExpertAllowed === false) out.push(['warn', '<b>' + name + '</b> : le courtier n\'autorise pas les EA sur ce compte.']);
      if (i.marginMode && i.marginMode !== 'hedging') out.push(['warn', '<b>' + name + '</b> : compte en mode ' + esc(i.marginMode) + '. Pour plusieurs plans sur un même symbole, il faut un compte « hedging ».']);
      if (i.marginLevel && i.margin > 0 && i.marginLevel < 300) out.push([i.marginLevel < 150 ? 'bad' : 'warn', '<b>' + name + '</b> : niveau de marge bas (' + num(i.marginLevel, 0) + ' %).']);
      if (i.serverOffsetKnown === false) out.push(['info', '<b>' + name + '</b> : heure du serveur du courtier pas encore détectée (marché fermé ?) : les heures des opérations peuvent être décalées.']);
    }
    const loose = new Set((m.positions || []).map((p) => Number(p.magic) || 0).filter((k) => k && !actOf(m.id, k)));
    loose.forEach((k) => out.push(['info', '<b>' + name + '</b> : positions ouvertes avec le numéro magique <b>' + k + '</b>, rattaché à aucun plan.']));
    if ((m.positions || []).some((p) => !Number(p.magic))) out.push(['info', '<b>' + name + '</b> : positions ouvertes à la main (numéro magique 0).']);
    return out;
  }

  function spark(list, cy) {
    const pts = list.filter((s) => s.data && typeof s.data.equity === 'number');
    if (pts.length < 2) return '<div class="ad-spark empty">La courbe apparaîtra après quelques relevés (une photo toutes les 15 min).</div>';
    const W = 600, H = 90, t0 = new Date(pts[0].at).getTime(), t1 = new Date(pts[pts.length - 1].at).getTime() || t0 + 1;
    const vals = pts.flatMap((s) => [s.data.equity, s.data.balance]).filter((v) => typeof v === 'number');
    let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const X = (s) => ((new Date(s.at).getTime() - t0) / Math.max(1, t1 - t0)) * W, Y = (v) => H - 6 - ((v - lo) / (hi - lo)) * (H - 12);
    const line = (k) => pts.filter((s) => typeof s.data[k] === 'number').map((s, j) => (j ? 'L' : 'M') + X(s).toFixed(1) + ' ' + Y(s.data[k]).toFixed(1)).join(' ');
    const last = pts[pts.length - 1].data, first = pts[0].data, d = last.equity - first.equity;
    return '<figure class="ad-spark"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Valeur du compte sur ' + SNAP_DAYS + ' jours"><path class="bal" d="' + line('balance') + '"/><path class="eq" d="' + line('equity') + '"/></svg>' +
      '<figcaption><span><i class="eq"></i>Valeur</span><span><i class="bal"></i>Solde</span><span>' + SNAP_DAYS + ' derniers jours : <b class="' + tone(d) + '">' + signed(d, cy) + '</b></span></figcaption></figure>';
  }

  // ---------- vue d'ensemble ----------
  function machineHtml(m) {
    const i = m.info || {}, cy = i.currency, off = silent(m), bad = off || i.mt5 === false || i.connected === false;
    const state = off ? 'Silencieuse' : i.mt5 === false ? 'MT5 injoignable' : i.connected === false ? 'MT5 déconnecté' : 'En ligne';
    const badge = (cls, txt) => '<span class="ad-badge ' + cls + '">' + txt + '</span>';
    let h = '<article class="ad-machine" data-mid="' + esc(m.id) + '"><header class="ad-m-head"><span class="ad-dot ' + (bad ? 'bad' : 'ok') + '"></span><div class="ad-m-title"><h2>' + esc(m.name || m.id) +
      ' <button type="button" class="ad-icon" data-rename="' + esc(m.id) + '" title="Renommer" aria-label="Renommer">✎</button></h2>' +
      '<p>' + state + ' · relevé ' + ago(m.seen_at) + (i.host ? ' · PC ' + esc(i.host) : '') + (i.agent ? ' · agent ' + esc(i.agent) : '') + '</p></div><div class="ad-badges">' +
      (i.tradeMode ? badge(i.tradeMode === 'réel' ? 'real' : 'demo', i.tradeMode === 'réel' ? 'Compte réel' : 'Compte ' + esc(i.tradeMode)) : '') +
      (i.marginMode ? badge(i.marginMode === 'hedging' ? 'ok' : 'warn', esc(i.marginMode[0].toUpperCase() + i.marginMode.slice(1))) : '') +
      (i.algoTrading != null ? badge(i.algoTrading ? 'ok' : 'warn', 'Trading algo ' + (i.algoTrading ? 'activé' : 'désactivé')) : '') +
      (i.readOnly ? badge('', 'Lecture seule') : '') + '</div></header>';
    if (i.login) {
      h += '<p class="ad-m-acc">' + ['Compte <b>' + esc(i.login) + '</b>', esc(i.server || ''), esc(i.company || ''), i.leverage ? 'levier 1:' + esc(i.leverage) : '', esc(i.currency || '')].filter(Boolean).join(' · ') + '</p>';
      const k = (l, v, cls, sub) => '<div class="ad-kpi"><span>' + l + '</span><b class="' + (cls || '') + '">' + v + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
      h += '<div class="ad-kpis">' + k('Solde', cur(i.balance, cy)) + k('Valeur', cur(i.equity, cy)) + k('Latent', signed(i.profit || 0, cy), tone(i.profit)) +
        k('Marge utilisée', cur(i.margin, cy)) + k('Marge libre', cur(i.marginFree, cy)) + k('Niveau de marge', i.margin > 0 ? num(i.marginLevel, 0) + ' %' : '—', i.margin > 0 && i.marginLevel < 300 ? 'down' : '') + '</div>';
      h += spark(snaps[m.id] || [], cy);
    } else if (!off) h += '<p class="ad-m-acc">En attente du premier relevé de MT5.</p>';
    // plans par numéro magique
    const s = byMagic(m);
    h += '<div class="ad-sub"><h3>Plans sur cette machine</h3><button type="button" class="cl-ghost small" data-link-new="' + esc(m.id) + '">＋ Rattacher un numéro magique</button></div>';
    if (!s.rows.length) h += '<p class="ad-empty">Aucune opération pour l\'instant. Ouvrez un EA Forexia dans MT5 : chaque EA a un « numéro magique » (paramètre InpMagic) qui permet de suivre ses opérations.</p>';
    else {
      h += '<div class="cl-table-wrap"><table class="cl-table ad-table"><thead><tr><th class="l">Numéro magique</th><th class="l">Plan</th><th>Capital</th><th>Positions</th><th>Latent</th><th>Réalisé</th><th>Total</th><th>Trades</th><th>Dernière opération</th><th></th></tr></thead><tbody>';
      for (const r of s.rows) {
        const a = r.magic ? actOf(m.id, r.magic) : null, tot = r.realized + r.floating, pct = a && a.capital ? (tot / a.capital) * 100 : null;
        h += '<tr><td class="l"><b>' + (r.magic || '0') + '</b></td><td class="l">' + (r.magic === 0 ? '<span class="ad-muted">Manuel et frais du compte</span>' : a ? '<b>' + esc(a.label || a.plan_id || 'Plan') + '</b><small>depuis le ' + fdate(a.started_at).slice(0, 8) + '</small>' : '<span class="ad-badge warn">Non rattaché</span>') + '</td>' +
          '<td>' + (a && a.capital ? cur(a.capital, cy) : '—') + '</td><td>' + (r.open ? r.open + ' <small>' + num(r.volume) + ' lot</small>' : '—') + '</td>' +
          '<td class="' + tone(r.floating) + '">' + (r.open ? signed(r.floating, cy) : '—') + '</td><td class="' + tone(r.realized) + '">' + signed(r.realized, cy) + '</td>' +
          '<td class="' + tone(tot) + '"><b>' + signed(tot, cy) + '</b>' + (pct != null ? '<small>' + (pct >= 0 ? '+' : '−') + num(Math.abs(pct), 1) + ' % du capital</small>' : '') + '</td>' +
          '<td>' + r.closed + '</td><td>' + fdate(r.last) + '</td><td>' + (r.magic ? '<button type="button" class="cl-ghost small" data-link="' + esc(m.id) + '|' + r.magic + '">' + (a ? 'Modifier' : 'Rattacher') + '</button>' : '') + '</td></tr>';
      }
      h += '</tbody></table></div>';
      if (s.deposits || s.withdrawals) h += '<p class="ad-muted ad-foot">Versements sur le compte : ' + cur(s.deposits, cy) + (s.withdrawals ? ' · retraits : ' + cur(s.withdrawals, cy) : '') + ' (période relevée par l\'agent).</p>';
    }
    h += '<details class="ad-more"><summary>Plus</summary><p class="ad-muted">Machine <code>' + esc(m.id) + '</code> · enregistrée le ' + fdate(m.created_at) +
      (i.serverOffsetH != null ? ' · heure du courtier UTC' + (i.serverOffsetH >= 0 ? '+' : '') + i.serverOffsetH : '') + (i.terminalBuild ? ' · MT5 build ' + esc(i.terminalBuild) : '') + '</p>' +
      '<button type="button" class="cl-ghost small ad-danger" data-forget="' + esc(m.id) + '">Retirer cette machine</button> <span class="ad-muted">(efface aussi ses opérations relevées ; MT5 n\'est pas touché)</span></details>';
    return h + '</article>';
  }

  function addMachineHtml(first) {
    return '<section class="ad-add' + (first ? ' first' : '') + '"><h2>' + (first ? 'Relier votre PC Windows' : 'Ajouter une machine') + '</h2>' +
      (first ? '<ol class="ad-steps"><li>Sur le PC Windows, ouvrez MT5 et connectez-vous à votre compte.</li><li>Dans le dossier <code>bridge</code> de Forexia, lancez <b>demarrer-agent.bat</b>. La première fois, il crée le compte de l\'agent (choisissez un identifiant et un mot de passe propres à l\'agent).</li><li>L\'agent affiche un <b>code d\'appairage</b> : saisissez-le ci-dessous.</li><li>Pour qu\'il démarre avec Windows : <code>python forexia_agent.py --demarrage-auto</code>.</li></ol>' : '') +
      '<form class="ad-claim" id="adClaim"><label class="cl-field">Code d\'appairage<input id="adCode" placeholder="ABCD-EFGH" autocomplete="off" maxlength="12" required></label><button type="submit" class="cl-primary">Relier</button></form></section>';
  }

  function renderOverview() {
    const all = machines.flatMap(alertsOf);
    let h = '<div class="cl-intro"><h1>Vue d\'ensemble</h1><p>L\'agent de chaque PC relit MT5 toutes les 30 secondes. Étape 1 : observation seulement, aucun ordre n\'est passé depuis cette page.</p></div>';
    if (all.length) h += '<ul class="ad-alerts">' + all.map(([k, t]) => '<li class="' + k + '">' + t + '</li>').join('') + '</ul>';
    else if (machines.length) h += '<p class="ad-allgood">✓ Tout fonctionne : machines en ligne, MT5 connecté.</p>';
    h += machines.map(machineHtml).join('');
    h += addMachineHtml(!machines.length);
    const open = Array.from(document.querySelectorAll('#adOverview details[open]')).map((d) => d.closest('[data-mid]') && d.closest('[data-mid]').dataset.mid);
    $('adOverview').innerHTML = h;
    open.forEach((id) => { const d = document.querySelector('#adOverview [data-mid="' + id + '"] details'); if (d) d.open = true; });
  }

  // ---------- opérations ----------
  function filteredOps() {
    const mids = opsF.machine ? [opsF.machine] : machines.map((m) => m.id), q = opsF.q.trim().toLowerCase();
    let L = [];
    mids.forEach((mid) => { if (ops[mid]) L = L.concat(Array.from(ops[mid].values())); });
    if (opsF.magic !== '') L = L.filter((o) => String(o.magic || 0) === opsF.magic);
    if (q) L = L.filter((o) => [o.symbol, o.kind, o.comment, o.ticket, o.position_id].some((x) => String(x == null ? '' : x).toLowerCase().includes(q)));
    return L.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.ticket - a.ticket));
  }
  function renderOps() {
    const byId = new Map(machines.map((m) => [m.id, m])), L = filteredOps(), shown = L.slice(0, 500);
    const magics = new Set(); machines.forEach((m) => { if (!opsF.machine || opsF.machine === m.id) (ops[m.id] ? Array.from(ops[m.id].values()) : []).forEach((o) => magics.add(String(o.magic || 0))); });
    const label = (mid, k) => { const a = Number(k) ? actOf(mid, k) : null; return a ? esc(a.label || a.plan_id) : Number(k) ? '' : 'manuel / compte'; };
    let net = 0; L.forEach((o) => { if (o.kind !== 'solde') net += opNet(o); });
    const cy = (machines[0] && machines[0].info && machines[0].info.currency) || 'EUR';
    let h = '<div class="cl-intro"><h1>Opérations</h1><p>Chaque transaction relevée dans MT5, avec son numéro magique (le plan qui l\'a passée). Le ticket MT5 empêche tout doublon.</p></div>' +
      '<div class="ad-filters">' + (machines.length > 1 ? '<label class="cl-field">Machine<select data-of="machine"><option value="">Toutes</option>' + machines.map((m) => '<option value="' + esc(m.id) + '"' + (opsF.machine === m.id ? ' selected' : '') + '>' + esc(m.name || m.id) + '</option>').join('') + '</select></label>' : '') +
      '<label class="cl-field">Numéro magique<select data-of="magic"><option value="">Tous</option>' + Array.from(magics).sort((a, b) => a - b).map((k) => '<option value="' + k + '"' + (opsF.magic === k ? ' selected' : '') + '>' + k + (machines.length === 1 && label(machines[0].id, k) ? ' · ' + label(machines[0].id, k) : '') + '</option>').join('') + '</select></label>' +
      '<label class="cl-field">Recherche<input type="search" data-of="q" value="' + esc(opsF.q) + '" placeholder="symbole, ticket, commentaire"></label>' +
      '<button type="button" class="cl-ghost" id="adCsv"' + (L.length ? '' : ' disabled') + '>Exporter (CSV)</button></div>' +
      '<p class="ad-muted">' + L.length + ' opération(s)' + (L.length > 500 ? ', les 500 plus récentes affichées' : '') + ' · résultat net hors versements : <b class="' + tone(net) + '">' + signed(net, cy) + '</b></p>';
    if (!shown.length) h += '<p class="ad-empty">Aucune opération.</p>';
    else {
      h += '<div class="cl-table-wrap"><table class="cl-table ad-table"><thead><tr><th class="l">Date</th><th>Ticket</th><th class="l">Magique</th><th class="l">Symbole</th><th class="l">Type</th><th class="l">Sens</th><th>Volume</th><th>Prix</th><th>Résultat</th><th>Swap</th><th>Comm.</th><th>Net</th></tr></thead><tbody>' +
        shown.map((o) => { const m = byId.get(o.machine_id), c = (m && m.info && m.info.currency) || cy, n = opNet(o), lb = label(o.machine_id, o.magic || 0);
          return '<tr><td class="l">' + fdate(o.at) + '</td><td>' + esc(o.ticket) + '</td><td class="l">' + (o.magic || 0) + (lb ? '<small>' + lb + '</small>' : '') + '</td><td class="l">' + esc(o.symbol || '—') + '</td><td class="l">' + esc(o.kind) + '</td>' +
            '<td class="l">' + ({ in: 'ouverture', out: 'clôture', inout: 'retournement', out_by: 'clôture croisée' }[o.entry] || '') + '</td><td>' + (o.volume ? num(o.volume) : '') + '</td><td>' + (o.price ? esc(o.price) : '') + '</td>' +
            '<td class="' + tone(o.profit) + '">' + (o.profit ? signed(o.profit, c) : '') + '</td><td>' + (o.swap ? signed(o.swap, c) : '') + '</td><td>' + (o.commission || o.fee ? signed((o.commission || 0) + (o.fee || 0), c) : '') + '</td><td class="' + tone(n) + '"><b>' + (n ? signed(n, c) : '') + '</b></td></tr>'; }).join('') + '</tbody></table></div>';
    }
    $('adOps').innerHTML = h;
  }
  function exportCsv() {
    const cols = ['machine_id', 'at', 'ticket', 'magic', 'symbol', 'kind', 'entry', 'volume', 'price', 'profit', 'swap', 'commission', 'fee', 'position_id', 'order_id', 'comment'];
    const q = (v) => { const s = v == null ? '' : String(v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const text = '﻿' + cols.join(';') + '\n' + filteredOps().map((o) => cols.map((c) => q(o[c])).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = 'forexia-operations-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function render() { if (view === 'ops') renderOps(); else renderOverview(); }

  // ---------- données ----------
  async function refresh(full) {
    $('adLive').classList.add('busy');
    try {
      [machines, acts] = await Promise.all([C.listMachines(), C.listActivations()]);
      const needSnaps = full || Date.now() - snapAt > 5 * 60e3;
      await Promise.all(machines.map(async (m) => {
        // opérations : tout la première fois, ensuite seulement les nouvelles (fusion par ticket)
        const since = lastAt[m.id] ? new Date(new Date(lastAt[m.id]).getTime() - 86400e3).toISOString() : null;
        const L = await C.listOps(m.id, since);
        const map = ops[m.id] || (ops[m.id] = new Map());
        L.forEach((o) => { map.set(o.ticket, o); if (!lastAt[m.id] || o.at > lastAt[m.id]) lastAt[m.id] = o.at; });
        if (needSnaps) snaps[m.id] = await C.listSnaps(m.id, new Date(Date.now() - SNAP_DAYS * 86400e3).toISOString());
      }));
      if (needSnaps) snapAt = Date.now();
      $('adLive').classList.remove('err'); $('adLive').title = 'Actualisé à ' + new Date().toLocaleTimeString('fr-FR') + ' (toutes les ' + REFRESH_S + ' s)';
      if (!document.querySelector('#adOps input:focus, #adOverview input:focus') && $('adLink').hidden) render();
    } catch (e) {
      if (e.code === 'auth') { stop(); show('login'); return; }
      $('adLive').classList.add('err'); $('adLive').title = e.message;
      if (!machines.length) $('adOverview').innerHTML = '<div class="cl-empty"><b>Données indisponibles.</b><br>' + esc(e.message) + '</div>';
      else toast(e.message);
    } finally { $('adLive').classList.remove('busy'); }
  }
  function stop() { clearInterval(timer); timer = null; }
  async function start() {
    if (!C.session) return show('login');
    $('adName').textContent = C.user ? C.user.name : '';
    show(view);
    $('adOverview').innerHTML = '<div class="cl-empty">Chargement…</div>';
    await refresh(true);
    C.listPlans().then((p) => { plans = p; }).catch(() => {});
    stop(); timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_S * 1000);
  }

  // ---------- rattachement ----------
  function openLink(mid, magic) {
    const a = magic ? actOf(mid, magic) : null;
    linking = { mid, id: a && a.id };
    const opt = plans.map((p) => '<option value="' + esc(p.fxId) + '"' + (a && a.plan_id === p.fxId ? ' selected' : '') + '>' + esc(p.title) + '</option>').join('');
    $('adLinkBody').innerHTML = '<p class="cl-hint">Indiquez à quel plan correspond un EA en cours dans MT5. Son numéro magique est le paramètre <b>InpMagic</b> de l\'EA.</p>' +
      '<label class="cl-field">Numéro magique<input id="adLMagic" type="number" min="1" step="1" value="' + esc(magic || '') + '"' + (magic ? ' readonly' : '') + ' required></label>' +
      '<label class="cl-field">Plan<select id="adLPlan"><option value="">— aucun plan publié —</option>' + opt + '</select></label>' +
      '<label class="cl-field">Nom affiché<input id="adLLabel" maxlength="120" value="' + esc(a ? a.label || '' : '') + '" placeholder="ex. Plan équilibré EURUSD"></label>' +
      '<label class="cl-field">Capital alloué à ce plan<input id="adLCap" type="number" min="0" step="any" value="' + esc(a && a.capital != null ? a.capital : '') + '" placeholder="ex. 1000"></label>' +
      '<p class="cl-hint">Le capital sert à exprimer le résultat en % (et plus tard à la barre de progression du client).</p>';
    $('adLinkErr').textContent = ''; $('adLinkDel').hidden = !a; $('adLink').hidden = false;
    $(magic ? 'adLPlan' : 'adLMagic').focus();
  }
  $('adLink').addEventListener('change', (ev) => {
    if (ev.target.id !== 'adLPlan') return;
    const p = plans.find((x) => x.fxId === ev.target.value), l = $('adLLabel'), c = $('adLCap');
    if (p && !l.value) l.value = p.title;
    if (p && !c.value) c.value = p.minCapital;
  });
  $('adLinkOk').addEventListener('click', async () => {
    const magic = Number($('adLMagic').value), cap = $('adLCap').value === '' ? null : Number($('adLCap').value);
    if (!(magic >= 1) || Math.round(magic) !== magic) { $('adLinkErr').textContent = 'Numéro magique : un entier positif.'; return; }
    const ex = actOf(linking.mid, magic);
    const row = { machine_id: linking.mid, magic, plan_id: $('adLPlan').value || null, label: $('adLLabel').value.trim() || null, capital: cap };
    if (ex) row.id = ex.id;
    $('adLinkOk').disabled = true;
    try { await C.putActivation(row); $('adLink').hidden = true; toast('Numéro magique ' + magic + ' rattaché.'); await refresh(); }
    catch (e) { $('adLinkErr').textContent = e.message; }
    finally { $('adLinkOk').disabled = false; }
  });
  $('adLinkDel').addEventListener('click', async () => {
    if (!linking || !linking.id) return;
    try { await C.deleteActivation(linking.id); $('adLink').hidden = true; toast('Détaché.'); await refresh(); } catch (e) { $('adLinkErr').textContent = e.message; }
  });
  $('adLink').addEventListener('click', (ev) => { if (ev.target.closest('[data-close]')) $('adLink').hidden = true; });

  // ---------- évènements ----------
  $('adForm').addEventListener('submit', async (ev) => {
    ev.preventDefault(); $('adErr').textContent = ''; $('adSubmit').disabled = true;
    try { await C.signIn($('adLoginId').value, $('adPw').value); $('adPw').value = ''; await start(); }
    catch (e) { $('adErr').textContent = e.message; }
    finally { $('adSubmit').disabled = false; }
  });
  $('adOut').addEventListener('click', async () => { stop(); await C.signOut(); machines = []; show('login'); });
  document.querySelectorAll('.cl-tab').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; show(view); render(); }));
  $('adOverview').addEventListener('submit', async (ev) => {
    if (ev.target.id !== 'adClaim') return;
    ev.preventDefault();
    const btn = ev.target.querySelector('button'); btn.disabled = true;
    try { await C.claimMachine($('adCode').value); toast('Machine reliée.'); $('adCode').value = ''; await refresh(true); }
    catch (e) { toast(e.code === 'schema' ? e.message : /claim_machine/.test(e.message) ? 'Base en ligne pas à jour : exécutez à nouveau supabase/schema.sql dans Supabase (SQL Editor).' : e.message); }
    finally { btn.disabled = false; }
  });
  $('adOverview').addEventListener('click', async (ev) => {
    const t = ev.target;
    const l = t.closest('[data-link]'); if (l) { const [mid, k] = l.dataset.link.split('|'); return openLink(mid, Number(k)); }
    const n = t.closest('[data-link-new]'); if (n) return openLink(n.dataset.linkNew, null);
    const r = t.closest('[data-rename]');
    if (r) {
      const m = machines.find((x) => x.id === r.dataset.rename), name = prompt('Nom de la machine', (m && m.name) || '');
      if (name == null || !name.trim()) return;
      try { await C.renameMachine(r.dataset.rename, name.trim().slice(0, 80)); await refresh(); } catch (e) { toast(e.message); }
      return;
    }
    const f = t.closest('[data-forget]');
    if (f) {
      const m = machines.find((x) => x.id === f.dataset.forget);
      if (!confirm('Retirer « ' + ((m && m.name) || f.dataset.forget) + ' » ?\nSes opérations relevées seront effacées de Forexia (MT5 n\'est pas touché). L\'agent de ce PC devra être reconfiguré (--setup).')) return;
      try { await C.deleteMachine(f.dataset.forget); delete ops[f.dataset.forget]; delete lastAt[f.dataset.forget]; toast('Machine retirée.'); await refresh(true); } catch (e) { toast(e.message); }
    }
  });
  $('adOps').addEventListener('change', (ev) => { const k = ev.target.dataset.of; if (!k || k === 'q') return; opsF[k] = ev.target.value; if (k === 'machine') opsF.magic = ''; renderOps(); });
  $('adOps').addEventListener('input', (ev) => {
    if (ev.target.dataset.of !== 'q') return;
    opsF.q = ev.target.value; clearTimeout(renderOps.t);
    renderOps.t = setTimeout(() => { const pos = ev.target.selectionStart; renderOps(); const i = document.querySelector('#adOps [data-of="q"]'); i.focus(); i.setSelectionRange(pos, pos); }, 250);
  });
  $('adOps').addEventListener('click', (ev) => { if (ev.target.id === 'adCsv') exportCsv(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('adLink').hidden) $('adLink').hidden = true; });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && timer) refresh(); });

  start();
})();
