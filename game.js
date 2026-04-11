// ─── Canvas & DOM ───────────────────────────────────────────────
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const scoreLabel = document.getElementById("score");
const livesLabel = document.getElementById("lives");
const waveLabel = document.getElementById("wave");
const highscoreLabel = document.getElementById("highscore");
const weaponLabel = document.getElementById("weapon");
const muteBtn = document.getElementById("mute");

const W = canvas.width;
const H = canvas.height;

// ─── Audio (procedural via Web Audio API) ───────────────────────
let audioCtx = null;
let muted = false;

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playTone(freq, duration, type, vol) {
  if (muted) return;
  try {
    ensureAudio();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol || 0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (_) {}
}

function sfxShoot() { playTone(880, 0.06, "square", 0.08); }
function sfxHit() { playTone(220, 0.12, "sawtooth", 0.10); }
function sfxPlayerHit() { playTone(90, 0.25, "sawtooth", 0.15); }
function sfxPowerUp() {
  playTone(660, 0.08, "sine", 0.10);
  setTimeout(() => playTone(880, 0.08, "sine", 0.10), 60);
  setTimeout(() => playTone(1100, 0.12, "sine", 0.10), 120);
}
function sfxWaveClear() {
  playTone(440, 0.1, "sine", 0.08);
  setTimeout(() => playTone(660, 0.1, "sine", 0.08), 100);
  setTimeout(() => playTone(880, 0.15, "sine", 0.10), 200);
  setTimeout(() => playTone(1100, 0.2, "sine", 0.12), 300);
}
function sfxGameOver() {
  playTone(440, 0.15, "sawtooth", 0.10);
  setTimeout(() => playTone(330, 0.15, "sawtooth", 0.10), 150);
  setTimeout(() => playTone(220, 0.3, "sawtooth", 0.12), 300);
}
function sfxBossHit() { playTone(150, 0.15, "square", 0.12); }

muteBtn.addEventListener("click", () => {
  muted = !muted;
  muteBtn.textContent = muted ? "Sound: OFF" : "Sound: ON";
});

// ─── Constants ──────────────────────────────────────────────────
const PLAYER_W = 52, PLAYER_H = 24, PLAYER_SPEED = 320;
const BULLET_SPEED = 480;
const ENEMY_BULLET_SPEED = 220;
const ENEMY_W = 38, ENEMY_H = 28;
const ENEMY_COLS = 10, ENEMY_ROWS_BASE = 3;
const ENEMY_GAP_X = 14, ENEMY_GAP_Y = 14;
const STAR_COUNT = 100;
const SHIELD_COUNT = 4, SHIELD_W = 60, SHIELD_H = 18, SHIELD_HP = 6;
const POWERUP_CHANCE = 0.12;
const POWERUP_W = 22, POWERUP_H = 22, POWERUP_SPEED = 120;
const POWERUP_DURATION = 8000;
const COMBO_WINDOW = 1500;

const WEAPON_NORMAL = "Normal";
const WEAPON_RAPID = "Rapid Fire";
const WEAPON_SPREAD = "Spread";
const WEAPON_PIERCE = "Laser";
const POWERUP_TYPES = [WEAPON_RAPID, WEAPON_SPREAD, WEAPON_PIERCE];
const POWERUP_COLORS = { [WEAPON_RAPID]: "#f4f76f", [WEAPON_SPREAD]: "#6ff4d8", [WEAPON_PIERCE]: "#f46fef" };

const TIER_GRUNT = 0, TIER_SOLDIER = 1, TIER_ELITE = 2;
const TIER_COLORS = { [TIER_GRUNT]: "#ff6b6b", [TIER_SOLDIER]: "#b56bff", [TIER_ELITE]: "#ffc56b" };
const TIER_HP = { [TIER_GRUNT]: 1, [TIER_SOLDIER]: 1, [TIER_ELITE]: 2 };
const TIER_POINTS = { [TIER_GRUNT]: 10, [TIER_SOLDIER]: 20, [TIER_ELITE]: 40 };

// ─── State ──────────────────────────────────────────────────────
const keys = { left: false, right: false };

const state = {
  phase: "title",
  player: null,
  playerBullets: [],
  enemyBullets: [],
  enemies: [],
  enemyDir: 1,
  enemySpeed: 60,
  enemyDrop: 22,
  score: 0,
  lives: 3,
  wave: 1,
  stars: [],
  lastEnemyShot: 0,
  enemyShotInterval: 900,
  particles: [],
  powerups: [],
  weapon: WEAPON_NORMAL,
  weaponTimer: 0,
  combo: 0,
  comboTimer: 0,
  lastKillTime: 0,
  shields: [],
  shakeAmount: 0,
  shakeTimer: 0,
  waveAnnounce: 0,
  waveAnnounceText: "",
  boss: null,
  bossTime: 0,
  highScores: [],
  playerFlash: 0,
};

// ─── High scores ────────────────────────────────────────────────
function loadHighScores() {
  try {
    state.highScores = JSON.parse(localStorage.getItem("si_highscores") || "[]");
  } catch (_) { state.highScores = []; }
  highscoreLabel.textContent = "Best: " + (state.highScores[0] || 0);
}

function saveHighScore(score) {
  state.highScores.push(score);
  state.highScores.sort((a, b) => b - a);
  state.highScores = state.highScores.slice(0, 5);
  try { localStorage.setItem("si_highscores", JSON.stringify(state.highScores)); } catch (_) {}
  highscoreLabel.textContent = "Best: " + (state.highScores[0] || 0);
}

// ─── Setup helpers ──────────────────────────────────────────────
function resetPlayer() {
  state.player = { x: W / 2 - PLAYER_W / 2, y: H - 58, w: PLAYER_W, h: PLAYER_H, cooldown: 0 };
}

function createStars() {
  state.stars = Array.from({ length: STAR_COUNT }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    size: Math.random() * 2 + 0.8,
    speed: Math.random() * 30 + 10,
  }));
}

function createShields() {
  state.shields = [];
  const spacing = W / (SHIELD_COUNT + 1);
  for (let i = 0; i < SHIELD_COUNT; i++) {
    state.shields.push({
      x: spacing * (i + 1) - SHIELD_W / 2,
      y: H - 110,
      w: SHIELD_W,
      h: SHIELD_H,
      hp: SHIELD_HP,
    });
  }
}

function tierForRow(row, totalRows) {
  if (row < Math.ceil(totalRows * 0.25)) return TIER_ELITE;
  if (row < Math.ceil(totalRows * 0.55)) return TIER_SOLDIER;
  return TIER_GRUNT;
}

function createEnemyGrid() {
  state.enemies = [];
  const rows = ENEMY_ROWS_BASE + Math.min(3, state.wave - 1);
  const totalW = ENEMY_COLS * ENEMY_W + (ENEMY_COLS - 1) * ENEMY_GAP_X;
  const offX = (W - totalW) / 2;
  const offY = 60;
  for (let r = 0; r < rows; r++) {
    const tier = tierForRow(r, rows);
    for (let c = 0; c < ENEMY_COLS; c++) {
      state.enemies.push({
        x: offX + c * (ENEMY_W + ENEMY_GAP_X),
        y: offY + r * (ENEMY_H + ENEMY_GAP_Y),
        w: ENEMY_W, h: ENEMY_H,
        alive: true,
        tier,
        hp: TIER_HP[tier],
        maxHp: TIER_HP[tier],
        points: TIER_POINTS[tier],
        flash: 0,
      });
    }
  }
  state.enemyDir = 1;
  state.enemySpeed = 55 + state.wave * 12;
  state.enemyShotInterval = Math.max(250, 900 - (state.wave - 1) * 80);
}

function isBossWave() { return state.wave % 3 === 0; }

function createBoss() {
  const bossHp = 30 + state.wave * 10;
  state.boss = {
    x: W / 2 - 60, y: 50, w: 120, h: 50,
    hp: bossHp, maxHp: bossHp,
    dir: 1, speed: 100,
    lastShot: 0, shotInterval: 600,
    flash: 0,
  };
  state.bossTime = 0;
  state.enemies = [];
}

function updateHud() {
  scoreLabel.textContent = "Score: " + state.score;
  livesLabel.textContent = "Lives: " + state.lives;
  waveLabel.textContent = "Wave: " + state.wave;
  weaponLabel.textContent = state.weapon;
  weaponLabel.style.color = POWERUP_COLORS[state.weapon] || "#d8ddff";
}

function resetGame() {
  state.playerBullets = [];
  state.enemyBullets = [];
  state.particles = [];
  state.powerups = [];
  state.score = 0;
  state.lives = 3;
  state.wave = 1;
  state.phase = "playing";
  state.weapon = WEAPON_NORMAL;
  state.weaponTimer = 0;
  state.combo = 0;
  state.comboTimer = 0;
  state.lastKillTime = 0;
  state.boss = null;
  state.shakeAmount = 0;
  state.shakeTimer = 0;
  state.playerFlash = 0;
  resetPlayer();
  createStars();
  createShields();
  createEnemyGrid();
  showWaveAnnounce("Wave 1");
  updateHud();
}

function startNextWave() {
  state.wave += 1;
  state.playerBullets = [];
  state.enemyBullets = [];
  state.powerups = [];
  state.boss = null;
  createShields();
  if (isBossWave()) {
    createBoss();
  } else {
    createEnemyGrid();
  }
  showWaveAnnounce(isBossWave() ? "BOSS WAVE " + state.wave : "Wave " + state.wave);
  updateHud();
}

function showWaveAnnounce(text) {
  state.waveAnnounce = 2.0;
  state.waveAnnounceText = text;
}

// ─── Particles ──────────────────────────────────────────────────
function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 160;
    state.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.3 + Math.random() * 0.3,
      maxLife: 0.3 + Math.random() * 0.3,
      size: 2 + Math.random() * 3,
      color,
    });
  }
}

function updateParticles(dt) {
  for (const p of state.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  }
  state.particles = state.particles.filter(p => p.life > 0);
}

// ─── Power-ups ──────────────────────────────────────────────────
function maybeDropPowerup(x, y) {
  if (Math.random() > POWERUP_CHANCE) return;
  const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
  state.powerups.push({ x, y, w: POWERUP_W, h: POWERUP_H, type });
}

function forceDropPowerup(x, y) {
  const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
  state.powerups.push({ x, y, w: POWERUP_W, h: POWERUP_H, type });
}

function collectPowerup(pu) {
  state.weapon = pu.type;
  state.weaponTimer = POWERUP_DURATION;
  sfxPowerUp();
  spawnParticles(pu.x + pu.w / 2, pu.y + pu.h / 2, POWERUP_COLORS[pu.type], 12);
  updateHud();
}

function updatePowerups(dt) {
  for (const pu of state.powerups) {
    pu.y += POWERUP_SPEED * dt;
  }
  state.powerups = state.powerups.filter(pu => pu.y < H + pu.h);

  for (let i = state.powerups.length - 1; i >= 0; i--) {
    if (intersects(state.powerups[i], state.player)) {
      collectPowerup(state.powerups[i]);
      state.powerups.splice(i, 1);
    }
  }

  if (state.weaponTimer > 0) {
    state.weaponTimer -= dt * 1000;
    if (state.weaponTimer <= 0) {
      state.weapon = WEAPON_NORMAL;
      state.weaponTimer = 0;
      updateHud();
    }
  }
}

// ─── Shooting ───────────────────────────────────────────────────
function getCooldown() {
  return state.weapon === WEAPON_RAPID ? 0.08 : 0.22;
}

function shootPlayer() {
  if (state.player.cooldown > 0 || state.phase !== "playing") return;
  sfxShoot();
  const cx = state.player.x + state.player.w / 2;
  const by = state.player.y - 10;
  const pierce = state.weapon === WEAPON_PIERCE;

  if (state.weapon === WEAPON_SPREAD) {
    for (const angle of [-0.18, 0, 0.18]) {
      state.playerBullets.push({
        x: cx - 2 + Math.sin(angle) * 10, y: by, w: 4, h: 10,
        vx: Math.sin(angle) * BULLET_SPEED * 0.4,
        vy: -BULLET_SPEED,
        pierce, hit: false,
      });
    }
  } else {
    state.playerBullets.push({
      x: cx - 2, y: by, w: pierce ? 6 : 4, h: pierce ? 16 : 10,
      vx: 0, vy: -BULLET_SPEED,
      pierce, hit: false,
    });
  }

  state.player.cooldown = getCooldown();
}

function shootEnemy(now) {
  if (now - state.lastEnemyShot < state.enemyShotInterval || state.phase !== "playing") return;
  const alive = state.enemies.filter(e => e.alive);
  if (alive.length === 0) return;
  const shooter = alive[Math.floor(Math.random() * alive.length)];

  const isSoldier = shooter.tier === TIER_SOLDIER;
  if (isSoldier && state.player) {
    const dx = (state.player.x + state.player.w / 2) - (shooter.x + shooter.w / 2);
    const dy = (state.player.y) - (shooter.y + shooter.h);
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    state.enemyBullets.push({
      x: shooter.x + shooter.w / 2 - 2, y: shooter.y + shooter.h,
      w: 4, h: 10,
      vx: (dx / dist) * ENEMY_BULLET_SPEED * 0.4,
      vy: ENEMY_BULLET_SPEED,
    });
  } else {
    state.enemyBullets.push({
      x: shooter.x + shooter.w / 2 - 2, y: shooter.y + shooter.h,
      w: 4, h: 10, vx: 0, vy: ENEMY_BULLET_SPEED,
    });
  }
  state.lastEnemyShot = now;
}

function shootBoss(now) {
  if (!state.boss || now - state.boss.lastShot < state.boss.shotInterval) return;
  const cx = state.boss.x + state.boss.w / 2;
  const by = state.boss.y + state.boss.h;
  for (const off of [-0.3, 0, 0.3]) {
    state.enemyBullets.push({
      x: cx - 2 + Math.sin(off) * 20, y: by,
      w: 5, h: 12,
      vx: Math.sin(off) * ENEMY_BULLET_SPEED * 0.5,
      vy: ENEMY_BULLET_SPEED * 1.1,
    });
  }
  state.boss.lastShot = now;
}

// ─── Collision ──────────────────────────────────────────────────
function intersects(a, b) {
  return a.x < b.x + (b.w || b.width || 0) &&
    a.x + (a.w || a.width || 0) > b.x &&
    a.y < b.y + (b.h || b.height || 0) &&
    a.y + (a.h || a.height || 0) > b.y;
}

// ─── Combo ──────────────────────────────────────────────────────
function registerKill(now) {
  if (now - state.lastKillTime < COMBO_WINDOW) {
    state.combo = Math.min(state.combo + 1, 8);
  } else {
    state.combo = 1;
  }
  state.lastKillTime = now;
  state.comboTimer = COMBO_WINDOW;
}

function comboMultiplier() { return Math.max(1, state.combo); }

function updateCombo(dt) {
  if (state.comboTimer > 0) {
    state.comboTimer -= dt * 1000;
    if (state.comboTimer <= 0) {
      state.combo = 0;
      state.comboTimer = 0;
    }
  }
}

// ─── Shake ──────────────────────────────────────────────────────
function triggerShake(amount, duration) {
  state.shakeAmount = amount;
  state.shakeTimer = duration;
}

function updateShake(dt) {
  if (state.shakeTimer > 0) {
    state.shakeTimer -= dt;
    if (state.shakeTimer <= 0) {
      state.shakeAmount = 0;
      state.shakeTimer = 0;
    }
  }
}

// ─── Update functions ───────────────────────────────────────────
function updateStars(dt) {
  for (const s of state.stars) {
    s.y += s.speed * dt;
    if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
  }
}

function updatePlayer(dt) {
  const spd = PLAYER_SPEED * dt;
  if (keys.left) state.player.x -= spd;
  if (keys.right) state.player.x += spd;
  state.player.x = Math.max(12, Math.min(W - state.player.w - 12, state.player.x));
  if (state.player.cooldown > 0) state.player.cooldown -= dt;
  if (state.playerFlash > 0) state.playerFlash -= dt;
}

function updateBullets(dt) {
  for (const b of state.playerBullets) {
    b.x += (b.vx || 0) * dt;
    b.y += b.vy * dt;
  }
  for (const b of state.enemyBullets) {
    b.x += (b.vx || 0) * dt;
    b.y += b.vy * dt;
  }
  state.playerBullets = state.playerBullets.filter(b => b.y + b.h >= 0 && !b.hit);
  state.enemyBullets = state.enemyBullets.filter(b => b.y <= H + b.h);
}

function updateEnemies(dt, now) {
  let shouldDrop = false;

  for (const e of state.enemies) {
    if (!e.alive) continue;
    e.x += state.enemyDir * state.enemySpeed * dt;
    if (e.flash > 0) e.flash -= dt;
    if (e.x <= 8 || e.x + e.w >= W - 8) shouldDrop = true;
  }

  if (shouldDrop) {
    state.enemyDir *= -1;
    for (const e of state.enemies) {
      if (!e.alive) continue;
      e.y += state.enemyDrop;
      if (e.y + e.h >= state.player.y) {
        state.phase = "gameover";
        sfxGameOver();
        saveHighScore(state.score);
      }
    }
  }

  shootEnemy(now);
}

function updateBoss(dt, now) {
  if (!state.boss) return;
  state.bossTime += dt;
  const b = state.boss;
  b.x = W / 2 - b.w / 2 + Math.sin(state.bossTime * 1.5) * (W / 2 - b.w / 2 - 20);
  if (b.flash > 0) b.flash -= dt;
  shootBoss(now);
}

function resolveCollisions(now) {
  const p = state.player;

  // player bullets vs enemies
  for (const b of state.playerBullets) {
    for (const e of state.enemies) {
      if (!e.alive || b.hit) continue;
      if (intersects(b, e)) {
        e.hp -= 1;
        if (e.hp <= 0) {
          e.alive = false;
          registerKill(now);
          const pts = e.points * comboMultiplier();
          state.score += pts;
          sfxHit();
          spawnParticles(e.x + e.w / 2, e.y + e.h / 2, TIER_COLORS[e.tier], 10);
          maybeDropPowerup(e.x + e.w / 2 - POWERUP_W / 2, e.y);
        } else {
          e.flash = 0.1;
          sfxBossHit();
        }
        if (!b.pierce) b.hit = true;
      }
    }

    // player bullets vs boss
    if (state.boss && !b.hit && intersects(b, state.boss)) {
      state.boss.hp -= 1;
      state.boss.flash = 0.08;
      sfxBossHit();
      spawnParticles(b.x, b.y, "#ffc56b", 4);
      if (!b.pierce) b.hit = true;
      if (state.boss.hp <= 0) {
        registerKill(now);
        state.score += 200 * comboMultiplier();
        sfxWaveClear();
        spawnParticles(state.boss.x + state.boss.w / 2, state.boss.y + state.boss.h / 2, "#ffc56b", 30);
        forceDropPowerup(state.boss.x + state.boss.w / 2 - POWERUP_W / 2, state.boss.y + state.boss.h);
        triggerShake(8, 0.4);
        state.boss = null;
      }
    }
  }

  // player bullets vs shields
  for (const b of state.playerBullets) {
    if (b.hit) continue;
    for (const s of state.shields) {
      if (s.hp <= 0) continue;
      if (intersects(b, s)) {
        b.hit = true;
        break;
      }
    }
  }

  // enemy bullets vs shields
  for (const b of state.enemyBullets) {
    for (const s of state.shields) {
      if (s.hp <= 0) continue;
      if (intersects(b, s)) {
        s.hp -= 1;
        b.y = H + 100;
        spawnParticles(b.x, b.y, "#4d5cdb", 3);
        break;
      }
    }
  }

  // enemy bullets vs player
  for (let i = state.enemyBullets.length - 1; i >= 0; i--) {
    const b = state.enemyBullets[i];
    if (intersects(b, p)) {
      state.enemyBullets.splice(i, 1);
      state.lives -= 1;
      state.playerFlash = 0.3;
      sfxPlayerHit();
      triggerShake(6, 0.25);
      spawnParticles(p.x + p.w / 2, p.y + p.h / 2, "#ffffff", 8);
      state.weapon = WEAPON_NORMAL;
      state.weaponTimer = 0;
      if (state.lives <= 0) {
        state.phase = "gameover";
        sfxGameOver();
        saveHighScore(state.score);
      }
    }
  }

  state.playerBullets = state.playerBullets.filter(b => !b.hit);

  // wave clear check
  const aliveCount = state.enemies.filter(e => e.alive).length;
  if (aliveCount === 0 && !state.boss && state.phase === "playing") {
    sfxWaveClear();
    startNextWave();
  }

  updateHud();
}

// ─── Drawing ────────────────────────────────────────────────────
function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#06091b");
  grad.addColorStop(1, "#0f1f3c");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#c5d9ff";
  for (const s of state.stars) {
    ctx.globalAlpha = 0.15 + s.size / 4;
    ctx.fillRect(s.x, s.y, s.size, s.size);
  }
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  const { x, y, w, h } = state.player;

  ctx.save();
  if (state.playerFlash > 0 && Math.floor(state.playerFlash * 20) % 2 === 0) {
    ctx.globalAlpha = 0.4;
  }

  // glow
  ctx.shadowColor = state.weapon === WEAPON_NORMAL ? "#58f49f" : (POWERUP_COLORS[state.weapon] || "#58f49f");
  ctx.shadowBlur = 16;

  ctx.fillStyle = "#58f49f";
  ctx.fillRect(x, y + h / 3, w, h * 2 / 3);
  ctx.fillStyle = "#9bffd0";
  ctx.fillRect(x + w * 0.2, y, w * 0.6, h * 2 / 3);
  ctx.fillStyle = "#0f1f3c";
  ctx.fillRect(x + w * 0.45, y + 3, w * 0.1, h * 0.5);

  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawEnemies() {
  for (const e of state.enemies) {
    if (!e.alive) continue;
    const color = e.flash > 0 ? "#ffffff" : TIER_COLORS[e.tier];
    const wobble = Math.sin(e.y / 8) * 1.5;

    ctx.fillStyle = color;
    ctx.fillRect(e.x, e.y, e.w, e.h);

    if (e.flash <= 0) {
      // eyes
      ctx.fillStyle = e.tier === TIER_ELITE ? "#fff5d1" : "#ffd1d1";
      ctx.fillRect(e.x + 6, e.y + 8 + wobble, 8, 8);
      ctx.fillRect(e.x + e.w - 14, e.y + 8 + wobble, 8, 8);
      // mouth
      ctx.fillStyle = e.tier === TIER_ELITE ? "#6b4f0d" : (e.tier === TIER_SOLDIER ? "#3d0d6b" : "#6b0d0d");
      ctx.fillRect(e.x + e.w * 0.2, e.y + e.h - 8, e.w * 0.6, 4);
    }

    // HP indicator for elites
    if (e.tier === TIER_ELITE && e.hp < e.maxHp) {
      ctx.fillStyle = "#ff3333";
      const barW = e.w * (e.hp / e.maxHp);
      ctx.fillRect(e.x, e.y - 4, barW, 2);
    }
  }
}

function drawBoss() {
  if (!state.boss) return;
  const b = state.boss;
  const color = b.flash > 0 ? "#ffffff" : "#ff4444";

  ctx.save();
  ctx.shadowColor = "#ff4444";
  ctx.shadowBlur = 20;

  ctx.fillStyle = color;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = b.flash > 0 ? "#ffffff" : "#ffaa44";
  ctx.fillRect(b.x + 15, b.y + 10, 20, 16);
  ctx.fillRect(b.x + b.w - 35, b.y + 10, 20, 16);
  ctx.fillStyle = b.flash > 0 ? "#ffffff" : "#660000";
  ctx.fillRect(b.x + b.w * 0.25, b.y + b.h - 12, b.w * 0.5, 6);

  ctx.shadowBlur = 0;

  // HP bar
  const hpRatio = b.hp / b.maxHp;
  const barW = 100;
  const barX = b.x + b.w / 2 - barW / 2;
  ctx.fillStyle = "#333";
  ctx.fillRect(barX, b.y - 14, barW, 8);
  ctx.fillStyle = hpRatio > 0.5 ? "#44ff66" : (hpRatio > 0.25 ? "#ffaa33" : "#ff3333");
  ctx.fillRect(barX, b.y - 14, barW * hpRatio, 8);
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, b.y - 14, barW, 8);

  ctx.restore();
}

function drawShields() {
  for (const s of state.shields) {
    if (s.hp <= 0) continue;
    const ratio = s.hp / SHIELD_HP;
    const r = Math.floor(30 + 47 * ratio);
    const g = Math.floor(50 + 142 * ratio);
    const b = Math.floor(100 + 119 * ratio);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.fillStyle = `rgba(255,255,255,${0.1 * ratio})`;
    ctx.fillRect(s.x, s.y, s.w, s.h / 3);
  }
}

function drawBullets() {
  for (const b of state.playerBullets) {
    ctx.fillStyle = b.pierce ? "#f46fef" : "#f4f76f";
    if (b.pierce) {
      ctx.shadowColor = "#f46fef";
      ctx.shadowBlur = 10;
    }
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.shadowBlur = 0;
  }

  ctx.fillStyle = "#ff9f43";
  for (const b of state.enemyBullets) {
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
}

function drawPowerups() {
  for (const pu of state.powerups) {
    const color = POWERUP_COLORS[pu.type] || "#ffffff";
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    ctx.fillRect(pu.x + 3, pu.y + 3, pu.w - 6, pu.h - 6);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(pu.x, pu.y, pu.w, pu.h);
    ctx.restore();

    // letter label
    ctx.fillStyle = "#000";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    const label = pu.type === WEAPON_RAPID ? "R" : (pu.type === WEAPON_SPREAD ? "S" : "L");
    ctx.fillText(label, pu.x + pu.w / 2, pu.y + pu.h / 2 + 4);
  }
}

function drawParticles() {
  for (const p of state.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawCombo() {
  if (state.combo < 2) return;
  ctx.save();
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#f4f76f";
  ctx.shadowColor = "#f4f76f";
  ctx.shadowBlur = 8;
  ctx.fillText("x" + state.combo, state.player.x + state.player.w / 2, state.player.y - 18);
  ctx.restore();
}

function drawWeaponTimer() {
  if (state.weapon === WEAPON_NORMAL || state.weaponTimer <= 0) return;
  const ratio = state.weaponTimer / POWERUP_DURATION;
  const barW = 80;
  const barH = 4;
  const barX = state.player.x + state.player.w / 2 - barW / 2;
  const barY = state.player.y + state.player.h + 6;
  ctx.fillStyle = "#333";
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = POWERUP_COLORS[state.weapon] || "#ffffff";
  ctx.fillRect(barX, barY, barW * ratio, barH);
}

function drawWaveAnnounce() {
  if (state.waveAnnounce <= 0) return;
  ctx.save();
  const alpha = Math.min(1, state.waveAnnounce);
  ctx.globalAlpha = alpha;
  ctx.font = "bold 48px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "#4d5cdb";
  ctx.shadowBlur = 20;
  ctx.fillText(state.waveAnnounceText, W / 2, H / 2 - 20);
  ctx.restore();
}

function drawOverlay() {
  if (state.phase !== "gameover") return;

  ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = "bold 48px sans-serif";
  ctx.fillText("Game Over", W / 2, H / 2 - 60);

  ctx.font = "24px sans-serif";
  ctx.fillStyle = "#dbe9ff";
  ctx.fillText("Final Score: " + state.score, W / 2, H / 2 - 20);

  // high scores
  ctx.font = "18px sans-serif";
  ctx.fillStyle = "#ff9f43";
  ctx.fillText("Top Scores", W / 2, H / 2 + 20);
  ctx.font = "16px sans-serif";
  ctx.fillStyle = "#bbc2f8";
  for (let i = 0; i < Math.min(5, state.highScores.length); i++) {
    ctx.fillText((i + 1) + ". " + state.highScores[i], W / 2, H / 2 + 44 + i * 22);
  }

  ctx.font = "20px sans-serif";
  ctx.fillStyle = "#ffffff";
  const bottomY = H / 2 + 44 + Math.min(5, state.highScores.length) * 22 + 16;
  ctx.fillText("Press R to restart", W / 2, bottomY);
}

function drawTitle() {
  drawBackground();
  updateStars(0.016);

  ctx.save();
  ctx.textAlign = "center";

  ctx.font = "bold 56px sans-serif";
  ctx.shadowColor = "#4d5cdb";
  ctx.shadowBlur = 30;
  ctx.fillStyle = "#ffffff";
  ctx.fillText("SPACE INVADERS", W / 2, H / 2 - 60);

  ctx.shadowBlur = 0;
  ctx.font = "22px sans-serif";
  ctx.fillStyle = "#bbc2f8";
  ctx.fillText("Press ENTER to start", W / 2, H / 2);

  ctx.font = "16px sans-serif";
  ctx.fillStyle = "#7a84c8";
  ctx.fillText("Arrow keys / A D to move  |  Space to shoot  |  M to mute", W / 2, H / 2 + 40);

  // high scores on title
  if (state.highScores.length > 0) {
    ctx.font = "18px sans-serif";
    ctx.fillStyle = "#ff9f43";
    ctx.fillText("Top Scores", W / 2, H / 2 + 90);
    ctx.font = "15px sans-serif";
    ctx.fillStyle = "#bbc2f8";
    for (let i = 0; i < Math.min(5, state.highScores.length); i++) {
      ctx.fillText((i + 1) + ". " + state.highScores[i], W / 2, H / 2 + 114 + i * 20);
    }
  }

  ctx.restore();
}

// ─── Main loop ──────────────────────────────────────────────────
let lastTime = 0;

function loop(timestamp) {
  const raw = (timestamp - lastTime) / 1000;
  const dt = Math.min(raw, 0.05);
  lastTime = timestamp;

  if (state.phase === "title") {
    drawTitle();
    requestAnimationFrame(loop);
    return;
  }

  // shake offset
  let shakeX = 0, shakeY = 0;
  if (state.shakeTimer > 0) {
    shakeX = (Math.random() - 0.5) * state.shakeAmount * 2;
    shakeY = (Math.random() - 0.5) * state.shakeAmount * 2;
  }

  ctx.save();
  ctx.translate(shakeX, shakeY);

  updateStars(dt);
  updateParticles(dt);
  updateShake(dt);

  if (state.waveAnnounce > 0) state.waveAnnounce -= dt;

  if (state.phase === "playing") {
    updatePlayer(dt);
    updateBullets(dt);
    updateCombo(dt);
    updatePowerups(dt);
    if (state.boss) {
      updateBoss(dt, timestamp);
    } else {
      updateEnemies(dt, timestamp);
    }
    resolveCollisions(timestamp);
  }

  drawBackground();
  drawShields();
  drawPlayer();
  drawEnemies();
  drawBoss();
  drawBullets();
  drawPowerups();
  drawParticles();
  drawCombo();
  drawWeaponTimer();
  drawWaveAnnounce();
  drawOverlay();

  ctx.restore();
  requestAnimationFrame(loop);
}

// ─── Input ──────────────────────────────────────────────────────
window.addEventListener("keydown", (e) => {
  if (e.code === "ArrowLeft" || e.code === "KeyA") keys.left = true;
  if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = true;
  if (e.code === "Space") {
    e.preventDefault();
    if (state.phase === "playing") shootPlayer();
  }
  if (e.code === "Enter" && state.phase === "title") {
    ensureAudio();
    resetGame();
  }
  if (e.code === "KeyR" && state.phase === "gameover") {
    resetGame();
  }
  if (e.code === "KeyM") {
    muted = !muted;
    muteBtn.textContent = muted ? "Sound: OFF" : "Sound: ON";
  }
});

window.addEventListener("keyup", (e) => {
  if (e.code === "ArrowLeft" || e.code === "KeyA") keys.left = false;
  if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = false;
});

// ─── Init ───────────────────────────────────────────────────────
loadHighScores();
createStars();
resetPlayer();
requestAnimationFrame(loop);
