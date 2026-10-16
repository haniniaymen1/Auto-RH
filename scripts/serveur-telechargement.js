#!/usr/bin/env node
/**
 * Serveur de téléchargement Auto-RH — port 3000 (backend par défaut Caddy).
 * Sert le contenu de /home/z/my-project/download/ en téléchargement direct.
 * Persistance prouvée : processus Node détaché (setsid + nohup).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const RACINE = '/home/z/my-project/download';
const PORT = process.env.PORT_TELECHARGEMENT || 3000;

const MIME = {
  '.zip': 'application/zip',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

const serveur = http.createServer((req, res) => {
  const urlBrute = (req.url || '/').split('?')[0];
  let url;
  try {
    url = decodeURIComponent(urlBrute);
  } catch {
    res.writeHead(400);
    return res.end('Requete invalide');
  }
  if (url === '/') url = '/index.html';
  const chemin = path.normalize(path.join(RACINE, url));
  if (!chemin.startsWith(RACINE + path.sep) && chemin !== RACINE) {
    res.writeHead(403);
    return res.end('Interdit');
  }
  fs.stat(chemin, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Introuvable : ' + url);
    }
    const ext = path.extname(chemin).toLowerCase();
    const estZip = ext === '.zip';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Content-Disposition':
        (estZip ? 'attachment' : 'inline') + '; filename="' + path.basename(chemin) + '"',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(chemin).on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end('Erreur de lecture');
    }).pipe(res);
  });
});

serveur.listen(PORT, '0.0.0.0', () => {
  console.log(`[telechargement] Serveur actif sur 0.0.0.0:${PORT} — racine ${RACINE}`);
});
serveur.on('error', (e) => {
  console.error('[telechargement] Erreur:', e.message);
  process.exit(1);
});
