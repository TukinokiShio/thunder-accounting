# Thunder Accounting 项目上下文

## 领域术语

- **Product / Operate**：以记账、查询、同步和设置为核心任务的桌面产品界面，不套用营销页构图。
- **renderer**：Electron 渲染进程，包含 React 页面、组件、主题和交互。
- **main-process**：Electron 主进程，负责窗口、认证、数据库和 IPC。
- **app-out**：electron-vite 构建输出，供 Electron Builder 收集，不是源码。
- **release**：Windows 构建与 Inno 安装包输出目录；交付安装包放在这里。
- **exe**：本项目约定的最终安装验收目录；每次打包验证后应安装到 `E:\Code\CodeProduct\thunder-accounting\exe`。
- **Aurora tokens**：从项目上下文编译的语义色彩、间距、圆角、排版和组件状态变量。
- **真实 GUI 验收**：用户在 Windows 上启动安装后的应用，确认视觉、焦点、交互和主题；不能由 headless 测试替代。

## 架构约定

- React 18 + TypeScript + Electron 33 + electron-vite + Tailwind CSS + Zustand。
- `src/index.css` 是当前主题与组件样式入口；业务组件消费语义 token，不直接写蓝色/primary 色值。
- 认证、记账、同步、备份、双语和 CloudBase 数据契约保持不变；本轮只改 UI、构建交付和项目记忆。
- 浅色主题默认；深色主题通过现有 `.dark`/主题状态保持；断点为 640 / 1024 / 1440。

## 交付约定

- 当前发布版本为 `1.6.4`，同步 `package.json`、`package-lock.json` 与 `scripts/thunder-setup.iss`；后续安装包内 `app.asar` 版本也必须与该版本一致。
- 清理遵循用户确认的 cleanup manifest；源码、Git 历史、审计证据、当前回滚包和用户数据不自动删除。
- 安装验收目录固定为 `E:\Code\CodeProduct\thunder-accounting\exe`；安装后必须验证 `exe\resources\app.asar` 版本和应用可启动性。
