import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import { useStore } from '@/store';

describe('Sidebar', () => {
  beforeEach(() => {
    useStore.setState({
      activePage: 'home',
    });
  });

  it('should render the brand name', () => {
    render(<Sidebar onOpenSettings={() => {}} />);

    expect(screen.getByText('雷霆记账')).toBeInTheDocument();
  });

  it('should render all navigation items', () => {
    render(<Sidebar onOpenSettings={() => {}} />);

    expect(screen.getByText('总览')).toBeInTheDocument();
    expect(screen.getByText('账单')).toBeInTheDocument();
    expect(screen.getByText('统计')).toBeInTheDocument();
    expect(screen.getByText('分类管理')).toBeInTheDocument();
  });

  it('should render settings button', () => {
    render(<Sidebar onOpenSettings={() => {}} />);

    expect(screen.getByText('设置')).toBeInTheDocument();
  });

  it('should display version text', () => {
    render(<Sidebar onOpenSettings={() => {}} />);

    // Version text format: "雷霆记账 vX.Y.Z"
    const versionText = screen.getByText(/雷霆记账 v\d+\.\d+\.\d+/);
    expect(versionText).toBeInTheDocument();
  });

  it('should call setActivePage when a navigation item is clicked', () => {
    const setActivePageSpy = vi.spyOn(useStore.getState(), 'setActivePage');

    render(<Sidebar onOpenSettings={() => {}} />);

    fireEvent.click(screen.getByText('账单'));
    expect(setActivePageSpy).toHaveBeenCalledWith('bills');

    fireEvent.click(screen.getByText('统计'));
    expect(setActivePageSpy).toHaveBeenCalledWith('stats');

    fireEvent.click(screen.getByText('分类管理'));
    expect(setActivePageSpy).toHaveBeenCalledWith('categories');

    setActivePageSpy.mockRestore();
  });

  it('should call onOpenSettings when settings button is clicked', () => {
    const onOpenSettings = vi.fn();
    render(<Sidebar onOpenSettings={onOpenSettings} />);

    fireEvent.click(screen.getByText('设置'));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('should highlight the active navigation item', () => {
    useStore.setState({ activePage: 'bills' });

    render(<Sidebar onOpenSettings={() => {}} />);

    const billsButton = screen.getByText('账单').closest('button');
    expect(billsButton?.className).toContain('bg-primary-50');
  });

  it('should render 4 navigation buttons', () => {
    render(<Sidebar onOpenSettings={() => {}} />);

    // nav items (4) + settings button (1) = 5 buttons total
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(5);
  });
});
