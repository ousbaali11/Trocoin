"use client";

import { useState } from "react";

/**
 * Champ mot de passe avec bouton « afficher / masquer » (œil). Le bouton fait
 * 44 px de côté (cible tactile), est accessible au clavier et annonce son état.
 */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete = "current-password",
  minLength,
  maxLength = 128,
  required = true,
  invalid = false,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: "current-password" | "new-password";
  minLength?: number;
  maxLength?: number;
  required?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        id={id}
        className="input"
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={maxLength}
        required={required}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        spellCheck={false}
        style={{ paddingRight: 48 }}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Masquer le mot de passe" : "Afficher le mot de passe"}
        aria-pressed={shown}
        title={shown ? "Masquer" : "Afficher"}
        style={{
          position: "absolute",
          top: "50%",
          right: 2,
          transform: "translateY(-50%)",
          width: 44,
          height: 44,
          display: "grid",
          placeItems: "center",
          background: "transparent",
          border: 0,
          borderRadius: "var(--radius-sm)",
          color: "var(--ink-muted)",
          cursor: "pointer",
        }}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
      <path d="M9.9 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1" />
      <path d="M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a10.5 10.5 0 0 0 4.3-.9" />
    </svg>
  );
}
