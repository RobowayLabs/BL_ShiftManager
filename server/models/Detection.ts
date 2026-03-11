import mongoose, { Schema, Document } from 'mongoose';

export interface IDetection extends Document {
  employeeId: string;
  timestamp: Date;
  eventType: 'face_in' | 'face_out' | 'drowsy' | 'sleep' | 'phone' | 'absence';
  confidence: number;
  cameraId: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

const DetectionSchema = new Schema<IDetection>(
  {
    employeeId: { type: String, required: true, index: true },
    timestamp: { type: Date, required: true, index: true },
    eventType: {
      type: String,
      enum: ['face_in', 'face_out', 'drowsy', 'sleep', 'phone', 'absence'],
      required: true,
    },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    cameraId: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

DetectionSchema.index({ employeeId: 1, timestamp: -1 });
DetectionSchema.index({ eventType: 1, timestamp: -1 });

export default mongoose.model<IDetection>('Detection', DetectionSchema);
