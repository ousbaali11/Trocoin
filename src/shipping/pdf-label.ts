/**
 * Générateur PDF minimal, sans dépendance : une page 100 × 150 mm (format des étiquettes
 * Colissimo / Mondial Relay), polices standard Helvetica (encodage WinAnsi, accents compris),
 * texte, traits, rectangles et un « code-barres » décoratif dérivé du numéro de suivi.
 * Suffisant pour l'étiquette simulée ; les prestataires réels renvoient leur propre PDF.
 */
const MM = 72 / 25.4;
export const LABEL_WIDTH_PT = Math.round(100 * MM * 100) / 100; // 283.46
export const LABEL_HEIGHT_PT = Math.round(150 * MM * 100) / 100; // 425.2

export type LabelLine = { x: number; y: number; text: string; size?: number; bold?: boolean };

export interface LabelDrawing {
  lines: LabelLine[];
  /** Rectangles (x, y, w, h en mm depuis le coin bas gauche) tracés ou remplis. */
  rects: Array<{ x: number; y: number; w: number; h: number; fill?: boolean; lineWidth?: number }>;
  /** Code-barres : position (mm), largeur et hauteur (mm), chaîne encodée. */
  barcode?: { x: number; y: number; w: number; h: number; value: string };
}

function esc(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\r?\n/g, ' ');
}

/** Barres de largeurs variables (1 à 4 unités) tirées des caractères : lisible à l'œil comme un code-barres, sans norme. */
function barcodeOps(b: NonNullable<LabelDrawing['barcode']>): string {
  const units: number[] = [];
  for (const ch of b.value) {
    const c = ch.charCodeAt(0);
    units.push((c % 3) + 1, ((c >> 2) % 2) + 1, ((c >> 4) % 3) + 1, 1);
  }
  const total = units.reduce((a, u) => a + u, 0);
  const unit = (b.w * MM) / total;
  let x = b.x * MM;
  const ops: string[] = [];
  units.forEach((u, i) => {
    if (i % 2 === 0) ops.push(`${x.toFixed(2)} ${(b.y * MM).toFixed(2)} ${(u * unit).toFixed(2)} ${(b.h * MM).toFixed(2)} re f`);
    x += u * unit;
  });
  return ops.join('\n');
}

export function buildLabelPdf(d: LabelDrawing): Buffer {
  const ops: string[] = [];
  for (const r of d.rects) {
    ops.push(`${(r.lineWidth ?? 0.6).toFixed(2)} w ${(r.x * MM).toFixed(2)} ${(r.y * MM).toFixed(2)} ${(r.w * MM).toFixed(2)} ${(r.h * MM).toFixed(2)} re ${r.fill ? 'f' : 'S'}`);
  }
  if (d.barcode) ops.push(barcodeOps(d.barcode));
  for (const l of d.lines) {
    ops.push(`BT /${l.bold ? 'F2' : 'F1'} ${(l.size ?? 9).toFixed(1)} Tf ${(l.x * MM).toFixed(2)} ${(l.y * MM).toFixed(2)} Td (${esc(l.text)}) Tj ET`);
  }
  const content = Buffer.from(ops.join('\n'), 'latin1');

  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LABEL_WIDTH_PT} ${LABEL_HEIGHT_PT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]),
  ];

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((obj, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), obj, Buffer.from('\nendobj\n')]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f '];
  for (const o of offsets) xref.push(`${String(o).padStart(10, '0')} 00000 n `);
  xref.push('trailer', `<< /Size ${objects.length + 1} /Root 1 0 R >>`, 'startxref', String(length), '%%EOF', '');
  parts.push(Buffer.from(xref.join('\n'), 'latin1'));
  return Buffer.concat(parts);
}
