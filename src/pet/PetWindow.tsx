import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sprite } from "./Sprite";

export function PetWindow() {
  const ref = useRef<HTMLDivElement>(null);

  // Informa a Rust la zona opaca para el click-through.
  useEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    invoke("set_hit_rect", { rect: [r.x, r.y, r.width, r.height] });
  }, []);

  return (
    <div
      style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "center" }}
    >
      <div ref={ref} onMouseDown={() => getCurrentWindow().startDragging()} style={{ cursor: "grab" }}>
        <Sprite />
      </div>
    </div>
  );
}
