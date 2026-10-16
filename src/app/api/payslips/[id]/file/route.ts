import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readFile } from "fs/promises";
import {
  motDePasseExpire,
  refusIT,
  getSessionUser,
  unauthorized,
} from "@/lib/auth";
import { resolveStoredFile, sniffContentType } from "@/lib/storage-dir";
// (NOUVEAU Task 15bis-2) validation STRUCTURELLE des images (tronquées /
// corrompues) : plus aucune icône d'image cassée muette.
import { validerStructureImage } from "@/lib/image-validate";
// (NOUVEAU Task 21, additif) déchiffrement à la volée : fichiers chiffrés
// (AES-256-GCM) OU historiques en clair — les deux restent servis.
import { decryptFromStorage } from "@/lib/storage-crypto";
// NOUVEAU (Task 118) : tampon automatique « signature électronique et/ou QR
// code » apposé AU SERVAGE (affichage ET téléchargement) selon la
// configuration de l'onglet Importation — l'original stocké reste intact et
// les fiches déjà importées sont tamponnées elles aussi. Le portail employé
// applique la même empreinte/le même tampon (jumelle JS dans portail-server.js).
// (MODIFIÉ 0.2.48) le tampon couvre désormais PDF, IMAGE (PNG/JPG), DOCX et
// XLSX/XLSM via tamponnerFicheDossier (répartiteur par type de contenu).
import {
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
// NOUVEAU (Task 244) : PRÉSERVATION DE LA SIGNATURE D'ORIGINE — la première
// signature d'une fiche (copie PAdES conservée, ou rendu tamponné figé) est
// servie TELLE QUELLE : modifier/remplacer la signature dans les paramètres
// ne touche JAMAIS une fiche déjà signée (administration, portail employé,
// vérification QR) ; la signature active ne concerne que les fiches pas
// encore signées.
import {
  lireCopieFigee,
  figerCopieSignee,
  resoudreCopieConservee,
} from "@/lib/copie-signee";

export const runtime = "nodejs";

// CORRECTIF : le PDF est recherché dans plusieurs dossiers candidats
// (racine du projet, répertoire courant historique, ancien emplacement
// .next/standalone/storage/payslips des versions précédentes).
// Voir src/lib/storage-dir.ts.

/**
 * GET /api/payslips/[id]/file?download=1
 * Sert le PDF original stocké (affichage inline ou téléchargement).
 *
 * (Task 15bis — diagnostic « l'aperçu d'une fiche PNG affiche une image
 * cassée ») Trois améliorations SANS changer le comportement nominal :
 *   1. erreur de DÉCHIFFREMENT → message EXPLICITE (clé de chiffrement du
 *      stockage modifiée dans .env) au lieu du générique « introuvable » ;
 *   2. fichier VIDE sur le disque (0 octet) → message EXPLICITE (import
 *      interrompu : antivirus, disque plein, synchronisation…) — c'est la
 *      cause principale de l'icône d'image cassée dans l'aperçu ;
 *   3. le type MIME est déduit des OCTETS RÉELS du fichier (signature
 *      PNG/JPEG/PDF) en priorité sur l'extension du nom stocké : une fiche
 *      « .png » dont le contenu est en réalité un PDF s'affiche désormais
 *      correctement au lieu d'une image cassée.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  // NOUVEAU (Task 64) : mot de passe expiré — politique 15 jours, TOUS les comptes :
  // seul le changement de mot de passe reste autorisé, toute autre API répond 403.
  if (user.mustChangePassword) return motDePasseExpire();
  // NOUVEAU (Task 172) : le fichier d'une fiche ne peut pas être servi au rôle IT
  // (ni liste ni recherche — aucun accès aux fiches de paie).
  if (user.role === "IT") return refusIT("l'affichage du fichier d'une fiche de paie");
  try {
    const { id } = await params;
    const record = await db.payslip.findUnique({ where: { id } });
    if (!record) {
      return NextResponse.json({ error: "Fiche de paie introuvable." }, { status: 404 });
    }

    const filePath = resolveStoredFile(record.storedName);
    if (!filePath) {
      return NextResponse.json(
        {
          error:
            "Fichier PDF introuvable sur le serveur. La fiche existe bien, mais aucun dossier de stockage examiné (racine du projet, storage\\payslips, .next\\standalone\\storage\\payslips) ne contient ce fichier. Vérifiez la variable AUTO_RH_STORAGE_DIR ou réimportez la fiche.",
        },
        { status: 404 }
      );
    }
    const rawStored = await readFile(filePath);
    let data: Buffer;
    try {
      // (Task 21) déchiffre si le fichier est chiffré ; fichier historique en
      // clair renvoyé tel quel (aucun comportement antérieur modifié).
      data = decryptFromStorage(rawStored);
    } catch (e) {
      // (Task 15bis) Échec GCM = clé de chiffrement DIFFÉRENTE de celle de
      // l'import (AUTO_RH_STORAGE_KEY / AUTH_SECRET modifiées dans .env).
      // Message explicite à l'écran + journal console (logs du site).
      console.error(
        "[FILE] Fichier illisible (clé de chiffrement différente ?):",
        record.storedName,
        e instanceof Error ? e.message : e
      );
      return NextResponse.json(
        {
          error:
            "Fiche illisible sur le serveur : la clé de chiffrement du stockage (AUTO_RH_STORAGE_KEY / AUTH_SECRET dans .env) ne correspond pas à celle utilisée lors de l'import de cette fiche. Solutions : 1) restaurez dans .env la valeur d'origine utilisée au moment de l'import ; 2) ou supprimez puis réimportez la fiche depuis le fichier original.",
        },
        { status: 500 }
      );
    }
    // (Task 15bis) fichier VIDE = import interrompu → icône d'image cassée
    // dans l'aperçu. Message explicite au lieu d'un contenu vide servi.
    if (!data || data.length === 0) {
      console.error("[FILE] Fichier VIDE sur le disque (0 octet):", record.storedName);
      return NextResponse.json(
        {
          error:
            "Fichier vide sur le serveur (0 octet) : l'import a probablement été interrompu (antivirus, disque plein, synchronisation de fichiers). Supprimez cette fiche puis réimportez le fichier original.",
        },
        { status: 404 }
      );
    }
    const download = new URL(request.url).searchParams.get("download") === "1";

    // NOUVEAU (ajouté sans modifier le comportement PDF historique) : les
    // fiches importées en image (PNG/JPG, lues par OCR) sont servies avec le
    // bon type MIME ; les PDF restent servis en application/pdf.
    // NOUVEAU (ajouté sans modifier les types ci-dessus) : Excel et Word.
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

    // (Task 15bis) le CONTENU prime sur l'extension : signature reconnue
    // (PNG/JPEG/PDF) → ce type est servi, même si le nom stocké dit autre
    // chose (corrige l'« image cassée » d'une fiche mal étiquetée).
    const sniffed = sniffContentType(data);
    if (sniffed && sniffed !== contentTypeParExtension) {
      console.warn(
        "[FILE] Type réel (" + sniffed + ") différent de l'extension attendue (" +
          contentTypeParExtension + ") pour", record.storedName, "— le contenu est servi tel qu'il est."
      );
    }
    let contentType = sniffed ?? contentTypeParExtension;
    // (Task 15bis) diagnostic des fiches image réellement CORROMPUES :
    // extension image mais aucune signature connue (PNG/JPEG/PDF) → les
    // octets ne sont ni une image ni un PDF : AVANT (Task 15bis) ces
    // octets étaient servis en image/png → icône cassée muette ;
    // DÉSORMAIS (Task 15bis-2) message EXPLICITE au lieu de l'image cassée.
    if (
      !sniffed &&
      (lowerStored.endsWith(".png") ||
        lowerStored.endsWith(".jpg") ||
        lowerStored.endsWith(".jpeg"))
    ) {
      console.error(
        "[FILE] Fiche image CORROMPUE (signature inconnue, premiers octets:",
        data.subarray(0, 12).toString("hex") + "):", record.storedName,
        "— réimportez la fiche depuis le fichier original."
      );
      return NextResponse.json(
        {
          error:
            "Impossible d'afficher cette fiche : son contenu n'est NI une image valide (PNG/JPEG) NI un PDF. Les octets stockés ne correspondent à aucun format reconnu (fichier endommagé avant l'import, ou extension renommée manuellement). Solution : supprimez cette fiche puis réimportez le fichier ORIGINAL en vérifiant qu'il s'ouvre correctement sur votre ordinateur avant l'import.",
        },
        { status: 422 }
      );
    }

    // (NOUVEAU Task 15bis-2) VALIDATION STRUCTURELLE COMPLÈTE des images :
    // une signature PNG/JPEG valide ne suffit pas — un fichier TRONQUÉ
    // (import/copie interrompu, téléchargement incomplet) ou CORROMPU
    // (données IDAT indéchiffrables, IEND/EOI absents) produit exactement
    // la même icône d'image cassée MUETTE dans la visionneuse. Réponse 422
    // explicite avec la cause exacte et la solution, au lieu des octets
    // que le navigateur ne peut pas décoder.
    if (contentType === "image/png" || contentType === "image/jpeg") {
      const verdictImage = validerStructureImage(data);
      if (!verdictImage.ok) {
        console.error(
          "[FILE] Image illisible (structure invalide):", record.storedName,
          "—", verdictImage.raison, verdictImage.detail || ""
        );
        return NextResponse.json(
          {
            error:
              "Impossible d'afficher cette fiche : le fichier image stocké sur le serveur est " +
              verdictImage.raison +
              ". L'aperçu ne peut pas l'afficher car les octets ne forment pas une image complète. Solutions : 1) supprimez cette fiche puis réimportez le fichier ORIGINAL en vérifiant qu'il s'ouvre correctement sur votre ordinateur avant l'import ; 2) si le fichier original est lui-même cassé, demandez-le à nouveau à son émetteur (téléchargement interrompu, pièce jointe tronquée).",
          },
          { status: 422 }
        );
      }
      if (verdictImage.detail) {
        console.warn("[FILE] Image servie avec anomalies:", record.storedName, "—", verdictImage.detail);
      }
    }

    // ==================================================================
    // NOUVEAU (Task 244) — SIGNATURE D'ORIGINE PRÉSERVÉE : la fiche est
    // d'abord recherchée parmi les fiches DÉJÀ signées ; si elle l'est, sa
    // copie est servie TELLE QUELLE (aucun retamponnage, aucune re-signature
    // — la configuration active n'est même pas consultée) :
    //   1) copie figée propre à la fiche (première signature posée — tampon
    //      et/ou PAdES, stockée chiffrée dans storage/copies-signees/) ;
    //   2) à défaut, copie PAdES CONSERVÉE au registre (PREMIÈRE signature —
    //      signeLe ASC, pas la plus récente), aussitôt matérialisée en copie
    //      figée pour l'avenir (indépendance vis-à-vis du registre).
    // Seule une fiche pas ENCORE signée suit le pipeline historique ci-après
    // (tampon + PAdES avec la configuration ACTIVE), et son résultat est
    // aussitôt figé : c'est ainsi que la modification ou le remplacement de
    // la signature dans les paramètres ne s'applique qu'aux NOUVELLES
    // signatures, jamais rétroactivement.
    // ==================================================================
    const fileNameSafe = record.fileName.replace(/["\\\r\n]/g, "_");
    const enteteSignatureOrigine = (mention: string): string =>
      encodeURIComponent(mention);
    try {
      const figee = await lireCopieFigee(record);
      if (figee) {
        console.log(
          "[FILE] Fiche",
          record.id,
          "— copie signée FIGÉE servie (signature d'origine préservée,",
          record.copieSigneeNature || "signature",
          "du", (record.copieSigneeLe || record.uploadedAt).toISOString(), ")"
        );
        return new NextResponse(new Uint8Array(figee), {
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(figee.length),
            "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileNameSafe}"`,
            "Cache-Control": "private, max-age=0, must-revalidate",
            "X-Signature-Electronique": enteteSignatureOrigine(
              "signature d'origine préservée (copie figée " +
                (record.copieSigneeNature || "") +
                " du " +
                (record.copieSigneeLe || record.uploadedAt).toISOString() +
                ") — toute modification de la configuration ne s'applique pas aux fiches déjà signées"
            ),
          },
        });
      }
    } catch (e) {
      console.error("[FILE] Copie figée illisible (repli pipeline):", e);
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
            // Matérialisation en copie figée (une seule fois) : la copie
            // PAdES conservée devient la référence permanente de la fiche,
            // même si le registre est purgé ultérieurement.
            await figerCopieSignee(record.id, copie, "PADES");
            console.log(
              "[FILE] Fiche",
              record.id,
              "— copie signée CONSERVÉE (registre) servie : signature d'origine préservée"
            );
            return new NextResponse(new Uint8Array(copie), {
              headers: {
                "Content-Type": "application/pdf",
                "Content-Length": String(copie.length),
                "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileNameSafe}"`,
                "Cache-Control": "private, max-age=0, must-revalidate",
                "X-Signature-Electronique": enteteSignatureOrigine(
                  "copie signée conservée — signature d'origine (certificat « " +
                    (reg.certSujet || "certificat") +
                    " », signée le " + reg.signeLe.toISOString() +
                    ") — toute modification de la configuration ne s'applique pas aux fiches déjà signées"
                ),
              },
            });
          }
        }
      }
    } catch (e) {
      console.error("[FILE] Copie conservée (registre) illisible (repli pipeline):", e);
    }

    // NOUVEAU (Task 118) — TAMPON AUTOMATIQUE (signature électronique et/ou
    // QR code et/ou mention) sur les PDF ; (MODIFIÉ 0.2.48) AUSSI sur les
    // fiches IMAGE (PNG/JPG), DOCX et XLSX/XLSM — le répartiteur choisit le
    // moteur selon le type de contenu ; .xls binaire reste servi tel quel.
    // Jamais bloquant : en cas d'erreur, la fiche est servie sans tampon
    // (chaque moteur gère déjà son repli interne).
    // (MODIFIÉ Task 244) ce pipeline ne concerne PLUS que les fiches pas
    // encore signées (aucune copie figée ni copie PAdES conservée) — son
    // résultat est FIGÉ juste avant la réponse : la signature posée à ce
    // premier servage signé devient la signature d'origine de la fiche.
    // (NOUVEAU v0.2.119) le cachet « Signature électronique » (Switch
    // elecActif) est alimenté EN DIRECT par le certificat du module de
    // signature — injection AVANT l'évaluation du tampon, puis la signature
    // PAdES est appliquée JUSTE APRÈS sur les mêmes octets (cachet couvert
    // par elle). Si la signature échoue ensuite, la fiche est re-tamponnée
    // SANS cachet (garantie : cachet « Signature électronique » ⇒ document
    // réellement signé).
    let donneesFinales = data;
    let typeTampon: ReturnType<typeof typeFichierTamporable> = null;
    let cfgTampon: Awaited<ReturnType<typeof completerConfigTamponAvecElec>> | null = null;
    let cachetElecAppose = false;
    const typeTamponBrut = typeFichierTamporable(contentType);
    if (typeTamponBrut) {
      try {
        cfgTampon = await completerConfigTamponAvecElec(
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
        console.error("[FILE] Tampon signature/QR non appliqué:", e);
      }
    }

    // NOUVEAU (Task 224) — SIGNATURE ÉLECTRONIQUE PAdES (API de certification
    // & signature) : si le module est ACTIF et couvre les FICHES DE PAIE, le
    // PDF final (tamponné) est signé CRYPTOGRAPHIQUEMENT — copie signée
    // CONSERVÉE + CERTIFICAT associé enregistrés (registre) + VÉRIFICATION
    // automatique ; le CACHE par empreinte évite les re-signatures d'un
    // contenu identique (la copie conservée est servie telle quelle).
    // JAMAIS bloquant : en cas d'erreur la fiche est servie sans signature
    // (l'erreur est journalisée, comme le tampon).
    let signatureElectronique = ""; // en-tête informatif X-Signature-Electronique
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
            signePar: "système (servage fiche de paie)",
          });
          if (resultat.ok && resultat.pdf) {
            donneesFinales = resultat.pdf;
            contentType = "application/pdf";
            signatureElectronique = encodeURIComponent(
              (resultat.dejaSigne ? "copie signée conservée — " : "") + resultat.message
            );
          } else {
            console.error("[FILE] Signature électronique refusée:", resultat.message);
            // (NOUVEAU v0.2.119) GARANTIE cachet ⇒ signature : le PDF
            // tamponné porte peut-être le cachet « Signature électronique »
            // (elecActif ON + certificat injecté) — re-tamponnage SANS cachet
            // (configuration non injectée) pour ne jamais servir un document
            // cacheté mais non signé.
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
                console.error("[FILE] Re-tamponnage sans cachet impossible:", e2);
              }
            }
          }
        }
      } catch (e) {
        console.error("[FILE] Signature électronique non appliquée:", e);
      }
    }

    // NOUVEAU (Task 244) — FIGEAGE de la signature d'origine : le rendu
    // final (tamponné et/ou signé PAdES) est conservé une fois pour toutes
    // AVANT la réponse — les servages suivants (administration, portail
    // employé, QR) serviront exactement ces octets, même si la configuration
    // de la signature change entre-temps. Une fiche servie SANS signature
    // (paramètres inactifs) n'est pas figée : elle pourra être signée plus
    // tard à son premier servage signé.
    try {
      if (signatureElectronique) {
        // PAdES appliquée avec succès (resultat.pdf servi) → copie figée
        // « PADES » (le tampon est déjà inclus dans ces octets).
        await figerCopieSignee(record.id, donneesFinales, "PADES");
      } else if (typeTampon) {
        // Signature visuelle seule (module PAdES inactif, non couvert ou en
        // échec — re-tamponnage sans cachet déjà appliqué le cas échéant).
        await figerCopieSignee(record.id, donneesFinales, "TAMPON");
      }
    } catch (e) {
      console.error("[FILE] Figage de la signature d'origine impossible (non bloquant):", e);
    }

    // (figeage déjà tenté ci-dessus selon la signature appliquée)
    return new NextResponse(new Uint8Array(donneesFinales), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(donneesFinales.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileNameSafe}"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
        ...(signatureElectronique
          ? { "X-Signature-Electronique": signatureElectronique }
          : {}),
      },
    });
  } catch (error) {
    console.error("[FILE] Erreur:", error);
    return NextResponse.json(
      { error: "Fichier PDF introuvable sur le serveur." },
      { status: 404 }
    );
  }
}
