#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Construit les ZIP de livraison v0.2.205 (Service RH) — GUIDE PDF ENRICHI
(installation / démarrage / changement des ports des deux interfaces,
Windows ET Linux — demande utilisateur v0.2.205).

Méthode : PART des livraisons v0.2.204 (complet + léger), remplace :
  - service-rh-readme-technique.pdf       ← PDF v0.2.205 (25 pages, section 3
    réécrite : installer, démarrer/arrêter, changer les ports — les 2 systèmes)
  - VERSION                                ← 0.2.205
  - GUIDE-INSTALLATION-LINUX-WINDOWS.txt   ← note README PDF + fin v0.2.205
  - MANIFEST-LIVRAISON.txt                 ← régénéré par zip
ajoute les entrées nouvelles (test dédié + constructeur embarqués),
déduplique, préserve les attributs Unix (ZipInfo CLONÉS), vérifie tout.
"""
import io, os, sys, time, shutil, zipfile, hashlib

BASE = "/home/z/my-project"
REF_COMPLET = os.path.join(BASE, "download/service-rh-scripts-site-web-v0.2.204.zip")
REF_LEGER   = os.path.join(BASE, "download/service-rh-scripts-site-web-v0.2.204-leger.zip")
OUT_COMPLET = os.path.join(BASE, "download/service-rh-scripts-site-web-v0.2.205.zip")
OUT_LEGER   = os.path.join(BASE, "download/service-rh-scripts-site-web-v0.2.205-leger.zip")
ALIAS       = os.path.join(BASE, "download/service-rh-scripts-site-web.zip")
PDF         = os.path.join(BASE, "download/servicerh-readme-technique-v0.2.205.pdf")
VERSION     = "v0.2.205"

REPLACEMENTS = {
    "service-rh-readme-technique.pdf":       io.open(PDF, "rb").read(),
    "VERSION": b"0.2.205\n",
    "GUIDE-INSTALLATION-LINUX-WINDOWS.txt": io.open(os.path.join(BASE, "GUIDE-INSTALLATION-LINUX-WINDOWS.txt"), "rb").read(),
    "scripts/test_v02205_guide_pdf.js": io.open(os.path.join(BASE, "scripts/test_v02205_guide_pdf.js"), "rb").read(),
    "scripts/construire-zip-v02205.py": io.open(os.path.abspath(__file__), "rb").read(),
}
NOUVEAUX = set(["scripts/test_v02205_guide_pdf.js", "scripts/construire-zip-v02205.py"])
DATE = time.localtime()[:6]


def zi_frais(nom):
    zi = zipfile.ZipInfo(nom, date_time=DATE)
    zi.compress_type = zipfile.ZIP_DEFLATED
    zi.external_attr = 0o644 << 16
    zi.create_system = 3
    return zi


def manifeste(zf, mode):
    noms = sorted({i.filename for i in zf.infolist()
                   if not i.filename.endswith("/") and i.filename != "MANIFEST-LIVRAISON.txt"})
    lignes = ["MODE=" + mode, "VERSION=" + VERSION, "FICHIERS=%d" % len(noms)]
    for x in noms:
        lignes.append("%d\t%s" % (zf.getinfo(x).file_size, x))
    return ("\n".join(lignes) + "\n").encode("utf-8")


def construire(ref, out, mode):
    avec_ref = zipfile.ZipFile(ref, "r")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as outzf:
        vus = set()
        for zi_ref in avec_ref.infolist():
            nom = zi_ref.filename
            if nom in vus:
                continue
            vus.add(nom)
            if nom == "MANIFEST-LIVRAISON.txt":
                continue
            if nom in REPLACEMENTS:
                outzf.writestr(zi_frais(nom), REPLACEMENTS[nom])
            else:
                zi = zipfile.ZipInfo(nom, date_time=zi_ref.date_time)
                zi.compress_type = zi_ref.compress_type
                zi.external_attr = zi_ref.external_attr
                zi.internal_attr = zi_ref.internal_attr
                zi.create_system = zi_ref.create_system
                outzf.writestr(zi, avec_ref.read(zi_ref))
        for nom, data in REPLACEMENTS.items():
            if nom not in vus:
                outzf.writestr(zi_frais(nom), data)
        outzf.writestr(zi_frais("MANIFEST-LIVRAISON.txt"), manifeste(outzf, mode))
    avec_ref.close()


def verifier(chemin, mode):
    zf = zipfile.ZipFile(chemin)
    r = []
    def ok(cond, msg):
        r.append((bool(cond), msg))
    noms = set(zf.namelist())
    ok(len(zf.namelist()) - len(noms) == 0, "aucune entree dupliquee")
    ok(zf.testzip() is None, "testzip integrite OK")
    ok(zf.read("VERSION").decode().strip() == "0.2.205", "VERSION = 0.2.205")
    pdf_zip = zf.read("service-rh-readme-technique.pdf")
    ok(pdf_zip == REPLACEMENTS["service-rh-readme-technique.pdf"],
       "PDF README v0.2.205 embarque = octets identiques")
    guide = zf.read("GUIDE-INSTALLATION-LINUX-WINDOWS.txt").decode("utf-8", "replace")
    ok("(v0.2.205)" in guide and "Fin du guide - v0.2.205." in guide,
       "guide : titre + fin v0.2.205")
    dem = zf.read("DEMARRER-SILENCIEUX-WINDOWS.vbs").decode("latin-1")
    i1 = dem.find("If fso.FileExists(batPrincipal)")
    i2 = dem.find("ElseIf fso.FileExists(batCompat)")
    i3 = dem.find("ElseIf fso.FileExists(moteur)")
    i4 = dem.find("\r\nElse\r\n", i3)
    ok(0 < i1 < i2 < i3 < i4 < dem.find("MsgBox") and dem.count("MsgBox") == 1,
       "NR 204 : cascade du VBS demarrage intacte")
    ok('sh.Run "cmd /c node scripts\\service-paiesage.js stop", 0, False'
       in zf.read("ARRETER-SILENCIEUX-WINDOWS.vbs").decode("latin-1"),
       "NR 204 : VBS arret intact")
    ok("PREPARER-PAIESAGE-SILENCIEUX.bat" in noms, "NR 204 : bat canonique present")
    for x in ("scripts/test_v02205_guide_pdf.js", "scripts/construire-zip-v02205.py"):
        ok(x in noms, "embarque : %s" % x)
    man = zf.read("MANIFEST-LIVRAISON.txt").decode()
    ok(man.startswith("MODE=%s\nVERSION=v0.2.205\n" % mode), "manifeste %s regenere" % mode)
    zf.close()
    return r


def main():
    print("=== Construction v0.2.205 (guide PDF enrichi : installer / demarrer / ports) ===\n")
    for x in (REF_COMPLET, REF_LEGER, PDF):
        if not os.path.exists(x):
            raise SystemExit("REFERENCE INTRUVABLE : " + x)
    construire(REF_COMPLET, OUT_COMPLET, "COMPLET")
    construire(REF_LEGER, OUT_LEGER, "LEGER")
    echecs = 0
    for chemin, mode in ((OUT_COMPLET, "COMPLET"), (OUT_LEGER, "LEGER")):
        res = verifier(chemin, mode)
        echecs += sum(1 for o, _ in res if not o)
        for o, msg in res:
            print("  [%s] %s" % ("OK" if o else "FAIL", msg))
        print("  -- %s : %d entrees, %d octets\n" % (
            os.path.basename(chemin), len(zipfile.ZipFile(chemin).namelist()), os.path.getsize(chemin)))
    if echecs:
        raise SystemExit("ECHEC : %d verification(s) FAILED" % echecs)
    shutil.copyfile(OUT_COMPLET, ALIAS)
    os.chmod(ALIAS, 0o755)
    for x in (OUT_COMPLET, OUT_LEGER, ALIAS):
        print("%s — %d octets — md5 %s" % (os.path.basename(x), os.path.getsize(x),
                                           hashlib.md5(open(x, "rb").read()).hexdigest()))
    print("TOUTES LES VERIFICATIONS PASSEES.")


if __name__ == "__main__":
    main()
