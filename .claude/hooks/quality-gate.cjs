#!/usr/bin/env node
/**
 * quality-gate.cjs — git commit 质量门禁核心脚本
 *
 * 三种模式：
 *   node quality-gate.cjs check          # PreToolUse hook 模式：stdin 读工具调用 JSON，
 *                                        #   拦截 git commit，校验通过标记，缺失/过期则 exit 2 拒绝
 *   node quality-gate.cjs write <name> [summary]  # 检查通过后写标记（name: tester | quality）
 *   node quality-gate.cjs hash           # 打印当前工作区 stateHash（调试用）
 *
 * stateHash 设计：
 *   对「HEAD sha + git status 中每个改动路径 + 该文件内容的 sha256」排序后整体取 sha256。
 *   - 对暂存状态不敏感：写标记后执行 git add -A 不会使 hash 变化
 *   - 对任何内容改动敏感：写标记后再改任何文件 → hash 变化 → 标记失效
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 脚本位于 <项目根>/.claude/hooks/，据此反推项目根，不依赖调用方 cwd
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const GATE_DIR = path.join(PROJECT_ROOT, '.claude', 'quality-gate');
// 两个必需标记：单元测试（tester）+ 质量检查（quality）
const REQUIRED_MARKERS = ['tester', 'quality'];

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function git(args) {
  return execFileSync('git', args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** 计算当前工作区内容指纹（见文件头注释的设计说明） */
function computeStateHash() {
  let head;
  try {
    head = git(['rev-parse', 'HEAD']).trim();
  } catch {
    head = 'NO_HEAD'; // 空仓库尚无提交
  }
  // -z：NUL 分隔且路径不转义（兼容中文路径）；-uall：展开未跟踪目录到具体文件；
  // --no-renames：避免 rename 双路径条目
  const out = git(['status', '--porcelain=v1', '-z', '-uall', '--no-renames']);
  const entries = out
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const relPath = entry.slice(3); // 去掉 "XY " 状态位 → 对暂存状态不敏感
      const absPath = path.join(PROJECT_ROOT, relPath);
      let contentHash;
      try {
        const stat = fs.statSync(absPath);
        contentHash = stat.isDirectory() ? 'dir' : sha256(fs.readFileSync(absPath));
      } catch {
        contentHash = 'deleted';
      }
      return `${relPath}:${contentHash}`;
    })
    .sort();
  return sha256([`HEAD:${head}`, ...entries].join('\n'));
}

/**
 * 判断一条 shell 命令是否包含 git commit 调用。
 * 按 && || ; | 换行切段后做 token 级解析（跳过 git 全局选项找子命令），
 * 尽量精确；歧义时宁可误拦不可漏放。
 */
function isGitCommit(command) {
  if (!command || typeof command !== 'string') return false;
  const segments = command.split(/&&|\|\||[;|\n]/);
  for (const seg of segments) {
    const tokens = seg.trim().split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i].replace(/^["'(]+|["')]+$/g, '');
      if (tok !== 'git' && !tok.endsWith('/git') && !tok.endsWith('\\git') && tok !== 'git.exe') continue;
      // 跳过 git 全局选项，定位子命令
      let j = i + 1;
      while (j < tokens.length) {
        const t = tokens[j];
        // 这些全局选项后面跟一个独立参数值
        if (['-c', '-C', '--git-dir', '--work-tree', '--exec-path', '--namespace'].includes(t)) {
          j += 2;
          continue;
        }
        if (t.startsWith('-')) {
          j += 1;
          continue;
        }
        break;
      }
      if (j < tokens.length && tokens[j].replace(/^["']|["']$/g, '') === 'commit') return true;
    }
  }
  return false;
}

/** 校验单个标记文件，返回 null（有效）或失败原因字符串 */
function validateMarker(name, currentHash) {
  const markerPath = path.join(GATE_DIR, `${name}.pass.json`);
  if (!fs.existsSync(markerPath)) {
    return `缺少 ${name} 通过标记（${name === 'tester' ? '单元测试' : '质量检查'}尚未执行或未通过）`;
  }
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch {
    return `${name} 标记文件损坏（JSON 解析失败）`;
  }
  if (marker.passed !== true) {
    return `${name} 标记状态不是通过（passed !== true）`;
  }
  if (marker.stateHash !== currentHash) {
    return `${name} 标记已过期（写入标记后代码又被修改过，需重新检查）`;
  }
  return null;
}

/** check 模式：PreToolUse hook 入口 */
function runCheck() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8'); // 同步读全部 stdin
  } catch {
    /* 无 stdin 输入 */
  }

  let command = '';
  try {
    const data = JSON.parse(raw);
    command = (data.tool_input && data.tool_input.command) || '';
  } catch {
    // stdin 不是合法 JSON：降级用原始文本判断，宁可误拦不可漏放
    command = raw;
  }

  if (!isGitCommit(command)) {
    process.exit(0); // 非 commit 命令，零干扰放行
  }

  const currentHash = computeStateHash();
  const failures = REQUIRED_MARKERS.map((name) => validateMarker(name, currentHash)).filter(Boolean);

  if (failures.length === 0) {
    process.exit(0); // 双标记齐全且新鲜 → 放行
  }

  const msg = [
    '❌ 质量门禁拦截：git commit 被拒绝。',
    ...failures.map((f) => `  - ${f}`),
    '',
    '请通过 /gitcommit 流程提交：并行运行 tester（全量 npm test）与 quality-engineer（质量审查）',
    '两个 agent，各自通过后写入标记，再执行 git commit。',
    '注意：写入标记后到 commit 之前不得再修改任何文件，否则标记会因 stateHash 变化而失效。',
  ].join('\n');
  process.stderr.write(msg);
  process.exit(2); // exit 2 = 拒绝该工具调用，stderr 反馈给 Claude
}

/** write 模式：agent 检查通过后写标记 */
function runWrite(name, summary) {
  if (!REQUIRED_MARKERS.includes(name)) {
    process.stderr.write(`用法: node quality-gate.cjs write <${REQUIRED_MARKERS.join('|')}> [summary]\n`);
    process.exit(1);
  }
  fs.mkdirSync(GATE_DIR, { recursive: true });
  const stateHash = computeStateHash();
  let head;
  try {
    head = git(['rev-parse', 'HEAD']).trim();
  } catch {
    head = 'NO_HEAD';
  }
  const marker = {
    passed: true,
    agent: name,
    stateHash,
    head,
    createdAt: new Date().toISOString(),
    summary: summary || '',
  };
  fs.writeFileSync(path.join(GATE_DIR, `${name}.pass.json`), JSON.stringify(marker, null, 2) + '\n');
  process.stdout.write(`✅ 已写入 ${name} 通过标记（stateHash: ${stateHash.slice(0, 12)}…）\n`);
}

// ---- 入口 ----
const mode = process.argv[2];
try {
  if (mode === 'check') {
    runCheck();
  } else if (mode === 'write') {
    runWrite(process.argv[3], process.argv.slice(4).join(' '));
  } else if (mode === 'hash') {
    process.stdout.write(computeStateHash() + '\n');
  } else {
    process.stderr.write('用法: node quality-gate.cjs <check|write <name> [summary]|hash>\n');
    process.exit(1);
  }
} catch (err) {
  // fail-closed：check 模式下内部异常一律按拒绝处理，避免异常静默放行
  if (mode === 'check') {
    process.stderr.write(`质量门禁脚本内部错误（按拒绝处理）: ${err && err.message}\n`);
    process.exit(2);
  }
  process.stderr.write(`quality-gate 错误: ${err && err.message}\n`);
  process.exit(1);
}
