/** Repro minimal : nodemailer ↔ capteur SMTP artisanal (debug dialogue). */
'use strict';
const net = require('net');
const nodemailer = require('nodemailer');

const messages = [];
const serveur = net.createServer((socket) => {
  let bufferDonnees = null;
  let enVeloppe = { de: null, a: [], brut: Buffer.alloc(0) };
  socket.write('220 auto-rh-test ESMTP capteur\r\n');
  socket.on('data', (chunk) => {
    console.log('<< ' + JSON.stringify(chunk.toString('utf8').slice(0, 80)));
    if (bufferDonnees) {
      enVeloppe.brut = Buffer.concat([enVeloppe.brut, chunk]);
      const fin = enVeloppe.brut.indexOf('\r\n.\r\n');
      if (fin >= 0) {
        messages.push({ de: enVeloppe.de, a: enVeloppe.a, brut: Buffer.from(enVeloppe.brut.subarray(0, fin)) });
        bufferDonnees = null;
        enVeloppe = { de: null, a: [], brut: Buffer.alloc(0) };
        console.log('>> 250 OK message accepte');
        socket.write('250 OK message accepte\r\n');
      }
      return;
    }
    const lignes = chunk.toString('utf8').split('\r\n').filter(Boolean);
    for (const ligne of lignes) {
      const maj = ligne.toUpperCase();
      if (maj.startsWith('EHLO') || maj.startsWith('HELO')) {
        console.log('>> 250 multi');
        socket.write('250-capteur greets you\r\n250 SIZE 35882577\r\n250 8BITMIME\r\n');
      } else if (maj.startsWith('MAIL FROM:')) {
        enVeloppe.de = ligne.slice(10).trim().replace(/[<>]/g, '');
        console.log('>> 250');
        socket.write('250 OK\r\n');
      } else if (maj.startsWith('RCPT TO:')) {
        enVeloppe.a.push(ligne.slice(8).trim().replace(/[<>]/g, ''));
        console.log('>> 250');
        socket.write('250 OK\r\n');
      } else if (maj.startsWith('DATA')) {
        bufferDonnees = true;
        console.log('>> 354');
        socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
      } else if (maj.startsWith('QUIT')) {
        console.log('>> 221');
        socket.write('221 Bye\r\n');
        socket.end();
      } else {
        console.log('>> 250 (autre: ' + ligne.slice(0, 30) + ')');
        socket.write('250 OK\r\n');
      }
    }
  });
  socket.on('error', () => {});
});

serveur.listen(2526, '127.0.0.1', async () => {
  const transport = nodemailer.createTransport({
    host: '127.0.0.1',
    port: 2526,
    secure: false,
    tls: { rejectUnauthorized: false },
  });
  try {
    const info = await transport.sendMail({
      from: 'Auto-RH <auto-rh@test.tn>',
      to: 'employe@test.tn',
      cc: ['rh@test.tn', 'manager@test.tn'],
      subject: 'Test capteur',
      text: 'Bonjour, message de test.',
      attachments: [{ filename: 'doc.pdf', content: Buffer.from('%PDF-1.7 test'), contentType: 'application/pdf' }],
    });
    console.log('SUCCES :', info.messageId, '| réponse:', info.response);
  } catch (e) {
    console.log('ÉCHEC :', e.message);
  }
  console.log('messages captés:', messages.length, messages.map((m) => m.a));
  serveur.close();
  process.exit(0);
});
