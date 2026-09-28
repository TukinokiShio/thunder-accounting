# ⚡ 雷霆记账

雷霆记账是一个以本地存储为主的个人记账应用，提供 Windows/macOS 桌面端和 Android 客户端。

## v2.1.0

- 周期支出使用与单笔支出相同的一级、二级分类，仅保留订阅服务规则。历史定投规则保留兼容，不再生成投资或支出记录。
- 新增低频投资持仓快照，支持手动导入 Agent 提案、查看新增/变更/未提及项目和云同步状态。
- 附件记账与持仓 Skill 只能创建待审提案；每次写入均须在雷霆记账中预览并由用户确认。
- 不包含券商登录、自动交易、实时行情或 K 线图。

## 下载

在 [GitHub Releases](https://github.com/TukinokiShio/thunder-accounting/releases) 下载 Windows 安装包和便携压缩包。校验值随每次 Release 发布。

## Agent Skills

- [支出录入 Skill](./skills/thunder-expense-entry)：从用户提供的图片、文本或文档提取支出并生成待确认提案。
- [投资持仓 Skill](./skills/thunder-investment-snapshot)：从持仓材料生成低频快照提案；定时运行也必须停在待确认状态。
- [Skill 使用说明与边界](./skills/README.md)

Skill 不需要账号密码，不访问数据库或 CloudBase。请只把本机雷霆记账生成的 context 提供给你信任的 Agent。更多协议说明见 [Agent 集成与云同步设置](./docs/agent-integration.md)。

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

桌面端使用 Electron + React + TypeScript；Android 使用 Capacitor。应用数据保存在本机。云同步需要自行配置 CloudBase；不要把 API key 或 `.env` 文件提交到 Git。

## 验证

```sh
npm test
npm run typecheck
node --test skills/tests/proposal-skills.test.mjs
```

上述 Skill 协议测试仅使用合成 fixture，不连接真实账号或生产云端。

## 开源协议

[MIT License](./LICENSE) © TukinokiShio
