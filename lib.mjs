function readConfig() {
  const jellyfinUser = process.env.JELLYFIN_USER;
  const jellyfinLibrary = process.env.JELLYFIN_LIBRARY;
  const jellyfinDeviceId = process.env.JELLYFIN_DEVICE_ID;
  const jellyfinToken = process.env.JELLYFIN_TOKEN;
  const jellyfinAuth = `MediaBrowser Client="Jellyfin Web", Device="Chrome", DeviceId="${jellyfinDeviceId}", Version="10.8.12", Token="${jellyfinToken}"`;

  return {
    jellyfinUser,
    jellyfinLibrary,
    jellyfinDeviceId,
    jellyfinToken,
    jellyfinAuth,
  };
}

export async function getAlbums() {
  const { jellyfinUser, jellyfinLibrary, jellyfinAuth } = readConfig();
  const limit = 100;
  const result = [];
  let offset = 0;
  let total = 0;
  do {
    const res = await fetch(
      `https://jellyfin.vslinko.xyz/Users/${jellyfinUser}/Items?SortBy=DateCreated%2CSortName&SortOrder=Descending&IncludeItemTypes=MusicAlbum&Recursive=true&Fields=PrimaryImageAspectRatio%2CSortName%2CBasicSyncInfo&ImageTypeLimit=1&EnableImageTypes=Primary%2CBackdrop%2CBanner%2CThumb&StartIndex=${offset}&Limit=${limit}&ParentId=${jellyfinLibrary}`,
      {
        headers: {
          accept: "application/json",
          "accept-language": "en-US,en;q=0.9",
          "cache-control": "no-cache",
          pragma: "no-cache",
          "sec-ch-ua":
            '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"macOS"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "x-emby-authorization": jellyfinAuth,
        },
        referrerPolicy: "no-referrer",
        body: null,
        method: "GET",
      }
    );

    const data = await res.json();

    for (const item of data.Items) {
      result.push({
        id: item.Id,
        artists: item.AlbumArtists.map((a) => a.Name),
        name: item.Name,
        year: item.ProductionYear,
      });
    }

    total = data.TotalRecordCount;
    offset += limit;
  } while (result.length < total);

  return result;
}

export async function getImage(albumId) {
  const res = await fetch(
    `https://jellyfin.vslinko.xyz/Items/${albumId}/Images/Primary?maxWidth=2592&quality=90`
  );
  const arrayBuffer = await res.arrayBuffer();

  return Buffer.from(arrayBuffer);
}

export async function getSongs(albumId) {
  const { jellyfinUser, jellyfinAuth } = readConfig();
  const limit = 100;
  const result = [];
  let offset = 0;
  let total = 0;
  do {
    const res = await fetch(
      `https://jellyfin.vslinko.xyz/Users/${jellyfinUser}/Items?ParentId=${albumId}&Fields=ItemCounts%2CPrimaryImageAspectRatio%2CBasicSyncInfo%2CCanDelete%2CMediaSourceCount&SortBy=ParentIndexNumber%2CIndexNumber%2CSortName&StartIndex=${offset}&Limit=${limit}`,
      {
        headers: {
          accept: "application/json",
          "accept-language": "en-US,en;q=0.9",
          "cache-control": "no-cache",
          pragma: "no-cache",
          "sec-ch-ua":
            '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"macOS"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "x-emby-authorization": jellyfinAuth,
        },
        referrerPolicy: "no-referrer",
        body: null,
        method: "GET",
      }
    );

    const data = await res.json();

    for (const item of data.Items) {
      result.push({
        id: item.Id,
        name: item.Name,
        year: item.ProductionYear,
        index: item.IndexNumber,
        artists: item.ArtistItems.map((a) => a.Name),
        duration: Math.floor(item.RunTimeTicks / 10000000),
        diskIndex: item.ParentIndexNumber || 1,
      });
    }

    total = data.TotalRecordCount;
    offset += limit;
  } while (result.length < total);

  return result;
}

export async function getSongFile(songId, range = "bytes=0-") {
  const { jellyfinUser, jellyfinDeviceId, jellyfinToken } = readConfig();
  return await fetch(
    `https://jellyfin.vslinko.xyz/Audio/${songId}/universal?UserId=${jellyfinUser}&DeviceId=${jellyfinDeviceId}&MaxStreamingBitrate=140000000&Container=opus%2Cwebm%7Copus%2Cmp3%2Caac%2Cm4a%7Caac%2Cm4b%7Caac%2Cflac%2Cwebma%2Cwebm%7Cwebma%2Cwav%2Cogg&TranscodingContainer=ts&TranscodingProtocol=hls&AudioCodec=aac&api_key=${jellyfinToken}&PlaySessionId=${Date.now()}&StartTimeTicks=0&EnableRedirection=true&EnableRemoteMedia=false`,
    {
      headers: {
        accept: "*/*",
        "Accept-Encoding": "identity;q=1, *;q=0",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        pragma: "no-cache",
        range,
        "sec-ch-ua":
          '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "audio",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
      },
      referrerPolicy: "no-referrer",
      body: null,
      method: "GET",
    }
  );
}
