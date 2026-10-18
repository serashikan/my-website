// 离线运行实际碰撞代码，不连接玩家存档或筹码账户。
const fs=require('node:fs');
let seed=20261017;
const math=Object.create(Math);
math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
let source=fs.readFileSync('game-marbles.js','utf8')
  .replace('window.SiteGames=window.SiteGames||{};','window.physicsTest={physics,launchBall,get model(){return model;},setRoot(r){root=r;}};window.SiteGames=window.SiteGames||{};')
  .replace(/function save\(\)\{[^\n]+\}/,'function save(){}')
  .replace(/function update\(\)\{[^\n]+\}/,'function update(){}')
  .replace(/function notify\(text\)\{[^\n]+\}/,'function notify(){}')
  .replace('if(hits.length<60)','if(false)')
  .replace('function finishBall(b){','function finishBall(b){window.hist[b.level][Math.max(0,Math.min(4,Math.round((b.x-52)/64)))]++;');
if(process.argv[4])source=source.replace(/const TARGETS=\[[^\]]+\]/,'const TARGETS=['+process.argv[4]+']');
const node={classList:{remove(){},add(){}},offsetWidth:0};
const box={Math:math,window:{hist:Array.from({length:6},()=>[0,0,0,0,0]),CasinoWallet:{change(){return true;},record(){}}},document:{currentScript:{src:'physics'}},localStorage:{getItem(){return null;},setItem(){}},cancelAnimationFrame(){}};
new Function('window','document','localStorage','cancelAnimationFrame','Math',source)(box.window,box.document,box.localStorage,box.cancelAnimationFrame,box.Math);
const api=box.window.physicsTest;api.setRoot(node);
const started=Date.now(),count=Number(process.argv[2]||25000),batch=Number(process.argv[3]||1000);
let done=0;
while(done<count){const n=Math.min(batch,count-done);api.model.queue=n;let steps=0;while((api.model.queue||api.model.balls.length)&&steps++<180*(n*.18+120))api.physics(1/180);if(api.model.queue||api.model.balls.length)throw Error('弹珠卡住');done+=n;if(done%25000===0)console.log('Simulated '+done+' / '+count+' marbles; '+api.model.wins+' wins.');}
const wins=api.model.wins,p=wins/count,z=1.96,den=1+z*z/count;
const center=(p+z*z/(2*count))/den,half=z*Math.sqrt(p*(1-p)/count+z*z/(4*count*count))/den;
console.log(JSON.stringify({seed:20261017,count,batch,seconds:(Date.now()-started)/1000,wins,visits:api.model.visits,holes:box.window.hist,returnEstimate:p*20000,return95:[Math.max(0,center-half)*20000,(center+half)*20000]},null,2));
