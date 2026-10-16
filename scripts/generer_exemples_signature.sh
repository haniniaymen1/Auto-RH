#!/usr/bin/env bash
# ============================================================================
# NOUVEAU (Task 181) — GÉNÉRATION DE FICHIERS DE SIGNATURE ÉLECTRONIQUE
# D'EXEMPLE pour tester l'import multi-formats du panneau
# « Signature électronique & QR code ».
#
# Formats produits (dans download/signatures-exemple/) :
#   - signature-exemple.p12 / .pfx  : PKCS#12 (certificat + clé, mot de passe)
#   - signature-exemple.pkcs7       : PKCS#7 (chaîne de certificats, DER)
#   - signature-exemple.p7s         : PKCS#7 signature DÉTACHÉE (DER)
#   - signature-exemple.p7m         : PKCS#7 données signées ENVELOPPÉES (DER)
#   - signature-exemple.xml         : XML-DSig enveloppé (X509Certificate)
#   - signature-exemple.ps7x        : variante XML-DSig
#   - certificat-exemple.pem        : certificat X.509 brut (format compatible)
#   - document-origine.txt          : document signé par .p7s/.p7m
#   - LIRE-MOI.txt                  : mode d'emploi + mots de passe
#
# Certificat auto-signé (DÉMONSTRATION UNIQUEMENT) :
#   CN=Signature Exemple Auto-RH, O=Auto-RH Démonstration, OU=Ressources
#   Humaines, C=TN — valide 730 jours.
# ============================================================================
set -euo pipefail

RACINE="/home/z/my-project"
SORTIE="$RACINE/download/signatures-exemple"
TRAVAIL="$RACINE/scripts/tmp_task181_exemples"
MDP="PaieSage2026!"

mkdir -p "$SORTIE" "$TRAVAIL"
cd "$TRAVAIL"

echo "==> 1) Certificat auto-signé + clé privée (démonstration)"
openssl req -x509 -newkey rsa:2048 -keyout cle-privee.pem -out certificat-exemple.pem \
  -days 730 -nodes -sha256 \
  -subj "/C=TN/O=Auto-RH Demonstration/OU=Ressources Humaines/CN=Signature Exemple Auto-RH/emailAddress=exemple@autorh.local" \
  -addext "keyUsage=digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=emailProtection,codeSigning" 2>/dev/null

echo "==> 2) Document d'origine à signer"
cat > document-origine.txt <<'TXT'
Auto-RH — Document de démonstration
Ce document accompagne les fichiers de signature d'exemple (Task 181).
Il est signé par : Signature Exemple Auto-RH (Auto-RH Demonstration).
TXT

echo "==> 3) PKCS#12 : .p12 et .pfx (mot de passe : $MDP)"
openssl pkcs12 -export -out signature-exemple.p12 -inkey cle-privee.pem \
  -in certificat-exemple.pem -name "Signature Exemple Auto-RH" \
  -passout "pass:$MDP" 2>/dev/null
cp signature-exemple.p12 signature-exemple.pfx

echo "==> 4) PKCS#7 générique (.pkcs7) : chaîne de certificats, DER"
openssl crl2pkcs7 -nocrl -certfile certificat-exemple.pem \
  -outform DER -out signature-exemple.pkcs7 2>/dev/null

echo "==> 5) PKCS#7 signature détachée (.p7s), DER"
openssl smime -sign -in document-origine.txt -signer certificat-exemple.pem \
  -inkey cle-privee.pem -outform DER -out signature-exemple.p7s 2>/dev/null

echo "==> 6) PKCS#7 données signées enveloppées (.p7m), DER"
openssl smime -sign -in document-origine.txt -signer certificat-exemple.pem \
  -inkey cle-privee.pem -outform DER -nodetach -out signature-exemple.p7m 2>/dev/null

echo "==> 7) XML-DSig (.xml et .ps7x) via signxml"
python3 - <<'PY'
from lxml import etree
from signxml import XMLSigner, methods

cert = open("certificat-exemple.pem", "rb").read()
cle = open("cle-privee.pem", "rb").read()

doc = etree.fromstring(b"""<?xml version="1.0" encoding="UTF-8"?>
<Auto-RHDocument id="demo-181">
  <Titre>Document de demonstration Auto-RH</Titre>
  <Contenu>Signe electroniquement pour tester l'import multi-formats (Task 181).</Contenu>
</Auto-RHDocument>""")

signeur = XMLSigner(method=methods.enveloped, digest_algorithm="sha256")
signe = signeur.sign(doc, key=cle, cert=cert)
assert signe.find(".//{http://www.w3.org/2000/09/xmldsig#}X509Certificate") is not None, "X509Certificate absent"

for cible in ("signature-exemple.xml", "signature-exemple.ps7x"):
    etree.ElementTree(signe).write(cible, xml_declaration=True, encoding="UTF-8")
print("XML-DSig OK")
PY

echo "==> 8) Copie de TOUS les fichiers dans la livraison"
for f in signature-exemple.p12 signature-exemple.pfx signature-exemple.pkcs7 \
         signature-exemple.p7s signature-exemple.p7m signature-exemple.xml \
         signature-exemple.ps7x certificat-exemple.pem document-origine.txt; do
  cp -f "$f" "$SORTIE/$f"
done

echo "==> 9) LIRE-MOI.txt"
cat > "$SORTIE/LIRE-MOI.txt" <<TXT
FICHIERS DE SIGNATURE ÉLECTRONIQUE D'EXEMPLE — Auto-RH (Task 181)
====================================================================

Ces fichiers servent à TESTER l'import de signature électronique du
panneau « Signature électronique & QR code » (onglet Importer, rôles
RH et superadministrateur). Ils sont générés avec un certificat
AUTO-SIGNÉ de DÉMONSTRATION — ils n'ont AUCUNE valeur légale.

Certificat de démonstration
---------------------------
Titulaire (CN) : Signature Exemple Auto-RH
Organisation   : Auto-RH Demonstration — OU Ressources Humaines
Pays           : TN
Validité       : 730 jours à compter de la génération
Empreinte      : visible dans le panneau après import (SHA-256)

Fichiers et mots de passe
-------------------------
signature-exemple.p12   PKCS#12 (certificat + clé privée)
signature-exemple.pfx   PKCS#12 (même contenu, extension .pfx)
    -> Mot de passe à saisir lors de l'import : $MDP
signature-exemple.pkcs7 PKCS#7 générique (chaîne de certificats, DER)
signature-exemple.p7s   PKCS#7 signature DÉTACHÉE du document-origine.txt
signature-exemple.p7m   PKCS#7 données signées ENVELOPPÉES (contient le document)
signature-exemple.xml   XML-DSig enveloppé (certificat X509 embarqué)
signature-exemple.ps7x  Variante XML-DSig (même structure)
certificat-exemple.pem  Certificat X.509 brut (PEM) — format compatible
document-origine.txt    Document signé par .p7s / .p7m

Comment tester
--------------
1. Ouvrir l'administration (port 4000), onglet « Importer »,
   rubrique « Signature électronique & QR code ».
2. Section « Certificat de signature électronique » : choisir un des
   fichiers ci-dessus. Pour .p12/.pfx, saisir le mot de passe $MDP.
3. Le panneau affiche les informations extraites : titulaire, émetteur,
   numéro de série, validité, empreinte SHA-256.
4. Le fichier importé est enregistré CHIFFRÉ sur le disque
   (storage/tampons/, AES-256-GCM) — personne n'accédant au disque ne
   peut récupérer la clé privée qu'il contient.

SÉCURITÉ
--------
- Les fichiers .p12/.pfx contiennent une clé privée : ils sont chiffrés
  au repos et ne sont jamais exportés en clair par l'application.
- Ne JAMAIS utiliser de vrai certificat de production avec ces fichiers
  d'exemple partagés.
TXT

echo "==> 10) ZIP de livraison"
cd "$TRAVAIL"
rm -f "$RACINE/download/signatures-exemple-auto-rh.zip"
zip -q -j "$RACINE/download/signatures-exemple-auto-rh.zip" \
  signature-exemple.p12 signature-exemple.pfx signature-exemple.pkcs7 \
  signature-exemple.p7s signature-exemple.p7m signature-exemple.xml \
  signature-exemple.ps7x certificat-exemple.pem document-origine.txt "$SORTIE/LIRE-MOI.txt"

echo "==> Contrôle des fichiers produits :"
cd "$TRAVAIL"
for f in signature-exemple.p12 signature-exemple.pfx signature-exemple.pkcs7 \
         signature-exemple.p7s signature-exemple.p7m signature-exemple.xml \
         signature-exemple.ps7x; do
  printf "%-28s %6d octets  %s\n" "$f" "$(stat -c%s "$f")" "$(openssl asn1parse -inform DER -in "$f" -i 2>/dev/null | head -1 | cut -c1-60 || echo '?')"
done
echo "--- Vérification PKCS#12 :"
openssl pkcs12 -in signature-exemple.p12 -passin "pass:$MDP" -nokeys -info 2>/dev/null | head -4
echo "--- Vérification XML-DSig :"
python3 -c "from lxml import etree; t=etree.parse('signature-exemple.xml'); ns={'ds':'http://www.w3.org/2000/09/xmldsig#'}; print('Signature XML-DSig présente :', t.find('.//ds:Signature', ns) is not None)"
echo "==> TERMINÉ — fichiers dans $SORTIE"
