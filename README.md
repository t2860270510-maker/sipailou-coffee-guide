# 四牌楼咖啡指北

一个面向四牌楼校区周边学生的场景化咖啡选择网页。首屏是对话式输入，MiniMax 会在聊天窗口里流式返回 2 家更合适的店；向下滚动是编辑式咖啡指南。

## Run

1. 准备 Node.js 20+。
2. 安装依赖：`npm install`
3. 复制环境变量模板：`cp .env.example .env.local`
4. 在 `.env.local` 中填写你的 `MINIMAX_API_KEY`
5. 启动开发环境：`npm run dev`

## Scripts

- `npm run dev`：本地开发
- `npm run build`：生产构建
- `npm run preview`：本地用 Cloudflare Workers 运行生产预览
- `npm run deploy`：构建并部署到 Cloudflare Workers
- `npm run start`：启动生产环境
- `npm test`：运行推荐逻辑测试

## Deploy

- Vercel：最推荐，原生支持 Next.js App Router 和 `/api/recommend`。导入仓库或直接部署这个目录后，只需要配置 `MINIMAX_API_KEY` 即可。
- Netlify：支持，但更适合“导入仓库并构建”，不建议只靠手动拖文件夹做静态托管，因为这个项目包含服务端 API 路由。
- Cloudflare：支持，使用 OpenNext 适配器部署到 Workers。这个项目不是静态导出站点，应该按 Worker/OpenNext 方式部署。
- Node 版本固定为 `20.x`，项目根目录有 [`.nvmrc`](/Users/tht/Documents/New project/.nvmrc) 和 `package.json` 的 `engines` 配置。
- 如果使用 Netlify，请在站点设置里添加 `MINIMAX_API_KEY`，并保留根目录的 [`netlify.toml`](/Users/tht/Documents/New project/netlify.toml)。
- 如果使用 Vercel，请在项目环境变量里添加 `MINIMAX_API_KEY`。默认会连 `https://api.minimaxi.com/anthropic`，模型优先 `MiniMax-M2.7`，必要时回退到 `MiniMax-M2.5`。
- 如果使用 Cloudflare，请在仓库保持 [`next.config.mjs`](/Users/tht/Documents/New project/next.config.mjs)、[`open-next.config.ts`](/Users/tht/Documents/New project/open-next.config.ts) 和 [`wrangler.jsonc`](/Users/tht/Documents/New project/wrangler.jsonc) 这 3 个文件，并在项目环境变量里添加 `MINIMAX_API_KEY`。

## Cloudflare

1. 在 Cloudflare 中连接这个 GitHub 仓库。
2. 不要再使用 `npx wrangler deploy` 作为 Git 部署命令。
3. 将部署命令设置为 `npm run deploy`。
4. 如果界面要求单独填写构建命令，也使用 `npm run deploy`，让 OpenNext 统一负责构建和部署。
5. 在 Cloudflare 项目环境变量中添加 `MINIMAX_API_KEY`；如需覆盖默认模型，也可一并设置 `MINIMAX_BASE_URL`、`MINIMAX_MODEL`、`MINIMAX_FALLBACK_MODELS`。
6. 本地预览时可复制 [`.dev.vars.example`](/Users/tht/Documents/New project/.dev.vars.example) 为 `.dev.vars`，再运行 `npm run preview`。

Cloudflare 部署的关键点：

- 这是 Next.js App Router + Worker/OpenNext 项目，不要改成静态导出。
- `lib/minimax.ts` 使用的 `node:crypto` 由 `wrangler.jsonc` 中的 `nodejs_compat` 提供兼容。
- `public/_headers` 已为 `/_next/static/*` 配置长期缓存头。

## Notes

- 前端不会直接暴露 API key，模型请求统一走 `/api/recommend`。
- 当前接入的是“API 调模型直接流式生成聊天回复”的链路，默认优先使用 `MiniMax-M2.7`。
- `MiniMax-M2.7` 需要 Token Plan Key；如果你使用的是普通接口 Key，请把 `MINIMAX_MODEL` 改成 `MiniMax-M2.5`，或保留默认回退配置 `MINIMAX_FALLBACK_MODELS=MiniMax-M2.5`。
- 如果 MiniMax 临时超时、返回格式不稳定或没有配置 API Key，接口会直接返回错误提示，不再回退到本地推荐逻辑。
- 提示词与模型润色逻辑定义在 `lib/minimax-prompts.ts` 和 `lib/minimax.ts`。
