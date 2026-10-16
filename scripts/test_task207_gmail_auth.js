// Task 207 — Test authentification Gmail RÉEL avec App Password fourni
// Compte : employe.test@autorh.tn / App Password : xxxx xxxx xxxx xxxx
// SMTP smtp.gmail.com:465 (SSL) + IMAP imap.gmail.com:993
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');

const USER = 'employe.test@autorh.tn';
const APP_PASSWORD = 'xxxx xxxx xxxx xxxx';

async function testSMTP() {
  console.log('=== SMTP smtp.gmail.com:465 (SSL) ===');
  const t = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: USER, pass: APP_PASSWORD },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
  });
  await t.verify();
  console.log('VERIFY OK — authentification SMTP acceptée par Google');
  const info = await t.sendMail({
    from: USER,
    to: USER,
    subject: '[Auto-RH Task 207] Test SMTP Gmail — ' + new Date().toISOString(),
    text: 'E-mail de test envoyé par le script de vérification des identifiants Gmail (Auto-RH).',
  });
  console.log('SEND OK — messageId=' + info.messageId + ' response=' + info.response);
  return info.messageId;
}

async function testIMAP() {
  console.log('=== IMAP imap.gmail.com:993 ===');
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: USER, pass: APP_PASSWORD },
    logger: false,
    connectionTimeout: 20000,
    greetingTimeout: 20000,
  });
  await client.connect();
  console.log('CONNECT OK — authentification IMAP acceptée par Google');
  const lock = await client.getMailboxLock('INBOX');
  try {
    const st = client.mailbox;
    console.log('INBOX — exists=' + st.exists);
    // Lister les 3 derniers messages (envelope) pour prouver la LECTURE réelle
    let lus = 0;
    for await (const msg of client.fetch({ seq: Math.max(1, st.exists - 2) + ':' + st.exists }, { envelope: true, uid: true })) {
      lus++;
      console.log('  MSG uid=' + msg.uid + ' from=' + (msg.envelope.from || []).map(f => f.address).join(',') + ' sujet=' + JSON.stringify(msg.envelope.subject));
    }
    console.log('LECTURE OK — ' + lus + ' message(s) lu(s)');
    // Vérifier le message de test SMTP est bien arrivé (recherche par sujet)
    let trouve = false;
    const uids = await client.search({ subject: 'Task 207' }, { uid: true });
    if (uids && uids.length) {
      trouve = true;
      console.log('ALLER-RETOUR COMPLET — le message SMTP est dans INBOX (uid=' + uids.join(',') + ')');
    }
    return { exists: st.exists, lus, trouve };
  } finally {
    lock.release();
    await client.logout();
  }
}

(async () => {
  try {
    const mid = await testSMTP();
    const r = await testIMAP();
    console.log('\n=== RÉSULTAT GLOBAL : GMAIL OPÉRATIONNEL (SMTP + IMAP + aller-retour=' + (r.trouve ? 'OUI' : 'non retrouvé') + ') ===');
    process.exit(0);
  } catch (e) {
    console.error('\n=== ÉCHEC GMAIL ===');
    console.error((e && e.response || e && e.text || e.message || String(e)).slice ? String(e.response || e.text || e.message || e).slice(0, 600) : e);
    process.exit(1);
  }
})();
