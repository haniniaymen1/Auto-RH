#!/usr/bin/env python3
"""Task 92 — les scripts de démarrage qui installent/buildent l'ADMIN vérifient
désormais AUSSI la présence de nodemailer (service « Send Mail ») : un
node_modules issu d'une installation ANCIENNE (sans nodemailer) relance
npm install automatiquement. .bat traités en OCTETS (CRLF intacts, ASCII)."""
import os

BASE = "/home/z/my-project"

# --- .sh (LF) ---
SH = {
    "DEMARRER-LINUX-MAC.sh": (
        'if [ ! -d "node_modules" ] || [ ! -f "node_modules/prisma/build/index.js" ] || [ ! -f "node_modules/next/dist/bin/next" ]; then',
        'if [ ! -d "node_modules" ] || [ ! -f "node_modules/prisma/build/index.js" ] || [ ! -f "node_modules/next/dist/bin/next" ] || [ ! -f "node_modules/nodemailer/package.json" ]; then  # (MODIFIE Task 92 : nodemailer pour le service Send Mail)',
    ),
    "DEMARRER-TOUT-LINUX-MAC.sh": (
        'if [ ! -d "node_modules" ] || [ ! -f "node_modules/prisma/build/index.js" ]; then',
        'if [ ! -d "node_modules" ] || [ ! -f "node_modules/prisma/build/index.js" ] || [ ! -f "node_modules/nodemailer/package.json" ]; then  # (MODIFIE Task 92 : nodemailer pour le service Send Mail)',
    ),
}
for nom, (avant, apres) in SH.items():
    p = os.path.join(BASE, nom)
    src = open(p, encoding="utf-8").read()
    if apres in src:
        print(f"OK {nom} : deja a jour")
        continue
    if avant not in src:
        print(f"ECHEC {nom} : motif introuvable")
        raise SystemExit(1)
    open(p, "w", encoding="utf-8").write(src.replace(avant, apres, 1))
    print(f"OK {nom} : verification nodemailer ajoutee")

# --- .bat (CRLF, ASCII) — traités en OCTETS ---
BAT = ["PREPARER-AUTO-RH-SILENCIEUX.bat", "DEMARRER-WINDOWS.bat"]
MOTIF = b'if not exist "node_modules\\next\\dist\\bin\\next" set "BESOIN_INSTALL=1"'
AJOUT = (
    b'if not exist "node_modules\\nodemailer\\package.json" set "BESOIN_INSTALL=1"  rem (Task 92 : service Send Mail)'
)
for nom in BAT:
    p = os.path.join(BASE, nom)
    data = open(p, "rb").read()
    if AJOUT in data:
        print(f"OK {nom} : deja a jour")
        continue
    if MOTIF not in data:
        print(f"ECHEC {nom} : motif introuvable")
        raise SystemExit(1)
    data2 = data.replace(MOTIF, MOTIF + b"\r\n" + AJOUT, 1)
    open(p, "wb").write(data2)
    print(f"OK {nom} : verification nodemailer ajoutee (CRLF intacts)")

print("PATCH DEMARRAGE TASK 92 : TOUT OK")
