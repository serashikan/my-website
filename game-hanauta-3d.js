// =============================================================================
// 花瓣占卜 · 3D 渲染器   game-hanauta-3d.js
// -----------------------------------------------------------------------------
// 普通脚本，不是 ES module。它只负责「把花画成 3D」，
// 玩法状态（掰了几片、现在念好き还是嫌い、结不结束）全都留在 game-hanauta.js 里。
//
// 由 game-hanauta.js 切到 3D 模式时按需注入，注册到 window.Hanauta3D。
// 依赖 window.THREE（three.js r160 UMD，同目录 lib/three.min.js）。
//
// 三个关键点（都踩过坑）：
//   1. 顶点色要能原地重算，否则「疯狂变色」每帧重建几何会卡死
//   2. canvas.style.width 必须钉死，否则 Retina 上整朵花变两倍大
//   3. 打光以环境光为主，平行光一强花瓣就变成低多边形折纸
// =============================================================================

(function () {
  'use strict';

  // 和 2D 版一致的逻辑尺寸，切换时不会跳
  var W = 520;
  var H = 500;   // 和 2D 版保持一致

  var renderer = null;
  var scene = null;
  var camera = null;
  var containerEl = null;
  var tintFn = function (h) { return h; };

  var flowerGroup = null;
  var petalObjs = [];        // { pivot, mesh, alive, dying, t }
  var stamenMats = [];
  var shadowMesh = null;

  var theta = 0.42, phi = 1.20, dist = 12.6;
  var targetSpin = 0, spin = 0;
  var autoSpin = true;
  var dragging = false, lastX = 0, lastY = 0;
  var rafBound = false;
  var running = false;

  // ===========================================================================
  // 花瓣几何：参数化曲面
  //   len/wid   长度、最大宽度
  //   envA/envB 宽度包络（柳叶形 vs 长条形）
  //   cup       横截面张开弧度：0 = 平，1 = 半个槽
  //   roll      沿长轴逐渐翻转（条状花瓣靠它扭）
  //   turn      中心线总转角。超过 π 尖端就会向内翻卷
  //   turnPow   卷曲集中在哪一段，越大越靠尖端
  // ===========================================================================
  function makePetalGeometry(p, tint) {
    var segU = 40, segV = 20;
    var positions = [], colors = [], indices = [], ts = [];
    var THREEC = window.THREE;
    var cBase = new THREEC.Color(tint(p.colorBase));
    var cTip = new THREEC.Color(tint(p.colorTip));
    var c = new THREEC.Color();

    var envA = p.envA == null ? 0.62 : p.envA;
    var envB = p.envB == null ? 1.10 : p.envB;
    var arc = (p.cup == null ? 0.55 : p.cup) * Math.PI * 0.5;
    var roll = p.roll || 0;
    var turn = p.turn || 0;
    var turnPow = p.turnPow == null ? 1 : p.turnPow;

    // 中心线：转角沿长度渐增的一条曲线，逐段积分出来
    var spine = [];
    var th = 0, px = 0, py = 0;
    var step = 1 / segU, ds = p.len * step;
    for (var i = 0; i <= segU; i++) {
      var u = i * step;
      spine.push({ x: px, y: py, th: th });
      if (i < segU) {
        th += turn * (Math.pow(u + step, turnPow + 1) - Math.pow(u, turnPow + 1));
        px += Math.cos(th) * ds;
        py += Math.sin(th) * ds;
      }
    }

    for (var m = 0; m <= segU; m++) {
      var um = m * step;
      var sp = spine[m];
      var env = Math.pow(Math.sin(Math.PI * Math.pow(um, envA)), envB);
      var halfW = p.wid * 0.5 * env;
      var r = roll * um, cr = Math.cos(r), sr = Math.sin(r);
      var nx = -Math.sin(sp.th), ny = Math.cos(sp.th);

      for (var j = 0; j <= segV; j++) {
        var v = (j / segV) * 2 - 1;
        var ang = v * arc;
        var lw = Math.sin(ang) * halfW;
        var lh = (1 - Math.cos(ang)) * halfW;
        var w2 = lw * cr - lh * sr;
        var h2 = lw * sr + lh * cr;
        var t = Math.pow(um, 0.85);

        ts.push(t);
        positions.push(sp.x + nx * h2, sp.y + ny * h2, w2);
        c.copy(cBase).lerp(cTip, t);
        colors.push(c.r, c.g, c.b);
      }
    }

    var rowLen = segV + 1;
    for (var a = 0; a < segU; a++) {
      for (var b = 0; b < segV; b++) {
        var i0 = a * rowLen + b, i1 = i0 + 1;
        var i2 = i0 + rowLen, i3 = i2 + 1;
        indices.push(i0, i2, i1, i1, i2, i3);
      }
    }

    var g = new THREEC.BufferGeometry();
    g.setAttribute('position', new THREEC.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREEC.Float32BufferAttribute(colors, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    // 留一份原始颜色 + 每个顶点在渐变里的位置，方便原地重算顶点色
    g.userData = { ts: ts, colorBase: p.colorBase, colorTip: p.colorTip };
    return g;
  }

  function makeGroundShadow() {
    var THREEC = window.THREE;
    var cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    var g2 = cv.getContext('2d');
    var grd = g2.createRadialGradient(64, 64, 4, 64, 64, 62);
    grd.addColorStop(0, 'rgba(122, 94, 62, .28)');
    grd.addColorStop(1, 'rgba(122, 94, 62, 0)');
    g2.fillStyle = grd;
    g2.fillRect(0, 0, 128, 128);
    var tex = new THREEC.CanvasTexture(cv);
    tex.colorSpace = THREEC.SRGBColorSpace;
    var mesh = new THREEC.Mesh(
      new THREEC.PlaneGeometry(7, 7),
      new THREEC.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  // ===========================================================================
  // 建场景
  // ===========================================================================
  function create(el, opts) {
    containerEl = el;
    if (opts && opts.tint) tintFn = opts.tint;
    var THREEC = window.THREE;

    renderer = new THREEC.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREEC.SRGBColorSpace;
    // updateStyle=false：尺寸交给 CSS（max-width:100% + height:auto），
    // 但 canvas 的属性宽度要按像素比放大，才够清晰。
    renderer.setSize(W, H, false);
    el.appendChild(renderer.domElement);

    scene = new THREEC.Scene();
    camera = new THREEC.PerspectiveCamera(34, W / H, 0.1, 100);

    // 打光：环境光占大头。平行光一强，平坦花瓣就每个面一块死高光。
    scene.add(new THREEC.HemisphereLight(0xfff6e8, 0xf0dcc8, 2.0));
    var key = new THREEC.DirectionalLight(0xfff1dc, 0.85);
    key.position.set(4.5, 7.5, 5.5);
    scene.add(key);
    var fill = new THREEC.DirectionalLight(0xffe0ea, 0.45);
    fill.position.set(-6, 1.5, 3);
    scene.add(fill);
    var rim = new THREEC.DirectionalLight(0xe0d2ff, 0.35);
    rim.position.set(-2, 4.5, -7);
    scene.add(rim);

    bindDrag();
    return api;
  }

  // ===========================================================================
  // 建花
  // ===========================================================================
  function clearFlower() {
    if (!flowerGroup) return;
    scene.remove(flowerGroup);
    flowerGroup.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
    });
    flowerGroup = null;
    petalObjs = [];
    stamenMats = [];
  }

  // cfg: 一种花的完整配置（petal/tilt/scale/innerRing/stamens/colorBase/colorTip/stem）
  function setFlower(cfg, count) {
    var THREEC = window.THREE;
    clearFlower();

    var g = new THREEC.Group();
    var tint = tintFn;

    // 茎
    var curve = new THREEC.CatmullRomCurve3([
      new THREEC.Vector3(0, -6.4, 0),
      new THREEC.Vector3(0.30, -4.2, 0.15),
      new THREEC.Vector3(-0.18, -2.0, -0.12),
      new THREEC.Vector3(0, -0.40, 0)
    ]);
    g.add(new THREEC.Mesh(
      new THREEC.TubeGeometry(curve, 48, 0.105, 10, false),
      new THREEC.MeshStandardMaterial({ color: cfg.stem || '#9db38f', roughness: 0.8 })
    ));

    // 叶子（复用花瓣几何；不参与变色）
    if (cfg.leaves) {
      var leafGeo = makePetalGeometry({
        len: 1.9, wid: 1.05, cup: 0.84, roll: 0.35, turn: 0.35, turnPow: 1.0,
        colorBase: '#7d9670', colorTip: '#b9cda9'
      }, function (h) { return h; });
      leafGeo.userData = null;              // 叶子不跟着变色
      var leafMat = new THREEC.MeshStandardMaterial({
        vertexColors: true, side: THREEC.DoubleSide, roughness: 0.78
      });
      [[3.9, 0.5], [2.8, 3.5]].forEach(function (L) {
        var m = new THREEC.Mesh(leafGeo, leafMat);
        m.position.set(0.16, -L[0], 0.06);
        m.rotation.y = L[1];
        m.rotation.z = 0.32;
        g.add(m);
      });
    }

    // 花托
    var rec = new THREEC.Mesh(
      new THREEC.SphereGeometry(0.40, 24, 16),
      new THREEC.MeshStandardMaterial({ color: '#9db38f', roughness: 0.85 })
    );
    rec.position.y = -0.20;
    rec.scale.set(1, 0.72, 1);
    g.add(rec);

    // 花瓣：一片几何体，摆 count 份
    var petalMat = new THREEC.MeshStandardMaterial({
      vertexColors: true, side: THREEC.DoubleSide, roughness: 0.62
    });
    var geo = makePetalGeometry(Object.assign(
      { colorBase: cfg.colorBase, colorTip: cfg.colorTip },
      cfg.petal
    ), tint);

    function ring(n, tilt, scale, phase) {
      for (var i = 0; i < n; i++) {
        var pivot = new THREEC.Object3D();
        pivot.rotation.y = ((i + phase) / n) * Math.PI * 2;
        var m = new THREEC.Mesh(geo, petalMat);
        m.rotation.z = tilt + (Math.random() - 0.5) * 0.16;
        m.scale.setScalar(scale * (0.90 + Math.random() * 0.18));
        pivot.add(m);
        g.add(pivot);
        if (phase === 0) {
          petalObjs.push({ pivot: pivot, mesh: m, alive: true, dying: false, t: 0 });
        }
      }
    }

    // 外圈才是「可以掰掉」的花瓣，内圈纯装饰
    ring(count, cfg.tilt || 0.25, 1, 0);
    if (cfg.innerRing) {
      ring(Math.max(3, Math.round(count * cfg.innerRing.ratio)),
        cfg.innerRing.tilt, cfg.innerRing.scale, 0.5);
    }

    // 雄蕊
    if (cfg.stamens) {
      var sMat = new THREEC.MeshStandardMaterial({ color: tint(cfg.stamens.color), roughness: 0.7 });
      var tMat = new THREEC.MeshStandardMaterial({ color: tint(cfg.stamens.tipColor), roughness: 0.55 });
      sMat.userData.base = cfg.stamens.color;
      tMat.userData.base = cfg.stamens.tipColor;
      stamenMats.push(sMat, tMat);

      for (var s = 0; s < cfg.stamens.count; s++) {
        var sa = (s / cfg.stamens.count) * Math.PI * 2 + 0.35;
        var SL = cfg.stamens.len * (0.86 + Math.random() * 0.28);
        var dir = new THREEC.Vector3(Math.cos(sa), 0, Math.sin(sa));
        var q0 = new THREEC.Vector3(0, -0.05, 0);
        var q1 = dir.clone().multiplyScalar(SL * 0.55); q1.y = SL * 0.26;
        var q2 = dir.clone().multiplyScalar(SL); q2.y = SL * 0.60;
        g.add(new THREEC.Mesh(
          new THREEC.TubeGeometry(new THREEC.QuadraticBezierCurve3(q0, q1, q2), 20, 0.032, 6, false),
          sMat
        ));
        var tip = new THREEC.Mesh(new THREEC.SphereGeometry(0.072, 10, 8), tMat);
        tip.position.copy(q2);
        g.add(tip);
      }
    }

    shadowMesh = makeGroundShadow();
    g.add(shadowMesh);
    g.scale.setScalar(cfg.scale || 1);

    flowerGroup = g;
    targetSpin = 0;
    spin = 0;
    scene.add(g);
  }

  // ===========================================================================
  // 掰花瓣：让第 i 片往下飘走
  // ===========================================================================
  function pluck(i) {
    var p = petalObjs[i];
    if (!p || !p.alive) return;
    p.alive = false;
    p.dying = true;
    p.t = 0;
    // 下一片转到镜头正前方（本地 +Z 方向）
    var next = petalObjs[i + 1];
    if (next && next.alive) {
      var n = petalObjs.length;
      var a = (i + 1) / n * Math.PI * 2;
      targetSpin = -Math.PI / 2 - a;
    }
  }

  // 只改颜色不重建几何：顶点色原地重算
  function refreshColors() {
    if (!flowerGroup) return;
    var tint = tintFn;
    var a = new window.THREE.Color();
    var b = new window.THREE.Color();
    var c = new window.THREE.Color();

    flowerGroup.traverse(function (o) {
      if (!o.isMesh) return;
      var g = o.geometry;
      var d = g && g.userData;
      if (!d || !d.ts) return;
      a.set(tint(d.colorBase));
      b.set(tint(d.colorTip));
      var attr = g.attributes.color;
      for (var i = 0; i < d.ts.length; i++) {
        c.copy(a).lerp(b, d.ts[i]);
        attr.setXYZ(i, c.r, c.g, c.b);
      }
      attr.needsUpdate = true;
    });

    stamenMats.forEach(function (m) { m.color.set(tint(m.userData.base)); });
  }

  // ===========================================================================
  // 每帧
  // ===========================================================================
  function tick() {
    if (!running || !renderer) return;

    if (autoSpin) theta += 0.0022;
    spin += (targetSpin - spin) * 0.12;
    if (flowerGroup) flowerGroup.rotation.y = spin;

    // 正在掉落的花瓣：往外飘 + 下坠 + 缩小
    petalObjs.forEach(function (p) {
      if (!p.dying) return;
      p.t += 0.016;
      p.pivot.position.y -= 0.075;
      p.pivot.position.x += 0.012;
      p.pivot.rotation.z += 0.05;
      var k = Math.max(0, 1 - p.t / 0.9);
      p.pivot.scale.setScalar(k);
      if (k <= 0) {
        p.dying = false;
        p.pivot.visible = false;
      }
    });

    var cy = 1.15;
    camera.position.set(
      Math.sin(theta) * Math.sin(phi) * dist,
      cy + Math.cos(phi) * dist,
      Math.cos(theta) * Math.sin(phi) * dist
    );
    camera.lookAt(0, cy - 0.35, 0);
    renderer.render(scene, camera);
  }

  function resize() {
    if (!renderer) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
  }

  function dispose() {
    running = false;
    clearFlower();
    if (renderer) {
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      renderer = null;
    }
    scene = null;
    camera = null;
  }

  // ===========================================================================
  // 拖动旋转
  // ===========================================================================
  function bindDrag() {
    var el = renderer.domElement;
    el.style.cursor = 'grab';
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', function (e) {
      dragging = true;
      autoSpin = false;
      lastX = e.clientX; lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      theta -= (e.clientX - lastX) * 0.008;
      phi = Math.max(0.30, Math.min(1.48, phi - (e.clientY - lastY) * 0.006));
      lastX = e.clientX; lastY = e.clientY;
    });
    function end(e) {
      dragging = false;
      if (e && e.pointerId != null && el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
    }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  var api = {
    setFlower: setFlower,
    pluck: pluck,
    refreshColors: refreshColors,
    tick: tick,
    resize: resize,
    dispose: dispose,
    start: function () { running = true; },
    stop: function () { running = false; }
  };

  window.Hanauta3D = { create: create };
})();
