import { Router, Request, Response } from 'express';
import * as alertService from '../services/alertService.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await alertService.getAlerts({
      type: req.query.type as string,
      category: req.query.category as string,
      from: req.query.from as string,
      to: req.query.to as string,
      employeeId: req.query.employeeId as string,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:alertId/acknowledge', async (req: Request, res: Response) => {
  try {
    const alert = await alertService.acknowledgeAlert(req.params.alertId);
    res.json({ alert });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
