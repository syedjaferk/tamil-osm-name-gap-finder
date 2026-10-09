// Find OSM features that have `name` but no `name:ta`, via Overpass.
import { CONFIG } from '../config.js';
import { OSM_URL } from '../osm/http.js';
import { recentEdits } from '../osm/recent-edits.js';

const CATEGORIES = ['all', 'amenity', 'shop', 'highway', 'place', 'tourism', 'leisure', 'office', 'building'];
const CATEGORY_KEYS = ['amenity', 'shop', 'highway', 'place', 'tourism', 'leisure', 'office', 'building', 'railway', 'public_transport'];
const MAX_AREA_DEG2 = 0.03;   // roughly 18 km x 18 km near the equator
const MAX_RESULTS = 3000;
const CACHE_TTL = 600e3;      // ms

const cache = new Map();   // query -> { at, result }

function buildQuery(area, key) {
  // `area` is an Overpass spatial filter: a bbox `(s,w,n,e)` or `(poly:"lat lon ...")`.
  const tag = key ? `["${key}"]` : '';
  return `[out:json][timeout:60];
nwr["name"]${tag}${area}->.named;
nwr.named[!"name:ta"]->.gaps;
.named out count;
.gaps out count;
.gaps out center tags ${MAX_RESULTS};`;
}

function toFeature(el) {
  const pos = 'lat' in el ? el : el.center;
  if (!pos) return null;
  const tags = el.tags || {}, { type, id } = el;
  const k = CATEGORY_KEYS.find(k => k in tags);
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [pos.lon, pos.lat] },
    properties: {
      osm_type: type,
      osm_id: id,
      name: tags.name || '',
      name_en: tags['name:en'] || '',
      category: k ? `${k}=${tags[k]}` : 'other',
      edit_url: `${OSM_URL}/edit?editor=id&${type}=${id}`,
      view_url: `${OSM_URL}/${type}/${id}`,
    },
  };
}

function parse(data) {
  const els = data.elements || [];
  const counts = els.filter(el => el.type === 'count');
  return {
    features: els.filter(el => el.type !== 'count').map(toFeature).filter(Boolean),
    named_total: Number(counts[0]?.tags.total || 0),
    missing_ta: Number(counts[1]?.tags.total || 0),
  };
}

function withoutRecentEdits(result) {
  const edited = recentEdits();
  const features = result.features.filter(f => !(`${f.properties.osm_type}/${f.properties.osm_id}` in edited));
  const named = result.named_total;
  const missing = Math.max(result.missing_ta - (result.features.length - features.length), 0);
  return {
    type: 'FeatureCollection',
    features,
    stats: {
      named_total: named,
      missing_ta: missing,
      coverage_percent: named ? Math.round(1000 * (named - missing) / named) / 10 : null,
      truncated: missing > features.length,
    },
  };
}

function checkCategory(category) {
  if (!CATEGORIES.includes(category)) throw new Error(`category must be one of ${CATEGORIES.join(', ')}`);
}

/** Shoelace area in square degrees (good enough for a size limit at Indian latitudes). */
function polygonAreaDeg2(coords) {
  let total = 0;
  coords.forEach(([y1, x1], i) => {
    const [y2, x2] = coords[(i + 1) % coords.length];
    total += x1 * y2 - x2 * y1;
  });
  return Math.abs(total) / 2;
}

const round = (v, d) => Number(v.toFixed(d));

/** Gaps inside the current map view. */
export function gapsInView({ south, west, north, east }, category = 'all') {
  checkCategory(category);
  if (north <= south || east <= west) throw new Error('Invalid bounding box.');
  if ((north - south) * (east - west) > MAX_AREA_DEG2) throw new Error('Area too large — zoom in a bit and try again.');
  const [s, w, n, e] = [south, west, north, east].map(v => round(v, 3));
  return runGapQuery(`(${s},${w},${n},${e})`, category);
}

/** Gaps inside a polygon the user drew; coords are [[lat, lon], …]. */
export function gapsInArea(coords, category = 'all') {
  checkCategory(category);
  coords = coords.map(([lat, lon]) => [round(lat, 5), round(lon, 5)]);
  const [first, last] = [coords[0], coords.at(-1)];
  if (coords.length > 1 && first[0] === last[0] && first[1] === last[1]) coords = coords.slice(0, -1);   // accept closed rings too
  if (coords.length < 3) throw new Error('A polygon needs at least 3 points.');
  if (coords.length > 200) throw new Error('Too many points — draw a simpler area.');
  if (coords.some(([lat, lon]) => !(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180))) throw new Error('Coordinates out of range.');
  const lats = coords.map(c => c[0]), lons = coords.map(c => c[1]);
  const bboxArea = (Math.max(...lats) - Math.min(...lats)) * (Math.max(...lons) - Math.min(...lons));
  const area = polygonAreaDeg2(coords);
  if (area > MAX_AREA_DEG2 || bboxArea > 3 * MAX_AREA_DEG2) throw new Error('Drawn area is too large — draw a smaller area.');
  if (area === 0) throw new Error('Drawn area has no size.');
  return runGapQuery(`(poly:"${coords.map(c => c.join(' ')).join(' ')}")`, category);
}

async function runGapQuery(area, category) {
  const query = buildQuery(area, category === 'all' ? null : category);
  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < CACHE_TTL) return withoutRecentEdits(hit.result);

  for (const url of CONFIG.OVERPASS_URLS) {
    try {
      const result = parse(await overpass(url, query));
      cache.set(query, { at: Date.now(), result });
      return withoutRecentEdits(result);
    } catch (ex) {
      if (!ex.retry) throw ex;
    }
  }
  throw new Error('All Overpass servers are busy. Try a smaller area, or again in a minute.');
}

/** One Overpass server. Errors with `retry` set mean "try the next server". */
async function overpass(url, query) {
  const fail = (message, retry = true) => Object.assign(new Error(message), { retry });
  let res;
  try {
    res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }) });
  } catch {
    throw fail('Could not reach Overpass. Check your connection and try again.');
  }
  if (res.status === 429 || res.status >= 500) throw fail('Overpass is busy, try again in a minute.');
  if (!res.ok) throw fail(`Overpass error ${res.status}`, false);
  const data = await res.json().catch(() => null);
  if (!data) throw fail('Overpass is busy, try again in a minute.');
  if (!data.elements?.length && /error|timed out/i.test(data.remark || '')) throw fail('Overpass is busy, try again in a minute.');
  return data;
}
