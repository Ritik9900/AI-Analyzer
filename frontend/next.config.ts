import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Desktop packaging (packaging/build.ps1) sets PA_STANDALONE=1 to get a self-contained server bundle.
  output: process.env.PA_STANDALONE === "1" ? "standalone" : undefined,
  // Pin the project root so the standalone server always lands at .next/standalone/server.js.
  ...(process.env.PA_STANDALONE === "1" ? { outputFileTracingRoot: process.cwd(), turbopack: { root: process.cwd() } } : {}),
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
};

export default nextConfig;
