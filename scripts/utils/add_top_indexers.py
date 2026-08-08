import urllib.request
import json

API_KEY = "12e87f4df25540ccb87a79cb07fb5f57"
BASE_URL = "http://localhost:7300/api/v1"

TOP_INDEXERS = ["1337x", "TorrentGalaxy", "YTS", "EZTV", "LimeTorrents", "The Pirate Bay", "Nyaa", "Ettv", "Glotorrents", "Torlock", "KickAssTorrents", "Demonoid"]

req = urllib.request.Request(f"{BASE_URL}/indexer/schema", headers={"X-Api-Key": API_KEY})
response = urllib.request.urlopen(req)
schemas = json.loads(response.read().decode('utf-8'))

public_indexers = [s for s in schemas if s.get("privacy") == "public" and s.get("protocol") == "torrent"]

to_add = [s for s in public_indexers if any(name.lower() in s.get("definitionName", "").lower() for name in TOP_INDEXERS)]

added = 0
for indexer in to_add:
    indexer["enable"] = True
    indexer["appProfileId"] = 1
    
    req = urllib.request.Request(f"{BASE_URL}/indexer", data=json.dumps(indexer).encode('utf-8'), headers={"X-Api-Key": API_KEY, "Content-Type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req)
        added += 1
        print(f"Added {indexer['definitionName']}")
    except Exception as e:
        print(f"Failed to add {indexer['definitionName']}")

print(f"Successfully added {added} indexers.")
