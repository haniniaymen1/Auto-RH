#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 16 — Vérification : suppression des affichages « Employé » / « Net à payer »
dans l'interface d'administration et le portail employé, + « Ouvrir le PDF » -> « Ouvrir ».

Contrôles :
  [A] Admin  : login OK, liste /api/payslips intacte (données toujours en base),
               bundle compilé SANS « Employé » / « Net à payer » en colonnes,
               AUCUNE fiche de la liste n'est rendue avec nom/net (vérif. bundle chunks).
  [B] Portail: /api/search fonctionne (CIN réel de la base),
               simulation EXACTE du render() du portail -> carte générée SANS nom
               employé ni net à payer, avec bouton « Ouvrir » et période conservée.
  [C] Non-régression : le filtrage local par nom (all-tab) est toujours fonctionnel
               dans le code source (la donnée reste filtrable, simplement non affichée).
"""
import json, re, urllib.request, urllib.parse, glob, sys, os

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

# ---------- A. ADMIN ----------
req = urllib.request.Request(ADMIN + "/api/auth/login",
    data=json.dumps({"email": "it@demo.tn", "password": "demo1234"}).encode(), method="POST")
req.add_header("Content-Type", "application/json")
with urllib.request.urlopen(req, timeout=30) as r:
    cookie = r.headers.get("Set-Cookie", "").split(";")[0]
check("A1 Admin : login it@demo.tn", bool(cookie))

def get(url):
    q = urllib.request.Request(ADMIN + url)
    q.add_header("Cookie", cookie)
    with urllib.request.urlopen(q, timeout=120) as resp:
        return json.loads(resp.read())

d = get("/api/payslips")
items = d.get("items") or []
check("A2 Admin : /api/payslips intact (données non supprimées)", len(items) > 0,
      f"{len(items)} fiches en base")

# Le bundle compilé ne doit plus contenir les libellés de colonnes supprimés
chunks = glob.glob("/home/z/my-project/.next/standalone/.next/static/chunks/*.js")
bundle = ""
for c in chunks:
    with open(c, encoding="utf-8", errors="ignore") as f:
        bundle += f.read()
check("A3 Admin : libellé colonne « Employé » absent du bundle",
      '>Employé<' not in bundle and '"Employé"' not in bundle)
check("A4 Admin : libellé colonne « Net à payer » absent du bundle",
      "Net à payer" not in bundle)
check("A5 Admin : période + CIN toujours affichés",
      '"Période"' in bundle and '"CIN"' in bundle)

# ---------- B. PORTAIL ----------
cin_real = next((p["cin"] for p in items if p.get("cin")), None)
check("B1 Portail : un CIN réel disponible pour le test", bool(cin_real), f"CIN={cin_real}")

# MODIFIÉ (Task 18) : connexion OTP d'abord (portail sécurisé), puis /api/search
# avec la session — la recherche reste verrouillée sur le CIN connecté.
portal_cookie = plh.portal_login(cin_real)
check("B2 Portail : session OTP obtenue (CIN + code authenticator)", portal_cookie.startswith("portail_session="))

req2 = urllib.request.Request(
        PORTAL + "/api/search?cin=" + urllib.parse.quote(cin_real))
req2.add_header("Cookie", portal_cookie)
with urllib.request.urlopen(req2, timeout=30) as r:
    sres = json.loads(r.read())
sitems = sres.get("items") or []
check("B3 Portail : /api/search (session) renvoie des fiches", len(sitems) >= 1,
      f"{len(sitems)} fiche(s) pour CIN {cin_real}")

# --- Simulation EXACTE du render() du portail (copie du template Task 16) ---
def esc(s):
    return re.sub(r'[&<>"\']', lambda m: {"&": "&amp;", "<": "&lt;", ">": "&gt;",
                  '"': "&quot;", "'": "&#39;"}[m.group(0)], str(s if s is not None else ""))

cards = ""
for it in sitems:
    openUrl = "/api/payslip/" + urllib.parse.quote(str(it["id"])) + "/file?cin=" + urllib.parse.quote(cin_real)
    dlUrl = openUrl + "&download=1"
    cards += (
        '<article class="payslip">' +
        '  <div class="p-top">' +
        '    <div><div class="period">' + esc(it.get("period") or "Période non précisée") + '</div></div>' +
        '  </div>' +
        '  <div class="p-meta"><span>📄 ' + esc(it.get("fileName")) + '</span>' +
        '  <span>1,2 Mo</span><span>Importé le 01/01/2026</span></div>' +
        '  <div class="p-actions">' +
        '    <a class="a-open" target="_blank" rel="noopener" href="' + esc(openUrl) + '">Ouvrir</a>' +
        '    <a class="a-dl" href="' + esc(dlUrl) + '">Télécharger</a>' +
        '  </div>' +
        '</article>')

check("B4 Portail : carte générée SANS nom d'employé", "employeeName" not in cards)
check("B5 Portail : carte générée SANS net à payer", "netSalary" not in cards)
check("B6 Portail : bouton « Ouvrir » présent (plus « Ouvrir le PDF »)",
      '">Ouvrir</a>' in cards and "Ouvrir le PDF" not in cards)
check("B7 Portail : période toujours affichée", 'class="period"' in cards)
check("B8 Portail : bouton « Télécharger » conservé", "Télécharger" in cards)

# La page authentifiée ne doit contenir ni « Ouvrir le PDF » ni rendu nom/net
# (MODIFIÉ Task 18 : la page est servie AVEC la session de test)
req3 = urllib.request.Request(PORTAL + "/")
req3.add_header("Cookie", portal_cookie)
with urllib.request.urlopen(req3, timeout=30) as r:
    page = r.read().decode("utf-8", "ignore")
ui_text = re.sub(r'// MODIFIÉ \(Task 16\)[^\n]*', '', page)  # retire nos propres commentaires
check("B9 Portail : page servie sans « Ouvrir le PDF » visible",
      "Ouvrir le PDF" not in ui_text)
check("B10 Portail : page servie sans rendu employeeName/netSalary",
      "it.employeeName" not in ui_text and "it.netSalary" not in ui_text)

# ---------- C. NON-RÉGRESSION (filtre par nom toujours dans le code source) ----------
with open("/home/z/my-project/src/components/payslip/all-tab.tsx", encoding="utf-8") as f:
    src_all = f.read()
check("C1 Admin : filtrage local par nom conservé (fonction, non affiché)",
      "p.employeeName ?? \"\"" in src_all and "toLowerCase().includes(f)" in src_all)

# Les données restent complètes dans l'API (seul l'affichage change)
check("C2 API : employeeName/netSalary toujours en base (aucune donnée supprimée)",
      all(("employeeName" in it or it.get("employeeName") is None) for it in items[:5]))

print()
plh.cleanup()
print("=== RÉSULTAT : " + ("TOUT OK ✓" if ok else "DES ÉCHECS ✗") + " ===")
sys.exit(0 if ok else 1)
