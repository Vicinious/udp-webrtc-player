/**
 * Video player controls handler with Apple-style UI
 */
class VideoPlayer {
  constructor(videoElement) {
    this.videoElement = videoElement;
    this.playButton = document.getElementById('play-btn');
    this.pauseButton = document.getElementById('pause-btn');
    this.stopButton = document.getElementById('stop-btn');
    this.volumeControl = document.getElementById('volume');
    this.fullscreenButton = document.getElementById('fullscreen-btn');
    
    this.isPlaying = false;
    this.webrtcHandler = null;
    this.controls = {};
    
    this.initialize();
  }
  
  /**
   * Initialize player controls
   */
  initialize() {
    // Set initial volume
    this.videoElement.volume = this.volumeControl ? this.volumeControl.value : 0.7;
    
    // Create custom controls if needed
    this._createCustomControls();
    
    // Play button click handler
    if (this.playButton) {
      this.playButton.addEventListener('click', () => {
        this.play();
      });
    }
    
    // Pause button click handler
    if (this.pauseButton) {
      this.pauseButton.addEventListener('click', () => {
        this.pause();
      });
    }
    
    // Stop button click handler
    if (this.stopButton) {
      this.stopButton.addEventListener('click', () => {
        this.stop();
      });
    }
    
    // Volume change handler
    if (this.volumeControl) {
      this.volumeControl.addEventListener('input', () => {
        this.updateVolume();
      });
    }
    
    // Fullscreen button click handler
    if (this.fullscreenButton) {
      this.fullscreenButton.addEventListener('click', () => {
        this.toggleFullscreen();
      });
    }
    
    // Video element event listeners
    this.videoElement.addEventListener('play', () => {
      this.isPlaying = true;
      this.updateUI();
    });
    
    this.videoElement.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updateUI();
    });
    
    this.videoElement.addEventListener('ended', () => {
      this.isPlaying = false;
      this.updateUI();
    });
    
    // Auto-hide controls for fullscreen
    this.videoElement.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) {
        this._setupFullscreenControls();
      } else {
        this._cleanupFullscreenControls();
      }
    });
    
    // Listen for keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Only handle events when the video player is in focus
      if (e.target === this.videoElement || 
          this.videoElement.contains(e.target) || 
          document.activeElement === document.body) {
        this._handleKeyboardShortcut(e);
      }
    });
    
    // Initialize UI
    this.updateUI();
  }
  
  /**
   * Create custom controls overlay for Apple-style playback
   */
  _createCustomControls() {
    // Check if controls already exist
    if (this.controls.container) return;
    
    // Create container for overlay controls
    const container = document.createElement('div');
    container.className = 'video-overlay-controls';
    container.style.cssText = `
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 100%);
      padding: 20px;
      display: flex;
      align-items: center;
      opacity: 0;
      transition: opacity 0.3s ease;
      pointer-events: none;
      z-index: 10;
    `;
    
    // Only create if needed (if parent element has position relative/absolute)
    const parentElement = this.videoElement.parentElement;
    if (parentElement && getComputedStyle(parentElement).position !== 'static') {
      parentElement.appendChild(container);
      this.controls.container = container;
      
      // Add hover effect to show controls
      parentElement.addEventListener('mouseenter', () => {
        container.style.opacity = '1';
        container.style.pointerEvents = 'auto';
      });
      
      parentElement.addEventListener('mouseleave', () => {
        if (!this.isPlaying) return;
        container.style.opacity = '0';
        container.style.pointerEvents = 'none';
      });
      
      // Create play/pause toggle button
      const playToggle = document.createElement('button');
      playToggle.className = 'play-toggle';
      playToggle.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
      playToggle.style.cssText = `
        background: rgba(255,255,255,0.2);
        border: none;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        margin-right: 15px;
      `;
      
      playToggle.addEventListener('click', () => {
        if (this.isPlaying) {
          this.pause();
        } else {
          this.play();
        }
      });
      
      container.appendChild(playToggle);
      this.controls.playToggle = playToggle;
      
      // Create progress bar
      const progressBar = document.createElement('div');
      progressBar.className = 'progress-bar';
      progressBar.style.cssText = `
        flex: 1;
        height: 4px;
        background: rgba(255,255,255,0.2);
        border-radius: 2px;
        position: relative;
        overflow: hidden;
        cursor: pointer;
      `;
      
      const progress = document.createElement('div');
      progress.className = 'progress';
      progress.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        background: #0071e3;
        width: 0%;
        border-radius: 2px;
      `;
      
      progressBar.appendChild(progress);
      container.appendChild(progressBar);
      this.controls.progressBar = progressBar;
      this.controls.progress = progress;
      
      // Update progress
      const updateProgress = () => {
        if (this.videoElement.duration) {
          const percent = (this.videoElement.currentTime / this.videoElement.duration) * 100;
          progress.style.width = `${percent}%`;
        }
      };
      
      this.videoElement.addEventListener('timeupdate', updateProgress);
      
      // Allow seeking by clicking on progress bar
      progressBar.addEventListener('click', (e) => {
        const rect = progressBar.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        if (this.videoElement.duration) {
          this.videoElement.currentTime = pos * this.videoElement.duration;
        }
      });
      
      // Create time display
      const timeDisplay = document.createElement('div');
      timeDisplay.className = 'time-display';
      timeDisplay.style.cssText = `
        color: white;
        font-size: 14px;
        margin-left: 15px;
        min-width: 50px;
        text-align: right;
      `;
      
      container.appendChild(timeDisplay);
      this.controls.timeDisplay = timeDisplay;
      
      // Update time display
      const updateTime = () => {
        if (this.videoElement.duration) {
          const current = this._formatTime(this.videoElement.currentTime);
          timeDisplay.textContent = current;
        } else {
          timeDisplay.textContent = '00:00';
        }
      };
      
      this.videoElement.addEventListener('timeupdate', updateTime);
      updateTime();
    }
  }
  
  /**
   * Set up fullscreen controls behavior
   */
  _setupFullscreenControls() {
    if (!this.controls.container) return;
    
    // Auto-hide controls after delay
    this._autoHideTimeout = setTimeout(() => {
      this.controls.container.style.opacity = '0';
      this.controls.container.style.pointerEvents = 'none';
    }, 3000);
    
    // Show controls on mouse movement
    this._fullscreenMouseMoveHandler = () => {
      this.controls.container.style.opacity = '1';
      this.controls.container.style.pointerEvents = 'auto';
      
      clearTimeout(this._autoHideTimeout);
      this._autoHideTimeout = setTimeout(() => {
        if (this.isPlaying) {
          this.controls.container.style.opacity = '0';
          this.controls.container.style.pointerEvents = 'none';
        }
      }, 3000);
    };
    
    document.addEventListener('mousemove', this._fullscreenMouseMoveHandler);
  }
  
  /**
   * Clean up fullscreen controls behavior
   */
  _cleanupFullscreenControls() {
    if (this._fullscreenMouseMoveHandler) {
      document.removeEventListener('mousemove', this._fullscreenMouseMoveHandler);
      this._fullscreenMouseMoveHandler = null;
    }
    
    if (this._autoHideTimeout) {
      clearTimeout(this._autoHideTimeout);
      this._autoHideTimeout = null;
    }
    
    if (this.controls.container) {
      this.controls.container.style.opacity = '1';
      this.controls.container.style.pointerEvents = 'auto';
    }
  }
  
  /**
   * Handle keyboard shortcuts
   * @param {KeyboardEvent} e - Keyboard event
   */
  _handleKeyboardShortcut(e) {
    switch (e.key) {
      case ' ':
      case 'k':
        // Space or K to toggle play/pause
        e.preventDefault();
        if (this.isPlaying) {
          this.pause();
        } else {
          this.play();
        }
        break;
        
      case 'f':
        // F to toggle fullscreen
        e.preventDefault();
        this.toggleFullscreen();
        break;
        
      case 'm':
        // M to toggle mute
        e.preventDefault();
        this.videoElement.muted = !this.videoElement.muted;
        break;
        
      case 'ArrowRight':
        // Right arrow to seek forward
        e.preventDefault();
        if (this.videoElement.duration) {
          this.videoElement.currentTime = Math.min(
            this.videoElement.duration,
            this.videoElement.currentTime + 10
          );
        }
        break;
        
      case 'ArrowLeft':
        // Left arrow to seek backward
        e.preventDefault();
        if (this.videoElement.duration) {
          this.videoElement.currentTime = Math.max(
            0, 
            this.videoElement.currentTime - 10
          );
        }
        break;
        
      case 'Escape':
        // Escape to exit fullscreen
        if (document.fullscreenElement) {
          document.exitFullscreen();
        }
        break;
    }
  }
  
  /**
   * Format time in seconds to MM:SS format
   * @param {number} seconds - Time in seconds
   * @returns {string} Formatted time string
   */
  _formatTime(seconds) {
    seconds = Math.floor(seconds);
    const minutes = Math.floor(seconds / 60);
    seconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  
  /**
   * Set the WebRTC handler
   * @param {WebRTCHandler} handler - The WebRTC handler instance
   */
  setWebRTCHandler(handler) {
    this.webrtcHandler = handler;
  }
  
  /**
   * Play the video
   */
  play() {
    if (this.webrtcHandler) {
      this.webrtcHandler.play();
    } else {
      this.videoElement.play()
        .catch(err => console.error('Error playing video:', err));
    }
    
    this.isPlaying = true;
    this.updateUI();
    
    // Update play toggle button icon if it exists
    if (this.controls.playToggle) {
      this.controls.playToggle.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
    }
  }
  
  /**
   * Pause the video
   */
  pause() {
    if (this.webrtcHandler) {
      this.webrtcHandler.pause();
    } else {
      this.videoElement.pause();
    }
    
    this.isPlaying = false;
    this.updateUI();
    
    // Update play toggle button icon if it exists
    if (this.controls.playToggle) {
      this.controls.playToggle.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
    }
  }
  
  /**
   * Stop the video
   */
  stop() {
    if (this.webrtcHandler) {
      this.webrtcHandler.stop();
    } else {
      this.videoElement.pause();
      this.videoElement.currentTime = 0;
    }
    
    this.isPlaying = false;
    this.updateUI();
    
    // Update play toggle button icon if it exists
    if (this.controls.playToggle) {
      this.controls.playToggle.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
    }
    
    // Reset progress if available
    if (this.controls.progress) {
      this.controls.progress.style.width = '0%';
    }
  }
  
  /**
   * Update the video volume
   */
  updateVolume() {
    if (this.volumeControl) {
      this.videoElement.volume = this.volumeControl.value;
    }
  }
  
  /**
   * Toggle fullscreen mode
   */
  toggleFullscreen() {
    if (!document.fullscreenElement) {
      // Enter fullscreen
      if (this.videoElement.requestFullscreen) {
        this.videoElement.requestFullscreen();
      } else if (this.videoElement.webkitRequestFullscreen) {
        this.videoElement.webkitRequestFullscreen();
      } else if (this.videoElement.msRequestFullscreen) {
        this.videoElement.msRequestFullscreen();
      }
    } else {
      // Exit fullscreen
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  }
  
  /**
   * Update the player UI based on current state
   */
  updateUI() {
    if (this.playButton && this.pauseButton) {
      if (this.isPlaying) {
        this.playButton.disabled = true;
        this.pauseButton.disabled = false;
      } else {
        this.playButton.disabled = false;
        this.pauseButton.disabled = true;
      }
    }
  }
}

// Export the VideoPlayer class
window.VideoPlayer = VideoPlayer;