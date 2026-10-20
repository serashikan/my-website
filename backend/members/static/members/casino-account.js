/* Mint 专用：账号存档与本地待同步副本。静态网站不加载此文件。 */
(() => {
    'use strict';
    const endpoint='/api/casino/progress/';
    const keys={'sera-casino-challenge-v2':'challenge','sera-marbles-v1':'marbles','sera-vault-v1':'vault'};
    const empty=()=>({challenge:null,marbles:null,vault:null});
    const clone=value=>JSON.parse(JSON.stringify(value));
    const stable=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
        ?Object.keys(item).sort().reduce((out,key)=>(out[key]=item[key],out),{}):item);
    let account=null, snapshot=empty(), revision=0, csrf='', dirty=false, sequence=0;
    let blocked=false, ready=false, timer=null, sending=null, view=null, pause=null, afterSave=null;
    let message='正在读取账号进度……';
    function cacheKey(){return 'sera-casino-account-v1:'+account;}
    function localRead(key){try{return JSON.parse(localStorage.getItem(key));}catch(_){return null;}}
    function cache(){if(!account||blocked)return;try{localStorage.setItem(cacheKey(),JSON.stringify({account_id:account,revision,snapshot,dirty}));}catch(_){}}
    function panel(text,actions=[]){
        message=text;
        if(!view||!view.current())return;
        let node=view.container.querySelector('.casino-account-panel');
        if(!node){node=document.createElement('div');node.className='casino-account-panel';node.setAttribute('role','status');view.container.prepend(node);}
        node.replaceChildren();const label=document.createElement('span');label.textContent=text;node.append(label);
        for(const [label,action] of actions){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=action;node.append(button);}
    }
    function schedule(delay=1200){if(timer||blocked||!dirty)return;timer=setTimeout(()=>{timer=null;flush();},delay);}
    function freeze(text){
        blocked=true;ready=false;clearTimeout(timer);timer=null;
        if(view&&view.current()){
            if(pause)pause();
            const game=view.container.querySelector('.casino');if(game)game.inert=true;
        }
        panel(text,[['重新打开挑战',()=>window.location.reload()]]);
    }
    async function flush(){
        if(sending)return sending;
        if(!ready||!dirty||blocked)return;
        clearTimeout(timer);timer=null;
        const sentSequence=sequence, body={account_id:account,revision,snapshot:clone(snapshot)};
        let retry=0;
        panel('正在保存到 '+window.CasinoAccount.username+' 的账号……');
        sending=(async()=>{
            try{
                const response=await fetch(endpoint,{method:'POST',credentials:'same-origin',cache:'no-store',keepalive:true,
                    headers:{'Content-Type':'application/json','X-CSRFToken':csrf},body:JSON.stringify(body)});
                if(response.redirected||response.status===401||response.status===403){freeze('登录状态已变化，请重新登录后打开挑战。本机待同步进度已保留。');return;}
                if(response.status===409){freeze('另一个页面已更新账号进度。此页已暂停，未上传的副本仍保存在本机。');return;}
                if(response.status===400||response.status===413){freeze('这份进度暂时无法保存。本机副本已保留，请重新打开挑战。');return;}
                if(!response.ok){retry=response.status===429?60000:5000;throw new Error('retry');}
                const data=await response.json();
                if(data.account_id!==account||data.revision!==revision+1){freeze('账号存档状态已变化，请重新打开挑战。');return;}
                revision=data.revision;dirty=sequence!==sentSequence;cache();
                panel(dirty?'正在等待保存最新进度……':'已保存到 '+window.CasinoAccount.username+' 的账号');
                if(!dirty&&afterSave){const callback=afterSave;afterSave=null;callback();}
            }catch(_){if(!blocked){cache();panel('暂时未同步，进度已暂存此浏览器；联网后会重试。',[['立即重试',()=>flush()]]);retry=retry||5000;}}
            finally{sending=null;if(!blocked&&dirty)schedule(retry||1200);}
        })();
        return sending;
    }
    function legacy(){
        const challenge=localRead('sera-casino-challenge-v2');
        if(!challenge||!challenge.id||!['active','won','lost'].includes(challenge.status))return null;
        const result={challenge,marbles:null,vault:null};
        for(const [key,field] of Object.entries(keys))if(field!=='challenge'){
            const value=localRead(key);if(value&&value.challengeId===challenge.id)result[field]=value;
        }
        return result;
    }
    async function prepare(container,mount,current){
        view={container,current};
        panel('正在读取账号进度……');
        await flush();
        if(!current())return;
        try{
            const response=await fetch(endpoint,{credentials:'same-origin',cache:'no-store'});
            if(!response.ok||response.redirected)throw new Error('load');
            const data=await response.json();
            if(!Number.isSafeInteger(data.account_id)||typeof data.username!=='string'||!Number.isSafeInteger(data.revision))throw new Error('load');
            if(!current())return;
            account=data.account_id;revision=data.revision;csrf=data.csrf_token;
            window.CasinoAccount.username=data.username;
            const saved=localRead(cacheKey()), remote=data.snapshot||empty();
            blocked=false;ready=true;dirty=false;snapshot=clone(remote);
            function enter(){if(!current())return;cache();mount();panel(dirty?'正在等待保存账号进度……':'进度绑定账号：'+data.username);if(dirty)schedule();}
            if(saved&&saved.account_id===account&&saved.dirty&&saved.snapshot){
                if(saved.revision===revision){snapshot=clone(saved.snapshot);dirty=true;sequence++;enter();return;}
                if(stable(saved.snapshot)!==stable(remote)){
                    ready=false;
                    panel('此浏览器有尚未上传的进度，但账号存档已在别处更新。为避免覆盖，请先读取账号存档。',[
                        ['读取账号存档',()=>{try{localStorage.setItem(cacheKey()+':recovery',JSON.stringify(saved));}catch(_){}ready=true;enter();}],
                    ]);return;
                }
            }
            const old=data.revision===0?legacy():null;
            if(old){
                panel('此浏览器有旧挑战进度，当前账号还没有存档。你可以选择绑定旧进度，或从新的挑战开始。',[
                    ['绑定这份旧进度',async()=>{if(!current())return;snapshot=clone(old);dirty=true;sequence++;cache();afterSave=enter;await flush();}],
                    ['从新挑战开始',()=>{if(!current())return;snapshot=empty();dirty=false;enter();}],
                ]);return;
            }
            enter();
        }catch(_){
            ready=false;
            panel('暂时无法读取账号进度，请检查登录或网络后重试。',[['重新读取',()=>prepare(container,mount,current)]]);
        }
    }
    window.CasinoAccount={username:'',prepare,flush,setPause(callback){pause=callback;},get canPlay(){return ready&&!blocked;},
        storage:{
            getItem(key){const field=keys[key];return field&&snapshot[field]!==null?JSON.stringify(snapshot[field]):null;},
            setItem(key,value){
                const field=keys[key];if(!field||!ready||blocked)return;
                const parsed=JSON.parse(value);
                if(field!=='challenge'&&parsed.challengeId!==snapshot.challenge?.id)return;
                if(stable(parsed)===stable(snapshot[field]))return;
                snapshot[field]=parsed;
                if(field==='challenge')for(const side of ['marbles','vault'])if(snapshot[side]?.challengeId!==parsed.id)snapshot[side]=null;
                dirty=true;sequence++;cache();panel('进度已暂存，正在等待保存到账号……');schedule();
            },
        },
    };
    window.addEventListener('pagehide',()=>{if(view&&view.current()&&pause)pause();flush();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush();});
})();
