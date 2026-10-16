#!/usr/bin/env node
/* FUSION demandes-tab.tsx : base v0.2.138 (QR v0.2.88, SignaturePanelReponses
 * v0.2.93, colonnes redimensionnables, matricule v0.2.107, décision explicite
 * v0.2.110, certificat réponses v0.2.112, décalages ±1500 v0.2.92, source
 * notification v0.2.125, managerInfo v0.2.132…) + ajouts Tasks 178-181 du
 * miroir : helpers décision, interfaces deux étapes + traces documents,
 * chargement du détail réel, rechargerDetail, traiter(cible), fonctions
 * regenererDocSigne/Refus, badges liste M/RH, bloc « Validation à deux
 * étapes » (détail), section « Réponse & documents de la décision », boutons
 * RH désactivés sur décision finale.
 */
const fs = require('fs');

const MIROIR = '/tmp/my-project/src/components/payslip/demandes-tab.tsx';
const CIBLE = '/home/z/my-project/src/components/payslip/demandes-tab.tsx';
const m = fs.readFileSync(MIROIR, 'utf8').split('\n');
let out = fs.readFileSync(CIBLE, 'utf8');

function extraitMiroir(ligneDebut, ligneFinIncluse) {
  return m.slice(ligneDebut - 1, ligneFinIncluse).join('\n');
}

// ---------- blocs extraits du miroir (lignes vérifiées par grep) ----------
const blocChargementDetail = extraitMiroir(353, 374);   // IIFE chargement détail réel
const blocRechargerDetail = extraitMiroir(377, 396);    // rechargerDetail useCallback
const blocRegenererDocs = extraitMiroir(489, 576);      // états + regenererDocSigne + regenererDocRefus
const bloc181 = extraitMiroir(958, 1068);               // bloc Validation à deux étapes (détail)
const bloc180 = extraitMiroir(1069, 1399);              // section Réponse & documents de la décision
if (!blocChargementDetail.includes('charge le DÉTAIL RÉEL')) throw new Error('blocChargementDetail incomplet');
if (!blocRechargerDetail.includes('rechargerDetail')) throw new Error('blocRechargerDetail incomplet');
if (!blocRegenererDocs.includes('regenererDocRefus')) throw new Error('blocRegenererDocs incomplet');
if (!bloc181.includes('Décision Manager') || !bloc181.includes('Statut final')) throw new Error('bloc181 incomplet');
if (!bloc180.includes('Réponse &amp; documents de la décision') && !bloc180.includes('Réponse & documents')) throw new Error('bloc180 incomplet');
if (!bloc180.endsWith('})()}')) throw new Error('bloc180 doit finir par })()} — fin : « ' + bloc180.slice(-20) + ' »');

// ---------- 1) icônes lucide ----------
const ancienIcons = `import {
  ClipboardList,
  Inbox,
  Loader2,
  Paperclip,
  RefreshCw,
  ScrollText,
  Search,
} from "lucide-react";`;
if (!out.includes(ancienIcons)) throw new Error('import lucide introuvable');
out = out.replace(ancienIcons, `import {
  ClipboardList,
  Download,
  Eye,
  FileCheck2,
  FileSignature,
  FileText,
  FileX2,
  History,
  Inbox,
  Loader2,
  Paperclip,
  RefreshCw,
  ScrollText,
  Search,
  ShieldCheck,
  UserCheck,
} from "lucide-react";`);

// ---------- 2) STATUTS + VALIDEE ----------
const ancienStatuts = `const STATUTS: { valeur: string; libelle: string }[] = [
  { valeur: "EN_ATTENTE", libelle: "En attente" },
  { valeur: "ACCEPTEE", libelle: "Acceptée" },
  { valeur: "REFUSEE", libelle: "Refusée" },
  { valeur: "INFORMATION_REQUISE", libelle: "Information requise" },
];`;
if (!out.includes(ancienStatuts)) throw new Error('STATUTS introuvable');
out = out.replace(ancienStatuts, `const STATUTS: { valeur: string; libelle: string }[] = [
  { valeur: "EN_ATTENTE", libelle: "En attente" },
  { valeur: "ACCEPTEE", libelle: "Acceptée" },
  { valeur: "REFUSEE", libelle: "Refusée" },
  // (NOUVEAU Task 178) validation automatique par réponse e-mail du manager
  { valeur: "VALIDEE", libelle: "Validée" },
  { valeur: "INFORMATION_REQUISE", libelle: "Information requise" },
];`);

// ---------- 3) classeStatut : + VALIDEE, puis classeDecision + libelleDecision ----------
const ancienClasse = `    case "INFORMATION_REQUISE":
      return "border-amber-300 bg-amber-50 text-amber-700";
    default:
      return "border-slate-300 bg-slate-50 text-slate-600";
  }
}`;
if (!out.includes(ancienClasse)) throw new Error('classeStatut introuvable');
out = out.replace(ancienClasse, `    case "VALIDEE": // (Task 178) validation automatique par e-mail — même famille verte
      return "border-emerald-300 bg-emerald-50 text-emerald-700";
    case "INFORMATION_REQUISE":
      return "border-amber-300 bg-amber-50 text-amber-700";
    default:
      return "border-slate-300 bg-slate-50 text-slate-600";
  }
}

/** (NOUVEAU Task 181) classe d'une décision d'étape (Manager / RH) —
 *  valeurs EN_ATTENTE | ACCEPTEE | REFUSEE (null = non tracée). */
function classeDecision(d: string | null | undefined): string {
  if (d === "ACCEPTEE") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (d === "REFUSEE") return "border-red-300 bg-red-50 text-red-700";
  return "border-slate-300 bg-slate-50 text-slate-500";
}

/** (NOUVEAU Task 181) libellé d'une décision d'étape côté interface. */
function libelleDecision(d: string | null | undefined): string {
  if (d === "ACCEPTEE") return "Acceptée";
  if (d === "REFUSEE") return "Refusée";
  return "En attente";
}`);

// ---------- 4) interfaces : DocumentItem auto/courant + TraceDocGenere ----------
const ancienDocItem = `interface DocumentItem {`;
if (!out.includes(ancienDocItem)) throw new Error('DocumentItem introuvable');
// trouver la fin de l'interface DocumentItem pour ajouter auto/courant + TraceDocGenere après
const idxDI = out.indexOf(ancienDocItem);
const idxFinDI = out.indexOf('}\n', idxDI);
if (idxFinDI < 0) throw new Error('fin DocumentItem introuvable');
const injectionDI = `  // (NOUVEAU Task 180) distinction pièces jointes / documents générés :
  // auto = généré automatiquement (acceptation / refus) ; courant = c'est
  // la VERSION ACTUELLE du document généré (les régénérations gardent les
  // anciennes versions consultables dans l'historique de la demande).
  auto?: boolean;
  courant?: boolean;
}

/** (NOUVEAU Task 180) traçabilité d'un document de réponse généré
 *  (acceptation OU refus — même forme côté API). */
interface TraceDocGenere {
  present: boolean;
  nom: string | null;
  le: string | null;
  par: string | null;
  envoiLe: string | null;
  erreur: string | null;
  destinataires: Record<string, unknown> | null;
}
`;
out = out.slice(0, idxFinDI + 1) + injectionDI + out.slice(idxFinDI + 2);

// ---------- 5) interface DemandeItem : champs deux étapes + docSigne/docRefus ----------
const ancienCreated = `  createdAt: string;
  donnees: Record<string, unknown>;
  infos: [string, string][];`;
if (!out.includes(ancienCreated)) throw new Error('DemandeItem (createdAt/infos) introuvable');
out = out.replace(ancienCreated, `  // (NOUVEAU Task 181) validation à deux étapes Manager → RH : les TROIS
  // champs (Décision Manager / Décision RH / Statut final) + traçabilité.
  deuxEtapes?: boolean;
  decisionManager?: string | null;
  decisionManagerLibelle?: string;
  decisionManagerLe?: string | null;
  decisionManagerPar?: string | null;
  decisionManagerNote?: string | null;
  decisionRh?: string | null;
  decisionRhLibelle?: string;
  decisionRhLe?: string | null;
  decisionRhPar?: string | null;
  refuseePar?: string | null;
  statutFinalLibelle?: string;
  // (NOUVEAU Task 179) traçabilité du document d'acceptation signé
  docSigne?: TraceDocGenere;
  // (NOUVEAU Task 180) traçabilité du document de REFUS signé & tamponné
  docRefus?: TraceDocGenere;
  createdAt: string;
  donnees: Record<string, unknown>;
  infos: [string, string][];`);

// ---------- 6) ouvrirDetail : chargement du détail réel (Task 180) ----------
const ancienOuvrirFin = `    setCertRepOuvert(false);
    setCertRepInfo(null);
  }`;
if (!out.includes(ancienOuvrirFin)) throw new Error('fin ouvrirDetail introuvable');
out = out.replace(ancienOuvrirFin, `    setCertRepOuvert(false);
    setCertRepInfo(null);
` + blocChargementDetail + `
  }`);

// ---------- 7) rechargerDetail : inséré avant l'effet de config tampon ----------
const ancreEffetCfg = `  // (v0.2.51, MODIFIÉ v0.2.93) configuration du tampon pour le mode
  // AUTOMATIQUE : désormais la configuration PROPRE de la section
  // « Demandes / Réponses » (scope=reponse) — plus celle de l'onglet
  // Importation.
  useEffect(() => {`;
if (!out.includes(ancreEffetCfg)) throw new Error('effet config tampon introuvable');
out = out.replace(ancreEffetCfg, blocRechargerDetail + '\n' + ancreEffetCfg);

// ---------- 8) traiter : signature cible + body + toast + rechargerDetail ----------
const ancienTraiter = `  async function traiter(statut: string) {
    if (!detail) return;
    setTraitement(true);
    try {
      const res = await fetch("/api/demandes/" + encodeURIComponent(detail.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statut, commentaire }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        notification?: Record<string, unknown>;
        statutLibelle?: string;
      };
      if (res.ok && data.ok) {
        setNotification(data.notification ?? null);
        toast({
          title: "Demande " + (data.statutLibelle ?? statut).toLowerCase(),
          description:
            data.notification && data.notification.envoye
              ? "E-mail de notification envoyé à l'employé."
              : "Statut mis à jour (voir le détail pour la notification).",
        });
        charge();
        // Rafraîchit le détail affiché avec le nouveau statut
        setDetail({ ...detail, statut, statutLibelle: data.statutLibelle ?? statut, commentaire });
      } else {
        toast({ title: "Traitement impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setTraitement(false);
    }
  }`;
if (!out.includes(ancienTraiter)) throw new Error('traiter introuvable');
out = out.replace(ancienTraiter, `  /** (MODIFIÉ Task 181) cible de la décision : "rh" (défaut — boutons
   *  Accepter / Refuser du pied de dialogue) ou "manager" (le RH enregistre
   *  la décision du manager — le manager décide normalement par e-mail ;
   *  repli opérationnel). Le statut FINAL est calculé côté serveur par la
   *  matrice Manager × RH. */
  async function traiter(statut: string, cible: "rh" | "manager" = "rh") {
    if (!detail) return;
    setTraitement(true);
    try {
      const res = await fetch("/api/demandes/" + encodeURIComponent(detail.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statut, commentaire, cible }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        notification?: Record<string, unknown>;
        statutLibelle?: string;
        enAttenteManager?: boolean;
        statutFinal?: string;
      };
      if (res.ok && data.ok) {
        setNotification(data.notification ?? null);
        toast({
          title: data.enAttenteManager
            ? cible === "manager"
              ? "Décision manager enregistrée"
              : "Décision RH enregistrée"
            : "Demande " + (data.statutLibelle ?? statut).toLowerCase(),
          description: data.enAttenteManager
            ? "La demande reste en attente de la décision " +
              (cible === "manager" ? "du service RH" : "du manager") +
              " — le statut final passera à « Acceptée » / « Refusée » à la décision finale."
            : data.notification && data.notification.envoye
              ? "E-mail de notification envoyé à l'employé."
              : "Statut mis à jour (voir le détail pour la notification).",
        });
        charge();
        // (MODIFIÉ Task 180) recharge le détail COMPLET (statut + documents
        // générés automatiquement à la décision — acceptation ou refus)
        if (detail) rechargerDetail(detail.id);
      } else {
        toast({ title: "Traitement impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setTraitement(false);
    }
  }

` + blocRegenererDocs);

// ---------- 9) envoyerReponse : recharger le détail complet (Task 180) ----------
const ancienSuccesRep = `        charge();
        // Met à jour le détail affiché : statut + document ajouté
        setDetail((prec) =>
          prec
            ? {
                ...prec,
                statut: data.statut ?? prec.statut,
                statutLibelle: data.statutLibelle ?? prec.statutLibelle,
                traitePar: data.traitePar ?? prec.traitePar,`;
if (!out.includes(ancienSuccesRep)) throw new Error('succès envoyerReponse introuvable');
out = out.replace(ancienSuccesRep, `        charge();
        // (Task 180) recharge aussi le détail COMPLET (documents + traces)
        if (detail) rechargerDetail(detail.id);
        // Met à jour le détail affiché : statut + document ajouté
        setDetail((prec) =>
          prec
            ? {
                ...prec,
                statut: data.statut ?? prec.statut,
                statutLibelle: data.statutLibelle ?? prec.statutLibelle,
                traitePar: data.traitePar ?? prec.traitePar,`);

// ---------- 10) badge liste : statut final + mini-badges M/RH (Task 181) ----------
const ancienBadgeListe = `                        {d.statutLibelle}
                      </Badge>`;
if (!out.includes(ancienBadgeListe)) throw new Error('badge liste introuvable');
out = out.replace(ancienBadgeListe, `                        {d.statutFinalLibelle ?? d.statutLibelle}
                      </Badge>
                      {/* (NOUVEAU Task 181) validation à deux étapes Manager → RH :
                          les DEUX décisions d'étape affichées sous le statut final
                          (congé et autorisation de sortie uniquement). */}
                      {d.deuxEtapes && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge
                            variant="outline"
                            className={"px-1.5 py-0 text-[10px] " + classeDecision(d.decisionManager)}
                            title={
                              "Décision Manager" +
                              (d.decisionManagerLe ? \` — \${fmtDate(d.decisionManagerLe)}\` : "") +
                              (d.decisionManagerPar ? \` — \${d.decisionManagerPar}\` : "")
                            }
                          >
                            M&nbsp;: {libelleDecision(d.decisionManager)}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={"px-1.5 py-0 text-[10px] " + classeDecision(d.decisionRh)}
                            title={
                              "Décision RH" +
                              (d.decisionRhLe ? \` — \${fmtDate(d.decisionRhLe)}\` : "") +
                              (d.decisionRhPar ? \` — \${d.decisionRhPar}\` : "")
                            }
                          >
                            RH&nbsp;: {libelleDecision(d.decisionRh)}
                          </Badge>
                        </div>
                      )}`);

// ---------- 11) détail entête : statut final ----------
const ancienEntete = `                    {detail.statutLibelle}
                  </Badge>`;
if (!out.includes(ancienEntete)) throw new Error('entête détail introuvable');
out = out.replace(ancienEntete, `                    {detail.statutFinalLibelle ?? detail.statutLibelle}
                  </Badge>`);

// ---------- 12) blocs détail : Task 181 + Task 180 REMPLACENT le bloc Task 122
// (fonctionnalité conservée : la section Task 180 liste les pièces jointes
// avec Visualiser EN PLUS de Télécharger) — le bloc QR v0.2.88 est conservé.
const marqueurDebut122 = '                {/* -------- (NOUVEAU Task 122) documents transmis par le service RH -------- */}';
const iDebut122 = out.indexOf(marqueurDebut122);
if (iDebut122 < 0) throw new Error('bloc Task 122 introuvable');
// fin du bloc : le « )} » qui ferme la condition (avant le bloc QR v0.2.88)
const marqueurFin122 = '                  </div>\n                )}\n';
const iFinRel = out.indexOf(marqueurFin122, iDebut122);
if (iFinRel < 0) throw new Error('fin bloc Task 122 introuvable');
const iFin122 = iFinRel + marqueurFin122.length;
out = out.slice(0, iDebut122) + bloc181 + '\n' + bloc180 + '\n' + out.slice(iFin122);

// ---------- 13) pied de dialogue : boutons RH (Task 181) ----------
const ancienPied = `                <Button
                  variant="outline"
                  className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  onClick={() => traiter("ACCEPTEE")}
                  disabled={traitement}
                >
                  {traitement && <Loader2 className="h-4 w-4 animate-spin" />}
                  Accepter
                </Button>`;
if (!out.includes(ancienPied)) throw new Error('bouton Accepter introuvable');
out = out.replace(ancienPied, `                <Button
                  variant="outline"
                  className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  onClick={() => traiter("ACCEPTEE")}
                  disabled={
                    traitement ||
                    Boolean(
                      detail.deuxEtapes &&
                        (detail.statut === "ACCEPTEE" ||
                          detail.statut === "VALIDEE" ||
                          detail.statut === "REFUSEE")
                    )
                  }
                >
                  {traitement && <Loader2 className="h-4 w-4 animate-spin" />}
                  {detail.deuxEtapes ? "RH : Accepter" : "Accepter"}
                </Button>`);

const ancienInfoRequise = `                <Button
                  variant="outline"
                  className="border-amber-300 text-amber-700 hover:bg-amber-50"
                  onClick={() => traiter("INFORMATION_REQUISE")}
                  disabled={traitement}
                >
                  Information requise
                </Button>`;
if (!out.includes(ancienInfoRequise)) throw new Error('bouton Information requise introuvable');
out = out.replace(ancienInfoRequise, `                <Button
                  variant="outline"
                  className="border-amber-300 text-amber-700 hover:bg-amber-50"
                  onClick={() => traiter("INFORMATION_REQUISE")}
                  disabled={
                    traitement ||
                    Boolean(
                      detail.deuxEtapes &&
                        (detail.statut === "ACCEPTEE" ||
                          detail.statut === "VALIDEE" ||
                          detail.statut === "REFUSEE")
                    )
                  }
                >
                  Information requise
                </Button>`);

const ancienRefuser = `                <Button
                  variant="destructive"
                  onClick={() => traiter("REFUSEE")}
                  disabled={traitement}
                >
                  Refuser
                </Button>`;
if (!out.includes(ancienRefuser)) throw new Error('bouton Refuser introuvable');
out = out.replace(ancienRefuser, `                <Button
                  variant="destructive"
                  onClick={() => traiter("REFUSEE")}
                  disabled={
                    traitement ||
                    Boolean(
                      detail.deuxEtapes &&
                        (detail.statut === "ACCEPTEE" ||
                          detail.statut === "VALIDEE" ||
                          detail.statut === "REFUSEE")
                    )
                  }
                >
                  {detail.deuxEtapes ? "RH : Refuser" : "Refuser"}
                </Button>`);

fs.writeFileSync(CIBLE, out);
console.log('demandes-tab.tsx fusionné : ' + out.split('\n').length + ' lignes');
console.log('  classeDecision=' + (out.match(/classeDecision/g) || []).length);
console.log('  statutFinalLibelle=' + (out.match(/statutFinalLibelle/g) || []).length);
console.log('  rechargerDetail=' + (out.match(/rechargerDetail/g) || []).length);
console.log('  regenererDocSigne=' + (out.match(/regenererDocSigne/g) || []).length);
console.log('  regenererDocRefus=' + (out.match(/regenererDocRefus/g) || []).length);
console.log('  urlVerification (138 conservé)=' + (out.match(/urlVerification/g) || []).length);
console.log('  decisionReponse (138 conservé)=' + (out.match(/decisionReponse/g) || []).length);
console.log('  matricule (138 conservé)=' + (out.match(/matricule/g) || []).length);
