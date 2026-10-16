#!/usr/bin/env python3
"""Task 37 : AUCUN historique de saisie dans tout le projet.

(MODIFIÉ Task 66 — « champ de mot de passe mauvais » : les champs de
CONNEXION passent de "new-password" à "current-password" car "new-password"
fait PRÉ-REMPLIR le champ par le navigateur avec un mot de passe GÉNÉRÉ
faux ; "current-password" fait PROPOSER le mot de passe enregistré. Les
champs de CRÉATION de mot de passe restent en "new-password".)

L'historique de saisie du navigateur (suggestions des valeurs déjà tapées)
reste désactivé sur TOUS les champs :

  A. Administration (vérification des fichiers sources, identiques dans le
     ZIP livré — les pages /login et /signup rendent leur formulaire CÔTÉ
     CLIENT, le HTML servi ne contient donc pas le formulaire) :
       - src/components/ui/input.tsx  : autoComplete="off" PAR DÉFAUT ;
       - src/app/login/page.tsx       : email "off" + mot de passe
         "current-password" (Task 66 : propose le mot de passe enregistré,
         ne génère plus un faux), AUCUN "new-password" ni
         autocomplete="email" ;
       - src/app/signup/page.tsx      : idem + mots de passe "new-password"
         (CRÉATION : signal correct).
  B. Portail (HTML servi, test en direct) : form + CIN = "off" ; mot de
     passe de connexion = "current-password" (Task 66) ; AUCUN "username"
     ni "one-time-code".
  C. Régressions : pages servies + connexion administration fonctionnelle.
"""
import json
import os
import sys
import urllib.error
import urllib.request
import http.cookiejar

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
resultats = []


def check(libelle, ok, detail=""):
    resultats.append(ok)
    print(("OK " if ok else "KO ") + libelle + ((" — " + str(detail)[:120]) if detail else ""))


def page(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "task37-test"})
    with urllib.request.urlopen(req, timeout=timeout) as rep:
        return rep.status, rep.read().decode("utf-8", errors="replace")


def lire(chemin):
    with open(os.path.join(BASE, chemin), encoding="utf-8") as f:
        return f.read()


# ---- A. Administration : fichiers sources ----
input_tsx = lire("src/components/ui/input.tsx")
check("Input : autoComplete=off PAR DÉFAUT (tous les champs)",
      'autoComplete="off"' in input_tsx and "...props" in input_tsx)
check("Input : aucun historique autorisé par défaut",
      'autoComplete="off"' in input_tsx.split("{...props}")[0])

login_tsx = lire("src/app/login/page.tsx")
check("login : email sans historique (off)", 'autoComplete="off"' in login_tsx)
check("login : mot de passe current-password (Task 66 : propose le mot de passe enregistré)",
      'autoComplete="current-password"' in login_tsx)
check("login : AUCUN autocomplete=email", 'autoComplete="email"' not in login_tsx)
check("login : AUCUN new-password (Task 66 : ne plus faire GÉNÉRER un mot de passe à la connexion)",
      'autoComplete="new-password"' not in login_tsx)
check("login : form autocomplete=off", '<form onSubmit={onSubmit} className="space-y-4" autoComplete="off">' in login_tsx)

signup_tsx = lire("src/app/signup/page.tsx")
check("signup : email sans historique (off)", 'autoComplete="off"' in signup_tsx)
check("signup : AUCUN autocomplete=email", 'autoComplete="email"' not in signup_tsx)
check("signup : mots de passe new-password", signup_tsx.count('autoComplete="new-password"') >= 2)

# ---- B. Portail : HTML servi en direct ----
# (MODIFIÉ Task 64 : le champ code OTP est remplacé par un champ MOT DE PASSE)
st, html = page("http://localhost:4001/")
check("page portail servie", st == 200, f"{st}")
check("portail : form autocomplete=off", 'autocomplete="off"' in html)
check("portail : CIN sans historique", html.count('autocomplete="off"') >= 2)
check("portail : mot de passe en current-password (Task 66 : propose le mot de passe enregistré)",
      'type="password" id="password"' in html and 'autocomplete="current-password"' in html)
check("portail : AUCUN autocomplete=username", 'autocomplete="username"' not in html)
check("(MODIFIÉ Task 82/83) champ Code OTP en one-time-code sur la connexion", "one-time-code" in html and 'id="otp" name="otp"' in html)

# ---- C. Régressions ----
st, _ = page("http://localhost:4000/login")
check("page /login servie", st == 200, f"{st}")
st, _ = page("http://localhost:4000/signup")
check("page /signup servie", st == 200, f"{st}")

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
req = urllib.request.Request(
    "http://localhost:4000/api/auth/login",
    data=json.dumps({"email": "it@demo.tn", "password": "demo1234", "remember": False}).encode(),
    method="POST", headers={"Content-Type": "application/json"},
)
try:
    with opener.open(req, timeout=30) as rep:
        st = rep.status
except urllib.error.HTTPError as e:
    st = e.code
check("connexion IT fonctionne toujours", st == 200, f"{st}")

total_ok = sum(resultats)
print(f"TASK37: {total_ok}/{len(resultats)} vérifications OK")
sys.exit(0 if all(resultats) else 1)
