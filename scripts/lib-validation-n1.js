"use strict";
/**
 * ============================================================================
 * (NOUVEAU — demande utilisateur) VALIDATION DES DEMANDES PAR RÉPONSE E-MAIL
 * DU RESPONSABLE N+1 (congé + autorisation de sortie)
 * ============================================================================
 *
 * Le destinataire prévu (responsable N+1 ou service RH) répond DIRECTEMENT à
 * l'e-mail de création de la demande :
 *   - réponse contenant « Acceptée » / « Valide » / « OK » … → demande
 *     automatiquement passée au statut « ACCEPTEE » dans le portail ;
 *   - réponse contenant « Refusée » / « Rejeté » …           → « REFUSEE ».
 * (v0.2.108 : libellés au FÉMININ dans la consigne « VALIDATION PAR E-MAIL »
 * — « demande » est un nom féminin ; les formes masculines historiques
 * restent comprises par le détecteur, et la décision s'applique désormais à
 * TOUS les types de demandes.)
 *
 * Ce module est PUR (0 dépendance) : requis par scripts/portail-server.js
 * (réception IMAP) et par les tests E2E. Toute évolution des règles se fait
 * ICI uniquement — aucune jumelle.
 *
 * SÉCURITÉ DE RATTACHEMENT (anti-validation sur une mauvaise demande) :
 *   le message est d'abord rattaché à la demande par les en-têtes
 *   In-Reply-To / References (Message-ID mémorisé à la création), puis par la
 *   référence DEM-AAAA-NNNNN du sujet en repli — et l'EXPÉDITEUR doit être
 *   exactement le destinataire prévu de la demande. Ces contrôles sont dans
 *   portail-server.js (traiterMessageRecu) ; ce module ne fait que lire
 *   l'INTENTION dans le corps de la réponse.
 *
 * Le texte analysé est NETTOYÉ pour éviter les faux positifs :
 *   - la citation de l'e-mail d'origine (lignes « > », « ----- Message
 *     d'origine ----- », « Le … a écrit : », en-têtes « De :/From: »…) est
 *     SUPPRIMÉE — sinon la consigne « VALIDATION PAR E-MAIL … Acceptée …
 *     Refusée » citée en bas de la réponse ferait correspondre les mots-clés ;
 *   - le bloc de consignes AutoRH lui-même est retiré (même raison) ;
 *   - accents et majuscules normalisés (Acceptée = acceptee).
 * ============================================================================
 */

/** Met en minuscules SANS accents (accepté → accepte). */
function normaliserTexteReponse(s) {
  return String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019`]/g, "'")
    .toLowerCase();
}

/**
 * Retire la CITATION de l'e-mail d'origine : la réponse utile est ce que le
 * responsable a ÉCRIT au-dessus de la citation. On coupe à la première ligne
 * ressemblant à une citation / un en-tête de message transféré.
 */
function couperCitationReponse(texte) {
  const lignes = String(texte || "").split(/\r?\n/);
  const gardes = [];
  // Sentinelles de citation (testées sur texte normalisé, sans accents) :
  const sentinelle = new RegExp(
    "^\\s*(" +
      ">" +                                        // « > ligne citée »
      "|\\|" +                                     // citation par barres
      "|-{5,}\\s*(message|original|forward)" +     // « ----- Message d'origine ----- »
      "|_{5,}" +                                   // ligne de soulignement (Outlook)
      "|(le|on)\\s+\\d{1,2}\\s" +                  // « Le 26 sept. … », « On 26 … »
      "|.{0,80}(a ecrit|ecrit :|wrote :?|a \u00e9crit)\\s*:?" +
      "|^(de|from|date|a|pour|to|objet|subject|sent|reply-to|copy|copie)\\s*:" +
      ")",
    "i"
  );
  for (const ligne of lignes) {
    if (sentinelle.test(ligne)) break;
    gardes.push(ligne);
  }
  return gardes.join("\n");
}

/**
 * Extrait le TEXTE lisible d'un message analysé par mailparser (simpleParser) :
 * priorité au texte brut (parsed.text) ; repli sur le HTML dépouillé de ses
 * balises (les clients configurés « HTML uniquement » restent compris).
 */
function extraireTexteReponse(parsed) {
  try {
    if (parsed && typeof parsed.text === "string" && parsed.text.trim()) {
      return parsed.text;
    }
    if (parsed && typeof parsed.html === "string" && parsed.html.trim()) {
      let t = String(parsed.html)
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
        .replace(/<[^>]+>/g, " ");
      t = t
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'");
      return t;
    }
  } catch (e) {
    // corps illisible → chaîne vide (aucune intention détectée)
  }
  return "";
}

/**
 * Déduit l'INTENTION de validation d'une réponse :
 *   "VALIDEE"  → mots-clés d'acceptation (accepte, approuve, valide, ok,
 *                oui, accord, favorable, confirme, autorise…) ;
 *   "REFUSEE"  → mots-clés de refus (refuse, rejette, defavorable,
 *                desaccord, non…) — priorité sur la validation ;
 *   null       → aucune intention claire (demande inchangée).
 * La citation de l'e-mail d'origine ET le bloc de consignes Auto-RH sont
 * retirés AVANT la recherche des mots-clés (faux positifs évités).
 */
function detecterIntentionValidation(texteBrut) {
  // 1) normalisation complète (minuscules, sans accents, apostrophes unifiées)
  let texte = normaliserTexteReponse(texteBrut);
  // 2) retrait du bloc de consignes Auto-RH (contient « accepté » ET « refusé »)
  texte = texte.replace(/validation par e-mail[\s\S]*$/g, " ");
  // 3) retrait de la citation de l'e-mail d'origine
  texte = couperCitationReponse(texte);
  // 4) détection (refus d'abord : « je refuse, malgré le OK du système »)
  const rxRefus =
    /\b(refus\w*|rejet\w*|rejett\w*|defavorable|desaccord\w*|decline\w*|pas d'accord|non)\b/;
  const rxValidation =
    /\b(accept\w*|approuv\w*|valid\w*|accord\w*|confirm\w*|favorable|autorise\w*|accorde\w*|oui|ok|go)\b/;
  if (rxRefus.test(texte)) return "REFUSEE";
  if (rxValidation.test(texte)) return "VALIDEE";
  return null;
}

/**
 * (NOUVEAU v0.2.110 — demande utilisateur « Statut des demandes avec pièce
 * jointe ») FILET DE SÉCURITÉ pour la décision explicite — appelé UNIQUEMENT
 * lorsque la passe classique (detecterIntentionValidation) n'a rien trouvé.
 *
 *  PROBLÈME CONSTATÉ : le destinataire écrit souvent sa décision EN BAS de la
 *  réponse (signature client en bas de page) — SOUS le bloc cité de l'e-mail
 *  d'origine qui contient la consigne « VALIDATION PAR E-MAIL ». La passe
 *  classique coupe TOUT ce qui suit « validation par e-mail » (la consigne
 *  contenant « Acceptée » ET « Refusée », il faut bien l'écarter) : la
 *  décision écrite en bas disparaissait donc avec elle → la pièce jointe
 *  était importée mais le statut restait « En attente » (congé/autorisation)
 *  ou passait « Acceptée » à tort (parrainage, réponse avec document sans
 *  décision détectée).
 *
 *  PRINCIPE DE CE FILET : recherche de la décision EXPLICITE sur l'ENSEMBLE
 *  du message (corps + SUJET) après retrait PRÉCIS de la consigne (fenêtre
 *  bornée jusqu'à « refuser. », PAS une coupe jusqu'à la fin) :
 *   - « refus… »  → REFUSEE (prioritaire) ;
 *   - « accept… » → VALIDEE ;
 *   - rien        → null (statut inchangé).
 *  Seuls les radicaux EXPLICITES « refus » / « accept » sont recherchés (les
 *  mots vagues « ok », « oui », « non », « accord »… restent réservés à la
 *  passe classique sur le texte hors citation) : aucun faux positif depuis
 *  le bloc cité (un motif d'employé contenant « non » ne décide JAMAIS).
 *  Les formes masculines historiques (« accepté », « refusé ») et les
 *  variantes « j'accepte », « je refuse » sont couvertes par les radicaux.
 */
function detecterDecisionExplicite(parsed) {
  try {
    const corps = extraireTexteReponse(parsed);
    const sujet = parsed && typeof parsed.subject === "string" ? parsed.subject : "";
    let texte = normaliserTexteReponse(corps + "\n" + sujet);
    // Retrait BORNÉ de la consigne « VALIDATION PAR E-MAIL … pour la
    // refuser. » où qu'elle apparaisse (corps texte OU citation HTML
    // dépouillée) — la fenêtre s'arrête à la PREMIÈRE occurrence de
    // « refuser. » (fin réel de la consigne) et plafonne à 600 caractères.
    texte = texte.replace(/validation par e-mail[\s\S]{0,600}?refuser\.?/g, " ");
    // Repli si la consigne a été remaniée par le client de messagerie (fin
    // « refuser. » introuvable) : fenêtre fixe de 400 caractères.
    texte = texte.replace(/validation par e-mail[\s\S]{0,400}/g, " ");
    // Décision EXPLICITE uniquement — refus prioritaire (même convention que
    // la passe classique : un « je refuse » l'emporte sur un « OK » ambiant).
    if (/\brefus/.test(texte)) return "REFUSEE";
    if (/\baccept/.test(texte)) return "VALIDEE";
    return null;
  } catch (e) {
    // message illisible → aucune décision (statut inchangé)
    return null;
  }
}

module.exports = {
  normaliserTexteReponse,
  couperCitationReponse,
  extraireTexteReponse,
  detecterIntentionValidation,
  detecterDecisionExplicite,
};
