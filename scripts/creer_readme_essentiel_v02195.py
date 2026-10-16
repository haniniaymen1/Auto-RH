#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
README officiel AutoRH — ÉDITION ESSENTIELLE v0.2.195 (~15 pages).

Demande utilisateur (v0.2.195) : « masquer cette partie dans cadre vert pour role
rh dans les demade conge et autorisation » (capture : la carte « Décision Manager »
du détail d'une demande — badge « En attente » + rangée « Enregistrer la décision
du manager : Acceptée / Refusée »). — NOUVEAU : dans l'onglet « Demandes »
(DemandesTab), la CARTE « Décision Manager » du dialogue de détail est MASQUÉE
pour le rôle RH pour LES demandes à deux étapes (congé et autorisation de sortie) :
une note discrète la remplace (« enregistrée par sa réponse e-mail — ou par le
superadministrateur ») et l'ÉTAT de la décision (badge, date, acteur, formulation)
reste consultable dans la section « Décision RH » ci-dessous (boîte « ÉTAT
ACTUEL ») ainsi que dans la LISTE (badges « M : »). Le repli opérationnel
(enregistrement manuel de la décision du manager) devient réservé au
SUPERADMIN — les boutons « Acceptée / Refusée » lui restent intégraux ; les
boutons de décision du RH (« Accepter la demande », « Refuser la demande »,
« Information requise ») restent inchangés. AFFICHAGE SEUL : AUCUN changement
serveur ni API (la matrice Manager × RH est intacte).

Demande utilisateur (v0.2.194) : « masquer ce bloc pour le role rh dans la section
importer et demande » (capture : le bloc « Fichier de certificat de CETTE section »
+ « Clé privée associée (.pem, .key, .der) — facultative » + avertissement « Aucun
certificat DÉDIÉ importé »). — NOUVEAU : le bloc d'IMPORT du fichier de certificat
(choix du fichier .p12/.pfx/…, mot de passe PKCS#12, clé privée associée, notes
d'attente/de retrait et avertissements d'import) est MASQUÉ pour le rôle RH dans les
DEUX sections qui le portent : onglet « Importer » (SignaturePanel — rubrique
« Certificat de signature électronique » des fiches de paie) et onglet « Demandes »
(SignaturePanelReponses — rubrique « Certificat de signature électronique
(réponses) ») ; une note informative indique au RH que l'import est réservé au
superadministrateur. L'interrupteur d'utilisation, le positionnement du bloc et
l'affichage des métadonnées restent visibles ; le certificat enregistré continue de
s'appliquer (fiches et réponses) quelle que soit la personne qui consulte. Même
pattern que ReponsePdfPanel v0.2.186 (prop masquerCertificat) — 3e section ainsi
gouvernée. SUPERADMIN conserve les blocs ENTIERS ; AUCUN changement serveur (les
routes d'import restaient déjà gardées par la session).

Demande utilisateur (v0.2.193) : « Même si les interrupteurs sont activés ou désactivés,
les e-mails de notification d'acceptation ou de refus doivent toujours être envoyés. Les
interrupteurs doivent uniquement contrôler l'envoi de la réponse automatique par PDF, sans
modifier le fonctionnement des notifications par e-mail ». — NOUVELLE SÉMANTIQUE sur les
TROIS voies (portail congé/autorisation, administration acceptation signée, administration
refus signé) : la notification de décision part TOUJOURS à TOUS les destinataires
historiques (employé « À », service RH et manager en copies) — AUCUN interrupteur ne peut
plus en exclure quelqu'un. Les 4 interrupteurs du panneau « Envoi par e-mail (réponse PDF
en pièce jointe) » ne gouvernent PLUS QUE LA RÉPONSE PDF : le document signé et tamponné
n'est joint qu'aux destinataires dont l'interrupteur est activé (maître ON) ; les autres
reçoivent LA MÊME notification SANS le PDF (au plus deux messages). L'interrupteur maître
« Envoi automatique de l'e-mail » ne supprime PLUS aucun envoi (code ENVOI_DESACTIVE
retiré) — OFF = personne ne reçoit le PDF, tout le monde reçoit la notification. Refus
congé/autorisation (pas de PDF — v0.2.188) : les drapeaux sont SANS EFFET, tout le monde
est notifié. Preuve : test v0.2.193 dédié 53/53 (traiterAcceptationFinale et traiterRefus
RÉELS sur la vraie base ReponsePdfConfig, fonction portail réelle, code extrait) + suites
v0.2.179→191 adaptées et relancées — 0 échec ; build production OK ; panneau vérifié dans
le navigateur (descriptions mises à jour).

Demande utilisateur (v0.2.192) : « Afficher les boutons de gestion des comptes de manière
plus pratique afin de faciliter leur utilisation, sans avoir à faire défiler les colonnes
vers la gauche et vers la droite ». — COLONNE ACTIONS COLLANTE À DROITE du tableau
« Comptes utilisateurs — superadministration » : les 5 boutons (Désactiver / Manager /
Mot de passe / Rôle / Supprimer — et « Réactiver » le cas échéant) restent VISIBLES et
CLIQUABLES même quand le tableau défile horizontalement (position sticky, fond opaque,
séparation + ombre portée). Le hook de redimensionnement des colonnes est étendu par une
option OPT-IN (attribut data-col-sticky="right") qui RESPECTE la position collante au
lieu d'imposer « relative » — les autres tableaux ne changent PAS de comportement.
Compactage : colonnes secondaires masquées sur les écrans étroits (Manager < XL,
Créé le < LG) et e-mail tronqué avec infobulle — à 1000 px de large le tableau ne défile
PLUS du tout ; les poignées de redimensionnement restent fonctionnelles. Preuve :
vérification navigateur réelle (colonnes mesurées au pixel, défilement forcé à 780 px —
Actions collée au bord droit, boutons cliquables vérifiés par elementFromPoint, dialogue
Rôle ouvert/fermé, sticky conservé) + build production OK.

Demande utilisateur (v0.2.191) : « les interrupteurs de la section « Envoi par e-mail
(réponse PDF en pièce jointe) » ne fonctionnent ni lorsqu'ils sont activés ni lorsqu'ils
sont désactivés ». — DEUX CAUSES RACINES CORRIGÉES : (1) le module document-acceptation.js
(chargerConfig — partagé par TOUTES les décisions de l'administration : acceptation / refus
signés, réponse avec document importé) IGNORAIT le panneau tant que la section n'était pas
« engagée » (interrupteur de génération OFF — LE DÉFAUT — et aucun certificat dédié
importé) : repli sur la configuration historique TOUS ON → les 4 interrupteurs e-mail
restaient SANS AUCUN EFFET ; (2) la voie e-mail du portail ne consultait pas l'interrupteur
MAÎTRE « Envoi automatique de l'e-mail » (emailActif) et son échec de lecture de
configuration était SILENCIEUX (client Prisma ancien → repli défauts ON sans aucune trace).
CORRECTIF : les 4 interrupteurs e-mail (maître + Employé / RH / Manager) s'appliquent DÈS
QUE LA LIGNE ReponsePdfConfig EXISTE, sur TOUTES les voies (portail + administration) ;
maître OFF → AUCUN envoi (journal ENVOI_DESACTIVE) ; diagnostics explicites (garde client
Prisma ancien + trace des interrupteurs lus à chaque décision). Preuve : 40 contrôles
dédiés + 520 contrôles de non-régression (10 suites chiffrées) + 4 suites complémentaires
— 0 échec.

Demande utilisateur (v0.2.190) : « lorsque je désactive l'interrupteur de manager, [le
manager] reçoit toujours automatiquement la réponse PDF — vérifier les interrupteurs
manager, RH et aussi employé ». — CORRECTIF DES INTERRUPTeurs DES DESTINATAIRES : la
voie e-mail automatique (traiterMessageRecu → envoyerEmailDecisionConge) construisait
ses copies (Cc) SANS lire le panneau Réponse PDF : ccDecision ajoutait TOUJOURS la boîte
du service RH ET la boîte du manager (destinataire de la demande — congé / autorisation).
Désormais, la configuration ReponsePdfConfig (id « reponse-pdf ») est lue avant chaque
réponse de décision : « Auto-RH » désactivé → boîte RH plus en Cc ; « Manager / N+1 »
désactivé → boîte du manager plus en Cc ; « Employé (destinataire) » désactivé → premier
Cc activé promu « À » (sémantique du module document-acceptation.js) ; AUCUN destinataire
activé → AUCUN envoi (journal code AUCUN_DESTINATAIRE) ; config absente → tous activés
(historique v0.2.168 conservé) ; JAMAIS bloquant. Preuve : 41 contrôles dédiés +
non-régression 278 contrôles (v0.2.184 à v0.2.189) — 319 contrôles, 0 échec.

Demande utilisateur (v0.2.189) : « Supprimer du PDF de réponse automatique les
éléments suivants : Dans la section « Informations de la demande » : supprimer
la mention « Décision rendue par ». Dans la section « Validations » : supprimer
toute cette section. Dans la section « manager / responsable » : supprimer
toute cette section. Conserve ceci « Demande créée le date et heure — Décision
finale : Acceptée — date et heure » et masque les autres informations. Ces
modifications doivent être appliquées à tous les PDF de réponse automatique,
quel que soit le type de demande concerné, tout en conservant les autres
informations et la mise en page du document. » — SIMPLIFICATION DU DOCUMENT
de réponse automatique (document-acceptation.js ET document-refus.js — tous
les PDF de réponse automatique) :
  • section « Informations de la demande » : la ligne « Décision rendue par »
    est SUPPRIMÉE (l'auteur de la décision n'est plus montré) ;
  • section « Manager / responsable » : SUPPRIMÉE ENTIÈREMENT (nom et e-mail
    du manager ne sont plus montrés — ils restent disponibles pour les
    e-mails et la traçabilité) ;
  • section « Validations » : SUPPRIMÉE ENTIÈREMENT (validation du manager,
    note du manager, validation du service RH, validation finale « par … ») ;
  • CONSERVÉS, sous le détail, les DEUX lignes d'historique « Demande créée
    le … » et « Décision finale : Acceptée — … » (SANS l'acteur — le
    « (par …) » et les étapes intermédiaires manager/RH sont masqués) ;
  • mise en page inchangée : en-tête, bandeau statut, titres de sections,
    tableaux, bloc signature/tampon réservé, une seule page ;
  • documents de REFUS : même simplification (« Décision rendue par »
    supprimée, « Manager / responsable » supprimée, « Date de la demande »
    conservée) — la règle couvre TOUS les PDF de réponse automatique,
    quel que soit le type de demande concerné.
Vérification par GÉNÉRATION RÉELLE : le PDF d'acceptation est produit avec un
contexte réaliste, son texte extrait (pypdf) confirme la présence des
sections conservées et des 2 lignes d'historique, et l'ABSENCE totale des
elements supprimés (aucune fuite du manager ni du décideur de test).
Preuve v0.2.189 : 39 contrôles dédiés (sources) + 28 contrôles de contenu
extrait du PDF réellement généré + non-régression 486 contrôles (v0.2.180 à
v0.2.188) — 553 contrôles, 0 échec ; node --check OK.

Demande utilisateur (v0.2.188) : « Pour les demandes de congé et d'autorisation,
lorsque le manager et/ou le service RH refuse la demande, ne pas générer ni
envoyer automatiquement de PDF de réponse de refus. À la place, le système doit
uniquement transmettre à l'employé, par e-mail de notification, les pièces
jointes ajoutées par le manager et/ou le service RH lors de leur réponse. Si les
deux intervenants ajoutent des pièces jointes, transmettre l'ensemble des
fichiers concernés à l'employé dans le mail de notification. Conserver le statut
final de la demande comme « Refusée » et les pièces jointes envoyées par le
manager et les RH dans le portail employé. Ne pas modifier le fonctionnement des
autres types de demandes. » — la génération du document signé n'est plus
déclenchée QUE pour une ACCEPTATION (congé / autorisation) : l'appel au moteur
de document de refus (traiterDocumentRefusDecision) est SUPPRIMÉ de la voie
automatique ; sur REFUS, docFinal = null → envoyerEmailDecisionConge reçoit
pieceJointe = null : l'e-mail de NOTIFICATION de refus part SANS PDF, avec
TOUTES les pièces jointes fournies par le manager et/ou le service RH dans
leurs réponses (mécanisme v0.2.171 conservé : réponse courante + antérieures,
cumulées et dédupliquées — si les DEUX intervenants ont joint des fichiers,
l'ENSEMBLE part à l'employé). Statut final « Refusée » conservé dans le portail
employé (v0.2.185 : seule mention « Refusée », sans acteur) et pièces jointes
restent visibles/consultables dans « Mes demandes » (v0.2.184).
L'ACCEPTATION (congé / autorisation) conserve le document signé
électroniquement (v0.2.168 inchangée) ; attestations / parrainage : v0.2.179 /
180 / 182 strictement inchangées ; parrainage : v0.2.187 conservée (aucune
notification de refus RH). Panneau d'administration (reponse-pdf-panel.tsx) :
description mise à jour (PDF sur acceptation ; refus → notification e-mail
sans PDF). Preuve v0.2.188 : 49 contrôles dédiés (condition de génération,
simulations exécutées, notification sans PDF, journal, panneau) + non-régression
437 contrôles (v0.2.180 à v0.2.187) — 486 contrôles, 0 échec ; node --check OK.

Demande utilisateur (v0.2.187) : « Dans la demande de parrainage, après le refus
du responsable, aucun e-mail de notification de refus ne doit être envoyé au
service RH. » — la condition d'envoi de envoyerEmailRefusManagerRh (point
d'appel UNIQUE dans traiterMessageRecu) exclut désormais
demande.type === "PARRAINAGE" : après le refus du RESPONSABLE (boîte dédiée
du parrainage, décision unique en une seule étape — v0.2.178), AUCUN e-mail
de notification de refus ne part vers le service RH. Le refus reste
intégralement enregistré (statut « Refusée », refuseePar = « PARRAINAGE »,
traçage, commentaire) et l'employé continue d'être notifié comme avant
(documents du responsable transmis le cas échéant — v0.2.180/182 ; aucune
réponse automatique PDF — v0.2.179). Congé / autorisation de sortie :
notification du refus du manager CONSERVÉE (Task 181). Preuve v0.2.187 :
30 contrôles dédiés + non-régression 430 contrôles (v0.2.179 à v0.2.186).

Demande utilisateur (v0.2.186) : « Dans le rôle RH, masquer juste la partie «
Signature électronique — certificat dédié » dans la section « Réponse
automatique PDF par e-mail (congé / autorisation) » — MASQUAGE D'INTERFACE
dans l'ADMINISTRATION (onglet Demandes) : la prop masquerCertificat (passée
par DemandesTab quand role === "RH") retire du rendu le BLOC « Signature
électronique — certificat dédié à cette section » (import .p12/.pfx, mot de
passe, interrupteur de signature, boutons Vérifier/Retirer, nom et fonction
du signataire) ; le SUPERADMINISTRATEUR conserve la partie ENTIÈRE ; la
configuration enregistrée (interrupteur signer, certificat importé) continue
de s'appliquer aux réponses générées quelle que soit la personne qui consulte
la section (un enregistrement fait depuis la vue RH réécrit les valeurs du
certificat TELLES QUE CHARGÉES du serveur — aucun écrasement) ;
l'avertissement du cachet « Signature électronique » (certificat absent)
renvoie le RH vers le superadministrateur au lieu de proposer l'import.
AUCUN changement de configuration ni d'API. Preuve v0.2.186 : 60 contrôles
dédiés + non-régression 58 (v0.2.185) + build de production 0 erreur.

Demande utilisateur (v0.2.185) : « dans portail employe, pour toutes les demandes
de congé, d'attestation de salaire, d'attestation de travail, de parrainage et
d'autorisation, lorsque le statut d'une demande est refusé, afficher uniquement
la mention « Refusée » dans la zone de statut, sans afficher par quel
départements ou managers ». — RÈGLE D'AFFICHAGE DU REFUS dans le portail
employé (API /api/mes-demandes, toutes les demandes) : dès que le statut est
REFUSEE l'employé ne voit QUE la mention « Refusée » — le badge n'affiche plus
« Refusée par le Manager » ni « Refusée par les RH », l'acteur de traitement
(traitePar) et le commentaire de refus (qui nomment le département ou le
manager) sont MASQUÉS, la date de traitement reste visible. E-mails de décision
(libellé raffiné conservé) et portail d'administration INCHANGÉS ; règle
v0.2.177 (décision masquée tant que la matrice deux étapes est incomplète) et
v0.2.184 (pièces jointes visibles à toutes les étapes) strictement conservées.
Preuve v0.2.185 : 58 contrôles dédiés + non-régression 133+23+21+144+61+63 —
503 contrôles, 0 échec.
Rappel v0.2.184 : « Lorsque le manager et/ou les RH répond à une
demande d'autorisation ou de congé avec des pièces jointes, toutes les pièces
jointes existantes doivent être visibles et consultables. Après l'envoi de la
réponse, l'employé reçoit automatiquement les pièces jointes avec la réponse
automatique. » — DEUX évolutions du congé / de l'autorisation de sortie :
  1) PORTAIL EMPLOYÉ : les pièces jointes ne sont PLUS masquées pendant la
     validation à deux étapes (le bloc decisionMasquee ne vide plus
     documentsVu) — TOUTES les pièces jointes existantes (pièce d'origine +
     celles reçues avec les réponses du manager ET/OU des RH) restent
     VISIBLES et CONSULTABLES (Visualiser / Télécharger) À CHAQUE étape ;
     la règle v0.2.177 reste appliquée à la DÉCISION seule (statut final,
     décisions par acteur, commentaire, date/acteur de traitement) ;
  2) ÉTAPE INTERMÉDIAIRE : dès qu'un décideur répond avec des pièces jointes
     (matrice non achevée — statut EN_ATTENTE), l'employé reçoit
     AUTOMATIQUEMENT un e-mail « Document disponible » avec les documents
     EN PIÈCES JOINTES — formulation NEUTRE (ni l'acteur ni la décision
     intermédiaire ne sont révélés), trace notificationEtapeIntermediaire.
À la décision FINALE, le chemin v0.2.171 est INCHANGÉ : TOUTES les pièces
jointes existantes (courante + antérieures, dédoublonnées) partent avec la
réponse automatique et le PDF signé. Attestations + parrainage : inchangés
(v0.2.179/180/182). Preuve v0.2.184 : 61 contrôles dédiés + non-régression
133+23+21+144+63 — 445 contrôles, 0 échec.
Rappels : v0.2.183 — Tableau 2.1 des expressions de décision ; v0.2.182 —
documents du responsable avec la décision de parrainage ; v0.2.181 —
expressions reconnues pour attestations + parrainage ; v0.2.180 — documents
joints par le RH à sa décision transmis à l'employé ; v0.2.179 — AUCUNE
réponse automatique ni PDF signé pour les attestations et le parrainage ;
congé / autorisation : matrice à deux étapes avec PDF signé. Cette édition :
  • CONSERVE la réduction à l'essentiel et la DURÉE DU PROJET (section 1.2) ;
  • CONSERVE la puce v0.2.184 « Pièces jointes du manager et des RH à toutes
    les étapes » et AJOUTE la puce « PDF de réponse automatique simplifié
    (v0.2.189) » (annexe, portail employé) ;
  • COMPLÈTE l'historique récent (Tableau 5.1) avec la version 189 ;
  • DOCUMENTE toujours le parrainage par e-mail (v0.2.178), la désactivation
    v0.2.179, la transmission des pièces jointes v0.2.180, la règle v0.2.177
    « confidentialité de la décision » et les correctifs E2E découverts en
    campagne réelle (routage parrainage chiffré, Garde 2 des e-mails système).

Sorties (même contenu pour les deux noms, compatibilité des références) :
  download/servicerh-readme-technique-v0.2.189.pdf  (+ copie générique)
  download/servicerh-readme-technique-reduit-v0.2.189.pdf (+ copie générique)
  racine : servicerh-readme-technique.pdf / servicerh-readme-technique-reduit.pdf
"""
import os
import shutil
import hashlib

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether,
    HRFlowable,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

RACINE = "/home/z/my-project"
EDITION = "v0.2.195"

# ---- Polices (mêmes familles que la série des README officiels) ------------
pdfmetrics.registerFont(TTFont("Serif", "/usr/share/fonts/truetype/freefont/FreeSerif.ttf"))
pdfmetrics.registerFont(TTFont("Serif-B", "/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf"))
pdfmetrics.registerFont(TTFont("Serif-I", "/usr/share/fonts/truetype/freefont/FreeSerifItalic.ttf"))
pdfmetrics.registerFont(TTFont("Mono", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"))

LARG, HAUT = A4
MARGE_G, MARGE_D, MARGE_H, MARGE_B = 2.0 * cm, 2.0 * cm, 1.9 * cm, 1.8 * cm
LARGE_UTILE = LARG - MARGE_G - MARGE_D

# ---- Palette (identité établie de la série AutoRH) ----------------------
ENCRE = colors.HexColor("#1a1a1a")
GRIS = colors.HexColor("#555555")
ACCENT = colors.HexColor("#0f4c46")
ACCENT_CLAIR = colors.HexColor("#eef4f3")
LIGNE = colors.HexColor("#c9d4d2")
FOND_ENTETE = colors.HexColor("#0f4c46")
FOND_CODE = colors.HexColor("#f4f6f5")
VERT_OUI = colors.HexColor("#1c6b40")
ROUGE_NON = colors.HexColor("#9c2f2f")

# ---- Styles ----------------------------------------------------------------
S = {}
S["bande"] = ParagraphStyle("bande", fontName="Serif-B", fontSize=9.5, leading=13,
                            textColor=ACCENT, alignment=TA_CENTER, spaceAfter=10)
S["titre"] = ParagraphStyle("titre", fontName="Serif-B", fontSize=30, leading=34,
                            textColor=ENCRE, spaceAfter=2)
S["sous-titre"] = ParagraphStyle("sous-titre", fontName="Serif", fontSize=14.5, leading=19,
                                 textColor=GRIS, spaceAfter=12)
S["intro"] = ParagraphStyle("intro", fontName="Serif", fontSize=10.2, leading=15.2,
                            textColor=ENCRE, spaceAfter=10)
S["badges"] = ParagraphStyle("badges", fontName="Serif-B", fontSize=9.6, leading=14,
                             textColor=ACCENT, alignment=TA_CENTER, spaceBefore=4, spaceAfter=12)
S["h1"] = ParagraphStyle("h1", fontName="Serif-B", fontSize=17.5, leading=21.5,
                         textColor=ACCENT, spaceBefore=16, spaceAfter=7)
S["h2"] = ParagraphStyle("h2", fontName="Serif-B", fontSize=12.6, leading=16,
                         textColor=ENCRE, spaceBefore=11, spaceAfter=5)
S["corps"] = ParagraphStyle("corps", fontName="Serif", fontSize=9.8, leading=14.3,
                            textColor=ENCRE, spaceAfter=5)
S["bul"] = ParagraphStyle("bul", fontName="Serif", fontSize=9.8, leading=14.2,
                          textColor=ENCRE, leftIndent=14, bulletIndent=3, spaceAfter=4.5)
S["code"] = ParagraphStyle("code", fontName="Mono", fontSize=8.6, leading=12.6,
                           textColor=ENCRE, leftIndent=10, spaceAfter=2)
S["bloc-code"] = ParagraphStyle("bloc-code", fontName="Mono", fontSize=8.8, leading=13.2,
                                textColor=ENCRE, backColor=FOND_CODE,
                                borderPadding=6, leftIndent=8, spaceBefore=3, spaceAfter=8)
S["legende"] = ParagraphStyle("legende", fontName="Serif-I", fontSize=8.6, leading=12,
                              textColor=GRIS, spaceBefore=2.5, spaceAfter=9)
S["cell"] = ParagraphStyle("cell", fontName="Serif", fontSize=9.0, leading=12.6, textColor=ENCRE)
S["cell-c"] = ParagraphStyle("cell-c", fontName="Serif-B", fontSize=9.0, leading=12.6,
                             textColor=ENCRE, alignment=TA_CENTER)
S["cell-tete"] = ParagraphStyle("cell-tete", fontName="Serif-B", fontSize=9.0, leading=12.4,
                                textColor=colors.white)
S["cell-tete-c"] = ParagraphStyle("cell-tete-c", fontName="Serif-B", fontSize=9.0, leading=12.4,
                                  textColor=colors.white, alignment=TA_CENTER)
S["pivot"] = ParagraphStyle("pivot", fontName="Serif-B", fontSize=9.2, leading=12.8,
                            textColor=ACCENT)


def h1(txt):
    return Paragraph(txt, S["h1"])


def h2(txt):
    return Paragraph(txt, S["h2"])


def p(txt, style="corps"):
    return Paragraph(txt, S[style])


def bul(txt):
    return Paragraph(txt, S["bul"], bulletText="•")


def code(txt):
    return Paragraph(txt, S["bloc-code"])


def legende(txt):
    return Paragraph(txt, S["legende"])


def pivot(txt):
    return Paragraph(txt, S["pivot"])


def tableau(entetes, lignes, largeurs, centre=None):
    """Tableau sobre : entête vert foncé, lignes alternées, cellules Paragraph."""
    centre = centre or []
    data = [[Paragraph(e, S["cell-tete-c"] if i in centre else S["cell-tete"])
             for i, e in enumerate(entetes)]]
    for lg in lignes:
        data.append([Paragraph(c, S["cell-c"] if i in centre else S["cell"])
                     for i, c in enumerate(lg)])
    total = sum(largeurs)
    if total > LARGE_UTILE:
        largeurs = [w * LARGE_UTILE / total for w in largeurs]
    t = Table(data, colWidths=largeurs, repeatRows=1, hAlign="LEFT")
    cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), FOND_ENTETE),
        ("GRID", (0, 0), (-1, -1), 0.5, LIGNE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
    ]
    for i in range(1, len(data)):
        cmds.append(("BACKGROUND", (0, i), (-1, i),
                     colors.white if i % 2 == 1 else ACCENT_CLAIR))
    t.setStyle(TableStyle(cmds))
    return t


def matrice_tableau(lignes):
    """Tableau matrice : Fonctionnalité | SuperAdmin | RH | IT, Oui vert / Non rouge."""
    entete = ["Fonctionnalité", "SuperAdmin", "RH", "IT"]
    col_f = LARGE_UTILE * 0.52
    col_v = (LARGE_UTILE - col_f) / 3.0
    data = [[Paragraph(e, S["cell-tete-c"] if i else S["cell-tete"]) for i, e in enumerate(entete)]]
    cmds_style = []
    for ri, (texte, v1, v2, v3) in enumerate(lignes, start=1):
        data.append([Paragraph(texte, S["cell"]),
                     Paragraph(v1, S["cell-c"]),
                     Paragraph(v2, S["cell-c"]),
                     Paragraph(v3, S["cell-c"])])
        for ci, v in enumerate((v1, v2, v3), start=1):
            if v == "Oui":
                cmds_style.append(("TEXTCOLOR", (ci, ri), (ci, ri), VERT_OUI))
            elif v == "Non":
                cmds_style.append(("TEXTCOLOR", (ci, ri), (ci, ri), ROUGE_NON))
    t = Table(data, colWidths=[col_f, col_v, col_v, col_v], repeatRows=1, hAlign="LEFT")
    cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), FOND_ENTETE),
        ("GRID", (0, 0), (-1, -1), 0.5, LIGNE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
    ]
    for i in range(1, len(data)):
        cmds.append(("BACKGROUND", (0, i), (-1, i),
                     colors.white if i % 2 == 1 else ACCENT_CLAIR))
    cmds.extend(cmds_style)
    t.setStyle(TableStyle(cmds))
    return t


def filet():
    return HRFlowable(width="100%", thickness=0.7, color=LIGNE, spaceBefore=2, spaceAfter=8)


def espacer(txt):
    return " ".join(list(txt.replace("·", "·")))


# === CONTENU ================================================================
STORY = []


def page_couverture():
    STORY.append(Paragraph(espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.195"), S["bande"]))
    STORY.append(p("AutoRH", "titre"))
    STORY.append(p("Fiches de paie, demandes administratives et documents RH", "sous-titre"))
    STORY.append(p(
        "Édition ESSENTIELLE : les informations inutiles à l'exploitation ont été retirées, la "
        "documentation tient en une dizaine de pages. AutoRH couvre les fiches de paie ET les "
        "demandes administratives : le service RH importe en masse les bulletins produits par Sage "
        "(PDF, images, ZIP, Excel, Word) ; l'application détecte automatiquement CIN, nom, période, "
        "net à payer et matricule, puis indexe chaque fiche (SQLite). Chaque employé consulte SES "
        "fiches — signées électroniquement — et suit ses demandes via un portail sécurisé par CIN, "
        "mot de passe et code OTP. Les demandes de congé et d'autorisation partent automatiquement "
        "au manager responsable, avec copie au service RH et confirmation à l'employé. Depuis la "
        "v0.2.168, elles suivent une <b>VALIDATION À DEUX ÉTAPES</b> : acceptation du manager ET du "
        "service RH requise, refus immédiat de l'un des deux, et TOUTES les pièces jointes des "
        "décideurs sont transmises à l'employé avec le PDF signé (v0.2.168 → v0.2.172). Depuis la "
        "v0.2.188, en cas de REFUS (congé / autorisation), AUCUN PDF de refus n'est généré ni "
        "envoyé : l'employé reçoit un e-mail de NOTIFICATION de refus SANS PDF, transportant "
        "TOUTES les pièces jointes fournies par le manager et/ou le service RH — le statut final "
        "« Refusée » et les pièces jointes restent visibles dans « Mes demandes ». Depuis la "
        "v0.2.189, le PDF de réponse automatique est SIMPLIFIÉ : la mention « Décision rendue "
        "par » et les sections « Validations » et « Manager / responsable » sont supprimées — "
        "seules restent les lignes « Demande créée le … » et « Décision finale : Acceptée — … », "
        "sans aucun acteur ; les autres informations et la mise en page du document sont "
        "conservées. Depuis la v0.2.190, les interrupteurs « Employé (destinataire) », "
        "« Auto-RH » et « Manager / N+1 de la demande » du panneau Réponse PDF FILTRENT "
        "la réponse automatique e-mail : destinataire désactivé = exclu de l'envoi — le "
        "manager désactivé ne reçoit plus la décision ni le PDF. Depuis la v0.2.191, ces "
        "interrupteurs sont respectés DANS LES DEUX SENS et sur TOUTES les voies (portail "
        "ET administration) — y compris l'interrupteur maître « Envoi automatique de "
        "l'e-mail ». Depuis la v0.2.192, les boutons de gestion des comptes restent "
        "TOUJOURS accessibles : la colonne Actions est COLLANTE à droite du tableau, "
        "sans aucun défilement de colonnes. Depuis la v0.2.193, les e-mails de "
        "notification d'acceptation et de refus sont TOUJOURS envoyés à l'employé, au "
        "service RH et au manager — les interrupteurs « Réponse PDF » ne gouvernent plus "
        "que la pièce jointe PDF. Depuis la v0.2.194, le bloc d'import du fichier de "
        "certificat est masqué pour le rôle RH dans les sections « Importer » et "
        "« Demandes » — le matériel cryptographique reste géré par le "
        "superadministrateur. Depuis la v0.2.195, la carte « Décision Manager » du "
        "détail des demandes de congé et d'autorisation de sortie est masquée pour "
        "le rôle RH : le manager décide par e-mail et le repli manuel est réservé "
        "au superadministrateur."))
    STORY.append(p("Administration 4000  ·  Portail 4001  ·  Pont d'aperçu 3000  ·  CIN 8 chiffres  ·  "
                   "AES-256-GCM  ·  Durée du projet : 30 jours calendaires (90-130 jours-homme équivalents)",
                   "badges"))
    STORY.append(filet())
    STORY.append(p("<b>Sommaire</b>", "corps"))
    sommaire = [
        "1. Présentation express et durée du projet — services et ports, sécurité en bref, temps de développement et de test",
        "2. Fonctionnalités essentielles — import, portail, comptes et managers, demandes à deux étapes, signature",
        "3. Installation et démarrage — prérequis, lanceurs, secrets .env, liste de contrôle",
        "4. Exploitation et dépannage — commandes, routine, remèdes vérifiés",
        "5. Historique récent des versions",
        "Annexe — Matrice des droits des rôles (SuperAdmin, RH, IT ; portail employé)",
    ]
    for s_ in sommaire:
        STORY.append(p(s_, "bul"))
    STORY.append(Spacer(1, 6))
    STORY.append(filet())
    blocs = [
        ("D U R É E   D U   P R O J E T",
         "Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 195 versions "
         "numérotées, plusieurs livraisons par jour. Effort équivalent estimé : <b>90 à 130 "
         "jours-homme</b> (4 à 6 mois-homme), dont 25 à 40 jours-homme de tests — détail en "
         "section 1.2."),
        ("D I F F U S I O N",
         "Les quatre livrables sont téléchargeables sans connexion depuis l'administration : "
         "/api/download-readme (présent README), /api/download-scripts (archive du code), "
         "/api/download-matrice (matrice des rôles Excel), /api/download-routage (map de routage "
         "des e-mails). Fichier : download/servicerh-readme-technique-v0.2.195.pdf."),
        ("S O U R C E S",
         "Code source livré v0.2.195 (DÉCISION MANAGER : CARTE MASQUÉE POUR LE RH — la carte "
         "« Décision Manager » du détail des demandes de congé / d'autorisation de "
         "sortie (badge + boutons « Enregistrer la décision du manager : Acceptée / "
         "Refusée ») est cachée pour le rôle RH, note informative à la place ; l'état "
         "de la décision reste visible dans la section « Décision RH » et dans la "
         "liste · repli manuel réservé au SUPERADMIN · CERTIFICAT : IMPORT MASQUÉ "
         "POUR LE RH — bloc « Fichier "
         "de certificat de CETTE section » + clé privée + avertissements d'import "
         "cachés dans les sections « Importer » et « Demandes », note « réservé au "
         "superadministrateur » à la place ; interrupteur et positionnement conservés · "
         "NOTIFICATIONS TOUJOURS ENVOYÉES — les e-mails de "
         "décision partent à TOUS les destinataires historiques, quel que soit l'état des "
         "interrupteurs ; le PDF signé et tamponné n'est joint qu'aux destinataires "
         "activés, les autres reçoivent la même notification SANS le PDF ; maître OFF = "
         "plus AUCUNE suppression d'envoi (ENVOI_DESACTIVE retiré) · BOUTONS DE GESTION "
         "TOUJOURS ACCESSIBLES — colonne "
         "Actions du tableau « Comptes utilisateurs » COLLANTE à droite : Désactiver / "
         "Manager / Mot de passe / Rôle / Supprimer visibles et cliquables SANS défilement "
         "horizontal ; Manager masquée < XL, Créé le < LG ; e-mail tronqué avec infobulle · "
         "INTERRUPTHEURS E-MAIL — SÉMANTIQUE v0.2.193 : notification TOUJOURS "
         "envoyée, PDF seul gouverné (historique v0.2.190/191 : les interrupteurs "
         "« Employé (destinataire) », « Auto-RH » et « Manager / N+1 » filtraient les "
         "destinataires de la réponse automatique — REMPLACÉ par la répartition "
         "avec/sans PDF) · PDF de réponse "
         "automatique SIMPLIFIÉ — « Décision rendue "
         "par », « Validations » et « Manager / responsable » supprimés ; seules restent « Demande "
         "créée le … » et « Décision finale : Acceptée — … » sans acteur · refus congé / "
         "autorisation : AUCUN PDF de refus généré ni envoyé — l'employé reçoit un e-mail de "
         "notification SANS PDF avec l'ensemble des pièces jointes du manager et/ou des RH · "
         "parrainage : après le refus du responsable, AUCUNE notification de refus au service RH · "
         "administration : la partie « Signature électronique — certificat dédié » reste masquée "
         "pour le rôle RH — le SuperAdmin la conserve) · "
         "README-DEPLOIEMENT-LOCAL.md (guide d'installation illustré) · "
         "notes LIRE-MOI-CORRECTIF-*.txt (détail de chaque livraison)."),
        ("D A T E   D ' É D I T I O N",
         "12 octobre 2026 — fondée sur le code v0.2.191 ; maintenue à jour au fil des livraisons."),
    ]
    for titre, corps in blocs:
        STORY.append(p(titre, "pivot"))
        STORY.append(p(corps))
    STORY.append(Spacer(1, 8))
    STORY.append(p("F I C H E S   D E   P A I E   E T   D E M A N D E S   A D M I N I S T R A T I V E S   ·   F R",
                   "badges"))


def section_1():
    STORY.append(h1("1. Présentation express et durée du projet"))
    STORY.append(p(
        "AutoRH est une application web de gestion des services RH, installable sur un poste du "
        "réseau interne (Windows, Linux ou macOS) sans aucune base de données externe. Deux services "
        "cohabitent sur la même machine et partagent la base et le stockage chiffré :"))
    STORY.append(tableau(
        ["Service", "Port et surcharge", "Rôle"],
        [["Administration (RH, IT, SuperAdmin)",
          "4000 — PORT ou AUTO_RH_PORT_ADMIN",
          "Serveur Next.js standalone : import, recherche paginée, gestion des fiches, comptes et "
          "managers, configuration SMTP et du module de signature (scripts/start-prod.js)."],
         ["Portail employés",
          "4001 — PORTAL_PORT ou AUTO_RH_PORT_PORTAIL",
          "Serveur Node HTTP natif (scripts/portail-server.js) : consultation après CIN + mot de passe + "
          "code OTP, fiches du CIN de session uniquement, demandes administratives."],
         ["Pont d'aperçu",
          "3000 — AUTO_RH_PORT_PONT (désactivable)",
          "Pont 3000 → administration 4000 pour l'entrée Caddy 81 : aperçu et téléchargements publics "
          "(/api/download-*) sans connexion."]],
        [3.1 * cm, 4.4 * cm, LARGE_UTILE - 7.5 * cm]))
    STORY.append(legende(
        "Tableau 1.1 — Les services livrés. Écoute 0.0.0.0 : ouvrir 4000 et 4001 en TCP dans le pare-feu ; "
        "les services partagent db/custom.db et storage/."))
    STORY.append(h2("Sécurité en bref"))
    STORY.append(bul(
        "<b>Comptes et sessions</b> : mots de passe hachés scrypt (8 caractères minimum, 4 classes), "
        "expiration 15 jours avec changement forcé ; mot de passe initial des comptes RH/IT VALABLE "
        "15 MINUTES (v0.2.129) ; sessions admin par cookie httpOnly signé. Anti force-brute : 10 échecs "
        "admin par IP puis 429 ; 5 échecs portail puis verrouillage 15 minutes (423). Portail à double "
        "facteur TOTP : QR d'enrôlement affiché une seule fois, code à 6 chiffres à chaque connexion. "
        "Journal de sécurité : logs/auth-securite.log."))
    STORY.append(bul(
        "<b>Chiffrement AES-256-GCM double</b> : champs sensibles de la base (middleware Prisma) ET "
        "chaque fichier sur disque (en-tête PAIESAGE1) — fiches, tampons, certificats et documents des "
        "demandes. Tout repose sur le fichier .env (AUTH_SECRET, AUTO_RH_STORAGE_KEY) : sa perte rend "
        "les fiches mathématiquement irrécupérables — le sauvegarder AVEC les données et ne JAMAIS "
        "régénérer les clés sur une installation existante."))
    STORY.append(bul(
        "<b>Autorisations</b> : session requise sur toutes les API ; rôles appliqués côté serveur ET "
        "éléments masqués dans l'interface (double restriction — matrice en annexe) ; en-têtes HTTP "
        "anti-clickjacking, nosniff, HSTS, CSP ; droits disque restrictifs imposés au démarrage sur "
        ".env, db, storage, logs, backups (scripts/securiser-auto.js)."))
    STORY.append(h2("Durée du projet — développement et test"))
    STORY.append(p(
        "Le projet a été réalisé du <b>12 septembre au 12 octobre 2026</b>, soit <b>31 jours "
        "calendaires</b>, en cycles courts : <b>191 versions numérotées</b> (v0.2.1 à v0.2.191), "
        "plusieurs livraisons par jour, 755 scripts livrés dont plus de 330 dédiés aux tests et "
        "vérifications, environ 70 000 lignes de code applicatif, 34 points d'entrée API, 65 "
        "composants d'interface et 14 modèles de données. Chaque version passait par un build de "
        "production, des tests de fumée sur les trois services, des scénarios d'API et des parcours "
        "E2E automatisés ; les fonctionnalités sensibles ont été certifiées en conditions réelles "
        "(Gmail/Zoho) : transfert des pièces jointes 42/42 (v0.2.172), validation à deux étapes 36 "
        "vérifications (v0.2.173), correctif de l'erreur 405 à l'import 17/17 (v0.2.175). L'effort "
        "équivalent estimé par analogie — ordres de grandeur destinés à dimensionner une reprise ou "
        "une extension du projet :"))
    STORY.append(tableau(
        ["Poste", "Estimation"],
        [["Développement — conception, code, corrections, documentation",
          "Environ 65 à 90 jours-homme"],
         ["Tests et validation — automatisation, E2E, recette, QA",
          "Environ 25 à 40 jours-homme (près de 30 % du total)"],
         ["Effort total équivalent",
          "Environ 90 à 130 jours-homme — de l'ordre de 4 à 6 mois-homme"]],
        [10.2 * cm, LARGE_UTILE - 10.2 * cm]))
    STORY.append(legende(
        "Tableau 1.2 — Temps de développement et de test. Calendrier réel : 30 jours calendaires "
        "(12 septembre → 11 octobre 2026), plusieurs livraisons par jour ; les estimations d'effort "
        "restent indicatives."))
    STORY.append(h2("Routage des e-mails des demandes (résumé)"))
    STORY.append(p(
        "L'employé ne saisit AUCUN destinataire : le congé et l'autorisation de sortie partent au "
        "MANAGER RESPONSABLE affecté par le RH dans l'onglet « Accès portail » (v0.2.132), avec COPIE "
        "au service RH et CONFIRMATION à l'employé ; les attestations et le parrainage partent vers "
        "leurs adresses DÉDIÉES configurables (repli : boîte RH). Envoi en arrière-plan JAMAIS "
        "bloquant, chaque envoi journalisé (logs/journal-emails.log) ; map complète : classeur "
        "/api/download-routage."))


def section_2():
    STORY.append(h1("2. Fonctionnalités essentielles"))
    STORY.append(p(
        "Fonctionnalités vérifiables dans le code livré v0.2.191. Installation : "
        "section 3 ; exploitation quotidienne : section 4 ; droits par rôle : annexe."))
    STORY.append(h2("Import, extraction et découpage des fiches de paie"))
    STORY.append(bul(
        "<b>Import multi-formats</b> : PDF, PNG, JPG, ZIP, XLSX/XLSM/XLS, DOCX (500 Mo max par fichier, "
        "lots de 5 fichiers légers) ; CIN tunisienne à 8 chiffres isolée (biométrique 9 chiffres "
        "reconnue), nom, période (plus de 10 formats), net à payer et matricule détectés automatiquement ; "
        "OCR adaptatif hors ligne (Tesseract.js, modèle français local) si le texte extrait est trop "
        "court ; un PDF multi-bulletins, un classeur Excel ou un Word regroupant plusieurs employés est "
        "découpé en une fiche individuelle par employé. Vérification automatique des CIN après chaque "
        "import (vrai/faux/non détecté + taux de fiabilité affiché, détection d'incohérences de nom "
        "non bloquante)."))
    STORY.append(h2("Recherche et portail employés"))
    STORY.append(bul(
        "<b>Recherche</b> : liste d'administration paginée côté serveur (100 fiches/page) et recherche "
        "CIN par index SQL déterministe CHIFFRÉ — fluide à 240 000 fiches ; la recherche exige le numéro "
        "COMPLET. <b>Portail</b> : connexion CIN + mot de passe + code TOTP (QR d'enrôlement affiché une "
        "seule fois) ; liste des fiches du CIN de session, chaque fiche s'ouvre ou se télécharge avec sa "
        "COPIE SIGNÉE (PAdES), tampon appliqué à la volée, original intact ; « Mes demandes » et « Mes "
        "documents » ; aucune fiche d'un autre employé n'est accessible (contrôle côté serveur)."))
    STORY.append(h2("Comptes, managers et messagerie"))
    STORY.append(bul(
        "Quatre rôles appliqués côté serveur — SUPERADMIN, IT, RH, employé (annexe). Comptes RH/IT créés "
        "exclusivement par le superadministrateur (mot de passe initial par e-mail, VALABLE 15 MINUTES). "
        "Désignation des managers dans l'onglet « Accès portail » (case « Manager » + liste « Manager "
        "responsable ») — modification enregistrée SANS toucher au mot de passe. Panneau SMTP réservé "
        "aux rôles IT/SuperAdmin : préréglage Gmail (port 465, mot de passe d'application obligatoire) "
        "ou serveur personnalisé ; identifiants chiffrés en base, chaque envoi journalisé."))
    STORY.append(h2("Demandes administratives — validation à DEUX ÉTAPES"))
    STORY.append(bul(
        "Cinq types créés depuis le portail : attestations (un bouton), congé, autorisation de sortie, "
        "parrainage — référence DEM-AAAA-NNNNN. Pour le congé et l'autorisation, <b>l'acceptation du "
        "manager ET du service RH est requise</b> (v0.2.168) : aucun PDF signé tant que les deux n'ont "
        "pas accepté, quel que soit l'ordre des réponses (statut manager correctif inclus, v0.2.173) ; "
        "refus de l'un des deux = REFUS IMMÉDIAT sans attendre l'autre (libellés internes "
        "« Refusée par le Manager » / « Refusée par les RH » conservés pour les e-mails et "
        "l'administration ; depuis la v0.2.185, le portail employé n'affiche que « Refusée »). "
        "Les réponses se font par simple e-mail (réponses RH via Gmail, manager via "
        "sa boîte) avec pièces jointes éventuelles : <b>TOUTES les pièces jointes des décideurs "
        "sont transmises à l'employé</b>, sans aucune perte (v0.2.168 → v0.2.172, certifié "
        "campagne réelle 42/42). Depuis la <b>v0.2.188</b>, la règle est différenciée : "
        "ACCEPTATION → PDF de décision tamponné et signé, joint à la notification et visible "
        "dans « Mes documents » ; REFUS → AUCUN PDF généré ni envoyé, l'e-mail de NOTIFICATION "
        "de refus transporte l'ENSEMBLE des pièces jointes du manager et/ou des RH (si les deux "
        "intervenants en ont ajouté, tous les fichiers partent), statut « Refusée » et pièces "
        "jointes conservés dans le portail employé. Depuis la <b>v0.2.189</b>, le PDF "
        "d'acceptation est SIMPLIFIÉ : « Décision rendue par », « Validations » et « Manager / "
        "responsable » supprimés — seules restent les lignes « Demande créée le … » et "
        "« Décision finale : Acceptée — … », sans aucun acteur (mise en page inchangée). Depuis "
        "la <b>v0.2.190</b>, les interrupteurs destinataires (Employé / Auto-RH / Manager "
        "N+1 — panneau Réponse PDF) FILTRENT la réponse automatique : destinataire désactivé "
        "= exclu de l'envoi ; employé désactivé → premier Cc activé promu « À ». La v0.2.191 "
        "rend ces interrupteurs EFFECTIFS DANS LES DEUX SENS : le module de génération les "
        "respecte dès que le panneau a été utilisé (section « non engagée » comprise) et le "
        "maître OFF supprime TOUT envoi de décision."))
    STORY.append(h2("Expressions de décision reconnues par réponse e-mail"))
    STORY.append(p(
        "Toutes les décisions se rendent par simple RÉPONSE à l'e-mail de la demande : le moteur de "
        "classification (classification-reponses.js) reconnaît n'importe laquelle de ces formulations — "
        "pour le congé et l'autorisation de sortie (chaque étape : manager, puis service RH) comme pour "
        "les attestations de travail / de salaire et le parrainage (décision unique du destinataire de "
        "la boîte dédiée) :"))
    STORY.append(tableau(
        ["Décision", "Formulations reconnues — n'importe laquelle suffit"],
        [["<b>Acceptation</b>",
          "« J'accepte votre demande » · « J'accepte » · « OK » · « D'accord » · « Je valide » · "
          "« J'approuve » · « Je vous accorde »"],
         ["<b>Acceptation — mots seuls</b>",
          "« Acceptée » · « Validée » · « Approuvée » · « Accordée » · « Délivrée »"],
         ["<b>Refus</b>",
          "« Je refuse » · « Refus » · « Non » · « Désaccord » · « Pas d'accord » · « Hors de question »"],
         ["<b>Refus — mot seul</b>", "« Refusée »"],
         ["<b>Négations naturelles — comptent comme REFUS</b>",
          "« Je ne valide pas » · « Je n'accepte pas » · « Je ne peux pas accepter »"]],
        [5.2 * cm, LARGE_UTILE - 5.2 * cm]))
    STORY.append(legende(
        "Tableau 2.1 — Expressions de décision reconnues par réponse e-mail. Casse, accents, "
        "apostrophes (droites et courbes), ponctuation et texte autour tolérés ; la réponse dans "
        "l'OBJET seul est reconnue (« Re: … — Acceptée », « Refusée », « OK ») ; la citation du message "
        "d'origine est écartée (seuls les mots du décideur sont classés) ; PRIORITÉ au refus — une "
        "négation ne devient JAMAIS une validation ; réponse ambiguë ou non reconnue sans effet "
        "(demande « En attente »)."))
    STORY.append(h2("Signature électronique, tampon et QR"))
    STORY.append(bul(
        "Module « API de certification &amp; signature » configuré par le SUPERADMINISTRATEUR seul "
        "(mode LOCALE 100 % node : node:crypto + node-forge, ou API_EXTERNE) ; fiches signées "
        "AUTOMATIQUEMENT à l'import, réponses signées AVANT envoi, copies signées téléchargeables par "
        "l'employé. Cachet « SIGNATURE ÉLECTRONIQUE » (rectangle ou rond), image de cachet importée, "
        "QR à quatre modes de contenu, positionnement libre sur toute la feuille (aperçu A4 "
        "glisser-déposer) ; configurations PROPRES pour l'Import et les Réponses, chacune avec SON "
        "certificat DÉDIÉ — le cachet n'est JAMAIS apposé si la signature PAdES échoue."))
    STORY.append(h2("Chiffrement et outils d'exploitation"))
    STORY.append(bul(
        "Chiffrement outillé (chiffrer-base.js idempotent ; chiffrer-storage.js --verifier | --chiffrer | "
        "--dechiffrer) ; sauvegarde de base chiffrée .pgb (AES-256-GCM, rotation de 10, --liste / "
        "--restaurer) ; mode silencieux Windows (démarrage/arrêt/état sans fenêtre) ; sécurisation "
        "disque automatique à chaque démarrage ; lanceurs reconstruisant le build si le marqueur de "
        "version change (correctif de l'erreur 405, v0.2.175)."))


def section_3():
    STORY.append(h1("3. Installation et démarrage"))
    STORY.append(h2("Prérequis et commandes de base"))
    STORY.append(bul(
        "Node.js 22 LTS recommandé ; npm inclus ; aucune autre base à installer (SQLite embarqué via "
        "Prisma). Internet nécessaire uniquement à la première installation ; l'application fonctionne "
        "ensuite entièrement hors ligne. Extraire l'archive servicerh-scripts-site-web.zip dans un "
        "dossier sans accents ni espaces (par exemple C:\\AutoRH). En cas d'erreur ERESOLVE au "
        "npm install : utiliser package.json et package-lock.json livrés, supprimer node_modules et "
        "package-lock.json puis relancer (LIRE-MOI-FIX-INSTALL.txt)."))
    STORY.append(code(
        "npm install<br/>"
        "npx prisma generate &amp;&amp; npx prisma db push<br/>"
        "npm run build<br/>"
        "npm run start&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;# administration — port 4000<br/>"
        "node scripts/portail-server.js&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;# portail employés — port 4001"))
    STORY.append(h2("Lanceurs et accès réseau"))
    STORY.append(bul(
        "<b>Windows (recommandé)</b> : double-clic sur DEMARRER-SILENCIEUX-WINDOWS.vbs — préparation, "
        "raccourci de démarrage automatique, attente de l'état écrit dans logs/demarrage-etat.txt (jusqu'à "
        "20 minutes au premier lancement, temps du build) puis ouverture de http://localhost:4000 ; arrêt "
        "par ARRETER-SILENCIEUX-WINDOWS.vbs. Linux/macOS : DEMARRER-LINUX-MAC.sh (administration), "
        "DEMARRER-PORTAIL-LINUX-MAC.sh (portail) ou DEMARRER-TOUT-LINUX-MAC.sh (les deux)."))
    STORY.append(bul(
        "<b>Docker (optionnel)</b> : docker compose up --build démarre les deux services ; définir "
        "AUTH_SECRET et AUTO_RH_STORAGE_KEY dans le compose ou monter un .env restreint. "
        "<b>Réseau local</b> : les deux serveurs écoutent sur 0.0.0.0 — http://192.168.x.x:4000 et :4001 ; "
        "si la page ne s'affiche pas depuis un autre poste : autoriser le trafic entrant TCP 4000 ET 4001 "
        "dans le pare-feu ; demander un bail DHCP fixe pour l'hébergeur."))
    STORY.append(h2("Secrets : fichier .env"))
    STORY.append(bul(
        "Trois valeurs clés : DATABASE_URL (chemin ABSOLU vers db/custom.db), AUTH_SECRET (généré "
        "automatiquement au premier démarrage) et AUTO_RH_STORAGE_KEY (clé de chiffrement du "
        "stockage). La perte de ces clés rend les fiches irrécupérables : sauvegarder .env avec les "
        "données, dans un coffre-fort de secrets ; ne jamais le partager ni régénérer les clés sur une "
        "installation existante. Ports surchargeables : AUTO_RH_PORT_ADMIN et AUTO_RH_PORT_PORTAIL."))
    STORY.append(h2("Mise en service rapide — liste de contrôle"))
    for etape in [
        "<b>1.</b> Extraire l'archive servicerh-scripts-site-web.zip dans un dossier sans accents ni "
        "espaces (ex. C:\\AutoRH) et installer Node.js 22 LTS.",
        "<b>2.</b> npm install · npx prisma generate · npx prisma db push · npm run build.",
        "<b>3.</b> Démarrer (DEMARRER-SILENCIEUX-WINDOWS.vbs ou DEMARRER-TOUT-LINUX-MAC.sh) et vérifier "
        "http://localhost:4000 — état détaillé dans logs/demarrage-etat.txt.",
        "<b>4.</b> Créer le SuperAdmin (CREER-SUPERADMIN-WINDOWS.bat), puis le premier compte RH/IT "
        "(onglet Utilisateurs) — mot de passe initial reçu par e-mail, valable 15 minutes.",
        "<b>5.</b> Configurer le SMTP (onglet Paramètres — rôles IT/SuperAdmin) et tester l'envoi.",
        "<b>6.</b> Import d'essai (dossier test-data, 20 fiches) puis recherche d'un CIN complet — une "
        "recherche partielle doit donner 0 résultat.",
        "<b>7.</b> Créer un accès portail (onglet Accès portail) et vérifier la connexion employé sur le "
        "port 4001 (CIN + mot de passe + code OTP).",
        "<b>8.</b> Sauvegarde de contrôle (SAUVEGARDER-BD-WINDOWS.bat) et copie de .env hors du serveur.",
    ]:
        STORY.append(bul(etape))


def section_4():
    STORY.append(h1("4. Exploitation et dépannage"))
    STORY.append(p(
        "Le projet fournit lanceurs d'état, journaux dédiés, sauvegarde chiffrée outillée et "
        "sécurisation automatique des droits. Ce chapitre réunit l'essentiel : commandes, routine "
        "recommandée et remèdes aux incidents documentés."))
    STORY.append(tableau(
        ["Objectif", "Commande"],
        [["Sauvegarde / restauration",
          "node scripts/sauvegarde-bd.js --liste ; --restaurer \"SERVICE-RH-BD-...\" --sortie db/custom.db"],
         ["Superadministrateur",
          "node scripts/creer-superadmin.js --creer --email a@b.tn --nom \"Nom\" --password XXX ; "
          "--promouvoir --email a@b.tn"],
         ["Chiffrement base / stockage",
          "node scripts/chiffrer-base.js (idempotent, sauvegarde préalable) ; "
          "node scripts/chiffrer-storage.js --verifier"],
         ["Services",
          "node scripts/auto-rh.js start | stop | restart | status"],
         ["Découpage des anciens fichiers",
          "node scripts/scinder-pdfs-multipages.js --verifier (idem scinder-excel- et scinder-docx-)"],
         ["État et journaux",
          "ETAT-SILENCIEUX-WINDOWS.vbs ; JOURNAUX-SILENCIEUX-WINDOWS.vbs ; logs/auto-rh-processus.json"]],
        [4.6 * cm, LARGE_UTILE - 4.6 * cm]))
    STORY.append(legende("Tableau 4.1 — Commandes en ligne de commande (options vérifiées dans chaque script)."))
    STORY.append(tableau(
        ["Périodicité", "Tâche"],
        [["Hebdomadaire",
          "Vérifier l'état des deux services, les journaux et l'espace disque (journaux sans rotation automatique)."],
         ["Mensuelle (après paie)",
          "Sauvegarde .pgb + copie externe de db, storage ET .env ; vérifier la rotation."],
         ["Trimestrielle",
          "Test de restauration sur une machine de test depuis une sauvegarde .pgb et une copie storage."],
         ["Après chaque mise à jour",
          "Sauvegarder, remplacer les fichiers, npm install, npx prisma generate + db push (si le schéma a "
          "changé), npm run build, redémarrer ; cliquer « Indexer la base » si le bandeau ambré apparaît."],
         ["Annuelle",
          "Revue de capacité (taille de base, nombre de fiches, temps de réponse), export d'archive annuel, "
          "vérification des accès portail."]],
        [4.2 * cm, LARGE_UTILE - 4.2 * cm]))
    STORY.append(legende("Tableau 4.2 — Routine d'exploitation."))
    STORY.append(p(
        "Point de vigilance capital : une sauvegarde sans le fichier .env (AUTH_SECRET et "
        "AUTO_RH_STORAGE_KEY) est une sauvegarde morte — les fiches seraient irrécupérables après "
        "restauration."))
    STORY.append(h2("Dépannage : incidents d'exploitation et remèdes vérifiés"))
    STORY.append(tableau(
        ["Symptôme", "Remède vérifié"],
        [["« Node.js n'est pas reconnu » ou lanceur qui s'arrête immédiatement",
          "Réinstaller Node.js 22 LTS (nodejs.org), rouvrir le terminal puis relancer le lanceur."],
         ["Erreur 500 au démarrage, base absente",
          "Les lanceurs recréent le .env et exécutent prisma db push ; manuellement : npx prisma db push "
          "puis redémarrer."],
         ["Recherche lente ou 409 « indexation requise »",
          "Cliquer « Indexer la base pour la recherche » (idempotent, sans arrêt de service)."],
         ["Fiche importée introuvable en recherche",
          "La recherche exige le CIN COMPLET (séparateurs intérieurs et casse tolérés) ; un scan sans "
          "couche texte exige un réimport lisible (l'OCR ne s'applique qu'aux documents contenant "
          "quelques caractères)."],
         ["Erreur 405 à l'importation des fiches de paie",
          "Build PÉRIMÉ ne connaissant pas la route d'upload (correctif v0.2.175) : relancer npm run "
          "build puis redémarrer — les lanceurs livrés v0.2.175+ vérifient le marqueur de version et "
          "reconstruisent automatiquement si besoin."],
         ["« Ce compte a été automatiquement désactivé : le délai de 15 minutes … est dépassé »",
          "Le mot de passe initial n'a pas servi dans les 15 minutes : le SuperAdmin clique « Réactiver » "
          "dans l'onglet Utilisateurs — un NOUVEAU mot de passe unique est envoyé par e-mail."],
         ["Le manager ne reçoit pas les demandes de congé / autorisation",
          "Vérifier l'affectation « Manager responsable » dans l'onglet Accès portail : le manager doit "
          "être ACTIF et coché « Manager ». À défaut de manager, la demande part au service RH (repli)."],
         ["Statut resté « En attente » alors qu'une réponse a été donnée",
          "Corrigé en v0.2.173 : mettre à niveau — la réponse ULTÉRIEURE du second décideur achève la "
          "matrice et déclenche le PDF signé."],
         ["Fiches illisibles : « clé de chiffrement du stockage ne correspond pas »",
          "AUTH_SECRET ou AUTO_RH_STORAGE_KEY a changé : restaurer le .env d'origine ; ne JAMAIS "
          "régénérer les clés sur une base existante."],
         ["« Je ne reçois pas l'e-mail » (accès portail, test SMTP ou notification)",
          "Lire logs/journal-emails.log : chaque tentative y est consignée avec la réponse SMTP brute "
          "(Gmail : mot de passe d'application de 16 caractères obligatoire)."],
         ["Un document du dossier storage reste lisible sur le disque",
          "Il est chiffré AUTOMATIQUEMENT au démarrage du portail (balayage silencieux) ; pour forcer "
          "immédiatement : node scripts/chiffrer-storage.js. Les copies de tampons restent volontairement "
          "chiffrées (PAIESAGE1) et sont déchiffrées à la volée."],
         ["Après une mise à jour, le QR, la signature ou l'import ne fonctionnent plus",
          "Build PÉRIMÉ : relancer npm run build puis redémarrer (les lanceurs vérifient le marqueur "
          ".auto-rh-version et reconstruisent si besoin)."],
         ["« Port déjà utilisé » au démarrage",
          "ARRETER-SILENCIEUX-WINDOWS.vbs (ou node scripts/auto-rh.js stop) puis redémarrer ; "
          "vérifier avec ETAT-SILENCIEUX-WINDOWS.vbs."],
         ["Employé verrouillé : « Trop de tentatives » (423)",
          "Attendre 15 minutes ou bouton « Déverrouiller » de l'onglet Accès portail ; mot de passe "
          "expiré (15 jours) : changement imposé à la connexion ou réinitialisation par le RH."],
         ["Sessions invalidées après chaque redémarrage Docker",
          "Définir AUTH_SECRET et AUTO_RH_STORAGE_KEY dans le compose ou monter un .env restreint."]],
        [6.2 * cm, LARGE_UTILE - 6.2 * cm]))
    STORY.append(legende("Tableau 4.3 — Dépannage : incidents d'exploitation et remèdes vérifiés."))


def section_5():
    STORY.append(h1("5. Historique récent des versions"))
    STORY.append(p(
        "Toutes les versions se cumulent : installer la dernière revient à bénéficier de l'ensemble "
        "des correctifs. Les versions antérieures à v0.2.165 (détail complet dans les notes "
        "LIRE-MOI-CORRECTIF-*.txt de l'archive) ne sont pas reprises ici."))
    STORY.append(tableau(
        ["Version", "Apport principal"],
        [["v0.2.165", "Curseurs UID persistants du poller IMAP (aucune réponse relue deux fois)."],
         ["v0.2.168", "VALIDATION À DEUX ÉTAPES des congés/autorisations (matrice manager + RH, refus "
                      "immédiat) ; pièces jointes des réponses collectées."],
         ["v0.2.172", "Transfert au demandeur de TOUTES les pièces jointes des décideurs avec le PDF "
                      "signé — certifié campagne réelle Gmail/Zoho 42/42."],
         ["v0.2.173", "Correctif du statut manager resté « En attente » + campagne de tests obligatoires "
                      "en conditions réelles (36 vérifications) + rapport de test."],
         ["v0.2.174", "README PDF mis à jour dans toutes les parties (éditions complète et réduite)."],
         ["v0.2.175", "CORRECTIF de l'Erreur 405 à l'import des fiches de paie (route d'upload "
                      "restaurée + fra.traineddata OCR) — certifié 17/17."],
         ["v0.2.176", "README réduit à l'essentiel (informations inutiles supprimées) avec la DURÉE DU "
                      "PROJET ajoutée (section 1.2) ; livraison du projet vérifié fonctionnel."],
         ["v0.2.177", "CONFIDENTIALITÉ DE LA DÉCISION dans le portail employé : statut final des "
                      "congés/autorisations affiché uniquement après les réponses du manager ET des "
                      "RH — pièces jointes des réponses révélées en même temps."],
         ["v0.2.178", "PARRAINAGE PAR E-MAIL : le destinataire de la boîte dédiée accepte/refuse avec "
                      "les MÊMES expressions que le congé/autorisation (même détection, mots seuls "
                      "inclus) — statuts mis à jour automatiquement. CADRE VERT masqué dans « Mes "
                      "demandes » (barre d'étapes) et deux correctifs E2E."],
         ["v0.2.179", "RÉPONSE AUTOMATIQUE PDF DÉSACTIVÉE pour attestations (travail/salaire) et "
                      "parrainage : décision e-mail enregistrée automatiquement SANS réponse ni PDF "
                      "signé (trace reponseAutoPdf = « desactivee ») — congé/autorisation inchangés."],
         ["v0.2.180", "PIÈCES JOINTES DU RH AVEC LA DÉCISION : l'employé reçoit UN SEUL e-mail "
                      "contenant la décision ET les documents joints par le RH (sans PDF auto-généré ; "
                      "sans pièce jointe : aucun e-mail ; trace documentsRhTransmis)."],
         ["v0.2.181", "EXPRESSIONS RECONNUES pour attestations + parrainage : les 22 formulations "
                      "(acceptation, refus, mots seuls, négations) prouvées expression par expression "
                      "— 144 contrôles, 0 échec."],
         ["v0.2.182", "DOCUMENTS DU RESPONSABLE avec la décision de parrainage : formulation adaptée "
                      "« Le responsable de votre demande vous transmet le(s) document(s) » — 62 "
                      "contrôles dédiés, 0 échec."],
         ["v0.2.183", "README : TABLEAU DES EXPRESSIONS DE DÉCISION ajouté en section 2 (Tableau "
                      "2.1) et historique complété — AUCUN changement de code."],
         ["v0.2.184", "PIÈCES JOINTES DU MANAGER ET DES RH (congé/autorisation) : toutes les pièces "
                      "jointes existantes VISIBLES et CONSULTABLES à chaque étape du portail employé "
                      "(décision seule toujours confidentielle — v0.2.177) + notification automatique "
                      "« document disponible » avec les documents joints à chaque réponse "
                      "intermédiaire (formulation neutre) ; décision finale : v0.2.171 inchangé."],
         ["v0.2.185", "RÈGLE D'AFFICHAGE DU REFUS (portail employé, les 5 types) : statut refusé "
                      "affiché sous la SEULE mention « Refusée » — ni le département ni le manager "
                      "(acteur de traitement et commentaire de refus masqués, date conservée) ; "
                      "e-mails et administration inchangés ; v0.2.177 et v0.2.184 conservées."],
         ["v0.2.186", "CERTIFICAT DÉDIÉ MASQUÉ POUR LE RH (administration, onglet Demandes) : la "
                      "partie « Signature électronique — certificat dédié » de la section « Réponse "
                      "automatique PDF par e-mail (congé / autorisation) » n'est plus affichée au "
                      "rôle RH (import .p12/.pfx, interrupteur, signataire) — le SUPERADMIN la "
                      "conserve ; configuration inchangée et toujours appliquée aux réponses."],
         ["v0.2.187", "PARRAINAGE — AUCUNE NOTIFICATION DE REFUS AU SERVICE RH : après le refus "
                      "du responsable (décision unique, boîte dédiée), aucun e-mail de notification "
                      "de refus ne part vers le service RH ; le refus reste enregistré et l'employé "
                      "notifié comme avant (documents transmis le cas échéant) ; congé / "
                      "autorisation : notification du refus du manager inchangée."],
         ["v0.2.188", "REFUS SANS PDF (congé / autorisation) : aucun PDF de refus n'est généré ni "
                      "envoyé — l'employé reçoit un e-mail de NOTIFICATION de refus SANS PDF avec "
                      "TOUTES les pièces jointes du manager et/ou des RH (les deux intervenants : "
                      "l'ensemble part) ; statut « Refusée » et pièces jointes conservés dans le "
                      "portail ; ACCEPTATION : PDF signé inchangé ; autres types inchangés."],
         ["v0.2.189", "PDF DE RÉPONSE AUTOMATIQUE SIMPLIFIÉ : « Décision rendue par » supprimée "
                      "de « Informations de la demande » ; sections « Validations » et « Manager / "
                      "responsable » supprimées en entier ; conservés « Demande créée le … » et "
                      "« Décision finale : Acceptée — … » sans acteur ; mise en page inchangée ; "
                      "appliqué à tous les PDF de réponse automatique (acceptation ET refus)."],
         ["v0.2.190", "INTERRUPTeurs DES DESTINATAIRES RESPECTÉS : « Employé (destinataire) », "
                      "« Auto-RH » et « Manager / N+1 de la demande » (panneau Réponse PDF) "
                      "FILTRENT la réponse automatique e-mail — destinataire désactivé = exclu "
                      "de l'envoi (le manager désactivé ne reçoit plus la décision/PDF) ; "
                      "aucun destinataire = aucun envoi ; config absente = tous activés."],
         ["v0.2.191", "INTERRUPTHEURS E-MAIL EFFECTIFS DANS LES DEUX SENS : le module "
                      "d'acceptation/refus (administration) applique les 4 interrupteurs "
                      "e-mail du panneau DÈS QUE la ligne existe — MÊME section « non "
                      "engagée » (cause n°1 : repli historique TOUS ON) ; la voie e-mail "
                      "consulte le MAÎTRE « Envoi automatique » (OFF = AUCUN envoi — "
                      "ENVOI_DESACTIVE) et diagnostique TOUT échec de lecture (cause n°2 : "
                      "lecture silencieuse, client Prisma ancien)."],
         ["v0.2.192", "BOUTONS DE GESTION TOUJOURS ACCESSIBLES : la colonne Actions du "
                      "tableau « Comptes utilisateurs — superadministration » est COLLANTE "
                      "à droite (sticky, fond opaque, séparation + ombre) — les 5 boutons "
                      "restent visibles et cliquables SANS défilement horizontal ; "
                      "colonnes secondaires masquées sur écrans étroits (Manager < XL, "
                      "Créé le < LG) ; e-mail tronqué avec infobulle ; poignées de "
                      "redimensionnement conservées (option data-col-sticky du hook)."],
         ["v0.2.193", "NOTIFICATIONS TOUJOURS ENVOYÉES : les e-mails de notification "
                      "d'acceptation / de refus partent TOUJOURS à l'employé « À », au "
                      "service RH et au manager (copies historiques rétablies) — AUCUN "
                      "interrupteur ne les coupe plus (ENVOI_DESACTIVE retiré) ; les 4 "
                      "interrupteurs du panneau « Réponse PDF » ne gouvernent PLUS QUE LA "
                      "PIÈCE JOINTE : PDF signé aux destinataires activés, la même "
                      "notification SANS PDF aux autres (au plus deux messages) ; refus "
                      "congé/autorisation (pas de PDF) : drapeaux sans effet — tout le "
                      "monde est notifié."],
         ["v0.2.194", "CERTIFICAT : IMPORT MASQUÉ POUR LE RH — le bloc d'import du "
                      "fichier de certificat (fichier, mot de passe PKCS#12, clé privée "
                      "associée, notes d'attente et avertissements) est masqué dans les "
                      "sections « Importer » et « Demandes » ; une note renvoie le RH au "
                      "superadministrateur ; interrupteur, positionnement et métadonnées "
                      "restent visibles ; configuration enregistrée inchangée et "
                      "toujours appliquée."],
         ["v0.2.195", "DÉCISION MANAGER : CARTE MASQUÉE POUR LE RH — dans le détail "
                      "des demandes de congé et d'autorisation de sortie (onglet "
                      "« Demandes »), la carte « Décision Manager » (badge + boutons "
                      "« Enregistrer la décision du manager ») est masquée pour le "
                      "rôle RH ; une note indique que la décision est enregistrée par "
                      "la réponse e-mail du manager (ou par le superadministrateur) ; "
                      "l'état de la décision reste affiché dans la section « Décision "
                      "RH » et dans la liste (badge « M : ») ; repli manuel réservé au "
                      "SUPERADMIN — aucun changement serveur."],],
        [2.6 * cm, LARGE_UTILE - 2.6 * cm]))
    STORY.append(legende("Tableau 5.1 — Historique récent (les versions se cumulent)."))


def annexe():
    STORY.append(h1("Annexe — Matrice des droits des rôles"))
    STORY.append(p(
        "État du code livré v0.2.195. Trois rôles d'administration (SuperAdmin, RH, IT) sur le port "
        "4000 ; l'employé dispose du portail dédié 4001 (bloc ci-après). Le classeur Excel "
        "/api/download-matrice reprend cette matrice."))
    STORY.append(pivot("Fiches de paie"))
    STORY.append(matrice_tableau([
        ("Consultation — recherche par CIN, toutes les fiches, détail, copie signée servie (original intact)", "Oui", "Oui", "Non"),
        ("Importer des fiches de paie (PDF Sage, images, Excel, Word, ZIP ; signature PAdES automatique)", "Oui", "Oui", "Non"),
        ("Supprimer des fiches (unitaire et multiple)", "Oui", "Oui", "Non"),
        ("Maintenance — redétection du contenu, indexation de la base", "Oui", "Oui", "Non"),
        ("QR « Fiche en ligne » — page publique sous jeton HMAC : activation et configuration", "Oui", "Oui", "Non"),
    ]))
    STORY.append(Spacer(1, 5))
    STORY.append(pivot("Tampon, signature et certificat"))
    STORY.append(matrice_tableau([
        ("Configuration du tampon signature et QR des fiches (consultation, modification, aperçu)", "Oui", "Oui", "Non"),
        ("Import du certificat de signature — 10 formats (.p12, .pfx, .pem, .cer…), fichier chiffré sur disque", "Oui", "Oui", "Non"),
        ("Onglet « Signature » — signature électronique des documents importés, cachet des réponses", "Oui", "Oui", "Non"),
        ("Module « API de certification &amp; signature électronique » — configuration réservée au SuperAdmin (v0.2.126)", "Oui", "Non", "Non"),
        ("Cachet « Signature électronique » du tampon — rectangle ou rond, contenu choisi (v0.2.128), couvert par la signature PAdES", "Oui", "Oui", "Non"),
    ]))
    STORY.append(Spacer(1, 5))
    STORY.append(pivot("Accès portail par mot de passe"))
    STORY.append(matrice_tableau([
        ("Créer / réinitialiser / activer-désactiver / débloquer / supprimer un accès", "Oui", "Oui", "Non"),
        ("QR code d'accès / réinitialisation du QR", "Oui", "Oui", "Non"),
        ("Envoyer le mot de passe initial par e-mail (adresse enregistrée sur le compte)", "Oui", "Oui", "Non"),
        ("Modifier « Nom » / « Prénom » / « Matricule » / e-mail — répercuté sur toutes les fiches du CIN", "Oui", "Oui", "Non"),
        ("Désigner un employé « Manager » et choisir son « Manager responsable » — SANS réinitialiser le mot de passe", "Oui", "Oui", "Non"),
    ]))
    STORY.append(Spacer(1, 5))
    STORY.append(pivot("Demandes administratives"))
    STORY.append(matrice_tableau([
        ("Liste, détail, traitement (statut + commentaire + notification e-mail) — les 5 types", "Oui", "Oui", "Non"),
        ("Réponse avec document (import direct ; tampon et signature automatiques de la config des réponses)", "Oui", "Oui", "Non"),
        ("Téléchargement des documents de réponse", "Oui", "Oui", "Non"),
        ("Configuration DÉDIÉE du tampon des réponses (paraphe, tampon, QR, cachet, mention, envoi)", "Oui", "Oui", "Non"),
        ("Certificat dédié de la section « Réponse automatique PDF » — import .p12/.pfx, interrupteur, signataire (v0.2.186)", "Oui", "Non", "Non"),
        ("Journal d'envoi IMAP (outil de diagnostic de la réception automatique)", "Oui", "Non", "Oui"),
    ]))
    STORY.append(Spacer(1, 5))
    STORY.append(pivot("Paramètres techniques — messagerie et comptes"))
    STORY.append(matrice_tableau([
        ("Consulter / modifier la configuration SMTP et tests d'envoi SMTP / IMAP", "Oui", "Non", "Oui"),
        ("Créer / réactiver / activer-désactiver / supprimer un compte RH ou IT ; changer le rôle", "Oui", "Non", "Non"),
        ("Lister les comptes", "Oui", "Non", "Oui (consultation seule)"),
        ("Statistiques du tableau de bord ; changement de son propre mot de passe (expiration 15 jours)", "Oui", "Oui", "Oui"),
    ]))
    STORY.append(legende(
        "« Non » = refusé (403 côté serveur et/ou élément masqué dans l'interface) — les refus IT sont "
        "appliqués proprement côté serveur, sans état intermédiaire. Le dernier compte superadministrateur "
        "actif est protégé contre la suppression et la désactivation. Depuis la v0.2.186, la partie "
        "« Signature électronique — certificat dédié » de la section « Réponse automatique PDF par "
        "e-mail » est MASQUÉE pour le rôle RH dans l'interface (masquage d'affichage ; la configuration "
        "enregistrée s'applique aux réponses quelle que soit la personne qui consulte)."))
    STORY.append(h2("Onglets visibles dans l'interface d'administration"))
    STORY.append(bul(
        "<b>SuperAdmin (8 onglets)</b> : Recherche CIN · Toutes les fiches · Importer · Accès portail · "
        "Demandes · Signature · Paramètres · Utilisateurs. <b>RH (6 onglets)</b> : Recherche CIN · "
        "Toutes les fiches · Importer · Accès portail · Demandes · Signature. <b>IT (2 onglets)</b> : "
        "Paramètres (SMTP seul) · Utilisateurs (consultation seule)."))
    STORY.append(h2("Le portail employé (port 4001)"))
    STORY.append(bul(
        "Connexion CIN + mot de passe + code OTP (2FA TOTP à chaque connexion) ; mot de passe initial à "
        "usage unique, changé obligatoirement à la première connexion puis tous les 15 jours. "
        "Consultation de SES fiches uniquement — copies SIGNÉES téléchargeables ; demandes "
        "administratives (5 types), suivi dans « Mes demandes », documents de réponse dans « Mes "
        "documents » ; aucune fonction d'administration exposée."))
    STORY.append(bul(
        "<b>Confidentialité de la décision (v0.2.177 — complétée v0.2.184)</b> : pour les demandes de "
        "congé et d'autorisation de sortie, le statut final n'est affiché dans « Mes demandes » "
        "QU'APRÈS les réponses du manager ET du service RH. Tant que la validation n'est pas "
        "complète, la demande reste « En attente » (les décisions d'étape, le commentaire de "
        "traitement, la date et l'acteur de traitement restent masqués, une note l'indique à "
        "l'employé). Depuis la <b>v0.2.184</b>, les PIÈCES JOINTES ne sont plus masquées : elles "
        "restent visibles et consultables À CHAQUE étape (voir la puce dédiée ci-dessous) — seule "
        "la DÉCISION reste confidentielle. Un refus, immédiat et définitif, est affiché dès qu'il "
        "est prononcé (il achève la validation) ; depuis la <b>v0.2.185</b>, il n'apparaît que sous "
        "la seule mention « Refusée » (voir la puce dédiée ci-dessous). E-mails de décision et "
        "administration RH inchangés."))
    STORY.append(bul(
        "<b>Parrainage par e-mail (v0.2.178)</b> : la demande de parrainage part à l'adresse DÉDIÉE "
        "(avec la consigne « VALIDATION PAR E-MAIL ») ; le destinataire accepte ou refuse en répondant "
        "avec les MÊMES expressions que le congé / l'autorisation — « J'accepte votre demande », "
        "« J'accepte », « OK », « D'accord », « Je valide », « J'approuve », « Je vous accorde », "
        "« Acceptée », « Validée », « Approuvée », « Accordée », « Délivrée » / « Je refuse », "
        "« Refus », « Non », « Désaccord », « Pas d'accord », « Hors de question », « Refusée », "
        "et les négations (« Je ne valide pas », « Je n'accepte pas », « Je ne peux pas accepter »…) — "
        "casse, accents, apostrophes, ponctuation et texte autour tolérés, priorité au refus, réponse "
        "ambiguë sans effet. La décision du destinataire est UNIQUE (une seule étape) : le statut est "
        "mis à jour AUTOMATIQUEMENT dans le portail et l'administration ; depuis la <b>v0.2.179</b>, "
        "la décision est enregistrée SANS réponse automatique ni PDF signé (le service RH répond "
        "lui-même à l'employé). Vérifié en campagne réelle Gmail/Zoho (26/26)."))
    STORY.append(bul(
        "<b>Affichage des demandes (v0.2.178)</b> : le cadre vert de la capture utilisateur — la barre "
        "d'étapes « 1. Manager : … → 2. Auto-RH : … » — N'EST PLUS affichée dans « Mes demandes » ; "
        "le badge du statut final, les pièces jointes et le détail restent inchangés, et le fil de "
        "validation complet reste consultable côté administration. Modification d'affichage SEULE : "
        "workflow, statuts et e-mails inchangés."))
    STORY.append(bul(
        "<b>Réponse automatique PDF désactivée (v0.2.179)</b> : pour les demandes d'<b>attestation "
        "de travail</b>, d'<b>attestation de salaire</b> et de <b>parrainage</b>, après la décision "
        "par e-mail (acceptée OU refusée), AUCUNE réponse automatique n'est envoyée à l'employé et "
        "AUCUN PDF signé n'est généré — la décision reste détectée et enregistrée automatiquement "
        "(statuts, administration, historique) et le service RH assure la réponse manuellement "
        "(attestation réelle jointe à sa propre réponse, notification « document disponible » "
        "toujours active). Depuis la <b>v0.2.188</b>, le congé et l'autorisation conservent la "
        "réponse automatique avec le PDF signé UNIQUEMENT en cas d'ACCEPTATION — en cas de REFUS, "
        "AUCUN PDF n'est généré ni envoyé (voir la puce dédiée ci-dessous). Trace au journal : "
        "reponseAutoPdf = « desactivee »."))
    STORY.append(bul(
        "<b>Pièces jointes du RH avec la décision (v0.2.180)</b> : pour les demandes "
        "d'attestation de travail, d'attestation de salaire et de parrainage, le "
        "service RH PEUT joindre des documents à sa réponse e-mail (attestation "
        "réelle, documents nécessaires…) : dès qu'une décision (acceptée OU "
        "refusée) est reconnue, l'employé reçoit UN SEUL e-mail « Votre demande : "
        "… — Acceptée/Refusée — documents joints » contenant la décision ET les "
        "documents du RH en pièces jointes (réponse courante + réponses "
        "antérieures — aucune pièce perdue). SANS pièce jointe : aucun e-mail "
        "(v0.2.179). AUCUN PDF auto-généré dans cet envoi. Les documents restent "
        "aussi consultables/téléchargeables dans le portail employé ; trace au "
        "journal : documentsRhTransmis."))
    STORY.append(bul(
        "<b>Expressions reconnues pour les attestations et le parrainage (v0.2.181)</b> : la "
        "classification automatique des réponses e-mail s'applique expressément aux demandes "
        "d'ATTESTATION DE TRAVAIL, d'ATTESTATION DE SALAIRE et de PARRAINAGE "
        "(TYPES_CLASSIFICATION_AUTO) et reconnaît pour ces trois types TOUTES les formulations "
        "officielles — acceptation : « J'accepte votre demande », « J'accepte », « OK », "
        "« D'accord », « Je valide », « J'approuve », « Je vous accorde » et les mots seuls "
        "« Acceptée », « Validée », « Approuvée », « Accordée », « Délivrée » ; refus : « Je refuse », "
        "« Refus », « Non », « Désaccord », « Pas d'accord », « Hors de question », le mot seul "
        "« Refusée » et les négations naturelles « Je ne valide pas », « Je n'accepte pas », "
        "« Je ne peux pas accepter ». Casse, accents, apostrophes, ponctuation et texte autour "
        "tolérés ; réponse dans l'OBJET seul (« Re: … — Acceptée », « Refusée », « OK ») reconnue ; "
        "citation du message d'origine écartée (seuls les mots du décideur sont classés) ; priorité "
        "au refus (une négation ne devient JAMAIS une validation) ; réponse ambiguë ou non reconnue "
        "sans effet (demande « En attente »). La décision reste enregistrée automatiquement pour "
        "ces trois types (v0.2.179 : SANS réponse automatique ni PDF ; v0.2.180 : documents du RH "
        "transmis avec la décision). Preuve v0.2.181 : 144 contrôles unitaires (22 expressions × 3 "
        "types, citations réelles, tolérances, gardes) — 0 échec."))
    STORY.append(bul(
        "<b>Documents du responsable avec la décision de parrainage (v0.2.182)</b> : le même "
        "principe que les attestations s'applique aux demandes de PARRAINAGE — le responsable "
        "concerné (destinataire de la boîte dédiée au parrainage) PEUT joindre des documents à "
        "sa décision finale (acceptée OU refusée) : l'employé les reçoit DIRECTEMENT avec la "
        "réponse, dans UN SEUL e-mail contenant la décision ET les documents du responsable en "
        "pièces jointes (réponse courante + réponses antérieures — aucune pièce perdue). La "
        "formulation des notifications est ADAPTÉE au parrainage : « Votre demande de parrainage "
        "a été traitée par le responsable concerné » et « Le responsable de votre demande vous "
        "transmet le(s) document(s) » — plus jamais « service RH » pour ce type (attestations : "
        "formulation « service RH » conservée). Sans décision reconnue dans la réponse, les "
        "documents partent par la notification « document disponible » (même adaptation). "
        "AUCUN PDF auto-généré (v0.2.179) ; sans pièce jointe : aucun e-mail ; documents aussi "
        "consultables dans le portail employé. Preuve v0.2.182 : 62 contrôles dédiés + "
        "non-régression 23+21+144+133 contrôles — 0 échec."))
    STORY.append(bul(
        "<b>Expressions de décision dans le README (v0.2.183)</b> : la liste complète des formulations "
        "de décision reconnues par réponse e-mail est présentée sous forme de TABLEAU dédié "
        "en section 2 (Tableau 2.1) — acceptation (7 formulations + 5 mots seuls), refus (6 "
        "formulations + le mot seul « Refusée ») et négations naturelles comptant comme refus (3) — "
        "avec les tolérances (casse, accents, ponctuation, objet seul, priorité au refus). "
        "Historique récent complété au Tableau 5.1."))
    STORY.append(bul(
        "<b>Pièces jointes du manager et des RH à toutes les étapes (v0.2.184)</b> : pour les "
        "demandes de congé et d'autorisation de sortie, quand le manager ET/OU les RH joignent des "
        "documents à leur réponse, TOUTES les pièces jointes existantes sont VISIBLES et "
        "CONSULTABLES par l'employé dans « Mes demandes » (Visualiser / Télécharger) — pièce "
        "d'origine + documents reçus avec chaque réponse, à CHAQUE étape de la validation à deux "
        "étapes comme après la décision finale (l'API employé ne masque plus les pièces pendant "
        "l'attente ; la DÉCISION seule reste confidentielle, règle v0.2.177). L'employé reçoit EN "
        "PLUS les documents AUTOMATIQUEMENT par e-mail : dès qu'un décideur répond avec des pièces "
        "jointes alors que la matrice n'est pas achevée, notification « Document disponible » avec "
        "les documents EN PIÈCES JOINTES — formulation NEUTRE (« Document(s) transmis avec la "
        "réponse à votre demande », « Elle poursuit son circuit de validation habituel ») : ni "
        "l'acteur ni la décision intermédiaire ne sont révélés. À la décision FINALE, le chemin "
        "v0.2.171 est inchangé : TOUTES les pièces jointes existantes (courante + antérieures, "
        "dédoublonnées) partent avec la réponse automatique et le PDF signé, en CC au service RH "
        "et au destinataire du traitement. Attestations et parrainage inchangés (v0.2.179/180/182). "
        "Trace au journal : notificationEtapeIntermediaire. Preuve v0.2.184 : 61 contrôles dédiés "
        "(dont simulations exécutées du bloc de masquage et de la condition d'envoi) + non-régression "
        "133+23+21+144+63 — 445 contrôles, 0 échec."))
    STORY.append(bul(
        "<b>Règle d'affichage du refus — « Refusée » sans acteur (v0.2.185)</b> : dans le portail "
        "employé, pour TOUTES les demandes (congé, autorisation de sortie, attestation de salaire, "
        "attestation de travail, parrainage), lorsque le statut est refusé, la zone de statut "
        "n'affiche PLUS que la mention « Refusée » : le badge n'expose plus les libellés raffinés "
        "« Refusée par le Manager » / « Refusée par les RH », la ligne « Statut final » n'affiche "
        "plus « par … » (acteur de traitement masqué — « Manager (réponse e-mail) », « Auto-RH "
        "(réponse e-mail) », « Service parrainage (réponse e-mail) »…), et le commentaire de refus "
        "(qui nomme le département ou le manager : « Refusée par le manager — décision immédiate et "
        "définitive… ») n'est plus montré à l'employé. La date de décision reste visible (elle ne "
        "révèle aucun acteur) et la notification automatique de changement de statut dit désormais "
        "« … est désormais : Refusée ». Le refus est toujours enregistré avec son acteur côté "
        "administration (traçage complet, refuseePar) et dans les e-mails de décision (libellé "
        "raffiné conservé) — SEUL l'affichage au portail employé est simplifié. Les statuts "
        "« Acceptée », « Validée », « Information requise » et « En attente » gardent leur affichage "
        "historique ; les règles v0.2.177 (décision masquée tant que la matrice deux étapes est "
        "incomplète) et v0.2.184 (pièces jointes visibles à toutes les étapes) restent STRICTEMENT "
        "inchangées. Preuve v0.2.185 : 58 contrôles dédiés (5 types × refus manager/RH/parrainage, "
        "simulations exécutées du bloc de mapping) + non-régression 133+23+21+144+61+63 — 503 "
        "contrôles, 0 échec."))
    STORY.append(bul(
        "<b>Certificat dédié masqué pour le rôle RH (v0.2.186)</b> : dans l'ADMINISTRATION (onglet "
        "Demandes), la section « Réponse automatique PDF par e-mail (congé / autorisation) » n'affiche "
        "PLUS, pour le rôle RH, la partie « Signature électronique — certificat dédié à cette "
        "section » (prop masquerCertificat, passée par DemandesTab quand le rôle vaut « RH ») — "
        "fichier .p12/.pfx, mot de passe du certificat, interrupteur « Activée/Désactivée », "
        "boutons Vérifier/Retirer, nom et fonction du signataire : la gestion du certificat dédié est "
        "désormais réservée au SUPERADMINISTRATEUR, qui conserve la partie ENTIÈRE (aucun changement "
        "de son côté). MASQUAGE D'AFFICHAGE SEUL : la configuration enregistrée (interrupteur de "
        "signature, certificat importé) continue de s'appliquer aux réponses PDF générées quelle que "
        "soit la personne qui consulte la section, et un enregistrement fait depuis la vue RH réécrit "
        "les valeurs du certificat TELLES QUE CHARGÉES du serveur (aucun écrasement possible) ; "
        "l'avertissement du cachet « Signature électronique » (certificat absent) renvoie le RH vers "
        "le superadministrateur au lieu de proposer l'import. Toutes les autres parties de la section "
        "restent accessibles au RH (génération automatique, aperçu interactif, paraphe, tampon, QR, "
        "cachet, mention, e-mail). Preuve v0.2.186 : 60 contrôles dédiés (structure du JSX, câblage "
        "du rôle, contenu préservé pour le SUPERADMIN, simulations) + non-régression 58 contrôles "
        "(v0.2.185) + build de production sans erreur."))
    STORY.append(bul(
        "<b>Parrainage — aucune notification de refus au service RH (v0.2.187)</b> : après le REFUS "
        "du responsable (boîte dédiée du parrainage, décision unique en une seule étape — v0.2.178), "
        "AUCUN e-mail de notification de refus n'est envoyé au service RH (la condition d'envoi "
        "exclut désormais demande.type = « PARRAINAGE »). Le refus reste intégralement enregistré "
        "(statut « Refusée », traçage « Service parrainage (réponse e-mail) », commentaire) et "
        "l'employé continue d'être notifié comme avant (documents du responsable transmis le cas "
        "échéant — v0.2.180/182 ; aucune réponse automatique PDF — v0.2.179). Congé et autorisation "
        "de sortie inchangés : le service RH reste informé du refus du manager (information "
        "« Task 181 » conservée). Preuve v0.2.187 : "
        "30 contrôles dédiés (exclusion du type, simulations exécutées de la condition, flux "
        "parrainage inchangé, journal) + non-régression 430 contrôles (v0.2.179 à v0.2.186) — "
        "460 contrôles, 0 échec."))
    STORY.append(bul(
        "<b>Refus sans PDF — notification e-mail avec les pièces jointes (v0.2.188)</b> : pour les "
        "demandes de CONGÉ et d'AUTORISATION DE SORTIE, lorsque le manager ET/OU le service RH "
        "refusent, le système ne génère plus et n'envoie plus automatiquement AUCUN PDF de réponse "
        "de refus (l'appel au moteur de document de refus est supprimé de la voie automatique — "
        "AUCUN PDF de refus n'existe plus, ni en pièce jointe, ni dans « Mes documents »). À la "
        "place, l'employé reçoit UNIQUEMENT l'e-mail de NOTIFICATION de refus (copies RH + "
        "décideur conservées) qui transporte TOUTES les pièces jointes ajoutées par le manager "
        "et/ou le service RH lors de leurs réponses — réponse courante + antérieures, cumulées et "
        "dédupliquées (mécanisme v0.2.171) : si les DEUX intervenants ajoutent des pièces "
        "jointes, l'ENSEMBLE des fichiers concernés part à l'employé dans le mail de notification. "
        "Le statut final de la demande reste « Refusée » dans le portail employé (seule mention "
        "« Refusée », sans acteur — v0.2.185) et les pièces jointes envoyées par le manager et les "
        "RH restent visibles et consultables dans « Mes demandes » (v0.2.184). L'ACCEPTATION "
        "(congé / autorisation) conserve le document tamponné et signé électroniquement, joint à "
        "la notification (v0.2.168 inchangée) ; les attestations, le parrainage et les autres "
        "types de demandes ne sont pas modifiés (v0.2.179/180/182/187 conservées). Interface "
        "d'administration : la description de la section « Réponse automatique PDF par e-mail "
        "(congé / autorisation) » reflète la nouvelle règle. Trace au journal : "
        "pdfRefusDesactive = « sans_pdf » + piecesJointesNotificationRefus (noms des pièces "
        "transportées). Preuve v0.2.188 : 49 contrôles dédiés (condition de génération, "
        "simulations exécutées — congé refusé manager, autorisation refusée RH, acceptation "
        "inchangée, types protégés —, notification sans PDF, journal, panneau) + non-régression "
        "437 contrôles (v0.2.180 à v0.2.187) — 486 contrôles, 0 échec ; node --check OK."))
    STORY.append(bul(
        "<b>PDF de réponse automatique simplifié (v0.2.189)</b> : TOUS les PDF de réponse "
        "automatique (document d'ACCEPTATION congé / autorisation ET documents de refus — quel "
        "que soit le type de demande concerné) sont SIMPLIFIÉS : dans la section « Informations "
        "de la demande », la mention « Décision rendue par » est SUPPRIMÉE (l'auteur de la "
        "décision n'est plus montré) ; la section « Manager / responsable » (nom et e-mail du "
        "manager) est SUPPRIMÉE ENTIÈREMENT ; la section « Validations » (validation du manager, "
        "note du manager, validation du service RH, validation finale « par … ») est SUPPRIMÉE "
        "ENTIÈREMENT. SONT CONSERVÉS, sous le détail de la demande, les DEUX lignes "
        "« Demande créée le date et heure » et « Décision finale : Acceptée — date et heure » "
        "(SANS l'acteur — le « (par …) » et les étapes intermédiaires manager/RH sont masqués) ; "
        "toutes les autres informations (référence, type, statut, dates, identité de l'employé, "
        "détail congé/autorisation, signature, tampon) et la MISE EN PAGE du document (en-tête, "
        "bandeau statut, titres de sections, tableaux, bloc signature/tampon réservé, une seule "
        "page) sont conservées. Les noms du manager et du décideur restent disponibles pour les "
        "e-mails et la traçabilité (administration, journal) — ils ne sont PLUS AFFICHÉS dans le "
        "PDF. Vérification par GÉNÉRATION RÉELLE : le PDF est produit avec un contexte réaliste "
        "et son texte extrait confirme la présence des sections conservées et des 2 lignes "
        "d'historique, ainsi que l'ABSENCE totale des éléments supprimés (aucune fuite du "
        "manager ni du décideur). Preuve v0.2.189 : 39 contrôles dédiés (sources) + 28 contrôles "
        "de contenu extrait du PDF réellement généré + non-régression 486 contrôles (v0.2.180 à "
        "v0.2.188) — 553 contrôles, 0 échec ; node --check OK."))
    STORY.append(bul(
        "<b>Interrupteurs des destinataires respectés (v0.2.190)</b> : DEMANDE UTILISATEUR — "
        "« lorsque je désactive l'interrupteur de manager, [le manager] reçoit toujours "
        "automatiquement la réponse PDF ; vérifier les interrupteurs manager, RH et aussi "
        "employé ». CAUSE (v0.2.189) : la voie e-mail automatique (traiterMessageRecu → "
        "envoyerEmailDecisionConge) construisait ses copies (Cc) en ignorant le panneau "
        "Réponse PDF : ccDecision ajoutait TOUJOURS la boîte du service RH ET la boîte du "
        "manager (destinataire de la demande — congé / autorisation de sortie) ; désactiver "
        "« Manager / N+1 de la demande », « Auto-RH » ou « Employé (destinataire) » "
        "n'avait AUCUN effet sur la réponse automatique (le module document-acceptation.js "
        "respecte bien ces interrupteurs, mais la voie automatique lui passe sansEmail = "
        "true — son e-mail propre n'est jamais envoyé). CORRECTIF (v0.2.190) : le portail "
        "lit DÉSORMAIS la configuration ReponsePdfConfig (id « reponse-pdf ») avant chaque "
        "réponse de décision — « Auto-RH » désactivé → la boîte RH n'est plus en Cc ; "
        "« Manager / N+1 » désactivé → la boîte du manager n'est plus en Cc (lorsque la "
        "demande est adressée DIRECTEMENT au service RH, l'interrupteur RH régit seul cette "
        "adresse) ; « Employé (destinataire) » désactivé → l'employé n'est plus le "
        "destinataire « À » : le PREMIER Cc activé est promu (sémantique IDENTIQUE au module "
        "document-acceptation.js) ; AUCUN destinataire activé → AUCUN envoi (incident "
        "journalisé — code AUCUN_DESTINATAIRE) ; configuration absente ou illisible → TOUS "
        "ACTIVÉS (comportement historique v0.2.168 conservé) ; JAMAIS bloquant. Les PDF "
        "restent inchangés (acceptation : PDF signé joint ; refus : notification sans PDF — "
        "v0.2.188) ainsi que la transmission intermédiaire aux RH et la notification "
        "« document disponible ». Preuve v0.2.190 : 41 contrôles dédiés (lecture de "
        "configuration, filtrage Cc, option envoyerEmployeDecision, gardes et journal, persistance "
        "panneau→base, simulations exécutées du bloc réel — manager désactivé, RH désactivé, "
        "employé désactivé, tous activés, demande adressée au RH) + non-régression 278 "
        "contrôles (v0.2.184 à v0.2.189) — 319 contrôles, 0 échec ; node --check OK."))
    STORY.append(bul(
        "<b>Interrupteurs e-mail effectifs dans les deux sens (v0.2.191)</b> : DEMANDE "
        "UTILISATEUR — « les interrupteurs de la section « Envoi par e-mail (réponse PDF "
        "en pièce jointe) » ne fonctionnent ni lorsqu\'ils sont activés ni lorsqu\'ils "
        "sont désactivés ». DEUX CAUSES RACINES. (1) Le module document-acceptation.js "
        "(chargerConfig — partagé par TOUTES les décisions de l'administration : "
        "acceptation / refus signés, réponse avec document importé) ignorait le panneau "
        "tant que la section n'était pas « ENGAGÉE » (interrupteur de génération OFF — "
        "LE DÉFAUT — et aucun certificat dédié importé) : repli sur la configuration "
        "historique (TOUS ON, sans interrupteur Employé) → les 4 interrupteurs e-mail "
        "restaient SANS AUCUN EFFET sur les e-mails de décision émis par l'administration. "
        "CORRECTIF : chargerConfig applique DÉSORMAIS les 4 interrupteurs e-mail (maître "
        "+ Employé / RH / Manager) DÈS QUE LA LIGNE ReponsePdfConfig EXISTE — la règle de "
        "continuité v0.2.148 reste limitée aux VISUELS du document (paraphe, tampon, QR, "
        "certificat) ; une installation qui n'a jamais ouvert le panneau conserve les "
        "défauts historiques (tous activés — identiques) : AUCUN changement tant qu'aucun "
        "interrupteur n'est touché. (2) La voie e-mail du portail ne consultait pas "
        "l'interrupteur MAÎTRE « Envoi automatique de l'e-mail » (emailActif) et son "
        "échec de lecture était SILENCIEUX (ex. client Prisma ancien sans le modèle → "
        "repli défauts ON sans trace) — CORRECTIF : maître OFF → AUCUNE réponse de "
        "décision (journal ENVOI_DESACTIVE, trace console) ; garde explicite « modèle "
        "ReponsePdfConfig absent du client Prisma » (remédiation : npx prisma generate "
        "puis redémarrer le portail) ; trace des interrupteurs LUS à chaque décision. "
        "(3) Description du maître clarifiée dans le panneau. Preuve v0.2.191 : 40 "
        "contrôles dédiés (chargerConfig RÉEL sur la vraie base — section non engagée, "
        "engagée, ligne absente ; traiterAcceptationFinale RÉEL — manager/RH/employé/ "
        "maître désactivés, promotion du premier Cc ; code portail RÉEL — maître OFF, "
        "drapeaux, client Prisma ancien, fonction envoyerEmailDecisionConge) + "
        "non-régression 520 contrôles chiffrés (10 suites : v0.2.190 41, Task 185 35, "
        "v0.2.184 61, v0.2.185 58, v0.2.179 23, v0.2.180 21, v0.2.182 63, v0.2.187 30, "
        "tampon 44, expressions 144) + 4 suites complémentaires (v0.2.188, v0.2.189, "
        "document-refus, génération 189) — 0 échec ; node --check OK ; build OK."))
    STORY.append(bul(
        "<b>Boutons de gestion toujours accessibles (v0.2.192)</b> : DEMANDE "
        "UTILISATEUR — « Afficher les boutons de gestion des comptes de manière plus "
        "pratique afin de faciliter leur utilisation, sans avoir à faire défiler les "
        "colonnes vers la gauche et vers la droite ». CORRECTIF D'AFFICHAGE dans le "
        "tableau « Comptes utilisateurs — superadministration » : (1) la colonne "
        "Actions est COLLANTE à droite (position sticky, fond opaque, séparation à "
        "gauche + ombre portée) — Désactiver / Manager / Mot de passe / Rôle / "
        "Supprimer (et « Réactiver » pour les comptes dont le délai d'activation a "
        "expiré) restent visibles et cliquables MÊME quand le tableau défile "
        "horizontalement ; (2) le hook de redimensionnement des colonnes impose une "
        "position « relative » à chaque en-tête : il est étendu par une option OPT-IN "
        "(attribut data-col-sticky=&quot;right&quot;) qui respecte la position "
        "collante — AUCUN changement pour les autres tableaux (poignées de "
        "redimensionnement et double-clic de réinitialisation conservés) ; (3) "
        "COMPACTAGE : colonnes secondaires masquées sur les écrans étroits (Manager "
        "masquée sous XL, Créé le sous LG) et e-mail tronqué avec infobulle — à "
        "1000 px de large le tableau ne défile PLUS du tout, et en dessous le seul "
        "défilement résiduel n'empêche plus JAMAIS d'atteindre les boutons. "
        "Modification d'affichage SEULE : handlers, dialogues, API et permissions "
        "inchangés (superadministrateur seul). Preuve : vérification navigateur "
        "réelle — colonnes mesurées au pixel (1400 px : 7 colonnes et 5 boutons sans "
        "défilement ; 1000 px : AUCUN défilement), défilement forcé à 780 px — "
        "Actions collée au bord droit (écart 0 px) et boutons cliquables vérifiés "
        "par elementFromPoint, dialogue « Rôle » ouvert puis fermé, position collante "
        "conservée ; build production OK."))
    STORY.append(bul(
        "<b>Notifications toujours envoyées — interrupteurs = réponse PDF seulement "
        "(v0.2.193)</b> : DEMANDE UTILISATEUR — « Même si les interrupteurs sont activés "
        "ou désactivés, les e-mails de notification d'acceptation ou de refus doivent "
        "toujours être envoyés. Les interrupteurs doivent uniquement contrôler l'envoi de "
        "la réponse automatique par PDF, sans modifier le fonctionnement des notifications "
        "par e-mail ». NOUVELLE SÉMANTIQUE appliquée aux TROIS voies de décision : "
        "(1) PORTAIL (congé / autorisation de sortie par e-mail) — les copies "
        "historiques (service RH + boîte du manager) sont RÉTABLIES sans aucun filtrage "
        "par interrupteur, l'employé reste « À » ; l'interrupteur maître « Envoi "
        "automatique de l'e-mail » ne supprime PLUS l'envoi (code ENVOI_DESACTIVE "
        "retiré) ; (2) ADMINISTRATION — acceptation signée (document-acceptation.js) et "
        "(3) refus signé (document-refus.js) — les destinataires sont TOUJOURS complets "
        "(employé « À », RH + manager en Cc, adresses plus jamais retirées par les "
        "interrupteurs). LES 4 INTERRUPTEURS ne gouvernent PLUS QUE LA RÉPONSE PDF : "
        "le document signé et tamponné est joint au SEUL groupe activé (maître ON ET "
        "interrupteur du destinataire ON) ; chaque destinataire exclu reçoit LA MÊME "
        "notification SANS le PDF — au plus DEUX messages (avec PDF, puis sans PDF), "
        "même objet, même corps, mêmes pièces des décideurs, journal par message avec "
        "l'indicateur « reponsePdf ». AUCUN PDF disponible (refus congé/autorisation — "
        "v0.2.188, génération absente, maître OFF) → les drapeaux sont SANS EFFET : tout "
        "le monde reçoit la notification. Cas extrêmes : employé sans adresse e-mail → "
        "la notification part aux copies (RH promu « À », plus JAMAIS bloquant) ; "
        "AUCUNE adresse connue → AUCUN_DESTINATAIRE (seul cas restant). Le panneau "
        "affiche la nouvelle sémantique (maître = « RÉPONSE PDF », note « ne retirent "
        "PLUS personne »). JAMAIS bloquant ; défauts historiques conservés (config "
        "absente = tous activés). Preuve : test v0.2.193 dédié 53/53 OK (traiterAcceptation"
        "Finale et traiterRefus RÉELS sur la vraie base ReponsePdfConfig : tous ON → 1 "
        "message avec PDF ; manager OFF → 2 messages dont le manager SANS PDF ; maître "
        "OFF → 1 message SANS PDF à tout le monde ; fonction portail réelle + code "
        "extrait) ; suites v0.2.179→191 relancées (adaptées à la nouvelle sémantique) — "
        "0 échec ; node --check OK ; build production OK ; panneau vérifié dans le "
        "navigateur."))
    STORY.append(bul(
        "<b>Certificat : bloc d'import masqué pour le rôle RH (v0.2.194)</b> : "
        "DEMANDE UTILISATEUR — « masquer ce bloc pour le role rh dans la section importer "
        "et demande » (capture du bloc « Fichier de certificat de CETTE section »). Le "
        "bloc d'IMPORT du fichier de certificat est désormais caché pour le rôle RH dans "
        "les DEUX sections qui le portent : (1) onglet « Importer » — rubrique "
        "« Certificat de signature électronique » (fiches de paie) : choix du fichier, "
        "mot de passe PKCS#12, clé privée associée, notes « à retirer » / « nouveau "
        "fichier en attente » ; (2) onglet « Demandes » — rubrique « Certificat de "
        "signature électronique (réponses) » : mêmes éléments + avertissements « Aucun "
        "certificat DÉDIÉ importé » et « configuration pas encore enregistrée ». Une "
        "note informe le RH que l'import est réservé au superadministrateur. RESTE "
        "VISIBLE : l'interrupteur d'utilisation du certificat, le positionnement du "
        "bloc (mode certActif) et l'affichage des métadonnées (titulaire, émetteur, "
        "validité, empreinte). SUPERADMIN conserve les blocs complets ; la "
        "configuration enregistrée s'applique quelle que soit la personne qui consulte "
        "(aucun écrasement possible — le champ fichier reste vide côté RH). Même "
        "pattern que ReponsePdfPanel v0.2.186 (prop masquerCertificat) — le RH ne "
        "gère AUCUN matériel cryptographique. AUCUN changement serveur. Preuve : build "
        "production OK ; navigateur RÉEL — RH : blocs absents (texte introuvable dans "
        "les deux onglets) + note affichée ; SUPERADMIN : blocs entiers conservés ; "
        "captures task194-rh-importer.png / task194-rh-demandes.png / "
        "task194-superadmin-demandes.png ; suites v0.2.190→193 relancées 0 échec."))
    STORY.append(bul(
        "<b>Demandes : carte « Décision Manager » masquée pour le rôle RH "
        "(v0.2.195)</b> : DEMANDE UTILISATEUR — « masquer cette partie dans cadre vert "
        "pour role rh dans les demade conge et autorisation » (capture de la carte "
        "« Décision Manager » dans le détail d'une demande de congé). Dans l'onglet "
        "« Demandes », le dialogue de détail des demandes à DEUX étapes (congé et "
        "autorisation de sortie) n'affiche PLUS la carte « Décision Manager » au rôle "
        "RH : le rangée « Enregistrer la décision du manager : Acceptée / Refusée » "
        "(repli opérationnel Task 181) disparaît et une note discrète la remplace — "
        "« Décision du manager : enregistrée par sa réponse e-mail (ou par le "
        "superadministrateur) — son état est affiché dans la section « Décision RH » "
        "ci-dessous ». RIEN n'est perdu pour le RH : l'état de la décision du manager "
        "(badge, date, acteur, formulation) reste visible dans la boîte « ÉTAT "
        "ACTUEL » de la section « Décision RH » (v0.2.154) ET dans la liste des "
        "demandes (badge « M : ») ; les cartes « Décision RH » et « Statut final » "
        "restent affichées ; les boutons propres au RH (« Accepter la demande », "
        "« Refuser la demande », « Information requise ») sont inchangés. Le "
        "SUPERADMIN conserve la carte ENTIÈRE (enregistrement manuel de la décision "
        "du manager toujours possible — repli opérationnel). AFFICHAGE SEUL : AUCUN "
        "changement serveur ni API — la matrice Manager × RH (Task 181) et la "
        "reconnaissance des réponses e-mail restent intactes. Preuve : build "
        "production OK ; navigateur RÉEL — RH : carte absente + note affichée sur "
        "une demande de congé ET une autorisation de sortie, aucun bouton "
        "« Enregistrer la décision du manager » ; SUPERADMIN : carte entière "
        "conservée ; captures task195-rh-demande-conge.png / "
        "task195-rh-demande-autorisation.png / task195-superadmin-demande-conge.png ; "
        "suites v0.2.190→193 relancées : 232 contrôles, 0 échec."))


# ---- Assemblage -------------------------------------------------------------

ENTETE = "AutoRH — Documentation technique et README officiel — édition essentielle " + EDITION


def _pied(canvas, doc):
    canvas.saveState()
    canvas.setFont("Serif", 8)
    canvas.setFillColor(GRIS)
    canvas.drawString(MARGE_G, MARGE_B - 0.45 * cm, ENTETE)
    canvas.drawRightString(LARG - MARGE_D, MARGE_B - 0.45 * cm, "page %d" % doc.page)
    canvas.restoreState()


def _premiere(canvas, doc):
    canvas.saveState()
    canvas.setFont("Serif", 8)
    canvas.setFillColor(GRIS)
    canvas.drawRightString(LARG - MARGE_D, MARGE_B - 0.45 * cm, "page 1")
    canvas.restoreState()


def verifier(pdf_path):
    from pypdf import PdfReader
    lecteur = PdfReader(pdf_path)
    nb = len(lecteur.pages)
    texte_complet = " ".join((lecteur.pages[i].extract_text() or "") for i in range(nb))
    attendus = [
        "V0.2.195", "AutoRH", "ÉDITION ESSENTIELLE",
        "Durée du projet", "31 jours", "12 septembre", "12 octobre 2026",
        "195 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",
        "DÉCISION MANAGER : CARTE MASQUÉE POUR LE RH", "Enregistrer la décision du manager",
        "enregistrée par sa réponse e-mail", "ÉTAT ACTUEL", "DemandesTab",
        "Certificat : bloc d'import masqué pour le rôle RH", "Fichier de certificat de CETTE section",
        "réservé au superadministrateur", "matériel cryptographique", "masquerCertificat",
        "Notifications toujours envoyées — interrupteurs = réponse PDF seulement",
        "interrupteurs = réponse PDF seulement", "ENVOI_DESACTIVE retiré",
        "ne retirent PLUS personne", "SANS le PDF", "au plus DEUX messages",
        "Boutons de gestion toujours accessibles (v0.2.192)", "COLLANTE à droite",
        "colonne Actions du tableau", "sans aucun défilement de colonnes",
        "Interrupteurs e-mail effectifs dans les deux sens", "ENVOI_DESACTIVE",
        "Boutons de gestion toujours accessibles",
        "notification TOUJOURS envoyée", "LA MÊME notification SANS le PDF",
        "CERTIFICAT : IMPORT MASQUÉ POUR LE RH", "réservé au",
        "DÉCISION MANAGER : CARTE MASQUÉE POUR LE RH",
        "40 contrôles dédiés", "520 contrôles", "section non engagée",
        "modèle ReponsePdfConfig absent du client Prisma",
        "Interrupteurs des destinataires respectés", "AUCUN_DESTINATAIRE",
        "41 contrôles dédiés", "319 contrôles", "envoyerEmployeDecision",
        "le manager désactivé ne reçoit plus la décision ni le PDF",
        "PDF de réponse automatique simplifié",
        "39 contrôles", "553 contrôles", "Décisionfinale", "Demande créée le",
        "l'auteur de la décision n'est plus montré",
        "sans aucun acteur",
        "Refus sans PDF — notification e-mail avec les pièces jointes",
        "49 contrôles", "486 contrôles", "pdfRefusDesactive", "piecesJointesNotificationRefus",
        "AUCUN PDF de refus n'est généré ni envoyé",
        "l'ENSEMBLE des fichiers concernés part à l'employé dans le mail de notification",
        "Parrainage — aucune notification de refus au service RH",
        "30 contrôles", "460 contrôles", "exclut désormais", "Task 181",
        "Règle d'affichage du refus", "« Refusée » sans acteur", "ni le département ni le manager",
        "58 contrôles", "503 contrôles", "est désormais : Refusée",
        "Certificat dédié masqué pour le rôle RH", "certificat dédié à cette section",
        "masquerCertificat", "60 contrôles",
        "CERTIFICAT DÉDIÉ MASQUÉ POUR LE RH", "import .p12/.pfx, interrupteur, signataire",
        "Expressions de décision reconnues par réponse e-mail", "Tableau 2.1",
        "J'accepte votre demande", "D'accord", "Je vous accorde",
        "Acceptée", "Validée", "Approuvée", "Accordée", "Délivrée",
        "Je refuse", "Désaccord", "Pas d'accord", "Hors de question", "Refusée",
        "Je ne valide pas", "Je n'accepte pas", "Je ne peux pas accepter",
        "Documents du responsable avec la décision de parrainage",
        "Le responsable de votre demande", "traitée par le responsable concerné",
        "Expressions reconnues pour les attestations et le parrainage",
        "ATTESTATION DE TRAVAIL", "ATTESTATION DE SALAIRE", "TYPES_CLASSIFICATION_AUTO",
        "J'accepte votre demande", "Je vous accorde", "Délivrée", "Refusée",
        "Hors de question", "Je ne peux pas accepter", "144 contrôles",
        "62 contrôles",
        "Confidentialité de la décision", "les réponses du manager ET du service RH",
        "Parrainage par e-mail", "VALIDATION PAR E-MAIL",
        "Réponse automatique PDF désactivée", "reponseAutoPdf", "desactivee",
        "Pièces jointes du RH avec la décision", "documentsRhTransmis", "documents joints",
        "Affichage des demandes", "cadre vert",
        "Pièces jointes du manager et des RH à toutes les étapes",
        "notificationEtapeIntermediaire", "Document(s) transmis avec la",
        "Elle poursuit son circuit de validation habituel", "445 contrôles",
        "VALABLE 15 MINUTES", "mot de passe initial", "15 minutes",
        "MANAGER RESPONSABLE", "v0.2.129", "v0.2.132", "v0.2.168", "v0.2.172", "v0.2.173",
        "v0.2.175", "v0.2.176", "v0.2.177", "v0.2.178", "v0.2.179", "v0.2.180", "v0.2.181",
        "v0.2.182", "v0.2.183", "v0.2.184", "v0.2.185", "v0.2.186", "v0.2.187", "v0.2.188",
        "v0.2.189", "v0.2.190", "v0.2.191",
        "DEUX ÉTAPES", "Refusée par le Manager", "Refusée par les RH",
        "Matrice des droits", "PAdES", "API de certification",
        "AES-256-GCM", "PAIESAGE1", "DEM-AAAA-NNNNN",
        "AUTO_RH_STORAGE_KEY", "portail-server.js", "port 4000", "port 4001",
        "Tableau 1.1", "Tableau 4.1", "Tableau 4.2", "Tableau 4.3", "Tableau 5.1",
        "Mise en service rapide", "Erreur 405", "42/42", "17/17",
    ]
    sans_espaces = "".join(texte_complet.split())
    manquants = [a for a in attendus
                 if a not in texte_complet
                 and "".join(a.split()) not in sans_espaces]
    assert not manquants, "texte manquant dans le PDF : %s" % manquants
    return nb


def md5f(p_):
    return hashlib.md5(open(p_, "rb").read()).hexdigest()


def main():
    pdf_dl = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.195.pdf")
    doc = SimpleDocTemplate(
        pdf_dl, pagesize=A4,
        leftMargin=MARGE_G, rightMargin=MARGE_D,
        topMargin=MARGE_H, bottomMargin=MARGE_B,
        title="AutoRH — README officiel — édition essentielle v0.2.191",
        author="AutoRH",
        subject="Documentation essentielle : fiches de paie, demandes administratives, durée du projet",
        creator="AutoRH",
    )
    page_couverture()
    section_1()
    section_2()
    section_3()
    section_4()
    section_5()
    annexe()
    doc.build(STORY, onFirstPage=_premiere, onLaterPages=_pied)

    nb = verifier(pdf_dl)
    cibles = [
        pdf_dl,
        os.path.join(RACINE, "download", "servicerh-readme-technique.pdf"),
        os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.195.pdf"),
        os.path.join(RACINE, "download", "servicerh-readme-technique-reduit.pdf"),
        os.path.join(RACINE, "download", "auto-rh-readme-technique.pdf"),
        os.path.join(RACINE, "servicerh-readme-technique.pdf"),
        os.path.join(RACINE, "servicerh-readme-technique-reduit.pdf"),
        os.path.join(RACINE, "auto-rh-readme-technique.pdf"),
    ]
    for c in cibles:
        if os.path.abspath(c) != os.path.abspath(pdf_dl):
            shutil.copy2(pdf_dl, c)
    print("OK : édition essentielle %s — %d pages (tous les marqueurs de contrôle présents)." % (EDITION, nb))
    for c in cibles:
        print("  %s — %d octets — md5 %s" % (c, os.path.getsize(c), md5f(c)))


if __name__ == "__main__":
    main()
