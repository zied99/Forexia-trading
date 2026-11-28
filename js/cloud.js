/* Forexia — comptes et données en ligne (Supabase).
 *
 * Authentification par identifiant / mot de passe (API Auth de Supabase) et stockage des
 * stratégies, simulations, journal et préférences (API REST, protégée par les règles de
 * sécurité de la base : chaque compte ne voit que ses propres lignes, voir supabase/schema.sql).
 * La clé utilisée est la clé publique du projet : elle est faite pour être dans la page. */
(function (root) {
  'use strict';

  const CONFIG = {
    url: 'https://bzrvzulyxkmozvxaedek.supabase.co',
    key: 'sb_publishable_69_wCXvwU1cVFerYyS-s0A_CDQ2Yt9C',
    loginDomain: 'forexia.app', // « zied » -> zied@forexia.app (Supabase exige une adresse e-mail)
  };
  const SESSION_KEY = 'forexia.session';

  class CloudError extends Error {
    constructor(message, code) { super(message); this.code = code; }
  }

  function loginToEmail(login) {
    const l = String(login || '').trim().toLowerCase();
    if (!l) throw new CloudError('Saisissez votre identifiant.');
    if (l.includes('@')) return l;
    if (!/^[a-z0-9._-]{2,40}$/.test(l)) throw new CloudError('Identifiant : lettres, chiffres, point, tiret (2 à 40 caractères).');
    return l + '@' + CONFIG.loginDomain;
  }
  function displayName(email) {
    const e = String(email || '');
    return e.endsWith('@' + CONFIG.loginDomain) ? e.slice(0, -CONFIG.loginDomain.length - 1) : e;
  }

  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { session = null; }
  function saveSession(s) {
    session = s;
    try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignoré */ }
  }

  const fetchFn = (...a) => (root.Forexia.cloudFetch || fetch)(...a); // remplaçable pour les tests

  function authMessage(status, body) {
    const msg = (body && (body.msg || body.message || body.error_description || body.error)) || '';
    const code = body && (body.error_code || body.code);
    if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'Identifiant ou mot de passe incorrect.';
    if (code === 'user_already_exists' || /already registered/i.test(msg)) return 'Ce compte existe déjà : utilisez « Se connecter ».';
    if (code === 'weak_password' || /password should be at least/i.test(msg)) return 'Mot de passe trop court (6 caractères minimum).';
    if (code === 'email_not_confirmed' || /not confirmed/i.test(msg)) return 'Compte non confirmé : dans Supabase, désactivez « Confirm email » (Authentication → Sign In / Providers).';
    if (code === 'signup_disabled' || /signups not allowed/i.test(msg)) return 'La création de comptes est désactivée dans Supabase.';
    if (code === 'over_email_send_rate_limit' || /email rate limit/i.test(msg) || code === 'email_address_not_authorized' || /not authorized/i.test(msg)) {
      return 'Supabase essaie d\'envoyer un e-mail de confirmation et le refuse. Dans Supabase : Authentication → Sign In / Providers → Email, désactivez « Confirm email », enregistrez, puis réessayez.';
    }
    if (status === 429) return 'Supabase limite les tentatives (' + (code || 'trop de requêtes') + '). Si « Confirm email » est encore activé dans Supabase, désactivez-le (Authentication → Sign In / Providers → Email), puis réessayez dans une minute.';
    return msg || 'Erreur de connexion (' + status + ').';
  }

  async function authRequest(path, body, token) {
    const headers = { apikey: CONFIG.key, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try { res = await fetchFn(CONFIG.url + '/auth/v1/' + path, { method: 'POST', headers: headers, body: JSON.stringify(body || {}) }); }
    catch (e) { throw new CloudError('Service en ligne injoignable : vérifiez votre connexion Internet.', 'network'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new CloudError(authMessage(res.status, data), data.error_code || res.status);
    return data;
  }
  function keepSession(data) {
    if (!data.access_token) return null;
    saveSession({
      access_token: data.access_token, refresh_token: data.refresh_token,
      expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user: { id: data.user && data.user.id, email: data.user && data.user.email },
    });
    return session;
  }

  async function signIn(login, password) {
    return keepSession(await authRequest('token?grant_type=password', { email: loginToEmail(login), password: password }));
  }
  async function signUp(login, password) {
    const data = await authRequest('signup', { email: loginToEmail(login), password: password });
    if (data.access_token) return keepSession(data);
    // Confirmation par e-mail activée : pas de session tout de suite.
    throw new CloudError('Compte créé, mais Supabase attend une confirmation par e-mail : désactivez « Confirm email » (Authentication → Sign In / Providers) puis connectez-vous.', 'confirm');
  }
  async function signOut() {
    const s = session;
    saveSession(null);
    if (s) await authRequest('logout', {}, s.access_token).catch(() => {});
  }
  async function freshToken() {
    if (!session) throw new CloudError('Non connecté.', 'auth');
    if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
    try {
      keepSession(await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token }));
      return session.access_token;
    } catch (e) {
      if (e.code !== 'network') { saveSession(null); throw new CloudError('Session expirée : reconnectez-vous.', 'auth'); }
      throw e;
    }
  }

  // ---------- API REST (PostgREST) ----------
  async function rest(method, path, body, prefer) {
    const token = await freshToken();
    const headers = { apikey: CONFIG.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    if (prefer) headers.Prefer = prefer;
    let res;
    try { res = await fetchFn(CONFIG.url + '/rest/v1/' + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (e) { throw new CloudError('Service en ligne injoignable.', 'network'); }
    if (res.status === 401) { saveSession(null); throw new CloudError('Session expirée : reconnectez-vous.', 'auth'); }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const missing = data && (data.code === 'PGRST205' || data.code === '42P01' || /does not exist|could not find the table/i.test(data.message || ''));
      throw new CloudError(missing ? 'Base en ligne pas encore créée : exécutez le script supabase/schema.sql dans Supabase (SQL Editor).' : (data && data.message) || 'Erreur ' + res.status,
        missing ? 'schema' : res.status);
    }
    return data;
  }
  const enc = encodeURIComponent;
  const now = () => new Date().toISOString();

  const api = {
    async listStrategies() { return (await rest('GET', 'strategies?select=name,data,updated_at&order=name')).map((r) => r.data); },
    async putStrategy(s) {
      await rest('POST', 'strategies?on_conflict=user_id,name', [{ name: s.name, data: s, updated_at: s.savedAt || now() }], 'resolution=merge-duplicates,return=minimal');
    },
    async deleteStrategy(name) { await rest('DELETE', 'strategies?name=eq.' + enc(name), undefined, 'return=minimal'); },
    async listSimulations() {
      const rows = await rest('GET', 'simulations?select=data&order=at.asc&limit=10000');
      return rows.map((r) => r.data);
    },
    async putSimulations(items) {
      for (let i = 0; i < items.length; i += 200) {
        // sans la liste des trades (gardée dans la base de la passerelle) : beaucoup moins d'écritures disque
        const part = items.slice(i, i + 200).map((e) => { const d = Object.assign({}, e); delete d.tradeList; return { key: e.key, at: e.at, name: e.name, pair: e.pair, data: d }; });
        await rest('POST', 'simulations?on_conflict=user_id,key', part, 'resolution=merge-duplicates,return=minimal');
      }
    },
    async deleteSimulation(key) { await rest('DELETE', 'simulations?key=eq.' + enc(key), undefined, 'return=minimal'); },
    async clearSimulations() { await rest('DELETE', 'simulations?key=not.is.null', undefined, 'return=minimal'); },
    async addEvent(type, summary, data) { await rest('POST', 'events', [{ type: type, summary: String(summary || '').slice(0, 500), data: data === undefined ? null : data }], 'return=minimal'); },
    async listEvents(limit) { return rest('GET', 'events?select=at,type,summary,data&order=id.desc&limit=' + (limit || 300)); },
    async getSettings() { const r = await rest('GET', 'settings?select=data'); return r.length ? r[0].data : {}; },
    async putSettings(data) { await rest('POST', 'settings?on_conflict=user_id', [{ data: data, updated_at: now() }], 'resolution=merge-duplicates,return=minimal'); },
    // plans publiés pour la page client
    async listPlans() { return (await rest('GET', 'plans?select=id,data,updated_at&published=eq.true&order=updated_at.desc')).map((r) => r.data); },
    async putPlan(p) { await rest('POST', 'plans?on_conflict=id', [{ id: p.fxId, data: p, published: true, updated_at: now() }], 'resolution=merge-duplicates,return=minimal'); },
    async deletePlan(id) { await rest('DELETE', 'plans?id=eq.' + enc(id), undefined, 'return=minimal'); },
    // trading réel : machines (agent Windows), opérations MT5, photos du compte, plans rattachés
    async listMachines() {
      const uid = session && session.user && session.user.id;
      return rest('GET', 'machines?select=id,name,info,positions,seen_at,created_at&order=created_at.asc' + (uid ? '&owner=eq.' + enc(uid) : ''));
    },
    async claimMachine(code) { return rest('POST', 'rpc/claim_machine', { code: String(code || '') }); },
    async renameMachine(id, name) { await rest('PATCH', 'machines?id=eq.' + enc(id), { name: name }, 'return=minimal'); },
    async deleteMachine(id) { await rest('DELETE', 'machines?id=eq.' + enc(id), undefined, 'return=minimal'); },
    async listOps(machineId, sinceIso) {
      const out = [];
      for (let off = 0; ; off += 5000) {
        const part = await rest('GET', 'trade_ops?select=*&machine_id=eq.' + enc(machineId) + (sinceIso ? '&at=gte.' + enc(sinceIso) : '') + '&order=at.asc,ticket.asc&limit=5000&offset=' + off);
        out.push(...part);
        if (part.length < 5000) return out;
      }
    },
    async listSnaps(machineId, sinceIso) {
      return rest('GET', 'trade_snaps?select=at,data&machine_id=eq.' + enc(machineId) + '&at=gte.' + enc(sinceIso) + '&order=at.asc&limit=5000');
    },
    async listActivations() { return rest('GET', 'activations?select=*&order=started_at.asc'); },
    async putActivation(a) {
      const row = Object.assign({}, a); delete row.owner;
      return (await rest('POST', 'activations?on_conflict=machine_id,magic', [row], 'resolution=merge-duplicates,return=representation'))[0];
    },
    async deleteActivation(id) { await rest('DELETE', 'activations?id=eq.' + enc(id), undefined, 'return=minimal'); },
    async counts() {
      const one = async (t) => {
        const token = await freshToken();
        const res = await fetchFn(CONFIG.url + '/rest/v1/' + t + '?select=user_id&limit=1', { method: 'HEAD', headers: { apikey: CONFIG.key, Authorization: 'Bearer ' + token, Prefer: 'count=exact' } });
        const range = res.headers.get('content-range') || '';
        return Number(range.split('/')[1]) || 0;
      };
      return { strategies: await one('strategies'), simulations: await one('simulations'), events: await one('events') };
    },
  };

  root.Forexia = root.Forexia || {};
  root.Forexia.cloud = Object.assign({
    CONFIG, CloudError, signIn, signUp, signOut, loginToEmail, displayName,
    get session() { return session; },
    get user() { return session && session.user ? { id: session.user.id, email: session.user.email, name: displayName(session.user.email) } : null; },
  }, api);
})(typeof window !== 'undefined' ? window : globalThis);
