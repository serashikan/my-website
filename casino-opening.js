(function () {
  'use strict';
  const host='<img class="casino-host mephisto-host" src="图片/mephisto-casino-host-v2.png" width="1024" height="1536" alt="梅菲斯特，身着扣好的黑色西装与马甲、白衬衫和整齐的紫色领带，手持话筒的赌场主理人" decoding="async">';
  window.CasinoOpening={
    html(){return `<div class="casino-opening" aria-label="赌场开幕舞台"><div class="opening-stage"><div class="stage-spot spot-left"></div><div class="stage-spot spot-right"></div><div class="opening-title"><small>THE HUNDRED CHIP CHALLENGE</small><h2>一百筹码之夜</h2><p>100 <span>→</span> 100,000</p></div><div class="host-podium">${host}<span>梅菲斯特 · 赌场主理人</span></div><div class="host-speech"><small>梅菲斯特 · 开场白</small><h3>欢迎，今晚的挑战者。</h3><p class="mephisto-introduction">我是<b>梅菲斯特</b>，这家赌场的主理人。欢迎来到「一百筹码之夜」。</p><p>今晚，我交给你 <b>100 枚虚拟筹码</b>。穿过这里的牌桌与机台，试着把它变成 <b>100,000</b>。</p><ol><li>途中不能补领；筹码和剩余弹珠都耗尽，挑战结束。</li><li>到达 1,000、10,000、50,000 点亮里程碑；100,000 正式通关。</li><li>进度自动保存。未完成的牌局退出视为弃局，弹珠机离场则暂停。</li></ol><p class="opening-status"></p><button class="opening-start">接受挑战 · 开始</button><small class="opening-footnote">纯虚拟娱乐 · 无充值、提现或现金价值</small></div><div class="stage-floor"></div></div><div class="stage-curtain curtain-left"></div><div class="stage-curtain curtain-right"></div><div class="stage-valance"></div></div>`;},
    // 用调用方提供的调度器保证切换栏目后不会继续执行舞台回调。
    show(root,{status,onStart,onReveal,schedule}){
      const opening=root.querySelector('.casino-opening'),button=opening.querySelector('.opening-start');
      const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const duration=reduced?0:650;
      opening.hidden=false;opening.classList.remove('curtains-open','entering');
      opening.querySelector('.opening-status').textContent=status.message;
      button.textContent=status.label;button.disabled=false;
      schedule(()=>opening.classList.add('curtains-open'),reduced?0:70);
      button.onclick=()=>{
        if(button.disabled)return;button.disabled=true;opening.classList.remove('curtains-open');
        schedule(()=>{onStart();onReveal();opening.classList.add('entering','curtains-open');schedule(()=>{opening.hidden=true;root.querySelector('.casino-table').focus({preventScroll:true});},duration);},duration);
      };
    }
  };
})();
