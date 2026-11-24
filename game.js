"use strict";
/* ============================================================
   ULAR TANGGA 3D - game ular tangga prosedural (Three.js + WebAudio)
   Semua model digambar dengan kode, semua suara disintesis.
   ============================================================ */

// ---------- Util ----------
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

// ---------- Karakter ----------
const CHARACTERS = [
  { id: "kucing", name: "Kucing", color: 0xf5852a, css: "#f5852a" },
  { id: "beruang", name: "Beruang", color: 0x8a5a33, css: "#8a5a33" },
  { id: "kelinci", name: "Kelinci", color: 0xf2f2f2, css: "#e8e8e8" },
  { id: "bebek", name: "Bebek", color: 0xffd23e, css: "#ffd23e" },
  { id: "kodok", name: "Kodok", color: 0x3fae5a, css: "#3fae5a" },
  { id: "robot", name: "Robot", color: 0x9fb4c8, css: "#9fb4c8" },
];
const AI_NAMES = ["Komputer 1", "Komputer 2", "Komputer 3"];

// ---------- Layout papan ----------
const LAYOUTS = {
  mudah: {
    ladders: { 3: 22, 8: 26, 20: 29, 36: 44, 51: 72, 71: 92, 80: 99 },
    snakes: { 27: 5, 40: 17, 54: 31, 66: 45, 76: 58, 89: 53 },
  },
  normal: {
    ladders: { 4: 14, 9: 31, 21: 42, 28: 84, 51: 67, 71: 91, 80: 99 },
    snakes: { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 },
  },
  kacau: {
    ladders: { 6: 16, 15: 34, 29: 74, 38: 59, 61: 78, 72: 93 },
    snakes: { 17: 7, 26: 13, 44: 22, 52: 29, 68: 46, 77: 35, 83: 19, 90: 48, 94: 66, 97: 57, 99: 80 },
  },
};
function genAcak(seed) {
  const rng = mulberry32(seed);
  const used = new Set([1, 100]);
  const ladders = {}, snakes = {};
  const free = [];
  for (let i = 2; i <= 99; i++) free.push(i);
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  let li = 0;
  for (const s of free) {
    if (li >= 7) break;
    if (used.has(s) || s > 88) continue;
    const span = Math.min(38, 99 - s);
    const top = s + 8 + Math.floor(rng() * (span - 8 + 1));
    if (used.has(top)) continue;
    ladders[s] = top; used.add(s); li++;
  }
  let si = 0;
  for (const s of free) {
    if (si >= 8) break;
    if (used.has(s) || s < 14) continue;
    const tail = Math.max(2, s - 8 - Math.floor(rng() * Math.min(40, s - 3)));
    if (used.has(tail) && tail !== s) { /* ekor boleh menimpa petak bebas lain */ }
    snakes[s] = tail; used.add(s); si++;
  }
  // cegah siklus ular-tangga: resolusi setiap petak harus berhenti
  const findCycleFrom = () => {
    for (let n = 2; n <= 99; n++) {
      const seen = new Set();
      let cur = n;
      while (ladders[cur] || snakes[cur]) {
        if (seen.has(cur)) return cur;
        seen.add(cur);
        cur = ladders[cur] || snakes[cur];
      }
    }
    return 0;
  };
  let bad = 0, guard2 = 0;
  while ((bad = findCycleFrom()) && guard2++ < 30) {
    if (snakes[bad]) delete snakes[bad];
    else if (ladders[bad]) delete ladders[bad];
    else break;
  }
  return { ladders, snakes };
}

// ---------- Pengaturan ----------
const settings = Object.assign(
  { music: 0.55, sfx: 0.9, quality: "auto", fastAI: false, muted: false },
  JSON.parse(localStorage.getItem("ulartangga-settings") || "{}")
);
function saveSettings() {
  localStorage.setItem("ulartangga-settings", JSON.stringify(settings));
}

// ---------- Audio (WebAudio, semua disintesis) ----------
const AudioSys = {
  ctx: null, musicGain: null, sfxGain: null, songTimer: null, songStep: 0,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    const comp = this.ctx.createDynamicsCompressor();
    this.musicGain.connect(comp); this.sfxGain.connect(comp);
    comp.connect(this.ctx.destination);
    this.applyVolumes();
  },
  applyVolumes() {
    if (!this.ctx) return;
    const m = settings.muted ? 0 : settings.music * 0.5;
    const s = settings.muted ? 0 : settings.sfx;
    this.musicGain.gain.value = m;
    this.sfxGain.gain.value = s;
  },
  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
  tone(freq, t0, dur, type, gain, dest, slideTo) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.2, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || this.sfxGain);
    o.start(t0); o.stop(t0 + dur + 0.05);
  },
  noise(t0, dur, gain, freq) {
    if (!this.ctx) return;
    const len = Math.max(1, (dur * this.ctx.sampleRate) | 0);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq || 1200; f.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain || 0.15, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.sfxGain);
    src.start(t0);
  },
  // --- SFX ---
  click() { if (this.ctx) this.tone(660, this.ctx.currentTime, 0.07, "triangle", 0.15); },
  diceRoll() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 7; i++) this.noise(t + i * 0.09 + Math.random() * 0.02, 0.05, 0.12, 900 + Math.random() * 900);
    this.noise(t + 0.68, 0.09, 0.2, 500);
  },
  step() { if (this.ctx) this.tone(rand(480, 560), this.ctx.currentTime, 0.06, "triangle", 0.08); },
  perfect() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [880, 1108, 1318, 1760].forEach((f, i) => this.tone(f, t + i * 0.06, 0.16, "sine", 0.16));
  },
  overcharge() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(220, t, 0.35, "sawtooth", 0.12, this.sfxGain, 55);
    this.noise(t, 0.25, 0.1, 300);
  },
  ladderUp() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 9; i++) this.tone(523 * Math.pow(1.059, i * 1.4), t + i * 0.055, 0.14, "sine", 0.14);
  },
  snakeDown() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(900, t, 0.65, "sine", 0.16, this.sfxGain, 160);
    this.tone(905, t + 0.03, 0.6, "triangle", 0.07, this.sfxGain, 170);
  },
  win() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => this.tone(f, t + i * 0.13, 0.24, "triangle", 0.2));
  },
  // --- Musik: sequencer dua lagu orisinal sederhana ---
  SONGS: {
    // Bahtera: melodi pelaut 6/8, tangga nada mayor pentatonik (midi)
    bahtera: {
      bpm: 132, wave: "triangle", bassWave: "sine",
      melody: [72, -1, 76, 79, -1, 76, 81, -1, 79, 76, -1, 72, 74, -1, 71, 72, -1, -1,
               72, -1, 76, 79, -1, 76, 81, -1, 84, 81, -1, 79, 76, -1, 74, 71, -1, -1],
      bass: [48, -1, 55, 43, -1, 50, 45, -1, 52, 48, -1, 55, 43, -1, 50, 47, -1, 55],
    },
    // Orbit: arpeggio synth-pop minor
    orbit: {
      bpm: 104, wave: "square", bassWave: "sawtooth",
      melody: [69, -1, 72, 76, -1, 74, 72, -1, 69, -1, 65, 69, -1, 67, 64, -1,
               69, -1, 72, 76, -1, 79, 76, -1, 74, -1, 72, 71, -1, 69, -1, -1],
      bass: [45, -1, -1, 45, -1, -1, 41, -1, 43, -1, -1, 43, -1, -1, 40, -1],
    },
  },
  midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); },
  startSong(theme) {
    this.stopSong();
    if (!this.ctx) return;
    const song = this.SONGS[theme] || this.SONGS.bahtera;
    const stepDur = 60 / song.bpm / 2; // langkah seperdelapan
    this.songStep = 0;
    const tick = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + 0.06;
      const i = this.songStep % song.melody.length;
      const m = song.melody[i];
      if (m > 0) this.tone(this.midiHz(m), t, stepDur * 1.7, song.wave, 0.11, this.musicGain);
      const b = song.bass[this.songStep % song.bass.length];
      if (b > 0) this.tone(this.midiHz(b), t, stepDur * 1.9, song.bassWave, 0.07, this.musicGain);
      this.songStep++;
    };
    tick();
    this.songTimer = setInterval(tick, stepDur * 1000);
  },
  stopSong() { if (this.songTimer) { clearInterval(this.songTimer); this.songTimer = null; } },
};

// ---------- State game ----------
const G = {
  theme: "bahtera",
  mode: "ai",
  boardKind: "normal",
  layout: null,
  rules: { six: true, threeSix: true, bounce: true },
  players: [],        // {name, char, isAI, pos, sixStreak, group}
  current: 0,
  busy: false,
  started: false,
  paused: false,
  seed: (Math.random() * 1e9) | 0,
};

// ============================================================
//  THREE.JS - SCENE, PAPAN, BIDAK, DADU, KAMERA
// ============================================================
const TILE = 1, HALF = 4.5;
function squarePos(n) {
  const idx = n - 1;
  const row = Math.floor(idx / 10);
  let col = idx % 10;
  if (row % 2 === 1) col = 9 - col;
  return new THREE.Vector3(col - HALF, 0.09, HALF - row);
}
function tileColor(theme, row, col) {
  const even = (row + col) % 2 === 0;
  if (theme === "orbit") return even ? "#232c52" : "#1a2142";
  return even ? "#f6e3b4" : "#edcf92";
}
function makeTileTexture(n, row, col, theme) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = tileColor(theme, row, col); g.fillRect(0, 0, 128, 128);
  g.strokeStyle = theme === "orbit" ? "rgba(90,200,255,.55)" : "rgba(124,79,39,.35)";
  g.lineWidth = 5; g.strokeRect(3, 3, 122, 122);
  g.fillStyle = theme === "orbit" ? "#aee2ff" : "#7c4f27";
  g.font = "bold 40px Arial";
  g.shadowColor = theme === "orbit" ? "#38b6ff" : "transparent";
  g.shadowBlur = theme === "orbit" ? 12 : 0;
  g.fillText(String(n), 10, 44);
  if (n === 100) { g.font = "bold 30px Arial"; g.fillText("FINISH", 8, 112); }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}
function makeStripeTexture(c1, c2) {
  const c = document.createElement("canvas"); c.width = 128; c.height = 32;
  const g = c.getContext("2d");
  g.fillStyle = c1; g.fillRect(0, 0, 128, 32);
  g.fillStyle = c2;
  for (let x = -32; x < 128; x += 42) {
    g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 20, 0); g.lineTo(x + 36, 0); g.lineTo(x + 16, 32); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(7, 1);
  return tex;
}
function cylinderBetween(p1, p2, r, mat) {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
  mesh.position.copy(p1).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true;
  return mesh;
}

// ---------- Tween ----------
const tweens = [];
function tween(dur, update, ease) {
  return new Promise((res) => {
    tweens.push({ t: 0, dur, update, ease: ease || ((k) => k), res });
  });
}
function stepTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    const k = clamp(tw.t / tw.dur, 0, 1);
    tw.update(tw.ease(k));
    if (k >= 1) { tweens.splice(i, 1); tw.res(); }
  }
}

// ---------- Scene ----------
let renderer, scene, camera, clock;
let boardGroup = null, decorGroup = null, pawnGroup = null, diceGroup, diceMesh;
const snakeHeads = [];
const floaters = [];
const cam = { yaw: 0, pitch: 0.95, radius: 15.5, tx: 0, ty: 0, tz: 0 };
const camGoal = { yaw: 0, pitch: 0.95, radius: 15.5, tx: 0, ty: 0, tz: 0 };
function camOverview() { Object.assign(camGoal, { yaw: 0, pitch: 0.95, radius: 15.5, tx: 0, ty: 0, tz: 0 }); }
function camFollow(v, radius) { camGoal.tx = v.x; camGoal.ty = 0.4; camGoal.tz = v.z; camGoal.radius = radius || 8.5; camGoal.pitch = 0.85; }

function initThree() {
  const container = $("#scene-container");
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputEncoding = THREE.sRGBEncoding;
  applyQuality();
  container.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 300);
  clock = new THREE.Clock();
  const amb = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(amb);
  const sun = new THREE.DirectionalLight(0xffffff, 0.95);
  sun.position.set(8, 16, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -11; sun.shadow.camera.right = 11;
  sun.shadow.camera.top = 11; sun.shadow.camera.bottom = -11;
  scene.add(sun);
  scene.userData.sun = sun;
  buildDice();
  buildWorld(G.theme, LAYOUTS.normal);
  setupCameraInput(renderer.domElement);
  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  animate();
}
function applyQuality() {
  if (!renderer) return;
  const q = settings.quality;
  const dpr = window.devicePixelRatio || 1;
  const ratio = q === "high" ? Math.min(dpr, 2) : q === "low" ? 1 : Math.min(dpr, 1.75);
  renderer.setPixelRatio(ratio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = q !== "low";
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (scene && scene.userData.sun) scene.userData.sun.castShadow = q !== "low";
}

const THEME_CONF = {
  bahtera: { bg: 0x9fd7ee, fog: [0x9fd7ee, 30, 90], sun: 0xfff2d8 },
  orbit: { bg: 0x05060f, fog: [0x05060f, 26, 80], sun: 0xbcd2ff },
};

function buildWorld(theme, layout) {
  if (boardGroup) { scene.remove(boardGroup); disposeDeep(boardGroup); }
  if (decorGroup) { scene.remove(decorGroup); disposeDeep(decorGroup); }
  if (pawnGroup) { scene.remove(pawnGroup); disposeDeep(pawnGroup); }
  snakeHeads.length = 0; floaters.length = 0;
  boardGroup = new THREE.Group(); decorGroup = new THREE.Group(); pawnGroup = new THREE.Group();
  scene.add(boardGroup, decorGroup, pawnGroup);
  const conf = THEME_CONF[theme];
  scene.background = new THREE.Color(conf.bg);
  scene.fog = new THREE.Fog(conf.fog[0], conf.fog[1], conf.fog[2]);
  if (scene.userData.sun) scene.userData.sun.color.setHex(conf.sun);

  buildBase(theme);
  buildTiles(theme);
  buildLadders(theme, layout);
  buildSnakes(theme, layout);
  if (theme === "bahtera") buildDecorBahtera(); else buildDecorOrbit();
  if (diceGroup) { diceGroup.position.set(5.95, 0.28, 4.35); diceGroup.rotation.set(0, 0, 0); scene.add(diceGroup); }
}
function disposeDeep(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    }
  });
}
function buildBase(theme) {
  if (theme === "bahtera") {
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(13.4, 0.55, 13.4),
      new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.85 })
    );
    deck.position.y = -0.37; deck.receiveShadow = true;
    boardGroup.add(deck);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x6e4525, roughness: 0.9 });
    [[0, -6.75, 13.9, 0.5], [0, 6.75, 13.9, 0.5], [-6.75, 0, 0.5, 13.9], [6.75, 0, 0.5, 13.9]].forEach(([x, z, w, d]) => {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.75, d), rimMat);
      rim.position.set(x, -0.28, z); rim.castShadow = true;
      boardGroup.add(rim);
    });
    const sea = new THREE.Mesh(
      new THREE.CircleGeometry(60, 40),
      new THREE.MeshStandardMaterial({ color: 0x14607f, roughness: 0.3, metalness: 0.15 })
    );
    sea.rotation.x = -Math.PI / 2; sea.position.y = -1.05;
    decorGroup.add(sea);
  } else {
    const plat = new THREE.Mesh(
      new THREE.CylinderGeometry(9.4, 10.2, 0.7, 40),
      new THREE.MeshStandardMaterial({ color: 0x1c2133, roughness: 0.5, metalness: 0.6 })
    );
    plat.position.y = -0.5; plat.receiveShadow = true;
    boardGroup.add(plat);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(9.4, 0.07, 10, 80),
      new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x8f5bff, emissiveIntensity: 1.6 })
    );
    ring.rotation.x = Math.PI / 2; ring.position.y = -0.16;
    boardGroup.add(ring);
    const under = new THREE.Mesh(
      new THREE.BoxGeometry(12.6, 0.3, 12.6),
      new THREE.MeshStandardMaterial({ color: 0x11182c, roughness: 0.6, metalness: 0.4 })
    );
    under.position.y = -0.24;
    boardGroup.add(under);
  }
}
function buildTiles(theme) {
  const sideMat = new THREE.MeshStandardMaterial({ color: theme === "orbit" ? 0x0d1122 : 0xcfa96a, roughness: 0.8 });
  for (let n = 1; n <= 100; n++) {
    const idx = n - 1, row = Math.floor(idx / 10);
    let col = idx % 10; if (row % 2 === 1) col = 9 - col;
    const topMat = new THREE.MeshStandardMaterial({ map: makeTileTexture(n, row, col, theme), roughness: 0.75 });
    const tile = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.18, 0.96), [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
    const p = squarePos(n);
    tile.position.set(p.x, 0, p.z);
    tile.receiveShadow = true;
    boardGroup.add(tile);
  }
}
function buildLadders(theme, layout) {
  const railMat = theme === "orbit"
    ? new THREE.MeshStandardMaterial({ color: 0x0d2b33, emissive: 0x19c2d8, emissiveIntensity: 1.1, roughness: 0.4 })
    : new THREE.MeshStandardMaterial({ color: 0x9c6b3f, roughness: 0.85 });
  const rungMat = theme === "orbit"
    ? new THREE.MeshStandardMaterial({ color: 0x0d2b33, emissive: 0x67e8f9, emissiveIntensity: 0.9, roughness: 0.4 })
    : new THREE.MeshStandardMaterial({ color: 0xbd9057, roughness: 0.85 });
  Object.entries(layout.ladders).forEach(([from, to]) => {
    const a = squarePos(+from), b = squarePos(+to);
    a.y = 0.16; b.y = 0.16;
    const dir = new THREE.Vector3().subVectors(b, a);
    const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(0.27);
    const a1 = a.clone().add(perp), a2 = a.clone().sub(perp);
    const b1 = b.clone().add(perp), b2 = b.clone().sub(perp);
    boardGroup.add(cylinderBetween(a1, b1, 0.05, railMat));
    boardGroup.add(cylinderBetween(a2, b2, 0.05, railMat));
    const len = dir.length();
    const rungs = Math.max(2, Math.floor(len / 0.55));
    for (let i = 1; i < rungs; i++) {
      const k = i / rungs;
      const p1 = a1.clone().lerp(b1, k), p2 = a2.clone().lerp(b2, k);
      boardGroup.add(cylinderBetween(p1, p2, 0.038, rungMat));
    }
  });
}
const SNAKE_STYLES = [
  ["#7d4fc9", "#ffd23e"], ["#2b7de9", "#bfe3ff"], ["#e2603a", "#ffe3b3"],
  ["#3fae5a", "#e8ffb3"], ["#c94f8f", "#ffd3ec"], ["#4f8f8b", "#d9fffa"],
  ["#8f6b3a", "#ffe9b3"], ["#5a4fd0", "#cfd0ff"], ["#d03a3a", "#ffc9c9"], ["#3a7dd0", "#ffe98a"],
];
function buildSnakes(theme, layout) {
  const entries = Object.entries(layout.snakes);
  entries.forEach(([head, tail], si) => {
    const H = squarePos(+head), T = squarePos(+tail);
    const pts = [];
    const SEG = 5;
    for (let i = 0; i <= SEG; i++) {
      const k = i / SEG;
      const p = H.clone().lerp(T, k);
      const wave = Math.sin(k * Math.PI * 2.1 + si) * 0.55 * Math.sin(k * Math.PI);
      const perp = new THREE.Vector3(-(T.z - H.z), 0, T.x - H.x).normalize();
      p.addScaledVector(perp, wave);
      p.y = 0.24 + Math.sin(k * Math.PI) * 0.16;
      pts.push(p);
    }
    pts[0].y = 0.3; pts[SEG].y = 0.16;
    const curve = new THREE.CatmullRomCurve3(pts);
    const [c1, c2] = SNAKE_STYLES[si % SNAKE_STYLES.length];
    const bodyMat = new THREE.MeshStandardMaterial({
      map: makeStripeTexture(c1, c2), roughness: 0.55,
      emissive: theme === "orbit" ? new THREE.Color(c1) : new THREE.Color(0x000000),
      emissiveIntensity: theme === "orbit" ? 0.55 : 0,
    });
    const group = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 42, 0.155, 9), bodyMat);
    tube.castShadow = true;
    group.add(tube);
    // kepala
    const headGroup = new THREE.Group();
    const headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(c1), roughness: 0.5, emissive: theme === "orbit" ? new THREE.Color(c1) : new THREE.Color(0x000000), emissiveIntensity: theme === "orbit" ? 0.5 : 0 });
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.27, 18, 14), headMat);
    skull.scale.set(1.05, 0.8, 1.3); skull.castShadow = true;
    headGroup.add(skull);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.3 });
    [-0.11, 0.11].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), eyeMat);
      eye.position.set(ex, 0.15, 0.14);
      const pup = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), pupilMat);
      pup.position.set(ex, 0.17, 0.2);
      headGroup.add(eye, pup);
    });
    const tongueMat = new THREE.MeshStandardMaterial({ color: 0xe33b4e, roughness: 0.5 });
    [-0.045, 0.045].forEach((tx) => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.015, 0.22), tongueMat);
      t.position.set(tx, -0.03, 0.42);
      t.rotation.y = tx * 2.4;
      headGroup.add(t);
    });
    headGroup.position.copy(pts[0]).add(new THREE.Vector3(0, 0.12, 0));
    const away = pts[0].clone().sub(pts[1]); away.y = 0;
    headGroup.lookAt(headGroup.position.clone().add(away));
    group.add(headGroup);
    if (theme === "orbit") {
      [0.3, 0.55, 0.8].forEach((tk) => {
        const p = curve.getPoint(tk), tan = curve.getTangent(tk);
        const ringM = new THREE.Mesh(
          new THREE.TorusGeometry(0.185, 0.03, 8, 20),
          new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(c2), emissiveIntensity: 1.5 })
        );
        ringM.position.copy(p);
        ringM.lookAt(p.clone().add(tan));
        group.add(ringM);
      });
    }
    group.userData.curve = curve;
    group.userData.headSq = +head;
    boardGroup.add(group);
    snakeHeads.push({ headGroup, phase: rand(0, Math.PI * 2), baseY: headGroup.position.y });
    boardGroup.userData["snake_" + head] = group;
  });
}
function buildDecorBahtera() {
  // tiang + layar
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x6e4525, roughness: 0.9 });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 8.6, 10), mastMat);
  mast.position.set(0, 3.6, -7.6); mast.castShadow = true;
  decorGroup.add(mast);
  const sailShape = new THREE.Shape();
  sailShape.moveTo(0, 0); sailShape.quadraticCurveTo(1.9, -1.6, 0.4, -3.4); sailShape.lineTo(0, -3.4); sailShape.lineTo(0, 0);
  const sail = new THREE.Mesh(new THREE.ShapeGeometry(sailShape, 12),
    new THREE.MeshStandardMaterial({ color: 0xfdf6e3, side: THREE.DoubleSide, roughness: 0.9 }));
  sail.position.set(0.1, 7.4, -7.55);
  decorGroup.add(sail);
  const flag = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.1, 4),
    new THREE.MeshStandardMaterial({ color: 0xff7a29, roughness: 0.7 }));
  flag.rotation.z = -Math.PI / 2; flag.position.set(0.62, 7.95, -7.6);
  decorGroup.add(flag);
  // pulau kelapa
  [[-11, -7, 1.2], [11.5, -4, 0.9], [-10, 6, 0.8]].forEach(([x, z, s]) => {
    const isl = new THREE.Group();
    const sand = new THREE.Mesh(new THREE.ConeGeometry(1.7 * s, 1.1 * s, 14),
      new THREE.MeshStandardMaterial({ color: 0xe8cf9a, roughness: 1 }));
    sand.position.y = -0.75;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.85 * s, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x3fae5a, roughness: 0.9 }));
    leaf.position.y = 0.55 * s; leaf.scale.y = 0.75;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * s, 0.13 * s, 1.3 * s, 8),
      new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 1 }));
    trunk.rotation.z = 0.25;
    isl.add(sand, leaf, trunk);
    isl.position.set(x, -0.35, z);
    decorGroup.add(isl);
    floaters.push({ obj: isl, phase: rand(0, 6), amp: 0.08, baseY: -0.35 });
  });
  // awan
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  for (let i = 0; i < 5; i++) {
    const cl = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(rand(0.7, 1.3), 10, 8), cloudMat);
      b.position.set(j * 1.05 - 1.6, rand(-0.15, 0.2), rand(-0.3, 0.3));
      b.scale.y = 0.55;
      cl.add(b);
    }
    cl.position.set(rand(-26, 26), rand(8, 13), rand(-22, -8));
    decorGroup.add(cl);
    floaters.push({ obj: cl, phase: rand(0, 6), amp: 0.15, baseY: cl.position.y, drift: rand(0.08, 0.22) });
  }
  // tong kayu di sudut geladak
  [[-6.1, -6.1], [6.15, -6.05]].forEach(([x, z]) => {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.85, 12),
      new THREE.MeshStandardMaterial({ color: 0x9c6b3f, roughness: 0.9 }));
    barrel.position.set(x, 0.1, z); barrel.castShadow = true;
    decorGroup.add(barrel);
  });
}
function buildDecorOrbit() {
  // bintang
  const starGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(700 * 3);
  for (let i = 0; i < 700; i++) {
    const r = rand(45, 95), th = rand(0, Math.PI * 2), ph = Math.acos(rand(-1, 1));
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.8 - 6;
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 0.55, sizeAttenuation: true }));
  decorGroup.add(stars);
  // planet bercincin
  const planet = new THREE.Group();
  const pl = new THREE.Mesh(new THREE.SphereGeometry(3.1, 24, 18),
    new THREE.MeshStandardMaterial({ color: 0x6a5acd, roughness: 0.7, emissive: 0x241a55, emissiveIntensity: 0.7 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.16, 8, 48),
    new THREE.MeshStandardMaterial({ color: 0x9fd8ff, emissive: 0x38b6ff, emissiveIntensity: 0.7, roughness: 0.4 }));
  ring.rotation.x = Math.PI / 2.4;
  planet.add(pl, ring);
  planet.position.set(-19, 7.5, -24);
  decorGroup.add(planet);
  floaters.push({ obj: planet, phase: 1, amp: 0.3, baseY: 7.5, spin: 0.05 });
  // asteroid
  const astMat = new THREE.MeshStandardMaterial({ color: 0x8b93a5, roughness: 0.95, flatShading: true });
  for (let i = 0; i < 9; i++) {
    const a = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.4, 1.1), 0), astMat);
    const ang = (i / 9) * Math.PI * 2 + rand(-0.3, 0.3);
    a.position.set(Math.cos(ang) * rand(12.5, 17), rand(-1.5, 3.5), Math.sin(ang) * rand(12.5, 17));
    decorGroup.add(a);
    floaters.push({ obj: a, phase: rand(0, 6), amp: 0.25, baseY: a.position.y, spin: rand(0.1, 0.4) });
  }
}

// ---------- Bidak karakter ----------
function buildPawn(charId, colorHex) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.55 });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), mat);
  body.position.y = 0.3; body.scale.set(1, 1.1, 0.95); body.castShadow = true;
  g.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 10), white);
  belly.position.set(0, 0.27, 0.14); belly.scale.set(0.85, 1, 0.6);
  g.add(belly);
  const head = new THREE.Group(); head.position.y = 0.72;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 14), charId === "robot"
    ? new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.35, metalness: 0.65 })
    : mat);
  if (charId === "robot") { skull.geometry = new THREE.BoxGeometry(0.44, 0.4, 0.42); }
  skull.castShadow = true;
  head.add(skull);
  [-0.1, 0.1].forEach((ex) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), charId === "robot"
      ? new THREE.MeshStandardMaterial({ color: 0x38f2ff, emissive: 0x38f2ff, emissiveIntensity: 1.4 }) : dark);
    eye.position.set(ex, 0.04, 0.21);
    head.add(eye);
  });
  if (charId === "kucing" || charId === "beruang") {
    [-0.14, 0.14].forEach((ex) => {
      const ear = charId === "kucing"
        ? new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 8), mat)
        : new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), mat);
      ear.position.set(ex, 0.24, 0);
      head.add(ear);
    });
  } else if (charId === "kelinci") {
    [-0.1, 0.1].forEach((ex) => {
      const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.22, 4, 8), mat);
      ear.position.set(ex, 0.36, 0);
      ear.rotation.z = ex * 0.7;
      head.add(ear);
    });
  } else if (charId === "bebek") {
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 10),
      new THREE.MeshStandardMaterial({ color: 0xff8c1a, roughness: 0.5 }));
    beak.rotation.x = Math.PI / 2; beak.position.set(0, -0.02, 0.3);
    head.add(beak);
  } else if (charId === "kodok") {
    [-0.12, 0.12].forEach((ex) => {
      const stalk = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), mat);
      stalk.position.set(ex, 0.22, 0.05);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), dark);
      eye.position.set(ex, 0.27, 0.1);
      head.add(stalk, eye);
    });
  } else if (charId === "robot") {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.24, 6), dark);
    ant.position.y = 0.32;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xff5252, emissive: 0xff2222, emissiveIntensity: 1.2 }));
    tip.position.y = 0.46;
    head.add(ant, tip);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), dark);
  nose.position.set(0, -0.03, 0.23);
  if (charId !== "bebek" && charId !== "robot") head.add(nose);
  g.add(head);
  g.userData.head = head;
  return g;
}
const TILE_OFFSETS = [[0, 0], [0.24, 0.24], [-0.24, 0.24], [0.24, -0.24], [-0.24, -0.24], [0, 0.3], [0, -0.3]];
function placePawn(player, animateY) {
  const base = squarePos(Math.max(1, player.pos));
  const same = G.players.filter((p) => p.pos === player.pos);
  const idx = same.indexOf(player);
  const off = player.pos === 0 ? [ (idx - (G.players.length - 1) / 2) * 0.55, 5.9 ] : (TILE_OFFSETS[idx % TILE_OFFSETS.length] || [0, 0]);
  const x = player.pos === 0 ? off[0] : base.x + off[0];
  const z = player.pos === 0 ? off[1] : base.z + off[1];
  player.baseY = player.pos === 0 ? -0.09 : 0.09;
  player.group.position.set(x, animateY !== undefined ? animateY : player.baseY, z);
}
function refreshAllPawns() { G.players.forEach((p) => { if (p.group) placePawn(p); }); }

// ---------- Dadu ----------
function makeDiceFace(value) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#fdfdf8"; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "#c9c9c0"; g.lineWidth = 6; g.strokeRect(3, 3, 122, 122);
  const P = { tl: [34, 34], tr: [94, 34], ml: [34, 64], c: [64, 64], mr: [94, 64], bl: [34, 94], br: [94, 94] };
  const spots = { 1: ["c"], 2: ["tl", "br"], 3: ["tl", "c", "br"], 4: ["tl", "tr", "bl", "br"], 5: ["tl", "tr", "c", "bl", "br"], 6: ["tl", "tr", "ml", "mr", "bl", "br"] };
  g.fillStyle = value === 1 ? "#d8342c" : "#1c1c22";
  spots[value].forEach((k) => {
    const [x, y] = P[k];
    g.beginPath(); g.arc(x, y, value === 1 ? 17 : 12, 0, Math.PI * 2); g.fill();
  });
  return new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), roughness: 0.35 });
}
function buildDice() {
  diceGroup = new THREE.Group();
  const mats = [3, 4, 1, 6, 2, 5].map(makeDiceFace); // +x,-x,+y,-y,+z,-z
  diceMesh = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.72), mats);
  diceMesh.castShadow = true;
  diceGroup.add(diceMesh);
  diceGroup.position.set(5.95, 0.28, 4.35);
}
const DICE_EULER = {
  1: [0, 0, 0], 6: [Math.PI, 0, 0], 2: [-Math.PI / 2, 0, 0],
  5: [Math.PI / 2, 0, 0], 3: [0, 0, Math.PI / 2], 4: [0, 0, -Math.PI / 2],
};
async function animateDiceRoll(result, nearPos) {
  AudioSys.diceRoll();
  const land = nearPos.clone();
  land.x = clamp(land.x + rand(-0.6, 0.6), -4.4, 4.4);
  land.z = clamp(land.z + rand(-0.6, 0.6), -4.4, 4.4);
  land.y = 0.45;
  const start = diceGroup.position.clone();
  const spinX = rand(5, 8) * Math.PI, spinZ = rand(5, 8) * Math.PI;
  const [fx, fy, fz] = DICE_EULER[result];
  const finalYaw = randi(0, 3) * Math.PI / 2;
  await tween(0.72, (k) => {
    diceGroup.position.lerpVectors(start, land, k);
    diceGroup.position.y = lerp(start.y, land.y, k) + Math.sin(k * Math.PI) * 1.7;
    diceMesh.rotation.set(spinX * (1 - k) + fx * k, 0, spinZ * (1 - k) + fz * k);
    diceGroup.rotation.y = finalYaw * k;
  }, (k) => 1 - Math.pow(1 - k, 2));
  diceMesh.rotation.set(fx, fy, fz);
  diceGroup.rotation.set(0, finalYaw, 0);
  // pantulan kecil
  await tween(0.16, (k) => { diceGroup.position.y = land.y + Math.sin(k * Math.PI) * 0.12; });
  diceGroup.position.y = land.y;
}

// ---------- Kamera ----------
function setupCameraInput(el) {
  const pointers = new Map();
  let lastPinch = 0;
  el.addEventListener("pointerdown", (e) => { pointers.set(e.pointerId, [e.clientX, e.clientY]); el.setPointerCapture(e.pointerId); });
  el.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1) {
      camGoal.yaw -= (e.clientX - prev[0]) * 0.0055;
      camGoal.pitch = clamp(camGoal.pitch + (e.clientY - prev[1]) * 0.004, 0.3, 1.3);
    } else if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      if (lastPinch > 0) camGoal.radius = clamp(camGoal.radius * (lastPinch / d), 7, 24);
      lastPinch = d;
    }
  });
  const release = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) lastPinch = 0; };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
  el.addEventListener("wheel", (e) => { e.preventDefault(); camGoal.radius = clamp(camGoal.radius * (1 + e.deltaY * 0.001), 7, 24); }, { passive: false });
}
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  stepTweens(dt);
  // kamera halus
  ["yaw", "pitch", "radius", "tx", "ty", "tz"].forEach((k) => { cam[k] = lerp(cam[k], camGoal[k], 1 - Math.pow(0.0015, dt)); });
  const cx = cam.tx + cam.radius * Math.sin(cam.pitch) * Math.sin(cam.yaw);
  const cz = cam.tz + cam.radius * Math.sin(cam.pitch) * Math.cos(cam.yaw);
  const cy = cam.ty + cam.radius * Math.cos(cam.pitch);
  camera.position.set(cx, cy, cz);
  camera.lookAt(cam.tx, cam.ty, cam.tz);
  // ular: kepala melenggok
  snakeHeads.forEach((s) => {
    s.headGroup.rotation.z = Math.sin(t * 1.6 + s.phase) * 0.13;
    s.headGroup.position.y = s.baseY + Math.sin(t * 2.1 + s.phase) * 0.03;
  });
  floaters.forEach((f) => {
    f.obj.position.y = f.baseY + Math.sin(t * 0.9 + f.phase) * f.amp;
    if (f.spin) f.obj.rotation.y += dt * f.spin;
    if (f.drift) { f.obj.position.x += dt * f.drift; if (f.obj.position.x > 30) f.obj.position.x = -30; }
  });
  G.players.forEach((p, i) => {
    if (p.group && !p.moving) p.group.position.y = (p.baseY !== undefined ? p.baseY : 0.09) + Math.abs(Math.sin(t * 2.4 + i * 1.7)) * 0.03;
  });
  renderer.render(scene, camera);
}

// ============================================================
//  ALUR GAME
// ============================================================
let toastTimer = null;
function showToast(msg, ms) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), ms || 2300);
}
function renderChips() {
  $("#players-panel").innerHTML = G.players.map((p, i) => {
    const ch = CHARACTERS.find((c) => c.id === p.charId);
    return `<div class="player-chip ${i === G.current ? "active" : ""}">
      <span class="dot" style="background:${ch.css}"></span>
      <strong>${p.name}</strong>
      <span class="sq">Petak ${p.pos === 0 ? "Start" : p.pos}</span>
      ${p.isAI ? '<span class="ai-tag">KOMPUTER</span>' : ""}
    </div>`;
  }).join("");
}
let lastConfig = null;
let gameId = 0;

function startGame(spec) {
  lastConfig = spec;
  gameId++;
  G.theme = spec.theme;
  G.boardKind = spec.boardKind;
  G.rules = spec.rules;
  document.body.dataset.theme = spec.theme;
  G.layout = spec.boardKind === "acak" ? genAcak((Math.random() * 1e9) | 0) : LAYOUTS[spec.boardKind];
  G.players = [];
  buildWorld(spec.theme, G.layout);
  spec.players.forEach((ps) => {
    const ch = CHARACTERS.find((c) => c.id === ps.charId);
    const group = buildPawn(ps.charId, ch.color);
    pawnGroup.add(group);
    G.players.push({ name: ps.name, charId: ps.charId, isAI: ps.isAI, pos: 0, sixStreak: 0, group, moving: false, baseY: -0.09 });
  });
  refreshAllPawns();
  $("#menu").classList.add("hidden");
  $("#win").classList.add("hidden");
  $("#pause").classList.add("hidden");
  $("#hud").classList.remove("hidden");
  G.started = true; G.finished = false; G.paused = false; G.busy = false; G.current = 0;
  camOverview();
  AudioSys.init(); AudioSys.resume(); AudioSys.startSong(spec.theme);
  renderChips();
  showToast("Game dimulai. Yang pertama sampai petak 100 menang!", 2600);
  beginTurn();
}
function quitToMenu() {
  gameId++;
  G.started = false; G.finished = false; G.busy = false;
  G.players = [];
  $("#hud").classList.add("hidden");
  $("#pause").classList.add("hidden");
  $("#win").classList.add("hidden");
  $("#menu").classList.remove("hidden");
  buildWorld(G.theme, LAYOUTS[G.boardKind] || LAYOUTS.normal);
  camOverview();
  AudioSys.startSong(G.theme);
}
function beginTurn() {
  if (!G.started || G.finished) return;
  renderChips();
  const p = G.players[G.current];
  const banner = $("#turn-banner");
  const btn = $("#btn-dice");
  if (p.isAI) {
    banner.textContent = `Giliran ${p.name} (komputer)`;
    btn.disabled = true; btn.textContent = "GILIRAN KOMPUTER";
    G.busy = true;
    const id = gameId;
    setTimeout(() => aiRoll(id), settings.fastAI ? 500 : 950);
  } else {
    banner.textContent = G.mode === "ai" && G.current === 0 ? `Giliranmu, ${p.name}` : `Giliran ${p.name}`;
    btn.disabled = false; btn.textContent = "LEMPAR DADU";
    G.busy = false;
  }
}
async function aiRoll(id) {
  if (!G.started || G.finished || id !== gameId) return;
  if (G.paused) { setTimeout(() => aiRoll(id), 600); return; }
  // charge pura-pura biar kelihatan mikir
  const wrap = $("#charge-wrap"), fill = $("#charge-fill");
  wrap.classList.remove("hidden");
  const target = rand(35, 78);
  await tween(0.45, (k) => { fill.style.width = (target * k) + "%"; });
  wrap.classList.add("hidden");
  fill.style.width = "0%";
  await doRoll(target >= 55 && target <= 82 && Math.random() < 0.35);
}
function canRoll() {
  return G.started && !G.finished && !G.busy && !G.paused &&
    !G.players[G.current].isAI &&
    $("#pause").classList.contains("hidden") && $("#win").classList.contains("hidden");
}

// ---------- Charge ----------
const charge = { active: false, val: 0, raf: 0, startT: 0 };
function startCharge() {
  if (!canRoll() || charge.active) return;
  AudioSys.init(); AudioSys.resume();
  charge.active = true; charge.val = 0; charge.startT = performance.now();
  $("#charge-wrap").classList.remove("hidden");
  $("#charge-wrap").classList.remove("over");
  const loop = () => {
    if (!charge.active) return;
    charge.val = (performance.now() - charge.startT) / 1100 * 100;
    if (charge.val >= 100) {
      charge.val = 100;
      $("#charge-fill").style.width = "100%";
      overcharge();
      return;
    }
    $("#charge-fill").style.width = charge.val + "%";
    $("#charge-wrap").classList.toggle("over", charge.val > 86);
    charge.raf = requestAnimationFrame(loop);
  };
  charge.raf = requestAnimationFrame(loop);
}
async function overcharge() {
  charge.active = false;
  cancelAnimationFrame(charge.raf);
  $("#charge-wrap").classList.add("hidden");
  $("#charge-fill").style.width = "0%";
  G.busy = true;
  $("#btn-dice").disabled = true;
  AudioSys.overcharge();
  showToast("Kelebihan tenaga! Bar-nya meledak, giliran hangus.", 2400);
  await wait(1100);
  endTurn();
}
function releaseCharge() {
  if (!charge.active) return;
  charge.active = false;
  cancelAnimationFrame(charge.raf);
  $("#charge-wrap").classList.add("hidden");
  const v = charge.val;
  $("#charge-fill").style.width = "0%";
  const perfect = v >= 55 && v <= 82;
  doRoll(perfect);
}

// ---------- Lempar & jalan ----------
async function doRoll(perfect) {
  if (!G.started || G.finished) return;
  G.busy = true;
  const btn = $("#btn-dice");
  btn.disabled = true; btn.textContent = "DADU BERPUTAR...";
  const p = G.players[G.current];
  let roll;
  if (perfect) {
    roll = [4, 5, 6, 5, 6][randi(0, 4)];
    AudioSys.perfect();
    showToast("Lemparan sempurna!", 1300);
  } else {
    roll = randi(1, 6);
  }
  camFollow(p.group.position, 9);
  await animateDiceRoll(roll, p.group.position.clone());
  btn.textContent = `ANGKA ${roll}`;
  // aturan tiga angka 6
  if (roll === 6) p.sixStreak++; else p.sixStreak = 0;
  if (G.rules.threeSix && p.sixStreak >= 3) {
    showToast(`${p.name} dapat angka 6 tiga kali berturut. Giliran gugur!`, 2600);
    p.sixStreak = 0;
    await wait(1200);
    endTurn();
    return;
  }
  // hitung jalur (dengan pantulan bila perlu)
  const path = [];
  if (p.pos + roll <= 100) {
    for (let s = 1; s <= roll; s++) path.push(p.pos + s);
  } else if (G.rules.bounce) {
    let cur = p.pos, dir = 1;
    for (let i = 0; i < roll; i++) {
      let nxt = cur + dir;
      if (nxt > 100) { dir = -1; nxt = 100 - (nxt - 100); }
      cur = nxt; path.push(cur);
    }
  }
  if (!path.length) {
    showToast(`Butuh angka pas buat menang. ${p.name} tidak bergerak.`, 2200);
    await wait(1100);
    if (roll === 6 && G.rules.six) { toastExtra(p); beginTurnSame(); } else endTurn();
    return;
  }
  // jalan petak demi petak
  p.moving = true;
  for (const sq of path) {
    const from = p.group.position.clone();
    const destC = squarePos(sq);
    const dest = new THREE.Vector3(destC.x, 0.09, destC.z);
    AudioSys.step();
    await tween(0.17, (k) => {
      p.group.position.lerpVectors(from, dest, k);
      p.group.position.y = lerp(from.y, 0.09, k) + Math.sin(k * Math.PI) * 0.32;
    });
    p.pos = sq;
    p.group.rotation.y = Math.atan2(dest.x - from.x, dest.z - from.z);
    camFollow(p.group.position, 9);
    renderChips();
  }
  p.moving = false;
  refreshAllPawns();
  // ular / tangga (bisa berantai)
  let guard = 0;
  while (guard++ < 5) {
    if (G.layout.ladders[p.pos]) {
      const dest = G.layout.ladders[p.pos];
      showToast(`${p.name} naik tangga ke petak ${dest}!`, 1900);
      AudioSys.ladderUp();
      await climbPawn(p, dest);
    } else if (G.layout.snakes[p.pos]) {
      const dest = G.layout.snakes[p.pos];
      showToast(`${p.name} kena ${G.theme === "orbit" ? "cacing angkasa" : "ular"}! Meluncur ke petak ${dest}.`, 2100);
      AudioSys.snakeDown();
      await slidePawn(p, dest);
    } else break;
    renderChips();
  }
  refreshAllPawns();
  if (p.pos === 100) { winGame(p); return; }
  camOverview();
  if (roll === 6 && G.rules.six) {
    toastExtra(p);
    beginTurnSame();
  } else {
    endTurn();
  }
}
function toastExtra(p) { showToast(`Angka 6! ${p.name} lempar lagi.`, 1600); }
function beginTurnSame() {
  G.busy = false;
  renderChips();
  const p = G.players[G.current];
  if (p.isAI) {
    G.busy = true;
    const id = gameId;
    setTimeout(() => aiRoll(id), settings.fastAI ? 450 : 850);
  } else {
    const btn = $("#btn-dice");
    btn.disabled = false; btn.textContent = "LEMPAR DADU";
  }
}
function endTurn() {
  const p = G.players[G.current];
  if (p) p.sixStreak = 0;
  G.current = (G.current + 1) % G.players.length;
  G.busy = false;
  camOverview();
  beginTurn();
}
async function climbPawn(p, dest) {
  p.moving = true;
  const from = p.group.position.clone();
  const d = squarePos(dest);
  const to = new THREE.Vector3(d.x, 0.09, d.z);
  camFollow(to, 9.5);
  await tween(0.55, (k) => {
    p.group.position.lerpVectors(from, to, k);
    p.group.position.y = lerp(from.y, 0.09, k) + Math.sin(k * Math.PI) * 0.45;
  });
  p.pos = dest;
  p.moving = false;
}
async function slidePawn(p, dest) {
  p.moving = true;
  const grp = boardGroup.userData["snake_" + p.pos];
  const curve = grp ? grp.userData.curve : null;
  if (curve) {
    const pts = curve.getPoints(26);
    camFollow(p.group.position, 8.5);
    await tween(0.85, (k) => {
      const f = k * (pts.length - 1);
      const i = Math.min(pts.length - 2, Math.floor(f));
      const pos = pts[i].clone().lerp(pts[i + 1], f - i);
      p.group.position.set(pos.x, pos.y + 0.12, pos.z);
      if (i > 0) p.group.rotation.y = Math.atan2(pos.x - pts[i].x, pos.z - pts[i].z);
    });
  } else {
    const from = p.group.position.clone();
    const d = squarePos(dest);
    await tween(0.7, (k) => {
      p.group.position.lerpVectors(from, new THREE.Vector3(d.x, 0.09, d.z), k);
    });
  }
  p.pos = dest;
  p.group.position.y = 0.09;
  p.moving = false;
}
function winGame(p) {
  G.finished = true; G.busy = true;
  AudioSys.win();
  camFollow(p.group.position, 7);
  $("#win-title").textContent = `${p.name} Menang!`;
  $("#win-text").textContent = p.isAI
    ? "Komputer sampai petak 100 duluan. Coba lagi, atur charge-nya lebih pas."
    : "Selamat, kamu sampai petak 100 paling duluan.";
  spawnConfetti();
  setTimeout(() => $("#win").classList.remove("hidden"), 650);
}
function spawnConfetti() {
  const box = $("#confetti");
  box.innerHTML = "";
  const colors = ["#ff7a29", "#ffd23e", "#2fbf71", "#2b7de9", "#c94f8f", "#fff"];
  for (let i = 0; i < 90; i++) {
    const d = document.createElement("div");
    d.className = "confetto";
    d.style.left = rand(0, 100) + "vw";
    d.style.background = colors[randi(0, colors.length - 1)];
    d.style.animationDuration = rand(2.4, 4.2) + "s";
    d.style.animationDelay = rand(0, 0.5) + "s";
    d.style.width = rand(6, 12) + "px";
    box.appendChild(d);
  }
  setTimeout(() => { box.innerHTML = ""; }, 5200);
}

// ============================================================
//  UI MENU & PENGATURAN
// ============================================================
function segVal(id) {
  const el = document.getElementById(id);
  const sel = el.querySelector(".seg.selected");
  return sel ? sel.dataset.v : null;
}
function initSegRows() {
  document.querySelectorAll(".seg-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      const btn = e.target.closest(".seg");
      if (!btn) return;
      row.querySelectorAll(".seg").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      AudioSys.click();
      if (row.id === "fr-count") buildFrRows(+btn.dataset.v);
      if (row.id === "set-quality") { settings.quality = btn.dataset.v; saveSettings(); applyQuality(); }
    });
  });
}
let aiCharSel = 0;
function charButtons(selectedIdx, takenSet) {
  return CHARACTERS.map((c, i) =>
    `<button class="char-btn ${i === selectedIdx ? "selected" : ""} ${takenSet && takenSet.has(i) && i !== selectedIdx ? "taken" : ""}" data-char="${i}">
       <span class="dot" style="background:${c.css}"></span>${c.name}
     </button>`).join("");
}
function initAiChar() {
  const grid = $("#ai-char");
  grid.innerHTML = charButtons(aiCharSel, null);
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".char-btn");
    if (!btn) return;
    aiCharSel = +btn.dataset.char;
    grid.innerHTML = charButtons(aiCharSel, null);
    AudioSys.click();
  });
}
let frCharSel = [0, 1, 2, 3];
function buildFrRows(n) {
  const box = $("#fr-rows");
  box.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const row = document.createElement("div");
    row.className = "fr-row";
    row.innerHTML = `<label>Pemain ${i + 1}
        <input type="text" maxlength="14" value="Pemain ${i + 1}" data-fr-name="${i}">
      </label>
      <div class="char-grid" data-fr-grid="${i}">${charButtons(frCharSel[i], new Set(frCharSel.slice(0, n)))}</div>`;
    box.appendChild(row);
  }
}
function initFrChars() {
  $("#fr-rows").addEventListener("click", (e) => {
    const btn = e.target.closest(".char-btn");
    if (!btn) return;
    const grid = btn.closest("[data-fr-grid]");
    const rowIdx = +grid.dataset.frGrid;
    const charIdx = +btn.dataset.char;
    const n = +segVal("fr-count");
    if (frCharSel.slice(0, n).includes(charIdx) && frCharSel[rowIdx] !== charIdx) return;
    frCharSel[rowIdx] = charIdx;
    buildFrRows(n);
    AudioSys.click();
  });
}
function readRules() {
  return { six: $("#rule-six").checked, threeSix: $("#rule-three-six").checked, bounce: $("#rule-bounce").checked };
}
function collectPlayers() {
  const players = [];
  if (G.mode === "ai") {
    const name = ($("#ai-name").value || "").trim() || "Pemain 1";
    players.push({ name, charId: CHARACTERS[aiCharSel].id, isAI: false });
    const nAI = +segVal("ai-count");
    const used = new Set([aiCharSel]);
    for (let i = 0; i < nAI; i++) {
      let ci = 0;
      while (used.has(ci)) ci++;
      used.add(ci);
      players.push({ name: AI_NAMES[i], charId: CHARACTERS[ci].id, isAI: true });
    }
  } else {
    const n = +segVal("fr-count");
    const usedChars = new Set();
    for (let i = 0; i < n; i++) {
      const nameEl = document.querySelector(`[data-fr-name="${i}"]`);
      const name = (nameEl && nameEl.value || "").trim() || `Pemain ${i + 1}`;
      let ci = frCharSel[i];
      if (usedChars.has(ci)) { ci = 0; while (usedChars.has(ci)) ci++; }
      usedChars.add(ci);
      players.push({ name, charId: CHARACTERS[ci].id, isAI: false });
    }
    const nAI = +segVal("fr-ai");
    for (let i = 0; i < nAI; i++) {
      let ci = 0;
      while (usedChars.has(ci)) ci++;
      usedChars.add(ci);
      players.push({ name: AI_NAMES[i], charId: CHARACTERS[ci].id, isAI: true });
    }
  }
  return players;
}
function initUI() {
  initSegRows();
  initAiChar();
  buildFrRows(2);
  initFrChars();
  // tema
  document.querySelectorAll("[data-theme-pick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-theme-pick]").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      G.theme = btn.dataset.themePick;
      document.body.dataset.theme = G.theme;
      AudioSys.init(); AudioSys.resume(); AudioSys.click();
      if (!G.started) { buildWorld(G.theme, LAYOUTS[G.boardKind] || LAYOUTS.normal); AudioSys.startSong(G.theme); }
    });
  });
  // mode
  const setMode = (m) => {
    G.mode = m;
    $("#mode-ai").classList.toggle("selected", m === "ai");
    $("#mode-friends").classList.toggle("selected", m === "friends");
    $("#setup-ai").classList.toggle("hidden", m !== "ai");
    $("#setup-friends").classList.toggle("hidden", m !== "friends");
    AudioSys.click();
  };
  $("#mode-ai").addEventListener("click", () => setMode("ai"));
  $("#mode-friends").addEventListener("click", () => setMode("friends"));
  // papan (buat latar menu)
  $("#board-pick").addEventListener("click", () => {
    setTimeout(() => {
      G.boardKind = segVal("board-pick");
      if (!G.started) buildWorld(G.theme, G.boardKind === "acak" ? genAcak(12345) : LAYOUTS[G.boardKind]);
    }, 0);
  });
  // mulai
  $("#btn-start").addEventListener("click", () => {
    AudioSys.init(); AudioSys.resume(); AudioSys.click();
    startGame({
      theme: G.theme,
      boardKind: segVal("board-pick"),
      rules: readRules(),
      players: collectPlayers(),
    });
  });
  // bantuan & pengaturan
  $("#btn-help").addEventListener("click", () => { $("#help").classList.remove("hidden"); AudioSys.click(); });
  document.querySelectorAll("[data-close]").forEach((b) =>
    b.addEventListener("click", () => $("#" + b.dataset.close).classList.add("hidden")));
  $("#btn-settings").addEventListener("click", () => { $("#settings-panel").classList.toggle("hidden"); AudioSys.click(); });
  // pengaturan nilai awal
  $("#set-music").value = Math.round(settings.music * 100);
  $("#set-sfx").value = Math.round(settings.sfx * 100);
  $("#set-fastai").checked = settings.fastAI;
  $("#set-mute").checked = settings.muted;
  document.querySelectorAll("#set-quality .seg").forEach((b) => b.classList.toggle("selected", b.dataset.v === settings.quality));
  $("#set-music").addEventListener("input", (e) => { settings.music = e.target.value / 100; saveSettings(); AudioSys.init(); AudioSys.applyVolumes(); });
  $("#set-sfx").addEventListener("input", (e) => { settings.sfx = e.target.value / 100; saveSettings(); AudioSys.init(); AudioSys.applyVolumes(); });
  $("#set-fastai").addEventListener("change", (e) => { settings.fastAI = e.target.checked; saveSettings(); });
  $("#set-mute").addEventListener("change", (e) => { settings.muted = e.target.checked; saveSettings(); AudioSys.applyVolumes(); syncSoundBtn(); });
  // HUD
  const syncSound = () => syncSoundBtn();
  $("#btn-sound").addEventListener("click", () => {
    settings.muted = !settings.muted;
    saveSettings();
    AudioSys.init(); AudioSys.applyVolumes();
    $("#set-mute").checked = settings.muted;
    syncSound();
    if (!settings.muted) AudioSys.click();
  });
  syncSound();
  $("#btn-camera").addEventListener("click", () => { camOverview(); AudioSys.click(); });
  $("#btn-pause").addEventListener("click", () => { G.paused = true; $("#pause").classList.remove("hidden"); });
  $("#btn-resume").addEventListener("click", () => { G.paused = false; $("#pause").classList.add("hidden"); });
  $("#btn-restart").addEventListener("click", () => { $("#pause").classList.add("hidden"); G.paused = false; if (lastConfig) startGame(lastConfig); });
  $("#btn-quit").addEventListener("click", () => { G.paused = false; quitToMenu(); });
  $("#btn-again").addEventListener("click", () => { $("#win").classList.add("hidden"); if (lastConfig) startGame(lastConfig); });
  $("#btn-win-menu").addEventListener("click", () => quitToMenu());
  // dadu: tahan & lepas
  const diceBtn = $("#btn-dice");
  diceBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); startCharge(); });
  diceBtn.addEventListener("pointerup", (e) => { e.preventDefault(); releaseCharge(); });
  diceBtn.addEventListener("pointerleave", () => { if (charge.active) releaseCharge(); });
  diceBtn.addEventListener("contextmenu", (e) => e.preventDefault());
  addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.code === "Space" && !e.repeat) { e.preventDefault(); startCharge(); }
    if (e.code === "Escape") {
      if (!$("#help").classList.contains("hidden")) $("#help").classList.add("hidden");
      else if (G.started && !G.finished && $("#win").classList.contains("hidden")) {
        G.paused = !G.paused;
        $("#pause").classList.toggle("hidden", !G.paused);
      }
    }
    if (e.code === "KeyM") { settings.muted = !settings.muted; saveSettings(); AudioSys.applyVolumes(); syncSoundBtn(); }
  });
  addEventListener("keyup", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.code === "Space") { e.preventDefault(); releaseCharge(); }
  });
  // musik menu mulai setelah interaksi pertama
  addEventListener("pointerdown", function once() {
    AudioSys.init(); AudioSys.resume();
    if (!G.started) AudioSys.startSong(G.theme);
    removeEventListener("pointerdown", once);
  });
}
function syncSoundBtn() {
  $("#btn-sound").classList.toggle("off", settings.muted);
  $("#btn-sound").textContent = settings.muted ? "Bisu" : "Suara";
}

// ---------- Init ----------
initUI();
initThree();
