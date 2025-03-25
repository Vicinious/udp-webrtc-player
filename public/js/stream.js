/**
 * Browser streaming functionality for UDP WebRTC Player
 */
document.addEventListener('DOMContentLoaded', () => {
  // DOM elements
  const localVideo = document.getElementById('local-video');
  const connectionStatus = document.getElementById('connection-status');
  const streamStatus = document.getElementById('stream-status');
  const streamDuration = document.getElementById('stream-duration');
  const viewerCount = document.getElementById('viewer-count');
  const streamUrl = document.getElementById('stream-url');
  const statusIndicator = document.querySelector('.status-indicator');
  
  // Control buttons
  const startStreamBtn = document.getElementById('start-stream-btn');
  const stopStreamBtn = document.getElementById('stop-stream-btn');
  const toggleMuteBtn = document.getElementById('toggle-mute-btn');
  const toggleVideoBtn = document.getElementById('toggle-video-btn');
  
  // Media options
  const videoSourceSelect = document.getElementById('video-source');
  const audioSourceSelect = document.getElementById('audio-source');
  const enableVideoCheckbox = document.getElementById('enable-video');
  const enableAudioCheckbox = document.getElementById('enable-audio');
  
  // State variables
  let localStream = null;
  let peerConnections = {};
  let streamId = '';
  let isStreaming = false;
  let startTime = null;
  let durationInterval = null;
  let videoEnabled = true;
  let audioEnabled = true;
  
  // Socket.io connection
  const socket = io();
  
  // Initialize connection
  socket.on('connect', () => {
    connectionStatus.textContent = 'Connected';
    connectionStatus.classList.add('connected');
    streamId = generateStreamId();
    updateStreamUrl();
  });
  
  socket.on('disconnect', () => {
    connectionStatus.textContent = 'Disconnected';
    connectionStatus.classList.remove('connected');
    connectionStatus.classList.add('error');
  });
  
  // WebRTC signaling events
  socket.on('broadcaster-viewer-connected', (viewerId) => {
    console.log(`Viewer connected: ${viewerId}`);
    handleViewerConnected(viewerId);
    updateViewerCount();
  });
  
  socket.on('broadcaster-viewer-disconnected', (viewerId) => {
    console.log(`Viewer disconnected: ${viewerId}`);
    handleViewerDisconnected(viewerId);
    updateViewerCount();
  });
  
  socket.on('broadcaster-signal', (data) => {
    if (!peerConnections[data.viewerId]) {
      return;
    }
    
    switch (data.type) {
      case 'answer':
        peerConnections[data.viewerId].setRemoteDescription(new RTCSessionDescription(data.sdp))
          .catch(err => console.error('Error setting remote description:', err));
        break;
        
      case 'ice-candidate':
        peerConnections[data.viewerId].addIceCandidate(new RTCIceCandidate(data.candidate))
          .catch(err => console.error('Error adding ICE candidate:', err));
        break;
    }
  });
  
  // Handle button clicks
  startStreamBtn.addEventListener('click', startStreaming);
  stopStreamBtn.addEventListener('click', stopStreaming);
  toggleMuteBtn.addEventListener('click', toggleMute);
  toggleVideoBtn.addEventListener('click', toggleVideo);
  
  // Handle checkboxes
  enableVideoCheckbox.addEventListener('change', () => {
    videoEnabled = enableVideoCheckbox.checked;
  });
  
  enableAudioCheckbox.addEventListener('change', () => {
    audioEnabled = enableAudioCheckbox.checked;
  });
  
  // Get available media devices
  async function getMediaDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      // Clear existing options
      videoSourceSelect.innerHTML = '';
      audioSourceSelect.innerHTML = '';
      
      // Add video sources
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      videoDevices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.text = device.label || `Camera ${videoSourceSelect.length + 1}`;
        videoSourceSelect.appendChild(option);
      });
      
      // Add audio sources
      const audioDevices = devices.filter(device => device.kind === 'audioinput');
      audioDevices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.text = device.label || `Microphone ${audioSourceSelect.length + 1}`;
        audioSourceSelect.appendChild(option);
      });
      
      // If no devices found or not labeled, we need to request permission first
      if (!videoDevices.length || !videoDevices[0].label) {
        await requestMediaPermissions();
        await getMediaDevices();
      }
    } catch (err) {
      console.error('Error getting media devices:', err);
      alert('Error getting media devices: ' + err.message);
    }
  }
  
  // Request permissions to access media devices
  async function requestMediaPermissions() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach(track => track.stop());
    } catch (err) {
      console.error('Error requesting media permissions:', err);
    }
  }
  
  // Start streaming
  async function startStreaming() {
    if (isStreaming) return;
    
    try {
      // Get selected devices
      const videoSource = videoSourceSelect.value;
      const audioSource = audioSourceSelect.value;
      
      // Build constraints based on user selections
      const constraints = {
        video: videoEnabled ? { deviceId: videoSource ? { exact: videoSource } : undefined } : false,
        audio: audioEnabled ? { deviceId: audioSource ? { exact: audioSource } : undefined } : false
      };
      
      // Get user media
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Display local video
      localVideo.srcObject = localStream;
      
      // Register as broadcaster
      socket.emit('register-broadcaster', { streamId });
      
      // Update UI
      isStreaming = true;
      statusIndicator.classList.remove('offline');
      statusIndicator.classList.add('live');
      streamStatus.textContent = 'Live';
      startStreamBtn.disabled = true;
      stopStreamBtn.disabled = false;
      toggleMuteBtn.disabled = false;
      toggleVideoBtn.disabled = !videoEnabled;
      
      // Start tracking duration
      startTime = new Date();
      durationInterval = setInterval(updateDuration, 1000);
      
      console.log('Broadcasting started');
    } catch (err) {
      console.error('Error starting stream:', err);
      alert('Error starting stream: ' + err.message);
    }
  }
  
  // Stop streaming
  function stopStreaming() {
    if (!isStreaming) return;
    
    // Stop all tracks
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    
    // Close all peer connections
    Object.keys(peerConnections).forEach(id => {
      peerConnections[id].close();
      delete peerConnections[id];
    });
    
    // Unregister as broadcaster
    socket.emit('unregister-broadcaster', { streamId });
    
    // Clear local video
    localVideo.srcObject = null;
    
    // Update UI
    isStreaming = false;
    statusIndicator.classList.remove('live');
    statusIndicator.classList.add('offline');
    streamStatus.textContent = 'Not streaming';
    startStreamBtn.disabled = false;
    stopStreamBtn.disabled = true;
    toggleMuteBtn.disabled = true;
    toggleVideoBtn.disabled = true;
    
    // Stop duration tracking
    clearInterval(durationInterval);
    streamDuration.textContent = '00:00:00';
    
    console.log('Broadcasting stopped');
  }
  
  // Toggle audio mute
  function toggleMute() {
    if (!localStream) return;
    
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length === 0) return;
    
    const audioEnabled = !audioTracks[0].enabled;
    audioTracks.forEach(track => {
      track.enabled = audioEnabled;
    });
    
    toggleMuteBtn.textContent = audioEnabled ? 'Mute Audio' : 'Unmute Audio';
  }
  
  // Toggle video
  function toggleVideo() {
    if (!localStream) return;
    
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length === 0) return;
    
    const videoEnabled = !videoTracks[0].enabled;
    videoTracks.forEach(track => {
      track.enabled = videoEnabled;
    });
    
    toggleVideoBtn.textContent = videoEnabled ? 'Hide Video' : 'Show Video';
  }
  
  // Handle new viewer connection
  function handleViewerConnected(viewerId) {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };
    
    // Create new peer connection
    const peerConnection = new RTCPeerConnection(configuration);
    peerConnections[viewerId] = peerConnection;
    
    // Add all local tracks to the peer connection
    if (localStream) {
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });
    }
    
    // Handle ICE candidates
    peerConnection.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        socket.emit('broadcaster-signal', {
          type: 'ice-candidate',
          viewerId: viewerId,
          candidate: event.candidate
        });
      }
    });
    
    // Create and send offer
    peerConnection.createOffer()
      .then(offer => peerConnection.setLocalDescription(offer))
      .then(() => {
        socket.emit('broadcaster-signal', {
          type: 'offer',
          viewerId: viewerId,
          sdp: peerConnection.localDescription
        });
      })
      .catch(err => console.error('Error creating offer:', err));
  }
  
  // Handle viewer disconnection
  function handleViewerDisconnected(viewerId) {
    if (peerConnections[viewerId]) {
      peerConnections[viewerId].close();
      delete peerConnections[viewerId];
    }
  }
  
  // Update viewer count display
  function updateViewerCount() {
    const count = Object.keys(peerConnections).length;
    viewerCount.textContent = count;
  }
  
  // Update stream duration
  function updateDuration() {
    if (!startTime) return;
    
    const now = new Date();
    const diff = now - startTime;
    
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    
    streamDuration.textContent = [
      hours.toString().padStart(2, '0'),
      minutes.toString().padStart(2, '0'),
      seconds.toString().padStart(2, '0')
    ].join(':');
  }
  
  // Generate unique stream ID
  function generateStreamId() {
    return 'stream-' + Math.random().toString(36).substr(2, 9);
  }
  
  // Update stream URL display
  function updateStreamUrl() {
    const protocol = window.location.protocol;
    const host = window.location.host;
    const playerUrl = `${protocol}//${host}/index.html?stream=${streamId}`;
    
    streamUrl.innerHTML = `<strong>Share this URL with viewers:</strong><br>${playerUrl}`;
  }
  
  // Initialize
  getMediaDevices();
});