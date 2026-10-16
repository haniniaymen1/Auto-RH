/**
 * ============================================================================
 *  MODIFIÉ (v0.2.143) — PANNEAU « DOCUMENT D'ACCEPTATION SIGNÉ & TAMPONNÉ »
 *  UNIFIÉ AVEC LE SYSTÈME « IMPORT DE FICHIERS »
 * ============================================================================
 *  Configuration (portail d'administration, onglet « Demandes », rôles
 *  RH + SUPERADMIN) du document généré AUTOMATIQUEMENT quand une demande de
 *  congé ou d'autorisation de sortie est DÉFINITIVEMENT acceptée. La demande
 *  utilisateur (v0.2.143) : « la signature électronique, le tampon et le QR
 *  Code des documents de réponse doivent utiliser la même logique, les
 *  mêmes paramètres et le même système de déplacement interactif que ceux
 *  configurés dans la section Import de fichiers ».
 *
 *  NOUVEAUTÉS v0.2.143 :
 *   - APERÇU INTERACTIF partagé (apercu-positionnement.tsx) : la signature
 *     (paraphe), le TAMPON, le QR code et le cachet « Signature électronique »
 *     sont DÉPLAÇABLES et REDIMENSIONNABLES directement sur la feuille A4
 *     (gabarit réel du document : bande d'en-tête verte + zone de signature) ;
 *   - SÉLECTION DES IMAGES : chaque image (paraphe / tampon / QR fourni)
 *     peut être DÉDIÉE (importée ici) ou PARTAGÉE avec « Import de fichiers »
 *     (les mêmes images que les fiches de paie) ;
 *   - QR CODE : les 5 MODES des fiches (DONNÉES | URL | FICHE EN LIGNE |
 *     TEXTE | IMAGE) — le mode « Fiche en ligne » encode l'URL PUBLIQUE de
 *     vérification de la réponse ({qrUrl}/verification/reponse/…) ;
 *   - CACHET « SIGNATURE ÉLECTRONIQUE » : alimenté EN DIRECT par le
 *     certificat du module de signature (le MÊME que les fiches), formes
 *     ROND / RECTANGLE, formulaire de choix des informations affichées ;
 *   - SIGNATURE ÉLECTRONIQUE (PAdES) : source MODULE (LE MÊME certificat que
 *     l'importation des fiches — recommandé, défaut) ou DÉDIÉ (.p12 importé
 *     ici, historique) ;
 *   - décalages fins ±1500 pt + rotations 0 → 360° pour CHAQUE élément
 *     (mêmes bornes que les fiches) — conservés et appliqués automatiquement
 *     à chaque nouvelle réponse générée.
 *
 *  Conservés (Task 179) : certificat dédié, mention légale, paramètres
 *  d'envoi, aperçu PDF réel, test d'envoi. L'IT n'a PAS accès (403).
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
interface ConfigDocSigne {
  docActif: boolean;
  certificat: {
    present: boolean;
    nom: string;
    empreinte: string;
    importeLe: string | null;
    hasCertPassword: boolean;
    signataire: string;
    fonction: string;
    source: string;
  };
  moduleCert: {
    actif: boolean;
    signerReponses: boolean;
    present: boolean;
    sujet: string;
    emetteur: string;
    valideAu: string | null;
    empreinte: string;
    mode: string;
  };
  paraphe: {
    presente: boolean;
    image: string;
    nom: string;
    position: string;
    taille: number;
    decalX: number;
    decalY: number;
    rotation: number;
    source: string;
  };
  tampon: {
    presente: boolean;
    image: string;
    nom: string;
    position: string;
    taille: number;
    opacite: number;
    decalX: number;
    decalY: number;
    rotation: number;
    source: string;
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
    source: string;
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
  imagesImport: {
    sigImage: string;
    sigImageNom: string;
    qrImage: string;
    qrImageNom: string;
  };
  mention: string;
  envoi: {
    actif: boolean;
    objet: string;
    corps: string;
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
const MODES_QR = [
  { valeur: "DONNEES", libelle: "Données du document (réf, employé, empreinte)" },
  { valeur: "URL", libelle: "URL de vérification (adresse + paramètres)" },
  { valeur: "FICHE", libelle: "Fiche en ligne (page publique de vérification)" },
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

export function DocSignerPanel() {
  const { toast } = useToast();
  const [chargement, setChargement] = useState(true);
  const [enregistrement, setEnregistrement] = useState(false);
  const [cfg, setCfg] = useState<ConfigDocSigne | null>(null);

  // état local des images (non enregistrées tant que « Enregistrer » n'est pas cliqué)
  const [parapheNouvelle, setParapheNouvelle] = useState<string | null>(null);
  const [parapheNomNouveau, setParapheNomNouveau] = useState("");
  const [tamponNouveau, setTamponNouveau] = useState<string | null>(null);
  const [tamponNomNouveau, setTamponNomNouveau] = useState("");
  const [qrNouvelle, setQrNouvelle] = useState<string | null>(null);
  const [qrNomNouveau, setQrNomNouveau] = useState("");
  // (v0.2.143) aperçu interactif : élément sélectionné pour les coordonnées
  const [apercuChargement, setApercuChargement] = useState(false);
  // certificat dédié (source DEDIE) — états conservés d'un rendu à l'autre
  const [certFichier, setCertFichier] = useState<File | null>(null);
  const [certMdp, setCertMdp] = useState("");
  const [certAction, setCertAction] = useState(false);
  // test d'envoi (Task 179 conservé)
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
      const res = await fetch("/api/doc-signer-config", { cache: "no-store" });
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
  function maj<K extends keyof ConfigDocSigne>(cle: K, valeur: ConfigDocSigne[K]) {
    setCfg((c) => (c ? { ...c, [cle]: valeur } : c));
  }
  function majParaphe(patch: Partial<ConfigDocSigne["paraphe"]>) {
    setCfg((c) => (c ? { ...c, paraphe: { ...c.paraphe, ...patch } } : c));
  }
  function majTampon(patch: Partial<ConfigDocSigne["tampon"]>) {
    setCfg((c) => (c ? { ...c, tampon: { ...c.tampon, ...patch } } : c));
  }
  function majQr(patch: Partial<ConfigDocSigne["qr"]>) {
    setCfg((c) => (c ? { ...c, qr: { ...c.qr, ...patch } } : c));
  }
  function majElec(patch: Partial<ConfigDocSigne["elec"]>) {
    setCfg((c) => (c ? { ...c, elec: { ...c.elec, ...patch } } : c));
  }
  function majCertificat(patch: Partial<ConfigDocSigne["certificat"]>) {
    setCfg((c) => (c ? { ...c, certificat: { ...c.certificat, ...patch } } : c));
  }
  function majEnvoi(patch: Partial<ConfigDocSigne["envoi"]>) {
    setCfg((c) => (c ? { ...c, envoi: { ...c.envoi, ...patch } } : c));
  }

  /* ---------- Images RÉSOLUES selon les sources (aperçu = rendu réel) ---------- */
  const imageParapheAffichee =
    cfg.paraphe.source === "IMPORT" ? cfg.imagesImport.sigImage : parapheNouvelle != null ? parapheNouvelle : cfg.paraphe.image;
  const imageTamponAffichee =
    cfg.tampon.source === "IMPORT" ? cfg.imagesImport.sigImage : tamponNouveau != null ? tamponNouveau : cfg.tampon.image;
  const imageQrFourniAffichee =
    cfg.qr.source === "IMPORT" ? cfg.imagesImport.qrImage : qrNouvelle != null ? qrNouvelle : cfg.qr.image;

  /* ---------- Enregistrement (PUT) ---------- */
  async function enregistrer() {
    if (!cfg) return;
    setEnregistrement(true);
    try {
      const corps: Record<string, unknown> = {
        docActif: cfg.docActif,
        docEmailActif: cfg.envoi.actif,
        docEnvoyerRh: cfg.envoi.envoyerRh,
        docEnvoyerManager: cfg.envoi.envoyerManager,
        docEmailObjet: cfg.envoi.objet,
        docEmailCorps: cfg.envoi.corps,
        docMention: cfg.mention,
        certSignataire: cfg.certificat.signataire,
        certFonction: cfg.certificat.fonction,
        docCertSource: cfg.certificat.source,
        // paraphe
        docSigPosition: cfg.paraphe.position,
        docSigTaille: cfg.paraphe.taille,
        docSigDecalX: cfg.paraphe.decalX,
        docSigDecalY: cfg.paraphe.decalY,
        docSigRotation: cfg.paraphe.rotation,
        docSigSource: cfg.paraphe.source,
        // tampon
        tamponPosition: cfg.tampon.position,
        tamponTaille: cfg.tampon.taille,
        tamponOpacite: cfg.tampon.opacite,
        tamponDecalX: cfg.tampon.decalX,
        tamponDecalY: cfg.tampon.decalY,
        tamponRotation: cfg.tampon.rotation,
        tamponSource: cfg.tampon.source,
        // QR
        docQrActif: cfg.qr.actif,
        docQrMode: cfg.qr.mode,
        docQrUrl: cfg.qr.url,
        docQrTexte: cfg.qr.texte,
        docQrPosition: cfg.qr.position,
        docQrTaille: cfg.qr.taille,
        docQrDecalX: cfg.qr.decalX,
        docQrDecalY: cfg.qr.decalY,
        docQrRotation: cfg.qr.rotation,
        docQrSource: cfg.qr.source,
        // cachet électronique
        docElecActif: cfg.elec.actif,
        docElecPosition: cfg.elec.position,
        docElecDecalX: cfg.elec.decalX,
        docElecDecalY: cfg.elec.decalY,
        docElecTaille: cfg.elec.taille,
        docElecForme: cfg.elec.forme,
        docElecAffSignataire: cfg.elec.affSignataire,
        docElecAffOrganisation: cfg.elec.affOrganisation,
        docElecAffEmetteur: cfg.elec.affEmetteur,
        docElecAffValidite: cfg.elec.affValidite,
        docElecAffEmpreinte: cfg.elec.affEmpreinte,
        docElecTexteLibre: cfg.elec.texteLibre,
      };
      if (parapheNouvelle != null) {
        corps.docSigImage = parapheNouvelle;
        corps.docSigImageNom = parapheNomNouveau;
      }
      if (tamponNouveau != null) {
        corps.tamponImage = tamponNouveau;
        corps.tamponImageNom = tamponNomNouveau;
      }
      if (qrNouvelle != null) {
        corps.docQrImage = qrNouvelle;
        corps.docQrImageNom = qrNomNouveau;
      }
      const res = await fetch("/api/doc-signer-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setParapheNouvelle(null);
        setTamponNouveau(null);
        setQrNouvelle(null);
        toast({ title: "Configuration enregistrée", description: "Les paramètres seront appliqués automatiquement aux prochaines réponses générées." });
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

  /* ---------- Import du certificat DÉDIÉ (.p12/.pfx — source DÉDIÉ) ---------- */

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
      const res = await fetch("/api/doc-signer-config", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "Certificat importé", description: d.diagnostic?.message });
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
      const res = await fetch("/api/doc-signer-config", { method: "POST", body: fd });
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
      const res = await fetch("/api/doc-signer-config", { method: "POST", body: fd });
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

  /* ---------- Aperçu (PDF réel) ---------- */

  async function testerEnvoi() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destTest)) {
      toast({ title: "Adresse de test invalide", variant: "destructive" });
      return;
    }
    setTestChargement(true);
    try {
      const fd = new FormData();
      fd.append("action", "test-envoi");
      fd.append("dest", destTest);
      const res = await fetch("/api/doc-signer-config", { method: "POST", body: fd });
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

  async function genererApercu() {
    setApercuChargement(true);
    try {
      const fd = new FormData();
      fd.append("action", "apercu");
      const res = await fetch("/api/doc-signer-config", { method: "POST", body: fd });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        toast({ title: "Aperçu généré", description: "Le PDF (tamponné et signé selon la configuration) s'ouvre dans un nouvel onglet." });
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

  /* ---------- Configuration de l'aperçu interactif (= rendu moteur) ---------- */
  const cfgApercu: ConfigApercu = {
    sigActif: Boolean(imageParapheAffichee),
    sigTexte: "",
    sigPosition: cfg.paraphe.position,
    sigTaille: cfg.paraphe.taille,
    sigOpacite: 0.9,
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
    mentionActif: false,
    tamponActif: true,
    tamponPosition: cfg.tampon.position,
    tamponTaille: cfg.tampon.taille,
    tamponDecalX: cfg.tampon.decalX,
    tamponDecalY: cfg.tampon.decalY,
    basDecal: 42,
    varianteApercu: "document-demande",
  };

  const moduleOk = cfg.moduleCert.actif && cfg.moduleCert.signerReponses && cfg.moduleCert.present;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileSignature className="h-5 w-5 text-emerald-600" />
          Document de réponse signé &amp; tamponné (congé / autorisation)
        </CardTitle>
        <CardDescription>
          Même système que « Import de fichiers » : signature électronique, tampon, QR Code et positionnement
          interactif — la configuration est conservée puis appliquée automatiquement à chaque réponse générée.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ---------- Interrupteur général ---------- */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <div className="text-sm font-medium">Génération automatique du document</div>
            <div className="text-xs text-muted-foreground">
              À chaque acceptation finale d&apos;un congé ou d&apos;une autorisation.
            </div>
          </div>
          <Switch checked={cfg.docActif} onCheckedChange={(v) => maj("docActif", v)} />
        </div>

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
              // mapping CleDecal (sig/qr/tampon/elec) → clés locales (decalX/decalY)
              const suffixe = cle.endsWith("DecalX") ? "decalX" : cle.endsWith("DecalY") ? "decalY" : null;
              if (!suffixe) return;
              if (cle.startsWith("sig")) majParaphe({ [suffixe]: valeur } as never);
              else if (cle.startsWith("tampon")) majTampon({ [suffixe]: valeur } as never);
              else if (cle.startsWith("qr")) majQr({ [suffixe]: valeur } as never);
              else if (cle.startsWith("elec")) majElec({ [suffixe]: valeur } as never);
            }}
            note="Glissez chaque élément n'importe où sur la feuille — la position est conservée puis appliquée automatiquement au document généré. Ajustements fins ci-dessous (X/Y/rotation)."
            libelleFiche="A4 — document de réponse"
          />
        </div>

        {/* ---------- SIGNATURE ÉLECTRONIQUE (PAdES) ---------- */}
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-medium">Signature électronique (certificat)</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label
              className={`cursor-pointer rounded-lg border p-3 text-sm ${cfg.certificat.source === "MODULE" ? "border-emerald-500 bg-emerald-50" : ""}`}
              onClick={() => majCertificat({ source: "MODULE" })}
            >
              <div className="font-medium">Module de signature (recommandé)</div>
              <div className="text-xs text-muted-foreground">
                LE MÊME certificat que l&apos;importation des fiches de paie — une seule configuration.
              </div>
            </label>
            <label
              className={`cursor-pointer rounded-lg border p-3 text-sm ${cfg.certificat.source === "DEDIE" ? "border-emerald-500 bg-emerald-50" : ""}`}
              onClick={() => majCertificat({ source: "DEDIE" })}
            >
              <div className="font-medium">Certificat dédié (.p12 / .pfx)</div>
              <div className="text-xs text-muted-foreground">
                Certificat importé uniquement pour les documents de réponse.
              </div>
            </label>
          </div>
          {cfg.certificat.source === "MODULE" ? (
            <div className={`rounded-lg border p-3 text-sm ${moduleOk ? "border-emerald-300 bg-emerald-50/60" : "border-amber-300 bg-amber-50/60"}`}>
              {moduleOk ? (
                <>
                  <div className="flex items-center gap-2 font-medium text-emerald-800">
                    <BadgeCheck className="h-4 w-4" /> Certificat du module actif — le document sera signé
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Titulaire : {cfg.moduleCert.sujet || "—"} · Émetteur : {cfg.moduleCert.emetteur || "—"}
                    {cfg.moduleCert.valideAu ? ` · Valide jusqu'au ${new Date(cfg.moduleCert.valideAu).toLocaleDateString("fr-FR")}` : ""}
                  </div>
                </>
              ) : (
                <>
                  <div className="font-medium text-amber-800">Module de signature inactif ou sans certificat</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Onglet Paramètres → « API de certification &amp; signature » : activez le module, importez le
                    certificat et laissez le périmètre « documents des demandes/réponses » coché. Repli : le
                    certificat dédié (s'il a été configuré) reste utilisé.
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border p-3">
              {cfg.certificat.present ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div>
                    <div className="font-medium">{cfg.certificat.nom}</div>
                    <div className="text-xs text-muted-foreground">
                      Importé le {cfg.certificat.importeLe ? new Date(cfg.certificat.importeLe).toLocaleDateString("fr-FR") : "—"}
                      {cfg.certificat.hasCertPassword ? " · mot de passe enregistré" : " · SANS mot de passe"}
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
                <div className="text-xs text-muted-foreground">Aucun certificat dédié importé.</div>
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
            </div>
          )}
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

        {/* ---------- SIGNATURE IMAGE (paraphe) ---------- */}
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <FileSignature className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-medium">Signature sous forme d&apos;image (paraphe)</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Image à utiliser</Label>
              <Select value={cfg.paraphe.source} onValueChange={(v) => majParaphe({ source: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DEDIEE">Image dédiée (importée ici)</SelectItem>
                  <SelectItem value="IMPORT">
                    Image « Import de fichiers »{cfg.imagesImport.sigImageNom ? ` — ${cfg.imagesImport.sigImageNom}` : cfg.imagesImport.sigImage ? "" : " (aucune)"}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
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
          </div>
          <CurseursDecal decalX={cfg.paraphe.decalX} decalY={cfg.paraphe.decalY} maj={(ch, v) => majParaphe({ [ch]: v } as never)} prefixe="decal" />
          <CurseurRotation rotation={cfg.paraphe.rotation} maj={(ch, v) => majParaphe({ [ch]: v } as never)} champ="rotation" />
          {cfg.paraphe.source === "DEDIEE" && (
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
          )}
        </div>

        {/* ---------- TAMPON (cachet image) ---------- */}
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Stamp className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-medium">Tampon (cachet image)</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Image à utiliser</Label>
              <Select value={cfg.tampon.source} onValueChange={(v) => majTampon({ source: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DEDIEE">Image dédiée (importée ici)</SelectItem>
                  <SelectItem value="IMPORT">
                    Image « Import de fichiers »{cfg.imagesImport.sigImageNom ? ` — ${cfg.imagesImport.sigImageNom}` : cfg.imagesImport.sigImage ? "" : " (aucune)"}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
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
              <Label className="text-xs">Largeur : {cfg.tampon.taille} pt · opacité {Math.round(cfg.tampon.opacite * 100)} %</Label>
              <Slider value={[cfg.tampon.taille]} min={40} max={1200} step={1} onValueChange={(v) => majTampon({ taille: v[0] ?? 140 })} className="mt-3" />
              <Slider value={[Math.round(cfg.tampon.opacite * 100)]} min={30} max={100} step={1} onValueChange={(v) => majTampon({ opacite: (v[0] ?? 85) / 100 })} className="mt-1" />
            </div>
          </div>
          <CurseursDecal decalX={cfg.tampon.decalX} decalY={cfg.tampon.decalY} maj={(ch, v) => majTampon({ [ch]: v } as never)} prefixe="decal" />
          <CurseurRotation rotation={cfg.tampon.rotation} maj={(ch, v) => majTampon({ [ch]: v } as never)} champ="rotation" />
          {cfg.tampon.source === "DEDIEE" && (
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
          )}
        </div>

        {/* ---------- QR CODE (mêmes modes que les fiches) ---------- */}
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <QrCode className="h-4 w-4 text-sky-600" />
              <span className="text-sm font-medium">QR Code</span>
            </div>
            <Switch checked={cfg.qr.actif} onCheckedChange={(v) => majQr({ actif: v })} />
          </div>
          {cfg.qr.actif && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">Mode (identique aux fiches)</Label>
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
                <div>
                  <Label className="text-xs">Côté : {cfg.qr.taille} pt</Label>
                  <Slider value={[cfg.qr.taille]} min={40} max={1200} step={1} onValueChange={(v) => majQr({ taille: v[0] ?? 110 })} className="mt-3" />
                </div>
              </div>
              {(cfg.qr.mode === "URL" || cfg.qr.mode === "FICHE") && (
                <div>
                  <Label className="text-xs">
                    Adresse de base du site d&apos;administration{cfg.qr.mode === "FICHE" ? " — le QR encode la page publique de vérification de la réponse" : ""}
                  </Label>
                  <Input
                    value={cfg.qr.url}
                    onChange={(e) => majQr({ url: e.target.value })}
                    placeholder="http://192.168.1.20:4000"
                    className="mt-1"
                  />
                </div>
              )}
              {cfg.qr.mode === "TEXTE" && (
                <div>
                  <Label className="text-xs">Contenu libre du QR</Label>
                  <Input value={cfg.qr.texte} onChange={(e) => majQr({ texte: e.target.value })} className="mt-1" />
                </div>
              )}
              {cfg.qr.mode === "IMAGE" && (
                <div className="space-y-2">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs">Image à utiliser</Label>
                      <Select value={cfg.qr.source} onValueChange={(v) => majQr({ source: v })}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="DEDIEE">Image dédiée (importée ici)</SelectItem>
                          <SelectItem value="IMPORT">Image « Import de fichiers »</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {cfg.qr.source === "DEDIEE" && (
                      <div className="flex items-center gap-2">
                        <Input
                          type="file"
                          accept="image/png,image/jpeg"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            lireImage((s) => { setQrNouvelle(s); setQrNomNouveau(f.name); }, f, () => toast({ title: "Image invalide (PNG/JPEG, 8 Mo max.)", variant: "destructive" }));
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
              <CurseursDecal decalX={cfg.qr.decalX} decalY={cfg.qr.decalY} maj={(ch, v) => majQr({ [ch]: v } as never)} prefixe="decal" />
              <CurseurRotation rotation={cfg.qr.rotation} maj={(ch, v) => majQr({ [ch]: v } as never)} champ="rotation" />
            </>
          )}
        </div>

        {/* ---------- CACHET « SIGNATURE ÉLECTRONIQUE » ---------- */}
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-violet-600" />
              <span className="text-sm font-medium">Cachet « Signature électronique »</span>
            </div>
            <Switch checked={cfg.elec.actif} onCheckedChange={(v) => majElec({ actif: v })} />
          </div>
          <div className="text-xs text-muted-foreground">
            Alimenté EN DIRECT par le certificat du module de signature (le même que les fiches) — il n&apos;est
            apposé que si le document est réellement signé (garantie cachet ⇒ signature).
          </div>
          {cfg.elec.actif && (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                <div>
                  <Label className="text-xs">Forme</Label>
                  <Select value={cfg.elec.forme} onValueChange={(v) => majElec({ forme: v })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RECTANGLE">Rectangle (double cadre)</SelectItem>
                      <SelectItem value="ROND">Rond (cachet d&apos;entreprise)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
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
                <div className="sm:col-span-2">
                  <Label className="text-xs">Échelle : {cfg.elec.taille} %</Label>
                  <Slider value={[cfg.elec.taille]} min={50} max={300} step={1} onValueChange={(v) => majElec({ taille: v[0] ?? 100 })} className="mt-3" />
                </div>
              </div>
              <CurseursDecal decalX={cfg.elec.decalX} decalY={cfg.elec.decalY} maj={(ch, v) => majElec({ [ch]: v } as never)} prefixe="decal" />
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {([
                  ["affSignataire", "Signataire (CN)"],
                  ["affOrganisation", "Organisation (O)"],
                  ["affEmetteur", "Émetteur du certificat"],
                  ["affValidite", "Valide jusqu'au…"],
                  ["affEmpreinte", "Empreinte SHA-256"],
                ] as const).map(([cle, libelle]) => (
                  <label key={cle} className="flex items-center gap-2 rounded border p-2 text-xs">
                    <Switch checked={cfg.elec[cle]} onCheckedChange={(v) => majElec({ [cle]: v } as never)} />
                    {libelle}
                  </label>
                ))}
              </div>
              <div>
                <Label className="text-xs">Ligne personnalisée (≤ 120 caractères)</Label>
                <Input value={cfg.elec.texteLibre} onChange={(e) => majElec({ texteLibre: e.target.value })} maxLength={120} className="mt-1" />
              </div>
            </>
          )}
        </div>

        {/* ---------- MENTION LÉGALE ---------- */}
        <Separator />
        <div>
          <Label className="text-xs">Mention légale ({"{DATE}"} remplacée à la génération)</Label>
          <Textarea value={cfg.mention} onChange={(e) => maj("mention", e.target.value)} rows={2} className="mt-1" />
        </div>

        {/* ---------- ENVOI AUTOMATIQUE ---------- */}
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">E-mail automatique (document joint)</span>
            <Switch checked={cfg.envoi.actif} onCheckedChange={(v) => majEnvoi({ actif: v })} />
          </div>
          {cfg.envoi.actif && (
            <>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={cfg.envoi.envoyerRh} onCheckedChange={(v) => majEnvoi({ envoyerRh: v })} />
                  Copie au service RH {cfg.envoi.rhEmail ? `(${cfg.envoi.rhEmail})` : "(adresse non configurée)"}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={cfg.envoi.envoyerManager} onCheckedChange={(v) => majEnvoi({ envoyerManager: v })} />
                  Copie au manager de la demande
                </label>
              </div>
              <div>
                <Label className="text-xs">Objet (variables {"{REF} {TYPE} {EMPLOYE} {CIN} {STATUT} {JOURS} {HEURES} {MANAGER} {DATE}"})</Label>
                <Input value={cfg.envoi.objet} onChange={(e) => majEnvoi({ objet: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Corps personnalisé (vide = corps par défaut)</Label>
                <Textarea value={cfg.envoi.corps} onChange={(e) => majEnvoi({ corps: e.target.value })} rows={4} className="mt-1" />
              </div>
              <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3">
                <div className="flex-1 min-w-52">
                  <Label className="text-xs">Tester l&apos;envoi réel à une adresse</Label>
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
                  Tester l&apos;envoi
                </Button>
              </div>
            </>
          )}
        </div>

        {/* ---------- ACTIONS ---------- */}
        <Separator />
        <div className="flex flex-wrap gap-2">
          <Button onClick={enregistrer} disabled={enregistrement}>
            {enregistrement ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Enregistrer
          </Button>
          <Button variant="outline" onClick={genererApercu} disabled={apercuChargement}>
            {apercuChargement ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Eye className="mr-1 h-4 w-4" />}
            Générer un aperçu (PDF réel)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
