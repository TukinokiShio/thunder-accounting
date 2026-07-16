/**
 * 预设收入分类数据。
 * 共 6 个大类、17 个二级分类，结构与支出分类一致。
 * 首次启动时自动写入数据库，预设分类受保护不可删除。
 */
import type { Category } from '@/types'

export const incomeCategories: Category[] = [
  {
    name: '工资薪水',
    icon: '💼',
    children: ['基本工资', '奖金绩效', '加班补贴']
  },
  {
    name: '兼职副业',
    icon: '💻',
    children: ['自由职业', '稿费版税', '咨询费']
  },
  {
    name: '投资理财',
    icon: '📈',
    children: ['股票基金', '利息分红', '房租收入']
  },
  {
    name: '红包转账',
    icon: '🎁',
    children: ['微信红包', '亲友转账', '节日礼金']
  },
  {
    name: '退款报销',
    icon: '↩️',
    children: ['购物退款', '费用报销', '押金退还']
  },
  {
    name: '其他收入',
    icon: '📦',
    children: ['二手出售', '其他']
  }
]
