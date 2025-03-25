#!/bin/bash

# UDP WebRTC Player Installation Script
# This script installs the required dependencies and sets up the application

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}===== UDP WebRTC Player Installation =====${NC}"
echo "This script will install all necessary dependencies and set up the application."

# Check if running as root and warn
if [ "$EUID" -eq 0 ]; then
  echo -e "${YELLOW}Warning: Running as root. It's recommended to install Node.js packages as a regular user.${NC}"
  read -p "Continue as root? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Installation cancelled."
    exit 1
  fi
fi

# Check for Node.js
echo -e "${BLUE}Checking for Node.js...${NC}"
if command -v node > /dev/null 2>&1; then
  NODE_VERSION=$(node -v)
  echo -e "${GREEN}Node.js is installed: $NODE_VERSION${NC}"
  
  # Check version is at least 14.x
  NODE_MAJOR_VERSION=$(echo $NODE_VERSION | cut -d. -f1 | tr -d 'v')
  if [ "$NODE_MAJOR_VERSION" -lt 14 ]; then
    echo -e "${RED}Node.js version 14.x or higher is required. Please upgrade Node.js.${NC}"
    exit 1
  fi
else
  echo -e "${RED}Node.js is not installed. Please install Node.js 14.x or higher.${NC}"
  echo "You can install Node.js from https://nodejs.org/"
  exit 1
fi

# Check for npm
echo -e "${BLUE}Checking for npm...${NC}"
if command -v npm > /dev/null 2>&1; then
  NPM_VERSION=$(npm -v)
  echo -e "${GREEN}npm is installed: $NPM_VERSION${NC}"
else
  echo -e "${RED}npm is not installed. Please install npm.${NC}"
  exit 1
fi

# Install dependencies
echo -e "${BLUE}Installing dependencies...${NC}"
npm install

# Optional: Install PM2 globally
echo -e "${BLUE}Would you like to install PM2 globally for process management?${NC}"
echo "PM2, a process manager for Node.js, is recommended for production use."
read -p "Install PM2? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${BLUE}Installing PM2 globally...${NC}"
  npm install -g pm2
  
  # Set up logs directory
  echo -e "${BLUE}Creating logs directory...${NC}"
  mkdir -p logs
fi

# Create directories
echo -e "${BLUE}Creating required directories...${NC}"
mkdir -p logs
mkdir -p public/images

# Set permissions
echo -e "${BLUE}Setting file permissions...${NC}"
chmod +x open-ports.sh

# Offer to configure the firewall
echo -e "${BLUE}Would you like to configure the firewall to open necessary ports?${NC}"
echo "This requires sudo/root privileges."
read -p "Configure firewall? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  sudo ./open-ports.sh
fi

# Install systemd service
echo -e "${BLUE}Would you like to install a systemd service?${NC}"
echo "This will allow the server to start automatically at boot."
echo "This requires sudo/root privileges."
read -p "Install systemd service? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  if [ -d "/etc/systemd/system/" ]; then
    echo -e "${BLUE}Installing systemd service...${NC}"
    sudo cp udp-webrtc-player.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable udp-webrtc-player.service
    echo -e "${GREEN}Service installed. You can start it with: sudo systemctl start udp-webrtc-player.service${NC}"
  else
    echo -e "${RED}Systemd directory not found. Cannot install service.${NC}"
  fi
fi

# Get the server's public IP
echo -e "${BLUE}Getting server's public IP address...${NC}"
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || echo "your-server-ip")

# Installation complete
echo -e "${GREEN}=======================${NC}"
echo -e "${GREEN}Installation complete!${NC}"
echo -e "${GREEN}=======================${NC}"
echo ""
echo "To start the server in development mode:"
echo "  npm start"
echo ""
echo "To start with PM2 (if installed):"
echo "  npm run start:pm2"
echo ""
echo "To start in production mode with PM2:"
echo "  npm run start:prod"
echo ""
echo "To start with systemd (if installed):"
echo "  sudo systemctl start udp-webrtc-player.service"
echo ""
echo "The server will be available at:"
echo "  http://$PUBLIC_IP:3001"
echo ""
echo "Send UDP data to:"
echo "  $PUBLIC_IP:33334"