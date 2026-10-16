/**
 * ============================================================================
 *  NOUVEAU (Task 118) — PANNEAU « SIGNATURE ÉLECTRONIQUE & QR CODE »
 * ============================================================================
 *
 *  Rubrique de l'onglet « Importation » (administration 4000) conforme à la
 *  demande : configuration et gestion de la signature électronique et du
 *  code QR apposés automatiquement sur chaque fiche de paie après
 *  l'importation.
 *
 *  - Interrupteur général « Tampon automatique » : appliqué au moment du
 *    servage (affichage et téléchargement), l'original stocké reste intact —
 *    les fiches DÉJÀ importées sont tamponnées elles aussi, et tout changement
 *    de configuration s'applique immédiatement à TOUTES les fiches ;
 *  - Signature : image (cachet/paraphe PNG ou JPEG) et/ou ligne de texte,
 *    position (4 coins), taille, opacité ;
 *  - QR code : 3 modes de contenu — « Données de la fiche » (référence,
 *    employé, CIN, période, net, empreinte de contrôle HMAC), « URL de
 *    vérification » (l'URL reçoit ?ref=…&cin=…&h=empreinte) ou « Texte
 *    personnalisé » — position, taille ;
 *  - Mention légale datée en pied de page ;
 *  - Bouton « Aperçu » : applique la configuration ACTUELLE du formulaire
 *    (avant enregistrement) à une fiche d'exemple et ouvre le PDF tamponné ;
 *  - Bouton « Enregistrer ».
 *
 *  Accès : rendu pour RH / IT / SUPERADMIN (MODIFIÉ v0.2.41 : la RH gère
 *  elle-même le tampon ; l'API applique la même règle) — la configuration
 *  SMTP reste quant à elle réservée à IT / SUPERADMIN.
 *
 *  (NOUVEAU v0.2.89)
 *  - POSITIONNEMENT LIBRE de la signature par glisser-déposer sur un aperçu
 *    A4 interactif (géométrie répliquée exactement depuis coinVersBoite() de
 *    stamp.ts) — le placement vaut pour la fiche de paie ET le document de
 *    réponse (mêmes moteurs, même configuration) ; la mention « Activez au
 *    moins la signature… » est SUPPRIMÉE ; le certificat de signature est
 *    explicitement INDÉPENDANT des autres éléments (signature, QR, mention).
 * ============================================================================
 */
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  BadgeCheck,
  Eye,
  FileImage,
  FileSignature,
  Loader2,
  QrCode,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
// (MODIFIÉ v0.2.93) SÉPARATION DES CONFIGURATIONS : l'aperçu A4 interactif,
// les positions/bornes et les utilitaires sont PARTAGÉS entre la section
// « Import » (ce panneau — fiches de paie) et la section « Demandes /
// Réponses » (signature-panel-reponses.tsx — documents de réponse).
import {
  ApercuPositionnement,
  CERT_TAILLE_MAX,
  CERT_TAILLE_MIN,
  dateFr,
  DECAL_MAX,
  DECAL_MIN,
  geometrieCertificat,
  POSITIONS,
  POSITIONS_CERT,
  PT_PAR_MM,
  ROTATION_MAX,
  ROTATION_MIN,
  TAILLE_MAX,
  TAILLE_MIN,
  type CleDecal,
} from "@/components/payslip/apercu-positionnement";

interface SignatureConfig {
  actif: boolean;
  sigActif: boolean;
  sigImage: string;
  sigTexte: string;
  sigPosition: string;
  sigTaille: number;
  sigOpacite: number;
  qrActif: boolean;
  qrMode: string;
  qrUrl: string;
  qrTexte: string;
  qrImage: string;
  qrPosition: string;
  qrTaille: number;
  sigDecalX: number;
  sigDecalY: number;
  qrDecalX: number;
  qrDecalY: number;
  // (NOUVEAU 0.2.54) rotations en degrés SENS HORAIRE (0 → 360)
  sigRotation: number;
  qrRotation: number;
  // (NOUVEAU 0.2.58 — « Path : l'emplacement des tampons importés »)
  // traçabilité de chaque image importée : nom du fichier d'origine choisi
  // par l'utilisateur + chemin de la copie de contrôle exportée sur le
  // serveur (storage/tampons/) — affichés sous chaque champ d'import.
  sigImageNom: string;
  sigImageChemin: string;
  qrImageNom: string;
  qrImageChemin: string;
  // (NOUVEAU Task 181) certificat de signature électronique importé :
  // métadonnées publiques extraites du fichier (.pkcs7/.p7s/.p7m/.xml/
  // .ps7x/.p12/.pfx…). La clé privée éventuelle n'est JAMAIS en base —
  // seul le fichier chiffré sur le disque la contient.
  certFormat: string;
  certFichierNom: string;
  certChemin: string;
  certSujet: string;
  certEmetteur: string;
  certSerie: string;
  certValideDu: string | null;
  certValideAu: string | null;
  certEmpreinte: string;
  certImportLe: string | null;
  // (NOUVEAU v0.2.112) CLÉ PRIVÉE associée — fichier séparé (.pem/.key/.der) :
  // disponibilité CALCULÉE par l'API (fichier séparé OU coffre .p12/.pfx),
  // nom/type du fichier de clé affichés (jamais la clé elle-même).
  certCleFichierNom: string;
  certCleType: string;
  certClePriveeDisponible: boolean;
  // (NOUVEAU v0.2.88) Switch ON/OFF du certificat de signature : activé = le
  // certificat est appliqué aux documents concernés ; désactivé = non appliqué.
  certActif: boolean;
  // (NOUVEAU v0.2.92) POSITIONNEMENT LIBRE du bloc certificat — mêmes champs
  // que la signature et le QR (position/décalages) + échelle en %.
  certPosition: string;
  certDecalX: number;
  certDecalY: number;
  certTaille: number;
  // (NOUVEAU v0.2.119) cachet « Signature électronique » du tampon —
  // alimenté EN DIRECT par le certificat du module de signature (onglet
  // Paramètres) — seuls les interrupteurs/placement sont éditables ici.
  elecActif: boolean;
  elecPosition: string;
  elecDecalX: number;
  elecDecalY: number;
  elecTaille: number;
  // (NOUVEAU v0.2.120) forme du cachet : RECTANGLE (encadré) | ROND
  elecForme: string;
  // (NOUVEAU v0.2.128) CONTENU du cachet — formulaire de choix des
  // informations affichées (défaut : AUCUNE information du certificat).
  elecAffSignataire: boolean;
  elecAffOrganisation: boolean;
  elecAffEmetteur: boolean;
  elecAffValidite: boolean;
  elecAffEmpreinte: boolean;
  elecTexteLibre: string;
  mentionActif: boolean;
  mentionTexte: string;
}

const TAILLE_FICHIER_MAX = 8_000_000; // ≈ octets du FICHIER image choisi (0.2.48 : encore relevé pour les cachets scannés haute résolution 600 dpi)

// (NOUVEAU Task 181) import de signature électronique multi-formats :
// extensions acceptées par le champ de sélection (le SERVEUR revalide le
// contenu — sniff ASN.1/PEM/XML — et refuse toute extension inconnue).
const EXTENSIONS_CERTIFICAT = [
  "p12", "pfx", "pkcs7", "p7b", "p7c", "p7s", "p7m",
  "xml", "ps7x", "pem", "cer", "crt", "der",
];
const ACCEPT_CERTIFICAT = EXTENSIONS_CERTIFICAT.map((e) => "." + e).join(",");
const COFFRES_PKCS12 = ["p12", "pfx"];
// (NOUVEAU v0.2.112) CLÉ PRIVÉE associée — extensions acceptées (.pem/.key/.der).
const EXTENSIONS_CLE = ["pem", "key", "der"];
const ACCEPT_CLE = EXTENSIONS_CLE.map((e) => "." + e).join(",");
const TAILLE_CERTIFICAT_MAX = 8_000_000; // ≈ octets du fichier de signature choisi

/** Date ISO/Prisma → JJ/MM/AAAA (fr-FR) — fournie par le composant partagé
 * (import dateFr en tête de fichier). */

function choisirImageGenerique(
  f: File | null,
  toast: (o: { title: string; description?: string; variant?: "default" | "destructive" }) => void
): Promise<string | null> {
  if (!f) return Promise.resolve(null);
  if (!/^image\/(png|jpe?g)$/.test(f.type)) {
    toast({
      title: "Format non pris en charge",
      description: "Choisissez une image PNG ou JPEG (cachet, signature scannée, QR fourni…).",
      variant: "destructive",
    });
    return Promise.resolve(null);
  }
  if (f.size > TAILLE_FICHIER_MAX) {
    toast({
      title: "Image trop grande",
      description: "Maximum ≈ 8 Mo. Redimensionnez l'image (une signature de 600–900 px de large suffit largement).",
      variant: "destructive",
    });
    return Promise.resolve(null);
  }
  return new Promise((resolution) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resolution(String(lecteur.result ?? ""));
    lecteur.onerror = () => {
      toast({ title: "Lecture du fichier impossible", variant: "destructive" });
      resolution(null);
    };
    lecteur.readAsDataURL(f);
  });
}

export function SignaturePanel({
  // (v0.2.194 — demande « masquer ce bloc pour le rôle RH dans la section
  // Importer et Demandes ») MASQUER le bloc d'IMPORT du fichier de signature
  // (« Fichier de signature électronique », mot de passe PKCS#12, clé privée
  // associée, notes d'attente/de retrait) — vrai pour le rôle RH (page) :
  // l'import du matériel cryptographique reste réservé au SUPERADMIN. Le
  // reste de la rubrique (interrupteur, positionnement, métadonnées affichées)
  // reste visible ; le certificat enregistré continue de s'appliquer aux
  // fiches de paie quelle que soit la personne qui consulte la section.
  masquerCertificat = false,
}: {
  masquerCertificat?: boolean;
}) {
  const { toast } = useToast();
  const [charge, setCharge] = useState(false);
  const [enregistre, setEnregistre] = useState(false);
  const [apercu, setApercu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileQrRef = useRef<HTMLInputElement>(null);
  const fileCertRef = useRef<HTMLInputElement>(null);
  const fileCleRef = useRef<HTMLInputElement>(null);

  const [cfg, setCfg] = useState<SignatureConfig>({
    actif: false,
    sigActif: false,
    sigImage: "",
    sigTexte: "",
    sigPosition: "BAS_DROITE",
    sigTaille: 120,
    sigOpacite: 0.9,
    qrActif: false,
    qrMode: "DONNEES",
    qrUrl: "",
    qrTexte: "",
    qrImage: "",
    qrPosition: "BAS_GAUCHE",
    qrTaille: 110,
    sigDecalX: 0,
    sigDecalY: 0,
    qrDecalX: 0,
    qrDecalY: 0,
    sigRotation: 0,
    qrRotation: 0,
    sigImageNom: "",
    sigImageChemin: "",
    qrImageNom: "",
    qrImageChemin: "",
    certFormat: "",
    certFichierNom: "",
    certChemin: "",
    certSujet: "",
    certEmetteur: "",
    certSerie: "",
    certValideDu: null,
    certValideAu: null,
    certEmpreinte: "",
    certImportLe: null,
    certCleFichierNom: "",
    certCleType: "",
    certClePriveeDisponible: false,
    certActif: false,
    certPosition: "BAS_CENTRE",
    certDecalX: 0,
    certDecalY: 0,
    certTaille: 100,
    elecActif: false,
    elecPosition: "BAS_DROITE",
    elecDecalX: 0,
    elecDecalY: 0,
    elecTaille: 100,
    elecForme: "RECTANGLE",
    // (NOUVEAU v0.2.128) défaut : aucune information du certificat affichée
    elecAffSignataire: false,
    elecAffOrganisation: false,
    elecAffEmetteur: false,
    elecAffValidite: false,
    elecAffEmpreinte: false,
    elecTexteLibre: "",
    mentionActif: true,
    mentionTexte: "Document signé électroniquement — AutoRH — {DATE}",
  });
  // null = image inchangée (on n'envoie pas le champ) ; "" = retirée ;
  // dataURL = nouvelle image choisie mais pas encore enregistrée.
  const [imageLocale, setImageLocale] = useState<string | null>(null);
  // (NOUVEAU 0.2.47) même sémantique pour l'image du QR fourni (mode IMAGE).
  const [qrImageLocale, setQrImageLocale] = useState<string | null>(null);
  // (NOUVEAU 0.2.58) mêmes sémantiques pour les NOMS des fichiers importés :
  // affichés sous chaque champ (« Fichier importé : … ») et envoyés à l'API
  // en même temps que l'image correspondante.
  const [sigNomLocale, setSigNomLocale] = useState<string | null>(null);
  const [qrNomLocale, setQrNomLocale] = useState<string | null>(null);
  // (NOUVEAU v0.2.92) image QR de l'APERÇU interactif : générée côté client
  // pour les modes DONNÉES / URL / FICHE / TEXTE (contenu indicatif), ou
  // image fournie pour le mode IMAGE.
  const [qrApercu, setQrApercu] = useState("");
  // (NOUVEAU Task 181) certificat de signature électronique : null =
  // inchangé (rien envoyé) ; { nom, base64: "" } = à retirer ;
  // { nom, base64 } = nouveau fichier choisi (pas encore enregistré).
  const [certLocal, setCertLocal] = useState<{ nom: string; base64: string } | null>(null);
  // Mot de passe PKCS#12 (.p12/.pfx) — transmis une SEULE fois avec le
  // fichier, jamais stocké ni conservé après l'enregistrement.
  const [certMdp, setCertMdp] = useState("");
  // (NOUVEAU v0.2.112) CLÉ PRIVÉE associée (fichier séparé) : même sémantique
  // que certLocal — null = inchangée ; { nom, base64: "" } = à retirer ;
  // { nom, base64 } = nouveau fichier choisi. Le mot de passe de la clé
  // (si protégée) ne voyage qu'une fois avec le fichier.
  const [certCleLocal, setCertCleLocal] = useState<{ nom: string; base64: string } | null>(null);
  const [cleMdp, setCleMdp] = useState("");

  const charger = useCallback(async () => {
    try {
      const res = await fetch("/api/signature-config", { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.config) {
        setCfg({ ...cfg, ...d.config });
      } else if (res.status === 403) {
        return; // RH : panneau non affiché de toute façon
      } else {
        toast({ title: "Lecture impossible", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Serveur inaccessible", variant: "destructive" });
    } finally {
      setCharge(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  useEffect(() => {
    charger();
  }, [charger]);

  // (NOUVEAU v0.2.92) GÉNÉRATION de l'image QR de l'aperçu interactif :
  // modes DONNÉES / URL / FICHE / TEXTE → QR indicatif généré côté client ;
  // mode IMAGE → image fournie (locale non enregistrée, sinon configurée).
  useEffect(() => {
    let vivant = true;
    if (!cfg.qrActif) {
      setQrApercu("");
      return;
    }
    if (cfg.qrMode === "IMAGE") {
      setQrApercu(qrImageLocale !== null ? qrImageLocale : cfg.qrImage || "");
      return;
    }
    const contenu =
      cfg.qrMode === "URL" || cfg.qrMode === "FICHE"
        ? cfg.qrUrl || "https://verification.autorh.local"
        : cfg.qrMode === "TEXTE"
          ? cfg.qrTexte || "Aperçu QR — AutoRH"
          : "AutoRH — Fiche de paie\nRéf : APERCU\nEmployé : —\nPériode : —\nEmpreinte : APERCU";
    QRCode.toDataURL(contenu, { margin: 0, width: 320, errorCorrectionLevel: "M" })
      .then((d) => {
        if (vivant) setQrApercu(d);
      })
      .catch(() => {
        if (vivant) setQrApercu("");
      });
    return () => {
      vivant = false;
    };
  }, [cfg.qrActif, cfg.qrMode, cfg.qrUrl, cfg.qrTexte, cfg.qrImage, qrImageLocale]);

  function maj<K extends keyof SignatureConfig>(cle: K, valeur: SignatureConfig[K]) {
    setCfg((c) => ({ ...c, [cle]: valeur }));
  }

  async function choisirImage(f: File | null) {
    const data = await choisirImageGenerique(f, toast);
    if (data !== null) {
      setImageLocale(data);
      // (NOUVEAU 0.2.58) mémorisation du nom du fichier choisi (path
      // d'origine) pour l'affichage « Fichier importé : … ».
      setSigNomLocale(f ? f.name : "");
    }
  }

  async function choisirQrImage(f: File | null) {
    const data = await choisirImageGenerique(f, toast);
    if (data !== null) {
      setQrImageLocale(data);
      setQrNomLocale(f ? f.name : "");
    }
  }

  // (NOUVEAU Task 181) sélection d'un fichier de signature électronique
  // (.pkcs7/.p7s/.p7m/.xml/.ps7x/.p12/.pfx/…). L'extension est contrôlée
  // ici pour l'ergonomie ; le SERVEUR revalide le CONTENU (ASN.1/PEM/XML)
  // au moment de l'enregistrement et refuse tout fichier illisible.
  async function choisirCertificat(f: File | null) {
    if (!f) return;
    const ext = f.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
    if (!EXTENSIONS_CERTIFICAT.includes(ext)) {
      toast({
        title: "Format non pris en charge",
        description:
          "Formats acceptés : .pkcs7, .p7s, .p7m, .xml, .ps7x, .p12, .pfx, .p7b, .p7c, .pem, .cer, .crt, .der.",
        variant: "destructive",
      });
      return;
    }
    if (f.size > TAILLE_CERTIFICAT_MAX) {
      toast({
        title: "Fichier trop grand",
        description: "Maximum ≈ 8 Mo pour un fichier de signature électronique.",
        variant: "destructive",
      });
      return;
    }
    const base64 = await new Promise<string | null>((resolution) => {
      const lecteur = new FileReader();
      lecteur.onload = () => {
        const r = String(lecteur.result ?? "");
        resolution(r.includes(",") ? r.slice(r.indexOf(",") + 1) : r);
      };
      lecteur.onerror = () => {
        toast({ title: "Lecture du fichier impossible", variant: "destructive" });
        resolution(null);
      };
      lecteur.readAsDataURL(f);
    });
    if (base64 === null) return;
    setCertLocal({ nom: f.name, base64 });
    if (!COFFRES_PKCS12.includes(ext)) setCertMdp("");
    toast({
      title: "Fichier prêt — cliquez sur « Enregistrer »",
      description: COFFRES_PKCS12.includes(ext)
        ? "Fichier PKCS#12 détecté : saisissez son mot de passe pour l'import."
        : "Le certificat sera vérifié par le serveur à l'enregistrement.",
    });
  }

  function extensionCertLocal(): string {
    const nom = certLocal?.nom ?? cfg.certFichierNom ?? "";
    return nom.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  }

  // (NOUVEAU v0.2.112) sélection d'un FICHIER DE CLÉ PRIVÉE (.pem/.key/.der)
  // à associer au certificat — utile quand le certificat est importé SEUL
  // (.cer/.pem…) et que la clé n'est PAS encore dans le système.
  async function choisirClePrivee(f: File | null) {
    if (!f) return;
    const ext = f.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
    if (!EXTENSIONS_CLE.includes(ext)) {
      toast({
        title: "Format de clé non pris en charge",
        description: "Formats acceptés : .pem, .key, .der (PKCS#8 ou PKCS#1, clair ou chiffré).",
        variant: "destructive",
      });
      return;
    }
    if (f.size > TAILLE_CERTIFICAT_MAX) {
      toast({
        title: "Fichier trop grand",
        description: "Maximum ≈ 8 Mo pour un fichier de clé privée.",
        variant: "destructive",
      });
      return;
    }
    const base64 = await new Promise<string | null>((resolution) => {
      const lecteur = new FileReader();
      lecteur.onload = () => {
        const r = String(lecteur.result ?? "");
        resolution(r.includes(",") ? r.slice(r.indexOf(",") + 1) : r);
      };
      lecteur.onerror = () => {
        toast({ title: "Lecture du fichier impossible", variant: "destructive" });
        resolution(null);
      };
      lecteur.readAsDataURL(f);
    });
    if (base64 === null) return;
    setCertCleLocal({ nom: f.name, base64 });
    toast({
      title: "Clé privée prête — cliquez sur « Enregistrer »",
      description:
        "Le serveur vérifiera la clé (et son mot de passe s'il est protégé) puis son APPARIEMENT avec le certificat.",
    });
  }

  function imageAffichee(): string {
    return imageLocale === null ? cfg.sigImage : imageLocale;
  }

  function qrImageAffichee(): string {
    return qrImageLocale === null ? cfg.qrImage : qrImageLocale;
  }

  // (NOUVEAU 0.2.58) nom affiché de chaque image importée : le nom local
  // non encore enregistré prime, sinon celui connu en base (vide si
  // l'image a été posée avant la v0.2.58).
  function sigNomAffiche(): string {
    return sigNomLocale === null ? cfg.sigImageNom : sigNomLocale;
  }

  function qrNomAffiche(): string {
    return qrNomLocale === null ? cfg.qrImageNom : qrNomLocale;
  }

  function corpsConfig(): Record<string, unknown> {
    const corps: Record<string, unknown> = { ...cfg };
    if (imageLocale !== null) {
      corps.sigImage = imageLocale;
      // l'image ET son nom voyagent toujours ensemble (effacement = "").
      corps.sigImageNom = sigNomLocale ?? "";
    }
    if (qrImageLocale !== null) {
      corps.qrImage = qrImageLocale;
      corps.qrImageNom = qrNomLocale ?? "";
    }
    // (NOUVEAU Task 181) certificat de signature électronique : envoyé
    // UNIQUEMENT si un fichier a été choisi (ou "" pour le retirer) — le
    // mot de passe PKCS#12, s'il a été saisi, ne voyage qu'avec le fichier
    // et n'est jamais mémorisé.
    if (certLocal !== null) {
      corps.certFichier = certLocal.base64;
      corps.certFichierNom = certLocal.nom;
      if (certLocal.base64 && certMdp) corps.certMotDePasse = certMdp;
    }
    // (NOUVEAU v0.2.112) clé privée associée : envoyée UNIQUEMENT si un
    // fichier a été choisi (ou "" pour la retirer) — son mot de passe, s'il
    // a été saisi, ne voyage qu'avec le fichier.
    if (certCleLocal !== null) {
      corps.certCleFichier = certCleLocal.base64;
      corps.certCleFichierNom = certCleLocal.nom;
      if (certCleLocal.base64 && cleMdp) corps.certCleMotDePasse = cleMdp;
    }
    return corps;
  }

  async function enregistrer() {
    setEnregistre(true);
    try {
      const res = await fetch("/api/signature-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpsConfig()),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setCfg({ ...cfg, ...d.config });
        setImageLocale(null);
        setQrImageLocale(null);
        setSigNomLocale(null);
        setQrNomLocale(null);
        setCertLocal(null);
        setCertMdp("");
        setCertCleLocal(null);
        setCleMdp("");
        // (MODIFIÉ v0.2.123) — SWITCH PRINCIPAL INDÉPENDANT : le message ne
        // dit plus « Activez l'interrupteur général » quand il est DÉJÀ ON
        // (cas actif=true + aucun élément activé) — c'est ce message qui
        // faisait croire à une dépendance du switch principal envers le
        // switch « Signature électronique ».
        // (MODIFIÉ v0.2.137) — QUATRIÈME CAS : le cachet « Signature
        // électronique » est ACTIVÉ (elecActif) mais le module « API de
        // certification & signature » ne couvre pas les fiches (inactif,
        // certificat absent ou couverture décochée — elecCouvert=false).
        // Avant : message générique trompeur « Aucun élément du tampon n'est
        // activé » alors que le cachet EST activé — c'est le module qui
        // manque. Quatre cas désormais distingués.
        const actifGeneral = Boolean(d.config?.actif ?? cfg.actif);
        const elecDemande = Boolean(d.config?.elecActif);
        const elecCouvert = Boolean(d.elecCouvert);
        toast({
          title: d.tamponActif
            ? "Tampon signature / QR enregistré"
            : actifGeneral && elecDemande && !elecCouvert
              ? "Tampon enregistré — cachet « Signature électronique » en attente du module"
              : actifGeneral
                ? "Tampon enregistré — interrupteur général ACTIF"
                : "Tampon enregistré — actuellement désactivé",
          description: d.tamponActif
            ? "Chaque consultation ou téléchargement de fiche (administration et portail) est maintenant tamponnée automatiquement."
            : actifGeneral && elecDemande && !elecCouvert
              ? "Le cachet « Signature électronique » est bien activé, mais il n'est apposé que si le module « API de certification & signature » (onglet Paramètres) est ACTIF, avec un certificat chargé et la couverture des fiches de paie cochée. Aucune fiche n'est tamponnée tant que ce module n'est pas opérationnel."
              : actifGeneral
                ? "Aucun élément du tampon n'est activé (« Signature électronique », Code QR, Mention légale, Certificat, Cachet « Signature électronique »). Le switch principal fonctionne INDÉPENDAMMENT de chacun — activez au moins un élément pour que le tampon s'applique aux fiches."
                : "Activez l'interrupteur général pour tamponner les fiches.",
        });
      } else {
        toast({ title: "Enregistrement impossible", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Serveur inaccessible", variant: "destructive" });
    } finally {
      setEnregistre(false);
    }
  }

  async function apercuPdf() {
    setApercu(true);
    try {
      const res = await fetch("/api/signature-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apercu", ...corpsConfig() }),
      });
      if (res.ok) {
        // (NOUVEAU 0.2.47) l'API indique la fiche utilisée : la DERNIÈRE fiche
        // importée (rendu réel) ou l'exemple synthétique si la base est vide.
        const brut = res.headers.get("X-Apercu-Fiche") || "";
        let libelle = "";
        try { libelle = brut ? decodeURIComponent(brut) : ""; } catch { libelle = ""; }
        toast({
          title: libelle
            ? "Aperçu généré sur la fiche de " + libelle
            : "Aperçu généré sur une fiche d'exemple",
          description: libelle
            ? "C'est votre DERNIÈRE fiche importée : le rendu correspond exactement à l'affichage final."
            : "Importez une fiche de paie pour prévisualiser sur un document réel.",
        });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        const d = await res.json().catch(() => ({}));
        toast({ title: "Aperçu impossible", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Serveur inaccessible", variant: "destructive" });
    } finally {
      setApercu(false);
    }
  }

  // (MODIFIÉ v0.2.88) le certificat de signature (Switch certActif) compte
  // lui aussi comme élément du tampon — quand un certificat est importé.
  // (NOUVEAU v0.2.119) le cachet « Signature électronique » (elecActif)
  // compte lui aussi (badge d'état + affichage de l'aperçu interactif).
  const auMoinsUn =
    cfg.sigActif || cfg.qrActif || cfg.mentionActif ||
    (cfg.certActif && Boolean(cfg.certSujet) && Boolean(cfg.certEmpreinte)) ||
    cfg.elecActif;

  // (NOUVEAU v0.2.100) géométrie du bloc certificat en points PDF (jumelle du
  // moteur — lignes réelles ou bloc d'exemple) — sert aux champs « Position
  // exacte X/Y (mm) » de la rubrique certificat : X depuis le bord gauche,
  // Y depuis le bord bas (origine PDF).
  const geoCert = geometrieCertificat(cfg, cfg.mentionActif);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileSignature className="h-5 w-5 text-emerald-600" />
            Signature électronique &amp; QR code
          </CardTitle>
          <CardDescription className="mt-1.5">
            Apposés automatiquement sur chaque fiche de paie après l&apos;importation —
            à l&apos;affichage comme au téléchargement, dans l&apos;administration comme sur le
            portail employé. L&apos;original reste intact sur le serveur. (Task 244)
            PRÉSERVATION DE LA SIGNATURE D&apos;ORIGINE : chaque fiche déjà signée
            conserve DÉFINITIVEMENT la signature qui lui a été posée en premier —
            modifier ou remplacer la signature ici (image, position, QR, cachet,
            certificat) ne change RIEN aux fiches déjà signées (portails Employé
            et Administration, vérification QR) et n&apos;y est jamais réappliqué ;
            la nouvelle configuration ne s&apos;applique qu&apos;aux fiches pas encore
            signées (nouvelles fiches). (v0.2.93) Cette configuration concerne les
            FICHES DE PAIE — les documents de réponse aux demandes disposent de
            leur propre configuration dans l&apos;onglet Demandes (section
            «&nbsp;Demandes / Réponses&nbsp;»). Les images importées ici restent
            partagées ; depuis la v0.2.99, le certificat de signature est
            TOTALEMENT DÉDIÉ à chaque section (fichier, mot de passe,
            positionnement) — ce que vous modifiez ici n&apos;affecte pas les
            réponses, et inversement.
          </CardDescription>
        </div>
        {/* (MODIFIÉ v0.2.123) — SWITCH PRINCIPAL INDÉPENDANT : le badge ne
            montre plus « Tampon désactivé » quand l'interrupteur général est
            ON mais qu'aucun élément n'est activé — un état AMBRE « en
            attente » reflète fidèlement la position du switch principal. */}
        {charge && (
          <Badge
            variant="outline"
            className={
              !cfg.actif
                ? "border-muted-foreground text-muted-foreground"
                : auMoinsUn
                  ? "border-emerald-600 text-emerald-700"
                  : "border-amber-600 text-amber-700"
            }
          >
            {!cfg.actif
              ? "Tampon désactivé"
              : auMoinsUn
                ? "Tampon actif"
                : "Tampon en attente d'un élément"}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {!charge ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement de la configuration…
          </div>
        ) : (
          <>
            {/* Interrupteur général */}
            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div>
                <Label htmlFor="tampon-actif" className="text-sm font-medium">
                  Tampon automatique des fiches
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  S&apos;applique à toutes les fiches PDF, y compris celles importées avant
                  l&apos;activation. Aucune réimportation nécessaire. (v0.2.123) Switch
                  principal INDÉPENDANT : l&apos;activer/le désactiver ne change AUCUN autre
                  interrupteur — «&nbsp;Signature électronique&nbsp;», Code QR, Mention,
                  Certificat et Cachet gardent leur propre état ; le tampon s&apos;applique
                  dès que ce switch est ON et qu&apos;au moins un élément est ON.
                </p>
              </div>
              <Switch
                id="tampon-actif"
                checked={cfg.actif}
                onCheckedChange={(v) => maj("actif", v)}
              />
            </div>

            {/* (MODIFIÉ v0.2.93) — POSITIONNEMENT LIBRE MULTI-ÉLÉMENTS : aperçu
                A4 interactif affichant la signature, le QR ET le bloc
                certificat (quand actifs). Clic = positionner, glisser =
                déplacer CHACUN indépendamment. Géométrie répliquée depuis
                coinVersBoite()/certVersBoite() de stamp.ts. (v0.2.93) ce
                placement s'applique aux FICHES DE PAIE — les documents de
                réponse possèdent leur PROPRE configuration et leur propre
                aperçu dans l'onglet Demandes (section Demandes / Réponses).
                Composant PARTAGÉ avec cette seconde section. */}
            {cfg.actif && (cfg.sigActif || (cfg.qrActif && Boolean(qrApercu)) || cfg.certActif || cfg.elecActif) && (
              <ApercuPositionnement
                cfg={cfg}
                imageSig={imageAffichee()}
                imageQr={qrApercu}
                // (CORRECTIF v0.2.201) : voir signature-panel-reponses.tsx
                // (maj générique → cast vers la signature CleDecal attendue).
                maj={maj as (cle: CleDecal, valeur: number) => void}
                majTailleCert={(v) => maj("certTaille", v)}
                libelleFiche="A4 — fiches de paie"
                note="Ce placement s'applique aux FICHES DE PAIE uniquement (affichage comme téléchargement, administration et portail) — les curseurs de décalage suivent le glisser en temps réel ; l'aperçu PDF final reste la référence exacte. Les documents de réponse aux demandes ont leur propre configuration dans l'onglet Demandes."
              />
            )}

            {/* ---------- Signature électronique ---------- */}
            <div className="rounded-lg border p-4 space-y-3.5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    <BadgeCheck className="h-4 w-4 text-emerald-600" />
                    Signature électronique
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Image (cachet ou signature scannée) et/ou ligne de texte.
                  </p>
                </div>
                <Switch checked={cfg.sigActif} onCheckedChange={(v) => maj("sigActif", v)} />
              </div>

              {cfg.sigActif && (
                <>
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
                    <div className="space-y-1.5">
                      <Label htmlFor="tampon-image" className="text-xs">
                        Image de signature / cachet (PNG ou JPEG, max ≈ 8 Mo)
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="tampon-image"
                          type="file"
                          accept="image/png,image/jpeg"
                          ref={fileRef}
                          onChange={(e) => choisirImage(e.target.files?.[0] ?? null)}
                          className="h-9 text-xs"
                        />
                        {imageAffichee() && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setImageLocale("");
                              // (NOUVEAU 0.2.58) le nom suit l'image.
                              setSigNomLocale("");
                              if (fileRef.current) fileRef.current.value = "";
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      {imageAffichee() && (
                        <div className="mt-2 rounded-md border bg-white p-2 inline-block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={imageAffichee()}
                            alt="Aperçu de la signature"
                            className="max-h-20 max-w-[220px] object-contain"
                          />
                        </div>
                      )}
                      {/* NOUVEAU (0.2.58) — PATH : l'emplacement de l'image de
                          tampon importée — « Fichier importé » (nom d'origine)
                          et « Emplacement » (copie de contrôle storage/tampons/
                          + rappel que la source de vérité du rendu est la base). */}
                      {imageAffichee() && (
                        <div className="mt-1.5 space-y-0.5 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
                          <p className="flex items-start gap-1.5">
                            <FileImage className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                            <span>
                              <b>Fichier importé :</b>{" "}
                              {sigNomAffiche() || "(nom d'origine inconnu — image enregistrée avant la v0.2.58)"}
                            </span>
                          </p>
                          {imageLocale !== null ? (
                            <p className="text-muted-foreground">
                              Nouvelle image non enregistrée : cliquez sur «&nbsp;Enregistrer la configuration&nbsp;» —
                              une copie chiffrée (AES-256) sera exportée dans <b>storage/tampons/</b> et son chemin sera affiché ici.
                            </p>
                          ) : cfg.sigImageChemin ? (
                            <p className="text-muted-foreground">
                              <b>Emplacement :</b> {cfg.sigImageChemin} — copie de contrôle CHIFFRÉE sur le serveur (AES-256, illisible comme les fiches).
                            </p>
                          ) : (
                            <p className="text-muted-foreground">
                              <b>Emplacement :</b> base de données du service (image appliquée à chaque fiche au servage).
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="tampon-texte" className="text-xs">
                      Ligne de texte sous l&apos;image (optionnel — ex. « Le Directeur des
                      Ressources Humaines »)
                    </Label>
                    <Textarea
                      id="tampon-texte"
                      value={cfg.sigTexte}
                      onChange={(e) => maj("sigTexte", e.target.value)}
                      rows={2}
                      className="text-sm"
                      placeholder="Le Directeur des Ressources Humaines&#10;Société EXEMPLE — Tunis"
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Position</Label>
                      <Select value={cfg.sigPosition} onValueChange={(v) => maj("sigPosition", v)}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {POSITIONS.map((p) => (
                            <SelectItem key={p.valeur} value={p.valeur}>{p.libelle}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-xs">Largeur de l&apos;image : {cfg.sigTaille} pt</Label>
                        <Input
                          type="number"
                          min={TAILLE_MIN}
                          max={TAILLE_MAX}
                          step={1}
                          value={cfg.sigTaille}
                          onChange={(e) => maj("sigTaille", Number(e.target.value) || 0)}
                          className="h-7 w-20 shrink-0 text-xs"
                        />
                      </div>
                      <Slider
                        value={[cfg.sigTaille]}
                        min={TAILLE_MIN}
                        max={TAILLE_MAX}
                        step={5}
                        onValueChange={([v]) => maj("sigTaille", v)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        Opacité : {Math.round(cfg.sigOpacite * 100)} %
                      </Label>
                      <Slider
                        value={[cfg.sigOpacite]}
                        min={0.3}
                        max={1}
                        step={0.05}
                        onValueChange={([v]) => maj("sigOpacite", v)}
                      />
                    </div>
                  </div>

                  {/* NOUVEAU (0.2.47) : décalages fins de la signature —
                      ajustement précis sur le rendu réel (voir Aperçu).
                      (CLARIFIÉ 0.2.52) sens explicite : + = droite / + = haut.
                      (LIBÉRÉ 0.2.54) ±1500 pt = placement libre sur toute la
                      feuille (curseur rapide + saisie exacte). */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-xs">
                          Décalage horizontal : {cfg.sigDecalX > 0 ? "+" : ""}{cfg.sigDecalX} pt
                          <span className="ml-1 font-normal text-muted-foreground">(− = gauche, + = droite)</span>
                        </Label>
                        <Input
                          type="number"
                          min={DECAL_MIN}
                          max={DECAL_MAX}
                          step={1}
                          value={cfg.sigDecalX}
                          onChange={(e) => maj("sigDecalX", Number(e.target.value) || 0)}
                          className="h-7 w-20 shrink-0 text-xs"
                        />
                      </div>
                      <Slider
                        value={[cfg.sigDecalX]}
                        min={DECAL_MIN}
                        max={DECAL_MAX}
                        step={5}
                        onValueChange={([v]) => maj("sigDecalX", v)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-xs">
                          Décalage vertical : {cfg.sigDecalY > 0 ? "+" : ""}{cfg.sigDecalY} pt
                          <span className="ml-1 font-normal text-muted-foreground">(− = bas, + = haut)</span>
                        </Label>
                        <Input
                          type="number"
                          min={DECAL_MIN}
                          max={DECAL_MAX}
                          step={1}
                          value={cfg.sigDecalY}
                          onChange={(e) => maj("sigDecalY", Number(e.target.value) || 0)}
                          className="h-7 w-20 shrink-0 text-xs"
                        />
                      </div>
                      <Slider
                        value={[cfg.sigDecalY]}
                        min={DECAL_MIN}
                        max={DECAL_MAX}
                        step={5}
                        onValueChange={([v]) => maj("sigDecalY", v)}
                      />
                    </div>
                  </div>

                  {/* (MODIFIÉ v0.2.92) l'aperçu A4 MULTI-ÉLÉMENTS (signature +
                      QR + certificat) est DÉPLACÉ juste après l'interrupteur
                      général : il reste disponible même quand la signature
                      est désactivée (positionnement du QR et du certificat). */}

                  {/* NOUVEAU (0.2.54) : ROTATION de la signature — angle
                      réglable de 0° à 360°, sens horaire, pivot = centre de
                      l'élément. Appliquée à TOUS les formats (PDF, DOCX,
                      PNG, XLSX). */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-xs">
                        Rotation de la signature : {cfg.sigRotation}°
                        <span className="ml-1 font-normal text-muted-foreground">(sens horaire, 0 à 360°)</span>
                      </Label>
                      <Input
                        type="number"
                        min={ROTATION_MIN}
                        max={ROTATION_MAX}
                        step={1}
                        value={cfg.sigRotation}
                        onChange={(e) => maj("sigRotation", Number(e.target.value) || 0)}
                        className="h-7 w-20 shrink-0 text-xs"
                      />
                    </div>
                    <Slider
                      value={[cfg.sigRotation]}
                      min={ROTATION_MIN}
                      max={ROTATION_MAX}
                      step={5}
                      onValueChange={([v]) => maj("sigRotation", v)}
                    />
                  </div>
                </>
              )}
            </div>

            {/* ---------- QR code ---------- */}
            <div className="rounded-lg border p-4 space-y-3.5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    <QrCode className="h-4 w-4 text-emerald-600" />
                    Code QR
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Lisible par n&apos;importe quelle application de lecture de QR.
                  </p>
                </div>
                <Switch checked={cfg.qrActif} onCheckedChange={(v) => maj("qrActif", v)} />
              </div>

              {cfg.qrActif && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Contenu du QR</Label>
                    <Select value={cfg.qrMode} onValueChange={(v) => maj("qrMode", v)}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DONNEES">
                          Données de la fiche (réf., employé, CIN, période, net, empreinte)
                        </SelectItem>
                        <SelectItem value="URL">URL de vérification</SelectItem>
                        {/* NOUVEAU (Task 180, v0.2.86) : QR FICHE EN LIGNE —
                            lien signé propre à chaque fiche, ouvre la page
                            publique de vérification avec ouverture du PDF. */}
                        <SelectItem value="FICHE">
                          Fiche en ligne (le QR ouvre CETTE fiche sur ce serveur)
                        </SelectItem>
                        <SelectItem value="TEXTE">Texte personnalisé</SelectItem>
                        {/* NOUVEAU (0.2.47) : QR FOURNI par l'établissement —
                            image importée, affichée telle quelle. */}
                        <SelectItem value="IMAGE">Image fournie (QR importé)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {cfg.qrMode === "URL" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="tampon-qr-url" className="text-xs">
                        Adresse de vérification (le QR ouvre : adresse + réf. + CIN + empreinte)
                      </Label>
                      <Input
                        id="tampon-qr-url"
                        value={cfg.qrUrl}
                        onChange={(e) => maj("qrUrl", e.target.value)}
                        placeholder="https://verif.monentreprise.tn/fiche"
                        className="h-9 text-sm"
                      />
                    </div>
                  )}
                  {/* NOUVEAU (Task 180, v0.2.86) : mode FICHE EN LIGNE — le champ est
                      le MÊME qrUrl (adresse de base du serveur) que le mode
                      URL ; les deux modes partagent l'adresse saisie. */}
                  {cfg.qrMode === "FICHE" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="tampon-qr-url" className="text-xs">
                        Adresse publique du serveur (le QR ouvre : adresse + page de vérification de la fiche)
                      </Label>
                      <Input
                        id="tampon-qr-url"
                        value={cfg.qrUrl}
                        onChange={(e) => maj("qrUrl", e.target.value)}
                        placeholder="http://192.168.1.20:4000"
                        className="h-9 text-sm"
                      />
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Chaque fiche reçoit SON PROPRE lien signé (jeton de contrôle unique) : le
                        scan ouvre la page publique de vérification de CETTE fiche — « Document
                        authentique », détails et bouton d&apos;ouverture du PDF. Aucune connexion
                        n&apos;est demandée à la personne qui scanne ; le lien cesse de fonctionner
                        si la fiche est retirée du serveur. Saisissez l&apos;adresse COMPLÈTE du site
                        d&apos;administration (protocole + adresse IP ou nom + port). Adresse vide =
                        QR non apposé.
                      </p>
                    </div>
                  )}
                  {cfg.qrMode === "TEXTE" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="tampon-qr-texte" className="text-xs">
                        Texte encodé dans le QR
                      </Label>
                      <Textarea
                        id="tampon-qr-texte"
                        value={cfg.qrTexte}
                        onChange={(e) => maj("qrTexte", e.target.value)}
                        rows={2}
                        className="text-sm"
                      />
                    </div>
                  )}

                  {/* NOUVEAU (0.2.47) : import de l'image du QR fourni —
                      mêmes règles que l'image de signature (PNG/JPEG, 8 Mo). */}
                  {cfg.qrMode === "IMAGE" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="tampon-qr-image" className="text-xs">
                        Image du QR à importer (PNG ou JPEG, max ≈ 8 Mo)
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="tampon-qr-image"
                          type="file"
                          accept="image/png,image/jpeg"
                          ref={fileQrRef}
                          onChange={(e) => choisirQrImage(e.target.files?.[0] ?? null)}
                          className="h-9 text-xs"
                        />
                        {qrImageAffichee() && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setQrImageLocale("");
                              // (NOUVEAU 0.2.58) le nom suit l'image.
                              setQrNomLocale("");
                              if (fileQrRef.current) fileQrRef.current.value = "";
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      {qrImageAffichee() ? (
                        <div className="mt-2 rounded-md border bg-white p-2 inline-block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={qrImageAffichee()}
                            alt="Aperçu du QR fourni"
                            className="max-h-24 max-w-[220px] object-contain"
                          />
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Aucune image choisie : importez le QR de l&apos;établissement
                          (il sera affiché tel quel sur chaque fiche).
                        </p>
                      )}
                      {/* NOUVEAU (0.2.58) — PATH du QR importé : mêmes
                          informations que l'image de signature (nom d'origine
                          + copie de contrôle storage/tampons/). */}
                      {qrImageAffichee() && (
                        <div className="mt-1.5 space-y-0.5 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
                          <p className="flex items-start gap-1.5">
                            <FileImage className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                            <span>
                              <b>Fichier importé :</b>{" "}
                              {qrNomAffiche() || "(nom d'origine inconnu — image enregistrée avant la v0.2.58)"}
                            </span>
                          </p>
                          {qrImageLocale !== null ? (
                            <p className="text-muted-foreground">
                              Nouvelle image non enregistrée : cliquez sur «&nbsp;Enregistrer la configuration&nbsp;» —
                              une copie chiffrée (AES-256) sera exportée dans <b>storage/tampons/</b> et son chemin sera affiché ici.
                            </p>
                          ) : cfg.qrImageChemin ? (
                            <p className="text-muted-foreground">
                              <b>Emplacement :</b> {cfg.qrImageChemin} — copie de contrôle CHIFFRÉE sur le serveur (AES-256, illisible comme les fiches).
                            </p>
                          ) : (
                            <p className="text-muted-foreground">
                              <b>Emplacement :</b> base de données du service (image appliquée à chaque fiche au servage).
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Position</Label>
                      <Select value={cfg.qrPosition} onValueChange={(v) => maj("qrPosition", v)}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {POSITIONS.map((p) => (
                            <SelectItem key={p.valeur} value={p.valeur}>{p.libelle}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-xs">Taille du QR : {cfg.qrTaille} pt</Label>
                        <Input
                          type="number"
                          min={TAILLE_MIN}
                          max={TAILLE_MAX}
                          step={1}
                          value={cfg.qrTaille}
                          onChange={(e) => maj("qrTaille", Number(e.target.value) || 0)}
                          className="h-7 w-20 shrink-0 text-xs"
                        />
                      </div>
                      <Slider
                        value={[cfg.qrTaille]}
                        min={TAILLE_MIN}
                        max={TAILLE_MAX}
                        step={5}
                        onValueChange={([v]) => maj("qrTaille", v)}
                      />
                    </div>
                  </div>

                  {/* NOUVEAU (0.2.47) : décalages fins — ajustement précis de
                      l'emplacement sur le rendu réel (voir Aperçu).
                      (CLARIFIÉ 0.2.52) sens explicite : + = droite / + = haut.
                      (LIBÉRÉ 0.2.54) ±1500 pt = placement libre sur toute la
                      feuille (curseur rapide + saisie exacte). */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-xs">
                          Décalage horizontal : {cfg.qrDecalX > 0 ? "+" : ""}{cfg.qrDecalX} pt
                          <span className="ml-1 font-normal text-muted-foreground">(− = gauche, + = droite)</span>
                        </Label>
                        <Input
                          type="number"
                          min={DECAL_MIN}
                          max={DECAL_MAX}
                          step={1}
                          value={cfg.qrDecalX}
                          onChange={(e) => maj("qrDecalX", Number(e.target.value) || 0)}
                          className="h-7 w-20 shrink-0 text-xs"
                        />
                      </div>
                      <Slider
                        value={[cfg.qrDecalX]}
                        min={DECAL_MIN}
                        max={DECAL_MAX}
                        step={5}
                        onValueChange={([v]) => maj("qrDecalX", v)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-xs">
                          Décalage vertical : {cfg.qrDecalY > 0 ? "+" : ""}{cfg.qrDecalY} pt
                          <span className="ml-1 font-normal text-muted-foreground">(− = bas, + = haut)</span>
                        </Label>
                        <Input
                          type="number"
                          min={DECAL_MIN}
                          max={DECAL_MAX}
                          step={1}
                          value={cfg.qrDecalY}
                          onChange={(e) => maj("qrDecalY", Number(e.target.value) || 0)}
                          className="h-7 w-20 shrink-0 text-xs"
                        />
                      </div>
                      <Slider
                        value={[cfg.qrDecalY]}
                        min={DECAL_MIN}
                        max={DECAL_MAX}
                        step={5}
                        onValueChange={([v]) => maj("qrDecalY", v)}
                      />
                    </div>
                  </div>

                  {/* NOUVEAU (0.2.54) : ROTATION du QR — angle réglable de 0°
                      à 360°, sens horaire, pivot = centre du QR. Appliquée à
                      TOUS les formats (PDF, DOCX, PNG, XLSX). */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-xs">
                        Rotation du QR : {cfg.qrRotation}°
                        <span className="ml-1 font-normal text-muted-foreground">(sens horaire, 0 à 360°)</span>
                      </Label>
                      <Input
                        type="number"
                        min={ROTATION_MIN}
                        max={ROTATION_MAX}
                        step={1}
                        value={cfg.qrRotation}
                        onChange={(e) => maj("qrRotation", Number(e.target.value) || 0)}
                        className="h-7 w-20 shrink-0 text-xs"
                      />
                    </div>
                    <Slider
                      value={[cfg.qrRotation]}
                      min={ROTATION_MIN}
                      max={ROTATION_MAX}
                      step={5}
                      onValueChange={([v]) => maj("qrRotation", v)}
                    />
                  </div>
                </>
              )}
            </div>

            {/* ---------- Mention légale ---------- */}
            <div className="rounded-lg border p-4 space-y-3.5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label className="text-sm font-medium">Mention légale en pied de fiche</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Ligne de texte centrée — « {'{DATE}'} » est remplacée par la date
                    d&apos;apposition du tampon.
                  </p>
                </div>
                <Switch checked={cfg.mentionActif} onCheckedChange={(v) => maj("mentionActif", v)} />
              </div>
              {cfg.mentionActif && (
                <Input
                  value={cfg.mentionTexte}
                  onChange={(e) => maj("mentionTexte", e.target.value)}
                  placeholder="Document signé électroniquement — AutoRH — {DATE}"
                  className="h-9 text-sm"
                />
              )}
            </div>

            {/* ---------- Certificat de signature électronique (NOUVEAU Task 181) ---------- */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    Certificat de signature électronique
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Import d&apos;une signature cryptographique en formats professionnels :
                    <b> .pkcs7, .p7s, .p7m, .xml, .ps7x, .p12, .pfx</b> — et formats compatibles
                    (.p7b, .p7c, .pem, .cer, .crt, .der). Le fichier est validé par son contenu
                    puis enregistré CHIFFRÉ sur le serveur (AES-256) ; seules les informations
                    publiques du certificat sont affichées ici — la clé privée éventuelle
                    (.p12/.pfx) n&apos;est jamais exposée.
                  </p>
                </div>
                {cfg.certFormat && certLocal === null && (
                  <Badge variant="outline" className="border-emerald-600 text-emerald-700 shrink-0">
                    {cfg.certFormat}
                  </Badge>
                )}
              </div>

              {/* ---------- (NOUVEAU v0.2.88) Switch ON/OFF du certificat ---------- */}
              <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/30 px-3 py-2.5">
                <div>
                  <Label htmlFor="certificat-actif" className="text-sm font-medium">
                    Utiliser le certificat de signature
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Activé (ON) : le certificat est appliqué aux FICHES DE PAIE — un bloc
                    d&apos;information lisible (titulaire, émetteur, validité, empreinte SHA-256)
                    est apposé sur chaque fiche. Il fonctionne SEUL, sans condition :
                    la signature image, le QR et la mention peuvent rester désactivés.
                    Désactivé (OFF) : le certificat n&apos;est appliqué à aucune fiche (il reste
                    importé et conservé sur le serveur). Les réponses aux demandes possèdent
                    leur PROPRE certificat — fichier, mot de passe, interrupteur et
                    positionnement entièrement dédiés (onglet Demandes — section
                    «&nbsp;Demandes / Réponses&nbsp;», v0.2.99) : ce que vous faites ici ne les
                    affecte pas.
                  </p>
                </div>
                <Switch
                  id="certificat-actif"
                  checked={cfg.certActif}
                  onCheckedChange={(v) => maj("certActif", v)}
                  className="mt-1 shrink-0"
                />
              </div>

              {/* ---------- (NOUVEAU v0.2.92, ÉTENDU v0.2.100) POSITIONNEMENT
                  LIBRE du bloc certificat — VISIBLE DÈS QUE LE CERTIFICAT EST
                  ACTIVÉ, même avant l'import d'un fichier (l'aperçu A4 montre
                  alors un bloc d'exemple préparatoire). Réglages : position
                  (5 choix), taille du bloc 50→300 % (curseur + POIGNÉE DE
                  REDIMENSIONNEMENT sur l'aperçu), décalages fins ±1500 pt et
                  POSITION EXACTE X/Y en mm — indépendants du QR et de la
                  signature, et DÉDIÉS à cette section. */}
              {cfg.certActif && (
                <>
                  {!(cfg.certSujet.trim() && cfg.certEmpreinte.trim()) && (
                    <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                      Aucun certificat importé pour le moment : les réglages ci-dessous
                      définissent d&apos;ores et déjà le placement du bloc « Signature
                      électronique certifiée » — ils seront appliqués dès qu&apos;un fichier de
                      certificat sera importé et enregistré. L&apos;aperçu A4 ci-dessus montre un
                      bloc d&apos;exemple pour préparer ce placement (glisser, poignée ambrée).
                    </p>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Position du bloc certificat</Label>
                      <Select value={cfg.certPosition} onValueChange={(v) => maj("certPosition", v)}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {POSITIONS_CERT.map((p) => (
                            <SelectItem key={p.valeur} value={p.valeur}>{p.libelle}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-xs">Taille du bloc : {cfg.certTaille} %</Label>
                        <Input
                          type="number"
                          min={CERT_TAILLE_MIN}
                          max={CERT_TAILLE_MAX}
                          step={5}
                          value={cfg.certTaille}
                          onChange={(e) => maj("certTaille", Number(e.target.value) || 0)}
                          className="h-7 w-20 shrink-0 text-xs"
                        />
                      </div>
                      <Slider
                        value={[cfg.certTaille]}
                        min={CERT_TAILLE_MIN}
                        max={CERT_TAILLE_MAX}
                        step={5}
                        onValueChange={([v]) => maj("certTaille", v)}
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-xs">
                          Décalage horizontal : {cfg.certDecalX > 0 ? "+" : ""}{cfg.certDecalX} pt
                          <span className="ml-1 font-normal text-muted-foreground">(− = gauche, + = droite)</span>
                        </Label>
                        <Input
                          type="number"
                          min={DECAL_MIN}
                          max={DECAL_MAX}
                          step={1}
                          value={cfg.certDecalX}
                          onChange={(e) => maj("certDecalX", Number(e.target.value) || 0)}
                          className="h-7 w-20 shrink-0 text-xs"
                        />
                      </div>
                      <Slider
                        value={[cfg.certDecalX]}
                        min={DECAL_MIN}
                        max={DECAL_MAX}
                        step={5}
                        onValueChange={([v]) => maj("certDecalX", v)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-xs">
                          Décalage vertical : {cfg.certDecalY > 0 ? "+" : ""}{cfg.certDecalY} pt
                          <span className="ml-1 font-normal text-muted-foreground">(− = bas, + = haut)</span>
                        </Label>
                        <Input
                          type="number"
                          min={DECAL_MIN}
                          max={DECAL_MAX}
                          step={1}
                          value={cfg.certDecalY}
                          onChange={(e) => maj("certDecalY", Number(e.target.value) || 0)}
                          className="h-7 w-20 shrink-0 text-xs"
                        />
                      </div>
                      <Slider
                        value={[cfg.certDecalY]}
                        min={DECAL_MIN}
                        max={DECAL_MAX}
                        step={5}
                        onValueChange={([v]) => maj("certDecalY", v)}
                      />
                    </div>
                  </div>
                  {/* (NOUVEAU v0.2.100) POSITION EXACTE du bloc certificat sur
                      la page — X/Y absolues en mm (indépendantes du QR et de
                      la signature ; réécrivent les décalages de CET élément). */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-xs">
                          Position exacte — X : {Math.round(geoCert.x / PT_PAR_MM)} mm
                          <span className="ml-1 font-normal text-muted-foreground">(depuis le bord gauche)</span>
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          max={210}
                          step={1}
                          value={Math.round(geoCert.x / PT_PAR_MM)}
                          onChange={(e) => {
                            const xpt = (Number(e.target.value) || 0) * PT_PAR_MM;
                            maj("certDecalX", Math.round(Math.min(DECAL_MAX, Math.max(DECAL_MIN, xpt - geoCert.baseX))));
                          }}
                          className="h-7 w-20 shrink-0 text-xs"
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Coin gauche du bloc, mesuré sur la page A4 (210 mm de large).
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-xs">
                          Position exacte — Y : {Math.round(geoCert.y / PT_PAR_MM)} mm
                          <span className="ml-1 font-normal text-muted-foreground">(depuis le bord bas)</span>
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          max={297}
                          step={1}
                          value={Math.round(geoCert.y / PT_PAR_MM)}
                          onChange={(e) => {
                            const ypt = (Number(e.target.value) || 0) * PT_PAR_MM;
                            maj("certDecalY", Math.round(Math.min(DECAL_MAX, Math.max(DECAL_MIN, ypt - geoCert.baseY))));
                          }}
                          className="h-7 w-20 shrink-0 text-xs"
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Base du bloc, mesurée depuis le bas de la page A4 (297 mm de haut).
                      </p>
                    </div>
                  </div>
                </>
              )}

              {/* ---------- (NOUVEAU v0.2.119) CACHET « SIGNATURE
                  ÉLECTRONIQUE » DU TAMPON DES FICHES — alimenté EN DIRECT par
                  le certificat chargé dans le module « API de certification
                  & signature » (onglet Paramètres) : AUCUNE réimportation ici,
                  aucun contenu stocké en base. Le cachet n'est apposé que si
                  le module est ACTIF avec la couverture « Fiches de paie » ET
                  un certificat chargé — la signature PAdES est appliquée
                  JUSTE APRÈS le tamponnage (le cachet est couvert par elle). ---------- */}
              <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/30 px-3 py-2.5">
                <div>
                  <Label htmlFor="fiches-elec-actif" className="text-sm font-medium">
                    Cachet «&nbsp;Signature électronique&nbsp;» (tampon)
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Activé (ON)&nbsp;: un cachet «&nbsp;SIGNATURE ÉLECTRONIQUE&nbsp;» est apposé sur chaque
                    fiche de paie PDF tamponnée, puis la fiche est SIGNÉE électroniquement (PAdES)&nbsp;:
                    le cachet est couvert par la signature. (NOUVEAU v0.2.128) le CONTENU du cachet se
                    choisit dans le formulaire ci-dessous — par défaut, AUCUNE information du certificat
                    n&apos;est affichée. Si le module est inactif ou sans certificat, le cachet n&apos;est
                    PAS apposé (jamais trompeur). Désactivé (OFF)&nbsp;: jamais apposé.
                  </p>
                </div>
                <Switch
                  id="fiches-elec-actif"
                  checked={cfg.elecActif}
                  onCheckedChange={(v) => maj("elecActif", v)}
                  className="mt-1 shrink-0"
                />
              </div>

              {cfg.elecActif && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Position du cachet</Label>
                      <Select value={cfg.elecPosition} onValueChange={(v) => maj("elecPosition", v)}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {POSITIONS_CERT.map((p) => (
                            <SelectItem key={p.valeur} value={p.valeur}>{p.libelle}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* (NOUVEAU v0.2.120) FORME du cachet : encadré historique
                        ou cachet ROND de type « cachet d'entreprise » */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Forme du cachet</Label>
                      <Select value={cfg.elecForme || "RECTANGLE"} onValueChange={(v) => maj("elecForme", v)}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="RECTANGLE">Rectangle (bloc encadré)</SelectItem>
                          <SelectItem value="ROND">Rond (cachet d&apos;entreprise)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-xs">Taille du cachet : {cfg.elecTaille} %</Label>
                        <Input
                          type="number"
                          min={CERT_TAILLE_MIN}
                          max={CERT_TAILLE_MAX}
                          step={5}
                          value={cfg.elecTaille}
                          onChange={(e) => maj("elecTaille", Number(e.target.value) || 0)}
                          className="h-7 w-20 shrink-0 text-xs"
                        />
                      </div>
                      <Slider
                        value={[cfg.elecTaille]}
                        min={CERT_TAILLE_MIN}
                        max={CERT_TAILLE_MAX}
                        step={5}
                        onValueChange={([v]) => maj("elecTaille", v)}
                      />
                    </div>
                  </div>
                  {/* ---------- (NOUVEAU v0.2.128) CONTENU DU CACHET — FORMULAIRE
                      DE CHOIX DES INFORMATIONS AFFICHÉES. Demande utilisateur :
                      ne plus afficher les informations du certificat par défaut ;
                      chaque case fait figurer UNE information du certificat
                      chargé dans le module « API de certification & signature »
                      (lues EN DIRECT — jamais stockées ici). ---------- */}
                  <div className="rounded-md border bg-muted/30 px-3 py-2.5 space-y-2.5">
                    <div>
                      <Label className="text-sm font-medium">
                        Contenu du cachet — informations à afficher
                      </Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Par défaut, AUCUNE information du certificat n&apos;est affichée&nbsp;: le cachet
                        porte uniquement la mention «&nbsp;SIGNATURE ÉLECTRONIQUE&nbsp;». Cochez les
                        informations à faire figurer (lues en direct dans le certificat chargé dans le
                        module «&nbsp;API de certification &amp; signature&nbsp;», onglet Paramètres).
                      </p>
                    </div>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {([
                        ["elecAffSignataire", "Signataire (titulaire du certificat)"],
                        ["elecAffOrganisation", "Organisation (société)"],
                        ["elecAffEmetteur", "Émetteur (autorité de certification)"],
                        ["elecAffValidite", "Validité (« Valide jusqu'au … »)"],
                        ["elecAffEmpreinte", "Empreinte du certificat (SHA-256)"],
                      ] as const).map(([cle, libelle]) => (
                        <label key={cle} htmlFor={`fiches-${cle}`} className="flex cursor-pointer items-center gap-2 text-xs">
                          <Checkbox
                            id={`fiches-${cle}`}
                            checked={Boolean(cfg[cle])}
                            onCheckedChange={(v) => maj(cle, v === true)}
                          />
                          {libelle}
                        </label>
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="fiches-elec-texte-libre" className="text-xs">
                        Ligne personnalisée (facultatif — 120 caractères maximum)
                      </Label>
                      <Input
                        id="fiches-elec-texte-libre"
                        value={cfg.elecTexteLibre}
                        maxLength={120}
                        onChange={(e) => maj("elecTexteLibre", e.target.value)}
                        placeholder="Ex. : Direction des Ressources Humaines"
                        className="h-9 text-xs"
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-xs">
                          Décalage horizontal : {cfg.elecDecalX > 0 ? "+" : ""}{cfg.elecDecalX} pt
                          <span className="ml-1 font-normal text-muted-foreground">(− = gauche, + = droite)</span>
                        </Label>
                        <Input
                          type="number"
                          min={DECAL_MIN}
                          max={DECAL_MAX}
                          step={1}
                          value={cfg.elecDecalX}
                          onChange={(e) => maj("elecDecalX", Number(e.target.value) || 0)}
                          className="h-7 w-20 shrink-0 text-xs"
                        />
                      </div>
                      <Slider
                        value={[cfg.elecDecalX]}
                        min={DECAL_MIN}
                        max={DECAL_MAX}
                        step={5}
                        onValueChange={([v]) => maj("elecDecalX", v)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-xs">
                          Décalage vertical : {cfg.elecDecalY > 0 ? "+" : ""}{cfg.elecDecalY} pt
                          <span className="ml-1 font-normal text-muted-foreground">(− = bas, + = haut)</span>
                        </Label>
                        <Input
                          type="number"
                          min={DECAL_MIN}
                          max={DECAL_MAX}
                          step={1}
                          value={cfg.elecDecalY}
                          onChange={(e) => maj("elecDecalY", Number(e.target.value) || 0)}
                          className="h-7 w-20 shrink-0 text-xs"
                        />
                      </div>
                      <Slider
                        value={[cfg.elecDecalY]}
                        min={DECAL_MIN}
                        max={DECAL_MAX}
                        step={5}
                        onValueChange={([v]) => maj("elecDecalY", v)}
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    L&apos;aperçu A4 ci-dessus montre un cachet d&apos;exemple pour préparer le
                    placement&nbsp;; le bouton «&nbsp;Aperçu&nbsp;» rend les VRAIES métadonnées du
                    certificat du module.
                  </p>
                </>
              )}

              {/* ---------- (v0.2.194) RH : bloc d'IMPORT du fichier de
                  signature MASQUÉ (matériel cryptographique réservé au
                  superadministrateur) — une note informative le remplace. */}
              {masquerCertificat && (
                <p className="rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
                  L&apos;import du fichier de signature (et de sa clé privée) est réservé au
                  superadministrateur — contactez-le pour importer ou remplacer le fichier.
                  L&apos;interrupteur et le positionnement ci-dessus restent utilisables ; le
                  certificat enregistré continue de s&apos;appliquer aux fiches de paie.
                </p>
              )}
              {!masquerCertificat && (
                <>
              <div className="space-y-1.5">
                <Label htmlFor="certificat-fichier" className="text-xs">
                  Fichier de signature électronique (mot de passe PKCS#12 pris en charge)
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="certificat-fichier"
                    type="file"
                    accept={ACCEPT_CERTIFICAT}
                    ref={fileCertRef}
                    onChange={(e) => {
                      choisirCertificat(e.target.files?.[0] ?? null);
                      e.currentTarget.value = "";
                    }}
                    className="h-9 text-xs"
                  />
                  {(cfg.certFormat || certLocal) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCertLocal({ nom: "", base64: "" });
                        setCertMdp("");
                        // (v0.2.112) retirer le certificat retire AUSSI la clé
                        // privée associée (même custody côté serveur).
                        setCertCleLocal(null);
                        setCleMdp("");
                        if (fileCertRef.current) fileCertRef.current.value = "";
                        if (fileCleRef.current) fileCleRef.current.value = "";
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {certLocal && COFFRES_PKCS12.includes(extensionCertLocal()) && certLocal.base64 && (
                  <div className="space-y-1">
                    <Label htmlFor="certificat-mdp" className="text-xs">
                      Mot de passe du fichier PKCS#12 (.p12/.pfx)
                    </Label>
                    <Input
                      id="certificat-mdp"
                      type="password"
                      value={certMdp}
                      onChange={(e) => setCertMdp(e.target.value)}
                      className="h-9 text-sm"
                      autoComplete="off"
                      placeholder="Mot de passe utilisé lors de l&apos;export du certificat"
                    />
                  </div>
                )}

                {/* ---------- (NOUVEAU v0.2.112) CLÉ PRIVÉE ASSOCIÉE ----------
                     Les trois scénarios de la demande : (1) certificat SEUL
                     quand la clé privée est déjà dans le système (le serveur
                     VÉRIFIE l'appariement) ; (2) coffre .p12/.pfx (clé incluse,
                     champ inutile) ; (3) clé privée séparée .pem/.key/.der. */}
                {!(certLocal && COFFRES_PKCS12.includes(extensionCertLocal()) && certLocal.base64) && (
                  <div className="space-y-1">
                    <Label htmlFor="certificat-cle-fichier" className="text-xs">
                      Clé privée associée (.pem, .key, .der) — facultative
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="certificat-cle-fichier"
                        type="file"
                        accept={ACCEPT_CLE}
                        ref={fileCleRef}
                        onChange={(e) => {
                          choisirClePrivee(e.target.files?.[0] ?? null);
                          e.currentTarget.value = "";
                        }}
                        className="h-9 text-xs"
                      />
                      {(cfg.certCleFichierNom || certCleLocal) && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setCertCleLocal({ nom: "", base64: "" });
                            setCleMdp("");
                            if (fileCleRef.current) fileCleRef.current.value = "";
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    {certCleLocal && certCleLocal.base64 && (
                      <Input
                        id="certificat-cle-mdp"
                        type="password"
                        value={cleMdp}
                        onChange={(e) => setCleMdp(e.target.value)}
                        className="h-9 text-sm"
                        autoComplete="off"
                        placeholder="Mot de passe de la clé privée (si le fichier est protégé)"
                      />
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      Un coffre .p12/.pfx contient DÉJÀ le certificat ET sa clé privée (champ
                      inutile). Un certificat SEUL (.cer/.crt/.pem…) est accepté quand la clé
                      privée est déjà enregistrée dans le système — l&apos;appariement est vérifié
                      par le serveur (erreur explicite si le certificat et la clé ne vont pas
                      ensemble). Formats de clé : PKCS#8 ou PKCS#1, clair ou chiffré.
                    </p>
                  </div>
                )}
              </div>

              {certLocal && certLocal.base64 === "" && (
                <p className="text-xs rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-amber-800">
                  Certificat à retirer : cliquez sur «&nbsp;Enregistrer&nbsp;» pour confirmer.
                </p>
              )}
              {certLocal && certLocal.base64 !== "" && (
                <p className="text-xs rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-emerald-800">
                  Nouveau fichier en attente : <b>{certLocal.nom}</b> — cliquez sur
                  «&nbsp;Enregistrer&nbsp;». Le serveur vérifiera son contenu (et son mot de passe
                  s&apos;il s&apos;agit d&apos;un coffre .p12/.pfx).
                </p>
              )}
                </>
              )}

              {!certLocal && cfg.certFormat && (
                <div className="space-y-1.5 rounded-md border bg-muted/30 px-2.5 py-2 text-xs">
                  <p>
                    <b>Titulaire :</b> {cfg.certSujet || "—"}
                  </p>
                  <p>
                    <b>Émetteur :</b> {cfg.certEmetteur || "—"}
                  </p>
                  <p>
                    <b>N° de série :</b> {cfg.certSerie ? cfg.certSerie.slice(0, 40) : "—"}
                    {cfg.certSerie.length > 40 ? "…" : ""}
                  </p>
                  <p>
                    <b>Validité :</b> du {dateFr(cfg.certValideDu)} au {dateFr(cfg.certValideAu)}
                  </p>
                  <p>
                    <b>Empreinte SHA-256 :</b>{" "}
                    <span className="font-mono text-[11px] break-all">{cfg.certEmpreinte || "—"}</span>
                  </p>
                  <p>
                    <b>Fichier importé :</b> {cfg.certFichierNom || "—"}
                    {cfg.certImportLe ? ` (le ${dateFr(cfg.certImportLe)})` : ""}
                  </p>
                  {cfg.certChemin ? (
                    <p className="text-muted-foreground">
                      <b>Emplacement :</b> {cfg.certChemin} — copie de contrôle CHIFFRÉE sur le
                      serveur (AES-256, illisible comme les fiches).
                    </p>
                  ) : null}
                  {/* (NOUVEAU v0.2.112) état de la CLÉ PRIVÉE associée */}
                  <p>
                    <b>Clé privée :</b>{" "}
                    {cfg.certClePriveeDisponible ? (
                      <span className="text-emerald-700 font-medium">
                        disponible dans le système
                      </span>
                    ) : (
                      <span className="text-muted-foreground">non disponible</span>
                    )}
                  </p>
                  {cfg.certCleFichierNom ? (
                    <p className="text-muted-foreground">
                      <b>Fichier de clé :</b> {cfg.certCleFichierNom}
                      {cfg.certCleType ? ` — ${cfg.certCleType}` : ""}
                    </p>
                  ) : cfg.certClePriveeDisponible ? (
                    <p className="text-muted-foreground">
                      <b>Source :</b> coffre .p12/.pfx (le coffre contient sa clé privée).
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            <Separator />

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={enregistrer} disabled={enregistre} className="gap-1.5">
                {enregistre ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Enregistrer
              </Button>
              <Button onClick={apercuPdf} disabled={apercu} variant="outline" className="gap-1.5">
                {apercu ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                Aperçu sur la dernière fiche importée
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
