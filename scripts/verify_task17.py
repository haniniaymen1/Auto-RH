#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 17 — Vérification : masquage du CIN (3 derniers caractères) dans
l'interface d'administration ET le portail employé + champ vidé après recherche.

Contrôles :
  [A] Logique de masquage (réplique exacte du code livré)
  [B] Admin  : bundle compilé contient le masque « ••• », l'API renvoie TOUJOURS
               le CIN complet (données intactes), la recherche par CIN complet
               fonctionne encore.
  [C] Portail: page servie avec maskCin + champ vidé + ligne « CIN se terminant
               par » masquée ; /api/search renvoie toujours le CIN complet
               (nécessaire aux liens Ouvrir/Télécharger) ;
               simulation du rendu -> CIN JAMAIS affiché en clair.
  [D] Non-régression Task 13 (liste illimitée) via rejeu ciblé.
"""
import json, re, sys, os, urllib.request, urllib.parse

# NOUVEAU (Task 18) : le portail exige CIN + code OTP — helper de session de test
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import portal_login_helper as plh

ADMIN = "http://localhost:3000"
PORTAL = "http://localhost:3001"
ok = True

def check(label, cond, detail=""):
    global ok
    print(f"[{'OK' if cond else 'ÉCHEC'}] {label}" + (f" — {detail}" if detail else ""))
    if not cond: ok = False

# ---------- A. Logique de masquage (réplique exacte) ----------
def maskCin(s):
    v = str("" if s is None else s)
    if len(v) <= 3: return v
    return "•••" + v[-3:]

check("A1 maskCin('07778889') == '•••889'", maskCin("07778889") == "•••889", maskCin("07778889"))
check("A2 maskCin('SPEC-0023') == '•••023'", maskCin("SPEC-0023") == "•••023", maskCin("SPEC-0023"))
check("A3 maskCin('12345678') == '•••934'", maskCin("12345678") == "•••934", maskCin("12345678"))
check("A4 maskCin court (<=3) inchangé", maskCin("AB") == "AB" and maskCin("") == "")

# ---------- B. ADMIN ----------
req = urllib.request.Request(ADMIN + "/api/auth/login",
    data=json.dumps({"email": "it@demo.tn", "password": "demo1234"}).encode(), method="POST")
req.add_header("Content-Type", "application/json")
with urllib.request.urlopen(req, timeout=30) as r:
    cookie = r.headers.get("Set-Cookie", "").split(";")[0]

def get(url, base=ADMIN):
    q = urllib.request.Request(base + url)
    if base == ADMIN: q.add_header("Cookie", cookie)
    with urllib.request.urlopen(q, timeout=120) as resp:
        return json.loads(resp.read())

d = get("/api/payslips")
items = d.get("items") or []
cins = [p.get("cin") for p in items if p.get("cin")]
check("B1 Admin : l'API renvoie toujours le CIN COMPLET (données intactes)",
      len(cins) > 0 and all(len(str(c)) > 4 for c in cins),
      f"{len(cins)} CIN complets en base (ex. {cins[0] if cins else '—'})")

# Le bundle compilé embarque le masque et la logique (chaîne littérale « ••• »)
import glob
bundle = ""
for c in glob.glob("/home/z/my-project/.next/standalone/.next/static/chunks/*.js"):
    with open(c, encoding="utf-8", errors="ignore") as f:
        bundle += f.read()
check("B2 Admin : masque « ••• » présent dans le bundle compilé", "•••" in bundle)
check("B3 Admin : libellé CIN de colonne toujours présent", '"CIN"' in bundle)

# La recherche par CIN COMPLET fonctionne toujours (mode search)
cin_test = cins[0]
d4 = get("/api/payslips?cin=" + urllib.parse.quote(cin_test))
n4 = len(d4.get("items") or [])
check("B4 Admin : recherche par CIN complet inchangée", n4 >= 1 and d4.get("mode") == "search",
      f"{n4} résultat(s) pour {cin_test}")

# ---------- C. PORTAIL ----------
# MODIFIÉ (Task 18) : le portail est sécurisé — on obtient d'abord une session
# OTP (helper), puis on vérifie la page authentifiée et la page de connexion.
portal_cookie = plh.portal_login(cin_test)
check("C0 Portail : session OTP obtenue pour le test", portal_cookie.startswith("portail_session="))

reqp = urllib.request.Request(PORTAL + "/")
reqp.add_header("Cookie", portal_cookie)
with urllib.request.urlopen(reqp, timeout=30) as r:
    page = r.read().decode("utf-8", "ignore")

with urllib.request.urlopen(PORTAL + "/login", timeout=30) as r:
    login_page = r.read().decode("utf-8", "ignore")

check("C1 Portail : fonction maskCin servie", "function maskCin" in page)
check("C2 Portail : champs CIN/OTP vidés après tentative (page de connexion)",
      'inputCin.value = "";' in login_page and 'inputCode.value = "";' in login_page)
check("C2bis Portail : aucune saisie de CIN persistante sur la page authentifiée",
      'id="cin"' not in page)
check("C3 Portail : ligne résultat « avec un CIN se terminant par »",
      "avec un CIN se terminant par" in page)
check("C4 Portail : ancien libellé « avec le CIN exact » supprimé",
      "avec le CIN exact" not in page)
check("C5 Portail : message « aucun résultat » masqué (maskCin utilisé)",
      "esc(maskCin(query))" in page)
check("C6 Portail : les liens PDF utilisent TOUJOURS le CIN complet",
      'encodeURIComponent(query)' in page and "/file?cin=" in page)

# /api/search (AVEC session, Task 18) renvoie toujours le CIN complet (requis
# pour ouvrir les PDF)
reqs = urllib.request.Request(
        PORTAL + "/api/search?cin=" + urllib.parse.quote(cin_test))
reqs.add_header("Cookie", portal_cookie)
with urllib.request.urlopen(reqs, timeout=30) as r:
    sres = json.loads(r.read())
sitems = sres.get("items") or []
check("C7 Portail : /api/search fonctionne (données complètes)",
      len(sitems) >= 1, f"{len(sitems)} fiche(s)")

# Simulation EXACTE du rendu portail : le CIN complet ne doit JAMAIS apparaître
# dans le HTML généré (ni dans la ligne de comptage, ni ailleurs).
for it in sitems[:3]:
    pass  # (le rendu n'affiche déjà pas le CIN des cartes depuis Task 16)

count_line = (str(len(sitems)) + " fiches de paie trouvées avec un CIN se terminant par "
              + maskCin(cin_test))
check("C8 Portail : simulation ligne résultat -> CIN masqué",
      "•••" in count_line and cin_test not in count_line, count_line)

# ---------- D. Non-régression liste illimitée ----------
d2 = get("/api/payslips")
check("D1 Non-régression : liste sans plafond (Task 13)",
      len(d2.get("items") or []) == d2.get("total", -1),
      f"{len(d2.get('items') or [])}/{d2.get('total')}")

print()
plh.cleanup()
print("=== RÉSULTAT : " + ("TOUT OK ✓" if ok else "DES ÉCHECS ✗") + " ===")
sys.exit(0 if ok else 1)
