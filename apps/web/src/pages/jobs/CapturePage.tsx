import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCcw, Camera, Zap, Upload, Search, CheckCircle2, X, Radio, FolderOpen, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Input, Card } from '../../components/ui';
import {
    getSession,
    createJob,
    setActiveSession,
    clearActiveSession,
    getActiveSession,
    getJobs,
    getSessionList,
    type SessionData,
    type ActiveSessionData,
    type JobListItem,
    type SessionListItem
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
    const [_cameraError, setCameraError] = useState('');
    const [loadingSession, setLoadingSession] = useState(false);
    const [sessionError, setSessionError] = useState('');
    const [submitError, setSubmitError] = useState('');

    // Pro Camera Mode (Hot Folder) State
    const [proCameraActive, setProCameraActive] = useState(false);
    const [proCameraLoading, setProCameraLoading] = useState(false);
    const [_proCameraError, setProCameraError] = useState('');
    const [, setActiveSessionState] = useState<ActiveSessionData | null>(null);
    const [_recentJobs, setRecentJobs] = useState<JobListItem[]>([]);
    const BOOTH_ID = import.meta.env.VITE_BOOTH_ID || 'booth-1';
    const EVENT_ID = import.meta.env.VITE_EVENT_ID || 'default-event';

    // Track last job count for toast notification
    const lastJobCountRef = useRef<number>(0);
    const lastActiveNameRef = useRef<string | null>(null);

    // Stoper: Pending Participants State
    const [pendingParticipants, setPendingParticipants] = useState<SessionListItem[]>([]);
    const [loadingParticipants, setLoadingParticipants] = useState(false);
    const [activatingSessionId, setActivatingSessionId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'active' | 'ready' | 'done'>('active');

    // Capture Mode State (webcam or dslr)
    const [captureMode, setCaptureMode] = useState<'webcam' | 'dslr'>('webcam');

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
            const errorCode = err.response?.data?.error?.code;
            const errorDetails = err.response?.data?.error?.details;

            if (errorCode === 'BOOTH_BUSY') {
                const activeName = errorDetails?.activeName || 'peserta lain';
                setProCameraError(`Booth sedang digunakan oleh "${activeName}". Clear session aktif terlebih dahulu.`);
            } else {
                setProCameraError(err.response?.data?.error?.message || 'Gagal memulai Pro Camera Mode');
            }
        } finally {
            setProCameraLoading(false);
        }
    }, [sessionData, BOOTH_ID, style]);

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

    // Handle mode switching
    const handleModeSwitch = useCallback((newMode: 'webcam' | 'dslr') => {
        if (newMode === captureMode) return;

        // Stop webcam if switching to DSLR
        if (newMode === 'dslr' && cameraActive) {
            stopCamera();
        }

        // Stop Pro Camera if switching to webcam
        if (newMode === 'webcam' && proCameraActive) {
            stopProCameraCapture();
        }

        setCaptureMode(newMode);
    }, [captureMode, cameraActive, proCameraActive]);

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

    // Unified check for active session (Redis Sync)
    const syncActiveSession = useCallback(async () => {
        try {
            const existing = await getActiveSession(BOOTH_ID);
            if (existing) {
                setActiveSessionState(existing);
                // Sync sessionData if it's different or null
                if (!sessionData || sessionData.sessionId !== existing.sessionId) {
                    setSessionData({
                        sessionId: existing.sessionId,
                        eventId: existing.eventId,
                        name: existing.name,
                        whatsapp: existing.whatsapp,
                    });
                    if (existing.styleId) setStyle(existing.styleId);
                    setCode(existing.code);
                }
            } else {
                // If Redis is empty but we have local sessionData, clear it (silent sync)
                if (sessionData && !proCameraLoading && !uploading) {
                    setActiveSessionState(null);
                    setSessionData(null);
                    setProCameraActive(false);
                }
            }
        } catch (err) {
            console.error('Sync active session error:', err);
        }
    }, [BOOTH_ID, sessionData, proCameraLoading, uploading]);

    // Manual Force Clear Booth
    const handleForceClear = async () => {
        if (!window.confirm('Ingin mengosongkan booth secara paksa? Sesi aktif akan dihapus.')) return;

        setProCameraLoading(true);
        try {
            await clearActiveSession(BOOTH_ID);
            setSessionData(null);
            setActiveSessionState(null);
            setProCameraActive(false);
            setSessionError('');
        } catch (err: any) {
            console.error('Clear booth error:', err);
            const msg = err.response?.data?.error?.message || 'Gagal mengosongkan booth. Cek koneksi server.';
            alert(msg);
        } finally {
            setProCameraLoading(false);
        }
    };

    // Stoper: Fetch pending participants
    const fetchPendingParticipants = useCallback(async (search?: string, status?: string) => {
        setLoadingParticipants(true);
        try {
            const result = await getSessionList(EVENT_ID, status || 'active', search);
            setPendingParticipants(result.sessions);
        } catch (err) {
            console.error('Fetch participants error:', err);
        } finally {
            setLoadingParticipants(false);
        }
    }, [EVENT_ID]);

    // Combined Polling Effect: Participants List & Active Session & Job Check
    useEffect(() => {
        const poll = async () => {
            await fetchPendingParticipants(searchQuery, statusFilter);
            await syncActiveSession();

            // Check for new jobs (DSLR mode only)
            if (captureMode === 'dslr' && proCameraActive) {
                try {
                    const jobsResult = await getJobs({ eventId: EVENT_ID, limit: 5 });
                    const currentJobCount = jobsResult.pagination.total;

                    // If job count increased and we had an active participant
                    if (currentJobCount > lastJobCountRef.current && lastActiveNameRef.current) {
                        toast.success(`📸 Photo Captured!`, {
                            description: `Processing AI transformation for ${lastActiveNameRef.current}...`,
                            duration: 5000,
                        });
                        lastActiveNameRef.current = null; // Reset so we don't toast again
                    }
                    lastJobCountRef.current = currentJobCount;
                } catch (e) {
                    // Ignore errors in job polling
                }
            }
        };

        poll();
        const interval = setInterval(poll, 3000); // Poll every 3 seconds for faster feedback
        return () => clearInterval(interval);
    }, [fetchPendingParticipants, syncActiveSession, searchQuery, statusFilter, captureMode, proCameraActive, EVENT_ID]);

    // Handle search with debounce
    const handleSearchChange = useCallback((value: string) => {
        setSearchQuery(value);
    }, []);

    // Stoper: Set participant as active session
    const activateParticipant = useCallback(async (participant: SessionListItem) => {
        setActivatingSessionId(participant.sessionId);
        setSessionError('');
        try {
            const result = await setActiveSession(BOOTH_ID, {
                sessionId: participant.sessionId,
                eventId: EVENT_ID,
                code: participant.code,
                mode: 'portrait',
                styleId: style,
            });
            setActiveSessionState(result);
            setSessionData({
                sessionId: participant.sessionId,
                eventId: EVENT_ID,
                name: participant.name,
                whatsapp: participant.whatsapp,
            });
            setCode(participant.code);
            setSubmitError('');

            // Track active participant name for toast notification
            lastActiveNameRef.current = participant.name;
        } catch (err: any) {
            console.error('Activate participant error:', err);
            const errorCode = err.response?.data?.error?.code;
            const errorDetails = err.response?.data?.error?.details;

            if (errorCode === 'BOOTH_BUSY') {
                const activeName = errorDetails?.activeName || 'peserta lain';
                setSessionError(`Booth sedang digunakan oleh "${activeName}". Selesaikan atau clear session aktif terlebih dahulu.`);
            } else {
                setSessionError(err.response?.data?.error?.message || 'Gagal mengaktifkan peserta');
            }
        } finally {
            setActivatingSessionId(null);
        }
    }, [BOOTH_ID, EVENT_ID, style]);

    // Helper: mask whatsapp number
    const maskWhatsapp = (wa: string) => {
        if (wa.length <= 6) return wa;
        return wa.slice(0, 4) + '***' + wa.slice(-3);
    };

    // Helper: format relative time
    const formatRelativeTime = (dateStr: string) => {
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'baru saja';
        if (mins < 60) return `${mins} menit lalu`;
        const hours = Math.floor(mins / 60);
        return `${hours} jam lalu`;
    };

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
                {/* Top Section: Operator Controls & Camera */}
                <div className="lg:col-span-4 space-y-6">
                    <Card className="border-zinc-800 bg-zinc-900/50 backdrop-blur-xl">
                        <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-[0.2em] mb-4">1. Select AI Style</h2>
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

                </div>

                {/* Right Column: Camera View (Main Focus) */}
                <div className="lg:col-span-8 flex flex-col gap-6">
                    <Card className="p-0 border-zinc-800 bg-black overflow-hidden relative">

                        {/* Mode Indicator */}
                        <div className="absolute top-4 right-4 z-20 flex items-center gap-2 px-3 py-1 bg-black/50 backdrop-blur-md rounded-full border border-white/10">
                            <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${captureMode === 'webcam' ? 'bg-red-500' : 'bg-orange-500'}`} />
                            <span className="text-[10px] font-bold text-white uppercase tracking-widest">
                                {captureMode === 'webcam' ? 'Webcam Feed' : 'DSLR Monitor'}
                            </span>
                        </div>

                        <div className="aspect-[16/9] relative bg-zinc-950 flex flex-col items-center justify-center">
                            {captureMode === 'webcam' ? (
                                // WEBCAM MODE
                                <>
                                    {!cameraActive && !capturedImage ? (
                                        <div className="flex flex-col items-center gap-6 p-8 text-center animate-in fade-in duration-500">
                                            <div className="w-20 h-20 bg-zinc-900 rounded-full flex items-center justify-center text-zinc-700 mb-2">
                                                <Camera size={40} />
                                            </div>
                                            <div>
                                                <h3 className="text-white font-bold text-xl mb-1">Ready to Capture?</h3>
                                                <p className="text-zinc-500 text-sm max-w-xs mx-auto">Click below to start webcam or upload file</p>
                                            </div>
                                            <div className="flex gap-4">
                                                <Button onClick={startCamera} className="bg-white text-black py-4 px-8 rounded-2xl font-bold flex gap-2">
                                                    <Camera size={20} /> Start Webcam
                                                </Button>
                                                <Button variant="secondary" onClick={() => fileInputRef.current?.click()} className="bg-zinc-800/80 py-4 px-8 rounded-2xl flex gap-2">
                                                    <Upload size={20} /> Upload
                                                </Button>
                                            </div>
                                            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileUpload} className="hidden" />
                                        </div>
                                    ) : (
                                        capturedImage ? (
                                            <img src={capturedImage} className="w-full h-full object-cover animate-in zoom-in duration-500" alt="Captured" />
                                        ) : (
                                            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover mirror-x" style={{ transform: 'scaleX(-1)' }} />
                                        )
                                    )}
                                </>
                            ) : (
                                // DSLR MODE
                                <div className="flex flex-col items-center gap-6 p-8 text-center w-full animate-in fade-in duration-500">
                                    {!proCameraActive ? (
                                        <>
                                            <div className="w-24 h-24 bg-zinc-900 rounded-2xl flex items-center justify-center text-zinc-700">
                                                <FolderOpen size={48} />
                                            </div>
                                            <div>
                                                <h3 className="text-white font-bold text-xl mb-2">Professional Mode</h3>
                                                <p className="text-zinc-500 text-sm max-w-md mx-auto mb-1">
                                                    Connect your DSLR/Mirrorless camera and save photos to the hotfolder.
                                                </p>
                                                <p className="text-zinc-600 text-xs">
                                                    Click below to start monitoring for incoming files.
                                                </p>
                                            </div>
                                            <Button
                                                onClick={startProCameraCapture}
                                                isLoading={proCameraLoading}
                                                className="bg-orange-600 hover:bg-orange-500 text-white py-5 px-10 rounded-2xl font-black text-lg flex gap-3 shadow-[0_0_30px_rgba(249,115,22,0.2)]"
                                                disabled={!sessionData || proCameraLoading}
                                            >
                                                <Radio size={24} /> Start Pro Capture
                                            </Button>
                                            {!sessionData && (
                                                <p className="text-amber-500 text-xs bg-amber-500/10 px-4 py-2 rounded-lg border border-amber-500/20">
                                                    Please verify a session first
                                                </p>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <div className="w-full max-w-md">
                                                <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl p-6 mb-6">
                                                    <div className="flex items-center justify-center gap-3 mb-4">
                                                        <Radio size={24} className="text-orange-500 animate-pulse" />
                                                        <h4 className="text-orange-400 font-black text-lg uppercase tracking-wider">MONITORING ACTIVE</h4>
                                                    </div>
                                                    <p className="text-zinc-400 text-sm text-center mb-2">
                                                        Waiting for photo files from camera...
                                                    </p>
                                                    <p className="text-zinc-600 text-xs text-center">
                                                        Save to: <code className="bg-zinc-900 px-2 py-0.5 rounded font-mono text-orange-400">/hotfolder</code>
                                                    </p>
                                                </div>
                                                <Button
                                                    onClick={stopProCameraCapture}
                                                    isLoading={proCameraLoading}
                                                    variant="secondary"
                                                    className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-2xl font-bold"
                                                >
                                                    <X size={20} /> Stop Monitoring
                                                </Button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                            <canvas ref={canvasRef} className="hidden" />
                        </div>

                        {/* Camera Controls Overlay (Webcam Mode Only) */}
                        {captureMode === 'webcam' && (cameraActive || capturedImage) && (
                            <div className="p-6 bg-zinc-900/90 backdrop-blur-xl border-t border-zinc-800 flex items-center justify-between">
                                <div className="flex flex-col gap-3 flex-1">
                                    {submitError && (
                                        <div className="text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                                            {submitError}
                                        </div>
                                    )}

                                    <div className="flex gap-4 flex-1">
                                    {cameraActive && !capturedImage && (
                                        <Button onClick={capture} className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black text-lg tracking-wider flex gap-3 shadow-[0_0_30px_rgba(79,70,229,0.3)]">
                                            <Camera size={24} /> CAPTURE
                                        </Button>
                                    )}
                                    {capturedImage && (
                                        <>
                                            <Button variant="secondary" onClick={retake} className="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-2xl font-bold flex gap-2">
                                                <RefreshCcw size={20} /> Retake
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
                            </div>
                        )}
                    </Card>
                </div>

                {/* Bottom Section: Management & Queue */}
                <div className="lg:col-span-12 space-y-6">
                    {/* Active Session & Mode Bar */}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
                        <Card className="py-4 px-5 border-zinc-800 bg-zinc-900/50 backdrop-blur-xl flex flex-col gap-3 min-w-0">
                            <div className="flex justify-between items-start w-full">
                                <div className="flex flex-col">
                                    <h3 className="text-[10px] font-black uppercase tracking-widest leading-none mb-1 text-zinc-500">Active Participant</h3>
                                    <p className="text-[9px] font-bold text-zinc-600 uppercase">Current Session</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {sessionData && (
                                        <div className="flex items-center gap-2 px-2.5 py-1 bg-green-500/10 border border-green-500/20 rounded-full shrink-0">
                                            <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />
                                            <span className="text-[8px] font-black text-green-500 uppercase tracking-widest">Ready</span>
                                        </div>
                                    )}
                                    <button
                                        onClick={handleForceClear}
                                        className="p-1.5 text-zinc-600 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                                        title="Force Clear"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            </div>

                            <div className="w-full">
                                {!sessionData ? (
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-3 py-2 px-3 border border-dashed border-zinc-800 rounded-xl bg-zinc-950/30">
                                            <div className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center shrink-0 border border-zinc-800">
                                                <Users size={14} className="text-zinc-700" />
                                            </div>
                                            <div className="text-[10px] font-bold text-zinc-700 uppercase tracking-widest truncate">Waiting for data...</div>
                                        </div>

                                        <form onSubmit={lookupSession} className="flex items-center gap-2">
                                            <Input
                                                placeholder="Input code (6 chars)"
                                                value={code}
                                                onChange={(e) => setCode(e.target.value.toUpperCase())}
                                                maxLength={6}
                                                className="bg-zinc-800/50 border-zinc-700 text-xs font-mono tracking-widest uppercase"
                                            />
                                            <Button
                                                type="submit"
                                                isLoading={loadingSession}
                                                disabled={loadingSession || code.trim().length < 6}
                                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-black uppercase tracking-widest"
                                            >
                                                Lookup
                                            </Button>
                                        </form>

                                        {sessionError && (
                                            <div className="text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                                                {sessionError}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-3 py-2 animate-in fade-in slide-in-from-left-2 w-full">
                                        <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/20 shrink-0">
                                            <CheckCircle2 size={20} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-sm font-black text-white leading-tight truncate">{sessionData.name}</div>
                                            <div className="text-[10px] font-mono text-indigo-400 truncate tracking-tight">{sessionData.whatsapp}</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </Card>

                        <Card className="py-4 px-5 border-zinc-800 bg-zinc-900/50 backdrop-blur-xl flex flex-col gap-3 min-w-0">
                            <div className="flex flex-col">
                                <h3 className="text-[10px] font-black uppercase tracking-widest leading-none mb-1 text-zinc-500">Capture Mode</h3>
                                <p className="text-[9px] font-bold text-zinc-600 uppercase">Hardware Control</p>
                            </div>
                            <div className="flex items-center gap-1 p-1 bg-black/40 rounded-xl border border-zinc-800 w-full shrink-0">
                                <button
                                    onClick={() => handleModeSwitch('webcam')}
                                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${captureMode === 'webcam'
                                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                                        : 'text-zinc-500 hover:text-white hover:bg-zinc-800/50'
                                        }`}
                                >
                                    <Camera size={14} />
                                    Webcam
                                </button>
                                <button
                                    onClick={() => handleModeSwitch('dslr')}
                                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${captureMode === 'dslr'
                                        ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20'
                                        : 'text-zinc-500 hover:text-white hover:bg-zinc-800/50'
                                        }`}
                                >
                                    <FolderOpen size={14} />
                                    Pro DSLR
                                </button>
                            </div>
                        </Card>
                    </div>

                    <Card className="border-zinc-800 bg-zinc-900/50 backdrop-blur-xl">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pt-2">
                            <div>
                                <h2 className="text-base font-black text-white uppercase tracking-tight flex items-center gap-2">
                                    <Users size={18} className="text-indigo-500" />
                                    Participant Queue
                                </h2>
                                <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest mt-0.5">Stoper Management Console</p>
                            </div>

                            <div className="flex items-center gap-3 flex-1 max-w-2xl">
                                <div className="flex-1 relative">
                                    <Input
                                        placeholder="Search name or WhatsApp..."
                                        value={searchQuery}
                                        onChange={e => handleSearchChange(e.target.value)}
                                        className="bg-zinc-800/50 border-zinc-700 pl-10 text-xs"
                                    />
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                                </div>

                                <div className="flex gap-1 p-1 bg-zinc-800/80 rounded-lg border border-zinc-700">
                                    {(['active', 'ready', 'done'] as const).map(status => (
                                        <button
                                            key={status}
                                            onClick={() => setStatusFilter(status)}
                                            className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-md transition-all ${statusFilter === status
                                                ? 'bg-indigo-600 text-white shadow-lg'
                                                : 'text-zinc-500 hover:text-white hover:bg-zinc-700'
                                                }`}
                                        >
                                            {status}
                                        </button>
                                    ))}
                                </div>

                                <button
                                    onClick={() => fetchPendingParticipants(searchQuery, statusFilter)}
                                    disabled={loadingParticipants}
                                    className="p-2.5 text-zinc-500 hover:text-white transition-colors rounded-lg bg-zinc-800/50 border border-zinc-700"
                                >
                                    <RefreshCcw size={16} className={loadingParticipants ? 'animate-spin' : ''} />
                                </button>
                            </div>
                        </div>

                        {pendingParticipants.length === 0 ? (
                            <div className="text-center py-12 border-2 border-dashed border-zinc-800 rounded-2xl bg-zinc-950/20">
                                <Users size={40} className="mx-auto mb-3 text-zinc-800" />
                                <p className="text-sm font-bold text-zinc-500 uppercase tracking-widest">No matching participants found</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-1 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                                {/* Header Row */}
                                <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-zinc-900/30 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 border border-zinc-800/50">
                                    <div className="col-span-3">Participant Name</div>
                                    <div className="col-span-3">Contact Details</div>
                                    <div className="col-span-2">Unique Code</div>
                                    <div className="col-span-2">Registration Time</div>
                                    <div className="col-span-2 text-right">Status / Action</div>
                                </div>

                                <div className="space-y-1.5">
                                    {pendingParticipants.map(p => (
                                        <div
                                            key={p.sessionId}
                                            className={`grid grid-cols-12 items-center gap-4 px-6 py-4 rounded-xl border transition-all ${sessionData?.sessionId === p.sessionId
                                                ? 'bg-indigo-500/10 border-indigo-500/40 shadow-lg'
                                                : 'bg-zinc-800/20 border-zinc-800/50 hover:bg-zinc-800/50 hover:border-zinc-700'
                                                }`}
                                        >
                                            <div className="col-span-3 font-black text-white uppercase text-xs truncate tracking-tight">
                                                {p.name}
                                            </div>

                                            <div className="col-span-3">
                                                <span className="text-[10px] font-mono text-zinc-400 bg-zinc-900 border border-zinc-800 px-2.5 py-1 rounded-lg">
                                                    {maskWhatsapp(p.whatsapp)}
                                                </span>
                                            </div>

                                            <div className="col-span-2">
                                                <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/5 border border-indigo-500/20 px-2.5 py-1 rounded-lg tracking-[0.1em]">
                                                    {p.code}
                                                </span>
                                            </div>

                                            <div className="col-span-2 text-[10px] font-bold text-zinc-500 uppercase">
                                                {formatRelativeTime(p.createdAt)}
                                            </div>

                                            <div className="col-span-2 text-right">
                                                {sessionData?.sessionId === p.sessionId ? (
                                                    <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-green-500/10 rounded-xl border border-green-500/20">
                                                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                                                        <span className="text-[9px] font-black text-green-500 uppercase tracking-widest">Active Now</span>
                                                    </div>
                                                ) : (
                                                    <Button
                                                        onClick={() => activateParticipant(p)}
                                                        isLoading={activatingSessionId === p.sessionId}
                                                        disabled={activatingSessionId !== null}
                                                        className="h-9 px-5 text-[9px] bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-black uppercase tracking-widest shadow-lg shadow-indigo-600/20 transition-all active:scale-95"
                                                    >
                                                        Activate
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </Card>
                </div>
            </div>

        </div >
    );
};
