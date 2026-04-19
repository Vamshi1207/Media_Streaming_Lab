const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
const upload = multer({ dest: "/tmp/uploads/" });

const MEDIA_PATHS = [
  "/data/media/movies",
  "/data/movies",
];
const FRONTEND_PATH = path.join(__dirname, "..", "frontend");
const JELLYFIN_URL = process.env.JELLYFIN_URL || "http://jellyfin:8096";
const RADARR_URL = process.env.RADARR_URL || "http://radarr:7878";
const RADARR_CONFIG_PATH = process.env.RADARR_CONFIG_PATH || "/config/radarr/config.xml";
const SONARR_URL = process.env.SONARR_URL || "http://sonarr:8989";
const SONARR_CONFIG_PATH = process.env.SONARR_CONFIG_PATH || "/config/sonarr/config.xml";
const PROWLARR_URL = process.env.PROWLARR_URL || "http://prowlarr:9696";
const PROWLARR_CONFIG_PATH = process.env.PROWLARR_CONFIG_PATH || "/config/prowlarr/config.xml";
const QBITTORRENT_URL = process.env.QBITTORRENT_URL || "http://qbittorrent:8080";
const QBITTORRENT_USERNAME = process.env.QBITTORRENT_USERNAME || "admin";
const QBITTORRENT_PASSWORD = process.env.QBITTORRENT_PASSWORD || "";
const DOWNLOADS_PATH = process.env.DOWNLOADS_PATH || "/data/torrents";

function getMediaPath() {
  return MEDIA_PATHS.find(fs.existsSync) || MEDIA_PATHS[0];
}

function getApiKeyFromXml(configPath) {
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const configXml = fs.readFileSync(configPath, "utf8");
  const match = configXml.match(/<ApiKey>([^<]+)<\/ApiKey>/);

  return match ? match[1] : null;
}

function getRadarrApiKey() {
  return getApiKeyFromXml(RADARR_CONFIG_PATH);
}

function getSonarrApiKey() {
  return getApiKeyFromXml(SONARR_CONFIG_PATH);
}

function getProwlarrApiKey() {
  return getApiKeyFromXml(PROWLARR_CONFIG_PATH);
}

async function loginToQbittorrent() {
  const response = await fetch(`${QBITTORRENT_URL}/api/v2/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      username: QBITTORRENT_USERNAME,
      password: QBITTORRENT_PASSWORD,
    }),
  });

  const text = await response.text();

  if (!response.ok || text.trim() !== "Ok.") {
    throw new Error("Failed to authenticate with qBittorrent.");
  }

  const cookie = response.headers.get("set-cookie");

  if (!cookie) {
    throw new Error("qBittorrent did not return a session cookie.");
  }

  return cookie.split(";")[0];
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Accept": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Request failed with status ${response.status}`);
  }

  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Request failed with status ${response.status}`);
  }

  return response.text();
}

async function fetchQbittorrent(endpoint) {
  const cookie = await loginToQbittorrent();

  return fetchJson(`${QBITTORRENT_URL}${endpoint}`, {
    headers: {
      "Cookie": cookie,
    },
  });
}

async function fetchRadarr(endpoint, options = {}) {
  const apiKey = getRadarrApiKey();

  if (!apiKey) {
    throw new Error("Radarr API key is unavailable.");
  }

  return fetchJson(`${RADARR_URL}${endpoint}`, {
    ...options,
    headers: {
      "X-Api-Key": apiKey,
      ...(options.headers || {}),
    },
  });
}

async function fetchSonarr(endpoint, options = {}) {
  const apiKey = getSonarrApiKey();

  if (!apiKey) {
    throw new Error("Sonarr API key is unavailable.");
  }

  return fetchJson(`${SONARR_URL}${endpoint}`, {
    ...options,
    headers: {
      "X-Api-Key": apiKey,
      ...(options.headers || {}),
    },
  });
}

async function fetchProwlarr(endpoint) {
  const apiKey = getProwlarrApiKey();

  if (!apiKey) {
    throw new Error("Prowlarr API key is unavailable.");
  }

  return fetchJson(`${PROWLARR_URL}${endpoint}`, {
    headers: {
      "X-Api-Key": apiKey,
    },
  });
}

function summarizeServiceError(error) {
  return error instanceof Error ? error.message : String(error);
}

function guessContentType(fileName) {
  const ext = path.extname(fileName).toLowerCase();

  if (ext === ".mkv") {
    return "video/x-matroska";
  }

  if (ext === ".mp4") {
    return "video/mp4";
  }

  return "application/octet-stream";
}

function getFilesystemMovies() {
  const movies = [];
  const mediaPath = getMediaPath();

  if (!fs.existsSync(mediaPath)) {
    return movies;
  }

  fs.readdirSync(mediaPath).forEach(folder => {
    const folderPath = path.join(mediaPath, folder);

    if (!fs.statSync(folderPath).isDirectory()) {
      return;
    }

    const files = fs.readdirSync(folderPath);
    const video = files.find(file => file.endsWith(".mp4") || file.endsWith(".mkv"));

    movies.push({
      title: folder,
      source: "filesystem",
      hasFile: Boolean(video),
      videoUrl: video ? `/stream/${folder}/${video}` : null,
      path: folderPath,
    });
  });

  return movies;
}

async function getServiceStatuses() {
  const checks = [
    {
      id: "jellyfin",
      name: "Jellyfin",
      url: JELLYFIN_URL,
      check: async () => {
        const status = await fetchJson(`${JELLYFIN_URL}/System/Info/Public`);

        return {
          version: status.Version,
          serverName: status.ServerName,
          startupWizardCompleted: status.StartupWizardCompleted,
        };
      },
    },
    {
      id: "radarr",
      name: "Radarr",
      url: RADARR_URL,
      check: async () => {
        const status = await fetchRadarr("/api/v3/system/status");

        return {
          version: status.version,
          branch: status.branch,
          instanceName: status.instanceName,
        };
      },
    },
    {
      id: "sonarr",
      name: "Sonarr",
      url: SONARR_URL,
      check: async () => {
        const status = await fetchSonarr("/api/v3/system/status");

        return {
          version: status.version,
          branch: status.branch,
          instanceName: status.instanceName,
        };
      },
    },
    {
      id: "prowlarr",
      name: "Prowlarr",
      url: PROWLARR_URL,
      check: async () => {
        const status = await fetchProwlarr("/api/v1/system/status");

        return {
          version: status.version,
          branch: status.branch,
          appName: status.appName,
        };
      },
    },
    {
      id: "qbittorrent",
      name: "qBittorrent",
      url: QBITTORRENT_URL,
      check: async () => {
        const cookie = await loginToQbittorrent();
        const [appVersion, webApiVersion] = await Promise.all([
          fetchText(`${QBITTORRENT_URL}/api/v2/app/version`, {
            headers: {
              "Cookie": cookie,
            },
          }),
          fetchText(`${QBITTORRENT_URL}/api/v2/app/webapiVersion`, {
            headers: {
              "Cookie": cookie,
            },
          }),
        ]);

        return {
          version: appVersion.trim(),
          webApiVersion,
        };
      },
    },
  ];

  const statuses = await Promise.all(checks.map(async service => {
    try {
      const details = await service.check();

      return {
        id: service.id,
        name: service.name,
        url: service.url,
        status: "online",
        details,
      };
    } catch (error) {
      return {
        id: service.id,
        name: service.name,
        url: service.url,
        status: "offline",
        error: summarizeServiceError(error),
      };
    }
  }));

  return statuses;
}

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  next();
});

app.use(express.json());
app.use(express.static(FRONTEND_PATH));

app.get("/api/system", async (_req, res) => {
  const services = await getServiceStatuses();

  return res.json({
    mode: "servarr-stack",
    mediaPath: getMediaPath(),
    downloadsPath: DOWNLOADS_PATH,
    services,
  });
});

app.get("/api/services", async (_req, res) => {
  const services = await getServiceStatuses();
  const hasFailures = services.some(service => service.status !== "online");

  return res.status(hasFailures ? 207 : 200).json(services);
});

app.get("/api/downloads", async (_req, res) => {
  try {
    const torrents = await fetchQbittorrent("/api/v2/torrents/info");

    const payload = torrents.map(torrent => ({
      hash: torrent.hash,
      name: torrent.name,
      state: torrent.state,
      progress: torrent.progress,
      size: torrent.size,
      downloaded: torrent.downloaded,
      dlspeed: torrent.dlspeed,
      eta: torrent.eta,
      savePath: torrent.save_path,
      category: torrent.category,
      seeds: torrent.num_seeds,
      peers: torrent.num_leechs,
    }));

    return res.json(payload);
  } catch (error) {
    return res.status(502).json({
      error: "Unable to fetch qBittorrent downloads.",
      details: error.message,
    });
  }
});

app.delete("/api/downloads/:hash", async (req, res) => {
  const hash = req.params.hash;
  if (!hash) return res.status(400).json({ error: "No hash provided" });

  try {
    const cookie = await loginToQbittorrent();
    const response = await fetch(`${QBITTORRENT_URL}/api/v2/torrents/delete`, {
      method: "POST",
      headers: {
        "Cookie": cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        hashes: hash,
        deleteFiles: "true",
      }),
    });

    if (!response.ok) {
      throw new Error(`Delete failed: ${response.status}`);
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(502).json({ error: summarizeServiceError(error) });
  }
});

app.get("/api/library/movies", async (_req, res) => {
  try {
    const movies = await fetchRadarr("/api/v3/movie");
    const payload = movies.map(movie => ({
      id: movie.id,
      title: movie.title,
      year: movie.year,
      monitored: movie.monitored,
      hasFile: movie.hasFile,
      minimumAvailability: movie.minimumAvailability,
      qualityProfileId: movie.qualityProfileId,
      path: movie.path,
      size: movie.movieFile?.size || null,
      added: movie.added,
      source: "radarr",
    }));

    return res.json(payload);
  } catch (_error) {
    return res.json(getFilesystemMovies());
  }
});

app.get("/movies", (_req, res) => {
  return res.json(getFilesystemMovies());
});

app.get("/api/radarr/health", async (_req, res) => {
  try {
    const [status, rootFolders, downloadClientNames] = await Promise.all([
      fetchRadarr("/api/v3/system/status"),
      fetchRadarr("/api/v3/rootfolder"),
      fetchRadarr("/api/v3/downloadclient"),
    ]);

    return res.json({
      status: "online",
      version: status.version,
      branch: status.branch,
      rootFolders: rootFolders.map(folder => folder.path),
      downloadClients: downloadClientNames.map(client => ({
        name: client.name,
        enable: client.enable,
        implementation: client.implementation,
      })),
    });
  } catch (error) {
    return res.status(502).json({
      status: "offline",
      error: summarizeServiceError(error),
    });
  }
});

// 🔍 Search endpoint
app.get("/api/search", async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.json([]);
  }

  try {
    const [moviesResult, tvResult] = await Promise.allSettled([
      fetchRadarr(`/api/v3/movie/lookup?term=${encodeURIComponent(query)}`),
      fetchSonarr(`/api/v3/series/lookup?term=${encodeURIComponent(query)}`),
    ]);

    const movies = moviesResult.status === "fulfilled" ? moviesResult.value.map(item => ({ ...item, isTv: false })) : [];
    const tv = tvResult.status === "fulfilled" ? tvResult.value.map(item => ({ ...item, isTv: true })) : [];

    // Prioritize exact or prefix matches briefly (Radarr/Sonarr already order results, so we interleave them)
    // Here we just merge and return top combined
    const combined = [...movies, ...tv];

    return res.json(combined);
  } catch (error) {
    return res.status(502).json({ error: summarizeServiceError(error) });
  }
});

// ⬇️ Download endpoint
app.post("/api/download", async (req, res) => {
  const { isTv, tmdbId, tvdbId, title, year, images } = req.body;

  try {
    if (isTv) {
      const [rootFolders, profiles] = await Promise.all([
        fetchSonarr("/api/v3/rootfolder"),
        fetchSonarr("/api/v3/qualityprofile"),
      ]);

      const rootFolderPath = rootFolders[0]?.path;
      const qualityProfileId = profiles[0]?.id;

      if (!rootFolderPath || !qualityProfileId) {
        throw new Error("Sonarr missing root folder or quality profile");
      }

      await fetchSonarr("/api/v3/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          tvdbId,
          year,
          images,
          qualityProfileId,
          rootFolderPath,
          monitored: true,
          addOptions: { searchForMissingEpisodes: true },
        }),
      });
    } else {
      const [rootFolders, profiles] = await Promise.all([
        fetchRadarr("/api/v3/rootfolder"),
        fetchRadarr("/api/v3/qualityprofile"),
      ]);

      const rootFolderPath = rootFolders[0]?.path;
      const qualityProfileId = profiles[0]?.id;

      if (!rootFolderPath || !qualityProfileId) {
        throw new Error("Radarr missing root folder or quality profile");
      }

      await fetchRadarr("/api/v3/movie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          tmdbId,
          year,
          images,
          qualityProfileId,
          rootFolderPath,
          monitored: true,
          addOptions: { searchForMovie: true },
        }),
      });
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(502).json({ error: summarizeServiceError(error) });
  }
});

// 📤 Torrent Upload endpoint
app.post("/api/upload-torrent", upload.single("torrent"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No torrent file provided." });
  }

  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const formData = new FormData();
    formData.append("torrents", new Blob([fileBuffer]), req.file.originalname);
    formData.append("savepath", DOWNLOADS_PATH);

    const cookie = await loginToQbittorrent();

    const response = await fetch(`${QBITTORRENT_URL}/api/v2/torrents/add`, {
      method: "POST",
      headers: {
        "Cookie": cookie,
        // Let fetch automatically generate the boundary for multipart/form-data
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Submit failed: ${errorText || response.status}`);
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(502).json({ error: summarizeServiceError(error) });
  } finally {
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path); // clean up tmp
    }
  }
});

// 🎥 Stream video
app.get("/stream/:folder/:file", (req, res) => {
  const mediaPath = getMediaPath();
  const folder = decodeURIComponent(req.params.folder);
  const file = decodeURIComponent(req.params.file);

  const filePath = path.join(mediaPath, folder, file);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": guessContentType(file),
    });

    stream.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": guessContentType(file),
    });

    fs.createReadStream(filePath).pipe(res);
  }
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(FRONTEND_PATH, "index.html"));
});

app.listen(3000, () => console.log("🚀 Server running on port 3000"));
