# 🟢 AutoRH — HR Management, Payslips & Administrative Requests

A complete self-hosted HR management web application: import payslips from Sage, secure employee portal, administrative requests (leave, authorizations, certificates), electronic signatures, and automated email notifications.

**Version**: 0.2.201 (Unlimited)
**Theme**: White + Emerald Green
**License**: Commercial Use

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Requirements](#requirements)
4. [Installation](#installation)
5. [Configuration](#configuration)
6. [Running the Application](#running-the-application)
7. [Usage Guide](#usage-guide)
8. [Security](#security)
9. [Troubleshooting](#troubleshooting)
10. [Technical Architecture](#technical-architecture)

---

## 📖 Overview

AutoRH is a standalone Next.js application that covers the entire HR management cycle:

- **Import** payslips produced by Sage (PDF, images, ZIP, Excel, Word)
- **Automatic detection** of ID number (CIN), name, period, net salary, and employee number
- **Employee portal** secured by CIN + password + optional OTP
- **Administrative requests** (leave, authorization, certificates, referrals) with two-step approval (manager → HR)
- **Electronic signature** PAdES + visual stamp (image, text, QR code, certificate)
- **Automated emails** (SMTP sending + IMAP receiving)
- **AES-256-GCM encryption** for all sensitive data

This **unlimited version** allows you to create an unlimited number of accounts (SuperAdmin, HR, IT), employees (portal access), and import an unlimited number of payslips.

---

## ✨ Features

### Payslip Import
- **Accepted formats**: PDF (single and multi-payslip), PNG, JPG, ZIP, XLSX/XLS, DOCX
- **Built-in OCR** (Tesseract.js) for scanned image payslips
- **Automatic splitting**: a multi-page PDF becomes N individual payslips
- **Deterministic indexing**: search by CIN even with 240,000+ payslips
- **Anomaly detection** (inconsistent names/first names across payslips)

### Employee Portal (port 4001)
- Secure login with CIN + password
- Optional OTP code (TOTP — Google Authenticator, Microsoft Authenticator)
- View electronically signed payslips
- Submit administrative requests (5 types)
- Two-step validation: manager → HR
- Automatic email notification at each step

### Electronic Signature
- **Visual stamp**: image (PNG/JPG), text, QR code, certificate stamp
- **PAdES signature**: cryptographic PKCS#7 signature with X.509 certificate
- **Frozen signed copies** (first signature is preserved for life)
- **Offline QR code verification**

### Administrative Requests
- **5 types**: LEAVE, WORK_AUTHORIZATION, EMPLOYMENT_CERTIFICATE, SALARY_CERTIFICATE, REFERRAL
- **Two-step workflow**: manager decision then HR decision
- **Automatic PDF generation** of signed + stamped response
- **Complete audit trail** of all decisions

### Email Sending (SMTP + IMAP)
- Full SMTP configuration (Gmail, Zoho, custom server)
- Built-in SMTP connection test
- IMAP receiving: automatic polling every 15 seconds
- Automatic email on account creation and decision notifications

---

## 🔧 Requirements

| Requirement | Minimum Version | Recommended |
|---|---|---|
| Node.js | 20 LTS | 22 LTS |
| npm | 10 | 10+ |
| Disk space | 200 MB | 500 MB |
| RAM | 1 GB | 2 GB |
| OS | Windows 10/11, Ubuntu 20.04+, macOS 12+ | — |

Internet connection is only required during the first installation (npm dependencies download). The application then works **offline**.

---

## 📥 Installation

### Step 1: Extract the ZIP

```bash
mkdir auto-rh
cd auto-rh
unzip auto-rh-v0.2.201-sans-limites.zip
```

### Step 2: Verify Extraction

```bash
node scripts/verifier-extraction.js
# Should output: "Extraction complete: 989 files checked, no issues detected."
# Exit code: 0
```

### Step 3: Install Dependencies

```bash
npm install --no-audit --no-fund
```

### Step 4: Set Up the Database

```bash
# Generate Prisma client
npx prisma generate

# Create the SQLite database
npx prisma db push --accept-data-loss
```

### Step 5: Create the .env File

```bash
cp .env.example .env
```

Edit the `.env` file with your settings:

```env
# SQLite database (absolute path recommended)
DATABASE_URL=file:/absolute/path/to/auto-rh/db/custom.db

# Session signing secret (REQUIRED in production)
# Generate with: openssl rand -hex 48
AUTH_SECRET=your-secret-of-at-least-48-characters

# AES-256 encryption key (REQUIRED in production)
# Generate with: openssl rand -base64 48
AUTORH_STORAGE_KEY=your-encryption-key

# Ports (optional)
AUTORH_PORT_ADMIN=4000
AUTORH_PORT_PORTAIL=4001
```

### Step 6: Create the SuperAdmin Account

```bash
# Interactive mode
node scripts/creer-superadmin.js

# Command line mode
node scripts/creer-superadmin.js --creer --email admin@your-company.com --name "Admin" --password "YourPassword2026!" --role SUPERADMIN
```

---

## 🚀 Running the Application

### Windows (Easiest)

Double-click `PREPARER-AUTO-RH-SILENCIEUX.bat`

### Linux / macOS

```bash
chmod +x DEMARRER-TOUT-LINUX-MAC.sh
./DEMARRER-TOUT-LINUX-MAC.sh
```

### Manual Start

```bash
# Administration (port 4000)
npm run dev

# Employee portal (port 4001) — in another terminal
node scripts/portail-server.js

# Both at once
node scripts/auto-rh.js start
```

### Access URLs

| Service | URL | Role |
|---|---|---|
| Administration | http://localhost:4000 | HR, IT, SuperAdmin |
| Employee Portal | http://localhost:4001 | Employees (CIN + password) |
| Preview Bridge | http://localhost:3000 | Proxy to administration |

---

## 📖 Usage Guide

### 1. Admin Login

1. Open http://localhost:4000/login
2. Enter the SuperAdmin email and password
3. On first login, change your password (15-day expiration policy)

### 2. Import Payslips

1. Go to the **Import** tab
2. Drag and drop your PDF, PNG, JPG, ZIP, XLSX, or DOCX files
3. The system automatically detects CIN, name, period, and net salary
4. Payslips are encrypted (AES-256-GCM) and stored on disk

### 3. Create HR / IT Accounts

1. Go to the **Users** tab
2. Click **Create Account**
3. Enter name, email, password, and role (HR or IT)
4. An automatic email is sent to the new user

### 4. Create Employee Portal Access

1. Go to the **Portal Access** tab
2. Enter the employee's CIN (8 digits)
3. An initial password is generated and displayed once
4. The employee logs in at http://localhost:4001 with CIN + password

### 5. Manage Requests

1. Go to the **Requests** tab
2. View pending requests (leave, authorizations, certificates)
3. Approve or reject (two-step workflow: manager → HR)
4. A signed PDF is automatically generated and sent by email

### 6. Configure Signature / Stamp

1. Go to **Settings → Signature**
2. Import a stamp image (PNG/JPG)
3. Configure text, QR code, certificate stamp
4. Position elements (4 corners + X/Y offsets)
5. Optional: import a .p12/.pfx certificate for PAdES signature

### 7. Configure Email Sending

1. Go to **Portal Access → Email Sending (SMTP)**
2. Enter: SMTP host, port, username, password
3. Click **Test Connection**
4. Enable IMAP receiving if needed

---

## 🔒 Security

### Encryption
- **Passwords**: scrypt hashing (format `scrypt:salt:hash`)
- **Stored files**: AES-256-GCM encryption
- **Sensitive database fields**: AES-256-GCM encryption (emails, CIN, SMTP passwords)
- **Signed copies**: encrypted, permissions 0600

### Authentication
- Sessions: httpOnly cookie signed with HMAC-SHA256
- Password policy: 8+ characters, lowercase + uppercase + digit + symbol
- Password expiration: every 15 days
- Anti brute-force: lockout after 5 failed attempts
- Full authentication logging

### Sensitive Variables (.env)

| Variable | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | SQLite database path | Yes |
| `AUTH_SECRET` | HMAC secret for sessions | Yes (prod) |
| `AUTORH_STORAGE_KEY` | AES-256 encryption key | Yes (prod) |
| `AUTORH_PORT_ADMIN` | Administration port (default 4000) | No |
| `AUTORH_PORT_PORTAIL` | Employee portal port (default 4001) | No |

⚠️ **NEVER lose the .env file** — without `AUTORH_STORAGE_KEY`, encrypted data is mathematically unrecoverable.

---

## 🛠️ Troubleshooting

### "Extraction incomplete"

```bash
node scripts/verifier-extraction.js
# If error: delete the folder, re-extract the ZIP, restart
```

### "Couldn't find any pages or app directory"

Extraction is incomplete. Delete the entire folder and re-extract the ZIP.

### "Module @napi-rs/canvas not found"

```bash
npm install --no-audit
```

### "Port 4000 already in use"

Change `AUTORH_PORT_ADMIN=4001` in `.env` or stop the other process.

### "Payslips unreadable after restore"

The `.env` file must contain the SAME `AUTORH_STORAGE_KEY` as the original installation.

### Useful Commands

```bash
npm run dev              # Development server (port 4000)
npm run build            # Production build
npm run start            # Production standalone server
node scripts/auto-rh.js start    # Start admin + portal
node scripts/auto-rh.js stop      # Stop both servers
node scripts/auto-rh.js status    # Server status
```

---

## 🏗️ Technical Architecture

### Tech Stack

| Component | Technology | Version |
|---|---|---|
| Framework | Next.js (Turbopack) | 16.1 |
| Database | Prisma + SQLite | 6.12 |
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
| 4000 | Administration (HR/IT/SuperAdmin) |
| 4001 | Employee Portal |
| 3000 | Preview Bridge (proxy) |

### Project Structure

```
auto-rh/
├── src/
│   ├── app/                # Pages and API routes (App Router)
│   │   ├── api/            # 50+ REST API endpoints
│   │   ├── login/          # Login page
│   │   └── page.tsx        # Main page (tabs)
│   ├── lib/                # Server modules (auth, db, mailer, etc.)
│   ├── components/         # React components (UI)
│   └── middleware.ts      # Auth middleware
├── prisma/schema.prisma    # Database schema
├── scripts/                # CLI scripts (launchers, verifiers)
├── storage/                # Encrypted files (payslips, certificates)
├── public/                # Logo, favicons, static assets
├── .env                   # Configuration (secrets)
└── package.json
```

### Role Matrix

| Feature | SuperAdmin | HR | IT | Employee |
|---|---|---|---|---|
| Create HR/IT accounts | ✅ | ❌ | ❌ | ❌ |
| Import payslips | ✅ | ✅ | ❌ | ❌ |
| Create employee access | ✅ | ✅ | ❌ | ❌ |
| Configure signature | ✅ | ✅ | ❌ | ❌ |
| Configure SMTP | ✅ | ❌ | ✅ | ❌ |
| Process requests | ✅ | ✅ | ❌ | ❌ |
| View payslips | ✅ | ✅ | ✅ | ✅ (own only) |
| Submit requests | ❌ | ❌ | ❌ | ✅ |

---

## 📄 License

This software is intended for commercial use. Contact the provider for licensing terms.

---

## 🆘 Support

For any questions or issues:
1. Check the `AutoRH-README.pdf` file (included in the ZIP)
2. Review logs: `logs/auto-rh-administration.log`
3. Contact your AutoRH provider

---

**AutoRH v0.2.201** — HR Management, Payslips & Administrative Requests
