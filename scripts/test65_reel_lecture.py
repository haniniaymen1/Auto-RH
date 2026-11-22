#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 65 — vérification E2E LECTURE SEULE sur le serveur RÉEL (port 4000) :
connexion IT de démonstration puis GET /api/payslips/employes.
Aucune écriture : la création d'accès est testée sur COPIE (test65_remplissage_auto.py).
"""
import json
import http.cookiejar
import sys
import urllib.request
import urllib.error

BASE = "http://localhost:4000"

resultats = []


def check(nom, condition, detail=""):
    resultats.append((nom, bool(condition), detail))
    print(("  [OK]  " if condition else "  [KO]  ") + nom + (("  — " + str(detail)) if (detail and not condition) else ""))


cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def req(chemin, data=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(BASE + chemin, data=body)
    if body:
        r.add_header("Content-Type", "application/json")
    try:
        with op.open(r, timeout=25) as rep:
            return rep.status, rep.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


print("=== Connexion IT de démonstration (réel 4000) ===")
st, rep = req("/api/auth/login", {"email": "it@demo.tn", "password": "demo1234"})
check("login 200", st == 200, (st, rep[:200]))
d = json.loads(rep) if rep else {}
check("aucun changement forcé attendu (compte démo récent)", d.get("mustChangePassword") is False, d)

print("=== GET /api/payslips/employes (nouvelle API Task 65) ===")
st, rep = req("/api/payslips/employes")
check("statut 200", st == 200, (st, rep[:300]))
d = json.loads(rep) if rep else {}
items = d.get("items", [])
check("total cohérent avec la liste renvoyée", d.get("total") == len(items), (d.get("total"), len(items)))
check("au moins un employé détecté (20 fiches de démonstration)", len(items) >= 1, len(items))
cin_valide = all(
    isinstance(i.get("cin"), str) and i["cin"] and isinstance(i.get("fiches"), int) and i["fiches"] >= 1
    for i in items
)
check("structure des éléments (cin + fiches >= 1)", cin_valide, items[:2])
douchette = [i for i in items if i.get("cinAffiche") and i.get("cin")]
check("cinAffiche présent (forme détectée)", len(douchette) >= 1, len(douchette))
noms = [i for i in items if i.get("nom")]
check("noms d'employés associés quand détectés", len(noms) >= 1, len(noms))
# Dédoublonnage : pas de CIN normalisé en double
cles = [i["cin"] for i in items]
check("aucun doublon de CIN normalisé", len(cles) == len(set(cles)), len(cles) - len(set(cles)))

ok = sum(1 for _, c, _ in resultats if c)
ko = len(resultats) - ok
print(f"\nRÉSULTAT RÉEL (lecture seule) : {ok}/{len(resultats)} vérifications réussies")
sys.exit(0 if ko == 0 else 1)
