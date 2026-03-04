# Demo LP + QR + Email (Cloudflare Pages + Workers + D1 + Apps Script)

Tujuan demo (tanpa ubah flow utama):
- Peserta isi form
- Submit -> dapat barcode/QR via email
- QR buka landing page peserta berisi itinerary
- QR dipakai registrasi photobooth, hasil dikirim ke email sesuai QR

## Struktur folder (demo)
- `demo-lp/` (ini folder dokumen/demo)
- Cloudflare Pages untuk LP (static)
- Cloudflare Workers untuk API
- D1 sebagai database
- Google Apps Script untuk kirim email

## Flow ringkas (demo)
1. Peserta submit form -> `POST /api/register`
2. Worker:
   - generate `code`
   - simpan data ke D1
   - generate URL QR: `https://<pages-domain>/p/<code>`
   - call Apps Script untuk kirim email berisi QR + link
3. Peserta buka QR:
   - LP fetch data `GET /api/participant/<code>`
   - render itinerary & info peserta

## LP (Pages)
- Halaman utama peserta: `/p/<code>`
- Halaman itinerary khusus peserta: `/p/<code>/itinerary`
  - Bisa menampilkan detail jadwal yang lebih lengkap
  - Link dari email langsung ke halaman itinerary

## Endpoint (Worker)
- `POST /api/register`
  - input: `{ name, email, phone, eventId }`
  - output: `{ code, qrUrl }`
- `GET /api/participant/:code`
  - output: `{ name, email, phone, itinerary, eventInfo }`

## Data minimal di D1
Table `participants`:
- `id` (uuid)
- `code` (unique)
- `name`
- `email`
- `phone`
- `event_id`
- `itinerary_json`
- `created_at`

## Apps Script (email)
Worker call Apps Script:
- method: `POST`
- body: `{ to, name, qrUrl, landingUrl, itineraryUrl }`
- Apps Script kirim email Gmail (akun kamu)

## Isi email (demo)
- Nama peserta
- QR image (atau link QR)
- Link landing page peserta
- Link itinerary peserta
- Kode peserta (cadangan kalau QR gagal)

## Next step yang bisa aku buat
1. Struktur folder + dummy LP page
2. Worker template endpoint register + participant
3. D1 schema
4. Apps Script contoh kirim email
