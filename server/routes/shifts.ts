import { Router, Request, Response } from 'express';
import * as shiftService from '../services/shiftService.js';
import { roleGuard } from '../middleware/roleGuard.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await shiftService.getShifts({
      date: req.query.date as string,
      from: req.query.from as string,
      to: req.query.to as string,
      employeeId: req.query.employeeId as string,
      type: req.query.type as string,
      status: req.query.status as string,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:shiftId', async (req: Request, res: Response) => {
  try {
    const shift = await shiftService.getShiftById(req.params.shiftId);
    res.json({ shift });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

router.post('/', roleGuard('super_admin'), async (req: Request, res: Response) => {
  try {
    const { employeeId, date, type } = req.body;
    if (!employeeId || !date || !type) {
      res.status(400).json({ error: 'employeeId, date, and type are required' });
      return;
    }
    const shift = await shiftService.createShift({ employeeId, date, type });
    res.status(201).json({ shift });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:shiftId', roleGuard('super_admin'), async (req: Request, res: Response) => {
  try {
    const shift = await shiftService.updateShift(req.params.shiftId, req.body);
    res.json({ shift });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

router.delete('/:shiftId', roleGuard('super_admin'), async (req: Request, res: Response) => {
  try {
    const result = await shiftService.deleteShift(req.params.shiftId);
    res.json(result);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
