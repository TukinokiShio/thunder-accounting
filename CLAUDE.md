# 雷霆记账 — 项目文档

> v1.7.2 | 最后更新：2026-07-26

## 产品概述

| 项目 | 说明 |
|------|------|
| **产品名称** | 雷霆记账 (Thunder Books) |
| **产品定位** | 轻量级个人日常记账工具 |
| **目标平台** | Windows 10+ / macOS 12+ |
| **货币单位** | 人民币（¥） |
| **核心理念** | 3秒完成一笔记账，分类清晰，统计直观 |
| **GitHub** | https://github.com/TukinokiShio/thunder-accounting |

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 框架 | Electron 33+ | 跨平台桌面壳 |
| 前端 | React 18 + TypeScript | UI 层 |
| 构建 | Vite 5 + electron-vite | 统一管理主进程/preload/渲染进程 |
| 样式 | TailwindCSS 3 + shadcn/ui | 原子化 CSS + 组件库 |
| 数据库 | sql.js (WASM SQLite) | 无需原生编译，WAL 模式 |
| 图表 | Recharts | 饼图、环形图、折线图 |
| 状态管理 | Zustand | 轻量全局状态 |
| 图标 | lucide-react | 矢量图标库 |
| 云服务 | @cloudbase/node-sdk | 腾讯云 CloudBase 认证与同步 |
| 打包 | electron-builder | NSIS 安装包 |

## 项目结构

```
记账app/
├── CLAUDE.md                     # 本文件（AI 项目文档）
├── package.json
├── electron.vite.config.mjs      # electron-vite 配置
├── index.html
├── main-process/                 # Electron 主进程
│   ├── main.ts                   # 窗口管理，IPC 注册，应用菜单，快捷键
│   ├── preload.ts                # contextBridge 暴露 24 个 IPC 方法
│   ├── database.ts               # SQLite CRUD、迁移、统计导出
│   ├── cloudbase.ts              # 腾讯云 CloudBase 云同步
│   └── sql.js.d.ts               # sql.js 类型声明
├── src/                          # React 渲染进程
│   ├── main.tsx                  # React 入口（错误捕获）
│   ├── App.tsx                   # 根组件（路由、登录检查、快捷键监听）
│   ├── index.css                 # TailwindCSS 入口
│   ├── types/index.ts            # Bill, Category 等类型
│   ├── store/index.ts            # Zustand 全局状态
│   ├── data/categories.ts        # 预设分类（11 支出 + 6 收入）
│   ├── i18n/                     # 国际化
│   │   ├── LanguageContext.tsx    # 语言 Context + Provider
│   │   └── translations.ts       # 中英映射（~193 词条）
│   ├── utils/                    # 工具函数
│   │   ├── settings.ts           # 偏好设置持久化
│   │   ├── date.ts               # 日期工具
│   │   └── errorMessages.ts      # 错误信息友好化
│   ├── pages/
│   │   ├── Home.tsx              # 首页仪表盘（6 统计卡片 + Top5 分类）
│   │   ├── Bills.tsx             # 账单列表（多维度筛选 + 搜索 + 编辑）
│   │   ├── Stats.tsx             # 统计图表（环形图 + 折线图 + 明细表）
│   │   └── Login.tsx             # 登录/注册（邮箱密码 + 校验 + 语言切换）
│   └── components/
│       ├── ui/                   # shadcn/ui 基础组件
│       ├── Layout.tsx            # 主布局（侧边栏 + 顶栏 + 同步状态）
│       ├── Sidebar.tsx           # 侧边导航栏
│       ├── AddBillDialog.tsx     # 记账弹窗（新增 + 编辑复用）
│       ├── CategoryManager.tsx   # 分类管理（拖拽排序 + 增删改）
│       ├── CategorySelect.tsx    # 二级分类联动选择器
│       ├── SettingsDialog.tsx    # 设置弹窗
│       ├── AuthGuard.tsx         # 登录路由守卫
│       ├── ConfirmDialog.tsx     # 确认弹窗
│       ├── EmojiPicker.tsx       # Emoji 图标选择器
│       ├── Toast.tsx             # Toast 通知
│       └── useClickOutside.ts    # 点击外部 Hook
├── scripts/
│   └── deploy.cjs               # 一键部署脚本
└── resources/                    # 应用图标
```

## 数据模型

### Bill（账单记录）

```typescript
interface Bill {
  id: number;
  amount: number;       // 金额（元，正数）
  category1: string;    // 一级分类名称
  category2: string;    // 二级分类名称
  date: string;         // 日期 ISO 8601 (YYYY-MM-DD)
  note: string;         // 备注
  type: 'expense' | 'income';  // 支出/收入
  created_at: string;
  updated_at: string;
}
```

### Category（分类）

```typescript
interface Category {
  id: number;
  name: string;         // 分类名称
  icon: string;         // Emoji 图标
  children: string[];   // 二级分类列表
  type: 'expense' | 'income';
  is_preset: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
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
  type TEXT DEFAULT 'expense',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '📦',
  children TEXT DEFAULT '[]',
  type TEXT DEFAULT 'expense',
  is_preset INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);
```

## 已实现功能

### 记账
- 极速记账弹窗（3 步完成），Enter 提交 / Escape 关闭
- 支出/收入双模式，各自独立分类体系
- 金额校验（>0、≤99,999,999.99、四舍五入到分）
- 未来日期预登记二次确认
- 全局快捷键 `Ctrl+N` / `Cmd+N`

### 分类管理
- 11 个支出预设分类 + 6 个收入预设分类
- 自定义分类新增、编辑、删除
- 拖拽排序持久化到数据库
- Emoji 图标选择器
- 预设分类名称保护

### 首页仪表盘
- 6 个统计卡片（今日支出、本月支出、日均支出环比、累计记录、本月收入、本月结余）
- 最近记录列表
- Top 5 支出分类排行榜

### 账单列表
- 时间段筛选（本周/本月/近3月/近6月/近一年 + 月份选择）
- 分类筛选 + 类型筛选（全部/支出/收入）
- 前端搜索（分类/备注/金额）
- 汇总行（记录数、支出合计、收入合计）

### 统计图表
- 时间粒度：本月/上月/近3个月
- 支出分类占比环形图 + 二级分类下钻环形图
- 每日支出趋势折线图
- 分类明细全量表
- CSV 导出（UTF-8 BOM，防注入）

### 用户认证系统
- 邮箱密码注册/登录（腾讯 CloudBase Auth）
- 密码强度校验 + 邮箱格式校验
- 会话持久化（accessToken + refreshToken 自动刷新）
- 密码修改（邮箱验证码）
- 记住账号

### 云同步
- 账单 CRUD 后台静默同步到云端
- 分类 CRUD 后台静默同步到云端
- 同步状态指示器（Layout 顶栏）

### 设置
- 语言切换（中文 / English）
- 时区设置（8 个时区）
- JSON 数据备份/恢复（事务保护）
- 清除所有数据（三步确认）
- 账户信息、关于信息

### 国际化
- 约 193 个中英翻译词条
- 全界面覆盖

## IPC API

通过 `window.electronAPI` 暴露 24 个方法：
- **账单**(4): addBill, getBills, updateBill, deleteBill
- **分类**(5): getCategories, addCategory, updateCategory, deleteCategory, reorderCategories
- **统计**(1): getStats
- **导出**(1): exportCSV
- **备份**(3): exportBackup, importBackup, clearAllData
- **文件**(2): showSaveDialog, showOpenDialog
- **认证**(6): register, login, logout, checkSession, saveEmail, loadEmail, changePassword, sendReauthCode
- **同步**(1): getSyncStatus
- **快捷键**(1): onShortcut

## 开发命令

```bash
npm install           # 安装依赖
npm run dev           # 启动开发服务器
npm run build         # 构建生产版本
npm run dist:win      # 打包 Windows 安装包
npm run dist:mac      # 打包 macOS 安装包
npm test              # 运行单元测试
npm run deploy        # 一键部署（版本号→构建→打包→快捷方式）
```

## 版本号规范（SemVer）

| 改动规模 | 修改位 | 判定标准 |
|----------|--------|----------|
| major | 第一位 | 新页面/新界面 |
| minor | 第二位 | 功能变化（新功能/功能改进） |
| patch | 第三位 | 修 bug/调样式/内部优化 |

## 输出目录

```
E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe\
├── 雷霆记账.exe.lnk    # 快捷方式
└── win-unpacked\       # 完整可执行程序目录
    └── 雷霆记账.exe
```

## 测试与质量

- Vitest 测试框架，8 个组件测试文件
- 提交质量门禁：单元测试全量通过 + 质量审查（`.claude/hooks/quality-gate.cjs`）

## 设计原则

1. **简洁优先** — 记账不超 3 步
2. **数据本地** — SQLite 主存储，云端辅助同步
3. **分类可配** — 预设 + 自定义，拖拽排序
4. **响应式** — 最小 900×600
5. **TypeScript 严格模式**
6. **自动化部署**
