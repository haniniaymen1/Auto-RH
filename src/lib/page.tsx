"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PdfDialog } from "@/components/payslip/pdf-dialog";
import { SearchTab } from "@/components/payslip/search-tab";
import { ImportTab } from "@/components/payslip/import-tab";
import { SignaturePanel } from "@/components/payslip/signature-panel";
import { AllTab } from "@/components/payslip/all-tab";
import { UsersTab } from "@/components/payslip/users-tab";
// NOUVEAU (Task 64) : gestion des accès au portail employé par MOT DE PASSE
// (initial à usage unique + changement obligatoire + expiration 15 jours)
import { PortalAccessTab } from "@/components/payslip/portal-access-tab";
// NOUVEAU (Task 116) : onglet « Demandes administratives » (RH + SUPERADMIN —
// MODIFIÉ Task 173 : l'IT n'y a plus accès)
import { DemandesTab } from "@/components/payslip/demandes-tab";
// NOUVEAU (Task 173) : panneau de configuration mail (onglet « Paramètres »
// du rôle IT — SMTP consultable et modifiable par l'IT)
import { MailPanel } from "@/components/payslip/mail-panel";
// NOUVEAU (Task 224) : panneau « API de certification & signature
// électronique » (onglet « Paramètres » — configuration du module de
// signature PAdES : certificat local ou API externe, registre, tests)
import { SignatureApiPanel } from "@/components/payslip/signature-api-panel";
// NOUVEAU (Task 225) : panneau « Signature des documents importés »
// (onglet « Signature » — RH + SUPERADMIN) : tout fichier téléversé est
// signé automatiquement avec le certificat chargé (PAdES pour les PDF,
// PKCS#7/CMS détaché pour les autres formats) puis téléchargeable ;
// affiche les informations du certificat électronique chargé.
import SignatureDocumentsPanel from "@/components/payslip/signature-documents-panel";
// NOUVEAU (Task 64) : écran de changement de mot de passe OBLIGATOIRE
// (expiration 15 jours, appliquée à TOUS les comptes admin et portail)
import { ForceChangePassword } from "@/components/payslip/force-change-password";
import type {
  PayslipListItem,
  StatsResponse,
  SessionUser,
  // NOUVEAU (Task 99) : réponse paginée + métadonnées de pagination.
  PayslipListResponse,
  PaginationMeta,
} from "@/lib/types";
import {
  IdCard,
  FileText,
  CalendarClock,
  Search,
  UploadCloud,
  LayoutList,
  Building2,
  RefreshCw,
  Users2,
  ClipboardList,
  Settings,
  Smartphone,
  LogOut,
  FileSignature,
} from "lucide-react";

export default function Home() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [allPayslips, setAllPayslips] = useState<PayslipListItem[]>([]);
  // NOUVEAU (Task 99) : PAGINATION SERVEUR — la liste ne charge plus que la
  // page courante (100 fiches par page, côté serveur) ; métadonnées pour
  // les contrôles de page.
  const [listMeta, setListMeta] = useState<PaginationMeta>({
    page: 1,
    totalPages: 1,
    total: 0,
  });
  const listPageRef = useRef(1);
  const [searchResults, setSearchResults] = useState<PayslipListItem[]>([]);
  const [searchMeta, setSearchMeta] = useState<PaginationMeta>({
    page: 1,
    totalPages: 1,
    total: 0,
  });
  // NOUVEAU (Task 99) : fiches restant à indexer pour la recherche rapide
  // (null = état encore inconnu — pas encore interrogé).
  const [indexRestants, setIndexRestants] = useState<number | null>(null);
  const [indexationEnCours, setIndexationEnCours] = useState(false);
  const [query, setQuery] = useState("");
  const [lastSearched, setLastSearched] = useState("");
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [searched, setSearched] = useState(false);
  const [viewing, setViewing] = useState<PayslipListItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tab, setTab] = useState("search");
  const [me, setMe] = useState<SessionUser | null>(null);
  const listLoadedOnce = useRef(false);

  /** Charge l'utilisateur connecté ; renvoie vers /login si la session est absente/expirée. */
  const loadMe = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (res.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (res.ok) setMe((await res.json()).user);
    } catch {
      // silencieux
    }
  }, []);

  /** Charge les statistiques du tableau de bord. */
  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      if (res.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (res.ok) setStats(await res.json());
    } catch {
      // silencieux : les stats se rechargeront à la prochaine action
    }
  }, []);

  /** NOUVEAU (Task 99) : charge UNE page de la liste (100 fiches par page,
   * pagination côté serveur — la base peut compter 240 000 fiches). La page
   * demandée est automatiquement ramenée à la dernière existante si les
   * suppressions l'ont fait disparaître. */
  const refreshList = useCallback(async (page?: number) => {
    let cible = Math.max(1, page ?? listPageRef.current);
    setLoadingList(true);
    try {
      // Deux essais au maximum : le second ne sert qu'à la correction de
      // page (page demandée au-delà de la dernière après suppression).
      for (let essai = 0; essai < 2; essai++) {
        const res = await fetch(`/api/payslips?page=${cible}&limit=100`, {
          cache: "no-store",
        });
        if (res.status === 401) {
          window.location.replace("/login");
          return;
        }
        if (!res.ok) break;
        const data: PayslipListResponse = await res.json();
        if ((data.items?.length ?? 0) === 0 && data.total > 0 && cible > data.totalPages) {
          cible = Math.max(1, data.totalPages);
          continue;
        }
        setAllPayslips(data.items ?? []);
        setListMeta({ page: data.page, totalPages: data.totalPages, total: data.total });
        listPageRef.current = data.page;
        break;
      }
    } catch {
      // silencieux
    } finally {
      setLoadingList(false);
    }
  }, []);

  /** Recherche par CIN dans le contenu des fiches — EFFECTUÉE CÔTÉ SERVEUR
   * sur TOUTES les fiches (Task 99), paginée comme la liste (100 par page). */
  const runSearch = useCallback(async (q: string, page = 1) => {
    const trimmed = q.trim();
    if (trimmed.length < 3) return;
    setLoadingSearch(true);
    if (page === 1) setLastSearched(trimmed);
    try {
      const res = await fetch(
        `/api/payslips?cin=${encodeURIComponent(trimmed)}&page=${page}&limit=100`,
        {
          cache: "no-store",
        }
      );
      if (res.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (res.ok) {
        const data: PayslipListResponse = await res.json();
        setSearchResults(data.items ?? []);
        setSearchMeta({
          page: data.page,
          totalPages: data.totalPages,
          total: data.total,
        });
        setSearched(true);
        // (Task 99) transparence : combien de fiches restent à indexer.
        if (typeof data.indexation?.restants === "number")
          setIndexRestants(data.indexation.restants);
      } else {
        const err = await res.json().catch(() => ({}));
        setSearchResults([]);
        setSearchMeta({ page: 1, totalPages: 1, total: 0 });
        setSearched(true);
        console.warn("Recherche:", err.error);
      }
    } catch {
      setSearchResults([]);
      setSearchMeta({ page: 1, totalPages: 1, total: 0 });
      setSearched(true);
    } finally {
      // NOUVEAU (Task 17) : le champ de recherche est vidé après la recherche —
      // le CIN complet ne reste pas affiché à l'écran (le résultat masqué
      // utilise lastSearched, conservé en mémoire pour la ligne de résultat).
      setQuery("");
      setLoadingSearch(false);
    }
  }, []);

  /** NOUVEAU (Task 99) : état de l'indexation (fiches restant à indexer). */
  const refreshIndexation = useCallback(async () => {
    try {
      const res = await fetch("/api/payslips/indexation", { cache: "no-store" });
      if (res.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (res.ok) {
        const d = await res.json();
        setIndexRestants(typeof d.restants === "number" ? d.restants : 0);
      }
    } catch {
      // silencieux
    }
  }, []);

  /** NOUVEAU (Task 99) : lance l'indexation en enchaînant les lots serveur
   * (POST répétés) jusqu'à la fin — opération idempotente, sans arrêt de
   * service ; la barre affiche la progression en fiches restantes. */
  const lancerIndexation = useCallback(async () => {
    if (indexationEnCours) return;
    setIndexationEnCours(true);
    try {
      for (;;) {
        const res = await fetch("/api/payslips/indexation", { method: "POST" });
        if (res.status === 401) {
          window.location.replace("/login");
          return;
        }
        if (!res.ok) break;
        const d = await res.json();
        setIndexRestants(typeof d.restants === "number" ? d.restants : 0);
        if (d.termine) break;
      }
      refreshStats();
      refreshList();
    } catch {
      // silencieux — l'indexation reprendra au prochain lancement
    } finally {
      setIndexationEnCours(false);
    }
  }, [indexationEnCours, refreshStats, refreshList]);

  useEffect(() => {
    loadMe();
    refreshStats();
    refreshIndexation();
    refreshList(1).then(() => {
      listLoadedOnce.current = true;
    });
  }, [loadMe, refreshStats, refreshIndexation, refreshList]);

  /** Déconnexion : suppression de la session puis retour à la page de connexion. */
  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // même en cas d'erreur réseau, on tente la redirection
    }
    window.location.replace("/login");
  }

  const handleImported = () => {
    refreshStats();
    refreshList();
  };

  // NOUVEAU (Task 64) : après le changement forcé du mot de passe, on recharge
  // l'utilisateur — mustChangePassword repasse à false et l'application se rouvre.
  const handlePasswordChanged = () => {
    loadMe();
  };

  // NOUVEAU (Task 172, MODIFIÉ Task 173, MODIFIÉ Task 176) : GESTION DES
  // RÔLES ET PERMISSIONS — le rôle IT n'a accès qu'aux onglets « Paramètres »
  // (configuration du serveur mail SMTP — le tampon et la signature
  // électronique lui sont RETIRÉS) et « Utilisateurs » (CONSULTATION seule).
  // Les demandes administratives lui sont INTERDITES (403 serveur) : si
  // l'onglet courant lui est interdit, on le bascule automatiquement sur
  // « Paramètres ». Les onglets sont par ailleurs masqués ci-dessous et les
  // API répondent 403 côté serveur.
  useEffect(() => {
    if (
      me?.role === "IT" &&
      ["search", "all", "import", "portal", "demandes"].includes(tab)
    ) {
      setTab("parametres");
    }
  }, [me, tab]);

  const handleDeleted = () => {
    refreshStats();
    refreshList();
  };

  const openViewer = (p: PayslipListItem) => {
    setViewing(p);
    setDialogOpen(true);
  };

  // NOUVEAU (Task 64) : mot de passe expiré (politique 15 jours, TOUS les
  // comptes) → l'écran de changement OBLIGATOIRE remplace TOUTE l'application.
  // Aucune navigation possible ; côté serveur, les API de données répondent 403.
  if (me?.mustChangePassword) {
    return <ForceChangePassword onDone={handlePasswordChanged} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      {/* En-tête */}
      <header className="border-b bg-white">
        {/* MODIFIÉ (Task 123) : en-tête resserré sur mobile (padding, logo,
            largeur du nom) — même rendu inchangé à partir de sm. */}
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* MODIFIÉ (Task 115) : logo Trailmix fourni par l'utilisateur
                (logo Trailmix — orange/rose/violet). v0.2.199 : thème changé en blanc + vert émeraude ; logo en attente de remplacement. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-trailmix.png" alt="Logo AutoRH" className="h-8 sm:h-10 w-auto shrink-0" />
            <div className="min-w-0">
              {/* MODIFIÉ (Task 15) : nom « Auto-RH » retiré ; (v0.2.105) application renommée AutoRH */}
              <h1 className="font-bold text-base sm:text-lg leading-tight truncate">
                AutoRH
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground truncate">
                Fiches de paie, demandes administratives et documents RH
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4" />
              <span>Ressources Humaines</span>
            </div>
            {me && (
              <>
                <div className="flex items-center gap-2 rounded-full border bg-neutral-50 pl-2.5 pr-1 py-1">
                  <div className="min-w-0 text-right">
                    {/* MODIFIÉ (Task 123) : nom plus court sur mobile pour ne
                        plus écraser le titre de l'en-tête. */}
                    <p className="text-xs font-medium leading-tight truncate max-w-[96px] sm:max-w-[140px]">
                      {me.name}
                    </p>
                    <Badge
                      variant="outline"
                      className={
                        // (MODIFIÉ Task 34) 3 niveaux de rôle
                        me.role === "SUPERADMIN"
                          ? "h-4 px-1 text-[10px] border-amber-300 bg-amber-50 text-amber-700"
                          : me.role === "IT"
                            ? "h-4 px-1 text-[10px] border-sky-300 bg-sky-50 text-sky-700"
                            : "h-4 px-1 text-[10px] border-emerald-300 bg-emerald-50 text-emerald-700"
                      }
                    >
                      {me.role === "SUPERADMIN" ? "Superadministrateur" : me.role === "IT" ? "Informatique" : "RH"}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleLogout}
                    title="Se déconnecter"
                    className="h-8 w-8 p-0 rounded-full"
                  >
                    <LogOut className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* NOUVEAU (Task 99) : bandeau d'indexation — visible tant que des fiches
          créées avant la mise à jour restent à indexer pour la recherche
          rapide et la pagination légère.
          (MODIFIÉ Task 172) : masqué au rôle IT — la recherche par CIN ne lui
          est pas autorisée, l'indexation non plus. */}
      {(!me || me.role !== "IT") && indexRestants !== null && indexRestants > 0 && (
        <div className="border-b bg-amber-50">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
            <p className="text-xs sm:text-sm text-amber-900">
              <strong>{indexRestants.toLocaleString("fr-FR")}</strong> fiche(s) ne sont pas
              encore indexées pour la recherche rapide. L&apos;opération s&apos;exécute en
              arrière-plan, par lots, sans interrompre le service.
            </p>
            <Button
              size="sm"
              onClick={lancerIndexation}
              disabled={indexationEnCours}
              className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white"
            >
              {indexationEnCours ? (
                <>
                  <span className="h-3.5 w-3.5 mr-1.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  Indexation… {indexRestants.toLocaleString("fr-FR")} restant(s)
                </>
              ) : (
                <>Indexer la base pour la recherche</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Contenu */}
      <main className="flex-1 w-full mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8 space-y-8">
        {/* Statistiques — MODIFIÉ (Task 29) : la carte « Employés » est
            retirée de l'affichage à la demande de l'administrateur (l'API
            /api/stats continue de renvoyer le champ, sans effet ici). */}
        {/* MODIFIÉ (Task 79) : « CIN détectés » affiche désormais le nombre de
            CIN DISTINCTS détectés (un employé = un CIN, même s'il a plusieurs
            fiches) — ce compteur ne doit plus égaler « Fiches de paie » dès
            qu'un employé a plus d'une fiche (constat utilisateur 1557 =
            1557) ; le dédoublonnage est fait côté API /api/stats. */}
        <section aria-label="Statistiques" className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          <StatCard
            icon={<FileText className="h-5 w-5" />}
            label="Fiches de paie"
            value={stats ? String(stats.total) : "…"}
            sub="importées"
          />
          <StatCard
            icon={<IdCard className="h-5 w-5" />}
            label="CIN détectés"
            value={stats ? String(stats.withCin) : "…"}
            sub="CIN distincts dans le contenu"
            highlight
          />
          <StatCard
            icon={<CalendarClock className="h-5 w-5" />}
            label="Dernier import"
            value={
              stats?.lastUpload
                ? new Date(stats.lastUpload).toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "short",
                  })
                : stats
                  ? "—"
                  : "…"
            }
            sub={
              stats?.lastUpload
                ? new Date(stats.lastUpload).toLocaleTimeString("fr-FR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "aucun"
            }
          />
        </section>

        {/* Onglets */}
        <Tabs value={tab} onValueChange={setTab} className="space-y-6">
          {/* MODIFIÉ (Task 123) : BARRE D'ONGLETS RESPONSIVE MOBILE.
              Avant : grid-cols-5/6 imposé sur TOUTES les largeurs — sur un
              téléphone les libellés se chevauchaient et devenaient illisibles.
              Après : 3 colonnes sur mobile (2 rangées, icône au-dessus du
              libellé), grille classique 5/6 colonnes à partir de sm.
              100 % présentation — mêmes valeurs, mêmes onglets, aucun
              changement de comportement (Task 34 / Task 116 inchangées). */}
          {/* MODIFIÉ (Task 173, Task 176, Task 225) : GESTION DES RÔLES ET
              PERMISSIONS — SUPERADMIN : 7 onglets (tout) ; RH : 6 onglets
              (sans Utilisateurs) ; IT : 2 onglets TECHNIQUES (Paramètres —
              configuration du serveur mail SMTP et du module de signature —
              et Utilisateurs en consultation seule). Ni tampon/signature
              électronique (Task 176), ni Demandes, ni Recherche CIN, ni
              Toutes les fiches, ni Importer, ni Accès portail, conformément
              à la matrice. L'onglet « Signature » (Task 225) est réservé
              aux rôles RH et SUPERADMIN. */}
          <TabsList
            className={
              me?.role === "SUPERADMIN"
                ? "grid grid-cols-3 sm:grid-cols-7 w-full max-w-5xl mx-auto h-auto sm:h-11 p-1"
                : me?.role === "IT"
                  ? "grid grid-cols-2 w-full max-w-md mx-auto h-auto sm:h-11 p-1"
                  : "grid grid-cols-3 sm:grid-cols-6 w-full max-w-4xl mx-auto h-auto sm:h-11 p-1"
            }
          >
            {/* MODIFIÉ (Task 172) : onglets réservés aux rôles RH/SUPERADMIN
                (masqués au rôle IT — garde serveur en doublon sur les API). */}
            {me?.role !== "IT" && (
              <>
                <TabsTrigger value="search" className="flex flex-col sm:flex-row items-center gap-1 sm:gap-1.5 px-1 sm:px-3 py-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                  <Search className="h-4 w-4" />
                  <span className="text-[11px] sm:text-sm leading-tight text-center">Recherche CIN</span>
                </TabsTrigger>
                <TabsTrigger value="all" className="flex flex-col sm:flex-row items-center gap-1 sm:gap-1.5 px-1 sm:px-3 py-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                  <LayoutList className="h-4 w-4" />
                  <span className="text-[11px] sm:text-sm leading-tight text-center">Toutes les fiches</span>
                </TabsTrigger>
                <TabsTrigger value="import" className="flex flex-col sm:flex-row items-center gap-1 sm:gap-1.5 px-1 sm:px-3 py-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                  <UploadCloud className="h-4 w-4" />
                  <span className="text-[11px] sm:text-sm leading-tight text-center">Importer</span>
                </TabsTrigger>
                <TabsTrigger value="portal" className="flex flex-col sm:flex-row items-center gap-1 sm:gap-1.5 px-1 sm:px-3 py-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                  <Smartphone className="h-4 w-4" />
                  <span className="text-[11px] sm:text-sm leading-tight text-center">Accès portail</span>
                </TabsTrigger>
              </>
            )}
            {/* NOUVEAU (Task 116, MODIFIÉ Task 173) : demandes administratives
                des employés — RH et SUPERADMIN uniquement (l'IT ne doit NI
                voir NI accéder aux demandes). */}
            {me?.role !== "IT" && (
              <TabsTrigger value="demandes" className="flex flex-col sm:flex-row items-center gap-1 sm:gap-1.5 px-1 sm:px-3 py-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                <ClipboardList className="h-4 w-4" />
                <span className="text-[11px] sm:text-sm leading-tight text-center">Demandes</span>
              </TabsTrigger>
            )}
            {/* NOUVEAU (Task 225) : onglet « Signature » — signature
                électronique de TOUS les documents importés avec le certificat
                chargé (RH + SUPERADMIN ; l'IT gère le certificat via
                Paramètres mais ne signe pas — matrice des rôles). */}
            {me?.role !== "IT" && (
              <TabsTrigger value="signature" className="flex flex-col sm:flex-row items-center gap-1 sm:gap-1.5 px-1 sm:px-3 py-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                <FileSignature className="h-4 w-4" />
                <span className="text-[11px] sm:text-sm leading-tight text-center">Signature</span>
              </TabsTrigger>
            )}
            {/* NOUVEAU (Task 173, MODIFIÉ Task 176) : onglet « Paramètres »
                du rôle IT — configuration du serveur mail (SMTP) seule ;
                le tampon et la signature électronique lui sont retirés. */}
            {me?.role === "IT" && (
              <TabsTrigger value="parametres" className="flex flex-col sm:flex-row items-center gap-1 sm:gap-1.5 px-1 sm:px-3 py-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                <Settings className="h-4 w-4" />
                <span className="text-[11px] sm:text-sm leading-tight text-center">Paramètres</span>
              </TabsTrigger>
            )}
            {(me?.role === "IT" || me?.role === "SUPERADMIN") && (
              <TabsTrigger value="users" className="flex flex-col sm:flex-row items-center gap-1 sm:gap-1.5 px-1 sm:px-3 py-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                <Users2 className="h-4 w-4" />
                <span className="text-[11px] sm:text-sm leading-tight text-center">Utilisateurs</span>
              </TabsTrigger>
            )}
          </TabsList>

          {/* MODIFIÉ (Task 172) : contenus des onglets fiches/import/portail
              réservés aux rôles RH et SUPERADMIN (l'IT n'y accède ni en
              interface ni en API). */}
          {me?.role !== "IT" && (
            <>
              <TabsContent value="search" className="mt-2">
                <SearchTab
                  query={query}
                  setQuery={setQuery}
                  onSearch={runSearch}
                  onSearchChange={setQuery}
                  loading={loadingSearch}
                  searched={searched}
                  results={searchResults}
                  onView={openViewer}
                  lastSearched={lastSearched}
                  /* NOUVEAU (Task 99) : pagination serveur des résultats. */
                  meta={searchMeta}
                  onPageChange={(p) => {
                    if (lastSearched) runSearch(lastSearched, p);
                  }}
                />
              </TabsContent>

              <TabsContent value="all" className="mt-2">
                <AllTab
                  payslips={allPayslips}
                  loading={loadingList}
                  onView={openViewer}
                  onDeleted={handleDeleted}
                  /* NOUVEAU (Task 99) : pagination serveur + recherche CIN
                     serveur (toutes les fiches) depuis l'onglet liste. */
                  meta={listMeta}
                  onPageChange={(p) => refreshList(p)}
                  onServerSearch={(q) => {
                    setTab("search");
                    runSearch(q);
                  }}
                />
              </TabsContent>

              <TabsContent value="import" className="mt-2 space-y-4">
                <ImportTab onImported={handleImported} />
                {/* NOUVEAU (Task 118) : rubrique « Signature électronique & QR code »
                    de la section Importation (configuration du tampon automatique
                    apposé sur chaque fiche après l'import).
                    MODIFIÉ (Task 119 / v0.2.41) : accessible AUSSI au rôle RH —
                    SUPERADMIN et RH gèrent le tampon.
                    MODIFIÉ (Task 172) : le rôle IT n'a plus l'onglet Importer
                    (ni le tampon) — droits limités aux fonctionnalités IT. */}
                {/* (v0.2.194) Rôle RH : le bloc d'IMPORT du fichier de signature
                    (certificat) du panneau « Signature électronique & QR code » est
                    MASQUÉ — matériel cryptographique réservé au superadministrateur. */}
                {(me?.role === "SUPERADMIN" || me?.role === "RH") && (
                  <SignaturePanel masquerCertificat={me?.role === "RH"} />
                )}
              </TabsContent>

              {/* NOUVEAU (Task 18) : accès au portail par CIN + OTP authenticator */}
              <TabsContent value="portal" className="mt-2">
                {/* (Task 13) meRole : la configuration SMTP n'est rendue que
                    pour SUPERADMIN — le RH n'utilise que l'envoi d'e-mails.
                    (MODIFIÉ Task 172) : l'IT n'a plus du tout cet onglet.
                    (MODIFIÉ Task 173) : la configuration SMTP de l'IT a
                    déménagé dans son onglet « Paramètres ». */}
                <PortalAccessTab meRole={me?.role ?? "RH"} />
              </TabsContent>
            </>
          )}

          {/* NOUVEAU (Task 116, MODIFIÉ Task 173) : demandes administratives
              — contenu réservé aux rôles RH et SUPERADMIN (garde interface
              en doublon du 403 serveur). */}
          {me?.role !== "IT" && (
            <TabsContent value="demandes" className="mt-2">
              <DemandesTab role={me?.role ?? "RH"} />
            </TabsContent>
          )}

          {/* NOUVEAU (Task 225) : onglet « Signature » — signature
              électronique générique de tous les documents importés avec le
              certificat chargé (RH + SUPERADMIN ; garde interface en doublon
              du 403 serveur). */}
          {me?.role !== "IT" && (
            <TabsContent value="signature" className="mt-2">
              <SignatureDocumentsPanel />
            </TabsContent>
          )}

          {/* NOUVEAU (Task 173, MODIFIÉ Task 176) : onglet « Paramètres » du
              rôle IT — SA fonctionnalité technique autorisée : la
              configuration du serveur mail (SMTP, consultation +
              modification). Le tampon et la signature électronique sont
              réservés aux rôles RH et superadministrateur (403 serveur). */}
          {me?.role === "IT" && (
            <TabsContent value="parametres" className="mt-2 space-y-4">
              <Card className="border-sky-200 bg-sky-50/60 shadow-sm">
                <CardContent className="p-4">
                  <p className="text-sm text-sky-900">
                    <strong>Paramètres techniques (rôle IT)</strong> — vos droits sont limités à la
                    configuration du serveur mail (SMTP). La configuration du tampon et de la
                    signature électronique est réservée aux rôles RH et superadministrateur. La
                    liste des utilisateurs est disponible en consultation seule dans l&apos;onglet
                    « Utilisateurs ».
                  </p>
                </CardContent>
              </Card>
              <MailPanel />
              {/* NOUVEAU (Task 224) : API de certification & signature
                  électronique — configuration complète du module de signature
                  cryptographique des documents (certificat local PAdES ou API
                  externe, environnement TEST/PRODUCTION, registre des
                  documents signés conservés + vérification). */}
              <SignatureApiPanel />
            </TabsContent>
          )}

          {(me?.role === "IT" || me?.role === "SUPERADMIN") && (
            <TabsContent value="users" className="mt-2">
              <UsersTab meId={me.id} meRole={me.role} />
            </TabsContent>
          )}
        </Tabs>
      </main>

      {/* Pied de page collé en bas */}
      <footer className="mt-auto border-t bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>
            Gestion et recherche des fiches de paie par CIN (contenu des PDF)
          </p>
          <button
            onClick={() => {
              refreshStats();
              refreshIndexation();
              refreshList();
            }}
            className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Actualiser les données
          </button>
        </div>
      </footer>

      {/* Visionneuse PDF */}
      <PdfDialog
        payslip={viewing}
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setViewing(null);
        }}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <Card className={`${highlight ? "border-emerald-200 bg-emerald-50/60" : ""} shadow-sm`}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className={highlight ? "text-emerald-600" : ""}>{icon}</span>
          <p className="text-xs sm:text-sm font-medium truncate">{label}</p>
        </div>
        <p className="text-2xl sm:text-3xl font-bold mt-2 tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}
