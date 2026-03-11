import { Router, Request, Response } from 'express';
import * as authService from '../services/authService.js';
import { jwtAuth } from '../middleware/jwtAuth.js';
import { roleGuard } from '../middleware/roleGuard.js';

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }
    const result = await authService.login(username, password);
    res.json(result);
  } catch (err: any) {
    res.status(401).json({ error: err.message });
  }
});

// ── Auth-required ─────────────────────────────────────────────────────────────
router.get('/me', jwtAuth, async (req: Request, res: Response) => {
  try {
    const user = await authService.getUserById(req.user!.userId);
    res.json({ user });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

/** Change own credentials — any authenticated user, but must verify old password */
router.put('/change-credentials', jwtAuth, async (req: Request, res: Response) => {
  try {
    const { oldPassword, newUsername, newPassword } = req.body;
    if (!oldPassword) {
      res.status(400).json({ error: 'Current password is required.' });
      return;
    }
    if (!newUsername && !newPassword) {
      res.status(400).json({ error: 'Provide at least a new username or new password.' });
      return;
    }
    const result = await authService.changeOwnCredentials(
      req.user!.userId,
      oldPassword,
      newUsername,
      newPassword,
    );
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── Super Admin only ──────────────────────────────────────────────────────────

/** List all users */
router.get('/users', jwtAuth, roleGuard('super_admin'), async (_req: Request, res: Response) => {
  try {
    res.json({ users: authService.listUsers() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Create a new user */
router.post('/users', jwtAuth, roleGuard('super_admin'), async (req: Request, res: Response) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
      res.status(400).json({ error: 'username, password, and role are required.' });
      return;
    }
    if (role !== 'super_admin' && role !== 'manager') {
      res.status(400).json({ error: 'role must be super_admin or manager.' });
      return;
    }
    const user = await authService.createUser(username, password, role);
    res.status(201).json({ user });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/** Update a user's username, password, or role */
router.put('/users/:id', jwtAuth, roleGuard('super_admin'), async (req: Request, res: Response) => {
  try {
    const targetId = Number(req.params.id);
    const { username, password, role } = req.body;
    if (role && role !== 'super_admin' && role !== 'manager') {
      res.status(400).json({ error: 'role must be super_admin or manager.' });
      return;
    }
    const result = await authService.updateUser(targetId, { username, password, role });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/** Deactivate (soft-delete) a user */
router.delete('/users/:id', jwtAuth, roleGuard('super_admin'), async (req: Request, res: Response) => {
  try {
    const targetId = Number(req.params.id);
    // Prevent deactivating yourself
    if (String(targetId) === req.user!.userId) {
      res.status(400).json({ error: 'You cannot deactivate your own account.' });
      return;
    }
    const result = authService.deactivateUser(targetId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
