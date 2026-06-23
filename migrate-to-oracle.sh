#!/bin/bash

# Migration Script: Move qBittorrent and Prowlarr to Oracle Cloud VM
# This script automates the migration process using Netbird VPN

set -e  # Exit on error

# Configuration
ORACLE_IP="140.245.232.236"
ORACLE_NETBIRD_IP="192.168.255.50"
SSH_KEY="/Users/tito/Documents/keys/236.ssh-key.key"
SSH_USER="ubuntu"
REMOTE_DIR="~/media-streaming-lab"
LOCAL_DIR="/Users/tito/repos/Media_Streaming_Lab"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_step() {
    echo -e "${BLUE}==>${NC} ${GREEN}$1${NC}"
}

print_warning() {
    echo -e "${YELLOW}WARNING:${NC} $1"
}

print_error() {
    echo -e "${RED}ERROR:${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

check_prerequisites() {
    print_step "Checking prerequisites..."
    
    # Check if SSH key exists
    if [ ! -f "$SSH_KEY" ]; then
        print_error "SSH key not found at $SSH_KEY"
        exit 1
    fi
    print_success "SSH key found"
    
    # Check if docker-compose files exist
    if [ ! -f "$LOCAL_DIR/docker-compose.oracle.yml" ]; then
        print_error "docker-compose.oracle.yml not found"
        exit 1
    fi
    print_success "Docker compose files found"
    
    # Check Netbird connection
    if ! command -v netbird &> /dev/null; then
        print_warning "Netbird CLI not found. Make sure Netbird is running."
    else
        if netbird status | grep -q "Connected"; then
            print_success "Netbird is connected"
        else
            print_error "Netbird is not connected. Please connect first."
            exit 1
        fi
    fi
    
    # Test SSH connection
    if ssh -i "$SSH_KEY" -o ConnectTimeout=5 -o BatchMode=yes "$SSH_USER@$ORACLE_IP" exit 2>/dev/null; then
        print_success "SSH connection successful"
    else
        print_error "Cannot connect to Oracle VM via SSH"
        exit 1
    fi
}

prepare_oracle_vm() {
    print_step "Preparing Oracle Cloud VM..."
    
    ssh -i "$SSH_KEY" "$SSH_USER@$ORACLE_IP" << 'EOF'
        # Check Netbird status
        if ! netbird status | grep -q "Connected"; then
            echo "ERROR: Netbird is not connected on Oracle VM"
            exit 1
        fi
        
        # Create directories
        mkdir -p ~/media-streaming-lab/config/qbittorrent
        mkdir -p ~/media-streaming-lab/config/prowlarr
        mkdir -p ~/media-streaming-lab/data/torrents
        
        # Check if Docker is installed
        if ! command -v docker &> /dev/null; then
            echo "ERROR: Docker is not installed on Oracle VM"
            exit 1
        fi
        
        echo "Oracle VM prepared successfully"
EOF
    
    print_success "Oracle VM is ready"
}

transfer_files() {
    print_step "Transferring files to Oracle VM..."
    
    cd "$LOCAL_DIR"
    
    # Transfer docker-compose file
    print_step "Transferring docker-compose.yml..."
    scp -i "$SSH_KEY" docker-compose.oracle.yml "$SSH_USER@$ORACLE_IP:$REMOTE_DIR/docker-compose.yml"
    print_success "Docker compose file transferred"
    
    # Transfer qBittorrent config
    print_step "Transferring qBittorrent configuration..."
    scp -i "$SSH_KEY" -r config/qbittorrent/ "$SSH_USER@$ORACLE_IP:$REMOTE_DIR/config/"
    print_success "qBittorrent config transferred"
    
    # Transfer Prowlarr config
    print_step "Transferring Prowlarr configuration..."
    scp -i "$SSH_KEY" -r config/prowlarr/ "$SSH_USER@$ORACLE_IP:$REMOTE_DIR/config/"
    print_success "Prowlarr config transferred"
    
    # Ask about torrent data
    echo ""
    read -p "Do you want to transfer existing torrent data? This may take a while. (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_step "Transferring torrent data (this may take a while)..."
        scp -i "$SSH_KEY" -r data/torrents/ "$SSH_USER@$ORACLE_IP:$REMOTE_DIR/data/"
        print_success "Torrent data transferred"
    else
        print_warning "Skipping torrent data transfer"
    fi
}

start_oracle_services() {
    print_step "Starting services on Oracle VM..."
    
    ssh -i "$SSH_KEY" "$SSH_USER@$ORACLE_IP" << 'EOF'
        cd ~/media-streaming-lab
        
        # Set correct permissions
        sudo chown -R 1000:1000 config/qbittorrent config/prowlarr data/torrents
        
        # Pull latest images
        docker compose pull
        
        # Start containers
        docker compose up -d
        
        # Wait a bit for containers to start
        sleep 5
        
        # Check if containers are running
        if docker compose ps | grep -q "Up"; then
            echo "Containers started successfully"
        else
            echo "ERROR: Containers failed to start"
            docker compose logs
            exit 1
        fi
EOF
    
    print_success "Services started on Oracle VM"
}

update_local_config() {
    print_step "Updating local configuration..."
    
    cd "$LOCAL_DIR"
    
    # Stop local containers
    print_step "Stopping local qBittorrent and Prowlarr..."
    docker compose stop qbittorrent prowlarr 2>/dev/null || true
    docker compose rm -f qbittorrent prowlarr 2>/dev/null || true
    print_success "Local containers stopped"
    
    # Backup original docker-compose.yml
    if [ ! -f "docker-compose.yml.backup" ]; then
        print_step "Backing up original docker-compose.yml..."
        cp docker-compose.yml docker-compose.yml.backup
        print_success "Backup created"
    else
        print_warning "Backup already exists, skipping"
    fi
    
    # Use new local configuration
    print_step "Switching to new docker-compose configuration..."
    cp docker-compose.local.yml docker-compose.yml
    print_success "Configuration updated"
    
    # Restart remaining services
    print_step "Restarting local services..."
    docker compose up -d
    print_success "Local services restarted"
}

verify_migration() {
    print_step "Verifying migration..."
    
    # Test connectivity to Oracle services
    if nc -zv "$ORACLE_NETBIRD_IP" 7200 2>&1 | grep -q "succeeded"; then
        print_success "qBittorrent is accessible at $ORACLE_NETBIRD_IP:7200"
    else
        print_warning "Cannot connect to qBittorrent. Check Netbird connection."
    fi
    
    if nc -zv "$ORACLE_NETBIRD_IP" 7300 2>&1 | grep -q "succeeded"; then
        print_success "Prowlarr is accessible at $ORACLE_NETBIRD_IP:7300"
    else
        print_warning "Cannot connect to Prowlarr. Check Netbird connection."
    fi
}

print_next_steps() {
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}Migration completed successfully!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "Next steps:"
    echo ""
    echo "1. Update Radarr download client:"
    echo "   - Access: http://localhost:7400"
    echo "   - Settings → Download Clients → Edit qBittorrent"
    echo "   - Host: $ORACLE_NETBIRD_IP"
    echo "   - Port: 7200"
    echo ""
    echo "2. Update Sonarr download client:"
    echo "   - Access: http://localhost:7700"
    echo "   - Settings → Download Clients → Edit qBittorrent"
    echo "   - Host: $ORACLE_NETBIRD_IP"
    echo "   - Port: 7200"
    echo ""
    echo "3. Update Prowlarr app connections:"
    echo "   - Access: http://$ORACLE_NETBIRD_IP:7300"
    echo "   - Settings → Apps → Update Radarr and Sonarr URLs"
    echo "   - Sync App Indexers"
    echo ""
    echo "4. Access your migrated services:"
    echo "   - qBittorrent: http://$ORACLE_NETBIRD_IP:7200"
    echo "   - Prowlarr: http://$ORACLE_NETBIRD_IP:7300"
    echo ""
    echo "5. Set up NFS share for download access (see MIGRATION_GUIDE.md)"
    echo ""
    echo "For detailed instructions, see: MIGRATION_GUIDE.md"
    echo ""
}

# Main execution
main() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Oracle Cloud VM Migration Script${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo "This script will migrate qBittorrent and Prowlarr"
    echo "from your Mac Mini to Oracle Cloud VM"
    echo ""
    echo "Oracle VM: $ORACLE_IP (Netbird: $ORACLE_NETBIRD_IP)"
    echo ""
    read -p "Do you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Migration cancelled"
        exit 0
    fi
    
    check_prerequisites
    prepare_oracle_vm
    transfer_files
    start_oracle_services
    update_local_config
    verify_migration
    print_next_steps
}

# Run main function
main
