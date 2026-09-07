import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// テスト間で jsdom へ残った DOM をクリーンにする（React Testing Library）。
afterEach(() => {
  cleanup();
});
