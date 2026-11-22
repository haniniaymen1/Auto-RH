@echo off
REM ============================================================
REM  AUTO RH (PaieSage) - creation / gestion du SUPERADMINISTRATEUR
REM  - rafraichi v0.2.211 - moteur : scripts\creer-superadmin.js
REM  Double-cliquez sur ce fichier :
REM    1 - Voir l'etat des comptes : RH / IT / Superadmin
REM    2 - CREER un compte superadministrateur
REM    3 - PROMOUVOIR un compte existant en superadministrateur
REM  Le superadministrateur gere les comptes depuis l'onglet
REM  "Utilisateurs" de l'administration :
REM  http://localhost:PORT du fichier .env - 4000 par defaut.
REM  - activation, suppression, mot de passe, changement de role
REM
REM  Mode DIRECT sans menu - depuis une invite de commandes :
REM    GESTION.bat superadmin --creer --email a@b.tn --nom "Nom" --password "Mot2Passe!"
REM  Mot de passe : 8 caracteres minimum, avec majuscule, minuscule,
REM  chiffre et symbole.
REM  IDEMPOTENT : au premier demarrage sur une base vierge, le compte
REM  superadministrateur est deja cree automatiquement SUPERADMIN_AUTO=1
REM  - ce script sert alors a le retrouver, le completer ou en creer
REM  un supplementaire, jamais a creer un doublon.
REM
REM  Fiabilisation (Task 34 correctif 2, conservee) :
REM    - plus aucun bloc if multi-lignes : flots goto simples ;
REM    - AUCUNE parenthese dans tout le fichier : sous Windows,
REM      une parenthese dans un message provoque l'erreur
REM      "X etait inattendu." et l'abandon immediat du script ;
REM    - affichage des accents correct : chcp 65001 ;
REM    - messages d'aide clairs : ZIP non extrait, projet non
REM      installe, Node absent.
REM ============================================================
title AUTO RH - Superadministrateur
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
echo Installez Node.js LTS depuis https://nodejs.org en laissant
echo toutes les options par defaut, puis relancez ce fichier.
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
echo [ERREUR] Le projet AUTO RH n'est pas encore installe sur ce PC
echo - dossier node_modules absent ou incomplet.
echo.
echo Demarrez une fois l'application avec DEMARRER-TOUT-WINDOWS.bat :
echo au premier demarrage elle installe automatiquement tout le
echo necessaire, 3 a 5 minutes, puis relancez CREER-SUPERADMIN-WINDOWS.bat.
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
