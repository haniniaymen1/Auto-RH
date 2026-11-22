/**
 * ============================================================================
 *  NOUVEAU (Task 225, v0.2.115) — SIGNATURE GÉNÉRIQUE : API « SIGNER »
 * ============================================================================
 *
 *  GET /api/signature-api/signer
 *      → état du module + informations du CERTIFICAT ÉLECTRONIQUE CHARGÉ
 *        (ex. titulaire « Jean Dupont », organisation « MA SOCIETE SARL »,
 *        émetteur, n° série, fenêtre de validité, empreinte) + avertissements
 *        (module désactivé, certificat absent, clé privée manquante,
 *        certificat expiré) + les 20 derniers documents signés manuellement
 *        (registre). AUCUN secret renvoyé.
 *        Rôles : RH, IT, SUPERADMIN (le RH signe les documents qu'il importe ;
 *        la GESTION du certificat reste IT — cf. /certificat et /config).
 *
 *  GET /api/signature-api/signer?id=<documentId>&telecharger=1
 *      → re-télécharge une copie conservée (documents signés manuellement,
 *        déchiffrée au vol, pièce jointe).
 *
 *  POST /api/signature-api/signer   (multipart/form-data)
 *      fichier   : N'IMPORTE QUEL fichier pris en charge (PDF → PAdES
 *                  intégré ; tout autre format → PKCS#7/CMS détaché livré
 *                  en ZIP : original + .p7s + LISEZ-MOI de vérification) ;
 *      reference : libellé libre (registre, facultatif) ;
 *      raison    : motif de signature (facultatif, sinon config).
 *      → le FICHIER SIGNÉ est renvoyé en binaire (téléchargement direct),
 *        avec les en-têtes X-Signature-* (documentId, nature, vérification,
 *        certificat) ; la copie est CONSERVÉE chiffrée + registre.
 *      Rôles : RH, IT, SUPERADMIN.
 * ============================================================================
 */
import { NextRequest, NextResponse } from "next/server";
import {
  estSuperadmin,
  getSessionUser,
  motDePasseExpire,
  unauthorized,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptFromStorage } from "@/lib/storage-crypto";
import {
  TAILLE_MAX_SIGNER,
  signerDocumentTeleverse,
  sujetVersTitulaire,
} from "@/lib/signature-documents";
import {
  dossierDocumentsSignes,
  lireConfigSignatureApi,
} from "@/lib/signature-api";
import fs from "fs";
import path from "path";

/** RH / IT / SUPERADMIN : la signature des documents importés est métier. */
function autoriseASigner(session: { role: string }): boolean {
  return session.role === "RH" || session.role === "IT" || estSuperadmin(session);
}

/* ------------------------------------------------------------------ */
/* GET : état + certificat chargé + registre — OU téléchargement d'une  */
/*       copie conservée (?id=…&telecharger=1)                          */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  try {
    if (!autoriseASigner(session)) {
      return NextResponse.json(
        { error: "La signature des documents est réservée aux rôles RH, IT et superadministrateur." },
        { status: 403 }
      );
    }
    const url = new URL(request.url);
    const idTelechargement = url.searchParams.get("id");
    const veutTelecharger = url.searchParams.get("telecharger") === "1";

    // ---- Copie conservée : re-téléchargement ----
    if (veutTelecharger && idTelechargement) {
      const ligne = await db.signatureApiDocument.findUnique({ where: { id: idTelechargement } });
      if (!ligne || ligne.type !== "AUTRE" || !ligne.chemin) {
        return NextResponse.json(
          { error: "Document introuvable dans le registre des signatures manuelles." },
          { status: 404 }
        );
      }
      const brut = await fs.promises.readFile(
        path.join(dossierDocumentsSignes(), path.basename(ligne.chemin))
      );
      let contenu: Buffer;
      try {
        contenu = decryptFromStorage(brut);
      } catch {
        return NextResponse.json(
          { error: "La copie conservée est illisible (clé de chiffrement du serveur changée). Re-signez le document original." },
          { status: 410 }
        );
      }
      const base = ligne.nomFichier.replace(/\.[A-Za-z0-9]{1,12}$/, "") || "document";
      const nom = ligne.chemin.endsWith(".pdf")
        ? base + "-signe.pdf"
        : ligne.chemin.endsWith(".zip")
          ? base + "-signe.zip"
          : base + "-signature.p7s";
      const typeMime = ligne.chemin.endsWith(".pdf")
        ? "application/pdf"
        : ligne.chemin.endsWith(".zip")
          ? "application/zip"
          : "application/pkcs7-signature";
      const h = new Headers({
        "Content-Type": typeMime,
        "Content-Length": String(contenu.length),
        "Cache-Control": "no-store",
      });
      const nomAscii = nom.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
      h.set(
        "Content-Disposition",
        'attachment; filename="' + nomAscii + '"; filename*=UTF-8\'\'' + encodeURIComponent(nom)
      );
      return new NextResponse(new Uint8Array(contenu), { status: 200, headers: h });
    }

    // ---- État du module + certificat chargé + registre ----
    const cfg = await lireConfigSignatureApi();
    const maintenant = new Date();
    const certificatCharge = Boolean(cfg.certChemin);
    const clePrete = cfg.certFormat === "PKCS#12" || Boolean(cfg.certCleChemin);

    const avertissements: string[] = [];
    if (!cfg.actif) {
      avertissements.push(
        "Le module de signature électronique est désactivé (Paramètres → « API de certification & signature »)."
      );
    }
    if (!certificatCharge) {
      avertissements.push(
        "Aucun certificat chargé : importez-le dans Paramètres → « API de certification & signature » (rôle IT)."
      );
    } else if (!clePrete) {
      avertissements.push(
        "Le certificat chargé n'a pas de clé privée associée : la signature exige le coffre complet (.p12/.pfx) ou le certificat + sa clé."
      );
    } else if (cfg.certValideAu instanceof Date && cfg.certValideAu.getTime() < maintenant.getTime()) {
      avertissements.push(
        "Le certificat chargé est EXPIRÉ depuis le " + cfg.certValideAu.toISOString().slice(0, 10) + " : renouvelez-le auprès de votre autorité."
      );
    } else if (cfg.certValideDu instanceof Date && cfg.certValideDu.getTime() > maintenant.getTime()) {
      avertissements.push(
        "Le certificat chargé n'est pas encore valide (débute le " + cfg.certValideDu.toISOString().slice(0, 10) + ")."
      );
    }

    const { titulaire, organisation } = sujetVersTitulaire(cfg.certSujet);

    const registre = await db.signatureApiDocument.findMany({
      where: { type: "AUTRE" },
      orderBy: { signeLe: "desc" },
      take: 20,
      select: {
        id: true,
        nomFichier: true,
        reference: true,
        chemin: true,
        tailleOctets: true,
        certSujet: true,
        certEmetteur: true,
        certEmpreinte: true,
        verifStatut: true,
        verifMessage: true,
        signeLe: true,
        signePar: true,
        mode: true,
        environnement: true,
      },
    });

    return NextResponse.json({
      actif: cfg.actif,
      mode: cfg.mode,
      environnement: cfg.environnement,
      raison: cfg.raison,
      certificatCharge,
      clePrete,
      certificat: certificatCharge
        ? {
            fichier: cfg.certFichierNom,
            format: cfg.certFormat,
            sujet: cfg.certSujet,
            titulaire,
            organisation,
            emetteur: cfg.certEmetteur,
            serie: cfg.certSerie,
            empreinte: cfg.certEmpreinte,
            valideDu: cfg.certValideDu,
            valideAu: cfg.certValideAu,
            importLe: cfg.certImportLe,
          }
        : null,
      avertissements,
      registre: registre.map((r) => ({
        id: r.id,
        nomFichier: r.nomFichier,
        reference: r.reference,
        nature: r.chemin?.endsWith(".pdf")
          ? "PADES_PDF"
          : r.chemin?.endsWith(".zip")
            ? "CMS_DETACHE_ZIP"
            : "CMS_DETACHE_SEUL",
        tailleOctets: r.tailleOctets,
        signataire: r.certSujet,
        verifStatut: r.verifStatut,
        verifMessage: r.verifMessage,
        signeLe: r.signeLe,
        signePar: r.signePar,
        mode: r.mode,
        environnement: r.environnement,
      })),
    });
  } catch (error) {
    console.error("[SIGNER] Lecture état:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}

/* ------------------------------------------------------------------ */
/* POST : signature du fichier téléversé → binaire signé en réponse    */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  try {
    if (!autoriseASigner(session)) {
      return NextResponse.json(
        { error: "La signature des documents est réservée aux rôles RH, IT et superadministrateur." },
        { status: 403 }
      );
    }
    const form = await request.formData();
    const fichier = form.get("fichier");
    if (!(fichier instanceof File) || fichier.size === 0) {
      return NextResponse.json(
        { error: "Aucun fichier fourni : déposez le document à signer (PDF, image, bureautique, archive…)." },
        { status: 400 }
      );
    }
    if (fichier.size > TAILLE_MAX_SIGNER) {
      return NextResponse.json(
        {
          error:
            "Fichier trop volumineux (" + Math.round(fichier.size / 1e6) + " Mo) : la limite de signature en ligne est de " +
            Math.round(TAILLE_MAX_SIGNER / 1e6) + " Mo.",
        },
        { status: 400 }
      );
    }
    const reference = String(form.get("reference") ?? "").slice(0, 200);
    const raison = String(form.get("raison") ?? "").slice(0, 200);
    const contenu = Buffer.from(await fichier.arrayBuffer());

    const resultat = await signerDocumentTeleverse(contenu, {
      nomFichier: fichier.name || "document",
      reference,
      raison,
      signePar: session.name || session.email || "Utilisateur",
    });

    if (!resultat.ok || !resultat.contenu) {
      console.error("[SIGNER] Refus:", resultat.message);
      return NextResponse.json({ error: resultat.message }, { status: 400 });
    }

    // En-têtes informatifs (URL-encodés : les en-têtes HTTP sont latin-1 —
    // les accents du sujet du certificat y seraient corrompus sinon).
    const h = new Headers({
      "Content-Type": resultat.typeMime,
      "Content-Length": String(resultat.contenu.length),
      "X-Signature-Document-Id": resultat.documentId,
      "X-Signature-Nature": resultat.nature || "",
      "X-Signature-Verif": resultat.verification.statut,
      "X-Signature-Verif-Message": encodeURIComponent(resultat.verification.message || ""),
      "X-Signature-Certificat": encodeURIComponent(resultat.certificat?.sujet || ""),
      "X-Signature-Message": encodeURIComponent(resultat.message || ""),
      "X-Signature-Deja-Signe": resultat.dejaSigne ? "1" : "0",
      "Cache-Control": "no-store",
    });
    const nomAscii = resultat.nomFichierSigne.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
    h.set(
      "Content-Disposition",
      'attachment; filename="' + nomAscii + '"; filename*=UTF-8\'\'' + encodeURIComponent(resultat.nomFichierSigne)
    );
    return new NextResponse(new Uint8Array(resultat.contenu), { status: 200, headers: h });
  } catch (error) {
    const message = String((error as Error).message || error);
    console.error("[SIGNER] Signature:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
