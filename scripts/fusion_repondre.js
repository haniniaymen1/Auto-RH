#!/usr/bin/env node
/* Fusion repondre/route.ts : base v0.2.138 (tampon réponses dédié v0.2.93/99,
 * PAdES Task 224, cachet elec v0.2.119, mode FICHE v0.2.97, refus IT v0.2.100,
 * dossier privé 0700 Task 209, décision explicite v0.2.110, PJ e-mail
 * v0.2.106, matricule v0.2.107, destinataire résolu v0.2.125) + ajouts
 * Tasks 179/180/181 du miroir :
 *   - imports (statutFinalDepuisDecisions, typeDeuxEtapes, doc-signe)
 *   - matrice deux étapes sur la décision RH (import document vaut décision RH)
 *   - déclencheurs document signé (Task 179) / document de refus (Task 180)
 *   - notification reportée tant que le manager n'a pas décidé (Task 181)
 */
const fs = require('fs');

let out = fs.readFileSync('/tmp/my-project/fusion-securite/api-id/repondre-138.ts', 'utf8');

// ---- 1) imports @/lib/demandes : ajouter statutFinalDepuisDecisions + typeDeuxEtapes
const regexImp = /import \{\n  destinataireNotificationDemande,/;
if (!regexImp.test(out)) throw new Error('import @/lib/demandes introuvable');
out = out.replace(regexImp,
  'import {\n  destinataireNotificationDemande,\n  statutFinalDepuisDecisions,\n  typeDeuxEtapes,');

// ---- 2) import doc-signe (Tasks 179/180) juste après l'import @/lib/demandes
const ancreImpFin = /from "@\/lib\/demandes";\n/;
if (!ancreImpFin.test(out)) throw new Error('fin import demandes introuvable');
out = out.replace(ancreImpFin,
  'from "@/lib/demandes";\n' +
  '// (NOUVEAU Task 179/180) génération automatique du document d\'acceptation\n' +
  '// signé & tamponné et du document de REFUS signé & tamponné.\n' +
  'import {\n  declencherDocumentRefus,\n  declencherDocumentSigne,\n  estDocumentSigConcerne,\n} from "@/lib/doc-signe";\n');

// ---- 3) partie statut : matrice deux étapes sur la décision RH
const ancienStatut = `    if (decision === "REFUSEE") {
      statut = "REFUSEE";
      maj.statut = "REFUSEE";
      maj.traitePar = "Réponse avec document (administration) — " + session.email;
      maj.traiteLe = new Date();
      maj.commentaire = "Réponse : Refusée — le document « " + nomFichier + " » est joint et disponible dans le portail de l'employé.";
    } else if (decision === "ACCEPTEE") {
      statut = "ACCEPTEE";
      maj.statut = "ACCEPTEE";
      maj.traitePar = "Réponse avec document (administration) — " + session.email;
      maj.traiteLe = new Date();
      maj.commentaire = "Réponse : Acceptée — le document « " + nomFichier + " » est joint et disponible dans le portail de l'employé.";
    } else if (d.statut === "EN_ATTENTE" || d.statut === "INFORMATION_REQUISE") {
      statut = "ACCEPTEE";
      maj.statut = "ACCEPTEE";
      maj.traitePar = "Import direct (administration) — " + session.email;
      maj.traiteLe = new Date();
      if (!d.commentaire) {
        maj.commentaire = "Document importé et transmis par le service RH depuis l'administration.";
      }
    }
    if (Object.keys(maj).length) {
      await db.demandeAdministrative.update({ where: { id: d.id }, data: maj });
    }`;
if (!out.includes(ancienStatut)) throw new Error('bloc statut 138 introuvable');

const nouveauStatut = `    // (MODIFIÉ Task 181) CONGÉ / AUTORISATION DE SORTIE (validation à deux
    // étapes) : la décision du RH (import du document de réponse, décision
    // explicite ou implicite) est TRACÉE (decisionRh) et le statut final suit
    // la MATRICE — si le manager n'a pas encore décidé, la demande RESTE
    // « En attente » et la notification employé ne part qu'à la décision
    // finale. Les autres types : flux historique (v0.2.110 conservé).
    let enAttenteManager = false;
    let refuseeParFinal: string | null = null;
    if (decision === "REFUSEE") {
      statut = "REFUSEE";
      maj.statut = "REFUSEE";
      maj.decisionRh = "REFUSEE";
      maj.decisionRhLe = new Date();
      maj.decisionRhPar = session.email;
      refuseeParFinal = "RH";
      maj.traitePar = "Réponse avec document (administration) — " + session.email;
      maj.traiteLe = new Date();
      maj.commentaire = "Réponse : Refusée — le document « " + nomFichier + " » est joint et disponible dans le portail de l'employé.";
    } else if (decision === "ACCEPTEE") {
      if (typeDeuxEtapes(d.type)) {
        maj.decisionRh = "ACCEPTEE";
        maj.decisionRhLe = new Date();
        maj.decisionRhPar = session.email;
        const finale = statutFinalDepuisDecisions(d.decisionManager, "ACCEPTEE");
        statut = finale.statut;
        refuseeParFinal = finale.refuseePar;
        if (statut === "EN_ATTENTE") {
          enAttenteManager = true;
          maj.statut = d.statut === "INFORMATION_REQUISE" ? "EN_ATTENTE" : d.statut;
        } else {
          maj.statut = statut;
          maj.traitePar = "Réponse avec document (administration) — " + session.email;
          maj.traiteLe = new Date();
          maj.commentaire = "Réponse : Acceptée — le document « " + nomFichier + " » est joint et disponible dans le portail de l'employé.";
        }
      } else {
        statut = "ACCEPTEE";
        maj.statut = "ACCEPTEE";
        maj.traitePar = "Réponse avec document (administration) — " + session.email;
        maj.traiteLe = new Date();
        maj.commentaire = "Réponse : Acceptée — le document « " + nomFichier + " » est joint et disponible dans le portail de l'employé.";
      }
    } else if (d.statut === "EN_ATTENTE" || d.statut === "INFORMATION_REQUISE") {
      maj.decisionRh = "ACCEPTEE";
      maj.decisionRhLe = new Date();
      maj.decisionRhPar = session.email;
      if (typeDeuxEtapes(d.type)) {
        const finale = statutFinalDepuisDecisions(d.decisionManager, "ACCEPTEE");
        statut = finale.statut;
        refuseeParFinal = finale.refuseePar;
        if (statut === "EN_ATTENTE") {
          enAttenteManager = true;
          maj.statut = d.statut === "INFORMATION_REQUISE" ? "EN_ATTENTE" : d.statut;
        } else {
          maj.statut = statut;
          maj.traitePar = "Import direct (administration) — " + session.email;
          maj.traiteLe = new Date();
        }
      } else {
        statut = "ACCEPTEE";
        maj.statut = "ACCEPTEE";
        maj.traitePar = "Import direct (administration) — " + session.email;
        maj.traiteLe = new Date();
      }
      if (!d.commentaire) {
        maj.commentaire = "Document importé et transmis par le service RH depuis l'administration.";
      }
    }
    if (refuseeParFinal) maj.refuseePar = refuseeParFinal;
    if (Object.keys(maj).length) {
      await db.demandeAdministrative.update({ where: { id: d.id }, data: maj as never });
    }

    // (NOUVEAU Task 179) ACCEPTATION FINALE via import du document de réponse :
    // le document d'acceptation signé est généré pour les congés /
    // autorisations (JAMAIS bloquant — trace docSigne sur la demande, résultat
    // renvoyé). (MODIFIÉ Task 181) seulement si le statut FINAL est ACCEPTEE
    // (matrice deux étapes complète).
    let docSigne: Record<string, unknown> | null = null;
    if (
      statut === "ACCEPTEE" &&
      d.statut !== "ACCEPTEE" &&
      d.statut !== "VALIDEE" &&
      estDocumentSigConcerne(d.type, "ACCEPTEE")
    ) {
      docSigne = (await declencherDocumentSigne(d.id, {
        declencheur: "Import du document de réponse (" + session.email + ")",
      })) as Record<string, unknown>;
    }

    // (NOUVEAU Task 180/181) REFUS FINAL (décision explicite RH) : génération
    // automatique du document de refus signé & tamponné (TOUS types) — même
    // pipeline que l'acceptation, JAMAIS bloquant.
    let docRefus: Record<string, unknown> | null = null;
    if (statut === "REFUSEE" && d.statut !== "REFUSEE") {
      docRefus = (await declencherDocumentRefus(d.id, {
        declencheur: "Réponse avec document (administration) — " + session.email,
      })) as Record<string, unknown>;
    }`;
out = out.replace(ancienStatut, nouveauStatut);

// ---- 4) notification : brancher enAttenteManager AVANT destResolu
const ancreNotif = `    let notification: Record<string, unknown>;
    const destResolu = await destinataireNotificationDemande(d.cin, d.employeEmail);
    if (destResolu) {`;
if (!out.includes(ancreNotif)) throw new Error('ancre notification introuvable');
const remplacementNotif = `    let notification: Record<string, unknown>;
    // (MODIFIÉ Task 181) tant que le MANAGER n'a pas décidé (deux étapes),
    // le document transmis reste en attente — PAS de notification « Acceptée »
    // à l'employé (elle partira à la décision finale, avec la résolution
    // v0.2.125 conservée).
    if (enAttenteManager) {
      notification = {
        absent: true,
        enAttenteManager: true,
        note:
          "Document enregistré et décision RH enregistrée — la demande reste en attente de la décision du manager. L'employé sera notifié dès la décision finale.",
      };
    } else {
    const destResolu = await destinataireNotificationDemande(d.cin, d.employeEmail);
    if (destResolu) {`;
out = out.replace(ancreNotif, remplacementNotif);

// ---- 5) fermer la nouvelle branche else (avant le return final)
const ancienRetour = `    return NextResponse.json({
      ok: true,
      document: {
        id: doc.id,`;
if (!out.includes(ancienRetour)) throw new Error('return final introuvable');
const nouveauRetour = `    }
    }

    return NextResponse.json({
      ok: true,
      enAttenteManager,
      docSigne,
      docRefus,
      document: {
        id: doc.id,`;
out = out.replace(ancienRetour, nouveauRetour);

// ---- 6) libellé du statut final dans la réponse
const ancienLib = `      statut,
      statutLibelle: statut === "ACCEPTEE" ? "Acceptée" : statut === "REFUSEE" ? "Refusée" : d.statut,`;
if (!out.includes(ancienLib)) throw new Error('libellé statut réponse introuvable');
out = out.replace(ancienLib, `      statut,
      statutLibelle: refuseeParFinal === "MANAGER"
        ? "Refusée par le Manager"
        : refuseeParFinal === "RH"
          ? "Refusée par les RH"
          : statut === "ACCEPTEE"
            ? "Acceptée"
            : statut === "REFUSEE"
              ? "Refusée"
              : d.statut,`);

fs.writeFileSync('/home/z/my-project/src/app/api/demandes/[id]/repondre/route.ts', out);
console.log('repondre/route.ts fusionné :');
console.log('  statutFinalDepuisDecisions=' + (out.match(/statutFinalDepuisDecisions/g) || []).length);
console.log('  declencherDocumentSigne=' + (out.match(/declencherDocumentSigne/g) || []).length);
console.log('  declencherDocumentRefus=' + (out.match(/declencherDocumentRefus/g) || []).length);
console.log('  enAttenteManager=' + (out.match(/enAttenteManager/g) || []).length);
console.log('  destinataireNotificationDemande (138 conservé)=' + (out.match(/destinataireNotificationDemande/g) || []).length);
console.log('  signerEtConserver (PAdES 138 conservé)=' + (out.match(/signerEtConserver/g) || []).length);
console.log('  lignes=' + out.split('\n').length);
