@echo off
REM ============================================================
REM   Fiches de Paie - TACHE de preparation SILENCIEUSE (cachee)
REM
REM   Fichier TECHNIQUE appele par DEMARRER-SILENCIEUX-WINDOWS.vbs :
REM   il est execute SANS fenetre (style 0). Ne le double-cliquez pas,
REM   utilisez DEMARRER-SILENCIEUX-WINDOWS.vbs.
REM   (Pour voir la progression EN DIRECT : ouvrez une invite de
REM   commandes dans ce dossier et tapez PREPARER-AUTO-RH-SILENCIEUX.bat
REM   -- tous les jalons s'affichent alors a l'ecran.)
REM
REM   Etapes (identiques a un demarrage complet visible, mais tout est ecrit
REM   dans logs\auto-rh-preparation.log au lieu de l'ecran) :
REM     1) verifier Node.js
REM     2) preparer le fichier .env (DATABASE_URL absolu, AUTH_SECRET -
REM        conserves s'ils existent deja)
REM     3) installer les dependances (1ere fois uniquement)
REM     4) creer / mettre a jour la base SQLite
REM     5) construire le site (1ere fois ou nouvelle version)
REM     6) demarrer les 2 serveurs EN ARRIERE-PLAN
REM
REM   PENDANT la preparation, logs\demarrage-etat.txt contient
REM     ETAT=EN_COURS + ETAPE=...   (mis a jour a CHAQUE etape)
REM   et a la fin : ETAT=OK ou ETAT=ERREUR + MESSAGE=...
REM   (ETAT-SILENCIEUX-WINDOWS.vbs et le compte a rebours du VBS
REM   d'affichent desormais l'etape en cours.)
REM
REM   (MODIFIE 0.2.53) L'installation s'arretait silencieusement APRES
REM   [4/6] sur certains postes : la ligne " call node -e "<code dense> "
REM   ajoutee en 0.2.52 etait tuee par l'antivirus (cmd cache + node -e
REM   = signature suspecte) ou avortee par le parseur cmd. Desormais :
REM   - PLUS AUCUN node -e : le controle de version du build est fait
REM     par un VRAI fichier : scripts\verifier-build-a-jour.js ;
REM   - chaque etape ecrit ETAT=EN_COURS + ETAPE=... dans le fichier
REM     d'etat et une trace horodatee dans le journal ;
REM   - verification non bloquante des modules natifs apres npm install
REM     (scripts\verifier-modules-natifs.js) : les npm recents bloquent
REM     les scripts d'installation des dependances.
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"
if not exist logs mkdir logs

call :principale
exit /b %errorlevel%

:principale
>> logs\auto-rh-preparation.log echo.
>> logs\auto-rh-preparation.log echo ===== Demarrage silencieux du %date% %time% =====
> logs\demarrage-etat.txt echo ETAT=EN_COURS
>> logs\demarrage-etat.txt echo ETAPE=1/6 Verification de Node.js

REM ---------- 1) Verifier que Node.js est installe ----------
node -v >nul 2>nul
if errorlevel 1 (
    >> logs\auto-rh-preparation.log echo [ERREUR] Node.js n'est pas installe sur ce poste.
    > logs\demarrage-etat.txt echo ETAT=ERREUR
    >> logs\demarrage-etat.txt echo MESSAGE=Node.js n'est pas installe. Installez la version LTS depuis https://nodejs.org puis relancez DEMARRER-SILENCIEUX-WINDOWS.vbs.
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do >> logs\auto-rh-preparation.log echo [1/6] Node.js detecte : %%v
echo [1/6] Node.js detecte.

REM ---------- 2) Preparer le fichier .env (meme logique qu un demarrage complet) ----------
> logs\demarrage-etat.txt echo ETAT=EN_COURS
>> logs\demarrage-etat.txt echo ETAPE=2/6 Preparation du fichier .env
set "PROJECT_UNIX=%CD:\=/%"
> .env.tmp echo DATABASE_URL=file:%PROJECT_UNIX%/db/custom.db
if exist .env findstr /V /B /C:"DATABASE_URL=" .env >> .env.tmp
move /y .env.tmp .env >nul
findstr /B /C:"AUTH_SECRET=" .env >nul 2>nul
if errorlevel 1 (
    node scripts\gen-secret.js > secret.tmp
    set /p GEN_SECRET=<secret.tmp
    del secret.tmp >nul 2>nul
    >> .env echo AUTH_SECRET=!GEN_SECRET!
)
REM (Les comptes RH/IT sont crees par le superadministrateur depuis l'onglet
REM Utilisateurs - plus aucun code d'inscription automatique.)
REM Task 40 : securisation AUTOMATIQUE des dossiers sensibles (.env, db,
REM storage, logs, backups) - silencieuse, reversible, ne bloque jamais.
node scripts\securiser-auto.js >> logs\auto-rh-preparation.log 2>&1
>> logs\auto-rh-preparation.log echo [2/6] Fichier .env pret (securite conservee).

REM ---------- 3) Installer les dependances (1ere fois ou si incomplete) ----------
REM (Task 89) Un node_modules INCOMPLET faisait ensuite appeler " npx prisma "
REM qui PROPOSAIT de telecharger la DERNIERE version publiee via un prompt
REM INTERACTIF -- BLOCAGE definitif en mode silencieux. Desormais : on
REM verifie le CLI Prisma ET Next LOCALEMENT, on relance npm install s'ils
REM manquent, et on appelle TOUJOURS le CLI LOCAL via " node node_modules\... "
REM -- plus aucun npx, aucun telechargement hors de controle, aucun prompt.
> logs\demarrage-etat.txt echo ETAT=EN_COURS
>> logs\demarrage-etat.txt echo ETAPE=3/6 Installation des dependances - 3 a 5 minutes
set "BESOIN_INSTALL=0"
if not exist "node_modules\" set "BESOIN_INSTALL=1"
if not exist "node_modules\prisma\build\index.js" set "BESOIN_INSTALL=1"
if not exist "node_modules\next\dist\bin\next" set "BESOIN_INSTALL=1"
if not exist "node_modules\nodemailer\package.json" set "BESOIN_INSTALL=1"  rem (Task 92 : service Send Mail)
if "!BESOIN_INSTALL!"=="1" (
    >> logs\auto-rh-preparation.log echo [3/6] Installation ou completion des dependances : 3 a 5 minutes...   [heure %time%]
    echo [3/6] Installation des dependances : 3 a 5 minutes, merci de patienter...
    call npm install --no-audit --no-fund >> logs\auto-rh-preparation.log 2>&1
    if errorlevel 1 (
        call :echec "L'installation npm a echoue. Verifiez votre connexion Internet puis relancez DEMARRER-SILENCIEUX-WINDOWS.vbs."
        exit /b 1
    )
    REM (NOUVEAU 0.2.53) Modules natifs : verification NON bloquante. Les npm
    REM recents peuvent bloquer les scripts d'installation des dependances ;
    REM on verifie sharp (tampon PNG) et on affiche un remede clair au besoin.
    REM Un simple fichier JS : jamais de node -e inline.
    call node "scripts\verifier-modules-natifs.js" >> logs\auto-rh-preparation.log 2>&1
) else (
    >> logs\auto-rh-preparation.log echo [3/6] Dependances deja installees.
    echo [3/6] Dependances deja installees.
)
if not exist "node_modules\prisma\build\index.js" (
    call :echec "Le CLI Prisma local est introuvable apres installation. Verifiez votre connexion Internet puis relancez."
    exit /b 1
)
if not exist "node_modules\@prisma\client" (
    call node "node_modules\prisma\build\index.js" generate >> logs\auto-rh-preparation.log 2>&1
    if errorlevel 1 (
        call :echec "La generation du client Prisma a echoue."
        exit /b 1
    )
)

REM ---------- 4) Creer / mettre a jour la base de donnees ----------
> logs\demarrage-etat.txt echo ETAT=EN_COURS
>> logs\demarrage-etat.txt echo ETAPE=4/6 Mise a jour de la base de donnees
REM (Task 89) CLI Prisma LOCAL (plus de npx -- cf. section 3).
call node "node_modules\prisma\build\index.js" db push >> logs\auto-rh-preparation.log 2>&1
if errorlevel 1 (
    call :echec "La mise a jour de la base de donnees a echoue."
    exit /b 1
)
>> logs\auto-rh-preparation.log echo [4/6] Base de donnees a jour.
echo [4/6] Base de donnees a jour.

REM ---------- (NOUVEAU 0.2.168) Controle d'integrite de l'extraction ----------
REM Un ZIP mal extrait (outil, antivirus, extraction interrompue) ou mal
REM reconstitue depuis des e-mails (sans controle MD5) perd des fichiers —
REM souvent tout le dossier src\ : le build echouait ensuite avec l'erreur
REM cryptique « Couldn't find any pages or app directory » sans explication.
REM Desormais : controle par manifeste AVANT le build, avec remede en clair.
if exist "MANIFEST-LIVRAISON.txt" (
    if exist "scripts\verifier-extraction.js" (
        >> logs\demarrage-etat.txt echo ETAPE=5/6 Controle de l'extraction du ZIP
        echo [5/6] Controle de l'extraction du ZIP...
        call node "scripts\verifier-extraction.js" --complet >> logs\auto-rh-preparation.log 2>&1
        if errorlevel 1 (
            type logs\auto-rh-preparation.log | findstr /C:"verifier-extraction" /C:"MANQUANT" /C:"CORROMPUS" /C:"SOLUTION"
            call :echec "Extraction incomplete : des fichiers du ZIP sont absents ou corrompus dans ce dossier. Reextrayez TOUT le contenu du ZIP ici (remplacer les fichiers), verifiez le MD5 du ZIP (commande de l'e-mail de livraison) puis relancez."
            exit /b 1
        )
        >> logs\auto-rh-preparation.log echo [5/6] Extraction complete : manifeste respecte.
    )
)
REM ---------- 5) Build de production (1ere fois OU NOUVELLE VERSION) ----------
REM (MODIFIE 0.2.53) Le controle ci-dessous est un VRAI fichier JS :
REM scripts\verifier-build-a-jour.js (exit 0 = a jour, exit 1 = a construire).
REM La marque .next\standalone\.auto-rh-version est ecrite a chaque build par
REM scripts\copy-standalone-assets.js ; si elle differe de package.json
REM (nouvelle version extraite), le site est reconstruit -- sinon un build
REM PERIME tournait (symptomes : QR/signature absents des fiches
REM PNG/DOCX/XLSX, decalages horizontaux/verticaux ignores).
> logs\demarrage-etat.txt echo ETAT=EN_COURS
>> logs\demarrage-etat.txt echo ETAPE=5/6 Verification du build de production
echo [5/6] Verification du build de production...
set "BUILD_A_JOUR=0"
if exist "scripts\verifier-build-a-jour.js" (
    call node "scripts\verifier-build-a-jour.js" >> logs\auto-rh-preparation.log 2>&1
    if not errorlevel 1 set "BUILD_A_JOUR=1"
) else (
    >> logs\auto-rh-preparation.log echo [AVERTISSEMENT] scripts\verifier-build-a-jour.js introuvable : controle simplifie, existence de server.js uniquement.
    if exist ".next\standalone\server.js" set "BUILD_A_JOUR=1"
)
if "!BUILD_A_JOUR!"=="1" (
    >> logs\auto-rh-preparation.log echo [5/6] Build de production deja a jour, version du build = version du package.
    echo [5/6] Build de production deja a jour.
) else (
    > logs\demarrage-etat.txt echo ETAT=EN_COURS
    >> logs\demarrage-etat.txt echo ETAPE=5/6 Construction du site - 2 a 4 minutes
    >> logs\auto-rh-preparation.log echo [5/6] Construction du site necessaire, premiere fois ou NOUVELLE VERSION extraite : 2 a 4 minutes.   [heure %time%]
    echo [5/6] Construction du site : 2 a 4 minutes, merci de patienter...
    REM (Task 89) Next LOCAL (plus de npx -- cf. section 3).
    call node "node_modules\next\dist\bin\next" build >> logs\auto-rh-preparation.log 2>&1
    if errorlevel 1 (
        call :echec "La construction du site (build) a echoue. Consultez logs\auto-rh-preparation.log."
        exit /b 1
    )
    call node "scripts\copy-standalone-assets.js" >> logs\auto-rh-preparation.log 2>&1
    if errorlevel 1 (
        call :echec "La copie des ressources, copy-standalone-assets.js, a echoue."
        exit /b 1
    )
    >> logs\auto-rh-preparation.log echo [5/6] Construction terminee.   [heure %time%]
)

REM ---------- 6) Demarrage des deux serveurs EN ARRIERE-PLAN ----------
REM Le moteur (scripts\auto-rh.js) lance les serveurs caches,
REM enregistre leurs PID dans logs\auto-rh-processus.json, conserve la
REM console dans logs\auto-rh-administration.log / auto-rh-portail.log,
REM puis ecrit logs\demarrage-etat.txt (ETAT=OK / ERREUR + MESSAGE).
> logs\demarrage-etat.txt echo ETAT=EN_COURS
>> logs\demarrage-etat.txt echo ETAPE=6/6 Demarrage des serveurs en arriere-plan
>> logs\auto-rh-preparation.log echo [6/6] Demarrage des serveurs en arriere-plan...
echo [6/6] Demarrage des serveurs en arriere-plan...
node scripts\auto-rh.js start >> logs\auto-rh-preparation.log 2>&1
exit /b %errorlevel%

:echec
>> logs\auto-rh-preparation.log echo [ERREUR] %~1   [heure %time%]
> logs\demarrage-etat.txt echo ETAT=ERREUR
>> logs\demarrage-etat.txt echo MESSAGE=%~1
exit /b 1
