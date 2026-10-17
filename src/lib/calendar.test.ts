import { describe, expect, it } from "vitest";
import { dueMeetings, meetingsBetween } from "./calendar";

// Formato de Google: VTIMEZONE propia, serie semanal con EXDATE y una ocurrencia movida.
const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTIMEZONE
TZID:America/Santiago
BEGIN:STANDARD
DTSTART:19700405T000000
TZOFFSETFROM:-0300
TZOFFSETTO:-0400
RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700906T000000
TZOFFSETFROM:-0400
TZOFFSETTO:-0300
RRULE:FREQ=YEARLY;BYMONTH=9;BYDAY=1SU
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:daily@x
DTSTART;TZID=America/Santiago:20261001T100000
DTEND;TZID=America/Santiago:20261001T101500
RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR
EXDATE;TZID=America/Santiago:20261021T100000
SUMMARY:Daily
END:VEVENT
BEGIN:VEVENT
UID:daily@x
RECURRENCE-ID;TZID=America/Santiago:20261023T100000
DTSTART;TZID=America/Santiago:20261023T120000
DTEND;TZID=America/Santiago:20261023T121500
SUMMARY:Daily (movida)
END:VEVENT
BEGIN:VEVENT
UID:one@x
DTSTART:20261020T150000Z
DTEND:20261020T160000Z
SUMMARY:Cliente
END:VEVENT
BEGIN:VEVENT
UID:cancel@x
DTSTART:20261020T170000Z
DTEND:20261020T180000Z
STATUS:CANCELLED
SUMMARY:Cancelada
END:VEVENT
BEGIN:VEVENT
UID:allday@x
DTSTART;VALUE=DATE:20261020
DTEND;VALUE=DATE:20261021
SUMMARY:Feriado
END:VEVENT
END:VCALENDAR`;

describe("meetingsBetween", () => {
  const from = Date.UTC(2026, 9, 19); // lun 19 oct
  const to = Date.UTC(2026, 9, 24); // sáb 24 oct
  const ms = meetingsBetween(ICS, from, to);

  it("expande la serie, respeta EXDATE, la excepción y la zona horaria", () => {
    expect(ms.map((m) => [m.title, new Date(m.start).toISOString()])).toEqual([
      ["Daily", "2026-10-19T13:00:00.000Z"], // 10:00 -03
      ["Cliente", "2026-10-20T15:00:00.000Z"],
      ["Daily (movida)", "2026-10-23T15:00:00.000Z"], // el miércoles 21 se borró
    ]);
    expect(ms[0].end - ms[0].start).toBe(15 * 60_000);
  });

  it("avisa una vez, dentro de la anticipación", () => {
    const m = ms[1];
    expect(dueMeetings(ms, m.start - 5 * 60_000, new Set())).toEqual([]);
    expect(dueMeetings(ms, m.start - 60_000, new Set())).toEqual([m]);
    expect(dueMeetings(ms, m.start - 60_000, new Set([m.key]))).toEqual([]);
    expect(dueMeetings(ms, m.start + 2 * 60_000, new Set())).toEqual([]);
  });
});
