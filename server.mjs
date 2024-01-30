import fs from "node:fs/promises";
import { Readable } from "node:stream";
import dotenv from "dotenv";
import express from "express";
import { getSongFile } from "./lib.mjs";
import { downloadAllData } from "./downloadAllData.mjs";

dotenv.config({
  path: "./data/config",
});

const app = express();

app.use(express.static("./public"));

app.get("/data/albums.json", async (req, res) => {
  try {
    if (req.query.apiKey !== process.env.API_KEY) {
      res.status(400);
      return;
    }
    const albums = JSON.parse(await fs.readFile(process.env.ALBUMS_FILE));
    for (const album of albums) {
      album.cover = `${process.env.BASE_URL}/data/images/${album.id}.jpg`;
      for (const song of album.songs) {
        song.file = `${process.env.BASE_URL}/data/songs/${song.id}`;
      }
    }
    res.json(albums);
  } catch (err) {
    res.status(500).send(String(err));
  }
});

app.use("/data/images", express.static(process.env.IMAGES_DIR));

function copyHeader(from, to, name) {
  const h = from.headers.get(name);
  if (h) {
    to.header(name, h);
  }
}

app.get("/data/songs/:id([0-9a-f]{32})", async (req, res) => {
  try {
    const songRes = await getSongFile(req.params.id, {
      range: req.header("range"),
    });
    res.status(songRes.status);
    copyHeader(songRes, res, "content-type");
    copyHeader(songRes, res, "accept-ranges");
    copyHeader(songRes, res, "content-length");
    copyHeader(songRes, res, "content-range");
    Readable.fromWeb(songRes.body).pipe(res);
  } catch (err) {
    res.status(500).send(String(err));
  }
});

async function downloadAllDataAndRepeat() {
  try {
    console.log("Refreshing data");
    await downloadAllData();
  } finally {
    setTimeout(downloadAllDataAndRepeat, 1000 * 60 * 60);
    console.log("Refresh scheduled in 1h");
  }
}

app.listen(8080, () => {
  console.log("Listening http://localhost:8080");
  if (!process.env.DISABLE_UPDATE) {
    downloadAllDataAndRepeat();
  }
});
