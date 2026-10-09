import type { PetState } from "./stateMachine";

// Placeholder: blob-zorro SVG; la animación por estado es CSS. Se reemplaza por skins en F5.
const ANIM: Record<PetState, string> = {
  idle: "bob 1.1s ease-in-out infinite",
  walk: "hop .35s ease-in-out infinite",
  focus: "bob 2.4s ease-in-out infinite",
  break: "bob 1.8s ease-in-out infinite",
  celebrate: "jump .5s ease-out infinite",
  sleep: "bob 3.5s ease-in-out infinite",
  dragged: "dangle .4s ease-in-out infinite alternate",
  fall: "dangle .4s ease-in-out infinite alternate",
};

const CSS = `
@keyframes bob{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.94) translateY(2px)}}
@keyframes hop{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes jump{0%,100%{transform:translateY(0)}50%{transform:translateY(-22px)}}
@keyframes dangle{from{transform:rotate(-6deg)}to{transform:rotate(6deg)}}`;

export function Sprite({ state, dir = 1, size = 128 }: { state: PetState; dir?: number; size?: number }) {
  const asleep = state === "sleep";
  return (
    <div style={{ transform: `scaleX(${dir})` }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 128 128"
        style={{
          animation: ANIM[state],
          transformOrigin: "50% 100%",
          display: "block",
          opacity: asleep ? 0.8 : 1,
        }}
      >
        <style>{CSS}</style>
        <path d="M30 50 L36 14 L56 38 Z M98 50 L92 14 L72 38 Z" fill="#e8742c" />
        <ellipse cx="64" cy="82" rx="46" ry="38" fill="#f08a3c" />
        <ellipse cx="64" cy="96" rx="26" ry="20" fill="#fff3e0" />
        {asleep ? (
          <path d="M42 76 h12 M74 76 h12" stroke="#222" strokeWidth="3" strokeLinecap="round" />
        ) : (
          <>
            <circle cx="48" cy="76" r="5" fill="#222" />
            <circle cx="80" cy="76" r="5" fill="#222" />
          </>
        )}
        <ellipse cx="64" cy="88" rx="5" ry="3.5" fill="#222" />
      </svg>
    </div>
  );
}
