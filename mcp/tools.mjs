// Herramientas de la Candola (tareas, timer, rutinas, reuniones, sugerencias). Las comparten el servidor MCP
// (`pet-mcp.mjs`, chat con `claude -p`) y el chat de Windows por el proxy (`src/lib/candolaChat.ts`).
// Sin imports de node: corre igual en node y en el webview.

const obj = (properties = {}, required = []) => ({ type: "object", properties, required });
const int = { type: "integer" };
const str = { type: "string" };
const id = obj({ id: int }, ["id"]);

export const TOOLS = [
  {
    name: "list_tasks",
    description:
      "Tareas del usuario. filter: today (pendientes que vencen hoy o antes), pending (todas las pendientes, por defecto) o all (incluye hechas). priority: 0 baja, 1 media, 2 alta; due en hora local. description es la ficha (qué es la tarea); comments, cuántos comentarios tiene. Para la ficha completa con comentarios: task_get.",
    inputSchema: obj({ filter: { type: "string", enum: ["today", "pending", "all"] } }),
  },
  {
    name: "add_task",
    description:
      'Crea una tarea. due: fecha local "AAAA-MM-DD" o "AAAA-MM-DD HH:MM" (sin hora = 09:00). priority: 0 baja, 1 media, 2 alta. repeat: none, daily, weekdays, weekly o monthly (necesita due). description: la ficha (qué hay que hacer, contexto, cuándo está lista).',
    inputSchema: obj(
      {
        title: str,
        description: str,
        due: str,
        project: str,
        priority: { type: "integer", minimum: 0, maximum: 2 },
        est_pomodoros: { type: "integer", minimum: 1 },
        repeat: { type: "string", enum: ["none", "daily", "weekdays", "weekly", "monthly"] },
      },
      ["title"],
    ),
  },
  {
    name: "suggest_task",
    description:
      'Propone un cambio en las tareas sin hacerlo: queda en "Propuestas" de la app y el usuario lo aprueba o descarta. op: crear (por defecto), editar o completar (estos dos con id de list_tasks). title: la tarea nueva o la existente; new_title solo al editar. date: "AAAA-MM-DD". priority: 0 baja, 1 media, 2 alta. description: la ficha de la tarea (qué es, contexto, cuándo está lista). detail: de dónde salió, en una línea.',
    inputSchema: obj(
      {
        op: { type: "string", enum: ["crear", "editar", "completar"] },
        id: int,
        title: str,
        new_title: str,
        project: str,
        priority: { type: "integer", minimum: 0, maximum: 2 },
        date: str,
        pomodoros: { type: "integer", minimum: 1 },
        description: str,
        detail: str,
      },
      ["title"],
    ),
  },
  {
    name: "task_get",
    description:
      "Ficha completa de una tarea (id de list_tasks): todos sus campos, description, tiempo de foco total y sus comentarios en orden (author: Yo = el usuario, Candola o Claude).",
    inputSchema: id,
  },
  {
    name: "update_task",
    description:
      'Edita una tarea: solo cambia los campos que pases. description reemplaza la ficha entera (léela antes con task_get si vas a agregarle algo). due: "AAAA-MM-DD" o "AAAA-MM-DD HH:MM", o "" para quitar la fecha. priority: 0 baja, 1 media, 2 alta. Para reabrir una hecha: done false.',
    inputSchema: obj(
      {
        id: int,
        title: str,
        description: str,
        project: str,
        priority: { type: "integer", minimum: 0, maximum: 2 },
        due: str,
        est_pomodoros: { type: "integer", minimum: 1 },
        repeat: { type: "string", enum: ["none", "daily", "weekdays", "weekly", "monthly"] },
        done: { type: "boolean" },
      },
      ["id"],
    ),
  },
  {
    name: "comment_task",
    description:
      "Deja un comentario en la bitácora de una tarea (avance, decisión, bloqueo, link). Queda firmado y con fecha.",
    inputSchema: obj({ id: int, body: str }, ["id", "body"]),
  },
  {
    name: "complete_task",
    description:
      "Cierra una tarea (si se repite, la app crea la siguiente). comment: opcional, cómo quedó o por qué se cierra; va a su bitácora.",
    inputSchema: obj({ id: int, comment: str }, ["id"]),
  },
  {
    name: "timer_get",
    description:
      "Estado del timer pomodoro: mode (focus, short, long), status (idle, running, paused), remaining en segundos y task_id.",
    inputSchema: obj(),
  },
  {
    name: "timer_start",
    description:
      "Arranca el timer. mode: focus (por defecto), short o long (pausas). minutes: opcional, si no la duración de Ajustes. task_id: la tarea en la que se enfoca.",
    inputSchema: obj({
      mode: { type: "string", enum: ["focus", "short", "long"] },
      minutes: { type: "integer", minimum: 1 },
      task_id: int,
    }),
  },
  { name: "timer_pause", description: "Pausa el timer en curso.", inputSchema: obj() },
  { name: "timer_resume", description: "Reanuda el timer pausado.", inputSchema: obj() },
  {
    name: "timer_stop",
    description: "Termina el bloque actual (lo trabajado en un foco queda registrado).",
    inputSchema: obj(),
  },
  {
    name: "routines_list",
    description:
      "Rutinas del modo Foco (ciclos propios hechos de actividades): id, nombre, si está activa y sus bloques en orden con minutos. Sin rutina activa el timer usa el ciclo clásico de Ajustes.",
    inputSchema: obj(),
  },
  {
    name: "routine_activate",
    description:
      "Activa una rutina por id (de routines_list); sin id vuelve al ciclo clásico. start: true arranca además el bloque que toca si el timer está en reposo.",
    inputSchema: obj({ id: int, start: { type: "boolean" } }),
  },
  {
    name: "meetings_list",
    description:
      "Reuniones grabadas, la más reciente primero: id, fecha, título, proyecto, participantes y resumen.",
    inputSchema: obj({ limit: { type: "integer", minimum: 1 } }),
  },
  {
    name: "meeting_get",
    description:
      "Una reunión completa: transcripción (Yo = el usuario, Otros = el resto), resumen, decisiones y tareas sugeridas.",
    inputSchema: id,
  },
  {
    name: "meeting_search",
    description:
      "Busca un texto (sin distinguir mayúsculas) en todas las transcripciones; devuelve las líneas que calzan con su reunión.",
    inputSchema: obj({ q: str }, ["q"]),
  },
  {
    name: "suggestions_list",
    description:
      "Tareas sugeridas por las reuniones, pendientes de revisar. action (si no es null) es lo que propone el modo Gestión: crear, editar o completar.",
    inputSchema: obj(),
  },
  {
    name: "suggestion_set",
    description:
      "Marca una sugerencia como accepted o dismissed. Aceptar NO crea ni cambia la tarea: hazlo antes con add_task o complete_task.",
    inputSchema: obj({ id: int, status: { type: "string", enum: ["accepted", "dismissed"] } }, [
      "id",
      "status",
    ]),
  },
];

// Fuera de la app (sin PET_TOKEN: Claude Code, Claude Desktop/Cowork) no crea tareas: las propone con suggest_task y
// el usuario las revisa en la app. Sí puede editar, comentar y cerrar las que ya existen (pedido del usuario, 2026-11).
const DIRECT = ["add_task", "suggestion_set"];
export const toolsFor = (external) => (external ? TOOLS.filter((t) => !DIRECT.includes(t.name)) : TOOLS);

const REPEATS = ["none", "daily", "weekdays", "weekly", "monthly"];

/** Argumentos de update_task → columnas a cambiar (solo las presentes). Las claves son fijas: van tal cual al SQL. */
export function taskChanges(a) {
  const set = {};
  if (a.title !== undefined) {
    if (!String(a.title).trim()) throw new Error("title no puede quedar vacío");
    set.title = String(a.title).trim();
  }
  if (a.description !== undefined) set.description = String(a.description).trim() || null;
  if (a.project !== undefined) set.project = String(a.project).trim() || null;
  if (a.priority !== undefined) set.priority = Math.min(2, Math.max(0, Number(a.priority)));
  if (a.est_pomodoros !== undefined) set.est_pomodoros = Math.max(1, Number(a.est_pomodoros));
  if (a.repeat !== undefined) {
    if (!REPEATS.includes(a.repeat)) throw new Error(`repeat debe ser ${REPEATS.join(", ")}`);
    set.repeat = a.repeat;
  }
  if (a.due !== undefined) {
    set.due_at = String(a.due).trim() ? parseDue(a.due) : null;
    set.notified = 0; // fecha nueva: vuelve a avisar
  }
  return set;
}

/** "AAAA-MM-DD" o "AAAA-MM-DD HH:MM" en hora local → epoch ms. Sin hora, 09:00 (como las fechas del modo Gestión). */
export function parseDue(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(String(s).trim());
  const bad = new Error(`fecha inválida: ${s} (usa AAAA-MM-DD o AAAA-MM-DD HH:MM)`);
  if (!m) throw bad;
  const [y, mo, d, h = 9, mi = 0] = m.slice(1).map((x) => (x === undefined ? undefined : Number(x)));
  const dt = new Date(y, mo - 1, d, h, mi);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d || h > 23 || mi > 59)
    throw bad;
  return dt.getTime();
}

export function fmtMs(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Líneas de las transcripciones que contienen `q` (sin distinguir mayúsculas), como "id · línea". Máximo `max`. */
export function search(meetings, q, max = 40) {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return meetings
    .flatMap((m) =>
      m.text
        .split("\n")
        .filter((l) => l.toLowerCase().includes(needle))
        .map((l) => `${m.id} · ${l}`),
    )
    .slice(0, max);
}

/** Filas rutina × bloque (LEFT JOIN, en orden) → una entrada por rutina con sus bloques como texto. */
export function groupRoutines(rows) {
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.id)) out.set(r.id, { id: r.id, name: r.name, active: !!r.active, blocks: [] });
    if (r.activity) out.get(r.id).blocks.push(`${r.activity} ${r.min}`);
  }
  return [...out.values()].map((r) => ({ ...r, blocks: r.blocks.join(" · ") }));
}

/** Las herramientas sobre la API de la app: `api(path, body)` con path `/api/select`, `/api/execute` o
 * `/api/invoke` (el MCP la llama por HTTP; el chat de Windows, dentro de la app). `external`: solo sugiere. */
export function makeCall(api, external = false) {
  const select = (sql, args = []) => api("/api/select", { sql, args });
  const execute = (sql, args = []) => api("/api/execute", { sql, args });
  const invoke = (cmd, args = {}) => api("/api/invoke", { cmd, args });

  async function notes(id) {
    const [n] = await select("SELECT summary, decisions, project FROM meeting_notes WHERE meeting = $1", [
      id,
    ]);
    return {
      summary: n?.summary ?? "",
      decisions: n ? JSON.parse(n.decisions || "[]") : [],
      project: n?.project ?? null,
    };
  }

  const timer = async (cmd, args) => (cmd && (await invoke(cmd, args)), invoke("timer_get"));
  const author = external ? "Claude" : "Candola";
  const mustExist = async (id) => {
    if (!Number.isInteger(id)) throw new Error("falta id (list_tasks)");
    const [t] = await select("SELECT * FROM tasks WHERE id = $1", [id]);
    if (!t) throw new Error(`no existe la tarea ${id}`);
    return t;
  };
  const comment = (id, body) =>
    execute("INSERT INTO task_comments (task_id, author, body, created_at) VALUES ($1, $2, $3, $4)", [
      id,
      author,
      body,
      Date.now(),
    ]);

  /** Ejecuta una herramienta; el resultado va como texto JSON para que la Candola lo lea. */
  return async function call(name, a = {}) {
    if (external && DIRECT.includes(name))
      throw new Error(`${name} no está disponible fuera de la app: usa suggest_task`);
    switch (name) {
      case "list_tasks": {
        const rows = await select(
          `SELECT id, title, description, project, priority, done, due_at, est_pomodoros, done_pomodoros, repeat,
             (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = tasks.id) AS comments
           FROM tasks ORDER BY done, due_at IS NULL, due_at, priority DESC`,
        );
        const endOfDay = new Date().setHours(23, 59, 59, 999);
        const keep =
          { all: () => true, today: (t) => !t.done && t.due_at != null && t.due_at <= endOfDay }[a.filter] ??
          ((t) => !t.done);
        return rows.filter(keep).map(({ due_at, done, ...t }) => ({
          ...t,
          done: !!done,
          due: due_at == null ? null : fmtMs(due_at),
        }));
      }
      case "add_task": {
        const title = String(a.title ?? "").trim();
        if (!title) throw new Error("falta title");
        const due = a.due?.trim() ? parseDue(a.due) : null;
        const repeat = a.repeat ?? "none";
        if (repeat !== "none" && due == null) throw new Error("una tarea que se repite necesita due");
        const prio = Math.min(2, Math.max(0, a.priority ?? 1));
        const r = await execute(
          "INSERT INTO tasks (title, category_id, project, priority, due_at, est_pomodoros, repeat, created_at, description) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8)",
          [
            title,
            a.project?.trim() || null,
            prio,
            due,
            Math.max(1, a.est_pomodoros ?? 1),
            repeat,
            Date.now(),
            a.description?.trim() || null,
          ],
        );
        return { id: r.lastInsertId, title, due: due == null ? null : fmtMs(due) };
      }
      case "suggest_task": {
        const op = a.op ?? "crear";
        if (!["crear", "editar", "completar"].includes(op))
          throw new Error("op debe ser crear, editar o completar");
        const title = String(a.title ?? "").trim();
        if (!title) throw new Error("falta title");
        if (op !== "crear") {
          if (!Number.isInteger(a.id)) throw new Error(`${op} necesita el id de la tarea (list_tasks)`);
          if (!(await select("SELECT id FROM tasks WHERE id = $1", [a.id])).length)
            throw new Error(`no existe la tarea ${a.id}`);
        }
        const date = a.date?.trim() || undefined;
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date va como "AAAA-MM-DD"');
        if (date) parseDue(date);
        // Mismo JSON que el modo Gestión (src/lib/suggestions.ts `Action`); meeting 0 = no vino de una reunión.
        const action = {
          op,
          id: op === "crear" ? undefined : a.id,
          titulo: op === "crear" ? title : a.new_title?.trim() || undefined,
          proyecto: a.project?.trim() || undefined,
          prioridad: a.priority,
          fecha: date,
          pomodoros: a.pomodoros,
          descripcion: a.description?.trim() || undefined,
        };
        const r = await execute(
          "INSERT INTO meeting_tasks (meeting, title, detail, action) VALUES (0, $1, $2, $3)",
          [title, String(a.detail ?? "").trim(), JSON.stringify(action)],
        );
        return {
          suggestion: r.lastInsertId,
          op,
          title,
          note: "queda en Propuestas para que el usuario la revise",
        };
      }
      case "task_get": {
        const {
          id,
          title,
          description,
          project,
          priority,
          done,
          due_at,
          done_at,
          created_at,
          est_pomodoros,
          done_pomodoros,
          repeat,
        } = await mustExist(a.id);
        const [{ secs }] = await select(
          "SELECT COALESCE(SUM(end - start), 0) / 1000 AS secs FROM sessions WHERE mode = 'focus' AND task_id = $1",
          [a.id],
        );
        const comments = await select(
          "SELECT author, body, created_at FROM task_comments WHERE task_id = $1 ORDER BY created_at, id",
          [a.id],
        );
        return {
          id,
          title,
          description,
          project,
          priority,
          est_pomodoros,
          done_pomodoros,
          repeat,
          done: !!done,
          due: due_at == null ? null : fmtMs(due_at),
          created: fmtMs(created_at),
          closed: done_at == null ? null : fmtMs(done_at),
          focus_minutes: Math.round(secs / 60),
          comments: comments.map((c) => ({ author: c.author, at: fmtMs(c.created_at), body: c.body })),
        };
      }
      case "update_task": {
        await mustExist(a.id);
        const set = taskChanges(a);
        const cols = Object.keys(set); // nombres fijos de taskChanges, nunca del input
        if (!cols.length && a.done === undefined) throw new Error("no pasaste nada que cambiar");
        if (cols.length)
          await execute(
            `UPDATE tasks SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")} WHERE id = $${cols.length + 1}`,
            [...Object.values(set), a.id],
          );
        if (a.done !== undefined) await invoke("task_set_done", { id: a.id, done: !!a.done });
        return {
          id: a.id,
          changed: [...cols.filter((c) => c !== "notified"), ...(a.done === undefined ? [] : ["done"])],
        };
      }
      case "comment_task": {
        await mustExist(a.id);
        const body = String(a.body ?? "").trim();
        if (!body) throw new Error("falta body");
        await comment(a.id, body);
        return { id: a.id, commented: true, author };
      }
      case "complete_task": {
        await mustExist(a.id);
        if (a.comment?.trim()) await comment(a.id, a.comment.trim());
        await invoke("task_set_done", { id: a.id, done: true });
        return { done: a.id };
      }
      case "timer_get":
        return timer();
      case "timer_start":
        return timer("timer_start", {
          mode: a.mode ?? "focus",
          seconds: a.minutes ? a.minutes * 60 : undefined,
          taskId: a.task_id,
        });
      case "timer_pause":
        return timer("timer_pause");
      case "timer_resume":
        return timer("timer_resume");
      case "timer_stop":
        return timer("timer_reset");
      case "routines_list":
        return groupRoutines(
          await select(
            `SELECT r.id, r.name, r.active, a.name AS activity, COALESCE(rs.min, a.min) AS min FROM routines r
           LEFT JOIN routine_steps rs ON rs.routine_id = r.id LEFT JOIN activities a ON a.id = rs.activity_id
           ORDER BY r.id, rs.pos`,
          ),
        );
      case "routine_activate": {
        if (a.id != null && !(await select("SELECT id FROM routines WHERE id = $1", [a.id])).length)
          throw new Error(`no existe la rutina ${a.id} (routines_list)`);
        // Una sola activa (índice único parcial): primero se apagan todas. La app relee la rutina con el cambio.
        await execute("UPDATE routines SET active = 0 WHERE active = 1");
        if (a.id != null) await execute("UPDATE routines SET active = 1 WHERE id = $1", [a.id]);
        // La app relee la rutina con db://changed, pero en segundo plano: antes de arrancar hay que esperarla.
        await invoke("timer_routine");
        if (a.start && (await invoke("timer_get")).status === "idle") await invoke("timer_toggle");
        return timer();
      }
      case "meetings_list": {
        const ms = (await invoke("meetings_list")).slice(0, a.limit ?? 10);
        return Promise.all(
          ms.map(async (m) => {
            const n = await notes(m.id);
            return {
              id: m.id,
              date: fmtMs(m.id * 1000),
              title: m.title,
              project: n.project,
              attendees: m.attendees,
              summary: n.summary,
            };
          }),
        );
      }
      case "meeting_get": {
        const m = (await invoke("meetings_list")).find((m) => m.id === a.id);
        if (!m) throw new Error(`no existe la reunión ${a.id}`);
        const suggestions = await select(
          "SELECT id, title, detail, status FROM meeting_tasks WHERE meeting = $1",
          [m.id],
        );
        return {
          id: m.id,
          date: fmtMs(m.id * 1000),
          title: m.title,
          attendees: m.attendees,
          ...(await notes(m.id)),
          suggestions,
          transcript: m.text,
        };
      }
      case "meeting_search": {
        const hits = search(await invoke("meetings_list"), String(a.q ?? ""));
        return hits.length ? hits.join("\n") : "sin coincidencias";
      }
      case "suggestions_list":
        return select(
          "SELECT id, meeting, title, detail, action FROM meeting_tasks WHERE status = 'pending' ORDER BY id",
        );
      case "suggestion_set": {
        if (!["accepted", "dismissed"].includes(a.status))
          throw new Error("status debe ser accepted o dismissed");
        const r = await execute("UPDATE meeting_tasks SET status = $1 WHERE id = $2", [a.status, a.id]);
        if (!r.rowsAffected) throw new Error("no existe esa sugerencia");
        return { id: a.id, status: a.status };
      }
      default:
        throw new Error(`herramienta desconocida: ${name}`);
    }
  };
}
