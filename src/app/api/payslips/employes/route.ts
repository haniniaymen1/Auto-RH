/**
 * (Task 65) API « répertoire des employés » pour le REMPLISSAGE AUTOMATIQUE
 * du champ CIN de l'onglet « Accès portail ».
 *
 * GET /api/payslips/employes
 *   → Un enregistrement par CIN DISTINCT détecté dans les fiches de paie
 *     importées (dédoublonnage sur la forme normalisée : majuscules, sans
 *     espaces/tirets/points/slashs — même normalisation que la création
 *     d'accès et que la connexion du portail).
 *
 *   Réponse :
 *     { total, items: [{ cin, cinAffiche, nom, prenom, nomComplet,
 *                        matricule, fiches, derniereFiche }] }
 *     - cin          : CIN normalisé (valeur exacte passée à « Créer l'accès »)
 *     - cinAffiche   : CIN tel que détecté dans la fiche (affichage)
 *     - nom          : MODIFIÉ (v0.2.109) PREMIER MOT du nom d'employé le
 *                      plus récent associé à ce CIN (règles de découpage
 *                      séparNomPrenom — composés « Ben »/« Bel »/« Bou » inclus dans
 *                      le Nom). null si aucun.
 *     - prenom       : NOUVEAU (v0.2.109) TOUS LES MOTS SUIVANTS (Prénom —
 *                      colonne « Prénom » du tableau Accès portail). null si
 *                      aucun.
 *     - nomComplet   : NOUVEAU (v0.2.109) chaîne d'origine NON découpée
 *                      (recherche, compatibilité — ex. « Saidani Mohamed
 *                      Amine »). null si aucun.
 *     - matricule    : NOUVEAU (v0.2.107) matricule de la fiche la PLUS
 *                      RÉCENTE du CIN qui en porte un (auto-association —
 *                      la colonne « Matricule » de l'onglet Accès portail
 *                      combine cette valeur avec l'éventuel matricule
 *                      manuel de l'accès, qui prime). null si aucun.
 *     - fiches       : nombre de fiches liées à ce CIN
 *     - derniereFiche: date de la fiche la plus récente de ce CIN
 *
 * MODIFIÉ (Task 67) — RÉPERTOIRE COMPLET À PARTIR DES DONNÉES IMPORTÉES :
 * l'ancienne version lisait UNIQUEMENT la colonne `cin` (remplie à l'import
 * par l'extracteur). Les fiches dont l'extraction avait échoué (ou importées
 * avec une version antérieure de l'extracteur) n'alimentaient pas la liste :
 * l'utilisateur ne voyait qu'un ou très peu de CIN et devait SAISIR le
 * numéro à la main — contraire à l'objectif « zéro saisie manuelle ».
 * Le répertoire puise désormais dans TOUTES les sources disponibles pour
 * chaque fiche, SANS jamais réécrire la base (lecture seule) :
 *
 *   S1. colonne `cin` (autoritative quand elle est remplie) ;
 *   S2. (cin vide) RELANCE de la détection ACTUELLE `detectCin()` sur le
 *       texte stocké — rattrape les fiches importées avec une version
 *       antérieure de l'extracteur (nouveaux formats Task 27 : CIN à 9
 *       chiffres, séparateurs « 26 542 351 », en-têtes de tableaux…) ;
 *   S3. (cin vide) `detectCinFromTableContext()` — bulletins à tableaux ;
 *   S4. (cin vide) scan large de TOUS les libellés CIN du texte (pas
 *       seulement le premier) : « CIN : », « N° CIN », « C.I.N n° »,
 *       « Carte d'identité », « Carte nationale d'identité », « Carte
 *       identité »… avec des formes acceptées STRICTES (8-9 chiffres, ou
 *       0-2 lettres + 5-8 chiffres) pour éviter les faux positifs ;
 *   S5. (cin vide) jetons de 8-9 chiffres du NOM DE FICHIER (hors dates
 *       « 19xx/20xx… »), retenus UNIQUEMENT s'ils apparaissent
 *       EXACTEMENT dans le contenu de la fiche (isExactCinInContent) —
 *       utile quand un numéro CNSS a capté la détection à la place du
 *       CIN : le nom du fichier (« bulletin_12345678_2024.pdf ») lève
 *       l'ambiguïté, et le portail servira bien la fiche (même critère
 *       exact que searchPayslipsByCin).
 *   S6. (cin vide) NOUVEAU (Task 70) : VALEURS CIN écrites sur la ligne
 *       SUIVANTE du libellé (« CIN (FORMAT FICTIF) » \n « DEMO 001 234 »
 *       — vu sur les fiches réelles de l'utilisateur, 20 formes :
 *       DEMO/FICTIF/SPEC/XX/INVALIDE, chiffres avant ou après les
 *       lettres, préfixes « ID: »/« CIN », suffixe « (INVALIDE) »).
 *       La relance detectCin (S2) n'en retient que la PREMIÈRE ; S6
 *       ajoute TOUTES les valeurs trouvées. Les montants (devise, %,
 *       décimal) et les lignes de tableaux sont rejetés.
 *
 *   Un CIN proposé est donc TOUJOURS soit la colonne d'une fiche, soit un
 *   libellé explicite du texte, soit présent exactement dans le contenu —
 *   c'est-à-dire exactement ce que le portail sait servir (colonne OU
 *   présence exacte dans le contenu). La saisie manuelle reste possible
 *   en repli mais n'est plus nécessaire.
 *
 * Pourquoi cette route dédiée (au lieu de réutiliser GET /api/payslips) :
 *   - réponse LÉGÈRE : aucun contenu de fiche, aucun nom de fichier, aucun
 *     extrait — uniquement le répertoire CIN/nom (Task 36 : aucune donnée
 *     de contenu inutile ne sort de l'API) ;
 *   - sémantique claire : la liste sert à sélectionner un employé, pas à
 *     parcourir les fiches ;
 *   - mêmes gardes de sécurité que toutes les API de données.
 *
 * Sécurité : réservé aux utilisateurs connectés (RH ou IT) ; refus 403
 * MOT_DE_PASSE_EXPIRE si le mot de passe du compte a expiré (politique
 * 15 jours, Task 64 — identique aux autres API de données).
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  normalizeQuery,
  detectCin,
  detectCinFromTableContext,
  isExactCinInContent,
  valeursCinLigneSuivante,
} from "@/lib/payslip-extractor";
import {
  motDePasseExpire,
  refusIT,
  getSessionUser,
  unauthorized,
} from "@/lib/auth";
// NOUVEAU (v0.2.109) : découpage automatique « Nom » / « Prénom » à partir du
// nom complet des fiches (règles utilisateur : premier mot = Nom, mots
// suivants = Prénom, composés « Ben »/« Bel » conservés ensemble).
import { separerNomPrenom } from "@/lib/nom-employe";

export const runtime = "nodejs";

/** Limite de sécurité (identique au portail : searchPayslipsByCin take 5000). */
const MAX_FICHES = 5000;

/**
 * (Task 67, S4) Scan large de TOUS les libellés CIN numériques d'un texte.
 * Libellés élargis vs detectCin (règle 1-bis) : « Carte identité »,
 * « Carte nationale d'identité » en plus de « Carte d'identité ».
 * Formes acceptées STRICTES après nettoyage des séparateurs :
 *   - 8 chiffres (CIN tunisien classique) ou 9 chiffres (biométrique) ;
 *   - 0-2 lettres + 5-8 chiffres (formats étrangers « A123456 »).
 * Un montant NON précédé d'un libellé CIN n'est JAMAIS retenu.
 */
function scanLibellesCin(texte: string): string[] {
  const trouves: string[] = [];
  if (!texte) return trouves;
  const re =
    /(?:C\.?\s*I\.?\s*N\.?|CIN|CARTE\s+(?:NATIONALE\s+)?(?:D[' ]\s*)?\s*IDENTIT[EÉ])\s*(?:N\s*[°o]\s*)?[^A-Z0-9]{0,12}((?:[A-Z]\s*)?\d[\d\s.\/\-]{3,12}\d)/gi;
  for (const m of texte.matchAll(re)) {
    const nettoye = m[1].replace(/[\s.\/\-]/g, "").toUpperCase();
    if (/^\d{8}$/.test(nettoye) || /^\d{9}$/.test(nettoye)) {
      trouves.push(nettoye);
    } else if (/^[A-Z]{0,2}\d{5,8}$/.test(nettoye)) {
      trouves.push(nettoye);
    }
  }
  return trouves;
}

/**
 * (Task 67, S5) Jetons 8-9 chiffres du nom de fichier, hors dates.
 * « bulletin_12345678_2024.pdf » → "12345678" ; « fiche_20240912.pdf » →
 * ignoré (forme date 19xx/20xx). La CONFIRMATION par le contenu (présence
 * exacte) est faite par l'appelant.
 */
function jetonsCinNomFichier(nomFichier: string): string[] {
  const jetons: string[] = [];
  if (!nomFichier) return jetons;
  for (const m of nomFichier.matchAll(/(?<!\d)(\d{8,9})(?!\d)/g)) {
    const tok = m[1];
    if (/^(?:19|20)\d{6}$/.test(tok)) continue; // date 8 chiffres (20240912)
    if (/^(?:19|20)\d{7}$/.test(tok)) continue; // date 9 chiffres (par précaution)
    jetons.push(tok);
  }
  return jetons;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  // Mot de passe expiré → API de données refusée (politique 15 jours, Task 64).
  if (user.mustChangePassword) return motDePasseExpire();
  // NOUVEAU (Task 172) : la liste des employés (CIN + noms) sert à la création
  // des accès portail — fonctionnalité refusée au rôle IT.
  if (user.role === "IT") return refusIT("la liste des employés (accès portail)");
  try {
    // (Base chiffrée) les colonnes cin / employeeName / fileName / content
    // sont chiffrées à IV aléatoire → pas de `distinct` SQL : déchiffrement
    // par le middleware de src/lib/db.ts puis dédoublonnage en JavaScript
    // (même approche que /api/stats pour les employés distincts).
    const rows = await db.payslip.findMany({
      select: {
        id: true,
        cin: true,
        employeeName: true,
        matricule: true, // (v0.2.107) auto-association du matricule par CIN
        fileName: true,
        uploadedAt: true,
      },
      orderBy: { uploadedAt: "desc" },
      take: MAX_FICHES,
    });

    // (Task 67) le CONTENU n'est chargé que pour les fiches dont la colonne
    // cin est vide (seules celles-ci ont besoin d'un scan approfondi) —
    // évite de déchiffrer inutilement tout le texte de toutes les fiches.
    const idsSansCin = rows
      .filter((r) => !(r.cin ?? "").trim())
      .map((r) => r.id);
    const contenus = new Map<string, string>();
    if (idsSansCin.length > 0) {
      const lignes = await db.payslip.findMany({
        where: { id: { in: idsSansCin } },
        select: { id: true, content: true },
        take: MAX_FICHES,
      });
      for (const l of lignes) contenus.set(l.id, l.content ?? "");
    }

    const repertoire = new Map<
      string,
      {
        cin: string;
        cinAffiche: string;
        nom: string | null;
        matricule: string | null;
        fiches: number;
        derniereFiche: string;
      }
    >();

    for (const r of rows) {
      const cinBrut = (r.cin ?? "").trim();

      // --- (Task 67) TOUTES les formes de CIN de cette fiche ---
      const formes: string[] = [];
      if (cinBrut) {
        // S1 : colonne autoritative.
        formes.push(cinBrut);
      } else {
        const contenu = contenus.get(r.id) ?? "";
        if (contenu.trim()) {
          // S2 : détection ACTUELLE (rattrape les imports anciens).
          const d1 = detectCin(contenu);
          if (d1) formes.push(d1);
          // S3 : contextes de tableaux.
          const d2 = detectCinFromTableContext(contenu);
          if (d2) formes.push(d2);
          // S4 : TOUS les libellés CIN numériques du texte.
          for (const c of scanLibellesCin(contenu)) formes.push(c);
          // S6 (Task 70) : TOUTES les valeurs CIN sur la ligne suivante
          // du libellé (S2 n'en retient que la première).
          for (const c of valeursCinLigneSuivante(contenu)) formes.push(c);
          // S5 : jetons du nom de fichier CONFIRMÉS dans le contenu.
          for (const tok of jetonsCinNomFichier(r.fileName ?? "")) {
            if (isExactCinInContent(contenu, tok)) formes.push(tok);
          }
        }
      }
      if (formes.length === 0) continue;

      // Dédoublonnage des clés de CETTE fiche (une fiche = 1 seule fois
      // par CIN, même si plusieurs sources le trouvent).
      const clesFiche = new Set<string>();
      for (const forme of formes) {
        const cle = normalizeQuery(forme);
        if (cle) clesFiche.add(cle);
      }
      if (clesFiche.size === 0) continue;

      for (const cle of clesFiche) {
        const existant = repertoire.get(cle);
        if (existant) {
          existant.fiches += 1;
          // rows triés par uploadedAt desc → la 1re occurrence est la plus
          // récente ; on ne remplace le nom que s'il manque encore.
          if (!existant.nom && r.employeeName) existant.nom = r.employeeName;
          // (v0.2.107) même règle pour le matricule : celui de la fiche la
          // plus récente qui en porte un gagne (jamais remplacé ensuite).
          if (!existant.matricule && r.matricule) existant.matricule = r.matricule;
        } else {
          repertoire.set(cle, {
            cin: cle,
            cinAffiche: cinBrut || formes[0],
            nom: r.employeeName ?? null,
            matricule: r.matricule ?? null,
            fiches: 1,
            derniereFiche: r.uploadedAt.toISOString(),
          });
        }
      }
    }

    // MODIFIÉ (v0.2.109) : chaque entrée du répertoire est DÉCOUPÉE en
    // « Nom » (premier mot — ou composé Ben/Bel) + « Prénom » (mots
    // suivants) + « nomComplet » (chaîne d'origine, rétro-compatible).
    // Tri : par Nom découpé (français, insensible à la casse) puis par CIN —
    // les employés sans nom passent en fin de liste.
    const items = Array.from(repertoire.values())
      .map((e) => {
        const decoupe = separerNomPrenom(e.nom);
        return {
          cin: e.cin,
          cinAffiche: e.cinAffiche,
          nom: decoupe.nom,
          prenom: decoupe.prenom,
          nomComplet: e.nom,
          matricule: e.matricule,
          fiches: e.fiches,
          derniereFiche: e.derniereFiche,
        };
      })
      .sort((a, b) => {
        const na = (a.nom ?? "\uffff").toLocaleLowerCase();
        const nb = (b.nom ?? "\uffff").toLocaleLowerCase();
        if (na !== nb) return na.localeCompare(nb, "fr");
        return a.cin.localeCompare(b.cin, "fr");
      });

    // NOUVEAU (Task 70) : compteurs de diagnostic — combien de fiches
    // n'ont FOURNI aucun CIN (colonne vide ET aucune source sur le texte).
    // Permet à l'interface d'alerter « X fiche(s) sans CIN identifiable
    // (scan illisible ?) » au lieu d'un silence trompeur.
    const fichesTotal = rows.length;
    const fichesSansCin = rows.filter((r) => {
      if ((r.cin ?? "").trim()) return false;
      const contenu = contenus.get(r.id) ?? "";
      if (!contenu.trim()) return true;
      return !detectCin(contenu)
        && !detectCinFromTableContext(contenu)
        && scanLibellesCin(contenu).length === 0
        && valeursCinLigneSuivante(contenu).length === 0
        && !jetonsCinNomFichier(r.fileName ?? "").some((tok) =>
          isExactCinInContent(contenu, tok)
        );
    }).length;

    return NextResponse.json({
      total: items.length,
      items,
      // NOUVEAU (Task 70) : champs additionnels rétrocompatibles.
      fichesTotal,
      fichesSansCin,
    });
  } catch (error) {
    console.error("[EMPLOYES] Erreur:", error);
    return NextResponse.json(
      { error: "Erreur serveur lors de la lecture du répertoire des employés." },
      { status: 500 }
    );
  }
}
