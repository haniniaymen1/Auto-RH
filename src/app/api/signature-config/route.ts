/**
 * ============================================================================
 *  NOUVEAU (Task 118) — API DE CONFIGURATION DU TAMPON « SIGNATURE
 *  ÉLECTRONIQUE & QR CODE » (rubrique de l'onglet Importation)
 * ============================================================================
 *
 *  GET  /api/signature-config → configuration complète (y compris l'image de
 *                                 signature en dataURL pour l'aperçu <img>) ;
 *                                 singleton créé à la volée si absent.
 *  PUT  /api/signature-config → enregistre la configuration. L'image de
 *                                 signature n'est écrasée QUE si le champ
 *                                 sigImage est PRÉSENT dans le corps :
 *                                  - chaîne "" → supprime l'image ;
 *                                  - dataURL image/png|jpeg → remplace
 *                                    (plafond ≈ 1,6 Mo encodé) ;
 *                                  - champ absent → inchangée.
 *                                 (NOUVEAU Task 181) champ certFichier :
 *                                 import d'une SIGNATURE ÉLECTRONIQUE
 *                                 CRYPTOGRAPHIQUE en formats professionnels
 *                                 .pkcs7, .p7s, .p7m, .xml, .ps7x, .p12,
 *                                 .pfx (+ .p7b/.p7c/.pem/.cer/.crt/.der) —
 *                                 le fichier est validé PAR SON CONTENU
 *                                 (ASN.1/PEM/XML + mot de passe PKCS#12
 *                                 éventuel), ses MÉTADONNÉES (titulaire,
 *                                 émetteur, série, validité, empreinte
 *                                 SHA-256) vont en base et la copie de
 *                                 contrôle est écrite CHIFFRÉE dans
 *                                 storage/tampons/. certFichier: "" retire.
 *  POST /api/signature-config → { action: "apercu", ...config } : applique la
 *                                 configuration FOURNIE (non enregistrée) à
 *                                 une fiche d'exemple et renvoie le PDF
 *                                 tamponné (inline, application/pdf) — permet
 *                                 de visualiser avant d'enregistrer.
 *
 *  Sécurité : réservé aux rôles RH / SUPERADMIN (MODIFIÉ v0.2.41 : la RH
 *  accède à la rubrique « Signature électronique & QR code » — même
 *  politique que la gestion des fiches dont elle a la charge. MODIFIÉ
 *  Task 176 : le rôle IT n'a PLUS accès à cette configuration — 403
 *  refusIT sur GET/PUT/POST). Mot de passe expiré → 403.
 *  Le tamponnage LUI-MÊME est appliqué dans /api/payslips/[id]/file pour tout
 *  utilisateur habilité, et côté portail employé dans scripts/portail-server.js.
 * ============================================================================
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
// (MODIFIÉ 0.2.59) encryptForStorage ajouté : les copies de contrôle des
// tampons sont désormais CHIFFRÉES sur le disque, comme les fiches de paie
// (AES-256-GCM, en-tête PAIESAGE1) — storage/tampons devient illisible,
// même traitement que storage/payslips.
import {
  decryptFromStorage,
  encryptForStorage,
} from "@/lib/storage-crypto";
import { resolveStoredFile, getTamponsDir, assurerDossierPrive } from "@/lib/storage-dir";
import path from "path";
import {
  estSuperadmin,
  getSessionUser,
  motDePasseExpire,
  refusIT,
  unauthorized,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { apercuTampon, apercuReponseTampon, tamponActif, type ConfigTampon, type InfosFiche, type ReelApercu } from "@/lib/stamp";
import { validerStructureImage } from "@/lib/image-validate";
// (NOUVEAU v0.2.119) injection des métadonnées du certificat du module de
// signature dans la configuration du tampon (cachet « Signature électronique »).
import { completerConfigTamponAvecElec } from "@/lib/signature-api";
// (NOUVEAU v0.2.93) SÉPARATION DES CONFIGURATIONS : la section « Demandes /
// Réponses » possède sa propre configuration (table SignatureConfigReponse),
// lue/fusionnée avec les actifs partagés via ce module.
import {
  fusionnerReponseAvecActifs,
  lireConfigReponse,
  lireLigneReponseAvecContinuite,
  type ConfigReponse,
} from "@/lib/signature-reponse";
// (NOUVEAU Task 181) analyse multi-formats des signatures électroniques.
// (MODIFIÉ Task 222) + CLÉS PRIVÉES : lecteur de fichiers .pem/.key/.der,
// extraction de la clé du coffre .p12/.pfx, appariement cryptographique
// clé ↔ certificat (les certificats seuls sont admis quand la clé privée est
// déjà disponible dans le système — association VÉRIFIÉE, jamais aveugle).
import {
  estExtensionCertificat,
  estExtensionClePrivee,
  extraireCertificatForge,
  parserClePrivee,
  cleCorrespondAuCertificat,
  extraireClePriveePkcs12,
} from "@/lib/signature-crypto";
import * as forge from "node-forge";

export const runtime = "nodejs";

const POSITIONS = ["BAS_DROITE", "BAS_GAUCHE", "HAUT_DROITE", "HAUT_GAUCHE"];
// (NOUVEAU v0.2.92) positions du BLOC CERTIFICAT : BAS_CENTRE = rendu
// historique (centré au-dessus de la mention) + les 4 coins.
const POSITIONS_CERT = ["BAS_CENTRE", "BAS_DROITE", "BAS_GAUCHE", "HAUT_DROITE", "HAUT_GAUCHE"];
// (NOUVEAU v0.2.92) échelle du bloc certificat en % (défaut 100 = 6,5 pt).
const CERT_TAILLE_MIN = 50;
const CERT_TAILLE_MAX = 300;
// (MODIFIÉ Task 180, v0.2.86) mode « FICHE » ajouté : QR « Fiche en ligne » —
// chaque fiche reçoit SON PROPRE lien signé {qrUrl}/verification/fiche/{id}?t=<jeton HMAC>.
const MODES_QR = ["DONNEES", "URL", "TEXTE", "IMAGE", "FICHE"];
// (MODIFIÉ 0.2.48) limite relevée à la demande : une SIGNATURE de qualité
// suffisante (cachet scanné haute résolution 600 dpi) ≈ jusqu'à 8 Mo de
// FICHIER, soit ≈ 10,7 Mo une fois encodé en dataURL base64 (+⅓).
const TAILLE_IMAGE_MAX = 11_000_000; // ≈ octets de dataURL acceptés
// (NOUVEAU 0.2.54) POSITIONNEMENT LIBRE + ROTATION :
//  - décalages ±1500 pt (au lieu de ±120) : l'élément peut être déplacé
//    LIBREMENT sur toute la surface de la feuille (A4, A3 et au-delà) —
//    le placement final reste borné au périmètre de la page par
//    coinVersBoite (jamais coupé, jamais hors page) ;
//  - tailles 40 → 1200 pt (au lieu de 60–240 / 60–220) ;
//  - rotations 0 → 360° sens horaire (0 = historique).
const DECAL_MIN = -1500;
const DECAL_MAX = 1500;
const TAILLE_MIN = 40;
const TAILLE_MAX = 1200;

// (NOUVEAU 0.2.58) limite du NOM de fichier d'origine affiché (traçabilité).
const NOM_FICHIER_MAX = 200;
// (NOUVEAU Task 181) plafond du FICHIER de signature électronique importé,
// exprimé en caractères base64 (un coffre .p12 fait quelques Ko ; on garde
// la même marge que les images, soit un fichier décodé ≈ 8 Mo).
const TAILLE_CERT_BASE64_MAX = 11_000_000;

/**
 * (NOUVEAU 0.2.58) Nettoie un nom de fichier d'origine avant affichage :
 * contrôle de longueur, suppression des caractères de contrôle et des
 * séparateurs de chemin (« / » et « \\ ») — on ne garde que le NOM
 * (jamais le chemin complet du poste client, qui n'a pas de sens côté
 * serveur et peut contenir des informations personnelles).
 */
function nomFichierAffichable(v: unknown): string {
  return String(v ?? "")
    .replace(/[\\/]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, NOM_FICHIER_MAX);
}

/**
 * (NOUVEAU 0.2.58 — « Path : l'emplacement des tampons importés ») Écrit
 * une COPIE DE CONTRÔLE de l'image de tampon importée dans le dossier
 * « storage/tampons/ » et renvoie son chemin RELATIF (forme affichée dans
 * l'interface, indépendante de la racine de déploiement).
 *
 *  (MODIFIÉ 0.2.59 — « storage/tampons illisible comme storage/payslips »)
 *  la copie est écrite CHIFFRÉE (AES-256-GCM via encryptForStorage, même
 *  format PAIESAGE1 que les fiches de paie) : une image de cachet ou de
 *  signature est aussi sensible qu'une fiche — personne n'accédant au
 *  disque ne peut plus récupérer l'image en clair. Le chiffrement est
 *  IDEMPOTENT et jamais bloquant : en cas d'échec local (clé, disque),
 *  le comportement 0.2.58 (copie en clair) est conservé plutôt que de
 *  bloquer l'enregistrement.
 *
 *  - jamais bloquant : tout incident disque (dossier non créable, droits,
 *    espace) est journalisé et renvoie « » — l'enregistrement en base
 *    (source de vérité du rendu) reste la seule opération déterminante ;
 *  - nom de copie généré côté serveur : prefixe-horodatage-extension
 *    (même discipline que les fiches) — le nom d'origine, lui, est conservé
 *    à part dans la colonne …ImageNom pour l'affichage.
 */
async function exporterCopieTampon(
  dataUrl: string,
  prefixe: string
): Promise<string> {
  try {
    const m = dataUrl.match(/^data:image\/(png|jpeg);base64,([\s\S]+)$/);
    if (!m) return "";
    const ext = m[1] === "jpeg" ? "jpg" : "png";
    const octets = Buffer.from(m[2], "base64");
    if (!octets.length) return "";
    const dir = getTamponsDir();
    // Task 209 : dossier PRIVÉ 0700 (création + rattrapage chmod).
    await assurerDossierPrive(dir);
    const horodatage = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, "")
      .slice(0, 14);
    const nom = `${prefixe}-${horodatage}.${ext}`;
    // (0.2.59) copie CHIFFRÉE sur le disque — même format que les fiches :
    // [PAIESAGE1][nonce 12][tag 16][ciphertext AES-256-GCM]. L'extension
    // d'origine (.png/.jpg) est conservée pour l'affichage du chemin, mais
    // le contenu du fichier n'est plus une image lisible.
    // Task 209 : fichier créé en mode 0600 (propriétaire seul).
    await writeFile(path.join(dir, nom), encryptForStorage(octets), { mode: 0o600 });
    return `storage/tampons/${nom}`;
  } catch (e) {
    console.error("[SIGNATURE-CONFIG] copie tampon non écrite:", e);
    return "";
  }
}

/**
 * (NOUVEAU Task 181) Copie de contrôle CHIFFRÉE d'un fichier de signature
 * électronique importé (.p12/.pfx/.pkcs7/…) — même discipline que
 * exporterCopieTampon : AES-256-GCM (encryptForStorage), nom généré côté
 * serveur « certificat-<horodatage>.<ext> », jamais bloquant. Une extension
 * non reconnue devient « .bin » (le contenu reste illisible de toute façon).
 * (MODIFIÉ v0.2.99) paramètre prefixe : « certificat-reponse » pour la copie
 * DÉDIÉE de la section Demandes/Réponses (fichiers distincts par section).
 */
async function exporterCopieCertificat(
  octets: Buffer,
  nomOrigine: string,
  prefixe = "certificat"
): Promise<string> {
  try {
    if (!octets.length) return "";
    const extBrute = String(nomOrigine ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
    const ext = estExtensionCertificat(nomOrigine) ? extBrute : "bin";
    const dir = getTamponsDir();
    // Task 209 : dossier PRIVÉ 0700 (création + rattrapage chmod).
    await assurerDossierPrive(dir);
    const horodatage = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, "")
      .slice(0, 14);
    const nom = `${prefixe}-${horodatage}.${ext}`;
    // Task 209 : fichier créé en mode 0600 (propriétaire seul).
    await writeFile(path.join(dir, nom), encryptForStorage(octets), { mode: 0o600 });
    return `storage/tampons/${nom}`;
  } catch (e) {
    console.error("[SIGNATURE-CONFIG] copie certificat non écrite:", e);
    return "";
  }
}

/**
 * (NOUVEAU v0.2.99) Retire le mot de passe du certificat (stocké CHIFFRÉ en
 * base par section) des réponses API — booléen certMotDePasseEnregistre seul,
 * exactement comme le mot de passe SMTP (jamais renvoyé à l'interface).
 * (MODIFIÉ v0.2.112) le mot de passe de la CLÉ PRIVÉE associée subit la même
 * discipline (certCleMotDePasseEnregistre) et la disponibilité de la clé
 * privée est CALCULÉE (certClePriveeDisponible) : VRAI quand un fichier de
 * clé séparé est enregistré OU que le certificat est un coffre .p12/.pfx
 * (qui contient SA clé privée).
 */
function clePriveeDisponiblePour(cfg: Record<string, unknown>): boolean {
  if (String(cfg.certCleChemin ?? "").trim()) return true;
  const ext = String(cfg.certFichierNom ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return ext === "p12" || ext === "pfx";
}

function sansMotDePasse(
  cfg: Record<string, unknown> | null | undefined
): Record<string, unknown> | null | undefined {
  if (!cfg || typeof cfg !== "object") return cfg;
  const { certMotDePasse, certCleMotDePasse, ...reste } = cfg;
  return {
    ...reste,
    certMotDePasseEnregistre: Boolean(certMotDePasse),
    certCleMotDePasseEnregistre: Boolean(certCleMotDePasse),
    certClePriveeDisponible: clePriveeDisponiblePour(reste),
  };
}

// ===========================================================================
// (NOUVEAU Task 222) CERTIFICAT + CLÉ PRIVÉE ASSOCIÉE — traitement PARTAGÉ
// par les DEUX sections (Import / Demandes-Réponses). Les trois scénarios de
// la demande sont pris en charge :
//   1. CERTIFICAT SEUL quand la clé privée est DÉJÀ DISPONIBLE dans le
//      système (clé séparée enregistrée ou coffre .p12/.pfx précédent) —
//      l'association est VÉRIFIÉE par appariement cryptographique (la clé
//      signe, la clé publique du certificat vérifie) : appariement négatif
//      → erreur explicite, jamais d'association aveugle ;
//   2. CERTIFICAT ACCOMPAGNÉ DE SA CLÉ PRIVÉE — coffre .p12/.pfx (la clé
//      vient du coffre, mot de passe stocké chiffré) OU fichier de clé
//      séparé (.pem/.key/.der, PKCS#8/PKCS#1, clair ou chiffré) ; un PEM
//      COMBINÉ (CERTIFICATE + PRIVATE KEY dans le même fichier) est reconnu
//      et la clé est extraite automatiquement ;
//   3. FORMATS APPROPRIÉS — .p12/.pfx pour un certificat avec sa clé,
//      .pem/.cer/.crt/.der/.p7b/.p7c/.pkcs7/.p7s/.p7m/.xml/.ps7x pour un
//      certificat seul, .pem/.key/.der pour une clé privée seule.
// Toute erreur renvoie { erreur } avec un message FRANÇAIS CLASSÉ (mot de
// passe blâmé SEULEMENT sur refus explicite — discipline Task 221).
// ===========================================================================

/** Ligne de configuration minimale pour l'appariement (les DEUX tables).
 * Les champs mot de passe arrivent DÉJÀ DÉCHIFFRÉS par le middleware db. */
interface LigneCertCfg {
  certFichierNom?: string | null;
  certChemin?: string | null;
  certMotDePasse?: string | null;
  certCleChemin?: string | null;
  certCleFichierNom?: string | null;
  certCleMotDePasse?: string | null;
}

/** Lit un fichier de copie chiffrée (storage/tampons/…) — null si absent. */
async function lireFichierStocke(chemin: string): Promise<Buffer | null> {
  try {
    const base = String(chemin ?? "").replace(/[\\/]/g, "/").split("/").pop() ?? "";
    if (!base) return null;
    const brut = await readFile(path.join(getTamponsDir(), base));
    return decryptFromStorage(brut);
  } catch {
    return null;
  }
}

/** Charge l'OBJET certificat forge depuis la copie chiffrée d'une section. */
async function chargerCertForgeSection(
  ligne: LigneCertCfg | null
): Promise<{ cert: forge.pki.Certificate } | null> {
  if (!ligne?.certChemin) return null;
  const octets = await lireFichierStocke(ligne.certChemin);
  if (!octets) return null;
  try {
    return await extraireCertificatForge(
      ligne.certFichierNom || "certificat.pem",
      octets,
      ligne.certMotDePasse || undefined
    );
  } catch {
    return null;
  }
}

/** Charge l'OBJET clé privée forge déjà disponible dans le système :
 * d'abord le fichier de clé séparé, sinon la clé du coffre .p12/.pfx. */
async function chargerCleForgeSection(
  ligne: LigneCertCfg | null
): Promise<{ cle: forge.pki.PrivateKey; source: "fichier" | "coffre" } | null> {
  if (!ligne) return null;
  if (ligne.certCleChemin) {
    const octets = await lireFichierStocke(ligne.certCleChemin);
    if (octets) {
      try {
        const infos = await parserClePrivee(
          ligne.certCleFichierNom || "cle-privee.pem",
          octets,
          ligne.certCleMotDePasse || undefined
        );
        return { cle: infos.cle, source: "fichier" };
      } catch {
        /* clé stockée illisible (fichier remplacé ?) — tenter le coffre */
      }
    }
  }
  const ext = String(ligne.certFichierNom ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if ((ext === "p12" || ext === "pfx") && ligne.certChemin) {
    const octets = await lireFichierStocke(ligne.certChemin);
    if (octets) {
      const cle = extraireClePriveePkcs12(octets, ligne.certMotDePasse || undefined);
      if (cle) return { cle, source: "coffre" };
    }
  }
  return null;
}

/** Copie de contrôle CHIFFRÉE d'un fichier de clé privée importé
 * (storage/tampons/cle-privee-… — même discipline que les certificats). */
async function exporterCopieClePrivee(
  octets: Buffer,
  nomOrigine: string,
  prefixe = "cle-privee"
): Promise<string> {
  try {
    if (!octets.length) return "";
    const extBrute = String(nomOrigine ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
    const ext = estExtensionClePrivee(nomOrigine) ? extBrute : "bin";
    const dir = getTamponsDir();
    await assurerDossierPrive(dir);
    const horodatage = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, "")
      .slice(0, 14);
    const nom = `${prefixe}-${horodatage}.${ext}`;
    await writeFile(path.join(dir, nom), encryptForStorage(octets), { mode: 0o600 });
    return `storage/tampons/${nom}`;
  } catch (e) {
    console.error("[SIGNATURE-CONFIG] copie clé privée non écrite:", e);
    return "";
  }
}

const VIDE_CLE = {
  certCleChemin: "",
  certCleFichierNom: "",
  certCleType: "",
  certCleMotDePasse: "",
  certCleImportLe: null as Date | null,
};

/**
 * Traitement partagé CERTIFICAT + CLÉ PRIVÉE d'un corps PUT (les deux scopes).
 * Renvoie { erreur: { message, status } } en cas de refus, sinon les champs à
 * écrire (cert* et certCle*) et l'objet certificat forge éventuellement
 * importé (pour la continuité des autres traitements).
 */
async function traiterCertificatEtCle(
  corps: Record<string, unknown>,
  opts: { prefixeCert: string; prefixeCle: string; ligne: LigneCertCfg | null }
): Promise<{
  erreur?: { message: string; status: number };
  champs: Record<string, unknown>;
  certForge?: { cert: forge.pki.Certificate; format: string; total: number };
}> {
  const champs: Record<string, unknown> = {};
  let certForge: { cert: forge.pki.Certificate; format: string; total: number } | undefined;

  // ---------- 1) CERTIFICAT (champ certFichier : présent = remplacé) ----------
  if ("certFichier" in corps) {
    const brut = String(corps.certFichier ?? "").replace(/\s+/g, "");
    if (brut === "") {
      // Retrait : métadonnées + clé privée associée (même custody — la clé
      // stockée ne concerne plus aucun certificat).
      Object.assign(champs, {
        certFormat: "",
        certFichierNom: "",
        certChemin: "",
        certSujet: "",
        certEmetteur: "",
        certSerie: "",
        certValideDu: null,
        certValideAu: null,
        certEmpreinte: "",
        certImportLe: null,
        certMotDePasse: "",
        ...VIDE_CLE,
      });
    } else if (!/^[A-Za-z0-9+/=]+$/.test(brut)) {
      return {
        erreur: { message: "Fichier de signature électronique invalide (contenu base64 attendu).", status: 400 },
        champs,
      };
    } else if (brut.length > TAILLE_CERT_BASE64_MAX) {
      return {
        erreur: { message: "Fichier de signature électronique trop grand (8 Mo maximum).", status: 400 },
        champs,
      };
    } else {
      const nom = nomFichierAffichable(corps.certFichierNom);
      if (!estExtensionCertificat(nom)) {
        return {
          erreur: {
            message:
              "Format de signature électronique non pris en charge. Formats acceptés : .pkcs7, .p7s, .p7m, .xml, .ps7x, .p12, .pfx, .p7b, .p7c, .pem, .cer, .crt, .der.",
            status: 400,
          },
          champs,
        };
      }
      const octets = Buffer.from(brut, "base64");
      const mdp = corps.certMotDePasse ? String(corps.certMotDePasse) : undefined;
      try {
        certForge = await extraireCertificatForge(nom, octets, mdp);
        champs.certFormat = certForge.format;
        champs.certFichierNom = nom;
        champs.certSujet = certForge.cert.subject.attributes
          .map((a) => `${a.shortName || a.name}=${String(a.value)}`)
          .join(", ")
          .slice(0, 300);
        champs.certEmetteur = certForge.cert.issuer.attributes
          .map((a) => `${a.shortName || a.name}=${String(a.value)}`)
          .join(", ")
          .slice(0, 300);
        champs.certSerie = String(certForge.cert.serialNumber || "").toUpperCase().slice(0, 100);
        champs.certValideDu = new Date(certForge.cert.validity.notBefore.getTime());
        champs.certValideAu = new Date(certForge.cert.validity.notAfter.getTime());
        champs.certEmpreinte = empreinteSha256Certificat(certForge.cert);
        champs.certImportLe = new Date();
        champs.certChemin = await exporterCopieCertificat(octets, nom, opts.prefixeCert);
        champs.certMotDePasse = mdp ?? "";
        // Coffre .p12/.pfx = clé privée INCLUSE : la clé séparée précédente
        // devient obsolète — sauf si un NOUVEAU fichier de clé est fourni dans
        // la MÊME requête (traité ci-dessous, revalidé contre ce certificat).
        const extNom = nom.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
        if ((extNom === "p12" || extNom === "pfx") && !("certCleFichier" in corps)) {
          Object.assign(champs, VIDE_CLE);
        }
      } catch (e) {
        return {
          erreur: { message: (e as Error).message || "Fichier de signature électronique illisible.", status: 400 },
          champs,
        };
      }
    }
  }

  const cleFichierFournie =
    "certCleFichier" in corps && String(corps.certCleFichier ?? "").replace(/\s+/g, "") !== "";
  const coffreImporte = (() => {
    const ext = String(champs.certFichierNom ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
    return ext === "p12" || ext === "pfx";
  })();

  // ---------- 2) CLÉ PRIVÉE SÉPARÉE (champ certCleFichier) ----------
  if ("certCleFichier" in corps) {
    const brutCle = String(corps.certCleFichier ?? "").replace(/\s+/g, "");
    if (brutCle === "") {
      // Retrait explicite de la clé privée séparée (le coffre éventuel garde
      // la sienne — certClePriveeDisponible reste calculé sur le coffre).
      Object.assign(champs, VIDE_CLE);
    } else if (!/^[A-Za-z0-9+/=]+$/.test(brutCle)) {
      return {
        erreur: { message: "Fichier de clé privée invalide (contenu base64 attendu).", status: 400 },
        champs,
      };
    } else if (brutCle.length > TAILLE_CERT_BASE64_MAX) {
      return {
        erreur: { message: "Fichier de clé privée trop grand (8 Mo maximum).", status: 400 },
        champs,
      };
    } else {
      const nomCle = nomFichierAffichable(corps.certCleFichierNom);
      if (!estExtensionClePrivee(nomCle)) {
        return {
          erreur: {
            message:
              "Format de clé privée non pris en charge. Formats acceptés : .pem, .key, .der (PKCS#8 ou PKCS#1 — clair ou chiffré).",
            status: 400,
          },
          champs,
        };
      }
      const octetsCle = Buffer.from(brutCle, "base64");
      const mdpCle = corps.certCleMotDePasse ? String(corps.certCleMotDePasse) : undefined;
      try {
        const infos = await parserClePrivee(nomCle, octetsCle, mdpCle);
        // Appariement contre le certificat (importé DANS CETTE requête, sinon
        // le certificat déjà enregistré) — jamais d'association aveugle.
        const cible = certForge ?? (await chargerCertForgeSection(opts.ligne));
        if (cible) {
          const verdict = cleCorrespondAuCertificat(infos.cle, cible.cert);
          if (verdict === false) {
            return {
              erreur: {
                message:
                  "La clé privée importée ne correspond pas au certificat (appariement cryptographique négatif) : vérifiez que le fichier de clé et le certificat forment bien la même paire.",
                status: 400,
              },
              champs,
            };
          }
        }
        champs.certCleChemin = await exporterCopieClePrivee(octetsCle, nomCle, opts.prefixeCle);
        champs.certCleFichierNom = nomCle;
        champs.certCleType = infos.bits ? `${infos.type} ${infos.bits} bits` : infos.type;
        champs.certCleMotDePasse = mdpCle ?? "";
        champs.certCleImportLe = new Date();
      } catch (e) {
        return { erreur: { message: (e as Error).message || "Fichier de clé privée illisible.", status: 400 }, champs };
      }
    }
  }

  // ---------- 3) PEM COMBINÉ (CERTIFICATE + PRIVATE KEY dans le MÊME fichier)
  // Un .pem importé comme certificat peut embarquer SA clé privée : extraite
  // AUTOMATIQUEMENT, validée (appariement obligatoire) et enregistrée.
  if (certForge && !coffreImporte && !cleFichierFournie) {
    try {
      const cheminImporte = String(champs.certChemin ?? "");
      if (certForge.format === "X.509" && cheminImporte) {
        const octetsCert = await lireFichierStocke(cheminImporte);
        const blocCle = (() => {
          try {
            const texte = octetsCert?.toString("utf8") ?? "";
            return forge.pem.decode(texte).find((b) =>
              ["PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY", "ENCRYPTED PRIVATE KEY"].includes(b.type)
            );
          } catch {
            return null;
          }
        })();
        if (blocCle) {
          const pemCle = forge.pem.encode(blocCle);
          const infos = await parserClePrivee(
            "cle-embarquee.pem",
            Buffer.from(pemCle, "utf8"),
            corps.certMotDePasse ? String(corps.certMotDePasse) : undefined
          );
          const verdict = cleCorrespondAuCertificat(infos.cle, certForge.cert);
          if (verdict === false) {
            return {
              erreur: {
                message:
                  "Le fichier PEM contient un certificat ET une clé privée qui ne correspondent PAS (appariement cryptographique négatif) : vérifiez le fichier.",
                status: 400,
              },
              champs,
            };
          }
          champs.certCleChemin = await exporterCopieClePrivee(
            Buffer.from(pemCle, "utf8"),
            "cle-embarquee.pem",
            opts.prefixeCle
          );
          champs.certCleFichierNom = nomFichierAffichable(champs.certFichierNom) + " (clé embarquée)";
          champs.certCleType = infos.bits ? `${infos.type} ${infos.bits} bits` : infos.type;
          champs.certCleMotDePasse = ""; // clé claire extraite du PEM
          champs.certCleImportLe = new Date();
        }
      }
    } catch (e) {
      // un PEM combiné illisible ne doit JAMAIS bloquer un certificat valide :
      // l'erreur n'est levée ici que si parserClePrivee a explicitement refusé
      // un bloc de clé ANNONCÉ — dans ce cas la demande est rejetée.
      return { erreur: { message: (e as Error).message, status: 400 }, champs };
    }
  }

  // ---------- 4) CERTIFICAT SEUL ↔ CLÉ DÉJÀ DISPONIBLE (association vérifiée)
  // Le certificat importé SEUL (hors coffre, sans clé fournie ni clé embarquée)
  // est accepté quand la clé privée est DÉJÀ DISPONIBLE dans le système —
  // l'association est VÉRIFIÉE par appariement cryptographique ; négatif →
  // erreur explicite (jamais d'association aveugle), positif → la clé est
  // CONSERVÉE (et, si elle venait d'un ancien coffre remplacé, elle est
  // ré-enregistrée comme fichier de clé pour survivre au remplacement).
  if (certForge && !coffreImporte && !cleFichierFournie && !champs.certCleChemin) {
    const cleStockee = await chargerCleForgeSection(opts.ligne);
    if (cleStockee) {
      const verdict = cleCorrespondAuCertificat(cleStockee.cle, certForge.cert);
      if (verdict === false) {
        return {
          erreur: {
            message:
              "Le certificat importé ne correspond pas à la clé privée déjà disponible dans le système (appariement cryptographique négatif) : importez le certificat AVEC sa clé privée (.p12/.pfx ou .pem/.key), ou retirez d'abord la clé privée enregistrée.",
            status: 400,
          },
          champs,
        };
      }
      if (cleStockee.source === "coffre") {
        // l'ancien coffre est remplacé par ce certificat seul : la clé est
        // ré-enregistrée comme fichier de clé (l'association survit).
        try {
          const pemCle = forge.pki.privateKeyToPem(cleStockee.cle).toString("utf8");
          champs.certCleChemin = await exporterCopieClePrivee(
            Buffer.from(pemCle, "utf8"),
            "cle-associee.pem",
            opts.prefixeCle
          );
          champs.certCleFichierNom = "clé privée associée au certificat précédent (.pem)";
          const bits = (cleStockee.cle as { n?: { bitLength?: () => number } }).n?.bitLength?.() ?? null;
          champs.certCleType = bits ? `RSA ${bits} bits` : "clé asymétrique";
          champs.certCleMotDePasse = ""; // ré-exportée en clair chiffré au repos
          champs.certCleImportLe = new Date();
        } catch {
          /* ré-export impossible : association conservée en mémoire uniquement */
        }
      }
      // source "fichier" : les champs certCle* existants sont inchangés.
    }
  }

  return { champs, certForge };
}

/** Empreinte SHA-256 (hex) du certificat forge (jumelle stamp/affichage). */
function empreinteSha256Certificat(cert: forge.pki.Certificate): string {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).data;
  const md = forge.md.sha256.create();
  md.update(der);
  return md.digest().toHex();
}

function filtrer(v: unknown, autorises: string[], defaut: string): string {
  return autorises.includes(String(v)) ? String(v) : defaut;
}

function borner(n: unknown, min: number, max: number, defaut: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return defaut;
  return Math.round(Math.max(min, Math.min(max, x)));
}

async function lireOuCreer() {
  return (
    (await db.signatureConfig.findUnique({ where: { id: "signature" } })) ??
    (await db.signatureConfig.create({ data: { id: "signature" } }))
  );
}

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  // (MODIFIÉ Task 176) le rôle IT n'a PLUS accès à la configuration du
  // tampon et de la signature électronique — réservée aux rôles RH et
  // superadministrateur (403 dédié, même discipline que les autres
  // fonctionnalités retirées à l'IT).
  if (session.role === "IT")
    return refusIT("La configuration du tampon et de la signature électronique");
  if (session.role !== "RH" && !estSuperadmin(session))
    return Response.json(
      { error: "Accès refusé : la signature électronique et le tampon sont réservés aux rôles RH et superadministrateur." },
      { status: 403 }
    );
  // (NOUVEAU v0.2.93) scope=reponse → configuration de la SECTION
  // « Demandes / Réponses » (table SignatureConfigReponse) : champs
  // éditables PROPRES + actifs partagés (images, métadonnées certificat)
  // pour l'aperçu interactif. `source` indique d'où viennent les valeurs :
  // "reponse" = ligne enregistrée ; "import" = copie de la configuration
  // Import (ligne pas encore créée — continuité historique).
  const scope = request.nextUrl.searchParams.get("scope") ?? "";
  if (scope === "reponse") {
    const vue = await lireConfigReponse();
    // (MODIFIÉ v0.2.99) assemblage selon la SOURCE :
    //  - source=reponse : la configuration DÉDIÉE prime — certificat DÉDIÉ
    //    compris (métadonnées de la ligne réponses) ; seules les IMAGES
    //    partagées (signature/cachet, QR fourni) viennent de l'Import ;
    //  - source=import (ligne pas encore créée) : affichage de continuité —
    //    les métadonnées du certificat « Import » HÉRITÉ complètent la copie
    //    (comportement actuel du mode Automatique).
    // Le mot de passe du certificat (chiffré en base) n'est JAMAIS renvoyé.
    const valeurs = vue.valeurs as unknown as Record<string, unknown>;
    const actifs = vue.actifs as unknown as Record<string, unknown>;
    const config =
      vue.source === "reponse"
        ? {
            ...valeurs,
            sigImage: actifs.sigImage,
            sigImageNom: actifs.sigImageNom,
            qrImage: actifs.qrImage,
            qrImageNom: actifs.qrImageNom,
          }
        : { ...valeurs, ...actifs };
    return NextResponse.json({
      config: sansMotDePasse(config),
      tamponActif: vue.tamponActifReponses,
      source: vue.source,
    });
  }
  const cfg = await lireOuCreer();
  // (MODIFIÉ v0.2.137) BUG « AUCUN ÉLÉMENT DU TAMPON N'EST ACTIVÉ » : le
  // cachet « Signature électronique » (elecActif) n'est JAMAIS stocké avec
  // ses métadonnées — elec est injecté au moment du servage par
  // completerConfigTamponAvecElec. tamponActif() sur la config brute
  // répondait donc FAUX dès que le cachet était le seul élément actif.
  // On juge désormais sur la config COMPLÉTÉE (mêmes conditions que le
  // rendu réel) ; la config renvoyée reste inchangée (sans elec).
  const cfgJugee = (await completerConfigTamponAvecElec(cfg, "FICHES")) as typeof cfg;
  return NextResponse.json({
    config: sansMotDePasse(cfg as unknown as Record<string, unknown>),
    tamponActif: tamponActif(cfgJugee),
  });
}

export async function PUT(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  // (MODIFIÉ Task 176) IT → 403 (voir GET).
  if (session.role === "IT")
    return refusIT("La configuration du tampon et de la signature électronique");
  if (session.role !== "RH" && !estSuperadmin(session))
    return Response.json(
      { error: "Accès refusé : la signature électronique et le tampon sont réservés aux rôles RH et superadministrateur." },
      { status: 403 }
    );
  try {
    const corps = await request.json().catch(() => ({}));
    // (NOUVEAU v0.2.93) scope=reponse → ENREGISTREMENT de la configuration
    // de la SECTION « Demandes / Réponses » (table SignatureConfigReponse) :
    // mêmes validations/bornes que la configuration Import ; les champs
    // d'ACTIFS partagés (sigImage/qrImage et leurs noms) sont IGNORÉS —
    // ils restent la propriété exclusive de la section Import.
    // (MODIFIÉ v0.2.99) le CERTIFICAT est désormais DÉDIÉ : certFichier /
    // certFichierNom / certMotDePasse sont traités ICI (fichier validé par
    // son contenu, copie CHIFFRÉE distincte certificat-reponse-…, mot de
    // passe stocké CHIFFRÉ pour cette section seule) — aucune écriture
    // croisée : la configuration « Import » n'est jamais touchée, et
    // inversement.
    if (String(corps.scope ?? "") === "reponse") {
      const dataRep: Record<string, unknown> = {
        actif: Boolean(corps.actif),
        sigActif: Boolean(corps.sigActif),
        sigTexte: String(corps.sigTexte ?? "").slice(0, 300),
        sigPosition: filtrer(corps.sigPosition, POSITIONS, "BAS_DROITE"),
        sigTaille: borner(corps.sigTaille, TAILLE_MIN, TAILLE_MAX, 120),
        sigOpacite: Math.max(0.3, Math.min(1, Number(corps.sigOpacite) || 0.9)),
        qrActif: Boolean(corps.qrActif),
        // (MODIFIÉ v0.2.97 — demande utilisateur) mode FICHE ADMIS pour les
        // réponses : « Fiche en ligne » — le QR encode l'adresse publique de
        // vérification de la réponse ({qrUrl}/verification/reponse/{réf}?t=
        // {jeton signé}, page publique « Réponse authentique »). Jusqu'ici
        // cette URL était FORCÉE dès que qrUrl était renseignée (v0.2.88) ;
        // elle devient le COMPORTEMENT DU MODE FICHE, choisi explicitement —
        // les autres modes (DONNEES/URL/TEXTE/IMAGE) retrouvent leur sens
        // propre. DONNEES/URL/FICHE/TEXTE/IMAGE comme pour les fiches.
        qrMode: filtrer(corps.qrMode, ["DONNEES", "URL", "FICHE", "TEXTE", "IMAGE"], "DONNEES"),
        qrUrl: String(corps.qrUrl ?? "").slice(0, 500),
        qrTexte: String(corps.qrTexte ?? "").slice(0, 500),
        qrPosition: filtrer(corps.qrPosition, POSITIONS, "BAS_GAUCHE"),
        qrTaille: borner(corps.qrTaille, TAILLE_MIN, TAILLE_MAX, 110),
        sigDecalX: borner(corps.sigDecalX, DECAL_MIN, DECAL_MAX, 0),
        sigDecalY: borner(corps.sigDecalY, DECAL_MIN, DECAL_MAX, 0),
        qrDecalX: borner(corps.qrDecalX, DECAL_MIN, DECAL_MAX, 0),
        qrDecalY: borner(corps.qrDecalY, DECAL_MIN, DECAL_MAX, 0),
        sigRotation: borner(corps.sigRotation, 0, 360, 0),
        qrRotation: borner(corps.qrRotation, 0, 360, 0),
        mentionActif: Boolean(corps.mentionActif),
        mentionTexte: String(corps.mentionTexte ?? "").slice(0, 300),
        certActif: Boolean(corps.certActif),
        certPosition: filtrer(corps.certPosition, POSITIONS_CERT, "BAS_CENTRE"),
        certDecalX: borner(corps.certDecalX, DECAL_MIN, DECAL_MAX, 0),
        certDecalY: borner(corps.certDecalY, DECAL_MIN, DECAL_MAX, 0),
        certTaille: borner(corps.certTaille, CERT_TAILLE_MIN, CERT_TAILLE_MAX, 100),
        // (NOUVEAU v0.2.119) cachet « Signature électronique » du tampon —
        // alimenté EN DIRECT par le certificat du module (SignatureApiConfig,
        // onglet Paramètres) : seuls les interrupteurs/placement sont stockés.
        elecActif: Boolean(corps.elecActif),
        elecPosition: filtrer(corps.elecPosition, POSITIONS_CERT, "BAS_DROITE"),
        elecDecalX: borner(corps.elecDecalX, DECAL_MIN, DECAL_MAX, 0),
        elecDecalY: borner(corps.elecDecalY, DECAL_MIN, DECAL_MAX, 0),
        elecTaille: borner(corps.elecTaille, CERT_TAILLE_MIN, CERT_TAILLE_MAX, 100),
        // (NOUVEAU v0.2.120) forme du cachet : RECTANGLE (historique) | ROND
        elecForme: filtrer(corps.elecForme, ["RECTANGLE", "ROND"], "RECTANGLE"),
        // (NOUVEAU v0.2.128) CONTENU du cachet — formulaire de choix des
        // informations affichées (défaut : AUCUNE information du certificat).
        elecAffSignataire: Boolean(corps.elecAffSignataire),
        elecAffOrganisation: Boolean(corps.elecAffOrganisation),
        elecAffEmetteur: Boolean(corps.elecAffEmetteur),
        elecAffValidite: Boolean(corps.elecAffValidite),
        elecAffEmpreinte: Boolean(corps.elecAffEmpreinte),
        elecTexteLibre: String(corps.elecTexteLibre ?? "").slice(0, 120),
      };
      // (NOUVEAU v0.2.99) CERTIFICAT DÉDIÉ des réponses — même contrat que la
      // section Import : champ certFichier PRÉSENT = remplacé ("" = retiré ;
      // absent = inchangé). Le fichier est validé PAR SON CONTENU (ASN.1/
      // PEM/XML + mot de passe PKCS#12 éventuel), copié CHIFFRÉ sous un nom
      // DÉDIÉ (certificat-reponse-…) et son mot de passe stocké CHIFFRÉ pour
      // CETTE section. Toute action dédiée explicite (import OU retrait)
      // lève le marqueur de continuité certHeriteImport : la copie unique du
      // certificat « Import » ne pourra plus se déclencher (un retrait n'est
      // jamais annulé, une modification Import ne coule jamais ici).
      // (MODIFIÉ Task 222) le traitement est PARTAGÉ avec la section Import
      // (traiterCertificatEtCle) : certificat SEUL accepté quand la clé
      // privée est déjà disponible dans le système (association VÉRIFIÉE),
      // clé privée séparée .pem/.key/.der, PEM combiné, erreurs classées.
      if ("certFichier" in corps || "certCleFichier" in corps) {
        if ("certFichier" in corps) dataRep.certHeriteImport = true;
        const resultatRep = await traiterCertificatEtCle(corps, {
          prefixeCert: "certificat-reponse",
          prefixeCle: "cle-privee-reponse",
          ligne: (await lireLigneReponseAvecContinuite()) as unknown as LigneCertCfg | null,
        });
        if (resultatRep.erreur) {
          return NextResponse.json({ error: resultatRep.erreur.message }, { status: resultatRep.erreur.status });
        }
        Object.assign(dataRep, resultatRep.champs);
      }
      const rep = await db.signatureConfigReponse.upsert({
        where: { id: "signature-reponse" },
        update: dataRep,
        create: { id: "signature-reponse", ...dataRep },
      });
      // (MODIFIÉ v0.2.137) même correctif que le PUT « fiches » : le jugement
      // tient compte des métadonnées elec injectées au rendu (périmètre
      // RÉPONSES) — sans quoi le cachet « Signature électronique » seul ne
      // comptait pas comme élément actif.
      const repJugee = (await completerConfigTamponAvecElec(
        rep as unknown as Partial<ConfigTampon>,
        "REPONSES"
      )) as Partial<ConfigTampon>;
      return NextResponse.json({
        config: sansMotDePasse(rep as unknown as Record<string, unknown>),
        tamponActif: tamponActif(repJugee),
        source: "reponse",
      });
    }
    const data: Record<string, unknown> = {
      actif: Boolean(corps.actif),
      sigActif: Boolean(corps.sigActif),
      sigTexte: String(corps.sigTexte ?? "").slice(0, 300),
      sigPosition: filtrer(corps.sigPosition, POSITIONS, "BAS_DROITE"),
      sigTaille: borner(corps.sigTaille, TAILLE_MIN, TAILLE_MAX, 120),
      sigOpacite: Math.max(0.3, Math.min(1, Number(corps.sigOpacite) || 0.9)),
      qrActif: Boolean(corps.qrActif),
      qrMode: filtrer(corps.qrMode, MODES_QR, "DONNEES"),
      qrUrl: String(corps.qrUrl ?? "").slice(0, 500),
      qrTexte: String(corps.qrTexte ?? "").slice(0, 500),
      qrPosition: filtrer(corps.qrPosition, POSITIONS, "BAS_GAUCHE"),
      qrTaille: borner(corps.qrTaille, TAILLE_MIN, TAILLE_MAX, 110),
      sigDecalX: borner(corps.sigDecalX, DECAL_MIN, DECAL_MAX, 0),
      sigDecalY: borner(corps.sigDecalY, DECAL_MIN, DECAL_MAX, 0),
      qrDecalX: borner(corps.qrDecalX, DECAL_MIN, DECAL_MAX, 0),
      qrDecalY: borner(corps.qrDecalY, DECAL_MIN, DECAL_MAX, 0),
      // (NOUVEAU 0.2.54) rotations : degrés horaires 0 → 360
      sigRotation: borner(corps.sigRotation, 0, 360, 0),
      qrRotation: borner(corps.qrRotation, 0, 360, 0),
      mentionActif: Boolean(corps.mentionActif),
      mentionTexte: String(corps.mentionTexte ?? "").slice(0, 300),
      // (NOUVEAU v0.2.88) Switch du certificat de signature — persisté tel
      // quel : le certificat importé (Task 181) est appliqué aux documents
      // UNIQUEMENT quand certActif est vrai.
      certActif: Boolean(corps.certActif),
      // (NOUVEAU v0.2.92) POSITIONNEMENT LIBRE du bloc certificat — mêmes
      // bornes que les autres éléments (défaut BAS_CENTRE = rendu historique).
      certPosition: filtrer(corps.certPosition, POSITIONS_CERT, "BAS_CENTRE"),
      certDecalX: borner(corps.certDecalX, DECAL_MIN, DECAL_MAX, 0),
      certDecalY: borner(corps.certDecalY, DECAL_MIN, DECAL_MAX, 0),
      certTaille: borner(corps.certTaille, CERT_TAILLE_MIN, CERT_TAILLE_MAX, 100),
      // (NOUVEAU v0.2.119) cachet « Signature électronique » du tampon —
      // alimenté EN DIRECT par le certificat du module (SignatureApiConfig,
      // onglet Paramètres) : seuls les interrupteurs/placement sont stockés.
      elecActif: Boolean(corps.elecActif),
      elecPosition: filtrer(corps.elecPosition, POSITIONS_CERT, "BAS_DROITE"),
      elecDecalX: borner(corps.elecDecalX, DECAL_MIN, DECAL_MAX, 0),
      elecDecalY: borner(corps.elecDecalY, DECAL_MIN, DECAL_MAX, 0),
      elecTaille: borner(corps.elecTaille, CERT_TAILLE_MIN, CERT_TAILLE_MAX, 100),
      // (NOUVEAU v0.2.120) forme du cachet : RECTANGLE (historique) | ROND
      elecForme: filtrer(corps.elecForme, ["RECTANGLE", "ROND"], "RECTANGLE"),
      // (NOUVEAU v0.2.128) CONTENU du cachet — formulaire de choix des
      // informations affichées (défaut : AUCUNE information du certificat).
      elecAffSignataire: Boolean(corps.elecAffSignataire),
      elecAffOrganisation: Boolean(corps.elecAffOrganisation),
      elecAffEmetteur: Boolean(corps.elecAffEmetteur),
      elecAffValidite: Boolean(corps.elecAffValidite),
      elecAffEmpreinte: Boolean(corps.elecAffEmpreinte),
      elecTexteLibre: String(corps.elecTexteLibre ?? "").slice(0, 120),
    };

    // Image de signature : remplacée/supprimée UNIQUEMENT si le champ est
    // présent (l'interface renvoie toujours dataURL | "" ; jamais absent).
    // (NOUVEAU 0.2.58) le nom du fichier d'origine et le chemin de la copie
    // de contrôle (storage/tampons/) suivent l'image : effacés avec elle,
    // remplacés avec elle — jamais modifiés sans elle.
    if ("sigImage" in corps) {
      const img = String(corps.sigImage ?? "");
      if (img === "") {
        data.sigImage = "";
        data.sigImageNom = "";
        data.sigImageChemin = "";
      } else if (/^data:image\/(png|jpe?g);base64,/.test(img) && img.length <= TAILLE_IMAGE_MAX) {
        data.sigImage = img;
        data.sigImageNom = nomFichierAffichable(corps.sigImageNom);
        data.sigImageChemin = await exporterCopieTampon(img, "signature");
      } else if (!img) {
        data.sigImage = "";
        data.sigImageNom = "";
        data.sigImageChemin = "";
      } else {
        return NextResponse.json(
          { error: "Image de signature invalide (PNG ou JPEG attendu, 8 Mo maximum)." },
          { status: 400 }
        );
      }
    }

    // (NOUVEAU 0.2.47) Image du QR FOURNI (mode IMAGE) : mêmes règles que
    // l'image de signature — présente = remplacée ("" = retirée).
    // (NOUVEAU 0.2.58) nom d'origine + copie de contrôle storage/tampons/,
    // exactement comme l'image de signature.
    if ("qrImage" in corps) {
      const img = String(corps.qrImage ?? "");
      if (img === "" || !img) {
        data.qrImage = "";
        data.qrImageNom = "";
        data.qrImageChemin = "";
      } else if (/^data:image\/(png|jpe?g);base64,/.test(img) && img.length <= TAILLE_IMAGE_MAX) {
        data.qrImage = img;
        data.qrImageNom = nomFichierAffichable(corps.qrImageNom);
        data.qrImageChemin = await exporterCopieTampon(img, "qr");
      } else {
        return NextResponse.json(
          { error: "Image de QR invalide (PNG ou JPEG attendu, 8 Mo maximum)." },
          { status: 400 }
        );
      }
    }

    // (NOUVEAU Task 181) CERTIFICAT DE SIGNATURE ÉLECTRONIQUE : import en
    // formats professionnels .pkcs7, .p7s, .p7m, .xml, .ps7x, .p12, .pfx
    // (+ .p7b/.p7c/.pem/.cer/.crt/.der). Champ présent = remplacé
    // ("" = retiré ; absent = inchangé, comme pour les images). Le fichier
    // est validé PAR SON CONTENU — sniff ASN.1/PEM/XML + mot de passe
    // PKCS#12 éventuel (certMotDePasse) — et NULLE part en clair : seules
    // les métadonnées publiques extraites vont en base, le fichier complet
    // est copié CHIFFRÉ dans storage/tampons/ (exporterCopieCertificat).
    // (MODIFIÉ Task 222) traitement PARTAGÉ (traiterCertificatEtCle) :
    // certificat SEUL accepté quand la clé privée est déjà disponible dans
    // le système (association VÉRIFIÉE par appariement cryptographique),
    // clé privée séparée .pem/.key/.der (PKCS#8/PKCS#1, claire ou chiffrée),
    // PEM combiné (certificat + clé embarquée) reconnu, erreurs classées.
    if ("certFichier" in corps || "certCleFichier" in corps) {
      const resultatImport = await traiterCertificatEtCle(corps, {
        prefixeCert: "certificat",
        prefixeCle: "cle-privee",
        ligne: (await db.signatureConfig.findUnique({ where: { id: "signature" } })) as unknown as LigneCertCfg | null,
      });
      if (resultatImport.erreur) {
        return NextResponse.json({ error: resultatImport.erreur.message }, { status: resultatImport.erreur.status });
      }
      Object.assign(data, resultatImport.champs);
    }

    const cfg = await db.signatureConfig.upsert({
      where: { id: "signature" },
      update: data,
      create: { id: "signature", ...data },
    });
    // (MODIFIÉ v0.2.137) JUGEMENT DU TAMPON SUR LA CONFIG COMPLÉTÉE : les
    // métadonnées du cachet « Signature électronique » (elec) sont injectées
    // au moment du rendu — jamais stockées en base. Sans injection,
    // tamponActif() répondait FAUX quand le cachet était le SEUL élément
    // actif et l'interface affichait à tort « Aucun élément du tampon n'est
    // activé » alors que le cachet s'appliquerait réellement aux fiches.
    // elecCouvert signale à l'interface si les conditions du module de
    // signature sont réunies (module actif + certificat chargé + couverture
    // fiches) afin d'afficher un message PRÉCIS dans le cas contraire.
    // (CORRECTIF v0.2.201) : on NE caste PLUS en `typeof cfg` car cela
    // supprimait la propriété `elec` ajoutée par completerConfigTamponAvecElec.
    // Le type de retour inclut désormais `elec?` (voir signature-api.ts).
    const cfgJugee = await completerConfigTamponAvecElec(cfg, "FICHES");
    return NextResponse.json({
      config: sansMotDePasse(cfg as unknown as Record<string, unknown>),
      tamponActif: tamponActif(cfgJugee),
      elecCouvert: Boolean(cfgJugee.elec),
    });
  } catch (error) {
    console.error("[SIGNATURE-CONFIG] PUT:", error);
    return NextResponse.json({ error: "Enregistrement impossible." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  // (MODIFIÉ Task 176) IT → 403 (voir GET) — l'aperçu tamponné aussi.
  if (session.role === "IT")
    return refusIT("La configuration du tampon et de la signature électronique");
  if (session.role !== "RH" && !estSuperadmin(session))
    return Response.json(
      { error: "Accès refusé : la signature électronique et le tampon sont réservés aux rôles RH et superadministrateur." },
      { status: 403 }
    );
  try {
    const corps = await request.json().catch(() => ({}));
    if (String(corps.action ?? "") !== "apercu") {
      return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
    }
    // (NOUVEAU v0.2.93) APERÇU de la SECTION « Demandes / Réponses » :
    // la configuration RÉPONSES fournie (formulaire, non enregistrée) est
    // fusionnée avec les ACTIFS partagés (images + métadonnées certificat
    // de la configuration Import) et appliquée à un document de réponse
    // d'exemple (PDF synthétique « RÉPONSE À UNE DEMANDE »).
    if (String(corps.scope ?? "") === "reponse") {
      const vue = await lireConfigReponse();
      const cfgRep: ConfigReponse = {
        ...vue.valeurs,
        actif: true, // l'aperçu force l'activation (c'est son but)
        sigActif: Boolean(corps.sigActif),
        sigTexte: String(corps.sigTexte ?? "").slice(0, 300),
        sigPosition: filtrer(corps.sigPosition, POSITIONS, "BAS_DROITE"),
        sigTaille: borner(corps.sigTaille, TAILLE_MIN, TAILLE_MAX, 120),
        sigOpacite: Math.max(0.3, Math.min(1, Number(corps.sigOpacite) || 0.9)),
        qrActif: Boolean(corps.qrActif),
        // (MODIFIÉ v0.2.98 — correctif) « FICHE » était ABSENT de ce filtre :
        // l'aperçu de la section Demandes/Réponses dégradait silencieusement
        // le mode « Fiche en ligne » en « Données » — le QR de l'aperçu
        // encodait la carte de données au lieu de l'URL publique de
        // vérification de la réponse. Même liste que le PUT (ligne +).
        qrMode: filtrer(corps.qrMode, ["DONNEES", "URL", "FICHE", "TEXTE", "IMAGE"], "DONNEES"),
        qrUrl: String(corps.qrUrl ?? "").slice(0, 500),
        qrTexte: String(corps.qrTexte ?? "").slice(0, 500),
        qrPosition: filtrer(corps.qrPosition, POSITIONS, "BAS_GAUCHE"),
        qrTaille: borner(corps.qrTaille, TAILLE_MIN, TAILLE_MAX, 110),
        sigDecalX: borner(corps.sigDecalX, DECAL_MIN, DECAL_MAX, 0),
        sigDecalY: borner(corps.sigDecalY, DECAL_MIN, DECAL_MAX, 0),
        qrDecalX: borner(corps.qrDecalX, DECAL_MIN, DECAL_MAX, 0),
        qrDecalY: borner(corps.qrDecalY, DECAL_MIN, DECAL_MAX, 0),
        sigRotation: borner(corps.sigRotation, 0, 360, 0),
        qrRotation: borner(corps.qrRotation, 0, 360, 0),
        mentionActif: Boolean(corps.mentionActif),
        mentionTexte: String(corps.mentionTexte ?? "").slice(0, 300),
        certActif:
          corps.certActif !== undefined
            ? Boolean(corps.certActif)
            : vue.valeurs.certActif,
        certPosition: filtrer(corps.certPosition, POSITIONS_CERT, "BAS_CENTRE"),
        certDecalX: borner(corps.certDecalX, DECAL_MIN, DECAL_MAX, 0),
        certDecalY: borner(corps.certDecalY, DECAL_MIN, DECAL_MAX, 0),
        certTaille: borner(corps.certTaille, CERT_TAILLE_MIN, CERT_TAILLE_MAX, 100),
        // (NOUVEAU v0.2.119) cachet « Signature électronique » dans l'aperçu
        // — le contenu (métadonnées du certificat du module) est injecté
        // juste après la fusion, comme au rendu réel.
        elecActif:
          corps.elecActif !== undefined
            ? Boolean(corps.elecActif)
            : vue.valeurs.elecActif,
        elecPosition: filtrer(corps.elecPosition, POSITIONS_CERT, "BAS_DROITE"),
        elecDecalX: borner(corps.elecDecalX, DECAL_MIN, DECAL_MAX, 0),
        elecDecalY: borner(corps.elecDecalY, DECAL_MIN, DECAL_MAX, 0),
        elecTaille: borner(corps.elecTaille, CERT_TAILLE_MIN, CERT_TAILLE_MAX, 100),
        // (NOUVEAU v0.2.128) contenu du cachet dans l'aperçu réponses —
        // mêmes interrupteurs que l'enregistrement (PUT).
        elecAffSignataire: corps.elecAffSignataire !== undefined ? Boolean(corps.elecAffSignataire) : vue.valeurs.elecAffSignataire,
        elecAffOrganisation: corps.elecAffOrganisation !== undefined ? Boolean(corps.elecAffOrganisation) : vue.valeurs.elecAffOrganisation,
        elecAffEmetteur: corps.elecAffEmetteur !== undefined ? Boolean(corps.elecAffEmetteur) : vue.valeurs.elecAffEmetteur,
        elecAffValidite: corps.elecAffValidite !== undefined ? Boolean(corps.elecAffValidite) : vue.valeurs.elecAffValidite,
        elecAffEmpreinte: corps.elecAffEmpreinte !== undefined ? Boolean(corps.elecAffEmpreinte) : vue.valeurs.elecAffEmpreinte,
        elecTexteLibre: String(corps.elecTexteLibre ?? vue.valeurs.elecTexteLibre ?? "").slice(0, 120),
      };
      // (MODIFIÉ v0.2.99) la fusion passe la SOURCE : tant que la ligne
      // réponses n'existe pas (source=import), le certificat « Import »
      // s'applique (continuité historique) ; sinon le certificat DÉDIÉ de la
      // configuration réponses (déjà dans cfgRep via vue.valeurs) est utilisé
      // — les métadonnées « Import » ne sont plus jamais écrasées dedans.
      const cfgFusion = fusionnerReponseAvecActifs(cfgRep, vue.actifs, vue.source);
      // (NOUVEAU v0.2.119) injection des métadonnées du certificat du module
      // (aperçu FIDÈLE : le cachet n'apparaît que si le module est actif et
      // couvre les réponses — mêmes conditions que le rendu réel).
      const cfgApercuRep = (await completerConfigTamponAvecElec(cfgFusion, "REPONSES")) as ConfigTampon;
      const { octets: pdfRep, mime: mimeRep } = await apercuReponseTampon(cfgApercuRep);
      return new NextResponse(new Uint8Array(pdfRep), {
        headers: {
          "Content-Type": mimeRep,
          "Content-Length": String(pdfRep.length),
          "Content-Disposition": 'inline; filename="apercu-reponse.pdf"',
          "Cache-Control": "no-store",
        },
      });
    }
    const cfg = {
      actif: true, // l'aperçu force l'activation (c'est son but)
      sigActif: Boolean(corps.sigActif),
      sigImage: String(corps.sigImage ?? ""),
      sigTexte: String(corps.sigTexte ?? "").slice(0, 300),
      sigPosition: filtrer(corps.sigPosition, POSITIONS, "BAS_DROITE"),
      sigTaille: borner(corps.sigTaille, TAILLE_MIN, TAILLE_MAX, 120),
      sigOpacite: Math.max(0.3, Math.min(1, Number(corps.sigOpacite) || 0.9)),
      qrActif: Boolean(corps.qrActif),
      qrMode: filtrer(corps.qrMode, MODES_QR, "DONNEES"),
      qrUrl: String(corps.qrUrl ?? "").slice(0, 500),
      qrTexte: String(corps.qrTexte ?? "").slice(0, 500),
      qrImage: String(corps.qrImage ?? ""),
      qrPosition: filtrer(corps.qrPosition, POSITIONS, "BAS_GAUCHE"),
      qrTaille: borner(corps.qrTaille, TAILLE_MIN, TAILLE_MAX, 110),
      sigDecalX: borner(corps.sigDecalX, DECAL_MIN, DECAL_MAX, 0),
      sigDecalY: borner(corps.sigDecalY, DECAL_MIN, DECAL_MAX, 0),
      qrDecalX: borner(corps.qrDecalX, DECAL_MIN, DECAL_MAX, 0),
      qrDecalY: borner(corps.qrDecalY, DECAL_MIN, DECAL_MAX, 0),
      // (NOUVEAU 0.2.54) rotations : degrés horaires 0 → 360
      sigRotation: borner(corps.sigRotation, 0, 360, 0),
      qrRotation: borner(corps.qrRotation, 0, 360, 0),
      mentionActif: Boolean(corps.mentionActif),
      mentionTexte: String(corps.mentionTexte ?? "").slice(0, 300),
      // (NOUVEAU v0.2.88) Switch du certificat dans l'aperçu — les
      // MÉTADONNÉES du certificat importé (Task 181) sont complétées juste
      // après depuis la configuration enregistrée (le panneau n'envoie le
      // fichier qu'au changement ; l'aperçu doit toujours les refléter).
      certActif: Boolean(corps.certActif),
      certSujet: "",
      certEmetteur: "",
      certSerie: "",
      certValideAu: null as Date | string | null,
      certEmpreinte: "",
      // (NOUVEAU v0.2.92) positionnement du bloc certificat dans l'aperçu —
      // mêmes bornes que l'enregistrement (PUT).
      certPosition: filtrer(corps.certPosition, POSITIONS_CERT, "BAS_CENTRE"),
      certDecalX: borner(corps.certDecalX, DECAL_MIN, DECAL_MAX, 0),
      certDecalY: borner(corps.certDecalY, DECAL_MIN, DECAL_MAX, 0),
      certTaille: borner(corps.certTaille, CERT_TAILLE_MIN, CERT_TAILLE_MAX, 100),
      // (NOUVEAU v0.2.119) cachet « Signature électronique » dans l'aperçu —
      // métadonnées injectées juste après depuis le module de signature.
      elecActif: Boolean(corps.elecActif),
      elecPosition: filtrer(corps.elecPosition, POSITIONS_CERT, "BAS_DROITE"),
      elecDecalX: borner(corps.elecDecalX, DECAL_MIN, DECAL_MAX, 0),
      elecDecalY: borner(corps.elecDecalY, DECAL_MIN, DECAL_MAX, 0),
      elecTaille: borner(corps.elecTaille, CERT_TAILLE_MIN, CERT_TAILLE_MAX, 100),
      // (NOUVEAU v0.2.120) forme du cachet : RECTANGLE (historique) | ROND
      elecForme: filtrer(corps.elecForme, ["RECTANGLE", "ROND"], "RECTANGLE"),
      // (NOUVEAU v0.2.128) CONTENU du cachet — mêmes interrupteurs que le PUT
      elecAffSignataire: Boolean(corps.elecAffSignataire),
      elecAffOrganisation: Boolean(corps.elecAffOrganisation),
      elecAffEmetteur: Boolean(corps.elecAffEmetteur),
      elecAffValidite: Boolean(corps.elecAffValidite),
      elecAffEmpreinte: Boolean(corps.elecAffEmpreinte),
      elecTexteLibre: String(corps.elecTexteLibre ?? "").slice(0, 120),
      elec: undefined as ConfigTampon["elec"],
    };
    // (NOUVEAU v0.2.88) métadonnées du certificat enregistré → aperçu fidèle :
    // Switch ON + certificat importé = bloc certificat visible dans l'aperçu.
    try {
      const enregistre = await db.signatureConfig.findUnique({ where: { id: "signature" } });
      if (enregistre) {
        cfg.certSujet = enregistre.certSujet;
        cfg.certEmetteur = enregistre.certEmetteur;
        cfg.certSerie = enregistre.certSerie;
        cfg.certValideAu = enregistre.certValideAu;
        cfg.certEmpreinte = enregistre.certEmpreinte;
        cfg.certActif =
          corps.certActif !== undefined ? Boolean(corps.certActif) : Boolean(enregistre.certActif);
      }
    } catch {
      // configuration illisible : aperçu sans certificat (jamais bloquant)
    }
    // (NOUVEAU v0.2.119) injection des métadonnées du certificat du module
    // de signature — l'aperçu affiche le cachet « Signature électronique »
    // dans les MÊMES conditions que le rendu réel (module actif + couverture
    // fiches + certificat chargé).
    try {
      const cfgAvecElec = (await completerConfigTamponAvecElec(cfg, "FICHES")) as typeof cfg;
      cfg.elecActif = cfgAvecElec.elecActif;
      cfg.elec = cfgAvecElec.elec;
    } catch {
      // injection impossible : aperçu sans cachet (jamais bloquant)
    }
    // (NOUVEAU 0.2.47) APERÇU SUR UNE FICHE RÉELLE : la DERNIÈRE fiche PDF
    // importée sert d'exemple — le rendu est EXACTEMENT celui de l'affichage
    // final (mêmes pages, mêmes marges, mêmes éléments).
    // (MODIFIÉ 0.2.48) à défaut de fiche PDF exploitable, la DERNIÈRE fiche
    // IMAGE (PNG/JPEG) est tamponnée par le moteur image et servie telle
    // (aperçu fidèle du rendu final sur ce format). Repli : l'exemple
    // synthétique historique si aucune fiche exploitable. DOCX/XLSX exclus
    // (non affichables dans un navigateur).
    let reel: ReelApercu | null = null;
    let libelleFiche = "";
    try {
      const dernieres = await db.payslip.findMany({
        orderBy: { uploadedAt: "desc" },
        take: 30,
      });
      for (const rec of dernieres) {
        if (!rec.storedName) continue;
        const filePath = resolveStoredFile(rec.storedName);
        if (!filePath) continue;
        const brut = await readFile(filePath);
        const donnees = decryptFromStorage(brut);
        if (!donnees || donnees.length < 8) continue;
        const magie = donnees.subarray(0, 4).toString("latin1");
        if (magie === "%PDF") {
          reel = {
            octets: donnees,
            fiche: {
              id: rec.id,
              employeeName: rec.employeeName,
              cin: rec.cin,
              period: rec.period,
              netSalary: rec.netSalary,
              uploadedAt: rec.uploadedAt,
            },
            type: "pdf",
          };
          break; // priorité au PDF (rendu exact de la visionneuse)
        }
        // fiche image : gardée en réserve (la première rencontrée = la plus
        // récente) mais la recherche continue au cas où une fiche PDF plus
        // ancienne existe — le PDF reste l'aperçu de référence.
        if (!reel && (donnees.subarray(0, 8).toString("hex").startsWith("89504e470d0a1a0a") ||
          (donnees[0] === 0xff && donnees[1] === 0xd8))) {
          const verdict = validerStructureImage(donnees);
          if (verdict.ok) {
            const estJpeg = donnees[0] === 0xff && donnees[1] === 0xd8;
            reel = {
              octets: donnees,
              fiche: {
                id: rec.id,
                employeeName: rec.employeeName,
                cin: rec.cin,
                period: rec.period,
                netSalary: rec.netSalary,
                uploadedAt: rec.uploadedAt,
              },
              type: "image",
              mime: estJpeg ? "image/jpeg" : "image/png",
            };
          }
        }
      }
      if (reel) {
        libelleFiche =
          (String(reel.fiche.employeeName ?? "").trim() || "Fiche") +
          (reel.fiche.period ? " — " + String(reel.fiche.period).trim() : "");
      }
    } catch {
      reel = null; // fiche illisible → exemple synthétique (jamais bloquant)
    }
    const { octets: pdf, mime } = await apercuTampon(cfg, reel);
    const nomApercu = mime === "image/png" ? "apercu-signature-qr.png" : mime === "image/jpeg" ? "apercu-signature-qr.jpg" : "apercu-signature-qr.pdf";
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(pdf.length),
        "Content-Disposition": `inline; filename="${nomApercu}"`,
        "Cache-Control": "no-store",
        // Nom de la fiche utilisée (vide = exemple synthétique) — encodé URI
        // car les en-têtes HTTP n'acceptent pas les accents bruts.
        "X-Apercu-Fiche": libelleFiche ? encodeURIComponent(libelleFiche) : "",
      },
    });
  } catch (error) {
    console.error("[SIGNATURE-CONFIG] Aperçu:", error);
    return NextResponse.json(
      { error: "Aperçu impossible : vérifiez l'image de signature (PNG/JPEG)." },
      { status: 500 }
    );
  }
}
