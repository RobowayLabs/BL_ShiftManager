import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  username: string;
  passwordHash: string;
  role: 'super_admin' | 'manager';
  name: string;
  active: boolean;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['super_admin', 'manager'], required: true },
    name: { type: String, required: true },
    active: { type: Boolean, default: true },
    lastLogin: { type: Date },
  },
  { timestamps: true }
);

export default (mongoose.models.User || mongoose.model<IUser>('User', UserSchema)) as ReturnType<typeof mongoose.model<IUser>>;
