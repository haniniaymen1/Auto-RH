#!/usr/bin/env python3
"""Packaging Task 102 — ZIP v0.2.30 depuis la base exacte 0.2.29 + 6 entrées.
Base = octets VÉRIDIQUES du ZIP 0.2.29 (copie verbatim des entrées inchangées) ;
5 fichiers remplacés (contenu corrigé, attributs d'origine conservés) ;
1 LIRE-MOI ajouté (attributs calqués sur LIRE-MOI-PAGINATION.txt).
Contrôles : 0 doublon, 0 artefact interdit, taille/CRC, liste = 0.2.29 + 1."""
import zipfile, os, sys

SRC = "/home/z/my-project/task101_import/auto-rh-scripts-site-web-v0.2.29.zip"
APP = "/home/z/my-project/task102_smtp/app"
OUT = "/home/z/my-project/task102_smtp/auto-rh-scripts-site-web-v0.2.30.zip"

REMPLACES = [
    "package.json",
    "package-lock.json",
    "src/app/api/mail-config/route.ts",
    "src/components/payslip/mail-panel.tsx",
    "src/lib/mailer.ts",
]
AJOUT = "LIRE-MOI-CORRECTIF-SMTP-SECURITE.txt"
INTERDITS = (".env", "db/", "node_modules/", ".next/", "storage/", "logs/", "dev.log", "tsconfig.tsbuildinfo", "next-env.d.ts")

src = zipfile.ZipFile(SRC, "r")
orig = {i.filename: i for i in src.infolist()}

if os.path.exists(OUT):
    os.remove(OUT)
out = zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED)

ajout_ecrit = False
for name in src.namelist():
    info = orig[name]
    if name.endswith("/"):  # entrée répertoire : copie verbatim
        out.writestr(info, src.read(name))
        continue
    if name in REMPLACES:
        with open(os.path.join(APP, name), "rb") as f:
            data = f.read()
        ni = zipfile.ZipInfo(name, date_time=info.date_time)
        ni.external_attr = info.external_attr      # attributs d'origine conservés
        ni.compress_type = zipfile.ZIP_DEFLATED
        out.writestr(ni, data)
    else:
        out.writestr(info, src.read(name))          # entrée inchangée : verbatim
    if not ajout_ecrit and name.startswith("LIRE-MOI-PAGINATION"):
        with open(os.path.join(APP, AJOUT), "rb") as f:
            data = f.read()
        ni = zipfile.ZipInfo(AJOUT, date_time=info.date_time)
        ni.external_attr = info.external_attr      # mêmes droits que les LIRE-MOI
        ni.compress_type = zipfile.ZIP_DEFLATED
        out.writestr(ni, data)
        ajout_ecrit = True

out.close(); src.close()

# ------------------------- contrôles ---------------------------------------
z = zipfile.ZipFile(OUT, "r")
names = z.namelist()
assert not ajout_ecrit or AJOUT in names, "LIRE-MOI manquant"
doublons = len(names) - len(set(names))
bad = z.testzip()
interdits = [n for n in names for p in INTERDITS if p in n and n != "package.json" and "LIRE-MOI" not in n and not n.endswith("package.json")]
# contrôle fin : artefacts interdits = fichiers RÉELS (.env, db/custom.db, …)
interdits_fins = [n for n in names
                  if n.split("/")[-1] == ".env"
                  or "/db/" in ("/" + n) or n.startswith("db/")
                  or "node_modules/" in n or ".next/" in n
                  or n.startswith("storage/") or "/storage/" in n
                  or n.startswith("logs/") or "/logs/" in n
                  or n == "dev.log" or n == "tsconfig.tsbuildinfo" or n == "next-env.d.ts"]
md5_local = None
import hashlib
h = hashlib.md5()
with open(OUT, "rb") as f:
    for chunk in iter(lambda: f.read(1 << 20), b""):
        h.update(chunk)
md5_local = h.hexdigest()

nouvelles = [n for n in names if n not in orig]
absentes = [n for n in orig if n not in names]
print(f"entrées ZIP 0.2.30 : {len(names)} (0.2.29 : {len(orig)} ; +{len(nouvelles)} nouvelles)")
print("nouvelles entrées :", nouvelles)
print("entrées absentes  :", absentes or "aucune")
print(f"doublons : {doublons} | CRC : {'OK' if bad is None else 'ERREUR ' + bad}")
print(f"artefacts interdits : {interdits_fins or 'aucun'}")
print(f"taille : {os.path.getsize(OUT):,} octets | MD5 : {md5_local}")
verif_version = z.read("package.json").decode()
print("version package.json embarquée :", '"0.2.30"' in verif_version)
ok = (doublons == 0 and bad is None and not interdits_fins and len(nouvelles) == 1
      and not absentes and '"0.2.30"' in verif_version)
print("VERDICT PACKAGING :", "OK" if ok else "ÉCHEC")
sys.exit(0 if ok else 1)
