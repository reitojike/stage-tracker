import { setupServer } from "msw/node";
import { handlers } from "./handlers";

/**
 * Node（Vitest）環境用の MSW server。起動・停止は
 * `src/test/setup.ts` の Vitest setup file から行う。
 */
export const server = setupServer(...handlers);
