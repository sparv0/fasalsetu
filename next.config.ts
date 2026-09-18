import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: path.join(__dirname) },
  experimental: {
    serverActions: {
      // Lot photos are capped at 3 MB each in the upload action; leave headroom for form overhead.
      bodySizeLimit: "4mb",
      // Public demo is served through a Cloudflare quick tunnel.
      allowedOrigins: ["*.trycloudflare.com"],
    },
  },
};

export default nextConfig;
