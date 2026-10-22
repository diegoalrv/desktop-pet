import ICAL from "ical.js";

export interface Meeting {
  key: string; // uid + inicio: identifica cada ocurrencia de una serie
  title: string;
  start: number; // ms epoch
  end: number;
}

/** Minutos de anticipación del aviso de reunión. */
export const LEAD_MIN = 2;

/**
 * Ocurrencias con hora (sin eventos de día completo ni cancelados) que empiezan en [from, to).
 * ical.js resuelve RRULE, EXDATE, excepciones (RECURRENCE-ID) y las VTIMEZONE del propio .ics.
 */
export function meetingsBetween(ics: string, from: number, to: number): Meeting[] {
  const cal = new ICAL.Component(ICAL.parse(ics));
  for (const tz of cal.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);

  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const v of cal.getAllSubcomponents("vevent")) {
    const ev = new ICAL.Event(v);
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid, ev);
  }
  for (const ex of exceptions) masters.get(ex.uid)?.relateException(ex);

  const out: Meeting[] = [];
  const push = (ev: ICAL.Event, start: ICAL.Time, end: ICAL.Time) => {
    const s = start.toJSDate().getTime();
    if (start.isDate || s < from || s >= to) return;
    if (ev.component.getFirstPropertyValue("status") === "CANCELLED") return;
    out.push({
      key: `${ev.uid}@${s}`,
      title: ev.summary || "(sin título)",
      start: s,
      end: end.toJSDate().getTime(),
    });
  };

  for (const ev of masters.values()) {
    if (!ev.isRecurring()) {
      push(ev, ev.startDate, ev.endDate);
      continue;
    }
    const it = ev.iterator();
    // ponytail: recorre la serie desde su DTSTART; tope de 5000 ocurrencias (una diaria de 13 años).
    for (let i = 0, t = it.next(); t && i < 5000; i++, t = it.next()) {
      if (t.toJSDate().getTime() >= to) break;
      const d = ev.getOccurrenceDetails(t);
      push(d.item, d.startDate, d.endDate);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Reuniones que toca avisar ahora: empiezan dentro de LEAD_MIN (o empezaron hace < 1 min) y no se avisaron. */
export const dueMeetings = (ms: Meeting[], now: number, notified: Set<string>) =>
  ms.filter((m) => !notified.has(m.key) && m.start - now <= LEAD_MIN * 60_000 && m.start > now - 60_000);
