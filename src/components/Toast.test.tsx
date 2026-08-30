import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastContainer } from './Toast';
import { useStore } from '@/store';

describe('ToastContainer', () => {
  beforeEach(() => {
    // Reset store to initial state
    useStore.setState({
      toasts: [],
    });
  });

  it('should render nothing when there are no toasts', () => {
    const { container } = render(<ToastContainer />);
    expect(container.innerHTML).toBe('');
  });

  it('should render a success toast', () => {
    useStore.setState({
      toasts: [{ id: 'toast-1', type: 'success', message: '操作成功' }],
    });

    render(<ToastContainer />);

    expect(screen.getByText('操作成功')).toBeInTheDocument();
  });

  it('should render an error toast', () => {
    useStore.setState({
      toasts: [{ id: 'toast-2', type: 'error', message: '操作失败' }],
    });

    render(<ToastContainer />);

    expect(screen.getByText('操作失败')).toBeInTheDocument();
  });

  it('should render an info toast', () => {
    useStore.setState({
      toasts: [{ id: 'toast-3', type: 'info', message: '提示信息' }],
    });

    render(<ToastContainer />);

    expect(screen.getByText('提示信息')).toBeInTheDocument();
  });

  it('should render multiple toasts', () => {
    useStore.setState({
      toasts: [
        { id: 'toast-1', type: 'success', message: '成功' },
        { id: 'toast-2', type: 'error', message: '失败' },
        { id: 'toast-3', type: 'info', message: '提示' },
      ],
    });

    render(<ToastContainer />);

    expect(screen.getByText('成功')).toBeInTheDocument();
    expect(screen.getByText('失败')).toBeInTheDocument();
    expect(screen.getByText('提示')).toBeInTheDocument();
  });

  it('should call removeToast when close button is clicked', () => {
    const removeToastSpy = vi.spyOn(useStore.getState(), 'removeToast');

    useStore.setState({
      toasts: [{ id: 'toast-1', type: 'success', message: '测试' }],
    });

    render(<ToastContainer />);

    // Find and click the close button (X icon)
    const buttons = screen.getAllByRole('button');
    // The first button is the close button for the toast
    fireEvent.click(buttons[0]);

    expect(removeToastSpy).toHaveBeenCalledWith('toast-1');
    removeToastSpy.mockRestore();
  });

  it('should apply correct CSS classes for success toast', () => {
    useStore.setState({
      toasts: [{ id: 'toast-1', type: 'success', message: '成功' }],
    });

    render(<ToastContainer />);

    const toastElement = screen.getByText('成功').closest('.aurora-toast-success');
    expect(toastElement).not.toBeNull();
  });

  it('should apply correct CSS classes for error toast', () => {
    useStore.setState({
      toasts: [{ id: 'toast-1', type: 'error', message: '失败' }],
    });

    render(<ToastContainer />);

    const toastElement = screen.getByText('失败').closest('.aurora-toast-error');
    expect(toastElement).not.toBeNull();
  });

  it('should apply correct CSS classes for info toast', () => {
    useStore.setState({
      toasts: [{ id: 'toast-1', type: 'info', message: '提示' }],
    });

    render(<ToastContainer />);

    const toastElement = screen.getByText('提示').closest('.aurora-toast-info');
    expect(toastElement).not.toBeNull();
  });

  it.each([
    ['success', '成功'],
    ['error', '失败'],
    ['info', '提示'],
  ] as const)('should render a lightweight semantic icon for %s toasts', (type, message) => {
    useStore.setState({
      toasts: [{ id: `toast-${type}`, type, message }],
    });

    render(<ToastContainer />);

    const toastElement = screen.getByText(message).closest('.aurora-toast');
    const icon = toastElement?.querySelector('.aurora-toast-icon');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(toastElement).not.toHaveClass('aurora-toast-mark');
  });

  it('should keep the close action accessible', () => {
    useStore.setState({
      toasts: [{ id: 'toast-1', type: 'info', message: '提示' }],
    });

    render(<ToastContainer />);

    expect(screen.getByRole('button', { name: '关闭通知' })).toBeInTheDocument();
  });
});
