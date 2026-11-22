#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Construit les ZIP de livraison v0.2.206 (Service RH) — CORRECTIF Linux
« le lanceur disait deja en cours alors que les pages ne fonctionnent pas »
(capture utilisateur, ports 6000/6001).

PART des livraisons v0.2.205 (complet + leger), remplace :
  - DEMARRER-TOUT-LINUX-MAC.sh             ← bloc DIAGNOSTIC DE PORTS (v0.2.206)
  - INSTALLER-ET-DEMARRER-LINUX-MAC.sh     ← meme garde avant lancement
  - scripts/service-paiesage.js            ← stop arrête les instances MUETTES,
    liberation verifiee par l'ecoute reelle, start repare les muettes
  - GUIDE-INSTALLATION-LINUX-WINDOWS.txt   ← entree Problemes courants v0.2.206
  - VERSION                                ← 0.2.206
  - MANIFEST-LIVRAISON.txt                 ← regenere par zip
ajoute les entrees nouvelles (test dedie + constructeur embarques),
deduplique, preserve les attributs Unix (ZipInfo CLONES), verifie tout.
"""
import io, os, time, shutil, zipfile, hashlib

BASE = "/home/z/my-project"
REF_COMPLET = os.path.join(BASE, "download/service-rh-scripts-site-web-v0.2.205.zip")
REF_LEGER   = os.path.join(BASE, "download/service-rh-scripts-site-web-v0.2.205-leger.zip")
OUT_COMPLET = os.path.join(BASE, "download/service-rh-scripts-site-web-v0.2.206.zip")
OUT_LEGER   = os.path.join(BASE, "download/service-rh-scripts-site-web-v0.2.206-leger.zip")
ALIAS       = os.path.join(BASE, "download/service-rh-scripts-site-web.zip")
PDF_V205    = os.path.join(BASE, "download/servicerh-readme-technique-v0.2.205.pdf")
VERSION     = "v0.2.206"


def lit(rel):
    return io.open(os.path.join(BASE, rel), "rb").read()


REPLACEMENTS = {
    "DEMARRER-TOUT-LINUX-MAC.sh":            lit("DEMARRER-TOUT-LINUX-MAC.sh"),
    "INSTALLER-ET-DEMARRER-LINUX-MAC.sh":    lit("INSTALLER-ET-DEMARRER-LINUX-MAC.sh"),
    "scripts/service-paiesage.js":           lit("scripts/service-paiesage.js"),
    "GUIDE-INSTALLATION-LINUX-WINDOWS.txt":  lit("GUIDE-INSTALLATION-LINUX-WINDOWS.txt"),
    "VERSION": b"0.2.206\n",
    "scripts/test_v02206_diag_ports.js":     lit("scripts/test_v02206_diag_ports.js"),
    "scripts/construire-zip-v02206.py":      io.open(os.path.abspath(__file__), "rb").read(),
}
NOUVEAUX = set(["scripts/test_v02206_diag_ports.js", "scripts/construire-zip-v02206.py"])
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
    ok(len(zf.namelist()) - len(set(zf.namelist())) == 0, "aucune entree dupliquee")
    ok(zf.testzip() is None, "testzip integrite OK")
    ok(zf.read("VERSION").decode().strip() == "0.2.206", "VERSION = 0.2.206")
    for nom in ("DEMARRER-TOUT-LINUX-MAC.sh", "INSTALLER-ET-DEMARRER-LINUX-MAC.sh",
                "scripts/service-paiesage.js", "GUIDE-INSTALLATION-LINUX-WINDOWS.txt"):
        ok(zf.read(nom) == REPLACEMENTS[nom], "remplace, octets identiques : %s" % nom)
    tout = zf.read("DEMARRER-TOUT-LINUX-MAC.sh").decode("utf-8", "replace")
    ok("DEBUT BLOC DIAGNOSTIC PORTS" in tout and "est_notre_app" in tout and
       "decider_port \"$PORT\" \"Administration RH/IT\"" in tout,
       "lanceur : bloc DIAGNOSTIC DE PORTS embarque")
    ins = zf.read("INSTALLER-ET-DEMARRER-LINUX-MAC.sh").decode("utf-8", "replace")
    ok("Verification des ports avant demarrage" in ins, "installateur : garde avant lancement")
    moteur = zf.read("scripts/service-paiesage.js").decode("utf-8", "replace")
    ok("Decouverte INCONDITIONNELLE" in moteur and "pidsSurPort(PORT_ADMIN).length > 0" in moteur,
       "moteur : stop muettes + liberation par ecoute reelle")
    guide = zf.read("GUIDE-INSTALLATION-LINUX-WINDOWS.txt").decode("utf-8", "replace")
    ok("(v0.2.206)" in guide and "Fin du guide - v0.2.206." in guide and
       "Le lanceur dit" in guide, "guide : titre v0.2.206 + probleme courant")
    dem = zf.read("DEMARRER-SILENCIEUX-WINDOWS.vbs").decode("latin-1")
    i1 = dem.find("If fso.FileExists(batPrincipal)")
    i2 = dem.find("ElseIf fso.FileExists(batCompat)")
    i3 = dem.find("ElseIf fso.FileExists(moteur)")
    i4 = dem.find("\r\nElse\r\n", i3)
    ok(0 < i1 < i2 < i3 < i4 < dem.find("MsgBox") and dem.count("MsgBox") == 1,
       "NR 204 : cascade du VBS demarrage intacte")
    ok("PREPARER-PAIESAGE-SILENCIEUX.bat" in set(zf.namelist()), "NR 204 : bat canonique present")
    ok(zf.read("service-rh-readme-technique.pdf") == io.open(PDF_V205, "rb").read(),
       "NR 205 : PDF README v0.2.205 embarque intact (octets identiques)")
    for x in ("scripts/test_v02206_diag_ports.js", "scripts/construire-zip-v02206.py"):
        ok(x in set(zf.namelist()), "embarque : %s" % x)
    man = zf.read("MANIFEST-LIVRAISON.txt").decode()
    ok(man.startswith("MODE=%s\nVERSION=v0.2.206\n" % mode), "manifeste %s regenere" % mode)
    zf.close()
    return r


def lit_rel_pdf():
    return io.open(PDF_V205, "rb").read()


def main():
    print("=== Construction v0.2.206 (diagnostic des ports, Linux) ===\n")
    for x in (REF_COMPLET, REF_LEGER):
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
