#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 212 — v0.2.105 : NOTIFICATIONS EMPLOYÉ SANS RÉPONSE + RENOMMAGE « ServiceRH »

Applique de façon DÉTERMINISTE (avec assertions) les modifications v0.2.105 :
  A) Les e-mails envoyés à l'EMPLOYÉ (statut / document disponible / confirmation
     demandeur / décision N+1) deviennent des NOTIFICATIONS PURES : mention
     explicite « NE PAS répondre » (texte + HTML).
  B) Renommage visible de l'application Service RH/Service RH → ServiceRH
     (interfaces, e-mails, tampon, TOTP, métadonnées fichiers, routes download).

PRÉSERVÉS (identifiants techniques — NE JAMAIS RENOMMER) :
  PAIESAGE1 (en-tête chiffrement), paiesage-storage-v1 / service-rh-db-* / sels,
  variables SERVICE_RH_*, dossiers storage/, modèles BD, routes API, sels HMAC.
"""

import sys

BASE = "/home/z/my-project/"

erreurs = []
ok = 0


def remplace(chemin, ancien, nouveau, attendu=1):
    """Remplace ancien→nouveau (attendu occurrences) ; échoue fort sinon."""
    global ok
    p = BASE + chemin
    with open(p, "r", encoding="utf-8") as f:
        t = f.read()
    n = t.count(ancien)
    if n != attendu:
        erreurs.append(f"[{chemin}] attendu {attendu} occurrence(s), trouvé {n} : {ancien[:70]!r}")
        return
    t = t.replace(ancien, nouveau)
    with open(p, "w", encoding="utf-8") as f:
        f.write(t)
    ok += 1


def remplace_tout(chemin, ancien, nouveau, attendu):
    remplace(chemin, ancien, nouveau, attendu)


# ============================================================================
# A + B) src/lib/mailer.ts — renommage + notices « NE PAS répondre »
# ============================================================================
remplace("src/lib/mailer.ts",
         "    return `Service RH <${cfg.username}>`;\n  }\n  return \"Service RH\";",
         "    return `ServiceRH <${cfg.username}>`;\n  }\n  return \"ServiceRH\";")
remplace("src/lib/mailer.ts",
         "    \"Voici vos identifiants d'accès au portail des fiches de paie.\",",
         "    \"Voici vos identifiants d'accès à votre portail ServiceRH.\",")
remplace("src/lib/mailer.ts",
         "     chiffres et symboles (exemple : PaieSage2026!).",
         "     chiffres et symboles (exemple : ServiceRH2026!).")
remplace("src/lib/mailer.ts",
         "    \"Cet e-mail a été envoyé par le service RH/Informatique via Service RH.\",",
         "    \"Cet e-mail a été envoyé par le service RH/Informatique via ServiceRH.\",")
remplace("src/lib/mailer.ts",
         "Accès au portail des fiches de paie</div>",
         "Accès à votre portail ServiceRH</div>")
remplace("src/lib/mailer.ts",
         "Vos identifiants personnels — Service RH</div>",
         "Vos identifiants personnels — ServiceRH</div>")
remplace("src/lib/mailer.ts",
         "Voici vos identifiants d'accès au portail de consultation de vos fiches de paie :</p>",
         "Voici vos identifiants d'accès à votre portail ServiceRH (fiches de paie, demandes administratives, documents) :</p>")
remplace("src/lib/mailer.ts",
         "(exemple&nbsp;: PaieSage2026!)",
         "(exemple&nbsp;: ServiceRH2026!)")
remplace("src/lib/mailer.ts",
         "E-mail envoyé par le service RH/Informatique via Service RH.",
         "E-mail envoyé par le service RH/Informatique via ServiceRH.")
remplace("src/lib/mailer.ts",
         "subject: \"Vos accès au portail des fiches de paie (mot de passe initial)\",",
         "subject: \"Vos accès au portail ServiceRH (mot de passe initial)\",")
remplace("src/lib/mailer.ts",
         "subject: \"Service RH — e-mail de test du serveur SMTP\",",
         "subject: \"ServiceRH — e-mail de test du serveur SMTP\",")
remplace("src/lib/mailer.ts",
         "E-mail de test — Service RH</p>'",
         "E-mail de test — ServiceRH</p>'")

# --- texteEmailDemande : notice sur la branche EMPLOYÉ uniquement ---
remplace("src/lib/mailer.ts",
'''/** Version texte brut — création OU changement de statut. */
export function texteEmailDemande(d: DonneesEmailDemande, changementStatut: boolean): string {
  const intro = changementStatut
    ? `Le statut de votre demande administrative a été mis à jour.`
    : `Une nouvelle demande administrative nécessite votre traitement.`;
  const lignes = d.infos.map(([l, v]) => `  ${l.padEnd(26, " ")}: ${v}`).join("\\n");
  return [
    "Bonjour,",
    "",
    intro,
    "",''',
'''/**
 * Version texte brut — création OU changement de statut.
 * (MODIFIÉ v0.2.105 — demande utilisateur) les e-mails envoyés à l'EMPLOYÉ
 * (statut / document disponible) sont des NOTIFICATIONS PURES : mention
 * explicite « NE PAS répondre », renvoi au portail, contact RH pour toute
 * question. La branche CRÉATION (RH / N+1 / responsable) est inchangée : la
 * réponse par e-mail du traitant reste un parcours supporté (Task 122).
 */
export function texteEmailDemande(d: DonneesEmailDemande, changementStatut: boolean): string {
  const intro = changementStatut
    ? `Le statut de votre demande administrative a été mis à jour.`
    : `Une nouvelle demande administrative nécessite votre traitement.`;
  const lignes = d.infos.map(([l, v]) => `  ${l.padEnd(26, " ")}: ${v}`).join("\\n");
  return [
    "Bonjour,",
    "",
    intro,
    ...(changementStatut
      ? [
          "",
          "NOTIFICATION AUTOMATIQUE — merci de NE PAS répondre à cet e-mail :",
          "les réponses envoyées à cette adresse ne sont pas lues.",
        ]
      : []),
    "",''')

remplace("src/lib/mailer.ts",
'''    "",
    changementStatut
      ? "Vous pouvez consulter le détail de vos demandes à tout moment dans la"
      : "Merci de traiter cette demande. L'employé suit son avancement dans son",
    changementStatut
      ? "section « Demandes administratives » du portail employé."
      : "section « Demandes administratives » du portail employé.",
    "",
    "Cet e-mail a été envoyé automatiquement par Service RH. Si vous n'êtes pas",
    "le destinataire prévu, ignorez et supprimez ce message.",
  ].join("\\n");''',
'''    "",
    ...(changementStatut
      ? [
          "Le détail de votre demande (et les documents reçus) est consultable à",
          "tout moment dans la section « Demandes administratives » de votre",
          "portail employé. Pour toute question, contactez le service RH.",
        ]
      : [
          "Merci de traiter cette demande. L'employé suit son avancement dans son",
          "section « Demandes administratives » du portail employé.",
        ]),
    "",
    ...(changementStatut
      ? ["E-mail automatique ServiceRH — notification SANS réponse."]
      : [
          "Cet e-mail a été envoyé automatiquement par ServiceRH. Si vous n'êtes pas",
          "le destinataire prévu, ignorez et supprimez ce message.",
        ]),
  ].join("\\n");''')

# --- htmlEmailDemande : encadré notice + titre « Notification » + pied ---
remplace("src/lib/mailer.ts",
'''/** Version HTML — création OU changement de statut. */
export function htmlEmailDemande(d: DonneesEmailDemande, changementStatut: boolean): string {
  const accent = changementStatut ? couleurStatut(d.statutLabel) : "#059669";
  const intro = changementStatut
    ? "Le statut de votre demande administrative a été mis à jour."
    : "Une nouvelle demande administrative nécessite votre traitement.";
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
  <div style="background:${accent};padding:18px 22px;color:#fff;">
    <div style="font-size:18px;font-weight:700;">${changementStatut ? "Suivi de votre demande" : "Demande administrative"} — ${echappe(d.typeLibelle)}</div>
    <div style="font-size:12px;opacity:.85;margin-top:4px;">Référence ${echappe(d.reference)} — Service RH</div>
  </div>
  <div style="padding:20px 22px;color:#334155;font-size:14px;">
    <p style="margin:0 0 14px;">${intro}</p>''',
'''/** Version HTML — création OU changement de statut (v0.2.105 : encadré
 *  « notification sans réponse » sur la branche employé, même règle que le
 *  texte brut). */
export function htmlEmailDemande(d: DonneesEmailDemande, changementStatut: boolean): string {
  const accent = changementStatut ? couleurStatut(d.statutLabel) : "#059669";
  const intro = changementStatut
    ? "Le statut de votre demande administrative a été mis à jour."
    : "Une nouvelle demande administrative nécessite votre traitement.";
  const noticeSansReponse = changementStatut
    ? '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:14px;color:#1e40af;font-size:13px;">' +
      '<b>Notification automatique</b> — merci de <b>ne pas répondre</b> à cet e-mail : les réponses envoyées à cette adresse ne sont pas lues. Le suivi de votre demande se fait dans votre portail employé.</div>'
    : "";
  const pied = changementStatut
    ? 'E-mail automatique ServiceRH (notification SANS réponse). Pour toute question, contactez le service RH.'
    : "E-mail envoyé automatiquement par ServiceRH. Si vous n'êtes pas le destinataire prévu, ignorez et supprimez ce message.";
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
  <div style="background:${accent};padding:18px 22px;color:#fff;">
    <div style="font-size:18px;font-weight:700;">${changementStatut ? "Notification — Suivi de votre demande" : "Demande administrative"} — ${echappe(d.typeLibelle)}</div>
    <div style="font-size:12px;opacity:.85;margin-top:4px;">Référence ${echappe(d.reference)} — ServiceRH</div>
  </div>
  <div style="padding:20px 22px;color:#334155;font-size:14px;">
    <p style="margin:0 0 14px;">${intro}</p>
    ${noticeSansReponse}''')

remplace("src/lib/mailer.ts",
'''    <p style="margin:0;color:#94a3b8;font-size:12px;">E-mail envoyé automatiquement par Service RH. Si vous n'êtes pas le destinataire prévu, ignorez et supprimez ce message.</p>
  </div>
</div>`;
}

/**
 * Envoie la NOTIFICATION DE CHANGEMENT DE STATUT à l'employé''',
'''    <p style="margin:0;color:#94a3b8;font-size:12px;">${pied}</p>
  </div>
</div>`;
}

/**
 * Envoie la NOTIFICATION DE CHANGEMENT DE STATUT à l'employé''')

remplace("src/lib/mailer.ts",
         "subject: `Service RH — Demande ${d.reference} : ${d.statutLabel} (${d.typeLibelle})`,",
         "subject: `ServiceRH — Demande ${d.reference} : ${d.statutLabel} (${d.typeLibelle})`,")
remplace("src/lib/mailer.ts",
         "subject: `Service RH — Demande ${d.reference} : votre document est disponible (${d.typeLibelle})`,",
         "subject: `ServiceRH — Demande ${d.reference} : votre document est disponible (${d.typeLibelle})`,")

# ============================================================================
# B) src — tampon, signature, splitters, TOTP, vérification, commentaires
# ============================================================================
remplace("src/lib/stamp.ts", '"Service RH — Fiche de paie",', '"ServiceRH — Fiche de paie",')
remplace("src/lib/stamp.ts", 'titre: "Service RH — Document officiel",', 'titre: "ServiceRH — Document officiel",')
remplace("src/lib/signature-reponse.ts",
         'mentionTexte: "Document signé électroniquement — Service RH — {DATE}",',
         'mentionTexte: "Document signé électroniquement — ServiceRH — {DATE}",')
remplace("src/app/api/demandes/[id]/repondre/route.ts",
         'mentionActif: true, mentionTexte: "Document signé électroniquement — Service RH — {DATE}",',
         'mentionActif: true, mentionTexte: "Document signé électroniquement — ServiceRH — {DATE}",')
remplace("src/app/api/demandes/[id]/repondre/route.ts",
         'titre: "Service RH — Document officiel",',
         'titre: "ServiceRH — Document officiel",')
remplace("src/app/api/portal-access/route.ts",
''' * « Service RH:Fiche de paie » (MODIFIÉ Task 88 : l'Account Name affiché par
 * l'application d'authentification est « Fiche de paie », PLUS le CIN),''',
''' * « ServiceRH:Espace employé » (MODIFIÉ Task 88 puis v0.2.105 — renommage :
 * l'Account Name affiché par l'application d'authentification est
 * « Espace employé », PLUS le CIN),''')
remplace("src/app/api/portal-access/route.ts",
         'const label = encodeURIComponent("Service RH:Fiche de paie");',
         'const label = encodeURIComponent("ServiceRH:Espace employé");')
remplace("src/app/api/portal-access/route.ts",
         '"&issuer=Service RH&algorithm=SHA1&digits=6&period=30"',
         '"&issuer=ServiceRH&algorithm=SHA1&digits=6&period=30"')
remplace_tout("src/app/verification/fiche/[id]/page.tsx", "Service RH", "ServiceRH", 5)
remplace_tout("src/app/verification/reponse/[reference]/page.tsx", "Service RH", "ServiceRH", 5)
remplace_tout("src/components/payslip/signature-panel.tsx", "Service RH", "ServiceRH", 4)
remplace_tout("src/components/payslip/signature-panel-reponses.tsx", "Service RH", "ServiceRH", 4)
remplace_tout("src/components/payslip/demandes-tab.tsx", "Service RH", "ServiceRH", 2)
remplace("src/components/payslip/mail-panel.tsx",
         'placeholder="support@mail.com ou Service RH &lt;expediteur@mondomaine.com&gt;"',
         'placeholder="support@mail.com ou ServiceRH &lt;expediteur@mondomaine.com&gt;"')
remplace("src/components/payslip/colonnes-redimensionnables.tsx",
         '// orange Service RH', '// orange ServiceRH')
remplace_tout("src/lib/excel-splitter.ts", '"Service RH"', '"ServiceRH"', 4)
remplace_tout("src/lib/pdf-splitter.ts", '"Service RH"', '"ServiceRH"', 4)

# --- commentaires d'en-tête (cohérence) ---
remplace("src/lib/image-validate.ts",
         " *  Service RH — Validation STRUCTURELLE des fiches image",
         " *  ServiceRH — Validation STRUCTURELLE des fiches image")
remplace("src/lib/storage-dir.ts",
         " *  Service RH — Résolution ROBUSTE du dossier des PDF importés",
         " *  ServiceRH — Résolution ROBUSTE du dossier des PDF importés")
remplace("src/lib/storage-crypto.ts",
         " *  Service RH — Chiffrement AES-256-GCM du stockage des fiches",
         " *  ServiceRH — Chiffrement AES-256-GCM du stockage des fiches")
remplace("src/lib/auth.ts",
         " * Authentification Service RH — accès réservé aux utilisateurs autorisés (RH / IT).",
         " * Authentification ServiceRH — accès réservé aux utilisateurs autorisés (RH / IT).")
remplace("src/middleware.ts",
         " * Middleware Service RH — aucune page ni API accessible sans session.",
         " * Middleware ServiceRH — aucune page ni API accessible sans session.")

# --- interfaces admin : page, layout, login ---
remplace("src/app/page.tsx",
'''            <img src="/logo-trailmix.png" alt="Logo Fiches de Paie" className="h-8 sm:h-10 w-auto shrink-0" />
            <div className="min-w-0">
              {/* MODIFIÉ (Task 15) : nom « Service RH » retiré */}
              <h1 className="font-bold text-base sm:text-lg leading-tight truncate">
                Fiches de Paie
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground truncate">
                Recherche par CIN dans le contenu des bulletins importés de Sage
              </p>''',
'''            <img src="/logo-trailmix.png" alt="Logo ServiceRH" className="h-8 sm:h-10 w-auto shrink-0" />
            <div className="min-w-0">
              {/* MODIFIÉ (Task 15) : nom « Service RH » retiré ; (v0.2.105) application renommée ServiceRH */}
              <h1 className="font-bold text-base sm:text-lg leading-tight truncate">
                ServiceRH
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground truncate">
                Fiches de paie, demandes administratives et documents RH
              </p>''')
remplace("src/app/page.tsx", "<span>Gestion de la paie</span>", "<span>Ressources Humaines</span>")
remplace("src/app/layout.tsx",
'''  // MODIFIÉ (Task 15) : nom « Service RH » retiré à la demande de l'utilisateur
  // (affichage « Fiches de Paie » uniquement). Aucun autre réglage modifié.
  title: "Fiches de Paie | Recherche par CIN",
  description:
    "Importez les fiches de paie exportées depuis Sage et recherchez n'importe quel bulletin par numéro de CIN directement dans le contenu des PDF.",
  keywords: ["fiche de paie", "Sage", "paie", "CIN", "recherche", "bulletin de paie"],''',
'''  // MODIFIÉ (Task 15) : nom « Service RH » retiré ; (v0.2.105) renommage ServiceRH
  // (l'application couvre fiches de paie ET demandes administratives).
  title: "ServiceRH | Fiches de paie et demandes RH",
  description:
    "Portail RH ServiceRH : importez et consultez les fiches de paie par CIN, suivez les demandes administratives (congés, autorisations, attestations, parrainage) et les documents signés.",
  keywords: ["ServiceRH", "fiche de paie", "Sage", "paie", "CIN", "recherche", "bulletin de paie", "demandes RH", "congé", "attestation"],''')
remplace("src/app/login/page.tsx",
'''          <img src="/logo-trailmix.png" alt="Logo Fiches de Paie" className="h-12 w-auto" />
          <div>
            <h1 className="font-bold text-xl leading-tight">Fiches de Paie</h1>
            <p className="text-xs text-muted-foreground">Fiches de paie — Recherche par CIN</p>
          </div>''',
'''          <img src="/logo-trailmix.png" alt="Logo ServiceRH" className="h-12 w-auto" />
          <div>
            <h1 className="font-bold text-xl leading-tight">ServiceRH</h1>
            <p className="text-xs text-muted-foreground">Fiches de paie et demandes administratives</p>
          </div>''')

# ============================================================================
# A + B) scripts/portail-server.js — notices employé + renommage
# ============================================================================
remplace("scripts/portail-server.js",
''' *     Désormais le QR encode l'URI STANDARD (spec « Key URI Format » — label
 *     Service RH:"Fiche de paie" (MODIFIÉ Task 88 : l'Account Name affiché par
 *     l'application d'authentification est « Fiche de paie », PLUS le CIN —
 *     le numéro national ne figure plus sur l'écran du téléphone), secret''',
''' *     Désormais le QR encode l'URI STANDARD (spec « Key URI Format » — label
 *     "ServiceRH:Espace employé" (MODIFIÉ Task 88 puis v0.2.105 : l'Account
 *     Name affiché par l'application d'authentification est
 *     « Espace employé », PLUS le CIN — le numéro national ne figure plus
 *     sur l'écran du téléphone), secret''')
remplace("scripts/portail-server.js",
''' *  (MODIFIÉ Task 88) le LABEL de l'URI est « Service RH:Fiche de paie » —
 *  demande utilisateur : dans l'application Authenticator, le champ
 *  « Account Name » doit afficher « Fiche de paie » AU LIEU du CIN. Le
 *  label ne participe PAS au calcul TOTP (seul le secret compte) : les
 *  comptes déjà associés continuent de générer des codes valables. */
function contenuQrOtp(defi) {
  // (MODIFIÉ Task 88) Account Name = « Fiche de paie » (PLUS le CIN) :
  // l'application d'authentification affiche « Fiche de paie » avec
  // l'émetteur Service RH ; le CIN n'apparaît plus sur l'écran du téléphone.
  const label = encodeURIComponent("Service RH:Fiche de paie");''',
''' *  (MODIFIÉ Task 88, puis v0.2.105 — renommage ServiceRH) le LABEL de l'URI
 *  est « ServiceRH:Espace employé » — dans l'application Authenticator, le
 *  champ « Account Name » affiche « Espace employé » AU LIEU du CIN. Le
 *  label ne participe PAS au calcul TOTP (seul le secret compte) : les
 *  comptes déjà associés continuent de générer des codes valables. */
function contenuQrOtp(defi) {
  // (MODIFIÉ Task 88, v0.2.105) Account Name = « Espace employé » (PLUS le
  // CIN) : l'application d'authentification affiche « Espace employé » avec
  // l'émetteur ServiceRH ; le CIN n'apparaît plus sur l'écran du téléphone.
  const label = encodeURIComponent("ServiceRH:Espace employé");''')
remplace("scripts/portail-server.js",
         '"&issuer=Service RH&algorithm=SHA1&digits=6&period=30"',
         '"&issuer=ServiceRH&algorithm=SHA1&digits=6&period=30"')
remplace("scripts/portail-server.js",
'''    return "Service RH <" + cfg.username + ">";
  }
  return "Service RH";''',
'''    return "ServiceRH <" + cfg.username + ">";
  }
  return "ServiceRH";''')
remplace("scripts/portail-server.js",
         '    "Service RH — Fiche de paie",',
         '    "ServiceRH — Fiche de paie",')
remplace("scripts/portail-server.js",
         "show(\"info\", \"Connexion réussie — ouverture de vos fiches de paie…\");",
         "show(\"info\", \"Connexion réussie — ouverture de votre portail…\");")
remplace("scripts/portail-server.js",
         "show(\"info\", \"Mot de passe enregistré — ouverture de vos fiches de paie…\");",
         "show(\"info\", \"Mot de passe enregistré — ouverture de votre portail…\");")
remplace("scripts/portail-server.js",
         "Pour protéger vos fiches de paie, vous devez maintenant choisir",
         "Pour protéger votre accès, vous devez maintenant choisir")
remplace("scripts/portail-server.js",
         "Portail Employés — consultation des fiches de paie par numéro CIN<br>",
         "Portail employés ServiceRH — fiches de paie et demandes administratives<br>")
remplace_tout("scripts/portail-server.js",
              "Fiches de Paie — Portail Employés", "ServiceRH — Portail Employés", 11)
remplace_tout("scripts/portail-server.js",
              '<span class="brand">Fiches de Paie<small>',
              '<span class="brand">ServiceRH<small>', 5)

# --- e-mail de CRÉATION (destinataire RH/N+1 — renommage seul, PAS de notice) ---
remplace("scripts/portail-server.js",
         "    \"Cet e-mail a été envoyé automatiquement par Service RH. Si vous n'êtes pas\",",
         "    \"Cet e-mail a été envoyé automatiquement par ServiceRH. Si vous n'êtes pas\",")
remplace("scripts/portail-server.js",
         "'Référence ' + echappeEmailDemande(d.reference) + \" — Service RH</div>\" +",
         "'Référence ' + echappeEmailDemande(d.reference) + \" — ServiceRH</div>\" +")
remplace("scripts/portail-server.js",
         "'<p style=\"margin:0;color:#94a3b8;font-size:12px;\">E-mail envoyé automatiquement par Service RH. Si vous n\\'êtes pas le destinataire prévu, ignorez et supprimez ce message.</p>' +\n    \"</div></div>\";",
         "'<p style=\"margin:0;color:#94a3b8;font-size:12px;\">E-mail envoyé automatiquement par ServiceRH. Si vous n\\'êtes pas le destinataire prévu, ignorez et supprimez ce message.</p>' +\n    \"</div></div>\";")
remplace("scripts/portail-server.js",
         'subject: "Service RH — " + contenu.typeLibelle + " " + contenu.reference + " (traitement requis)",',
         'subject: "ServiceRH — " + contenu.typeLibelle + " " + contenu.reference + " (traitement requis)",')

# --- CONFIRMATION DEMANDEUR (employé — notice + renommage) ---
remplace("scripts/portail-server.js",
         '"— Service RH (envoi automatique)";',
         '"— ServiceRH (envoi automatique — NE PAS répondre)";')
remplace("scripts/portail-server.js",
         "'<h2 style=\"color:#047857;margin-bottom:4px\">Service RH — Demande enregistrée « '",
         "'<h2 style=\"color:#047857;margin-bottom:4px\">ServiceRH — Demande enregistrée « '")
remplace("scripts/portail-server.js",
         "'<p style=\"color:#94a3b8;font-size:12px;margin-top:16px\">Service RH — e-mail automatique (confirmation demandeur)</p>' +",
         "'<p style=\"color:#94a3b8;font-size:12px;margin-top:16px\">ServiceRH — e-mail automatique (confirmation demandeur — NE PAS répondre)</p>' +")
remplace("scripts/portail-server.js",
         'subject: "Service RH — " + libelleTypeDemande(demande.type) + " " + demande.reference + " (confirmation d\'envoi)",',
         'subject: "ServiceRH — " + libelleTypeDemande(demande.type) + " " + demande.reference + " (confirmation d\'envoi)",')

# --- DOCUMENT DISPONIBLE (employé — notice + renommage) ---
remplace("scripts/portail-server.js",
'''      "Votre demande administrative a été traitée par le service RH.",
      "",
      "  Référence unique           : " + demande.reference,
      "  Type de demande            : " + libelleTypeDemande(demande.type),
      "  Employé                    : " + employeAfficheDoc,
      "  Statut                     : " + statutLabel,
      "",
      "Document(s) transmis par le service RH :",
      lignesTexte,
      "",
      "Vous pouvez visualiser et télécharger ce(s) document(s) dans la section",
      "« Demandes administratives » de votre portail employé.",
      "",
      "Cet e-mail a été envoyé automatiquement par Service RH. Si vous n'êtes pas",
      "le destinataire prévu, ignorez et supprimez ce message.",
    ].join("\\n");''',
'''      "Votre demande administrative a été traitée par le service RH.",
      "",
      "NOTIFICATION AUTOMATIQUE — merci de NE PAS répondre à cet e-mail :",
      "les réponses envoyées à cette adresse ne sont pas lues.",
      "",
      "  Référence unique           : " + demande.reference,
      "  Type de demande            : " + libelleTypeDemande(demande.type),
      "  Employé                    : " + employeAfficheDoc,
      "  Statut                     : " + statutLabel,
      "",
      "Document(s) transmis par le service RH :",
      lignesTexte,
      "",
      "Vous pouvez visualiser et télécharger ce(s) document(s) dans la section",
      "« Demandes administratives » de votre portail employé. Pour toute",
      "question, contactez le service RH.",
      "",
      "E-mail automatique ServiceRH — notification SANS réponse.",
    ].join("\\n");''')
remplace("scripts/portail-server.js",
         "'Référence ' + echappeEmailDemande(demande.reference) + \" — Service RH</div>\" +\n      \"</div>\" +\n      '<div style=\"padding:20px 22px;color:#334155;font-size:14px;\">' +\n      '<p style=\"margin:0 0 14px;\">Votre demande administrative a été traitée par le service RH.</p>' +",
         "'Référence ' + echappeEmailDemande(demande.reference) + \" — ServiceRH</div>\" +\n      \"</div>\" +\n      '<div style=\"padding:20px 22px;color:#334155;font-size:14px;\">' +\n      '<p style=\"margin:0 0 14px;\">Votre demande administrative a été traitée par le service RH.</p>' +\n      '<div style=\"background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:14px;color:#1e40af;font-size:13px;\"><b>Notification automatique</b> — merci de <b>ne pas répondre</b> à cet e-mail : les réponses envoyées à cette adresse ne sont pas lues. Le suivi de votre demande se fait dans votre portail employé.</div>' +")
remplace("scripts/portail-server.js",
'''      '<p style="margin:0 0 10px;">Vous pouvez visualiser et télécharger ce(s) document(s) dans la section « Demandes administratives » de votre portail employé.</p>' +
      '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail envoyé automatiquement par Service RH. Si vous n\\'êtes pas le destinataire prévu, ignorez et supprimez ce message.</p>' +''',
'''      '<p style="margin:0 0 10px;">Vous pouvez visualiser et télécharger ce(s) document(s) dans la section « Demandes administratives » de votre portail employé. Pour toute question, contactez le service RH.</p>' +
      '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail automatique ServiceRH (notification SANS réponse).</p>' +''')
remplace("scripts/portail-server.js",
         'subject: "Service RH — Document disponible : " + libelleTypeDemande(demande.type) + " " + demande.reference,',
         'subject: "ServiceRH — Document disponible : " + libelleTypeDemande(demande.type) + " " + demande.reference,')

# --- DÉCISION N+1 (branche EMPLOYÉ : notice ; branche responsable : renommage) ---
remplace("scripts/portail-server.js",
'''      texteEmploye
        ? "Votre demande administrative a été " + motAction + " par votre responsable N+1."
        : "La demande administrative ci-dessous a été " + motAction + " par le responsable N+1 (réponse directe à l'e-mail de la demande).",
      "",''',
'''      texteEmploye
        ? "Votre demande administrative a été " + motAction + " par votre responsable N+1."
        : "La demande administrative ci-dessous a été " + motAction + " par le responsable N+1 (réponse directe à l'e-mail de la demande).",
      ...(texteEmploye
        ? ["", "NOTIFICATION AUTOMATIQUE — merci de NE PAS répondre à cet e-mail :",
           "les réponses envoyées à cette adresse ne sont pas lues."]
        : []),
      "",''')
remplace("scripts/portail-server.js",
'''      "",
      "Cet e-mail a été envoyé automatiquement par Service RH. Si vous n'êtes pas",
      "le destinataire prévu, ignorez et supprimez ce message.",
    ].join("\\n");''',
'''      "",
      ...(texteEmploye
        ? ["E-mail automatique ServiceRH — notification SANS réponse."]
        : ["Cet e-mail a été envoyé automatiquement par ServiceRH. Si vous n'êtes pas",
           "le destinataire prévu, ignorez et supprimez ce message."]),
    ].join("\\n");''')
remplace("scripts/portail-server.js",
'''      "</p>" +
      '<div style="background:#FFF9F3;border:1px solid #e2e8f0;border-radius:8px;padding:10px 0;margin-bottom:14px;">' +''',
'''      "</p>" +
      (texteEmploye
        ? '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:14px;color:#1e40af;font-size:13px;"><b>Notification automatique</b> — merci de <b>ne pas répondre</b> à cet e-mail : les réponses envoyées à cette adresse ne sont pas lues.</div>'
        : "") +
      '<div style="background:#FFF9F3;border:1px solid #e2e8f0;border-radius:8px;padding:10px 0;margin-bottom:14px;">' +''')
remplace("scripts/portail-server.js",
'''      '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail envoyé automatiquement par Service RH. Si vous n\\'êtes pas le destinataire prévu, ignorez et supprimez ce message.</p>' +
      "</div></div>";
    try {''',
'''      (texteEmploye
        ? '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail automatique ServiceRH (notification SANS réponse).</p>'
        : '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail envoyé automatiquement par ServiceRH. Si vous n\\'êtes pas le destinataire prévu, ignorez et supprimez ce message.</p>') +
      "</div></div>";
    try {''')
remplace("scripts/portail-server.js",
'''        subject: texteEmploye
          ? "Service RH — Votre demande " + typeLib + " " + demande.reference + " a été " + motAction + " par votre responsable N+1"
          : "Service RH — " + typeLib + " " + demande.reference + " " + motAction + " par le responsable N+1",''',
'''        subject: texteEmploye
          ? "ServiceRH — Votre demande " + typeLib + " " + demande.reference + " a été " + motAction + " par votre responsable N+1"
          : "ServiceRH — " + typeLib + " " + demande.reference + " " + motAction + " par le responsable N+1",''')

# ============================================================================
# B) routes download — noms de fichiers servicerh-* (double préfixe accepté)
# ============================================================================
remplace("src/app/api/download-readme/route.ts",
         ".filter((name) => /^service-rh-readme-technique.*\\.pdf$/i.test(name))",
         ".filter((name) => /^(servicerh|service-rh)-readme-technique.*\\.pdf$/i.test(name))")
remplace("src/app/api/download-readme/route.ts",
         "utilisez le fichier service-rh-readme-technique.pdf à la racine",
         "utilisez le fichier servicerh-readme-technique.pdf à la racine")
remplace("src/app/api/download-scripts/route.ts",
         'path.join(getProjectRoot(), "download", "service-rh-scripts-site-web.zip"),',
         'path.join(getProjectRoot(), "download", "servicerh-scripts-site-web.zip"),')
remplace("src/app/api/download-scripts/route.ts",
         'path.join(process.cwd(), "download", "service-rh-scripts-site-web.zip"),',
         'path.join(process.cwd(), "download", "servicerh-scripts-site-web.zip"),')
remplace("src/app/api/download-scripts/route.ts",
         "'attachment; filename=\"service-rh-scripts-site-web.zip\"',",
         "'attachment; filename=\"servicerh-scripts-site-web.zip\"',")
remplace("src/app/api/download-scripts/route.ts",
         "utilisez directement le fichier service-rh-scripts-site-web.zip qui vous a été livré.",
         "utilisez directement le fichier servicerh-scripts-site-web.zip qui vous a été livré.")
remplace("src/app/api/download-formation/route.ts",
         ".filter((name) => /^service-rh-support-formation.*\\.pdf$/i.test(name))",
         ".filter((name) => /^(servicerh|service-rh)-support-formation.*\\.pdf$/i.test(name))")
remplace("src/app/api/download-formation/route.ts",
         "utilisez le fichier service-rh-support-formation-rh.pdf à la racine",
         "utilisez le fichier servicerh-support-formation-rh.pdf à la racine")
remplace("src/app/api/download-matrice/route.ts",
         ".filter((name) => /^Service RH-Matrice-roles.*\\.xlsx$/i.test(name))",
         ".filter((name) => /^(ServiceRH|Service RH)-Matrice-roles.*\\.xlsx$/i.test(name))")
remplace("src/app/api/download-matrice/route.ts",
         "utilisez le fichier Service RH-Matrice-roles-utilisateurs-v0.2.82.xlsx du dossier",
         "utilisez le fichier ServiceRH-Matrice-roles-utilisateurs-v0.2.95.xlsx du dossier")
remplace("src/app/api/download-routage/route.ts",
         ".filter((name) => /^Service RH-Map-routage.*\\.xlsx$/i.test(name))",
         ".filter((name) => /^(ServiceRH|Service RH)-Map-routage.*\\.xlsx$/i.test(name))")
remplace("src/app/api/download-routage/route.ts",
         "utilisez le fichier Service RH-Map-routage-emails-demandes-v0.2.94.xlsx du dossier",
         "utilisez le fichier ServiceRH-Map-routage-emails-demandes-v0.2.94.xlsx du dossier")

# ============================================================================
# B) lanceur + tests — libellés console / commentaires
# ============================================================================
remplace("scripts/service-rh.js",
         '"=== Service RH - Etat des serveurs (mode arriere-plan) ===",',
         '"=== ServiceRH - Etat des serveurs (mode arriere-plan) ===",')
remplace("scripts/test_complet.js",
         "/* Task 158 — Batterie de tests COMPLÈTE du système Service RH",
         "/* Task 158 — Batterie de tests COMPLÈTE du système (Service RH, renommé ServiceRH v0.2.105)")

# ============================================================================
# BILAN
# ============================================================================
print(f"\nRemplacements appliqués : {ok}")
if erreurs:
    print(f"ERREURS ({len(erreurs)}) :")
    for e in erreurs:
        print("  -", e)
    sys.exit(1)
print("Toutes les modifications v0.2.105 sont appliquées (assertions satisfaites).")
