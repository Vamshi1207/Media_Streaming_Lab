import requests, os
PROWLARR_API_KEY = os.getenv("PROWLARR_API_KEY")
headers = {"X-Api-Key": PROWLARR_API_KEY}
schema = requests.get("http://localhost:7300/api/v1/indexer/schema", headers=headers).json()
ind = next(s for s in schema if s["name"] == "YTS")
ind["name"] = "YTS2"
res = requests.post("http://localhost:7300/api/v1/indexer", headers=headers, json=ind)
print(res.status_code)
print(res.text)
