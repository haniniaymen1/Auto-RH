#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 64 — mise en cohérence des tests de régression historiques :
  1. ports 3000 -> 4000 et 3001 -> 4001 dans les tests (fins F « régressions ») ;
  2. ATTENDU 237 -> 243 (3 ZIP : + 6 fichiers Task 64) ;
  3. verify_task18.py / test_task33_souvenir.py : l'OTP est REMPLACÉ par le
     mot de passe (Task 64) -> ces tests sont désormais des rapports de
     « fonctionnalité remplacée » avec vérifications triviales de la nouvelle
     connexion, la couverture complète étant assurée par test64_portail.py.
UTF-8 préservé, remplacements idempotents.
"""
import io
import sys

BASE = "/home/z/my-project/scripts/"

SIMPLES = [
    "test_task40_securisation_auto.py",
    "test_task42_demarrage_unique.py",
    "test_task38_sans_lanceurs.py",
    "test_task36_sans_snippet.py",
    "test_task25_split_docx.py",
    "test_task25_redetect.py",
    "test_site_redetect.py",
    "test_e2e_user_pdf.py",
    "test_task27_redetect.py",
    "test_task29_bulk_delete.py",
    "verify_task17.py",
    "verify_task19.py",
    "verify_task21.py",
    "test_myfiches_task19.py",
    "test_portail_20.sh",
    "portal_login_helper.py",
]


def remplace_ports(texte):
    n = texte.count("3000") + texte.count("3001")
    texte = texte.replace("3000", "4000").replace("3001", "4001")
    return texte, n


def main() -> int:
    # 1) Ports dans les tests simples
    for nom in SIMPLES:
        chemin = BASE + nom
        try:
            with io.open(chemin, encoding="utf-8") as f:
                t = f.read()
        except FileNotFoundError:
            print(f"  [absent] {nom}")
            continue
        t2, n = remplace_ports(t)
        if n:
            with io.open(chemin, "w", encoding="utf-8") as f:
                f.write(t2)
            print(f"  [ok ×{n}] {nom}")
        else:
            print(f"  [déjà fait] {nom}")

    # 2) ATTENDU 237 -> 243 (task40 et task42)
    for nom in ["test_task40_securisation_auto.py", "test_task42_demarrage_unique.py"]:
        chemin = BASE + nom
        with io.open(chemin, encoding="utf-8") as f:
            t = f.read()
        if "ATTENDU = 237" in t:
            t = t.replace(
                "ATTENDU = 237",
                "ATTENDU = 243  # (MODIFIÉ Task 64) 237 + 6 nouveaux fichiers Task 64",
            )
            with io.open(chemin, "w", encoding="utf-8") as f:
                f.write(t)
            print(f"  [ok] {nom} : ATTENDU 243")
        elif "ATTENDU = 243" in t:
            print(f"  [déjà fait] {nom} : ATTENDU 243")
        else:
            print(f"  [info] {nom} : ATTENDU non trouvé")

    # 3) test_task37 : contrôles portail en cohérence (mot de passe, plus de code)
    chemin = BASE + "test_task37_sans_historique.py"
    with io.open(chemin, encoding="utf-8") as f:
        t = f.read()
    if 'type="password" id="password"' not in t:
        ancien = """    check("portail : champ code OTP sans historique (autocomplete off)",
          'autocomplete="off"' in html and "one-time-code" not in html)"""
        if ancien not in t:
            # motif flexible : on remplace la ligne exacte par recherche
            lignes = t.split("\\n")
            print(f"  [info] {nom} : motif task37 portail non trouvé — vérification manuelle")
        else:
            t = t.replace(ancien, """    # (MODIFIÉ Task 64) : le champ code OTP est remplacé par un champ MOT DE
    # PASSE (autocomplete new-password — aucun historique ni enregistrement).
    check("portail : champ mot de passe new-password, plus de code OTP",
          'type="password" id="password"' in html
          and 'autocomplete="new-password"' in html and "one-time-code" not in html)""")
            with io.open(chemin, "w", encoding="utf-8") as f:
                f.write(t)
            print(f"  [ok] {nom} : contrôle portail mot de passe")
    else:
        print(f"  [déjà fait] {nom}")

    print("Mise en cohérence des tests terminée.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
