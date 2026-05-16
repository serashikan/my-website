// 游戏状态
let running = false;
let animationId = null;
let container = null;
let canvas = null;
let ctx = null;

// 球
let ball = { x: 0, y: 0, dx: 3, dy: -3, radius: 6 };
// 挡板
let paddle = { w: 80, h: 10, x: 0 };
// 砖块
let bricks = [];
const brickW = 60;
const brickH = 20;
const brickCols = 8;
const brickRows = 4;

// ==========================
// 接口：init
// ==========================
export function init(cont) {
  container = cont;
  container.innerHTML = `<canvas width="500" height="400" style="border:1px solid #000000;z-index:99999"></canvas>`;
  canvas = container.querySelector('canvas');
  ctx = canvas.getContext('2d');

  // 初始化位置
  paddle.x = canvas.width / 2 - paddle.w / 2;
  ball.x = canvas.width / 2;
  ball.y = canvas.height - 40;

  createBricks();
}

// ==========================
// 接口：start
// ==========================
export function start() {
  running = true;
  gameLoop();

  // 鼠标控制
  canvas.addEventListener("mousemove", mouseMove);
}

// ==========================
// 接口：stop
// ==========================
export function stop() {
  running = false;
  cancelAnimationFrame(animationId);
  canvas.removeEventListener("mousemove", mouseMove);
}

// ==========================
// 内部函数
// ==========================
function mouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  paddle.x = e.clientX - rect.left - paddle.w / 2;
}

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

function gameLoop() {
  if (!running) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 画球
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fill();

  // 画挡板
  ctx.fillRect(paddle.x, canvas.height - paddle.h - 10, paddle.w, paddle.h);

  // 画砖块
  bricks.forEach(b => {
    if (b.alive) ctx.fillRect(b.x, b.y, brickW, brickH);
  });

  // 移动
  ball.x += ball.dx;
  ball.y += ball.dy;

  // 墙壁碰撞
  if (ball.x < 0 || ball.x > canvas.width) ball.dx *= -1;
  if (ball.y < 0) ball.dy *= -1;

  // 挡板碰撞
  if (
    ball.y > canvas.height - paddle.h - 10 &&
    ball.x > paddle.x &&
    ball.x < paddle.x + paddle.w
  ) {
    ball.dy = -3;
  }

  // 砖块碰撞
  bricks.forEach(b => {
    if (
      b.alive &&
      ball.x > b.x &&
      ball.x < b.x + brickW &&
      ball.y > b.y &&
      ball.y < b.y + brickH
    ) {
      ball.dy *= -1;
      b.alive = false;
    }
  });

  // 死亡判定
  if (ball.y > canvas.height) {
    stop();
    setTimeout(() => alert("游戏结束"), 50);
  }

  animationId = requestAnimationFrame(gameLoop);
}