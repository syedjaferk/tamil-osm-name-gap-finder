"""Tamil Name Gap Finder — find OSM features that have `name` but no `name:ta`,
log in with OpenStreetMap, and add the Tamil name right from the map."""

import base64
import hashlib
import os
import re
import secrets
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Literal
from urllib.parse import urlencode

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


OSM_URL = os.getenv("OSM_URL", "https://www.openstreetmap.org").rstrip("/")     # OAuth + web links
OSM_API_URL = os.getenv("OSM_API_URL", "https://api.openstreetmap.org").rstrip("/")  # API 0.6
CLIENT_ID = os.getenv("OSM_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("OSM_CLIENT_SECRET", "")
REDIRECT_URI = os.getenv("OSM_REDIRECT_URI", "http://127.0.0.1:8000/auth/callback")
DRY_RUN = os.getenv("DRY_RUN", "0") == "1"   # build the edit but don't upload it
SCOPES = "read_prefs write_api"

APP_VERSION = "0.2.0"
USER_AGENT = f"tamil-name-gap-finder/{APP_VERSION} (+https://github.com/your-username/tamil-name-gap-finder)"
CHANGESET_TAGS = {
    "created_by": f"Tamil Name Gap Finder {APP_VERSION}",
    "comment": "Add Tamil names (name:ta)",
    "hashtags": "#TamilNameGap",
    "source": "local knowledge",
}

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
CATEGORIES = ["all", "amenity", "shop", "highway", "place", "tourism", "leisure", "office", "building"]
CATEGORY_KEYS = ["amenity", "shop", "highway", "place", "tourism", "leisure", "office", "building", "railway", "public_transport"]
MAX_AREA_DEG2 = 0.03   # roughly 18 km x 18 km near the equator
MAX_RESULTS = 3000
CACHE_TTL = 600        # seconds
EDITED_TTL = 3600      # hide just-edited features until Overpass catches up

TAMIL_RE = re.compile(r"[஀-௿]")
COOKIE = "tngf_session"
SESSION_TTL = 7 * 24 * 3600

# In-memory stores. Fine for one process; use Redis/a DB for production.
_cache: dict[tuple, tuple[float, dict]] = {}
_edited: dict[tuple[str, int], float] = {}
SESSIONS: dict[str, dict] = {}

app = FastAPI(title="Tamil Name Gap Finder")
STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


# -------------------------------------------------------------- sessions ---

def _prune_sessions() -> None:
    now = time.time()
    for sid in [s for s, v in SESSIONS.items() if now - v["created"] > SESSION_TTL]:
        SESSIONS.pop(sid, None)


def get_session(request: Request) -> dict | None:
    sid = request.cookies.get(COOKIE)
    return SESSIONS.get(sid) if sid else None


def require_login(request: Request) -> dict:
    sess = get_session(request)
    if not sess or not sess.get("token"):
        raise HTTPException(401, "Please log in with OpenStreetMap first.")
    return sess


def osm_client(sess: dict) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=OSM_API_URL,
        timeout=30,
        headers={"Authorization": f"Bearer {sess['token']}", "User-Agent": USER_AGENT},
    )


# ----------------------------------------------------------------- OAuth ---

@app.get("/auth/login")
def login():
    if not CLIENT_ID:
        raise HTTPException(500, "OSM_CLIENT_ID is not set — see README for registering an OAuth app.")
    _prune_sessions()
    state = secrets.token_urlsafe(16)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    params = urlencode({
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })
    resp = RedirectResponse(f"{OSM_URL}/oauth2/authorize?{params}")
    # Always start a fresh session on login (prevents session fixation).
    sid = secrets.token_urlsafe(32)
    SESSIONS[sid] = {"created": time.time(), "state": state, "verifier": verifier}
    resp.set_cookie(COOKIE, sid, httponly=True, samesite="lax",
                    secure=REDIRECT_URI.startswith("https"), max_age=SESSION_TTL)
    return resp


@app.get("/auth/callback")
async def callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    if error:
        return RedirectResponse("/?login_error=" + error)
    sess = get_session(request)
    if not sess or not code or not state or not secrets.compare_digest(state, sess.get("state", "")):
        raise HTTPException(400, "Login session expired or invalid. Please try again.")

    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": USER_AGENT}) as client:
        tok = await client.post(f"{OSM_URL}/oauth2/token", data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "code_verifier": sess["verifier"],
        })
        if tok.status_code != 200:
            raise HTTPException(502, f"Token exchange failed ({tok.status_code}).")
        token = tok.json()["access_token"]

        me = await client.get(f"{OSM_API_URL}/api/0.6/user/details.json",
                              headers={"Authorization": f"Bearer {token}"})
        me.raise_for_status()
        user = me.json()["user"]

    sess.pop("state", None)
    sess.pop("verifier", None)
    sess.update(token=token, user={"id": user["id"], "display_name": user["display_name"]},
                changeset_id=None, edits=0)
    return RedirectResponse("/")


@app.post("/auth/logout")
async def logout(request: Request):
    sid = request.cookies.get(COOKIE)
    sess = SESSIONS.pop(sid, None) if sid else None
    if sess and sess.get("token"):
        try:
            async with osm_client(sess) as client:
                if sess.get("changeset_id"):
                    await client.put(f"/api/0.6/changeset/{sess['changeset_id']}/close")
            async with httpx.AsyncClient(timeout=15, headers={"User-Agent": USER_AGENT}) as client:
                await client.post(f"{OSM_URL}/oauth2/revoke", data={
                    "token": sess["token"], "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET})
        except httpx.HTTPError:
            pass  # best effort; OSM auto-closes idle changesets after an hour
    resp = RedirectResponse("/", status_code=303)
    resp.delete_cookie(COOKIE)
    return resp


@app.get("/api/me")
def me(request: Request):
    sess = get_session(request)
    logged_in = bool(sess and sess.get("token"))
    return {
        "configured": bool(CLIENT_ID),
        "dry_run": DRY_RUN,
        "osm_url": OSM_URL,
        "logged_in": logged_in,
        "user": sess["user"] if logged_in else None,
        "changeset_id": sess.get("changeset_id") if logged_in else None,
        "edits": sess.get("edits", 0) if logged_in else 0,
    }


# --------------------------------------------------------------- editing ---

class EditIn(BaseModel):
    osm_type: Literal["node", "way", "relation"]
    osm_id: int = Field(gt=0)
    name_ta: str = Field(min_length=1, max_length=255)


def clean_tamil_name(raw: str) -> str:
    name = " ".join(raw.split())
    if not name or len(name) > 255:
        raise HTTPException(400, "Name must be 1–255 characters.")
    if not TAMIL_RE.search(name):
        raise HTTPException(400, "name:ta should be written in Tamil script (தமிழ்).")
    return name


def add_tag_to_element(xml_bytes: bytes, osm_type: str, key: str, value: str) -> tuple[ET.Element, ET.Element]:
    """Parse an element from the OSM API and add a tag.
    Returns (root, element). Raises HTTPException(409) if the tag already exists."""
    root = ET.fromstring(xml_bytes)
    el = root.find(osm_type)
    if el is None:
        raise HTTPException(502, "Unexpected response from OSM API.")
    for tag in el.findall("tag"):
        if tag.get("k") == key:
            raise HTTPException(409, f"Someone already added {key} = {tag.get('v')}")
    ET.SubElement(el, "tag", k=key, v=value)
    return root, el


def changeset_xml() -> bytes:
    root = ET.Element("osm")
    cs = ET.SubElement(root, "changeset")
    for k, v in CHANGESET_TAGS.items():
        ET.SubElement(cs, "tag", k=k, v=v)
    return ET.tostring(root, encoding="utf-8")


async def ensure_changeset(client: httpx.AsyncClient, sess: dict) -> int:
    """Reuse one changeset per session so a mapping session is one tidy changeset."""
    if sess.get("changeset_id"):
        return sess["changeset_id"]
    r = await client.put("/api/0.6/changeset/create", content=changeset_xml(),
                         headers={"Content-Type": "text/xml"})
    if r.status_code != 200:
        raise HTTPException(502, f"Could not open a changeset ({r.status_code}): {r.text[:200]}")
    sess["changeset_id"] = int(r.text.strip())
    return sess["changeset_id"]


@app.post("/api/edit")
async def edit(body: EditIn, request: Request):
    sess = require_login(request)
    name_ta = clean_tamil_name(body.name_ta)
    path = f"/api/0.6/{body.osm_type}/{body.osm_id}"

    async with osm_client(sess) as client:
        cur = await client.get(path)
        if cur.status_code in (404, 410):
            raise HTTPException(404, "This feature no longer exists in OSM.")
        if cur.status_code != 200:
            raise HTTPException(502, f"OSM API error {cur.status_code}")

        try:
            root, el = add_tag_to_element(cur.content, body.osm_type, "name:ta", name_ta)
        except HTTPException as exc:
            if exc.status_code == 409:
                _edited[(body.osm_type, body.osm_id)] = time.time()
            raise

        if DRY_RUN:
            el.set("changeset", "0")
            return {"ok": True, "dry_run": True, "xml": ET.tostring(root, encoding="unicode")}

        for _ in range(2):
            cs_id = await ensure_changeset(client, sess)
            el.set("changeset", str(cs_id))
            put = await client.put(path, content=ET.tostring(root, encoding="utf-8"),
                                   headers={"Content-Type": "text/xml"})
            # Changeset auto-closed (idle > 1h or 10k edits) -> open a new one and retry once.
            if put.status_code == 409 and "closed" in put.text.lower():
                sess["changeset_id"] = None
                continue
            break

        if put.status_code == 401:
            sess.pop("token", None)
            raise HTTPException(401, "Your OSM login expired. Please log in again.")
        if put.status_code == 409:
            raise HTTPException(409, "Someone edited this feature just now. Re-scan and try again.")
        if put.status_code != 200:
            raise HTTPException(502, f"OSM rejected the edit ({put.status_code}): {put.text[:200]}")

    _edited[(body.osm_type, body.osm_id)] = time.time()
    sess["edits"] = sess.get("edits", 0) + 1
    return {
        "ok": True,
        "version": int(put.text.strip()),
        "changeset_id": cs_id,
        "changeset_url": f"{OSM_URL}/changeset/{cs_id}",
        "edits": sess["edits"],
    }


@app.post("/api/changeset/close")
async def close_changeset(request: Request):
    sess = require_login(request)
    cs_id = sess.get("changeset_id")
    if not cs_id:
        return {"ok": True, "closed": None}
    async with osm_client(sess) as client:
        r = await client.put(f"/api/0.6/changeset/{cs_id}/close")
    sess["changeset_id"] = None
    if r.status_code not in (200, 409):  # 409 = already closed
        raise HTTPException(502, f"Could not close changeset ({r.status_code}).")
    return {"ok": True, "closed": cs_id, "changeset_url": f"{OSM_URL}/changeset/{cs_id}"}


# ------------------------------------------------------------ gap finder ---

def bbox_filter(s: float, w: float, n: float, e: float) -> str:
    return f"({s},{w},{n},{e})"


def poly_filter(coords: list[tuple[float, float]]) -> str:
    return '(poly:"' + " ".join(f"{lat} {lon}" for lat, lon in coords) + '")'


def build_query(area: str, key: str | None) -> str:
    """`area` is an Overpass spatial filter: a bbox `(s,w,n,e)` or `(poly:"lat lon ...")`."""
    tag = f'["{key}"]' if key else ""
    return f"""[out:json][timeout:60];
nwr["name"]{tag}{area}->.named;
nwr.named[!"name:ta"]->.gaps;
.named out count;
.gaps out count;
.gaps out center tags {MAX_RESULTS};"""


def to_feature(el: dict) -> dict | None:
    if "lat" in el:
        lat, lon = el["lat"], el["lon"]
    elif "center" in el:
        lat, lon = el["center"]["lat"], el["center"]["lon"]
    else:
        return None
    tags = el.get("tags", {})
    osm_type, osm_id = el["type"], el["id"]
    category = next((f"{k}={tags[k]}" for k in CATEGORY_KEYS if k in tags), "other")
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "osm_type": osm_type,
            "osm_id": osm_id,
            "name": tags.get("name", ""),
            "name_en": tags.get("name:en", ""),
            "category": category,
            "edit_url": f"{OSM_URL}/edit?editor=id&{osm_type}={osm_id}",
            "view_url": f"{OSM_URL}/{osm_type}/{osm_id}",
        },
    }


def parse(data: dict) -> dict:
    counts = [el for el in data.get("elements", []) if el["type"] == "count"]
    named_total = int(counts[0]["tags"]["total"]) if len(counts) > 0 else 0
    gap_total = int(counts[1]["tags"]["total"]) if len(counts) > 1 else 0
    features = [f for el in data.get("elements", []) if el["type"] != "count" and (f := to_feature(el))]
    return {"type": "FeatureCollection", "features": features,
            "stats": {"named_total": named_total, "missing_ta": gap_total}}


def without_recent_edits(result: dict) -> dict:
    """Overpass lags a few minutes behind OSM; hide features we just fixed."""
    now = time.time()
    for k in [k for k, t in _edited.items() if now - t > EDITED_TTL]:
        _edited.pop(k, None)
    feats = [f for f in result["features"]
             if (f["properties"]["osm_type"], f["properties"]["osm_id"]) not in _edited]
    removed = len(result["features"]) - len(feats)
    named = result["stats"]["named_total"]
    missing = max(result["stats"]["missing_ta"] - removed, 0)
    return {
        "type": "FeatureCollection",
        "features": feats,
        "stats": {
            "named_total": named,
            "missing_ta": missing,
            "coverage_percent": round(100 * (named - missing) / named, 1) if named else None,
            "truncated": missing > len(feats),
        },
    }


def check_category(category: str) -> None:
    if category not in CATEGORIES:
        raise HTTPException(400, f"category must be one of {CATEGORIES}")


def polygon_area_deg2(coords: list[tuple[float, float]]) -> float:
    """Shoelace area in square degrees (good enough for a size limit at Indian latitudes)."""
    total = 0.0
    for (y1, x1), (y2, x2) in zip(coords, coords[1:] + coords[:1]):
        total += x1 * y2 - x2 * y1
    return abs(total) / 2


@app.get("/api/gaps")
async def gaps(
    south: float = Query(..., ge=-90, le=90),
    west: float = Query(..., ge=-180, le=180),
    north: float = Query(..., ge=-90, le=90),
    east: float = Query(..., ge=-180, le=180),
    category: str = Query("all"),
):
    """Gaps inside the current map view."""
    check_category(category)
    if north <= south or east <= west:
        raise HTTPException(400, "invalid bounding box")
    if (north - south) * (east - west) > MAX_AREA_DEG2:
        raise HTTPException(400, "Area too large — zoom in a bit and try again.")
    s, w, n, e = (round(v, 3) for v in (south, west, north, east))
    return await run_gap_query(("bbox", s, w, n, e, category), bbox_filter(s, w, n, e), category)


class AreaIn(BaseModel):
    coords: list[tuple[float, float]] = Field(min_length=3, max_length=200)  # [[lat, lon], ...]
    category: str = "all"


@app.post("/api/gaps/area")
async def gaps_in_area(body: AreaIn):
    """Gaps inside a polygon the user drew."""
    check_category(body.category)
    coords = [(round(lat, 5), round(lon, 5)) for lat, lon in body.coords]
    if coords[0] == coords[-1]:
        coords = coords[:-1]                       # accept closed rings too
    if len(coords) < 3:
        raise HTTPException(400, "A polygon needs at least 3 points.")
    if any(not (-90 <= lat <= 90 and -180 <= lon <= 180) for lat, lon in coords):
        raise HTTPException(400, "Coordinates out of range.")
    lats, lons = [c[0] for c in coords], [c[1] for c in coords]
    bbox_area = (max(lats) - min(lats)) * (max(lons) - min(lons))
    if polygon_area_deg2(coords) > MAX_AREA_DEG2 or bbox_area > 3 * MAX_AREA_DEG2:
        raise HTTPException(400, "Drawn area is too large — draw a smaller area.")
    if polygon_area_deg2(coords) == 0:
        raise HTTPException(400, "Drawn area has no size.")
    return await run_gap_query(("poly", tuple(coords), body.category), poly_filter(coords), body.category)


async def run_gap_query(cache_key: tuple, area: str, category: str) -> dict:
    hit = _cache.get(cache_key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return without_recent_edits(hit[1])

    query = build_query(area, None if category == "all" else category)
    try:
        async with httpx.AsyncClient(timeout=90, headers={"User-Agent": USER_AGENT}) as client:
            resp = await client.post(OVERPASS_URL, data={"data": query})
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        msg = "Overpass is busy, try again in a minute." if status in (429, 504) else f"Overpass error {status}"
        raise HTTPException(502, msg)
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Could not reach Overpass: {exc}")

    result = parse(resp.json())
    _cache[cache_key] = (time.time(), result)
    return without_recent_edits(result)
