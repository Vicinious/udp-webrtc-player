/**
 * WebRTC handler for UDP stream playback with improved performance and security
 */
class WebRTCHandler {
  constructor() {
    // Connection objects
    this.peerConnection = null;
    this.dataChannel = null;
    
    // Media handling
    this.mediaSource = null;
    this.sourceBuffer = null;
    this.codecTypes = [
      'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
      'video/webm; codecs="vp9, opus"',
      'video/webm; codecs="vp8, opus"',
      'video/webm; codecs="av1, opus"'
    ];
    
    // Data management
    this.queue = [];
    this.processingQueue = false;
    this.receivedPackets = new Set(); // Track received packet IDs to avoid duplicates
    this.receivedBytes = 0;
    this.startTime = Date.now();
    this.isBuffering = false;
    this.bufferingStartTime = null;
    this.bufferingTimeout = null;
    this.initialBufferSize = 10; // Number of packets to buffer before playback
    
    // Playback state
    this.isPlaying = false;
    this.videoElement = null;
    this.socket = null;
    this.initiator = false;
    
    // Connection state
    this.connectionType = 'unknown';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // Start with 1 second delay
    this.dataRateHistory = []; // For tracking data rate over time
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ];
    
    // Stats monitoring
    this.statsIntervalId = null;
    this.dataRateKBps = 0;
    
    // Event callbacks
    this.onStatsUpdate = null;
    this.onConnectionStateChange = null;
    this.onError = null;
    
    // Add event listeners for visibility change
    document.addEventListener('visibilitychange', this._handleVisibilityChange.bind(this));
  }

  /**
   * Initialize the WebRTC connection
   * @param {HTMLVideoElement} videoElement - The video element to play the stream
   * @param {SocketIOClient.Socket} socket - The socket.io client connection
   */
  initialize(videoElement, socket) {
    this.videoElement = videoElement;
    this.socket = socket;
    
    // Check for WebRTC support
    if (!window.RTCPeerConnection) {
      this._reportError('WebRTC is not supported in this browser');
      return;
    }
    
    // Initialize MediaSource for video playback
    this.setupMediaSource();
    
    // Listen for WebRTC signaling messages
    this.socket.on('webrtc-signal', this.handleSignaling.bind(this));
    
    // Start stats monitoring
    this._startStatsMonitoring();
    
    // Set this client as initiator if it's the first to connect
    this.socket.on('connection-established', (data) => {
      if (data.networkStats) {
        this.serverDataRate = data.networkStats.dataRate || 0;
      }
      
      if (data.bufferSize === 0) {
        this.initiator = true;
        this.createPeerConnection();
      }
    });
    
    // Create peer connection if this client is not the initiator
    if (!this.initiator) {
      this.createPeerConnection();
    }
    
    // Listen for UDP data notifications
    this.socket.on('udp-data', (data) => {
      if (data.dataRate) {
        this.serverDataRate = data.dataRate;
      }
    });
    
    console.log('WebRTC handler initialized');
  }
  
  /**
   * Set up the MediaSource for receiving and playing video data
   */
  setupMediaSource() {
    if (!window.MediaSource) {
      this._reportError('MediaSource API is not supported in this browser');
      return;
    }
    
    this.mediaSource = new MediaSource();
    this.videoElement.src = URL.createObjectURL(this.mediaSource);
    
    this.mediaSource.addEventListener('sourceopen', () => {
      try {
        // Try different MIME types and codecs
        let supported = false;
        
        for (const mimeType of this.codecTypes) {
          if (MediaSource.isTypeSupported(mimeType)) {
            console.log(`Using MIME type: ${mimeType}`);
            this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
            supported = true;
            break;
          }
        }
        
        if (!supported) {
          this._reportError('None of the standard MIME types are supported');
          return;
        }
        
        this.sourceBuffer.mode = 'segments';
        this.sourceBuffer.addEventListener('updateend', () => {
          // Reset buffering flag when update is complete
          this.isBuffering = false;
          
          // Continue processing the queue
          this._processQueue();
          
          // Check if we need to remove old data to prevent buffer from growing too large
          this._maintainBufferSize();
        });
        
        this.sourceBuffer.addEventListener('error', (e) => {
          this._reportError('Source buffer error:', e);
          this.isBuffering = false;
        });
      } catch (err) {
        this._reportError('Error setting up MediaSource:', err);
      }
    });
    
    this.mediaSource.addEventListener('error', (err) => {
      this._reportError('MediaSource error:', err);
    });
  }
  
  /**
   * Create a new WebRTC peer connection
   */
  createPeerConnection() {
    const configuration = {
      iceServers: this.iceServers,
      sdpSemantics: 'unified-plan',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceTransportPolicy: 'all'
    };
    
    this.peerConnection = new RTCPeerConnection(configuration);
    
    // Set up data channel for receiving video data
    if (this.initiator) {
      // Configure data channel for performance with binary data
      const dataChannelOptions = {
        ordered: true,
        maxRetransmits: 3,
        maxPacketLifeTime: 1000
      };
      
      this.dataChannel = this.peerConnection.createDataChannel('videoData', dataChannelOptions);
      this.setupDataChannel();
      
      // Create and send an offer
      this.peerConnection.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
      })
        .then(offer => this.peerConnection.setLocalDescription(offer))
        .then(() => {
          this.socket.emit('webrtc-signal', { 
            type: 'offer', 
            sdp: this.peerConnection.localDescription 
          });
        })
        .catch(err => this._reportError('Error creating offer:', err));
    } else {
      // Handle data channel when it's received from the other peer
      this.peerConnection.addEventListener('datachannel', (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel();
      });
    }
    
    // Handle ICE candidates
    this.peerConnection.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        this.socket.emit('webrtc-signal', { 
          type: 'ice-candidate', 
          candidate: event.candidate 
        });
      }
    });
    
    // Monitor connection state
    this.peerConnection.addEventListener('connectionstatechange', () => {
      console.log('WebRTC connection state:', this.peerConnection.connectionState);
      
      // Notify about connection state change
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(this.peerConnection.connectionState);
      }
      
      if (this.peerConnection.connectionState === 'connected') {
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        
        // Get connection type information
        this._updateConnectionType();
      } else if (this.peerConnection.connectionState === 'failed' || 
                this.peerConnection.connectionState === 'disconnected' ||
                this.peerConnection.connectionState === 'closed') {
        console.warn('WebRTC connection lost, attempting to reconnect...');
        this._attemptReconnect();
      }
    });
    
    // ICE connection state monitoring
    this.peerConnection.addEventListener('iceconnectionstatechange', () => {
      console.log('ICE connection state:', this.peerConnection.iceConnectionState);
      
      if (this.peerConnection.iceConnectionState === 'connected') {
        // Connection established successfully
        this._updateConnectionType();
      }
    });
  }
  
  /**
   * Set up the data channel for receiving video data
   */
  setupDataChannel() {
    // Configure data channel for binary data
    this.dataChannel.binaryType = 'arraybuffer';
    
    this.dataChannel.addEventListener('open', () => {
      console.log('WebRTC data channel opened');
      
      // Request video data from server when channel is open
      this._requestInitialVideoData();
      
      // Update connection type
      this._updateConnectionType();
      
      // Set up a heartbeat to keep the data channel alive
      this.heartbeatInterval = setInterval(() => {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
          try {
            // Send a small ping message
            this.dataChannel.send(JSON.stringify({ 
              type: 'ping', 
              timestamp: Date.now() 
            }));
          } catch (err) {
            this._reportError('Error sending heartbeat:', err);
          }
        }
      }, 30000); // Every 30 seconds
    });
    
    this.dataChannel.addEventListener('message', (event) => {
      try {
        // Check if this is a string message (might be JSON control message)
        if (typeof event.data === 'string') {
          try {
            const jsonData = JSON.parse(event.data);
            if (jsonData.type === 'ping') {
              // Respond to ping with pong
              this.dataChannel.send(JSON.stringify({ 
                type: 'pong', 
                timestamp: Date.now() 
              }));
              return;
            }
            
            // Process other control messages as needed
            if (jsonData.type === 'packet' && jsonData.id) {
              // If this is a packet with ID we've already processed, skip it
              if (this.receivedPackets.has(jsonData.id)) {
                return;
              }
              
              // Otherwise mark it as received
              this.receivedPackets.add(jsonData.id);
              
              // If the set is getting too large, trim it
              if (this.receivedPackets.size > 1000) {
                // Keep only the most recent 500 packets
                this.receivedPackets = new Set(
                  Array.from(this.receivedPackets).slice(-500)
                );
              }
            }
          } catch (e) {
            // Not JSON, treat as regular data
          }
        }
        
        // Track received data for stats
        if (event.data.byteLength) {
          this.receivedBytes += event.data.byteLength;
        } else if (typeof event.data === 'string') {
          this.receivedBytes += event.data.length;
        }
        
        // Add received data to queue
        this.queue.push(event.data);
        
        // Process queue if we have enough initial data or already playing
        if (this.isPlaying || this.queue.length >= this.initialBufferSize) {
          this._processQueue();
        } else if (this.queue.length === this.initialBufferSize / 2) {
          // Once we have half the needed buffer, start a timeout to avoid waiting too long
          if (!this.bufferingTimeout) {
            this.bufferingTimeout = setTimeout(() => {
              console.log('Starting playback after buffer timeout');
              this._processQueue();
              this.play();
            }, 2000); // 2 seconds maximum wait time
          }
        }
      } catch (err) {
        this._reportError('Error processing message:', err);
      }
    });
    
    this.dataChannel.addEventListener('close', () => {
      console.log('WebRTC data channel closed');
      
      // Clear heartbeat interval
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }
      
      // Try to reopen the channel after a delay
      if (this.peerConnection && 
          (this.peerConnection.connectionState === 'connected' || 
           this.peerConnection.iceConnectionState === 'connected')) {
        console.log('Attempting to recreate data channel');
        setTimeout(() => {
          try {
            this.dataChannel = this.peerConnection.createDataChannel('videoData');
            this.setupDataChannel();
          } catch (err) {
            this._reportError('Error recreating data channel:', err);
            this._attemptReconnect();
          }
        }, 1000);
      }
    });
    
    this.dataChannel.addEventListener('error', (error) => {
      this._reportError('WebRTC data channel error:', error);
    });
  }
  
  /**
   * Handle WebRTC signaling messages
   * @param {Object} signal - The signaling message
   */
  handleSignaling(signal) {
    if (!this.peerConnection) {
      this.createPeerConnection();
    }
    
    try {
      switch (signal.type) {
        case 'offer':
          this.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp))
            .then(() => this.peerConnection.createAnswer())
            .then(answer => this.peerConnection.setLocalDescription(answer))
            .then(() => {
              this.socket.emit('webrtc-signal', { 
                type: 'answer', 
                sdp: this.peerConnection.localDescription 
              });
            })
            .catch(err => this._reportError('Error handling offer:', err));
          break;
          
        case 'answer':
          this.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp))
            .catch(err => this._reportError('Error handling answer:', err));
          break;
          
        case 'ice-candidate':
          this.peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate))
            .catch(err => this._reportError('Error adding ICE candidate:', err));
          break;
      }
    } catch (err) {
      this._reportError('Error in handleSignaling:', err);
    }
  }
  
  /**
   * Process the queue of video data chunks
   */
  _processQueue() {
    if (!this.sourceBuffer || this.isBuffering || this.queue.length === 0 || this.processingQueue) {
      return;
    }
    
    this.processingQueue = true;
    this.isBuffering = true;
    
    // Get the next chunk of data from the queue
    const data = this.queue.shift();
    
    try {
      // Convert string data to ArrayBuffer if needed
      let buffer;
      if (typeof data === 'string') {
        try {
          // Convert base64 string to ArrayBuffer
          const binaryString = window.atob(data);
          buffer = new Uint8Array(binaryString.length);
          for (let i =, len = binaryString.length; i < len; i++) {
            buffer[i] = binaryString.charCodeAt(i);
          }
        } catch (e) {
          this._reportError('Error converting data:', e);
          this.isBuffering = false;
          this.processingQueue = false;
          // Continue processing the queue
          setTimeout(() => this._processQueue(), 0);
          return;
        }
      } else if (data instanceof ArrayBuffer) {
        buffer = new Uint8Array(data);
      } else if (data instanceof Uint8Array) {
        buffer = data;
      } else {
        this._reportError('Unsupported data type:', typeof data);
        this.isBuffering = false;
        this.processingQueue = false;
        // Continue processing the queue
        setTimeout(() => this._processQueue(), 0);
        return;
      }
      
      // Append the data to the source buffer
      this.sourceBuffer.appendBuffer(buffer);
    } catch (err) {
      this._reportError('Error processing queue:', err);
      this.isBuffering = false;
      this.processingQueue = false;
      
      // If we get a QuotaExceededError, clear some of the buffer and try again
      if (err.name === 'QuotaExceededError') {
        this._handleQuotaExceeded(data);
      } else {
        // For other errors, continue processing the queue after a short delay
        setTimeout(() => this._processQueue(), 100);
      }
    } finally {
      this.processingQueue = false;
    }
  }
  
  /**
   * Handle quota exceeded error by removing old data
   * @param {*} data - The data that couldn't be added
   */
  _handleQuotaExceeded(data) {
    console.warn('Buffer full, removing old data');
    
    try {
      if (this.sourceBuffer.buffered.length > 0) {
        const start = this.sourceBuffer.buffered.start(0);
        const end = this.sourceBuffer.buffered.start(0) + 
                    (this.sourceBuffer.buffered.end(0) - this.sourceBuffer.buffered.start(0)) / 2;
                
        // Remove the first half of the buffer
        this.sourceBuffer.remove(start, end);
        
        // Re-add the data to the queue
        this.queue.unshift(data);
      }
    } catch (err) {
      this._reportError('Error handling quota exceeded:', err);
    }
  }
  
  /**
   * Maintain buffer size by removing old data if needed
   */
  _maintainBufferSize() {
    try {
      if (this.sourceBuffer && !this.sourceBuffer.updating && this.sourceBuffer.buffered.length > 0) {
        const currentTime = this.videoElement.currentTime;
        const bufferEnd = this.sourceBuffer.buffered.end(0);
        const bufferStart = this.sourceBuffer.buffered.start(0);
        
        // If we have more than 30 seconds buffered and we're not at the start,
        // remove data that's more than 10 seconds behind the current playback position
        if ((bufferEnd - bufferStart) > 30 && currentTime > bufferStart + 10) {
          this.sourceBuffer.remove(bufferStart, currentTime - 10);
        }
      }
    } catch (err) {
      console.warn('Error maintaining buffer size:', err);
    }
  }
  
  /**
   * Request initial video data from the server
   */
  _requestInitialVideoData() {
    this.socket.emit('request-video-data', { 
      startIndex: 0, 
      chunkSize: this.initialBufferSize * 2 // Request twice the buffer size initially
    });
  }
  
  /**
   * Update the connection type based on ICE candidate information
   */
  _updateConnectionType() {
    if (!this.peerConnection) return;
    
    // Get the current connection stats to determine connection type
    this.peerConnection.getStats(null)
      .then(stats => {
        let connectionType = 'unknown';
        
        stats.forEach(report => {
          if (report.type === 'transport') {
            connectionType = report.dtlsState || 'unknown';
          }
          
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            const localCandidateId = report.localCandidateId;
            const remoteCandidateId = report.remoteCandidateId;
            
            stats.forEach(s => {
              if (s.id === localCandidateId && s.candidateType) {
                connectionType = s.candidateType; // host, srflx, prflx, relay
              }
            });
          }
        });
        
        this.connectionType = connectionType;
        
        // Notify about connection type change
        if (this.onStatsUpdate) {
          this.onStatsUpdate({
            connectionType: this.connectionType,
            dataRate: this.dataRateKBps
          });
        }
      })
      .catch(err => {
        console.warn('Error getting connection stats:', err);
      });
  }
  
  /**
   * Attempt to reconnect after connection failure
   */
  _attemptReconnect() {
    // Clean up current connection
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch (err) {
        console.warn('Error closing data channel:', err);
      }
      this.dataChannel = null;
    }
    
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (err) {
        console.warn('Error closing peer connection:', err);
      }
      this.peerConnection = null;
    }
    
    // Check if we should try to reconnect
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Reconnection attempt ${this.reconnectAttempts} of ${this.maxReconnectAttempts} in ${this.reconnectDelay}ms`);
      
      // Use exponential backoff for reconnection attempts
      setTimeout(() => {
        this.createPeerConnection();
      }, this.reconnectDelay);
      
      // Increase delay for next attempt
      this.reconnectDelay = Math.min(30000, this.reconnectDelay * 2);
    } else {
      console.error('Max reconnection attempts reached');
      
      // Notify about permanent connection failure
      if (this.onError) {
        this.onError('connection-failed', 'Failed to establish connection after multiple attempts');
      }
    }
  }
  
  /**
   * Start monitoring WebRTC stats
   */
  _startStatsMonitoring() {
    this.statsIntervalId = setInterval(() => {
      this._updateDataRate();
      
      if (this.peerConnection && this.peerConnection.connectionState === 'connected') {
        this._updateConnectionType();
      }
    }, 1000);
  }
  
  /**
   * Stop monitoring WebRTC stats
   */
  _stopStatsMonitoring() {
    if (this.statsIntervalId) {
      clearInterval(this.statsIntervalId);
      this.statsIntervalId = null;
    }
  }
  
  /**
   * Update data rate based on received bytes
   */
  _updateDataRate() {
    const now = Date.now();
    const elapsed = (now - this.startTime) / 1000; // seconds
    
    if (elapsed > 0) {
      // Calculate data rate in KBps (kilobytes per second)
      this.dataRateKBps = Math.round((this.receivedBytes / 1024) / elapsed);
      
      // Add to history and keep the last 10 readings
      this.dataRateHistory.push(this.dataRateKBps);
      if (this.dataRateHistory.length > 10) {
        this.dataRateHistory.shift();
      }
      
      // Reset counters for next interval
      this.receivedBytes = 0;
      this.startTime = now;
      
      // Notify about stats update
      if (this.onStatsUpdate) {
        this.onStatsUpdate({
          connectionType: this.connectionType,
          dataRate: this.dataRateKBps
        });
      }
    }
  }
  
  /**
   * Handle page visibility change
   */
  _handleVisibilityChange() {
    if (document.hidden) {
      // Page is hidden, reduce activity
      console.log('Page hidden, reducing activity');
      
      // Clear any existing heartbeat
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }
    } else {
      // Page visible again, restore activity
      console.log('Page visible, restoring activity');
      
      // Restore heartbeat
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        this.heartbeatInterval = setInterval(() => {
          if (this.dataChannel && this.dataChannel.readyState === 'open') {
            try {
              this.dataChannel.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            } catch (err) {
              console.warn('Error sending heartbeat:', err);
            }
          }
        }, 30000);
      }
    }
  }
  
  /**
   * Report error and notify listeners
   * @param {string} message - Error message
   * @param {Error} [error] - Error object
   */
  _reportError(message, error) {
    console.error(message, error);
    
    if (this.onError) {
      this.onError('webrtc-error', message, error);
    }
  }
  
  /**
   * Set callback for stats updates
   * @param {Function} callback - Function to call with stats updates
   */
  setStatsCallback(callback) {
    this.onStatsUpdate = callback;
  }
  
  /**
   * Set callback for connection state changes
   * @param {Function} callback - Function to call on connection state change
   */
  setConnectionCallback(callback) {
    this.onConnectionStateChange = callback;
  }
  
  /**
   * Set callback for errors
   * @param {Function} callback - Function to call on errors
   */
  setErrorCallback(callback) {
    this.onError = callback;
  }
  
  /**
   * Start playing the video
   */
  play() {
    if (this.videoElement) {
      // Clear buffering timeout if it exists
      if (this.bufferingTimeout) {
        clearTimeout(this.bufferingTimeout);
        this.bufferingTimeout = null;
      }
      
      this.videoElement.play()
        .then(() => {
          this.isPlaying = true;
          console.log('Video playback started');
          
          // Start processing the queue if not already
          this._processQueue();
        })
        .catch(err => {
          this._reportError('Error playing video:', err);
          
          // If auto-play was blocked, add a click event to start playback on user interaction
          if (err.name === 'NotAllowedError') {
            console.log('Auto-play blocked, waiting for user interaction');
            
            const playOnClick = () => {
              this.videoElement.play()
                .then(() => {
                  this.isPlaying = true;
                  console.log('Video playback started after user interaction');
                  document.removeEventListener('click', playOnClick);
                })
                .catch(e => this._reportError('Error playing video after click:', e));
            };
            
            document.addEventListener('click', playOnClick);
          }
        });
    }
  }
  
  /**
   * Pause the video
   */
  pause() {
    if (this.videoElement) {
      this.videoElement.pause();
      this.isPlaying = false;
    }
  }
  
  /**
   * Stop the video and close connections
   */
  stop() {
    this.pause();
    
    // Clear any intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    if (this.bufferingTimeout) {
      clearTimeout(this.bufferingTimeout);
      this.bufferingTimeout = null;
    }
    
    this._stopStatsMonitoring();
    
    // Close data channel
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch (err) {
        console.warn('Error closing data channel:', err);
      }
      this.dataChannel = null;
    }
    
    // Close peer connection
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (err) {
        console.warn('Error closing peer connection:', err);
      }
      this.peerConnection = null;
    }
    
    // Clear the queue
    this.queue = [];
    this.isBuffering = false;
    this.processingQueue = false;
    
    // Close media source
    if (this.mediaSource) {
      try {
        if (this.mediaSource.readyState === 'open') {
          this.mediaSource.endOfStream();
        }
      } catch (err) {
        console.warn('Error closing media source:', err);
      }
    }
    
    // Clear the source buffer
    if (this.sourceBuffer) {
      try {
        if (!this.sourceBuffer.updating) {
          this.sourceBuffer.abort();
        }
      } catch (err) {
        console.warn('Error clearing source buffer:', err);
      }
      this.sourceBuffer = null;
    }
    
    // Clear video source
    if (this.videoElement) {
      this.videoElement.src = '';
      this.videoElement.load(); // Force resource release
    }
    
    this.isPlaying = false;
    this.receivedPackets.clear();
    
    console.log('WebRTC connection stopped');
  }
  
  /**
   * Get current connection stats
   * @returns {Object} Current connection stats
   */
  getStats() {
    return {
      connectionType: this.connectionType,
      dataRate: this.dataRateKBps,
      connectionState: this.peerConnection ? this.peerConnection.connectionState : 'closed',
      iceConnectionState: this.peerConnection ? this.peerConnection.iceConnectionState : 'closed',
      isPlaying: this.isPlaying,
      queueLength: this.queue.length,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

// Export the WebRTCHandler class
window.WebRTCHandler = WebRTCHandler;