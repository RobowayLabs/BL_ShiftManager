import mongoose from 'mongoose';

const g = global as typeof globalThis & {
  _mongoose: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
};

if (!g._mongoose) {
  g._mongoose = { conn: null, promise: null };
}

export async function connectDB(): Promise<typeof mongoose> {
  if (g._mongoose.conn) return g._mongoose.conn;
  if (!g._mongoose.promise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI not set in environment');
    g._mongoose.promise = mongoose.connect(uri, { bufferCommands: false });
  }
  g._mongoose.conn = await g._mongoose.promise;
  console.log('[MongoDB] Connected');
  return g._mongoose.conn;
}
