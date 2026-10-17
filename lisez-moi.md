# 🟢 AutoRH — Gestion RH, Fiches de Paie & Demandes Administratives

Application web complète de gestion des ressources humaines : import des fiches de paie depuis Sage, portail employé sécurisé, demandes administratives (congés, autorisations, attestations), signature électronique et envoi d'e-mails automatiques.

**Version** : 0.2.201 (sans limitations)
**Thème** : Blanc + Vert Émeraude
**Licence** : Usage commercial

---

## 📋 Table des matières

1. [Présentation](#présentation)
2. [Fonctionnalités](#fonctionnalités)
3. [Prérequis](#prérequis)
4. [Installation](#installation)
5. [Configuration](#configuration)
6. [Démarrage](#démarrage)
7. [Utilisation](#utilisation)
8. [Sécurité](#sécurité)
9. [Dépannage](#dépannage)
10. [Architecture technique](#architecture-technique)

---

## 📖 Présentation

AutoRH est une application Next.js autonome qui couvre l'intégralité du cycle de gestion RH :

- **Import** des bulletins de paie produits par Sage (PDF, images, ZIP, Excel, Word)
- **Détection automatique** du CIN, nom, période, net à payer et matricule
- **Portail employé** sécurisé (CIN + mot de passe + OTP optionnel)
- **Demandes administratives** (congé, autorisation, attestation, parrainage) avec validation à deux étapes
- **Signature électronique** PAdES + tampon visuel (image, texte, QR code, certificat)
- **Envoi d'e-mails** automatiques (SMTP + réception IMAP)
- **Chiffrement AES-256-GCM** de toutes les données sensibles

Cette version **sans limitations** permet de créer un nombre illimité de comptes (SuperAdmin, RH, IT), d'employés (accès portail) et d'importer un nombre illimité de fiches de paie.

---

## ✨ Fonctionnalités

### Import de fiches de paie
- Formats acceptés : PDF (mono et multi-fiches), PNG, JPG, ZIP, XLSX/XLS, DOCX
- OCR intégré (Tesseract.js) pour les fiches scannées en image
- Découpage automatique : un PDF multi-pages devient N fiches individuelles
- Indexation déterministe : recherche par CIN même avec 240 000+ fiches
- Détection d'anomalies (noms/prénoms incohérents entre fiches)

### Portail employé (port 4001)
- Connexion sécurisée par CIN + mot de passe
- Code OTP optionnel (TOTP — Google Authenticator, Microsoft Authenticator)
- Consultation des fiches de paie signées électroniquement
- Dépôt de demandes administratives (5 types)
- Validation à deux étapes : manager → RH
- Notification automatique par e-mail à chaque étape

### Signature électronique
- Tampon visuel : image (PNG/JPG), texte, QR code, cachet de certificat
- Signature PAdES : signature cryptographique PKCS#7 avec certificat X.509
- Copies signées figées (la première signature est conservée à vie)
- Vérification QR code hors-ligne

### Demandes administratives
- 5 types : CONGÉ, AUTORISATION_SORTIE, ATTESTATION_TRAVAIL, ATTESTATION_SALAIRE, PARRAINAGE
- Workflow à deux étapes : décision du manager puis décision du RH
- Génération automatique du PDF de réponse signé + tamponné
- Journal complet de toutes les décisions

### Envoi d'e-mails (SMTP + IMAP)
- Configuration SMTP complète (Gmail, Zoho, serveur personnalisé)
- Test de connexion SMTP intégré
- Réception IMAP : interrogation automatique toutes les 15 secondes
- E-mail automatique à la création de comptes et aux notifications de décision

---

## 🔧 Prérequis

| Prérequis | Version minimale | Recommandé |
|---|---|---|
| Node.js | 20 LTS | 22 LTS |
| npm | 10 | 10+ |
| Espace disque | 200 Mo | 500 Mo |
| RAM | 1 Go | 2 Go |
| Système | Windows 10/11, Ubuntu 20.04+, macOS 12+ | — |

Connexion Internet requise uniquement lors de la première installation (téléchargement des dépendances npm). L'application fonctionne ensuite **hors-ligne**.

---

## 📥 Installation

### Étape 1 : Extraire le ZIP

```bash
# Créez un dossier et extrayez le contenu du ZIP
mkdir auto-rh
cd auto-rh
unzip auto-rh-v0.2.201-sans-limites.zip
```

### Étape 2 : Vérifier l'extraction

```bash
node scripts/verifier-extraction.js
# Doit afficher : "Extraction complète : 989 fichiers contrôlés, aucun problème détecté."
# Exit code : 0
```

### Étape 3 : Installer les dépendances

```bash
npm install --no-audit --no-fund
```

### Étape 4 : Configurer la base de données

```bash
# Générer le client Prisma
npx prisma generate

# Créer la base de données SQLite
npx prisma db push --accept-data-loss
```

### Étape 5 : Créer le fichier .env

```bash
cp .env.example .env
```

Éditez le fichier `.env` avec vos paramètres :

```env
# Base de données SQLite (chemin absolu recommandé)
DATABASE_URL=file:/chemin/absolu/vers/auto-rh/db/custom.db

# Secret de signature des sessions (OBLIGATOIRE en production)
# Générer avec : openssl rand -hex 48
AUTH_SECRET=votre-secret-de-48-caracteres-minimum

# Clé de chiffrement AES-256 (OBLIGATOIRE en production)
# Générer avec : openssl rand -base64 48
AUTORH_STORAGE_KEY=votre-cle-de-chiffrement

# Ports (optionnel)
AUTORH_PORT_ADMIN=4000
AUTORH_PORT_PORTAIL=4001
```

### Étape 6 : Créer le compte SuperAdmin

```bash
# Linux / macOS
node scripts/creer-superadmin.js

# Windows
REMARRER-LINUX-MAC.sh
# ou
node scripts/creer-superadmin.js --creer --email admin@votre-entreprise.tn --nom "Admin" --password "VotreMotDePasse2026!" --role SUPERADMIN
```

---

## 🚀 Démarrage

### Windows (le plus simple)

Double-cliquez sur `PREPARER-AUTO-RH-SILENCIEUX.bat`

### Linux / macOS

```bash
chmod +x DEMARRER-TOUT-LINUX-MAC.sh
./DEMARRER-TOUT-LINUX-MAC.sh
```

### Démarrage manuel

```bash
# Administration (port 4000)
npm run dev

# Portail employé (port 4001) — dans un autre terminal
node scripts/portail-server.js

# Les deux en même temps
node scripts/auto-rh.js start
```

### Accès

| Service | URL | Rôle |
|---|---|---|
| Administration | http://localhost:4000 | RH, IT, SuperAdmin |
| Portail employé | http://localhost:4001 | Employés (CIN + mot de passe) |
| Pont d'aperçu | http://localhost:3000 | Proxy vers l'administration |

---

## 📖 Utilisation

### 1. Connexion administrateur

1. Ouvrez http://localhost:4000/login
2. Saisissez l'e-mail et le mot de passe du SuperAdmin
3. À la première connexion, changez votre mot de passe (politique 15 jours)

### 2. Importer des fiches de paie

1. Allez dans l'onglet **Importer**
2. Glissez-déposez vos fichiers PDF, PNG, JPG, ZIP, XLSX ou DOCX
3. Le système détecte automatiquement le CIN, le nom, la période et le net à payer
4. Les fiches sont chiffrées (AES-256-GCM) et stockées sur le disque

### 3. Créer des comptes RH / IT

1. Allez dans l'onglet **Utilisateurs**
2. Cliquez sur **Créer un compte**
3. Saisissez nom, e-mail, mot de passe et rôle (RH ou IT)
4. Un e-mail automatique est envoyé au nouvel utilisateur

### 4. Créer des accès employés

1. Allez dans l'onglet **Accès portail**
2. Saisissez le CIN de l'employé (8 chiffres)
3. Un mot de passe initial est généré et affiché une seule fois
4. L'employé se connecte sur http://localhost:4001 avec son CIN + mot de passe

### 5. Gérer les demandes

1. Allez dans l'onglet **Demandes**
2. Consultez les demandes en attente (congés, autorisations, attestations)
3. Validez ou refusez (workflow à deux étapes : manager → RH)
4. Un PDF signé est généré automatiquement et envoyé par e-mail

### 6. Configurer la signature / tampon

1. Allez dans l'onglet **Paramètres → Signature**
2. Importez une image de tampon (PNG/JPG)
3. Configurez le texte, le QR code, le cachet de certificat
4. Positionnez les éléments (4 coins + décalages X/Y)
5. Optionnel : importez un certificat .p12/.pfx pour la signature PAdES

### 7. Configurer l'envoi d'e-mails

1. Allez dans l'onglet **Accès portail → Envoi d'e-mails (SMTP)**
2. Saisissez : hôte SMTP, port, identifiant, mot de passe
3. Cliquez sur **Tester la connexion**
4. Activez la réception IMAP si nécessaire

---

## 🔒 Sécurité

### Chiffrement
- **Mots de passe** : hachage scrypt (format `scrypt:salt:hash`)
- **Fichiers stockés** : chiffrement AES-256-GCM
- **Champs sensibles en base** : chiffrement AES-256-GCM (e-mails, CIN, mots de passe SMTP)
- **Copies signées** : chiffrées, permissions 0600

### Authentification
- Sessions : cookie httpOnly signé HMAC-SHA256
- Politique de mot de passe : 8 caractères min., minuscule + majuscule + chiffre + symbole
- Expiration : tous les 15 jours
- Anti force-brute : verrouillage après 5 échecs
- Journalisation : toutes les connexions tracées

### Variables sensibles (.env)

| Variable | Rôle | Obligatoire |
|---|---|---|
| `DATABASE_URL` | Chemin de la base SQLite | Oui |
| `AUTH_SECRET` | Secret HMAC pour les sessions | Oui (prod) |
| `AUTORH_STORAGE_KEY` | Clé de chiffrement AES-256 | Oui (prod) |
| `AUTORH_PORT_ADMIN` | Port administration (défaut 4000) | Non |
| `AUTORH_PORT_PORTAIL` | Port portail employé (défaut 4001) | Non |

⚠️ **NE JAMAIS perdre le fichier .env** — sans `AUTORH_STORAGE_KEY`, les données chiffrées sont irrécupérables.

---

## 🛠️ Dépannage

### « Extraction incomplete »

```bash
# Vérifiez l'extraction
node scripts/verifier-extraction.js
# Si erreur : supprimez le dossier, re-extrayez le ZIP, relancez
```

### « Couldn't find any pages or app directory »

L'extraction est incomplète. Supprimez tout le dossier et re-extrayez le ZIP.

### « Module @napi-rs/canvas introuvable »

```bash
npm install --no-audit
```

### « Port 4000 déjà utilisé »

Modifiez `AUTORH_PORT_ADMIN=4001` dans `.env` ou arrêtez l'autre processus.

### « Fiches de paie illisibles après restauration »

Le fichier `.env` doit contenir la MÊME clé `AUTORH_STORAGE_KEY` que l'installation d'origine.

### Commandes utiles

```bash
npm run dev              # Serveur développement (port 4000)
npm run build            # Build production
npm run start            # Serveur production standalone
node scripts/auto-rh.js start    # Démarrer administration + portail
node scripts/auto-rh.js stop      # Arrêter les serveurs
node scripts/auto-rh.js status    # État des serveurs
```

---

## 🏗️ Architecture technique

### Stack

| Composant | Technologie | Version |
|---|---|---|
| Framework | Next.js (Turbopack) | 16.1 |
| Base de données | Prisma + SQLite | 6.12 |
| UI | React + Tailwind CSS 4 + shadcn/ui | 19 / 4 |
| OCR | Tesseract.js + pdf.js | 5 / 4 |
| Canvas | @napi-rs/canvas | 1.0 |
| Signature | node-forge + openssl | 1.3 |
| PDF | pdf-lib | 1.17 |
| Excel | xlsx (SheetJS) | 0.18 |
| Word | mammoth | 1.6 |

### Ports

| Port | Service |
|---|---|
| 4000 | Administration (RH/IT/SuperAdmin) |
| 4001 | Portail employé |
| 3000 | Pont d'aperçu (proxy) |

### Structure des dossiers

```
auto-rh/
├── src/
│   ├── app/                # Pages et API routes (App Router)
│   │   ├── api/            # 50+ endpoints API REST
│   │   ├── login/          # Page de connexion
│   │   └── page.tsx        # Page principale (onglets)
│   ├── lib/                # Modules serveur (auth, db, mailer, etc.)
│   ├── components/         # Composants React (UI)
│   └── middleware.ts      # Middleware (auth)
├── prisma/schema.prisma    # Schéma base de données
├── scripts/                # Scripts CLI (lanceurs, vérificateurs)
├── storage/                # Fichiers chiffrés (fiches, certificats)
├── public/                # Logo, favicons, assets statiques
├── .env                   # Configuration (secrets)
└── package.json
```

### Matrice des rôles

| Fonctionnalité | SuperAdmin | RH | IT | Employé |
|---|---|---|---|---|
| Créer comptes RH/IT | ✅ | ❌ | ❌ | ❌ |
| Importer fiches de paie | ✅ | ✅ | ❌ | ❌ |
| Créer accès employés | ✅ | ✅ | ❌ | ❌ |
| Configurer signature | ✅ | ✅ | ❌ | ❌ |
| Configurer SMTP | ✅ | ❌ | ✅ | ❌ |
| Traiter demandes | ✅ | ✅ | ❌ | ❌ |
| Consulter fiches | ✅ | ✅ | ✅ | ✅ (les siennes) |
| Déposer demandes | ❌ | ❌ | ❌ | ✅ |

---

## 📄 Licence

Ce logiciel est destiné à un usage commercial. Contactez votre fournisseur pour les conditions de licence.

---

## 🆘 Support

Pour toute question ou problème :
1. Consultez le fichier `AutoRH-README.pdf` (inclus dans le ZIP)
2. Vérifiez les journaux : `logs/auto-rh-administration.log`
3. Contactez votre fournisseur AutoRH

---

**AutoRH v0.2.201** — Gestion RH, fiches de paie et demandes administratives
