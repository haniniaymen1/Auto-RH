#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 92 — SUITE « SEND MAIL » : service d'envoi d'e-mails depuis l'onglet
« Accès portail » (bouton « Send Mail » par ligne de la liste « CIN – Accès
Portail par mot de passe »).

Statique :
  A. Schéma (MailConfig + PortalAccess.initialPasswordEnc/mailEnvoyeA/Le),
     cartes de chiffrement JUMELLES (db-crypto.ts / lib-crypto-bd.js),
     effacement de la copie par le portail (initialPasswordEnc: null ×2).
  B. API (send-mail + mail-config GET/PUT/test) + librairie mailer
     (nodemailer, contenu CIN/mot de passe/serveur/port/URL).
  C. Interface (bouton « Send Mail » desktop + mobile, popup, panneau SMTP
     avec pré-remplissage Gmail + e-mail de test).
  D. Version 0.2.22, package-lock, README §57, scripts de démarrage
     (vérification nodemailer, CRLF des .bat).

E2E (serveur admin de test port 4200, COPIE de base vierge + MINI SERVEUR
SMTP LOCAL capturant les messages — AUCUN envoi Internet) :
  E. Configuration SMTP : lecture (non configurée), enregistrement, lecture
     (configurée, hasPassword sans JAMAIS le mot de passe).
  F. E-mail de TEST du panneau (destinataire quelconque, façon Gmail).
  G. « Send Mail » d'un accès avec mot de passe initial ENCORE valable :
     envoi + CONTENU EXACT vérifié (CIN complet NON masqué, mot de passe
     initial, serveur 192.168.10.20, port 4001, adresse du portail) +
     traçabilité mailEnvoyeA/mailEnvoyeLe.
  H. Accès SANS mot de passe initial disponible : refus 409
     MOT_DE_PASSE_INDISPONIBLE ; avec reset: true → NOUVEAU mot de passe
     initial généré, envoyé, changement obligatoire re-déclenché.
  I. Sécurité : aucun mot de passe (initial/SMTP) ne sort dans les réponses
     API ; CIN complet dans l'e-mail (l'employé doit pouvoir se connecter) ;
     validation du destinataire ; accès inconnu 404.
"""
import base64
import glob
import json
import os
import quopri
import re
import sys
import urllib.error
import urllib.request

BASE = "/home/z/my-project"
SMTPDIR = sys.argv[1] if len(sys.argv) > 1 else "/tmp/test92-smtp"
BASEURL = "http://127.0.0.1:4200"
EMAIL = "test92@autorh.local"
MOTDEPASSE = "Test92Solide"

resultats = []


def check(nom, condition, detail=""):
    resultats.append((nom, bool(condition), detail))
    print(("  [OK]  " if condition else "  [KO]  ") + nom + (("  — " + str(detail)[:220]) if (detail and not condition) else ""))


def lire(chemin):
    return open(os.path.join(BASE, chemin), encoding="utf-8").read()


def lire_octets(chemin):
    return open(os.path.join(BASE, chemin), "rb").read()


def decoder_message(brut: str) -> str:
    """Décode les parties base64 / quoted-printable d'un message SMTP brut."""
    morceaux = [brut]
    for m in re.finditer(r"Content-Transfer-Encoding:\s*base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)", brut):
        try:
            morceaux.append(base64.b64decode(m.group(1)).decode("utf-8", "replace"))
        except Exception:
            pass
    for m in re.finditer(r"Content-Transfer-Encoding:\s*quoted-printable\r?\n\r?\n(.*?)(?=\r?\n--|\Z)", brut, re.S):
        try:
            morceaux.append(quopri.decodestring(m.group(1)).decode("utf-8", "replace"))
        except Exception:
            pass
    for m in re.finditer(r"Subject:\s*=\?utf-8\?B\?([A-Za-z0-9+/=]+)\?=", brut):
        try:
            morceaux.append(base64.b64decode(m.group(1)).decode("utf-8", "replace"))
        except Exception:
            pass
    return "\n".join(morceaux)


def messages_smtp():
    sortie = []
    for chemin in sorted(glob.glob(os.path.join(SMTPDIR, "message-*.json"))):
        with open(chemin, encoding="utf-8") as f:
            d = json.load(f)
        d["decode"] = decoder_message(d["data"])
        sortie.append(d)
    return sortie


def req(chemin, data=None, methode=None, op=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(BASEURL + chemin, data=body, method=methode)
    if body:
        r.add_header("Content-Type", "application/json")
    try:
        with (op or OPENER).open(r, timeout=30) as rep:
            return rep.status, rep.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


# ======================================================================
print("=== A. Statique : schéma + cartes de chiffrement + portail ===")
schema = lire("prisma/schema.prisma")
check("S01 schéma : modèle MailConfig (id/host/port/secure/username/password/from)",
      "model MailConfig" in schema and 'id             String   @id @default("smtp")' in schema
      and "secure         Boolean" in schema and "serveurAdresse" in schema
      and "sitePort" in schema and "portailUrl" in schema)
check("S02 schéma : PortalAccess.initialPasswordEnc (copie chiffrée du mot de passe initial)",
      "initialPasswordEnc" in schema and "COPIE CHIFFRÉE du MOT DE PASSE INITIAL" in schema)
check("S03 schéma : PortalAccess.mailEnvoyeA + mailEnvoyeLe (traçabilité Send Mail)",
      "mailEnvoyeA" in schema and "mailEnvoyeLe" in schema)

crypto_ts = lire("src/lib/db-crypto.ts")
crypto_js = lire("scripts/lib-crypto-bd.js")
check("S04 carte TS : PortalAccess.alea + initialPasswordEnc + mailEnvoyeA ; MailConfig.alea username/password",
      '"totpSecret", "passwordHash", "initialPasswordEnc", "mailEnvoyeA"' in crypto_ts
      and 'MailConfig: { det: [], alea: ["username", "password"] }' in crypto_ts)
check("S05 cartes JUMELLES identiques (bloc PortalAccess/MailConfig)",
      '"totpSecret", "passwordHash", "initialPasswordEnc", "mailEnvoyeA"' in crypto_js
      and 'MailConfig: { det: [], alea: ["username", "password"] }' in crypto_js
      and crypto_js.count('"initialPasswordEnc"') == crypto_ts.count('"initialPasswordEnc"'))

portail = lire("scripts/portail-server.js")
check("S06 portail : copie chiffrée EFFACÉE quand l'employé choisit son mot de passe (×2)",
      portail.count("initialPasswordEnc: null,") == 2 and portail.count("(Task 92)") >= 2)

print("=== B. Statique : API + librairie mailer ===")
route = lire("src/app/api/portal-access/route.ts")
check("S07 action « send-mail » : mot de passe initial depuis la copie, reset: true, 409 MOT_DE_PASSE_INDISPONIBLE",
      'action === "send-mail"' in route and "MOT_DE_PASSE_INDISPONIBLE" in route
      and "row.mustChangePassword && row.initialPasswordEnc" in route
      and "const resetDemande = Boolean(body?.reset);" in route)
check("S08 send-mail : traçabilité + aperçu (cin, motDePasse, serveur, sitePort, portailUrl)",
      "mailEnvoyeA: dest, mailEnvoyeLe: new Date()" in route
      and "motDePasseInitial: motDePasseAEnvoyer" in route
      and "serveur," in route and "sitePort," in route and "portailUrl," in route)
check("S09 create/reset : copie chiffrée initialPasswordEnc écrite (send-mail futur possible)",
      route.count("initialPasswordEnc: initialPassword,") == 3)  # create ×2 (upsert) + reset ×1
check("S10 GET liste : aMotDePasseInitial booléen + mailEnvoyeA/Le (jamais les mots de passe)",
      "aMotDePasseInitial:" in route and "Boolean(r.initialPasswordEnc) && r.mustChangePassword" in route
      and "mailEnvoyeLe: r.mailEnvoyeLe" in route)

mailer = lire("src/lib/mailer.ts")
check("S11 mailer.ts : nodemailer + transport (SSL/TLS 465 / STARTTLS 587) + ErreurMail MAIL_NON_CONFIGURE",
      'import nodemailer from "nodemailer"' in mailer and "createTransport" in mailer
      and "secure: brut.secure" in mailer and "MAIL_NON_CONFIGURE" in mailer)
check("S12 mailer.ts : e-mail d'accès = CIN + mot de passe initial + serveur + port + adresse du portail",
      "DonneesAcces" in mailer and "envoyerEmailAcces" in mailer
      and "Mot de passe initial" in mailer and "Serveur (IP ou nom DNS)" in mailer
      and "Port du site web" in mailer and "portailUrl" in mailer
      and "expire tous les 15 jours" in mailer)

mc = lire("src/app/api/mail-config/route.ts")
check("S13 mail-config : GET/PUT + action test + mot de passe JAMAIS renvoyé (hasPassword)",
      "export async function GET" in mc and "export async function PUT" in mc
      and 'action !== "test"' in mc and "hasPassword" in mc and "if (password) data.password = password;" in mc)
check("S14 mail-config : port 465 = SSL/TLS par construction + validation e-mail",
      "port === 465 ? true : secure" in mc and "/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test" in mc)

print("=== C. Statique : interface (bouton, popup, panneau SMTP Gmail) ===")
ui = lire("src/components/payslip/portal-access-tab.tsx")
check("S15 UI : bouton « Send Mail » desktop + mobile (2 occurrences)",
      ui.count(">Send Mail</span>") == 1
      and re.search(r"Send Mail\s*\n\s*</Button>", ui) is not None
      and ui.count("ouvrirSendMail(row)") >= 2)
check("S16 UI : popup « Send Mail » — destinataire + bouton Send + gestion MOT_DE_PASSE_INDISPONIBLE",
      "Send Mail — CIN" in ui and "Adresse e-mail du destinataire" in ui
      and "MOT_DE_PASSE_INDISPONIBLE" in ui and '<Send className="h-4 w-4" />' in ui
      and re.search(r"\n\s*Send\s*\n\s*</Button>", ui) is not None)
check("S17 UI : MailPanel intégré (3e carte) + aperçu du contenu envoyé",
      "import { MailPanel }" in ui and "<MailPanel />" in ui
      and "Contenu envoyé" in ui and "aMotDePasseInitial" in ui and "mailEnvoyeA" in ui)

panel = lire("src/components/payslip/mail-panel.tsx")
check("S18 panneau : « Pré-remplir Gmail » (smtp.gmail.com/465) + mot de passe d'application",
      "smtp.gmail.com" in panel and "Pré-remplir Gmail" in panel
      and "MOT DE PASSE D'APPLICATION" in panel.upper() and '"465"' in panel)
check("S19 panneau : e-mail de test + conservation du mot de passe (champ vide) + serveur/port/URL",
      "Envoyer un e-mail de test" in panel and "laisser vide pour conserver" in panel
      and "Adresse IP ou nom DNS du serveur" in panel and "Port du site web" in panel
      and "accès au portail" in panel)

print("=== D. Statique : version, README, démarrage, kit ===")
pkg = json.loads(lire("package.json"))
lock = json.loads(lire("package-lock.json"))
check("S20 version 0.2.23 (package.json + package-lock.json)",
      pkg.get("version") == "0.2.23" and lock.get("packages", {}).get("", {}).get("version") == "0.2.23")
check("S21 nodemailer dans dependencies + @types/nodemailer + présent dans le lock",
      "nodemailer" in pkg["dependencies"] and "@types/nodemailer" in pkg["devDependencies"]
      and lock.get("packages", {}).get("node_modules/nodemailer", {}).get("version", "") != "")
check("S22 README §57 (Send Mail) + §56/§55 intactes",
      "## 57." in lire("README-DEPLOIEMENT-LOCAL.md") and "## 56. Les deux lignes sensibles du `.env`" in lire("README-DEPLOIEMENT-LOCAL.md")
      and "## 55. Portail employés : après le scan du QR code" in lire("README-DEPLOIEMENT-LOCAL.md"))

sh1 = lire("DEMARRER-LINUX-MAC.sh")
sh2 = lire("DEMARRER-TOUT-LINUX-MAC.sh")
bat1 = lire_octets("PREPARER-AUTO-RH-SILENCIEUX.bat")
bat2 = lire_octets("DEMARRER-WINDOWS.bat")
check("S23 démarrage : vérification nodemailer (.sh Linux/Mac ×2 + .bat CRLF ×2)",
      "node_modules/nodemailer/package.json" in sh1 and "node_modules/nodemailer/package.json" in sh2
      and b'node_modules\\nodemailer\\package.json' in bat1 and b'node_modules\\nodemailer\\package.json' in bat2
      and bat1.count(b"\r\n") > 100 and bat2.count(b"\r\n") > 100)

print("=== E. E2E : configuration SMTP (lecture/enregistrement, mot de passe caché) ===")
import http.cookiejar
cj = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

st, rep = req("/api/auth/login", {"email": EMAIL, "password": MOTDEPASSE})
check("E01 login RH/IT de test 200", st == 200, (st, rep))
st, rep = req("/api/mail-config")
d = json.loads(rep)
check("E02 GET mail-config 200 — non configurée au départ (host vide, hasPassword false)",
      st == 200 and d.get("config", {}).get("configuree") is False and d.get("config", {}).get("hasPassword") is False, (st, rep))
check("E03 GET mail-config : défauts détectés depuis la requête (serveur/port/URL)",
      d.get("defauts", {}).get("serveur") and d.get("defauts", {}).get("sitePort") and d.get("defauts", {}).get("portailUrl"), d)

st, rep = req("/api/mail-config", {
    "host": "127.0.0.1", "port": 1925, "secure": False,
    "username": "test92@autorh.local", "password": "Secret92smtp",
    "from": "Auto-RH <test92@autorh.local>",
    "serveurAdresse": "192.168.10.20", "sitePort": "4001",
    "portailUrl": "http://192.168.10.20:4001",
}, methode="PUT")
d = json.loads(rep)
check("E04 PUT mail-config 200 (config enregistrée)", st == 200 and d.get("ok") is True, (st, rep))
check("E05 réponse PUT : hasPassword true, mot de passe ABSENT de la réponse",
      d.get("config", {}).get("hasPassword") is True and "Secret92smtp" not in rep, d)
st, rep = req("/api/mail-config")
d = json.loads(rep)
check("E06 relecture : host 127.0.0.1 / port 1925 / serveur 192.168.10.20 / port 4001 / URL du portail",
      d.get("config", {}).get("host") == "127.0.0.1" and d.get("config", {}).get("port") == 1925
      and d.get("config", {}).get("serveurAdresse") == "192.168.10.20"
      and d.get("config", {}).get("sitePort") == "4001"
      and d.get("config", {}).get("portailUrl") == "http://192.168.10.20:4001", d)
check("E07 relecture : hasPassword true — JAMAIS le mot de passe en clair",
      d.get("config", {}).get("hasPassword") is True and "Secret92smtp" not in rep, d)

print("=== F. E2E : e-mail de TEST du panneau (façon Gmail) ===")
st, rep = req("/api/mail-config", {"action": "test", "dest": "pas-un-email"}, methode="POST")
check("F01 destinataire invalide refusé (400)", st == 400, (st, rep))
st, rep = req("/api/mail-config", {"action": "test", "dest": "test92-gmail@autorh.local"}, methode="POST")
d = json.loads(rep)
check("F02 e-mail de test envoyé (200, via mini SMTP local)", st == 200 and d.get("ok") is True, (st, rep))
msgs = messages_smtp()
check("F03 mini SMTP : 1 message capturé, à destination du destinataire de test",
      len(msgs) == 1 and "test92-gmail@autorh.local" in msgs[0].get("to", []), [m["to"] for m in msgs])
check("F04 contenu du test : annonce « Configuration SMTP validée » + mention « Send Mail »",
      "Configuration SMTP validée" in msgs[0]["decode"] and "Send Mail" in msgs[0]["decode"], msgs[0]["decode"][:200])

print("=== G. E2E : « Send Mail » d'un accès avec mot de passe initial valable ===")
st, rep = req("/api/portal-access")
liste = json.loads(rep)
items = {i["cin"]: i for i in liste.get("items", [])}
c1 = items.get("TEST92CIN1")
c2 = items.get("TEST92CIN2")
check("G01 liste : TEST92CIN1 aMotDePasseInitial TRUE, TEST92CIN2 FALSE",
      c1 is not None and c2 is not None and c1.get("aMotDePasseInitial") is True and c2.get("aMotDePasseInitial") is False, (c1, c2))
check("G02 liste : AUCUN mot de passe initial en clair dans la réponse API",
      "Initial92x" not in rep and "Propre92x" not in rep, rep[:200])

st, rep = req("/api/portal-access", {"action": "send-mail", "id": c1["id"], "dest": "employe92@autorh.local"}, methode="POST")
d = json.loads(rep)
check("G03 send-mail CIN1 : 200, resetEffectue false", st == 200 and d.get("ok") is True and d.get("resetEffectue") is False, (st, rep))
msgs = messages_smtp()
check("G04 2e message capturé, à employe92@autorh.local", len(msgs) == 2 and "employe92@autorh.local" in msgs[1].get("to", []), [m["to"] for m in msgs])
corps = msgs[1]["decode"]
check("G05 e-mail : CIN COMPLET (non masqué) TEST92CIN1", "TEST92CIN1" in corps, corps[:300])
check("G06 e-mail : mot de passe initial EXACT « Initial92x »", "Initial92x" in corps, corps[:300])
check("G07 e-mail : serveur 192.168.10.20 + port 4001 + adresse du portail",
      "192.168.10.20" in corps and "4001" in corps and "http://192.168.10.20:4001" in corps, corps[:300])
check("G08 e-mail : instructions première connexion + expiration 15 jours",
      "Première connexion" in corps and "15 jours" in corps, corps[:300])
check("G09 aperçu renvoyé au RH/IT = contenu envoyé (mot de passe, serveur, port, URL)",
      d.get("apercu", {}).get("motDePasse") == "Initial92x" and d.get("apercu", {}).get("serveur") == "192.168.10.20"
      and d.get("apercu", {}).get("sitePort") == "4001" and d.get("apercu", {}).get("portailUrl") == "http://192.168.10.20:4001", d)
st, rep = req("/api/portal-access")
liste2 = json.loads(rep)
c1b = [i for i in liste2["items"] if i["cin"] == "TEST92CIN1"][0]
check("G10 traçabilité : mailEnvoyeA = employe92@… + mailEnvoyeLe renseigné + copie INTACTE (employé pas encore passé)",
      c1b.get("mailEnvoyeA") == "employe92@autorh.local" and c1b.get("mailEnvoyeLe") and c1b.get("aMotDePasseInitial") is True, c1b)

print("=== H. E2E : accès SANS mot de passe initial disponible (reset obligatoire) ===")
st, rep = req("/api/portal-access", {"action": "send-mail", "id": c2["id"], "dest": "employe92@autorh.local"}, methode="POST")
d = json.loads(rep)
check("H01 sans copie et SANS reset : refus 409 MOT_DE_PASSE_INDISPONIBLE",
      st == 409 and d.get("code") == "MOT_DE_PASSE_INDISPONIBLE", (st, rep))
st, rep = req("/api/portal-access", {"action": "send-mail", "id": c2["id"], "dest": "employe92@autorh.local", "reset": True}, methode="POST")
d = json.loads(rep)
check("H02 avec reset: true : 200, resetEffectue true", st == 200 and d.get("resetEffectue") is True, (st, rep))
nouveau = d.get("apercu", {}).get("motDePasse", "")
check("H03 NOUVEAU mot de passe initial au format XXXX-XXXX-XXXX (≠ ancien « Propre92x »)",
      re.fullmatch(r"[A-Z2-9a-z]{4}-[A-Z2-9a-z]{4}-[A-Z2-9a-z]{4}", nouveau) and nouveau != "Propre92x", nouveau)
msgs = messages_smtp()
check("H04 3e message : CIN2 + NOUVEAU mot de passe initial dans l'e-mail",
      len(msgs) == 3 and "TEST92CIN2" in msgs[2]["decode"] and nouveau in msgs[2]["decode"], [m["to"] for m in msgs])
st, rep = req("/api/portal-access")
c2b = [i for i in json.loads(rep)["items"] if i["cin"] == "TEST92CIN2"][0]
check("H05 base : changement OBLIGATOIRE re-déclenché + copie du nouveau mot de passe présente",
      c2b.get("mustChangePassword") is True and c2b.get("aMotDePasseInitial") is True, c2b)

print("=== I. E2E : sécurité des entrées ===")
st, rep = req("/api/portal-access", {"action": "send-mail", "id": c1["id"], "dest": "pas-un-email"}, methode="POST")
check("I01 destinataire invalide refusé (400)", st == 400, (st, rep))
st, rep = req("/api/portal-access", {"action": "send-mail", "id": "inconnu-000", "dest": "a@b.cd"}, methode="POST")
check("I02 accès inconnu refusé (404)", st == 404, (st, rep))
st, rep = req("/api/portal-access")
check("I03 réponses API : jamais « Secret92smtp » ni le mot de passe initial",
      "Secret92smtp" not in rep and "Initial92x" not in rep, rep[:200])
st, rep = req("/api/mail-config")
check("I04 réponse mail-config : jamais « Secret92smtp »", "Secret92smtp" not in rep, rep[:200])

ok = sum(1 for _, c, _ in resultats if c)
ko = len(resultats) - ok
print(f"\nRÉSULTAT : {ok}/{len(resultats)} vérifications réussies")
sys.exit(0 if ko == 0 else 1)
