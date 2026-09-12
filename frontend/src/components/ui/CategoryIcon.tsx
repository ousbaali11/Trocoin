const paths: Record<string, string> = {
  car: "M5 13l1.5-4.5A2 2 0 018.4 7h7.2a2 2 0 011.9 1.5L19 13m-14 0h14v5H5zM7 18v1.5M17 18v1.5M8 15.5h.01M16 15.5h.01",
  home: "M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z",
  briefcase: "M4 8h16v11H4zM9 8V6a2 2 0 012-2h2a2 2 0 012 2v2M4 13h16",
  shirt: "M8 4l4 2 4-2 4 3-2 3-2-1v11H8V9L6 10 4 7z",
  sofa: "M4 12V9a2 2 0 012-2h12a2 2 0 012 2v3M3 12h18v5H3zM5 17v2M19 17v2M12 7v5",
  smartphone: "M8 3h8a1 1 0 011 1v16a1 1 0 01-1 1H8a1 1 0 01-1-1V4a1 1 0 011-1zM11 18h2",
  gamepad: "M6 9h12a3 3 0 013 3v3a3 3 0 01-3 3H6a3 3 0 01-3-3v-3a3 3 0 013-3zM8 12v3M6.5 13.5h3M15 12h.01M17 14h.01",
  wrench: "M14 6a4 4 0 015 5l-8 8-3-3 8-8a4 4 0 01-2-2zM4 20l3-3",
  handshake: "M3 11l4-4 5 3 5-3 4 4-4 5-3-2-2 2-3-2-3 3z",
  sun: "M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z",
  baby: "M12 4a2 2 0 100 4 2 2 0 000-4zM8 20v-7a4 4 0 018 0v7M7 13l-2 3M17 13l2 3",
  paw: "M12 11c2.5 0 5 2 5 5 0 1.5-1 2.5-2.5 2.5-1 0-1.5-.5-2.5-.5s-1.5.5-2.5.5C8 18.5 7 17.5 7 16c0-3 2.5-5 5-5zM7 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM10 6a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM14 6a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
  default: "M4 6h16M4 12h16M4 18h16",
};

export function CategoryIcon({ name, size = 22 }: { name?: string | null; size?: number }) {
  const d = paths[name || "default"] || paths.default;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
