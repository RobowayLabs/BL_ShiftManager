import { Router, Request, Response } from 'express';
import { syncApiKeyAuth } from '../middleware/syncAuth.js';
import * as syncService from '../services/syncService.js';

const router = Router();

// All sync routes require API key
router.use(syncApiKeyAuth);

// Health check
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const health = await syncService.getSyncHealth();
    res.json(health);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Sync logs
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const logs = await syncService.getSyncLogs(limit);
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PyQt5 -> Web: Push employees
router.post('/employees', async (req: Request, res: Response) => {
  try {
    const { employees } = req.body;
    if (!Array.isArray(employees)) {
      res.status(400).json({ error: 'employees array is required' });
      return;
    }
    const result = await syncService.processEmployeeSync(employees, req.ip || 'unknown');
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Web -> PyQt5: Pull employees
router.get('/employees', async (req: Request, res: Response) => {
  try {
    const result = await syncService.getEmployeesForSync({
      updatedSince: req.query.updatedSince as string,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PyQt5 -> Web: Push detections
router.post('/detections', async (req: Request, res: Response) => {
  try {
    const { detections } = req.body;
    if (!Array.isArray(detections)) {
      res.status(400).json({ error: 'detections array is required' });
      return;
    }
    const result = await syncService.processDetectionSync(detections, req.ip || 'unknown');
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PyQt5 -> Web: Push attendance events (face check-in/out)
router.post('/attendance', async (req: Request, res: Response) => {
  try {
    const { attendance } = req.body;
    if (!Array.isArray(attendance)) {
      res.status(400).json({ error: 'attendance array is required' });
      return;
    }
    const result = await syncService.processAttendanceEventSync(attendance, req.ip || 'unknown');
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PyQt5 -> Web: Push alerts
router.post('/alerts', async (req: Request, res: Response) => {
  try {
    const { alerts } = req.body;
    if (!Array.isArray(alerts)) {
      res.status(400).json({ error: 'alerts array is required' });
      return;
    }
    const result = await syncService.processAlertSync(alerts, req.ip || 'unknown');
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PyQt5 -> Web: Push daily summaries
router.post('/daily-summary', async (req: Request, res: Response) => {
  try {
    const { summaries } = req.body;
    if (!Array.isArray(summaries)) {
      res.status(400).json({ error: 'summaries array is required' });
      return;
    }
    const result = await syncService.processDailySummarySync(summaries, req.ip || 'unknown');
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Web -> PyQt5: Pull shifts
router.get('/shifts', async (req: Request, res: Response) => {
  try {
    const result = await syncService.getShiftsForSync({
      from: req.query.from as string,
      to: req.query.to as string,
      updatedSince: req.query.updatedSince as string,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
