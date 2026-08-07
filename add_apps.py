import urllib.request
import json
import time

API_KEY = "12e87f4df25540ccb87a79cb07fb5f57"
BASE_URL = "http://localhost:7300/api/v1"

req = urllib.request.Request(f"{BASE_URL}/applications/schema", headers={"X-Api-Key": API_KEY})
response = urllib.request.urlopen(req)
schemas = json.loads(response.read().decode('utf-8'))

radarr_schema = next((s for s in schemas if s["implementation"] == "Radarr"), None)
sonarr_schema = next((s for s in schemas if s["implementation"] == "Sonarr"), None)

def set_field(schema, name, value):
    for f in schema["fields"]:
        if f["name"] == name:
            f["value"] = value

# Configure Radarr
if radarr_schema:
    radarr_schema["name"] = "Radarr"
    radarr_schema["appProfileId"] = 1
    radarr_schema["syncLevel"] = "fullSync"
    set_field(radarr_schema, "prowlarrUrl", "http://prowlarr:9696")
    set_field(radarr_schema, "baseUrl", "http://radarr:7878")
    set_field(radarr_schema, "apiKey", "f440c4e6837c49318c7e9957f30caa6a")
    
    req = urllib.request.Request(f"{BASE_URL}/applications", data=json.dumps(radarr_schema).encode('utf-8'), headers={"X-Api-Key": API_KEY, "Content-Type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req)
        print("Successfully added Radarr to Prowlarr")
    except Exception as e:
        print(f"Failed to add Radarr: {e}")

# Configure Sonarr
if sonarr_schema:
    sonarr_schema["name"] = "Sonarr"
    sonarr_schema["appProfileId"] = 1
    sonarr_schema["syncLevel"] = "fullSync"
    set_field(sonarr_schema, "prowlarrUrl", "http://prowlarr:9696")
    set_field(sonarr_schema, "baseUrl", "http://sonarr:8989")
    set_field(sonarr_schema, "apiKey", "fa82be671bf54faa994c0631edc25b70")
    
    req = urllib.request.Request(f"{BASE_URL}/applications", data=json.dumps(sonarr_schema).encode('utf-8'), headers={"X-Api-Key": API_KEY, "Content-Type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req)
        print("Successfully added Sonarr to Prowlarr")
    except Exception as e:
        print(f"Failed to add Sonarr: {e}")

