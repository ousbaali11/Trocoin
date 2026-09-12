"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";

/**
 * Recadrage intégré (avant envoi) : cadre 4:3, déplacement à la souris /
 * au doigt, zoom, rotation 90°. Produit un JPEG ≤ 1600 px via canvas.
 */
export function PhotoCropper({ file, onDone, onCancel }: { file: File | null; onDone: (cropped: File) => void; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const W = 480;
  const H = 360;

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setZoom(1);
      setRotation(0);
      setOffset({ x: 0, y: 0 });
      draw(img, 1, 0, { x: 0, y: 0 });
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const draw = (img: HTMLImageElement, z: number, rot: number, off: { x: number; y: number }, target?: HTMLCanvasElement, scale = 1) => {
    const canvas = target || canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const w = W * scale;
    const h = H * scale;
    canvas.width = w;
    canvas.height = h;
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);
    const rotated = rot % 180 !== 0;
    const iw = rotated ? img.height : img.width;
    const ih = rotated ? img.width : img.height;
    const base = Math.max(w / iw, h / ih); // couvre le cadre
    const s = base * z;
    ctx.save();
    ctx.translate(w / 2 + off.x * scale, h / 2 + off.y * scale);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(img, (-img.width * s) / 2, (-img.height * s) / 2, img.width * s, img.height * s);
    ctx.restore();
  };

  useEffect(() => {
    if (imgRef.current) draw(imgRef.current, zoom, rotation, offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, rotation, offset]);

  const start = (x: number, y: number) => (drag.current = { x, y, ox: offset.x, oy: offset.y });
  const move = (x: number, y: number) => {
    if (!drag.current) return;
    setOffset({ x: drag.current.ox + (x - drag.current.x), y: drag.current.oy + (y - drag.current.y) });
  };

  const confirm = () => {
    const img = imgRef.current;
    if (!img) return;
    const out = document.createElement("canvas");
    draw(img, zoom, rotation, offset, out, 1600 / W);
    out.toBlob((blob) => {
      if (!blob) return;
      onDone(new File([blob], file!.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }));
    }, "image/jpeg", 0.88);
  };

  return (
    <Modal open={!!file} onClose={onCancel} title="Recadrer la photo" width={560}>
      <p className="small muted">Déplacez l&apos;image pour choisir le cadrage (format 4:3), zoomez ou pivotez.</p>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{ width: "100%", borderRadius: 8, cursor: "grab", touchAction: "none", background: "#111" }}
        onMouseDown={(e) => start(e.clientX, e.clientY)}
        onMouseMove={(e) => move(e.clientX, e.clientY)}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => (drag.current = null)}
        onTouchStart={(e) => start(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchMove={(e) => move(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchEnd={() => (drag.current = null)}
      />
      <div className="row" style={{ marginTop: 12 }}>
        <label className="row small" style={{ flex: 1 }}>
          Zoom
          <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ flex: 1 }} aria-label="Zoom" />
        </label>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setRotation((r) => (r + 90) % 360)}>↻ Pivoter</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); setRotation(0); }}>Réinitialiser</button>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        <button type="button" className="btn btn-outline" onClick={onCancel}>Garder l&apos;original</button>
        <button type="button" className="btn btn-primary" onClick={confirm}>Valider le recadrage</button>
      </div>
    </Modal>
  );
}
