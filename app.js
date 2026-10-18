(function () {
'use strict';
const $ = (id) => document.getElementById(id);
const heroes = window.CHARACTERS;
const canvas = $('game');
const ctx = canvas.getContext('2d');
const W = 400, H = 530;
const dialog = $('dialog');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let engine, aimX = W / 2, pointerId = null, drops = 0, rescueUsed = false, soundOn = false;
let lastFrame = 0, visualTime = 0, toastTimer, announcementTimer, audioContext;
let best = 0, bestHero = 0, particles = [], rings = [], labels = [], wonShown = false;
const query = new URLSearchParams(location.search);
const parsedSeed = Number(query.get('seed'));
const runSeed = query.has('seed') && Number.isInteger(parsedSeed) && parsedSeed > 0 && parsedSeed <= 4294967295 ? parsedSeed >>> 0 : (window.crypto ? crypto.getRandomValues(new Uint32Array(1))[0] : Date.now() >>> 0) || 1;
const parsedBeat = Number(query.get('beat'));
const beat = query.has('beat') && Number.isInteger(parsedBeat) && parsedBeat > 0 && parsedBeat <= 10000000 ? parsedBeat : 0;
let rngState = runSeed, currentLevel = 0, nextLevel = 0;
try { best = Math.max(0, Math.min(10000000, Number(localStorage.getItem('zhangchao.best')) || 0)); } catch (_) {}
$('best-score').textContent = best;
if (beat) { $('challenge').hidden = false; $('challenge').textContent = '好友下战书：' + beat + ' 分 · 相同出场顺序，来试试！'; }
const portraits = heroes.map(h => { const img = new Image(); img.src = h.image; img.onload = () => draw(); return img; });
$('lineup').innerHTML = heroes.map((h, i) => '<div class="hero-row ' + (i === 0 ? 'unlocked' : '') + '" data-level="' + i + '"><span class="level-number">' + String(i + 1).padStart(2, '0') + '</span><img src="' + h.image + '" alt=""><div><strong>' + h.name + '</strong><small>' + h.title + '</small></div></div>').join('');
$('mini-lineup').innerHTML = heroes.map(h => '<img src="' + h.image + '" alt="' + h.name + '">').join('');
function random() { rngState += 0x6D2B79F5; let t = rngState; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }
function chooseLevel() { const r = random(); return r < .34 ? 0 : r < .64 ? 1 : r < .85 ? 2 : 3; }
function clampAim(x) { const r = heroes[currentLevel].radius; return Math.max(r + 10, Math.min(W - r - 10, x)); }
function updateQueue() { $('next-image').src = heroes[nextLevel].image; $('next-image').alt = heroes[nextLevel].name; $('next-name').textContent = heroes[nextLevel].name; $('current-name').textContent = '待上场 · ' + heroes[currentLevel].name; aimX = clampAim(aimX); }
function sync() {
  if (!engine) return;
  $('score').textContent = engine.score;
  canvas.setAttribute('aria-label', '合成棋盘，得分 ' + engine.score + '，场上 ' + engine.getBodies().length + ' 位英雄。点击投放' + heroes[currentLevel].name + '；左右方向键瞄准，空格投放。');
  if (engine.score > best) { best = engine.score; $('best-score').textContent = best; try { localStorage.setItem('zhangchao.best', String(best)); } catch (_) {} }
  if (engine.maxLevel > bestHero) { bestHero = engine.maxLevel; document.querySelectorAll('.hero-row').forEach((el, i) => el.classList.toggle('unlocked', i <= bestHero)); }
  $('highest-name').textContent = bestHero ? '已合成 · ' + heroes[bestHero].name : '目标 · 张超';
  $('rescue-button').disabled = rescueUsed || engine.getBodies().length === 0;
  if (beat && engine.score > beat) $('challenge').textContent = '已超越好友 ' + beat + ' 分！继续冲击张超';
}
function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').classList.add('show'); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2200); }
function playSound(level, drop) {
  if (!soundOn) return;
  try {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const now = audioContext.currentTime;
    const notes = drop ? [180] : [330 + level * 42, 440 + level * 50, 660 + level * 64];
    notes.forEach((freq, i) => { const o = audioContext.createOscillator(), g = audioContext.createGain(); o.type = 'sine'; o.frequency.value = freq; g.gain.setValueAtTime(0, now + i * .06); g.gain.linearRampToValueAtTime(.055, now + i * .06 + .01); g.gain.exponentialRampToValueAtTime(.001, now + i * .06 + .2); o.connect(g); g.connect(audioContext.destination); o.start(now + i * .06); o.stop(now + i * .06 + .23); });
  } catch (_) {}
}
function mergeEffect(event) {
  const { level, x, y, points, chain } = event;
  rings.push({ x, y, r: heroes[level].radius, life: 1, color: heroes[level].color });
  if (!reducedMotion) for (let i = 0; i < 15; i++) { const a = Math.random() * Math.PI * 2, speed = 1 + Math.random() * 3; particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 1, life: 1, color: i % 3 ? heroes[level].color : '#d5a143', size: 2 + Math.random() * 3 }); }
  labels.push({ x, y, text: '+' + points, life: 1 });
  $('score-gain').textContent = '+' + points;
  $('score-gain').classList.remove('pop'); void $('score-gain').offsetWidth; $('score-gain').classList.add('pop');
  if (chain > 1 || level >= 4) { const a = $('announcement'); a.textContent = chain > 1 ? chain + ' 连合！' : heroes[level].name + ' · 登场'; a.classList.remove('show'); void a.offsetWidth; a.classList.add('show'); clearTimeout(announcementTimer); announcementTimer = setTimeout(() => a.classList.remove('show'), 1250); }
  playSound(level, false); sync();
}
engine = new MergeEngine({ width: W, height: H, radii: heroes.map(h => h.radius), onMerge: mergeEffect, onChange: sync, onGameOver: () => showResult(false), onWin: () => { if (!wonShown) { wonShown = true; showResult(true); } } });
function drop() {
  if (dialog.open || document.hidden || engine.gameOver || !engine.canDrop) return;
  if (engine.drop(currentLevel, aimX)) { drops++; $('drop-tip').classList.add('dismissed'); currentLevel = nextLevel; nextLevel = chooseLevel(); updateQueue(); sync(); playSound(0, true); }
}
function setAim(event) { const rect = canvas.getBoundingClientRect(); aimX = clampAim((event.clientX - rect.left) * W / rect.width); }
canvas.addEventListener('pointerdown', e => { if (pointerId !== null || dialog.open || (e.button !== 0 && e.pointerType === 'mouse')) return; e.preventDefault(); pointerId = e.pointerId; setAim(e); canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => { if (pointerId === e.pointerId || e.pointerType === 'mouse') setAim(e); });
canvas.addEventListener('pointerup', e => { if (e.pointerId !== pointerId) return; e.preventDefault(); setAim(e); pointerId = null; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); drop(); });
canvas.addEventListener('pointercancel', () => { pointerId = null; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('keydown', e => { if (dialog.open) return; if (['ArrowLeft','ArrowRight',' ','Enter'].includes(e.key)) { e.preventDefault(); if (e.key === 'ArrowLeft') aimX = clampAim(aimX - 15); else if (e.key === 'ArrowRight') aimX = clampAim(aimX + 15); else if (!e.repeat) drop(); } });
function restart() { rngState = runSeed; currentLevel = 0; nextLevel = 0; drops = 0; rescueUsed = false; bestHero = 0; wonShown = false; aimX = W / 2; particles = []; rings = []; labels = []; engine.reset(); $('rescue-count').textContent = '清场一次'; $('drop-tip').classList.remove('dismissed'); document.querySelectorAll('.hero-row').forEach((el,i) => el.classList.toggle('unlocked', i === 0)); if (beat) $('challenge').textContent = '好友下战书：' + beat + ' 分 · 相同出场顺序，来试试！'; updateQueue(); closeDialog(); sync(); }
function closeDialog() { if (dialog.open) dialog.close(); lastFrame = performance.now(); }
function showDialog(title, eyebrow, content, actions, portraitLevel) {
  $('dialog-title').textContent = title; $('dialog-eyebrow').textContent = eyebrow || '';
  $('dialog-content').innerHTML = content;
  $('dialog-art').innerHTML = Number.isInteger(portraitLevel) ? '<img class="result-hero" src="' + heroes[portraitLevel].image + '" alt="' + heroes[portraitLevel].name + '">' : '';
  const actionsEl = $('dialog-actions'); actionsEl.replaceChildren();
  actions.forEach((action, i) => { const b = document.createElement('button'); b.textContent = action.text; b.className = i === 0 ? 'primary-button' : 'secondary-button'; b.addEventListener('click', action.fn); actionsEl.appendChild(b); });
  if (!dialog.open) dialog.showModal();
}
function showResult(won) {
  sync();
  const level = engine.maxLevel;
  showDialog(won ? '张超出世，天下归一！' : '英雄满座，下局再战', won ? '终极合成 · 超神达成' : '本局最高 · ' + heroes[level].name,
    '<div class="result-score">' + engine.score + '</div><p>' + (won ? '你把三国英雄，合成了终极大人物张超。' : '离张超又近了一点。换个落点，再来一局！') + (beat ? '<br>' + (engine.score > beat ? '已超越好友的 ' + beat + ' 分！' : '好友目标：' + beat + ' 分') : '') + '</p>',
    [{ text: won ? '继续合，冲更高分' : '再来一局', fn: won ? closeDialog : restart }, { text: '复制挑战网址', fn: share }], level);
}
function showHelp() { showDialog('三国英雄，碰个头', '玩法 · 简单四步', '<div class="rules"><div class="rule"><span>1</span><div><b>移动瞄准，松手投放</b><small>手机拖动后松手，电脑点击落点。</small></div></div><div class="rule"><span>2</span><div><b>相同人物相碰，合成升级</b><small>共 11 级，最大的终极人物是「张超」。</small></div></div><div class="rule"><span>3</span><div><b>留意上方红线</b><small>英雄堆过红线持续 2 秒，本局结束。</small></div></div><div class="rule"><span>4</span><div><b>借一次东风，腾一点空间</b><small>每局可移走最小的三位英雄，无需看广告。</small></div></div></div>', [{ text: '知道了，开合！', fn: closeDialog }]); }
function showLineup() { showDialog('英雄进阶录', '相同相碰，逐级合成', '<div class="modal-lineup">' + heroes.map((h, i) => '<div><img src="' + h.image + '" alt=""><b>' + h.name + '</b><small>' + (i === 10 ? '终极 · 最大' : '第 ' + (i + 1) + ' 阶') + '</small></div>').join('') + '</div>', [{ text: '回到战场', fn: closeDialog }]); }
async function share() {
  const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('seed', String(runSeed)); if (engine.score > 0) url.searchParams.set('beat', String(engine.score));
  try { await navigator.clipboard.writeText(url.href); toast('挑战网址已复制，粘贴给朋友就能玩'); }
  catch (_) { showDialog('复制网址，邀友来战', '长按或选中下方网址复制', '<input class="share-input" id="share-url" readonly aria-label="游戏挑战网址"><p>朋友打开后，会用相同的人物顺序挑战你的分数。</p>', [{ text: '返回游戏', fn: closeDialog }]); $('share-url').value = url.href; $('share-url').select(); }
}
$('dialog-close').addEventListener('click', closeDialog);
dialog.addEventListener('close', () => { lastFrame = performance.now(); });
dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog(); } });
$('help-button').addEventListener('click', showHelp);
$('lineup-button').addEventListener('click', showLineup);
$('share-button').addEventListener('click', share);
$('restart-button').addEventListener('click', () => { if (!drops || engine.gameOver) restart(); else showDialog('重整旗鼓，再来一局？', '本局得分 ' + engine.score, '<p>重新开始本局，个人最高分会保留。</p>', [{ text: '再来一局', fn: restart }, { text: '继续当前游戏', fn: closeDialog }]); });
$('sound-button').addEventListener('click', () => { soundOn = !soundOn; $('sound-button').setAttribute('aria-pressed', String(soundOn)); $('sound-state').textContent = soundOn ? '已开启' : '已关闭'; playSound(1, false); });
$('rescue-button').addEventListener('click', () => { if (rescueUsed || !engine.getBodies().length) return; showDialog('借东风，解个围', '每局仅此一次', '<p>移走场上最小的三位英雄，<br>腾出空间继续合成。</p>', [{ text: '借东风 · 立即清场', fn: () => { const count = engine.clearSmallest(); rescueUsed = true; $('rescue-count').textContent = '本局已用'; closeDialog(); sync(); toast('东风已到，移走 ' + count + ' 位英雄'); } }, { text: '先留着，继续玩', fn: closeDialog }], 8); });
document.addEventListener('visibilitychange', () => { lastFrame = 0; pointerId = null; if (document.hidden && audioContext) audioContext.suspend(); });
function roundedRect(x,y,w,h,r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') { ctx.roundRect(x,y,w,h,r); return; }
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}
function drawHero(level, x, y, radius, angle, alpha) {
  const h = heroes[level]; ctx.save(); ctx.globalAlpha = alpha == null ? 1 : alpha; ctx.translate(x, y); ctx.rotate(Math.max(-.28, Math.min(.28, angle || 0)));
  ctx.shadowColor = '#7a512d28'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 3;
  ctx.beginPath(); ctx.arc(0, 0, radius - .8, 0, Math.PI * 2); ctx.fillStyle = h.color; ctx.fill(); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  const img = portraits[level]; if (img.complete && img.naturalWidth) ctx.drawImage(img, -radius, -radius, radius * 2, radius * 2);
  ctx.font = '700 ' + Math.max(9, Math.min(15, radius * .33)) + 'px -apple-system, "PingFang SC", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(h.name).width; const labelHeight = Math.max(12, radius * .39); const labelY = radius * .60;
  ctx.fillStyle = level === 10 ? '#aa5b1c' : '#fff8e9'; roundedRect(-tw / 2 - 5, labelY - labelHeight / 2, tw + 10, labelHeight, labelHeight / 2); ctx.fill(); ctx.fillStyle = level === 10 ? '#fff6cf' : '#514333'; ctx.fillText(h.name, 0, labelY + .3); ctx.restore();
}
function drawBackground() {
  ctx.fillStyle = '#fff9ed'; ctx.fillRect(0,0,W,H);
  ctx.save(); ctx.strokeStyle = '#ebdfc6'; ctx.lineWidth = 1;
  for (let y = 155; y < 495; y += 50) { for (let x = 22; x < W; x += 50) { ctx.beginPath(); ctx.arc(x,y,.55,0,Math.PI*2); ctx.stroke(); } }
  ctx.fillStyle = '#f3ead6'; ctx.beginPath(); ctx.moveTo(0,480); ctx.quadraticCurveTo(45,460,85,480); ctx.quadraticCurveTo(125,445,178,478); ctx.quadraticCurveTo(210,460,240,482); ctx.quadraticCurveTo(310,448,348,476); ctx.quadraticCurveTo(375,467,400,480); ctx.lineTo(400,H); ctx.lineTo(0,H); ctx.fill();
  ctx.strokeStyle = '#dfc7a0'; ctx.beginPath(); ctx.moveTo(8,H-8); ctx.lineTo(W-8,H-8); ctx.stroke();
  const danger = engine ? engine.danger : 0; ctx.setLineDash([5,5]); ctx.lineWidth = danger > 0 ? 1.8 : 1; ctx.strokeStyle = danger > 0 ? '#bc493c' : '#d5a08b88'; ctx.beginPath(); ctx.moveTo(14,90); ctx.lineTo(W-14,90); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = danger > 0 ? '#b74431' : '#b8957f'; ctx.font = '9px sans-serif'; ctx.textAlign = 'right'; ctx.fillText('满员警戒线', W - 17, 82); ctx.restore();
  if (!drops) { ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = '#d5c7ad'; ctx.font = '700 24px "Songti SC",serif'; ctx.fillText('群英入场', W/2, H*.53); ctx.font = '11px sans-serif'; ctx.fillStyle = '#b9aa8e'; ctx.fillText('轻轻一放，好戏开场', W/2, H*.53+26); ctx.restore(); }
}
function draw() {
  ctx.save(); ctx.setTransform(canvas.width / W,0,0,canvas.height / H,0,0); drawBackground();
  if (!engine) { ctx.restore(); return; }
  const bodies = engine.getBodies();
  if (!engine.gameOver && !dialog.open) {
    const r = heroes[currentLevel].radius;
    let targetY = H - 8 - r;
    bodies.forEach(b => { const dx = Math.abs(b.position.x - aimX), sum = r + b.circleRadius; if (dx < sum) targetY = Math.min(targetY, b.position.y - Math.sqrt(sum * sum - dx * dx)); });
    ctx.save(); ctx.setLineDash([3,6]); ctx.strokeStyle='#c8b58c88'; ctx.beginPath(); ctx.moveTo(aimX,45+r+5); ctx.lineTo(aimX,Math.max(45+r+5,targetY)); ctx.stroke(); ctx.restore();
    drawHero(currentLevel,aimX,45,r,0,engine.canDrop ? .94 : .36);
    ctx.fillStyle='#9b7952'; ctx.beginPath(); ctx.moveTo(aimX-4,9);ctx.lineTo(aimX+4,9);ctx.lineTo(aimX,14);ctx.fill();
  }
  bodies.forEach(b => drawHero(b.level,b.position.x,b.position.y,b.circleRadius,b.angle));
  rings.forEach(r => {ctx.save();ctx.globalAlpha=r.life*.65;ctx.strokeStyle=r.color;ctx.lineWidth=5*r.life;ctx.beginPath();ctx.arc(r.x,r.y,r.r+(1-r.life)*30,0,Math.PI*2);ctx.stroke();ctx.restore();});
  particles.forEach(p=>{ctx.globalAlpha=p.life;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size*p.life,0,Math.PI*2);ctx.fill();}); ctx.globalAlpha=1;
  labels.forEach(l=>{ctx.globalAlpha=l.life;ctx.fillStyle='#b74431';ctx.strokeStyle='#fff8e9';ctx.lineWidth=3;ctx.font='bold 19px Georgia';ctx.textAlign='center';ctx.strokeText(l.text,l.x,l.y);ctx.fillText(l.text,l.x,l.y);});ctx.globalAlpha=1;
  if(engine.danger>0){ctx.fillStyle='rgba(183,68,49,'+engine.danger*.12+')';ctx.fillRect(0,0,W,95);}
  ctx.restore();
}
function resize() { const ratio = Math.min(window.devicePixelRatio || 1, 2); canvas.width = Math.round(W * ratio); canvas.height = Math.round(H * ratio); draw(); }
function tick(now) {
  const delta = lastFrame ? Math.min(now-lastFrame,50) : 16.67; lastFrame=now;
  if(!dialog.open && !document.hidden){engine.update(delta);visualTime+=delta;const dt=delta/16.67;
    particles.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=.055*dt;p.life-=.025*dt;});particles=particles.filter(p=>p.life>0);
    rings.forEach(r=>r.life-=.04*dt);rings=rings.filter(r=>r.life>0);
    labels.forEach(l=>{l.y-=.65*dt;l.life-=.02*dt;});labels=labels.filter(l=>l.life>0);
  }
  $('danger-message').hidden=engine.danger<.12 || engine.gameOver;
  draw();requestAnimationFrame(tick);
}
window.addEventListener('resize',resize);updateQueue();sync();resize();requestAnimationFrame(tick);
})();
