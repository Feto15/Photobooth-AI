#!/bin/bash

# Pindah ke directory project
cd "$(dirname "$0")"

echo "========================================"
echo "    MEMULAI SISTEM PHOTOBOOT AI"
echo "========================================"

# Cek apakah pnpm ada
if ! command -v pnpm &> /dev/null
then
    echo "Error: pnpm tidak ditemukan. Pastikan sudah install pnpm."
    exit
fi

# Jalankan API dan Worker Utama di background
echo "[1/3] Menjalankan Server & AI Worker..."
pnpm dev > /dev/null 2>&1 &

# Tunggu sebentar agar server siap
sleep 5

# Jalankan Hotfolder Watcher di jendela ini agar operator bisa lihat log foto masuk
echo "[2/3] Menjalankan Penjaga Kamera DSLR (Hotfolder)..."
echo "      Folder: $(pwd)/apps/worker/hotfolder"
echo "----------------------------------------"

# Buka browser otomatis ke halaman operator
echo "[3/3] Membuka Browser..."
open "http://localhost:5173"

# Jalankan hotfolder (ini akan tetap terbuka di terminal agar log terlihat)
pnpm --filter @photobot/worker hotfolder
