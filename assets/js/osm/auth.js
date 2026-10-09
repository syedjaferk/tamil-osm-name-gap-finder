// OAuth 2 authorization-code flow with PKCE, for a public client (no client secret).
import { CONFIG } from '../config.js';
import { stripQueryParams } from '../lib/dom.js';
import { load, save } from '../lib/storage.js';
import { API_URL, OSM_URL, request } from './http.js';
import { getSession, setSession } from './session.js';

const SCOPES = 'read_prefs write_api';
const redirectUri = CONFIG.REDIRECT_URI || location.origin + location.pathname;

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const randomString = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function login() {
  if (!CONFIG.CLIENT_ID) throw new Error('CLIENT_ID is not set in assets/js/config.js (see README).');
  const state = randomString(16), verifier = randomString(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  save(sessionStorage, 'tngf_pkce', { state, verifier });
  location.assign(`${OSM_URL}/oauth2/authorize?` + new URLSearchParams({
    response_type: 'code',
    client_id: CONFIG.CLIENT_ID,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }));
}

/** Run once on page load: finishes an OAuth redirect back to this page (?code=&state=). */
export async function completeLogin() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code'), state = q.get('state'), error = q.get('error');
  if (!code && !error) return;
  stripQueryParams('code', 'state', 'error', 'error_description');

  const pkce = load(sessionStorage, 'tngf_pkce', null);
  save(sessionStorage, 'tngf_pkce', null);
  if (error) throw new Error(q.get('error_description') || error);
  if (!pkce || state !== pkce.state) throw new Error('Login session expired or invalid. Please try again.');

  const tok = await request(`${OSM_URL}/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: CONFIG.CLIENT_ID,
      code_verifier: pkce.verifier,
    }),
  });
  if (!tok.ok) throw new Error(`Token exchange failed (${tok.status}).`);
  const token = (await tok.json()).access_token;

  const r = await request(`${API_URL}/user/details.json`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Could not load your OSM profile (${r.status}).`);
  const { user } = await r.json();
  setSession({ token, user: { id: user.id, display_name: user.display_name }, changeset_id: null, edits: 0 });
}

export async function logout() {
  const old = getSession();
  setSession(null);
  if (!old?.token) return;
  try {   // best effort; OSM auto-closes idle changesets after an hour
    if (old.changeset_id) {
      await fetch(`${API_URL}/changeset/${old.changeset_id}/close`, {
        method: 'PUT', headers: { Authorization: `Bearer ${old.token}` },
      });
    }
    await fetch(`${OSM_URL}/oauth2/revoke`, {
      method: 'POST', body: new URLSearchParams({ token: old.token, client_id: CONFIG.CLIENT_ID }),
    });
  } catch {}
}
