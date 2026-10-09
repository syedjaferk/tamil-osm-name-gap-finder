// localStorage / sessionStorage can throw (private mode, blocked site data); never let that break the app.

export function load(store, key, fallback) {
  try { const v = store.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

export function save(store, key, value) {
  try { value == null ? store.removeItem(key) : store.setItem(key, JSON.stringify(value)); } catch {}
}
