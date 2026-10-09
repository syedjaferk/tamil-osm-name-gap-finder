// "Draw area": click points on the map to outline a polygon to scan.
import { $ } from '../lib/dom.js';

const AREA_STYLE  = { color: '#2563eb', weight: 2, fillColor: '#3b82f6', fillOpacity: .08 };
const DRAFT_STYLE = { color: '#2563eb', weight: 2, dashArray: '5 5', interactive: false };

/** `onStart` / `onStop` bracket drawing; `onFinish` runs when a polygon is complete. */
export function initDrawArea(map, { onStart, onStop, onFinish }) {
  let area = null;      // finished L.polygon
  let drawing = null;   // { pts, line, guide, dots }

  function updateButtons() {
    $('draw').setAttribute('aria-pressed', !!drawing);
    $('draw').textContent = drawing ? '✓ Finish area' : (area ? '✏️ Redraw area' : '✏️ Draw area');
    $('clearArea').hidden = !(area || drawing);
    $('clearArea').textContent = drawing ? '✕ Cancel' : '✕ Clear area';
    $('scan').textContent = area ? 'Scan drawn area' : 'Scan this view';
    $('scan').disabled = !!drawing;
  }

  function hint() {
    const n = drawing.pts.length;
    $('stats').innerHTML = `<span class="hint">Click the map to add points (${n} so far). ` +
      (n >= 3 ? 'Click the first point, double-click or press <kbd>Enter</kbd> to finish. ' : '') +
      '<kbd>Backspace</kbd> undo · <kbd>Esc</kbd> cancel</span>';
  }

  function start() {
    clear();
    onStart();
    map.doubleClickZoom.disable();
    drawing = {
      pts: [],
      line: L.polyline([], DRAFT_STYLE).addTo(map),
      guide: L.polyline([], { ...DRAFT_STYLE, opacity: .5 }).addTo(map),
      dots: L.layerGroup().addTo(map),
    };
    $('map').classList.add('drawing');
    updateButtons(); hint();
  }

  function stop() {
    if (!drawing) return;
    [drawing.line, drawing.guide, drawing.dots].forEach(l => map.removeLayer(l));
    drawing = null;
    $('map').classList.remove('drawing');
    onStop();
    setTimeout(() => map.doubleClickZoom.enable(), 0);
  }

  function redraw() {
    drawing.line.setLatLngs(drawing.pts);
    drawing.dots.clearLayers();
    drawing.pts.forEach((p, i) => L.circleMarker(p, {
      radius: i === 0 ? 6 : 4, color: '#2563eb', fillColor: '#fff', fillOpacity: 1, weight: 2, interactive: false
    }).addTo(drawing.dots));
    hint();
  }

  function finish() {
    if (!drawing) return;
    // A double-click also fires two clicks — drop points that landed on top of each other.
    const pts = drawing.pts.filter((p, i, a) =>
      i === 0 || map.latLngToContainerPoint(p).distanceTo(map.latLngToContainerPoint(a[i - 1])) > 3);
    if (pts.length < 3) { $('stats').textContent = 'An area needs at least 3 points — keep clicking.'; return; }
    stop();
    area = L.polygon(pts, AREA_STYLE).addTo(map);
    area.bringToBack();
    map.fitBounds(area.getBounds(), { padding: [30, 30] });
    updateButtons();
    onFinish();
  }

  function clear() {
    if (area) { map.removeLayer(area); area = null; }
    stop();
    updateButtons();
  }

  map.on('click', e => {
    if (!drawing) return;
    const p = drawing.pts;
    if (p.length >= 3 && map.latLngToContainerPoint(p[0]).distanceTo(e.containerPoint) < 12) return finish();
    p.push(e.latlng);
    redraw();
  });
  map.on('dblclick', () => { if (drawing) finish(); });
  map.on('mousemove', e => {
    if (drawing && drawing.pts.length) drawing.guide.setLatLngs([drawing.pts.at(-1), e.latlng, drawing.pts[0]]);
  });
  document.addEventListener('keydown', e => {
    if (!drawing || e.target.closest('input, select, textarea')) return;
    if (e.key === 'Escape') { clear(); $('stats').textContent = 'Drawing cancelled.'; }
    else if (e.key === 'Enter') finish();
    else if (e.key === 'Backspace') { e.preventDefault(); drawing.pts.pop(); redraw(); drawing.guide.setLatLngs([]); }
  });

  $('draw').onclick = () => drawing ? finish() : start();
  $('clearArea').onclick = () => {
    const wasDrawing = !!drawing;
    clear();
    $('stats').textContent = wasDrawing ? 'Drawing cancelled.' : 'Area cleared. Scan the view or draw a new area.';
  };

  return {
    /** The finished polygon as [[lat, lon], …], or null. */
    coords: () => area && area.getLatLngs()[0].map(p => [p.lat, p.lng]),
    isDrawing: () => !!drawing,
  };
}
