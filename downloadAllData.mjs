import fs from "node:fs/promises";
import { getAlbums, getImage, getSongs, getSongFile } from "./lib.mjs";

export async function downloadAllData() {
  const imagesDir = process.env.IMAGES_DIR;

  await fs.mkdir(imagesDir, { recursive: true });

  const albums = await getAlbums();

  for (const album of albums) {
    album.songs = await getSongs(album.id);

    for (const song of album.songs) {
      const res = await getSongFile(song.id, { method: "HEAD" });
      song.fileType = res.headers.get("content-type");
    }

    const imgFile = `${imagesDir}/${album.id}.jpg`;
    try {
      await fs.access(imgFile, fs.constants.R_OK);
    } catch (err) {
      const img = await getImage(album.id);
      await fs.writeFile(imgFile, img);
    }
  }

  await fs.writeFile(process.env.ALBUMS_FILE, JSON.stringify(albums));
}
