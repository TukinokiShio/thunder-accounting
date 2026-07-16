import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmojiPicker } from './EmojiPicker';

describe('EmojiPicker', () => {
  it('should render all 60 emoji options as buttons', () => {
    render(<EmojiPicker value="🍽️" onChange={() => {}} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(60);
  });

  it('should display the current selected value', () => {
    render(<EmojiPicker value="🎮" onChange={() => {}} />);

    // The current selection display shows the emoji in a text-2xl span
    expect(screen.getByText('当前图标：')).toBeInTheDocument();
    // The emoji appears in both the current display and the grid, so getAllByText
    const emojiElements = screen.getAllByText('🎮');
    expect(emojiElements.length).toBeGreaterThanOrEqual(2); // display + grid button
  });

  it('should call onChange when an emoji button is clicked', () => {
    const onChange = vi.fn();
    render(<EmojiPicker value="🍽️" onChange={onChange} />);

    // Click a different emoji
    const emojiButton = screen.getByText('🚗');
    fireEvent.click(emojiButton);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('🚗');
  });

  it('should display all emojis in the grid', () => {
    render(<EmojiPicker value="" onChange={() => {}} />);

    // Check a few known emojis are present
    expect(screen.getByText('🍽️')).toBeInTheDocument();
    expect(screen.getByText('💰')).toBeInTheDocument();
    expect(screen.getByText('🎓')).toBeInTheDocument();
  });

  it('should call onChange with the clicked emoji even if it is already selected', () => {
    const onChange = vi.fn();
    render(<EmojiPicker value="🔥" onChange={onChange} />);

    // Click the already-selected emoji button (not the display span)
    const emojiButtons = screen.getAllByText('🔥');
    // Filter to find the button element
    const emojiButton = emojiButtons.find(el => el.tagName === 'BUTTON');
    expect(emojiButton).toBeDefined();
    fireEvent.click(emojiButton!);

    expect(onChange).toHaveBeenCalledWith('🔥');
  });

  it('should render emoji grid with correct CSS classes', () => {
    render(<EmojiPicker value="" onChange={() => {}} />);

    // Check that the grid container exists
    const buttons = screen.getAllByRole('button');
    // First button should have base styling
    expect(buttons[0].className).toContain('rounded-md');
  });
});
