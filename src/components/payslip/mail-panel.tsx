"use client";

/**
 * ============================================================================
 *  NOUVEAU (Task 92) — PANNEAU « ENVOI D'E-MAILS (SMTP) » DU SERVICE « SEND
 *  MAIL »
 * ============================================================================
 *
 *  Configuration SMTP : Gmail (bouton dédié conservé) ou tout serveur
 *  personnalisé saisi à la main — tout autre serveur (Outlook, OVH,
 *  relais interne d'entreprise…) se configure par ce bouton. Ce panneau
 *  (troisième carte de l'onglet « Accès portail ») permet :
 *   - de renseigner le serveur SMTP (hôte, port, SSL/TLS, compte d'envoi,
 *     mot de passe d'application, expéditeur « From ») ;
 *   - « Pré-remplir Gmail » : smtp.gmail.com / 465 / SSL-TLS d'un clic ;
 *   - bouton SERVEUR PERSONNALISÉ (adresse du serveur, port, Mail From,
 *     nom d'utilisateur, mot de passe), modifiable ensuite champ par
 *     champ : tout serveur non Gmail se règle ici ;
 *   - de renseigner l'adresse d'accès au portail écrite dans les e-mails
 *     « Send Mail » (pré-remplie automatiquement depuis la requête) — e-mail
 *     ALLÉGÉ : le CIN, l'adresse du serveur et le port n'y figurent plus ;
 *   - « Envoyer un e-mail de test » : vérifie la configuration vers une
 *     adresse quelconque (Gmail accepté) et affiche le message d'erreur SMTP
 *     exact en cas d'échec (diagnostic immédiat).
 *
 *  (Task 102) SUPPRESSION du bouton « Sécurité de la connexion » (demande
 *  utilisateur : fonctionnalité en double avec le champ « Port ») : la
 *  sécurité est déduite automatiquement du port côté serveur
 *  (secureDepuisPort — src/lib/mailer.ts) : port 465 = SSL/TLS direct,
 *  autre port (587, 25…) = STARTTLS/plain. Fini les contradictions
 *  port/sécurité (ex. 465 + STARTTLS) qui faisaient échouer l'envoi.
 *
 *  Sécurité : le mot de passe SMTP est chiffré en base (AES-256-GCM) et
 *  n'est JAMAIS renvoyé à l'interface (booléen hasPassword seulement) — le
 *  champ reste vide : le laisser tel quel = conserver le mot de passe enregistré.
 * ============================================================================
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Bell, Mail, Save, Send, Sparkles, ShieldCheck, Loader2, Settings2, Inbox } from "lucide-react";
import { Switch } from "@/components/ui/switch";

/**
 * Préréglages SMTP d'un clic : Gmail + SERVEUR PERSONNALISÉ seulement
 * (demande utilisateur : tous les autres préréglages retirés). « personnalise »
 * ne touche PAS à l'hôte : il est saisi librement (nom d'hôte ou IP).
 * (Task 102) PLUS DE CHAMP « secure » : la sécurité est déduite du port
 * (465 = SSL/TLS direct, autre port = STARTTLS/plain) — voir secureDepuisPort.
 */
interface Fournisseur {
  id: string;
  bouton: string;
  titre: string;
  host: string;
  port: string;
  hint: string;
}

const FOURNISSEURS: Fournisseur[] = [
  {
    id: "gmail",
    // (MODIFIÉ Task 136 — demande utilisateur « les boutons « Serveur
    // personnalisé » et « Serveur prédéfini » ne sont pas présents ») : les
    // DEUX boutons de choix du serveur sont remontés EN TÊTE du panneau et
    // libellés explicitement — l'ancien « Pré-remplir Gmail » était enterré
    // sous les sections de routage/IMAP du panneau (longues) et passait
    // inaperçu. Comportement identique : pré-remplit smtp.gmail.com / 465.
    bouton: "Serveur prédéfini (Gmail)",
    titre: "Gmail",
    host: "smtp.gmail.com",
    port: "465",
    hint: "Renseignez votre adresse Gmail complète et un MOT DE PASSE D'APPLICATION (16 caractères) — un simple mot de passe de connexion est refusé par Google.",
  },
  {
    // NOUVEAU (Task 201) — préréglage Zoho Mail : paramètres VÉRIFIÉS par test
    // de connexion réel (authentification + envoi + IMAP OK) : SMTP
    // smtp.zoho.com port 465 (SSL) — 587 (STARTTLS) fonctionne aussi ; IMAP
    // imap.zoho.com port 993. Erreur fréquente corrigée par ce préréglage :
    // saisir « smtp.zohomail.com » (INEXISTANT) au lieu de « smtp.zoho.com ».
    id: "zoho",
    bouton: "Serveur prédéfini (Zoho)",
    titre: "Zoho Mail",
    host: "smtp.zoho.com",
    port: "465",
    hint: "Paramètres Zoho vérifiés : smtp.zoho.com port 465 (SSL). Utilisateur = adresse Zoho COMPLÈTE (ex. rh@zohomail.com) + mot de passe du compte (ou mot de passe d'application si validation en 2 étapes). Expéditeur (Mail From) = la même adresse Zoho. Pour recevoir les demandes : « E-mail du service RH » = votre adresse Zoho. Réception des réponses (IMAP) : imap.zoho.com port 993.",
  },
  {
    id: "personnalise",
    bouton: "Serveur personnalisé",
    titre: "Serveur SMTP personnalisé",
    host: "", // ne touche PAS à l'hôte : il est saisi librement (nom d'hôte ou IP)
    port: "587",
    hint: "Saisissez librement vos paramètres : adresse du serveur SMTP (nom d'hôte ou IP), port (25, 465, 587…), adresse e-mail de l'expéditeur (Mail From), nom d'utilisateur (e-mail OU simple login ex. admin) et mot de passe. La sécurité est réglée automatiquement selon le port : 465 = SSL/TLS direct, autre port (587, 25…) = STARTTLS/plain.",
  },
];

interface ConfigMail {
  host: string;
  port: number;
  secure: boolean; // (Task 102) dérivé du port côté serveur — ignoré par l'interface
  username: string | null;
  from: string;
  serveurAdresse: string;
  sitePort: string;
  portailUrl: string;
  // NOUVEAU (Task 116) : routage des demandes administratives
  rhEmail: string;
  itEmail: string;
  responsablesMap: string;
  // NOUVEAU (v0.2.49) : adresse dédiée des demandes de parrainage
  parrainageEmail: string;
  // NOUVEAU (v0.2.197) : adresse en COPIE des demandes de parrainage
  // (responsable principal du parrainage) — l'adresse dédiée reste
  // destinataire principal.
  parrainageCopieEmail: string;
  // NOUVEAU (v0.2.94, Task 197) : adresses dédiées par type de demande
  attestationTravailEmail: string;
  attestationSalaireEmail: string;
  congeEmail: string;
  autorisationEmail: string;
  hasPassword: boolean;
  configuree: boolean;
  // NOUVEAU (Task 122) : réception des réponses du RH (IMAP)
  imapActif: boolean;
  imapHost: string;
  imapPort: number;
  imapUser: string | null;
  hasImapPassword: boolean;
}

interface DefautsDetectes {
  serveur: string;
  sitePort: string;
  portailUrl: string;
}

export function MailPanel() {
  const { toast } = useToast();
  const [chargement, setChargement] = useState(true);
  const [enregistrement, setEnregistrement] = useState(false);
  const [envoiTest, setEnvoiTest] = useState(false);
  // Formulaire SMTP (Task 102 : plus d'état « secure » — dérivé du port)
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [from, setFrom] = useState("");
  // Corps des e-mails : serveur / port / adresse d'accès au portail
  const [serveurAdresse, setServeurAdresse] = useState("");
  const [sitePort, setSitePort] = useState("");
  const [portailUrl, setPortailUrl] = useState("");
  // NOUVEAU (Task 116) : routage des demandes administratives
  const [rhEmail, setRhEmail] = useState("");
  const [itEmail, setItEmail] = useState("");
  const [responsablesMap, setResponsablesMap] = useState("");
  // NOUVEAU (v0.2.49) : adresse dédiée des demandes de parrainage
  const [parrainageEmail, setParrainageEmail] = useState("");
  // (v0.2.197) adresse en copie des demandes de parrainage (responsable
  // principal du parrainage)
  const [parrainageCopieEmail, setParrainageCopieEmail] = useState("");
  // NOUVEAU (v0.2.94, Task 197) : adresses dédiées par type de demande
  const [attestationTravailEmail, setAttestationTravailEmail] = useState("");
  const [attestationSalaireEmail, setAttestationSalaireEmail] = useState("");
  const [congeEmail, setCongeEmail] = useState("");
  const [autorisationEmail, setAutorisationEmail] = useState("");
  // NOUVEAU (Task 122) : réception des réponses du RH (IMAP)
  const [imapActif, setImapActif] = useState(false);
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [imapUser, setImapUser] = useState("");
  const [imapPassword, setImapPassword] = useState("");
  const [hasImapPassword, setHasImapPassword] = useState(false);
  // Test
  const [testDest, setTestDest] = useState("");
  const [testOk, setTestOk] = useState<string | null>(null);
  // (NOUVEAU 0.2.58 — « Afficher notification SMTP ») l'échec d'un e-mail de
  // test est de nouveau AFFICHÉ de façon PERSISTANTE dans le panneau — mais
  // en encadré AMBRE (jamais rouge : les zones rouges ont été supprimées à
  // la demande en v0.2.57) — en complément du toast transitoire. Un
  // horodatage accompagne chaque notification (succès comme échec).
  const [testErreur, setTestErreur] = useState<string | null>(null);
  const [testHorodatage, setTestHorodatage] = useState<string>("");
  // (MODIFIÉ 0.2.58 — demande utilisateur « Afficher notification SMTP ») :
  // l'échec du test SMTP est de nouveau affiché en permanence dans le
  // panneau, mais en encadré AMBRE (notification lisible, jamais rouge —
  // les zones rouges restent supprimées), accompagné du toast transitoire
  // historique et d'un horodatage. Le succès garde son encadré vert.

  const charge = useCallback(async () => {
    setChargement(true);
    try {
      const res = await fetch("/api/mail-config", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { config: ConfigMail; defauts: DefautsDetectes };
        const c = data.config;
        setHost(c.host);
        setPort(String(c.port || 587));
        setUsername(c.username ?? "");
        setHasPassword(c.hasPassword);
        setFrom(c.from);
        // Valeurs du corps : ce qui est enregistré, sinon les défauts détectés.
        setServeurAdresse(c.serveurAdresse || data.defauts.serveur);
        setSitePort(c.sitePort || data.defauts.sitePort);
        setPortailUrl(c.portailUrl || data.defauts.portailUrl);
        // (Task 116) routage des demandes administratives
        setRhEmail(c.rhEmail ?? "");
        setItEmail(c.itEmail ?? "");
        setResponsablesMap(c.responsablesMap ?? "");
        // (v0.2.49) adresse dédiée des demandes de parrainage
        setParrainageEmail(c.parrainageEmail ?? "");
        // (v0.2.197) adresse en copie des demandes de parrainage
        setParrainageCopieEmail(c.parrainageCopieEmail ?? "");
        // (v0.2.94, Task 197) adresses dédiées par type de demande
        setAttestationTravailEmail(c.attestationTravailEmail ?? "");
        setAttestationSalaireEmail(c.attestationSalaireEmail ?? "");
        setCongeEmail(c.congeEmail ?? "");
        setAutorisationEmail(c.autorisationEmail ?? "");
        // (Task 122) réception des réponses du RH (IMAP)
        setImapActif(Boolean(c.imapActif));
        setImapHost(c.imapHost ?? "");
        setImapPort(String(c.imapPort || 993));
        setImapUser(c.imapUser ?? "");
        setHasImapPassword(Boolean(c.hasImapPassword));
      }
    } catch {
      // silencieux
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    charge();
  }, [charge]);

  /**
   * Pré-remplissage d'un fournisseur en un clic (Gmail ou serveur
   * personnalisé). Pour « personnalise », l'hôte déjà saisi est conservé.
   */
  function preRemplirFournisseur(f: Fournisseur) {
    if (f.host) setHost(f.host);
    setPort(f.port);
    if (f.id === "gmail" && !username) setUsername("@gmail.com");
    // (Task 201) Zoho : l'utilisateur est l'adresse Zoho COMPLÈTE
    if (f.id === "zoho" && !username) setUsername("@zohomail.com");
    toast({
      title:
        f.id === "personnalise"
          ? "Serveur personnalisé : saisissez vos paramètres"
          : `Paramètres ${f.titre} pré-remplis`,
      description: f.hint,
    });
  }

  async function enregistrer() {
    setEnregistrement(true);
    try {
      const res = await fetch("/api/mail-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          username,
          // Champ vide = conserver le mot de passe déjà enregistré
          password,
          from,
          serveurAdresse,
          sitePort,
          portailUrl,
          // (Task 116) routage des demandes administratives
          rhEmail,
          itEmail,
          responsablesMap,
          // (v0.2.49) adresse dédiée des demandes de parrainage
          parrainageEmail,
          // (v0.2.197) adresse en copie des demandes de parrainage
          parrainageCopieEmail,
          // (v0.2.94, Task 197) adresses dédiées par type de demande
          attestationTravailEmail,
          attestationSalaireEmail,
          congeEmail,
          autorisationEmail,
          // (Task 122) réception des réponses du RH (IMAP) — identifiants
          // vides = réutilisation de ceux du SMTP ; mot de passe vide =
          // conservation de celui déjà enregistré.
          imapActif,
          imapHost,
          imapPort: parseInt(imapPort, 10) || 993,
          imapUser,
          imapPassword,
          // (Task 102) plus de champ « secure » : dérivé du port côté serveur
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setHasPassword(Boolean(data.config?.hasPassword));
        setPassword("");
        setHasImapPassword(Boolean(data.config?.hasImapPassword));
        setImapPassword("");
        toast({ title: "Configuration SMTP enregistrée", description: data.message });
      } else {
        toast({ title: "Enregistrement impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setEnregistrement(false);
    }
  }

  async function envoyerTest() {
    setTestOk(null);
    setTestErreur(null); // (NOUVEAU 0.2.58) purge de la notification précédente
    setEnvoiTest(true);
    try {
      const res = await fetch("/api/mail-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", dest: testDest }),
      });
      const data = await res.json().catch(() => ({}));
      // (NOUVEAU 0.2.58) horodatage commun aux deux notifications (succès /
      // échec) — format lisible (heure locale du navigateur).
      const horodatage = new Date().toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      setTestHorodatage(horodatage);
      if (res.ok) {
        setTestOk(data.message);
        toast({ title: "E-mail de test envoyé", description: data.message });
      } else {
        // (MODIFIÉ Task 136) plus de bandeau rouge persistant — une
        // notification transitoire suffit.
        // (MODIFIÉ 0.2.58) l'erreur est AUSSI affichée de façon persistante
        // dans le bloc « Notification SMTP » (encadré ambre horodaté) — le
        // toast disparaît en quelques secondes, pas la notification.
        setTestErreur(data.error || "Échec de l'envoi de test.");
        toast({
          title: "Envoi de test impossible",
          description: data.error || "Échec de l'envoi de test.",
          variant: "destructive",
        });
      }
    } catch {
      setTestHorodatage(
        new Date().toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
      setTestErreur("Erreur réseau : le serveur n'a pas répondu.");
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setEnvoiTest(false);
    }
  }

  // NOUVEAU (0.2.47) : TEST DE CONNEXION IMAP — même parcours que le portail
  // (connexion, INBOX, recherche des non lus), résultat étape par étape.
  const [testImapEnCours, setTestImapEnCours] = useState(false);
  const [testImapOk, setTestImapOk] = useState<string | null>(null);
  const [testImapKo, setTestImapKo] = useState<string | null>(null);
  const [testImapIndice, setTestImapIndice] = useState("");
  const [testImapEtapes, setTestImapEtapes] = useState<{ etape: string; ok: boolean; detail: string }[]>([]);

  async function testerImap() {
    setTestImapOk(null);
    setTestImapKo(null);
    setTestImapIndice("");
    setTestImapEtapes([]);
    setTestImapEnCours(true);
    try {
      const res = await fetch("/api/mail-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test-imap",
          imapHost,
          imapPort,
          imapUser,
          imapPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setTestImapEtapes(Array.isArray(data.etapes) ? data.etapes : []);
      if (res.ok) {
        setTestImapOk(data.message || "Connexion IMAP réussie.");
        toast({ title: "Connexion IMAP réussie", description: data.message });
      } else {
        setTestImapKo(data.erreur || "Échec de la connexion IMAP.");
        setTestImapIndice(String(data.indice ?? ""));
      }
    } catch {
      setTestImapKo("Erreur réseau : le serveur d'administration n'a pas répondu.");
    } finally {
      setTestImapEnCours(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-emerald-600" />
          Envoi d&apos;e-mails (SMTP) — configuration du serveur d&apos;envoi
        </CardTitle>
        <CardDescription>
          Le bouton <b>«&nbsp;Envoyer l&apos;e-mail&nbsp;»</b> de la liste «&nbsp;CIN – Accès Portail par mot de
          passe&nbsp;» envoie à l&apos;employé son <b>mot de passe initial</b> et
          l&apos;<b>adresse d&apos;accès au portail</b> — il se connecte avec son CIN, volontairement
          non inclus dans l&apos;e-mail. Configurez ici votre serveur d&apos;envoi —
          Gmail ou tout autre serveur SMTP via «&nbsp;Serveur personnalisé&nbsp;» —
          puis validez avec un e-mail de test.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {chargement ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement de la configuration…
          </p>
        ) : (
          <>
            {/* -------- (NOUVEAU Task 136) CHOIX DU SERVEUR — EN TÊTE ------- */}
            {/* Les deux boutons de pré-remplissage étaient historiquement    */}
            {/* placés SOUS les sections routage des demandes + IMAP (le      */}
            {/* panneau est long : ils passaient sous le premier écran et     */}
            {/* l'utilisateur ne les trouvait pas). Ils ouvrent la voie :     */}
            {/* serveur PRÉDÉFINI (Gmail) ou serveur PERSONNALISÉ.            */}
            <div className="rounded-md border border-emerald-300 bg-emerald-50/60 p-3 space-y-2">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Settings2 className="h-4 w-4 text-emerald-600" />
                Choix du serveur d&apos;envoi — préréglages en un clic
              </p>
              <div className="flex flex-wrap gap-2">
                {FOURNISSEURS.map((f) => (
                  <Button key={f.id} variant="outline" size="sm" onClick={() => preRemplirFournisseur(f)}>
                    {f.id === "gmail" ? (
                      <Sparkles className="h-4 w-4" />
                    ) : (
                      <Settings2 className="h-4 w-4" />
                    )}
                    {f.bouton}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                <b>Serveur prédéfini (Gmail)</b>&nbsp;: pré-remplit
                smtp.gmail.com / port 465 (SSL/TLS). <b>Serveur prédéfini (Zoho)</b>&nbsp;:
                pré-remplit smtp.zoho.com / port 465 (SSL/TLS) — paramètres testés
                (erreur fréquente : «&nbsp;smtp.zohomail.com&nbsp;» n&apos;existe pas,
                le bon hôte est <b>smtp.zoho.com</b>). <b>Serveur personnalisé</b>&nbsp;:
                tout autre serveur (Outlook, OVH, relais interne d&apos;entreprise…) —
                l&apos;adresse du serveur est saisie librement ci-dessous. Après le
                choix, complétez le compte et le mot de passe puis cliquez sur
                «&nbsp;Enregistrer la configuration&nbsp;».
              </p>
            </div>

            {/* -------- Serveur SMTP -------- */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                <Label htmlFor="mail-host">Adresse du serveur SMTP</Label>
                <Input
                  id="mail-host"
                  placeholder="smtp.monentreprise.com ou 192.168.1.100"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mail-port">Port SMTP</Label>
                <Input
                  id="mail-port"
                  placeholder="25, 465 ou 587"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                />
                {/* (Task 102) remplace l'ancien bouton « Sécurité de la
                    connexion » (supprimé : doublon du port) : la sécurité
                    est déduite automatiquement du port. */}
                <p className="text-xs text-muted-foreground">
                  Sécurité réglée automatiquement : 465 = SSL/TLS direct,
                  autre port (587, 25…) = STARTTLS/plain.
                </p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="mail-user">Nom d&apos;utilisateur (authentification)</Label>
                <Input
                  id="mail-user"
                  placeholder="support@mail.com, admin ou DOMAIN\utilisateur… (vide si le serveur est sans authentification)"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="mail-pass">
                  Mot de passe {hasPassword ? "(déjà enregistré)" : ""}
                </Label>
                <Input
                  id="mail-pass"
                  type="password"
                  placeholder={hasPassword ? "•••••••••••• — laisser vide pour conserver" : "mot de passe du compte (mot de passe d'application pour Gmail)"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
                <Label htmlFor="mail-from">Adresse e-mail de l&apos;expéditeur (Mail From)</Label>
                <Input
                  id="mail-from"
                  placeholder="support@mail.com ou AutoRH &lt;expediteur@mondomaine.com&gt;"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Adresse utilisée comme expéditeur des e-mails. À renseigner
                  notamment si le nom d&apos;utilisateur n&apos;est pas une adresse e-mail
                  (login simple type «&nbsp;admin&nbsp;» sur un serveur personnalisé).
                </p>
              </div>
            </div>

            {/* -------- Corps des e-mails : adresse du portail ---------- */}
            {/* E-mail ALLÉGÉ (demande utilisateur) : le CIN, l'adresse du  */}
            {/* serveur et le port ne sont PLUS écrits dans l'e-mail. Les   */}
            {/* valeurs serveur/port restées en base sont renvoyées telles  */}
            {/* quelles à l'enregistrement (champs masqués ici).            */}
            <div className="rounded-md border bg-muted/40 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-2.5">
                Adresse d&apos;accès au portail écrite dans les e-mails «&nbsp;Envoyer l&apos;e-mail&nbsp;»
                (pré-remplie automatiquement, modifiable) :
              </p>
              <div className="space-y-1.5 sm:max-w-md">
                <Label htmlFor="mail-url">Adresse d&apos;accès au portail</Label>
                <Input
                  id="mail-url"
                  placeholder="http://192.168.1.10:4001"
                  value={portailUrl}
                  onChange={(e) => setPortailUrl(e.target.value)}
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  L&apos;e-mail ne contient QUE cette adresse et le mot de passe initial.
                </p>
              </div>
            </div>

            {/* -------- NOUVEAU (Task 116) : routage des demandes administratives -------- */}
            <div className="rounded-md border bg-muted/40 p-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground">
                Routage des <b>demandes administratives</b> (portail employé) — chaque demande est
                envoyée automatiquement par e-mail au destinataire concerné :
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="mail-rh">E-mail du service RH (attestations)</Label>
                  <Input
                    id="mail-rh"
                    type="email"
                    placeholder="rh@entreprise.tn"
                    value={rhEmail}
                    onChange={(e) => setRhEmail(e.target.value)}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Reçoit les demandes d&apos;<b>attestation de travail</b> et
                    d&apos;<b>attestation de salaire</b> — destinataire PRINCIPAL
                    (v0.2.196&nbsp;: les adresses dédiées ci-dessous reçoivent une
                    COPIE de chaque demande).
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mail-it">E-mail du service informatique (optionnel)</Label>
                  <Input
                    id="mail-it"
                    type="email"
                    placeholder="it@entreprise.tn"
                    value={itEmail}
                    onChange={(e) => setItEmail(e.target.value)}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Réservé aux notifications techniques éventuelles.{" "}
                    {/* (Task 221) cette adresse devient l'EXPÉDITEUR des e-mails de création de comptes RH/IT */}
                    L&apos;e-mail envoyé aux nouveaux comptes RH et IT partira de cette adresse
                    (expéditeur visible par le destinataire).
                  </p>
                </div>
                {/* NOUVEAU (v0.2.49) : adresse DÉDIÉE des demandes de parrainage */}
                <div className="space-y-1.5">
                  <Label htmlFor="mail-parrainage">E-mail dédié des demandes de parrainage</Label>
                  <Input
                    id="mail-parrainage"
                    type="email"
                    placeholder="parrainage@entreprise.tn"
                    value={parrainageEmail}
                    onChange={(e) => setParrainageEmail(e.target.value)}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Reçoit les demandes de <b>parrainage</b> à une adresse DÉDIÉE,
                    différente de celle des autres demandes. Depuis la v0.2.92,
                    l&apos;employé ne saisit plus d&apos;e-mail N+1 : les demandes de
                    parrainage partent TOUJOURS à cette adresse (une confirmation
                    est envoyée automatiquement à l&apos;employé demandeur). Depuis la
                    v0.2.197, une adresse en COPIE du responsable principal du
                    parrainage peut être ajoutée ci-dessous. Vide :
                    repli sur la boîte du service RH. Pour la
                    réception des documents répondus, configurez aussi la lecture
                    IMAP sur cette boîte si elle est distincte.
                  </p>
                </div>
                {/* NOUVEAU (v0.2.197, demande utilisateur « en copie du
                    responsable principal du parrainage ») : adresse en COPIE
                    des demandes de parrainage — l'adresse dédiée ci-dessus
                    reste destinataire principal pour la validation. */}
                <div className="space-y-1.5">
                  <Label htmlFor="mail-parrainage-copie">E-mail dédié — demandes de parrainage (copie)</Label>
                  <Input
                    id="mail-parrainage-copie"
                    type="email"
                    placeholder="responsable.parrainage@entreprise.tn"
                    value={parrainageCopieEmail}
                    onChange={(e) => setParrainageCopieEmail(e.target.value)}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Reçoit une <b>COPIE</b> des demandes de <b>parrainage</b> pour le
                    responsable principal du parrainage — l&apos;adresse dédiée
                    (champ ci-dessus) reste destinataire principal pour validation.
                    Vide&nbsp;: aucune copie supplémentaire.
                  </p>
                </div>
                {/* NOUVEAU (v0.2.94, Task 197) : MAP DE CONFIGURATION DES
                    MAILS — une adresse DÉDIÉE par type de demande.
                    MODIFIÉ (v0.2.196, demande utilisateur « en copie ») :
                    attestations = COPIE, la boîte RH reste destinataire
                    principale (même sémantique que congé / autorisation). */}
                <div className="space-y-1.5">
                  <Label htmlFor="mail-att-travail">E-mail dédié — attestations de travail (copie)</Label>
                  <Input
                    id="mail-att-travail"
                    type="email"
                    placeholder="attestation.travail@entreprise.tn"
                    value={attestationTravailEmail}
                    onChange={(e) => setAttestationTravailEmail(e.target.value)}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Reçoit une <b>COPIE</b> des demandes d&apos;<b>attestation de
                    travail</b> — la boîte du service RH reste destinataire
                    principale. Vide&nbsp;: aucune copie supplémentaire.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mail-att-salaire">E-mail dédié — attestations de salaire (copie)</Label>
                  <Input
                    id="mail-att-salaire"
                    type="email"
                    placeholder="attestation.salaire@entreprise.tn"
                    value={attestationSalaireEmail}
                    onChange={(e) => setAttestationSalaireEmail(e.target.value)}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Reçoit une <b>COPIE</b> des demandes d&apos;<b>attestation de
                    salaire</b> — la boîte du service RH reste destinataire
                    principale. Vide&nbsp;: aucune copie supplémentaire.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mail-conge">E-mail dédié — demandes de congé (copie)</Label>
                  <Input
                    id="mail-conge"
                    type="email"
                    placeholder="conge@entreprise.tn"
                    value={congeEmail}
                    onChange={(e) => setCongeEmail(e.target.value)}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Reçoit une <b>COPIE</b> des demandes de <b>congé</b> — le manager
                    responsable de l&apos;employé (affecté dans «&nbsp;Mot de passe initial
                    —&nbsp;CIN&nbsp;», v0.2.132) reste destinataire principal pour validation.
                    Vide&nbsp;: la copie part à la boîte RH.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mail-autorisation">E-mail dédié — autorisations de sortie (copie)</Label>
                  <Input
                    id="mail-autorisation"
                    type="email"
                    placeholder="autorisation@entreprise.tn"
                    value={autorisationEmail}
                    onChange={(e) => setAutorisationEmail(e.target.value)}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Reçoit une <b>COPIE</b> des demandes d&apos;<b>autorisation de sortie</b> — le
                    manager responsable de l&apos;employé (affecté dans «&nbsp;Mot de passe
                    initial —&nbsp;CIN&nbsp;», v0.2.132) reste destinataire principal pour
                    validation. Vide&nbsp;: la copie part à la boîte RH.
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mail-responsables">Responsables — autorisations de sortie (une règle par ligne)</Label>
                <Textarea
                  id="mail-responsables"
                  rows={4}
                  placeholder={"COMPTABILITE=compta@entreprise.tn\nPRODUCTION=prod@entreprise.tn\nDEFAUT=rh@entreprise.tn"}
                  value={responsablesMap}
                  onChange={(e) => setResponsablesMap(e.target.value)}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Format&nbsp;: <b>DEPARTEMENT=email</b> — depuis la v0.2.132, le congé et
                  l&apos;autorisation de sortie sont envoyés au <b>manager responsable</b> de
                  l&apos;employé (affecté dans «&nbsp;Mot de passe initial —&nbsp;CIN&nbsp;» : plus
                  AUCUN responsable saisi par l&apos;employé) ; cet ancien routage par
                  département (repli&nbsp;: ligne <b>DEFAUT</b>, puis boîte RH) ne sert plus
                  qu&apos;aux demandes sans manager affecté. La copie dédiée ci-dessus reçoit
                  systématiquement une copie. (Le parrainage part à l&apos;adresse dédiée,
                  sinon à la boîte RH ; le responsable principal du parrainage reçoit
                  une copie — v0.2.197.)
                </p>
              </div>
            </div>

            {/* -------- NOUVEAU (Task 122) : réception des réponses du RH (IMAP) -------- */}
            <div className="rounded-md border bg-muted/40 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Inbox className="h-4 w-4 text-emerald-600" />
                  <span>
                    Réception des <b>réponses du service RH</b> (IMAP) — le document joint à la
                    réponse est automatiquement associé à la demande dans le portail employé.
                  </span>
                </p>
                <Switch checked={imapActif} onCheckedChange={setImapActif} aria-label="Activer la réception IMAP" />
              </div>
              {imapActif && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="mail-imap-host">Adresse du serveur IMAP</Label>
                    <Input
                      id="mail-imap-host"
                      placeholder="imap.gmail.com, imap.zoho.com ou imap.monentreprise.com"
                      value={imapHost}
                      onChange={(e) => setImapHost(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mail-imap-port">Port IMAP</Label>
                    <Input
                      id="mail-imap-port"
                      placeholder="993 (SSL/TLS) ou 143 (STARTTLS)"
                      value={imapPort}
                      onChange={(e) => setImapPort(e.target.value)}
                      inputMode="numeric"
                      autoComplete="off"
                    />
                    <p className="text-xs text-muted-foreground">
                      Sécurité réglée automatiquement : 993 = SSL/TLS direct, autre port = STARTTLS.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mail-imap-user">Compte de lecture (vide = compte SMTP)</Label>
                    <Input
                      id="mail-imap-user"
                      placeholder="rh@entreprise.tn — vide si identique au compte d&apos;envoi"
                      value={imapUser}
                      onChange={(e) => setImapUser(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mail-imap-pass">
                      Mot de passe de lecture {hasImapPassword ? "(déjà enregistré)" : "(vide = celui du SMTP)"}
                    </Label>
                    <Input
                      id="mail-imap-pass"
                      type="password"
                      placeholder={hasImapPassword ? "•••••••••••• — laisser vide pour conserver" : "vide = mot de passe du compte SMTP"}
                      value={imapPassword}
                      onChange={(e) => setImapPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs text-muted-foreground">
                      Le portail interroge la boîte de réception (messages non lus) et reconnaît les
                      réponses aux demandes par leur référence <b>DEM-AAAA-NNNNN</b> ou le message
                      d&apos;origine. Seules les réponses <b>de l&apos;adresse destinataire</b> de la demande
                      (ex. rhEmail) sont acceptées ; pièces jointes acceptées : PDF, Word, images —
                      15&nbsp;Mo max. Désactivé par défaut : l&apos;enregistrement prend effet au prochain
                      passage du portail (vérification automatique toutes les 2&nbsp;minutes).
                    </p>
                  </div>
                  {/* NOUVEAU (0.2.47) : diagnostic IMAP immédiat — évite le
                      « Command failed » du journal ; test possible AVANT
                      enregistrement (valeurs du formulaire utilisées). */}
                  <div className="sm:col-span-2 space-y-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={testerImap}
                      disabled={testImapEnCours}
                      className="gap-1.5"
                    >
                      {testImapEnCours ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Inbox className="h-4 w-4" />
                      )}
                      Tester la connexion IMAP
                    </Button>
                    {testImapEtapes.length > 0 && (
                      <ul className="text-xs space-y-1">
                        {testImapEtapes.map((et, i) => (
                          <li key={i} className={et.ok ? "text-emerald-700" : "text-destructive"}>
                            {et.ok ? "✔" : "✖"} {et.etape}
                            {et.detail ? " — " + et.detail : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    {testImapOk && (
                      <p className="text-xs rounded-md border border-emerald-300 bg-emerald-50 text-emerald-800 px-2.5 py-1.5">
                        {testImapOk}
                      </p>
                    )}
                    {testImapKo && (
                      <div className="text-xs space-y-1">
                        <p className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive px-2.5 py-1.5">
                          {testImapKo}
                        </p>
                        {testImapIndice && (
                          <p className="text-muted-foreground px-2.5">💡 {testImapIndice}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {/* (MODIFIÉ Task 136) les boutons de préréglage (« Serveur
                  prédéfini (Gmail) » / « Serveur personnalisé ») sont DÉPLACÉS
                  EN TÊTE du panneau (visibles sans défilement) ; ne reste ici
                  que l'enregistrement de la configuration. */}
              <Button
                size="sm"
                onClick={enregistrer}
                disabled={enregistrement}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {enregistrement ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Enregistrer la configuration
              </Button>
            </div>

            {/* -------- E-mail de test -------- */}
            <div className="rounded-md border p-3 space-y-2.5">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Tester l&apos;envoi (adresse destinataire quelconque)
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder="destinataire@exemple.com"
                  value={testDest}
                  onChange={(e) => setTestDest(e.target.value)}
                  type="email"
                  autoComplete="email"
                  className="sm:max-w-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={envoyerTest}
                  disabled={envoiTest || !testDest.trim()}
                >
                  {envoiTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Envoyer un e-mail de test
                </Button>
              </div>
              {/* (NOUVEAU 0.2.58 — « Afficher notification SMTP ») bloc de
                  notification PERSISTANT du dernier test : succès = encadré
                  vert, échec = encadré ambre (jamais rouge) — chaque
                  notification est horodatée et reste affichée jusqu'au
                  prochain test. Le toast transitoire est conservé en
                  complément. */}
              {(testOk || testErreur) && (
                <div className="space-y-1" aria-live="polite">
                  <p className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
                    <Bell className="h-3.5 w-3.5" />
                    Notification SMTP{testHorodatage ? ` — ${testHorodatage}` : ""}
                  </p>
                  {testOk && (
                    <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md p-2.5">
                      <b>Succès :</b> {testOk}
                    </p>
                  )}
                  {testErreur && (
                    <p className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-md p-2.5">
                      <b>Échec :</b> {testErreur}
                    </p>
                  )}
                </div>
              )}
              {/* (SUPPRIMÉ Task 136 — « supprimer le contenu situé dans la
                  zone rouge ») : le bandeau ROUGE d'échec n'est pas rétabli ;
                  l'échec est signalé par le bloc ambre ci-dessus (persistent)
                  et par un toast transitoire. */}
              <p className="text-xs text-muted-foreground">
                <b>Gmail</b> : validation en 2 étapes + <b>mot de passe d&apos;application</b> de
                16 caractères (myaccount.google.com/apppasswords) — un simple mot de passe de
                connexion est refusé. <b>Serveur personnalisé</b> : nom d&apos;utilisateur =
                adresse e-mail ou simple login (ex. admin) ; renseignez l&apos;adresse
                d&apos;expédition (Mail From) si le login n&apos;est pas un e-mail ; un relais
                interne d&apos;entreprise est souvent sans authentification (compte vide).
                La sécurité dépend du port (réglée automatiquement) : port&nbsp;465 = SSL/TLS
                direct, port&nbsp;587 = STARTTLS, port&nbsp;25 = relais interne.
                Les certificats auto-signés des serveurs d&apos;entreprise sont acceptés
                automatiquement. Si l&apos;e-mail n&apos;arrive pas, vérifiez le dossier Spam.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
