const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
function harness(storage=new Map()){
  let nextTimer=0;const timers=new Map(),elements=new Map();
  function get(s){if(!elements.has(s))elements.set(s,{textContent:'',innerHTML:'',hidden:false,style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},focus(){},querySelector:get,querySelectorAll(){return [];}});return elements.get(s);}
  const root=get('root');let intro;
  const box={window:{CasinoOpening:{html:()=>'<stage/>',show(r,callbacks){intro=callbacks;}},matchMedia:()=>({matches:false})},document:{currentScript:{src:'casino'},baseURI:'https://local.test/'},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},setTimeout(fn,ms){const n=++nextTimer;timers.set(n,{fn,ms});return n;},clearTimeout(n){timers.delete(n);},Math,Date,URL};
  const source=fs.readFileSync('game-casino.js','utf8').replace('window.SiteGames=window.SiteGames||{};','window.test={get state(){return state;},evaluate,showOpening,stop};window.SiteGames=window.SiteGames||{};');
  vm.runInNewContext(source,box);
  return {box,get,storage,timers,init(){box.window.SiteGames.casino.init({set innerHTML(v){},querySelector:()=>root});},get intro(){return intro;},wallet:box.window.CasinoWallet};
}
const h=harness();h.init();assert.equal(h.wallet.canPlay,false);assert.equal(h.wallet.begin('test',10),null);h.intro.onStart();assert.equal(h.wallet.chips,100);assert(h.wallet.challengeId);
let id=h.wallet.begin('test',100);assert(id);assert.equal(h.wallet.chips,0);h.wallet.check();assert.equal(h.box.window.test.state.status,'active','pending wager marked bankrupt');assert.equal(h.wallet.begin('second',1),null);assert(h.wallet.finish(id,200));assert.equal(h.wallet.chips,200);assert(!h.wallet.finish(id,200));assert.equal(h.wallet.chips,200);
id=h.wallet.begin('abandon',20);h.box.window.test.stop();assert.equal(h.wallet.chips,180);assert.equal(h.wallet.activeWager,null);
id=h.wallet.begin('reload',10);const reload=harness(h.storage);reload.wallet.check();assert.equal(reload.wallet.chips,170);assert.equal(reload.wallet.activeWager,null);
const fullHistory=new Map([['sera-casino-challenge-v2',JSON.stringify({id:'history-test',status:'active',chips:90,high:100,rounds:12,history:Array(12).fill('old'),attempt:1,pending:{id:'last',game:'test',amount:10},started:1})]]);const historyReload=harness(fullHistory);assert.equal(historyReload.box.window.test.state.history.length,12);
const c=harness();c.init();c.intro.onStart();c.wallet.change(-100);c.storage.set('sera-marbles-v1',JSON.stringify({challengeId:c.wallet.challengeId,inventory:2,queue:0,balls:[]}));c.wallet.check();assert(c.wallet.canPlay,'unused marbles must keep challenge alive');c.storage.set('sera-marbles-v1',JSON.stringify({challengeId:c.wallet.challengeId,inventory:0,queue:0,balls:[]}));c.wallet.check();assert.equal(c.box.window.test.state.status,'lost');assert.equal(c.wallet.change(100),false,'cannot refill failed attempt');c.box.window.test.showOpening();const previous=c.wallet.challengeId;c.intro.onStart();assert.equal(c.wallet.chips,100);assert.notEqual(c.wallet.challengeId,previous);assert.equal(c.box.window.test.state.attempt,2);
c.wallet.change(99900);c.wallet.check();assert.equal(c.box.window.test.state.status,'won');assert.equal(c.wallet.begin('after win',1),null);
// 开幕：先开幕，点击后合幕，在闭幕后揭示大厅，再二次开幕。
const box={window:{matchMedia:()=>({matches:false})}};vm.runInNewContext(fs.readFileSync('casino-opening.js','utf8'),box);
const events=[],button={disabled:false},classes=new Set(),opening={hidden:true,classList:{add(...xs){xs.forEach(x=>classes.add(x));},remove(...xs){xs.forEach(x=>classes.delete(x));}},querySelector:s=>s==='.opening-start'?button:{textContent:''}};
const root={querySelector:s=>s==='.casino-opening'?opening:{focus(){events.push('focus');}}};let jobs=[];
box.window.CasinoOpening.show(root,{status:{message:'hello',label:'start'},onStart:()=>events.push('start'),onReveal:()=>events.push('lobby'),schedule:(fn,ms)=>jobs.push({fn,ms})});
assert.equal(jobs[0].ms,70);jobs.shift().fn();assert(classes.has('curtains-open'));button.onclick();button.onclick();assert.equal(jobs.length,1);assert(!classes.has('curtains-open'));assert.equal(events.length,0);jobs.shift().fn();assert.deepEqual(events,['start','lobby']);assert(classes.has('curtains-open'));jobs.shift().fn();assert(opening.hidden);assert(events.includes('focus'));
// 快艇风险上下限对称，分差仍按十倍计算。
const yacht={window:{},document:{currentScript:{src:'yacht'}}};vm.runInNewContext(fs.readFileSync('game-yacht.js','utf8').replace('function init(container){','window.pay=matchPayment;function init(container){'),yacht);
assert.equal(yacht.window.pay(130,100,100).actual,100);assert.equal(yacht.window.pay(100,130,100).actual,-100);assert.equal(yacht.window.pay(120,100,1000).actual,200);assert.equal(yacht.window.pay(100,100,1000).actual,0);
// 买完最后的筹码后，实际弹珠库存必须让挑战保持有效；金洞到账一次。
const b=harness();b.init();b.intro.onStart();const gradient={addColorStop(){}};
const ctx=new Proxy({}, {get(_,k){return k==='createLinearGradient'||k==='createRadialGradient'?()=>gradient:()=>{};},set(){return true;}});
b.get('canvas').getContext=()=>ctx;b.box.window.devicePixelRatio=1;b.box.cancelAnimationFrame=()=>{};b.box.requestAnimationFrame=()=>1;b.box.document.currentScript.src='marbles';
const marbleSource=fs.readFileSync('game-marbles.js','utf8').replace('window.SiteGames=window.SiteGames||{};','window.marbleTest={physics,get model(){return model;},get target(){return centers[TARGETS[5]];}};window.SiteGames=window.SiteGames||{};');
vm.runInNewContext(marbleSource,b.box);const moduleB=b.box.window.SiteGames.marbles;moduleB.init({set innerHTML(v){},querySelector:()=>b.get('marbleroot')});
b.get('.marble-buy-count').value='100';b.get('.marble-buy').onclick();assert.equal(b.wallet.chips,0);assert(b.wallet.canPlay);assert.equal(b.box.window.marbleTest.model.inventory,100);
b.get('.marble-launch-count').value='20';b.get('.marble-launch').onclick();assert.equal(b.wallet.chips,0);assert.equal(b.box.window.marbleTest.model.inventory,80);
const mt=b.box.window.marbleTest;mt.model.balls.push({level:5,x:mt.target,y:245,vx:0,vy:1,age:0});mt.physics(1/180);mt.physics(1/180);assert.equal(b.wallet.chips,20000);moduleB.stop();moduleB.init({set innerHTML(v){},querySelector:()=>b.get('marbleroot')});assert.equal(mt.model.inventory,80);
// 停止后的旧模块不能在重新载入时覆盖账号里更晚的弹珠进度。
const savedMarbles=JSON.parse(b.storage.get('sera-marbles-v1'));savedMarbles.inventory=17;b.storage.set('sera-marbles-v1',JSON.stringify(savedMarbles));moduleB.init({set innerHTML(v){},querySelector:()=>b.get('marbleroot')});assert.equal(mt.model.inventory,17);
console.log('PASS: opening order, double-click protection, 100-chip start, escrow, abandonment, reload, marble assets, failure/retry, victory, symmetric yacht risk.');
