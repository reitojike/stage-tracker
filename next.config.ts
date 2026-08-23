import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // AGENTS.md is a Foundation-generated adapter (tooling/sync.mjs). Next.js 16.3+
  // `next dev` otherwise upserts its own managed block into that generated file
  // whenever it detects an AI coding agent in the environment, silently dirtying
  // the working tree. Verified by `npm run agent-rules:check`.
  agentRules: false,
};

export default nextConfig;
