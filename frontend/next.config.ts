import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	experimental: { globalNotFound: true },
	distDir: process.env.NEXT_DIST_DIR ?? ".next",
	turbopack: { root: process.cwd() },
};

export default nextConfig;
