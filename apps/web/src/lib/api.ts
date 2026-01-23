import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

export const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('token');
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

// Jobs
export interface CreateJobParams {
    eventId: string;
    participantName?: string;
    participantCode?: string;
    mode: string;
    styleId: string;
    image: File;
}

export async function createJob(params: CreateJobParams) {
    const formData = new FormData();
    formData.append('eventId', params.eventId);
    formData.append('mode', params.mode);
    formData.append('styleId', params.styleId);
    formData.append('image', params.image);
    
    if (params.participantName) {
        formData.append('participantName', params.participantName);
    }
    if (params.participantCode) {
        formData.append('participantCode', params.participantCode);
    }

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
        participantName?: string;
        participantCode?: string;
        mode: string;
        styleId: string;
    };
    output?: Array<{
        type: string;
        key: string;
        signedUrl: string;
    }>;
    failedReason?: string;
}

export async function getJob(jobId: string): Promise<JobDetails> {
    const response = await api.get(`/jobs/${jobId}`);
    return response.data.data;
}

export async function getJobDownloadUrl(jobId: string): Promise<string> {
    return `${API_BASE_URL}/jobs/${jobId}/download`;
}

// List jobs
export interface JobListItem {
    jobId: string;
    status: string;
    progress?: { percent: number; stage: string };
    data: {
        eventId: string;
        participantName?: string;
        participantCode?: string;
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
