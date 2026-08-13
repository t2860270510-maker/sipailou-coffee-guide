/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    const isDevelopment = process.env.NODE_ENV === "development";
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "object-src 'none'",
              `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""} https://webapi.amap.com https://*.amap.com`,
              "style-src 'self' 'unsafe-inline' https://*.amap.com",
              "img-src 'self' data: blob: https://*.amap.com https://*.autonavi.com https://*.autonavidata.com https://*.public.blob.vercel-storage.com",
              `connect-src 'self' https://*.amap.com https://*.autonavi.com https://*.autonavidata.com${isDevelopment ? " ws://localhost:* http://localhost:*" : ""}`,
              "font-src 'self' data:",
              "worker-src 'self' blob:",
              ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
            ].join("; "),
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
