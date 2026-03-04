CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  event_id TEXT NOT NULL,
  itinerary_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
