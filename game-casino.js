(function () {
  'use strict';
  const key='sera-casino-challenge-v2',TARGET=100000;
  function freshChallenge(attempt=0){return {id:null,status:'ready',chips:100,rounds:0,history:[],high:100,attempt,pending:null,started:null};}
  let state=freshChallenge();
  try { const s=JSON.parse(localStorage.getItem(key)); if(s&&Number.isSafeInteger(s.chips)&&s.chips>=0&&['ready','active','won','lost'].includes(s.status))state={...freshChallenge(),...s,history:Array.isArray(s.history)?s.history.slice(0,12):[]}; } catch (_) {}
  // 未结算下注已在开局扣除；刷新后按弃局处理，不能靠刷新退回押金。
  if(state.pending){state.history.unshift(state.pending.game+' 弃局 -'+state.pending.amount);state.rounds++;state.pending=null;save();}
  function save(){try{localStorage.setItem(key,JSON.stringify(state));}catch(_){} }
  let root, table, child, generation=0, stake=10, pending=0,stageTimers=[],currentGame='blackjack';
  function marbleAssets(){try{const s=JSON.parse(localStorage.getItem('sera-marbles-v1'));return s&&s.challengeId===state.id?(s.inventory||0)+(s.queue||0)+(Array.isArray(s.balls)?s.balls.length:0):0;}catch(_){return 0;}}
  function evaluate(){if(state.status!=='active')return;state.high=Math.max(state.high,state.chips);if(state.chips>=TARGET)state.status='won';else if(state.chips===0&&!state.pending&&marbleAssets()===0)state.status='lost';save();}
  const games=[['blackjack','♠','二十一点','要牌、停牌，与庄家较量'],['roulette','◎','欧洲轮盘','单零轮盘 · 红黑与单号'],['baccarat','♦','百家乐','押庄、闲或和'],['sicbo','⚄','骰宝','三骰大小 · 围骰通杀'],['slots','✦','老虎机','三转轴 · 水果与幸运七'],['marbles','◉','深井弹珠','六层钉阵 · 一币一珠'],['ten','♥','十点半','熟悉的半点纸牌桌'],['vault','◇','金库承保','签下保单，等待巡检'],['yacht','⚅','快艇骰子','双人休闲 / 庄家对战']];
  function balance(){if(!root)return;root.querySelector('.casino-bank').textContent=state.chips.toLocaleString();root.querySelector('.casino-count').textContent=state.rounds+' 局已结算'+(state.pending?' · 已锁定 '+state.pending.amount.toLocaleString():'');root.querySelector('.casino-history').textContent=state.history.join('  ·  ')||'今晚的第一局，从这里开始。';root.querySelector('.casino-progress span').style.width=Math.min(100,state.high/TARGET*100)+'%';root.querySelector('.casino-progress').setAttribute('aria-valuenow',state.high);root.querySelector('.casino-attempt').textContent='第 '+Math.max(1,state.attempt)+' 次挑战 · 最高 '+state.high.toLocaleString();root.querySelectorAll('[data-milestone]').forEach(el=>el.classList.toggle('achieved',state.high>=Number(el.dataset.milestone)));const end=root.querySelector('.casino-end');end.hidden=!['won','lost'].includes(state.status);end.querySelector('p').textContent=state.status==='won'?'挑战完成！你从 100 筹码走到了 100,000。':'筹码和剩余弹珠都已耗尽。本次挑战结束，最高到达 '+state.high.toLocaleString()+' 筹码。';}
  function record(text){state.rounds++;state.history.unshift(String(text));state.history=state.history.slice(0,12);evaluate();save();balance();}
  function beginWager(game,amount){if(state.status!=='active'||state.pending||!Number.isSafeInteger(amount)||amount<1||amount>state.chips)return null;const id=Date.now().toString(36)+Math.random().toString(36).slice(2);state.chips-=amount;state.pending={id,game,amount};save();balance();return id;}
  function finishWager(id,returned,text){if(!state.pending||state.pending.id!==id||!Number.isSafeInteger(returned)||returned<0)return false;const wager=state.pending;state.pending=null;state.chips+=returned;const delta=returned-wager.amount;record(text||wager.game+' '+(delta>=0?'+':'')+delta);return true;}
  function abandon(){if(state.pending)finishWager(state.pending.id,0,state.pending.game+' 弃局 -'+state.pending.amount);pending=0;}
  function settle(name,returned){const amount=pending;pending=0;finishWager(state.pending?.id,returned);return returned-amount;}
  window.CasinoWallet={get chips(){return state.chips;},get challengeId(){return state.id;},get canPlay(){return state.status==='active';},get activeWager(){return state.pending;},begin:beginWager,finish:finishWager,check(){evaluate();balance();},change(delta){if(state.status!=='active'||!Number.isSafeInteger(delta)||state.chips+delta<0)return false;state.chips+=delta;if(delta>0){state.high=Math.max(state.high,state.chips);if(state.chips>=TARGET)state.status='won';}save();balance();return true;},record};
  function stop(){generation++;stageTimers.forEach(clearTimeout);stageTimers=[];if(child)child.stop();child=null;abandon();}
  function stageSchedule(fn,ms){const timer=setTimeout(()=>{stageTimers=stageTimers.filter(t=>t!==timer);fn();},ms);stageTimers.push(timer);}
  const rnd=n=>Math.floor(Math.random()*n);
  function card(){const r=rnd(13)+1;return {label:['','A','2','3','4','5','6','7','8','9','10','J','Q','K'][r]+['♠','♥','♦','♣'][rnd(4)],v:Math.min(r,10),ace:r===1};}
  function total(hand){let n=hand.reduce((s,c)=>s+(c.ace?11:c.v),0),a=hand.filter(c=>c.ace).length;while(n>21&&a--)n-=10;return n;}
  function showCards(hand){return hand.map(c=>'<span class="casino-card">'+c.label+'</span>').join('');}
  async function open(id){stop();currentGame=id;balance();const token=generation;root.querySelectorAll('[data-game]').forEach(b=>b.classList.toggle('selected',b.dataset.game===id));const g=games.find(g=>g[0]===id);table.innerHTML='<h2>'+g[1]+' '+g[2]+'</h2>';
    if(id==='marbles'||id==='vault'){
      const src=id==='marbles'?'game-marbles.js':'game-vault.js',url=new URL(src,document.baseURI).href;
      try{if(!window.SiteGames[url])await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.appendChild(s);});if(token!==generation)return;child=window.SiteGames[url];child.init(table);child.start();}catch(_){if(token===generation)table.innerHTML+='<p>机台加载失败，请重新打开。</p>';}
      return;
    }
    if(id==='ten'||id==='yacht'){table.innerHTML+='<p>'+ (id==='ten'?'玩家筹码与大厅同步；双人模式为不下注的休闲玩法。':'双人同屏休闲，或选择与庄家进行筹码对战。')+'</p><div class="casino-legacy"></div>';const src=id==='ten'?'game-shidianban.js':'game-yacht.js';const url=new URL(src,document.baseURI).href;try{if(!window.SiteGames[url])await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.appendChild(s);});if(token!==generation)return;child=window.SiteGames[url];child.init(table.querySelector('.casino-legacy'));child.start();}catch(_){if(token===generation)table.innerHTML+='<p>加载失败，请重新选择此牌桌。</p>';}return;}
    table.innerHTML+='<p class="casino-rule"></p><div class="casino-stage">请设置下注，然后开局。</div><div class="casino-options"></div><div class="casino-play"><label>下注 <select class="casino-bet">'+[1,2,5,10,20,50,100,250].map(n=>'<option>'+n+'</option>').join('')+'</select></label><button class="casino-deal">开始本局</button></div><p class="casino-result" role="status"></p>';
    const stage=table.querySelector('.casino-stage'),options=table.querySelector('.casino-options'),deal=table.querySelector('.casino-deal'),bet=table.querySelector('.casino-bet'),result=table.querySelector('.casino-result');
    const rules={blackjack:'要牌或停牌，尽量接近 21 点；超过就爆牌。',roulette:'选择红黑或数字，等待转盘揭晓。',baccarat:'押庄、闲或和，等待两边开牌。',sicbo:'选择大或小，等待三颗骰子落定。',slots:'拉下拉杆，让幸运七开始转动。'};
    table.querySelector('.casino-rule').textContent=rules[id];
    if(id==='slots'){
      const symbols=['🍒','🍋','🍇','🔔','⭐','7'];
      stage.innerHTML='<div class="slot-machine"><div class="slot-marquee"><span>★ ★ ★</span><h3>LUCKY SEVEN</h3><small>SERA & MILU · FRUIT CLUB</small></div><div class="slot-decoration"><span>FRUIT CLUB</span><span>✦ LUCKY SEVEN ✦</span></div><div class="slot-glass"><div class="slot-payline"></div>'+[0,1,2].map(i=>'<div class="slot-window"><div class="slot-strip">'+[symbols[i],symbols[i+1],symbols[i+2]].map(s=>'<div class="slot-symbol">'+s+'</div>').join('')+'</div></div>').join('')+'</div><div class="slot-display" role="status">READY TO SPIN</div><div class="slot-tray"><span>◉ CREDIT</span><span class="slot-credit">'+state.chips+'</span><span>✦ GOOD LUCK ✦</span></div><button class="slot-lever" aria-label="拉动拉杆开始旋转"><span></span></button></div>';
      deal.textContent='SPIN · 开始旋转';
      stage.querySelector('.slot-lever').onclick=()=>{if(!deal.disabled)deal.click();};
    }
    if(id==='roulette')options.innerHTML='<select class="casino-choice"><option value="red">红</option><option value="black">黑</option>'+Array.from({length:37},(_,i)=>'<option value="'+i+'">单号 '+i+'</option>').join('')+'</select>';
    if(id==='baccarat')options.innerHTML='<select class="casino-choice"><option value="player">闲</option><option value="banker">庄</option><option value="tie">和</option></select>';
    if(id==='sicbo')options.innerHTML='<select class="casino-choice"><option value="small">小</option><option value="big">大</option></select>';
    function finish(returned,text){const delta=settle(g[2],returned);result.textContent=text+' · 本局 '+(delta>=0?'+':'')+delta+' 筹码';deal.disabled=state.status!=='active';bet.disabled=false;options.querySelectorAll('select').forEach(s=>s.disabled=false);}
    deal.onclick=()=>{stake=Number(bet.value);if(!beginWager(g[2],stake)){result.textContent=state.status==='active'?'筹码不足或已有未结束的牌局，请降低下注。':'本次挑战尚未开始或已结束。';return;}pending=stake;result.textContent='';deal.disabled=true;bet.disabled=true;const choice=options.querySelector('select')?.value;options.querySelectorAll('select').forEach(s=>s.disabled=true);
      if(id==='slots'){
        const symbols=['🍒','🍋','🍇','🔔','⭐','7'],a=[rnd(6),rnd(6),rnd(6)],count=new Set(a).size;
        // 先结算并保存，再演出动画，离开牌桌不会撤销已经产生的结果。
        const delta=settle(g[2],window.CasinoMath.slotReturn(a,stake));
        const machine=stage.querySelector('.slot-machine'),display=stage.querySelector('.slot-display'),lever=stage.querySelector('.slot-lever');
        const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        machine.classList.remove('slot-win');machine.classList.add('slot-spinning');lever.disabled=true;display.textContent='SPINNING · 好运转动中';
        stage.querySelector('.slot-credit').textContent=state.chips;
        stage.querySelectorAll('.slot-strip').forEach((strip,i)=>{
          const current=strip.dataset.last||symbols[i+1],cycles=24+i*6;
          strip.style.transition='none';strip.style.transform='translateY(0)';
          const seq=[symbols[(a[i]+5)%6],current,symbols[(a[i]+1)%6]];
          for(let j=3;j<cycles;j++)seq.push(symbols[j%6]);
          seq.push(symbols[(a[i]+5)%6],symbols[a[i]],symbols[(a[i]+1)%6]);
          strip.innerHTML=seq.map(s=>'<div class="slot-symbol">'+s+'</div>').join('');
          strip.dataset.last=symbols[a[i]];
          const height=strip.firstElementChild.getBoundingClientRect().height;
          void strip.offsetHeight;
          strip.style.transition='transform '+(reduced?80:1600+i*550)+'ms cubic-bezier(.12,.65,.18,1)';
          strip.style.transform='translateY(-'+cycles*height+'px)';
        });
        setTimeout(()=>{if(token!==generation)return;machine.classList.remove('slot-spinning');if(count<3)machine.classList.add('slot-win');display.textContent=count===1?'★ TRIPLE MATCH ★':count===2?'DOUBLE MATCH · 退回下注':'THANK YOU · 再试一局';result.textContent='转轴已停止 · 本局 '+(delta>=0?'+':'')+delta+' 筹码';deal.disabled=state.status!=='active';bet.disabled=false;lever.disabled=false;},reduced?100:2800);
      }
      if(id==='roulette'){const n=rnd(37),red=[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(n);stage.textContent=n+' · '+(n===0?'绿':red?'红':'黑');const color=choice==='red'||choice==='black';const win=color?n!==0&&(choice==='red')===red:Number(choice)===n;finish(window.CasinoMath.rouletteReturn(n,choice,stake),win?'命中':'未命中');}
      if(id==='sicbo'){const ds=[1+rnd(6),1+rnd(6),1+rnd(6)],sum=ds.reduce((a,b)=>a+b),triple=new Set(ds).size===1;stage.textContent=ds.join(' · ')+' = '+sum;finish(window.CasinoMath.sicboReturn(ds,choice,stake),triple?'围骰，大小通杀':'骰子已落定');}
      if(id==='baccarat'){const h=window.CasinoMath.baccaratHands(()=>{const v=1+rnd(13);return v>=10?0:v;});stage.textContent='闲 '+h.p.join(' · ')+' → '+h.pt+' 点 ｜ 庄 '+h.b.join(' · ')+' → '+h.bt+' 点';finish(window.CasinoMath.baccaratReturn(h.winner,choice,stake),h.winner==='tie'?'和局':h.winner==='player'?'闲胜':'庄胜');}
      if(id==='blackjack'){const p=[card(),card()],d=[card(),card()];const paint=hidden=>{stage.innerHTML='<div>庄家 '+showCards(hidden?[d[0]]:d)+(hidden?'<span class="casino-card">?</span>':' · '+total(d))+'</div><div>你 '+showCards(p)+' · '+total(p)+'</div>';};function end(){while(total(d)<17)d.push(card());paint(false);const pt=total(p),dt=total(d);finish(pt>21?0:dt>21||pt>dt?stake*2:pt===dt?stake:0,pt>21?'你爆牌':dt>21?'庄家爆牌':pt>dt?'你赢了':pt===dt?'平局':'庄家胜');options.innerHTML='';}paint(true);if(total(p)===21||total(d)===21){paint(false);finish(total(p)===total(d)?stake:total(p)===21?stake+Math.floor(stake*1.5):0,'天然牌结算');}else{options.innerHTML='<button data-hit>要牌</button><button data-stand>停牌</button>';options.querySelector('[data-hit]').onclick=()=>{p.push(card());paint(true);if(total(p)>=21)end();};options.querySelector('[data-stand]').onclick=end;}}
    };
  }
  function showOpening(){
    stop();evaluate();balance();
    const status=state.status==='active'
      ? {label:'继续挑战 · 进入赌场',message:'已有进度：'+state.chips.toLocaleString()+' 筹码，最高 '+state.high.toLocaleString()+'。'}
      : {label:state.status==='ready'?'接受挑战 · 开始':'再挑战一次 · 100 筹码起步',message:state.status==='ready'?'灯光就位，今晚的挑战即将开始。':'新的挑战将从 100 筹码重新起步。'};
    root.querySelector('.casino-lobby').hidden=true;
    window.CasinoOpening.show(root,{status,schedule:stageSchedule,onStart(){
      if(state.status!=='active'){state=freshChallenge(state.attempt+1);state.id=Date.now().toString(36)+Math.random().toString(36).slice(2);state.status='active';state.started=Date.now();save();}
      evaluate();balance();
    },onReveal(){root.querySelector('.casino-lobby').hidden=false;open(currentGame);}});
  }
  function init(container){
    stop();
    container.innerHTML='<section class="casino">'+window.CasinoOpening.html()+'<div class="casino-lobby" hidden><header class="casino-header"><div><small>SERA & MILU · THE HUNDRED CHIP CHALLENGE</small><h1>一百筹码之夜</h1><p>100 起步，100,000 通关。每一次选择，都是今晚的下一幕。</p><span class="casino-attempt"></span></div><div class="casino-wallet"><small>可用筹码</small><strong class="casino-bank"></strong><small class="casino-count"></small><button class="casino-rules">主持人 · 挑战规则</button></div></header><div class="casino-challenge"><div class="casino-challenge-top"><b>挑战进度</b><span>目标 100,000</span></div><div class="casino-progress" role="progressbar" aria-label="最高筹码进度" aria-valuemin="0" aria-valuemax="100000"><span></span></div><div class="casino-milestones">'+[1000,10000,50000,100000].map(n=>'<span data-milestone="'+n+'">'+n.toLocaleString()+'</span>').join('')+'</div></div><div class="casino-end" hidden><p></p><button class="casino-restart">回到舞台 · 再挑战一次</button></div><nav class="casino-nav">'+games.map(g=>'<button data-game="'+g[0]+'"><span>'+g[1]+'</span><b>'+g[2]+'</b><small>'+g[3]+'</small></button>').join('')+'</nav><main class="casino-table" tabindex="-1"></main><footer><b>最近结算</b><p class="casino-history"></p><small>每次挑战初始 100 · 中途不补领 · 自动保存进度 · 牌局退出视为弃局，弹珠机退出暂停</small><p>纯虚拟娱乐 · 无充值、提现或现金价值</p></footer></div></section>';
    root=container.querySelector('.casino');table=root.querySelector('.casino-table');
    root.querySelectorAll('[data-game]').forEach(b=>b.onclick=()=>open(b.dataset.game));
    root.querySelector('.casino-rules').onclick=showOpening;
    root.querySelector('.casino-restart').onclick=showOpening;
    evaluate();balance();showOpening();
  }
  window.SiteGames=window.SiteGames||{};window.SiteGames[document.currentScript.src]={init,start(){},stop};
})();
