import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { occurrenceIdSchema } from '@stage-tracker/domain';
import { inviteToOccurrenceAction } from '@/lib/actions/invitation.actions';
import { InviteForm } from './InviteForm';

vi.mock('@/lib/actions/invitation.actions', () => ({ inviteToOccurrenceAction: vi.fn() }));

const occurrenceId = occurrenceIdSchema.parse('11111111-1111-4111-8111-111111111111');
const mockedAction = vi.mocked(inviteToOccurrenceAction);

describe('InviteForm', () => {
  beforeEach(() => mockedAction.mockReset());

  it('starts closed, showing only the trigger', () => {
    render(<InviteForm occurrenceId={occurrenceId} />);
    expect(screen.getByRole('button', { name: '招待する' })).toBeInTheDocument();
    expect(screen.queryByLabelText('招待するメールアドレス')).not.toBeInTheDocument();
  });

  it('auto-closes after success without exposing invitee branch details', async () => {
    const user = userEvent.setup();
    mockedAction.mockResolvedValue({ data: { outcome: 'invite-sent' } });
    render(<InviteForm occurrenceId={occurrenceId} />);
    for (const email of [
      'no-row@example.test',
      'considering@example.test',
      'attending@example.test',
    ]) {
      await user.click(screen.getByRole('button', { name: '招待する' }));
      await user.type(screen.getByLabelText('招待するメールアドレス'), email);
      await user.click(screen.getByRole('button', { name: '送信' }));
      await waitFor(() =>
        expect(screen.queryByRole('heading', { name: '招待する' })).not.toBeInTheDocument(),
      );
    }
    expect(mockedAction).toHaveBeenCalledTimes(3);
    expect(mockedAction).toHaveBeenNthCalledWith(1, { occurrenceId, email: 'no-row@example.test' });
  });

  it('keeps the Sheet open for validation errors', async () => {
    const user = userEvent.setup();
    mockedAction.mockResolvedValueOnce({
      validationErrors: { email: { _errors: ['invalid'] } },
    } as unknown as Awaited<ReturnType<typeof inviteToOccurrenceAction>>);
    render(<InviteForm occurrenceId={occurrenceId} />);
    await user.click(screen.getByRole('button', { name: '招待する' }));
    await user.type(screen.getByLabelText('招待するメールアドレス'), 'valid@example.test');
    await user.click(screen.getByRole('button', { name: '送信' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'メールアドレスの形式を確認してください。',
    );
    expect(screen.getByRole('heading', { name: '招待する' })).toBeInTheDocument();
  });

  it('keeps the Sheet open for server errors', async () => {
    const user = userEvent.setup();
    mockedAction.mockResolvedValueOnce({
      serverError: { kind: 'validation', message: '自分自身を招待することはできません。' },
    });
    render(<InviteForm occurrenceId={occurrenceId} />);
    await user.click(screen.getByRole('button', { name: '招待する' }));
    await user.type(screen.getByLabelText('招待するメールアドレス'), 'me@example.test');
    await user.click(screen.getByRole('button', { name: '送信' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '自分自身を招待することはできません。',
    );
    expect(screen.getByRole('heading', { name: '招待する' })).toBeInTheDocument();
  });
});
