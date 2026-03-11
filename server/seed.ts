import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { connectDB, getDB } from './config/db.js';

async function seed() {
  connectDB();
  const db = getDB();

  const adminHash   = await bcrypt.hash('admin123', 10);
  const managerHash = await bcrypt.hash('manager123', 10);

  // Upsert admin user (role = 'admin' → maps to super_admin in web)
  db.prepare(`
    INSERT INTO users (username, password_hash, role, active)
    VALUES ('admin', ?, 'admin', 1)
    ON CONFLICT(username) DO UPDATE SET
      password_hash = excluded.password_hash,
      role = 'admin',
      active = 1
  `).run(adminHash);

  // Upsert manager user (role = 'manager' → maps to manager in web)
  db.prepare(`
    INSERT INTO users (username, password_hash, role, active)
    VALUES ('manager', ?, 'manager', 1)
    ON CONFLICT(username) DO UPDATE SET
      password_hash = excluded.password_hash,
      role = 'manager',
      active = 1
  `).run(managerHash);

  // Show existing data stats
  const empCount   = (db.prepare('SELECT COUNT(*) as cnt FROM employees').get() as any).cnt;
  const alertCount = (db.prepare('SELECT COUNT(*) as cnt FROM alert_events').get() as any).cnt;
  const shiftCount = (db.prepare('SELECT COUNT(*) as cnt FROM shifts').get() as any).cnt;

  console.log('[Seed] Done!');
  console.log('[Seed] Login credentials:');
  console.log('  Super Admin: admin / admin123');
  console.log('  Manager:     manager / manager123');
  console.log(`[Seed] Existing DB data: ${empCount} employees, ${shiftCount} shift templates, ${alertCount} alerts`);

  process.exit(0);
}

seed().catch((err) => {
  console.error('[Seed] Error:', err);
  process.exit(1);
});
