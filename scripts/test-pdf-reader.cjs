const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('site-pdf.js','utf8').replace("import(assets+'pdf.min.mjs')","Promise.resolve(window.testLibrary)");
class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.style={};this.clientWidth=320;this.textContent='';this.attributes={};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(key,value){this.attributes[key]=value;}
  getContext(){return {};}
}
const tick=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
function harness(protocol='https:'){
  let renders=[],destroyed=0,options=null,fail=false,resolve=null,hold=false;
  const events={};
  const pdf={numPages:3,async getPage(number){return {getViewport:({scale})=>({width:600*scale,height:800*scale}),cleanup(){},render(){renders.push(number);return {promise:Promise.resolve(),cancel(){}};}};}};
  const library={GlobalWorkerOptions:{},getDocument(config){options=config;return {promise:hold?new Promise(r=>resolve=r):fail?Promise.reject(new Error('network')):Promise.resolve(pdf),async destroy(){destroyed++;}};}};
  const location=protocol==='file:'?{protocol,origin:'null'}:{protocol,origin:'https://site.test'};
  const base=protocol==='file:'?'file:///site/':'https://site.test/';
  const box={URL,Promise,Math,Number,Error,location,document:{currentScript:{src:base+'site-pdf.js'},baseURI:base,createElement:tag=>new Element(tag)},
    window:{testLibrary:library,devicePixelRatio:3,addEventListener:(name,fn)=>events[name]=fn,removeEventListener:name=>delete events[name]},setTimeout:()=>1,clearTimeout(){}};
  vm.runInNewContext(source,box);
  const container=new Element('div');
  function all(node=container){return [node,...node.children.filter(x=>x instanceof Element).flatMap(x=>all(x))];}
  return {mount(path='txt文件/test.pdf',title='中文 PDF'){return box.window.SitePDF.mount(container,path,title);},all,
    button(label){return all().find(x=>x.tagName==='button'&&x.textContent===label);},
    get options(){return options;},get renders(){return renders;},get destroyed(){return destroyed;},events,
    set fail(value){fail=value;},set hold(value){hold=value;},resolve(){resolve(pdf);},
  };
}
(async()=>{
  const a=harness(),viewer=a.mount();await tick();
  assert.deepEqual(a.renders,[1]);assert.equal(a.options.withCredentials,true);assert.equal(a.options.isEvalSupported,false);
  assert(a.options.cMapUrl.startsWith('https://site.test/lib/pdfjs/'));
  assert(a.button('上一页').disabled);assert(!a.button('下一页').disabled);
  a.button('下一页').onclick();a.button('下一页').onclick();await tick();assert.equal(a.renders.at(-1),3);assert(a.button('下一页').disabled);
  a.button('上一页').onclick();await tick();assert.equal(a.renders.at(-1),2);
  a.button('放大').onclick();await tick();
  const canvas=a.all().find(x=>x.tagName==='canvas');assert(canvas.width*canvas.height<=3000000);assert(canvas.style.width.endsWith('px'));
  viewer.stop();await tick();assert.equal(a.destroyed,1);assert.equal(a.events.resize,undefined);
  const b=harness();b.hold=true;const pending=b.mount();await tick();pending.stop();b.resolve();await tick();assert.deepEqual(b.renders,[]);assert.equal(b.destroyed,1);
  const c=harness();c.fail=true;c.mount();await tick();assert.equal(c.button('重试').hidden,false);
  assert.equal(c.all().filter(x=>x.tagName==='a').length,2);c.fail=false;c.button('重试').onclick();await tick();assert.deepEqual(c.renders,[1]);
  const local=harness('file:');local.mount();await tick();assert.equal(local.options,null);assert(local.all().some(x=>x.tagName==='embed'));
  const unsafe=harness();unsafe.mount('https://other.test/private.pdf','<img>');await tick();assert.equal(unsafe.options,null);
  const title=harness();title.mount('txt文件/test.pdf','<img src=x onerror=bad()>');await tick();assert.equal(title.all().find(x=>x.tagName==='h2').textContent,'<img src=x onerror=bad()>');
  console.log('PASS: mobile pagination, zoom/memory cap, same-origin credentials, navigation cleanup, late load cancellation, retry, local fallback, safe titles.');
})().catch(error=>{console.error(error);process.exitCode=1;});
