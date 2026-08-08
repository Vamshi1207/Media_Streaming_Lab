# Troubleshooting Guide

## Cloudflare Tunnel 502 Bad Gateway

If you are using the `remote-access` profile for Cloudflare tunnels and receive a **502 Bad Gateway** error when accessing your domain, check the following:

### 1. Split-Brain Tunnel (Native vs Docker)
If you have a native `cloudflared` service running on your host machine (e.g., installed via systemd) at the same time as the Docker `cloudflared` container, Cloudflare will load-balance requests between them. 
Because the native service runs on the host network, it will fail to route traffic into the Docker network, causing intermittent 502 errors.

**Fix**: Stop and disable the native host service.
```bash
sudo systemctl stop cloudflared && sudo systemctl disable cloudflared
```

### 2. Invalid Tunnel Token
If you recreate or rotate your tunnel in the Cloudflare Zero Trust dashboard, the old token will instantly become invalid. The `cloudflared` container will reach the internet but will log an `Unauthorized: Invalid tunnel secret` error and drop the connection.

**Fix**: Update the `TUNNEL_TOKEN` variable in your `.env` file with the new token, then restart the container:
```bash
docker compose --profile remote-access up -d cloudflared
```

### 3. Docker Subnet Clashes
By default, Docker Compose bridge networks can occasionally clash with existing host interfaces if the subnet overlaps (e.g., `172.25.0.0/16`). If this happens, containers on that network will lose internet access completely.
*Note: The `docker-compose.yml` in this project has been explicitly pinned to `172.27.0.0/16` to avoid common host conflicts. Avoid changing it back to `172.25.0.0/16` or `172.17.0.0/16`.*

### 4. /etc/hosts Overrides
If you manually placed hardcoded IP addresses for `media-server`, `jellyfin`, or `jellyseerr` in your host's `/etc/hosts` file (e.g., `172.20.0.16 media-server`), you must remove them.
Since Docker dynamically assigns IPs or uses the defined subnet, hardcoded `/etc/hosts` entries will break local host resolution if the subnet changes. Always rely on Docker's internal DNS or the Cloudflare Tunnel for access.
