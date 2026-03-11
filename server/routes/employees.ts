import { Router, Request, Response } from 'express';
import * as employeeService from '../services/employeeService.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await employeeService.getEmployees({
      search: req.query.search as string,
      department: req.query.department as string,
      active: req.query.active as string,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:employeeId/performance', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      res.status(400).json({ error: 'from and to query params are required' });
      return;
    }
    const data = await employeeService.getEmployeePerformance(
      req.params.employeeId,
      from as string,
      to as string
    );
    res.json(data);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

router.get('/:employeeId', async (req: Request, res: Response) => {
  try {
    const employee = await employeeService.getEmployeeById(req.params.employeeId);
    res.json({ employee });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
