import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Layout } from './Layout';
import { useStore } from '@/store';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readSource = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8');
/**
 * 剥掉块注释（含 JSX 注释）与整行注释，只对**真实代码**做类名断言。
 * 注释里举例说明 CSS 层叠（比如写明 `sm:leading-normal` 为什么不是复位）是允许的，
 * 不能被下列断言误伤。
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const indexCss = readSource('src/index.css');
const homeSource = readSource('src/pages/Home.tsx');
const statsSource = readSource('src/pages/Stats.tsx');
const profileSource = readSource('src/pages/Profile.tsx');

describe('Layout', () => {
  beforeEach(() => {
    useStore.setState({
      activePage: 'home',
      toasts: [],
      expenseCategories: [],
      incomeCategories: [],
    });
  });

  it('should render the sidebar', () => {
    render(
      <Layout onOpenSettings={() => {}}>
        <div>Page Content</div>
      </Layout>
    );

    // "雷霆记账" appears in both sidebar logo and header, so we check for nav items instead
    expect(screen.getByText('总览')).toBeInTheDocument();
    expect(screen.getByText('账单')).toBeInTheDocument();
    expect(screen.getByText('统计')).toBeInTheDocument();
    expect(screen.getByText('分类管理')).toBeInTheDocument();
  });

  it('should render children', () => {
    render(
      <Layout onOpenSettings={() => {}}>
        <div data-testid="child">Page Content</div>
      </Layout>
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Page Content')).toBeInTheDocument();
  });

  it('should render the "记一笔" button', () => {
    render(
      <Layout onOpenSettings={() => {}}>
        <div>Content</div>
      </Layout>
    );

    expect(screen.getByText('记一笔')).toBeInTheDocument();
  });

  it('should call openAddDialog when "记一笔" button is clicked', () => {
    const openAddDialogSpy = vi.spyOn(useStore.getState(), 'openAddDialog');

    render(
      <Layout onOpenSettings={() => {}}>
        <div>Content</div>
      </Layout>
    );

    fireEvent.click(screen.getByText('记一笔'));
    expect(openAddDialogSpy).toHaveBeenCalledTimes(1);

    openAddDialogSpy.mockRestore();
  });

  it('should render the header with brand name', () => {
    render(
      <Layout onOpenSettings={() => {}}>
        <div>Content</div>
      </Layout>
    );

    // The header h1 also says "雷霆记账"
    const headings = screen.getAllByText('雷霆记账');
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });

  it('should pass onOpenSettings to Sidebar', () => {
    const onOpenSettings = vi.fn();
    render(
      <Layout onOpenSettings={onOpenSettings}>
        <div>Content</div>
      </Layout>
    );

    fireEvent.click(screen.getByText('设置'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('should keep one stable shell and page frame while page content changes', () => {
    const view = render(
      <Layout onOpenSettings={() => {}}>
        <div className="page-view" data-testid="home-page">Home content</div>
      </Layout>
    );

    const shell = screen.getByTestId('app-shell');
    const main = screen.getByTestId('app-main');
    const frame = screen.getByTestId('page-frame');

    expect(main.className).toContain('aurora-main');
    expect(frame.className).toContain('page-frame');

    view.rerender(
      <Layout onOpenSettings={() => {}}>
        <div className="page-view min-w-0" data-testid="bills-page">
          <div className="overflow-x-auto">Long table content</div>
        </div>
      </Layout>
    );

    expect(screen.getByTestId('app-shell')).toBe(shell);
    expect(screen.getByTestId('app-main')).toBe(main);
    expect(screen.getByTestId('page-frame')).toBe(frame);
    expect(screen.getByTestId('bills-page')).toBeInTheDocument();
    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument();
  });

  it('should enforce the non-clipping responsive overflow contract', () => {
    expect(indexCss).toMatch(/\.aurora-main\s*\{[\s\S]*overflow-x:\s*auto;[\s\S]*overflow-y:\s*auto;[\s\S]*scrollbar-gutter:\s*stable;/);
    expect(indexCss).not.toContain('overflow-x: hidden');
    expect(indexCss).not.toContain('scrollbar-gutter: stable both-edges');
    expect(indexCss).toMatch(/\.page-view\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;/);
    expect(indexCss).toMatch(/\.page-frame\s*>\s*\.h-full\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;/);
  });

  it('should keep narrow-page layout contracts in source', () => {
    // 【有意更新 2026-09】首页统计卡由「窄屏单列」改为「窄屏一行两卡」：
    // 旧契约 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' 在 412px（安卓 WebView）上退化为单列，
    // 6 张卡堆高约 630px（用户实测抱怨空间利用率差）。
    // 新契约把基类定为 2 列 —— 412px 得 2 列、640~1023px 仍是 2 列（基类生效）、≥1024px 由 lg 接管 3 列。
    expect(homeSource).toContain('home-stats-grid grid grid-cols-2 lg:grid-cols-3 gap-4')

    // 桌面零变化（一）：窄屏压缩过的「已有类」用 `sm:` 显式还原为原值。
    expect(homeSource).toContain('p-3 sm:p-4')
    expect(homeSource).toContain('mb-1.5 sm:mb-2')
    expect(homeSource).toContain('text-base sm:text-lg font-bold max-sm:leading-tight text-gray-900 dark:text-gray-100')

    // 桌面零变化（二）：原代码没有、纯为窄屏加的类必须用 `max-sm:` 限定，≥640px **不存在**该类。
    // 反面教材（9a8cd57 已修）：`leading-tight sm:leading-normal` 看似复位，实则不是 ——
    // Tailwind 编译产物里 `.sm\:text-lg`(line-height:1.75rem=28px) 排在 `.sm\:leading-normal`
    // (line-height:1.5) 之前，同特指度下后者胜，于是把 18px 字的行高改成 27px、12px 字的改成 18px。
    expect(homeSource).toContain('max-sm:shrink-0')
    expect(homeSource).toContain('max-sm:min-w-0 max-sm:truncate')
    expect(homeSource).toContain('mt-0.5 max-sm:leading-tight')
    expect(statsSource).toContain('flex items-center gap-2 max-sm:min-w-0')
    expect(statsSource).toContain('dark:text-gray-300 max-sm:truncate')

    // 桌面零变化（三）：**别拆散外部选择器依赖的字面 token**。
    // `src/index.css:510` 有一条 `.aurora-shell .home-stats-grid .w-8.h-8 { … !important }`，
    // 靠 `w-8` + `h-8` 两个字面类名同时命中，把 6 张卡的图标统一压成强调色。
    // 9a8cd57 曾把它改成 `w-7 h-7 sm:w-8 sm:h-8`：渲染尺寸仍是 32×32，但 token 变成 `sm:w-8`，
    // 选择器落空 ⇒ `!important` 失效 ⇒ 各卡 `card.color`（一直是死代码）首次生效，
    // **桌面与窄屏的图标配色同时改变**（A9 在 1280×900 量到 32 节点 / 37 属性对差异）。
    // 所以这里锁两件事：字面 token 必须原样在，且**不得**再拆成 `sm:`/`max-sm:` 形式。
    expect(homeSource).toContain('w-8 h-8 rounded-lg flex items-center justify-center max-sm:shrink-0')
    expect(stripComments(homeSource)).not.toMatch(/sm:w-8|sm:h-8|max-sm:w-7|max-sm:h-7/)

    // 结构性保证：Home.tsx 里 `leading-` 只允许以 `max-sm:` 前缀出现。
    // 这样「以为复位了其实没复位」的错以后再进不来（注释已剥离，见 stripComments）。
    const homeLeadingTokens = stripComments(homeSource).match(/[\w:-]*leading-[\w-]+/g) ?? [];
    expect(homeLeadingTokens.length).toBeGreaterThan(0); // 防「扫不到 → 过滤后为空 → 恒真」
    expect(homeLeadingTokens.filter((token) => !token.startsWith('max-sm:'))).toEqual([]);

    expect(statsSource).toContain('stats-toolbar flex flex-wrap')
    expect(statsSource).toContain('stats-summary-grid grid grid-cols-2 sm:grid-cols-4')
    expect(profileSource).toContain('profile-layout page-view w-full min-w-0 flex min-h-full flex-col')
    expect(profileSource).toContain('md:flex-row')
  });

  // Toast 测试已移至 App.test.tsx（Toast 不再在 Layout 内）
});
