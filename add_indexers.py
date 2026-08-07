import urllib.request
import json
import time

API_KEY = "12e87f4df25540ccb87a79cb07fb5f57"
BASE_URL = "http://localhost:7300/api/v1"

req = urllib.request.Request(f"{BASE_URL}/indexer/schema", headers={"X-Api-Key": API_KEY})
response = urllib.request.urlopen(req)
schemas = json.loads(response.read().decode('utf-8'))

public_indexers = [s for s in schemas if s.get("privacy") == "public" and s.get("protocol") == "torrent"]

print(f"Found {len(public_indexers)} public torrent indexers.")

added = 0
for indexer in public_indexers:
    indexer["enable"] = True
    indexer["appProfileId"] = 1
    
    # Fill in default values for fields if they are required but have no value
    # But usually public indexers have defaults set in the schema.
    
    req = urllib.request.Request(f"{BASE_URL}/indexer", data=json.dumps(indexer).encode('utf-8'), headers={"X-Api-Key": API_KEY, "Content-Type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req)
        added += 1
        print(f"Added {indexer['definitionName']}")
        time.sleep(0.5)
    except Exception as e:
        print(f"Failed to add {indexer['definitionName']}")

print(f"Successfully added {added} indexers.")
