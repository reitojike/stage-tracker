import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field } from './field';
import { Input } from './input';
import { Textarea } from './textarea';

describe('form controls', () => {
  it('associates a label, helper text, and validation error with an input', () => {
    render(
      <Field
        id="title"
        label="タイトル"
        required
        description="公開ページに表示されます。"
        error="タイトルを入力してください。"
      >
        <Input name="title" required />
      </Field>,
    );

    const input = screen.getByRole('textbox', { name: 'タイトル' });
    expect(input).toHaveAttribute('id', 'title');
    expect(input).toHaveAttribute('required');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'title-description title-error');
    expect(screen.getByText('公開ページに表示されます。')).toHaveAttribute(
      'id',
      'title-description',
    );
    expect(screen.getByRole('alert')).toHaveAttribute('id', 'title-error');
  });

  it('uses the same field wiring for a textarea', () => {
    render(
      <Field id="memo" label="メモ" description="任意です。">
        <Textarea name="memo" defaultValue="下書き" />
      </Field>,
    );

    const textarea = screen.getByRole('textbox', { name: 'メモ' });
    expect(textarea).toHaveValue('下書き');
    expect(textarea).toHaveAttribute('aria-describedby', 'memo-description');
  });
});
