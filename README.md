# ⚡ 雷霆记账

> 轻量级个人日常记账工具 — 3 秒完成一笔记账，分类清晰，统计直观

[![License](https://img.shields.io/github/license/TukinokiShio/thunder-accounting)](./LICENSE)
[![Version](https://img.shields.io/badge/version-1.7.1-blue)](./package.json)

---

## ✨ 功能

- **极速记账** — 弹窗式记账，3 步完成：选分类 → 输金额 → 确认，支持 Enter 提交 / Escape 关闭
- **支出 / 收入双模式** — 支持支出和收入记录，收支结余一目了然
- **二级分类** — 11 个支出预设大类 + 6 个收入预设大类，支持 61+ 个二级小类
- **自定义分类管理** — 自由增删改分类，拖拽排序持久化，可选择 emoji 图标
- **全局快捷键** — 按 `Ctrl+N` / `Cmd+N` 随时随地快速记账
- **数据统计** — 环形图展示分类占比，折线图展示消费趋势，二级分类下钻环形图
- **账单列表** — 多维度筛选（时间段/分类/类型），前端搜索，编辑删除，汇总行
- **CSV 导出** — 一键导出账单数据（UTF-8 BOM，防 CSV 注入）
- **用户认证** — 邮箱密码注册/登录，会话持久化，密码修改，记住账号
- **云同步** — 基于腾讯云 CloudBase，账单和分类自动后台同步（可选）
- **JSON 备份/恢复** — 支持全部数据导出导入，事务保护
- **中英双语** — 界面支持中文 / English 一键切换，偏好本地持久化
- **暗色模式** — 支持亮色/暗色主题自动适配
- **本地存储** — 基于 SQLite（WAL 模式），数据完全本地，离线可用
- **跨平台** — 支持 Windows 10+ / macOS 12+

## 🖥️ 截图

*（运行 `npm run dev` 启动后截图替换此处）*

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Electron 30+ |
| 前端 | React 18 + TypeScript |
| 构建 | Vite 5 + electron-vite |
| 样式 | TailwindCSS 3 + shadcn/ui |
| 图表 | Recharts |
| 数据库 | sql.js（纯 JS/WASM 实现的 SQLite） |
| 状态管理 | Zustand |
| 打包 | electron-builder |

## 🚀 快速开始

### 环境要求

- Node.js 18+
- npm 9+

### 安装

```bash
git clone https://github.com/TukinokiShio/thunder-accounting.git
cd thunder-accounting
npm install
```

### 开发

```bash
npm run dev          # 启动开发服务器（Vite + Electron 热重载）
```

### 构建 & 打包

```bash
npm run build        # 构建生产版本
npm run dist:win     # 打包 Windows 安装包（.exe）
npm run dist:mac     # 打包 macOS 安装包（.dmg）
npm run deploy       # 一键部署：版本号递增 → 构建 → 打包 → 输出到指定目录
```

### 测试与提交质量门禁

```bash
npm test             # 全量单元测试（Vitest）
```

本仓库配置了 **git commit 质量门禁**（Claude Code PreToolUse hook）：

- 提交前必须通过双重检查——**单元测试全量通过** + **质量审查无严重问题**，两项检查各自生成通过标记后 commit 才会放行
- 标记与工作区内容指纹（stateHash）绑定：检查后再改任何文件，标记自动失效，须重新检查
- 在 Claude Code 中使用 `/gitcommit` 命令一键完成「并行双检 → 自动修复 → 提交」流程
- 相关文件：`.claude/hooks/quality-gate.cjs`（门禁脚本）、`.claude/settings.json`（hook 配置）、`.claude/commands/gitcommit.md`（提交流程）

## 📁 项目结构

```
thunder-accounting/
├── main-process/            # Electron 主进程
│   ├── main.ts              # 窗口管理 & IPC 注册
│   ├── preload.ts           # contextBridge IPC 桥接（24 个方法）
│   ├── database.ts          # SQLite 数据库操作 & 迁移
│   └── cloudbase.ts         # 腾讯云 CloudBase 云同步
├── src/                     # React 渲染进程
│   ├── main.tsx             # 入口
│   ├── App.tsx              # 根组件 & 路由 & 快捷键
│   ├── types/               # TypeScript 类型定义
│   ├── store/               # Zustand 全局状态
│   ├── data/                # 预设分类数据
│   ├── i18n/                # 国际化（中英双语 ~193 词条）
│   ├── utils/               # 工具函数
│   ├── components/          # 通用组件
│   │   ├── ui/              # shadcn/ui 基础组件
│   │   ├── Layout.tsx       # 主布局（含同步状态指示器）
│   │   ├── Sidebar.tsx      # 侧边导航
│   │   ├── AddBillDialog.tsx # 记账弹窗
│   │   ├── CategoryManager.tsx # 分类管理（拖拽排序）
│   │   ├── SettingsDialog.tsx # 设置弹窗
│   │   ├── AuthGuard.tsx    # 登录路由守卫
│   │   └── ...              # EmojiPicker, Toast, ConfirmDialog 等
│   └── pages/               # 页面
│       ├── Home.tsx         # 首页仪表盘
│       ├── Bills.tsx        # 账单列表
│       ├── Stats.tsx        # 统计概览
│       └── Login.tsx        # 登录/注册
├── resources/               # 应用图标
├── scripts/                 # 部署脚本
├── package.json
├── electron.vite.config.mjs
└── README.md
```

## 📦 下载

前往 [Releases](https://github.com/TukinokiShio/thunder-accounting/releases) 下载最新版安装包。

## 📄 开源协议

[MIT](./LICENSE) © TukinokiShio
