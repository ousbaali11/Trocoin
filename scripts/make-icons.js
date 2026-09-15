#!/usr/bin/env node
/**
 * Icônes du site à partir du logo de l'en-tête (carré vert arrondi, « T » blanc) :
 *   frontend/src/app/icon.svg        vectoriel (onglets des navigateurs récents)
 *   frontend/src/app/favicon.ico     16 / 32 / 48 px (navigateurs anciens, favoris Windows)
 *   frontend/src/app/apple-icon.png  180 px (iOS « Sur l'écran d'accueil »)
 * Next.js ajoute lui-même les balises <link rel="icon"> / apple-touch-icon pour ces fichiers.
 * Usage : node scripts/make-icons.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const APP = path.join(__dirname, '..', 'frontend', 'src', 'app');
const ACCENT = '#0f7b5f';

/** Même dessin que Logo.tsx : fond vert arrondi (rayon 7/30), T gras blanc centré (barre + fût, coins légèrement arrondis). */
function svg(size = 64) {
  const r = (7 / 30) * size;
  const bar = { x: 0.24 * size, y: 0.24 * size, w: 0.52 * size, h: 0.15 * size };
  const stem = { x: 0.425 * size, y: 0.24 * size, w: 0.15 * size, h: 0.54 * size };
  const c = 0.03 * size;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${r.toFixed(2)}" fill="${ACCENT}"/>
  <rect x="${bar.x}" y="${bar.y}" width="${bar.w}" height="${bar.h}" rx="${c}" fill="#fff"/>
  <rect x="${stem.x}" y="${stem.y}" width="${stem.w}" height="${stem.h}" rx="${c}" fill="#fff"/>
</svg>
`;
}

/** Conteneur ICO avec des images PNG (accepté par tous les navigateurs actuels et Windows ≥ Vista). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    dir.push(e);
  }
  return Buffer.concat([header, ...dir, ...pngs.map((p) => p.data)]);
}

(async () => {
  fs.writeFileSync(path.join(APP, 'icon.svg'), svg(64));
  const png = async (size) => sharp(Buffer.from(svg(size))).resize(size, size).png().toBuffer();
  const sizes = [16, 32, 48];
  const pngs = [];
  for (const size of sizes) pngs.push({ size, data: await png(size) });
  fs.writeFileSync(path.join(APP, 'favicon.ico'), ico(pngs));
  fs.writeFileSync(path.join(APP, 'apple-icon.png'), await png(180));
  console.log('icon.svg, favicon.ico (16/32/48), apple-icon.png (180) écrits dans', APP);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
