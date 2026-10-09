// Login / logout in the header, and the changeset status in the bar under it.
import { $, esc } from '../lib/dom.js';
import { login, logout } from '../osm/auth.js';
import { closeChangeset } from '../osm/edits.js';
import { OSM_URL } from '../osm/http.js';
import { me } from '../osm/session.js';

let onLoginChange = () => {};

/** `onChange` runs after logout so other parts of the page can re-render. */
export function initAuthBar(onChange) {
  onLoginChange = onChange;
  // Any element with [data-login] (header, popups, "Why" dialog) starts the OSM login.
  document.addEventListener('click', async e => {
    const btn = e.target.closest('[data-login]');
    if (!btn) return;
    btn.disabled = true;
    try { await login(); } catch (ex) { alert(ex.message); btn.disabled = false; }
  });
}

export function renderAuthBar() {
  const m = me(), a = $('auth'), s = $('session');
  const dry = m.dry_run ? '<b class="warn">DRY RUN</b>' : '';
  if (!m.configured) {
    a.innerHTML = '<span class="warn">Editing disabled: set CLIENT_ID in assets/js/config.js (see README)</span>';
    s.innerHTML = dry;
    return;
  }
  if (!m.logged_in) {
    a.innerHTML = '<button data-login>Log in with OpenStreetMap</button>';
    s.innerHTML = dry;
    return;
  }
  a.innerHTML = `<span>வணக்கம், <b>${esc(m.user.display_name)}</b></span>
    <button class="ghost" id="logout">Log out</button>`;
  const cs = m.changeset_id
    ? `Changeset <a href="${OSM_URL}/changeset/${m.changeset_id}" target="_blank" rel="noopener">#${m.changeset_id}</a> open`
    : 'No open changeset';
  s.innerHTML = `${dry ? dry + ' · ' : ''}${cs} · <b>${m.edits}</b> name${m.edits === 1 ? '' : 's'} added
    ${m.changeset_id ? '<button class="ghost" id="finish">Finish &amp; close changeset</button>' : ''}`;
  $('logout').onclick = async e => {
    e.target.disabled = true;
    await logout();
    onLoginChange();
  };
  const f = $('finish');
  if (f) f.onclick = async () => {
    f.disabled = true;
    try { await closeChangeset(); } catch (ex) { alert(ex.message); }
    renderAuthBar();
  };
}
