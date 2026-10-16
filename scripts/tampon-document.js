/**
 * ============================================================================
 *  NOUVEAU (v0.2.143) — MOTEUR DE TAMPON UNIFIÉ DES DOCUMENTS DE RÉPONSE
 *  (demandes de congé / autorisation — document d'acceptation et de refus)
 * ============================================================================
 *  Demande utilisateur : « La signature électronique, le tampon et le QR Code
 *  des documents de réponse doivent utiliser la même logique, les mêmes
 *  paramètres et le même système de déplacement interactif que ceux
 *  configurés dans la section Import de fichiers, afin de garantir une
 *  présentation identique et cohérente. »
 *
 *  Ce module est le JUMEAU JavaScript (portail 4001 + administration 4000
 *  via scripts/document-acceptation.js) du moteur de tampon des fiches de
 *  paie src/lib/stamp.ts. TOUTE la géométrie est répliquée EXACTEMENT :
 *   - coinVersBoite / certVersBoite : coin de départ + décalages fins
 *     (±1500 pt) bornés au périmètre de la page (MARGE 24 / bas réserve 42
 *     — la ZONE DE SIGNATURE du document de réponse) ;
 *   - boiteTournee / pointTourne : rotation horaire 0 → 360° autour du
 *     centre de l'élément (mêmes formules) ;
 *   - QR : les 5 modes des fiches (DONNEES | URL | FICHE | TEXTE | IMAGE),
 *     génération qrcode identique (margin 0, width 640, ECC « M ») ;
 *   - jetonReponse : JUMELLE EXACTE de stamp.ts (HMAC-SHA256 scrypt
 *     « autorh-signature-v1 » — les pages publiques /verification/reponse
 *     valident le jeton avec le moteur TS) ;
 *   - cachet « Signature électronique » : mêmes formes (ROND avec arcs +
 *     RECTANGLE à double cadre), même contenu déterministe
 *     (contenuCachetRond), même encre bleue #2a57a6, alimenté EN DIRECT par
 *     le certificat du module de signature (jamais stocké).
 *
 *  NE JAMAIS modifier seul : chaque fonction a sa jumelle TS dans stamp.ts
 *  (et client dans apercu-positionnement.tsx) — maintenir les trois alignés.
 * ============================================================================
 */

'use strict';

const crypto = require('crypto');
const { degrees, rgb } = require('pdf-lib');

/* ------------------------------------------------------------------ */
/* Constantes de géométrie (identiques à stamp.ts)                     */
/* ------------------------------------------------------------------ */

const MARGE = 24; // marge de page pour le placement (identique fiches)
const ECART_ELEMENTS = 14; // écart horizontal si deux éléments partagent un coin
const TAILLE_MIN = 40;
const TAILLE_MAX = 1200;
const DECAL_MIN = -1500;
const DECAL_MAX = 1500;

/** Bas de la RÉSERVE de signature du document de réponse (ZONE_SIGNE.bas de
 *  document-acceptation.js) : les éléments BAS_* sont ancrés ICI par défaut —
 *  rendu identique au comportement historique du document signé, puis le
 *  déplacement libre (décalages) permet N'IMPORTE quelle position. */
const BAS_RESERVE = 42;

/** Cachet ROND : diamètre de base en points PDF (× échelle) — ≈ 42 mm. */
const DIAMETRE_CACHET_ROND = 120;
const COULEUR_CACHET_ROND = { r: 0.165, g: 0.34, b: 0.65 };

/** Constantes d'empilement du cachet RECTANGULAIRE (× échelle) — DOUBLE de
 *  CACHET_RECT de stamp.ts (moteur PDF, surface SVG, aperçu client). */
const CACHET_RECT = {
  padH: 6.5, padX: 9, cadre: 3.5,
  corpsOrg: 8, g1: 4, trait: 0.7, g2: 5,
  corpsNom: 10.5, pasNom: 12.6, sep: 6.5,
  pasPetite: 7.4, pasPetite2: 7.0, g3: 2.5,
  corpsMention: 6.8, pasMention: 8.5,
  wMin: 130, wMax: 240,
};

/* ------------------------------------------------------------------ */
/* Placement (jumelles EXACTES de stamp.ts)                            */
/* ------------------------------------------------------------------ */

/** Coin de départ + décalage utilisateur borné au PÉRIMÈTRE de la page —
 *  réplique EXACTE de coinVersBoite() de stamp.ts, avec la réserve basse
 *  fixée à BAS_RESERVE (42 pt — zone de signature du document de réponse). */
function coinVersBoite(position, pageW, pageH, w, h, decalX, decalY) {
  const haut = String(position || '').startsWith('HAUT');
  const droite = String(position || '').endsWith('DROITE');
  const brut = {
    x: (droite ? pageW - MARGE - w : MARGE) + (Number(decalX) || 0),
    y: (haut ? pageH - MARGE - h : BAS_RESERVE) + (Number(decalY) || 0),
  };
  const maxX = Math.max(MARGE, pageW - MARGE - w);
  const maxY = Math.max(BAS_RESERVE, pageH - MARGE - h);
  return {
    x: Math.min(maxX, Math.max(MARGE, brut.x)),
    y: Math.min(maxY, Math.max(BAS_RESERVE, brut.y)),
  };
}

/** BAS_CENTRE (défaut) = centré au-dessus de la réserve basse ; 4 coins =
 *  coinVersBoite. Jumelle de certVersBoite() de stamp.ts (yBasDefaut = 42). */
function certVersBoite(position, pageW, pageH, w, h, yBasDefaut, decalX, decalY) {
  if (String(position || 'BAS_CENTRE').trim().toUpperCase() === 'BAS_CENTRE') {
    const brut = {
      x: (pageW - w) / 2 + (Number(decalX) || 0),
      y: (yBasDefaut == null ? BAS_RESERVE : yBasDefaut) + (Number(decalY) || 0),
    };
    const maxX = Math.max(6, pageW - 6 - w);
    const maxY = Math.max(yBasDefaut == null ? BAS_RESERVE : yBasDefaut, pageH - h);
    return {
      x: Math.min(maxX, Math.max(6, brut.x)),
      y: Math.min(maxY, Math.max(0, brut.y)),
    };
  }
  return coinVersBoite(String(position), pageW, pageH, w, h, decalX, decalY);
}

/** Normalise un angle en degrés entiers 0..359 (défaut 0). Jumelle
 *  angleNormalisee() de stamp.ts / angleNormaliseeTampon() portail. */
function angleNormalisee(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const a = Math.round(n) % 360;
  return a < 0 ? a + 360 : a;
}

/** Boîte englobante d'un rectangle w×h tourné de angleDeg — jumelle de
 *  boiteTournee() de stamp.ts. */
function boiteTournee(w, h, angleDeg) {
  const t = (Number(angleDeg) || 0) * Math.PI / 180;
  const cos = Math.abs(Math.cos(t));
  const sin = Math.abs(Math.sin(t));
  return { w: w * cos + h * sin, h: w * sin + h * cos };
}

/** Point (px,py) du rectangle w×h APRÈS rotation horaire angleDeg autour du
 *  centre (cx,cy) — jumelle de pointTourne() de stamp.ts. */
function pointTourne(cx, cy, bw, bh, angleDeg, px, py) {
  const t = (Number(angleDeg) || 0) * Math.PI / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const dx = px - bw / 2;
  const dy = py - bh / 2;
  return {
    x: cx + dx * cos + dy * sin,
    y: cy - dx * sin + dy * cos,
  };
}

/** Chevauchement de deux boîtes (avec l'écart anti-collision). Jumelle de
 *  chevauche() de stamp.ts. */
function chevauche(a, b) {
  if (!a || !b) return false;
  return (
    a.x < b.x + b.w + ECART_ELEMENTS &&
    b.x < a.x + a.w + ECART_ELEMENTS &&
    a.y < b.y + b.h &&
    b.y < a.y + a.h
  );
}

/* ------------------------------------------------------------------ */
/* Jetons et empreintes HMAC (JUMELLES EXACTES de stamp.ts)            */
/* ------------------------------------------------------------------ */

const SEL_SIGNATURE = 'autorh-signature-v1';
const DOMAINE_JETON_REPONSE = 'reponse-en-ligne-v1';

function keyMaterial() {
  return (
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
    process.env.AUTH_SECRET ||
    'autorh-storage-local-a-changer-dans-env'
  );
}

let _cleEmpreinte = null;
function cleEmpreinte() {
  if (!_cleEmpreinte) {
    _cleEmpreinte = crypto.scryptSync(keyMaterial(), SEL_SIGNATURE, 32);
  }
  return _cleEmpreinte;
}

/** Charge utile commune (TS ⇄ JS) : mêmes champs, même ordre.
 *  infos : { id, cin, period, netSalary, uploadedAt }. */
function chargeEmpreinte(infos) {
  const up =
    infos.uploadedAt instanceof Date
      ? infos.uploadedAt.toISOString()
      : new Date(infos.uploadedAt).toISOString();
  return [infos.id, infos.cin ?? '', infos.period ?? '', infos.netSalary ?? '', up].join('|');
}

/** Empreinte de contrôle = HMAC-SHA256 → 12 caractères hex MAJUSCULES.
 *  Jumelle d'empreinteFiche() de stamp.ts — le QR « DONNÉES » du document
 *  porte la même discipline d'empreinte que les fiches. */
function empreinteDocument(infos) {
  return crypto
    .createHmac('sha256', cleEmpreinte())
    .update(chargeEmpreinte(infos))
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
}

/** Jeton signé de la page de vérification d'une réponse = HMAC-SHA256 →
 *  24 hex MAJUSCULES. Jumelle EXACTE de jetonReponse() de stamp.ts : les
 *  pages publiques /verification/reponse/* valident avec le moteur TS. */
function jetonReponse(reference) {
  return crypto
    .createHmac('sha256', cleEmpreinte())
    .update(DOMAINE_JETON_REPONSE + '|' + String(reference ?? ''))
    .digest('hex')
    .slice(0, 24)
    .toUpperCase();
}

/* ------------------------------------------------------------------ */
/* Contenu du QR (mêmes modes que les fiches)                          */
/* ------------------------------------------------------------------ */

/** Date FR « jj/mm/aaaa » (identique à dateFr de stamp.ts pour la partie jour). */
function dateFrJour(d) {
  try {
    return new Date(d).toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  } catch {
    return String(d || '');
  }
}

/**
 * Contenu du QR du document de réponse — MÊMES MODES que contenuQr() de
 * stamp.ts. cfg : config docSigné (champs docQr*). ctx : contexte de la
 * demande ({ reference, cin, nomEmploye, typeLibelle, statutFinal,
 * createdAt }). empreinte : empreinteDocument(...) précalculée.
 */
function contenuQrDocument(ctx, cfg, empreinte) {
  const mode = String((cfg && cfg.docQrMode) || 'DONNEES').trim().toUpperCase();
  const base = String((cfg && cfg.docQrUrl) || '').trim().replace(/\/+$/, '');
  // Mode « FICHE EN LIGNE » : le QR encode l'adresse PUBLIQUE de vérification
  // de la RÉPONSE — {docQrUrl}/verification/reponse/{reference}?t={jeton signé}
  // (même principe que le QR « Fiche en ligne » des fiches de paie).
  if (mode === 'FICHE') {
    if (!base) return '';
    return (
      base +
      '/verification/reponse/' +
      encodeURIComponent(ctx.reference) +
      '?t=' +
      jetonReponse(ctx.reference)
    );
  }
  if (mode === 'URL') {
    if (!base) return '';
    const sep = base.includes('?') ? '&' : '?';
    return (
      base +
      sep +
      'ref=' +
      encodeURIComponent(ctx.reference) +
      '&cin=' +
      encodeURIComponent(ctx.cin || '') +
      '&h=' +
      empreinte
    );
  }
  if (mode === 'TEXTE') {
    return String((cfg && cfg.docQrTexte) || '').trim();
  }
  // Mode DONNÉES (défaut) : carte d'identité du document lisible par tout
  // lecteur QR — même présentation que les réponses RH (« Document officiel »).
  return [
    'AutoRH — Document officiel',
    'Réf : ' + ctx.reference,
    String(ctx.nomEmploye || '').trim() ? 'Employé : ' + String(ctx.nomEmploye).trim() : null,
    String(ctx.cin || '').trim() ? 'CIN : ' + String(ctx.cin).trim() : null,
    ctx.typeLibelle ? 'Objet : ' + ctx.typeLibelle : null,
    ctx.statutFinal ? 'Statut : ' + ctx.statutFinal : null,
    'Émis le : ' + dateFrJour(ctx.createdAt || new Date()),
    'Empreinte : ' + empreinte,
  ].filter(Boolean).join('\n');
}

/* ------------------------------------------------------------------ */
/* CACHET « SIGNATURE ÉLECTRONIQUE » (jumelles de stamp.ts)            */
/* ------------------------------------------------------------------ */

/** Extrait CN et O d'un sujet X.509 brut. Jumelle de sujetVersTitulaire(). */
function sujetVersTitulaire(sujet) {
  const s = String(sujet ?? '');
  const cn = (/(?:^|,\s*)CN=([^,]+)/i.exec(s) || [])[1];
  const o = (/(?:^|,\s*)O=([^,]+)/i.exec(s) || [])[1];
  return { cn: cn ? cn.trim() : '', o: o ? o.trim() : '' };
}

/** Le cachet est-il dessinable ? elecActif ON + métadonnées injectées. */
function signatureElecAffichable(cfg) {
  return Boolean(
    cfg &&
      cfg.elecActif &&
      cfg.elec &&
      (String((cfg.elec && cfg.elec.certSujet) ?? '').trim() ||
        String((cfg.elec && cfg.elec.certEmpreinte) ?? '').trim())
  );
}

/** Échelle du cachet (elecTaille 50 → 300 %, défaut 1). */
function echelleElec(cfg) {
  const n = Number(cfg && cfg.elecTaille);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(0.5, Math.min(3, n / 100));
}

function formeElec(cfg) {
  return String(cfg && cfg.elecForme ? cfg.elecForme : '').trim().toUpperCase() === 'ROND'
    ? 'ROND'
    : 'RECTANGLE';
}

/** Lignes du cachet RECTANGLE (repli historique v0.2.119). Jumelle de
 *  lignesSignatureElec() — mêmes interrupteurs elecAff*. */
function lignesSignatureElec(cfg) {
  if (!signatureElecAffichable(cfg)) return [];
  const elec = cfg.elec;
  const { cn, o } = sujetVersTitulaire(elec.certSujet);
  const titulaire = cn || String(elec.certSujet ?? '').trim();
  const emetteur = String(elec.certEmetteur ?? '').trim();
  const empreinte = String(elec.certEmpreinte ?? '').replace(/\s+/g, '').toUpperCase();
  const jusquAu = elec.certValideAu ? dateFrJour(elec.certValideAu) : '';
  const libre = String(cfg.elecTexteLibre ?? '').trim();
  return [
    'SIGNATURE ÉLECTRONIQUE',
    Boolean(cfg.elecAffSignataire) && titulaire ? 'Signataire : ' + titulaire : '',
    Boolean(cfg.elecAffOrganisation) ? o : '',
    Boolean(cfg.elecAffEmetteur) && emetteur ? 'Émetteur : ' + emetteur : '',
    Boolean(cfg.elecAffValidite) && jusquAu ? "Valide jusqu'au " + jusquAu : '',
    Boolean(cfg.elecAffEmpreinte) && empreinte
      ? 'Certificat SHA-256 : ' + empreinte.slice(0, 24) + (empreinte.length > 24 ? '…' : '')
      : '',
    libre,
  ].filter((l) => l.trim());
}

/** Nettoie un texte pour les polices standard PDF (WinAnsi). */
function texteWinAnsi(texte) {
  let t = String(texte ?? '')
    .replace(/[\u2190-\u21FF\u2794\u27A1]/g, '->')
    .replace(/[\u2264]/g, '<=')
    .replace(/[\u2265]/g, '>=')
    .replace(/[\u2260]/g, '!=')
    .replace(/[\u2212]/g, '-');
  t = t.replace(
    /[^\x20-\x7E\u00A0-\u00FF\u20AC\u2018\u2019\u201C\u201D\u2013\u2014\u2022\u2026\u2039\u203A\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC]/g,
    '?'
  );
  return t;
}

/** CONTENU du cachet (ROND et RECTANGLE) — jumelle de contenuCachetRond().
 *  Déterministe (aucune date d'apposition). Zones alimentées selon les
 *  interrupteurs elecAff* ; défaut = mention « SIGNATURE ÉLECTRONIQUE » seule. */
function contenuCachet(cfg) {
  if (!signatureElecAffichable(cfg)) return null;
  const elec = cfg.elec;
  const sujet = String(elec.certSujet ?? '').trim();
  const cn = (/(?:^|,\s*)CN=([^,]+)/i.exec(sujet) || [])[1];
  const cnV = cn ? cn.trim() : sujet;
  const o = (/(?:^|,\s*)O=([^,]+)/i.exec(sujet) || [])[1];
  const oV = o ? o.trim() : '';
  const empreinte = String(elec.certEmpreinte ?? '').replace(/\s+/g, '').toUpperCase();
  const jusquAu = elec.certValideAu ? dateFrJour(elec.certValideAu) : '';
  const affSignataire = Boolean(cfg.elecAffSignataire);
  const affOrganisation = Boolean(cfg.elecAffOrganisation);
  const affValidite = Boolean(cfg.elecAffValidite);
  const affEmpreinte = Boolean(cfg.elecAffEmpreinte);
  const libre = String(cfg.elecTexteLibre ?? '').trim();
  const arcHaut = ((affOrganisation && oV) || (affSignataire && cnV) || '').toUpperCase().slice(0, 34);
  const affEmetteur = Boolean(cfg.elecAffEmetteur);
  const emetteur = String(elec.certEmetteur ?? '').trim();
  const centre = [];
  if (affSignataire && cnV) {
    centre.push({ texte: texteWinAnsi(cnV), gras: true, taille: 1 });
    if (libre) centre.push({ texte: texteWinAnsi(libre), gras: false, taille: 0.52 });
  } else if (libre) {
    centre.push({ texte: texteWinAnsi(libre), gras: true, taille: 0.9 });
  }
  if (affEmetteur && emetteur)
    centre.push({ texte: texteWinAnsi('Émetteur : ' + emetteur), gras: false, taille: 0.5 });
  if (affValidite && jusquAu)
    centre.push({ texte: texteWinAnsi("Valide jusqu'au " + jusquAu), gras: false, taille: 0.52 });
  if (affEmpreinte && empreinte)
    centre.push({
      texte: texteWinAnsi('Cert. SHA-256 : ' + empreinte.slice(0, 16) + '…'),
      gras: false,
      taille: 0.46,
    });
  return { arcHaut: texteWinAnsi(arcHaut), arcBas: texteWinAnsi('SIGNATURE ÉLECTRONIQUE'), centre };
}

/** Tronque une ligne avec « … » jusqu'à tenir dans largeurMax. Jumelle de
 *  tronquerLigneCachet(). */
function tronquerLigneCachet(texte, taille, font, largeurMax) {
  let t = texte;
  while (t.length > 4 && font.widthOfTextAtSize(t, taille) > largeurMax) {
    t = t.slice(0, -2).trimEnd() + '…';
  }
  return t;
}

/** GÉOMÉTRIE du cachet RECTANGULAIRE — jumelle de geometrieCachetRectangle(). */
function geometrieCachetRectangle(cfg, font, fontGras) {
  const rond = contenuCachet(cfg);
  if (!rond) return null;
  const S = echelleElec(cfg);
  const C = CACHET_RECT;
  const largeurUtile = C.wMax * S - 2 * (C.padX + C.cadre) * S;
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
    texte: nomBrut ? tronquerLigneCachet(nomBrut.texte, C.corpsNom * S, fontGras, largeurUtile) : '',
    taille: C.corpsNom * S,
  };
  const mention = {
    texte: tronquerLigneCachet(rond.arcBas, C.corpsMention * S, font, largeurUtile),
    taille: C.corpsMention * S,
  };
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
  const wPt = Math.max(C.wMin * S, Math.min(C.wMax * S, wContenu + 2 * (C.padX + C.cadre) * S));
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

/** TEXTE EN ARC sur une page PDF — jumelle de dessinerArcCachetPdf(). */
function dessinerArcCachetPdf(page, texte, cx, cy, rayon, taille, font, couleur, position) {
  const caracteres = Array.from(texte);
  if (!caracteres.length || rayon <= 1) return;
  const espacement = taille * 0.18;
  const largeurs = caracteres.map((c) => font.widthOfTextAtSize(c, taille));
  const total = largeurs.reduce((a, b) => a + b, 0) + espacement * (caracteres.length - 1);
  if (total <= 0) return;
  const amplitude = Math.min((150 * Math.PI) / 180, (total + taille * 1.6) / rayon);
  const pas = amplitude / total;
  let a;
  if (position === 'HAUT') {
    a = Math.PI / 2 + amplitude / 2;
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
    a = -Math.PI / 2 - amplitude / 2;
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
/* Dessin des ÉLÉMENTS du document de réponse                          */
/* ------------------------------------------------------------------ */

let _qrcode = null;
function chargeQrcode() {
  if (!_qrcode) _qrcode = require('qrcode');
  return _qrcode;
}

/** dataURL image → { octets, png } — null si invalide. */
function decoderImage(dataUrl) {
  const m = /^data:image\/(png|jpe?g);base64,([\s\S]+)$/.exec(String(dataUrl || '').trim());
  if (!m) return null;
  try {
    const octets = Buffer.from(m[2], 'base64');
    if (!octets.length) return null;
    return { octets, png: m[1] === 'png' };
  } catch {
    return null;
  }
}

/**
 * Dessine TOUS les éléments du tampon unifié sur la page 1 du document :
 *   1. PARAPHE (signature image — position/taille/décalages/rotation) ;
 *   2. TAMPON (cachet image — idem + opacité) ;
 *   3. QR CODE (5 modes — génération identique aux fiches) ;
 *   4. CACHET « SIGNATURE ÉLECTRONIQUE » (ROND ou RECTANGLE — alimenté par
 *      les métadonnées du module, injectées par l'appelant).
 * Anti-collision signature ↔ QR (même coin) : décalage latéral (comme
 * stamp.ts). Renvoie la liste des éléments réellement dessinés.
 *
 * @param {object} opts
 *   doc, page            — PDFDocument + PDFPage cibles (page 1) ;
 *   font, fontGras       — polices Helvetica intégrées ;
 *   cfg                  — config docSigné (champs docSig + tampon + docQr + docElec) ;
 *   images               — { paraphe, tampon, qrFourni } (dataURLs RÉSOLUS
 *                          par l'appelant selon les sources DEDIEE/IMPORT) ;
 *   elec                 — { certSujet, certEmetteur, certEmpreinte,
 *                          certValideAu } | null (métadonnées du module —
 *                          injectées EN DIRECT, jamais stockées) ;
 *   ctx                  — contexte QR ({ reference, cin, nomEmploye,
 *                          typeLibelle, statutFinal, createdAt }).
 */
async function dessinerElementsDocument(opts) {
  const { doc, page, font, fontGras, cfg, images, elec, ctx } = opts;
  const W = page.getWidth();
  const H = page.getHeight();
  const elements = [];

  /* ---- 1) PARAPHE (signature image) ---- */
  const decParaphe = decoderImage(images && images.paraphe);
  if (decParaphe && cfg.docSigActif !== false) {
    try {
      const img = decParaphe.png ? await doc.embedPng(decParaphe.octets) : await doc.embedJpg(decParaphe.octets);
      const largeur = Math.max(TAILLE_MIN, Math.min(TAILLE_MAX, Number(cfg.docSigTaille) || 120));
      const hauteur = img.height * (largeur / img.width);
      const angle = angleNormalisee(cfg.docSigRotation);
      const bb = boiteTournee(largeur, hauteur, angle);
      const pos = coinVersBoite(cfg.docSigPosition, W, H, bb.w, bb.h, cfg.docSigDecalX, cfg.docSigDecalY);
      const boite = { x: pos.x, y: pos.y, w: bb.w, h: bb.h };
      const opacite = Math.max(0.3, Math.min(1, 0.9));
      if (angle === 0) {
        page.drawImage(img, { x: boite.x, y: boite.y, width: largeur, height: hauteur, opacity: opacite });
      } else {
        const ancre = pointTourne(
          boite.x + boite.w / 2, boite.y + boite.h / 2,
          largeur, hauteur, angle, 0, 0
        );
        page.drawImage(img, {
          x: ancre.x, y: ancre.y, width: largeur, height: hauteur,
          opacity: opacite, rotate: degrees(-angle),
        });
      }
      elements.push('signature');
      // Anti-collision avec le QR (mêmes coin) — mémorise la boîte pour le QR.
      opts._boiteParaphe = boite;
    } catch {
      // image illisible : ignorée (jamais bloquant)
    }
  }

  /* ---- 2) TAMPON (cachet image) ---- */
  // (v0.2.145) interrupteur INDÉPENDANT tamponActif : false → jamais dessiné
  // (défaut indéfini/true = continuité, élément appliqué quand configuré).
  const decTampon = decoderImage(images && images.tampon);
  if (decTampon && cfg.tamponActif !== false) {
    try {
      const img = decTampon.png ? await doc.embedPng(decTampon.octets) : await doc.embedJpg(decTampon.octets);
      const largeur = Math.max(TAILLE_MIN, Math.min(TAILLE_MAX, Number(cfg.tamponTaille) || 140));
      const hauteur = img.height * (largeur / img.width);
      const angle = angleNormalisee(cfg.tamponRotation);
      const bb = boiteTournee(largeur, hauteur, angle);
      const pos = coinVersBoite(cfg.tamponPosition, W, H, bb.w, bb.h, cfg.tamponDecalX, cfg.tamponDecalY);
      const opacite = Math.max(0.3, Math.min(1, Number(cfg.tamponOpacite) || 0.85));
      if (angle === 0) {
        page.drawImage(img, { x: pos.x, y: pos.y, width: largeur, height: hauteur, opacity: opacite });
      } else {
        const ancre = pointTourne(
          pos.x + bb.w / 2, pos.y + bb.h / 2,
          largeur, hauteur, angle, 0, 0
        );
        page.drawImage(img, {
          x: ancre.x, y: ancre.y, width: largeur, height: hauteur,
          opacity: opacite, rotate: degrees(-angle),
        });
      }
      elements.push('tampon');
    } catch {
      // image illisible : ignorée
    }
  }

  /* ---- 3) QR CODE (5 modes — génération identique aux fiches) ---- */
  // Apposé UNIQUEMENT quand l'interrupteur docQrActif est ON (comme les
  // fiches : qrActif détermine l'apposition).
  if (cfg.docQrActif === true) try {
    const cfgT = {
      docQrMode: cfg.docQrMode,
      docQrUrl: cfg.docQrUrl,
      docQrTexte: cfg.docQrTexte,
    };
    const empreinte = empreinteDocument({
      id: ctx.reference,
      cin: ctx.cin || '',
      period: ctx.typeLibelle || '',
      netSalary: '',
      uploadedAt: ctx.createdAt || new Date(),
    });
    const contenu = contenuQrDocument(ctx, cfgT, empreinte);
    let qrImg = null;
    let qrL = 0;
    let qrH = 0;
    if (cfg.docQrMode === 'IMAGE') {
      const dec = decoderImage(images && images.qrFourni);
      if (dec) {
        qrImg = dec.png ? await doc.embedPng(dec.octets) : await doc.embedJpg(dec.octets);
        const cote = Math.max(TAILLE_MIN, Math.min(TAILLE_MAX, Number(cfg.docQrTaille) || 110));
        const echelle = cote / Math.max(qrImg.width, qrImg.height);
        qrL = qrImg.width * echelle;
        qrH = qrImg.height * echelle;
      }
    } else if (contenu) {
      const QRCode = chargeQrcode();
      const png = await QRCode.toBuffer(contenu, {
        type: 'png',
        margin: 0,
        width: 640,
        errorCorrectionLevel: 'M',
      });
      qrImg = await doc.embedPng(png);
      const cote = Math.max(TAILLE_MIN, Math.min(TAILLE_MAX, Number(cfg.docQrTaille) || 110));
      qrL = cote;
      qrH = cote;
    }
    if (qrImg && qrL > 0) {
      const angleQr = angleNormalisee(cfg.docQrRotation);
      const bbQr = boiteTournee(qrL, qrH, angleQr);
      const posQr = coinVersBoite(cfg.docQrPosition, W, H, bbQr.w, bbQr.h, cfg.docQrDecalX, cfg.docQrDecalY);
      const boiteQr = { x: posQr.x, y: posQr.y, w: bbQr.w, h: bbQr.h };
      // Anti-collision paraphe ↔ QR (même discipline que stamp.ts) :
      if (opts._boiteParaphe && chevauche(opts._boiteParaphe, boiteQr)) {
        const aDroite = String(cfg.docQrPosition || '').endsWith('DROITE');
        boiteQr.x = aDroite
          ? opts._boiteParaphe.x - ECART_ELEMENTS - boiteQr.w
          : opts._boiteParaphe.x + opts._boiteParaphe.w + ECART_ELEMENTS;
      }
      if (angleQr === 0) {
        page.drawImage(qrImg, { x: boiteQr.x, y: boiteQr.y, width: qrL, height: qrH });
      } else {
        const ancre = pointTourne(
          boiteQr.x + boiteQr.w / 2, boiteQr.y + boiteQr.h / 2,
          qrL, qrH, angleQr, 0, 0
        );
        page.drawImage(qrImg, {
          x: ancre.x, y: ancre.y, width: qrL, height: qrH, rotate: degrees(-angleQr),
        });
      }
      elements.push('qr');
    }
  } catch {
    // QR impossible : ignoré (jamais bloquant)
  }

  /* ---- 4) CACHET « SIGNATURE ÉLECTRONIQUE » (ROND ou RECTANGLE) ---- */
  const cfgElec = {
    elecActif: Boolean(cfg.docElecActif) && Boolean(elec),
    elecPosition: cfg.docElecPosition,
    elecDecalX: cfg.docElecDecalX,
    elecDecalY: cfg.docElecDecalY,
    elecTaille: cfg.docElecTaille,
    elecForme: cfg.docElecForme,
    elecAffSignataire: cfg.docElecAffSignataire,
    elecAffOrganisation: cfg.docElecAffOrganisation,
    elecAffEmetteur: cfg.docElecAffEmetteur,
    elecAffValidite: cfg.docElecAffValidite,
    elecAffEmpreinte: cfg.docElecAffEmpreinte,
    elecTexteLibre: cfg.docElecTexteLibre,
    elec,
  };
  if (signatureElecAffichable(cfgElec)) {
    const encre = rgb(COULEUR_CACHET_ROND.r, COULEUR_CACHET_ROND.g, COULEUR_CACHET_ROND.b);
    if (formeElec(cfgElec) === 'ROND') {
      const rond = contenuCachet(cfgElec);
      if (rond) {
        const D = DIAMETRE_CACHET_ROND * echelleElec(cfgElec);
        const posR = certVersBoite(cfgElec.elecPosition, W, H, D, D, BAS_RESERVE, cfgElec.elecDecalX, cfgElec.elecDecalY);
        const cxR = posR.x + D / 2;
        const cyR = posR.y + D / 2;
        const R = D / 2;
        const rap = D / DIAMETRE_CACHET_ROND;
        page.drawEllipse({
          x: cxR, y: cyR, xScale: R, yScale: R,
          borderColor: encre, borderWidth: 2.2 * rap, borderOpacity: 0.92,
        });
        const Ri = R - D * 0.075;
        page.drawEllipse({
          x: cxR, y: cyR, xScale: Ri, yScale: Ri,
          borderColor: encre, borderWidth: 0.8 * rap, borderOpacity: 0.75,
        });
        const rayonTexte = R - D * 0.115;
        const tailleArc = D * 0.072;
        if (rond.arcHaut)
          dessinerArcCachetPdf(page, rond.arcHaut, cxR, cyR, rayonTexte - tailleArc * 0.35, tailleArc, fontGras, encre, 'HAUT');
        if (rond.arcBas)
          dessinerArcCachetPdf(page, rond.arcBas, cxR, cyR, rayonTexte + tailleArc * 0.31, tailleArc * 0.9, font, encre, 'BAS');
        const rPt = D * 0.016;
        for (const ang of [0, Math.PI]) {
          page.drawEllipse({
            x: cxR + rayonTexte * Math.cos(ang),
            y: cyR + rayonTexte * Math.sin(ang),
            xScale: rPt, yScale: rPt, color: encre, borderOpacity: 0,
          });
        }
        const lignesC = rond.centre;
        const tailleNom = 10.5 * rap;
        const largeurMaxCentre = Ri * 2 - D * 0.16;
        let yC = cyR + ((lignesC.length - 1) * tailleNom) / 2;
        for (let i = 0; i < lignesC.length; i++) {
          const ligne = lignesC[i];
          const tailleL = ligne.gras ? tailleNom : Math.max(4.2, ligne.taille * 10.5 * rap);
          const fL = ligne.gras ? fontGras : font;
          let texteL = ligne.texte;
          while (texteL.length > 4 && fL.widthOfTextAtSize(texteL, tailleL) > largeurMaxCentre) {
            texteL = texteL.slice(0, -2).trimEnd() + '…';
          }
          const wL = fL.widthOfTextAtSize(texteL, tailleL);
          page.drawText(texteL, {
            x: cxR - wL / 2,
            y: yC - tailleL * 0.36,
            size: tailleL,
            font: fL,
            color: encre,
          });
          if (i === 0) {
            const yS = yC - tailleNom * 0.82;
            const demi = D * 0.075;
            page.drawLine({
              start: { x: cxR - demi * 1.9, y: yS }, end: { x: cxR - demi * 0.75, y: yS },
              thickness: 0.7 * rap, color: encre, opacity: 0.9,
            });
            page.drawLine({
              start: { x: cxR + demi * 0.75, y: yS }, end: { x: cxR + demi * 1.9, y: yS },
              thickness: 0.7 * rap, color: encre, opacity: 0.9,
            });
            const rPu = D * 0.012;
            page.drawEllipse({ x: cxR, y: yS, xScale: rPu, yScale: rPu, color: encre, borderOpacity: 0 });
          }
          yC -= ligne.gras ? tailleNom * 1.24 : Math.max(7.4, tailleL * 1.5);
        }
        elements.push('elec');
      }
    } else {
      const geo = geometrieCachetRectangle(cfgElec, font, fontGras);
      if (geo) {
        const S = geo.echelle;
        const C = CACHET_RECT;
        const posElec = certVersBoite(
          cfgElec.elecPosition, W, H, geo.wPt, geo.hPt, BAS_RESERVE,
          cfgElec.elecDecalX, cfgElec.elecDecalY
        );
        page.drawRectangle({
          x: posElec.x, y: posElec.y, width: geo.wPt, height: geo.hPt,
          borderColor: encre, borderWidth: 2.2 * S, borderOpacity: 0.92,
        });
        page.drawRectangle({
          x: posElec.x + C.cadre * S, y: posElec.y + C.cadre * S,
          width: geo.wPt - 2 * C.cadre * S, height: geo.hPt - 2 * C.cadre * S,
          borderColor: encre, borderWidth: 0.8 * S, borderOpacity: 0.75,
        });
        let yT = posElec.y + geo.hPt - C.padH * S;
        if (geo.org.texte) {
          page.drawText(geo.org.texte, {
            x: posElec.x + (geo.wPt - fontGras.widthOfTextAtSize(geo.org.texte, geo.org.taille)) / 2,
            y: yT - geo.org.taille * 0.85,
            size: geo.org.taille, font: fontGras, color: encre,
          });
          yT -= C.corpsOrg * S + C.g1 * S;
          const demiLigne = geo.wPt * 0.3;
          page.drawLine({
            start: { x: posElec.x + geo.wPt / 2 - demiLigne, y: yT - C.trait * S * 0.5 },
            end: { x: posElec.x + geo.wPt / 2 + demiLigne, y: yT - C.trait * S * 0.5 },
            thickness: C.trait * S, color: encre, opacity: 0.9,
          });
          yT -= C.trait * S + C.g2 * S;
        }
        if (geo.nom.texte) {
          page.drawText(geo.nom.texte, {
            x: posElec.x + (geo.wPt - fontGras.widthOfTextAtSize(geo.nom.texte, geo.nom.taille)) / 2,
            y: yT - geo.nom.taille,
            size: geo.nom.taille, font: fontGras, color: encre,
          });
          yT -= C.pasNom * S;
          const ySep = yT - C.sep * S * 0.5;
          const demi = geo.wPt * 0.055;
          page.drawLine({
            start: { x: posElec.x + geo.wPt / 2 - demi * 1.9, y: ySep },
            end: { x: posElec.x + geo.wPt / 2 - demi * 0.75, y: ySep },
            thickness: 0.7 * S, color: encre, opacity: 0.9,
          });
          page.drawLine({
            start: { x: posElec.x + geo.wPt / 2 + demi * 0.75, y: ySep },
            end: { x: posElec.x + geo.wPt / 2 + demi * 1.9, y: ySep },
            thickness: 0.7 * S, color: encre, opacity: 0.9,
          });
          page.drawEllipse({
            x: posElec.x + geo.wPt / 2, y: ySep,
            xScale: 1.44 * S, yScale: 1.44 * S, color: encre, borderOpacity: 0,
          });
          yT -= C.sep * S;
        }
        for (let i = 0; i < geo.petites.length; i++) {
          const ligne = geo.petites[i];
          const wL = font.widthOfTextAtSize(ligne.texte, ligne.taille);
          page.drawText(ligne.texte, {
            x: posElec.x + (geo.wPt - wL) / 2,
            y: yT - ligne.taille,
            size: ligne.taille, font, color: encre,
          });
          yT -= (i === 0 ? C.pasPetite : C.pasPetite2) * S;
        }
        if (geo.petites.length) yT -= C.g3 * S;
        if (geo.mention.texte) {
          page.drawText(geo.mention.texte, {
            x: posElec.x + (geo.wPt - font.widthOfTextAtSize(geo.mention.texte, geo.mention.taille)) / 2,
            y: yT - geo.mention.taille * 0.9,
            size: geo.mention.taille, font, color: encre,
          });
        }
        elements.push('elec');
      } else {
        // REPLI (ni CN ni O) — rendu historique v0.2.119 : bloc gris encadré.
        const lignesElec = lignesSignatureElec(cfgElec);
        if (lignesElec.length) {
          const echelleE = echelleElec(cfgElec);
          const tailleTitre = 7.5 * echelleE;
          const tailleLigne = 6.5 * echelleE;
          const pasE = 9 * echelleE;
          const nLignes = lignesElec.length - 1;
          const wTitre = fontGras.widthOfTextAtSize(lignesElec[0], tailleTitre);
          const wLignes = lignesElec.slice(1).map((l) => font.widthOfTextAtSize(l, tailleLigne));
          const wBloc = Math.max(wTitre, ...(wLignes.length ? wLignes : [0])) + 12;
          const hBloc = 5 + tailleTitre * 0.85 + nLignes * pasE + 5;
          const posElec = certVersBoite(
            cfgElec.elecPosition, W, H, wBloc, hBloc, BAS_RESERVE,
            cfgElec.elecDecalX, cfgElec.elecDecalY
          );
          page.drawRectangle({
            x: posElec.x, y: posElec.y, width: wBloc, height: hBloc,
            borderColor: rgb(0.55, 0.6, 0.66), borderWidth: 0.9,
          });
          let yB = posElec.y + hBloc - 5 - tailleTitre * 0.85 + 2;
          page.drawText(lignesElec[0], {
            x: posElec.x + (wBloc - wTitre) / 2, y: yB,
            size: tailleTitre, font: fontGras, color: rgb(0.25, 0.3, 0.36),
          });
          yB -= pasE;
          for (const ligne of lignesElec.slice(1)) {
            const wL = font.widthOfTextAtSize(ligne, tailleLigne);
            page.drawText(ligne, {
              x: posElec.x + (wBloc - wL) / 2, y: yB,
              size: tailleLigne, font, color: rgb(0.3, 0.35, 0.41),
            });
            yB -= pasE;
          }
          elements.push('elec');
        }
      }
    }
  }

  return elements;
}

/* ------------------------------------------------------------------ */
/* EXPORTS                                                             */
/* ------------------------------------------------------------------ */

module.exports = {
  // constantes (alignées stamp.ts)
  MARGE,
  ECART_ELEMENTS,
  TAILLE_MIN,
  TAILLE_MAX,
  DECAL_MIN,
  DECAL_MAX,
  BAS_RESERVE,
  DIAMETRE_CACHET_ROND,
  COULEUR_CACHET_ROND,
  CACHET_RECT,
  // placement (jumelles)
  coinVersBoite,
  certVersBoite,
  angleNormalisee,
  boiteTournee,
  pointTourne,
  chevauche,
  // jetons / empreintes (jumelles EXACTES stamp.ts)
  jetonReponse,
  empreinteDocument,
  chargeEmpreinte,
  // QR
  contenuQrDocument,
  // cachet « Signature électronique »
  sujetVersTitulaire,
  signatureElecAffichable,
  echelleElec,
  formeElec,
  lignesSignatureElec,
  contenuCachet,
  geometrieCachetRectangle,
  dessinerArcCachetPdf,
  // dessin principal
  dessinerElementsDocument,
  decoderImage,
  texteWinAnsi,
};
