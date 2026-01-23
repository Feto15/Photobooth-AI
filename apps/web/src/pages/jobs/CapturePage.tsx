import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCcw, Camera, User, Zap, Upload } from 'lucide-react';
import { Button, Input, Card } from '../../components/ui';
import api from '../../services/api';

const STYLES = [
    { id: 'cyber', name: 'Cyber' },
    { id: 'noir', name: 'Noir' },
    { id: 'prism', name: 'Prism' },
    { id: 'clay', name: 'Clay' },
];

export const CapturePage: React.FC = () => {
    const [name, setName] = useState('');
    const [style, setStyle] = useState(STYLES[0].id);
    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [cameraActive, setCameraActive] = useState(false);

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const navigate = useNavigate();

    useEffect(() => {
        return () => stopCamera();
    }, []);

    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: 1280, height: 720 }
            });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                setCameraActive(true);
            }
        } catch (e) {
            console.error('Camera error:', e);
        }
    };

    const stopCamera = () => {
        const stream = videoRef.current?.srcObject as MediaStream;
        stream?.getTracks().forEach(t => t.stop());
        setCameraActive(false);
    };

    const capture = () => {
        if (videoRef.current && canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            canvasRef.current.width = videoRef.current.videoWidth;
            canvasRef.current.height = videoRef.current.videoHeight;
            ctx?.drawImage(videoRef.current, 0, 0);
            setCapturedImage(canvasRef.current.toDataURL('image/jpeg'));
            stopCamera();
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                setCapturedImage(event.target?.result as string);
                stopCamera();
            };
            reader.readAsDataURL(file);
        }
    };

    const retake = () => {
        setCapturedImage(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const submit = async () => {
        if (!capturedImage) return;
        setUploading(true);
        try {
            const blob = await (await fetch(capturedImage)).blob();
            const fd = new FormData();
            fd.append('image', blob, 'capture.jpg');
            fd.append('eventId', 'live-event');
            fd.append('participantName', name || 'Guest');
            fd.append('mode', 'portrait');
            fd.append('styleId', style);

            const res = await api.post('/jobs', fd);
            navigate(`/jobs/${res.data.data.jobId}`);
        } catch (e) {
            console.error('Submit error:', e);
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-white">Capture Photo</h1>
                <p className="text-zinc-500 text-sm">Ambil foto dan pilih style AI</p>
            </div>

            <Card className="space-y-4">
                <Input
                    label="Nama Peserta"
                    placeholder="Masukkan nama (opsional)"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    icon={<User size={18} />}
                />

                <div className="space-y-2">
                    <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider ml-1">
                        Style
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                        {STYLES.map(s => (
                            <button
                                key={s.id}
                                onClick={() => setStyle(s.id)}
                                className={`p-3 rounded-xl border text-sm font-medium transition-colors ${
                                    style === s.id
                                        ? 'border-white bg-white/10 text-white'
                                        : 'border-white/10 text-zinc-400 hover:border-white/20'
                                }`}
                            >
                                <Zap size={16} className="mx-auto mb-1" />
                                {s.name}
                            </button>
                        ))}
                    </div>
                </div>
            </Card>

            <Card>
                <div className="aspect-video bg-black rounded-xl overflow-hidden relative min-h-[300px]">
                    {!cameraActive && !capturedImage ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                            <Button onClick={startCamera}>
                                <Camera size={18} /> Mulai Kamera
                            </Button>
                            <span className="text-zinc-500 text-sm">atau</span>
                            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                                <Upload size={18} /> Upload Foto
                            </Button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                onChange={handleFileUpload}
                                style={{ display: 'none' }}
                            />
                        </div>
                    ) : capturedImage ? (
                        <img src={capturedImage} className="absolute inset-0 w-full h-full object-cover" alt="Captured" />
                    ) : (
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
                        />
                    )}
                    <canvas ref={canvasRef} style={{ display: 'none' }} />
                </div>

                <div className="flex gap-3 mt-4">
                    {!capturedImage && cameraActive && (
                        <Button onClick={capture} className="flex-1">
                            <Camera size={18} /> Capture
                        </Button>
                    )}

                    {capturedImage && (
                        <>
                            <Button variant="secondary" onClick={retake} className="flex-1">
                                <RefreshCcw size={18} /> Retake
                            </Button>
                            <Button onClick={submit} isLoading={uploading} className="flex-1">
                                Submit Job
                            </Button>
                        </>
                    )}
                </div>
            </Card>
        </div>
    );
};
