#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Construit les ZIP de livraison v0.2.204 (Service RH) — CORRECTIF
« Fichier introuvable : PREPARER-PAIESAGE-SILENCIEUX.bat » (capture
utilisateur : double-clic sur DEMARRER-SILENCIEUX-WINDOWS.vbs du ZIP
v0.2.203-leger → MsgBox « Fichier introuvable … Reinstallez le dossier
PaieSage complet »).

CAUSE RACINE : le ZIP v0.2.203 (complet ET léger) contenait l'ANCIEN
PREPARER-SERVICE-RH-SILENCIEUX.bat mais PAS le nouveau
PREPARER-PAIESAGE-SILENCIEUX.bat que le VBS réécrit en 0.2.203 appelle.

Changements (les DEUX zips) :
  1) PREPARER-PAIESAGE-SILENCIEUX.bat AJOUTÉ aux zips (chaîne complète
     6 étapes → moteur scripts/service-paiesage.js) ;
  2) PREPARER-SERVICE-RH-SILENCIEUX.bat réécrit en RELAIS de
     compatibilité (delegation au bat canonique, repli moteur direct) ;
  3) DEMARRER-SILENCIEUX-WINDOWS.vbs AUTONOME : repli en cascade
     bat canonique → ancien bat → moteur direct ; le MsgBox d'erreur
     n'apparaît plus que si AUCUN lanceur n'existe ;
  4) ETAT-SILENCIEUX-WINDOWS.vbs + JOURNAUX-SILENCIEUX-WINDOWS.vbs
     remplacés par les versions 0.2.203+ (moteur service-paiesage.js,
     journaux paiesage-*.log — les copies restées dans les zips
     appelaient encore l'ancien moteur scripts/service-rh.js) ;
  5) GUIDE : entrée « Fichier introuvable PREPARER-PAIESAGE… » dans les
     problèmes courants + section 6 mise à jour + Fin du guide v0.2.204 ;
  6) scripts/test_v02204_fix_vbs.js (NOUVEAU) : contrôles structurels
     des 2 zips + TESTS RÉELS de la chaîne d'ARRÊT (processus node
     factice sur ports isolés, arrêt par PIDs puis arrêt par ports) ;
  7) MANIFEST-LIVRAISON.txt régénéré par zip ; VERSION = 0.2.204 ;
     constructeur v0.2.204 embarqué.

Méthode : PART de la livraison v0.2.203 existante (complet + léger),
remplace/ajoute les entrées ci-dessus, déduplique, préserve les
attributs Unix des entrées conservées (ZipInfo clonés — jamais mutés),
régénère les manifestes et vérifie tout avant d'annoncer OK.
"""
import io, os, sys, time, shutil, zipfile

BASE = "/home/z/my-project"
REF_COMPLET = os.path.join(BASE, "download/service-rh-scripts-site-web-v0.2.203.zip")
REF_LEGER   = os.path.join(BASE, "download/service-rh-scripts-site-web-v0.2.203-leger.zip")
OUT_COMPLET = os.path.join(BASE, "download/service-rh-scripts-site-web-v0.2.204.zip")
OUT_LEGER   = os.path.join(BASE, "download/service-rh-scripts-site-web-v0.2.204-leger.zip")
ALIAS       = os.path.join(BASE, "download/service-rh-scripts-site-web.zip")
VERSION     = "v0.2.204"

def crlf(p):
    """Lit un fichier texte du repo et renvoie les octets CRLF (VBS/BAT)."""
    d = io.open(p, "rb").read().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    return d

# ---------- entrées remplacées / ajoutées (identiques dans les 2 zips) ----------
REPLACEMENTS = {
    "DEMARRER-SILENCIEUX-WINDOWS.vbs":      crlf(os.path.join(BASE, "DEMARRER-SILENCIEUX-WINDOWS.vbs")),
    "PREPARER-PAIESAGE-SILENCIEUX.bat":     crlf(os.path.join(BASE, "PREPARER-PAIESAGE-SILENCIEUX.bat")),      # AJOUT
    "PREPARER-SERVICE-RH-SILENCIEUX.bat":   crlf(os.path.join(BASE, "PREPARER-SERVICE-RH-SILENCIEUX.bat")),    # relais
    "ETAT-SILENCIEUX-WINDOWS.vbs":          crlf(os.path.join(BASE, "ETAT-SILENCIEUX-WINDOWS.vbs")),
    "JOURNAUX-SILENCIEUX-WINDOWS.vbs":      crlf(os.path.join(BASE, "JOURNAUX-SILENCIEUX-WINDOWS.vbs")),
    "GUIDE-INSTALLATION-LINUX-WINDOWS.txt": io.open(os.path.join(BASE, "GUIDE-INSTALLATION-LINUX-WINDOWS.txt"), "rb").read(),
    "VERSION": b"0.2.204\n",
    "scripts/test_v02204_fix_vbs.js": io.open(os.path.join(BASE, "scripts/test_v02204_fix_vbs.js"), "rb").read(),
    "scripts/construire-zip-v02204.py": io.open(os.path.abspath(__file__), "rb").read(),
}
NOUVEAUX = set(["PREPARER-PAIESAGE-SILENCIEUX.bat", "scripts/test_v02204_fix_vbs.js",
                "scripts/construire-zip-v02204.py"])

DATE = time.localtime()[:6]

def zi_frais(nom, external_attr=None):
    zi = zipfile.ZipInfo(nom, date_time=DATE)
    zi.compress_type = zipfile.ZIP_DEFLATED
    zi.external_attr = (external_attr if external_attr is not None else 0o644) << 16
    zi.create_system = 3
    return zi

def manifeste(zf, mode):
    """Régénère MANIFEST-LIVRAISON.txt depuis les entrées du zip FINAL."""
    noms = sorted({i.filename for i in zf.infolist()
                   if not i.filename.endswith("/") and i.filename != "MANIFEST-LIVRAISON.txt"})
    lignes = ["MODE=" + mode, "VERSION=" + VERSION, "FICHIERS=%d" % len(noms)]
    for n in noms:
        lignes.append("%d\t%s" % (zf.getinfo(n).file_size, n))
    return ("\n".join(lignes) + "\n").encode("utf-8")

def construire(ref, out, mode):
    avec_ref = zipfile.ZipFile(ref, "r")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as outzf:
        vus = set()
        for zi_ref in avec_ref.infolist():
            nom = zi_ref.filename
            if nom in vus:            # déduplication défensive
                continue
            vus.add(nom)
            if nom == "MANIFEST-LIVRAISON.txt":
                continue              # régénéré à la fin (jamais copié)
            if nom in REPLACEMENTS:
                outzf.writestr(zi_frais(nom), REPLACEMENTS[nom])
            else:                     # ZipInfo CLONÉ (attributs Unix préservés)
                zi = zipfile.ZipInfo(nom, date_time=zi_ref.date_time)
                zi.compress_type = zi_ref.compress_type
                zi.external_attr = zi_ref.external_attr
                zi.internal_attr = zi_ref.internal_attr
                zi.create_system = zi_ref.create_system
                outzf.writestr(zi, avec_ref.read(zi_ref))
        # NOUVELLES entrées absentes du ZIP de référence (le bat canonique !)
        for nom, data in REPLACEMENTS.items():
            if nom not in vus:
                outzf.writestr(zi_frais(nom), data)
        outzf.writestr(zi_frais("MANIFEST-LIVRAISON.txt"), manifeste(outzf, mode))
    avec_ref.close()

# ---------- vérifications ----------
def crlf_integral(d):
    return d.count(b"\r\n") == d.count(b"\n") and d.count(b"\n") > 0

def verifier(chemin, mode):
    zf = zipfile.ZipFile(chemin)
    r = []
    def ok(cond, msg):
        r.append((bool(cond), msg))
    noms = set(zf.namelist())
    doublons = len(zf.namelist()) - len(noms)
    ok(doublons == 0, "aucune entree dupliquee (%d)" % doublons)
    ok(zf.testzip() is None, "testzip integrite OK")
    ok(zf.read("VERSION").decode().strip() == "0.2.204", "VERSION = 0.2.204")

    bat1 = zf.read("PREPARER-PAIESAGE-SILENCIEUX.bat")
    ok("PREPARER-PAIESAGE-SILENCIEUX.bat" in noms, "bat canonique PRESENT (le bug v0.2.203)")
    ok(b"service-paiesage.js start" in bat1 and crlf_integral(bat1),
       "bat canonique = chaine complete + CRLF")

    bat2 = zf.read("PREPARER-SERVICE-RH-SILENCIEUX.bat")
    ok(b'call "PREPARER-PAIESAGE-SILENCIEUX.bat"' in bat2 and b"service-rh.js" not in bat2,
       "ancien bat = relais vers le canonique (plus de service-rh.js)")

    dem = zf.read("DEMARRER-SILENCIEUX-WINDOWS.vbs")
    t = dem.decode("latin-1")
    i1 = t.find("If fso.FileExists(batPrincipal)")
    i2 = t.find("ElseIf fso.FileExists(batCompat)")
    i3 = t.find("ElseIf fso.FileExists(moteur)")
    i4 = t.find("\r\nElse\r\n", i3)      # Else SEUL (pas le préfixe ElseIf)
    ok(0 < i1 < i2 < i3 < i4 < t.find("MsgBox"), "VBS demarrage = repli en CASCADE (1->2->3->erreur)")
    ok(t.count("MsgBox") == 1, "VBS demarrage = exactement 1 MsgBox (installation vide)")
    ok("cmd /c node scripts\\service-paiesage.js start" in t and crlf_integral(dem),
       "VBS demarrage = repli moteur direct + CRLF integral")

    arr = zf.read("ARRETER-SILENCIEUX-WINDOWS.vbs").decode("latin-1")
    ok('sh.Run "cmd /c node scripts\\service-paiesage.js stop", 0, False' in arr,
       "VBS arret = commande stop du moteur (intacte)")
    ok(arr.count("MsgBox") == 0, "VBS arret = 0 popup")

    etat = zf.read("ETAT-SILENCIEUX-WINDOWS.vbs").decode("latin-1")
    ok("service-paiesage.js statusfile" in etat and "service-rh.js" not in etat,
       "VBS etat = nouveau moteur (plus de service-rh.js)")
    jrn = zf.read("JOURNAUX-SILENCIEUX-WINDOWS.vbs").decode("latin-1")
    ok("paiesage-administration.log" in jrn and "service-rh" not in jrn,
       "VBS journaux = noms paiesage-*")

    racines = [n for n in noms if "/" not in n and n.lower().endswith((".bat", ".vbs"))]
    refs_ancien = [n for n in racines if b"service-rh.js" in zf.read(n)]
    ok(not refs_ancien, "0 lanceur racine ne reference encore service-rh.js (%s)" % ",".join(refs_ancien))

    guide = zf.read("GUIDE-INSTALLATION-LINUX-WINDOWS.txt").decode("utf-8", "replace")
    ok("Fichier introuvable : PREPARER-PAIESAGE-SILENCIEUX.bat" in guide and
       "Fin du guide - v0.2.204" in guide, "guide : entree correctif + fin v0.2.204")

    moteur = zf.read("scripts/service-paiesage.js").decode("utf-8", "replace")
    ok(all(('cmd === "%s"' % c) in moteur for c in ("start", "stop", "status", "statusfile", "record")),
       "moteur present avec start/stop/status/statusfile/record")
    ok(zf.read("scripts/test_v02204_fix_vbs.js") == REPLACEMENTS["scripts/test_v02204_fix_vbs.js"],
       "test dedie 204 embarque")
    ok("scripts/construire-zip-v02204.py" in noms, "constructeur 204 embarque")
    man = zf.read("MANIFEST-LIVRAISON.txt").decode()
    ok(man.startswith("MODE=%s\nVERSION=v0.2.204\n" % mode), "manifeste %s regenere" % mode)
    zf.close()
    return r

def main():
    print("=== Construction v0.2.204 (correctif PREPARER-PAIESAGE-SILENCIEUX.bat + VBS autonome) ===\n")
    if not os.path.exists(REF_COMPLET) or not os.path.exists(REF_LEGER):
        raise SystemExit("ZIP de reference v0.2.203 introuvable")
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
    print("Alias generique %s mis a jour (copie du complet)." % os.path.basename(ALIAS))
    print("TOUTES LES VERIFICATIONS PASSEES.")

if __name__ == "__main__":
    main()
