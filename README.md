# Max2API - Anthropic to Packycode API Proxy

这是一个使用Bun构建的HTTP代理服务器，将Anthropic API请求转换为Packycode API请求。

## 功能特性

- 🔄 将Anthropic API格式的请求转换为Packycode API格式
- 🚀 使用Bun运行时，性能优异
- 📡 支持流式响应
- 🔐 自动处理API密钥转换
- 🌐 支持CORS跨域请求
- ⚡ TypeScript支持
- 🤖 智能模型检测：根据请求体中的模型自动调整请求头
- 🔧 可配置的日志级别和目标URL

## 请求转换

### 输入格式 (Anthropic API)
```
POST /v1/messages HTTP/2
Host: api.anthropic.com
anthropic-version: 2023-06-01
x-api-key: your-api-key
Content-Type: application/json
```

### 输出格式 (Packycode API)

#### Claude 3.5 Haiku 模型
当请求体中的 `model` 字段为 `claude-3-5-haiku-20241022` 时：
```
POST https://api.packycode.com/v1/messages?beta=true
User-Agent: claude-cli/1.0.86 (external, cli)
Accept: application/json
Content-Type: application/json
anthropic-beta: fine-grained-tool-streaming-2025-05-14
anthropic-version: 2023-06-01
authorization: Bearer your-api-key
```

#### 其他所有模型
包括 Claude Sonnet 4、Claude 3.5 Sonnet 等所有其他模型：
```
POST https://api.packycode.com/v1/messages?beta=true
User-Agent: claude-cli/1.0.86 (external, cli)
Accept: application/json
Content-Type: application/json
anthropic-beta: claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14
anthropic-version: 2023-06-01
authorization: Bearer your-api-key
```

## 安装和运行

### 前提条件
- 安装 [Bun](https://bun.sh/)

### 启动服务器

```bash
# 开发模式（自动重启）
bun run dev

# 生产模式
bun run start
```

服务器默认运行在 `http://localhost:3000`

### 环境变量

- `PORT`: 服务器端口（默认: 3000）
- `DEFAULT_API_KEY`: 默认API密钥（可选，当请求中没有提供API key时使用）
- `LOG_LEVEL`: 日志级别（默认: info，可选: debug, info）
  - `info`: 显示基本的请求信息和状态
  - `debug`: 显示完整的请求/响应头部和内容（用于调试）
- `TARGET_API_URL`: 目标API URL（默认: https://api.packycode.com/v1/messages?beta=true）

你可以创建一个 `.env` 文件来配置这些变量：
```bash
cp .env.example .env
# 然后编辑 .env 文件设置你的配置
```

## 使用方法

### 基本用法

将你的Anthropic API客户端的基础URL改为你的代理服务器地址：

```javascript
// 原来的配置
const client = new Anthropic({
  apiKey: 'your-api-key',
  baseURL: 'https://api.anthropic.com'
});

// 修改为代理服务器
const client = new Anthropic({
  apiKey: 'your-api-key',
  baseURL: 'http://localhost:3000'  // 你的代理服务器地址
});
```

### curl 示例

#### Claude 3.5 Haiku 模型请求
```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-3-5-haiku-20241022",
    "max_tokens": 1024,
    "messages": [
      {
        "role": "user",
        "content": "Hello, Claude 3.5 Haiku!"
      }
    ]
  }'
```

#### Claude Sonnet 4 模型请求
```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [
      {
        "role": "user",
        "content": "Hello, Claude Sonnet 4!"
      }
    ]
  }'
```

#### 其他模型请求
```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1024,
    "messages": [
      {
        "role": "user",
        "content": "Hello, Claude 3.5 Sonnet!"
      }
    ]
  }'
```

#### 流式请求示例
```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "stream": true,
    "messages": [
      {
        "role": "user",
        "content": "Tell me a story!"
      }
    ]
  }'
```

#### 使用默认API密钥的请求
如果你在环境变量中配置了 `DEFAULT_API_KEY`，可以省略请求头中的API密钥：
```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [
      {
        "role": "user",
        "content": "Hello without explicit API key!"
      }
    ]
  }'
```

## 智能请求检测

代理服务器会自动检测请求体中的关键字段，并根据内容调整请求头：

### 模型检测
- **Claude 3.5 Haiku 模型**：当 `model` 字段为 `claude-3-5-haiku-20241022` 时
  - 使用标准的 `anthropic-beta` 头部：`fine-grained-tool-streaming-2025-05-14`
  - 适用于快速响应场景

- **其他所有模型**：包括 Claude Sonnet 4、Claude 3.5 Sonnet 等
  - 使用增强的 `anthropic-beta` 头部：`claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14`
  - 支持代码生成、上下文扩展和交互式思考功能

### 流式请求检测
- **流式请求**：当请求体中 `stream: true` 时
  - 添加 `x-stainless-helper-method: stream` 头部
  - 启用流式响应处理

- **非流式请求**：当 `stream` 为 `false` 或未设置时
  - 不添加流式相关头部
  - 使用标准响应处理

## API 端点

- `POST /v1/messages` - 代理消息请求到Packycode API
- `OPTIONS /v1/messages` - CORS预检请求

## 错误处理

- `401 Unauthorized` - 缺少API密钥
- `404 Not Found` - 不支持的端点
- `405 Method Not Allowed` - 不支持的HTTP方法
- `500 Internal Server Error` - 代理请求失败

## 开发

### 项目结构

```
max2api/
├── src/
│   └── index.ts          # 主服务器文件
├── package.json          # 项目配置
├── tsconfig.json         # TypeScript配置
└── README.md            # 项目文档
```

### 代码说明

- `extractApiKey()` - 从请求头中提取API密钥，支持默认密钥回退
- `isClaudeHaikuModel()` - 检测是否为Claude 3.5 Haiku模型
- `transformHeaders()` - 根据模型类型和流式设置将Anthropic格式的请求头转换为Packycode格式
- `proxyRequest()` - 处理代理请求逻辑，包括模型检测、流式检测和请求转换
- `Bun.serve()` - 创建HTTP服务器
- `logger` - 可配置的日志记录器
- `CONFIG` - 集中的配置管理对象

## 许可证

MIT License
