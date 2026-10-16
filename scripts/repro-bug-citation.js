#!/usr/bin/env node
/* REPRODUCTION v2 — corps RÉELS complets des e-mails de demande (template
 * texteEmailDemandeCreation exact) quotés dans les réponses Gmail. */
"use strict";
const c = require("/home/z/my-project/scripts/classification-reponses.js");

function montrer(nom, sujet, texte) {
  const r = c.classifierReponse(sujet, texte);
  console.log("— " + nom);
  console.log("  décision=" + r.decision + " | decisive=" + r.decisive +
    " | accept=" + JSON.stringify(r.formulations || []));
}

// Corps RÉEL d'une demande d'AUTORISATION DE SORTIE (template exact, infos=9485)
const corpsAutorisation =
  "Bonjour,\n" +
  "\n" +
  "Une nouvelle demande administrative nécessite votre traitement.\n" +
  "\n" +
  "  Référence unique           : DEM-2026-00073\n" +
  "  Type de demande            : Autorisation de sortie\n" +
  "  Employé                    : Employé Zoho Test (CIN AB•••••01)\n" +
  "  Date de la demande         : 09/10/2026 à 14:05\n" +
  "  Statut                     : En attente\n" +
  "\n" +
  "Informations de la demande :\n" +
  "  Date de sortie              : 2027-03-02\n" +
  "  Heure de sortie             : 14:00\n" +
  "  Heure de retour             : 16:00\n" +
  "  Nombre d'heures             : 2\n" +
  "  Motif                       : Démarche administrative\n" +
  "  Compensation des heures     : Non — heures non compensées\n" +
  "\n" +
  "VALIDATION PAR E-MAIL : répondez directement à cet e-mail (« Répondre »)\n" +
  "en écrivant « Acceptée » pour VALIDER la demande, ou « Refusée » pour la\n" +
  "refuser. Votre réponse est rattachée automatiquement à la référence\n" +
  "DEM-2026-00073 — aucune autre manipulation nécessaire. L'employé et le\n" +
  "service RH sont notifiés automatiquement après votre réponse.\n" +
  "\n" +
  "Merci de traiter cette demande. L'employé suit son avancement dans sa\n" +
  "section « Demandes administratives » du portail employé.\n" +
  "\n" +
  "Cet e-mail a été envoyé automatiquement par AutoRH. Si vous n'êtes pas\n" +
  "le destinataire prévu, ignorez et supprimez ce message.";

// Corps RÉEL d'une demande de CONGÉ
const corpsConge =
  "Bonjour,\n" +
  "\n" +
  "Une nouvelle demande administrative nécessite votre traitement.\n" +
  "\n" +
  "  Référence unique           : DEM-2026-00071\n" +
  "  Type de demande            : Congé\n" +
  "  Employé                    : Employé Zoho Test (CIN AB•••••01)\n" +
  "  Date de la demande         : 09/10/2026 à 14:00\n" +
  "  Statut                     : En attente\n" +
  "\n" +
  "Informations de la demande :\n" +
  "  Type de congé               : Congé annuel\n" +
  "  Date de début               : 2027-03-01\n" +
  "  Date de fin                 : 2027-03-05\n" +
  "  Commentaire                 : Test\n" +
  "\n" +
  "VALIDATION PAR E-MAIL : répondez directement à cet e-mail (« Répondre »)\n" +
  "en écrivant « Acceptée » pour VALIDER la demande, ou « Refusée » pour la\n" +
  "refuser. Votre réponse est rattachée automatiquement à la référence\n" +
  "DEM-2026-00071 — aucune autre manipulation nécessaire. L'employé et le\n" +
  "service RH sont notifiés automatiquement après votre réponse.\n";

function citationGmail(corps) {
  return corps.split("\n").map(function (l) { return l ? "> " + l : ">"; }).join("\n");
}
const enteteGmail = "Le mer. 9 oct. 2026 à 14:05, AutoRH Auto-RH <employe.test@autorh.tn> a écrit :";

// ===== ÉTAPE MANAGER =====
montrer(
  "MANAGER accepte AUTORISATION (« OK pour moi » + citation complète demande)",
  "Re: AutoRH — Autorisation de sortie DEM-2026-00073 (traitement requis)",
  "OK pour moi, à valider par les RH.\n\n" + enteteGmail + "\n" + citationGmail(corpsAutorisation)
);
montrer(
  "MANAGER accepte CONGÉ (« OK pour moi » + citation complète demande)",
  "Re: AutoRH — Congé DEM-2026-00071 (traitement requis)",
  "OK pour moi, à valider par les RH.\n\n" + enteteGmail + "\n" + citationGmail(corpsConge)
);
montrer(
  "MANAGER refuse CONGÉ (« Je refuse » + citation complète demande)",
  "Re: AutoRH — Congé DEM-2026-00072 (traitement requis)",
  "Je refuse cette demande.\n\n" + enteteGmail + "\n" + citationGmail(corpsConge)
);

// ===== ÉTAPE RH (transmission — liste ACCEPTER/REFUSER quotée) =====
const corpsTransmission =
  "Le manager a accepté la demande. Votre décision RH achèvera la validation.\n" +
  "\n" +
  "Répondez directement à CET E-MAIL (Répondre — ne pas modifier l'objet) :\n" +
  "  ACCEPTER  : « Congé accepté », « Je valide », « J'accorde », « D'accord », « OK »\n" +
  "  REFUSER   : « Congé refusé », « Je refuse », « Désaccord », « NON », « Refus »\n" +
  "Votre réponse sera enregistrée automatiquement comme décision RH.";
montrer(
  "RH accepte CONGÉ (« Congé accepté » + citation transmission RH)",
  "Re: Auto-RH — Congé DEM-2026-00071 acceptée par le manager — validation RH requise",
  "Congé accepté, bonne préparation.\n\n" + enteteGmail + "\n" + citationGmail(corpsTransmission)
);
montrer(
  "RH accepte AUTORISATION (« J'accepte » + citation transmission RH)",
  "Re: Auto-RH — Autorisation de sortie DEM-2026-00073 acceptée par le manager — validation RH requise",
  "J'accepte votre demande d'autorisation.\n\n" + enteteGmail + "\n" + citationGmail(corpsTransmission)
);
montrer(
  "RH refuse (« Je refuse » + citation transmission RH)",
  "Re: Auto-RH — Congé DEM-2026-00071 acceptée par le manager — validation RH requise",
  "Je refuse, les effectifs sont insuffisants.\n\n" + enteteGmail + "\n" + citationGmail(corpsTransmission)
);
