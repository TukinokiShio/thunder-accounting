---
name: automated-deployment
description: 自动化部署规则：每次代码修改后自动递增版本号、构建打包、输出到指定目录并更新桌面快捷方式
metadata:
  type: project
---

# 自动化部署规则

## 触发条件
每次修改本项目的源代码后，必须执行完整的部署流程。

## 流程

### 1. 版本号递增
根据改动规模选择升级级别：

| 级别 | 命令 | 示例 | 判据 |
|------|------|------|------|
| `major` | `npm run deploy -- major` | 1.0.0 → 2.0.0 | 新增页面/界面、大规模重构 |
| `minor` | `npm run deploy -- minor` | 1.0.0 → 1.1.0 | 修改/新增功能模块、新增组件 |
| `patch` | `npm run deploy` | 1.0.0 → 1.0.1 | 修 bug、调样式、改文案、小重构 |

### 2. 执行部署
运行 `npm run deploy [级别]`，脚本自动完成：
- 更新 `package.json` 版本号
- 同步 `src/components/Sidebar.tsx` 版本文本
- 执行 `npm run dist:win` 构建打包
- 复制 `release/win-unpacked/` 到 `E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe\`
- 创建 `雷霆记账.exe.lnk` 快捷方式到输出目录
- 创建 `雷霆记账.lnk` 快捷方式到桌面（`%USERPROFILE%\Desktop\`）

### 3. 输出目录结构
```
E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe\
├── 雷霆记账.exe.lnk
└── win-unpacked\
    ├── 雷霆记账.exe
    └── ...

C:\Users\d8502\Desktop\
└── 雷霆记账.lnk              # 桌面快捷方式，每次部署自动更新
```

**Why:** 用户要求每次代码修改后自动生成最新的可用 exe，并同步更新桌面快捷方式，确保随时可以双击桌面图标启动最新版本。
**How to apply:** 每次代码修改完成后，判断改动规模，选择对应级别运行 `npm run deploy`。
