import os, requests, json
SONARR_API_KEY = os.getenv("SONARR_API_KEY")
headers = {"X-Api-Key": SONARR_API_KEY, "Content-Type": "application/json"}
qualities = requests.get("http://localhost:7700/api/v3/qualitydefinition", headers=headers).json()
for q in qualities:
    q["maxSize"] = 45
    if q.get("preferredSize") is not None and q["preferredSize"] > 45:
        q["preferredSize"] = 45
res = requests.put("http://localhost:7700/api/v3/qualitydefinition/update", headers=headers, json=qualities)
print(res.status_code)
print(res.text)
