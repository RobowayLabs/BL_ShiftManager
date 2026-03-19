import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IEmployee extends Document {
  employeeId: string;
  name: string;
  department: string;
  active: boolean;
  lastSyncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const EmployeeSchema = new Schema<IEmployee>(
  {
    employeeId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    department: { type: String, default: 'Unassigned' },
    active: { type: Boolean, default: true },
    lastSyncedAt: { type: Date },
  },
  { timestamps: true }
);

export default (mongoose.models['Employee'] || mongoose.model<IEmployee>('Employee', EmployeeSchema)) as Model<IEmployee>;
