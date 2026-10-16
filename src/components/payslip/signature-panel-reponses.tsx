"use client";
/**
 * ============================================================================
 *  NOUVEAU (v0.2.93) — PANNEAU « CONFIGURATION DES RÉPONSES »
 *  (section Demandes / Réponses — onglet Demandes)
 * ============================================================================
 *
 *  SÉPARATION DES CONFIGURATIONS (demande utilisateur) : la configuration du
 *  QR code, de la signature électronique et du certificat de signature
 *  électronique est désormais PROPRE À CHAQUE SECTION :
 *   - Section « Import » (onglet Importation, signature-panel.tsx) → fiches
 *     de paie ;
 *   - Section « Demandes / Réponses » (CE panneau) → documents de réponse
 *     (mode « Automatique » du dialogue de réponse et aperçu).
 *
 *  Chaque section possède ses PROPRES interrupteurs (tampon, signature, QR,
 *  mention, certificat), ses PROPRES textes (ligne de signature, mention,
 *  URL du QR) et SES PROPRES paramètres de positionnement (positions,
 *  décalages ±1500 pt, tailles, rotations, échelle du bloc certificat).
 *
 *  APERÇU A4 INTERACTIF : la signature, le QR et le certificat y sont
 *  déplacés LIBREMENT et INDÉPENDAMMENT (clic = positionner, glisser =
 *  déplacer) — le déplacement d'un élément ne modifie que SES coordonnées et
 *  les curseurs de décalage suivent en TEMPS RÉEL (composant partagé
 *  ApercuPositionnement, géométrie répliquée depuis stamp.ts).
 *
 *  ACTIFS : l'image de signature/cachet et l'image de QR fourni restent
 *  importés UNE SEULE FOIS (section Import) et partagés — ils sont affichés
 *  ici en lecture seule.
 *
 *  MODIFIÉ (v0.2.99) — CERTIFICAT DE SIGNATURE TOTALEMENT DÉDIÉ : le
 *  fichier (.p12/.pfx/.pkcs7/.pem…), son mot de passe PKCS#12 (stocké
 *  chiffré, jamais renvoyé) et toutes ses métadonnées sont importés et
 *  gérés ICI, INDÉPENDAMMENT de la section Import (dans les DEUX sens).
 *
 *  API : GET/PUT/POST /api/signature-config?scope=reponse (table
 *  SignatureConfigReponse — créée au premier enregistrement ; avant cela les
 *  réglages affichés reflètent la configuration Import, continuité exacte).
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
  ChevronDown,
  ChevronUp,
  Eye,
  FileImage,
  FileSignature,
  Loader2,
  MailPlus,
  QrCode,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
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

// (NOUVEAU v0.2.99) import DÉDIÉ du certificat de signature électronique des
// réponses — mêmes formats que la section Import (le SERVEUR revalide le
// contenu — sniff ASN.1/PEM/XML — et refuse toute extension inconnue).
const EXTENSIONS_CERTIFICAT = [
  "p12", "pfx", "pkcs7", "p7b", "p7c", "p7s", "p7m",
  "xml", "ps7x", "pem", "cer", "crt", "der",
];
const ACCEPT_CERTIFICAT = EXTENSIONS_CERTIFICAT.map((e) => "." + e).join(",");
// (NOUVEAU v0.2.112) CLÉ PRIVÉE associée — extensions acceptées (.pem/.key/.der).
const EXTENSIONS_CLE = ["pem", "key", "der"];
const ACCEPT_CLE = EXTENSIONS_CLE.map((e) => "." + e).join(",");
const COFFRES_PKCS12 = ["p12", "pfx"];
const TAILLE_CERTIFICAT_MAX = 8_000_000; // ≈ octets du fichier de signature choisi

interface ConfigReponses {
  // ---- Champs ÉDITABLES (configuration propre aux réponses) ----
  actif: boolean;
  sigActif: boolean;
  sigTexte: string;
  sigPosition: string;
  sigTaille: number;
  sigOpacite: number;
  qrActif: boolean;
  qrMode: string;
  qrUrl: string;
  qrTexte: string;
  qrPosition: string;
  qrTaille: number;
  sigDecalX: number;
  sigDecalY: number;
  qrDecalX: number;
  qrDecalY: number;
  sigRotation: number;
  qrRotation: number;
  mentionActif: boolean;
  mentionTexte: string;
  certActif: boolean;
  certPosition: string;
  certDecalX: number;
  certDecalY: number;
  certTaille: number;
  // ---- (NOUVEAU v0.2.119) cachet « Signature électronique » du tampon ----
  // Alimenté EN DIRECT par le certificat du module de signature (onglet
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
  // ---- (v0.2.99) CERTIFICAT DÉDIÉ (fichier + métadonnées de CETTE section) ----
  certChemin: string;
  certImportLe: string | null;
  certMotDePasseEnregistre: boolean;
  // ---- (v0.2.112) CLÉ PRIVÉE ASSOCIÉE (fichier séparé) ----
  certCleFichierNom: string;
  certCleType: string;
  certClePriveeDisponible: boolean;
  certCleMotDePasseEnregistre: boolean;
  certHeriteImport: boolean;
  // ---- ACTIFS PARTAGÉS (lecture seule — importés dans la section Import) ----
  sigImage: string;
  sigImageNom: string;
  qrImage: string;
  qrImageNom: string;
  certFormat: string;
  certFichierNom: string;
  certSujet: string;
  certEmetteur: string;
  certSerie: string;
  certValideDu: string | null;
  certValideAu: string | null;
  certEmpreinte: string;
}

const DEFAUTS: ConfigReponses = {
  actif: false,
  sigActif: false,
  sigTexte: "",
  sigPosition: "BAS_DROITE",
  sigTaille: 120,
  sigOpacite: 0.9,
  qrActif: false,
  qrMode: "DONNEES",
  qrUrl: "",
  qrTexte: "",
  qrPosition: "BAS_GAUCHE",
  qrTaille: 110,
  sigDecalX: 0,
  sigDecalY: 0,
  qrDecalX: 0,
  qrDecalY: 0,
  sigRotation: 0,
  qrRotation: 0,
  mentionActif: true,
  mentionTexte: "Document signé électroniquement — AutoRH — {DATE}",
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
  certChemin: "",
  certImportLe: null,
  certMotDePasseEnregistre: false,
  certCleFichierNom: "",
  certCleType: "",
  certClePriveeDisponible: false,
  certCleMotDePasseEnregistre: false,
  certHeriteImport: false,
  sigImage: "",
  sigImageNom: "",
  qrImage: "",
  qrImageNom: "",
  certFormat: "",
  certFichierNom: "",
  certSujet: "",
  certEmetteur: "",
  certSerie: "",
  certValideDu: null,
  certValideAu: null,
  certEmpreinte: "",
};

export function SignaturePanelReponses({
  // (v0.2.194 — demande « masquer ce bloc pour le rôle RH dans la section
  // Importer et Demandes ») MASQUER le bloc d'IMPORT du fichier de certificat
  // (« Fichier de certificat de CETTE section », mot de passe PKCS#12, clé
  // privée associée, notes d'attente/de retrait et avertissements d'import) —
  // vrai pour le rôle RH (DemandesTab, même pattern que ReponsePdfPanel
  // v0.2.186) : l'import du matériel cryptographique reste réservé au
  // SUPERADMIN. L'interrupteur, le positionnement du bloc et l'affichage des
  // métadonnées du certificat restent visibles ; la configuration enregistrée
  // continue de s'appliquer aux réponses quelle que soit la personne qui
  // consulte la section.
  masquerCertificat = false,
}: {
  masquerCertificat?: boolean;
}) {
  const { toast } = useToast();
  const [charge, setCharge] = useState(false);
  const [enregistre, setEnregistre] = useState(false);
  const [apercu, setApercu] = useState(false);
  const [ouvert, setOuvert] = useState(true);
  const [source, setSource] = useState<"reponse" | "import">("import");
  const [cfg, setCfg] = useState<ConfigReponses>(DEFAUTS);
  // Image QR de l'APERÇU interactif (modes DONNÉES/URL/TEXTE → QR indicatif
  // généré côté client ; mode IMAGE → image partagée de la section Import).
  const [qrApercu, setQrApercu] = useState("");
  // (NOUVEAU v0.2.99) certificat DÉDIÉ : fichier choisi (non encore enregistré)
  // et mot de passe PKCS#12 éventuel — envoyés uniquement à l'enregistrement,
  // le mot de passe n'est jamais mémorisé côté interface.
  const fileCertRef = useRef<HTMLInputElement>(null);
  const [certLocal, setCertLocal] = useState<{ nom: string; base64: string } | null>(null);
  const [certMdp, setCertMdp] = useState("");
  // (NOUVEAU v0.2.112) clé privée associée : mêmes sémantiques que certLocal.
  const fileCleRef = useRef<HTMLInputElement>(null);
  const [certCleLocal, setCertCleLocal] = useState<{ nom: string; base64: string } | null>(null);
  const [cleMdp, setCleMdp] = useState("");

  const charger = useCallback(async () => {
    try {
      const res = await fetch("/api/signature-config?scope=reponse", { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.config) {
        setCfg({ ...DEFAUTS, ...d.config });
        setSource(d.source === "reponse" ? "reponse" : "import");
      } else if (res.status === 403) {
        return; // rôle non autorisé (ne devrait pas arriver : panneau RH/superadmin)
      } else {
        toast({ title: "Lecture impossible", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Serveur inaccessible", variant: "destructive" });
    } finally {
      setCharge(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  // Génération de l'image QR de l'aperçu interactif (contenu indicatif).
  useEffect(() => {
    let vivant = true;
    if (!cfg.qrActif) {
      setQrApercu("");
      return;
    }
    if (cfg.qrMode === "IMAGE") {
      setQrApercu(cfg.qrImage || "");
      return;
    }
    const contenu =
      cfg.qrMode === "URL" || cfg.qrMode === "FICHE"
        ? cfg.qrMode === "FICHE" && cfg.qrUrl
          ? cfg.qrUrl.replace(/\/+$/, "") +
            "/verification/reponse/DEM-APERCU?t=JETON-SIGNE" // (v0.2.97) « Fiche en ligne » : URL publique de CETTE réponse (indicative dans l'aperçu)
          : cfg.qrUrl || "https://verification.autorh.local"
        : cfg.qrMode === "TEXTE"
          ? cfg.qrTexte || "Aperçu QR — AutoRH"
          : "AutoRH — Réponse à une demande\nRéf : DEM-APERCU\nObjet : —\nDemandeur : —\nEmpreinte : APERCU";
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
  }, [cfg.qrActif, cfg.qrMode, cfg.qrUrl, cfg.qrTexte, cfg.qrImage]);

  function maj<K extends keyof ConfigReponses>(cle: K, valeur: ConfigReponses[K]) {
    setCfg((c) => ({ ...c, [cle]: valeur }));
  }

  // (NOUVEAU v0.2.99) sélection d'un fichier de certificat DÉDIÉ aux réponses
  // (.p12/.pfx/.pkcs7/.pem/…) — même ergonomie que la section Import :
  // l'extension est contrôlée ici, le SERVEUR revalide le CONTENU à
  // l'enregistrement. Le fichier choisi ne part qu'avec « Enregistrer ».
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
        ? "Fichier PKCS#12 détecté : saisissez son mot de passe pour l'import (propre à cette section)."
        : "Le certificat sera vérifié par le serveur à l'enregistrement.",
    });
  }

  function extensionCertLocal(): string {
    const nom = certLocal?.nom ?? cfg.certFichierNom ?? "";
    return nom.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  }

  // (NOUVEAU v0.2.112) sélection d'un FICHIER DE CLÉ PRIVÉE (.pem/.key/.der)
  // à associer au certificat DÉDIÉ des réponses — certificat seul accepté
  // quand la clé est déjà dans le système (appariement vérifié côté serveur).
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
        "Le serveur vérifiera la clé (et son mot de passe s'il est protégé) puis son APPARIEMENT avec le certificat des réponses.",
    });
  }

  // (NOUVEAU v0.2.100) géométrie du bloc certificat en points PDF (jumelle du
  // moteur — lignes réelles ou bloc d'exemple) — sert aux champs « Position
  // exacte X/Y (mm) » de la rubrique certificat des RÉPONSES : X depuis le
  // bord gauche, Y depuis le bord bas (origine PDF). Indépendante du QR et
  // de la signature, et PROPRE à cette section (jamais partagée avec Import).
  const geoCert = geometrieCertificat(cfg, cfg.mentionActif);

  function corpsEditable(): Record<string, unknown> {
    // Uniquement les champs ÉDITABLES de la section (jamais les actifs
    // partagés — ils restent la propriété de la section Import).
    const corps: Record<string, unknown> = {
      scope: "reponse",
      actif: cfg.actif,
      sigActif: cfg.sigActif,
      sigTexte: cfg.sigTexte,
      sigPosition: cfg.sigPosition,
      sigTaille: cfg.sigTaille,
      sigOpacite: cfg.sigOpacite,
      qrActif: cfg.qrActif,
      qrMode: cfg.qrMode,
      qrUrl: cfg.qrUrl,
      qrTexte: cfg.qrTexte,
      qrPosition: cfg.qrPosition,
      qrTaille: cfg.qrTaille,
      sigDecalX: cfg.sigDecalX,
      sigDecalY: cfg.sigDecalY,
      qrDecalX: cfg.qrDecalX,
      qrDecalY: cfg.qrDecalY,
      sigRotation: cfg.sigRotation,
      qrRotation: cfg.qrRotation,
      mentionActif: cfg.mentionActif,
      mentionTexte: cfg.mentionTexte,
      certActif: cfg.certActif,
      certPosition: cfg.certPosition,
      certDecalX: cfg.certDecalX,
      certDecalY: cfg.certDecalY,
      certTaille: cfg.certTaille,
      // (NOUVEAU v0.2.119) cachet « Signature électronique »
      elecActif: cfg.elecActif,
      elecPosition: cfg.elecPosition,
      elecDecalX: cfg.elecDecalX,
      elecDecalY: cfg.elecDecalY,
      elecTaille: cfg.elecTaille,
      // (NOUVEAU v0.2.120) forme du cachet
      elecForme: cfg.elecForme || "RECTANGLE",
      // (NOUVEAU v0.2.128) contenu du cachet — choix des informations
      elecAffSignataire: cfg.elecAffSignataire,
      elecAffOrganisation: cfg.elecAffOrganisation,
      elecAffEmetteur: cfg.elecAffEmetteur,
      elecAffValidite: cfg.elecAffValidite,
      elecAffEmpreinte: cfg.elecAffEmpreinte,
      elecTexteLibre: cfg.elecTexteLibre,
    };
    // (NOUVEAU v0.2.99) certificat DÉDIÉ : envoyé UNIQUEMENT si un fichier a
    // été choisi (ou "" pour le retirer) — le mot de passe PKCS#12, s'il a
    // été saisi, ne voyage qu'avec le fichier et n'est jamais mémorisé.
    if (certLocal !== null) {
      corps.certFichier = certLocal.base64;
      corps.certFichierNom = certLocal.nom;
      if (certLocal.base64 && certMdp) corps.certMotDePasse = certMdp;
    }
    // (NOUVEAU v0.2.112) clé privée associée : envoyée UNIQUEMENT si un
    // fichier a été choisi (ou "" pour la retirer).
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
        body: JSON.stringify(corpsEditable()),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setCfg({ ...cfg, ...d.config });
        setSource("reponse");
        setCertLocal(null);
        setCertMdp("");
        if (fileCertRef.current) fileCertRef.current.value = "";
        setCertCleLocal(null);
        setCleMdp("");
        if (fileCleRef.current) fileCleRef.current.value = "";
        // (MODIFIÉ v0.2.123) — SWITCH PRINCIPAL INDÉPENDANT (même correctif
        // que la section Import) : plus de « Activez l'interrupteur général »
        // quand il est DÉJÀ ON (actif=true + aucun élément activé).
        const actifGeneral = Boolean(d.config?.actif ?? cfg.actif);
        toast({
          title: d.tamponActif
            ? "Configuration des réponses enregistrée"
            : actifGeneral
              ? "Configuration des réponses enregistrée — interrupteur général ACTIF"
              : "Configuration des réponses enregistrée — tampon désactivé",
          description: d.tamponActif
            ? "Les documents de réponse (mode Automatique) utilisent désormais CETTE configuration, indépendante de la section Import."
            : actifGeneral
              ? "Aucun élément du tampon n'est activé (Signature, Code QR, Mention, Certificat, Cachet « Signature électronique »). Le switch principal fonctionne INDÉPENDAMMENT de chacun — activez au moins un élément pour tamponner les réponses."
              : "Activez l'interrupteur général pour tamponner automatiquement les documents de réponse.",
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
        body: JSON.stringify({ action: "apercu", ...corpsEditable() }),
      });
      if (res.ok) {
        toast({
          title: "Aperçu de réponse généré",
          description: "Le PDF montre un document de réponse d'exemple tamponné avec CETTE configuration.",
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

  const auMoinsUn =
    cfg.sigActif || cfg.qrActif || cfg.mentionActif ||
    (cfg.certActif && Boolean(cfg.certSujet) && Boolean(cfg.certEmpreinte)) ||
    // (NOUVEAU v0.2.119) le cachet « Signature électronique » compte lui
    // aussi comme élément du tampon (badge d'état).
    cfg.elecActif;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MailPlus className="h-5 w-5 text-emerald-600" />
            Configuration des réponses — Signature, QR code &amp; certificat
          </CardTitle>
          <CardDescription className="mt-1.5">
            Configuration PROPRE à la section «&nbsp;Demandes / Réponses&nbsp;» : appliquée aux
            documents de réponse (mode «&nbsp;Automatique&nbsp;» du dialogue de réponse), à
            l&apos;affichage comme au téléchargement, administration et portail employé.
            Indépendante de la configuration de l&apos;onglet Importation (fiches de paie) —
            chaque section possède ses propres interrupteurs, textes et paramètres de
            positionnement. Les images (signature, QR fourni) importées dans l&apos;onglet
            Importation restent partagées ; depuis la v0.2.99, le CERTIFICAT de signature
            est entièrement DÉDIÉ à cette section (fichier, mot de passe, activation,
            positionnement).
          </CardDescription>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
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
                ? "Tampon réponses désactivé"
                : auMoinsUn
                  ? "Tampon réponses actif"
                  : "Tampon réponses en attente d'un élément"}
            </Badge>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOuvert((o) => !o)}
            className="gap-1 text-xs"
          >
            {ouvert ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {ouvert ? "Masquer" : "Afficher"}
          </Button>
        </div>
      </CardHeader>
      {ouvert && (
        <CardContent className="space-y-5">
          {!charge ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement de la configuration des réponses…
            </div>
          ) : (
            <>
              {source === "import" && (
                <p className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                  Configuration des réponses pas encore enregistrée : les réglages affichés
                  reflètent la configuration de la section <b>Import</b> (comportement actuel des
                  réponses en mode «&nbsp;Automatique&nbsp;»). Cliquez sur <b>Enregistrer</b> pour
                  rendre cette configuration PROPRE aux réponses — elle évoluera alors
                  indépendamment de la section Import.
                </p>
              )}

              {/* Interrupteur général de la section réponses */}
              <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                <div>
                  <Label htmlFor="tampon-reponses-actif" className="text-sm font-medium">
                    Tampon automatique des réponses
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Activé : les documents de réponse (mode «&nbsp;Automatique&nbsp;») sont
                    tamponnés avec CETTE configuration. Désactivé : aucun tampon automatique
                    (le mode «&nbsp;Manuel&nbsp;» du dialogue de réponse reste possible).
                    (v0.2.123) Switch principal INDÉPENDANT : il ne change aucun autre
                    interrupteur — chaque élément (Signature, QR, Mention, Certificat,
                    Cachet) garde son propre état.
                  </p>
                </div>
                <Switch
                  id="tampon-reponses-actif"
                  checked={cfg.actif}
                  onCheckedChange={(v) => maj("actif", v)}
                />
              </div>

              {/* APERÇU A4 INTERACTIF — éléments déplaçables indépendamment */}
              {cfg.actif && (cfg.sigActif || (cfg.qrActif && Boolean(qrApercu)) || cfg.certActif || cfg.elecActif) && (
                <ApercuPositionnement
                  cfg={cfg}
                  imageSig={cfg.sigImage}
                  imageQr={qrApercu}
                  // (CORRECTIF v0.2.201) : `maj` est générique `<K extends
                  // keyof ConfigReponses>` — TypeScript ne peut pas vérifier
                  // statiquement que toutes les clés de CleDecal ont une
                  // valeur `number`. On caste vers la signature attendue
                  // (les clés CleDecal sont toutes number dans ConfigReponses).
                  maj={maj as (cle: CleDecal, valeur: number) => void}
                  majTailleCert={(v) => maj("certTaille", v)}
                  libelleFiche="A4 — réponses aux demandes"
                  note="Ce placement s'applique aux DOCUMENTS DE RÉPONSE uniquement (mode Automatique, affichage comme téléchargement) — chaque élément se déplace indépendamment et les curseurs de décalage suivent le glisser en temps réel ; l'aperçu PDF final reste la référence exacte."
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
                      Image partagée (cachet importé dans l&apos;onglet Importation) et/ou ligne
                      de texte PROPRE aux réponses.
                    </p>
                  </div>
                  <Switch checked={cfg.sigActif} onCheckedChange={(v) => maj("sigActif", v)} />
                </div>

                {cfg.sigActif && (
                  <>
                    {cfg.sigImage ? (
                      <div className="space-y-1.5">
                        <div className="rounded-md border bg-white p-2 inline-block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={cfg.sigImage}
                            alt="Signature partagée (section Import)"
                            className="max-h-20 max-w-[220px] object-contain"
                          />
                        </div>
                        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <FileImage className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          <span>
                            <b>Image partagée :</b> {cfg.sigImageNom || "image enregistrée"} —
                            importée dans l&apos;onglet Importation (rubrique «&nbsp;Signature
                            électronique &amp; QR code&nbsp;»), servie aux fiches ET aux réponses.
                          </span>
                        </p>
                      </div>
                    ) : (
                      <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                        Aucune image de signature importée (section Import) : seule la ligne de
                        texte ci-dessous sera apposée. Pour utiliser un cachet, importez-le dans
                        l&apos;onglet Importation.
                      </p>
                    )}

                    <div className="space-y-1.5">
                      <Label htmlFor="rep-sig-texte" className="text-xs">
                        Ligne de texte sous l&apos;image (propre aux réponses — ex. «&nbsp;Le
                        Directeur des Ressources Humaines&nbsp;»)
                      </Label>
                      <Textarea
                        id="rep-sig-texte"
                        value={cfg.sigTexte}
                        onChange={(e) => maj("sigTexte", e.target.value)}
                        rows={2}
                        className="text-sm"
                        placeholder="Le Service des Ressources Humaines&#10;Société EXEMPLE — Tunis"
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
                      Code QR des réponses
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Contenu, taille et position PROPRES aux documents de réponse.
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
                            Données de la réponse (réf., objet, employé, empreinte de contrôle)
                          </SelectItem>
                          {/* (NOUVEAU v0.2.97 — demande utilisateur) mode « Fiche en
                              ligne » : le QR redirige vers la réponse EN LIGNE sur ce
                              serveur — page publique « Réponse authentique » protégée
                              par un jeton signé, même principe que le QR « Fiche en
                              ligne » des fiches de paie. */}
                          <SelectItem value="FICHE">
                            Fiche en ligne (le QR ouvre CETTE réponse sur ce serveur)
                          </SelectItem>
                          <SelectItem value="URL">URL de vérification</SelectItem>
                          <SelectItem value="TEXTE">Texte personnalisé</SelectItem>
                          <SelectItem value="IMAGE">Image fournie (QR importé — partagé)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="rep-qr-url" className="text-xs">
                        Adresse publique du serveur (modes « Fiche en ligne » et URL)
                      </Label>
                      <Input
                        id="rep-qr-url"
                        value={cfg.qrUrl}
                        onChange={(e) => maj("qrUrl", e.target.value)}
                        placeholder="http://192.168.1.20:4000"
                        className="h-9 text-sm"
                      />
                      {/* (MODIFIÉ v0.2.97) le champ sert au mode « Fiche en ligne »
                          (URL publique de vérification de CETTE réponse) comme au
                          mode URL (adresse encodée telle quelle) — plus de priorité
                          automatique : c'est le MODE choisi qui décide. */}
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Mode «&nbsp;Fiche en ligne&nbsp;» : le QR de chaque document de réponse
                        encode l&apos;URL publique de vérification de CETTE réponse
                        ({cfg.qrUrl ? String(cfg.qrUrl).replace(/\/+$/, "") : "http://…:port"}
                        /verification/reponse/…, page «&nbsp;Réponse authentique&nbsp;» sans
                        connexion, protégée par un jeton signé). Adresse vide en mode Fiche en
                        ligne&nbsp;: le QR n&apos;est pas apposé.
                      </p>
                    </div>
                    {cfg.qrMode === "TEXTE" && (
                      <div className="space-y-1.5">
                        <Label htmlFor="rep-qr-texte" className="text-xs">
                          Texte encodé dans le QR
                        </Label>
                        <Textarea
                          id="rep-qr-texte"
                          value={cfg.qrTexte}
                          onChange={(e) => maj("qrTexte", e.target.value)}
                          rows={2}
                          className="text-sm"
                        />
                      </div>
                    )}
                    {cfg.qrMode === "IMAGE" && (
                      <div className="space-y-1.5">
                        {cfg.qrImage ? (
                          <>
                            <div className="rounded-md border bg-white p-2 inline-block">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={cfg.qrImage}
                                alt="QR fourni (partagé)"
                                className="max-h-24 max-w-[220px] object-contain"
                              />
                            </div>
                            <p className="text-xs text-muted-foreground">
                              <b>Image partagée :</b> {cfg.qrImageNom || "image enregistrée"} —
                              importée dans l&apos;onglet Importation (mode IMAGE).
                            </p>
                          </>
                        ) : (
                          <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                            Aucune image de QR importée : importez-la dans l&apos;onglet
                            Importation (mode «&nbsp;Image fournie&nbsp;»), elle sera servie ici.
                          </p>
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
                    <Label className="text-sm font-medium">Mention légale en pied de réponse</Label>
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

              {/* ---------- Certificat de signature électronique (DÉDIÉ v0.2.99) ---------- */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Label className="text-sm font-medium flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      Certificat de signature électronique (réponses)
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      TOTALEMENT DÉDIÉ à cette section (v0.2.99) : le FICHIER (.p12, .pfx, .pkcs7,
                      .p7s, .xml, .pem…), son MOT DE PASSE et son positionnement sont importés et
                      gérés ICI — indépendants de l&apos;onglet Importation dans les DEUX sens
                      (modifier l&apos;un ne change jamais l&apos;autre). Le fichier est validé par
                      son contenu puis conservé CHIFFRÉ sur le serveur (AES-256).
                    </p>
                  </div>
                  {cfg.certFormat && certLocal === null && (
                    <Badge variant="outline" className="border-emerald-600 text-emerald-700 shrink-0">
                      {cfg.certFormat}
                    </Badge>
                  )}
                </div>

                <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/30 px-3 py-2.5">
                  <div>
                    <Label htmlFor="rep-certificat-actif" className="text-sm font-medium">
                      Utiliser le certificat de signature sur les réponses
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Activé (ON) : le bloc «&nbsp;Signature électronique certifiée&nbsp;» (titulaire,
                      émetteur, validité, empreinte SHA-256) du certificat DÉDIÉ est apposé sur les
                      documents de réponse. Fonctionne SEUL, sans condition. Désactivé (OFF) :
                      jamais apposé sur les réponses — l&apos;interrupteur des FICHES (onglet
                      Importation) reste totalement indépendant.
                    </p>
                  </div>
                  <Switch
                    id="rep-certificat-actif"
                    checked={cfg.certActif}
                    onCheckedChange={(v) => maj("certActif", v)}
                    className="mt-1 shrink-0"
                  />
                </div>

                {/* ---------- (NOUVEAU v0.2.92, ÉTENDU v0.2.100) POSITIONNEMENT
                    LIBRE du bloc certificat des RÉPONSES — VISIBLE DÈS QUE LE
                    CERTIFICAT EST ACTIVÉ, même avant l'import d'un fichier
                    (bloc d'exemple sur l'aperçu A4). Réglages : position (5
                    choix), taille 50→300 % (curseur + POIGNÉE DE
                    REDIMENSIONNEMENT), décalages fins ±1500 pt et POSITION
                    EXACTE X/Y en mm — indépendants du QR et de la signature,
                    et DÉDIÉS à cette section (jamais partagés avec Import). */}
                {cfg.certActif && (
                  <>
                    {!(cfg.certSujet.trim() && cfg.certEmpreinte.trim()) && (
                      <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                        Aucun certificat DÉDIÉ importé pour le moment : les réglages ci-dessous
                        définissent d&apos;ores et déjà le placement du bloc « Signature
                        électronique certifiée » des réponses — ils seront appliqués dès qu&apos;un
                        fichier sera importé et enregistré. L&apos;aperçu A4 ci-dessus montre un
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
                    {/* (NOUVEAU v0.2.100) POSITION EXACTE du bloc certificat des
                        réponses — X/Y absolues en mm (indépendantes du QR et de
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
                    ÉLECTRONIQUE » DU TAMPON DES RÉPONSES — alimenté EN DIRECT
                    par le certificat chargé dans le module « API de
                    certification & signature » (onglet Paramètres) : AUCUNE
                    réimportation ici, aucun contenu stocké en base. Le cachet
                    n'est apposé que si le module est ACTIF avec la couverture
                    « Demandes/Réponses » ET un certificat chargé — la
                    signature PAdES est appliquée JUSTE APRÈS le tamponnage
                    (le cachet est couvert par elle). ---------- */}
                <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/30 px-3 py-2.5">
                  <div>
                    <Label htmlFor="rep-elec-actif" className="text-sm font-medium">
                      Cachet «&nbsp;Signature électronique&nbsp;» (tampon)
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Activé (ON) : un cachet ENCADRÉ «&nbsp;SIGNATURE ÉLECTRONIQUE&nbsp;» — signataire,
                      organisation, émetteur, validité et empreinte SHA-256 du certificat chargé
                      dans le module «&nbsp;API de certification &amp; signature&nbsp;» (onglet
                      Paramètres) — est apposé sur les documents de réponse, puis le document est
                      SIGNÉ électroniquement (PAdES)&nbsp;: le cachet est couvert par la signature.
                      (NOUVEAU v0.2.128) le CONTENU du cachet se choisit dans le formulaire
                      ci-dessous — par défaut, AUCUNE information du certificat n&apos;est affichée.
                      Si le module est inactif ou sans certificat, le cachet n&apos;est PAS apposé
                      (jamais trompeur). Désactivé (OFF)&nbsp;: jamais apposé.
                    </p>
                  </div>
                  <Switch
                    id="rep-elec-actif"
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
                      {/* (NOUVEAU v0.2.120) FORME du cachet */}
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
                        DE CHOIX DES INFORMATIONS AFFICHÉES (jumelle de la section
                        Import ; interrupteurs PROPRES aux réponses). ---------- */}
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
                          <label key={cle} htmlFor={`reponses-${cle}`} className="flex cursor-pointer items-center gap-2 text-xs">
                            <Checkbox
                              id={`reponses-${cle}`}
                              checked={Boolean(cfg[cle])}
                              onCheckedChange={(v) => maj(cle, v === true)}
                            />
                            {libelle}
                          </label>
                        ))}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="reponses-elec-texte-libre" className="text-xs">
                          Ligne personnalisée (facultatif — 120 caractères maximum)
                        </Label>
                        <Input
                          id="reponses-elec-texte-libre"
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
                    certificat MASQUÉ (matériel cryptographique réservé au
                    superadministrateur) — une note informative le remplace. */}
                {masquerCertificat && (
                  <p className="rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
                    L&apos;import du fichier de certificat (et de sa clé privée) est réservé au
                    superadministrateur — contactez-le pour importer ou remplacer le fichier.
                    L&apos;interrupteur et le positionnement ci-dessus restent utilisables ; le
                    certificat enregistré continue de s&apos;appliquer aux réponses.
                  </p>
                )}
                {!masquerCertificat && (
                  <>
                {/* ---------- (NOUVEAU v0.2.99) IMPORT DÉDIÉ du certificat —
                    fichier + mot de passe PKCS#12, propres aux réponses ---------- */}
                <div className="space-y-1.5">
                  <Label htmlFor="rep-certificat-fichier" className="text-xs">
                    Fichier de certificat de CETTE section (mot de passe PKCS#12 pris en charge)
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="rep-certificat-fichier"
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
                          // (v0.2.112) même custody : retirer le certificat
                          // retire aussi la clé privée associée.
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
                      <Label htmlFor="rep-certificat-mdp" className="text-xs">
                        Mot de passe du fichier PKCS#12 (.p12/.pfx)
                      </Label>
                      <Input
                        id="rep-certificat-mdp"
                        type="password"
                        value={certMdp}
                        onChange={(e) => setCertMdp(e.target.value)}
                        className="h-9 text-sm"
                        autoComplete="off"
                        placeholder="Mot de passe utilisé lors de l&apos;export du certificat"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Stocké CHIFFRÉ (AES-256) pour cette section uniquement — jamais renvoyé
                        à l&apos;interface, jamais partagé avec l&apos;onglet Importation.
                      </p>
                    </div>
                  )}

                  {/* ---------- (NOUVEAU v0.2.112) CLÉ PRIVÉE ASSOCIÉE ----------
                       Certificat SEUL accepté quand la clé est déjà dans le
                       système (appariement vérifié) ; coffre .p12/.pfx = clé
                       incluse ; clé séparée .pem/.key/.der sinon. */}
                  {!(certLocal && COFFRES_PKCS12.includes(extensionCertLocal()) && certLocal.base64) && (
                    <div className="space-y-1">
                      <Label htmlFor="rep-certificat-cle-fichier" className="text-xs">
                        Clé privée associée (.pem, .key, .der) — facultative
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="rep-certificat-cle-fichier"
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
                          id="rep-certificat-cle-mdp"
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
                        inutile). Un certificat SEUL est accepté quand la clé privée est déjà
                        enregistrée pour les réponses — l&apos;appariement est vérifié par le serveur.
                        Formats : PKCS#8 ou PKCS#1, clair ou chiffré. Stockée CHIFFRÉE, propre à
                        cette section.
                      </p>
                    </div>
                  )}
                </div>

                {certLocal && certLocal.base64 === "" && (
                  <p className="text-xs rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-amber-800">
                    Certificat des réponses à retirer : cliquez sur «&nbsp;Enregistrer&nbsp;» pour
                    confirmer. Le certificat de l&apos;onglet Importation n&apos;est pas affecté.
                  </p>
                )}
                {certLocal && certLocal.base64 !== "" && (
                  <p className="text-xs rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-emerald-800">
                    Nouveau fichier en attente : <b>{certLocal.nom}</b> — cliquez sur
                    «&nbsp;Enregistrer&nbsp;». Le serveur vérifiera son contenu (et son mot de passe
                    s&apos;il s&apos;agit d&apos;un coffre .p12/.pfx) puis le stockera CHIFFRÉ
                    comme certificat DÉDIÉ des réponses.
                  </p>
                )}

                {!cfg.certFormat && !certLocal && source !== "import" && (
                  <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                    Aucun certificat DÉDIÉ importé : les réponses n&apos;apposent aucun bloc
                    certificat — même si l&apos;onglet Importation en possède un (les sections sont
                    indépendantes). Importez un fichier ci-dessus pour activer le bloc
                    «&nbsp;Signature électronique certifiée&nbsp;» des réponses.
                  </p>
                )}

                {!cfg.certFormat && !certLocal && source === "import" && (
                  <p className="rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-xs text-sky-800">
                    Configuration des réponses pas encore enregistrée : le certificat de
                    l&apos;onglet Importation s&apos;applique aux réponses (continuité). Importez
                    ci-dessus un fichier DÉDIÉ puis enregistrez pour détacher définitivement cette
                    section.
                  </p>
                )}
                  </>
                )}

                {cfg.certFormat && (
                  <div className="space-y-1.5 rounded-md border bg-muted/30 px-2.5 py-2 text-xs">
                    {source === "import" ? (
                      <p className="text-sky-800">
                        Certificat actuellement appliqué (hérité de la section Import — continuité
                        tant que cette configuration n&apos;est pas enregistrée) :
                      </p>
                    ) : (
                      <p className="text-emerald-700">
                        Certificat DÉDIÉ des réponses
                        {cfg.certHeriteImport ? " (repris de l&apos;Import lors de la mise à jour — il évolue désormais indépendamment)" : ""}&nbsp;:
                      </p>
                    )}
                    <p><b>Titulaire :</b> {cfg.certSujet || "—"}</p>
                    <p><b>Émetteur :</b> {cfg.certEmetteur || "—"}</p>
                    <p>
                      <b>Validité :</b> du {dateFr(cfg.certValideDu)} au {dateFr(cfg.certValideAu)}
                    </p>
                    <p>
                      <b>Empreinte SHA-256 :</b>{" "}
                      <span className="font-mono text-[11px] break-all">{cfg.certEmpreinte || "—"}</span>
                    </p>
                    <p className="text-muted-foreground">
                      <b>Fichier importé :</b> {cfg.certFichierNom || "—"}
                      {source !== "import" && cfg.certImportLe ? ` (le ${dateFr(cfg.certImportLe)})` : ""}
                      {source === "import" ? " (section Import)" : " — certificat DÉDIÉ aux réponses"}.
                    </p>
                    {source !== "import" && cfg.certChemin ? (
                      <p className="text-muted-foreground">
                        <b>Emplacement :</b> {cfg.certChemin} — copie de contrôle CHIFFRÉE propre aux
                        réponses (AES-256, illisible comme les fiches).
                      </p>
                    ) : null}
                    {source !== "import" ? (
                      <p className="text-muted-foreground">
                        <b>Mot de passe PKCS#12 :</b>{" "}
                        {cfg.certMotDePasseEnregistre
                          ? "enregistré (chiffré AES-256 sur le serveur, jamais affiché)"
                          : "non renseigné"}
                        .
                      </p>
                    ) : null}
                    {/* (NOUVEAU v0.2.112) état de la CLÉ PRIVÉE associée */}
                    {source !== "import" ? (
                      <p>
                        <b>Clé privée :</b>{" "}
                        {cfg.certClePriveeDisponible ? (
                          <span className="text-emerald-700 font-medium">disponible dans le système</span>
                        ) : (
                          <span className="text-muted-foreground">non disponible</span>
                        )}
                        {cfg.certCleFichierNom ? (
                          <span className="text-muted-foreground">
                            {" "}— {cfg.certCleFichierNom}
                            {cfg.certCleType ? ` — ${cfg.certCleType}` : ""}
                          </span>
                        ) : null}
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
                  Aperçu sur un document de réponse
                </Button>
                <span className="text-xs text-muted-foreground">
                  (v0.2.99 — configuration et certificat entièrement séparés de la section Import)
                </span>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
