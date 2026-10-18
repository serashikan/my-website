const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let chips=100,wager=null,serial=0,roll=.94,challengeId='test-vault';const settlements=[],storage=new Map(),timers=new Map(),nodes=new Map();
function get(s){if(!nodes.has(s))nodes.set(s,{value:'1',disabled:false,textContent:'',innerHTML:'',classList:{add(){},remove(){}},querySelector:get});return nodes.get(s);}
const wallet={get chips(){return chips;},get challengeId(){return challengeId;},canPlay:true,begin(game,amount){if(wager||amount>chips)return null;chips-=amount;wager={id:String(++serial),amount};return wager.id;},finish(id,returned){if(!wager||id!==wager.id)return false;chips+=returned;settlements.push(returned-wager.amount);wager=null;return true;}};
const math=Object.create(Math);math.random=()=>roll;
const box={window:{CasinoWallet:wallet,matchMedia:()=>({matches:false})},document:{currentScript:{src:'vault'}},Math:math,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},setTimeout(fn){const id=++serial;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}};
vm.runInNewContext(fs.readFileSync('casino-math.js','utf8'),box);vm.runInNewContext(fs.readFileSync('game-vault.js','utf8'),box);const game=box.window.SiteGames.vault,container={set innerHTML(v){},querySelector:()=>get('root')};
function flush(){for(const [id,fn]of timers){timers.delete(id);fn();}}
game.init(container);get('.vault-sign').onclick();assert.equal(chips,101);assert.equal(wager,null);get('.vault-sign').onclick();assert.deepEqual(settlements,[1],'busy click paid twice');flush();
roll=.95;get('.vault-sign').onclick();assert.equal(chips,76);assert.deepEqual(settlements,[1,-25]);flush();assert(get('.vault-message').textContent.includes('25'));
roll=.94;get('.vault-units').value='2';get('.vault-units').onchange();get('.vault-sign').onclick();assert.equal(chips,78);game.stop();assert.equal(timers.size,0);assert.deepEqual(settlements,[1,-25,2]);game.init(container);assert.equal(get('[data-stat="safe"]').textContent,2);assert.equal(get('[data-stat="claims"]').textContent,1);
get('.vault-units').value='50';get('.vault-units').onchange();assert(get('.vault-sign').disabled);get('.vault-sign').onclick();assert.equal(chips,78);assert.equal(settlements.length,3);
challengeId='new-attempt';game.init(container);assert.equal(get('[data-stat="safe"]').textContent,0);assert.equal(get('[data-stat="claims"]').textContent,0);
console.log('PASS: vault success/loss boundaries, scale, insufficient funds, double-click, exit after settlement, saved records, challenge isolation.');
