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

let currentSong = null;

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
    if (this.autoplay) {
      this.play();
    }
  },
  beforeUnmount() {
    document.body.style.overflow = "";
    document.removeEventListener("keyup", this.onKeyup);
  },
  methods: {
    currentSong() {
      return currentSong;
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
      currentSong.pause();
    },
    resume() {
      currentSong.resume();
    },
    next() {
      if (!currentSong) {
        return;
      }
      let i = this.currentSongIndex();
      if (i < this.album.songs.length - 1) {
        i++;
      }
      this.playSong(i);
    },
    prev() {
      if (!currentSong) {
        return;
      }
      let i = this.currentSongIndex();
      if (i > 0) {
        i--;
      }
      this.playSong(i);
    },
    currentSongIndex() {
      if (!currentSong) {
        return null;
      }
      return this.album.songs.findIndex((s) => s.file === currentSong.getUrl());
    },
    async playSong(i) {
      const song = this.album.songs[i];
      if (currentSong) {
        currentSong.stop();
      }

      currentSong = new AudioPlayer({
        url: song.file,
        onTimeUpdate: this.onTimeUpdate,
        onEnded: this.onEnded,
      });
      this.$forceUpdate();

      setTimeout(() => {
        if (i === 0) {
          this.$el.querySelector(".popup-playlist").scroll(0, 0);
        } else {
          this.$el
            .querySelectorAll(".popup-song")
            [i].scrollIntoView({ block: "nearest" });
        }
      }, 0);

      await currentSong.play();
      this.$emit("play");

      const isFirstSong = i === 0;
      const isLastSong = i === this.album.songs.length - 1;

      navigator.mediaSession.setActionHandler("play", () => {
        currentSong.play();
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        currentSong.pause();
      });
      navigator.mediaSession.setActionHandler("stop", () => {
        this.close();
      });
      navigator.mediaSession.setActionHandler("seekto", (obj) => {
        obj.fastSeek = true;
        currentSong.setCurrentTime(obj.seekTime);
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
        album: this.album.title,
        artwork: [{ src: this.album.cover }],
      });
    },
    onTimeUpdate() {
      navigator.mediaSession.setPositionState({
        duration: currentSong.getDurationTime(),
        playbackRate: 1,
        position: currentSong.getCurrentTime(),
      });
      this.$forceUpdate();
    },
    onEnded() {
      const i = this.currentSongIndex();
      if (this.currentSongIndex() < this.album.songs.length - 1) {
        this.playSong(i + 1);
      } else {
        currentSong.stop();
        currentSong = null;
      }
    },
    close(e) {
      if (e && e.target !== e.currentTarget) {
        return;
      }
      this.$emit("close");
    },
    getCurrentTime() {
      if (currentSong) {
        return currentSong.getCurrentTime();
      }
      return 0;
    },
    currentTimeLabel() {
      return formatDuration(this.getCurrentTime());
    },
    getDurationTime() {
      if (currentSong) {
        return currentSong.getDurationTime();
      }
      return 0;
    },
    durationTimeLabel() {
      return formatDuration(this.getDurationTime());
    },
    playedPercent() {
      if (!currentSong) {
        return 0;
      }
      const b = currentSong.getDurationTime();
      if (b == 0) {
        return 0;
      }
      const a = currentSong.getCurrentTime();
      return a / b;
    },
    setCurrentTime(e) {
      if (currentSong) {
        currentSong.setCurrentTime(Number(e.target.value));
      }
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
          return (
            a.name.toLowerCase().includes(ss) ||
            a.artists.some((aa) => aa.toLowerCase().includes(ss))
          );
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
      if (currentSong) {
        currentSong.stop();
        currentSong = null;
        navigator.mediaSession.metadata = null;
      }
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
  },
  template: `
<header class="header">
  <h1>vslinko's music</h1>
  <input type="search" v-model="searchString" placeholder="Search" />
  <button @click.prevent="share" class="share-button"></button>
</header>
<div class="albums">
  <div v-for="album in filteredAlbums" :key="album.id" class="album" @click.prevent="openAlbum(album)">
    <div><img :src="album.cover" class="album-cover" loading="lazy" /></div>
    <div class="album-info">
      <div class="album-name" :title="album.name">{{album.name}}</div>
      <div class="album-artists" :title="joinArtists(album.artists)">{{joinArtists(album.artists)}}</div>
    </div>
  </div>
</div>
<my-album-popup v-if="selectedAlbum" :autoplay="autoplay" @play="played()" :album="selectedAlbum" @close="closeAlbum()" />
`,
};

const app = createApp();
app.component("my-album-popup", MyAlbumPopup);
app.component("my-app", MyApp);
app.mount("body");
