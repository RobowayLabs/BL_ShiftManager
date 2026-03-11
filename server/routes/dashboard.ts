import { Router, Request, Response } from 'express';
import * as dashboardService from '../services/dashboardService.js';

const router = Router();

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await dashboardService.getDashboardStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/alert-trends', async (_req: Request, res: Response) => {
  try {
    const trends = await dashboardService.getAlertTrends();
    res.json(trends);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/alert-distribution', async (_req: Request, res: Response) => {
  try {
    const distribution = await dashboardService.getAlertDistribution();
    res.json(distribution);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
