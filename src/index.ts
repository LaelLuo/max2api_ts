interface RequestHeaders {
    [key: string]: string | undefined;
}

// 配置选项
const CONFIG = {
  PORT: process.env.PORT || 3000,
  TARGET_API_URL: process.env.TARGET_API_URL || 'https://api.packycode.com/v1/messages?beta=true',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DEFAULT_API_KEY: process.env.DEFAULT_API_KEY || '', // 可选的默认API key
  DEFAULT_USER_ID: process.env.DEFAULT_USER_ID || '', // 默认用户ID
  FORCE_DEFAULT_API_KEY: process.env.FORCE_DEFAULT_API_KEY === 'true' // 强制使用默认API key，忽略请求头中的authHeader
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
    // 如果强制使用默认API key，直接返回默认key（如果配置了的话）
    if (CONFIG.FORCE_DEFAULT_API_KEY) {
        if (CONFIG.DEFAULT_API_KEY) {
            logger.debug('Force using default API key from configuration (ignoring auth headers)');
            return CONFIG.DEFAULT_API_KEY;
        } else {
            logger.debug('FORCE_DEFAULT_API_KEY is enabled but DEFAULT_API_KEY is not configured');
            return null;
        }
    }

    const authHeader = headers.authorization || headers['x-api-key'];

    if (authHeader) {
        // 如果是Bearer token格式
        if (authHeader.startsWith('Bearer ')) {
            const apiKey = authHeader.substring(7);
            logger.debug(`Extracted API key from Bearer token: ${apiKey.substring(0, 10)}...`);
            return apiKey;
        }
        // 直接返回API key
        logger.debug(`Extracted API key directly: ${authHeader.substring(0, 10)}...`);
        return authHeader;
    }

    // 如果请求头中没有API key，尝试使用配置中的默认key
    if (CONFIG.DEFAULT_API_KEY) {
        logger.debug('Using default API key from configuration');
        return CONFIG.DEFAULT_API_KEY;
    }

    return null;
}

// 生成UUID v4
function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// 生成格式化的用户ID
function generateFormattedUserId(): string {
    if (!CONFIG.DEFAULT_USER_ID) {
        return '';
    }
    const sessionUuid = generateUUID();
    return `user_${CONFIG.DEFAULT_USER_ID}_account__session_${sessionUuid}`;
}

// 检查是否为Claude 3.5 Haiku模型
function isClaudeHaikuModel(model: string): boolean {
    return model.includes('claude-3-5-haiku');
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
    if (model && isClaudeHaikuModel(model)) {
        baseHeaders['anthropic-beta'] = 'fine-grained-tool-streaming-2025-05-14';
        logger.debug(`Using Claude 3.5 Haiku headers for model: ${model}`);
    } else {
        baseHeaders['anthropic-beta'] = 'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14';
        logger.debug(`Using enhanced headers for model: ${model || 'unknown'}`);
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

        logger.debug('=== INCOMING REQUEST DEBUG ===');
        logger.debug(`Request URL: ${request.url}`);
        logger.debug(`Request Method: ${request.method}`);
        logger.debug('Original request headers:', JSON.stringify(originalHeaders, null, 2));

        // 提取API Key
        const apiKey = extractApiKey(originalHeaders);
        if (!apiKey) {
            logger.error('Missing API Key in request');
            return new Response('Missing API Key', { status: 401 });
        }

        // 读取请求体
        const body = await request.text();
        logger.debug(`Request body length: ${body.length} characters`);
        // logger.debug('Request body content:', body);

        // 解析请求体以获取模型和流式设置信息，并添加metadata
        let model: string | undefined;
        let isStream: boolean = false;
        let modifiedBody: string = body;
        try {
            const requestData = JSON.parse(body);
            model = requestData.model;
            isStream = requestData.stream === true;

            // 添加metadata字段
            if (!requestData.metadata) {
                const formattedUserId = generateFormattedUserId();
                requestData.metadata = {
                    user_id: formattedUserId
                };
                modifiedBody = JSON.stringify(requestData);
                logger.debug(`Added metadata to request body with user_id: ${formattedUserId.substring(0, 50)}...`);
            }

            logger.info(`Detected model: ${model || 'not specified'}, stream: ${isStream}`);
            // logger.debug('Parsed request data:', JSON.stringify(requestData, null, 2));
        } catch (error) {
            logger.error('Failed to parse request body JSON:', error);
        }

        // 转换请求头 - 传入模型和流式信息
        const transformedHeaders = transformHeaders(originalHeaders, apiKey, model, isStream);

        // 使用配置中的目标URL
        const targetUrl = CONFIG.TARGET_API_URL;
        logger.info(`Proxying request to: ${targetUrl}`);

        logger.debug('=== OUTGOING REQUEST DEBUG ===');
        logger.debug(`Target URL: ${targetUrl}`);
        logger.debug('Transformed headers:', JSON.stringify(transformedHeaders, null, 2));
        // logger.debug('Request body (modified):', modifiedBody);

        // 发送请求到Packycode API
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: transformedHeaders,
            body: modifiedBody
        });

        logger.info(`Response status: ${response.status} ${response.statusText}`);

        logger.debug('=== INCOMING RESPONSE DEBUG ===');
        logger.debug(`Response status: ${response.status} ${response.statusText}`);

        // 记录响应头
        const responseHeadersObj: Record<string, string> = {};
        response.headers.forEach((value, key) => {
            responseHeadersObj[key] = value;
        });
        logger.debug('Response headers:', JSON.stringify(responseHeadersObj, null, 2));

        // 创建响应头，保持原始响应的内容类型和其他重要头部
        const responseHeaders = new Headers();
        response.headers.forEach((value, key) => {
            responseHeaders.set(key, value);
        });

        // 如果是流式响应，直接返回流
        if (response.headers.get('content-type')?.includes('text/stream') ||
            response.headers.get('content-type')?.includes('text/event-stream')) {
            logger.debug('Returning streaming response (body not logged for streams)');
            logger.debug('=== OUTGOING RESPONSE DEBUG ===');
            logger.debug('Response type: Streaming');
            logger.debug('Final response headers:', JSON.stringify(Object.fromEntries(responseHeaders.entries()), null, 2));
            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders
            });
        }

        // 对于非流式响应，读取完整内容
        const responseBody = await response.text();
        logger.debug(`Response body length: ${responseBody.length} characters`);

        logger.debug('=== OUTGOING RESPONSE DEBUG ===');
        logger.debug('Response type: Non-streaming');
        logger.debug('Final response headers:', JSON.stringify(Object.fromEntries(responseHeaders.entries()), null, 2));
        logger.debug('Final response body:', responseBody);

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
logger.info(`� Force default API key: ${CONFIG.FORCE_DEFAULT_API_KEY ? 'enabled' : 'disabled'}`);
logger.info(`�👤 Default user ID: ${CONFIG.DEFAULT_USER_ID ? `${CONFIG.DEFAULT_USER_ID} (will be formatted as user_${CONFIG.DEFAULT_USER_ID}_account__session_{uuid})` : 'not set'}`);