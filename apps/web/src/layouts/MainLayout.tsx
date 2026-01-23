import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <div className="min-h-screen bg-[var(--bg-depth)]">
            {/* Header */}
            <header className="flex items-center justify-between p-4 border-b border-white/5">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center">
                        <Zap size={16} className="text-black" />
                    </div>
                    <span className="font-bold text-white">Photobot.AI</span>
                </div>
                <button
                    onClick={handleLogout}
                    className="p-2 rounded-lg text-zinc-500 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                    title="Logout"
                >
                    <LogOut size={20} />
                </button>
            </header>

            {/* Content */}
            <main className="p-4 lg:p-8">
                <div className="max-w-2xl mx-auto">
                    {children}
                </div>
            </main>
        </div>
    );
};
