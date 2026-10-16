# -*- coding: utf-8 -*-
"""
Task 89 : supprime TOUS les appels « npx prisma / npx next » des 7 scripts de
demarrage livres (cause du blocage « Ok to proceed? (y) » sur prisma@8.0.0-rc.15).

Principe du correctif (identique dans les 7 fichiers) :
  1. Verif ROBUSTE des dependances : node_modules + CLI Prisma local
     (node_modules/prisma/build/index.js) + Next local (node_modules/next/dist/bin/next)
     -> npm install relance si l'un manque (repare un node_modules incomplet).
  2. Appel du CLI LOCAL via « node <chemin> » : plus aucun npx -> aucun
     telechargement hors de controle, aucun prompt, aucun blocage possible.
  3. Garde-fou : si le CLI local manque encore apres installation -> echec
     PROPRE avec message clair (jamais de prompt interactif).

Preserve les fins de ligne : CRLF pour les .bat, LF pour les .sh
(DEMARRER-TOUT-WINDOWS.bat, etait LF, est normalise en CRLF — plus sur pour cmd.exe).
Idempotent : relancer le script ne modifie rien si tout est deja applique.
"""
import sys

def R(s):
    """old/new strings ecrits avec \n ; conversion selon EOL du fichier cible."""
    return s

def applique(chemin, remplacements, eol_force=None):
    with open(chemin, 'r', encoding='utf-8', newline='') as f:
        contenu = f.read()
    eol = '\r\n' if '\r\n' in contenu else '\n'
    if eol_force:
        eol = eol_force
    if eol_force == '\r\n' and contenu and '\r\n' not in contenu:
        contenu = contenu.replace('\r\n', '\n').replace('\n', '\r\n')
        eol = '\r\n'
    deja = 0
    for old, new, marqueur in remplacements:
        old_e = old.replace('\n', eol)
        new_e = new.replace('\n', eol)
        if new_e in contenu:
            deja += 1
            continue
        if old_e not in contenu:
            print(f"ECHEC: introuvable dans {chemin}:\n---\n{old[:300]}\n---")
            sys.exit(1)
        contenu = contenu.replace(old_e, new_e, 1)
    with open(chemin, 'w', encoding='utf-8', newline='') as f:
        f.write(contenu)
    print(f"OK {chemin} ({len(remplacements)} remplacements, {deja} deja appliques, EOL={'CRLF' if eol=='\r\n' else 'LF'})")

# ==========================================================================
# A) PREPARER-AUTO-RH-SILENCIEUX.bat  (le script du signalement utilisateur)
# ==========================================================================
A = []
A.append((
"""REM ---------- 3) Installer les dependances (1ere fois uniquement) ----------
if not exist "node_modules\\" (
    >> logs\\auto-rh-preparation.log echo [3/6] Installation des dependances : 3 a 5 minutes, une seule fois...
    call npm install --no-audit --no-fund >> logs\\auto-rh-preparation.log 2>&1
    if errorlevel 1 (
        call :echec "L'installation npm a echoue. Verifiez votre connexion Internet puis relancez DEMARRER-SILENCIEUX-WINDOWS.vbs."
        exit /b 1
    )
) else (
    >> logs\\auto-rh-preparation.log echo [3/6] Dependances deja installees.
)
if not exist "node_modules\\@prisma\\client" (
    call npx prisma generate >> logs\\auto-rh-preparation.log 2>&1
    if errorlevel 1 (
        call :echec "La generation du client Prisma a echoue."
        exit /b 1
    )
)""",
"""REM ---------- 3) Installer les dependances (1ere fois ou si incomplete) ----------
REM MODIFIE Task 89 : la presence du seul dossier node_modules ne suffit pas.
REM Un node_modules INCOMPLET (installation interrompue, antivirus, copie)
REM faisait ensuite appeler « npx prisma » : npx PROPOSAIT de telecharger la
REM DERNIERE version publiee (ex : prisma@8.0.0-rc.15 au lieu de la 6.x figee
REM par package.json) via un prompt INTERACTIF « Ok to proceed? (y) » —
REM BLOCAGE definitif en mode silencieux (fenetre cachee, personne pour
REM repondre). Desormais : (1) on verifie le CLI Prisma ET Next LOCALEMENT et
REM on relance npm install s'ils manquent ; (2) on appelle TOUJOURS le CLI
REM LOCAL via « node node_modules\\... » — plus aucun npx : AUCUN telechargement
REM hors de controle, AUCUN prompt, AUCUN blocage possible.
set "BESOIN_INSTALL=0"
if not exist "node_modules\\" set "BESOIN_INSTALL=1"
if not exist "node_modules\\prisma\\build\\index.js" set "BESOIN_INSTALL=1"
if not exist "node_modules\\next\\dist\\bin\\next" set "BESOIN_INSTALL=1"
if "!BESOIN_INSTALL!"=="1" (
    >> logs\\auto-rh-preparation.log echo [3/6] Installation ou completion des dependances : 3 a 5 minutes...
    call npm install --no-audit --no-fund >> logs\\auto-rh-preparation.log 2>&1
    if errorlevel 1 (
        call :echec "L'installation npm a echoue. Verifiez votre connexion Internet puis relancez DEMARRER-SILENCIEUX-WINDOWS.vbs."
        exit /b 1
    )
) else (
    >> logs\\auto-rh-preparation.log echo [3/6] Dependances deja installees.
)
if not exist "node_modules\\prisma\\build\\index.js" (
    call :echec "Le CLI Prisma local est introuvable apres installation. Verifiez votre connexion Internet puis relancez."
    exit /b 1
)
if not exist "node_modules\\@prisma\\client" (
    call node "node_modules\\prisma\\build\\index.js" generate >> logs\\auto-rh-preparation.log 2>&1
    if errorlevel 1 (
        call :echec "La generation du client Prisma a echoue."
        exit /b 1
    )
)""",
"MODIFIE Task 89"))

A.append((
"""REM ---------- 4) Creer / mettre a jour la base de donnees ----------
call npx prisma db push >> logs\\auto-rh-preparation.log 2>&1""",
"""REM ---------- 4) Creer / mettre a jour la base de donnees ----------
REM MODIFIE Task 89 : CLI Prisma LOCAL (plus de npx — cf. section 3).
call node "node_modules\\prisma\\build\\index.js" db push >> logs\\auto-rh-preparation.log 2>&1""",
"MODIFIE Task 89"))

A.append((
"""    >> logs\\auto-rh-preparation.log echo [5/6] Construction du site : 2 a 4 minutes, une seule fois...
    call npx next build >> logs\\auto-rh-preparation.log 2>&1""",
"""    >> logs\\auto-rh-preparation.log echo [5/6] Construction du site : 2 a 4 minutes, une seule fois...
    REM MODIFIE Task 89 : Next LOCAL (plus de npx — cf. section 3).
    call node "node_modules\\next\\dist\\bin\\next" build >> logs\\auto-rh-preparation.log 2>&1""",
"MODIFIE Task 89"))

# ==========================================================================
# B) DEMARRER-WINDOWS.bat
# ==========================================================================
B = []
B.append((
"""REM ---------- 3) Installer les dependances (1ere fois uniquement) ----------
if not exist "node_modules\\" (
    echo [3/5] Installation des dependances : 3 a 5 minutes, une seule fois...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [ERREUR] L'installation npm a echoue. Verifiez votre connexion Internet puis relancez.
        pause
        exit /b 1
    )
    call npx prisma generate
    if errorlevel 1 (
        echo [ERREUR] La generation du client Prisma a echoue.
        pause
        exit /b 1
    )
) else (
    echo [3/5] Dependances deja installees.
)""",
"""REM ---------- 3) Installer les dependances (1ere fois ou si incomplete) ----------
REM MODIFIE Task 89 : un node_modules INCOMPLET faisait ensuite appeler
REM « npx prisma » qui PROPOSAIT de telecharger prisma@latest (version
REM incorrecte) via un prompt interactif. Desormais : verification du CLI
REM Prisma ET Next LOCAUX (npm install relance s'ils manquent) puis appel du
REM CLI LOCAL via node — plus aucun npx, aucun prompt, aucun blocage.
set "BESOIN_INSTALL=0"
if not exist "node_modules\\" set "BESOIN_INSTALL=1"
if not exist "node_modules\\prisma\\build\\index.js" set "BESOIN_INSTALL=1"
if not exist "node_modules\\next\\dist\\bin\\next" set "BESOIN_INSTALL=1"
if "!BESOIN_INSTALL!"=="1" (
    echo [3/5] Installation ou completion des dependances : 3 a 5 minutes...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [ERREUR] L'installation npm a echoue. Verifiez votre connexion Internet puis relancez.
        pause
        exit /b 1
    )
) else (
    echo [3/5] Dependances deja installees.
)
if not exist "node_modules\\prisma\\build\\index.js" (
    echo [ERREUR] Le CLI Prisma local est introuvable apres installation. Verifiez votre connexion Internet puis relancez.
    pause
    exit /b 1
)
if not exist "node_modules\\@prisma\\client" (
    call node "node_modules\\prisma\\build\\index.js" generate
    if errorlevel 1 (
        echo [ERREUR] La generation du client Prisma a echoue.
        pause
        exit /b 1
    )
)""",
"MODIFIE Task 89"))

B.append((
"""echo [4/5] Verification de la base de donnees...
call npx prisma db push""",
"""echo [4/5] Verification de la base de donnees...
REM MODIFIE Task 89 : CLI Prisma LOCAL (plus de npx — cf. section 3).
call node "node_modules\\prisma\\build\\index.js" db push""",
"MODIFIE Task 89"))

B.append((
"""    echo [5/5] Construction du site : 2 a 4 minutes, une seule fois...
    call npx next build""",
"""    echo [5/5] Construction du site : 2 a 4 minutes, une seule fois...
    REM MODIFIE Task 89 : Next LOCAL (plus de npx — cf. section 3).
    call node "node_modules\\next\\dist\\bin\\next" build""",
"MODIFIE Task 89"))

# ==========================================================================
# C) DEMARRER-PORTAIL-WINDOWS.bat  (pas de build Next ici : prisma seul)
# ==========================================================================
C = []
C.append((
"""REM ---------- 3) Installer les dependances (1ere fois uniquement) ----------
if not exist "node_modules\\" (
    echo [3/4] Installation des dependances : 3 a 5 minutes, une seule fois...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [ERREUR] L'installation npm a echoue. Verifiez votre connexion Internet puis relancez.
        pause
        exit /b 1
    )
) else (
    echo [3/4] Dependances deja installees.
)
if not exist "node_modules\\@prisma\\client" (
    call npx prisma generate
    if errorlevel 1 (
        echo [ERREUR] La generation du client Prisma a echoue.
        pause
        exit /b 1
    )
)""",
"""REM ---------- 3) Installer les dependances (1ere fois ou si incomplete) ----------
REM MODIFIE Task 89 : un node_modules INCOMPLET faisait ensuite appeler
REM « npx prisma » qui PROPOSAIT de telecharger prisma@latest (version
REM incorrecte) via un prompt interactif. Desormais : verification du CLI
REM Prisma LOCAL (npm install relance s'il manque) puis appel du CLI LOCAL
REM via node — plus aucun npx, aucun prompt, aucun blocage.
set "BESOIN_INSTALL=0"
if not exist "node_modules\\" set "BESOIN_INSTALL=1"
if not exist "node_modules\\prisma\\build\\index.js" set "BESOIN_INSTALL=1"
if "!BESOIN_INSTALL!"=="1" (
    echo [3/4] Installation ou completion des dependances : 3 a 5 minutes...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [ERREUR] L'installation npm a echoue. Verifiez votre connexion Internet puis relancez.
        pause
        exit /b 1
    )
) else (
    echo [3/4] Dependances deja installees.
)
if not exist "node_modules\\prisma\\build\\index.js" (
    echo [ERREUR] Le CLI Prisma local est introuvable apres installation. Verifiez votre connexion Internet puis relancez.
    pause
    exit /b 1
)
if not exist "node_modules\\@prisma\\client" (
    call node "node_modules\\prisma\\build\\index.js" generate
    if errorlevel 1 (
        echo [ERREUR] La generation du client Prisma a echoue.
        pause
        exit /b 1
    )
)""",
"MODIFIE Task 89"))

C.append((
"""    echo [4/4] Creation de la base de donnees...
    call npx prisma db push""",
"""    echo [4/4] Creation de la base de donnees...
    REM MODIFIE Task 89 : CLI Prisma LOCAL (plus de npx — cf. section 3).
    call node "node_modules\\prisma\\build\\index.js" db push""",
"MODIFIE Task 89"))

# ==========================================================================
# D) DEMARRER-TOUT-WINDOWS.bat
# ==========================================================================
D = []
D.append((
"""if not exist "node_modules\\" (
    echo [Installation] Dependances : 3 a 5 minutes, une seule fois...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [ERREUR] L'installation npm a echoue. Verifiez votre connexion Internet puis relancez.
        pause
        exit /b 1
    )
)
if not exist "node_modules\\@prisma\\client" (
    call npx prisma generate
    if errorlevel 1 (
        echo [ERREUR] La generation du client Prisma a echoue.
        pause
        exit /b 1
    )
)
if not exist "db\\custom.db" (
    call npx prisma db push
    if errorlevel 1 (
        echo [ERREUR] La creation de la base de donnees a echoue.
        pause
        exit /b 1
    )
)""",
"""REM MODIFIE Task 89 : un node_modules INCOMPLET faisait ensuite appeler
REM « npx prisma » qui PROPOSAIT de telecharger prisma@latest (version
REM incorrecte) via un prompt interactif. Desormais : verification du CLI
REM Prisma LOCAL (npm install relance s'il manque) puis appel du CLI LOCAL
REM via node — plus aucun npx, aucun prompt, aucun blocage.
set "BESOIN_INSTALL=0"
if not exist "node_modules\\" set "BESOIN_INSTALL=1"
if not exist "node_modules\\prisma\\build\\index.js" set "BESOIN_INSTALL=1"
if "!BESOIN_INSTALL!"=="1" (
    echo [Installation] Dependances : 3 a 5 minutes, une seule fois...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [ERREUR] L'installation npm a echoue. Verifiez votre connexion Internet puis relancez.
        pause
        exit /b 1
    )
)
if not exist "node_modules\\prisma\\build\\index.js" (
    echo [ERREUR] Le CLI Prisma local est introuvable apres installation. Verifiez votre connexion Internet puis relancez.
    pause
    exit /b 1
)
if not exist "node_modules\\@prisma\\client" (
    call node "node_modules\\prisma\\build\\index.js" generate
    if errorlevel 1 (
        echo [ERREUR] La generation du client Prisma a echoue.
        pause
        exit /b 1
    )
)
if not exist "db\\custom.db" (
    call node "node_modules\\prisma\\build\\index.js" db push
    if errorlevel 1 (
        echo [ERREUR] La creation de la base de donnees a echoue.
        pause
        exit /b 1
    )
)""",
"MODIFIE Task 89"))

# ==========================================================================
# E) DEMARRER-LINUX-MAC.sh
# ==========================================================================
E = []
E.append((
"""# ---------- 3) Installer les dependances (1ere fois uniquement) ----------
if [ ! -d "node_modules" ]; then
    echo "[3/5] Installation des dependances (3 a 5 minutes, une seule fois)..."
    npm install --no-audit --no-fund || fail "L'installation npm a echoue. Verifiez votre connexion Internet puis relancez."
    npx prisma generate || fail "La generation du client Prisma a echoue."
else
    echo "[3/5] Dependances deja installees."
fi""",
"""# ---------- 3) Installer les dependances (1ere fois ou si incomplete) ----------
# MODIFIE Task 89 : un node_modules INCOMPLET faisait ensuite appeler
# « npx prisma » qui PROPOSAIT de telecharger prisma@latest (version
# incorrecte) via un prompt interactif. Desormais : verification du CLI
# Prisma ET Next LOCAUX (npm install relance s'ils manquent) puis appel du
# CLI LOCAL via node — plus aucun npx, aucun prompt, aucun blocage.
if [ ! -d "node_modules" ] || [ ! -f "node_modules/prisma/build/index.js" ] || [ ! -f "node_modules/next/dist/bin/next" ]; then
    echo "[3/5] Installation ou completion des dependances (3 a 5 minutes)..."
    npm install --no-audit --no-fund || fail "L'installation npm a echoue. Verifiez votre connexion Internet puis relancez."
else
    echo "[3/5] Dependances deja installees."
fi
if [ ! -f "node_modules/prisma/build/index.js" ]; then
    fail "Le CLI Prisma local est introuvable apres installation. Verifiez votre connexion Internet puis relancez."
fi
if [ ! -d "node_modules/@prisma/client" ]; then
    node node_modules/prisma/build/index.js generate || fail "La generation du client Prisma a echoue."
fi""",
"MODIFIE Task 89"))

E.append((
"""npx prisma db push || fail "La creation de la base de donnees a echoue.\"""",
"""# MODIFIE Task 89 : CLI Prisma LOCAL (plus de npx — cf. section 3).
node node_modules/prisma/build/index.js db push || fail "La creation de la base de donnees a echoue.\"""",
"MODIFIE Task 89"))

E.append((
"""    npx next build || fail "Le build a echoue.\"""",
"""    node node_modules/next/dist/bin/next build || fail "Le build a echoue.\"""",
"MODIFIE Task 89"))

# ==========================================================================
# F) DEMARRER-PORTAIL-LINUX-MAC.sh  (pas de build Next ici : prisma seul)
# ==========================================================================
F = []
F.append((
"""# ---------- 3) Installer les dependances (1ere fois uniquement) ----------
if [ ! -d "node_modules" ]; then
    echo "[3/4] Installation des dependances (3 a 5 minutes, une seule fois)..."
    npm install --no-audit --no-fund || fail "L'installation npm a echoue. Verifiez votre connexion Internet puis relancez."
fi
if [ ! -d "node_modules/@prisma/client" ]; then
    npx prisma generate || fail "La generation du client Prisma a echoue."
else
    echo "[3/4] Dependances deja installees."
fi""",
"""# ---------- 3) Installer les dependances (1ere fois ou si incomplete) ----------
# MODIFIE Task 89 : un node_modules INCOMPLET faisait ensuite appeler
# « npx prisma » qui PROPOSAIT de telecharger prisma@latest (version
# incorrecte) via un prompt interactif. Desormais : verification du CLI
# Prisma LOCAL (npm install relance s'il manque) puis appel du CLI LOCAL
# via node — plus aucun npx, aucun prompt, aucun blocage.
if [ ! -d "node_modules" ] || [ ! -f "node_modules/prisma/build/index.js" ]; then
    echo "[3/4] Installation ou completion des dependances (3 a 5 minutes)..."
    npm install --no-audit --no-fund || fail "L'installation npm a echoue. Verifiez votre connexion Internet puis relancez."
fi
if [ ! -f "node_modules/prisma/build/index.js" ]; then
    fail "Le CLI Prisma local est introuvable apres installation. Verifiez votre connexion Internet puis relancez."
fi
if [ ! -d "node_modules/@prisma/client" ]; then
    node node_modules/prisma/build/index.js generate || fail "La generation du client Prisma a echoue."
else
    echo "[3/4] Dependances deja installees."
fi""",
"MODIFIE Task 89"))

F.append((
"""    npx prisma db push || fail "La creation de la base de donnees a echoue.\"""",
"""    # MODIFIE Task 89 : CLI Prisma LOCAL (plus de npx — cf. section 3).
    node node_modules/prisma/build/index.js db push || fail "La creation de la base de donnees a echoue.\"""",
"MODIFIE Task 89"))

# ==========================================================================
# G) DEMARRER-TOUT-LINUX-MAC.sh
# ==========================================================================
G = []
G.append((
"""# ---------- 2) Installation commune (1ere fois uniquement) ----------
if [ ! -d "node_modules" ]; then
    echo "[Installation] Dependances (3 a 5 minutes, une seule fois)..."
    npm install --no-audit --no-fund || { echo "[ERREUR] Echec de npm install."; exit 1; }
fi
if [ ! -d "node_modules/@prisma/client" ]; then
    npx prisma generate || { echo "[ERREUR] Echec de prisma generate."; exit 1; }
fi
if [ ! -f "db/custom.db" ]; then
    npx prisma db push || { echo "[ERREUR] Echec de la creation de la base."; exit 1; }
fi""",
"""# ---------- 2) Installation commune (1ere fois ou si incomplete) ----------
# MODIFIE Task 89 : un node_modules INCOMPLET faisait ensuite appeler
# « npx prisma » qui PROPOSAIT de telecharger prisma@latest (version
# incorrecte) via un prompt interactif. Desormais : verification du CLI
# Prisma LOCAL (npm install relance s'il manque) puis appel du CLI LOCAL
# via node — plus aucun npx, aucun prompt, aucun blocage.
if [ ! -d "node_modules" ] || [ ! -f "node_modules/prisma/build/index.js" ]; then
    echo "[Installation] Dependances (3 a 5 minutes, une seule fois)..."
    npm install --no-audit --no-fund || { echo "[ERREUR] Echec de npm install."; exit 1; }
fi
if [ ! -f "node_modules/prisma/build/index.js" ]; then
    echo "[ERREUR] CLI Prisma local introuvable apres installation. Verifiez votre connexion Internet puis relancez."; exit 1
fi
if [ ! -d "node_modules/@prisma/client" ]; then
    node node_modules/prisma/build/index.js generate || { echo "[ERREUR] Echec de prisma generate."; exit 1; }
fi
if [ ! -f "db/custom.db" ]; then
    node node_modules/prisma/build/index.js db push || { echo "[ERREUR] Echec de la creation de la base."; exit 1; }
fi""",
"MODIFIE Task 89"))

if __name__ == '__main__':
    applique('/home/z/my-project/PREPARER-AUTO-RH-SILENCIEUX.bat', A)
    applique('/home/z/my-project/DEMARRER-WINDOWS.bat', B)
    applique('/home/z/my-project/DEMARRER-PORTAIL-WINDOWS.bat', C)
    applique('/home/z/my-project/DEMARRER-TOUT-WINDOWS.bat', D, eol_force='\r\n')
    applique('/home/z/my-project/DEMARRER-LINUX-MAC.sh', E)
    applique('/home/z/my-project/DEMARRER-PORTAIL-LINUX-MAC.sh', F)
    applique('/home/z/my-project/DEMARRER-TOUT-LINUX-MAC.sh', G)
    print("PATCH TASK 89 : TERMINE")
