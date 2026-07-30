#!/bin/bash
mkdir -p /config/config
CONFIG_FILE="/config/config/config.yaml"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "auth:" > "$CONFIG_FILE"
    echo "  apikey: ${BAZARR_API_KEY}" >> "$CONFIG_FILE"
else
    if grep -q "apikey:" "$CONFIG_FILE"; then
        sed -i "s/^  apikey: .*/  apikey: ${BAZARR_API_KEY}/" "$CONFIG_FILE"
    else
        sed -i '/^auth:/a \ \ apikey: '"${BAZARR_API_KEY}" "$CONFIG_FILE"
    fi
fi
