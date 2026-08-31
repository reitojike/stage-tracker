'use client';

import { useState } from 'react';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';
import { ShareAddForm } from './ShareAddForm.tsx';
import styles from './ShareAddSheet.module.css';

export interface ShareAddSheetProps {
  entryId: string;
}

/**
 * Keeps share state visible on the detail page while moving only the exact
 * email input workflow into the shared bottom-sheet vocabulary.
 */
export function ShareAddSheet({ entryId }: ShareAddSheetProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="quiet"
        onClick={() => {
          setOpen(true);
        }}
      >
        + 追加
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="共有相手を追加" bodyClassName={styles.body}>
        <ShareAddForm entryId={entryId} />
      </Sheet>
    </>
  );
}
