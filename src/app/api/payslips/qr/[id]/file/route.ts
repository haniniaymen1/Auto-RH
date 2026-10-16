/**
 * ============================================================================
 *  NOUVEAU (Task 180) — API PUBLIQUE DU FICHIER « FICHE EN LIGNE » (QR code)
 * ============================================================================
 *
 *  GET /api/payslips/qr/[id]/file?t=<jeton>[&download=1]
 *
 *  Servage du fichier d'une fiche de paie (PDF / image / DOCX / XLSX, AVEC le
 *  tampon signature/QR apposé au servage — même moteur que l'API privée
 *  /api/payslips/[id]/file) à la personne qui vient de SCANNER le QR code
 *  « Fiche en ligne » imprimé sur le document, via la page de vérification
 *  /verification/fiche/[id].
 *
 *  SÉCURITÉ — cette API est PUBLIQUE (exemptée du middleware, aucune session)
 *  mais protégée par le JETON HMAC-SHA256 signé propre à la fiche :
 *   - jetonFicheValide(id, t) — comparaison en TEMPS CONSTANT ; un jeton
 *     absent, altéré ou d'une autre fiche → 403, AUCUN contenu servi ;
 *   - le jeton n'ouvre QUE cette fiche (aucun listage, aucune autre fiche) ;
 *   - supprimer la fiche (administration) révoque mécaniquement le lien.
 *   → Toute la chaîne reste fermée : les API privées, la liste des fiches et
 *     les autres documents ne sont pas touchés par cette exception publique.
 *
 *  Le reste du pipeline est la JUMELLE EXACTE de /api/payslips/[id]/file :
 *  déchiffrement à la volée, détection du type réel (octets), validation
 *  structurelle des images, tampon automatique non bloquant, erreurs
 *  explicites (fichier égaré, clé de chiffrement différente, fichier vide,
 *  image tronquée/corrompue).
 * ============================================================================
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { db } from "@/lib/db";
import { resolveStoredFile, sniffContentType } from "@/lib/storage-dir";
import { validerStructureImage } from "@/lib/image-validate";
import { decryptFromStorage } from "@/lib/storage-crypto";
import {
  jetonFicheValide,
  tamponnerFicheDossier,
  tamponActif,
  typeFichierTamporable,
  type InfosFiche,
} from "@/lib/stamp";
// NOUVEAU (Task 224) : signature électronique PAdES au servage (API de
// certification & signature — copie signée conservée + certificat associé).
import {
  lireConfigSignatureApi,
  signerEtConserver,
  completerConfigTamponAvecElec,
} from "@/lib/signature-api";
// NOUVEAU (Task 244) : PRÉSERVATION DE LA SIGNATURE D'ORIGINE — la
// vérification par QR code montre le document EXACTEMENT tel qu'il a été
// signé la première fois : modifier/remplacer la signature dans les
// paramètres ne change JAMAIS l'aspect ni la signature des fiches déjà
// signées (même mécanique que l'API privée et le portail employé).
import {
  lireCopieFigee,
  figerCopieSignee,
  resoudreCopieConservee,
} from "@/lib/copie-signee";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const jeton = new URL(request.url).searchParams.get("t");

    // ---- 1) JETON D'ABORD : rien (même l'existence de la fiche) n'est
    //         révélé tant que le jeton signé n'est pas prouvé. ----
    const identifiant = String(id ?? "").trim();
    if (
      !identifiant ||
      identifiant.length > 64 ||
      !/^[A-Za-z0-9_-]+$/.test(identifiant) ||
      !jetonFicheValide(identifiant, jeton)
    ) {
      return NextResponse.json(
        { error: "Lien de vérification invalide ou altéré (jeton refusé)." },
        { status: 403 }
      );
    }

    // ---- 2) Fiche + fichier (jumelle exacte de l'API privée) ----
    const record = await db.payslip.findUnique({ where: { id: identifiant } });
    if (!record) {
      return NextResponse.json(
        { error: "Fiche de paie introuvable : le QR code correspond à un document retiré du serveur." },
        { status: 404 }
      );
    }
    const filePath = resolveStoredFile(record.storedName);
    if (!filePath) {
      return NextResponse.json(
        {
          error:
            "Fichier introuvable sur le serveur. La fiche existe bien, mais aucun dossier de stockage examiné ne contient ce fichier. Contactez le service RH.",
        },
        { status: 404 }
      );
    }
    const rawStored = await readFile(filePath);
    let data: Buffer;
    try {
      data = decryptFromStorage(rawStored);
    } catch (e) {
      console.error(
        "[QR-FILE] Fichier illisible (clé de chiffrement différente ?):",
        record.storedName,
        e instanceof Error ? e.message : e
      );
      return NextResponse.json(
        {
          error:
            "Document illisible sur le serveur (problème de clé de chiffrement du stockage). Contactez le service RH.",
        },
        { status: 500 }
      );
    }
    if (!data || data.length === 0) {
      console.error("[QR-FILE] Fichier VIDE sur le disque (0 octet):", record.storedName);
      return NextResponse.json(
        { error: "Fichier vide sur le serveur (import interrompu). Contactez le service RH." },
        { status: 404 }
      );
    }

    const download = new URL(request.url).searchParams.get("download") === "1";
    const lowerStored = record.storedName.toLowerCase();
    const contentTypeParExtension = lowerStored.endsWith(".png")
      ? "image/png"
      : lowerStored.endsWith(".jpg") || lowerStored.endsWith(".jpeg")
        ? "image/jpeg"
        : lowerStored.endsWith(".xlsx")
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : lowerStored.endsWith(".xls")
            ? "application/vnd.ms-excel"
            : lowerStored.endsWith(".xlsm")
              ? "application/vnd.ms-excel.sheet.macroEnabled.12"
              : lowerStored.endsWith(".docx")
                ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                : "application/pdf";
    const sniffed = sniffContentType(data);
    const contentType = sniffed ?? contentTypeParExtension;
    if (
      !sniffed &&
      (lowerStored.endsWith(".png") ||
        lowerStored.endsWith(".jpg") ||
        lowerStored.endsWith(".jpeg"))
    ) {
      console.error(
        "[QR-FILE] Fiche image CORROMPUE (signature inconnue):", record.storedName
      );
      return NextResponse.json(
        { error: "Impossible d'afficher ce document : contenu endommagé. Contactez le service RH." },
        { status: 422 }
      );
    }
    if (contentType === "image/png" || contentType === "image/jpeg") {
      const verdictImage = validerStructureImage(data);
      if (!verdictImage.ok) {
        console.error(
          "[QR-FILE] Image illisible (structure invalide):", record.storedName,
          "—", verdictImage.raison, verdictImage.detail || ""
        );
        return NextResponse.json(
          { error: "Impossible d'afficher ce document : fichier image incomplet. Contactez le service RH." },
          { status: 422 }
        );
      }
    }

    // ==================================================================
    // NOUVEAU (Task 244) — SIGNATURE D'ORIGINE PRÉSERVÉE (jumelle de
    // /api/payslips/[id]/file) : la copie DÉJÀ signée de la fiche est servie
    // TELLE QUELLE — 1) copie figée (première signature), 2) à défaut copie
    // PAdES CONSERVÉE au registre (PREMIÈRE — signeLe ASC, aussitôt figée).
    // Le pipeline tampon/PAdES ci-après ne concerne que les fiches pas
    // ENCORE signées ; son résultat est figé avant la réponse.
    // ==================================================================
    const fileNameSafe = record.fileName.replace(/["\\\r\n]/g, "_");
    try {
      const figee = await lireCopieFigee(record);
      if (figee) {
        console.log(
          "[QR-FILE] Fiche", record.id,
          "— copie signée FIGÉE servie (signature d'origine préservée)"
        );
        return new NextResponse(new Uint8Array(figee), {
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(figee.length),
            "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileNameSafe}"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Robots-Tag": "noindex, nofollow",
            "X-Signature-Electronique": encodeURIComponent(
              "signature d'origine préservée (copie figée " +
                (record.copieSigneeNature || "") +
                " du " +
                (record.copieSigneeLe || record.uploadedAt).toISOString() + ")"
            ),
          },
        });
      }
    } catch (e) {
      console.error("[QR-FILE] Copie figée illisible (repli pipeline):", e);
    }
    try {
      const reg = await db.signatureApiDocument.findFirst({
        where: { type: "FICHE_PAIE", sourceId: record.id, chemin: { not: "" } },
        orderBy: { signeLe: "asc" }, // PREMIÈRE signature = signature d'origine
      });
      if (reg?.chemin) {
        const cheminCopie = resoudreCopieConservee(reg.chemin);
        if (cheminCopie) {
          const copie = decryptFromStorage(await readFile(cheminCopie));
          if (copie && copie.length) {
            await figerCopieSignee(record.id, copie, "PADES");
            console.log(
              "[QR-FILE] Fiche", record.id,
              "— copie signée CONSERVÉE (registre) servie : signature d'origine préservée"
            );
            return new NextResponse(new Uint8Array(copie), {
              headers: {
                "Content-Type": "application/pdf",
                "Content-Length": String(copie.length),
                "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileNameSafe}"`,
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
                "X-Robots-Tag": "noindex, nofollow",
                "X-Signature-Electronique": encodeURIComponent(
                  "copie signée conservée — signature d'origine (certificat « " +
                    (reg.certSujet || "certificat") + " », signée le " +
                    reg.signeLe.toISOString() + ")"
                ),
              },
            });
          }
        }
      }
    } catch (e) {
      console.error("[QR-FILE] Copie conservée (registre) illisible (repli pipeline):", e);
    }

    // ---- 3) TAMPON AUTOMATIQUE (signature/QR/mention) — non bloquant ----
    // (NOUVEAU v0.2.119) cachet « Signature électronique » (Switch elecActif)
    // alimenté EN DIRECT par le certificat du module — injection avant
    // l'évaluation du tampon ; signature PAdES juste après (cachet couvert).
    // Échec de signature → re-tamponnage SANS cachet (cachet ⇒ signé).
    let donneesFinales = data;
    let typeTampon: ReturnType<typeof typeFichierTamporable> = null;
    let cachetElecAppose = false;
    const typeTamponBrut = typeFichierTamporable(contentType);
    if (typeTamponBrut) {
      try {
        const cfgTampon = await completerConfigTamponAvecElec(
          await db.signatureConfig.findUnique({ where: { id: "signature" } }),
          "FICHES"
        );
        if (tamponActif(cfgTampon)) {
          const infos: InfosFiche = {
            id: record.id,
            employeeName: record.employeeName,
            cin: record.cin,
            period: record.period,
            netSalary: record.netSalary,
            uploadedAt: record.uploadedAt,
          };
          donneesFinales = await tamponnerFicheDossier(data, infos, cfgTampon as never, typeTamponBrut);
          cachetElecAppose = Boolean(cfgTampon.elecActif && cfgTampon.elec);
          typeTampon = typeTamponBrut;
        }
      } catch (e) {
        console.error("[QR-FILE] Tampon signature/QR non appliqué:", e);
      }
    }

    // NOUVEAU (Task 224) — SIGNATURE ÉLECTRONIQUE PAdES (API de certification
    // & signature) : même branchement que le servage authentifié — le PDF
    // tamponné est signé (cache par empreinte, copie conservée, certificat
    // associé enregistré, vérification automatique). JAMAIS bloquant : le
    // lien public reste servi sans signature si le module échoue.
    let signatureElectronique = "";
    if (contentType === "application/pdf") {
      try {
        const cfgSig = await lireConfigSignatureApi();
        if (cfgSig.actif && cfgSig.signerFiches) {
          const resultat = await signerEtConserver(donneesFinales, {
            type: "FICHE_PAIE",
            sourceId: record.id,
            reference:
              [record.matricule, record.period].filter(Boolean).join(" — ") ||
              record.id,
            nomFichier: record.fileName || "fiche-de-paie.pdf",
            signePar: "système (lien public à jeton)",
          });
          if (resultat.ok && resultat.pdf) {
            donneesFinales = resultat.pdf;
            signatureElectronique = "1";
          } else {
            console.error("[QR-FILE] Signature électronique refusée:", resultat.message);
            // (NOUVEAU v0.2.119) cachet ⇒ signature : re-tamponnage SANS cachet
            if (cachetElecAppose && typeTampon) {
              try {
                const cfgSansElec = await db.signatureConfig.findUnique({ where: { id: "signature" } });
                if (cfgSansElec && tamponActif(cfgSansElec)) {
                  const infos: InfosFiche = {
                    id: record.id,
                    employeeName: record.employeeName,
                    cin: record.cin,
                    period: record.period,
                    netSalary: record.netSalary,
                    uploadedAt: record.uploadedAt,
                  };
                  donneesFinales = await tamponnerFicheDossier(data, infos, cfgSansElec as never, typeTampon);
                }
              } catch (e2) {
                console.error("[QR-FILE] Re-tamponnage sans cachet impossible:", e2);
              }
            }
          }
        }
      } catch (e) {
        console.error("[QR-FILE] Signature électronique non appliquée:", e);
      }
    }

    // NOUVEAU (Task 244) — FIGEAGE de la signature d'origine (jumelle de
    // l'API privée) : le rendu final signé est conservé une fois pour toutes
    // AVANT la réponse ; les vérifications QR suivantes serviront exactement
    // ces octets, même si la configuration de la signature change.
    try {
      if (signatureElectronique) {
        await figerCopieSignee(record.id, donneesFinales, "PADES");
      } else if (typeTampon) {
        await figerCopieSignee(record.id, donneesFinales, "TAMPON");
      }
    } catch (e) {
      console.error("[QR-FILE] Figage de la signature d'origine impossible (non bloquant):", e);
    }

    return new NextResponse(new Uint8Array(donneesFinales), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(donneesFinales.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileNameSafe}"`,
        // Lien public à jeton : aucun cache partagé, aucune indexation.
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
        ...(signatureElectronique
          ? { "X-Signature-Electronique": signatureElectronique }
          : {}),
      },
    });
  } catch (error) {
    console.error("[QR-FILE] Erreur:", error);
    return NextResponse.json(
      { error: "Fichier introuvable sur le serveur." },
      { status: 404 }
    );
  }
}
