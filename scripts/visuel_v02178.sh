#!/bin/bash
# Vérification VISUELLE v0.2.178 — cadre vert masqué + parrainage dans le
# portail employé. Tout en UNE commande (le bac à sable tue les processus
# d'arrière-plan).
set -u
cd /home/z/my-project

# 1) Serveur portail
(PORTAL_PORT=4001 node scripts/portail-server.js > /tmp/portail-178vis.log 2>&1 &)
sleep 4
curl -s -o /dev/null -w "portail: HTTP %{http_code}\n" http://localhost:4001/ || exit 1

# 2) Semis des données visuelles
node scripts/seed_visuel_v02178.js semer || exit 1

# 3) Code OTP du moment
OTP=$(node -e '
const crypto=require("crypto");
const A="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let bits="";
for(const c of "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"){const v=A.indexOf(c.toUpperCase());if(v>=0)bits+=v.toString(2).padStart(5,"0");}
const oct=[];for(let i=0;i+8<=bits.length;i+=8)oct.push(parseInt(bits.slice(i,i+8),2));
const cle=Buffer.from(oct);const cpt=Math.floor(Date.now()/30000);
const buf=Buffer.alloc(8);buf.writeUInt32BE(Math.floor(cpt/2**32),0);buf.writeUInt32BE(cpt>>>0,4);
const h=crypto.createHmac("sha1",cle).update(buf).digest();const off=h[h.length-1]&0xf;
console.log(String((((h[off]&0x7f)<<24)|(h[off+1]<<16)|(h[off+2]<<8)|h[off+3])%1e6).padStart(6,"0"));')
echo "OTP=$OTP"

# 4) Navigateur : connexion puis page /demandes
agent-browser close > /dev/null 2>&1 || true
agent-browser open http://localhost:4001/ --timeout 20000
sleep 1
agent-browser find first "#cin" fill "TEST17802"
agent-browser find first "#password" fill "Visuel-178!Pass"
agent-browser find first "#otp" fill "$OTP"
agent-browser find role button click --name "Se connecter"
sleep 3
agent-browser get url
agent-browser open http://localhost:4001/demandes
sleep 2
agent-browser wait --text "Historique de mes demandes" --timeout 15000 || true
sleep 2
agent-browser screenshot /home/z/my-project/download/task178-portail-demandes.png --full
echo "=== CONTRÔLES DANS LE DOM ==="
agent-browser eval "JSON.stringify({barreEtapes: document.querySelectorAll('.d-etapes').length, badgesStatut: document.querySelectorAll('.statut-final').length, notesMasquees: document.querySelectorAll('.d-note').length, piecesJointes: document.querySelectorAll('.d-doc').length, texteListe: (document.getElementById('liste-demandes')||{}).innerText ? document.getElementById('liste-demandes').innerText.slice(0,1200) : 'ABSENTE'})"
# 5) Nettoyage + arrêt
node scripts/seed_visuel_v02178.js nettoyer || true
agent-browser close > /dev/null 2>&1 || true
pkill -f "portail-server.js" 2>/dev/null || true
echo "=== FIN VÉRIFICATION VISUELLE ==="
