// =============================================================================
// 打砖块 · game-breakout.js
// -----------------------------------------------------------------------------
// 注意：这个文件是**普通脚本**，不是 ES module。
// 原因：用 file:// 直接打开网页时，动态 import() 会被 CORS 拦掉（origin 为 null），
// 游戏就点不开了。普通 <script> 没有这个限制。
// 由 技术.html 在点击「打砖块」时注入 <script>，加载完读 window.BreakoutGame。
//
// 配色跟着 风格.css 的「暖纸 · 焦糖」主题走。
// =============================================================================

(function () {
  'use strict';

  // ---------- 主题色（和 风格.css 的 :root 一致）----------
  const THEME = {
    paper:      '#fdf7ee',   // 画布底色
    ink2:       '#6d5c4b',
    brandLight: '#eed4b0',
    brand:      '#deb887',
    brandDeep:  '#c9a273',
    accent:     '#ff9dbb',
    accentDeep: '#e0749a'
  };

  // 砖块按行取色：上面是奶油/焦糖，下面是藕粉/玫瑰，像一层暖色日落
  const ROW_COLORS = [
    { fill: '#f2ddc0', edge: '#e0c49f' },
    { fill: '#e8c9a0', edge: '#d3ad83' },
    { fill: '#deb887', edge: '#c49b6c' },
    { fill: '#d0a878', edge: '#b58d5f' },
    { fill: '#f0a9c0', edge: '#d98aa6' },
    { fill: '#e07f9f', edge: '#c46a88' }
  ];

  // ---------- 游戏状态 ----------
  let running = false;
  let animationId = null;
  let container = null;
  let canvas = null;
  let ctx = null;

  const ball = { x: 0, y: 0, vx: 3, vy: -3, speedScale: 1, radius: 6 };
  const paddle = { w: 92, h: 12, x: 0 };
  let bricks = [];
  const brickW = 60;
  const brickH = 20;
  const brickCols = 12;
  const brickRows = 6;
  const brickGapX = 10;
  const brickGapY = 5;
  const brickTop = 52;

  let isS = false;
  const maxScale = 10;

  // 球的拖尾 + 剩余砖块
  let trail = [];
  let remaining = 0;

  // ===========================================================================
  // 绘图小工具
  // ===========================================================================
  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function drawBackground() {
    // 纸面底色 + 顶部一层很淡的暖光
    ctx.fillStyle = THEME.paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const glow = ctx.createLinearGradient(0, 0, 0, canvas.height);
    glow.addColorStop(0, 'rgba(238, 212, 176, 0.55)');
    glow.addColorStop(0.5, 'rgba(253, 247, 238, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 顶部一条焦糖细线，和导航栏呼应
    ctx.fillStyle = THEME.brandLight;
    ctx.fillRect(0, 0, canvas.width, 3);
  }

  function drawHud() {
    ctx.save();
    ctx.font = '600 15px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = THEME.ink2;
    ctx.textAlign = 'left';
    ctx.fillText('剩余砖块  ' + remaining, 16, 28);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#9c8a76';
    ctx.fillText('移动鼠标控制挡板 · 按住 S 减速', canvas.width - 16, 28);

    ctx.restore();
  }

  function drawBricks() {
    bricks.forEach(b => {
      if (!b.alive) return;
      const col = ROW_COLORS[b.row % ROW_COLORS.length];

      // 底部一层深色，做出砖的厚度
      ctx.fillStyle = col.edge;
      roundRect(ctx, b.x, b.y + 2, brickW, brickH, 6);
      ctx.fill();

      // 砖面
      ctx.fillStyle = col.fill;
      roundRect(ctx, b.x, b.y, brickW, brickH, 6);
      ctx.fill();

      // 顶部高光
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      roundRect(ctx, b.x + 3, b.y + 2.5, brickW - 6, 3, 1.5);
      ctx.fill();
    });
  }

  function drawPaddle() {
    const y = canvas.height - paddle.h - 10;

    ctx.save();
    ctx.shadowColor = 'rgba(122, 94, 62, 0.3)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;

    const g = ctx.createLinearGradient(0, y, 0, y + paddle.h);
    g.addColorStop(0, THEME.brandLight);
    g.addColorStop(0.55, THEME.brand);
    g.addColorStop(1, THEME.brandDeep);
    ctx.fillStyle = g;
    roundRect(ctx, paddle.x, y, paddle.w, paddle.h, paddle.h / 2);
    ctx.fill();
    ctx.restore();

    // 顶上一条高光
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    roundRect(ctx, paddle.x + 6, y + 2.5, paddle.w - 12, 3, 1.5);
    ctx.fill();
  }

  function drawBall() {
    // 拖尾：越旧的越小越淡
    trail.forEach((p, i) => {
      const t = (i + 1) / trail.length;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ball.radius * (0.35 + 0.5 * t), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(224, 116, 154, ' + (0.05 + 0.16 * t).toFixed(3) + ')';
      ctx.fill();
    });

    // 球本体：粉芯 + 柔光
    ctx.save();
    ctx.shadowColor = 'rgba(224, 116, 154, 0.55)';
    ctx.shadowBlur = 12;
    const g = ctx.createRadialGradient(
      ball.x - ball.radius * 0.35, ball.y - ball.radius * 0.35, 1,
      ball.x, ball.y, ball.radius
    );
    g.addColorStop(0, '#fff3f7');
    g.addColorStop(0.45, THEME.accent);
    g.addColorStop(1, THEME.accentDeep);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ===========================================================================
  // 初始化 / 启动 / 停止
  // ===========================================================================
  function init(cont) {
    container = cont;
    container.innerHTML = '<canvas width="860" height="600"></canvas>';
    canvas = container.querySelector('canvas');
    ctx = canvas.getContext('2d');

    resetRound();
  }

  function resetRound() {
    paddle.x = canvas.width / 2 - paddle.w / 2;
    ball.x = canvas.width / 2;
    ball.y = canvas.height - 60;
    ball.vx = 3;
    ball.vy = -3;
    ball.speedScale = 1;
    trail = [];
    isS = false;

    createBricks();
  }

  function start() {
    if (running) return;
    running = true;

    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    canvas.addEventListener('mousemove', mouseMove);
    canvas.addEventListener('touchmove', touchMove, { passive: false });
    canvas.addEventListener('touchstart', touchMove, { passive: false });

    gameLoop();
  }

  function stop() {
    running = false;
    cancelAnimationFrame(animationId);
    window.removeEventListener('keydown', kd);
    window.removeEventListener('keyup', ku);
    if (canvas) {
      canvas.removeEventListener('mousemove', mouseMove);
      canvas.removeEventListener('touchmove', touchMove);
      canvas.removeEventListener('touchstart', touchMove);
    }
  }

  // ===========================================================================
  // 输入
  // ===========================================================================
  function kd(e) {
    if (e.key.toLowerCase() === 's') isS = true;
  }
  function ku(e) {
    if (e.key.toLowerCase() === 's') {
      isS = false;
      ball.speedScale = 1;
    }
  }

  // 画布被 CSS 缩放时（窄屏），要把坐标换算回画布内部坐标系
  function movePaddleTo(clientX) {
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    paddle.x = (clientX - rect.left) * scale - paddle.w / 2;

    // 别让挡板跑出画布
    paddle.x = Math.max(0, Math.min(canvas.width - paddle.w, paddle.x));
  }

  function mouseMove(e) {
    movePaddleTo(e.clientX);
  }

  function touchMove(e) {
    if (!e.touches.length) return;
    e.preventDefault();
    movePaddleTo(e.touches[0].clientX);
  }

  // ===========================================================================
  // 砖块
  // ===========================================================================
  function createBricks() {
    bricks = [];
    remaining = 0;
    for (let r = 0; r < brickRows; r++) {
      for (let c = 0; c < brickCols; c++) {
        bricks.push({
          x: c * (brickW + brickGapX) + 10,
          y: r * (brickH + brickGapY) + brickTop,
          row: r,
          alive: true
        });
        remaining++;
      }
    }
  }

  // ===========================================================================
  // 主循环
  // ===========================================================================
  function gameLoop() {
    if (!running) return;

    if (isS && ball.speedScale < maxScale) ball.speedScale += 0.01;

    // ---- 绘制 ----
    drawBackground();
    drawHud();
    drawBricks();
    drawPaddle();
    drawBall();

    // ---- 运动 ----
    ball.x += ball.vx * ball.speedScale;
    ball.y += ball.vy * ball.speedScale;

    // 记录拖尾
    trail.push({ x: ball.x, y: ball.y });
    if (trail.length > 8) trail.shift();

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

    // 挡板：只在往下掉的时候判定，并把人弹回挡板上方，避免卡住
    const paddleY = canvas.height - paddle.h - 10;
    if (
      ball.vy > 0 &&
      ball.y + ball.radius > paddleY &&
      ball.y - ball.radius < paddleY + paddle.h &&
      ball.x > paddle.x - ball.radius &&
      ball.x < paddle.x + paddle.w + ball.radius
    ) {
      ball.y = paddleY - ball.radius;
      ball.vy = -Math.abs(ball.vy);

      // 打在挡板哪一侧就往哪边弹，手感更自然
      const hit = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
      ball.vx = 3 * Math.max(-1.6, Math.min(1.6, hit));
    }

    // 砖块
    bricks.forEach(b => {
      if (!b.alive) return;
      if (
        ball.x + ball.radius > b.x && ball.x - ball.radius < b.x + brickW &&
        ball.y + ball.radius > b.y && ball.y - ball.radius < b.y + brickH
      ) {
        b.alive = false;
        remaining--;
        ball.vy = -ball.vy;
      }
    });

    // ---- 过关 / 结束 ----
    if (remaining <= 0) {
      stop();
      setTimeout(() => alert('全部打完了！厉害 ✨'), 60);
      return;
    }

    if (ball.y - ball.radius > canvas.height) {
      stop();
      setTimeout(() => alert('游戏结束'), 60);
      return;
    }

    animationId = requestAnimationFrame(gameLoop);
  }

  // 注册给 技术.html 的 loadScript()：用脚本自己的 URL 当键，改名也不会错
  const scriptEl = document.currentScript;
  window.SiteGames = window.SiteGames || {};
  window.SiteGames[scriptEl ? scriptEl.src : 'game-breakout.js'] = { init, start, stop };
})();
