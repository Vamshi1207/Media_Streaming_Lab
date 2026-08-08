const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const http = require("http");
const crypto = require("crypto");

const app = express();
const upload = multer({ dest: "/tmp/uploads/" });

const MEDIA_PATHS = [
  "/data/media/movies",
  "/data/movies",
];
const FRONTEND_PATH = path.join(__dirname, "..", "frontend");
const JELLYFIN_URL = process.env.JELLYFIN_URL || "http://jellyfin:8096";
const JELLYSEERR_URL = process.env.JELLYSEERR_URL || "http://jellyseerr:5055";
const JELLYSEERR_CONFIG_PATH = process.env.JELLYSEERR_CONFIG_PATH || "/config/jellyseerr/settings.json";
const RADARR_URL = process.env.RADARR_URL || "http://radarr:7878";
const RADARR_CONFIG_PATH = process.env.RADARR_CONFIG_PATH || "/config/radarr/config.xml";
const SONARR_URL = process.env.SONARR_URL || "http://sonarr:8989";
const SONARR_CONFIG_PATH = process.env.SONARR_CONFIG_PATH || "/config/sonarr/config.xml";
const PROWLARR_URL = process.env.PROWLARR_URL || "http://prowlarr:9696";
const PROWLARR_CONFIG_PATH = process.env.PROWLARR_CONFIG_PATH || "/config/prowlarr/config.xml";
const BAZARR_URL = process.env.BAZARR_URL || "http://bazarr:6767";
const QBITTORRENT_URL = process.env.QBITTORRENT_URL || "http://qbittorrent:8080";
const QBITTORRENT_USERNAME = process.env.QBITTORRENT_USERNAME || "admin";
const QBITTORRENT_PASSWORD = process.env.QBITTORRENT_PASSWORD || "";
const DOWNLOADS_PATH = process.env.DOWNLOADS_PATH || "/data/torrents";
const SERVICE_EXTERNAL_PORTS = {
  "media-server": 7100,
  jellyfin: 7500,
  jellyseerr: 7600,
  radarr: 7400,
  sonarr: 7700,
  prowlarr: 7300,
  bazarr: 7800,
  qbittorrent: 7200,
};
const SERVICE_EXTERNAL_URLS = {
  "media-server": process.env.MEDIA_SERVER_EXTERNAL_URL || "",
  jellyfin: process.env.JELLYFIN_EXTERNAL_URL || "",
  jellyseerr: process.env.JELLYSEERR_EXTERNAL_URL || "",
  radarr: process.env.RADARR_EXTERNAL_URL || "",
  sonarr: process.env.SONARR_EXTERNAL_URL || "",
  prowlarr: process.env.PROWLARR_EXTERNAL_URL || "",
  bazarr: process.env.BAZARR_EXTERNAL_URL || "",
  qbittorrent: process.env.QBITTORRENT_EXTERNAL_URL || "",
};
const ACTIVE_DOWNLOAD_STATES = new Set([
  "metaDL",
  "forcedMetaDL",
  "downloading",
  "forcedDL",
  "stalledDL",
  "queuedDL",
  "checkingDL",
  "pausedDL",
  "checkingResumeData",
  "moving",
]);
const SERVICE_RESOURCE_TARGETS = [
  { id: "media-server", name: "Dashboard" },
  { id: "jellyfin", name: "Jellyfin" },
  { id: "jellyseerr", name: "Jellyseerr" },
  { id: "radarr", name: "Radarr" },
  { id: "sonarr", name: "Sonarr" },
  { id: "prowlarr", name: "Prowlarr" },
  { id: "bazarr", name: "Bazarr" },
  { id: "qbittorrent", name: "qBittorrent" },
];

const SUBTITLE_EXTENSIONS = new Set([
  ".srt",
  ".ass",
  ".ssa",
  ".vtt",
  ".sub",
  ".idx",
  ".ttml",
  ".xml",
]);

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

function getJellyseerrApiKey() {
  if (!fs.existsSync(JELLYSEERR_CONFIG_PATH)) {
    return null;
  }

  const settings = JSON.parse(fs.readFileSync(JELLYSEERR_CONFIG_PATH, "utf8"));

  return settings.main?.apiKey || null;
}

async function loginToQbittorrent() {
  return "SID=bypassed";
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

  const text = await response.text();

  return text ? JSON.parse(text) : null;
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

async function qbPost(endpoint, params, cookie) {
  const response = await fetch(`${QBITTORRENT_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Cookie": cookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  return response.text();
}

async function setupQbittorrentCategories() {
  try {
    const cookie = await loginToQbittorrent();
    await qbPost("/api/v2/torrents/createCategory", { category: "radarr", savePath: "/data/torrents/movies" }, cookie);
    await qbPost("/api/v2/torrents/editCategory", { category: "radarr", savePath: "/data/torrents/movies" }, cookie);
    await qbPost("/api/v2/torrents/createCategory", { category: "sonarr", savePath: "/data/torrents/tv" }, cookie);
    await qbPost("/api/v2/torrents/editCategory", { category: "sonarr", savePath: "/data/torrents/tv" }, cookie);
    console.log("✅ qBittorrent categories configured: radarr->/data/torrents/movies, sonarr->/data/torrents/tv");
  } catch (err) {
    console.warn("⚠️ Could not configure qBittorrent categories (will retry on next restart):", err.message);
  }
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

async function fetchBazarr(endpoint, options = {}) {
  return fetchJson(`${BAZARR_URL}${endpoint}`, {
    ...options,
    headers: {
      "X-Api-Key": "dcf90a1c76161123030ac6669972dd5e",
      ...(options.headers || {}),
    },
  });
}

async function fetchJellyseerr(endpoint) {
  const apiKey = getJellyseerrApiKey();

  if (!apiKey) {
    throw new Error("Jellyseerr API key is unavailable.");
  }

  return fetchJson(`${JELLYSEERR_URL}${endpoint}`, {
    headers: {
      "X-Api-Key": apiKey,
    },
  });
}

async function getJellyseerrMediaDetails(media) {
  if (!media?.tmdbId || !media?.mediaType) {
    return {};
  }

  try {
    const endpoint = media.mediaType === "tv" ? `/api/v1/tv/${media.tmdbId}` : `/api/v1/movie/${media.tmdbId}`;
    const details = await fetchJellyseerr(endpoint);

    return {
      title: details.title || details.name || details.originalTitle || details.originalName,
      year: details.releaseDate || details.firstAirDate || details.release_date || details.first_air_date,
    };
  } catch (_error) {
    return {};
  }
}

function normalizeSearchText(value) {
  return String(value || "")
    .replace(/\.[A-Za-z0-9]{2,4}$/g, "")
    .replace(/[._]+/g, " ")
    .replace(/\[(.*?)\]|\((.*?)\)/g, " $1 $2 ")
    .replace(/\b(480p|720p|1080p|2160p|4k|bluray|blu[- ]?ray|web[- ]?dl|webrip|x264|x265|h264|h265|aac|dts|yts|yify|proper|repack|remux|hdr|dv|ddp|multi)\b/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseTorrentMetadata(fileBuffer, fallbackName) {
  let offset = 0;
  let infoRange = null;
  let torrentName = null;

  function readValue(inInfoDictionary = false) {
    const rawStart = offset;
    const token = fileBuffer[offset];

    if (token === 105) { // i
      offset += 1;
      const end = fileBuffer.indexOf(101, offset);
      if (end === -1) {
        throw new Error("Invalid torrent file: unterminated integer");
      }
      const value = Number(fileBuffer.slice(offset, end).toString("utf8"));
      offset = end + 1;
      return { value, rawStart, rawEnd: offset };
    }

    if (token === 108) { // l
      offset += 1;
      const list = [];
      while (fileBuffer[offset] !== 101) {
        list.push(readValue(inInfoDictionary).value);
      }
      offset += 1;
      return { value: list, rawStart, rawEnd: offset };
    }

    if (token === 100) { // d
      offset += 1;
      const dict = {};
      while (fileBuffer[offset] !== 101) {
        const key = readValue(inInfoDictionary).value;
        const value = readValue(inInfoDictionary || key === "info");
        dict[key] = value.value;

        if (key === "info") {
          infoRange = { start: value.rawStart, end: value.rawEnd };
        }

        if (inInfoDictionary && (key === "name" || key === "name.utf-8") && typeof value.value === "string" && value.value.trim()) {
          torrentName = value.value;
        }
      }
      offset += 1;
      return { value: dict, rawStart, rawEnd: offset };
    }

    if (token >= 48 && token <= 57) { // string
      let colon = offset;
      while (fileBuffer[colon] !== 58) {
        colon += 1;
        if (colon >= fileBuffer.length) {
          throw new Error("Invalid torrent file: malformed string length");
        }
      }
      const length = Number(fileBuffer.slice(offset, colon).toString("utf8"));
      const valueStart = colon + 1;
      const valueEnd = valueStart + length;
      if (Number.isNaN(length) || valueEnd > fileBuffer.length) {
        throw new Error("Invalid torrent file: bad string length");
      }
      const value = fileBuffer.slice(valueStart, valueEnd).toString("utf8");
      offset = valueEnd;
      return { value, rawStart, rawEnd: offset };
    }

    throw new Error(`Invalid torrent file: unexpected token ${String.fromCharCode(token || 0)}`);
  }

  const parsed = readValue(false).value;
  const torrentFolderName = (torrentName || path.basename(fallbackName, path.extname(fallbackName)) || "torrent")
    .trim()
    .replace(/[\\/]/g, " ");

  if (!infoRange) {
    throw new Error("Invalid torrent file: missing info dictionary");
  }

  const infoHash = crypto.createHash("sha1").update(fileBuffer.slice(infoRange.start, infoRange.end)).digest("hex").toUpperCase();

  return {
    torrentName: torrentFolderName,
    infoHash,
    data: parsed,
  };
}

function chooseLookupMatch(results, searchText) {
  if (!Array.isArray(results) || !results.length) {
    return null;
  }

  const normalizedSearch = normalizeSearchText(searchText);
  const exact = results.find(item => normalizeSearchText(item.title || item.name || item.originalTitle || item.originalName) === normalizedSearch);
  if (exact) {
    return exact;
  }

  const prefix = results.find(item => normalizeSearchText(item.title || item.name || item.originalTitle || item.originalName).startsWith(normalizedSearch));
  if (prefix) {
    return prefix;
  }

  return results[0];
}

async function ensureArrMediaFromTorrent(category, torrentName) {
  const lookupTerm = normalizeSearchText(torrentName);

  if (!lookupTerm) {
    return null;
  }

  if (category === "radarr") {
    const [results, existing, rootFolders, profiles] = await Promise.all([
      fetchRadarr(`/api/v3/movie/lookup?term=${encodeURIComponent(lookupTerm)}`),
      fetchRadarr("/api/v3/movie"),
      fetchRadarr("/api/v3/rootfolder"),
      fetchRadarr("/api/v3/qualityprofile"),
    ]);

    const match = chooseLookupMatch(results, lookupTerm);
    if (!match?.tmdbId) {
      return null;
    }

    if (existing.some(movie => movie.tmdbId === match.tmdbId)) {
      return match;
    }

    const rootFolderPath = rootFolders[0]?.path;
    const qualityProfileId = profiles[0]?.id;

    if (!rootFolderPath || !qualityProfileId) {
      throw new Error("Radarr missing root folder or quality profile");
    }

    await fetchRadarr("/api/v3/movie", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: match.title || match.originalTitle || torrentName,
        tmdbId: match.tmdbId,
        year: match.year,
        images: match.images,
        qualityProfileId,
        rootFolderPath,
        monitored: true,
        addOptions: { searchForMovie: false },
      }),
    });

    return match;
  }

  if (category === "sonarr") {
    const [results, existing, rootFolders, profiles] = await Promise.all([
      fetchSonarr(`/api/v3/series/lookup?term=${encodeURIComponent(lookupTerm)}`),
      fetchSonarr("/api/v3/series"),
      fetchSonarr("/api/v3/rootfolder"),
      fetchSonarr("/api/v3/qualityprofile"),
    ]);

    const match = chooseLookupMatch(results, lookupTerm);
    if (!match?.tvdbId) {
      return null;
    }

    if (existing.some(series => series.tvdbId === match.tvdbId)) {
      return match;
    }

    const rootFolderPath = rootFolders[0]?.path;
    const qualityProfileId = profiles[0]?.id;

    if (!rootFolderPath || !qualityProfileId) {
      throw new Error("Sonarr missing root folder or quality profile");
    }

    await fetchSonarr("/api/v3/series", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: match.title || match.name || torrentName,
        tvdbId: match.tvdbId,
        year: match.year,
        images: match.images,
        qualityProfileId,
        rootFolderPath,
        monitored: true,
        addOptions: { searchForMissingEpisodes: false },
      }),
    });

    return match;
  }

  return null;
}


async function waitForQbittorrentTorrent(infoHash, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const torrents = await fetchQbittorrent("/api/v2/torrents/info");
      const torrent = torrents.find(item => String(item.hash || "").toUpperCase() === String(infoHash || "").toUpperCase());

      if (torrent) {
        return torrent;
      }
    } catch (_error) {
      // keep polling until the torrent is visible
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return null;
}

async function renameQbittorrentTorrentForArr(infoHash, category, canonicalTitle) {
  if (!infoHash || !canonicalTitle) {
    return false;
  }

  const torrent = await waitForQbittorrentTorrent(infoHash);
  if (!torrent) {
    return false;
  }

  let files = [];
  try {
    files = await fetchQbittorrent(`/api/v2/torrents/files?hash=${encodeURIComponent(infoHash)}`);
  } catch (_error) {
    return false;
  }

  if (!Array.isArray(files) || !files.length) {
    return false;
  }

  const videoFiles = files.filter(file => /\.(mkv|mp4|avi|mov|wmv|m4v)$/i.test(file.name || file.path || ""));
  const targetFile = videoFiles[0] || files[0];
  const oldName = targetFile.name || targetFile.path;

  if (!oldName) {
    return false;
  }

  const ext = path.extname(oldName);
  const newName = files.length === 1
    ? `${canonicalTitle}${ext}`
    : canonicalTitle;

  const endpoint = files.length === 1
    ? "/api/v2/torrents/renameFile"
    : "/api/v2/torrents/renameFolder";

  const cookie = await loginToQbittorrent();
  const response = await fetch(`${QBITTORRENT_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Cookie": cookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      hash: infoHash,
      oldPath: oldName,
      newPath: newName,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Rename failed with status ${response.status}`);
  }

  const categoryPath = category === "sonarr" ? "/data/torrents/tv" : "/data/torrents/movies";
  const scanPath = files.length === 1 ? path.join(categoryPath, `${newName}`) : path.join(categoryPath, canonicalTitle);
  await triggerDownloadedScan(category, scanPath, infoHash);
  return true;
}

async function triggerDownloadedScan(category, folderPath, downloadClientId) {
  const commandName = category === "sonarr" ? "DownloadedEpisodesScan" : category === "radarr" ? "DownloadedMoviesScan" : null;

  if (!commandName) {
    return null;
  }

  const apiUrl = category === "sonarr" ? SONARR_URL : RADARR_URL;
  const apiKey = category === "sonarr" ? getSonarrApiKey() : getRadarrApiKey();

  if (!apiKey) {
    throw new Error(`${category} API key is unavailable.`);
  }

  const response = await fetch(`${apiUrl}/api/v3/command`, {
    method: "POST",
    headers: {
      "X-Api-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: commandName,
      path: folderPath,
      downloadClientId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Command failed with status ${response.status}`);
  }

  return response.json();
}

function summarizeServiceError(error) {
  return error instanceof Error ? error.message : String(error);
}

function isActiveDownload(torrent) {
  const progress = Number(torrent.progress || 0);

  return progress < 1 || ACTIVE_DOWNLOAD_STATES.has(torrent.state);
}

function getRequestHostname(req) {
  const forwardedHost = req.headers["x-forwarded-host"];
  const hostHeader = forwardedHost || req.headers.host || "";

  if (!hostHeader) {
    return "localhost";
  }

  if (hostHeader.startsWith("[")) {
    const closingBracketIndex = hostHeader.indexOf("]");
    return closingBracketIndex === -1 ? hostHeader : hostHeader.slice(0, closingBracketIndex + 1);
  }

  return hostHeader.split(":")[0];
}

function getRequestProtocol(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];

  if (typeof forwardedProto === "string" && forwardedProto.length) {
    return forwardedProto.split(",")[0].trim();
  }

  return req.protocol || "http";
}

function findSubtitleFiles(savePath, torrentName) {
  const subtitleFiles = new Set();
  const candidateDirs = [savePath, path.join(savePath, torrentName)];

  candidateDirs.forEach(dir => {
    try {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return;
      }

      fs.readdirSync(dir).forEach(file => {
        const ext = path.extname(file).toLowerCase();
        if (SUBTITLE_EXTENSIONS.has(ext)) {
          subtitleFiles.add(file);
        }
      });
    } catch (_err) {
      // ignore inaccessible directories
    }
  });

  return Array.from(subtitleFiles);
}

function findSubtitleFilesInDirectory(directory) {
  const subtitleFiles = new Set();
  const stack = [directory];

  while (stack.length) {
    const currentDir = stack.pop();

    try {
      if (!fs.existsSync(currentDir) || !fs.statSync(currentDir).isDirectory()) {
        continue;
      }

      fs.readdirSync(currentDir).forEach(entry => {
        const entryPath = path.join(currentDir, entry);
        try {
          const stat = fs.statSync(entryPath);

          if (stat.isDirectory()) {
            stack.push(entryPath);
            return;
          }

          const ext = path.extname(entry).toLowerCase();
          if (SUBTITLE_EXTENSIONS.has(ext)) {
            subtitleFiles.add(path.relative(directory, entryPath));
          }
        } catch (_err) {
          // ignore unreadable files
        }
      });
    } catch (_err) {
      // ignore inaccessible directories
    }
  }

  return Array.from(subtitleFiles);
}

function getExternalServiceUrl(req, serviceId) {
  if (SERVICE_EXTERNAL_URLS[serviceId]) {
    return SERVICE_EXTERNAL_URLS[serviceId];
  }

  const hostname = getRequestHostname(req);

  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
    return null;
  }

  const port = SERVICE_EXTERNAL_PORTS[serviceId];

  if (!port) {
    return null;
  }

  return `${getRequestProtocol(req)}://${hostname}:${port}`;
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
    const subtitleFiles = findSubtitleFilesInDirectory(folderPath);

    movies.push({
      title: folder,
      source: "filesystem",
      hasFile: Boolean(video),
      videoUrl: video ? `/stream/${folder}/${video}` : null,
      path: folderPath,
      subtitlesAvailable: subtitleFiles.length > 0,
      subtitleFiles,
    });
  });

  return movies;
}

function formatStatsBytes(bytes) {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return "0 B";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function calculateCpuPercent(stats) {
  const cpuStats = stats?.cpu_stats;
  const previousCpuStats = stats?.precpu_stats;
  const cpuUsage = cpuStats?.cpu_usage?.total_usage;
  const previousCpuUsage = previousCpuStats?.cpu_usage?.total_usage;
  const systemUsage = cpuStats?.system_cpu_usage;
  const previousSystemUsage = previousCpuStats?.system_cpu_usage;

  if (
    cpuUsage === undefined ||
    previousCpuUsage === undefined ||
    systemUsage === undefined ||
    previousSystemUsage === undefined
  ) {
    return null;
  }

  const cpuDelta = cpuUsage - previousCpuUsage;
  const systemDelta = systemUsage - previousSystemUsage;
  const onlineCpus = cpuStats.online_cpus || cpuStats.cpu_usage?.percpu_usage?.length || 1;

  if (cpuDelta <= 0 || systemDelta <= 0) {
    return null;
  }

  return (cpuDelta / systemDelta) * onlineCpus * 100;
}

function extractDockerResourceDetails(stats) {
  if (!stats) {
    return {};
  }

  const details = {};
  const cpuPercent = calculateCpuPercent(stats);

  if (cpuPercent !== null) {
    details["CPU"] = `${cpuPercent.toFixed(cpuPercent >= 10 ? 0 : 1)}%`;
  }

  if (stats.memory_stats?.usage !== undefined) {
    details["Memory"] = formatStatsBytes(stats.memory_stats.usage);
  }

  let rx = 0;
  let tx = 0;

  if (stats.networks) {
    for (const net of Object.values(stats.networks)) {
      rx += net.rx_bytes || 0;
      tx += net.tx_bytes || 0;
    }

    details["Network I/O"] = `${formatStatsBytes(rx)} ↓ / ${formatStatsBytes(tx)} ↑`;
  }

  details["Updated"] = new Date().toISOString();

  return details;
}

function getDockerStats(containerName) {
  return new Promise((resolve) => {
    let socketPath = null;
    if (fs.existsSync('/var/run/docker.sock')) {
      socketPath = '/var/run/docker.sock';
    } else if (process.env.HOME && fs.existsSync(process.env.HOME + '/.docker/run/docker.sock')) {
      socketPath = process.env.HOME + '/.docker/run/docker.sock';
    }
    
    if (!socketPath) {
      return resolve(null);
    }
    
    const options = {
      socketPath,
      path: `/containers/${containerName}/stats?stream=false`,
      method: 'GET'
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function getServiceResources() {
  return Promise.all(SERVICE_RESOURCE_TARGETS.map(async service => {
    const stats = await getDockerStats(service.id);

    return {
      id: service.id,
      name: service.name,
      resources: extractDockerResourceDetails(stats),
    };
  }));
}

async function getServiceStatuses(req) {
  const checks = [
    {
      id: "media-server",
      name: "Dashboard",
      internalUrl: "http://media-server:3000",
      check: async () => ({
        version: process.env.npm_package_version || "1.0.0",
        uptime: `${Math.floor(process.uptime())}s`,
      }),
    },
    {
      id: "jellyfin",
      name: "Jellyfin",
      internalUrl: JELLYFIN_URL,
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
      id: "jellyseerr",
      name: "Jellyseerr",
      internalUrl: JELLYSEERR_URL,
      check: async () => {
        const status = await fetchJellyseerr("/api/v1/status");

        return {
          version: status.version,
          updateAvailable: status.updateAvailable,
          restartRequired: status.restartRequired,
        };
      },
    },
    {
      id: "radarr",
      name: "Radarr",
      internalUrl: RADARR_URL,
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
      internalUrl: SONARR_URL,
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
      internalUrl: PROWLARR_URL,
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
      id: "bazarr",
      name: "Bazarr",
      internalUrl: BAZARR_URL,
      check: async () => {
        const response = await fetch(BAZARR_URL, {
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          throw new Error(`Bazarr status check failed with ${response.status}`);
        }

        return {
          web: "reachable",
        };
      },
    },
    {
      id: "qbittorrent",
      name: "qBittorrent",
      internalUrl: QBITTORRENT_URL,
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
    let details = {};
    let status = "online";
    let errorStr = undefined;

    try {
      details = await service.check();
    } catch (error) {
      status = "offline";
      errorStr = summarizeServiceError(error);
    }

    try {
      const stats = await getDockerStats(service.id);
      details = {
        ...details,
        ...extractDockerResourceDetails(stats),
      };
    } catch (e) {
      // Ignore docker stat fetch errors
    }

    const result = {
      id: service.id,
      name: service.name,
      internalUrl: service.internalUrl,
      externalUrl: getExternalServiceUrl(req, service.id),
      status,
      details,
    };
    
    if (errorStr) {
      result.error = errorStr;
    }
    
    return result;
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

app.get("/api/system", async (req, res) => {
  const services = await getServiceStatuses(req);

  return res.json({
    mode: "server-stack",
    mediaPath: getMediaPath(),
    downloadsPath: DOWNLOADS_PATH,
    services,
  });
});

app.get("/api/services", async (req, res) => {
  const services = await getServiceStatuses(req);
  const hasFailures = services.some(service => service.status !== "online");

  return res.status(hasFailures ? 207 : 200).json(services);
});

app.get("/api/services/resources", async (_req, res) => {
  const resources = await getServiceResources();

  return res.json(resources);
});

app.get("/api/downloads", async (_req, res) => {
  try {
    const torrents = await fetchQbittorrent("/api/v2/torrents/info");
    const payload = torrents.filter(isActiveDownload).map(torrent => {
      const subtitleFiles = findSubtitleFiles(torrent.save_path, torrent.name);

      return {
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
        subtitlesAvailable: subtitleFiles.length > 0,
        subtitleFiles,
      };
    });

    return res.json(payload);
  } catch (error) {
    return res.status(502).json({
      error: "Unable to fetch qBittorrent downloads.",
      details: error.message,
    });
  }
});

app.get("/api/requests", async (_req, res) => {
  try {
    const payload = await fetchJellyseerr("/api/v1/request?take=12&skip=0");
    const requests = await Promise.all((payload.results || []).map(async request => {
      const details = await getJellyseerrMediaDetails(request.media);

      return {
        id: request.id,
        type: request.type,
        status: request.status,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        profileId: request.profileId,
        rootFolder: request.rootFolder,
        requestedBy: request.requestedBy ? {
          id: request.requestedBy.id,
          displayName: request.requestedBy.displayName,
          email: request.requestedBy.email,
        } : null,
        modifiedBy: request.modifiedBy ? {
          id: request.modifiedBy.id,
          displayName: request.modifiedBy.displayName,
          email: request.modifiedBy.email,
        } : null,
        media: request.media ? {
          title: details.title || request.media.title || request.media.name,
          year: details.year,
          tmdbId: request.media.tmdbId,
          tvdbId: request.media.tvdbId,
          mediaType: request.media.mediaType,
          status: request.media.status,
          externalServiceId: request.media.externalServiceId,
          externalServiceSlug: request.media.externalServiceSlug,
          mediaUrl: request.media.mediaUrl,
        } : null,
      };
    }));

    return res.json(requests);
  } catch (error) {
    return res.status(502).json({
      error: "Unable to fetch Jellyseerr requests.",
      details: error.message,
    });
  }
});

app.delete("/api/downloads", async (_req, res) => {
  try {
    const torrents = await fetchQbittorrent("/api/v2/torrents/info");
    const active = torrents.filter(isActiveDownload);

    if (!active.length) {
      return res.json({ success: true, deleted: 0 });
    }

    const cookie = await loginToQbittorrent();
    const response = await fetch(`${QBITTORRENT_URL}/api/v2/torrents/delete`, {
      method: "POST",
      headers: {
        "Cookie": cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        hashes: active.map(torrent => torrent.hash).join("|"),
        deleteFiles: "true",
      }),
    });

    if (!response.ok) {
      throw new Error(`Delete failed: ${response.status}`);
    }

    return res.json({ success: true, deleted: active.length });
  } catch (error) {
    return res.status(502).json({ error: summarizeServiceError(error) });
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
    const [movies, bazarrMoviesResponse] = await Promise.all([
      fetchRadarr("/api/v3/movie"),
      fetchBazarr("/api/movies"),
    ]);

    const bazarrMovies = bazarrMoviesResponse.data || [];
    const payload = movies.map(movie => {
      const moviePath = movie.path || movie.movieFile?.path || "";
      const subtitleFiles = moviePath ? findSubtitleFilesInDirectory(moviePath) : [];
      
      const bazarrMovie = bazarrMovies.find(bm => bm.radarrId === movie.id);

      return {
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
        subtitlesAvailable: subtitleFiles.length > 0,
        subtitleFiles,
        bazarrStatus: bazarrMovie ? {
          missing: bazarrMovie.missing_subtitles || [],
          subtitles: bazarrMovie.subtitles || [],
        } : null,
      };
    });

    return res.json(payload);
  } catch (_error) {
    return res.json(getFilesystemMovies());
  }
});

app.delete("/api/library/movies/:id", async (req, res) => {
  try {
    await fetchRadarr(`/api/v3/movie/${req.params.id}?deleteFiles=true`, { method: "DELETE" });
    return res.json({ success: true });
  } catch (error) {
    return res.status(502).json({ error: summarizeServiceError(error) });
  }
});

app.get("/api/library/tv", async (_req, res) => {
  try {
    const [series, bazarrSeriesResponse] = await Promise.all([
      fetchSonarr("/api/v3/series"),
      fetchBazarr("/api/series"),
    ]);

    const bazarrSeries = bazarrSeriesResponse.data || [];
    const payload = series.map(show => {
      const subtitleFiles = show.path ? findSubtitleFilesInDirectory(show.path) : [];
      const bazarrShow = bazarrSeries.find(bs => bs.sonarrId === show.id);

      return {
        id: show.id,
        title: show.title,
        year: show.year,
        monitored: show.monitored,
        status: show.status,
        seasonCount: show.seasons?.length || 0,
        episodeCount: show.statistics?.episodeCount || 0,
        episodeFileCount: show.statistics?.episodeFileCount || 0,
        sizeOnDisk: show.statistics?.sizeOnDisk || 0,
        added: show.added,
        path: show.path,
        subtitlesAvailable: subtitleFiles.length > 0,
        subtitleFiles,
        bazarrStatus: bazarrShow ? {
          missing: bazarrShow.missing_subtitles || [],
          subtitles: bazarrShow.subtitles || [],
        } : null,
      };
    });

    return res.json(payload);
  } catch (error) {
    return res.status(502).json({ error: summarizeServiceError(error) });
  }
});

app.post("/api/bazarr/search", async (req, res) => {
  try {
    const { episodeId, movieId } = req.body;
    const endpoint = episodeId ? `/api/episodes/${episodeId}/subtitles/search` : `/api/movies/${movieId}/subtitles/search`;
    await fetchBazarr(endpoint, { method: "POST" });
    return res.json({ success: true });
  } catch (error) {
    return res.status(502).json({ error: summarizeServiceError(error) });
  }
});

app.delete("/api/library/tv/:id", async (req, res) => {
  try {
    await fetchSonarr(`/api/v3/series/${req.params.id}?deleteFiles=true`, { method: "DELETE" });
    return res.json({ success: true });
  } catch (error) {
    return res.status(502).json({ error: summarizeServiceError(error) });
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
    const category = req.body.category || "radarr";
    const savepath = category === "sonarr" ? "/data/torrents/tv" : "/data/torrents/movies";
    const fileBuffer = fs.readFileSync(req.file.path);
    const torrentMeta = parseTorrentMetadata(fileBuffer, req.file.originalname);
    const torrentFolderPath = path.join(savepath, torrentMeta.torrentName);

    let matchedMedia = null;
    try {
      matchedMedia = await ensureArrMediaFromTorrent(category, torrentMeta.torrentName);
    } catch (mediaError) {
      console.warn(`⚠️ Could not seed ${category} media from torrent name:`, mediaError.message);
    }

    const formData = new FormData();
    formData.append("torrents", new Blob([fileBuffer]), req.file.originalname);
    formData.append("savepath", savepath);
    formData.append("category", category);
    formData.append("dummy", "dummy"); // Workaround for qBittorrent multipart boundary parsing bug in Node 18+ FormData

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

    const canonicalTitle = category === "radarr"
      ? `${matchedMedia?.title || torrentMeta.torrentName}${matchedMedia?.year ? ` (${matchedMedia.year})` : ""}`
      : `${matchedMedia?.title || torrentMeta.torrentName}${matchedMedia?.year ? ` (${matchedMedia.year})` : ""}`;

    let renamed = false;
    if (canonicalTitle) {
      try {
        renamed = await renameQbittorrentTorrentForArr(torrentMeta.infoHash, category, canonicalTitle);
      } catch (renameError) {
        console.warn(`⚠️ ${category} torrent rename failed:`, renameError.message);
      }
    }

    if (!renamed) {
      try {
        await triggerDownloadedScan(category, torrentFolderPath, torrentMeta.infoHash);
      } catch (scanError) {
        console.warn(`⚠️ ${category} download scan could not be queued:`, scanError.message);
      }
    }

    return res.json({
      success: true,
      torrentName: torrentMeta.torrentName,
      infoHash: torrentMeta.infoHash,
      category,
      savePath: savepath,
      matchedTitle: canonicalTitle,
      renamed,
    });
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

app.listen(3000, '0.0.0.0', () => {
  console.log("🚀 Server running on port 3000");
  // Auto-configure qBittorrent category paths after a short delay to allow qBittorrent to be ready
  setTimeout(setupQbittorrentCategories, 5000);
});
