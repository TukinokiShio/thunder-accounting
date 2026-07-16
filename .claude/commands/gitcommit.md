---
description: 质量门禁提交：并行运行 tester + quality-engineer 双检，全部通过后自动 git commit
---

# /gitcommit — 质量门禁提交流程

你在**主对话**中编排以下流程（不要让 subagent 内部再派生 subagent）。

## 1. 前置确认

- 运行 `git status --porcelain`，若无任何改动，告知用户无可提交内容并终止。
- 完成所有提交前必须的文件改动（版本号递增、Sidebar 版本文本、README 同步等项目规则要求的内容）。
- ⚠️ **此步之后直到 commit 完成，不得再修改任何文件**——通过标记绑定工作区内容指纹（stateHash），任何改动都会使标记失效。

## 2. 并行双检（单条消息同时派出两个 subagent）

- **tester**（`subagent_type: "tester"`；若该类型本会话不可用，改用 `general-purpose` 并要求其先读 `.claude/agents/tester.md` 按其行事）：
  > 门禁模式：运行全量 `npm test`。全部通过则执行 `node .claude/hooks/quality-gate.cjs write tester "vitest: N passed"` 写入标记；有失败则不写标记、不修改代码，返回失败清单与原因分析。
- **quality-engineer**（`subagent_type: "quality-engineer"`）：
  > 门禁模式：审查当前 git 改动文件（6 维度）。无 🔴 严重问题则执行 `node .claude/hooks/quality-gate.cjs write quality "<摘要>"` 写入标记；有 🔴 则不写标记、不修改代码，返回阻塞提交的 🔴 清单（文件:行号 + 修复建议）。🟡/🔵 记录但不阻塞。

## 3. 提交

- 两个 agent 都报告「已写入标记」后，**立即** `git add -A` 并 `git commit`（中间不要做任何文件改动）。
- 提交信息遵循仓库现有风格：中文 conventional commits（`feat:` / `fix:` / `docs:` / `chore:` 等），结尾附：
  `Co-Authored-By: Claude <noreply@anthropic.com>`
- PreToolUse hook（`.claude/hooks/quality-gate.cjs check`）会自动校验双标记，校验失败会拒绝 commit 并说明原因。

## 4. 失败处理（自动修复循环，最多 3 轮）

- 任一 agent 未通过：在主对话中根据其报告修复问题——
  - 测试失败：先判断是测试代码问题还是产品代码 bug，修对应的一侧；
  - 🔴 质量问题：按报告的修复建议处理。
- 修复后**必须回到第 2 步重新并行派出两个 agent**——任何文件改动都会使两个标记同时失效，不能只重跑失败的那个。
- 3 轮后仍未通过：**停止提交**，向用户完整汇报剩余问题、已尝试的修复和建议。

## 5. 汇报

提交完成后汇报：commit hash、测试结果摘要、质量审查摘要（🔴/🟡/🔵 数量）、经历的修复轮数、本流程调用的 agent/skill 清单。
