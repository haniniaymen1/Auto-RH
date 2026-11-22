import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  motDePasseExpire,
  getSessionUser,
  unauthorized,
} from "@/lib/auth";
// NOUVEAU (Task 79) : même normalisation que le répertoire des employés
// (majuscules, sans espaces/tirets/points/slashs) — « 9593-1034 » et
// « 95931034 » sont le MÊME CIN et ne doivent compter qu'UNE fois.
import { normalizeQuery } from "@/lib/payslip-extractor";

export const runtime = "nodejs";

/** GET /api/stats — statistiques du tableau de bord. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  // NOUVEAU (Task 64) : mot de passe expiré — politique 15 jours, TOUS les comptes :
  // seul le changement de mot de passe reste autorisé, toute autre API répond 403.
  if (user.mustChangePassword) return motDePasseExpire();
  try {
    const total = await db.payslip.count();

    // NOUVEAU (Task 99) — VOIE RAPIDE par l'index déterministe : quand
    // TOUTES les fiches sont indexées (cinIndexedAt renseigné), les
    // dédoublonnages se font en SQL sur les empreintes chiffrées
    // (cinIndex / nomIndex, colonnes indexées) SANS déchiffrer la table —
    // indispensable à 240 000 fiches (l'ancienne voie déchiffrait toute la
    // base à chaque chargement du tableau de bord).
    const restants = await db.payslip.count({ where: { cinIndexedAt: null } });
    if (restants === 0) {
      // Parité avec l'ancienne voie :
      //  - fichesAvecCin : cin non null ⇔ cinIndex non null (l'indexeur
      //    copie le cas « chaîne vide » en chaîne vide, pas en null) ;
      //  - withCin : CIN DISTINCTS normalisés = groupes cinIndex (les
      //    empreintes déterministes sont égales ⇔ formes normalisées
      //    égales), en excluant la chaîne vide comme avant ;
      //  - employees : noms DISTINCTS = groupes nomIndex (empreinte
      //    déterministe du nom exact, comme l'ancien Set JavaScript).
      const fichesAvecCin = await db.payslip.count({
        where: { cinIndex: { not: null } },
      });
      const groupesCin = await db.payslip.groupBy({
        by: ["cinIndex"],
        where: { cinIndex: { not: null } },
      });
      const withCin = groupesCin.filter((g) => g.cinIndex !== "").length;
      const withoutCin = total - fichesAvecCin;
      const groupesNom = await db.payslip.groupBy({
        by: ["nomIndex"],
        where: { nomIndex: { not: null } },
      });
      const employees = groupesNom.length;
      const latest = await db.payslip.findFirst({
        orderBy: { uploadedAt: "desc" },
        select: { uploadedAt: true },
      });
      const withCinPlafonne = Math.min(withCin, fichesAvecCin, total);
      return NextResponse.json({
        total,
        withCin: withCinPlafonne,
        withoutCin,
        employees,
        lastUpload: latest?.uploadedAt?.toISOString() ?? null,
      });
    }

    // ---- VOIE HISTORIQUE (fiches pas encore indexées) ----
    // (MODIFIÉ Task 79) Demande utilisateur : « vérifier le nombre de CIN —
    // il ne doit pas être le même nombre que les fiches de paie ». Constat :
    // les deux cartes affichaient 1557 = 1557 car withCin comptait les FICHES
    // possédant un CIN (count), pas les CIN eux-mêmes. Plusieurs fiches
    // appartiennent au même employé (un bulletin par période) : le compteur
    // « CIN détectés » gonflait jusqu'à égaler « Fiches de paie ».
    // CORRECTION : withCin = nombre de CIN DISTINCTS détectés.
    // La colonne cin est chiffrée à IV aléatoire (Task 32) → un `distinct`
    // SQL est impossible : les lignes sont déchiffrées par le middleware de
    // src/lib/db.ts puis dédoublonnées en JavaScript (même approche que
    // `employees` ci-dessous), avec la normalisation du répertoire (Task 67).
    const fichesAvecCin = await db.payslip.count({
      where: { cin: { not: null } },
    });
    const lignesCin = await db.payslip.findMany({
      where: { cin: { not: null } },
      select: { cin: true },
    });
    const cinsDistincts = new Set<string>();
    for (const r of lignesCin) {
      const cle = normalizeQuery(String(r.cin ?? "").trim());
      if (cle) cinsDistincts.add(cle);
    }
    const withCin = cinsDistincts.size;
    // sansCin reste un comptage de FICHES (fiches sans aucun CIN détecté).
    const withoutCin = total - fichesAvecCin;

    // (MODIFIÉ Task 32 : base chiffrée) `distinct` SQL sur employeeName n'est
    // plus possible (colonne chiffrée à IV aléatoire) → déchiffrement par le
    // middleware de src/lib/db.ts puis dédoublonnage en JavaScript — résultat
    // identique (nombre d'employés distincts).
    const lignesNom = await db.payslip.findMany({
      where: { employeeName: { not: null } },
      select: { employeeName: true },
    });
    const nomsDistincts = new Set(
      lignesNom.map((r) => r.employeeName as string)
    );
    const employees = nomsDistincts.size;

    // (Task 79) Invariant honnête : le nombre de CIN distincts ne peut
    // dépasser ni le nombre de fiches, ni le nombre de fiches avec CIN.
    const withCinPlafonne = Math.min(withCin, fichesAvecCin, total);

    const latest = await db.payslip.findFirst({
      orderBy: { uploadedAt: "desc" },
      select: { uploadedAt: true },
    });

    return NextResponse.json({
      total,
      withCin: withCinPlafonne,
      withoutCin,
      employees,
      lastUpload: latest?.uploadedAt?.toISOString() ?? null,
    });
  } catch (error) {
    console.error("[STATS] Erreur:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
