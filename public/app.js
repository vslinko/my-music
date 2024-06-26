import { ref, createApp, computed, watchEffect, reactive } from "vue";
import BrowserDetector from "browser-dtector";

const browser = new BrowserDetector(window.navigator.userAgent);
const browserInfo = browser.parseUserAgent();

if (browserInfo.isSafari && browserInfo.isDesktop) {
  document.body.classList.add("is-safari-desktop");
}

const isReviewMode = !!localStorage.getItem("md:reviewMode");
window._reviewMode = (enabled) => {
  if (enabled) {
    localStorage.setItem("md:reviewMode", "true");
  } else {
    localStorage.removeItem("md:reviewMode");
  }
  location.reload();
};

const tagsMapping = {
  q: "album:liked",
  a: "song:liked",
};

if (isReviewMode) {
  for (const [key, value] of Object.entries(tagsMapping)) {
    const [type, tag] = value.split(":");
    console.log(
      `Press %c%s%c to tag %c%s%c as %c#%s`,
      "background:#007000;color:white;padding: 0 4px;font-weight:bold",
      key,
      "font-weight:normal",
      "background:#007000;color:white;padding: 0 4px;font-weight:bold",
      type,
      "font-style: normal",
      "background:#007000;color:white;padding: 0 4px;font-weight:bold",
      tag
    );
  }
}

const itemsTags = reactive(
  JSON.parse(localStorage.getItem("md:itemsTags") || "{}")
);
function addTag(key, tag) {
  if (!itemsTags[key]) {
    itemsTags[key] = [];
  }
  if (!itemsTags[key].includes(tag)) {
    itemsTags[key].push(tag);
  }
  localStorage.setItem("md:itemsTags", JSON.stringify(itemsTags));
}
function removeTag(key, tag) {
  if (!itemsTags[key]) {
    return;
  }
  const i = itemsTags[key].indexOf(tag);
  itemsTags[key].splice(i, 1);
  localStorage.setItem("md:itemsTags", JSON.stringify(itemsTags));
}
function toggleTag(key, tag) {
  if (itemsTags[key] && itemsTags[key].includes(tag)) {
    removeTag(key, tag);
  } else {
    addTag(key, tag);
  }
}
function toggleAlbumTag(id, tag) {
  toggleTag(`album:${id}`, tag);
}
function toggleSongTag(id, tag) {
  toggleTag(`song:${id}`, tag);
}
function getAlbumTags(id) {
  const tags = itemsTags[`album:${id}`] || [];
  if (!!localStorage.getItem(`md:cached:${id}`)) {
    tags.push("offline");
  }
  return tags;
}
function getSongTags(id) {
  return itemsTags[`song:${id}`] || [];
}

async function getAlbums(apiKey) {
  const res = await fetch(`/data/albums.json?apiKey=${apiKey}`);
  const data = await res.json();

  const rootDir = await navigator.storage.getDirectory();
  const albumsDir = await rootDir.getDirectoryHandle("albums", {
    create: true,
  });

  for (const album of data) {
    if (localStorage.getItem(`md:cached:${album.id}`)) {
      try {
        const albumDir = await albumsDir.getDirectoryHandle(album.id);
        const fileHandle = await albumDir.getFileHandle("cover.jpg");
        const file = await fileHandle.getFile();
        album.coverCache = URL.createObjectURL(file);
      } catch (err) {}
    }
  }

  return data;
}

function joinArtists(artists) {
  return artists.join(" & ");
}

function formatDuration(len) {
  const min = Math.floor(len / 60);
  const sec = Math.floor(len % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

async function share(album = null) {
  const shareUrl = new URL("/", location.href);
  if (album) {
    shareUrl.searchParams.set("album", album.id);
  }
  shareUrl.hash = localStorage.getItem("md:apiKey");

  if (navigator.share) {
    const title = album
      ? `${joinArtists(album.artists)} - ${album.name}`
      : document.title;

    await navigator.share({
      url: shareUrl.toString(),
      title,
    });
  } else {
    await navigator.clipboard.writeText(shareUrl.toString());
    alert("Link copied to clipboard");
  }
}

const AudioPlayerStatus = {
  new: "new",
  loading: "loading",
  loaded: "loaded",
  startingPlayer: "startingPlayer",
  playing: "playing",
  paused: "paused",
  stopped: "stopped",
  error: "error",
};

class AudioPlayer {
  constructor({ id, url, onTimeUpdate, onEnded }) {
    this._status = AudioPlayerStatus.new;
    this._id = id;
    this._url = url;
    this._el = null;
    this._onTimeUpdate = onTimeUpdate;
    this._onEnded = onEnded;
    this._playPromise = null;
    this._loadingPromise = null;
  }

  // getters
  getStatus() {
    return this._status;
  }

  getId() {
    return this._id;
  }

  getUrl() {
    return this._url;
  }

  getCurrentTime() {
    return this._el?.currentTime || 0;
  }

  getDurationTime() {
    return this._el?.duration || 0;
  }

  // transitions
  setCurrentTime(t) {
    switch (this._status) {
      case AudioPlayerStatus.loaded:
      case AudioPlayerStatus.playing:
      case AudioPlayerStatus.paused:
        this._el.currentTime = t;
        break;
      case AudioPlayerStatus.new:
      case AudioPlayerStatus.loading:
      case AudioPlayerStatus.startingPlayer:
      case AudioPlayerStatus.stopped:
      case AudioPlayerStatus.error:
        break;
    }
  }

  async replace(id, url) {
    this._id = id;
    this._url = url;
    switch (this._status) {
      case AudioPlayerStatus.new:
        break;
      case AudioPlayerStatus.loading:
        this._loadingPromise.cancel = true;
        this._loadingPromise = null;
      case AudioPlayerStatus.loaded:
      case AudioPlayerStatus.paused:
      case AudioPlayerStatus.playing:
      case AudioPlayerStatus.startingPlayer:
        await this._load();
        break;
      case AudioPlayerStatus.stopped:
      case AudioPlayerStatus.error:
        break;
    }
  }

  load = async () => {
    switch (this._status) {
      case AudioPlayerStatus.new:
      case AudioPlayerStatus.loading:
        await this._load();
        break;
      case AudioPlayerStatus.loaded:
      case AudioPlayerStatus.startingPlayer:
      case AudioPlayerStatus.paused:
      case AudioPlayerStatus.playing:
      case AudioPlayerStatus.stopped:
      case AudioPlayerStatus.error:
        break;
    }
  };

  play = async () => {
    switch (this._status) {
      case AudioPlayerStatus.loaded:
      case AudioPlayerStatus.startingPlayer:
      case AudioPlayerStatus.paused:
        await this._play();
        break;
      case AudioPlayerStatus.new:
      case AudioPlayerStatus.loading:
        throw this._error("play");
      case AudioPlayerStatus.playing:
      case AudioPlayerStatus.stopped:
      case AudioPlayerStatus.error:
        break;
    }
  };

  pause = () => {
    switch (this._status) {
      case AudioPlayerStatus.playing:
        this._pause();
        break;
      case AudioPlayerStatus.new:
      case AudioPlayerStatus.loading:
      case AudioPlayerStatus.loaded:
      case AudioPlayerStatus.startingPlayer:
      case AudioPlayerStatus.paused:
      case AudioPlayerStatus.stopped:
      case AudioPlayerStatus.error:
        break;
    }
  };

  async resume() {
    switch (this._status) {
      case AudioPlayerStatus.paused:
        await this._play();
        break;
      case AudioPlayerStatus.playing:
      case AudioPlayerStatus.new:
      case AudioPlayerStatus.loading:
      case AudioPlayerStatus.loaded:
      case AudioPlayerStatus.startingPlayer:
        throw this._error("resume");
      case AudioPlayerStatus.stopped:
      case AudioPlayerStatus.error:
        break;
    }
  }

  stop() {
    switch (this._status) {
      case AudioPlayerStatus.playing:
      case AudioPlayerStatus.startingPlayer:
        this._pause();
      case AudioPlayerStatus.paused:
      case AudioPlayerStatus.new:
      case AudioPlayerStatus.loading:
      case AudioPlayerStatus.loaded:
        this._stop();
        break;
      case AudioPlayerStatus.stopped:
      case AudioPlayerStatus.error:
        break;
    }
  }

  // workers
  _stop() {
    this._cleanup();
    this._status = AudioPlayerStatus.stopped;
  }

  _error(fnName) {
    return new Error(`Unable to ${fnName}() from ${this._status}`);
  }

  async _load() {
    if (!this._loadingPromise) {
      this._status = AudioPlayerStatus.loading;
      if (!this._el) {
        this._el = new Audio();
        this._el.addEventListener("durationchange", this._onTimeUpdate);
        this._el.addEventListener("timeupdate", this._onTimeUpdate);
        this._el.addEventListener("pause", this.pause);
        this._el.addEventListener("play", this.play);
        this._el.addEventListener("ended", this._onEnded);
      }
      const el = this._el;
      const promise = new Promise(async (resolve) => {
        const cb = () => {
          el.removeEventListener("loadeddata", cb);
          if (promise.canceled) {
            return;
          }
          this._status = AudioPlayerStatus.loaded;
          this._loadingPromise = null;
          resolve();
        };
        el.addEventListener("loadeddata", cb);
        el.src = this._url;
        el.load();
      });
      this._loadingPromise = promise;
    }

    await this._loadingPromise;
  }

  async _play() {
    if (!this._playPromise) {
      this._status = AudioPlayerStatus.startingPlayer;
      this._playPromise = this._el
        .play()
        .then(() => {
          if (this._status === AudioPlayerStatus.stopped) {
            return;
          }
          this._status = AudioPlayerStatus.playing;
          this._playPromise = null;
          this._onTimeUpdate();
        })
        .catch((err) => {
          _logError({ err });
          if (this._status === AudioPlayerStatus.stopped) {
            return;
          }
          this._cleanup();
          this._status = AudioPlayerStatus.error;
        });
    }

    await this._playPromise;
  }

  _pause() {
    this._el.pause();
    this._status = AudioPlayerStatus.paused;
    this._onTimeUpdate();
  }

  _cleanup() {
    this._el.removeEventListener("play", this.play);
    this._el.removeEventListener("pause", this.pause);
    this._el.removeEventListener("durationchange", this._onTimeUpdate);
    this._el.removeEventListener("timeupdate", this._onTimeUpdate);
    this._el.removeEventListener("ended", this._onEnded);
    this._el = null;
    this._onTimeUpdate = null;
    this._onEnded = null;
    this._playPromise = null;
    this._loadingPromise = null;
  }
}

async function deleteAlbum(album) {
  delete album.coverCache;
  const rootDir = await navigator.storage.getDirectory();
  const albumsDir = await rootDir.getDirectoryHandle("albums", {
    create: true,
  });
  await albumsDir.removeEntry(album.id, { recursive: true });
  localStorage.removeItem(`md:cached:${album.id}`);
}

async function downloadAlbum(album, { onFileDownloaded } = {}) {
  const downloadFile = async (url, filename) => {
    await new Promise((resolve, reject) => {
      const worker = new Worker("/downloader.js");
      worker.onmessage = (e) => {
        worker.terminate();
        if (e.data && e.data.error) {
          reject(e.data.error);
        } else {
          resolve(e.data);
        }
      };
      worker.postMessage({
        action: "downloadFile",
        url,
        path: ["albums", album.id],
        filename,
      });
    });
  };

  const toDownload = album.songs.map((song) => [song.file, `song-${song.id}`]);
  toDownload.unshift([album.cover1200, "cover.jpg"]);

  const total = toDownload.length;
  let downloaded = 0;
  for (const [url, filename] of toDownload) {
    await downloadFile(url, filename);
    downloaded++;
    if (onFileDownloaded) {
      onFileDownloaded({
        downloaded,
        total,
      });
    }
  }

  localStorage.setItem(`md:cached:${album.id}`, "true");
}

class PlaylistPlayer {
  constructor() {
    this._currentSong = null;
    this._album = null;
    this._onAlbumUpdateCb = new Set();
    this._onSongUpdateCb = new Set();
    this._onTimeUpdateCb = new Set();
    this._controlsSet = false;
    this._nextButtonSet = false;
    this._prevButtonSet = false;
  }

  getAlbum() {
    return this._album;
  }

  addTimeUpdateListener(cb) {
    this._onTimeUpdateCb.add(cb);
  }

  removeTimeUpdateListener(cb) {
    this._onTimeUpdateCb.delete(cb);
  }

  addSongUpdateListener(cb) {
    this._onSongUpdateCb.add(cb);
  }

  removeSongUpdateListener(cb) {
    this._onSongUpdateCb.delete(cb);
  }

  addAlbumUpdateListener(cb) {
    this._onAlbumUpdateCb.add(cb);
  }

  removeAlbumUpdateListener(cb) {
    this._onAlbumUpdateCb.delete(cb);
  }

  getCurrentSong() {
    return this._currentSong;
  }

  pause() {
    this._currentSong.pause();
    for (const cb of this._onTimeUpdateCb) {
      cb();
    }
  }

  resume() {
    this._currentSong.resume();
  }

  next() {
    if (!this._currentSong) {
      return;
    }
    let i = this.getCurrentSongIndex();
    if (i < this._album.songs.length - 1) {
      i++;
    }
    this.playSong(i);
  }

  prev() {
    if (!this._currentSong) {
      return;
    }
    let i = this.getCurrentSongIndex();
    if (i > 0) {
      i--;
    }
    this.playSong(i);
  }

  getCurrentSongIndex() {
    if (!this._currentSong) {
      return null;
    }

    return this._album.songs.findIndex(
      (s) => s.id === this._currentSong.getId()
    );
  }

  setAlbum(album) {
    this.stop();
    this._album = album;
    for (const cb of this._onAlbumUpdateCb) {
      cb();
    }
  }

  _stopSong() {
    this._currentSong.stop();
    if (this._currentSong.getUrl().startsWith("blob:")) {
      URL.revokeObjectURL(this._currentSong.getUrl());
    }
    this._currentSong = null;
  }

  async deleteAlbum() {
    if (this._currentSong) {
      this._stopSong();
    }
    await deleteAlbum(this._album);
  }

  stop() {
    if (this._currentSong) {
      this._stopSong();
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("stop", null);
      navigator.mediaSession.setActionHandler("seekto", null);
      this._controlsSet = false;
      navigator.mediaSession.setActionHandler("previoustrack", null);
      this._prevButtonSet = false;
      navigator.mediaSession.setActionHandler("nexttrack", null);
      this._nextButtonSet = false;
      for (const cb of this._onSongUpdateCb) {
        cb();
      }
    }
    this._album = null;
    for (const cb of this._onAlbumUpdateCb) {
      cb();
    }
  }

  async playSong(i) {
    const song = this._album.songs[i];

    let url = song.file;
    try {
      const rootDir = await navigator.storage.getDirectory();
      const albumsDir = await rootDir.getDirectoryHandle("albums");
      const albumDir = await albumsDir.getDirectoryHandle(this._album.id);
      const fileHandle = await albumDir.getFileHandle(`song-${song.id}`);
      const file = await fileHandle.getFile();
      url = URL.createObjectURL(new Blob([file], { type: song.fileType }));
    } catch (err) {}

    let promise;
    if (this._currentSong) {
      promise = this._currentSong.replace(song.id, url);
    } else {
      this._currentSong = new AudioPlayer({
        id: song.id,
        url,
        onTimeUpdate: this._onTimeUpdate,
        onEnded: this._onEnded,
      });
      promise = this._currentSong.load();
    }
    for (const cb of this._onSongUpdateCb) {
      cb();
    }

    await promise;

    const isFirstSong = i === 0;
    const isLastSong = i === this._album.songs.length - 1;

    if (!this._controlsSet) {
      navigator.mediaSession.setActionHandler("play", () => {
        this._currentSong.play();
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        this._currentSong.pause();
      });
      navigator.mediaSession.setActionHandler("stop", () => {
        this.stop();
      });
      navigator.mediaSession.setActionHandler("seekto", (obj) => {
        obj.fastSeek = true;
        this._currentSong.setCurrentTime(obj.seekTime);
      });
      this._controlsSet = true;
    }
    if (!this._prevButtonSet && !isFirstSong) {
      navigator.mediaSession.setActionHandler("previoustrack", () => {
        this.prev();
      });
      this._prevButtonSet = true;
    } else if (this._prevButtonSet && isFirstSong) {
      navigator.mediaSession.setActionHandler("previoustrack", null);
      this._prevButtonSet = false;
    }
    if (!this._nextButtonSet && !isLastSong) {
      navigator.mediaSession.setActionHandler("nexttrack", () => {
        this.next();
      });
      this._nextButtonSet = true;
    } else if (this._nextButtonSet && isLastSong) {
      navigator.mediaSession.setActionHandler("nexttrack", null);
      this._nextButtonSet = false;
    }

    if (navigator.mediaSession.metadata) {
      navigator.mediaSession.metadata.title = song.name;
      navigator.mediaSession.metadata.artist = joinArtists(song.artists);
    } else {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.name,
        artist: joinArtists(song.artists),
        album: this._album.title,
        artwork: [{ src: this._album.coverCache || this._album.cover1200 }],
      });
    }

    await this._currentSong.play();
  }

  _onTimeUpdate = () => {
    for (const cb of this._onTimeUpdateCb) {
      cb();
    }
  };

  _onEnded = () => {
    const i = this.getCurrentSongIndex();
    if (this.getCurrentSongIndex() < this._album.songs.length - 1) {
      this.playSong(i + 1);
    } else {
      this._stopSong();
      for (const cb of this._onSongUpdateCb) {
        cb();
      }
    }
  };

  getCurrentTime() {
    if (this._currentSong) {
      return this._currentSong.getCurrentTime();
    }
    return 0;
  }

  getDurationTime() {
    if (this._currentSong) {
      return this._currentSong.getDurationTime();
    }
    return 0;
  }

  setCurrentTime(t) {
    if (this._currentSong) {
      this._currentSong.setCurrentTime(t);
    }
  }
}
const playlistPlayer = new PlaylistPlayer();

const MyAlbumPopup = {
  props: ["album", "autoplay"],
  emits: ["close", "play"],
  setup(props) {
    const discogsUrl = computed(() => {
      const qs = `${props.album.artists[0]} - ${props.album.name}`;
      const q = encodeURIComponent(qs);
      return `https://www.discogs.com/search/?q=${q}&type=master`;
    });
    const musicBrainzUrl = computed(() => {
      const artist = encodeURIComponent(props.album.artists[0]);
      const release = encodeURIComponent(props.album.name);
      return `https://musicbrainz.org/taglookup/index?tag-lookup.artist=${artist}&tag-lookup.release=${release}`;
    });

    const { disks, currentDisk } = props.album.songs.reduce(
      (acc, song, i) => {
        if (song.diskIndex !== acc.currentDisk.index) {
          acc.disks.push(acc.currentDisk);
          acc.currentDisk = { index: song.diskIndex, songs: [] };
        }

        acc.currentDisk.songs.push({
          ...song,
          playerIndex: i,
        });

        return acc;
      },
      { disks: [], currentDisk: { index: 1, songs: [] } }
    );

    disks.push(currentDisk);

    return {
      discogsUrl,
      musicBrainzUrl,
      getSongTags,
      isReviewMode,
      albumTags: computed(() => getAlbumTags(props.album.id)),
      downloadProgress: ref(false),
      deleteProgress: ref(false),
      downloaded: ref(0),
      disks,
      formatDuration,
      joinArtists,
    };
  },
  mounted() {
    document.body.style.overflow = "hidden";
    document.addEventListener("keyup", this.onKeyup);
    playlistPlayer.addTimeUpdateListener(this._onTimeUpdate);
    playlistPlayer.addSongUpdateListener(this._onSongUpdate);
    if (this.album !== playlistPlayer.getAlbum()) {
      playlistPlayer.setAlbum(this.album);
      if (this.autoplay) {
        this.play();
      }
    } else {
      this.scrollToCurrentSong();
    }
  },
  beforeUnmount() {
    document.body.style.overflow = "";
    document.removeEventListener("keyup", this.onKeyup);
    playlistPlayer.removeTimeUpdateListener(this._onTimeUpdate);
    playlistPlayer.removeSongUpdateListener(this._onSongUpdate);
  },
  methods: {
    currentSong() {
      return playlistPlayer.getCurrentSong();
    },
    onKeyup(e) {
      if (e.key === "Escape") {
        this.close();
      }
    },
    play() {
      this.playSong(0);
    },
    pause() {
      playlistPlayer.pause();
    },
    resume() {
      playlistPlayer.resume();
    },
    next() {
      playlistPlayer.next();
    },
    prev() {
      playlistPlayer.prev();
    },
    currentSongIndex() {
      return playlistPlayer.getCurrentSongIndex();
    },
    scrollToCurrentSong() {
      const i = playlistPlayer.getCurrentSongIndex();
      if (i === null) {
        return;
      }

      if (i === 0) {
        this.$el.querySelector(".popup-playlist").scroll(0, 0);
      } else {
        this.$el
          .querySelectorAll(".popup-song")
          [i].scrollIntoView({ block: "nearest" });
      }
    },
    async playSong(i) {
      await playlistPlayer.playSong(i);
      this.$emit("play");
    },
    _onSongUpdate() {
      this.$nextTick(() => {
        this.scrollToCurrentSong();
      });
    },
    _onTimeUpdate() {
      this.$forceUpdate();
    },
    close(e) {
      if (e && e.target !== e.currentTarget) {
        return;
      }
      e.preventDefault();
      this.$emit("close");
    },
    getCurrentTime() {
      return playlistPlayer.getCurrentTime();
    },
    currentTimeLabel() {
      return formatDuration(this.getCurrentTime());
    },
    getDurationTime() {
      return playlistPlayer.getDurationTime();
    },
    durationTimeLabel() {
      return formatDuration(this.getDurationTime());
    },
    setCurrentTime(e) {
      playlistPlayer.setCurrentTime(Number(e.target.value));
    },
    async share() {
      await share(this.album);
    },
    async toggle(i) {
      if (playlistPlayer.getCurrentSongIndex() === i) {
        if (playlistPlayer.getCurrentSong().getStatus() === "paused") {
          playlistPlayer.resume();
        } else {
          playlistPlayer.pause();
        }
      } else {
        playlistPlayer.playSong(i);
      }
    },
    isDownloaded() {
      return !!localStorage.getItem(`md:cached:${this.album.id}`);
    },
    isOnline() {
      return navigator.onLine;
    },
    async downloadAlbum() {
      try {
        this.downloadProgress = true;
        this.downloaded = 0;
        await downloadAlbum(this.album, {
          onFileDownloaded: ({ downloaded, total }) => {
            this.downloaded = downloaded;
          },
        });
      } finally {
        this.downloadProgress = false;
      }
    },
    async deleteAlbum() {
      try {
        this.deleteProgress = true;
        await playlistPlayer.deleteAlbum();
      } finally {
        this.deleteProgress = false;
      }
    },
  },
  template: `
<div class="popup-overlay" @click="close">
  <div class="popup">
    <div class="popup-actions">
      <button v-if="!isReviewMode && isDownloaded()" @click.prevent="deleteAlbum" :class="{'delete-button': true, 'popup-actions-loading': deleteProgress}"></button>
      <button v-if="!isReviewMode && !isDownloaded() && isOnline()" @click.prevent="downloadAlbum" :class="{'download-button': true, 'popup-actions-loading': downloadProgress}"></button>
      <button v-if="!isReviewMode" @click.prevent="share" class="share-button"></button>
      <button @click.prevent="close" class="close-button"></button>
    </div>
    <div class="popup-content">
      <img class="popup-image" :src="album.coverCache || album.cover1200" />
      <div :class="{'popup-player': true, 'popup-player-loading': currentSong() && currentSong().getStatus() === 'loading'}">
        <div class="popup-title">{{album.name}}</div>
        <div class="popup-subtitle">{{joinArtists(album.artists)}} · {{album.year}}<span v-if="downloadProgress"> · Downloading {{downloaded+1}} / {{album.songs.length+1}}</span></div>
        <div class="popup-subtitle"><a :href="discogsUrl" target="_blank">Discogs</a> · <a :href="musicBrainzUrl" target="_blank">MusicBrainz</a></div>
        <div class="popup-tags"><div v-for="tag in albumTags" class="tag">#{{tag}}</div></div>
        <div class="popup-controls">
          <div class="popup-controls-current-time">{{currentTimeLabel()}}</div>
          <div>
            <button @click.prevent="prev()" class="prev-button"></button>
            <button @click.prevent="play()" class="play-button" v-if="!currentSong()"></button>
            <button @click.prevent="resume()" class="play-button" v-if="currentSong() && currentSong().getStatus() === 'paused'"></button>
            <button @click.prevent="pause()" class="pause-button" v-if="currentSong() && currentSong().getStatus() !== 'paused'"></button>
            <button @click.prevent="next()" class="next-button"></button>
          </div>
          <div class="popup-controls-duration-time">{{durationTimeLabel()}}</div>
        </div>
        <div class="popup-range">
          <input type="range" min="0" :max="getDurationTime()" :value="getCurrentTime()" step="1" @input.prevent="setCurrentTime" />
        </div>
      </div>
      <div class="popup-playlist">
        <div v-for="disk in disks">
          <div class="popup-disk-title" v-if="disks.length > 1">Disk {{disk.index}}</div>
          <div v-for="song in disk.songs" :class="{'popup-song': true, 'popup-song-active': currentSongIndex() == song.playerIndex}" @click.prevent="toggle(song.playerIndex)">
            <div class="popup-song-controls">
              <button class="play-button" v-if="currentSongIndex() != song.playerIndex"></button>
              <button class="play-button" v-if="currentSongIndex() == song.playerIndex && currentSong() && currentSong().getStatus() === 'paused'"></button>
              <button class="pause-button" v-if="currentSongIndex() == song.playerIndex && currentSong() && currentSong().getStatus() !== 'paused'"></button>
            </div>
            <div>
              <span class="popup-song-index">{{song.index}}.</span> <span class="popup-song-name">{{joinArtists(song.artists)}} - {{song.name}}</span> <span class="popup-song-duration">{{formatDuration(song.duration)}}</span>
              <span v-for="tag in getSongTags(song.id)" class="tag">#{{tag}}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
  `,
};

const mql = window.matchMedia("(width < 760px)");

function detectImage(album) {
  if (album.coverCache) {
    return album.coverCache;
  }

  if (mql.matches) {
    return album.cover200;
  }

  return album.cover700;
}

const MyAlbum = {
  props: ["album", "isPlaying"],
  emit: ["open"],
  setup(props) {
    const customLazyLoad = browserInfo.isSafari;
    const visible = ref(false);
    const detectedImage = ref(detectImage(props.album));
    const loadingProp = customLazyLoad ? "eager" : "lazy";

    const currentImage = computed(() => {
      if (!customLazyLoad) {
        return detectedImage.value;
      }
      return visible.value ? detectedImage.value : null;
    });

    return {
      albumTags: computed(() => getAlbumTags(props.album.id)),
      loadingProp,
      visible,
      detectedImage,
      currentImage,
      observer: ref(null),
    };
  },
  mounted() {
    this.observer = new IntersectionObserver(
      (entries) => {
        if (!this.visible && entries[0].isIntersecting) {
          this.visible = true;
          this.observer.disconnect();
          this.observer = null;
        }
      },
      {
        rootMargin: "0px 0px 100% 0px",
      }
    );
    this.observer.observe(this.$el);

    mql.addEventListener("change", this._onResize);
  },
  beforeUnmount() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    mql.removeEventListener("change", this._onResize);
  },
  methods: {
    joinArtists,
    _onResize() {
      const newImage = detectImage(this.album);
      if (newImage !== this.detectedImage) {
        this.detectedImage = newImage;
      }
    },
  },
  template: `
<div :class="{'album': true, 'album-playing': isPlaying}" @click.prevent="$emit('open')">
  <div><img :src="currentImage" class="album-cover" :loading="loadingProp" /></div>
  <div class="album-info">
    <div class="album-name" :title="album.name"><span v-if="isPlaying">▶️ </span>{{album.name}}</div>
    <div class="album-artists" :title="joinArtists(album.artists)">{{joinArtists(album.artists)}}</div>
    <div class="album-tags"><div v-for="tag in albumTags" class="tag">#{{tag}}</div></div>
  </div>
</div>
  `,
};

const MyApp = {
  setup() {
    const albums = ref([]);
    const searchString = ref("");

    watchEffect(async () => {
      if (searchString.value === "delete downloads") {
        const toDelete = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key.startsWith("md:cached:")) {
            toDelete.push(key);
          }
        }
        for (const key of toDelete) {
          localStorage.removeItem(key);
        }
        const rootDir = await navigator.storage.getDirectory();
        await rootDir.removeEntry("albums", { recursive: true });
        location.reload();
      }

      if (searchString.value.length === 36) {
        let matches = /key ([0-9a-f]{32})/.exec(searchString.value);
        if (matches) {
          localStorage.setItem("md:apiKey", matches[1]);
          location.reload();
        }
      }
    });

    return {
      joinArtists,
      searchString,
      isReviewMode,
      albums,
      selectedAlbum: ref(null),
      autoplay: ref(false),
      searchFocused: ref(false),
      filteredAlbums: computed(() => {
        const ss = searchString.value.toLowerCase();
        return albums.value.filter((a) => {
          let albumText =
            a.name.toLowerCase() + a.artists.join(" ").toLowerCase();
          if (playlistPlayer.getAlbum() === a) {
            albumText += " playing";
          }
          albumText += getAlbumTags(a.id)
            .map((t) => `#${t}`)
            .join(" ")
            .toLowerCase();

          return albumText.includes(ss);
        });
      }),
    };
  },
  async beforeMount() {
    const apiKey = location.hash.slice(1);
    if (apiKey) {
      localStorage.setItem("md:apiKey", apiKey);
      location.hash = "";
    }

    this.albums = await getAlbums(localStorage.getItem("md:apiKey"));
    if (!isReviewMode) {
      this._sort();
    }

    const u = new URL(location);
    const albumId = u.searchParams.get("album");
    if (albumId) {
      this._openAlbum(this.albums.find((a) => a.id === albumId));
    }
  },
  mounted() {
    playlistPlayer.addAlbumUpdateListener(() => {
      this.$forceUpdate();
    });
    window.addEventListener("keyup", (e) => {
      if (e.code !== "Space") {
        return;
      }
      const song = playlistPlayer.getCurrentSong();
      if (!song) {
        return;
      }
      if (song.getStatus() === "paused") {
        playlistPlayer.resume();
      } else {
        playlistPlayer.pause();
      }
    });
    window.addEventListener("popstate", (e) => {
      if (e.state && e.state.albumId) {
        this._openAlbum(this.albums.find((a) => a.id === e.state.albumId));
      } else {
        this._closeAlbum(false);
      }
    });
    if (isReviewMode) {
      window.addEventListener("keyup", (e) => {
        if (e.code === "Space") {
          const song = playlistPlayer.getCurrentSong();
          if (!song) {
            return;
          }
          if (song.getStatus() === "paused") {
            playlistPlayer.resume();
          } else {
            playlistPlayer.pause();
          }
        }
        if (e.code === "ArrowLeft") {
          const i = this.albums.indexOf(this.selectedAlbum);
          if (i > 0) {
            const prevAlbum = this.albums[i - 1];
            this.openAlbum(prevAlbum);
          }
        }
        if (e.code === "ArrowRight") {
          const i = this.albums.indexOf(this.selectedAlbum);
          if (i < this.albums.length - 1) {
            const nextAlbum = this.albums[i + 1];
            this.openAlbum(nextAlbum);
          }
        }
        if (e.code === "ArrowDown") {
          playlistPlayer.next();
        }
        if (e.code === "ArrowUp") {
          playlistPlayer.prev();
        }
        if (e.code === "BracketRight") {
          if (playlistPlayer.getCurrentTime() !== null) {
            playlistPlayer.setCurrentTime(
              Math.min(
                playlistPlayer.getCurrentTime() + 10,
                playlistPlayer.getDurationTime()
              )
            );
          }
        }
        if (e.code === "BracketLeft") {
          if (playlistPlayer.getCurrentTime() !== null) {
            playlistPlayer.setCurrentTime(
              Math.max(0, playlistPlayer.getCurrentTime() - 10)
            );
          }
        }
        if (e.code.startsWith("Digit")) {
          if (playlistPlayer.getCurrentTime() !== null) {
            let part = e.key == "0" ? 9 : Number(e.key) - 1;
            playlistPlayer.setCurrentTime(
              (playlistPlayer.getDurationTime() / 9) * part
            );
          }
        }
        if (e.key in tagsMapping) {
          const [type, tag] = tagsMapping[e.key].split(":");
          if (type === "album" && this.selectedAlbum) {
            toggleAlbumTag(this.selectedAlbum.id, tag);
          }
          if (type === "song" && playlistPlayer.getCurrentSong()) {
            toggleSongTag(playlistPlayer.getCurrentSong().getId(), tag);
          }
        }
      });
    }
  },
  methods: {
    _openAlbum(album) {
      this.selectedAlbum = album;
    },
    openAlbum(album) {
      this.autoplay = true;
      this._openAlbum(album);
      history.pushState({ albumId: album.id }, "", `/?album=${album.id}`);
    },
    _closeAlbum() {
      this.selectedAlbum = null;
    },
    closeAlbum() {
      this._closeAlbum();
      history.pushState({}, "", `/`);
    },
    played() {
      this.autoplay = true;
    },
    async share() {
      await share();
    },
    isSomethingPlaying() {
      return !!playlistPlayer.getAlbum();
    },
    openCurrentAlbum() {
      this.selectedAlbum = playlistPlayer.getAlbum();
    },
    isPlaying(album) {
      return playlistPlayer.getAlbum() === album;
    },
    refresh() {
      this._sort();
      window.scrollTo(0, 0);
    },
    onFocus() {
      this.searchFocused = window.innerWidth < 500;
    },
    onBlur() {
      this.searchFocused = false;
    },
    _sort() {
      this.albums.sort((a, b) => {
        let aScore = Math.random();
        let bScore = Math.random();

        if (!navigator.onLine) {
          if (localStorage.getItem(`md:cached:${a.id}`)) {
            aScore += 1;
          }
          if (localStorage.getItem(`md:cached:${b.id}`)) {
            bScore += 1;
          }
        }

        return bScore - aScore;
      });
    },
  },
  template: `
<header class="header">
  <h1>vslinko's music</h1>
  <input type="search" v-model="searchString" @focus="onFocus" @blur="onBlur" placeholder="Search" />
  <div class="header-buttons" v-if="!searchFocused && !isReviewMode">
    <button @click.prevent="openCurrentAlbum" class="playing-button" v-if="isSomethingPlaying()"></button>
    <button @click.prevent="share" class="share-button"></button>
    <button @click.prevent="refresh" class="refresh-button"></button>
  </div>
</header>
<div class="albums">
  <my-album v-for="album in filteredAlbums" :key="album.id" :album="album" :isPlaying="isPlaying(album)" @open="openAlbum(album)" />
</div>
<my-album-popup v-if="selectedAlbum" :key="selectedAlbum.id" :autoplay="autoplay" @play="played()" :album="selectedAlbum" @close="closeAlbum()" />
`,
};

const app = createApp();
app.component("my-album-popup", MyAlbumPopup);
app.component("my-album", MyAlbum);
app.component("my-app", MyApp);
app.mount("body");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", {
    scope: "/",
  });
}
