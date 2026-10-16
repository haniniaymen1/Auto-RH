/**
 * ============================================================================
 *  NOUVEAU (Task 179) — DOCUMENT D'ACCEPTATION SIGNÉ ÉLECTRONIQUEMENT ET
 *  TAMPONNÉ (demandes de congé / autorisation de sortie)
 * ============================================================================
 *  Demande utilisateur : « Lorsque le statut final d'une demande de congé ou
 *  d'autorisation est "Acceptée", le système doit automatiquement générer le
 *  document correspondant, puis appliquer la signature électronique et le
 *  tampon… Envoyer automatiquement le document à l'adresse e-mail de
 *  l'employé, mail à RH et à manager. Conserver le document signé dans le
 *  système afin qu'il soit également accessible depuis le portail de
 *  l'employé. La configuration du certificat, de la signature électronique,
 *  du tampon et des paramètres d'envoi doit être gérée depuis le portail
 *  d'administration. »
 *
 *  MODULE PARTAGÉ (JavaScript pur, CommonJS) — utilisé par DEUX serveurs :
 *   - l'ADMINISTRATION (4000, Next.js) via src/lib/doc-signe.ts :
 *       POST /api/demandes/[id] (décision RH Acceptée),
 *       POST /api/demandes/[id]/repondre (document importé → Acceptée),
 *       POST /api/demandes/[id]/doc-signe (génération / renvoi manuel),
 *       /api/doc-signer-config (aperçu, test d'envoi, certificat) ;
 *   - le PORTAIL employé (4001, scripts/portail-server.js) :
 *       traiterMessageRecu (Task 178) — validation reconnue d'un congé
 *       (VALIDEE) et acceptation par pièce jointe d'une autorisation.
 *
 *  PIPELINE (traiterAcceptationFinale) :
 *   1. contrôle (type congé/autorisation, statut final accepté, docActif,
 *      idempotence docSigneChemin sauf `forcer`) ;
 *   2. résolution du contexte (identité de l'employé, CIN, matricule,
 *      e-mails employé/manager/RH, jours ou heures) ;
 *   3. génération du PDF A4 (toutes les informations exigées) ;
 *   4. TAMpon : image de signature (paraphe) + image de tampon (cachet) +
 *      mention légale — dessinés pdf-lib ;
 *   5. SIGNATURE ÉLECTRONIQUE par CERTIFICAT (.p12/.pfx configuré) :
 *      placeholder PKCS#7 (pdflibAddPlaceholder) + signature détachée
 *      CAdES/PKCS#7 (P12Signer + signpdf) — vérifiable dans Acrobat ;
 *   6. stockage CHIFFRÉ (storage/documents-demandes/ — servi par les routes
 *      existantes) + DocumentDemande relié (visible RH + portail employé) ;
 *   7. mise à jour de la demande (docSigne*) ;
 *   8. e-mail AUTOMATIQUE : employé (À) + service RH + manager (Cc) avec le
 *      PDF signé en pièce jointe — JAMAIS bloquant (échec tracé).
 *
 *  DÉPENDANCES INJECTÉES (opts) — chaque serveur fournit SES outils :
 *   dechiffrerChamp, chiffrerChamp (portail : chiffrement manuel),
 *   encryptForStorage, lireFichierStocke (lecture déchiffrée du certificat),
 *   dossierDocumentsDemandes, resoudreIdentite (nom + matricule),
 *   envoyerMail (transport SMTP du serveur appelant), journaliser.
 * ============================================================================
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** Types concernés par la génération automatique (demande utilisateur). */
const TYPES_DOCUMENT_SIGNE = ['CONGE', 'AUTORISATION_SORTIE',
  // (NOUVEAU v0.2.178 — demande utilisateur « parrainage : acceptation et
  // refus par e-mail, avec le PDF correspondant ») le PDF d'acceptation
  // signé est désormais généré AUSSI pour le parrainage (la réponse de la
  // boîte dédiée vaut décision unique). Le module couvre déjà le détail
  // parrainage (lignesDetail, cas PARRAINAGE) et le PDF de REFUS jumeau
  // couvre le type depuis Task 180 (TYPES_REFUS).
  'PARRAINAGE'];

/** Statuts « acceptation FINALE » déclencheurs :
 *  - congé : ACCEPTEE (décision RH) et VALIDEE (réponse e-mail du manager,
 *    reconnaissance Task 178) ;
 *  - autorisation : ACCEPTEE (décision RH ou réponse e-mail avec document). */
const STATUTS_ACCEPTES = ['ACCEPTEE', 'VALIDEE'];

const POSITIONS = ['BAS_DROITE', 'BAS_GAUCHE', 'HAUT_DROITE', 'HAUT_GAUCHE'];

const RECUPERATION_AUTO = 'Génération automatique (document signé)';

const LIBELLES_TYPE = {
  CONGE: 'Demande de congé',
  AUTORISATION_SORTIE: 'Autorisation de sortie',
  // (NOUVEAU v0.2.178) PDF d'acceptation du parrainage
  PARRAINAGE: 'Demande de parrainage',
};

/** Config par défaut (champs Task 179 + v0.2.143 unification de SignatureConfig). */
const DEFAUTS_DOC = {
  docActif: true,
  // (v0.2.145) interrupteurs indépendants par élément — défauts ON =
  // continuité exacte (élément appliqué dès qu'il est configuré)
  docSigActif: true,
  tamponActif: true,
  signerActif: true,
  certChemin: '',
  certNom: '',
  certEmpreinte: '',
  certMotDePasse: '',
  certSignataire: '',
  certFonction: '',
  docSigImage: '',
  docSigImageNom: '',
  docSigImageChemin: '',
  docSigPosition: 'BAS_DROITE',
  docSigTaille: 120,
  tamponImage: '',
  tamponImageNom: '',
  tamponImageChemin: '',
  tamponPosition: 'BAS_GAUCHE',
  tamponTaille: 140,
  tamponOpacite: 0.85,
  docMention:
    'Document signé électroniquement — certificat configuré — Auto-RH — {DATE}',
  mentionActif: true,
  docEmailActif: true,
  docEmailObjet: 'Votre {TYPE} — {REF} : acceptée — document signé et tamponné',
  docEmailCorps: '',
  docEnvoyerEmploye: true,
  docEnvoyerRh: true,
  docEnvoyerManager: true,
  // ---- (v0.2.143) unification avec le système « Import de fichiers » ----
  docSigDecalX: 0,
  docSigDecalY: 0,
  docSigRotation: 0,
  docSigSource: 'DEDIEE',
  tamponDecalX: 0,
  tamponDecalY: 0,
  tamponRotation: 0,
  tamponSource: 'DEDIEE',
  docQrActif: false,
  docQrMode: 'DONNEES',
  docQrUrl: '',
  docQrTexte: '',
  docQrImage: '',
  docQrImageNom: '',
  docQrPosition: 'BAS_GAUCHE',
  docQrTaille: 110,
  docQrDecalX: 0,
  docQrDecalY: 0,
  docQrRotation: 0,
  docQrSource: 'DEDIEE',
  docElecActif: false,
  docElecPosition: 'BAS_DROITE',
  docElecDecalX: 0,
  docElecDecalY: 0,
  docElecTaille: 100,
  docElecForme: 'RECTANGLE',
  docElecAffSignataire: false,
  docElecAffOrganisation: false,
  docElecAffEmetteur: false,
  docElecAffValidite: false,
  docElecAffEmpreinte: false,
  docElecTexteLibre: '',
  docCertSource: 'MODULE',
};

/** Moteur de TAMPON UNIFIÉ (v0.2.143) — même géométrie / QR / cachet que
 *  les fiches de paie (src/lib/stamp.ts). */
const tamponUnifie = require('./tampon-document.js');

/* ------------------------------------------------------------------ */
/* Aides génériques                                                    */
/* ------------------------------------------------------------------ */

function parseDonnees(brut) {
  try {
    return JSON.parse(brut || '{}') || {};
  } catch {
    return {};
  }
}

/** Date FR « jj/mm/aaaa hh:mm ». */
function formatFr(d) {
  try {
    return new Date(d).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(d || '');
  }
}

/** Date FR « jj/mm/aaaa » (champs yyyy-mm-dd du formulaire). */
function formatDateSimple(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return String(iso || '').trim();
  return m[3] + '/' + m[2] + '/' + m[1];
}

/** Nombre de JOURS d'un congé (bornes incluses) — null si indéterminable. */
function calculerJours(dateDebut, dateFin) {
  const d1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateDebut || '').trim());
  const d2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateFin || '').trim());
  if (!d1 || !d2) return null;
  const t1 = Date.UTC(+d1[1], +d1[2] - 1, +d1[3]);
  const t2 = Date.UTC(+d2[1], +d2[2] - 1, +d2[3]);
  if (!isFinite(t1) || !isFinite(t2) || t2 < t1) return null;
  return Math.round((t2 - t1) / 86400000) + 1;
}

/** Coupe un texte sur plusieurs lignes selon la largeur (pts). */
function couperTexte(texte, police, taille, largeurMax) {
  const brut = String(texte == null ? '' : texte);
  if (!brut) return [''];
  const lignes = [];
  for (const paragraphe of brut.split(/\r?\n/)) {
    const mots = paragraphe.split(/\s+/).filter(Boolean);
    if (!mots.length) {
      lignes.push('');
      continue;
    }
    let courante = '';
    for (const mot of mots) {
      const essai = courante ? courante + ' ' + mot : mot;
      if (police.widthOfTextAtSize(essai, taille) <= largeurMax || !courante) {
        courante = essai;
      } else {
        lignes.push(courante);
        courante = mot;
      }
    }
    if (courante) lignes.push(courante);
  }
  return lignes.length ? lignes : [''];
}

/** Nettoie un texte pour l'encodage WinAnsi des polices standard PDF
 *  (remplace les caractères non représentables, jamais d'exception). */
function winAnsi(texte) {
  return String(texte == null ? '' : texte)
    .replace(/\u2022/g, '-')
    .replace(/\u2192/g, '->')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...')
    // caractères hors WinAnsi : remplacés par « ? » (police standard)
    .replace(/[^\x00-\xFF\u0100-\u024F\u2013\u2014\u20AC]/g, '?');
}

function echappeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** dataURL image → { octets, type: 'png'|'jpg' } — null si invalide.
 *  (Task 180 : réutilisée par scripts/document-refus.js — module jumeau.) */
function dataUrlVersOctets(dataUrl) {
  const m = /^data:image\/(png|jpe?g);base64,([\s\S]+)$/.exec(String(dataUrl || '').trim());
  if (!m) return null;
  try {
    const octets = Buffer.from(m[2], 'base64');
    if (!octets.length) return null;
    return { octets, type: m[1] === 'jpeg' ? 'jpg' : 'png' };
  } catch {
    return null;
  }
}

/** Charge paresseusement les modules de SIGNATURE CRYPTOGRAPHIQUE
 *  (@signpdf + node-forge) — absent d'aucun côté impossible : installés. */
function modulesSignature() {
  const signpdfMod = require('@signpdf/signpdf');
  return {
    signpdf: signpdfMod.default || signpdfMod,
    P12Signer: require('@signpdf/signer-p12').P12Signer,
    pdflibAddPlaceholder: require('@signpdf/placeholder-pdf-lib').pdflibAddPlaceholder,
    utils: require('@signpdf/utils'),
    forge: require('node-forge'),
  };
}

/* ------------------------------------------------------------------ */
/* Configuration (singleton SignatureConfig)                           */
/* ------------------------------------------------------------------ */

/** Lit la configuration du document signé (créée à la volée si absente).
 *  (v0.2.143) lit AUSSI la configuration du MODULE de signature
 *  (SignatureApiConfig — LE MÊME certificat/paramètres PAdES que
 *  l'importation des fiches de paie) et la renvoie dans cfg.moduleConfig.
 *  (v0.2.144 — PRIORITÉ « RÉPONSE AUTOMATIQUE PDF PAR E-MAIL » ; CORRIGÉ
 *  v0.2.148 — trace 1a1178618b8b7729) : la configuration DÉDIÉE
 *  ReponsePdfConfig est LA SOURCE DE VÉRITÉ dès qu'elle est ENGAGÉE —
 *  interrupteur principal ACTIF **ou** certificat DÉDIÉ importé. AVANT :
 *  une section configurée (certificat importé, cachet/signature activés)
 *  mais laissée inactive tombait SILENCIEUSEMENT sur le module historique →
 *  l'aperçu (qui reflète TOUJOURS la section) montrait signature + cachet
 *  tandis que le PDF RÉELLEMENT ENVOYÉ en était dépourvu. Désormais : UNE
 *  SEULE source pour l'aperçu ET la génération ; l'interrupteur principal
 *  (actif) gouverne la GÉNÉRATION (section inactive + certificat présent →
 *  AUCUN document — saut TRACÉ au Journal, jamais de PDF historique
 *  incohérent). La retombée historique ne concerne plus que les
 *  installations sans section engagée (ligne absente ou jamais configurée).
 *  */
async function chargerConfig(prisma) {
  // ---- (v0.2.144, corrigé v0.2.148) configuration DÉDIÉE indépendante ----
  let rpc = null;
  try {
    rpc = await prisma.reponsePdfConfig.findUnique({ where: { id: 'reponse-pdf' } });
    if (sectionDedieePrioritaire(rpc)) {
      return {
        ...cfgDepuisReponsePdf(rpc),
        // (v0.2.148) l'interrupteur PRINCIPAL de la section gouverne la
        // GÉNÉRATION (l'aperçu et le test d'envoi appellent
        // cfgDepuisReponsePdf DIRECTEMENT — docActif:true forcé pour eux,
        // jamais écrasé par cet override)
        docActif: Boolean(rpc.actif),
        _sourceConfig: 'section-dediee',
      };
    }
  } catch {
    // table absente (installation antérieure) ou lecture impossible → historique
  }
  let cfg = null;
  try {
    cfg = await prisma.signatureConfig.findUnique({ where: { id: 'signature' } });
    if (!cfg) cfg = await prisma.signatureConfig.create({ data: { id: 'signature' } });
  } catch {
    return { ...DEFAUTS_DOC, moduleConfig: null, _sourceConfig: 'module-historique' };
  }
  let moduleConfig = null;
  try {
    moduleConfig = await prisma.signatureApiConfig.findUnique({ where: { id: 'signature-api' } });
  } catch {
    moduleConfig = null;
  }
  const base = { ...DEFAUTS_DOC, ...cfg, moduleConfig, _sourceConfig: 'module-historique' };
  // ---- (NOUVEAU v0.2.191 — CORRECTIF « les interrupteurs ne fonctionnent ni
  // activés ni désactivés ») les QUATRE interrupteurs E-MAIL de la section
  // « Envoi par e-mail (réponse PDF en pièce jointe) » — emailActif (maître)
  // et envoyerEmploye / envoyerRh / envoyerManager — s'appliquent DÈS QUE LA
  // LIGNE ReponsePdfConfig EXISTE, MÊME quand la section n'est pas « engagée »
  // (interrupteur de génération OFF et aucun certificat dédié importé — le
  // défaut de « actif » est FALSE). AVANT : une section non engagée tombait
  // ENTIÈREMENT sur la configuration historique (SignatureConfig + défauts
  // TOUS ON, sans docEnvoyerEmploye) → les interrupteurs du panneau restaient
  // SANS AUCUN EFFET sur les e-mails de décision émis par l'administration
  // (acceptation / refus signés, réponse avec document importé). La règle de
  // continuité v0.2.148 reste limitée à ce qu'elle visait : les VISUELS du
  // document (paraphe, tampon, QR, certificat, mention). Une installation qui
  // n'a jamais ouvert le panneau (aucune ligne) conserve les défauts
  // historiques (tous activés — identiques aux défauts du panneau) : AUCUN
  // changement de comportement tant qu'aucun interrupteur n'est touché.
  if (rpc) {
    base.docEmailActif = rpc.emailActif !== false;
    base.docEnvoyerEmploye = rpc.envoyerEmploye !== false;
    base.docEnvoyerRh = rpc.envoyerRh !== false;
    base.docEnvoyerManager = rpc.envoyerManager !== false;
  }
  return base;
}

/**
 * (v0.2.148 — trace 1a1178618b8b7729) La section dédiée « Réponse
 * automatique PDF par e-mail » est PRIORITAIRE dès qu'elle est ENGAGÉE :
 * interrupteur principal ACTIF **ou** certificat DÉDIÉ importé. Une simple
 * ligne auto-créée à l'ouverture du panneau (tout OFF, aucun certificat)
 * ne suffit PAS — la continuité historique (module SignatureConfig) est
 * préservée pour ces installations jamais configurées.
 */
function sectionDedieePrioritaire(rpc) {
  return Boolean(rpc && (rpc.actif || String(rpc.certChemin || '').trim()));
}

/**
 * (v0.2.144) Traduit la configuration DÉDIÉE « Réponse automatique PDF par
 * e-mail » (ReponsePdfConfig) dans le format interne du moteur — INDÉPENDANCE
 * TOTALE : images EXCLUSIVEMENT dédiées (source DEDIEE), certificat
 * EXCLUSIVEMENT dédié à la section (docCertSource 'DEDIE' → lireCertificat ne
 * consulte JAMAIS le module), cachet électronique alimenté par CE certificat.
 * Les valeurs non configurées restent vides (aucun repli silencieux vers la
 * config « Import »). docActif = true : l'interrupteur de génération est
 * l'actif de la section elle-même.
 */
function cfgDepuisReponsePdf(rpc) {
  return {
    ...DEFAUTS_DOC,
    // génération + envoi : interrupteurs de la section dédiée
    docActif: true,
    docEmailActif: rpc.emailActif !== false,
    docEmailObjet: rpc.emailObjet || DEFAUTS_DOC.docEmailObjet,
    docEmailCorps: rpc.emailCorps || '',
    docEnvoyerEmploye: rpc.envoyerEmploye !== false,
    docEnvoyerRh: rpc.envoyerRh !== false,
    docEnvoyerManager: rpc.envoyerManager !== false,
    // paraphe (signature image) — DÉDIÉ
    // (v0.2.145) interrupteur INDÉPENDANT : sigActif=false → paraphe jamais
    // dessiné, même si une image est configurée
    docSigActif: rpc.sigActif !== false,
    docSigImage: rpc.sigImage || '',
    docSigImageNom: rpc.sigImageNom || '',
    docSigImageChemin: rpc.sigImageChemin || '',
    docSigPosition: rpc.sigPosition || 'BAS_DROITE',
    docSigTaille: rpc.sigTaille || 120,
    docSigDecalX: rpc.sigDecalX || 0,
    docSigDecalY: rpc.sigDecalY || 0,
    docSigRotation: rpc.sigRotation || 0,
    docSigSource: 'DEDIEE',
    // tampon (cachet image) — DÉDIÉ
    // (v0.2.145) interrupteur INDÉPENDANT : tamponActif=false → tampon jamais
    // dessiné, même si une image est configurée
    tamponActif: rpc.tamponActif !== false,
    tamponImage: rpc.tamponImage || '',
    tamponImageNom: rpc.tamponImageNom || '',
    tamponImageChemin: rpc.tamponImageChemin || '',
    tamponPosition: rpc.tamponPosition || 'BAS_GAUCHE',
    tamponTaille: rpc.tamponTaille || 140,
    tamponOpacite: typeof rpc.tamponOpacite === 'number' ? rpc.tamponOpacite : 0.85,
    tamponDecalX: rpc.tamponDecalX || 0,
    tamponDecalY: rpc.tamponDecalY || 0,
    tamponRotation: rpc.tamponRotation || 0,
    tamponSource: 'DEDIEE',
    // QR code — DÉDIÉ
    docQrActif: Boolean(rpc.qrActif),
    docQrMode: rpc.qrMode || 'FICHE',
    docQrUrl: rpc.qrUrl || '',
    docQrTexte: rpc.qrTexte || '',
    docQrImage: rpc.qrImage || '',
    docQrImageNom: rpc.qrImageNom || '',
    docQrPosition: rpc.qrPosition || 'BAS_GAUCHE',
    docQrTaille: rpc.qrTaille || 110,
    docQrDecalX: rpc.qrDecalX || 0,
    docQrDecalY: rpc.qrDecalY || 0,
    docQrRotation: rpc.qrRotation || 0,
    docQrSource: 'DEDIEE',
    // cachet « Signature électronique » — alimenté par le certificat DÉDIÉ
    docElecActif: Boolean(rpc.elecActif),
    docElecPosition: rpc.elecPosition || 'BAS_DROITE',
    docElecDecalX: rpc.elecDecalX || 0,
    docElecDecalY: rpc.elecDecalY || 0,
    docElecTaille: rpc.elecTaille || 100,
    docElecForme: rpc.elecForme === 'ROND' ? 'ROND' : 'RECTANGLE',
    docElecAffSignataire: Boolean(rpc.elecAffSignataire),
    docElecAffOrganisation: Boolean(rpc.elecAffOrganisation),
    docElecAffEmetteur: Boolean(rpc.elecAffEmetteur),
    docElecAffValidite: Boolean(rpc.elecAffValidite),
    docElecAffEmpreinte: Boolean(rpc.elecAffEmpreinte),
    docElecTexteLibre: rpc.elecTexteLibre || '',
    // certificat DÉDIÉ (fichier + métadonnées) — JAMAIS celui de l'Import
    certChemin: rpc.certChemin || '',
    certNom: rpc.certFichierNom || '',
    certEmpreinte: rpc.certEmpreinte || '',
    certImporteLe: rpc.certImportLe || null,
    certMotDePasse: rpc.certMotDePasse || '',
    certSignataire: rpc.certSignataire || '',
    certFonction: rpc.certFonction || '',
    // métadonnées publiques (cachet électronique + bloc certificat de l'aperçu)
    certSujet: rpc.certSujet || '',
    certEmetteur: rpc.certEmetteur || '',
    certSerie: rpc.certSerie || '',
    certValideDu: rpc.certValideDu || null,
    certValideAu: rpc.certValideAu || null,
    certActif: rpc.certActif !== false && Boolean(rpc.certChemin),
    // INDÉPENDANCE : la signature PAdES utilise EXCLUSIVEMENT le certificat
    // DÉDIÉ de la section — lireCertificat ne consulte JAMAIS le module.
    docCertSource: 'DEDIE',
    // (v0.2.145) interrupteur INDÉPENDANT de la SIGNATURE ÉLECTRONIQUE :
    // signerActif=false → le PDF est généré SANS signature cryptographique
    // (le paraphe/tampon/cachet restent appliqués selon leurs interrupteurs)
    signerActif: rpc.signerActif !== false,
    // mention légale
    docMention: rpc.mentionTexte || DEFAUTS_DOC.docMention,
    mentionActif: rpc.mentionActif !== false,
    // marqueur de source (le moteur adapte le cachet électronique)
    _sourceReponsePdf: true,
    // AUCUNE dépendance : moduleConfig null, sources verrouillées DEDIEE/DEDIE
    moduleConfig: null,
  };
}

/**
 * (v0.2.144) Métadonnées PUBLIQUES du CERTIFICAT DÉDIÉ de la section
 * « Réponse automatique PDF par e-mail » — alimentent le cachet « Signature
 * électronique » (stockées à l'import du .p12, JAMAIS de lecture du module).
 */
function donneesElecDepuisCertificatDedie(cfg) {
  if (!cfg || !cfg.docElecActif) return null;
  const sujet = String(cfg.certSujet || '').trim();
  const empreinte = String(cfg.certEmpreinte || '').trim();
  if (!sujet && !empreinte) return null;
  return {
    certSujet: sujet,
    certEmetteur: String(cfg.certEmetteur || '').trim(),
    certEmpreinte: empreinte,
    certValideAu: cfg.certValideAu || null,
  };
}

/**
 * (v0.2.143) Métadonnées PUBLIQUES du certificat du MODULE de signature
 * (SignatureApiConfig) — injectées EN DIRECT au cachet « Signature
 * électronique » (jamais stockées), même discipline que
 * completerConfigTamponAvecElec() de src/lib/signature-api.ts : le cachet
 * n'est apposé que si le module est ACTIF pour le périmètre
 * « documents des demandes/réponses » ET porte un certificat.
 */
function donneesElecDepuisModule(cfg) {
  const m = cfg && cfg.moduleConfig;
  if (!cfg || !cfg.docElecActif || !m) return null;
  if (!m.actif || !m.signerReponses) return null;
  const sujet = String(m.certSujet || '').trim();
  const empreinte = String(m.certEmpreinte || '').trim();
  if (!sujet && !empreinte) return null;
  return {
    certSujet: sujet,
    certEmetteur: String(m.certEmetteur || '').trim(),
    certEmpreinte: empreinte,
    certValideAu: m.certValideAu || null,
  };
}

/* ------------------------------------------------------------------ */
/* Contexte de la demande (toutes les informations du document)        */
/* ------------------------------------------------------------------ */

/**
 * Réunit TOUTES les informations exigées pour le PDF et l'e-mail :
 *  - Nom et prénom de l'employé (résolu via opts.resoudreIdentite :
 *    Portail Administration → fiches de paie → formulaire) ;
 *  - CIN, Matricule, Adresse e-mail de l'employé ;
 *  - Nom + adresse e-mail du manager / responsable (résolus pour les
 *    e-mails — PLUS AFFICHÉS dans le PDF depuis la v0.2.189 : la section
 *    « Manager / responsable » est supprimée) ;
 *  - Type de demande, nombre de jours (congé) ou d'heures (autorisation) ;
 *  - Statut final, référence, dates, décideur, autres champs du formulaire
 *    (le décideur reste disponible pour les e-mails et la traçabilité —
 *    il n'est PLUS AFFICHÉ dans le PDF depuis la v0.2.189).
 */
async function resoudreContexte(prisma, demande, cfg, opts) {
  const dechiffrer = opts.dechiffrerChamp || ((v) => v);
  // (v0.2.158 — Task 205) les DONNÉES du formulaire sont CHIFFRÉES en base
  // (côté portail il n'y a PAS de middleware Prisma) : il faut les DÉCHIFFRER
  // avant JSON.parse — sinon le document affiche « — » pour tous les champs
  // (type de congé, dates, motif…). dechiffrerChamp est idempotent : une
  // valeur déjà en clair (côté administration, middleware) est rendue telle
  // quelle, donc le module reste SÛR pour les deux serveurs.
  const donnees = parseDonnees(dechiffrer(demande.donnees));
  const cinClaire = String(dechiffrer(demande.cin) || demande.cin || '').trim();

  // Identité (nom + matricule) — résolution propre à chaque serveur.
  let nom = '';
  let matricule = '';
  if (typeof opts.resoudreIdentite === 'function') {
    try {
      const r = await opts.resoudreIdentite(prisma, cinClaire, donnees) || {};
      nom = String(r.nom || '').trim();
      matricule = String(r.matricule || '').trim();
    } catch {
      // jamais bloquant — replis ci-dessous
    }
  }
  if (!nom) {
    nom = [donnees.prenom, donnees.nom].filter(Boolean).join(' ').trim() ||
      String(donnees.nom || '').trim() ||
      String(donnees.nomParrain || '').trim() || '';
  }

  // E-mails (chiffrés en base — déchiffrés ici, idempotent côté middleware).
  const emailEmploye = String(dechiffrer(demande.employeEmail) || '').trim();
  let emailManager = String(dechiffrer(demande.destinataire) || '').trim();
  if (!emailManager) emailManager = String(donnees.emailN1 || '').trim();

  // Nom du manager : le portail ne saisit que l'adresse (N+1) ou le
  // responsable est désigné par département (MailConfig.responsablesMap) —
  // libellé significatif quand aucun nom n'est disponible.
  let nomManager = String(donnees.nomManager || donnees.nomN1 || '').trim();
  if (!nomManager) {
    if (demande.type === 'AUTORISATION_SORTIE') {
      const dep = String(donnees.departement || '').trim();
      nomManager = dep
        ? 'Responsable du département ' + dep
        : 'Responsable / service concerné';
    } else if (demande.type === 'PARRAINAGE') {
      // (NOUVEAU v0.2.178) le parrainage est décidé par la boîte DÉDIÉE
      nomManager = 'Service chargé du parrainage';
    } else {
      nomManager = 'N+1 / Responsable hiérarchique';
    }
  }

  const jours = calculerJours(donnees.dateDebut, donnees.dateFin);
  const heures = String(donnees.nombreHeures || '').trim();

  // (v0.2.144) VALIDATIONS — informations manager (N+1) et RH + historique
  const LIBELLE_DECISION = { ACCEPTEE: 'Acceptée', REFUSEE: 'Refusée', EN_ATTENTE: 'En attente' };
  const libelleDecision = (v) => LIBELLE_DECISION[String(v || '').trim().toUpperCase()] || String(v || '').trim() || '';

  return {
    demande,
    donnees,
    type: demande.type,
    typeLibelle: LIBELLES_TYPE[demande.type] || demande.type,
    reference: demande.reference,
    statutFinal: 'Acceptée',
    cin: cinClaire,
    nomEmploye: nom,
    matricule,
    emailEmploye,
    nomManager,
    emailManager,
    jours,
    heures,
    // (v0.2.143) date BRUTE de la demande — empreinte HMAC du QR
    // (empreinteDocument : même discipline que les fiches) et contenu QR.
    createdAt: demande.createdAt,
    dateDemande: formatFr(demande.createdAt),
    dateDecision: demande.traiteLe ? formatFr(demande.traiteLe) : formatFr(new Date()),
    decideur: String(demande.traitePar || '').trim(),
    commentaire: String(donnees.commentaire || '').trim(),
    // (v0.2.144) validations manager / RH + horodatage de la validation finale
    validationManager: demande.decisionManager
      ? {
          decision: libelleDecision(demande.decisionManager),
          le: demande.decisionManagerLe ? formatFr(demande.decisionManagerLe) : '',
          par: String(demande.decisionManagerPar || '').trim(),
          note: String(demande.decisionManagerNote || '').trim(),
        }
      : null,
    validationRh: demande.decisionRh
      ? {
          decision: libelleDecision(demande.decisionRh),
          le: demande.decisionRhLe ? formatFr(demande.decisionRhLe) : '',
          par: String(demande.decisionRhPar || '').trim(),
        }
      : null,
    refuseePar: String(demande.refuseePar || '').trim(),
  };
}

/** Lignes [libellé, valeur] du DÉTAIL selon le type (ordre du cahier).
 *  (Task 180 : les cas ATTESTATION_* et PARRAINAGE servent au PDF de REFUS —
 *  le document d'acceptation reste limité au congé / autorisation.) */
function lignesDetail(ctx) {
  const d = ctx.donnees;
  const v = (k) => String(d[k] == null ? '' : d[k]).trim();
  if (ctx.type === 'CONGE') {
    const jours = ctx.jours != null ? ctx.jours + ' jour' + (ctx.jours > 1 ? 's' : '') : '—';
    return [
      ['Type de congé', v('typeConge') || '—'],
      ['Date de début', formatDateSimple(v('dateDebut')) || '—'],
      ['Date de fin', formatDateSimple(v('dateFin')) || '—'],
      ['Nombre de jours', jours],
      ...(ctx.commentaire ? [['Commentaire', ctx.commentaire]] : []),
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
      ...(v('nomParrain') ? [['Nom et prénom du parrain', v('nomParrain')]] : []),
      ...(v('emailParrain') ? [['E-mail du parrain', v('emailParrain')]] : []),
      ['E-mail du N+1 / responsable', v('emailN1') || '—'],
      ['Date du parrainage', formatDateSimple(v('dateParrainage')) || '—'],
      ['Opération / Hiérarchie', v('operation') || '—'],
      ['Nom et prénom du filleul', v('nomFilleul') || '—'],
      ['Téléphone du filleul', v('telFilleul') || '—'],
    ];
  }
  return [
    ['Date', formatDateSimple(v('date')) || '—'],
    ['Département', v('departement') || '—'],
    ['Motif', v('motif') || '—'],
    ['Nombre d\'heures', ctx.heures ? ctx.heures + ' heure(s)' : '—'],
    ['Heure de sortie', v('heureSortie') || '—'],
    ['Heure de retour', v('heureRetour') || '—'],
    ['Compensation des heures',
      v('compensation') === 'OUI' ? 'Oui — heures compensées' : 'Non — heures non compensées'],
  ];
}

/* ------------------------------------------------------------------ */
/* GÉNÉRATION DU PDF (toutes les informations exigées)                 */
/* ------------------------------------------------------------------ */

const A4 = { L: 595.28, H: 841.89 };
const MARGE = 54;
/** Zone de SIGNATURE réservée en bas de page : tampon à gauche, paraphe au
 *  centre-droit, bloc « Fait le / signataire » à droite. (v0.2.149) la
 *  garantie « le contenu ne descend jamais sous Y_MIN_CONTENU » est appliquée
 *  par la MESURE GLOBALE + COMPRESSION ADAPTATIVE de genererPdfAcceptation :
 *  le document tient TOUJOURS sur UNE SEULE page (aucune pagination — demande
 *  utilisateur) et le contenu ne descend JAMAIS dans la zone de signature
 *  (fin du chevauchement du texte de la signature électronique et du cachet
 *  sur le contenu). */
const ZONE_SIGNE = { bas: 42, haut: 196 };
const Y_MIN_CONTENU = 196;

/** Dessine une table [libellé, valeur] avec zébrures — renvoie le Y courant.
 *  (Task 180 : opts.zebre / opts.ligne permettent au PDF de REFUS d'utiliser
 *  une palette neutre — DÉFAUTS INCHANGÉS pour le document d'acceptation.) */
function dessinerTable(page, police, policeGras, lignes, y, largeurUtile, opts) {
  const o = opts || {};
  const hauteurLigne = o.hauteurLigne || 20;
  // (v0.2.149) métriques paramétrables pour la mise en page UNE PAGE —
  // défauts identiques au rendu historique (pas 13, pad 7)
  const pasValeur = o.pasValeur || 13;
  const padValeur = o.padValeur || 7;
  const largeurLabel = o.largeurLabel || 190;
  const zebre = o.zebre || rgb(0.949, 0.973, 0.957);
  const filet = o.filet || rgb(0.85, 0.89, 0.86);
  // ligne de base : hauteurLigne 20 → y-14 (rendu historique inchangé)
  const base = hauteurLigne - 6;
  let yCourant = y;
  lignes.forEach((paire, i) => {
    const [libelle, valeur] = paire;
    const valeurs = couperTexte(winAnsi(valeur), police, 10, largeurUtile - largeurLabel - 16);
    const h = Math.max(hauteurLigne, valeurs.length * pasValeur + padValeur);
    // zébrage
    if (i % 2 === 0) {
      page.drawRectangle({
        x: MARGE, y: yCourant - h, width: largeurUtile, height: h,
        color: zebre,
      });
    }
    // libellé
    page.drawText(winAnsi(libelle), {
      x: MARGE + 10, y: yCourant - base, size: 10,
      font: policeGras, color: rgb(0.22, 0.28, 0.36),
    });
    // valeur (multiligne)
    valeurs.forEach((l, j) => {
      page.drawText(l, {
        x: MARGE + largeurLabel + 6, y: yCourant - base - j * pasValeur, size: 10,
        font: police, color: rgb(0.09, 0.13, 0.19),
      });
    });
    page.drawLine({
      start: { x: MARGE, y: yCourant - h },
      end: { x: MARGE + largeurUtile, y: yCourant - h },
      thickness: 0.6, color: filet,
    });
    yCourant -= h;
  });
  return yCourant;
}

/** (v0.2.149) MIROIR EXACT des hauteurs de dessinerTable — calcule la
 *  hauteur qu'occupera la table SANS la dessiner (mêmes règles : hauteurLigne
 *  20 par défaut, valeur multi-lignes = valeurs.length * 13 + 7). Utilisée
 *  par la pagination anti-chevauchement pour mesurer chaque section AVANT
 *  dessin. Exportée pour les tests et les documents frères (refus). */
function hauteurTable(lignes, police, largeurUtile, opts) {
  const o = opts || {};
  const hauteurLigne = o.hauteurLigne || 20;
  // (v0.2.149) miroir exact des métriques de dessinerTable
  const pasValeur = o.pasValeur || 13;
  const padValeur = o.padValeur || 7;
  const largeurLabel = o.largeurLabel || 190;
  let h = 0;
  (lignes || []).forEach((paire) => {
    const valeurs = couperTexte(winAnsi(paire[1]), police, 10, largeurUtile - largeurLabel - 16);
    h += Math.max(hauteurLigne, valeurs.length * pasValeur + padValeur);
  });
  return h;
}

/** Titre de section (petite barre + texte gras) — (Task 180) palette
 *  paramétrable : opts.barre / opts.texte (DÉFAUT = vert de l'acceptation). */
function dessinerTitreSection(page, policeGras, texte, y, largeurUtile, opts) {
  const o = opts || {};
  const barre = o.barre || rgb(0.02, 0.59, 0.4);
  const texteCouleur = o.texte || rgb(0.06, 0.24, 0.17);
  // (v0.2.149) hauteur paramétrable (23 = rendu historique inchangé)
  const hauteur = o.hauteur || 23;
  const hBarre = Math.max(8, hauteur - 10);
  page.drawRectangle({
    x: MARGE, y: y - hBarre, width: 4, height: hBarre, color: barre,
  });
  page.drawText(winAnsi(texte), {
    x: MARGE + 12, y: y - hBarre + 1.5, size: 11.5, font: policeGras, color: texteCouleur,
  });
  return y - hauteur;
}

/** (v0.2.149) BORNE le nombre de lignes d'une valeur libre (commentaire,
 *  note…) : coupe au plus `max` lignes wrappées et termine par « … ».
 *  Garantit qu'aucune section ne peut dépasser la page entière au-dessus de
 *  la zone de signature (le contenu est borné, la pagination est fiable). */
function tronquerLignes(texte, police, taille, largeur, max) {
  const lignes = couperTexte(winAnsi(texte), police, taille, largeur);
  if (lignes.length <= max) return lignes.join('\n');
  return lignes.slice(0, max).join('\n') + ' …';
}

/**
 * Génère le PDF A4 de la DÉCISION D'ACCEPTATION — TOUJOURS UNE SEULE PAGE
 * (v0.2.149, refonte anti-chevauchement SANS pagination) : en-tête, statut
 * final ACCEPTÉE, demande, identité employé (nom, CIN, matricule, e-mail),
 * détail (jours / heures), manager (nom + e-mail), validations + historique,
 * puis bloc signature/tampon réservé en bas, mention et pied de page.
 * TOUTES les sections sont mesurées avant dessin ; si l'ensemble ne tient pas
 * au-dessus de la zone de signature (Y_MIN_CONTENU), les métriques passent en
 * mode COMPACT puis DENSE (interlignes/écarts réduits, commentaires et
 * historique bornés plus courts) — le PDF ne compte JAMAIS 2 pages.
 */
async function genererPdfAcceptation(ctx, cfg) {
  const doc = await PDFDocument.create();
  doc.setTitle('Décision d\'acceptation — ' + ctx.reference);
  doc.setSubject(ctx.typeLibelle + ' — statut final : Acceptée');
  doc.setProducer('Auto-RH');
  doc.setCreator('Auto-RH — Portail RH');
  const page = doc.addPage([A4.L, A4.H]);
  const police = await doc.embedFont(StandardFonts.Helvetica);
  const policeGras = await doc.embedFont(StandardFonts.HelveticaBold);
  const largeurUtile = A4.L - MARGE * 2;
  const VERT = rgb(0.02, 0.59, 0.4);
  const ENCRE = rgb(0.09, 0.13, 0.19);

  // ---- En-tête ----
  page.drawRectangle({ x: 0, y: A4.H - 64, width: A4.L, height: 64, color: rgb(0.024, 0.712, 0.529) });
  page.drawText('Auto-RH', { x: MARGE, y: A4.H - 38, size: 20, font: policeGras, color: rgb(1, 1, 1) });
  page.drawText('Gestion administrative du personnel', { x: MARGE, y: A4.H - 54, size: 9, font: police, color: rgb(0.88, 0.98, 0.94) });
  const refTexte = 'Réf. ' + ctx.reference;
  page.drawText(refTexte, {
    x: A4.L - MARGE - policeGras.widthOfTextAtSize(refTexte, 11), y: A4.H - 38,
    size: 11, font: policeGras, color: rgb(1, 1, 1),
  });

  // ---- Titre ----
  let y = A4.H - 96;
  const titre = 'DÉCISION D\'ACCEPTATION';
  const tailleTitre = 19;
  page.drawText(titre, {
    x: (A4.L - policeGras.widthOfTextAtSize(titre, tailleTitre)) / 2, y,
    size: tailleTitre, font: policeGras, color: ENCRE,
  });
  y -= 19;
  const sousTitre = ctx.typeLibelle + ' — statut final : ACCEPTÉE';
  page.drawText(sousTitre, {
    x: (A4.L - police.widthOfTextAtSize(sousTitre, 11.5)) / 2, y,
    size: 11.5, font: police, color: rgb(0.29, 0.35, 0.41),
  });

  // ---- Bandeau statut final ----
  y -= 32;
  const texteStatut = 'STATUT FINAL : ACCEPTÉE';
  const largeurStatut = policeGras.widthOfTextAtSize(texteStatut, 12) + 44;
  page.drawRectangle({
    x: (A4.L - largeurStatut) / 2, y: y - 8, width: largeurStatut, height: 26,
    color: VERT, borderColor: rgb(0.01, 0.42, 0.29), borderWidth: 1,
  });
  page.drawText(texteStatut, {
    x: (A4.L - policeGras.widthOfTextAtSize(texteStatut, 12)) / 2, y: y,
    size: 12, font: policeGras, color: rgb(1, 1, 1),
  });
  y -= 28;

  // ---- (v0.2.149) UNE SEULE PAGE — MESURE GLOBALE + COMPRESSION ADAPTATIVE ----
  // (refonte anti-chevauchement SANS pagination — demande utilisateur :
  // « la réponse automatique ne doit pas être générée sur 2 pages ») Toutes
  // les sections sont mesurées AVANT dessin ; le PREMIER jeu de métriques
  // (normale → compacte → dense) qui tient ENTIÈREMENT au-dessus de la zone
  // de signature (Y_MIN_CONTENU) est retenu. Le PDF ne compte JAMAIS 2 pages
  // et le contenu ne descend JAMAIS dans la zone de signature : le texte de
  // la signature électronique et du cachet ne peut plus se superposer au
  // contenu.
  const MESURES = [
    // normale : rendu historique aéré (petits documents)
    { hLigne: 20, pasValeur: 13, padValeur: 7, titreH: 23, gap: 12, histPas: 13, maxCom: 8, maxNote: 5, maxHist: 6 },
    // compacte : interlignes resserrés, textes libres bornés plus courts
    { hLigne: 14, pasValeur: 11, padValeur: 4.5, titreH: 16.5, gap: 4.5, histPas: 9.5, maxCom: 3, maxNote: 2, maxHist: 3 },
    // dense : dernier recours (données très longues) — tient toujours
    { hLigne: 13, pasValeur: 10, padValeur: 4, titreH: 15.5, gap: 3.5, histPas: 9, maxCom: 2, maxNote: 1, maxHist: 2 },
  ];
  const largeurValeur = largeurUtile - 190 - 16;

  /** Construit les sections pour un jeu de métriques (libres bornés).
   *  (MODIFIÉ v0.2.189 — DEMANDE UTILISATEUR) SIMPLIFICATION DU DOCUMENT :
   *    - section « Informations de la demande » : la ligne « Décision rendue
   *      par » est SUPPRIMÉE (l'auteur de la décision n'est plus montré) ;
   *    - section « Manager / responsable » : SUPPRIMÉE ENTIÈREMENT ;
   *    - section « Validations » : SUPPRIMÉE ENTIÈREMENT (validations du
   *      manager et du RH, note du manager, validation finale « par … ») —
   *      SEULS restent, sous le détail, les DEUX lignes d'historique
   *      « Demande créée le … » et « Décision finale : … — … » (SANS l'acteur) ;
   *      toutes les autres informations (étapes intermédiaires, acteurs,
   *      notes) sont MASQUÉES.
   *    Règle appliquée à TOUS les PDF de réponse automatique (le module
   *    document-refus.js applique la même simplification). La mise en page
   *    (titres de sections, tableaux, bloc signature) est inchangée. */
  const sectionsPour = (m) => {
    const detailDoc = lignesDetail(ctx);
    if (ctx.type === 'CONGE' && ctx.commentaire) {
      // commentaire borné (… si tronqué) — jamais de débordement
      const iCom = detailDoc.findIndex((p) => p[0] === 'Commentaire');
      if (iCom >= 0) detailDoc[iCom][1] = tronquerLignes(ctx.commentaire, police, 10, largeurValeur, m.maxCom);
    }
    if (ctx.type === 'AUTORISATION_SORTIE') {
      // (v0.2.149) le motif libre de l'autorisation est borné lui aussi
      const iMotif = detailDoc.findIndex((p) => p[0] === 'Motif');
      if (iMotif >= 0) detailDoc[iMotif][1] = tronquerLignes(String(detailDoc[iMotif][1]), police, 10, largeurValeur, m.maxCom);
    }
    // (MODIFIÉ v0.2.189 — DEMANDE UTILISATEUR) historique RÉDUIT aux deux
    // lignes exigées — la date de création et la décision finale, SANS
    // l'acteur (le « (par …) » et les étapes manager/RH sont masqués).
    const historique = [
      'Demande créée le ' + ctx.dateDemande,
      'Décision finale : ' + ctx.statutFinal + ' — ' + ctx.dateDecision,
    ];
    return [
      { titre: 'Informations de la demande', lignes: [
        ['Référence unique', ctx.reference],
        ['Type de demande', ctx.typeLibelle],
        ['Statut final', 'Acceptée'],
        ['Date de la demande', ctx.dateDemande],
        ['Date de la décision', ctx.dateDecision],
      ] },
      { titre: 'Identité de l\'employé', lignes: [
        ['Nom et prénom', ctx.nomEmploye || '—'],
        ['CIN', ctx.cin || '—'],
        ['Matricule', ctx.matricule || '—'],
        ['Adresse e-mail', ctx.emailEmploye || '—'],
      ] },
      { titre: 'Détail de la demande', lignes: detailDoc, historique },
    ];
  };

  const optsTable = (m) => ({ hauteurLigne: m.hLigne, pasValeur: m.pasValeur, padValeur: m.padValeur });
  const hauteurSections = (m) => sectionsPour(m).reduce((t, s) =>
    t + m.titreH
    + hauteurTable(s.lignes, police, largeurUtile, optsTable(m))
    + (s.historique ? s.historique.length * m.histPas : 0)
    + m.gap, 0);
  const dispo = y - Y_MIN_CONTENU;
  const mesures = MESURES.find((x) => hauteurSections(x) <= dispo) || MESURES[MESURES.length - 1];
  const sections = sectionsPour(mesures);

  // ---- Dessin des sections (UNE SEULE PAGE — aucune pagination) ----
  for (const s of sections) {
    y = dessinerTitreSection(page, policeGras, s.titre, y, largeurUtile, { hauteur: mesures.titreH });
    y = dessinerTable(page, police, policeGras, s.lignes, y, largeurUtile, optsTable(mesures));
    if (s.historique && s.historique.length) {
      s.historique.forEach((ligne, i) => {
        page.drawText(winAnsi((i === s.historique.length - 1 ? '— ' : '· ') + ligne), {
          x: MARGE + 8, y: y - (mesures.histPas - 2), size: 9, font: police,
          color: rgb(0.29, 0.35, 0.41),
        });
        y -= mesures.histPas;
      });
    }
    y -= mesures.gap;
  }

  // ---- Bloc signature / tampon (ZONE RÉSERVÉE — jamais de collision) ----
  // Le tampon, le paraphe, le cachet « Signature électronique » et la
  // signature PKCS#7 sont appliqués par tamponnerDocument / signerPdf sur
  // CETTE page unique : gauche le TAMPON (BAS_GAUCHE, ancré y=42),
  // droite-bas le PARAPHE (BAS_DROITE, ancré y=42) ; colonne droite :
  // « Fait le » + signataire + fonction. Milieu : zone de signature PKCS#7.
  page.drawLine({
    start: { x: MARGE, y: 192 }, end: { x: MARGE + largeurUtile, y: 192 },
    thickness: 0.8, color: rgb(0.85, 0.89, 0.86),
  });
  const xBloc = A4.L - MARGE - 230;
  page.drawText('Fait le ' + formatFr(new Date()), {
    x: xBloc, y: 178, size: 10, font: police, color: rgb(0.29, 0.35, 0.41),
  });
  const signataire = cfg.certSignataire || 'Le service RH';
  const fonction = cfg.certFonction || '';
  page.drawText(winAnsi(signataire), {
    x: xBloc, y: 162, size: 11, font: policeGras, color: ENCRE,
  });
  let yNote = 144;
  if (fonction) {
    const fonctionLignes = couperTexte(winAnsi(fonction), police, 9.5, 222);
    fonctionLignes.slice(0, 2).forEach((l, i) => {
      page.drawText(l, {
        x: xBloc, y: 148 - i * 11, size: 9.5, font: police, color: rgb(0.29, 0.35, 0.41),
      });
    });
    yNote = 148 - Math.min(2, fonctionLignes.length) * 11 - 2;
  }
  // (v0.2.149) notes du bloc HOMOGÈNES aux interrupteurs (demande utilisateur :
  // « la désactivation ne fonctionne pas ») — le texte n'annonce plus
  // « signé (certificat) » quand la signature électronique est désactivée ou
  // sans certificat importé, ni « tamponné » quand le tampon est désactivé.
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

  // ---- Mention légale (centrée, SOUS la zone de signature — y<42) ----
  // (v0.2.144) interrupteur mentionActif de la configuration (défaut : ON).
  if (cfg.mentionActif !== false) {
  const mentionBrute = String(cfg.docMention || '').replace(/\{DATE\}/g, formatFr(new Date()));
  const mentionLignes = couperTexte(winAnsi(mentionBrute), police, 8.5, largeurUtile);
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
/* TAMPON (signature image + cachet + mention)                         */
/* ------------------------------------------------------------------ */

/**
 * (v0.2.143) RÉSOLUTION DES IMAGES selon les SOURCES configurées — même
 * principe que les fiches de paie : l'image peut être DÉDIÉE (importée dans
 * ce panneau) ou PARTAGÉE avec la section « Import de fichiers » (les
 * actifs sigImage / qrImage de la même configuration).
 */
function resoudreImages(cfg) {
  return {
    paraphe:
      String(cfg.docSigSource || 'DEDIEE').toUpperCase() === 'IMPORT'
        ? String(cfg.sigImage || '')
        : String(cfg.docSigImage || ''),
    tampon:
      String(cfg.tamponSource || 'DEDIEE').toUpperCase() === 'IMPORT'
        ? String(cfg.sigImage || '')
        : String(cfg.tamponImage || ''),
    qrFourni:
      String(cfg.docQrSource || 'DEDIEE').toUpperCase() === 'IMPORT'
        ? String(cfg.qrImage || '')
        : String(cfg.docQrImage || ''),
  };
}

/**
 * (v0.2.143 — MOTEUR UNIFIÉ) Applique sur le PDF de réponse TOUS les
 * éléments du tampon, avec la MÊME logique / les mêmes paramètres et le
 * MÊME système de positionnement que les fiches de paie :
 *   - paraphe (signature image — source DEDIEE ou IMPORT) ;
 *   - tampon (cachet image — source DEDIEE ou IMPORT) ;
 *   - QR code (5 modes des fiches, jeton de vérification public) ;
 *   - cachet « Signature électronique » (ROND/RECTANGLE, alimenté EN
 *     DIRECT par le certificat du module).
 * Le rendu est délégué à scripts/tampon-document.js (jumelle de stamp.ts).
 *
 * @returns {{ doc, elements: string[] }}
 */
async function tamponnerDocument(pdfBrut, cfg, opts) {
  const o = opts || {};
  const doc = await PDFDocument.load(pdfBrut);
  // (v0.2.149) les éléments (paraphe, tampon, QR, cachet « Signature
  // électronique ») sont appliqués sur la DERNIÈRE page — là où le bloc de
  // signature est dessiné (pagination anti-chevauchement : 1 page = même
  // comportement qu'avant ; 2 pages = page 2, jamais la page de contenu).
  const pages = doc.getPages();
  const page = pages[pages.length - 1];
  const police = await doc.embedFont(StandardFonts.Helvetica);
  const policeGras = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx = o.ctx || {
    reference: (o.demande && o.demande.reference) || '',
    cin: '',
    nomEmploye: '',
    typeLibelle: (o.demande && LIBELLES_TYPE[o.demande.type]) || '',
    statutFinal: 'Acceptée',
    createdAt: (o.demande && o.demande.createdAt) || new Date(),
  };
  const images = resoudreImages(cfg);
  // (v0.2.144) cachet électronique : alimenté par le CERTIFICAT DÉDIÉ de la
  // section « Réponse automatique PDF » (config indépendante active) ou, en
  // comportement historique, par le certificat du module de signature.
  const elec = cfg._sourceReponsePdf
    ? donneesElecDepuisCertificatDedie(cfg)
    : donneesElecDepuisModule(cfg);
  const elements = await tamponUnifie.dessinerElementsDocument({
    doc,
    page,
    font: police,
    fontGras: policeGras,
    cfg,
    images,
    elec,
    ctx,
  });
  // (v0.2.147) elec renvoyé à l'appelant : permet d'AVERTIR quand le cachet
  // « Signature électronique » est activé mais non dessiné (certificat absent).
  return { doc, elements, elec };
}

/**
 * (v0.2.147) AVERTISSEMENTS EXPLICITES — la signature électronique ET le
 * cachet « Signature électronique » sont tous deux ALIMENTÉS PAR LE
 * CERTIFICAT (dédié de la section, ou module de signature en comportement
 * historique). Sans certificat lisible, les deux éléments activés sont
 * sautés — DÉSORMAIS SIGNALÉS au lieu d'être ignorés en silence.
 *
 * @param {object} cfg configuration moteur (cfgDepuisReponsePdf ou historique)
 * @param {object|null} certificatUtilise résultat de lireCertificat (null = aucun)
 * @param {object|null} elec données du cachet résolues par tamponnerDocument
 * @returns {string[]} messages compréhensibles (vide = tout va bien)
 */
function avertissementsCertificat(cfg, certificatUtilise, elec) {
  const avert = [];
  const c = cfg || {};
  const cachetAlimente = !!(elec && (elec.certSujet || elec.certEmpreinte));
  if (c.signerActif !== false && !certificatUtilise) {
    const cause = String(c.docCertSource || '').toUpperCase() === 'DEDIE'
      ? (c.certChemin
        ? 'le fichier du certificat dédié est introuvable ou illisible sur le serveur'
        : 'aucun certificat .p12/.pfx n\'est importé dans la section « Réponse automatique PDF par e-mail »')
      : 'aucun certificat lisible — importez-en un dans la section dédiée (ou activez le module de signature)';
    avert.push(
      'Signature électronique activée mais NON appliquée : ' + cause +
      '. Le document partira SANS signature cryptographique.'
    );
  }
  if (c.docElecActif && !cachetAlimente) {
    avert.push(
      'Cachet « Signature électronique » activé mais NON dessiné : il est alimenté EN DIRECT par le certificat ' +
      '(sujet / empreinte / validité). Importez le certificat dédié .p12/.pfx de la section pour l\'afficher.'
    );
  }
  return avert;
}

/* ------------------------------------------------------------------ */
/* SIGNATURE ÉLECTRONIQUE PAR CERTIFICAT (.p12 / .pfx)                 */
/* ------------------------------------------------------------------ */

/**
 * Lit le certificat de SIGNATURE ÉLECTRONIQUE (chiffré sur disque).
 * (v0.2.143 — UNIFICATION) source MODULE (défaut) : LE MÊME certificat que
 * l'importation des fiches de paie — module « API de certification &
 * signature » (SignatureApiConfig), périmètre signerReponses requis ;
 * source DEDIE : repli historique (certificat .p12 importé dans le panneau).
 * Continuité : MODULE sélectionné mais module inactif → le certificat
 * dédié s'applique s'il existe (aucun changement pour les installations
 * existantes tant que le module n'est pas activé).
 * → { octets, motDePasse, module? } — null si aucun certificat utilisable.
 */
async function lireCertificat(cfg, opts, prisma) {
  const dechiffrer = opts.dechiffrerChamp || ((v) => v);
  // ---- Source MODULE (défaut) : le certificat des FICHES DE PAIE ----
  if (String(cfg.docCertSource || 'MODULE').toUpperCase() !== 'DEDIE' && prisma) {
    try {
      const m = cfg.moduleConfig ||
        (await prisma.signatureApiConfig.findUnique({ where: { id: 'signature-api' } }));
      if (m && m.actif && m.signerReponses && m.certChemin && opts.lireFichierStocke) {
        const octets = await opts.lireFichierStocke(m.certChemin);
        if (octets && octets.length) {
          return {
            octets,
            motDePasse: String(dechiffrer(m.certMotDePasse) || ''),
            module: m,
          };
        }
      }
    } catch {
      // module illisible : repli dédié ci-dessous
    }
  }
  // ---- Repli / source DEDIE : certificat dédié du panneau ----
  if (!cfg.certChemin || !opts.lireFichierStocke) return null;
  try {
    const octets = await opts.lireFichierStocke(cfg.certChemin);
    if (!octets || !octets.length) return null;
    return { octets, motDePasse: String(dechiffrer(cfg.certMotDePasse) || '') };
  } catch {
    return null;
  }
}

/**
 * Signe le PDF avec le certificat PKCS#12 : placeholder PKCS#7 détaché
 * (visible, bas de page) + signature CAdES (P12Signer/node-forge).
 * Renvoie le PDF SIGNÉ — lève une exception si la signature échoue
 * (l'appelant décide : document non signé = erreur tracée, jamais envoyé
 * comme si tout allait bien quand un certificat est configuré).
 */
async function signerPdf(pdfOctets, certificat, ctx) {
  const m = modulesSignature();
  // (v0.2.143) raisons PAdES : quand le certificat vient du MODULE (même
  // signature que les fiches de paie), les raisons légales configurées du
  // module s'appliquent (raison / emplacement / contact — même discipline
  // que signerEtConserver) ; sinon valeurs historiques du document.
  const mod = certificat && certificat.module ? certificat.module : null;
  const raison = mod
    ? String(mod.raison || 'Approbation du document')
    : 'Décision ' + (ctx.statutFinal || '') + ' — ' + ctx.reference;
  const lieu = mod ? String(mod.emplacement || '') || 'Auto-RH' : 'Auto-RH';
  const contact = mod
    ? String(mod.contact || '') || ctx.emailEmploye || 'service RH'
    : ctx.emailEmploye || 'service RH';
  // 1) placeholder (ByteRange + Contents) — DERNIÈRE modification pdf-lib
  //    (Task 180 : raison NEUTRE valable pour acceptation ET refus — le
  //    statut final du contexte est affiché, jamais le type de document)
  const doc = await PDFDocument.load(pdfOctets);
  // (v0.2.149) le widget visible de signature est posé sur la DERNIÈRE page
  // (même page que le bloc « Fait le / signataire » et le cachet).
  const pages = doc.getPages();
  const page = pages[pages.length - 1];
  m.pdflibAddPlaceholder({
    pdfDoc: doc,
    pdfPage: page,
    reason: raison,
    contactInfo: contact,
    name: String((ctx.cfg && ctx.cfg.certSignataire) || 'Auto-RH'),
    location: lieu,
    signatureLength: 8192,
    subFilter: m.utils.SUBFILTER_ADOBE_PKCS7_DETACHED,
    // zone de signature visible : bande LIBRE du bas (entre le tampon à
    // gauche et le paraphe à droite) — jamais sur le texte du document
    widgetRect: [MARGE + 170, 44, A4.L - MARGE - 246, 108],
  });
  const avecPlaceholder = Buffer.from(await doc.save());
  // 2) signature détachée par le certificat
  const signataire = new m.P12Signer(certificat.octets, {
    passphrase: certificat.motDePasse || '',
    asn1StrictParsing: false,
  });
  const signe = await m.signpdf.sign(avecPlaceholder, signataire, new Date());
  return Buffer.from(signe);
}

/**
 * Vérifie un certificat .p12 (diagnostic du panneau d'administration) :
 * déchiffre le PKCS#12 avec le mot de passe et lit sujet / émetteur /
 * dates de validité. Renvoie { ok, message, sujet, emetteur, valideDu, valideAu, expire }.
 */
function verifierContenuCertificat(octets, motDePasse) {
  const m = modulesSignature();
  try {
    const asn1 = m.forge.asn1.fromDer(octets.toString('binary'));
    const p12 = m.forge.pkcs12.pkcs12FromAsn1(asn1, true, String(motDePasse || ''));
    // certificat : sac avec type certBag
    const sacs = p12.getBags({ bagType: m.forge.pki.oids.certBag });
    const sacsCert = sacs[m.forge.pki.oids.certBag] || [];
    const cert = sacsCert.length && sacsCert[0].cert ? sacsCert[0].cert : null;
    if (!cert) return { ok: false, message: 'Aucun certificat X.509 trouvé dans ce fichier .p12.' };
    const sujet = (cert.subject.attributes || [])
      .map((a) => (a.shortName ? a.shortName + '=' + a.value : a.value))
      .join(', ');
    const emetteur = (cert.issuer.attributes || [])
      .map((a) => (a.shortName ? a.shortName + '=' + a.value : a.value))
      .join(', ');
    const du = cert.validity ? cert.validity.notBefore : null;
    const au = cert.validity ? cert.validity.notAfter : null;
    const expire = au ? au.getTime() < Date.now() : false;
    return {
      ok: true,
      sujet,
      emetteur,
      valideDu: du ? formatFr(du) : '',
      valideAu: au ? formatFr(au) : '',
      expire,
      message: expire
        ? 'Certificat lisible — ATTENTION : il est EXPIRÉ depuis ' + formatFr(au) + '.'
        : 'Certificat lisible — signature électronique opérationnelle.',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: /password|mac/i.test(msg)
        ? 'Mot de passe incorrect ou fichier .p12 illisible : vérifiez le mot de passe du certificat.'
        : 'Fichier illisible : un certificat .p12 / .pfx est attendu. (' + msg.slice(0, 140) + ')',
    };
  }
}

/* ------------------------------------------------------------------ */
/* E-MAIL AUTOMATIQUE (employé À — RH + manager Cc)                    */
/* ------------------------------------------------------------------ */

function variablesContexte(ctx) {
  return {
    REF: ctx.reference,
    TYPE: ctx.typeLibelle,
    EMPLOYE: ctx.nomEmploye || 'Employé (CIN ' + ctx.cin + ')',
    CIN: ctx.cin,
    STATUT: ctx.statutFinal,
    JOURS: ctx.jours != null ? String(ctx.jours) : '',
    HEURES: ctx.heures || '',
    MANAGER: ctx.nomManager || '',
    DATE: formatFr(new Date()),
  };
}

function remplirVariables(gabarit, variables) {
  return String(gabarit || '').replace(/\{(REF|TYPE|EMPLOYE|CIN|STATUT|JOURS|HEURES|MANAGER|DATE)\}/g, (t, cle) => {
    const v = variables[cle];
    return v == null ? '' : String(v);
  });
}

/** Corps par défaut (si docEmailCorps vide) — texte brut. */
function corpsDefautTexte(ctx, options) {
  // (v0.2.193) options.avecPdf !== false → mention « joint au présent e-mail »
  // (historique) ; false → variante SANS PDF (la notification part toujours,
  // seul le document joint varie — disponible dans le portail).
  const avecPdf = !options || options.avecPdf !== false;
  const duree = ctx.type === 'CONGE'
    ? (ctx.jours != null ? '  Durée                     : ' + ctx.jours + ' jour(s)\n' : '')
    : (ctx.heures ? '  Durée                     : ' + ctx.heures + ' heure(s)\n' : '');
  return [
    'Bonjour,',
    '',
    'Bonne nouvelle : votre ' + ctx.typeLibelle.toLowerCase() + ' a été ACCEPTÉE.',
    '',
    '  Référence                  : ' + ctx.reference,
    '  Type de demande            : ' + ctx.typeLibelle,
    '  Employé                    : ' + (ctx.nomEmploye || 'CIN ' + ctx.cin),
    '  Statut final               : Acceptée',
    duree,
    ...(avecPdf ? [
      '',
      'Le document officiel correspondant — SIGNÉ ÉLECTRONIQUEMENT et TAMPONNÉ —',
      'est joint au présent e-mail (fichier PDF) et conservé dans votre portail,',
      'rubrique « Mes demandes » (boutons Visualiser et Télécharger).',
    ] : [
      '',
      'Le document officiel correspondant est conservé dans votre portail,',
      'rubrique « Mes demandes » (boutons Visualiser et Télécharger).',
    ]),
    '',
    'Cet e-mail a été envoyé automatiquement par Auto-RH au service RH et au',
    'manager / responsable concerné. Si vous n\'êtes pas le destinataire prévu,',
    'ignorez et supprimez ce message.',
  ].join('\n');
}

/** Corps par défaut — HTML (même présentation que les autres e-mails). */
function corpsDefautHtml(ctx, options) {
  // (v0.2.193) variante SANS PDF quand options.avecPdf === false.
  const avecPdf = !options || options.avecPdf !== false;
  const ligne = (l, v) =>
    '<tr><td style="padding:6px 14px;color:#475569;font-size:13px;white-space:nowrap;">' + echappeHtml(l) + '</td>' +
    '<td style="padding:6px 14px;"><b style="color:#0f172a;">' + echappeHtml(v) + '</b></td></tr>';
  const duree = ctx.type === 'CONGE'
    ? (ctx.jours != null ? ligne('Durée', ctx.jours + ' jour(s)') : '')
    : (ctx.heures ? ligne('Durée', ctx.heures + ' heure(s)') : '');
  return '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">' +
    '<div style="background:#059669;padding:18px 22px;color:#fff;">' +
    '<div style="font-size:18px;font-weight:700;">Votre demande est acceptée — ' + echappeHtml(ctx.typeLibelle) + '</div>' +
    '<div style="font-size:12px;opacity:.85;margin-top:4px;">Référence ' + echappeHtml(ctx.reference) + (avecPdf ? ' — document signé en pièce jointe' : '') + '</div>' +
    '</div>' +
    '<div style="padding:20px 22px;color:#334155;font-size:14px;">' +
    '<p style="margin:0 0 14px;">Bonjour,</p>' +
    '<p style="margin:0 0 14px;">Votre <b>' + echappeHtml(ctx.typeLibelle.toLowerCase()) + '</b> a été <b style="color:#059669;">ACCEPTÉE</b>. ' +
    (avecPdf
      ? 'Le document officiel correspondant, <b>signé électroniquement et tamponné</b>, est joint à cet e-mail (fichier PDF).'
      : 'Le document officiel correspondant est disponible dans votre portail, rubrique « Mes demandes » (la réponse PDF n\'est pas jointe à cet e-mail).') + '</p>' +
    '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 0;margin-bottom:14px;">' +
    '<table style="border-collapse:collapse;width:100%;">' +
    ligne('Référence unique', ctx.reference) +
    ligne('Type de demande', ctx.typeLibelle) +
    ligne('Employé', ctx.nomEmploye || 'CIN ' + ctx.cin) +
    (ctx.matricule ? ligne('Matricule', ctx.matricule) : '') +
    ligne('Statut final', 'Acceptée') +
    duree +
    '</table></div>' +
    '<p style="margin:0 0 14px;color:#475569;">Le document est également disponible dans votre portail, ' +
    'rubrique <b>« Mes demandes »</b> (boutons Visualiser et Télécharger).</p>' +
    '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail envoyé automatiquement par Auto-RH au service RH et au ' +
    'manager / responsable concerné. Si vous n\'êtes pas le destinataire prévu, ignorez et supprimez ce message.</p>' +
    '</div></div>';
}

/** Construit le message e-mail du document signé (l'appelant l'envoie via
 *  SON transport SMTP — opts.envoyerMail — et journalise). */
function construireEmailDocumentSigne(ctx, cfg, destinataires, nomFichier, pdfOctets, options) {
  // (NOUVEAU v0.2.193) options.avecPdf !== false → le PDF signé est JOINT
  // (comportement historique) ; false → message SANS pièce jointe — la
  // notification de décision part quand même (les interrupteurs du panneau
  // « Réponse PDF » ne gouvernent que le PDF, jamais la notification).
  const avecPdf = !options || options.avecPdf !== false;
  const variables = variablesContexte(ctx);
  const sujet = remplirVariables(cfg.docEmailObjet || DEFAUTS_DOC.docEmailObjet, variables);
  const corpsPerso = String(cfg.docEmailCorps || '').trim();
  const texte = corpsPerso ? corpsPerso + '\n\n' + referenceAutomatique(ctx, { avecPdf }) : corpsDefautTexte(ctx, { avecPdf });
  const html = corpsPerso
    ? '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;">' +
      '<div style="background:#059669;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-size:16px;font-weight:700;">' +
      echappeHtml(ctx.typeLibelle) + ' — ' + echappeHtml(ctx.reference) + ' : acceptée</div>' +
      '<div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:18px 20px;white-space:pre-wrap;color:#334155;font-size:14px;">' +
      echappeHtml(corpsPerso) + '</div>' +
      '<p style="color:#94a3b8;font-size:12px;margin-top:8px;">' +
      (avecPdf
        ? 'Document officiel signé électroniquement et tamponné en pièce jointe — envoyé automatiquement par Auto-RH.'
        : 'Notification automatique — envoyée par Auto-RH (document disponible dans le portail « Mes demandes »).') +
      '</p></div>'
    : corpsDefautHtml(ctx, { avecPdf });
  // Destinataires : employé en À ; RH + manager en Cc (dédupliqués, sans doublon du À).
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
    // (v0.2.158 — Task 205) marqué SYSTÈME : si ce message revient dans la
    // boîte IMAP relevée (Cc d'un destinataire auto-adressé), le poller le
    // consigne sans JAMAIS le classer comme une réponse (garde anti-boucle).
    headers: { 'X-Auto-RH-Systeme': 'document-signe' },
    // (MODIFIÉ v0.2.193) le PDF n'est joint QU'aux messages « avec PDF » :
    // la variante sans PDF (interrupteur du destinataire désactivé ou
    // maître OFF) part SANS pièce jointe — la notification reste complète.
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

function referenceAutomatique(ctx, options) {
  const avecPdf = !options || options.avecPdf !== false;
  return [
    '---',
    'Référence : ' + ctx.reference + ' — ' + ctx.typeLibelle,
    'Statut final : Acceptée',
    avecPdf
      ? 'Le document signé et tamponné est joint (PDF) et disponible dans le portail « Mes demandes ».'
      : 'Le document est disponible dans le portail « Mes demandes ».',
    'E-mail envoyé automatiquement par Auto-RH.',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* PIPELINE COMPLET                                                    */
/* ------------------------------------------------------------------ */

/** Le document a-t-il déjà été généré pour cette demande ? */
function dejaGenere(demande) {
  return Boolean(demande && demande.docSigneChemin);
}

/**
 * Génère le document signé (SANS effet de bord) : PDF + tampon + signature.
 * Renvoie { pdf, ctx, elements, signatureCrypto }.
 */
async function genererDocumentSigne(prisma, demande, cfg, opts) {
  const ctx = await resoudreContexte(prisma, demande, cfg, opts);
  ctx.cfg = cfg;
  // 1) PDF de base
  let pdf = await genererPdfAcceptation(ctx, cfg);
  // 2) tampon UNIFIÉ (v0.2.143) : paraphe + cachet + QR + cachet électronique
  //    — même logique/paramètres/positionnement que les fiches de paie
  //    (v0.2.147 : elec renvoyé pour les avertissements)
  const { doc, elements, elec } = await tamponnerDocument(pdf, cfg, { prisma, ctx, demande });
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
    const certificat = await lireCertificat(cfg, opts, prisma);
    if (certificat) {
      pdf = await signerPdf(pdf, certificat, ctx);
      signatureCrypto = true;
      certificatUtilise = certificat;
      elements.push('certificat');
    }
  }
  // 4) (v0.2.147) avertissements EXPLICITES quand un élément activé n'a pas
  //    pu être appliqué faute de certificat (signature sautée, cachet absent)
  const avertissements = avertissementsCertificat(cfg, certificatUtilise, elec);
  return { pdf, ctx, elements, signatureCrypto, avertissements };
}

/** Nom de fichier affiché du document signé.
 *  (MODIFIÉ v0.2.178) parrainage : « Acceptation_parrainage_… » (le slug est
 *  dérivé du type, comme dans le module de refus jumeau). */
function nomFichierDocument(ctx) {
  const SLUGS = { CONGE: 'conge', AUTORISATION_SORTIE: 'autorisation_sortie', PARRAINAGE: 'parrainage' };
  const slugType = SLUGS[ctx.type] || String(ctx.type || 'demande').toLowerCase();
  return 'Acceptation_' + slugType + '_' + ctx.reference + '.pdf';
}

/**
 * ORCHESTRATEUR — à appeler DÈS QUE la demande devient définitivement
 * acceptée (décision RH, réponse e-mail reconnue, import de document) :
 * génère, tamponne, signe, conserve, met à jour la demande et envoie
 * l'e-mail (employé À + RH/manager Cc). JAMAIS bloquant pour l'appelant :
 * tout incident est renvoyé dans le résultat (et tracé sur la demande).
 *
 * @returns {Promise<object>} {
 *   genere, saute?, motif?, document?{nom,taille,chemin,docId},
 *   signatureCrypto, elements, envoi?{envoye,destinataires,messageId,erreur},
 *   erreur?
 * }
 */
async function traiterAcceptationFinale(prisma, demandeId, opts) {
  const o = opts || {};
  const journal = (e) => { try { if (o.journaliser) o.journaliser(e); } catch { /* */ } };
  const resultat = { genere: false };
  let demande = null;
  try {
    demande = await prisma.demandeAdministrative.findUnique({ where: { id: demandeId } });
    if (!demande) return { genere: false, saute: true, motif: 'Demande introuvable.' };
    // 1) contrôles
    if (TYPES_DOCUMENT_SIGNE.indexOf(demande.type) < 0) {
      return { genere: false, saute: true, motif: 'Type non concerné (' + demande.type + ').' };
    }
    if (STATUTS_ACCEPTES.indexOf(demande.statut) < 0) {
      return { genere: false, saute: true, motif: 'Statut non final-accepté (' + demande.statut + ').' };
    }
    const cfg = await chargerConfig(prisma);
    // (v0.2.148) saut TRACÉ au Journal : la section dédiée est ENGAGÉE
    // (certificat importé) mais son interrupteur principal est OFF — l'état
    // est immédiatement visible (avant : saut silencieux, aucun indice)
    if (!cfg.docActif) {
      journal({
        action: 'doc-signe',
        reference: demande.reference,
        type: demande.type,
        succes: false,
        code: 'DOC_SIGNE_SAUTE',
        motif: 'Génération automatique désactivée (interrupteur principal de la section « Réponse automatique PDF »).',
        source: cfg._sourceConfig || 'module-historique',
        erreur: null,
      });
      return { genere: false, saute: true, motif: 'Génération automatique désactivée.' };
    }
    if (dejaGenere(demande) && !o.forcer) {
      return { genere: false, saute: true, motif: 'Document déjà généré (docSigneChemin présent).' };
    }
    // 2) génération + tampon + signature
    const { pdf, ctx, elements, signatureCrypto, avertissements } =
      await genererDocumentSigne(prisma, demande, cfg, o);
    const nomFichier = nomFichierDocument(ctx);
    const empreinte = crypto.createHash('sha256').update(pdf).digest('hex');
    // 3) stockage chiffré (même dossier que les documents de réponse →
    //    servi par les routes existantes RH + portail employé)
    const dossier = o.dossierDocumentsDemandes ||
      path.join(process.cwd(), 'storage', 'documents-demandes');
    fs.mkdirSync(dossier, { recursive: true });
    const nomStocke = demande.reference + '-SIGNE-' + Date.now() + '-' + empreinte.slice(0, 8) + '.pdf';
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
        recuDe: RECUPERATION_AUTO,
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
      jours: ctx.jours, heures: ctx.heures,
    };
    // 5) e-mail automatique (employé + RH + manager) — JAMAIS bloquant
    // (MODIFIÉ v0.2.193 — DEMANDE UTILISATEUR) LES NOTIFICATIONS D'ACCEPTATION
    // SONT TOUJOURS ENVOYÉES à TOUS les destinataires historiques (employé
    // « À », RH + manager en Cc) — AUCUN interrupteur ne peut plus en exclure
    // quelqu'un. Les 4 interrupteurs e-mail du panneau « Réponse PDF »
    // (docEmailActif maître + docEnvoyerEmploye / docEnvoyerRh /
    // docEnvoyerManager) ne gouvernent PLUS QUE LA RÉPONSE PDF : le document
    // signé et tamponné n'est joint qu'aux destinataires activés (maître ON)
    // — les autres reçoivent LA MÊME notification SANS le PDF (au plus deux
    // messages : « avec PDF » puis « sans PDF »).
    const dechiffrer = o.dechiffrerChamp || ((v) => v);
    let emailRh = '';
    let from = '';
    try {
      const mailCfg = await prisma.mailConfig.findUnique({ where: { id: 'smtp' } });
      emailRh = String((mailCfg && mailCfg.rhEmail) || '').trim();
      if (mailCfg && mailCfg.from) from = String(mailCfg.from).trim();
    } catch { /* */ }
    // (MODIFIÉ v0.2.193) adresses TOUJOURS complètes — plus aucun filtrage
    // par les interrupteurs (champ absent de la config = activé, défauts
    // historiques conservés).
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
      // (NOUVEAU v0.2.193) qui reçoit la réponse PDF / qui reçoit la
      // notification SEULE (sans PDF) — traçabilité immédiate.
      reponsePdfPour: Object.keys(avecPdfDe).filter((k) => avecPdfDe[k] && destinataires[k]),
      sansReponsePdfPour: Object.keys(avecPdfDe).filter((k) => !avecPdfDe[k] && destinataires[k]),
      reponsePdfDesactive: !pdfOk,
    };
    // (NOUVEAU v0.2.168 — option sansEmail) quand l'appelant (portail —
    // réponse e-mail reconnue) fusionne le document dans la RÉPONSE
    // AUTOMATIQUE de décision (un seul e-mail à l'employé avec le PDF signé
    // joint), le module NE doit PAS envoyer son propre e-mail : envoi tracé
    // comme fusionné, aucune erreur.
    if (o.sansEmail) {
      envoi.fusion = 'notification-decision';
    } else if (typeof o.envoyerMail === 'function' && (destinataires.employe || destinataires.rh || destinataires.manager)) {
      // (MODIFIÉ v0.2.193) au plus DEUX messages : « avec PDF » (destinataires
      // activés) puis « sans PDF » (exclus — notification quand même). Une
      // panne sur l'un n'empêche PAS l'autre de partir.
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
          const message = construireEmailDocumentSigne(ctx, cfg, g.destinataires, nomFichier, pdf, { avecPdf: g.avecPdf });
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
    // 6) traçabilité sur la demande (docSigneDestinataires CHIFFRÉ côté
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
      docSigneChemin: nomStocke,
      docSigneNom: nomFichier,
      docSigneLe: new Date(),
      docSignePar: o.declencheur || 'Système',
      docSigneErreur: envoi.erreur ? ('Envoi e-mail : ' + envoi.erreur).slice(0, 500) : null,
      docSigneDestinataires: o.chiffrerChamp ? o.chiffrerChamp(traceDest, false) : traceDest,
    };
    if (envoi.envoye) maj.docSigneEnvoiLe = new Date();
    await prisma.demandeAdministrative.update({ where: { id: demande.id }, data: maj });
    journal({
      action: 'doc-signe',
      reference: demande.reference,
      type: demande.type,
      succes: true,
      document: nomFichier,
      signatureCrypto,
      elements,
      // (v0.2.147) avertissements tracés : cause visible dans le Journal
      avertissements: avertissements || [],
      // (v0.2.148) SOURCE de configuration utilisée — divergence aperçu /
      // envoi immédiatement diagnostiquable
      source: cfg._sourceConfig || 'module-historique',
      envoi: envoi.envoye ? 'envoye' : (envoi.erreur ? 'echec' : 'absent'),
      erreur: envoi.erreur || null,
    });
    return resultat;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    resultat.erreur = detail;
    journal({
      action: 'doc-signe',
      reference: demande ? demande.reference : demandeId,
      type: demande ? demande.type : null,
      succes: false,
      code: 'DOC_SIGNE_ECHEC',
      erreur: detail,
    });
    // trace sur la demande (jamais bloquante)
    try {
      if (demande) {
        await prisma.demandeAdministrative.update({
          where: { id: demande.id },
          data: { docSigneErreur: detail.slice(0, 500) },
        });
      }
    } catch { /* */ }
    return resultat;
  }
}

/** APERÇU (bouton du panneau d'administration) : génère le document sur une
 *  demande RÉELLE (id fourni) ou sur des données de DÉMONSTRATION, sans
 *  stocker ni envoyer. Renvoie { pdf, ctx, elements, signatureCrypto }. */
async function apercuDocument(prisma, demandeId, cfg, opts) {
  let demande = null;
  if (demandeId) {
    demande = await prisma.demandeAdministrative.findUnique({ where: { id: demandeId } });
  }
  if (!demande) {
    const annee = new Date().getFullYear();
    const refDemo = 'DEM-' + annee + '-DEMO1';
    const baseDonnees = {
      typeConge: 'Congé annuel',
      dateDebut: annee + '-08-03',
      dateFin: annee + '-08-14',
      emailN1: 'manager@entreprise.tn',
      commentaire: '',
    };
    const donneesDemo = {
      CONGE: baseDonnees,
      AUTORISATION_SORTIE: {
        date: annee + '-08-03',
        departement: 'Production',
        motif: 'Démarche administrative',
        nombreHeures: '2',
        heureSortie: '09:00',
        heureRetour: '11:00',
        compensation: 'OUI',
      },
    };
    demande = {
      id: 'DEMO',
      reference: refDemo,
      type: 'CONGE',
      statut: 'ACCEPTEE',
      cin: '12345678',
      donnees: JSON.stringify(donneesDemo.CONGE),
      employeEmail: 'employe@entreprise.tn',
      destinataire: 'manager@entreprise.tn',
      traitePar: 'Auto-RH (démonstration)',
      traiteLe: new Date(),
      createdAt: new Date(),
      docSigneChemin: null,
    };
  }
  return genererDocumentSigne(prisma, demande, cfg, opts);
}

/* ------------------------------------------------------------------ */
/* EXPORTS                                                             */
/* ------------------------------------------------------------------ */
/*  (Task 180) Les outils de DESSIN et de mise en page sont exportés pour
 *  le module jumeau scripts/document-refus.js : le PDF de DÉCISION DE REFUS
 *  réutilise EXACTEMENT la même présentation (en-tête, tables zébrées,
 *  zone de signature, mention) — seule la couleur d'accent et le contenu
 *  changent. Ne JAMAIS retirer un de ces exports sans vérifier
 *  document-refus.js. */

module.exports = {
  TYPES_DOCUMENT_SIGNE,
  STATUTS_ACCEPTES,
  RECUPERATION_AUTO,
  DEFAUTS_DOC,
  chargerConfig,
  resoudreContexte,
  genererPdfAcceptation,
  tamponnerDocument,
  signerPdf,
  lireCertificat,
  verifierContenuCertificat,
  genererDocumentSigne,
  construireEmailDocumentSigne,
  traiterAcceptationFinale,
  apercuDocument,
  nomFichierDocument,
  calculerJours,
  // — (v0.2.143) moteur unifié : résolution des images + métadonnées module —
  resoudreImages,
  donneesElecDepuisModule,
  // — (v0.2.144) configuration DÉDIÉE indépendante « Réponse automatique PDF » —
  cfgDepuisReponsePdf,
  // — (v0.2.148) la section dédiée est-elle ENGAGÉE (active ou certificat importé) ?
  //    partagée avec la route d'aperçu : aperçu et génération utilisent
  //    DÉSORMAIS LA MÊME source de configuration —
  sectionDedieePrioritaire,
  donneesElecDepuisCertificatDedie,
  // — (v0.2.149) pagination anti-chevauchement (mesure + bornes de contenu) —
  hauteurTable,
  tronquerLignes,
  // — (v0.2.147) avertissements explicites certificat absent (signature + cachet) —
  avertissementsCertificat,
  // — helpers de mise en page partagés avec document-refus.js (Task 180) —
  A4,
  MARGE,
  ZONE_SIGNE,
  POSITIONS,
  formatFr,
  formatDateSimple,
  parseDonnees,
  winAnsi,
  echappeHtml,
  couperTexte,
  dessinerTable,
  dessinerTitreSection,
  variablesContexte,
  remplirVariables,
  dataUrlVersOctets,
  lignesDetail,
};
