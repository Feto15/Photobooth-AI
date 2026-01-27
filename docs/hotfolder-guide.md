# Hot Folder (Pro Camera Mode) — Setup & Testing Guide

Fitur ini memungkinkan kamera profesional (DSLR/Mirrorless) yang tersambung ke komputer untuk **otomatis submit job** ke sistem Photobot tanpa operator perlu klik tombol "Submit" manual.

## Arsitektur

```
┌─────────────────────┐
│  Kamera Pro (DSLR)  │
│  → Save to folder   │
└──────────┬──────────┘
           │ File saved
           v
┌─────────────────────┐
│  /hotfolder         │
│  (watched by node)  │
└──────────┬──────────┘
           │ chokidar detect
           v
┌─────────────────────┐       ┌─────────────────────┐
│  Hotfolder Watcher  │──────▶│  Redis              │
│  (hotfolder-watcher)│       │  activeSession:booth│
└──────────┬──────────┘       └─────────────────────┘
           │ upload + enqueue
           v
┌─────────────────────┐
│  S3 Storage         │
│  + BullMQ Queue     │
└─────────────────────┘
```

## Redis Data Model

### Active Session
```
Key: activeSession:{boothId}
TTL: 30 menit (auto-reset tiap file masuk)
Value: {
    sessionId: string,
    eventId: string,
    code: string,
    name: string,
    whatsapp: string,
    operatorId: string,
    startedAt: ISO string
}
```

### Idempotency (Hotfolder)
```
Key: idemp:hotfolder:{sessionId}:{fileHash16}
TTL: 1 jam
Value: jobId
```

## API Endpoints

### Set Active Session
```
POST /booth/:boothId/active-session
Headers: Authorization: Bearer <token>
Body: { sessionId, eventId, code? }
Response: { boothId, sessionId, eventId, name, whatsapp, ttlSeconds }
```

### Clear Active Session
```
DELETE /booth/:boothId/active-session
Headers: Authorization: Bearer <token>
Response: { boothId, cleared: true }
```

### Get Active Session
```
GET /booth/:boothId/active-session
Headers: Authorization: Bearer <token>
Response: { boothId, sessionId, ..., ttlSecondsRemaining }
```

### Refresh TTL
```
POST /booth/:boothId/active-session/refresh
Headers: Authorization: Bearer <token>
Response: { boothId, refreshed: true, ttlSeconds }
```

## Environment Variables

### Worker (Hotfolder Watcher)
```env
# Folder paths
HOTFOLDER_PATH=./hotfolder
ORPHAN_PATH=./hotfolder/orphan
INVALID_PATH=./hotfolder/invalid
PROCESSED_PATH=./hotfolder/processed

# Booth identification
BOOTH_ID=booth-1

# Timing
FILE_STABILITY_DELAY_MS=2000
ACTIVE_SESSION_TTL_SECONDS=1800

# Connections (sama dengan worker utama)
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=...
S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

## Menjalankan Hotfolder Watcher

```bash
# Install dependencies
cd apps/worker
pnpm install

# Jalankan watcher
pnpm hotfolder
```

## Flow Lengkap

1. **Operator** login ke aplikasi web
2. **Operator** input kode peserta → session terverifikasi
3. **Operator** klik **"Start Pro Capture"**
   - API: `POST /booth/booth-1/active-session`
   - Redis: `activeSession:booth-1` di-set dengan data peserta
4. **Kamera Pro** mengambil foto → save ke `/hotfolder/IMG_001.jpg`
5. **Watcher** mendeteksi file baru:
   - Cek ekstensi (jpg/png/webp) ✓
   - Tunggu file stabil (2 detik) ✓
   - Cek `activeSession:booth-1` di Redis ✓
   - Hitung SHA256 untuk idempotency ✓
   - Upload ke S3 ✓
   - Enqueue job ke BullMQ ✓
   - Refresh TTL active session ✓
   - Pindahkan file ke `/hotfolder/processed/` ✓
6. **UI Operator** menampilkan job baru di "Recent Jobs"
7. **Operator** klik **"Stop Capture"** saat selesai
   - API: `DELETE /booth/booth-1/active-session`

## Folder Structure

```
/hotfolder/
├── (incoming photos here)
├── orphan/       # Foto tanpa active session
├── invalid/      # File non-image atau error
└── processed/    # Foto yang sudah diproses
```

## Checklist Testing Manual

### 1. Setup
- [ ] Redis running (`redis-cli ping` → PONG)
- [ ] S3/MinIO accessible
- [ ] API server running (`pnpm --filter @photobot/api dev`)
- [ ] Worker running (`pnpm --filter @photobot/worker dev`)
- [ ] Hotfolder watcher running (`pnpm --filter @photobot/worker hotfolder`)
- [ ] Frontend running (`pnpm --filter @photobot/web dev`)

### 2. Flow Normal
- [ ] Tenant registrasi → dapat kode
- [ ] Operator login
- [ ] Operator input kode → session muncul
- [ ] Operator klik "Start Pro Capture"
- [ ] Cek Redis: `GET activeSession:booth-1` → ada data
- [ ] Copy file JPG ke `/hotfolder/`
- [ ] Cek log watcher: "Job enqueued from hotfolder"
- [ ] Cek file dipindah ke `/hotfolder/processed/`
- [ ] Cek UI: job muncul di "Recent Jobs"
- [ ] Operator klik "Stop Capture"
- [ ] Cek Redis: `GET activeSession:booth-1` → nil

### 3. Edge Cases
- [ ] File non-image (.txt) → pindah ke `/invalid/`
- [ ] File tanpa active session → pindah ke `/orphan/`
- [ ] File yang sama dimasukkan 2x → idempotency block (tidak double job)
- [ ] Session expired → file masuk ke `/orphan/`
- [ ] Large file (10MB+) → tetap diproses

### 4. Error Recovery
- [ ] Restart watcher → tidak ada duplicate processing
- [ ] Redis disconnect + reconnect → watcher tetap jalan
- [ ] S3 timeout → job gagal dengan error jelas

## Troubleshooting

### File tidak terdeteksi
- Pastikan `HOTFOLDER_PATH` benar
- Cek permission folder
- Cek log watcher untuk error

### Job tidak muncul di UI
- Cek apakah active session sudah di-set (`GET activeSession:booth-1`)
- Cek log watcher untuk error upload/enqueue
- Cek BullMQ dashboard (jika ada)

### Duplicate jobs
- Seharusnya tidak terjadi karena idempotency
- Cek Redis key `idemp:hotfolder:*`
- Pastikan file benar-benar berbeda (hash berbeda)
