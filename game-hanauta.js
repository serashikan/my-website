// =============================================================================
// 花瓣占卜（花占い）· game-hanauta.js
// -----------------------------------------------------------------------------
// 普通脚本，不是 ES module（原因见 game-breakout.js 顶部说明）。
// 载入后把接口注册到 window.SiteGames[自己的 URL]，由 技术.html 的 loadScript() 取用。
//
// 玩法：每次随机开一朵花瓣数随机的花，点一下掰掉一片花瓣，
// 按钮在「好き / 嫌い」之间来回切；最后一片掰掉时的那个词就是结果。
// 页面上**不显示还剩几片**，否则等于提前把结果算出来了。
//
// 视角：花盘是「倾斜面向用户」的透视，不是俯视的平面圆。
// 做法是把整个花盘在 y 方向压扁（每种花有自己的 tilt），背面的花瓣再画短一点。
//
// 花的样子做成了可切换的样式表（STYLES）：花瓣轮廓 / 配色 / 花心 / 茎叶
// 都按样式走。想再加一种花，照着写一个对象塞进 STYLES 就行。
//
// 配色沿用 风格.css 的「暖纸 · 焦糖」主题，「嫌い」用 logo 里的那抹蓝。
// =============================================================================

(function () {
  'use strict';

  // ---------- 画布坐标（逻辑坐标，实际按设备像素比放大绘制）----------
  const W = 520;
  const H = 500;              // 矮一点，别让「好き」按钮掉到屏幕外
  const CX = W / 2;
  const CY = 196;              // 花心位置
  // 花瓣数范围现在是每种花自己的配置，见 STYLES 里的 petals

  let ctx = null;

  // ===========================================================================
  // 颜色：只覆盖色相 + 饱和度倍率，保留每种花自己的明暗关系
  // （所以换成同一个色相，玫瑰还是深的、波斯菊还是浅的）
  // ===========================================================================
  let hueOverride = null;   // null = 用花原本的色相
  let satMul = 1;           // 饱和度的**倍率**，1 = 不变，0.08 ≈ 近乎无色

  // 🌈 疯狂变色
  let partyOn = false;
  let partyHue = 0;
  // 用户开了「减少动态效果」就大幅放慢，而不是把功能砍掉
  const partyStep = (window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 0.6 : 5;

  // 预设色：hue = null 表示原色；sat 是饱和度倍率
  const PALETTES = [
    { name: '原色',   hue: null, sat: 1 },
    { name: '粉',     hue: 338, sat: 1 },
    { name: '珊瑚',   hue: 8,   sat: 1 },
    { name: '蜜橘',   hue: 32,  sat: 1 },
    { name: '鹅黄',   hue: 48,  sat: 0.95 },
    { name: '薄荷',   hue: 145, sat: 0.60 },
    { name: '天蓝',   hue: 205, sat: 0.75 },
    { name: '紫罗兰', hue: 275, sat: 0.90 },
    { name: '雪白',   hue: 340, sat: 0.08 }
  ];

  function hexToHsl(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d > 1e-6) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: h, s: s, l: l };
  }

  function hslToHex(h, s, l) {
    h = (((h % 360) + 360) % 360) / 360;
    function f(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    function to(v) {
      const x = Math.round(Math.max(0, Math.min(1, v)) * 255);
      return (x < 16 ? '0' : '') + x.toString(16);
    }
    return '#' + to(f(p, q, h + 1 / 3)) + to(f(p, q, h)) + to(f(p, q, h - 1 / 3));
  }

  // 把一个颜色按当前覆盖设置换算成最终颜色。
  // satMul 是倍率而不是绝对值：花瓣基部色与尖端色饱和度差很多，
  // 盖成一个绝对数会把渐变里的浓淡对比抹平，整朵花发灰。
  function tint(hex) {
    if (hueOverride == null && satMul === 1) return hex;
    const c = hexToHsl(hex);
    return hslToHex(
      hueOverride == null ? c.h : hueOverride,
      Math.max(0, Math.min(1, c.s * satMul)),
      c.l
    );
  }

  // ===========================================================================
  // 通用绘制零件
  // ===========================================================================
  // 花瓣的通用填色：从基部到尖端走一道渐变，再描边 + 一条脉络
  function fillPetal(len, c, opts) {
    const o = opts || {};
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, tint(o.flip ? c.deep : c.light));
    g.addColorStop(o.mid == null ? 0.55 : o.mid, tint(c.mid));
    g.addColorStop(1, tint(o.flip ? c.light : c.deep));
    ctx.fillStyle = g;
    ctx.fill();

    ctx.strokeStyle = tint(c.edge);
    ctx.lineWidth = o.lineWidth || 1.4;
    ctx.stroke();

    if (o.vein !== false) {
      ctx.beginPath();
      ctx.moveTo(len * 0.1, 0);
      ctx.lineTo(len * 0.88, 0);
      ctx.strokeStyle = c.vein;
      ctx.lineWidth = o.veinWidth || 1.6;
      ctx.stroke();
    }
  }

  function drawGroundShadow() {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(CX, H - 42, 78, 15, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(122, 94, 62, .10)';
    ctx.fill();
    ctx.restore();
  }

  // 主茎：从花托底下长出来，微微弯
  function drawStemCurve(headX, headY, color, width) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(headX, headY + 26);
    ctx.bezierCurveTo(
      headX - 10, headY + 130,
      CX + (headX - CX) * 0.4, H - 190,
      CX, H - 40
    );
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  function drawLeaf(x, y, angle, len, wid, light, dark) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(len * 0.3, -wid, len * 0.75, -wid * 0.9, len, 0);
    ctx.bezierCurveTo(len * 0.75, wid * 0.9, len * 0.3, wid, 0, 0);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, light);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(len * 0.1, 0);
    ctx.lineTo(len * 0.88, 0);
    ctx.strokeStyle = 'rgba(255, 255, 255, .45)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  // ===========================================================================
  // 花的样式表
  // 每种花提供：尺寸范围、倾斜度、花瓣轮廓、填色、花心、附加零件、茎叶
  // 注意：path / paint / center / extra / stem 都通过 style() 取到对象后
  //       以方法形式调用，所以里面可以直接用 this。
  // ===========================================================================
  const STYLES = [
    // ---------------------------------------------------------------------
    // 波斯菊
    // ---------------------------------------------------------------------
    {
      id: 'cosmos',
      name: '波斯菊',
      tilt: 0.72,
      backLen: 0.84,
      coreR: 38,
      petalBase: 0.45,          // 花瓣从花盘半径的多少倍处长出来
      petals: [5, 13],          // 这种花的花瓣数范围（每局随机取一个）
      len: [104, 130],
      wid: [40, 50],

      // 3D 模式用的参数（花瓣几何见 game-hanauta-3d.js）
      petal3d: {
        len: 2.6, wid: 2.20, envA: 0.50, envB: 0.72,
        cup: 0.95, roll: 0.22, turn: 0.62, turnPow: 1.0,
        tilt: 0.24, leaves: true
      },
      stem3d: '#9db38f',
      color3d: { base: '#d96a90', tip: '#ffe0ea' },

      colors: {
        light: '#fff3f8', mid: '#ffb9d0', deep: '#f08cae',
        edge: 'rgba(224, 122, 157, .55)', vein: 'rgba(255, 255, 255, .55)'
      },

      path(len, wid) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(len * 0.18, -wid, len * 0.78, -wid * 0.95, len, 0);
        ctx.bezierCurveTo(len * 0.78, wid * 0.95, len * 0.18, wid, 0, 0);
        ctx.closePath();
      },

      paint(len) { fillPetal(len, this.colors); },

      // 花心：金黄的花盘 + 按黄金角铺开的花蕊点
      center(r) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.15, 0, 0, r);
        g.addColorStop(0, '#fff6e2');
        g.addColorStop(0.55, '#ffeccb');
        g.addColorStop(1, '#dfae6d');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(180, 130, 70, .4)';
        ctx.lineWidth = 1.4;
        ctx.stroke();

        ctx.fillStyle = '#c9954f';
        for (let i = 0; i < 16; i++) {
          const a = i * 2.39996;
          const rr = Math.sqrt(i / 16) * r * 0.7;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      },

      stem(headX, headY) {
        drawGroundShadow();
        drawStemCurve(headX, headY, '#a3b996', 8);
        drawLeaf(CX - 4, H - 165, -0.42, 62, 25, '#b3c7a5', '#87a07b');
        drawLeaf(CX + 4, H - 120, 0.5, 54, 22, '#b3c7a5', '#87a07b');
      }
    },

    // ---------------------------------------------------------------------
    // 玫瑰
    // ---------------------------------------------------------------------
    {
      id: 'rose',
      name: '玫瑰',
      tilt: 0.76,
      backLen: 0.88,
      coreR: 30,
      petalBase: 0.3,
      petals: [9, 14],          // 玫瑰花瓣多才像玫瑰
      len: [92, 116],
      wid: [52, 64],            // 花瓣很宽，叠在一起才像玫瑰

      // 3D：宽圆花瓣 + 内圈装饰层，单圈会收成朝鲜蓟
      petal3d: {
        len: 2.1, wid: 2.40, envA: 0.55, envB: 0.80,
        cup: 1.15, roll: 0.12, turn: 0.48, turnPow: 1.0,
        tilt: 0.80, leaves: true,
        innerRing: { ratio: 0.62, tilt: 1.15, scale: 0.60 }
      },
      stem3d: '#7f9873',
      color3d: { base: '#9c3259', tip: '#fbc9d9' },

      colors: {
        light: '#ffeef3', mid: '#e88aa8', deep: '#c2517a',
        edge: 'rgba(178, 70, 110, .5)', vein: 'rgba(255, 255, 255, .38)'
      },

      // 宽圆的花瓣，外缘几乎是圆弧
      path(len, wid) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(len * 0.1, -wid * 1.12, len * 1.02, -wid * 0.95, len, 0);
        ctx.bezierCurveTo(len * 1.02, wid * 0.95, len * 0.1, wid * 1.12, 0, 0);
        ctx.closePath();
      },

      // 玫瑰的明暗和波斯菊相反：基部深、边缘浅
      paint(len, wid) {
        fillPetal(len, this.colors, { flip: true, mid: 0.5 });
        // 基部压一道暗弧，做出花瓣兜起来的感觉
        ctx.beginPath();
        ctx.moveTo(len * 0.03, -wid * 0.52);
        ctx.quadraticCurveTo(len * 0.3, 0, len * 0.03, wid * 0.52);
        ctx.strokeStyle = 'rgba(150, 50, 90, .22)';
        ctx.lineWidth = 7;
        ctx.stroke();
      },

      // 花心：一圈圈往里卷的内层花瓣。
      // 每圈的起止角都不一样，才是「卷起来」的样子；如果都画整圈就成了靶心。
      // 花心属于花瓣本身，所以要跟着花色一起变。
      center() {
        ctx.save();
        ctx.lineCap = 'round';
        [
          { r: 30, a0: 0.4, a1: 4.6, w: 8, h: '#c2517a', a: 0.90 },
          { r: 23, a0: 2.6, a1: 0.6, w: 8, h: '#e88aa8', a: 0.95 },
          { r: 16, a0: 0.9, a1: 4.9, w: 7, h: '#c2517a', a: 0.90 },
          { r: 9, a0: 3.4, a1: 0.7, w: 6, h: '#e88aa8', a: 0.95 }
        ].forEach(t => {
          ctx.beginPath();
          ctx.arc(0, 0, t.r, t.a0, t.a1, t.a1 < t.a0);
          ctx.globalAlpha = t.a;
          ctx.strokeStyle = tint(t.h);
          ctx.lineWidth = t.w;
          ctx.stroke();
        });
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fillStyle = tint('#b8446b');
        ctx.fill();
        ctx.restore();
      },

      stem(headX, headY) {
        drawGroundShadow();
        drawStemCurve(headX, headY, '#8fa87f', 9);
        drawLeaf(CX - 8, H - 175, -0.5, 64, 27, '#a8bd98', '#7d9670');
        drawLeaf(CX + 6, H - 125, 0.55, 56, 23, '#a8bd98', '#7d9670');

        // 玫瑰嘛，得有几根刺
        ctx.save();
        ctx.fillStyle = '#7d9670';
        [[-0.1, H - 210, -1], [0.12, H - 150, 1], [-0.06, H - 95, -1]].forEach(t => {
          const x = CX + t[0] * 40;
          ctx.beginPath();
          ctx.moveTo(x, t[1]);
          ctx.lineTo(x + t[2] * 11, t[1] - 5);
          ctx.lineTo(x + t[2] * 2, t[1] + 4);
          ctx.closePath();
          ctx.fill();
        });
        ctx.restore();
      }
    },

    // ---------------------------------------------------------------------
    // 彼岸花（红花石蒜）
    // ---------------------------------------------------------------------
    {
      id: 'higanbana',
      name: '彼岸花',
      tilt: 0.62,
      backLen: 0.92,
      coreR: 20,
      petalBase: 0.5,
      petals: [5, 8],           // 真的彼岸花是 6 瓣，这里给个接近的范围
      len: [128, 154],
      wid: [17, 23],            // 细长的花被片

      // 3D：条状花瓣统一靠 turn 向内翻卷（turn > π 尖端就折回来），
      // 宽度沿全长基本不变；wid 太小会细成看不见的线
      petal3d: {
        len: 3.6, wid: 1.00, envA: 0.30, envB: 0.55,
        cup: 0.18, roll: 0.55, turn: 4.3, turnPow: 1.20,
        tilt: 0.04, scale: 0.80, leaves: false,
        stamens: { count: 7, len: 3.0, color: '#b8404f', tipColor: '#7d1f2c' }
      },
      stem3d: '#9fb08d',
      color3d: { base: '#c03347', tip: '#ff8d8d' },

      colors: {
        light: '#ffd9d6', mid: '#e8656b', deep: '#b8384a',
        edge: 'rgba(150, 45, 55, .5)', vein: 'rgba(255, 255, 255, .3)'
      },

      // 细长 + 尖端往上勾，一圈下来就是彼岸花那种翻卷的旋
      path(len, wid) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(len * 0.28, -wid * 1.15, len * 0.68, -wid * 1.5, len, -wid * 2.7);
        ctx.bezierCurveTo(len * 0.66, -wid * 0.7, len * 0.26, wid * 0.35, 0, 0);
        ctx.closePath();
      },

      paint(len, wid) {
        fillPetal(len, this.colors, { veinWidth: 1.1 });
      },

      // 基部的绿色小托
      center(r) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.15, 0, 0, r);
        g.addColorStop(0, '#dfe7cf');
        g.addColorStop(1, '#93a982');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(110, 140, 95, .6)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      },

      // 长长的雄蕊，比花瓣还长，是彼岸花最标志性的部分
      // 雄蕊属于花本身，跟着花色一起变（不然改完色就它还红着）
      extra() {
        ctx.save();
        ctx.lineCap = 'round';
        for (let i = 0; i < 7; i++) {
          const a = -Math.PI / 2 + (i - 3) * 0.42;
          const L = 158 + (i % 3) * 13;
          const tx = Math.cos(a) * L;
          const ty = Math.sin(a) * L;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(Math.cos(a) * L * 0.55, Math.sin(a) * L * 0.55, tx, ty);
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = tint('#c43e4a');
          ctx.lineWidth = 1.6;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(tx, ty, 2.5, 0, Math.PI * 2);
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = tint('#8e2233');
          ctx.fill();
        }
        ctx.restore();
      },

      // 彼岸花「花不见叶」——开花的时候没有叶子，所以只画一根花茎
      stem(headX, headY) {
        drawGroundShadow();
        drawStemCurve(headX, headY, '#9fb08d', 7);
      }
    }
  ];

  let styleIndex = 0;
  const style = () => STYLES[styleIndex];

  // ===========================================================================
  // 状态
  // ===========================================================================
  let container = null;
  let canvas = null;
  let els = {};

  let petals = [];             // { angle, len, wid, tilt, alive }
  let falling = [];            // 飘落中的花瓣
  let sparks = [];             // 结果的小礼花
  let petalStep = 0;
  let plucked = 0;
  let remaining = 0;
  let callIndex = 0;           // 0 = 好き，1 = 嫌い
  let phase = 'playing';       // playing | done
  let result = 0;
  let rot = 0;
  let targetRot = 0;
  let sway = 0;
  let shakeT = 0;

  let rafId = null;
  let running = false;

  // ---------- 渲染模式：2D（Canvas）/ 3D（three.js）----------
  let mode = '2d';
  let h3 = null;               // 3D 渲染器实例（懒加载，切过去才建）
  let loading3d = false;
  let modeError = '';          // 3D 加载失败时提示一下，不额外占一行

  // 3D 那套参数是另一份，单独从 style 里取
  function cfg3d() {
    const s = style();
    return {
      petal: s.petal3d,
      tilt: s.petal3d.tilt,
      scale: s.petal3d.scale,
      leaves: s.petal3d.leaves,
      innerRing: s.petal3d.innerRing,
      stamens: s.petal3d.stamens,
      stem: s.stem3d,
      colorBase: s.color3d.base,
      colorTip: s.color3d.tip
    };
  }

  // ===========================================================================
  // 绘制
  // ===========================================================================
  // 花盘里的花瓣：调用前坐标系已经平移到花心、并做过 tilt 压缩。
  // base 让花瓣从花盘边缘长出来，花心才不会被花瓣糊住。
  function drawPetalInDisc(a, len, wid, base) {
    const s = style();
    ctx.save();
    ctx.rotate(a);
    ctx.translate(base, 0);
    s.path(len, wid);
    s.paint(len, wid);
    ctx.restore();
  }

  // 飘落的花瓣：在屏幕坐标里画，以自身中心为原点
  function drawLoosePetal(p) {
    const s = style();
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.translate(-p.len / 2, 0);
    ctx.globalAlpha = p.alpha;
    s.path(p.len, p.wid);
    s.paint(p.len, p.wid);
    ctx.restore();
  }

  function drawFlower() {
    const s = style();
    const breath = Math.sin(sway);
    const headX = CX + breath * 5 + shakeT * 9;
    const headY = CY + Math.cos(sway * 0.8) * 3;

    s.stem(headX, headY);

    const a0 = rot + Math.sin(sway) * 0.03;

    // 按视角分前后：花盘上半部分的花瓣离观众更远，画短一点
    const back = [];
    const front = [];
    petals.forEach(p => {
      if (!p.alive) return;
      const a = p.angle + a0 + p.tilt;
      const isBack = Math.sin(a) < 0;
      (isBack ? back : front).push({
        a: a,
        len: p.len * (isBack ? s.backLen : 1),
        wid: p.wid
      });
    });

    ctx.save();
    ctx.translate(headX, headY);

    // 花盘：整体压扁做出倾斜透视
    ctx.save();
    ctx.scale(1, s.tilt);
    const base = s.coreR * s.petalBase;
    back.forEach(p => drawPetalInDisc(p.a, p.len, p.wid, base));
    front.forEach(p => drawPetalInDisc(p.a, p.len, p.wid, base));
    // 花心最后画：这样花盘是完整的一块，不会被花瓣切碎
    s.center(s.coreR);
    if (s.extra) s.extra();
    ctx.restore();

    ctx.restore();
  }

  function drawSparks() {
    sparks.forEach(sp => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, sp.alpha);
      ctx.fillStyle = sp.color;
      if (sp.heart) {
        const k = sp.size;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y + k * 0.7);
        ctx.bezierCurveTo(sp.x - k * 1.4, sp.y - k * 0.4, sp.x - k * 0.5, sp.y - k * 1.3, sp.x, sp.y - k * 0.45);
        ctx.bezierCurveTo(sp.x + k * 0.5, sp.y - k * 1.3, sp.x + k * 1.4, sp.y - k * 0.4, sp.x, sp.y + k * 0.7);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }

  function frame() {
    if (!running) return;

    // 🌈 疯狂变色：每帧推着色相（两种模式都生效）
    if (partyOn) {
      partyHue = (partyHue + partyStep) % 360;
      hueOverride = partyHue;
      satMul = 1.05 + 0.25 * Math.sin(partyHue * Math.PI / 60);
      if (els.hueVal) els.hueVal.textContent = Math.round(partyHue) + '°';
      if (mode === '3d' && h3) h3.refreshColors();
    }

    if (mode === '3d') {
      if (h3) h3.tick();
      rafId = requestAnimationFrame(frame);
      return;
    }

    ctx.clearRect(0, 0, W, H);

    drawFlower();
    falling.forEach(drawLoosePetal);
    drawSparks();

    // ---- 更新 ----
    sway += 0.014;
    shakeT *= 0.88;
    rot += (targetRot - rot) * 0.14;

    falling.forEach(p => {
      p.vy += 0.22;
      p.vx *= 0.995;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      if (p.y > H - 60) p.alpha -= 0.035;
    });
    falling = falling.filter(p => p.alpha > 0 && p.y < H + 60);

    sparks.forEach(sp => {
      sp.x += sp.vx;
      sp.y += sp.vy;
      sp.vy += sp.gravity;
      sp.rot += sp.vr;
      sp.alpha -= 0.011;
    });
    sparks = sparks.filter(sp => sp.alpha > 0);

    rafId = requestAnimationFrame(frame);
  }

  // ===========================================================================
  // 玩法
  // ===========================================================================
  function newRound() {
    const s = style();
    const n = s.petals[0] + Math.floor(Math.random() * (s.petals[1] - s.petals[0] + 1));
    petalStep = (Math.PI * 2) / n;

    const rnd = (range) => range[0] + Math.random() * (range[1] - range[0]);

    petals = [];
    for (let i = 0; i < n; i++) {
      petals.push({
        angle: -Math.PI / 2 + i * petalStep,   // 第 0 片朝上
        len: rnd(s.len),
        wid: rnd(s.wid),
        tilt: (Math.random() - 0.5) * 0.16,
        alive: true
      });
    }

    falling = [];
    sparks = [];
    plucked = 0;
    remaining = n;
    callIndex = 0;
    phase = 'playing';
    rot = 0;
    targetRot = 0;
    shakeT = 0;

    // 3D 模式下重建花（换颜色时不走这里，见 applyColor）
    if (mode === '3d' && h3) h3.setFlower(cfg3d(), n);

    updateUI();
  }

  function onCall() {
    if (phase !== 'playing' || remaining <= 0) return;

    const s = style();
    const p = petals[plucked];

    if (p && p.alive) {
      p.alive = false;

      // 3D 模式下让对应的那片花瓣飘走
      if (mode === '3d' && h3) h3.pluck(plucked);

      // 让这片花瓣从它当前的位置飘落；位置和角度都要算上花盘的压扁
      const a = p.angle + rot + p.tilt;
      const ax = Math.cos(a);
      const ay = Math.sin(a) * s.tilt;
      falling.push({
        x: CX + ax * p.len * 0.6,
        y: CY + ay * p.len * 0.6,
        vx: (Math.random() - 0.5) * 2.2,
        vy: -1.2 - Math.random() * 0.8,
        rot: Math.atan2(ay, ax),
        vr: (Math.random() - 0.5) * 0.12,
        len: p.len,
        wid: p.wid,
        alpha: 1
      });
      shakeT = 1;
    }

    plucked++;
    remaining--;

    if (remaining <= 0) {
      phase = 'done';
      result = callIndex;
      burst(result);
    } else {
      callIndex = 1 - callIndex;
      // 把下一片花瓣转到正上方，像真的在转花
      targetRot = -plucked * petalStep;
    }

    updateUI();
  }

  function burst(which) {
    const like = which === 0;
    for (let i = 0; i < 18; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const speed = 1.6 + Math.random() * 2.6;
      sparks.push({
        x: CX + (Math.random() - 0.5) * 40,
        y: CY + (Math.random() - 0.5) * 30,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        gravity: like ? -0.02 : 0.05,       // 好き 的话轻轻往上飘
        rot: 0,
        vr: 0,
        size: like ? 0 : 2 + Math.random() * 2,
        heart: like,
        alpha: 1,
        color: like
          ? 'rgba(240, 140, 174, .95)'
          : 'rgba(140, 165, 196, .9)'
      });
    }
  }

  function onReset() {
    newRound();
  }

  function onStyle(e) {
    const id = e.currentTarget.dataset.style;
    const i = STYLES.findIndex(s => s.id === id);
    if (i < 0 || i === styleIndex) return;
    styleIndex = i;
    updateStyleButtons();
    newRound();               // 换一种花就重新开一局
  }

  function updateStyleButtons() {
    if (!els.styleButtons) return;
    els.styleButtons.forEach(b => {
      const on = b.dataset.style === style().id;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function updateUI() {
    if (!els.call) return;

    if (phase === 'playing') {
      els.call.textContent = callIndex === 0 ? '好き' : '嫌い';
      els.call.className = 'hanauta-call ' + (callIndex === 0 ? 'is-like' : 'is-dislike');
      els.call.disabled = false;

      // 不显示剩余花瓣数：知道了片数就能直接算出结果，占卜就没意思了。
      // 只在还没开始时给一句操作提示，掰下第一片之后就安静下来。
      els.status.textContent = plucked === 0
        ? '点下面的按钮，一片一片掰下去' + (mode === '3d' ? ' · 可拖动旋转' : '')
        : '';
      if (modeError) els.status.textContent = modeError;
      els.status.hidden = false;
      els.result.hidden = true;
    } else {
      els.call.textContent = result === 0 ? '好き' : '嫌い';
      els.call.className = 'hanauta-call is-done ' + (result === 0 ? 'is-like' : 'is-dislike');
      els.call.disabled = true;

      els.status.hidden = true;
      els.result.hidden = false;
      els.result.textContent = result === 0 ? '結果：好き ♡' : '結果：嫌い…';
      els.result.className = 'hanauta-result ' + (result === 0 ? 'is-like' : 'is-dislike');
    }
  }

  // ===========================================================================
  // 颜色 / 模式
  // ===========================================================================
  // 换颜色不重开花：2D 直接重画，3D 原地重算顶点色
  function applyColor() {
    syncColorUI();
    if (mode === '3d' && h3) h3.refreshColors();
  }

  function syncColorUI() {
    if (els.swatches) {
      els.swatches.forEach(b => {
        const p = b.__pal;
        // 疯狂变色时色相一直在动，就别让某个色点闪来闪去了
        b.classList.toggle('is-active', !partyOn &&
          p.hue === hueOverride && p.sat === satMul);
      });
    }
    if (els.hueVal) {
      els.hueVal.textContent = hueOverride == null ? '原色' : Math.round(hueOverride) + '°';
    }
  }

  function onSwatch(e) {
    const p = e.currentTarget.__pal;
    hueOverride = p.hue;
    satMul = p.sat;
    applyColor();
  }

  function onHue(e) {
    hueOverride = Number(e.currentTarget.value);
    satMul = 1;                 // 拖滑杆 = 只要色相，浓淡交回花自己的
    applyColor();
  }

  function onParty() {
    partyOn = !partyOn;
    els.party.classList.toggle('is-active', partyOn);
    els.party.textContent = partyOn ? '🛑 快停下' : '🌈 疯狂变色';
    if (partyOn) {
      partyHue = hueOverride == null ? 338 : hueOverride;   // 从当前色相接着转
      satMul = 1;
    } else {
      hueOverride = null;
      satMul = 1;
      applyColor();
    }
    syncColorUI();
  }

  // ---------- 2D / 3D 切换 ----------
  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const old = document.querySelector('script[data-hanauta="' + src + '"]');
      if (old && old.dataset.loaded === '1') return resolve();
      const el = document.createElement('script');
      el.src = src;
      el.dataset.hanauta = src;
      el.onload = () => { el.dataset.loaded = '1'; resolve(); };
      el.onerror = () => reject(new Error('加载失败：' + src));
      document.head.appendChild(el);
    });
  }

  async function setMode(next) {
    if (next === mode || loading3d) return;

    els.modeButtons.forEach(b => {
      const on = b.dataset.mode === next;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    if (next === '2d') {
      mode = '2d';
      modeError = '';
      if (h3) { h3.stop(); h3.dispose(); h3 = null; }
      els.stage3d.hidden = true;
      els.canvas2d.style.display = '';
      els.canvas2d.style.width = W + 'px';
      updateUI();
      return;
    }

    // → 3D
    loading3d = true;
    if (els.status) els.status.textContent = '3D 加载中…';
    try {
      await loadScriptOnce('lib/three.min.js');
      await loadScriptOnce('game-hanauta-3d.js');
      if (!window.THREE || !window.Hanauta3D) throw new Error('three.js 或 3D 渲染器没就绪');

      els.stage3d.hidden = false;
      els.canvas2d.style.display = 'none';
      els.stage3d.innerHTML = '';

      h3 = window.Hanauta3D.create(els.stage3d, { tint: tint });
      h3.setFlower(cfg3d(), petals.length || 1);
      // 已经掰掉的那些，在建花后补上
      for (let i = 0; i < plucked; i++) h3.pluck(i);
      h3.start();
      mode = '3d';
      modeError = '';
    } catch (err) {
      // 加载失败就老实退回 2D，别把游戏卡死
      els.stage3d.hidden = true;
      els.canvas2d.style.display = '';
      els.modeButtons.forEach(b => {
        const on = b.dataset.mode === '2d';
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      modeError = '3D 加载失败，已留在 2D';
      console.error(err);
    } finally {
      loading3d = false;
      updateUI();
    }
  }

  function onMode(e) {
    setMode(e.currentTarget.dataset.mode);
  }

  // ===========================================================================
  // 生命周期
  // ===========================================================================
  function init(cont) {
    container = cont;

    // 这些是模块级状态，切换菜单后模块不会重新加载，
    // 所以每次 init 都要复位 —— 否则再进来时 mode 还是 '3d'
    // 但渲染器已经被 stop() 销毁，setMode('3d') 会 early-return，画面就空了。
    mode = '2d';
    h3 = null;
    loading3d = false;
    modeError = '';
    partyOn = false;

    const styleButtons = STYLES.map(s =>
      `<button type="button" class="hanauta-style" data-style="${s.id}" aria-pressed="false">${s.name}</button>`
    ).join('');
    const modeButtons = `
      <button type="button" class="hanauta-mode is-active" data-mode="2d" aria-pressed="true">2D</button>
      <button type="button" class="hanauta-mode" data-mode="3d" aria-pressed="false">3D</button>`;
    const swatches = PALETTES.map(p =>
      `<button type="button" class="hanauta-swatch" data-name="${p.name}" aria-label="${p.name}"
        style="background:${p.hue == null
          ? 'linear-gradient(135deg, #ffd6e4, #e0749a)'
          : hslToHex(p.hue, 0.62 * p.sat, 0.66)}"></button>`
    ).join('');

    container.innerHTML = `
      <div class="hanauta">
        <div class="hanauta-toolbar">
          <div class="hanauta-styles" role="group" aria-label="花的样式">${styleButtons}</div>
          <div class="hanauta-modes" role="group" aria-label="渲染模式">${modeButtons}</div>
        </div>
        <div class="hanauta-stage">
          <canvas class="hanauta-canvas"></canvas>
          <div class="hanauta-stage3d" hidden></div>
        </div>
        <div class="hanauta-colors" role="group" aria-label="花的颜色">
          ${swatches}
          <input type="range" class="hanauta-hue" min="0" max="360" step="1" value="338"
                 aria-label="色相">
          <span class="hanauta-hueval">原色</span>
          <button type="button" class="hanauta-party">🌈 疯狂变色</button>
        </div>
        <div class="hanauta-readout">
          <p class="hanauta-status"></p>
          <p class="hanauta-result" hidden></p>
        </div>
        <div class="hanauta-actions">
          <button type="button" class="hanauta-call"></button>
          <button type="button" class="hanauta-reset">重置</button>
        </div>
      </div>`.trim();   // 去掉首尾空白：外层 #txtBox 是 pre-wrap，行首换行会变成空行

    canvas = container.querySelector('.hanauta-canvas');
    ctx = canvas.getContext('2d');

    // 按设备像素比放大绘制，缩放后依然清晰
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 必须把显示尺寸钉死：不写的话浏览器会按 canvas 的属性宽度（W × dpr）显示，
    // 于是在 Retina 屏上整朵花会变成两倍大、在普通屏上又是另一个尺寸。
    // max-width 由 风格.css 负责（窄屏等比缩放）。
    canvas.style.width = W + 'px';

    els = {
      status: container.querySelector('.hanauta-status'),
      result: container.querySelector('.hanauta-result'),
      call: container.querySelector('.hanauta-call'),
      reset: container.querySelector('.hanauta-reset'),
      styleButtons: Array.from(container.querySelectorAll('.hanauta-style')),
      modeButtons: Array.from(container.querySelectorAll('.hanauta-mode')),
      swatches: Array.from(container.querySelectorAll('.hanauta-swatch')),
      hue: container.querySelector('.hanauta-hue'),
      hueVal: container.querySelector('.hanauta-hueval'),
      party: container.querySelector('.hanauta-party'),
      canvas2d: canvas,
      stage3d: container.querySelector('.hanauta-stage3d')
    };

    // 色点需要拿到自己的配色对象
    els.swatches.forEach(b => {
      b.__pal = PALETTES.find(p => p.name === b.dataset.name);
      b.addEventListener('click', onSwatch);
    });

    els.call.addEventListener('click', onCall);
    els.reset.addEventListener('click', onReset);
    els.styleButtons.forEach(b => b.addEventListener('click', onStyle));
    els.modeButtons.forEach(b => b.addEventListener('click', onMode));
    els.hue.addEventListener('input', onHue);
    els.party.addEventListener('click', onParty);

    updateStyleButtons();
    syncColorUI();
    newRound();
  }

  function start() {
    if (running) return;
    running = true;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (h3) { h3.stop(); h3.dispose(); h3 = null; }
    if (els.call) els.call.removeEventListener('click', onCall);
    if (els.reset) els.reset.removeEventListener('click', onReset);
    if (els.styleButtons) els.styleButtons.forEach(b => b.removeEventListener('click', onStyle));
    if (els.modeButtons) els.modeButtons.forEach(b => b.removeEventListener('click', onMode));
    if (els.hue) els.hue.removeEventListener('input', onHue);
    if (els.party) els.party.removeEventListener('click', onParty);
  }

  // 注册给 技术.html 的 loadScript()：用脚本自己的 URL 当键，改名也不会错
  const scriptEl = document.currentScript;
  window.SiteGames = window.SiteGames || {};
  window.SiteGames[scriptEl ? scriptEl.src : 'game-hanauta.js'] = { init, start, stop };
})();
