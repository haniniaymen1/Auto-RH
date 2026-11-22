/** Task 15 — génère public/fiche-icon.png (192x192) : carré vert + fiche blanche */
const { createCanvas } = require("@napi-rs/canvas");
const fs = require("fs");

const S = 192;
const canvas = createCanvas(S, S);
const ctx = canvas.getContext("2d");

// fond : carré arrondi vert emerald-600 (#059669), rayon 14/64 -> 42/192
const r = 42;
ctx.fillStyle = "#059669";
ctx.beginPath();
ctx.moveTo(r, 0);
ctx.lineTo(S - r, 0);
ctx.arcTo(S, 0, S, r, r);
ctx.lineTo(S, S - r);
ctx.arcTo(S, S, S - r, S, r);
ctx.lineTo(r, S);
ctx.arcTo(0, S, 0, S - r, r);
ctx.lineTo(0, r);
ctx.arcTo(0, 0, r, 0, r);
ctx.closePath();
ctx.fill();

// glyphe fiche (lucide file-text) : 24 -> 84 px, offset (192-84)/2 = 54
ctx.save();
ctx.translate(54, 54);
ctx.scale(3.5, 3.5);
ctx.strokeStyle = "#ffffff";
ctx.lineWidth = 2;
ctx.lineCap = "round";
ctx.lineJoin = "round";
ctx.beginPath();
ctx.moveTo(14, 2);
ctx.lineTo(6, 2);
ctx.quadraticCurveTo(4, 2, 4, 4);
ctx.lineTo(4, 20);
ctx.quadraticCurveTo(4, 22, 6, 22);
ctx.lineTo(18, 22);
ctx.quadraticCurveTo(20, 22, 20, 20);
ctx.lineTo(20, 8);
ctx.closePath();
ctx.stroke();
ctx.beginPath();
ctx.moveTo(14, 2);
ctx.lineTo(14, 8);
ctx.lineTo(20, 8);
ctx.stroke();
ctx.beginPath();
ctx.moveTo(16, 13);
ctx.lineTo(8, 13);
ctx.stroke();
ctx.beginPath();
ctx.moveTo(16, 17);
ctx.lineTo(8, 17);
ctx.stroke();
ctx.beginPath();
ctx.moveTo(10, 9);
ctx.lineTo(8, 9);
ctx.stroke();
ctx.restore();

fs.writeFileSync("/home/z/my-project/public/fiche-icon.png", canvas.toBuffer("image/png"));
console.log("OK -> public/fiche-icon.png", fs.statSync("/home/z/my-project/public/fiche-icon.png").size, "octets");
