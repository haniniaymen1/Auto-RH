/**
 * ============================================================================
 *  NOUVEAU (Task 118) — TAMPON AUTOMATIQUE DES FICHES DE PAIE : SIGNATURE
 *  ÉLECTRONIQUE ET/OU CODE QR
 * ============================================================================
 *
 *  Conforme à la demande : « après l'importation des documents, une signature
 *  électronique et/ou un code QR sur chaque fiche de paie », avec rubrique de
 *  configuration dans l'administration (onglet Importation) et intégration
 *  automatique au processus d'importation.
 *
 *  PRINCIPE — tampon appliqué AU SERVAGE (consultation / téléchargement) :
 *   - l'original stocké sur le disque reste INTACT (aucune réécriture) ;
 *   - (MODIFIÉ Task 244 — PRÉSERVATION DE LA SIGNATURE D'ORIGINE) une fiche
 *     DÉJÀ signée conserve DÉFINITIVEMENT la signature qui lui a été posée
 *     en premier : son rendu signé est FIGÉ (storage/copies-signees/, voir
 *     src/lib/copie-signee.ts) et resservi TEL QUEL par les trois points de
 *     service (administration, portail employé, QR) — changer la
 *     configuration (image, position, contenu du QR…) N'AFFECTE PLUS les
 *     fiches déjà signées ; il ne s'applique qu'aux fiches pas ENCORE
 *     signées (nouvelles fiches). Aucune re-signature automatique.
 *     (Le comportement antérieur — « s'applique immédiatement à TOUTES les
 *     fiches » — est ABROGÉ par la demande Task 244.)
 *   - le même service PDF (/api/payslips/[id]/file) couvre l'affichage ET le
 *     téléchargement de l'administration ; le portail employé (4001) possède
 *     sa JUMELLE JavaScript exacte dans scripts/portail-server.js
 *     (⚠ garder les deux alignées : empreinte, contenu QR, positions).
 *
 *  (MODIFIÉ 0.2.48) Le tampon ne se limite plus aux PDF : les fiches
 *  importées en IMAGE (PNG/JPG), en Word (.docx) et en Excel (.xlsx/.xlsm)
 *  reçoivent elles aussi la signature, le QR et la mention :
 *   - image  : composition directe sur les pixels (sharp), 1 px = 1 pt —
 *     mêmes coins/marges que le PDF ;
 *   - docx   : images ANCRÉES À LA PAGE (OOXML wp:anchor relativeFrom="page",
 *     taille de page lue dans <w:sectPr>) ajoutées à l'archive, contenu du
 *     document inchangé ;
 *   - xlsx   : images en ancrage absolu (xdr:absoluteAnchor) ajoutées À
 *     DROITE de la plage utilisée de chaque feuille sans dessin existant
 *     (une feuille contenant déjà un dessin est laissée intacte) ;
 *   - l'original stocké reste INTACT dans tous les cas, et l'échec de
 *     tamponnage sur un format = fiche servie SANS tampon (jamais bloquant).
 *   - .xls (binaire historique) reste servi tel quel.
 *
 *  SÉCURITÉ :
 *   - « Empreinte » = HMAC-SHA256(secret serveur, fiche) tronquée à 12
 *     caractères — permet à l'IT de vérifier qu'aucun champ de la fiche
 *     n'a été altéré après apposition (la matière secrète ne quitte jamais
 *     le serveur, dérivée comme le chiffrement de stockage mais avec un
 *     sel applicatif distinct « autorh-signature-v1 ») ;
 *   - le CIN complet n'apparaît dans le QR qu'en mode DONNÉES (il figure
 *     déjà sur la fiche elle-même) ; l'interface le masque ailleurs ;
 *   - échec de tamponnage = fiche servie SANS tampon (jamais bloquant).
 * ============================================================================
 */
import crypto from "crypto";
import { PDFDocument, StandardFonts, rgb, degrees, PDFFont, PDFPage } from "pdf-lib";
import QRCode from "qrcode";

/** Configuration effective attendue par le moteur (champs de SignatureConfig). */
export interface ConfigTampon {
  actif: boolean;
  sigActif: boolean;
  sigImage: string;
  sigTexte: string;
  sigPosition: string;
  sigTaille: number;
  sigOpacite: number;
  qrActif: boolean;
  qrMode: string;
  qrUrl: string;
  qrTexte: string;
  qrImage: string;
  qrPosition: string;
  qrTaille: number;
  sigDecalX: number;
  sigDecalY: number;
  qrDecalX: number;
  qrDecalY: number;
  // (NOUVEAU 0.2.54) rotations en degrés SENS HORAIRE, 0 → 360 — l'élément
  // pivote autour de son propre centre sur TOUS les formats (PDF : rotation
  // native pdf-lib ; image/DOCX/XLSX : rotation cuite dans le PNG de surface).
  sigRotation: number;
  qrRotation: number;
  mentionActif: boolean;
  mentionTexte: string;
  // ---- (NOUVEAU v0.2.88) CERTIFICAT DE SIGNATURE — Switch ON/OFF (demande
  // utilisateur) : quand certActif est VRAI et qu'un certificat est importé
  // (champs métadonnées du Task 181), un bloc « certificat » lisible est
  // dessiné sur le document ; certActif FAUX = certificat JAMAIS dessiné.
  // Champs optionnels : les appelants historiques (config lue en base, qui
  // porte déjà ces colonnes) les propagent tels quels.
  certActif?: boolean;
  certSujet?: string;
  certEmetteur?: string;
  certSerie?: string;
  certValideAu?: Date | string | null;
  certEmpreinte?: string;
  // ---- (NOUVEAU v0.2.92) POSITIONNEMENT LIBRE du bloc certificat — même
  // mécanisme que la signature (sigDecalX/Y) et le QR (qrDecalX/Y) :
  // BAS_CENTRE (défaut) = rendu historique exact (centré au-dessus de la
  // mention) ; les 4 coins passent par coinVersBoite. certTaille = échelle
  // du bloc en % (50 → 300, défaut 100). Champs optionnels : config lue en
  // base porte déjà ces colonnes ; appelants historiques inchangés.
  certPosition?: string;
  certDecalX?: number;
  certDecalY?: number;
  certTaille?: number;
  // ---- (NOUVEAU v0.2.119) ÉLÉMENT « SIGNATURE ÉLECTRONIQUE » DU TAMPON ----
  // Encadré apposé comme un vrai cachet, alimenté EN DIRECT par le
  // certificat chargé dans le MODULE de signature (SignatureApiConfig,
  // onglet « Paramètres ») — AUCUNE réimportation du certificat dans la
  // section tampon : l'appelant injecte les métadonnées (elec) au moment
  // de l'apposition, le contenu n'est JAMAIS stocké dans la configuration.
  // Le bloc n'est apposé que si le module est ACTIF pour le périmètre
  // concerné (fiches / réponses) ET porte un certificat : un document
  // tamponné « Signature électronique » est toujours réellement signé
  // (la signature PAdES est appliquée JUSTE APRÈS le tamponnage, sur ces
  // mêmes octets — le bloc est donc couvert par la signature).
  elecActif?: boolean;
  elecPosition?: string;
  elecDecalX?: number;
  elecDecalY?: number;
  elecTaille?: number;
  // ---- (NOUVEAU v0.2.120) FORME du cachet : RECTANGLE (bloc encadré
  // historique v0.2.119) ou ROND (cachet circulaire de type « cachet
  // d'entreprise » — exemple utilisateur : organisation en arc supérieur,
  // « SIGNATURE ÉLECTRONIQUE » en arc inférieur, titulaire en gras au
  // centre). Même contenu, même garantie cachet ⇒ signature PAdES.
  elecForme?: string;
  // ---- (NOUVEAU v0.2.128) CONTENU du cachet — CHOIX DES INFORMATIONS ----
  // Demande utilisateur : ne plus afficher les informations du certificat,
  // et fournir un formulaire pour CHOISIR les informations affichées. PAR
  // DÉFAUT AUCUNE information du certificat n'est affichée : le cachet porte
  // uniquement la mention « SIGNATURE ÉLECTRONIQUE ». Chaque interrupteur
  // fait figurer UNE information du certificat chargé (lu EN DIRECT par
  // completerConfigTamponAvecElec — jamais stocké) ; elecTexteLibre ajoute
  // une ligne PERSONNALISÉE (≤ 120 car., déterministe — jamais une date).
  elecAffSignataire?: boolean; // « Signataire : » (CN du certificat)
  elecAffOrganisation?: boolean; // organisation (O du certificat)
  elecAffEmetteur?: boolean; // « Émetteur : » (autorité de certification)
  elecAffValidite?: boolean; // « Valide jusqu'au … » (fin de validité)
  elecAffEmpreinte?: boolean; // « Certificat SHA-256 : … » (empreinte)
  elecTexteLibre?: string; // ligne personnalisée du cachet
  /** Métadonnées injectées par l'appelant (jamais stockées en base). */
  elec?: DonneesSignatureElec;
}

/**
 * (NOUVEAU v0.2.119) Données de l'élément « Signature électronique » :
 * métadonnées PUBLIQUES du certificat du module de signature, lues au
 * moment de l'apposition. Deterministes (aucune horodatage) : le contenu
 * tamponné reste identique entre l'import et le servage (cache par
 * empreinte préservé).
 */
export interface DonneesSignatureElec {
  /** Sujet brut du certificat (ex. « CN=Jean Dupont, O=MA SOCIETE SARL, C=TN »). */
  certSujet: string;
  /** Émetteur (autorité de certification). */
  certEmetteur?: string;
  /** Empreinte SHA-256 du certificat (hex). */
  certEmpreinte?: string;
  /** Fin de validité (affichée en format français court). */
  certValideAu?: Date | string | null;
}

/** Champs de la fiche nécessaires au QR / à l'empreinte. */
export interface InfosFiche {
  id: string;
  employeeName?: string | null;
  cin?: string | null;
  period?: string | null;
  netSalary?: string | null;
  uploadedAt: Date | string;
  // NOUVEAU (v0.2.51) — réponse RH à une demande administrative : un document
  // importé depuis le détail de la demande (attestation, arrêté…) peut être
  // tamponné avec les MÊMES moteurs. `titre` personnalise la 1re ligne du QR
  // (sinon comportement historique STRICTEMENT IDENTIQUE — jumelle portail
  // intacte, elle ne tamponne que des fiches de paie). `objet` remplace le
  // libellé « Période » du QR quand il est fourni.
  titre?: string;
  objet?: string;
  // (NOUVEAU v0.2.88 — Réponses via QR Code et URL) adresse publique de
  // vérification PROPRE AU DOCUMENT DE RÉPONSE —
  //   {qrUrl}/verification/reponse/{reference}?t={jeton signé}
  // Quand il est présent, le QR du document encode DIRECTEMENT cette URL
  // (même comportement que le QR « Fiche en ligne » des fiches de paie).
  // UNIQUEMENT pour les documents de réponse RH — JAMAIS défini sur les
  // fiches de paie (comportement des fiches strictement inchangé).
  urlVerification?: string;
}

/** Le tampon est-il activé ET au moins un élément à dessiner ?
 * (MODIFIÉ v0.2.88) le certificat de signature (Switch certActif) compte
 * lui aussi comme élément : Switch ON + certificat importé = tampon actif
 * même sans signature / QR / mention. */
export function tamponActif(cfg: Partial<ConfigTampon> | null | undefined): boolean {
  if (!cfg || !cfg.actif) return false;
  return Boolean(
    cfg.sigActif || cfg.qrActif || cfg.mentionActif || certificatAffichable(cfg) || signatureElecAffichable(cfg)
  );
}

/* ------------------------------------------------------------------ */
/* (NOUVEAU v0.2.88) — CERTIFICAT DE SIGNATURE (Switch ON/OFF)         */
/* ------------------------------------------------------------------ */

/**
 * Le bloc certificat doit-il être dessiné ? VRAI uniquement si le Switch
 * certActif est ON (demande utilisateur : « lorsqu'il est activé, la
 * signature certificate est appliquée aux documents concernés ; lorsqu'il
 * est désactivé, elle n'est pas appliquée ») ET qu'un certificat importé
 * porte des métadonnées exploitables (Task 181).
 */
export function certificatAffichable(
  cfg: Partial<ConfigTampon> | null | undefined
): boolean {
  return Boolean(
    cfg && cfg.certActif && String(cfg.certSujet ?? "").trim() && String(cfg.certEmpreinte ?? "").trim()
  );
}

/**
 * (NOUVEAU v0.2.92) Échelle du bloc certificat : certTaille (50 → 300, en %)
 * divisée par 100, valeur sûre (défaut 1 = rendu historique 6,5 pt).
 * Jumelle JS obligatoire côté portail (echelleCertificatTampon).
 */
export function echelleCertificat(cfg: Partial<ConfigTampon> | null | undefined): number {
  const n = Number(cfg?.certTaille);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(0.5, Math.min(3, n / 100));
}

/** Lignes du bloc certificat dessiné sur le document (texte compact 6,5 pt). */
export function lignesCertificat(cfg: Partial<ConfigTampon>): string[] {
  if (!certificatAffichable(cfg)) return [];
  const sujet = String(cfg.certSujet ?? "").trim();
  const emetteur = String(cfg.certEmetteur ?? "").trim();
  const serie = String(cfg.certSerie ?? "").trim().slice(0, 24);
  const jusquAu = cfg.certValideAu ? dateFr(cfg.certValideAu) : "";
  const empreinte = String(cfg.certEmpreinte ?? "").replace(/\s+/g, "").toUpperCase();
  return [
    `Signature électronique certifiée — Titulaire : ${sujet}`,
    emetteur ? `Émetteur : ${emetteur}${jusquAu ? ` — Valide jusqu'au ${jusquAu}` : ""}` : jusquAu ? `Valide jusqu'au ${jusquAu}` : "",
    `Certificat SHA-256 : ${empreinte.slice(0, 48)}${empreinte.length > 48 ? "…" : ""}${serie ? ` — N° ${serie}` : ""}`,
  ].filter((l) => l.trim());
}

/* ------------------------------------------------------------------ */
/* (NOUVEAU v0.2.119) — ÉLÉMENT « SIGNATURE ÉLECTRONIQUE » DU TAMPON   */
/* ------------------------------------------------------------------ */

/**
 * Extrait le CN (titulaire) et l'O (organisation) d'un sujet X.509 brut
 * (« CN=Jean Dupont, O=MA SOCIETE SARL, C=TN » → { cn, o }). Jumelle JS
 * obligatoire côté portail (sujetVersTitulaireTampon).
 */
export function sujetVersTitulaire(sujet: string): { cn: string; o: string } {
  const s = String(sujet ?? "");
  const cn = /(?:^|,\s*)CN=([^,]+)/i.exec(s)?.[1]?.trim() ?? "";
  const o = /(?:^|,\s*)O=([^,]+)/i.exec(s)?.[1]?.trim() ?? "";
  return { cn, o };
}

/**
 * L'élément « Signature électronique » doit-il être dessiné ? VRAI
 * uniquement si le Switch elecActif est ON ET que l'appelant a injecté des
 * données de certificat exploitables (module actif + certificat chargé —
 * voir completerConfigTamponAvecElec de signature-api.ts). Un bloc
 * « Signature électronique » n'est JAMAIS apposé sur un document qui ne
 * sera pas réellement signé.
 */
export function signatureElecAffichable(
  cfg: Partial<ConfigTampon> | null | undefined
): boolean {
  return Boolean(
    cfg &&
      cfg.elecActif &&
      cfg.elec &&
      (String(cfg.elec.certSujet ?? "").trim() || String(cfg.elec.certEmpreinte ?? "").trim())
  );
}

/** Échelle du bloc (elecTaille 50 → 300 %, défaut 1). Jumelle JS :
 * echelleElecTampon. */
export function echelleElec(cfg: Partial<ConfigTampon> | null | undefined): number {
  const n = Number(cfg?.elecTaille);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(0.5, Math.min(3, n / 100));
}

/**
 * Lignes du bloc « Signature électronique » (cachet encadré) : titre en
 * gras, puis les informations du certificat CHOISIES dans le formulaire
 * (v0.2.128) — signataire, organisation, émetteur, validité, empreinte, et
 * la ligne personnalisée elecTexteLibre. PAR DÉFAUT (aucun interrupteur ON)
 * le bloc se réduit à la mention « SIGNATURE ÉLECTRONIQUE » seule : AUCUNE
 * information du certificat n'est affichée (demande utilisateur). Contenu
 * 100 % déterministe (aucune date d'apposition) pour préserver le cache
 * par empreinte (import = servage). Jumelle JS : lignesSignatureElecTampon
 * ET jumelle client lignesSignatureElecApercu (apercu-positionnement.tsx).
 */
export function lignesSignatureElec(cfg: Partial<ConfigTampon>): string[] {
  if (!signatureElecAffichable(cfg)) return [];
  const elec = cfg.elec as DonneesSignatureElec;
  const { cn, o } = sujetVersTitulaire(elec.certSujet);
  const titulaire = cn || String(elec.certSujet ?? "").trim();
  const emetteur = String(elec.certEmetteur ?? "").trim();
  const empreinte = String(elec.certEmpreinte ?? "").replace(/\s+/g, "").toUpperCase();
  const jusquAu = elec.certValideAu ? dateFr(elec.certValideAu) : "";
  const libre = String(cfg.elecTexteLibre ?? "").trim();
  return [
    "SIGNATURE ÉLECTRONIQUE",
    // (v0.2.128) chaque ligne n'est dessinée QUE si son interrupteur est ON :
    Boolean(cfg.elecAffSignataire) && titulaire ? `Signataire : ${titulaire}` : "",
    Boolean(cfg.elecAffOrganisation) ? o : "",
    Boolean(cfg.elecAffEmetteur) && emetteur ? `Émetteur : ${emetteur}` : "",
    Boolean(cfg.elecAffValidite) && jusquAu ? `Valide jusqu'au ${jusquAu}` : "",
    Boolean(cfg.elecAffEmpreinte) && empreinte
      ? `Certificat SHA-256 : ${empreinte.slice(0, 24)}${empreinte.length > 24 ? "…" : ""}`
      : "",
    libre,
  ].filter((l) => l.trim());
}

/* ------------------------------------------------------------------ */
/* (NOUVEAU v0.2.120) CACHET ROND « SIGNATURE ÉLECTRONIQUE »           */
/* ------------------------------------------------------------------ */

/**
 * (NOUVEAU v0.2.120) FORME du cachet « Signature électronique » :
 * « ROND » = cachet circulaire de type cachet d'entreprise, toute autre
 * valeur (ou absente) = bloc encadré RECTANGLE historique (v0.2.119).
 * Jumelle client : cfg.elecForme === "ROND" dans apercu-positionnement.tsx.
 */
export function formeElec(cfg: Partial<ConfigTampon> | null | undefined): "RECTANGLE" | "ROND" {
  return String(cfg?.elecForme ?? "").trim().toUpperCase() === "ROND" ? "ROND" : "RECTANGLE";
}

/** Diamètre de base du cachet ROND en points PDF (× echelleElec) — ≈ 42 mm
 * à 100 %, comparable au bloc rectangulaire historique. */
const DIAMETRE_CACHET_ROND = 120;

export function diametreCachetRond(cfg: Partial<ConfigTampon> | null | undefined): number {
  return DIAMETRE_CACHET_ROND * echelleElec(cfg);
}

/** Couleur du cachet rond — bleu « encre de cachet » (exemple utilisateur
 * #2A57A6). Identique sur les 4 moteurs (PDF rgb / SVG hex). */
export const COULEUR_CACHET_ROND = { r: 0.165, g: 0.34, b: 0.65 };
export const COULEUR_CACHET_ROND_HEX = "#2a57a6";

/**
 * (NOUVEAU v0.2.120) CONTENU du cachet ROND « Signature électronique » —
 * même discipline déterministe que lignesSignatureElec (aucune date
 * d'apposition, cache par empreinte préservé). Décomposé par zones :
 *   - arcHaut : ORGANISATION (O du certificat, repli titulaire) ;
 *   - arcBas  : « SIGNATURE ÉLECTRONIQUE » (mention fixe) ;
 *   - centre  : titulaire (CN) EN GRAS, validité, empreinte — empilés du
 *     haut vers le bas par le moteur. Retourne null si rien d'affichable.
 */
export interface ContenuCachetRond {
  arcHaut: string;
  arcBas: string;
  centre: { texte: string; gras: boolean; taille: number }[];
}
export function contenuCachetRond(cfg: Partial<ConfigTampon>): ContenuCachetRond | null {
  if (!signatureElecAffichable(cfg)) return null;
  const elec = cfg.elec as DonneesSignatureElec;
  const sujet = String(elec.certSujet ?? "").trim();
  const cn = /(?:^|,\s*)CN=([^,]+)/i.exec(sujet)?.[1]?.trim() || sujet;
  const o = /(?:^|,\s*)O=([^,]+)/i.exec(sujet)?.[1]?.trim() || "";
  const empreinte = String(elec.certEmpreinte ?? "").replace(/\s+/g, "").toUpperCase();
  const jusquAu = elec.certValideAu ? dateFr(elec.certValideAu) : "";
  // (v0.2.128) CHOIX DES INFORMATIONS : chaque zone n'est alimentée QUE si
  // son interrupteur est ON. Par défaut : arcHaut vide, centre vide — le
  // cachet se réduit aux cercles + mention « SIGNATURE ÉLECTRONIQUE ».
  const affSignataire = Boolean(cfg.elecAffSignataire);
  const affOrganisation = Boolean(cfg.elecAffOrganisation);
  const affValidite = Boolean(cfg.elecAffValidite);
  const affEmpreinte = Boolean(cfg.elecAffEmpreinte);
  const libre = String(cfg.elecTexteLibre ?? "").trim();
  const arcHaut = ((affOrganisation && o) || (affSignataire && cn) || "").toUpperCase().slice(0, 34);
  const affEmetteur = Boolean(cfg.elecAffEmetteur);
  const emetteur = String(elec.certEmetteur ?? "").trim();
  const centre: ContenuCachetRond["centre"] = [];
  if (affSignataire && cn) {
    centre.push({ texte: texteWinAnsi(cn), gras: true, taille: 1 });
    // ligne personnalisée : petite ligne sous le titulaire (ordre stable)
    if (libre)
      centre.push({ texte: texteWinAnsi(libre), gras: false, taille: 0.52 });
  } else if (libre) {
    // sans titulaire affiché, la ligne personnalisée devient le contenu
    // principal (gras) du cachet — jamais un cachet « vide ».
    centre.push({ texte: texteWinAnsi(libre), gras: true, taille: 0.9 });
  }
  if (affEmetteur && emetteur)
    centre.push({ texte: texteWinAnsi(`Émetteur : ${emetteur}`), gras: false, taille: 0.5 });
  if (affValidite && jusquAu)
    centre.push({ texte: texteWinAnsi(`Valide jusqu'au ${jusquAu}`), gras: false, taille: 0.52 });
  if (affEmpreinte && empreinte)
    centre.push({
      texte: texteWinAnsi(`Cert. SHA-256 : ${empreinte.slice(0, 16)}…`),
      gras: false,
      taille: 0.46,
    });
  // (MODIFIÉ v0.2.128) plus de retour null quand le sujet est masqué : le
  // cachet est apposé dès que la signature PAdES couvre le document — son
  // CONTENU, lui, obéit au formulaire de choix (mention seule possible).
  return { arcHaut: texteWinAnsi(arcHaut), arcBas: texteWinAnsi("SIGNATURE ÉLECTRONIQUE"), centre };
}

/* ------------------------------------------------------------------ */
/* (NOUVEAU v0.2.121) CACHET RECTANGULAIRE « COMME LE ROND »           */
/* ------------------------------------------------------------------ */

/** Structure minimale partagée par les PDFFont pdf-lib et les métriques
 * Helvetica du rasteriseur SVG (widthOfTextAtSize suffit). */
interface FontAvecMetriques {
  widthOfTextAtSize(texte: string, taille: number): number;
}

/** Tronque une ligne avec « … » jusqu'à tenir dans largeurMax (même
 * discipline que le contenu central du cachet ROND). */
function tronquerLigneCachet(
  texte: string,
  taille: number,
  font: FontAvecMetriques,
  largeurMax: number
): string {
  let t = texte;
  while (t.length > 4 && font.widthOfTextAtSize(t, taille) > largeurMax) {
    t = t.slice(0, -2).trimEnd() + "…";
  }
  return t;
}

/**
 * (NOUVEAU v0.2.121) GÉOMÉTRIE du cachet RECTANGULAIRE refait « comme le
 * ROND » : mêmes contenus déterministes (contenuCachetRond : organisation
 * en en-tête, titulaire CN en gras + validité + empreinte, mention
 * « SIGNATURE ÉLECTRONIQUE »), même encre bleue, mais dans un DOUBLE
 * CADRE rectangulaire (extérieur épais + intérieur fin — équivalent des
 * deux cercles concentriques). Largeur = contenu réel mesuré (bornée
 * 130–240 pt × échelle), hauteur = empilement fixe des zones. Les
 * CONSTANTES de l'empilement sont partagées par les 3 moteurs (PDF,
 * surface SVG, aperçu client) : toute évolution doit être répercutée
 * dans surfaceSignatureElec (stamp.ts) ET apercu-positionnement.tsx.
 */
export interface GeometrieCachetRectangle {
  /** Dimensions TOTALES (bord extérieur inclus) en points PDF. */
  wPt: number;
  hPt: number;
  /** Échelle (echelleElec) — multiplicative pour traits et interlignes. */
  echelle: number;
  org: { texte: string; taille: number };
  nom: { texte: string; taille: number };
  /** Validité + empreinte (petites lignes centrées sous le séparateur). */
  petites: { texte: string; taille: number }[];
  mention: { texte: string; taille: number };
}

/** Constantes d'empilement (× échelle) — DOUBLES du moteur PDF, de la
 * surface SVG et de l'aperçu client. */
export const CACHET_RECT = {
  padH: 6.5, // marge verticale intérieure (haut et bas)
  padX: 9, // marge horizontale intérieure (sous le cadre fin)
  cadre: 3.5, // écart cadre épais → cadre fin
  corpsOrg: 8, // corps de l'organisation (gras)
  g1: 4, // organisation → ligne séparatrice
  trait: 0.7, // épaisseur de la ligne séparatrice
  g2: 5, // ligne séparatrice → titulaire
  corpsNom: 10.5, // corps du titulaire (gras) — identique au ROND
  pasNom: 12.6, // avance verticale du titulaire (corps × 1,2)
  sep: 6.5, // zone du séparateur « — • — »
  pasPetite: 7.4, // avance de chaque petite ligne (validité)
  pasPetite2: 7.0, // avance empreinte (légèrement plus serrée)
  g3: 2.5, // dernière petite ligne → mention
  corpsMention: 6.8, // corps de « SIGNATURE ÉLECTRONIQUE »
  pasMention: 8.5, // avance verticale de la mention
  wMin: 130, // largeur minimale (= diamètre du ROND, cohérence visuelle)
  wMax: 240, // largeur maximale (les lignes sont tronquées pour y tenir)
} as const;

/**
 * Calcule la géométrie complète du cachet RECTANGULAIRE (v0.2.121) à partir
 * du MÊME contenu que le ROND. Retourne null si contenuCachetRond est null
 * (repli sur le rendu historique v0.2.119). `font`/`fontGras` servent à
 * mesurer (et tronquer) les lignes — PDFFont pdf-lib OU métriques SVG.
 */
export function geometrieCachetRectangle(
  cfg: Partial<ConfigTampon>,
  font: FontAvecMetriques,
  fontGras: FontAvecMetriques
): GeometrieCachetRectangle | null {
  const rond = contenuCachetRond(cfg);
  if (!rond) return null;
  const S = echelleElec(cfg);
  const C = CACHET_RECT;
  const largeurUtile = C.wMax * S - 2 * (C.padX + C.cadre) * S;
  // Petites lignes (validité + empreinte) — mêmes tailles que le ROND.
  const petites = rond.centre
    .filter((l) => !l.gras)
    .map((l) => ({
      texte: tronquerLigneCachet(l.texte, Math.max(4.2, l.taille * C.corpsNom) * S, font, largeurUtile),
      taille: Math.max(4.2, l.taille * C.corpsNom) * S,
    }));
  const nomBrut = rond.centre.find((l) => l.gras);
  const org = {
    texte: tronquerLigneCachet(rond.arcHaut, C.corpsOrg * S, fontGras, largeurUtile),
    taille: C.corpsOrg * S,
  };
  const nom = {
    texte: nomBrut ? tronquerLigneCachet(nomBrut.texte, C.corpsNom * S, fontGras, largeurUtile) : "",
    taille: C.corpsNom * S,
  };
  const mention = {
    texte: tronquerLigneCachet(rond.arcBas, C.corpsMention * S, font, largeurUtile),
    taille: C.corpsMention * S,
  };
  // (NOUVEAU v0.2.128) ZONES CONDITIONNELLES : avec le formulaire de choix,
  // les zones en-tête (organisation), titulaire et petites lignes peuvent
  // être vides — elles ne consomment alors AUCUNE hauteur (le cachet se
  // compacte ; mention seule = hauteur minimale). Même logique dans les
  // jumeaux de dessin (moteur PDF, surface SVG, aperçu client).
  const hasOrg = Boolean(org.texte);
  const hasNom = Boolean(nom.texte);
  const hasPetites = petites.length > 0;
  const wContenu = Math.max(
    org.texte ? fontGras.widthOfTextAtSize(org.texte, org.taille) : 0,
    nom.texte ? fontGras.widthOfTextAtSize(nom.texte, nom.taille) : 0,
    mention.texte ? font.widthOfTextAtSize(mention.texte, mention.taille) : 0,
    ...petites.map((l) => font.widthOfTextAtSize(l.texte, l.taille)),
    0
  );
  const wPt = Math.max(
    C.wMin * S,
    Math.min(C.wMax * S, wContenu + 2 * (C.padX + C.cadre) * S)
  );
  const hPt =
    (C.padH +
      (hasOrg ? C.corpsOrg + C.g1 + C.trait + C.g2 : 0) +
      (hasNom ? C.pasNom + C.sep : 0) +
      petites.reduce((a, l, i) => a + (i === 0 ? C.pasPetite : C.pasPetite2), 0) +
      (hasPetites ? C.g3 : 0) +
      C.pasMention +
      C.padH) *
    S;
  return { wPt, hPt, echelle: S, org, nom, petites, mention };
}

/**
 * (NOUVEAU v0.2.120) Dessine un TEXTE EN ARC sur une page PDF (pdf-lib) —
 * chaque caractère est positionné et tourné individuellement le long du
 * cercle (centré sur l'arc). Rotation pdf-lib : SENS ANTI-HORAIRE (degrés).
 *   - arc HAUT (sommet 90°) : lecture de gauche à droite en traversant le
 *     sommet, rotation = 90° − a° (le CORPS du glyphe s'étend vers
 *     l'EXTÉRIEUR : la base est posée par l'appelant à rayon − 0,35·taille) ;
 *   - arc BAS (270°) : lecture de gauche à droite PAR LE BAS, rotation =
 *     a° − 270° ; le corps s'étend vers le CENTRE (style cachet) — base à
 *     rayon + 0,35·taille (ajustements faits par l'appelant).
 * INTERLETTRAGE : un espacement de 0,18·taille entre caractères (style
 * cachet — lettres aérées comme l'exemple utilisateur).
 */
function dessinerArcCachetPdf(
  page: PDFPage,
  texte: string,
  cx: number,
  cy: number,
  rayon: number,
  taille: number,
  font: PDFFont,
  couleur: ReturnType<typeof rgb>,
  position: "HAUT" | "BAS"
): void {
  const caracteres = Array.from(texte);
  if (!caracteres.length || rayon <= 1) return;
  const espacement = taille * 0.18;
  const largeurs = caracteres.map((c) => font.widthOfTextAtSize(c, taille));
  const total = largeurs.reduce((a, b) => a + b, 0) + espacement * (caracteres.length - 1);
  if (total <= 0) return;
  // Amplitude angulaire : longueur d'arc = largeur du texte (+ marge d'un
  // caractère), bornée à 150° pour ne jamais boucler sur le cercle.
  const amplitude = Math.min((150 * Math.PI) / 180, (total + taille * 1.6) / rayon);
  const pas = amplitude / total; // radians par point de largeur
  let a: number;
  if (position === "HAUT") {
    a = Math.PI / 2 + amplitude / 2; // départ à GAUCHE du sommet (lecture →)
    for (let i = 0; i < caracteres.length; i++) {
      a -= ((largeurs[i] + espacement) / 2) * pas;
      page.drawText(caracteres[i], {
        x: cx + rayon * Math.cos(a),
        y: cy + rayon * Math.sin(a),
        size: taille,
        font,
        color: couleur,
        rotate: degrees(90 - (a * 180) / Math.PI),
      });
      a -= ((largeurs[i] + espacement) / 2) * pas;
    }
  } else {
    a = -Math.PI / 2 - amplitude / 2; // départ à GAUCHE du bas (lecture →)
    for (let i = 0; i < caracteres.length; i++) {
      a += ((largeurs[i] + espacement) / 2) * pas;
      page.drawText(caracteres[i], {
        x: cx + rayon * Math.cos(a),
        y: cy + rayon * Math.sin(a),
        size: taille,
        font,
        color: couleur,
        rotate: degrees((a * 180) / Math.PI + 90),
      });
      a += ((largeurs[i] + espacement) / 2) * pas;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Empreinte HMAC (identique côté portail — ne pas modifier seul)      */
/* ------------------------------------------------------------------ */

const SEL_SIGNATURE = "autorh-signature-v1";

function keyMaterial(): string {
  return (
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
    process.env.AUTH_SECRET ||
    "autorh-storage-local-a-changer-dans-env"
  );
}

let _cleEmpreinte: Buffer | null = null;
function cleEmpreinte(): Buffer {
  if (!_cleEmpreinte) _cleEmpreinte = crypto.scryptSync(keyMaterial(), SEL_SIGNATURE, 32);
  return _cleEmpreinte;
}

/** Charge utile commune (TS ⇄ JS portail) : mêmes champs, même ordre. */
export function chargeEmpreinte(f: InfosFiche): string {
  const up =
    f.uploadedAt instanceof Date
      ? f.uploadedAt.toISOString()
      : new Date(f.uploadedAt).toISOString();
  return [f.id, f.cin ?? "", f.period ?? "", f.netSalary ?? "", up].join("|");
}

/** Empreinte de contrôle = HMAC-SHA256 → 12 caractères hex MAJUSCULES. */
export function empreinteFiche(f: InfosFiche): string {
  return crypto
    .createHmac("sha256", cleEmpreinte())
    .update(chargeEmpreinte(f))
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
}

/** Date en format français court (13/09/2026 14:32). */
export function dateFr(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// NOUVEAU (Task 180, v0.2.86) — JETON DE LA FICHE EN LIGNE : jeton signé
// propre à chaque fiche, encodé dans le QR « Fiche en ligne » —
//   {qrUrl}/verification/fiche/{id}?t={jeton}
// HMAC-SHA256 dérivé du SEUL id (non expirant, révocable en supprimant la
// fiche) ; jumelle EXACTE jetonFicheTampon() de portail-server.js.
const DOMAINE_JETON_FICHE = "fiche-en-ligne-v1";

/** Jeton signé de la fiche en ligne = HMAC-SHA256(id) → 24 caractères hex MAJUSCULES. */
export function jetonFiche(f: Pick<InfosFiche, "id">): string {
  return crypto
    .createHmac("sha256", cleEmpreinte())
    .update(DOMAINE_JETON_FICHE + "|" + f.id)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
}

/**
 * Comparaison EN TEMPS CONSTANT du jeton fourni (query « t ») avec le jeton
 * attendu — évite de faire fuir la longueur/valeur du jeton par des mesures
 * de temps de réponse. Tout jeton mal formé (longueur différente) est refusé.
 */
export function jetonFicheValide(id: string, fourni: string | null | undefined): boolean {
  const attendu = jetonFiche({ id });
  if (!fourni || fourni.length !== attendu.length) return false;
  return crypto.timingSafeEqual(Buffer.from(fourni.toUpperCase()), Buffer.from(attendu));
}

// NOUVEAU (v0.2.88) — JETON DE VÉRIFICATION D'UNE RÉPONSE À UNE DEMANDE :
// même principe que le QR « Fiche en ligne » (Task 180) appliqué aux
// documents de réponse RH —
//   {qrUrl}/verification/reponse/{reference}?t={jeton}
// HMAC-SHA256 dérivé de la SEULE référence de la demande (non expirant,
// révocable en supprimant la demande) ; jumelle JS jetonReponseTampon()
// de portail-server.js à maintenir alignée.
const DOMAINE_JETON_REPONSE = "reponse-en-ligne-v1";

/** Jeton signé de la page de vérification d'une réponse = HMAC-SHA256(reference) → 24 hex MAJUSCULES. */
export function jetonReponse(reference: string): string {
  return crypto
    .createHmac("sha256", cleEmpreinte())
    .update(DOMAINE_JETON_REPONSE + "|" + String(reference ?? ""))
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
}

/** Comparaison EN TEMPS CONSTANT du jeton d'une réponse (même discipline que jetonFicheValide). */
export function jetonReponseValide(reference: string, fourni: string | null | undefined): boolean {
  const attendu = jetonReponse(reference);
  if (!fourni || fourni.length !== attendu.length) return false;
  return crypto.timingSafeEqual(Buffer.from(fourni.toUpperCase()), Buffer.from(attendu));
}

/* ------------------------------------------------------------------ */
/* Contenu du QR (identique côté portail — ne pas modifier seul)       */
/* ------------------------------------------------------------------ */

export function contenuQr(f: InfosFiche, cfg: ConfigTampon): string {
  // (NOUVEAU v0.2.88) — RÉPONSES VIA QR CODE ET URL : un document de réponse
  // RH porteur de `urlVerification` encode DIRECTEMENT l'adresse publique de
  // vérification (même principe que le QR « Fiche en ligne » des fiches de
  // paie du portail). Priorité sur TOUS les modes : la réponse doit rester
  // accessible par URL quelle que soit la configuration QR de l'établissement.
  // Les fiches de paie n'ont JAMAIS ce champ → comportement strictement
  // inchangé pour elles (aucune branche suivante modifiée).
  const urlReponse = String((f as InfosFiche).urlVerification ?? "").trim();
  if (urlReponse) return urlReponse;
  if (cfg.qrMode === "TEXTE") {
    return String(cfg.qrTexte ?? "").trim();
  }
  // NOUVEAU (Task 180, v0.2.86) — MODE « FICHE EN LIGNE » : le QR encode
  // l'adresse PUBLIQUE de vérification PROPRE À CETTE fiche —
  //   {adresse}/verification/fiche/{id}?t={jeton signé}
  // le scan ouvre la page de vérification (carte « Document authentique » +
  // détails + bouton d'ouverture du PDF tamponné), SANS connexion. L'adresse
  // (qrUrl, champ partagé avec le mode URL) doit couvrir protocole + hôte +
  // port du site d'administration (ex. http://192.168.1.20:4000) — elle est
  // figée dans le QR imprimé : une adresse vide = QR non apposé (comme le
  // mode URL). Jumelle portail : contenuQrTampon() de portail-server.js.
  if (cfg.qrMode === "FICHE") {
    const base = String(cfg.qrUrl ?? "").trim().replace(/\/+$/, "");
    if (!base) return "";
    return base + "/verification/fiche/" + f.id + "?t=" + jetonFiche(f);
  }
  if (cfg.qrMode === "URL") {
    const base = String(cfg.qrUrl ?? "").trim();
    if (!base) return "";
    const sep = base.includes("?") ? "&" : "?";
    return (
      base +
      sep +
      "ref=" +
      encodeURIComponent(f.id) +
      "&cin=" +
      encodeURIComponent(f.cin ?? "") +
      "&h=" +
      empreinteFiche(f)
    );
  }
  // Mode DONNÉES (défaut) : carte d'identité de la fiche lisible par tout
  // lecteur QR — permet de vérifier d'un coup d'œil la cohérence du document.
  // (MODIFIÉ v0.2.51) un DOCUMENT DE DEMANDE (réponse RH importée depuis le
  // détail) fournit `titre` : en-tête et libellés adaptés, lignes vides omises
  // — SANS titre, les lignes historiques restent STRICTEMENT identiques
  // (jumelle portail non modifiée : elle ne tamponne que des fiches).
  const titre = String((f as InfosFiche).titre ?? "").trim();
  if (titre) {
    const objet = String((f as InfosFiche).objet ?? "").trim();
    return [
      titre,
      `Réf : ${f.id}`,
      ...(String(f.employeeName ?? "").trim()
        ? [`Employé : ${String(f.employeeName).trim()}`]
        : []),
      ...(String(f.cin ?? "").trim() ? [`CIN : ${String(f.cin).trim()}`] : []),
      ...(objet ? [`Objet : ${objet}`] : []),
      `Émis le : ${dateFr(f.uploadedAt)}`,
      `Empreinte : ${empreinteFiche(f)}`,
    ].join("\n");
  }
  return [
    "AutoRH — Fiche de paie",
    `Réf : ${f.id}`,
    `Employé : ${String(f.employeeName ?? "").trim() || "—"}`,
    `CIN : ${String(f.cin ?? "").trim() || "—"}`,
    `Période : ${String(f.period ?? "").trim() || "—"}`,
    `Net à payer : ${String(f.netSalary ?? "").trim() || "—"}`,
    `Importée le : ${dateFr(f.uploadedAt)}`,
    `Empreinte : ${empreinteFiche(f)}`,
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Placement (identique côté portail — ne pas modifier seul)           */
/* ------------------------------------------------------------------ */

const MARGE = 24;
const HAUT_MENTION = 22; // réserve au-dessus du bord inférieur pour la mention
const ECART_ELEMENTS = 14; // écart horizontal si signature et QR partagent un coin

interface Boite {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * (NOUVEAU v0.2.92) Placement du BLOC CERTIFICAT :
 *   - position « BAS_CENTRE » (défaut) : rendu HISTORIQUE EXACT — bloc
 *     centré, posé sur yBasDefaut (le plancher historique de CHAQUE moteur :
 *     PDF 22/10 pt, image & DOCX 6 pt + mention, XLSX 4 pt + mention) +
 *     décalages utilisateur bornés (x ∈ [6 ; pageW−6−w], y ∈ [0 ; pageH−h]) ;
 *   - les 4 COINS : mêmes règles que les autres éléments (coinVersBoite,
 *     réserve de la mention en bas, bornage au périmètre).
 * Jumelle JS obligatoire côté portail (certVersBoiteTampon).
 */
export function certVersBoite(
  position: string | undefined,
  pageW: number,
  pageH: number,
  w: number,
  h: number,
  mentionPresente: boolean,
  yBasDefaut: number,
  decalX = 0,
  decalY = 0
): { x: number; y: number } {
  if (String(position || "BAS_CENTRE") === "BAS_CENTRE") {
    const brut = {
      x: (pageW - w) / 2 + (Number(decalX) || 0),
      y: yBasDefaut + (Number(decalY) || 0),
    };
    const maxX = Math.max(6, pageW - 6 - w);
    const maxY = Math.max(yBasDefaut, pageH - h);
    return {
      x: Math.min(maxX, Math.max(6, brut.x)),
      y: Math.min(maxY, Math.max(0, brut.y)),
    };
  }
  return coinVersBoite(String(position), pageW, pageH, w, h, mentionPresente, decalX, decalY);
}

/**
 * (MODIFIÉ 0.2.47 ; LIBÉRÉ 0.2.54) Coin de départ + décalage utilisateur
 * borné au PÉRIMÈTRE de la page : le décalage (points PDF, ±1500 côté
 * interface/API) permet désormais de déplacer l'élément LIBREMENT sur toute
 * la surface de la feuille ; le bornage final garantit que l'élément reste
 * entièrement visible (jamais coupé, jamais hors page).
 * (EXPORTÉ 0.2.48 : réutilisé par les moteurs image/docx — jumelle JS
 * coinVersBoiteTampon dans portail-server.js, ne pas modifier seul.)
 */
export function coinVersBoite(
  position: string,
  pageW: number,
  pageH: number,
  w: number,
  h: number,
  mentionPresente: boolean,
  decalX = 0,
  decalY = 0
): { x: number; y: number } {
  const haut = position.startsWith("HAUT");
  const droite = position.endsWith("DROITE");
  const basDecal = mentionPresente ? HAUT_MENTION : MARGE;
  const brut = {
    x: (droite ? pageW - MARGE - w : MARGE) + (Number(decalX) || 0),
    y: (haut ? pageH - MARGE - h : basDecal) + (Number(decalY) || 0),
  };
  // Bornes : x dans [MARGE ; pageW - MARGE - w] ; y dans [HAUT_MENTION ;
  // pageH - MARGE - h] (le plancher Y AUTORISE la position naturelle de la
  // mention 22 pt — un plancher à MARGE=24 aurait déplacé le réglage
  // historique). Si la boîte est plus large que la page (cas extrême),
  // retour au bord.
  const maxX = Math.max(MARGE, pageW - MARGE - w);
  const maxY = Math.max(HAUT_MENTION, pageH - MARGE - h);
  return {
    x: Math.min(maxX, Math.max(MARGE, brut.x)),
    y: Math.min(maxY, Math.max(HAUT_MENTION, brut.y)),
  };
}

/* --- (NOUVEAU 0.2.54) ROTATION des éléments (signature et QR) ---------- */

/** Normalise un angle de configuration en degrés entiers 0..359 (défaut 0).
 * Jumelle JS obligatoire côté portail (angleNormaliseeTampon). */
export function angleNormalisee(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const a = Math.round(n) % 360;
  return a < 0 ? a + 360 : a;
}

/**
 * (NOUVEAU 0.2.56) Rotation /Rotate EFFECTIVE d'une page : valeur du
 * dictionnaire de page OU HÉRITÉE des nœuds /Pages parents (pdf-lib :
 * PDFPageLeaf.Rotate() remonte la chaîne), normalisée à 0|90|180|270.
 * Les fiches générées par Sage sont souvent PAYSAGE (MediaBox 842×583)
 * avec /Rotate 270 : pdf-lib dessine dans l'espace NON pivoté, le tampon
 * « bas droite » se retrouvait donc visuellement en haut et tourné —
 * c'est la cause racine du positionnement incorrect (Task 135).
 */
export function rotationPageEffective(page: PDFPage): number {
  try {
    const brut = page.node.Rotate();
    const n = brut ? brut.asNumber() : 0;
    const q = Math.round((Number.isFinite(n) ? n : 0) / 90) * 90;
    return ((q % 360) + 360) % 360;
  } catch {
    return 0;
  }
}

/** Boîte englobante d'un rectangle w×h tourné de angleDeg (degrés — le
 * résultat est identique quel que soit le sens de rotation). À 0°, la boîte
 * est inchangée : rendu historique préservé. Jumelle JS : boiteTourneeTampon. */
export function boiteTournee(
  w: number,
  h: number,
  angleDeg: number
): { w: number; h: number } {
  const t = (angleDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  return { w: w * c + h * s, h: w * s + h * c };
}

/**
 * Point local (px, py — coordonnées du bloc NON tourné, origine bas-gauche,
 * y vers le haut) après rotation HORAIRE de angleDeg autour du centre du
 * bloc, le centre du bloc tourné étant placé en (cx, cy).
 * Convention UI : angle positif = SENS HORAIRE (comme les éditeurs d'images) ;
 * pdf-lib tourne en SENS ANTI-HORAIRE autour du point d'ancrage → l'appelant
 * dessine avec rotate: degrees(-angleDeg) et ancre = pointTourne(...).
 * Jumelle JS obligatoire côté portail (pointTourneTampon).
 */
export function pointTourne(
  cx: number,
  cy: number,
  bw: number,
  bh: number,
  angleDeg: number,
  px: number,
  py: number
): { x: number; y: number } {
  const t = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const dx = px - bw / 2;
  const dy = py - bh / 2;
  // Rotation horaire de t dans un repère y vers le haut :
  // (dx, dy) → (dx·cos + dy·sin, −dx·sin + dy·cos)
  return {
    x: cx + dx * cos + dy * sin,
    y: cy - dx * sin + dy * cos,
  };
}

function chevauche(a: Boite | null, b: Boite | null): boolean {
  if (!a || !b) return false;
  return (
    a.x < b.x + b.w + ECART_ELEMENTS &&
    b.x < a.x + a.w + ECART_ELEMENTS &&
    a.y < b.y + b.h &&
    b.y < a.y + a.h
  );
}

/**
 * Assainit un texte pour l'écriture avec une police standard WinAnsi
 * (Helvetica) : les caractères hors jeu (flèches, emoji, CJK…) sont
 * remplacés au lieu de faire échouer l'apposition du tampon. Jumelle JS
 * obligatoire côté portail (texteWinAnsiTampon).
 */
export function texteWinAnsi(texte: string): string {
  let t = String(texte ?? "")
    .replace(/[\u2190-\u21FF\u2794\u27A1]/g, "->")
    .replace(/[\u2264]/g, "<=")
    .replace(/[\u2265]/g, ">=")
    .replace(/[\u2260]/g, "!=")
    .replace(/[\u2212]/g, "-");
  t = t.replace(
    /[^\x20-\x7E\u00A0-\u00FF\u20AC\u2018\u2019\u201C\u201D\u2013\u2014\u2022\u2026\u2039\u203A\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC]/g,
    "?"
  );
  return t;
}

/** Coupe un texte en lignes d'au moins `largeur` points (police fournie). */
function couperLignes(
  texte: string,
  font: PDFFont,
  taille: number,
  largeurMax: number
): string[] {
  const lignes: string[] = [];
  for (const brut of String(texte ?? "").split(/\r?\n/)) {
    let courante = "";
    for (const mot of brut.split(/\s+/).filter(Boolean)) {
      const essai = courante ? courante + " " + mot : mot;
      if (font.widthOfTextAtSize(essai, taille) <= largeurMax || !courante) {
        courante = essai;
      } else {
        lignes.push(courante);
        courante = mot;
      }
    }
    if (courante) lignes.push(courante);
  }
  return lignes;
}

/* ------------------------------------------------------------------ */
/* Moteur principal                                                    */
/* ------------------------------------------------------------------ */

/** Décode un dataURL image/png|jpeg en octets bruts (null si invalide). */
function decoderImage(sigImage: string): { octets: Buffer; png: boolean } | null {
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/.exec(String(sigImage ?? ""));
  if (!m) return null;
  try {
    return { octets: Buffer.from(m[2], "base64"), png: m[1] === "png" };
  } catch {
    return null;
  }
}

/**
 * Appose signature et/ou QR et/ou mention sur TOUTES les pages du PDF.
 * Ne lève JAMAIS d'exception : en cas de PDF illisible ou d'erreur de
 * dessin, le PDF original est retourné tel quel (service non bloquant).
 */
export async function tamponnerFichePdf(
  donnees: Buffer,
  fiche: InfosFiche,
  cfg: ConfigTampon
): Promise<Buffer> {
  if (!tamponActif(cfg)) return donnees;
  try {
    const pdf = await PDFDocument.load(donnees, { ignoreEncryption: true });
    const pages = pdf.getPages();
    if (pages.length === 0) return donnees;

    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontGras = await pdf.embedFont(StandardFonts.HelveticaBold);

    // ---- Ressources dessinables (une seule fois) ----
    // (NOUVEAU 0.2.56) octets bruts conservés : indispensables pour intégrer
    // les images dans un CALQUE quand la page porte un /Rotate (voir plus bas).
    let qrOctets: Buffer | null = null;
    let qrEstPng = true;
    let sigOctets: Buffer | null = null;
    let sigEstPng = true;
    let qrImg: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
    let qrL = 0;
    let qrH = 0;
    if (cfg.qrActif) {
      // (NOUVEAU 0.2.47) Mode IMAGE : le QR est FOURNI par l'établissement
      // (fichier importé dans la rubrique) — aucune génération, l'image est
      // servie telle quelle, ajustée dans la boîte qrTaille (ratio gardé).
      if (cfg.qrMode === "IMAGE") {
        const dec = decoderImage(cfg.qrImage);
        if (dec) {
          qrImg = dec.png ? await pdf.embedPng(dec.octets) : await pdf.embedJpg(dec.octets);
          qrOctets = dec.octets;
          qrEstPng = dec.png;
          // (LIBÉRÉ 0.2.54) taille 40 → 1200 pt (au lieu de 60 → 220)
          const cote = Math.max(40, Math.min(1200, Number(cfg.qrTaille) || 110));
          const echelle = cote / Math.max(qrImg.width, qrImg.height);
          qrL = qrImg.width * echelle;
          qrH = qrImg.height * echelle;
        }
      } else {
        const contenu = contenuQr(fiche, cfg);
        if (contenu) {
          const png = await QRCode.toBuffer(contenu, {
            type: "png",
            margin: 0,
            width: 640,
            errorCorrectionLevel: "M",
          });
          qrImg = await pdf.embedPng(png);
          qrOctets = png;
          qrEstPng = true;
          // (LIBÉRÉ 0.2.54) taille 40 → 1200 pt (au lieu de 60 → 220)
          const cote = Math.max(40, Math.min(1200, Number(cfg.qrTaille) || 110));
          qrL = cote;
          qrH = cote;
        }
      }
    }

    let sigImg: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
    let sigL = 0;
    let sigH = 0;
    if (cfg.sigActif) {
      const dec = decoderImage(cfg.sigImage);
      if (dec) {
        sigImg = dec.png ? await pdf.embedPng(dec.octets) : await pdf.embedJpg(dec.octets);
        sigOctets = dec.octets;
        sigEstPng = dec.png;
        // (LIBÉRÉ 0.2.54) largeur 40 → 1200 pt (au lieu de 60 → 240)
        sigL = Math.max(40, Math.min(1200, Number(cfg.sigTaille) || 120));
        const echelle = sigL / sigImg.width;
        sigH = sigImg.height * echelle;
      }
    }

    const texteBrut = String(cfg.sigTexte ?? "").trim();
    const tailleTexte = 8;
    const opacite = Math.max(0.3, Math.min(1, Number(cfg.sigOpacite) || 0.9));
    const mentionBrute = texteWinAnsi(
      String(cfg.mentionTexte ?? "").replace(/\{DATE\}/g, dateFr(new Date()))
    );
    // (NOUVEAU v0.2.88) lignes du bloc certificat (Switch certActif ON +
    // certificat importé) — calculées UNE fois, dessinées sur chaque page.
    const lignesCert = lignesCertificat(cfg).map((l) => texteWinAnsi(l));
    // (NOUVEAU v0.2.119) lignes du bloc « SIGNATURE ÉLECTRONIQUE » (Switch
    // elecActif ON + métadonnées injectées par l'appelant) — calculées UNE
    // fois, dessinées sur chaque page.
    const lignesElec = lignesSignatureElec(cfg).map((l) => texteWinAnsi(l));
    // (NOUVEAU 0.2.54) angles normalisés (degrés horaires) — calculés UNE fois
    const angleQr = angleNormalisee(cfg.qrRotation);
    const angleSig = angleNormalisee(cfg.sigRotation);

    // (NOUVEAU 0.2.56) DESSIN DU TAMPON SUR UNE CIBLE — la page ELLE-MÊME
    // (rot 0 : rendu historique STRICTEMENT inchangé) ou un CALQUE aux
    // dimensions VISUELLES pour les pages portant un /Rotate. Même
    // géométrie, mêmes constantes, mêmes éléments (jumelle portail alignée).
    type ImagePdf = Awaited<ReturnType<typeof pdf.embedPng>>;
    const dessinerTamponSur = (
      cible: PDFPage,
      W: number,
      H: number,
      font: PDFFont,
      fontGras: PDFFont,
      qrImg: ImagePdf | null,
      sigImg: ImagePdf | null
    ): void => {
      // --- Géométrie des éléments de CETTE page ---
      let boiteQr: Boite | null = null;
      let boiteSig: Boite | null = null;
      // dims NON tournées du bloc signature (image + texte) pour le dessin
      let sigDims: { w: number; h: number } | null = null;

      if (qrImg) {
        // (MODIFIÉ 0.2.54) le placement se fait sur la BOÎTE ENGLOBANTE de
        // l'élément tourné (rotation horaire angleQr autour du centre) — à
        // 0°, boîte englobante = boîte historique (rendu inchangé).
        const bbQr = boiteTournee(qrL, qrH, angleQr);
        const pos = coinVersBoite(
          cfg.qrPosition,
          W,
          H,
          bbQr.w,
          bbQr.h,
          cfg.mentionActif,
          cfg.qrDecalX,
          cfg.qrDecalY
        );
        boiteQr = { x: pos.x, y: pos.y, w: bbQr.w, h: bbQr.h };
      }

      let lignesTexte: string[] = [];
      if (sigImg || texteBrut) {
        lignesTexte = texteBrut ? couperLignes(texteWinAnsi(texteBrut), font, tailleTexte, 170) : [];
        const hauteurTotale =
          (sigImg ? sigH : 0) + (lignesTexte.length ? lignesTexte.length * (tailleTexte + 2) + 3 : 0);
        if (hauteurTotale > 0) {
          const largeur = Math.max(sigImg ? sigL : 0, ...lignesTexte.map((l) => font.widthOfTextAtSize(l, tailleTexte)));
          sigDims = { w: largeur, h: hauteurTotale };
          const bbSig = boiteTournee(largeur, hauteurTotale, angleSig);
          const pos = coinVersBoite(
            cfg.sigPosition,
            W,
            H,
            bbSig.w,
            bbSig.h,
            cfg.mentionActif,
            cfg.sigDecalX,
            cfg.sigDecalY
          );
          boiteSig = { x: pos.x, y: pos.y, w: bbSig.w, h: bbSig.h };
          // Collision avec le QR (même coin) : décale la signature à côté.
          if (chevauche(boiteSig, boiteQr) && boiteQr) {
            const aDroite = cfg.sigPosition.endsWith("DROITE");
            boiteSig.x = aDroite
              ? boiteQr.x - ECART_ELEMENTS - boiteSig.w
              : boiteQr.x + boiteQr.w + ECART_ELEMENTS;
          }
        }
      }

      // --- Dessin ---
      if (qrImg && boiteQr) {
        if (angleQr === 0) {
          cible.drawImage(qrImg, {
            x: boiteQr.x,
            y: boiteQr.y,
            width: boiteQr.w,
            height: boiteQr.h,
          });
        } else {
          // (NOUVEAU 0.2.54) rotation HORAIRE autour du CENTRE de la boîte
          // placée : pdf-lib tourne autour du point d'ancrage (positif =
          // anti-horaire) → angle -angleQr + ancre = coin bas-gauche de
          // l'image NON tournée recalculé par pointTourne.
          const ancreQr = pointTourne(
            boiteQr.x + boiteQr.w / 2,
            boiteQr.y + boiteQr.h / 2,
            qrL,
            qrH,
            angleQr,
            0,
            0
          );
          cible.drawImage(qrImg, {
            x: ancreQr.x,
            y: ancreQr.y,
            width: qrL,
            height: qrH,
            rotate: degrees(-angleQr),
          });
        }
      }

      if (boiteSig && sigDims) {
        const cxS = boiteSig.x + boiteSig.w / 2; // centre de la boîte placée
        const cyS = boiteSig.y + boiteSig.h / 2;
        if (angleSig === 0) {
          // Rendu historique (0°) STRICTEMENT identique
          let y = boiteSig.y + sigDims.h; // on dessine de haut en bas
          if (sigImg) {
            y -= sigH;
            cible.drawImage(sigImg, {
              x: boiteSig.x + (sigDims.w - sigL) / 2,
              y,
              width: sigL,
              height: sigH,
              opacity: opacite,
            });
          }
          for (const ligne of lignesTexte) {
            y -= tailleTexte + 2;
            const wLigne = font.widthOfTextAtSize(ligne, tailleTexte);
            cible.drawText(ligne, {
              x: boiteSig.x + Math.max(0, (sigDims.w - wLigne) / 2),
              y,
              size: tailleTexte,
              font,
              color: rgb(0.2, 0.2, 0.2),
            });
          }
        } else {
          // (NOUVEAU 0.2.54) rotation HORAIRE du bloc ENTIER (image + lignes
          // de texte) autour du centre de la boîte placée — chaque élément
          // est dessiné avec son ancre locale tournée (bloc rigide, texte
          // toujours vectoriel).
          if (sigImg) {
            const ix = (sigDims.w - sigL) / 2;
            const iy = sigDims.h - sigH;
            const ancre = pointTourne(cxS, cyS, sigDims.w, sigDims.h, angleSig, ix, iy);
            cible.drawImage(sigImg, {
              x: ancre.x,
              y: ancre.y,
              width: sigL,
              height: sigH,
              opacity: opacite,
              rotate: degrees(-angleSig),
            });
          }
          let yLocal = sigDims.h - (sigImg ? sigH : 0);
          for (const ligne of lignesTexte) {
            yLocal -= tailleTexte + 2;
            const wLigne = font.widthOfTextAtSize(ligne, tailleTexte);
            const lx = Math.max(0, (sigDims.w - wLigne) / 2);
            const ancreL = pointTourne(cxS, cyS, sigDims.w, sigDims.h, angleSig, lx, yLocal);
            cible.drawText(ligne, {
              x: ancreL.x,
              y: ancreL.y,
              size: tailleTexte,
              font,
              color: rgb(0.2, 0.2, 0.2),
              rotate: degrees(-angleSig),
            });
          }
        }
      }

      if (cfg.mentionActif && mentionBrute.trim()) {
        const m = mentionBrute.length > 110 ? mentionBrute.slice(0, 110) : mentionBrute;
        const wM = font.widthOfTextAtSize(m, 7.5);
        cible.drawText(m, {
          x: Math.max(6, (W - wM) / 2),
          y: 10,
          size: 7.5,
          font,
          color: rgb(0.35, 0.35, 0.35),
        });
      }

      // (NOUVEAU v0.2.88 ; MODIFIÉ v0.2.92) BLOC CERTIFICAT DE SIGNATURE
      // (Switch certActif) : texte compact POSITIONNABLE — BAS_CENTRE
      // (défaut) = rendu historique exact (centré au-dessus de la mention,
      // ou au bord inférieur quand la mention est absente) ; les 4 coins et
      // les décalages certDecalX/Y permettent le placement libre (certVers-
      // Boite). certTaille = échelle du bloc (50 → 300 %). Rendu sur TOUTES
      // les pages, comme les autres éléments du tampon.
      if (lignesCert.length) {
        const echelleCert = echelleCertificat(cfg);
        const tailleCert = 6.5 * echelleCert;
        const pasCert = 9 * echelleCert;
        const yBas = cfg.mentionActif && mentionBrute.trim() ? HAUT_MENTION : 10;
        const wBloc = Math.max(...lignesCert.map((l) => font.widthOfTextAtSize(l, tailleCert)));
        const hBloc = lignesCert.length * pasCert;
        const posCert = certVersBoite(
          cfg.certPosition,
          W,
          H,
          wBloc,
          hBloc,
          Boolean(cfg.mentionActif && mentionBrute.trim()),
          yBas,
          cfg.certDecalX,
          cfg.certDecalY
        );
        let yC = posCert.y + hBloc;
        for (const ligne of lignesCert) {
          yC -= pasCert;
          const wC = font.widthOfTextAtSize(ligne, tailleCert);
          cible.drawText(ligne, {
            x: posCert.x + Math.max(0, (wBloc - wC) / 2),
            y: yC,
            size: tailleCert,
            font,
            color: rgb(0.3, 0.3, 0.3),
          });
        }
      }

      // (NOUVEAU v0.2.119 ; v0.2.120 DEUX FORMES) CACHET « SIGNATURE
      // ÉLECTRONIQUE » alimenté par le certificat du module de signature
      // (Switch elecActif ON + métadonnées injectées) :
      //   - RECTANGLE (historique) : titre en gras, lignes centrées, bordure
      //     fine, fond transparent (aucun contenu masqué) ;
      //   - ROND (v0.2.120) : cachet circulaire de type « cachet
      //     d'entreprise » — deux cercles concentriques bleus, organisation
      //     en arc supérieur, « SIGNATURE ÉLECTRONIQUE » en arc inférieur,
      //     titulaire (CN) en gras au centre + validité + empreinte.
      // Placement identique aux autres éléments : coin + décalages bornés
      // (certVersBoite avec les champs elec*), présent sur TOUTES les pages.
      // La signature PAdES est appliquée JUSTE APRÈS le tamponnage : le
      // cachet est COUVERT par elle (garantie inchangée).
      if (lignesElec.length && formeElec(cfg) === "ROND") {
        const rond = contenuCachetRond(cfg);
        if (rond) {
          const D = diametreCachetRond(cfg); // côté de la boîte = diamètre
          const yBasR = cfg.mentionActif && mentionBrute.trim() ? HAUT_MENTION : 10;
          const posR = certVersBoite(
            cfg.elecPosition,
            W,
            H,
            D,
            D,
            Boolean(cfg.mentionActif && mentionBrute.trim()),
            yBasR,
            cfg.elecDecalX,
            cfg.elecDecalY
          );
          const cxR = posR.x + D / 2;
          const cyR = posR.y + D / 2;
          const R = D / 2;
          const rap = D / DIAMETRE_CACHET_ROND; // rapport d'échelle (traits)
          const encre = rgb(COULEUR_CACHET_ROND.r, COULEUR_CACHET_ROND.g, COULEUR_CACHET_ROND.b);
          // Deux cercles concentriques (extérieur épais + intérieur fin).
          // pdf-lib : (x,y) = CENTRE, xScale/yScale = RAYONS.
          cible.drawEllipse({
            x: cxR,
            y: cyR,
            xScale: R,
            yScale: R,
            borderColor: encre,
            borderWidth: 2.2 * rap,
            borderOpacity: 0.92,
          });
          const Ri = R - D * 0.075; // cercle intérieur : délimite l'anneau
          cible.drawEllipse({
            x: cxR,
            y: cyR,
            xScale: Ri,
            yScale: Ri,
            borderColor: encre,
            borderWidth: 0.8 * rap,
            borderOpacity: 0.75,
          });
          // Textes d'arc dans l'anneau : organisation (haut, en gras) et
          // mention (bas). Bases ajustées d'un demi-corps de glyphe pour
          // centrer les lettres entre les deux cercles (voir doc fonction).
          const rayonTexte = R - D * 0.115;
          const tailleArc = D * 0.072;
          if (rond.arcHaut)
            dessinerArcCachetPdf(
              cible, rond.arcHaut, cxR, cyR,
              rayonTexte - tailleArc * 0.35, tailleArc, fontGras, encre, "HAUT"
            );
          if (rond.arcBas)
            dessinerArcCachetPdf(
              cible, rond.arcBas, cxR, cyR,
              rayonTexte + tailleArc * 0.31, tailleArc * 0.9, font, encre, "BAS"
            );
          // Points décoratifs gauche/droite (séparateurs des deux arcs).
          const rPt = D * 0.016;
          for (const ang of [0, Math.PI]) {
            cible.drawEllipse({
              x: cxR + rayonTexte * Math.cos(ang),
              y: cyR + rayonTexte * Math.sin(ang),
              xScale: rPt,
              yScale: rPt,
              color: encre,
              borderOpacity: 0,
            });
          }
          // Contenu central : titulaire (gras) + séparateur « — • — » +
          // validité + empreinte, centrés, tronqués à la largeur du cercle.
          const lignesC = rond.centre;
          const tailleNom = 10.5 * rap;
          const largeurMaxCentre = Ri * 2 - D * 0.16;
          let yC = cyR + ((lignesC.length - 1) * tailleNom) / 2;
          for (let i = 0; i < lignesC.length; i++) {
            const ligne = lignesC[i];
            const tailleL = ligne.gras
              ? tailleNom
              : Math.max(4.2, ligne.taille * 10.5 * rap);
            const fL = ligne.gras ? fontGras : font;
            let texteL = ligne.texte;
            while (
              texteL.length > 4 &&
              fL.widthOfTextAtSize(texteL, tailleL) > largeurMaxCentre
            ) {
              texteL = texteL.slice(0, -2).trimEnd() + "…";
            }
            const wL = fL.widthOfTextAtSize(texteL, tailleL);
            cible.drawText(texteL, {
              x: cxR - wL / 2,
              y: yC - tailleL * 0.36,
              size: tailleL,
              font: fL,
              color: encre,
            });
            if (i === 0) {
              // séparateur décoratif sous le titulaire
              const yS = yC - tailleNom * 0.82;
              const demi = D * 0.075;
              cible.drawLine({
                start: { x: cxR - demi * 1.9, y: yS },
                end: { x: cxR - demi * 0.75, y: yS },
                thickness: 0.7 * rap,
                color: encre,
                opacity: 0.9,
              });
              cible.drawLine({
                start: { x: cxR + demi * 0.75, y: yS },
                end: { x: cxR + demi * 1.9, y: yS },
                thickness: 0.7 * rap,
                color: encre,
                opacity: 0.9,
              });
              const rPu = D * 0.012;
              cible.drawEllipse({
                x: cxR,
                y: yS,
                xScale: rPu,
                yScale: rPu,
                color: encre,
                borderOpacity: 0,
              });
            }
            yC -= ligne.gras ? tailleNom * 1.24 : Math.max(7.4, tailleL * 1.5);
          }
        }
      } else if (lignesElec.length) {
        // (REFONTE v0.2.121) Cachet RECTANGULAIRE « comme le ROND » : mêmes
        // contenus déterministes (organisation / titulaire / validité /
        // empreinte via contenuCachetRond), même ENCRE BLEUE, double cadre
        // rectangulaire (épais + fin — équivalent des deux cercles) +
        // séparateur « — • — » sous le titulaire. Repli : rendu historique
        // v0.2.119 si le contenu n'est pas calculable (ni CN ni O).
        const geo = geometrieCachetRectangle(cfg, font, fontGras);
        if (geo) {
          const S = geo.echelle;
          const C = CACHET_RECT;
          const yBasE = cfg.mentionActif && mentionBrute.trim() ? HAUT_MENTION : 10;
          const posElec = certVersBoite(
            cfg.elecPosition,
            W,
            H,
            geo.wPt,
            geo.hPt,
            Boolean(cfg.mentionActif && mentionBrute.trim()),
            yBasE,
            cfg.elecDecalX,
            cfg.elecDecalY
          );
          const encre = rgb(COULEUR_CACHET_ROND.r, COULEUR_CACHET_ROND.g, COULEUR_CACHET_ROND.b);
          // Double cadre (fond transparent : aucun contenu masqué) —
          // extérieur épais 2,2 + intérieur fin 0,8 (même discipline que
          // les deux cercles concentriques du cachet ROND).
          cible.drawRectangle({
            x: posElec.x,
            y: posElec.y,
            width: geo.wPt,
            height: geo.hPt,
            borderColor: encre,
            borderWidth: 2.2 * S,
            borderOpacity: 0.92,
          });
          cible.drawRectangle({
            x: posElec.x + C.cadre * S,
            y: posElec.y + C.cadre * S,
            width: geo.wPt - 2 * C.cadre * S,
            height: geo.hPt - 2 * C.cadre * S,
            borderColor: encre,
            borderWidth: 0.8 * S,
            borderOpacity: 0.75,
          });
          // Empilement haut → bas (consomme EXACTEMENT les constantes de
          // geometrieCachetRectangle — cf. hPt). (v0.2.128) les zones vides
          // (en-tête/titulaire masqués par le formulaire de choix) ne sont
          // ni dessinées ni consommées — même logique dans la surface SVG
          // et l'aperçu client.
          let yT = posElec.y + geo.hPt - C.padH * S;
          // 1) EN-TÊTE : organisation (gras, bleue, centrée) + 2) séparatrice
          //    sous l'en-tête — seulement si l'en-tête est affiché.
          if (geo.org.texte) {
            cible.drawText(geo.org.texte, {
              x: posElec.x + (geo.wPt - fontGras.widthOfTextAtSize(geo.org.texte, geo.org.taille)) / 2,
              y: yT - geo.org.taille * 0.85,
              size: geo.org.taille,
              font: fontGras,
              color: encre,
            });
            yT -= C.corpsOrg * S + C.g1 * S;
            const demiLigne = geo.wPt * 0.3;
            cible.drawLine({
              start: { x: posElec.x + geo.wPt / 2 - demiLigne, y: yT - C.trait * S * 0.5 },
              end: { x: posElec.x + geo.wPt / 2 + demiLigne, y: yT - C.trait * S * 0.5 },
              thickness: C.trait * S,
              color: encre,
              opacity: 0.9,
            });
            yT -= C.trait * S + C.g2 * S;
          }
          // 3) TITULAIRE (CN, gras, centré — comme le centre du ROND).
          if (geo.nom.texte) {
            cible.drawText(geo.nom.texte, {
              x: posElec.x + (geo.wPt - fontGras.widthOfTextAtSize(geo.nom.texte, geo.nom.taille)) / 2,
              y: yT - geo.nom.taille,
              size: geo.nom.taille,
              font: fontGras,
              color: encre,
            });
            yT -= C.pasNom * S;
            // 4) Séparateur décoratif « — • — » (identique au ROND).
            const ySep = yT - C.sep * S * 0.5;
            const demi = geo.wPt * 0.055;
            cible.drawLine({
              start: { x: posElec.x + geo.wPt / 2 - demi * 1.9, y: ySep },
              end: { x: posElec.x + geo.wPt / 2 - demi * 0.75, y: ySep },
              thickness: 0.7 * S,
              color: encre,
              opacity: 0.9,
            });
            cible.drawLine({
              start: { x: posElec.x + geo.wPt / 2 + demi * 0.75, y: ySep },
              end: { x: posElec.x + geo.wPt / 2 + demi * 1.9, y: ySep },
              thickness: 0.7 * S,
              color: encre,
              opacity: 0.9,
            });
            cible.drawEllipse({
              x: posElec.x + geo.wPt / 2,
              y: ySep,
              xScale: 1.44 * S, // = 120 × 0,012 : même point que le cachet ROND
              yScale: 1.44 * S,
              color: encre,
              borderOpacity: 0,
            });
            yT -= C.sep * S;
          }
          // 5) Petites lignes : validité puis empreinte.
          for (let i = 0; i < geo.petites.length; i++) {
            const ligne = geo.petites[i];
            const wL = font.widthOfTextAtSize(ligne.texte, ligne.taille);
            cible.drawText(ligne.texte, {
              x: posElec.x + (geo.wPt - wL) / 2,
              y: yT - ligne.taille,
              size: ligne.taille,
              font,
              color: encre,
            });
            yT -= (i === 0 ? C.pasPetite : C.pasPetite2) * S;
          }
          if (geo.petites.length) yT -= C.g3 * S;
          // 6) MENTION « SIGNATURE ÉLECTRONIQUE » en pied (équivalent de
          // l'arc bas du ROND).
          if (geo.mention.texte) {
            cible.drawText(geo.mention.texte, {
              x: posElec.x + (geo.wPt - font.widthOfTextAtSize(geo.mention.texte, geo.mention.taille)) / 2,
              y: yT - geo.mention.taille * 0.9,
              size: geo.mention.taille,
              font,
              color: encre,
            });
          }
        } else {
          // REPLI (contenu indisponible : ni CN ni O dans le sujet) — rendu
          // historique v0.2.119 inchangé (bloc gris encadré).
          const echelleE = echelleElec(cfg);
          const tailleTitre = 7.5 * echelleE;
          const tailleLigne = 6.5 * echelleE;
          const pasE = 9 * echelleE;
          const nLignes = lignesElec.length - 1; // lignes sous le titre
          const wTitre = fontGras.widthOfTextAtSize(lignesElec[0], tailleTitre);
          const wLignes = lignesElec.slice(1).map((l) => font.widthOfTextAtSize(l, tailleLigne));
          const wBloc = Math.max(wTitre, ...(wLignes.length ? wLignes : [0])) + 12;
          const hBloc = 5 + tailleTitre * 0.85 + nLignes * pasE + 5;
          const yBasE = cfg.mentionActif && mentionBrute.trim() ? HAUT_MENTION : 10;
          const posElec = certVersBoite(
            cfg.elecPosition,
            W,
            H,
            wBloc,
            hBloc,
            Boolean(cfg.mentionActif && mentionBrute.trim()),
            yBasE,
            cfg.elecDecalX,
            cfg.elecDecalY
          );
          // Cadre (fond transparent : aucun contenu du document n'est masqué).
          cible.drawRectangle({
            x: posElec.x,
            y: posElec.y,
            width: wBloc,
            height: hBloc,
            borderColor: rgb(0.25, 0.25, 0.25),
            borderWidth: 0.9,
            borderOpacity: 0.8,
          });
          let yE = posElec.y + hBloc - 5 - tailleTitre * 0.85; // baseline du titre
          cible.drawText(lignesElec[0], {
            x: posElec.x + (wBloc - wTitre) / 2,
            y: yE,
            size: tailleTitre,
            font: fontGras,
            color: rgb(0.15, 0.15, 0.15),
          });
          for (const ligne of lignesElec.slice(1)) {
            yE -= pasE;
            const wL = font.widthOfTextAtSize(ligne, tailleLigne);
            cible.drawText(ligne, {
              x: posElec.x + (wBloc - wL) / 2,
              y: yE,
              size: tailleLigne,
              font,
              color: rgb(0.25, 0.25, 0.25),
            });
          }
        }
      }
    };

    // (MODIFIÉ 0.2.56) pages avec /Rotate (fiches Sage PAYSAGE pivotées pour
    // affichage portrait) : pdf-lib dessine dans l'espace NON pivoté — un
    // tampon « bas droite » y apparaissait visuellement en haut ET tourné.
    // Solution : dessiner sur un CALQUE aux dimensions VISUELLES (Wv×Hv =
    // MediaBox échangées pour 90°/270°) puis composer le calque tourné sur
    // la page réelle (ancres/rotations dérivées et vérifiées pour 90/180/270 :
    // un point visuel (px,py) est replacé EXACTEMENT à px du bord gauche et
    // py du bord bas de la page telle qu'affichée à l'écran).
    for (const page of pages) {
      const { width: Wm, height: Hm } = page.getSize();
      const rotPage = rotationPageEffective(page);
      if (rotPage === 0) {
        dessinerTamponSur(page, Wm, Hm, font, fontGras, qrImg, sigImg);
        continue;
      }
      const echange = rotPage === 90 || rotPage === 270;
      const Wv = echange ? Hm : Wm;
      const Hv = echange ? Wm : Hm;
      const calque = await PDFDocument.create();
      const fontCalque = await calque.embedFont(StandardFonts.Helvetica);
      const fontGrasCalque = await calque.embedFont(StandardFonts.HelveticaBold);
      const imgQrCalque: ImagePdf | null = qrOctets
        ? qrEstPng
          ? await calque.embedPng(qrOctets)
          : await calque.embedJpg(qrOctets)
        : null;
      const imgSigCalque: ImagePdf | null = sigOctets
        ? sigEstPng
          ? await calque.embedPng(sigOctets)
          : await calque.embedJpg(sigOctets)
        : null;
      dessinerTamponSur(
        calque.addPage([Wv, Hv]),
        Wv,
        Hv,
        fontCalque,
        fontGrasCalque,
        imgQrCalque,
        imgSigCalque
      );
      const [emb] = await pdf.embedPdf(await calque.save());
      const mb = page.getMediaBox();
      const ancre =
        rotPage === 90
          ? { x: mb.x + Wm, y: mb.y, a: 90 }
          : rotPage === 180
          ? { x: mb.x + Wm, y: mb.y + Hm, a: 180 }
          : { x: mb.x, y: mb.y + Hm, a: -90 };
      page.drawPage(emb, { x: ancre.x, y: ancre.y, rotate: degrees(ancre.a) });
    }

    return Buffer.from(await pdf.save({ useObjectStreams: false }));
  } catch (error) {
    console.error("[TAMPON] Apposition impossible — fiche servie sans tampon:", error);
    return donnees;
  }
}

/* ================================================================== */
/* (NOUVEAU 0.2.48) — TAMPON SUR LES AUTRES FORMATS                    */
/*  IMAGE (PNG/JPG), WORD (.docx), EXCEL (.xlsx/.xlsm)                 */
/*  Jumelle JS OBLIGATOIRE dans portail-server.js :                    */
/*  preparerSurfacesTampon, boitesTamponTampon, tamponnerFicheImage-   */
/*  Tampon, tamponnerFicheDocxTampon, tamponnerFicheXlsxTampon,        */
/*  tamponnerFicheDossierTampon, typeFichierTamporableTampon —         */
/*  mêmes algorithmes, mêmes constantes, mêmes marqueurs.              */
/* ================================================================== */

export type TypeFichierTampon = "pdf" | "image" | "docx" | "xlsx";

/**
 * Type tamponnable déduit du Content-Type servi (null = servi tel quel).
 * Jumelle JS : typeFichierTamporableTampon.
 * NB : .xls binaire historique (application/vnd.ms-excel) → null exprès.
 */
export function typeFichierTamporable(contentType: string): TypeFichierTampon | null {
  if (contentType === "application/pdf") return "pdf";
  if (contentType === "image/png" || contentType === "image/jpeg") return "image";
  if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    return "docx";
  if (
    contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    contentType === "application/vnd.ms-excel.sheet.macroEnabled.12"
  )
    return "xlsx";
  return null;
}

/* ---------------- sharp / JSZip chargés paresseusement ---------------- */

// NB : le typage de sharp (export = fonction + namespace) ne se laisse pas
// décrire par typeof import(...) appelable — module maintenu en `any`
// borné aux appels ci-dessous (jumelle JS non typée côté portail).
type SharpModule = any;
let _sharp: SharpModule | null | undefined;
function chargeSharp(): SharpModule | null {
  if (_sharp === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _sharp = require("sharp") as SharpModule;
    } catch {
      _sharp = null;
    }
  }
  return _sharp;
}

type JsZipModule = typeof import("jszip");
let _jszip: JsZipModule | null | undefined;
function chargeJszip(): JsZipModule | null {
  if (_jszip === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _jszip = require("jszip") as JsZipModule;
    } catch {
      _jszip = null;
    }
  }
  return _jszip;
}

/* ------------------------- Surfaces PNG ------------------------------ */

/** 1 point PDF = 1/72 po ; les surfaces sont rasterisées à 3 px/pt. */
const ECHELLE_SURFACE = 3;
const EMU_PAR_PT = 12700; // OOXML : 914400 EMU / po ÷ 72 pt
const EMU_PAR_PX = 9525; // 96 dpi
const FONT_SVG = "Helvetica, Arial, sans-serif";

interface SurfacePng {
  /** PNG (fond transparent) rasterisé à ECHELLE_SURFACE px par point. */
  png: Buffer;
  /** Taille d'affichage en POINTS (le moteur place en points). */
  wPt: number;
  hPt: number;
}

interface SurfacesTampon {
  qr: SurfacePng | null;
  /** Image de signature + lignes de texte INTÉGRÉES (ou texte seul). */
  sig: SurfacePng | null;
  /** Bandeau de mention (texte seul, fond transparent). */
  mention: SurfacePng | null;
  /** (NOUVEAU v0.2.88) Bloc certificat de signature (Switch certActif ON). */
  cert: SurfacePng | null;
  /** (NOUVEAU v0.2.119) Cachet « Signature électronique » encadré
   * (Switch elecActif ON + métadonnées du module injectées). */
  elec: SurfacePng | null;
}

function echapperXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Métriques Helvetica EXACTES (mêmes coupures de lignes que le PDF) via
 * un document pdf-lib jetable — aucune écriture disque, quelques ms. */
async function metriquesHelvetica(): Promise<PDFFont> {
  const doc = await PDFDocument.create();
  return doc.embedFont(StandardFonts.Helvetica);
}

/** (NOUVEAU v0.2.121) Métriques Helvetica BOLD (titres du cachet). */
async function metriquesHelveticaGras(): Promise<PDFFont> {
  const doc = await PDFDocument.create();
  return doc.embedFont(StandardFonts.HelveticaBold);
}

/** Redimensionne une image importée (PNG/JPEG) en PNG à la largeur cible
 * (px). Retourne null si sharp est indisponible. */
async function redimensionnerPng(
  octets: Buffer,
  largeurCiblePx: number
): Promise<Buffer | null> {
  const sharp = chargeSharp();
  if (!sharp) return null;
  try {
    return await sharp(octets, { failOn: "none" })
      .resize({ width: Math.max(1, Math.round(largeurCiblePx)) })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/** Dimensions réelles (px) d'une image importée. */
async function dimensionsImage(
  octets: Buffer
): Promise<{ w: number; h: number } | null> {
  const sharp = chargeSharp();
  if (!sharp) return null;
  try {
    const m = await sharp(octets, { failOn: "none" }).metadata();
    if (!m.width || !m.height) return null;
    return { w: m.width, h: m.height };
  } catch {
    return null;
  }
}

/**
 * (NOUVEAU 0.2.54) Tourne un PNG de surface de angleDeg degrés SENS HORAIRE
 * (fond transparent, canevas étendu par sharp à la boîte englobante — le
 * centre de l'image reste le centre du canevas). À 0° le PNG est rendu tel
 * quel ; sharp indisponible ou en échec → PNG NON tourné (le tampon reste
 * apposé, sans rotation — jamais bloquant). Jumelle JS côté portail :
 * tournerSurfacePngTampon.
 */
async function tournerSurfacePng(png: Buffer, angleDeg: number): Promise<Buffer> {
  if (!angleDeg) return png;
  const sharp = chargeSharp();
  if (!sharp) {
    console.warn("[TAMPON] sharp indisponible — rotation de la surface ignorée");
    return png;
  }
  try {
    return await sharp(png, { failOn: "none" })
      .rotate(angleDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  } catch {
    return png;
  }
}

/** Rasterise un SVG (texte) en PNG — null si sharp indisponible. */
async function rasteriserSvg(svg: string): Promise<Buffer | null> {
  const sharp = chargeSharp();
  if (!sharp) return null;
  try {
    return await sharp(Buffer.from(svg), { failOn: "none" }).png().toBuffer();
  } catch {
    return null;
  }
}

/**
 * Surface du QR : mode IMAGE = image fournie (ratio préservé dans la boîte,
 * comme embedPng+échelle du PDF) ; autres modes = QR généré.
 */
async function surfaceQr(fiche: InfosFiche, cfg: ConfigTampon): Promise<SurfacePng | null> {
  // (LIBÉRÉ 0.2.54) taille 40 → 1200 pt + rotation de la surface
  const cote = Math.max(40, Math.min(1200, Number(cfg.qrTaille) || 110));
  const angle = angleNormalisee(cfg.qrRotation);
  if (cfg.qrMode === "IMAGE") {
    const dec = decoderImage(cfg.qrImage);
    if (!dec) return null;
    const dims = await dimensionsImage(dec.octets);
    if (!dims) return null;
    const ech = cote / Math.max(dims.w, dims.h);
    const png = await redimensionnerPng(dec.octets, Math.max(dims.w, dims.h) * ECHELLE_SURFACE);
    if (!png) return null;
    const bb = boiteTournee(dims.w * ech, dims.h * ech, angle);
    const pngT = await tournerSurfacePng(png, angle);
    return { png: pngT, wPt: bb.w, hPt: bb.h };
  }
  const contenu = contenuQr(fiche, cfg);
  if (!contenu) return null;
  try {
    const png = await QRCode.toBuffer(contenu, {
      type: "png",
      margin: 0,
      width: Math.min(1240, Math.round(cote * ECHELLE_SURFACE)),
      errorCorrectionLevel: "M",
    });
    const bb = boiteTournee(cote, cote, angle);
    const pngT = await tournerSurfacePng(png, angle);
    return { png: pngT, wPt: bb.w, hPt: bb.h };
  } catch {
    return null;
  }
}

/**
 * Surface de la signature : image importée (opacité appliquée) + lignes de
 * texte INTÉGRÉES en dessous (texte seul si aucune image) — un seul PNG
 * insérable tel quel dans DOCX/XLSX et compositable sur les images.
 */
async function surfaceSignature(cfg: ConfigTampon): Promise<SurfacePng | null> {
  const dec = decoderImage(cfg.sigImage);
  const texteBrut = String(cfg.sigTexte ?? "").trim();
  if (!dec && !texteBrut) return null;

  const tailleTexte = 8; // pt (identique au PDF)
  const opacite = Math.max(0.3, Math.min(1, Number(cfg.sigOpacite) || 0.9));
  const font = await metriquesHelvetica();

  let imgW = 0; // pt
  let imgH = 0; // pt
  let imgPng: Buffer | null = null;
  if (dec) {
    const dims = await dimensionsImage(dec.octets);
    if (dims) {
      // (LIBÉRÉ 0.2.54) largeur 40 → 1200 pt (au lieu de 60 → 240)
      imgW = Math.max(40, Math.min(1200, Number(cfg.sigTaille) || 120));
      imgH = imgW * (dims.h / dims.w);
      imgPng = await redimensionnerPng(dec.octets, imgW * ECHELLE_SURFACE);
    }
  }

  const lignes = texteBrut ? couperLignes(texteWinAnsi(texteBrut), font, tailleTexte, 170) : [];
  const largeurTextes = lignes.length
    ? Math.max(...lignes.map((l) => font.widthOfTextAtSize(l, tailleTexte)))
    : 0;
  const hauteurTextes = lignes.length ? lignes.length * (tailleTexte + 2) + 3 : 0;

  const boiteW = Math.max(imgW, largeurTextes);
  const boiteH = (imgPng ? imgH : 0) + hauteurTextes;
  if (boiteW <= 0 || boiteH <= 0) return null;

  const W = boiteW * ECHELLE_SURFACE;
  const H = boiteH * ECHELLE_SURFACE;
  const parties: string[] = [];
  if (imgPng) {
    const xImg = ((boiteW - imgW) / 2) * ECHELLE_SURFACE;
    parties.push(
      `<image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="data:image/png;base64,` +
        imgPng.toString("base64") +
        `" x="${xImg}" y="0" width="${imgW * ECHELLE_SURFACE}" height="` +
        imgH * ECHELLE_SURFACE +
        `" opacity="${opacite}" preserveAspectRatio="none"/>`
    );
  }
  let yPt = imgPng ? imgH : 0;
  for (const ligne of lignes) {
    yPt += tailleTexte + 2;
    const wL = font.widthOfTextAtSize(ligne, tailleTexte);
    const xL = Math.max(0, (boiteW - wL) / 2) * ECHELLE_SURFACE;
    parties.push(
      `<text x="${xL}" y="${yPt * ECHELLE_SURFACE - 2 * ECHELLE_SURFACE}" font-family="${FONT_SVG}" font-size="` +
        tailleTexte * ECHELLE_SURFACE +
        `" fill="#333333">${echapperXml(ligne)}</text>`
    );
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    parties.join("") +
    `</svg>`;
  const png = await rasteriserSvg(svg);
  if (!png) return null;
  // (NOUVEAU 0.2.54) rotation HORAIRE du bloc signature ENTIER (image +
  // lignes de texte) — cuite dans le PNG ; wPt/hPt = boîte englobante.
  const angleSig = angleNormalisee(cfg.sigRotation);
  const bbSig = boiteTournee(boiteW, boiteH, angleSig);
  const pngT = await tournerSurfacePng(png, angleSig);
  return { png: pngT, wPt: bbSig.w, hPt: bbSig.h };
}

/** Surface de la mention (texte centré, taille 7,5 pt comme le PDF). */
async function surfaceMention(cfg: ConfigTampon): Promise<SurfacePng | null> {
  const brute = texteWinAnsi(
    String(cfg.mentionTexte ?? "").replace(/\{DATE\}/g, dateFr(new Date()))
  ).trim();
  if (!brute) return null;
  const m = brute.length > 110 ? brute.slice(0, 110) : brute;
  const font = await metriquesHelvetica();
  const taille = 7.5;
  const wM = font.widthOfTextAtSize(m, taille);
  const wPt = wM + 4;
  const hPt = 12;
  const W = wPt * ECHELLE_SURFACE;
  const H = hPt * ECHELLE_SURFACE;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<text x="${W / 2}" y="${8.5 * ECHELLE_SURFACE}" text-anchor="middle" font-family="${FONT_SVG}" font-size="` +
    taille * ECHELLE_SURFACE +
    `" fill="#595959">${echapperXml(m)}</text></svg>`;
  const png = await rasteriserSvg(svg);
  if (!png) return null;
  return { png, wPt, hPt };
}

/** Prépare les 3 surfaces une seule fois par fiche servie. */
async function preparerSurfaces(
  fiche: InfosFiche,
  cfg: ConfigTampon
): Promise<SurfacesTampon> {
  const sur: SurfacesTampon = { qr: null, sig: null, mention: null, cert: null, elec: null };
  if (cfg.qrActif) sur.qr = await surfaceQr(fiche, cfg);
  if (cfg.sigActif) sur.sig = await surfaceSignature(cfg);
  if (cfg.mentionActif) sur.mention = await surfaceMention(cfg);
  // (NOUVEAU v0.2.88) bloc certificat — Switch certActif ON + certificat importé.
  if (certificatAffichable(cfg)) sur.cert = await surfaceCertificat(cfg);
  // (NOUVEAU v0.2.119) cachet « Signature électronique » — Switch elecActif
  // ON + métadonnées du module injectées par l'appelant.
  if (signatureElecAffichable(cfg)) sur.elec = await surfaceSignatureElec(cfg);
  return sur;
}

/**
 * (NOUVEAU v0.2.88) Surface du bloc certificat (texte multi-lignes centré,
 * 6,5 pt comme le PDF) — dessinée AU-DESSUS de la mention quand les deux
 * existent. Jumelle JS obligatoire côté portail (surfaceCertificatTampon).
 */
async function surfaceCertificat(cfg: ConfigTampon): Promise<SurfacePng | null> {
  const lignes = lignesCertificat(cfg).map((l) => texteWinAnsi(l));
  if (!lignes.length) return null;
  const font = await metriquesHelvetica();
  // (MODIFIÉ v0.2.92) échelle du bloc (certTaille 50 → 300 %, défaut 100).
  const echelleCert = echelleCertificat(cfg);
  const taille = 6.5 * echelleCert;
  const pas = 9 * echelleCert;
  const wPt = Math.max(...lignes.map((l) => font.widthOfTextAtSize(l, taille))) + 4;
  const hPt = lignes.length * pas + 4;
  const W = wPt * ECHELLE_SURFACE;
  const H = hPt * ECHELLE_SURFACE;
  const parties: string[] = [];
  let yPt = pas; // première ligne (SVG mesure depuis le HAUT)
  for (const ligne of lignes) {
    parties.push(
      `<text x="${W / 2}" y="${yPt * ECHELLE_SURFACE}" text-anchor="middle" font-family="${FONT_SVG}" font-size="` +
        taille * ECHELLE_SURFACE +
        `" fill="#4d4d4d">${echapperXml(ligne)}</text>`
    );
    yPt += pas;
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    parties.join("") +
    `</svg>`;
  const png = await rasteriserSvg(svg);
  if (!png) return null;
  return { png, wPt, hPt };
}

/**
 * (NOUVEAU v0.2.119) Surface du cachet « Signature électronique » ENCADRÉ
 * (titre gras + lignes centrées + bordure — mêmes dimensions que le PDF :
 * titre 7,5 pt, lignes 6,5 pt, pas 9 pt, marges 5/6 pt). Jumelle JS
 * obligatoire côté portail (surfaceSignatureElecTampon).
 */
async function surfaceSignatureElec(cfg: ConfigTampon): Promise<SurfacePng | null> {
  // ---- (NOUVEAU v0.2.120) FORME ROND : cachet circulaire SVG ----------
  // Deux cercles concentriques + arcs textPath (organisation en haut,
  // « SIGNATURE ÉLECTRONIQUE » en bas) + contenu central — même géométrie
  // que le moteur PDF (diamètre 120 pt × echelleE, bleu #2A57A6).
  if (formeElec(cfg) === "ROND") {
    const rond = contenuCachetRond(cfg);
    if (rond) {
      const D = diametreCachetRond(cfg);
      const wPt = D;
      const hPt = D;
      const S = ECHELLE_SURFACE;
      const W = wPt * S;
      const H = hPt * S;
      const c = W / 2; // centre (px SVG)
      const R = (D / 2) * S;
      const rap = D / DIAMETRE_CACHET_ROND;
      const encre = COULEUR_CACHET_ROND_HEX;
      const parties: string[] = [
        `<circle cx="${c}" cy="${c}" r="${R - (1.1 * S)}" fill="none" stroke="${encre}" stroke-width="${2.2 * rap * S}" stroke-opacity="0.92"/>`,
        (() => {
          const Ri = (D / 2 - D * 0.075) * S;
          return `<circle cx="${c}" cy="${c}" r="${Ri}" fill="none" stroke="${encre}" stroke-width="${0.8 * rap * S}" stroke-opacity="0.75"/>`;
        })(),
      ];
      const rayonTexte = (D / 2 - D * 0.115) * S;
      const tailleArc = D * 0.072 * S;
      const tailleArcBas = tailleArc * 0.9;
      if (rond.arcHaut || rond.arcBas) {
        // Chemins d'arc : haut = demi-cercle supérieur (gauche → droite par
        // le sommet, sweep 1) ; bas = demi-cercle inférieur (gauche →
        // droite par le bas, sweep 0). Les glyphes SVG s'alignent perpen-
        // diculairement à la direction du chemin : haut = corps vers
        // l'extérieur (rayon réduit), bas = corps vers le centre (rayon
        // augmenté) — même convention que le moteur PDF.
        const rayonHaut = rayonTexte - tailleArc * 0.35;
        const rayonBas = rayonTexte + tailleArcBas * 0.31;
        parties.push(
          `<defs>` +
            `<path id="arc-haut-cachet" d="M ${c - rayonHaut},${c} A ${rayonHaut},${rayonHaut} 0 0,1 ${c + rayonHaut},${c}" fill="none"/>` +
            `<path id="arc-bas-cachet" d="M ${c - rayonBas},${c} A ${rayonBas},${rayonBas} 0 0,0 ${c + rayonBas},${c}" fill="none"/>` +
          `</defs>`
        );
      }
      if (rond.arcHaut)
        parties.push(
          `<text font-family="${FONT_SVG}" font-size="${tailleArc}" font-weight="bold" fill="${encre}" letter-spacing="${tailleArc * 0.18}">` +
            `<textPath href="#arc-haut-cachet" startOffset="50%" text-anchor="middle">${echapperXml(rond.arcHaut)}</textPath></text>`
        );
      if (rond.arcBas)
        parties.push(
          `<text font-family="${FONT_SVG}" font-size="${tailleArcBas}" fill="${encre}" letter-spacing="${tailleArcBas * 0.18}">` +
            `<textPath href="#arc-bas-cachet" startOffset="50%" text-anchor="middle">${echapperXml(rond.arcBas)}</textPath></text>`
        );
      // Points décoratifs gauche/droite (séparateurs des arcs).
      const rPtS = D * 0.016 * S;
      for (const dx of [-rayonTexte, rayonTexte]) {
        parties.push(`<circle cx="${c + dx}" cy="${c}" r="${rPtS}" fill="${encre}"/>`);
      }
      // Contenu central (SVG mesure depuis le HAUT : y = c − décalage).
      const lignesC = rond.centre;
      const tailleNom = 10.5 * rap * S;
      const demiBloc = ((lignesC.length - 1) * tailleNom) / 2;
      for (let i = 0; i < lignesC.length; i++) {
        const ligne = lignesC[i];
        const tailleL = ligne.gras ? tailleNom : Math.max(4.2, ligne.taille * 10.5 * rap * S);
        const yCentre = c - demiBloc + i * tailleNom + (i > 0 ? 2 * S : 0);
        parties.push(
          `<text x="${c}" y="${yCentre}" text-anchor="middle" dominant-baseline="middle" font-family="${FONT_SVG}" font-size="${tailleL}"` +
            (ligne.gras ? ` font-weight="bold"` : ``) +
            ` fill="${encre}">${echapperXml(ligne.texte)}</text>`
        );
        if (i === 0) {
          const demi = D * 0.075 * S;
          const yS = yCentre + tailleNom * 0.82;
          parties.push(
            `<line x1="${c - demi * 1.9}" y1="${yS}" x2="${c - demi * 0.75}" y2="${yS}" stroke="${encre}" stroke-width="${0.7 * rap * S}"/>` +
              `<line x1="${c + demi * 0.75}" y1="${yS}" x2="${c + demi * 1.9}" y2="${yS}" stroke="${encre}" stroke-width="${0.7 * rap * S}"/>` +
              `<circle cx="${c}" cy="${yS}" r="${D * 0.012 * S}" fill="${encre}"/>`
          );
        }
      }
      const svgRond =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
        parties.join("") +
        `</svg>`;
      const pngRond = await rasteriserSvg(svgRond);
      if (pngRond) return { png: pngRond, wPt, hPt };
      // sharp absent/en échec : repli sur la forme RECTANGLE (jamais bloquant).
    }
  }
  // ---- (REFONTE v0.2.121) FORME RECTANGLE « comme le ROND » ------------
  // Mêmes contenus (contenuCachetRond) et même encre bleue, dans un double
  // cadre rectangulaire — jumelle EXACTE du moteur PDF (cf. CACHET_RECT).
  {
    const font = await metriquesHelvetica();
    const fontGras = await metriquesHelveticaGras();
    const geo = geometrieCachetRectangle(cfg, font, fontGras);
    if (geo) {
      const S = geo.echelle;
      const C = CACHET_RECT;
      const K = ECHELLE_SURFACE;
      const wPt = geo.wPt;
      const hPt = geo.hPt;
      const W = wPt * K;
      const H = hPt * K;
      const encre = COULEUR_CACHET_ROND_HEX;
      const cx = W / 2;
      const parties: string[] = [
        // Double cadre : extérieur épais (trait centré sur le bord —
        // décalage de demi-épaisseur) + intérieur fin.
        `<rect x="${1.1 * S * K}" y="${1.1 * S * K}" width="${(wPt - 2.2 * S) * K}" height="${(hPt - 2.2 * S) * K}" fill="none" stroke="${encre}" stroke-width="${2.2 * S * K}" stroke-opacity="0.92"/>`,
        `<rect x="${C.cadre * S * K}" y="${C.cadre * S * K}" width="${(wPt - 2 * C.cadre * S) * K}" height="${(hPt - 2 * C.cadre * S) * K}" fill="none" stroke="${encre}" stroke-width="${0.8 * S * K}" stroke-opacity="0.75"/>`,
      ];
      // SVG mesure depuis le HAUT : même empilement que le moteur PDF
      // (consomme EXACTEMENT les constantes CACHET_RECT). (v0.2.128) zones
      // vides du formulaire de choix : ni dessinées ni consommées.
      let yT = C.padH * S; // bord supérieur de la 1re zone (org)
      if (geo.org.texte) {
        parties.push(
          `<text x="${cx}" y="${(yT + geo.org.taille * 0.85) * K}" text-anchor="middle" font-family="${FONT_SVG}" font-weight="bold" font-size="${geo.org.taille * K}" fill="${encre}">${echapperXml(geo.org.texte)}</text>`
        );
        yT += (C.corpsOrg + C.g1) * S;
        // Ligne séparatrice sous l'en-tête (courte, centrée).
        const demiLigne = wPt * 0.3;
        parties.push(
          `<line x1="${cx - demiLigne * K}" y1="${(yT + C.trait * S * 0.5) * K}" x2="${cx + demiLigne * K}" y2="${(yT + C.trait * S * 0.5) * K}" stroke="${encre}" stroke-width="${C.trait * S * K}" stroke-opacity="0.9"/>`
        );
        yT += (C.trait + C.g2) * S;
      }
      if (geo.nom.texte) {
        parties.push(
          `<text x="${cx}" y="${(yT + geo.nom.taille) * K}" text-anchor="middle" font-family="${FONT_SVG}" font-weight="bold" font-size="${geo.nom.taille * K}" fill="${encre}">${echapperXml(geo.nom.texte)}</text>`
        );
        yT += C.pasNom * S;
        // Séparateur décoratif « — • — ».
        const ySep = (yT + C.sep * S * 0.5) * K;
        const demi = wPt * 0.055;
        parties.push(
          `<line x1="${cx - demi * 1.9 * K}" y1="${ySep}" x2="${cx - demi * 0.75 * K}" y2="${ySep}" stroke="${encre}" stroke-width="${0.7 * S * K}" stroke-opacity="0.9"/>` +
            `<line x1="${cx + demi * 0.75 * K}" y1="${ySep}" x2="${cx + demi * 1.9 * K}" y2="${ySep}" stroke="${encre}" stroke-width="${0.7 * S * K}" stroke-opacity="0.9"/>` +
            `<circle cx="${cx}" cy="${ySep}" r="${1.44 * S * K}" fill="${encre}"/>`
        );
        yT += C.sep * S;
      }
      for (let i = 0; i < geo.petites.length; i++) {
        const ligne = geo.petites[i];
        parties.push(
          `<text x="${cx}" y="${(yT + ligne.taille) * K}" text-anchor="middle" font-family="${FONT_SVG}" font-size="${ligne.taille * K}" fill="${encre}">${echapperXml(ligne.texte)}</text>`
        );
        yT += (i === 0 ? C.pasPetite : C.pasPetite2) * S;
      }
      if (geo.petites.length) yT += C.g3 * S;
      if (geo.mention.texte)
        parties.push(
          `<text x="${cx}" y="${(yT + geo.mention.taille * 0.9) * K}" text-anchor="middle" font-family="${FONT_SVG}" font-size="${geo.mention.taille * K}" fill="${encre}">${echapperXml(geo.mention.texte)}</text>`
        );
      const svgRect =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
        parties.join("") +
        `</svg>`;
      const pngRect = await rasteriserSvg(svgRect);
      if (pngRect) return { png: pngRect, wPt, hPt };
      // sharp absent/en échec : repli sur le rendu historique ci-dessous.
    }
  }
  const lignes = lignesSignatureElec(cfg).map((l) => texteWinAnsi(l));
  if (!lignes.length) return null;
  const font = await metriquesHelvetica();
  const echelleE = echelleElec(cfg);
  const tailleTitre = 7.5 * echelleE;
  const taille = 6.5 * echelleE;
  const pas = 9 * echelleE;
  const wTitre = font.widthOfTextAtSize(lignes[0], tailleTitre);
  const wLignes = lignes.slice(1).map((l) => font.widthOfTextAtSize(l, taille));
  const wPt = Math.max(wTitre, ...(wLignes.length ? wLignes : [0])) + 12;
  const hPt = 5 + tailleTitre * 0.85 + (lignes.length - 1) * pas + 5;
  const W = wPt * ECHELLE_SURFACE;
  const H = hPt * ECHELLE_SURFACE;
  const parties: string[] = [
    // Cadre (identique au PDF : trait fin gris foncé).
    `<rect x="${0.45 * ECHELLE_SURFACE}" y="${0.45 * ECHELLE_SURFACE}" width="${(wPt - 0.9) * ECHELLE_SURFACE}" height="${(hPt - 0.9) * ECHELLE_SURFACE}" fill="none" stroke="#404040" stroke-width="${0.9 * ECHELLE_SURFACE}"/>`,
  ];
  // SVG mesure depuis le HAUT : titre en premier (padding haut 5 pt).
  let yPt = 5 + tailleTitre * 0.85; // baseline du titre
  parties.push(
    `<text x="${W / 2}" y="${yPt * ECHELLE_SURFACE}" text-anchor="middle" font-family="${FONT_SVG}" font-size="` +
      tailleTitre * ECHELLE_SURFACE +
      `" font-weight="bold" fill="#262626">${echapperXml(lignes[0])}</text>`
  );
  for (const ligne of lignes.slice(1)) {
    yPt += pas;
    parties.push(
      `<text x="${W / 2}" y="${yPt * ECHELLE_SURFACE}" text-anchor="middle" font-family="${FONT_SVG}" font-size="` +
        taille * ECHELLE_SURFACE +
        `" fill="#404040">${echapperXml(ligne)}</text>`
    );
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    parties.join("") +
    `</svg>`;
  const png = await rasteriserSvg(svg);
  if (!png) return null;
  return { png, wPt, hPt };
}

/** Boîtes (points, y = bas-up comme le PDF) — mêmes règles que le PDF :
 * coin + décalage borné + écart si signature et QR partagent le coin. */
function boitesTampon(
  pageW: number,
  pageH: number,
  cfg: ConfigTampon,
  sur: SurfacesTampon
): { qr: Boite | null; sig: Boite | null } {
  let boiteQr: Boite | null = null;
  if (sur.qr) {
    const pos = coinVersBoite(
      cfg.qrPosition, pageW, pageH, sur.qr.wPt, sur.qr.hPt,
      cfg.mentionActif, cfg.qrDecalX, cfg.qrDecalY
    );
    boiteQr = { x: pos.x, y: pos.y, w: sur.qr.wPt, h: sur.qr.hPt };
  }
  let boiteSig: Boite | null = null;
  if (sur.sig) {
    const pos = coinVersBoite(
      cfg.sigPosition, pageW, pageH, sur.sig.wPt, sur.sig.hPt,
      cfg.mentionActif, cfg.sigDecalX, cfg.sigDecalY
    );
    boiteSig = { x: pos.x, y: pos.y, w: sur.sig.wPt, h: sur.sig.hPt };
    if (chevauche(boiteSig, boiteQr) && boiteQr) {
      const aDroite = cfg.sigPosition.endsWith("DROITE");
      boiteSig.x = aDroite
        ? boiteQr.x - ECART_ELEMENTS - boiteSig.w
        : boiteQr.x + boiteQr.w + ECART_ELEMENTS;
    }
  }
  return { qr: boiteQr, sig: boiteSig };
}

/* --------------------------- Moteur IMAGE --------------------------- */

/**
 * Compose la signature/le QR/la mention SUR LES PIXELS de la fiche image
 * (PNG/JPG) : 1 px = 1 pt — mêmes coins et marges que le PDF. L'orientation
 * EXIF est appliquée avant le calcul. Sortie : même format que l'entrée.
 * Ne lève JAMAIS d'exception (repli : image originale).
 */
export async function tamponnerFicheImage(
  donnees: Buffer,
  fiche: InfosFiche,
  cfg: ConfigTampon
): Promise<Buffer> {
  if (!tamponActif(cfg)) return donnees;
  const sharp = chargeSharp();
  if (!sharp) {
    console.warn("[TAMPON] sharp indisponible — image servie sans tampon");
    return donnees;
  }
  try {
    const base = sharp(donnees, { failOn: "none" }).rotate(); // EXIF appliqué
    const meta = await base.metadata();
    if (!meta.width || !meta.height) return donnees;
    const W = meta.width;
    const H = meta.height; // 1 px = 1 pt
    const sur = await preparerSurfaces(fiche, cfg);
    const boites = boitesTampon(W, H, cfg, sur);

    const calques: import("sharp").OverlayOptions[] = [];
    if (sur.qr && boites.qr) {
      calques.push({
        input: await sharp(sur.qr.png)
          .resize(Math.max(1, Math.round(boites.qr.w)), Math.max(1, Math.round(boites.qr.h)))
          .png().toBuffer(),
        left: Math.max(0, Math.round(boites.qr.x)),
        top: Math.max(0, Math.round(H - boites.qr.y - boites.qr.h)),
      });
    }
    if (sur.sig && boites.sig) {
      calques.push({
        input: await sharp(sur.sig.png)
          .resize(Math.max(1, Math.round(boites.sig.w)), Math.max(1, Math.round(boites.sig.h)))
          .png().toBuffer(),
        left: Math.max(0, Math.round(boites.sig.x)),
        top: Math.max(0, Math.round(H - boites.sig.y - boites.sig.h)),
      });
    }
    if (sur.mention) {
      calques.push({
        input: await sharp(sur.mention.png)
          .resize(Math.max(1, Math.round(sur.mention.wPt)), Math.max(1, Math.round(sur.mention.hPt)))
          .png().toBuffer(),
        left: Math.max(0, Math.round((W - sur.mention.wPt) / 2)),
        top: Math.max(0, Math.round(H - sur.mention.hPt - 6)),
      });
    }
    // (NOUVEAU v0.2.88 ; MODIFIÉ v0.2.92) bloc certificat POSITIONNABLE —
    // BAS_CENTRE (défaut) = rendu historique exact (centré, AU-DESSUS de la
    // mention ou au bord inférieur) ; 4 coins + décalages certDecalX/Y pour
    // le placement libre (certVersBoite, plancher historique image 6 pt).
    if (sur.cert) {
      const decalMention = sur.mention ? sur.mention.hPt : 0;
      const posCert = certVersBoite(
        cfg.certPosition,
        W,
        H,
        sur.cert.wPt,
        sur.cert.hPt,
        Boolean(sur.mention),
        6 + decalMention,
        cfg.certDecalX,
        cfg.certDecalY
      );
      calques.push({
        input: await sharp(sur.cert.png)
          .resize(Math.max(1, Math.round(sur.cert.wPt)), Math.max(1, Math.round(sur.cert.hPt)))
          .png().toBuffer(),
        left: Math.max(0, Math.round(posCert.x)),
        top: Math.max(0, Math.round(H - posCert.y - sur.cert.hPt)),
      });
    }
    // (NOUVEAU v0.2.119) cachet « Signature électronique » ENCADRÉ — mêmes
    // règles de placement que le bloc certificat (plancher historique 6 pt).
    if (sur.elec) {
      const decalMention = sur.mention ? sur.mention.hPt : 0;
      const posElec = certVersBoite(
        cfg.elecPosition,
        W,
        H,
        sur.elec.wPt,
        sur.elec.hPt,
        Boolean(sur.mention),
        6 + decalMention,
        cfg.elecDecalX,
        cfg.elecDecalY
      );
      calques.push({
        input: await sharp(sur.elec.png)
          .resize(Math.max(1, Math.round(sur.elec.wPt)), Math.max(1, Math.round(sur.elec.hPt)))
          .png().toBuffer(),
        left: Math.max(0, Math.round(posElec.x)),
        top: Math.max(0, Math.round(H - posElec.y - sur.elec.hPt)),
      });
    }
    if (calques.length === 0) return donnees;
    const sortie = base.composite(calques);
    return meta.format === "jpeg"
      ? await sortie.jpeg({ quality: 92, mozjpeg: true }).toBuffer()
      : await sortie.png().toBuffer();
  } catch (error) {
    console.error("[TAMPON] Tampon image impossible — fiche servie sans tampon:", error);
    return donnees;
  }
}

/* --------------------------- Moteur DOCX ---------------------------- */

const REL_IMAGE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const NS_WP =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Paragraphe porteur d'une image ANCRÉE À LA PAGE (OOXML valide autonome :
 * espaces de noms déclarés sur les éléments, indépendamment du document). */
function ancreDocx(
  docPrId: number,
  rId: string,
  nom: string,
  xPt: number,
  yPt: number,
  wPt: number,
  hPt: number
): string {
  const cx = Math.round(wPt * EMU_PAR_PT);
  const cy = Math.round(hPt * EMU_PAR_PT);
  const x = Math.round(Math.max(0, xPt) * EMU_PAR_PT);
  const y = Math.round(Math.max(0, yPt) * EMU_PAR_PT);
  return (
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:drawing>` +
    `<wp:anchor xmlns:wp="${NS_WP}" distT="0" distB="0" distL="0" distR="0" simplePos="0" ` +
    `relativeHeight="${251658240 + (docPrId % 1000)}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${x}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${y}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    `<wp:docPr id="${docPrId}" name="${echapperXml(nom)}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic xmlns:a="${NS_A}"><a:graphicData uri="${NS_PIC}">` +
    `<pic:pic xmlns:pic="${NS_PIC}">` +
    `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${echapperXml(nom)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip xmlns:r="${NS_R}" r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`
  );
}

/**
 * Ajoute la signature/le QR/la mention comme images ancrées aux coins de la
 * PAGE (taille lue dans <w:sectPr>, A4 par défaut). Toutes les entrées de
 * l'archive d'origine sont conservées à l'identique ; seuls document.xml
 * (paragraphes d'ancrage), les relations et [Content_Types] sont enrichis.
 * Ne lève JAMAIS d'exception (repli : document original).
 */
export async function tamponnerFicheDocx(
  donnees: Buffer,
  fiche: InfosFiche,
  cfg: ConfigTampon
): Promise<Buffer> {
  if (!tamponActif(cfg)) return donnees;
  const JSZip = chargeJszip();
  if (!JSZip) return donnees;
  try {
    const zip = await JSZip.loadAsync(donnees);
    const docFile = zip.file("word/document.xml");
    const relsFile = zip.file("word/_rels/document.xml.rels");
    const typesFile = zip.file("[Content_Types].xml");
    if (!docFile || !relsFile || !typesFile) return donnees;
    const xml = await docFile.async("string");
    let rels = await relsFile.async("string");
    let types = await typesFile.async("string");
    if (!xml.includes("</w:body>")) return donnees;

    // Taille de page (twips → points ; A4 11906×16838 par défaut)
    let W = 595;
    let H = 842;
    const pg = xml.match(/<w:pgSz[^>]*>/);
    if (pg) {
      const mw = /w:w="(\d+)"/.exec(pg[0]);
      const mh = /w:h="(\d+)"/.exec(pg[0]);
      if (mw) W = parseInt(mw[1], 10) / 20;
      if (mh) H = parseInt(mh[1], 10) / 20;
    }

    const sur = await preparerSurfaces(fiche, cfg);
    if (!sur.qr && !sur.sig && !sur.mention && !sur.cert && !sur.elec) return donnees;
    const boites = boitesTampon(W, H, cfg, sur);

    // Relations images : ids rIdN uniques
    let maxRid = 0;
    for (const m of rels.matchAll(/Id="rId(\d+)"/g)) {
      maxRid = Math.max(maxRid, parseInt(m[1], 10));
    }
    let docPr = 99001;
    for (const m of xml.matchAll(/<wp:docPr id="(\d+)"/g)) {
      docPr = Math.max(docPr, parseInt(m[1], 10) + 1);
    }

    const paragraphes: string[] = [];
    const relsPush = (png: Buffer, nom: string, cible: string) => {
      maxRid += 1;
      const rId = "rId" + maxRid;
      rels =
        rels.replace(/<\/Relationships>/, `<Relationship Id="${rId}" Type="${REL_IMAGE}" Target="${cible}"/></Relationships>`);
      return rId;
    };

    if (sur.qr && boites.qr) {
      zip.file("word/media/tampon-qr.png", sur.qr.png);
      const rId = relsPush(sur.qr.png, "TamponQR", "media/tampon-qr.png");
      // OOXML : posOffset positionV se mesure depuis le HAUT de la page
      // (boîtes en coordonnées PDF = depuis le BAS) → conversion.
      paragraphes.push(
        ancreDocx(docPr++, rId, "TamponQR", boites.qr.x, H - boites.qr.y - boites.qr.h, boites.qr.w, boites.qr.h)
      );
    }
    if (sur.sig && boites.sig) {
      zip.file("word/media/tampon-sig.png", sur.sig.png);
      const rId = relsPush(sur.sig.png, "TamponSignature", "media/tampon-sig.png");
      paragraphes.push(
        ancreDocx(docPr++, rId, "TamponSignature", boites.sig.x, H - boites.sig.y - boites.sig.h, boites.sig.w, boites.sig.h)
      );
    }
    if (sur.mention) {
      zip.file("word/media/tampon-mention.png", sur.mention.png);
      const rId = relsPush(sur.mention.png, "TamponMention", "media/tampon-mention.png");
      paragraphes.push(
        ancreDocx(docPr++, rId, "TamponMention", (W - sur.mention.wPt) / 2, H - 6 - sur.mention.hPt, sur.mention.wPt, sur.mention.hPt)
      );
    }
    // (NOUVEAU v0.2.88 ; MODIFIÉ v0.2.92) bloc certificat POSITIONNABLE —
    // BAS_CENTRE (défaut) = rendu historique exact (centré, AU-DESSUS de la
    // mention ou au bord inférieur) ; 4 coins + décalages certDecalX/Y pour
    // le placement libre (certVersBoite, plancher historique DOCX 6 pt).
    if (sur.cert) {
      const decalMention = sur.mention ? sur.mention.hPt : 0;
      const posCert = certVersBoite(
        cfg.certPosition,
        W,
        H,
        sur.cert.wPt,
        sur.cert.hPt,
        Boolean(sur.mention),
        6 + decalMention,
        cfg.certDecalX,
        cfg.certDecalY
      );
      zip.file("word/media/tampon-certificat.png", sur.cert.png);
      const rId = relsPush(sur.cert.png, "TamponCertificat", "media/tampon-certificat.png");
      paragraphes.push(
        ancreDocx(docPr++, rId, "TamponCertificat", posCert.x, H - posCert.y - sur.cert.hPt, sur.cert.wPt, sur.cert.hPt)
      );
    }
    // (NOUVEAU v0.2.119) cachet « Signature électronique » ENCADRÉ — mêmes
    // règles de placement que le bloc certificat (plancher historique 6 pt).
    if (sur.elec) {
      const decalMention = sur.mention ? sur.mention.hPt : 0;
      const posElec = certVersBoite(
        cfg.elecPosition,
        W,
        H,
        sur.elec.wPt,
        sur.elec.hPt,
        Boolean(sur.mention),
        6 + decalMention,
        cfg.elecDecalX,
        cfg.elecDecalY
      );
      zip.file("word/media/tampon-signature-elec.png", sur.elec.png);
      const rId = relsPush(sur.elec.png, "TamponSignatureElec", "media/tampon-signature-elec.png");
      paragraphes.push(
        ancreDocx(docPr++, rId, "TamponSignatureElec", posElec.x, H - posElec.y - sur.elec.hPt, sur.elec.wPt, sur.elec.hPt)
      );
    }
    if (paragraphes.length === 0) return donnees;

    // [Content_Types].xml : Default png (absent des documents sans image)
    if (!/Extension="png"/.test(types)) {
      types = types.replace(
        /<\/Types>/,
        `<Default Extension="png" ContentType="image/png"/></Types>`
      );
    }

    // Insertion AVANT le sectPr FINAL du corps (jamais après) : le dernier
    // <w:sectPr n'est le sectPr de fin de document QUE si rien ne le suit.
    const idxBody = xml.lastIndexOf("</w:body>");
    let insertion = idxBody;
    const idxSect = xml.lastIndexOf("<w:sectPr");
    if (idxSect >= 0 && idxSect < idxBody) {
      const queue = xml.slice(idxSect, idxBody);
      if (/^<w:sectPr[\s\S]*<\/w:sectPr>\s*$/.test(queue)) insertion = idxSect;
    }
    const nouveauXml = xml.slice(0, insertion) + paragraphes.join("") + xml.slice(insertion);

    zip.file("word/document.xml", nouveauXml);
    zip.file("word/_rels/document.xml.rels", rels);
    zip.file("[Content_Types].xml", types);
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } catch (error) {
    console.error("[TAMPON] Tampon DOCX impossible — document servi sans tampon:", error);
    return donnees;
  }
}

/* --------------------------- Moteur XLSX ---------------------------- */

/** Lettre(s) de colonne → index 1-based (A=1). */
function colonneVersIndex(lettres: string): number {
  let n = 0;
  for (const c of lettres) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

const NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";

/**
 * Ajoute la signature/le QR/la mention en ancrage ABSOLU (xdr:absoluteAnchor)
 * À DROITE de la plage utilisée de chaque feuille qui ne contient pas déjà
 * un dessin (une feuille avec <drawing> est laissée intacte). Largeur des
 * colonnes estimée depuis <cols> (repli 64 px). Feuilles plafonnées à 20.
 * Ne lève JAMAIS d'exception (repli : classeur original).
 */
export async function tamponnerFicheXlsx(
  donnees: Buffer,
  fiche: InfosFiche,
  cfg: ConfigTampon
): Promise<Buffer> {
  if (!tamponActif(cfg)) return donnees;
  const JSZip = chargeJszip();
  if (!JSZip) return donnees;
  try {
    const zip = await JSZip.loadAsync(donnees);
    if (!zip.file("xl/workbook.xml")) return donnees;
    const sur = await preparerSurfaces(fiche, cfg);
    if (!sur.qr && !sur.sig && !sur.mention && !sur.cert && !sur.elec) return donnees;

    // médias partagés entre les feuilles
    if (sur.qr) zip.file("xl/media/tampon-qr.png", sur.qr.png);
    if (sur.sig) zip.file("xl/media/tampon-sig.png", sur.sig.png);
    if (sur.mention) zip.file("xl/media/tampon-mention.png", sur.mention.png);
    if (sur.cert) zip.file("xl/media/tampon-certificat.png", sur.cert.png);
    if (sur.elec) zip.file("xl/media/tampon-signature-elec.png", sur.elec.png);

    // [Content_Types].xml : Default png + Override par dessin ajouté
    let types = (await zip.file("[Content_Types].xml")?.async("string")) ?? "";
    if (!types) return donnees;
    if (!/Extension="png"/.test(types)) {
      types = types.replace(/<\/Types>/, `<Default Extension="png" ContentType="image/png"/></Types>`);
    }

    const feuilles = Object.keys(zip.files)
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort();
    const elementsApres = ["legacyDrawing", "picture", "oleObjects", "controls", "webPublishItems", "tableParts", "extLst"];
    let dessinsAjoutes = 0;

    for (const chemin of feuilles.slice(0, 20)) {
      const xml = await zip.file(chemin)?.async("string");
      if (!xml || xml.includes("<drawing ")) continue; // dessin existant : intact

      // Plage utilisée → boîte de contenu (px ; 1 px ≈ 1 pt pour la géométrie)
      let dernierCol = 10;
      let dernierLig = 30;
      const dim = xml.match(/<dimension[^>]*ref="([^"]*)"/);
      if (dim && dim[1].includes(":")) {
        const fin = dim[1].split(":")[1];
        const lettres = fin.match(/^[A-Z]+/);
        const chiffres = fin.match(/\d+$/);
        if (lettres) dernierCol = colonneVersIndex(lettres[0]);
        if (chiffres) dernierLig = parseInt(chiffres[0], 10);
      }
      const largeurs = new Map<number, number>();
      for (const m of xml.matchAll(/<col\b[^>]*>/g)) {
        const tag = m[0];
        const min = Number(/min="(\d+)"/.exec(tag)?.[1] ?? 0);
        const max = Number(/max="(\d+)"/.exec(tag)?.[1] ?? 0);
        const wAttr = /width="([\d.]+)"/.exec(tag);
        if (min > 0 && max >= min && wAttr) {
          const px = Math.round(parseFloat(wAttr[1]) * 7) + 5;
          for (let c = min; c <= Math.min(max, min + 199); c++) largeurs.set(c, px);
        }
      }
      let bordDroitPx = 0;
      for (let c = 1; c <= dernierCol; c++) bordDroitPx += largeurs.get(c) ?? 64;
      const basPx = dernierLig * 20; // hauteur de ligne par défaut ≈ 20 px

      // Coins du tampon = coins de la PLAGE UTILISÉE (mêmes règles que le
      // PDF : coin + décalage borné + écart) — le tampon reste ainsi DANS la
      // zone imprimable, comme un vrai cachet apposé sur le tableau.
      const boites = boitesTampon(bordDroitPx, basPx, cfg, sur);

      // Style openpyxl (VALIDÉ LibreOffice + Excel) : espace de noms PAR
      // DÉFAUT (éléments non préfixés), a:/r: déclarés en ligne, ancrage
      // oneCellAnchor, cibles de relations absolues.
      const ancres: string[] = [];
      const relsDessin: string[] = [];
      let idMedia = 0;
      const celluleDepuisPx = (xPx: number): { col: number; offPx: number } => {
        let cumule = 0;
        for (let c = 1; c <= 600; c++) {
          const l = largeurs.get(c) ?? 64;
          if (xPx < cumule + l) return { col: c - 1, offPx: xPx - cumule };
          cumule += l;
        }
        return { col: 599, offPx: 0 };
      };
      const calque = (surface: SurfacePng, nom: string, xPx: number, yPx: number) => {
        idMedia += 1;
        const rId = "rId" + idMedia;
        const cell = celluleDepuisPx(Math.max(0, xPx));
        const yPos = Math.max(0, yPx);
        const lig = Math.floor(yPos / 20);
        const cx = Math.round(surface.wPt * EMU_PAR_PX);
        const cy = Math.round(surface.hPt * EMU_PAR_PX);
        relsDessin.push(
          `<Relationship Type="${REL_IMAGE}" Target="/xl/media/${nom}" Id="${rId}"/>`
        );
        ancres.push(
          `<oneCellAnchor><from><col>${cell.col}</col><colOff>${Math.round(cell.offPx * EMU_PAR_PX)}</colOff>` +
            `<row>${lig}</row><rowOff>${Math.round((yPos - lig * 20) * EMU_PAR_PX)}</rowOff></from>` +
            `<ext cx="${cx}" cy="${cy}"/>` +
            `<pic><nvPicPr><cNvPr id="${idMedia}" name="${nom}"/><cNvPicPr/></nvPicPr>` +
            `<blipFill><a:blip xmlns:a="${NS_A}" xmlns:r="${NS_R}" cstate="print" r:embed="${rId}"/>` +
            `<a:stretch xmlns:a="${NS_A}"><a:fillRect/></a:stretch></blipFill>` +
            `<spPr><a:prstGeom xmlns:a="${NS_A}" prst="rect"/></spPr></pic>` +
            `<clientData/></oneCellAnchor>`
        );
      };
      // NB : boitesTampon renvoie des y « bas-up » (convention PDF) — la
      // feuille se mesure depuis le HAUT : conversion yTop = H − y − h.
      if (sur.qr && boites.qr) calque(sur.qr, "tampon-qr.png", boites.qr.x, basPx - boites.qr.y - boites.qr.h);
      if (sur.sig && boites.sig) calque(sur.sig, "tampon-sig.png", boites.sig.x, basPx - boites.sig.y - boites.sig.h);
      if (sur.mention) {
        const xM = Math.max(0, (bordDroitPx - sur.mention.wPt) / 2);
        const yM = Math.max(0, basPx - sur.mention.hPt - 4);
        calque(sur.mention, "tampon-mention.png", xM, yM);
      }
      // (NOUVEAU v0.2.88 ; MODIFIÉ v0.2.92) bloc certificat POSITIONNABLE —
      // BAS_CENTRE (défaut) = rendu historique exact (centré, AU-DESSUS de
      // la mention ou au bord inférieur) ; 4 coins + décalages certDecalX/Y
      // pour le placement libre (certVersBoite, plancher historique XLSX 4 pt).
      if (sur.cert) {
        const decalMention = sur.mention ? sur.mention.hPt : 0;
        const posCert = certVersBoite(
          cfg.certPosition,
          bordDroitPx,
          basPx,
          sur.cert.wPt,
          sur.cert.hPt,
          Boolean(sur.mention),
          4 + decalMention,
          cfg.certDecalX,
          cfg.certDecalY
        );
        calque(sur.cert, "tampon-certificat.png", posCert.x, basPx - posCert.y - sur.cert.hPt);
      }
      // (NOUVEAU v0.2.119) cachet « Signature électronique » ENCADRÉ — mêmes
      // règles de placement que le bloc certificat (plancher historique 4 pt).
      if (sur.elec) {
        const decalMention = sur.mention ? sur.mention.hPt : 0;
        const posElec = certVersBoite(
          cfg.elecPosition,
          bordDroitPx,
          basPx,
          sur.elec.wPt,
          sur.elec.hPt,
          Boolean(sur.mention),
          4 + decalMention,
          cfg.elecDecalX,
          cfg.elecDecalY
        );
        calque(sur.elec, "tampon-signature-elec.png", posElec.x, basPx - posElec.y - sur.elec.hPt);
      }
      if (ancres.length === 0) continue;

      const numFeuille = chemin.match(/sheet(\d+)\.xml/)?.[1] ?? String(dessinsAjoutes + 1);
      const nomDessin = "tampon-feuille-" + numFeuille + ".xml";
      zip.file(
        "xl/drawings/" + nomDessin,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<wsDr xmlns="${NS_XDR}">` +
          ancres.join("") +
          `</wsDr>`
      );
      zip.file(
        "xl/drawings/_rels/" + nomDessin + ".rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          relsDessin.join("") +
          `</Relationships>`
      );
      types = types.replace(
        /<\/Types>/,
        `<Override PartName="/xl/drawings/${nomDessin}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`
      );

      // Relations de la FEUILLE : créer (rId1) ou compléter (max + 1)
      // (cible ABSOLUE, style validé LibreOffice/Excel)
      const cheminRels = `xl/worksheets/_rels/sheet${numFeuille}.xml.rels`;
      let rIdFeuille = "rId1";
      const relsFeuilleExistante = await zip.file(cheminRels)?.async("string");
      if (relsFeuilleExistante) {
        let maxR = 0;
        for (const m of relsFeuilleExistante.matchAll(/Id="rId(\d+)"/g)) {
          maxR = Math.max(maxR, parseInt(m[1], 10));
        }
        rIdFeuille = "rId" + (maxR + 1);
        zip.file(
          cheminRels,
          relsFeuilleExistante.replace(
            /<\/Relationships>/,
            `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/${nomDessin}" Id="${rIdFeuille}"/></Relationships>`
          )
        );
      } else {
        zip.file(
          cheminRels,
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
            `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
            `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/${nomDessin}" Id="${rIdFeuille}"/>` +
            `</Relationships>`
        );
      }

      // <drawing r:id="…"/> juste avant le premier élément qui DOIT le suivre
      // (l'élément déclare son propre xmlns:r : aucune retouche de la racine)
      let idxIns = xml.lastIndexOf("</worksheet>");
      for (const balise of elementsApres) {
        const i = xml.indexOf("<" + balise);
        if (i >= 0 && i < idxIns) idxIns = i;
      }
      const nouveauXml =
        xml.slice(0, idxIns) + `<drawing xmlns:r="${NS_R}" r:id="${rIdFeuille}"/>` + xml.slice(idxIns);
      zip.file(chemin, nouveauXml);
      dessinsAjoutes += 1;
    }
    if (dessinsAjoutes === 0) return donnees;
    zip.file("[Content_Types].xml", types);
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } catch (error) {
    console.error("[TAMPON] Tampon XLSX impossible — classeur servi sans tampon:", error);
    return donnees;
  }
}

/* --------------------------- Répartiteur ---------------------------- */

/**
 * Applique le tampon au bon moteur selon le type de fichier servi.
 * Ne lève JAMAIS d'exception (chaque moteur a son propre repli interne).
 */
export async function tamponnerFicheDossier(
  donnees: Buffer,
  fiche: InfosFiche,
  cfg: ConfigTampon,
  type: TypeFichierTampon
): Promise<Buffer> {
  if (type === "pdf") return tamponnerFichePdf(donnees, fiche, cfg);
  if (type === "image") return tamponnerFicheImage(donnees, fiche, cfg);
  if (type === "docx") return tamponnerFicheDocx(donnees, fiche, cfg);
  if (type === "xlsx") return tamponnerFicheXlsx(donnees, fiche, cfg);
  return donnees;
}

/* ------------------------------------------------------------------ */
/* Aperçu : fiche d'exemple tamponnée (bouton « Aperçu »)              */
/* ------------------------------------------------------------------ */

/** Génère un mini PDF d'exemple (A4) ressemblant à une fiche de paie. */
async function pdfExemple(): Promise<{ octets: Buffer; fiche: InfosFiche }> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4 portrait
  const gras = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fin = await pdf.embedFont(StandardFonts.Helvetica);
  const gris = rgb(0.55, 0.55, 0.55);
  const noir = rgb(0.1, 0.1, 0.1);

  page.drawText("APERÇU — FICHE DE PAIE (exemple)", { x: 50, y: 790, size: 16, font: gras, color: noir });
  const lignes: [string, number, PDFFont][] = [
    ["Employé : BEN SALAH Yosra", 755, fin],
    ["CIN : 12345678", 735, fin],
    ["Période de paie : 01/08/2026 au 31/08/2026", 715, fin],
    ["Salaire brut : 2 100,000 DT", 680, fin],
    ["CNSS (9,18 %) : -192,780 DT", 660, fin],
    ["Impôt sur le revenu : -231,000 DT", 640, fin],
    ["Net à payer : 1 593,851 DT", 600, gras],
  ];
  for (const [t, y, f] of lignes) page.drawText(t, { x: 50, y, size: 11, font: f, color: noir });
  for (let y = 560; y > 120; y -= 24) {
    page.drawRectangle({ x: 50, y, width: 495, height: 0.8, color: gris, opacity: 0.35 });
  }
  page.drawText("Cet exemple montre l'emplacement du tampon avant activation réelle.", {
    x: 50,
    y: 80,
    size: 9,
    font: fin,
    color: gris,
  });

  const fiche: InfosFiche = {
    id: "APERCU-EXAMPLE-0001",
    employeeName: "BEN SALAH Yosra",
    cin: "12345678",
    period: "08/2026",
    netSalary: "1 593,851 DT",
    uploadedAt: new Date(),
  };
  return { octets: Buffer.from(await pdf.save()), fiche };
}

export interface ReelApercu {
  octets: Buffer;
  fiche: InfosFiche;
  /** "pdf" (défaut) ou "image" (fiche réelle PNG/JPEG — aperçu rendu par
   * le même moteur que l'affichage final). DOCX/XLSX exclus (non
   * affichables dans le navigateur). */
  type?: "pdf" | "image";
  /** Type MIME de retour pour une fiche image ("image/png"|"image/jpeg"). */
  mime?: string;
}

/**
 * POST aperçu : applique la configuration FOURNIE (non enregistrée) à une
 * fiche RÉELLE quand le demandeur en fournit une (MODIFIÉ 0.2.47 : la
 * rubrique envoie la DERNIÈRE fiche importée — rendu exactement identique
 * à l'affichage final ; MODIFIÉ 0.2.48 : une fiche IMAGE (PNG/JPEG) fait
 * aussi l'affaire quand aucune fiche PDF exploitable n'existe), sinon à
 * l'exemple synthétique historique.
 */
export async function apercuTampon(
  cfg: ConfigTampon,
  reel?: ReelApercu | null
): Promise<{ octets: Buffer; mime: string }> {
  if (reel && Buffer.isBuffer(reel.octets) && reel.octets.length > 0) {
    if (reel.type === "image") {
      const tamponne = await tamponnerFicheImage(reel.octets, reel.fiche, cfg);
      return { octets: tamponne, mime: reel.mime || "image/png" };
    }
    return { octets: await tamponnerFichePdf(reel.octets, reel.fiche, cfg), mime: "application/pdf" };
  }
  const { octets, fiche } = await pdfExemple();
  return { octets: await tamponnerFichePdf(octets, fiche, cfg), mime: "application/pdf" };
}

/* ------------------------------------------------------------------ */
/* (NOUVEAU v0.2.93) Aperçu « document de RÉPONSE » (section            */
/* Demandes / Réponses) : PDF synthétique ressemblant à une réponse     */
/* (référence DEM-…, objet, demandeur) tamponné avec la configuration   */
/* RÉPONSES fournie. Mode FICHE choisi + qrUrl renseigné → le QR encode */
/* l'URL publique de vérification de la réponse (même règle que le      */
/* tamponnage réel : infos.urlVerification prioritaire dans contenuQr). */
/* ------------------------------------------------------------------ */

/**
 * (NOUVEAU v0.2.93) Aperçu de la section « Demandes / Réponses » : applique
 * la configuration RÉPONSES fournie (non enregistrée) à un document de
 * réponse d'exemple (PDF synthétique A4) et renvoie le PDF tamponné.
 */
export async function apercuReponseTampon(
  cfg: ConfigTampon
): Promise<{ octets: Buffer; mime: string }> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4 portrait
  const gras = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fin = await pdf.embedFont(StandardFonts.Helvetica);
  const gris = rgb(0.55, 0.55, 0.55);
  const noir = rgb(0.1, 0.1, 0.1);

  page.drawText("APERÇU — RÉPONSE À UNE DEMANDE (exemple)", { x: 50, y: 790, size: 16, font: gras, color: noir });
  const lignes: [string, number, PDFFont][] = [
    ["Référence : DEM-2026-00042", 755, fin],
    ["Objet : Attestation de travail", 735, fin],
    ["Demandeur : BEN SALAH Yosra (CIN 12345678)", 715, fin],
    ["Déposée le : 01/09/2026", 695, fin],
    ["Statut : Acceptée", 660, gras],
  ];
  for (const [t, y, f] of lignes) page.drawText(t, { x: 50, y, size: 11, font: f, color: noir });
  for (let y = 600; y > 120; y -= 24) {
    page.drawRectangle({ x: 50, y, width: 495, height: 0.8, color: gris, opacity: 0.35 });
  }
  page.drawText("Cet exemple montre l'emplacement du tampon des réponses avant activation réelle.", {
    x: 50,
    y: 80,
    size: 9,
    font: fin,
    color: gris,
  });

  const reference = "DEM-2026-00042";
  const fiche: InfosFiche = {
    id: reference,
    employeeName: "BEN SALAH Yosra",
    cin: "12345678",
    period: "Attestation de travail",
    netSalary: "",
    uploadedAt: new Date(),
    titre: "AutoRH — Document officiel",
    objet: "Attestation de travail",
  };
  // (MODIFIÉ v0.2.97) qrUrl renseigné ET mode FICHE choisi → le QR de
  // l'aperçu encode l'URL publique de vérification (jumelle exacte du
  // tamponnage réel des réponses — repondre/route.ts). Les autres modes
  // (DONNEES/URL/TEXTE/IMAGE) montrent leur contenu propre dans l'aperçu.
  const baseQr = String(cfg.qrUrl ?? "").trim().replace(/\/+$/, "");
  if (cfg.qrMode === "FICHE" && baseQr) {
    fiche.urlVerification =
      baseQr + "/verification/reponse/" + encodeURIComponent(reference) + "?t=" + jetonReponse(reference);
  }
  const octets = Buffer.from(await pdf.save());
  return { octets: await tamponnerFichePdf(octets, fiche, cfg), mime: "application/pdf" };
}
