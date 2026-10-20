/* 直接在网页中绘制 PDF，兼容没有内嵌 PDF 插件的手机浏览器。 */
(() => {
    'use strict';
    const assets=new URL('lib/pdfjs/',document.currentScript.src).href;
    let library=null;
    function loadLibrary(){
        if(!library)library=import(assets+'pdf.min.mjs').then(module=>{
            module.GlobalWorkerOptions.workerSrc=assets+'pdf.worker.min.mjs';
            return module;
        }).catch(error=>{library=null;throw error;});
        return library;
    }
    function mount(container,filePath,title){
        container.replaceChildren();
        const root=document.createElement('section');root.className='site-pdf';
        const heading=document.createElement('h2');heading.textContent=title||'PDF 阅读';
        const tools=document.createElement('div');tools.className='site-pdf-tools';tools.setAttribute('aria-label','PDF 阅读工具');
        const viewport=document.createElement('div');viewport.className='site-pdf-viewport';
        const canvas=document.createElement('canvas');canvas.setAttribute('role','img');canvas.hidden=true;
        const status=document.createElement('p');status.className='site-pdf-status';status.setAttribute('role','status');
        const links=document.createElement('div');links.className='site-pdf-links';
        root.append(heading,tools,status,viewport,links);viewport.append(canvas);container.append(root);
        let url;
        try{
            url=new URL(filePath,document.baseURI);
            if(!/\.pdf$/i.test(url.pathname)||!(['http:','https:'].includes(url.protocol)&&url.origin===location.origin
                ||location.protocol==='file:'&&url.protocol==='file:'))throw new Error('url');
        }catch(_){status.textContent='无法打开这个 PDF 地址。';return {stop(){}};}
        function button(label,action){const node=document.createElement('button');node.type='button';node.textContent=label;node.onclick=action;tools.append(node);return node;}
        const previous=button('上一页',()=>go(current-1));
        const pageLabel=document.createElement('label');pageLabel.textContent='第 ';
        const pageInput=document.createElement('input');pageInput.type='number';pageInput.min='1';pageInput.value='1';pageInput.setAttribute('aria-label','页码');
        const pageCount=document.createElement('span');pageCount.textContent=' / — 页';pageLabel.append(pageInput,pageCount);tools.append(pageLabel);
        const next=button('下一页',()=>go(current+1));
        const smaller=button('缩小',()=>zoom(Math.max(.5,magnification-.25)));
        const larger=button('放大',()=>zoom(Math.min(3,magnification+.25)));
        const fit=button('适合宽度',()=>zoom(1));
        const retry=button('重试',()=>begin());retry.hidden=true;
        for(const [label,download] of [['打开原 PDF',false],['下载 PDF',true]]){
            const link=document.createElement('a');link.textContent=label;link.href=url.href;
            if(download)link.download='';else{link.target='_blank';link.rel='noopener noreferrer';}
            links.append(link);
        }
        let disposed=false,task=null,pdf=null,renderTask=null,current=1,magnification=1,serial=0,resizeTimer=null;
        let rendering=Promise.resolve(),loadSerial=0;
        function controls(){
            const loaded=!!pdf&&!disposed;
            previous.disabled=!loaded||current<=1;next.disabled=!loaded||current>=pdf.numPages;
            pageInput.disabled=!loaded;smaller.disabled=!loaded||magnification<=.5;larger.disabled=!loaded||magnification>=3;fit.disabled=!loaded;
        }
        function go(number){if(!pdf||!Number.isInteger(number)||number<1||number>pdf.numPages){pageInput.value=current;return;}current=number;queueRender();}
        function zoom(value){magnification=value;queueRender();}
        pageInput.onchange=()=>go(Number(pageInput.value));
        function queueRender(){
            if(disposed||!pdf)return;
            const ticket=++serial,number=current;
            if(renderTask)renderTask.cancel();
            pageInput.value=number;pageCount.textContent=' / '+pdf.numPages+' 页';controls();status.textContent='正在绘制第 '+number+' 页……';
            rendering=rendering.catch(()=>{}).then(async()=>{
                if(disposed||ticket!==serial)return;
                const page=await pdf.getPage(number);
                if(disposed||ticket!==serial)return;
                const base=page.getViewport({scale:1});
                const width=Math.max(240,viewport.clientWidth-24);
                const view=page.getViewport({scale:width/base.width*magnification});
                // 限制单页画布内存，手机上不同时绘制整本文档。
                const ratio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(3000000/(view.width*view.height)));
                canvas.width=Math.max(1,Math.floor(view.width*ratio));canvas.height=Math.max(1,Math.floor(view.height*ratio));
                canvas.style.width=view.width+'px';canvas.style.height=view.height+'px';canvas.hidden=false;
                canvas.setAttribute('aria-label',(title||'PDF')+'，第 '+number+' 页，共 '+pdf.numPages+' 页');
                renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport:view,transform:ratio===1?null:[ratio,0,0,ratio,0,0]});
                await renderTask.promise;renderTask=null;
                if(disposed||ticket!==serial)return;
                status.textContent='第 '+number+' / '+pdf.numPages+' 页 · '+Math.round(magnification*100)+'%';
                page.cleanup();
            }).catch(error=>{
                if(disposed||ticket!==serial||error?.name==='RenderingCancelledException')return;
                status.textContent='这一页暂时无法显示，请重试，或使用下方入口打开原 PDF。';retry.hidden=false;
            });
        }
        async function destroyDocument(){
            serial++;if(renderTask){renderTask.cancel();renderTask=null;}
            const previousTask=task;task=null;pdf=null;
            if(previousTask)await previousTask.destroy();
        }
        async function begin(){
            const ticket=++loadSerial;retry.hidden=true;controls();status.textContent='正在读取 PDF……';
            try{
                await destroyDocument();
                if(disposed||ticket!==loadSerial)return;
                const module=await loadLibrary();
                if(disposed||ticket!==loadSerial)return;
                task=module.getDocument({url:url.href,withCredentials:true,isEvalSupported:false,
                    cMapUrl:assets+'cmaps/',cMapPacked:true,standardFontDataUrl:assets+'standard_fonts/',wasmUrl:assets+'wasm/'});
                const loaded=await task.promise;
                if(disposed||ticket!==loadSerial)return;
                pdf=loaded;current=Math.min(current,pdf.numPages);pageInput.max=String(pdf.numPages);queueRender();
            }catch(_){
                if(disposed||ticket!==loadSerial)return;
                controls();status.textContent='PDF 未能加载。请检查网络或登录状态后重试，也可以打开或下载原文件。';retry.hidden=false;
            }
        }
        function resize(){clearTimeout(resizeTimer);resizeTimer=setTimeout(queueRender,180);}
        function stop(){if(disposed)return;disposed=true;loadSerial++;clearTimeout(resizeTimer);window.removeEventListener('resize',resize);window.removeEventListener('pagehide',stop);destroyDocument().catch(()=>{});canvas.width=1;canvas.height=1;}
        controls();
        if(location.protocol==='file:'){
            status.textContent='本地文件可直接打开原 PDF；通过网站访问时可使用翻页阅读器。';
            const native=document.createElement('embed');native.type='application/pdf';native.src=url.href;native.className='pdf-view';viewport.append(native);
        }else{window.addEventListener('resize',resize);window.addEventListener('pagehide',stop);begin();}
        return {stop};
    }
    window.SitePDF={mount};
})();
