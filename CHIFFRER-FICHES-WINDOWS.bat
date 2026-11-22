@echo off
REM ============================================================
REM   Fiches de Paie - CHIFFRER LE DOSSIER DES FICHES - WINDOWS
REM
REM   Chiff TOUTES les fiches de storage\payslips en AES-256.
REM   Apres chiffrement, un fichier ouvert directement sur le
REM   disque est ILLISIBLE ; le site et le portail fonctionnent
REM   normalement (dechiffrement a la volee pour les connects).
REM
REM   !!!!!  IMPORTANT  !!!!!
REM   La cle de chiffrement est stockee dans le fichier .env.
REM   SANS LE FICHIER .env, LES FICHES CHIFFREES SONT IRRÉCUPÉRABLES.
REM   -> Copiez le fichier .env sur une cle USB en lieu sur AVANT.
REM
REM   [1] Verifier l'etat actuel
REM   [2] CHIFFRER toutes les fiches
REM   [3] DECHIFFRER (retour arriere)
REM ============================================================
setlocal EnableDelayedExpansion
title Fiches de Paie - Chiffrement des fiches (AES-256)
cd /d "%~dp0"

:MENU
cls
echo.
echo ============================================================
echo   Fiches de Paie - Chiffrement du dossier des fiches
echo ============================================================
echo   La cle vit dans le fichier .env : SAUVEGARDEZ .env !
echo.
echo   [1] Verifier l'etat actuel
echo   [2] CHIFFRER toutes les fiches
echo   [3] DECHIFFRER (retour arriere)
echo   [0] Quitter
echo.
set /p CHOICE="  Votre choix : "

if "%CHOICE%"=="1" goto CHECK
if "%CHOICE%"=="2" goto ENCRYPT
if "%CHOICE%"=="3" goto DECRYPT
if "%CHOICE%"=="0" endlocal & exit /b 0
goto MENU

:CHECK
echo.
node scripts\chiffrer-storage.js --verifier
echo.
pause
goto MENU

:ENCRYPT
echo.
echo   Avez-vous une SAUVEGARDE du fichier .env ?
set /p CONF="   tapez OUI pour continuer : "
if /I not "%CONF%"=="OUI" (
    echo   Operation annulee. Sauvegardez .env puis revenez.
    pause
    goto MENU
)
echo.
echo   Conseil : fermez le site et le portail pendant le chiffrement,
echo   puis relancez-les avec DEMARRER-TOUT-WINDOWS.bat.
echo.
node scripts\chiffrer-storage.js
echo.
pause
goto MENU

:DECRYPT
echo.
echo   Retour arriere : les fiches chiffrees redeviennent des fichiers
echo   normaux (necessite la cle du .env).
echo.
node scripts\chiffrer-storage.js --dechiffrer
echo.
pause
goto MENU
