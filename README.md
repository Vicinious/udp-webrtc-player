# UDP WebRTC Player

A Node.js application that captures UDP packets and displays them via WebRTC, with an Apple-inspired design and enhanced performance.

## Features

- **High Performance:** Optimized UDP to WebRTC bridge with improved buffering and packet handling
- **Modern Design:** Sleek Apple-inspired user interface 
- **Security:** Enhanced security with proper CORS configuration, rate limiting, and content security policies
- **Streaming:** Real-time streaming with adaptive bitrate and auto-reconnection
- **Browser Streaming:** Start your own video stream directly from the browser
- **Fully Responsive:** Works on desktop and mobile devices
- **Keyboard Controls:** Convenient keyboard shortcuts for media playback
- **Monitoring:** Performance metrics and status API

## Technical Features

- Receives UDP packets on port 33334
- Streams received data to web clients using WebRTC
- Web-based player with advanced controls for playback
- Real-time streaming with sub-second latency
- Packet deduplication and smart buffering
- Auto-reconnection on connection loss
- Advanced security measures

## Requirements

- Node.js 14.x or higher
- A modern web browser with WebRTC support (Chrome, Firefox, Safari, Edge)

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. (Optional) Install PM2 for process management:
   ```bash
   npm install pm2 -g
   ```
4. (Optional) Open firewall ports:
   ```bash
   sudo ./open-ports.sh
   ```

## Running the Server

### Option 1: Standard Node.js

```bash
npm start
```

### Option 2: Using PM2 (recommended for production)

```bash
# Development mode
npm run start:pm2

# Production mode
npm run start:pm2 -- --env production
```

To stop the server:

```bash
npm run stop:pm2
```

To restart the server:

```bash
npm run restart:pm2
```

To monitor the server:

```bash
pm2 monit
```

## Accessing the Player

Open a web browser and navigate to:

```
http://your-server-ip:3001
```

## Environment Variables

You can configure the application using the following environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | HTTP server port | 3001 |
| UDP_PORT | UDP server port | 33334 |
| USE_HTTPS | Enable HTTPS (requires SSL certs) | false |
| MAX_BUFFER_SIZE | Max buffer size in bytes | 5242880 (5MB) |
| MAX_CONNECTIONS | Max client connections | 100 |
| RATE_LIMIT_INTERVAL | Rate limit window in ms | 1000 |
| RATE_LIMIT_MAX_REQUESTS | Max requests per interval | 50 |
| SSL_KEY_PATH | Path to SSL key | /etc/ssl/private/server.key |
| SSL_CERT_PATH | Path to SSL cert | /etc/ssl/certs/server.crt |

## Sending UDP Data

You can send UDP data to port 33334 on the server's IP address. For example:

**Using ffmpeg:**
```bash
ffmpeg -i your_video_file.mp4 -f mpegts udp://server_ip:33334
```

**Using gstreamer:**
```bash
gst-launch-1.0 videotestsrc ! x264enc ! mpegtsmux ! udpsink host=server_ip port=33334
```

**Simple testing with netcat:**
```bash
echo "Hello World" | nc -u server_ip 33334
```

## Architecture

This application consists of:

1. **UDP Server**: Receives UDP packets on port 33334
2. **Express Web Server**: Serves the web interface on port 3001
3. **Socket.IO**: Handles real-time communication between server and clients
4. **WebRTC**: Enables peer-to-peer media streaming between clients

## Performance Optimizations

- Optimized buffer management with smart packet deduplication
- WebRTC connection monitoring and automatic reconnection
- Resource cleanup for inactive connections
- Rate limiting to prevent DoS attacks
- Improved data encoding for faster transmission
- Page visibility API integration to reduce resource usage when tab is hidden

## Security Features

- Content Security Policy (CSP) headers
- Proper CORS configuration
- Rate limiting for all endpoints
- Input validation and sanitization
- Connection limits per IP address
- No external dependencies for core functionality

## Browser Compatibility

The application is compatible with all modern browsers that support WebRTC:

- Chrome 60+
- Firefox 55+
- Safari 11+
- Edge 79+

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space/K | Play/Pause |
| F | Toggle fullscreen |
| M | Mute/Unmute |
| Right Arrow | Forward 10s |
| Left Arrow | Back 10s |
| Esc | Exit fullscreen |

## API Endpoints

- `GET /api/status` - Server status and metrics

## Browser Streaming

You can start your own stream directly from the browser:

1. Click on "Start a Stream" link
2. Select your camera and microphone
3. Click "Start Streaming"
4. Share the stream URL with others

## Troubleshooting

- Make sure ports 3001 (TCP) and 33334 (UDP) are open on your firewall
- If using a cloud provider, ensure the security group/network rules allow these ports
- Check the console logs for any error messages
- For production environments, consider enabling HTTPS for better WebRTC compatibility

## License

ISC