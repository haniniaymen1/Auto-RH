@echo off
REM ============================================================
REM  NOUVEAU Task 34 : creation / gestion du SUPERADMINISTRATEUR
REM  Double-cliquez sur ce fichier :
REM    1 - Voir l'etat des comptes : RH / IT / Superadmin
REM    2 - CREER un compte superadministrateur
REM    3 - PROMOUVOIR un compte existant
REM  Le superadministrateur gere les comptes depuis l'onglet
REM  "Utilisateurs" de l'administration - port 3000 :
REM  activation, suppression, mot de passe, changement de role.
REM
REM  MODIFIE Task 34 correctif 2 - fiabilisation totale :
REM    - plus aucun bloc if multi-lignes : flots goto simples ;
REM    - AUCUNE parenthese dans tout le fichier : sous Windows,
REM      une parenthese dans un message provoque l'erreur
REM      "X etait inattendu." et l'abandon immediat du script ;
REM    - affichage des accents correct : chcp 65001 ;
REM    - messages d'aide clairs : ZIP non extrait, projet non
REM      installe, Node absent.
REM ============================================================
title SERVICE RH - Superadministrateur
cd /d "%~dp0"

REM accents correctement affiches dans la sortie node
chcp 65001 >nul

where node >nul 2>nul
if errorlevel 1 goto ERREUR_NODE
if not exist "scripts\creer-superadmin.js" goto ERREUR_ZIP
if not exist "node_modules\@prisma\client" goto ERREUR_INSTALL

echo.
echo Ouverture du menu Superadministrateur...
echo Astuce : le mot de passe tape ne s'affiche pas, c'est normal.
echo.
node scripts\creer-superadmin.js
if errorlevel 1 goto ECHEC_MENU
goto FIN

:ERREUR_NODE
echo.
echo [ERREUR] Node.js est introuvable sur ce PC.
echo Installez Node.js depuis https://nodejs.org puis relancez ce fichier.
echo.
pause
exit /b 1

:ERREUR_ZIP
echo.
echo [ERREUR] Le fichier scripts\creer-superadmin.js est introuvable
echo a cote de ce fichier .bat.
echo.
echo Si vous avez ouvert ce fichier DEPUIS LE ZIP - double-clic dans
echo la fenetre du ZIP - il faut D'ABORD extraire le dossier complet :
echo   1. Clic droit sur le fichier ZIP puis "Extraire tout..."
echo   2. Ouvrez le dossier extrait
echo   3. Relancez CREER-SUPERADMIN-WINDOWS.bat depuis ce dossier
echo.
pause
exit /b 1

:ERREUR_INSTALL
echo.
echo [ERREUR] Le projet SERVICE RH n'est pas encore installe sur ce PC
echo - dossier node_modules absent ou incomplet.
echo.
echo Demarrez une fois l'application avec DEMARRER-SILENCIEUX-WINDOWS.vbs :
echo au premier demarrage elle installe automatiquement tout le
echo necessaire, puis relancez CREER-SUPERADMIN-WINDOWS.bat.
echo.
pause
exit /b 1

:ECHEC_MENU
echo.
echo [NOTE] Le menu s'est termine sur une erreur :
echo lisez le message affiche ci-dessus.
goto FIN

:FIN
echo.
echo ============================================
echo Termine. Fermez cette fenetre ou appuyez
echo sur une touche pour revenir au menu.
echo ============================================
pause >nul
goto :eof
