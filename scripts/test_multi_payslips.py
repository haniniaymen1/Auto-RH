#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Test bout-en-bout de la gestion multi-fiches (plusieurs fiches dans 1 PDF)."""
import json, os, sys, urllib.request, urllib.error

BASE = "http://localhost:3000"

def http(method, url, data=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items(): req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e: return e.code, e.read(), e.headers

def upload(filepath, cookie):
    fn = os.path.basename(filepath)
    content = open(filepath, "rb").read()
    b = "----MultiTest123"
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{fn}\"\r\n"
            f"Content-Type: application/pdf\r\n\r\n").encode() + content + f"\r\n--{b}--\r\n".encode()
    st, raw, _ = http("POST", BASE + "/api/payslips/upload", body,
                      {"Content-Type": f"multipart/form-data; boundary={b}", "Cookie": cookie})
    try: return st, json.loads(raw)
    except Exception: return st, raw[:200]

def get_json(url, cookie):
    st, raw, _ = http("GET", BASE + url, None, {"Cookie": cookie})
    return json.loads(raw)

# login
req = urllib.request.Request(BASE + "/api/auth/login",
    data=json.dumps({"email": "it@demo.tn", "password": "demo1234"}).encode(), method="POST")
req.add_header("Content-Type", "application/json")
with urllib.request.urlopen(req, timeout=30) as r:
    cookie = r.headers.get("Set-Cookie", "").split(";")[0]
print("[login] OK")

# nettoyage : supprime les fiches de test d'une exécution précédente (idempotent)
st, raw, _ = http("GET", BASE + "/api/payslips?page=1&pageSize=500", None, {"Cookie": cookie})
for it in (json.loads(raw).get("items") or []):
    if it.get("fileName") in ("fiches_regroupees_test.pdf", "fiche_avec_annexes_test.pdf"):
        http("DELETE", BASE + "/api/payslips/" + it["id"], None, {"Cookie": cookie})
print("[clean] anciennes fiches de test supprimées")

fails = []
# ---------- 1) PDF avec 3 fiches ----------
st, res = upload("/home/z/my-project/upload/fiches_regroupees_test.pdf", cookie)
r0 = (res.get("results") or [{}])[0] if isinstance(res, dict) else {}
created = r0.get("created")
print("\n[1] fiches_regroupees_test.pdf -> HTTP", st, "| created:", created)
print("    message:", r0.get("message"))
for it in (r0.get("items") or []):
    print(f"    page {it['page']}: CIN={it['cin']} | {it['employeeName']} | {it['period']} | {it['netSalary']}")
if st == 200 and created == 3 and len(r0.get("items") or []) == 3: print("    => PASS")
else: fails.append("multi: created != 3"); print("    => FAIL")

# ---------- 2) fiche + annexes (doit rester 1 enregistrement) ----------
st, res = upload("/home/z/my-project/upload/fiche_avec_annexes_test.pdf", cookie)
r1 = (res.get("results") or [{}])[0] if isinstance(res, dict) else {}
created1 = r1.get("created")
print("\n[2] fiche_avec_annexes_test.pdf -> HTTP", st, "| created:", created1, "| (absent = chemin historique)")
print("    message:", r1.get("message"), "| CIN:", r1.get("cin"))
if st == 200 and created1 is None and r1.get("cin") == "07451236": print("    => PASS (comportement historique conservé)")
else: fails.append("annexes: created/cin inattendu"); print("    => FAIL")

# ---------- 3) recherches CIN individuelles ----------
print()
for cin, expect_name in [("DEMO001234", "Amine Ben Salem"), ("DEMO123456", "Sarra Trabelsi")]:
    d = get_json(f"/api/payslips?cin={cin}&limit=50", cookie)
    items = d.get("items") or []
    ok = len(items) >= 1 and any(i.get("employeeName") == expect_name for i in items)
    print(f"[3] recherche CIN {cin} -> {len(items)} résultat(s) | premier: {items[0].get('fileName') if items else '-'}"
          f" => {'PASS' if ok else 'FAIL'}")
    if not ok: fails.append(f"recherche {cin}")

# ---------- 4) redetect : les 3 fiches gardent LEUR CIN ----------
st, raw, _ = http("POST", BASE + "/api/payslips/redetect", b"{}", {"Content-Type": "application/json", "Cookie": cookie}, 300)
red = json.loads(raw)
# groupe par CIN (les 3 enregistrements partagent le MÊME fileName)
multi_cins = sorted(set(d["cin"] for d in red.get("details", []) if d["fileName"] == "fiches_regroupees_test.pdf"))
print(f"\n[4] redetect total={red.get('total')} updated={red.get('updated')} errors={red.get('errors')}")
print("    fiches_regroupees_test.pdf après redetect :", multi_cins)
attendu = sorted(["07451236", "DEMO001234", "DEMO123456"])
if multi_cins == attendu: print("    => PASS (chaque fiche a gardé SON CIN)")
else: fails.append("redetect multi écrasé"); print("    => FAIL attendu", attendu)

# ---------- 5) portail : recherche CIN sur fiche multi ----------
st, raw, _ = http("GET", "http://localhost:3001/api/search?cin=DEMO123456")
por = json.loads(raw)
n = len(por.get("items") or por.get("results") or [])
print(f"\n[5] portail recherche DEMO123456 -> {n} résultat(s) => {'PASS' if n >= 1 else 'FAIL'}")
if n < 1: fails.append("portail multi")

print("\n" + "=" * 60)
print("BILAN:", "TOUT PASS ✅" if not fails else f"ÉCHECS: {fails} ❌")
sys.exit(0 if not fails else 1)
