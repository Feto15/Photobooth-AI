# Implementation Plan — Photobot Event/Booth

Dokumen ini adalah rencana implementasi teknis (tanpa timeline) yang menurunkan kebutuhan dari `planning.md` menjadi langkah kerja, struktur repo, kontrak modul, dan checklist build yang bisa langsung dieksekusi oleh tim.

## 0) Scope MVP vs non-MVP
**MVP (event-ready)**
- 2-phase flow: tenant isi data dulu → operator foto dan submit job dengan session.
- Auth operator + UI minimal (Tenant form + QR offline, Login, Lookup+Capture/Upload, Queue, Job Detail).
- `POST /jobs`, `GET /jobs/:id`, `GET /jobs/:id/download`.
- `POST /sessions` (public tenant) + `GET /sessions/:code` (operator lookup).
- **Hotfolder (Pro Camera)**: watcher + active session booth (optional but supported).
- Queue + worker terpisah untuk AI processing.
- Storage S3-compatible untuk input/output + signed URL.
- AI provider minimal 1 opsi (disarankan mulai dari `kie.ai` untuk cepat).
- Logging terstruktur + health endpoint.

**Non-MVP (setelah stabil)**
- Signed upload flow (frontend direct-to-storage).
- Gallery/History + pencarian.
- Metrics endpoint + dashboard sederhana.
- Circuit breaker lebih matang + fallback provider (kie ↔ comfy).
- Retention cleanup otomatis.

## 1) Struktur repository (disarankan monorepo)
Gunakan monorepo supaya FE/BE/worker bisa share types, dan **pakai pnpm workspaces** untuk dependency management.
```
/
  pnpm-workspace.yaml
  package.json
  pnpm-lock.yaml
  apps/
    web/            # Vite + React operator UI
    api/            # Express API server
    worker/         # BullMQ worker process
  packages/
    shared/         # types, zod schemas, util
    db/             # prisma schema + db client
  infra/
    docker/         # docker-compose redis/minio (optional)
  docs/
    planning.md     # design doc (optional move)
```

### 1.1 pnpm workspace (wajib)
`pnpm-workspace.yaml` (contoh):
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### 1.2 Script standar (root)
Root `package.json` (contoh scripts):
- `pnpm dev` → jalanin api + worker + web paralel
- `pnpm build` → build semua (web + api/worker jika perlu)
- `pnpm lint` / `pnpm test`

Contoh cara jalanin per app (pnpm filter):
- `pnpm --filter @photobot/api dev`
- `pnpm --filter @photobot/worker dev`
- `pnpm --filter @photobot/web dev`

## 2) Keputusan komponen inti (yang perlu “dikunci” dulu)
### 2.1 DB utama: Postgres (Neon) + Redis untuk queue
Gunakan **Postgres (Neon)** untuk data permanen (customers/sessions/jobs), dan **Redis + BullMQ** khusus untuk queue + state transient.

### 2.2 Queue
- Default: **BullMQ + Redis**.
- Redis bisa dijalankan lokal (docker) atau managed.

### 2.3 Storage
Target interface S3-compatible:
- AWS S3 / Cloudflare R2 / MinIO (pilih saat deploy).

## 3) Data model (Postgres + Redis)
### 3.1 Operator auth (MVP paling simpel)
- Single operator password di env (contoh: `OPERATOR_PASSWORD`) + JWT.
- (Opsional) multi operator via env `OPERATORS_JSON` (array username+passwordHash).

### 3.2 Tabel Postgres (standar)
- `events`
- `customers` (participants)
- `sessions`
- `jobs`
- `job_attempts` (optional)
- `job_prints` (optional)

### 3.3 Redis (queue + transient)
- BullMQ job data (snapshot minimal untuk worker)
- Idempotency keys: `idemp:{key}` → `jobId` (TTL 10–30 menit)
- Active booth session: `activeSession:{boothId}` (TTL 30–60 menit)

### 3.4 Active booth session (Redis)
Untuk pro camera (hotfolder), simpan sesi aktif booth:
- `activeSession:{boothId}` → `{ sessionId, eventId, name, whatsapp, mode, styleId, operatorId, startedAt }`
  - TTL: 30–60 menit (refresh saat file masuk)

### 3.5 Idempotency (Redis)
- Key: `idemp:{Idempotency-Key}` → value `jobId` (gunakan `SET NX EX`).
  - TTL: mis. 10–30 menit untuk mencegah double-click.

## 4) Backend API (Express) — breakdown implementasi
### 4.1 Fondasi server
- Middlewares: `helmet`, `cors` (allowlist), `compression` (optional), `pino` logger.
- `GET /health`: cek Redis + storage (opsional “shallow check”).

### 4.2 Auth
- `POST /auth/login`:
  - verify password (`bcrypt`/`argon2`)
  - issue JWT (`sub=operatorId`, `role`, `exp`)
- Middleware `requireAuth` untuk endpoint job.

### 4.3 Endpoint job

#### `POST /jobs` (MVP multipart)
- Parser: `multer` memory storage atau disk temp.
- Validasi:
  - schema request (Zod di `packages/shared`)
  - image type/size constraints
- Langkah:
  1) hitung `sha256` file (stream)
  2) cek idempotency (header `Idempotency-Key` atau derived)
  3) generate `jobId` (ULID/UUID)
  4) validasi `sessionId` (harus ada dan aktif untuk `eventId`)
  5) ambil `name/whatsapp` dari session lalu snapshot ke job data
  6) upload input ke storage (`inputKey`)
  7) enqueue job ke BullMQ dengan `jobId` + job `data` lengkap
  6) return `{jobId,status:'queued'}`

#### `GET /jobs/:id`
- Fetch job + generate signed URL untuk output (jika `succeeded`).
- Return progress + error (ringkas) + metadata.

#### `GET /jobs/:id/download`
- Cari `bestOutputKey` atau output pertama.
- `302` redirect ke signed URL (default) atau stream (opsional).

#### Endpoint tambahan (recommended)
- `POST /jobs/:id/retry`: create “child job” baru (lebih aman daripada re-run id sama).
- `POST /jobs/:id/cancel`: mark canceled + remove from queue jika belum running.
- `GET /jobs?eventId=&status=&q=`: list untuk Dashboard/History.

### 4.4 Endpoint booth (pro camera)
#### `POST /booth/:boothId/active-session` (operator-only)
- Input: `{ sessionId, eventId, mode, styleId }`
- Simpan ke Redis `activeSession:{boothId}` + TTL
- Return data sesi aktif + TTL

#### `GET /booth/:boothId/active-session`
- Return sesi aktif dan `ttlSecondsRemaining`

#### `DELETE /booth/:boothId/active-session`
- Clear active session

#### `POST /booth/:boothId/active-session/refresh`
- Refresh TTL (dipanggil watcher saat file masuk)

### 4.5 Endpoint sessions (tenant + operator lookup)
#### `POST /sessions` (public)
- Input: `{ eventId, name, whatsapp }`
- Langkah:
  1) validasi format `whatsapp` + `name`
  2) generate `sessionId` + `code`
  3) `SET session:{code} ... EX <ttl>`
  4) return `{ sessionId, code, expiresAt }`
- Security:
  - rate limit per IP/device
  - optional “captcha ringan” (non-MVP)

#### `GET /sessions/:code` (operator-only)
- Validasi auth operator.
- Return `{ sessionId, name, whatsapp, eventId }` atau `404`.

## 5) Storage adapter
Buat modul `StorageClient` dengan interface:
- `putObject(key, bytes, contentType)`
- `getObject(key)` (worker)
- `createSignedGetUrl(key, ttlSeconds)` (api)

Key builder util:
- `events/{eventId}/{yyyy-mm-dd}/{jobId}/input.{ext}`
- `events/{eventId}/{yyyy-mm-dd}/{jobId}/output_{n}.{ext}`

Checklist implementasi:
- Support S3 path-style (untuk MinIO) via env config.
- Retry upload/download (exponential + jitter).
- Enforce max size output (guard disk/memory).

## 6) Worker pipeline (BullMQ)
### 6.1 Job payload
Queue payload minimal: job `data` BullMQ (source of truth ada di Postgres; Redis/BullMQ hanya state transient).

### 6.2 Pipeline langkah
1. Ambil `job.data`; validasi minimal (defensive).
2. `job.updateProgress({ percent: 1, stage: 'preprocessing' })`.
3. Download input bytes dari storage (pakai `inputKey`).
4. `job.updateProgress({ percent: 30, stage: 'ai_processing' })` lalu panggil AI adapter.
5. `job.updateProgress({ percent: 80, stage: 'uploading_output' })` lalu upload output ke storage.
6. Return value job: `{ outputKeys, bestOutputKey, providerRequestId, seed?, ... }` dan `job.updateProgress({ percent: 100, stage: 'done' })`.

### 6.3 Retry/backoff dan klasifikasi error
- Map error ke:
  - `transient` (timeout/network/5xx) → retry
  - `fatal` (validation/4xx) → fail tanpa retry
- Simpan `errorCode/errorMessage` ringkas (tanpa data sensitif).

### 6.4 Concurrency
- Set concurrency lewat env:
  - `WORKER_CONCURRENCY_KIE=5`
  - `WORKER_CONCURRENCY_COMFY=1`

## 7) AI adapters
Buat interface `AiProvider`:
- `process({ inputImageBytes, mode, styleId, seed?, ... }): { outputs: Buffer[], metadata }`

### 7.1 Adapter `kie.ai` (start here)
- Implement:
  - request building (multipart/url)
  - timeout per call + total timeout
  - retry only on transient errors
- Store:
  - `providerRequestId`, `seed` (jika ada), parameter utama.

### 7.2 Adapter ComfyUI (phase 2)
- Implement:
  - submit workflow execution
  - polling execution status
  - fetch output images
- Guard:
  - handle GPU OOM / queue stuck (hard timeout)

## 8) Frontend (Vite + React) — breakdown implementasi
### 8.1 Fondasi
- Router: React Router.
- Data fetching: TanStack Query (polling status + caching).
- Form validation: Zod + react-hook-form (optional).

### 8.2 Screens (MVP)
- Tenant (Public):
  - form `eventId + name + whatsapp`
  - hasil: tampil `code` + **QR offline** (tanpa dependency internet)
- Login:
  - save token (memory + localStorage optional)
- Capture/Upload:
  - lookup session by `code` (scan/input)
  - tampil `name + whatsapp` read-only (sinkron)
  - webcam via `getUserMedia`
  - preview + retake
  - submit job (multipart to backend)
  - disable submit during upload
  - **Pro Camera Mode**:
    - tombol Start/Stop (set active session booth)
    - status “waiting for file”
    - recent jobs list (polling)
- Dashboard/Queue:
  - list jobs (`GET /jobs`)
  - status chips + quick open detail
- Job Detail:
  - polling `GET /jobs/:id`
  - download button (`/jobs/:id/download`)
  - retry button (`/jobs/:id/retry`)

### 8.3 Offline/retry UX (event hardening)
- Global network banner (online/offline + last sync).
- If create job fails due network:
  - save draft record (metadata + “needs re-upload”) ke IndexedDB
  - show “Resume upload” list

## 9) Observability & ops checklist
### 9.1 Logging
- Pino JSON logs di api + worker.
- Correlation: selalu log `jobId`.

### 9.2 Metrics (minimal)
- `GET /metrics` (prom-client):
  - counters: jobs_total{status,provider}
  - histogram: job_duration_ms{provider}
  - gauge: queue_depth

### 9.3 Health checks
- `/health`:
  - Redis ping
  - (optional) storage head bucket

## 10) Security checklist
- CORS allowlist.
- JWT secret kuat + expiry pendek (mis. 1 jam).
- Rate limit login + create job.
- Rate limit `POST /sessions` (public).
- Jangan log API keys, jangan log image bytes.
- Signed URL TTL pendek (5–15 menit).

## 11) Environment variables (draft)
**API**
- `PORT`
- `JWT_SECRET`
- `OPERATOR_PASSWORD` (MVP single operator)
- `REDIS_URL`
- `DATABASE_URL` (Neon Postgres)
- `SESSION_TTL_SECONDS` (mis. 21600 untuk 6 jam)
- `ACTIVE_SESSION_TTL_SECONDS` (mis. 1800)
- `S3_ENDPOINT` (optional untuk MinIO/R2)
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_BUCKET`
- `S3_FORCE_PATH_STYLE` (`true` untuk MinIO)

**WORKER**
- `REDIS_URL`
- `S3_*` (sama)
- `AI_PROVIDER_DEFAULT` (`kie|comfy`)
- `KIE_API_KEY`
- `KIE_API_BASE_URL` (optional)
- `COMFY_API_BASE_URL` (phase 2)
- `WORKER_CONCURRENCY_KIE`
- `WORKER_CONCURRENCY_COMFY`
- `HOTFOLDER_PATH` (mis. `./hotfolder`)
- `ORPHAN_PATH` (mis. `./hotfolder/orphan`)
- `INVALID_PATH` (mis. `./hotfolder/invalid`)
- `PROCESSED_PATH` (mis. `./hotfolder/processed`)
- `BOOTH_ID` (mis. `booth-1`)
- `FILE_STABILITY_DELAY_MS` (mis. `2000`)

**WEB**
- `VITE_API_BASE_URL`
- `VITE_EVENT_ID`
- `VITE_BOOTH_ID`

## 12) Testing & verification (minimal tapi bernilai)
- API:
  - unit test schema validation (Zod)
  - integration test `POST /auth/login`, `POST /jobs`, `GET /jobs/:id` (Supertest)
- Worker:
  - test classification error (transient vs fatal)
  - test storage key builder
- Manual run checklist:
  - create job sukses → output tersimpan → download works
  - restart api/worker → job status tidak hilang
  - retry job setelah failure
  - tenant: create session → QR muncul tanpa internet
  - hotfolder: set active session → drop file → job auto‑enqueue → output tersedia

## 13) Perintah kerja (pnpm)
Minimal command yang dipakai tim:
- Install: `pnpm i`
- Prisma: `pnpm -C packages/db prisma generate` dan `pnpm -C packages/db prisma migrate dev`
- Dev (semua): `pnpm dev`
- Dev per package: `pnpm --filter <name> dev`
- Build (semua): `pnpm build`
