// Gap markers on the map, their popups with the "add Tamil name" form, and the stats line.
import { $, esc, TAMIL } from '../lib/dom.js';
import { addTamilName } from '../osm/edits.js';
import { me } from '../osm/session.js';

const GAP_STYLE  = { radius: 7, color: '#c2410c', fillColor: '#fb923c', fillOpacity: .9, weight: 2 };
const DONE_STYLE = { radius: 7, color: '#15803d', fillColor: '#4ade80', fillOpacity: .9, weight: 2 };

/** `onSaved` runs after every successful (or dry-run) save. */
export function createGapLayer(map, { onSaved }) {
  const cluster = L.markerClusterGroup().addTo(map);
  const markers = new Map();   // "node/123" -> { marker, props, done }
  let stats = null, scope = 'view';

  function popupHtml(key) {
    const { props: p, done } = markers.get(key), m = me();
    const head = `<b>${esc(p.name)}</b>${p.name_en ? '<br>' + esc(p.name_en) : ''}<div class="cat">${esc(p.category)}</div>`;
    const links = `<div class="links"><a href="${p.view_url}" target="_blank" rel="noopener">View on OSM</a>
                   <a href="${p.edit_url}" target="_blank" rel="noopener">Open in iD</a></div>`;
    let body;
    if (done) {
      body = `<div class="msg ok">✓ name:ta = ${esc(done)}</div>`;
    } else if (m.logged_in) {
      body = `<form class="ta-form" data-key="${key}">
        <input name="name_ta" lang="ta" placeholder="தமிழ் பெயர் எழுதுங்கள்" autocomplete="off" required maxlength="255">
        <button>Save name:ta to OSM</button>
        <div class="msg"></div></form>`;
    } else {
      body = m.configured ? '<div class="msg"><button class="ghost" data-login>Log in</button> to add the Tamil name here.</div>' : '';
    }
    return `<div class="popup">${head}${body}${links}</div>`;
  }

  function renderStats() {
    const s = stats;
    const cov = s.named_total ? (100 * (s.named_total - s.missing_ta) / s.named_total).toFixed(1) : null;
    $('stats').innerHTML = s.named_total
      ? `<b>${s.missing_ta}</b> of <b>${s.named_total}</b> named features lack <code>name:ta</code> · Tamil coverage <b>${cov}%</b>${s.truncated ? ' (showing first ' + markers.size + ')' : ''}`
      : `No named features in this ${scope}.`;
  }

  document.addEventListener('submit', async e => {
    const form = e.target.closest('.ta-form');
    if (!form) return;
    e.preventDefault();
    const key = form.dataset.key, entry = markers.get(key);
    const input = form.name_ta, btn = form.querySelector('button'), msg = form.querySelector('.msg');
    const value = input.value.trim().replace(/\s+/g, ' ');
    msg.className = 'msg';
    if (!TAMIL.test(value)) { msg.className = 'msg err'; msg.textContent = 'Please type the name in Tamil script.'; return; }
    if (!confirm(`Save to OpenStreetMap?\n\n${entry.props.name}\nname:ta = ${value}`)) return;

    btn.disabled = true; msg.textContent = 'Saving…';
    try {
      const data = await addTamilName(entry.props.osm_type, entry.props.osm_id, value);
      if (data.dry_run) { console.log('DRY RUN payload:\n' + data.xml); }
      entry.done = value;
      entry.marker.setStyle(DONE_STYLE);
      entry.marker.setPopupContent(popupHtml(key));
      if (stats && !data.dry_run) { stats.missing_ta--; renderStats(); }
      onSaved();
    } catch (ex) {
      msg.className = 'msg err'; msg.textContent = ex.message;
      btn.disabled = false;
      onSaved();   // e.g. the login expired
    }
  });

  return {
    /** Replace the markers with a scan result; `where` is 'view' or 'area'. */
    show(data, where) {
      cluster.clearLayers(); markers.clear();
      for (const f of data.features) {
        const p = f.properties, key = `${p.osm_type}/${p.osm_id}`;
        const [lon, lat] = f.geometry.coordinates;
        const marker = L.circleMarker([lat, lon], GAP_STYLE);
        markers.set(key, { marker, props: p, done: null });
        marker.bindPopup(() => popupHtml(key));
        marker.on('popupopen', () => { const i = document.querySelector('.ta-form input'); if (i) i.focus(); });
        cluster.addLayer(marker);
      }
      stats = data.stats; scope = where;
      renderStats();
    },
    // Markers would swallow clicks while an area is being drawn.
    hide: () => map.removeLayer(cluster),
    unhide: () => map.addLayer(cluster),
    /** Popups are rendered once; re-render them when the login state changes. */
    refreshPopups() {
      for (const [key, { marker }] of markers) marker.setPopupContent(popupHtml(key));
    },
    stats: () => stats,
  };
}
