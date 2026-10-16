@echo off
REM ============================================================
REM   Fiches de Paie - SAUVEGARDE CHIFFREE de la base de donnees
REM
REM   Double-cliquez sur ce fichier : une copie CHIFREE (AES-256)
REM   de db\custom.db est creee dans backups\.
REM
REM   - Les sauvegardes sont chiffrees avec la cle du site
REM     (AUTO_RH_STORAGE_KEY dans .env) : illisibles sans elle.
REM   - Rotation automatique : les 10 plus recentes sont gardees.
REM
REM   Restauration :
REM     node scripts\sauvegarde-bd.js --liste
REM     node scripts\sauvegarde-bd.js --restaurer "SERVICE-RH-BD-..." --sortie db\custom.db
REM
REM   CONSEIL : sauvegardez regulierement (chaque import de fiches)
REM   et de preference APRES avoir arrete les serveurs.
REM ============================================================
title Fiches de Paie - Sauvegarde chiffree de la base
cd /d "%~dp0"

node -v >nul 2>nul
if errorlevel 1 (
    echo.
    echo [ERREUR] Node.js n'est pas installe. Installez la version LTS depuis https://nodejs.org
    echo.
    pause
    exit /b 1
)

node scripts\sauvegarde-bd.js

echo.
pause
