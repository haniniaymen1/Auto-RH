#!/usr/bin/env python3
"""Task 91 : DEMARRER-WINDOWS.bat — plus aucun code d'inscription en clair.
Préserve STRICTEMENT les fins de ligne CRLF (contrôlées par test89)."""
import sys

P = "/home/z/my-project/DEMARRER-WINDOWS.bat"
data = open(P, "rb").read()
if b"\r\n" not in data:
    print("ECHEC : le .bat n'a pas de CRLF ?!")
    sys.exit(1)

texte = data.decode("utf-8")

REMPLACEMENTS = [
    (
        "REM AUTH_SECRET (signature des sessions) et SIGNUP_CODE (code d'activation des\r\n"
        "REM inscriptions) sont CONSERVES s'ils existent deja, sinon ils sont crees.\r\n",
        "REM AUTH_SECRET (signature des sessions) est CONSERVE s'il existe deja, sinon\r\n"
        "REM il est cree. Le code d'inscription n'est JAMAIS ecrit en clair dans .env\r\n"
        "REM (Task 91) : il est converti en hash / genere en hash par --assurer.\r\n",
    ),
    (
        "REM Task 31 : si AUCUN code d'inscription n'est configure (ni code ni hash ni\r\n"
        "REM desactivation), un code ALEATOIRE est cree (plus de defaut fixe connu de tous)\r\n"
        "REM et affiche UNE FOIS ; sinon RIEN ne change.\r\n",
        "REM Task 31 + 91 : le code d'inscription n'est JAMAIS stocke en clair dans .env.\r\n"
        "REM - un ancien SIGNUP_CODE=... en clair est CONVERTI automatiquement en hash\r\n"
        "REM   (le code ne change pas, il n'est juste plus lisible) ;\r\n"
        "REM - si aucun code n'existe, un code ALEATOIRE est cree, stocke UNIQUEMENT en\r\n"
        "REM   hash et affiche UNE SEULE FOIS ; sinon RIEN ne change.\r\n",
    ),
    (
        "echo [2/5] Base de donnees et securite configurees (code d'inscription : voir .env)\r\n",
        "echo [2/5] Base de donnees et securite configurees (code d'inscription : stocke en HASH, jamais en clair)\r\n",
    ),
]

ok = True
for ancien, nouveau in REMPLACEMENTS:
    if ancien not in texte:
        print("ECHEC : bloc introuvable ->", ancien.splitlines()[0][:70])
        ok = False
        continue
    texte = texte.replace(ancien, nouveau)

if not ok:
    sys.exit(1)
open(P, "wb").write(texte.encode("utf-8"))

# Contrôle final : CRLF intacts
verif = open(P, "rb").read()
n_lf_seuls = verif.replace(b"\r\n", b"").count(b"\n")
print("OK DEMARRER-WINDOWS.bat patche ; CRLF intacts :", n_lf_seuls == 0,
      "(marche pas : " + str(verif.count(b"\r\n")) + " lignes)")
