#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construit les ZIP de livraison v0.2.176 (Auto-RH) — README ÉDITION ESSENTIELLE :

  - COMPLET : auto-rh-scripts-site-web-v0.2.176.zip
  - LEGER   : auto-rh-scripts-site-web-v0.2.176-leger.zip

Base : ZIP v0.2.175 (correctif 405 vérifié, MD5 e627073d1235b4b6bf5e695d8d179fc3).
Changements :
  1) Les CINQ PDF readme embarqués (éditions v0.2.174, dont 3 doublons) sont
     remplacés par l'ÉDITION ESSENTIELLE v0.2.176 (9 pages, informations
     inutiles supprimées, DURÉE DU PROJET ajoutée — demande utilisateur) ;
     dédoublonnage : 2 entrées restent (auto-rh-readme-technique.pdf à la
     racine + servicerh-readme-technique-reduit.pdf pour compatibilité) ;
  2) scripts/creer_readme_essentiel_v02176.py + scripts/construire-zip-v02176.py
     embarqués ;
  3) VERSION = 0.2.176, MANIFEST-LIVRAISON.txt régénéré.

Intégrité vérifiée (testzip) + contrôles + MD5 affichés.
"""
import os, zipfile, hashlib, shutil

REF_COMPLET = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.175.zip"
REF_LEGER   = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.175-leger.zip"
SORTIE      = "/home/z/my-project/download"
VERSION     = "v0.2.176"

README_NOUVEAU = "/home/z/my-project/download/servicerh-readme-technique-v0.2.176.pdf"
# Entrées readme SUPPRIMÉES du ZIP complet (éditions v0.2.174 + doublons)
README_ANCIENS = {
    "auto-rh-readme-technique.pdf",
    "servicerh-readme-technique.pdf",
    "servicerh-readme-technique-v0.2.174.pdf",
    "servicerh-readme-technique-reduit.pdf",
    "servicerh-readme-technique-reduit-v0.2.174.pdf",
}
# Entrées readme CONSERVÉES/REMPLACÉES dans le ZIP complet (même contenu)
README_202176 = {
    "auto-rh-readme-technique.pdf": README_NOUVEAU,
    "servicerh-readme-technique-reduit.pdf": README_NOUVEAU,
}
NOUVEAUX = {
    "scripts/creer_readme_essentiel_v02176.py": "/home/z/my-project/scripts/creer_readme_essentiel_v02176.py",
    "scripts/construire-zip-v02176.py":         "/home/z/my-project/scripts/construire-zip-v02176.py",
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
        for n in noms:
            if n == "VERSION":
                continue  # remplacé plus bas
            if n == "auto-rh-readme-technique.pdf" and mode == "LEGER":
                out.write(README_NOUVEAU, n)  # remplacé, même nom
                continue
            if n in README_ANCIENS:
                continue  # remplacés par l'édition essentielle (mode COMPLET)
            out.writestr(n, ref.read(n))
        if mode == "COMPLET":
            for arc, src in README_202176.items():
                out.write(src, arc)
        for arc, src in NOUVEAUX.items():
            out.write(src, arc)
        out.writestr("VERSION", "0.2.176\n")
    ref.close()
    # MANIFEST régénéré
    zf = zipfile.ZipFile(chemin_sortie)
    entrees = sorted(i.filename for i in zf.infolist() if i.filename != "MANIFEST-LIVRAISON.txt")
    taille = {i.filename: i.file_size for i in zf.infolist()}
    corps = [f"{taille[n]}\t{n}" for n in entrees]
    with zipfile.ZipFile(chemin_sortie, "a", zipfile.ZIP_DEFLATED) as out:
        out.writestr("MANIFEST-LIVRAISON.txt",
                     f"MODE={mode}\nVERSION={VERSION}\nFICHIERS={len(entrees)}\n" + "\n".join(corps) + "\n")
    zf.close()
    return chemin_sortie, len(entrees) + 1


def verifier(chemin, mode):
    zf = zipfile.ZipFile(chemin)
    bad = zf.testzip()
    noms = set(zf.namelist())
    from pypdf import PdfReader
    import io
    contenu_readme = zf.read("auto-rh-readme-technique.pdf")
    lecteur = PdfReader(io.BytesIO(contenu_readme))
    texte = " ".join((p.extract_text() or "") for p in lecteur.pages)
    sans_esp = "".join(texte.split())
    verifs = {
        "testzip": bad is None,
        "VERSION 0.2.176": zf.read("VERSION").decode().strip() == "0.2.176",
        "README = édition essentielle (V0.2.176)": "V0.2.176" in sans_esp,
        "README = durée du projet présente": ("Duréeduprojet" in sans_esp and "30jours" in sans_esp
                                              and "176versions" in sans_esp),
        "README = 9 pages": len(lecteur.pages) == 9,
        "README octets = fichier dev": contenu_readme == open(README_NOUVEAU, "rb").read(),
        "0 PDF v0.2.174 restant": not any("-v0.2.174.pdf" in n for n in noms),
        "0 doublon servicerh-readme-technique.pdf (complet)": (
            mode == "LEGER" or "servicerh-readme-technique.pdf" not in noms),
        "reduit présent": "servicerh-readme-technique-reduit.pdf" in noms or mode == "LEGER",
        "route upload présente": "src/app/api/payslips/upload/route.ts" in noms,
        "test 405 embarqué": "scripts/test_correctif_405_upload.js" in noms,
        "générateur 176 embarqué": "scripts/creer_readme_essentiel_v02176.py" in noms,
        "0 lanceur supprimé": not any(x in noms for x in (
            "DEMARRER-WINDOWS.bat", "DEMARRER-TOUT-WINDOWS.bat",
            "DEMARRER-PORTAIL-WINDOWS.bat", "SCINDER-DOCX-WINDOWS.bat",
            "SCINDER-EXCEL-WINDOWS.bat", "SCINDER-FICHES-WINDOWS.bat",
            "SECURISER-DOSSIER-WINDOWS.bat", "SECURISER-DOSSIERS-WINDOWS.bat")),
        "0 artefact formation": not any("formation" in n for n in noms),
    }
    zf.close()
    return verifs


def main():
    print("=== Construction v0.2.176 (README édition essentielle + durée du projet) ===\n")
    for ref, nom, mode in [
        (REF_COMPLET, f"auto-rh-scripts-site-web-{VERSION}.zip", "COMPLET"),
        (REF_LEGER,   f"auto-rh-scripts-site-web-{VERSION}-leger.zip", "LEGER"),
    ]:
        chemin, n = construire(ref, nom, mode)
        taille = os.path.getsize(chemin)
        empreinte = md5(chemin)
        v = verifier(chemin, mode)
        print(f"--- {nom}")
        print(f"    entrées={n}  taille={taille:,} o  MD5={empreinte}")
        for k, okk in v.items():
            print(f"    [{'OK' if okk else 'FAIL'}] {k}")
        print()
    for src, dst in [
        (f"auto-rh-scripts-site-web-{VERSION}.zip", "auto-rh-scripts-site-web.zip"),
        (f"auto-rh-scripts-site-web-{VERSION}-leger.zip", "auto-rh-scripts-site-web-leger.zip"),
    ]:
        shutil.copyfile(os.path.join(SORTIE, src), os.path.join(SORTIE, dst))
        m1 = md5(os.path.join(SORTIE, src)); m2 = md5(os.path.join(SORTIE, dst))
        print(f"copie générique {dst} : {'IDENTIQUE' if m1 == m2 else 'DIVERGENCE !!'} (MD5 {m1})")


if __name__ == "__main__":
    main()
