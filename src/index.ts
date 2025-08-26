interface RequestHeaders {
    [key: string]: string | undefined;
}

// 配置选项
const CONFIG = {
  PORT: process.env.PORT || 3000,
  TARGET_API_URL: process.env.TARGET_API_URL || 'https://api.packycode.com/v1/messages?beta=true',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DEFAULT_API_KEY: process.env.DEFAULT_API_KEY || '' // 可选的默认API key
};

// 简单的日志记录器
const logger = {
  info: (message: string, ...args: any[]) => {
    if (CONFIG.LOG_LEVEL === 'info' || CONFIG.LOG_LEVEL === 'debug') {
      console.log(`[INFO] ${new Date().toISOString()} - ${message}`, ...args);
    }
  },
  debug: (message: string, ...args: any[]) => {
    if (CONFIG.LOG_LEVEL === 'debug') {
      console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`, ...args);
    }
  },
  error: (message: string, ...args: any[]) => {
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, ...args);
  }
};

// 提取API Key的函数
function extractApiKey(headers: RequestHeaders): string | null {
    const authHeader = headers.authorization || headers['x-api-key'];

    if (authHeader) {
        // 如果是Bearer token格式
        if (authHeader.startsWith('Bearer ')) {
            return authHeader.substring(7);
        }
        // 直接返回API key
        return authHeader;
    }

    // 如果请求头中没有API key，尝试使用配置中的默认key
    if (CONFIG.DEFAULT_API_KEY) {
        logger.debug('Using default API key from configuration');
        return CONFIG.DEFAULT_API_KEY;
    }

    return null;
}

// 检查是否为Claude Sonnet 4模型
function isClaudeSonnet4Model(model: string): boolean {
    return model.includes('claude-sonnet-4');
}

// 转换请求头的函数 - 根据模型类型和流式设置选择不同的转换策略
function transformHeaders(originalHeaders: RequestHeaders, apiKey: string, model?: string, isStream?: boolean): Record<string, string> {
    // 基础头部
    const baseHeaders: Record<string, string> = {
        'User-Agent': 'claude-cli/1.0.86 (external, cli)',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Content-Type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-version': originalHeaders['anthropic-version'] || '2023-06-01',
        'authorization': `Bearer ${apiKey}`,
        'x-app': 'cli',
        'x-stainless-arch': 'x64',
        'x-stainless-lang': 'js',
        'x-stainless-os': 'Windows',
        'x-stainless-package-version': '0.55.1',
        'x-stainless-retry-count': '0',
        'x-stainless-runtime': 'node',
        'x-stainless-runtime-version': 'v24.3.0',
        'x-stainless-timeout': '60'
    };

    // 只有在流式请求时才添加 x-stainless-helper-method
    if (isStream) {
        baseHeaders['x-stainless-helper-method'] = 'stream';
        logger.debug('Adding stream helper method header');
    }

    // 根据模型类型设置不同的anthropic-beta头部
    if (model && isClaudeSonnet4Model(model)) {
        baseHeaders['anthropic-beta'] = 'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14';
        logger.debug(`Using Claude Sonnet 4 headers for model: ${model}`);
    } else {
        baseHeaders['anthropic-beta'] = 'fine-grained-tool-streaming-2025-05-14';
        logger.debug(`Using standard headers for model: ${model || 'unknown'}`);
    }

    return baseHeaders;
}

// 代理请求到Packycode API
async function proxyRequest(request: Request): Promise<Response> {
    try {
        const url = new URL(request.url);

        // 只处理 /v1/messages 路径
        if (url.pathname !== '/v1/messages') {
            logger.debug(`Unsupported path: ${url.pathname}`);
            return new Response('Not Found', { status: 404 });
        }

        // 提取原始请求头
        const originalHeaders: RequestHeaders = {};
        request.headers.forEach((value, key) => {
            originalHeaders[key.toLowerCase()] = value;
        });

        // 提取API Key
        const apiKey = extractApiKey(originalHeaders);
        if (!apiKey) {
            logger.error('Missing API Key in request');
            return new Response('Missing API Key', { status: 401 });
        }

        // 读取请求体
        const body = await request.text();
        logger.debug(`Request body length: ${body.length} characters`);

        // 解析请求体以获取模型和流式设置信息
        let model: string | undefined;
        let isStream: boolean = false;
        try {
            const requestData = JSON.parse(body);
            model = requestData.model;
            isStream = requestData.stream === true;
            logger.info(`Detected model: ${model || 'not specified'}, stream: ${isStream}`);
        } catch (error) {
            logger.error('Failed to parse request body JSON:', error);
        }

        // 转换请求头 - 传入模型和流式信息
        const transformedHeaders = transformHeaders(originalHeaders, apiKey, model, isStream);

        // 使用配置中的目标URL
        const targetUrl = CONFIG.TARGET_API_URL;
        logger.info(`Proxying request to: ${targetUrl}`);

        // 发送请求到Packycode API
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: transformedHeaders,
            body: body
        });

        logger.info(`Response status: ${response.status} ${response.statusText}`);

        // 创建响应头，保持原始响应的内容类型和其他重要头部
        const responseHeaders = new Headers();
        response.headers.forEach((value, key) => {
            responseHeaders.set(key, value);
        });

        // 如果是流式响应，直接返回流
        if (response.headers.get('content-type')?.includes('text/stream') ||
            response.headers.get('content-type')?.includes('text/event-stream')) {
            logger.debug('Returning streaming response');
            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders
            });
        }

        // 对于非流式响应，读取完整内容
        const responseBody = await response.text();
        logger.debug(`Response body length: ${responseBody.length} characters`);

        return new Response(responseBody, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
        });

    } catch (error) {
        logger.error('Proxy error:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}

// 添加CORS头部
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
};

// 创建HTTP服务器
const server = Bun.serve({
    port: CONFIG.PORT,
    async fetch(request) {

        // 处理预检请求
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 200,
                headers: corsHeaders
            });
        }

        // 只处理POST请求
        if (request.method !== 'POST') {
            return new Response('Method Not Allowed', {
                status: 405,
                headers: corsHeaders
            });
        }

        // 代理请求
        const response = await proxyRequest(request);

        // 添加CORS头部到响应
        Object.entries(corsHeaders).forEach(([key, value]) => {
            response.headers.set(key, value);
        });

        return response;
    },
});

logger.info(`🚀 Server running on http://localhost:${server.port}`);
logger.info(`📡 Proxying Anthropic API requests to: ${CONFIG.TARGET_API_URL}`);
logger.info('📋 Endpoint: POST /v1/messages');
logger.info(`🔧 Log level: ${CONFIG.LOG_LEVEL}`);
logger.info(`🔑 Default API key: ${CONFIG.DEFAULT_API_KEY ? 'configured' : 'not set'}`);