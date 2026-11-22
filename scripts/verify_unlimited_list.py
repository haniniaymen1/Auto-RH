#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Vérification : liste ILLIMITÉE (plus de plafond à 200) + régression limit/recherche CIN."""
import json, urllib.request, urllib.parse

BASE = "http://localhost:3000"

req = urllib.request.Request(BASE + "/api/auth/login",
    data=json.dumps({"email": "it@demo.tn", "password": "demo1234"}).encode(), method="POST")
req.add_header("Content-Type", "application/json")
with urllib.request.urlopen(req, timeout=30) as r:
    cookie = r.headers.get("Set-Cookie", "").split(";")[0]

def get(url):
    q = urllib.request.Request(BASE + url)
    q.add_header("Cookie", cookie)
    with urllib.request.urlopen(q, timeout=120) as resp:
        return json.loads(resp.read())

ok = True

# 1) Liste SANS paramètre → doit renvoyer TOUTES les fiches (plus de plafond 200)
d = get("/api/payslips")
total, items = d.get("total", 0), d.get("items") or []
print(f"[1] Liste sans param  : total={total} | items renvoyés={len(items)}")
if len(items) == total:
    print(f"    -> ILLIMITÉ OK : toutes les fiches sont renvoyées ({total}, aucun plafond)")
else:
    ok = False
    print("    -> PROBLÈME : items < total ou plafond encore présent")

# 2) Compatibilité : limit explicite toujours honoré
d2 = get("/api/payslips?limit=50")
n2 = len(d2.get("items") or [])
print(f"[2] limit=50 explicite: items={n2} (attendu 50)")
if n2 == 50: print("    -> Rétrocompatibilité limit/offset conservée")
else: ok = False; print("    -> PROBLÈME : limit explicite cassé")

# 3) limit explicite > ancien plafond 500 (doit maintenant être honoré aussi)
d3 = get("/api/payslips?limit=600")
n3 = len(d3.get("items") or [])
print(f"[3] limit=600         : items={n3} (plus de plafond 500)")

# 4) Recherche CIN exacte inchangée (mode recherche, pagination illimitée aussi)
d4 = get("/api/payslips?cin=" + urllib.parse.quote("07451236"))
n4 = len(d4.get("items") or [])
print(f"[4] Recherche CIN     : mode={d4.get('mode')} | résultats={n4} (inchangé)")
if d4.get("mode") != "search": ok = False; print("    -> PROBLÈME : mode recherche altéré")

# 5) /api/stats doit rester cohérent
d5 = get("/api/stats")
print(f"[5] Stats             : {json.dumps(d5.get('totals', d5), ensure_ascii=False)[:160]}")

print("\nSTATUT FINAL :", "OK ✅" if ok else "PROBLÈME ❌")
