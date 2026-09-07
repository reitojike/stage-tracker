'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/ui/Button';

/**
 * Retry action for the read-failure StatePanel (Issue #195/#187 canonical
 * copy: `読み込めませんでした` + `再読み込み`). `router.refresh()` re-runs
 * this Server Component page (same pattern as My Page's
 * RegisterPasskeyButton) rather than a full `window.location.reload()`.
 */
export function CatalogReloadButton() {
  const router = useRouter();

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => {
        router.refresh();
      }}
    >
      再読み込み
    </Button>
  );
}
