#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Vérification finale V3 : périodes des 20 nouvelles + régression anciennes + recherche CIN."""
import json, os, sys, urllib.request, urllib.error

BASE = "http://localhost:3000"
NEW_DIR = "/home/z/my-project/upload/zip2_extracted"

req = urllib.request.Request(BASE + "/api/auth/login",
    data=json.dumps({"email": "it@demo.tn", "password": "demo1234"}).encode(), method="POST")
req.add_header("Content-Type", "application/json")
with urllib.request.urlopen(req, timeout=30) as r:
    cookie = r.headers.get("Set-Cookie", "").split(";")[0]

def get(url):
    r = urllib.request.Request(BASE + url)
    r.add_header("Cookie", cookie)
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.loads(resp.read())

data = get("/api/payslips?page=1&pageSize=500")
rows = data.get("items") or []
new_names = set(os.path.basename(p) for p in
    __import__("glob").glob(os.path.join(NEW_DIR, "*.pdf")))

n_new = n_new_per = n_new_nom = n_old = n_old_per = 0
missing = []
for r in rows:
    fn, per, nom = r.get("fileName",""), (r.get("period") or "").strip(), (r.get("employeeName") or "").strip()
    if fn in new_names:
        n_new += 1
        if per: n_new_per += 1
        else: missing.append(fn)
        if nom: n_new_nom += 1
    else:
        n_old += 1
        if per: n_old_per += 1

print("TOTAL en base :", len(rows))
print("NOUVELLES fiches   : %d importées | période %d/%d | employé %d/%d" % (n_new, n_new_per, n_new, n_new_nom, n_new))
print("ANCIENNES fiches   : %d | période %d/%d (régression)" % (n_old, n_old_per, n_old))
if missing: print("SANS période:", missing)

print("\nExemples nouvelles fiches :")
shown = 0
for r in rows:
    if r.get("fileName","") in new_names and shown < 5:
        print("  ", r.get("fileName"), "| P:", r.get("period"), "| CIN:", r.get("cin"), "|", r.get("employeeName"), "|", r.get("netSalary"))
        shown += 1

# Test de recherche exacte CIN sur une nouvelle fiche (Jean Dupont CIN 18504751)
q = "18504751"
res = get("/api/payslips?cin=" + q + "&limit=50")
lst = res.get("items") or res.get("results") or []
print("\nRecherche CIN %s -> %d résultat(s)" % (q, len(lst)))
for x in lst[:3]:
    print("  ", x.get("fileName"), "| P:", x.get("period"), "| Net:", x.get("netSalary"))

ok = (n_new == 20 and n_new_per == 20 and n_old == n_old_per)
print("\nSTATUT FINAL :", "OK ✅" if ok else "PROBLÈME ❌")
sys.exit(0 if ok else 1)
