import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Spec Kit owns the repository's agent surface under .agents/ and .claude/.
  // Next.js 16.3+ otherwise creates a second root guidance surface during
  // `next dev` when it detects an AI coding agent. Keep the standard option
  // disabled so the selected Spec Kit surface remains the only project guidance
  // materialized by the active development harness.
  agentRules: false,
};

export default nextConfig;
