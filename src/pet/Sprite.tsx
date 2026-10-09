// Placeholder F1: blob-zorro en SVG con "bob" CSS. Se reemplaza por sprite sheets en F5.
export function Sprite({ size = 128 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      style={{ animation: "bob 1.1s ease-in-out infinite", transformOrigin: "50% 100%" }}
    >
      <style>{`@keyframes bob{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.94) translateY(2px)}}`}</style>
      <path d="M30 50 L36 14 L56 38 Z M98 50 L92 14 L72 38 Z" fill="#e8742c" />
      <ellipse cx="64" cy="82" rx="46" ry="38" fill="#f08a3c" />
      <ellipse cx="64" cy="96" rx="26" ry="20" fill="#fff3e0" />
      <circle cx="48" cy="76" r="5" fill="#222" />
      <circle cx="80" cy="76" r="5" fill="#222" />
      <ellipse cx="64" cy="88" rx="5" ry="3.5" fill="#222" />
    </svg>
  );
}
