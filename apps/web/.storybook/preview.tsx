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
      // 'todo' = a11y violation を test UI にのみ表示する。QA aid として
      // 使い、compliance 自体の証明にはしない。
      test: "todo",
    },
  },
};

export default preview;
