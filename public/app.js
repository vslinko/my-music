import { ref, createApp, computed } from "vue";

async function getAlbums(apiKey) {
  const res = await fetch(`/data/albums.json?apiKey=${apiKey}`);
  const data = await res.json();
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
  shareUrl.hash = localStorage.getItem("apiKey");

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
  constructor({ url, onTimeUpdate, onEnded }) {
    this._status = AudioPlayerStatus.new;
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

  async play() {
    switch (this._status) {
      case AudioPlayerStatus.new:
      case AudioPlayerStatus.loading:
        await this._load();
        await this.play();
        break;
      case AudioPlayerStatus.loaded:
      case AudioPlayerStatus.startingPlayer:
      case AudioPlayerStatus.paused:
        await this._play();
        break;
      case AudioPlayerStatus.playing:
      case AudioPlayerStatus.stopped:
      case AudioPlayerStatus.error:
        break;
    }
  }

  pause() {
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
  }

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

  async replace(url) {
    switch (this._status) {
      case AudioPlayerStatus.startingPlayer:
      case AudioPlayerStatus.playing:
      case AudioPlayerStatus.paused:
      case AudioPlayerStatus.new:
      case AudioPlayerStatus.loading:
      case AudioPlayerStatus.loaded:
        await this._replace(url);
        break;
      case AudioPlayerStatus.stopped:
      case AudioPlayerStatus.error:
        break;
    }
  }

  // workers
  async _replace(url) {
    this._status = AudioPlayerStatus.new;
    this._url = url;
    await this._load();
  }

  _stop() {
    this._cleanup();
    this._status = AudioPlayerStatus.stopped;
  }

  async _load() {
    if (!this._loadingPromise) {
      if (!this._el) {
        this._el = new Audio(this._url);
        this._el.addEventListener("timeupdate", this._onTimeUpdate);
        this._el.addEventListener("ended", this._onEnded);
      } else {
        this._el.src = this._url;
      }
      this._status = AudioPlayerStatus.loading;
      this._loadingPromise = new Promise((resolve) => {
        const el = this._el;
        const cb = () => {
          el.removeEventListener("loadeddata", cb);
          if (this._status === AudioPlayerStatus.stopped) {
            return;
          }
          this._status = AudioPlayerStatus.loaded;
          this._loadingPromise = null;
          resolve();
        };
        el.addEventListener("loadeddata", cb);
        el.load();
      });
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
        })
        .catch((err) => {
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
  }

  _cleanup() {
    this._el.removeEventListener("timeupdate", this._onTimeUpdate);
    this._el.removeEventListener("ended", this._onEnded);
    this._el = null;
    this._onTimeUpdate = null;
    this._onEnded = null;
    this._playPromise = null;
    this._loadingPromise = null;
  }
}

class PlaylistPlayer {
  constructor() {
    this._currentSong = null;
    this._album = null;
    this._onAlbumUpdateCb = new Set();
    this._onSongUpdateCb = new Set();
    this._onTimeUpdateCb = new Set();
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
      (s) => s.file === this._currentSong.getUrl()
    );
  }

  setAlbum(album) {
    this.stop();
    this._album = album;
    for (const cb of this._onAlbumUpdateCb) {
      cb();
    }
  }

  stop() {
    if (this._currentSong) {
      this._currentSong.stop();
      this._currentSong = null;
      navigator.mediaSession.metadata = null;
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

    if (this._currentSong) {
      this._currentSong.stop();
    }

    this._currentSong = new AudioPlayer({
      url: song.file,
      onTimeUpdate: this._onTimeUpdate,
      onEnded: this._onEnded,
    });
    for (const cb of this._onSongUpdateCb) {
      cb();
    }

    await this._currentSong.play();

    const isFirstSong = i === 0;
    const isLastSong = i === this._album.songs.length - 1;

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
    navigator.mediaSession.setActionHandler(
      "previoustrack",
      isFirstSong
        ? null
        : () => {
            this.prev();
          }
    );
    navigator.mediaSession.setActionHandler(
      "nexttrack",
      isLastSong
        ? null
        : () => {
            this.next();
          }
    );

    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.name,
      artist: joinArtists(song.artists),
      album: this._album.title,
      artwork: [{ src: this._album.cover }],
    });
  }

  _onTimeUpdate = () => {
    navigator.mediaSession.setPositionState({
      duration: this._currentSong.getDurationTime(),
      playbackRate: 1,
      position: this._currentSong.getCurrentTime(),
    });
    for (const cb of this._onTimeUpdateCb) {
      cb();
    }
  };

  _onEnded = () => {
    const i = this.getCurrentSongIndex();
    if (this.getCurrentSongIndex() < this._album.songs.length - 1) {
      this.playSong(i + 1);
    } else {
      this._currentSong.stop();
      this._currentSong = null;
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
      this.scrollTo(playlistPlayer.getCurrentSongIndex());
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
    scrollTo(i) {
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
        this.scrollTo(playlistPlayer.getCurrentSongIndex());
      });
    },
    _onTimeUpdate() {
      this.$forceUpdate();
    },
    close(e) {
      if (e && e.target !== e.currentTarget) {
        return;
      }
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
  },
  template: `
<div class="popup-overlay" @click.prevent="close">
  <div class="popup">
    <div class="popup-actions">
      <button @click.prevent="share" class="share-button"></button>
      <button @click.prevent="close" class="close-button"></button>
    </div>
    <div class="popup-content">
      <img class="popup-image" :src="album.cover" />
      <div :class="{'popup-player': true, 'popup-player-loading': currentSong() && currentSong().getStatus() === 'loading'}">
        <div class="popup-title">{{album.name}}</div>
        <div class="popup-subtitle">{{joinArtists(album.artists)}} · {{album.year}}</div>
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
          <div v-for="song in disk.songs" :class="{'popup-song': true, 'popup-song-active': currentSongIndex() == song.playerIndex}">
            <div class="popup-song-controls">
              <button @click.prevent="playSong(song.playerIndex)" class="play-button" v-if="currentSongIndex() != song.playerIndex"></button>
              <button @click.prevent="resume()" class="play-button" v-if="currentSongIndex() == song.playerIndex && currentSong() && currentSong().getStatus() === 'paused'"></button>
              <button @click.prevent="pause()" class="pause-button" v-if="currentSongIndex() == song.playerIndex && currentSong() && currentSong().getStatus() !== 'paused'"></button>
            </div>
            <div><span class="popup-song-index">{{song.index}}.</span> <span class="popup-song-name">{{joinArtists(song.artists)}} - {{song.name}}</span> <span class="popup-song-duration">{{formatDuration(song.duration)}}</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
  `,
};

const MyAlbum = {
  props: ["album", "isPlaying"],
  emit: ["open"],
  methods: {
    joinArtists,
  },
  template: `
<div :class="{'album': true, 'album-playing': isPlaying}" @click.prevent="$emit('open')">
  <div><img :src="album.cover" class="album-cover" loading="lazy" /></div>
  <div class="album-info">
    <div class="album-name" :title="album.name"><span v-if="isPlaying">► </span>{{album.name}}</div>
    <div class="album-artists" :title="joinArtists(album.artists)">{{joinArtists(album.artists)}}</div>
  </div>
</div>
  `,
};

const MyApp = {
  setup() {
    const albums = ref([]);
    const searchString = ref("");

    return {
      joinArtists,
      searchString,
      albums,
      selectedAlbum: ref(null),
      autoplay: ref(false),
      filteredAlbums: computed(() => {
        const ss = searchString.value.toLowerCase();
        return albums.value.filter((a) => {
          let albumText =
            a.name.toLowerCase() + a.artists.join(" ").toLowerCase();
          if (playlistPlayer.getAlbum() === a) {
            albumText += "playing";
          }

          return albumText.includes(ss);
        });
      }),
    };
  },
  async beforeMount() {
    const apiKey = location.hash.slice(1);
    if (apiKey) {
      localStorage.setItem("apiKey", apiKey);
      location.hash = "";
    }

    this.albums = await getAlbums(localStorage.getItem("apiKey"));
    this.albums.sort(() => Math.random() - 0.5);

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
    window.addEventListener("popstate", (e) => {
      if (e.state && e.state.albumId) {
        this._openAlbum(this.albums.find((a) => a.id === e.state.albumId));
      } else {
        this._closeAlbum(false);
      }
    });
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
    isPlaying(album) {
      return playlistPlayer.getAlbum() === album;
    },
  },
  template: `
<header class="header">
  <h1>vslinko's music</h1>
  <input type="search" v-model="searchString" placeholder="Search" />
  <button @click.prevent="share" class="share-button"></button>
</header>
<div class="albums">
  <my-album v-for="album in filteredAlbums" :key="album.id" :album="album" :isPlaying="isPlaying(album)" @open="openAlbum(album)" />
</div>
<my-album-popup v-if="selectedAlbum" :autoplay="autoplay" @play="played()" :album="selectedAlbum" @close="closeAlbum()" />
`,
};

const app = createApp();
app.component("my-album-popup", MyAlbumPopup);
app.component("my-album", MyAlbum);
app.component("my-app", MyApp);
app.mount("body");
