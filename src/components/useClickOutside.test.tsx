import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useClickOutside } from './useClickOutside';

// Test component that uses the hook
function TestComponent({
  handler,
  enabled = true,
}: {
  handler: () => void;
  enabled?: boolean;
}) {
  const ref = useClickOutside<HTMLDivElement>(handler, enabled);
  return (
    <div>
      <div data-testid="outside">Outside</div>
      <div ref={ref} data-testid="inside">
        Inside
        <button data-testid="inside-btn">Button</button>
      </div>
    </div>
  );
}

describe('useClickOutside', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should call handler when clicking outside the ref element', () => {
    const handler = vi.fn();
    render(<TestComponent handler={handler} />);

    fireEvent.mouseDown(screen.getByTestId('outside'));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should not call handler when clicking inside the ref element', () => {
    const handler = vi.fn();
    render(<TestComponent handler={handler} />);

    fireEvent.mouseDown(screen.getByTestId('inside'));

    expect(handler).not.toHaveBeenCalled();
  });

  it('should not call handler when clicking a child inside the ref element', () => {
    const handler = vi.fn();
    render(<TestComponent handler={handler} />);

    fireEvent.mouseDown(screen.getByTestId('inside-btn'));

    expect(handler).not.toHaveBeenCalled();
  });

  it('should not call handler when enabled is false', () => {
    const handler = vi.fn();
    render(<TestComponent handler={handler} enabled={false} />);

    fireEvent.mouseDown(screen.getByTestId('outside'));

    expect(handler).not.toHaveBeenCalled();
  });

  it('should call handler on document mousedown (not click)', () => {
    const handler = vi.fn();
    render(<TestComponent handler={handler} />);

    // 'click' event should NOT trigger the handler (only 'mousedown' does)
    fireEvent.click(screen.getByTestId('outside'));

    expect(handler).not.toHaveBeenCalled();
  });

  it('should cleanup event listener on re-render with enabled=false', () => {
    const handler = vi.fn();
    const { rerender } = render(<TestComponent handler={handler} />);

    // First verify it works when enabled
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(handler).toHaveBeenCalledTimes(1);

    // Disable
    rerender(<TestComponent handler={handler} enabled={false} />);
    handler.mockClear();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('should work with updated handler reference', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const { rerender } = render(<TestComponent handler={handler1} />);

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(handler1).toHaveBeenCalledTimes(1);

    // Update handler
    rerender(<TestComponent handler={handler2} />);

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler1).toHaveBeenCalledTimes(1); // old handler no longer called
  });

  it('should not call handler after component unmounts', () => {
    const handler = vi.fn();
    const { unmount } = render(<TestComponent handler={handler} />);

    unmount();

    fireEvent.mouseDown(document.body);
    expect(handler).not.toHaveBeenCalled();
  });
});
