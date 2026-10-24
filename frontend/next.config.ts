import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	experimental: { globalNotFound: true, agentUpgrade: "security" },
	distDir: process.env.NEXT_DIST_DIR ?? ".next",
	turbopack: { root: process.cwd() },
};

export default nextConfig;
