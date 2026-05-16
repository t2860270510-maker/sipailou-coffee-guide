# 四牌楼咖啡指北

一个面向四牌楼校区周边学生的场景化咖啡选择网页。首屏是对话式输入，DeepSeek 会在聊天窗口里流式返回 2 家更合适的店；向下滚动是编辑式咖啡指南。

## Run

1. 准备 Node.js 20+。
2. 安装依赖：`npm install`
3. 复制环境变量模板：`cp .env.example .env.local`
4. 在 `.env.local` 中填写你的 `DEEPSEEK_API_KEY`、高德 Web 服务 `AMAP_WEB_KEY`，以及前端地图用的 `NEXT_PUBLIC_AMAP_JS_KEY` / `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE`
5. 启动开发环境：`npm run dev`

## Scripts

- `npm run dev`：本地开发
- `npm run build`：生产构建
- `npm run preview`：本地用 Cloudflare Workers 运行生产预览
- `npm run deploy`：构建并部署到 Cloudflare Workers
- `npm run start`：启动生产环境
- `npm test`：运行推荐逻辑测试

## Deploy

- Vercel：最推荐，原生支持 Next.js App Router 和 `/api/recommend`。导入仓库或直接部署这个目录后，需要配置 `DEEPSEEK_API_KEY`、`AMAP_WEB_KEY`、`NEXT_PUBLIC_AMAP_JS_KEY` 和 `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE`。
- Netlify：支持，但更适合“导入仓库并构建”，不建议只靠手动拖文件夹做静态托管，因为这个项目包含服务端 API 路由。
- Cloudflare：支持，使用 OpenNext 适配器部署到 Workers。这个项目不是静态导出站点，应该按 Worker/OpenNext 方式部署。
- Node 版本固定为 `20.x`，项目根目录有 [`.nvmrc`](/Users/tht/Documents/New project/.nvmrc) 和 `package.json` 的 `engines` 配置。
- 如果使用 Netlify，请在站点设置里添加 `DEEPSEEK_API_KEY`、`AMAP_WEB_KEY`、`NEXT_PUBLIC_AMAP_JS_KEY` 和 `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE`，并保留根目录的 [`netlify.toml`](/Users/tht/Documents/New project/netlify.toml)。
- 如果使用 Vercel，请在项目环境变量里添加 `DEEPSEEK_API_KEY`、`AMAP_WEB_KEY`、`NEXT_PUBLIC_AMAP_JS_KEY` 和 `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE`。默认会连 DeepSeek Anthropic 兼容接口 `https://api.deepseek.com/anthropic`，模型为 `deepseek-v4-flash`。
- 如果使用 Cloudflare，请在仓库保持 [`next.config.mjs`](/Users/tht/Documents/New project/next.config.mjs)、[`open-next.config.ts`](/Users/tht/Documents/New project/open-next.config.ts) 和 [`wrangler.jsonc`](/Users/tht/Documents/New project/wrangler.jsonc) 这 3 个文件，并在项目环境变量里添加 `DEEPSEEK_API_KEY`、`AMAP_WEB_KEY`、`NEXT_PUBLIC_AMAP_JS_KEY` 和 `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE`。

## Cloudflare

1. 在 Cloudflare 中连接这个 GitHub 仓库。
2. 不要再使用 `npx wrangler deploy` 作为 Git 部署命令。
3. 将部署命令设置为 `npm run deploy`。
4. 如果界面要求单独填写构建命令，也使用 `npm run deploy`，让 OpenNext 统一负责构建和部署。
5. 在 Cloudflare 项目环境变量中添加 `DEEPSEEK_API_KEY`、`AMAP_WEB_KEY`、`NEXT_PUBLIC_AMAP_JS_KEY` 和 `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE`；如需覆盖默认模型，也可一并设置 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、`DEEPSEEK_FALLBACK_MODELS`。
6. 本地预览时可复制 [`.dev.vars.example`](/Users/tht/Documents/New project/.dev.vars.example) 为 `.dev.vars`，再运行 `npm run preview`。

Cloudflare 部署的关键点：

- 这是 Next.js App Router + Worker/OpenNext 项目，不要改成静态导出。
- `lib/deepseek.ts` 使用的 `node:crypto` 由 `wrangler.jsonc` 中的 `nodejs_compat` 提供兼容。
- `public/_headers` 已为 `/_next/static/*` 配置长期缓存头。

## Notes

- 前端不会直接暴露模型 API key，模型请求统一走 `/api/recommend`。
- 高德 Web 服务 key 只在服务端 `/api/distances` 中使用，用于根据当前位置计算步行距离。
- 店铺展示页的小地图使用高德 Web端(JS API) key：`NEXT_PUBLIC_AMAP_JS_KEY` 会随前端包公开，建议在高德开放平台为该 key 配置域名白名单，并同时配置 `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE`。
- 当前接入的是“API 调模型直接流式生成聊天回复”的链路，默认使用 DeepSeek Anthropic 兼容接口和 `deepseek-v4-flash`。
- 如果 DeepSeek 临时超时、返回格式不稳定或没有配置 API Key，接口会直接返回错误提示，不再回退到本地推荐逻辑。
- 提示词与模型润色逻辑定义在 `lib/deepseek-prompts.ts` 和 `lib/deepseek.ts`。
- 旧的 `MINIMAX_*` / `ANTHROPIC_*` 环境变量仍可作为兼容回退使用；新配置建议统一使用 `DEEPSEEK_*`。
