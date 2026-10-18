// 金库承保：使用共享钱包，开单时确定并保存结果，动画只负责展示。
(function(){
  'use strict';
  const KEY='sera-vault-v1',UNITS=[1,2,5,10,20,50];
  let active=null;
  function mount(container){
    stop();const wallet=window.CasinoWallet;
    let stats={challengeId:wallet.challengeId,safe:0,claims:0,net:0,last:[]},timer=null,disposed=false,busy=false;
    try{const s=JSON.parse(localStorage.getItem(KEY));if(s&&s.challengeId===wallet.challengeId&&[s.safe,s.claims].every(n=>Number.isSafeInteger(n)&&n>=0)&&Number.isSafeInteger(s.net))stats={...stats,...s,last:Array.isArray(s.last)?s.last.slice(0,12):[]};}catch(_){}
    container.innerHTML='<div class="vault-game"><header><small>THE UNDERWRITER’S DESK</small><h2>金库承保</h2><p>替金库签下一份保单，等待今晚的巡检报告。</p></header><div class="vault-cabinet"><div class="vault-lamp"><i></i><span>SECURITY SYSTEM · 待命</span></div><div class="vault-door"><span class="vault-hinge hinge-top"></span><span class="vault-hinge hinge-bottom"></span><div class="vault-dial"><i></i><i></i><i></i></div><span class="vault-lock">S &amp; M</span></div><div class="vault-seal">PRIVATE VAULT · 夜间保险柜</div></div><div class="vault-controls"><label>合约规模 <select class="vault-units">'+UNITS.map(n=>'<option value="'+n+'">'+n+' 份</option>').join('')+'</select></label><span class="vault-deposit"></span><button class="vault-sign">签下保单</button></div><p class="vault-message" role="status" aria-live="polite">金库大门已经锁好，等待你的签名。</p><div class="vault-totals"><span>平安结案 <b data-stat="safe"></b></span><span>出险记录 <b data-stat="claims"></b></span><span>累计收付 <b data-stat="net"></b></span></div><div class="vault-history" aria-label="近期承保记录"></div><small>签单立即结算并保存，切换牌桌不会撤销结果。</small></div>';
    const root=container.querySelector('.vault-game'),select=root.querySelector('.vault-units'),button=root.querySelector('.vault-sign'),message=root.querySelector('.vault-message'),cabinet=root.querySelector('.vault-cabinet'),lamp=root.querySelector('.vault-lamp span');
    function render(){const deposit=25*Number(select.value);root.querySelector('.vault-deposit').textContent='本单押金 '+deposit+' 筹码';button.disabled=busy||!wallet.canPlay||wallet.chips<deposit;select.disabled=busy;root.querySelector('[data-stat="safe"]').textContent=stats.safe;root.querySelector('[data-stat="claims"]').textContent=stats.claims;root.querySelector('[data-stat="net"]').textContent=(stats.net>=0?'+':'')+stats.net;root.querySelector('.vault-history').innerHTML=stats.last.map(s=>'<span class="'+(s>0?'vault-safe':'vault-claim')+'">'+(s>0?'✓ +':'✕ ')+s+'</span>').join('');}
    select.onchange=()=>{render();if(wallet.chips<25*Number(select.value))message.textContent='当前筹码不足以支付这份合约的押金，请选择更小的规模。';else message.textContent='合约已备好，等待签名。';};
    button.onclick=()=>{
      if(busy||disposed)return;const units=Number(select.value);if(!UNITS.includes(units))return;
      const deposit=units*25,id=wallet.begin('金库承保',deposit);
      if(!id){message.textContent='筹码不足，或当前挑战已结束。';render();return;}
      busy=true;const roll=Math.floor(Math.random()*100),returned=window.CasinoMath.vaultReturn(roll,units),delta=returned-deposit,safe=delta>0;
      if(!wallet.finish(id,returned,'金库承保 '+(delta>=0?'+':'')+delta)){busy=false;message.textContent='结算未完成，请保留当前页面。';render();return;}
      if(safe)stats.safe++;else stats.claims++;stats.net+=delta;stats.last.unshift(delta);stats.last=stats.last.slice(0,12);try{localStorage.setItem(KEY,JSON.stringify(stats));}catch(_){}
      cabinet.classList.remove('vault-cleared','vault-breached');cabinet.classList.add('vault-checking');lamp.textContent='SECURITY CHECK · 巡检中';message.textContent='巡检员正在核对金库封条……';render();
      timer=setTimeout(()=>{if(disposed)return;busy=false;cabinet.classList.remove('vault-checking');cabinet.classList.add(safe?'vault-cleared':'vault-breached');lamp.textContent=safe?'ALL CLEAR · 平安结案':'ALARM · 金库失窃';message.textContent=safe?'封条完整，平安结案。保费到账 +'+delta+' 筹码。':'巡检发现失窃，本单赔付 '+Math.abs(delta)+' 筹码。';render();},window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:1500);
    };
    render();active={stop(){disposed=true;clearTimeout(timer);}};
  }
  function stop(){if(active)active.stop();active=null;}
  window.SiteGames=window.SiteGames||{};window.SiteGames[document.currentScript.src]={init:mount,start(){},stop};
})();
