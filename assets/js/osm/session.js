// Login state and dry-run mode, kept in browser storage.
import { CONFIG } from '../config.js';
import { load, save } from '../lib/storage.js';

let sess = load(localStorage, 'tngf_session', null);   // { token, user, changeset_id, edits }
let dryRun = load(sessionStorage, 'tngf_dry', CONFIG.DRY_RUN);

export const getSession = () => sess;

export function setSession(value) {
  sess = value;
  save(localStorage, 'tngf_session', sess);
}

export const updateSession = patch => setSession({ ...sess, ...patch });

export const isDryRun = () => dryRun;

/** Dry run is per browser tab, so ?dry=1 survives the OAuth redirect but not a new tab. */
export function setDryRun(on) {
  dryRun = on;
  save(sessionStorage, 'tngf_dry', on);
}

export function me() {
  const loggedIn = !!sess?.token;
  return {
    configured: !!CONFIG.CLIENT_ID,
    dry_run: dryRun,
    logged_in: loggedIn,
    user: loggedIn ? sess.user : null,
    changeset_id: loggedIn ? sess.changeset_id : null,
    edits: loggedIn ? sess.edits : 0,
  };
}
