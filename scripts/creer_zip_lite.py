#!/usr/bin/env python3
# Task 212 — ZIP allégé AutoRH (ex-Auto-RH) (~9 Mo), format historique de la
# série auto-rh-scripts-site-web-v0.2.x renommée servicerh-scripts-site-web :
# code + scripts + OCR fra.traineddata
# + fichiers de test légers. SANS db/ (17 Mo), storage/ (66 Mo), tessdata/,
# documents-demandes/, gros PDF de test (>= 1 Mo) ni captures d'écran.
import os, glob, zipfile, time

ROOT = "/home/z/my-project"
# (Task 253 — README PDF réduit v0.2.134 ajouté à l'archive) version incrémentée :
# v0.2.134 → v0.2.135
VERSION = "v0.2.138"
OUT = os.path.join(ROOT, "download", f"servicerh-scripts-site-web-{VERSION}.zip")

total = 0
files = []
manquants = []

def add(arc, disk):
    global total
    if not os.path.isfile(disk):
        manquants.append(disk)
        return
    files.append((arc, disk))
    total += os.path.getsize(disk)

# 1) Dossiers entiers légers : src, public, prisma
for d in ("src", "public", "prisma"):
    for dp, dns, fns in os.walk(os.path.join(ROOT, d)):
        dns[:] = [x for x in dns if not x.startswith(".") and x != "node_modules"]
        for fn in fns:
            full = os.path.join(dp, fn)
            if not os.path.islink(full):
                add(os.path.relpath(full, ROOT), full)

# 2) ocr-data : uniquement fra.traineddata (comme dans la série)
add("ocr-data/fra.traineddata", os.path.join(ROOT, "ocr-data", "fra.traineddata"))

# 3) scripts : uniquement les fichiers de premier niveau (pas taskNNN/, etc.)
#    Exclus : artefacts de debug (captures PNG, PDF readme dupliqué, test OCR)
SC_EXCLURE = {"auto-rh-readme-technique-v0.2.46.pdf", "ocr_test_fiche_image.pdf",
    # (Task 173) échantillons de debug Task 169 (pages extraites) :
    "ancien_layout.txt", "echantillon_3_fiches.pdf", "echantillon_debut_3.pdf",
    "echantillon_milieu.pdf", "echantillon_milieu_3.pdf",
    # (Task 245) sauvegarde locale de restauration d'environnement
    "backup-etat-regrade-20261002.tar.gz", "cookies.txt",
    # (Task 252) stub auto-généré par stub-server-only.cjs (artefact local)
    "stub-vide.cjs"}
sc = os.path.join(ROOT, "scripts")
for fn in sorted(os.listdir(sc)):
    full = os.path.join(sc, fn)
    if os.path.isfile(full) and not fn.lower().endswith(".png") \
            and fn not in SC_EXCLURE:
        add(os.path.join("scripts", fn), full)

# 4) test-data : tout SAUF gros fichiers (>= 1 Mo) et captures d'écran
td = os.path.join(ROOT, "test-data")
for dp, dns, fns in os.walk(td):
    for fn in sorted(fns):
        full = os.path.join(dp, fn)
        rel = os.path.relpath(full, ROOT)
        if os.path.getsize(full) >= 1024 * 1024:
            continue
        if "/screenshot-" in rel:
            continue
        add(rel, full)

# 5) Chemin spécial conservé de la série
add("home/z/my-project/scripts/apply_specimen_update.py",
    os.path.join(ROOT, "home", "z", "my-project", "scripts", "apply_specimen_update.py"))

# 6) Fichiers racine : liste blanche explicite + tous les lanceurs .bat/.vbs/.sh
RACINE_FIXES = [
    "README-DEPLOIEMENT-LOCAL.md",
    "package.json", "package-lock.json",
    "next.config.ts", "tailwind.config.ts", "tsconfig.json",
    "components.json", "postcss.config.mjs", "eslint.config.mjs",
    "Dockerfile", "docker-compose.yml", ".dockerignore", ".env.example",
    "servicerh-readme-technique.pdf",
    "servicerh-readme-technique-reduit.pdf",
    "servicerh-support-formation-rh.pdf",
]
RACINE_EXCLURE = {
    ".env", ".gitignore", "bun.lock", "page.tsx", "next-env.d.ts",
    "Caddyfile", "fra.traineddata", "tsconfig.tsbuildinfo",
    ".initial_snapshot.json", ".pending_clone.json", "worklog.md",
    # Lanceurs exclus à la demande de l'utilisateur (Task 165 + 168)
    "SCINDER-DOCX-WINDOWS.bat", "SCINDER-EXCEL-WINDOWS.bat",
    "SCINDER-FICHES-WINDOWS.bat", "SECURISER-DOSSIERS-WINDOWS.bat",
    "SECURISER-DOSSIER-WINDOWS.bat", "DEMARRER-TOUT-WINDOWS.bat",
    "DEMARRER-WINDOWS.bat", "CHIFFRER-FICHES-SILENCIEUX-WINDOWS.vbs",
    "DEMARRER-PORTAIL-WINDOWS.bat",
}
racine_inclus = set()
for pat in RACINE_FIXES:
    add(pat, os.path.join(ROOT, pat))
    racine_inclus.add(pat)
for pat in ("*.bat", "*.vbs", "*.sh"):
    # NB : les LIRE-MOI-*.txt sont exclus à la demande de l'utilisateur (Task 166)
    for full in glob.glob(os.path.join(ROOT, pat)):
        fn = os.path.basename(full)
        if fn not in RACINE_EXCLURE and fn not in racine_inclus:
            add(fn, full)
            racine_inclus.add(fn)

print(f"Fichiers à archiver : {len(files)}")
print(f"Taille brute        : {total/1024/1024:.1f} Mo")
if manquants:
    print("ATTENTION, fichiers manquants :")
    for m in manquants:
        print("  -", m)

t0 = time.time()
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for arc, disk in files:
        z.write(disk, arc)

with zipfile.ZipFile(OUT) as z:
    bad = z.testzip()
    n = len(z.infolist())
size = os.path.getsize(OUT)
print(f"ZIP créé            : {OUT}")
print(f"Intégrité           : {'OK' if bad is None else 'CORROMPU: ' + bad}")
print(f"Entrées             : {n}")
print(f"Taille ZIP          : {size/1024/1024:.2f} Mo ({time.time()-t0:.0f} s)")
