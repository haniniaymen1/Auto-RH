#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Applique le nouveau extractPeriod (V3) :
  1. Redetect CIN & périodes sur TOUTES les fiches déjà en base (aucune re-suppression)
  2. Importe les 20 nouvelles fiches (zip2 : Jean_Dupont..Sarah_Fournier)
  3. Vérifie : période remplie pour les 20 nouvelles + régression anciennes
"""
import json, os, sys, glob
import urllib.request, urllib.error

BASE = "http://localhost:3000"
EMAIL, PASSWORD = "it@demo.tn", "demo1234"
NEW_DIR = "/home/z/my-project/upload/zip2_extracted"

def http(method, url, data=None, headers=None, timeout=60):
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def jreq(method, url, obj=None, cookie=None, timeout=60):
    data = json.dumps(obj).encode() if obj is not None else None
    h = {"Content-Type": "application/json"}
    if cookie: h["Cookie"] = cookie
    st, body = http(method, url, data, h, timeout)
    try: return st, json.loads(body)
    except Exception: return st, body[:300]

def multipart_upload(filepath, cookie):
    fn = os.path.basename(filepath)
    with open(filepath, "rb") as f: content = f.read()
    b = "----Auto-RH" + str(abs(hash(fn)) % 10**8)
    parts = []
    parts.append(("--%s\r\nContent-Disposition: form-data; name=\"files\"; filename=\"%s\"\r\nContent-Type: application/pdf\r\n\r\n" % (b, fn)).encode())
    parts.append(content)
    parts.append(("\r\n--%s--\r\n" % b).encode())
    body = b"".join(parts)
    h = {"Content-Type": "multipart/form-data; boundary=" + b, "Cookie": cookie}
    return http("POST", BASE + "/api/payslips/upload", body, h, 120)

# ---------- 1) login ----------
st, res = jreq("POST", BASE + "/api/auth/login", {"email": EMAIL, "password": PASSWORD})
if st != 200:
    print("LOGIN FAILED", st, res); sys.exit(1)
cookie = None
st2, me = jreq("GET", BASE + "/api/auth/me")
raw = http("POST", BASE + "/api/auth/login", json.dumps({"email": EMAIL, "password": PASSWORD}).encode(), {"Content-Type": "application/json"})[1]
setcookie = None
req = urllib.request.Request(BASE + "/api/auth/login", data=json.dumps({"email": EMAIL, "password": PASSWORD}).encode(), method="POST")
req.add_header("Content-Type", "application/json")
with urllib.request.urlopen(req, timeout=30) as r:
    setcookie = r.headers.get("Set-Cookie", "").split(";")[0]
print("[1] LOGIN OK, cookie:", setcookie[:40], "...")

# ---------- 2) redetect (ne supprime RIEN, relance juste l'extraction) ----------
st, res = jreq("POST", BASE + "/api/payslips/redetect", {}, setcookie, 300)
print("[2] REDETECT status:", st, "->", (res if isinstance(res, dict) else res))
if isinstance(res, dict) and "updated" in str(res):
    pass

# ---------- 3) import des 20 nouvelles fiches ----------
files = sorted(glob.glob(os.path.join(NEW_DIR, "*.pdf")))
print("[3] IMPORT de %d nouvelles fiches..." % len(files))
ok = fail = 0
for fp in files:
    st, body = multipart_upload(fp, setcookie)
    if st in (200, 201): ok += 1
    else:
        fail += 1
        print("   FAIL", os.path.basename(fp), st, body[:120])
print("    importés: %d OK / %d FAIL" % (ok, fail))

# ---------- 4) vérification : période remplie ? ----------
st, res = jreq("GET", BASE + "/api/payslips?page=1&pageSize=200", None, setcookie, 60)
rows = res.get("payslips") or res.get("data") or []
if isinstance(res, dict) and not rows:
    print("    (clés GET /api/payslips:", list(res.keys())[:8], ")")
new_names = set(os.path.basename(p) for p in files)
n_new = n_new_per = n_old = n_old_per = 0
new_missing = []
for r in rows:
    fn = r.get("fileName", "")
    per = (r.get("period") or "").strip()
    if fn in new_names:
        n_new += 1
        if per: n_new_per += 1
        else: new_missing.append(fn)
    else:
        n_old += 1
        if per: n_old_per += 1
print("[4] VÉRIFICATION PÉRIODE")
print("    nouvelles fiches : %d/%d avec période" % (n_new_per, n_new))
print("    anciennes fiches : %d/%d avec période (régression)" % (n_old_per, n_old))
if new_missing:
    print("    SANS période:", new_missing[:10])

# quelques exemples affichés
shown = 0
for r in rows:
    if r.get("fileName", "") in new_names and shown < 5:
        print("    ex:", r.get("fileName"), "| période:", r.get("period"), "| CIN:", r.get("cin"))
        shown += 1

total = len(rows)
print("[5] TOTAL en base:", total)
sys.exit(0 if (n_new and n_new_per == n_new) else 1)
