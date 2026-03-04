interface Env {
  DB: D1Database;
  APPS_SCRIPT_URL?: string;
}

const defaultItinerary = [
  { time: "09:00", title: "Registration & Welcome", desc: "Check-in and badge pickup." },
  { time: "10:00", title: "Keynote Session", desc: "Opening by CEO and leadership panel." },
  { time: "12:30", title: "Networking Lunch", desc: "Buffet lunch with partners." },
  { time: "15:00", title: "Breakout Workshops", desc: "Track A and Track B sessions." },
  { time: "17:30", title: "Photo Booth & Closing", desc: "Capture memories and closing remarks." },
];

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function cors(headers?: HeadersInit) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...headers,
  };
}

function makeCode() {
  const base = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `EVT-${base}`;
}

async function handleRegister(request: Request, env: Env) {
  const body = await request.json().catch(() => null) as any;
  if (!body?.name || !body?.email || !body?.phone || !body?.eventId) {
    return json({ error: { code: "BAD_REQUEST", message: "Missing fields" } }, 400, cors());
  }

  const code = makeCode();
  const id = crypto.randomUUID();
  const itinerary = JSON.stringify(defaultItinerary);

  await env.DB.prepare(
    "INSERT INTO participants (id, code, name, email, phone, event_id, itinerary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, code, body.name, body.email, body.phone, body.eventId, itinerary, new Date().toISOString())
    .run();

  const origin = new URL(request.url).origin;
  const landingUrl = `${origin.replace("workers.dev", "pages.dev")}/p/${code}`;
  const itineraryUrl = `${origin.replace("workers.dev", "pages.dev")}/p/${code}/itinerary`;

  if (env.APPS_SCRIPT_URL) {
    await fetch(env.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: body.email,
        name: body.name,
        qrUrl: landingUrl,
        landingUrl,
        itineraryUrl,
        code,
      }),
    }).catch(() => null);
  }

  return json({ code, landingUrl, itineraryUrl }, 200, cors());
}

async function handleParticipant(request: Request, env: Env, code: string) {
  const row = await env.DB.prepare(
    "SELECT code, name, email, phone, event_id, itinerary_json FROM participants WHERE code = ?"
  )
    .bind(code)
    .first();

  if (!row) {
    return json({ error: { code: "NOT_FOUND", message: "Participant not found" } }, 404, cors());
  }

  const eventInfo = {
    name: "Corporate Strategy Summit 2026",
    date: "Thursday, 12 March 2026",
    venue: "Grand Ballroom, Hotel Meridian",
  };

  return json(
    {
      code: row.code,
      name: row.name,
      email: row.email,
      phone: row.phone,
      eventInfo,
      itinerary: JSON.parse(String(row.itinerary_json || "[]")),
    },
    200,
    cors()
  );
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() });
    }

    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/register") {
      return handleRegister(request, env);
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/participant/")) {
      const code = url.pathname.split("/").pop() || "";
      return handleParticipant(request, env, code);
    }

    return json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404, cors());
  },
};
