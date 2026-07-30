#!/bin/bash
mkdir -p /config
CONFIG_FILE="/config/config.xml"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "<Config><ApiKey>${SONARR_API_KEY}</ApiKey></Config>" > "$CONFIG_FILE"
else
    if grep -q "<ApiKey>" "$CONFIG_FILE"; then
        sed -i "s|<ApiKey>.*</ApiKey>|<ApiKey>${SONARR_API_KEY}</ApiKey>|" "$CONFIG_FILE"
    else
        sed -i "/<Config>/a \ \ <ApiKey>${SONARR_API_KEY}</ApiKey>" "$CONFIG_FILE"
    fi
fi
