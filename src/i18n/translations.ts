/**
 * 中→英文翻译映射表。
 * Key 为中文原文，Value 为英文翻译。
 * 用法：import { T } from './translations'; T['设置'] // 'Settings'
 */

export const T: Record<string, string> = {
  // ── 通用 ──
  '设置': 'Settings',
  '确认': 'Confirm',
  '取消': 'Cancel',
  '保存': 'Save',
  '更新': 'Update',
  '删除': 'Delete',
  '编辑': 'Edit',
  '关闭': 'Close',
  '添加': 'Add',
  '搜索': 'Search',
  '清除': 'Clear',
  '重试': 'Retry',
  '导出': 'Export',
  '导入': 'Import',

  // ── 侧边栏 ──
  '雷霆记账': 'Thunder Books',
  '总览': 'Overview',
  '账单': 'Bills',
  '统计': 'Stats',
  '分类管理': 'Categories',

  // ── Layout ──
  '记一笔': 'Add Bill',

  // ── 首页 ──
  '今日支出': 'Today',
  '本月支出': 'This Month',
  '日均支出': 'Daily Avg',
  '累计记录': 'Records',
  '本月收入': 'Income',
  '本月结余': 'Balance',
  '收大于支': 'Surplus',
  '支大于收': 'Deficit',
  '笔': 'txns',
  '本月账单数': 'Month txns',
  '最近记录': 'Recent Bills',
  '暂无记录，点击右上角"记一笔"开始记账': 'No records yet. Click "Add Bill" to start!',
  '本月支出分类 Top 5': 'Top 5 Expense Categories',
  '暂无数据': 'No data',

  // ── 账单页 ──
  '搜索账单...': 'Search bills...',
  '全部分类': 'All Categories',
  '全部类型': 'All Types',
  '支出': 'Expense',
  '收入': 'Income',
  '共 {n} 条记录': '{n} records',
  '支出合计': 'Total Expense',
  '收入合计': 'Total Income',
  '还没有账单记录': 'No bills yet',
  '没有匹配的记录': 'No matching records',
  '点击右上角"记一笔"开始记账': 'Click "Add Bill" to get started',
  '尝试调整筛选条件': 'Try adjusting filters',
  '确认删除': 'Confirm Delete',
  '确定要删除这条记录吗？删除后不可恢复。': 'Delete this record? This cannot be undone.',

  // ── 记一笔弹窗 ──
  '编辑账单': 'Edit Bill',
  '金额 (¥)': 'Amount (¥)',
  '分类': 'Category',
  '日期': 'Date',
  '备注': 'Note',
  '(可选)': '(optional)',
  '添加备注...': 'Add note...',
  '保存中...': 'Saving...',
  '请输入有效的金额': 'Please enter a valid amount',
  '金额不能超过 99,999,999.99': 'Amount cannot exceed 99,999,999.99',
  '请选择一级分类': 'Please select a category',
  '请选择二级分类': 'Please select a subcategory',
  '请选择日期': 'Please select a date',
  '保存失败，请重试': 'Save failed, please retry',
  '已记录{label}：{cat} ¥{amount}': 'Recorded {label}: {cat} ¥{amount}',
  '已更新{label}：{cat} ¥{amount}': 'Updated {label}: {cat} ¥{amount}',

  // ── 统计页 ──
  '本月': 'This Month',
  '上月': 'Last Month',
  '近3个月': 'Last 3 Months',
  '导出 CSV': 'Export CSV',
  '总支出': 'Total Expense',
  '总收入': 'Total Income',
  '总笔数': 'Total Count',
  '结余': 'Balance',
  '支出分类占比': 'Expense Breakdown',
  '二级分类明细': 'Subcategory',
  '每日支出趋势': 'Daily Expense Trend',
  '分类明细': 'Category Details',
  '统计数据加载失败': 'Failed to load stats',
  '点击重试': 'Click to retry',
  '该时间段暂无数据': 'No data for this period',
  '一级分类': 'Category',
  '二级分类': 'Subcategory',
  '金额': 'Amount',
  '占比': 'Share',

  // ── 分类选择器 ──
  '选择一级分类': 'Select Category',
  '选择二级分类': 'Select Subcategory',

  // ── 分类管理 ──
  '支出分类': 'Expense',
  '收入分类': 'Income',
  '新增分类': 'Add Category',
  '分类名称': 'Category Name',
  '分类图标': 'Icon',
  '当前图标：': 'Current: ',
  '暂无分类，点击"新增分类"开始': 'No categories. Click "Add Category" to start.',
  '从左侧选择一个分类进行编辑，或点击"新增分类"': 'Select a category to edit, or click "Add Category"',
  '（预设分类）': ' (preset)',
  '输入一级分类名称': 'Enter category name',
  '预设分类名称不可修改，但可调整图标和子分类': 'Preset name is fixed, but icon and subcategories can be edited',
  '({n} 个)': '({n} items)',
  '暂无二级分类': 'No subcategories',
  '输入二级分类名称': 'Enter subcategory name',
  '删除此分类': 'Delete',
  '保存修改': 'Save',
  '创建分类': 'Create',
  '请输入分类名称': 'Please enter a category name',
  '请至少添加一个二级分类': 'Please add at least one subcategory',
  '该二级分类已存在': 'This subcategory already exists',
  '预设分类不可删除': 'Preset categories cannot be deleted',
  '分类信息加载失败，请刷新后重试': 'Failed to load category data. Please refresh.',
  '已新增分类「{name}」': 'Created category "{name}"',
  '已更新分类「{name}」': 'Updated category "{name}"',
  '已删除分类「{name}」': 'Deleted category "{name}"',
  '删除失败，请重试': 'Delete failed, please retry',

  // ── 设置页 ──
  '偏好设置': 'Preferences',
  '语言': 'Language',
  '中文': '中文',
  'English': 'English',
  '时区': 'Timezone',
  '数据管理': 'Data Management',
  '导出备份': 'Export Backup',
  '将所有账单和分类导出为 JSON 文件': 'Export all bills and categories as JSON',
  '导入备份': 'Import Backup',
  '从 JSON 备份文件恢复数据（会覆盖现有数据）': 'Restore data from JSON backup (overwrites existing data)',
  '清除所有数据': 'Clear All Data',
  '删除所有账单和自定义分类（预设分类保留）': 'Delete all bills and custom categories (presets kept)',
  '⚠️ 再次确认：清除所有数据？': '⚠️ Confirm: Clear all data?',
  '所有账单将被永久删除': 'All bills will be permanently deleted',
  '🚨 最后确认：此操作不可恢复！': '🚨 Final: This cannot be undone!',
  '点击第三次将执行清除': 'Click again to execute',
  '取消清除': 'Cancel',
  '关于': 'About',
  '快捷键': 'Shortcut',
  '快速记一笔': 'Quick add',
  '数据存储': 'Storage',
  '本地 SQLite 数据库，无需网络': 'Local SQLite, no network needed',
  '开源协议': 'License',
  '轻量级个人日常记账工具': 'Lightweight personal finance tracker',
  '数据备份已导出': 'Backup exported',
  '已取消导出': 'Export cancelled',
  '导出失败，请重试': 'Export failed, please retry',
  '导入失败，请检查文件格式': 'Import failed, check file format',
  '数据已恢复：{bills} 条账单，{categories} 个自定义分类': 'Restored: {bills} bills, {categories} categories',
  '所有数据已清除': 'All data cleared',
  '清除失败，请重试': 'Clear failed, please retry',
  '已删除：{desc}': 'Deleted: {desc}',

  // ── 未来日期警告 ──
  '⚠️ 日期晚于今天 — 确定这是一笔未来支出预登记吗？再次点击"保存"确认。':
    '⚠️ Date is in the future — confirm this is a planned expense? Click "Save" again to proceed.',

  // ── 环比 ──
  '环比': 'MoM',

  // ── Recharts tooltip ──
  '支出金额': 'Expense',

  // ── 文件对话框 ──
  'CSV 文件': 'CSV Files',
  '所有文件': 'All Files',
  'JSON 文件': 'JSON Files',

  // ── 菜单（主进程不翻译，仅占位） ──
}
