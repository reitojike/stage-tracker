import Link, { type LinkProps } from 'next/link';
import type { AnchorHTMLAttributes } from 'react';
import type { VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { buttonVariants } from './ui/button';

type ButtonAppearance = VariantProps<typeof buttonVariants>;

export type LinkButtonProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> &
  ButtonAppearance;

/** Navigation rendered with native anchor semantics and shadcn Button appearance. */
export function LinkButton({ className, variant, size, ...props }: LinkButtonProps) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export type AnchorButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & ButtonAppearance;

/** External anchor variant of LinkButton; never assigns button semantics to a link. */
export function AnchorButton({ className, variant, size, ...props }: AnchorButtonProps) {
  return <a className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
