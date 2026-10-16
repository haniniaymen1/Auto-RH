"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { maskCin } from "@/lib/utils";
// NOUVEAU (v0.2.109) : découpage automatique « Nom » / « Prénom » depuis le
// nom complet des fiches (fonction pure, règles utilisateur — premier mot =
// Nom, mots suivants = Prénom, composés « Ben »/« Bel »/« Bou » ensemble). Utilisé
// pour les replis d'affichage des accès historiques (nomPrenom combiné).
import { separerNomPrenom } from "@/lib/nom-employe";
// (NOUVEAU Task 92) libellé du champ destinataire de la popup « Send Mail »
import { Label } from "@/components/ui/label";
// (MODIFIÉ Task 13) panneau « Envoi d'e-mails (SMTP) » — rendu UNIQUEMENT pour
// IT/SUPERADMIN : le RH n'utilise que l'envoi d'e-mails, jamais la configuration
import { MailPanel } from "@/components/payslip/mail-panel";
// (NOUVEAU — demande utilisateur) poignées de redimensionnement des colonnes
import { utiliserColonnesRedimensionnables } from "@/components/payslip/colonnes-redimensionnables";
// (MODIFIÉ Task 77) Les composants et icônes de l'ancienne barre de création
// (recherche en popover, sélecteur dialogué, actualisation manuelle) sont
// RETIRÉS avec la barre elle-même.
import {
  ShieldCheck,
  ShieldOff,
  Trash2,
  KeyRound,
  LockOpen,
  UserPlus,
  // NOUVEAU (v0.2.133) : bouton « Manager » du tableau (fenêtre dédiée).
  UserCheck,
  Copy,
  Clock,
  QrCode,
  RefreshCw,
  Mail,
  Send,
  Loader2,
  // NOUVEAU (Task 173) : édition du nom et prénom dans le tableau.
  Pencil,
} from "lucide-react";

interface AccessRow {
  id: string;
  cin: string;
  isActive: boolean;
  hasPassword: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: string | null;
  failedAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  // NOUVEAU (Task 80) état QR — booléens SEULEMENT, jamais le secret :
  qrPresente: boolean; // le portail a DÉJÀ affiché la page « uniquement le QR »
  hasQrSecret: boolean; // un secret TOTP persistant existe en base
  // NOUVEAU (Task 86) fenêtre du QR d'inscription EXPIRÉE (non inscrit,
  // otpFenetreCreeA dépassé) — le QR scanné est mort, un nouveau sera
  // affiché à la prochaine connexion :
  qrFenetreExpiree: boolean;
  // NOUVEAU (Task 92) état « Send Mail » :
  aMotDePasseInitial: boolean; // mot de passe initial ENCORE valable (copie chiffrée présente)
  mailEnvoyeA: string | null; // dernier destinataire de l'e-mail « Send Mail »
  mailEnvoyeLe: string | null; // date du dernier envoi
  // NOUVEAU (v0.2.91) : e-mail de NOTIFICATION de l'employé (Task 116) —
  // désormais visible et MODIFIABLE par le RH/superadministrateur (crayon
  // de la colonne « E-mail d'accès »). null = pas encore renseignée.
  email: string | null;
  // NOUVEAU (Task 173) : nom et prénom mémorisés sur l'accès (modifiable
  // par le RH — colonne « Nom et prénom ») ; null = repli sur le nom des
  // fiches du même CIN.
  nomPrenom: string | null;
  // NOUVEAU (v0.2.106 — demande utilisateur, point 2) : nom et prénom
  // SÉPARÉS (colonnes « Nom » / « Prénom »). null = non défini (accès
  // historiques : la colonne « Nom » replie sur nomPrenom côté interface).
  nom: string | null;
  prenom: string | null;
  // NOUVEAU (v0.2.107) : matricule MANUEL posé par le RH (crayon de la
  // colonne « Matricule »). null = repli sur l'auto-association (matricule
  // de la fiche la plus récente du CIN — /api/payslips/employes).
  matricule: string | null;
  // NOUVEAU (v0.2.131 — demande utilisateur) : désignation MANAGER de
  // l'employé (case à cocher de la fenêtre « Mot de passe initial — CIN »),
  // son MANAGER RESPONSABLE (autre accès coché « Manager ») et le nom
  // d'affichage de ce responsable (résolu par l'API). null = aucun.
  isManager: boolean;
  managerId: string | null;
  managerNom: string | null;
  createdAt: string;
}

interface InitialPasswordResult {
  access?: {
    id: string;
    cin: string;
    isActive: boolean;
    // NOUVEAU (v0.2.131) : état de la désignation Manager de l'accès
    // (fourni par les actions « create » ET « reset » — la fenêtre ouvre
    // ainsi les cases sur l'état ACTUEL, utile après une réinitialisation).
    isManager?: boolean;
    managerId?: string | null;
  };
  cin?: string;
  initialPassword: string;
  message: string;
}

/** NOUVEAU (Task 80) QR code renvoyé par les actions « qr » / « reset-qr ». */
interface QrData {
  cin: string;
  svg: string; // QR code SVG (rendu côté serveur — format standard otpauth://)
  payload: string; // URI otpauth://totp/… encodée dans le QR
  reset?: boolean; // true = QR VENANT d'être réinitialisé (nouveau secret)
}

/**
 * MODIFIÉ (Task 13) — configuration SMTP lue à l'ouverture de la popup
 * « Envoyer l'e-mail » (le mot de passe n'est jamais renvoyé) :
 *  - le RH ne reçoit QUE le booléen « configuree » (aucun détail du serveur) ;
 *  - les détails (hôte, port, SSL/TLS, compte) ne sont envoyés qu'à
 *    IT/SUPERADMIN — d'où les champs optionnels ci-dessous.
 */
interface ConfigMailLue {
  configuree: boolean;
  host?: string; // IT/SUPERADMIN uniquement
  port?: number; // IT/SUPERADMIN uniquement
  secure?: boolean; // IT/SUPERADMIN uniquement
  username?: string | null; // IT/SUPERADMIN uniquement
}

/** Aperçu de ce qui vient d'être envoyé par e-mail — e-mail ALLÉGÉ :
 *  uniquement le mot de passe initial + l'adresse d'accès au portail
 *  (le CIN, le serveur et le port ne sont plus envoyés). */
interface ApercuMail {
  motDePasse: string;
  portailUrl: string;
}

/**
 * (Task 65) Employé détecté dans les fiches importées — sert au remplissage
 * automatique du champ CIN (l'administrateur SÉLECTIONNE au lieu de taper).
 */
interface EmployeItem {
  cin: string; // forme normalisée (valeur exacte passée à « Créer l'accès »)
  cinAffiche: string; // forme détectée dans la fiche (affichée telle quelle)
  // MODIFIÉ (v0.2.109) : PREMIER MOT du nom le plus récent (ou composé
  // « Ben »/« Bel » — règles de découpage src/lib/nom-employe.ts) — la
  // colonne « Nom » ne porte PLUS le nom complet.
  nom: string | null;
  // NOUVEAU (v0.2.109) : MOTS SUIVANTS (colonne « Prénom ») — rempli
  // AUTOMATIQUEMENT à partir des fiches de paie. null si aucun.
  prenom: string | null;
  // NOUVEAU (v0.2.109) : chaîne d'ORIGINE non découpée (ex. « Saidani
  // Mohamed Amine ») — utilisée pour la recherche et les replis.
  nomComplet: string | null;
  // NOUVEAU (v0.2.107) : matricule AUTO-ASSOCIÉ depuis les fiches de paie
  // du CIN (fiche la plus récente qui en porte un). null si aucun.
  matricule: string | null;
  fiches: number; // nombre de fiches liées à ce CIN
}

/**
 * (Task 71) Ligne du tableau PRÉ-REMPLI : soit un employé détecté dans les
 * fiches (accès portail déjà créé ou pas encore), soit un accès créé à la
 * main dont le CIN n'apparaît dans aucune fiche.
 */
interface LigneTableau {
  cle: string; // préfixe detecte: / acces: + identifiant (clé React unique)
  cin: string; // forme normalisée (valeur exacte pour « Créer l'accès »)
  cinAffiche: string; // forme détectée si connue, sinon forme stockée
  nom: string | null; // nom d'employé associé (null si non détecté)
  // MODIFIÉ (v0.2.109) : prénom SÉPARÉ (colonnes « Nom » / « Prénom ») —
  // rempli AUTOMATIQUEMENT pour les employés détectés (découpage des fiches
  // de paie — règles v0.2.109 : premier mot = Nom, mots suivants = Prénom,
  // composés « Ben »/« Bel » ensemble) ; replis : nomPrenom des accès
  // historiques (découpé à l'affichage), « — » si rien.
  prenom: string | null;
  // NOUVEAU (v0.2.107) : matricule de l'employé — valeur MANUELLE de l'accès
  // (prioritaire) ou matricule auto-associé depuis ses fiches de paie.
  matricule: string | null;
  fiches: number; // nombre de fiches importées (0 si accès non détecté)
  access: AccessRow | null; // accès existant, ou null = ACCÈS À CRÉER
}

/**
 * MODIFIÉ (Task 64) — Onglet « Accès portail (mot de passe) ».
 * La connexion au portail se fait par CIN + MOT DE PASSE (plus d'application
 * authenticator) :
 *  1. « Créer l'accès » génère un MOT DE PASSE INITIAL affiché UNE SEULE fois ;
 *  2. l'employé est OBLIGÉ de choisir son propre mot de passe à sa première
 *     connexion (le mot de passe initial devient inutilisable) ;
 *  3. TOUS LES 15 JOURS, le portail oblige l'employé à changer son mot de passe ;
 *  4. « Réinitialiser » regénère un mot de passe initial à usage unique
 *     (mot de passe oublié, accès ancien jamais migré, compromission).
 *
 * MODIFIÉ (Task 65) — REMPLISSAGE AUTOMATIQUE du CIN : plus besoin de taper le
 * numéro à la main. Les CIN détectés dans les fiches de paie importées sont
 * chargés depuis GET /api/payslips/employes puis proposés :
 *  - en AUTOCOMPLÉTION dès les premiers caractères saisis (datalist natif) ;
 *  - dans un sélecteur d'employés (recherche par nom ou CIN,
 *    clic sur l'employé = champ CIN rempli automatiquement).
 *
 * MODIFIÉ (Task 70) — REMPLISSAGE 100 % AUTOMATIQUE (demande explicite : le
 * champ doit se remplir TOUT SEUL, sans aucune saisie ni clic obligatoire) :
 *  - au chargement de l'onglet, le premier employé détecté SANS accès portail
 *    est écrit automatiquement dans le champ (useEffect) ;
 *  - après chaque création d'accès, le CIN détecté suivant s'installe tout
 *    seul : enchaîner les créations = cliquer seulement sur « Créer l'accès » ;
 *  - une saisie clavier suspend l'écriture automatique ;
 *  - alerte honnête « X fiches sans CIN identifiable » (nouveaux compteurs
 *    fichesTotal / fichesSansCin de l'API, Task 70).
 *
 * MODIFIÉ (Task 73) — DEMANDE : « enleve la partie rouge et ajoute bouton
 * recherche » (capture annotée : bandeau vert « CIN rempli automatiquement… »
 * + puces CIN encadrés en rouge) :
 *  - le bandeau vert et les PUCES cliquables sont SUPPRIMÉS (la zone sous le
 *    champ redevient sobre : seulement l'alerte fiches sans CIN + le texte
 *    d'aide) ;
 *  - NOUVEAU bouton « Rechercher » (loupe) à côté du champ : popover avec
 *    une recherche par nom ou par CIN, un clic sur un résultat remplit le
 *    champ (le rôle des puces, en compact et sans encombrer la page).
 *
 * MODIFIÉ (Task 71) — LE TABLEAU SE PRÉ-REMPLIT AUSSI TOUT SEUL (demande :
 * « remplissage automatique de la zone rouge » — la liste des accès restait
 * VIDE tant qu'aucun accès n'était créé) :
 *  - le tableau fusionne AUTOMATIQUEMENT tous les employés détectés dans les
 *    fiches importées avec les accès déjà créés (et les accès créés à la
 *    main, non détectés) — zéro ligne fantôme, zéro doublon ;
 *  - chaque employé SANS accès s'affiche avec un badge « Accès non créé » et
 *    un bouton « Créer l'accès » DIRECTEMENT DANS SA LIGNE (desktop + mobile) ;
 *  - tri : les accès à créer d'abord (max fiches, puis alphabétique) ;
 *  - compteurs (à créer / créés / détectés), filtre par nom ou CIN,
 *    défilement avec en-tête figé quand la liste est longue.
 *
 * MODIFIÉ (Task 77) — DEMANDE : « enleve ce qui dans le cadre rouge » (capture
 * annotée : la BARRE DE CRÉATION complète — le champ CIN, ses deux aides au
 * remplissage, le bouton de recherche Task 73, le bouton de création du haut
 * et le bouton d'actualisation — ET la colonne « Employé » du tableau étaient
 * encadrés en rouge) :
 *  - la BARRE DE CRÉATION est SUPPRIMÉE (le champ CIN, l'autocomplétion
 *    native, les deux aides au remplissage, le bouton de recherche Task 73,
 *    le bouton de création du haut et le bouton d'actualisation) : toute la
 *    création passe désormais EXCLUSIVEMENT par le bouton « Créer l'accès »
 *    de chaque ligne du tableau pré-rempli (Task 71), qui transmet le CIN de
 *    la ligne — l'onglet perd son état de saisie (champ, auto-remplissage
 *    Task 70, suspension clavier, sélecteur, recherche) et gagne en sobriété ;
 *  - la COLONNE « Employé » est SUPPRIMÉE du tableau desktop (nom + « Détecté
 *    dans N fiche(s) importée(s) ») ET des cartes mobiles (même information) —
 *    le tableau se concentre sur CIN / Statut / dates / Actions ; le filtre
 *    « par nom ou par CIN » reste opérationnel (le nom reste en données,
 *    il n'est simplement plus affiché) ;
 *  - CONSERVÉ : tableau pré-rempli (Task 71), badge « Accès non créé »,
 *    compteurs, filtre, alerte « fiches sans CIN identifiable » (Task 70),
 *    mot de passe initial affiché une seule fois + Réinitialiser + expiration
 *    15 jours (Task 64/66), aucune régression côté API.
 *
 * NOUVEAU (Task 80) — DEMANDE : « Dans le portail d'administration, ajouter
 * une section dans « Accès Portal » dédiée à la gestion des QR codes » :
 *  - NOUVELLE SECTION « Gestion des QR codes » (deuxième carte du même
 *    onglet) : état QR de chaque accès (QR non généré / QR jamais affiché /
 *    QR affiché — code en attente / Actif), compteurs, filtre par CIN ou
 *    nom d'employé ;
 *  - « Afficher le QR » : ouvre le QR code (format STANDARD otpauth://totp/…,
 *    Task 78) de l'employé pour le faire scanner EN DIRECT avec son
 *    application d'authentification — le secret TOTP persistant est créé à
 *    la volée s'il n'existe pas encore ;
 *  - « Réinitialiser le QR » : nouveau secret TOTP (téléphone perdu/changé,
 *    compromission) — l'ancienne application ne génère plus de codes
 *    valables, le portail re-proposera l'inscription QR (le verrou
 *    qrPresente repasse à false) et le nouveau QR s'affiche aussitôt pour
 *    un re-scan immédiat ;
 *  - la fenêtre /otp du portail employé (première connexion) n'affiche PLUS
 *    QUE le QR code (demande utilisateur associée) — voir
 *    scripts/portail-server.js (otpQrSeulHtml, verrou !lastLoginAt &&
 *    !qrPresente).
 *
 * MODIFIÉ (Task 13) — SÉPARATION RH / CONFIGURATION SMTP (demande : « vérifier
 * que la section RH ne contient aucune configuration de messagerie (SMTP) et
 * qu'elle est uniquement utilisée pour l'envoi des e-mails ») :
 *  - le panneau « Envoi d'e-mails (SMTP) » n'est rendu QUE pour IT/SUPERADMIN
 *    (prop meRole transmise par page.tsx) — la section RH n'a AUCUNE
 *    configuration de messagerie ;
 *  - la popup « Envoyer l'e-mail » reste accessible au RH (c'est l'USAGE du
 *    service d'envoi) : côté serveur, GET /api/mail-config ne renvoie au RH
 *    QUE le booléen « configuree » (aucun hôte/port/compte), et PUT/POST
 *    (enregistrement + e-mail de test) lui sont refusés (403).
 */
export function PortalAccessTab({ meRole = "RH" }: { meRole?: string }) {
  const { toast } = useToast();
  // (Task 13) La CONFIGURATION du serveur d'envoi est réservée à l'informatique :
  // le RH utilise « Envoyer l'e-mail » (envoi), jamais le panneau SMTP.
  const peutConfigurerSmtp = meRole === "IT" || meRole === "SUPERADMIN";
  const [items, setItems] = useState<AccessRow[]>([]);
  const [loading, setLoading] = useState(true);
  // (NOUVEAU — demande utilisateur, point 9) redimensionnement manuel des colonnes
  const refTableauAcces = useRef<HTMLDivElement>(null);
  // (MODIFIÉ — correctif affichage) clé « -v2 » : les largeurs mémorisées
  // par les versions antérieures du tableau (AVANT l'ajout du bouton
  // « Manager » notamment) sont ignorées — elles étaient trop étroites pour
  // les 6 boutons actuels et provoquaient leur débordement sur les colonnes
  // de données. Les planchers data-col-min des <th> prennent le relais.
  utiliserColonnesRedimensionnables(refTableauAcces, "acces-portail-v2", items.length + (loading ? 1 : 0));
  // (MODIFIÉ Task 77) L'état du champ de création a été SUPPRIMÉ avec la
  // barre de création : la création d'un accès passe exclusivement par le
  // bouton « Créer l'accès » de chaque ligne du tableau pré-rempli (Task 71),
  // qui transmet le CIN de la ligne directement à create().
  const [generating, setGenerating] = useState(false);
  const [initial, setInitial] = useState<InitialPasswordResult | null>(null);
  const [toDelete, setToDelete] = useState<AccessRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // (Task 65/71) Répertoire des employés détectés dans les fiches importées —
  // alimente la fusion du tableau pré-rempli et les compteurs.
  const [employes, setEmployes] = useState<EmployeItem[]>([]);
  const [employesLoading, setEmployesLoading] = useState(false);
  // (Task 71) Filtre du tableau pré-rempli (par nom d'employé ou par CIN).
  const [rechercheTableau, setRechercheTableau] = useState("");
  // (Task 70) Diagnostic renvoyé par l'API : fiches sans CIN identifiable.
  const [fichesMeta, setFichesMeta] = useState<{ total: number; sansCin: number } | null>(null);
  // NOUVEAU (Task 80) — SECTION « GESTION DES QR CODES » :
  const [qrDialog, setQrDialog] = useState<QrData | null>(null); // QR affiché (Afficher / Réinitialiser)
  const [qrReset, setQrReset] = useState<AccessRow | null>(null); // confirmation de réinitialisation
  const [rechercheQr, setRechercheQr] = useState(""); // filtre de la section (CIN ou nom)
  const [busyQrId, setBusyQrId] = useState<string | null>(null); // ligne QR occupée
  // NOUVEAU (Task 92) — POPUP « SEND MAIL » :
  const [sendMailRow, setSendMailRow] = useState<AccessRow | null>(null); // ligne concernée
  const [sendMailDest, setSendMailDest] = useState(""); // adresse e-mail du destinataire
  const [sendMailReset, setSendMailReset] = useState(false); // réinitialiser puis envoyer le nouveau mot de passe
  const [sendMailBusy, setSendMailBusy] = useState(false); // envoi en cours
  const [sendMailCfg, setSendMailCfg] = useState<ConfigMailLue | null>(null); // config SMTP (chargée à l'ouverture)
  const [sendMailResult, setSendMailResult] = useState<{ message: string; apercu: ApercuMail } | null>(null);
  // NOUVEAU (Task 173) — ÉDITION DU NOM ET PRÉNOM (colonne du tableau) :
  const [modifNomLigne, setModifNomLigne] = useState<LigneTableau | null>(null); // ligne en cours d'édition
  const [modifNomValeur, setModifNomValeur] = useState(""); // valeur saisie
  const [modifNomEnCours, setModifNomEnCours] = useState(false); // requête en vol
  // NOUVEAU (v0.2.106 — demande utilisateur, point 2) : prénom SÉPARÉ —
  // le dialogue d'édition porte désormais deux champs (Nom + Prénom).
  const [modifPrenomValeur, setModifPrenomValeur] = useState(""); // prénom saisi
  // NOUVEAU (v0.2.107) — édition du MATRICULE de l'employé (même principe
  // que le nom / prénom / e-mail : crayon dans la ligne, dialogue, POST
  // « modifier-matricule » — valeur répercutée dans toutes les fiches).
  const [modifMatriculeLigne, setModifMatriculeLigne] = useState<LigneTableau | null>(null); // ligne en cours d'édition
  const [modifMatriculeValeur, setModifMatriculeValeur] = useState(""); // valeur saisie
  const [modifMatriculeEnCours, setModifMatriculeEnCours] = useState(false); // requête en vol
  // NOUVEAU (v0.2.91) — édition de l'E-MAIL de l'employé (même principe que
  // le nom : crayon dans la ligne, dialogue, POST « modifier-email »).
  const [modifEmailLigne, setModifEmailLigne] = useState<LigneTableau | null>(null); // ligne en cours d'édition
  const [modifEmailValeur, setModifEmailValeur] = useState(""); // adresse saisie
  const [modifEmailEnCours, setModifEmailEnCours] = useState(false); // requête en vol
  // NOUVEAU (v0.2.131 — demande utilisateur) — DÉSIGNATION MANAGER DANS LA
  // FENÊTRE « Mot de passe initial — CIN » : case à cocher « Manager » +
  // liste déroulante « Manager responsable » (enregistrées AUTOMATIQUEMENT
  // à chaque changement — POST « modifier-manager »). La liste déroulante
  // est recalculée depuis `items` APRÈS chaque enregistrement (load()) :
  // elle s'allonge/raccourcit au fur et à mesure que les employés sont
  // cochés/décochés « Manager ».
  const [initEstManager, setInitEstManager] = useState(false); // état coché dans la fenêtre
  const [initManagerResp, setInitManagerResp] = useState(""); // responsable choisi dans la fenêtre
  const [initManagerBusy, setInitManagerBusy] = useState(false); // enregistrement en cours
  // NOUVEAU (v0.2.133 — demande utilisateur) : FENÊTRE DÉDIÉE « Modifier le
  // manager », ouverte par le bouton « Manager » du tableau. Elle permet de
  // changer la désignation Manager / le manager responsable d'un employé
  // EXISTANT SANS réinitialiser son mot de passe (avant v0.2.133, les
  // contrôles Manager n'étaient accessibles qu'au travers de la fenêtre
  // « Mot de passe initial — CIN », elle-même ouverte après « Créer l'accès »
  // ou « Réinitialiser » — deux actions qui GÉNÈRENT un nouveau mot de passe).
  // Le partage des états initEstManager/initManagerResp avec la fenêtre
  // initiale est sûr : les dialogues sont modaux, une seule fenêtre ouverte
  // à la fois.
  const [modifManagerLigne, setModifManagerLigne] = useState<AccessRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/portal-access", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
      }
    } catch {
      // silencieux
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** (Task 65) Charge le répertoire des employés (CIN distincts des fiches importées). */
  const loadEmployes = useCallback(async () => {
    setEmployesLoading(true);
    try {
      const res = await fetch("/api/payslips/employes", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setEmployes(data.items ?? []);
        // (Task 70) Diagnostic honnête : combien de fiches n'ont fourni
        // AUCUN CIN (colonne vide ET toutes les sources sans résultat).
        setFichesMeta({
          total: typeof data.fichesTotal === "number" ? data.fichesTotal : 0,
          sansCin: typeof data.fichesSansCin === "number" ? data.fichesSansCin : 0,
        });
      }
    } catch {
      // silencieux : la saisie manuelle du CIN reste toujours possible
    } finally {
      setEmployesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEmployes();
  }, [loadEmployes]);

  /**
   * (MODIFIÉ Task 77) Le filtre partagé du sélecteur et du popover, les deux
   * mémos de résultats associés et l'index des CIN déjà autorisés ont été
   * SUPPRIMÉS avec la barre de création. Le seul filtre restant est celui du
   * tableau (rechercheTableau, Task 71).
   */

  /** (Task 71) Accès indexés par CIN normalisé (fusion avec le répertoire). */
  const accesParCin = useMemo(() => {
    const m = new Map<string, AccessRow>();
    for (const row of items) m.set(row.cin, row);
    return m;
  }, [items]);

  // NOUVEAU (v0.2.131 — demande utilisateur) : LISTE DÉROULANTE « Manager
  // responsable » de la fenêtre « Mot de passe initial — CIN » — remplie
  // AUTOMATIQUEMENT avec les accès ACTIFS cochés « Manager » (hors l'employé
  // affiché : personne ne peut être son propre responsable). Elle est
  // recalculée à chaque rechargement de la liste (load() est rappelé après
  // chaque enregistrement) : elle se met à jour AU FUR ET À MESURE que les
  // employés sont désignés / retirés comme managers.
  const managersPortail = useMemo(
    () =>
      items.filter(
        (i) =>
          i.isManager &&
          i.isActive &&
          i.id !== initial?.access?.id &&
          // (v0.2.133) hors l'employé affiché dans la fenêtre dédiée
          // « Modifier le manager » : personne ne peut être son propre
          // responsable, quelle que soit la fenêtre ouverte.
          i.id !== modifManagerLigne?.id
      ),
    [items, initial, modifManagerLigne]
  );

  /**
   * (Task 71) TABLEAU PRÉ-REMPLI AUTOMATIQUEMENT — la demande centrale : la
   * liste des accès ne doit plus rester vide tant que des employés détectés
   * attendent leur accès. Fusion SANS DOUBLON :
   *  1. employés détectés SANS accès (à créer) — les plus nombreuses fiches
   *     d'abord, puis ordre alphabétique (même logique que le champ auto) ;
   *  2. lignes AVEC accès créé (ordre de l'API), enrichies du nom et du nombre
   *     de fiches quand l'employé est détecté — couvre aussi les accès créés
   *     à la main (CIN absent des fiches).
   */
  const lignesTableau = useMemo<LigneTableau[]>(() => {
    const lignes: LigneTableau[] = [];
    const sansAcces = employes
      .filter((e) => !accesParCin.has(e.cin))
      .sort((a, b) => b.fiches - a.fiches || a.cin.localeCompare(b.cin));
    for (const e of sansAcces) {
      lignes.push({
        cle: `detecte:${e.cin}`,
        cin: e.cin,
        cinAffiche: e.cinAffiche || e.cin,
        // MODIFIÉ (v0.2.109) : le répertoire renvoie DÉSORMAIS le nom
        // DÉCOUPÉ (règles v0.2.109 appliquées côté API à partir des fiches
        // de paie) — la colonne « Nom » ne porte plus le nom complet et la
        // colonne « Prénom » est remplie AUTOMATIQUEMENT.
        nom: e.nom,
        prenom: e.prenom ?? null,
        // (v0.2.107) matricule auto-associé depuis les fiches de paie.
        matricule: e.matricule ?? null,
        fiches: e.fiches,
        access: null,
      });
    }
    for (const row of items) {
      const e = employes.find((x) => x.cin === row.cin);
      // MODIFIÉ (v0.2.109) : priorité à la valeur MÉMORISÉE de l'accès
      // (correction du RH au crayon — jamais écrasée), puis DÉCOUPAGE
      // AUTOMATIQUE : nomPrenom de l'accès historique, sinon nom complet
      // des fiches du CIN (règles : premier mot = Nom, mots suivants =
      // Prénom, composés « Ben »/« Bel »/« Bou » ensemble).
      const nomCompletSource = row.nomPrenom ?? e?.nomComplet ?? e?.nom ?? null;
      const decoupe = separerNomPrenom(nomCompletSource);
      lignes.push({
        cle: `acces:${row.id}`,
        cin: row.cin,
        cinAffiche: e?.cinAffiche || row.cin,
        nom: row.nom ?? decoupe.nom,
        prenom: row.nom ? row.prenom ?? null : row.prenom ?? decoupe.prenom,
        // (v0.2.107) matricule MANUEL de l'accès (prioritaire), sinon
        // matricule auto-associé depuis les fiches de paie du CIN.
        matricule: row.matricule ?? e?.matricule ?? null,
        fiches: e?.fiches ?? 0,
        access: row,
      });
    }
    return lignes;
  }, [employes, items, accesParCin]);

  /** (Task 71) Filtrage du tableau par nom, prénom ou par CIN. */
  const lignesFiltrees = useMemo(() => {
    const brut = rechercheTableau.trim();
    if (!brut) return lignesTableau;
    const qCin = brut.toUpperCase().replace(/[\s.\/\-]/g, "");
    const qNom = brut.toLowerCase();
    return lignesTableau.filter(
      (l) =>
        l.cin.includes(qCin) ||
        (l.nom ?? "").toLowerCase().includes(qNom) ||
        // NOUVEAU (v0.2.109) : la recherche porte AUSSI sur le prénom
        // (désormais rempli automatiquement depuis les fiches).
        (l.prenom ?? "").toLowerCase().includes(qNom)
    );
  }, [lignesTableau, rechercheTableau]);

  /** (Task 71) Employés détectés qui n'ont PAS encore d'accès portail. */
  const nbRestants = useMemo(
    () => employes.reduce((n, e) => (accesParCin.has(e.cin) ? n : n + 1), 0),
    [employes, accesParCin]
  );

  /**
   * (MODIFIÉ Task 77) Le candidat automatique du champ, l'effet de
   * remplissage silencieux (Task 70) et la sélection d'un employé au clic
   * (Task 65/73) ont été SUPPRIMÉS avec le champ : le tableau pré-rempli
   * (Task 71) est devenu l'unique surface de création — chaque ligne « à
   * créer » porte son propre bouton « Créer l'accès » qui transmet le CIN de
   * la ligne.
   */

  /**
   * Crée (ou recrée) un accès : génère le mot de passe initial, affiché UNE
   * FOIS. (MODIFIÉ Task 77) Le CIN est désormais TOUJOURS passé en argument —
   * il vient de la ligne du tableau cliquée (creerDepuisLigne), plus aucun
   * champ de saisie.
   */
  async function create(valeur: string) {
    const v = valeur.trim();
    if (v.length < 3) {
      toast({
        title: "CIN incomplet",
        description: "Saisissez le numéro CIN complet de l'employé.",
        variant: "destructive",
      });
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/portal-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", cin: v }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        ouvrirInitial(data as InitialPasswordResult);
        // (MODIFIÉ Task 77) Plus de champ à vider : le rechargement de la
        // liste fait passer la ligne cliquée dans le groupe « avec accès ».
        load();
      } else {
        toast({ title: "Création impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  /**
   * NOUVEAU (v0.2.131) Ouvre la fenêtre « Mot de passe initial — CIN » en
   * initialisant les contrôles Manager sur l'état ACTUEL de l'accès
   * (isManager/managerId fournis par les actions « create » et « reset »).
   */
  function ouvrirInitial(data: InitialPasswordResult) {
    setInitial(data);
    setInitEstManager(Boolean(data.access?.isManager));
    setInitManagerResp(data.access?.managerId ?? "");
  }

  /**
   * NOUVEAU (v0.2.131) Enregistre AUTOMATIQUEMENT la désignation Manager
   * (case cochée) et/ou le manager responsable (liste déroulante) de
   * l'accès affiché. (MODIFIÉ v0.2.133) Sert aux DEUX fenêtres : la fenêtre
   * dédiée « Modifier le manager » (modifManagerLigne — bouton « Manager »
   * du tableau, SANS aucune réinitialisation de mot de passe) et la fenêtre
   * « Mot de passe initial — CIN » (initial). Même action serveur
   * « modifier-manager », qui NE TOUCHE JAMAIS au mot de passe. En cas
   * d'échec, les contrôles reviennent à l'état connu de l'accès et l'erreur
   * est affichée.
   */
  async function enregistrerManagerInitial(estManager: boolean, managerRespId: string) {
    // (v0.2.133) L'accès cible dépend de la fenêtre ouverte : fenêtre dédiée
    // d'abord, sinon la fenêtre « Mot de passe initial — CIN ».
    const accesId = modifManagerLigne?.id ?? initial?.access?.id;
    if (!accesId) return;
    setInitManagerBusy(true);
    try {
      const res = await fetch("/api/portal-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "modifier-manager",
          id: accesId,
          isManager: estManager,
          managerId: managerRespId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // Rechargement de la liste : la liste déroulante « Manager
        // responsable » se met à jour AU FUR ET À MESURE (l'employé vient
        // de rejoindre/quitter le pool des managers).
        load();
        // (v0.2.133) Les états « connus » de la fenêtre ouverte sont alignés
        // sur la nouvelle réalité (repli fiable en cas d'échec ultérieur).
        if (modifManagerLigne) {
          setModifManagerLigne({
            ...modifManagerLigne,
            isManager: estManager,
            managerId: managerRespId || null,
          });
        } else if (initial?.access) {
          setInitial({
            ...initial,
            access: { ...initial.access, isManager: estManager, managerId: managerRespId || null },
          });
        }
      } else {
        toast({ title: "Enregistrement impossible", description: data.error, variant: "destructive" });
        retablirEtatManager();
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
      retablirEtatManager();
    } finally {
      setInitManagerBusy(false);
    }
  }

  /**
   * NOUVEAU (v0.2.133) Repli : remet les contrôles Manager sur le dernier
   * état CONNU de l'accès affiché (fenêtre dédiée d'abord, sinon fenêtre
   * « Mot de passe initial — CIN »).
   */
  function retablirEtatManager() {
    if (modifManagerLigne) {
      setInitEstManager(modifManagerLigne.isManager);
      setInitManagerResp(modifManagerLigne.managerId ?? "");
    } else {
      setInitEstManager(Boolean(initial?.access?.isManager));
      setInitManagerResp(initial?.access?.managerId ?? "");
    }
  }

  /**
   * NOUVEAU (v0.2.133) Nom d'affichage d'un accès (Prénom Nom, avec replis
   * nomPrenom combiné puis CIN masqué) — titre de la fenêtre dédiée.
   */
  function nomAfficheAcces(row: AccessRow): string {
    return (
      [row.prenom, row.nom].filter(Boolean).join(" ") ||
      row.nomPrenom ||
      `CIN ${maskCin(row.cin)}`
    );
  }

  /** Réinitialise l'accès : nouveau mot de passe initial à usage unique. */
  async function reset(row: AccessRow) {
    setBusyId(row.id);
    try {
      const res = await fetch("/api/portal-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset", id: row.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        ouvrirInitial(data as InitialPasswordResult);
        load();
      } else {
        toast({ title: "Réinitialisation impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function action(row: AccessRow, act: "toggle" | "unlock" | "delete") {
    setBusyId(row.id);
    try {
      const res = await fetch("/api/portal-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: act, id: row.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (act === "toggle") {
          toast({ title: row.isActive ? "Accès désactivé" : "Accès activé", description: `CIN ${maskCin(row.cin)}` });
        } else if (act === "unlock") {
          toast({ title: "Verrouillage levé", description: `CIN ${maskCin(row.cin)}` });
        } else {
          toast({ title: "Accès supprimé", description: `CIN ${maskCin(row.cin)}` });
        }
        load();
      } else {
        toast({ title: "Action impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  const isLocked = (row: AccessRow) =>
    Boolean(row.lockedUntil && new Date(row.lockedUntil).getTime() > Date.now());

  /**
   * NOUVEAU (Task 173) — ENREGISTREMENT DU NOM ET PRÉNOM : met à jour les
   * DONNÉES DE L'EMPLOYÉ (toutes les fiches de paie du même CIN) et mémorise
   * le nom sur l'accès portail. Le tableau et le filtre par nom sont
   * rechargés pour afficher immédiatement la valeur corrigée.
   */
  async function enregistrerNom() {
    if (!modifNomLigne) return;
    const nom = modifNomValeur.trim().replace(/\s+/g, " ");
    const prenom = modifPrenomValeur.trim().replace(/\s+/g, " ");
    if (nom.length < 2 || nom.length > 80) {
      toast({
        title: "Nom invalide",
        description: "Le nom doit contenir de 2 à 80 caractères.",
        variant: "destructive",
      });
      return;
    }
    if (prenom && (prenom.length < 2 || prenom.length > 80)) {
      toast({
        title: "Prénom invalide",
        description: "Le prénom doit contenir de 2 à 80 caractères (ou être vide).",
        variant: "destructive",
      });
      return;
    }
    setModifNomEnCours(true);
    try {
      const res = await fetch("/api/portal-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "modifier-nom",
          cin: modifNomLigne.cin,
          nom,
          // (v0.2.106) prénom SÉPARÉ — peut être vide (la colonne affiche —)
          prenom,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({
          title: "Nom et prénom mis à jour",
          description:
            data.message ||
            `CIN ${modifNomLigne.cin} — ${data.nomComplet || nom}${data.fichesModifiees ? ` (${data.fichesModifiees} fiche(s) mise(s) à jour)` : ""}`,
        });
        setModifNomLigne(null);
        setModifNomValeur("");
        setModifPrenomValeur("");
        // Rechargement des DEUX sources : le répertoire des employés (noms
        // déduits des fiches — mis à jour) et les accès (nomPrenom).
        await Promise.all([load(), loadEmployes()]);
      } else {
        toast({ title: "Modification impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setModifNomEnCours(false);
    }
  }

  /**
   * NOUVEAU (v0.2.107) — ENREGISTREMENT DU MATRICULE : répercuté dans les
   * DONNÉES DE L'EMPLOYÉ (toutes les fiches de paie du même CIN) et mémorisé
   * sur l'accès portail comme valeur MANUELLE prioritaire (comme le nom, le
   * prénom et l'e-mail). Valeur vide = EFFACEMENT de la valeur manuelle :
   * l'affichage replie sur l'auto-association (fiche la plus récente).
   * Le tableau est rechargé pour afficher immédiatement la valeur corrigée.
   */
  async function enregistrerMatricule() {
    if (!modifMatriculeLigne) return;
    const matricule = modifMatriculeValeur.trim().replace(/\s+/g, " ");
    if (matricule && !/^[A-Za-z0-9][A-Za-z0-9/.\- ]{0,29}$/.test(matricule)) {
      toast({
        title: "Matricule invalide",
        description:
          "Le matricule ne peut contenir que des lettres, chiffres, espaces, tirets, points et barres (1 à 30 caractères).",
        variant: "destructive",
      });
      return;
    }
    setModifMatriculeEnCours(true);
    try {
      const res = await fetch("/api/portal-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "modifier-matricule",
          cin: modifMatriculeLigne.cin,
          matricule,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({
          title: matricule ? "Matricule mis à jour" : "Valeur manuelle effacée",
          description:
            data.message ||
            `CIN ${modifMatriculeLigne.cin} — ${matricule || "repli sur l'auto-association"}`,
        });
        setModifMatriculeLigne(null);
        setModifMatriculeValeur("");
        // Rechargement des DEUX sources : le répertoire des employés
        // (matricules déduits des fiches — mis à jour) et les accès (valeur
        // manuelle).
        await Promise.all([load(), loadEmployes()]);
      } else {
        toast({ title: "Modification impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setModifMatriculeEnCours(false);
    }
  }

  /** NOUVEAU (v0.2.91) — enregistre l'E-MAIL de l'employé (colonne
   *  « E-mail d'accès ») : POST { action: "modifier-email", cin, email }.
   *  L'adresse est enregistrée CHIFFRÉE sur l'accès portail ; elle reçoit
   *  les notifications de ses demandes et pré-remplit « Envoyer l'e-mail ».
   *  La liste est rechargée pour afficher immédiatement la valeur corrigée. */
  async function enregistrerEmail() {
    if (!modifEmailLigne) return;
    const email = modifEmailValeur.trim().toLowerCase();
    if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
      toast({
        title: "E-mail invalide",
        description: "Saisissez une adresse e-mail valide (ex. prenom.nom@entreprise.tn).",
        variant: "destructive",
      });
      return;
    }
    setModifEmailEnCours(true);
    try {
      const res = await fetch("/api/portal-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "modifier-email", cin: modifEmailLigne.cin, email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({
          title: "E-mail de l'employé mis à jour",
          description: data.message || `CIN ${modifEmailLigne.cin} — ${email}`,
        });
        setModifEmailLigne(null);
        setModifEmailValeur("");
        await load();
      } else {
        toast({ title: "Modification impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setModifEmailEnCours(false);
    }
  }

  // =====================================================================
  // NOUVEAU (Task 80) — SECTION « GESTION DES QR CODES »
  // =====================================================================

  /** Statut QR d'un accès (badge de la section) — jamais le secret, seulement
   *  l'état : non généré / jamais affiché / affiché en attente / EXPIRÉ (Task
   *  86 : fenêtre du secret d'inscription dépassée — le QR scanné est mort) /
   *  actif. */
  function statutQr(row: AccessRow): { label: string; cls: string } {
    if (!row.hasQrSecret)
      return {
        label: "QR non généré",
        cls: "border-slate-300 bg-slate-50 text-slate-600",
      };
    if (row.lastLoginAt)
      return {
        label: "Actif",
        cls: "border-emerald-300 bg-emerald-50 text-emerald-700",
      };
    // NOUVEAU (Task 86) : QR d'inscription dont la fenêtre de 10 minutes est
    // dépassée — le secret encodé est DÉFINITIVEMENT inutilisable ; un NOUVEAU
    // QR (nouveau secret) sera affiché à la prochaine connexion du portail.
    if (row.qrFenetreExpiree)
      return {
        label: "QR expiré — nouveau QR à la prochaine connexion",
        cls: "border-orange-300 bg-orange-50 text-orange-700",
      };
    if (row.qrPresente)
      return {
        label: "QR affiché — code en attente",
        cls: "border-sky-300 bg-sky-50 text-sky-700",
      };
    return {
      label: "QR jamais affiché",
      cls: "border-amber-300 bg-amber-50 text-amber-700",
    };
  }

  /** Accès triés pour la section QR : les non-actifs d'abord (à traiter),
   *  puis par CIN ; filtrés par CIN ou nom d'employé. */
  const itemsQr = useMemo(() => {
    const brut = rechercheQr.trim();
    // MODIFIÉ (v0.2.109) : la recherche QR porte sur le nom COMPLET (chaîne
    // d'origine des fiches) — map « CIN → nom complet ».
    const nomParCin = new Map(
      employes.map((e) => [e.cin, e.nomComplet ?? e.nom ?? ""])
    );
    const liste = brut
      ? items.filter((r) => {
          const qCin = brut.toUpperCase().replace(/[\s.\/\-]/g, "");
          const qNom = brut.toLowerCase();
          return (
            r.cin.includes(qCin) || (nomParCin.get(r.cin) ?? "").toLowerCase().includes(qNom)
          );
        })
      : items;
    const rang = (r: AccessRow) =>
      !r.hasQrSecret ? 0 : !r.lastLoginAt ? 1 : 2; // à inscrire d'abord
    return [...liste].sort(
      (a, b) => rang(a) - rang(b) || a.cin.localeCompare(b.cin)
    );
  }, [items, rechercheQr, employes]);

  /** Compteurs de la section QR. */
  const qrMeta = useMemo(() => {
    const generes = items.filter((r) => r.hasQrSecret).length;
    const actifs = items.filter((r) => r.hasQrSecret && r.lastLoginAt).length;
    // NOUVEAU (Task 86) : fenêtres d'inscription dépassées (QR mort).
    const expires = items.filter((r) => r.qrFenetreExpiree).length;
    return {
      total: items.length,
      generes,
      actifs,
      attente: generes - actifs,
      expires,
    };
  }, [items]);

  /** Affiche le QR de l'employé (dialog) — le secret persistant est créé à
   *  la volée côté API s'il n'existe pas encore. */
  async function afficherQr(row: AccessRow) {
    setBusyQrId(row.id);
    try {
      const res = await fetch("/api/portal-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "qr", id: row.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.svg) {
        setQrDialog({ cin: data.cin ?? row.cin, svg: data.svg, payload: data.payload });
      } else {
        toast({ title: "QR indisponible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setBusyQrId(null);
    }
  }

  /** Réinitialise le QR : NOUVEAU secret (l'ancienne application cesse de
   *  fonctionner), verrou d'affichage réarmé, nouveau QR affiché aussitôt. */
  async function reinitialiserQr(row: AccessRow) {
    setBusyQrId(row.id);
    try {
      const res = await fetch("/api/portal-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-qr", id: row.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.svg) {
        setQrDialog({
          cin: data.cin ?? row.cin,
          svg: data.svg,
          payload: data.payload,
          reset: true,
        });
        toast({
          title: "QR code réinitialisé",
          description: `CIN ${maskCin(row.cin)} — l'ancienne application ne génère plus de codes valables.`,
        });
        load();
      } else {
        toast({ title: "Réinitialisation impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setBusyQrId(null);
    }
  }

  /** (Task 71) Crée l'accès DEPUIS une ligne du tableau pré-rempli : le CIN
   * de la ligne est passé tel quel, l'état occupé est isolé par clé de ligne. */
  async function creerDepuisLigne(ligne: LigneTableau) {
    setBusyId(ligne.cle);
    try {
      await create(ligne.cin);
    } finally {
      setBusyId(null);
    }
  }

  // =====================================================================
  // NOUVEAU (Task 92) — POPUP « SEND MAIL » (un bouton par ligne)
  // =====================================================================

  /** Ouvre la popup « Envoyer l'e-mail » : relit l'état du service d'envoi et
   *  remet l'état à zéro (relu à CHAQUE ouverture — IT/SUPERADMIN reçoivent la
   *  configuration complète, le RH uniquement l'état « configuré ou pas »,
   *  Task 13 ; les changements faits dans le panneau SMTP sont pris en compte). */
  async function ouvrirSendMail(row: AccessRow) {
    setSendMailRow(row);
    // (MODIFIÉ v0.2.91 — demande utilisateur) le destinataire est PRÉ-REMPLI
    // avec l'e-mail de l'EMPLOYÉ (modifiable par le RH — crayon de la colonne
    // « E-mail d'accès »), sinon la dernière adresse utilisée pour cet accès :
    // un renvoi part vers l'adresse à jour de l'employé.
    setSendMailDest(row.email ?? row.mailEnvoyeA ?? "");
    setSendMailReset(false);
    setSendMailResult(null);
    setSendMailCfg(null);
    try {
      const res = await fetch("/api/mail-config", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setSendMailCfg(data.config ?? null);
      } else {
        setSendMailCfg(null);
      }
    } catch {
      setSendMailCfg(null);
    }
  }

  /** Envoie l'e-mail d'accès (CIN + mot de passe initial + serveur + port +
   *  adresse du portail) au destinataire saisi. En cas de 409
   *  MOT_DE_PASSE_INDISPONIBLE, propose automatiquement la case
   *  « Réinitialiser puis envoyer ». */
  async function envoyerSendMail() {
    if (!sendMailRow) return;
    setSendMailBusy(true);
    try {
      const res = await fetch("/api/portal-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send-mail",
          id: sendMailRow.id,
          dest: sendMailDest,
          reset: sendMailReset,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setSendMailResult({ message: data.message, apercu: data.apercu });
        load(); // rafraîchit la traçabilité (mailEnvoyeA / mailEnvoyeLe)
      } else if (data.code === "MOT_DE_PASSE_INDISPONIBLE") {
        // Le mot de passe initial n'existe plus : la case de réinitialisation
        // apparaît, pré-cochée, avec l'explication du serveur.
        setSendMailReset(true);
        toast({
          title: "Mot de passe initial indisponible",
          description: data.error,
          variant: "destructive",
        });
      } else {
        toast({ title: "Envoi impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setSendMailBusy(false);
    }
  }

  return (
    <>
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-emerald-600" />
          Accès portail par mot de passe
        </CardTitle>
        <CardDescription>
          Autorisez un employé à consulter ses fiches sur le portail : créez son accès, un{" "}
          <b>mot de passe initial</b> est généré et affiché une seule fois — communiquez-le à
          l&apos;employé. À sa première connexion, il est <b>obligé</b> de choisir son propre mot
          de passe. Par sécurité, son mot de passe <b>expire tous les 15 jours</b> : le portail
          lui demandera alors d&apos;en choisir un nouveau. En cas d&apos;oubli, utilisez
          «&nbsp;Réinitialiser&nbsp;».
        </CardDescription>
        {/* (MODIFIÉ Task 77) SUPPRESSION demandée (« enleve ce qui dans le
            cadre rouge » — capture annotée) : la BARRE DE CRÉATION complète
            (le champ CIN, ses deux aides au remplissage, le bouton de
            recherche Task 73, le bouton de création du haut et le bouton
            d'actualisation) a été RETIRÉE, ainsi que l'autocomplétion native
            et le paragraphe d'aide qui décrivait ce champ. La création d'un
            accès passe exclusivement par le bouton « Créer l'accès » de
            chaque ligne du tableau pré-rempli (Task 71) ci-dessous. */}
        {/* (Task 70) Diagnostic honnête : fiches pour lesquelles AUCUN CIN n'a
            pu être détecté automatiquement (colonne vide + scan sans résultat). */}
        {fichesMeta && fichesMeta.sansCin > 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 mt-2">
            Attention : {fichesMeta.sansCin} fiche{fichesMeta.sansCin > 1 ? "s" : ""} sur{" "}
            {fichesMeta.total} n&apos;a fourni aucun CIN identifiable (colonne CIN vide et
            contenu non reconnaissable).{" "}
            {fichesMeta.sansCin === fichesMeta.total
              ? "Aucun remplissage automatique n'est possible tant que ces fiches ne sont pas réimportées dans un format lisible."
              : "Les autres fiches alimentent normalement le remplissage automatique."}
          </p>
        )}
        {/* (MODIFIÉ Task 77) L'autocomplétion native (Task 65) et le
            paragraphe d'aide du champ sont SUPPRIMÉS avec le champ — les
            compteurs et le filtre au-dessus du tableau guident désormais
            l'administrateur. */}
      </CardHeader>
      <CardContent>
        {/* (Task 71) COMPTEURS + FILTRE du tableau pré-rempli */}
        {lignesTableau.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
            <p className="text-xs text-muted-foreground flex-1">
              <b className="text-foreground">{nbRestants}</b> accès à créer ·{" "}
              <b className="text-foreground">{items.length}</b> accès créé
              {items.length > 1 ? "s" : ""} ·{" "}
              <b className="text-foreground">{employes.length}</b> employé
              {employes.length > 1 ? "s" : ""} détecté
              {employes.length > 1 ? "s" : ""} dans les fiches importées — le
              tableau est pré-rempli tout seul : cliquez sur
              &nbsp;«&nbsp;Créer l&apos;accès&nbsp;» dans la ligne de
              l&apos;employé concerné.
            </p>
            {lignesTableau.length > 8 && (
              <Input
                placeholder="Filtrer le tableau par nom ou par CIN…"
                value={rechercheTableau}
                onChange={(e) => setRechercheTableau(e.target.value)}
                className="sm:max-w-xs h-8 text-xs"
                autoComplete="off"
              />
            )}
          </div>
        )}
        {/* Tableau desktop — (MODIFIÉ Task 71) PRÉ-REMPLI AUTOMATIQUEMENT :
            tous les employés détectés (avec ou sans accès) + les accès créés
            à la main. Les accès à créer s'affichent en premier. */}
        {/* (MODIFIÉ — demande utilisateur, point 9) poignées de redimensionnement */}
        {/* (MODIFIÉ — correctif affichage « Accès portail ») :
            - overscroll-x-contain : le défilement horizontal ne se propage
              plus à la page une fois le bord atteint (défilement fluide) ;
            - table-fixed + <colgroup> : largeurs de DÉPART garanties dès le
              premier paint, aucun écrasement ni déformation des colonnes ; le
              total (~1 780 px) dépasse volontairement les écrans étroits → le
              conteneur défile horizontalement au lieu de comprimer le tableau ;
            - chaque <th> porte data-col-min : plancher infranchissable (ni
              par les largeurs restaurées, ni par le glissement des poignées). */}
        <div ref={refTableauAcces} className="hidden md:block rounded-md border overflow-x-auto overflow-y-auto overscroll-x-contain max-h-[480px]">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col style={{ width: 130 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 250 }} />
              <col style={{ width: 180 }} />
              <col style={{ width: 180 }} />
              <col style={{ width: 180 }} />
              <col style={{ width: 400 }} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="border-b bg-white text-left">
                <th data-col-min={110} className="px-3 py-2 font-medium bg-muted/85 whitespace-nowrap">CIN</th>
                {/* (MODIFIÉ v0.2.106 — demande utilisateur, point 2) : la
                    colonne « Nom et prénom » (Task 173) devient DEUX colonnes
                    distinctes « Nom » / « Prénom », affichées séparément pour
                    chaque employé ; le crayon de la colonne « Nom » ouvre le
                    dialogue à deux champs (la correction est répercutée dans
                    les données de l'employé — toutes ses fiches de paie). */}
                <th data-col-min={130} className="px-3 py-2 font-medium bg-muted/85 whitespace-nowrap">Nom</th>
                <th data-col-min={130} className="px-3 py-2 font-medium bg-muted/85 whitespace-nowrap">Prénom</th>
                {/* CORRECTIF (v0.2.109 — demande utilisateur) : l'en-tête
                    « Matricule » était MANQUANT depuis la v0.2.107 — le corps
                    du tableau porte 9 cellules mais l'en-tête 8 colonnes :
                    les matricules s'affichaient SOUS « E-mail d'accès » et
                    toutes les colonnes suivantes étaient décalées d'un rang
                    (l'e-mail sous « Statut », etc.). L'en-tête est rétabli
                    ENTRE « Prénom » et « E-mail d'accès » — exactement la
                    position de sa cellule dans le corps : chaque valeur
                    (Matricule, E-mail, Statut…) retrouve SA colonne. */}
                <th data-col-min={100} className="px-3 py-2 font-medium bg-muted/85 whitespace-nowrap">Matricule</th>
                {/* NOUVEAU (demande utilisateur) : colonne « E-mail d'accès » —
                    l'adresse utilisée par le RH/superadministrateur pour
                    l'envoi du MOT DE PASSE INITIAL (enregistrée automatiquement
                    dans le compte de l'employé à CHAQUE envoi réussi). Elle
                    correspond EXACTEMENT au dernier destinataire de l'e-mail. */}
                <th data-col-min={180} className="px-3 py-2 font-medium bg-muted/85 whitespace-nowrap">E-mail d&apos;accès</th>
                <th data-col-min={150} className="px-3 py-2 font-medium bg-muted/85 whitespace-nowrap">Statut</th>
                <th data-col-min={150} className="px-3 py-2 font-medium bg-muted/85 whitespace-nowrap">Mot de passe changé le</th>
                <th data-col-min={150} className="px-3 py-2 font-medium bg-muted/85 whitespace-nowrap">Dernière connexion</th>
                <th data-col-min={300} className="px-3 py-2 font-medium bg-muted/85 whitespace-nowrap text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center text-muted-foreground py-8">
                    Chargement…
                  </td>
                </tr>
              ) : lignesFiltrees.length === 0 ? (
                employes.length === 0 && items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center text-muted-foreground py-8">
                      Aucun employé détecté pour le moment. Importez des fiches de paie :
                      chaque CIN détecté s&apos;ajoutera AUTOMATIQUEMENT dans ce tableau,
                      avec un bouton «&nbsp;Créer l&apos;accès&nbsp;» directement dans sa ligne.
                    </td>
                  </tr>
                ) : (
                  <tr>
                    <td colSpan={9} className="text-center text-muted-foreground py-8">
                      Aucune ligne ne correspond à ce filtre.
                    </td>
                  </tr>
                )
              ) : (
                lignesFiltrees.map((ligne) => {
                  const row = ligne.access;
                  return row ? (
                  <tr key={ligne.cle} className="border-b last:border-0">
                    <td className="px-3 py-2.5">
                      <Badge
                        variant="outline"
                        className="font-mono border-emerald-600 text-emerald-700"
                      >
                        {maskCin(row.cin)}
                      </Badge>
                    </td>
                    {/* (MODIFIÉ v0.2.106) : NOM + PRÉNOM SÉPARÉS — deux
                        cellules ; le crayon (colonne Nom) ouvre le dialogue à
                        deux champs (mise à jour dans toutes les fiches de
                        paie de l'employé + accès portail). */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className={ligne.nom ? "" : "text-muted-foreground"}>
                          {ligne.nom ?? "—"}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={modifNomEnCours}
                          onClick={() => {
                            setModifNomValeur(ligne.nom ?? "");
                            setModifPrenomValeur(ligne.prenom ?? "");
                            setModifNomLigne(ligne);
                          }}
                          title="Modifier le nom et le prénom de l'employé (mis à jour dans ses fiches de paie)"
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </td>
                    <td className={`px-3 py-2.5 ${ligne.prenom ? "" : "text-muted-foreground"}`}>
                      <div className="flex items-center gap-1.5">
                        <span className={ligne.prenom ? "" : "text-muted-foreground"}>
                          {ligne.prenom ?? "—"}
                        </span>
                        {/* (NOUVEAU v0.2.110 — demande utilisateur) crayon SUR
                            la colonne « Prénom » : même dialogue d'édition
                            (Nom + Prénom). La modification est enregistrée et
                            PRISE EN COMPTE DANS LE PORTAIL DE L'EMPLOYÉ
                            (nomPrenom — pré-remplissage des demandes) ET dans
                            toutes ses fiches de paie. */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={modifNomEnCours}
                          onClick={() => {
                            setModifNomValeur(ligne.nom ?? "");
                            setModifPrenomValeur(ligne.prenom ?? "");
                            setModifNomLigne(ligne);
                          }}
                          title="Modifier le prénom de l'employé (enregistré et pris en compte dans son portail et ses fiches de paie)"
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </td>
                    {/* (FIN Task 173) */}
                    {/* NOUVEAU (v0.2.107) : MATRICULE — auto-associé depuis
                        les fiches de paie (valeur manuelle de l'accès en
                        priorité) ; le crayon ouvre le dialogue d'édition. */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-mono text-xs ${ligne.matricule ? "" : "text-muted-foreground"}`}
                          title={
                            ligne.matricule
                              ? "Matricule de l'employé — récupéré automatiquement depuis ses fiches de paie (valeur manuelle prioritaire si définie)"
                              : "Aucun matricule détecté dans les fiches de paie — utilisez le crayon pour le définir"
                          }
                        >
                          {ligne.matricule ?? "—"}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={modifMatriculeEnCours}
                          onClick={() => {
                            setModifMatriculeValeur(ligne.matricule ?? "");
                            setModifMatriculeLigne(ligne);
                          }}
                          title="Modifier le matricule de l'employé (mis à jour dans ses fiches de paie)"
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </td>
                    {/* (MODIFIÉ v0.2.91) : E-MAIL DE L'EMPLOYÉ — l'adresse de
                        NOTIFICATION (Task 116) est affichée et MODIFIABLE par
                        le RH/superadministrateur (crayon) ; la trace du
                        dernier envoi du mot de passe initial reste visible
                        en dessous quand elle diffère. */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={row.email ? "text-sm break-all" : "text-sm text-muted-foreground"}
                          title={
                            row.email
                              ? "E-mail de l'employé — notifications de ses demandes administratives"
                              : "Aucun e-mail renseigné — utilisez le crayon pour le définir"
                          }
                        >
                          {row.email ?? "—"}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={modifEmailEnCours}
                          onClick={() => {
                            setModifEmailValeur(row.email ?? row.mailEnvoyeA ?? "");
                            setModifEmailLigne(ligne);
                          }}
                          title="Modifier l'e-mail de l'employé (notifications de ses demandes + destinataire proposé de « Envoyer l'e-mail »)"
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                      {row.mailEnvoyeA && row.mailEnvoyeA !== row.email ? (
                        <p
                          className="text-[11px] text-muted-foreground break-all"
                          title="Adresse du DERNIER envoi du mot de passe initial (Send Mail)"
                        >
                          Dernier envoi : {row.mailEnvoyeA}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      {/* (MODIFIÉ — correctif affichage) les badges de statut
                          vivent dans une pile flex-wrap : ils s'empilent
                          proprement sur plusieurs lignes quand la colonne est
                          étroite au lieu de déborder sur la colonne voisine. */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isLocked(row) ? (
                          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                            Verrouillé
                          </Badge>
                        ) : (
                          <Badge
                            variant={row.isActive ? "default" : "secondary"}
                            className={row.isActive ? "bg-emerald-600" : ""}
                          >
                            {row.isActive ? "Actif" : "Désactivé"}
                          </Badge>
                        )}
                        {row.mustChangePassword && (
                          <Badge variant="outline" className="border-sky-300 bg-sky-50 text-sky-700">
                            Changement requis
                          </Badge>
                        )}
                        {!row.hasPassword && (
                          <Badge
                            variant="outline"
                            className="border-red-300 bg-red-50 text-red-700"
                            title="Accès créé avant la version mot de passe : utilisez « Réinitialiser » pour lui donner un mot de passe initial."
                          >
                            À réinitialiser
                          </Badge>
                        )}
                        {isLocked(row) && row.failedAttempts > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {row.failedAttempts} échec{row.failedAttempts > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {row.passwordChangedAt ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          {new Date(row.passwordChangedAt).toLocaleDateString("fr-FR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })}
                          <span className="text-xs">
                            (expire le{" "}
                            {new Date(
                              new Date(row.passwordChangedAt).getTime() +
                                15 * 24 * 60 * 60 * 1000
                            ).toLocaleDateString("fr-FR", {
                              day: "2-digit",
                              month: "2-digit",
                            })}
                            )
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {row.lastLoginAt
                        ? new Date(row.lastLoginAt).toLocaleString("fr-FR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {/* (MODIFIÉ — correctif affichage) flex-wrap + boutons
                          shrink-0 / whitespace-nowrap : les boutons d'action ne
                          se chevauchent JAMAIS — ils passent proprement à la
                          ligne suivante quand la colonne est étroite, sans se
                          déformer ni recouvrir les colonnes de données. */}
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {/* Bouton « Envoyer l'e-mail » pour CHAQUE
                            utilisateur — la popup saisit le destinataire et
                            « Envoyer » envoie l'e-mail ALLÉGÉ : mot de passe
                            initial + adresse d'accès au portail (ni CIN, ni
                            serveur, ni port). */}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId === row.id || sendMailBusy}
                          onClick={() => ouvrirSendMail(row)}
                          className="shrink-0 whitespace-nowrap"
                          title="Envoyer par e-mail à cet employé : mot de passe initial et adresse d'accès au portail (il se connecte avec son CIN, non inclus dans l'e-mail)"
                        >
                          <Mail className="h-4 w-4" />
                          <span className="hidden lg:inline ml-1">Envoyer l&apos;e-mail</span>
                        </Button>
                        {/* NOUVEAU (v0.2.133 — demande utilisateur) : bouton
                            « Manager » — ouvre la fenêtre DÉDIÉE de modification
                            du manager responsable / de la désignation « Manager »
                            de CET employé, SANS toucher à son mot de passe
                            (aucune réinitialisation, aucun nouveau mot de passe
                            initial, aucun e-mail de mot de passe). */}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId === row.id}
                          onClick={() => {
                            setInitEstManager(row.isManager);
                            setInitManagerResp(row.managerId ?? "");
                            setModifManagerLigne(row);
                          }}
                          className="shrink-0 whitespace-nowrap"
                          title="Modifier le manager responsable et la désignation « Manager » de cet employé — SANS réinitialiser son mot de passe"
                        >
                          <UserCheck className="h-4 w-4" />
                          <span className="hidden lg:inline ml-1">Manager</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId === row.id}
                          onClick={() => reset(row)}
                          className="shrink-0 whitespace-nowrap"
                          title="Générer un nouveau mot de passe initial à usage unique (l'ancien mot de passe cesse de fonctionner)"
                        >
                          <KeyRound className="h-4 w-4" />
                          <span className="hidden lg:inline ml-1">Réinitialiser</span>
                        </Button>
                        {isLocked(row) && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busyId === row.id}
                            onClick={() => action(row, "unlock")}
                            className="shrink-0 whitespace-nowrap"
                            title="Lever le verrouillage"
                          >
                            <LockOpen className="h-4 w-4" />
                            <span className="hidden lg:inline ml-1">Débloquer</span>
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId === row.id}
                          onClick={() => action(row, "toggle")}
                          className="shrink-0 whitespace-nowrap"
                          title={row.isActive ? "Désactiver cet accès" : "Réactiver cet accès"}
                        >
                          {row.isActive ? (
                            <ShieldOff className="h-4 w-4" />
                          ) : (
                            <ShieldCheck className="h-4 w-4" />
                          )}
                          <span className="hidden lg:inline ml-1">
                            {row.isActive ? "Désactiver" : "Activer"}
                          </span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId === row.id}
                          onClick={() => setToDelete(row)}
                          className="shrink-0 whitespace-nowrap text-red-600 hover:text-red-700 hover:bg-red-50"
                          title="Supprimer cet accès"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                  ) : (
                  // (Task 71) Ligne SANS accès : employé détecté en attente —
                  // création en un clic DIRECTEMENT dans la ligne du tableau.
                  <tr key={ligne.cle} className="border-b last:border-0 bg-amber-50/50">
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className="font-mono border-slate-400 text-slate-700">
                        {ligne.cinAffiche}
                      </Badge>
                    </td>
                    {/* (MODIFIÉ v0.2.106) : NOM + PRÉNOM SÉPARÉS — même
                        double cellule éditable pour les employés SANS accès
                        encore créé (prénom inconnu ici : —). */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className={ligne.nom ? "" : "text-muted-foreground"}>
                          {ligne.nom ?? "—"}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={modifNomEnCours}
                          onClick={() => {
                            setModifNomValeur(ligne.nom ?? "");
                            setModifPrenomValeur(ligne.prenom ?? "");
                            setModifNomLigne(ligne);
                          }}
                          title="Modifier le nom et le prénom de l'employé (mis à jour dans ses fiches de paie)"
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </td>
                    <td className={`px-3 py-2.5 ${ligne.prenom ? "" : "text-muted-foreground"}`}>
                      <div className="flex items-center gap-1.5">
                        <span className={ligne.prenom ? "" : "text-muted-foreground"}>
                          {ligne.prenom ?? "—"}
                        </span>
                        {/* (NOUVEAU v0.2.110 — demande utilisateur) crayon SUR
                            la colonne « Prénom » : même dialogue d'édition
                            (Nom + Prénom). La modification est enregistrée et
                            PRISE EN COMPTE DANS LE PORTAIL DE L'EMPLOYÉ
                            (nomPrenom — pré-remplissage des demandes) ET dans
                            toutes ses fiches de paie. */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={modifNomEnCours}
                          onClick={() => {
                            setModifNomValeur(ligne.nom ?? "");
                            setModifPrenomValeur(ligne.prenom ?? "");
                            setModifNomLigne(ligne);
                          }}
                          title="Modifier le prénom de l'employé (enregistré et pris en compte dans son portail et ses fiches de paie)"
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </td>
                    {/* NOUVEAU (v0.2.107) : MATRICULE — même cellule éditable
                        pour les employés SANS accès encore créé (valeur
                        auto-associée depuis ses fiches de paie). */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-mono text-xs ${ligne.matricule ? "" : "text-muted-foreground"}`}
                          title={
                            ligne.matricule
                              ? "Matricule de l'employé — récupéré automatiquement depuis ses fiches de paie"
                              : "Aucun matricule détecté dans les fiches de paie — utilisez le crayon pour le définir"
                          }
                        >
                          {ligne.matricule ?? "—"}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={modifMatriculeEnCours}
                          onClick={() => {
                            setModifMatriculeValeur(ligne.matricule ?? "");
                            setModifMatriculeLigne(ligne);
                          }}
                          title="Modifier le matricule de l'employé (mis à jour dans ses fiches de paie)"
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-muted-foreground">—</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                        Accès non créé
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">—</td>
                    <td className="px-3 py-2.5 text-muted-foreground">—</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap justify-end">
                        <Button
                          size="sm"
                          className="shrink-0 whitespace-nowrap bg-emerald-600 hover:bg-emerald-700"
                          disabled={busyId === ligne.cle || generating}
                          onClick={() => creerDepuisLigne(ligne)}
                          title="Créer l'accès portail de cet employé : son mot de passe initial est généré et affiché une seule fois"
                        >
                          <UserPlus className="h-4 w-4" />
                          <span className="ml-1">Créer l&apos;accès</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Cartes mobile — (MODIFIÉ Task 71) mêmes lignes pré-remplies : les
            employés détectés sans accès portent le badge « Accès non créé »
            et leur bouton « Créer l'accès ». */}
        <div className="md:hidden space-y-3">
          {loading ? (
            <p className="text-center text-muted-foreground py-6">Chargement…</p>
          ) : lignesFiltrees.length === 0 ? (
            employes.length === 0 && items.length === 0 ? (
              <p className="text-center text-muted-foreground py-6">
                Aucun employé détecté pour le moment. Importez des fiches de paie :
                chaque CIN détecté s&apos;ajoutera automatiquement ici, prêt à créer.
              </p>
            ) : (
              <p className="text-center text-muted-foreground py-6">
                Aucune ligne ne correspond à ce filtre.
              </p>
            )
          ) : (
            lignesFiltrees.map((ligne) => {
              const row = ligne.access;
              return row ? (
              <div key={ligne.cle} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="font-mono border-emerald-600 text-emerald-700">
                    {maskCin(row.cin)}
                  </Badge>
                  <div className="flex gap-1.5">
                    {isLocked(row) ? (
                      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                        Verrouillé
                      </Badge>
                    ) : (
                      <Badge
                        variant={row.isActive ? "default" : "secondary"}
                        className={row.isActive ? "bg-emerald-600" : ""}
                      >
                        {row.isActive ? "Actif" : "Désactivé"}
                      </Badge>
                    )}
                    {row.mustChangePassword && (
                      <Badge variant="outline" className="border-sky-300 bg-sky-50 text-sky-700">
                        Changement requis
                      </Badge>
                    )}
                  </div>
                </div>
                {/* (MODIFIÉ v0.2.106) : nom et prénom SÉPARÉS — affichés
                    sur deux lignes, bouton de modification (cartes mobiles). */}
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm ${ligne.nom ? "" : "text-muted-foreground"}`}>
                    Nom : {ligne.nom ?? "non détecté"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={modifNomEnCours}
                    onClick={() => {
                      setModifNomValeur(ligne.nom ?? "");
                      setModifPrenomValeur(ligne.prenom ?? "");
                      setModifNomLigne(ligne);
                    }}
                    title="Modifier le nom et le prénom de l'employé"
                  >
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
                <p className={`text-sm -mt-1 ${ligne.prenom ? "" : "text-muted-foreground"}`}>
                  Prénom : {ligne.prenom ?? "—"}
                </p>
                {/* NOUVEAU (v0.2.107) : matricule — auto-associé (valeur
                    manuelle de l'accès prioritaire), modifiable (crayon). */}
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-sm font-mono ${ligne.matricule ? "" : "text-muted-foreground"}`}
                  >
                    Matricule : {ligne.matricule ?? "—"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={modifMatriculeEnCours}
                    onClick={() => {
                      setModifMatriculeValeur(ligne.matricule ?? "");
                      setModifMatriculeLigne(ligne);
                    }}
                    title="Modifier le matricule de l'employé"
                  >
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
                {/* (MODIFIÉ v0.2.91) : e-mail de l'employé — affiché et
                    MODIFIABLE (crayon) ; la trace du dernier envoi reste
                    visible en dessous quand elle diffère. */}
                <div className="flex items-start gap-1.5">
                  <p className="text-xs text-muted-foreground break-all">
                    E-mail d&apos;accès : {row.email ?? row.mailEnvoyeA ?? "—"}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 shrink-0"
                    disabled={modifEmailEnCours}
                    onClick={() => {
                      setModifEmailValeur(row.email ?? row.mailEnvoyeA ?? "");
                      setModifEmailLigne(ligne);
                    }}
                    title="Modifier l'e-mail de l'employé"
                  >
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
                {row.mailEnvoyeA && row.mailEnvoyeA !== row.email ? (
                  <p className="text-[11px] text-muted-foreground break-all">
                    Dernier envoi : {row.mailEnvoyeA}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Dernière connexion :{" "}
                  {row.lastLoginAt
                    ? new Date(row.lastLoginAt).toLocaleString("fr-FR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "—"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {/* Bouton « Envoyer l'e-mail » (cartes mobiles) */}
                  <Button variant="outline" size="sm" onClick={() => ouvrirSendMail(row)}>
                    <Mail className="h-4 w-4" />
                    Envoyer l&apos;e-mail
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => reset(row)}>
                    <KeyRound className="h-4 w-4" />
                    Réinitialiser
                  </Button>
                  {isLocked(row) && (
                    <Button variant="outline" size="sm" onClick={() => action(row, "unlock")}>
                      <LockOpen className="h-4 w-4" />
                      Débloquer
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => action(row, "toggle")}>
                    {row.isActive ? <ShieldOff className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                    {row.isActive ? "Désactiver" : "Activer"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setToDelete(row)}
                    className="text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              ) : (
              <div
                key={ligne.cle}
                className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="font-mono border-slate-400 text-slate-700">
                    {ligne.cinAffiche}
                  </Badge>
                  <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                    Accès non créé
                  </Badge>
                </div>
                {/* (MODIFIÉ v0.2.106) : nom et prénom SÉPARÉS — employés
                    détectés SANS accès (cartes mobiles) : prénom inconnu —. */}
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm ${ligne.nom ? "" : "text-muted-foreground"}`}>
                    Nom : {ligne.nom ?? "non détecté"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={modifNomEnCours}
                    onClick={() => {
                      setModifNomValeur(ligne.nom ?? "");
                      setModifPrenomValeur(ligne.prenom ?? "");
                      setModifNomLigne(ligne);
                    }}
                    title="Modifier le nom et le prénom de l'employé"
                  >
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
                <p className={`text-sm -mt-1 ${ligne.prenom ? "" : "text-muted-foreground"}`}>
                  Prénom : {ligne.prenom ?? "—"}
                </p>
                {/* NOUVEAU (v0.2.107) : matricule auto-associé, modifiable. */}
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-sm font-mono ${ligne.matricule ? "" : "text-muted-foreground"}`}
                  >
                    Matricule : {ligne.matricule ?? "—"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={modifMatriculeEnCours}
                    onClick={() => {
                      setModifMatriculeValeur(ligne.matricule ?? "");
                      setModifMatriculeLigne(ligne);
                    }}
                    title="Modifier le matricule de l'employé"
                  >
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
                <Button
                  size="sm"
                  disabled={busyId === ligne.cle || generating}
                  onClick={() => creerDepuisLigne(ligne)}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <UserPlus className="h-4 w-4" />
                  Créer l&apos;accès
                </Button>
              </div>
              );
            })
          )}
        </div>
      </CardContent>

      {/* (MODIFIÉ Task 77) Le sélecteur dialogué d'employé (Task 65) a été
          SUPPRIMÉ avec la barre de création : il ne servait qu'à remplir le
          champ retiré. La liste des employés vit désormais dans le tableau
          pré-rempli (Task 71), où chaque ligne porte son bouton d'action. */}

      {/* Boîte de dialogue MOT DE PASSE INITIAL (affichage unique) */}
      <Dialog open={!!initial} onOpenChange={(open) => !open && setInitial(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-emerald-600" />
              Mot de passe initial — CIN {initial ? maskCin(initial.access?.cin ?? initial.cin ?? "") : ""}
            </DialogTitle>
            <DialogDescription>
              À communiquer à l&apos;employé. Il sera <b>obligé</b> de choisir son propre mot de
              passe dès sa première connexion.
            </DialogDescription>
          </DialogHeader>
          {initial && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md border bg-muted px-2.5 py-3 text-base font-mono tracking-widest text-center select-all">
                  {initial.initialPassword}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  title="Copier le mot de passe initial"
                  onClick={() => {
                    navigator.clipboard?.writeText(initial.initialPassword).then(
                      () => toast({ title: "Mot de passe copié" }),
                      () => toast({ title: "Copie impossible", variant: "destructive" })
                    );
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Communiquez ce mot de passe initial à l&apos;employé (de vive voix ou par un canal sûr).</li>
                <li>
                  Au portail, il saisira son CIN + ce mot de passe initial — avec ou sans tirets,
                  les tirets et espaces sont ignorés à la saisie (Task 66).
                </li>
                <li>
                  Le portail l&apos;obligera aussitôt à choisir <b>son propre</b> mot de passe —
                  ce mot de passe initial ne fonctionnera plus ensuite.
                </li>
              </ol>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2.5">
                Ce mot de passe ne sera plus affichée. Son expiration suit la même règle que
                partout : changement obligatoire tous les 15 jours.
              </p>
              {/* ============================================================ */}
              {/* NOUVEAU (v0.2.131 — demande utilisateur) : CASE À COCHER     */}
              {/* « Manager » + LISTE DÉROULANTE « Manager responsable » dans  */}
              {/* la fenêtre « Mot de passe initial — CIN ». Chaque changement */}
              {/* est enregistré AUTOMATIQUEMENT (POST modifier-manager) et la */}
              {/* liste des managers se met à jour au fur et à mesure des      */}
              {/* désignations (rechargement après chaque enregistrement).     */}
              {/* ============================================================ */}
              <div className="border-t pt-3 space-y-3">
                <label
                  htmlFor="initial-manager"
                  className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50/60 p-3 cursor-pointer"
                >
                  <input
                    id="initial-manager"
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-amber-600"
                    checked={initEstManager}
                    disabled={initManagerBusy}
                    onChange={(e) => {
                      const coche = e.target.checked;
                      setInitEstManager(coche);
                      enregistrerManagerInitial(coche, initManagerResp);
                    }}
                  />
                  <span>
                    <span className="text-sm font-medium">Manager</span>
                    <span className="block text-xs text-muted-foreground">
                      Cochez si cet employé est un MANAGER : il apparaîtra automatiquement dans la
                      liste déroulante « Manager responsable » des autres employés, au fur et à
                      mesure des désignations.
                    </span>
                  </span>
                </label>
                <div className="space-y-1.5">
                  <label htmlFor="initial-manager-responsable" className="text-sm font-medium">
                    Manager responsable
                  </label>
                  <select
                    id="initial-manager-responsable"
                    value={initManagerResp}
                    disabled={initManagerBusy}
                    onChange={(e) => {
                      const valeur = e.target.value;
                      setInitManagerResp(valeur);
                      enregistrerManagerInitial(initEstManager, valeur);
                    }}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  >
                    <option value="">— Aucun —</option>
                    {managersPortail.map((m) => (
                      <option key={m.id} value={m.id}>
                        {[m.prenom, m.nom].filter(Boolean).join(" ") || m.nomPrenom || `CIN ${m.cin}`}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Liste remplie automatiquement avec les employés cochés « Manager » :
                    {managersPortail.length === 0
                      ? " aucun manager pour le moment — cochez « Manager » sur un autre employé."
                      : ` ${managersPortail.length} manager(s) disponible(s).`}
                  </p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ================================================================ */}
      {/* NOUVEAU (v0.2.133 — demande utilisateur) : FENÊTRE DÉDIÉE        */}
      {/* « MODIFIER LE MANAGER » — ouverte par le bouton « Manager » du    */}
      {/* tableau. Change la désignation « Manager » et/ou le manager      */}
      {/* responsable d'un employé EXISTANT, enregistrés AUTOMATIQUEMENT   */}
      {/* (action « modifier-manager »), SANS réinitialiser son mot de     */}
      {/* passe — c'est la réponse directe à la question « comment modifier */}
      {/* le choix du manager sans réinitialiser le mot de passe ? ».      */}
      {/* ================================================================ */}
      <Dialog open={!!modifManagerLigne} onOpenChange={(open) => !open && setModifManagerLigne(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-amber-600" />
              Modifier le manager — {modifManagerLigne ? nomAfficheAcces(modifManagerLigne) : ""}
            </DialogTitle>
            <DialogDescription>
              L&apos;enregistrement est <b>automatique</b> à chaque changement. Le mot de passe de
              l&apos;employé n&apos;est <b>pas touché</b> : aucune réinitialisation — son accès
              continue de fonctionner normalement.
            </DialogDescription>
          </DialogHeader>
          {modifManagerLigne && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                CIN : <span className="font-mono">{maskCin(modifManagerLigne.cin)}</span> · Manager
                responsable actuel :{" "}
                <b>{modifManagerLigne.managerId ? modifManagerLigne.managerNom || "…" : "— Aucun —"}</b>
              </p>
              <label
                htmlFor="modif-manager"
                className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50/60 p-3 cursor-pointer"
              >
                <input
                  id="modif-manager"
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-amber-600"
                  checked={initEstManager}
                  disabled={initManagerBusy}
                  onChange={(e) => {
                    const coche = e.target.checked;
                    setInitEstManager(coche);
                    enregistrerManagerInitial(coche, initManagerResp);
                  }}
                />
                <span>
                  <span className="text-sm font-medium">Manager</span>
                  <span className="block text-xs text-muted-foreground">
                    Cochez si cet employé est un MANAGER : il apparaîtra automatiquement dans la
                    liste déroulante « Manager responsable » des autres employés, au fur et à
                    mesure des désignations.
                  </span>
                </span>
              </label>
              <div className="space-y-1.5">
                <label htmlFor="modif-manager-responsable" className="text-sm font-medium">
                  Manager responsable
                </label>
                <select
                  id="modif-manager-responsable"
                  value={initManagerResp}
                  disabled={initManagerBusy}
                  onChange={(e) => {
                    const valeur = e.target.value;
                    setInitManagerResp(valeur);
                    enregistrerManagerInitial(initEstManager, valeur);
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  <option value="">— Aucun —</option>
                  {managersPortail.map((m) => (
                    <option key={m.id} value={m.id}>
                      {nomAfficheAcces(m)}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Liste remplie automatiquement avec les employés cochés « Manager » :
                  {managersPortail.length === 0
                    ? " aucun manager pour le moment — cochez « Manager » sur un autre employé."
                    : ` ${managersPortail.length} manager(s) disponible(s).`}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmation de suppression */}
      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cet accès portail ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le CIN {toDelete ? maskCin(toDelete.cin) : ""} ne pourra plus se connecter au
              portail, même avec un mot de passe valide. Cette action est définitive — recréez un
              accès pour réautoriser cette personne.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => toDelete && action(toDelete, "delete")}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>

    {/* ================================================================ */}
    {/* NOUVEAU (Task 80) — SECTION « GESTION DES QR CODES »             */}
    {/* ================================================================ */}
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className="h-5 w-5 text-emerald-600" />
          Gestion des QR codes
        </CardTitle>
        <CardDescription>
          Inscription des employés à l&apos;application d&apos;authentification (OTP à 6 chiffres,
          demandé à chaque connexion). <b>Afficher le QR</b> pour le faire scanner en direct à
          l&apos;employé ; <b>Réinitialiser le QR</b> en cas de téléphone perdu, changé ou
          compromis — l&apos;ancienne application cesse aussitôt de générer des codes valables.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Compteurs + filtre de la section QR */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
          <p className="text-xs text-muted-foreground flex-1">
            <b className="text-foreground">{qrMeta.total}</b> accès ·{" "}
            <b className="text-foreground">{qrMeta.generes}</b> QR généré
            {qrMeta.generes > 1 ? "s" : ""} ·{" "}
            <b className="text-foreground">{qrMeta.attente}</b> en attente d&apos;inscription ·{" "}
            {qrMeta.expires > 0 && (
              <>
                <b className="text-orange-600">{qrMeta.expires}</b> expiré
                {qrMeta.expires > 1 ? "s" : ""} (nouveau QR à la prochaine connexion) ·{" "}
              </>
            )}
            <b className="text-foreground">{qrMeta.actifs}</b> actif
            {qrMeta.actifs > 1 ? "s" : ""} — le QR code d&apos;inscription expire après 10 minutes :
            passé ce délai sans confirmation du code, il devient invalide et un NOUVEAU QR (nouveau
            secret) est présenté à la prochaine connexion de l&apos;employé.
          </p>
          {items.length > 8 && (
            <Input
              placeholder="Filtrer par nom ou par CIN…"
              value={rechercheQr}
              onChange={(e) => setRechercheQr(e.target.value)}
              className="sm:max-w-xs h-8 text-xs"
              autoComplete="off"
            />
          )}
        </div>

        {/* Tableau desktop — état QR + actions
            (MODIFIÉ — correctif affichage) mêmes garanties que le tableau
            principal : layout fixe + colgroup (aucune déformation), en-têtes
            sur une ligne, boutons flex-wrap sans chevauchement. */}
        <div className="hidden md:block rounded-md border overflow-x-auto overflow-y-auto overscroll-x-contain max-h-[480px]">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col style={{ width: 150 }} />
              <col style={{ width: 210 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 360 }} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="border-b bg-white text-left">
                <th data-col-min={110} className="px-3 py-2 font-medium bg-muted/85 whitespace-nowrap">CIN</th>
                <th data-col-min={150} className="px-3 py-2 font-medium bg-muted/85 whitespace-nowrap">Statut QR</th>
                <th data-col-min={150} className="px-3 py-2 font-medium bg-muted/85 whitespace-nowrap">Dernière connexion</th>
                <th data-col-min={220} className="px-3 py-2 font-medium bg-muted/85 whitespace-nowrap text-right">Actions QR</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="text-center text-muted-foreground py-8">
                    Chargement…
                  </td>
                </tr>
              ) : itemsQr.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-muted-foreground py-8">
                    {items.length === 0
                      ? "Aucun accès portail créé pour le moment : créez d’abord un accès dans le tableau ci-dessus."
                      : "Aucune ligne ne correspond à ce filtre."}
                  </td>
                </tr>
              ) : (
                itemsQr.map((row) => {
                  const st = statutQr(row);
                  return (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="px-3 py-2.5">
                        <Badge variant="outline" className="font-mono border-emerald-600 text-emerald-700">
                          {maskCin(row.cin)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge variant="outline" className={st.cls}>
                          {st.label}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {row.lastLoginAt
                          ? new Date(row.lastLoginAt).toLocaleString("fr-FR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busyQrId === row.id}
                            onClick={() => afficherQr(row)}
                            className="shrink-0 whitespace-nowrap"
                            title="Afficher le QR code de cet employé pour le faire scanner avec son application d'authentification"
                          >
                            <QrCode className="h-4 w-4" />
                            <span className="hidden lg:inline ml-1">Afficher le QR</span>
                          </Button>
                          {row.hasQrSecret && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busyQrId === row.id}
                              onClick={() => setQrReset(row)}
                              className="shrink-0 whitespace-nowrap"
                              title="Générer un NOUVEAU secret : l'ancienne application d'authentification ne génère plus de codes valables (téléphone perdu, changé ou compromis)"
                            >
                              <RefreshCw className="h-4 w-4" />
                              <span className="hidden lg:inline ml-1">Réinitialiser le QR</span>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Cartes mobile — même état QR + mêmes actions */}
        <div className="md:hidden space-y-3">
          {loading ? (
            <p className="text-center text-muted-foreground py-6">Chargement…</p>
          ) : itemsQr.length === 0 ? (
            <p className="text-center text-muted-foreground py-6">
              {items.length === 0
                ? "Aucun accès portail créé pour le moment."
                : "Aucune ligne ne correspond à ce filtre."}
            </p>
          ) : (
            itemsQr.map((row) => {
              const st = statutQr(row);
              return (
                <div key={row.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className="font-mono border-emerald-600 text-emerald-700">
                      {maskCin(row.cin)}
                    </Badge>
                    <Badge variant="outline" className={st.cls}>
                      {st.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Dernière connexion :{" "}
                    {row.lastLoginAt
                      ? new Date(row.lastLoginAt).toLocaleString("fr-FR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Button variant="outline" size="sm" disabled={busyQrId === row.id} onClick={() => afficherQr(row)}>
                      <QrCode className="h-4 w-4" />
                      Afficher le QR
                    </Button>
                    {row.hasQrSecret && (
                      <Button variant="outline" size="sm" disabled={busyQrId === row.id} onClick={() => setQrReset(row)}>
                        <RefreshCw className="h-4 w-4" />
                        Réinitialiser le QR
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>

      {/* Dialogue QR CODE (Afficher / après Réinitialiser) */}
      <Dialog open={!!qrDialog} onOpenChange={(open) => !open && setQrDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-emerald-600" />
              {qrDialog?.reset ? "Nouveau QR code — CIN " : "QR code — CIN "}
              {qrDialog ? maskCin(qrDialog.cin) : ""}
            </DialogTitle>
            <DialogDescription>
              {qrDialog?.reset
                ? "L'ancienne application d'authentification ne génère plus de codes valables."
                : "Faites scanner ce QR code à l'employé avec son application d'authentification."}
            </DialogDescription>
          </DialogHeader>
          {qrDialog && (
            <div className="space-y-3">
              <div
                className="mx-auto w-fit rounded-lg border bg-white p-2"
                // SVG du QR généré par NOTRE propre API (format standard otpauth://)
                dangerouslySetInnerHTML={{ __html: qrDialog.svg }}
              />
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>
                  L&apos;employé ouvre son application (Google Authenticator, Microsoft
                  Authenticator, Authy, FreeOTP…) et ajoute un compte en scannant ce QR code.
                </li>
                <li>
                  L&apos;application générera ses codes OTP à 6 chiffres — demandés à chaque
                  connexion au portail.
                </li>
                <li>
                  {/* NOUVEAU (Task 86) : le QR d'un employé NON INSCRIT est une fenêtre de 10 minutes */}
                  <b>
                    Valable 10 minutes</b> : passé ce délai sans confirmation du code, ce QR devient
                  invalide — un NOUVEAU QR (nouveau secret) sera affiché à la prochaine connexion de
                  l&apos;employé.
                </li>
                {qrDialog.reset && (
                  <li>
                    <b>Supprimez l&apos;ancien compte</b> dans son application : il ne génère plus
                    que des codes refusés.
                  </li>
                )}
              </ol>
              <p className="text-[11px] text-muted-foreground break-all bg-muted rounded-md p-2 font-mono">
                {qrDialog.payload}
              </p>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2.5">
                Ce QR contient le secret d&apos;authentification de l&apos;employé : ne l&apos;affichez
                qu&apos;à la personne concernée, jamais en réunion ni sur une capture d&apos;écran
                partagée.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmation de RÉINITIALISATION du QR */}
      <AlertDialog open={!!qrReset} onOpenChange={(open) => !open && setQrReset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Réinitialiser le QR code de cet employé ?</AlertDialogTitle>
            <AlertDialogDescription>
              Un NOUVEAU secret sera généré pour le CIN {qrReset ? maskCin(qrReset.cin) : ""} :
              l&apos;application d&apos;authentification actuelle ne générera plus que des codes
              refusés (téléphone perdu, changé ou compromis). L&apos;employé devra scanner le
              nouveau QR code — il s&apos;affichera aussitôt la confirmation validée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => qrReset && reinitialiserQr(qrReset)}
            >
              Réinitialiser le QR
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>

    {/* ================================================================ */}
    {/* MODIFIÉ (Task 13) — PANNEAU « ENVOI D'E-MAILS (SMTP) »            */}
    {/* (configuration du serveur d'envoi + e-mail de test) — rendu       */}
    {/* UNIQUEMENT pour IT/SUPERADMIN : la section RH n'a AUCUNE          */}
    {/* configuration de messagerie, elle utilise seulement l'envoi        */}
    {/* (« Envoyer l'e-mail » de la liste ci-dessus).                      */}
    {/* ================================================================ */}
    {peutConfigurerSmtp && <MailPanel />}

    {/* ================================================================ */}
    {/* POPUP « SEND MAIL »                                              */}
    {/* Un bouton « Envoyer l'e-mail » par ligne de la liste « CIN –   */}
    {/* Accès Portail par mot de passe » : le destinataire est saisi    */}
    {/* ici et « Envoyer » envoie le mot de passe initial + l'adresse   */}
    {/* d'accès au portail (e-mail allégé : ni CIN, ni serveur, ni port).*/}
    {/* ================================================================ */}
    <Dialog open={!!sendMailRow} onOpenChange={(open) => !open && setSendMailRow(null)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-emerald-600" />
            Envoyer l&apos;e-mail — CIN {sendMailRow ? maskCin(sendMailRow.cin) : ""}
          </DialogTitle>
          <DialogDescription>
            L&apos;e-mail contient : <b>mot de passe initial</b> et <b>adresse d&apos;accès au
            portail</b>. L&apos;employé se connecte avec son CIN (volontairement non inclus
            dans l&apos;e-mail).
          </DialogDescription>
        </DialogHeader>
        {sendMailResult ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md p-3">
              {sendMailResult.message}
            </p>
            <div className="rounded-md border bg-muted/40 p-3 space-y-1.5 text-sm">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Contenu envoyé — vérifiez la réception dans la boîte du destinataire :
              </p>
              <p>
                Mot de passe initial :{" "}
                <code className="font-mono tracking-widest select-all">{sendMailResult.apercu.motDePasse}</code>
              </p>
              <p>
                Adresse d&apos;accès au portail :{" "}
                <code className="font-mono">{sendMailResult.apercu.portailUrl}</code>
              </p>
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2.5">
              Cet e-mail contient des identifiants d&apos;accès : n&apos;utilisez l&apos;adresse que
              du destinataire concerné. Le mot de passe initial restera valable jusqu&apos;à ce que
              l&apos;employé choisisse le sien à sa première connexion.
            </p>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setSendMailRow(null)}>
                Fermer
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* État du service d'envoi — MODIFIÉ (v0.2.100, matrice des rôles) :
                « Consulter la configuration SMTP » = Non pour le RH — il ne voit
                AUCUN état (ni booléen « configurée », ni hôte/port/compte) :
                message NEUTRE. L'état et les détails restent visibles des rôles
                IT et SUPERADMIN uniquement. */}
            {!sendMailCfg ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Vérification de la configuration
                SMTP…
              </p>
            ) : !peutConfigurerSmtp ? (
              <p className="text-xs text-muted-foreground">
                L&apos;e-mail partira du serveur d&apos;envoi configuré par le service
                informatique (état du service non consultable pour votre rôle).
              </p>
            ) : !sendMailCfg.configuree ? (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2.5">
                Le serveur SMTP n&apos;est <b>pas encore configuré</b> : utilisez le panneau
                «&nbsp;Service d&apos;envoi d&apos;e-mails (SMTP)&nbsp;» ci-dessous (préréglage
                Gmail en un clic — ou serveur personnalisé — puis
                «&nbsp;Enregistrer la configuration&nbsp;»), ou envoyez
                d&apos;abord un e-mail de test. Le champ ci-dessous reste saisissable — l&apos;envoi
                échouera tant que le serveur SMTP n&apos;est pas enregistré.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Serveur d&apos;envoi : <b>{sendMailCfg.host}</b> ({sendMailCfg.port}
                {sendMailCfg.secure ? ", SSL/TLS" : ", STARTTLS"})
                {sendMailCfg.username ? ` — compte ${sendMailCfg.username}` : ""}
              </p>
            )}

            {/* Destinataire */}
            <div className="space-y-1.5">
              <Label htmlFor="sendmail-dest">Adresse e-mail du destinataire</Label>
              <Input
                id="sendmail-dest"
                type="email"
                placeholder="employe@exemple.tn — adresse du destinataire"
                value={sendMailDest}
                onChange={(e) => setSendMailDest(e.target.value)}
                autoComplete="email"
              />
              {sendMailRow?.mailEnvoyeA && (
                <p className="text-xs text-muted-foreground">
                  Dernier envoi pour cet accès : {sendMailRow.mailEnvoyeA} le{" "}
                  {new Date(sendMailRow.mailEnvoyeLe ?? "").toLocaleString("fr-FR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              )}
            </div>

            {/* Mot de passe initial : inclus, ou réinitialisation nécessaire */}
            {sendMailRow?.aMotDePasseInitial ? (
              <p className="text-xs text-sky-800 bg-sky-50 border border-sky-200 rounded-md p-2.5">
                Le <b>mot de passe initial actuel</b> de cet employé sera inclus dans l&apos;e-mail
                (il reste valable : l&apos;employé n&apos;a pas encore choisi son propre mot de
                passe).
              </p>
            ) : (
              <label className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendMailReset}
                  onChange={(e) => setSendMailReset(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5"
                />
                <span>
                  <b>Réinitialiser le mot de passe et envoyer le nouveau</b> : le mot de passe
                  initial n&apos;est plus disponible (l&apos;employé a déjà choisi son propre mot de
                  passe, ou accès ancien). Coché, un <b>NOUVEAU mot de passe initial</b> est
                  généré puis envoyé — l&apos;ancien cesse de fonctionner.
                </span>
              </label>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setSendMailRow(null)}>
                Annuler
              </Button>
              <Button
                size="sm"
                onClick={envoyerSendMail}
                disabled={sendMailBusy || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(sendMailDest.trim())}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {sendMailBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Envoyer
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>

    {/* NOUVEAU (Task 173) : dialogue de MODIFICATION DU NOM ET PRÉNOM —
        le RH corrige le nom directement depuis ce tableau ; l'enregistrement
        met à jour les données de l'employé (toutes ses fiches de paie) et
        l'accès portail. */}
    <Dialog
      open={!!modifNomLigne}
      onOpenChange={(open) => {
        if (!open) {
          setModifNomLigne(null);
          setModifNomValeur("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Modifier le nom et le prénom</DialogTitle>
          <DialogDescription>
            CIN {modifNomLigne?.cinAffiche ?? modifNomLigne?.cin ?? ""} — la modification est
            enregistrée dans les données de l&apos;employé : toutes ses fiches de paie portent
            le nouveau nom, ainsi que son accès portail (colonnes « Nom » / « Prénom » séparées).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2.5 py-1 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="modif-nom-employe">Nom</Label>
            <Input
              id="modif-nom-employe"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Ex. Ben Salah"
              value={modifNomValeur}
              onChange={(e) => setModifNomValeur(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && modifNomValeur.trim().length >= 2 && !modifNomEnCours) {
                  enregistrerNom();
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="modif-prenom-employe">Prénom</Label>
            <Input
              id="modif-prenom-employe"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Ex. Mohamed"
              value={modifPrenomValeur}
              onChange={(e) => setModifPrenomValeur(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && modifNomValeur.trim().length >= 2 && !modifNomEnCours) {
                  enregistrerNom();
                }
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Lettres, espaces, tirets et apostrophes uniquement (2 à 80 caractères par champ).
            Le prénom peut rester vide. Le nom complet enregistré dans les fiches de paie est
            « Prénom Nom ».
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setModifNomLigne(null)}>
            Annuler
          </Button>
          <Button
            size="sm"
            onClick={enregistrerNom}
            disabled={modifNomEnCours || modifNomValeur.trim().replace(/\s+/g, " ").length < 2}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {modifNomEnCours ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Pencil className="h-4 w-4" />
            )}
            Enregistrer
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* NOUVEAU (v0.2.107) : dialogue de MODIFICATION DU MATRICULE — le RH
        corrige le matricule comme le nom / prénom / e-mail ; l'enregistrement
        met à jour les données de l'employé (toutes ses fiches de paie) et
        mémorise la valeur sur l'accès portail. Champ vide = effacement de la
        valeur manuelle (repli sur l'auto-association depuis les fiches). */}
    <Dialog
      open={!!modifMatriculeLigne}
      onOpenChange={(open) => {
        if (!open) {
          setModifMatriculeLigne(null);
          setModifMatriculeValeur("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Modifier le matricule</DialogTitle>
          <DialogDescription>
            CIN {modifMatriculeLigne?.cinAffiche ?? modifMatriculeLigne?.cin ?? ""} — la valeur
            saisie est enregistrée dans les données de l&apos;employé : toutes ses fiches de paie
            portent le nouveau matricule (il alimente aussi les demandes et les e-mails).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2.5 py-1">
          <Label htmlFor="modif-matricule-employe">Matricule de l&apos;employé</Label>
          <Input
            id="modif-matricule-employe"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Ex. 003879 ou MAT-1003"
            value={modifMatriculeValeur}
            onChange={(e) => setModifMatriculeValeur(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !modifMatriculeEnCours) {
                enregistrerMatricule();
              }
            }}
          />
          <p className="text-xs text-muted-foreground">
            Lettres, chiffres, espaces, tirets, points et barres (1 à 30 caractères). Laissez le
            champ vide pour EFFACER la valeur manuelle : le matricule affiché replie alors sur la
            détection automatique dans les fiches de paie.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setModifMatriculeLigne(null)}>
            Annuler
          </Button>
          <Button
            size="sm"
            onClick={enregistrerMatricule}
            disabled={modifMatriculeEnCours}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {modifMatriculeEnCours ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Pencil className="h-4 w-4" />
            )}
            Enregistrer
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* NOUVEAU (v0.2.91) : dialogue de MODIFICATION DE L'E-MAIL DE L'EMPLOYÉ —
        le RH/superadministrateur corrige l'adresse de notification
        directement depuis ce tableau ; l'adresse reçoit les notifications
        de ses demandes et pré-remplit « Envoyer l'e-mail ». */}
    <Dialog
      open={!!modifEmailLigne}
      onOpenChange={(open) => {
        if (!open) {
          setModifEmailLigne(null);
          setModifEmailValeur("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Modifier l&apos;e-mail de l&apos;employé</DialogTitle>
          <DialogDescription>
            CIN {modifEmailLigne?.cinAffiche ?? modifEmailLigne?.cin ?? ""} — cette adresse
            reçoit les notifications de SES demandes administratives et sert de destinataire
            proposé par défaut de l&apos;envoi des accès.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2.5 py-1">
          <Label htmlFor="modif-email-employe">E-mail de l&apos;employé</Label>
          <Input
            id="modif-email-employe"
            type="email"
            autoComplete="email"
            placeholder="Ex. prenom.nom@entreprise.tn"
            value={modifEmailValeur}
            onChange={(e) => setModifEmailValeur(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && modifEmailValeur.trim() && !modifEmailEnCours) {
                enregistrerEmail();
              }
            }}
          />
          <p className="text-xs text-muted-foreground">
            Adresse e-mail valide requise (ex. prenom.nom@entreprise.tn).
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setModifEmailLigne(null)}>
            Annuler
          </Button>
          <Button
            size="sm"
            onClick={enregistrerEmail}
            disabled={modifEmailEnCours || !modifEmailValeur.trim()}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {modifEmailEnCours ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Pencil className="h-4 w-4" />
            )}
            Enregistrer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
