# AGENTS.md — Photobooth AI (Photobot Event/Booth)

## Project overview
- Sistem “Photobot Event/Booth” adalah web app untuk operator booth (bukan end-user) untuk capture/upload foto, submit proses AI, memantau antrean, dan download/print output.
- Flow utama: **2-phase** — peserta isi data dulu di tenant (nama + nomor WA) → booth lookup `code/QR` → operator foto → submit job dengan `sessionId` (sinkron data).
- Opsional: **Stoper flow (1-booth)** — stoper melihat list peserta yang sudah daftar (`GET /sessions/list`) lalu klik **Set Active** untuk mengaktifkan booth (tanpa input kode manual).
- Opsional: **Pro Camera / Hotfolder** — kamera profesional simpan foto ke folder → watcher auto‑submit job ke queue.
- Tech: Frontend `Vite + React`, Backend `Node.js + Express`, worker/queue untuk image processing, **Postgres (Neon) via Prisma**.
- Data persistent di Postgres; **Redis + BullMQ** khusus untuk queue + state transient (disarankan Redis persistence untuk event).
- Dokumen:
  - Design: `planning.md`
  - Implementation plan: `implementation-plan.md`

## Build and test commands
Project memakai **pnpm** (recommended untuk monorepo/workspaces).

### Install
- `pnpm i`

### Database (Prisma)
- `pnpm -C packages/db prisma generate`
- `pnpm -C packages/db prisma migrate dev`

### Dev
- `pnpm dev`
- Per package (jika monorepo): `pnpm --filter <name> dev`
  - Hotfolder watcher: `pnpm --filter @photobot/worker hotfolder`
  - Prisma migrate (Neon): `pnpm --filter @photobot/db migrate`
  - Prisma studio: `pnpm --filter @photobot/db studio`

### Build
- `pnpm build`

### Test
- `pnpm test`
- Per package: `pnpm --filter <name> test`

### Lint (jika tersedia)
- `pnpm lint`

## Code style guidelines
- Bahasa: TypeScript (recommended) untuk API/worker/web agar share types.
- Layering (Clean Architecture, disarankan):
  - `domain/` dan `application/` tidak boleh import framework/SDK (Express/BullMQ/Redis/S3).
  - `infrastructure/` berisi adapter implementasi ports (BullMQ, Redis, S3, AI provider clients).
  - `main.ts` adalah composition root (wiring dependencies).
- Error handling:
  - Backend response konsisten: `{ data }` untuk sukses, `{ error: { code, message, details? } }` untuk gagal.
  - Jangan lempar stacktrace ke client; log detail hanya di server.
- Logging:
  - Structured JSON logs (mis. pino) dan selalu sertakan `jobId` untuk korelasi.
- Naming:
  - Gunakan nama eksplisit (`jobId`, `eventId`, `providerType`), hindari singkatan ambigu.

## Testing instructions
- Minimal target untuk MVP:
  - API: integration test endpoint auth + jobs (`POST /auth/login`, `POST /jobs`, `GET /jobs/:id`).
  - Worker: test klasifikasi error (transient vs fatal) + util key builder storage.
- Fokus test di kontrak:
  - Validasi input (content-type, size limit).
  - Idempotency (double submit tidak bikin 2 job).
  - Retry/backoff tidak memproses job final dua kali (idempotent worker).
- Manual smoke test (event mode):
  - Buat job → status `queued/running/succeeded` → download output.
- Restart api/worker/redis → antrean & status tidak hilang (Redis persistence).
  - Simulasikan provider down → retry + error message jelas.
  - Tenant create session → QR muncul **tanpa internet**.
  - Hotfolder: set active session → drop file → job auto‑enqueue → output tersedia.
  - Stoper: list session `active` → Set Active → booth busy (409) handled → job created → session status `used` → worker mark `done`.

## Security considerations
- Jangan expose API key di frontend; simpan di env backend/worker.
- Gunakan signed URL untuk akses output; TTL pendek (5–15 menit).
- Jangan log image bytes/base64; log hanya `jobId`, storage `key`, dan metadata ringkas.
- Auth operator minimal: password + JWT; rate limit untuk login dan create job.
- Tenant endpoint bersifat public (`POST /sessions`): wajib rate limit + validasi ketat (format WA) + TTL session.
- CORS allowlist hanya origin UI booth.
- Sanitasi/validasi input: ukuran file, MIME type allowlist, dan parameter `mode/styleId`.
- Database:
  - Simpan `DATABASE_URL` hanya di env (Neon).
  - Jika pakai Neon pooler (pgBouncer): tambahkan `pgbouncer=true` di `DATABASE_URL` dan set `DIRECT_URL` (non-pooler) untuk migrasi.
- Jangan commit kredensial DB ke repo.
- PII: endpoint list peserta (`GET /sessions/list`) berisi `name/whatsapp` → idealnya dibatasi role (stoper-only) sebelum production.
- Notifikasi WA via n8n (optional): simpan `N8N_WEBHOOK_URL` di env worker dan amankan endpoint n8n (secret header/HMAC).
