/**
 * ============================================================================
 *  NOUVEAU (Task 184, v0.2.144) — SECTION « RÉPONSE AUTOMATIQUE PDF PAR
 *  E-MAIL » (onglet Demandes — rôles RH + SUPERADMIN)
 * ============================================================================
 *  Demande utilisateur : « Ajouter, sous la rubrique Demandes, une nouvelle
 *  section dédiée à la génération automatique d'une réponse au format PDF,
 *  envoyée par e-mail aux employés, RH et managers concernés » avec une
 *  « configuration spécifique et indépendante… sans modifier ni dépendre
 *  directement de la configuration utilisée pour l'import des fiches de paie ».
 *
 *  Configuration TOTALEMENT INDÉPENDANTE (/api/reponse-pdf-config — modèle
 *  ReponsePdfConfig) reprenant le MÊME principe de fonctionnement et
 *  d'interface que l'import des fichiers :
 *   - Génération + envoi automatiques (interrupteur de la section) ;
 *   - SIGNATURE ÉLECTRONIQUE : certificat DÉDIÉ (.p12/.pfx importé ICI,
 *     chiffré, mot de passe chiffré) — JAMAIS celui de l'Import ni du module ;
 *   - SIGNATURE IMAGE (paraphe), TAMPON (cachet) : images importées ICI ;
 *   - QR CODE : 5 modes (dont « Fiche en ligne » → page publique de
 *     vérification de la réponse) ;
 *   - CACHET « Signature électronique » : alimenté par LE certificat dédié ;
 *   - POSITIONNEMENT INTERACTIF identique : chaque élément déplaçable à la
 *     souris/au doigt sur l'aperçu A4 du document (gabarit réel), tailles,
 *     décalages fins ±1500 pt et rotations 0 → 360° — positions CONSERVÉES
 *     et appliquées AUTOMATIQUEMENT à chaque nouvelle réponse générée ;
 *   - E-MAIL : objet, corps, destinataires activables séparément (employé,
 *     RH, manager) + test d'envoi avec pièce jointe réelle ;
 *   - Aperçu PDF réel (généré selon CETTE configuration).
 *
 *  (v0.2.149 — trace 1a117b7977fabf2d) Aperçu PDF et Test d'envoi
 *  enregistrent D'ABORD les réglages AFFICHÉS avant de générer (WYSIWYG) :
 *  la désactivation d'un élément (paraphe, tampon, cachet, QR, mention,
 *  signature, envoi) est IMMÉDIATEMENT visible sur l'aperçu et reflétée
 *  dans le PDF réellement envoyé — fini l'aperçu fondé sur la dernière
 *  configuration enregistrée (cause du signalement « la désactivation du
 *  paraphe / du tampon ne fonctionne pas »).
 *
 *  (v0.2.186 — demande « Dans le rôle RH, masquer juste la partie « Signature
 *  électronique — certificat dédié » dans la section « Réponse automatique
 *  PDF par e-mail (congé / autorisation) ») : NOUVELLE prop `masquerCertificat`
 *  (passée par DemandesTab : role === "RH") — quand elle est vraie, le BLOC
 *  « Signature électronique — certificat dédié à cette section » (import
 *  .p12/.pfx, mot de passe, interrupteur de signature, nom et fonction du
 *  signataire) N'EST PLUS AFFICHÉ ; l'avertissement du cachet « Signature
 *  électronique » renvoie alors vers le superadministrateur. Le
 *  superadministrateur conserve le bloc ENTIÈR ; la configuration enregistrée
 *  (interrupteur signer, certificat importé) continue de s'appliquer aux
 *  réponses générées quelle que soit la personne qui consulte la section —
 *  un enregistrement fait depuis la vue RH réécrit les valeurs du certificat
 *  TELLES QUE CHARGÉES du serveur (aucun écrasement possible).
 * ============================================================================
 */
import { useCallback, useEffect, useState } from "react";
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
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  BadgeCheck,
  Eye,
  FileSignature,
  Loader2,
  Mail,
  QrCode,
  Save,
  Send,
  ShieldCheck,
  Stamp,
  Trash2,
  Upload,
} from "lucide-react";
import {
  ApercuPositionnement,
  type ConfigApercu,
} from "./apercu-positionnement";

/* ---------- Types de la configuration renvoyée par GET ---------- */
interface ConfigReponsePdf {
  actif: boolean;
  certificat: {
    present: boolean;
    nom: string;
    empreinte: string;
    importeLe: string | null;
    hasCertPassword: boolean;
    actif: boolean;
    signer: boolean;
    position: string;
    decalX: number;
    decalY: number;
    taille: number;
    signataire: string;
    fonction: string;
    sujet: string;
    emetteur: string;
    serie: string;
    valideDu: string | null;
    valideAu: string | null;
  };
  paraphe: {
    presente: boolean;
    actif: boolean;
    image: string;
    nom: string;
    position: string;
    taille: number;
    opacite: number;
    decalX: number;
    decalY: number;
    rotation: number;
  };
  tampon: {
    presente: boolean;
    actif: boolean;
    image: string;
    nom: string;
    position: string;
    taille: number;
    opacite: number;
    decalX: number;
    decalY: number;
    rotation: number;
  };
  qr: {
    actif: boolean;
    mode: string;
    url: string;
    texte: string;
    presente: boolean;
    image: string;
    nom: string;
    position: string;
    taille: number;
    decalX: number;
    decalY: number;
    rotation: number;
  };
  elec: {
    actif: boolean;
    position: string;
    decalX: number;
    decalY: number;
    taille: number;
    forme: string;
    affSignataire: boolean;
    affOrganisation: boolean;
    affEmetteur: boolean;
    affValidite: boolean;
    affEmpreinte: boolean;
    texteLibre: string;
  };
  mention: {
    actif: boolean;
    texte: string;
  };
  envoi: {
    actif: boolean;
    objet: string;
    corps: string;
    envoyerEmploye: boolean;
    envoyerRh: boolean;
    envoyerManager: boolean;
    rhEmail: string;
  };
}

const POSITIONS = [
  { valeur: "BAS_DROITE", libelle: "Bas droite" },
  { valeur: "BAS_GAUCHE", libelle: "Bas gauche" },
  { valeur: "HAUT_DROITE", libelle: "Haut droite" },
  { valeur: "HAUT_GAUCHE", libelle: "Haut gauche" },
];
const POSITIONS_CERT = [
  ...POSITIONS,
  { valeur: "BAS_CENTRE", libelle: "Bas centre (défaut)" },
];
const MODES_QR = [
  { valeur: "DONNEES", libelle: "Données du document (réf, employé, empreinte)" },
  { valeur: "URL", libelle: "URL de vérification (adresse + paramètres)" },
  { valeur: "FICHE", libelle: "Réponse en ligne (page publique de vérification)" },
  { valeur: "TEXTE", libelle: "Texte libre" },
  { valeur: "IMAGE", libelle: "Image fournie (QR importé)" },
];

/** Lit un fichier image local → dataURL (PNG/JPEG, plafond ≈ 8 Mo). */
function lireImage(dataUrlRetour: (s: string) => void, fichier: File, onErreur: () => void) {
  if (!/image\/(png|jpe?g)/.test(fichier.type)) {
    onErreur();
    return;
  }
  if (fichier.size > 8 * 1024 * 1024) {
    onErreur();
    return;
  }
  const lecteur = new FileReader();
  lecteur.onload = () => dataUrlRetour(String(lecteur.result || ""));
  lecteur.onerror = onErreur;
  lecteur.readAsDataURL(fichier);
}

/* ---------- Curseurs réutilisables (décalages fins + rotation) ---------- */
function CurseursDecal({
  decalX,
  decalY,
  maj,
  prefixe,
}: {
  decalX: number;
  decalY: number;
  maj: (champ: string, valeur: number) => void;
  prefixe: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <Label className="text-xs">
          Décalage X : {decalX > 0 ? "+" : ""}{decalX} pt
        </Label>
        <Slider
          value={[decalX]}
          min={-1500}
          max={1500}
          step={1}
          onValueChange={(v) => maj(prefixe + "DecalX", v[0] ?? 0)}
          className="mt-2"
        />
      </div>
      <div>
        <Label className="text-xs">
          Décalage Y : {decalY > 0 ? "+" : ""}{decalY} pt
        </Label>
        <Slider
          value={[decalY]}
          min={-1500}
          max={1500}
          step={1}
          onValueChange={(v) => maj(prefixe + "DecalY", v[0] ?? 0)}
          className="mt-2"
        />
      </div>
    </div>
  );
}

function CurseurRotation({
  rotation,
  maj,
  champ,
}: {
  rotation: number;
  maj: (champ: string, valeur: number) => void;
  champ: string;
}) {
  return (
    <div>
      <Label className="text-xs">Rotation : {rotation}° (sens horaire)</Label>
      <Slider
        value={[rotation]}
        min={0}
        max={360}
        step={1}
        onValueChange={(v) => maj(champ, v[0] ?? 0)}
        className="mt-2"
      />
    </div>
  );
}

export function ReponsePdfPanel({
  // (v0.2.186) MASQUER le bloc « Signature électronique — certificat dédié » —
  // vrai pour le rôle RH (DemandesTab) ; SUPERADMIN conserve le bloc complet.
  masquerCertificat = false,
}: {
  masquerCertificat?: boolean;
}) {
  const { toast } = useToast();
  const [chargement, setChargement] = useState(true);
  const [enregistrement, setEnregistrement] = useState(false);
  const [cfg, setCfg] = useState<ConfigReponsePdf | null>(null);

  // état local des images (non enregistrées tant que « Enregistrer » n'est pas cliqué)
  const [parapheNouvelle, setParapheNouvelle] = useState<string | null>(null);
  const [parapheNomNouveau, setParapheNomNouveau] = useState("");
  const [tamponNouveau, setTamponNouveau] = useState<string | null>(null);
  const [tamponNomNouveau, setTamponNomNouveau] = useState("");
  const [qrNouvelle, setQrNouvelle] = useState<string | null>(null);
  const [qrNomNouveau, setQrNomNouveau] = useState("");
  // aperçu PDF réel
  const [apercuChargement, setApercuChargement] = useState(false);
  // certificat dédié — états conservés d'un rendu à l'autre
  const [certFichier, setCertFichier] = useState<File | null>(null);
  const [certMdp, setCertMdp] = useState("");
  const [certAction, setCertAction] = useState(false);
  // test d'envoi
  const [destTest, setDestTest] = useState("");
  const [testChargement, setTestChargement] = useState(false);

  /* ---------- Aperçu interactif du QR (généré côté client, comme Import) ---------- */
  const [qrApercu, setQrApercu] = useState("");
  useEffect(() => {
    let vivant = true;
    if (!cfg || !cfg.qr.actif || cfg.qr.mode === "IMAGE") {
      setQrApercu("");
      return;
    }
    const contenu =
      cfg.qr.mode === "URL"
        ? cfg.qr.url || "https://verification.autorh.local"
        : cfg.qr.mode === "FICHE"
          ? (cfg.qr.url || "https://verification.autorh.local") + "/verification/reponse/DEM-…?t=…"
          : cfg.qr.mode === "TEXTE"
            ? cfg.qr.texte || "Aperçu QR — AutoRH"
            : "AutoRH — Document officiel\nRéf : DEM-2026-…\nEmployé : —\nCIN : —\nObjet : Demande de congé\nStatut : Acceptée\nEmpreinte : …";
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
  }, [cfg]);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const res = await fetch("/api/reponse-pdf-config", { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.config) {
        setCfg(d.config);
      } else if (res.status === 403) {
        return; // IT : panneau non affiché de toute façon
      } else {
        toast({ title: "Lecture impossible", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Serveur inaccessible", variant: "destructive" });
    } finally {
      setChargement(false);
    }
  }, [toast]);

  useEffect(() => {
    charger();
  }, [charger]);

  if (chargement || !cfg) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement de la configuration…
        </CardContent>
      </Card>
    );
  }

  /* ---------- Helpers de mise à jour ---------- */
  function maj<K extends keyof ConfigReponsePdf>(cle: K, valeur: ConfigReponsePdf[K]) {
    setCfg((c) => (c ? { ...c, [cle]: valeur } : c));
  }
  function majParaphe(patch: Partial<ConfigReponsePdf["paraphe"]>) {
    setCfg((c) => (c ? { ...c, paraphe: { ...c.paraphe, ...patch } } : c));
  }
  function majTampon(patch: Partial<ConfigReponsePdf["tampon"]>) {
    setCfg((c) => (c ? { ...c, tampon: { ...c.tampon, ...patch } } : c));
  }
  function majQr(patch: Partial<ConfigReponsePdf["qr"]>) {
    setCfg((c) => (c ? { ...c, qr: { ...c.qr, ...patch } } : c));
  }
  function majElec(patch: Partial<ConfigReponsePdf["elec"]>) {
    setCfg((c) => (c ? { ...c, elec: { ...c.elec, ...patch } } : c));
  }
  function majCertificat(patch: Partial<ConfigReponsePdf["certificat"]>) {
    setCfg((c) => (c ? { ...c, certificat: { ...c.certificat, ...patch } } : c));
  }
  function majMention(patch: Partial<ConfigReponsePdf["mention"]>) {
    setCfg((c) => (c ? { ...c, mention: { ...c.mention, ...patch } } : c));
  }
  function majEnvoi(patch: Partial<ConfigReponsePdf["envoi"]>) {
    setCfg((c) => (c ? { ...c, envoi: { ...c.envoi, ...patch } } : c));
  }

  /* ---------- Images affichées (aperçu = rendu réel) ---------- */
  const imageParapheAffichee = parapheNouvelle != null ? parapheNouvelle : cfg.paraphe.image;
  const imageTamponAffichee = tamponNouveau != null ? tamponNouveau : cfg.tampon.image;
  const imageQrFourniAffichee = qrNouvelle != null ? qrNouvelle : cfg.qr.image;

  /* ---------- Corps de sauvegarde (PARTAGÉ : Enregistrer / Aperçu / Test) ---------- */
  // (v0.2.149) trace 1a117b7977fabf2d : « la désactivation du paraphe / du
  // tampon ne fonctionne pas » — L'APERÇU et le TEST D'ENVOI étaient générés
  // à partir de la DERNIÈRE configuration ENREGISTRÉE (serveur), pas des
  // interrupteurs affichés : désactiver un élément puis cliquer Aperçu sans
  // « Enregistrer » montrait encore l'élément. Désormais Aperçu et Test
  // d'envoi ENREGISTRENT D'ABORD l'état affiché (WYSIWYG : l'aperçu reflète
  // EXACTEMENT les interrupteurs visibles à l'écran).
  function corpsEnregistrement(): Record<string, unknown> | null {
    if (!cfg) return null;
    const corps: Record<string, unknown> = {
      actif: cfg.actif,
      // (v0.2.145) interrupteurs indépendants par élément
      sigActif: cfg.paraphe.actif,
      tamponActif: cfg.tampon.actif,
      signerActif: cfg.certificat.signer,
      // certificat dédié (bloc + signataire)
      certActif: cfg.certificat.actif,
      certPosition: cfg.certificat.position,
      certDecalX: cfg.certificat.decalX,
      certDecalY: cfg.certificat.decalY,
      certTaille: cfg.certificat.taille,
      certSignataire: cfg.certificat.signataire,
      certFonction: cfg.certificat.fonction,
      // paraphe
      sigPosition: cfg.paraphe.position,
      sigTaille: cfg.paraphe.taille,
      sigOpacite: cfg.paraphe.opacite,
      sigDecalX: cfg.paraphe.decalX,
      sigDecalY: cfg.paraphe.decalY,
      sigRotation: cfg.paraphe.rotation,
      // tampon
      tamponPosition: cfg.tampon.position,
      tamponTaille: cfg.tampon.taille,
      tamponOpacite: cfg.tampon.opacite,
      tamponDecalX: cfg.tampon.decalX,
      tamponDecalY: cfg.tampon.decalY,
      tamponRotation: cfg.tampon.rotation,
      // QR
      qrActif: cfg.qr.actif,
      qrMode: cfg.qr.mode,
      qrUrl: cfg.qr.url,
      qrTexte: cfg.qr.texte,
      qrPosition: cfg.qr.position,
      qrTaille: cfg.qr.taille,
      qrDecalX: cfg.qr.decalX,
      qrDecalY: cfg.qr.decalY,
      qrRotation: cfg.qr.rotation,
      // cachet électronique
      elecActif: cfg.elec.actif,
      elecPosition: cfg.elec.position,
      elecDecalX: cfg.elec.decalX,
      elecDecalY: cfg.elec.decalY,
      elecTaille: cfg.elec.taille,
      elecForme: cfg.elec.forme,
      elecAffSignataire: cfg.elec.affSignataire,
      elecAffOrganisation: cfg.elec.affOrganisation,
      elecAffEmetteur: cfg.elec.affEmetteur,
      elecAffValidite: cfg.elec.affValidite,
      elecAffEmpreinte: cfg.elec.affEmpreinte,
      elecTexteLibre: cfg.elec.texteLibre,
      // mention
      mentionActif: cfg.mention.actif,
      mentionTexte: cfg.mention.texte,
      // envoi
      emailActif: cfg.envoi.actif,
      emailObjet: cfg.envoi.objet,
      emailCorps: cfg.envoi.corps,
      envoyerEmploye: cfg.envoi.envoyerEmploye,
      envoyerRh: cfg.envoi.envoyerRh,
      envoyerManager: cfg.envoi.envoyerManager,
    };
    if (parapheNouvelle != null) {
      corps.sigImage = parapheNouvelle;
      corps.sigImageNom = parapheNomNouveau;
    }
    if (tamponNouveau != null) {
      corps.tamponImage = tamponNouveau;
      corps.tamponImageNom = tamponNomNouveau;
    }
    if (qrNouvelle != null) {
      corps.qrImage = qrNouvelle;
      corps.qrImageNom = qrNomNouveau;
    }
    return corps;
  }

  /** Enregistre l'état affiché SANS toast de succès (aperçu/test annoncent
   *  eux-mêmes le résultat) ; false = abort (erreur déjà toastée). */
  async function sauvegarderAvantApercu(): Promise<boolean> {
    const corps = corpsEnregistrement();
    if (!corps) return false;
    try {
      const res = await fetch("/api/reponse-pdf-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps),
      });
      if (res.ok) {
        setParapheNouvelle(null);
        setTamponNouveau(null);
        setQrNouvelle(null);
        return true;
      }
      const d = await res.json().catch(() => ({}));
      toast({ title: d.error || "Enregistrement impossible", description: "L'aperçu reflète la configuration : corrigez l'enregistrement puis réessayez.", variant: "destructive" });
      return false;
    } catch {
      toast({ title: "Serveur inaccessible", variant: "destructive" });
      return false;
    }
  }

  /* ---------- Enregistrement (PUT) ---------- */
  async function enregistrer() {
    if (!cfg) return;
    const corps = corpsEnregistrement();
    if (!corps) return;
    setEnregistrement(true);
    try {
      const res = await fetch("/api/reponse-pdf-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setParapheNouvelle(null);
        setTamponNouveau(null);
        setQrNouvelle(null);
        toast({ title: "Configuration enregistrée", description: "Les paramètres seront appliqués automatiquement à chaque réponse PDF générée." });
        await charger();
      } else {
        toast({ title: "Enregistrement impossible", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Serveur inaccessible", variant: "destructive" });
    } finally {
      setEnregistrement(false);
    }
  }

  /* ---------- Import du certificat DÉDIÉ (.p12/.pfx) ---------- */
  async function importerCertificat() {
    if (!certFichier) {
      toast({ title: "Aucun fichier sélectionné", variant: "destructive" });
      return;
    }
    setCertAction(true);
    try {
      const fd = new FormData();
      fd.append("action", "certificat");
      fd.append("fichier", certFichier);
      fd.append("motDePasse", certMdp);
      const res = await fetch("/api/reponse-pdf-config", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "Certificat importé (dédié à cette section)", description: d.diagnostic?.message });
        setCertFichier(null);
        setCertMdp("");
        await charger();
      } else {
        toast({ title: "Import impossible", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Serveur inaccessible", variant: "destructive" });
    } finally {
      setCertAction(false);
    }
  }

  async function supprimerCertificat() {
    setCertAction(true);
    try {
      const fd = new FormData();
      fd.append("action", "supprimer-certificat");
      const res = await fetch("/api/reponse-pdf-config", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "Certificat retiré" });
        await charger();
      } else {
        toast({ title: "Suppression impossible", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Serveur inaccessible", variant: "destructive" });
    } finally {
      setCertAction(false);
    }
  }

  async function verifierCertificat() {
    setCertAction(true);
    try {
      const fd = new FormData();
      fd.append("action", "verifier-certificat");
      const res = await fetch("/api/reponse-pdf-config", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      toast(
        d.ok
          ? { title: "Certificat vérifié", description: d.message }
          : { title: "Diagnostic", description: d.message, variant: "destructive" }
      );
    } catch {
      toast({ title: "Serveur inaccessible", variant: "destructive" });
    } finally {
      setCertAction(false);
    }
  }

  /* ---------- Aperçu (PDF réel) + test d'envoi ---------- */
  async function genererApercu() {
    setApercuChargement(true);
    try {
      // (v0.2.149) WYSIWYG : l'aperçu est généré APRÈS enregistrement de
      // l'état AFFICHÉ — désactiver le paraphe / le tampon / le cachet puis
      // cliquer Aperçu montre IMMÉDIATEMENT le document sans l'élément
      // (fin du « la désactivation ne fonctionne pas »).
      const sauvegarde = await sauvegarderAvantApercu();
      if (!sauvegarde) return;
      const fd = new FormData();
      fd.append("action", "apercu");
      const res = await fetch("/api/reponse-pdf-config", { method: "POST", body: fd });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        // (v0.2.147) résumé EXPLICITE du rendu réel : éléments appliqués,
        // signature cryptographique OUI/NON + avertissements éventuels
        // (signature électronique / cachet activés mais non appliqués faute
        // de certificat) — plus JAMAIS de saut silencieux.
        const elems = (res.headers.get("X-Apercu-Elements") || "").split(",").filter(Boolean).join(", ");
        const cryptoOk = res.headers.get("X-Apercu-Signature-Crypto") === "1";
        let avert: string[] = [];
        try { avert = JSON.parse(decodeURIComponent(res.headers.get("X-Apercu-Avertissements") || "[]")); } catch { /* */ }
        toast({
          title: "Aperçu généré — configuration enregistrée",
          description:
            "L'aperçu reflète les interrupteurs affichés. Éléments appliqués : " + (elems || "aucun") +
            " — signature cryptographique : " + (cryptoOk ? "OUI" : "NON") +
            (avert.length ? " — " + avert.length + " avertissement(s) !" : "."),
          variant: avert.length ? "destructive" : undefined,
        });
        for (const a of avert) {
          toast({ title: "Avertissement — configuration incomplète", description: a, variant: "destructive" });
        }
      } else {
        const d = await res.json().catch(() => ({}));
        toast({ title: d.error || "Aperçu impossible", variant: "destructive" });
      }
    } catch {
      toast({ title: "Serveur inaccessible", variant: "destructive" });
    } finally {
      setApercuChargement(false);
    }
  }

  async function testerEnvoi() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destTest)) {
      toast({ title: "Adresse de test invalide", variant: "destructive" });
      return;
    }
    setTestChargement(true);
    try {
      // (v0.2.149) WYSIWYG : le test d'envoi part de l'état AFFICHÉ.
      const sauvegarde = await sauvegarderAvantApercu();
      if (!sauvegarde) return;
      const fd = new FormData();
      fd.append("action", "test-envoi");
      fd.append("dest", destTest);
      const res = await fetch("/api/reponse-pdf-config", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "E-mail de test envoyé", description: "Pièce jointe réelle : le PDF généré selon la configuration." });
      } else {
        toast({ title: d.error || "Envoi impossible", variant: "destructive" });
      }
    } catch {
      toast({ title: "Serveur inaccessible", variant: "destructive" });
    } finally {
      setTestChargement(false);
    }
  }

  /* ---------- Configuration de l'aperçu interactif (= rendu moteur) ---------- */
  const cfgApercu: ConfigApercu = {
    // (v0.2.145) aperçu = rendu réel : chaque interrupteur masque son élément
    sigActif: cfg.paraphe.actif && Boolean(imageParapheAffichee),
    sigTexte: "",
    sigPosition: cfg.paraphe.position,
    sigTaille: cfg.paraphe.taille,
    sigOpacite: cfg.paraphe.opacite,
    sigDecalX: cfg.paraphe.decalX,
    sigDecalY: cfg.paraphe.decalY,
    qrActif: cfg.qr.actif,
    qrPosition: cfg.qr.position,
    qrTaille: cfg.qr.taille,
    qrDecalX: cfg.qr.decalX,
    qrDecalY: cfg.qr.decalY,
    certActif: false,
    certSujet: "",
    certEmetteur: "",
    certSerie: "",
    certValideAu: null,
    certEmpreinte: "",
    certPosition: "BAS_CENTRE",
    certDecalX: 0,
    certDecalY: 0,
    certTaille: 100,
    elecActif: cfg.elec.actif,
    elecPosition: cfg.elec.position,
    elecDecalX: cfg.elec.decalX,
    elecDecalY: cfg.elec.decalY,
    elecTaille: cfg.elec.taille,
    elecForme: cfg.elec.forme,
    elecAffSignataire: cfg.elec.affSignataire,
    elecAffOrganisation: cfg.elec.affOrganisation,
    elecAffEmetteur: cfg.elec.affEmetteur,
    elecAffValidite: cfg.elec.affValidite,
    elecAffEmpreinte: cfg.elec.affEmpreinte,
    elecTexteLibre: cfg.elec.texteLibre,
    elec: null,
    mentionActif: cfg.mention.actif,
    tamponActif: cfg.tampon.actif,
    tamponPosition: cfg.tampon.position,
    tamponTaille: cfg.tampon.taille,
    tamponDecalX: cfg.tampon.decalX,
    tamponDecalY: cfg.tampon.decalY,
    basDecal: 42,
    varianteApercu: "document-demande",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Mail className="h-5 w-5 text-emerald-600" />
          Réponse automatique PDF par e-mail (congé / autorisation)
        </CardTitle>
        <CardDescription>
          Après chaque ACCEPTATION d&apos;une demande, un PDF complet — informations de la demande,
          employé, manager N+1, validations manager/RH, historique — est généré, signé, tamponné, enregistré
          dans le portail puis envoyé par e-mail (pièce jointe) à l&apos;employé, au RH et au manager.
          (v0.2.188) En cas de REFUS d&apos;une demande de congé ou d&apos;autorisation de sortie, AUCUN PDF de
          refus n&apos;est généré ni envoyé : l&apos;employé reçoit un e-mail de notification de refus SANS PDF,
          transportant les pièces jointes fournies par le manager et/ou le service RH (visibles également
          dans « Mes demandes »).
          Configuration TOTALEMENT INDÉPENDANTE de celle de l&apos;import des fiches de paie.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ---------- Interrupteur général ---------- */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <div className="text-sm font-medium">Génération et envoi automatiques de la réponse PDF</div>
            <div className="text-xs text-muted-foreground">
              PDF généré + signé + tamponné, enregistré dans le portail, joint à l&apos;e-mail de réponse
              (demandes ACCEPTÉES — refus congé/autorisation : notification e-mail sans PDF, v0.2.188).
            </div>
          </div>
          <Switch checked={cfg.actif} onCheckedChange={(v) => maj("actif", v)} />
        </div>

        {/* (v0.2.148) AVERTISSEMENT MAJEUR : section INACTIVE → AUCUN document
            généré, signé ni envoyé, même si la configuration (certificat,
            cachet « Signature électronique », signature) est complète.
            L'aperçu reflète TOUJOURS cette configuration — mais les documents
            RÉELLEMENT ENVOYÉS par e-mail ne suivent qu'une section ACTIVE
            (trace 1a1178618b8b7729 : aperçu OK, PDF reçu sans signature). */}
        {!cfg.actif && (
          <div className="text-xs rounded-lg border border-red-300 bg-red-50 p-3 text-red-900 font-medium">
            Génération automatique DÉSACTIVÉE : AUCUNE réponse PDF ne sera générée, signée ni envoyée
            par e-mail tant que cet interrupteur principal est désactivé — même si le certificat, le
            cachet « Signature électronique » et les autres éléments sont configurés ci-dessous.
            L&apos;aperçu reflète cette configuration, mais les documents réellement envoyés suivent
            uniquement une section ACTIVE : activez l&apos;interrupteur pour appliquer la signature
            électronique et le cachet aux PDF envoyés.
          </div>
        )}

        {/* ---------- APERÇU INTERACTIF (déplacer / redimensionner) ---------- */}
        <div className="rounded-lg border p-3">
          <div className="mb-2 flex items-center gap-2">
            <Stamp className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-medium">Positionnement interactif sur l&apos;aperçu du document</span>
          </div>
          <ApercuPositionnement
            cfg={cfgApercu}
            imageSig={imageParapheAffichee || ""}
            imageQr={cfg.qr.mode === "IMAGE" ? imageQrFourniAffichee || "" : qrApercu}
            imageTampon={imageTamponAffichee || ""}
            maj={(cle, valeur) => {
              const suffixe = cle.endsWith("DecalX") ? "decalX" : cle.endsWith("DecalY") ? "decalY" : null;
              if (!suffixe) return;
              if (cle.startsWith("sig")) majParaphe({ [suffixe]: valeur } as never);
              else if (cle.startsWith("tampon")) majTampon({ [suffixe]: valeur } as never);
              else if (cle.startsWith("qr")) majQr({ [suffixe]: valeur } as never);
              else if (cle.startsWith("elec")) majElec({ [suffixe]: valeur } as never);
            }}
            note="Glissez chaque élément n'importe où sur la feuille — la position est conservée puis appliquée automatiquement à la réponse générée. Ajustements fins ci-dessous (X/Y/rotation)."
            libelleFiche="A4 — réponse PDF"
          />
        </div>

        {/* ---------- SIGNATURE ÉLECTRONIQUE — CERTIFICAT DÉDIÉ ----------
             (v0.2.186) BLOC MASQUÉ pour le rôle RH (prop masquerCertificat) :
             le certificat dédié reste géré par le superadministrateur ; la
             configuration enregistrée (interrupteur de signature, certificat
             importé) continue de s'appliquer aux réponses générées. */}
        {!masquerCertificat && (
          <>
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-medium">Signature électronique — certificat dédié à cette section</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={"text-xs " + (cfg.certificat.signer ? "text-emerald-700" : "text-muted-foreground")}>
                {cfg.certificat.signer ? "Activée" : "Désactivée"}
              </span>
              <Switch checked={cfg.certificat.signer} onCheckedChange={(v) => majCertificat({ signer: v })} aria-label="Activer ou désactiver la signature électronique" />
            </div>
          </div>
          <div className="text-xs rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-emerald-900">
            Ce certificat est PROPRE aux réponses PDF des demandes : il est indépendant du certificat de
            l&apos;import des fiches de paie et du module de signature. Importez ici le fichier .p12 / .pfx
            dédié — la signature PAdES (PKCS#7 vérifiable dans Acrobat) l&apos;appliquera à chaque réponse,
            APRÈS la génération complète du document et l&apos;ajout éventuel du paraphe, du tampon et du cachet.
          </div>
          {!cfg.certificat.signer && (
            <div className="text-xs rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-amber-900">
              Signature électronique DÉSACTIVÉE : le PDF de réponse sera généré SANS signature
              cryptographique — le paraphe, le tampon et le cachet restent appliqués selon leurs
              propres interrupteurs.
            </div>
          )}
          {/* (v0.2.147) AVERTISSEMENT MAJEUR : interrupteur ON mais AUCUN certificat */}
          {cfg.certificat.signer && !cfg.certificat.present && (
            <div className="text-xs rounded-lg border border-red-300 bg-red-50 p-3 text-red-900 font-medium">
              Signature électronique ACTIVÉE mais AUCUN certificat importé : les réponses PDF
              partiront SANS signature cryptographique. Importez ci-dessous un fichier .p12 / .pfx
              (avec son mot de passe) pour que la signature s&apos;applique réellement.
            </div>
          )}
          {cfg.certificat.present ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <div className="font-medium">{cfg.certificat.nom}</div>
                <div className="text-xs text-muted-foreground">
                  Importé le {cfg.certificat.importeLe ? new Date(cfg.certificat.importeLe).toLocaleDateString("fr-FR") : "—"}
                  {" · "}{cfg.certificat.hasCertPassword ? "mot de passe enregistré" : "SANS mot de passe"}
                  {cfg.certificat.sujet ? ` · ${cfg.certificat.sujet}` : ""}
                  {cfg.certificat.valideAu ? ` · valable jusqu'au ${new Date(cfg.certificat.valideAu).toLocaleDateString("fr-FR")}` : ""}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={verifierCertificat} disabled={certAction}>
                  <BadgeCheck className="mr-1 h-4 w-4" /> Vérifier
                </Button>
                <Button variant="outline" size="sm" onClick={supprimerCertificat} disabled={certAction}>
                  <Trash2 className="mr-1 h-4 w-4" /> Retirer
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">Aucun certificat dédié importé — la réponse PDF sera générée sans signature cryptographique.</div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              type="file"
              accept=".p12,.pfx"
              onChange={(e) => setCertFichier(e.target.files?.[0] ?? null)}
            />
            <Input
              type="password"
              placeholder="Mot de passe du certificat"
              value={certMdp}
              onChange={(e) => setCertMdp(e.target.value)}
            />
          </div>
          <Button size="sm" onClick={importerCertificat} disabled={certAction || !certFichier}>
            {certAction ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
            Importer le certificat
          </Button>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Nom du signataire (bloc « Fait le… »)</Label>
              <Input
                value={cfg.certificat.signataire}
                onChange={(e) => majCertificat({ signataire: e.target.value })}
                placeholder="Le service RH"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Fonction du signataire</Label>
              <Input
                value={cfg.certificat.fonction}
                onChange={(e) => majCertificat({ fonction: e.target.value })}
                placeholder="Directeur des Ressources Humaines"
                className="mt-1"
              />
            </div>
          </div>
        </div>
          </>
        )}

        {/* ---------- SIGNATURE IMAGE (paraphe) ---------- */}
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileSignature className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-medium">Signature sous forme d&apos;image (paraphe)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={"text-xs " + (cfg.paraphe.actif ? "text-emerald-700" : "text-muted-foreground")}>
                {cfg.paraphe.actif ? "Activé" : "Désactivé"}
              </span>
              <Switch checked={cfg.paraphe.actif} onCheckedChange={(v) => majParaphe({ actif: v })} aria-label="Activer ou désactiver le paraphe" />
            </div>
          </div>
          {/* (v0.2.145) réglages estompés et inertes quand l'interrupteur est OFF */}
          <div className={"space-y-3" + (cfg.paraphe.actif ? "" : " opacity-50 pointer-events-none")}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Position</Label>
              <Select value={cfg.paraphe.position} onValueChange={(v) => majParaphe({ position: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {POSITIONS.map((p) => (
                    <SelectItem key={p.valeur} value={p.valeur}>{p.libelle}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Largeur : {cfg.paraphe.taille} pt</Label>
              <Slider value={[cfg.paraphe.taille]} min={40} max={1200} step={1} onValueChange={(v) => majParaphe({ taille: v[0] ?? 120 })} className="mt-3" />
            </div>
            <div>
              <Label className="text-xs">Opacité : {Math.round(cfg.paraphe.opacite * 100)} %</Label>
              <Slider value={[cfg.paraphe.opacite]} min={0.3} max={1} step={0.05} onValueChange={(v) => majParaphe({ opacite: v[0] ?? 0.9 })} className="mt-3" />
            </div>
          </div>
          <CurseursDecal decalX={cfg.paraphe.decalX} decalY={cfg.paraphe.decalY} maj={(ch, v) => majParaphe({ [ch]: v } as never)} prefixe="decal" />
          <CurseurRotation rotation={cfg.paraphe.rotation} maj={(ch, v) => majParaphe({ [ch]: v } as never)} champ="rotation" />
          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="file"
              accept="image/png,image/jpeg"
              className="max-w-xs"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                lireImage((s) => { setParapheNouvelle(s); setParapheNomNouveau(f.name); }, f, () => toast({ title: "Image invalide (PNG/JPEG, 8 Mo max.)", variant: "destructive" }));
              }}
            />
            {(parapheNouvelle || cfg.paraphe.image) && (
              <Badge variant="outline" className="text-xs">
                {parapheNouvelle ? parapheNomNouveau || "nouvelle image" : cfg.paraphe.nom || "image enregistrée"}
              </Badge>
            )}
          </div>
          </div>
        </div>

        {/* ---------- TAMPON (cachet image) ---------- */}
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Stamp className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-medium">Tampon (cachet de l&apos;établissement)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={"text-xs " + (cfg.tampon.actif ? "text-emerald-700" : "text-muted-foreground")}>
                {cfg.tampon.actif ? "Activé" : "Désactivé"}
              </span>
              <Switch checked={cfg.tampon.actif} onCheckedChange={(v) => majTampon({ actif: v })} aria-label="Activer ou désactiver le tampon" />
            </div>
          </div>
          {/* (v0.2.145) réglages estompés et inertes quand l'interrupteur est OFF */}
          <div className={"space-y-3" + (cfg.tampon.actif ? "" : " opacity-50 pointer-events-none")}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Position</Label>
              <Select value={cfg.tampon.position} onValueChange={(v) => majTampon({ position: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {POSITIONS.map((p) => (
                    <SelectItem key={p.valeur} value={p.valeur}>{p.libelle}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Largeur : {cfg.tampon.taille} pt</Label>
              <Slider value={[cfg.tampon.taille]} min={40} max={1200} step={1} onValueChange={(v) => majTampon({ taille: v[0] ?? 140 })} className="mt-3" />
            </div>
            <div>
              <Label className="text-xs">Opacité : {Math.round(cfg.tampon.opacite * 100)} %</Label>
              <Slider value={[cfg.tampon.opacite]} min={0.3} max={1} step={0.05} onValueChange={(v) => majTampon({ opacite: v[0] ?? 0.85 })} className="mt-3" />
            </div>
          </div>
          <CurseursDecal decalX={cfg.tampon.decalX} decalY={cfg.tampon.decalY} maj={(ch, v) => majTampon({ [ch]: v } as never)} prefixe="decal" />
          <CurseurRotation rotation={cfg.tampon.rotation} maj={(ch, v) => majTampon({ [ch]: v } as never)} champ="rotation" />
          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="file"
              accept="image/png,image/jpeg"
              className="max-w-xs"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                lireImage((s) => { setTamponNouveau(s); setTamponNomNouveau(f.name); }, f, () => toast({ title: "Image invalide (PNG/JPEG, 8 Mo max.)", variant: "destructive" }));
              }}
            />
            {(tamponNouveau || cfg.tampon.image) && (
              <Badge variant="outline" className="text-xs">
                {tamponNouveau ? tamponNomNouveau || "nouvelle image" : cfg.tampon.nom || "image enregistrée"}
              </Badge>
            )}
          </div>
          </div>
        </div>

        {/* ---------- QR CODE ---------- */}
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <QrCode className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-medium">QR Code de vérification / consultation</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-lg border p-2">
              <Label className="text-xs">QR Code actif</Label>
              <Switch checked={cfg.qr.actif} onCheckedChange={(v) => majQr({ actif: v })} />
            </div>
            <div>
              <Label className="text-xs">Contenu encodé</Label>
              <Select value={cfg.qr.mode} onValueChange={(v) => majQr({ mode: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODES_QR.map((m) => (
                    <SelectItem key={m.valeur} value={m.valeur}>{m.libelle}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Côté : {cfg.qr.taille} pt</Label>
              <Slider value={[cfg.qr.taille]} min={40} max={1200} step={1} onValueChange={(v) => majQr({ taille: v[0] ?? 110 })} className="mt-3" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(cfg.qr.mode === "URL" || cfg.qr.mode === "FICHE") && (
              <div>
                <Label className="text-xs">
                  Adresse de base {cfg.qr.mode === "FICHE" ? "(le QR encode {adresse}/verification/reponse/{réf}?t=jeton)" : ""}
                </Label>
                <Input
                  value={cfg.qr.url}
                  onChange={(e) => majQr({ url: e.target.value })}
                  placeholder="https://auto-rh.entreprise.tn"
                  className="mt-1"
                />
              </div>
            )}
            {cfg.qr.mode === "TEXTE" && (
              <div>
                <Label className="text-xs">Texte à encoder</Label>
                <Textarea
                  value={cfg.qr.texte}
                  onChange={(e) => majQr({ texte: e.target.value })}
                  rows={2}
                  className="mt-1"
                />
              </div>
            )}
            {cfg.qr.mode === "IMAGE" && (
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="max-w-xs"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    lireImage((s) => { setQrNouvelle(s); setQrNomNouveau(f.name); }, f, () => toast({ title: "Image invalide (PNG/JPEG, 8 Mo max.)", variant: "destructive" }));
                  }}
                />
                {(qrNouvelle || cfg.qr.image) && (
                  <Badge variant="outline" className="text-xs">
                    {qrNouvelle ? qrNomNouveau || "nouvelle image" : cfg.qr.nom || "image enregistrée"}
                  </Badge>
                )}
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Position</Label>
              <Select value={cfg.qr.position} onValueChange={(v) => majQr({ position: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {POSITIONS.map((p) => (
                    <SelectItem key={p.valeur} value={p.valeur}>{p.libelle}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <CurseursDecal decalX={cfg.qr.decalX} decalY={cfg.qr.decalY} maj={(ch, v) => majQr({ [ch]: v } as never)} prefixe="decal" />
          <CurseurRotation rotation={cfg.qr.rotation} maj={(ch, v) => majQr({ [ch]: v } as never)} champ="rotation" />
        </div>

        {/* ---------- CACHET « SIGNATURE ÉLECTRONIQUE » ---------- */}
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-medium">Cachet « Signature électronique »</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Alimenté EN DIRECT par le certificat DÉDIÉ de cette section (aucune donnée du module de signature).
          </div>
          {/* (v0.2.147) AVERTISSEMENT : cachet activé mais alimenté par le certificat — absent */}
          {cfg.elec.actif && !cfg.certificat.present && (
            <div className="text-xs rounded-lg border border-red-300 bg-red-50 p-3 text-red-900 font-medium">
              Cachet « Signature électronique » ACTIVÉ mais AUCUN certificat importé : ce cachet est
              alimenté EN DIRECT par le certificat dédié (sujet, émetteur, empreinte, validité) —
              sans certificat, AUCUN cachet ne sera dessiné sur les réponses.
              {/* (v0.2.186) RH : le bloc certificat dédié est masqué — pas d'incitation à importer ici. */}
              {masquerCertificat
                ? " Le certificat dédié est géré par le superadministrateur — contactez-le pour l'importer ou ajuster le cachet."
                : " Importez le .p12 / .pfx dans la section « Signature électronique — certificat dédié » ci-dessus."}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-lg border p-2">
              <Label className="text-xs">Cachet actif</Label>
              <Switch checked={cfg.elec.actif} onCheckedChange={(v) => majElec({ actif: v })} />
            </div>
            <div>
              <Label className="text-xs">Forme</Label>
              <Select value={cfg.elec.forme} onValueChange={(v) => majElec({ forme: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="RECTANGLE">Cachet rectangle (encadré)</SelectItem>
                  <SelectItem value="ROND">Cachet rond (type entreprise)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Échelle : {cfg.elec.taille} %</Label>
              <Slider value={[cfg.elec.taille]} min={50} max={300} step={1} onValueChange={(v) => majElec({ taille: v[0] ?? 100 })} className="mt-3" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Position</Label>
              <Select value={cfg.elec.position} onValueChange={(v) => majElec({ position: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {POSITIONS.map((p) => (
                    <SelectItem key={p.valeur} value={p.valeur}>{p.libelle}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <CurseursDecal decalX={cfg.elec.decalX} decalY={cfg.elec.decalY} maj={(ch, v) => majElec({ [ch]: v } as never)} prefixe="decal" />
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {([
              ["affSignataire", "Signataire"],
              ["affOrganisation", "Organisation"],
              ["affEmetteur", "Émetteur"],
              ["affValidite", "Validité"],
              ["affEmpreinte", "Empreinte"],
            ] as const).map(([cle, libelle]) => (
              <label key={cle} className="flex items-center gap-2 rounded border p-2 text-xs">
                <Switch checked={cfg.elec[cle]} onCheckedChange={(v) => majElec({ [cle]: v } as never)} />
                {libelle}
              </label>
            ))}
          </div>
          <div>
            <Label className="text-xs">Ligne personnalisée du cachet</Label>
            <Input
              value={cfg.elec.texteLibre}
              onChange={(e) => majElec({ texteLibre: e.target.value })}
              placeholder="Ex. Direction des Ressources Humaines"
              className="mt-1"
            />
          </div>
        </div>

        {/* ---------- MENTION LÉGALE ---------- */}
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">Mention légale</div>
              <div className="text-xs text-muted-foreground">Texte imprimé en bas de chaque réponse PDF — {"{DATE}"} = date d&apos;apposition.</div>
            </div>
            <Switch checked={cfg.mention.actif} onCheckedChange={(v) => majMention({ actif: v })} />
          </div>
          {cfg.mention.actif && (
            <Textarea
              value={cfg.mention.texte}
              onChange={(e) => majMention({ texte: e.target.value })}
              rows={2}
            />
          )}
        </div>

        {/* ---------- E-MAIL AUTOMATIQUE ---------- */}
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Send className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-medium">Envoi par e-mail (réponse PDF en pièce jointe)</span>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">Envoi automatique de l&apos;e-mail</div>
              <div className="text-xs text-muted-foreground">
                Interrupteur maître de la RÉPONSE PDF — les e-mails de notification
                d&apos;acceptation / de refus sont TOUJOURS envoyés à l&apos;employé, au
                service RH et au manager, quelle que soit la position des interrupteurs.
                Désactivé, les notifications partent SANS le PDF signé et tamponné.
                Activé, le PDF est joint aux destinataires activés ci-dessous.
              </div>
            </div>
            <Switch checked={cfg.envoi.actif} onCheckedChange={(v) => majEnvoi({ actif: v })} />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex items-center gap-2 rounded border p-2 text-xs">
              <Switch checked={cfg.envoi.envoyerEmploye} onCheckedChange={(v) => majEnvoi({ envoyerEmploye: v })} />
              <span><b>Employé</b> (destinataire)</span>
            </label>
            <label className="flex items-center gap-2 rounded border p-2 text-xs">
              <Switch checked={cfg.envoi.envoyerRh} onCheckedChange={(v) => majEnvoi({ envoyerRh: v })} />
              <span><b>Auto-RH</b>{cfg.envoi.rhEmail ? ` (${cfg.envoi.rhEmail})` : ""}</span>
            </label>
            <label className="flex items-center gap-2 rounded border p-2 text-xs">
              <Switch checked={cfg.envoi.envoyerManager} onCheckedChange={(v) => majEnvoi({ envoyerManager: v })} />
              <span><b>Manager / N+1</b> de la demande</span>
            </label>
          </div>
          {/* (NOUVEAU v0.2.193) sémantique des 3 interrupteurs : la notification
              part TOUJOURS à tout le monde ; l&apos;interrupteur ne retire le
              destinataire QUE de la réponse PDF jointe. */}
          <p className="text-xs text-muted-foreground">
            Ces 3 interrupteurs ne retirent PLUS personne des e-mails de décision :
            un destinataire désactivé reçoit toujours la notification d&apos;acceptation
            ou de refus, mais SANS la réponse PDF en pièce jointe (le document reste
            disponible dans « Mes demandes »).
          </p>
          <div>
            <Label className="text-xs">Objet de l&apos;e-mail — variables {"{REF} {TYPE} {EMPLOYE} {STATUT} {JOURS} {HEURES} {MANAGER} {DATE}"}</Label>
            <Input
              value={cfg.envoi.objet}
              onChange={(e) => majEnvoi({ objet: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Corps personnalisé (vide = corps automatique complet)</Label>
            <Textarea
              value={cfg.envoi.corps}
              onChange={(e) => majEnvoi({ corps: e.target.value })}
              rows={3}
              className="mt-1"
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-64">
              <Label className="text-xs">Test d&apos;envoi (pièce jointe réelle)</Label>
              <Input
                type="email"
                placeholder="adresse@entreprise.tn"
                value={destTest}
                onChange={(e) => setDestTest(e.target.value)}
                className="mt-1"
              />
            </div>
            <Button variant="outline" size="sm" onClick={testerEnvoi} disabled={testChargement}>
              {testChargement ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
              Envoyer le test
            </Button>
            <Button variant="outline" size="sm" onClick={genererApercu} disabled={apercuChargement}>
              {apercuChargement ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Eye className="mr-1 h-4 w-4" />}
              Aperçu PDF (enregistre les réglages affichés)
            </Button>
          </div>
        </div>

        {/* ---------- ENREGISTRER ---------- */}
        <Separator />
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Positions, tailles, rotations, images et options e-mail sont conservées puis appliquées
            automatiquement à chaque nouvelle réponse générée. Les boutons Aperçu PDF et Envoyer le
            test enregistrent AUSSI les réglages affichés avant de générer (l&apos;aperçu reflète
            toujours les interrupteurs visibles — éléments désactivés = absents du document).
          </div>
          <Button onClick={enregistrer} disabled={enregistrement}>
            {enregistrement ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Enregistrer la configuration
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
