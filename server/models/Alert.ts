import mongoose, { Schema, Document } from 'mongoose';

export interface IAlert extends Document {
  alertId: string;
  timestamp: Date;
  type: 'Critical' | 'Warning' | 'Info';
  category: 'drowsy' | 'sleep' | 'phone' | 'absence' | 'system';
  severity: string;
  message: string;
  source: string;
  employeeId?: string;
  cameraId?: string;
  shiftLabel?: string;
  acknowledged: boolean;
  createdAt: Date;
}

const AlertSchema = new Schema<IAlert>(
  {
    alertId: { type: String, required: true, unique: true, index: true },
    timestamp: { type: Date, required: true, index: true },
    type: { type: String, enum: ['Critical', 'Warning', 'Info'], required: true },
    category: {
      type: String,
      enum: ['drowsy', 'sleep', 'phone', 'absence', 'system'],
      required: true,
    },
    severity: { type: String, default: 'medium' },
    message: { type: String, required: true },
    source: { type: String, required: true },
    employeeId: { type: String, index: true },
    cameraId: { type: String },
    shiftLabel: { type: String },
    acknowledged: { type: Boolean, default: false },
  },
  { timestamps: true }
);

AlertSchema.index({ timestamp: -1 });
AlertSchema.index({ employeeId: 1, timestamp: -1 });

export default mongoose.model<IAlert>('Alert', AlertSchema);
