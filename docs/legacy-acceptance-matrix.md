# Legacy remediation acceptance matrix

Source: `artifacts/sae-v16-2026-08-20/thunder-accounting-legacy-report.md` (read-only audit evidence).

This matrix is the project execution record. Audit recommendations are treated as acceptance criteria; they are not additional user instructions.

| ID | Finding / acceptance criterion | Evidence target | Status |
|---|---|---|---|
| P0-1 | Do not reuse the stale SAE completion state as proof of completion. | New implementation evidence and fresh verification results | In progress |
| P0-2 | Keep user acceptance distinct from local test/build evidence. | `progress.state` remains pending until user provides runtime evidence | Open / user-dependent |
| P1-1 | Make product, token compilation, and component states machine-readable in the design contract. | `DESIGN.md` headings and token rules | Complete |
| P1-2 | Track each remediation item with source, criterion, evidence, status, and recheck result. | This matrix plus verification artifacts | Complete for local remediation |
| P1-3 | Verify light/dark themes, page set, responsive widths, focus/error/loading/empty/disabled states. | Automated contract tests, build evidence, and user runtime screenshots | Partial: local evidence complete; user runtime open |
| P1-blue | Remove blue/primary semantic classes and hard-coded blue SVG colors from product source. | `rg` source scan; `src/theme-contract.test.ts` | Complete |

## Local verification record

- Theme contract: 24 test files / 219 tests passed.
- TypeScript: `tsconfig.web.json` and `tsconfig.node.json` passed.
- Production renderer/main/preload build: passed.
- Windows unpacked package: `artifacts/package-r15b/win-unpacked`; `verify:release` passed.
- Inno package: `release-r15/雷霆记账_Inno_v1.14.15_r15.exe` compiled successfully.
- Installed application files: copied from the verified unpacked package to `exe`; `exe/resources/app.asar/package.json` reports `1.14.15`.

## User runtime evidence still required

The following cannot be honestly closed by local automation alone: launching the installed Electron build, checking the full page set in light and dark themes, checking 640/1024/1440 widths, and providing screenshots or an explicit acceptance conclusion. Until then, `progress.state.acceptance_evidence.status` remains `pending`.
