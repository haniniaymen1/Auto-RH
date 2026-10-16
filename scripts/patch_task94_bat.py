#!/usr/bin/env python3
"""Task 94 — mention de la politique de complexité dans l'en-tête du
SECURISER-INSCRIPTION-WINDOWS.bat (ASCII pur + CRLF préservés, idempotent)."""
import os

BAT = "/home/z/my-project/SECURISER-INSCRIPTION-WINDOWS.bat"
data = open(BAT, "rb").read()

assert b"\r\n" in data, "CRLF attendu"
marque = b"REM        hash scrypt (plus aucun code en clair dans .env) ;"
if b"Task 94 : 8 caracteres minimum" in data:
    print("Deja patche — rien a faire.")
    raise SystemExit(0)

ajout = (
    b"REM        (Task 94 : 8 caracteres minimum avec minuscule, majuscule,\r\n"
    b"REM        chiffre et symbole - un code plus faible est refuse) ;\r\n"
)
assert data.count(marque) == 1, "marque introuvable ou ambigu"
data = data.replace(marque, marque + b"\r\n" + ajout.rstrip(b"\r\n"))

# Ligne option 3 : precise la meme regle
old3 = b"REM     3) choisir votre propre code (hash, saisie masquee) ;"
new3 = (
    b"REM     3) choisir votre propre code (hash, saisie masquee ; meme\r\n"
    b"REM        regle Task 94 : 8 caracteres minimum, minuscule, majuscule,\r\n"
    b"REM        chiffre et symbole) ;"
)
assert data.count(old3) == 1, "ligne option 3 introuvable"
data = data.replace(old3, new3)

open(BAT, "wb").write(data)

# Vérifications
verif = open(BAT, "rb").read()
assert b"\r\n" in verif and verif.count(b"\r\n") >= 30
assert b"TESTER un code" in verif
verif.decode("ascii")  # ASCII pur sinon exception
print("BAT patche : ASCII OK, CRLF OK, TESTER un code present, mention Task 94 ajoutee.")
