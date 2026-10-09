# Tamil Name Gap Finder · தமிழ் பெயர் இடைவெளி

Find OpenStreetMap features that have a `name` but no `name:ta`, log in with your OSM account, and add the Tamil name right from the map.

## 1. Register an OAuth 2 app on OpenStreetMap

1. Log in to openstreetmap.org → **My Settings → OAuth 2 applications → Register new application**
   (https://www.openstreetmap.org/oauth2/applications/new)
2. Fill in:
   - **Name:** Tamil Name Gap Finder
   - **Redirect URI:** `http://127.0.0.1:8000/auth/callback`
     (OSM allows plain `http` only for `127.0.0.1`/`localhost`; use `https://your-domain/auth/callback` in production)
   - **Confidential application:** ✅ yes
   - **Permissions:** ✅ *Read user preferences* and ✅ *Modify the map*
3. Copy the **Client ID** and **Client Secret**.

## 2. Run it

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export OSM_CLIENT_ID=xxxxxxxx
export OSM_CLIENT_SECRET=xxxxxxxx
export DRY_RUN=1          # recommended for your first run — nothing is uploaded

uvicorn app.main:app --reload --host 127.0.0.1
```

Open **http://127.0.0.1:8000** (use `127.0.0.1`, not `localhost`, so the cookie matches the redirect URI).

1. **Log in with OpenStreetMap**
2. Zoom into a neighbourhood → **Scan this view**, or press **✏️ Draw area**, click points around a ward / street / campus, and finish (click the first point, double-click, or press Enter). The drawn area is scanned automatically.
3. Click an orange dot → type the Tamil name → **Save name:ta to OSM**
4. The dot turns green. When you're done, press **Finish & close changeset**.

With `DRY_RUN=1` the exact XML that would be uploaded is printed to the browser console instead. Remove it to upload real edits.

## 2b. Or run it with Docker

```bash
cp .env.example .env      # fill in OSM_CLIENT_ID / OSM_CLIENT_SECRET
docker compose up -d --build
```

Open **http://127.0.0.1:8000**. `DRY_RUN` defaults to `1`; set `DRY_RUN=0` in `.env` to upload real edits. The port is bound to `127.0.0.1` only.

### Production with HTTPS (Caddy)

1. Point a DNS record (e.g. `osm.example.com`) at the server. Ports 80 and 443 must be free.
2. In your OSM OAuth app, register the redirect URI `https://osm.example.com/auth/callback`.
3. In `.env` set `DOMAIN=osm.example.com`, `ACME_EMAIL=you@example.com` and `DRY_RUN=0`.
4. Run:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Caddy gets and renews the Let's Encrypt certificate automatically. `OSM_REDIRECT_URI` is set from `DOMAIN`, and the session cookie becomes `Secure` because the URI is `https`.

### Production behind an existing Nginx

If the server already runs Nginx on 80/443 (for example next to the course portal), skip `docker-compose.prod.yml`. Instead, set `PORT=8010` and `OSM_REDIRECT_URI=https://osm.example.com/auth/callback` in `.env`, run `docker compose up -d --build`, and use the server block in `deploy/nginx.conf` with `certbot --nginx`.

## "Why contribute?" panel

A bilingual (தமிழ் / English) panel explaining the benefit of adding `name:ta`. It opens on a visitor's first visit, can be reopened from the header, and shows live numbers from the user's last scan and their edit count. The text lives in the `<dialog id="why">` block in `app/static/index.html`, so it's easy to edit.

## Config

| Env var | Default | Purpose |
|---|---|---|
| `OSM_CLIENT_ID` / `OSM_CLIENT_SECRET` | — | OAuth 2 app credentials (editing is disabled without them) |
| `OSM_REDIRECT_URI` | `http://127.0.0.1:8000/auth/callback` | Must match the registered redirect URI exactly |
| `OSM_URL` | `https://www.openstreetmap.org` | OAuth + web links |
| `OSM_API_URL` | `https://api.openstreetmap.org` | API 0.6 for edits |
| `DRY_RUN` | `0` | `1` = build edits but don't upload |

## How it works

```
Browser ──scan──▶ FastAPI ──Overpass QL──▶ overpass-api.de      (find gaps)
Browser ──login─▶ FastAPI ──OAuth2 + PKCE─▶ openstreetmap.org   (get token)
Browser ──save──▶ FastAPI ──API 0.6──────▶ api.openstreetmap.org (edit)
```

**Finding gaps:** `nwr["name"](bbox)` or `nwr["name"](poly:"lat lon …")` for a drawn area, minus those with `name:ta`, plus counts for a coverage %. Cached 10 minutes.

**Login:** OAuth 2 authorization-code flow with PKCE and a `state` check. The access token stays on the server; the browser only gets an HttpOnly, SameSite=Lax session cookie.

**Saving an edit:**
1. `GET /api/0.6/{type}/{id}`: fetch the current version (keeps a way's nodes and a relation's members intact)
2. If `name:ta` was added meanwhile, stop with a "someone already added it" message
3. Add `<tag k="name:ta" v="…"/>` to the element
4. Open a changeset (once per session, reused for every edit) with
   `comment=Add Tamil names (name:ta)`, `hashtags=#TamilNameGap`, `source=local knowledge`
5. `PUT` the element. A version conflict is reported to the user. If the changeset was auto-closed by OSM, the app opens a new one and retries.

Just-edited features are hidden from scans for an hour, because Overpass lags a few minutes behind OSM.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/gaps?south=&west=&north=&east=&category=all` | Gaps in the map view (GeoJSON + `stats`) |
| POST | `/api/gaps/area` | `{"coords":[[lat,lon],…],"category":"all"}`: gaps inside a drawn polygon (3–200 points) |
| GET | `/api/me` | Login state, open changeset, edit count |
| POST | `/api/edit` | `{"osm_type":"node","osm_id":123,"name_ta":"…"}` |
| POST | `/api/changeset/close` | Close the session's changeset |
| GET | `/auth/login`, `/auth/callback` · POST `/auth/logout` | OAuth |

## Edit responsibly

This tool writes to the real OpenStreetMap database under each user's own account.

- Add `name:ta` only when you **know** the correct Tamil name (signboards, local knowledge, official sources). Don't copy from Google Maps. Don't blindly machine-transliterate brand names.
- One person, one account, one considered edit at a time. That's why every save asks for confirmation and there's no bulk "save all".
- If you run mapathons or promote the tool widely, follow the [Organised Editing Guidelines](https://wiki.openstreetmap.org/wiki/Organised_Editing/Guidelines) and document the activity on the OSM wiki.
- Overpass is a shared free service, so keep scans to neighbourhood size. Put your own contact in `USER_AGENT` in `app/main.py`.

## Production notes

- Sessions and caches are in memory, so use a single worker (or move them to Redis).
- Serve over HTTPS and register the `https://` redirect URI.

## Ideas for next steps

- City / ward leaderboard of Tamil coverage %
- Transliteration *suggestions* (always human-reviewed) to speed up typing
- Make the language a parameter (`name:ml`, `name:kn`, …)

## License

MIT. Map data © OpenStreetMap contributors, ODbL.
# tamil-osm-name-gap-finder
