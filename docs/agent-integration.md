# Agent 提案协议与用户态云同步

雷霆记账公开提供两个通用 Agent Skills，供任意兼容 Agent Skills 的宿主使用：支出材料转待审支出提案，以及持仓材料转低频快照提案。宿主能否读取附件、执行 Node.js 脚本、传递 stdin、访问用户提供的本地路径或创建定时任务，取决于宿主自身；Skill 不会假定这些能力一定可用。详见 [`../skills/README.md`](../skills/README.md) 与 [`../skills/protocol/README.md`](../skills/protocol/README.md)。

## 提案范围与逐次确认

桌面应用只为当前已登录会话创建 context 文件及邻接的 `inbox/`。每个账号使用分离的本机目录；context 含支出分类、当前持仓、可用时的已确认历史快照、不透明 `scope_token` 和到期时间，不暴露 UID、手机号或 CloudBase 凭证。切换账号或登出后，旧 scope 会失效。用户应从应用复制当前 context 路径并交给 Agent；Agent 不得猜测、扫描或替换账号路径。

提案使用固定的 `thunder-agent-proposal/v1` envelope。旧 v1 可省略最后三项 provenance 字段；两个新版 Skill 每次都必须提供它们：

```json
{
  "schema_version": "thunder-agent-proposal/v1",
  "operation_id": "<UUID v4>",
  "scope_token": "<当前 app context 提供的 opaque token>",
  "created_at": "<ISO 8601 timestamp>",
  "kind": "expenses | investments",
  "skill_name": "thunder-expense-entry | thunder-investment-snapshot",
  "skill_version": "1.0.0",
  "source_summary": "材料类型、日期和条数等最少摘要；不含账户 ID、凭证或路径",
  "items": []
}
```

每个 envelope 文件代表一项提案操作。`skill_name`、`skill_version` 和最多 500 字的 `source_summary` 只供本地预览，不代表来源认证、不上云；它们不得包含用户/账户 ID、手机号、凭证、本地路径或源材料原文。打包的 `scripts/submit.mjs` helper 只校验输入并把提案写入当前 context 相邻的 app-managed `inbox/`；不访问网络、SQLite、CloudBase、券商或确认接口。雷霆记账会再校验当前登录 scope、类别/持仓基线、字段、文件和重复操作，然后显示预览。

若宿主能读取用户提供的 context、生成 `.json` 附件但不能运行 helper 或写入本机 inbox，Agent 可生成同样的 v1 envelope 附件，文件名为 `<operation_id>.json`。附件含短期 `scope_token`，只交付给本次请求的用户并提醒不要继续转发。用户在 app 中点击“打开提案目录”，手动将附件保存到该目录，再点击“刷新”检查 app 预览。Agent 不得猜测、访问或暴露保存路径；用户保存前不得声称已导入。若连附件都不能生成，停在不含 `scope_token` 的 JSON 草案。

**账本仅在用户于雷霆记账中单独确认该提案后写入。** 每次定时运行也需要新的用户确认；已授权读取某个文件夹、配置一个定时任务或确认过之前的提案，都不等于确认之后的提案。拒绝或未处理的提案不会写入。投资提案中的未提及持仓表示来源没有更新它，不表示卖出，也不删除持仓。

## 投资快照字段与收益口径

每条持仓含资产标识/类型、数量、成本、市值、币种、估值日期和来源。新版提案明确标注 `quantity_kind`（`shares | units | currency_amount | unknown`）与 `cost_basis_kind`（`total | per_unit | unknown`）；缺少含义时使用 `unknown`，不得把累计投入金额误写成份额。

`cash_flows` 是该资产相邻两次**已确认快照**之间的区间增量。每条现金流含稳定 `flow_id`、发生日期、类型（`contribution | withdrawal | dividend | fee`）、正数 decimal 字符串金额、币种和 `included_in_market_value`。对分红和费用，该标志表示其经济影响是否已体现在区间终点快照的报告市值中；应用只对尚未反映的分红/费用作一次收益调整。外部投入/取出无论此标志为何，仍分别扣除/加回本金流。类型决定方向；资产组合内部交易不能重复记作外部投入/取出。仅 `cash_flows_complete: true` 且数组为空才表示已确认该区间没有现金流；`false`、旧数据缺字段或无法稳定识别现金流都表示覆盖不完整，收益不能假设现金流为零。

应用只从用户确认后的快照历史计算低频指标。日收益金额为本期组合总值减上一有效快照总值、再减本期外部净投入；累计收益使用显式基准值和基准以来的外部净投入；若分红/费用尚未反映在市值中，按发生日期只调整一次。浮盈要求成本口径和市值可信。币种、估值日期、基线或现金流不完整时展示“不可计算”及原因；不将未知显示为 0，不使用实时行情或插值数据。

## 用户态 CloudBase 同步

日常账单、分类和持仓同步由当前登录用户的 CloudBase session/用户态 SDK 发起，并使用面向该用户的数据库权限规则。桌面端日常同步不需要 CloudBase 服务端管理 API Key；不要把管理员密钥放进应用 `.env`、安装包或公开仓库。应用仅把当前会话的 UID 用于所有者范围校验，客户端数据库规则仍须确保用户只能读写自己的数据。

投资同步包含当前持仓集合 `investment_positions` 和历史快照集合 `investment_snapshots`。历史只包含在本机由用户确认的快照；云端拉取/写入同样按已登录用户范围处理。集合缺失、权限拒绝、会话过期或网络故障不应被解释为空持仓或“同步成功”：本机数据保留，应用显示待同步/失败并提供重试。

**公开源码和本说明不能证明目标 CloudBase 环境的集合已创建或权限规则已部署。生产 CloudBase 未在本次代码工作中连接或验证。** 在启用同步前，由环境管理员在隔离环境验证当前用户读写、另一用户无法读写、登出/换账号隔离及重试，然后按目标环境配置 `investment_positions`、`investment_snapshots` 与既有业务集合的用户权限。不要将集合设为匿名可写。管理员维护凭证只用于受控的管理端任务，不用于 Agent Skills 或桌面客户端同步。

`.env.example` 不再提供 CloudBase 服务端 API Key 示例。可选的本机账号兼容环境值 `THUNDER_ADMIN_EMAIL` 和 `THUNDER_LEGACY_MIGRATION_EMAIL` 若被部署使用，必须由用户在本机配置且不得提交实际个人值。

## 自动化宿主限制

定时任务只能读取用户明确授权的来源，按约定频率生成待审提案和差异摘要，然后停止。若宿主缺少 scheduler、context 读取、Node.js/本地文件能力或权限，Agent 必须如实说明未创建任务/文件，停在可审阅的 JSON 草案；不得用 UI 自动点击或直接数据库/API 写入绕过限制。
