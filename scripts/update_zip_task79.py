#!/usr/bin/env python3
"""Task 79 (19/09/2026) : TABLEAU DE BORD — « verifier le nombre de cin ne
doit pas être le même nombre de fiche de paie » (retour utilisateur, capture
: « Fiches de paie 1557 » et « CIN détectés 1557 » — DEUX compteurs
identiques). Le compteur « CIN détectés » comptait les FICHES possédant un
CIN (count), pas les CIN eux-mêmes : plusieurs fiches du même employé (un
bulletin par période) le gonflaient jusqu'à égaler « Fiches de paie ».

CORRECTION :
  1. /api/stats : withCin = nombre de CIN DISTINCTS détectés — dédoublonnage
     en JavaScript après déchiffrement transparent (colonne cin chiffrée à
     IV aléatoire, Task 32 : aucun `distinct` SQL possible), avec la MÊME
     normalisation que le répertoire des employés (Task 67) : majuscules,
     sans espaces/tirets/points/slashs (« 9593-1034 » ≡ « 95931034 ») ;
     invariant honnête : withCin = Math.min(distincts, fiches avec CIN,
     total). withoutCin reste un comptage de FICHES sans CIN.
  2. page.tsx : sous-titre honnête de la carte — « CIN distincts dans le
     contenu » (l'ancien « dans le contenu » prêtait à confusion) ;
     commentaire Task 79 documentant le constat 1557 = 1557.
  3. src/lib/types.ts : StatsResponse.withCin documenté (CIN distincts).
  4. CONSERVÉ : tout le reste — carte « Fiches de paie », « Dernier import »,
     champ employees (noms distincts), gardes session/expiration, OTP/QR du
     portail (Tasks 74-78) ENTIÈREMENT INTACTS.

Nouveaux :
  - scripts/test79_cin_distincts.py (36 vérifications : statiques + preuve
    DYNAMIQUE par recomputation indépendante en Python du nombre de CIN
    distincts depuis la liste brute /api/payslips ; jeu de données Task 65 :
    3 fiches du MÊME CIN dont une forme « sale » « test65 cin1 » ne comptent
    que pour UN SEUL CIN ; invariant « CIN détectés < Fiches de paie » dès
    qu'un employé a plusieurs fiches)
  - scripts/test79_harnais.sh (COPIE + serveur admin 4217)
Remplacés :
  - src/app/api/stats/route.ts (dédoublonnage)
  - src/app/page.tsx (sous-titre)
  - src/lib/types.ts (documentation)
  - README-DEPLOIEMENT-LOCAL.md (section 44)
  - package.json (0.2.8 -> 0.2.9)
  - scripts/test74, test75, test76, test78 (contrôles de version réalignés)
Remis en cohérence (hors archive) :
  - scripts/patch_attendu_task79.py : ATTENDU 272 -> 274 dans les maillons
    38/64/65/66/67/69/70/71/73/74/75/76/77/78 + suites task40/42 ;
    contrôles de version des maillons 74-78 réalignés 0.2.9
Compte : 272 (état Task 78) + 2 nouveaux = 274 fichiers.
Hérite de la chaîne : 34 -> 35/35-bis -> 36 -> 37 -> 38/39/40 -> 42 ->
64 -> 65 -> 66 -> 67 -> 69 -> 70 -> 71 -> 73 -> 74 -> 75 -> 76 -> 77 -> 78
-> 79.
"""
import zipfile, shutil, os, subprocess, sys, hashlib

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

# (chemin disque, chemin dans l'archive, conversion CRLF ?)
FILES = [
    # --- Task 79 : compteur « CIN détectés » = CIN DISTINCTS ---
    ("src/app/api/stats/route.ts", "src/app/api/stats/route.ts", False),
    ("src/app/page.tsx", "src/app/page.tsx", False),
    ("src/lib/types.ts", "src/lib/types.ts", False),
    ("package.json", "package.json", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    ("scripts/test74_otp_qr.py", "scripts/test74_otp_qr.py", False),
    ("scripts/test75_otp_premiere_connexion.py", "scripts/test75_otp_premiere_connexion.py", False),
    ("scripts/test76_otp_qr_chaque_connexion.py", "scripts/test76_otp_qr_chaque_connexion.py", False),
    ("scripts/test78_totp_authenticator.py", "scripts/test78_totp_authenticator.py", False),
    ("scripts/test79_cin_distincts.py", "scripts/test79_cin_distincts.py", False),
    ("scripts/test79_harnais.sh", "scripts/test79_harnais.sh", False),
]

ATTENDU = 307  # (MODIFIÉ Task 94) 306 (état Task 93) + 1 fichier Task 94 (test94_politique_complexite)


def lire(src, crlf):
    data = open(os.path.join(BASE, src), "rb").read()
    if crlf:
        data = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    return data


def md5(chemin):
    h = hashlib.md5()
    with open(chemin, "rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


# 1) Chaîne cumulative jusqu'à la Task 78 (elle-même bâtie sur 34->...->78)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task78.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 79 : remplacements + ajouts (sans doublons)
tmp = SRC + ".tmp"
with zipfile.ZipFile(SRC, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    exclus = {arc for _, arc, _ in FILES}
    for item in zin.infolist():
        if item.filename in exclus:
            continue
        zout.writestr(item, zin.read(item.filename))
    for src, arc, crlf in FILES:
        zout.writestr(arc, lire(src, crlf))
os.replace(tmp, SRC)
for c in COPIES:
    shutil.copyfile(SRC, c)

# 3) Contrôles automatiques
ok = True
md5s = [md5(SRC)] + [md5(c) for c in COPIES]
for z, empreinte in zip([SRC] + COPIES, md5s):
    with zipfile.ZipFile(z) as zz:
        bad = zz.testzip()
        liste = zz.namelist()
        names = set(liste)
        manquants = [arc for _, arc, _ in FILES if arc not in names]
        doublons = len(liste) != len(names)
        identique = empreinte == md5s[0]
        print(f"OK {os.path.basename(z)} : {len(names)} fichiers (attendu {ATTENDU}), intégrité={'OK' if bad is None else 'KO'}, doublons={'OUI!' if doublons else 'non'}, taille={os.path.getsize(z)//1024} Ko")
        if manquants:
            ok = False
            print(f"   MANQUANTS : {manquants}")
        if bad is not None or doublons or len(names) != ATTENDU or not identique:
            ok = False

with zipfile.ZipFile(SRC) as zz:
    stats = zz.read("src/app/api/stats/route.ts").decode("utf-8", errors="replace")
    page = zz.read("src/app/page.tsx").decode("utf-8", errors="replace")
    types = zz.read("src/lib/types.ts").decode("utf-8", errors="replace")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    pkg = zz.read("package.json").decode("utf-8", errors="replace")
    portail = zz.read("scripts/portail-server.js").decode("utf-8", errors="replace")
    t74 = zz.read("scripts/test74_otp_qr.py").decode("utf-8", errors="replace")
    t75 = zz.read("scripts/test75_otp_premiere_connexion.py").decode("utf-8", errors="replace")
    t76 = zz.read("scripts/test76_otp_qr_chaque_connexion.py").decode("utf-8", errors="replace")
    t78 = zz.read("scripts/test78_totp_authenticator.py").decode("utf-8", errors="replace")
    t79 = zz.read("scripts/test79_cin_distincts.py").decode("utf-8", errors="replace")
    t79sh = zz.read("scripts/test79_harnais.sh").decode("utf-8", errors="replace")

    def check(nom, cond, detail=""):
        global ok
        print(f"   {nom} : {'OK' if cond else 'KO'}{'' if cond else ' — ' + str(detail)}")
        if not cond:
            ok = False

    # --- Contrôles Task 79 : compteur CIN distincts ---
    check("stats : ANCIEN calcul (comptage de fiches) ABSENT",
          "const withCin = await db.payslip.count" not in stats)
    check("stats : dédoublonnage JavaScript des CIN (colonne chiffrée à IV aléatoire) + normalisation du répertoire",
          "const cinsDistincts = new Set<string>()" in stats
          and "normalizeQuery(String(r.cin ?? \"\").trim())" in stats
          and 'from "@/lib/payslip-extractor"' in stats)
    check("stats : invariant honnête (plafond) + constat utilisateur documenté",
          "Math.min(withCin, fichesAvecCin, total)" in stats
          and "1557" in stats and "CIN DISTINCTS" in stats)
    check("stats : withoutCin reste un comptage de FICHES + gardes intactes",
          "const withoutCin = total - fichesAvecCin" in stats
          and "getSessionUser" in stats and "motDePasseExpire()" in stats)
    check("page : sous-titre « CIN distincts dans le contenu » + ancien sous-titre ABSENT",
          'sub="CIN distincts dans le contenu"' in page
          and 'sub="dans le contenu"' not in page)
    check("page : cartes « Fiches de paie » / « CIN détectés » conservées + commentaire Task 79",
          'label="Fiches de paie"' in page and 'label="CIN détectés"' in page
          and "MODIFIÉ (Task 79)" in page)
    check("types : StatsResponse.withCin documenté CIN distincts (Task 79)",
          "MODIFIÉ Task 79" in types and "CIN DISTINCTS" in types)
    check("test79 embarqué (recomputation indépendante + jeu de données Task 65 + invariant « strictement inférieur »)",
          "RÉSULTAT TASK 79" in t79
          and "re.sub(r\"[\\s./\\-]\"" in t79
          and "TEST65CIN1" in t79 and "test65 cin1" in t79
          and "withcin_api < total_api" in t79)
    check("harnais test79 embarqué (COPIE de base, port 4217, trap EXIT)",
          "test79.db" in t79sh and "4217" in t79sh and "COPIE" in t79sh
          and "test65_inserer.js" in t79sh and "trap" in t79sh)

    # --- Version + documentation ---
    check("package.json : version 0.2.24", '"version": "0.2.24"' in pkg, pkg[:80])
    check("tests réalignés Task 81 : 74/75/76/78 en version 0.2.11",
          '"0.2.24"' in t74 and '"0.2.24"' in t75 and '"0.2.24"' in t76 and '"0.2.24"' in t78)
    check("README : section 44 (CIN détectés = CIN distincts, dédoublonnage, sous-titre honnête)",
          "## 44. Tableau de bord : « CIN détectés » compte désormais les CIN DISTINCTS" in readm
          and "test79_harnais.sh" in readm and "9593-1034" in readm)
    check("README : sections 31-43 intactes",
          "## 43. Portail employés : le QR code devient une vraie inscription « application d'authentification »" in readm
          and "## 42. Accès portail : la barre de création et la colonne « Employé » retirées" in readm
          and "## 41. Portail employés : OTP obligatoire À CHAQUE connexion" in readm
          and "## 31." in readm)

    # --- Invariants Task 78 (QR otpauth intact dans l'archive) ---
    check("invariant Task 78 : QR otpauth://totp standard toujours dans le portail embarqué",
          '"otpauth://totp/"' in portail
          and "genererSecretTotp" in portail
          and "verifyTotp" in portail)

print("TASK79 ZIP:", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
