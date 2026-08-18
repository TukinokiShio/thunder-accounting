import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Layout } from './Layout';
import { useStore } from '@/store';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readSource = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8');
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
    expect(homeSource).toContain('home-stats-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3');
    expect(statsSource).toContain('stats-toolbar flex flex-wrap');
    expect(statsSource).toContain('stats-summary-grid grid grid-cols-2 sm:grid-cols-4');
    expect(profileSource).toContain('profile-layout page-view w-full min-w-0 flex min-h-full flex-col');
    expect(profileSource).toContain('md:flex-row');
  });

  // Toast 测试已移至 App.test.tsx（Toast 不再在 Layout 内）
});
