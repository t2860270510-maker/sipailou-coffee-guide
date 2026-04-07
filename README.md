# 四牌楼咖啡指北

一个面向四牌楼校区周边学生的场景化咖啡选择网页。首屏是对话式输入，MiniMax 会在聊天窗口里直接返回 2 家更适合的店；向下滚动是编辑式咖啡指南。

## Run

1. 准备 Node.js 20+。
2. 安装依赖：`npm install`
3. 复制环境变量模板：`cp .env.example .env.local`
4. 在 `.env.local` 中填写你的 `MINIMAX_API_KEY`
5. 启动开发环境：`npm run dev`

## Scripts

- `npm run dev`：本地开发
- `npm run build`：生产构建
- `npm run start`：启动生产环境
- `npm test`：运行推荐逻辑测试

## Deploy

- Vercel：最推荐，原生支持 Next.js App Router 和 `/api/recommend`。导入仓库或直接部署这个目录后，只需要配置 `MINIMAX_API_KEY` 即可。
- Netlify：支持，但更适合“导入仓库并构建”，不建议只靠手动拖文件夹做静态托管，因为这个项目包含服务端 API 路由。
- Node 版本固定为 `20.x`，项目根目录有 [`.nvmrc`](/Users/tht/Documents/New project/.nvmrc) 和 `package.json` 的 `engines` 配置。
- 如果使用 Netlify，请在站点设置里添加 `MINIMAX_API_KEY`，并保留根目录的 [`netlify.toml`](/Users/tht/Documents/New project/netlify.toml)。
- 如果使用 Vercel，请在项目环境变量里添加 `MINIMAX_API_KEY`。默认会连 `https://api.minimaxi.com/anthropic`，模型优先 `MiniMax-M2.7`，必要时回退到 `MiniMax-M2.5`。

## Notes

- 前端不会直接暴露 API key，模型请求统一走 `/api/recommend`。
- 当前接入的是“API 调模型直接选店并生成说明”的链路，默认优先使用 `MiniMax-M2.7`。
- `MiniMax-M2.7` 需要 Token Plan Key；如果你使用的是普通接口 Key，请把 `MINIMAX_MODEL` 改成 `MiniMax-M2.5`，或保留默认回退配置 `MINIMAX_FALLBACK_MODELS=MiniMax-M2.5`。
- 如果 MiniMax 临时超时、返回格式不稳定或没有配置 API Key，接口会直接返回错误提示，不再回退到本地推荐逻辑。
- 提示词与模型润色逻辑定义在 `lib/minimax-prompts.ts` 和 `lib/minimax.ts`。
