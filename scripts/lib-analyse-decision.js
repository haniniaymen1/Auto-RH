"use strict";
/**
 * (NOUVEAU v0.2.142 — Task 261) Reconnaissance de la décision exprimée dans
 * une RÉPONSE E-MAIL à une demande de congé ou d'autorisation de sortie.
 *
 * Trois issues possibles :
 *   - "accepter" : la réponse exprime une validation / acceptation ;
 *   - "refuser"  : la réponse exprime un refus / rejet ;
 *   - null       : réponse ambiguë, contradictoire ou sans formulation
 *                  reconnue — AUCUN changement automatique de statut (la
 *                  demande reste en attente ; on ne devine JAMAIS une
 *                  décision).
 *
 * Principes de reconnaissance :
 *   1. NORMALISATION : minuscules, accents retirés, apostrophes remplacées
 *      par des espaces (« D'accord » → « d accord », « n'a pas été » →
 *      « n a pas ete »). La ponctuation est CONSERVÉE : elle empêche les
 *      rapprochements abusifs entre une négation et un mot-clé lointain.
 *   2. RACINES DE MOTS (stems) : couvre masculin / féminin / pluriel /
 *      verbes / noms (« validé », « validée », « validons », « validation »…).
 *   3. NÉGATIONS gérées localement (fenêtre de 32 caractères avant le
 *      mot-clé) : « non approuvée », « n'a pas été validée », « pas
 *      d'accord », « ne pas valider » → l'acceptation niée devient un signal
 *      de REFUS (formulations officielles) ; un refus nié est NEUTRALISÉ
 *      (aucun signal — on ne transforme jamais un « pas refusé » en
 *      acceptation).
 *   4. CITATIONS supprimées : les lignes « > » citées et les blocs
 *      « ----- Message d'origine ----- » / « De : … » / « … a écrit : » ne
 *      participent JAMAIS à la décision (sinon le texte de notre propre
 *      e-mail, qui contient « Accepter » et « Refuser », rendrait toute
 *      réponse ambiguë).
 *   5. LE SUJET EST DÉCISIF : nos e-mails invitent explicitement à écrire
 *      « Accepté » / « Refusé » dans le sujet — dès que le sujet exprime une
 *      décision claire, elle est retenue même si le corps contient le fil de
 *      discussion cité.
 *   6. AMBIGUÏTÉ : signaux des deux familles, ou mélange refus direct +
 *      acceptation niée → null (la demande reste en attente).
 *
 * Formulations officielles couvertes (listes fournies au Task 261) :
 *   ACCEPTATION : demande de congé acceptée / validée / approuvée / accordée,
 *   congé accepté / validé / approuvé / accordé, votre demande de congé a été
 *   acceptée / validée / approuvée, votre congé a été accepté / validé,
 *   validation (de votre demande / de la demande / du congé), confirmation de
 *   validation, OK, j'accorde, je valide, d'accord.
 *   REFUS : demande de congé refusée / rejetée / non approuvée / non validée /
 *   non acceptée / refusée par le manager, congé refusé / rejeté, votre
 *   demande de congé a été refusée / rejetée / n'a pas été approuvée / n'a pas
 *   été validée, refus (de votre demande / de la demande / du congé),
 *   notification de refus, NON, je refuse, refus, désaccord.
 */

// ---------- Normalisation ----------

/** Prépare un texte (casse, accents, apostrophes) en PRÉSERVANT les sauts de
 *  ligne (nécessaire au retrait des citations ligne par ligne). */
function preparerTexteLignes(s) {
  return String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Aplatit un texte préparé (tous les blancs → espaces simples). */
function aplatirTexte(t) {
  return String(t == null ? "" : t).replace(/\s+/g, " ").trim();
}

/** Normalisation complète (compatibilité avec l'ancien nom de fonction). */
function normaliserTexteDecision(s) {
  return aplatirTexte(preparerTexteLignes(s));
}

// ---------- Retrait des citations ----------

/** Supprime le contenu CITÉ d'une réponse (lignes « > », séparateurs de
 *  citation, blocs d'en-têtes repris, introductions « … a écrit : »).
 *  Tout ce qui suit un séparateur de citation est également retiré
 *  (comportement des clients top-posting : Outlook, Gmail…). */
function retirerCitations(t) {
  const lignes = String(t == null ? "" : t).split("\n");
  const gardees = [];
  for (const ligne of lignes) {
    const l = ligne.trim();
    if (/^>+/.test(l)) continue; // ligne citée (Gmail,Thunderbird…)
    if (/-{3,}/.test(l) && /(message d.origine|message original|original message|forwarded|message transfere|message transfert)/.test(l)) break;
    if (/^(de|from)\s*:\s*\S+@\S+/.test(l)) break; // bloc d'en-têtes cité
    if (/(le|on)\s.{0,80}\ba ecrit\s*:/.test(l)) break; // « Le … a écrit : »
    if (/^on\s.{0,80}\bwrote\s*:/.test(l)) break;       // « On … wrote: »
    gardees.push(ligne);
  }
  return gardees.join("\n");
}

// ---------- Racines de mots-clés ----------

/** Racines de REFUS (préfixe de mot, frontière gauche non alphabétique). */
const RACINES_REFUS = [
  { racine: "refus", nom: "refus" },
  { racine: "rejet", nom: "rejet" },
  { racine: "desaccord", nom: "désaccord" },
  { racine: "defavorable", nom: "défavorable" },
  { racine: "impossible", nom: "impossible" },
  { racine: "negatif", nom: "négatif" },
  { racine: "non", nom: "non", motEntier: true }, // « NON » seul (liste officielle)
];

/** Racines d'ACCEPTATION. */
const RACINES_ACCEPTATION = [
  { racine: "accept", nom: "acceptation" },  // accepté(e), accepter, acceptation
  { racine: "valid", nom: "validation" },    // validé(e), valider, validation
  { racine: "approuv", nom: "approbation" }, // approuvé(e), approuver
  { racine: "approbation", nom: "approbation" },
  { racine: "accord", nom: "accord" },       // accordé(e), accorder, d'accord
  { racine: "favorable", nom: "favorable" },
  { racine: "ok", nom: "OK", motEntier: true }, // « OK » seul
];

/** Racines d'acceptation utilisables juste après un « non » (exclusion : le
 *  « non » de « non approuvée » n'est PAS un signal de refus indépendant — la
 *  négation du verbe est déjà comptée). */
const RACINES_APRES_NON =
  /^(?:\s*)(accept|valid|approuv|approbation|accord|favorable)/;

/** Négations pouvant précéder un mot-clé (fenêtre finissante) :
 *  « non approuvée », « pas d accord », « n a pas ete validee », « ne »,
 *  « jamais », « aucune »… Les fillers entre la négation et le mot-clé
 *  acceptent au plus 3 mots courts (ex. « pas ete », « n est plus »). */
const NEGATION_FIN = /(^|\s)(non|pas|jamais|ni|aucun|aucune|ne|n)(\s[a-z]{1,6}){0,3}\s*$/;

/** Longueur de la fenêtre de négation avant le mot-clé. */
const FENETRE_NEGATION = 32;

/** Détecte si l'occurrence d'un mot-clé est NIÉE dans son contexte proche. */
function estNegue(t, idx) {
  const debut = Math.max(0, idx - FENETRE_NEGATION);
  return NEGATION_FIN.test(t.slice(debut, idx));
}

/** Occurrences d'une racine dans un texte normalisé-aplati :
 *  [{ debut, fin, negue, extrait }]. */
function occurrencesRacine(t, r) {
  const motif = r.motEntier
    ? "(^|[^a-z])" + r.racine + "([^a-z]|$)"
    : "(^|[^a-z])" + r.racine;
  const re = new RegExp(motif, "g");
  const sortis = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    const debut = m.index + (m[1] ? m[1].length : 0);
    const fin = r.motEntier ? debut + r.racine.length : m.index + m[0].length;
    sortis.push({
      debut: debut,
      fin: fin,
      negue: estNegue(t, debut),
      extrait: contexteExtrait(t, debut, fin),
    });
    if (!re.global) break;
  }
  return sortis;
}

/** Extrait lisible « …texte [MOT] texte… » pour le journal (± 28 caractères). */
function contexteExtrait(t, debut, fin) {
  const gauche = t.slice(Math.max(0, debut - 28), debut).trimStart();
  const droite = t.slice(fin, fin + 28).trimEnd();
  return (gauche ? "…" + gauche : "") + "[" + t.slice(debut, fin) + "]" + (droite ? droite + "…" : "");
}

// ---------- Collecte des signaux ----------

/**
 * Analyse un texte normalisé et retourne trois familles de signaux :
 *   - acc       : formulations d'acceptation claires ;
 *   - refDirect : formulations de refus claires (refus/rejet/désaccord/NON…) ;
 *   - refNeg    : acceptations NIÉES = refus explicites (« non validée »,
 *                 « n'a pas été approuvée », « pas d'accord »…).
 * Un refus nié (« pas refusé ») est NEUTRALISÉ : aucun signal.
 */
function collecterSignaux(t) {
  const res = { acc: [], refDirect: [], refNeg: [] };
  if (!t) return res;
  for (const r of RACINES_REFUS) {
    const occ = occurrencesRacine(t, r);
    for (const o of occ) {
      // « non » immédiatement suivi d'un verbe d'acceptation : simple
      // négation de ce verbe (déjà comptée dans refNeg) — jamais un signal
      // indépendant, sinon « non approuvée » mixerait les deux familles.
      if (r.racine === "non" && RACINES_APRES_NON.test(t.slice(o.fin))) continue;
      res.refDirect.push({ nom: r.nom, extrait: o.extrait });
      break; // un signal par racine suffit
    }
  }
  for (const r of RACINES_ACCEPTATION) {
    const occ = occurrencesRacine(t, r);
    if (!occ.length) continue;
    const positif = occ.find(function (o) { return !o.negue; });
    if (positif) res.acc.push({ nom: r.nom, extrait: positif.extrait });
    else res.refNeg.push({ nom: r.nom + " (nié)", extrait: occ[0].extrait });
  }
  return res;
}

/** Fusionne deux jeux de signaux. */
function combinerSignaux(a, b) {
  return {
    acc: a.acc.concat(b.acc),
    refDirect: a.refDirect.concat(b.refDirect),
    refNeg: a.refNeg.concat(b.refNeg),
  };
}

/** Applique la matrice de décision aux signaux collectés. */
function decisionDepuisSignaux(s) {
  const refusQuelconque = s.refDirect.length + s.refNeg.length;
  if (s.acc.length && refusQuelconque) {
    return { decision: null, source: "ambigu (acceptation + refus)" };
  }
  if (s.refDirect.length && s.refNeg.length) {
    // mélange refus direct + acceptation niée (ex. « pas d'accord avec le
    // refus ») : signaux contradictoires → on ne devine pas.
    return { decision: null, source: "ambigu (refus + acceptation niée)" };
  }
  if (refusQuelconque) {
    return { decision: "refuser", source: s.refDirect.length ? "refus explicite" : "acceptation niée" };
  }
  if (s.acc.length) {
    return { decision: "accepter", source: "acceptation" };
  }
  return { decision: null, source: "aucune formulation reconnue" };
}

// ---------- API publique ----------

/**
 * Analyse COMPLÈTE d'une réponse (sujet + corps). Le sujet est DÉCISIF dès
 * qu'il exprime une seule famille de signaux ; sinon on analyse le corps
 * SANS ses citations et on combine avec les signaux du sujet.
 *
 * Retour : {
 *   decision           : "accepter" | "refuser" | null,
 *   source             : "sujet" | "corps" | "ambigu …" | "aucune …",
 *   signauxAcceptation : [{ nom, extrait }],
 *   signauxRefus       : [{ nom, extrait }],
 * }
 */
function analyserDecisionDetaillee(sujet, corps) {
  const sujetN = normaliserTexteDecision(sujet);
  const corpsSansCitation = aplatirTexte(retirerCitations(preparerTexteLignes(corps)));

  // 1) le sujet est le champ délibéré de la réponse : décisif s'il est clair
  const sSujet = collecterSignaux(sujetN);
  const refSujet = sSujet.refDirect.length + sSujet.refNeg.length;
  if (sSujet.acc.length && !refSujet) {
    return { decision: "accepter", source: "sujet", signauxAcceptation: sSujet.acc, signauxRefus: [] };
  }
  if (!sSujet.acc.length && refSujet) {
    return { decision: "refuser", source: "sujet", signauxAcceptation: [], signauxRefus: sSujet.refDirect.concat(sSujet.refNeg) };
  }

  // 2) corps sans citations, combiné aux signaux éventuels du sujet
  const sCorps = collecterSignaux(corpsSansCitation);
  const total = combinerSignaux(sSujet, sCorps);
  const verdict = decisionDepuisSignaux(total);
  return {
    decision: verdict.decision,
    source: verdict.source,
    signauxAcceptation: total.acc,
    signauxRefus: total.refDirect.concat(total.refNeg),
  };
}

/**
 * Version compacte (compatibilité v0.2.140) : "accepter" | "refuser" | null.
 * null = ambigu ou aucune formulation reconnue → AUCUN changement de statut.
 */
function analyserDecisionTexte(sujet, corps) {
  return analyserDecisionDetaillee(sujet, corps).decision;
}

module.exports = {
  normaliserTexteDecision: normaliserTexteDecision,
  preparerTexteLignes: preparerTexteLignes,
  retirerCitations: retirerCitations,
  analyserDecisionTexte: analyserDecisionTexte,
  analyserDecisionDetaillee: analyserDecisionDetaillee,
};
