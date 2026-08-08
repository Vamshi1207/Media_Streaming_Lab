import requests
import json
import re
import urllib.request

token = "<YOUR_TOKEN>"

def get_ghcr_tags(owner, package):
    url = f"https://api.github.com/users/{owner}/packages/container/{package}/versions?per_page=100"
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github.v3+json")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as response:
            versions = json.loads(response.read().decode())
            tags = []
            for v in versions:
                tags.extend(v['metadata']['container']['tags'])
            return tags
    except Exception as e:
        print(f"Error {package}: {e}")
        return []

def get_dockerhub_tags(repo):
    url = f"https://hub.docker.com/v2/repositories/{repo}/tags?page_size=100"
    try:
        with urllib.request.urlopen(url) as response:
            res = json.loads(response.read().decode())
            return [t['name'] for t in res['results']]
    except Exception as e:
        print(f"Error {repo}: {e}")
        return []

images = [
    ("ghcr", "linuxserver", "radarr"),
    ("ghcr", "linuxserver", "jellyfin"),
    ("ghcr", "linuxserver", "prowlarr"),
    ("ghcr", "linuxserver", "bazarr"),
    ("ghcr", "linuxserver", "sonarr"),
    ("dockerhub", "fallenbagel/jellyseerr"),
    ("dockerhub", "binhex/arch-qbittorrent")
]

for img in images:
    if img[0] == "ghcr":
        tags = get_ghcr_tags(img[1], img[2])
    else:
        tags = get_dockerhub_tags(img[1])
    
    valid_tags = []
    for t in tags:
        # Require stable numerical tag without nightly, alpha, beta, rc
        if re.match(r'^v?\d+\.\d+\.\d+$', t) or re.match(r'^v?\d+\.\d+\.\d+-\d+$', t) or re.match(r'^v?\d+\.\d+\.\d+-\d+-libtorrentv\d+$', t):
            # For linuxserver, the format is often version-lsYY like 3.2.1-ls123 or just 3.2.1
            pass
        
        # General filter: No alphabet after numbers, except for typical linuxserver suffix or libtorrent
        if re.match(r'^v?\d+(\.\d+){1,3}(-ls\d+)?$', t) or re.match(r'^\d+\.\d+\.\d+-\d+-01-libtorrentv1$', t) or re.match(r'^\d+\.\d+\.\d+$', t):
             valid_tags.append(t)
    
    valid_tags.sort(key=lambda s: [int(x) for x in re.findall(r'\d+', s)], reverse=True)
    print(f"{img[1]}/{img[2] if len(img) > 2 else ''}: {valid_tags[0] if valid_tags else 'latest'}")
