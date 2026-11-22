#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extrait les 1000 fiches du PDF « 1000_fiches_de_paie_fictives (1).pdf ».
Le gabarit (image) est identique sur toutes les pages : seules les VALEURS
sont du texte. Mapping des champs par position (fenêtres x/y calibrées
sur la page 1 et vérifiées sur un échantillon).

Sortie : /home/z/my-project/scripts/fiches_1000.json
"""
import fitz
import json
import sys
from collections import Counter, defaultdict

SRC = "/home/z/my-project/upload/1000_fiches_de_paie_fictives (1).pdf"
OUT = "/home/z/my-project/scripts/fiches_1000.json"

# ---------------------------------------------------------------- fenêtres
# y : intervalles verticaux (points), x : intervalles horizontaux
Z = {
    "dates":      (103, 127),
    "identite":   (145, 172),
    "etat":       (180, 208),
    "rubriques":  (228, 462),
    "bas":        (503, 535),
}

XW = {
    "date_debut":  (378, 465),
    "date_fin":    (465, 560),
    "matricule":   (15, 135),
    "nom_prenom":  (135, 378),
    "fonction":    (378, 470),
    "categorie":   (470, 595),
    "etat_civil":  (15, 90),
    "enfants":     (90, 150),
    "cnss":        (155, 245),
    "cin":         (248, 345),
    "droit":       (368, 447),
    "solde":       (447, 467),
    "trav":        (467, 505),
    "sal_base":    (505, 595),
    "compte":      (150, 460),
    "net_bas":     (460, 595),
}

# colonnes du tableau des rubriques
COL = {
    "nombre":   (243, 298),
    "base":     (298, 347),
    "taux":     (347, 398),
    "gains":    (398, 470),
    "retenues": (470, 575),
}

# libellés des 16 lignes de rubriques, dans l'ordre vertical du gabarit
ROWS = [
    ("6",   "Présence"),
    ("10",  "Salaire de base du mois"),
    ("60",  "Congés payés"),
    ("110", "Indemnité de présence"),
    ("120", "Indemnité de transport"),
    ("190", "Quote part prime"),
    ("TB",  "Total Brut"),
    ("600", "CNSS"),
    ("710", "Assurance maladie"),
    ("720", "Assurance Invalidité Décès"),
    ("800", "SALAIRE IMPOSABLE"),
    ("900", "IRPP"),
    ("950", "Retenue CSS"),
    ("TC",  "Total Cotisations"),
    ("1990","Salaire Net"),
    ("2100","Net à payer"),
]


def dans(y, z):
    return z[0] <= y <= z[1]


def dansx(x, w):
    return w[0] <= x <= w[1]


def main():
    doc = fitz.open(SRC)
    n = doc.page_count
    if n != 1000:
        print(f"ATTENTION : {n} pages (attendu 1000)")

    # ---- passe 1 : centres y canoniques du gabarit ---------------------
    # Positions fixes du gabarit (image identique sur les 1000 pages),
    # vérifiées par clustering global : la ligne « 6 Présence » est vide
    # sur toutes les pages (15 clusters réels sur 16 lignes).
    ys_all = Counter()
    for i in range(n):
        for w in doc[i].get_text("words"):
            if dans(w[1], Z["rubriques"]):
                ys_all[round(w[1])] += 1
    ykeys = sorted(ys_all)
    clusters = []
    for y in ykeys:
        if clusters and y - clusters[-1][3] <= 4:
            c = clusters[-1]
            c[0] += y * ys_all[y]; c[1] += ys_all[y]; c[3] = y
        else:
            clusters.append([y * ys_all[y], ys_all[y], y, y])
    centres_reels = [c[0] / c[1] for c in clusters]
    print(f"Clusters y réels : {len(centres_reels)} (16 lignes au gabarit, "
          f"« 6 Présence » toujours vide)")

    # centres canoniques : ligne 6 interpolée (espacement ~11,7 pt)
    centres = [249.0 - 11.7] + centres_reels
    if len(centres) != len(ROWS):
        print("ERREUR : nombre de lignes inattendu, abandon.")
        for i, c in enumerate(centres):
            lab = ROWS[i][1] if i < len(ROWS) else "??"
            print(f"  y={c:6.1f}  {lab}")
        sys.exit(1)
    for i, c in enumerate(centres):
        print(f"  y={c:6.1f}  {ROWS[i][1]}")

    # ---- passe 2 : extraction champ par champ -------------------------
    fiches = []
    stats = defaultdict(Counter)   # remplissage par champ
    for i in range(n):
        words = doc[i].get_text("words")
        fiche = defaultdict(str)
        rubs = defaultdict(lambda: defaultdict(str))  # idx_ligne -> col -> val

        for w in words:
            x0, y0, x1, y1, t = w[0], w[1], w[2], w[3], w[4]
            if dans(y0, Z["dates"]):
                if dansx(x0, XW["date_debut"]):
                    fiche["date_debut"] = (fiche["date_debut"] + " " + t).strip()
                elif dansx(x0, XW["date_fin"]):
                    fiche["date_fin"] = (fiche["date_fin"] + " " + t).strip()
            elif dans(y0, Z["identite"]):
                if dansx(x0, XW["matricule"]):
                    fiche["matricule"] = t
                elif dansx(x0, XW["nom_prenom"]):
                    fiche["nom_prenom"] = (fiche["nom_prenom"] + " " + t).strip()
                elif dansx(x0, XW["fonction"]):
                    fiche["fonction"] = (fiche["fonction"] + " " + t).strip()
                elif dansx(x0, XW["categorie"]):
                    fiche["categorie"] = (fiche["categorie"] + " " + t).strip()
            elif dans(y0, Z["etat"]):
                if dansx(x0, XW["etat_civil"]):
                    fiche["etat_civil"] = (fiche["etat_civil"] + " " + t).strip()
                elif dansx(x0, XW["enfants"]):
                    fiche["enfants"] = (fiche["enfants"] + " " + t).strip()
                elif dansx(x0, XW["cnss"]):
                    fiche["cnss"] = (fiche["cnss"] + " " + t).strip()
                elif dansx(x0, XW["cin"]):
                    fiche["cin"] = (fiche["cin"] + " " + t).strip()
                elif dansx(x0, XW["droit"]):
                    fiche["droit"] = (fiche["droit"] + " " + t).strip()
                elif dansx(x0, XW["solde"]):
                    fiche["solde"] = (fiche["solde"] + " " + t).strip()
                elif dansx(x0, XW["trav"]):
                    fiche["trav"] = (fiche["trav"] + " " + t).strip()
                elif dansx(x0, XW["sal_base"]):
                    fiche["sal_base"] = (fiche["sal_base"] + " " + t).strip()
            elif dans(y0, Z["rubriques"]):
                # ligne = cluster le plus proche
                best, bd = None, 1e9
                for k, c in enumerate(centres):
                    d = abs(y0 - c)
                    if d < bd:
                        best, bd = k, d
                if best is None or bd > 5:
                    continue
                for col, win in COL.items():
                    if dansx(x0, win):
                        rubs[best][col] = (rubs[best][col] + " " + t).strip()
                        break
            elif dans(y0, Z["bas"]):
                if dansx(x0, XW["compte"]):
                    fiche["compte"] = (fiche["compte"] + " " + t).strip()
                elif dansx(x0, XW["net_bas"]):
                    fiche["net_bas"] = (fiche["net_bas"] + " " + t).strip()

        fiche["page"] = i + 1
        fiche = dict(fiche)
        fiche["rubriques"] = [
            {
                "numero": ROWS[k][0],
                "libelle": ROWS[k][1],
                "nombre": rubs[k].get("nombre", ""),
                "base": rubs[k].get("base", ""),
                "taux": rubs[k].get("taux", ""),
                "gains": rubs[k].get("gains", ""),
                "retenues": rubs[k].get("retenues", ""),
            }
            for k in range(len(ROWS))
        ]
        fiches.append(fiche)

        for k in ("matricule", "nom_prenom", "fonction", "categorie",
                  "etat_civil", "enfants", "cnss", "cin", "droit", "solde",
                  "trav", "sal_base", "date_debut", "date_fin", "compte",
                  "net_bas"):
            stats[k]["ok" if fiche.get(k) else "vide"] += 1

    # ---- rapport de remplissage ---------------------------------------
    print("\n=== Remplissage des champs (1000 pages) ===")
    for k in ("matricule", "nom_prenom", "fonction", "categorie",
              "etat_civil", "enfants", "cnss", "cin", "droit", "solde",
              "trav", "sal_base", "date_debut", "date_fin", "compte",
              "net_bas"):
        c = stats[k]
        print(f"  {k:12s}: ok={c['ok']:4d}  vide={c['vide']:4d}")

    # ---- validation arithmétique (échantillon) -------------------------
    def num(s):
        if not s:
            return None
        s = s.replace(" ", "").replace("\u00a0", "")
        try:
            return float(s.replace(",", "."))
        except ValueError:
            return None

    ok_net = ko = 0
    ko_ex = []
    for f in fiches:
        r = {x["numero"]: x for x in f["rubriques"]}
        tb = num(r["TB"]["gains"])
        tc = num(r["TC"]["retenues"]) or num(r["TC"]["gains"])
        net = num(r["1990"]["gains"])
        npay = num(r["2100"]["gains"])
        netb = num(f.get("net_bas"))
        if tb is not None and tc is not None and net is not None:
            if abs((tb - tc) - net) < 0.01:
                ok_net += 1
            else:
                ko += 1
                if len(ko_ex) < 3:
                    ko_ex.append((f["page"], tb, tc, net))
        if npay is not None and netb is not None and abs(npay - netb) > 0.01:
            ko += 1
            if len(ko_ex) < 3:
                ko_ex.append((f["page"], "net_bas", npay, netb))
    print(f"\nCohérence Total Brut - Total Cotisations = Salaire Net : "
          f"OK={ok_net}  KO={ko}")
    for e in ko_ex:
        print("  écart:", e)

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fiches, fh, ensure_ascii=False)
    print(f"\nJSON écrit : {OUT} ({len(fiches)} fiches)")

    # aperçu
    for i in (0, 1, 999):
        f = fiches[i]
        print(f"\n--- fiche page {f['page']} ---")
        for k in ("matricule", "nom_prenom", "fonction", "categorie",
                  "etat_civil", "enfants", "cnss", "cin", "trav", "sal_base",
                  "date_debut", "date_fin", "compte", "net_bas"):
            print(f"  {k:11s}: {f.get(k, '')!r}")


if __name__ == "__main__":
    main()
