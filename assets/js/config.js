// Everything here is public: it ships to every visitor's browser.
export const CONFIG = {
  // OAuth 2 app registered on openstreetmap.org with "Confidential application" UNCHECKED (see README).
  // A public PKCE client has no secret, so the client ID is safe to publish.
  CLIENT_ID: '3OMCX2-Dl6jvQmfuO0zJ9EqJWYULaCk8UCu_tJ3Oybg',

  // Defaults to this page's URL without the query string, e.g. https://osm.example.com/
  // Must match the redirect URI registered with the OAuth app exactly.
  REDIRECT_URI: '',

  OSM_URL: 'https://www.openstreetmap.org',      // OAuth + web links
  OSM_API_URL: 'https://api.openstreetmap.org',  // API 0.6 for edits
  // Tried in order; the next one is used when a server is busy or down. Keep connect-src in index.html in sync.
  OVERPASS_URLS: [
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ],

  // true = build edits but don't upload them. Visitors can also open the page with ?dry=1 (or ?dry=0).
  DRY_RUN: false,
};
