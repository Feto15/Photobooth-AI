# kie.ai integration notes (Unified Documentation)

Dokumen ini merangkum cara pakai berbagai model Kie.ai (Image, Video, Avatar, Music) untuk sistem Photobot.

## Auth
- Base URL: `https://api.kie.ai`
- Header wajib: `Authorization: Bearer <KIE_API_KEY>`
- Content-Type: `application/json`

## Model & Endpoint List

### 1. Image Generation (Nano Banana Family)
**Endpoint:** `POST /api/v1/jobs/createTask`
- `nano-banana-pro`: Professional image-to-image (Proses utama Photobot).
- `google/nano-banana`: Dasar text-to-image.
- `google/nano-banana-edit`: Image editing / inpaint.

### 2. Video & Animation (Sora-2 & Grok)
**Endpoint:** `POST /api/v1/jobs/createTask`
- `sora-2-pro-text-to-video` / `image-to-video`.
- `grok-imagine/text-to-video` / `image-to-video`.
- `kling-2.6/motion-control`: Dance/motion transfer.
- `wan/2-2-animate-move`: Animate static image.

### 3. Music Generation (Suno)
**Endpoint:** `POST /api/v1/generate` (Berbeda!)
- Model: `V5`, `V4_5PLUS`, `V4`.
- Perlu `customMode: true/false`.

---

## Konsep Callback & Status

Kie.ai menggunakan sistem asinkron. Kamu mengirim tugas, lalu menunggu hasilnya.

### Callback Payload (Menerima Hasil Otomatis)
Berdasarkan investigasi, Kie.ai mengirimkan struktur data yang bervariasi tergantung modelnya:

**Format A (Umum / Image):**
```json
{
  "taskId": "...",
  "status": "completed",
  "output": {
    "image_urls": ["https://..."]
  }
}
```

**Format B (Music / Suno):**
```json
{
  "code": 200,
  "data": {
    "callbackType": "complete",
    "task_id": "...",
    "data": [
      { "audio_url": "https://...", "image_url": "https://..." }
    ]
  }
}
```

**Format C (Video / Sora / Grok via recordInfo style):**
```json
{
  "code": 200,
  "data": {
    "taskId": "...",
    "state": "success",
    "resultJson": "{\"resultUrls\":[\"https://...\"]}"
  }
}
```

### Polling Status (Manual)
Jika callback gagal, gunakan:
`GET /api/v1/jobs/recordInfo?taskId={taskId}`

---

## Logika Handler untuk Photobot (Rekomendasi)

Agar sistem Photobot stabil menerima semua jenis model, handler callback di `/api/kie/callback` harus:

1.  **Ekstrak Task ID:** Cek `body.taskId`, `body.task_id`, `body.id`, `body.data.taskId`, atau `body.data.task_id`.
2.  **Ekstrak Status:** Cek `body.status`, `body.data.state`, `body.data.callbackType`. 
    - Sukses jika: `completed`, `success`, `complete`.
3.  **Ekstrak URL Hasil:**
    - Cek `body.output.image_urls`
    - Cek `body.data.image_urls`
    - Parse `body.data.resultJson` -> `resultUrls`
    - Cek `body.data.data[0].audio_url` atau `image_url`
4.  **Publikasi ke Worker:** Kirim hasil ke Redis channel `kie:callback`.

## Penting: Input Requirement
- Input gambar harus berupa **URL Public**.
- Gunakan **Signed URL** S3/R2 dengan TTL 3600 (1 jam).
- **Ngrok Warning:** Jika menggunakan ngrok gratis, Kie.ai mungkin terhalang "Browser Warning". Gunakan `localtunnel` atau `cloudflared` untuk dev.
