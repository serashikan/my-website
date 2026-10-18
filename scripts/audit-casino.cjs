// 直接使用网站的赔率函数；node scripts/audit-casino.cjs
const fs=require('node:fs'),assert=require('node:assert/strict');
const win={};new Function('window',fs.readFileSync('casino-math.js','utf8'))(win);
const m=win.CasinoMath;
const vaultReturns=Array.from({length:100},(_,i)=>m.vaultReturn(i,1));
assert.equal(vaultReturns.filter(n=>n>25).length,95);assert.equal(vaultReturns.filter(n=>n===0).length,5);assert.equal(vaultReturns.reduce((a,b)=>a+b),2470);assert.equal(m.vaultReturn(94,2),52);assert.equal(m.vaultReturn(95,2),0);
let slots=0,small=0,big=0;
for(let a=0;a<6;a++)for(let b=0;b<6;b++)for(let c=0;c<6;c++){
  slots+=m.slotReturn([a,b,c],1);small+=m.sicboReturn([a+1,b+1,c+1],'small',1);big+=m.sicboReturn([a+1,b+1,c+1],'big',1);
}
assert.equal(slots,198);assert.equal(small,210);assert.equal(big,210);
for(const choice of ['red','black',...Array.from({length:37},(_,i)=>String(i))])assert.equal(Array.from({length:37},(_,i)=>m.rouletteReturn(i,choice,1)).reduce((a,b)=>a+b),36);
// 无限牌堆模型：枚举六次抽牌（未使用的牌同样积分），0 的权重为 4，其余为 1。
const probs={player:0,banker:0,tie:0},cards=Array(6).fill(0);
function enumerate(depth,weight){if(depth===6){let i=0;const result=m.baccaratHands(()=>cards[i++]);probs[result.winner]+=weight;return;}for(let v=0;v<=9;v++){cards[depth]=v;enumerate(depth+1,weight*(v===0?4:1));}}
enumerate(0,1);const denominator=13**6;
for(const k in probs)probs[k]/=denominator;
const baccarat={};for(const choice of ['player','banker','tie'])baccarat[choice]=Object.entries(probs).reduce((s,[winner,p])=>s+p*m.baccaratReturn(winner,choice,100)/100,0);
assert(baccarat.player<1&&baccarat.banker<1&&baccarat.tie<1);
// 十点半：从实际配置读取赔率，按无限牌堆近似计算可选要牌/停牌的最优期望。
const source=fs.readFileSync('game-shidianban.js','utf8').replace('window.SiteGames = window.SiteGames || {};','window.TenTest={CFG};window.SiteGames = window.SiteGames || {};');
const tenWin={};new Function('window','document',source)(tenWin,{currentScript:{src:'ten'}});const cfg=tenWin.TenTest.CFG;
const draws=[{v:1,p:12/54,f:true},{v:1,p:2/54,f:false},...Array.from({length:10},(_,i)=>({v:(i+1)*2,p:4/54,f:false}))];
const type=(s,n,f)=>s>21?0:n===5?f?4:3:s===21?2:1;
const dist=new Map();function dealer(s,n,f,p){const rank=type(s,n,f);if(n&&(rank===0||n===5||s>=cfg.dealerHitBelow*2)){const key=rank+','+s;dist.set(key,(dist.get(key)||0)+p);return;}for(const c of draws)dealer(s+c.v,n+1,f&&c.f,p*c.p);}dealer(0,0,true,1);
const memo=new Map();function best(s,n,f){const rank=type(s,n,f);if(!rank)return -1;const key=[s,n,f].join(',');if(memo.has(key))return memo.get(key);let stand=0;for(const [k,p]of dist){const [r,ds]=k.split(',').map(Number);stand+=p*(r===0||rank>r||rank===r&&s>ds?cfg.payouts[rank]:-1);}let value=stand;if(n<5&&s!==21){let hit=0;for(const c of draws)hit+=c.p*best(s+c.v,n+1,f&&c.f);value=Math.max(stand,hit);}memo.set(key,value);return value;}
const tenReturn=1+draws.reduce((s,c)=>s+c.p*best(c.v,1,c.f),0);assert(tenReturn<1);
// 二十一点：与网站一致的无限牌堆、S17、仅要牌/停牌、庄家先查天然牌。
const bjDraw=Array.from({length:10},(_,i)=>({v:i+1,p:(i===9?4:1)/13}));
function add(t,a,v){t+=v===1?11:v;if(v===1)a++;while(t>21&&a){t-=10;a--;}return [t,a];}
const dealerMemo=new Map();function dealerBJ(t,a){const k=t+','+a;if(dealerMemo.has(k))return dealerMemo.get(k);const out=[0,0,0,0,0,0];if(t>=17){out[t>21?5:t-17]=1;return out;}for(const c of bjDraw){const [nt,na]=add(t,a,c.v),child=dealerBJ(nt,na);child.forEach((p,i)=>out[i]+=c.p*p);}dealerMemo.set(k,out);return out;}
let blackjackEV=0;
for(const c1 of bjDraw)for(const c2 of bjDraw)for(const up of bjDraw){
  const [t,a]=add(...add(0,0,c1.v),c2.v),natural=t===21;
  const bjProb=up.v===1?4/13:up.v===10?1/13:0;
  if(natural){blackjackEV+=c1.p*c2.p*up.p*(1-bjProb)*1.5;continue;}
  const dist=[0,0,0,0,0,0];for(const hole of bjDraw){if(up.v===1&&hole.v===10||up.v===10&&hole.v===1)continue;const d=dealerBJ(...add(...add(0,0,up.v),hole.v));d.forEach((p,i)=>dist[i]+=hole.p/(1-bjProb)*p);}
  const memo=new Map();function play(t,a){if(t>21)return -1;const k=t+','+a;if(memo.has(k))return memo.get(k);let stand=dist[5];for(let i=0;i<5;i++)stand+=dist[i]*(t>17+i?1:t===17+i?0:-1);if(t===21)return stand;let hit=0;for(const c of bjDraw)hit+=c.p*play(...add(t,a,c.v));const value=Math.max(stand,hit);memo.set(k,value);return value;}
  blackjackEV+=c1.p*c2.p*up.p*(-bjProb+(1-bjProb)*play(t,a));
}
assert(blackjackEV<0);
console.log(JSON.stringify({slots:slots/216,roulette:36/37,sicbo:small/216,baccarat,blackjackOptimalInfiniteDeck:1+blackjackEV,tenHalfInfiniteDeckOptimalApprox:tenReturn},null,2));
