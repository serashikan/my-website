// 十点半：庄家（电脑）对战 / 双人同屏
// 规则：A = 1 点，2–10 按面值，J / Q / K 与大小王都算半点（0.5）
//       点数超过 10.5 即爆牌；牌型从大到小：人五小 > 五小 > 十点半 > 普通点数
//       最多 5 张牌（底牌 1 张 + 最多要 4 张）；同点数算庄家赢（吃平）
// 和别的游戏一样：普通脚本，末尾把自己注册到 window.SiteGames[自己的 URL]
(function () {
  // ====== 想调规则，改这一段就够了 ======
  const CFG = {
    startChips: 100,       // 起始筹码
    bets: [5, 10, 25],     // 可以下的注额
    defaultBet: 5,
    maxCards: 5,           // 底牌 1 张 + 最多要 4 张
    dealerHitBelow: 8,     // 庄家点数低于 8 点必须要牌（想更凶可以改 7.5）
    dealerWinsTie: true,   // 点数相同算庄家赢
    payouts: { 1: 1, 2: 2, 3: 3, 4: 5 } // 净赔率：普通 / 十点半 / 五小 / 人五小
  };

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  // —— 点数全部用「半点」为单位的整数存，避免 0.5 累加出现浮点误差 ——
  // A = 2（1 点）、2–10 = 2×面值、J/Q/K 与大小王 = 1（半点）
  function buildDeck() {
    const deck = [];
    SUITS.forEach(suit => {
      RANKS.forEach((rank, i) => {
        const v = rank === 'A' ? 2 : (i >= 10 ? 1 : (i + 1) * 2);
        deck.push({ r: rank, s: suit, v, red: suit === '♥' || suit === '♦' });
      });
    });
    deck.push({ r: '小王', s: '', v: 1, joker: true });
    deck.push({ r: '大王', s: '', v: 1, joker: true });
    return deck;
  }
  function shuffled(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    return deck;
  }
  // 半点数 → 展示文本：21 → "10.5"，16 → "8"
  function fmt(p) { return p % 2 ? (p / 2).toFixed(1) : String(p / 2); }
  function total(cards) { return cards.reduce((a, c) => a + c.v, 0); }
  function isFace(c) { return c.r === 'J' || c.r === 'Q' || c.r === 'K'; }

  // 牌型等级：0 爆牌 < 1 普通点数 < 2 十点半 < 3 五小 < 4 人五小
  function typeOf(cards) {
    const p = total(cards);
    if (p > 21) return { rank: 0, name: '爆牌', p };
    if (cards.length >= CFG.maxCards) {
      return cards.every(isFace)
        ? { rank: 4, name: '人五小', p }
        : { rank: 3, name: '五小', p };
    }
    if (p === 21) return { rank: 2, name: cards.length === 2 ? '天生十点半' : '十点半', p };
    return { rank: 1, name: '', p };
  }

  function init(container) {
    container.innerHTML = `
      <div class="tenhalf">
        <div class="tenhalf-head">
          <div>
            <p class="codon-kicker">TEN &amp; A HALF</p>
            <h2>十点半</h2>
            <p>凑到最接近 10.5，超过就爆；J / Q / K 和大小王算半点。</p>
          </div>
          <div class="tenhalf-head-actions">
            <button class="tenhalf-mode">双人同屏</button>
            <button class="tenhalf-new">重新开始</button>
          </div>
        </div>

        <div class="tenhalf-players"></div>

        <div class="tenhalf-bet">
          <span class="tenhalf-bet-label">本局下注</span>
          <span class="tenhalf-chips"></span>
          <span class="tenhalf-bank"></span>
        </div>

        <div class="tenhalf-table">
          <section class="tenhalf-hand" data-seat="0">
            <h3>庄家 <em>—</em></h3>
            <div class="tenhalf-cards"></div>
          </section>
          <section class="tenhalf-hand" data-seat="1">
            <h3>你 <em>—</em></h3>
            <div class="tenhalf-cards"></div>
          </section>
        </div>

        <div class="tenhalf-status"></div>

        <div class="tenhalf-actions">
          <button class="tenhalf-hit">要牌</button>
          <button class="tenhalf-stand">停牌</button>
          <button class="tenhalf-next">开始</button>
        </div>

        <p class="tenhalf-tip"></p>
        <div class="tenhalf-log"></div>

        <details class="tenhalf-rules">
          <summary>规则与牌型</summary>
          <ul>
            <li><b>点数</b>：A = 1 点，2–10 按面值，J / Q / K 与大小王都算 <b>半点</b>。超过 10.5 就是爆牌，直接输。</li>
            <li><b>要牌</b>：每人先发一张底牌，之后最多再要 4 张（总共 5 张）。</li>
            <li><b>牌型大小</b>：人五小（5 张全是 J/Q/K） &gt; 五小（5 张未爆） &gt; 十点半（凑满 10.5） &gt; 普通点数。</li>
            <li><b>比大小</b>：牌型相同就比点数，点数大的赢；<b>点数相同算庄家赢</b>（吃平）。</li>
            <li><b>庄家</b>：点数低于 8 点必须要牌，8 点及以上停牌。</li>
            <li><b>赔率</b>（净赢几倍注）：普通 ×1、十点半 ×2、五小 ×3、人五小 ×5；输掉就赔一倍注。</li>
            <li><b>筹码</b>：你和庄家各 100 筹码，赢的从庄家那儿拿、输的进庄家口袋。庄家赔光时按它剩下的封顶赔付；谁筹码见底，下一局自动补满 100。</li>
          </ul>
        </details>
      </div>
    `.trim();

    const root = container.querySelector('.tenhalf');
    const playersEl = root.querySelector('.tenhalf-players');
    const betRow = root.querySelector('.tenhalf-bet');
    const chipsEl = root.querySelector('.tenhalf-chips');
    const bankEl = root.querySelector('.tenhalf-bank');
    const hands = [root.querySelector('.tenhalf-hand[data-seat="0"]'), root.querySelector('.tenhalf-hand[data-seat="1"]')];
    const statusEl = root.querySelector('.tenhalf-status');
    const tipEl = root.querySelector('.tenhalf-tip');
    const logEl = root.querySelector('.tenhalf-log');
    const hitBtn = root.querySelector('.tenhalf-hit');
    const standBtn = root.querySelector('.tenhalf-stand');
    const nextBtn = root.querySelector('.tenhalf-next');

    // ====== 状态 ======
    let mode = 'dealer';      // dealer = 和电脑庄家打；duo = 双人同屏
    let phase = 'bet';        // bet 下注 → play 玩家要牌 → dealer 庄家要牌 → reveal 开牌
    let bet = CFG.defaultBet;
    let chips = CFG.startChips;        // 你的筹码
    let dealerChips = CFG.startChips;  // 庄家的筹码（真对赌，赢得从这儿出）
    let deck = shuffled(buildDeck());
    let cards = [[], []];     // cards[0] 庄家 / 玩家一，cards[1] 你 / 玩家二
    let active = 1;           // 轮到谁要牌
    let round = 0;
    let tip = '';
    let history = [];
    let stats = { win: 0, lose: 0, tie: 0, streak: 0, best: 0 };
    let duoWins = [0, 0];
    let timers = [];
    let disposed = false;

    function schedule(fn, ms) {
      const id = setTimeout(() => {
        timers = timers.filter(t => t !== id);
        if (!disposed) fn();
      }, ms);
      timers.push(id);
      return id;
    }
    function clearTimers() {
      timers.forEach(clearTimeout);
      timers = [];
    }
    function seatName(i) {
      if (mode === 'duo') return i === 0 ? '玩家一' : '玩家二';
      return i === 0 ? '庄家' : '你';
    }
    // 庄家的底牌在玩家行动阶段扣着，开牌（或庄家自己开始要牌）时翻开
    function isHidden(i) {
      if (mode === 'duo') return phase !== 'reveal' && i !== active;
      return i === 0 && phase === 'play';
    }
    function drawCard() {
      if (deck.length < 12) { deck = shuffled(buildDeck()); tip = '牌堆快见底了，重新洗了一副。'; }
      return deck.pop();
    }
    // 手里筹码买得起的最大一档注额（都买不起就退回最小档，等 newRound 补满）
    function affordableBet() {
      const ok = CFG.bets.filter(n => n <= chips);
      return ok.length ? ok[ok.length - 1] : CFG.bets[0];
    }

    // ====== 渲染 ======
    function cardHTML(c, hidden) {
      if (hidden) return '<div class="tenhalf-card is-back"></div>';
      const cls = ['tenhalf-card'];
      if (c.red) cls.push('is-red');
      if (c.joker) cls.push('is-joker');
      return `<div class="${cls.join(' ')}"><span class="r">${c.r}</span><span class="s">${c.s}</span></div>`;
    }
    function handLabel(i) {
      if (!cards[i].length) return '—';
      if (isHidden(i)) return '?';
      const t = typeOf(cards[i]);
      return fmt(t.p) + (t.name ? ' · ' + t.name : '');
    }

    function render() {
      const dealerMode = mode === 'dealer';
      const mySeat = dealerMode ? 1 : active;

      // 玩家面板
      playersEl.innerHTML = [0, 1].map(i => {
        const on = dealerMode
          ? (phase !== 'bet' && phase !== 'reveal' && i === 1)
          : (phase === 'play' && i === active);
        let main, sub;
        if (dealerMode) {
          if (i === 0) {
            main = dealerChips + ' 筹码';
            // 庄家底牌扣着的时候不报点数，改成提示它的要牌线
            sub = cards[0].length && !isHidden(0) ? fmt(typeOf(cards[0]).p) + ' 点' : '低于 8 点必须要牌';
          } else {
            main = chips + ' 筹码';
            sub = `胜 ${stats.win} · 负 ${stats.lose} · 和 ${stats.tie}`;
          }
        } else {
          main = duoWins[i] + ' 胜';
          sub = i === 0 ? '先手' : '后手';
        }
        return `<div class="tenhalf-player ${on ? 'active' : ''}"><b>${seatName(i)}</b><strong>${main}</strong><small>${sub}</small></div>`;
      }).join('');

      // 下注行（双人同屏没有筹码）
      betRow.hidden = !dealerMode;
      if (dealerMode) {
        // 输了钱以后可能已经下不起当前注额，先压回买得起的最大一档
        if (phase === 'bet' && bet > chips) bet = affordableBet();
        // 买不起的注额直接点不动，免得筹码被下成负数
        chipsEl.innerHTML = CFG.bets.map(n =>
          `<button class="tenhalf-chip ${n === bet ? 'is-on' : ''}" data-bet="${n}" ${phase === 'bet' && n <= chips ? '' : 'disabled'}>${n}</button>`
        ).join('');
        bankEl.innerHTML = stats.streak > 1 ? `连胜 <b>${stats.streak}</b>` : `第 <b>${round + 1}</b> 局`;
      }

      // 牌桌
      [0, 1].forEach(i => {
        hands[i].querySelector('h3').innerHTML = `${seatName(i)} <em>${handLabel(i)}</em>`;
        const hidden = isHidden(i);
        hands[i].querySelector('.tenhalf-cards').innerHTML =
          cards[i].map(c => cardHTML(c, hidden)).join('') || '<span class="tenhalf-empty">还没有牌</span>';
        const t = cards[i].length && !hidden ? typeOf(cards[i]) : null;
        hands[i].classList.toggle('is-bust', !!t && t.rank === 0);
        hands[i].classList.toggle('is-hot', !!t && t.p === 21);
      });

      // 按钮：下注 / 开牌阶段没有牌可要，把要牌停牌收起来，少两坨灰按钮
      const canAct = phase === 'play';
      hitBtn.hidden = standBtn.hidden = !canAct && phase !== 'dealer';
      hitBtn.disabled = !canAct || cards[active].length >= CFG.maxCards;
      standBtn.disabled = !canAct;
      nextBtn.hidden = phase === 'play' || phase === 'dealer';
      nextBtn.disabled = false;
      nextBtn.textContent = phase === 'bet'
        ? (dealerMode ? `下注 ${bet} 开局` : '开始发牌')
        : '下一局';

      tipEl.textContent = tip;
      logEl.innerHTML = history.length
        ? history.map(line => `<p>${line}</p>`).join('')
        : '<p class="tenhalf-log-empty">战绩会记在这里。</p>';
    }

    // newTone: 'win' / 'lose' / 'tie'，只用来给状态条上色，不传就是默认墨色
    function say(text, newTone) {
      statusEl.textContent = text;
      statusEl.className = 'tenhalf-status' + (newTone ? ' is-' + newTone : '');
    }
    function pushLog(line) {
      history.unshift(line);
      history = history.slice(0, 6);
    }

    // ====== 一局的流程 ======
    function newRound() {
      clearTimers();
      const minBet = Math.min.apply(null, CFG.bets);
      // 两边谁筹码见底了，下一局就补满，免得卡住
      if (mode === 'dealer' && chips < minBet) {
        chips = CFG.startChips;
        tip = '你的筹码见底了，又补满了 ' + CFG.startChips + '。';
      }
      if (mode === 'dealer' && dealerChips < minBet) {
        dealerChips = CFG.startChips;
        tip = '庄家赔光了，补满 ' + CFG.startChips + ' 再来。';
      }
      if (mode === 'dealer' && bet > chips) bet = affordableBet();
      round++;
      cards = [[], []];
      cards[0].push(drawCard());
      cards[1].push(drawCard());
      active = mode === 'dealer' ? 1 : 0;
      phase = 'play';
      render();
      say(mode === 'dealer'
        ? `第 ${round} 局 · 下注 ${bet}，请选择要牌或停牌。`
        : `第 ${round} 局 · ${seatName(active)}先要牌。`);
    }

    function hit() {
      if (phase !== 'play') return;
      const hand = cards[active];
      if (hand.length >= CFG.maxCards) return;
      hand.push(drawCard());
      const t = typeOf(hand);
      say(`${seatName(active)}要了一张，现在 ${fmt(t.p)} 点${t.name ? '（' + t.name + '）' : ''}。`);
      render();
      // 爆牌或者刚好 10.5，都没得再选了，自动停手
      if (t.rank === 0 || t.p === 21) schedule(stand, 750);
    }

    function stand() {
      if (phase !== 'play') return;
      if (mode === 'dealer') { dealerTurn(); return; }
      if (active === 0) {
        active = 1;
        render();
        say(`轮到${seatName(1)}要牌。`);
        return;
      }
      phase = 'reveal';
      settleDuo();
    }

    // 庄家：低于 CFG.dealerHitBelow 必须要牌，8 点以上停
    function dealerTurn() {
      phase = 'dealer';
      render();
      say('你停牌了，庄家开始要牌……');
      const step = () => {
        const t = typeOf(cards[0]);
        const done = t.rank === 0 || t.p >= CFG.dealerHitBelow * 2 || t.p === 21 || cards[0].length >= CFG.maxCards;
        if (done) { phase = 'reveal'; settleDealer(); return; }
        cards[0].push(drawCard());
        render();
        schedule(step, 620);
      };
      schedule(step, 560);
    }

    function resultLine(label, outcome, delta) {
      const money = delta > 0 ? `+${delta}` : (delta < 0 ? String(delta) : '±0');
      return `${label} · ${money}`;
    }

    function settleDealer() {
      const me = typeOf(cards[1]);
      const dealer = typeOf(cards[0]);
      let outcome;
      if (me.rank === 0) outcome = 'lose';
      else if (dealer.rank === 0) outcome = 'win';
      else if (me.rank !== dealer.rank) outcome = me.rank > dealer.rank ? 'win' : 'lose';
      else if (me.p !== dealer.p) outcome = me.p > dealer.p ? 'win' : 'lose';
      else outcome = CFG.dealerWinsTie ? 'lose' : 'tie';

      // 筹码在两个人之间来回走：赢的从庄家那儿拿，输的直接进庄家口袋
      let delta = 0;
      let capped = false;   // 庄家赔光了，只能按剩下的封顶赔
      if (outcome === 'win') {
        const want = bet * (CFG.payouts[me.rank] || 1);
        delta = Math.min(want, dealerChips);
        capped = delta < want;
      } else if (outcome === 'lose') {
        delta = -bet;
      }
      chips += delta;
      dealerChips -= delta;

      if (outcome === 'win') { stats.win++; stats.streak++; stats.best = Math.max(stats.best, stats.streak); }
      else if (outcome === 'lose') { stats.lose++; stats.streak = 0; }
      else { stats.tie++; }

      const mine = `${fmt(me.p)}${me.name ? '（' + me.name + '）' : ''}`;
      const theirs = `${fmt(dealer.p)}${dealer.name ? '（' + dealer.name + '）' : ''}`;
      const head = outcome === 'win'
          ? `你赢了 ${delta > 0 ? '+' + delta : ''}${capped ? '（庄家赔光了，封顶赔付）' : ''}`
        : outcome === 'lose' ? `你输了 ${delta}${me.rank === 0 ? '（爆牌）' : ''}` : '和局，退回本注';
      const detail = `你 ${mine} 对 庄家 ${theirs}`;
      say(`${head} —— ${detail}。你 ${chips} 筹码，庄家 ${dealerChips} 筹码。`, outcome);
      tip = outcome === 'win' && me.rank > 1 ? `${me.name} ×${CFG.payouts[me.rank] || 1}，赢得漂亮。` : '';
      pushLog(`第 ${round} 局　${detail}　${resultLine(outcome === 'win' ? '胜' : outcome === 'lose' ? '负' : '和', outcome, delta)}`);
      render();
    }

    function settleDuo() {
      const a = typeOf(cards[0]);
      const b = typeOf(cards[1]);
      let winner; // 0 / 1 / -1 和局
      if (a.rank === 0 && b.rank === 0) winner = -1;
      else if (a.rank === 0) winner = 1;
      else if (b.rank === 0) winner = 0;
      else if (a.rank !== b.rank) winner = a.rank > b.rank ? 0 : 1;
      else if (a.p !== b.p) winner = a.p > b.p ? 0 : 1;
      else winner = -1;

      if (winner === -1) stats.tie++;
      else { duoWins[winner]++; }

      const show = (t) => `${fmt(t.p)}${t.name ? '（' + t.name + '）' : ''}`;
      const detail = `玩家一 ${show(a)} 对 玩家二 ${show(b)}`;
      say(winner === -1 ? `和局！—— ${detail}` : `${seatName(winner)}赢了！—— ${detail}`, winner === -1 ? 'tie' : 'win');
      tip = '';
      pushLog(`第 ${round} 局　${detail}　${winner === -1 ? '和' : seatName(winner) + '胜'}`);
      render();
    }

    // ====== 交互 ======
    hitBtn.onclick = hit;
    standBtn.onclick = stand;
    nextBtn.onclick = () => {
      if (phase === 'bet') newRound();
      else if (phase === 'reveal') { phase = 'bet'; render(); say('选好注额，点右边的按钮开局。'); }
    };
    chipsEl.onclick = e => {
      const b = e.target.closest('.tenhalf-chip');
      if (!b || phase !== 'bet') return;
      bet = Number(b.dataset.bet);
      render();
    };
    root.querySelector('.tenhalf-mode').onclick = e => {
      mode = mode === 'dealer' ? 'duo' : 'dealer';
      e.currentTarget.textContent = mode === 'dealer' ? '双人同屏' : '和电脑对战';
      e.currentTarget.classList.toggle('is-on', mode === 'duo');
      resetAll();
    };
    root.querySelector('.tenhalf-new').onclick = resetAll;

    function resetAll() {
      clearTimers();
      phase = 'bet';
      cards = [[], []];
      chips = CFG.startChips;
      dealerChips = CFG.startChips;
      bet = CFG.defaultBet;
      round = 0;
      history = [];
      tip = '';
      stats = { win: 0, lose: 0, tie: 0, streak: 0, best: 0 };
      duoWins = [0, 0];
      active = mode === 'dealer' ? 1 : 0;
      deck = shuffled(buildDeck());
      render();
      say(mode === 'dealer' ? '选好注额，点右边的按钮开局。' : '双人同屏：轮流要牌，最后比大小。');
    }

    resetAll();

    return {
      start() {},
      stop() {
        disposed = true;
        clearTimers();
      }
    };
  }

  let active = null;
  function start() { if (active) active.start(); }
  function stop() { if (active) active.stop(); active = null; }
  function mount(c) { stop(); active = init(c); }

  window.SiteGames = window.SiteGames || {};
  const script = document.currentScript;
  window.SiteGames[script && script.src ? script.src : 'game-shidianban.js'] = { init: mount, start, stop };
})();
