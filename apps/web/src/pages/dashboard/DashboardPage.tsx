import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '../../components/ui';

export const DashboardPage: React.FC = () => {
    const navigate = useNavigate();

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
            <div className="text-center">
                <h1 className="text-2xl font-bold text-white mb-2">Photobot.AI</h1>
                <p className="text-zinc-500">Klik tombol di bawah untuk mulai</p>
            </div>

            <Button size="lg" onClick={() => navigate('/capture')}>
                <Plus size={20} /> New Job
            </Button>
        </div>
    );
};
