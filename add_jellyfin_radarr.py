import urllib.request
import json

API_KEY = "f440c4e6837c49318c7e9957f30caa6a"
BASE_URL = "http://localhost:7400/api/v3"

req = urllib.request.Request(f"{BASE_URL}/notification/schema", headers={"X-Api-Key": API_KEY})
response = urllib.request.urlopen(req)
schemas = json.loads(response.read().decode('utf-8'))

schema = next((s for s in schemas if s["implementation"] == "MediaBrowser"), None)
if schema:
    schema["name"] = "Jellyfin"
    schema["onDownload"] = True
    schema["onUpgrade"] = True
    for f in schema["fields"]:
        if f["name"] == "host": f["value"] = "jellyfin"
        if f["name"] == "port": f["value"] = 8096
        if f["name"] == "apiKey": f["value"] = "fd9821ab1250429db05f9b1df99fc0eb"
        if f["name"] == "updateLibrary": f["value"] = True

    req = urllib.request.Request(f"{BASE_URL}/notification", data=json.dumps(schema).encode('utf-8'), headers={"X-Api-Key": API_KEY, "Content-Type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req)
        print("Successfully added Jellyfin to Radarr")
    except Exception as e:
        print(f"Failed: {e}")
