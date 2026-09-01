---
name: thunder-accounting-coding-workflow
description: 雷霆记账项目级差异适配层；引用 canonical SACW v4.2.0 与 Aurora v6.0.1，不修改其流程骨架。
version: "0.1.0"
project: thunder-accounting
---

# Thunder Accounting 项目级工作流记忆

本文件只记录本项目差异，不扩权、不改写 canonical SACW 状态机或质量门。

## 项目画像

- Electron 33 + React 18 + TypeScript + electron-vite + Tailwind + Zustand。
- Windows 桌面交付使用 Inno Setup 6；源码输出 `release`，最终安装验收目录为 `E:\Code\CodeProduct\thunder-accounting\exe`。
- UI register 为 Product / Operate；项目 accent 为纸张/墨色/金色，浅色默认，深色可切换。

## 强制差异

- UI 改动必须先读取 `PRODUCT.md`、`DESIGN.md`、`CONTEXT.md`、Aurora route/design-context receipt 和相关 KI 记录。
- 组件只能消费项目语义 token；图表、SVG、状态色和焦点态不得重新引入蓝色/primary 硬编码。
- 表单采用显式 label、单层 `focus-within` 边界、错误说明和可见键盘焦点；验证码容器不叠加竖线或双重光圈。
- UI 验证采用 640 / 1024 / 1440 三档，包含浅色、深色、loading、empty、error、disabled、recovery 和 reduced-motion 证据。
- 每次 Windows 打包完成后，以 Inno receipt 记录 ISCC、安装包 hash、静默安装结果和 `exe` 目录安装断言。

## 清理保护

- `src/`、`main-process/`、`resources/`、`docs/`、`wiki/`、`.git/`、`artifacts/` 审计证据默认保留。
- `node_modules/`、`app-out/`、`release/`、`exe/`、`out/`、`雷霆记账app/` 只能按 cleanup manifest 逐项处理；涉及历史安装包或回滚包必须先获用户确认。
- 未来安装/验收目标固定为 `E:\Code\CodeProduct\thunder-accounting\exe`，不得只更新 `release` 后宣称完成。
