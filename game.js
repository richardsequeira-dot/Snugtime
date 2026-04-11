const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const scoreLabel = document.getElementById("score");
const livesLabel = document.getElementById("lives");
const waveLabel = document.getElementById("wave");

const GAME_WIDTH = canvas.width;
const GAME_HEIGHT = canvas.height;

const PLAYER_WIDTH = 52;
const PLAYER_HEIGHT = 24;
const PLAYER_SPEED = 6;
const BULLET_SPEED = 8;
const ENEMY_BULLET_SPEED = 4;

const ENEMY_WIDTH = 38;
const ENEMY_HEIGHT = 28;
const ENEMY_COLUMNS = 10;
const ENEMY_ROWS_BASE = 3;
const ENEMY_GAP_X = 14;
const ENEMY_GAP_Y = 14;

const STAR_COUNT = 80;

const keys = {
  left: false,
  right: false,
};

const state = {
  player: null,
  playerBullets: [],
  enemyBullets: [],
  enemies: [],
  enemyDirection: 1,
  enemySpeed: 1.2,
  enemyDropDistance: 22,
  score: 0,
  lives: 3,
  wave: 1,
  gameOver: false,
  win: false,
  stars: [],
  lastEnemyShotAt: 0,
  enemyShotIntervalMs: 900,
};

function resetPlayer() {
  state.player = {
    x: GAME_WIDTH / 2 - PLAYER_WIDTH / 2,
    y: GAME_HEIGHT - 58,
    width: PLAYER_WIDTH,
    height: PLAYER_HEIGHT,
    cooldown: 0,
  };
}

function createStars() {
  state.stars = Array.from({ length: STAR_COUNT }, () => ({
    x: Math.random() * GAME_WIDTH,
    y: Math.random() * GAME_HEIGHT,
    size: Math.random() * 2 + 1,
    speed: Math.random() * 0.5 + 0.2,
  }));
}

function createEnemyGrid() {
  state.enemies = [];
  const rows = ENEMY_ROWS_BASE + Math.min(3, state.wave - 1);
  const totalWidth = ENEMY_COLUMNS * ENEMY_WIDTH + (ENEMY_COLUMNS - 1) * ENEMY_GAP_X;
  const offsetX = (GAME_WIDTH - totalWidth) / 2;
  const offsetY = 60;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < ENEMY_COLUMNS; col += 1) {
      state.enemies.push({
        x: offsetX + col * (ENEMY_WIDTH + ENEMY_GAP_X),
        y: offsetY + row * (ENEMY_HEIGHT + ENEMY_GAP_Y),
        width: ENEMY_WIDTH,
        height: ENEMY_HEIGHT,
        alive: true,
        points: 10 + (rows - row) * 5,
      });
    }
  }

  state.enemyDirection = 1;
  state.enemySpeed = 1 + state.wave * 0.25;
  state.enemyShotIntervalMs = Math.max(300, 900 - (state.wave - 1) * 80);
}

function updateHud() {
  scoreLabel.textContent = `Score: ${state.score}`;
  livesLabel.textContent = `Lives: ${state.lives}`;
  waveLabel.textContent = `Wave: ${state.wave}`;
}

function resetGame() {
  state.playerBullets = [];
  state.enemyBullets = [];
  state.score = 0;
  state.lives = 3;
  state.wave = 1;
  state.gameOver = false;
  state.win = false;
  state.lastEnemyShotAt = 0;
  resetPlayer();
  createStars();
  createEnemyGrid();
  updateHud();
}

function spawnNextWave() {
  state.wave += 1;
  state.playerBullets = [];
  state.enemyBullets = [];
  createEnemyGrid();
  updateHud();
}

function shootPlayerBullet() {
  if (state.player.cooldown > 0 || state.gameOver) return;

  state.playerBullets.push({
    x: state.player.x + state.player.width / 2 - 2,
    y: state.player.y - 10,
    width: 4,
    height: 10,
  });

  state.player.cooldown = 14;
}

function shootEnemyBullet(now) {
  if (now - state.lastEnemyShotAt < state.enemyShotIntervalMs || state.gameOver) return;

  const aliveEnemies = state.enemies.filter((enemy) => enemy.alive);
  if (aliveEnemies.length === 0) return;

  const shuffled = aliveEnemies.sort(() => Math.random() - 0.5);
  const shooter = shuffled[0];
  if (!shooter) return;

  state.enemyBullets.push({
    x: shooter.x + shooter.width / 2 - 2,
    y: shooter.y + shooter.height,
    width: 4,
    height: 10,
  });

  state.lastEnemyShotAt = now;
}

function intersects(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function updateStars() {
  for (const star of state.stars) {
    star.y += star.speed;
    if (star.y > GAME_HEIGHT) {
      star.y = 0;
      star.x = Math.random() * GAME_WIDTH;
    }
  }
}

function updatePlayer() {
  if (keys.left) {
    state.player.x -= PLAYER_SPEED;
  }
  if (keys.right) {
    state.player.x += PLAYER_SPEED;
  }

  state.player.x = Math.max(12, Math.min(GAME_WIDTH - state.player.width - 12, state.player.x));

  if (state.player.cooldown > 0) {
    state.player.cooldown -= 1;
  }
}

function updateBullets() {
  for (const bullet of state.playerBullets) {
    bullet.y -= BULLET_SPEED;
  }
  for (const bullet of state.enemyBullets) {
    bullet.y += ENEMY_BULLET_SPEED;
  }

  state.playerBullets = state.playerBullets.filter((bullet) => bullet.y + bullet.height >= 0);
  state.enemyBullets = state.enemyBullets.filter((bullet) => bullet.y <= GAME_HEIGHT + bullet.height);
}

function updateEnemies(now) {
  let shouldDrop = false;

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    enemy.x += state.enemyDirection * state.enemySpeed;

    if (enemy.x <= 8 || enemy.x + enemy.width >= GAME_WIDTH - 8) {
      shouldDrop = true;
    }
  }

  if (shouldDrop) {
    state.enemyDirection *= -1;
    for (const enemy of state.enemies) {
      if (!enemy.alive) continue;
      enemy.y += state.enemyDropDistance;
      if (enemy.y + enemy.height >= state.player.y) {
        state.gameOver = true;
        state.win = false;
      }
    }
  }

  shootEnemyBullet(now);
}

function resolveCollisions() {
  for (const bullet of state.playerBullets) {
    for (const enemy of state.enemies) {
      if (!enemy.alive) continue;
      if (intersects(bullet, enemy)) {
        bullet.hit = true;
        enemy.alive = false;
        state.score += enemy.points;
        break;
      }
    }
  }

  for (const bullet of state.enemyBullets) {
    if (intersects(bullet, state.player)) {
      bullet.hit = true;
      state.lives -= 1;
      if (state.lives <= 0) {
        state.gameOver = true;
        state.win = false;
      }
    }
  }

  state.playerBullets = state.playerBullets.filter((bullet) => !bullet.hit);
  state.enemyBullets = state.enemyBullets.filter((bullet) => !bullet.hit);

  const aliveEnemies = state.enemies.filter((enemy) => enemy.alive);
  if (aliveEnemies.length === 0 && !state.gameOver) {
    if (state.wave >= 6) {
      state.gameOver = true;
      state.win = true;
    } else {
      spawnNextWave();
    }
  }

  updateHud();
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, GAME_HEIGHT);
  gradient.addColorStop(0, "#06091b");
  gradient.addColorStop(1, "#0f1f3c");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  ctx.fillStyle = "#c5d9ff";
  for (const star of state.stars) {
    ctx.globalAlpha = 0.2 + star.size / 4;
    ctx.fillRect(star.x, star.y, star.size, star.size);
  }
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  const { x, y, width, height } = state.player;
  ctx.fillStyle = "#58f49f";
  ctx.fillRect(x, y + height / 3, width, height * (2 / 3));
  ctx.fillStyle = "#9bffd0";
  ctx.fillRect(x + width * 0.2, y, width * 0.6, height * (2 / 3));
  ctx.fillStyle = "#0f1f3c";
  ctx.fillRect(x + width * 0.45, y + 3, width * 0.1, height * 0.5);
}

function drawEnemies() {
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    const wobble = (enemy.y / 10) % 2;
    ctx.fillStyle = "#ff6b6b";
    ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
    ctx.fillStyle = "#ffd1d1";
    ctx.fillRect(enemy.x + 6, enemy.y + 8 + wobble, 8, 8);
    ctx.fillRect(enemy.x + enemy.width - 14, enemy.y + 8 + wobble, 8, 8);
    ctx.fillStyle = "#6b0d0d";
    ctx.fillRect(enemy.x + enemy.width * 0.2, enemy.y + enemy.height - 8, enemy.width * 0.6, 4);
  }
}

function drawBullets() {
  ctx.fillStyle = "#f4f76f";
  for (const bullet of state.playerBullets) {
    ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
  }

  ctx.fillStyle = "#ff9f43";
  for (const bullet of state.enemyBullets) {
    ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
  }
}

function drawOverlay() {
  if (!state.gameOver) return;

  ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
  ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = "bold 44px sans-serif";
  ctx.fillText(state.win ? "You Win!" : "Game Over", GAME_WIDTH / 2, GAME_HEIGHT / 2 - 26);

  ctx.font = "22px sans-serif";
  ctx.fillStyle = "#dbe9ff";
  ctx.fillText(`Final Score: ${state.score}`, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 10);
  ctx.fillText("Press R to restart", GAME_WIDTH / 2, GAME_HEIGHT / 2 + 44);
}

function render() {
  drawBackground();
  drawPlayer();
  drawEnemies();
  drawBullets();
  drawOverlay();
}

function loop(now) {
  updateStars();

  if (!state.gameOver) {
    updatePlayer();
    updateBullets();
    updateEnemies(now);
    resolveCollisions();
  }

  render();
  requestAnimationFrame(loop);
}

window.addEventListener("keydown", (event) => {
  if (event.code === "ArrowLeft" || event.code === "KeyA") {
    keys.left = true;
  }
  if (event.code === "ArrowRight" || event.code === "KeyD") {
    keys.right = true;
  }
  if (event.code === "Space") {
    event.preventDefault();
    shootPlayerBullet();
  }
  if (event.code === "KeyR") {
    resetGame();
  }
});

window.addEventListener("keyup", (event) => {
  if (event.code === "ArrowLeft" || event.code === "KeyA") {
    keys.left = false;
  }
  if (event.code === "ArrowRight" || event.code === "KeyD") {
    keys.right = false;
  }
});

resetGame();
requestAnimationFrame(loop);
