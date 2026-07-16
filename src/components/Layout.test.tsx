import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Layout } from './Layout';
import { useStore } from '@/store';

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

  it('should render ToastContainer', () => {
    useStore.setState({
      toasts: [{ id: 't1', type: 'success', message: '测试消息' }],
    });

    render(
      <Layout onOpenSettings={() => {}}>
        <div>Content</div>
      </Layout>
    );

    expect(screen.getByText('测试消息')).toBeInTheDocument();
  });
});
