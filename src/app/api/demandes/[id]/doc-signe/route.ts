/**
 * ============================================================================
 *  NOUVEAU (Task 179) — RÉGÉNÉRATION / RENVOI MANUEL DU DOCUMENT SIGNÉ
 *  (MODIFIÉ Task 180) — CONSULTATION du document d'acceptation signé
 * ============================================================================
 *  GET /api/demandes/[id]/doc-signe[?telecharger=1]
 *    → sert le contenu du document d'acceptation signé électroniquement et
 *      tamponné (docSigneChemin, stocké CHIFFRÉ) — « inline » pour CONSULTER
 *      dans le navigateur (nouvel onglet), ou « attachment » avec
 *      ?telecharger=1. Utilisé par le bouton Visualiser / Télécharger du
 *      détail de la demande (gestion des demandes — RH / superadmin) :
 *      l'administrateur et le RH ouvrent et consultent le document de
 *      réponse directement depuis la gestion des demandes.
 *
 *  POST /api/demandes/[id]/doc-signe
 *    → génère (ou RÉGÉNÈRE) le document d'acceptation signé électroniquement
 *      et tamponné de la demande, le conserve et le RENVOIE (employé À +
 *      RH + manager Cc). Utilisé par le bouton du détail de la demande
 *      (demandes-tab) quand le RH veut regénérer après un changement de
 *      configuration (certificat, tampon…) ou renvoyer un document.
 *
 *  Règles (POST) :
 *   - demande CONGE ou AUTORISATION_SORTIE obligatoirement ;
 *   - statut FINAL ACCEPTÉ obligatoirement (ACCEPTEE ou VALIDEE pour un congé) ;
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
import { declencherDocumentSigne } from "@/lib/doc-signe";

export const runtime = "nodejs";

/** (NOUVEAU Task 180) Service du document d'acceptation signé (inline ou
 *  téléchargement) — consultation directe depuis la gestion des demandes. */
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
      select: { docSigneChemin: true, docSigneNom: true },
    });
    if (!d) {
      return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
    }
    if (!d.docSigneChemin) {
      return NextResponse.json(
        { error: "Aucun document d'acceptation généré pour cette demande." },
        { status: 404 }
      );
    }
    const filePath = resolveStoredDocument(d.docSigneChemin);
    if (!filePath) {
      console.error("[DEMANDES/DOC-SIGNE] fichier introuvable :", d.docSigneChemin);
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
    const nom = d.docSigneNom || path.basename(d.docSigneChemin);
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
    console.error("[DEMANDES/DOC-SIGNE] GET:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}

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
    if (d.type !== "CONGE" && d.type !== "AUTORISATION_SORTIE") {
      return NextResponse.json(
        { error: "Le document d'acceptation signé concerne les demandes de congé et d'autorisation de sortie." },
        { status: 400 }
      );
    }
    const statutFinalAccepte =
      d.statut === "ACCEPTEE" || (d.type === "CONGE" && d.statut === "VALIDEE");
    if (!statutFinalAccepte) {
      return NextResponse.json(
        { error: "La demande n'est pas à un statut final accepté (Acceptée / Validée) : générez-la après la décision." },
        { status: 400 }
      );
    }

    const resultat = await declencherDocumentSigne(d.id, {
      declencheur: forcer
        ? "Régénération manuelle (" + session.email + ")"
        : "Renvoi manuel (" + session.email + ")",
      forcer,
    });

    if (!resultat.genere && resultat.saute && resultat.motif === "Document déjà généré (docSigneChemin présent).") {
      // déjà généré sans forcer : on RENVOIE quand même (nouvel envoi)
      const renvoi = await declencherDocumentSigne(d.id, {
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
    console.error("[DEMANDES/DOC-SIGNE] erreur:", error);
    return NextResponse.json(
      { error: "Erreur serveur lors de la génération du document signé." },
      { status: 500 }
    );
  }
}
