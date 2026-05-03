# KKOCLAW 前端

为 KKOCLAW 提供一个简洁易用的网页界面，采用现代化灵活的架构。

## 技术栈

- **框架**: [Next.js 16](https://nextjs.org/) with [App Router](https://nextjs.org/docs/app)
- **UI**: [React 19](https://react.dev/), [Tailwind CSS 4](https://tailwindcss.com/), [Shadcn UI](https://ui.shadcn.com/), [MagicUI](https://magicui.design/) and [React Bits](https://reactbits.dev/)
- **AI 集成**: [LangGraph SDK](https://www.npmjs.com/package/@langchain/langgraph-sdk) and [Vercel AI Elements](https://vercel.com/ai-sdk/ai-elements)

## 快速开始

### 前置条件

- Node.js 22+
- pnpm 10.26.2+

### 安装

```bash
pnpm install
cp .env.example .env
```

### 开发

```bash
pnpm dev        # http://localhost:9192
```

### 构建与测试

```bash
pnpm typecheck  # 类型检查
pnpm lint       # Lint
pnpm test       # 单元测试
pnpm test:e2e   # E2E 测试
pnpm build      # 生产构建
pnpm start      # 生产服务器
```

## 站点地图

```
├── /                    # 登录页
├── /chats               # 对话列表
├── /chats/new           # 新对话页
└── /chats/[thread_id]   # 特定对话页
```

## 项目结构

```
src/
├── app/                    # Next.js App Router 页面
├── components/             # React 组件
│   ├── ui/                 # 可复用 UI 组件
│   ├── workspace/          # 工作区特定组件
│   ├── landing/            # 登录页组件
│   └── ai-elements/        # AI 相关 UI 元素
├── core/                   # 核心业务逻辑
│   ├── api/                # API 客户端与数据获取
│   ├── threads/            # 线程管理
│   ├── skills/             # 技能系统
│   ├── mcp/                # MCP 集成
│   ├── messages/           # 消息处理
│   ├── models/             # 数据模型与类型
│   └── settings/           # 用户设置
├── hooks/                  # 自定义 React hooks
├── lib/                    # 共享库与工具
└── styles/                 # 全局样式
```

## 许可证

MIT License. 详见 [LICENSE](../LICENSE).
