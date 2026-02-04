# Planning DESIGN — Photobot Event/Booth (tanpa timeline)

> Catatan: file ini berisi design. Rencana implementasi MVP ada di `implementation-plan.md` (Postgres + Prisma untuk data permanen, Redis/BullMQ untuk queue).

## 1) Ringkasan sistem
“Photobot Event/Booth” adalah sistem web untuk operator booth yang membuat *job* dari foto peserta (capture/upload) + parameter style/mode, lalu memprosesnya via layer AI (external AI API provider `kie.ai` atau ComfyUI self-hosted di VPS). Backend mengelola autentikasi operator, pembuatan job, antrean pemrosesan, penyimpanan input/output image, serta status/retry yang stabil untuk pemakaian berulang saat event dengan internet fluktuatif.

## Tech stack (ringkas)
- Frontend: Vite + React
- Backend: Node.js + Express
- Package manager: **pnpm** (recommended untuk monorepo/workspaces)
- Database: **Postgres (Neon)** via Prisma
- QR: **offline** via client-side QR generator (tidak bergantung internet)

## 2) User flow operator (step-by-step)
Flow ini diasumsikan memakai **2-phase**: peserta isi data dulu (tenant), baru booth melakukan foto (operator).

1. Operator login.
2. Operator memilih `event` (atau otomatis berdasarkan booth) dan memilih `mode/style`.
3. Operator/stoper memilih peserta:
   - **Mode kode**: peserta menunjukkan `code/QR` hasil registrasi (tenant) → operator lookup (`GET /sessions/:code`).
   - **Mode stoper (1 booth)**: stoper memilih peserta dari daftar registrasi → klik **Set Active** (tanpa input kode).
5. Operator memilih mode capture:
   - **Mode Manual**: ambil foto via webcam/upload.
   - **Mode Pro Camera (Hot Folder)**: aktifkan “Start Capture” untuk menerima file otomatis dari folder kamera profesional.
6. UI membuat *job* (`POST /jobs`) dengan `sessionId` + foto + parameter style/mode (manual), **atau** watcher otomatis meng‑enqueue job (pro camera).
7. UI menampilkan job masuk antrean: `queued` → `running`.
8. Saat selesai (`succeeded`), operator membuka detail job untuk preview dan download/print.
   - (Opsional) sistem otomatis mengirim notifikasi WhatsApp via webhook (mis. n8n) berisi link output.
9. Jika gagal (`failed`), operator dapat retry (dengan parameter sama) atau submit ulang.

## 2a) User flow tenant (peserta) — step-by-step
1. Peserta membuka halaman tenant (public) dan memilih/terdeteksi `event`.
2. Peserta mengisi data: `nama` dan `nomor WhatsApp` (opsional: `kode peserta`).
3. Sistem membuat **session** (`POST /sessions`) lalu menampilkan:
   - `code` (short code) + **QR offline** untuk discan di booth,
   - (opsional) konfirmasi data yang tersimpan.
4. Peserta menuju booth dan menunjukkan `code/QR` ke operator.

## 2b) User flow stoper (opsional, 1-booth)
1. Stoper login (operator auth).
2. Stoper membuka halaman capture dan melihat daftar peserta yang registrasi (`GET /sessions/list?eventId=...&status=active`).
3. Stoper panggil/konfirmasi peserta, lalu klik **Set Active** → backend set booth active session (`POST /booth/:boothId/active-session`) dan menandai session `ready`.
4. Photographer/operator mengambil foto dan submit job (`POST /jobs`) → session ditandai `used`.
5. Saat job selesai, worker menandai session `done` (untuk history/anti double use).

## 3) Arsitektur komponen
### Komponen
- **Frontend (Vite + React)**:
  - `/_tenant`: public form registrasi (buat session, tampilkan QR).
  - `/_operator`: UI operator (login, lookup session, capture/upload, queue, download/print).
- **Backend (Node.js + Express)**: REST API, autentikasi operator, validasi input, pre-signed upload URL (opsional), pembuatan job, status job, integrasi storage, enqueue job, *job results*, audit log minimal.
- **Database (Postgres/Neon)**: data permanen `events/customers/sessions/jobs`.
- **Queue/Worker**:
  - Worker AI: pemrosesan image/AI; update progress/status; simpan output ke storage.
  - (Opsional) Notifikasi: kirim payload job+sesi+output URL ke webhook (mis. n8n) untuk WA blasting.
  - **Hotfolder Watcher**: memantau folder kamera pro, auto‑upload + enqueue job jika ada active session.
- **Storage (S3-compatible atau lokal)**: menyimpan input image dan output image; akses via signed URL.
- **AI provider**:
  - Opsi A: external AI API provider `kie.ai`
  - Opsi B: ComfyUI self-hosted (VPS/GPU)

### Diagram (ASCII)
```
┌──────────────────────────┐
│  Operator UI (React)      │
│  - login, create job      │
│  - queue view, retry      │
└─────────────┬────────────┘
              │ HTTPS (JWT)
              v
┌──────────────────────────┐
│ Backend API (Express)     │
│ - auth, validation        │
│ - create job + enqueue    │
│ - status + download       │
│ - signed URL (optional)   │
└───────┬─────────┬────────┘
        │         │
        │         │ S3 API (put/get)
        │         v
        │   ┌───────────────────────┐
        │   │ Storage (S3/MinIO/R2)  │
        │   │ - input/ output        │
        │   └───────────────────────┘
        │
        │ enqueue / consume
        v
┌──────────────────────────┐
│ Queue (Redis + BullMQ)    │
└─────────────┬────────────┘
              │
              v
┌──────────────────────────┐
│ Worker(s)                 │
│ - download input          │
│ - call AI provider        │
│ - store output            │
│ - update status/progress  │
│ - (optional) webhook n8n   │
└───────┬─────────┬────────┘
        │         │
        │         ├───────────────┐
        │         │               │
        v         v               v
┌──────────────┐  ┌──────────────┐
│ kie.ai (A)   │  │ ComfyUI (B)  │
│ external API │  │ self-hosted  │
└──────────────┘  └──────────────┘
        \
         \ (optional) POST webhook payload
          v
     ┌──────────────────┐
     │ n8n / WA sender   │
     └──────────────────┘
```

## 4) Desain API backend
### Prinsip umum
- Semua endpoint (kecuali login) butuh `Authorization: Bearer <token>`.
- `jobId` adalah UUID (atau ULID) untuk mudah sorting.
- Response konsisten: `data` untuk sukses, `error` untuk gagal.
- File upload:
  - MVP: upload multipart langsung ke backend.
  - Skala/lebih stabil: frontend upload langsung ke storage memakai signed URL (backend hanya mengeluarkan URL).
- Tambahan 2-phase:
  - Buat **session** saat tenant submit data.
  - Operator hanya mengirim `sessionId` saat create job agar data peserta sinkron.

### Endpoint: Sessions (tenant + stoper)
- `POST /sessions` (public tenant): membuat session + `code`.
- `GET /sessions/:code` (operator): lookup participant untuk flow kode.
- `GET /sessions/list` (operator/stoper): list peserta yang sudah registrasi.

**State session (minimal)**:
- `active` (baru registrasi / pending)
- `ready` (sudah dipanggil stoper, siap difoto)
- `used` (job sudah dibuat/enqueue)
- `done` (job selesai diproses)

#### `GET /sessions/list`
Query:
- `eventId` (required)
- `status` (`active|ready|used|done`, default `active`)
- `limit` (1–100, default 50)
- `q` (optional search by name/whatsapp)

### Endpoint: Auth (minimal)
- `POST /auth/login`

Contoh request:
```json
{ "username": "operator1", "password": "******" }
```
Contoh response:
```json
{ "token": "jwt...", "expiresIn": 3600 }
```

### Endpoint: Sessions (tenant)
#### `POST /sessions` (public)
Membuat session untuk peserta (nama + WA) dan mengembalikan `code` untuk booth.

Request:
```json
{
  "eventId": "event-2026-01",
  "name": "Andi",
  "whatsapp": "62812xxxxxxx"
}
```
Response:
```json
{
  "data": {
    "sessionId": "sess_01HZZ...",
    "code": "A7K3D9",
    "expiresAt": "2026-01-16T14:00:00.000Z"
  }
}
```

Validasi:
- `name` wajib, min 2 char.
- `whatsapp` wajib, format E.164-ish (disarankan simpan dalam bentuk `62...` tanpa `+`).
- Rate limit per IP/device untuk mencegah spam.

#### `GET /sessions/:code` (operator-only)
Lookup session berdasarkan `code` untuk memastikan data sinkron sebelum foto.

Response:
```json
{
  "data": {
    "sessionId": "sess_01HZZ...",
    "eventId": "event-2026-01",
    "name": "Andi",
    "whatsapp": "62812xxxxxxx"
  }
}
```

### Endpoint minimal: POST /jobs
Membuat job dari upload foto + parameter pemrosesan.

**Opsi 1 (MVP): multipart upload**
- `POST /jobs` dengan `Content-Type: multipart/form-data`
- Field:
  - `eventId` (string, wajib)
  - `sessionId` (string, wajib untuk flow 2-phase)
  - `mode` (string, wajib)
  - `styleId` (string, wajib)
  - `metadata` (JSON string, opsional; mis. `printSize`, `notes`)
  - `image` (file, wajib; jpg/png/webp)

Response sukses:
```json
{
  "data": {
    "jobId": "01HZZ...ULID",
    "status": "queued",
    "createdAt": "2026-01-16T08:00:00.000Z"
  }
}
```

**Opsi 2 (lebih robust): signed upload**
1) `POST /jobs` membuat job + *upload session*:
```json
{
  "eventId": "event-2026-01",
  "participant": { "name": "Andi", "code": "A-001" },
  "mode": "portrait",
  "styleId": "style-neon-01",
  "input": { "contentType": "image/jpeg", "sizeBytes": 1843221, "sha256": "..." },
  "options": { "provider": "kie", "print": { "enabled": true, "format": "4R" } }
}
```
Response:
```json
{
  "data": {
    "jobId": "01HZZ...ULID",
    "status": "queued",
    "upload": {
      "method": "PUT",
      "url": "https://storage...signed",
      "headers": { "Content-Type": "image/jpeg" },
      "expiresAt": "2026-01-16T08:05:00.000Z"
    }
  }
}
```
2) Frontend upload ke `upload.url`, lalu backend/worker memproses ketika object tersedia (bisa *polling* atau *assume immediate*).

### Endpoint: GET /jobs/:id
Mengambil status + hasil job.

Response:
```json
{
  "data": {
    "jobId": "01HZZ...ULID",
    "eventId": "event-2026-01",
    "participant": { "name": "Andi", "code": "A-001" },
    "status": "running",
    "progress": { "percent": 45, "stage": "ai_processing" },
    "provider": { "type": "kie", "requestId": "ext-req-123" },
    "input": { "key": "event-2026-01/2026-01-16/01HZZ.../input.jpg" },
    "output": [
      {
        "type": "image",
        "key": "event-2026-01/2026-01-16/01HZZ.../output_1.jpg",
        "signedUrl": "https://storage...signed",
        "expiresAt": "2026-01-16T09:00:00.000Z"
      }
    ],
    "error": null,
    "createdAt": "2026-01-16T08:00:00.000Z",
    "updatedAt": "2026-01-16T08:00:30.000Z"
  }
}
```

### Endpoint: GET /jobs/:id/download (optional)
Menyediakan download langsung (proxy/redirect) ke output terbaik.
- Jika memakai signed URL, endpoint ini bisa `302 Redirect` ke signed URL, atau `200` stream file (lebih berat untuk backend).

Response sukses (redirect):
- `302 Location: https://storage...signed`

### Error codes & aturan validasi input
**HTTP status**:
- `400` invalid input (field missing/format salah)
- `401` unauthorized (token missing/invalid)
- `403` forbidden (operator tidak boleh akses event ini)
- `404` job tidak ditemukan
- `409` conflict (duplicate submission / idempotency key already used)
- `413` payload too large (file terlalu besar)
- `415` unsupported media type (file bukan jpg/png/webp)
- `422` unprocessable (parameter style/mode tidak cocok)
- `429` rate limited (opsional)
- `500` server error
- `503` provider unavailable (circuit breaker aktif / provider down)

**Validasi utama**:
- `eventId`: string non-empty, whitelist format.
- `sessionId`: wajib dan harus valid/aktif untuk `eventId` terkait.
- `mode`, `styleId`: harus termasuk daftar yang disupport untuk event.
- `image`: content-type allowlist + ukuran maksimal (mis. 10MB) + resolusi minimal (mis. 720p) untuk kualitas.
- Idempotency: support header `Idempotency-Key` atau gabungan `(eventId, participantCode, clientTimestampBucket)` untuk dedup.

Contoh error response:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "details": [{ "field": "image", "reason": "unsupported_type" }]
  }
}
```

## 5) Desain worker & queue
### Rekomendasi utama: BullMQ + Redis
- **BullMQ** memberi fitur concurrency, retry/backoff, delayed jobs, dan monitoring yang matang.
- **Redis** sebagai backend queue; worker bisa diskalakan horizontal (lebih dari 1 worker).

**Alternatif jika tanpa Redis**
- **In-memory queue** (paling sederhana): tidak tahan restart → risiko besar untuk event (tidak direkomendasikan).
- **SQLite-backed queue** (custom): lebih tahan restart, tapi perlu implementasi locking & concurrency.
- **RabbitMQ**: kuat, tapi lebih kompleks operasional dibanding Redis untuk tim kecil.
- **SQS** (kalau cloud AWS): stabil, tapi perlu internet stabil; latensi & biaya.

### Status job
- `queued`: job dibuat dan menunggu worker.
- `running`: sedang diproses.
- `succeeded`: output tersedia.
- `failed`: gagal setelah retry/atau error fatal.
- `canceled`: dibatalkan operator (hanya jika belum final).

**Progress (opsional tapi disarankan)**:
- `progress.percent` (0–100)
- `progress.stage`: `uploading | queued | preprocessing | ai_processing | postprocessing | uploading_output | done`

### Retry policy
- Retry hanya untuk error yang *transient* (timeout, 5xx, network error).
- Backoff: exponential (mis. 5s, 15s, 45s) dengan jitter.
- Max attempts:
  - provider call: 3 attempts
  - upload ke storage: 5 attempts (lebih ringan)
- Timeouts:
  - download input: 30s
  - AI processing: tergantung provider (mis. 90–180s) + hard timeout.

### Concurrency
- Worker concurrency berbasis resource:
  - External API: concurrency lebih tinggi (mis. 3–10) tergantung rate limit.
  - ComfyUI (GPU): concurrency 1–2 per GPU untuk stabil.
- Queue dapat dipisah per provider: `ai-kie`, `ai-comfy` untuk kontrol.

### Idempotency & dedup
- Terima header `Idempotency-Key` dari frontend; backend menyimpan mapping key→jobId.
- Dedup tambahan: hash file (SHA-256) + `eventId` + `participantCode` + bucket waktu (mis. per 1 menit) untuk mencegah double click.
- Worker harus idempotent:
  - Jika output sudah ada dan job status final, jangan proses ulang.
  - Jika retry terjadi, worker cek apakah provider sudah menghasilkan output sebelumnya (pakai `provider.requestId` jika ada).

## 6) Desain storage
### Opsi storage
- **S3 (AWS S3)**: paling umum, reliabel, biaya jelas.
- **Cloudflare R2**: S3-compatible, sering lebih murah egress, cocok untuk download event.
- **MinIO**: S3-compatible on-prem/VPS; cocok untuk booth lokal (LAN) dan internet fluktuatif.
- **Local disk**: hanya untuk dev; untuk event berisiko (disk penuh, tidak multi-node).

### Struktur folder/key naming
Gunakan format yang mudah di-query dan dihapus per event/tanggal:
- `events/{eventId}/{yyyy-mm-dd}/{jobId}/input.{ext}`
- `events/{eventId}/{yyyy-mm-dd}/{jobId}/output_{n}.{ext}`
- `events/{eventId}/{yyyy-mm-dd}/{jobId}/meta.json` (opsional; ringkas info job)

Contoh:
- `events/event-2026-01/2026-01-16/01HZZ.../input.jpg`
- `events/event-2026-01/2026-01-16/01HZZ.../output_1.jpg`

### TTL/retention policy
- Default event booth: **auto-delete 7–30 hari** (konfigurabel per event).
- Implementasi:
  - Lifecycle rule (S3/R2) berdasarkan prefix `events/{eventId}/`.
  - Atau scheduled cleanup job yang menghapus object berdasarkan `createdAt + retentionDays`.

### Link akses: signed URL
- Backend menghasilkan signed URL untuk `GET` output (dan input jika perlu).
- TTL signed URL pendek (mis. 5–15 menit) agar aman.
- Untuk kebutuhan print station lokal, dapat gunakan caching lokal atau proxy endpoint yang men-stream output (dengan auth).

## 7) Desain AI processing layer (bandingkan 2 opsi)
### Konsep layer
Worker memanggil “AI Adapter” yang menyamakan interface:
- Input: `inputImageKey`, `mode/styleId`, `prompt preset`, `seed`, `workflowId` (untuk ComfyUI)
- Output: list `outputImage` (url/key), metadata (seed, model, elapsed, providerRequestId)

### Opsi A: External AI API (kie.ai)
**Alur request**
1. Worker download input dari storage (atau kirim URL jika provider mendukung).
2. Worker kirim request ke `kie.ai` (multipart/base64/url), termasuk prompt/preset/style.
3. Worker polling result atau tunggu callback (jika tersedia).
4. Output image diunduh lalu disimpan ke storage, status job `succeeded`.

**Format input/output (konseptual)**
- Input:
  - `image`: bytes atau URL
  - `prompt`/`style`
  - `seed` (opsional)
  - `params`: ratio, steps, strength, dll (sesuai API)
- Output:
  - `images[]` URL/base64
  - `metadata`: seed, model, duration, requestId

**Timeout & retry**
- Gunakan timeout ketat per request (mis. 60–120s) + total job timeout (mis. 3–5 menit).
- Retry untuk 5xx/timeout; jangan retry untuk 4xx (invalid params).

**Biaya/risiko**
- Biaya per request/credit; perlu kontrol rate limit.
- Ketergantungan internet & vendor availability; risiko perubahan API.

**Yang perlu disimpan**
- `provider`: `kie`
- `providerRequestId`
- `promptPresetId`/`styleId`
- `seed` (jika provider mengembalikan)
- parameter penting yang memengaruhi output (ratio, strength, model)

### Opsi B: ComfyUI self-hosted
**Alur request**
1. Worker menyiapkan payload workflow (JSON graph) + input image.
2. Worker upload input ke ComfyUI (atau mount/shared storage), lalu trigger run.
3. Worker polling status ComfyUI (queue + execution) sampai selesai.
4. Worker fetch output (image bytes) dari ComfyUI, simpan ke storage.

**Format input/output (konseptual)**
- Input:
  - `workflowId` atau `workflowJson`
  - mapping node input (image, prompt, seed, strength)
- Output:
  - output images (bytes) + execution metadata (seed, node timings)

**Timeout & retry**
- Timeout lebih tinggi (mis. 180–600s) tergantung workflow.
- Retry harus hati-hati: kalau GPU node crash, retry bisa berhasil setelah restart; gunakan backoff lebih panjang.

**Biaya/risiko**
- Biaya VPS/GPU per jam; lebih murah per gambar jika volume tinggi.
- Risiko operasional: GPU down, VRAM OOM, disk penuh, perlu monitoring dan restart strategy.

**Yang perlu disimpan**
- `provider`: `comfy`
- `workflowId`/versi workflow
- `prompt`/preset
- `seed` (penting untuk reproducibility)
- `model checkpoint` (jika berubah-ubah)

### Tabel perbandingan (pro/cons)
| Aspek | Opsi A: kie.ai (external) | Opsi B: ComfyUI (self-hosted) |
|---|---|---|
| Setup awal | Cepat, minim infra | Perlu VPS/GPU, setup & maintenance |
| Stabilitas internet | Sangat bergantung internet | Tetap butuh internet untuk UI/backoffice, tapi proses bisa lebih “dekat” jika VPS stabil |
| Kontrol kualitas | Tergantung provider | Full control workflow/model |
| Skalabilitas | Skala mudah via API limit | Skala butuh tambah GPU/instance |
| Biaya | Per-request/credit | Fixed cost GPU + ops |
| Latensi | Tergantung jaringan/provider | Bisa lebih cepat jika GPU cukup, tapi risiko antrean GPU |
| Risiko vendor | Tinggi (API/price changes) | Risiko operasional (downtime GPU) |
| Debugging | Terbatas | Lebih dalam (logs, workflow) |

## 8) Reliability untuk event
### Handling internet putus
- **Antrean lokal (frontend)**:
  - Saat `POST /jobs` gagal karena network, simpan “draft job” di IndexedDB/localStorage (metadata + file handle jika memungkinkan).
  - UI menyediakan tombol “Resume/Retry upload”.
  - Jika signed upload, file upload bisa dilanjutkan (gunakan retry + chunk upload jika diimplementasikan; jika tidak, ulang upload).
- **Mode fallback minimal**:
  - Jika AI provider down, izinkan operator tetap capture/upload dan job tetap `queued` (diproses ketika provider pulih).
  - Opsional “non-AI mode”: hanya simpan foto original untuk menghindari kehilangan data peserta.
- **Session offline**
  - Kalau tenant internet putus, arahkan tenant untuk isi data di device operator (fallback manual entry) atau sediakan QR generator offline (non-MVP).

### Timeout & user feedback di UI
- UI menampilkan:
  - status jelas (`queued/running/failed`)
  - countdown atau indikator “processing > 2 menit” + tindakan: “tunggu / retry / batalkan”
- Jika request status gagal, UI lakukan retry polling dengan backoff.

### Circuit breaker sederhana untuk provider AI
- Di worker (atau service layer):
  - Jika N error berturut-turut (mis. 5) dalam window (mis. 2 menit), tandai provider “open” selama cool-down (mis. 1 menit).
  - Saat open: job baru untuk provider itu langsung ditunda (delayed) atau diarahkan ke provider lain (jika tersedia).
  - Catat alasan di log agar operator tahu “provider sedang bermasalah”.

## 9) Security & privacy
- Jangan expose API key di frontend: semua key provider disimpan di backend/worker env.
- Auth operator:
  - Minimal: `username/password` di backend + JWT access token.
  - Opsional: refresh token atau token expiry pendek + re-login cepat.
- Endpoint tenant (`POST /sessions`) bersifat public:
  - Rate limit + basic validation yang ketat.
  - Jangan bocorkan data sensitif lewat error detail.
- Proteksi endpoint:
  - CORS hanya untuk origin booth.
  - Rate limit untuk login dan create job (anti mis-click/bot).
- Privasi data:
  - Foto mentah (input) punya retention lebih pendek dari output jika memungkinkan.
  - Log tidak menyimpan base64 image atau URL publik; hanya key storage + jobId.
  - Signed URL TTL pendek.
  - Jika kirim notifikasi WA via webhook (mis. n8n): gunakan endpoint private + optional secret header/HMAC, dan kirim minimal data yang diperlukan.

## 10) Observability minimal
### Log yang wajib
Per event/job, minimal fields:
- `jobId`, `eventId`, `participantCode` (jika ada)
- `status transition` (queued→running→succeeded/failed)
- `provider` (`kie`/`comfy`)
- `durationMs` total + per stage (preprocess, ai, upload)
- `attempt`/retry count + backoff
- `error.code` + `error.message` ringkas + `providerRequestId` jika ada

### Metrics sederhana
- Throughput: `jobs_per_minute`
- Success rate: `success_rate` dan `fail_rate`
- Latency: `p50/p95 job_duration_ms`
- Queue depth: `queued_jobs` dan `running_jobs`
- Provider health: `provider_errors_per_minute`

Implementasi bisa sesederhana:
- JSON logs ke stdout + agregasi (lokal) atau kirim ke layanan log (opsional).
- Endpoint `/health` + `/metrics` (Prometheus style) jika diperlukan.

## 11) UI operator (Vite React) – layar/komponen minimal
- **Tenant (Public Registration)**
  - form: eventId + nama + nomor WA
  - output: tampilkan `code` + QR **offline** (untuk booth scan/input)
- **Login**
  - form user/pass, error handling, loading state
- **Dashboard/Queue**
  - list job terbaru + filter status
  - indikator antrean (queued/running)
  - tombol “Retry” (untuk failed) dan “Cancel” (jika masih queued)
- **Capture/Upload**
  - field lookup: input/scan `code` (ambil `name/wa` dari session)
  - state error jika session expired/invalid (minta lookup ulang)
  - webcam capture (preview + retake) dan upload file
  - **Pro Camera Mode**: tombol Start/Stop, status “menunggu file”, daftar job terbaru
  - pilih mode/style + input nama/kode
  - tombol “Submit” dengan disable saat uploading
  - state network/offline banner + “Resume”
- **Job Detail**
  - status + progress stage
  - preview output + download/print
  - error detail ramah + tombol retry
- **Gallery/History**
  - grid output per event/tanggal
  - pencarian by participant code/nama

**State UI untuk job**
- `queued`: tampil “menunggu antrean” + posisi (jika ada).
- `running`: progress bar + stage text.
- `done/succeeded`: preview + download/print.
- `failed`: badge merah + reason ringkas + retry.

## 12) Risiko & mitigasi (khusus event booth)
- **Printer/Download bottleneck**
  - Mitigasi: caching output lokal (browser cache / service worker), opsi print station terpisah (device khusus), batasi ukuran output, sediakan tombol “reprint” tanpa reprocess.
- **Duplicate submission (double click / jaringan retry)**
  - Mitigasi: idempotency key, disable submit saat upload, dedup by hash+bucket time, tampilkan “job already created”.
- **AI output tidak sesuai**
  - Mitigasi: preset style yang dikurasi, opsi “regenerate” dengan seed baru, moderation sederhana (manual review), fallback style “safe”.
- **GPU VPS down (ComfyUI)**
  - Mitigasi: health check + auto-restart, queue pause/resume, fallback ke provider `kie.ai` jika disiapkan, simpan job agar bisa diproses ulang setelah pulih.

## 13) Next steps (tanpa timeline)
- Definisikan data model job (status, provider, storage keys, metadata, retention).
- Implement backend Express + auth operator (JWT) + role/event scoping.
- Implement `POST /jobs` (MVP multipart) + validasi + dedup/idempotency.
- Implement stoper flow: `GET /sessions/list` + tombol Set Active + handle `409 BOOTH_BUSY`.
- Setup storage adapter (S3-compatible) + signed URL untuk output.
- Setup BullMQ + Redis + worker basic pipeline (download input → process → upload output → update status).
- Implement AI adapter untuk Opsi A (kie.ai) dengan timeout/retry + error mapping.
- Implement UI React: Login + Capture/Upload + Dashboard/Queue + Job Detail (polling status).
- Tambahkan retry/cancel flow + job progress updates.
- Tambahkan observability minimal: structured logs + health endpoint + basic metrics counters.
- Tambahkan retention cleanup (lifecycle rule atau scheduled cleanup job).
- Tambahkan circuit breaker sederhana untuk provider.
- Hardening event mode: offline banner + resume upload + guard double submit.
### Endpoint: Booth (hotfolder)
#### `POST /booth/:boothId/active-session` (operator-only)
Set sesi aktif untuk booth (dipakai hotfolder watcher).

Request:
```json
{
  "sessionId": "sess_01HZZ...",
  "eventId": "event-2026-01",
  "mode": "portrait",
  "styleId": "cyber"
}
```
Response:
```json
{
  "data": {
    "boothId": "booth-1",
    "sessionId": "sess_01HZZ...",
    "eventId": "event-2026-01",
    "name": "Andi",
    "whatsapp": "62812xxxxxxx",
    "mode": "portrait",
    "styleId": "cyber",
    "ttlSeconds": 1800
  }
}
```

#### `GET /booth/:boothId/active-session`
Mengambil sesi aktif saat ini untuk booth.
- Jika tidak ada sesi aktif: `200 { "data": null }`.

#### `DELETE /booth/:boothId/active-session`
Menonaktifkan sesi aktif (stop capture).
- Idempotent: jika booth sudah kosong tetap `200` (tidak error).

#### `POST /booth/:boothId/active-session/refresh`
Refresh TTL (dipakai watcher saat file masuk).

**Error khusus**
- `409 BOOTH_BUSY`: jika booth sudah punya active session yang berbeda (mencegah salah foto orang).
