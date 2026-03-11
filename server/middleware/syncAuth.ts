import { Request, Response, NextFunction } from 'express';

export function syncApiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const expectedKey = process.env.SYNC_API_KEY;

  if (!expectedKey) {
    res.status(500).json({ error: 'SYNC_API_KEY not configured on server' });
    return;
  }

  if (!apiKey || apiKey !== expectedKey) {
    res.status(401).json({ error: 'Invalid or missing API key' });
    return;
  }

  next();
}
