# kie.ai integration notes (Google “Nano Banana” family)

Dokumen ini merangkum cara pakai endpoint `POST https://api.kie.ai/api/v1/jobs/createTask` untuk 3 model Google yang relevan, plus catatan integrasi untuk sistem Photobot (worker/queue + storage).

## Auth
- Semua request wajib header: `Authorization: Bearer <KIE_API_KEY>`
- Content-Type: `application/json`
- Simpan API key hanya di backend/worker (jangan di frontend).

## Konsep dasar flow
1. Worker/backend submit task ke `POST /api/v1/jobs/createTask`.
2. Response mengembalikan `data.taskId`.
3. Ambil hasil via endpoint “Get Task Details” (unified query) **atau** gunakan `callBackUrl` agar kie.ai melakukan POST ke endpoint kamu saat selesai.

Catatan:
- Untuk production, `callBackUrl` lebih disarankan daripada polling.
- Format “Get Task Details” tidak dicantumkan di snippet ini; ikuti dokumentasi: https://docs.kie.ai (cari “Get Task Details / get-task-detail”).

## Requirement image input (penting)
Semua parameter image di API ini berupa **URL** (bukan file upload langsung):
- `nano-banana-pro`: `input.image_input` = array URL gambar (max 8, max 30MB per image).
- `google/nano-banana-edit`: `input.image_urls` = array URL gambar (max 10, max 10MB per image).

Implikasi untuk Photobot:
- Input image harus tersedia via URL yang bisa diakses dari server kie.ai.
- Opsi paling simpel: simpan input di S3/R2/MinIO dan buat **signed URL** (TTL cukup panjang untuk proses, mis. 30–60 menit).

## Endpoint: createTask
`POST https://api.kie.ai/api/v1/jobs/createTask`

### 1) nano-banana-pro (image-to-image)
**Model**
- `model: "nano-banana-pro"`

**Request body**
```json
{
  "model": "nano-banana-pro",
  "callBackUrl": "https://your-domain.com/api/kie/callback",
  "input": {
    "prompt": "string (max 10000)",
    "image_input": ["https://..."],
    "aspect_ratio": "1:1",
    "resolution": "1K",
    "output_format": "png"
  }
}
```

**Enums**
- `aspect_ratio`: `1:1 | 2:3 | 3:2 | 3:4 | 4:3 | 4:5 | 5:4 | 9:16 | 16:9 | 21:9 | auto`
- `resolution`: `1K | 2K | 4K`
- `output_format`: `png | jpg`

### 2) google/nano-banana (text-to-image)
**Model**
- `model: "google/nano-banana"`

**Request body**
```json
{
  "model": "google/nano-banana",
  "callBackUrl": "https://your-domain.com/api/kie/callback",
  "input": {
    "prompt": "string (max 5000)",
    "output_format": "png",
    "image_size": "1:1"
  }
}
```

**Enums**
- `image_size`: `1:1 | 9:16 | 16:9 | 3:4 | 4:3 | 3:2 | 2:3 | 5:4 | 4:5 | 21:9 | auto`
- `output_format`: `png | jpeg`

### 3) google/nano-banana-edit (image editing)
**Model**
- `model: "google/nano-banana-edit"`

**Request body**
```json
{
  "model": "google/nano-banana-edit",
  "callBackUrl": "https://your-domain.com/api/kie/callback",
  "input": {
    "prompt": "string (max 5000)",
    "image_urls": ["https://..."],
    "output_format": "png",
    "image_size": "1:1"
  }
}
```

**Enums**
- `image_size`: sama seperti `google/nano-banana`
- `output_format`: `png | jpeg`

## Response sukses (createTask)
```json
{
  "code": 200,
  "msg": "success",
  "data": { "taskId": "task_..._123" }
}
```

## Error codes (API-level)
Kode yang disebut di OpenAPI response wrapper:
- `401` unauthorized (API key salah/invalid)
- `402` insufficient credits
- `422` validation error
- `429` rate limited
- `455` service unavailable/maintenance
- `500` server error
- `501` generation failed
- `505` feature disabled

Rekomendasi mapping untuk worker Photobot:
- `401/402/422/505`: **fatal** (jangan retry otomatis)
- `429/455/500`: **transient** (retry + backoff)
- `501`: biasanya **fatal** (boleh 1 retry jika dicurigai fluke, tapi default fatal)

## callBackUrl (recommended)
Kalau pakai callback:
- Siapkan endpoint backend mis. `POST /api/kie/callback` untuk menerima status + result URL.
- Pastikan endpoint callback:
  - tidak butuh auth operator,
  - **validasi** payload minimal (taskId ada),
  - punya mekanisme anti-abuse (mis. token acak di querystring callback URL, rate limit, allowlist IP jika memungkinkan).

Catatan: spesifikasi payload callback tidak ada di snippet; implementasi harus mengikuti docs kie.ai untuk “callback payload”.

## Contoh fetch (Node)
```js
await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.KIE_API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "nano-banana-pro",
    callBackUrl: "https://your-domain.com/api/kie/callback",
    input: {
      prompt: "Photobooth style: ...",
      image_input: ["https://signed-url-to-input"],
      aspect_ratio: "1:1",
      resolution: "1K",
      output_format: "png"
    }
  })
});
```

## Catatan integrasi untuk adapter Photobot (disarankan)
- Simpan relasi `jobId -> taskId` (di Redis) agar:
  - polling bisa update status,
  - callback bisa menemukan job yang tepat.
- Simpan parameter penting untuk reproducibility/debug:
  - `model`, `prompt`, `aspect_ratio/image_size`, `resolution`, `output_format`, input image URL/key.
- Timeout:
  - network timeout request createTask: 15–30s
  - total job timeout: sesuaikan workflow (mis. 3–5 menit untuk event)
- Download result:
  - hasil dari kie.ai biasanya URL → worker download → simpan ke storage booth → expose via signed URL.

