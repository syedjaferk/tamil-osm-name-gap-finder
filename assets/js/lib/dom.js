export const $ = id => document.getElementById(id);

/** Escape text before putting it in innerHTML. OSM data is user-supplied, so always use this. */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const TAMIL = /[஀-௿]/;

/** Remove query parameters from the address bar without reloading. */
export function stripQueryParams(...keys) {
  const url = new URL(location.href);
  keys.forEach(k => url.searchParams.delete(k));
  history.replaceState(null, '', url);
}
