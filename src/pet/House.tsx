import { useEffect, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";

/** Casita (px lógicos): mismo tamaño que la ventana `house` (tauri.conf.json); `margin` = HOUSE_MARGIN en windows.rs. */
export const HOUSE = { w: 112, h: 100, margin: 8 };

const CSS = `
@keyframes zz{0%{opacity:0;transform:translate(0,0)}30%{opacity:1}100%{opacity:0;transform:translate(10px,-18px)}}
.zz{animation:zz 2.4s ease-out infinite;font:700 13px system-ui;fill:#5b6b8c}`;

/** Ventana `house`: la casita fija abajo a la izquierda. Clic = "A acostarse" / "Despertar" (lo resuelve la mascota). */
export function HouseWindow() {
  const [home, setHome] = useState(false);
  useEffect(() => {
    const un = listen<boolean>("house://home", (e) => setHome(e.payload));
    return () => void un.then((f) => f());
  }, []);
  return (
    <svg
      width={HOUSE.w}
      height={HOUSE.h}
      viewBox="0 0 112 100"
      style={{ display: "block", cursor: "pointer" }}
      onClick={() => emitTo("pet", "pet://bed")}
    >
      <style>{CSS}</style>
      <title>{home ? "Despertar a la Candola" : "Mandarla a acostarse"}</title>
      <rect x="18" y="44" width="76" height="56" rx="3" fill="#f3e2c7" stroke="#8a5a3b" strokeWidth="2" />
      <path
        d="M8 48 L56 10 L104 48 Z"
        fill="#c8553d"
        stroke="#8a3b2b"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <rect x="74" y="16" width="10" height="18" fill="#8a5a3b" />
      <rect
        x="26"
        y="56"
        width="16"
        height="14"
        rx="2"
        fill={home ? "#f6c453" : "#cfe3f0"}
        stroke="#8a5a3b"
        strokeWidth="2"
      />
      {/* puerta: abierta (hueco oscuro) o cerrada con ella adentro */}
      <path
        d="M52 100 V72 a12 12 0 0 1 24 0 V100 Z"
        fill={home ? "#a0522d" : "#3b2a20"}
        stroke="#8a5a3b"
        strokeWidth="2"
      />
      {home && (
        <>
          <circle cx="71" cy="86" r="1.8" fill="#f6c453" />
          <text className="zz" x="86" y="40">
            z
          </text>
          <text className="zz" x="92" y="30" style={{ animationDelay: "1.2s" }}>
            z
          </text>
        </>
      )}
    </svg>
  );
}
