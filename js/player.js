class MultiTrackSong {
  constructor(button) {
    this.button = button;
    this.title = button.dataset.audio_title || 'Song';
    this.looped = button.dataset.looped === 'true';
    this.tempo = parseFloat(button.dataset.tempo) || 120;
    this.duration = parseFloat(button.dataset.duration) || 0;
    this.tracks = [];
    this.countIn = null;

    // collect track names from dataset
    const ignore = ['audio_title', 'tempo', 'duration', 'looped', 'count_in'];
    Object.keys(button.dataset).forEach(key => {
      if (!ignore.includes(key)) {
        this.tracks.push({ name: key, url: button.dataset[key] + '.mp3' });
      }
    });
    if (button.dataset.count_in) {
      this.countIn = { url: button.dataset.count_in + '.mp3' };
    }
  }
}

class GLPlayer {
  constructor(container) {
    this.container = container;
    this.playlistButtons = Array.from(container.querySelectorAll('.playlist button'));
    this.currentIndex = this.playlistButtons.findIndex(btn => btn.classList.contains('current-audio')) || 0;
    this.playBtn = container.querySelector('.play');
    this.backBtn = container.querySelector('.back');
    this.forwardBtn = container.querySelector('.forward');
    this.scrub = container.querySelector('.scrub');
    this.timeDisplay = container.querySelector('.time');
    this.bpmDisplay = container.querySelector('.bpm-value');
    this.tempoControl = container.querySelector('.tempo');
    this.trackVolumeContainer = container.querySelector('.track-volumes');

    this.songs = this.playlistButtons.map(btn => new MultiTrackSong(btn));
    this.players = [];
    this.isPlaying = false;
    this.startTime = 0;
    this.offset = 0;

    this.playBtn.addEventListener('click', () => this.toggle());
    this.backBtn.addEventListener('click', () => this.restart());
    this.forwardBtn.addEventListener('click', () => this.next());
    this.scrub.addEventListener('input', () => this.scrubTo());
    this.tempoControl.addEventListener('input', () => this.changeTempo());

    this.loadSong(this.currentIndex);
  }

  loadSong(index) {
    this.currentIndex = index;
    this.cleanup();
    const song = this.songs[index];
    this.bpmDisplay.textContent = song.tempo;
    this.tempoControl.value = song.tempo;
    this.trackVolumeContainer.innerHTML = '';

    const volumeNodes = [];
    this.players = [];
    if (song.countIn) {
      const player = new Tone.Player({ url: song.countIn.url, loop: song.looped }).toDestination();
      player.autostart = false;
      this.countInPlayer = player;
    } else {
      this.countInPlayer = null;
    }

    song.tracks.forEach(track => {
      const vol = new Tone.Volume(0);
      vol.toDestination();
      const player = new Tone.Player({ url: track.url, loop: song.looped }).connect(vol);
      player.autostart = false;
      this.players.push({ player, vol });

      const wrapper = document.createElement('div');
      wrapper.className = 'track-volume';
      const label = document.createElement('label');
      label.textContent = track.name;
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = -60;
      slider.max = 6;
      slider.value = 0;
      slider.addEventListener('input', () => {
        vol.volume.value = slider.value;
      });
      wrapper.appendChild(label);
      wrapper.appendChild(slider);
      this.trackVolumeContainer.appendChild(wrapper);
    });
  }

  cleanup() {
    if (this.countInPlayer) {
      this.countInPlayer.dispose();
      this.countInPlayer = null;
    }
    this.players.forEach(p => p.player.dispose());
    this.players = [];
    Tone.Transport.stop();
    Tone.Transport.cancel();
    this.isPlaying = false;
    this.playBtn.textContent = 'Play';
    this.scrub.value = 0;
    this.timeDisplay.textContent = '00:00';
  }

  startSong() {
    const song = this.songs[this.currentIndex];
    const tempoFactor = this.tempoControl.value / song.tempo;

    this.players.forEach(p => {
      p.player.playbackRate = tempoFactor;
    });
    if (this.countInPlayer) {
      this.countInPlayer.playbackRate = tempoFactor;
    }

    Tone.Transport.bpm.value = this.tempoControl.value;
    let startOffset = 0;
    if (this.countInPlayer) {
      startOffset = this.countInPlayer.buffer.duration / this.countInPlayer.playbackRate;
      this.countInPlayer.start(0);
    }
    this.players.forEach(p => {
      p.player.start(startOffset);
    });

    if (song.looped) {
      const loopTime = song.duration * tempoFactor + startOffset;
      Tone.Transport.scheduleRepeat(() => {
        this.players.forEach(p => p.player.start(startOffset));
        if (this.countInPlayer) {
          this.countInPlayer.start(0);
        }
      }, loopTime);
    }

    Tone.Transport.start();
    this.startTime = Tone.now();
    this.offset = startOffset;
    requestAnimationFrame(() => this.update());
    this.isPlaying = true;
    this.playBtn.textContent = 'Pause';
  }

  toggle() {
    if (this.isPlaying) {
      Tone.Transport.pause();
      this.players.forEach(p => p.player.pause());
      if (this.countInPlayer) this.countInPlayer.pause();
      this.isPlaying = false;
      this.playBtn.textContent = 'Play';
    } else {
      if (Tone.Transport.state === 'stopped') {
        this.startSong();
      } else {
        Tone.Transport.start();
        this.players.forEach(p => p.player.start());
        if (this.countInPlayer) this.countInPlayer.start();
        this.isPlaying = true;
        this.playBtn.textContent = 'Pause';
        requestAnimationFrame(() => this.update());
      }
    }
  }

  restart() {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    this.startSong();
  }

  next() {
    const nextIndex = (this.currentIndex + 1) % this.songs.length;
    this.loadSong(nextIndex);
    this.startSong();
  }

  formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  scrubTo() {
    const song = this.songs[this.currentIndex];
    const tempoFactor = this.tempoControl.value / song.tempo;
    const position = (this.scrub.value / 100) * song.duration * tempoFactor + this.offset;
    Tone.Transport.seconds = position;
    this.players.forEach(p => p.player.stop());
    if (this.countInPlayer) this.countInPlayer.stop();
    this.players.forEach(p => p.player.start('+0'));
  }

  update() {
    if (!this.isPlaying) return;
    const position = Tone.Transport.seconds - this.offset;
    const song = this.songs[this.currentIndex];
    const tempoFactor = this.tempoControl.value / song.tempo;
    const duration = song.duration * tempoFactor;
    this.timeDisplay.textContent = this.formatTime(position);
    this.scrub.value = Math.min(100, (position / duration) * 100);
    requestAnimationFrame(() => this.update());
  }

  changeTempo() {
    if (!this.isPlaying) return;
    const song = this.songs[this.currentIndex];
    const tempoFactor = this.tempoControl.value / song.tempo;
    this.players.forEach(p => {
      p.player.playbackRate = tempoFactor;
    });
    if (this.countInPlayer) this.countInPlayer.playbackRate = tempoFactor;
    Tone.Transport.bpm.value = this.tempoControl.value;
  }
}

document.querySelectorAll('.gl-player').forEach(container => new GLPlayer(container));
