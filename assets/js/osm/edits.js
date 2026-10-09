// Add name:ta to an OSM element through API 0.6, one changeset per login.
import { TAMIL } from '../lib/dom.js';
import { api, OSM_URL } from './http.js';
import { markEdited } from './recent-edits.js';
import { getSession, isDryRun, updateSession } from './session.js';

const APP_VERSION = '0.3.0';
const CHANGESET_TAGS = {
  created_by: `Tamil Name Gap Finder ${APP_VERSION}`,
  comment: 'Add Tamil names (name:ta)',
  hashtags: '#TamilNameGap',
  source: 'local knowledge',
};

function cleanTamilName(raw) {
  const name = String(raw).split(/\s+/).filter(Boolean).join(' ');
  if (!name || name.length > 255) throw new Error('Name must be 1–255 characters.');
  if (!TAMIL.test(name)) throw new Error('name:ta should be written in Tamil script (தமிழ்).');
  return name;
}

function changesetXml() {
  const doc = document.implementation.createDocument(null, 'osm');
  const cs = doc.documentElement.appendChild(doc.createElement('changeset'));
  for (const [k, v] of Object.entries(CHANGESET_TAGS)) {
    const tag = cs.appendChild(doc.createElement('tag'));
    tag.setAttribute('k', k);
    tag.setAttribute('v', v);
  }
  return new XMLSerializer().serializeToString(doc);
}

/** Reuse one changeset per session so a mapping session is one tidy changeset. */
async function ensureChangeset() {
  const open = getSession().changeset_id;
  if (open) return open;
  const r = await api('PUT', '/changeset/create', changesetXml());
  const text = await r.text();
  if (!r.ok) throw new Error(`Could not open a changeset (${r.status}): ${text.slice(0, 200)}`);
  updateSession({ changeset_id: Number(text.trim()) });
  return getSession().changeset_id;
}

export async function addTamilName(osmType, osmId, raw) {
  if (!['node', 'way', 'relation'].includes(osmType) || !(osmId > 0)) throw new Error('Invalid OSM element.');
  const name = cleanTamilName(raw);
  const path = `/${osmType}/${osmId}`;

  // Fetch the current version (keeps a way's nodes and a relation's members intact).
  const cur = await api('GET', path);
  if (cur.status === 404 || cur.status === 410) throw new Error('This feature no longer exists in OSM.');
  if (!cur.ok) throw new Error(`OSM API error ${cur.status}`);
  const doc = new DOMParser().parseFromString(await cur.text(), 'application/xml');
  const el = doc.getElementsByTagName(osmType)[0];
  if (!el) throw new Error('Unexpected response from OSM API.');
  const existing = [...el.getElementsByTagName('tag')].find(t => t.getAttribute('k') === 'name:ta');
  if (existing) {
    markEdited(osmType, osmId);
    throw new Error(`Someone already added name:ta = ${existing.getAttribute('v')}`);
  }
  const tag = el.appendChild(doc.createElement('tag'));
  tag.setAttribute('k', 'name:ta');
  tag.setAttribute('v', name);

  if (isDryRun()) {
    el.setAttribute('changeset', '0');
    return { dry_run: true, xml: new XMLSerializer().serializeToString(doc) };
  }

  let put, text, csId;
  for (let attempt = 0; attempt < 2; attempt++) {
    csId = await ensureChangeset();
    el.setAttribute('changeset', csId);
    put = await api('PUT', path, new XMLSerializer().serializeToString(doc));
    text = await put.text();
    // Changeset auto-closed (idle > 1h or 10k edits) -> open a new one and retry once.
    if (put.status === 409 && /closed/i.test(text)) {
      updateSession({ changeset_id: null });
      continue;
    }
    break;
  }
  if (put.status === 409) throw new Error('Someone edited this feature just now. Re-scan and try again.');
  if (!put.ok) throw new Error(`OSM rejected the edit (${put.status}): ${text.slice(0, 200)}`);

  markEdited(osmType, osmId);
  updateSession({ edits: getSession().edits + 1 });
  return {
    version: Number(text.trim()),
    changeset_id: csId,
    changeset_url: `${OSM_URL}/changeset/${csId}`,
    edits: getSession().edits,
  };
}

export async function closeChangeset() {
  const csId = getSession()?.changeset_id;
  if (!csId) return { closed: null };
  const r = await api('PUT', `/changeset/${csId}/close`);
  updateSession({ changeset_id: null });
  if (!r.ok && r.status !== 409) throw new Error(`Could not close changeset (${r.status}).`);   // 409 = already closed
  return { closed: csId, changeset_url: `${OSM_URL}/changeset/${csId}` };
}
