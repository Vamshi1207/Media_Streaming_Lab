import os, requests, json
RADARR_API_KEY = os.getenv("RADARR_API_KEY")
headers = {"X-Api-Key": RADARR_API_KEY, "Content-Type": "application/json"}
qualities = requests.get("http://localhost:7400/api/v3/qualitydefinition", headers=headers).json()
for q in qualities:
    q["maxSize"] = 80
    if q.get("preferredSize") is not None and q["preferredSize"] > 80:
        q["preferredSize"] = 80
res = requests.put("http://localhost:7400/api/v3/qualitydefinition/update", headers=headers, json=qualities)
print(res.status_code)
print(res.text)
