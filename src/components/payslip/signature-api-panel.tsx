"use client";

/**
 * ============================================================================
 *  NOUVEAU (Task 224, MODIFIÉ Task 243) — PANNEAU « API DE CERTIFICATION &
 *  SIGNATURE ÉLECTRONIQUE » (onglet Paramètres, rôle SUPERADMIN UNIQUEMENT —
 *  le panneau est retiré des paramètres du rôle IT en Task 243)
 * ============================================================================
 *
 *  Configuration complète du module de signature électronique des documents :
 *
 *    - INTERRUPTEUR GÉNÉRAL + périmètre (fiches de paie et/ou
 *      Demandes/Réponses) + environnement TEST / PRODUCTION ;
 *    - MODE LOCALE : signature PAdES réalisée par le serveur avec le
 *      CERTIFICAT importé (coffre .p12/.pfx, ou certificat .pem/.cer/.crt/.der
 *      + clé privée .pem/.key/.der — association vérifiée à l'import) ;
 *    - MODE API_EXTERNE : connexion à un service REST de certification/
 *      signature (URL par environnement, Bearer / API-Key / Basic, secret
 *      JAMAIS renvoyé, champ de réponse JSON configurable, timeout) ;
 *    - TEST de la configuration (signature d'un document témoin + vérification
 *      pour LOCALE ; appel réel de l'API pour API_EXTERNE) ;
 *    - SUIVI « Fiches de paie & portail employé » (compteurs + rattrapage,
 *      v0.2.124).
 *
 *  MODIFIÉ (Task 243, v0.2.126) : la section « Documents signés conservés » (registre
 *  des copies signées : liste, téléchargement, re-vérification, suppression)
 *  est SUPPRIMÉE de ce panneau pour TOUS les rôles — les copies signées
 *  restent bien conservées côté serveur et servies au portail employé, seul
 *  l'affichage du registre disparaît de l'interface.
 *
 *  SÉCURITÉ : le secret API et les mots de passe (coffre, clé) sont chiffrés
 *  en base et ne QUITTENT JAMAIS le serveur — les champs restent vides et
 *  l'interface n'affiche que des booléens « enregistré ». Les laisser vides =
 *  conserver les valeurs actuelles.
 * ============================================================================
 */
import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  BadgeCheck,
  Award,
  FileSignature,
  Loader2,
  Plug,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  IdCard,
} from "lucide-react";

interface ConfigSignatureApi {
  actif: boolean;
  mode: string;
  environnement: string;
  signerFiches: boolean;
  signerReponses: boolean;
  raison: string;
  emplacement: string;
  contact: string;
  certFormat: string;
  certFichierNom: string;
  certSujet: string;
  certEmetteur: string;
  certSerie: string;
  certValideDu: string | null;
  certValideAu: string | null;
  certEmpreinte: string;
  certImportLe: string | null;
  certCleFichierNom: string;
  certCleType: string;
  certCleImportLe: string | null;
  apiUrlTest: string;
  apiUrlProd: string;
  apiAuthType: string;
  apiAuthEntete: string;
  apiIdentifiant: string;
  apiEntetesSup: string;
  apiChampReponse: string;
  apiTimeoutMs: number;
  apiDernierTestLe: string | null;
  apiDernierTestOk: boolean;
  apiDernierTestMessage: string;
  verifierAuto: boolean;
  certMotDePasseEnregistre: boolean;
  certCleMotDePasseEnregistre: boolean;
  apiSecretEnregistre: boolean;
  apiUrlActive: string;
}

// NOUVEAU (v0.2.124) : suivi des fiches de paie vis-à-vis du portail employé
interface StatsFiches {
  totalFichesPdf: number;
  fichesSignees: number;
  fichesRestantes: number;
  moduleActif: boolean;
  signerFiches: boolean;
  certificatCharge: boolean;
}

function dateFr(v: string | null): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return v;
  }
}

export function SignatureApiPanel() {
  const { toast } = useToast();
  const [chargement, setChargement] = useState(true);
  const [enregistrement, setEnregistrement] = useState(false);
  const [testEnCours, setTestEnCours] = useState(false);
  const [importCertEnCours, setImportCertEnCours] = useState(false);
  const [cfg, setCfg] = useState<ConfigSignatureApi | null>(null);
  // NOUVEAU (v0.2.124) : compteurs fiches de paie ↔ portail + rattrapage
  const [statsFiches, setStatsFiches] = useState<StatsFiches | null>(null);
  const [rattrapageEnCours, setRattrapageEnCours] = useState(false);

  // ---- Champs de formulaire locaux (secrets vides = conservés) ----
  const [fichierCert, setFichierCert] = useState<File | null>(null);
  const [motDePasseCert, setMotDePasseCert] = useState("");
  const [fichierCle, setFichierCle] = useState<File | null>(null);
  const [motDePasseCle, setMotDePasseCle] = useState("");
  const [apiSecret, setApiSecret] = useState("");

  const chargerFiches = useCallback(async () => {
    try {
      const rf = await fetch("/api/signature-api/rattrapage", { cache: "no-store" });
      if (rf.ok) {
        const jf = await rf.json();
        setStatsFiches({
          totalFichesPdf: Number(jf.totalFichesPdf) || 0,
          fichesSignees: Number(jf.fichesSignees) || 0,
          fichesRestantes: Number(jf.fichesRestantes) || 0,
          moduleActif: Boolean(jf.moduleActif),
          signerFiches: Boolean(jf.signerFiches),
          certificatCharge: Boolean(jf.certificatCharge),
        });
      }
    } catch {
      // indicateur facultatif : jamais bloquant
    }
  }, []);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const r = await fetch("/api/signature-api/config", { cache: "no-store" });
      const j = await r.json();
      if (j.config && Object.keys(j.config).length) setCfg(j.config);
      // MODIFIÉ (Task 243) : le registre « Documents signés conservés » n'est
      // plus affiché — plus AUCUN appel à /api/signature-api/documents ici.
    } catch {
      toast({ title: "Lecture impossible", description: "La configuration de signature n'a pas pu être chargée.", variant: "destructive" });
    } finally {
      setChargement(false);
    }
    await chargerFiches();
  }, [toast, chargerFiches]);

  useEffect(() => {
    charger();
  }, [charger]);

  const maj = (champ: keyof ConfigSignatureApi, valeur: unknown) => {
    setCfg((c) => (c ? { ...c, [champ]: valeur } : c));
  };

  const enregistrer = async () => {
    if (!cfg) return;
    setEnregistrement(true);
    try {
      const corps: Record<string, unknown> = {
        actif: cfg.actif,
        mode: cfg.mode,
        environnement: cfg.environnement,
        signerFiches: cfg.signerFiches,
        signerReponses: cfg.signerReponses,
        raison: cfg.raison,
        emplacement: cfg.emplacement,
        contact: cfg.contact,
        apiUrlTest: cfg.apiUrlTest,
        apiUrlProd: cfg.apiUrlProd,
        apiAuthType: cfg.apiAuthType,
        apiAuthEntete: cfg.apiAuthEntete,
        apiIdentifiant: cfg.apiIdentifiant,
        apiEntetesSup: cfg.apiEntetesSup,
        apiChampReponse: cfg.apiChampReponse,
        apiTimeoutMs: cfg.apiTimeoutMs,
        verifierAuto: cfg.verifierAuto,
      };
      // Secrets : envoyés SEULEMENT s'ils sont saisis (vide = conserver)
      if (apiSecret) corps.apiSecret = apiSecret;
      const r = await fetch("/api/signature-api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erreur");
      setApiSecret("");
      // (NOUVEAU v0.2.122) le message du serveur est affiché tel quel :
      // lors de l'activation du module, il annonce le rattrapage automatique
      // (signature de TOUTES les fiches déjà importées, en arrière-plan).
      toast({ title: "Configuration enregistrée", description: String(j.message || "Le module de signature électronique est à jour.") });
      await charger();
    } catch (e) {
      toast({ title: "Échec de l'enregistrement", description: String((e as Error).message), variant: "destructive" });
    } finally {
      setEnregistrement(false);
    }
  };

  const importerCertificat = async () => {
    if (!fichierCert) {
      toast({ title: "Aucun fichier", description: "Déposez le certificat (.p12/.pfx/.pem/.cer/.crt/.der) avant d'enregistrer.", variant: "destructive" });
      return;
    }
    setImportCertEnCours(true);
    try {
      const form = new FormData();
      form.append("fichier", fichierCert);
      if (motDePasseCert) form.append("motDePasse", motDePasseCert);
      if (fichierCle) form.append("fichierCle", fichierCle);
      if (motDePasseCle) form.append("motDePasseCle", motDePasseCle);
      const r = await fetch("/api/signature-api/certificat", { method: "POST", body: form });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erreur");
      toast({ title: "Certificat importé", description: j.message });
      setFichierCert(null);
      setMotDePasseCert("");
      setFichierCle(null);
      setMotDePasseCle("");
      await charger();
    } catch (e) {
      toast({ title: "Import refusé", description: String((e as Error).message), variant: "destructive" });
    } finally {
      setImportCertEnCours(false);
    }
  };

  const retirerCertificat = async () => {
    try {
      const r = await fetch("/api/signature-api/certificat", { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erreur");
      toast({ title: "Certificat retiré", description: j.message });
      await charger();
    } catch (e) {
      toast({ title: "Échec", description: String((e as Error).message), variant: "destructive" });
    }
  };

  const tester = async () => {
    setTestEnCours(true);
    try {
      const r = await fetch("/api/signature-api/test", { method: "POST" });
      const j = await r.json();
      toast({
        title: j.ok ? "Test réussi" : "Test échoué",
        description: j.message,
        variant: j.ok ? "default" : "destructive",
      });
      await charger();
    } catch (e) {
      toast({ title: "Test impossible", description: String((e as Error).message), variant: "destructive" });
    } finally {
      setTestEnCours(false);
    }
  };

  // NOUVEAU (v0.2.124) — RATTRAPAGE MANUEL : lance la signature des fiches
  // de paie restées sans copie signée (importées avant l'activation, import
  // en échec non bloquant, certificat arrivé après les fiches…). Le résultat
  // arrive en arrière-plan : les compteurs sont rechargés automatiquement
  // (3 s puis 8 s) pour voir la progression sans manipulation.
  const rattraper = async () => {
    setRattrapageEnCours(true);
    try {
      const r = await fetch("/api/signature-api/rattrapage", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erreur");
      toast({ title: "Rattrapage lancé", description: String(j.message || "") });
      setTimeout(chargerFiches, 3000);
      setTimeout(chargerFiches, 8000);
    } catch (e) {
      toast({ title: "Rattrapage impossible", description: String((e as Error).message), variant: "destructive" });
    } finally {
      setRattrapageEnCours(false);
    }
  };

  if (chargement) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement de la configuration de signature…
        </CardContent>
      </Card>
    );
  }
  if (!cfg) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Configuration indisponible (réservée au superadministrateur).
        </CardContent>
      </Card>
    );
  }

  const certificatPresent = Boolean(cfg.certFichierNom);

  return (
    <Card className="border-violet-200">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-violet-600" />
            <CardTitle className="text-base">API de certification &amp; signature électronique</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={cfg.environnement === "PRODUCTION" ? "destructive" : "secondary"}>
              {cfg.environnement === "PRODUCTION" ? "PRODUCTION" : "TEST"}
            </Badge>
            <div className="flex items-center gap-2">
              <Switch checked={cfg.actif} onCheckedChange={(v) => maj("actif", v)} id="sigapi-actif" />
              <Label htmlFor="sigapi-actif" className="text-sm">
                {cfg.actif ? "Signature ACTIVE" : "Signature inactive"}
              </Label>
            </div>
          </div>
        </div>
        <CardDescription>
          Signature cryptographique PAdES des documents (fiches de paie, Demandes/Réponses) — par le
          certificat du serveur ou via une API de certification externe. Les documents signés sont
          conservés, vérifiés et traçables. (Task 244) Les fiches de paie DÉJÀ signées conservent
          DÉFINITIVEMENT leur signature d&apos;origine : remplacer le certificat ou la configuration
          ici ne modifie ni ne re-signe jamais les fiches déjà signées (portails Employé et
          Administration, vérification QR) — seule la signature des nouvelles fiches en tient compte.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ---- Périmètre + environnement ---- */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex items-center gap-2 rounded-md border p-3">
            <Switch checked={cfg.signerFiches} onCheckedChange={(v) => maj("signerFiches", v)} id="sigapi-fiches" />
            <div>
              <Label htmlFor="sigapi-fiches" className="text-sm font-medium">Fiches de paie</Label>
              <p className="text-xs text-muted-foreground">Signées au téléchargement (cache par contenu)</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-md border p-3">
            <Switch checked={cfg.signerReponses} onCheckedChange={(v) => maj("signerReponses", v)} id="sigapi-reponses" />
            <div>
              <Label htmlFor="sigapi-reponses" className="text-sm font-medium">Demandes / Réponses</Label>
              <p className="text-xs text-muted-foreground">Signées avant envoi à l&apos;employé</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-md border p-3">
            <Switch checked={cfg.verifierAuto} onCheckedChange={(v) => maj("verifierAuto", v)} id="sigapi-verif" />
            <div>
              <Label htmlFor="sigapi-verif" className="text-sm font-medium">Vérification automatique</Label>
              <p className="text-xs text-muted-foreground">Intégrité contrôlée après chaque signature</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Environnement :</span>
          {["TEST", "PRODUCTION"].map((env) => (
            <Button
              key={env}
              type="button"
              size="sm"
              variant={cfg.environnement === env ? "default" : "outline"}
              onClick={() => maj("environnement", env)}
            >
              {env === "TEST" ? "Test (bac à sable)" : "Production"}
            </Button>
          ))}
          <span className="ml-2 text-sm font-medium">Mode :</span>
          {[
            { id: "LOCALE", label: "Certificat du serveur (PAdES local)" },
            { id: "API_EXTERNE", label: "API externe de signature" },
          ].map((m) => (
            <Button
              key={m.id}
              type="button"
              size="sm"
              variant={cfg.mode === m.id ? "default" : "outline"}
              onClick={() => maj("mode", m.id)}
            >
              {m.label}
            </Button>
          ))}
        </div>

        {/* ---- Raisons PAdES ---- */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="sigapi-raison">Raison de la signature</Label>
            <Input id="sigapi-raison" value={cfg.raison} onChange={(e) => maj("raison", e.target.value)} placeholder="Approbation du document" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sigapi-emplacement">Emplacement</Label>
            <Input id="sigapi-emplacement" value={cfg.emplacement} onChange={(e) => maj("emplacement", e.target.value)} placeholder="Tunis" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sigapi-contact">Contact</Label>
            <Input id="sigapi-contact" value={cfg.contact} onChange={(e) => maj("contact", e.target.value)} placeholder="rh@entreprise.tn" />
          </div>
        </div>

        {/* ---- Certificat LOCAL ---- */}
        {cfg.mode === "LOCALE" && (
          <div className="rounded-md border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-violet-600" />
              <span className="text-sm font-semibold">Certificat de signature du serveur</span>
              {certificatPresent ? (
                <Badge variant="outline" className="gap-1">
                  <BadgeCheck className="h-3 w-3 text-emerald-600" /> importé
                </Badge>
              ) : (
                <Badge variant="outline">aucun</Badge>
              )}
            </div>
            {certificatPresent && (
              <div className="rounded-md bg-muted/60 p-3 text-xs space-y-1">
                <p><strong>Titulaire :</strong> {cfg.certSujet || "—"}</p>
                <p><strong>Émetteur :</strong> {cfg.certEmetteur || "—"}</p>
                <p>
                  <strong>Validité :</strong> {dateFr(cfg.certValideDu)} → {dateFr(cfg.certValideAu)}
                  {" · "}
                  <strong>Série :</strong> {cfg.certSerie || "—"}
                </p>
                <p className="break-all"><strong>Empreinte SHA-256 :</strong> {cfg.certEmpreinte || "—"}</p>
                <p>
                  <strong>Fichier :</strong> {cfg.certFichierNom} ({cfg.certFormat})
                  {" · "}
                  <strong>Clé privée :</strong>{" "}
                  {cfg.certCleFichierNom
                    ? cfg.certCleFichierNom + (cfg.certCleType ? " (" + cfg.certCleType + ")" : "")
                    : "non disponible — la signature exigera la clé associée"}
                </p>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="sigapi-cert">Certificat / coffre (.p12, .pfx, .pem, .cer, .crt, .der)</Label>
                <Input
                  id="sigapi-cert"
                  type="file"
                  accept=".p12,.pfx,.pem,.cer,.crt,.der"
                  onChange={(e) => setFichierCert(e.target.files?.[0] ?? null)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sigapi-mdp">
                  Mot de passe du coffre {cfg.certMotDePasseEnregistre ? "(enregistré — laisser vide pour conserver)" : ""}
                </Label>
                <Input
                  id="sigapi-mdp"
                  type="password"
                  value={motDePasseCert}
                  onChange={(e) => setMotDePasseCert(e.target.value)}
                  placeholder={cfg.certMotDePasseEnregistre ? "•••••••• (enregistré)" : "mot de passe (si protégé)"}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sigapi-cle">Clé privée séparée (.pem, .key, .der) — facultative</Label>
                <Input
                  id="sigapi-cle"
                  type="file"
                  accept=".pem,.key,.der"
                  onChange={(e) => setFichierCle(e.target.files?.[0] ?? null)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sigapi-mdp-cle">
                  Mot de passe de la clé {cfg.certCleMotDePasseEnregistre ? "(enregistré — laisser vide pour conserver)" : ""}
                </Label>
                <Input
                  id="sigapi-mdp-cle"
                  type="password"
                  value={motDePasseCle}
                  onChange={(e) => setMotDePasseCle(e.target.value)}
                  placeholder={cfg.certCleMotDePasseEnregistre ? "•••••••• (enregistré)" : "mot de passe (si chiffrée)"}
                  autoComplete="new-password"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={importerCertificat} disabled={importCertEnCours}>
                {importCertEnCours ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Award className="mr-1 h-4 w-4" />}
                Enregistrer le certificat
              </Button>
              {certificatPresent && (
                <Button type="button" size="sm" variant="outline" onClick={retirerCertificat}>
                  <Trash2 className="mr-1 h-4 w-4" /> Retirer le certificat
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ---- API EXTERNE ---- */}
        {cfg.mode === "API_EXTERNE" && (
          <div className="rounded-md border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Plug className="h-4 w-4 text-violet-600" />
              <span className="text-sm font-semibold">Service externe de certification / signature</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="sigapi-url-test">URL — environnement TEST</Label>
                <Input id="sigapi-url-test" value={cfg.apiUrlTest} onChange={(e) => maj("apiUrlTest", e.target.value)} placeholder="https://essai.fournisseur.tn/api/v1/signer" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sigapi-url-prod">URL — environnement PRODUCTION</Label>
                <Input id="sigapi-url-prod" value={cfg.apiUrlProd} onChange={(e) => maj("apiUrlProd", e.target.value)} placeholder="https://api.fournisseur.tn/v1/signer" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sigapi-auth">Authentification</Label>
                <select
                  id="sigapi-auth"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={cfg.apiAuthType}
                  onChange={(e) => maj("apiAuthType", e.target.value)}
                >
                  <option value="BEARER">Bearer token</option>
                  <option value="API_KEY">Clé d&apos;API (en-tête personnalisé)</option>
                  <option value="BASIC">Basic (identifiant + secret)</option>
                  <option value="AUCUN">Aucune</option>
                </select>
              </div>
              {cfg.apiAuthType === "API_KEY" && (
                <div className="space-y-1">
                  <Label htmlFor="sigapi-entete">Nom de l&apos;en-tête de la clé</Label>
                  <Input id="sigapi-entete" value={cfg.apiAuthEntete} onChange={(e) => maj("apiAuthEntete", e.target.value)} placeholder="X-API-Key" />
                </div>
              )}
              {cfg.apiAuthType === "BASIC" && (
                <div className="space-y-1">
                  <Label htmlFor="sigapi-ident">Identifiant (compte de service)</Label>
                  <Input id="sigapi-ident" value={cfg.apiIdentifiant} onChange={(e) => maj("apiIdentifiant", e.target.value)} placeholder="auto-rh" />
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="sigapi-secret">
                  Secret {cfg.apiSecretEnregistre ? "(enregistré — laisser vide pour conserver)" : ""}
                </Label>
                <Input
                  id="sigapi-secret"
                  type="password"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder={cfg.apiSecretEnregistre ? "•••••••• (enregistré)" : "token / clé / mot de passe"}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sigapi-champ">Champ JSON du PDF signé (si réponse JSON)</Label>
                <Input id="sigapi-champ" value={cfg.apiChampReponse} onChange={(e) => maj("apiChampReponse", e.target.value)} placeholder="data.signedFile — vide = réponse binaire" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sigapi-entetes">En-têtes additionnels (JSON)</Label>
                <Input id="sigapi-entetes" value={cfg.apiEntetesSup} onChange={(e) => maj("apiEntetesSup", e.target.value)} placeholder='{"X-Client":"AutoRH"}' />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sigapi-timeout">Délai d&apos;attente (ms)</Label>
                <Input
                  id="sigapi-timeout"
                  type="number"
                  min={5000}
                  max={300000}
                  step={1000}
                  value={cfg.apiTimeoutMs}
                  onChange={(e) => maj("apiTimeoutMs", Number(e.target.value))}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Le document est envoyé en multipart/form-data (champ « file »). L&apos;URL ACTIVE est :{" "}
              <code className="rounded bg-muted px-1">{cfg.apiUrlActive || "(non configurée pour l'environnement courant)"}</code>
            </p>
            {cfg.apiDernierTestLe && (
              <p className={"text-xs " + (cfg.apiDernierTestOk ? "text-emerald-700" : "text-red-700")}>
                Dernier test ({dateFr(cfg.apiDernierTestLe)}) : {cfg.apiDernierTestOk ? "SUCCÈS" : "ÉCHEC"} — {cfg.apiDernierTestMessage}
              </p>
            )}
          </div>
        )}

        {/* ---- Actions ---- */}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={enregistrer} disabled={enregistrement}>
            {enregistrement ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Enregistrer la configuration
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={tester} disabled={testEnCours}>
            {testEnCours ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1 h-4 w-4" />}
            Tester la signature {cfg.mode === "API_EXTERNE" ? "et la connexion à l'API" : "avec le certificat"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={charger}>
            <RefreshCw className="mr-1 h-4 w-4" /> Rafraîchir
          </Button>
        </div>

        {/* ---- NOUVEAU (v0.2.124) : FICHES DE PAIE & PORTAIL EMPLOYÉ ---- */}
        <div className="rounded-md border p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <IdCard className="h-4 w-4 text-violet-600" />
              <span className="text-sm font-semibold">Fiches de paie &amp; portail employé</span>
            </div>
            {statsFiches && (
              <Badge variant={statsFiches.fichesRestantes === 0 ? "outline" : "secondary"} className="gap-1">
                <ShieldCheck className="h-3 w-3 text-emerald-600" />
                {statsFiches.fichesSignees}/{statsFiches.totalFichesPdf} signée(s) — {statsFiches.fichesRestantes} restante(s)
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Les fiches PDF importées sont signées automatiquement quand le module est actif. Une signature réalisée dans
            l&apos;onglet « Signature » est désormais LIÉE AUTOMATIQUEMENT à la fiche de paie correspondante (contenu
            identique) : le badge « Signée électroniquement » et la copie signée apparaissent immédiatement dans le
            portail employé. Un bouton de rattrapage couvre les fiches importées avant l&apos;activation du module ou dont
            la signature automatique avait échoué.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={rattraper}
              disabled={!cfg.actif || rattrapageEnCours}
              title={cfg.actif ? "Signer maintenant toutes les fiches de paie non signées" : "Activez d'abord le module de signature"}
            >
              {rattrapageEnCours ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileSignature className="mr-1 h-4 w-4" />}
              Signer maintenant les fiches non signées
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={chargerFiches}>
              <RefreshCw className="mr-1 h-4 w-4" /> Actualiser les compteurs
            </Button>
          </div>
        </div>

        {/* SUPPRIMÉ (Task 243) : la section « Documents signés conservés »
            (registre des copies signées : liste, téléchargement,
            re-vérification d'intégrité, suppression) est retirée du panneau
            pour TOUS les rôles. Les copies signées RESTENT conservées et
            servies côté serveur (portail employé, vérification par QR) —
            seul l'affichage du registre disparaît de l'interface. */}
      </CardContent>
    </Card>
  );
}
