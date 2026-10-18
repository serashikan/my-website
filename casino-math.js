(function () {
  'use strict';
  const slotMultipliers=[8,10,12,14,16,48];
  function slotReturn(reels,bet){const count=new Set(reels).size;return bet*(count===1?slotMultipliers[reels[0]]:count===2?1:0);}
  const redNumbers=[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  function rouletteReturn(n,choice,bet){const color=choice==='red'||choice==='black';const win=color?n!==0&&(choice==='red')===redNumbers.includes(n):Number(choice)===n;return win?bet*(color?2:36):0;}
  function sicboReturn(ds,choice,bet){const sum=ds.reduce((a,b)=>a+b,0);return new Set(ds).size!==1&&(choice==='small'?sum>=4&&sum<=10:sum>=11&&sum<=17)?bet*2:0;}
  function baccaratHands(draw){
    const p=[draw(),draw()],b=[draw(),draw()],sum=a=>a.reduce((s,v)=>s+v,0)%10;
    let pt=sum(p),bt=sum(b);
    if(pt<8&&bt<8){let third=null;if(pt<=5){third=draw();p.push(third);}if(third===null?bt<=5:bt<=2||(bt===3&&third!==8)||(bt===4&&third>=2&&third<=7)||(bt===5&&third>=4&&third<=7)||(bt===6&&(third===6||third===7)))b.push(draw());}
    pt=sum(p);bt=sum(b);return {p,b,pt,bt,winner:pt===bt?'tie':pt>bt?'player':'banker'};
  }
  function baccaratReturn(winner,choice,bet){return winner==='tie'?(choice==='tie'?bet*9:bet):choice===winner?(choice==='banker'?bet+Math.floor(bet*.95):bet*2):0;}
  function vaultReturn(roll,units){return roll<95?26*units:0;}
  window.CasinoMath=Object.freeze({slotReturn,slotMultipliers:Object.freeze(slotMultipliers),rouletteReturn,sicboReturn,baccaratHands,baccaratReturn,vaultReturn});
})();
