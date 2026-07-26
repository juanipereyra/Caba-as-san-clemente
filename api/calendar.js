// api/calendar.js
//
// Función serverless (Vercel). Lee los calendarios públicos de Google
// Calendar de cada unidad, los convierte a un formato simple de rangos
// bloqueados y se los devuelve al front-end.
//
// IMPORTANTE: este archivo solo funciona si el sitio está desplegado
// en Vercel (o un hosting con soporte de funciones serverless) y
// ubicado en la carpeta /api. En un hosting estático común (sin
// backend) esta ruta no existe y el fetch a /api/calendar en
// script.js va a fallar.

const calendarIcsUrls = {
  "La Cabaña": "https://calendar.google.com/calendar/ical/121bb447b8c6df79f7bfb430dd8b8485b311e2227034232cdc1fc7929c385ed6%40group.calendar.google.com/public/basic.ics",
  "La Casita": "https://calendar.google.com/calendar/ical/d9838d6fd94a82c6bef58ff727165134faf582276984fb38790155adf676a4e3%40group.calendar.google.com/public/basic.ics"
};

function parseIcsDate(line) {
  const value = line.split(":")[1].trim();
  const dateOnly = value.slice(0, 8);

  const year = dateOnly.slice(0, 4);
  const month = dateOnly.slice(4, 6);
  const day = dateOnly.slice(6, 8);

  return `${year}-${month}-${day}`;
}

function parseIcsEvents(icsText) {
  const events = icsText.split("BEGIN:VEVENT").slice(1);

  return events
    .map((event) => {
      const lines = event.split(/\r?\n/);

      const startLine = lines.find((line) => line.startsWith("DTSTART"));
      const endLine = lines.find((line) => line.startsWith("DTEND"));

      if (!startLine || !endLine) return null;

      return {
        from: parseIcsDate(startLine),
        to: parseIcsDate(endLine)
      };
    })
    .filter(Boolean);
}

async function fetchUnitEvents(unit, url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`No se pudo cargar el calendario de ${unit} (status ${response.status})`);
  }

  const icsText = await response.text();
  return parseIcsEvents(icsText);
}

export default async function handler(req, res) {
  const blockedDates = {};
  const errors = [];

  // Se consulta cada calendario por separado: si uno falla, el otro
  // igual se muestra en la web en lugar de romper toda la respuesta.
  await Promise.all(
    Object.entries(calendarIcsUrls).map(async ([unit, url]) => {
      try {
        blockedDates[unit] = await fetchUnitEvents(unit, url);
      } catch (error) {
        console.error(error);
        blockedDates[unit] = [];
        errors.push(unit);
      }
    })
  );

  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

  if (errors.length === Object.keys(calendarIcsUrls).length) {
    // Ningún calendario pudo cargarse.
    res.status(500).json({
      error: "No se pudieron cargar los calendarios",
      detail: `Falló: ${errors.join(", ")}`
    });
    return;
  }

  res.status(200).json(blockedDates);
}
