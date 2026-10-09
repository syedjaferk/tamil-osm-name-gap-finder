# Tamil Name Gap Finder · தமிழ் பெயர் இடைவெளி

Find OpenStreetMap features that have a `name` but no `name:ta`, log in with your OSM account, and add the Tamil name right from the map.

It's a **static web app**: plain HTML, CSS and JS in `public/`, with no backend. The browser talks to Overpass and the OSM API directly, so it can be hosted anywhere that serves files (GitHub Pages, Cloudflare Pages, Netlify, or Nginx).

## 1. Register an OAuth 2 app on OpenStreetMap

1. Log in to openstreetmap.org → **My Settings → OAuth 2 applications → Register new application**
   (https://www.openstreetmap.org/oauth2/applications/new)
2. Fill in:
   - **Name:** Tamil Name Gap Finder
   - **Redirect URI:** the URL of the page itself, e.g. `http://127.0.0.1:8000/` for local testing and `https://osm.example.com/` in production. You can register one per line.
     (OSM allows plain `http` only for `127.0.0.1`/`localhost`.)
   - **Confidential application:** ❌ **unchecked**. The app is a public PKCE client, so there is no client secret.
   - **Permissions:** ✅ *Read user preferences* and ✅ *Modify the map*
3. Put the **Client ID** in `public/assets/js/config.js` as `CLIENT_ID`. It's public by design, so it's safe to commit.

## 2. Run it locally

```bash
python3 -m http.server 8000 --bind 127.0.0.1 --directory public
```

Open **http://127.0.0.1:8000/?dry=1**. Use `127.0.0.1`, not `localhost`, so it matches the redirect URI.

1. **Log in with OpenStreetMap**
2. Zoom into a neighbourhood → **Scan this view**, or press **✏️ Draw area**, click points around a ward / street / campus, and finish (click the first point, double-click, or press Enter). The drawn area is scanned automatically.
3. Click an orange dot → type the Tamil name → **Save name:ta to OSM**
4. The dot turns green. When you're done, press **Finish & close changeset**.

`?dry=1` turns on dry-run mode for that browser tab: the exact XML that would be uploaded is printed to the browser console and nothing is sent. Open the page with `?dry=0` to switch it off, or set `DRY_RUN: true` in `assets/js/config.js` to make dry run the default.

## 3. Deploy

Upload the contents of `public/` to any static host and register its URL as a redirect URI.

- **GitHub Pages / Cloudflare Pages / Netlify:** publish the `public` folder. If the site lives in a subpath (e.g. `https://user.github.io/tamil-osm/`), register that full URL.
- **Your own server:** copy `public/` to `/var/www/tamil-osm` and use the server block in `deploy/nginx.conf`, then run `sudo certbot --nginx -d osm.example.com`.

Serve it over HTTPS. Login uses the Web Crypto API, which browsers only allow on HTTPS or `127.0.0.1`/`localhost`.

## "Why contribute?" panel

A bilingual (தமிழ் / English) panel explaining the benefit of adding `name:ta`. It opens on a visitor's first visit, can be reopened from the header, and shows live numbers from the user's last scan and their edit count. The text lives in the `<dialog id="why">` block in `public/index.html`, so it's easy to edit.

## Config (`public/assets/js/config.js`)

| Key | Default | Purpose |
|---|---|---|
| `CLIENT_ID` | `''` | OAuth 2 client ID (editing is disabled without it) |
| `REDIRECT_URI` | this page's URL without the query string | Must match a registered redirect URI exactly |
| `OSM_URL` | `https://www.openstreetmap.org` | OAuth + web links |
| `OSM_API_URL` | `https://api.openstreetmap.org` | API 0.6 for edits |
| `OVERPASS_URLS` | overpass-api.de, then two mirrors | Tried in order when a server is busy or down |
| `DRY_RUN` | `false` | `true` = build edits but don't upload |

If you change `OSM_URL`, `OSM_API_URL` or `OVERPASS_URLS`, also update `connect-src` in the Content-Security-Policy `<meta>` tag in `index.html`, or the browser will block the requests.

## Folder structure

```
tamil-osm-name-gap-finder/
├── public/                     ← the whole site; deploy this folder as-is
│   ├── index.html              markup, Content-Security-Policy, "Why contribute" text
│   └── assets/
│       ├── css/
│       │   ├── main.css        layout, header, map, popups
│       │   └── why-dialog.css  "Why contribute" dialog
│       └── js/
│           ├── main.js         entry point: map setup, scan, wires the modules together
│           ├── config.js       settings (client ID, endpoints, dry run)
│           ├── lib/
│           │   ├── dom.js      $, HTML escaping, Tamil-script check
│           │   └── storage.js  safe localStorage / sessionStorage
│           ├── osm/
│           │   ├── session.js       login state + dry-run mode
│           │   ├── http.js          OSM URLs, fetch helpers, authenticated API calls
│           │   ├── auth.js          OAuth 2 + PKCE login / logout
│           │   ├── edits.js         add name:ta, changesets
│           │   └── recent-edits.js  hide just-edited features from scans
│           ├── overpass/
│           │   └── gaps.js     Overpass queries (view / drawn area), mirrors, cache
│           └── ui/
│               ├── auth-bar.js    login button, changeset status
│               ├── gap-layer.js   markers, popups, save form, stats line
│               ├── draw-area.js   "Draw area" polygon tool
│               └── why-dialog.js  bilingual "Why contribute" dialog
├── deploy/
│   └── nginx.conf              server block for self-hosting
└── README.md
```

Modules under `osm/` and `overpass/` don't touch the page; everything that reads or writes the DOM is in `ui/` and `main.js`.

## How it works

```
Browser ──Overpass QL──────▶ overpass-api.de (+ mirrors)   (find gaps)
Browser ──OAuth2 + PKCE────▶ www.openstreetmap.org         (get token)
Browser ──API 0.6──────────▶ api.openstreetmap.org         (edit)
```

**Finding gaps:** `nwr["name"](bbox)` or `nwr["name"](poly:"lat lon …")` for a drawn area, minus those with `name:ta`, plus counts for a coverage %. Results are cached in the page for 10 minutes. If a server returns 429/5xx, the next one in `OVERPASS_URLS` is tried.

**Login:** OAuth 2 authorization-code flow with PKCE and a `state` check, done entirely in the browser. The access token is kept in the browser's `localStorage` (the same model the iD editor uses), so the page is locked down against script injection: a strict Content-Security-Policy, Subresource Integrity on the Leaflet CDN files, and OSM data is always escaped before it's shown. **Log out** closes the open changeset and revokes the token.

**Saving an edit:**
1. `GET /api/0.6/{type}/{id}`: fetch the current version (keeps a way's nodes and a relation's members intact)
2. If `name:ta` was added meanwhile, stop with a "someone already added it" message
3. Add `<tag k="name:ta" v="…"/>` to the element
4. Open a changeset (once per login, reused for every edit) with
   `comment=Add Tamil names (name:ta)`, `hashtags=#TamilNameGap`, `source=local knowledge`
5. `PUT` the element. A version conflict is reported to the user. If the changeset was auto-closed by OSM, the app opens a new one and retries.

Just-edited features are hidden from scans for an hour (remembered in `localStorage`), because Overpass lags a few minutes behind OSM.

## Edit responsibly

This tool writes to the real OpenStreetMap database under each user's own account.

- Add `name:ta` only when you **know** the correct Tamil name (signboards, local knowledge, official sources). Don't copy from Google Maps. Don't blindly machine-transliterate brand names.
- One person, one account, one considered edit at a time. That's why every save asks for confirmation and there's no bulk "save all".
- If you run mapathons or promote the tool widely, follow the [Organised Editing Guidelines](https://wiki.openstreetmap.org/wiki/Organised_Editing/Guidelines) and document the activity on the OSM wiki.
- Overpass is a shared free service, so keep scans to neighbourhood size.

## Ideas for next steps

- City / ward leaderboard of Tamil coverage %
- Transliteration *suggestions* (always human-reviewed) to speed up typing
- Make the language a parameter (`name:ml`, `name:kn`, …)

## License

MIT. Map data © OpenStreetMap contributors, ODbL.
# tamil-osm-name-gap-finder
