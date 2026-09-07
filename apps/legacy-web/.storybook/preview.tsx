import type { Preview } from '@storybook/nextjs-vite';
import '../src/ui/globals.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // 'todo' = a11y violationsをtest UIにのみ表示する。QA aidとして使い、
      // compliance自体の証明にはしない(docs/ux-ui.md「Accessibility baseline」参照)。
      test: 'todo',
    },
  },
};

export default preview;
