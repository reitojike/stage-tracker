import type { ComponentProps } from 'react';
import { ListFilter, X } from 'lucide-react';
import { Button } from './ui/button';

export function FilterButton({
  active = false,
  ...props
}: ComponentProps<typeof Button> & { readonly active?: boolean }) {
  return (
    <Button variant="ghost" size="icon" className="relative" {...props}>
      <ListFilter aria-hidden />
      {active ? (
        <span
          aria-hidden
          className="absolute top-1 right-1 size-2 rounded-pill bg-primary ring-2 ring-background"
        />
      ) : null}
    </Button>
  );
}

export function ClearFilterButton(props: ComponentProps<typeof Button>) {
  return (
    <Button variant="ghost" size="icon-sm" {...props}>
      <X aria-hidden />
    </Button>
  );
}
