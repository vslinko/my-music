import fs from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import dotenv from "dotenv";
import express from "express";
import { addToTop, getSongFile, removeFromTop } from "./lib.mjs";
import { downloadAllData } from "./downloadAllData.mjs";

dotenv.config({
  path: "./data/config",
});

const app = express();

app.use(express.static("./public"));

app.get("/data/albums.json", async (req, res) => {
  try {
    if (req.query.apiKey !== process.env.API_KEY) {
      res.status(400).send();
      return;
    }
    const albums = JSON.parse(await fs.readFile(process.env.ALBUMS_FILE));
    for (const album of albums) {
      album.cover200 = `${process.env.BASE_URL}/data/images/${album.id}-200.jpg`;
      album.cover700 = `${process.env.BASE_URL}/data/images/${album.id}-700.jpg`;
      album.cover1200 = `${process.env.BASE_URL}/data/images/${album.id}-1200.jpg`;
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

app.post("/api/add-tag", async (req, res) => {
  const albumId = req.query.albumId;
  const tag = req.query.tag;

  const fns = {
    top: addToTop,
  };

  try {
    const fn = fns[tag];
    if (!fn) {
      res.status(400).send(`Unknown tag "${tag}"`);
      return;
    }
    const albums = JSON.parse(readFileSync(process.env.ALBUMS_FILE, "utf8"));
    const album = albums.find((a) => a.id === albumId);
    if (!album) {
      res.status(404).send();
      return;
    }
    if (!album.tags.includes(tag)) {
      album.tags.push(tag);
    }
    await fn(albumId);
    writeFileSync(process.env.ALBUMS_FILE, JSON.stringify(albums));
    res.status(204).send();
  } catch (err) {
    res.status(500).send(String(err));
  }
});

app.post("/api/remove-tag", async (req, res) => {
  const albumId = req.query.albumId;
  const tag = req.query.tag;

  const fns = {
    top: removeFromTop,
  };

  try {
    const fn = fns[tag];
    if (!fn) {
      res.status(400).send(`Unknown tag "${tag}"`);
      return;
    }
    const albums = JSON.parse(readFileSync(process.env.ALBUMS_FILE, "utf8"));
    const album = albums.find((a) => a.id === albumId);
    if (!album) {
      res.status(404).send();
      return;
    }
    const i = album.tags.indexOf(tag);
    if (i >= 0) {
      album.tags.splice(i, 1);
    }
    await fn(albumId);
    writeFileSync(process.env.ALBUMS_FILE, JSON.stringify(albums));
    res.status(204).send();
  } catch (err) {
    res.status(500).send(String(err));
  }
});

app.post("/api/refresh", async (req, res) => {
  try {
    checker.run();
  } finally {
    res.status(204).send();
  }
});

class Checker {
  #running = false;
  #rerunScheduled = false;
  #started = false;

  start() {
    if (this.#started) {
      throw new Error(`Already started`);
    }
    this.#started = true;
    this.#runAndSchedule();
  }

  run() {
    this.#run();
  }

  #schedule() {
    setTimeout(this.#runAndSchedule, 1000 * 60 * 60);
    console.log("Refresh scheduled in 1h");
  }

  #runAndSchedule = async () => {
    try {
      await this.#run();
    } finally {
      this.#schedule();
    }
  };

  async #run() {
    if (this.#running) {
      this.#rerunScheduled = true;
      return;
    }

    try {
      this.#running = true;
      console.log("Refreshing data");
      await downloadAllData();
    } finally {
      this.#running = false;
      if (this.#rerunScheduled) {
        this.#rerunScheduled = false;
        this.#run();
      }
    }
  }
}

const checker = new Checker();

app.listen(8080, () => {
  console.log("Listening http://localhost:8080");
  if (!process.env.DISABLE_UPDATE) {
    checker.start();
  }
});
