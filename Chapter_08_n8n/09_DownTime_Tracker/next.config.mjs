/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The QA dashboard is an internal tool; linting is run separately via `npm run lint`.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
