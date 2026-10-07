"""Admin console API (local only). Start with:  python admin/run.py"""

import csv
import hmac
import io
import os
import secrets
import sys
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent))
from builds import DIST, BuildRunner  # noqa: E402
from db import Database, now_iso  # noqa: E402
from signing import Signer, il, keys  # noqa: E402

HERE = Path(__file__).resolve().parent
DATA = Path(os.environ.get("PA_ADMIN_DATA", HERE / "data"))
TOKEN = os.environ.get("PA_ADMIN_TOKEN") or secrets.token_urlsafe(32)
COOKIE = "pa_admin"
SOON_DAYS = 7

db = Database(DATA / "admin.db")
signer = Signer()
runner = BuildRunner(db, DATA / "build-logs")
app = FastAPI(title="Portfolio Analyzer Admin", docs_url=None, redoc_url=None, openapi_url=None)


# --- Auth: one-time link -> HttpOnly SameSite=Strict cookie; localhost only ---------------------


@app.middleware("http")
async def guard(request: Request, call_next):
    if request.client and request.client.host not in ("127.0.0.1", "::1"):
        return JSONResponse({"detail": "Local access only"}, status_code=403)
    path = request.url.path
    if path == "/auth" or path.startswith("/static/"):
        return await call_next(request)
    if not hmac.compare_digest(request.cookies.get(COOKIE, ""), TOKEN):
        if path.startswith("/api/"):
            return JSONResponse({"detail": "Not signed in. Open the link printed by admin/run.py."}, status_code=401)
        return HTMLResponse("<p style='font:14px system-ui;padding:2rem'>Open the admin console with the link printed in the terminal by <code>admin/run.py</code>.</p>", status_code=401)
    origin = request.headers.get("origin")
    if request.method not in ("GET", "HEAD") and origin and origin != f"{request.url.scheme}://{request.url.netloc}":
        return JSONResponse({"detail": "Cross-origin request blocked"}, status_code=403)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Frame-Options"] = "DENY"
    return response


@app.get("/auth")
def auth(t: str = ""):
    if not hmac.compare_digest(t, TOKEN):
        return HTMLResponse("<p style='font:14px system-ui;padding:2rem'>Invalid or expired link. Restart admin/run.py.</p>", status_code=401)
    resp = RedirectResponse("/", status_code=303)
    resp.set_cookie(COOKIE, TOKEN, httponly=True, samesite="strict", path="/")
    return resp


@app.get("/")
def index():
    return FileResponse(HERE / "static" / "index.html")


app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")


# --- Licence status -------------------------------------------------------------------------


def status_of(lic: dict, today: date | None = None) -> dict:
    today = today or date.today()
    latest = date.fromisoformat(lic["latest_expiry"])
    activate_by = date.fromisoformat(lic["activate_by"])
    if lic["revoked"]:
        return {"status": "revoked", "label": "Revoked (records only)", "expires": None, "days_left": None, "soon": False}
    if lic["activated_on"]:
        exp = min(date.fromisoformat(lic["activated_on"]) + timedelta(days=lic["days"]), latest)
        left = (exp - today).days
        if left <= 0:
            return {"status": "expired", "label": "Expired", "expires": exp.isoformat(), "days_left": 0, "soon": False}
        return {"status": "active", "label": "Active", "expires": exp.isoformat(), "days_left": left, "soon": left <= SOON_DAYS}
    if today >= latest:
        return {"status": "expired", "label": "Expired", "expires": latest.isoformat(), "days_left": 0, "soon": False}
    if today > activate_by:
        left = (latest - today).days
        return {"status": "unconfirmed", "label": "Activation not recorded", "expires": latest.isoformat(), "days_left": left, "soon": left <= SOON_DAYS}
    return {"status": "awaiting", "label": "Awaiting activation", "expires": latest.isoformat(), "days_left": (latest - today).days, "soon": False}


LICENSE_SELECT = """
SELECT l.*, r.name AS recipient_name, r.email AS recipient_email
FROM licenses l JOIN recipients r ON r.id = l.recipient_id
"""


def enrich(lic: dict) -> dict:
    return {**lic, **status_of(lic)}


def send_message(lic: dict) -> str:
    return (
        f"Hi {lic['recipient_name']},\n\n"
        f"Here is your Portfolio Analyzer licence key for device {lic['device_id']}:\n\n"
        f"{lic['key']}\n\n"
        f"Paste it into the app's activation screen (or Settings > Licence > Enter a new licence key).\n"
        f"Please activate it by {lic['activate_by']}. It is valid for {lic['days']} days from activation"
        f" and works on this one device only.\n"
    )


# --- Summary --------------------------------------------------------------------------------


@app.get("/api/summary")
def summary():
    lics = [enrich(l) for l in db.all(LICENSE_SELECT + " ORDER BY l.created_at DESC")]
    counts = Counter(l["status"] for l in lics)
    by_month = Counter(l["issued_on"][:7] for l in lics)
    months = []
    d = date.today().replace(day=1)
    for _ in range(12):
        months.append({"month": d.strftime("%Y-%m"), "label": d.strftime("%b %y"), "count": by_month.get(d.strftime("%Y-%m"), 0)})
        d = (d - timedelta(days=1)).replace(day=1)
    revenue: dict[str, float] = defaultdict(float)
    for l in lics:
        if l["amount"]:
            revenue[l["currency"] or "—"] += l["amount"]
    soon = sorted((l for l in lics if l["soon"]), key=lambda l: l["days_left"] or 0)
    return {
        "recipients": db.one("SELECT COUNT(*) AS n FROM recipients")["n"],
        "licenses": len(lics),
        "counts": {s: counts.get(s, 0) for s in ("active", "awaiting", "unconfirmed", "expired", "revoked")},
        "expiring_soon": soon[:10],
        "recent": lics[:8],
        "issued_by_month": list(reversed(months)),
        "revenue": [{"currency": k, "amount": round(v, 2)} for k, v in sorted(revenue.items())],
        "last_build": db.one("SELECT * FROM builds ORDER BY id DESC LIMIT 1"),
        "keys": signer.status(),
    }


# --- Recipients -----------------------------------------------------------------------------


class RecipientIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=2000)


@app.get("/api/recipients")
def recipients():
    return db.all(
        """SELECT r.*, COUNT(l.id) AS licenses, MAX(l.issued_on) AS last_issued,
                  GROUP_CONCAT(DISTINCT l.device_id) AS devices
           FROM recipients r LEFT JOIN licenses l ON l.recipient_id = r.id
           GROUP BY r.id ORDER BY r.name COLLATE NOCASE"""
    )


@app.post("/api/recipients")
def create_recipient(body: RecipientIn):
    rid = db.run("INSERT INTO recipients (name, email, phone, notes, created_at) VALUES (?, ?, ?, ?, ?)",
                 body.name.strip(), body.email, body.phone, body.notes, now_iso())
    db.audit("recipient.create", f"#{rid} {body.name}")
    return db.one("SELECT * FROM recipients WHERE id=?", rid)


@app.put("/api/recipients/{rid}")
def update_recipient(rid: int, body: RecipientIn):
    if not db.one("SELECT id FROM recipients WHERE id=?", rid):
        raise HTTPException(404, "Recipient not found")
    db.run("UPDATE recipients SET name=?, email=?, phone=?, notes=? WHERE id=?", body.name.strip(), body.email, body.phone, body.notes, rid)
    db.audit("recipient.update", f"#{rid}")
    return db.one("SELECT * FROM recipients WHERE id=?", rid)


@app.get("/api/recipients/{rid}")
def recipient(rid: int):
    r = db.one("SELECT * FROM recipients WHERE id=?", rid)
    if not r:
        raise HTTPException(404, "Recipient not found")
    r["licenses"] = [enrich(l) for l in db.all(LICENSE_SELECT + " WHERE l.recipient_id=? ORDER BY l.created_at DESC", rid)]
    return r


# --- Licences -------------------------------------------------------------------------------


class IssueIn(BaseModel):
    recipient_id: int | None = None
    new_recipient: RecipientIn | None = None
    device_id: str = Field(min_length=10, max_length=40)
    days: int = Field(ge=1, le=3650)
    activate_within: int = Field(default=14, ge=1, le=365)
    build_version: str | None = Field(default=None, max_length=20)
    amount: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, max_length=8)
    notes: str | None = Field(default=None, max_length=2000)
    renewal_of: int | None = None


class LicensePatch(BaseModel):
    activated_on: str | None = None
    clear_activated_on: bool = False
    revoked: bool | None = None
    notes: str | None = Field(default=None, max_length=2000)
    amount: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, max_length=8)
    build_version: str | None = Field(default=None, max_length=20)


@app.get("/api/licenses")
def licenses(status: str = "", q: str = ""):
    rows = [enrich(l) for l in db.all(LICENSE_SELECT + " ORDER BY l.created_at DESC")]
    if status:
        rows = [r for r in rows if r["status"] == status or (status == "soon" and r["soon"])]
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in f"{r['recipient_name']} {r['recipient_email'] or ''} {r['device_id']} {r['license_id']} {r['notes'] or ''}".lower()]
    return rows


@app.get("/api/licenses/{lid}")
def license_detail(lid: int):
    row = db.one(LICENSE_SELECT + " WHERE l.id=?", lid)
    if not row:
        raise HTTPException(404, "Licence not found")
    return {**enrich(row), "message": send_message(row)}


@app.post("/api/licenses")
def issue(body: IssueIn):
    if body.recipient_id:
        rec = db.one("SELECT * FROM recipients WHERE id=?", body.recipient_id)
        if not rec:
            raise HTTPException(404, "Recipient not found")
    elif body.new_recipient:
        rec = create_recipient(body.new_recipient)
    else:
        raise HTTPException(400, "Choose a recipient or enter a new one")
    try:
        payload, key = signer.issue(body.device_id, body.days, rec["name"], body.activate_within)
    except il.IssueError as exc:
        raise HTTPException(400, str(exc)) from exc
    latest = (date.fromisoformat(payload["activate_by"]) + timedelta(days=payload["days"])).isoformat()
    new_id = db.run(
        """INSERT INTO licenses (license_id, recipient_id, device_id, days, issued_on, activate_by, latest_expiry, key,
                                 build_version, amount, currency, notes, renewal_of, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        payload["lid"], rec["id"], payload["device"], payload["days"], payload["issued"], payload["activate_by"], latest, key,
        body.build_version, body.amount, (body.currency or None), body.notes, body.renewal_of, now_iso(),
    )
    il.append_ledger(payload, key)  # keep the CSV ledger as an extra backup
    db.audit("license.issue", f"#{new_id} {rec['name']} {payload['device']} {payload['days']}d")
    return license_detail(new_id)


@app.patch("/api/licenses/{lid}")
def update_license(lid: int, body: LicensePatch):
    row = db.one("SELECT * FROM licenses WHERE id=?", lid)
    if not row:
        raise HTTPException(404, "Licence not found")
    fields: dict = {}
    if body.clear_activated_on:
        fields["activated_on"] = None
    elif body.activated_on:
        try:
            d = date.fromisoformat(body.activated_on)
        except ValueError as exc:
            raise HTTPException(400, "activated_on must be YYYY-MM-DD") from exc
        if not row["issued_on"] <= d.isoformat() <= row["activate_by"]:
            raise HTTPException(400, f"Activation must be between {row['issued_on']} and {row['activate_by']}")
        fields["activated_on"] = d.isoformat()
    for name in ("notes", "amount", "currency", "build_version"):
        if getattr(body, name) is not None:
            fields[name] = getattr(body, name)
    if body.revoked is not None:
        fields["revoked"] = int(body.revoked)
    if fields:
        db.run(f"UPDATE licenses SET {', '.join(f'{k}=?' for k in fields)} WHERE id=?", *fields.values(), lid)
        db.audit("license.update", f"#{lid} {sorted(fields)}")
    return license_detail(lid)


@app.get("/api/export/licenses.csv")
def export_csv():
    out = io.StringIO()
    w = csv.writer(out)
    cols = ["id", "license_id", "recipient_name", "recipient_email", "device_id", "days", "issued_on", "activate_by",
            "activated_on", "expires", "status", "build_version", "amount", "currency", "notes", "key"]
    w.writerow(cols)
    for l in licenses():
        w.writerow([l.get(c) for c in cols])
    db.audit("export.csv", "")
    return Response(out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=licences-{date.today().isoformat()}.csv"})


@app.post("/api/import-ledger")
def import_ledger():
    """Import keys issued earlier with licensing/issue_license.py (licensing/issued/licenses.csv)."""
    if not il.LEDGER.exists():
        raise HTTPException(404, f"No ledger at {il.LEDGER}")
    added = skipped = 0
    with il.LEDGER.open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if db.one("SELECT id FROM licenses WHERE license_id=?", row["licence_id"]):
                skipped += 1
                continue
            rec = db.one("SELECT * FROM recipients WHERE name=? COLLATE NOCASE", row["name"]) or create_recipient(RecipientIn(name=row["name"]))
            latest = (date.fromisoformat(row["activate_by"]) + timedelta(days=int(row["days"]))).isoformat()
            db.run(
                """INSERT INTO licenses (license_id, recipient_id, device_id, days, issued_on, activate_by, latest_expiry, key, source, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'imported', ?)""",
                row["licence_id"], rec["id"], row["device"], int(row["days"]), row["issued"], row["activate_by"], latest, row["key"], now_iso(),
            )
            added += 1
    db.audit("import.ledger", f"added {added}, skipped {skipped}")
    return {"added": added, "skipped": skipped}


class KeyIn(BaseModel):
    key: str = Field(min_length=10, max_length=4000)


@app.post("/api/verify")
def verify(body: KeyIn):
    try:
        payload = signer.verify(body.key)
    except (keys.LicenseKeyError, il.IssueError) as exc:
        return {"valid": False, "message": str(exc)}
    match = db.one(LICENSE_SELECT + " WHERE l.license_id=?", payload["lid"])
    return {"valid": True, "payload": payload, "license": enrich(match) if match else None}


# --- Signing keys ---------------------------------------------------------------------------


class PassIn(BaseModel):
    passphrase: str | None = Field(default=None, max_length=200)


@app.get("/api/keys")
def key_status():
    return signer.status()


@app.post("/api/keys/unlock")
def unlock(body: PassIn):
    try:
        st = signer.unlock(body.passphrase)
    except il.IssueError as exc:
        raise HTTPException(400, str(exc)) from exc
    db.audit("keys.unlock", "")
    return st


@app.post("/api/keys/lock")
def lock():
    return signer.lock()


class GenerateIn(BaseModel):
    passphrase: str = Field(min_length=8, max_length=200)
    confirm: str


@app.post("/api/keys/generate")
def generate(body: GenerateIn):
    if body.confirm != "CREATE":
        raise HTTPException(400, "Type CREATE to confirm")
    if il.PRIVATE.exists():
        raise HTTPException(409, "A private key already exists. Use licensing/make_keys.py --force only if you really mean to replace it.")
    st = signer.generate(body.passphrase)
    db.audit("keys.generate", st["public_key_fingerprint"] or "")
    return st


# --- Builds ---------------------------------------------------------------------------------


class BuildIn(BaseModel):
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    hard_expiry: str | None = Field(default=None, pattern=r"^(\d{4}-\d{2}-\d{2})?$")
    skip_backend: bool = False
    reuse_native: bool = False
    no_obfuscate: bool = False


@app.get("/api/builds")
def builds():
    rows = db.all("SELECT * FROM builds ORDER BY id DESC LIMIT 100")
    last_ok = next((b["version"] for b in rows if b["status"] == "succeeded"), None)
    if last_ok:
        major, minor, patch = (int(x) for x in last_ok.split("."))
        suggested = f"{major}.{minor}.{patch + 1}"
    else:
        suggested = "1.0.0"
    return {"builds": rows, "running": runner.current_id, "suggested_version": suggested}


@app.post("/api/builds")
def start_build(body: BuildIn):
    try:
        bid = runner.start(body.version, body.hard_expiry or None, body.skip_backend, body.reuse_native, body.no_obfuscate)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    return db.one("SELECT * FROM builds WHERE id=?", bid)


@app.post("/api/builds/cancel")
def cancel_build():
    if not runner.cancel():
        raise HTTPException(409, "No build is running")
    return {"cancelled": True}


@app.get("/api/builds/{bid}/log")
def build_log(bid: int, offset: int = 0):
    try:
        return runner.read_log(bid, max(0, offset))
    except KeyError as exc:
        raise HTTPException(404, "Build not found") from exc


@app.post("/api/open/{what}")
def open_folder(what: str):
    target = {"dist": DIST, "logs": DATA / "build-logs", "data": DATA}.get(what)
    if not target:
        raise HTTPException(404, "Unknown folder")
    target.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        os.startfile(target)  # noqa: S606 - opens Explorer on the developer's own machine
    return {"opened": str(target)}


@app.get("/api/audit")
def audit():
    return db.all("SELECT * FROM audit ORDER BY id DESC LIMIT 200")
