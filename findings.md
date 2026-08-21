# SACW Findings — v1.15.0 遗留问题重启审查

## 执行形态：多 Agent 编排

本轮保留 SACW 编排和门禁格式，但因当前 Codex 会话没有暴露 `multi_agent_v1` 派生工具，明确降级为主执行者与外部规则门禁。未生成虚假的 Explore/Worker/Reviewer/Judge 回执。

## 基线与版本决策

- 用户已安装并核验 `v1.14.14`，作为回滚基线。
- `v1.14.15`、`v1.14.16` 作废；下一交付版本直接为 `v1.15.0`。
- 遗留报告是审查证据，不是对本轮的直接操作指令。

## 任务分类

实质 UI 任务：需要跨登录页、应用外壳、业务页面、个人中心、设置与弹窗统一视觉系统，并进行桌面、平板、移动三档验证。

## 用户需求锚点

- 第三轮 demo 是唯一视觉基线，不与旧 UI 混搭。
- 产品全页面采用同一套产品预览式布局语言。
- 浅色主题默认，深色主题可切换。
- 保留现有认证、记账、同步、备份与双语功能。

## 已注入知识

- ⟨KI-2026-08-11-024⟩ UI 克制度三原则：静态 token 层做全、动效只留一个、状态用文字/颜色。
- ⟨KI-2026-08-19-002⟩ Aurora v4 与 SACW v3.9 的契约闭环：PRODUCT/DESIGN、视觉证据和独立审查必须落盘。

## Aurora 注册分类

- register: product / operate
- direction: product-preview ledger; paper/ink light; charcoal/night dark; amber-gold brand accent
- UX dials: scanability, calm hierarchy, restrained motion

## 执行形态：多 Agent 编排

TASK_CLASSIFY/KNOWLEDGE_GATE：Explore 并行摸底；PLAN：黑板式方案汇总；EXEC：Supervisor 分发互不重叠的 Worker；REVIEW：独立 Reviewer + UIUX Reviewer 辩论；EVAL：独立 Judge/门禁收敛。

## 缺陷轮真实验证

- CloudBase `15211073887` + `target=USER` 首次返回 `FAILED_PRECONDITION / 账号不存在`；这是注册前的正确业务结果，不是网关不可用。
- 使用授权验证码 `179985` 完成手机号验证后，真实手机号注册成功，返回 UID `2090085333407375360`；随后使用密码 `Thunder1521!` 登录成功并返回 access/refresh token。
- 注册后再次请求手机号 `target=USER` 返回 `is_user=true`，确认用户状态已建立。
- `admin`/`TBAdmin` 统一解析到 `15211073887@163.com`，不再要求本地 accounts 映射才能进入 Auth 登录。
- 真实管理员邮箱登录密码未执行：当前没有用户提供的邮箱验证码或密码，不伪造成功结论。

## 本轮外部清理

- 删除 release/exe 历史安装包、旧 blockmap、旧解压验证目录、嵌套 `exe\win-unpacked` 和旧 TypeScript 增量产物；每个目标删除后通过 `Test-Path` 核验为不存在。
- 保留当前 `release\win-unpacked`、`release\雷霆记账 Setup 1.14.1.exe`、`exe\resources\app.asar` 和审计/流程记录。
- Git：当前分支 `master`，相对 `origin/master` 为本地领先 7 个提交；工作区有本轮未提交修改；未执行 commit/push。
## v1.14.2 本轮整改

- 登录页移除内嵌红色错误框，校验、错误、验证码发送成功和登录成功统一调用现有 Toast；Toast 由 store 统一在约 5 秒后自动消失。
- CloudBase 验证码发送结果保留 `expires_in`，当前真实接口返回 300 秒；登录页成功消息明确显示“5 分钟内有效”。
- 文字型链接 hover 按 `rare-cobra-61` 的交互意图处理：沿用金棕原色，轻微加深、加粗并放大，不切换为黑色。
- 账号 `codex` 尚未创建：CloudBase Auth 新账号必须绑定可验证的手机号或邮箱，当前请求只提供了账号名和密码，缺少可接收验证码的身份；未擅自复用现有管理员或修改其密码。
- 验证：23 个测试文件 / 216 个测试通过；build、Windows dist、release/exe 发布产物校验通过；`app.asar` 版本为 1.14.2。
