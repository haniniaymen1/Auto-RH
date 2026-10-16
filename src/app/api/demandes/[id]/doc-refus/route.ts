/**
 * ============================================================================
 *  NOUVEAU (Task 180) — DOCUMENT DE REFUS SIGNÉ & TAMPONNÉ : CONSULTATION
 *  ET GÉNÉRATION / RENVOI MANUEL
 * ============================================================================
 *  GET /api/demandes/[id]/doc-refus[?telecharger=1]
 *    → sert le contenu du document de DÉCISION DE REFUS (docRefusChemin,
 *      stocké CHIFFRÉ) — « inline » pour CONSULTER dans le navigateur
 *      (nouvel onglet), ou « attachment » avec ?telecharger=1. Utilisé par
 *      les boutons Visualiser / Télécharger du détail de la demande :
 *      l'administrateur et le RH ouvrent et consultent la réponse en cas de
 *      refus directement depuis la gestion des demandes, sans perdre
 *      l'historique de la demande et de sa décision.
 *
 *  POST /api/demandes/[id]/doc-refus
 *    → génère (ou RÉGÉNÈRE) le document de refus signé électroniquement et
 *      tamponné de la demande, le conserve et le RENVOIE (employé À +
 *      RH + manager Cc). Bouton du détail quand le RH veut régénérer après
 *      un changement de configuration (certificat, tampon…) ou renvoyer.
 *
 *  Règles (POST) :
 *   - statut REFUSEE obligatoirement (TOUS les types sont concernés) ;
 *   - `forcer` : régénère même si un document existe (nouveau DocumentDemande,
 *     l'ancien reste consultable dans l'historique de la demande) ;
 *   - sans `forcer` : renvoi si déjà généré (nouvel envoi, pas de doublon).
 *
 *  Accès : RH et SUPERADMIN (IT → 403, comme les demandes elles-mêmes).
 * ============================================================================
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import {
  estSuperadmin,
  getSessionUser,
  motDePasseExpire,
  refusIT,
  unauthorized,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptFromStorage } from "@/lib/storage-crypto";
import { resolveStoredDocument } from "@/lib/storage-dir";
import { declencherDocumentRefus } from "@/lib/doc-signe";

export const runtime = "nodejs";

/** Service du document de refus (inline = consultation, attachment =
 *  téléchargement ?telecharger=1). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  if (session.role === "IT") return refusIT("les demandes administratives");
  try {
    const { id } = await params;
    const d = await db.demandeAdministrative.findUnique({
      where: { id },
      select: { docRefusChemin: true, docRefusNom: true },
    });
    if (!d) {
      return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
    }
    if (!d.docRefusChemin) {
      return NextResponse.json(
        { error: "Aucun document de refus généré pour cette demande." },
        { status: 404 }
      );
    }
    const filePath = resolveStoredDocument(d.docRefusChemin);
    if (!filePath) {
      console.error("[DEMANDES/DOC-REFUS] fichier introuvable :", d.docRefusChemin);
      return NextResponse.json(
        { error: "Fichier introuvable sur le serveur (storage/documents-demandes)." },
        { status: 404 }
      );
    }
    let data: Buffer;
    try {
      data = decryptFromStorage(await readFile(filePath));
    } catch {
      return NextResponse.json(
        { error: "Document illisible : la clé de chiffrement (AUTO_RH_STORAGE_KEY) ne correspond pas." },
        { status: 500 }
      );
    }
    const telecharger = request.nextUrl.searchParams.get("telecharger") === "1";
    const nom = d.docRefusNom || path.basename(d.docRefusChemin);
    const safeName = nom.replace(/["\\\r\n]/g, "_");
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(data.length),
        "Content-Disposition":
          (telecharger ? "attachment" : "inline") +
          '; filename="' + safeName + '"' +
          "; filename*=UTF-8''" + encodeURIComponent(nom),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[DEMANDES/DOC-REFUS] GET:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}

/** Génération / régénération / renvoi manuel du document de refus. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  if (session.role === "IT") return refusIT("les demandes administratives");
  if (session.role !== "RH" && !estSuperadmin(session)) {
    return NextResponse.json(
      { error: "Accès réservé aux rôles RH / superadministrateur." },
      { status: 403 }
    );
  }
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const forcer = Boolean(body?.forcer);

    const d = await db.demandeAdministrative.findUnique({ where: { id } });
    if (!d) {
      return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
    }
    if (d.statut !== "REFUSEE") {
      return NextResponse.json(
        { error: "La demande n'est pas refusée : le document de refus se génère après la décision." },
        { status: 400 }
      );
    }

    const resultat = await declencherDocumentRefus(d.id, {
      declencheur: forcer
        ? "Régénération manuelle (" + session.email + ")"
        : "Renvoi manuel (" + session.email + ")",
      forcer,
    });

    if (!resultat.genere && resultat.saute && String(resultat.motif || "").includes("déjà généré")) {
      // déjà généré sans forcer : on RENVOIE quand même (nouvel envoi)
      const renvoi = await declencherDocumentRefus(d.id, {
        declencheur: "Renvoi manuel (" + session.email + ")",
        forcer: true,
      });
      return NextResponse.json(renvoi.genere ? { ok: true, ...renvoi } : { ok: false, ...renvoi });
    }

    return NextResponse.json(
      resultat.genere
        ? { ok: true, ...resultat }
        : { ok: false, ...(resultat as Record<string, unknown>) }
    );
  } catch (error) {
    console.error("[DEMANDES/DOC-REFUS] erreur:", error);
    return NextResponse.json(
      { error: "Erreur serveur lors de la génération du document de refus." },
      { status: 500 }
    );
  }
}
