export interface AiProcessOptions {
    inputImageBytes: Buffer;
    inputImageUrl?: string; // Signed URL for kie.ai
    mode: string;
    styleId: string;
    prompt?: string;
    seed?: number;
    aspectRatio?: string;
    resolution?: '1K' | '2K' | '4K';
    outputFormat?: 'png' | 'jpg' | 'jpeg';
}

export interface AiProcessResult {
    outputs: Buffer[];
    metadata: {
        providerRequestId?: string;
        taskId?: string;
        seed?: number;
        model?: string;
        [key: string]: any;
    };
}

export interface AiProvider {
    process(options: AiProcessOptions): Promise<AiProcessResult>;
}

// Kie.ai specific types
export interface KieCreateTaskRequest {
    model: string;
    callBackUrl?: string;
    input: {
        prompt: string;
        image_input?: string[];
        image_urls?: string[];
        aspect_ratio?: string;
        image_size?: string;
        resolution?: string;
        output_format?: string;
    };
}

export interface KieCreateTaskResponse {
    code: number;
    msg: string;
    data?: {
        taskId: string;
    };
}

export interface KieTaskStatusResponse {
    code: number;
    msg: string;
    data?: {
        taskId: string;
        status: 'pending' | 'processing' | 'completed' | 'failed';
        output?: {
            image_urls?: string[];
            images?: string[];
        };
        error?: string;
    };
}

export type KieErrorType = 'transient' | 'fatal';

export function classifyKieError(code: number): KieErrorType {
    // Fatal errors - don't retry
    if ([401, 402, 422, 505, 501].includes(code)) {
        return 'fatal';
    }
    // Transient errors - retry with backoff
    if ([429, 455, 500].includes(code)) {
        return 'transient';
    }
    // Default to transient for unknown errors
    return 'transient';
}
