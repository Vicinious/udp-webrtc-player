#!/bin/bash

# Script to open the necessary ports for UDP WebRTC Player
# Must be run with sudo permissions

# Detect OS type
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$NAME
elif type lsb_release >/dev/null 2>&1; then
    OS=$(lsb_release -si)
else
    OS=$(uname -s)
fi

echo "Detected OS: $OS"

# Function to open ports with firewalld
open_with_firewalld() {
    echo "Opening ports with firewalld..."
    sudo firewall-cmd --permanent --add-port=3001/tcp
    sudo firewall-cmd --permanent --add-port=3001/udp
    sudo firewall-cmd --permanent --add-port=33334/udp
    sudo firewall-cmd --reload
    echo "Ports opened successfully with firewalld."
}

# Function to open ports with ufw
open_with_ufw() {
    echo "Opening ports with UFW..."
    sudo ufw allow 3001/tcp
    sudo ufw allow 3001/udp
    sudo ufw allow 33334/udp
    echo "Ports opened successfully with UFW."
}

# Function to open ports with iptables
open_with_iptables() {
    echo "Opening ports with iptables..."
    # HTTP port (3001) for TCP
    sudo iptables -A INPUT -p tcp --dport 3001 -j ACCEPT
    # UDP port (3001) for socket fallback
    sudo iptables -A INPUT -p udp --dport 3001 -j ACCEPT
    # WebRTC UDP port (33334)
    sudo iptables -A INPUT -p udp --dport 33334 -j ACCEPT
    
    # Save the rules if possible
    if command -v netfilter-persistent > /dev/null; then
        sudo netfilter-persistent save
    elif command -v iptables-save > /dev/null; then
        sudo mkdir -p /etc/iptables
        sudo iptables-save > /etc/iptables/rules.v4
    else
        echo "WARNING: Could not save iptables rules permanently."
        echo "You may need to install iptables-persistent: sudo apt-get install iptables-persistent"
    fi
    
    echo "Ports opened successfully with iptables."
}

# Check if script is being run as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run this script with sudo or as root"
    exit 1
fi

# Determine which firewall to use based on OS and available commands
if command -v firewall-cmd >/dev/null 2>&1; then
    open_with_firewalld
elif command -v ufw >/dev/null 2>&1 && ufw status | grep -q "active"; then
    open_with_ufw
elif command -v iptables >/dev/null 2>&1; then
    open_with_iptables
else
    echo "No supported firewall found. Please manually configure your firewall to open:"
    echo "- TCP port 3001 (HTTP server)"
    echo "- UDP port 3001 (Socket.IO fallback)"
    echo "- UDP port 33334 (WebRTC data)"
    exit 1
fi

echo "All ports configured successfully:"
echo "- TCP port 3001 (HTTP server)"
echo "- UDP port 3001 (Socket.IO fallback)"
echo "- UDP port 33334 (WebRTC data)"
echo ""
echo "To verify, try:"
echo "sudo lsof -i :3001"
echo "sudo lsof -i :33334"