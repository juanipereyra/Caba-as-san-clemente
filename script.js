// ------------------------------------------------------------------
// Estado y configuración
// ------------------------------------------------------------------
let blockedDates = {
  "La Casita": [],
  "La Cabaña": []
};

const prices = {
  "La Casita": 85000,
  "La Cabaña": 120000
};

// Capacidad máxima por unidad. Se usa para filtrar el select de personas.
const capacity = {
  "La Casita": 4,
  "La Cabaña": 6
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
// Utilidades
// ------------------------------------------------------------------
function formatDate(dateString) {
  const [y, m, d] = dateString.split("-");
  return `${d}/${m}/${y}`;
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0
  }).format(amount);
}

function todayISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysISO(dateString, days) {
  const date = new Date(dateString);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calculateNights(checkin, checkout) {
  const start = new Date(checkin);
  const end = new Date(checkout);
  const diffMs = end - start;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function overlaps(startA, endA, startB, endB) {
  return new Date(startA) < new Date(endB) && new Date(endA) > new Date(startB);
}

// ------------------------------------------------------------------
// Carga de disponibilidad (vía /api/calendar, que lee Google Calendar)
// ------------------------------------------------------------------
async function loadBlockedDatesFromGoogleCalendar() {
  statusEl.innerHTML = `<strong>Cargando disponibilidad…</strong> Un momento por favor.`;

  try {
    const response = await fetch("/api/calendar");

    if (!response.ok) {
      throw new Error("No se pudo cargar la API de calendario");
    }

    blockedDates = await response.json();

    renderBlockedDates(unitEl.value);
    checkAvailability();
  } catch (error) {
    console.error("Error cargando calendarios:", error);

    statusEl.innerHTML = `
      <strong>No se pudo cargar Google Calendar</strong>
      Revisá tu conexión y volvé a intentar. Si el problema persiste, escribinos directamente por WhatsApp.
    `;
  }
}

// ------------------------------------------------------------------
// Render de fechas bloqueadas
// ------------------------------------------------------------------
function renderBlockedDates(unit) {
  const data = unit && blockedDates[unit] ? blockedDates[unit] : [];
  blockedListEl.innerHTML = "";

  if (!unit) {
    blockedListEl.innerHTML = `<div class="blocked-item">Seleccioná una unidad para ver sus fechas bloqueadas.</div>`;
    return;
  }

  if (!data.length) {
    blockedListEl.innerHTML = `<div class="blocked-item">No hay fechas bloqueadas cargadas para esta unidad.</div>`;
    return;
  }

  data.forEach((item) => {
    const div = document.createElement("div");
    div.className = "blocked-item";
    div.textContent = `${unit}: ocupado del ${formatDate(item.from)} al ${formatDate(item.to)}`;
    blockedListEl.appendChild(div);
  });
}

// ------------------------------------------------------------------
// Personas según capacidad de la unidad elegida
// ------------------------------------------------------------------
function updateGuestsOptions() {
  if (!guestsEl) return;

  const unit = unitEl.value;
  const max = capacity[unit] || 6;
  const previousValue = guestsEl.value;

  guestsEl.innerHTML = '<option value="">Seleccionar</option>';

  for (let i = 1; i <= max; i++) {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = String(i);
    guestsEl.appendChild(option);
  }

  // Si el valor previamente elegido sigue siendo válido para la nueva unidad, lo mantenemos.
  if (previousValue && Number(previousValue) <= max) {
    guestsEl.value = previousValue;
  }
}

// ------------------------------------------------------------------
// Fechas mínimas/máximas permitidas en los inputs
// ------------------------------------------------------------------
function updateDateBounds() {
  const today = todayISO();
  checkinEl.min = today;

  if (checkinEl.value) {
    checkoutEl.min = addDaysISO(checkinEl.value, 1);

    // Si el checkout quedó antes del nuevo mínimo, lo limpiamos para evitar un rango inválido.
    if (checkoutEl.value && checkoutEl.value <= checkinEl.value) {
      checkoutEl.value = "";
    }
  } else {
    checkoutEl.min = today;
  }
}

// ------------------------------------------------------------------
// Resumen de precio
// ------------------------------------------------------------------
function updatePriceSummary() {
  const unit = unitEl.value;
  const checkin = checkinEl.value;
  const checkout = checkoutEl.value;

  if (!priceSummaryEl) return;

  if (!unit || !checkin || !checkout) {
    priceSummaryEl.innerHTML = `
      <strong>Resumen de estadía</strong>
      Seleccioná unidad y fechas para ver la cantidad de noches, el valor por noche, el total estimado y la seña.
    `;
    return;
  }

  if (new Date(checkin) >= new Date(checkout)) {
    priceSummaryEl.innerHTML = `
      <strong>Resumen de estadía</strong>
      La fecha de salida debe ser posterior a la fecha de ingreso.
    `;
    return;
  }

  const nights = calculateNights(checkin, checkout);
  const pricePerNight = prices[unit] || 0;
  const total = nights * pricePerNight;
  const reservationAmount = total / 2;

  priceSummaryEl.innerHTML = `
    <strong>Resumen de estadía</strong>
    ${nights} noche${nights > 1 ? "s" : ""} · ${formatCurrency(pricePerNight)} por noche · Total estimado: ${formatCurrency(total)}<br>
    Seña para confirmar: ${formatCurrency(reservationAmount)}
  `;
}

// ------------------------------------------------------------------
// Chequeo de disponibilidad
// ------------------------------------------------------------------
function checkAvailability() {
  const unit = unitEl.value;
  const checkin = checkinEl.value;
  const checkout = checkoutEl.value;

  renderBlockedDates(unit);

  if (!unit || !checkin || !checkout) {
    statusEl.innerHTML = `<strong>Estado de disponibilidad</strong> Seleccioná una unidad y fechas para verificar si el rango está libre.`;
    return { valid: false, available: false };
  }

  if (new Date(checkin) >= new Date(checkout)) {
    statusEl.innerHTML = `<strong>Revisá las fechas</strong> La fecha de salida debe ser posterior a la fecha de ingreso.`;
    return { valid: false, available: false };
  }

  const unitBlocked = blockedDates[unit] || [];
  const conflict = unitBlocked.some((item) =>
    overlaps(checkin, checkout, item.from, item.to)
  );

  if (conflict) {
    statusEl.innerHTML = `<strong>No disponible en ese rango</strong> Las fechas seleccionadas se superponen con una reserva o bloqueo existente. Probá otro rango.`;
    return { valid: true, available: false };
  }

  statusEl.innerHTML = `<strong>Disponible para consulta</strong> Ese rango figura libre en la web. Podés iniciar la consulta por WhatsApp para terminar de confirmar la reserva.`;
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
    alert("Revisá las fechas seleccionadas antes de continuar.");
    return;
  }

  if (!available) {
    alert("Ese rango figura como no disponible. Probá con otras fechas.");
    return;
  }

  const nights = calculateNights(checkin, checkout);
  const pricePerNight = prices[unit] || 0;
  const total = nights * pricePerNight;
  const reservationAmount = total / 2;

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
    `Seña para confirmar: ${formatCurrency(reservationAmount)}`,
    extra ? `Comentario: ${extra}` : null
  ]
    .filter(Boolean)
    .join("\n");

  const url = `https://wa.me/543515217822?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank");
});

// ------------------------------------------------------------------
// FAQ (acordeón)
// ------------------------------------------------------------------
document.querySelectorAll(".faq-question").forEach((button) => {
  button.addEventListener("click", () => {
    const item = button.parentElement;
    const isActive = item.classList.contains("active");

    document.querySelectorAll(".faq-item").forEach((i) => {
      i.classList.remove("active");
    });

    if (!isActive) item.classList.add("active");
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
    dot.className = i === 0 ? "dot active" : "dot";
    dot.setAttribute("aria-label", `Ir a la foto ${i + 1} de ${slideItems.length}`);
    dot.setAttribute("aria-current", i === 0 ? "true" : "false");

    dot.addEventListener("click", () => {
      index = i;
      updateCarousel();
    });

    dotsContainer.appendChild(dot);
  });

  prev.addEventListener("click", () => {
    index = (index - 1 + slideItems.length) % slideItems.length;
    updateCarousel();
  });

  next.addEventListener("click", () => {
    index = (index + 1) % slideItems.length;
    updateCarousel();
  });
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
