// 快艇骰子：双人同屏轮流模式
(function () {
  const CATS = [
    ['ones','一点','只计 1'],['twos','二点','只计 2'],['threes','三点','只计 3'],['fours','四点','只计 4'],['fives','五点','只计 5'],['sixes','六点','只计 6'],
    ['choice','全选','全部点数相加'],['four','四条','至少四颗同点'],['full','葫芦','三条＋对子'],['small','小顺','四颗连续点数'],['large','大顺','五颗连续点数'],['yacht','快艇','五颗相同']
  ];
  const FACE_CATS = {ones:1, twos:2, threes:3, fours:4, fives:5, sixes:6};
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
    let players=[{score:0,used:{}},{score:0,used:{}}], turn=0, dice=[0,0,0,0,0], held=[false,false,false,false,false], rolls=3, over=false, vsComputer=false, aiBusy=false;
    function render(){ diceEl.innerHTML=dice.map((d,i)=>`<button class="yacht-die ${held[i]?'held':''}" data-i="${i}">${d||'·'}</button>`).join(''); root.querySelectorAll('.yacht-player').forEach((x,i)=>{x.classList.toggle('active',i===turn&&!over);x.querySelector('strong').textContent=players[i].score;x.querySelector('b').textContent=vsComputer&&i===1?'电脑':'玩家'+(i+1);}); status.textContent=over?'本局结束，看看谁的总分更高！':aiBusy?'电脑正在思考……':`${vsComputer&&turn===1?'电脑':'玩家'+(turn+1)}的回合 · ${rolls<3?'可以点击骰子保留':'点击“掷骰子”开始'}`; rollsEl.textContent=`还可掷 ${rolls} 次`; rollBtn.disabled=rolls===0||over||aiBusy|| (vsComputer&&turn===1); catsEl.innerHTML=CATS.map(([id,name,desc])=>{const used=players[turn].used[id];const val=used==null?score(id,dice):used;return `<button class="yacht-cat ${used!=null?'used':''}" data-cat="${id}" ${used!=null||rolls===3||over||aiBusy|| (vsComputer&&turn===1)?'disabled':''}><b>${name}</b><small>${desc}</small><strong>${val}</strong></button>`}).join(''); }
    function roll(){ if(rolls===0||over)return; dice=dice.map((d,i)=>held[i]?d:1+Math.floor(Math.random()*6)); rolls--; render(); }
    diceEl.onclick=e=>{const b=e.target.closest('.yacht-die');if(!b||!dice[Number(b.dataset.i)]||rolls===3)return;held[Number(b.dataset.i)]=!held[Number(b.dataset.i)];render();};
    rollBtn.onclick=roll;
    function chooseHeld(ds){ const c=counts(ds), best=Math.max(...c), target=c.indexOf(best)+1; if(best>=2)return ds.map(x=>x===target); const unique=[...new Set(ds)].sort((a,b)=>a-b); const run=unique.length>=3?unique[0]:0; if(run&&unique.includes(run+1)&&unique.includes(run+2))return ds.map(x=>x===run||x===run+1||x===run+2); return ds.map(x=>x>=4); }
    function chooseCategory(){ const available=CATS.filter(([id])=>players[1].used[id]==null); return available.map(([id],i)=>({id,val:score(id,dice),priority:['yacht','large','full','four','small','choice'].indexOf(id)})).sort((a,b)=>(b.val-a.val)||(b.priority-a.priority))[0].id; }
    function finishCategory(id){ players[turn].used[id]=score(id,dice);players[turn].score+=players[turn].used[id];const done=Object.keys(players[0].used).length===CATS.length&&Object.keys(players[1].used).length===CATS.length;if(done){over=true;}else{turn=1-turn;dice=[0,0,0,0,0];held=[false,false,false,false,false];rolls=3;}render(); if(vsComputer&&turn===1&&!over)aiTurn(); }
    function aiTurn(){ aiBusy=true;render(); const wait=ms=>new Promise(r=>setTimeout(r,ms)); (async()=>{ for(let n=0;n<3;n++){roll();await wait(380); if(n<2){held=chooseHeld(dice);render();await wait(220);} } const id=chooseCategory();await wait(350);aiBusy=false;finishCategory(id); })(); }
    catsEl.onclick=e=>{const b=e.target.closest('.yacht-cat');if(!b||b.disabled)return;finishCategory(b.dataset.cat);};
    function resetGame(){players=[{score:0,used:{}},{score:0,used:{}}];turn=0;dice=[0,0,0,0,0];held=[false,false,false,false,false];rolls=3;over=false;aiBusy=false;render();}
    root.querySelector('.yacht-mode').onclick=()=>{vsComputer=!vsComputer;root.querySelector('.yacht-mode').textContent=vsComputer?'双人同屏':'与电脑对战';root.querySelector('.yacht-mode').classList.toggle('is-on',vsComputer);root.querySelector('.yacht-player:nth-child(2) b').textContent=vsComputer?'电脑':'玩家二';resetGame();};
    root.querySelector('.yacht-new').onclick=resetGame; render();
    return {start(){},stop(){}};
  }
  let active=null; function start(){if(active)active.start();} function stop(){if(active)active.stop();active=null;} function mount(c){stop();active=init(c);}
  window.SiteGames=window.SiteGames||{};const script=document.currentScript;window.SiteGames[script&&script.src?script.src:'game-yacht.js']={init:mount,start,stop};
})();
