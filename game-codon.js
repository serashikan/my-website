// 密码子作曲器：DNA → 密码子 → 氨基酸 → 旋律
(function () {
  const EXAMPLE = 'ATGAGTAAAGGTGCTGAACTGATCGACGGTAAAACCCTGATGAAATCGCTGAACTGTAA';
  const CODON = {
    F:['TTT','TTC'],L:['TTA','TTG','CTT','CTC','CTA','CTG'],I:['ATT','ATC','ATA'],M:['ATG'],V:['GTT','GTC','GTA','GTG'],S:['TCT','TCC','TCA','TCG','AGT','AGC'],P:['CCT','CCC','CCA','CCG'],T:['ACT','ACC','ACA','ACG'],A:['GCT','GCC','GCA','GCG'],Y:['TAT','TAC'],H:['CAT','CAC'],Q:['CAA','CAG'],N:['AAT','AAC'],K:['AAA','AAG'],D:['GAT','GAC'],E:['GAA','GAG'],C:['TGT','TGC'],W:['TGG'],R:['CGT','CGC','CGA','CGG','AGA','AGG'],G:['GGT','GGC','GGA','GGG'],Stop:['TAA','TAG','TGA']
  };
  const names = {F:'Phe',L:'Leu',I:'Ile',M:'Met',V:'Val',S:'Ser',P:'Pro',T:'Thr',A:'Ala',Y:'Tyr',H:'His',Q:'Gln',N:'Asn',K:'Lys',D:'Asp',E:'Glu',C:'Cys',W:'Trp',R:'Arg',G:'Gly',Stop:'Stop'};
  const bases = ['A','T','C','G'];
  const scales = { major:[0,2,4,5,7,9,11], pentatonic:[0,2,4,7,9], minor:[0,2,3,5,7,8,10] };
  // 按生物化学性质分区：低音体现特殊结构/酸性，中音承载疏水核心，高音表现极性、碱性与芳香族。
  const BIO_NOTES = {
    G: 48, P: 50, C: 52,             // 特殊结构：C3 D3 E3
    D: 55, E: 57,                     // 酸性：G3 A3
    A: 60, V: 62, L: 64, I: 67, M: 69, // 疏水：C4 D4 E4 G4 A4
    S: 69, T: 72, N: 74, Q: 79,      // 极性：A4 C5 D5 G5
    K: 76, R: 79, H: 81,             // 碱性：E5 G5 A5
    F: 84, Y: 86, W: 88              // 芳香族：C6 D6 E6
  };
  const CANONICAL = {A:'GCT',R:'CGT',N:'AAT',D:'GAT',C:'TGT',Q:'CAA',E:'GAA',G:'GGT',H:'CAT',I:'ATT',L:'TTA',K:'AAA',M:'ATG',F:'TTT',P:'CCT',S:'TCT',T:'ACT',W:'TGG',Y:'TAT',V:'GTT'};
  const AA_BY_NOTE = Object.entries(BIO_NOTES).sort((a,b)=>a[1]-b[1]);
  let activeGame = null;

  function translate(codon) { for (const aa in CODON) if (CODON[aa].includes(codon)) return aa; return '?'; }
  function clean(s) { return s.toUpperCase().replace(/[^ATCG]/g, ''); }
  function noteFor(aa, scale) {
    if (aa === 'Stop') return null;
    const base = BIO_NOTES[aa];
    if (base == null) return null;
    // 默认五声音阶保留生化分类设计；其它调式将音符吸附到最近的调式音级。
    if (scale === 'pentatonic') return base;
    const root = 60, semitones = scales[scale];
    const octave = Math.floor((base - root) / 12);
    const within = ((base - root) % 12 + 12) % 12;
    const nearest = semitones.reduce((best, n) => Math.abs(n - within) < Math.abs(best - within) ? n : best, semitones[0]);
    return root + octave * 12 + nearest;
  }
  function init(container) {
    container.innerHTML = `<div class="codon-game"><div class="codon-head"><div><p class="codon-kicker">GENETIC SCORE</p><h2>密码子作曲器</h2><p>每三个碱基组成一个密码子，再把遗传信息翻译成旋律。</p></div><span class="codon-source">大肠杆菌 · 教学短片段</span></div>
      <label class="codon-label">DNA 序列 <textarea class="codon-seq" spellcheck="false">${EXAMPLE}</textarea></label>
      <div class="codon-presets"><button data-preset="example">载入 E. coli 示例</button><button data-preset="short">教学短序列</button><button data-preset="clear">清空</button></div>
      <div class="codon-controls"><label>调式<select class="codon-scale"><option value="major">C 大调</option><option value="pentatonic">五声音阶</option><option value="minor">自然小调</option></select></label><label>速度<input class="codon-bpm" type="range" min="60" max="300" value="108"><output>108 BPM</output></label><button class="codon-play">▶ 播放</button><button class="codon-stop">■ 停止</button></div>
      <div class="codon-readout"><div class="codon-track"></div><p class="codon-hint">点击序列中的一个碱基，可以试听点突变。</p></div>
      <details class="codon-reverse"><summary>乐谱 → DNA：反编译演示</summary><p>输入单声部音符（例如 C4 D4 G4），系统会按当前生化音区映射推测氨基酸和默认密码子。</p><textarea class="codon-notes" spellcheck="false">G4 A4 B4 C5 B4 A4 G4 A4 G4 A4 B4 C5 D5 C5 B4 A4 G4 A4 B4 C5 B4 A4 G4 E4 G4 A4 B4 C5 B4 A4 G4 A4 G4 E4 D4 C4 D4 E4 G4</textarea><button class="codon-decode">生成候选序列</button><div class="codon-decoded"></div></details>
      <div class="codon-legend"><span>起始密码子</span><span>氨基酸</span><span>终止密码子</span></div></div>`;
    const root = container.querySelector('.codon-game'), seq = root.querySelector('.codon-seq'), track = root.querySelector('.codon-track'), scale = root.querySelector('.codon-scale'), bpm = root.querySelector('.codon-bpm'), output = root.querySelector('output');
    let audio = null, timer = null, current = -1;
    function render() { const s = clean(seq.value); seq.value = s; track.innerHTML = ''; for (let i=0;i<s.length;i+=3) { const c=s.slice(i,i+3), aa=translate(c); const el=document.createElement('button'); el.className='codon-cell ' + (aa==='Stop'?'stop ':'') + (aa==='M'?'start ':''); el.dataset.index=i; el.innerHTML=`<b>${c || '···'}</b><small>${names[aa]||'—'}</small>`; track.appendChild(el); } }
    function beep(freq, duration) { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); const osc=audio.createOscillator(), gain=audio.createGain(); osc.type='triangle'; osc.frequency.value=freq; gain.gain.setValueAtTime(.0001,audio.currentTime); gain.gain.exponentialRampToValueAtTime(.11,audio.currentTime+.015); gain.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+duration-.02); osc.connect(gain).connect(audio.destination); osc.start(); osc.stop(audio.currentTime+duration); }
    function play(start=0) { stop(); const s=clean(seq.value), cells=[...track.children], dur=60/Number(bpm.value); let i=start; function step(){ if(i>=cells.length){current=-1; return;} cells.forEach(x=>x.classList.remove('playing')); const cell=cells[i]; cell.classList.add('playing'); const aa=translate(s.slice(i*3,i*3+3)); const midi=noteFor(aa,scale.value); if(midi) beep(440*Math.pow(2,(midi-69)/12),dur*.86); current=i++; timer=setTimeout(step,dur*1000); } step(); }
    function stop(){ if(timer) clearTimeout(timer); timer=null; [...track.children].forEach(x=>x.classList.remove('playing')); current=-1; }
    seq.addEventListener('input',render); scale.addEventListener('change',render); bpm.addEventListener('input',()=>output.textContent=bpm.value+' BPM'); root.querySelector('.codon-play').onclick=()=>play(); root.querySelector('.codon-stop').onclick=stop;
    root.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{ seq.value=b.dataset.preset==='example'?EXAMPLE:b.dataset.preset==='short'?'ATG GCC TTT GAA TAA':''; render(); });
    track.onclick=e=>{ const cell=e.target.closest('.codon-cell'); if(!cell)return; const pos=Number(cell.dataset.index), s=clean(seq.value), old=s[pos], next=bases[(bases.indexOf(old)+1)%4]; seq.value=s.slice(0,pos)+next+s.slice(pos+1); render(); play(Math.floor(pos/3)); };
    function decodeNotes() { const notes=root.querySelector('.codon-notes').value.toUpperCase().match(/[A-G](?:#|B)?[0-8]/g)||[]; const aas=notes.map(n=>{ const val=Number(n.slice(-1))*12 + ({C:0,D:2,E:4,F:5,G:7,A:9,B:11}[n[0]]||0) + (n[1]==='#'?1:n[1]==='B'?-1:0); return AA_BY_NOTE.reduce((best,[aa,p])=>Math.abs(p-val)<Math.abs(best[1]-val)?[aa,p]:best,AA_BY_NOTE[0])[0]; }); const codons=aas.map(a=>CANONICAL[a]||'NNN'); root.querySelector('.codon-decoded').innerHTML=`<p><b>候选氨基酸：</b>${aas.join(' · ')||'未识别'}</p><p><b>默认密码子：</b><span class="decoded-seq">${codons.join(' ')}</span></p><small>这是基于当前音区映射的候选结果；同一音符可能对应多个生物学解释。</small>`; }
    root.querySelector('.codon-decode').onclick=decodeNotes;
    render();
    return { start(){}, stop(){ stop(); if(audio) { audio.close(); audio=null; } } };
  }
  function start() { if (activeGame) activeGame.start(); }
  function stop() { if (activeGame) { activeGame.stop(); activeGame = null; } }
  function mount(container) { stop(); activeGame = init(container); }
  window.SiteGames = window.SiteGames || {}; const script=document.currentScript; window.SiteGames[script && script.src ? script.src : 'game-codon.js']={init: mount, start, stop};
})();
