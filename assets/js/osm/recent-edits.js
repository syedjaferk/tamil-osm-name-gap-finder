// Overpass lags a few minutes behind OSM, so remember what we just fixed and hide it from scans.
import { load, save } from '../lib/storage.js';

const EDITED_TTL = 3600e3;   // ms

/** { "node/123": timestamp } for edits in the last hour. */
export function recentEdits() {
  const now = Date.now(), all = load(localStorage, 'tngf_edited', {});
  for (const k of Object.keys(all)) if (now - all[k] > EDITED_TTL) delete all[k];
  return all;
}

export function markEdited(osmType, osmId) {
  const all = recentEdits();
  all[`${osmType}/${osmId}`] = Date.now();
  save(localStorage, 'tngf_edited', all);
}
