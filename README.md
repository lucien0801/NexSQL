# NexSQL

<p align="center">
  <b>Open-Source Database Client with AI, SQL Editor, and Data Grid</b>
</p>

<p align="center">
  <a href="#english">English</a> | <a href="#中文">中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" />
  <img src="https://img.shields.io/badge/electron-33-47848F.svg" alt="Electron 33" />
  <img src="https://img.shields.io/badge/react-18-61DAFB.svg" alt="React 18" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg" alt="Cross-platform" />
</p>

---

## English

NexSQL is a cross-platform desktop database client built with Electron and React.
It combines SQL workflow, table data editing, and AI-assisted query generation in one app.

### Highlights

- Multi-database support: MySQL, PostgreSQL, SQL Server (MSSQL), SQLite
- AI-assisted SQL generation (OpenAI-compatible APIs and local Ollama)
- Monaco editor with SQL autocomplete and selected-text execution
- Table data tab with filtering, sorting, pagination, and staged CRUD
- Row actions: copy INSERT SQL, copy UPDATE SQL, copy CSV
- Export SQL to file and export table data to CSV
- Schema explorer + table designer (columns, indexes, DDL preview)
- Connection organization via groups/tags and optional SSH tunnel
- Query history and encrypted local credential storage
- App settings: language (EN/ZH), theme, font size

### Architecture

| Layer | Technology |
|---|---|
| Desktop shell | Electron + electron-vite |
| UI | React + TypeScript + Tailwind CSS |
| Editor | Monaco Editor |
| Data grid | TanStack Table + virtualization |
| State | Zustand |
| Local storage | better-sqlite3 |
| DB drivers | mysql2, pg, mssql, better-sqlite3 |

### Quick Start

Prerequisites:

- Node.js >= 18
- pnpm >= 6

```bash
git clone https://github.com/<your-org>/NexSQL.git
cd NexSQL

pnpm install
pnpm dev
```

### Build

```bash
pnpm build
pnpm build:win
pnpm build:mac
pnpm build:linux
```

Build outputs are under `apps/desktop/dist/`.

### Scripts

At repository root:

- `pnpm dev` - start desktop app in development mode
- `pnpm build` - build desktop app
- `pnpm lint` - run lint across workspaces
- `pnpm typecheck` - run TypeScript checks across workspaces

### Project Structure

```text
NexSQL/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── main/      # Electron main process (DB drivers, IPC, services)
│       │   ├── preload/   # Bridge API exposed to renderer
│       │   └── renderer/  # React application
│       └── electron-builder.yml
└── packages/
    └── shared/            # Shared TypeScript types
```

### AI Setup

Open AI settings in the app and configure one provider:

- OpenAI
- OpenAI-compatible endpoint (DeepSeek, Qwen, Moonshot, etc.)
- Ollama local model

### Contributing

Issues and pull requests are welcome.

### License

MIT. See [LICENSE](LICENSE).

---

## 中文

NexSQL 是一个基于 Electron + React 的跨平台桌面数据库客户端。
它将 SQL 编辑、表数据管理和 AI 辅助查询整合到一个应用中。

### 核心能力

- 多数据库支持：MySQL、PostgreSQL、SQL Server（MSSQL）、SQLite
- AI 辅助写 SQL（支持 OpenAI 兼容接口与本地 Ollama）
- Monaco 编辑器：SQL 自动补全、仅执行选中 SQL
- 表数据标签页：筛选、排序、分页、暂存式 CRUD
- 行级快捷操作：复制 INSERT SQL、UPDATE SQL、CSV
- SQL 保存为文件、表数据导出 CSV
- 结构浏览与表设计器（列、索引、DDL 预览）
- 连接分组/标签管理，支持 SSH 隧道
- 查询历史、本地凭据加密存储
- 应用设置：中英文、主题、字体大小

### 技术栈

| 层级 | 技术 |
|---|---|
| 桌面容器 | Electron + electron-vite |
| 前端 | React + TypeScript + Tailwind CSS |
| 编辑器 | Monaco Editor |
| 数据表格 | TanStack Table + 虚拟滚动 |
| 状态管理 | Zustand |
| 本地存储 | better-sqlite3 |
| 数据库驱动 | mysql2、pg、mssql、better-sqlite3 |

### 快速开始

前置要求：

- Node.js >= 18
- pnpm >= 6

```bash
git clone https://github.com/AllenZhanga/NexSQL.git
cd NexSQL

pnpm install
pnpm dev
```

### 构建发布

```bash
pnpm build
pnpm build:win
pnpm build:mac
pnpm build:linux
```

构建产物目录：`apps/desktop/dist/`。

### 常用脚本

仓库根目录：

- `pnpm dev` - 启动开发模式
- `pnpm build` - 构建桌面应用
- `pnpm lint` - 运行多包 lint
- `pnpm typecheck` - 运行多包 TypeScript 校验

### 目录结构

```text
NexSQL/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── main/      # 主进程（驱动、IPC、服务）
│       │   ├── preload/   # 渲染进程桥接 API
│       │   └── renderer/  # React 界面
│       └── electron-builder.yml
└── packages/
    └── shared/            # 共享类型
```

### AI 配置

在应用内打开 AI 设置，选择并配置一个提供方：

- OpenAI
- 兼容 OpenAI 协议的服务（如 DeepSeek、通义千问、Moonshot）
- 本地 Ollama 模型

### 参与贡献

欢迎提交 Issue 和 Pull Request。

### 许可证

MIT，详见 [LICENSE](LICENSE)。

