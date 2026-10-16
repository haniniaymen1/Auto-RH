#!/usr/bin/env python3
# Task 157 — Analyse OCR des bulletins scannés (TUNIS CALL CENTER)
import fitz, subprocess, re, os, sys

os.environ['TESSDATA_PREFIX'] = '/home/z/my-project/tessdata'
PDF = '/home/z/my-project/tmp-transfernow/fichiers/DocsFromBh225_260914145812_200_copies_(1).pdf'
doc = fitz.open(PDF)
pages = [int(a) for a in sys.argv[1:]] or [0, 1, 2, 50, 100, 150, 199]

def ocr(png):
    r = subprocess.run(['tesseract', png, 'stdout', '-l', 'fra', '--psm', '6'],
                       capture_output=True, text=True)
    return r.stdout

for i in pages:
    pix = doc[i].get_pixmap(dpi=200)
    png = f'/tmp/ocr_p{i}.png'
    pix.save(png)
    txt = ocr(png)
    lignes = [l.strip() for l in txt.split('\n') if l.strip()]

    nom, mat, net, cin, cnss, per = '?', '?', '?', '?', '?', '?'
    for j, l in enumerate(lignes):
        lm = l.replace(' ', '')
        if re.fullmatch(r'\d{5,6}', lm) and mat == '?' and j < 12:
            mat = l.strip()
        if re.fullmatch(r'\d{8}[- ]?\d{2}', lm):
            cnss = l.strip()
        if re.fullmatch(r'\d{8}', lm) and cin == '?' and j > 5:
            cin = l.strip()
        m = re.fullmatch(r'(\d{1,3}(?:[ ,]\d{3})*[,.]\d{3})', l.strip())
        if m and net == '?' and j > 20:
            net = m.group(1)
        # nom : ligne majuscules avec espace, après la ligne MATRICULE/NOM
        if (nom == '?' and j > 3 and re.search(r"[A-ZÉÈÀ' ]{5,} [A-ZÉÈÀ' ]{3,}", l)
                and not re.search(r'BULLETIN|SALAIRE|MATICULE|NOM ET|TUNIS CALL|CAT|FONCTION|TECHNICIEN|RUBRIQUE|TOTAL|SIGNATURE|CACHET|TELEMARKETING|BIAT|VIRER|NUMERO|COMPTE|NET A|ETAT|DROIT|BASE|JOURS|IRPP|CSS|CONGE|PRESENCE|TRANSPORT|INFIR|RETENUE|IMPABLE|COTISATIONS|PART|PAYER|CHARGE|EMPLOYE|SOCIETE|FRERES|CAPITAL|POUR VOUS|LIMITATION', l, re.I)):
            nom = l.strip()
    m = re.search(r'(\d{2}/\d{2}/\d{2})\s+(\d{2}/\d{2}/\d{2})', txt)
    if m:
        per = f'{m.group(1)} au {m.group(2)}'

    print(f'--- page {i:3d} ---')
    print(f'  nom={nom!r}')
    print(f'  matricule={mat!r}  cnss={cnss!r}  cin={cin!r}')
    print(f'  periode={per!r}  net_candidat={net!r}')
    # aperçu premières lignes utiles
    print('  [OCR 8 premières lignes]:', ' | '.join(lignes[:8])[:200])
