import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit"],
  typedRoutes: true,
  turbopack: {
    root: path.join(process.cwd())
  }
};

export default nextConfig;
