"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LogIn, AlertCircle } from "lucide-react";

/**
 * Page de connexion — accès réservé aux utilisateurs autorisés (RH / Informatique).
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // Déjà connecté ? Retour au site.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => {
        if (res.ok && !cancelled) {
          window.location.replace("/");
          return null;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        window.location.replace("/");
        return;
      }
      setError(data.error ?? "Connexion impossible. Réessayez.");
    } catch {
      setError("Erreur réseau. Vérifiez que le serveur est démarré.");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <p className="text-sm text-muted-foreground">Vérification de la session…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-md space-y-6">
        {/* MODIFIÉ (Task 115) : logo Trailmix fourni par l'utilisateur
            (logo AutoRH fourni par l'utilisateur — vert émeraude + blanc). */}
        <div className="flex items-center justify-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-trailmix.png" alt="Logo AutoRH" className="h-12 w-auto" />
          <div>
            <h1 className="font-bold text-xl leading-tight">AutoRH</h1>
            <p className="text-xs text-muted-foreground">Fiches de paie et demandes administratives</p>
          </div>
        </div>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Connexion</CardTitle>
            <CardDescription>
              Accès réservé aux utilisateurs autorisés : service RH et service informatique.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4" autoComplete="off">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email professionnel</Label>
                <Input
                  id="email"
                  type="email"
                  // (Task 37) aucun historique de saisie sur l'email
                  autoComplete="off"
                  placeholder="prenom.nom@entreprise.tn"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Mot de passe</Label>
                <Input
                  id="password"
                  type="password"
                  // (MODIFIÉ Task 66) "current-password" : ce champ est une
                  // CONNEXION (mot de passe DÉJÀ connu) — le navigateur doit
                  // PROPOSER le mot de passe enregistré, PAS en générer un
                  // nouveau ("new-password" pré-remplissait le champ avec un
                  // mot de passe FAUX : « champ de mot de passe mauvais »)
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="remember"
                  checked={remember}
                  onCheckedChange={(v) => setRemember(v === true)}
                />
                <Label htmlFor="remember" className="text-sm font-normal cursor-pointer">
                  Se souvenir de moi pendant 30 jours
                </Label>
              </div>

              <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={loading}>
                <LogIn className="h-4 w-4" />
                {loading ? "Connexion…" : "Se connecter"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* MODIFIÉ (Task 173) : la création de compte par code d'activation
            est SUPPRIMÉE (demande utilisateur). Les comptes RH/IT sont créés
            exclusivement par le superadministrateur depuis l'onglet
            « Utilisateurs » de l'administration. */}

        {/* Task 150 : le bloc « Téléchargements » (Tasks 148-149) a été RETIRÉ
            à la demande de l'utilisateur. Les routes /api/download-* restent
            disponibles directement par URL pour ceux qui en ont besoin. */}

        {/* (RETIRÉ À NOUVEAU Task 223 — v0.2.113) Le bloc « Téléchargements
            directs » rétabli en Task 218-219 est SUPPRIMÉ à la demande de
            l'utilisateur : la page de connexion ne présente plus AUCUN bloc
            de téléchargement (retour à l'état Task 150). Les 5 routes
            /api/download-* (archive zip, readme, formation, matrice,
            routage) restent disponibles directement par URL. */}
      </div>
    </div>
  );
}
