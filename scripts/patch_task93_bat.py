#!/usr/bin/env python3
"""Task 93 — met à jour SECURISER-INSCRIPTION-WINDOWS.bat (option 7 « Tester un
code ») en préservant STRICTEMENT CRLF + ASCII pur (invariants Task 38/40)."""
import sys

BAT = "/home/z/my-project/SECURISER-INSCRIPTION-WINDOWS.bat"

AVANT = (
    b"REM     5) reactiver l'inscription ;\r\n"
    b"REM     6) restreindre l'acces au fichier .env (permissions).\r\n"
)
APRES = (
    b"REM     5) reactiver l'inscription ;\r\n"
    b"REM     6) restreindre l'acces au fichier .env (permissions) ;\r\n"
    b"REM     7) TESTER un code : savoir s'il est le BON (diagnostic -\r\n"
    b"REM        Task 93 : le site refuse mon code, ni l'initial ni le\r\n"
    b"REM        nouveau ne fonctionne - l'option dit POURQUOI).\r\n"
)

with open(BAT, "rb") as f:
    brut = f.read()

if APRES in brut and AVANT not in brut:
    print("Deja a jour (idempotent).")
    sys.exit(0)
if AVANT not in brut:
    print("ECHEC : bloc attendu introuvable dans le .bat")
    sys.exit(1)

modifie = brut.replace(AVANT, APRES, 1)

# Invariants absolus
assert b"\n" not in modifie.replace(b"\r\n", b""), "LF orphelin detecte"
assert all(b < 128 for b in modifie), "caractere non-ASCII detecte"

with open(BAT, "wb") as f:
    f.write(modifie)

print("OK : SECURISER-INSCRIPTION-WINDOWS.bat mis a jour (option 7, CRLF + ASCII intacts,")
print(f"     {modifie.count(bytes([13, 10]))} lignes CRLF, {len(modifie)} octets).")
