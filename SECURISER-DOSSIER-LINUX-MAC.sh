#!/bin/sh
# ============================================================
#  Fiches de Paie — SÉCURISER LES FICHIERS STOCKÉS — LINUX / MAC
#  Verrouille storage/payslips, db et .env (chmod 700/600).
#  Usage : sh SECURISER-DOSSIER-LINUX-MAC.sh [check|restore]
# ============================================================
cd "$(dirname "$0")" || exit 1

lock() {
    echo "[1/3] Verrouillage de storage/payslips ..."
    [ -d "storage/payslips" ] && chmod 700 storage storage/payslips && echo "   OK" || echo "   [INFO] introuvable"
    echo "[2/3] Verrouillage de la base db/ ..."
    [ -d "db" ] && chmod 700 db && chmod 600 db/*.db 2>/dev/null; echo "   OK"
    echo "[3/3] Verrouillage du fichier .env ..."
    [ -f ".env" ] && chmod 600 .env && echo "   OK" || echo "   [INFO] introuvable"
    echo "Reversible : sh SECURISER-DOSSIER-LINUX-MAC.sh restore"
}

check() {
    for p in storage/payslips db .env; do
        [ -e "$p" ] && echo "--- $p : $(ls -ld "$p" | awk '{print $1}')" || echo "--- $p : introuvable"
    done
    echo "drwx------ / -rw------- = verrouille"
}

restore() {
    [ -d "storage" ] && chmod 755 storage storage/payslips 2>/dev/null
    [ -d "db" ] && chmod 755 db && chmod 644 db/*.db 2>/dev/null
    [ -f ".env" ] && chmod 644 .env
    echo "Permissions standard restaurees."
}

case "$1" in
    check)   check ;;
    restore) restore ;;
    *)       lock ;;
esac
