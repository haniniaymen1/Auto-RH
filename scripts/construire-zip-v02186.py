#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construit les ZIP de livraison v0.2.186 (Auto-RH) — CERTIFICAT DÉDIÉ MASQUÉ
POUR LE RÔLE RH dans l'administration (demande utilisateur du 11/10/2026) :

  - COMPLET : auto-rh-scripts-site-web-v0.2.186.zip
  - LEGER   : auto-rh-scripts-site-web-v0.2.186-leger.zip

Base : ZIP v0.2.185 (MD5 e563006f6cb43cada2ca7fcf6f0bc2eb).
Changements :
  1) src/components/payslip/reponse-pdf-panel.tsx (v0.2.186) — section
     « Réponse automatique PDF par e-mail (congé / autorisation) » : NOUVELLE
     prop masquerCertificat (défaut false) — quand elle est vraie, le BLOC
     « Signature électronique — certificat dédié à cette section » (import
     .p12/.pfx, mot de passe, interrupteur de signature, boutons
     Vérifier/Retirer, nom et fonction du signataire) N'EST PLUS RENDU ;
     l'avertissement du cachet « Signature électronique » (certificat absent)
     renvoie le RH vers le superadministrateur au lieu de proposer l'import ;
     configuration inchangée et TOUJOURS appliquée aux réponses (un
     enregistrement fait depuis la vue RH réécrit les valeurs du certificat
     telles que chargées du serveur) ;
  2) src/components/payslip/demandes-tab.tsx (v0.2.186) — câblage du rôle :
     <ReponsePdfPanel masquerCertificat={role === "RH"} /> — le RH ne voit
     PLUS le bloc, le SUPERADMIN le conserve ENTIÉR (aucun changement pour
     lui) ; AUCUN changement d'API ni de configuration ;
     Preuve : scripts/test_v02186_masquer_certificat_rh.js — 60 OK / 0 FAIL
     (structure JSX, câblage, contenu préservé, simulations) + non-régression
     58 (v0.2.185) + build de production 0 erreur ;
  3) portail-server.js INCHANGÉ (v0.2.185 : règle d'affichage du refus) —
     règles v0.2.177/179/180/181/182/183/184/185 strictement conservées ;
  4) README : ÉDITION ESSENTIELLE v0.2.186 (12 pages — puce « Certificat
     dédié masqué pour le rôle RH (v0.2.186) », Tableau 5.1 + ligne v0.2.186,
     durée 186 versions, matrice des droits mise à jour) ;
  5) test v0.2.186 + générateur README v0.2.186 + constructeur ZIP v0.2.186
     embarqués (les scripts des versions antérieures restent dans l'archive) ;
  6) VERSION = 0.2.186, MANIFEST-LIVRAISON.txt régénéré.

Intégrité vérifiée (testzip) + contrôles + MD5 affichés.
"""
import os, zipfile, hashlib, shutil

REF_COMPLET = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.185.zip"
REF_LEGER   = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.185-leger.zip"
SORTIE      = "/home/z/my-project/download"
VERSION     = "v0.2.186"

README_NOUVEAU = "/home/z/my-project/download/servicerh-readme-technique-v0.2.186.pdf"
FICHIERS_REMPLACES = {
    "src/components/payslip/reponse-pdf-panel.tsx": "/home/z/my-project/src/components/payslip/reponse-pdf-panel.tsx",
    "src/components/payslip/demandes-tab.tsx":      "/home/z/my-project/src/components/payslip/demandes-tab.tsx",
}
NOUVEAUX = {
    "scripts/test_v02186_masquer_certificat_rh.js": "/home/z/my-project/scripts/test_v02186_masquer_certificat_rh.js",
    "scripts/creer_readme_essentiel_v02186.py": "/home/z/my-project/scripts/creer_readme_essentiel_v02186.py",
    "scripts/construire-zip-v02186.py":     "/home/z/my-project/scripts/construire-zip-v02186.py",
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
            if n in FICHIERS_REMPLACES:
                out.write(FICHIERS_REMPLACES[n], n)  # version de l'arbre
                continue
            if n == "auto-rh-readme-technique.pdf":
                out.write(README_NOUVEAU, n)  # édition essentielle v0.2.186
                continue
            if n == "servicerh-readme-technique-reduit.pdf" and mode == "COMPLET":
                out.write(README_NOUVEAU, n)
                continue
            out.writestr(n, ref.read(n))
        for arc, src in NOUVEAUX.items():
            out.write(src, arc)
        out.writestr("VERSION", "0.2.186\n")
    ref.close()
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
    classif = zf.read("scripts/classification-reponses.js").decode("utf-8", "replace")
    # (v0.2.186) fichiers d'interface modifiés, lus depuis l'archive
    panel = zf.read("src/components/payslip/reponse-pdf-panel.tsx").decode("utf-8", "replace")
    demandes_tab = zf.read("src/components/payslip/demandes-tab.tsx").decode("utf-8", "replace")
    # bloc decisionMasquee de l'API employé (extraction comme dans le test 184)
    iB = portail.find("if (decisionMasquee) {")
    blocMasque = ""
    if iB >= 0:
        jB = portail.find("\n        }", iB)
        if jB > iB:
            blocMasque = portail[iB:jB]
    verifs = {
        "testzip": bad is None,
        "VERSION 0.2.186": zf.read("VERSION").decode().strip() == "0.2.186",
        # ---- NOUVEAU v0.2.186 : interface — certificat dédié masqué pour le RH ----
        "panneau = prop masquerCertificat (défaut false)":
          "masquerCertificat = false," in panel and "masquerCertificat?: boolean;" in panel,
        "panneau = garde de rendu {!masquerCertificat && (":
          panel.count("{!masquerCertificat && (") == 1,
        "panneau = bloc certificat dédié SOUS la garde (ordre JSX)":
          -1 < panel.find("{!masquerCertificat && (") < panel.find(">Signature électronique — certificat dédié à cette section</span>") < panel.find("{/* ---------- SIGNATURE IMAGE (paraphe) ---------- */}"),
        "panneau = bloc conservé pour le SUPERADMIN (import .p12/.pfx)":
          'accept=".p12,.pfx"' in panel and "Importer le certificat" in panel,
        "panneau = signataire/fonction conservés (vue SUPERADMIN)":
          "Nom du signataire (bloc « Fait le… »)" in panel and "Fonction du signataire" in panel,
        "panneau = cachet : branche RH renvoie au superadministrateur":
          "Le certificat dédié est géré par le superadministrateur" in panel,
        "panneau = cachet : consigne d'import conservée pour le SUPERADMIN":
          "Importez le .p12 / .pfx dans la section « Signature électronique — certificat dédié » ci-dessus." in panel,
        "panneau = l'import n'est plus proposé hors ternaire (texte fixe adapté)":
          "réponses.\n              {/* (v0.2.186)" in panel,
        "panneau = configuration TOUJOURS appliquée (corpsEnregistrement)":
          "signerActif: cfg.certificat.signer," in panel and "certSignataire: cfg.certificat.signataire," in panel,
        "panneau = en-tête documente le changement v0.2.186":
          "(v0.2.186 — demande « Dans le rôle RH, masquer juste la partie « Signature" in panel,
        "demandes-tab = masquerCertificat={role === \"RH\"}":
          '<ReponsePdfPanel masquerCertificat={role === "RH"} />' in demandes_tab,
        "demandes-tab = aucune instanciation sans props":
          "<ReponsePdfPanel />" not in demandes_tab,
        "demandes-tab = commentaire v0.2.186 présent":
          "(v0.2.186) Rôle RH : le bloc « Signature électronique — certificat" in demandes_tab,
        "interface = autres sections intactes (paraphe, tampon, QR, cachet, e-mail)":
          all(s in panel for s in (
              "Signature sous forme d&apos;image (paraphe)",
              "Tampon (cachet de l&apos;établissement)",
              "QR Code de vérification / consultation",
              "Cachet « Signature électronique »",
              "Mention légale",
              "Envoi par e-mail (réponse PDF en pièce jointe)",
              "Enregistrer la configuration")),
        # ---- NOUVEAU v0.2.186 : README ----
        "README = édition essentielle (V0.2.186)": "V0.2.186" in sans_esp,
        "README = durée du projet (186 versions)": ("Duréeduprojet" in sans_esp and "30jours" in sans_esp
                                                    and "186versions" in sans_esp),
        "README = puce « Certificat dédié masqué pour le rôle RH »":
          "CertificatdédiémasquépourlerôleRH" in sans_esp and "masquerCertificat" in sans_esp,
        "README = Tableau 5.1 ligne v0.2.186 (CERTIFICAT DÉDIÉ MASQUÉ POUR LE RH)":
          "CERTIFICATDÉDIÉMASQUÉPOURLERH" in sans_esp,
        "README = 60 contrôles dédiés cités": "60contrôles" in sans_esp,
        "README = 503 contrôles cités (preuve 185)": "503contrôles" in sans_esp,
        "README = 12 pages": len(lecteur.pages) == 12,
        # ---- README : héritages vérifiés (185 / 184 / 183) ----
        "README = puce « Règle d'affichage du refus » (185)":
          "Règled'affichagedurefus" in sans_esp and "sansacteur" in sans_esp,
        "README = « ni le département ni le manager » cité (185)":
          "niledépartementnilemanager" in sans_esp,
        "README = 58 contrôles dédiés cités (185)": "58contrôles" in sans_esp,
        "README = « est désormais : Refusée » cité (185)": "estdésormais:Refusée" in sans_esp,
        "README = puce « Pièces jointes du manager et des RH à toutes les étapes » (184)":
          "PiècesjointesdumanageretdesRHàtouteslesétapes" in sans_esp,
        "README = notification intermédiaire (notificationEtapeIntermediaire)":
          "notificationEtapeIntermediaire" in sans_esp,
        "README = formulation neutre (« transmis avec la réponse à votre demande »)":
          "Document(s)transmisaveclaréponseàvotredemande" in sans_esp,
        "README = « Elle poursuit son circuit de validation habituel »":
          "Ellepoursuitsoncircuitdevalidationhabituel" in sans_esp,
        "README = 445 contrôles cités (preuve 184)": "445contrôles" in sans_esp,
        "README = Tableau 2.1 expressions conservé (v0.2.183)":
          ("Tableau2.1" in sans_esp and "Expressionsdedécisionreconnuesparréponsee-mail" in sans_esp),
        # ---- portail : NOUVEAU v0.2.185 — règle d'affichage du refus ----
        "portail = constante refusSansActeur (statut REFUSEE)":
          'const refusSansActeur = d.statut === "REFUSEE";' in portail,
        "portail = libellé du refus « Refusée » seule mention (ternaire)":
          'refusSansActeur\n          ? "Refusée"\n          : libelleStatutFinalDemande(d.statut, d.refuseePar);' in portail,
        "portail = acteur de traitement masqué pour un refus (traiteParVu = null)":
          "let traiteParVu = refusSansActeur ? null : (d.traitePar || null);" in portail,
        "portail = commentaire de refus masqué (commentaireVu = vide)":
          'let commentaireVu = refusSansActeur ? "" : (d.commentaire || "");' in portail,
        "portail = date de traitement conservée (traiteLeVu sans condition)":
          "let traiteLeVu = d.traiteLe ? d.traiteLe.toISOString() : null;" in portail,
        "portail = règle applicable à TOUS les types (aucun garde-fou de type)":
          'const refusSansActeur = d.statut === "REFUSEE";\n        let statutVu' in portail,
        "portail = e-mails conservent le libellé raffiné (« Refusée par le Manager »)":
          'if (refuseePar === "MANAGER") return "Refusée par le Manager";' in portail,
        "portail = e-mails conservent le libellé raffiné (« Refusée par les RH »)":
          'if (refuseePar === "RH") return "Refusée par les RH";' in portail,
        "portail = e-mail décision congé utilise le libellé raffiné":
          "libelleStatutFinalDemande(statutApres, refuseePar)" in portail,
        "portail = refuseePar conservé en base (traçage administration)":
          'maj.refuseePar = "MANAGER";' in portail and 'maj.refuseePar = "RH";' in portail,
        # ---- portail : v0.2.184 — étape intermédiaire (inchangé) ----
        "portail = bloc (NOUVEAU v0.2.184) ÉTAPE INTERMÉDIAIRE présent":
          "(NOUVEAU v0.2.184 — DEMANDE UTILISATEUR) ÉTAPE INTERMÉDIAIRE" in portail,
        "portail = condition d'envoi (PJs + statut non final + garde 179)":
          'if (!sansReponseAutoPdf && importes.length &&\n        statutApres !== "ACCEPTEE" && statutApres !== "REFUSEE") {' in portail,
        "portail = notification « document disponible » avec contexte étape-intermediaire":
          'cfgMail, "etape-intermediaire")' in portail,
        "portail = formulation neutre « transmis avec la réponse à votre demande »":
          '"Document(s) transmis avec la réponse à votre demande"' in portail,
        "portail = journal notificationEtapeIntermediaire":
          "notificationEtapeIntermediaire: notificationEtapeIntermediaire," in portail,
        # ---- portail : v0.2.184 — PJs visibles à toutes les étapes (inchangé) ----
        "portail = API employé : bloc decisionMasquee NE vide PLUS documentsVu":
          blocMasque != "" and "documentsVu = []" not in blocMasque,
        "portail = API employé : décision toujours masquée (statutVu EN_ATTENTE)":
          blocMasque != "" and 'statutVu = "EN_ATTENTE"' in blocMasque,
        "portail = garde v0.2.177 inchangée (deuxEtapesDem && EN_ATTENTE)":
          'const decisionMasquee = deuxEtapesDem && d.statut === "EN_ATTENTE";' in portail,
        "portail = règle v0.2.185 placée APRÈS decisionMasquee (priorité v0.2.177)":
          portail.find('const refusSansActeur = d.statut === "REFUSEE";') >
          portail.find('const decisionMasquee = deuxEtapesDem && d.statut === "EN_ATTENTE";'),
        # ---- portail : chemin final v0.2.171 inchangé ----
        "portail = agrégation PJs avant l'e-mail de décision (v0.2.171)":
          "piecesReponsesEmploye = await piecesJointesReponsesPourEmploye(demande, importes);" in portail,
        "portail = PJs antérieures (recuDe @) agrégées":
          'where: { demandeId: demande.id, recuDe: { contains: "@" } },' in portail,
        "portail = PDF signé joint à la réponse finale":
          "pieceJointe: docFinal && docFinal.pieceJointe ? docFinal.pieceJointe : null," in portail,
        "portail = génération PDF aux statuts FINAUX seulement":
          'if (decisionApplicable && !sansReponseAutoPdf && (statutApres === "ACCEPTEE" || statutApres === "REFUSEE")) {' in portail,
        # ---- v0.2.182 conservé : documents du responsable — parrainage ----
        "portail = auteur parrainage « Le responsable de votre demande »":
          '? "Le responsable de votre demande"' in portail,
        "portail = phrase parrainage « traitée par le responsable concerné »":
          "Votre demande de parrainage a été traitée par le responsable concerné" in portail,
        "portail = attestation : auteur conservé « Le service RH »":
          '? "Le responsable de votre demande"' in portail and ': "Le service RH";' in portail,
        "portail = parrainage doc-disponible conservé":
          '"Document(s) transmis par le responsable de votre demande"' in portail,
        "portail = document disponible : « service RH » conservé pour les autres cas":
          '"Document(s) transmis par le service RH"' in portail,
        # ---- v0.2.181 conservé : classification des expressions (moteur inchangé) ----
        "classification = acceptation « j accepte », « ok », « d accord », « je valide »":
          all(m in classif for m in ('"j accepte"', '"ok"', '"d accord"', '"je valide"')),
        "classification = refus « je refuse », « hors de question » + négations":
          all(m in classif for m in ('"je refuse"', '"hors de question"', "je ne peux pas accepter")),
        "portail = ATTESTATION_TRAVAIL/SALAIRE + PARRAINAGE dans TYPES_CLASSIFICATION_AUTO":
          all(t in portail.split("TYPES_CLASSIFICATION_AUTO = [")[1].split("]")[0]
              for t in ('"ATTESTATION_TRAVAIL"', '"ATTESTATION_SALAIRE"', '"PARRAINAGE"')),
        # ---- v0.2.180 conservé : transmission des PJs du RH avec la décision ----
        "portail = fonction envoyerEmailDecisionDocumentsRh": "async function envoyerEmailDecisionDocumentsRh(" in portail,
        "portail = pièces attachées à l'e-mail de décision": "attachments: pieces" in portail,
        "portail = journal documentsRhTransmis": "documentsRhTransmis: notification && Array.isArray(notification.documents)" in portail,
        # ---- v0.2.179 conservé : aucun PDF auto-généré attestations/parrainage ----
        "portail = génération PDF protégée (!sansReponseAutoPdf)":
          "if (decisionApplicable && !sansReponseAutoPdf &&" in portail,
        "portail = 1 seul appel doc-acceptation (protégé)":
          portail.count("await traiterDocumentSigneAcceptation(") == 1,
        "portail = 1 seul appel doc-refus (protégé)":
          portail.count("await traiterDocumentRefusDecision(") == 1,
        "portail = trace reponseAutoPdf desactivee":
          "reponseAutoPdf: decisionApplicable && sansReponseAutoPdf" in portail,
        # ---- v0.2.178/177 conservés ----
        "portail = branche décision unique parrainage": "Service parrainage (réponse e-mail)" in portail,
        "portail = cadre vert masqué": 'class="d-etapes"' not in portail and ".d-etapes" not in portail,
        "portail = confidentialité décision (decisionMasquee)": "decisionMasquee" in portail,
        "portail = magic/sels intacts": ("PAIESAGE1" in portail and "autorh-signature-v1" in portail),
        # ---- embarqués ----
        "test certificat dédié masqué 186 embarqué": "scripts/test_v02186_masquer_certificat_rh.js" in noms,
        "générateur README 186 embarqué": "scripts/creer_readme_essentiel_v02186.py" in noms,
        "constructeur ZIP 186 embarqué": "scripts/construire-zip-v02186.py" in noms,
        "test affichage refus 185 embarqué": "scripts/test_v02185_affichage_refusee.js" in noms,
        "générateur README 185 embarqué": "scripts/creer_readme_essentiel_v02185.py" in noms,
        "constructeur ZIP 185 embarqué": "scripts/construire-zip-v02185.py" in noms,
        "test PJ congé/autorisation 184 embarqué": "scripts/test_v02184_pj_conge_autorisation.js" in noms,
        "générateur README 184 embarqué": "scripts/creer_readme_essentiel_v02184.py" in noms,
        "constructeur ZIP 184 embarqué": "scripts/construire-zip-v02184.py" in noms,
        "test PJ parrainage 182 (MAJ 3 branches) embarqué": "scripts/test_v02182_pj_parrainage.js" in noms,
        "test expressions 181 embarqué": "scripts/test_v02181_expressions_attestations_parrainage.js" in noms,
        "test PJ décision 180 embarqué": "scripts/test_v02180_pj_decision_rh.js" in noms,
        "test 179 conservé": "scripts/test_v02179_reponse_auto_pdf.js" in noms,
        "test E2E 178 conservé": "scripts/test_v02178_parrainage_email.js" in noms,
        "route upload présente": "src/app/api/payslips/upload/route.ts" in noms,
        "test 405 embarqué": "scripts/test_correctif_405_upload.js" in noms,
        "reduit présent": "servicerh-readme-technique-reduit.pdf" in noms or mode == "LEGER",
        "VBS chiffrer-fiches-silencieux ABSENT": not any("CHIFFRER-FICHES-SILENCIEUX" in n for n in noms),
        "0 PDF v0.2.185 restant": not any("-v0.2.185.pdf" in n for n in noms),
        "0 lanceur supprimé": not any(x in noms for x in (
            "DEMARRER-WINDOWS.bat", "DEMARRER-TOUT-WINDOWS.bat",
            "DEMARRER-PORTAIL-WINDOWS.bat", "SCINDER-DOCX-WINDOWS.bat",
            "SCINDER-EXCEL-WINDOWS.bat", "SCINDER-FICHES-WINDOWS.bat",
            "SECURISER-DOSSIER-WINDOWS.bat", "SECURISER-DOSSIERS-WINDOWS.bat")),
    }
    zf.close()
    return verifs


def main():
    print("=== Construction v0.2.186 (certificat dédié masqué pour le rôle RH — administration) ===\n")
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
        echecs = [k for k, okk in v.items() if not okk]
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
