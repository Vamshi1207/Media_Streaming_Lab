import requests, os
PROWLARR_API_KEY = os.getenv("PROWLARR_API_KEY")
headers = {"X-Api-Key": PROWLARR_API_KEY}
indexers = requests.get("http://localhost:7300/api/v1/indexer", headers=headers).json()
print([i["name"] for i in indexers])
