#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 64 — TESTS ADMINISTRATION sur COPIE de base (site admin de test port 4200).

Scénario :
  A. Connexion d'un compte dont le mot de passe est EXPIRÉ
     (passwordChangedAt = null) → session courte 15 min + mustChangePassword.
  B. TOUTES les API de données refusent (403 MOT_DE_PASSE_EXPIRE) tant que le
     mot de passe n'est pas changé (aucun contournement serveur).
  C. /api/auth/change-password : changement OBLIGATOIRE accompli (mot de passe
     actuel exigé, nouveau != ancien, >= 8 caractères) → passwordChangedAt remis.
  D. Après changement : /api/auth/me sans flag, API de données à nouveau OK.
  E. L'ancien mot de passe ne fonctionne plus ; le nouveau se connecte sans flag.
  F. Validation des règles : nouveau == actuel refusé ; mot de passe actuel
     incorrect refusé.
"""
import json
import http.cookiejar
import sys
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:4200"
EMAIL = "test64@autorh.local"
ANCIEN = "AncienMot64"
NOUVEAU = "NouveauSolide64"

resultats = []


def check(nom, condition, detail=""):
    resultats.append((nom, bool(condition), detail))
    print(("  [OK]  " if condition else "  [KO]  ") + nom + (("  — " + str(detail)) if (detail and not condition) else ""))


def client_nouveau():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def req(opener, chemin, data=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(BASE + chemin, data=body)
    if body:
        r.add_header("Content-Type", "application/json")
    try:
        with opener.open(r, timeout=20) as rep:
            return rep.status, rep.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


print("=== A. Connexion avec mot de passe EXPIRÉ ===")
op = client_nouveau()
st, rep = req(op, "/api/auth/login", {"email": EMAIL, "password": ANCIEN})
d = json.loads(rep)
check("login 200 (l'identité reste vérifiée)", st == 200, (st, rep))
check("mustChangePassword = true dans la réponse", d.get("mustChangePassword") is True, d)
check("flag présent dans user", d.get("user", {}).get("mustChangePassword") is True, d)

print("=== B. API de données refusées pendant l'expiration ===")
st, rep = req(op, "/api/stats")
check("stats 403", st == 403, (st, rep))
check("code MOT_DE_PASSE_EXPIRE", "MOT_DE_PASSE_EXPIRE" in rep, rep)
st, rep = req(op, "/api/payslips")
check("liste fiches 403", st == 403, (st, rep))
st, rep = req(op, "/api/portal-access")
check("accès portail 403", st == 403, (st, rep))
st, rep = req(op, "/api/users")
check("liste utilisateurs 403", st == 403, (st, rep))
st, rep = req(op, "/api/auth/me")
d = json.loads(rep)
check("/api/auth/me reste accessible avec le flag", st == 200 and d.get("user", {}).get("mustChangePassword") is True, (st, rep))

print("=== C. Changement OBLIGATOIRE du mot de passe ===")
st, rep = req(op, "/api/auth/change-password", {"currentPassword": "FauxMot", "newPassword": NOUVEAU})
check("mot de passe actuel incorrect refusé (401)", st == 401, (st, rep))
st, rep = req(op, "/api/auth/change-password", {"currentPassword": ANCIEN, "newPassword": ANCIEN})
check("nouveau == actuel refusé (400)", st == 400, (st, rep))
st, rep = req(op, "/api/auth/change-password", {"currentPassword": ANCIEN, "newPassword": "court"})
check("nouveau trop court refusé (400)", st == 400, (st, rep))
st, rep = req(op, "/api/auth/change-password", {"currentPassword": ANCIEN, "newPassword": NOUVEAU})
d = json.loads(rep)
check("changement accepté (200)", st == 200, (st, rep))
check("message 15 jours", "15 jours" in d.get("message", ""), d)

print("=== D. Après changement : application débloquée ===")
st, rep = req(op, "/api/auth/me")
d = json.loads(rep)
check("me sans flag", st == 200 and d.get("user", {}).get("mustChangePassword") is False, (st, rep))
st, rep = req(op, "/api/stats")
check("stats 200 de nouveau", st == 200, (st, rep))
st, rep = req(op, "/api/portal-access")
check("accès portail 200 de nouveau", st == 200, (st, rep))

print("=== E. Ancien mot de passe mort, nouveau valable ===")
op2 = client_nouveau()
st, rep = req(op2, "/api/auth/login", {"email": EMAIL, "password": ANCIEN})
check("ancien mot de passe refusé (401)", st == 401, (st, rep))
st, rep = req(op2, "/api/auth/login", {"email": EMAIL, "password": NOUVEAU})
d = json.loads(rep)
check("nouveau mot de passe : connexion SANS changement forcé", st == 200 and d.get("mustChangePassword") is False, (st, rep))

ok = sum(1 for _, c, _ in resultats if c)
ko = len(resultats) - ok
print(f"\nRÉSULTAT ADMIN : {ok}/{len(resultats)} vérifications réussies")
sys.exit(0 if ko == 0 else 1)
