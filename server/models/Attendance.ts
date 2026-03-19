import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IAttendance extends Document {
  employeeId: string;
  cameraId: string;
  eventType: 'in' | 'out';
  status: string;
  shiftId?: string;
  recognizedAt: Date;
  createdAt: Date;
}

const AttendanceSchema = new Schema<IAttendance>(
  {
    employeeId: { type: String, required: true, index: true },
    cameraId: { type: String, required: true },
    eventType: { type: String, enum: ['in', 'out'], required: true },
    status: { type: String, default: 'verified' },
    shiftId: { type: String, index: true },
    recognizedAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

AttendanceSchema.index({ employeeId: 1, recognizedAt: -1 });

export default (mongoose.models['Attendance'] || mongoose.model<IAttendance>('Attendance', AttendanceSchema)) as Model<IAttendance>;
