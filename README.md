# ⚡ 雷霆记账

> 轻量级个人日常记账工具 — 3 秒完成一笔记账，分类清晰，统计直观

[![License](https://img.shields.io/github/license/TukinokiShio/thunder-accounting)](./LICENSE)
[![Version](https://img.shields.io/badge/version-1.3.0-blue)](./package.json)

---

## ✨ 功能

- **极速记账** — 弹窗式记账，3 步完成：选分类 → 输金额 → 确认
- **支出 / 收入双模式** — 支持支出和收入记录，收支结余一目了然
- **二级分类** — 10 个一级大类，57 个二级小类，分类精准
- **数据统计** — 饼图展示分类占比，折线图展示消费趋势，双环形图对比收支结构
- **账单列表** — 按月份筛选，支持编辑和删除
- **CSV 导出** — 一键导出账单数据
- **本地存储** — 基于 SQLite，数据完全本地，无需网络
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

## 📁 项目结构

```
thunder-accounting/
├── main-process/            # Electron 主进程
│   ├── main.ts              # 窗口管理 & 生命周期
│   ├── preload.ts           # IPC 桥接层
│   └── database.ts          # SQLite 数据库操作
├── src/                     # React 渲染进程
│   ├── main.tsx             # 入口
│   ├── App.tsx              # 根组件 & 路由
│   ├── types/               # TypeScript 类型定义
│   ├── store/               # Zustand 全局状态
│   ├── data/                # 预设分类数据
│   ├── components/          # 通用组件
│   │   ├── ui/              # shadcn/ui 基础组件
│   │   ├── Layout.tsx       # 主布局
│   │   ├── Sidebar.tsx      # 侧边导航
│   │   ├── AddBillDialog.tsx # 记账弹窗
│   │   └── CategorySelect.tsx # 分类选择器
│   └── pages/               # 页面
│       ├── Home.tsx         # 首页 / 仪表盘
│       ├── Bills.tsx        # 账单列表
│       └── Stats.tsx        # 统计概览
├── resources/               # 应用图标等静态资源
├── scripts/                 # 部署脚本
├── package.json
└── electron.vite.config.mjs
```

## 📦 下载

前往 [Releases](https://github.com/TukinokiShio/thunder-accounting/releases) 下载最新版安装包。

## 📄 开源协议

[MIT](./LICENSE) © TukinokiShio
