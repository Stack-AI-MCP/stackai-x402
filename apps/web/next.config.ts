import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: { ppr: true },
  serverExternalPackages: [
    '@stacks/connect-ui',
  ],
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
    unoptimized: true,
  },
}

export default nextConfig
