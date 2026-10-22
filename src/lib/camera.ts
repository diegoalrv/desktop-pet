// Cámara durante el foco (F17): abre la webcam solo con un foco corriendo, cada 2 s mira cara, inclinación y
// teléfono con MediaPipe (local, modelos en public/models) y aplica lo que decide `focusCam.step`.
// Nada se guarda: cada frame se analiza y se descarta.
import { invoke } from "@tauri-apps/api/core";
import type { FaceLandmarker, ObjectDetector } from "@mediapipe/tasks-vision";
// ponytail: solo el build SIMD (WebKit lo tiene desde macOS 13.3); agregar el nosimd si alguna vez falla al cargar
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import { initCam, step, type CamEvent, type CamState } from "./focusCam";
import { clip } from "./sound";
import { notify } from "./ipc";
import { useTimer } from "../store/useTimer";
import { useSettings } from "../store/useSettings";
import type { PetEvent } from "../pet/stateMachine";

const SAMPLE_MS = 2000; // ponytail: 2 inferencias cada 2 s; si pesa en el Monitor de Actividad, subir a 4000
const PHONE_SCORE = 0.5;

interface Cam {
  look(): { face: boolean; pitch: number | null; phone: boolean };
  stop(): void;
}

async function openCam(): Promise<Cam> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  try {
    const video = document.createElement("video");
    video.muted = video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    const { FaceLandmarker, ObjectDetector } = await import("@mediapipe/tasks-vision");
    const files = { wasmLoaderPath, wasmBinaryPath };
    const base = (modelAssetPath: string) => ({ modelAssetPath, delegate: "GPU" as const });
    const [face, obj]: [FaceLandmarker, ObjectDetector] = await Promise.all([
      FaceLandmarker.createFromOptions(files, {
        baseOptions: base("/models/face_landmarker.task"),
        runningMode: "IMAGE",
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      }),
      ObjectDetector.createFromOptions(files, {
        baseOptions: base("/models/efficientdet_lite0.tflite"),
        runningMode: "IMAGE",
        scoreThreshold: PHONE_SCORE,
        categoryAllowlist: ["cell phone"],
        maxResults: 1,
      }),
    ]);
    return {
      look() {
        const f = face.detect(video);
        const m = f.facialTransformationMatrixes[0]?.data;
        // Rotación en X de la pose (matriz 4x4 column-major): positivo = barbilla hacia el pecho.
        const pitch = m ? (Math.atan2(m[6], m[10]) * 180) / Math.PI : null;
        const phone = obj.detect(video).detections.length > 0;
        if (import.meta.env.DEV) console.debug("cam", { face: !!m, pitch: pitch?.toFixed(1), phone });
        return { face: !!m, pitch, phone };
      },
      stop() {
        stream.getTracks().forEach((t) => t.stop()); // apaga el LED
        face.close();
        obj.close();
      },
    };
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
}

/** Vigila mientras `focusCam` esté activa. La cámara solo está abierta en foco corriendo, o pausado por
 *  ausencia (para verte volver). Devuelve la función que la detiene. */
export function watchFocusCam(send: (ev: PetEvent) => void): () => void {
  let cam: Cam | null = null;
  let st: CamState | null = null; // st.away = el foco está pausado porque te fuiste
  let busy = false;

  const close = () => {
    cam?.stop();
    cam = st = null;
  };
  const handle = async (ev: CamEvent, quiet: boolean) => {
    const loud = !quiet && useSettings.getState().prefs.sound;
    switch (ev.type) {
      case "growl":
        send({ type: "growl" });
        if (loud) clip("growl");
        break;
      case "bark": // Rust suma el tiempo y, en el primero, emite focus://distraction -> oops
        void invoke("focus_phone", { ms: ev.ms, hit: ev.first });
        if (!ev.first) send({ type: "distracted" });
        if (loud) clip("bark");
        break;
      case "calm":
        if (ev.ms) void invoke("focus_phone", { ms: ev.ms, hit: false });
        break;
      case "away":
        await invoke("timer_pause"); // antes de la próxima muestra, que si lo ve corriendo cree que lo reanudaste
        send({ type: "away" });
        break;
      case "back":
        send({ type: "back" });
        notify("Pausé el foco cuando te fuiste", "Reanúdalo cuando quieras.");
        break;
    }
  };

  const tick = async () => {
    const { prefs, setPrefs } = useSettings.getState();
    const s = useTimer.getState().snap;
    if (
      !prefs.focusCam ||
      s.mode !== "focus" ||
      !(s.status === "running" || (s.status === "paused" && st?.away))
    )
      return close();
    if (!cam) {
      try {
        cam = await openCam();
      } catch (e) {
        await setPrefs({ focusCam: false });
        const denied = e instanceof DOMException && e.name === "NotAllowedError";
        notify(
          "No pude usar la cámara",
          denied
            ? "Dale permiso en Ajustes del Sistema → Privacidad → Cámara y actívala de nuevo."
            : String(e),
        );
        return;
      }
      st = initCam();
    }
    if (st?.away && s.status === "running") st = { ...st, away: false, noFace: null }; // lo reanudaste a mano
    const ctx = await invoke<{ idle: number; meeting: boolean }>("focus_cam_ctx");
    const r = step(st!, { ...cam.look(), idle: ctx.idle, now: Date.now() }, prefs);
    st = r.state;
    for (const ev of r.events) await handle(ev, ctx.meeting);
  };

  const id = setInterval(() => {
    if (busy) return;
    busy = true;
    tick()
      .catch((e) => console.warn("cámara del foco:", e))
      .finally(() => (busy = false));
  }, SAMPLE_MS);
  return () => {
    clearInterval(id);
    close();
  };
}
