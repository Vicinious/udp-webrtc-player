/**
 * PM2 Ecosystem Configuration
 * Enhanced for performance and monitoring
 */
module.exports = {
  apps: [{
    name: "udp-webrtc-player",
    script: "server/server.js",
    watch: process.env.NODE_ENV !== 'production', // Only watch files in development
    instances: process.env.INSTANCES || 1,
    exec_mode: "cluster", // Support multiple instances if needed
    autorestart: true,
    max_memory_restart: process.env.MAX_MEMORY || "1G",
    kill_timeout: 5000, // Give server 5 seconds to close gracefully
    listen_timeout: 5000, // Wait time for process to be ready
    
    // Environment variables
    env: {
      NODE_ENV: "development",
      PORT: 3001,
      UDP_PORT: 33334
    },
    env_production: {
      NODE_ENV: "production",
      PORT: process.env.PORT || 3001,
      UDP_PORT: process.env.UDP_PORT || 33334,
      USE_HTTPS: process.env.USE_HTTPS || 'false',
      MAX_BUFFER_SIZE: process.env.MAX_BUFFER_SIZE || (1024 * 1024 * 5), // 5MB
      MAX_CONNECTIONS: process.env.MAX_CONNECTIONS || 100,
      RATE_LIMIT_INTERVAL: process.env.RATE_LIMIT_INTERVAL || 1000,
      RATE_LIMIT_MAX_REQUESTS: process.env.RATE_LIMIT_MAX_REQUESTS || 50
    },
    
    // Monitoring
    merge_logs: true,
    error_file: "logs/error.log",
    out_file: "logs/access.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    
    // Performance
    node_args: [
      "--max-old-space-size=512", // Limit memory usage
      "--expose-gc"               // Enable garbage collection
    ],
    
    // Metrics
    metrics: {
      http: true,  // Enable HTTP metrics
      runtime: true // Enable runtime metrics
    }
  }]
};