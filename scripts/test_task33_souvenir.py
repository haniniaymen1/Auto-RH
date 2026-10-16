#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 33 — « Se souvenir de moi » du portail employé — FONCTIONNALITÉ CONSERVÉE.

(MODIFIÉ Task 64, 18/09/2026) : la connexion du portail se fait désormais par
CIN + MOT DE PASSE (plus de code OTP) et le mot de passe EXPIRE TOUS LES
15 JOURS. L'ancien scénario complet de ce test reposait sur la création d'un
secret TOTP via l'API d'administration (« action: generate », supprimée) et la
génération de codes RFC 6238 : il n'est plus applicable.

La case « Se souvenir de moi » reste pleinement fonctionnelle (session longue
signée, Task 33) et est réutilisée par la connexion par mot de passe. La
couverture E2E complète du portail (connexion, changement obligatoire,
expiration 15 jours, verrouillage, sessions) est assurée par :
    scripts/test64_portail.py   (29 vérifications, sur COPIE de base)

Ce script conserve 4 vérifications triviales en direct (portail servi, absence
du champ code OTP, présence du champ mot de passe, case « Se souvenir de moi »
toujours proposée). Prérequis : portail démarré (port 4001).
"""
import sys
import urllib.request
import urllib.error

PORTAIL = "http://localhost:4001"

OK = 0
FAIL = 0


def check(nom, cond, detail=""):
    global OK, FAIL
    if cond:
        OK += 1
        print(f"  [OK]  {nom}")
    else:
        FAIL += 1
        print(f"  [KO]  {nom} — {detail}")


def page(url):
    try:
        with urllib.request.urlopen(url, timeout=15) as rep:
            return rep.status, rep.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def main():
    print("TASK 33 (mise en cohérence Task 64) — « Se souvenir de moi » conservé")
    st, html = page(PORTAIL + "/")
    check("portail servi (4001)", st == 200, st)
    check("case « Se souvenir de moi » toujours proposée",
          'id="remember"' in html and "Se souvenir de moi" in html)
    check("connexion par MOT DE PASSE (plus de code OTP)",
          'type="password" id="password"' in html and 'id="code"' not in html)
    check("aucun one-time-code", "one-time-code" not in html)
    print(f"\n==== RÉSULTAT : {OK} OK / {FAIL} ÉCHEC(S) ====")
    print("(couverture complète : scripts/test64_portail.py)")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
