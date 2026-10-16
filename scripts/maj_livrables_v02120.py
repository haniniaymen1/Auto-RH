#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 235/236 — v0.2.120 : met à jour le README technique PDF (demande
utilisateur : « mettre a jour readme pdf »). Le readme était resté à
l'édition v0.2.112 : cette édition y injecte la CHAÎNE DE SIGNATURE
ÉLECTRONIQUE complète (v0.2.113 → v0.2.120) puis régénère les trois
canaux (racine, download/, édition versionnée) et reconstruit l'archive
zip v0.2.120 (le README à la racine est embarqué dans le zip).

Contenu injecté :
  - v0.2.113 : bloc « Téléchargements directs » retiré de la page de
    connexion admin (5 routes /api/download-* restent publiques) ;
  - v0.2.114 → v0.2.117 : API de certification & signature — PAdES par le
    serveur (mode LOCALE, moteur 100 % node sans openssl) ou API externe
    (mode API_EXTERNE, URL Test/Production, secrets chiffrés) ;
  - v0.2.116 + v0.2.118 : fiches signées automatiquement à l'import,
    employé téléchargeant SES fiches/réponses SIGNÉES depuis le portail ;
  - v0.2.119 + v0.2.120 : cachet « SIGNATURE ÉLECTRONIQUE » du tampon —
    rectangle ou ROND d'entreprise — alimenté EN DIRECT par le certificat
    et TOUJOURS couvert par la signature PAdES (garantie : jamais un
    document cacheté non signé).

Patchs ASSERTIFS et IDEMPOTENTS. Les retours à la ligne sont construits
via chr(10) pour éviter toute ambiguïté d'échappement dans les ancres
multi-lignes.
"""
import os
import shutil
import subprocess
import sys
import hashlib

RACINE = "/home/z/my-project"
LN = chr(10)

NOUVELLE_EDITION = (
    "Task 235 — v0.2.120 : README mis à jour avec la CHAÎNE DE SIGNATURE ÉLECTRONIQUE complète" + LN +
    "(v0.2.113 → v0.2.120) : (1) API DE CERTIFICATION & SIGNATURE — signature cryptographique PAdES" + LN +
    "des PDF par le serveur (mode LOCALE, certificat importé, moteur 100 % node : node:crypto + node-forge," + LN +
    "sans aucune dépendance à openssl) ou par une API externe (mode API_EXTERNE : URL distinctes" + LN +
    "Test/Production, Bearer/API-Key/Basic, secret chiffré jamais renvoyé), registre des documents" + LN +
    "signés, copies signées conservées et vérification d'intégrité ; (2) FICHES SIGNÉES À L'IMPORT +" + LN +
    "PORTAIL — chaque fiche importée est signée automatiquement (cache par empreinte) et l'employé" + LN +
    "télécharge depuis son portail SES fiches et réponses SIGNÉES ; (3) CACHET « SIGNATURE ÉLECTRO-" + LN +
    "NIQUE » DU TAMPON — 4e élément alimenté EN DIRECT par le certificat du module (Signataire," + LN +
    "Organisation, Émetteur, validité, empreinte SHA-256), forme RECTANGLE ou ROND (cachet d'entre-" + LN +
    "prise : organisation en arc supérieur, mention en arc inférieur, titulaire au centre), apposé" + LN +
    "sur PDF/images/DOCX/XLSX et TOUJOURS couvert par la signature PAdES sur les mêmes octets — si" + LN +
    "la signature échoue, le cachet est retiré (jamais un document cacheté non signé)." + LN +
    "Édition précédente — Task 222 — v0.2.112 : IMPORT DES CERTIFICATS ÉLECTRONIQUES + CLÉS PRIVÉES ASSOCIÉES dans"
)

DEFS_V120 = '''# (NOUVEAU v0.2.120 — Task 235) les QUATRE principes de la chaîne de signature
# électronique, définis en variables pour une insertion lisible dans C_MECANIQUE :
PRINCIPE_ANNEXE_CONNEXION = (
    "Page de connexion resserrée (v0.2.113) : le bloc « Téléchargements directs » (archive zip, README, formation, matrice des rôles, map de routage) a été RETIRÉ de la page de connexion du portail d'administration — les cinq livrables restent téléchargeables publiquement via leurs routes /api/download-* (URL directes, sans connexion)."
)
PRINCIPE_API_CERT_SIG = (
    "API de certification & signature électronique (v0.2.114 → v0.2.117) : signature cryptographique PAdES des documents PDF directement par le serveur — mode LOCALE (certificat importé .p12/.pfx ou certificat + clé privée, moteur 100 % node : node:crypto et node-forge, PKCS#7/CMS, sans aucune dépendance à openssl absent des postes Windows) ou mode API_EXTERNE (service REST de signature : URL distinctes Test/Production, authentification Bearer/API-Key/Basic, secret chiffré AES-256-GCM et jamais renvoyé à l'interface) ; fiches de paie signées AUTOMATIQUEMENT à l'import (cache par empreinte) et réponses aux demandes signées AVANT envoi ; environnement Test/Production affiché en badge et tracé dans le journal ; registre des documents signés, copies signées conservées et vérification d'intégrité à la demande."
)
PRINCIPE_SIGNE_EMPLOYE = (
    "Documents signés côté employé (v0.2.116 → v0.2.118) : la fiche servie au portail est la COPIE SIGNÉE conservée par le registre — l'employé télécharge depuis son espace SES fiches de paie et les réponses à ses demandes avec leur signature PAdES ; si la signature est indisponible, l'original intact est servi (le document reste signable plus tard) ; aucune clé ni secret n'est exposé au portail."
)
PRINCIPE_CACHET_ELEC = (
    "Cachet « SIGNATURE ÉLECTRONIQUE » du tampon (v0.2.119 → v0.2.120) : 4e élément du tampon alimenté EN DIRECT par le certificat du module (Signataire = CN, Organisation, Émetteur, validité, empreinte SHA-256 — jamais stocké en base), forme RECTANGLE ou ROND de type cachet d'entreprise (deux cercles concentriques, organisation en arc supérieur, mention « SIGNATURE ÉLECTRONIQUE » en arc inférieur, titulaire en gras au centre, validité et empreinte), apposé sur PDF, images, Word et Excel avec position/taille/décalages propres aux périmètres Import et Demandes/Réponses ; GARANTIE : le cachet n'est apposé QUE si la signature PAdES réussit sur les mêmes octets — en cas d'échec le cachet est retiré (jamais un document cacheté non signé) ; aperçu A4 interactif avec bloc d'exemple tant que le certificat n'est pas chargé."
)'''

ROWS_V120 = '''        ("Module « API de certification & signature électronique » — PAdES local ou API externe, environnements Test/Production, registre des documents signés", "Oui", "Oui", "Non"),
        ("Cachet « Signature électronique » du tampon — rectangle ou rond d'entreprise, alimenté par le certificat, couvert par la signature PAdES", "Oui", "Oui", "Non"),'''

PUCE_V120 = '''    y = puce(c, y,
             "Signature cryptographique PAdES (v0.2.114 → v0.2.120) : module « API de certification & signature » "
             "— certificat du serveur (mode LOCALE, moteur 100 % node : aucune dépendance à openssl, absent des "
             "postes Windows) ou API externe de signature (mode API_EXTERNE : URL distinctes Test/Production, "
             "Bearer / API-Key / Basic, secret chiffré jamais renvoyé). Les fiches de paie sont signées "
             "AUTOMATIQUEMENT à l'import (cache par empreinte) et les réponses aux demandes AVANT envoi ; "
             "l'employé télécharge depuis son portail SES fiches et réponses SIGNÉES (copies signées conservées, "
             "registre consultable, vérification d'intégrité à la demande). Le tampon porte un cachet « SIGNATURE "
             "ÉLECTRONIQUE » — rectangle ou rond d'entreprise (arcs organisation / mention, titulaire au centre, "
             "validité et empreinte SHA-256) — alimenté EN DIRECT par le certificat du module et TOUJOURS couvert "
             "par la signature PAdES sur les mêmes octets : si la signature échoue, le cachet est retiré "
             "(jamais un document cacheté non signé).")'''

ATTENDUS_V120 = '''        "Fiche en ligne",
        # v0.2.113 → v0.2.120 — chaîne de signature électronique (Task 235)
        "PAdES", "API de certification & signature", "Test/Production",
        "SIGNATURE ÉLECTRONIQUE", "cachet d'entreprise", "empreinte SHA-256",
        "sans aucune dépendance à openssl", "copies signées conservées",
        "v0.2.114 → v0.2.120", "édition resserrée v0.2.120",
        "Cachet « Signature électronique » du tampon", "avant envoi",
        "registre des documents signés", "Téléchargements directs",'''

PHRASE_COVER_OLD = (
    'PEM combiné reconnu (v0.2.112). Les annexes A "'
)
PHRASE_COVER_NEW = (
    'PEM combiné reconnu (v0.2.112) ; la signature cryptographique PAdES est intégrée au serveur — module '
    '« API de certification & signature » (certificat local sans openssl ou API externe, environnements '
    'Test/Production), fiches de paie signées automatiquement à l\'import, réponses aux demandes signées '
    'avant envoi, employé téléchargeant ses documents signés depuis son portail, cachet « SIGNATURE '
    'ÉLECTRONIQUE » du tampon — rectangle ou rond d\'entreprise — alimenté en direct par le certificat et '
    'toujours couvert par la signature (v0.2.114 → v0.2.120). Les annexes A "'
)


def patcher(chemin, patches):
    with open(chemin, "r", encoding="utf-8") as f:
        src = f.read()
    for old, new in patches:
        if new in src:
            print("  déjà appliqué (%s) : %r…" % (os.path.basename(chemin), old[:58]))
            continue
        assert old in src, "ANCRE INTROUVABLE dans %s : %r" % (chemin, old[:90])
        src = src.replace(old, new, 1)
    with open(chemin, "w", encoding="utf-8") as f:
        f.write(src)
    print("OK patchs : %s" % chemin)


def md5f(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for bloc in iter(lambda: f.read(65536), b""):
            h.update(bloc)
    return h.hexdigest()


def main():
    print("== maj_livrables v0.2.120 — mise à jour du README technique ==")

    # ---------- 0) sauvegarde de l'édition courante (v0.2.112) ----------
    ancien = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.112.pdf")
    sauvegarde = "/tmp/my-project/servicerh-readme-technique-v0.2.112-avant-v0.2.120.pdf"
    if os.path.exists(ancien) and not os.path.exists(sauvegarde):
        shutil.copy2(ancien, sauvegarde)
        print("Sauvegarde de l'édition v0.2.112 : " + sauvegarde)

    # ---------- 1) patch maj_readme_v096.py ----------
    patcher(
        os.path.join(RACINE, "scripts", "maj_readme_v096.py"),
        [
            # docstring d'en-tête
            (
                "Task 222 — v0.2.112 : IMPORT DES CERTIFICATS ÉLECTRONIQUES + CLÉS PRIVÉES ASSOCIÉES dans",
                NOUVELLE_EDITION,
            ),
            # chemins d'édition
            (
                'PDF_VERSIONNE = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.112.pdf")',
                'PDF_VERSIONNE = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.120.pdf")',
            ),
            (
                'SAUVEGARDE_PRECEDENTE = "/tmp/my-project/servicerh-readme-technique-v0.2.111-avant-v0.2.112.pdf"',
                'SAUVEGARDE_PRECEDENTE = "/tmp/my-project/servicerh-readme-technique-v0.2.112-avant-v0.2.120.pdf"',
            ),
            # définitions des QUATRE variables (avant C_MECANIQUE = [)
            ("C_MECANIQUE = [", DEFS_V120 + LN + LN + "C_MECANIQUE = ["),
            # insertion dans la liste (après les principes v0.2.112)
            (
                "    PRINCIPE_CERT_CLE," + LN + "    PRINCIPE_CERT_INTERFACES,",
                "    PRINCIPE_CERT_CLE," + LN + "    PRINCIPE_CERT_INTERFACES," + LN +
                "    PRINCIPE_ANNEXE_CONNEXION," + LN + "    PRINCIPE_API_CERT_SIG," + LN +
                "    PRINCIPE_SIGNE_EMPLOYE," + LN + "    PRINCIPE_CACHET_ELEC,",
            ),
            # matrice Annexe A — 2 nouvelles lignes dans « Tampon, signature et certificat »
            (
                '        ("Aperçu A4 interactif — clic et glisser indépendants signature / QR / certificat, curseurs synchronisés", "Oui", "Oui", "Non"),',
                '        ("Aperçu A4 interactif — clic et glisser indépendants signature / QR / certificat, curseurs synchronisés", "Oui", "Oui", "Non"),' + LN + ROWS_V120,
            ),
            # cœur section 2 — nouvelle puce signature PAdES
            (
                '             "(v0.2.100) — une modification dans une section n\'affecte jamais l\'autre.")',
                '             "(v0.2.100) — une modification dans une section n\'affecte jamais l\'autre.")' + LN + PUCE_V120,
            ),
            # couverture — bandeau, descriptif, sources, date
            (
                'bande = espacer("README OFFICIEL · ÉDITION RESSERRÉE · V0.2.112")',
                'bande = espacer("README OFFICIEL · ÉDITION RESSERRÉE · V0.2.120")',
            ),
            # NB : le descriptif de couverture est CONDENSÉ directement dans
            # maj_readme_v096.py (v0.2.120 + chaîne signature) — les anciens
            # patchs « version du descriptif » et « PHRASE_COVER » ont été
            # retirés : leurs ancres vivaient dans le texte remplacé.
            (
                'sources = ("Code source livré v0.2.112 · Support de formation RH (servicerh-support-formation-rh.pdf) · "',
                'sources = ("Code source livré v0.2.120 · Support de formation RH (servicerh-support-formation-rh.pdf) · "',
            ),
            (
                'date_txt = "27 septembre 2026 — maintenue à jour au fil des livraisons (recommandation R21)."',
                'date_txt = "30 septembre 2026 — maintenue à jour au fil des livraisons (recommandation R21)."',
            ),
            # pied de page + métadonnées
            (
                'PART["label"] = "édition resserrée v0.2.112"',
                'PART["label"] = "édition resserrée v0.2.120"',
            ),
            (
                'c.setTitle("AutoRH — README officiel — édition resserrée v0.2.109")',
                'c.setTitle("AutoRH — README officiel — édition resserrée v0.2.120")',
            ),
            # annexes — matrice mise à jour (la map de routage reste v0.2.112)
            (
                '"A": "Annexe A : matrice des droits des rôles (état du code v0.2.112)",',
                '"A": "Annexe A : matrice des droits des rôles (état du code v0.2.120)",',
            ),
            # auto-contrôle — nouveaux marqueurs
            (
                '        # QR « Fiche en ligne » (annexe A — fiches de paie)' + LN + '        "Fiche en ligne",',
                '        # QR « Fiche en ligne » (annexe A — fiches de paie)' + LN + ATTENDUS_V120,
            ),
        ],
    )

    # ---------- 2) exécution du générateur ----------
    print(LN + "-- exécution : maj_readme_v096.py --")
    r = subprocess.run([sys.executable, os.path.join(RACINE, "scripts", "maj_readme_v096.py")],
                       cwd=RACINE)
    assert r.returncode == 0, "ÉCHEC : maj_readme_v096.py"

    versionne = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.120.pdf")
    genere = os.path.join(RACINE, "servicerh-readme-technique.pdf")
    dl = os.path.join(RACINE, "download", "servicerh-readme-technique.pdf")
    assert os.path.exists(versionne), "édition versionnée absente"
    m1, m2, m3 = md5f(genere), md5f(dl), md5f(versionne)
    assert m1 == m2 == m3, "MD5 divergents entre les trois canaux"
    print("OK MD5 identiques racine = download = versionnée : " + m1)

    # ---------- 3) discipline download/ : retirer l'édition v0.2.112 ----------
    if os.path.exists(ancien):
        os.remove(ancien)
        print("OK discipline : servicerh-readme-technique-v0.2.112.pdf retiré de download/")

    # ---------- 4) reconstruction du zip v0.2.120 (readme embarqué) ----------
    print(LN + "-- exécution : creer_zip_lite.py --")
    r = subprocess.run([sys.executable, os.path.join(RACINE, "scripts", "creer_zip_lite.py")],
                       cwd=RACINE)
    assert r.returncode == 0, "ÉCHEC : creer_zip_lite.py"
    zip_versionne = os.path.join(RACINE, "download", "servicerh-scripts-site-web-v0.2.120.zip")
    zip_gen = os.path.join(RACINE, "download", "servicerh-scripts-site-web.zip")
    shutil.copy2(zip_versionne, zip_gen)
    assert md5f(zip_versionne) == md5f(zip_gen), "MD5 zip divergents"
    print("OK copie générique du zip : servicerh-scripts-site-web.zip")

    # ---------- 5) contrôle HTTP : ce qui est SERVI = disque ----------
    import urllib.request
    for route, disque in (
        ("http://127.0.0.1:4000/api/download-readme", versionne),
        ("http://127.0.0.1:4000/api/download-scripts", zip_versionne),
    ):
        with urllib.request.urlopen(route, timeout=30) as rep:
            donnees = rep.read()
        m_http = hashlib.md5(donnees).hexdigest()
        m_disque = md5f(disque)
        etat = "OK" if m_http == m_disque else "DIVERGENCE"
        print("%s servi=%s disque=%s (%s)" % (etat, m_http, m_disque, route))
        assert m_http == m_disque, "le fichier servi diffère du disque : " + route

    print(LN + "TERMINÉ — README technique à jour (v0.2.120).")


if __name__ == "__main__":
    main()
