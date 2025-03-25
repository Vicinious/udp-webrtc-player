const express = require('express');
const http = require('http');
const https = require('https');
const socketIo = require('socket.io');
const dgram = require('dgram');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { createHash } = require('crypto');
const os = require('os');

// Configuration
const config = {
  https: process.env.USE_HTTPS === 'true',
  httpPort: process.env.PORT || 3001,
  udpPort: process.env.UDP_PORT || 33334,
  maxBufferSize: process.env.MAX_BUFFER_SIZE || 1024 * 1024 * 5, // 5MB
  maxConnections: process.env.MAX_CONNECTIONS || 100,
  rateLimitInterval: process.env.RATE_LIMIT_INTERVAL || 1000, // 1 second
  rateLimitMaxRequests: process.env.RATE_LIMIT_MAX_REQUESTS || 50
};

// Create Express app
const app = express();

// Enable trust proxy if behind reverse proxy
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

// Security middleware
app.use((req, res, next) => {
  // Set security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'; media-src 'self' blob:;");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=self, microphone=self');
  next();
});

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    // In development allow all origins
    if (process.env.NODE_ENV !== 'production') {
      callback(null, true);
      return;
    }
    
    // In production, validate origins
    const allowedOrigins = [
      /^https?:\/\/localhost(:\d+)?$/,
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
      /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
      /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
      /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}(:\d+)?$/
    ];
    
    // Check if the origin matches any allowed pattern
    const originIsAllowed = !origin || allowedOrigins.some(pattern => pattern.test(origin));
    
    if (originIsAllowed) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  methods: ['GET', 'POST'],
  credentials: true,
  maxAge: 86400 // Cache preflight requests for 24 hours
};
app.use(cors(corsOptions));

// Rate limiting
const clientRequests = new Map();
app.use((req, res, next) => {
  const ip = req.ip;
  
  if (!clientRequests.has(ip)) {
    clientRequests.set(ip, { count: 1, timestamp: Date.now() });
    next();
    return;
  }
  
  const client = clientRequests.get(ip);
  const now = Date.now();
  
  // Reset counter if interval passed
  if (now - client.timestamp > config.rateLimitInterval) {
    client.count = 1;
    client.timestamp = now;
    next();
    return;
  }
  
  // Check if client exceeded rate limit
  if (client.count >= config.rateLimitMaxRequests) {
    console.warn(`Rate limit exceeded for IP: ${ip}`);
    res.status(429).send('Too Many Requests');
    return;
  }
  
  // Increment counter
  client.count += 1;
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0, // Cache for 1 day in production
  etag: true,
  lastModified: true
}));

// Create HTTP(S) server
let server;
if (config.https && process.env.NODE_ENV === 'production') {
  try {
    // SSL options
    const sslOptions = {
      key: fs.readFileSync(process.env.SSL_KEY_PATH || '/etc/ssl/private/server.key'),
      cert: fs.readFileSync(process.env.SSL_CERT_PATH || '/etc/ssl/certs/server.crt')
    };
    server = https.createServer(sslOptions, app);
    console.log('HTTPS server created');
  } catch (err) {
    console.error('Failed to create HTTPS server, falling back to HTTP:', err.message);
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
}

// Socket.IO server setup
const io = socketIo(server, {
  cors: corsOptions,
  pingTimeout: 60000, // 60 seconds ping timeout
  pingInterval: 25000, // Send ping every 25 seconds
  maxHttpBufferSize: 1e6, // 1MB
  transports: ['websocket', 'polling'], // Prefer WebSocket
  allowUpgrades: true,
  perMessageDeflate: {
    threshold: 1024 // Compress data if larger than 1KB
  }
});

// UDP server setup
const udpServer = dgram.createSocket('udp4');
const UDP_PORT = parseInt(config.udpPort, 10);

// Buffer to store video data
const videoBuffer = [];
const MAX_BUFFER_SIZE = parseInt(config.maxBufferSize, 10);

// For data rate calculation
let bytesReceivedLastSecond = 0;
let lastDataRateUpdate = Date.now();
let currentDataRate = 0;

// Set up UDP server
udpServer.on('error', (err) => {
  console.error(`UDP server error: ${err.stack}`);
  udpServer.close();
});

udpServer.on('message', (msg, rinfo) => {
  // Add unique packet ID based on content hash
  const packetId = createHash('md5').update(msg).digest('hex').substring(0, 8);
  
  // Add the packet to our buffer
  videoBuffer.push({
    id: packetId,
    data: msg,
    timestamp: Date.now(),
    size: msg.length
  });
  
  // Update bytes received
  bytesReceivedLastSecond += msg.length;
  
  // Prevent buffer from growing too large - remove oldest packets
  while (videoBuffer.length > 0 && 
         videoBuffer.reduce((total, packet) => total + packet.data.length, 0) > MAX_BUFFER_SIZE) {
    videoBuffer.shift();
  }
  
  // Update data rate every second
  const now = Date.now();
  if (now - lastDataRateUpdate >= 1000) {
    currentDataRate = bytesReceivedLastSecond;
    bytesReceivedLastSecond = 0;
    lastDataRateUpdate = now;
  }
  
  // Broadcast to all connected clients that new data is available
  io.emit('udp-data', { 
    timestamp: Date.now(),
    size: msg.length,
    sender: `${rinfo.address}:${rinfo.port}`,
    dataRate: currentDataRate // Bytes per second
  });
});

udpServer.on('listening', () => {
  const address = udpServer.address();
  console.log(`UDP server listening on ${address.address}:${address.port}`);
});

// Bind UDP server to port on all interfaces
udpServer.bind(UDP_PORT, '0.0.0.0');

// Track broadcasters and viewers
const broadcasters = new Map(); // streamId -> socket.id
const viewers = new Map(); // streamId -> Set of viewer socket.ids
const socketRoles = new Map(); // socket.id -> { role: 'broadcaster'|'viewer', streamId: string }

// Rate limiters for socket connections
const socketRateLimits = new Map(); // socket.id -> { timestamp, count }

// Helper to enforce rate limits for socket events
const rateLimitSocketEvent = (socket, limit = 10) => {
  if (!socketRateLimits.has(socket.id)) {
    socketRateLimits.set(socket.id, { 
      timestamp: Date.now(),
      count: 1
    });
    return false;
  }
  
  const rateLimit = socketRateLimits.get(socket.id);
  const now = Date.now();
  
  // Reset counter if more than a second has passed
  if (now - rateLimit.timestamp > 1000) {
    rateLimit.count = 1;
    rateLimit.timestamp = now;
    return false;
  }
  
  // Check if limit exceeded
  if (rateLimit.count >= limit) {
    return true;
  }
  
  // Increment counter
  rateLimit.count++;
  return false;
};

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`New client connected: ${socket.id}`);
  
  // Limit connections per IP
  const clientsWithSameIP = [...io.sockets.sockets.values()]
    .filter(s => s.handshake.address === socket.handshake.address);
  
  if (clientsWithSameIP.length > 10) {
    console.warn(`Too many connections from IP: ${socket.handshake.address}`);
    socket.disconnect(true);
    return;
  }
  
  // Send initial state for UDP playback
  socket.emit('connection-established', { 
    bufferSize: videoBuffer.length,
    message: 'Connected to UDP-WebRTC bridge',
    serverTime: Date.now(),
    networkStats: {
      dataRate: currentDataRate
    }
  });
  
  // Client requests video data from UDP buffer
  socket.on('request-video-data', (requestInfo) => {
    // Rate limit this event to prevent flooding
    if (rateLimitSocketEvent(socket, 5)) {
      console.warn(`Rate limit exceeded for socket ${socket.id} on request-video-data`);
      return;
    }
    
    // Send chunks based on client's request
    const startIndex = requestInfo.startIndex || 0;
    const chunkSize = Math.min(requestInfo.chunkSize || 10, 20); // Limit max chunk size
    
    // Handle case where buffer might be empty
    if (videoBuffer.length === 0) {
      socket.emit('video-data', {
        chunks: [],
        nextIndex: 0,
        hasMore: false,
        timestamp: Date.now()
      });
      return;
    }
    
    // Limit startIndex to valid range
    const validStartIndex = Math.min(startIndex, videoBuffer.length - 1);
    
    const dataToSend = videoBuffer.slice(
      validStartIndex, 
      Math.min(validStartIndex + chunkSize, videoBuffer.length)
    );
    
    // Send binary data as Base64 encoded strings for efficiency
    const encodedChunks = dataToSend.map(packet => {
      return {
        id: packet.id,
        data: packet.data.toString('base64'),
        timestamp: packet.timestamp,
        size: packet.size
      };
    });
    
    socket.emit('video-data', {
      chunks: encodedChunks,
      nextIndex: validStartIndex + dataToSend.length,
      hasMore: validStartIndex + dataToSend.length < videoBuffer.length,
      timestamp: Date.now(),
      dataRate: currentDataRate
    });
  });
  
  // General WebRTC signaling (for UDP playback)
  socket.on('webrtc-signal', (data) => {
    if (rateLimitSocketEvent(socket, 30)) {
      console.warn(`Rate limit exceeded for socket ${socket.id} on webrtc-signal`);
      return;
    }
    
    // Forward the WebRTC signaling data to other clients
    socket.broadcast.emit('webrtc-signal', {
      ...data,
      senderId: socket.id,
      timestamp: Date.now()
    });
  });
  
  // Register as a broadcaster
  socket.on('register-broadcaster', (data) => {
    if (rateLimitSocketEvent(socket, 5)) {
      console.warn(`Rate limit exceeded for socket ${socket.id} on register-broadcaster`);
      return;
    }
    
    const { streamId } = data;
    console.log(`Registering broadcaster for stream: ${streamId}`);
    
    // Register this socket as the broadcaster for this stream
    broadcasters.set(streamId, socket.id);
    
    // Create a new set for viewers if it doesn't exist
    if (!viewers.has(streamId)) {
      viewers.set(streamId, new Set());
    }
    
    // Mark this socket's role
    socketRoles.set(socket.id, { role: 'broadcaster', streamId });
    
    // Notify clients that this stream is available
    socket.broadcast.emit('stream-available', { 
      streamId,
      timestamp: Date.now()
    });
  });
  
  // Unregister as a broadcaster
  socket.on('unregister-broadcaster', (data) => {
    if (rateLimitSocketEvent(socket, 5)) {
      console.warn(`Rate limit exceeded for socket ${socket.id} on unregister-broadcaster`);
      return;
    }
    
    const { streamId } = data;
    console.log(`Unregistering broadcaster for stream: ${streamId}`);
    
    if (broadcasters.has(streamId) && broadcasters.get(streamId) === socket.id) {
      // Remove broadcaster registration
      broadcasters.delete(streamId);
      
      // Notify all viewers that the stream has ended
      if (viewers.has(streamId)) {
        const streamViewers = viewers.get(streamId);
        for (const viewerId of streamViewers) {
          const viewerSocket = io.sockets.sockets.get(viewerId);
          if (viewerSocket) {
            viewerSocket.emit('stream-ended', { 
              streamId,
              timestamp: Date.now()
            });
          }
        }
        
        // Clear viewers for this stream
        viewers.delete(streamId);
      }
    }
    
    // Clear this socket's role
    socketRoles.delete(socket.id);
  });
  
  // Register as a viewer for a stream
  socket.on('register-viewer', (data) => {
    if (rateLimitSocketEvent(socket, 5)) {
      console.warn(`Rate limit exceeded for socket ${socket.id} on register-viewer`);
      return;
    }
    
    const { streamId } = data;
    console.log(`Registering viewer for stream: ${streamId}`);
    
    // Check if the stream exists
    if (!broadcasters.has(streamId)) {
      socket.emit('stream-unavailable', { 
        streamId,
        timestamp: Date.now()
      });
      return;
    }
    
    // Add this socket to the viewers for this stream
    if (!viewers.has(streamId)) {
      viewers.set(streamId, new Set());
    }
    viewers.get(streamId).add(socket.id);
    
    // Mark this socket's role
    socketRoles.set(socket.id, { role: 'viewer', streamId });
    
    // Notify the broadcaster that a new viewer has connected
    const broadcasterId = broadcasters.get(streamId);
    const broadcasterSocket = io.sockets.sockets.get(broadcasterId);
    if (broadcasterSocket) {
      broadcasterSocket.emit('broadcaster-viewer-connected', {
        viewerId: socket.id,
        timestamp: Date.now()
      });
    }
  });
  
  // Unregister as a viewer
  socket.on('unregister-viewer', (data) => {
    if (rateLimitSocketEvent(socket, 5)) {
      console.warn(`Rate limit exceeded for socket ${socket.id} on unregister-viewer`);
      return;
    }
    
    const { streamId } = data;
    console.log(`Unregistering viewer for stream: ${streamId}`);
    
    if (viewers.has(streamId)) {
      viewers.get(streamId).delete(socket.id);
      
      // Notify the broadcaster that a viewer has disconnected
      if (broadcasters.has(streamId)) {
        const broadcasterId = broadcasters.get(streamId);
        const broadcasterSocket = io.sockets.sockets.get(broadcasterId);
        if (broadcasterSocket) {
          broadcasterSocket.emit('broadcaster-viewer-disconnected', {
            viewerId: socket.id,
            timestamp: Date.now()
          });
        }
      }
    }
    
    // Clear this socket's role
    socketRoles.delete(socket.id);
  });
  
  // Handle WebRTC signaling between broadcaster and viewers
  socket.on('broadcaster-signal', (data) => {
    if (rateLimitSocketEvent(socket, 30)) {
      console.warn(`Rate limit exceeded for socket ${socket.id} on broadcaster-signal`);
      return;
    }
    
    const { viewerId, type } = data;
    const viewerSocket = io.sockets.sockets.get(viewerId);
    if (viewerSocket) {
      viewerSocket.emit('viewer-signal', {
        ...data,
        broadcasterId: socket.id,
        timestamp: Date.now()
      });
    }
  });
  
  socket.on('viewer-signal', (data) => {
    if (rateLimitSocketEvent(socket, 30)) {
      console.warn(`Rate limit exceeded for socket ${socket.id} on viewer-signal`);
      return;
    }
    
    const { broadcasterId, type } = data;
    const broadcasterSocket = io.sockets.sockets.get(broadcasterId);
    if (broadcasterSocket) {
      broadcasterSocket.emit('broadcaster-signal', {
        ...data,
        viewerId: socket.id,
        timestamp: Date.now()
      });
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    
    // Clean up rate limit data
    socketRateLimits.delete(socket.id);
    
    // Check if this socket was a broadcaster or viewer
    const socketRole = socketRoles.get(socket.id);
    if (socketRole) {
      const { role, streamId } = socketRole;
      
      if (role === 'broadcaster') {
        // Unregister broadcaster
        if (broadcasters.has(streamId) && broadcasters.get(streamId) === socket.id) {
          broadcasters.delete(streamId);
          
          // Notify all viewers that the stream has ended
          if (viewers.has(streamId)) {
            const streamViewers = viewers.get(streamId);
            for (const viewerId of streamViewers) {
              const viewerSocket = io.sockets.sockets.get(viewerId);
              if (viewerSocket) {
                viewerSocket.emit('stream-ended', { 
                  streamId,
                  timestamp: Date.now(),
                  reason: 'broadcaster-disconnected'
                });
              }
            }
            
            // Clear viewers for this stream
            viewers.delete(streamId);
          }
        }
      } else if (role === 'viewer') {
        // Unregister viewer
        if (viewers.has(streamId)) {
          viewers.get(streamId).delete(socket.id);
          
          // Notify the broadcaster that a viewer has disconnected
          if (broadcasters.has(streamId)) {
            const broadcasterId = broadcasters.get(streamId);
            const broadcasterSocket = io.sockets.sockets.get(broadcasterId);
            if (broadcasterSocket) {
              broadcasterSocket.emit('broadcaster-viewer-disconnected', {
                viewerId: socket.id,
                timestamp: Date.now(),
                reason: 'viewer-disconnected'
              });
            }
          }
        }
      }
      
      // Clear this socket's role
      socketRoles.delete(socket.id);
    }
  });
});

// API routes
app.get('/api/status', (req, res) => {
  const status = {
    uptime: process.uptime(),
    serverTime: Date.now(),
    videoBufferSize: videoBuffer.length,
    dataRate: currentDataRate,
    memoryUsage: process.memoryUsage(),
    activeStreams: broadcasters.size,
    totalViewers: [...viewers.values()].reduce((total, viewerSet) => total + viewerSet.size, 0),
    systemInfo: {
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem()
    }
  };
  
  res.json(status);
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send('Server error');
});

// Start HTTP server
const HTTP_PORT = parseInt(config.httpPort, 10);
server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`Server running on 0.0.0.0:${HTTP_PORT}`);
  console.log(`Mode: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Protocol: ${config.https ? 'HTTPS' : 'HTTP'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.close(() => {
    console.log('HTTP server closed');
    udpServer.close(() => {
      console.log('UDP server closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  server.close(() => {
    console.log('HTTP server closed');
    udpServer.close(() => {
      console.log('UDP server closed');
      process.exit(0);
    });
  });
});