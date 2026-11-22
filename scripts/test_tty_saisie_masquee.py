#!/usr/bin/env python3
"""Task 34 correctif .bat — test TTY réel du menu creer-superadmin.js.

Simule un vrai terminal (comme le double-clic Windows) via pty :
 1. Le mot de passe ne doit PAS apparaître en clair (uniquement des '*').
 2. Le compte doit être réellement créé (message de succès).
 3. Les accents dans le mot de passe doivent être acceptés.
Le compte de test est ensuite supprimé par l'appelant (supprime-utilisateur.js).
"""
import pty, os, sys, time, select

pid, fd = pty.fork()
if pid == 0:
    os.execvp("node", ["node", "scripts/creer-superadmin.js"])

SORTIE = b""

def lire(dispo=0.8):
    global SORTIE
    r, _, _ = select.select([fd], [], [], dispo)
    if r:
        try:
            SORTIE += os.read(fd, 4096)
        except OSError:
            pass

time.sleep(1.5); lire()
os.write(fd, b"2\r")                        # choix 2 : créer
time.sleep(0.8); lire()
os.write(fd, b"test.tty@example.tn\r")      # email
time.sleep(0.8); lire()
os.write(fd, b"Utilisateur TTY\r")          # nom
time.sleep(0.8); lire()
os.write(fd, "Mot2PasseÉàç!\r".encode("utf-8"))   # mot de passe AVEC accents
time.sleep(0.8); lire()
os.write(fd, "Mot2PasseÉàç!\r".encode("utf-8"))   # confirmation
time.sleep(2.0); lire(1.5)

texte = SORTIE.decode("utf-8", "replace")
print(texte)
print("=== ANALYSE ===")
mdp_clair = "Mot2Passe" in texte.replace("Mot de passe", "").replace("Mot2Passe", "TROUVE")
# le mot de passe littéral ne doit apparaître nulle part SAUF si c'est notre recherche même
echos = [l for l in texte.splitlines() if "TROUVE" not in l and "Mot2PasseÉàç" in l]
print("1) Echo mot de passe en clair (doit être FAUX):", bool(echos), echos)
asterisques = texte.count("*")
print("2) Caractères '*' affichés (masque, attendu > 20):", asterisques)
succes = "CRÉÉ" in texte or "CREE" in texte
print("3) Message de création (attendu VRAI):", succes)
sys.exit(0 if (not echos and asterisques > 20 and succes) else 1)
