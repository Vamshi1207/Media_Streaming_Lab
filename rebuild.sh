#!/bin/bash
set -e

# Change to script directory
cd "$(dirname "$0")"

echo "=========================================="
echo "Stage 1: Creating containers"
echo "=========================================="
# Stop media-server and auto-configurator so they don't use old keys
docker compose stop media-server auto-configurator || true

# Bring up the core apps (creates them if they don't exist)
docker compose up -d radarr sonarr prowlarr bazarr qbittorrent jellyfin jellyseerr

# Give them a few seconds to initialize their default configs on a fresh run
echo "Waiting for core apps to initialize configurations..."
sleep 15

echo "=========================================="
echo "Stage 2: Created .env file (Blank slate)"
echo "=========================================="
# We preserve TUNNEL_TOKEN, GITHUB_TOKEN, and LOCAL_HOST_IP from the old .env if they exist
TUNNEL_TOKEN=$(grep -oP '^TUNNEL_TOKEN=\K.*' .env || echo "")
GITHUB_TOKEN=$(grep -oP '^GITHUB_TOKEN=\K.*' .env || echo "")
LOCAL_HOST_IP=$(grep -oP '^LOCAL_HOST_IP=\K.*' .env || echo "192.168.2.10")

# Wipe the .env file
> .env

echo "=========================================="
echo "Stage 3: Populate with keys"
echo "=========================================="
# Generate completely new API keys for rotation
RADARR_KEY=$(cat /proc/sys/kernel/random/uuid | tr -d '-')
SONARR_KEY=$(cat /proc/sys/kernel/random/uuid | tr -d '-')
PROWLARR_KEY=$(cat /proc/sys/kernel/random/uuid | tr -d '-')
BAZARR_KEY=$(cat /proc/sys/kernel/random/uuid | tr -d '-')
JELLYFIN_KEY=$(cat /proc/sys/kernel/random/uuid | tr -d '-')
QBITTORRENT_KEY=$(cat /proc/sys/kernel/random/uuid | tr -d '-')

# Inject these keys into the respective app configurations
# Radarr
if grep -q "<ApiKey>" config/radarr/config.xml 2>/dev/null; then
    sed -i "s|<ApiKey>.*</ApiKey>|<ApiKey>$RADARR_KEY</ApiKey>|" config/radarr/config.xml
else
    sed -i "/<Config>/a \ \ <ApiKey>$RADARR_KEY</ApiKey>" config/radarr/config.xml
fi

# Sonarr
if grep -q "<ApiKey>" config/sonarr/config.xml 2>/dev/null; then
    sed -i "s|<ApiKey>.*</ApiKey>|<ApiKey>$SONARR_KEY</ApiKey>|" config/sonarr/config.xml
else
    sed -i "/<Config>/a \ \ <ApiKey>$SONARR_KEY</ApiKey>" config/sonarr/config.xml
fi

# Prowlarr
if grep -q "<ApiKey>" config/prowlarr/config.xml 2>/dev/null; then
    sed -i "s|<ApiKey>.*</ApiKey>|<ApiKey>$PROWLARR_KEY</ApiKey>|" config/prowlarr/config.xml
else
    sed -i "/<Config>/a \ \ <ApiKey>$PROWLARR_KEY</ApiKey>" config/prowlarr/config.xml
fi

# Bazarr
if grep -q "apikey =" config/bazarr/config/config.ini 2>/dev/null; then
    sed -i "s|^apikey =.*|apikey = $BAZARR_KEY|" config/bazarr/config/config.ini
else
    if grep -q "\[auth\]" config/bazarr/config/config.ini 2>/dev/null; then
        sed -i "s/^\[auth\]/[auth]\napikey = $BAZARR_KEY/" config/bazarr/config/config.ini
    else
        echo -e "[auth]\napikey = $BAZARR_KEY" >> config/bazarr/config/config.ini
    fi
fi

# Restart the core apps so they load the newly injected configs
docker compose restart radarr sonarr prowlarr bazarr

# Write the fresh keys to .env
cat <<EOF_ENV > .env
JELLYFIN_API_KEY=$JELLYFIN_KEY
RADARR_API_KEY=$RADARR_KEY
SONARR_API_KEY=$SONARR_KEY
PROWLARR_API_KEY=$PROWLARR_KEY
BAZARR_API_KEY=$BAZARR_KEY
QBITTORRENT_API_KEY=$QBITTORRENT_KEY
LOCAL_HOST_IP=$LOCAL_HOST_IP
TUNNEL_TOKEN=$TUNNEL_TOKEN
GITHUB_TOKEN=$GITHUB_TOKEN
EOF_ENV

echo "All keys rotated and populated in .env!"

echo "=========================================="
echo "Stage 4: Run configuration"
echo "=========================================="
# Recreate media-server and auto-configurator so they pick up the new .env file keys
docker compose up -d --force-recreate media-server auto-configurator

echo "Setup Complete!"
