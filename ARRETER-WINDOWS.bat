@echo off
REM ============================================================
REM   Auto RH (PaieSage) - ARRET du site sous WINDOWS  (NOUVEAU v0.2.210)
REM   Double-cliquez sur ce fichier pour ARRETER les services.
REM
REM   Arrete PROPREMENT les deux interfaces (administration RH/IT
REM   et portail employes), demarrees par n'importe quel lanceur :
REM     - arret PRECIS par PID : seuls les processus ENREGISTRES par
REM       CE projet (logs\paiesage-processus.json) sont tues, arbre
REM       compris - JAMAIS un autre programme du systeme, JAMAIS de
REM       commande globale taskkill ;
REM     - la disponibilite des ports du .env est reverifiee a la fin ;
REM     - le detail est journalise dans logs\arret-etat.txt.
REM
REM   Ports : lus dans le .env (PORT et PORTAL_PORT, defauts 4000/4001)
REM   - identiques a GESTION.bat, DEMARRER-TOUT-WINDOWS.bat et au moteur.
REM
REM   Relancer ensuite : DEMARRER-TOUT-WINDOWS.bat
REM   Console de gestion : GESTION.bat
REM ============================================================
setlocal EnableDelayedExpansion
title Auto RH - Arret des services
cd /d "%~dp0"

echo.
echo ============================================================
echo   Auto RH - Arret des services en local
echo   Dossier : %CD%
echo ============================================================
echo.

REM ---------- 1) Verifier que Node.js est installe ----------
node -v >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] Node.js n'est pas installe sur ce poste : les serveurs
    echo          ne peuvent pas etre identifies.
    echo.
    echo   1. Telechargez Node.js LTS sur : https://nodejs.org
    echo   2. Installez-le en laissant toutes les options par defaut.
    echo   3. Relancez ce fichier.
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do set NODE_VERSION=%%v
echo [1/3] Node.js detecte : !NODE_VERSION!

REM ---------- 2) Ports : meme priorite que GESTION.bat / moteur silencieux ----------
REM    PAIESAGE_PORT_ADMIN > PORT (.env) > 4000
REM    PAIESAGE_PORT_PORTAIL > PORTAL_PORT (.env) > 4001
set "PORT=4000"
set "PORTAL_PORT=4001"
if exist .env for /f "tokens=1,* delims==" %%a in ('findstr /B /C:"PORT=" .env 2^>nul') do set "PORT=%%b"
if exist .env for /f "tokens=1,* delims==" %%a in ('findstr /B /C:"PORTAL_PORT=" .env 2^>nul') do set "PORTAL_PORT=%%b"
if exist .env for /f "tokens=1,* delims==" %%a in ('findstr /B /C:"PAIESAGE_PORT_ADMIN=" .env 2^>nul') do set "PORT=%%b"
if exist .env for /f "tokens=1,* delims==" %%a in ('findstr /B /C:"PAIESAGE_PORT_PORTAIL=" .env 2^>nul') do set "PORTAL_PORT=%%b"
echo [2/3] Ports du .env : administration=!PORT!, portail=!PORTAL_PORT!

REM ---------- 3) Arret precis par PID (moteur du projet) ----------
echo [3/3] Arret des serveurs enregistres...
node scripts\service-paiesage.js stop

REM ---------- Verification finale : ports libres ? ----------
REM    Code retour du verificateur : 0 = libre ; 1 = autre programme ;
REM    2 = encore en cours par CETTE application (arret incomplet).
set "LIBRES=1"
set "ENCOURS=0"
node scripts\verifier-ports.js verifier !PORT! "Administration RH/IT" PORT >nul 2>nul
if errorlevel 2 (
    set "LIBRES=0"
    set "ENCOURS=1"
) else if errorlevel 1 set "LIBRES=0"
node scripts\verifier-ports.js verifier !PORTAL_PORT! "Portail employes" PORTAL_PORT >nul 2>nul
if errorlevel 2 (
    set "LIBRES=0"
    set "ENCOURS=1"
) else if errorlevel 1 set "LIBRES=0"

echo.
if "!LIBRES!"=="1" (
    echo ============================================================
    echo   Arret termine : les ports !PORT! et !PORTAL_PORT! sont libres.
    echo   Detail : logs\arret-etat.txt
    echo ============================================================
) else if "!ENCOURS!"=="1" (
    echo ============================================================
    echo   Arret INCOMPLET : un serveur de CETTE application ecoute
    echo   encore. Relancez ce script, ou consultez le journal :
    echo   GESTION.bat journaux arret
    echo ============================================================
) else (
    echo ============================================================
    echo   Arret termine, MAIS un port reste occupe par un AUTRE
    echo   programme ^(aucun processus etranger n'a ete touche^).
    echo   Identifiez-le :  GESTION.bat ports
    echo   Detail : logs\arret-etat.txt
    echo ============================================================
)
echo.
echo Cette fenetre peut etre fermee.
pause
endlocal
exit /b 0
