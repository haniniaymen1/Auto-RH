# -*- coding: utf-8 -*-
"""Task 125 — Mise à jour du contenu README (content_s.py + build_doc.py +
merge.py + cover.html) pour v0.2.47. Tampon signature/QR amélioré : mode QR
« Image fournie » (QR importé), décalages fins par élément, limite d'image
relevée à ≈ 4 Mo, aperçu sur la DERNIÈRE fiche importée ; diagnostic IMAP :
bouton « Tester la connexion IMAP » + erreurs journalisées avec l'étape, la
réponse du serveur et une explication actionnable. Chaque remplacement est
asserté.
"""
import io, ast

F = "/home/z/my-project/scripts/task113/content_s.py"
src = io.open(F, encoding="utf-8").read()
n = 0

def remplace(avant, apres, nom):
    global src, n
    assert src.count(avant) == 1, "marqueur %s : %d occurrences" % (nom, src.count(avant))
    src = src.replace(avant, apres)
    n += 1
    print("OK", nom)

# 1) Docstring
remplace("ÉDITION SIMPLIFIÉE v0.2.46", "ÉDITION SIMPLIFIÉE v0.2.47", "docstring")

# 2) Rubrique IMAP du panneau SMTP : bouton Tester + erreurs lisibles
remplace(
    "compte et mot de passe IMAP chiffrés en base comme le SMTP, jamais renvoyés à l'interface.",
    "compte et mot de passe IMAP chiffrés en base comme le SMTP, jamais renvoyés à l'interface. Depuis la 0.2.47, le bouton « Tester la connexion IMAP » exécute le MÊME parcours que le portail (connexion, ouverture de la boîte INBOX, recherche des messages non lus) avec les VALEURS DU FORMULAIRE (test possible avant enregistrement ; mot de passe vide = mot de passe IMAP enregistré, sinon celui du SMTP) et affiche chaque étape avec le détail : en cas d'échec, la réponse exacte du serveur est accompagnée d'une explication actionnable (hôte introuvable, connexion refusée, identifiant ou mot de passe refusé — mot de passe d'application requis pour Gmail/Outlook, problème TLS, boîte INBOX indisponible). Les échecs du relevé périodique du portail sont journalisés avec L'ÉTAPE en cause, la réponse du serveur et la même explication — le « Command failed » opaque ne subsiste plus.",
    "rubrique IMAP : test + erreurs lisibles",
)

# 3) Configuration du tampon : limite 4 Mo + décalages fins + aperçu fiche réelle
remplace(
    "<b>Configuration complète</b> : image de signature/cachet (PNG ou JPEG, aperçu immédiat, retrait), ligne de texte sous l'image (ex. « Le Directeur des Ressources Humaines »), position au choix dans les quatre coins (signature et QR indépendants, décalage automatique s'ils partagent le même coin), largeur/taille et opacité réglables ; bouton « Aperçu sur une fiche d'exemple » qui applique la configuration en cours (avant enregistrement) à un bulletin de démonstration.",
    "<b>Configuration complète</b> : image de signature/cachet (PNG ou JPEG jusqu'à ≈ 4 Mo depuis la 0.2.47 — limite relevée pour les cachets scannés de bonne qualité ; aperçu immédiat, retrait), ligne de texte sous l'image (ex. « Le Directeur des Ressources Humaines »), position au choix dans les quatre coins (signature et QR indépendants, décalage automatique s'ils partagent le même coin), DÉCALAGES FINS horizontal et vertical par élément (0.2.47 : curseurs de −120 à +120 points, bornés au périmètre de la page — l'élément ne peut jamais sortir du document), largeur/taille et opacité réglables ; bouton « Aperçu sur la dernière fiche importée » (0.2.47) qui applique la configuration en cours (avant enregistrement) à la dernière fiche PDF importée — le rendu correspond EXACTEMENT à l'affichage final et le nom de la fiche utilisée est confirmé à l'écran (repli : bulletin de démonstration si la base ne contient aucune fiche exploitable).",
    "configuration tampon : 4 Mo + décalages + aperçu réel",
)

# 4) QR : quatre modes (ajout IMAGE)
remplace(
    "<b>Trois modes de contenu du QR</b> : « Données de la fiche » (référence, employé, CIN, période, net à payer, date d'import et EMPREINTE de contrôle), « URL de vérification » (l'adresse configurée reçoit ?ref=…&cin=…&h=empreinte) ou « Texte personnalisé ». L'empreinte",
    "<b>Quatre modes de contenu du QR</b> : « Données de la fiche » (référence, employé, CIN, période, net à payer, date d'import et EMPREINTE de contrôle), « URL de vérification » (l'adresse configurée reçoit ?ref=…&cin=…&h=empreinte), « Texte personnalisé » ou « Image fournie » (depuis la 0.2.47 : le QR de l'établissement est IMPORTÉ comme image PNG/JPEG jusqu'à ≈ 4 Mo et affiché tel quel dans la boîte de taille configurée, ratio préservé — utile pour un QR déjà imprimé sur les documents officiels). L'empreinte",
    "QR : quatre modes (IMAGE)",
)

# 5) Fiabilité : campagne 0.2.47
remplace(
    "régressions congé (routage N+1 intact) et carte « E-mail de notification ») est PASSÉE intégralement : le taux de fiabilité",
    "régressions congé (routage N+1 intact) et carte « E-mail de notification ») est PASSÉE intégralement, et la campagne 0.2.47 du tampon amélioré et du diagnostic IMAP (16 contrôles, sandbox dédiée avec serveur IMAP factice : test de connexion IMAP réussi avec les valeurs du formulaire PUIS avec la configuration enregistrée, mot de passe faux détecté avec explication actionnable, port refusé identifié, limite d'image relevée — 2,1 Mo acceptés / dépassement refusé « 4 Mo maximum » —, aperçu généré sur une fiche réelle avec confirmation du nom en en-tête, configuration qrMode IMAGE + décalages enregistrée puis fiche servie tamponnée, jumelle du portail extraite et exécutée — mode IMAGE avec ratio, bornes de décalage vérifiées au décalage extrême, mode DONNEES intact) est PASSÉE intégralement : le taux de fiabilité",
    "paragraphe fiabilité 0.2.47",
)

# 6) Tableau 5.5 : ligne 0.2.47
remplace(
    '            ["0.2.46", "Adresse e-mail de l\'employé dans les attestations : page /demandes servie avec les mini-formulaires (e-mail obligatoire, pré-remplissage), 400 sans adresse et 400 avec adresse invalide, création valide (compte SANS adresse) — ligne « E-mail employé » dans l\'e-mail RH texte ET HTML, adresse exactement une fois, employeEmail chiffré en base = adresse saisie, compte portail enrichi puis relu par /api/mon-email, adresse saisie prioritaire sans écraser un compte déjà renseigné, régressions congé (routage N+1) et /api/mon-email POST", "24 contrôles — 100 %"],',
    '            ["0.2.46", "Adresse e-mail de l\'employé dans les attestations : page /demandes servie avec les mini-formulaires (e-mail obligatoire, pré-remplissage), 400 sans adresse et 400 avec adresse invalide, création valide (compte SANS adresse) — ligne « E-mail employé » dans l\'e-mail RH texte ET HTML, adresse exactement une fois, employeEmail chiffré en base = adresse saisie, compte portail enrichi puis relu par /api/mon-email, adresse saisie prioritaire sans écraser un compte déjà renseigné, régressions congé (routage N+1) et /api/mon-email POST", "24 contrôles — 100 %"],\n            ["0.2.47", "Tampon signature/QR amélioré + diagnostic IMAP : test de connexion IMAP réussi (valeurs du formulaire puis configuration enregistrée, 3 étapes), mot de passe faux détecté avec indice actionnable, port refusé identifié, limite d\'image relevée (2,1 Mo acceptés, dépassement refusé « 4 Mo maximum »), aperçu sur fiche réelle avec en-tête X-Apercu-Fiche (nom + période), qrMode IMAGE + qrImage + décalages enregistrés puis fiche servie tamponnée, jumelle portail exécutée (IMAGE + ratio + bornes au décalage extrême + DONNEES intact)", "16 contrôles — 100 %"],',
    "ligne campagne 0.2.47",
)

# 7) Dépannage : entrée IMAP enrichie du test
remplace(
    '            ["Le document envoyé par le RH n\'apparaît pas sur la demande", "Vérifier la rubrique « Réception des réponses du service RH (IMAP) » de l\'onglet Accès portail (interrupteur activé, adresse et port du serveur, identifiants — vides = ceux du SMTP) ; la réponse doit provenir de l\'adresse DESTINATAIRE de la demande (ex. rhEmail) et porter la référence DEM-AAAA-NNNNN dans son objet ; pièce jointe acceptée uniquement (PDF, Word, image — 15 Mo max) ; le portail vérifie toutes les 2 minutes — lire le journal d\'envoi (actions « Document RH reçu » et « Boîte de réception (IMAP) ») pour voir la décision exacte."],',
    '            ["Le document envoyé par le RH n\'apparaît pas sur la demande", "Vérifier la rubrique « Réception des réponses du service RH (IMAP) » de l\'onglet Accès portail (interrupteur activé, adresse et port du serveur, identifiants — vides = ceux du SMTP) ; depuis la 0.2.47, le bouton « Tester la connexion IMAP » de cette rubrique exécute le parcours réel (connexion, INBOX, recherche des non lus) et affiche l\'étape en échec AVEC la réponse du serveur et une explication : « Identifiant ou mot de passe refusé » = utiliser un mot de passe d\'application (Gmail/Outlook), « Connexion refusée » = port faux (993 SSL/TLS, 143 STARTTLS), « Nom de serveur introuvable » = orthographe de l\'hôte ; la réponse doit provenir de l\'adresse DESTINATAIRE de la demande (ex. rhEmail) et porter la référence DEM-AAAA-NNNNN dans son objet ; pièce jointe acceptée uniquement (PDF, Word, image — 15 Mo max) ; le portail vérifie toutes les 2 minutes — le journal d\'envoi (actions « Document RH reçu » et « Boîte de réception (IMAP) ») indique désormais l\'ÉTAPE exacte, la réponse du serveur et l\'explication."],',
    "dépannage IMAP enrichi",
)

# 8) Dépannage : position du tampon (nouvelle entrée 0.2.47)
remplace(
    '            ["Le service RH veut retrouver l\'adresse de l\'employé dans l\'e-mail de demande", "Depuis la 0.2.46, l\'e-mail de création d\'une attestation affiche une ligne « E-mail employé » juste sous le nom de l\'employé : c\'est l\'adresse que l\'employé a saisie dans le formulaire (obligatoire) — ou celle de son compte portail pour les autres types de demandes. La même adresse reçoit la notification « Votre document est disponible » et reste visible dans l\'administration (détail de la demande, « E-mail employé (notifications) »)."],',
    '            ["Le service RH veut retrouver l\'adresse de l\'employé dans l\'e-mail de demande", "Depuis la 0.2.46, l\'e-mail de création d\'une attestation affiche une ligne « E-mail employé » juste sous le nom de l\'employé : c\'est l\'adresse que l\'employé a saisie dans le formulaire (obligatoire) — ou celle de son compte portail pour les autres types de demandes. La même adresse reçoit la notification « Votre document est disponible » et reste visible dans l\'administration (détail de la demande, « E-mail employé (notifications) »)."],\n            ["La signature ou le QR recouvre une zone de la fiche", "Depuis la 0.2.47, chaque élément du tampon (signature ET QR) dispose de curseurs « Décalage horizontal » et « Décalage vertical » (−120 à +120 points) dans la rubrique « Signature électronique & QR code » de l\'onglet Importation : déplacez l\'élément précisément là où la fiche a de la place — les bornes garantissent qu\'il reste entièrement dans la page. Vérifiez le résultat avec « Aperçu sur la dernière fiche importée » (rendu exact) avant d\'enregistrer : le changement s\'applique ensuite immédiatement à toutes les fiches, y compris celles déjà importées."],',
    "dépannage position tampon",
)

# 9) Historique 8.1 : ligne 0.2.47
remplace(
    '                        ["0.2.46", "E-MAIL DE L\'EMPLOYÉ DANS LES ATTESTATIONS : les formulaires attestation de travail et attestation de salaire exigent une adresse e-mail (obligatoire, validée, pré-remplie si le compte en a une) — elle alimente la ligne « E-mail employé » de l\'e-mail envoyé au service RH ET la notification « Votre document est disponible » ; adresse mémorisée chiffrée sur la demande, compte portail enrichi en repli s\'il n\'en avait aucune (jamais écrasé sinon) ; validation serveur 400 sans adresse ou invalide ; aucune migration", "redémarrage"],',
    '                        ["0.2.46", "E-MAIL DE L\'EMPLOYÉ DANS LES ATTESTATIONS : les formulaires attestation de travail et attestation de salaire exigent une adresse e-mail (obligatoire, validée, pré-remplie si le compte en a une) — elle alimente la ligne « E-mail employé » de l\'e-mail envoyé au service RH ET la notification « Votre document est disponible » ; adresse mémorisée chiffrée sur la demande, compte portail enrichi en repli s\'il n\'en avait aucune (jamais écrasé sinon) ; validation serveur 400 sans adresse ou invalide ; aucune migration", "redémarrage"],\n                        ["0.2.47", "TAMPON SIGNATURE/QR AMÉLIORÉ + DIAGNOSTIC IMAP : mode QR « Image fournie » (QR de l\'établissement importé en PNG/JPEG ≈ 4 Mo max, affiché tel quel, ratio préservé), décalages fins horizontal/vertical par élément (curseurs −120…+120 pt bornés à la page), limite d\'image de signature relevée à ≈ 4 Mo, aperçu sur la DERNIÈRE fiche importée (rendu exact, nom confirmé à l\'écran), bouton « Tester la connexion IMAP » (même parcours que le portail, étapes détaillées, réponse du serveur, explication actionnable, test possible avant enregistrement), journal IMAP enrichi (étape + réponse + indice) ; colonnes SignatureConfig qrImage et décalages", "db push (colonnes ajoutées) puis redémarrage"],',
    "historique 0.2.47",
)

# 10) Sources : campagne 0.2.47
remplace(
    "campagne de l'e-mail de l'employé dans les attestations 0.2.46 (scripts/task124/test-email-attestation.js, puits SMTP à capture intégrale : 24 contrôles) et campagnes de tests des livraisons.",
    "campagne de l'e-mail de l'employé dans les attestations 0.2.46 (scripts/task124/test-email-attestation.js, puits SMTP à capture intégrale : 24 contrôles), campagne du tampon amélioré et du diagnostic IMAP 0.2.47 (scripts/task125/test-tampon-imap.js, serveur IMAP factice piloté par HTTP : 16 contrôles) et campagnes de tests des livraisons.",
    "sources 0.2.47",
)

io.open(F, "w", encoding="utf-8").write(src)
print("content_s.py : %d remplacements" % n)
ast.parse(src)
print("ast.parse OK")

# ---- build_doc.py / merge.py / cover.html : numéro de version ----
for f in ["/home/z/my-project/scripts/task113/build_doc.py",
          "/home/z/my-project/scripts/task113/merge.py"]:
    s = io.open(f, encoding="utf-8").read()
    assert s.count("0.2.46") == 3, "%s : %d occurrences attendues 3" % (f, s.count("0.2.46"))
    s = s.replace("0.2.46", "0.2.47")
    io.open(f, "w", encoding="utf-8").write(s)
    ast.parse(s)
    print("OK version dans", f.split("/")[-1])

c = "/home/z/my-project/scripts/task113/cover.html"
s = io.open(c, encoding="utf-8").read()
assert s.count("0.2.46") == 3, "cover.html : %d occurrences attendues 3" % s.count("0.2.46")
s = s.replace("0.2.46", "0.2.47")
io.open(c, "w", encoding="utf-8").write(s)
print("OK version dans cover.html")
