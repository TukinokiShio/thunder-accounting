# 雷霆记账 — 项目文档

## 产品概述

| 项目 | 说明 |
|------|------|
| **产品名称** | 雷霆记账 |
| **产品定位** | 轻量级个人日常记账工具 |
| **目标平台** | Windows 10+ / macOS 12+ |
| **货币单位** | 人民币（¥） |
| **核心理念** | 3秒完成一笔记账，分类清晰，统计直观 |

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 框架 | Electron 30+ | 跨平台桌面壳 |
| 前端 | React 18 + TypeScript | UI 层 |
| 构建 | Vite 5 | 开发与打包 |
| 样式 | TailwindCSS 3 + shadcn/ui | 原子化 CSS + 组件库 |
| 数据库 | sql.js | 纯 JS/WASM 实现的 SQLite，无需原生编译 |
| 图表 | Recharts | 饼图、折线图 |
| 状态管理 | Zustand | 轻量全局状态 |
| 打包 | electron-builder | 生成 Windows/macOS 安装包 |
| 构建工具 | electron-vite | 统一管理主进程/preload/渲染进程构建 |

## 项目结构

```
记账app/
├── CLAUDE.md                  # 本文件
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
├── electron.vite.config.mjs   # electron-vite 配置
├── tailwind.config.ts
├── postcss.config.js
├── index.html
├── main-process/              # Electron 主进程
│   ├── main.ts                # 主进程入口，窗口管理
│   ├── preload.ts             # 预加载脚本，暴露 IPC API
│   └── database.ts            # SQLite 数据库（sql.js）
├── src/                       # React 渲染进程
│   ├── main.tsx               # React 入口
│   ├── App.tsx                # 根组件，路由
│   ├── index.css              # TailwindCSS 入口
│   ├── types/                 # TypeScript 类型定义
│   │   └── index.ts           # Bill, Category 等类型
│   ├── store/                 # Zustand 状态管理
│   │   └── index.ts           # 全局 store
│   ├── data/                  # 预设数据
│   │   └── categories.ts      # 预设分类数据
│   ├── components/            # 通用组件
│   │   ├── ui/                # shadcn/ui 组件
│   │   ├── Layout.tsx         # 主布局（侧边栏 + 内容区）
│   │   ├── Sidebar.tsx        # 侧边导航
│   │   ├── AddBillDialog.tsx  # 记一笔弹窗
│   │   └── CategorySelect.tsx # 二级分类联动选择器
│   └── pages/                 # 页面
│       ├── Home.tsx           # 首页 / 仪表盘
│       ├── Bills.tsx          # 账单列表
│       └── Stats.tsx          # 统计概览
└── resources/                 # 应用图标等静态资源
```

## 数据模型

### Bill（账单记录）

```typescript
interface Bill {
  id: number;           // 自增主键
  amount: number;       // 金额（元，正数）
  category1: string;    // 一级分类名称
  category2: string;    // 二级分类名称
  date: string;         // 日期 ISO 8601 (YYYY-MM-DD)
  note: string;         // 备注（可选，默认空字符串）
  created_at: string;   // 创建时间 ISO 8601
}
```

### Category（分类）

```typescript
interface Category {
  name: string;         // 一级分类名称
  icon: string;         // Emoji 图标
  children: string[];   // 二级分类名称列表
}
```

### SQLite 表结构

```sql
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount REAL NOT NULL,
  category1 TEXT NOT NULL,
  category2 TEXT NOT NULL,
  date TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bills_date ON bills(date);
CREATE INDEX IF NOT EXISTS idx_bills_category1 ON bills(category1);
```

## 预设分类数据

见 `src/data/categories.ts`，10 个一级大类，共 57 个二级小类：
餐饮食品、交通出行、购物消费、住房物业、医疗健康、教育学习、娱乐休闲、人情往来、金融保险、其他杂项。

## IPC API（主进程 ↔ 渲染进程）

通过 preload.ts 暴露 `window.electronAPI`：

```typescript
interface ElectronAPI {
  // 账单 CRUD
  addBill(bill: Omit<Bill, 'id' | 'created_at'>): Promise<Bill>;
  getBills(filters?: { startDate?: string; endDate?: string; category1?: string }): Promise<Bill[]>;
  updateBill(id: number, bill: Partial<Bill>): Promise<Bill>;
  deleteBill(id: number): Promise<void>;
  // 统计
  getStats(params: { startDate: string; endDate: string }): Promise<StatsResult>;
  // 导出
  exportCSV(filters?: { startDate?: string; endDate?: string }): Promise<string>;
}
```

## 开发命令

```bash
npm install           # 安装依赖
npm run dev           # 启动开发服务器（Vite + Electron 热重载）
npm run build         # 构建生产版本
npm run dist:win      # 打包 Windows 安装包
npm run dist:mac      # 打包 macOS 安装包
```

## 设计原则

1. **简洁优先** — UI 不花哨，记账流程不超过 3 步
2. **数据本地** — 所有数据存储在本地 SQLite，无需网络
3. **分类可配** — 预设分类可增删改，用户可自定义
4. **响应式** — 窗口尺寸自适应，最小支持 900×600
5. **代码规范** — TypeScript 严格模式，组件单一职责
