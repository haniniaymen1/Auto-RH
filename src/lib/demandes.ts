/**
 * ============================================================================
 *  NOUVEAU (Task 116) — DEMANDES ADMINISTRATIVES : CONSTANTES ET OUTILS
 * ============================================================================
 *
 *  Conforme au cahier des charges « Demandes administratives » (1.docx) :
 *   - 5 types de demandes créées depuis le portail employé (4001) :
 *       ATTESTATION_TRAVAIL  (bouton unique → e-mail au service RH)
 *       ATTESTATION_SALAIRE  (bouton unique → e-mail au service RH)
 *       CONGE                (formulaire     → e-mail au MANAGER RESPONSABLE
 *                                             de l'employé — v0.2.132 : résolu
 *                                             AUTOMATIQUEMENT depuis
 *                                             l'affectation « Mot de passe
 *                                             initial — CIN » ; copies RH +
 *                                             demandeur)
 *       AUTORISATION_SORTIE  (formulaire     → e-mail au manager responsable
 *                                             de l'employé — v0.2.132, comme
 *                                             le congé ; copies RH +
 *                                             demandeur)
 *       PARRAINAGE           (formulaire     → e-mail à l'adresse DÉDIÉE du
 *                                             parrainage (MailConfig
 *                                             .parrainageEmail) + confirmation
 *                                             automatique au demandeur)
 *   - statut de traitement : EN_ATTENTE | ACCEPTEE | REFUSEE |
 *       INFORMATION_REQUISE (demande de modification / information
 *       complémentaire) ;
 *   - référence lisible unique DEM-AAAA-NNNNN présente dans l'interface et
 *     dans chaque e-mail ;
 *   - notification par e-mail à l'employé à chaque changement de statut
 *     (envoyée par l'administration 4000, src/lib/mailer.ts).
 *
 *  Ce module ne contient QUE des constantes/purs outils partagés par les
 *  routes API (src/app/api/demandes/*) et l'interface (demandes-tab.tsx).
 *  Le portail (scripts/portail-server.js) possède sa jumelle JS des
 *  libellés et du routage — ⚠ garder les deux alignées.
 * ============================================================================
 */

/** Types de demandes (valeurs stockées en base). */
export const TYPES_DEMANDE = [
  "ATTESTATION_TRAVAIL",
  "ATTESTATION_SALAIRE",
  "CONGE",
  "AUTORISATION_SORTIE",
  "PARRAINAGE",
] as const;
export type TypeDemande = (typeof TYPES_DEMANDE)[number];

/** Libellés affichés (interface + e-mails). */
export const LIBELLES_TYPE: Record<string, string> = {
  ATTESTATION_TRAVAIL: "Attestation de travail",
  ATTESTATION_SALAIRE: "Attestation de salaire",
  CONGE: "Demande de congé",
  AUTORISATION_SORTIE: "Autorisation de sortie",
  PARRAINAGE: "Demande de parrainage",
};

// (MODIFIÉ Task 178) — VALIDEE : statut posé AUTOMATIQUEMENT quand la
// réponse e-mail du manager d'une demande de congé est reconnue comme une
// validation (cahier des charges « reconnaissance des formulations
// d'acceptation/refus »). ACCEPTEE reste le statut posé manuellement par le
// RH depuis l'administration.
export const STATUTS_DEMANDE = [
  "EN_ATTENTE",
  "ACCEPTEE",
  "REFUSEE",
  "VALIDEE",
  "INFORMATION_REQUISE",
] as const;
export type StatutDemande = (typeof STATUTS_DEMANDE)[number];

/** Libellés de statut affichés. */
export const LIBELLES_STATUT: Record<string, string> = {
  EN_ATTENTE: "En attente",
  ACCEPTEE: "Acceptée",
  REFUSEE: "Refusée",
  VALIDEE: "Validée",
  INFORMATION_REQUISE: "Information requise",
};

/* ==========================================================================
 * NOUVEAU (Task 181) — VALIDATION À DEUX ÉTAPES MANAGER → RH
 * ==========================================================================
 * Les demandes de CONGÉ et d'AUTORISATION DE SORTIE sont décidées en deux
 * étapes : le MANAGER d'abord (réponse e-mail reconnue par la Task 178 ou
 * saisie manuelle du RH), le SERVICE RH ensuite. Le statut final suit la
 * matrice du cahier des charges :
 *   Manager Acceptée + RH Acceptée → « Acceptée » (ACCEPTEE) ;
 *   Manager Refusée → « Refusée par le Manager » (REFUSEE + refuseePar=
 *                     MANAGER — refus IMMÉDIAT, aucune transmission RH) ;
 *   Manager Acceptée + RH Refusée → « Refusée par les RH » (REFUSEE +
 *                     refuseePar=RH) ;
 *   toute autre combinaison → « En attente » (EN_ATTENTE).
 * Jumelle JS dans scripts/portail-server.js (calculerStatutFinalDeuxEtapes)
 * — ⚠ garder les deux alignées.
 * ========================================================================== */

/** Types soumis à la validation à deux étapes Manager → RH. */
export const TYPES_DEUX_ETAPES = ["CONGE", "AUTORISATION_SORTIE"] as const;

/** Décisions tracées des deux étapes. */
export const DECISIONS_DEUX_ETAPES = ["EN_ATTENTE", "ACCEPTEE", "REFUSEE"] as const;

export function typeDeuxEtapes(type: string): boolean {
  return (TYPES_DEUX_ETAPES as readonly string[]).indexOf(type) >= 0;
}

/**
 * Applique la MATRICE de la validation à deux étapes : décisions du manager
 * et du RH → statut final (+ raffinement refuseePar pour les refus).
 * null = décision non encore tracée (équivalent « En attente »).
 */
export function statutFinalDepuisDecisions(
  decisionManager: string | null | undefined,
  decisionRh: string | null | undefined
): { statut: "EN_ATTENTE" | "ACCEPTEE" | "REFUSEE"; refuseePar: "MANAGER" | "RH" | null } {
  const m = decisionManager === "ACCEPTEE" || decisionManager === "REFUSEE" ? decisionManager : "EN_ATTENTE";
  const r = decisionRh === "ACCEPTEE" || decisionRh === "REFUSEE" ? decisionRh : "EN_ATTENTE";
  // Refus du MANAGER : décision immédiate et définitive (prioritaire).
  if (m === "REFUSEE") return { statut: "REFUSEE", refuseePar: "MANAGER" };
  // Refus du RH : définitif également (manager en attente ou acceptant).
  if (r === "REFUSEE") return { statut: "REFUSEE", refuseePar: "RH" };
  // Acceptation FINALE : les DEUX décisions « Acceptée » sont requises.
  if (m === "ACCEPTEE" && r === "ACCEPTEE") return { statut: "ACCEPTEE", refuseePar: null };
  // Sinon : en attente (décision manquante — manager et/ou RH).
  return { statut: "EN_ATTENTE", refuseePar: null };
}

/** Libellé RAFFINÉ du statut final (« Refusée par le Manager » / « Refusée
 *  par les RH ») — les autres statuts gardent leur libellé historique. */
export function libelleStatutFinal(statut: string, refuseePar: string | null | undefined): string {
  if (statut === "REFUSEE") {
    if (refuseePar === "MANAGER") return "Refusée par le Manager";
    if (refuseePar === "RH") return "Refusée par les RH";
  }
  return libelleStatut(statut);
}

/** Libellé d'une décision d'étape (manager ou RH). */
export function libelleDecision(d: string | null | undefined): string {
  if (d === "ACCEPTEE") return "Acceptée";
  if (d === "REFUSEE") return "Refusée";
  return "En attente";
}


/** Statuts que le RH/IT peut poser depuis l'administration. */
export const STATUTS_TRAITABLES: StatutDemande[] = [
  "ACCEPTEE",
  "REFUSEE",
  "INFORMATION_REQUISE",
];

/** Libellé sûr d'un type (valeur inconnue = texte brut). */
export function libelleType(type: string): string {
  return LIBELLES_TYPE[type] ?? type;
}

/** Libellé sûr d'un statut. */
export function libelleStatut(statut: string): string {
  return LIBELLES_STATUT[statut] ?? statut;
}

/** Masquage du CIN (cohérent avec le portail : 3 derniers caractères). */
export function masquerCin(cin: string): string {
  const v = String(cin ?? "");
  if (v.length <= 3) return v;
  return "•••" + v.slice(-3);
}

/**
 * NOUVEAU (v0.2.43) — Résolution du VRAI nom de l'employé depuis les fiches
 * de paie importées (jumelle JS : nomEmployeDepuisFiches() de
 * scripts/portail-server.js). La fiche la plus RÉCENTE dont le CIN
 * correspond (égalité indexée sur cinIndex, ou numéro présent DANS LE
 * CONTENU via PayslipCinToken) fournit son employeeName. Retourne "" si
 * aucun nom trouvé — l'appelant garde alors son repli (nom du formulaire ou
 * « Employé (CIN •••123) »). JAMAIS bloquante : toute erreur → "".
 */
export async function nomEmployeDepuisFiches(
  cin: string | null | undefined
): Promise<string> {
  try {
    const { normaliserCin } = await import("@/lib/payslip-index");
    const { chiffrerChamp, dechiffrerChamp } = await import("@/lib/db-crypto");
    const { db } = await import("@/lib/db");
    const q = normaliserCin(cin);
    if (!q) return "";
    const idx = chiffrerChamp(q, true) ?? "";
    if (!idx) return "";
    // 1) fiches dont le champ cin détecté correspond (égalité SQL indexée).
    //    (MODIFIÉ v0.2.50) la référence est le nom le plus FRÉQUENT parmi
    //    les 8 fiches les plus récentes (à égalité : la plus récente) —
    //    MÊME RÈGLE que la détection d'anomalies à l'import
    //    (nom-anomalies-serveur.ts) : une fiche récente mal orthographiée
    //    ou sans nom ne doit pas devenir la référence.
    const candidates = await db.payslip.findMany({
      where: { cinIndex: idx },
      orderBy: { uploadedAt: "desc" },
      take: 8,
      select: { employeeName: true },
    });
    const { formeLettres } = await import("@/lib/nom-anomalies");
    const compte = new Map<string, { n: number; nom: string }>();
    for (const c of candidates) {
      const n = String(dechiffrerChamp(c.employeeName ?? "") ?? "").trim();
      if (!n) continue;
      const cle = formeLettres(n);
      if (!cle) continue;
      const ex = compte.get(cle);
      if (ex) ex.n += 1;
      else compte.set(cle, { n: 1, nom: n });
    }
    let nom = "";
    let meilleure: { n: number; nom: string } | null = null;
    for (const v of compte.values()) {
      if (!meilleure || v.n > meilleure.n) meilleure = v;
    }
    if (meilleure) nom = meilleure.nom;
    if (nom) return nom;
    // 2) repli : numéro présent DANS LE CONTENU (jetons indexés) —
    //    même règle de fréquence sur les 8 fiches les plus récentes.
    const jetons = await db.payslipCinToken.findMany({
      where: { token: idx },
      orderBy: { payslip: { uploadedAt: "desc" } },
      take: 8,
      select: { payslip: { select: { employeeName: true } } },
    });
    const compteJ = new Map<string, { n: number; nom: string }>();
    for (const j of jetons) {
      const n = String(
        dechiffrerChamp(j.payslip?.employeeName ?? "") ?? ""
      ).trim();
      if (!n) continue;
      const cle = formeLettres(n);
      if (!cle) continue;
      const ex = compteJ.get(cle);
      if (ex) ex.n += 1;
      else compteJ.set(cle, { n: 1, nom: n });
    }
    let meilleureJ: { n: number; nom: string } | null = null;
    for (const v of compteJ.values()) {
      if (!meilleureJ || v.n > meilleureJ.n) meilleureJ = v;
    }
    return meilleureJ ? meilleureJ.nom : "";
  } catch {
    return ""; // jamais bloquante — repli libellé générique
  }
}

/**
 * NOUVEAU (v0.2.125 — exigence « l'employé reçoit automatiquement un e-mail
 * contenant la réponse ainsi que, le cas échéant, le fichier joint ») —
 * RÉSOLUTION DU DESTINATAIRE de la notification e-mail au moment où UNE
 * RÉPONSE est envoyée depuis l'interface Portail Administration (traitement
 * statut/commentaire ET réponse avec document).
 *
 * Ordre de résolution (première adresse VALIDE retenue) :
 *   1. l'e-mail COURANT de l'accès portail du CIN (PortalAccess.email) —
 *      c'est l'adresse que le RH voit et corrige au crayon (« modifier-
 *      email », v0.2.91 : « cette adresse reçoit les NOTIFICATIONS de ses
 *      demandes administratives » — la promesse est désormais tenue y compris
 *      pour les demandes déjà créées) ;
 *   2. l'e-mail FIGÉ sur la demande à sa création (employeEmail —
 *      comportement historique, utile quand l'accès portail n'existe plus) ;
 *   3. le DERNIER DESTINATAIRE CONNU d'un envoi de l'accès portail
 *      (PortalAccess.mailEnvoyeA — bouton « Envoyer l'e-mail », Task 92) —
 *      couvre les accès créés sans e-mail mais qui ont déjà reçu leur
 *      courrier d'activation.
 *
 * Chaque candidate est contrôlée (présence de « @ », pas d'espace, 6 à 254
 * caractères) : une valeur inexploitable est SAUTÉE (pas d'envoi vers une
 * adresse cassée). JAMAIS bloquant : toute erreur → null (l'appelant applique
 * sa note « absence d'adresse » et la réponse part quand même, l'employé la
 * suit dans son portail).
 */
export interface DestinataireDemande {
  email: string;
  /** D'où vient l'adresse (tracée dans la notification et les journaux) :
   *  "acces-portail" | "demande" | "acces-portail (dernier envoi)". */
  source: string;
  /** Libellé français prêt à afficher dans l'interface. */
  sourceLibelle: string;
}

/** Contrôle léger de plausibilité d'une adresse stockée. */
function adresseValide(v: unknown): v is string {
  const s = String(v ?? "").trim();
  return (
    s.length >= 6 &&
    s.length <= 254 &&
    s.includes("@") &&
    !/\s/.test(s) &&
    /^[^@]+@[^@]+\.[^@]{2,}$/.test(s)
  );
}

export async function destinataireNotificationDemande(
  cin: string | null | undefined,
  employeEmailFige: string | null | undefined
): Promise<DestinataireDemande | null> {
  try {
    const { db } = await import("@/lib/db");
    const { normaliserCin } = await import("@/lib/payslip-index");
    // Accès portail du CIN : essai brut puis forme normalisée (tolérance aux
    // demandes anciennes dont le CIN n'était pas normalisé).
    let acces: { email: string | null; mailEnvoyeA: string | null } | null = null;
    const candidatsCin: string[] = [];
    const brut = String(cin ?? "").trim();
    if (brut) candidatsCin.push(brut);
    try {
      const norm = normaliserCin(brut);
      if (norm && !candidatsCin.includes(norm)) candidatsCin.push(norm);
    } catch { /* normalisation indisponible : brut seul */ }
    for (const c of candidatsCin) {
      try {
        const row = await db.portalAccess.findUnique({
          where: { cin: c },
          select: { email: true, mailEnvoyeA: true },
        });
        if (row) { acces = row; break; }
      } catch { /* CIN inconnu / accès supprimé : candidat suivant */ }
    }
    // 1) e-mail COURANT de l'accès portail (corrigé par le RH le cas échéant)
    if (acces && adresseValide(acces.email)) {
      return {
        email: String(acces.email).trim(),
        source: "acces-portail",
        sourceLibelle: "adresse e-mail de l'accès portail",
      };
    }
    // 2) e-mail FIGÉ sur la demande à sa création (historique préservé)
    if (adresseValide(employeEmailFige)) {
      return {
        email: String(employeEmailFige).trim(),
        source: "demande",
        sourceLibelle: "adresse figée sur la demande",
      };
    }
    // 3) dernier destinataire connu d'un envoi de l'accès portail
    if (acces && adresseValide(acces.mailEnvoyeA)) {
      return {
        email: String(acces.mailEnvoyeA).trim(),
        source: "acces-portail (dernier envoi)",
        sourceLibelle: "dernier envoi connu de l'accès portail",
      };
    }
    return null;
  } catch {
    return null; // jamais bloquant
  }
}

/**
 * Génère la référence lisible suivante : DEM-<année>-<numéro sur 5 chiffres>.
 * Le numéro continue la séquence de l'année courante (count + 1, en évitant
 * toute collision par relecture de la dernière référence existante).
 */
export async function genererReference(): Promise<string> {
  const { db } = await import("@/lib/db");
  const annee = new Date().getFullYear();
  let n = (await db.demandeAdministrative.count()) + 1;
  // Sécurité anti-collision (suppressions éventuelles) : on avance jusqu'à
  // trouver une référence libre — boucle bornée (jamais 10 000 demandes d'un coup).
  for (let i = 0; i < 10000; i++) {
    const ref = `DEM-${annee}-${String(n).padStart(5, "0")}`;
    const existe = await db.demandeAdministrative.findUnique({
      where: { reference: ref },
      select: { id: true },
    });
    if (!existe) return ref;
    n++;
  }
  // Repli (théorique) : unicité totale garantie par un suffixe horodaté.
  return `DEM-${annee}-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Analyse le champ MailConfig.responsablesMap (une règle par ligne
 * « DEPARTEMENT=email » ; la clé spéciale DEFAUT reçoit les départements
 * sans règle). Retourne la carte (clés en MAJUSCULES) et l'adresse par défaut.
 */
export function analyserResponsablesMap(txt: string | null | undefined): {
  map: Record<string, string>;
  defaut: string;
} {
  const map: Record<string, string> = {};
  let defaut = "";
  for (const ligneBrute of String(txt ?? "").split(/\r?\n/)) {
    const ligne = ligneBrute.trim();
    if (!ligne || !ligne.includes("=")) continue;
    const i = ligne.indexOf("=");
    const cle = ligne.slice(0, i).trim().toUpperCase();
    const val = ligne.slice(i + 1).trim();
    if (!cle || !val) continue;
    if (cle === "DEFAUT") defaut = val;
    else map[cle] = val;
  }
  return { map, defaut };
}

/** (OBSOLÈTE — v0.2.132, demande utilisateur) AUCUN type ne collecte plus
 * d'e-mail N+1 / responsable : le MANAGER RESPONSABLE est résolu
 * AUTOMATIQUEMENT depuis l'affectation « Mot de passe initial — CIN » (congé
 * + autorisation de sortie — v0.2.132), le parrainage part à l'adresse
 * dédiée (v0.2.92). Conservé pour compatibilité d'appels éventuels. */
export function typeAvecNPlusUn(_type: string): boolean {
  return false;
}

/**
 * Construit les paires [libellé, valeur] affichées dans le DÉTAIL d'une
 * demande (interface) et dans les e-mails — ordre du cahier des charges.
 * `donnees` = JSON des champs du formulaire (déjà déchiffré). Les champs
 * techniques auto-renseignés (CIN, date de la demande) ne sont PAS répétés :
 * ils figurent déjà dans l'entête des e-mails / de la fiche.
 */
export function pairesInfosDemande(
  type: string,
  donnees: Record<string, unknown>
): [string, string][] {
  const s = (k: string): string => String(donnees[k] ?? "").trim();
  switch (type) {
    case "ATTESTATION_TRAVAIL":
    case "ATTESTATION_SALAIRE":
      // (MODIFIÉ v0.2.49) les attestations collectent désormais le NOM et le
      // PRÉNOM de l'employé — affichés ici et dans les e-mails. Les demandes
      // antérieures (sans ces champs) ne montrent AUCUNE ligne vide : les
      // paires ne sont ajoutées que si la valeur est présente.
      return (
        [
          ...(s("nom") ? [["Nom", s("nom")]] : []),
          ...(s("prenom") ? [["Prénom", s("prenom")]] : []),
        ] as [string, string][]
      );
    case "CONGE":
      return [
        ["Type de congé", s("typeConge")],
        ["Date de début", s("dateDebut")],
        ["Date de fin", s("dateFin")],
        // (MODIFIÉ — v0.2.132) le MANAGER RESPONSABLE (résolu automatiquement
        // depuis l'affectation « Mot de passe initial — CIN ») remplace la
        // ligne « E-mail du N+1 / responsable » ; l'ancienne ligne ne
        // s'affiche PLUS que pour les demandes ANTÉRIEURES qui portent
        // encore ce champ.
        // (CORRECTIF v0.2.201) : les spreads conditionnels inféraient
        // `string[]` au lieu de `[string, string]` — on type explicitement.
        ...(s("managerNom") ? ([["Manager responsable", s("managerNom")]] as [string, string][]) : []),
        ...(s("emailN1") ? ([["E-mail du N+1 / responsable", s("emailN1")]] as [string, string][]) : []),
        ["Commentaire", s("commentaire")],
      ];
    case "AUTORISATION_SORTIE":
      return [
        ["Date", s("date")],
        // (MODIFIÉ — Task 175) nom / prénom PLUS SAISIS dans le portail :
        // récupérés automatiquement depuis le Portail Administration
        // (« Accès portail par mot de passe »). Demandes antérieures : nom et
        // prénom séparés, affichés tels quels ; demandes nouvelles : nom
        // complet unique sous « Nom et prénom ». Aucune ligne vide.
        ...(s("prenom")
          ? ([
              ...(s("nom") ? [["Nom", s("nom")]] : []),
              ["Prénom", s("prenom")],
            ] as [string, string][])
          : s("nom")
            ? ([["Nom et prénom", s("nom")]] as [string, string][])
            : []),
        // (NOUVEAU — v0.2.132) le MANAGER RESPONSABLE (résolu automatiquement
        // depuis l'affectation « Mot de passe initial — CIN ») s'affiche pour
        // les demandes nouvelles ; les demandes ANTÉRIEURES (« Responsable
        // N+1 » / « Département ») restent affichées telles quelles.
        ...(s("managerNom")
          ? ([["Manager responsable", s("managerNom")]] as [string, string][])
          : []),
        // (MODIFIÉ — v0.2.88) « Responsable N+1 » pour les demandes anciennes
        // (l'ancien champ « Département » est remplacé dans le portail) ;
        // les demandes ANTÉRIEURES (département) restent affichées telles quelles.
        ...(s("responsableN1")
          ? ([["Responsable N+1", s("responsableN1")]] as [string, string][])
          : []),
        ...(s("departement") ? ([["Département", s("departement")]] as [string, string][]) : []),
        ["Motif", s("motif")],
        ["Nombre d'heures", s("nombreHeures")],
        ["Heure de sortie", s("heureSortie")],
        ["Heure de retour", s("heureRetour")],
        [
          "Compensation des heures",
          s("compensation") === "OUI"
            ? "Oui — les heures d'absence seront compensées"
            : "Non — heures non compensées",
        ],
      ];
    case "PARRAINAGE":
      // (MODIFIÉ — Task 175) le parrain est l'employé connecté : son nom et
      // son e-mail sont résolus AUTOMATIQUEMENT côté portail (Portail
      // Administration) — paires affichées seulement si résolues. Les
      // demandes antérieures (champs saisis) restent affichées telles quelles.
      // (MODIFIÉ — v0.2.92) l'e-mail du N+1 n'est PLUS COLLECTÉ dans le
      // formulaire : la ligne ne s'affiche que pour les demandes ANTÉRIEURES
      // qui portaient ce champ (les demandes nouvelles n'en ont plus).
      return [
        ...(s("nomParrain")
          ? ([["Nom et prénom du parrain", s("nomParrain")]] as [
              string,
              string,
            ][])
          : []),
        ...(s("emailParrain")
          ? ([["E-mail du parrain", s("emailParrain")]] as [string, string][])
          : []),
        ...(s("emailN1")
          ? ([["E-mail du N+1 / responsable", s("emailN1")]] as [string, string][])
          : []),
        ["Date du parrainage", s("dateParrainage")],
        ["Opération / Hiérarchie", s("operation")],
        ["Nom et prénom du filleul", s("nomFilleul")],
        ["Téléphone du filleul", s("telFilleul")],
      ];
    default:
      return Object.entries(donnees).map(([k, v]) => [k, String(v ?? "")]);
  }
}
