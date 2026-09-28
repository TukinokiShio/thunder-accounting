# Agent 提案协议与投资云同步

## Agent 操作边界

桌面应用只为当前登录会话创建 `userData/agent-sync/accounts/<SHA-256(uid)>/agent-sync/context.json` 和相邻的 `inbox/`。每个账号使用独立目录；context 包含支出分类、当前持仓摘要、不透明 scope token 和过期时间，不含 UID、手机号或 CloudBase 凭证。每次登录切换或显式登出都会轮换 scope 并清空旧 context；token 有效期为 30 天。

Skill 生成的 JSON 只进入当前账号的 inbox。应用主进程按当前 session 和数据库用户校验 scope、类别、持仓基线、文件类型和严格字段白名单。用户每次在应用内确认后，账本写入与 operation ledger 在一个 SQLite 事务中提交；持仓变化和云同步 outbox 同事务提交。确认后的支出账单还会按应用现有账单同步路径尝试推送。相同 operation 重放不会再次写入，内容 hash 不同的重放会被拒绝。拒绝会归档到本地 `rejected/`，不会写账本；处理归档只保留最小回执，不保留原始金融条目。

提案格式：

```json
{
  "schema_version": "thunder-agent-proposal/v1",
  "operation_id": "<UUID v4>",
  "scope_token": "<app-generated opaque token>",
  "created_at": "<ISO 8601 timestamp>",
  "kind": "expenses | investments",
  "items": []
}
```

应用仍会重新校验内容。Skill 的预校验不是安全边界的替代品。

## 本机账号兼容配置

公共源码不包含管理员邮箱或旧本地库迁移邮箱。需要保留 `admin` / `TBAdmin` 邮箱别名时，可在本机 `.env` 配置 `THUNDER_ADMIN_EMAIL`；需要迁移旧本地库时，可配置 `THUNDER_LEGACY_MIGRATION_EMAIL`。这些值只用于本机兼容，不要提交 `.env`。手机号登录仍走用户输入的手机号。

## CloudBase 投资集合

应用同步至集合 `investment_positions`，每份文档包含 `userId`、`asset_key`、`name`、`asset_type`、`quantity`、`cost_basis`、`market_value`、`currency`、`as_of`、`source_note`、`created_at` 和 `updated_at`。未知的成本或市值用 `null` 表示。文档 ID 是 `SHA-256(userId + NUL + asset_key)`，因此同一账号不同设备的本地自增 ID 不会互相覆盖。

首次启用前，在目标 CloudBase 环境创建 `investment_positions` 集合，并按现有应用集合的认证规则限制每个用户只读写 `userId` 匹配自己的文档。不要公开服务端管理密钥，也不要把云集合设置成匿名可写。集合尚未创建或规则不允许操作时，持仓仍保存到本地，界面会显示云同步失败/待同步；修复集合配置后可点击“重试云同步”。

**本次交付未连接生产 CloudBase，也未创建集合或验证线上规则。** 发布后需由环境管理员在隔离/测试环境创建集合并验证跨账号隔离，再启用生产集合。

## 自动化

定时任务可以读取用户授权的持仓材料并生成一份新提案。它不得自动调用确认 IPC、修改数据库或删除本次未提及的持仓。每份提案都要在应用中重新查看和确认。
