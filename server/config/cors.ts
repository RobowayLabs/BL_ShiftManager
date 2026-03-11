import cors from 'cors';

export function getCorsOptions() {
  const allowedOrigins = [
    'http://localhost:3000',
    process.env.APP_URL,
  ].filter(Boolean) as string[];

  return cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    credentials: true,
  });
}
