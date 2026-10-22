import type { PetState } from "./stateMachine";
import type { Skin } from "../skins/loader";
import { pickAnim, topInset } from "../skins/schema";

// Animación CSS por estado: zorro SVG integrado y skins de imagen única (1 frame).
const ANIM: Record<PetState, string> = {
  idle: "bob 1.1s ease-in-out infinite",
  walk: "hop .35s ease-in-out infinite",
  focus: "bob 2.4s ease-in-out infinite",
  break: "bob 1.8s ease-in-out infinite",
  celebrate: "jump .5s ease-out infinite",
  sleep: "bob 3.5s ease-in-out infinite",
  dragged: "dangle .4s ease-in-out infinite alternate",
  fall: "dangle .4s ease-in-out infinite alternate",
  attention: "perk 1.6s ease-in-out infinite",
  work: "bob .6s ease-in-out infinite",
  mission: "jump .5s ease-out infinite",
  oops: "bob 3.5s ease-in-out infinite",
  ask: "perk 1.2s ease-in-out infinite",
  tea: "bob 3.5s ease-in-out infinite",
  listen: "perk 1.2s ease-in-out infinite",
  growl: "dangle .12s ease-in-out infinite alternate",
  bark: "hop .3s ease-in-out infinite",
  away: "bob 3.5s ease-in-out infinite",
};

const CSS = `
@keyframes bob{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.94) translateY(2px)}}
@keyframes perk{0%,100%{transform:translateY(0) scale(1.03)}50%{transform:translateY(-3px) scale(1.03)}}
@keyframes hop{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes jump{0%,100%{transform:translateY(0)}50%{transform:translateY(-22px)}}
@keyframes dangle{from{transform:rotate(-6deg)}to{transform:rotate(6deg)}}`;

/** Tamaño en pantalla (px lógicos): el alto lo fija el ajuste `petSize`, el ancho sigue la proporción del frame. */
export function spriteSize(skin: Skin, size: number) {
  if (skin.kind === "builtin") return { w: size, h: size };
  const { frameWidth: fw, frameHeight: fh } = skin.manifest;
  return { w: Math.round((fw * size) / fh), h: size };
}

/** Ánimo actual: hay música sonando y qué variante toca (cambia cada MOOD_S). */
export interface Mood {
  music: boolean;
  slot: number;
}

/** Px lógicos vacíos sobre el sprite en reposo (para pegar el timer a la cabeza). */
export async function headroom(skin: Skin, size: number) {
  if (skin.kind === "builtin") return 0;
  const img = new Image();
  img.src = skin.urls[skin.manifest.animations.idle.file];
  await img.decode();
  const g = new OffscreenCanvas(img.width, img.height).getContext("2d")!;
  g.drawImage(img, 0, 0);
  return topInset(g.getImageData(0, 0, img.width, img.height).data, img.width, img.height) * size;
}

export function Sprite({
  skin,
  state,
  dir = 1,
  mood,
  size,
}: {
  skin: Skin;
  state: PetState;
  dir?: number;
  mood: Mood;
  size: number;
}) {
  const { w, h } = spriteSize(skin, size);
  return (
    <div style={{ transform: `scaleX(${dir})`, width: w, height: h }}>
      <style>{CSS}</style>
      {skin.kind === "builtin" ? (
        <Builtin state={state} size={size} />
      ) : (
        <Pack skin={skin} state={state} w={w} h={h} mood={mood} />
      )}
    </div>
  );
}

function Pack({
  skin,
  state,
  w,
  h,
  mood,
}: {
  skin: Extract<Skin, { kind: "pack" }>;
  state: PetState;
  w: number;
  h: number;
  mood: Mood;
}) {
  const { key, anim } = pickAnim(skin.manifest, state, mood.music, mood.slot);
  const url = skin.urls[anim.file];
  if (anim.frames === 1)
    return (
      <img
        src={url}
        draggable={false}
        style={{
          width: w,
          height: h,
          objectFit: "contain",
          animation: ANIM[state],
          transformOrigin: "50% 100%",
          display: "block",
        }}
      />
    );
  const name = `sheet_${skin.manifest.id.replace(/\W/g, "_")}_${key}`;
  return (
    <div
      key={`${skin.manifest.id}-${key}`} // reinicia la animación al cambiar de estado (celebrate no loop)
      style={{
        width: w,
        height: h,
        backgroundImage: `url(${url})`,
        backgroundSize: `${anim.frames * w}px ${h}px`,
        imageRendering: "pixelated",
        animation: `${name} ${anim.frames / anim.fps}s steps(${anim.frames}) ${anim.loop ? "infinite" : "1 forwards"}`,
      }}
    >
      <style>{`@keyframes ${name}{from{background-position-x:0}to{background-position-x:-${anim.frames * w}px}}`}</style>
    </div>
  );
}

function Builtin({ state, size }: { state: PetState; size: number }) {
  const asleep = state === "sleep" || state === "away";
  return (
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
  );
}
