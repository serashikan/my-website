const originBodyStyle = {
    margin: "0",
  minHeight: "100vh",
  background: "linear-gradient(45deg, #ffeede, #ffe6dd, #ffe0d2, #fff0e8, #ffe8df)",
  backgroundSize: "400% 400%",
  cursor: "none",
  display: "flex",
  flexDirection: "column",
  padding: "0px 0 500px",
  gap: "10px",
  width:"",
  height:"",
  overflowY:""
};

let bgAudio = new Audio("音频/爆弾.m4a");
bgAudio.loop = true;
bgAudio.volume = 0.35;

// 烟花 最终完美版 无BUG
let fireCanvas = null;
let fireCtx = null;
let fireOn = false;
let rafId = null;
let spawnTimer = null;

// 升空弹道单体
class Rocket {
  constructor() {
    this.x = Math.random() * window.innerWidth;
    this.y = window.innerHeight;
    // 爆炸高度（你可以随便改这两个数字）
    this.top = 200 + Math.random() * 150;
    this.speed = 4;
    this.done = false;
    this.color = `hsl(${Math.random() * 360}, 100%, 60%)`;
  }
  update() {
    this.y -= this.speed;
    if (this.y <= this.top) {
      this.done = true;
      return true;
    }
    return false;
  }
  draw(ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(this.x, this.y, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 爆炸粒子
class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 6;
    this.vy = (Math.random() - 0.5) * 6;
    this.alpha = 1;
    this.decay = 0.02;
    this.color = color;
    this.size = Math.random() * 2 + 1;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.03;
    this.alpha -= this.decay;
  }
  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

let rockets = [];
let particles = [];

// 启动烟花
function startFireworks() {
  if (fireOn) return;
  fireOn = true;

  // 创建画布挂到html根
  fireCanvas = document.createElement('canvas');
  fireCtx = fireCanvas.getContext('2d');
  fireCanvas.width = window.innerWidth;
  fireCanvas.height = window.innerHeight;
  fireCanvas.style.cssText = `
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 99999;
    background: transparent;
  `;
  document.documentElement.appendChild(fireCanvas);

  // 窗口适配
  window.addEventListener('resize', () => {
    if(!fireCanvas) return;
    fireCanvas.width = window.innerWidth;
    fireCanvas.height = window.innerHeight;
  });

  // 定时生成火箭 数值越小越密
  spawnTimer = setInterval(() => {
    if(!fireOn) return;
    rockets.push(new Rocket());
  }, 320);


  // 主动画循环 拖影清屏 观感最自然
  function animate() {
    if(!fireOn) return;
    rafId = requestAnimationFrame(animate);

    // 半透明覆盖清屏 = 自然拖影，不闪不突兀
    fireCtx.clearRect(0, 0, fireCanvas.width, fireCanvas.height);

    // 更新绘制火箭
    rockets.forEach((r, idx) => {
      let boom = r.update();
      r.draw(fireCtx);
      if (boom) {
        // 生成爆炸粒子
        for(let i = 0; i < 60; i++) {
          particles.push(new Particle(r.x, r.y, r.color));
        }
        rockets.splice(idx, 1);
      }
    });

    // 更新绘制粒子
    particles = particles.filter(p => p.alpha > 0);
    particles.forEach(p => {
      p.update();
      p.draw(fireCtx);
    });
  }
  animate();
}

// 停止烟花 彻底干净
function stopFireworks() {
  fireOn = false;

  if (spawnTimer) {
    clearInterval(spawnTimer);
    spawnTimer = null;
  }
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  rockets = [];
  particles = [];

  if (fireCanvas) {
    fireCanvas.remove();
    fireCanvas = null;
    fireCtx = null;
  }
}






// 1. 定义你自己的密码
const correctPassword = "wzhwxhn"; // 你可以改成自己的密码，比如 "maka123"

// 2. 获取按钮元素
const btn = document.getElementById('Fire');

// 3. 给按钮加上点击事件
btn.addEventListener('click', function() {
  // 弹出一个输入框，让用户输入密码
  const inputPassword = prompt("请输入密码才能继续：");

  // 处理用户操作：
  // - 如果用户点了“取消”，inputPassword 会是 null，直接结束
  if (inputPassword === null) {
    return;
  }


  // - 如果用户输入的密码和正确密码一致
  if (inputPassword === correctPassword) {
    alert("密码正确！✨");
    // --- 在这里写你要执行的后续代码，比如切换背景 ---
    // 举个例子：
    // document.body.style.background = "...";
    document.body.classList.add('hidden-all');
    document.body.style.background = 
    "url('图片/花火大会.png'), linear-gradient(180deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)";
    document.body.style.backgroundSize = "1806px 1010px,100% 200%";
    document.body.style.backgroundPosition = "center 200px,center";
    document.body.style.backgroundRepeat = "no-repeat,no-repeat";
    document.body.style.width = '1500px';
    document.body.style.height = '1010px';
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.overflowY= "hidden";
    document.body.style.zIndex = "-1";
    startFireworks();
    bgAudio.play();
    
  

} else {
    // - 如果密码错误
    alert("密码错误，请重试！");
  }
});

document.addEventListener('keyup',function(e){
    if (e.key == 'b'){
        document.body.classList.remove('hidden-all');
        Object.assign(document.body.style, originBodyStyle);
        stopFireworks();
        bgAudio.pause();
        bgAudio.currentTime = 0;
    }
})