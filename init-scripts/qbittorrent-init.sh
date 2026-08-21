#!/bin/bash

QBIT_CONFIG_DIR="/config/qBittorrent/config"
QBIT_CONFIG_FILE="$QBIT_CONFIG_DIR/qBittorrent.conf"

mkdir -p "$QBIT_CONFIG_DIR"

if [ ! -f "$QBIT_CONFIG_FILE" ]; then
    echo "Creating initial qBittorrent.conf..."
    cat <<EOF > "$QBIT_CONFIG_FILE"
[BitTorrent]
Session\DefaultSavePath=/data/torrents

[Preferences]
Downloads\SavePath=/data/torrents
WebUI\AuthSubnetWhitelist=172.16.0.0/12, 192.168.0.0/16, 10.0.0.0/8, 127.0.0.1/32
WebUI\AuthSubnetWhitelistEnabled=true
WebUI\LocalHostAuth=true
EOF
fi

# Always ensure our desired API Key and WebUI settings are present
echo "Configuring qBittorrent API Key and VueTorrent UI..."

# Ensure we have VueTorrent downloaded
if [ ! -d "/config/VueTorrent" ]; then
    echo "Downloading VueTorrent..."
    mkdir -p /config/VueTorrent-tmp
    curl -sL https://github.com/VueTorrent/VueTorrent/releases/latest/download/vuetorrent.zip -o /config/vuetorrent.zip
    unzip -q /config/vuetorrent.zip -d /config/VueTorrent-tmp
    mv /config/VueTorrent-tmp/vuetorrent /config/VueTorrent
    rm -rf /config/VueTorrent-tmp /config/vuetorrent.zip
fi

# Remove any existing lines for APIKey, AlternativeUIEnabled, RootFolder
sed -i '/WebUI\\APIKey=/d' "$QBIT_CONFIG_FILE"
sed -i '/WebUI\\AlternativeUIEnabled=/d' "$QBIT_CONFIG_FILE"
sed -i '/WebUI\\RootFolder=/d' "$QBIT_CONFIG_FILE"

# Add the desired settings
# Use the QBITTORRENT_API_KEY environment variable if it exists, otherwise the default
API_KEY=${QBITTORRENT_API_KEY:-6e93d18388f8df4f5a3e1a0b368798e8}

# Add them to the end of the Preferences section (or just append)
echo "WebUI\\APIKey=$API_KEY" >> "$QBIT_CONFIG_FILE"
echo "WebUI\\AlternativeUIEnabled=true" >> "$QBIT_CONFIG_FILE"
echo "WebUI\\RootFolder=/config/VueTorrent" >> "$QBIT_CONFIG_FILE"

# Ensure permissions are correct so qbittorrent (nobody) can write to it
chown -R 1000:1000 /config/qBittorrent /config/VueTorrent
