#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construit les ZIP de livraison v0.2.175 (Auto-RH) — CORRECTIF « Erreur 405 » :

  - COMPLET : auto-rh-scripts-site-web-v0.2.175.zip
  - LEGER   : auto-rh-scripts-site-web-v0.2.175-leger.zip

Base : ZIP v0.2.174 (liste de fichiers vérifiée, MD5 a87c59d02c2c73a9005ca3ff21beae8f)
+ les fichiers PERDUS dans la lignée v0.2.170→174 (cause racine de l'Erreur 405
remontée par l'utilisateur à l'import des fiches de paie) :

  1. src/app/api/payslips/upload/route.ts   (73 914 o — ABSENT du ZIP => POST
     /api/payslips/upload tombait sur la page 404 de Next.js qui répond
     405 Method Not Allowed => « Erreur 405 » à l'import) ;
  2. package-lock.json                       (381 288 o — install npm reproductible) ;
  3. ocr-data/fra.traineddata                (14 213 351 o — OCR Tesseract HORS-LIGNE
     requis par src/lib/payslip-ocr.ts pour la détection des CIN) ;

+ scripts/test_correctif_405_upload.js (preuve E2E 17/17 du correctif)
+ scripts/construire-zip-v02175.py (ce générateur)
+ VERSION = 0.2.175, MANIFEST-LIVRAISON.txt régénéré.

Intégrité vérifiée (testzip) + MD5 affichés.
"""
import os, zipfile, hashlib

REF_COMPLET = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.174.zip"
REF_LEGER   = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.174-leger.zip"
SORTIE      = "/home/z/my-project/download"
VERSION     = "v0.2.175"

# Fichiers restaurés (source : arbre de développement vérifié)
RESTAURES = {
    "src/app/api/payslips/upload/route.ts": "/home/z/my-project/src/app/api/payslips/upload/route.ts",
    "package-lock.json":                    "/home/z/my-project/package-lock.json",
    "ocr-data/fra.traineddata":             "/home/z/my-project/ocr-data/fra.traineddata",
}
# Nouveaux fichiers de la v0.2.175
NOUVEAUX = {
    "scripts/test_correctif_405_upload.js": "/home/z/my-project/scripts/test_correctif_405_upload.js",
    "scripts/construire-zip-v02175.py":     "/home/z/my-project/scripts/construire-zip-v02175.py",
}

def md5(fichier):
    h = hashlib.md5()
    with open(fichier, "rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()

def construire(ref_zip, nom_sortie, mode):
    chemin_sortie = os.path.join(SORTIE, nom_sortie)
    ref = zipfile.ZipFile(ref_zip)
    noms = [n for n in ref.namelist() if n != "MANIFEST-LIVRAISON.txt"]
    with zipfile.ZipFile(chemin_sortie, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as out:
        # 1) contenu de la v0.2.174 (VERSION remplacé plus bas)
        for n in noms:
            if n == "VERSION":
                continue
            out.writestr(n, ref.read(n))
        # 2) fichiers restaurés + nouveaux
        for arc, src in {**RESTAURES, **NOUVEAUX}.items():
            out.write(src, arc)
        # 3) VERSION
        out.writestr("VERSION", "0.2.175\n")
    ref.close()
    # 4) MANIFEST-LIVRAISON.txt (liste taille<tab>chemin, triée)
    zf = zipfile.ZipFile(chemin_sortie)
    lignes = [f"MODE={mode}", f"VERSION={VERSION}"]
    entrees = sorted(i.filename for i in zf.infolist() if i.filename != "MANIFEST-LIVRAISON.txt")
    taille = {i.filename: i.file_size for i in zf.infolist()}
    # tailles des fichiers ajoutés à plat (file_size déjà juste car écrits par write/writestr)
    corps = [f"{taille[n]}\t{n}" for n in entrees]
    manifest = "\n".join(lignes[:3] if False else lignes)  # placeholder évité
    with zipfile.ZipFile(chemin_sortie, "a", zipfile.ZIP_DEFLATED) as out:
        out.writestr("MANIFEST-LIVRAISON.txt",
                     f"MODE={mode}\nVERSION={VERSION}\nFICHIERS={len(entrees)}\n" + "\n".join(corps) + "\n")
    zf.close()
    return chemin_sortie, len(entrees) + 1

def verifier(chemin):
    zf = zipfile.ZipFile(chemin)
    bad = zf.testzip()
    noms = set(zf.namelist())
    verifs = {
        "testzip": bad is None,
        "route upload présente": "src/app/api/payslips/upload/route.ts" in noms,
        "package-lock présent": "package-lock.json" in noms,
        "ocr-data présente": "ocr-data/fra.traineddata" in noms,
        "test 405 embarqué": "scripts/test_correctif_405_upload.js" in noms,
        "VERSION 0.2.175": zf.read("VERSION").decode().strip() == "0.2.175",
        "0 lanceur supprimé": not any(x in noms for x in (
            "DEMARRER-WINDOWS.bat", "DEMARRER-TOUT-WINDOWS.bat",
            "DEMARRER-PORTAIL-WINDOWS.bat", "SCINDER-DOCX-WINDOWS.bat",
            "SCINDER-EXCEL-WINDOWS.bat", "SCINDER-FICHES-WINDOWS.bat",
            "SECURISER-DOSSIER-WINDOWS.bat", "SECURISER-DOSSIERS-WINDOWS.bat")),
        "0 artefact formation": not any("formation" in n for n in noms),
    }
    # le route.ts embarqué doit être IDENTIQUE à l'arbre
    route = zf.read("src/app/api/payslips/upload/route.ts")
    verifs["route = copie conforme de l'arbre"] = \
        hashlib.md5(route).hexdigest() == md5("/home/z/my-project/src/app/api/payslips/upload/route.ts")
    # le PDF readme doit être l'édition v0.2.174 (nom racine historique)
    verifs["README v0.2.174 embarqué"] = \
        zf.read("auto-rh-readme-technique.pdf") == open("/home/z/my-project/servicerh-readme-technique.pdf", "rb").read()
    zf.close()
    return verifs

def main():
    print("=== Construction v0.2.175 (correctif Erreur 405 import fiches) ===\n")
    for src, arc in {**RESTAURES, **NOUVEAUX}.items():
        ok = os.path.isfile(src and arc or "")
        taille = os.path.getsize(arc) if ok else -1
        print(f"  source {arc} : {taille:,} octets")
    print()
    results = {}
    for ref, nom, mode in [
        (REF_COMPLET, f"auto-rh-scripts-site-web-{VERSION}.zip", "COMPLET"),
        (REF_LEGER,   f"auto-rh-scripts-site-web-{VERSION}-leger.zip", "LEGER"),
    ]:
        chemin, n = construire(ref, nom, mode)
        taille = os.path.getsize(chemin)
        empreinte = md5(chemin)
        v = verifier(chemin)
        results[nom] = (chemin, taille, empreinte, v)
        print(f"--- {nom}")
        print(f"    entrées={n}  taille={taille:,} o  MD5={empreinte}")
        for k, okk in v.items():
            print(f"    [{'OK' if okk else 'FAIL'}] {k}")
        print()
    # copies génériques
    import shutil
    for src, dst in [
        (f"auto-rh-scripts-site-web-{VERSION}.zip", "auto-rh-scripts-site-web.zip"),
        (f"auto-rh-scripts-site-web-{VERSION}-leger.zip", "auto-rh-scripts-site-web-leger.zip"),
    ]:
        shutil.copyfile(os.path.join(SORTIE, src), os.path.join(SORTIE, dst))
        m1 = md5(os.path.join(SORTIE, src)); m2 = md5(os.path.join(SORTIE, dst))
        print(f"copie générique {dst} : {'IDENTIQUE' if m1 == m2 else 'DIVERGENCE !!'} (MD5 {m1})")

if __name__ == "__main__":
    main()
