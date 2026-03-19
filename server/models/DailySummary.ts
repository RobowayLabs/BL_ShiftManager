import mongoose, { Schema, Document } from 'mongoose';

export interface IDailySummary extends Document {
  employeeId: string;
  date: string;
  totalWorkSec: number;
  sleepSec: number;
  drowsySec: number;
  yawnCount: number;
  phoneSec: number;
  phoneCount: number;
  absenceSec: number;
  productivity: number;
  createdAt: Date;
  updatedAt: Date;
}

const DailySummarySchema = new Schema<IDailySummary>(
  {
    employeeId: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true },
    totalWorkSec: { type: Number, default: 0 },
    sleepSec: { type: Number, default: 0 },
    drowsySec: { type: Number, default: 0 },
    yawnCount: { type: Number, default: 0 },
    phoneSec: { type: Number, default: 0 },
    phoneCount: { type: Number, default: 0 },
    absenceSec: { type: Number, default: 0 },
    productivity: { type: Number, default: 0, min: 0, max: 100 },
  },
  { timestamps: true }
);

DailySummarySchema.index({ employeeId: 1, date: 1 }, { unique: true });

export default (mongoose.models.DailySummary || mongoose.model<IDailySummary>('DailySummary', DailySummarySchema)) as ReturnType<typeof mongoose.model<IDailySummary>>;
