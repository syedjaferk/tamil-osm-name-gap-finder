// Entry point: sets up the map and wires the UI modules together.
import { $, stripQueryParams } from './lib/dom.js';
import { completeLogin } from './osm/auth.js';
import { setDryRun } from './osm/session.js';
import { gapsInArea, gapsInView } from './overpass/gaps.js';
import { initAuthBar, renderAuthBar } from './ui/auth-bar.js';
import { initDrawArea } from './ui/draw-area.js';
import { createGapLayer } from './ui/gap-layer.js';
import { initWhyDialog, openWhyOnFirstVisit } from './ui/why-dialog.js';

const map = L.map('map').setView([13.0827, 80.2707], 15);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const gaps = createGapLayer(map, { onSaved: renderAuthBar });
const draw = initDrawArea(map, { onStart: gaps.hide, onStop: gaps.unhide, onFinish: () => scan() });
initWhyDialog(gaps.stats);
initAuthBar(() => { renderAuthBar(); gaps.refreshPopups(); });

$('city').onchange = e => { const [lat, lon] = e.target.value.split(',').map(Number); map.setView([lat, lon], 15); };
$('scan').onclick = () => scan();

async function scan() {
  const category = $('category').value, coords = draw.coords();
  $('scan').disabled = true;
  $('stats').textContent = 'Asking Overpass…';
  try {
    let data;
    if (coords) {
      data = await gapsInArea(coords, category);
    } else {
      const b = map.getBounds();
      data = await gapsInView({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, category);
    }
    gaps.show(data, coords ? 'area' : 'view');
  } catch (ex) {
    $('stats').textContent = '⚠️ ' + ex.message;
  } finally {
    $('scan').disabled = draw.isDrawing();
  }
}

// ?dry=1 / ?dry=0 switches dry-run mode for this tab.
const q = new URLSearchParams(location.search);
if (q.has('dry')) { setDryRun(q.get('dry') === '1'); stripQueryParams('dry'); }

completeLogin()
  .catch(ex => alert('OpenStreetMap login failed: ' + ex.message))
  .finally(() => { renderAuthBar(); openWhyOnFirstVisit(); });
