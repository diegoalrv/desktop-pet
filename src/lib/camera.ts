// Cámara durante el foco (F17): abre la webcam solo con un foco corriendo, cada 2 s mira cara, inclinación y
// teléfono con MediaPipe (local, modelos en public/models) y aplica lo que decide `focusCam.step`.
// Nada se guarda: cada frame se analiza y se descarta.
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { FaceLandmarker, ObjectDetector } from "@mediapipe/tasks-vision";
// ponytail: solo el build SIMD (WebKit lo tiene desde macOS 13.3); agregar el nosimd si alguna vez falla al cargar
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import { addSample, basePitch, initCam, step, type CamEvent, type CamState, type Segment } from "./focusCam";
import { logCamSegment } from "./db";
import { clip } from "./sound";
import { notify } from "./ipc";
import { useTimer } from "../store/useTimer";
import { useSettings } from "../store/useSettings";
import type { PetEvent } from "../pet/stateMachine";

const SAMPLE_MS = 2000; // ponytail: 2 inferencias cada 2 s; si pesa en el Monitor de Actividad, subir a 4000
export const PHONE_SCORE = 0.5;
const LOG_SCORE = 0.2; // se guarda el score desde acá (cam_samples) para poder recalibrar PHONE_SCORE después

/** Rectángulo en fracciones del cuadro (0..1), sin espejar. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Seen {
  face: boolean;
  faceBox: Box | null;
  pitch: number | null;
  yaw: number | null;
  roll: number | null;
  phoneScore: number;
  phoneBox: Box | null;
}

export interface Cam {
  video: HTMLVideoElement;
  look(): Seen;
  stop(): void;
}

/** Abre la webcam y los detectores. También la usa la ventana "Ver cámara" (camview), con su propio stream. */
export async function openCam(): Promise<Cam> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  try {
    const video = document.createElement("video");
    video.muted = video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    const { FaceLandmarker, ObjectDetector } = await import("@mediapipe/tasks-vision");
    const files = { wasmLoaderPath, wasmBinaryPath };
    const base = (modelAssetPath: string, delegate: "GPU" | "CPU" = "GPU") => ({ modelAssetPath, delegate });
    const [face, obj]: [FaceLandmarker, ObjectDetector] = await Promise.all([
      FaceLandmarker.createFromOptions(files, {
        baseOptions: base("/models/face_landmarker.task"),
        runningMode: "IMAGE",
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      }),
      ObjectDetector.createFromOptions(files, {
        // CPU: en WebKit, con GPU nunca devolvió un teléfono (score 0 en todas las muestras, aun con el teléfono de
        // frente); la cara en GPU sí anda. EfficientDet-Lite0 en CPU cuesta poco cada 2 s.
        baseOptions: base("/models/efficientdet_lite0.tflite", "CPU"),
        runningMode: "IMAGE",
        scoreThreshold: LOG_SCORE,
        categoryAllowlist: ["cell phone"],
        maxResults: 1,
      }),
    ]);
    return {
      video,
      look() {
        const f = face.detect(video);
        const m = f.facialTransformationMatrixes[0]?.data;
        // Ángulos de la pose (matriz 4x4 column-major, R[f][c] = m[c*4+f]). Pitch verificado: positivo = barbilla
        // hacia el pecho; yaw y roll solo se guardan (signo sin verificar).
        const deg = (r: number) => (r * 180) / Math.PI;
        const pitch = m ? deg(Math.atan2(m[6], m[10])) : null;
        const yaw = m ? deg(Math.asin(Math.max(-1, Math.min(1, -m[2])))) : null;
        const roll = m ? deg(Math.atan2(m[1], m[0])) : null;
        const lm = f.faceLandmarks[0];
        const xs = lm?.map((p) => p.x) ?? [];
        const ys = lm?.map((p) => p.y) ?? [];
        const faceBox = lm
          ? { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
          : null;
        const d = obj.detect(video).detections[0];
        const b = d?.boundingBox;
        const [vw, vh] = [video.videoWidth || 640, video.videoHeight || 480];
        const phoneBox = b ? { x: b.originX / vw, y: b.originY / vh, w: b.width / vw, h: b.height / vh } : null;
        return { face: !!m, faceBox, pitch, yaw, roll, phoneScore: d?.categories[0]?.score ?? 0, phoneBox };
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
  let calib: number[] = []; // calibración de la postura: sobrevive a pausas (ponytail: no al reiniciar la app)
  let seg: Segment | null = null; // tramo en curso para cam_segments; se guarda al cerrarse
  let busy = false;
  let hush: (() => void) | null = null; // calla el gruñido en curso
  // Con la ventana "Ver cámara" abierta, WebKit deja capturar a una sola página (la nueva silencia a la anterior):
  // la mascota suelta su cámara y decide con lo que esa ventana ve (`cam://seen`, ~6 por segundo).
  let ext: { seen: Seen; at: number } | null = null;
  const unExt = listen<Seen>("cam://seen", (e) => (ext = { seen: e.payload, at: Date.now() }));
  const stopGrowl = () => {
    hush?.();
    hush = null;
  };

  const save = (g: Segment | null) =>
    g && void logCamSegment(g).catch((e) => console.warn("cam_segments:", e));
  const close = () => {
    stopGrowl();
    save(seg); // ponytail: si la app se cae a mitad de un tramo, ese tramo se pierde
    seg = null;
    cam?.stop();
    if (st) calib = st.pitches;
    cam = st = null;
  };
  const handle = async (ev: CamEvent, quiet: boolean) => {
    const loud = !quiet && useSettings.getState().prefs.sound;
    switch (ev.type) {
      case "growl": // gruñe seguido hasta que ladra o te calmas
        send({ type: "growl" });
        stopGrowl();
        if (loud) hush = clip("growl", true);
        break;
      case "bark": // Rust suma el tiempo y, en el primero, emite focus://distraction -> oops
        void invoke("focus_phone", { ms: ev.ms, hit: ev.first });
        if (!ev.first) send({ type: "distracted" });
        stopGrowl();
        if (loud) clip("bark");
        break;
      case "calm":
        stopGrowl();
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
    const lent = ext && Date.now() - ext.at < 1000 ? ext.seen : null;
    if (lent && cam) {
      cam.stop(); // sin cerrar el tramo ni perder el estado: solo la cámara
      cam = null;
    }
    if (!lent && !cam) {
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
    }
    st ??= initCam(calib);
    if (st?.away && s.status === "running") st = { ...st, away: false, noFace: null }; // lo reanudaste a mano
    const ctx = await invoke<{ idle: number; meeting: boolean }>("focus_cam_ctx");
    const seen = lent ?? cam!.look();
    const now = Date.now();
    const sample = {
      face: seen.face,
      pitch: seen.pitch,
      phone: seen.phoneScore >= PHONE_SCORE,
      idle: ctx.idle,
      now,
    };
    const r = step(st!, sample, prefs);
    st = r.state;
    const log = addSample(seg, {
      ...seen,
      at: now,
      phone: seen.phoneScore,
      idle: ctx.idle,
      base: basePitch(st),
      events: r.events.map((e) => e.type),
    });
    seg = log.seg;
    save(log.done);
    // Para la ventana "Ver cámara": lo que decidió la mascota (base, umbral, eventos).
    void emit("cam://sample", { base: basePitch(st), down: prefs.headDownDeg, events: r.events.map((e) => e.type) });
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
    void unExt.then((f) => f());
    close();
  };
}
