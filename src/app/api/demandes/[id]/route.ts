/**
 * ============================================================================
 *  NOUVEAU (Task 116) — API « DEMANDES ADMINISTRATIVES » (détail + traitement)
 * ============================================================================
 *  GET  /api/demandes/[id]  → détail complet d'une demande (données du
 *      formulaire déchiffrées, historique de traitement).
 *  POST /api/demandes/[id]  → TRAITEMENT par le RH/IT :
 *      { statut: "ACCEPTEE" | "REFUSEE" | "INFORMATION_REQUISE",
 *        commentaire?: string, cible?: "rh" | "manager" }
 *      → met à jour le statut + l'horodatage et le traiteur, puis envoie
 *        AUTOMATIQUEMENT l'e-mail de notification à l'employé via
 *        envoyerEmailDemandeStatut — tentative journalisée dans
 *        logs/journal-emails.log (action "demande-statut", succès OU échec
 *        avec l'erreur SMTP exacte).
 *        (MODIFIÉ v0.2.125) le DESTINATAIRE est RÉSOLU à la réponse
 *        (destinataireNotificationDemande) : e-mail COURANT de l'accès
 *        portail du CIN (corrigé par le RH le cas échéant) → e-mail figé
 *        sur la demande → dernier envoi connu de l'accès portail. Ainsi la
 *        réponse part vers une adresse VALIDE même quand la demande n'en
 *        portait pas (ou quand elle a été corrigée depuis) ; la source est
 *        tracée dans la notification. L'e-mail échoué ne bloque JAMAIS le
 *        changement de statut : la réponse contient le détail
 *        (notification: { ok / erreur }). Sans e-mail connu : statut mis à
 *        jour, notification absente (l'employé suit la demande dans son
 *        espace portail).
 *        (NOUVEAU Task 179) acceptation finale d'un congé / d'une
 *        autorisation → génération automatique du document d'acceptation
 *        SIGNÉ & TAMPONNÉ (PDF + paraphe + cachet + signature PKCS#7),
 *        stockage chiffré et envoi automatique (employé À + RH + manager Cc).
 *        (NOUVEAU Task 180) refus (TOUS types) → génération automatique du
 *        document de refus signé & tamponné (même pipeline).
 *        (NOUVEAU Task 181) VALIDATION À DEUX ÉTAPES MANAGER → RH : le
 *        statut final est calculé par la MATRICE (statutFinalDepuisDecisions)
 *        — Manager Acceptée + RH Acceptée → « Acceptée » ; Manager Refusée →
 *        « Refusée par le Manager » (immédiat, définitif) ; RH Refusée →
 *        « Refusée par les RH ». Les deux décisions sont tracées SÉPARÉMENT
 *        (decisionManager / decisionRh) et la notification employé ne part
 *        qu'à la DÉCISION FINALE. La cible « manager » permet au RH
 *        d'enregistrer la décision du manager (repli opérationnel).
 *
 *  Accès (MODIFIÉ Task 173) : RH et SUPERADMIN — l'IT ne doit NI voir NI
 *  accéder aux demandes administratives (403 dédié, onglet masqué côté IT).
 *  Mot de passe expiré → 403.
 * ============================================================================
 */
import { NextRequest, NextResponse } from "next/server";
import {
  estSuperadmin,
  getSessionUser,
  motDePasseExpire,
  refusIT,
  unauthorized,
} from "@/lib/auth";
import { db } from "@/lib/db";
import {
  envoyerEmailDemandeStatut,
  ErreurMail,
  journaliserEnvoi,
  lireConfigMail,
} from "@/lib/mailer";
import { dechiffrerChamp } from "@/lib/db-crypto";
import { matriculeEmploye } from "@/lib/matricule";
import { jetonReponse } from "@/lib/stamp";
import {
  destinataireNotificationDemande,
  libelleDecision,
  libelleStatut,
  libelleStatutFinal,
  libelleType,
  masquerCin,
  nomEmployeDepuisFiches,
  pairesInfosDemande,
  statutFinalDepuisDecisions,
  STATUTS_TRAITABLES,
  typeDeuxEtapes,
} from "@/lib/demandes";
// (NOUVEAU Task 179) génération automatique du document d'acceptation signé
// et tamponné (congé / autorisation de sortie acceptées).
// (NOUVEAU Task 180) génération automatique du document de REFUS signé et
// tamponné (TOUS les types refusés — congé, autorisation, attestations,
// parrainage).
import {
  declencherDocumentRefus,
  declencherDocumentSigne,
  estDocumentSigConcerne,
} from "@/lib/doc-signe";

export const runtime = "nodejs";

function formatFr(d: Date): string {
  try {
    return d.toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
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

function destinatairesDoc(brut: string | null | undefined): Record<string, unknown> | null {
  if (!brut) return null;
  try {
    const v = dechiffrerChamp(brut);
    return v ? (JSON.parse(v) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * (NOUVEAU Task 194) HISTORIQUE DES RÉPONSES E-MAIL REÇUES — champ
 * `reponsesRecues` (chiffré JSON, écrit par le portail scripts/portail-server.js
 * à chaque réponse identifiée) : déchiffré et normalisé pour l'interface —
 * le RH y consulte la réponse ORIGINALE du manager/des RH (texte, date et
 * heure, expéditeur, décision reconnue, formulations, pièces jointes, statut
 * avant/après), y compris pour les réponses AMBIGUÏES ou NON RECONNUES
 * (statut resté « En attente »). Toute anomalie = liste vide (jamais bloquant).
 */
interface ReponseRecueItem {
  le: string;
  de: string;
  role: string;
  sujet: string;
  texte: string;
  decision: string | null;
  formulations: string[];
  piecesJointes: string[];
  piecesJointesImportees: string[];
  // (NOUVEAU v0.2.152) identifiants des documents importés par CETTE réponse
  // — liaison directe réponse ↔ pièces jointes (liens Visualiser/Télécharger
  // rendus par réponse dans l'interface, quel que soit le statut).
  piecesJointesIds: string[];
  statutAvant: string | null;
  statutApres: string | null;
}

function reponsesRecues(brut: string | null | undefined): ReponseRecueItem[] {
  if (!brut) return [];
  try {
    const v = dechiffrerChamp(brut);
    const liste = v ? JSON.parse(v) : [];
    if (!Array.isArray(liste)) return [];
    return liste.map((e: Record<string, unknown>): ReponseRecueItem => ({
      le: typeof e.le === "string" ? e.le : "",
      de: typeof e.de === "string" ? e.de : "",
      role: typeof e.role === "string" ? e.role : "",
      sujet: typeof e.sujet === "string" ? e.sujet : "",
      texte: typeof e.texte === "string" ? e.texte : "",
      decision: typeof e.decision === "string" ? e.decision : null,
      formulations: Array.isArray(e.formulations) ? e.formulations.map(String) : [],
      piecesJointes: Array.isArray(e.piecesJointes) ? e.piecesJointes.map(String) : [],
      piecesJointesImportees: Array.isArray(e.piecesJointesImportees) ? e.piecesJointesImportees.map(String) : [],
      piecesJointesIds: Array.isArray(e.piecesJointesIds) ? e.piecesJointesIds.map(String) : [],
      statutAvant: typeof e.statutAvant === "string" ? e.statutAvant : null,
      statutApres: typeof e.statutApres === "string" ? e.statutApres : null,
    }));
  } catch {
    return [];
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  // NOUVEAU (Task 173) : l'IT ne doit NI voir NI traiter les demandes
  // administratives — garde serveur sur le détail ET le traitement.
  if (session.role === "IT") return refusIT("les demandes administratives");
  try {
    const { id } = await params;
    const d = await db.demandeAdministrative.findUnique({
      where: { id },
      // (NOUVEAU Task 122) documents transmis par le service RH (e-mail)
      include: { documents: { orderBy: { recuLe: "asc" } } },
    });
    if (!d) {
      return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
    }
    const donnees = parseDonnees(d.donnees);
    // (NOUVEAU v0.2.88 ; MODIFIÉ v0.2.97) URL publique de vérification de la
    // réponse (QR « Réponse en ligne » / mode « Fiche en ligne ») : affichée
    // au RH dans le détail de la demande avec son QR. L'adresse est lue dans
    // la configuration RÉPONSES (SignatureConfigReponse) lorsqu'elle existe
    // — c'est ELLE que le mode FICHE utilise au tamponnage — sinon dans la
    // configuration Import (continuité historique). qrUrl vide (non
    // configuré) = URL absente (le bloc ne s'affiche pas).
    let urlVerification = "";
    try {
      const repRow = await db.signatureConfigReponse.findUnique({
        where: { id: "signature-reponse" },
      });
      const cfgSig = repRow
        ? repRow
        : await db.signatureConfig.findUnique({ where: { id: "signature" } });
      const base = String(cfgSig?.qrUrl ?? "").trim().replace(/\/+$/, "");
      if (base) {
        urlVerification =
          base +
          "/verification/reponse/" +
          encodeURIComponent(d.reference) +
          "?t=" +
          jetonReponse(d.reference);
      }
    } catch {
      urlVerification = "";
    }
    // (NOUVEAU v0.2.125) adresse de notification RÉSOLUE (même règle que
    // l'envoi des réponses) — affichée au RH dans le détail AVANT d'envoyer.
    const destNotification = await destinataireNotificationDemande(d.cin, d.employeEmail);
    return NextResponse.json({
      item: {
        id: d.id,
        reference: d.reference,
        type: d.type,
        typeLibelle: libelleType(d.type),
        statut: d.statut,
        statutLibelle: libelleStatut(d.statut),
        // (NOUVEAU Task 181) validation à deux étapes Manager → RH : les
        // TROIS champs (Décision Manager / Décision RH / Statut final) avec
        // leur traçabilité complète (horodatage, acteur, formulation ou
        // commentaire) — l'historique de la demande et de sa décision est
        // conservé. Libellé final raffiné : « Refusée par le Manager » /
        // « Refusée par les RH » selon refuseePar.
        deuxEtapes: typeDeuxEtapes(d.type),
        decisionManager: d.decisionManager ?? null,
        decisionManagerLibelle: libelleDecision(d.decisionManager),
        decisionManagerLe: d.decisionManagerLe ? d.decisionManagerLe.toISOString() : null,
        decisionManagerPar: d.decisionManagerPar ?? null,
        decisionManagerNote: d.decisionManagerNote ?? null,
        decisionRh: d.decisionRh ?? null,
        decisionRhLibelle: libelleDecision(d.decisionRh),
        decisionRhLe: d.decisionRhLe ? d.decisionRhLe.toISOString() : null,
        decisionRhPar: d.decisionRhPar ?? null,
        // (NOUVEAU v0.2.151 — parité RH) formulation reconnue dans la réponse
        // e-mail des RH (jumelle de decisionManagerNote).
        decisionRhNote: d.decisionRhNote ?? null,
        refuseePar: d.refuseePar ?? null,
        statutFinalLibelle: libelleStatutFinal(d.statut, d.refuseePar),
        cin: d.cin,
        cinMasque: masquerCin(d.cin),
        // (MODIFIÉ v0.2.49) destinataire DÉCHIFFRÉ pour affichage : l'adresse
        // réellement destinataire de la demande (service RH, adresse dédiée
        // du parrainage, N+1, responsable…). Était renvoyé chiffré (illisible
        // dans l'interface) ; échec de déchiffrement = chaîne vide.
        destinataire: d.destinataire
          ? (() => {
              try { return dechiffrerChamp(d.destinataire) || ""; } catch { return ""; }
            })()
          : "",
        // (MODIFIÉ v0.2.125) e-mail de notification de l'employé RÉSOLU
        // (destinataireNotificationDemande — même règle que l'envoi des
        // réponses : e-mail courant de l'accès portail → figé sur la demande
        // → dernier envoi connu) : l'interface affiche l'adresse qui
        // recevra RÉELLEMENT la notification. employeEmailSource : d'où
        // vient l'adresse (chaîne vide = aucune adresse connue).
        employeEmail: destNotification?.email ?? "",
        employeEmailSource: destNotification?.source ?? "",
        employeEmailSourceLibelle: destNotification?.sourceLibelle ?? "",
        commentaire: d.commentaire ?? "",
        traitePar: d.traitePar ?? "",
        traiteLe: d.traiteLe ? d.traiteLe.toISOString() : null,
        // (NOUVEAU Task 179) traçabilité du document d'acceptation signé
        docSigne: {
          present: Boolean(d.docSigneChemin),
          nom: d.docSigneNom || null,
          le: d.docSigneLe ? d.docSigneLe.toISOString() : null,
          par: d.docSignePar || null,
          envoiLe: d.docSigneEnvoiLe ? d.docSigneEnvoiLe.toISOString() : null,
          erreur: d.docSigneErreur || null,
          destinataires: destinatairesDoc(d.docSigneDestinataires),
        },
        // (NOUVEAU Task 180) traçabilité du document de REFUS signé & tamponné
        docRefus: {
          present: Boolean(d.docRefusChemin),
          nom: d.docRefusNom || null,
          le: d.docRefusLe ? d.docRefusLe.toISOString() : null,
          par: d.docRefusPar || null,
          envoiLe: d.docRefusEnvoiLe ? d.docRefusEnvoiLe.toISOString() : null,
          erreur: d.docRefusErreur || null,
          destinataires: destinatairesDoc(d.docRefusDestinataires),
        },
        // (NOUVEAU Task 194) historique des RÉPONSES E-MAIL reçues
        reponsesRecues: reponsesRecues(d.reponsesRecues),
        createdAt: d.createdAt.toISOString(),
        donnees,
        infos: pairesInfosDemande(d.type, donnees),
        // (NOUVEAU Task 122) documents reçus par e-mail du service RH
        // (MODIFIÉ Task 180) `auto` : document généré automatiquement par le
        // système (acceptation / refus) — `courant` : c'est la VERSION
        // ACTUELLE du document signé (les régénérations gardent les anciennes
        // versions consultables dans l'historique de la demande).
        documents: (d.documents ?? []).map((doc) => ({
          id: doc.id,
          nomFichier: doc.nomFichier,
          taille: doc.taille,
          typeMime: doc.typeMime,
          recuLe: doc.recuLe ? doc.recuLe.toISOString() : null,
          recuDe: doc.recuDe,
          auto: String(doc.recuDe || "").startsWith("Génération automatique"),
          courant:
            (Boolean(d.docSigneChemin) && doc.chemin === d.docSigneChemin) ||
            (Boolean(d.docRefusChemin) && doc.chemin === d.docRefusChemin),
        })),
        // (NOUVEAU v0.2.88) URL publique de vérification (QR Réponse en ligne)
        urlVerification,
      },
    });
  } catch (error) {
    console.error("[DEMANDES] Détail:", error);
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
  // NOUVEAU (Task 173) : l'IT ne doit NI voir NI traiter les demandes
  // administratives — garde serveur sur le détail ET le traitement.
  if (session.role === "IT") return refusIT("les demandes administratives");
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const statut = String(body?.statut ?? "").trim();
    const commentaire = String(body?.commentaire ?? "").trim().slice(0, 1000);
    // (NOUVEAU Task 181) CIBLE de la décision : « rh » (défaut — le service RH
    // décide depuis l'administration) ou « manager » (le RH ENREGISTRE la
    // décision du MANAGER — repli opérationnel : le manager décide
    // normalement en répondant par e-mail à la demande, reconnaissance
    // Task 178 ; cette voie manuelle couvre les cas où il répond hors e-mail).
    const cible =
      String(body?.cible ?? "rh").trim().toLowerCase() === "manager"
        ? "manager"
        : "rh";

    if (!(STATUTS_TRAITABLES as string[]).includes(statut)) {
      return NextResponse.json(
        { error: "Statut invalide : ACCEPTEE, REFUSEE ou INFORMATION_REQUISE attendu." },
        { status: 400 }
      );
    }

    const d = await db.demandeAdministrative.findUnique({ where: { id } });
    if (!d) {
      return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
    }
    if (d.statut === statut && !commentaire) {
      return NextResponse.json(
        { error: "La demande porte déjà ce statut — ajoutez un commentaire ou choisissez un autre statut." },
        { status: 400 }
      );
    }

    // =====================================================================
    // (NOUVEAU Task 181) VALIDATION À DEUX ÉTAPES MANAGER → RH
    // =====================================================================
    // CONGÉ et AUTORISATION DE SORTIE : le statut final est calculé par la
    // MATRICE statutFinalDepuisDecisions() — Manager Acceptée + RH Acceptée
    // → « Acceptée » ; Manager Refusée → « Refusée par le Manager » (défini-
    // tif, immédiat) ; RH Refusée → « Refusée par les RH » ; sinon « En
    // attente ». Les deux décisions sont tracées SÉPARÉMENT (historique
    // conservé) et l'acceptation finale déclenche le document signé (Task
    // 179), le refus final le document de refus (Task 180).
    const deuxEtapes = typeDeuxEtapes(d.type);
    if (deuxEtapes) {
      // Aucune réouverture d'une décision finale.
      if (d.statut === "ACCEPTEE" || d.statut === "VALIDEE") {
        return NextResponse.json(
          { error: "La demande est déjà acceptée (décision finale) — elle ne peut plus être modifiée." },
          { status: 400 }
        );
      }
      if (d.statut === "REFUSEE" && statut === "ACCEPTEE") {
        return NextResponse.json(
          {
            error:
              d.refuseePar === "MANAGER"
                ? "La demande a été refusée par le manager — décision définitive, elle ne peut pas être acceptée."
                : "La demande a été refusée par les RH — elle ne peut pas être acceptée.",
          },
          { status: 400 }
        );
      }
    }

    const traiteLe = new Date();
    const statutAvant = d.statut;
    let statutFinal: string = statut;
    let refuseeParFinal: string | null = null;
    let declencheur = "Décision RH (" + session.email + ")";
    // (Task 181) vrai quand la décision RH est enregistrée mais que la
    // demande reste « En attente » faute de décision du manager — AUCUNE
    // notification finale ni document tant que la matrice n'est pas complète.
    let enAttenteManager = false;
    const maj: Record<string, unknown> = {};

    if (deuxEtapes && cible === "manager") {
      // --- Saisie manuelle de la DÉCISION MANAGER (repli opérationnel) ---
      if (statut === "INFORMATION_REQUISE") {
        return NextResponse.json(
          { error: "« Information requise » est une décision RH — elle ne peut pas être enregistrée pour le manager." },
          { status: 400 }
        );
      }
      maj.decisionManager = statut;
      maj.decisionManagerLe = traiteLe;
      maj.decisionManagerPar = "RH " + session.email + " (saisie pour le manager)";
      maj.decisionManagerNote = commentaire || null;
      const finale = statutFinalDepuisDecisions(statut, d.decisionRh);
      statutFinal = finale.statut;
      refuseeParFinal = finale.refuseePar;
      if (statutFinal === "EN_ATTENTE") {
        // Manager a accepté mais le RH n'a pas encore décidé : la demande
        // reste « En attente » (statut et traçage de traitement inchangés).
        statutFinal = statutAvant === "INFORMATION_REQUISE" ? "EN_ATTENTE" : statutAvant;
        enAttenteManager = true;
      } else {
        maj.traitePar = "Manager (décision saisie par " + session.email + ")";
        maj.traiteLe = traiteLe;
        declencheur = "Décision manager (saisie par " + session.email + ")";
      }
    } else {
      // --- DÉCISION RH (cible « rh » — flux historique + deux étapes) ---
      if (statut === "ACCEPTEE") {
        maj.decisionRh = "ACCEPTEE";
        maj.decisionRhLe = traiteLe;
        maj.decisionRhPar = session.email;
        if (deuxEtapes) {
          const finale = statutFinalDepuisDecisions(d.decisionManager, "ACCEPTEE");
          statutFinal = finale.statut;
          refuseeParFinal = finale.refuseePar;
          if (statutFinal === "EN_ATTENTE") {
            // Le RH accepte mais le manager n'a pas encore décidé : la
            // demande RESTE « En attente » — le statut final passera à
            // « Acceptée » dès la décision du manager (réponse e-mail
            // reconnue ou saisie manuelle).
            statutFinal = statutAvant === "INFORMATION_REQUISE" ? "EN_ATTENTE" : statutAvant;
            enAttenteManager = true;
          }
        }
      } else if (statut === "REFUSEE") {
        maj.decisionRh = "REFUSEE";
        maj.decisionRhLe = traiteLe;
        maj.decisionRhPar = session.email;
        refuseeParFinal = "RH";
      }
      // INFORMATION_REQUISE : flux historique inchangé (pas de décision
      // d'étape tracée — ce n'est pas une acceptation ni un refus).
      if (!enAttenteManager) {
        maj.traitePar = session.email;
        maj.traiteLe = traiteLe;
      }
    }

    maj.statut = statutFinal;
    if (refuseeParFinal) maj.refuseePar = refuseeParFinal;
    else maj.refuseePar = null;
    // Le commentaire de la demande reste la trace de la décision RH (flux
    // historique) ; la note du manager est portée par decisionManagerNote.
    if (!(deuxEtapes && cible === "manager")) {
      maj.commentaire = commentaire || null;
    }
    const maj2 = await db.demandeAdministrative.update({
      where: { id: d.id },
      data: maj as never,
    });

    // (NOUVEAU Task 179) ACCEPTATION FINALE d'un congé / d'une autorisation :
    // génération automatique du PDF (toutes les informations), tampon
    // (paraphe + cachet + mention), SIGNATURE ÉLECTRONIQUE par le certificat
    // configuré, stockage chiffré et ENVOI AUTOMATIQUE (employé À + RH et
    // manager Cc) — JAMAIS bloquant : une panne du document signé n'annule
    // PAS la décision (le résultat est renvoyé et journalisé).
    // (MODIFIÉ Task 181) déclenchée seulement quand la MATRICE est complète
    // (statut final ACCEPTEE) — pas quand la décision RH reste en attente
    // du manager.
    let docSigne: Record<string, unknown> | null = null;
    if (
      statutFinal === "ACCEPTEE" &&
      statutAvant !== "ACCEPTEE" &&
      statutAvant !== "VALIDEE" &&
      estDocumentSigConcerne(maj2.type, statutFinal)
    ) {
      docSigne = (await declencherDocumentSigne(maj2.id, {
        declencheur,
      })) as Record<string, unknown>;
    }

    // (NOUVEAU Task 180) REFUS d'une demande (TOUS types) : génération
    // AUTOMATIQUE du document de décision de refus — PDF (toutes les
    // informations + MOTIF), tampon (paraphe + cachet + mention), signature
    // électronique par le certificat configuré, stockage chiffré + envoi
    // (employé À + RH et manager Cc) — JAMAIS bloquant : une panne du
    // document n'annule PAS la décision (résultat renvoyé et journalisé).
    // (MODIFIÉ Task 181) couvre le refus du MANAGER comme celui des RH
    // (refuseePar raffine le libellé affiché).
    let docRefus: Record<string, unknown> | null = null;
    if (statutFinal === "REFUSEE" && statutAvant !== "REFUSEE") {
      docRefus = (await declencherDocumentRefus(maj2.id, {
        declencheur,
      })) as Record<string, unknown>;
    }

    // Notification automatique à l'employé (cahier des charges : e-mail à
    // chaque décision). Jamais bloquante : une panne SMTP n'annule PAS le
    // traitement — le journal d'envoi garde la trace de l'échec.
    // (MODIFIÉ Task 181) AUCUNE notification tant que la décision finale n'est
    // pas atteinte (décision RH enregistrée mais manager pas encore décidé) —
    // l'employé sera notifié à la décision FINALE (matrice complète).
    // (v0.2.125 conservé) le DESTINATAIRE est RÉSOLU à la réponse
    // (destinataireNotificationDemande) : e-mail courant de l'accès portail
    // → figé sur la demande → dernier envoi connu.
    const notificationFinale =
      statutFinal === "ACCEPTEE" ||
      statutFinal === "REFUSEE" ||
      statutFinal === "INFORMATION_REQUISE";
    let notification: Record<string, unknown>;
    if (!notificationFinale) {
      notification = {
        absent: true,
        enAttenteManager: true,
        note:
          "Décision enregistrée — la demande reste en attente de la décision du manager. L'employé sera notifié dès la décision finale.",
      };
    } else {
      const destResolu = await destinataireNotificationDemande(maj2.cin, maj2.employeEmail);
      if (destResolu) {
        const donnees = parseDonnees(maj2.donnees);
        // (MODIFIÉ v0.2.43 puis v0.2.49) le VRAI nom de l'employé : nom saisi
        // dans le formulaire — PRÉNOM puis NOM (ordre naturel français, aligné
        // sur le portail : « Jean BEN SALAH ») — attestations v0.2.49 incluses,
        // sinon nom du parrain (parrainage), sinon résolu depuis les fiches de
        // paie importées (congé — fiche la plus récente dont le CIN
        // correspond), sinon libellé générique.
        const nomFormulaire =
          [donnees["prenom"], donnees["nom"]].filter(Boolean).join(" ").trim() ||
          String(donnees["nomParrain"] ?? "").trim();
        const nomEmploye =
          nomFormulaire ||
          (await nomEmployeDepuisFiches(maj2.cin)) ||
          `Employé (CIN ${masquerCin(maj2.cin)})`;
        // NOUVEAU (v0.2.107 — demande utilisateur, point 3) : matricule de
        // l'employé dans l'e-mail (valeur manuelle de l'accès portail
        // prioritaire, sinon fiche la plus récente du CIN). Vide = ligne omise.
        const matricule = await matriculeEmploye(maj2.cin);
        const contenu = {
          reference: maj2.reference,
          typeLibelle: libelleType(maj2.type),
          nomEmploye: nomEmploye,
          cinMasque: masquerCin(maj2.cin),
          matricule,
          dateDemande: formatFr(maj2.createdAt),
          // (MODIFIÉ Task 181) libellé RAFFINÉ : « Refusée par le Manager » /
          // « Refusée par les RH » selon l'origine du refus.
          statutLabel: libelleStatutFinal(statutFinal, refuseeParFinal),
          commentaire: commentaire || null,
          infos: pairesInfosDemande(maj2.type, donnees),
        };
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
          const { messageId, from, response } = await envoyerEmailDemandeStatut(
            destResolu.email,
            contenu
          );
          journaliserEnvoi({
            action: "demande-statut",
            dest: destResolu.email,
            from,
            host: cfgHost,
            port: cfgPort,
            secure: cfgSecure,
            succes: true,
            messageId,
            reponseSmtp: response,
            reference: maj2.reference,
            type: maj2.type,
          });
          notification = { envoye: true, destinataire: destResolu.email, source: destResolu.source, sourceLibelle: destResolu.sourceLibelle, messageId };
        } catch (e) {
          const code = e instanceof ErreurMail ? e.code : "SMTP_ECHEC";
          const detail = e instanceof Error ? e.message : String(e);
          journaliserEnvoi({
            action: "demande-statut",
            dest: destResolu.email,
            from: "",
            host: cfgHost,
            port: cfgPort,
            secure: cfgSecure,
            succes: false,
            code,
            erreur: detail,
            reference: maj2.reference,
            type: maj2.type,
          });
          notification = { envoye: false, destinataire: destResolu.email, source: destResolu.source, sourceLibelle: destResolu.sourceLibelle, erreur: detail };
        }
      } else {
        notification = {
          envoye: false,
          absenceEmail: true,
          note:
            "Aucune adresse e-mail connue pour cet employé (ni sur la demande, ni sur son accès portail) : il suit la réponse dans la section « Demandes administratives » de son espace portail.",
        };
      }
    }

    return NextResponse.json({
      ok: true,
      // (MODIFIÉ Task 181) le statut FINAL appliqué (matrice deux étapes) —
      // peut différer du statut demandé si la décision croisée manque.
      statut: statutFinal,
      statutLibelle: libelleStatutFinal(statutFinal, refuseeParFinal),
      statutDemande: statut,
      cible,
      enAttenteManager,
      decisionManager: maj2.decisionManager ?? null,
      decisionRh: maj2.decisionRh ?? null,
      refuseePar: maj2.refuseePar ?? null,
      traitePar: maj2.traitePar ?? "",
      traiteLe: traiteLe.toISOString(),
      notification,
      docSigne,
      docRefus,
    });
  } catch (error) {
    console.error("[DEMANDES] Traitement:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
