import type { Preview } from "@storybook/nextjs-vite";
// Tailwind v4 の utility class を Storybook のプレビュー iframe にも
// 適用するために globals.css を直接 import する（これをしないと shadcn
// コンポーネントにスタイルが一切当たらない）。
import "../src/app/globals.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // Storybook 9 の標準 test-runner で全 story を検査し、violation を
      // CLI / CI failure として扱う。
      test: "error",
      config: {
        rules: [
          // isolated component story は full document ではないため、page-level
          // structure を要求する best-practice rule のみ無効化する。
          { id: "landmark-one-main", enabled: false },
          { id: "page-has-heading-one", enabled: false },
        ],
      },
    },
  },
};

export default preview;
