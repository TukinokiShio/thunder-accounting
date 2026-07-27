# Findings — Phase 0 文档与代码发现

> 项目：雷霆记账 v1.7.12
> 日期：2026-07-27

---

## 1. CloudBase Node SDK 关键 API

### 1.1 `auth.queryUserInfo()`

- **包**：`@cloudbase/node-sdk@3.18.3`（已安装）
- **签名**：`auth.queryUserInfo({ platform, platformId, uid? }): Promise<{ userInfo, requestId }>`
- **关键参数**：
  - `platform: 'EMAIL' | 'PHONE' | 'USERNAME' | 'CUSTOM'`
  - `platformId: string` — 完全匹配的邮箱/手机号
- **返回**：`userInfo.uid` 为用户 UID（用于 ModifyUser API）
- **错误处理**：用户不存在抛 `ResourceNotFound` 异常 → catch 中返回 null
- **来源**：研究 agent 通过 context7 拉取的 SDK 文档 + 项目已存在 v3.18.3

### 1.2 云函数环境的自动管理员凭据

- CloudBase HTTP 云函数运行时自动注入 `TENCENTCLOUD_SECRETID/SECRETKEY/SESSIONTOKEN`
- 直接 `cloudbase.init({ env })` 不传 accessKey 即可获得管理员权限
- 可在云函数内执行 `auth.queryUserInfo`、`database` 操作等

---

## 2. Electron `safeStorage` 关键约束

### 2.1 时机要求

- 必须在 `app.whenReady()` 之后才能调用
- `isEncryptionAvailable()` 在 ready 前返回 false

### 2.2 平台差异

| 平台 | 加密后端 | 安全性 |
|------|---------|--------|
| Windows | DPAPI | 同用户其他应用可访问 |
| macOS | Keychain | 隔离性好 |
| Linux | kwallet/libsecret 或 basic_text（fallback） | basic_text 不加密 |

### 2.3 异步 API 推荐

- `safeStorage.encryptStringAsync(plain): Promise<Buffer>` 优于同步 API
- `safeStorage.decryptStringAsync(buf): Promise<{ result: string, shouldReEncrypt: boolean }>`
- 必须处理 `shouldReEncrypt` 标志（密钥轮换）

---

## 3. 项目关键文件现状

### 3.1 main-process/cloudbase.ts (333 行)

- 第 1 行：`import { execFileSync } from 'child_process'` ✅（已修）
- 第 15 行：`const API_KEY = 'eyJhbGciOiJS...'` ❌（明文硬编码）
- 第 80 行：`db = cloudbase.init({ env: ENV_ID, accessKey: API_KEY })`
- 第 88-110 行：明文凭据存储
- 第 222-234 行：changePassword 用 execFileSync 调用 admin-api.cjs（架构可优化）
- 第 237-254 行：resetPassword 硬编码 UID `2081387154023161858`

### 3.2 cloudfunctions/resetUserPassword/index.js (128 行)

- 第 5-33 行：main() 无认证、无速率限制、无超时
- 第 36-48 行：getCredentials() 从 SCF 环境变量获取
- 第 60-127 行：callTCBApi() HTTPS 调用无超时

### 3.3 .gitignore

- 缺少 `.env` 排除项

### 3.4 主进程入口 main.ts

- 第 45-58 行：`app.whenReady().then(...)` 串行初始化
- 第 289-295 行：credentials IPC handler（同步）

### 3.5 src/main.tsx

- 第 22-26 行：`<React.StrictMode>` 无条件包裹

### 3.6 数据库

- database.ts 共 647 行（已用 LineCounting 验证）
- 包含：CRUD + CSV 导出 + JSON 备份/恢复

### 3.7 SettingsDialog.tsx / CategoryManager.tsx

- SettingsDialog.tsx: 439 行
- CategoryManager.tsx: 453 行

---

## 4. 已有测试覆盖

- vitest 配置完整（vitest.config.ts）
- 12 个测试文件，130 个用例全部通过
- 已覆盖：types/store/data/categories/components/*.test.tsx
- **未覆盖**：Home/Bills/Stats/Login/SettingsDialog 页面组件

---

## 5. 反模式与注意事项

1. **API_KEY 暴露风险**：删除前必须先确认有可用的 `.env` 配置流程
2. **safeStorage 兼容性**：Linux basic_text fallback 必须警告用户
3. **云函数升级需部署**：v1.7.15 改动需手动部署到 CloudBase
4. **凭据格式迁移**：v1.7.14 需要兼容旧 `remembered-auth.json` 读取并清除
5. **拆分需谨慎**：database.ts 拆分必须保持 export 函数签名不变（IPC 依赖）
6. **测试覆盖优先级**：拆分后先跑测试 → 保证行为不变

---

## 6. 流程约束（来自用户最新指令）

- 每个阶段独立 patch 升版本号（v1.7.13 → v1.7.14 → ...）
- 每个阶段独立 git commit
- P1-P7 完成后调用 inno-packager 打包（v1.7.19）
- inno-packager 打包阶段不再升版本号