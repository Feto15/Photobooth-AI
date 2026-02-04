import sharp from 'sharp';
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
 * Menggabungkan foto dengan frame overlay.
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
        // Ambil metadata frame untuk menentukan ukuran output
        const frameBuffer = await fs.readFile(framePath);
        const frameMetadata = await sharp(frameBuffer).metadata();

        const outputWidth = options.outputWidth || frameMetadata.width || 1080;
        const outputHeight = options.outputHeight || frameMetadata.height || 1080;

        // Hitung ukuran dan posisi foto di dalam frame
        // Sekarang diubah ke 100% agar memenuhi seluruh area frame
        const photoWidth = options.photoSize?.width || outputWidth;
        const photoHeight = options.photoSize?.height || outputHeight;
        const photoTop = options.photoPosition?.top ?? 0;
        const photoLeft = options.photoPosition?.left ?? 0;

        // Proses foto: resize agar pas dengan area frame
        const resizedPhoto = await sharp(photoBuffer)
            .resize(photoWidth, photoHeight, {
                fit: 'cover',
                position: 'center',
            })
            .toBuffer();

        // Gabungkan: foto di bawah, frame di atas (overlay)
        const framedPhoto = await sharp({
            create: {
                width: outputWidth,
                height: outputHeight,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            },
        })
            .composite([
                // Layer 1: Foto (di bawah)
                {
                    input: resizedPhoto,
                    top: photoTop,
                    left: photoLeft,
                },
                // Layer 2: Frame (di atas, overlay)
                {
                    input: frameBuffer,
                    top: 0,
                    left: 0,
                },
            ])
            .png()
            .toBuffer();

        logger.info({
            frameFilename,
            outputSize: `${outputWidth}x${outputHeight}`,
            photoSize: `${photoWidth}x${photoHeight}`,
        }, 'Frame applied successfully');

        return framedPhoto;
    } catch (error: any) {
        logger.error({ error: error.message, framePath }, 'Failed to apply frame');
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
