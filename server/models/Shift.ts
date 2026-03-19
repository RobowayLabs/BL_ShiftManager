import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IShift extends Document {
  shiftId: string;
  employeeId: string;
  date: string;
  type: 'Morning' | 'Afternoon' | 'Night';
  startTime: string;
  endTime: string;
  lateGraceMinutes: number;
  status: 'Scheduled' | 'In Progress' | 'Completed' | 'Missed';
  aiMetadata?: {
    actualStart?: string;
    actualEnd?: string;
    breakTime?: string;
    alerts: {
      drowsy: number;
      sleep: number;
      phone: number;
      absence: number;
    };
  };
  syncedFromPyQt: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SHIFT_TIMES: Record<string, { start: string; end: string }> = {
  Morning: { start: '08:00', end: '16:00' },
  Afternoon: { start: '16:00', end: '00:00' },
  Night: { start: '00:00', end: '08:00' },
};

const ShiftSchema = new Schema<IShift>(
  {
    shiftId: { type: String, required: true, unique: true, index: true },
    employeeId: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ['Morning', 'Afternoon', 'Night'],
      required: true,
    },
    startTime: { type: String, default: '08:00' },
    endTime: { type: String, default: '16:00' },
    lateGraceMinutes: { type: Number, default: 15 },
    status: {
      type: String,
      enum: ['Scheduled', 'In Progress', 'Completed', 'Missed'],
      default: 'Scheduled',
    },
    aiMetadata: {
      actualStart: String,
      actualEnd: String,
      breakTime: String,
      alerts: {
        drowsy: { type: Number, default: 0 },
        sleep: { type: Number, default: 0 },
        phone: { type: Number, default: 0 },
        absence: { type: Number, default: 0 },
      },
    },
    syncedFromPyQt: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(ShiftSchema as any).pre('save', function (this: any, next: () => void) {
  if (!this.startTime || !this.endTime) {
    const times = SHIFT_TIMES[this.type as string];
    if (times) {
      this.startTime = times.start;
      this.endTime = times.end;
    }
  }
  next();
});

ShiftSchema.index({ employeeId: 1, date: 1 });
ShiftSchema.index({ date: 1, type: 1 });

export default (mongoose.models['Shift'] || mongoose.model<IShift>('Shift', ShiftSchema)) as Model<IShift>;
