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
});
