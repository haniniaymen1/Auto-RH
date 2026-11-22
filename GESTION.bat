@echo off
REM ============================================================================
REM   Auto RH (PaieSage) - GESTION UNIFIEE des services - WINDOWS
REM   (NOUVEAU v0.2.209) Lanceur : delegue toutes les commandes a gestion.ps1
REM   Ports lus dans le .env (PORT = administration, PORTAL_PORT = portail).
REM
REM   Utilisation (cmd) :      GESTION.bat demarrer-silencieux
REM   Utilisation (PowerShell) : powershell -File gestion.ps1 <commande>
REM   Aide complete :          GESTION.bat aide
REM ============================================================================
setlocal
set "PS_SCRIPT=%~dp0gestion.ps1"

if not exist "%PS_SCRIPT%" (
    echo [ERREUR] gestion.ps1 introuvable a cote de GESTION.bat : %PS_SCRIPT%
    exit /b 1
)

where powershell >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] PowerShell est introuvable sur ce systeme.
    echo          Installez Windows PowerShell 5.1 ou PowerShell 7 puis relancez.
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%
