/**
 * ============================================================================
 *  NOUVEAU (Task 224) — IMPORT / RETRAIT DU CERTIFICAT DE SIGNATURE
 * ============================================================================
 *
 *  POST /api/signature-api/certificat   (multipart/form-data)
 *      fichier        : certificat ou coffre — .p12/.pfx (certificat + clé),
 *                       .pem/.cer/.crt/.der (certificat ; clé facultative
 *                       embarquée dans un .pem combiné)
 *      motDePasse     : mot de passe du coffre / certificat (« vide » = sans)
 *      fichierCle     : clé privée séparée — .pem/.key/.der (facultative)
 *      motDePasseCle  : mot de passe de la clé privée si chiffrée
 *      → valide le CONTENU (OpenSSL : coffre déballé, paire certificat↔clé
 *        VÉRIFIÉE cryptographiquement), conserve des copies CHIFFRÉES
 *        (storage/signatures/, AES-256-GCM, 0600) et les métadonnées en base.
 *
 *  DELETE /api/signature-api/certificat
 *      → retire le certificat ET la clé (fichiers chiffrés supprimés, champs
 *        vidés). La configuration et le registre des documents signés restent.
 *
 *  Rôles : IT / SUPERADMIN. Le mot de passe n'est JAMAIS renvoyé (booléen).
 * ============================================================================
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  estSuperadmin,
  getSessionUser,
  motDePasseExpire,
  unauthorized,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { encryptForStorage } from "@/lib/storage-crypto";
import {
  dossierSignatures,
  ID_CONFIG_SIGNATURE_API,
  lireConfigSignatureApi,
  signerToutesFichesExistantes,
} from "@/lib/signature-api";
import { ouvrirCertificat } from "@/lib/signature-pades";

const TAILLE_MAX = 10_000_000;
const EXTENSIONS_CERT = [".p12", ".pfx", ".pem", ".cer", ".crt", ".der"];
const EXTENSIONS_CLE = [".pem", ".key", ".der"];

export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  try {
    if (session.role !== "IT" && !estSuperadmin(session)) {
      return NextResponse.json(
        { error: "Fonctionnalité réservée aux rôles IT et superadministrateur." },
        { status: 403 }
      );
    }
    const form = await request.formData();
    const fichier = form.get("fichier");
    const fichierCle = form.get("fichierCle");
    const motDePasse = String(form.get("motDePasse") ?? "");
    const motDePasseCle = String(form.get("motDePasseCle") ?? "");
    if (!(fichier instanceof File) || fichier.size === 0) {
      return NextResponse.json(
        { error: "Aucun fichier de certificat fourni : déposez un coffre .p12/.pfx ou un certificat .pem/.cer/.crt/.der." },
        { status: 400 }
      );
    }
    if (fichier.size > TAILLE_MAX) {
      return NextResponse.json(
        { error: "Fichier trop volumineux (" + Math.round(fichier.size / 1e6) + " Mo) : la limite est de 10 Mo." },
        { status: 400 }
      );
    }
    const nomCert = fichier.name || "certificat";
    if (!EXTENSIONS_CERT.some((e) => nomCert.toLowerCase().endsWith(e))) {
      return NextResponse.json(
        { error: "Extension non reconnue (" + nomCert + ") : formats acceptés pour le certificat : .p12, .pfx, .pem, .cer, .crt, .der." },
        { status: 400 }
      );
    }
    let donneesCle: Buffer | null = null;
    let nomCle = "";
    if (fichierCle instanceof File && fichierCle.size > 0) {
      if (fichierCle.size > TAILLE_MAX) {
        return NextResponse.json({ error: "Fichier de clé trop volumineux (limite 10 Mo)." }, { status: 400 });
      }
      nomCle = fichierCle.name || "cle.key";
      if (!EXTENSIONS_CLE.some((e) => nomCle.toLowerCase().endsWith(e))) {
        return NextResponse.json(
          { error: "Extension de clé non reconnue (" + nomCle + ") : formats acceptés : .pem, .key, .der." },
          { status: 400 }
        );
      }
      donneesCle = Buffer.from(await fichierCle.arrayBuffer());
    }

    const donneesCertificat = Buffer.from(await fichier.arrayBuffer());

    // ---- VALIDATION PAR LE CONTENU (coffre déballé + paire vérifiée) ----
    // Toute erreur renvoie un message FRANÇAIS classé (mot de passe, fichier
    // illisible, clé absente, paire incohérente) — le mot de passe n'est
    // blâmé QUE si un moteur le refuse explicitement.
    const coffre = await ouvrirCertificat({
      donneesCertificat,
      motDePasse,
      donneesCle,
      motDePasseCle,
    });

    // ---- CONSERVATION chiffrée ----
    await fs.promises.mkdir(dossierSignatures(), { recursive: true, mode: 0o700 });
    try {
      await fs.promises.chmod(dossierSignatures(), 0o700);
    } catch {
      // sans permissions POSIX : sans effet
    }
    const horodatage = Date.now();
    const nomStockeCert = "certificat-" + horodatage + path.extname(nomCert).toLowerCase();
    await fs.promises.writeFile(
      path.join(dossierSignatures(), nomStockeCert),
      encryptForStorage(donneesCertificat),
      { mode: 0o600 }
    );
    let nomStockeCle = "";
    if (donneesCle && nomCle) {
      nomStockeCle = "cle-privee-" + horodatage + path.extname(nomCle).toLowerCase();
      await fs.promises.writeFile(
        path.join(dossierSignatures(), nomStockeCle),
        encryptForStorage(donneesCle),
        { mode: 0o600 }
      );
    }

    // ---- Métadonnées en base (jamais les secrets en clair : le middleware
    // db-crypto chiffre certMotDePasse / certCleMotDePasse) ----
    const ancienne = await lireConfigSignatureApi();
    // Retrait propre des ANCIENS fichiers chiffrés remplacés
    for (const ancien of [ancienne.certChemin, ancienne.certCleChemin]) {
      if (ancien && ancien !== nomStockeCert && ancien !== nomStockeCle) {
        await fs.promises
          .rm(path.join(dossierSignatures(), path.basename(ancien)), { force: true })
          .catch(() => {});
      }
    }
    const estCoffre = /\.(p12|pfx)$/i.test(nomCert);
    const maj = await db.signatureApiConfig.update({
      where: { id: ID_CONFIG_SIGNATURE_API },
      data: {
        certFormat: estCoffre ? "PKCS#12" : /\.pem$/i.test(nomCert) ? "PEM" : "X.509",
        certFichierNom: nomCert,
        certChemin: nomStockeCert,
        certSujet: coffre.metadonnees.sujet,
        certEmetteur: coffre.metadonnees.emetteur,
        certSerie: coffre.metadonnees.serie,
        certValideDu: coffre.metadonnees.valideDu,
        certValideAu: coffre.metadonnees.valideAu,
        certEmpreinte: coffre.metadonnees.empreinte,
        certImportLe: new Date(),
        certMotDePasse: motDePasse, // CHIFFRÉ par le middleware db
        // Un coffre contient SA clé : un fichier de clé séparé précédent
        // n'a plus de raison d'être (sauf clé fournie dans la même requête).
        certCleChemin: nomStockeCle || (estCoffre && !nomCle ? "" : ancienne.certCleChemin),
        certCleFichierNom: nomCle || (estCoffre && !nomCle ? "" : ancienne.certCleFichierNom),
        certCleType: nomCle || (!estCoffre ? coffre.metadonnees.algorithmeCle : ancienne.certCleType),
        certCleMotDePasse: motDePasseCle, // CHIFFRÉ par le middleware db
        certCleImportLe: nomCle || (!estCoffre && donneesCle) ? new Date() : ancienne.certCleImportLe,
      },
    });
    // NOUVEAU (v0.2.124) — RATTRAPAGE APRÈS IMPORT DU CERTIFICAT : si le
    // module est déjà ACTIF avec la couverture « Fiches de paie », les
    // fiches importées AVANT que le certificat soit disponible (signature
    // d'import en échec non bloquant) recevaient JAMAIS leur copie signée —
    // le portail continuait d'afficher « non signée ». Désormais, dès que
    // le certificat devient utilisable, les fiches restées sans copie
    // signée sont rattrapées automatiquement (fire-and-forget, mêmes
    // garanties : fiches déjà signées ignorées, échecs non bloquants).
    let message =
      "Certificat importé et vérifié : « " +
      coffre.metadonnees.sujet +
      " »" +
      (estCoffre || nomCle || donneesCle ? " (clé privée disponible)" : " — SANS clé privée : la signature exigera la clé associée");
    const cfgApres = await lireConfigSignatureApi();
    if (cfgApres.actif && cfgApres.signerFiches) {
      signerToutesFichesExistantes("import du certificat")
        .then((r) => {
          if (r.message) console.log("[SIGNATURE-API/CERTIFICAT] " + r.message);
        })
        .catch((e) => console.error("[SIGNATURE-API/CERTIFICAT] Rattrapage impossible:", e));
      message +=
        ". Signature électronique des fiches de paie déjà importées relancée en arrière-plan — chaque employé recevra au portail la copie signée.";
    }
    return NextResponse.json({
      ok: true,
      message,
      config: maj.certSujet,
      metadonnees: {
        sujet: coffre.metadonnees.sujet,
        emetteur: coffre.metadonnees.emetteur,
        serie: coffre.metadonnees.serie,
        valideDu: coffre.metadonnees.valideDu,
        valideAu: coffre.metadonnees.valideAu,
        empreinte: coffre.metadonnees.empreinte,
        algorithmeCle: coffre.metadonnees.algorithmeCle,
      },
    });
  } catch (error) {
    const message = String((error as Error).message || error);
    console.error("[SIGNATURE-API/CERTIFICAT] Import:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE() {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  try {
    if (session.role !== "IT" && !estSuperadmin(session)) {
      return NextResponse.json(
        { error: "Fonctionnalité réservée aux rôles IT et superadministrateur." },
        { status: 403 }
      );
    }
    const cfg = await lireConfigSignatureApi();
    for (const ancien of [cfg.certChemin, cfg.certCleChemin]) {
      if (ancien) {
        await fs.promises
          .rm(path.join(dossierSignatures(), path.basename(ancien)), { force: true })
          .catch(() => {});
      }
    }
    await db.signatureApiConfig.update({
      where: { id: ID_CONFIG_SIGNATURE_API },
      data: {
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
        certCleChemin: "",
        certCleFichierNom: "",
        certCleType: "",
        certCleMotDePasse: "",
        certCleImportLe: null,
      },
    });
    return NextResponse.json({ ok: true, message: "Certificat et clé privée retirés." });
  } catch (error) {
    console.error("[SIGNATURE-API/CERTIFICAT] Retrait:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
