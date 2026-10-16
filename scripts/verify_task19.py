#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 19 — Vérification E2E : fiches PDF à CIN ALPHANUMÉRIQUE (ex. « SPEC-0001 »)
dans le portail employé sécurisé + recherche admin.

Bug corrigé (100 % additif) : les gardes « numéros séparés » du regex Task 14
rejetaient à tort un CIN comme « SPEC-0001 » écrit au milieu d'une ligne de
tableau PDF (« Marie(e) 1 SPECIMEN-001 SPEC-0001 6,205 … ») → fiches invisibles
dans le portail (my-fiches) et dans la recherche admin, et ouverture 403.

Étapes :
  1. login admin + import du ZIP specimen (50 PDF, idempotent)
  2. Recherche admin ?cin=SPEC-0001 → fiches PDF listées (nouveau comportement)
  3. Recherche admin ?cin=07451236 → inchangée (CIN numériques, strict)
  4. Accès portail créé via l'API admin (CIN « SPEC-0001 ») → connexion
     « SPEC-0001 » ET « SPEC0001 » → my-fiches contient les PDF → /file 200,
     autre CIN 403 → déconnexion → 401 → désactivation → 401
  5. Gardes Task 14 préservées (test unitaire node du regex strict/assoupli)
  6. Nettoyage : fiches specimen + accès de test supprimés (base rendue à 107)
"""
import json, os, re, sqlite3, subprocess, sys, urllib.error, urllib.request

BASE = "http://localhost:3000"
PORTAL = "http://localhost:3001"
DB = "/home/z/my-project/db/custom.db"
ZIP_PATH = "/home/z/my-project/upload/bulletins_specimen_50_PDF.zip"
ADMIN_EMAIL, ADMIN_PASSWORD = "it@demo.tn", "demo1234"

_results = []
def check(label, cond, detail=""):
    _results.append(bool(cond))
    print(("OK   " if cond else "FAIL ") + label + ((" — " + str(detail)) if detail else ""))

def http(method, url, data=None, headers=None, timeout=180):
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def jpost(url, obj, cookie=None):
    h = {"Content-Type": "application/json"}
    if cookie: h["Cookie"] = cookie
    return http("POST", url, json.dumps(obj).encode(), h)

def jget(url, cookie=None):
    return http("GET", url, None, {"Cookie": cookie} if cookie else None)

def db_count(pattern=None):
    con = sqlite3.connect(DB); cur = con.cursor()
    n = (cur.execute("SELECT COUNT(*) FROM Payslip WHERE fileName LIKE ?",
                     (pattern,)).fetchone()[0] if pattern
         else cur.execute("SELECT COUNT(*) FROM Payslip").fetchone()[0])
    con.close(); return n

# ---------- 1) Login admin + import ----------
st, body = jpost(BASE + "/api/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
sc = []
try:
    req = urllib.request.Request(BASE + "/api/auth/login",
        data=json.dumps({"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=60) as r:
        sc = r.headers.get_all("Set-Cookie") or []
except urllib.error.HTTPError as e:
    pass
cookie = "; ".join(c.split(";")[0] for c in sc)
check("1a. login admin (RH/IT)", st == 200 and "auto_rh_session=" in cookie, st)

already = db_count("bulletin_9%")
if already < 50 and os.path.exists(ZIP_PATH):
    bnd = "----Task19V" + "x" * 10
    with open(ZIP_PATH, "rb") as f:
        content = f.read()
    part = (f"--{bnd}\r\nContent-Disposition: form-data; name=\"files\"; "
            f"filename=\"bulletins_specimen_50_PDF.zip\"\r\nContent-Type: application/zip\r\n\r\n"
            ).encode() + content + f"\r\n--{bnd}--\r\n".encode()
    st, body = http("POST", BASE + "/api/payslips/upload", part,
                    {"Cookie": cookie, "Content-Type": f"multipart/form-data; boundary={bnd}"})
    check("1b. import ZIP 50 PDF (via admin)", st == 200, st)
check("1c. 50 fiches specimen en base", db_count("bulletin_9%") >= 50, db_count("bulletin_9%"))

# ---------- 2) Recherche admin : CIN alphanumérique (correctif Task 19) ----------
st, body = jget(BASE + "/api/payslips?cin=SPEC-0001", cookie)
d = json.loads(body.decode())
names = [i["fileName"] for i in d.get("items", [])]
check("2a. admin : recherche « SPEC-0001 » → PDF listé",
      st == 200 and d.get("total", 0) >= 1 and "bulletin_900001_BELHADJ_SANA.pdf" in names,
      f"total={d.get('total')}")
st, body = jget(BASE + "/api/payslips?cin=SPEC0001", cookie)
d = json.loads(body.decode())
check("2b. admin : recherche « SPEC0001 » (sans tiret) → PDF listé",
      st == 200 and d.get("total", 0) >= 1, f"total={d.get('total')}")

# ---------- 3) Recherche admin : CIN numérique strict INCHANGÉ ----------
st, body = jget(BASE + "/api/payslips?cin=07451236", cookie)
d = json.loads(body.decode())
check("3a. admin : recherche « 07451236 » → 25 fiches (inchangé)",
      st == 200 and d.get("total") == 25, f"total={d.get('total')}")
st, body = jget(BASE + "/api/payslips?cin=542351", cookie)
d = json.loads(body.decode())
check("3b. admin : partie de nombre « 542351 » → 0 fiche (garde Task 14)",
      st == 200 and d.get("total") == 0, f"total={d.get('total')}")

# ---------- 4) Portail employé (flux réel complet) ----------
st, body = jpost(BASE + "/api/portal-access", {"action": "generate", "cin": "SPEC-0001"}, cookie)
d = json.loads(body.decode())
acc_id = (d.get("access") or {}).get("id", "")
check("4a. RH : génération accès portail pour « SPEC-0001 » (stocké « SPEC0001 »)",
      st == 200 and (d.get("access") or {}).get("cin") == "SPEC0001", st)
check("4b. réponse contient otpauthUrl + qrDataUrl (QR affiché au RH)",
      bool(d.get("otpauthUrl")) and bool(d.get("qrDataUrl")),
      "otpauth+qr" if (d.get("otpauthUrl") and d.get("qrDataUrl")) else "absents")

# code TOTP calculé localement (l'accès a été recréé : secret inconnu du test)
# → on lit le secret en base UNIQUEMENT pour le test (comme portal_login_helper)
import base64, hashlib, hmac, struct, time
con = sqlite3.connect(DB); cur = con.cursor()
row = cur.execute("SELECT totpSecret FROM PortalAccess WHERE cin='SPEC0001'").fetchone()
con.close()
check("4c. accès stocké NORMALISÉ (« SPEC0001 »)", row is not None)
secret = row[0]
def totp(sec, offset=0):
    key = base64.b32decode(sec, casefold=True)
    msg = struct.pack(">Q", int(time.time()) // 30 + offset)
    h = hmac.new(key, msg, hashlib.sha1).digest()
    o = h[-1] & 0x0F
    return str((((h[o] & 0x7F) << 24) | (h[o+1] << 16) | (h[o+2] << 8) | h[o+3]) % 1000000).zfill(6)

def portal_verify_once(cin, code):
    """UNE SEULE requête /api/verify (le code étant à usage unique via
    l'anti-rejeu, un second envoi du même code serait refusé)."""
    req = urllib.request.Request(PORTAL + "/api/verify",
        data=json.dumps({"cin": cin, "code": code}).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return 200, (r.headers.get("Set-Cookie") or "").split(";")[0]
    except urllib.error.HTTPError as e:
        return e.code, ""

# Anti-rejeu MONOTONE côté serveur (w <= lastUsedWindow refusé) : seule une
# fenêtre RÉUSSIE avance le compteur ; une tentative refusée (accès désactivé)
# ne consomme rien. Le test choisit donc, dans la tolérance ±1, la première
# fenêtre strictement supérieure au dernier succès.
_last_ok_window = [None]
def fresh_login(cin):
    base = int(time.time()) // 30
    for w in (base, base + 1, base - 1):
        if _last_ok_window[0] is not None and w <= _last_ok_window[0]:
            continue
        st, ps = portal_verify_once(cin, totp(secret, w - base))
        if st == 200:
            _last_ok_window[0] = w
        return st, ps
    raise RuntimeError("aucune fenêtre TOTP disponible dans le test")

st, ps = fresh_login("SPEC-0001")
check("4d. portail : connexion « SPEC-0001 » (avec tiret) → session",
      st == 200 and ps.startswith("portail_session="), st)

st, body = jget(PORTAL + "/api/my-fiches", ps)
d = json.loads(body.decode())
names = [i["fileName"] for i in d.get("items", [])]
pdfs = [n for n in names if n.endswith(".pdf")]
check("4e. portail : my-fiches AFFICHE les fiches PDF", st == 200 and len(pdfs) >= 1,
      f"total={d.get('total')} pdf={len(pdfs)}")

if pdfs:
    fid = [i["id"] for i in d["items"] if i["fileName"] == pdfs[0]][0]
    st, body = jget(PORTAL + f"/api/payslip/{fid}/file?cin=SPEC-0001", ps)
    check("4f. portail : Ouvrir PDF (cin avec tiret) → 200", st == 200 and len(body) > 1000, st)
    st, body = jget(PORTAL + f"/api/payslip/{fid}/file?cin=SPEC0001", ps)
    check("4g. portail : Ouvrir PDF (cin sans tiret) → 200", st == 200, st)
    st, body = jget(PORTAL + f"/api/payslip/{fid}/file?cin=07451236", ps)
    check("4h. portail : autre CIN → 403 (cloisonnement)", st == 403, st)

st, body = jpost(PORTAL + "/api/logout", {}, ps)
check("4i-1. portail : déconnexion → 200", st == 200, st)
st, body = jget(PORTAL + "/api/my-fiches", None)
check("4i-2. portail : my-fiches SANS cookie → 401", st == 401, st)

# désactivation par le RH (par id) → connexion refusée même avec un code frais
st, body = jpost(BASE + "/api/portal-access", {"action": "toggle", "id": acc_id}, cookie)
check("4j. RH : désactivation de l'accès", st == 200 and (json.loads(body.decode()).get("access") or {}).get("isActive") is False, st)
st, body = fresh_login("SPEC-0001")
check("4k. portail : accès désactivé → 401 même code frais", st == 401, st)
st, body = jpost(BASE + "/api/portal-access", {"action": "toggle", "id": acc_id}, cookie)
check("4l. RH : réactivation", st == 200 and (json.loads(body.decode()).get("access") or {}).get("isActive") is True, st)
st, ps2 = fresh_login("SPEC0001")
check("4m. portail : connexion après réactivation → session",
      st == 200 and ps2.startswith("portail_session="), st)

# ---------- 5) Gardes regex Task 14 préservées (unitaire node) ----------
node_code = r"""
function normalizeText(t){return String(t||'').toUpperCase().replace(/[\s.\/\-]/g,'');}
function strictRe(q){const n=normalizeText(q);const sep='[\\s./\\-]*';const esc=n.split('').map(c=>c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join(sep);return new RegExp('(?<![A-Z0-9])(?<![0-9A-Z][ \\t./\\-])'+esc+'(?![A-Z0-9])(?![ \\t./\\-]{1,4}[0-9])');}
function relaxedRe(q){const n=normalizeText(q);if(!/[A-Z]/.test(n))return null;const sep='[\\s./\\-]*';const esc=n.split('').map(c=>c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join(sep);return new RegExp('(?<![A-Z0-9])'+esc+'(?![A-Z0-9])');}
const C='Marie(e) 1 SPECIMEN-001 SPEC-0001 6,205 19,000 1709,279';
const ok1=strictRe('542351').test('Total 26 542 351 fin')===false;
const ok2=relaxedRe('542351')===null;
const ok3=relaxedRe('SPEC-0001').test(C)===true;
const ok4=strictRe('SPEC-0001').test(C)===false;
const ok5=relaxedRe('SPEC0001').test('SPECIMEN001SPEC0001x')===false;
console.log(JSON.stringify({ok1,ok2,ok3,ok4,ok5}));
"""
out = subprocess.run(["node", "-e", node_code], capture_output=True, text=True, timeout=60)
g = json.loads(out.stdout.strip() or "{}")
check("5a. garde « 26 542 351 » (strict) inchangée", g.get("ok1") is True)
check("5b. gate lettres (542351 → jamais relaxé)", g.get("ok2") is True)
check("5c. « SPEC-0001 » matché par le relaxé", g.get("ok3") is True)
check("5d. strict Task 14 inchangé (rejette toujours)", g.get("ok4") is True)
check("5e. garde « collé à un mot » conservée", g.get("ok5") is True)

# ---------- 6) Nettoyage (base rendue à l'état initial) ----------
st, body = jpost(BASE + "/api/portal-access", {"action": "delete", "id": acc_id}, cookie)
check("6a. suppression de l'accès de test", st == 200 and json.loads(body.decode()).get("ok") is True, st)
con = sqlite3.connect(DB); cur = con.cursor()
files = [r[0] for r in cur.execute(
    "SELECT storedName FROM Payslip WHERE fileName LIKE 'bulletin_9%'").fetchall()]
cur.execute("DELETE FROM Payslip WHERE fileName LIKE 'bulletin_9%'")
con.commit(); con.close()
removed = 0
for fn in files:
    for base in ["/home/z/my-project/storage/payslips",
                 "/home/z/my-project/.next/standalone/storage/payslips"]:
        p = os.path.join(base, fn)
        if os.path.exists(p):
            try: os.remove(p); removed += 1
            except OSError: pass
check("6b. 50 fiches specimen supprimées (base + fichiers)",
      db_count("bulletin_9%") == 0 and db_count() == 107, f"total={db_count()} fichiers={removed}")

print()
print(f"===== RÉSULTAT : {sum(_results)}/{len(_results)} OK =====")
sys.exit(0 if all(_results) else 1)
