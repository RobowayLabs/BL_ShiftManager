import { Router } from 'express';
import { jwtAuth } from '../middleware/jwtAuth.js';
import authRouter from './auth.js';
import employeesRouter from './employees.js';
import shiftsRouter from './shifts.js';
import alertsRouter from './alerts.js';
import dashboardRouter from './dashboard.js';
import reportsRouter from './reports.js';

const router = Router();

// Public
router.use('/auth', authRouter);

// JWT-protected
router.use('/employees', jwtAuth, employeesRouter);
router.use('/shifts',    jwtAuth, shiftsRouter);
router.use('/alerts',    jwtAuth, alertsRouter);
router.use('/dashboard', jwtAuth, dashboardRouter);
router.use('/reports',   jwtAuth, reportsRouter);

export default router;
