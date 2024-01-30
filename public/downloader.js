onmessage = async (event) => {
  try {
    if (event.data.action === "downloadFile") {
      const res = await fetch(event.data.url);
      const arrayBuffer = await res.arrayBuffer();

      let dirHandle = await navigator.storage.getDirectory();
      for (const dirName of event.data.path) {
        dirHandle = await dirHandle.getDirectoryHandle(dirName, {
          create: true,
        });
      }
      const fileHandle = await dirHandle.getFileHandle(event.data.filename, {
        create: true,
      });
      if (fileHandle.createSyncAccessHandle) {
        const access = await fileHandle.createSyncAccessHandle();
        access.write(arrayBuffer);
        access.flush();
        access.close();
      } else {
        const fileWritable = await fileHandle.createWritable();
        await fileWritable.write(arrayBuffer);
        await fileWritable.close();
      }
    }

    postMessage(null);
  } catch (err) {
    postMessage({ error: String(err) });
  }
};
