# 首页优化 + 收入功能 — 设计文档

> 日期：2026-07-12 | 版本：v1.0

## 概述

对雷霆记账进行四项优化：
1. 首页最近记录支持滚动
2. 本月支出 Top 5 细分到二级分类
3. 完整收入功能体系
4. 记一笔后首页自动刷新

---

## 一、最近记录滚动

### 改动范围

**文件**：`src/pages/Home.tsx`（第 114-139 行）

### 变更

- 数据源从 `bills.slice(0, 5)` 改为 `bills`（展示全部当月账单，已在 store 中按月份过滤）
- 容器加 `max-h-[400px] overflow-y-auto` 实现滚动
- 保留 `space-y-2` 间距

---

## 二、Top 5 细分到二级分类

### 改动范围

**文件**：`src/pages/Home.tsx`（第 89-90 行）

### 变更

- 数据源从 `stats.byCategory1` 改为 `stats.byCategory2`
- 显示文本从 `{cat.category1}` 改为 `{cat.category1} · {cat.category2}`
- 百分比计算不变：`item.total / monthTotal * 100`

---

## 三、收入功能（完整体系）

### 3.1 数据库

`main-process/database.ts`：

- `bills` 表新增字段 `type TEXT NOT NULL DEFAULT 'expense'`
- 初始化 SQL 改为 `CREATE TABLE IF NOT EXISTS` 加新字段（已有表需 ALTER TABLE 兼容）
- 兼容策略：先用 `ALTER TABLE ADD COLUMN IF NOT EXISTS` 尝试添加（sql.js 不支持 IF NOT EXISTS，改用 try-catch）

### 3.2 数据模型

**`src/types/index.ts`**：
```typescript
export interface Bill {
  // ... 现有字段
  type: 'expense' | 'income'
}

export interface AddBillForm {
  // ... 现有字段
  type: 'expense' | 'income'
}
```

### 3.3 收入分类预设

**新文件**：`src/data/incomeCategories.ts`

| 一级 | icon | 二级 |
|------|------|------|
| 工资薪水 | 💼 | 基本工资、奖金绩效、加班补贴 |
| 兼职副业 | 💻 | 自由职业、稿费版税、咨询费 |
| 投资理财 | 📈 | 股票基金、利息分红、房租收入 |
| 红包转账 | 🎁 | 微信红包、亲友转账、节日礼金 |
| 退款报销 | ↩️ | 购物退款、费用报销、押金退还 |
| 其他收入 | 📦 | 二手出售、其他 |

**`src/data/categories.ts`**：导出 `type Category =` 已被使用，收入分类复用同一 `Category` 类型。

### 3.4 记一笔弹窗

**`src/components/AddBillDialog.tsx`**：

- 顶部（标题下方）增加支出/收入切换：两个按钮 `支出` / `收入`，支出高亮红色、收入高亮绿色
- `form.type` 切换时重置 `category1` 和 `category2` 为空
- 根据 `form.type` 动态切换分类数据源：
  - 支出 → `presetCategories`（现有）
  - 收入 → `incomeCategories`（新增）
- 保存时 `billData` 携带 `type` 字段
- 金额输入框前缀颜色跟随 type 变化：支出红色、收入绿色

**`src/components/CategorySelect.tsx`**：

- 新增可选 prop `categories?: Category[]`，默认值为 `presetCategories`（向后兼容）
- 记一笔弹窗在收入模式时传入 `incomeCategories`

### 3.5 首页改动

**`src/pages/Home.tsx`**：

- 统计卡片从 4 列改为 6 列：`grid-cols-2 lg:grid-cols-3`（或保持 2x3 布局）
- 新增两张卡片：**本月收入**（绿色）、**本月结余**（收入 - 支出）
- 今日支出改为**今日收支**：显示今日支出和今日收入
- 最近记录中，收入条目显示 `+¥`（绿色），支出条目显示 `-¥`（红色）
- 加载 stats 时同时拉取支出和收入 stats（或后端一次性返回）

### 3.6 后端统计兼容

**`main-process/database.ts`** — `getStats` 函数：

- 接受可选的 `type` 参数：`'expense' | 'income'`
- 默认查询全部（兼容旧行为），传 type 时只查对应类型
- 首页并行请求支出 stats + 收入 stats

**`main-process/main.ts`** — IPC handler：

- `stats:get` 改为接受第三个参数 `type`

**`main-process/preload.ts`** — 签名同步更新：

- `getStats(startDate, endDate, type?)` 

### 3.7 账单列表页

**`src/pages/Bills.tsx`**：

- 筛选项新增「全部 / 支出 / 收入」下拉
- 收入条目金额显示绿色 `+¥`，支出保持红色 `-¥`

### 3.8 统计页

**`src/pages/Stats.tsx`**：

- 汇总卡片增加收入统计
- 可考虑后续迭代加收支对比图，本次先加基本数据

---

## 四、记一笔后自动刷新

### 改动范围

**`src/store/index.ts`**：
- 新增 `refreshTrigger: number`
- `refreshBills` 成功后 `refreshTrigger += 1`

**`src/pages/Home.tsx`**：
- `loadData` 依赖项中加入 `refreshTrigger`
- 每次记账/编辑/删除后，bills 变化 → trigger 变化 → Home 自动重拉 stats

### 备选方案

也可以让 `refreshBills` 完成后直接在 store 中更新 stats，但这样 store 会耦合 stats 请求逻辑。采用 trigger 方案更解耦，Home 自己决定何时重新拉 stats。

---

## 影响文件汇总

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `main-process/database.ts` | 修改 | bills 表加 type 字段、getStats 加 type 参数 |
| `main-process/main.ts` | 修改 | IPC handler 传递 type |
| `main-process/preload.ts` | 修改 | getStats 签名加 type |
| `src/types/index.ts` | 修改 | Bill、AddBillForm 加 type |
| `src/data/incomeCategories.ts` | **新建** | 6 个收入一级分类 + 16 个二级分类 |
| `src/components/AddBillDialog.tsx` | 修改 | 支出/收入切换、动态分类、颜色适配 |
| `src/components/CategorySelect.tsx` | 修改 | 支持外部传入分类数据（支出/收入两套） |
| `src/pages/Home.tsx` | 修改 | 滚动、二级分类、收入卡片、trigger 刷新 |
| `src/pages/Bills.tsx` | 修改 | 收入显示、筛选 |
| `src/pages/Stats.tsx` | 修改 | 收入统计 |
| `src/store/index.ts` | 修改 | refreshTrigger |
| `src/index.css` | 可能修改 | 收入相关颜色类（可选） |

---

## 不变更的范围

- 预设支出分类不变（10 个大类 57 个小类）
- 菜单栏、快捷键、Toast 系统不变
- 导出 CSV 功能：后续迭代再加 type 列，本次暂不改

---

## 验证清单

- [ ] 已有数据库（v1.x）启动后不报错，旧数据自动为支出类型
- [ ] 记一笔弹窗支出/收入切换正常，分类列表正确切换
- [ ] 收入记录在首页和账单列表显示绿色 +¥
- [ ] 首页统计卡片显示本月收入、本月支出、本月结余
- [ ] Top 5 显示二级分类明细
- [ ] 最近记录可滚动
- [ ] 记一笔后回到首页数据自动刷新
- [ ] 打包部署成功
