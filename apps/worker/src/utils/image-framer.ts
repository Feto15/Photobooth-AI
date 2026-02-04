import Jimp from 'jimp';
import path from 'path';
import fs from 'fs/promises';
import pino from 'pino';

const logger = pino({
    transport: {
        target: 'pino-pretty',
        options: { colorize: true },
    },
});

// Path ke folder frame assets
const FRAMES_DIR = path.resolve(__dirname, '../../assets/frames');

// Default frame filename (bisa diganti sesuai event)
const DEFAULT_FRAME = 'default-frame.png';

export interface FrameOptions {
    frameId?: string;        // Nama file frame (tanpa path)
    outputWidth?: number;    // Lebar output final (default: ukuran frame)
    outputHeight?: number;   // Tinggi output final (default: ukuran frame)
    photoPosition?: {        // Posisi foto di dalam frame (default: center)
        top?: number;
        left?: number;
    };
    photoSize?: {            // Ukuran foto di dalam frame
        width?: number;
        height?: number;
    };
}

/**
 * Menggabungkan foto dengan frame overlay menggunakan Jimp (Pure JS).
 * Frame harus berformat PNG dengan area transparan di tengah untuk foto.
 * 
 * @param photoBuffer - Buffer foto hasil AI
 * @param options - Opsi framing (opsional)
 * @returns Buffer foto yang sudah diberi frame
 */
export async function applyFrame(
    photoBuffer: Buffer,
    options: FrameOptions = {}
): Promise<Buffer> {
    const frameFilename = options.frameId || DEFAULT_FRAME;
    const framePath = path.join(FRAMES_DIR, frameFilename);

    // Cek apakah file frame ada
    try {
        await fs.access(framePath);
    } catch {
        logger.warn({ framePath }, 'Frame file not found, returning original photo');
        return photoBuffer;
    }

    try {
        // Load foto dan frame memakai Jimp
        const [photo, frame] = await Promise.all([
            Jimp.read(photoBuffer),
            Jimp.read(framePath)
        ]);

        const outputWidth = options.outputWidth || frame.getWidth() || 1080;
        const outputHeight = options.outputHeight || frame.getHeight() || 1080;

        // Hitung ukuran dan posisi foto di dalam frame
        const photoWidth = options.photoSize?.width || outputWidth;
        const photoHeight = options.photoSize?.height || outputHeight;
        const photoTop = options.photoPosition?.top ?? 0;
        const photoLeft = options.photoPosition?.left ?? 0;

        // Proses foto: resize agar pas dengan area frame
        photo.cover(photoWidth, photoHeight, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE);

        // Siapkan kanvas kosong (background) jika ukurannya berbeda dengan frame
        // Tapi biasanya kita langsung pakai frame-nya saja sebagai layer utama

        // Buat gambar baru seukuran frame yang diinginkan
        const background = new Jimp(outputWidth, outputHeight, 0x00000000); // Transparent background

        // Susun: Background -> Foto -> Frame
        background
            .composite(photo, photoLeft, photoTop)
            .composite(frame, 0, 0);

        logger.info({
            frameFilename,
            outputSize: `${outputWidth}x${outputHeight}`,
            photoSize: `${photoWidth}x${photoHeight}`,
        }, 'Frame applied successfully (using Jimp)');

        // Kembalikan dalam format PNG
        return await background.getBufferAsync(Jimp.MIME_PNG);
    } catch (error: any) {
        logger.error({ error: error.message, framePath }, 'Failed to apply frame with Jimp');
        // Jika gagal, kembalikan foto asli tanpa frame
        return photoBuffer;
    }
}

/**
 * Cek apakah ada frame yang tersedia
 */
export async function hasDefaultFrame(): Promise<boolean> {
    const framePath = path.join(FRAMES_DIR, DEFAULT_FRAME);
    try {
        await fs.access(framePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Daftar frame yang tersedia
 */
export async function listAvailableFrames(): Promise<string[]> {
    try {
        const files = await fs.readdir(FRAMES_DIR);
        return files.filter(f => f.endsWith('.png'));
    } catch {
        return [];
    }
}
