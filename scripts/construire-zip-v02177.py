#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construit les ZIP de livraison v0.2.177 (Auto-RH) — CONFIDENTIALITÉ DE LA
DÉCISION FINALE dans le portail employé :

  - COMPLET : auto-rh-scripts-site-web-v0.2.177.zip
  - LEGER   : auto-rh-scripts-site-web-v0.2.177-leger.zip

Base : ZIP v0.2.176 (livraison vérifiée fonctionnelle, MD5 e9cc9d21e34d28c0ffda0c75045c7963).
Changements :
  1) scripts/portail-server.js — règle utilisateur v0.2.177 : pour les demandes
     de congé et d'autorisation de sortie, le statut final n'est exposé au
     portail employé QU'APRÈS les réponses du manager ET du service RH (tant
     que la matrice est EN_ATTENTE : décisions d'étape, commentaire de
     traitement et pièces jointes des réponses masqués + note affichée) ;
     révellation automatique dès la décision finale ; attestations/parrainage
     inchangés. Preuve E2E 46/46 + vérification visuelle navigateur.
  2) scripts/test_v02177_confidentialite_portail.js + seed_visuel_v02177.js +
     scripts/construire-zip-v02177.py + scripts/creer_readme_essentiel_v02177.py
     embarqués ;
  3) Les DEUX PDF readme embarqués remplacés par l'ÉDITION ESSENTIELLE
     v0.2.177 (9 pages — nouvelle règle documentée, durée du projet conservée) ;
  4) VERSION = 0.2.177, MANIFEST-LIVRAISON.txt régénéré.

Intégrité vérifiée (testzip) + contrôles + MD5 affichés.
"""
import os, zipfile, hashlib, shutil

REF_COMPLET = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.176.zip"
REF_LEGER   = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.176-leger.zip"
SORTIE      = "/home/z/my-project/download"
VERSION     = "v0.2.177"

README_NOUVEAU = "/home/z/my-project/download/servicerh-readme-technique-v0.2.177.pdf"
PORTAIL_MODIFIE = "/home/z/my-project/scripts/portail-server.js"
NOUVEAUX = {
    "scripts/test_v02177_confidentialite_portail.js": "/home/z/my-project/scripts/test_v02177_confidentialite_portail.js",
    "scripts/seed_visuel_v02177.js":                  "/home/z/my-project/scripts/seed_visuel_v02177.js",
    "scripts/creer_readme_essentiel_v02177.py":       "/home/z/my-project/scripts/creer_readme_essentiel_v02177.py",
    "scripts/construire-zip-v02177.py":               "/home/z/my-project/scripts/construire-zip-v02177.py",
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
            if n == "scripts/portail-server.js":
                out.write(PORTAIL_MODIFIE, n)  # remplacé par la version v0.2.177
                continue
            if n == "auto-rh-readme-technique.pdf":
                out.write(README_NOUVEAU, n)  # remplacé, même nom (COMPLET + LEGER)
                continue
            if n == "servicerh-readme-technique-reduit.pdf" and mode == "COMPLET":
                out.write(README_NOUVEAU, n)  # remplacé, même nom (COMPLET seul)
                continue
            out.writestr(n, ref.read(n))
        for arc, src in NOUVEAUX.items():
            out.write(src, arc)
        out.writestr("VERSION", "0.2.177\n")
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
    portail = zf.read("scripts/portail-server.js").decode("utf-8", "replace")
    verifs = {
        "testzip": bad is None,
        "VERSION 0.2.177": zf.read("VERSION").decode().strip() == "0.2.177",
        "README = édition essentielle (V0.2.177)": "V0.2.177" in sans_esp,
        "README = durée du projet présente": ("Duréeduprojet" in sans_esp and "30jours" in sans_esp
                                              and "177versions" in sans_esp),
        "README = règle confidentialité présente": ("Confidentialitédeladécision" in sans_esp
                                                    and "177" in sans_esp),
        "README = 9 pages": len(lecteur.pages) == 9,
        "README octets = fichier dev": contenu_readme == open(README_NOUVEAU, "rb").read(),
        "portail = règle decisionMasquee présente": "decisionMasquee" in portail,
        "portail = masquage EN_ATTENTE deux étapes": ('d.statut === "EN_ATTENTE"' in portail
                                                      and 'd.type === "CONGE"' in portail),
        "portail = note client présente": "Décision finale communiquée après les réponses du manager et du service RH" in portail,
        "portail = mention Auto-RH conservée": portail.count("Auto-RH") >= 25,
        "portail = magic/sels intacts": ("PAIESAGE1" in portail and "autorh-signature-v1" in portail),
        "test 177 embarqué": "scripts/test_v02177_confidentialite_portail.js" in noms,
        "seed visuel 177 embarqué": "scripts/seed_visuel_v02177.js" in noms,
        "générateur readme 177 embarqué": "scripts/creer_readme_essentiel_v02177.py" in noms,
        "route upload présente": "src/app/api/payslips/upload/route.ts" in noms,
        "test 405 embarqué": "scripts/test_correctif_405_upload.js" in noms,
        "reduit présent": "servicerh-readme-technique-reduit.pdf" in noms or mode == "LEGER",
        "0 lanceur supprimé": not any(x in noms for x in (
            "DEMARRER-WINDOWS.bat", "DEMARRER-TOUT-WINDOWS.bat",
            "DEMARRER-PORTAIL-WINDOWS.bat", "SCINDER-DOCX-WINDOWS.bat",
            "SCINDER-EXCEL-WINDOWS.bat", "SCINDER-FICHES-WINDOWS.bat",
            "SECURISER-DOSSIER-WINDOWS.bat", "SECURISER-DOSSIERS-WINDOWS.bat")),
        "0 artefact formation": not any("formation" in n for n in noms),
        "0 PDF v0.2.176 restant": not any("-v0.2.176.pdf" in n for n in noms),
    }
    zf.close()
    return verifs


def main():
    print("=== Construction v0.2.177 (confidentialité de la décision finale) ===\n")
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
