"use client";

/**
 * ============================================================================
 *  NOUVEAU (Task 116) — ONGLET « DEMANDES ADMINISTRATIVES »
 * ============================================================================
 *  Traitement des demandes créées par les employés depuis le portail (4001) :
 *   - liste filtrable (type, statut, référence ou CIN) avec compteurs ;
 *   - détail complet de chaque demande (données du formulaire) ;
 *   - TRAITEMENT : Acceptée / Refusée / Information requise + commentaire →
 *     e-mail de notification automatique à l'employé (retour affiché, échec
 *     SMTP non bloquant — trace dans le journal d'envoi) ;
 *   - (v0.2.195) carte « Décision Manager » du détail MASQUÉE pour le rôle
 *     RH — l'enregistrement manuel de la décision du manager est réservé au
 *     superadministrateur ; l'état de la décision reste consultable dans la
 *     section « Décision RH » ;
 *   - (IT / superadministrateur) JOURNAL D'ENVOI : 300 dernières tentatives
 *     (succès / erreur + message SMTP exact) — cahier des charges
 *     « consulter les logs d'envoi ; identifier les e-mails envoyés avec
 *     succès ou en erreur ; afficher le message d'erreur SMTP ».
 *  La CONFIGURATION SMTP/routage reste dans l'onglet Accès portail
 *  (panneau « Envoi d'e-mails (SMTP) », champs Task 116 : e-mail RH, e-mail
 *  IT, table des responsables).
 * ============================================================================
 */
import { useCallback, useEffect, useRef, useState } from "react";
// (NOUVEAU v0.2.88) génération du QR « Réponse en ligne » côté interface :
// l'URL (jeton signé côté serveur) est encodée en QR pour impression / partage.
import QRCode from "qrcode";
// (NOUVEAU — demande utilisateur) poignées de redimensionnement des colonnes
import { utiliserColonnesRedimensionnables } from "@/components/payslip/colonnes-redimensionnables";
// (NOUVEAU v0.2.93) SÉPARATION DES CONFIGURATIONS : la section « Demandes /
// Réponses » possède son propre panneau de configuration (tampon signature /
// QR / certificat des documents de réponse) avec aperçu A4 interactif.
import { SignaturePanelReponses } from "@/components/payslip/signature-panel-reponses";
// NOUVEAU (Task 184, v0.2.144) : section « Réponse automatique PDF par e-mail »
// — configuration DÉDIÉE et INDÉPENDANTE (certificat, signature image, tampon,
// QR, positionnement interactif, envoi e-mail) des réponses PDF aux demandes.
import { ReponsePdfPanel } from "@/components/payslip/reponse-pdf-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
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
  Mail,
  Paperclip,
  RefreshCw,
  ScrollText,
  Search,
  ShieldCheck,
  UserCheck,
} from "lucide-react";

/** Libellés des types de demandes (⚠ alignés sur src/lib/demandes.ts). */
const TYPES: { valeur: string; libelle: string }[] = [
  { valeur: "ATTESTATION_TRAVAIL", libelle: "Attestation de travail" },
  { valeur: "ATTESTATION_SALAIRE", libelle: "Attestation de salaire" },
  { valeur: "CONGE", libelle: "Demande de congé" },
  { valeur: "AUTORISATION_SORTIE", libelle: "Autorisation de sortie" },
  { valeur: "PARRAINAGE", libelle: "Demande de parrainage" },
];

const STATUTS: { valeur: string; libelle: string }[] = [
  { valeur: "EN_ATTENTE", libelle: "En attente" },
  { valeur: "ACCEPTEE", libelle: "Acceptée" },
  { valeur: "REFUSEE", libelle: "Refusée" },
  // (NOUVEAU Task 178) validation automatique par réponse e-mail du manager
  { valeur: "VALIDEE", libelle: "Validée" },
  { valeur: "INFORMATION_REQUISE", libelle: "Information requise" },
];

function classeStatut(statut: string): string {
  switch (statut) {
    case "ACCEPTEE":
      return "border-emerald-300 bg-emerald-50 text-emerald-700";
    case "REFUSEE":
      return "border-red-300 bg-red-50 text-red-700";
    case "VALIDEE": // (Task 178) validation automatique par e-mail — même famille verte
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
}

/** (NOUVEAU Task 194) libellé d'une décision reconnue par la classification
 *  automatique (affichage de l'historique des réponses e-mail). */
function libelleDecisionReconnue(d: string | null | undefined): string {
  if (d === "VALIDATION") return "Acceptation reconnue";
  if (d === "REFUS") return "Refus reconnu";
  if (d === "AMBIGUE") return "Réponse ambiguë — statut inchangé";
  if (d === "NON_RECONNU") return "Formulation non reconnue — statut inchangé";
  return "Réponse enregistrée";
}

/** (NOUVEAU Task 194) classe de couleur d'un badge de décision reconnue. */
function classeDecisionReconnue(d: string | null | undefined): string {
  if (d === "VALIDATION") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (d === "REFUS") return "border-red-300 bg-red-50 text-red-700";
  if (d === "AMBIGUE" || d === "NON_RECONNU") return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-slate-300 bg-slate-50 text-slate-600";
}

/** (NOUVEAU Task 194) libellé du rôle de l'expéditeur de la réponse. */
function libelleRoleReponse(r: string | null | undefined): string {
  if (r === "manager") return "Manager";
  if (r === "rh") return "Auto-RH";
  return "—";
}

/**
 * (NOUVEAU v0.2.152) Pièces jointes importées par UNE réponse e-mail donnée —
 * résolues parmi les documents de la demande : d'abord par IDENTIFIANT
 * (reponsesRecues.piecesJointesIds, écrit depuis v0.2.152), puis, à défaut
 * pour les entrées d'historique antérieures, par NOM de fichier
 * (piecesJointesImportees). Les documents générés automatiquement
 * (acceptation / refus) ne sont jamais considérés comme pièces jointes.
 */
function piecesDeReponse(
  rep: ReponseRecueItem,
  detail: DemandeItem
): DocumentItem[] {
  const docs = detail.documents ?? [];
  if (docs.length === 0) return [];
  const parIds = (rep.piecesJointesIds ?? [])
    .map((id) => docs.find((x) => x.id === id))
    .filter((x): x is DocumentItem => Boolean(x));
  if (parIds.length > 0) return parIds;
  return docs.filter(
    (x) => !x.auto && (rep.piecesJointesImportees ?? []).includes(x.nomFichier)
  );
}

interface DocumentItem {
  id: string;
  nomFichier: string;
  taille: number;
  tailleLisible?: string;
  typeMime: string;
  recuLe: string | null;
  recuDe: string;
  // (NOUVEAU Task 180) distinction pièces jointes / documents générés :
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

/** (NOUVEAU Task 194) UNE réponse e-mail reçue pour la demande — historique
 *  consultable par le RH : expéditeur, date/heure, texte ORIGINAL, décision
 *  reconnue (ou non), formulations, pièces jointes, statut avant/après. */
interface ReponseRecueItem {
  le: string;
  de: string;
  role: string;
  sujet: string;
  texte: string;
  decision: string | null;
  formulations: string[];
  piecesJointes: string[];
  piecesJointesImportees: string[];
  // (NOUVEAU v0.2.152) identifiants des documents importés par CETTE réponse
  // — liens Visualiser/Télécharger rendus directement dans l'entrée.
  piecesJointesIds?: string[];
  statutAvant: string | null;
  statutApres: string | null;
}

interface DemandeItem {
  id: string;
  reference: string;
  type: string;
  typeLibelle: string;
  statut: string;
  statutLibelle: string;
  cin: string;
  cinMasque: string;
  // NOUVEAU (v0.2.107) : matricule de l'employé demandeur — auto-associé
  // depuis ses fiches de paie (valeur manuelle de l'accès portail prioritaire).
  // "" = inconnu (aucun matricule détecté) — affichage « — ».
  matricule: string;
  destinataire: string;
  employeEmail: string;
  // (NOUVEAU v0.2.125) source de l'adresse affichée (résolue à la lecture
  // avec la MÊME règle que l'envoi des réponses) : chaîne vide = aucune
  // adresse connue.
  employeEmailSource?: string;
  employeEmailSourceLibelle?: string;
  commentaire: string;
  traitePar: string;
  traiteLe: string | null;
  // (NOUVEAU Task 181) validation à deux étapes Manager → RH : les TROIS
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
  // (NOUVEAU v0.2.151 — parité RH) formulation reconnue dans la réponse
  // e-mail des RH (jumelle de decisionManagerNote).
  decisionRhNote?: string | null;
  refuseePar?: string | null;
  statutFinalLibelle?: string;
  // (NOUVEAU Task 179) traçabilité du document d'acceptation signé
  docSigne?: TraceDocGenere;
  // (NOUVEAU Task 180) traçabilité du document de REFUS signé & tamponné
  docRefus?: TraceDocGenere;
  // (NOUVEAU Task 194) historique des réponses e-mail reçues (consultable)
  reponsesRecues?: ReponseRecueItem[];
  createdAt: string;
  donnees: Record<string, unknown>;
  infos: [string, string][];
  // (NOUVEAU Task 122) documents transmis par le service RH par e-mail
  documents?: DocumentItem[];
  // (NOUVEAU v0.2.88) URL publique de vérification de la réponse (QR
  // « Réponse en ligne ») — absente si l'adresse publique (qrUrl) n'est
  // pas configurée dans la rubrique Signature électronique & QR code.
  urlVerification?: string;
}

interface LigneJournal {
  horodatage: string;
  action: string;
  dest: string;
  from?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  succes: boolean;
  messageId?: string | null;
  reponseSmtp?: string | null;
  code?: string | null;
  erreur?: string | null;
  reference?: string | null;
  type?: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const LIBELLE_ACTION_JOURNAL: Record<string, string> = {
  "envoi-acces": "Envoi d'accès",
  "envoi-test": "E-mail de test",
  "demande-creation": "Demande (création)",
  "demande-statut": "Demande (statut)",
  // (NOUVEAU Task 122) réception des documents RH
  "demande-document": "Document RH reçu (e-mail)",
  "demande-document-notification": "Document RH (notification)",
  "demande-imap": "Boîte de réception (IMAP)",
};

/** (NOUVEAU Task 122) taille lisible côté interface (repli si l'API ne l'a pas calculée). */
function fmtTaille(o: number | undefined, lisible?: string): string {
  if (lisible) return lisible;
  const n = Number(o ?? 0);
  if (!isFinite(n) || n <= 0) return "0 Ko";
  if (n >= 1048576) return (n / 1048576).toFixed(1).replace(".", ",") + " Mo";
  return Math.max(1, Math.round(n / 1024)) + " Ko";
}

export function DemandesTab({ role }: { role: string }) {
  const { toast } = useToast();
  const estIt = role === "IT" || role === "SUPERADMIN";
  // (NOUVEAU v0.2.195 — demande utilisateur) le rôle RH ne voit PAS la carte
  // « Décision Manager » du détail (cadre « Enregistrer la décision du
  // manager : Acceptée / Refusée ») : l'enregistrement manuel de la décision
  // du manager est réservé au SUPERADMIN. Une note discrète remplace la carte
  // et l'état de la décision (badge + date + acteur + note) reste consultable
  // dans la section « Décision RH » ci-dessous (boîte « ÉTAT ACTUEL »).
  const estRh = role === "RH";

  const [items, setItems] = useState<DemandeItem[]>([]);
  // (NOUVEAU — demande utilisateur, point 9) redimensionnement manuel des colonnes
  // (posé après les états : items / chargement / journal).
  const [total, setTotal] = useState(0);
  const [compteurs, setCompteurs] = useState<Record<string, number>>({});
  const [chargement, setChargement] = useState(true);
  const [filtreType, setFiltreType] = useState("tous");
  const [filtreStatut, setFiltreStatut] = useState("tous");
  const [q, setQ] = useState("");

  const [detail, setDetail] = useState<DemandeItem | null>(null);
  const [commentaire, setCommentaire] = useState("");
  const [traitement, setTraitement] = useState(false);
  const [notification, setNotification] = useState<Record<string, unknown> | null>(null);

  // ---- (NOUVEAU v0.2.51) RÉPONSE RH AVEC DOCUMENT IMPORTÉ ----
  // Le RH importe le document de réponse depuis le détail de la demande :
  // tampon signature/QR automatique (configuration globale) ou manuel
  // (réglages propres à CE document), aperçu avant validation, puis
  // validation = stockage chiffré + statut Acceptée + notification e-mail ;
  // l'employé voit le document dans « Mes demandes » de son portail.
  interface OptionsTamponManuel {
    sigActif: boolean;
    sigTexte: string;
    sigPosition: string;
    sigTaille: number;
    sigOpacite: number;
    qrActif: boolean;
    qrPosition: string;
    qrTaille: number;
    // (NOUVEAU 0.2.54) rotations en degrés SENS HORAIRE (0 → 360)
    sigRotation: number;
    qrRotation: number;
    // (NOUVEAU v0.2.92) décalages fins ±1500 pt = DÉPLACEMENT LIBRE des
    // éléments (mêmes bornes que la configuration globale).
    sigDecalX: number;
    sigDecalY: number;
    qrDecalX: number;
    qrDecalY: number;
    // (NOUVEAU v0.2.92) CASE À COCHER + POSITIONNEMENT du certificat de
    // signature électronique — comme pour le QR et la signature. Les
    // MÉTADONNÉES du certificat importé restent celles de la configuration
    // globale (le moteur ne dessine le bloc que si un certificat est importé).
    certActif: boolean;
    certPosition: string;
    certDecalX: number;
    certDecalY: number;
    certTaille: number;
    mentionActif: boolean;
    mentionTexte: string;
  }
  const OPTS_TAMPON_DEFAUT: OptionsTamponManuel = {
    sigActif: true,
    sigTexte: "",
    sigPosition: "BAS_DROITE",
    sigTaille: 120,
    sigOpacite: 0.9,
    qrActif: true,
    qrPosition: "BAS_GAUCHE",
    qrTaille: 110,
    sigRotation: 0,
    qrRotation: 0,
    sigDecalX: 0,
    sigDecalY: 0,
    qrDecalX: 0,
    qrDecalY: 0,
    certActif: false,
    certPosition: "BAS_CENTRE",
    certDecalX: 0,
    certDecalY: 0,
    certTaille: 100,
    mentionActif: true,
    mentionTexte: "Document signé électroniquement — AutoRH — {DATE}",
  };
  const [fichierReponse, setFichierReponse] = useState<File | null>(null);
  const [modeTampon, setModeTampon] = useState<"auto" | "manuel" | "aucun">("auto");
  // NOUVEAU (v0.2.110 — demande utilisateur « Statut des demandes avec pièce
  // jointe ») : DÉCISION explicite portée par la réponse avec document —
  // « ACCEPTEE » / « REFUSEE » / « AUCUNE » (défaut = comportement
  // historique : document seul → Acceptée si En attente). Le statut de la
  // demande reflète la décision, la pièce jointe restant affichée et
  // accessible EN PLUS du statut (jamais « En attente » avec décision
  // explicite).
  const [decisionReponse, setDecisionReponse] = useState<"AUCUNE" | "ACCEPTEE" | "REFUSEE">("AUCUNE");
  const [optsMan, setOptsMan] = useState<OptionsTamponManuel>(OPTS_TAMPON_DEFAUT);
  const [cfgSignature, setCfgSignature] = useState<{
    actif: boolean;
    sigActif: boolean;
    qrActif: boolean;
    mentionActif: boolean;
    aImage: boolean;
    tamponActif: boolean;
  } | null>(null);
  // (NOUVEAU v0.2.112) IMPORT de certificat électronique DANS le dialogue de
  // réponse (« réponse au demande ») : certificat SEUL quand la clé privée est
  // déjà disponible dans le système, coffre .p12/.pfx (certificat + clé), ou
  // clé privée séparée — sans quitter le dialogue (l'API scope=reponse).
  const [certRepOuvert, setCertRepOuvert] = useState(false);
  const [certRepFichier, setCertRepFichier] = useState<File | null>(null);
  const [certRepMdp, setCertRepMdp] = useState("");
  const [certRepCle, setCertRepCle] = useState<File | null>(null);
  const [certRepCleMdp, setCertRepCleMdp] = useState("");
  const [certRepEnCours, setCertRepEnCours] = useState(false);
  const [certRepInfo, setCertRepInfo] = useState<{
    sujet: string;
    fichierNom: string;
    cleDisponible: boolean;
    cleNom: string;
  } | null>(null);
  const [apercuUrl, setApercuUrl] = useState<string | null>(null);
  const [apercuMime, setApercuMime] = useState<string>("");
  const [apercuNote, setApercuNote] = useState<string | null>(null);
  const [reponseEnCours, setReponseEnCours] = useState(false);
  const [reponseResultat, setReponseResultat] = useState<Record<string, unknown> | null>(null);
  // (NOUVEAU v0.2.88) image QR de l'URL de vérification (dataURL PNG) —
  // calculée dès qu'un détail porteur d'URL publique est ouvert.
  const [qrVerificationUrl, setQrVerificationUrl] = useState<string | null>(null);

  const [journal, setJournal] = useState<LigneJournal[]>([]);
  const [journalOuvert, setJournalOuvert] = useState(false);
  const refTableauDemandes = useRef<HTMLDivElement>(null);
  const refTableauJournal = useRef<HTMLDivElement>(null);
  utiliserColonnesRedimensionnables(refTableauDemandes, "demandes", items.length + (chargement ? 1 : 0));
  utiliserColonnesRedimensionnables(refTableauJournal, "journal-demandes", journalOuvert ? journal.length + 1 : 0);
  const [journalCharge, setJournalCharge] = useState(false);

  const charge = useCallback(async () => {
    setChargement(true);
    try {
      const p = new URLSearchParams();
      if (filtreType !== "tous") p.set("type", filtreType);
      if (filtreStatut !== "tous") p.set("statut", filtreStatut);
      if (q.trim()) p.set("q", q.trim());
      const res = await fetch("/api/demandes?" + p.toString(), { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          total: number;
          compteurs: Record<string, number>;
          items: DemandeItem[];
        };
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
        setCompteurs(data.compteurs ?? {});
      } else {
        const d = await res.json().catch(() => ({}));
        toast({ title: "Chargement impossible", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setChargement(false);
    }
  }, [filtreType, filtreStatut, q, toast]);

  useEffect(() => {
    charge();
  }, [charge]);

  // (NOUVEAU v0.2.88) QR de l'URL de vérification « Réponse en ligne » :
  // régénéré à chaque ouverture d'un détail porteur d'URL publique.
  useEffect(() => {
    let vivant = true;
    const url = detail?.urlVerification ?? "";
    if (!url) {
      setQrVerificationUrl(null);
      return;
    }
    QRCode.toDataURL(url, { margin: 1, width: 160, errorCorrectionLevel: "M" })
      .then((dataUrl) => {
        if (vivant) setQrVerificationUrl(dataUrl);
      })
      .catch(() => {
        if (vivant) setQrVerificationUrl(null);
      });
    return () => {
      vivant = false;
    };
  }, [detail?.urlVerification]);

  function ouvrirDetail(d: DemandeItem) {
    setDetail(d);
    setCommentaire(d.commentaire ?? "");
    setNotification(null);
    // (v0.2.51) réinitialisation du panneau de réponse document
    setFichierReponse(null);
    setDecisionReponse("AUCUNE"); // (v0.2.110) décision réinitialisée
    setApercuUrl(null);
    setApercuNote(null);
    setReponseResultat(null);
    setQrVerificationUrl(null);
    setModeTampon("auto");
    setOptsMan(OPTS_TAMPON_DEFAUT);
    setCfgSignature(null);
    // (v0.2.112) réinitialisation du panneau certificat (le fichier en attente
    // seulement — l'état importé certRepInfo est rechargé par l'effet plus bas)
    setCertRepFichier(null);
    setCertRepMdp("");
    setCertRepCle(null);
    setCertRepCleMdp("");
    setCertRepOuvert(false);
    setCertRepInfo(null);
    setOptsMan(OPTS_TAMPON_DEFAUT);
    setCfgSignature(null);
    // (NOUVEAU Task 180) charge le DÉTAIL RÉEL (API) : la ligne de liste ne
    // porte pas les traces docSigne / docRefus ni les flags auto/courant —
    // sans cela la section « Réponse & documents » affichait un état périmé
    // (« pas encore généré ») à chaque ouverture.
    (async () => {
      try {
        const res = await fetch(
          "/api/demandes/" + encodeURIComponent(d.id),
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data = (await res.json()) as { item?: DemandeItem };
        if (data.item) {
          setDetail((courante) =>
            courante && courante.id === d.id ? { ...courante, ...data.item } : courante
          );
        }
      } catch {
        /* détail indisponible : la fiche de liste reste affichée */
      }
    })();
  }


  /** (NOUVEAU Task 180) recharge le détail affiché depuis l'API (après une
   *  décision, une régénération de document ou une réponse importée). */
  const rechargerDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(
        "/api/demandes/" + encodeURIComponent(id),
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as { item?: DemandeItem };
      if (data.item) {
        setDetail((courante) =>
          courante && courante.id === id ? { ...courante, ...data.item } : courante
        );
        setCommentaire(data.item.commentaire ?? "");
      }
    } catch {
      /* silencieux — la liste reste à jour via charge() */
    }
  }, []);
  // (v0.2.51, MODIFIÉ v0.2.93) configuration du tampon pour le mode
  // AUTOMATIQUE : désormais la configuration PROPRE de la section
  // « Demandes / Réponses » (scope=reponse) — plus celle de l'onglet
  // Importation.
  useEffect(() => {
    if (!detail) return;
    let annule = false;
    (async () => {
      try {
        const res = await fetch("/api/signature-config?scope=reponse", { cache: "no-store" });
        if (!res.ok || annule) return;
        const data = (await res.json()) as {
          config?: {
            actif?: boolean;
            sigActif?: boolean;
            qrActif?: boolean;
            mentionActif?: boolean;
            sigImage?: string;
            certSujet?: string;
            certFichierNom?: string;
            certClePriveeDisponible?: boolean;
            certCleFichierNom?: string;
          };
          tamponActif?: boolean;
        };
        const c = data.config ?? {};
        if (!annule) {
          setCfgSignature({
            actif: Boolean(c.actif),
            sigActif: Boolean(c.sigActif),
            qrActif: Boolean(c.qrActif),
            mentionActif: Boolean(c.mentionActif),
            aImage: Boolean(c.sigImage),
            tamponActif: Boolean(data.tamponActif),
          });
          // (v0.2.112) état du certificat de signature électronique affiché
          // dans le dialogue de réponse.
          setCertRepInfo({
            sujet: String(c.certSujet ?? ""),
            fichierNom: String(c.certFichierNom ?? ""),
            cleDisponible: Boolean(c.certClePriveeDisponible),
            cleNom: String(c.certCleFichierNom ?? ""),
          });
        }
      } catch {
        /* configuration indisponible : le mode automatique affichera un avertissement */
      }
    })();
    return () => {
      annule = true;
    };
  }, [detail?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // (NOUVEAU v0.2.112) Import d'un certificat électronique + clé privée
  // DIRECTEMENT depuis le dialogue « Répondre avec un document » (réponse au
  // demande) — l'API scope=reponse réécrit TOUS les champs : on repart donc
  // de la configuration ACTUELLE (GET) puis on y ajoute le certificat/clé.
  async function importerCertificatReponse() {
    if (!detail || !certRepFichier) return;
    setCertRepEnCours(true);
    try {
      const lireBase64 = (f: File) =>
        new Promise<string>((resolution, rejet) => {
          const lecteur = new FileReader();
          lecteur.onload = () => {
            const r = String(lecteur.result ?? "");
            resolution(r.includes(",") ? r.slice(r.indexOf(",") + 1) : r);
          };
          lecteur.onerror = () => rejet(new Error("Lecture du fichier impossible"));
          lecteur.readAsDataURL(f);
        });
      const resGet = await fetch("/api/signature-config?scope=reponse", { cache: "no-store" });
      if (!resGet.ok) throw new Error("Configuration des réponses illisible.");
      const dGet = (await resGet.json().catch(() => ({}))) as { config?: Record<string, unknown> };
      const cfgActuelle = dGet.config ?? {};
      const corps: Record<string, unknown> = { scope: "reponse" };
      for (const cle of [
        "actif", "sigActif", "sigTexte", "sigPosition", "sigTaille", "sigOpacite",
        "qrActif", "qrMode", "qrUrl", "qrTexte", "qrPosition", "qrTaille",
        "sigDecalX", "sigDecalY", "qrDecalX", "qrDecalY",
        "sigRotation", "qrRotation", "mentionActif", "mentionTexte",
        "certActif", "certPosition", "certDecalX", "certDecalY", "certTaille",
      ]) {
        if (cle in cfgActuelle) corps[cle] = cfgActuelle[cle];
      }
      corps.certFichier = await lireBase64(certRepFichier);
      corps.certFichierNom = certRepFichier.name;
      if (certRepMdp) corps.certMotDePasse = certRepMdp;
      if (certRepCle) {
        corps.certCleFichier = await lireBase64(certRepCle);
        corps.certCleFichierNom = certRepCle.name;
        if (certRepCleMdp) corps.certCleMotDePasse = certRepCleMdp;
      }
      const res = await fetch("/api/signature-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps),
      });
      const d = (await res.json().catch(() => ({}))) as { config?: Record<string, unknown>; error?: string };
      if (!res.ok) {
        toast({ title: "Import impossible", description: d.error, variant: "destructive" });
        return;
      }
      const c2 = d.config ?? {};
      setCertRepInfo({
        sujet: String(c2.certSujet ?? ""),
        fichierNom: String(c2.certFichierNom ?? ""),
        cleDisponible: Boolean(c2.certClePriveeDisponible),
        cleNom: String(c2.certCleFichierNom ?? ""),
      });
      setCertRepFichier(null);
      setCertRepMdp("");
      setCertRepCle(null);
      setCertRepCleMdp("");
      toast({
        title: "Certificat importé",
        description:
          "Le certificat est désormais disponible pour les réponses (bloc « Signature électronique certifiée ») — clé privée " +
          (Boolean(c2.certClePriveeDisponible) ? "disponible" : "non disponible") +
          ".",
      });
    } catch (e) {
      toast({ title: "Import impossible", description: (e as Error).message, variant: "destructive" });
    } finally {
      setCertRepEnCours(false);
    }
  }

  /** (MODIFIÉ Task 181) cible de la décision : "rh" (défaut — boutons
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

  // (NOUVEAU Task 179) état du document d'acceptation signé (bouton du détail)
  const [docSigneEnCours, setDocSigneEnCours] = useState(false);
  const [docSigneResultat, setDocSigneResultat] = useState<{ ok: boolean; message: string } | null>(null);
  // (NOUVEAU Task 180) état du document de refus signé (bouton du détail)
  const [docRefusEnCours, setDocRefusEnCours] = useState(false);
  const [docRefusResultat, setDocRefusResultat] = useState<{ ok: boolean; message: string } | null>(null);

  /** (NOUVEAU Task 179) Génère / régénère / renvoie le document d'acceptation
   *  signé électroniquement et tamponné de la demande affichée.
   *  (MODIFIÉ Task 180) recharge le détail complet après succès. */
  async function regenererDocSigne(d: DemandeItem) {
    setDocSigneEnCours(true);
    setDocSigneResultat(null);
    try {
      const res = await fetch(
        "/api/demandes/" + encodeURIComponent(d.id) + "/doc-signe",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ forcer: Boolean(d.docSigne?.present) }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && data.ok) {
        const doc = data.document as { nom?: string } | undefined;
        const envoi = data.envoi as { envoye?: boolean; erreur?: string } | undefined;
        setDocSigneResultat({
          ok: true,
          message:
            "Document " + (doc?.nom ? `« ${doc.nom} » ` : "") +
            "généré et signé" +
            (envoi?.envoye ? " — e-mail envoyé." : envoi?.erreur ? ` — envoi e-mail en échec : ${envoi.erreur}` : " — envoi e-mail non effectué."),
        });
        toast({ title: "Document signé généré", description: doc?.nom || undefined });
        charge();
        await rechargerDetail(d.id);
      } else {
        const msg = String(data.error || data.erreur || data.motif || "Génération impossible");
        setDocSigneResultat({ ok: false, message: msg });
        toast({ title: "Génération impossible", description: msg, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setDocSigneEnCours(false);
    }
  }

  /** (NOUVEAU Task 180) Génère / régénère / renvoie le document de DÉCISION
   *  DE REFUS signé électroniquement et tamponné de la demande affichée. */
  async function regenererDocRefus(d: DemandeItem) {
    setDocRefusEnCours(true);
    setDocRefusResultat(null);
    try {
      const res = await fetch(
        "/api/demandes/" + encodeURIComponent(d.id) + "/doc-refus",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ forcer: Boolean(d.docRefus?.present) }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && data.ok) {
        const doc = data.document as { nom?: string } | undefined;
        const envoi = data.envoi as { envoye?: boolean; erreur?: string } | undefined;
        setDocRefusResultat({
          ok: true,
          message:
            "Document " + (doc?.nom ? `« ${doc.nom} » ` : "") +
            "généré et signé" +
            (envoi?.envoye ? " — e-mail envoyé." : envoi?.erreur ? ` — envoi e-mail en échec : ${envoi.erreur}` : " — envoi e-mail non effectué."),
        });
        toast({ title: "Document de refus généré", description: doc?.nom || undefined });
        charge();
        await rechargerDetail(d.id);
      } else {
        const msg = String(data.error || data.erreur || data.motif || "Génération impossible");
        setDocRefusResultat({ ok: false, message: msg });
        toast({ title: "Génération impossible", description: msg, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setDocRefusEnCours(false);
    }
  }


  /** (NOUVEAU v0.2.51) aperçu ou validation du document de réponse. */
  async function envoyerReponse(mode: "apercu" | "valider") {
    if (!detail || !fichierReponse) return;
    setReponseEnCours(true);
    try {
      const fd = new FormData();
      fd.append("document", fichierReponse);
      fd.append("mode", mode);
      fd.append("tampon", modeTampon);
      // (NOUVEAU v0.2.110) décision explicite portée par la réponse — le
      // statut de la demande la reflète (Acceptée / Refusée) en plus de la
      // pièce jointe (voir /api/demandes/[id]/repondre).
      fd.append("decision", decisionReponse);
      if (modeTampon === "manuel") fd.append("options", JSON.stringify(optsMan));
      const res = await fetch(
        "/api/demandes/" + encodeURIComponent(detail.id) + "/repondre",
        { method: "POST", body: fd }
      );
      const ctype = res.headers.get("content-type") || "";
      if (mode === "apercu") {
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          toast({ title: "Aperçu impossible", description: d.error, variant: "destructive" });
          return;
        }
        if (ctype.includes("application/json")) {
          // format sans aperçu navigateur (Word) — note affichée
          const d = (await res.json()) as { note?: string };
          setApercuUrl(null);
          setApercuNote(d.note ?? "Aperçu non disponible pour ce format.");
          return;
        }
        const blob = await res.blob();
        setApercuMime(blob.type || "application/pdf");
        setApercuUrl((ancienne) => {
          if (ancienne) URL.revokeObjectURL(ancienne);
          return URL.createObjectURL(blob);
        });
        setApercuNote(null);
        const av = res.headers.get("X-Document-Apercu-Avertissements");
        if (av) {
          toast({
            title: "Aperçu généré avec avertissement",
            description: decodeURIComponent(av),
          });
        }
        return;
      }
      // ---- mode = valider ----
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        document?: { id: string; nomFichier: string; taille: number; tailleLisible: string; typeMime: string };
        statut?: string;
        statutLibelle?: string;
        traitePar?: string;
        tamponApplique?: boolean;
        avertissements?: string[];
        notification?: Record<string, unknown>;
      };
      if (res.ok && data.ok) {
        setReponseResultat(data as unknown as Record<string, unknown>);
        setFichierReponse(null);
        setApercuUrl((ancienne) => {
          if (ancienne) URL.revokeObjectURL(ancienne);
          return null;
        });
        setApercuNote(null);
        const notifOk = Boolean(data.notification && data.notification.envoye);
        toast({
          title: "Document envoyé à l'employé",
          description:
            (data.document?.nomFichier ?? "Document") +
            (data.tamponApplique ? " (tamponné)" : "") +
            (notifOk
              ? " — e-mail de notification envoyé."
              : " — l'employé le voit dans « Mes demandes » de son portail."),
        });
        charge();
        // (Task 180) recharge aussi le détail COMPLET (documents + traces)
        if (detail) rechargerDetail(detail.id);
        // Met à jour le détail affiché : statut + document ajouté
        setDetail((prec) =>
          prec
            ? {
                ...prec,
                statut: data.statut ?? prec.statut,
                statutLibelle: data.statutLibelle ?? prec.statutLibelle,
                traitePar: data.traitePar ?? prec.traitePar,
                traiteLe: prec.traiteLe ?? new Date().toISOString(),
                documents: [
                  ...(prec.documents ?? []),
                  {
                    id: data.document?.id ?? "",
                    nomFichier: data.document?.nomFichier ?? "",
                    taille: data.document?.taille ?? 0,
                    tailleLisible: data.document?.tailleLisible ?? "",
                    typeMime: data.document?.typeMime ?? "",
                    recuLe: new Date().toISOString(),
                    recuDe: "Import direct",
                  },
                ],
              }
            : prec
        );
      } else {
        toast({ title: "Envoi impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setReponseEnCours(false);
    }
  }

  const chargeJournal = useCallback(async () => {
    setJournalCharge(true);
    try {
      const res = await fetch("/api/demandes/journal", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { items: LigneJournal[] };
        setJournal(data.items ?? []);
      } else {
        const d = await res.json().catch(() => ({}));
        toast({ title: "Journal indisponible", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setJournalCharge(false);
    }
  }, [toast]);

  useEffect(() => {
    if (journalOuvert && estIt) chargeJournal();
  }, [journalOuvert, estIt, chargeJournal]);

  return (
    <div className="space-y-4">
      {/* -------- (NOUVEAU v0.2.93) CONFIGURATION DES RÉPONSES (séparation) --------
           Panneau PROPRE à la section « Demandes / Réponses » : interrupteurs,
           textes et positionnement (signature / QR / certificat)
           indépendants de la configuration de l'onglet Importation, avec
           aperçu A4 interactif (éléments déplaçables indépendamment,
           curseurs synchronisés en temps réel). */}
      {/* (v0.2.194) Rôle RH : le bloc d'IMPORT du fichier de certificat
          (« Fichier de certificat de CETTE section ») du panneau
          « Configuration des réponses » est MASQUÉ — matériel cryptographique
          réservé au superadministrateur (même règle que ReponsePdfPanel
          v0.2.186) ; interrupteur, positionnement et métadonnées restent
          visibles. */}
      <SignaturePanelReponses masquerCertificat={role === "RH"} />

      {/* -------- (NOUVEAU Task 184, v0.2.144) RÉPONSE AUTOMATIQUE PDF PAR
           E-MAIL — section DÉDIÉE sous la rubrique Demandes : génération
           automatique du PDF de réponse (congé / autorisation) envoyé par
           e-mail à l'employé, au RH et au manager, avec une configuration
           TOTALEMENT INDÉPENDANTE de l'import des fiches de paie (certificat
           dédié, signature image, tampon, QR Code, positionnement interactif
           identique, positions conservées et appliquées automatiquement). */}
      {/* (v0.2.186) Rôle RH : le bloc « Signature électronique — certificat
          dédié » de la section « Réponse automatique PDF par e-mail (congé /
          autorisation) » est MASQUÉ — le certificat dédié reste géré par le
          superadministrateur (SUPERADMIN conserve le bloc complet). */}
      <ReponsePdfPanel masquerCertificat={role === "RH"} />

      {/* -------- Liste + filtres -------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-5 w-5 text-emerald-600" />
            Demandes administratives
            <Badge variant="outline">{total}</Badge>
          </CardTitle>
          <CardDescription>
            Demandes envoyées par les employés depuis le portail. Chaque création
            est transmise automatiquement par e-mail au service RH (attestations),
            au manager responsable de l&apos;employé (congé et autorisation de
            sortie — affecté dans « Mot de passe initial — CIN », sans saisie)
            ou à l&apos;adresse dédiée du parrainage ; l&apos;employé demandeur et le
            service RH reçoivent une copie. Traitez-les ici : l&apos;employé est
            notifié par e-mail à chaque changement de statut.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Select value={filtreType} onValueChange={setFiltreType}>
              <SelectTrigger aria-label="Filtrer par type">
                <SelectValue placeholder="Tous les types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">Tous les types</SelectItem>
                {TYPES.map((t) => (
                  <SelectItem key={t.valeur} value={t.valeur}>
                    {t.libelle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filtreStatut} onValueChange={setFiltreStatut}>
              <SelectTrigger aria-label="Filtrer par statut">
                <SelectValue placeholder="Tous les statuts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">Tous les statuts</SelectItem>
                {STATUTS.map((s) => (
                  <SelectItem key={s.valeur} value={s.valeur}>
                    {s.libelle} ({compteurs[s.valeur] ?? 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Référence (DEM-…) ou CIN exact"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") charge();
              }}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={charge} disabled={chargement} className="flex-1">
                {chargement ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Rechercher
              </Button>
              {estIt && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setJournalOuvert(true)}
                  title="Journal d'envoi des e-mails"
                >
                  <ScrollText className="h-4 w-4" />
                  Journal
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {STATUTS.map((s) => (
              <Badge key={s.valeur} variant="outline" className={classeStatut(s.valeur)}>
                {s.libelle}&nbsp;: {compteurs[s.valeur] ?? 0}
              </Badge>
            ))}
          </div>

          {/* MODIFIÉ (Task 123) : overflow-x-auto — le tableau 6 colonnes
              défile horizontalement sur mobile au lieu de déborder/couper.
              (MODIFIÉ — demande utilisateur, point 9 : poignées de redimensionnement) */}
          <div ref={refTableauDemandes} className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Référence</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Employé</TableHead>
                  {/* NOUVEAU (v0.2.107 — demande utilisateur, point 3) : le
                      matricule de l'employé, récupéré automatiquement depuis
                      ses fiches de paie, accompagne chaque demande. */}
                  <TableHead>Matricule</TableHead>
                  <TableHead>Créée le</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Détail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      <Inbox className="h-6 w-6 mx-auto mb-2 opacity-50" />
                      Aucune demande {chargement ? "…" : "pour ces filtres"}.
                    </TableCell>
                  </TableRow>
                )}
                {items.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs">{d.reference}</TableCell>
                    <TableCell>{d.typeLibelle}</TableCell>
                    <TableCell className="font-mono text-xs">{d.cinMasque}</TableCell>
                    {/* NOUVEAU (v0.2.107) : matricule auto-associé à l'employé. */}
                    <TableCell className="font-mono text-xs">
                      {d.matricule ? (
                        <span title="Matricule récupéré automatiquement depuis les fiches de paie de l'employé">{d.matricule}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmtDate(d.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={classeStatut(d.statut)}>
                        {d.statutFinalLibelle ?? d.statutLibelle}
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
                              (d.decisionManagerLe ? ` — ${fmtDate(d.decisionManagerLe)}` : "") +
                              (d.decisionManagerPar ? ` — ${d.decisionManagerPar}` : "")
                            }
                          >
                            M&nbsp;: {libelleDecision(d.decisionManager)}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={"px-1.5 py-0 text-[10px] " + classeDecision(d.decisionRh)}
                            title={
                              "Décision RH" +
                              (d.decisionRhLe ? ` — ${fmtDate(d.decisionRhLe)}` : "") +
                              (d.decisionRhPar ? ` — ${d.decisionRhPar}` : "")
                            }
                          >
                            RH&nbsp;: {libelleDecision(d.decisionRh)}
                          </Badge>
                        </div>
                      )}
                      {/* (NOUVEAU Task 122) badge « N doc(s) » quand le service RH a répondu avec pièce(s) jointe(s) */}
                      {d.documents && d.documents.length > 0 && (
                        <Badge variant="outline" className="ml-1.5 border-blue-300 bg-blue-50 text-blue-700" title={d.documents.map((x) => x.nomFichier).join(", ")}>
                          {d.documents.length} doc{d.documents.length > 1 ? "s" : ""}
                        </Badge>
                      )}
                      {/* (SUPPRIMÉ Task 136 — demande utilisateur « supprime cette
                          partie dans cadre rouge ») : le badge amber « ⚠ Nom »
                          d'incohérence de nom n'est PLUS affiché dans la colonne
                          Statut du tableau. Le signalement complet reste visible
                          à l'ouverture du détail de la demande (bannière amber)
                          et dans l'e-mail envoyé au service RH. */}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => ouvrirDetail(d)}>
                        Ouvrir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {total > items.length && (
            <p className="text-xs text-muted-foreground">
              {items.length} demandes affichées sur {total} — affinez les filtres pour voir les autres.
            </p>
          )}
        </CardContent>
      </Card>

      {/* -------- Détail + traitement -------- */}
      <Dialog open={Boolean(detail)} onOpenChange={(o) => (!o ? setDetail(null) : undefined)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">{detail.reference}</span>
                  <span>—</span>
                  <span>{detail.typeLibelle}</span>
                  <Badge variant="outline" className={classeStatut(detail.statut)}>
                    {detail.statutFinalLibelle ?? detail.statutLibelle}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  Employé <b className="font-mono">{detail.cinMasque}</b>
                  {" — "}demande créée le {fmtDate(detail.createdAt)}
                  {detail.traiteLe
                    ? ` — traitée le ${fmtDate(detail.traiteLe)} par ${detail.traitePar || "—"}`
                    : ""}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 text-sm">
                <div className="rounded-md border bg-muted/40 p-3 space-y-1">
                  {/* NOUVEAU (v0.2.107) : matricule de l'employé (auto-associé
                      depuis ses fiches de paie) dans les informations de la
                      demande. */}
                  <p>
                    <span className="text-muted-foreground">Matricule&nbsp;:</span>{" "}
                    {detail.matricule ? (
                      <b className="font-mono">{detail.matricule}</b>
                    ) : (
                      <span className="text-muted-foreground">non détecté dans les fiches de paie</span>
                    )}
                  </p>
                  <p>
                    <span className="text-muted-foreground">E-mail employé (notifications)&nbsp;:</span>{" "}
                    <b>{detail.employeEmail || "non renseigné"}</b>
                    {detail.employeEmail && detail.employeEmailSourceLibelle ? (
                      <span className="text-muted-foreground"> — {detail.employeEmailSourceLibelle}</span>
                    ) : null}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Envoyée à&nbsp;:</span>{" "}
                    <b>{detail.destinataire || "—"}</b>
                  </p>
                </div>

                {/* (NOUVEAU v0.2.50) signalement d'une incohérence nom / prénom
                    entre la saisie de l'employé et les fiches de paie du même
                    CIN — détectée automatiquement à la création de la demande
                    et signalée au service RH dans l'e-mail de la demande. */}
                {typeof detail.donnees?.anomalieNom === "string" && detail.donnees.anomalieNom && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                    <p className="text-xs font-semibold text-amber-800 mb-1 flex items-center gap-1.5">
                      ⚠ Incohérence nom / prénom détectée automatiquement
                    </p>
                    <p className="text-sm text-amber-900 whitespace-pre-line">
                      {String(detail.donnees.anomalieNom)}
                    </p>
                    <p className="text-xs text-amber-800/90 mt-1.5">
                      Vérifiez l&apos;identité de l&apos;employé avant de délivrer le
                      document demandé (la référence des fiches de paie fait foi).
                    </p>
                  </div>
                )}

                {/* ================= (NOUVEAU Task 181) VALIDATION À DEUX
                     ÉTAPES MANAGER → RH — les TROIS champs demandés :
                     Décision Manager (Acceptée / Refusée / En attente),
                     Décision RH (Acceptée / Refusée / En attente) et Statut
                     final, avec traçabilité (date, acteur, formulation ou
                     commentaire). Le manager décide normalement en répondant
                     par e-mail à la demande (reconnaissance Task 178) ; les
                     boutons « Enregistrer la décision du manager » sont le
                     repli opérationnel (v0.2.195 : repli RÉSERVÉ au
                     superadministrateur — la carte « Décision Manager » est
                     masquée pour le rôle RH). Matrice appliquée : Manager + RH
                     acceptent → « Acceptée » ; manager refuse → « Refusée
                     par le Manager » (immédiat, définitif) ; RH refuse après
                     le manager → « Refusée par les RH ». */}
                {detail.deuxEtapes && (
                  <div className="rounded-md border p-3 space-y-2">
                    <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Validation à deux étapes — Manager &rarr; RH
                    </p>

                    {/* ---- DÉCISION MANAGER ---- (v0.2.195 : carte MASQUÉE
                        pour le rôle RH — l'enregistrement manuel de la décision
                        du manager est réservé au SUPERADMIN ; une note discrète
                        remplace la carte et l'état de la décision reste
                        consultable dans la section « Décision RH ».) */}
                    {estRh ? (
                      <p className="text-[11px] text-muted-foreground pl-1">
                        Décision du manager&nbsp;: enregistrée par sa réponse
                        e-mail (ou par le superadministrateur) — son état est
                        affiché dans la section «&nbsp;Décision RH&nbsp;»
                        ci-dessous.
                      </p>
                    ) : (
                      <div className="rounded border bg-slate-50/60 px-2.5 py-2 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <UserCheck className="h-3.5 w-3.5 text-slate-500" />
                          <span className="text-xs font-semibold w-36">Décision Manager</span>
                          <Badge variant="outline" className={classeDecision(detail.decisionManager)}>
                            {detail.decisionManagerLibelle ?? libelleDecision(detail.decisionManager)}
                          </Badge>
                          {detail.decisionManagerLe && (
                            <span className="text-[11px] text-muted-foreground">
                              {fmtDate(detail.decisionManagerLe)}
                              {detail.decisionManagerPar ? ` — ${detail.decisionManagerPar}` : ""}
                            </span>
                          )}
                        </div>
                        {detail.decisionManagerNote && (
                          <p className="text-[11px] text-muted-foreground pl-6 break-words">
                            {detail.decisionManagerNote}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5 pl-6">
                          <span className="text-[10px] text-muted-foreground mr-0.5">
                            Enregistrer la décision du manager&nbsp;:
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 py-0 text-[11px] border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                            onClick={() => traiter("ACCEPTEE", "manager")}
                            disabled={
                              traitement ||
                              detail.statut === "ACCEPTEE" ||
                              detail.statut === "VALIDEE" ||
                              detail.statut === "REFUSEE" ||
                              detail.decisionManager === "ACCEPTEE"
                            }
                          >
                            {traitement && <Loader2 className="h-3 w-3 animate-spin" />}
                            Acceptée
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 py-0 text-[11px] border-red-300 text-red-700 hover:bg-red-50"
                            onClick={() => traiter("REFUSEE", "manager")}
                            disabled={
                              traitement ||
                              detail.statut === "ACCEPTEE" ||
                              detail.statut === "VALIDEE" ||
                              detail.statut === "REFUSEE" ||
                              detail.decisionManager === "REFUSEE"
                            }
                          >
                            Refusée
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* ---- DÉCISION RH ---- */}
                    <div className="rounded border bg-slate-50/60 px-2.5 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <UserCheck className="h-3.5 w-3.5 text-slate-500" />
                        <span className="text-xs font-semibold w-36">Décision RH</span>
                        <Badge variant="outline" className={classeDecision(detail.decisionRh)}>
                          {detail.decisionRhLibelle ?? libelleDecision(detail.decisionRh)}
                        </Badge>
                        {detail.decisionRhLe && (
                          <span className="text-[11px] text-muted-foreground">
                            {fmtDate(detail.decisionRhLe)}
                            {detail.decisionRhPar ? ` — ${detail.decisionRhPar}` : ""}
                          </span>
                        )}
                      </div>
                      {/* (NOUVEAU v0.2.151 — parité RH) formulation reconnue
                          dans la réponse e-mail des RH, conservée et affichée
                          comme pour la décision du manager. */}
                      {detail.decisionRhNote && (
                        <p className="text-[11px] text-muted-foreground pl-6 break-words">
                          {detail.decisionRhNote}
                        </p>
                      )}
                      {/* (NOUVEAU Task 199) la décision RH se rend DANS la
                          section dédiée — cette ligne reste l'état affiché. */}
                      <p className="text-[11px] text-emerald-700 pl-6">
                        → Rendez ou modifiez la décision RH dans la section
                        &laquo;&nbsp;Décision RH&nbsp;&raquo; ci-dessous.
                      </p>
                    </div>

                    {/* ---- STATUT FINAL ---- */}
                    <div className="rounded border bg-slate-50/60 px-2.5 py-2 flex flex-wrap items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5 text-slate-500" />
                      <span className="text-xs font-semibold w-36">Statut final</span>
                      <Badge variant="outline" className={classeStatut(detail.statut)}>
                        {detail.statutFinalLibelle ?? detail.statutLibelle}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Matrice appliquée&nbsp;: Manager + RH acceptent &rarr; «&nbsp;Acceptée&nbsp;» ;
                      le manager refuse &rarr; «&nbsp;Refusée par le Manager&nbsp;» (décision immédiate,
                      aucune transmission aux RH) ; les RH refusent après le manager &rarr;
                      «&nbsp;Refusée par les RH&nbsp;». (v0.2.146) Les RH peuvent aussi répondre
                      par e-mail depuis la boîte du service RH (à la demande ou à la transmission)
                      &nbsp;: «&nbsp;Acceptée&nbsp;», «&nbsp;Je valide&nbsp;», «&nbsp;D&apos;accord&nbsp;» pour accepter —
                      «&nbsp;Refusée&nbsp;», «&nbsp;Je refuse&nbsp;», «&nbsp;NON&nbsp;» pour refuser — la décision est
                      enregistrée automatiquement. (v0.2.151) MÊME reconnaissance
                      que pour le manager (toutes les formulations d&apos;acceptation et
                      de refus, négations comprises) ; quand la demande a été adressée
                      DIRECTEMENT au service RH (aucun manager responsable affecté),
                      sa réponse vaut décision unique et achève la validation.
                    </p>
                  </div>
                )}

                {/* ================= (NOUVEAU Task 199 — v0.2.154) SECTION
                     « DÉCISION RH » — dédiée au service RH pour CHAQUE demande,
                     en UN SEUL endroit : (1) CONSULTATION des informations
                     complètes de la demande (identification de l'employé,
                     données du formulaire déplacées ici) ; (2) TRAITEMENT
                     DIRECT depuis l'interface d'administration — Accepter /
                     Refuser / Information requise, avec commentaire facultatif
                     joint à l'e-mail de notification. Le traitement utilise le
                     MÊME flux serveur que les boutons historiques
                     (POST /api/demandes/[id], cible « rh ») : pour les demandes
                     à deux étapes, la matrice Manager × RH est respectée
                     (l'acceptation RH reste « En attente » tant que le manager
                     n'a pas accepté ; le refus RH est immédiat et définitif). */}
                {(() => {
                  const finale =
                    detail.statut === "ACCEPTEE" ||
                    detail.statut === "VALIDEE" ||
                    detail.statut === "REFUSEE";
                  const desactive =
                    traitement ||
                    Boolean(
                      detail.deuxEtapes && finale
                    );
                  return (
                    <div className="rounded-md border-2 border-emerald-200 bg-emerald-50/40 p-3 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-emerald-600" />
                        <span className="text-sm font-semibold text-emerald-800">Décision RH</span>
                        <Badge variant="outline" className={classeStatut(detail.statut)}>
                          {detail.statutFinalLibelle ?? detail.statutLibelle}
                        </Badge>
                        {detail.traiteLe && (
                          <span className="text-[11px] text-muted-foreground">
                            décision enregistrée le {fmtDate(detail.traiteLe)}
                            {detail.traitePar ? ` par ${detail.traitePar}` : ""}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Le service RH consulte les informations complètes de la demande et
                        rend sa décision directement depuis l&apos;interface d&apos;administration —
                        le statut est mis à jour immédiatement et l&apos;employé est notifié par
                        e-mail (échec SMTP non bloquant, trace au journal d&apos;envoi).
                      </p>

                      {/* ---- ÉTAT ACTUEL : décisions d'étape + statut final ---- */}
                      <div className="rounded border border-emerald-200 bg-white px-2.5 py-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                        {detail.deuxEtapes && (
                          <>
                            <span className="text-[11px] font-medium text-muted-foreground">Décision Manager&nbsp;:</span>
                            <Badge variant="outline" className={classeDecision(detail.decisionManager)}>
                              {detail.decisionManagerLibelle ?? libelleDecision(detail.decisionManager)}
                            </Badge>
                          </>
                        )}
                        <span className="text-[11px] font-medium text-muted-foreground">Décision RH&nbsp;:</span>
                        <Badge variant="outline" className={classeDecision(detail.decisionRh)}>
                          {detail.decisionRhLibelle ?? libelleDecision(detail.decisionRh)}
                        </Badge>
                        <span className="text-[11px] font-medium text-muted-foreground">Statut final&nbsp;:</span>
                        <Badge variant="outline" className={classeStatut(detail.statut)}>
                          {detail.statutFinalLibelle ?? detail.statutLibelle}
                        </Badge>
                      </div>

                      {/* ---- CONSULTATION : informations complètes de la demande ---- */}
                      <div className="rounded border bg-white p-3 space-y-2">
                        <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                          <ClipboardList className="h-3.5 w-3.5" />
                          Consultation de la demande — informations complètes
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <p className="break-all">
                            <span className="text-muted-foreground">Référence&nbsp;:</span>{" "}
                            <b className="font-mono">{detail.reference}</b>
                          </p>
                          <p className="break-all">
                            <span className="text-muted-foreground">Type&nbsp;:</span> <b>{detail.typeLibelle}</b>
                          </p>
                          <p className="break-all">
                            <span className="text-muted-foreground">Employé (CIN)&nbsp;:</span>{" "}
                            <b className="font-mono">{detail.cinMasque}</b>
                          </p>
                          <p className="break-all">
                            <span className="text-muted-foreground">Matricule&nbsp;:</span>{" "}
                            <b className="font-mono">{detail.matricule || "—"}</b>
                          </p>
                          <p className="break-all sm:col-span-2">
                            <span className="text-muted-foreground">E-mail employé (notifications)&nbsp;:</span>{" "}
                            <b>{detail.employeEmail || "non renseigné"}</b>
                            {detail.employeEmail && detail.employeEmailSourceLibelle ? (
                              <span className="text-muted-foreground"> — {detail.employeEmailSourceLibelle}</span>
                            ) : null}
                          </p>
                          <p className="break-all sm:col-span-2">
                            <span className="text-muted-foreground">Adressée à&nbsp;:</span>{" "}
                            <b>{detail.destinataire || "—"}</b>
                          </p>
                          <p className="break-all">
                            <span className="text-muted-foreground">Créée le&nbsp;:</span> {fmtDate(detail.createdAt)}
                          </p>
                          <p className="break-all">
                            <span className="text-muted-foreground">Traitée le&nbsp;:</span>{" "}
                            {detail.traiteLe
                              ? fmtDate(detail.traiteLe) + (detail.traitePar ? ` par ${detail.traitePar}` : "")
                              : "—"}
                          </p>
                        </div>
                        {/* (Task 199) données complètes du formulaire — déplacées
                            ici depuis le haut du dialogue pour que TOUT ce dont
                            le RH a besoin pour décider tienne dans la section. */}
                        {detail.infos.length > 0 && (
                          <div className="pt-1">
                            <p className="text-[11px] font-medium text-muted-foreground mb-1">
                              Informations saisies par l&apos;employé
                            </p>
                            <table className="w-full text-sm">
                              <tbody>
                                {detail.infos.map(([l, v]) => (
                                  <tr key={l}>
                                    <td className="py-0.5 pr-3 align-top text-muted-foreground whitespace-nowrap">
                                      {l}
                                    </td>
                                    <td className="py-0.5 font-medium break-all">{v || "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {/* ---- COMMENTAIRE RH (déplacé ici — Task 199, même état
                          « commentaire » que le flux historique : joint à
                          l'e-mail de notification à l'employé) ---- */}
                      <div className="space-y-1.5">
                        <Label htmlFor="dem-commentaire-rh">
                          Commentaire RH (facultatif — joint à l&apos;e-mail de notification à l&apos;employé)
                        </Label>
                        <Textarea
                          id="dem-commentaire-rh"
                          rows={3}
                          placeholder="Ex. : motif de la décision, pièce à fournir, information complémentaire…"
                          value={commentaire}
                          onChange={(e) => setCommentaire(e.target.value)}
                        />
                      </div>

                      {/* ---- ACTIONS : la RH décide directement ici ---- */}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={() => traiter("ACCEPTEE")}
                          disabled={desactive}
                        >
                          {traitement && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                          <FileCheck2 className="h-4 w-4 mr-1" />
                          Accepter la demande
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => traiter("REFUSEE")}
                          disabled={desactive}
                        >
                          {traitement && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                          <FileX2 className="h-4 w-4 mr-1" />
                          Refuser la demande
                        </Button>
                        <Button
                          variant="outline"
                          className="border-amber-300 text-amber-700 hover:bg-amber-50"
                          onClick={() => traiter("INFORMATION_REQUISE")}
                          disabled={desactive}
                        >
                          {traitement && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                          Information requise
                        </Button>
                      </div>

                      {/* ---- RÈGLES APPLIQUÉES (rappel contextuel) ---- */}
                      <p className="text-[11px] text-muted-foreground">
                        {detail.deuxEtapes
                          ? "Validation à deux étapes (congé, autorisation de sortie) : l'acceptation RH reste « En attente » tant que le manager n'a pas lui-même accepté — le statut final (« Acceptée ») est posé à la seconde acceptation ; le refus RH est immédiat et définitif (« Refusée par les RH »). Le manager décide normalement par e-mail ; sa décision peut aussi être enregistrée depuis l'encadré « Validation à deux étapes » ci-dessus."
                          : "Décision immédiate : le statut est posé sans étape supplémentaire et l'employé est notifié de la réponse (document signé joint le cas échéant)."}
                      </p>
                    </div>
                  );
                })()}

                {/* ================= (NOUVEAU Task 180) RÉPONSE & DOCUMENTS
                     DE LA DÉCISION — consultation directe depuis la gestion
                     des demandes, avec DISTINCTION CLAIRE entre : la réponse
                     en cas d'acceptation ; la réponse en cas de refus ; les
                     pièces jointes associées à la réponse ; le statut final
                     (Acceptée / Refusée) ; le document généré à la suite de
                     la décision — l'historique complet reste conservé. */}
                {(() => {
                  const documents = detail.documents ?? [];
                  const piecesJointes = documents.filter((x) => !x.auto);
                  const anciensGeneres = documents.filter((x) => x.auto && !x.courant);
                  const statutAccepte =
                    detail.statut === "ACCEPTEE" || detail.statut === "VALIDEE";
                  const statutRefuse = detail.statut === "REFUSEE";
                  const montreAcceptation =
                    statutAccepte || Boolean(detail.docSigne?.present);
                  const montreRefus = statutRefuse || Boolean(detail.docRefus?.present);
                  const peutGenererAcceptation =
                    (detail.type === "CONGE" || detail.type === "AUTORISATION_SORTIE") &&
                    statutAccepte;
                  if (
                    !montreAcceptation &&
                    !montreRefus &&
                    piecesJointes.length === 0 &&
                    anciensGeneres.length === 0
                  ) {
                    return null;
                  }
                  return (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 pt-1">
                        <FileText className="h-3.5 w-3.5" />
                        Réponse &amp; documents de la décision
                      </p>

                      {/* ---- STATUT FINAL & DÉCISION ---- */}
                      {(statutAccepte || statutRefuse) && (
                        <div
                          className={
                            "rounded-md border p-3 " +
                            (statutAccepte
                              ? "border-emerald-200 bg-emerald-50"
                              : "border-red-200 bg-red-50")
                          }
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            {statutAccepte ? (
                              <FileCheck2 className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <FileX2 className="h-4 w-4 text-red-600" />
                            )}
                            <span
                              className={
                                "text-sm font-semibold " +
                                (statutAccepte ? "text-emerald-800" : "text-red-800")
                              }
                            >
                              Statut final : {detail.statutFinalLibelle ?? detail.statutLibelle}
                            </span>
                          </div>
                          <p
                            className={
                              "text-xs mt-1 " +
                              (statutAccepte ? "text-emerald-700" : "text-red-700")
                            }
                          >
                            {detail.traiteLe
                              ? `Décision rendue le ${fmtDate(detail.traiteLe)}${
                                  detail.traitePar ? ` par ${detail.traitePar}` : ""
                                }.`
                              : "Décision enregistrée."}
                          </p>
                          {detail.commentaire && (
                            <p
                              className={
                                "text-xs mt-1 whitespace-pre-line " +
                                (statutAccepte ? "text-emerald-800" : "text-red-800")
                              }
                            >
                              <b>Motif de la décision :</b> {detail.commentaire}
                            </p>
                          )}
                        </div>
                      )}

                      {/* ---- RÉPONSE EN CAS D'ACCEPTATION (document signé & tamponné) ---- */}
                      {montreAcceptation && (
                        <div className="rounded-md border border-emerald-200 bg-white p-3 space-y-2">
                          <p className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                            <FileSignature className="h-3.5 w-3.5" />
                            Réponse en cas d&apos;acceptation — document signé électroniquement &amp; tamponné
                          </p>
                          {detail.docSigne?.present ? (
                            <div className="text-xs space-y-0.5">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <b className="break-all">{detail.docSigne.nom}</b>
                                <a
                                  className="inline-flex items-center gap-1 font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-900"
                                  target="_blank"
                                  rel="noreferrer"
                                  href={`/api/demandes/${encodeURIComponent(detail.id)}/doc-signe`}
                                >
                                  <Eye className="h-3 w-3" />
                                  Visualiser
                                </a>
                                <a
                                  className="inline-flex items-center gap-1 font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-900"
                                  href={`/api/demandes/${encodeURIComponent(detail.id)}/doc-signe?telecharger=1`}
                                >
                                  <Download className="h-3 w-3" />
                                  Télécharger
                                </a>
                              </div>
                              <p className="text-muted-foreground">
                                Généré le {fmtDate(detail.docSigne.le)}
                                {detail.docSigne.par ? ` (${detail.docSigne.par})` : ""}
                              </p>
                              <p className="text-muted-foreground">
                                {detail.docSigne.envoiLe
                                  ? `Envoyé le ${fmtDate(detail.docSigne.envoiLe)}${
                                      detail.docSigne.destinataires
                                        ? ` — à : ${String(detail.docSigne.destinataires.a || "—")}${
                                            Array.isArray(detail.docSigne.destinataires.cc) &&
                                            (detail.docSigne.destinataires.cc as string[]).length
                                              ? ` — copies : ${(detail.docSigne.destinataires.cc as string[]).join(", ")}`
                                              : ""
                                          }`
                                        : ""
                                    }`
                                  : "Envoi e-mail non effectué."}
                              </p>
                              {detail.docSigne.erreur && (
                                <p className="text-red-700">Dernière erreur d&apos;envoi : {detail.docSigne.erreur}</p>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Pas encore généré : il sera produit automatiquement à
                              l&apos;acceptation (ou générez-le ci-dessous après avoir
                              configuré certificat et tampon).
                            </p>
                          )}
                          {peutGenererAcceptation && (
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                onClick={() => regenererDocSigne(detail)}
                                disabled={docSigneEnCours}
                              >
                                {docSigneEnCours ? (
                                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                ) : (
                                  <FileSignature className="h-3.5 w-3.5 mr-1" />
                                )}
                                {detail.docSigne?.present ? "Régénérer / Renvoyer" : "Générer maintenant"}
                              </Button>
                              {docSigneResultat && (
                                <p className={`text-xs ${docSigneResultat.ok ? "text-emerald-700" : "text-red-700"}`}>
                                  {docSigneResultat.message}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* ---- RÉPONSE EN CAS DE REFUS (document signé & tamponné) ---- */}
                      {montreRefus && (
                        <div className="rounded-md border border-red-200 bg-white p-3 space-y-2">
                          <p className="text-xs font-semibold text-red-800 flex items-center gap-1.5">
                            <FileX2 className="h-3.5 w-3.5" />
                            Réponse en cas de refus — décision signée électroniquement &amp; tamponnée
                          </p>
                          {detail.docRefus?.present ? (
                            <div className="text-xs space-y-0.5">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <b className="break-all">{detail.docRefus.nom}</b>
                                <a
                                  className="inline-flex items-center gap-1 font-semibold text-red-700 underline underline-offset-2 hover:text-red-900"
                                  target="_blank"
                                  rel="noreferrer"
                                  href={`/api/demandes/${encodeURIComponent(detail.id)}/doc-refus`}
                                >
                                  <Eye className="h-3 w-3" />
                                  Visualiser
                                </a>
                                <a
                                  className="inline-flex items-center gap-1 font-semibold text-red-700 underline underline-offset-2 hover:text-red-900"
                                  href={`/api/demandes/${encodeURIComponent(detail.id)}/doc-refus?telecharger=1`}
                                >
                                  <Download className="h-3 w-3" />
                                  Télécharger
                                </a>
                              </div>
                              <p className="text-muted-foreground">
                                Généré le {fmtDate(detail.docRefus.le)}
                                {detail.docRefus.par ? ` (${detail.docRefus.par})` : ""}
                              </p>
                              <p className="text-muted-foreground">
                                {detail.docRefus.envoiLe
                                  ? `Envoyé le ${fmtDate(detail.docRefus.envoiLe)}${
                                      detail.docRefus.destinataires
                                        ? ` — à : ${String(detail.docRefus.destinataires.a || "—")}${
                                            Array.isArray(detail.docRefus.destinataires.cc) &&
                                            (detail.docRefus.destinataires.cc as string[]).length
                                              ? ` — copies : ${(detail.docRefus.destinataires.cc as string[]).join(", ")}`
                                              : ""
                                          }`
                                        : ""
                                    }`
                                  : "Envoi e-mail non effectué."}
                              </p>
                              {detail.docRefus.erreur && (
                                <p className="text-red-700">Dernière erreur d&apos;envoi : {detail.docRefus.erreur}</p>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Pas encore généré : il a dû être produit automatiquement au
                              refus — régénérez-le ci-dessous si nécessaire.
                            </p>
                          )}
                          {statutRefuse && (
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-red-300 text-red-700 hover:bg-red-50"
                                onClick={() => regenererDocRefus(detail)}
                                disabled={docRefusEnCours}
                              >
                                {docRefusEnCours ? (
                                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                ) : (
                                  <FileX2 className="h-3.5 w-3.5 mr-1" />
                                )}
                                {detail.docRefus?.present ? "Régénérer / Renvoyer" : "Générer maintenant"}
                              </Button>
                              {docRefusResultat && (
                                <p className={`text-xs ${docRefusResultat.ok ? "text-emerald-700" : "text-red-700"}`}>
                                  {docRefusResultat.message}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* ---- PIÈCES JOINTES ASSOCIÉES À LA RÉPONSE ---- */}
                      <div className="rounded-md border border-blue-200 bg-blue-50/60 p-3">
                        <p className="text-xs font-semibold text-blue-800 flex items-center gap-1.5 mb-2">
                          <Paperclip className="h-3.5 w-3.5" />
                          Pièces jointes associées à la réponse
                        </p>
                        {piecesJointes.length > 0 ? (
                          <ul className="space-y-1.5">
                            {piecesJointes.map((doc) => (
                              <li key={doc.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                                <span className="font-medium break-all">{doc.nomFichier}</span>
                                <span className="text-xs text-muted-foreground">
                                  {fmtTaille(doc.taille, doc.tailleLisible)}
                                  {doc.recuLe ? ` — reçu le ${fmtDate(doc.recuLe)}` : ""}
                                  {doc.recuDe ? ` — de ${doc.recuDe}` : ""}
                                </span>
                                <a
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900"
                                  target="_blank"
                                  rel="noreferrer"
                                  href={`/api/demandes/${encodeURIComponent(detail.id)}/documents/${encodeURIComponent(doc.id)}`}
                                >
                                  <Eye className="h-3 w-3" />
                                  Visualiser
                                </a>
                                <a
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900"
                                  href={`/api/demandes/${encodeURIComponent(detail.id)}/documents/${encodeURIComponent(doc.id)}?telecharger=1`}
                                >
                                  <Download className="h-3 w-3" />
                                  Télécharger
                                </a>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Aucune pièce jointe associée à la réponse.
                          </p>
                        )}
                      </div>

                      {/* ---- HISTORIQUE : versions antérieures des documents générés ---- */}
                      {anciensGeneres.length > 0 && (
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 mb-2">
                            <History className="h-3.5 w-3.5" />
                            Historique des documents générés (versions antérieures conservées)
                          </p>
                          <ul className="space-y-1.5">
                            {anciensGeneres.map((doc) => (
                              <li key={doc.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                                <span className="font-medium break-all">{doc.nomFichier}</span>
                                <span className="text-xs text-muted-foreground">
                                  {doc.recuDe || "Généré automatiquement"}
                                  {doc.recuLe ? ` — le ${fmtDate(doc.recuLe)}` : ""}
                                </span>
                                <a
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-800"
                                  target="_blank"
                                  rel="noreferrer"
                                  href={`/api/demandes/${encodeURIComponent(detail.id)}/documents/${encodeURIComponent(doc.id)}`}
                                >
                                  <Eye className="h-3 w-3" />
                                  Visualiser
                                </a>
                                <a
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-800"
                                  href={`/api/demandes/${encodeURIComponent(detail.id)}/documents/${encodeURIComponent(doc.id)}?telecharger=1`}
                                >
                                  <Download className="h-3 w-3" />
                                  Télécharger
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ================= (NOUVEAU Task 194) RÉPONSES E-MAIL
                     REÇUES — HISTORIQUE CONSULTABLE : chaque réponse
                     identifiée (manager ou RH) est conservée avec son
                     expéditeur, sa date/heure, son texte ORIGINAL, la
                     décision reconnue (ou l'absence de décision : ambiguë /
                     non reconnue → statut inchangé), ses formulations et ses
                     pièces jointes. Le RH consulte et décide manuellement si
                     nécessaire — sans jamais perdre la trace du message. */}
                {(detail.reponsesRecues ?? []).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 pt-1">
                      <Mail className="h-3.5 w-3.5" />
                      Réponses e-mail reçues ({(detail.reponsesRecues ?? []).length})
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Historique complet des réponses reçues par e-mail pour cette
                      demande — texte original conservé. Une réponse ambiguë ou non
                      reconnue ne change JAMAIS le statut : la demande reste
                      « En attente » jusqu&apos;à une décision explicite. Les
                      pièces jointes transmises avec chaque réponse (manager ou
                      RH) sont enregistrées, associées à la demande et
                      téléchargeables ci-dessous, quel que soit son statut.
                    </p>
                    <ul className="space-y-2">
                      {[...(detail.reponsesRecues ?? [])].reverse().map((rep, i) => (
                        <li
                          key={`${rep.le}-${i}`}
                          className="rounded-md border border-slate-200 bg-white p-3 space-y-1.5"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className={`text-[11px] ${classeDecisionReconnue(rep.decision)}`}
                            >
                              {libelleDecisionReconnue(rep.decision)}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {fmtDate(rep.le)}
                              {rep.role ? ` — ${libelleRoleReponse(rep.role)}` : ""}
                              {rep.de ? ` — de : ${rep.de}` : ""}
                            </span>
                          </div>
                          {rep.sujet && (
                            <p className="text-xs break-all">
                              <b>Sujet :</b> {rep.sujet}
                            </p>
                          )}
                          {rep.formulations.length > 0 && (
                            <p className="text-xs">
                              <b>Formulation(s) reconnue(s) :</b>{" "}
                              {rep.formulations.map((f) => `« ${f} »`).join(", ")}
                            </p>
                          )}
                          {rep.piecesJointes.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground break-all">
                                <b className="text-slate-700">Pièces jointes du message :</b>{" "}
                                {rep.piecesJointes.join(", ")}
                                {rep.piecesJointesImportees.length === 0 &&
                                  rep.piecesJointes.some((n) => n !== "(sans nom)")
                                  ? " — aucune importée (extension non autorisée ou trop volumineuse)"
                                  : ""}
                              </p>
                              {/* (NOUVEAU v0.2.152) liens DIRECTS vers les pièces
                                  jointes importées par CETTE réponse — liées par
                                  identifiant (v0.2.152+) ou, à défaut pour les
                                  entrées antérieures, par nom de fichier. Les
                                  pièces jointes restent consultables et
                                  téléchargeables quel que soit le statut de la
                                  demande (Acceptée, Refusée ou En attente). */}
                              {piecesDeReponse(rep, detail).length > 0 && (
                                <ul className="space-y-1">
                                  {piecesDeReponse(rep, detail).map((doc) => (
                                    <li
                                      key={doc.id}
                                      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                                    >
                                      <Paperclip className="h-3 w-3 shrink-0 text-slate-500" />
                                      <span className="font-medium break-all text-slate-800">
                                        {doc.nomFichier}
                                      </span>
                                      <span className="text-muted-foreground">
                                        {fmtTaille(doc.taille, doc.tailleLisible)}
                                        {doc.recuLe ? ` — reçu le ${fmtDate(doc.recuLe)}` : ""}
                                      </span>
                                      <a
                                        className="inline-flex items-center gap-1 font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900"
                                        target="_blank"
                                        rel="noreferrer"
                                        href={`/api/demandes/${encodeURIComponent(detail.id)}/documents/${encodeURIComponent(doc.id)}`}
                                      >
                                        <Eye className="h-3 w-3" />
                                        Visualiser
                                      </a>
                                      <a
                                        className="inline-flex items-center gap-1 font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900"
                                        href={`/api/demandes/${encodeURIComponent(detail.id)}/documents/${encodeURIComponent(doc.id)}?telecharger=1`}
                                      >
                                        <Download className="h-3 w-3" />
                                        Télécharger
                                      </a>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                          {(rep.statutAvant || rep.statutApres) && (
                            <p className="text-xs text-muted-foreground">
                              <b>Statut :</b> {rep.statutAvant || "—"} → {rep.statutApres || "—"}
                            </p>
                          )}
                          {rep.texte && (
                            <details className="group rounded border border-slate-200 bg-slate-50">
                              <summary className="cursor-pointer select-none px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                                Consulter le texte original de la réponse
                              </summary>
                              <pre className="mx-2 mb-2 whitespace-pre-wrap break-words text-xs text-slate-800 font-sans max-h-72 overflow-y-auto">
                                {rep.texte}
                              </pre>
                            </details>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* -------- (NOUVEAU v0.2.88) ACCÈS AUX RÉPONSES VIA QR CODE + URL --------
                     Le QR « Réponse en ligne » encode l'adresse PUBLIQUE de
                     vérification de cette réponse (même principe que le QR
                     « Fiche en ligne » des fiches de paie) : le scan ouvre la
                     page publique /verification/reponse (sans connexion, jeton
                     signé) qui atteste l'authenticité et ouvre les documents. */}
                {detail.urlVerification && (
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
                    <p className="text-xs font-semibold text-blue-800 mb-1">
                      Accès à la réponse par QR Code / URL (vérification publique)
                    </p>
                    <p className="text-xs text-blue-700 mb-2">
                      Imprimez ou partagez ce QR / lien : le scan ouvre la page publique de
                      vérification (sans connexion) qui atteste l&apos;authenticité de la
                      réponse et ouvre ses documents.
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      {qrVerificationUrl && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={qrVerificationUrl}
                          alt="QR code de vérification de la réponse"
                          className="h-24 w-24 rounded border border-blue-200 bg-white"
                        />
                      )}
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <a
                          href={detail.urlVerification}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block break-all text-xs font-medium text-blue-800 underline underline-offset-2"
                        >
                          {detail.urlVerification}
                        </a>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            try {
                              void navigator.clipboard.writeText(detail.urlVerification ?? "");
                              setNotification({
                                type: "succes",
                                texte: "URL de vérification copiée dans le presse-papiers.",
                              });
                            } catch {
                              // presse-papiers indisponible (ancien navigateur)
                            }
                          }}
                        >
                          Copier l&apos;URL
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* -------- (NOUVEAU v0.2.51) RÉPONDRE AVEC UN DOCUMENT IMPORTÉ --------
                     Le RH importe le document de réponse : tampon signature/QR
                     automatique (configuration globale) ou manuel (réglages de
                     CE document), APERÇU avant validation, puis validation =
                     stockage chiffré + statut Acceptée + notification e-mail ;
                     l'employé voit le document dans « Mes demandes » du portail. */}
                <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 space-y-2.5">
                  <p className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                    <Paperclip className="h-3.5 w-3.5" />
                    Répondre avec un document (import direct)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Importez le document de réponse (PDF, Word, image — 15&nbsp;Mo max)&nbsp;:
                    une signature électronique et un code QR peuvent être apposés
                    automatiquement ou manuellement, le document est prévisualisé, puis
                    validé et envoyé — l&apos;employé le reçoit dans son portail
                    (rubrique «&nbsp;Mes demandes&nbsp;»).
                  </p>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                    disabled={reponseEnCours}
                    onChange={(e) => {
                      setFichierReponse(e.target.files && e.target.files[0] ? e.target.files[0] : null);
                      setApercuUrl(null);
                      setApercuNote(null);
                      setReponseResultat(null);
                    }}
                    className="text-xs file:mr-3 file:rounded-md file:border-0 file:bg-emerald-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-emerald-700"
                    aria-label="Document de réponse"
                  />

                  {/* ---- (NOUVEAU v0.2.110) DÉCISION explicite de la réponse ----
                       Le statut de la demande reflète la décision choisie
                       (Acceptée / Refusée) ; la pièce jointe reste affichée
                       et accessible EN PLUS du statut. « Aucune » conserve le
                       comportement historique (document seul = Acceptée si
                       En attente / Information requise). */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                    <span className="font-medium text-emerald-900">Décision&nbsp;:</span>
                    {([["AUCUNE", "Aucune (document seul)"], ["ACCEPTEE", "Acceptée"], ["REFUSEE", "Refusée"]] as const).map(
                      ([v, l]) => (
                        <label key={v} className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="decision-reponse"
                            value={v}
                            checked={decisionReponse === v}
                            onChange={() => setDecisionReponse(v)}
                            disabled={reponseEnCours}
                          />
                          {l}
                        </label>
                      )
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Avec « Acceptée » ou « Refusée », le statut de la demande affiche la décision (jamais « En attente »)
                    et la pièce jointe reste visible et téléchargeable dans le détail et le portail de l&apos;employé.
                  </p>

                  {/* ---- Tampon : automatique / manuel / aucun ---- */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                    <span className="font-medium text-emerald-900">Signature électronique &amp; QR&nbsp;:</span>
                    {([["auto", "Automatique (configuration Demandes / Réponses)"], ["manuel", "Manuel"], ["aucun", "Sans tampon"]] as const).map(
                      ([v, l]) => (
                        <label key={v} className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="mode-tampon"
                            value={v}
                            checked={modeTampon === v}
                            onChange={() => setModeTampon(v)}
                            disabled={reponseEnCours}
                          />
                          {l}
                        </label>
                      )
                    )}
                  </div>

                  {modeTampon === "auto" && (
                    <p className="text-xs text-muted-foreground">
                      {cfgSignature
                        ? cfgSignature.tamponActif
                          ? "Le tampon de la configuration « Demandes / Réponses » sera appliqué : signature " +
                            (cfgSignature.sigActif ? (cfgSignature.aImage ? "(image + " : "(") : "") +
                            (cfgSignature.sigActif && !cfgSignature.aImage ? "texte" : "") +
                            (cfgSignature.sigActif ? ")" : "") +
                            (cfgSignature.qrActif ? ", QR code" : "") +
                            (cfgSignature.mentionActif ? ", mention légale" : "") +
                            ". Configuration PROPRE aux réponses (v0.2.93) — modifiable dans le panneau « Configuration des réponses » en haut de l'onglet."
                          : "Le tampon automatique des réponses est désactivé ou sans élément actif — configurez-le dans le panneau « Configuration des réponses » en haut de l'onglet, ou utilisez le mode Manuel. L'aperçu vous alertera si rien ne peut être apposé."
                        : "Chargement de la configuration des réponses…"}
                    </p>
                  )}

                  {modeTampon === "manuel" && (
                    <div className="rounded-md border bg-white p-2.5 space-y-2 text-xs">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={optsMan.sigActif}
                          onChange={(e) => setOptsMan({ ...optsMan, sigActif: e.target.checked })}
                          id="rep-sig-actif"
                        />
                        <label htmlFor="rep-sig-actif" className="font-medium cursor-pointer">
                          Signature électronique (image/texte de la configuration globale)
                        </label>
                      </div>
                      {optsMan.sigActif && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pl-6">
                          <label className="space-y-0.5">
                            <span className="text-muted-foreground">Position</span>
                            <Select
                              value={optsMan.sigPosition}
                              onValueChange={(v) => setOptsMan({ ...optsMan, sigPosition: v })}
                            >
                              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="BAS_DROITE">Bas droite</SelectItem>
                                <SelectItem value="BAS_GAUCHE">Bas gauche</SelectItem>
                                <SelectItem value="HAUT_DROITE">Haut droite</SelectItem>
                                <SelectItem value="HAUT_GAUCHE">Haut gauche</SelectItem>
                              </SelectContent>
                            </Select>
                          </label>
                          <label className="space-y-0.5">
                            <span className="text-muted-foreground">Taille (40–1200)</span>
                            <Input
                              type="number" min={40} max={1200} className="h-7 text-xs"
                              value={optsMan.sigTaille}
                              onChange={(e) => setOptsMan({ ...optsMan, sigTaille: Number(e.target.value) || 120 })}
                            />
                          </label>
                          <label className="space-y-0.5">
                            <span className="text-muted-foreground">Rotation ° (0–360, horaire)</span>
                            <Input
                              type="number" min={0} max={360} className="h-7 text-xs"
                              value={optsMan.sigRotation}
                              onChange={(e) => setOptsMan({ ...optsMan, sigRotation: Number(e.target.value) || 0 })}
                            />
                          </label>
                          <label className="space-y-0.5">
                            <span className="text-muted-foreground">Opacité (0,3–1)</span>
                            <Input
                              type="number" min={0.3} max={1} step={0.05} className="h-7 text-xs"
                              value={optsMan.sigOpacite}
                              onChange={(e) => setOptsMan({ ...optsMan, sigOpacite: Number(e.target.value) || 0.9 })}
                            />
                          </label>
                          <label className="space-y-0.5">
                            <span className="text-muted-foreground">Ligne de texte (option)</span>
                            <Input
                              type="text" className="h-7 text-xs" placeholder="Ex. : Le Directeur des RH"
                              value={optsMan.sigTexte}
                              onChange={(e) => setOptsMan({ ...optsMan, sigTexte: e.target.value })}
                            />
                          </label>
                          {/* (NOUVEAU v0.2.92) DÉPLACEMENT LIBRE : décalages fins ±1500 pt */}
                          <label className="space-y-0.5">
                            <span className="text-muted-foreground">Décalage X (−1500 à +1500)</span>
                            <Input
                              type="number" min={-1500} max={1500} className="h-7 text-xs"
                              value={optsMan.sigDecalX}
                              onChange={(e) => setOptsMan({ ...optsMan, sigDecalX: Number(e.target.value) || 0 })}
                            />
                          </label>
                          <label className="space-y-0.5">
                            <span className="text-muted-foreground">Décalage Y (−1500 à +1500)</span>
                            <Input
                              type="number" min={-1500} max={1500} className="h-7 text-xs"
                              value={optsMan.sigDecalY}
                              onChange={(e) => setOptsMan({ ...optsMan, sigDecalY: Number(e.target.value) || 0 })}
                            />
                          </label>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={optsMan.qrActif}
                          onChange={(e) => setOptsMan({ ...optsMan, qrActif: e.target.checked })}
                          id="rep-qr-actif"
                        />
                        <label htmlFor="rep-qr-actif" className="font-medium cursor-pointer">
                          Code QR (référence, type, employé, empreinte de contrôle)
                        </label>
                      </div>
                      {optsMan.qrActif && (
                        <div className="grid grid-cols-2 gap-2 pl-6">
                          <label className="space-y-0.5">
                            <span className="text-muted-foreground">Position</span>
                            <Select
                              value={optsMan.qrPosition}
                              onValueChange={(v) => setOptsMan({ ...optsMan, qrPosition: v })}
                            >
                              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="BAS_GAUCHE">Bas gauche</SelectItem>
                                <SelectItem value="BAS_DROITE">Bas droite</SelectItem>
                                <SelectItem value="HAUT_GAUCHE">Haut gauche</SelectItem>
                                <SelectItem value="HAUT_DROITE">Haut droite</SelectItem>
                              </SelectContent>
                            </Select>
                          </label>
                          <label className="space-y-0.5">
                            <span className="text-muted-foreground">Taille (40–1200)</span>
                            <Input
                              type="number" min={40} max={1200} className="h-7 text-xs"
                              value={optsMan.qrTaille}
                              onChange={(e) => setOptsMan({ ...optsMan, qrTaille: Number(e.target.value) || 110 })}
                            />
                          </label>
                          <label className="space-y-0.5">
                            <span className="text-muted-foreground">Rotation ° (0–360, horaire)</span>
                            <Input
                              type="number" min={0} max={360} className="h-7 text-xs"
                              value={optsMan.qrRotation}
                              onChange={(e) => setOptsMan({ ...optsMan, qrRotation: Number(e.target.value) || 0 })}
                            />
                          </label>
                          {/* (NOUVEAU v0.2.92) DÉPLACEMENT LIBRE : décalages fins ±1500 pt */}
                          <label className="space-y-0.5">
                            <span className="text-muted-foreground">Décalage X (−1500 à +1500)</span>
                            <Input
                              type="number" min={-1500} max={1500} className="h-7 text-xs"
                              value={optsMan.qrDecalX}
                              onChange={(e) => setOptsMan({ ...optsMan, qrDecalX: Number(e.target.value) || 0 })}
                            />
                          </label>
                          <label className="space-y-0.5">
                            <span className="text-muted-foreground">Décalage Y (−1500 à +1500)</span>
                            <Input
                              type="number" min={-1500} max={1500} className="h-7 text-xs"
                              value={optsMan.qrDecalY}
                              onChange={(e) => setOptsMan({ ...optsMan, qrDecalY: Number(e.target.value) || 0 })}
                            />
                          </label>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={optsMan.mentionActif}
                          onChange={(e) => setOptsMan({ ...optsMan, mentionActif: e.target.checked })}
                          id="rep-mention-actif"
                        />
                        <label htmlFor="rep-mention-actif" className="font-medium cursor-pointer">
                          Mention légale datée
                        </label>
                      </div>
                      {optsMan.mentionActif && (
                        <Input
                          type="text" className="h-7 text-xs pl-6"
                          value={optsMan.mentionTexte}
                          onChange={(e) => setOptsMan({ ...optsMan, mentionTexte: e.target.value })}
                          placeholder="Document signé électroniquement — AutoRH — {DATE}"
                        />
                      )}
                      {/* ---- (NOUVEAU v0.2.92) CASE À COCHER + POSITIONNEMENT du
                          CERTIFICAT de signature électronique — comme pour le QR
                          et la signature : ON = le bloc certificat est apposé sur
                          CE document ; position, taille et décalages propres. */}
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={optsMan.certActif}
                          onChange={(e) => setOptsMan({ ...optsMan, certActif: e.target.checked })}
                          id="rep-cert-actif"
                        />
                        <label htmlFor="rep-cert-actif" className="font-medium cursor-pointer">
                          Certificat de signature électronique (bloc « Signature électronique certifiée »)
                        </label>
                      </div>
                      {optsMan.certActif && (
                        <div className="grid grid-cols-2 gap-2 pl-6">
                          <label className="space-y-0.5">
                            <span className="text-muted-foreground">Position</span>
                            <Select
                              value={optsMan.certPosition}
                              onValueChange={(v) => setOptsMan({ ...optsMan, certPosition: v })}
                            >
                              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="BAS_CENTRE">Bas centré (au-dessus de la mention)</SelectItem>
                                <SelectItem value="BAS_GAUCHE">Bas gauche</SelectItem>
                                <SelectItem value="BAS_DROITE">Bas droite</SelectItem>
                                <SelectItem value="HAUT_GAUCHE">Haut gauche</SelectItem>
                                <SelectItem value="HAUT_DROITE">Haut droite</SelectItem>
                              </SelectContent>
                            </Select>
                          </label>
                          <label className="space-y-0.5">
                            <span className="text-muted-foreground">Taille du bloc % (50–300)</span>
                            <Input
                              type="number" min={50} max={300} step={5} className="h-7 text-xs"
                              value={optsMan.certTaille}
                              onChange={(e) => setOptsMan({ ...optsMan, certTaille: Number(e.target.value) || 100 })}
                            />
                          </label>
                          <label className="space-y-0.5">
                            <span className="text-muted-foreground">Décalage X (−1500 à +1500)</span>
                            <Input
                              type="number" min={-1500} max={1500} className="h-7 text-xs"
                              value={optsMan.certDecalX}
                              onChange={(e) => setOptsMan({ ...optsMan, certDecalX: Number(e.target.value) || 0 })}
                            />
                          </label>
                          <label className="space-y-0.5">
                            <span className="text-muted-foreground">Décalage Y (−1500 à +1500)</span>
                            <Input
                              type="number" min={-1500} max={1500} className="h-7 text-xs"
                              value={optsMan.certDecalY}
                              onChange={(e) => setOptsMan({ ...optsMan, certDecalY: Number(e.target.value) || 0 })}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ---- APERÇU du document final (tamponné) ---- */}
                  {apercuUrl && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-emerald-900">
                        Aperçu du document final{apercuMime.startsWith("image/") ? "" : " (première page — faites défiler)"}
                      </p>
                      {apercuMime.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={apercuUrl} alt="Aperçu du document" className="max-h-80 rounded border bg-white" />
                      ) : (
                        <iframe src={apercuUrl} title="Aperçu du document" className="w-full h-80 rounded border bg-white" />
                      )}
                    </div>
                  )}
                  {apercuNote && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                      {apercuNote}
                    </p>
                  )}
                  {reponseResultat && (
                    <div className="text-xs rounded-md border border-emerald-300 bg-emerald-50 p-2 space-y-0.5">
                      <p>
                        Document <b>{String(reponseResultat.document ? (reponseResultat.document as { nomFichier?: string }).nomFichier : "")}</b>{" "}
                        transmis ({String(reponseResultat.document ? (reponseResultat.document as { tailleLisible?: string }).tailleLisible : "")})
                        {reponseResultat.tamponApplique ? " — tamponné" : ""} — statut&nbsp;:{" "}
                        <b>{String(reponseResultat.statutLibelle ?? "")}</b>.
                      </p>
                      {reponseResultat.notification ? (
                        (reponseResultat.notification as { envoye?: boolean }).envoye ? (
                          <p>
                            E-mail « votre document est disponible » envoyé à{" "}
                            <b>{String((reponseResultat.notification as { destinataire?: string }).destinataire)}</b>.
                          </p>
                        ) : (
                          <p className="text-amber-700">
                            Notification e-mail non envoyée :{" "}
                            {String((reponseResultat.notification as { erreur?: string; note?: string }).erreur ??
                              (reponseResultat.notification as { note?: string }).note ??
                              "voir le journal d'envoi")}
                          </p>
                        )
                      ) : null}
                      <p className="text-muted-foreground">
                        L&apos;employé retrouve ce document dans « Mes demandes » de son portail (Visualiser / Télécharger).
                      </p>
                    </div>
                  )}

                  {/* ---- (NOUVEAU v0.2.112) CERTIFICAT DE SIGNATURE ÉLECTRONIQUE :
                       import DIRECT dans la réponse (réponse au demande) —
                       certificat seul quand la clé est déjà dans le système
                       (appariement vérifié), coffre .p12/.pfx (certificat +
                       clé privée), clé privée séparée .pem/.key/.der. ---- */}
                  <div className="rounded-md border bg-white p-2.5 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-emerald-900">
                        Certificat de signature électronique
                        {certRepInfo?.sujet ? (
                          <span className="font-normal text-muted-foreground"> — {certRepInfo.sujet}</span>
                        ) : null}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[11px] border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        onClick={() => setCertRepOuvert((o) => !o)}
                        disabled={reponseEnCours}
                      >
                        {certRepOuvert
                          ? "Masquer"
                          : certRepInfo?.fichierNom
                            ? "Remplacer / ajouter la clé privée"
                            : "Importer un certificat"}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {certRepInfo?.fichierNom
                        ? "Certificat importé : " + certRepInfo.fichierNom + " — clé privée " +
                          (certRepInfo.cleDisponible
                            ? "DISPONIBLE dans le système"
                            : "non disponible (importez-la ci-dessous si nécessaire)") +
                          (certRepInfo.cleNom ? " — " + certRepInfo.cleNom : "") + "."
                        : "Aucun certificat importé : le bloc « Signature électronique certifiée » ne peut pas être apposé sur la réponse. Importez ici un certificat électronique (et sa clé privée si nécessaire)."}
                    </p>
                    {certRepOuvert && (
                      <div className="space-y-2">
                        <input
                          type="file"
                          accept=".p12,.pfx,.pkcs7,.p7b,.p7c,.p7s,.p7m,.xml,.ps7x,.pem,.cer,.crt,.der"
                          disabled={certRepEnCours}
                          onChange={(e) => setCertRepFichier(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
                          className="text-xs file:mr-3 file:rounded-md file:border-0 file:bg-emerald-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-emerald-700"
                          aria-label="Fichier de certificat électronique"
                        />
                        {certRepFichier && /\.(p12|pfx)$/i.test(certRepFichier.name) && (
                          <Input
                            type="password"
                            value={certRepMdp}
                            onChange={(e) => setCertRepMdp(e.target.value)}
                            className="h-7 text-xs"
                            autoComplete="off"
                            placeholder="Mot de passe du fichier PKCS#12 (.p12/.pfx)"
                            disabled={certRepEnCours}
                          />
                        )}
                        <input
                          type="file"
                          accept=".pem,.key,.der"
                          disabled={certRepEnCours}
                          onChange={(e) => setCertRepCle(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
                          className="text-xs file:mr-3 file:rounded-md file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-300"
                          aria-label="Clé privée associée (facultative — .pem, .key, .der)"
                        />
                        {certRepCle && (
                          <Input
                            type="password"
                            value={certRepCleMdp}
                            onChange={(e) => setCertRepCleMdp(e.target.value)}
                            className="h-7 text-xs"
                            autoComplete="off"
                            placeholder="Mot de passe de la clé privée (si le fichier est protégé)"
                            disabled={certRepEnCours}
                          />
                        )}
                        <p className="text-[11px] text-muted-foreground">
                          Certificat SEUL (.cer/.crt/.pem…) accepté quand la clé privée est déjà
                          disponible dans le système (appariement vérifié par le serveur) ;
                          coffre .p12/.pfx = certificat AVEC sa clé privée ; formats de clé :
                          PKCS#8 ou PKCS#1, clair ou chiffré. Fichiers stockés CHIFFRÉS.
                        </p>
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={importerCertificatReponse}
                          disabled={certRepEnCours || !certRepFichier}
                        >
                          {certRepEnCours && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Enregistrer le certificat
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                      onClick={() => envoyerReponse("apercu")}
                      disabled={!fichierReponse || reponseEnCours}
                    >
                      {reponseEnCours && <Loader2 className="h-4 w-4 animate-spin" />}
                      Aperçu du document
                    </Button>
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Valider et envoyer ce document à l'employé ?\n\nLe document (avec le tampon choisi) sera stocké chiffré, joint à la demande " +
                              "(statut « Acceptée » si elle est encore ouverte) et notifié à l'employé."
                          )
                        ) {
                          envoyerReponse("valider");
                        }
                      }}
                      disabled={!fichierReponse || reponseEnCours}
                    >
                      {reponseEnCours && <Loader2 className="h-4 w-4 animate-spin" />}
                      Valider et envoyer à l&apos;employé
                    </Button>
                  </div>
                </div>

                {/* (Task 199) le commentaire RH a été DÉPLACÉ dans la section
                    « Décision RH » (même état partagé) — plus de champ dupliqué
                    en pied de dialogue. */}

                {notification && (
                  <div
                    className={
                      "rounded-md border p-3 text-xs space-y-1 " +
                      (notification.envoye
                        ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                        : "bg-amber-50 border-amber-200 text-amber-800")
                    }
                  >
                    {notification.envoye ? (
                      <p>
                        E-mail de notification envoyé à <b>{String(notification.destinataire)}</b>
                        {notification.sourceLibelle ? (
                          <span className="opacity-80"> — {String(notification.sourceLibelle)}</span>
                        ) : null}
                        .
                      </p>
                    ) : notification.absenceEmail ? (
                      <p>{String(notification.note ?? "Aucune adresse e-mail de notification.")}</p>
                    ) : (
                      <p>
                        Échec de l&apos;e-mail de notification (statut ENREGISTRÉ)&nbsp;:{" "}
                        <b>{String(notification.erreur ?? "erreur inconnue")}</b>
                        <br />
                        Trace complète dans le journal d&apos;envoi.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* (MODIFIÉ Task 199) les boutons de décision (Accepter /
                  Refuser / Information requise) ont été DÉPLACÉS dans la
                  section dédiée « Décision RH » du détail — le pied de
                  dialogue ne conserve que la fermeture. */}
              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="outline" onClick={() => setDetail(null)}>
                  Fermer
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* -------- Journal d'envoi (IT) -------- */}
      <Dialog open={journalOuvert} onOpenChange={setJournalOuvert}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-emerald-600" />
              Journal d&apos;envoi des e-mails
            </DialogTitle>
            <DialogDescription>
              300 dernières tentatives (toutes familles d&apos;e-mails) — succès
              et erreurs avec la réponse SMTP exacte. Aucun secret n&apos;y figure.
            </DialogDescription>
          </DialogHeader>
          {/* MODIFIÉ (Task 123) : overflow-x-auto pour le journal (mobile).
              (MODIFIÉ — demande utilisateur, point 9 : poignées de redimensionnement) */}
          <div ref={refTableauJournal} className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Destinataire</TableHead>
                  <TableHead>Résultat</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {journal.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      {journalCharge ? "Chargement…" : "Aucun envoi journalisé pour le moment."}
                    </TableCell>
                  </TableRow>
                )}
                {journal.map((e, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs whitespace-nowrap">{fmtDate(e.horodatage)}</TableCell>
                    <TableCell className="text-xs">
                      {LIBELLE_ACTION_JOURNAL[e.action] ?? e.action}
                      {e.reference ? (
                        <span className="block font-mono text-[10px] text-muted-foreground">
                          {e.reference}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs break-all">{e.dest}</TableCell>
                    <TableCell className="text-xs">
                      {e.succes ? (
                        <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">
                          Succès
                        </Badge>
                      ) : (
                        <div className="space-y-0.5">
                          <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">
                            Erreur
                          </Badge>
                          <p className="text-red-700 break-all">{e.erreur ?? "erreur inconnue"}</p>
                          {e.reponseSmtp ? (
                            <p className="text-muted-foreground break-all">SMTP : {e.reponseSmtp}</p>
                          ) : null}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={chargeJournal} disabled={journalCharge}>
              <RefreshCw className={"h-4 w-4" + (journalCharge ? " animate-spin" : "")} />
              Actualiser
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
