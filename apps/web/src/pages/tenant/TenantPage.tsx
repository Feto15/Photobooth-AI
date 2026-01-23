import React, { useMemo, useState, useEffect } from 'react';
import { User, MessageCircle, QrCode, Loader2, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button, Input, Card } from '../../components/ui';
import { createSession, type SessionResponse } from '../../lib/api';
import QRCode from 'qrcode';

export const TenantPage: React.FC = () => {
    const [name, setName] = useState('');
    const [whatsapp, setWhatsapp] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [sessionData, setSessionData] = useState<SessionResponse | null>(null);
    const [qrDataUrl, setQrDataUrl] = useState('');

    const eventId = useMemo(() => {
        const params = new URLSearchParams(window.location.search);
        return params.get('eventId') || import.meta.env.VITE_EVENT_ID || 'default-event';
    }, []);
    const [eventIdInput, setEventIdInput] = useState(eventId);
    const isEventLocked = useMemo(() => {
        const params = new URLSearchParams(window.location.search);
        return !!params.get('eventId');
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        try {
            // Validasi client-side sederhana sebelum hit API
            if (!/^62\d{8,13}$/.test(whatsapp.trim())) {
                setError('WhatsApp harus diawali 62 (contoh: 628123456789)');
                setIsLoading(false);
                return;
            }

            const data = await createSession({
                eventId: eventIdInput.trim() || eventId,
                name: name.trim(),
                whatsapp: whatsapp.trim(),
            });
            setSessionData(data);
        } catch (err: any) {
            console.error('Session error:', err);
            if (err.response?.status === 429) {
                setError('Terlalu sering mencoba. Silakan tunggu sebentar.');
            } else {
                setError(err.response?.data?.error?.message || 'Gagal membuat sesi. Silakan coba lagi.');
            }
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        let cancelled = false;
        if (!sessionData?.code) {
            setQrDataUrl('');
            return;
        }

        QRCode.toDataURL(sessionData.code, {
            width: 300,
            margin: 1,
            color: { dark: '#000000', light: '#FFFFFF' },
        }).then((url) => {
            if (!cancelled) setQrDataUrl(url);
        }).catch(() => {
            if (!cancelled) setQrDataUrl('');
        });

        return () => {
            cancelled = true;
        };
    }, [sessionData?.code]);

    if (sessionData) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[var(--bg-depth)] p-4 sm:p-6">
                <div className="w-full max-w-lg animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <div className="text-center mb-10">
                        <div className="w-20 h-20 bg-green-500/20 text-green-500 rounded-3xl mx-auto mb-6 flex items-center justify-center ring-1 ring-green-500/30">
                            <CheckCircle2 size={40} />
                        </div>
                        <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">Terdaftar!</h1>
                        <p className="text-zinc-400">Tunjukkan kode unik ini ke operator di booth</p>
                    </div>

                    <Card className="relative overflow-hidden border-zinc-800 bg-zinc-900/50 backdrop-blur-xl">
                        {/* Decorative background element */}
                        <div className="absolute -top-24 -right-24 w-48 h-48 bg-green-500/10 blur-3xl rounded-full" />

                        <div className="relative z-10 space-y-8 py-4">
                            <div className="text-center">
                                <div className="inline-block px-4 py-1 rounded-full bg-zinc-800 text-zinc-500 text-[10px] font-bold uppercase tracking-widest mb-4">
                                    Your Unique Code
                                </div>
                                <div className="text-7xl font-mono font-black text-white mb-2 tracking-[0.2em] drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">
                                    {sessionData.code}
                                </div>
                            </div>

                            <div className="flex justify-center flex-col items-center">
                                <div className="p-4 bg-white rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)]">
                                    {qrDataUrl ? (
                                        <img
                                            src={qrDataUrl}
                                            alt={`QR Code ${sessionData.code}`}
                                            className="w-48 h-48 sm:w-56 sm:h-56"
                                        />
                                    ) : (
                                        <div className="w-48 h-48 sm:w-56 sm:h-56 bg-black/5 border border-black/10 rounded-xl flex items-center justify-center text-zinc-500 text-sm">
                                            QR unavailable
                                        </div>
                                    )}
                                </div>
                                <p className="mt-6 text-zinc-500 text-xs flex items-center gap-2">
                                    <Loader2 size={12} className="animate-spin" />
                                    Berlaku hingga {new Date(sessionData.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                            </div>

                            <div className="pt-4">
                                <Button
                                    variant="secondary"
                                    onClick={() => {
                                        setSessionData(null);
                                        setName('');
                                        setWhatsapp('');
                                    }}
                                    className="w-full py-6 text-lg rounded-2xl bg-zinc-800/50 hover:bg-zinc-800 border-zinc-700/50"
                                >
                                    Selesai
                                </Button>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--bg-depth)] p-4 sm:p-6">
            <div className="w-full max-w-md animate-in fade-in duration-1000">
                <div className="text-center mb-10">
                    <div className="relative inline-block">
                        <div className="w-20 h-20 bg-white text-black rounded-3xl mx-auto mb-6 flex items-center justify-center shadow-[0_0_30px_rgba(255,255,255,0.2)]">
                            <QrCode size={36} />
                        </div>
                        <div className="absolute -top-2 -right-2 bg-indigo-500 p-2 rounded-full shadow-lg">
                            <ArrowRight size={16} className="text-white" />
                        </div>
                    </div>
                    <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">Photobot<span className="text-indigo-500">.AI</span></h1>
                    <p className="text-zinc-500 italic">"Turn your smile into art"</p>
                </div>

                <Card className="border-zinc-800 bg-zinc-900/50 backdrop-blur-xl">
                    <form onSubmit={handleSubmit} className="space-y-6 py-2">
                        <Input
                            label="Event ID"
                            placeholder="default-event"
                            value={eventIdInput}
                            onChange={(e) => setEventIdInput(e.target.value)}
                            icon={<QrCode size={18} />}
                            required
                            disabled={isEventLocked}
                            className="bg-zinc-800/50 py-3 rounded-xl"
                        />

                        <Input
                            label="Nama Kamu"
                            placeholder="Contoh: Rezel"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            icon={<User size={18} />}
                            required
                            autoFocus
                            autoComplete="name"
                            className="bg-zinc-800/50 py-3 rounded-xl"
                        />

                        <Input
                            label="Nomor WhatsApp"
                            placeholder="628123456789"
                            value={whatsapp}
                            onChange={(e) => setWhatsapp(e.target.value)}
                            error={error}
                            icon={<MessageCircle size={18} />}
                            required
                            autoComplete="tel"
                            className="bg-zinc-800/50 py-3 rounded-xl"
                        />

                        <div className="pt-2">
                            <Button
                                type="submit"
                                className="w-full py-7 text-lg rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-lg shadow-indigo-500/20"
                                isLoading={isLoading}
                                disabled={!name.trim() || !whatsapp.trim() || isLoading}
                            >
                                {isLoading ? 'Mendaftarkan...' : 'Dapatkan Kode Booth'}
                            </Button>
                        </div>
                    </form>
                </Card>

                <p className="text-center mt-8 text-zinc-600 text-xs px-8 leading-relaxed">
                    Dengan mendaftar, data Anda akan disinkronkan dengan operator kami untuk proses filter AI.
                </p>
                <p className="text-center mt-2 text-zinc-700 text-[11px]">Event: {eventIdInput || eventId}</p>
            </div>
        </div>
    );
};
