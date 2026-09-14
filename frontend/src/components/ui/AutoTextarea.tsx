"use client";

import { useEffect, useRef } from "react";

/**
 * Zone de texte qui grandit avec son contenu : pas de barre de défilement
 * interne, tout le texte reste visible. Hauteur minimale = `minRows` lignes.
 * `field-sizing: content` est utilisé quand le navigateur le supporte ; le
 * repli JS ajuste la hauteur sur le scrollHeight à chaque saisie.
 */
export function AutoTextarea({
  id,
  value,
  onChange,
  placeholder,
  maxLength,
  minRows = 5,
  className = "textarea",
  required,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  minRows?: number;
  className?: string;
  required?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  };

  useEffect(() => {
    resize();
  }, [value]);

  useEffect(() => {
    // Recalcule après un changement de largeur (rotation mobile, redimensionnement)
    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <textarea
      id={id}
      ref={ref}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      rows={minRows}
      required={required}
      style={{ overflow: "hidden", resize: "none", minHeight: `${minRows * 1.5 + 1.2}em`, fieldSizing: "content" } as React.CSSProperties}
    />
  );
}
