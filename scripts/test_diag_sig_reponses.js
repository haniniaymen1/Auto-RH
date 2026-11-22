/* Diagnostic — signature électronique + cachet « Signature électronique »
 * sur les réponses automatiques PDF (Task 185, v0.2.145/146).
 * Lit l'état RÉEL de ReponsePdfConfig + fichiers certificat + options appelant.
 */
const path = require('path');
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const fs = require('fs');
  const masque = (v) => (v ? String(v).slice(0, 4) + '…(' + String(v).length + ' car.)' : '(vide)');

  console.log('=== 1) ReponsePdfConfig (singleton reponse-pdf) ===');
  const rpc = await prisma.reponsePdfConfig.findUnique({ where: { id: 'reponse-pdf' } });
  if (!rpc) {
    console.log('ABSENTE — la configuration dédiée n\'a jamais été créée → comportement historique (module).');
  } else {
    const masque = (v) => (v ? String(v).slice(0, 4) + '…(' + String(v).length + ' car.)' : '(vide)');
    console.log(JSON.stringify({
      actif: rpc.actif,
      sigActif: rpc.sigActif,
      tamponActif: rpc.tamponActif,
      signerActif: rpc.signerActif,
      elecActif: rpc.elecActif,
      certActif: rpc.certActif,
      certChemin: rpc.certChemin || '(vide)',
      certFichierNom: rpc.certFichierNom || '(vide)',
      certSujet: rpc.certSujet || '(vide)',
      certEmetteur: rpc.certEmetteur || '(vide)',
      certEmpreinte: rpc.certEmpreinte || '(vide)',
      certMotDePasse: masque(rpc.certMotDePasse),
      certImportLe: rpc.certImportLe,
      certValideAu: rpc.certValideAu,
      updatedAt: rpc.updatedAt,
    }, null, 2));
    if (rpc.certChemin) {
      const chemin = path.join(process.cwd(), 'storage', rpc.certChemin.replace(/^storage[\\/]/, ''));
      console.log('Fichier certificat :', chemin, '→', fs.existsSync(chemin) ? 'PRÉSENT (' + fs.statSync(chemin).size + ' octets)' : 'ABSENT SUR DISQUE');
    }
  }

  console.log('\n=== 2) storage/reponse-pdf/ ===');
  const dossier = path.join(process.cwd(), 'storage', 'reponse-pdf');
  if (fs.existsSync(dossier)) {
    const fichiers = fs.readdirSync(dossier);
    console.log(fichiers.length ? fichiers.join('\n') : '(dossier vide)');
  } else {
    console.log('(dossier inexistant)');
  }

  console.log('\n=== 3) SignatureApiConfig (module) + SignatureConfig (Import) ===');
  const sac = await prisma.signatureApiConfig.findUnique({ where: { id: 'signature-api' } });
  if (sac) {
    console.log(JSON.stringify({
      actif: sac.actif, signerReponses: sac.signerReponses,
      certChemin: sac.certChemin || '(vide)',
      certSujet: sac.certSujet || '(vide)',
      certMotDePasse: masque(sac.certMotDePasse),
    }, null, 2));
  } else {
    console.log('SignatureApiConfig ABSENTE');
  }
  const sc = await prisma.signatureConfig.findUnique({ where: { id: 'signature' } });
  console.log('SignatureConfig :', sc ? JSON.stringify({ docSigActif: sc.docSigActif, tamponActif: sc.tamponActif, docElecActif: sc.docElecActif, signerActif: sc.signerActif, certChemin: sc.certChemin || '(vide)' }) : 'ABSENTE');

  console.log('\n=== 4) Dernières demandes + documents générés ===');
  const demandes = await prisma.demandeAdministrative.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
  for (const d of demandes) {
    const docs = await prisma.documentDemande.findMany({ where: { demandeId: d.id } });
    console.log('-', d.reference, d.type, d.statut, '| docSigneChemin:', d.docSigneChemin || '(aucun)', '| docs:', docs.map((x) => x.nomFichier + '(' + x.taille + 'o)').join(', ') || '(aucun)');
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error('ERREUR:', e); process.exit(1); });
