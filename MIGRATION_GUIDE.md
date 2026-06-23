# Migration Guide: Moving qBittorrent and Prowlarr to Oracle Cloud VM

This guide will help you migrate **qBittorrent** and **Prowlarr** containers from your Mac Mini to your Oracle Cloud VM using Netbird VPN for secure communication.

## Overview

- **Oracle Cloud VM**: `SVCME-50` (svcme-50.veeranki.org)
- **Netbird VPN IP**: `192.168.255.50`
- **Public IP**: `140.245.232.236`
- **SSH Key**: `/Users/tito/Documents/keys/236.ssh-key.key`
- **Containers to Migrate**: qBittorrent (port 7200) and Prowlarr (port 7300)
- **Containers Remaining Local**: Jellyfin, Jellyseerr, Radarr, Sonarr, Bazarr, media-server

## Benefits of Using Netbird VPN

✅ **Secure Communication**: All traffic between Mac Mini and Oracle VM is encrypted  
✅ **No Public Exposure**: Services don't need to be exposed to the internet  
✅ **Simplified Firewall**: No need to open ports in Oracle Cloud firewall  
✅ **Better Performance**: Direct peer-to-peer connection when possible  

## Prerequisites

- ✅ Netbird VPN installed and running on both Mac Mini and Oracle VM
- ✅ Both machines connected to the same Netbird network
- ✅ Docker and Docker Compose installed on Oracle Cloud VM
- ✅ SSH access to Oracle Cloud VM

## Quick Start Migration

### Step 1: Prepare Oracle Cloud VM

```bash
# Connect to Oracle VM
ssh -i /Users/tito/Documents/keys/236.ssh-key.key ubuntu@140.245.232.236

# Verify Netbird is connected
netbird status

# Create project directory
mkdir -p ~/media-streaming-lab
cd ~/media-streaming-lab
mkdir -p config/qbittorrent config/prowlarr data/torrents
```

### Step 2: Transfer Files to Oracle VM

**From your Mac Mini**, run:

```bash
cd /Users/tito/repos/Media_Streaming_Lab

# Transfer docker-compose file
scp -i /Users/tito/Documents/keys/236.ssh-key.key \
  docker-compose.oracle.yml \
  ubuntu@140.245.232.236:~/media-streaming-lab/docker-compose.yml

# Transfer qBittorrent configuration
scp -i /Users/tito/Documents/keys/236.ssh-key.key -r \
  config/qbittorrent/ \
  ubuntu@140.245.232.236:~/media-streaming-lab/config/

# Transfer Prowlarr configuration
scp -i /Users/tito/Documents/keys/236.ssh-key.key -r \
  config/prowlarr/ \
  ubuntu@140.245.232.236:~/media-streaming-lab/config/
```

**Optional**: Transfer existing torrent data (may take time):
```bash
scp -i /Users/tito/Documents/keys/236.ssh-key.key -r \
  data/torrents/ \
  ubuntu@140.245.232.236:~/media-streaming-lab/data/
```

### Step 3: Start Services on Oracle VM

```bash
# Connect to Oracle VM
ssh -i /Users/tito/Documents/keys/236.ssh-key.key ubuntu@140.245.232.236

cd ~/media-streaming-lab

# Set correct permissions
sudo chown -R 1000:1000 config/qbittorrent config/prowlarr data/torrents

# Start containers
docker compose up -d

# Verify containers are running
docker compose ps
docker compose logs -f
```

### Step 4: Update Local Configuration

**On your Mac Mini:**

```bash
cd /Users/tito/repos/Media_Streaming_Lab

# Stop local qBittorrent and Prowlarr
docker compose stop qbittorrent prowlarr
docker compose rm -f qbittorrent prowlarr

# Backup original docker-compose.yml
cp docker-compose.yml docker-compose.yml.backup

# Use new local configuration (already updated with Netbird IP)
cp docker-compose.local.yml docker-compose.yml

# Restart remaining services
docker compose up -d
```

### Step 5: Update Service Connections

#### 5.1 Update Radarr

1. Access Radarr: `http://localhost:7400`
2. Go to **Settings** → **Download Clients**
3. Edit qBittorrent:
   - **Host**: `192.168.255.50` (Netbird VPN IP)
   - **Port**: `7200`
   - **Username**: `admin`
   - **Password**: `media-server-lab`
4. Test connection and Save

#### 5.2 Update Sonarr

1. Access Sonarr: `http://localhost:7700`
2. Go to **Settings** → **Download Clients**
3. Edit qBittorrent:
   - **Host**: `192.168.255.50` (Netbird VPN IP)
   - **Port**: `7200`
   - **Username**: `admin`
   - **Password**: `media-server-lab`
4. Test connection and Save

#### 5.3 Update Prowlarr Connections

1. Access Prowlarr: `http://192.168.255.50:7300`
2. Go to **Settings** → **Apps**
3. Edit Radarr:
   - **Prowlarr Server**: `http://192.168.255.50:7300`
   - **Radarr Server**: `http://YOUR_MAC_NETBIRD_IP:7400`
   - Test and Save
4. Edit Sonarr:
   - **Prowlarr Server**: `http://192.168.255.50:7300`
   - **Sonarr Server**: `http://YOUR_MAC_NETBIRD_IP:7700`
   - Test and Save
5. Click **Sync App Indexers** for both

**Note**: To find your Mac Mini's Netbird IP, run: `netbird status`

### Step 6: Verify Everything Works

1. **Test qBittorrent**: Access `http://192.168.255.50:7200`
2. **Test Prowlarr**: Access `http://192.168.255.50:7300`
3. **Test Download Flow**: Request content in Jellyseerr and verify it downloads

## Handling Download Paths

Since qBittorrent is now on Oracle VM, you need to handle completed downloads. Choose one option:

### Option A: NFS Share (Recommended)

**On Oracle VM:**
```bash
# Install NFS server
sudo apt update
sudo apt install nfs-kernel-server -y

# Get your Mac's Netbird IP
# Then configure export (replace YOUR_MAC_NETBIRD_IP)
echo "/home/ubuntu/media-streaming-lab/data/torrents YOUR_MAC_NETBIRD_IP(rw,sync,no_subtree_check,no_root_squash)" | sudo tee -a /etc/exports

# Apply changes
sudo exportfs -a
sudo systemctl restart nfs-kernel-server
```

**On Mac Mini:**
```bash
# Create mount point
sudo mkdir -p /Volumes/oracle-torrents

# Mount NFS share
sudo mount -t nfs 192.168.255.50:/home/ubuntu/media-streaming-lab/data/torrents /Volumes/oracle-torrents

# Make it permanent (add to /etc/fstab or use automount)
```

Then update your local docker-compose.yml to use `/Volumes/oracle-torrents` for the data path.

### Option B: Rsync Sync Script

Create a script to sync completed downloads:

```bash
# Create sync script
cat > ~/sync-torrents.sh << 'EOF'
#!/bin/bash
rsync -avz -e "ssh -i /Users/tito/Documents/keys/236.ssh-key.key" \
  ubuntu@192.168.255.50:~/media-streaming-lab/data/torrents/ \
  /Users/tito/repos/Media_Streaming_Lab/data/torrents/
EOF

chmod +x ~/sync-torrents.sh

# Run manually or add to crontab
# */15 * * * * /Users/tito/sync-torrents.sh
```

### Option C: Move Radarr/Sonarr to Oracle VM (Future)

Consider moving Radarr and Sonarr to Oracle VM as well to keep all download-related services together.

## Access URLs After Migration

**Via Netbird VPN (Secure):**
- qBittorrent: `http://192.168.255.50:7200`
- Prowlarr: `http://192.168.255.50:7300`

**Local Services:**
- Jellyfin: `http://localhost:7500`
- Jellyseerr: `http://localhost:7600`
- Radarr: `http://localhost:7400`
- Sonarr: `http://localhost:7700`
- Bazarr: `http://localhost:7800`
- Media Server: `http://localhost:7100`

## Troubleshooting

### Cannot Connect to Services on Oracle VM

**Check Netbird Connection:**
```bash
# On Mac Mini
netbird status

# On Oracle VM
ssh -i /Users/tito/Documents/keys/236.ssh-key.key ubuntu@140.245.232.236
netbird status
```

Both should show "Connected" status.

**Test Connectivity:**
```bash
# From Mac Mini, ping Oracle VM via Netbird
ping 192.168.255.50

# Test port connectivity
nc -zv 192.168.255.50 7200
nc -zv 192.168.255.50 7300
```

### Containers Not Starting

```bash
# Check logs
ssh -i /Users/tito/Documents/keys/236.ssh-key.key ubuntu@140.245.232.236
cd ~/media-streaming-lab
docker compose logs qbittorrent prowlarr

# Check permissions
sudo chown -R 1000:1000 config data
```

### Permission Errors

```bash
# On Oracle VM
cd ~/media-streaming-lab
sudo chown -R 1000:1000 config/qbittorrent config/prowlarr data/torrents
docker compose restart
```

## Maintenance

### Update Containers on Oracle VM

```bash
ssh -i /Users/tito/Documents/keys/236.ssh-key.key ubuntu@140.245.232.236
cd ~/media-streaming-lab
docker compose pull
docker compose up -d
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f qbittorrent
docker compose logs -f prowlarr
```

### Backup Configuration

```bash
# From Mac Mini
scp -i /Users/tito/Documents/keys/236.ssh-key.key -r \
  ubuntu@140.245.232.236:~/media-streaming-lab/config \
  ~/backups/oracle-backup-$(date +%Y%m%d)/
```

## Rollback Plan

If you need to rollback:

```bash
# On Mac Mini
cd /Users/tito/repos/Media_Streaming_Lab
cp docker-compose.yml.backup docker-compose.yml
docker compose up -d

# On Oracle VM
cd ~/media-streaming-lab
docker compose down
```

## Security Notes

✅ **Netbird VPN encrypts all traffic** between your Mac Mini and Oracle VM  
✅ **No need to expose ports** to the public internet  
✅ **Change default passwords** in qBittorrent and Prowlarr  
✅ **Keep Netbird updated** on both machines  

## Next Steps

Consider migrating additional services to Oracle VM:
- Radarr and Sonarr (to keep download services together)
- Bazarr (subtitle management)
- Set up automated backups
- Configure VPN for qBittorrent traffic

## Support

If you encounter issues:
1. Check Netbird connection: `netbird status`
2. Verify containers are running: `docker compose ps`
3. Check logs: `docker compose logs`
4. Test network connectivity: `ping 192.168.255.50`
