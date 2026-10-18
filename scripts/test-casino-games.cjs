const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let chips=1000,wager=null,transactions=[],nonce=0,random=.999,timers=[];
const wallet={get chips(){return chips;},canPlay:true,begin(game,amount){if(wager||amount>chips||amount<1)return null;chips-=amount;wager={id:String(++nonce),game,amount};return wager.id;},finish(id,returned){if(!wager||wager.id!==id)return false;chips+=returned;transactions.push(returned-wager.amount);wager=null;return true;}};
const elements=new Map();function get(s){if(!elements.has(s))elements.set(s,{textContent:'',innerHTML:'',disabled:false,hidden:false,classList:{toggle(){}},querySelector:get,insertAdjacentHTML(){}});return elements.get(s);}
const seats=[0,1].map(i=>({classList:{toggle(){}},querySelector:s=>get('seat'+i+s)}));const root={querySelector:get,querySelectorAll:()=>seats,insertAdjacentHTML(){}};
const math=Object.create(Math);math.random=()=>random;
function boxFor(src){const box={window:{CasinoWallet:wallet},document:{currentScript:{src}},Math:math,setTimeout(fn){timers.push(fn);return fn;},clearTimeout(fn){timers=timers.filter(f=>f!==fn);}};return box;}
async function flush(){for(let n=0;n<40;n++){while(timers.length)timers.shift()();await Promise.resolve();}}
const container={set innerHTML(v){},querySelector:()=>root};
(async()=>{
  const y=boxFor('yacht');vm.runInNewContext(fs.readFileSync('game-yacht.js','utf8'),y);y.window.SiteGames.yacht.init(container);get('.yacht-mode').onclick();
  const cats=['ones','twos','threes','fours','fives','sixes','choice','four','full','small','large','yacht'];
  for(const cat of cats){random=.999;get('.yacht-roll').onclick();assert(wager,'risk was not reserved');random=0;get('.yacht-cats').onclick({target:{closest:()=>({disabled:false,dataset:{cat}})}});await flush();}
  assert.equal(chips,1700);assert.deepEqual(transactions,[700]);assert.equal(wager,null);
  get('.yacht-new').onclick();get('.yacht-roll').onclick();assert.equal(chips,0);y.window.SiteGames.yacht.stop();assert.equal(wager,null);assert.equal(chips,0);assert.equal(transactions.length,2,'abandoned match must settle once');
  chips=50;transactions=[];y.window.SiteGames.yacht.init(container);get('.yacht-mode').onclick();get('.yacht-roll').onclick();assert.equal(chips,50,'rejected entry must not charge fee');assert.equal(wager,null);get('.yacht-mode').onclick();get('.yacht-roll').onclick();assert.equal(chips,50,'casual mode must remain free');assert.equal(transactions.length,0);
  chips=1000;transactions=[];random=.999;y.window.SiteGames.yacht.init(container);get('.yacht-mode').onclick();
  for(const cat of cats){get('.yacht-roll').onclick();get('.yacht-cats').onclick({target:{closest:()=>({disabled:false,dataset:{cat}})}});await flush();}
  assert.equal(chips,950,'tie must still pay the entry fee once');assert.deepEqual(transactions,[-50]);assert.equal(wager,null);
  chips=100;transactions=[];elements.clear();random=.999;timers=[];
  const t=boxFor('ten');vm.runInNewContext(fs.readFileSync('game-shidianban.js','utf8'),t);t.window.SiteGames.ten.init(container);get('.tenhalf-next').onclick();assert.equal(chips,95);assert(wager);t.window.SiteGames.ten.stop();assert.equal(chips,95);assert.equal(wager,null);assert.deepEqual(transactions,[-5]);
  t.window.SiteGames.ten.init(container);get('.tenhalf-next').onclick();for(let i=0;i<3;i++)get('.tenhalf-hit').onclick();get('.tenhalf-stand').onclick();await flush();assert.equal(wager,null);assert.equal(transactions.length,2);const end=chips;get('.tenhalf-new').onclick();assert.equal(chips,end,'reset must not create chips');
  console.log('PASS: complete yacht banker match, escrow, exactly one payment, abandoned banker match, ten-half debit/abandon/settle/reset.');
})().catch(e=>{console.error(e);process.exitCode=1;});
