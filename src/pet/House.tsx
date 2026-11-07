import { useEffect, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";

/** Casita (px lógicos): mismo tamaño que la ventana `house` (tauri.conf.json); `margin` = HOUSE_MARGIN en windows.rs.
 * `door` = centro de la puerta medido desde el borde izquierdo de la casita (la mascota se para ahí). */
export const HOUSE = { w: 112, h: 100, margin: 8, door: 68 };

// Pixel art 28×25, cada celda = 4 px. r/h/R techo, C chimenea, w/W muro, G vidrio, D puerta, k pomo.
const GRID = [
  "..................rrrrr.....",
  "..................rCCCr.....",
  ".............rr...rCCCr.....",
  "............rhRr..rCCCr.....",
  "...........rhRRRr.rCCCr.....",
  "..........rhRRRRRrrCCCr.....",
  ".........rhRRRRRRRrCCCr.....",
  "........rhRRRRRRRRRrCCr.....",
  ".......rhRRRRRRRRRRRrCr.....",
  "......rhRRRRRRRRRRRRRrr.....",
  ".....rhRRRRRRRRRRRRRRRr.....",
  "....rhRRRRRRRRRRRRRRRRRr....",
  "...rhRRRRRRRRRRRRRRRRRRRr...",
  "..rhRRRRRRRRRRRRRRRRRRRRRr..",
  ".rhRRRRRRRRRRRRRRRRRRRRRRRr.",
  ".rrrrrrrrrrrrrrrrrrrrrrrrrr.",
  "...wWWWWWWWWWWWWWWWWWWWWw...",
  "...wWWwwwwwWWWwwwwwwWWWWw...",
  "...wWWwGwGwWWWwDDDDwWWWWw...",
  "...wWWwwwwwWWWwDDDDwWWWWw...",
  "...wWWwGwGwWWWwDDDDwWWWWw...",
  "...wWWwwwwwWWWwDDkDwWWWWw...",
  "...wWWWWWWWWWWwDDDDwWWWWw...",
  "...wWWWWWWWWWWwDDDDwWWWWw...",
  "...wwwwwwwwwwwwDDDDwwwwww...",
];
const PX = 4;
const BASE: Record<string, string> = {
  r: "#6b2f22",
  h: "#e0735a",
  R: "#c8553d",
  C: "#8a5a3b",
  w: "#6b4430",
  W: "#f3e2c7",
};
// Con ella adentro: ventana encendida y puerta cerrada (madera con pomo); si no, vidrio claro y hueco oscuro.
const palette = (home: boolean): Record<string, string> => ({
  ...BASE,
  G: home ? "#f6c453" : "#cfe3f0",
  D: home ? "#a0522d" : "#3b2a20",
  k: home ? "#f6c453" : "#3b2a20",
});

/** Tramos horizontales del mismo color (menos <rect> que uno por celda). */
const runs = GRID.flatMap((row, y) => {
  const out: { x: number; y: number; n: number; c: string }[] = [];
  for (let x = 0; x < row.length;) {
    let n = 1;
    while (row[x + n] === row[x]) n++;
    if (row[x] !== ".") out.push({ x, y, n, c: row[x] });
    x += n;
  }
  return out;
});

// "z" de 4×4 celdas de 2 px que sube y se desvanece.
const Z = ["####", "..#.", ".#..", "####"].flatMap((r, y) =>
  [...r].flatMap((c, x) => (c === "#" ? [[x, y]] : [])),
);
const CSS = `
@keyframes zz{0%{opacity:0;transform:translate(0,0)}30%{opacity:1}100%{opacity:0;transform:translate(-8px,-16px)}}
.zz{animation:zz 2.4s steps(6) infinite}`;

/** Ventana `house`: la casita fija abajo a la derecha. Clic = "A acostarse" / "Despertar" (lo resuelve la mascota). */
export function HouseWindow() {
  const [home, setHome] = useState(false);
  useEffect(() => {
    const un = listen<boolean>("house://home", (e) => setHome(e.payload));
    return () => void un.then((f) => f());
  }, []);
  const pal = palette(home);
  return (
    <svg
      width={HOUSE.w}
      height={HOUSE.h}
      viewBox="0 0 112 100"
      shapeRendering="crispEdges"
      style={{ display: "block", cursor: "pointer" }}
      onClick={() => emitTo("pet", "pet://bed")}
    >
      <style>{CSS}</style>
      <title>{home ? "Despertar a la Candola" : "Mandarla a acostarse"}</title>
      {runs.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x * PX} y={r.y * PX} width={r.n * PX} height={PX} fill={pal[r.c]} />
      ))}
      {home &&
        [
          { x: 30, y: 14, d: "0s" },
          { x: 18, y: 2, d: "1.2s" },
        ].map((z) => (
          <g key={z.d} className="zz" style={{ animationDelay: z.d }}>
            {Z.map(([x, y]) => (
              <rect key={`${x}-${y}`} x={z.x + x * 2} y={z.y + y * 2} width={2} height={2} fill="#5b6b8c" />
            ))}
          </g>
        ))}
    </svg>
  );
}
