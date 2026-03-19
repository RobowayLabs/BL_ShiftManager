import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from './models/User';
import Employee from './models/Employee';
import Shift from './models/Shift';
import Alert from './models/Alert';

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set in environment');

  await mongoose.connect(uri);
  console.log('[Seed] Connected to MongoDB');

  const adminHash = await bcrypt.hash('admin123', 10);
  const managerHash = await bcrypt.hash('manager123', 10);

  await User.findOneAndUpdate(
    { username: 'admin' },
    { $set: { username: 'admin', passwordHash: adminHash, role: 'super_admin', name: 'Admin', active: true } },
    { upsert: true, new: true }
  );

  await User.findOneAndUpdate(
    { username: 'manager' },
    { $set: { username: 'manager', passwordHash: managerHash, role: 'manager', name: 'Manager', active: true } },
    { upsert: true, new: true }
  );

  const [empCount, shiftCount, alertCount] = await Promise.all([
    Employee.countDocuments(),
    Shift.countDocuments(),
    Alert.countDocuments(),
  ]);

  console.log('[Seed] Done!');
  console.log('[Seed] Login credentials:');
  console.log('  Super Admin: admin / admin123');
  console.log('  Manager:     manager / manager123');
  console.log(`[Seed] Existing data: ${empCount} employees, ${shiftCount} shifts, ${alertCount} alerts`);

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('[Seed] Error:', err);
  process.exit(1);
});
