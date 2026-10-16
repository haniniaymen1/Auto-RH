/**
 * ============================================================================
 *  NOUVEAU (Task 184, v0.2.144) — API « RÉPONSE AUTOMATIQUE PDF PAR E-MAIL »
 * ============================================================================
 *  Configuration DÉDIÉE et TOTALEMENT INDÉPENDANTE de la réponse PDF envoyée
 *  automatiquement (congé / autorisation) : signature électronique (certificat
 *  DÉDIÉ), image de signature, tampon, QR Code, position/taille/rotation de
 *  CHAQUE élément, aperçu interactif, mention et options d'envoi e-mail
 *  (employé + RH + manager). AUCUNE dépendance à la configuration de
 *  l'import des fiches de paie (SignatureConfig) ni au module de signature
 *  (SignatureApiConfig) : tout est défini ICI.
 *
 *  GET   /api/reponse-pdf-config
 *          → configuration complète (SANS le mot de passe du certificat —
 *            booléen hasCertPassword ; images en dataURL pour l'aperçu).
 *  PUT   /api/reponse-pdf-config   (JSON)
 *          → interrupteurs + positionnements ; images sigImage / tamponImage /
 *            qrImage : présentes = remplacées ("" = supprimées, champ absent =
 *            inchangé) ; certMotDePasse présent = remplacé.
 *  POST  /api/reponse-pdf-config   (multipart/form-data, champ `action`)
 *          action=certificat         : .p12/.pfx (≤ 4 Mo) + motDePasse →
 *                                      validation PKCS#12 + stockage CHIFFRÉ
 *                                      (storage/reponse-pdf/) + diagnostic ;
 *          action=supprimer-certificat ; action=verifier-certificat ;
 *          action=apercu             : PDF généré selon CETTE configuration
 *                                      (demande réelle `demandeId` ou démo),
 *                                      sans stockage ni envoi ;
 *          action=test-envoi         : génère l'aperçu ET l'envoie à l'adresse
 *                                      fournie — pièce jointe réelle.
 *
 *  Sécurité : réservé aux rôles RH et SUPERADMIN (l'IT n'a NI le tampon ni
 *  cette configuration — 403). Mot de passe expiré → 403. Le mot de passe du
 *  certificat est CHIFFRÉ en base ; le fichier est CHIFFRÉ sur disque.
 * ============================================================================
 */
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, unlink, readFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import {
  estSuperadmin,
  getSessionUser,
  motDePasseExpire,
  refusIT,
  unauthorized,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { chiffrerChamp, dechiffrerChamp } from "@/lib/db-crypto";
import { encryptForStorage, decryptFromStorage } from "@/lib/storage-crypto";
import { getStorageDir, getTamponsDir } from "@/lib/storage-dir";

export const runtime = "nodejs";

const POSITIONS = ["BAS_DROITE", "BAS_GAUCHE", "HAUT_DROITE", "HAUT_GAUCHE"];
const POSITIONS_CERT = [...POSITIONS, "BAS_CENTRE"];
const MODES_QR = ["DONNEES", "URL", "FICHE", "TEXTE", "IMAGE"];
const FORMES_ELEC = ["RECTANGLE", "ROND"];
const TAILLE_IMAGE_MAX = 11_000_000; // ≈ dataURL (comme signature-config)
const TAILLE_CERT_MAX = 4 * 1024 * 1024; // 4 Mo : un .p12 est petit

function filtrer(v: unknown, autorises: string[], defaut: string): string {
  return autorises.includes(String(v)) ? String(v) : defaut;
}
function borner(n: unknown, min: number, max: number, defaut: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return defaut;
  return Math.round(Math.max(min, Math.min(max, x)));
}
function nomFichierAffichable(v: unknown): string {
  return String(v ?? "")
    .replace(/[\\/]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
}

/** Dossier DÉDIÉ de la section : certificat (chiffré) + copies de contrôle. */
function reponsePdfDir(): string {
  return path.join(path.dirname(getStorageDir()), "reponse-pdf");
}

/** Copie de contrôle historique des tampons (storage/tampons/) — visibilité. */
async function exporterCopieTampon(dataUrl: string, prefixe: string): Promise<string> {
  try {
    const m = dataUrl.match(/^data:image\/(png|jpeg);base64,([\s\S]+)$/);
    if (!m) return "";
    const ext = m[1] === "jpeg" ? "jpg" : "png";
    const octets = Buffer.from(m[2], "base64");
    if (!octets.length) return "";
    const dir = getTamponsDir();
    await mkdir(dir, { recursive: true });
    const horodatage = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const nom = `${prefixe}-reponse-pdf-${horodatage}.${ext}`;
    await writeFile(path.join(dir, nom), encryptForStorage(octets));
    return `storage/tampons/${nom}`;
  } catch {
    return "";
  }
}

// (CORRECTIF v0.2.201) : le type de retour inclut `Response` car les helpers
// `unauthorized()`, `motDePasseExpire()` et `refusIT()` (src/lib/auth.ts)
// renvoient un `Response` standard (Web API). TypeScript refusait `Response`
// dans `Promise<NextResponse | null>` — on élargit le type à `Response`.
// Comportement runtime IDENTIQUE : NextResponse hérite de Response.
async function garde(): Promise<NextResponse | Response | null> {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  // (Task 176/179/184) l'IT n'a ni le tampon/signature ni cette configuration.
  if (session.role === "IT")
    return refusIT("La configuration « Réponse automatique PDF par e-mail »");
  if (session.role !== "RH" && !estSuperadmin(session)) {
    return NextResponse.json(
      { error: "Accès refusé : cette configuration est réservée aux rôles RH et superadministrateur." },
      { status: 403 }
    );
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* GET — configuration complète (mot de passe jamais renvoyé)          */
/* ------------------------------------------------------------------ */
export async function GET() {
  const refus = await garde();
  if (refus) return refus;
  try {
    let cfg = await db.reponsePdfConfig.findUnique({ where: { id: "reponse-pdf" } });
    if (!cfg) cfg = await db.reponsePdfConfig.create({ data: { id: "reponse-pdf" } });
    let rhEmail = "";
    try {
      const mailCfg = await db.mailConfig.findUnique({ where: { id: "smtp" } });
      rhEmail = String(mailCfg?.rhEmail || "");
    } catch { /* */ }
    return NextResponse.json({
      config: {
        actif: cfg.actif,
        certificat: {
          present: Boolean(cfg.certChemin),
          nom: cfg.certFichierNom || "",
          empreinte: cfg.certEmpreinte || "",
          importeLe: cfg.certImportLe || null,
          hasCertPassword: Boolean(cfg.certMotDePasse),
          actif: cfg.certActif,
          signer: cfg.signerActif !== false,
          position: cfg.certPosition || "BAS_CENTRE",
          decalX: cfg.certDecalX ?? 0,
          decalY: cfg.certDecalY ?? 0,
          taille: cfg.certTaille ?? 100,
          signataire: cfg.certSignataire || "",
          fonction: cfg.certFonction || "",
          sujet: cfg.certSujet || "",
          emetteur: cfg.certEmetteur || "",
          serie: cfg.certSerie || "",
          valideDu: cfg.certValideDu || null,
          valideAu: cfg.certValideAu || null,
        },
        paraphe: {
          presente: Boolean(cfg.sigImage),
          actif: cfg.sigActif !== false,
          image: cfg.sigImage || "",
          nom: cfg.sigImageNom || "",
          position: cfg.sigPosition || "BAS_DROITE",
          taille: cfg.sigTaille ?? 120,
          opacite: cfg.sigOpacite ?? 0.9,
          decalX: cfg.sigDecalX ?? 0,
          decalY: cfg.sigDecalY ?? 0,
          rotation: cfg.sigRotation ?? 0,
        },
        tampon: {
          presente: Boolean(cfg.tamponImage),
          actif: cfg.tamponActif !== false,
          image: cfg.tamponImage || "",
          nom: cfg.tamponImageNom || "",
          position: cfg.tamponPosition || "BAS_GAUCHE",
          taille: cfg.tamponTaille ?? 140,
          opacite: cfg.tamponOpacite ?? 0.85,
          decalX: cfg.tamponDecalX ?? 0,
          decalY: cfg.tamponDecalY ?? 0,
          rotation: cfg.tamponRotation ?? 0,
        },
        qr: {
          actif: Boolean(cfg.qrActif),
          mode: cfg.qrMode || "FICHE",
          url: cfg.qrUrl || "",
          texte: cfg.qrTexte || "",
          presente: Boolean(cfg.qrImage),
          image: cfg.qrImage || "",
          nom: cfg.qrImageNom || "",
          position: cfg.qrPosition || "BAS_GAUCHE",
          taille: cfg.qrTaille ?? 110,
          decalX: cfg.qrDecalX ?? 0,
          decalY: cfg.qrDecalY ?? 0,
          rotation: cfg.qrRotation ?? 0,
        },
        elec: {
          actif: Boolean(cfg.elecActif),
          position: cfg.elecPosition || "BAS_DROITE",
          decalX: cfg.elecDecalX ?? 0,
          decalY: cfg.elecDecalY ?? 0,
          taille: cfg.elecTaille ?? 100,
          forme: cfg.elecForme === "ROND" ? "ROND" : "RECTANGLE",
          affSignataire: Boolean(cfg.elecAffSignataire),
          affOrganisation: Boolean(cfg.elecAffOrganisation),
          affEmetteur: Boolean(cfg.elecAffEmetteur),
          affValidite: Boolean(cfg.elecAffValidite),
          affEmpreinte: Boolean(cfg.elecAffEmpreinte),
          texteLibre: cfg.elecTexteLibre || "",
        },
        mention: {
          actif: cfg.mentionActif !== false,
          texte: cfg.mentionTexte || "",
        },
        envoi: {
          actif: cfg.emailActif !== false,
          objet: cfg.emailObjet || "",
          corps: cfg.emailCorps || "",
          envoyerEmploye: cfg.envoyerEmploye !== false,
          envoyerRh: cfg.envoyerRh !== false,
          envoyerManager: cfg.envoyerManager !== false,
          rhEmail,
        },
      },
    });
  } catch (error) {
    console.error("[REponse-PDF-CONFIG] GET:", error);
    return NextResponse.json({ error: "Lecture impossible." }, { status: 500 });
  }
}

/* ------------------------------------------------------------------ */
/* PUT — enregistrement (bornage identique aux fiches)                 */
/* ------------------------------------------------------------------ */
export async function PUT(request: NextRequest) {
  const refus = await garde();
  if (refus) return refus;
  try {
    const corps = await request.json().catch(() => ({}));
    const data: Record<string, unknown> = {
      actif: Boolean(corps.actif),
      // (v0.2.145) interrupteurs indépendants par élément — défaut ON
      // (absent = true) : continuité v0.2.144 et simples à désactiver
      sigActif: corps.sigActif !== false,
      tamponActif: corps.tamponActif !== false,
      signerActif: corps.signerActif !== false,
      // paraphe
      sigPosition: filtrer(corps.sigPosition, POSITIONS, "BAS_DROITE"),
      sigTaille: borner(corps.sigTaille, 40, 1200, 120),
      sigOpacite: Math.max(0.3, Math.min(1, Number(corps.sigOpacite) || 0.9)),
      sigDecalX: borner(corps.sigDecalX, -1500, 1500, 0),
      sigDecalY: borner(corps.sigDecalY, -1500, 1500, 0),
      sigRotation: borner(corps.sigRotation, 0, 360, 0),
      // tampon
      tamponPosition: filtrer(corps.tamponPosition, POSITIONS, "BAS_GAUCHE"),
      tamponTaille: borner(corps.tamponTaille, 40, 1200, 140),
      tamponOpacite: Math.max(0.3, Math.min(1, Number(corps.tamponOpacite) || 0.85)),
      tamponDecalX: borner(corps.tamponDecalX, -1500, 1500, 0),
      tamponDecalY: borner(corps.tamponDecalY, -1500, 1500, 0),
      tamponRotation: borner(corps.tamponRotation, 0, 360, 0),
      // QR
      qrActif: Boolean(corps.qrActif),
      qrMode: filtrer(corps.qrMode, MODES_QR, "FICHE"),
      qrUrl: String(corps.qrUrl ?? "").trim().slice(0, 500),
      qrTexte: String(corps.qrTexte ?? "").slice(0, 500),
      qrPosition: filtrer(corps.qrPosition, POSITIONS, "BAS_GAUCHE"),
      qrTaille: borner(corps.qrTaille, 40, 1200, 110),
      qrDecalX: borner(corps.qrDecalX, -1500, 1500, 0),
      qrDecalY: borner(corps.qrDecalY, -1500, 1500, 0),
      qrRotation: borner(corps.qrRotation, 0, 360, 0),
      // certificat (bloc + signataire)
      certActif: Boolean(corps.certActif),
      certPosition: filtrer(corps.certPosition, POSITIONS_CERT, "BAS_CENTRE"),
      certDecalX: borner(corps.certDecalX, -1500, 1500, 0),
      certDecalY: borner(corps.certDecalY, -1500, 1500, 0),
      certTaille: borner(corps.certTaille, 40, 1200, 100),
      certSignataire: String(corps.certSignataire ?? "").slice(0, 120),
      certFonction: String(corps.certFonction ?? "").slice(0, 120),
      // cachet électronique
      elecActif: Boolean(corps.elecActif),
      elecPosition: filtrer(corps.elecPosition, POSITIONS, "BAS_DROITE"),
      elecDecalX: borner(corps.elecDecalX, -1500, 1500, 0),
      elecDecalY: borner(corps.elecDecalY, -1500, 1500, 0),
      elecTaille: borner(corps.elecTaille, 50, 300, 100),
      elecForme: filtrer(corps.elecForme, FORMES_ELEC, "RECTANGLE"),
      elecAffSignataire: Boolean(corps.elecAffSignataire),
      elecAffOrganisation: Boolean(corps.elecAffOrganisation),
      elecAffEmetteur: Boolean(corps.elecAffEmetteur),
      elecAffValidite: Boolean(corps.elecAffValidite),
      elecAffEmpreinte: Boolean(corps.elecAffEmpreinte),
      elecTexteLibre: String(corps.elecTexteLibre ?? "").slice(0, 120),
      // mention + envoi
      mentionActif: Boolean(corps.mentionActif),
      mentionTexte: String(corps.mentionTexte ?? "").slice(0, 300),
      emailActif: Boolean(corps.emailActif),
      emailObjet: String(corps.emailObjet ?? "").slice(0, 300),
      emailCorps: String(corps.emailCorps ?? "").slice(0, 4000),
      envoyerEmploye: Boolean(corps.envoyerEmploye),
      envoyerRh: Boolean(corps.envoyerRh),
      envoyerManager: Boolean(corps.envoyerManager),
    };

    // Mot de passe du certificat : remplacé SEULEMENT si le champ est présent.
    if ("certMotDePasse" in corps) {
      const mdp = String(corps.certMotDePasse ?? "");
      data.certMotDePasse = mdp ? chiffrerChamp(mdp, false) : "";
    }

    // Paraphe image (convention « présent = remplacé »).
    if ("sigImage" in corps) {
      const img = String(corps.sigImage ?? "");
      if (img === "") {
        data.sigImage = "";
        data.sigImageNom = "";
        data.sigImageChemin = "";
      } else if (/^data:image\/(png|jpe?g);base64,/.test(img) && img.length <= TAILLE_IMAGE_MAX) {
        data.sigImage = img;
        data.sigImageNom = nomFichierAffichable(corps.sigImageNom);
        data.sigImageChemin = await exporterCopieTampon(img, "paraphe");
      } else {
        return NextResponse.json(
          { error: "Image de signature invalide (PNG ou JPEG attendu, 8 Mo maximum)." },
          { status: 400 }
        );
      }
    }

    // Tampon image (cachet).
    if ("tamponImage" in corps) {
      const img = String(corps.tamponImage ?? "");
      if (img === "") {
        data.tamponImage = "";
        data.tamponImageNom = "";
        data.tamponImageChemin = "";
      } else if (/^data:image\/(png|jpe?g);base64,/.test(img) && img.length <= TAILLE_IMAGE_MAX) {
        data.tamponImage = img;
        data.tamponImageNom = nomFichierAffichable(corps.tamponImageNom);
        data.tamponImageChemin = await exporterCopieTampon(img, "tampon-reponse");
      } else {
        return NextResponse.json(
          { error: "Image de tampon invalide (PNG ou JPEG attendu, 8 Mo maximum)." },
          { status: 400 }
        );
      }
    }

    // QR fourni (mode IMAGE).
    if ("qrImage" in corps) {
      const img = String(corps.qrImage ?? "");
      if (img === "") {
        data.qrImage = "";
        data.qrImageNom = "";
      } else if (/^data:image\/(png|jpe?g);base64,/.test(img) && img.length <= TAILLE_IMAGE_MAX) {
        data.qrImage = img;
        data.qrImageNom = nomFichierAffichable(corps.qrImageNom);
      } else {
        return NextResponse.json(
          { error: "Image de QR invalide (PNG ou JPEG attendu, 8 Mo maximum)." },
          { status: 400 }
        );
      }
    }

    const cfg = await db.reponsePdfConfig.upsert({
      where: { id: "reponse-pdf" },
      update: data,
      create: { id: "reponse-pdf", ...data },
    });
    return NextResponse.json({
      ok: true,
      certificat: { hasCertPassword: Boolean(cfg.certMotDePasse), present: Boolean(cfg.certChemin) },
    });
  } catch (error) {
    console.error("[REponse-PDF-CONFIG] PUT:", error);
    return NextResponse.json({ error: "Enregistrement impossible." }, { status: 500 });
  }
}

/* ------------------------------------------------------------------ */
/* POST — certificat / aperçu / test d'envoi                           */
/* ------------------------------------------------------------------ */
export async function POST(request: NextRequest) {
  const refus = await garde();
  if (refus) return refus;
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "Requête invalide (multipart attendu)." }, { status: 400 });
    }
    const action = String(form.get("action") ?? "").trim();

    /** Lecture DÉCHIFFRÉE d'un fichier stocké (certificat dédié). */
    async function lireFichierStocke(chemin: string): Promise<Buffer | null> {
      try {
        const racine = path.dirname(path.dirname(getStorageDir()));
        const brut = await readFile(
          path.isAbsolute(chemin) ? chemin : path.join(racine, chemin)
        );
        return decryptFromStorage(brut);
      } catch {
        return null;
      }
    }

    /** Configuration DÉDIÉE pour le moteur (aperçu / test) — indépendante :
     *  l'aperçu reflète TOUJOURS cette section, même quand elle est inactive. */
    async function cfgMoteur(): Promise<Record<string, unknown>> {
      const mod = await import("../../../../scripts/document-acceptation.js");
      const rpc = await db.reponsePdfConfig.findUnique({ where: { id: "reponse-pdf" } });
      if (rpc) return mod.cfgDepuisReponsePdf(rpc);
      return mod.chargerConfig(db);
    }

    /* ---- Import du certificat DÉDIÉ (.p12/.pfx) ---- */
    if (action === "certificat") {
      const fichier = form.get("fichier");
      if (!(fichier instanceof File) || !fichier.size) {
        return NextResponse.json({ error: "Aucun fichier reçu : sélectionnez le certificat (.p12 / .pfx)." }, { status: 400 });
      }
      const nomBas = fichier.name.toLowerCase();
      if (!/\.(p12|pfx)$/.test(nomBas)) {
        return NextResponse.json({ error: "Format attendu : .p12 ou .pfx (certificat PKCS#12)." }, { status: 400 });
      }
      if (fichier.size > TAILLE_CERT_MAX) {
        return NextResponse.json({ error: "Certificat trop volumineux (4 Mo maximum)." }, { status: 400 });
      }
      const motDePasse = String(form.get("motDePasse") ?? "");
      const octets = Buffer.from(await fichier.arrayBuffer());
      const mod = await import("../../../../scripts/document-acceptation.js");
      const diag = mod.verifierContenuCertificat(octets, motDePasse);
      if (!diag.ok) {
        return NextResponse.json({ error: diag.message }, { status: 400 });
      }
      const dir = reponsePdfDir();
      await mkdir(dir, { recursive: true });
      const horodatage = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
      const nomStocke = `certificat-${horodatage}.p12`;
      await writeFile(path.join(dir, nomStocke), encryptForStorage(octets));
      const empreinteFichier = crypto.createHash("sha256").update(octets).digest("hex");
      const data: Record<string, unknown> = {
        certFormat: "PKCS#12",
        certFichierNom: nomFichierAffichable(fichier.name),
        certChemin: `storage/reponse-pdf/${nomStocke}`,
        certEmpreinte: empreinteFichier,
        certImportLe: new Date(),
        certMotDePasse: chiffrerChamp(motDePasse, false),
        // métadonnées du diagnostic (cachet électronique + bloc certificat)
        certSujet: diag.sujet || "",
        certEmetteur: diag.emetteur || "",
        certValideDu: null as Date | null,
        certValideAu: null as Date | null,
      };
      // dates de validité + numéro de série : relus depuis le PKCS#12
      try {
        const forge = require("node-forge");
        const asn1 = forge.asn1.fromDer(octets.toString("binary"));
        const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, true, String(motDePasse || ""));
        const sacs = p12.getBags({ bagType: forge.pki.oids.certBag });
        const cert = (sacs[forge.pki.oids.certBag] || [])[0]?.cert;
        if (cert?.validity) {
          data.certValideDu = cert.validity.notBefore;
          data.certValideAu = cert.validity.notAfter;
        }
        // node-forge : cert.serialNumber est déjà une chaîne hexadécimale
        const serieHex = cert?.serialNumber ? String(cert.serialNumber) : "";
        if (serieHex) data.certSerie = serieHex.toUpperCase();
      } catch { /* métadonnées optionnelles */ }

      const cfg = await db.reponsePdfConfig.upsert({
        where: { id: "reponse-pdf" },
        update: data,
        create: { id: "reponse-pdf", ...data },
      });
      return NextResponse.json({
        ok: true,
        diagnostic: {
          sujet: diag.sujet,
          emetteur: diag.emetteur,
          valideDu: diag.valideDu,
          valideAu: diag.valideAu,
          expire: diag.expire,
          message: diag.message,
        },
        certificat: { present: Boolean(cfg.certChemin), hasCertPassword: Boolean(cfg.certMotDePasse) },
      });
    }

    /* ---- Suppression du certificat ---- */
    if (action === "supprimer-certificat") {
      const cfg = await db.reponsePdfConfig.findUnique({ where: { id: "reponse-pdf" } });
      if (cfg?.certChemin) {
        try {
          await unlink(path.join(path.dirname(path.dirname(getStorageDir())), cfg.certChemin));
        } catch { /* fichier déjà absent */ }
      }
      await db.reponsePdfConfig.upsert({
        where: { id: "reponse-pdf" },
        update: {
          certFormat: "", certFichierNom: "", certChemin: "", certSujet: "",
          certEmetteur: "", certSerie: "", certValideDu: null, certValideAu: null,
          certEmpreinte: "", certImportLe: null, certMotDePasse: "",
        },
        create: { id: "reponse-pdf" },
      });
      return NextResponse.json({ ok: true });
    }

    /* ---- Diagnostic du certificat DÉDIÉ configuré ---- */
    if (action === "verifier-certificat") {
      const cfg = await db.reponsePdfConfig.findUnique({ where: { id: "reponse-pdf" } });
      if (!cfg?.certChemin) {
        return NextResponse.json({ ok: false, message: "Aucun certificat importé dans cette section." });
      }
      const octets = await lireFichierStocke(cfg.certChemin);
      if (!octets) {
        return NextResponse.json({ ok: false, message: "Fichier du certificat introuvable ou illisible sur le serveur." });
      }
      const mod = await import("../../../../scripts/document-acceptation.js");
      const diag = mod.verifierContenuCertificat(octets, String(dechiffrerChamp(cfg.certMotDePasse) || ""));
      return NextResponse.json(
        diag.ok
          // (CORRECTIF v0.2.201) : `diag` contient déjà `ok: true` quand on
          // entre dans cette branche (vérifié par le ternaire ci-dessus). On
          // ne répète plus `ok: true` pour éviter TS2783 ("'ok' is specified
          // more than once") — `...diag` préserve la valeur `true`.
          ? { ...diag, nom: cfg.certFichierNom, importeLe: cfg.certImportLe, empreinte: cfg.certEmpreinte }
          : { ok: false, message: diag.message }
      );
    }

    /* ---- APERÇU (généré selon CETTE configuration, non stocké, non envoyé) ---- */
    if (action === "apercu") {
      const demandeId = String(form.get("demandeId") ?? "").trim() || null;
      const mod = await import("../../../../scripts/document-acceptation.js");
      const cfg = await cfgMoteur();
      const r = await mod.apercuDocument(db, demandeId, cfg, {
        dechiffrerChamp,
        lireFichierStocke,
      });
      return new NextResponse(new Uint8Array(r.pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(r.pdf.length),
          "Content-Disposition": 'inline; filename="apercu-reponse-pdf.pdf"',
          "Cache-Control": "no-store",
          "X-Apercu-Signature-Crypto": r.signatureCrypto ? "1" : "0",
          "X-Apercu-Elements": encodeURIComponent((r.elements || []).join(",")),
          "X-Apercu-Reference": encodeURIComponent(r.ctx?.reference || ""),
          // (v0.2.147) avertissements EXPLICITES : signature électronique /
          // cachet « Signature électronique » activés mais non appliqués
          // faute de certificat — affichés à l'utilisateur, jamais silencieux.
          "X-Apercu-Avertissements": encodeURIComponent(JSON.stringify(r.avertissements || [])),
        },
      });
    }

    /* ---- TEST D'ENVOI à l'adresse fournie (pièce jointe réelle) ---- */
    if (action === "test-envoi") {
      const dest = String(form.get("dest") ?? "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) {
        return NextResponse.json({ error: "Adresse de test invalide." }, { status: 400 });
      }
      const mailCfg = await db.mailConfig.findUnique({ where: { id: "smtp" } });
      if (!mailCfg?.host) {
        return NextResponse.json(
          { error: "Le serveur SMTP n'est pas configuré (onglet Paramètres → Envoi d'e-mails)." },
          { status: 400 }
        );
      }
      const mod = await import("../../../../scripts/document-acceptation.js");
      const cfg = await cfgMoteur();
      const r = await mod.apercuDocument(db, null, cfg, {
        dechiffrerChamp,
        lireFichierStocke,
      });
      const ctxTest = {
        reference: r.reference,
        type: "CONGE",
        typeLibelle: "Demande de congé (e-mail de test)",
        nomEmploye: "Employé de test",
        cin: "00000000",
        matricule: "",
        emailEmploye: dest,
        nomManager: "Manager de test",
        emailManager: "",
        jours: 2,
        heures: "",
        dateDemande: "",
        dateDecision: "",
        decideur: "Auto-RH",
        commentaire: "",
        statutFinal: "Acceptée",
        donnees: {},
        cfg,
      };
      const email = mod.construireEmailDocumentSigne(
        ctxTest,
        cfg,
        { employe: dest, rh: "", manager: "", from: mailCfg.from || "" },
        "Test_reponse_pdf.pdf",
        r.pdf
      );
      const { transporteurDepuisConfig, journaliserEnvoi } = await import("@/lib/mailer");
      const { transport } = await transporteurDepuisConfig();
      try {
        const info = await transport.sendMail({
          from: mailCfg.from || undefined,
          to: dest,
          subject: "[TEST] " + email.subject,
          text: email.text,
          html: email.html,
          attachments: email.attachments,
        } as never);
        journaliserEnvoi({
          action: "reponse-pdf",
          dest,
          from: mailCfg.from || "",
          host: mailCfg.host,
          port: mailCfg.port,
          secure: mailCfg.port === 465,
          succes: true,
          messageId: info.messageId,
          reponseSmtp: info.response ?? "",
          reference: r.reference,
          type: "TEST",
        });
        return NextResponse.json({ ok: true, messageId: info.messageId });
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        journaliserEnvoi({
          action: "reponse-pdf",
          dest,
          from: "",
          host: mailCfg.host,
          port: mailCfg.port,
          secure: mailCfg.port === 465,
          succes: false,
          code: "SMTP_ECHEC",
          erreur: detail,
          reference: r.reference,
          type: "TEST",
        });
        return NextResponse.json({ error: "Envoi impossible : " + detail }, { status: 502 });
      }
    }

    return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
  } catch (error) {
    console.error("[REponse-PDF-CONFIG] POST:", error);
    return NextResponse.json({ error: "Opération impossible." }, { status: 500 });
  }
}
