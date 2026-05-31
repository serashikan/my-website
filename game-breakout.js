// 游戏状态
let running = false;
let animationId = null;
let container = null;
let canvas = null;
let ctx = null;

// 球：分开保存【方向向量】和【速度倍率】，绝不改写方向
let ball = {
  x: 0,
  y: 0,
  vx: 3,
  vy: -3,
  speedScale: 1,
  radius: 6
};

// 挡板
let paddle = { w: 80, h: 10, x: 0 };
let bricks = [];
const brickW = 60;
const brickH = 20;
const brickCols = 12;
const brickRows = 6;

// S键控制
let isS = false;
const maxScale = 10;

// ==========================
// init
// ==========================
export function init(cont) {
  container = cont;
  container.innerHTML = `<canvas width="850" height="600" style="border:1px solid #000;"></canvas>`;
  canvas = container.querySelector('canvas');
  ctx = canvas.getContext('2d');

  paddle.x = canvas.width / 2 - paddle.w / 2;
  ball.x = canvas.width / 2;
  ball.y = canvas.height - 40;
  ball.vx = 3;
  ball.vy = -3;
  ball.speedScale = 1;

  createBricks();
}

// ==========================
// start
// ==========================
export function start() {
  if (running) return;
  running = true;

  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  canvas.addEventListener("mousemove", mouseMove);

  gameLoop();
}

// ==========================
// stop
// ==========================
export function stop() {
  running = false;
  cancelAnimationFrame(animationId);
  window.removeEventListener('keydown', kd);
  window.removeEventListener('keyup', ku);
  canvas.removeEventListener("mousemove", mouseMove);
}

// ==========================
// 键盘 S 键
// ==========================
function kd(e) {
  if (e.key.toLowerCase() === 's') isS = true;
}
function ku(e) {
  if (e.key.toLowerCase() === 's') {
    isS = false;
    ball.speedScale = 1;
  }
}

// ==========================
// 鼠标
// ==========================
function mouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  paddle.x = e.clientX - rect.left - paddle.w / 2;
}

// ==========================
// 砖块
// ==========================
function createBricks() {
  bricks = [];
  for (let r = 0; r < brickRows; r++) {
    for (let c = 0; c < brickCols; c++) {
      bricks.push({
        x: c * (brickW + 10) + 10,
        y: r * (brickH + 5) + 40,
        alive: true
      });
    }
  }
}

// ==========================
// 主循环（核心修复：不修改方向，只放大倍率）
// ==========================
function gameLoop() {
  if (!running) return;

  // 按住S：只增加倍率，不碰方向
  if (isS && ball.speedScale < maxScale) {
    ball.speedScale += 0.01;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 画球
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fill();
  // 挡板
  ctx.fillRect(paddle.x, canvas.height - paddle.h - 10, paddle.w, paddle.h);
  // 砖块
  bricks.forEach(b => b.alive && ctx.fillRect(b.x, b.y, brickW, brickH));

  // 移动：方向永远不变，只乘倍率
  ball.x += ball.vx * ball.speedScale;
  ball.y += ball.vy * ball.speedScale;

  // 左右墙
  if (ball.x - ball.radius < 0) {
    ball.x = ball.radius;
    ball.vx = -ball.vx;
  }
  if (ball.x + ball.radius > canvas.width) {
    ball.x = canvas.width - ball.radius;
    ball.vx = -ball.vx;
  }

  // 上墙
  if (ball.y - ball.radius < 0) {
    ball.y = ball.radius;
    ball.vy = -ball.vy;
  }

  // 挡板
  if (
    ball.y + ball.radius > canvas.height - paddle.h - 10 &&
    ball.x > paddle.x && ball.x < paddle.x + paddle.w
  ) {
    ball.vy = -ball.vy;
  }

  // 砖块
  bricks.forEach(b => {
    if (b.alive &&
      ball.x > b.x && ball.x < b.x + brickW &&
      ball.y > b.y && ball.y < b.y + brickH
    ) {
      ball.vy = -ball.vy;
      b.alive = false;
    }
  });

  // 出界
  if (ball.y > canvas.height) {
    stop();
    setTimeout(() => alert("游戏结束"), 50);
  }

  animationId = requestAnimationFrame(gameLoop);
}