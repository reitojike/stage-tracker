import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './checkbox';
import { RadioChip, RadioGroup } from './radio-group';

describe('selection controls', () => {
  it('uses Base UI checkbox semantics and reports controlled changes', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <label>
        <Checkbox checked={false} onCheckedChange={onCheckedChange} />
        星組
      </label>,
    );

    await user.click(screen.getByRole('checkbox', { name: '星組' }));
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it('preserves native checkbox FormData semantics', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <label>
          <Checkbox name="blocking" defaultChecked />
          blocking
        </label>
      </form>,
    );

    const form = container.querySelector('form');
    if (form === null) {
      throw new Error('Expected a form');
    }
    expect(new FormData(form).get('blocking')).toBe('on');

    await user.click(screen.getByRole('checkbox', { name: 'blocking' }));
    expect(new FormData(form).get('blocking')).toBeNull();
  });

  it('uses Base UI radio-group keyboard and selection semantics', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <RadioGroup value="all" onValueChange={onValueChange}>
        <RadioChip value="all">すべて</RadioChip>
        <RadioChip value="takarazuka">宝塚</RadioChip>
      </RadioGroup>,
    );

    await user.click(screen.getByRole('radio', { name: '宝塚' }));
    expect(onValueChange).toHaveBeenCalledWith('takarazuka', expect.anything());
  });

  it('submits the selected radio value and supports arrow-key selection', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <RadioGroup name="temporalMode" defaultValue="all-day">
          <RadioChip value="all-day">終日</RadioChip>
          <RadioChip value="time-bounded">時刻指定</RadioChip>
        </RadioGroup>
      </form>,
    );

    const form = container.querySelector('form');
    if (form === null) {
      throw new Error('Expected a form');
    }
    expect(new FormData(form).get('temporalMode')).toBe('all-day');

    const allDay = screen.getByRole('radio', { name: '終日' });
    allDay.focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('radio', { name: '時刻指定' })).toBeChecked();
    expect(new FormData(form).get('temporalMode')).toBe('time-bounded');
  });
});
