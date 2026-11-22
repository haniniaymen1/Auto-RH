#!/usr/bin/env bash
# ============================================================
#   AUTO RH (PaieSage) - Creation / gestion du SUPERADMINISTRATEUR
#   sous LINUX / macOS  (rafraichi v0.2.211 - moteur :
#   scripts/creer-superadmin.js)
#
#   Equivalent Linux/macOS de CREER-SUPERADMIN-WINDOWS.bat :
#   lance le menu interactif scripts/creer-superadmin.js
#     1) Voir l'etat des comptes (RH / IT / Superadmin)
#     2) CREER un compte superadministrateur
#     3) PROMOUVOIR un compte existant
#   Le superadministrateur gere les comptes depuis l'onglet
#   " Utilisateurs " de l'administration (http://localhost:PORT du
#   fichier .env - 4000 par defaut) : activation, suppression,
#   mot de passe, changement de role.
#
#   Utilisation :
#     bash CREER-SUPERADMIN-LINUX-MAC.sh
#   (ou : chmod +x CREER-SUPERADMIN-LINUX-MAC.sh puis ./CREER-SUPERADMIN-LINUX-MAC.sh)
#
#   Mode DIRECT sans menu (console de gestion) :
#     bash gestion.sh superadmin --creer --email a@b.tn --nom "Nom" --password "Mot2Passe!"
#   Mot de passe : 8 caracteres minimum, avec majuscule, minuscule,
#   chiffre et symbole.
#   IDEMPOTENT : au premier demarrage sur une base vierge, le compte
#   superadministrateur est deja cree automatiquement (SUPERADMIN_AUTO=1)
#   - ce script sert alors a le retrouver, le completer ou en creer
#   un supplementaire, jamais a creer un doublon.
#
#   Astuce : le mot de passe tape ne s'affiche pas, c'est normal.
#   La base livree dans le ZIP est VIERGE (scripts/base-vierge) : le
#   premier compte cree avec ce menu devient l'administrateur.
# ============================================================
cd "$(cd "$(dirname "$0")" && pwd)" || exit 1

# --- 1) Node.js present ? ----------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "[ERREUR] Node.js est introuvable sur ce systeme."
  echo "Installez Node.js 20 ou plus recent :"
  echo "  - https://nodejs.org"
  echo "  - ou (Ubuntu/Debian) : curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "                          sudo apt install -y nodejs"
  echo "puis relancez ce script."
  exit 1
fi

# --- 2) ZIP decomprime ? -----------------------------------------------------
if [ ! -f "scripts/creer-superadmin.js" ]; then
  echo ""
  echo "[ERREUR] scripts/creer-superadmin.js est introuvable."
  echo "Ce script fait partie du ZIP complet site-web-Auto-RH-v0.2.211.zip :"
  echo "decompressez le ZIP entier et lancez CREER-SUPERADMIN-LINUX-MAC.sh"
  echo "depuis la racine du dossier obtenu."
  exit 1
fi

# --- 3) Projet installe (dependances presentes) ? ----------------------------
if [ ! -d "node_modules/@prisma/client" ]; then
  echo ""
  echo "[ERREUR] Le projet n'est pas encore installe (node_modules absent)."
  echo "Lancez d'abord : bash INSTALLER-ET-DEMARRER-LINUX-MAC.sh"
  echo "(il installe les dependances, cree la base et demarre les interfaces,"
  echo "3 a 5 minutes au premier lancement), puis relancez ce script."
  exit 1
fi

# --- 4) Menu interactif -------------------------------------------------------
echo ""
echo "Ouverture du menu Superadministrateur..."
echo "Astuce : le mot de passe tape ne s'affiche pas, c'est normal."
echo ""
exec node scripts/creer-superadmin.js
