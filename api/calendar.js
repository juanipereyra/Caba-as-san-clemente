// api/calendar.js
//
// Función serverless (Vercel). Lee los calendarios públicos de Google
// Calendar de cada unidad, los convierte a rangos bloqueados simples y
// se los devuelve al front-end.
//
// IMPORTANTE: este archivo debe vivir en la carpeta /api del proyecto
// y requiere un hosting con funciones serverless (Vercel, Netlify
// Functions, etc.). En un hosting estático la ruta /api/calendar no
// existe y el fetch de script.js falla.
//
// Formato de salida:
// {
//   "generatedAt": "2026-07-29T12:00:00.000Z",
//   "today": "2026-07-29",
//   "units": { "La Casita": [{ from, to }], "La Cabaña": [...] },
//   "unavailable": []            // unidades cuyo calendario falló
// }
//
// En cada rango, `from` es el primer día ocupado y `to` es EXCLUSIVO
// (primer día libre), igual que los eventos de día completo de Google.

const TIMEZONE = "America/Argentina/Cordoba";
const MS_PER_DAY = 86400000;
const FETCH_TIMEOUT_MS = 8000;

const calendarIcsUrls = {
  "La Cabaña":
    "https://calendar.google.com/calendar/ical/121bb447b8c6df79f7bfb430dd8b8485b311e2227034232cdc1fc7929c385ed6%40group.calendar.google.com/public/basic.ics",
  "La Casita":
    "https://calendar.google.com/calendar/ical/d9838d6fd94a82c6bef58ff727165134faf582276984fb38790155adf676a4e3%40group.calendar.google.com/public/basic.ics"
};

// ------------------------------------------------------------------
// Utilidades de fecha
// ------------------------------------------------------------------

/**
 * Hoy según la hora de Córdoba, no la del servidor.
 * En Vercel el servidor corre en UTC: sin esto, entre las 21:00 y las
 * 24:00 de Argentina el backend ya cree que es mañana y esconde un
 * día de más.
 */
function todayInTimezone() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function isoToUTC(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function addDaysISO(iso, days) {
  return new Date(isoToUTC(iso) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

// ------------------------------------------------------------------
// Parseo de ICS
// ------------------------------------------------------------------

/**
 * Las líneas de un .ics se cortan a los 75 caracteres y continúan en
 * la línea siguiente empezando con un espacio o tab. Hay que unirlas
 * antes de buscar nada, o se pierden propiedades.
 */
function unfoldIcs(icsText) {
  return icsText.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

/** Devuelve el valor de una propiedad, ignorando sus parámetros. */
function propValue(line) {
  const colon = line.indexOf(":");
  return colon === -1 ? "" : line.slice(colon + 1).trim();
}

/** "20260725" o "20260725T140000Z" → "2026-07-25" */
function icsDateToISO(line) {
  const value = propValue(line);
  const digits = value.replace(/[^0-9]/g, "").slice(0, 8);
  if (digits.length !== 8) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function parseIcsEvents(icsText) {
  const events = unfoldIcs(icsText).split("BEGIN:VEVENT").slice(1);

  return events
    .map((event) => {
      const lines = event.split("\n");
      const find = (prefix) => lines.find((line) => line.startsWith(prefix));

      // Eventos cancelados o marcados como "disponible" no bloquean.
      const status = find("STATUS:");
      if (status && propValue(status).toUpperCase() === "CANCELLED") return null;

      const transp = find("TRANSP:");
      if (transp && propValue(transp).toUpperCase() === "TRANSPARENT") return null;

      const startLine = find("DTSTART");
      if (!startLine) return null;

      const from = icsDateToISO(startLine);
      if (!from) return null;

      const endLine = find("DTEND");
      let to = endLine ? icsDateToISO(endLine) : null;

      // Sin DTEND, o evento con horario dentro de un mismo día:
      // se bloquea al menos esa jornada.
      if (!to || to <= from) to = addDaysISO(from, 1);

      return { from, to };
    })
    .filter(Boolean);
}

// ------------------------------------------------------------------
// Normalización: descartar lo viejo y unir lo que se toca
// ------------------------------------------------------------------

/**
 * Este es el filtro que evita mostrar fechas pasadas: si `to` (día en
 * que la unidad vuelve a estar libre) es anterior o igual a hoy, la
 * reserva ya terminó y no bloquea nada.
 *
 * Los rangos que arrancaron antes de hoy pero siguen en curso se
 * recortan a partir de hoy, así el front muestra "ocupado hasta el X"
 * en vez de una fecha de inicio que ya pasó.
 */
function normalizeRanges(ranges, today) {
  const vigentes = ranges
    .filter((range) => range.to > today)
    .map((range) => ({
      from: range.from < today ? today : range.from,
      to: range.to
    }))
    .sort((a, b) => a.from.localeCompare(b.from));

  // Fusiona rangos superpuestos o pegados (el `to` de uno igual al
  // `from` del siguiente), para no repetir bloques en el listado.
  const merged = [];

  vigentes.forEach((range) => {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) {
      if (range.to > last.to) last.to = range.to;
    } else {
      merged.push({ ...range });
    }
  });

  return merged;
}

// ------------------------------------------------------------------
// Descarga
// ------------------------------------------------------------------
async function fetchUnitEvents(unit, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`No se pudo cargar el calendario de ${unit} (status ${response.status})`);
    }

    return parseIcsEvents(await response.text());
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------
// Handler
// ------------------------------------------------------------------
export default async function handler(req, res) {
  const today = todayInTimezone();
  const units = {};
  const unavailable = [];

  // Cada calendario se consulta por separado: si uno falla, el otro
  // igual se muestra en lugar de romper toda la respuesta.
  await Promise.all(
    Object.entries(calendarIcsUrls).map(async ([unit, url]) => {
      try {
        const events = await fetchUnitEvents(unit, url);
        units[unit] = normalizeRanges(events, today);
      } catch (error) {
        console.error(`[calendar] ${unit}:`, error);
        units[unit] = [];
        unavailable.push(unit);
      }
    })
  );

  // Caché corta: el navegador ve la disponibilidad casi al día,
  // y si cambia la fecha el front igual recalcula por su cuenta.
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  if (unavailable.length === Object.keys(calendarIcsUrls).length) {
    res.status(502).json({
      error: "No se pudieron cargar los calendarios",
      detail: `Falló: ${unavailable.join(", ")}`
    });
    return;
  }

  res.status(200).json({
    generatedAt: new Date().toISOString(),
    today,
    units,
    unavailable
  });
}

// Nota / limitación conocida: los eventos recurrentes (RRULE) no se
// expanden. Para bloqueos de alquiler temporario no suele hacer falta,
// pero si algún día cargás una recurrencia en el calendario, conviene
// pasar a una librería como `node-ical` en lugar de este parser.