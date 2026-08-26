import os
import time
import json
import sqlite3
import requests

JELLYFIN_API_KEY = os.getenv("JELLYFIN_API_KEY")
RADARR_API_KEY = os.getenv("RADARR_API_KEY")
SONARR_API_KEY = os.getenv("SONARR_API_KEY")
PROWLARR_API_KEY = os.getenv("PROWLARR_API_KEY")
BAZARR_API_KEY = os.getenv("BAZARR_API_KEY")
QBITTORRENT_API_KEY = os.getenv("QBITTORRENT_API_KEY")

def wait_for_services():
    print("Waiting for services to come online...")
    services = [
        ("Radarr", f"http://radarr:7878/api/v3/system/status?apiKey={RADARR_API_KEY}"),
        ("Sonarr", f"http://sonarr:8989/api/v3/system/status?apiKey={SONARR_API_KEY}"),
        ("Prowlarr", f"http://prowlarr:9696/api/v1/system/status?apiKey={PROWLARR_API_KEY}"),
        ("Bazarr", f"http://bazarr:6767/api/system/status?apikey={BAZARR_API_KEY}"),
        ("qBittorrent", "http://qbittorrent:8080/api/v2/app/version")
    ]
    for name, url in services:
        while True:
            try:
                if name == "Bazarr":
                    res = requests.get(url, timeout=5)
                    # Bazarr returns 401 if apikey is wrong but connection works
                    if res.status_code in [200, 401]: break
                else:
                    res = requests.get(url, timeout=5)
                    if res.status_code == 200: break
            except Exception:
                pass
            print(f"Waiting for {name}...")
            time.sleep(3)
    print("All services are online!")

def seed_jellyfin():
    print("Seeding Jellyfin...")
    db_path = "/config/jellyfin/data/data/jellyfin.db"
    # Wait for Jellyfin to create the DB
    for _ in range(30):
        if os.path.exists(db_path):
            break
        time.sleep(1)
    
    if os.path.exists(db_path):
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("CREATE TABLE IF NOT EXISTS ApiKeys (Id INTEGER PRIMARY KEY AUTOINCREMENT, AccessToken TEXT, Name TEXT, DateCreated TEXT, DateLastActivity TEXT)")
        c.execute("SELECT * FROM ApiKeys WHERE AccessToken = ?", (JELLYFIN_API_KEY,))
        if not c.fetchone():
            c.execute("INSERT INTO ApiKeys (AccessToken, Name, DateCreated, DateLastActivity) VALUES (?, 'AutoConfig', datetime('now'), datetime('now'))", (JELLYFIN_API_KEY,))
            conn.commit()
            print("Jellyfin API key injected!")
        conn.close()

def seed_jellyseerr():
    print("Seeding Jellyseerr...")
    settings_path = "/config/jellyseerr/settings.json"
    os.makedirs(os.path.dirname(settings_path), exist_ok=True)
    if not os.path.exists(settings_path):
        settings = {
            "clientId": "auto-config-client-id",
            "main": {
                "apiKey": "auto-config-api-key",
                "mediaServerType": 2
            },
            "jellyfin": {
                "name": "Jellyfin",
                "ip": "jellyfin",
                "port": 8096,
                "useSsl": False,
                "apiKey": JELLYFIN_API_KEY
            },
            "radarr": [{
                "name": "Radarr",
                "hostname": "radarr",
                "port": 7878,
                "apiKey": RADARR_API_KEY,
                "useSsl": False,
                "activeProfileId": 1,
                "activeDirectory": "/data/media/movies",
                "isDefault": True,
                "is4k": False
            }],
            "sonarr": [{
                "name": "Sonarr",
                "hostname": "sonarr",
                "port": 8989,
                "apiKey": SONARR_API_KEY,
                "useSsl": False,
                "activeProfileId": 1,
                "activeDirectory": "/data/media/tv",
                "isDefault": True,
                "is4k": False
            }]
        }
        with open(settings_path, 'w') as f:
            json.dump(settings, f, indent=2)
        print("Jellyseerr settings.json created!")

def config_servarr(name, url, api_key, max_size, profile_name="Original Language"):
    print(f"Configuring {name}...")
    headers = {"X-Api-Key": api_key, "Content-Type": "application/json"}
    
    # 1. Add qBittorrent
    clients = requests.get(f"{url}/api/v3/downloadclient", headers=headers).json()
    qb_client = next((c for c in clients if c["name"] == "qBittorrent"), None)
    if not qb_client:
        schema = requests.get(f"{url}/api/v3/downloadclient/schema", headers=headers).json()
        qb_client = next(s for s in schema if s["implementation"] == "QBittorrent")
        qb_client["name"] = "qBittorrent"
        
    for f in qb_client["fields"]:
        if f["name"] == "host": f["value"] = "qbittorrent"
        if f["name"] == "apiKey": f["value"] = QBITTORRENT_API_KEY
        if f["name"] == "movieCategory": f["value"] = "movies"
        if f["name"] == "tvCategory": f["value"] = "tv"
        
    if "id" in qb_client:
        requests.put(f"{url}/api/v3/downloadclient/{qb_client['id']}", headers=headers, json=qb_client)
        print(f"Updated qBittorrent in {name}")
    else:
        requests.post(f"{url}/api/v3/downloadclient", headers=headers, json=qb_client)
        print(f"Added qBittorrent to {name}")

    # 2. Max Size
    qualities = requests.get(f"{url}/api/v3/qualitydefinition", headers=headers).json()
    for q in qualities:
        q["maxSize"] = max_size
    requests.put(f"{url}/api/v3/qualitydefinition/update", headers=headers, json=qualities)
    print(f"Set max size limits in {name}")
    
    # 3. Jellyfin Notification
    notifs = requests.get(f"{url}/api/v3/notification", headers=headers).json()
    if not any(n["implementation"] == "MediaBrowser" for n in notifs):
        schema = requests.get(f"{url}/api/v3/notification/schema", headers=headers).json()
        mb = next(s for s in schema if s["implementation"] == "MediaBrowser")
        mb["name"] = "Jellyfin"
        mb["onDownload"] = True
        mb["onUpgrade"] = True
        for f in mb["fields"]:
            if f["name"] == "host": f["value"] = "jellyfin"
            if f["name"] == "port": f["value"] = 8096
            if f["name"] == "apiKey": f["value"] = JELLYFIN_API_KEY
            if f["name"] == "updateLibrary": f["value"] = True
        requests.post(f"{url}/api/v3/notification", headers=headers, json=mb)
        print(f"Added Jellyfin Notification to {name}")
        
    # Jellyseerr Webhook Notification
    if not any(n["name"] == "Jellyseerr" for n in notifs):
        schema = requests.get(f"{url}/api/v3/notification/schema", headers=headers).json()
        wh = next(s for s in schema if s["implementation"] == "Webhook")
        wh["name"] = "Jellyseerr"
        wh["onDownload"] = True
        wh["onUpgrade"] = True
        app_name = name.lower()
        webhook_url = f"http://jellyseerr:5055/api/v1/webhook/{app_name}"
        
        for f in wh["fields"]:
            if f["name"] == "url": f["value"] = webhook_url
            if f["name"] == "method": f["value"] = 1 # POST
        requests.post(f"{url}/api/v3/notification", headers=headers, json=wh)
        print(f"Added Jellyseerr Webhook to {name}")
        
    # 5. Language Profile
    if name == "Sonarr":
        profiles = requests.get(f"{url}/api/v3/languageprofile", headers=headers).json()
        p = profiles[0]
        p["name"] = profile_name
        p["languages"] = [{"language": {"id": -2, "name": "Original"}, "allowed": True}]
        requests.put(f"{url}/api/v3/languageprofile/{p['id']}", headers=headers, json=p)
        print(f"Updated Language Profile in {name}")

def config_prowlarr_proxy():
    print("Configuring FlareSolverr proxy in Prowlarr...")
    headers = {"X-Api-Key": PROWLARR_API_KEY, "Content-Type": "application/json"}
    
    # Get or Create Tag 'flaresolverr'
    tags = requests.get("http://prowlarr:9696/api/v1/tag", headers=headers).json()
    tag = next((t for t in tags if t["label"] == "flaresolverr"), None)
    if not tag:
        tag = requests.post("http://prowlarr:9696/api/v1/tag", headers=headers, json={"label": "flaresolverr"}).json()
    tag_id = tag["id"]

    proxies = requests.get("http://prowlarr:9696/api/v1/indexerproxy", headers=headers).json()
    if not any(p["name"] == "FlareSolverr" for p in proxies):
        schema = requests.get("http://prowlarr:9696/api/v1/indexerproxy/schema", headers=headers).json()
        flare_schema = next(s for s in schema if s["implementation"] == "FlareSolverr")
        flare_schema["name"] = "FlareSolverr"
        flare_schema["tags"] = [tag_id]
        for f in flare_schema["fields"]:
            if f["name"] == "host":
                f["value"] = "http://flaresolverr:8191"
        try:
            res = requests.post("http://prowlarr:9696/api/v1/indexerproxy", headers=headers, json=flare_schema)
            res.raise_for_status()
            print("Added FlareSolverr proxy to Prowlarr")
        except Exception as e:
            print(f"Failed to add FlareSolverr proxy: {e}")
    else:
        flare_proxy = next(p for p in proxies if p["name"] == "FlareSolverr")
        if tag_id not in flare_proxy["tags"]:
            flare_proxy["tags"].append(tag_id)
            requests.put(f"http://prowlarr:9696/api/v1/indexerproxy/{flare_proxy['id']}", headers=headers, json=flare_proxy)
            
    return tag_id

def config_prowlarr(tag_id):
    print("Configuring Prowlarr...")
    headers = {"X-Api-Key": PROWLARR_API_KEY, "Content-Type": "application/json"}
    
    # 1. Add Apps
    apps = requests.get("http://prowlarr:9696/api/v1/applications", headers=headers).json()
    if not any(a["name"] == "Radarr" for a in apps):
        schema = requests.get("http://prowlarr:9696/api/v1/applications/schema", headers=headers).json()
        rad = next(s for s in schema if s["implementation"] == "Radarr")
        rad["name"] = "Radarr"
        rad["syncLevel"] = "fullSync"
        for f in rad["fields"]:
            if f["name"] == "prowlarrUrl": f["value"] = "http://prowlarr:9696"
            if f["name"] == "baseUrl": f["value"] = "http://radarr:7878"
            if f["name"] == "apiKey": f["value"] = RADARR_API_KEY
        requests.post("http://prowlarr:9696/api/v1/applications", headers=headers, json=rad)
        
    if not any(a["name"] == "Sonarr" for a in apps):
        schema = requests.get("http://prowlarr:9696/api/v1/applications/schema", headers=headers).json()
        son = next(s for s in schema if s["implementation"] == "Sonarr")
        son["name"] = "Sonarr"
        son["syncLevel"] = "fullSync"
        for f in son["fields"]:
            if f["name"] == "prowlarrUrl": f["value"] = "http://prowlarr:9696"
            if f["name"] == "baseUrl": f["value"] = "http://sonarr:8989"
            if f["name"] == "apiKey": f["value"] = SONARR_API_KEY
        requests.post("http://prowlarr:9696/api/v1/applications", headers=headers, json=son)
        print("Added Radarr and Sonarr to Prowlarr")
        
    # 2. Add Indexers (ignoring test failures just in case)
    indexers = requests.get("http://prowlarr:9696/api/v1/indexer", headers=headers).json()
    known_indexers = [
        ("1337x", "Cardigann", "1337x"),
        ("YTS", "Yts", "YTS"),
        ("EZTV", "Eztv", "EZTV"),
        ("LimeTorrents", "Cardigann", "LimeTorrents"),
        ("TorrentDownload", "Cardigann", "TorrentDownload")
    ]
    schema = requests.get("http://prowlarr:9696/api/v1/indexer/schema", headers=headers).json()
    for name, impl, def_name in known_indexers:
        if not any(i["name"] == name for i in indexers):
            try:
                ind = next(s for s in schema if s["name"] == def_name)
                ind["name"] = name
                ind["appProfileId"] = 1
                ind["enable"] = True
                if name in ["1337x", "EZTV"]:
                    ind["tags"] = [tag_id]
                # Just post, don't test
                res = requests.post("http://prowlarr:9696/api/v1/indexer", headers=headers, json=ind)
                res.raise_for_status()
            except StopIteration:
                print(f"Failed to add indexer {name}: Not found in schema")
            except Exception as e:
                print(f"Failed to add indexer {name}: {e}")
    print("Added Indexers to Prowlarr")

def config_qbittorrent():
    print("Configuring qBittorrent...")
    session = requests.Session()
    session.headers.update({"X-Api-Key": QBITTORRENT_API_KEY})
    # qBittorrent can accept a setPreferences call without it actually taking effect
    # (Downloads\SavePath gets written to disk but the live Session\DefaultSavePath does
    # not), which has been observed right after the container's first boot. Verify the
    # change stuck instead of trusting a 200 response.
    for attempt in range(5):
        session.post("http://qbittorrent:8080/api/v2/app/setPreferences", data={"json": json.dumps({"save_path": "/data/torrents/"})})
        prefs = session.get("http://qbittorrent:8080/api/v2/app/preferences").json()
        if prefs.get("save_path", "").rstrip("/") == "/data/torrents":
            print("Set qBittorrent default download path to /data/torrents/")
            break
        print(f"qBittorrent default save path not applied yet, retrying... (attempt {attempt + 1})")
        time.sleep(3)
    else:
        print("WARNING: Failed to set qBittorrent default download path after retries")

    # Radarr/Sonarr tag downloads with the "movies"/"tv" categories (see movieCategory/
    # tvCategory above). If those categories exist without their own save path, qBittorrent
    # silently falls back to the global default above instead of /data/torrents/<category>,
    # which breaks Radarr/Sonarr's import since they look for the file under the category path.
    for category, save_path in [("movies", "/data/torrents/movies"), ("tv", "/data/torrents/tv")]:
        for attempt in range(5):
            categories = session.get("http://qbittorrent:8080/api/v2/torrents/categories").json()
            if categories.get(category, {}).get("savePath", "").rstrip("/") == save_path:
                print(f"qBittorrent '{category}' category save path is {save_path}")
                break
            endpoint = "editCategory" if category in categories else "createCategory"
            session.post(f"http://qbittorrent:8080/api/v2/torrents/{endpoint}", data={"category": category, "savePath": save_path})
            time.sleep(2)
        else:
            print(f"WARNING: Failed to set qBittorrent '{category}' category save path after retries")

if __name__ == "__main__":
    seed_jellyfin()
    seed_jellyseerr()
    wait_for_services()
    config_servarr("Radarr", "http://radarr:7878", RADARR_API_KEY, 8000)
    config_servarr("Sonarr", "http://sonarr:8989", SONARR_API_KEY, 2000)
    tag_id = config_prowlarr_proxy()
    config_prowlarr(tag_id)
    config_qbittorrent()
    print("Auto-configuration complete!")
