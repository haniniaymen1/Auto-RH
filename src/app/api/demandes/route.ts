/**
 * ============================================================================
 *  NOUVEAU (Task 116) — API « DEMANDES ADMINISTRATIVES » (liste)
 * ============================================================================
 *  GET /api/demandes?type=&statut=&q=
 *   → liste des demandes créées depuis le portail employé, la plus récente
 *     d'abord (plafond 400). Filtres optionnels : type (ATTESTATION_TRAVAIL…),
 *     statut (EN_ATTENTE / ACCEPTEE / REFUSEE / INFORMATION_REQUISE), q
 *     (référence contenant… ou CIN exact). Compteurs par statut inclus.
 *
 *  Accès (MODIFIÉ Task 173 — « Permissions du rôle IT ») : RH et SUPERADMIN.
 *  L'IT ne doit NI voir NI accéder aux demandes administratives : toute
 *  requête du rôle IT reçoit un 403 dédié (refusIT) — l'onglet « Demandes »
 *  est également masqué dans son interface.
 * ============================================================================
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, motDePasseExpire, refusIT, unauthorized } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  libelleDecision,
  libelleStatut,
  libelleStatutFinal,
  libelleType,
  masquerCin,
  pairesInfosDemande,
  STATUTS_DEMANDE,
  TYPES_DEMANDE,
  typeDeuxEtapes,
} from "@/lib/demandes";
import { matriculesPourCins } from "@/lib/matricule";
import { normaliserCin } from "@/lib/payslip-index";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  // NOUVEAU (Task 173) : l'IT ne doit NI voir NI accéder aux demandes
  // administratives — garde serveur (l'onglet est aussi masqué côté IT).
  if (session.role === "IT") return refusIT("les demandes administratives");
  try {
    const sp = request.nextUrl.searchParams;
    const type = String(sp.get("type") ?? "").trim();
    const statut = String(sp.get("statut") ?? "").trim();
    const q = String(sp.get("q") ?? "").trim();

    const where: Record<string, unknown> = {};
    if (type && (TYPES_DEMANDE as readonly string[]).includes(type)) {
      where.type = type;
    }
    if (statut && (STATUTS_DEMANDE as readonly string[]).includes(statut)) {
      where.statut = statut;
    }
    // q = CIN exact (8-9 chiffres) OU référence contenant la saisie.
    const qPropre = q.replace(/\s/g, "").toUpperCase();
    if (qPropre) {
      if (/^\d{7,10}$/.test(qPropre)) {
        where.cin = qPropre;
      } else {
        where.reference = { contains: qPropre };
      }
    }

    const [lignes, total, enAttente, acceptees, refusees, infosRequises] =
      await Promise.all([
        db.demandeAdministrative.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: 400,
          // (NOUVEAU Task 122) documents transmis par le service RH (e-mail)
          include: { documents: { orderBy: { recuLe: "asc" } } },
        }),
        db.demandeAdministrative.count({ where }),
        db.demandeAdministrative.count({ where: { ...where, statut: "EN_ATTENTE" } }),
        db.demandeAdministrative.count({ where: { ...where, statut: "ACCEPTEE" } }),
        db.demandeAdministrative.count({ where: { ...where, statut: "REFUSEE" } }),
        db.demandeAdministrative.count({ where: { ...where, statut: "INFORMATION_REQUISE" } }),
      ]);

    // NOUVEAU (v0.2.107 — demande utilisateur, point 3) : matricule de
    // l'employé pour CHAQUE demande — résolution EN LOT (deux requêtes
    // indexées) : valeur manuelle de l'accès portail (prioritaire) sinon
    // matricule de la fiche la plus récente du CIN. Les demandes sans
    // matricule connu reçoivent "" (affichage « — »).
    const matricules = await matriculesPourCins(lignes.map((d) => d.cin));

    return NextResponse.json({
      total,
      compteurs: {
        EN_ATTENTE: enAttente,
        ACCEPTEE: acceptees,
        REFUSEE: refusees,
        INFORMATION_REQUISE: infosRequises,
      },
      items: lignes.map((d) => {
        let donnees: Record<string, unknown> = {};
        try {
          donnees = JSON.parse(d.donnees || "{}");
        } catch {
          donnees = {};
        }
        return {
          id: d.id,
          reference: d.reference,
          type: d.type,
          typeLibelle: libelleType(d.type),
          statut: d.statut,
          statutLibelle: libelleStatut(d.statut),
          // (NOUVEAU Task 181) validation à deux étapes Manager → RH :
          // décisions tracées + libellé raffiné du statut final
          // (« Refusée par le Manager » / « Refusée par les RH »).
          deuxEtapes: typeDeuxEtapes(d.type),
          decisionManager: d.decisionManager ?? null,
          decisionManagerLibelle: libelleDecision(d.decisionManager),
          decisionRh: d.decisionRh ?? null,
          decisionRhLibelle: libelleDecision(d.decisionRh),
          refuseePar: d.refuseePar ?? null,
          statutFinalLibelle: libelleStatutFinal(d.statut, d.refuseePar),
          cin: d.cin,
          cinMasque: masquerCin(d.cin),
          // NOUVEAU (v0.2.107) : matricule de l'employé demandeur (auto).
          matricule: matricules.get(normaliserCin(d.cin)) ?? "",
          destinataire: d.destinataire ?? "",
          employeEmail: d.employeEmail ?? "",
          commentaire: d.commentaire ?? "",
          traitePar: d.traitePar ?? "",
          traiteLe: d.traiteLe ? d.traiteLe.toISOString() : null,
          createdAt: d.createdAt.toISOString(),
          donnees,
          infos: pairesInfosDemande(d.type, donnees),
          // (NOUVEAU Task 122) documents reçus par e-mail du service RH —
          // dédupliqués par empreinte, stockés chiffrés sur le disque.
          documents: (d.documents ?? []).map((doc) => ({
            id: doc.id,
            nomFichier: doc.nomFichier,
            taille: doc.taille,
            tailleLisible: tailleLisibleDocument(doc.taille),
            typeMime: doc.typeMime,
            recuLe: doc.recuLe ? doc.recuLe.toISOString() : null,
            recuDe: doc.recuDe,
          })),
        };
      }),
    });
  } catch (error) {
    console.error("[DEMANDES] Liste:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}

/** (Task 122) taille lisible partagée (ex. « 84,2 Ko »). */
function tailleLisibleDocument(n: number): string {
  const v = Number(n || 0);
  if (!isFinite(v) || v <= 0) return "0 Ko";
  if (v >= 1048576) return (v / 1048576).toFixed(1).replace(".", ",") + " Mo";
  return Math.max(1, Math.round(v / 1024)) + " Ko";
}
