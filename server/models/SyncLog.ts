import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ISyncLog extends Document {
  direction: 'pyqt_to_web' | 'web_to_pyqt';
  operation: string;
  recordCount: number;
  status: 'success' | 'partial' | 'failed';
  errorMessage?: string;
  sourceIp: string;
  createdAt: Date;
}

const SyncLogSchema = new Schema<ISyncLog>(
  {
    direction: { type: String, enum: ['pyqt_to_web', 'web_to_pyqt'], required: true },
    operation: { type: String, required: true },
    recordCount: { type: Number, required: true },
    status: { type: String, enum: ['success', 'partial', 'failed'], required: true },
    errorMessage: { type: String },
    sourceIp: { type: String, required: true },
  },
  { timestamps: true }
);

SyncLogSchema.index({ createdAt: -1 });

export default (mongoose.models['SyncLog'] || mongoose.model<ISyncLog>('SyncLog', SyncLogSchema)) as Model<ISyncLog>;
