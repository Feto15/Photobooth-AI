import React, { useEffect, useState } from 'react';
import { getJobs, getJob } from '../../lib/api';
// import type { JobListItem } from '../../lib/api'; // Not needed since we don't use it directly
import { Loader2, Camera, User, Sparkles } from 'lucide-react';

const EVENT_ID = 'default-event'; // Should be dynamic in a real app

export const ShowcasePage: React.FC = () => {
    const [latestJob, setLatestJob] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchLatestSuccessfulJob = async () => {
        try {
            const response = await getJobs({
                eventId: EVENT_ID,
                status: 'succeeded',
                limit: 1
            });

            if (response.jobs && response.jobs.length > 0) {
                const latestBrief = response.jobs[0];

                // If it's a new job or we don't have one yet, fetch full details for signed URL
                if (!latestJob || latestJob.jobId !== latestBrief.jobId) {
                    const fullJob = await getJob(latestBrief.jobId);
                    setLatestJob(fullJob);
                }
            }
            setError(null);
        } catch (err) {
            console.error('Failed to fetch latest job:', err);
            // Don't set error on polling to avoid flickering UI
            if (!latestJob) setError('Failed to load showcase');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLatestSuccessfulJob();
        const interval = setInterval(fetchLatestSuccessfulJob, 5000); // Poll every 5 seconds
        return () => clearInterval(interval);
    }, []);

    if (loading && !latestJob) {
        return (
            <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white">
                <Loader2 className="w-12 h-12 animate-spin text-indigo-500 mb-4" />
                <p className="text-zinc-500 font-black uppercase tracking-widest animate-pulse">
                    Preparing Showcase...
                </p>
            </div>
        );
    }

    if (error && !latestJob) {
        return (
            <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white p-8 text-center">
                <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-6">
                    <Camera className="w-10 h-10 text-red-500" />
                </div>
                <h1 className="text-2xl font-black mb-2 uppercase tracking-tighter">No Photos Found</h1>
                <p className="text-zinc-500 max-w-md">Start taking photos to see them appear here in real-time!</p>
            </div>
        );
    }

    const outputImage = latestJob?.output?.[0]?.signedUrl;

    return (
        <div className="min-h-screen bg-black overflow-hidden flex items-center justify-center relative">
            {/* Background Glows */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/20 blur-[120px] rounded-full" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 blur-[120px] rounded-full" />

            {/* Main Content Container */}
            <div className="relative z-10 w-full max-w-6xl px-4 flex flex-col items-center">

                {/* Header branding */}
                <div className="mb-8 text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-md mb-4">
                        <Sparkles size={14} className="text-indigo-400" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300">AI Photobooth Showcase</span>
                    </div>
                </div>

                {/* The Photo Card */}
                <div className="group relative w-full aspect-[3/4] md:aspect-[4/5] max-h-[80vh] rounded-3xl overflow-hidden bg-zinc-900 shadow-2xl shadow-black ring-1 ring-white/10 flex items-center justify-center translate-y-[-20px] animate-in fade-in zoom-in duration-1000">

                    {outputImage ? (
                        <>
                            <img
                                key={latestJob.jobId} // Trigger animation on new job
                                src={outputImage}
                                alt="Latest AI Transformation"
                                className="w-full h-full object-contain animate-in fade-in duration-700"
                            />

                            {/* Overlay Info */}
                            <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-20">
                                <div className="flex items-end justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/20 border border-white/20">
                                            <User size={24} className="text-white" />
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-black text-white uppercase tracking-tight leading-none mb-1">
                                                {latestJob.data?.participantName || 'Guest'}
                                            </h2>
                                            <p className="text-zinc-300 text-xs font-bold uppercase tracking-widest opacity-80">
                                                Style: {latestJob.data?.styleId || 'Classic'}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="hidden md:block">
                                        <div className="px-4 py-2 rounded-xl bg-white/10 backdrop-blur-md border border-white/20">
                                            <span className="text-[10px] font-black text-white uppercase tracking-widest">Processed by AI</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center text-zinc-600">
                            <Loader2 className="w-12 h-12 animate-spin mb-4" />
                            <p className="text-xs font-black uppercase tracking-widest">Image Loading...</p>
                        </div>
                    )}

                    {/* Decorative Corner Lines */}
                    <div className="absolute top-0 left-0 w-24 h-24 border-t-2 border-l-2 border-white/20 rounded-tl-3xl" />
                    <div className="absolute bottom-0 right-0 w-24 h-24 border-b-2 border-r-2 border-white/20 rounded-br-3xl" />
                </div>

                {/* Footer text */}
                <div className="mt-8 text-center opacity-40">
                    <p className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-500">Live AI Transformation Feed</p>
                </div>
            </div>
        </div>
    );
};
