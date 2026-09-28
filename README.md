# ⚡ 雷霆记账

雷霆记账是一个以本机存储为主的个人记账应用，提供 Windows/macOS 桌面端与 Android 客户端。

## v2.1.1

本版修复周期支出分类展示与订阅流程，恢复基于当前登录用户会话的云同步，并新增低频投资快照历史、资产配置图、估算收益和响应式持仓页。收益不是实时行情，数据不完整时会明确显示不可计算。

Agent 支出与持仓更新通过待审提案进入应用。每个提案都要在雷霆记账中重新预览并由用户逐次确认；定时 Agent 只能生成待审提案。投资云同步需要目标 CloudBase 环境预先存在 `investment_positions`、`investment_snapshots` 集合并配置用户范围权限；应用不会自动创建集合，也不会把缺集合误报为空仓或同步成功。

## 项目结构

| 路径 | 内容 |
| --- | --- |
| `src/`、`main-process/` | Electron/React/TypeScript 桌面应用与本机数据库/会话逻辑 |
| `mobile/`、`android/` | Capacitor Android 客户端及原生壳 |
| `cloudfunctions/` | CloudBase 云函数源码与部署清单 |
| `scripts/`、`tests/` | 构建、打包、验收和 UI/协议测试脚本 |
| `skills/` | 跨 Agent 的支出与投资 Skills、JSON 协议、合成验收 |
| `docs/` | 用户集成、同步和平台说明；内部执行资料不属于发布文档 |
| `resources/` | 应用图标与打包资源 |

## Agent Skills

- [支出录入 Skill](./skills/thunder-expense-entry/SKILL.md)：从用户提供的图片、文字或文档提取交易并生成待审提案。
- [投资持仓 Skill](./skills/thunder-investment-snapshot/SKILL.md)：整理持仓、明确数量/成本/现金流语义，生成低频快照提案。
- [Skills 入口与宿主能力矩阵](./skills/README.md)；[提案协议和 JSON Schema](./skills/protocol/README.md)。
- [Agent 集成与用户态云同步说明](./docs/agent-integration.md)。

Skill 遵循 Agent Skills 通用目录和 `SKILL.md` frontmatter。宿主支持能力各异：没有本地脚本/文件能力的 Agent 只能展示 JSON 草案；能生成文件的 Agent 也不能直接写账本或云端。应用会验证当前登录 scope；账本只在用户于应用中确认该提案后更新。不要向 Agent 提供账号密码、券商凭证、服务端 API Key 或未经验证的本地路径。

## Releases

从 [GitHub Releases](https://github.com/TukinokiShio/thunder-accounting/releases) 下载 Windows 安装包和便携压缩包；每个版本附 SHA-256 校验值。查看 [v2.1.1 发布说明](./docs/releases/v2.1.1.md)。

## 从源码构建

需要 Node.js 18+、npm 9+。Windows 安装包还需要 Inno Setup 6。

```sh
git clone https://github.com/TukinokiShio/thunder-accounting.git
cd thunder-accounting
npm ci
npm run typecheck
npm test
npm run build
```

桌面端使用 Electron + React + TypeScript；Android 使用 Capacitor。用户数据先保存在本机。普通业务云同步目标采用当前已登录用户会话与用户范围权限规则；桌面端不应携带 CloudBase 服务端管理 API Key。部署或升级到具体 CloudBase 环境前，必须在隔离环境验证集合和跨账号权限；本仓库源码不能证明生产规则已部署。

## 验证

```sh
npm test
npm run typecheck
node --test skills/tests/proposal-skills.test.mjs
```

Skill 协议测试只使用合成 context、合成 scope 和系统临时目录，不连接真实账号或生产云端。

## 开源协议

[MIT License](./LICENSE) © TukinokiShio
