import type { NextConfig } from 'next';

// Scripts, styles, fonts and images all come from this origin; nothing is loaded from another site. Univer draws on a
// canvas and uses blob workers and inline styles, which is why those two allowances are here. The development server
// builds pages with eval, so it alone is allowed that; a production build never is.
const DEV = process.env.NODE_ENV === 'development';
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${DEV ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // Univer's Office import has a native part. Only that part is loaded from node_modules as it is; the rest is bundled
  // with the server code, because left outside it loads Univer's CommonJS build, which cannot load on every host.
  serverExternalPackages: ['@univerjs-pro/exchange-node-binding'],
  // The native part is chosen at run time, so the build cannot see that the two routes below need it.
  outputFileTracingIncludes: {
    '/api/import/status': ['./node_modules/@univerjs-pro/exchange-node-binding*/**/*'],
    '/api/p/*/runs/*/model': ['./node_modules/@univerjs-pro/exchange-node-binding*/**/*'],
  },
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: CSP },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
      ],
    }];
  },
};
export default nextConfig;
