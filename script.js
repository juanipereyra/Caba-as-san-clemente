// ==================================================================
// Cabañas San Clemente — lógica del sitio
// ==================================================================
//
// Convención de fechas usada en todo el archivo:
//   - Toda fecha se maneja como string ISO "YYYY-MM-DD".
//   - En los rangos bloqueados, `from` es el primer día ocupado y
//     `to` es EXCLUSIVO (primer día libre). Es la misma convención
//     que usa Google Calendar para eventos de día completo y coincide
//     con la lógica hotelera: el día de check-out queda disponible
//     para que entre otro huésped.
//   - Nunca se usa `new Date("YYYY-MM-DD")` para hacer cuentas: eso
//     se interpreta como UTC y en Argentina (UTC-3) devuelve el día
//     anterior. Se usan los helpers de abajo.
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Configuración
// ------------------------------------------------------------------
const UNITS = {
  "La Casita": { price: 85000, capacity: 4 },
  "La Cabaña": { price: 120000, capacity: 6 }
};

const WHATSAPP_NUMBER = "543515217822";

// Cuántos rangos ocupados se listan como máximo en el panel lateral.
const MAX_BLOCKS_SHOWN = 12;

// Hasta cuándo se permite reservar (límite del input de fecha).
const BOOKING_HORIZON_DAYS = 540;

let blockedDates = {
  "La Casita": [],
  "La Cabaña": []
};

// ------------------------------------------------------------------
// Referencias al DOM
// ------------------------------------------------------------------
const unitEl = document.getElementById("unit");
const checkinEl = document.getElementById("checkin");
const checkoutEl = document.getElementById("checkout");
const guestsEl = document.getElementById("guests");
const petsEl = document.getElementById("pets");
const petsNoteEl = document.getElementById("petsNote");
const nameEl = document.getElementById("name");
const messageEl = document.getElementById("message");
const statusEl = document.getElementById("availabilityStatus");
const blockedListEl = document.getElementById("blockedDatesList");
const whatsappBtn = document.getElementById("whatsappBooking");
const priceSummaryEl = document.getElementById("priceSummary");

// ------------------------------------------------------------------
// Utilidades de fecha (a prueba de zona horaria)
// ------------------------------------------------------------------
const MS_PER_DAY = 86400000;

/** Fecha de hoy según el reloj del visitante, en formato ISO. */
function todayISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Convierte "YYYY-MM-DD" a timestamp UTC de medianoche (para hacer cuentas). */
function isoToUTC(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * Suma (o resta) días a una fecha ISO.
 * Usa aritmética en UTC, así que no se ve afectada por husos ni horario de verano.
 */
function addDaysISO(iso, days) {
  return new Date(isoToUTC(iso) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Cantidad de noches entre dos fechas ISO. */
function nightsBetween(checkin, checkout) {
  return Math.round((isoToUTC(checkout) - isoToUTC(checkin)) / MS_PER_DAY);
}

/** Los strings ISO se comparan alfabéticamente igual que cronológicamente. */
function isPast(iso) {
  return iso < todayISO();
}

/**
 * ¿Se pisan dos rangos? `to` es exclusivo en ambos, por eso el
 * check-out de una reserva puede ser el check-in de la siguiente.
 */
function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function formatDate(iso) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0
  }).format(amount);
}

function setBox(element, tone, title, body) {
  if (!element) return;
  element.classList.remove("is-ok", "is-warn", "is-error");
  if (tone) element.classList.add(tone);
  element.innerHTML = `<strong>${title}</strong> ${body}`;
}

// ------------------------------------------------------------------
// Normalización de los rangos que llegan del calendario
// ------------------------------------------------------------------
/**
 * Descarta todo lo que ya terminó y deja solo lo que todavía afecta
 * a alguien que quiere reservar hoy o más adelante.
 *
 * Este es el filtro clave: un rango cuyo `to` (día de liberación) es
 * anterior o igual a hoy ya no bloquea nada, y no tiene sentido
 * mostrarlo ni evaluarlo.
 */
function relevantBlocks(unit) {
  const today = todayISO();
  const raw = Array.isArray(blockedDates[unit]) ? blockedDates[unit] : [];

  return raw
    .filter((item) => item && typeof item.from === "string" && typeof item.to === "string")
    .filter((item) => item.to > item.from) // rangos vacíos o corruptos fuera
    .filter((item) => item.to > today) // ← acá se descartan las fechas pasadas
    .sort((a, b) => a.from.localeCompare(b.from));
}

// ------------------------------------------------------------------
// Carga de disponibilidad (vía /api/calendar, que lee Google Calendar)
// ------------------------------------------------------------------
async function loadBlockedDatesFromGoogleCalendar() {
  setBox(statusEl, null, "Cargando disponibilidad…", "Un momento por favor.");

  try {
    const response = await fetch("/api/calendar", { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`La API de calendario respondió ${response.status}`);
    }

    const payload = await response.json();

    // Soporta tanto el formato nuevo ({ units: {...} }) como el viejo
    // (el objeto de unidades directo), por si quedó una versión previa
    // de la función serverless desplegada.
    const units = payload && payload.units ? payload.units : payload;

    blockedDates = {
      "La Casita": Array.isArray(units["La Casita"]) ? units["La Casita"] : [],
      "La Cabaña": Array.isArray(units["La Cabaña"]) ? units["La Cabaña"] : []
    };

    renderBlockedDates(unitEl.value);
    checkAvailability();

    if (payload && Array.isArray(payload.unavailable) && payload.unavailable.length) {
      setBox(
        statusEl,
        "is-warn",
        "Disponibilidad parcial",
        `No se pudo leer el calendario de ${payload.unavailable.join(" y ")}. Confirmá esas fechas por WhatsApp.`
      );
    }
  } catch (error) {
    console.error("Error cargando calendarios:", error);
    setBox(
      statusEl,
      "is-error",
      "No se pudo cargar la disponibilidad",
      "Revisá tu conexión y volvé a intentar. Si el problema persiste, escribinos directamente por WhatsApp y lo confirmamos a mano."
    );
  }
}

// ------------------------------------------------------------------
// Render de fechas bloqueadas
// ------------------------------------------------------------------
function renderBlockedDates(unit) {
  if (!blockedListEl) return;

  blockedListEl.innerHTML = "";

  if (!unit) {
    blockedListEl.innerHTML =
      `<div class="blocked-item">Seleccioná una unidad para ver sus fechas ocupadas.</div>`;
    return;
  }

  const blocks = relevantBlocks(unit);

  if (!blocks.length) {
    blockedListEl.innerHTML =
      `<div class="blocked-item">Sin fechas ocupadas de acá en adelante para ${unit}.</div>`;
    return;
  }

  const today = todayISO();

  blocks.slice(0, MAX_BLOCKS_SHOWN).forEach((item) => {
    // `to` es exclusivo: la última noche ocupada es el día anterior.
    const lastNight = addDaysISO(item.to, -1);
    const enCurso = item.from <= today;

    const div = document.createElement("div");
    div.className = enCurso ? "blocked-item is-ongoing" : "blocked-item";

    const titulo = enCurso
      ? `Ocupado ahora, hasta el ${formatDate(lastNight)}`
      : `Ocupado del ${formatDate(item.from)} al ${formatDate(lastNight)}`;

    div.innerHTML = `<strong>${titulo}</strong><span>Se libera el ${formatDate(item.to)}</span>`;
    blockedListEl.appendChild(div);
  });

  if (blocks.length > MAX_BLOCKS_SHOWN) {
    const extra = document.createElement("div");
    extra.className = "blocked-item is-muted";
    extra.textContent = `+ ${blocks.length - MAX_BLOCKS_SHOWN} rango(s) más adelante en el año.`;
    blockedListEl.appendChild(extra);
  }
}

// ------------------------------------------------------------------
// Personas según capacidad de la unidad elegida
// ------------------------------------------------------------------
function updateGuestsOptions() {
  if (!guestsEl) return;

  const unit = unitEl.value;
  const max = UNITS[unit] ? UNITS[unit].capacity : 6;
  const previousValue = guestsEl.value;

  guestsEl.innerHTML = '<option value="">Seleccionar</option>';

  for (let i = 1; i <= max; i++) {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = String(i);
    guestsEl.appendChild(option);
  }

  if (previousValue && Number(previousValue) <= max) {
    guestsEl.value = previousValue;
  }
}

// ------------------------------------------------------------------
// Límites de los inputs de fecha
// ------------------------------------------------------------------
function updateDateBounds() {
  const today = todayISO();
  const horizonte = addDaysISO(today, BOOKING_HORIZON_DAYS);

  // Si el navegador restauró un valor viejo (o la pestaña quedó
  // abierta desde ayer), se limpia en vez de arrastrar una fecha
  // que ya pasó.
  if (checkinEl.value && checkinEl.value < today) checkinEl.value = "";
  if (checkoutEl.value && checkoutEl.value <= today) checkoutEl.value = "";

  checkinEl.min = today;
  checkinEl.max = horizonte;

  if (checkinEl.value) {
    checkoutEl.min = addDaysISO(checkinEl.value, 1);

    // Rango inválido: se limpia la salida en lugar de dejarla mal.
    if (checkoutEl.value && checkoutEl.value <= checkinEl.value) {
      checkoutEl.value = "";
    }
  } else {
    checkoutEl.min = addDaysISO(today, 1);
  }

  checkoutEl.max = addDaysISO(horizonte, 1);
}

// ------------------------------------------------------------------
// Resumen de precio
// ------------------------------------------------------------------
function updatePriceSummary() {
  if (!priceSummaryEl) return;

  const unit = unitEl.value;
  const checkin = checkinEl.value;
  const checkout = checkoutEl.value;

  if (!unit || !checkin || !checkout) {
    setBox(
      priceSummaryEl,
      null,
      "Resumen de estadía",
      "Seleccioná unidad y fechas para ver la cantidad de noches, el valor por noche, el total estimado y la seña."
    );
    return;
  }

  if (checkout <= checkin) {
    setBox(
      priceSummaryEl,
      "is-warn",
      "Resumen de estadía",
      "La fecha de salida debe ser posterior a la fecha de ingreso."
    );
    return;
  }

  const nights = nightsBetween(checkin, checkout);
  const pricePerNight = UNITS[unit] ? UNITS[unit].price : 0;
  const total = nights * pricePerNight;
  const sena = Math.round(total / 2);

  setBox(
    priceSummaryEl,
    null,
    "Resumen de estadía",
    `${nights} noche${nights > 1 ? "s" : ""} · ${formatCurrency(pricePerNight)} por noche · Total estimado: ${formatCurrency(total)}<br>
     Seña para confirmar: ${formatCurrency(sena)}`
  );
}

// ------------------------------------------------------------------
// Chequeo de disponibilidad
// ------------------------------------------------------------------
//
// Orden de validaciones (importa): primero se descarta lo que ya pasó,
// después la coherencia del rango y recién al final se compara contra
// las reservas. Así nunca aparece un "ocupado" sobre una fecha vieja.
// ------------------------------------------------------------------
function checkAvailability() {
  const unit = unitEl.value;
  const checkin = checkinEl.value;
  const checkout = checkoutEl.value;

  renderBlockedDates(unit);

  if (!unit || !checkin || !checkout) {
    setBox(
      statusEl,
      null,
      "Estado de disponibilidad",
      "Seleccioná una unidad y fechas para verificar si el rango está libre."
    );
    return { valid: false, available: false };
  }

  // 1) Fechas pasadas: se avisa que hay que elegir otra, sin hablar
  //    de ocupación (una fecha vieja no está "ocupada", simplemente ya pasó).
  if (isPast(checkin)) {
    setBox(
      statusEl,
      "is-warn",
      "Elegí una fecha a futuro",
      "La fecha de ingreso ya pasó. Seleccioná una fecha de hoy en adelante."
    );
    return { valid: false, available: false };
  }

  // 2) Coherencia del rango.
  if (checkout <= checkin) {
    setBox(
      statusEl,
      "is-warn",
      "Revisá las fechas",
      "La fecha de salida debe ser posterior a la fecha de ingreso."
    );
    return { valid: false, available: false };
  }

  // 3) Recién ahora se compara contra las reservas vigentes.
  const conflicto = relevantBlocks(unit).find((item) =>
    overlaps(checkin, checkout, item.from, item.to)
  );

  if (conflicto) {
    const libreDesde = formatDate(conflicto.to);
    setBox(
      statusEl,
      "is-error",
      "No disponible en ese rango",
      `Se superpone con una reserva existente (libre desde el ${libreDesde}). Probá otras fechas.`
    );
    return { valid: true, available: false };
  }

  setBox(
    statusEl,
    "is-ok",
    "Disponible para consulta",
    "Ese rango figura libre. Podés iniciar la consulta por WhatsApp para terminar de confirmar la reserva."
  );
  return { valid: true, available: true };
}

// ------------------------------------------------------------------
// Aviso de mascotas
// ------------------------------------------------------------------
function updatePetsNote() {
  if (!petsEl || !petsNoteEl) return;
  petsNoteEl.style.display = petsEl.value === "Sí" ? "block" : "none";
}

// ------------------------------------------------------------------
// Recalculo automático al cambiar el día
// ------------------------------------------------------------------
//
// Si alguien deja la pestaña abierta y cruza la medianoche, "hoy"
// cambia y hay que recalcular límites y listado.
// ------------------------------------------------------------------
let currentDay = todayISO();

function refreshIfDayChanged() {
  const now = todayISO();
  if (now === currentDay) return;

  currentDay = now;
  updateDateBounds();
  checkAvailability();
  updatePriceSummary();
}

setInterval(refreshIfDayChanged, 60000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshIfDayChanged();
});

// ------------------------------------------------------------------
// Listeners del formulario
// ------------------------------------------------------------------
unitEl.addEventListener("change", () => {
  updateGuestsOptions();
  checkAvailability();
  updatePriceSummary();
});

[checkinEl, checkoutEl].forEach((el) =>
  el.addEventListener("change", () => {
    updateDateBounds();
    checkAvailability();
    updatePriceSummary();
  })
);

if (petsEl) {
  petsEl.addEventListener("change", updatePetsNote);
}

whatsappBtn.addEventListener("click", () => {
  const { valid, available } = checkAvailability();
  updatePriceSummary();

  const unit = unitEl.value;
  const checkin = checkinEl.value;
  const checkout = checkoutEl.value;
  const guests = guestsEl.value;
  const pets = petsEl ? petsEl.value : "";
  const name = nameEl.value.trim();
  const extra = messageEl.value.trim();

  if (!unit || !checkin || !checkout || !guests || !pets) {
    alert("Completá unidad, fechas, cantidad de personas y si viajan con mascotas antes de continuar.");
    return;
  }

  if (!valid) {
    alert("Revisá las fechas seleccionadas: deben ser de hoy en adelante y la salida posterior al ingreso.");
    return;
  }

  if (!available) {
    alert("Ese rango figura como no disponible. Probá con otras fechas.");
    return;
  }

  const nights = nightsBetween(checkin, checkout);
  const pricePerNight = UNITS[unit] ? UNITS[unit].price : 0;
  const total = nights * pricePerNight;
  const sena = Math.round(total / 2);

  const text = [
    "Hola, quiero iniciar una reserva.",
    name ? `Nombre: ${name}` : null,
    `Unidad: ${unit}`,
    `Check-in: ${formatDate(checkin)}`,
    `Check-out: ${formatDate(checkout)}`,
    `Noches: ${nights}`,
    `Personas: ${guests}`,
    `Mascotas: ${pets}`,
    pets === "Sí" ? "Aclaración: entiendo que las mascotas tienen costo adicional de limpieza." : null,
    `Valor por noche: ${formatCurrency(pricePerNight)}`,
    `Monto total estimado: ${formatCurrency(total)}`,
    `Seña para confirmar: ${formatCurrency(sena)}`,
    extra ? `Comentario: ${extra}` : null
  ]
    .filter(Boolean)
    .join("\n");

  window.open(
    `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`,
    "_blank",
    "noopener"
  );
});

// ------------------------------------------------------------------
// FAQ (acordeón)
// ------------------------------------------------------------------
document.querySelectorAll(".faq-question").forEach((button) => {
  const item = button.parentElement;
  const answer = item.querySelector(".faq-answer");

  button.setAttribute("aria-expanded", item.classList.contains("active") ? "true" : "false");

  const setHeight = (el, open) => {
    // Altura real del contenido: evita que respuestas largas queden cortadas.
    el.style.maxHeight = open ? `${el.scrollHeight}px` : "0px";
  };

  if (item.classList.contains("active")) setHeight(answer, true);

  button.addEventListener("click", () => {
    const isActive = item.classList.contains("active");

    document.querySelectorAll(".faq-item").forEach((other) => {
      other.classList.remove("active");
      const otherBtn = other.querySelector(".faq-question");
      if (otherBtn) otherBtn.setAttribute("aria-expanded", "false");
      setHeight(other.querySelector(".faq-answer"), false);
    });

    if (!isActive) {
      item.classList.add("active");
      button.setAttribute("aria-expanded", "true");
      setHeight(answer, true);
    }
  });
});

// ------------------------------------------------------------------
// Carruseles de fotos
// ------------------------------------------------------------------
document.querySelectorAll(".carousel-wrap").forEach((wrap) => {
  const slides = wrap.querySelector(".slides");
  const slideItems = wrap.querySelectorAll(".slide");
  const prev = wrap.querySelector(".prev");
  const next = wrap.querySelector(".next");
  const dotsContainer = wrap.querySelector(".dots");

  if (!slides || !slideItems.length || !dotsContainer) return;

  let index = 0;

  function updateCarousel() {
    slides.style.transform = `translateX(-${index * 100}%)`;
    dotsContainer.querySelectorAll(".dot").forEach((dot, i) => {
      dot.classList.toggle("active", i === index);
      dot.setAttribute("aria-current", i === index ? "true" : "false");
    });
  }

  slideItems.forEach((_, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = i === 0 ? "dot active" : "dot";
    dot.setAttribute("aria-label", `Ir a la foto ${i + 1} de ${slideItems.length}`);
    dot.setAttribute("aria-current", i === 0 ? "true" : "false");
    dot.addEventListener("click", () => {
      index = i;
      updateCarousel();
    });
    dotsContainer.appendChild(dot);
  });

  if (prev) {
    prev.addEventListener("click", () => {
      index = (index - 1 + slideItems.length) % slideItems.length;
      updateCarousel();
    });
  }

  if (next) {
    next.addEventListener("click", () => {
      index = (index + 1) % slideItems.length;
      updateCarousel();
    });
  }
});

// ------------------------------------------------------------------
// Inicialización
// ------------------------------------------------------------------
updateGuestsOptions();
updateDateBounds();
renderBlockedDates("");
updatePriceSummary();
updatePetsNote();
loadBlockedDatesFromGoogleCalendar();