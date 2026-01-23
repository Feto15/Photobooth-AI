import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, Fingerprint } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Button, Input, Card } from '../../components/ui';
import api from '../../services/api';

export const LoginPage: React.FC = () => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        try {
            const response = await api.post('/auth/login', { password });
            login(response.data.data.token);
            navigate('/');
        } catch (err: any) {
            setError(err.response?.data?.error?.message || 'Login gagal');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--bg-depth)] p-4">
            <div className="w-full max-w-sm">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-white rounded-2xl mx-auto mb-4 flex items-center justify-center">
                        <Zap size={32} className="text-black" />
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-1">Photobot.AI</h1>
                    <p className="text-zinc-500 text-sm">Operator Login</p>
                </div>

                <Card>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <Input
                            label="Password"
                            type="password"
                            placeholder="Masukkan password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            error={error}
                            icon={<Fingerprint size={18} />}
                            autoFocus
                        />

                        <Button
                            type="submit"
                            className="w-full"
                            isLoading={isLoading}
                        >
                            Login
                        </Button>
                    </form>
                </Card>
            </div>
        </div>
    );
};
