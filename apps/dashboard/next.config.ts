import type { NextConfig } from 'next';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '../../'),
  async rewrites() {
    const locked = [
      'cold-calls', 'session', 'recordings', 'session-logs', 'companies',
      'leads', 'notes', 'follow-ups', 'email', 'recycle-bin', 'roles',
      'actors', 'goals', 'settings', 'search',
    ];
    return locked.map((route) => ({
      source: `/${route}/:path*`,
      destination: `/locked?feature=${encodeURIComponent(route)}`,
    }));
  },
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '8090',
        pathname: '/api/files/**',
      },
      {
        protocol: 'https',
        hostname: 'randomuser.me',
        pathname: '/api/portraits/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'crmdb.tableturnerr.com',
        pathname: '/api/files/**',
      },
    ],
  },
};

export default nextConfig;
