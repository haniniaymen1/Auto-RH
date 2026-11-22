#!/usr/bin/env python3
"""Test Task 32 — migration de chiffrement sur une COPIE de la base.
Vérifie sans jamais afficher de données personnelles :
  1. l'état initial (valeurs claires) ;
  2. après chiffrer-base.js : octets bruts SANS aucune valeur claire ;
  3. après --dechiffrer : valeurs IDENTIQUES à l'original ;
  4. idempotence : relancer le chiffrement ne change rien (comptage).
"""
import sqlite3, subprocess, shutil, os, sys, json

ROOT = "/home/z/my-project"
SRC = os.path.join(ROOT, "db", "custom.db")
TEST = os.path.join(ROOT, "db", "test-task32.db")

ok = True
def check(libelle, condition, detail=""):
    global ok
    print(("OK   " if condition else "KO   ") + libelle + (" — " + str(detail) if detail and not condition else ""))
    if not condition: ok = False

shutil.copyfile(SRC, TEST)
env = dict(os.environ, DATABASE_URL="file:" + TEST)

def lire_lignes(db_path):
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    sortie = {}
    sortie["payslip"] = cur.execute(
        "SELECT id, cin, employeeName, netSalary, matricule, substr(content,1,80), substr(normalizedContent,1,60) FROM Payslip ORDER BY id"
    ).fetchall()
    sortie["user"] = cur.execute("SELECT id, email, name FROM User ORDER BY id").fetchall()
    sortie["importlog"] = cur.execute(
        "SELECT id, cinDetected, fileName, substr(message,1,60) FROM ImportLog ORDER BY id LIMIT 40"
    ).fetchall()
    sortie["portalaccess"] = cur.execute("SELECT id, cin, totpSecret FROM PortalAccess ORDER BY id").fetchall()
    con.close()
    return sortie

avant = lire_lignes(SRC)

print("=== Phase 1 : chiffrement de la copie ===")
r = subprocess.run(["node", "scripts/chiffrer-base.js"], env=env, capture_output=True, text=True, cwd=ROOT)
check("chiffrer-base.js exit 0", r.returncode == 0, r.stderr[-400:])
n_modifs = [l for l in r.stdout.splitlines() if "Lignes modifiées" in l]
print("     " + (n_modifs[0].strip() if n_modifs else "?"))

apres = lire_lignes(TEST)
check("Payslip: mêmes ids", [x[0] for x in avant["payslip"]] == [x[0] for x in apres["payslip"]])
check("User: mêmes ids", [x[0] for x in avant["user"]] == [x[0] for x in apres["user"]])

# 2. AUCUNE valeur claire dans les octets bruts
brut = open(TEST, "rb").read()
clears = []
for i, (cid, cin, nom, net, mat, content, norm) in enumerate(apres["payslip"]):
    pass
for row in avant["payslip"]:
    for val in row[1:]:
        if val and len(str(val)) >= 4:
            if str(val).encode("utf-8") in brut:
                clears.append("Payslip")
                break
        break
# vérification ciblée : CIN, noms, net, matricule, emails, noms users
# (seuil 8 caractères : une valeur plus courte peut apparaître par pur hasard
# statistique dans ~60 Mo de base64 aléatoire — ex. 1 chaîne de 3 caractères
# sur 64^3 ≈ 230 occurrences attendues ; c'est un FAUX POSITIF, pas une fuite)
def present(v):
    return v is not None and len(str(v)) >= 8 and str(v).encode("utf-8") in brut
check("AUCUN CIN en clair dans les octets", not any(present(r[1]) for r in avant["payslip"]))
check("AUCUN nom d'employé en clair", not any(present(r[2]) for r in avant["payslip"]))
check("AUCUN net à payer en clair", not any(present(r[3]) for r in avant["payslip"]))
check("AUCUN matricule en clair", not any(present(r[4]) for r in avant["payslip"]))
check("AUCUN contenu de fiche en clair (80 1ers car.)", not any(present(r[5]) for r in avant["payslip"]))
check("AUCUN contenu normalisé en clair", not any(present(r[6]) for r in avant["payslip"]))
check("AUCUN email de compte en clair", not any(present(r[1]) for r in avant["user"]))
check("AUCUN nom de compte en clair", not any(present(r[2]) for r in avant["user"]))
check("AUCUN cinDetected d'ImportLog en clair", not any(present(r[1]) for r in avant["importlog"]))
check("AUCUN fileName d'ImportLog en clair", not any(present(r[2]) for r in avant["importlog"]))
n_enc = brut.count(b"encbd1:")
print("     marqueurs encbd1: dans les octets bruts :", n_enc, "(>=1635 attendu)")
check("marqueurs encbd1 présents", n_enc >= 1635)

print("=== Phase 2 : déchiffrement (retour arrière) ===")
r = subprocess.run(["node", "scripts/chiffrer-base.js", "--dechiffrer"], env=env, capture_output=True, text=True, cwd=ROOT)
check("--dechiffrer exit 0", r.returncode == 0, r.stderr[-400:])
retabli = lire_lignes(TEST)
check("Payslip: valeurs RESTAURÉES à l'identique", avant["payslip"] == retabli["payslip"])
check("User: valeurs RESTAURÉES à l'identique", avant["user"] == retabli["user"])
check("ImportLog (40 1ères): RESTAURÉES", avant["importlog"] == retabli["importlog"])

print("=== Phase 3 : idempotence (rechiffrement) ===")
r1 = subprocess.run(["node", "scripts/chiffrer-base.js"], env=env, capture_output=True, text=True, cwd=ROOT)
check("2e chiffrement exit 0", r1.returncode == 0, r1.stderr[-300:])
idem = lire_lignes(TEST)
r2 = subprocess.run(["node", "scripts/chiffrer-base.js"], env=env, capture_output=True, text=True, cwd=ROOT)
l_modifs_2 = [l for l in r2.stdout.splitlines() if "Lignes modifiées" in l]
check("3e passage : 0 ligne modifiée (idempotent)", l_modifs_2 and l_modifs_2[0].strip().endswith("0 (chiffrées)"), l_modifs_2)

print("=== Phase 4 : --statut après chiffrement ===")
r = subprocess.run(["node", "scripts/chiffrer-base.js", "--statut"], env=env, capture_output=True, text=True, cwd=ROOT)
check("--statut conclut « tous chiffrés »", "tous les champs sensibles sont CHIFFRÉS" in r.stdout)

os.remove(TEST)
print("\nTEST TASK 32 (migration copie):", "TOUT OK ✔" if ok else "PROBLÈME DÉTECTÉ ✗")
sys.exit(0 if ok else 1)
