import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { config } from './config/index.js';
import { roomStore } from './models/RoomStore.js';
import { registerRoomHandlers } from './sockets/roomHandler.js';

const app = express();
const server = http.createServer(app);

// Helper to validate allowed origins (supports dynamic localhost dev ports e.g. 5173, 5174)
const isOriginAllowed = (origin, callback) => {
  if (!origin) return callback(null, true);
  const allowedOrigins = config.clientOrigin.split(',').map((o) => o.trim());
  if (
    allowedOrigins.includes(origin) ||
    (config.nodeEnv === 'development' && /^http:\/\/localhost:\d+$/.test(origin))
  ) {
    return callback(null, true);
  }
  return callback(new Error(`CORS blocked for origin: ${origin}`));
};

// Configure CORS for Express
app.use(
  cors({
    origin: isOriginAllowed,
    credentials: true,
  })
);

app.use(express.json());

// Initialize Socket.IO with CORS settings
const io = new SocketIOServer(server, {
  cors: {
    origin: isOriginAllowed,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Health check endpoint (for frontend connectivity check & deployment monitoring)
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'youtube-watch-party-server',
    version: '1.0.0',
    phase: 'Phase 4 - Reliable Playback Synchronization, Control Requests & Recovery',
    activeRooms: roomStore.rooms.size,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Optional REST endpoint to verify room existence before joining
app.get('/api/rooms/:roomCode', (req, res) => {
  const room = roomStore.getRoom(req.params.roomCode);
  if (!room) {
    return res.status(404).json({
      error: 'ROOM_NOT_FOUND',
      message: `Room "${req.params.roomCode}" was not found.`,
    });
  }
  return res.status(200).json({ room });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);
  registerRoomHandlers(io, socket);
});

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({
    error: 'Internal server error',
    message: config.nodeEnv === 'development' ? err.message : undefined,
  });
});

// Graceful server startup error handling (Catches EADDRINUSE cleanly without unhandled stack traces)
const PORT = config.port;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('====================================================');
    console.error(`❌ PORT CONFLICT: Port ${PORT} is already in use by another process.`);
    console.error('');
    console.error('An existing backend instance may already be running,');
    console.error(`or another service is occupying port ${PORT}.`);
    console.error('');
    console.error('Actionable steps to resolve:');
    console.error(`1. Check if the backend is already serving requests:`);
    console.error(`   curl http://localhost:${PORT}/api/health`);
    console.error('');
    console.error(`2. To stop the process occupying port ${PORT} in PowerShell:`);
    console.error(`   Get-NetTCPConnection -LocalPort ${PORT} | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`);
    console.error('');
    console.error(`3. Or launch with a custom port:`);
    console.error(`   $env:PORT=5001; npm run dev`);
    console.error('====================================================');
    process.exit(1);
  } else {
    console.error(`❌ Server failed to start: ${err.message}`);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('----------------------------------------------------');
  console.log(`🚀 YouTube Watch Party Server running on port ${PORT}`);
  console.log(`📡 Environment: ${config.nodeEnv}`);
  console.log(`🌐 Allowed Origins: ${config.clientOrigin}`);
  console.log(`🩺 Health check available at: http://localhost:${PORT}/api/health`);
  console.log('----------------------------------------------------');
});

export { app, server, io };
