import 'dotenv/config';
import express from 'express';
import { connectDB } from './config/db.js';
import { getCorsOptions } from './config/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import apiRouter from './routes/index.js';

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);

app.use(getCorsOptions());
app.use(express.json({ limit: '10mb' }));
app.use('/api', apiRouter);
app.use(errorHandler);

try {
  connectDB(); // synchronous SQLite open
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
    console.log(`[Server] API available at http://localhost:${PORT}/api`);
  });
} catch (err) {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
}
