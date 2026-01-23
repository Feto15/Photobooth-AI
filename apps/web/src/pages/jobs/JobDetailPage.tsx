import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, ChevronLeft, RefreshCcw, Loader2 } from 'lucide-react';
import { Button, Card } from '../../components/ui';
import api from '../../services/api';

const StatusBadge = ({ status }: { status: string }) => {
    const colors: Record<string, string> = {
        queued: 'bg-zinc-500 text-white',
        running: 'bg-blue-500 text-white',
        succeeded: 'bg-emerald-500 text-white',
        failed: 'bg-red-500 text-white'
    };

    return (
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${colors[status] || colors.queued}`}>
            {status}
        </span>
    );
};

export const JobDetailPage: React.FC = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [elapsed, setElapsed] = useState(0);

    const { data: jobResponse, refetch } = useQuery({
        queryKey: ['job', id],
        queryFn: () => api.get(`/jobs/${id}`),
        refetchInterval: (query) => {
            const s = query?.state?.data?.data?.data?.status;
            return (s === 'queued' || s === 'running') ? 1000 : false;
        },
    });

    const job = jobResponse?.data?.data;
    const status = job?.status;
    const isProcessing = status === 'queued' || status === 'running';

    useEffect(() => {
        if (isProcessing) {
            const i = setInterval(() => setElapsed(e => e + 1), 1000);
            return () => clearInterval(i);
        }
    }, [isProcessing]);

    const handleDownload = () => {
        const token = localStorage.getItem('operator_token');
        window.open(`${api.defaults.baseURL}/jobs/${id}/download?token=${token}`);
    };

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                    <ChevronLeft size={20} />
                </Button>
                <div className="flex-1">
                    <h1 className="text-xl font-bold text-white">Job Detail</h1>
                    <p className="text-zinc-500 text-sm font-mono">{id}</p>
                </div>
                <StatusBadge status={status} />
            </div>

            <Card>
                <div className="aspect-video bg-black rounded-xl overflow-hidden flex items-center justify-center">
                    {isProcessing ? (
                        <div className="text-center">
                            <Loader2 size={48} className="animate-spin text-blue-500 mx-auto mb-4" />
                            <p className="text-white font-medium">Processing...</p>
                            <p className="text-zinc-500 text-sm">{elapsed}s elapsed</p>
                        </div>
                    ) : status === 'succeeded' && job.output?.[0]?.signedUrl ? (
                        <img
                            src={job.output[0].signedUrl}
                            className="w-full h-full object-contain"
                            alt="Output"
                        />
                    ) : status === 'failed' ? (
                        <div className="text-center p-8">
                            <p className="text-red-500 font-medium mb-2">Job Failed</p>
                            <p className="text-zinc-500 text-sm mb-4">{job?.failedReason || 'Unknown error'}</p>
                            <Button onClick={() => refetch()}>
                                <RefreshCcw size={16} /> Retry
                            </Button>
                        </div>
                    ) : (
                        <p className="text-zinc-500">No output available</p>
                    )}
                </div>
            </Card>

            <Card>
                <h2 className="font-semibold text-white mb-4">Info</h2>
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <p className="text-zinc-500">Nama</p>
                        <p className="text-white">{job?.participantName || 'Guest'}</p>
                    </div>
                    <div>
                        <p className="text-zinc-500">Style</p>
                        <p className="text-white">{job?.styleId || '-'}</p>
                    </div>
                    <div>
                        <p className="text-zinc-500">Created</p>
                        <p className="text-white">
                            {job?.createdAt ? new Date(job.createdAt).toLocaleString() : '-'}
                        </p>
                    </div>
                    <div>
                        <p className="text-zinc-500">Status</p>
                        <p className="text-white">{status || '-'}</p>
                    </div>
                </div>

                {status === 'succeeded' && (
                    <Button onClick={handleDownload} className="w-full mt-4">
                        <Download size={18} /> Download
                    </Button>
                )}
            </Card>
        </div>
    );
};
