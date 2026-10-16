/**
 * ============================================================================
 *  NOUVEAU (v0.2.51) — RÉPONSE DIRECTE DU SERVICE RH : IMPORT DU DOCUMENT
 *  DE RÉPONSE DEPUIS LE DÉTAIL D'UNE DEMANDE ADMINISTRATIVE
 * ============================================================================
 *  Demande utilisateur : « Permettre au service RH, directement depuis une
 *  demande administrative, d'importer le document nécessaire pour répondre à
 *  la demande de l'employé… ajouter automatiquement ou manuellement une
 *  signature électronique ; ajouter un code QR ; visualiser un aperçu avant
 *  validation ; valider et envoyer le document à l'employé — l'employé reçoit
 *  la réponse dans son portail. »
 *
 *  POST /api/demandes/[id]/repondre   (multipart/form-data)
 *   - document      : File (pdf, doc, docx, png, jpg, jpeg — 15 Mo max, MÊMES
 *                     règles que la réception e-mail du portail) ;
 *   - mode          : "apercu" (renvoie le document FINAL tamponné en binaire
 *                     inline — iframe PDF / <img> image — X-Document-Apercu*
 *                     en en-têtes) | "valider" (stockage chiffré + e-mail) ;
 *   - tampon        : "aucun" | "auto" (signature/QR/mention de la
 *                     configuration globale — « automatique ») | "manuel"
 *                     (options ci-dessous pour CE document uniquement) ;
 *   - options       : JSON des réglages manuels (sigActif, sigTexte,
 *                     sigPosition, sigTaille, sigOpacite, qrActif, qrPosition,
 *                     qrTaille, mentionActif, mentionTexte, décalages) —
 *                     mêmes bornes que /api/signature-config.
 *
 *  À LA VALIDATION (même parcours que la réponse e-mail du RH, Task 122) :
 *   - le document FINAL (tamponné) est stocké CHIFFRÉ (AES-256-GCM,
 *     en-tête PAIESAGE1) dans storage/documents-demandes/ ;
 *   - DocumentDemande créé (dédupliqué par empreinte SHA-256 PAR demande) ;
 *   - statut automatique Acceptée si EN_ATTENTE / INFORMATION_REQUISE
 *     (traitePar = compte RH/IT connecté, « Import direct (administration) ») ;
 *   - notification e-mail « votre document est disponible » à l'employé
 *     (envoyerEmailDocumentRepondu, journalisée — JAMAIS bloquante) ;
 *   - l'employé voit le document dans « Mes demandes » du portail (4001)
 *     avec les boutons Visualiser / Télécharger (servage déchiffré).
 *
 *  Accès : RH et SUPERADMIN — IT REFUSÉ (403 FONCTIONNALITE_NON_AUTORISEE_IT,
 *  v0.2.100 : matrice des rôles, « Réponse avec document » = Non). Mot de
 *  passe expiré → 403.
 * ============================================================================
 */
import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
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
import { matriculeEmploye } from "@/lib/matricule";
import { getStorageDir, assurerDossierPrive } from "@/lib/storage-dir";
import { encryptForStorage } from "@/lib/storage-crypto";
import {
  tamponnerFicheDossier,
  jetonReponse,
  type ConfigTampon,
  type InfosFiche,
  type TypeFichierTampon,
} from "@/lib/stamp";
import {
  envoyerEmailDocumentRepondu,
  journaliserEnvoi,
  lireConfigMail,
  type PieceJointeEmail,
} from "@/lib/mailer";
import { lireLigneReponseAvecContinuite } from "@/lib/signature-reponse";
// NOUVEAU (Task 224) : signature électronique PAdES des documents de
// réponse (API de certification & signature — copie signée conservée,
// certificat associé enregistré, vérification automatique).
import {
  lireConfigSignatureApi,
  signerEtConserver,
  completerConfigTamponAvecElec,
} from "@/lib/signature-api";
import {
  destinataireNotificationDemande,
  statutFinalDepuisDecisions,
  typeDeuxEtapes,
  libelleType,
  masquerCin,
  nomEmployeDepuisFiches,
} from "@/lib/demandes";
// (NOUVEAU Task 179/180) génération automatique du document d'acceptation
// signé & tamponné et du document de REFUS signé & tamponné.
import {
  declencherDocumentRefus,
  declencherDocumentSigne,
  estDocumentSigConcerne,
} from "@/lib/doc-signe";

export const runtime = "nodejs";

/** Mêmes extensions que la réception e-mail du portail (EXTENSIONS_DOCUMENTS). */
const EXTENSIONS = ["pdf", "doc", "docx", "jpg", "jpeg", "png"];
const TAILLE_MAX = 15 * 1024 * 1024; // 15 Mo (identique au portail)

const POSITIONS = ["BAS_DROITE", "BAS_GAUCHE", "HAUT_DROITE", "HAUT_GAUCHE"];

function extensionDe(nom: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(String(nom ?? "").trim().toLowerCase());
  return m ? m[1] : "";
}

/** Nom d'origine assaini (même esprit que le portail : affichage sûr). */
function assainirNom(nom: string): string {
  const brut = String(nom ?? "").trim();
  const base = brut.replace(/[\\/:*?"<>|\r\n\0]/g, "_").replace(/\s+/g, " ").slice(0, 120);
  return base || "document.pdf";
}

function mimeDepuisExtension(ext: string): string {
  switch (ext) {
    case "pdf": return "application/pdf";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "doc": return "application/msword";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default: return "application/octet-stream";
  }
}

/** Type tamponnable déduit de l'EXTENSION (null = document servi tel quel). */
function typeTamponnable(ext: string): TypeFichierTampon | null {
  if (ext === "pdf") return "pdf";
  if (ext === "png" || ext === "jpg" || ext === "jpeg") return "image";
  if (ext === "docx") return "docx";
  return null; // .doc binaire historique : jamais tamponné (comme .xls)
}

function filtrer(v: unknown, autorises: string[], defaut: string): string {
  return autorises.includes(String(v)) ? String(v) : defaut;
}
function borner(n: unknown, min: number, max: number, defaut: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return defaut;
  return Math.round(Math.max(min, Math.min(max, x)));
}

// (NOUVEAU 0.2.54) mêmes bornes que /api/signature-config (positionnement
// libre sur toute la feuille + tailles élargies + rotations 0→360°)
// NB : TAILLE_STAMP_* pour ne pas entrer en collision avec TAILLE_MAX
// (limite d'upload de 15 Mo déclarée plus haut dans ce fichier)
const DECAL_MIN = -1500;
const DECAL_MAX = 1500;
const TAILLE_STAMP_MIN = 40;
const TAILLE_STAMP_MAX = 1200;
// (NOUVEAU v0.2.92) positions + échelle du BLOC CERTIFICAT en mode manuel —
// mêmes bornes que /api/signature-config.
const POSITIONS_CERT = ["BAS_CENTRE", "BAS_DROITE", "BAS_GAUCHE", "HAUT_DROITE", "HAUT_GAUCHE"];
const CERT_TAILLE_MIN = 50;
const CERT_TAILLE_MAX = 300;

/** Réglages manuels validés (mêmes bornes que /api/signature-config —
 * (LIBÉRÉ/ÉTENDU 0.2.54) : décalages ±1500 pt, tailles 40–1200 pt,
 * rotations 0–360° sens horaire). */
function optionsVersConfig(optionsBrutes: unknown, globale: ConfigTampon): ConfigTampon {
  const o = (optionsBrutes && typeof optionsBrutes === "object" ? optionsBrutes : {}) as Record<string, unknown>;
  return {
    actif: true, // le RH a explicitement demandé le tampon pour CE document
    sigActif: Boolean(o.sigActif),
    sigImage: globale.sigImage, // l'image de signature reste celle configurée
    sigTexte: String(o.sigTexte ?? "").slice(0, 300),
    sigPosition: filtrer(o.sigPosition, POSITIONS, "BAS_DROITE"),
    sigTaille: borner(o.sigTaille, TAILLE_STAMP_MIN, TAILLE_STAMP_MAX, 120),
    sigOpacite: Math.max(0.3, Math.min(1, Number(o.sigOpacite) || 0.9)),
    qrActif: Boolean(o.qrActif),
    qrMode: globale.qrMode || "DONNEES",
    qrUrl: globale.qrUrl,
    qrTexte: globale.qrTexte,
    qrImage: globale.qrImage,
    qrPosition: filtrer(o.qrPosition, POSITIONS, "BAS_GAUCHE"),
    qrTaille: borner(o.qrTaille, TAILLE_STAMP_MIN, TAILLE_STAMP_MAX, 110),
    sigDecalX: borner(o.sigDecalX, DECAL_MIN, DECAL_MAX, 0),
    sigDecalY: borner(o.sigDecalY, DECAL_MIN, DECAL_MAX, 0),
    qrDecalX: borner(o.qrDecalX, DECAL_MIN, DECAL_MAX, 0),
    qrDecalY: borner(o.qrDecalY, DECAL_MIN, DECAL_MAX, 0),
    // (NOUVEAU 0.2.54) rotations manuelles : degrés horaires 0 → 360
    sigRotation: borner(o.sigRotation, 0, 360, 0),
    qrRotation: borner(o.qrRotation, 0, 360, 0),
    mentionActif: Boolean(o.mentionActif),
    mentionTexte: String(o.mentionTexte ?? "").slice(0, 300),
    // (NOUVEAU v0.2.92) CASE À COCHER + POSITIONNEMENT du certificat en mode
    // manuel — mêmes bornes que /api/signature-config. Les MÉTADONNÉES du
    // certificat importé (certSujet/…) restent celles de la configuration
    // globale : le RH choisit seulement SI le certificat est apposé sur CE
    // document et OÙ il est dessiné.
    certActif: Boolean(o.certActif),
    certPosition: filtrer(o.certPosition, POSITIONS_CERT, "BAS_CENTRE"),
    certDecalX: borner(o.certDecalX, DECAL_MIN, DECAL_MAX, 0),
    certDecalY: borner(o.certDecalY, DECAL_MIN, DECAL_MAX, 0),
    certTaille: borner(o.certTaille, CERT_TAILLE_MIN, CERT_TAILLE_MAX, 100),
    certSujet: globale.certSujet,
    certEmetteur: globale.certEmetteur,
    certSerie: globale.certSerie,
    certValideAu: globale.certValideAu,
    certEmpreinte: globale.certEmpreinte,
  };
}

function formatFr(d: Date): string {
  try {
    return d.toLocaleString("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return d.toISOString();
  }
}

function parseDonnees(brut: string): Record<string, unknown> {
  try {
    return JSON.parse(brut || "{}");
  } catch {
    return {};
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  // (MODIFIÉ v0.2.100 — matrice des rôles) « Réponse avec document (import
  // direct ; tampon automatique lu dans la config des réponses) » = Non pour
  // l'IT : refus PROPRE côté serveur (avant : l'IT était admis ici alors
  // qu'aucune interface ne lui est exposée). Rôles admis : RH et SUPERADMIN.
  if (session.role !== "RH" && !estSuperadmin(session)) {
    return refusIT("la réponse aux demandes du portail administratif (import direct avec tampon)");
  }
  try {
    const { id } = await params;
    const d = await db.demandeAdministrative.findUnique({ where: { id } });
    if (!d) {
      return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Requête invalide : envoyez un formulaire multipart avec le document." },
        { status: 400 }
      );
    }
    const fichier = form.get("document");
    if (!(fichier instanceof File) || !fichier.size) {
      return NextResponse.json({ error: "Aucun document reçu : sélectionnez le fichier à envoyer." }, { status: 400 });
    }
    const mode = String(form.get("mode") ?? "apercu").trim() === "valider" ? "valider" : "apercu";
    const choixTampon = String(form.get("tampon") ?? "auto").trim();
    if (!["aucun", "auto", "manuel"].includes(choixTampon)) {
      return NextResponse.json({ error: "Option de tampon inconnue (aucun, auto ou manuel)." }, { status: 400 });
    }
    // Réglages MANUELS (champ JSON « options » du formulaire multipart)
    let optionsManuelles: unknown = null;
    if (choixTampon === "manuel") {
      try {
        optionsManuelles = JSON.parse(String(form.get("options") ?? "{}") || "{}");
      } catch {
        return NextResponse.json({ error: "Réglages manuels illisibles (options JSON invalide)." }, { status: 400 });
      }
    }
    const ext = extensionDe(fichier.name);
    if (EXTENSIONS.indexOf(ext) < 0) {
      return NextResponse.json(
        { error: "Format non accepté (" + (ext || "sans extension") + ") — formats acceptés : " + EXTENSIONS.join(", ") + "." },
        { status: 400 }
      );
    }
    if (fichier.size > TAILLE_MAX) {
      return NextResponse.json(
        { error: "Document trop volumineux (" + Math.round(fichier.size / 1048576) + " Mo) : 15 Mo maximum." },
        { status: 400 }
      );
    }

    const donneesOrigine: Buffer = Buffer.from(await fichier.arrayBuffer());
    const nomFichier = assainirNom(fichier.name);
    const typeTampon = typeTamponnable(ext);
    const avertissements: string[] = [];

    // ---- Tampon : aucun / auto (configuration RÉPONSES — v0.2.93) / manuel ----
    let donneesFinales: Buffer = donneesOrigine;
    let tamponApplique = false;
    // (NOUVEAU v0.2.119) cachet « Signature électronique » apposé ? (repli)
    let cachetElecAppose = false;
    // Re-tamponnage SANS cachet (assigné dans le bloc tampon si le cachet a
    // été apposé — la closure capture les infos/type configurés).
    let retamponnerSansCachet: (() => Promise<Buffer>) | null = null;
    if (choixTampon !== "aucun" && typeTampon) {
      // Configuration « Import » (fiches de paie) : source des SEULS actifs
      // encore partagés (image de signature/cachet, image de QR fourni) —
      // (v0.2.99) le certificat des réponses est DÉDIÉ (ligne réponses).
      const globale = (await db.signatureConfig.findUnique({ where: { id: "signature" } })) ?? {
        actif: false, sigActif: false, sigImage: "", sigTexte: "", sigPosition: "BAS_DROITE",
        sigTaille: 120, sigOpacite: 0.9, qrActif: false, qrMode: "DONNEES", qrUrl: "", qrTexte: "",
        qrImage: "", qrPosition: "BAS_GAUCHE", qrTaille: 110,
        sigDecalX: 0, sigDecalY: 0, qrDecalX: 0, qrDecalY: 0,
        sigRotation: 0, qrRotation: 0,
        mentionActif: true, mentionTexte: "Document signé électroniquement — AutoRH — {DATE}",
        certActif: false, certSujet: "", certEmetteur: "", certSerie: "",
        certValideAu: null, certEmpreinte: "",
        certPosition: "BAS_CENTRE", certDecalX: 0, certDecalY: 0, certTaille: 100,
      };
      // (NOUVEAU v0.2.93 — SÉPARATION DES CONFIGURATIONS) la section
      // « Demandes / Réponses » possède sa PROPRE configuration
      // (SignatureConfigReponse) : interrupteurs, textes, mode/URL du QR et
      // TOUS les paramètres de positionnement des trois éléments (signature,
      // QR, certificat). CONTINUITÉ : tant que la configuration réponses
      // n'a pas été enregistrée (ligne absente), le comportement historique
      // s'applique (configuration Import utilisée telle quelle).
      // (MODIFIÉ v0.2.99) lecture AVEC continuité du certificat (copie
      // unique des métadonnées « Import » dans la ligne réponses, une seule
      // fois, pour les installations où le fichier était partagé) ; et le
      // CERTIFICAT est désormais DÉDIÉ : seules les IMAGES (signature/
      // cachet, QR fourni) restent issues de la configuration « Import » —
      // les métadonnées du certificat (titulaire, émetteur, série, validité,
      // empreinte) viennent de la ligne réponses ELLE-MÊME : une
      // modification du certificat dans Import n'affecte plus les réponses,
      // et inversement.
      const repRow = await lireLigneReponseAvecContinuite();
      const base: ConfigTampon = repRow
        ? {
            ...(repRow as unknown as ConfigTampon),
            sigImage: globale.sigImage,
            qrImage: globale.qrImage,
          }
        : (globale as unknown as ConfigTampon);
      // (NOUVEAU v0.2.119) le cachet « Signature électronique » (Switch
      // elecActif de la section Demandes/Réponses) est alimenté EN DIRECT par
      // le certificat du module de signature — injection avant l'évaluation
      // du tampon ; la signature PAdES est appliquée JUSTE APRÈS sur les
      // mêmes octets (cachet couvert par elle). En mode manuel, l'élément
      // suit la configuration enregistrée (pas encore de case dédiée).
      const construireCfg = async (injecterElec: boolean): Promise<ConfigTampon> => {
        const brute: ConfigTampon =
          choixTampon === "manuel"
            ? optionsVersConfig(optionsManuelles, base)
            : repRow
              ? // Configuration réponses enregistrée : SON interrupteur général
                // « Tampon automatique des réponses » est respecté (OFF = le
                // mode Automatique n'appose rien — avertissement affiché).
                base
              : { ...base, actif: true }; // repli historique : configuration Import, activation forcée
        if (!injecterElec) return brute;
        return (await completerConfigTamponAvecElec(brute, "REPONSES")) as ConfigTampon;
      };
      const cfg: ConfigTampon = await construireCfg(true);
      // InfosFiche de la DEMANDE : le QR (mode DONNÉES) porte la référence, le
      // type, l'employé et une empreinte HMAC de contrôle (titre → en-tête
      // « Document officiel » au lieu de « Fiche de paie »).
      const donneesForm = parseDonnees(d.donnees);
      const nomFormulaire =
        [donneesForm["prenom"], donneesForm["nom"]].filter(Boolean).join(" ").trim() ||
        String(donneesForm["nomParrain"] ?? "").trim();
      const infos: InfosFiche = {
        id: d.reference,
        employeeName:
          nomFormulaire ||
          (await nomEmployeDepuisFiches(d.cin)) ||
          "",
        cin: d.cin,
        period: libelleType(d.type),
        netSalary: "",
        uploadedAt: d.createdAt,
        titre: "AutoRH — Document officiel",
        objet: libelleType(d.type),
      };
      // (NOUVEAU v0.2.88 ; MODIFIÉ v0.2.97 — demande utilisateur) MODE
      // « FICHE EN LIGNE » CHOISI EXPLICITEMENT : le QR du document de réponse
      // encode l'adresse publique de vérification —
      //   {qrUrl}/verification/reponse/{reference}?t={jeton signé}
      // même principe que le QR « Fiche en ligne » des fiches de paie : le
      // scan ouvre la page PUBLIQUE (sans connexion, protégée par le jeton
      // HMAC) qui atteste l'authenticité de la réponse et ouvre ses
      // documents. Jusqu'ici l'URL était FORCÉE dès que qrUrl était
      // renseignée (prioritaire sur le mode) ; elle devient le comportement
      // DU MODE FICHE — les autres modes (DONNEES/URL/TEXTE/IMAGE) encodent
      // leur contenu propre. qrUrl vide → pas d'URL (le QR retombe sur le
      // mode configuré) ; les fiches de paie ne sont JAMAIS affectées.
      const baseQr = String(cfg.qrUrl ?? "").trim().replace(/\/+$/, "");
      if (cfg.qrMode === "FICHE" && baseQr) {
        infos.urlVerification =
          baseQr +
          "/verification/reponse/" +
          encodeURIComponent(d.reference) +
          "?t=" +
          jetonReponse(d.reference);
      }
      try {
        const tamponne = await tamponnerFicheDossier(donneesOrigine, infos, cfg, typeTampon);
        // Les moteurs renvoient le buffer ORIGINAL quand rien n'est dessiné
        // (tampon inactif) — comparaison par référence : fiable et sans copie.
        tamponApplique = tamponne !== donneesOrigine;
        donneesFinales = tamponne;
      } catch (e) {
        console.error("[DEMANDES/RÉPONSE] tampon impossible:", e);
        avertissements.push(
          "Le tampon n'a pas pu être appliqué sur ce document : il est envoyé SANS signature ni QR."
        );
        donneesFinales = donneesOrigine;
      }
      // (NOUVEAU v0.2.119) mémorise si le cachet « Signature électronique »
      // était apposé (pour le repli sans cachet si la signature échoue).
      if (tamponApplique && cfg.elecActif && cfg.elec) {
        cachetElecAppose = true;
        const typeTamponValide = typeTampon;
        retamponnerSansCachet = async () => {
          const cfgSansElec = await construireCfg(false);
          return await tamponnerFicheDossier(donneesOrigine, infos, cfgSansElec, typeTamponValide);
        };
      }
      if (!tamponApplique && !avertissements.length) {
        avertissements.push(
          "Aucun élément de tampon actif (vérifiez la signature électronique, le QR ou la mention dans la configuration)."
        );
      }
    } else if (choixTampon !== "aucun" && !typeTampon) {
      avertissements.push(
        "Format " + ext.toUpperCase() + " : signature électronique et QR non applicables — document envoyé tel quel."
      );
    }

    // NOUVEAU (Task 224) — SIGNATURE ÉLECTRONIQUE PAdES DU DOCUMENT DE
    // RÉPONSE (API de certification & signature) : le PDF FINAL (tamponné)
    // est signé CRYPTOGRAPHIQUEMENT avant l'aperçu, le stockage et l'e-mail
    // — l'employé reçoit le document SIGNÉ (pièce jointe ET portail), la
    // copie signée est CONSERVÉE et le CERTIFICAT associé est enregistré
    // (registre + vérification automatique de l'intégrité).
    // JAMAIS bloquant : en cas d'échec, un AVERTISSEMENT explicite informe
    // que le document part SANS signature (même discipline que le tampon).
    let signatureElectronique = ""; // message affiché dans l'aperçu/validation
    if (ext === "pdf") {
      try {
        const cfgSig = await lireConfigSignatureApi();
        if (cfgSig.actif && cfgSig.signerReponses) {
          const resultat = await signerEtConserver(donneesFinales, {
            type: "REPONSE",
            sourceId: d.id,
            reference: d.reference,
            nomFichier,
            signePar: "administration — " + session.email,
          });
          if (resultat.ok && resultat.pdf) {
            donneesFinales = resultat.pdf;
            signatureElectronique =
              (resultat.dejaSigne ? "Copie signée conservée servie — " : "") +
              resultat.message;
          } else {
            avertissements.push(
              "Signature électronique impossible : " + resultat.message + " Le document est envoyé SANS signature cryptographique."
            );
            // (NOUVEAU v0.2.119) GARANTIE cachet ⇒ signature : si le document
            // tamponné porte le cachet « Signature électronique », il est
            // re-tamponné SANS cachet (jamais cacheté mais non signé).
            if (cachetElecAppose && retamponnerSansCachet) {
              try {
                const retamponne = await retamponnerSansCachet();
                if (retamponne !== donneesOrigine) {
                  donneesFinales = retamponne;
                  avertissements.push(
                    "Le cachet « Signature électronique » a été retiré du document (signature cryptographique indisponible)."
                  );
                }
              } catch (e2) {
                console.error("[DEMANDES/RÉPONSE] re-tamponnage sans cachet impossible:", e2);
              }
            }
          }
        }
      } catch (e) {
        console.error("[DEMANDES/RÉPONSE] signature électronique impossible:", e);
        avertissements.push(
          "Signature électronique impossible : " +
            (e instanceof Error ? e.message : String(e)) +
            " Le document est envoyé SANS signature cryptographique."
        );
      }
    }

    // ---- APERÇU : document FINAL renvoyé en binaire inline ----
    if (mode === "apercu") {
      if (ext === "doc" || ext === "docx") {
        return NextResponse.json(
          {
            apercuDisponible: false,
            note:
              "Format Word : pas d'aperçu navigateur — le document sera stocké et envoyé tel quel" +
              (tamponApplique ? " (tampon intégré au fichier)" : "") +
              ". Utilisez « Valider et envoyer ».",
          },
          { status: 200 }
        );
      }
      const mime = mimeDepuisExtension(ext);
      return new NextResponse(new Uint8Array(donneesFinales), {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Content-Disposition": "inline",
          "Cache-Control": "no-store",
          "X-Document-Apercu-Tampon": tamponApplique ? "1" : "0",
          // (NOUVEAU Task 224) l'aperçu signale la signature électronique
          // (message complet en X-Signature-Electronique-Apercu, encodé)
          "X-Document-Apercu-Signature": signatureElectronique ? "1" : "0",
          ...(signatureElectronique
            ? { "X-Signature-Electronique-Apercu": encodeURIComponent(signatureElectronique) }
            : {}),
          ...(avertissements.length
            ? { "X-Document-Apercu-Avertissements": encodeURIComponent(avertissements.join(" ")) }
            : {}),
        },
      });
    }

    // ---- VALIDATION : stockage chiffré + statut + e-mail ----
    const empreinte = crypto.createHash("sha256").update(donneesFinales).digest("hex");
    // Déduplication sur les octets ORIGINAUX (avant tampon) : la mention
    // légale datée {DATE} fait varier les octets finaux d'une minute à
    // l'autre alors que le RH réimporte le MÊME fichier.
    const empreinteOrigine = crypto.createHash("sha256").update(donneesOrigine).digest("hex");
    const deja = await db.documentDemande.findFirst({
      where: { demandeId: d.id, empreinteOrigine },
      select: { id: true },
    });
    if (deja) {
      return NextResponse.json(
        { error: "Ce document (même contenu) a déjà été transmis pour cette demande — doublon refusé." },
        { status: 409 }
      );
    }

    // Dossier documents-demandes : voisin du dossier des fiches (MÊME
    // convention que le portail — dossierEcritureDocumentsDemandes).
    const dossier = path.join(path.dirname(getStorageDir()), "documents-demandes");
    // Task 209 : dossier PRIVÉ 0700 (création + rattrapage chmod) — les
    // documents des demandes sont des pièces personnelles d'employés.
    await assurerDossierPrive(dossier);
    const existants = await db.documentDemande.count({ where: { demandeId: d.id } });
    const nomStocke =
      d.reference + "-" + Date.now() + "-" + (existants + 1) + "-" + empreinte.slice(0, 8) + "." + ext;
    await writeFile(path.join(dossier, nomStocke), encryptForStorage(donneesFinales), { mode: 0o600 });
    const doc = await db.documentDemande.create({
      data: {
        demandeId: d.id,
        nomFichier,
        chemin: nomStocke,
        taille: donneesFinales.length,
        typeMime: mimeDepuisExtension(ext),
        empreinte,
        empreinteOrigine,
        recuDe: "Import direct — " + session.email,
      },
    });

    // Statut (MODIFIÉ v0.2.110 — demande utilisateur « Statut des demandes
    // avec pièce jointe ») : le formulaire « Répondre avec un document »
    // porte désormais une DÉCISION explicite facultative (decision =
    // « ACCEPTEE » | « REFUSEE » | « AUCUNE » (défaut)). Le statut de la
    // demande reflète ALORS la décision, la pièce jointe restant affichée
    // et accessible EN PLUS du statut :
    //   - REFUSEE  → statut « Refusée » (+ document) ;
    //   - ACCEPTEE → statut « Acceptée » (+ document) — décision explicite
    //     autorisée même si le statut était déjà posé (correction RH) ;
    //   - AUCUNE   → comportement historique v0.2.51 conservé : réponse
    //     avec document = demande traitée (Acceptée si En attente /
    //     Information requise — un statut Refusée existant n'est PAS
    //     modifié sans décision explicite).
    const decision = filtrer(
      form.get("decision"),
      ["AUCUNE", "ACCEPTEE", "REFUSEE"],
      "AUCUNE"
    );
    let statut = d.statut;
    const maj: Record<string, unknown> = {};
    // (MODIFIÉ Task 181) CONGÉ / AUTORISATION DE SORTIE (validation à deux
    // étapes) : la décision du RH (import du document de réponse, décision
    // explicite ou implicite) est TRACÉE (decisionRh) et le statut final suit
    // la MATRICE — si le manager n'a pas encore décidé, la demande RESTE
    // « En attente » et la notification employé ne part qu'à la décision
    // finale. Les autres types : flux historique (v0.2.110 conservé).
    let enAttenteManager = false;
    let refuseeParFinal: string | null = null;
    if (decision === "REFUSEE") {
      statut = "REFUSEE";
      maj.statut = "REFUSEE";
      maj.decisionRh = "REFUSEE";
      maj.decisionRhLe = new Date();
      maj.decisionRhPar = session.email;
      refuseeParFinal = "RH";
      maj.traitePar = "Réponse avec document (administration) — " + session.email;
      maj.traiteLe = new Date();
      maj.commentaire = "Réponse : Refusée — le document « " + nomFichier + " » est joint et disponible dans le portail de l'employé.";
    } else if (decision === "ACCEPTEE") {
      if (typeDeuxEtapes(d.type)) {
        maj.decisionRh = "ACCEPTEE";
        maj.decisionRhLe = new Date();
        maj.decisionRhPar = session.email;
        const finale = statutFinalDepuisDecisions(d.decisionManager, "ACCEPTEE");
        statut = finale.statut;
        refuseeParFinal = finale.refuseePar;
        if (statut === "EN_ATTENTE") {
          enAttenteManager = true;
          maj.statut = d.statut === "INFORMATION_REQUISE" ? "EN_ATTENTE" : d.statut;
        } else {
          maj.statut = statut;
          maj.traitePar = "Réponse avec document (administration) — " + session.email;
          maj.traiteLe = new Date();
          maj.commentaire = "Réponse : Acceptée — le document « " + nomFichier + " » est joint et disponible dans le portail de l'employé.";
        }
      } else {
        statut = "ACCEPTEE";
        maj.statut = "ACCEPTEE";
        maj.traitePar = "Réponse avec document (administration) — " + session.email;
        maj.traiteLe = new Date();
        maj.commentaire = "Réponse : Acceptée — le document « " + nomFichier + " » est joint et disponible dans le portail de l'employé.";
      }
    } else if (d.statut === "EN_ATTENTE" || d.statut === "INFORMATION_REQUISE") {
      maj.decisionRh = "ACCEPTEE";
      maj.decisionRhLe = new Date();
      maj.decisionRhPar = session.email;
      if (typeDeuxEtapes(d.type)) {
        const finale = statutFinalDepuisDecisions(d.decisionManager, "ACCEPTEE");
        statut = finale.statut;
        refuseeParFinal = finale.refuseePar;
        if (statut === "EN_ATTENTE") {
          enAttenteManager = true;
          maj.statut = d.statut === "INFORMATION_REQUISE" ? "EN_ATTENTE" : d.statut;
        } else {
          maj.statut = statut;
          maj.traitePar = "Import direct (administration) — " + session.email;
          maj.traiteLe = new Date();
        }
      } else {
        statut = "ACCEPTEE";
        maj.statut = "ACCEPTEE";
        maj.traitePar = "Import direct (administration) — " + session.email;
        maj.traiteLe = new Date();
      }
      if (!d.commentaire) {
        maj.commentaire = "Document importé et transmis par le service RH depuis l'administration.";
      }
    }
    if (refuseeParFinal) maj.refuseePar = refuseeParFinal;
    if (Object.keys(maj).length) {
      await db.demandeAdministrative.update({ where: { id: d.id }, data: maj as never });
    }

    // (NOUVEAU Task 179) ACCEPTATION FINALE via import du document de réponse :
    // le document d'acceptation signé est généré pour les congés /
    // autorisations (JAMAIS bloquant — trace docSigne sur la demande, résultat
    // renvoyé). (MODIFIÉ Task 181) seulement si le statut FINAL est ACCEPTEE
    // (matrice deux étapes complète).
    let docSigne: Record<string, unknown> | null = null;
    if (
      statut === "ACCEPTEE" &&
      d.statut !== "ACCEPTEE" &&
      d.statut !== "VALIDEE" &&
      estDocumentSigConcerne(d.type, "ACCEPTEE")
    ) {
      docSigne = (await declencherDocumentSigne(d.id, {
        declencheur: "Import du document de réponse (" + session.email + ")",
      })) as Record<string, unknown>;
    }

    // (NOUVEAU Task 180/181) REFUS FINAL (décision explicite RH) : génération
    // automatique du document de refus signé & tamponné (TOUS types) — même
    // pipeline que l'acceptation, JAMAIS bloquant.
    let docRefus: Record<string, unknown> | null = null;
    if (statut === "REFUSEE" && d.statut !== "REFUSEE") {
      docRefus = (await declencherDocumentRefus(d.id, {
        declencheur: "Réponse avec document (administration) — " + session.email,
      })) as Record<string, unknown>;
    }

    // Notification « votre réponse est disponible » à l'employé (JAMAIS
    // bloquante — journalisée succès/échec comme les autres envois).
    // (MODIFIÉ v0.2.125) destinataire RÉSOLU à la réponse
    // (destinataireNotificationDemande) : e-mail COURANT de l'accès portail
    // du CIN (corrigé par le RH le cas échéant) → e-mail figé sur la
    // demande → dernier envoi connu de l'accès portail. La réponse avec
    // document part donc vers une adresse VALIDE même quand la demande n'en
    // portait pas ; la source est tracée dans la notification.
    let notification: Record<string, unknown>;
    // (MODIFIÉ Task 181) tant que le MANAGER n'a pas décidé (deux étapes),
    // le document transmis reste en attente — PAS de notification « Acceptée »
    // à l'employé (elle partira à la décision finale, avec la résolution
    // v0.2.125 conservée).
    if (enAttenteManager) {
      notification = {
        absent: true,
        enAttenteManager: true,
        note:
          "Document enregistré et décision RH enregistrée — la demande reste en attente de la décision du manager. L'employé sera notifié dès la décision finale.",
      };
    } else {
    const destResolu = await destinataireNotificationDemande(d.cin, d.employeEmail);
    if (destResolu) {
      const donneesForm = parseDonnees(d.donnees);
      const nomFormulaire =
        [donneesForm["prenom"], donneesForm["nom"]].filter(Boolean).join(" ").trim() ||
        String(donneesForm["nomParrain"] ?? "").trim();
      const nomEmploye =
        nomFormulaire ||
        (await nomEmployeDepuisFiches(d.cin)) ||
        `Employé (CIN ${masquerCin(d.cin)})`;
      // NOUVEAU (v0.2.107 — demande utilisateur, point 3) : matricule de
      // l'employé dans la notification (valeur manuelle de l'accès portail
      // prioritaire, sinon fiche la plus récente du CIN). Vide = ligne omise.
      const matricule = await matriculeEmploye(d.cin);
      const contenu = {
        reference: d.reference,
        typeLibelle: libelleType(d.type),
        nomEmploye,
        cinMasque: masquerCin(d.cin),
        matricule,
        dateDemande: formatFr(d.createdAt),
        statutLabel:
          statut === "REFUSEE"
            ? "Refusée — document disponible"
            : "Acceptée — document disponible",
        // (MODIFIÉ v0.2.106 — demande utilisateur, point 3) la notification
        // annonce la RÉPONSE et la PIÈCE JOINTE (le document est joint à
        // l'e-mail EN PLUS d'être disponible dans le portail).
        // (MODIFIÉ v0.2.110) le libellé et le commentaire reflètent la
        // DÉCISION explicite (Acceptée / Refusée) — la pièce jointe reste
        // affichée et accessible EN PLUS du statut.
        commentaire:
          statut === "REFUSEE"
            ? "Votre demande a été refusée : la réponse est jointe à cet e-mail (document « " + nomFichier + " ») " +
              "et disponible dans votre portail (rubrique Mes demandes) — boutons Visualiser et Télécharger."
            : "Votre demande a reçu une réponse : le document « " + nomFichier + " » est joint à cet e-mail " +
              "et disponible dans votre portail (rubrique Mes demandes) — boutons Visualiser et Télécharger.",
        infos: [],
      };
      // (NOUVEAU v0.2.106) le document FINAL (tamponné — mêmes octets que le
      // stockage) est JOINT à la notification, quels que soient le type de
      // demande (attestations, congé, autorisation de sortie, parrainage…).
      const piecesJointes: PieceJointeEmail[] = [
        { nom: nomFichier, contenu: donneesFinales, typeMime: mimeDepuisExtension(ext) },
      ];
      let cfgHost = "";
      let cfgPort = 0;
      let cfgSecure = false;
      try {
        const cfg = await lireConfigMail();
        cfgHost = cfg.host;
        cfgPort = cfg.port;
        cfgSecure = cfg.secure;
      } catch {
        // configuration illisible : journalisation quand même
      }
      try {
        const { messageId, from, response } = await envoyerEmailDocumentRepondu(destResolu.email, contenu, piecesJointes);
        journaliserEnvoi({
          action: "demande-document",
          dest: destResolu.email,
          from,
          host: cfgHost,
          port: cfgPort,
          secure: cfgSecure,
          succes: true,
          messageId,
          reponseSmtp: response,
          reference: d.reference,
          type: d.type,
        });
        notification = { envoye: true, destinataire: destResolu.email, source: destResolu.source, sourceLibelle: destResolu.sourceLibelle, messageId };
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        journaliserEnvoi({
          action: "demande-document",
          dest: destResolu.email,
          from: "",
          host: cfgHost,
          port: cfgPort,
          secure: cfgSecure,
          succes: false,
          code: "SMTP_ECHEC",
          erreur: detail,
          reference: d.reference,
          type: d.type,
        });
        notification = { envoye: false, destinataire: destResolu.email, source: destResolu.source, sourceLibelle: destResolu.sourceLibelle, erreur: detail };
      }
    } else {
      notification = {
        envoye: false,
        absenceEmail: true,
        note: "Aucune adresse e-mail connue pour cet employé (ni sur la demande, ni sur son accès portail) : il verra le document dans son portail (Mes demandes).",
      };
    }
    }

    return NextResponse.json({
      ok: true,
      enAttenteManager,
      docSigne,
      docRefus,
      document: {
        id: doc.id,
        nomFichier: doc.nomFichier,
        taille: doc.taille,
        tailleLisible: tailleLisible(doc.taille),
        typeMime: doc.typeMime,
      },
      tamponApplique,
      // (NOUVEAU Task 224) message de signature électronique (visible dans
      // l'interface : certificat signataire, conservation, vérification)
      signatureElectronique,
      avertissements,
      statut,
      statutLibelle: refuseeParFinal === "MANAGER"
        ? "Refusée par le Manager"
        : refuseeParFinal === "RH"
          ? "Refusée par les RH"
          : statut === "ACCEPTEE"
            ? "Acceptée"
            : statut === "REFUSEE"
              ? "Refusée"
              : d.statut,
      traitePar: maj.traitePar ?? d.traitePar ?? "",
      notification,
    });
  } catch (error) {
    console.error("[DEMANDES/RÉPONSE] erreur:", error);
    return NextResponse.json({ error: "Erreur serveur lors du traitement du document." }, { status: 500 });
  }
}

/** Taille lisible (cohérente avec la liste des demandes). */
function tailleLisible(n: number): string {
  const v = Number(n || 0);
  if (!isFinite(v) || v <= 0) return "0 Ko";
  if (v >= 1048576) return (v / 1048576).toFixed(1).replace(".", ",") + " Mo";
  return Math.max(1, Math.round(v / 1024)) + " Ko";
}
