/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@investment-sync/api",
    "@investment-sync/backend",
    "@investment-sync/db",
    "@investment-sync/importers",
    "@investment-sync/analytics",
  ],
};

export default nextConfig;
