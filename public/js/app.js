/**
 * Main application script for UDP WebRTC Player
 * Enhanced with performance monitoring and improved UI
 */
document.addEventListener('DOMContentLoaded', () => {
  // DOM elements
  const videoElement = document.getElementById('video-player');
  const connectionStatus = document.getElementById('connection-status');
  const streamStatus = document.getElementById('stream-status');
  const bufferSize = document.getElementById('buffer-size');
  const lastReceived = document.getElementById('last-received');
  const connectionType = document.getElementById('connection-type');
  const dataRate = document.getElementById('data-rate');
  const availableStreams = document.getElementById('available-streams');
  
  // Get URL parameters for stream selection
  const urlParams = new URLSearchParams(window.location.search);
  const selectedStreamId = urlParams.get('stream');
  
  // Initialize Socket.io with reconnection
  const socket = io({
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000
  });
  
  // Initialize video player
  const player = new VideoPlayer(videoElement);
  
  // Initialize WebRTC handler
  const webrtcHandler = new WebRTCHandler();
  webrtcHandler.initialize(videoElement, socket);
  
  // Set up WebRTC stats callback
  webrtcHandler.setStatsCallback((stats) => {
    // Update stats display
    connectionType.textContent = stats.connectionType || 'Unknown';
    dataRate.textContent = `${stats.dataRate || 0} KB/s`;
  });
  
  // Set up WebRTC connection state callback
  webrtcHandler.setConnectionCallback((state) => {
    if (state === 'connected') {
      streamStatus.textContent = 'Connected';
    } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
      streamStatus.textContent = 'Connection lost';
    }
  });
  
  // Set up WebRTC error callback
  webrtcHandler.setErrorCallback((type, message) => {
    console.error(`WebRTC error (${type}):`, message);
    streamStatus.textContent = `Error: ${type}`;
  });
  
  // Connect player and WebRTC handler
  player.setWebRTCHandler(webrtcHandler);
  
  // Handle socket.io connection events
  socket.on('connect', () => {
    connectionStatus.textContent = 'Connected';
    connectionStatus.classList.add('connected');
    connectionStatus.classList.remove('error');
    
    // If a stream ID was provided in the URL, connect to that stream
    if (selectedStreamId) {
      connectToStream(selectedStreamId);
    }
  });
  
  socket.on('disconnect', () => {
    connectionStatus.textContent = 'Disconnected';
    connectionStatus.classList.remove('connected');
    connectionStatus.classList.add('error');
  });
  
  socket.on('connect_error', () => {
    connectionStatus.textContent = 'Connection Error';
    connectionStatus.classList.remove('connected');
    connectionStatus.classList.add('error');
  });
  
  // Handle UDP data events
  socket.on('udp-data', (data) => {
    // Update stream information
    streamStatus.textContent = 'Receiving data';
    lastReceived.textContent = new Date(data.timestamp).toLocaleTimeString();
    
    // Update data rate if provided
    if (data.dataRate) {
      const rateMbps = (data.dataRate / (1024 * 1024)).toFixed(2);
      dataRate.textContent = `${rateMbps} MB/s`;
    }
  });
  
  // Handle connection established event
  socket.on('connection-established', (data) => {
    bufferSize.textContent = data.bufferSize;
    
    if (data.bufferSize > 0) {
      streamStatus.textContent = 'Data available';
    }
    
    // If server provides network stats, update the UI
    if (data.networkStats) {
      const rateMbps = (data.networkStats.dataRate / (1024 * 1024)).toFixed(2);
      dataRate.textContent = `${rateMbps} MB/s`;
    }
  });
  
  // Handle video data events
  socket.on('video-data', (data) => {
    bufferSize.textContent = data.nextIndex;
    
    if (data.chunks && data.chunks.length > 0) {
      streamStatus.textContent = 'Processing data';
      
      // Process each chunk through the WebRTC handler
      data.chunks.forEach(chunk => {
        if (webrtcHandler.dataChannel && webrtcHandler.dataChannel.readyState === 'open') {
          // If we have an open data channel, send it through there
          try {
            if (typeof chunk === 'string') {
              webrtcHandler.dataChannel.send(chunk);
            } else if (chunk.data) {
              // Send packet ID along with data for deduplication
              const packetInfo = {
                type: 'packet',
                id: chunk.id,
                timestamp: chunk.timestamp
              };
              webrtcHandler.dataChannel.send(JSON.stringify(packetInfo));
              webrtcHandler.dataChannel.send(chunk.data);
            }
          } catch (err) {
            console.error('Error sending data through data channel:', err);
            // Fallback to direct queue handling
            webrtcHandler.queue.push(chunk.data || chunk);
          }
        } else {
          // Otherwise, add it directly to the queue
          webrtcHandler.queue.push(chunk.data || chunk);
        }
      });
      
      // Process the queue
      if (typeof webrtcHandler._processQueue === 'function') {
        webrtcHandler._processQueue();
      } else {
        webrtcHandler.processQueue();
      }
      
      // Update status after processing
      streamStatus.textContent = 'Data available';
    }
    
    // Request more data if available
    if (data.hasMore) {
      setTimeout(() => {
        socket.emit('request-video-data', { 
          startIndex: data.nextIndex,
          chunkSize: 10
        });
      }, 200); // Reduced delay for smoother streaming
    }
  });
  
  // Handle available streams
  socket.on('stream-available', (data) => {
    // Add stream to list of available streams
    const streamId = data.streamId;
    
    // Check if this stream is already in the list
    if (!document.getElementById(`stream-${streamId}`)) {
      const streamElement = document.createElement('div');
      streamElement.id = `stream-${streamId}`;
      streamElement.className = 'stream-item';
      streamElement.innerHTML = `
        <div class="stream-info">
          <span class="stream-name">Stream ${streamId.substring(0, 8)}</span>
          <span class="stream-indicator live"></span>
        </div>
        <button class="stream-connect-btn" data-stream-id="${streamId}">Connect</button>
      `;
      
      // Add click handler for connect button
      const connectBtn = streamElement.querySelector('.stream-connect-btn');
      connectBtn.addEventListener('click', () => connectToStream(streamId));
      
      // Add to available streams list
      availableStreams.appendChild(streamElement);
    }
  });
  
  // Handle stream ended
  socket.on('stream-ended', (data) => {
    const streamId = data.streamId;
    const streamElement = document.getElementById(`stream-${streamId}`);
    
    if (streamElement) {
      // Update UI to show stream is no longer available
      const indicator = streamElement.querySelector('.stream-indicator');
      indicator.classList.remove('live');
      indicator.classList.add('offline');
      
      // Disable connect button
      const connectBtn = streamElement.querySelector('.stream-connect-btn');
      connectBtn.disabled = true;
      connectBtn.textContent = 'Offline';
    }
    
    // If currently viewing this stream, show message
    if (selectedStreamId === streamId) {
      streamStatus.textContent = 'Stream ended';
    }
  });
  
  // Connect to a specific stream
  function connectToStream(streamId) {
    // Register as a viewer for this stream
    socket.emit('register-viewer', { streamId });
    
    // Update URL without reloading the page
    const url = new URL(window.location);
    url.searchParams.set('stream', streamId);
    window.history.pushState({}, '', url);
    
    // Update UI
    streamStatus.textContent = 'Connecting to stream...';
  }
  
  // Handle viewer signaling for WebRTC 
  socket.on('viewer-signal', (data) => {
    // Handle WebRTC signaling for viewer role
    if (data.type === 'offer') {
      // Create a peer connection if needed
      if (!webrtcHandler.peerConnection) {
        webrtcHandler.createPeerConnection();
      }
      
      // Process the offer
      webrtcHandler.handleSignaling(data);
    }
  });
  
  // Add pointerdown event listener to video for mobile autoplay
  videoElement.addEventListener('pointerdown', () => {
    if (webrtcHandler.isPlaying === false) {
      webrtcHandler.play();
    }
  });
});