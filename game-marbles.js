// 六层独立钉阵；固定时间步长，圆形碰撞与斜面反弹决定实际落洞。
(function () {
  'use strict';
  const W=360,H=260,R=5,LEVELS=6,PRIZE=20000,STEP=1/180,KEY='sera-marbles-v1';
  // 固定公开的晋级洞位；调整几何挑战，不篡改实时轨迹或中奖结果。
  const TARGETS=[0,1,3,1,1,4];
  const centers=[52,116,180,244,308];
  const pegs=[];
  const rowStart=[0,8,15,23,30];
  for(let row=0;row<5;row++)for(let col=0;col<(row%2?7:8);col++)pegs.push({x:40+col*40+(row%2?20:0),y:65+row*25,r:5});
  const rails=[];
  for(let i=0;i<5;i++){
    const x=centers[i];
    rails.push([x-32,193,x-19,216],[x+32,193,x+19,216],[x-19,216,x-19,246],[x+19,216,x+19,246]);
  }
  function fresh(){return {challengeId:window.CasinoWallet?.challengeId||null,inventory:0,queue:0,balls:[],launched:0,lost:0,wins:0,deepest:0,visits:[0,0,0,0,0,0]};}
  let model=fresh(),root,canvas,ctx,raf=0,last=0,acc=0,feed=0,saveClock=0,disposed=true;
  let hits=[],message='买入弹珠，再选择这次要投放的数量。';
  function load(){model=fresh();try{const s=JSON.parse(localStorage.getItem(KEY));if(!s||s.challengeId!==(window.CasinoWallet?.challengeId||null))return;for(const k of ['inventory','queue','launched','lost','wins','deepest'])if(Number.isSafeInteger(s[k])&&s[k]>=0)model[k]=s[k];if(Array.isArray(s.visits)&&s.visits.length===6&&s.visits.every(n=>Number.isSafeInteger(n)&&n>=0))model.visits=s.visits;model.balls=Array.isArray(s.balls)?s.balls.filter(b=>Number.isInteger(b.level)&&b.level>=0&&b.level<6&&['x','y','vx','vy','age'].every(k=>Number.isFinite(b[k]))&&b.x>=0&&b.x<=W&&b.y>=0&&b.y<=H).slice(0,60):[];}catch(_){} }
  function save(){try{localStorage.setItem(KEY,JSON.stringify(model));}catch(_){} if(model.challengeId===(window.CasinoWallet?.challengeId||null))window.CasinoWallet?.check?.(); }
  function notify(text){message=text;if(root)root.querySelector('.marble-message').textContent=message;}
  function update(){if(!root)return;root.querySelector('[data-count="inventory"]').textContent=model.inventory;root.querySelector('[data-count="active"]').textContent=model.balls.length;root.querySelector('[data-count="queue"]').textContent=model.queue;root.querySelector('[data-count="wins"]').textContent=model.wins;root.querySelector('[data-count="deepest"]').textContent=model.deepest+' / 6';root.querySelector('.marble-launch').disabled=model.inventory===0||window.CasinoWallet?.canPlay===false;root.querySelector('.marble-buy').disabled=window.CasinoWallet?.canPlay===false;}
  function count(input){const n=Number(input.value);return Number.isSafeInteger(n)&&n>=1&&n<=1000?n:null;}
  function launchBall(){model.balls.push({level:0,x:180+(Math.random()-.5)*48,y:34,vx:(Math.random()-.5)*110,vy:5,age:0});model.visits[0]++;model.launched++;model.deepest=Math.max(model.deepest,1);}
  function reflect(b,nx,ny,penetration,restitution){b.x+=nx*penetration;b.y+=ny*penetration;const dot=b.vx*nx+b.vy*ny;if(dot<0){b.vx-=(1+restitution)*dot*nx;b.vy-=(1+restitution)*dot*ny;const tangent=b.vx*-ny+b.vy*nx;b.vx-=(-ny)*tangent*.025;b.vy-=nx*tangent*.025;}}
  function circle(b,p){const dx=b.x-p.x,dy=b.y-p.y,r=R+p.r;if(Math.abs(dx)>=r||Math.abs(dy)>=r)return;const d=Math.hypot(dx,dy);if(d<r){reflect(b,d?dx/d:1,d?dy/d:0,r-d,.72);if(hits.length<60)hits.push({x:p.x,y:p.y,level:b.level,t:.18});}}
  function segment(b,s){const [x1,y1,x2,y2]=s;if(b.x<Math.min(x1,x2)-R-1||b.x>Math.max(x1,x2)+R+1||b.y<y1-R-1||b.y>y2+R+1)return;const dx=x2-x1,dy=y2-y1,t=Math.max(0,Math.min(1,((b.x-x1)*dx+(b.y-y1)*dy)/(dx*dx+dy*dy))),px=x1+t*dx,py=y1+t*dy,ox=b.x-px,oy=b.y-py,d=Math.hypot(ox,oy);if(d<R+1)reflect(b,d?ox/d:1,d?oy/d:0,R+1-d,.48);}
  function finishBall(b){const slot=Math.max(0,Math.min(4,Math.round((b.x-52)/64))),pass=slot===TARGETS[b.level];if(pass&&b.level<5){const offset=b.x-centers[slot];b.level++;b.x=180+offset;b.y=30;b.vx=Math.max(-90,Math.min(90,b.vx))+(slot-2)*12;b.vy=12;b.age=0;model.visits[b.level]++;model.deepest=Math.max(model.deepest,b.level+1);notify('通道接力：一颗弹珠进入第 '+(b.level+1)+' 层！');return false;}
    if(pass){model.wins++;window.CasinoWallet.change(PRIZE);window.CasinoWallet.record('深井弹珠 大奖 +'+PRIZE);notify('★ 穿越六层！金色洞命中，获得 '+PRIZE.toLocaleString()+' 筹码。');root.classList.remove('marble-jackpot');void root.offsetWidth;root.classList.add('marble-jackpot');}
    else{model.lost++;if(!model.queue&&model.balls.length===1)notify('本批弹珠已落定。最深抵达第 '+model.deepest+' 层。');}
    return true;
  }
  function physics(dt){feed+=dt;if(model.queue>0&&model.balls.length<60&&feed>=.18){feed=0;model.queue--;launchBall();update();}
    for(let i=model.balls.length-1;i>=0;i--){const b=model.balls[i];b.age+=dt;b.vy+=410*dt;b.vx*=Math.exp(-.08*dt);b.x+=b.vx*dt;b.y+=b.vy*dt;
      if(b.x<R+20)reflect(b,1,0,R+20-b.x,.75);if(b.x>W-20-R)reflect(b,-1,0,b.x-(W-20-R),.75);if(b.y<R+24)reflect(b,0,1,R+24-b.y,.65);
      // 只筛选可能接触到的邻近钉柱；保持从上到下、从左到右的解算次序。
      for(let row=0;row<5;row++){if(Math.abs(b.y-(65+row*25))>=R+5)continue;const near=Math.round((b.x-(row%2?60:40))/40);for(let col=Math.max(0,near-1);col<=Math.min((row%2?7:8)-1,near+1);col++)circle(b,pegs[rowStart[row]+col]);}
      if(b.y>186)for(const rail of rails)segment(b,rail);
      // 清除数值误差产生的静止平衡：轻微机身振动，不指定落洞。
      if(b.age>5&&Math.hypot(b.vx,b.vy)<10)b.vx+=Math.sin(b.age*31+i)*6;
      if(b.y>244){if(finishBall(b))model.balls.splice(i,1);save();update();}
    }
    // 同层钢珠间按等质量处理冲量；穿过接力通道的珠子属于独立层。
    for(let i=0;i<model.balls.length;i++)for(let j=i+1;j<model.balls.length;j++){
      const a=model.balls[i],b=model.balls[j];if(a.level!==b.level)continue;
      const dx=b.x-a.x,dy=b.y-a.y;if(Math.abs(dx)>=2*R||Math.abs(dy)>=2*R)continue;const d=Math.hypot(dx,dy);if(d>=2*R)continue;
      const nx=d?dx/d:1,ny=d?dy/d:0,overlap=(2*R-d)/2;
      a.x-=nx*overlap;a.y-=ny*overlap;b.x+=nx*overlap;b.y+=ny*overlap;
      const relative=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
      if(relative<0){const impulse=-relative*.88;a.vx-=impulse*nx;a.vy-=impulse*ny;b.vx+=impulse*nx;b.vy+=impulse*ny;}
    }
    hits.forEach(h=>h.t-=dt);hits=hits.filter(h=>h.t>0);
  }
  function metal(x,y,r){const g=ctx.createRadialGradient(x-r*.4,y-r*.4,1,x,y,r);g.addColorStop(0,'#fff');g.addColorStop(.3,'#b5d0d6');g.addColorStop(1,'#3a5c68');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
  function draw(){if(!ctx)return;ctx.clearRect(0,0,760,900);
    for(let level=0;level<6;level++){
      const ox=level%2*380+10,oy=Math.floor(level/2)*295+10;ctx.save();ctx.translate(ox,oy);
      const g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,'#1b3546');g.addColorStop(1,'#081820');ctx.fillStyle=g;ctx.strokeStyle='#a78c51';ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(0,0,W,H+22,14);ctx.fill();ctx.stroke();
      ctx.fillStyle='#e8d6a6';ctx.font='12px sans-serif';ctx.textAlign='left';ctx.fillText('LAYER 0'+(level+1)+'  '+(level===5?'最终金洞':'向下接力 →'),15,18);ctx.textAlign='right';ctx.fillStyle='#9ebbc5';ctx.fillText(model.visits[level]+' 颗抵达',W-15,18);
      ctx.strokeStyle='#486677';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(20,30);ctx.lineTo(20,240);ctx.moveTo(340,30);ctx.lineTo(340,240);ctx.stroke();
      pegs.forEach(p=>metal(p.x,p.y,p.r));
      ctx.strokeStyle='#7897a3';ctx.lineWidth=2;rails.forEach(s=>{ctx.beginPath();ctx.moveTo(s[0],s[1]);ctx.lineTo(s[2],s[3]);ctx.stroke();});
      for(let i=0;i<5;i++){const gold=i===TARGETS[level],x=centers[i];ctx.fillStyle='#020c10';ctx.beginPath();ctx.ellipse(x,232,17,8,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle=gold?'#ffd77b':'#496471';ctx.lineWidth=gold?3:1;ctx.stroke();ctx.font='11px sans-serif';ctx.textAlign='center';ctx.fillStyle=gold?'#ffe29a':'#93a8b3';ctx.fillText(gold?(level===5?'★ 大奖':'▼ 下一层'):'回收',x,267);}
      for(const h of hits)if(h.level===level){ctx.strokeStyle='rgba(150,223,255,'+(h.t/.18)+')';ctx.beginPath();ctx.arc(h.x,h.y,6+(1-h.t/.18)*9,0,Math.PI*2);ctx.stroke();}
      for(const b of model.balls)if(b.level===level){ctx.fillStyle='#bce8ff22';ctx.beginPath();ctx.ellipse(b.x-b.vx*.015,b.y-b.vy*.015,6,8,0,0,Math.PI*2);ctx.fill();metal(b.x,b.y,R);}
      ctx.restore();
    }
  }
  function frame(t){if(disposed)return;if(window.CasinoWallet?.canPlay===false){stop();update();return;}if(!last)last=t;const elapsed=Math.min((t-last)/1000,.05);last=t;acc+=elapsed;while(acc>=STEP){physics(STEP);acc-=STEP;}draw();saveClock+=elapsed;if(saveClock>=1){saveClock=0;save();}raf=requestAnimationFrame(frame);}
  function stop(){disposed=true;cancelAnimationFrame(raf);if(root)save();last=0;acc=0;}
  function init(container){stop();load();hits=[];container.innerHTML='<div class="marble-machine"><header><small>THE DEEP WELL · MECHANICAL CASCADE</small><h2>深井弹珠</h2><p>六层钉阵，三十个落洞。只有每层金色通道通往下一层；其余落洞回收弹珠。穿过六层并命中最终金洞，领取金库大奖。</p></header><div class="marble-console"><label>购买数量 <input class="marble-buy-count" type="number" min="1" max="1000" value="25" step="1"></label><button class="marble-buy">购买 · 1 筹码 / 颗</button><label>投放数量 <input class="marble-launch-count" type="number" min="1" max="1000" value="10" step="1"></label><button class="marble-launch">投放弹珠</button><button class="marble-pause">暂停</button></div><div class="marble-stats"><span>库存 <b data-count="inventory">0</b></span><span>待投 <b data-count="queue">0</b></span><span>机内 <b data-count="active">0</b></span><span>最深层 <b data-count="deepest">0</b></span><span>大奖 <b data-count="wins">0</b></span></div><p class="marble-message" role="status">弹珠与库存会自动保存；离开牌桌后暂停，回来继续。</p><canvas class="marble-board" width="760" height="900" role="img" aria-label="六层弹珠机实时画面，每层五个落洞，金色标记为通往下一层的唯一通道。"></canvas><p class="marble-note">每层从左到右、从上到下排列。金色箭头是唯一晋级通道。重力、钉柱与导流斜面的碰撞决定落点，弹珠之间互不碰撞；每批最多排入 1,000 颗，机内最多 60 颗。</p></div>';
    root=container.querySelector('.marble-machine');root.querySelector('.marble-note').textContent='每层从左到右、从上到下排列。金色箭头是唯一晋级通道。重力、钉柱、斜面及同层弹珠之间的碰撞决定落点；每批最多排入 1,000 颗，机内最多 60 颗。';canvas=root.querySelector('canvas');ctx=canvas.getContext('2d');const ratio=Math.min(window.devicePixelRatio||1,2);canvas.width=760*ratio;canvas.height=900*ratio;ctx.scale(ratio,ratio);let paused=false;
    root.querySelector('.marble-buy').onclick=()=>{const n=count(root.querySelector('.marble-buy-count'));if(!n){notify('购买数量请输入 1–1,000 的整数。');return;}if(!window.CasinoWallet.change(-n)){notify('筹码不足，请减少购买数量。');return;}model.inventory+=n;save();update();notify('已购买 '+n+' 颗弹珠，花费 '+n+' 筹码。');};
    root.querySelector('.marble-launch').onclick=()=>{const n=count(root.querySelector('.marble-launch-count'));if(!n||n>model.inventory||n+model.queue>1000){notify('请输入有效投放数量，不能超过库存或剩余排队容量（1,000 颗）。');return;}model.inventory-=n;model.queue+=n;save();update();notify('已排入 '+n+' 颗，逐颗投放'+(paused?'，点击继续启动。':'中。'));};
    root.querySelector('.marble-pause').onclick=e=>{paused=!paused;if(paused)stop();else start();e.target.textContent=paused?'继续':'暂停';notify(paused?'机台已暂停，弹珠轨迹已保存。':'机台继续运行。');};
    update();draw();
  }
  function start(){if(!disposed)return;disposed=false;last=0;raf=requestAnimationFrame(frame);}
  window.SiteGames=window.SiteGames||{};window.SiteGames[document.currentScript.src]={init,start,stop};
})();
