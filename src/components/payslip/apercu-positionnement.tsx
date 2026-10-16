"use client";
/**
 * ============================================================================
 *  NOUVEAU (v0.2.93) — APERÇU A4 INTERACTIF MULTI-ÉLÉMENTS (COMPONENT PARTAGÉ)
 * ============================================================================
 *
 *  Composant extrait de signature-panel.tsx (v0.2.89/0.2.92) et partagé entre
 *  les DEUX sections (séparation des configurations v0.2.93) :
 *   - Section « Import » (signature-panel.tsx) — config des FICHES DE PAIE ;
 *   - Section « Demandes / Réponses » (signature-panel-reponses.tsx) — config
 *     PROPRES aux documents de réponse.
 *
 *  Affiche la signature, le QR code ET le bloc certificat (quand actifs) sur
 *  une feuille A4 (595×842 pt) — CHACUN déplaçable indépendamment :
 *   - clic = positionner, glisser = déplacer librement (pointer events +
 *     setPointerCapture + touch-none) ;
 *   - le déplacement d'un élément ne modifie QUE SES coordonnées (maj des
 *     seuls champs …DecalX/…DecalY de cet élément) ;
 *   - l'élément attrapé est SÉLECTIONNÉ (contour coloré + coordonnées
 *     affichées en direct) — les curseurs de décalage du panneau suivent en
 *     TEMPS RÉEL (le glisser appelle maj() à chaque mouvement).
 *
 *  Géométrie répliquée EXACTEMENT depuis src/lib/stamp.ts (coinVersBoite +
 *  certVersBoite : mêmes constantes, mêmes bornes) — l'aperçu affiche le
 *  rendu réel des documents.
 *
 *  (NOUVEAU v0.2.100) POSITIONNEMENT LIBRE DU CERTIFICAT renforcé :
 *   - le bloc certificat est affiché et manipulable DÈS que l'interrupteur
 *     « Utiliser le certificat » est ON — même AVANT l'import d'un fichier
 *     (bloc d'EXEMPLE de même géométrie, en pointillés) — le placement peut
 *     être préparé puis enregistré ; le rendu réel suit à l'import ;
 *   - POIGNÉE DE REDIMENSIONNEMENT (carré ambré, coin bas-droit du bloc) :
 *     glisser = régler la taille du bloc (certTaille, 50 → 300 %) ;
 *   - coordonnées affichées en pt ET en mm ; helper géométrieCertificat()
 *     exporté pour les champs « Position exacte X/Y » des deux panneaux.
 * ============================================================================
 */
import { useRef, useState } from "react";
import { Label } from "@/components/ui/label";

/** Date ISO/Prisma → JJ/MM/AAAA (fr-FR). */
export function dateFr(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export const POSITIONS = [
  { valeur: "BAS_GAUCHE", libelle: "Bas gauche" },
  { valeur: "BAS_DROITE", libelle: "Bas droite" },
  { valeur: "HAUT_GAUCHE", libelle: "Haut gauche" },
  { valeur: "HAUT_DROITE", libelle: "Haut droite" },
];

// Positions du BLOC CERTIFICAT : BAS_CENTRE = rendu historique (centré
// au-dessus de la mention) + les 4 coins. Échelle du bloc en % (50 → 300).
export const POSITIONS_CERT = [
  { valeur: "BAS_CENTRE", libelle: "Bas centré (au-dessus de la mention)" },
  { valeur: "BAS_GAUCHE", libelle: "Bas gauche" },
  { valeur: "BAS_DROITE", libelle: "Bas droite" },
  { valeur: "HAUT_GAUCHE", libelle: "Haut gauche" },
  { valeur: "HAUT_DROITE", libelle: "Haut droite" },
];
export const CERT_TAILLE_MIN = 50;
export const CERT_TAILLE_MAX = 300;

// (NOUVEAU v0.2.100) 1 mm = 2,8346 pt — unité « position exacte » des champs
// X/Y du bloc certificat (les deux panneaux) et des coordonnées affichées.
export const PT_PAR_MM = 2.834645669;

// Positionnement libre + rotation (bornes identiques au serveur) :
// décalages ±1500 pt, tailles 40–1200 pt, rotations 0–360°.
export const DECAL_MIN = -1500;
export const DECAL_MAX = 1500;
export const TAILLE_MIN = 40;
export const TAILLE_MAX = 1200;
export const ROTATION_MIN = 0;
export const ROTATION_MAX = 360;

// Géométrie PDF répliquée EXACTEMENT depuis src/lib/stamp.ts.
const PAGE_W = 595; // A4 portrait en points
const PAGE_H = 842;
const MARGE_APERCU = 24;
const HAUT_MENTION_APERCU = 22;

function coinVersBoiteApercu(
  position: string,
  w: number,
  h: number,
  mentionPresente: boolean,
  decalX: number,
  decalY: number,
  // (NOUVEAU v0.2.143) ancre BAS personnalisée — documents de réponse :
  // réserve de signature à 42 pt (ZONE_SIGNE.bas) au lieu de la mention 22.
  basDecalOverride?: number
): { x: number; y: number } {
  const haut = position.startsWith("HAUT");
  const droite = position.endsWith("DROITE");
  const basDecal = basDecalOverride != null ? basDecalOverride : mentionPresente ? HAUT_MENTION_APERCU : MARGE_APERCU;
  const brut = {
    x: (droite ? PAGE_W - MARGE_APERCU - w : MARGE_APERCU) + (decalX || 0),
    y: (haut ? PAGE_H - MARGE_APERCU - h : basDecal) + (decalY || 0),
  };
  const maxX = Math.max(MARGE_APERCU, PAGE_W - MARGE_APERCU - w);
  const maxY = Math.max(basDecal, PAGE_H - MARGE_APERCU - h);
  return {
    x: Math.min(maxX, Math.max(MARGE_APERCU, brut.x)),
    y: Math.min(maxY, Math.max(basDecal, brut.y)),
  };
}

/** Jumelle APERÇU de certVersBoite() de stamp.ts — BAS_CENTRE (défaut) =
 * rendu historique (centré, posé sur yBasDefaut) ; 4 coins = coinVersBoite.
 * (v0.2.143) basDecalOverride : ancre BAS personnalisée (documents de
 * réponse : 42 pt) — transmis tel quel à coinVersBoiteApercu. */
function certVersBoiteApercu(
  position: string,
  w: number,
  h: number,
  mentionPresente: boolean,
  yBasDefaut: number,
  decalX: number,
  decalY: number
): { x: number; y: number } {
  if (String(position || "BAS_CENTRE") === "BAS_CENTRE") {
    const brut = {
      x: (PAGE_W - w) / 2 + (decalX || 0),
      y: yBasDefaut + (decalY || 0),
    };
    const maxX = Math.max(6, PAGE_W - 6 - w);
    const maxY = Math.max(yBasDefaut, PAGE_H - h);
    return {
      x: Math.min(maxX, Math.max(6, brut.x)),
      y: Math.min(maxY, Math.max(0, brut.y)),
    };
  }
  return coinVersBoiteApercu(String(position), w, h, mentionPresente, decalX, decalY);
}

/** Champs de configuration utilisés par l'aperçu (typage souple : les deux
 * configurations — Import et Réponses — le satisfont structurellement). */
export interface ConfigApercu {
  sigActif: boolean;
  sigTaille: number;
  sigTexte: string;
  sigPosition: string;
  sigOpacite: number;
  sigDecalX: number;
  sigDecalY: number;
  qrActif: boolean;
  qrPosition: string;
  qrTaille: number;
  qrDecalX: number;
  qrDecalY: number;
  certActif: boolean;
  certSujet: string;
  certEmetteur: string;
  certSerie: string;
  certValideAu: string | null;
  certEmpreinte: string;
  certPosition: string;
  certDecalX: number;
  certDecalY: number;
  certTaille: number;
  // ---- (NOUVEAU v0.2.119) cachet « Signature électronique » du tampon ----
  // Alimenté EN DIRECT par le certificat du module de signature (le contenu
  // réel est connu du SERVEUR seul — l'aperçu interactif affiche un bloc
  // d'EXEMPLE de même géométrie quand le Switch est ON) ; l'aperçu fidèle
  // (bouton « Aperçu ») rend les vraies métadonnées côté serveur.
  elecActif: boolean;
  elecPosition: string;
  elecDecalX: number;
  elecDecalY: number;
  elecTaille: number;
  // (NOUVEAU v0.2.120) forme du cachet : RECTANGLE (encadré) | ROND
  elecForme: string;
  // (NOUVEAU v0.2.128) CONTENU du cachet — interrupteurs du formulaire de
  // choix (défaut = AUCUNE information du certificat affichée) + ligne
  // personnalisée. Optionnels : configs historiques sans ces champs = tout
  // masqué (comportement demandé).
  elecAffSignataire?: boolean;
  elecAffOrganisation?: boolean;
  elecAffEmetteur?: boolean;
  elecAffValidite?: boolean;
  elecAffEmpreinte?: boolean;
  elecTexteLibre?: string;
  elec?: {
    certSujet: string;
    certEmetteur?: string;
    certEmpreinte?: string;
    certValideAu?: Date | string | null;
  } | null;
  mentionActif: boolean;
  // ---- (NOUVEAU v0.2.143) ÉLÉMENT TAMPON IMAGE (documents de réponse) ----
  // 5e élément déplaçable — images de cachet/tampon dédiées aux documents
  // de réponse (optionnels : les panneaux Import/Réponses ne le fournissent
  // pas et le composant se comporte exactement comme avant).
  tamponActif?: boolean;
  tamponPosition?: string;
  tamponTaille?: number;
  tamponDecalX?: number;
  tamponDecalY?: number;
  // ---- (NOUVEAU v0.2.143) ancre BAS personnalisée + variante d'aperçu ----
  // basDecal : ancre des positions BAS_* en points PDF (défaut : réserve de
  // la mention 22 pt — comportement historique ; les documents de réponse
  // passent 42 pt = ZONE_SIGNE.bas, même ancre que le moteur unifié).
  basDecal?: number;
  // varianteApercu « document-demande » : dessine la bande d'en-tête verte
  // (64 pt) et la ligne de la zone de signature (210 pt) du document généré.
  varianteApercu?: "fiche" | "document-demande";
}

export type CleElementApercu = "sig" | "qr" | "cert" | "elec" | "tampon";
export type CleDecal =
  | "sigDecalX" | "sigDecalY"
  | "qrDecalX" | "qrDecalY"
  | "certDecalX" | "certDecalY"
  | "elecDecalX" | "elecDecalY"
  | "tamponDecalX" | "tamponDecalY";

/** Jumelle client de lignesCertificat() de stamp.ts — lignes du bloc
 * certificat (certActif ON + certificat importé seulement). */
export function lignesCertificatApercu(cfg: Pick<ConfigApercu, "certActif" | "certSujet" | "certEmpreinte" | "certEmetteur" | "certSerie" | "certValideAu">): string[] {
  if (!cfg.certActif || !cfg.certSujet.trim() || !cfg.certEmpreinte.trim()) return [];
  const serie = String(cfg.certSerie ?? "").trim().slice(0, 24);
  const jusquAu = cfg.certValideAu ? dateFr(cfg.certValideAu) : "";
  const empreinte = String(cfg.certEmpreinte ?? "").replace(/\s+/g, "").toUpperCase();
  return [
    `Signature électronique certifiée — Titulaire : ${cfg.certSujet.trim()}`,
    cfg.certEmetteur.trim()
      ? `Émetteur : ${cfg.certEmetteur.trim()}${jusquAu ? ` — Valide jusqu'au ${jusquAu}` : ""}`
      : jusquAu
        ? `Valide jusqu'au ${jusquAu}`
        : "",
    `Certificat SHA-256 : ${empreinte.slice(0, 48)}${empreinte.length > 48 ? "…" : ""}${serie ? ` — N° ${serie}` : ""}`,
  ].filter((l) => l.trim());
}

/** (NOUVEAU v0.2.100) Lignes affichées pour le bloc certificat : les lignes
 * RÉELLES dès qu'un certificat est importé et activé, sinon — si le certificat
 * est simplement ACTIVÉ sans fichier encore importé — un bloc d'EXEMPLE (même
 * géométrie qu'un bloc réel) pour préparer le placement. Rien si OFF. */
export function lignesCertificatOuExemple(
  cfg: Pick<ConfigApercu, "certActif" | "certSujet" | "certEmpreinte" | "certEmetteur" | "certSerie" | "certValideAu">
): string[] {
  const reel = lignesCertificatApercu(cfg);
  if (reel.length > 0 || !cfg.certActif) return reel;
  return [
    "Signature électronique certifiée — Titulaire : (certificat à importer)",
    "Émetteur : (autorité de certification) — Valide jusqu'au 31/12/20XX",
    "Certificat SHA-256 : (empreinte du certificat importé) — N° de série",
  ];
}

/** (NOUVEAU v0.2.100) Géométrie du bloc certificat en POINTS PDF — jumelle
 * exacte du calcul interne de l'aperçu (elle-même répliquée du moteur
 * stamp.ts) : boîte ACTUELLE (avec décalages) + boîte de BASE (décalages à
 * zéro). Sert aux champs « Position exacte X/Y (mm) » des deux panneaux —
 * X mesurée depuis le bord gauche, Y depuis le bord bas (origine PDF). */
export function geometrieCertificat(
  cfg: Pick<ConfigApercu, "certActif" | "certSujet" | "certEmpreinte" | "certEmetteur" | "certSerie" | "certValideAu" | "certPosition" | "certTaille" | "certDecalX" | "certDecalY">,
  mentionPresente: boolean
): { x: number; y: number; w: number; h: number; baseX: number; baseY: number } {
  const lignes = lignesCertificatOuExemple(cfg);
  const echelle = Math.max(0.5, Math.min(3, (cfg.certTaille || 100) / 100));
  const police = 6.5 * echelle;
  const w = lignes.length
    ? Math.max(...lignes.map((l) => l.length)) * police * 0.55 + 4
    : 0;
  const h = lignes.length * 9 * echelle;
  const yBasDefaut = mentionPresente ? HAUT_MENTION_APERCU : 10;
  const base = certVersBoiteApercu(cfg.certPosition, w, h, mentionPresente, yBasDefaut, 0, 0);
  const boite = certVersBoiteApercu(cfg.certPosition, w, h, mentionPresente, yBasDefaut, cfg.certDecalX, cfg.certDecalY);
  return { x: boite.x, y: boite.y, w, h, baseX: base.x, baseY: base.y };
}

/** (NOUVEAU v0.2.119) Jumelle client de lignesSignatureElec() de stamp.ts —
 * lignes du cachet « Signature électronique » (elecActif ON + métadonnées
 * du certificat du module fournies seulement). (v0.2.128) mêmes
 * INTERSUMSEURS que le serveur : chaque information n'apparaît que si son
 * interrupteur est ON ; par défaut, mention seule. */
export function lignesSignatureElecApercu(
  cfg: Pick<ConfigApercu, "elecActif" | "elec" | "elecAffSignataire" | "elecAffOrganisation" | "elecAffEmetteur" | "elecAffValidite" | "elecAffEmpreinte" | "elecTexteLibre">
): string[] {
  if (!cfg.elecActif || !cfg.elec) return [];
  const sujet = String(cfg.elec.certSujet ?? "").trim();
  if (!sujet) return [];
  const cn = /(?:^|,\s*)CN=([^,]+)/i.exec(sujet)?.[1]?.trim() || sujet;
  const o = /(?:^|,\s*)O=([^,]+)/i.exec(sujet)?.[1]?.trim() || "";
  const emetteur = String(cfg.elec.certEmetteur ?? "").trim();
  const empreinte = String(cfg.elec.certEmpreinte ?? "").replace(/\s+/g, "").toUpperCase();
  const jusquAu = cfg.elec.certValideAu ? dateFr(String(cfg.elec.certValideAu)) : "";
  const libre = String(cfg.elecTexteLibre ?? "").trim();
  return [
    "SIGNATURE ÉLECTRONIQUE",
    Boolean(cfg.elecAffSignataire) ? `Signataire : ${cn}` : "",
    Boolean(cfg.elecAffOrganisation) ? o : "",
    Boolean(cfg.elecAffEmetteur) && emetteur ? `Émetteur : ${emetteur}` : "",
    Boolean(cfg.elecAffValidite) && jusquAu ? `Valide jusqu'au ${jusquAu}` : "",
    Boolean(cfg.elecAffEmpreinte) && empreinte
      ? `Certificat SHA-256 : ${empreinte.slice(0, 24)}${empreinte.length > 24 ? "…" : ""}`
      : "",
    libre,
  ].filter((l) => l.trim());
}

/** (NOUVEAU v0.2.119) Lignes affichées pour le cachet : lignes RÉELLES dès
 * que les métadonnées du certificat du module sont connues du client (elles
 * ne le sont PAS — le contenu est lu EN DIRECT côté serveur), sinon un bloc
 * d'EXEMPLE de même géométrie — (v0.2.128) reflétant les interrupteurs du
 * formulaire de choix. Rien si OFF. */
export function lignesSignatureElecOuExemple(
  cfg: Pick<ConfigApercu, "elecActif" | "elec" | "elecAffSignataire" | "elecAffOrganisation" | "elecAffEmetteur" | "elecAffValidite" | "elecAffEmpreinte" | "elecTexteLibre">
): string[] {
  const reel = lignesSignatureElecApercu(cfg);
  if (reel.length > 0 || !cfg.elecActif) return reel;
  const libre = String(cfg.elecTexteLibre ?? "").trim();
  return [
    "SIGNATURE ÉLECTRONIQUE",
    Boolean(cfg.elecAffSignataire) ? "Signataire : (certificat du module de signature)" : "",
    Boolean(cfg.elecAffOrganisation) ? "(organisation du certificat)" : "",
    Boolean(cfg.elecAffEmetteur) ? "Émetteur : (autorité de certification)" : "",
    Boolean(cfg.elecAffValidite) ? "Valide jusqu'au 31/12/20XX" : "",
    Boolean(cfg.elecAffEmpreinte) ? "Certificat SHA-256 : (empreinte du certificat chargé)" : "",
    libre,
  ].filter((l) => l.trim());
}

/** (NOUVEAU v0.2.120) Contenu du cachet ROND pour l'aperçu interactif —
 * métadonnées RÉELLES si connues du client, sinon EXEMPLE de même géométrie
 * (jumelle de contenuCachetRond de stamp.ts, côté client). (v0.2.128)
 * mêmes interrupteurs que le serveur : zones masquées = vides. */
export function contenuCachetRondApercu(
  cfg: Pick<ConfigApercu, "elecActif" | "elec" | "elecAffSignataire" | "elecAffOrganisation" | "elecAffEmetteur" | "elecAffValidite" | "elecAffEmpreinte" | "elecTexteLibre">
): { arcHaut: string; arcBas: string; nom: string; ligne2: string; exemple: boolean } {
  const reel = lignesSignatureElecApercu(cfg);
  const libre = String(cfg.elecTexteLibre ?? "").trim();
  if (reel.length > 0) {
    const sujet = String(cfg.elec?.certSujet ?? "").trim();
    const cn = /(?:^|,\s*)CN=([^,]+)/i.exec(sujet)?.[1]?.trim() || sujet;
    const o = /(?:^|,\s*)O=([^,]+)/i.exec(sujet)?.[1]?.trim() || "";
    const affSignataire = Boolean(cfg.elecAffSignataire);
    const affOrganisation = Boolean(cfg.elecAffOrganisation);
    // (v0.2.128) zones selon le formulaire de choix ; ligne2 = première
    // petite ligne que le serveur dessinera (personnalisée puis validité).
    const arcHaut = ((affOrganisation && o) || (affSignataire && cn) || "").toUpperCase().slice(0, 34);
    const ligne2 = affSignataire && cn && libre ? libre : reel.find((l) => l.startsWith("Valide jusqu")) ?? "";
    return {
      arcHaut,
      arcBas: "SIGNATURE ÉLECTRONIQUE",
      nom: affSignataire && cn ? cn : libre,
      ligne2: affSignataire && cn ? ligne2 : reel.find((l) => l.startsWith("Valide jusqu")) ?? "",
      exemple: false,
    };
  }
  // (v0.2.128) bloc d'EXEMPLE reflétant les interrupteurs choisis.
  const affSignataire = Boolean(cfg.elecAffSignataire);
  const affOrganisation = Boolean(cfg.elecAffOrganisation);
  return {
    arcHaut: affOrganisation ? "MA SOCIETE SARL" : affSignataire ? "JEAN DUPONT" : "",
    arcBas: "SIGNATURE ÉLECTRONIQUE",
    nom: affSignataire ? "Jean Dupont" : libre || "",
    ligne2: Boolean(cfg.elecAffValidite) ? "Valide jusqu'au 31/12/20XX" : "",
    exemple: true,
  };
}

const STYLE_SELECTION: Record<CleElementApercu, string> = {
  sig: "outline-emerald-500",
  qr: "outline-sky-500",
  cert: "outline-amber-500",
  elec: "outline-violet-500",
  tampon: "outline-rose-500",
};
const LIBELLE_ELEMENT: Record<CleElementApercu, string> = {
  sig: "Signature",
  qr: "QR code",
  cert: "Certificat",
  elec: "Signature élec.",
  tampon: "Tampon",
};

export function ApercuPositionnement({
  cfg,
  imageSig,
  imageQr,
  imageTampon,
  maj,
  majTailleCert,
  note,
  libelleFiche,
}: {
  cfg: ConfigApercu;
  imageSig: string;
  imageQr: string;
  /** (NOUVEAU v0.2.143) image du TAMPON (documents de réponse) — présente,
   * l'élément rose devient manipulable ; tamponActif seul = bloc fantôme. */
  imageTampon?: string;
  maj: (cle: CleDecal, valeur: number) => void;
  /** (NOUVEAU v0.2.100) si fournie : affiche la POIGNÉE DE REDIMENSIONNEMENT
   * du bloc certificat — glisser la poignée appelle majTailleCert(50…300). */
  majTailleCert?: (valeur: number) => void;
  /** Légende sous l'aperçu (propre à chaque section). */
  note: string;
  /** Titre du badge « A4 » (ex. « A4 — fiches de paie » / « A4 — réponses »). */
  libelleFiche?: string;
}) {
  const cadreRef = useRef<HTMLDivElement>(null);
  const cleGlisse = useRef<CleElementApercu | null>(null);
  // ratio hauteur/largeur de l'image de signature (défaut 0,4 tant qu'inconnu)
  const [ratio, setRatio] = useState(0.4);
  // (v0.2.93) élément SÉLECTIONNÉ : contour coloré persistant + coordonnées
  // affichées en direct (retour visuel de la synchronisation des curseurs).
  const [selection, setSelection] = useState<CleElementApercu | null>(null);
  const [coordonnees, setCoordonnees] = useState<{ cle: CleElementApercu; x: number; y: number } | null>(null);
  // (v0.2.100) mode REDIMENSIONNEMENT du bloc certificat (poignée ambrée) :
  // vrai tant que la poignée est tenue — le glisser règle certTaille.
  const redimCert = useRef(false);

  // ---- Géométrie des 3 éléments (mêmes calculs que le moteur) ----
  const sigActifAffiche = cfg.sigActif;
  const sigW = Math.max(TAILLE_MIN, Math.min(TAILLE_MAX, cfg.sigTaille || 120));
  const sigLignes = cfg.sigTexte.trim() ? Math.max(1, Math.ceil(cfg.sigTexte.trim().length / 42)) : 0;
  const sigH = sigW * ratio + (sigLignes ? sigLignes * 10 + 3 : 0);
  const sigBase = coinVersBoiteApercu(cfg.sigPosition, sigW, sigH, cfg.mentionActif, 0, 0, cfg.basDecal);
  const sigBoite = coinVersBoiteApercu(cfg.sigPosition, sigW, sigH, cfg.mentionActif, cfg.sigDecalX, cfg.sigDecalY, cfg.basDecal);

  const qrAffiche = cfg.qrActif && Boolean(imageQr);
  const qrW = Math.max(TAILLE_MIN, Math.min(TAILLE_MAX, cfg.qrTaille || 110));
  const qrBase = coinVersBoiteApercu(cfg.qrPosition, qrW, qrW, cfg.mentionActif, 0, 0, cfg.basDecal);
  const qrBoite = coinVersBoiteApercu(cfg.qrPosition, qrW, qrW, cfg.mentionActif, cfg.qrDecalX, cfg.qrDecalY, cfg.basDecal);

  // (NOUVEAU v0.2.143) TAMPON IMAGE (documents de réponse) — même mécanique
  // que la signature : image + taille (40 → 1200 pt) + décalages bornés.
  // Affiché si tamponActif est fourni (bloc fantôme positionnable) ou si
  // l'image est présente ; SINON (panneaux historiques) jamais affiché.
  const [ratioTampon, setRatioTampon] = useState(0.6);
  const tamponActifAffiche = cfg.tamponActif != null ? cfg.tamponActif : Boolean(imageTampon);
  const tamponW = Math.max(TAILLE_MIN, Math.min(TAILLE_MAX, cfg.tamponTaille || 140));
  const tamponH = tamponW * (ratioTampon || 0.6);
  const tamponBase = coinVersBoiteApercu(cfg.tamponPosition || "BAS_GAUCHE", tamponW, tamponH, cfg.mentionActif, 0, 0, cfg.basDecal);
  const tamponBoite = coinVersBoiteApercu(cfg.tamponPosition || "BAS_GAUCHE", tamponW, tamponH, cfg.mentionActif, cfg.tamponDecalX || 0, cfg.tamponDecalY || 0, cfg.basDecal);

  // (v0.2.100) bloc certificat : lignes RÉELLES ou bloc d'EXEMPLE (certificat
  // activé mais pas encore importé) — le placement est préparatoire dans ce
  // second cas, le rendu réel suivra à l'import du fichier.
  const certLignes = lignesCertificatOuExemple(cfg);
  const certExemple = cfg.certActif && lignesCertificatApercu(cfg).length === 0;
  const echelleCert = Math.max(0.5, Math.min(3, (cfg.certTaille || 100) / 100));
  const policeCert = 6.5 * echelleCert;
  const certW = certLignes.length
    ? Math.max(...certLignes.map((l) => l.length)) * policeCert * 0.55 + 4
    : 0;
  const certH = certLignes.length * 9 * echelleCert;
  const certBase = certVersBoiteApercu(
    cfg.certPosition, certW, certH, cfg.mentionActif,
    cfg.mentionActif ? HAUT_MENTION_APERCU : 10, 0, 0
  );
  const certBoite = certVersBoiteApercu(
    cfg.certPosition, certW, certH, cfg.mentionActif,
    cfg.mentionActif ? HAUT_MENTION_APERCU : 10, cfg.certDecalX, cfg.certDecalY
  );

  // (NOUVEAU v0.2.119) cachet « Signature électronique » : lignes RÉELLES
  // (métadonnées du module connues du client — cas théorique) ou bloc
  // d'EXEMPLE de même géométrie (Switch ON) ; encadré violet pointillé.
  // (v0.2.120) FORME ROND : boîte carrée = diamètre 120 pt × échelle —
  // même géométrie que le moteur (diametreCachetRond).
  // (v0.2.121) FORME RECTANGLE refondue « comme le ROND » : mêmes zones
  // (organisation / titulaire / validité / mention), double cadre bleu —
  // largeur/hauteur = empilement CACHET_RECT (jumelle stamp.ts, mesures
  // approximées en nombre de caractères).
  const elecRond = (cfg.elecForme || "RECTANGLE") === "ROND";
  const elecLignes = lignesSignatureElecOuExemple(cfg);
  const elecExemple = cfg.elecActif && lignesSignatureElecApercu(cfg).length === 0;
  const echelleElec = Math.max(0.5, Math.min(3, (cfg.elecTaille || 100) / 100));
  const policeTitreElec = 7.5 * echelleElec;
  const policeLigneElec = 6.5 * echelleElec;
  const elecRondD = 120 * echelleElec;
  // (v0.2.121) contenu commun ROND/RECTANGLE pour l'aperçu (organisation,
  // titulaire, validité — réels si connus, sinon exemple).
  const cachetContenu = contenuCachetRondApercu(cfg);
  // Constantes d'empilement — jumelles de CACHET_RECT (stamp.ts).
  const CR = {
    padH: 6.5, padX: 9, cadre: 3.5, corpsOrg: 8, g1: 4, trait: 0.7, g2: 5,
    corpsNom: 10.5, pasNom: 12.6, sep: 6.5, pasPetite: 7.4, pasPetite2: 7.0,
    g3: 2.5, corpsMention: 6.8, pasMention: 8.5, wMin: 130, wMax: 240,
  } as const;
  const policeOrgRect = CR.corpsOrg * echelleElec;
  const policeNomRect = CR.corpsNom * echelleElec;
  const policeValRect = 0.52 * CR.corpsNom * echelleElec;
  const policeMentionRect = CR.corpsMention * echelleElec;
  const ligneValRect = cachetContenu.ligne2;
  const wOrgRect = cachetContenu.arcHaut.length * policeOrgRect * 0.66;
  const wNomRect = cachetContenu.nom.length * policeNomRect * 0.58;
  const wValRect = ligneValRect.length * policeValRect * 0.52;
  const wMentionRect = cachetContenu.arcBas.length * policeMentionRect * 0.58;
  const elecW = elecRond
    ? elecRondD
    : elecLignes.length
      ? Math.max(
          CR.wMin * echelleElec,
          Math.min(
            CR.wMax * echelleElec,
            Math.max(wOrgRect, wNomRect, wValRect, wMentionRect) +
              2 * (CR.padX + CR.cadre) * echelleElec
          )
        )
      : 0;
  // (v0.2.128) zones conditionnelles — jumelle de geometrieCachetRectangle :
  // en-tête/titulaire/petites lignes masqués ne consomment AUCUNE hauteur.
  const elecHasOrg = Boolean(cachetContenu.arcHaut);
  const elecHasNom = Boolean(cachetContenu.nom);
  const elecH = elecRond ? elecRondD : elecLignes.length
    ? (CR.padH +
       (elecHasOrg ? CR.corpsOrg + CR.g1 + CR.trait + CR.g2 : 0) +
       (elecHasNom ? CR.pasNom + CR.sep : 0) +
       (ligneValRect ? CR.pasPetite : 0) +
       (ligneValRect ? CR.g3 : 0) +
       CR.pasMention + CR.padH) * echelleElec
    : 0;
  const elecBase = certVersBoiteApercu(
    cfg.elecPosition, elecW, elecH, cfg.mentionActif,
    cfg.mentionActif ? HAUT_MENTION_APERCU : 10, 0, 0
  );
  const elecBoite = certVersBoiteApercu(
    cfg.elecPosition, elecW, elecH, cfg.mentionActif,
    cfg.mentionActif ? HAUT_MENTION_APERCU : 10, cfg.elecDecalX, cfg.elecDecalY
  );

  const majDepuisPointeur = (e: React.PointerEvent, cle: CleElementApercu) => {
    const cadre = cadreRef.current;
    if (!cadre) return;
    const r = cadre.getBoundingClientRect();
    if (!r.width) return;
    const echelle = PAGE_W / r.width; // pixels affichés → points PDF
    const px = (e.clientX - r.left) * echelle;
    const py = (r.bottom - e.clientY) * echelle; // origine PDF = bas-gauche
    const dims =
      cle === "sig"
        ? { w: sigW, h: sigH, base: sigBase, pre: "sig" as const }
        : cle === "qr"
          ? { w: qrW, h: qrW, base: qrBase, pre: "qr" as const }
          : cle === "cert"
            ? { w: certW, h: certH, base: certBase, pre: "cert" as const }
            : cle === "tampon"
              ? { w: tamponW, h: tamponH, base: tamponBase, pre: "tampon" as const }
              : { w: elecW, h: elecH, base: elecBase, pre: "elec" as const };
    // l'ÉLÉMENT suit le pointeur (son centre sous le curseur), borné comme le
    // moteur — SEULS les décalages de CET élément sont modifiés.
    const basMin = cfg.basDecal != null ? cfg.basDecal : HAUT_MENTION_APERCU;
    const cibleX = Math.min(PAGE_W - MARGE_APERCU - dims.w, Math.max(MARGE_APERCU, px - dims.w / 2));
    const cibleY = Math.min(PAGE_H - MARGE_APERCU - dims.h, Math.max(basMin, py - dims.h / 2));
    const nx = Math.round(Math.min(DECAL_MAX, Math.max(DECAL_MIN, cibleX - dims.base.x)));
    const ny = Math.round(Math.min(DECAL_MAX, Math.max(DECAL_MIN, cibleY - dims.base.y)));
    maj((dims.pre + "DecalX") as CleDecal, nx);
    maj((dims.pre + "DecalY") as CleDecal, ny);
    setCoordonnees({ cle, x: Math.round(dims.base.x + nx), y: Math.round(dims.base.y + ny) });
  };

  // (v0.2.100) REDIMENSIONNEMENT du bloc certificat : la poignée (coin bas-
  // droit) convertit la position du pointeur en largeur cible du bloc, puis
  // en échelle % (certTaille 50 → 300) — SEULE la taille de CET élément
  // change (jamais la signature ni le QR).
  const redimDepuisPointeur = (e: React.PointerEvent) => {
    const cadre = cadreRef.current;
    if (!cadre || !majTailleCert) return;
    const r = cadre.getBoundingClientRect();
    if (!r.width) return;
    const echelle = PAGE_W / r.width; // pixels affichés → points PDF
    const px = (e.clientX - r.left) * echelle;
    const largeurBase = certLignes.length
      ? Math.max(...certLignes.map((l) => l.length)) * 6.5 * 0.55 + 4
      : 1;
    const cibleW = Math.min(PAGE_W - 2 * MARGE_APERCU, Math.max(40, px - certBoite.x));
    const echelleCible = cibleW / largeurBase;
    majTailleCert(Math.round(Math.min(CERT_TAILLE_MAX, Math.max(CERT_TAILLE_MIN, echelleCible * 100))));
  };

  const poignee = (cle: CleElementApercu) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      cleGlisse.current = cle;
      setSelection(cle);
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      majDepuisPointeur(e, cle);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (cleGlisse.current === cle) majDepuisPointeur(e, cle);
    },
    onPointerUp: () => { cleGlisse.current = null; },
    onPointerCancel: () => { cleGlisse.current = null; },
  });

  const largeurAffichee = 320;
  const s = largeurAffichee / PAGE_W;

  const selectionBoite =
    selection === "sig" ? sigBoite : selection === "qr" ? qrBoite : selection === "cert" ? certBoite : selection === "elec" ? elecBoite : selection === "tampon" ? tamponBoite : null;

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        Positionnement libre — cliquez ou glissez la signature, le tampon, le QR, le certificat ou le cachet « Signature électronique » n&apos;importe où sur la feuille (chaque élément bouge indépendamment) ; poignée ambrée = redimensionner le certificat
      </Label>
      <div
        ref={cadreRef}
        className="relative mx-auto touch-none select-none overflow-hidden rounded-md border-2 border-dashed border-emerald-300 bg-white"
        style={{ width: largeurAffichee, height: largeurAffichee * (PAGE_H / PAGE_W) }}
      >
        {/* Feuille fantôme : barres décoratives évoquant un document */}
        <div className="pointer-events-none absolute inset-4 space-y-2 opacity-25">
          <div className="h-3 w-2/5 rounded bg-neutral-300" />
          <div className="h-1.5 w-11/12 rounded bg-neutral-200" />
          <div className="h-1.5 w-4/5 rounded bg-neutral-200" />
          <div className="h-1.5 w-11/12 rounded bg-neutral-200" />
          <div className="h-1.5 w-2/3 rounded bg-neutral-200" />
          <div className="mt-6 h-1.5 w-11/12 rounded bg-neutral-200" />
          <div className="h-1.5 w-3/4 rounded bg-neutral-200" />
          <div className="mt-6 h-1.5 w-11/12 rounded bg-neutral-200" />
          <div className="h-1.5 w-5/6 rounded bg-neutral-200" />
          <div className="mt-10 h-16 w-11/12 rounded bg-neutral-100" />
        </div>
        {/* (NOUVEAU v0.2.143) variante « document-demande » : bande d'en-tête
            verte (64 pt) + ligne de la zone de signature (210 pt) — l'aperçu
            montre le VRAI gabarit du document de réponse généré. */}
        {cfg.varianteApercu === "document-demande" && (
          <>
            <div className="pointer-events-none absolute left-0 right-0 top-0 bg-emerald-600/80" style={{ height: 64 * s }} />
            <div className="pointer-events-none absolute left-4 right-4 text-center text-[7px] text-emerald-800/70" style={{ bottom: 214 * s, borderTop: "1px solid rgba(5,150,105,.45)" }} />
          </>
        )}
        {/* Contour de SÉLECTION (positionne comme l'élément sélectionné) */}
        {selection && selectionBoite && (
          <div
            className={`pointer-events-none absolute outline outline-2 ${STYLE_SELECTION[selection]}`}
            style={{
              left: selectionBoite.x * s - 1,
              bottom: selectionBoite.y * s - 1,
              width: Math.max(14, (selection === "sig" ? sigW : selection === "qr" ? qrW : selection === "elec" ? elecW : selection === "tampon" ? tamponW : certW) * s) + 2,
              height: Math.max(14, (selection === "sig" ? sigH : selection === "qr" ? qrW : selection === "elec" ? elecH : selection === "tampon" ? tamponH : certH) * s) + 2,
            }}
          />
        )}
        {/* Éléments positionnés EXACTEMENT comme au rendu PDF */}
        {sigActifAffiche && (
          <div
            className="absolute cursor-move rounded-sm hover:outline hover:outline-1 hover:outline-emerald-400"
            style={{
              left: sigBoite.x * s,
              bottom: sigBoite.y * s,
              width: Math.max(14, sigW * s),
              opacity: Math.max(0.3, Math.min(1, cfg.sigOpacite || 0.9)),
            }}
            {...poignee("sig")}
          >
            {imageSig ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageSig}
                alt=""
                className="w-full"
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth) setRatio(img.naturalHeight / img.naturalWidth);
                }}
              />
            ) : (
              <div className="rounded border border-dashed border-emerald-400 bg-emerald-50 text-center text-[8px] leading-tight text-emerald-700">
                signature
              </div>
            )}
            {sigLignes > 0 && (
              <div className="mt-0.5 truncate text-center text-[7px] leading-[10px] text-neutral-700">
                {cfg.sigTexte}
              </div>
            )}
          </div>
        )}
        {qrAffiche && (
          <div
            className="absolute cursor-move rounded-sm hover:outline hover:outline-1 hover:outline-sky-400"
            style={{
              left: qrBoite.x * s,
              bottom: qrBoite.y * s,
              width: Math.max(14, qrW * s),
              height: Math.max(14, qrW * s),
            }}
            {...poignee("qr")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageQr} alt="" className="h-full w-full" draggable={false} />
          </div>
        )}
        {/* (NOUVEAU v0.2.143) TAMPON IMAGE (documents de réponse) — image
            rose déplaçable, ou bloc fantôme en pointillés tant qu'aucune
            image n'est choisie (le placement peut être préparé). */}
        {tamponActifAffiche && (
          <div
            className="absolute cursor-move rounded-sm hover:outline hover:outline-1 hover:outline-rose-400"
            style={{
              left: tamponBoite.x * s,
              bottom: tamponBoite.y * s,
              width: Math.max(14, tamponW * s),
              height: Math.max(14, tamponH * s),
            }}
            {...poignee("tampon")}
          >
            {imageTampon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageTampon}
                alt=""
                className="h-full w-full object-contain"
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth) setRatioTampon(img.naturalHeight / img.naturalWidth);
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded border border-dashed border-rose-400 bg-rose-50 text-center text-[8px] leading-tight text-rose-700">
                tampon
              </div>
            )}
          </div>
        )}
        {certLignes.length > 0 && (
          <div
            className={`absolute cursor-move rounded-sm px-0.5 hover:outline hover:outline-1 hover:outline-amber-500 ${
              certExemple
                ? "border border-dashed border-amber-400 bg-amber-50/80"
                : "bg-white/85"
            }`}
            style={{
              left: certBoite.x * s,
              bottom: certBoite.y * s,
              width: Math.max(14, certW * s),
              minHeight: 12,
            }}
            title={certExemple ? "Bloc certificat (exemple — aucun certificat importé)" : "Bloc certificat"}
            {...poignee("cert")}
          >
            {certLignes.map((l, i) => (
              <div
                key={i}
                className={`whitespace-nowrap text-center leading-[1.4] ${certExemple ? "text-amber-700" : "text-neutral-600"}`}
                style={{ fontSize: Math.max(4, policeCert * s) }}
              >
                {l}
              </div>
            ))}
            {/* (v0.2.100) POIGNÉE DE REDIMENSIONNEMENT du certificat */}
            {majTailleCert && (
              <span
                className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-amber-600 bg-amber-400"
                title="Glissez pour redimensionner le bloc certificat"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  redimCert.current = true;
                  setSelection("cert");
                  try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
                }}
                onPointerMove={(e) => {
                  if (redimCert.current) redimDepuisPointeur(e);
                }}
                onPointerUp={() => { redimCert.current = false; }}
                onPointerCancel={() => { redimCert.current = false; }}
              />
            )}
          </div>
        )}
        {/* (REFONTE v0.2.121) cachet RECTANGULAIRE « comme le ROND » —
            double cadre bleu + mêmes zones que le cachet rond (organisation
            / titulaire / validité / mention) ; violet pointillé en mode
            exemple (métadonnées réelles connues du serveur seul). */}
        {elecLignes.length > 0 && !elecRond && (() => {
          const encre = elecExemple ? "#8b5cf6" : "#2a57a6";
          const px = (v: number) => Math.max(0.5, v * s);
          return (
            <div
              className="absolute cursor-move hover:outline hover:outline-1 hover:outline-violet-500"
              style={{
                left: elecBoite.x * s,
                bottom: elecBoite.y * s,
                width: Math.max(14, elecW * s),
                height: Math.max(14, elecH * s),
              }}
              title={elecExemple ? "Cachet « Signature électronique » (exemple — alimenté par le certificat du module de signature)" : "Cachet « Signature électronique »"}
              {...poignee("elec")}
            >
              {/* cadre EXTÉRIEUR épais */}
              <div
                className="h-full w-full"
                style={{
                  border: `${px(2.2 * echelleElec)}px solid ${encre}`,
                  borderStyle: elecExemple ? "dashed" : "solid",
                  opacity: 0.92,
                  boxSizing: "border-box",
                }}
              >
                {/* cadre INTÉRIEUR fin */}
                <div
                  className="flex h-full w-full flex-col items-center justify-center text-center"
                  style={{
                    margin: px(3.5 * echelleElec),
                    width: `calc(100% - ${px(2 * 3.5 * echelleElec)}px)`,
                    height: `calc(100% - ${px(2 * 3.5 * echelleElec)}px)`,
                    border: `${px(0.8 * echelleElec)}px solid ${encre}`,
                    borderStyle: elecExemple ? "dashed" : "solid",
                    opacity: 0.92,
                    gap: px(1.2 * echelleElec),
                    boxSizing: "border-box",
                  }}
                >
                  {/* (v0.2.128) en-tête + séparatrice seulement si affichés */}
                  {cachetContenu.arcHaut && (
                    <span
                      className="whitespace-nowrap overflow-hidden max-w-full font-bold"
                      style={{ fontSize: px(policeOrgRect), color: encre, lineHeight: 1.05 }}
                    >
                      {cachetContenu.arcHaut}
                    </span>
                  )}
                  {/* ligne séparatrice sous l'en-tête */}
                  {cachetContenu.arcHaut && (
                    <span
                      style={{
                        width: "60%",
                        height: 0,
                        borderTop: `${px(0.7 * echelleElec)}px solid ${encre}`,
                        opacity: 0.9,
                      }}
                    />
                  )}
                  {cachetContenu.nom && (
                    <span
                      className="whitespace-nowrap overflow-hidden max-w-full font-bold"
                      style={{ fontSize: px(policeNomRect), color: encre, lineHeight: 1.1 }}
                    >
                      {cachetContenu.nom}
                    </span>
                  )}
                  {/* séparateur décoratif — • — (seulement sous un titulaire) */}
                  {cachetContenu.nom && (
                    <span
                      className="flex items-center justify-center"
                      style={{ color: encre, opacity: 0.9, gap: px(1.5 * echelleElec) }}
                    >
                      <span style={{ width: px(5 * echelleElec), borderTop: `${px(0.7 * echelleElec)}px solid ${encre}` }} />
                      <span style={{ fontSize: px(2.4 * echelleElec), lineHeight: 1 }}>•</span>
                      <span style={{ width: px(5 * echelleElec), borderTop: `${px(0.7 * echelleElec)}px solid ${encre}` }} />
                    </span>
                  )}
                  {cachetContenu.ligne2 && (
                    <span
                      className="whitespace-nowrap overflow-hidden max-w-full"
                      style={{ fontSize: px(policeValRect), color: encre, lineHeight: 1.15 }}
                    >
                      {cachetContenu.ligne2}
                    </span>
                  )}
                  <span
                    className="whitespace-nowrap overflow-hidden max-w-full"
                    style={{ fontSize: px(policeMentionRect), color: encre, lineHeight: 1.2, letterSpacing: px(0.3 * echelleElec) }}
                  >
                    {cachetContenu.arcBas}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}
        {/* (NOUVEAU v0.2.120) cachet ROND — SVG circulaire fidèle au moteur
            (deux cercles + arcs + titulaire au centre) ; violet pointillé en
            mode exemple. */}
        {elecRond && elecLignes.length > 0 && (() => {
          const rond = contenuCachetRondApercu(cfg);
          const D = 120; // viewBox carré = diamètre pt
          const encre = rond.exemple ? "#8b5cf6" : "#2a57a6";
          const rt = D / 2 - D * 0.115;
          const tArc = D * 0.072;
          return (
            <svg
              viewBox={`0 0 ${D} ${D}`}
              className="absolute cursor-move"
              style={{
                left: elecBoite.x * s,
                bottom: elecBoite.y * s,
                width: Math.max(14, elecW * s),
                height: Math.max(14, elecH * s),
              }}
              {...poignee("elec")}
            >
              <circle cx={D / 2} cy={D / 2} r={D / 2 - 1.1} fill="none" stroke={encre} strokeWidth={2.2} strokeOpacity={0.92} strokeDasharray={rond.exemple ? "4 3" : undefined} />
              <circle cx={D / 2} cy={D / 2} r={D / 2 - D * 0.075} fill="none" stroke={encre} strokeWidth={0.8} strokeOpacity={0.75} strokeDasharray={rond.exemple ? "4 3" : undefined} />
              <defs>
                <path id="apercu-arc-haut" d={`M ${D / 2 - (rt - tArc * 0.35)},${D / 2} A ${rt - tArc * 0.35},${rt - tArc * 0.35} 0 0,1 ${D / 2 + (rt - tArc * 0.35)},${D / 2}`} fill="none" />
                <path id="apercu-arc-bas" d={`M ${D / 2 - (rt + tArc * 0.28)},${D / 2} A ${rt + tArc * 0.28},${rt + tArc * 0.28} 0 0,0 ${D / 2 + (rt + tArc * 0.28)},${D / 2}`} fill="none" />
              </defs>
              {rond.arcHaut && (
                <text fontSize={tArc} fontWeight="bold" fill={encre} letterSpacing={tArc * 0.06}>
                  <textPath href="#apercu-arc-haut" startOffset="50%" textAnchor="middle">{rond.arcHaut}</textPath>
                </text>
              )}
              <text fontSize={tArc * 0.9} fill={encre} letterSpacing={tArc * 0.05}>
                <textPath href="#apercu-arc-bas" startOffset="50%" textAnchor="middle">{rond.arcBas}</textPath>
              </text>
              <circle cx={D / 2 - rt} cy={D / 2} r={D * 0.016} fill={encre} />
              <circle cx={D / 2 + rt} cy={D / 2} r={D * 0.016} fill={encre} />
              {rond.nom && (
                <text x={D / 2} y={D / 2 + 2} textAnchor="middle" fontSize={10.5} fontWeight="bold" fill={encre}>{rond.nom}</text>
              )}
              {rond.nom && (
                <>
                  <line x1={D / 2 - 14} y1={D / 2 + 8.5} x2={D / 2 - 5.5} y2={D / 2 + 8.5} stroke={encre} strokeWidth={0.7} />
                  <line x1={D / 2 + 5.5} y1={D / 2 + 8.5} x2={D / 2 + 14} y2={D / 2 + 8.5} stroke={encre} strokeWidth={0.7} />
                  <circle cx={D / 2} cy={D / 2 + 8.5} r={1.4} fill={encre} />
                </>
              )}
              {rond.ligne2 && (
                <text x={D / 2} y={D / 2 + 18} textAnchor="middle" fontSize={5.5} fill={encre}>{rond.ligne2}</text>
              )}
            </svg>
          );
        })()}
        <span className="pointer-events-none absolute right-1.5 top-1.5 rounded bg-neutral-100/90 px-1.5 py-0.5 text-[9px] text-neutral-500">
          {libelleFiche || "A4"} — glissez chaque élément séparément
        </span>
        {/* Coordonnées en direct de l'élément sélectionné (synchronisation
            visible avec les curseurs de décalage du panneau) */}
        {selection && coordonnees && coordonnees.cle === selection && (
          <span
            className={`pointer-events-none absolute left-1.5 top-1.5 rounded bg-neutral-100/95 px-1.5 py-0.5 text-[9px] font-medium ${
              selection === "sig" ? "text-emerald-700" : selection === "qr" ? "text-sky-700" : selection === "elec" ? "text-violet-700" : selection === "tampon" ? "text-rose-700" : "text-amber-700"
            }`}
          >
            {LIBELLE_ELEMENT[selection]} : X {coordonnees.x > 0 ? "+" : ""}{coordonnees.x} pt ({Math.round(coordonnees.x / PT_PAR_MM)} mm) · Y {coordonnees.y > 0 ? "+" : ""}{coordonnees.y} pt ({Math.round(coordonnees.y / PT_PAR_MM)} mm)
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
