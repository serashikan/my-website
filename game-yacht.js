// 快艇骰子：双人同屏轮流模式
(function () {
  const CATS = [
    ['ones','一点','只计 1'],['twos','二点','只计 2'],['threes','三点','只计 3'],['fours','四点','只计 4'],['fives','五点','只计 5'],['sixes','六点','只计 6'],
    ['choice','全选','全部点数相加'],['four','四条','至少四颗同点'],['full','葫芦','三条＋对子'],['small','小顺','四颗连续点数'],['large','大顺','五颗连续点数'],['yacht','快艇','五颗相同']
  ];
  const FACE_CATS = {ones:1, twos:2, threes:3, fours:4, fives:5, sixes:6};
  const CHIP_RATE = 10;
  const ENTRY_FEE = 50;
  function matchPayment(playerScore, bankerScore, chips) {
    const difference = playerScore - bankerScore;
    const expected = difference * CHIP_RATE;
    return { difference, expected, actual: Math.max(-chips, Math.min(chips, expected)) };
  }
  function counts(ds){ return [1,2,3,4,5,6].map(n=>ds.filter(x=>x===n).length); }
  function score(cat, ds){ const c=counts(ds), sum=ds.reduce((a,b)=>a+b,0); if(ds.length<5)return 0;
    if(cat==='choice')return sum; if(cat==='four')return Math.max(...c)>=4?sum:0; if(cat==='full')return c.includes(3)&&c.includes(2)?25:0;
    if(cat==='small') { const u=new Set(ds); return [[1,2,3,4],[2,3,4,5],[3,4,5,6]].some(run=>run.every(n=>u.has(n)))?30:0; }
    if(cat==='large')return ([1,2,3,4,5].every(n=>ds.includes(n))||[2,3,4,5,6].every(n=>ds.includes(n)))?40:0; if(cat==='yacht')return Math.max(...c)===5?50:0;
    const n=FACE_CATS[cat]; return n ? ds.filter(x=>x===n).reduce((a,b)=>a+b,0) : 0;
  }
  function init(container){
    container.innerHTML=`<div class="yacht-game"><div class="yacht-head"><div><p class="codon-kicker">PASS &amp; PLAY</p><h2>快艇骰子</h2><p>两位玩家轮流掷骰，每回合最多重掷两次。</p></div><div class="yacht-head-actions"><button class="yacht-mode">与电脑对战</button><button class="yacht-new">新的一局</button></div></div><div class="yacht-players"><div class="yacht-player active" data-player="0"><b>玩家一</b><strong>0</strong></div><div class="yacht-player" data-player="1"><b>玩家二</b><strong>0</strong></div></div><div class="yacht-status"></div><div class="yacht-dice"></div><div class="yacht-actions"><button class="yacht-roll">掷骰子</button><span class="yacht-rolls">还可掷 3 次</span></div><div class="yacht-scoreboard"><h3>选择一个计分项目</h3><div class="yacht-cats"></div></div></div>`;
    const root=container.querySelector('.yacht-game'), diceEl=root.querySelector('.yacht-dice'), catsEl=root.querySelector('.yacht-cats'), status=root.querySelector('.yacht-status'), rollBtn=root.querySelector('.yacht-roll'), rollsEl=root.querySelector('.yacht-rolls');
    root.querySelector('.yacht-head p:not(.codon-kicker)').textContent='双人休闲 / 庄家对战 · 每回合最多掷三次';
    root.querySelector('.yacht-mode').textContent='与庄家对战';
    root.insertAdjacentHTML('beforeend','<p class="yacht-stakes"></p><div class="yacht-payment" role="status" aria-live="polite"></div>');
    const stakesEl=root.querySelector('.yacht-stakes'), paymentEl=root.querySelector('.yacht-payment');
    let settled=false, settlementText='',wagerId=null,risk=0;
    function abandonMatch(){if(wagerId&&window.CasinoWallet?.finish)window.CasinoWallet.finish(wagerId,0,'快艇骰子 弃局 -'+(risk+ENTRY_FEE)+'（含入场费）');wagerId=null;risk=0;}
    function settleMatch(){
      if(settled)return;
      settled=true;
      const difference=players[0].score-players[1].score;
      if(!vsComputer){settlementText=difference===0?'双方平局！':`玩家${difference>0?1:2}获胜，领先 ${Math.abs(difference)} 分。休闲模式不收付筹码。`;return;}
      const wallet=window.CasinoWallet;
      if(!wallet){settlementText='未连接赌场筹码账户，本局仅记录积分。';return;}
      const payment=matchPayment(players[0].score,players[1].score,risk);
      const net=payment.actual-ENTRY_FEE;
      if(!wagerId||!wallet.finish(wagerId,risk+payment.actual,`快艇骰子 ${payment.difference>0?'胜':payment.difference<0?'负':'平'} ${net>=0?'+':''}${net}（含入场费）`)){settlementText='筹码结算失败，请保留此页面。';settled=false;return;}
      wagerId=null;
      const cap=payment.actual!==payment.expected?'（已按本局押金结算）':'';
      settlementText=`${payment.difference===0?'双方平局':payment.difference>0?'你获胜':'庄家获胜'} · 本局净变化 ${net>=0?'+':''}${net} 筹码（已扣入场费）${cap}。`;
    }
    let players=[{score:0,used:{}},{score:0,used:{}}], turn=0, dice=[0,0,0,0,0], held=[false,false,false,false,false], rolls=3, over=false, vsComputer=false, aiBusy=false;
    function render(){ stakesEl.textContent=vsComputer?'庄家对战：每局入场费 50 筹码，不退回；另锁定对局押金。重开、切换或离桌视为弃局。':'双人同屏 · 休闲模式，不收付筹码。'; if(vsComputer&&risk&&!settled)stakesEl.textContent+=' 本局已锁定 '+risk+' 筹码。'; paymentEl.textContent=settlementText; diceEl.innerHTML=dice.map((d,i)=>`<button class="yacht-die ${held[i]?'held':''}" data-i="${i}">${d||'·'}</button>`).join(''); root.querySelectorAll('.yacht-player').forEach((x,i)=>{x.classList.toggle('active',i===turn&&!over);x.querySelector('strong').textContent=players[i].score;x.querySelector('b').textContent=vsComputer&&i===1?'庄家':'玩家'+(i+1);}); status.textContent=over?'整局结束，双方各完成 12 个计分项目。':aiBusy?'庄家正在思考……':`${vsComputer&&turn===1?'庄家':'玩家'+(turn+1)}的回合 · ${rolls<3?'可以点击骰子保留':'点击“掷骰子”开始'}`; rollBtn.textContent=vsComputer&&!wagerId&&!over?'支付 50 筹码并开局':'掷骰子'; rollsEl.textContent=`还可掷 ${rolls} 次`; rollBtn.disabled=rolls===0||over||aiBusy|| (vsComputer&&turn===1); catsEl.innerHTML=CATS.map(([id,name,desc])=>{const used=players[turn].used[id];const val=used==null?score(id,dice):used;return `<button class="yacht-cat ${used!=null?'used':''}" data-cat="${id}" ${used!=null||rolls===3||over||aiBusy|| (vsComputer&&turn===1)?'disabled':''}><b>${name}</b><small>${desc}</small><strong>${val}</strong></button>`}).join(''); }
    function roll(){ if(rolls===0||over)return;if(vsComputer&&!wagerId&&window.CasinoWallet){const wallet=window.CasinoWallet;risk=Math.min(wallet.chips-ENTRY_FEE,4100);if(risk<1||!wallet.begin||(wagerId=wallet.begin('快艇骰子',risk+ENTRY_FEE))===null){status.textContent='无法开局：需有入场费及对局押金，且挑战仍在进行。';return;}}dice=dice.map((d,i)=>held[i]?d:1+Math.floor(Math.random()*6));rolls--;render(); }
    diceEl.onclick=e=>{const b=e.target.closest('.yacht-die');if(over||aiBusy||vsComputer&&turn===1||!b||!dice[Number(b.dataset.i)]||rolls===3)return;held[Number(b.dataset.i)]=!held[Number(b.dataset.i)];render();};
    rollBtn.onclick=roll;
    function chooseHeld(ds){ const c=counts(ds), best=Math.max(...c), target=c.indexOf(best)+1; if(best>=2)return ds.map(x=>x===target); const unique=[...new Set(ds)].sort((a,b)=>a-b); const run=unique.length>=3?unique[0]:0; if(run&&unique.includes(run+1)&&unique.includes(run+2))return ds.map(x=>x===run||x===run+1||x===run+2); return ds.map(x=>x>=4); }
    function chooseCategory(){ const available=CATS.filter(([id])=>players[1].used[id]==null); return available.map(([id],i)=>({id,val:score(id,dice),priority:['yacht','large','full','four','small','choice'].indexOf(id)})).sort((a,b)=>(b.val-a.val)||(b.priority-a.priority))[0].id; }
    function finishCategory(id){ if(over||rolls===3||players[turn].used[id]!=null||!CATS.some(c=>c[0]===id))return;players[turn].used[id]=score(id,dice);players[turn].score+=players[turn].used[id];const done=Object.keys(players[0].used).length===CATS.length&&Object.keys(players[1].used).length===CATS.length;if(done){over=true;settleMatch();}else{turn=1-turn;dice=[0,0,0,0,0];held=[false,false,false,false,false];rolls=3;}render(); if(vsComputer&&turn===1&&!over)aiTurn(); }
    let session=0;
    function aiTurn(){ const token=++session;aiBusy=true;render(); const wait=ms=>new Promise(r=>setTimeout(r,ms)); (async()=>{ for(let n=0;n<3;n++){if(token!==session)return;roll();await wait(380);if(token!==session)return; if(n<2){held=chooseHeld(dice);render();await wait(220);} }if(token!==session)return; const id=chooseCategory();await wait(350);if(token!==session)return;aiBusy=false;finishCategory(id); })(); }
    catsEl.onclick=e=>{const b=e.target.closest('.yacht-cat');if(!b||b.disabled)return;finishCategory(b.dataset.cat);};
    function resetGame(){session++;abandonMatch();settled=false;settlementText="";players=[{score:0,used:{}},{score:0,used:{}}];turn=0;dice=[0,0,0,0,0];held=[false,false,false,false,false];rolls=3;over=false;aiBusy=false;render();}
    root.querySelector('.yacht-mode').onclick=()=>{vsComputer=!vsComputer;root.querySelector('.yacht-mode').textContent=vsComputer?'双人休闲':'与庄家对战';root.querySelector('.yacht-mode').classList.toggle('is-on',vsComputer);root.querySelector('.yacht-player:nth-child(2) b').textContent=vsComputer?'庄家':'玩家二';resetGame();};
    root.querySelector('.yacht-new').onclick=resetGame; render();
    return {start(){},stop(){session++;abandonMatch();}};
  }
  let active=null; function start(){if(active)active.start();} function stop(){if(active)active.stop();active=null;} function mount(c){stop();active=init(c);}
  window.SiteGames=window.SiteGames||{};const script=document.currentScript;window.SiteGames[script&&script.src?script.src:'game-yacht.js']={init:mount,start,stop};
})();
