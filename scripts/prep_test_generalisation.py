#!/usr/bin/env python3
# Task 160b — Prépare 2 corpus "même structure" + vérité terrain INDÉPENDANTE
# Corpus A : FICHE_3879 (1 employé, 9 périodes janv->août 2026)
# Corpus B : 20 pages échantillonnées de fiches_paie_1000.pdf (20 employés)
import fitz, json, os, re

BASE = "/home/z/my-project/tmp-testgen"
os.makedirs(BASE, exist_ok=True)

# ---------------- Corpus B : 20 pages / 20 employés ----------------
src = fitz.open("/home/z/my-project/upload/fiches_paie_1000.pdf")
idx = list(range(0, 1000, 50))[:20]  # 0,50,...,950
corpus_b = fitz.open()
for i in idx:
    corpus_b.insert_pdf(src, from_page=i, to_page=i)
path_b = os.path.join(BASE, "corpus_20_employes.pdf")
corpus_b.save(path_b)

# ---------------- Vérité terrain ----------------
def gt_page_1000(page):
    """Bulletin horizontal : libellés puis bloc de valeurs."""
    lines = [l.strip() for l in page.get_text().split("\n")]
    gt = {"matricule": None, "employeeName": None, "cin": None,
          "netSalary": None, "period": None}
    # matricule + nom : bloc de valeurs après MATRICULE/NOM ET PRENOM/FONCTION/CATEGORIE
    for i, l in enumerate(lines):
        if l == "MATRICULE" and i + 5 < len(lines):
            if lines[i+1].startswith("NOM ET PRENOM") and re.fullmatch(r"\d{6}", lines[i+4] or ""):
                gt["matricule"] = lines[i+4]
                gt["employeeName"] = lines[i+5].strip()
            break
    # CIN : ligne 8 chiffres juste APRÈS le CNSS "xxxxxxxx - nn"
    for i, l in enumerate(lines):
        if re.fullmatch(r"\d{8}\s*[-/]\s*\d{1,2}", l):
            for j in (i+1, i+2):
                if j < len(lines) and re.fullmatch(r"\d{8}", lines[j]):
                    gt["cin"] = lines[j]
                    break
            break
    # net : valeur sur la ligne qui suit "1990 Salaire Net"
    for i, l in enumerate(lines):
        if re.match(r"1990\s+Salaire Net", l):
            for j in (i+1, i+2):
                if j < len(lines) and re.search(r"\d", lines[j]) and re.fullmatch(r"[\d\s]+,\d{3}", lines[j]):
                    gt["netSalary"] = lines[j].replace(" ", "")
                    break
            break
    # période : deux premières dates JJ/MM/AA de la page
    dates = re.findall(r"\b\d{2}/\d{2}/\d{2}\b", page.get_text())
    if len(dates) >= 2:
        gt["period"] = f"du {dates[0]} au {dates[1]}"
    return gt

def gt_page_3879(page, n):
    """Bulletin vertical (libellés empilés) — employé constant EMPLOYE TEST."""
    t = page.get_text()
    gt = {"matricule": "003879", "employeeName": "EMPLOYE TEST",
          "cin": "12345678", "netSalary": None, "period": None}
    m = re.search(r"1990\s+Salaire Net\s*\n\s*([\d\s]+,\d{3})", t)
    if m:
        gt["netSalary"] = m.group(1).replace(" ", "")
    dates = re.findall(r"\b\d{2}/\d{2}/\d{2}\b", t)
    if len(dates) >= 2:
        gt["period"] = f"du {dates[0]} au {dates[1]}"
    return gt

verite = {"A": [], "B": []}
docA = fitz.open("/home/z/my-project/tmp-transfernow/transfer_20260924GsjEuUV5/FICHE_3879_TEST_EMPLOYE_2026.PDF")
for i, pg in enumerate(docA):
    verite["A"].append({"page": i + 1, **gt_page_3879(pg, i)})
for k, i in enumerate(idx):
    verite["B"].append({"page": i + 1, **gt_page_1000(src[i])})

json.dump(verite, open(os.path.join(BASE, "verite_terrain.json"), "w"),
          ensure_ascii=False, indent=1)

# Aperçu de contrôle
print("=== Corpus A (9 périodes EMPLOYE TEST) ===")
for v in verite["A"]:
    print(f"p{v['page']}: {v['period']} | net={v['netSalary']}")
print("=== Corpus B (20 employés, échantillon) ===")
for v in verite["B"][:6]:
    print(f"p{v['page']}: {v['matricule']} | {v['employeeName']} | CIN={v['cin']} | net={v['netSalary']} | {v['period']}")
manq = [v for v in verite["A"] + verite["B"]
        if not all([v["matricule"], v["employeeName"], v["cin"], v["netSalary"], v["period"]])]
print(f"\nChamps manquants en vérité terrain : {len(manq)}")
for v in manq[:5]:
    print("  ", v)
print(f"Corpus B : {path_b} ({os.path.getsize(path_b)} octets, {len(corpus_b)} pages)")
