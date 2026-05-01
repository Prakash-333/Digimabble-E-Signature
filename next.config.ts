import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Suppress TypeScript errors during production builds
  typescript: { ignoreBuildErrors: true },

  // Prevent Turbopack from inferring the repo root from unrelated lockfiles.
  turbopack: {
    root: __dirname,
  },
  // Allow accessing the dev server via either hostname without asset/HMR issues.
  // Next compares only the request hostname (not scheme/port).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;