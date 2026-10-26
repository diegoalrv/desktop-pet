import { useEffect, useState } from "react";
import { btn } from "../panel/ui";
import { useSettings } from "../store/useSettings";

/** Elige prefs.camId, la misma en Ajustes y en "Ver cámara". Lista las cámaras conectadas (se actualiza al
 * enchufar/desenchufar). Sin permiso WebKit no da nombres: se pide una vez. */
export function CamSelect() {
  const value = useSettings((s) => s.prefs.camId);
  const setPrefs = useSettings((s) => s.setPrefs);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const md = navigator.mediaDevices;
    const list = () => md.enumerateDevices().then((d) => d.filter((x) => x.kind === "videoinput"));
    const refresh = async () => {
      let v = await list();
      if (v.length && !v[0].label) {
        const s = await md.getUserMedia({ video: true }).catch(() => null);
        s?.getTracks().forEach((t) => t.stop());
        if (s) v = await list();
      }
      setCams(v);
    };
    void refresh();
    md.addEventListener("devicechange", refresh);
    return () => md.removeEventListener("devicechange", refresh);
  }, []);
  const missing = value && !cams.some((c) => c.deviceId === value);
  return (
    <label>
      Cámara{" "}
      <select
        style={{ ...btn, padding: 4 }}
        value={value}
        onChange={(e) => void setPrefs({ camId: e.target.value })}
      >
        <option value="">La del sistema</option>
        {cams.map((c, i) => (
          <option key={c.deviceId} value={c.deviceId}>
            {c.label || `Cámara ${i + 1}`}
          </option>
        ))}
        {missing && <option value={value}>Desconectada (usa la del sistema)</option>}
      </select>
    </label>
  );
}
