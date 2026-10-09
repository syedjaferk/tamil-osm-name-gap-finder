// HTTP helpers for openstreetmap.org and API 0.6.
import { CONFIG } from '../config.js';
import { getSession, setSession } from './session.js';

export const OSM_URL = CONFIG.OSM_URL.replace(/\/$/, '');
export const API_URL = CONFIG.OSM_API_URL.replace(/\/$/, '') + '/api/0.6';

/** fetch() with a readable error when the network or CORS fails. */
export async function request(url, options) {
  try {
    return await fetch(url, options);
  } catch {
    throw new Error(`Could not reach ${new URL(url).host}. Check your connection and try again.`);
  }
}

/** Authenticated API 0.6 call. A 401 logs the user out. */
export async function api(method, path, body) {
  const token = getSession()?.token;
  if (!token) throw new Error('Please log in with OpenStreetMap first.');
  const headers = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'text/xml';
  const res = await request(API_URL + path, { method, headers, body });
  if (res.status === 401) {
    setSession(null);
    throw new Error('Your OSM login expired. Please log in again.');
  }
  return res;
}
