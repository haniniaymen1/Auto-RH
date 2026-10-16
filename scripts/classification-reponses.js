"use strict";
/**
 * ============================================================================
 *  (NOUVEAU Task 178) — CLASSIFICATION AUTOMATIQUE DES RÉPONSES E-MAIL
 * ============================================================================
 *
 *  Cahier des charges « Reconnaissance automatique des formulations
 *  d'acceptation / de refus dans les réponses e-mail aux demandes de congé » :
 *
 *    1) les formulations d'ACCEPTATION listées ci-dessous sont interprétées
 *       comme une VALIDATION (« Congé accepté », « Je valide », « OK »…) ;
 *    2) les formulations de REFUS listées ci-dessous sont interprétées comme
 *       un REFUS (« Congé refusé », « Je refuse », « NON », « Désaccord »…) ;
 *    3) le système analyse le contenu de la réponse (sujet + corps) et
 *       détermine automatiquement la décision MÊME SI LA FORMULATION VARIE :
 *       casse, accents, apostrophes, ponctuation, texte autour de la
 *       formulation (salutations, signature) sont normalisés/ignorés ;
 *    4) les réponses AMBIGUÏES (indices d'acceptation ET de refus mélangés,
 *       ex. un fil de discussion qui contient les deux) ou NE CORRESPONDANT
 *       À AUCUNE formulation reconnue ne déclenchent AUCUNE décision
 *       automatique : la demande reste « En attente » ;
 *    5) PRIORITÉ AUX REFUS : les formulations de refus sont évaluées avant
 *       les acceptations (les négations « non approuvée », « n'a pas été
 *       validée » contiennent les racines d'acceptation « approuvée »,
 *       « validée » — jamais l'inverse, une négation ne doit JAMAIS devenir
 *       une validation) ;
 *    6) les mots-clés courts (« OK », « NON », « Refus », « D'accord »…)
 *       sont reconnus sur des MOTS ENTIERS uniquement — CETTE RÈGLE
 *       S'APPLIQUE À TOUTES les formulations (phrases complètes incluses :
 *       frontières de mots des deux côtés) : « notification » ne déclenche
 *       pas « NON », « okapi » ne déclenche pas « OK », « d'accordéon » ne
 *       déclenche pas « D'accord », « je validerai » ne déclenche pas
 *       « Je valide » ;
 *
 *  Module AUTONOME (aucune dépendance) — requis par scripts/portail-server.js
 *  (réception IMAP) et directement par les tests automatisés.
 * ============================================================================
 */

/**
 * Normalisation d'un texte pour la comparaison :
 *  - minuscules ;
 *  - accents retirés (NFD puis suppression des signes diacritiques) ;
 *  - apostrophes (droites, courbes, graves) remplacées par des espaces
 *    (« d'accord » → « d accord », « n'a pas » → « n a pas ») ;
 *  - toute ponctuation/symbole/emoji remplacé par un espace ;
 *  - espaces compressés.
 */
function normaliserTexte(txt) {
  return String(txt == null ? "" : txt)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019`\u00b4]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * FORMULATIONS D'ACCEPTATION (cahier des charges — liste exhaustive).
 * Les coquilles du cahier des charges (« Demandde de congé ») sont
 * interprétées comme « Demande de congé ». Les chaînes sont stockées sous
 * leur forme d'ORIGINE (affichage dans les commentaires / e-mails) et
 * normalisées une fois au chargement (comparaison).
 */
const FORMULATIONS_ACCEPTATION = [
  "Demande de congé acceptée",
  "Congé accepté",
  "Congé validé",
  "Demande de congé validée",
  "Demande de congé approuvée",
  "Congé approuvé",
  "Demande de congé accordée",
  "Congé accordé",
  "Votre demande de congé a été acceptée",
  "Votre demande de congé a été validée",
  "Votre demande de congé a été approuvée",
  "Votre congé a été accepté",
  "Votre congé a été validé",
  // (NOUVEAU Task 194) variantes GÉNÉRIQUES sans « de congé » — la
  // classification ne s'applique qu'aux réponses aux demandes de congé et
  // d'autorisation, donc « Votre demande a été acceptée » est sans ambiguïté
  // dans ce contexte (le cahier des charges §1 exige la reconnaissance des
  // « formulations proches ou équivalentes »).
  "Votre demande a été acceptée",
  "Votre demande a été validée",
  "Votre demande a été approuvée",
  "Votre demande a été accordée",
  "Demande acceptée",
  "Demande validée",
  "Demande approuvée",
  "Demande accordée",
  "Validation de votre demande de congé",
  "Validation de la demande de congé",
  "Validation du congé",
  "Confirmation de validation de la demande de congé",
  "OK",
  "J'accorde",
  "Je valide",
  "D'accord",
  // (NOUVEAU v0.2.162 — Task 252) vocabulaire des ATTESTATIONS : les réponses
  // texte du service RH aux demandes d'attestation (travail / salaire) sont
  // désormais classifiées (TYPES_CLASSIFICATION_AUTO élargi aux 4 types).
  // Formes qualifiées par le mot « attestation » — sans ambiguïté, et SANS
  // risque de faux positif sur « attestation non acceptée » (motPresent
  // exige la séquence CONTIGUË de mots entiers).
  "Attestation de travail acceptée",
  "Attestation de travail validée",
  "Attestation de travail approuvée",
  "Attestation de travail accordée",
  "Attestation de travail délivrée",
  "Attestation de salaire acceptée",
  "Attestation de salaire validée",
  "Attestation de salaire approuvée",
  "Attestation de salaire accordée",
  "Attestation de salaire délivrée",
  "Attestation acceptée",
  "Attestation validée",
  "Attestation approuvée",
  "Attestation accordée",
];

/**
 * FORMULATIONS DE REFUS (cahier des charges — liste exhaustive).
 * ⚠ les formes négatives (« non approuvée », « n'a pas été validée »…)
 * contiennent des racines d'acceptation : elles sont TOUJOURS évaluées en
 * premier (priorité refus, cf. en-tête).
 */
const FORMULATIONS_REFUS = [
  "Demande de congé refusée",
  "Congé refusé",
  "Demande de congé rejetée",
  "Congé rejeté",
  "Demande de congé non approuvée",
  "Demande de congé non validée",
  "Demande de congé non acceptée",
  "Demande de congé refusée par le manager",
  "Votre demande de congé a été refusée",
  "Votre demande de congé a été rejetée",
  "Votre demande de congé n'a pas été approuvée",
  "Votre demande de congé n'a pas été validée",
  "Refus de votre demande de congé",
  "Notification de refus de votre congé",
  "Refus de la demande de congé",
  "Refus du congé",
  "Notification de refus de la demande de congé",
  // (NOUVEAU Task 194) variantes GÉNÉRIQUES sans « de congé » (même raison
  // que pour les acceptations : réponses aux demandes de congé uniquement).
  "Votre demande a été refusée",
  "Votre demande a été rejetée",
  "Demande refusée",
  "Demande rejetée",
  "Demande non approuvée",
  "Demande non validée",
  "Demande non acceptée",
  "NON",
  "Je refuse",
  "Refus",
  "Désaccord",
  // (NOUVEAU v0.2.162 — Task 252) refus des attestations (même logique que
  // les acceptations qualifiées ; le mot-clé « refus » ne matche pas
  // « refusée » — mot entier distinct — d'où les formes explicites).
  "Attestation de travail refusée",
  "Attestation de travail rejetée",
  "Attestation de salaire refusée",
  "Attestation de salaire rejetée",
  "Attestation refusée",
  "Attestation rejetée",
];

/**
 * Mots-clés COURTS (éléments isolés des listes du cahier des charges).
 * Reconnus sur des MOTS ENTIERS du texte normalisé (frontières d'espaces) :
 *  - « ok » ne matche pas « okapi », « non » ne matche pas « notification » ;
 *  - « refus » ne matche pas « refusée » (un mot entier distinct, couvert par
 *    les formulations complètes ci-dessus).
 *
 * ⚠ Garde anti-faux-positif : « pas d accord » (« je ne suis pas d'accord »)
 * est traité comme un signal de REFUS — aligné avec « Désaccord » de la liste
 * officielle. Sans cette garde, « pas d'accord » matcherait le mot-clé
 * d'acceptation « d accord » et validerait à tort la demande.
 */
const MOTS_CLES_ACCEPTATION = [
  "ok", "j accorde", "je valide", "d accord",
  // (NOUVEAU v0.2.163 — correction « statut reste En attente ») formulations
  // d'acceptation de PREMIÈRE PERSONNE les plus courantes, absentes de la
  // liste initiale : « J'accepte votre demande » restait NON_RECONNU (constat
  // réel en test E2E Gmail — la réponse « J'accepte… » ne changeait pas le
  // statut). Les négations (« je n accepte pas », R1-R3) restent évaluées EN
  // PRIORITÉ : aucun risque de faux positif.
  "j accepte",
  "accepte votre demande",
  "accepte la demande",
  "accepte cette demande",
  "j approuve",
  "approuve votre demande",
  "approuve la demande",
  "je vous accorde",
  "accorde votre demande",
  "accorde la demande",
];
const MOTS_CLES_REFUS = ["non", "je refuse", "refus", "desaccord", "pas d accord", "hors de question"];

/**
 * (NOUVEAU Task 194) NÉGATIONS EXPLICITES DE VALIDATION — cahier des charges
 * §6 « Priorité du refus explicite » : « Je ne valide pas cette demande de
 * congé. » et « Je ne peux pas accepter cette demande. » doivent donner
 * REFUSÉE (et JAMAIS une validation, ni un « En attente » silencieux).
 * Formes de PREMIÈRE PERSONNE les plus courantes, libellés lisibles pour les
 * commentaires / notes de décision. Comparées comme suites de MOTS ENTIERS
 * (motPresent) dans le texte normalisé — elles matchent au milieu d'une
 * phrase complète (« je ne valide pas cette demande de congé »).
 */
const NEGATIONS_REFUS = [
  { original: "Je ne valide pas", normalise: "je ne valide pas" },
  { original: "Je n'accepte pas", normalise: "je n accepte pas" },
  { original: "Je n'approuve pas", normalise: "je n approuve pas" },
  { original: "Je n'accorde pas", normalise: "je n accorde pas" },
  { original: "Je ne peux pas accepter", normalise: "je ne peux pas accepter" },
  { original: "Je ne peux pas valider", normalise: "je ne peux pas valider" },
  { original: "Je ne peux pas approuver", normalise: "je ne peux pas approuver" },
  { original: "Je ne peux pas accorder", normalise: "je ne peux pas accorder" },
  { original: "Je ne peux pas donner suite", normalise: "je ne peux pas donner suite" },
];

/**
 * (NOUVEAU Task 194) Négations GÉNÉRALES (forme non énumérée ci-dessus) :
 *  - R1 « ne + verbe de décision conjugué + pas » (« on ne valide pas »,
 *    « le manager n'accepte pas », « nous n'accordons pas » — couvre les
 *    conjugaisons valid-e/ai/erais, accept-e/erai, approuv-e/erai,
 *    accord-e/erai) ;
 *  - R2 « ne/n + auxiliaire + pas + (pu|être|été) + verbe de décision »
 *    (« votre demande n'a pas été acceptée », « n'est pas approuvée »,
 *    « ne sera pas validée », « ne peut pas être accordée », « n'a pas pu
 *    accepter ») ;
 *  - R3 négation littéraire sans « pas » (« ne peut être acceptée »,
 *    « ne saurait être validée »).
 *
 * GARDES ANTI-FAUX-REFUS : « pas encore validée », « toujours pas validée »
 * = la décision N'A PAS ENCORE ÉTÉ PRISE → la demande reste « En attente »
 * (AUCUNE négation détectée dans ces cas). Les mots n'étant PAS appariés
 * comme mots entiers ne déclenchent rien (« monnaie » ne contient pas
 * « pas » — motPresent travaille sur des tokens séparés par espaces).
 */
const REGEX_NEGATION_VERBE_PAS = new RegExp(
  "(?:^| )n(?:e)? (?:valid|accept|approuv|accord)[a-z]* pas(?: |$)"
);
const REGEX_NEGATION_PAS_VERBE = new RegExp(
  "(?:^| )n(?:e)? (?:[a-z]+ )?pas (?:pu |etre |ete )?(?:accept|valid|approuv|accord)"
);
const REGEX_NEGATION_LITTERAIRE = new RegExp(
  "(?:^| )n(?:e)? (?:peut|pourra|saurait) (?:pas )?etre (?:accept|valid|approuv|accord)"
);
/** Garde : ces expressions signifient « PAS ENCORE décidé » (jamais un refus). */
const REGEX_PAS_ENCORE = new RegExp("(?:^| )(?:pas encore|toujours pas)(?: |$)");

/** Décisions possibles retournées par classifierReponse(). */
const DECISIONS = {
  VALIDATION: "VALIDATION",
  REFUS: "REFUS",
  AMBIGUE: "AMBIGUE",
  NON_RECONNU: "NON_RECONNU",
};

// ============================================================================
// (NOUVEAU v0.2.166 — CORRECTION « statut reste En attente » sur réponses
// RÉELLES quotées) — deux mécanismes complémentaires :
//
// 1) extraireReponseUtile() : les clients de messagerie (Gmail, Outlook…)
//    CITENT l'e-mail original sous la réponse. Or les demandes de congé et
//    d'autorisation contiennent une CONSIGNE de validation (« … écrivant
//    « Acceptée » … ou « Refusée » … ») et l'e-mail de transmission RH liste
//    les formulations ACCEPTER/REFUSER — la réponse réelle citait donc les
//    DEUX décisions → AMBIGUE → aucune mise à jour (constat réel 09/10/2026 :
//    attestations OK mais congé/autorisation bloqués « En attente »).
//    L'extraction supprime séparateurs de citation (Gmail FR/EN, Outlook,
//    « ----- Message d'origine ----- »…) et lignes « > » pour ne classer QUE
//    les mots du décideur.
//
// 2) PARTICIPES SEULS (pass « utile » uniquement, corps SANS le sujet) : la
//    consigne demande littéralement d'écrire « Acceptée » ou « Refusée » —
//    ces participes passés n'étaient PAS reconnus (NON_RECONNU). Ils sont
//    reconnus dans la réponse utile (jamais dans le sujet — le sujet de
//    transmission « … acceptée par le manager … » ne doit JAMAIS produire
//    d'acceptation) avec garde anti-négation (« pas validée » ≠ validation).
// ============================================================================

/** Séparateurs de citation (par ligne TRIMMÉE). */
const REGEX_SEPARATEURS_CITATION = [
  /^le .{0,140}(a ?crit|wrote)\s?:/i,                     // Gmail FR « Le … a écrit : »
  /^on .{0,160}wrote\s?:/i,                               // Gmail EN « On … wrote: »
  /^[-=_*]{3,}\s*(message d.?origine|original message|message transf|forwarded|e-?mail d.?origine|repli)/i,
  /^[-=_*]{3,}$/,                                         // séparateur de citation générique
  /^\*?\s*de\s?:.*<\S+@\S+\.\S+>/i,                       // Outlook FR/EN « De : Nom <adresse> »
  /^\*?\s*(envoy?|sent)\s?:/i,                            // Outlook « Envoyé : » / « Sent: »
  /^\*?\s*(objet|subject)\s?:/i,                          // « Objet : » / « Subject: » quoté
  /^\*?\s*(?:le|dated?)\s?:/i,                            // en-têtes de citation résiduels
];

/** Ligne QUOTÉE (« > … », « &gt; … ») — après trim. */
const REGEX_LIGNE_QUOTEE = /^(?:>|&gt;|\u00bb)/;

/** Participes SEULS reconnus UNIQUEMENT dans la réponse utile (corps). */
const PARTICIPES_ACCEPTATION = [
  "accepte", "acceptee",
  "valide", "validee",
  "approuve", "approuvee",
  "accorde", "accordee",
  "delivre", "delivree",
];
const PARTICIPES_REFUS = ["refuse", "refusee", "rejete", "rejetee"];
/** Garde : participe précédé de ces mots = négation (« pas validée »). */
const PARTICIPE_PRECEDEurs_NEGATION = ["pas", "plus", "jamais", "non", "aucun", "aucune"];

/**
 * (NOUVEAU v0.2.178 — demande utilisateur « parrainage : mêmes expressions
 * que le congé ») GARDE SUJET — un sujet de TRANSMISSION ou de NOTIFICATION
 * SYSTÈME porte le participe SUIVI de « par » (« Auto-RH — … acceptée par
 * le manager — validation RH requise », « … refusée par le manager ») : il ne
 * doit JAMAIS produire de décision via le sujet (l'acceptation viendrait du
 * SUJET de transmission, pas du décideur). Le mot SEUL écrit par le décideur
 * (« Re: … — Acceptée », « Refusée ») ne contient PAS ce motif.
 */
const REGEX_SUJET_TRANSMISSION = new RegExp(
  "(?:accept|valid|approuv|accord|delivr|refus|rejet)[a-z]* par "
);

/**
 * (NOUVEAU v0.2.178) Le SUJET porte-t-il un participe de décision en mot
 * entier (hors motif de transmission, cf. garde ci-dessus) ? Utilisé pour :
 *  1) décider si la passe 2 s'exécute même quand la réponse utile est vide
 *     (réponse dont le SUJET seul porte la décision — « Acceptée » — avec un
 *     corps réduit à la citation) ;
 *  2) la passe 2 elle-même (scan des participes sur le sujet, mêmes gardes
 *     anti-négation que le corps).
 */
function sujetPorteParticipe(sujet) {
  const s = normaliserTexte(sujet);
  if (!s) return false;
  if (REGEX_SUJET_TRANSMISSION.test(s)) return false;
  const tokens = s.split(" ");
  for (let i = 0; i < tokens.length; i++) {
    const precedent = i > 0 ? tokens[i - 1] : "";
    if (PARTICIPE_PRECEDEurs_NEGATION.indexOf(precedent) >= 0) continue;
    if (PARTICIPES_ACCEPTATION.indexOf(tokens[i]) >= 0) return true;
    if (PARTICIPES_REFUS.indexOf(tokens[i]) >= 0) return true;
  }
  return false;
}

/**
 * Extrait la RÉPONSE UTILE d'un corps quoté : tout ce qui précède le premier
 * séparateur de citation, MOINS les lignes quotées « > ». Retourne le corps
 * inchangé (trim) s'il ne contient aucune citation.
 */
function extraireReponseUtile(texte) {
  const brut = String(texte == null ? "" : texte);
  if (!brut.trim()) return "";
  const lignes = brut.split(/\r?\n/);
  const utiles = [];
  for (const ligne of lignes) {
    const l = ligne.trim();
    if (REGEX_SEPARATEURS_CITATION.some(function (r) { return r.test(l); })) break; // citation → coupe TOUT
    if (REGEX_LIGNE_QUOTEE.test(l)) continue;                                       // ligne « > … »
    utiles.push(ligne);
  }
  return utiles.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Liste interne : [{ original, normalise }] (normalisation au chargement). */
function preparerListe(formules) {
  const vue = new Map(); // normalisé → original (première occurrence)
  const liste = [];
  for (const f of formules) {
    const n = normaliserTexte(f);
    if (!n) continue;
    if (!vue.has(n)) {
      vue.set(n, f);
      liste.push({ original: f, normalise: n });
    }
  }
  return { liste, vue };
}

const ACC = preparerListe(FORMULATIONS_ACCEPTATION);
const REF = preparerListe(FORMULATIONS_REFUS);

/** Échappe les caractères spéciaux d'un mot-clé pour RegExp. */
function echapperMot(m) {
  return m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Mot-clé OU formulation présente comme SUITE DE MOTS ENTIERS dans le texte
 * normalisé (frontières d'espaces des deux côtés) :
 *  - « ok » ne matche pas « okapi », « non » ne matche pas « notification »,
 *    « d accord » ne matche pas « d accordeon », « refus » ne matche pas
 *    « refusee » ;
 *  - « je valide » ne matche pas « je validerai » (conjugaison étendue — la
 *    demande reste alors « En attente », cahier des charges 3.e) ;
 *  - « conge accepte » matche « … un congé accepté. » (la ponctuation a déjà
 *    été réduite en espaces par la normalisation).
 */
function motPresent(texte, mot) {
  return new RegExp("(?:^| )" + echapperMot(mot) + "(?: |$)").test(texte);
}

/**
 * Déduplique les formulations reconnues : quand une formulation reconnue est
 * CONTENUE dans une autre reconnue plus longue (ex. « Demande de congé
 * refusée » ⊂ « Demande de congé refusée par le manager »), seule la plus
 * longue est rapportée. L'ordre d'apparition (refus d'abord) est conservé.
 */
function dedupliquer(matchs) {
  const tri = matchs.slice().sort(function (a, b) { return b.length - a.length; });
  const gardes = [];
  for (const m of tri) {
    if (!gardes.some(function (g) { return g.indexOf(m) >= 0; })) gardes.push(m);
  }
  // restitution dans l'ordre d'apparition initial
  return matchs.filter(function (m, i) {
    return gardes.indexOf(m) >= 0 && matchs.indexOf(m) === i;
  });
}

/**
 * Origines d'affichage des mots-clés qui ne figurent PAS comme phrases dans
 * les listes officielles (garde anti-faux-positif « pas d'accord »).
 */
const ORIGINAUX_MOTS_CLES = { "pas d accord": "Pas d'accord" };

/** Retrouve la formulation d'ORIGINE correspondant à une chaîne normalisée. */
function originalDe(vue, normalise) {
  return vue.get(normalise) || ORIGINAUX_MOTS_CLES[normalise] || normalise;
}

/**
 * CŒUR DE LA CLASSIFICATION (UNE passe sur un texte donné).
 *
 * @param {string} sujet  Sujet de l'e-mail de réponse.
 * @param {string} corps  Corps texte brut de l'e-mail (HTML dépouillé par
 *                        l'appelant si nécessaire).
 * @param {object} [opts] { participesCorps: boolean, participesSujet: boolean } — pass « utile » :
 *                        reconnaît EN PLUS les participes seuls
 *                        (« Acceptée », « Refusée »…) sur le CORPS UNIQUEMENT
 *                        (JAMAIS sur le sujet — le sujet de transmission
 *                        « … acceptée par le manager … » ne doit jamais
 *                        produire d'acceptation) ; participesSujet (NOUVEAU
 *                        v0.2.178) : reconnaît EN PLUS les participes seuls
 *                        SUR LE SUJET (garde anti-transmission intégrée :
 *                        « acceptée par le manager » est exclu) — permet la
 *                        réponse dont l'OBJET seul porte la décision.
 * @returns {{
 *   decision: "VALIDATION"|"REFUS"|"AMBIGUE"|"NON_RECONNU",
 *   decisive: boolean,            // true = VALIDATION ou REFUS (décision posable)
 *   formulations: string[],       // formulations reconnues (origines, dédupliquées)
 *   acceptations: string[],       // formulations d'acceptation reconnues
 *   refus: string[],              // formulations de refus reconnues
 * }}
 *
 * Règles :
 *  - REFUS évalué EN PREMIER (priorité aux négations) ;
 *  - acceptation ET refus reconnus ensemble → AMBIGUE (aucune décision) ;
 *  - rien de reconnu → NON_RECONNU (aucune décision, demande « En attente »).
 */
function classifierCoeur(sujet, corps, opts) {
  const participesCorps = !!(opts && opts.participesCorps);
  const participesSujet = !!(opts && opts.participesSujet);
  const texte = (normaliserTexte(sujet) + " " + normaliserTexte(corps)).trim();
  const vide = {
    decision: DECISIONS.NON_RECONNU,
    decisive: false,
    formulations: [],
    acceptations: [],
    refus: [],
  };
  if (!texte) return vide;

  // ---- 1) REFUS d'abord (priorité) -----------------------------------------
  const refus = [];
  for (const f of REF.liste) {
    if (motPresent(texte, f.normalise)) refus.push(f);
  }
  for (const m of MOTS_CLES_REFUS) {
    if (motPresent(texte, m)) {
      refus.push({ original: originalDe(REF.vue, m), normalise: m });
    }
  }
  // ---- 1.b) (NOUVEAU Task 194) NÉGATIONS EXPLICITES = REFUS ----------------
  // « Je ne valide pas cette demande de congé. » → REFUS (cahier des charges
  // §6). Les acceptations dont la forme normalisée est CONTENUE dans une
  // négation reconnue sont absorbées plus bas (règle commune aux refus).
  // Garde : « pas encore / toujours pas » = décision NON PRISE → aucune
  // négation n'est déduite (la demande reste « En attente »).
  if (REGEX_PAS_ENCORE.test(texte)) {
    // « pas encore validée », « toujours pas validée » → PAS DÉCIDÉ.
  } else {
    const negationsDetectees = [];
    for (const n of NEGATIONS_REFUS) {
      if (motPresent(texte, n.normalise)) negationsDetectees.push(n);
    }
    if (negationsDetectees.length) {
      for (const n of negationsDetectees) refus.push(n);
    } else if (REGEX_NEGATION_VERBE_PAS.test(texte)) {
      refus.push({ original: "Négation explicite (« ne … pas » + verbe de validation)", normalise: "negation verbe pas" });
    } else if (REGEX_NEGATION_PAS_VERBE.test(texte)) {
      refus.push({ original: "Négation explicite (« pas » + verbe de validation)", normalise: "negation pas verbe" });
    } else if (REGEX_NEGATION_LITTERAIRE.test(texte)) {
      refus.push({ original: "Négation explicite (« ne peut être » + verbe de validation)", normalise: "negation litteraire" });
    }
  }

  // ---- 2) ACCEPTATION -------------------------------------------------------
  // (MODIFIÉ Task 178) une acceptation dont la forme normalisée est CONTENUE
  // dans un refus reconnu est ABSORBÉE par la négation : « pas d accord »
  // (« je ne suis pas d'accord ») contient « d accord » — c'est un refus,
  // PAS une ambiguïté.
  const acceptations = [];
  for (const f of ACC.liste) {
    if (motPresent(texte, f.normalise)) acceptations.push(f);
  }
  for (const m of MOTS_CLES_ACCEPTATION) {
    if (motPresent(texte, m)) {
      acceptations.push({ original: originalDe(ACC.vue, m), normalise: m });
    }
  }
  // ---- 2.b) (NOUVEAU v0.2.166) PARTICIPES SEULS — pass « utile » UNIQUEMENT,
  // sur le CORPS (normalisé séparément, SANS le sujet) : « Acceptée »,
  // « Refusée », « Validée »… écrits seuls par le décideur conformément à la
  // consigne de validation. Garde anti-négation : « pas validée », « non
  // acceptée »… ne produisent JAMAIS d'acceptation (le mot précédent est
  // contrôlé) ; les négations classiques restent traitées en section 1.b.
  if (participesCorps) {
    const corpsNorm = normaliserTexte(corps);
    const tokens = corpsNorm ? corpsNorm.split(" ") : [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const precedent = i > 0 ? tokens[i - 1] : "";
      if (PARTICIPE_PRECEDEurs_NEGATION.indexOf(precedent) >= 0) continue;
      if (PARTICIPES_ACCEPTATION.indexOf(t) >= 0) {
        acceptations.push({ original: "Participe seul reconnu : « " + t + " »", normalise: t });
      } else if (PARTICIPES_REFUS.indexOf(t) >= 0) {
        refus.push({ original: "Participe seul reconnu : « " + t + " »", normalise: t });
      }
    }
    // ---- (NOUVEAU v0.2.178) SUJET : participes seuls dans l'OBJET de la
    // réponse (« Re: … — Acceptée », « Refusée ») — uniquement dans la passe
    // « utile » (JAMAIS en passe 1), avec la GARDE anti-transmission
    // (« … acceptée par le manager … » ne produit JAMAIS de décision via le
    // sujet — cf. REGEX_SUJET_TRANSMISSION) et les mêmes gardes anti-négation
    // (« pas acceptée » dans le sujet ne produit jamais d'acceptation).
    if (participesSujet) {
      const sujetNorm = normaliserTexte(sujet);
      if (sujetNorm && !REGEX_SUJET_TRANSMISSION.test(sujetNorm)) {
        const toks = sujetNorm.split(" ");
        for (let i = 0; i < toks.length; i++) {
          const t = toks[i];
          const precedent = i > 0 ? toks[i - 1] : "";
          if (PARTICIPE_PRECEDEurs_NEGATION.indexOf(precedent) >= 0) continue;
          if (PARTICIPES_ACCEPTATION.indexOf(t) >= 0) {
            acceptations.push({ original: "Participe seul reconnu (sujet) : « " + t + " »", normalise: t });
          } else if (PARTICIPES_REFUS.indexOf(t) >= 0) {
            refus.push({ original: "Participe seul reconnu (sujet) : « " + t + " »", normalise: t });
          }
        }
      }
    }
  }
  // ---- 2.c) (NOUVEAU v0.2.168) GARDE « PAS ENCORE / TOUJOURS PAS » ----------
  // « La demande n'a pas encore été validée. », « Toujours pas validée » : la
  // décision n'est PAS PRISE — les acceptations détectées (participes
  // « validée », « acceptée »…) proviennent de la formulation d'attente
  // elle-même et ne doivent JAMAIS devenir une VALIDATION (faux « accepté »
  // constaté en test E2E v0.2.168). Les REFUS explicites simultanés restent
  // prioritaires (« pas encore traitée, je la refuse » → REFUS).
  if (REGEX_PAS_ENCORE.test(texte)) {
    acceptations.length = 0;
  }
  const acceptationsNet = acceptations.filter(function (a) {
    return !refus.some(function (r) { return r.normalise.indexOf(a.normalise) >= 0; });
  });

  // ---- 3) décision ----------------------------------------------------------
  const refusNorm = refus.map(function (f) { return f.normalise; });
  const accNorm = acceptationsNet.map(function (f) { return f.normalise; });
  const refusOrig = dedupliquer(refusNorm).map(function (n) { return originalDe(REF.vue, n); });
  const accOrig = dedupliquer(accNorm).map(function (n) { return originalDe(ACC.vue, n); });

  let decision;
  if (refus.length && acceptationsNet.length) decision = DECISIONS.AMBIGUE;
  else if (refus.length) decision = DECISIONS.REFUS;
  else if (acceptationsNet.length) decision = DECISIONS.VALIDATION;
  else decision = DECISIONS.NON_RECONNU;

  return {
    decision: decision,
    decisive: decision === DECISIONS.VALIDATION || decision === DECISIONS.REFUS,
    formulations: refusOrig.concat(accOrig),
    acceptations: accOrig,
    refus: refusOrig,
  };
}

/**
 * (MODIFIÉ v0.2.166) CLASSIFICATION EN DEUX PASSES — correction du constat
 * réel « congé / autorisation restent En attente alors que les attestations
 * fonctionnent » :
 *
 *  PASS 1 — classification STRICTE du texte COMPLET (sujet + corps, listes
 *  historiques) : si elle est DÉCISIVE (VALIDATION ou REFUS), elle est
 *  conservée (comportement historique inchangé, non-régression garantie).
 *
 *  PASS 2 — si la passe 1 n'est pas décisive : classification de la RÉPONSE
 *  UTILE (extraireReponseUtile — citations Gmail/Outlook supprimées) AVEC
 *  participes seuls (« Acceptée », « Refusée »…) sur le corps. Si elle est
 *  décisive, elle l'emporte : les mots du DÉCIDEUR priment sur le contenu
 *  cité (consignes de validation, listes ACCEPTER/REFUSER, formulaire).
 *  Si elle n'est pas décisive mais RICHER que la passe 1 (AMBIGUE vs
 *  NON_RECONNU), elle est retournée pour la TRACE (historique Task 194) —
 *  l'effet sur le statut est identique (aucune décision automatique).
 *
 * @param {string} sujet  Sujet de l'e-mail de réponse.
 * @param {string} corps  Corps texte brut (HTML dépouillé par l'appelant).
 */
function classifierReponse(sujet, corps) {
  const passe1 = classifierCoeur(sujet, corps, { participesCorps: false });
  if (passe1.decisive) return passe1;
  const utile = extraireReponseUtile(corps);
  // (NOUVEAU v0.2.178) la passe 2 s'exécute AUSSI quand le SUJET seul porte
  // la décision (« Re: … — Acceptée » avec un corps réduit à la citation) :
  // utile vide mais sujet décisif → la passe 2 doit scanner le sujet.
  if (utile || sujetPorteParticipe(sujet)) {
    const passe2 = classifierCoeur(sujet, utile, { participesCorps: true, participesSujet: true });
    if (passe2.decisive) return passe2;
    if (passe2.decision !== DECISIONS.NON_RECONNU && passe1.decision === DECISIONS.NON_RECONNU) {
      return passe2; // trace plus riche (AMBIGUE) — même effet sur le statut
    }
  }
  return passe1;
}

module.exports = {
  normaliserTexte,
  classifierReponse,
  extraireReponseUtile,
  sujetPorteParticipe,
  FORMULATIONS_ACCEPTATION,
  FORMULATIONS_REFUS,
  MOTS_CLES_ACCEPTATION,
  MOTS_CLES_REFUS,
  NEGATIONS_REFUS,
  PARTICIPES_ACCEPTATION,
  PARTICIPES_REFUS,
  DECISIONS,
};
