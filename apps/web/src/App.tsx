import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from './context/AuthContext';
import { MainLayout } from './layouts/MainLayout';
import { LoginPage } from './pages/auth/LoginPage';
import { TenantPage } from './pages/tenant/TenantPage';
import { CapturePage } from './pages/jobs/CapturePage';
import { JobDetailPage } from './pages/jobs/JobDetailPage';
import { ShowcasePage } from './pages/jobs/ShowcasePage';

const queryClient = new QueryClient();

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { isAuthenticated } = useAuth();

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    return <MainLayout>{children}</MainLayout>;
};

const App: React.FC = () => {
    return (
        <QueryClientProvider client={queryClient}>
            <Toaster
                position="top-right"
                richColors
                closeButton
                duration={4000}
                toastOptions={{
                    style: {
                        background: '#18181b',
                        border: '1px solid #27272a',
                        color: '#fff',
                    },
                }}
            />
            <AuthProvider>
                <BrowserRouter>
                    <Routes>
                        <Route path="/login" element={<LoginPage />} />
                        <Route path="/_tenant" element={<TenantPage />} />

                        <Route
                            path="/"
                            element={
                                <ProtectedRoute>
                                    <CapturePage />
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/jobs/:id"
                            element={
                                <ProtectedRoute>
                                    <JobDetailPage />
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/showcase"
                            element={<ShowcasePage />}
                        />

                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </BrowserRouter>
            </AuthProvider>
        </QueryClientProvider>
    );
};

export default App;
