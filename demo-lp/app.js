const fallbackData = {
  code: "DEMO-8127",
  name: "Nadia Hartono",
  email: "nadia@example.com",
  phone: "+62 812-3456-7890",
  event: {
    name: "Corporate Strategy Summit 2026",
    date: "Thursday, 12 March 2026",
    venue: "Grand Ballroom, Hotel Meridian",
  },
  itinerary: [
    { time: "09:00", title: "Registration & Welcome", desc: "Check-in and badge pickup." },
    { time: "10:00", title: "Keynote Session", desc: "Opening by CEO and leadership panel." },
    { time: "12:30", title: "Networking Lunch", desc: "Buffet lunch with partners." },
    { time: "15:00", title: "Breakout Workshops", desc: "Track A and Track B sessions." },
    { time: "17:30", title: "Photo Booth & Closing", desc: "Capture memories and closing remarks." },
  ],
};

function getCodeFromPath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "p" && parts[1]) return parts[1];
  return null;
}

function isItineraryView() {
  return window.location.pathname.includes("/itinerary");
}

function buildApiUrl(code) {
  const base = window.location.origin.replace(/\/$/, "");
  return `${base}/api/participant/${encodeURIComponent(code)}`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "";
}

function setHref(id, value) {
  const el = document.getElementById(id);
  if (el) el.setAttribute("href", value);
}

function setQr(id, value) {
  const el = document.getElementById(id);
  if (el) el.setAttribute("src", value);
}

function renderTimeline(items) {
  const timeline = document.getElementById("timeline");
  if (!timeline) return;
  timeline.innerHTML = "";
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "timeline-item";
    row.innerHTML = `
      <div class="timeline-time">${item.time}</div>
      <div>
        <div class="timeline-title">${item.title}</div>
        <div class="timeline-desc">${item.desc}</div>
      </div>
    `;
    timeline.appendChild(row);
  });
}

function applyData(data, code) {
  setText("participantName", data.name);
  setText("participantMeta", `${data.email} • ${data.phone}`);
  setText("eventName", data.event.name);
  setText("eventDate", data.event.date);
  setText("eventVenue", data.event.venue);
  setText("codeBadge", code);
  setText("codeInline", code);
  setText("footerCode", code);
  setText("viewBadge", isItineraryView() ? "ITINERARY" : "PASS");

  const landingUrl = `${window.location.origin}/p/${code}`;
  const itineraryUrl = `${window.location.origin}/p/${code}/itinerary`;
  setHref("itineraryLink", itineraryUrl);

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(landingUrl)}`;
  setQr("qrImage", qrImageUrl);

  renderTimeline(data.itinerary);

  if (isItineraryView()) {
    document.title = `${data.name} • Itinerary`;
  }
}

async function loadData() {
  const code = getCodeFromPath() || fallbackData.code;
  const apiUrl = buildApiUrl(code);

  try {
    const res = await fetch(apiUrl, { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error("API not ready");
    const payload = await res.json();
    const data = payload.data || payload;
    applyData({
      name: data.name,
      email: data.email,
      phone: data.phone,
      event: data.eventInfo || data.event,
      itinerary: data.itinerary || fallbackData.itinerary,
    }, code);
  } catch {
    applyData(fallbackData, code);
  }
}

loadData();
