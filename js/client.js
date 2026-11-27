/* Forexia — page client : connexion, plans mis en avant, portefeuille.
 * Les plans viennent du compte en ligne (table « plans », remplie par « ⭐ Mettre en avant » dans Forexia).
 * client.html?apercu : aperçu sans connexion, à partir des FX mis en avant dans ce navigateur (rien n'est enregistré).
 * Le portefeuille est pour l'instant gardé dans ce navigateur (le back office viendra ensuite). */
(function () {
  'use strict';
  const F = window.Forexia, C = F.cloud, PV = F.planview, $ = (id) => document.getElementById(id);
  const PREVIEW = /[?&]apercu\b/.test(location.search);
  const FOLIO_KEY = 'forexia.client.portfolio';
  let plans = [], view = 'plans', authMode = 'signin', choosing = null;
  const amounts = {}; // montant saisi par plan

  const folio = () => { try { return JSON.parse(localStorage.getItem(FOLIO_KEY)) || []; } catch (e) { return []; } };
  const setFolio = (l) => { try { localStorage.setItem(FOLIO_KEY, JSON.stringify(l)); } catch (e) { /* ignoré */ } updateCount(); };
  function toast(msg) { const t = $('clToast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3500); }
  function updateCount() { $('clCount').textContent = PREVIEW ? 0 : folio().length; }

  // ---------- écrans ----------
  function show(which) {
    $('clLogin').hidden = which !== 'login';
    $('clPlans').hidden = which !== 'plans';
    $('clFolio').hidden = which !== 'folio';
    $('clNav').hidden = which === 'login';
    document.querySelectorAll('.cl-tab').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === which)));
  }
  function renderPlans() {
    const chosen = new Set(folio().map((x) => x.planId));
    $('clGrid').innerHTML = plans.length ? plans.map((p) => PV.cardHtml(p, amounts[p.fxId] || p.minCapital, { chosen: !PREVIEW && chosen.has(p.fxId), preview: PREVIEW })).join('')
      : '<div class="cl-empty"><b>Aucun plan disponible pour le moment.</b><br>' + (PREVIEW ? 'Dans Forexia, ouvrez « 💼 FX » et cliquez « ⭐ Mettre en avant » sur un FX.' : 'Revenez bientôt : de nouveaux plans seront proposés.') + '</div>';
  }
  function renderFolio() {
    const L = folio(), byId = new Map(plans.map((p) => [p.fxId, p]));
    if (!L.length) { $('clFolio').innerHTML = '<div class="cl-intro"><h1>Mon portefeuille</h1></div><div class="cl-empty"><b>Votre portefeuille est vide.</b><br>Choisissez un plan dans « Plans disponibles ».</div>'; return; }
    let tot = 0, totEnd = 0, totY1 = 0;
    const rows = L.map((x) => {
      const p = byId.get(x.planId) || x.plan, end = p.withWithdrawal ? p.withWithdrawal.total : p.withoutWithdrawal ? p.withoutWithdrawal.usual : 100;
      tot += x.amount; totEnd += (x.amount * end) / 100; totY1 += (x.amount * p.oneYear.usual) / 100;
      return '<tr><td class="l"><b>' + PV.esc(p.title) + '</b><small>ajouté le ' + new Date(x.at).toLocaleDateString('fr-FR') + (byId.has(x.planId) ? '' : ' · plan retiré de l\'offre') + '</small></td>' +
        '<td>' + PV.money.format(x.amount) + '</td><td>' + PV.months(p.recoMonths) + '</td><td>' + PV.eur(x.amount, p.oneYear.usual) + '</td><td>' + PV.eur(x.amount, end) + '</td>' +
        '<td><span class="pv-badge r' + p.risk.note + '">' + p.risk.note + '/7</span></td><td><button type="button" class="cl-ghost small" data-remove="' + PV.esc(x.id) + '" aria-label="Retirer">Retirer</button></td></tr>';
    }).join('');
    $('clFolio').innerHTML = '<div class="cl-intro"><h1>Mon portefeuille</h1><p>Les plans que vous avez choisis. L\'activation (versement, démarrage du robot) sera proposée prochainement.</p></div>' +
      '<div class="cl-sum"><div><span>Montant total</span><b>' + PV.money.format(tot) + '</b></div><div><span>Au bout d\'un an</span><b>' + PV.money.format(totY1) + '</b><small>le plus souvent</small></div><div><span>À la fin des périodes recommandées</span><b>' + PV.money.format(totEnd) + '</b><small>le plus souvent, retraits compris</small></div><div><span>Plans</span><b>' + L.length + '</b></div></div>' +
      '<div class="cl-table-wrap"><table class="cl-table"><thead><tr><th class="l">Plan</th><th>Montant</th><th>Période</th><th>Au bout d\'un an</th><th>À la fin</th><th>Risque</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="pv-legal">Estimations issues de simulations sur des périodes passées, sans garantie pour l\'avenir.</p>';
  }
  function go(v) { view = v; show(v); if (v === 'plans') renderPlans(); else renderFolio(); }

  // ---------- données ----------
  function previewPlans() {
    let fx = [];
    try { fx = JSON.parse(localStorage.getItem('forexia.fx')) || []; } catch (e) { /* ignoré */ }
    return fx.filter((x) => x.publicPlan && !x.archived).map((x) => x.publicPlan);
  }
  async function load() {
    if (PREVIEW) { plans = previewPlans(); return go('plans'); }
    if (!C.session) return show('login');
    $('clUser').hidden = false; $('clName').textContent = C.user ? C.user.name : '';
    $('clGrid').innerHTML = '<div class="cl-empty">Chargement des plans…</div>'; show('plans');
    try { plans = await C.listPlans(); }
    catch (e) {
      if (e.code === 'auth') { $('clUser').hidden = true; return show('login'); }
      plans = [];
      $('clGrid').innerHTML = '<div class="cl-empty"><b>Plans indisponibles.</b><br>' + PV.esc(e.message) + '</div>';
      return;
    }
    go(view);
  }

  // ---------- connexion ----------
  $('clSwitch').addEventListener('click', () => {
    authMode = authMode === 'signin' ? 'signup' : 'signin';
    $('clSubmit').textContent = authMode === 'signup' ? 'Créer mon compte' : 'Se connecter';
    $('clSwitchTxt').textContent = authMode === 'signup' ? 'Déjà un compte ?' : 'Pas encore de compte ?';
    $('clSwitch').textContent = authMode === 'signup' ? 'Se connecter' : 'Créer un compte';
    $('clPw').autocomplete = authMode === 'signup' ? 'new-password' : 'current-password';
    $('clErr').textContent = '';
  });
  $('clForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('clErr').textContent = ''; $('clSubmit').disabled = true;
    try { if (authMode === 'signup') await C.signUp($('clLoginId').value, $('clPw').value); else await C.signIn($('clLoginId').value, $('clPw').value); $('clPw').value = ''; await load(); }
    catch (e) { $('clErr').textContent = e.message; }
    finally { $('clSubmit').disabled = false; }
  });
  $('clOut').addEventListener('click', async () => { await C.signOut(); $('clUser').hidden = true; plans = []; show('login'); });

  // ---------- plans et portefeuille ----------
  document.querySelectorAll('.cl-tab').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
  $('clGrid').addEventListener('change', (ev) => {
    const id = ev.target.dataset && ev.target.dataset.pvAmount;
    if (!id) return;
    const p = plans.find((x) => x.fxId === id), v = Number(ev.target.value);
    if (!p) return;
    if (!(v >= p.minCapital)) { toast('Montant minimum : ' + PV.money.format(p.minCapital) + '.'); amounts[id] = p.minCapital; }
    else amounts[id] = Math.round(v);
    const y = ev.target.closest('.pv-card').getBoundingClientRect().top;
    renderPlans();
    const c = $('clGrid').querySelector('[data-plan="' + CSS.escape(id) + '"]'); if (c) window.scrollBy(0, c.getBoundingClientRect().top - y);
  });
  $('clGrid').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-pv-choose]');
    if (!b) return;
    const p = plans.find((x) => x.fxId === b.dataset.pvChoose);
    if (!p) return;
    if (PREVIEW) return toast('Aperçu : le client verra ici la confirmation du choix.');
    choosing = p;
    const A = amounts[p.fxId] || p.minCapital;
    $('clChooseBody').innerHTML = '<p><b>' + PV.esc(p.title) + '</b></p><label class="cl-field">Montant à investir<span class="pv-input"><input type="number" id="clChooseAmt" min="' + p.minCapital + '" value="' + A + '"><b>€</b></span></label>' +
      '<p class="cl-hint">Minimum ' + PV.money.format(p.minCapital) + ' · période recommandée ' + PV.months(p.recoMonths) + ' · risque ' + p.risk.note + '/7. Vous pourrez retirer ce plan de votre portefeuille tant qu\'il n\'est pas activé.</p>';
    $('clChoose').hidden = false; $('clChooseAmt').focus();
  });
  $('clChooseOk').addEventListener('click', () => {
    const p = choosing, v = Number($('clChooseAmt').value);
    if (!p) return;
    if (!(v >= p.minCapital)) { toast('Montant minimum : ' + PV.money.format(p.minCapital) + '.'); return; }
    setFolio(folio().concat({ id: 'c' + Date.now().toString(36), planId: p.fxId, amount: Math.round(v), at: new Date().toISOString(), plan: p }));
    $('clChoose').hidden = true; choosing = null;
    toast('« ' + p.title + ' » ajouté à votre portefeuille.');
    renderPlans();
  });
  $('clChoose').addEventListener('click', (ev) => { if (ev.target.closest('[data-close]')) { $('clChoose').hidden = true; choosing = null; } });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('clChoose').hidden) { $('clChoose').hidden = true; choosing = null; } });
  $('clFolio').addEventListener('click', (ev) => {
    const r = ev.target.closest('[data-remove]');
    if (!r) return;
    setFolio(folio().filter((x) => x.id !== r.dataset.remove)); renderFolio();
  });

  if (PREVIEW) { $('clPreview').hidden = false; window.addEventListener('storage', (e) => { if (e.key === 'forexia.fx') { plans = previewPlans(); if (view === 'plans') renderPlans(); } }); }
  updateCount();
  load();
})();
