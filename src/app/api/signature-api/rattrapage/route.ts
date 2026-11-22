/**
 * ============================================================================
 *  NOUVEAU (v0.2.124) — SUIVI + RATTRAPAGE MANUEL DES FICHES DE PAIE
 * ============================================================================
 *
 *  DEMANDE : « J'ai importé des fiches de paie, puis j'ai effectué la
 *  signature électronique via l'API Certification & Signature électronique.
 *  Cependant, dans le portail employé, les fiches de paie restent affichées
 *  comme non signées électroniquement. Merci de vérifier le processus afin
 *  que le statut des fiches de paie soit correctement mis à jour dans le
 *  portail employé après une signature électronique réussie. »
 *
 *  Deux manques étaient à l'origine du statut « non signée » persistant :
 *    1. la signature MANUELLE d'un PDF de fiche (onglet Signature) créait
 *       une entrée type=AUTRE sans lien avec la fiche — le portail ne
 *       regarde que type=FICHE_PAIE (Task 231). CORRIGÉ dans
 *       signature-documents.ts : liaison automatique par empreinte SHA-256 ;
 *    2. le rattrapage automatique (v0.2.122) ne s'exécutait qu'à la
 *       TRANSITION d'activation — un certificat chargé APRÈS l'activation,
 *       ou une signature d'import échouée (jamais bloquante), laissait les
 *       fiches sans copie signée SANS moyen de relancer.
 *
 *  GET /api/signature-api/rattrapage
 *      → statistiques : fiches de paie PDF en base, fiches possédant une
 *        copie signée conservée (registre), état du module et du certificat.
 *        Rôles : IT / SUPERADMIN (matrice des rôles).
 *
 *  POST /api/signature-api/rattrapage
 *      → relance la signature de TOUTES les fiches PDF non signées en
 *        ARRIÈRE-PLAN (fire-and-forget — même chaîne que l'import :
 *        tampon éventuel → PAdES → copie conservée + registre). Le mode
 *        « forcer » est utilisé : l'option « Fiches de paie » du module ne
 *        couvre que les NOUVELLES fiches ; ici la demande est EXPLICITE.
 *        Les fiches déjà signées sont ignorées (cache du registre).
 *        Rôles : IT / SUPERADMIN.
 * ============================================================================
 */
import { NextResponse } from "next/server";
import {
  estSuperadmin,
  getSessionUser,
  motDePasseExpire,
  unauthorized,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { lireConfigSignatureApi, signerToutesFichesExistantes } from "@/lib/signature-api";

export async function GET() {
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
    // (Task 244) les fiches FIGÉES (signature d'origine déjà posée — copie
    // servie aux portails) comptent comme DÉJÀ signées au même titre que le
    // registre PAdES : union des deux ensembles pour les statistiques.
    const [totalFichesPdf, lignesSignees, figees] = await Promise.all([
      db.payslip.count({ where: { storedName: { endsWith: ".pdf" } } }),
      db.signatureApiDocument.findMany({
        where: { type: "FICHE_PAIE", chemin: { not: "" } },
        select: { sourceId: true },
      }),
      db.payslip.findMany({
        where: {
          storedName: { endsWith: ".pdf" },
          copieSigneeNom: { not: null },
        },
        select: { id: true },
      }),
    ]);
    const ensembleSignees = new Set(lignesSignees.map((l) => l.sourceId));
    for (const f of figees) ensembleSignees.add(f.id);
    const fichesSignees = ensembleSignees.size;
    return NextResponse.json({
      totalFichesPdf,
      fichesSignees,
      fichesRestantes: Math.max(0, totalFichesPdf - fichesSignees),
      moduleActif: cfg.actif,
      signerFiches: cfg.signerFiches,
      certificatCharge: Boolean(cfg.certChemin),
    });
  } catch (error) {
    console.error("[SIGNATURE-API/RATTRAPAGE] Lecture:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}

export async function POST() {
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
    if (!cfg.actif) {
      return NextResponse.json(
        { error: "Le module de signature électronique est désactivé : activez-le avant de lancer le rattrapage." },
        { status: 400 }
      );
    }
    if (!cfg.certChemin) {
      return NextResponse.json(
        { error: "Aucun certificat chargé : importez d'abord le certificat de signature (rôle IT)." },
        { status: 400 }
      );
    }
    // Lancement en arrière-plan (ne bloque JAMAIS la réponse) — le résultat
    // complet est journalisé et les compteurs ci-dessus se mettent à jour à
    // chaque rafraîchissement du panneau.
    signerToutesFichesExistantes("rattrapage manuel — panneau API", { forcer: true })
      .then((r) => {
        if (r.message) console.log("[SIGNATURE-API/RATTRAPAGE] " + r.message);
      })
      .catch((e) => console.error("[SIGNATURE-API/RATTRAPAGE] Échec:", e));
    return NextResponse.json({
      lance: true,
      message:
        "Signature électronique des fiches de paie non signées LANCÉE en arrière-plan. " +
        "Rafraîchissez les compteurs dans quelques instants : chaque fiche signée affichera immédiatement le badge « Signée électroniquement » dans le portail employé.",
    });
  } catch (error) {
    console.error("[SIGNATURE-API/RATTRAPAGE] Lancement:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
