const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('backend/members/static/members/casino-account.js','utf8');
const key='sera-casino-challenge-v2';
const challenge=chips=>({id:'attempt-1',status:'active',chips,rounds:2,history:['test'],high:Math.max(100,chips),attempt:1,pending:null,started:1});
const snapshot=chips=>({challenge:challenge(chips),marbles:null,vault:null});
const clone=x=>JSON.parse(JSON.stringify(x));
class Element{
  constructor(){this.children=[];this.className='';this.textContent='';}
  append(...nodes){this.children.push(...nodes);}
  prepend(node){this.children.unshift(node);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(){}
  querySelector(selector){return this.children.find(node=>'.'+node.className===selector)||null;}
}
function harness(server,storage=new Map()){
  let uid=1,offline=false,hold=null,inFlight=0,maximum=0,posts=0,mounts=0,pauses=0;
  const events={},timers=new Map();let tid=0;
  const container=new Element();
  const response=(status,data)=>({ok:status===200,status,redirected:false,json:async()=>clone(data)});
  const box={console,JSON,Promise,Object,Number,Array,Error,
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    document:{createElement:()=>new Element(),addEventListener(){},visibilityState:'visible'},
    window:{addEventListener:(name,fn)=>events[name]=fn,location:{reload(){}}},
    setTimeout(fn){const id=++tid;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
    async fetch(url,options){
      if(offline)throw new Error('offline');
      if(!options.method)return response(200,{account_id:uid,username:'reader-'+uid,csrf_token:'test-csrf',revision:server[uid]?.revision||0,snapshot:server[uid]?.snapshot||null});
      posts++;inFlight++;maximum=Math.max(maximum,inFlight);
      if(hold)await hold;
      const body=JSON.parse(options.body);inFlight--;
      if(body.account_id!==uid)return response(403,{});
      if(body.revision!==(server[uid]?.revision||0))return response(409,{});
      server[uid]={revision:body.revision+1,snapshot:body.snapshot};
      return response(200,{account_id:uid,revision:body.revision+1});
    },
  };
  vm.runInNewContext(source,box);
  const account=box.window.CasinoAccount;
  account.setPause(()=>pauses++);
  return {account,storage,server,container,events,
    prepare:()=>account.prepare(container,()=>mounts++,()=>true),
    choose(label){const panel=container.querySelector('.casino-account-panel');return panel.children.find(x=>x.textContent===label).onclick();},
    set uid(x){uid=x;},set offline(x){offline=x;},set hold(x){hold=x;},
    get posts(){return posts;},get maximum(){return maximum;},get mounts(){return mounts;},get pauses(){return pauses;},
  };
}
(async()=>{
  const server={1:{revision:3,snapshot:snapshot(321)}};
  const a=harness(server);await a.prepare();assert.equal(a.mounts,1);assert.equal(a.account.username,'reader-1');assert.equal(JSON.parse(a.account.storage.getItem(key)).chips,321);
  // 新设备从账号恢复；切换账号不能继承另一个账号的浏览器副本。
  const b=harness(server,a.storage);b.uid=2;await b.prepare();assert.equal(b.account.storage.getItem(key),null);
  b.account.storage.setItem(key,JSON.stringify(challenge(75)));await b.account.flush();assert.equal(server[1].snapshot.challenge.chips,321);assert.equal(server[2].snapshot.challenge.chips,75);
  const c=harness(server);await c.prepare();assert.equal(JSON.parse(c.account.storage.getItem(key)).chips,321);
  // 本地旧进度必须点击导入，不能自动归属新登录者。
  const legacy=new Map([[key,JSON.stringify(challenge(246))]]);
  const d=harness({},legacy);await d.prepare();assert.equal(d.posts,0);assert.equal(d.mounts,0);
  await d.choose('绑定这份旧进度');assert.equal(d.server[1].snapshot.challenge.chips,246);assert.equal(d.mounts,1);assert(legacy.has(key));
  // 同时改动只串行上传，首个请求在途时的最新状态也会再保存。
  let release;const e=harness({});await e.prepare();e.account.storage.setItem(key,JSON.stringify(challenge(80)));
  e.hold=new Promise(resolve=>release=resolve);const first=e.account.flush();e.account.storage.setItem(key,JSON.stringify(challenge(90)));e.account.flush();release();await first;e.hold=null;await e.account.flush();
  assert.equal(e.maximum,1);assert.equal(e.server[1].snapshot.challenge.chips,90);assert.equal(e.server[1].revision,2);
  // 冲突冻结，不把旧页面进度覆盖到新版本。
  const f=harness({1:{revision:1,snapshot:snapshot(100)}});await f.prepare();f.account.storage.setItem(key,JSON.stringify(challenge(70)));f.server[1]={revision:2,snapshot:snapshot(150)};await f.account.flush();assert.equal(f.account.canPlay,false);assert.equal(f.pauses,1);assert.equal(f.server[1].snapshot.challenge.chips,150);
  // 登出后换账号，即使旧页还有保存请求，也不能保存到新账号。
  const g=harness({});await g.prepare();g.account.storage.setItem(key,JSON.stringify(challenge(60)));g.uid=2;await g.account.flush();assert.equal(g.account.canPlay,false);assert.equal(g.server[2],undefined);
  // 断网后保留账号专属待同步副本，重新打开时恢复并继续上传。
  const h=harness({});await h.prepare();h.account.storage.setItem(key,JSON.stringify(challenge(88)));h.offline=true;await h.account.flush();assert.equal(JSON.parse(h.storage.get('sera-casino-account-v1:1')).dirty,true);
  const recovered=harness(h.server,h.storage);await recovered.prepare();assert.equal(JSON.parse(recovered.account.storage.getItem(key)).chips,88);await recovered.account.flush();assert.equal(recovered.server[1].snapshot.challenge.chips,88);
  // 已有云端新版本时，不悄悄用未上传旧副本覆盖。
  const conflictStore=new Map([['sera-casino-account-v1:1',JSON.stringify({account_id:1,revision:0,snapshot:snapshot(11),dirty:true})]]);
  const conflict=harness({1:{revision:2,snapshot:snapshot(99)}},conflictStore);await conflict.prepare();assert.equal(conflict.mounts,0);conflict.choose('读取账号存档');assert.equal(conflict.mounts,1);assert(conflictStore.has('sera-casino-account-v1:1:recovery'));assert.equal(JSON.parse(conflict.account.storage.getItem(key)).chips,99);
  // 新挑战清空旧挑战附属机台，旧机台的延迟保存也不能串入。
  const i=harness({});await i.prepare();i.account.storage.setItem(key,JSON.stringify(challenge(100)));i.account.storage.setItem('sera-vault-v1',JSON.stringify({challengeId:'attempt-1',safe:1}));i.account.storage.setItem(key,JSON.stringify({...challenge(100),id:'attempt-2'}));assert.equal(i.account.storage.getItem('sera-vault-v1'),null);i.account.storage.setItem('sera-vault-v1',JSON.stringify({challengeId:'attempt-1',safe:9}));assert.equal(i.account.storage.getItem('sera-vault-v1'),null);
  // 主持人用文本插入用户名，名字中的标记不能变成 HTML。
  const greeting={textContent:'',innerHTML:'unchanged'},button={},opening={classList:{add(){},remove(){}},querySelector:s=>s==='.opening-greeting'?greeting:s==='.opening-start'?button:{}};
  const openingBox={window:{matchMedia:()=>({matches:true})}};
  vm.runInNewContext(fs.readFileSync('casino-opening.js','utf8'),openingBox);
  openingBox.window.CasinoOpening.show({querySelector:()=>opening},{username:'<img src=x>',status:{message:'continue',label:'continue'},schedule(){}});
  assert.equal(greeting.textContent,'你好，<img src=x>。');assert.equal(greeting.innerHTML,'unchanged');
  console.log('PASS: account/device isolation, explicit legacy import, serialized saves, conflict freeze, session switch, offline recovery, challenge isolation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
