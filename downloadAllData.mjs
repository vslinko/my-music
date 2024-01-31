import fs from "node:fs/promises";
import { getAlbums, getImage, getSongs, getSongFile } from "./lib.mjs";

export async function downloadAllData() {
  const imagesDir = process.env.IMAGES_DIR;
  await fs.mkdir(imagesDir, { recursive: true });

  let knownAlbums;
  try {
    knownAlbums = JSON.parse(await fs.readFile(process.env.ALBUMS_FILE));
  } catch (err) {
    knownAlbums = [];
  }

  const albums = await getAlbums();

  for (const album of albums) {
    const knownAlbum = knownAlbums.find((a) => a.id === album.id);

    if (knownAlbum) {
      album.songs = knownAlbum.songs;
    } else {
      album.songs = await getSongs(album.id);

      for (const song of album.songs) {
        const res = await getSongFile(song.id, { method: "HEAD" });
        song.fileType = res.headers.get("content-type");
      }
    }

    for (const maxWidth of [200, 700, 1200]) {
      const imgFile = `${imagesDir}/${album.id}-${maxWidth}.jpg`;
      try {
        await fs.access(imgFile, fs.constants.R_OK);
      } catch (err) {
        const img = await getImage(album.id, maxWidth);
        await fs.writeFile(imgFile, img);
      }
    }
  }

  await fs.writeFile(process.env.ALBUMS_FILE, JSON.stringify(albums));
}

if (import.meta.url.endsWith(process.argv[1])) {
  const dotenv = await import("dotenv");
  dotenv.config({
    path: "./data/config",
  });

  console.log("downloadAllData");
  await downloadAllData();
}
