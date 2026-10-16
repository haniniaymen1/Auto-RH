/**
 * ============================================================================
 *  NOUVEAU (Task 181) — API D'IMPORT / RETRAIT DE LA SIGNATURE ÉLECTRONIQUE
 *  CERTIFIÉE (formats : .p12, .pfx, .p7s, .p7m, .pkcs7, .ps7x, .xml, .cer,
 *  .crt, .pem, .der, .jws/.jwt, ZIP — détection PAR LE CONTENU, voir
 *  src/lib/certificat.ts)
 * ============================================================================
 *
 *  POST /api/signature-config/certificat
 *    Corps JSON : { nom: string, data: string (base64 du fichier, ou dataURL),
 *                   motDePasse?: string (conteneurs PKCS#12 protégés) }
 *    → analyse du fichier, extraction du certificat public X.509,
 *      copie de contrôle CHIFFRÉE dans storage/tampons/, enregistrement des
 *      métadonnées dans SignatureConfig — CHAMPS RÉELS DU SCHÉMA (Task 209 :
 *      cette route écrivait des colonnes inexistantes — certNom, certFamille,
 *      certData… — et échouait en 500 sur tout import direct ; alignée ici
 *      sur certFichierNom/certSerie/certImportLe, exactement comme la route
 *      principale /api/signature-config).
 *
 *  DELETE /api/signature-config/certificat
 *    → retire le certificat (champs vidés, copie de contrôle supprimée si
 *      atteignable — suppression jamais bloquante).
 *
 *  SÉCURITÉ (identique à /api/signature-config) :
 *   - session obligatoire, mot de passe expiré → 403 ;
 *   - rôle IT interdit (403 refusIT — discipline Task 176) ;
 *   - rôles RH et SUPERADMIN seulement ;
 *   - la CLÉ PRIVÉE éventuelle n'est ni extraite ni conservée (seul
 *     l'indicateur booléen est affiché) ;
 *   - la copie de contrôle est chiffrée AES-256-GCM (encryptForStorage,
 *     même format que les fiches de paie).
 * ============================================================================
 */
import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "fs/promises";
import path from "path";
import { encryptForStorage } from "@/lib/storage-crypto";
import { getTamponsDir, assurerDossierPrive } from "@/lib/storage-dir";
import {
  estSuperadmin,
  getSessionUser,
  motDePasseExpire,
  refusIT,
  unauthorized,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { tamponActif } from "@/lib/stamp";
import {
  analyserFichierSignature,
  TAILLE_FICHIER_CERT_MAX,
} from "@/lib/certificat";

export const runtime = "nodejs";

/** Garde d'accès commune GET/POST/DELETE (identique à signature-config). */
async function garde() {
  const session = await getSessionUser();
  if (!session) return { erreur: unauthorized() };
  if (session.mustChangePassword) return { erreur: motDePasseExpire() };
  // (Task 176) le rôle IT n'a PLUS accès à la configuration de la signature
  // électronique — l'import de certificat en fait partie.
  if (session.role === "IT")
    return { erreur: refusIT("La configuration du tampon et de la signature électronique") };
  if (session.role !== "RH" && !estSuperadmin(session))
    return {
      erreur: Response.json(
        { error: "Accès refusé : la signature électronique et le tampon sont réservés aux rôles RH et superadministrateur." },
        { status: 403 }
      ),
    };
  return { session };
}

/** Nettoie un nom de fichier d'origine (même discipline que signature-config). */
function nomFichierAffichable(v: unknown): string {
  return String(v ?? "")
    .replace(/[\\/]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
}

/** Extension de la copie de contrôle, dérivée de la FAMILLE DÉTECTÉE. */
function extensionSelonFamille(famille: string): string {
  switch (famille) {
    case "P12":
      return "p12";
    case "PKCS7":
      return "p7s";
    case "X509":
      return "cer";
    case "XMLDSIG":
      return "xml";
    case "JWS":
      return "jws";
    case "ZIP":
      return "zip";
    default:
      return "bin";
  }
}

/** Écrit la copie de contrôle CHIFFRÉE du fichier importé (jamais bloquant). */
async function exporterCopieCertificat(
  octets: Buffer,
  famille: string
): Promise<string> {
  try {
    const dir = getTamponsDir();
    // Task 209 : dossier PRIVÉ 0700 (création + rattrapage chmod) — le
    // répertoire des tampons/certificats ne doit être lisible que par le
    // compte de service, même si un outil externe l'a recréé trop ouvert.
    await assurerDossierPrive(dir);
    const horodatage = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, "")
      .slice(0, 14);
    const nom = `certificat-${horodatage}.${extensionSelonFamille(famille)}`;
    // Copie CHIFFRÉE (AES-256-GCM, en-tête PAIESAGE1) — un certificat
    // d'établissement est aussi sensible qu'une fiche de paie.
    // Task 209 : fichier créé en mode 0600 (lecture/écriture du propriétaire
    // seul) — la copie ne doit jamais être lisible par « autres ».
    await writeFile(path.join(dir, nom), encryptForStorage(octets), { mode: 0o600 });
    return `storage/tampons/${nom}`;
  } catch (e) {
    console.error("[CERTIFICAT] copie non écrite:", e);
    return "";
  }
}

async function lireOuCreer() {
  return (
    (await db.signatureConfig.findUnique({ where: { id: "signature" } })) ??
    (await db.signatureConfig.create({ data: { id: "signature" } }))
  );
}

const CHAMPS_CERT = [
  "certFormat",
  "certFichierNom",
  "certChemin",
  "certSujet",
  "certEmetteur",
  "certSerie",
  "certEmpreinte",
  "certMotDePasse",
] as const;

/** Vide les colonnes du certificat (utilisée par DELETE). */
function champsVides() {
  const data: Record<string, unknown> = {};
  for (const c of CHAMPS_CERT) data[c] = "";
  data.certValideDu = null;
  data.certValideAu = null;
  data.certImportLe = null;
  return data;
}

/**
 * (Task 209) Retire le mot de passe du certificat (CHIFFRÉ en base) des
 * réponses API — booléen certMotDePasseEnregistre seul, discipline
 * identique à la route principale (v0.2.99).
 */
function sansMotDePasse(
  cfg: Record<string, unknown> | null | undefined
): Record<string, unknown> | null | undefined {
  if (!cfg || typeof cfg !== "object") return cfg;
  const { certMotDePasse, ...reste } = cfg;
  return { ...reste, certMotDePasseEnregistre: Boolean(certMotDePasse) };
}

export async function POST(request: NextRequest) {
  const gardeResultat = await garde();
  if (gardeResultat.erreur) return gardeResultat.erreur;
  try {
    const corps = await request.json().catch(() => ({} as Record<string, unknown>));
    const nom = nomFichierAffichable(corps.nom);
    const brut = String(corps.data ?? "").trim();
    const motDePasse = String(corps.motDePasse ?? "");
    if (!brut) {
      return NextResponse.json(
        { error: "Aucun fichier reçu : choisissez un fichier de signature (.p12, .pfx, .p7s, .p7m, .pkcs7, .ps7x, .xml, .cer…)." },
        { status: 400 }
      );
    }
    // Accepte un base64 nu OU un dataURL (robustesse).
    const base64 = brut.includes(",") ? brut.split(",").pop() ?? "" : brut;
    let octets: Buffer;
    try {
      octets = Buffer.from(base64, "base64");
    } catch {
      return NextResponse.json(
        { error: "Contenu du fichier illisible (base64 attendu)." },
        { status: 400 }
      );
    }
    if (!octets.length) {
      return NextResponse.json(
        { error: "Fichier vide : aucun contenu à analyser." },
        { status: 400 }
      );
    }
    if (octets.length > TAILLE_FICHIER_CERT_MAX) {
      return NextResponse.json(
        { error: "Fichier trop volumineux (10 Mo maximum pour un fichier de signature)." },
        { status: 400 }
      );
    }

    const analyse = await analyserFichierSignature(octets, motDePasse);
    if (!analyse.ok) {
      return NextResponse.json({ error: analyse.erreur }, { status: 400 });
    }

    const chemin = await exporterCopieCertificat(octets, analyse.famille);
    // (Task 209) mapping sur les CHAMPS RÉELS du schéma Prisma — mêmes
    // colonnes que la route principale /api/signature-config :
    // certFichierNom / certSerie / certImportLe (+ certMotDePasse CHIFFRÉ
    // par le middleware db, propre à cette section — jamais renvoyé).
    const data = {
      certFichierNom: nom || `signature.${analyse.extension}`,
      certFormat: analyse.format,
      certSujet: (analyse.sujet || "").slice(0, 300),
      certEmetteur: (analyse.emetteur || "").slice(0, 300),
      certSerie: (analyse.serial || "").slice(0, 100),
      certValideDu: analyse.valideDu,
      certValideAu: analyse.valideAu,
      certEmpreinte: analyse.empreinte || "",
      certChemin: chemin,
      certMotDePasse: motDePasse || "",
      certImportLe: new Date(),
    };
    const cfg = await db.signatureConfig.upsert({
      where: { id: "signature" },
      update: data,
      create: { id: "signature", ...data },
    });
    return NextResponse.json({
      config: sansMotDePasse(cfg as unknown as Record<string, unknown>),
      tamponActif: tamponActif(cfg),
      certificat: {
        format: analyse.format,
        sujetCN: analyse.sujetCN,
        valideAu: analyse.valideAu,
        nbCertificats: analyse.nbCertificats,
        clePriveePresente: analyse.clePriveePresente,
      },
    });
  } catch (error) {
    console.error("[CERTIFICAT] POST:", error);
    return NextResponse.json(
      { error: "Import impossible : analyse du fichier en échec." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const gardeResultat = await garde();
  if (gardeResultat.erreur) return gardeResultat.erreur;
  try {
    const cfg = await lireOuCreer();
    // Copie de contrôle : supprimée si atteignable (jamais bloquant).
    if (cfg.certChemin) {
      try {
        const dir = getTamponsDir();
        await unlink(path.join(dir, path.basename(cfg.certChemin)));
      } catch {
        // fichier absent / déjà supprimé : sans conséquence
      }
    }
    const maj = await db.signatureConfig.update({
      where: { id: "signature" },
      data: champsVides(),
    });
    return NextResponse.json({
      config: sansMotDePasse(maj as unknown as Record<string, unknown>),
      tamponActif: tamponActif(maj),
    });
  } catch (error) {
    console.error("[CERTIFICAT] DELETE:", error);
    return NextResponse.json(
      { error: "Retrait du certificat impossible." },
      { status: 500 }
    );
  }
}
