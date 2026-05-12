let cur = document.querySelector('.mouse');

document.addEventListener('mousemove', function(e) {

    cur.style.left = e.clientX + "px";
    cur.style.top  = e.clientY + "px";
})

// 拿鼠标div
const mouse = document.querySelector('.mouse');

// 鼠标图片地址
const mouseImgList = [
  "url('../图片/指针去白.png')",
  "url('../图片/miku指针去白1.gif')",
];

let idx = 0;

// 默认第一张
mouse.style.backgroundImage = mouseImgList[0];

// 按 Z 切换
document.addEventListener('keydown', e => {
  if(e.key.toLowerCase() === 'z'){
    idx = (idx + 1) % mouseImgList.length;
    mouse.style.backgroundImage = mouseImgList[idx];
  }
})

const colorList = [
  // 温润贵气金
  "#E4C792",
  "#D9B57E",
  "#F0D3A6",
  "#CFA976",
  // 复古烟火暖红 / 暗橘
  "#C97C65",
  "#B86B52",
  "#D48C70",
  // 柔光提亮 温柔高光
  "#F5E9D7",
  "#FFF5E6"
];

document.onclick = e => {
  for(let i=0; i<20; i++){
    let dot = document.createElement("div")
    let randomColor = colorList[Math.floor(Math.random() * colorList.length)];
    dot.style.position = "fixed";        // 固定在页面
dot.style.left = e.clientX + "px";   // 点击X坐标
dot.style.top = e.clientY + "px";    // 点击Y坐标
dot.style.width = "0.5px";             // 宽度
dot.style.height = "0.5px";            // 高度
dot.style.background = randomColor;   
dot.style.borderRadius = "50%";      // 圆形
dot.style.pointerEvents = "none";    // 不影响鼠标
dot.style.boxShadow = "0 0 6px #ffdd99, 0 0 14px rgba(255,210,130,0.7)"

    document.body.appendChild(dot)

    // 随机方向
    let ang = Math.random() * Math.PI * 2
    let speed = 3;
    let vx = Math.cos(ang) * speed
    let vy = Math.sin(ang) * speed

    let x = e.clientX;
    let y = e.clientY;
    
    let gravity = 0.12
    let opacity = 1

    let lastX = x;
    let lastY = y;
    const tailArr = []; // 存放当前粒子的拖尾小圆点

    function createTail(x, y, color) {
  let tail = document.createElement('div');
  tail.style.position = 'fixed';
  tail.style.left = x + 'px';
  tail.style.top = y + 'px';
  tail.style.width = '6px';
  tail.style.height = '6px';
  tail.style.borderRadius = '50%';
  tail.style.background = color;
  tail.style.pointerEvents = 'none';
  tail.style.opacity = 0.6;
  document.body.appendChild(tail);
  let tailOpa = 0.6;
  function fadeTail() {
    tailOpa -= 0.08;
    tail.style.opacity = tailOpa;
    if(tailOpa > 0) {
      requestAnimationFrame(fadeTail);
    } else {
      tail.remove();
    }
  }
  fadeTail();
}



    function run(){
        vy += gravity;

        x += vx;
        y += vy;

        opacity -= 0.03;

        createTail(lastX, lastY, randomColor);
        lastX = x;
        lastY = y;

        dot.style.left = x + "px";
        dot.style.top = y + "px";
        dot.style.opacity = opacity;

        if(opacity > 0){
        requestAnimationFrame(run);
      }else{
        dot.remove();
      }
    }
    run();
  }
}
