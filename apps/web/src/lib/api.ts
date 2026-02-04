import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('operator_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('operator_token');
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

// Auth
export async function login(password: string) {
    const response = await api.post('/auth/login', { password });
    return response.data.data;
}

// Sessions
export interface CreateSessionParams {
    eventId: string;
    name: string;
    whatsapp: string;
}

export interface SessionResponse {
    sessionId: string;
    code: string;
    expiresAt: string;
}

export async function createSession(params: CreateSessionParams): Promise<SessionResponse> {
    const response = await api.post('/sessions', params);
    return response.data.data;
}

export interface SessionData {
    sessionId: string;
    eventId: string;
    name: string;
    whatsapp: string;
}

export async function getSession(code: string): Promise<SessionData> {
    const response = await api.get(`/sessions/${code}`);
    return response.data.data;
}

// Session List (for stoper)
export interface SessionListItem {
    sessionId: string;
    code: string;
    name: string;
    whatsapp: string;
    createdAt: string;
}

export interface SessionListResponse {
    sessions: SessionListItem[];
}

export async function getSessionList(eventId: string, status: string = 'active', q?: string): Promise<SessionListResponse> {
    const params: Record<string, string> = { eventId, status };
    if (q && q.trim().length > 0) {
        params.q = q.trim();
    }
    const response = await api.get('/sessions/list', { params });
    return response.data.data;
}

// Jobs
export interface CreateJobParams {
    sessionId: string;
    eventId: string;
    mode: string;
    styleId: string;
    image: File;
}

export async function createJob(params: CreateJobParams) {
    const formData = new FormData();
    formData.append('sessionId', params.sessionId);
    formData.append('eventId', params.eventId);
    formData.append('mode', params.mode);
    formData.append('styleId', params.styleId);
    formData.append('image', params.image);

    const response = await api.post('/jobs', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data.data;
}

export interface JobDetails {
    jobId: string;
    status: string;
    progress?: { percent: number; stage: string };
    data: {
        eventId: string;
        participantName: string;
        participantWhatsapp: string;
        mode: string;
        styleId: string;
    };
    output?: Array<{
        type: string;
        key: string;
        signedUrl: string;
    }>;
    failedReason?: string;
    createdAt?: string | null;
}

export async function getJob(jobId: string): Promise<JobDetails> {
    const response = await api.get(`/jobs/${jobId}`);
    return response.data.data;
}

export function getJobDownloadUrl(jobId: string): string {
    return `${API_BASE_URL}/jobs/${jobId}/download`;
}

// List jobs
export interface JobListItem {
    jobId: string;
    status: string;
    progress?: { percent: number; stage: string };
    data: {
        eventId: string;
        participantName: string;
        participantWhatsapp: string;
        mode: string;
        styleId: string;
    };
    createdAt: string | null;
    hasOutput: boolean;
}

export interface JobListResponse {
    jobs: JobListItem[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
    };
}

export async function getJobs(params?: {
    eventId?: string;
    status?: string;
    limit?: number;
    offset?: number;
}): Promise<JobListResponse> {
    const response = await api.get('/jobs', { params });
    return response.data.data;
}

// Booth Active Session
export interface ActiveSessionData {
    boothId: string;
    sessionId: string;
    eventId: string;
    code: string;
    name: string;
    whatsapp: string;
    operatorId: string;
    startedAt: string;
    mode?: string;
    styleId?: string;
    ttlSeconds?: number;
    ttlSecondsRemaining?: number;
}

export interface SetActiveSessionParams {
    sessionId: string;
    eventId: string;
    code?: string;
    mode: string;
    styleId: string;
}

export async function setActiveSession(boothId: string, params: SetActiveSessionParams): Promise<ActiveSessionData> {
    const response = await api.post(`/booth/${boothId}/active-session`, params);
    return response.data.data;
}

export async function clearActiveSession(boothId: string): Promise<{ boothId: string; cleared: boolean }> {
    const response = await api.delete(`/booth/${boothId}/active-session`);
    return response.data.data;
}

export async function getActiveSession(boothId: string): Promise<ActiveSessionData> {
    const response = await api.get(`/booth/${boothId}/active-session`);
    return response.data.data;
}

export async function refreshActiveSession(boothId: string): Promise<{ boothId: string; refreshed: boolean; ttlSeconds: number; session: ActiveSessionData }> {
    const response = await api.post(`/booth/${boothId}/active-session/refresh`);
    return response.data.data;
}
