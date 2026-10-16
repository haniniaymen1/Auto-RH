#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 27 : E2E — détection CIN tunisien à 9 chiffres (bulletins Tunis Call Center).
1. Import du FICHIER RÉEL de l'utilisateur (page 2) -> CIN 140000911 (plus le N° CNSS).
2. Import d'un DOCX multi-pages synthétique (MISE EN PAGE identique au fichier réel :
   table matricule séparée + table état civil avec en-têtes N° CNSS / N° CIN)
   -> 3 fiches individuelles, bons CIN, isolation portail.
"""
import json, sys, urllib.request, http.cookiejar, io, os, subprocess

BASE = "http://localhost:3000"
PORTAL = "http://localhost:3001"
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
FAILS = []
INFO = []

def check(name, cond, extra=""):
    print(("  [OK] " if cond else "  [!!] ") + name + (" — " + str(extra) if extra else ""))
    if not cond:
        FAILS.append(name)

def info(name, extra=""):
    print("  [i]  " + name + (" — " + str(extra) if extra else ""))
    INFO.append(name)

def req(path, data=None, headers=None, method=None, absolute=None):
    body = None
    h = dict(headers or {})
    if data is not None:
        body = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    r = urllib.request.Request((absolute or BASE) + path, body, h, method=method)
    try:
        with opener.open(r, timeout=120) as resp:
            raw = resp.read()
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, None

def upload_file(path_on_disk, name, mime):
    boundary = "----task27boundary"
    with open(path_on_disk, "rb") as f:
        content = f.read()
    body = io.BytesIO()
    body.write(("--%s\r\nContent-Disposition: form-data; name=\"files\"; filename=\"%s\"\r\n"
                "Content-Type: %s\r\n\r\n" % (boundary, name, mime)).encode())
    body.write(content)
    body.write(("\r\n--%s--\r\n" % boundary).encode())
    r = urllib.request.Request(
        BASE + "/api/payslips/upload", body.getvalue(),
        {"Content-Type": "multipart/form-data; boundary=" + boundary}, method="POST")
    with opener.open(r, timeout=300) as resp:
        return resp.status, json.loads(resp.read())

print("== 1) Login admin ==")
st, j = req("/api/auth/login", {"email": "it@demo.tn", "password": "demo1234"})
check("login admin -> 200", st == 200, str(st))

def all_fiches():
    """Liste admin complète (gère les deux formes de réponse)."""
    st, j = req("/api/payslips")
    return (j if isinstance(j, list) else (j.get("payslips") or j.get("items") or []))

print("== 1-bis) État propre : suppression des résidus éventuels ==")
removed = 0
for x in all_fiches():
    if (x.get("fileName") or "").startswith("bulletins_tunis"):
        req("/api/payslips/" + x["id"], method="DELETE")
        removed += 1
info("résidus supprimés avant test", str(removed))

print("== 2) Import du FICHIER RÉEL (page 2 — Trabelsi Hamza) ==")
REAL = "/home/z/my-project/upload/bulletins_tunis_call_center_50_UNFICHIER (page 2) (1) (1).docx"
st, j = upload_file(REAL, "bulletins_tunis_page2.docx",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
check("upload réel -> 200", st == 200, str(st))
item = (j.get("results") or [j])[0] if isinstance(j, dict) else None
if item is None:
    print(json.dumps(j)[:400]); sys.exit(1)
check("status SUCCESS", item.get("status") == "SUCCESS", item.get("message", "")[:120])
check("CIN détecté = 140000911", item.get("cin") == "140000911", repr(item.get("cin")))
check("CIN != N° CNSS (17700137)", item.get("cin") != "17700137", repr(item.get("cin")))
info("nom extrait (limitation connue, hors périmètre CIN)", repr(item.get("employeeName")))
real_id = item.get("id")

print("== 3) DOCX multi-pages synthétique (MISE EN PAGE = fichier réel) ==")
BUILD = r"""
const JSZip = require("/home/z/my-project/node_modules/jszip");
const fs = require("fs");
// Reproduit la MISE EN PAGE du bulletin réel : table 1 (matricule/nom/fonction),
// puis table 2 (état civil / N° CNSS / N° CIN / montants) — 1 cellule = 1 paragraphe.
function bulletin(cin9, cnss8, cnssKey, name, net) {
  const p = (t, b) => '<w:p><w:r>' + (b ? '<w:rPr><w:b/></w:rPr>' : '') +
    '<w:t xml:space="preserve">' + t + '</w:t></w:r></w:p>';
  return [
    p("TUNIS CALL CENTER"), p("Matricule CNSS :   209 959 - 51"), p("BULLETIN DE PAIE"),
    p("MATRICULE", true), p("NOM ET PRENOM", true), p("FONCTION", true), p("CATEGORIE", true),
    p("003801"), p(name), p("Teleconseiller"),
    p("ETAT CIVIL", true), p("ENF. A CHARGE", true), p("N° CNSS", true), p("N° CIN", true),
    p("Droit acquis", true), p("Solde Congés", true), p("Sal. Base Th", true),
    p("Marie(e)"), p("2"), p(cnss8 + " - " + cnssKey), p(cin9),
    p("6,560"), p("19,000"), p("1 470,070"),
    p("Salaire de base du mois"), p("801,923"),
    p("Total Brut"), p("1 722,141"),
    p("Net à payer"), p(net),
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
  ].join("");
}
const body =
  bulletin("140000911", "17700137", "04", "Trabelsi Hamza", "1 344,658") +
  bulletin("150001234", "18800246", "12", "Ben Salah Test", "1 410,220") +
  bulletin("120009876", "16600315", "07", "Jelassi Nawres", "1 275,940");
const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
  body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';
const zip = new JSZip();
zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
zip.folder("_rels").file(".rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
zip.folder("word").file("document.xml", doc);
zip.generateAsync({ type: "nodebuffer" }).then(b => {
  fs.writeFileSync("/home/z/my-project/scripts/tmp_task27_multi.docx", b);
  console.log("multi-docx écrit :", b.length, "octets");
});
"""
subprocess.run(["node", "-e", BUILD], check=True, capture_output=True)
check("DOCX multi-pages généré", os.path.exists("/home/z/my-project/scripts/tmp_task27_multi.docx"))

st, j = upload_file("/home/z/my-project/scripts/tmp_task27_multi.docx", "bulletins_tunis_multi.docx",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
check("upload multi -> 200", st == 200, str(st))
item2 = (j.get("results") or [j])[0] if isinstance(j, dict) else None
if item2 is None:
    print(json.dumps(j)[:400]); sys.exit(1)
check("division annoncée (3 fiches individuelles)", item2.get("created") == 3,
      "created=" + str(item2.get("created")) + " / " + item2.get("message", "")[:100])
items = item2.get("items") or []
cins = sorted([it.get("cin") for it in items])
check("3 CIN 9 chiffres corrects", cins == ["120009876", "140000911", "150001234"], str(cins))
check("aucun N° CNSS ni matricule retenu comme CIN",
      all(c and len(c) == 9 and c not in ("17700137", "18800246", "16600315") for c in cins), str(cins))

print("== 4) Portail : isolation par CIN (140000911) ==")
sys.path.insert(0, "/home/z/my-project/scripts")
import portal_login_helper as plh
try:
    # Attendu en base propre : EXACTEMENT 2 fiches avec cin=140000911
    # (le fichier réel + la page 1 du multi — même CIN).
    expected_ids = {x["id"] for x in all_fiches() if x.get("cin") == "140000911"}
    check("base : 2 fiches avec cin=140000911", len(expected_ids) == 2,
          str(len(expected_ids)))
    cookie = plh.portal_login("140000911")
    r3 = urllib.request.Request(PORTAL + "/api/my-fiches", headers={"Cookie": cookie})
    with urllib.request.build_opener().open(r3, timeout=60) as resp3:
        j3 = json.loads(resp3.read().decode())
    lst = j3.get("items") or []
    ids = {p.get("id") for p in lst}
    check("portail : renvoie exactement les fiches du CIN 140000911",
          ids == expected_ids, str(len(ids)) + " renvoyée(s) / " + str(len(expected_ids)) + " attendue(s)")
except Exception as e:
    check("portail accessible", False, str(e)[:160])
finally:
    try:
        plh.cleanup()
    except Exception:
        pass

print("== 5) Nettoyage des fiches de test ==")
removed2 = 0
for x in all_fiches():
    if (x.get("fileName") or "").startswith("bulletins_tunis"):
        req("/api/payslips/" + x["id"], method="DELETE")
        removed2 += 1
check("toutes les fiches de test supprimées", removed2 >= 3, str(removed2))
check("base rendue à l'état initial (107 fiches)", len(all_fiches()) == 107, str(len(all_fiches())))
os.path.exists("/home/z/my-project/scripts/tmp_task27_multi.docx") and \
    os.remove("/home/z/my-project/scripts/tmp_task27_multi.docx")
print("")
if FAILS:
    print("ÉCHEC :", len(FAILS), "vérification(s) en erreur ->", FAILS)
    sys.exit(1)
print("TOUS LES TESTS PASSENT (Task 27)")
