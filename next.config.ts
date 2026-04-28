import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Suppress TypeScript and ESLint errors during production builds
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },

  // Prevent Turbopack from inferring the repo root from unrelated lockfiles.
  turbopack: {
    root: __dirname,
  },
  // Allow accessing the dev server via either hostname without asset/HMR issues.
  // Next compares only the request hostname (not scheme/port).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
