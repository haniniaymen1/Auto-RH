#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Vérification du contenu du PDF d'acceptation GÉNÉRÉ (v0.2.189) :
  - PRÉSENTS : en-tête, sections conservées, les 2 lignes d'historique
    (« Demande créée le … », « Décision finale : Acceptée — … »),
    informations de la demande (référence, type, statut, dates),
    identité de l'employé, détail (type de congé, période, jours) ;
  - ABSENTS  : « Décision rendue par », section « Validations » (titre),
    « Validation du manager », « Validation du service RH », « Validation
    finale (date et heure) », « Note du manager », section « Manager /
    responsable », le nom du manager de test et le décideur de test
    (aucune fuite d'acteur).
"""
import sys
from pypdf import PdfReader

CHEMIN = "/home/z/my-project/scripts/genere-v02189-acceptation.pdf"

ok, fail = 0, 0
def verif(libelle, cond):
    global ok, fail
    if cond:
        ok += 1
        print("  OK  - " + libelle)
    else:
        fail += 1
        print("  FAIL- " + libelle)

lecteur = PdfReader(CHEMIN)
texte = " ".join((p.extract_text() or "") for p in lecteur.pages)
sans_esp = "".join(texte.split())
annee = str(__import__("datetime").date.today().year)

verif("une seule page (règle anti-pagination conservée)", len(lecteur.pages) == 1)
# ---- conservés ----
verif("titre « DÉCISION D'ACCEPTATION » présent", "DÉCISIOND'ACCEPTATION" in sans_esp)
verif("section « Informationsdelademande » présente", "Informationsdelademande" in sans_esp)
verif("référence présente", ("DEM-" + annee + "-TEST1").replace("-", "") in sans_esp.replace("-", "") or ("DEM-" + annee + "-TEST1") in texte)
verif("« Statutfinal » + « Acceptée » présents", "Statutfinal" in sans_esp and "ACCEPTÉE" in sans_esp)
verif("« Datedelademande » présente", "Datedelademande" in sans_esp)
verif("« Datedeladécision » présente", "Datedeladécision" in sans_esp)
verif("section « Identitédel'employé » présente", "Identitédel'employé" in sans_esp)
verif("« Nom et prénom » présent", "Nom etprénom" in sans_esp or "Nomprénom" in sans_esp.replace("et", "") or "Nom et prénom" in texte)
verif("section « Détaildelademande » présente", "Détaildelademande" in sans_esp)
verif("« Type de congé » présent (détail)", "Typedecongé" in sans_esp)
verif("« Nombrededejours » présent (détail)", "Nombredejours" in sans_esp)
verif("historique : « Demandecrééele » PRÉSENT", "Demandecrééele" in sans_esp)
verif("historique : date de création (10/10/) présente", ("10/10/" + annee) in texte.replace(" ", ""))
verif("historique : « Décisionfinale : Acceptée — » PRÉSENT", "Décisionfinale:Acceptée—" in sans_esp)
verif("historique : date de décision (12/10/) présente", ("12/10/" + annee) in texte.replace(" ", ""))
# ---- supprimés ----
verif("« Décisionrenduepar » ABSENT", "Décisionrenduepar" not in sans_esp)
verif("titre de section « Validations » ABSENT", "Validations" not in sans_esp)
verif("« Validationdumanager » ABSENT", "Validationdumanager" not in sans_esp)
verif("« ValidationduserviceRH » ABSENT", "ValidationduserviceRH" not in sans_esp)
verif("« Validationfinale(dateetheure) » ABSENT", "Validationfinale" not in sans_esp)
verif("« Notedumanager » ABSENT", "Notedumanager" not in sans_esp)
verif("section « Manager/responsable » ABSENT", "Manager/responsable" not in sans_esp)
verif("« Nomedumanager » ABSENT", "Nomedumanager" not in sans_esp)
verif("« Adresse e-mail du manager » ABSENT", "Adresse e-maildumanager" not in sans_esp and "Adressedumanager" not in sans_esp)
verif("AUCUNE fuite du manager de test", "NEPASafficher" not in sans_esp and "ManagerN+1" not in sans_esp)
verif("AUCUNE fuite du décideur de test", "Martina" not in sans_esp)
verif("AUCUN « par » d'acteur dans l'historique (aucune trace « (par »)", "(par" not in texte)

print()
print("=== RÉSULTAT génération v0.2.189 : %d OK / %d FAIL ===" % (ok, fail))
sys.exit(1 if fail else 0)
