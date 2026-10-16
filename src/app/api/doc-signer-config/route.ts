/**
 * ============================================================================
 *  NOUVEAU (Task 179) — API « DOCUMENT D'ACCEPTATION SIGNÉ » (configuration)
 * ============================================================================
 *  Configuration du générateur automatique du document d'acceptation
 *  (demandes de congé / autorisation de sortie) : certificat de signature
 *  électronique (.p12/.pfx), paraphe image, tampon électronique (cachet),
 *  mention et paramètres d'envoi (employé + RH + manager).
 *
 *  GET   /api/doc-signer-config
 *          → configuration complète (SANS le mot de passe du certificat —
 *            booléen hasCertPassword ; images en dataURL pour aperçu) +
 *            état certificat (nom, date, empreinte) + e-mail RH (MailConfig).
 *  PUT   /api/doc-signer-config   (JSON)
 *          → options : docActif, docEmailActif, docEnvoyerRh, docEnvoyerManager,
 *            docEmailObjet, docEmailCorps, docMention, certSignataire,
 *            certFonction, positions/tailles (docSig*, tampon*), tamponOpacite ;
 *          images docSigImage / tamponImage : présentes = remplacées ("" =
 *            supprimées, champ absent = inchangé — MÊME convention que
 *            /api/signature-config) ; certMotDePasse présent = remplacé.
 *  POST  /api/doc-signer-config   (multipart/form-data, champ `action`)
 *          action=certificat        : fichier (p12/pfx ≤ 4 Mo) + motDePasse
 *                                     → validation PKCS#12 + stockage chiffré
 *                                     + diagnostic (sujet, émetteur, validité) ;
 *          action=supprimer-certificat : retire le certificat (+ fichier disque) ;
 *          action=verifier-certificat  : diagnostic du certificat configuré ;
 *          action=apercu            : PDF signé de démonstration (ou de la
 *                                     demande `demandeId`) en binaire inline —
 *                                     sans stockage ni envoi ;
 *          action=test-envoi        : génère l'aperçu ET l'envoie à l'adresse
 *                                     fournie — pièce jointe réelle.
 *
 *  Sécurité : réservé aux rôles RH et SUPERADMIN — le rôle IT n'a NI le
 *  tampon/signature (Task 176) NI cette configuration (même discipline :
 *  403 refusIT + panneau absent). Mot de passe expiré → 403.
 *  Le MOT DE PASSE du certificat est CHIFFRÉ en base (certMotDePasse, carte
 *  alea) ; le FICHIER est stocké CHIFFRÉ (storage/signature-certificat/).
 * ============================================================================
 */
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, unlink } from "fs/promises";
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
import { chiffrerChamp } from "@/lib/db-crypto";
import { encryptForStorage } from "@/lib/storage-crypto";
import { getStorageDir, getTamponsDir } from "@/lib/storage-dir";
import {
  chargerConfigDoc,
  verifierCertificatDoc,
  apercuDocumentSigne,
} from "@/lib/doc-signe";

export const runtime = "nodejs";

const POSITIONS = ["BAS_DROITE", "BAS_GAUCHE", "HAUT_DROITE", "HAUT_GAUCHE"];
const MODES_QR = ["DONNEES", "URL", "FICHE", "TEXTE", "IMAGE"];
const SOURCES = ["DEDIEE", "IMPORT"];
const SOURCES_CERT = ["MODULE", "DEDIE"];
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

/** Dossier du certificat (voisin des fiches : storage/signature-certificat/). */
function certificatsDir(): string {
  return path.join(path.dirname(getStorageDir()), "signature-certificat");
}

/** Copie de contrôle CHIFFRÉE d'une image de tampon (storage/tampons/). */
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
    const nom = `${prefixe}-doc-${horodatage}.${ext}`;
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
  // (Task 176/179) l'IT n'a ni le tampon/signature ni cette configuration.
  if (session.role === "IT")
    return refusIT("La configuration du document d'acceptation signé");
  if (session.role !== "RH" && !estSuperadmin(session)) {
    return NextResponse.json(
      { error: "Accès refusé : cette configuration est réservée aux rôles RH et superadministrateur." },
      { status: 403 }
    );
  }
  return null;
}

export async function GET() {
  const refus = await garde();
  if (refus) return refus;
  try {
    const cfg = await chargerConfigDoc();
    let rhEmail = "";
    try {
      const mailCfg = await db.mailConfig.findUnique({ where: { id: "smtp" } });
      rhEmail = String(mailCfg?.rhEmail || "");
    } catch { /* */ }
    // (v0.2.143) état du MODULE de signature (LE MÊME certificat que les
    // fiches de paie) — source de la signature cryptographique + du cachet.
    let moduleCert: Record<string, unknown> = {
      actif: false,
      signerReponses: false,
      present: false,
      sujet: "",
      emetteur: "",
      valideAu: null,
      empreinte: "",
      mode: "LOCALE",
    };
    try {
      const m = await db.signatureApiConfig.findUnique({ where: { id: "signature-api" } });
      if (m) {
        moduleCert = {
          actif: m.actif,
          signerReponses: m.signerReponses,
          present: Boolean(m.certChemin),
          sujet: m.certSujet || "",
          emetteur: m.certEmetteur || "",
          valideAu: m.certValideAu || null,
          empreinte: m.certEmpreinte || "",
          mode: m.mode || "LOCALE",
        };
      }
    } catch { /* */ }
    return NextResponse.json({
      config: {
        docActif: cfg.docActif,
        certificat: {
          present: Boolean(cfg.certChemin),
          nom: cfg.certNom || "",
          empreinte: cfg.certEmpreinte || "",
          importeLe: cfg.certImporteLe || null,
          hasCertPassword: Boolean(cfg.certMotDePasse),
          signataire: cfg.certSignataire || "",
          fonction: cfg.certFonction || "",
          source: cfg.docCertSource === "DEDIE" ? "DEDIE" : "MODULE",
        },
        moduleCert,
        paraphe: {
          presente: Boolean(cfg.docSigImage),
          image: cfg.docSigImage || "",
          nom: cfg.docSigImageNom || "",
          position: cfg.docSigPosition,
          taille: cfg.docSigTaille,
          decalX: cfg.docSigDecalX ?? 0,
          decalY: cfg.docSigDecalY ?? 0,
          rotation: cfg.docSigRotation ?? 0,
          source: cfg.docSigSource === "IMPORT" ? "IMPORT" : "DEDIEE",
        },
        tampon: {
          presente: Boolean(cfg.tamponImage),
          image: cfg.tamponImage || "",
          nom: cfg.tamponImageNom || "",
          position: cfg.tamponPosition,
          taille: cfg.tamponTaille,
          opacite: cfg.tamponOpacite,
          decalX: cfg.tamponDecalX ?? 0,
          decalY: cfg.tamponDecalY ?? 0,
          rotation: cfg.tamponRotation ?? 0,
          source: cfg.tamponSource === "IMPORT" ? "IMPORT" : "DEDIEE",
        },
        qr: {
          actif: Boolean(cfg.docQrActif),
          mode: cfg.docQrMode || "DONNEES",
          url: cfg.docQrUrl || "",
          texte: cfg.docQrTexte || "",
          presente: Boolean(cfg.docQrImage),
          image: cfg.docQrImage || "",
          nom: cfg.docQrImageNom || "",
          position: cfg.docQrPosition || "BAS_GAUCHE",
          taille: cfg.docQrTaille ?? 110,
          decalX: cfg.docQrDecalX ?? 0,
          decalY: cfg.docQrDecalY ?? 0,
          rotation: cfg.docQrRotation ?? 0,
          source: cfg.docQrSource === "IMPORT" ? "IMPORT" : "DEDIEE",
        },
        elec: {
          actif: Boolean(cfg.docElecActif),
          position: cfg.docElecPosition || "BAS_DROITE",
          decalX: cfg.docElecDecalX ?? 0,
          decalY: cfg.docElecDecalY ?? 0,
          taille: cfg.docElecTaille ?? 100,
          forme: cfg.docElecForme === "ROND" ? "ROND" : "RECTANGLE",
          affSignataire: Boolean(cfg.docElecAffSignataire),
          affOrganisation: Boolean(cfg.docElecAffOrganisation),
          affEmetteur: Boolean(cfg.docElecAffEmetteur),
          affValidite: Boolean(cfg.docElecAffValidite),
          affEmpreinte: Boolean(cfg.docElecAffEmpreinte),
          texteLibre: cfg.docElecTexteLibre || "",
        },
        // (v0.2.143) actifs partagés « Import de fichiers » — images
        // sélectionnables comme sources du paraphe/tampon/QR.
        imagesImport: {
          sigImage: cfg.sigImage || "",
          sigImageNom: cfg.sigImageNom || "",
          qrImage: cfg.qrImage || "",
          qrImageNom: cfg.qrImageNom || "",
        },
        mention: cfg.docMention,
        envoi: {
          actif: cfg.docEmailActif,
          objet: cfg.docEmailObjet,
          corps: cfg.docEmailCorps,
          envoyerRh: cfg.docEnvoyerRh,
          envoyerManager: cfg.docEnvoyerManager,
          rhEmail,
        },
      },
    });
  } catch (error) {
    console.error("[DOC-SIGNER-CONFIG] GET:", error);
    return NextResponse.json({ error: "Lecture impossible." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const refus = await garde();
  if (refus) return refus;
  try {
    const corps = await request.json().catch(() => ({}));
    const data: Record<string, unknown> = {
      docActif: Boolean(corps.docActif),
      docEmailActif: Boolean(corps.docEmailActif),
      docEnvoyerRh: Boolean(corps.docEnvoyerRh),
      docEnvoyerManager: Boolean(corps.docEnvoyerManager),
      docEmailObjet: String(corps.docEmailObjet ?? "").slice(0, 300),
      docEmailCorps: String(corps.docEmailCorps ?? "").slice(0, 4000),
      docMention: String(corps.docMention ?? "").slice(0, 300),
      certSignataire: String(corps.certSignataire ?? "").slice(0, 120),
      certFonction: String(corps.certFonction ?? "").slice(0, 120),
      docSigPosition: filtrer(corps.docSigPosition, POSITIONS, "BAS_DROITE"),
      docSigTaille: borner(corps.docSigTaille, 40, 1200, 120),
      tamponPosition: filtrer(corps.tamponPosition, POSITIONS, "BAS_GAUCHE"),
      tamponTaille: borner(corps.tamponTaille, 40, 1200, 140),
      tamponOpacite: Math.max(0.3, Math.min(1, Number(corps.tamponOpacite) || 0.85)),
      // ---- (v0.2.143) unification « Import de fichiers » : mêmes bornes
      //      que les fiches (décalages ±1500 pt, rotations 0 → 360°) ----
      docSigDecalX: borner(corps.docSigDecalX, -1500, 1500, 0),
      docSigDecalY: borner(corps.docSigDecalY, -1500, 1500, 0),
      docSigRotation: borner(corps.docSigRotation, 0, 360, 0),
      docSigSource: filtrer(corps.docSigSource, SOURCES, "DEDIEE"),
      tamponDecalX: borner(corps.tamponDecalX, -1500, 1500, 0),
      tamponDecalY: borner(corps.tamponDecalY, -1500, 1500, 0),
      tamponRotation: borner(corps.tamponRotation, 0, 360, 0),
      tamponSource: filtrer(corps.tamponSource, SOURCES, "DEDIEE"),
      docQrActif: Boolean(corps.docQrActif),
      docQrMode: filtrer(corps.docQrMode, MODES_QR, "DONNEES"),
      docQrUrl: String(corps.docQrUrl ?? "").trim().slice(0, 500),
      docQrTexte: String(corps.docQrTexte ?? "").slice(0, 500),
      docQrPosition: filtrer(corps.docQrPosition, POSITIONS, "BAS_GAUCHE"),
      docQrTaille: borner(corps.docQrTaille, 40, 1200, 110),
      docQrDecalX: borner(corps.docQrDecalX, -1500, 1500, 0),
      docQrDecalY: borner(corps.docQrDecalY, -1500, 1500, 0),
      docQrRotation: borner(corps.docQrRotation, 0, 360, 0),
      docQrSource: filtrer(corps.docQrSource, SOURCES, "DEDIEE"),
      docElecActif: Boolean(corps.docElecActif),
      docElecPosition: filtrer(corps.docElecPosition, POSITIONS, "BAS_DROITE"),
      docElecDecalX: borner(corps.docElecDecalX, -1500, 1500, 0),
      docElecDecalY: borner(corps.docElecDecalY, -1500, 1500, 0),
      docElecTaille: borner(corps.docElecTaille, 50, 300, 100),
      docElecForme: filtrer(corps.docElecForme, FORMES_ELEC, "RECTANGLE"),
      docElecAffSignataire: Boolean(corps.docElecAffSignataire),
      docElecAffOrganisation: Boolean(corps.docElecAffOrganisation),
      docElecAffEmetteur: Boolean(corps.docElecAffEmetteur),
      docElecAffValidite: Boolean(corps.docElecAffValidite),
      docElecAffEmpreinte: Boolean(corps.docElecAffEmpreinte),
      docElecTexteLibre: String(corps.docElecTexteLibre ?? "").slice(0, 120),
      docCertSource: filtrer(corps.docCertSource, SOURCES_CERT, "MODULE"),
    };

    // Mot de passe du certificat : remplacé SEULEMENT si le champ est présent.
    if ("certMotDePasse" in corps) {
      const mdp = String(corps.certMotDePasse ?? "");
      data.certMotDePasse = mdp ? chiffrerChamp(mdp, false) : "";
    }

    // Paraphe image (même convention que sigImage : présent = remplacé).
    if ("docSigImage" in corps) {
      const img = String(corps.docSigImage ?? "");
      if (img === "") {
        data.docSigImage = "";
        data.docSigImageNom = "";
        data.docSigImageChemin = "";
      } else if (/^data:image\/(png|jpe?g);base64,/.test(img) && img.length <= TAILLE_IMAGE_MAX) {
        data.docSigImage = img;
        data.docSigImageNom = nomFichierAffichable(corps.docSigImageNom);
        data.docSigImageChemin = await exporterCopieTampon(img, "paraphe");
      } else {
        return NextResponse.json(
          { error: "Image de paraphe invalide (PNG ou JPEG attendu, 8 Mo maximum)." },
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
        data.tamponImageChemin = await exporterCopieTampon(img, "tampon-doc");
      } else {
        return NextResponse.json(
          { error: "Image de tampon invalide (PNG ou JPEG attendu, 8 Mo maximum)." },
          { status: 400 }
        );
      }
    }

    // (v0.2.143) Image de QR FOURNI dédiée aux documents de réponse (mode
    // IMAGE) — même convention « présent = remplacé » que sigImage.
    if ("docQrImage" in corps) {
      const img = String(corps.docQrImage ?? "");
      if (img === "") {
        data.docQrImage = "";
        data.docQrImageNom = "";
      } else if (/^data:image\/(png|jpe?g);base64,/.test(img) && img.length <= TAILLE_IMAGE_MAX) {
        data.docQrImage = img;
        data.docQrImageNom = nomFichierAffichable(corps.docQrImageNom);
      } else {
        return NextResponse.json(
          { error: "Image de QR invalide (PNG ou JPEG attendu, 8 Mo maximum)." },
          { status: 400 }
        );
      }
    }

    const cfg = await db.signatureConfig.upsert({
      where: { id: "signature" },
      update: data,
      create: { id: "signature", ...data },
    });
    return NextResponse.json({
      ok: true,
      certificat: { hasCertPassword: Boolean(cfg.certMotDePasse), present: Boolean(cfg.certChemin) },
    });
  } catch (error) {
    console.error("[DOC-SIGNER-CONFIG] PUT:", error);
    return NextResponse.json({ error: "Enregistrement impossible." }, { status: 500 });
  }
}

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

    /* ---- Import du certificat (.p12/.pfx) ---- */
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
      // VALIDATION : lecture PKCS#12 avec le mot de passe fourni (module partagé)
      const mod = await import("../../../../scripts/document-acceptation.js");
      const diag = mod.verifierContenuCertificat(octets, motDePasse);
      if (!diag.ok) {
        return NextResponse.json({ error: diag.message }, { status: 400 });
      }
      const dir = certificatsDir();
      await mkdir(dir, { recursive: true });
      const horodatage = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
      const nomStocke = `certificat-${horodatage}.p12`;
      await writeFile(path.join(dir, nomStocke), encryptForStorage(octets));
      const empreinte = crypto.createHash("sha256").update(octets).digest("hex");
      const cfg = await db.signatureConfig.upsert({
        where: { id: "signature" },
        update: {
          certChemin: `storage/signature-certificat/${nomStocke}`,
          certNom: nomFichierAffichable(fichier.name),
          certEmpreinte: empreinte,
          certImporteLe: new Date(),
          // (CORRECTIF v0.2.201) : chiffrerChamp retourne `string | null |
          // undefined` selon sa signature, mais `motDePasse` est `string`
          // (non-null) — on coerce `null | undefined` en `""` avec `?? ""`
          // pour satisfaire le type Prisma (champ non-null avec défaut "").
          // Comportement runtime identique : chiffrerChamp ne renvoie jamais
          // null quand l'entrée est string.
          certMotDePasse: chiffrerChamp(motDePasse, false) ?? "",
        },
        create: {
          id: "signature",
          certChemin: `storage/signature-certificat/${nomStocke}`,
          certNom: nomFichierAffichable(fichier.name),
          certEmpreinte: empreinte,
          certImporteLe: new Date(),
          certMotDePasse: chiffrerChamp(motDePasse, false) ?? "",
        },
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
      const cfg = await db.signatureConfig.findUnique({ where: { id: "signature" } });
      if (cfg?.certChemin) {
        try {
          // chemin relatif « storage/… » résolu depuis la RACINE (grand-parent
          // de storage/payslips — même résolution que src/lib/doc-signe.ts)
          await unlink(path.join(path.dirname(path.dirname(getStorageDir())), cfg.certChemin));
        } catch { /* fichier déjà absent */ }
      }
      await db.signatureConfig.upsert({
        where: { id: "signature" },
        update: { certChemin: "", certNom: "", certEmpreinte: "", certImporteLe: null, certMotDePasse: "" },
        create: { id: "signature" },
      });
      return NextResponse.json({ ok: true });
    }

    /* ---- Diagnostic du certificat configuré ---- */
    if (action === "verifier-certificat") {
      const diag = await verifierCertificatDoc();
      return NextResponse.json(diag.ok ? { ok: true, ...diag } : { ok: false, message: diag.message });
    }

    /* ---- APERÇU (généré + tamponné + signé, non stocké, non envoyé) ---- */
    if (action === "apercu") {
      const demandeId = String(form.get("demandeId") ?? "").trim() || null;
      const r = await apercuDocumentSigne(demandeId);
      return new NextResponse(new Uint8Array(r.pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(r.pdf.length),
          "Content-Disposition": "inline; filename=\"apercu-document-signe.pdf\"",
          "Cache-Control": "no-store",
          "X-Apercu-Signature-Crypto": r.signatureCrypto ? "1" : "0",
          "X-Apercu-Elements": encodeURIComponent(r.elements.join(",")),
          "X-Apercu-Reference": encodeURIComponent(r.reference),
        },
      });
    }

    /* ---- TEST D'ENVOI à l'adresse fournie ---- */
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
      const r = await apercuDocumentSigne(null);
      const mod = await import("../../../../scripts/document-acceptation.js");
      const cfg = await mod.chargerConfig(db);
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
        "Test_document_signe.pdf",
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
          action: "doc-signe",
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
          action: "doc-signe",
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
    console.error("[DOC-SIGNER-CONFIG] POST:", error);
    return NextResponse.json({ error: "Opération impossible." }, { status: 500 });
  }
}
