const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();

const MEDIA_PATH = "/data/movies";

// 🎬 List movies
app.get("/movies", (req, res) => {
  const movies = [];

  if (!fs.existsSync(MEDIA_PATH)) return res.json([]);

  fs.readdirSync(MEDIA_PATH).forEach(folder => {
    const folderPath = path.join(MEDIA_PATH, folder);

    if (fs.statSync(folderPath).isDirectory()) {
      const files = fs.readdirSync(folderPath);
      const video = files.find(f => f.endsWith(".mp4") || f.endsWith(".mkv"));

      if (video) {
        movies.push({
          title: folder,
          videoUrl: `/stream/${folder}/${video}`
        });
      }
    }
  });

  res.json(movies);
});

// 🎥 Stream video
app.get("/stream/:folder/:file", (req, res) => {
  const folder = decodeURIComponent(req.params.folder);
  const file = decodeURIComponent(req.params.file);

  const filePath = path.join(MEDIA_PATH, folder, file);

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
      "Content-Type": "video/mp4",
    });

    stream.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": "video/mp4",
    });

    fs.createReadStream(filePath).pipe(res);
  }
});

app.listen(3000, () => console.log("🚀 Server running on port 3000"));