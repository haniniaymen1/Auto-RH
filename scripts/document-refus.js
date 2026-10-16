/**
 * ============================================================================
 *  NOUVEAU (Task 180) — DOCUMENT DE REFUS SIGNÉ ÉLECTRONIQUEMENT ET TAMPONNÉ
 *  (toutes les demandes : congé, autorisation de sortie, attestation de
 *  travail, attestation de salaire, parrainage)
 * ============================================================================
 *  Demande utilisateur : « Dans le portail administratif, au niveau de la
 *  gestion de toutes les demandes, l'administrateur et le service RH doivent
 *  pouvoir consulter le contenu du document associé à chaque demande,
 *  y compris les documents générés à la suite d'une acceptation OU D'UN
 *  REFUS » — avec une distinction claire entre la réponse en cas
 *  d'acceptation, la réponse en cas de refus, les pièces jointes associées,
 *  le statut final et le document généré à la suite de la décision.
 *
 *  MODULE PARTAGÉ (JavaScript pur, CommonJS) — utilisé par DEUX serveurs :
 *   - l'ADMINISTRATION (4000, Next.js) via src/lib/doc-signe.ts :
 *       POST /api/demandes/[id] (décision RH Refusée),
 *       POST /api/demandes/[id]/doc-refus (génération / renvoi manuel) ;
 *   - le PORTAIL employé (4001, scripts/portail-server.js) :
 *       traiterMessageRecu (Task 178) — REFUS reconnu dans la réponse e-mail.
 *
 *  PIPELINE (traiterRefus) — jumeau de traiterAcceptationFinale :
 *   1. contrôle (TOUS types, statut REFUSEE, docActif, idempotence
 *      docRefusChemin sauf `forcer`) ;
 *   2. résolution du contexte (réutilise resoudreContexte du module
 *      d'acceptation : identité, CIN, matricule, e-mails, jours/heures) ;
 *   3. génération du PDF A4 « DÉCISION DE REFUS » (toutes les informations
 *      + MOTIF DU REFUS — adaptation automatique à la longueur du motif) ;
 *   4. TAMpon : paraphe + cachet + mention (tamponnerDocument, partagé) ;
 *   5. SIGNATURE ÉLECTRONIQUE par le certificat configuré (signerPdf,
 *      partagé — raison « Décision Refusée — REF ») ;
 *   6. stockage CHIFFRÉ (storage/documents-demandes/) + DocumentDemande
 *      relié (recuDe = « Génération automatique (document de refus) ») —
 *      visible dans la gestion des demandes ET « Mes demandes » du portail ;
 *   7. mise à jour de la demande (docRefus*) ;
 *   8. e-mail AUTOMATIQUE : employé (À) + service RH + manager (Cc) avec le
 *      PDF signé en pièce jointe — JAMAIS bloquant (échec tracé).
 *
 *  DÉPENDANCES INJECTÉES (opts) — identiques au module d'acceptation.
 * ============================================================================
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

/* Moteur partagé : dessin, tampon, signature, contexte, configuration. */
const acceptation = require('./document-acceptation.js');

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** (Task 180) le document de REFUS concerne TOUS les types de demandes —
 *  « toutes les demandes » : congé, autorisation, attestations, parrainage. */
const TYPES_REFUS = [
  'CONGE',
  'AUTORISATION_SORTIE',
  'ATTESTATION_TRAVAIL',
  'ATTESTATION_SALAIRE',
  'PARRAINAGE',
];

const STATUT_REFUS = 'REFUSEE';

const RECUPERATION_AUTO_REFUS = 'Génération automatique (document de refus)';

const LIBELLES_TYPE_REFUS = {
  CONGE: 'Demande de congé',
  AUTORISATION_SORTIE: 'Autorisation de sortie',
  ATTESTATION_TRAVAIL: 'Attestation de travail',
  ATTESTATION_SALAIRE: 'Attestation de salaire',
  PARRAINAGE: 'Demande de parrainage',
};

/** Suffixe de fichier lisible par type. */
const SLUG_TYPE = {
  CONGE: 'conge',
  AUTORISATION_SORTIE: 'autorisation_sortie',
  ATTESTATION_TRAVAIL: 'attestation_travail',
  ATTESTATION_SALAIRE: 'attestation_salaire',
  PARRAINAGE: 'parrainage',
};

/** Sujet e-mail par défaut (variables {REF} {TYPE} {EMPLOYE} {CIN} {STATUT}
 *  {JOURS} {HEURES} {MANAGER} {DATE} — mêmes règles que l'acceptation). */
const OBJET_REFUS_DEFAUT =
  'Votre {TYPE} — {REF} : refusée — décision signée et tamponnée';

/* Palette ROUGE du document de refus. */
const ROUGE = rgb(0.77, 0.12, 0.12);
const ROUGE_FONCE = rgb(0.55, 0.08, 0.08);
const ROUGE_BANDEAU = rgb(0.80, 0.13, 0.13);
const ROUGE_BANDEAU_BORD = rgb(0.55, 0.08, 0.08);
const ZEBRE_NEUTRE = rgb(0.957, 0.949, 0.953);
const FILET_NEUTRE = rgb(0.86, 0.86, 0.89);
const FOND_MOTIF = rgb(0.995, 0.945, 0.945);
const BORD_MOTIF = rgb(0.91, 0.70, 0.70);
const ENCRE = rgb(0.09, 0.13, 0.19);

/* Géométrie (identique au document d'acceptation). */
const A4 = acceptation.A4;
const MARGE = acceptation.MARGE;

/* ------------------------------------------------------------------ */
/* Contexte                                                            */
/* ------------------------------------------------------------------ */

/**
 * Contexte du document de refus : réutilise TOUTES les informations résolues
 * par le module d'acceptation (identité via resoudreIdentite, e-mails,
 * jours/heures, manager…) puis adapte les champs propres au refus :
 * statutFinal « Refusée », libellé du type (tous types), MOTIF (le
 * commentaire de DÉCISION posé par le RH / manager — demande.commentaire).
 */
async function resoudreContexteRefus(prisma, demande, cfg, opts) {
  const ctx = await acceptation.resoudreContexte(prisma, demande, cfg, opts);
  ctx.statutFinal = 'Refusée';
  ctx.typeLibelle = LIBELLES_TYPE_REFUS[demande.type] || demande.type;
  ctx.motifRefus = String(demande.commentaire || '').trim();
  return ctx;
}

/**
 * Lignes [libellé, valeur] du DÉTAIL pour le PDF de refus — version compacte
 * (les heures de sortie/retour sont regroupées sur une ligne) : le motif du
 * refus est le contenu essentiel du document, la mise en page lui réserve
 * l'espace restant (le PDF d'acceptation garde SA présentation d'origine).
 */
function lignesDetailRefus(ctx) {
  const d = ctx.donnees;
  const v = (k) => String(d[k] == null ? '' : d[k]).trim();
  if (ctx.type === 'CONGE') {
    const jours = ctx.jours != null
      ? ctx.jours + ' jour' + (ctx.jours > 1 ? 's' : '')
      : '—';
    return [
      ['Type de congé', v('typeConge') || '—'],
      ['Période', formatDatePeriode(v('dateDebut'), v('dateFin'))],
      ['Nombre de jours', jours],
    ];
  }
  if (ctx.type === 'ATTESTATION_TRAVAIL' || ctx.type === 'ATTESTATION_SALAIRE') {
    return [
      ...(v('nom') ? [['Nom', v('nom')]] : []),
      ...(v('prenom') ? [['Prénom', v('prenom')]] : []),
    ];
  }
  if (ctx.type === 'PARRAINAGE') {
    return [
      ...(v('nomParrain') ? [['Parrain', v('nomParrain')]] : []),
      ...(v('nomFilleul') ? [['Filleul', v('nomFilleul')]] : []),
      ...(v('dateParrainage')
        ? [['Date du parrainage', acceptation.formatDateSimple(v('dateParrainage'))]]
        : []),
      ...(v('operation') ? [['Opération / Hiérarchie', v('operation')]] : []),
    ];
  }
  // AUTORISATION_SORTIE (et type inconnu : champs génériques utiles)
  const sortieRetour = [v('heureSortie'), v('heureRetour')].filter(Boolean).join(' \u2192 ');
  return [
    ['Date', acceptation.formatDateSimple(v('date')) || '—'],
    ['Département', v('departement') || '—'],
    ['Motif de la demande', v('motif') || '—'],
    ['Nombre d\'heures', ctx.heures ? ctx.heures + ' heure(s)' : '—'],
    ...(sortieRetour ? [['Sortie / Retour', sortieRetour]] : []),
  ];
}

function formatDatePeriode(debut, fin) {
  const d = acceptation.formatDateSimple(debut) || '—';
  const f = acceptation.formatDateSimple(fin) || '—';
  return d === f ? d : d + '  au  ' + f;
}

/* ------------------------------------------------------------------ */
/* GÉNÉRATION DU PDF « DÉCISION DE REFUS » (une page, motif adaptatif)  */
/* ------------------------------------------------------------------ */

/* Repères de mise en page (calculés pour finir AU-DESSUS de la zone de
 * signature — divider à 210 pts, contenu jamais sous 216 pts). */
const Y_TITRE = A4.H - 92;
const Y_CONTENU_DEBUT = Y_TITRE - 19 - 30 - 26; // titre, bandeau
const Y_CONTENU_MIN = 216;
const HAUTEUR_LIGNE = 17; // lignes de table (compactées)
const HAUTEUR_TITRE_SECTION = 23;
const GAP_SECTION = 8;
const INTERLIGNE_MOTIF = 12.5;

/** Palette commune passée aux helpers partagés. */
const PALETTE_REFUS = {
  barre: ROUGE,
  texte: ROUGE_FONCE,
  zebre: ZEBRE_NEUTRE,
  filet: FILET_NEUTRE,
  hauteurLigne: HAUTEUR_LIGNE,
};

/** Hauteur d'une ligne de table (MÊME règle que dessinerTable partagé). */
function hauteurLigneTable(paire, police, largeurUtile) {
  const largeurLabel = 190;
  const valeurs = acceptation
    .couperTexte(acceptation.winAnsi(paire[1]), police, 10, largeurUtile - largeurLabel - 16);
  return Math.max(HAUTEUR_LIGNE, valeurs.length * 13 + 7);
}

/**
 * Planifie la mise en page AVANT tout dessin : détermine combien de lignes
 * du motif tiennent au-dessus de la zone de signature (garantie : 2 lignes
 * minimum — le texte est tronqué avec « … » si nécessaire, le motif complet
 * reste consultable dans la demande). Déterministe : aucune surprise.
 */
function planifierMotif(ctx, police, largeurUtile) {
  const brut = String(ctx.motifRefus || '').trim();
  // (MODIFIÉ v0.2.189 — DEMANDE UTILISATEUR) « Décision rendue par »
  // SUPPRIMÉE (l'auteur de la décision n'est plus montré) ; la date de la
  // demande (« Demande créée le … ») est conservée. Même simplification que
  // le document d'acceptation — appliquée à TOUS les PDF de réponse
  // automatique.
  const lignesInfo = [
    ['Référence unique', ctx.reference],
    ['Type de demande', ctx.typeLibelle],
    ['Statut final', 'Refusée'],
    ['Date de la demande', ctx.dateDemande],
    ['Date de la décision', ctx.dateDecision],
  ];
  const lignesIdentite = [
    ['Nom et prénom', ctx.nomEmploye || '—'],
    ['CIN', ctx.cin || '—'],
    ['Matricule', ctx.matricule || '—'],
    ['Adresse e-mail', ctx.emailEmploye || '—'],
  ];
  const lignesDetail = lignesDetailRefus(ctx);
  // (MODIFIÉ v0.2.189 — DEMANDE UTILISATEUR) section « Manager / responsable »
  // SUPPRIMÉE ENTIÈREMENT : le nom et l'e-mail du manager ne sont plus montrés
  // dans le PDF (ils restent disponibles pour les e-mails et la traçabilité).
  const ligneManager = null;

  // Hauteur fixe (sections hors motif) — MÊME séquence que le dessin.
  let fixe = 0;
  fixe += HAUTEUR_TITRE_SECTION; // Informations de la demande
  for (const l of lignesInfo) fixe += hauteurLigneTable(l, police, largeurUtile);
  fixe += GAP_SECTION;
  fixe += HAUTEUR_TITRE_SECTION; // Motif du refus (bloc dessiné à part)
  fixe += GAP_SECTION;
  fixe += HAUTEUR_TITRE_SECTION; // Identité
  for (const l of lignesIdentite) fixe += hauteurLigneTable(l, police, largeurUtile);
  fixe += GAP_SECTION;
  fixe += HAUTEUR_TITRE_SECTION; // Détail
  for (const l of lignesDetail) fixe += hauteurLigneTable(l, police, largeurUtile);
  if (ligneManager) {
    fixe += GAP_SECTION;
    fixe += HAUTEUR_TITRE_SECTION; // Manager
    fixe += hauteurLigneTable(ligneManager[0], police, largeurUtile);
  }

  // Espace du bloc motif : hauteur disponible entre le début et Y_MIN.
  const dispoMotif = (Y_CONTENU_DEBUT - Y_CONTENU_MIN) - fixe - 10 /*marges du bloc*/;
  const maxLignes = Math.max(2, Math.floor(dispoMotif / INTERLIGNE_MOTIF));

  let lignesMotif;
  if (!brut) {
    lignesMotif = [
      'Aucun motif complémentaire n\'a été précisé par le service traitant.',
    ];
  } else {
    lignesMotif = acceptation.couperTexte(brut, police, 10, largeurUtile - 28);
    if (lignesMotif.length > maxLignes) {
      // re-coupe un texte raccourci, puis ellipse sur la dernière ligne
      const approximation = Math.max(20, maxLignes * 72);
      let raccourci = brut.slice(0, approximation).replace(/\s+\S*$/, '');
      lignesMotif = acceptation
        .couperTexte(raccourci + ' …', police, 10, largeurUtile - 28)
        .slice(0, maxLignes);
      while (lignesMotif.length > maxLignes) lignesMotif.pop();
      if (lignesMotif.length) {
        lignesMotif[lignesMotif.length - 1] =
          lignesMotif[lignesMotif.length - 1].replace(/(\s*…\s*)$/, '') + ' …';
      }
    }
  }
  return { lignesInfo, lignesIdentite, lignesDetail, ligneManager, lignesMotif };
}

/**
 * Génère le PDF A4 de la DÉCISION DE REFUS (une page) : en-tête, bandeau
 * « STATUT FINAL : REFUSÉE », informations de la demande (sans « Décision
 * rendue par » — v0.2.189), MOTIF DU REFUS (bloc encadré rouge, adapté à la
 * longueur), identité de l'employé (nom, CIN, matricule, e-mail), détail
 * (jours / heures…), bloc signature/tampon réservé, mention et pied de page
 * (la section « Manager / responsable » est SUPPRIMÉE depuis la v0.2.189).
 */
async function genererPdfRefus(ctx, cfg) {
  const doc = await PDFDocument.create();
  doc.setTitle('Décision de refus — ' + ctx.reference);
  doc.setSubject(ctx.typeLibelle + ' — statut final : Refusée');
  doc.setProducer('Auto-RH');
  doc.setCreator('Auto-RH — Portail RH');
  const page = doc.addPage([A4.L, A4.H]);
  const police = await doc.embedFont(StandardFonts.Helvetica);
  const policeGras = await doc.embedFont(StandardFonts.HelveticaBold);
  const largeurUtile = A4.L - MARGE * 2;

  // ---- En-tête (marque Auto-RH, identique à l'acceptation) ----
  page.drawRectangle({ x: 0, y: A4.H - 64, width: A4.L, height: 64, color: rgb(0.024, 0.712, 0.529) });
  page.drawText('Auto-RH', { x: MARGE, y: A4.H - 38, size: 20, font: policeGras, color: rgb(1, 1, 1) });
  page.drawText('Gestion administrative du personnel', { x: MARGE, y: A4.H - 54, size: 9, font: police, color: rgb(0.88, 0.98, 0.94) });
  const refTexte = 'Réf. ' + ctx.reference;
  page.drawText(refTexte, {
    x: A4.L - MARGE - policeGras.widthOfTextAtSize(refTexte, 11), y: A4.H - 38,
    size: 11, font: policeGras, color: rgb(1, 1, 1),
  });

  // ---- Titre ----
  let y = Y_TITRE;
  const titre = 'DÉCISION DE REFUS';
  const tailleTitre = 19;
  page.drawText(titre, {
    x: (A4.L - policeGras.widthOfTextAtSize(titre, tailleTitre)) / 2, y,
    size: tailleTitre, font: policeGras, color: ENCRE,
  });
  y -= 19;
  const sousTitre = ctx.typeLibelle + ' — statut final : REFUSÉE';
  page.drawText(sousTitre, {
    x: (A4.L - police.widthOfTextAtSize(sousTitre, 11.5)) / 2, y,
    size: 11.5, font: police, color: rgb(0.29, 0.35, 0.41),
  });

  // ---- Bandeau statut final (ROUGE) ----
  y -= 30;
  const texteStatut = 'STATUT FINAL : REFUSÉE';
  const largeurStatut = policeGras.widthOfTextAtSize(texteStatut, 12) + 44;
  page.drawRectangle({
    x: (A4.L - largeurStatut) / 2, y: y - 6, width: largeurStatut, height: 24,
    color: ROUGE_BANDEAU, borderColor: ROUGE_BANDEAU_BORD, borderWidth: 1,
  });
  page.drawText(texteStatut, {
    x: (A4.L - policeGras.widthOfTextAtSize(texteStatut, 12)) / 2, y: y,
    size: 12, font: policeGras, color: rgb(1, 1, 1),
  });
  y -= 26;

  // ---- Planification (le motif s'adapte, le contenu finit ≥ 216 pts) ----
  const plan = planifierMotif(ctx, police, largeurUtile);

  // ---- Informations de la demande ----
  y = acceptation.dessinerTitreSection(page, policeGras, 'Informations de la demande', y, largeurUtile, PALETTE_REFUS);
  y = acceptation.dessinerTable(page, police, policeGras, plan.lignesInfo, y, largeurUtile, PALETTE_REFUS);
  y -= GAP_SECTION;

  // ---- Motif du refus (bloc encadré) ----
  y = acceptation.dessinerTitreSection(page, policeGras, 'Motif du refus', y, largeurUtile, PALETTE_REFUS);
  const hauteurBloc = plan.lignesMotif.length * INTERLIGNE_MOTIF + 14;
  page.drawRectangle({
    x: MARGE, y: y - hauteurBloc, width: largeurUtile, height: hauteurBloc,
    color: FOND_MOTIF, borderColor: BORD_MOTIF, borderWidth: 0.8,
  });
  plan.lignesMotif.forEach((l, i) => {
    page.drawText(l, {
      x: MARGE + 12, y: y - 15 - i * INTERLIGNE_MOTIF, size: 10,
      font: police, color: ROUGE_FONCE,
    });
  });
  y -= hauteurBloc + GAP_SECTION;

  // ---- Identité de l'employé ----
  y = acceptation.dessinerTitreSection(page, policeGras, 'Identité de l\'employé', y, largeurUtile, PALETTE_REFUS);
  y = acceptation.dessinerTable(page, police, policeGras, plan.lignesIdentite, y, largeurUtile, PALETTE_REFUS);
  y -= GAP_SECTION;

  // ---- Détail de la demande ----
  if (plan.lignesDetail.length) {
    y = acceptation.dessinerTitreSection(page, policeGras, 'Détail de la demande', y, largeurUtile, PALETTE_REFUS);
    y = acceptation.dessinerTable(page, police, policeGras, plan.lignesDetail, y, largeurUtile, PALETTE_REFUS);
    y -= GAP_SECTION;
  }

  // (MODIFIÉ v0.2.189 — DEMANDE UTILISATEUR) section « Manager / responsable »
  // SUPPRIMÉE : le nom et l'e-mail du manager ne sont PLUS dessinés dans le
  // PDF de refus (règle commune à tous les PDF de réponse automatique) ;
  // plan.ligneManager est toujours null — plus aucune section ici.

  // ---- Bloc signature / tampon (ZONE RÉSERVÉE — identique à l'acceptation) ----
  page.drawLine({
    start: { x: MARGE, y: 210 }, end: { x: MARGE + largeurUtile, y: 210 },
    thickness: 0.8, color: rgb(0.86, 0.86, 0.89),
  });
  const xBloc = A4.L - MARGE - 230;
  page.drawText('Fait le ' + acceptation.formatFr(new Date()), {
    x: xBloc, y: 178, size: 10, font: police, color: rgb(0.29, 0.35, 0.41),
  });
  const signataire = cfg.certSignataire || 'Le service RH';
  const fonction = cfg.certFonction || '';
  page.drawText(acceptation.winAnsi(signataire), {
    x: xBloc, y: 162, size: 11, font: policeGras, color: ENCRE,
  });
  let yNote = 144;
  if (fonction) {
    const fonctionLignes = acceptation.couperTexte(acceptation.winAnsi(fonction), police, 9.5, 222);
    fonctionLignes.slice(0, 2).forEach((l, i) => {
      page.drawText(l, {
        x: xBloc, y: 148 - i * 11, size: 9.5, font: police, color: rgb(0.29, 0.35, 0.41),
      });
    });
    yNote = 148 - Math.min(2, fonctionLignes.length) * 11 - 2;
  }
  // (v0.2.149) notes du bloc HOMOGÈNES aux interrupteurs — le texte
  // n'annonce plus « signé (certificat) » quand la signature électronique est
  // désactivée ou sans certificat importé, ni « tamponné » quand le tampon
  // est désactivé (même discipline que le document d'acceptation).
  const notesBloc = [];
  if (cfg.signerActif !== false && String(cfg.certChemin || '').trim()) {
    notesBloc.push('Document signé électroniquement (certificat)');
  }
  if (cfg.tamponActif !== false) notesBloc.push('Tampon appliqué automatiquement');
  else if (cfg.docSigActif !== false) notesBloc.push('Paraphe appliqué automatiquement');
  if (!notesBloc.length) notesBloc.push('Document validé par le service RH');
  notesBloc.slice(0, 2).forEach((t, i) => {
    page.drawText(t, {
      x: xBloc, y: yNote - i * 10, size: 8.5, font: police, color: rgb(0.42, 0.48, 0.54),
    });
  });

  // ---- Mention légale + pied de page ----
  // (v0.2.149) interrupteur mentionActif RESPECTÉ (comme le document
  // d'acceptation) — défaut : ON. Défaut de l'itération initiale : la mention
  // était imprimée MÊME désactivée (signalé par le test Task 193).
  if (cfg.mentionActif !== false) {
  const mentionBrute = String(cfg.docMention || '').replace(/\{DATE\}/g, acceptation.formatFr(new Date()));
  const mentionLignes = acceptation.couperTexte(acceptation.winAnsi(mentionBrute), police, 8.5, largeurUtile);
  let yMention = 30;
  for (const ligne of mentionLignes) {
    page.drawText(ligne, {
      x: (A4.L - police.widthOfTextAtSize(ligne, 8.5)) / 2, y: yMention,
      size: 8.5, font: police, color: rgb(0.42, 0.48, 0.54),
    });
    yMention -= 10.5;
  }
  }
  page.drawText('Document généré automatiquement par Auto-RH — portail d\'administration', {
    x: (A4.L - police.widthOfTextAtSize('Document généré automatiquement par Auto-RH — portail d\'administration', 7.5)) / 2,
    y: 12, size: 7.5, font: police, color: rgb(0.58, 0.63, 0.68),
  });

  return Buffer.from(await doc.save());
}

/* ------------------------------------------------------------------ */
/* GÉNÉRATION COMPLÈTE (PDF + tampon + signature)                      */
/* ------------------------------------------------------------------ */

/**
 * Génère le document de refus (SANS effet de bord) : PDF + tampon partagé
 * (paraphe + cachet + mention) + signature par certificat (si configuré).
 * Renvoie { pdf, ctx, elements, signatureCrypto }.
 */
async function genererDocumentRefus(prisma, demande, cfg, opts) {
  const ctx = await resoudreContexteRefus(prisma, demande, cfg, opts);
  ctx.cfg = cfg;
  // 1) PDF de base
  let pdf = await genererPdfRefus(ctx, cfg);
  // 2) tampon UNIFIÉ (v0.2.143) : paraphe + cachet + QR + cachet électronique
  //    — même logique/paramètres/positionnement que les fiches de paie
  //    (v0.2.147 : elec renvoyé pour les avertissements)
  const { doc, elements, elec } = await acceptation.tamponnerDocument(pdf, cfg, { prisma, ctx, demande });
  pdf = Buffer.from(await doc.save());
  // 3) signature électronique par certificat (si configurée ET activée —
  //    v0.2.145 : interrupteur signerActif de la section dédiée, défaut ON =
  //    continuité) — appliquée EN DERNIER, après la génération complète du
  //    document et l'ajout éventuel du paraphe, du tampon et du cachet ;
  //    source MODULE (LE MÊME certificat que les fiches) ou DEDIE (repli
  //    historique / section dédiée)
  let signatureCrypto = false;
  let certificatUtilise = null;
  if (cfg.signerActif !== false) {
    const certificat = await acceptation.lireCertificat(cfg, opts, prisma);
    if (certificat) {
      pdf = await acceptation.signerPdf(pdf, certificat, ctx);
      signatureCrypto = true;
      certificatUtilise = certificat;
      elements.push('certificat');
    }
  }
  // 4) (v0.2.147) avertissements EXPLICITES quand un élément activé n'a pas
  //    pu être appliqué faute de certificat (signature sautée, cachet absent)
  const avertissements = acceptation.avertissementsCertificat(cfg, certificatUtilise, elec);
  return { pdf, ctx, elements, signatureCrypto, avertissements };
}

/** Nom de fichier affiché du document de refus. */
function nomFichierRefus(ctx) {
  const slug = SLUG_TYPE[ctx.type] || String(ctx.type || 'demande').toLowerCase();
  return 'Refus_' + slug + '_' + ctx.reference + '.pdf';
}

/* ------------------------------------------------------------------ */
/* E-MAIL AUTOMATIQUE (employé À — RH + manager Cc)                    */
/* ------------------------------------------------------------------ */

function corpsDefautTexteRefus(ctx, options) {
  // (v0.2.193) variante SANS PDF quand options.avecPdf === false (la
  // notification de refus part toujours ; seule la pièce jointe varie).
  const avecPdf = !options || options.avecPdf !== false;
  const duree = ctx.type === 'CONGE'
    ? (ctx.jours != null ? '  Durée                     : ' + ctx.jours + ' jour(s)\n' : '')
    : (ctx.heures ? '  Durée                     : ' + ctx.heures + ' heure(s)\n' : '');
  const motif = ctx.motifRefus
    ? '\n  Motif                     : ' + ctx.motifRefus.slice(0, 400) + '\n'
    : '';
  return [
    'Bonjour,',
    '',
    'Votre ' + ctx.typeLibelle.toLowerCase() + ' a été REFUSÉE.',
    '',
    '  Référence                  : ' + ctx.reference,
    '  Type de demande            : ' + ctx.typeLibelle,
    '  Employé                    : ' + (ctx.nomEmploye || 'CIN ' + ctx.cin),
    '  Statut final               : Refusée',
    duree + motif,
    ...(avecPdf ? [
      'La décision officielle correspondante — SIGNÉE ÉLECTRONIQUEMENT et',
      'TAMPONNÉE — est jointe au présent e-mail (fichier PDF) et conservée dans',
      'votre portail, rubrique « Mes demandes » (boutons Visualiser et Télécharger).',
    ] : [
      'La décision officielle correspondante est conservée dans votre portail,',
      'rubrique « Mes demandes » (boutons Visualiser et Télécharger).',
    ]),
    '',
    'Pour toute question, rapprochez-vous du service RH.',
    '',
    'Cet e-mail a été envoyé automatiquement par Auto-RH au service RH et au',
    'manager / responsable concerné. Si vous n\'êtes pas le destinataire prévu,',
    'ignorez et supprimez ce message.',
  ].join('\n');
}

function corpsDefautHtmlRefus(ctx, options) {
  // (v0.2.193) variante SANS PDF quand options.avecPdf === false.
  const avecPdf = !options || options.avecPdf !== false;
  const ligne = (l, v) =>
    '<tr><td style="padding:6px 14px;color:#475569;font-size:13px;white-space:nowrap;">' + acceptation.echappeHtml(l) + '</td>' +
    '<td style="padding:6px 14px;"><b style="color:#0f172a;">' + acceptation.echappeHtml(v) + '</b></td></tr>';
  const duree = ctx.type === 'CONGE'
    ? (ctx.jours != null ? ligne('Durée', ctx.jours + ' jour(s)') : '')
    : (ctx.heures ? ligne('Durée', ctx.heures + ' heure(s)') : '');
  const motifLigne = ctx.motifRefus ? ligne('Motif du refus', ctx.motifRefus.slice(0, 400)) : '';
  return '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">' +
    '<div style="background:#b91c1c;padding:18px 22px;color:#fff;">' +
    '<div style="font-size:18px;font-weight:700;">Votre demande est refusée — ' + acceptation.echappeHtml(ctx.typeLibelle) + '</div>' +
    '<div style="font-size:12px;opacity:.85;margin-top:4px;">Référence ' + acceptation.echappeHtml(ctx.reference) + (avecPdf ? ' — décision signée en pièce jointe' : '') + '</div>' +
    '</div>' +
    '<div style="padding:20px 22px;color:#334155;font-size:14px;">' +
    '<p style="margin:0 0 14px;">Bonjour,</p>' +
    '<p style="margin:0 0 14px;">Votre <b>' + acceptation.echappeHtml(ctx.typeLibelle.toLowerCase()) + '</b> a été <b style="color:#b91c1c;">REFUSÉE</b>. ' +
    (avecPdf
      ? 'La décision officielle correspondante, <b>signée électroniquement et tamponnée</b>, est jointe à cet e-mail (fichier PDF).'
      : 'La décision officielle correspondante est disponible dans votre portail, rubrique « Mes demandes » (la réponse PDF n\'est pas jointe à cet e-mail).') + '</p>' +
    '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 0;margin-bottom:14px;">' +
    '<table style="border-collapse:collapse;width:100%;">' +
    ligne('Référence unique', ctx.reference) +
    ligne('Type de demande', ctx.typeLibelle) +
    ligne('Employé', ctx.nomEmploye || 'CIN ' + ctx.cin) +
    (ctx.matricule ? ligne('Matricule', ctx.matricule) : '') +
    ligne('Statut final', 'Refusée') +
    duree +
    motifLigne +
    '</table></div>' +
    '<p style="margin:0 0 14px;color:#475569;">La décision est également disponible dans votre portail, ' +
    'rubrique <b>« Mes demandes »</b> (boutons Visualiser et Télécharger). Pour toute question, ' +
    'rapprochez-vous du service RH.</p>' +
    '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail envoyé automatiquement par Auto-RH au service RH et au ' +
    'manager / responsable concerné. Si vous n\'êtes pas le destinataire prévu, ignorez et supprimez ce message.</p>' +
    '</div></div>';
}

/** Construit le message e-mail du document de refus (l'appelant l'envoie via
 *  SON transport SMTP — opts.envoyerMail — et journalise). */
function construireEmailDocumentRefus(ctx, cfg, destinataires, nomFichier, pdfOctets, options) {
  // (NOUVEAU v0.2.193) options.avecPdf !== false → le PDF de refus est JOINT
  // (historique) ; false → message SANS pièce jointe — la notification de
  // refus part quand même (les interrupteurs ne gouvernent que le PDF).
  const avecPdf = !options || options.avecPdf !== false;
  const variables = acceptation.variablesContexte(ctx);
  const sujet = acceptation.remplirVariables(OBJET_REFUS_DEFAUT, variables);
  const corpsPerso = String((cfg && cfg.docEmailCorps) || '').trim();
  const texte = corpsPerso
    ? corpsPerso + '\n\n' + referenceAutomatiqueRefus(ctx, { avecPdf })
    : corpsDefautTexteRefus(ctx, { avecPdf });
  const html = corpsPerso
    ? '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;">' +
      '<div style="background:#b91c1c;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-size:16px;font-weight:700;">' +
      acceptation.echappeHtml(ctx.typeLibelle) + ' — ' + acceptation.echappeHtml(ctx.reference) + ' : refusée</div>' +
      '<div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:18px 20px;white-space:pre-wrap;color:#334155;font-size:14px;">' +
      acceptation.echappeHtml(corpsPerso) + '</div>' +
      '<p style="color:#94a3b8;font-size:12px;margin-top:8px;">' +
      (avecPdf
        ? 'Décision officielle signée électroniquement et tamponnée en pièce jointe — envoyé automatiquement par Auto-RH.'
        : 'Notification automatique — envoyée par Auto-RH (décision disponible dans le portail « Mes demandes »).') +
      '</p></div>'
    : corpsDefautHtmlRefus(ctx, { avecPdf });
  // Destinataires : employé en À ; RH + manager en Cc (dédupliqués).
  const a = destinataires.employe || destinataires.rh || destinataires.manager || '';
  const cc = [destinataires.rh, destinataires.manager]
    .filter(Boolean)
    .filter((x, i, t) => t.indexOf(x) === i && x !== a);
  return {
    from: destinataires.from || undefined,
    to: a,
    cc,
    subject: sujet,
    text: texte,
    html,
    // (v0.2.158 — Task 205) marqué SYSTÈME — garde anti-boucle IMAP (jumelle
    // de document-acceptation.js) : jamais classé comme une réponse.
    headers: { 'X-Auto-RH-Systeme': 'document-refus' },
    // (MODIFIÉ v0.2.193) le PDF n'est joint QU'aux messages « avec PDF ».
    ...(avecPdf
      ? {
          attachments: [{
            filename: nomFichier,
            content: pdfOctets,
            contentType: 'application/pdf',
          }],
        }
      : {}),
  };
}

function referenceAutomatiqueRefus(ctx, options) {
  const avecPdf = !options || options.avecPdf !== false;
  return [
    '---',
    'Référence : ' + ctx.reference + ' — ' + ctx.typeLibelle,
    'Statut final : Refusée',
    avecPdf
      ? 'La décision signée et tamponnée est jointe (PDF) et disponible dans le portail « Mes demandes ».'
      : 'La décision est disponible dans le portail « Mes demandes ».',
    'E-mail envoyé automatiquement par Auto-RH.',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* PIPELINE COMPLET                                                    */
/* ------------------------------------------------------------------ */

/** Le document de refus a-t-il déjà été généré pour cette demande ? */
function dejaGenereRefus(demande) {
  return Boolean(demande && demande.docRefusChemin);
}

/**
 * ORCHESTRATEUR — à appeler DÈS QUE la demande devient REFUSÉE (décision RH,
 * réponse e-mail reconnue) : génère le PDF de décision de refus, le tamponne,
 * le signe avec le certificat configuré, le conserve, met à jour la demande
 * et envoie l'e-mail (employé À + RH/manager Cc). JAMAIS bloquant pour
 * l'appelant : tout incident est renvoyé dans le résultat (et tracé).
 *
 * @returns {Promise<object>} {
 *   genere, saute?, motif?, document?{nom,taille,chemin,docId},
 *   signatureCrypto, elements, envoi?{envoye,destinataires,messageId,erreur},
 *   erreur?
 * }
 */
async function traiterRefus(prisma, demandeId, opts) {
  const o = opts || {};
  const journal = (e) => { try { if (o.journaliser) o.journaliser(e); } catch { /* */ } };
  const resultat = { genere: false };
  let demande = null;
  try {
    demande = await prisma.demandeAdministrative.findUnique({ where: { id: demandeId } });
    if (!demande) return { genere: false, saute: true, motif: 'Demande introuvable.' };
    // 1) contrôles
    if (TYPES_REFUS.indexOf(demande.type) < 0) {
      return { genere: false, saute: true, motif: 'Type non concerné (' + demande.type + ').' };
    }
    if (demande.statut !== STATUT_REFUS) {
      return { genere: false, saute: true, motif: 'Statut non refusé (' + demande.statut + ').' };
    }
    const cfg = await acceptation.chargerConfig(prisma);
    // (v0.2.148) saut TRACÉ au Journal — même discipline que l'acceptation
    if (!cfg.docActif) {
      journal({
        action: 'doc-refus',
        reference: demande.reference,
        type: demande.type,
        succes: false,
        code: 'DOC_REFUS_SAUTE',
        motif: 'Génération automatique désactivée (interrupteur principal de la section « Réponse automatique PDF »).',
        source: cfg._sourceConfig || 'module-historique',
        erreur: null,
      });
      return { genere: false, saute: true, motif: 'Génération automatique désactivée.' };
    }
    if (dejaGenereRefus(demande) && !o.forcer) {
      return { genere: false, saute: true, motif: 'Document de refus déjà généré (docRefusChemin présent).' };
    }
    // 2) génération + tampon + signature
    const { pdf, ctx, elements, signatureCrypto, avertissements } =
      await genererDocumentRefus(prisma, demande, cfg, o);
    const nomFichier = nomFichierRefus(ctx);
    const empreinte = crypto.createHash('sha256').update(pdf).digest('hex');
    // 3) stockage chiffré (même dossier que les documents de réponse →
    //    servi par les routes existantes RH + portail employé)
    const dossier = o.dossierDocumentsDemandes ||
      path.join(process.cwd(), 'storage', 'documents-demandes');
    fs.mkdirSync(dossier, { recursive: true });
    const nomStocke = demande.reference + '-REFUS-' + Date.now() + '-' + empreinte.slice(0, 8) + '.pdf';
    const chiffrer = o.encryptForStorage;
    fs.writeFileSync(path.join(dossier, nomStocke), chiffrer ? chiffrer(pdf) : pdf);
    // 4) DocumentDemande (visible détail RH + « Mes demandes » portail)
    const doc = await prisma.documentDemande.create({
      data: {
        demandeId: demande.id,
        nomFichier,
        chemin: nomStocke,
        taille: pdf.length,
        typeMime: 'application/pdf',
        empreinte,
        empreinteOrigine: empreinte,
        recuDe: RECUPERATION_AUTO_REFUS,
      },
    });
    resultat.genere = true;
    resultat.document = { nom: nomFichier, chemin: nomStocke, taille: pdf.length, docId: doc.id };
    resultat.signatureCrypto = signatureCrypto;
    resultat.elements = elements;
    // (v0.2.147) avertissements explicites (certificat absent pour la
    // signature électronique et/ou le cachet « Signature électronique »)
    resultat.avertissements = avertissements || [];
    resultat.contexte = {
      employe: ctx.nomEmploye, cin: ctx.cin, matricule: ctx.matricule,
      emailEmploye: ctx.emailEmploye, manager: ctx.nomManager, emailManager: ctx.emailManager,
      jours: ctx.jours, heures: ctx.heures, motif: ctx.motifRefus,
    };
    // 5) e-mail automatique (employé + RH + manager) — JAMAIS bloquant
    // (MODIFIÉ v0.2.193 — DEMANDE UTILISATEUR) LES NOTIFICATIONS DE REFUS
    // SONT TOUJOURS ENVOYÉES à TOUS les destinataires historiques (employé
    // « À », RH + manager en Cc) — jumelle de document-acceptation.js. Les 4
    // interrupteurs e-mail du panneau « Réponse PDF » ne gouvernent PLUS QUE
    // LA RÉPONSE PDF : la décision signée et tamponnée n'est jointe qu'aux
    // destinataires activés (maître ON) — les autres reçoivent LA MÊME
    // notification SANS le PDF (au plus deux messages).
    const dechiffrer = o.dechiffrerChamp || ((v) => v);
    let emailRh = '';
    let from = '';
    try {
      const mailCfg = await prisma.mailConfig.findUnique({ where: { id: 'smtp' } });
      emailRh = String((mailCfg && mailCfg.rhEmail) || '').trim();
      if (mailCfg && mailCfg.from) from = String(mailCfg.from).trim();
    } catch { /* */ }
    // (MODIFIÉ v0.2.193) adresses TOUJOURS complètes — plus aucun filtrage
    // par les interrupteurs.
    const destinataires = {
      employe: ctx.emailEmploye || '',
      rh: emailRh,
      manager: ctx.emailManager || '',
      from,
    };
    const pdfOk = cfg.docEmailActif !== false;
    const avecPdfDe = {
      employe: pdfOk && cfg.docEnvoyerEmploye !== false,
      rh: pdfOk && cfg.docEnvoyerRh !== false,
      manager: pdfOk && cfg.docEnvoyerManager !== false,
    };
    const envoi = {
      envoye: false,
      destinataires: { a: destinataires.employe, cc: [destinataires.rh, destinataires.manager].filter(Boolean) },
      // (NOUVEAU v0.2.193) qui reçoit la réponse PDF / la notification seule.
      reponsePdfPour: Object.keys(avecPdfDe).filter((k) => avecPdfDe[k] && destinataires[k]),
      sansReponsePdfPour: Object.keys(avecPdfDe).filter((k) => !avecPdfDe[k] && destinataires[k]),
      reponsePdfDesactive: !pdfOk,
    };
    // (NOUVEAU v0.2.168 — option sansEmail) jumelle du document
    // d'acceptation : quand l'appelant (portail) fusionne le document de
    // refus dans la RÉPONSE AUTOMATIQUE de décision (un seul e-mail à
    // l'employé avec le PDF signé joint), le module n'envoie PAS son propre
    // e-mail. Traçabilité conservée.
    if (o.sansEmail) {
      envoi.fusion = 'notification-decision';
    } else if (typeof o.envoyerMail === 'function' && (destinataires.employe || destinataires.rh || destinataires.manager)) {
      // (MODIFIÉ v0.2.193) au plus DEUX messages : « avec PDF » puis
      // « sans PDF » — une panne sur l'un n'empêche PAS l'autre.
      const groupes = [];
      if (avecPdfDe.employe || avecPdfDe.rh || avecPdfDe.manager) {
        groupes.push({
          avecPdf: true,
          destinataires: {
            employe: avecPdfDe.employe ? destinataires.employe : '',
            rh: avecPdfDe.rh ? destinataires.rh : '',
            manager: avecPdfDe.manager ? destinataires.manager : '',
            from,
          },
        });
      }
      const exclus = {
        employe: !avecPdfDe.employe ? destinataires.employe : '',
        rh: !avecPdfDe.rh ? destinataires.rh : '',
        manager: !avecPdfDe.manager ? destinataires.manager : '',
        from,
      };
      if (exclus.employe || exclus.rh || exclus.manager) {
        groupes.push({ avecPdf: false, destinataires: exclus });
      }
      const ids = [];
      const erreurs = [];
      for (const g of groupes) {
        try {
          const message = construireEmailDocumentRefus(ctx, cfg, g.destinataires, nomFichier, pdf, { avecPdf: g.avecPdf });
          const r = await o.envoyerMail(message);
          ids.push((r && r.messageId) || '');
        } catch (e) {
          erreurs.push(e instanceof Error ? e.message : String(e));
        }
      }
      if (ids.length) {
        envoi.envoye = true;
        envoi.messageId = ids[0];
        envoi.messages = ids.length;
      }
      if (erreurs.length) envoi.erreur = erreurs.join(' | ');
    } else if (!destinataires.employe && !destinataires.rh && !destinataires.manager) {
      envoi.absenceDestinataire = true;
    } else {
      envoi.absenceFonctionEnvoi = true;
    }
    resultat.envoi = envoi;
    // 6) traçabilité sur la demande (docRefusDestinataires CHIFFRÉ côté
    //    portail via o.chiffrerChamp ; côté administration le middleware
    //    s'en charge — ne PAS double-chiffrer)
    const traceDest = JSON.stringify({
      a: envoi.destinataires.a || '',
      cc: envoi.destinataires.cc || [],
      // (NOUVEAU v0.2.193) répartition de la réponse PDF (traçable côté RH)
      reponsePdfPour: envoi.reponsePdfPour || [],
      le: new Date().toISOString(),
    });
    const maj = {
      docRefusChemin: nomStocke,
      docRefusNom: nomFichier,
      docRefusLe: new Date(),
      docRefusPar: o.declencheur || 'Système',
      docRefusErreur: envoi.erreur ? ('Envoi e-mail : ' + envoi.erreur).slice(0, 500) : null,
      docRefusDestinataires: o.chiffrerChamp ? o.chiffrerChamp(traceDest, false) : traceDest,
    };
    if (envoi.envoye) maj.docRefusEnvoiLe = new Date();
    await prisma.demandeAdministrative.update({ where: { id: demande.id }, data: maj });
    journal({
      action: 'doc-refus',
      reference: demande.reference,
      type: demande.type,
      succes: true,
      document: nomFichier,
      signatureCrypto,
      elements,
      // (v0.2.147) avertissements tracés : cause visible dans le Journal
      avertissements: avertissements || [],
      // (v0.2.148) SOURCE de configuration utilisée
      source: cfg._sourceConfig || 'module-historique',
      envoi: envoi.envoye ? 'envoye' : (envoi.erreur ? 'echec' : 'absent'),
      erreur: envoi.erreur || null,
    });
    return resultat;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    resultat.erreur = detail;
    journal({
      action: 'doc-refus',
      reference: demande ? demande.reference : demandeId,
      type: demande ? demande.type : null,
      succes: false,
      code: 'DOC_REFUS_ECHEC',
      erreur: detail,
    });
    // trace sur la demande (jamais bloquante)
    try {
      if (demande) {
        await prisma.demandeAdministrative.update({
          where: { id: demande.id },
          data: { docRefusErreur: detail.slice(0, 500) },
        });
      }
    } catch { /* */ }
    return resultat;
  }
}

/* ------------------------------------------------------------------ */
/* EXPORTS                                                             */
/* ------------------------------------------------------------------ */

module.exports = {
  TYPES_REFUS,
  STATUT_REFUS,
  RECUPERATION_AUTO_REFUS,
  OBJET_REFUS_DEFAUT,
  LIBELLES_TYPE_REFUS,
  resoudreContexteRefus,
  lignesDetailRefus,
  genererPdfRefus,
  genererDocumentRefus,
  nomFichierRefus,
  construireEmailDocumentRefus,
  traiterRefus,
  dejaGenereRefus,
};
