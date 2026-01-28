import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCcw, Camera, Zap, Upload, Search, CheckCircle2, X, Radio, FolderOpen, Clock } from 'lucide-react';
import { Button, Input, Card } from '../../components/ui';
import {
    getSession,
    createJob,
    setActiveSession,
    clearActiveSession,
    getActiveSession,
    getJobs,
    type SessionData,
    type ActiveSessionData,
    type JobListItem
} from '../../lib/api';

const STYLES = [
    { id: 'cyberpunk', name: 'Cyberpunk', prompt: 'A futuristic cyberpunk humanoid character...' },
    { id: 'royal-thai', name: 'Royal Thai', prompt: 'Photorealistic royal Southeast Asian portrait...' },
    { id: 'royal-thai-group', name: 'Royal Thai Group', prompt: 'Photorealistic royal Southeast Asian group portrait of 2 to 5 people...' },
];


export const CapturePage: React.FC = () => {
    const [code, setCode] = useState('');
    const [sessionData, setSessionData] = useState<SessionData | null>(null);
    const [style, setStyle] = useState(STYLES[0].id);
    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [cameraActive, setCameraActive] = useState(false);
    const [videoReady, setVideoReady] = useState(false);
    const [cameraError, setCameraError] = useState('');
    const [loadingSession, setLoadingSession] = useState(false);
    const [sessionError, setSessionError] = useState('');
    const [submitError, setSubmitError] = useState('');

    // Pro Camera Mode (Hot Folder) State
    const [proCameraActive, setProCameraActive] = useState(false);
    const [proCameraLoading, setProCameraLoading] = useState(false);
    const [proCameraError, setProCameraError] = useState('');
    const [, setActiveSessionState] = useState<ActiveSessionData | null>(null);
    const [recentJobs, setRecentJobs] = useState<JobListItem[]>([]);
    const BOOTH_ID = import.meta.env.VITE_BOOTH_ID || 'booth-1';

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const navigate = useNavigate();

    const attachStreamToVideo = useCallback(async (stream: MediaStream) => {
        // Wait until <video> is mounted (cameraActive toggles rendering)
        for (let i = 0; i < 30; i++) {
            const videoEl = videoRef.current;
            if (videoEl) {
                if (videoEl.srcObject !== stream) {
                    videoEl.srcObject = stream;
                }

                // Prefer "playing" as readiness signal (more reliable than loadedmetadata)
                videoEl.onplaying = () => setVideoReady(true);
                videoEl.onloadedmetadata = () => {
                    // Some browsers fire metadata but never start playback unless play() called
                    videoEl.play().catch(() => { });
                };
                videoEl.onloadeddata = () => setVideoReady(true);
                videoEl.oncanplay = () => setVideoReady(true);

                try {
                    await videoEl.play();
                } catch (err) {
                    // Autoplay can still fail; keep UI in "Starting…" and show actionable error
                    setCameraError(err instanceof Error ? err.message : 'Video play failed');
                }
                return;
            }
            await new Promise((r) => setTimeout(r, 16)); // ~1 frame
        }

        setCameraError('Video element not ready. Coba refresh halaman.');
    }, []);

    useEffect(() => {
        return () => stopCamera();
    }, []);

    const startCamera = async () => {
        try {
            setCameraError('');
            setVideoReady(false);

            // Stop any previous stream to avoid "camera in use" conflicts
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(t => t.stop());
                streamRef.current = null;
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: 1280, height: 720 }
            });
            streamRef.current = stream;
            setCameraActive(true);

            // Attach after <video> mounts
            await attachStreamToVideo(stream);

            // Fallback: if metadata never fires, still mark ready when video has dimensions
            setTimeout(() => {
                const v = videoRef.current;
                if (!v) return;
                if (!videoReady && v.videoWidth > 0 && v.videoHeight > 0) {
                    setVideoReady(true);
                }
            }, 1500);
        } catch (e) {
            console.error('Camera error:', e);
            setCameraError(e instanceof Error ? e.message : 'Failed to start camera');
            setCameraActive(false);
            setVideoReady(false);
        }
    };

    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
        setCameraActive(false);
        setVideoReady(false);
    };

    const capture = () => {
        if (videoRef.current && canvasRef.current) {
            if (!videoReady || videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0) {
                setCameraError('Kamera belum siap. Tunggu 1–2 detik lalu coba lagi.');
                return;
            }
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                canvasRef.current.width = videoRef.current.videoWidth;
                canvasRef.current.height = videoRef.current.videoHeight;
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.translate(canvasRef.current.width, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(videoRef.current, 0, 0);
                setCapturedImage(canvasRef.current.toDataURL('image/jpeg', 0.9));
                stopCamera();
            }
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
        if (fileInputRef.current) fileInputRef.current.value = '';
        setCameraError('');
        setVideoReady(false);
        startCamera();
    };

    const lookupSession = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (code.length < 6) return;

        setLoadingSession(true);
        setSessionError('');
        setSubmitError('');

        try {
            const session = await getSession(code.toUpperCase());
            setSessionData(session);
        } catch (err: any) {
            console.error('Lookup error:', err);
            setSessionError(err.response?.data?.error?.message || 'Kode tidak ditemukan');
        } finally {
            setLoadingSession(false);
        }
    };

    const submit = async () => {
        if (!capturedImage || !sessionData) return;
        setUploading(true);
        setSubmitError('');
        try {
            const blob = await (await fetch(capturedImage)).blob();
            const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' });

            const result = await createJob({
                sessionId: sessionData.sessionId,
                eventId: sessionData.eventId,
                mode: 'portrait',
                styleId: style,
                image: file,
            });

            navigate(`/jobs/${result.jobId}`);
        } catch (err: any) {
            console.error('Submit error:', err);
            const code = err.response?.data?.error?.code;
            if (code === 'SESSION_NOT_FOUND' || code === 'SESSION_EVENT_MISMATCH') {
                setSessionData(null);
                setCode('');
                setSessionError('Session expired atau tidak valid. Silakan lookup ulang.');
            } else {
                setSubmitError(err.response?.data?.error?.message || 'Gagal submit job. Coba lagi.');
            }
        } finally {
            setUploading(false);
        }
    };

    // Pro Camera Mode Functions
    const startProCameraCapture = useCallback(async () => {
        if (!sessionData) return;

        setProCameraLoading(true);
        setProCameraError('');

        try {
            const result = await setActiveSession(BOOTH_ID, {
                sessionId: sessionData.sessionId,
                eventId: sessionData.eventId,
                mode: 'portrait',
                styleId: style,
            });
            setActiveSessionState(result);
            setProCameraActive(true);

            // Start polling for recent jobs
            pollRecentJobs();
        } catch (err: any) {
            console.error('Start pro camera error:', err);
            setProCameraError(err.response?.data?.error?.message || 'Gagal memulai Pro Camera Mode');
        } finally {
            setProCameraLoading(false);
        }
    }, [sessionData, BOOTH_ID]);

    const stopProCameraCapture = useCallback(async () => {
        setProCameraLoading(true);

        try {
            await clearActiveSession(BOOTH_ID);
            setActiveSessionState(null);
            setProCameraActive(false);
            setRecentJobs([]);
        } catch (err: any) {
            console.error('Stop pro camera error:', err);
            // Still stop locally even if API fails
            setProCameraActive(false);
        } finally {
            setProCameraLoading(false);
        }
    }, [BOOTH_ID]);

    const pollRecentJobs = useCallback(async () => {
        if (!proCameraActive || !sessionData) return;

        try {
            const result = await getJobs({ eventId: sessionData.eventId, limit: 5 });
            setRecentJobs(result.jobs);
        } catch (err) {
            console.error('Poll jobs error:', err);
        }
    }, [proCameraActive, sessionData]);

    // Poll for recent jobs every 3 seconds when pro camera is active
    useEffect(() => {
        if (!proCameraActive) return;

        const interval = setInterval(pollRecentJobs, 3000);
        return () => clearInterval(interval);
    }, [proCameraActive, pollRecentJobs]);

    // Check for existing active session on mount
    useEffect(() => {
        const checkActiveSession = async () => {
            try {
                const existing = await getActiveSession(BOOTH_ID);
                if (existing) {
                    setActiveSessionState(existing);
                    setProCameraActive(true);
                    // Also set session data for display
                    setSessionData({
                        sessionId: existing.sessionId,
                        eventId: existing.eventId,
                        name: existing.name,
                        whatsapp: existing.whatsapp,
                    });
                    if (existing.styleId) {
                        setStyle(existing.styleId);
                    }
                    setCode(existing.code);
                }
            } catch {
                // No active session, that's fine
            }
        };
        checkActiveSession();
    }, [BOOTH_ID]);

    return (
        <div className="max-w-4xl mx-auto px-4 py-8 space-y-8 animate-in fade-in duration-700">
            <header className="flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-black text-white tracking-tight">BOOTH<span className="text-indigo-500">CAPTURE</span></h1>
                    <p className="text-zinc-500 font-medium">Operator Console — Phase 2 Flow</p>
                </div>
                <div className="flex gap-2">
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-green-500/10 rounded-full border border-green-500/20">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <span className="text-[10px] font-bold text-green-500 uppercase tracking-wider">Live System</span>
                    </div>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Left Column: Session & Styles */}
                <div className="lg:col-span-4 space-y-6">
                    <Card className="border-zinc-800 bg-zinc-900/50 backdrop-blur-xl">
                        <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-[0.2em] mb-4">1. Identify Session</h2>
                        {!sessionData ? (
                            <form onSubmit={lookupSession} className="space-y-4">
                                <Input
                                    placeholder="ENTER 6-DIGIT CODE"
                                    value={code}
                                    onChange={e => setCode(e.target.value.toUpperCase())}
                                    error={sessionError}
                                    icon={<Search size={18} className="text-zinc-500" />}
                                    maxLength={6}
                                    className="bg-zinc-800/80 font-mono text-xl tracking-[0.3em] uppercase py-4 text-center placeholder:tracking-normal placeholder:font-sans placeholder:text-sm"
                                />
                                <Button
                                    type="submit"
                                    isLoading={loadingSession}
                                    className="w-full py-6 rounded-xl bg-white text-black hover:bg-zinc-200"
                                    disabled={code.length !== 6 || loadingSession}
                                >
                                    Verify Code
                                </Button>
                            </form>
                        ) : (
                            <div className="animate-in zoom-in-95 duration-300">
                                <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 mb-4 relative group">
                                    <button
                                        onClick={() => { setSessionData(null); setCode(''); setSessionError(''); setSubmitError(''); }}
                                        className="absolute top-2 right-2 p-1 text-zinc-500 hover:text-white transition-colors"
                                    >
                                        <X size={16} />
                                    </button>
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-indigo-500 text-white rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
                                            <CheckCircle2 size={24} />
                                        </div>
                                        <div className="overflow-hidden">
                                            <div className="text-white font-bold truncate">{sessionData.name}</div>
                                            <div className="text-indigo-400 text-xs font-mono">{sessionData.whatsapp}</div>
                                            <div className="text-zinc-500 text-[10px] mt-1">Event: {sessionData.eventId}</div>
                                        </div>
                                    </div>
                                </div>
                                {submitError && (
                                    <div className="text-red-400 text-xs text-center mb-2">{submitError}</div>
                                )}
                                <div className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest text-center">Session Active</div>
                            </div>
                        )}
                    </Card>

                    <Card className="border-zinc-800 bg-zinc-900/50 backdrop-blur-xl">
                        <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-[0.2em] mb-4">2. Select AI Style</h2>
                        <div className="grid grid-cols-2 gap-3">
                            {STYLES.map(s => (
                                <button
                                    key={s.id}
                                    onClick={() => setStyle(s.id)}
                                    className={`p-4 rounded-2xl border-2 transition-all duration-300 flex flex-col items-center gap-2 group ${style === s.id
                                        ? 'border-indigo-500 bg-indigo-500/10 text-white shadow-[0_0_20px_rgba(99,102,241,0.2)]'
                                        : 'border-zinc-800 bg-zinc-800/20 text-zinc-500 hover:border-zinc-700'
                                        }`}
                                >
                                    <div className={`p-2 rounded-xl transition-colors ${style === s.id ? 'bg-indigo-500 text-white' : 'bg-zinc-800 text-zinc-500 group-hover:bg-zinc-700'}`}>
                                        <Zap size={18} />
                                    </div>
                                    <span className="text-xs font-bold uppercase tracking-wider">{s.name}</span>
                                </button>
                            ))}
                        </div>
                    </Card>

                    {/* Pro Camera Mode Card */}
                    {sessionData && (
                        <Card className="border-zinc-800 bg-zinc-900/50 backdrop-blur-xl">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-[0.2em]">
                                    <FolderOpen size={14} className="inline mr-2" />
                                    Pro Camera Mode
                                </h2>
                                {proCameraActive && (
                                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-orange-500/10 rounded-full border border-orange-500/20">
                                        <Radio size={10} className="text-orange-500 animate-pulse" />
                                        <span className="text-[9px] font-bold text-orange-500 uppercase">Live</span>
                                    </div>
                                )}
                            </div>

                            {proCameraError && (
                                <div className="text-red-400 text-xs mb-3 p-2 bg-red-500/10 rounded-lg">{proCameraError}</div>
                            )}

                            {!proCameraActive ? (
                                <div className="space-y-3">
                                    <p className="text-zinc-500 text-xs">
                                        Aktifkan mode ini untuk menerima foto dari kamera profesional (DSLR/Mirrorless) yang tersimpan ke folder lokal.
                                    </p>
                                    <Button
                                        onClick={startProCameraCapture}
                                        isLoading={proCameraLoading}
                                        className="w-full py-4 bg-orange-600 hover:bg-orange-500 text-white rounded-xl font-bold"
                                        disabled={!sessionData || proCameraLoading}
                                    >
                                        <Radio size={16} /> Start Pro Capture
                                    </Button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-xl">
                                        <div className="flex items-center gap-2 text-orange-400 text-xs font-medium mb-2">
                                            <Clock size={12} />
                                            Menunggu file dari kamera...
                                        </div>
                                        <p className="text-zinc-500 text-[10px]">
                                            Simpan foto ke folder <code className="bg-zinc-800 px-1 rounded">/hotfolder</code>
                                        </p>
                                    </div>

                                    {/* Recent Jobs from Hotfolder */}
                                    {recentJobs.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider">Recent Jobs</div>
                                            {recentJobs.slice(0, 3).map(job => (
                                                <div
                                                    key={job.jobId}
                                                    onClick={() => navigate(`/jobs/${job.jobId}`)}
                                                    className="p-2 bg-zinc-800/50 rounded-lg flex items-center justify-between cursor-pointer hover:bg-zinc-800 transition-colors"
                                                >
                                                    <div className="text-xs text-white truncate">{job.data?.participantName || 'Unknown'}</div>
                                                    <div className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${job.status === 'succeeded' ? 'bg-green-500/20 text-green-400' :
                                                        job.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                                                            'bg-yellow-500/20 text-yellow-400'
                                                        }`}>
                                                        {job.status}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <Button
                                        onClick={stopProCameraCapture}
                                        isLoading={proCameraLoading}
                                        variant="secondary"
                                        className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl"
                                    >
                                        <X size={16} /> Stop Capture
                                    </Button>
                                </div>
                            )}
                        </Card>
                    )}
                </div>

                {/* Right Column: Camera View */}
                <div className="lg:col-span-8 flex flex-col gap-6">
                    <Card className="p-0 border-zinc-800 bg-black overflow-hidden relative group">
                        <div className="absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-1 bg-black/50 backdrop-blur-md rounded-full border border-white/10">
                            <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                            <span className="text-[10px] font-bold text-white uppercase tracking-widest">Webcam Feed</span>
                        </div>

                        <div className="aspect-[16/9] relative bg-zinc-950 flex items-center justify-center">
                            {!cameraActive && !capturedImage ? (
                                <div className="flex flex-col items-center gap-6 p-8 text-center animate-in fade-in duration-500">
                                    <div className="w-20 h-20 bg-zinc-900 rounded-full flex items-center justify-center text-zinc-700 mb-2">
                                        <Camera size={40} />
                                    </div>
                                    <div>
                                        <h3 className="text-white font-bold text-xl mb-1">Ready to Capture?</h3>
                                        <p className="text-zinc-500 text-sm max-w-xs mx-auto">Click below to start the camera or upload a photo from device</p>
                                    </div>
                                    <div className="flex gap-4">
                                        <Button onClick={startCamera} className="bg-white text-black py-4 px-8 rounded-2xl font-bold flex gap-2">
                                            <Camera size={20} /> Start Camera
                                        </Button>
                                        <Button variant="secondary" onClick={() => fileInputRef.current?.click()} className="bg-zinc-800/80 py-4 px-8 rounded-2xl flex gap-2">
                                            <Upload size={20} /> Upload
                                        </Button>
                                    </div>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        onChange={handleFileUpload}
                                        className="hidden"
                                    />
                                </div>
                            ) : capturedImage ? (
                                <img src={capturedImage} className="w-full h-full object-cover animate-in zoom-in duration-500" alt="Captured" />
                            ) : (
                                <video
                                    ref={videoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    className="w-full h-full object-cover mirror-x"
                                    style={{ transform: 'scaleX(-1)' }}
                                />
                            )}

                            <canvas ref={canvasRef} className="hidden" />
                        </div>

                        {/* Camera Controls Overlay */}
                        {(cameraActive || capturedImage) && (
                            <div className="p-6 bg-zinc-900/90 backdrop-blur-xl border-t border-zinc-800 flex items-center justify-between">
                                <div className="flex gap-4 flex-1">
                                    {cameraActive && !capturedImage && (
                                        <Button onClick={capture} className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black text-lg tracking-wider flex gap-3 shadow-[0_0_30px_rgba(79,70,229,0.3)]">
                                            <Camera size={24} /> CAPTURE
                                        </Button>
                                    )}

                                    {capturedImage && (
                                        <>
                                            <Button variant="secondary" onClick={retake} className="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-2xl font-bold flex gap-2">
                                                <RefreshCcw size={20} /> Retake Photo
                                            </Button>
                                            <Button
                                                onClick={submit}
                                                isLoading={uploading}
                                                className={`flex-1 py-4 rounded-2xl font-black text-lg tracking-wider flex gap-3 shadow-lg ${!sessionData ? 'bg-zinc-700 cursor-not-allowed' : 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500'}`}
                                                disabled={!sessionData || uploading}
                                            >
                                                <Zap size={24} /> {uploading ? 'UPLOADING...' : 'GENERATE AI'}
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}
                    </Card>

                    {(cameraError || (!videoReady && cameraActive && !capturedImage)) && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-300 text-sm">
                            {cameraError || 'Starting camera… (kalau >5 detik, coba refresh & pastikan tidak ada app lain pakai kamera)'}
                        </div>
                    )}

                    {!sessionData && (
                        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-3 text-amber-500">
                            <div className="w-10 h-10 bg-amber-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                                <Search size={20} />
                            </div>
                            <p className="text-sm font-medium">Please verify a session code before generating the AI effect.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
