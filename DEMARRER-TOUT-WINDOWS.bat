@echo off
REM ============================================================
REM   AUTO RH (PaieSage) - Demarrage des DEUX interfaces - WINDOWS
REM   (v0.2.212 : UNIQUE lanceur Windows - les lanceurs individuels
REM   DEMARRER-WINDOWS.bat / DEMARRER-PORTAIL-WINDOWS.bat et la
REM   famille SILENCIEUX sont supprimes ; tout passe par ici ou par
REM   GESTION.bat)
REM
REM   1) Administration RH/IT - login requis .... PORT du .env, defaut 4000
REM   2) Portail Employes - sans connexion ...... PORTAL_PORT du .env, defaut 4001
REM
REM   Double-cliquez sur ce fichier : deux fenetres s'ouvrent.
REM   Changer de port : ligne PORT=XXXX / PORTAL_PORT=XXXX du .env puis
REM   relancez ce fichier - les anciennes instances sont arretees
REM   automatiquement - migration des ports - v0.2.212.
REM ============================================================
setlocal EnableDelayedExpansion
title AUTO RH - Administration + Portail Employes
cd /d "%~dp0"

REM ---------- 0) Ports : lus depuis le .env ----------
REM PORT = administration RH/IT - defaut 4000 ; PORTAL_PORT = portail - defaut 4001.
REM Lignes ECRITES dans le .env si absentes - idempotent, JAMAIS de valeur
REM utilisateur ecrasee. Guillemets et espaces autour de la valeur tolérés.
set "PORT=4000"
if exist .env for /f "tokens=1,* delims==" %%a in ('findstr /B /C:"PORT=" .env 2^>nul') do set "PORT=%%~b"
for /f "delims= " %%c in ("!PORT!") do set "PORT=%%c"
if "!PORT!"=="" set "PORT=4000"
set "PORTAL_PORT=4001"
if exist .env for /f "tokens=1,* delims==" %%a in ('findstr /B /C:"PORTAL_PORT=" .env 2^>nul') do set "PORTAL_PORT=%%~b"
for /f "delims= " %%c in ("!PORTAL_PORT!") do set "PORTAL_PORT=%%c"
if "!PORTAL_PORT!"=="" set "PORTAL_PORT=4001"
if exist .env (
    findstr /B /C:"PORT=" .env >nul 2>nul || >> .env echo PORT=!PORT!
    findstr /B /C:"PORTAL_PORT=" .env >nul 2>nul || >> .env echo PORTAL_PORT=!PORTAL_PORT!
)

echo.
echo ============================================================
echo   AUTO RH - Demarrage des deux interfaces
echo     Administration RH/IT : http://localhost:!PORT!  - login requis
echo     Portail Employes     : http://localhost:!PORTAL_PORT!  - sans login
echo ============================================================
echo.

REM ---------- 1) Verifier que Node.js est installe ----------
node -v >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] Node.js n'est pas installe. Telechargez-le sur https://nodejs.org puis relancez.
    pause
    exit /b 1
)

REM ---------- 1bis) Preparer le .env avec le chemin absolu de la base ----------
REM Prisma exige un chemin ABSOLU pour SQLite. AUTH_SECRET - signature des
REM sessions - est CONSERVE s'il existe deja, sinon il est cree ICI : les
REM deux serveurs demarrent avec la meme cle.
set "PROJECT_UNIX=%CD:\=/%"
> .env.tmp echo DATABASE_URL=file:%PROJECT_UNIX%/db/custom.db
if exist .env findstr /V /B /C:"DATABASE_URL=" .env >> .env.tmp
move /y .env.tmp .env >nul
set "DATABASE_URL=file:%PROJECT_UNIX%/db/custom.db"
findstr /B /C:"AUTH_SECRET=" .env >nul 2>nul
if errorlevel 1 (
    node scripts\gen-secret.js > secret.tmp
    set /p GEN_SECRET=<secret.tmp
    del secret.tmp >nul 2>nul
    >> .env echo AUTH_SECRET=!GEN_SECRET!
)

REM ---------- 2) Installation commune - 1ere fois uniquement ----------
REM Faite ICI pour eviter que les deux fenetres installent en meme temps.
if not exist "node_modules\" (
    echo [Installation] Dependances : 3 a 5 minutes, une seule fois...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [ERREUR] L'installation npm a echoue. Verifiez votre connexion Internet puis relancez.
        pause
        exit /b 1
    )
)
REM On teste le CLIENT GENERE - node_modules\.prisma\client - et non le seul
REM paquet : npm peut sauter les scripts d'installation - npm 11+.
if not exist "node_modules\.prisma\client\index.js" (
    call npx prisma generate
    if errorlevel 1 (
        echo [ERREUR] La generation du client Prisma a echoue.
        pause
        exit /b 1
    )
)
if not exist "db\custom.db" (
    call npx prisma db push
    if errorlevel 1 (
        echo [ERREUR] La creation de la base de donnees a echoue.
        pause
        exit /b 1
    )
)
echo [OK] Installation commune terminee.

REM ---------- (v0.2.212) Migration des ports ----------
REM Si le .env a change de port depuis le dernier demarrage, les ANCIENNES
REM instances encore en marche sont arretees ici - sinon elles continuaient
REM de servir les anciens liens et l'utilisateur pensait que le changement
REM « ne fonctionnait pas ».
node scripts\migrer-ports.js

REM ---------- Securisation automatique des dossiers sensibles ----------
REM Silencieuse, reversible, ne bloque jamais le demarrage - Task 40.
node scripts\securiser-auto.js >nul 2>nul

REM ---------- Superadministrateur : creation automatique ----------
REM IDEMPOTENT : rien n'est cree si un compte actif existe deja.
REM SUPERADMIN_AUTO=0 desactive ; SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD
REM configurent l'identite ; sinon mot de passe aleatoire consigne dans
REM logs\compte-superadmin-initial.txt.
set "SUPERADMIN_AUTO=1"
if exist .env for /f "tokens=1,* delims==" %%a in ('findstr /B /C:"SUPERADMIN_AUTO=" .env 2^>nul') do set "SUPERADMIN_AUTO=%%~b"
if exist db\custom.db if not "!SUPERADMIN_AUTO!"=="0" (
    node scripts\creer-superadmin.js --assurer
    if errorlevel 1 echo [ATTENTION] Superadministrateur : etape non terminee - demarrage continue.
)

REM ---------- (v0.2.212) Build de production - AVANT l'ouverture ----------
REM Fait UNE fois ici : avant, chaque fenetre construisait de son cote et
REM deux constructions pouvaient se marcher dessus. verifier-build-a-jour.js
REM controle un build COMPLET - server.js + BUILD_ID + marque de version.
node scripts\verifier-build-a-jour.js
if errorlevel 1 (
    echo [Build] Construction du site : 2 a 4 minutes, une seule fois...
    call node node_modules\next\dist\bin\next build
    if errorlevel 1 (
        echo [ERREUR] Le build a echoue. Relancez ce lanceur pour reessayer.
        pause
        exit /b 1
    )
    node scripts\copy-standalone-assets.js
    if errorlevel 1 (
        echo [ERREUR] La copie des ressources a echoue. Relancez ce lanceur pour reessayer.
        pause
        exit /b 1
    )
) else (
    echo [OK] Build de production deja a jour.
)

REM ---------- Disponibilite des DEUX ports - avant l'ouverture ----------
REM verifier-ports.js lit le .env, teste les deux ports et identifie le
REM proprietaire. Conflit - code 1 : message + PID, RIEN n'est tue, arret.
REM Instances a nous deja en cours - code 2 : message, rien a relancer.
node scripts\verifier-ports.js verifier
if errorlevel 2 (
    echo.
    echo [INFO] Une ou les deux interfaces tournent DEJA sur les ports du .env.
    echo        Rien a relancer. Pour les redemarrer : GESTION.bat - choix redemarrer,
    echo        ou ARRETER-WINDOWS.bat puis relancez DEMARRER-TOUT-WINDOWS.bat.
    pause
    exit /b 0
)
if errorlevel 1 (
    echo.
    echo [ERREUR] Au moins un port est occupe par un AUTRE programme - voir ci-dessus.
    echo          Liberez-le OU changez PORT / PORTAL_PORT dans le fichier .env puis relancez.
    pause
    exit /b 1
)

REM ---------- 3) Ouvrir les deux fenetres de serveurs ----------
echo.
echo Lancement de l'administration - port !PORT! - dans une nouvelle fenetre...
start "AUTO RH Administration - port !PORT!" cmd /k "node scripts\start-prod.js"
timeout /t 3 /nobreak >nul
echo Lancement du portail employes - port !PORTAL_PORT! - dans une nouvelle fenetre...
start "AUTO RH Portail Employes - port !PORTAL_PORT!" cmd /k "node scripts\portail-server.js"

REM ---------- 4) Ouverture du navigateur sur les deux interfaces ----------
start "" http://localhost:!PORT!
start "" http://localhost:!PORTAL_PORT!

echo.
echo ============================================================
echo   Deux fenetres ont ete ouvertes :
echo     - Administration RH/IT : http://localhost:!PORT!
echo       premiere fois : quelques dizaines de secondes a la
echo       premiere page - le build a deja ete fait ci-dessus
echo     - Portail Employes     : http://localhost:!PORTAL_PORT!
echo.
echo   Port change recemment ? Utilisez les NOUVEAUX liens
echo   ci-dessus et fermez les anciens onglets du navigateur.
echo.
echo   Vous pouvez fermer CETTE fenetre : les deux serveurs
echo   continuent dans leurs propres fenetres.
echo   Arret : ARRETER-WINDOWS.bat  -  Console : GESTION.bat
echo ============================================================
echo.
pause
