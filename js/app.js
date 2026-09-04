/* 爬山趣 · 应用逻辑 */
'use strict';

/* ================= 工具 ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function hashStr(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function rng(seedStr) {
  let a = hashStr(seedStr);
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fmtNum = (n) => n.toLocaleString('zh-CN');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ================= 定位与距离 ================= */
const haversine = (lat1, lng1, lat2, lng2) => {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

const distToMountain = (m) => {
  if (!state.lastPos) return null;
  const c = COORDS[m.id];
  return c ? haversine(state.lastPos.lat, state.lastPos.lng, c[0], c[1]) : null;
};

const fmtDist = (km) =>
  km < 1 ? `${Math.round(km * 1000)} m`
  : km < 100 ? `${km.toFixed(1)} km`
  : `${fmtNum(Math.round(km))} km`;

function nearestMountain() {
  if (!state.lastPos) return null;
  let best = null, bestD = Infinity;
  for (const m of MOUNTAINS) {
    const d = distToMountain(m);
    if (d !== null && d < bestD) { bestD = d; best = m; }
  }
  return best ? { m: best, d: bestD } : null;
}

function requestLocation() {
  if (!navigator.geolocation) { toast('当前浏览器不支持定位 📵'); return; }
  toast('正在精确定位，请保持 GPS / Wi-Fi 开启…');
  let best = null, finished = false, watchId = null;
  const stopWatch = () => { if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; } };
  const succeed = () => {
    if (finished) return;
    finished = true;
    stopWatch();
    const c = best.coords;
    state.lastPos = { lat: c.latitude, lng: c.longitude, accuracy: Math.round(c.accuracy), at: best.timestamp };
    saveState();
    toast(`定位成功！精度 ±${state.lastPos.accuracy} 米 📍`);
    route();
  };
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
      if (best.coords.accuracy <= 30) succeed(); // 精度足够好，提前结束
    },
    (err) => {
      if (best) return; // 已拿到定位，忽略个别失败
      finished = true;
      stopWatch();
      const msg = err.code === 1
        ? '定位权限被拒绝：请点击浏览器地址栏的 ⚙️/🔒 图标，将位置设为“允许”后重试'
        : err.code === 3 ? '定位超时：请到开阔处并开启 GPS 后重试'
        : '定位失败，请稍后重试';
      toast(msg);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
  setTimeout(() => {
    if (finished) return;
    if (best) succeed();
    else { finished = true; stopWatch(); toast('定位超时：请确认设备定位服务已开启'); }
  }, 18000);
}

/* 查询浏览器定位权限状态 */
async function locPermState() {
  try {
    return (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch {
    return 'unknown';
  }
}

/* 首次进入发现页时自动打开定位（每次会话最多一次） */
async function maybeAutoLocate() {
  if (state.lastPos) return;
  try { if (sessionStorage.getItem('pashanqu.locTried')) return; } catch { /* 隐私模式下忽略 */ }
  try { sessionStorage.setItem('pashanqu.locTried', '1'); } catch { /* 同上 */ }
  const st = await locPermState();
  if (st === 'granted' || st === 'prompt' || st === 'unknown') requestLocation();
}

/* ================= 存储 ================= */
const STORE_KEY = 'pashanqu.v1';

const okAvatar = (v) =>
  typeof v === 'string' && (v.startsWith('data:image/') ? v.length < 400000 : v.length > 0 && v.length <= 4);

const avatarHtml = (a) => (a && a.startsWith('data:')) ? `<img src="${a}" alt="头像">` : (a || '🧗');

/* 把用户照片裁剪压缩为 128×128 的头像 dataURL */
function fileToAvatarDataUrl(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const size = 128;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      cb(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => cb(null);
    img.src = reader.result;
  };
  reader.onerror = () => cb(null);
  reader.readAsDataURL(file);
}

const defaultState = () => ({
  nickname: '山中客',
  avatar: '🧗',
  motto: '山不在高，爬了就行 ⛰️',
  joinedAt: Date.now(),
  records: [],
  lastPos: null,
  chats: [],
  tts: false,
  climb: null,
  climbHistory: [],
});

let state = (() => {
  const d = defaultState();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return d;
    const p = JSON.parse(raw);
    return {
      ...d,
      nickname: typeof p.nickname === 'string' && p.nickname.trim() ? p.nickname.trim().slice(0, 16) : d.nickname,
      avatar: okAvatar(p.avatar) ? p.avatar : d.avatar,
      motto: typeof p.motto === 'string' && p.motto.trim() ? p.motto.trim().slice(0, 30) : d.motto,
      joinedAt: Number.isFinite(p.joinedAt) ? p.joinedAt : d.joinedAt,
      lastPos: p.lastPos && Number.isFinite(p.lastPos.lat) && Number.isFinite(p.lastPos.lng) ? p.lastPos : null,
      records: Array.isArray(p.records) ? p.records : [],
      chats: Array.isArray(p.chats) ? p.chats.filter((c) => c && typeof c.text === 'string' && (c.role === 'user' || c.role === 'bot')).slice(-60) : [],
      tts: p.tts === true,
      climb: p.climb && typeof p.climb.cid === 'string' && Array.isArray(p.climb.log)
        ? { cid: p.climb.cid, startedAt: Number.isFinite(p.climb.startedAt) ? p.climb.startedAt : Date.now(), log: p.climb.log.filter((l) => l && Number.isFinite(+l.meters)) }
        : null,
      climbHistory: Array.isArray(p.climbHistory)
        ? p.climbHistory.filter((h) => h && typeof h.cid === 'string' && Number.isFinite(h.startedAt) && Number.isFinite(h.finishedAt))
        : [],
    };
  } catch {
    return d;
  }
})();

const saveState = () => localStorage.setItem(STORE_KEY, JSON.stringify(state));

const mountainById = (id) => MOUNTAINS.find((m) => m.id === id);
const challengeById = (id) => CHALLENGES.find((c) => c.id === id);

/* ================= 统计与成就 ================= */
function computeStats() {
  const ids = new Set();
  let elev = 0;
  for (const r of state.records) {
    const m = mountainById(r.mountainId);
    if (!m) continue;
    ids.add(r.mountainId);
    elev += m.elevation;
  }
  return { count: state.records.length, distinct: ids.size, ids, elev, climbSummits: (state.climbHistory || []).length };
}

const ACHIEVEMENTS = [
  { id: 'first', icon: '🥾', name: '初出茅庐', desc: '完成第一次登顶打卡', test: (s) => s.count >= 1 },
  { id: 'three', icon: '🗺️', name: '渐入佳境', desc: '打卡 3 座不同的山', test: (s) => s.distinct >= 3 },
  { id: 'five', icon: '🎒', name: '登山达人', desc: '打卡 5 座不同的山', test: (s) => s.distinct >= 5 },
  { id: 'ten', icon: '🔥', name: '坚持不懈', desc: '累计完成 10 次打卡', test: (s) => s.count >= 10 },
  {
    id: 'wuyue', icon: '🏔️', name: '五岳集邮', desc: '集齐泰、华、衡、恒、嵩',
    test: (s) => WUYUE_IDS.every((id) => s.ids.has(id)),
  },
  { id: 'alt5k', icon: '📈', name: '步履不停', desc: '累计登顶海拔 5000 米', test: (s) => s.elev >= 5000 },
  { id: 'alt20k', icon: '🚀', name: '海拔收藏家', desc: '累计登顶海拔 20000 米', test: (s) => s.elev >= 20000 },
  {
    id: 'snow', icon: '❄️', name: '雪线之上', desc: '登顶 4000 米以上的山',
    test: (s) => [...s.ids].some((id) => (mountainById(id)?.elevation || 0) >= 4000),
  },
  { id: 'vsummit', icon: '🎩', name: '云端登顶', desc: '完成一次步步登峰虚拟登顶', test: (s) => s.climbSummits >= 1 },
  {
    id: 'everest', icon: '👑', name: '8848 俱乐部', desc: '用日常爬升虚拟登顶珠峰',
    test: () => (state.climbHistory || []).some((h) => h.cid === 'everest'),
  },
];

const unlockedIds = () => ACHIEVEMENTS.filter((a) => a.test(computeStats())).map((a) => a.id);

/* ================= SVG 生成 ================= */
let uidCounter = 0;
const uid = () => ++uidCounter;

function mountainScene(m) {
  const [skyTop, skyBottom, back, front] = m.colors;
  const r = rng(m.id + 'scene');
  const sunX = 60 + Math.round(r() * 280);
  const sunY = 30 + Math.round(r() * 26);
  const id = `sky-${m.id}-${uid()}`;
  return `
  <svg class="scene" viewBox="0 0 400 190" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${skyTop}"/>
        <stop offset="1" stop-color="${skyBottom}"/>
      </linearGradient>
    </defs>
    <rect width="400" height="190" fill="url(#${id})"/>
    <circle class="sun" cx="${sunX}" cy="${sunY}" r="19" fill="#fff6dd" opacity=".92"/>
    <circle class="sun-halo" cx="${sunX}" cy="${sunY}" r="30" fill="#fff6dd" opacity=".18"/>
    <g class="clouds cl1" fill="rgba(255,255,255,.5)">
      <ellipse cx="${(sunX + 150) % 360 + 20}" cy="36" rx="34" ry="8"/>
      <ellipse cx="${(sunX + 150) % 360 + 40}" cy="42" rx="22" ry="6"/>
    </g>
    <g class="clouds cl2" fill="rgba(255,255,255,.5)"><ellipse cx="${(sunX + 290) % 340 + 20}" cy="66" rx="26" ry="6"/></g>
    <path fill="${back}" opacity=".92" d="M-10,152 L52,76 L94,110 L148,42 L204,114 L252,82 L300,142 L346,106 L410,152 L410,200 L-10,200 Z"/>
    <path fill="${front}" d="M-10,176 L58,122 L118,164 L184,98 L252,160 L314,124 L372,168 L410,142 L410,200 L-10,200 Z"/>
    <g class="birds" stroke="rgba(255,255,255,.85)" fill="none" stroke-width="2" stroke-linecap="round">
      <path d="M${(sunX + 60) % 300 + 40},56 q6,-7 12,0 M${(sunX + 60) % 300 + 58},48 q6,-7 12,0"/>
    </g>
  </svg>`;
}

function elevationProfile(m) {
  const r = rng(m.id + 'profile');
  const W = 340, H = 110, pad = 8, n = 16;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const env = Math.pow(t, 1.35);
    const noise = (r() - 0.5) * 24 * (1 - t * 0.55);
    let y = H - pad - (env * (H - 2 * pad) + noise);
    y = Math.max(pad, Math.min(H - pad, y));
    if (i === n - 1) y = pad + 2;
    pts.push([(i / (n - 1)) * W, y]);
  }
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `M0,${H} L${line} L${W},${H} Z`;
  const gid = `eg-${m.id}-${uid()}`;
  const [sx, sy] = pts[n - 1];
  return `
  <svg viewBox="0 0 ${W} ${H + 26}" aria-label="海拔剖面示意">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${m.colors[2]}" stop-opacity=".55"/>
        <stop offset="1" stop-color="${m.colors[2]}" stop-opacity=".08"/>
      </linearGradient>
    </defs>
    <path d="${area}" fill="url(#${gid})"/>
    <polyline points="${line}" fill="none" stroke="${m.colors[3]}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
    <g>
      <circle cx="${sx}" cy="${sy}" r="4" fill="${m.colors[3]}"/>
      <circle cx="${sx}" cy="${sy}" r="7" fill="none" stroke="${m.colors[3]}" stroke-opacity=".4" stroke-width="2"/>
    </g>
    <line x1="${sx}" y1="${sy + 9}" x2="${sx}" y2="${H + 8}" stroke="${m.colors[3]}" stroke-dasharray="3 3" stroke-width="1.2" opacity=".6"/>
    <text x="2" y="${H + 22}" font-size="10" fill="#8ba397">起点 · 山脚</text>
    <text x="${W}" y="${H + 22}" font-size="10" fill="${m.colors[3]}" font-weight="700" text-anchor="end">山顶 · ${fmtNum(m.elevation)}m</text>
  </svg>`;
}

/* ================= 组件 ================= */
function diffDots(d) {
  return `<span class="diff-dots d${d}" title="难度 ${d}/5 ${DIFF_LABELS[d]}">${
    [1, 2, 3, 4, 5].map((i) => `<i class="${i <= d ? 'lit' : ''}"></i>`).join('')
  }</span>`;
}

const starRow = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

function mountainCard(m) {
  const d = distToMountain(m);
  return `
  <div class="m-card" role="button" tabindex="0" aria-label="${esc(m.name)}" data-action="open-mountain" data-id="${m.id}">
    <div class="art">${mountainScene(m)}${d !== null ? `<span class="dist-tag">📍 ${fmtDist(d)}</span>` : ''}<span class="elev-tag">${fmtNum(m.elevation)}m</span></div>
    <div class="body">
      <div class="name"><span>${m.emoji}</span>${esc(m.name)}</div>
      <div class="loc">${esc(m.province)}</div>
      <div class="meta">
        ${diffDots(m.difficulty)}
        <span class="stars">★ ${m.scenery.toFixed(1)}</span>
      </div>
    </div>
  </div>`;
}

function mountainMini(m, sub, climbed) {
  const d = distToMountain(m);
  return `
  <div class="m-mini" role="button" tabindex="0" aria-label="${esc(m.name)}" data-action="open-mountain" data-id="${m.id}">
    <div class="art">${mountainScene(m)}${d !== null ? `<span class="dist-tag">📍 ${fmtDist(d)}</span>` : ''}</div>
    <div class="body">
      <div class="name">${m.emoji} ${esc(m.name)}${climbed ? ' <span class="mini-done">✅</span>' : ''}</div>
      <div class="sub" title="${esc(sub || '')}">${esc(sub || `${m.province} · ${fmtNum(m.elevation)}m`)}</div>
    </div>
  </div>`;
}

function sortedRecords() {
  return [...state.records].sort((a, b) =>
    (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0)
  );
}

function feedItem(r, { deletable = false } = {}) {
  const m = mountainById(r.mountainId);
  if (!m) return '';
  return `
  <div class="feed-item">
    <div class="ava">${m.emoji}</div>
    <div class="txt">
      <div class="line1"><b>${esc(state.nickname)}</b> 登顶了 <button type="button" class="linklike" data-action="open-mountain" data-id="${m.id}">${esc(m.name)}</button></div>
      ${r.notes ? `<div class="notes">${esc(r.notes)}</div>` : ''}
      <div class="meta-row">
        <span>${esc(r.date)}${r.duration ? ` · 用时 ${r.duration} 小时` : ''}</span>
        <span style="display:flex;align-items:center;gap:8px">
          <span class="stars">${starRow(r.rating)}</span>
          ${deletable ? `<button class="del" data-action="del-record" data-id="${r.id}" title="删除记录" aria-label="删除记录">✕</button>` : ''}
        </span>
      </div>
    </div>
  </div>`;
}

/* ================= GitHub 推荐引擎（每日 JSON） ================= */
let remoteRecs = null;

function fetchRecs() {
  if (typeof fetch !== 'function') return;
  const stamp = todayStr();
  fetch(`api/recs.json?d=${stamp}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((d) => {
      if (!d || d.source !== 'github-actions' || !Array.isArray(d.trending)) return;
      remoteRecs = d;
      if ((location.hash || '#/home').startsWith('#/home')) route();
    })
    .catch(() => { /* 离线或文件缺失：静默回退本地推荐 */ });
}

function recMountain(id) {
  return mountainById(id);
}

/* ================= 视图：首页 ================= */
function climbHomeCard() {
  const hist = state.climbHistory || [];
  if (!state.climb) {
    return `
    <div class="climb-teaser" role="button" tabindex="0" data-action="goto-climb">
      <div class="ct-txt"><b>🧗 步步登峰</b><small>${hist.length ? `已云端登顶 ${hist.length} 座 · 去下一座！` : '把每天爬的楼梯，变成登顶名山的旅程'}</small></div>
      <span class="btn btn-primary">开启</span>
    </div>`;
  }
  const info = climbInfo();
  if (!info) return '';
  const { ch } = info;
  const pct = Math.round(info.frac * 100);
  return `
  <div class="climb-teaser on" role="button" tabindex="0" data-action="goto-climb">
    <div class="ct-txt">
      <div class="ct-top"><b>${ch.emoji} 正在攀登 ${ch.name}</b><span class="climb-pct">${pct}%</span></div>
      <div class="ct-bar"><i style="width:${pct}%"></i></div>
      <small>已爬升 ${fmtNum(info.climbed)}m / ${fmtNum(ch.elevation)}m · 当前：${info.pos ? info.pos.name : '山脚'}${info.next ? ` → ${info.next.name}` : ''}</small>
    </div>
  </div>`;
}

function viewHome() {
  const s = computeStats();
  const near = nearestMountain();
  const featured = [...MOUNTAINS].sort((a, b) => b.scenery - a.scenery).slice(0, 6);
  const themes = ['看日出', '夜爬', '云海', '红叶', '高山草甸', '佛教名山', '道教名山', '五岳'];
  const latest = sortedRecords().slice(0, 3);
  const brief = agentBriefing();
  const h = new Date().getHours();
  const dayEmoji = h < 6 || h >= 19 ? '🌙' : h < 11 ? '🌅' : h < 15 ? '☀️' : '🌤️';
  return `
  <div class="hero">
    <div class="scene-wrap">
      ${mountainScene({ id: 'hero', colors: ['#1b4332', '#52b788', '#2d6a4f', '#123527'] })}
      <div class="hero-content">
        <div class="hello">你好，${esc(state.nickname)} ${dayEmoji}</div>
        <h1>爬山趣</h1>
        <div class="slogan">会当凌绝顶，一览众山小</div>
        <div class="hero-stats">
          <div class="hstat"><b>${s.count}</b><span>打卡次数</span></div>
          <div class="hstat"><b>${s.distinct}</b><span>登顶山峰</span></div>
          <div class="hstat"><b>${fmtNum(s.elev)}m</b><span>累计海拔</span></div>
        </div>
        ${near ? `<div class="near-line">📍 离你最近：${esc(near.m.name)} · 约 ${fmtDist(near.d)}</div>` : ''}
      </div>
    </div>
  </div>

  <div class="brief-card">
    <div class="brief-head">
      <span class="brief-ava" aria-hidden="true">🏔️</span>
      <div class="brief-title"><b>山灵说</b><small>AI 登山搭子</small></div>
      <button type="button" class="chip" data-action="open-chat">💬 聊聊</button>
    </div>
    <p class="brief-text">${esc(brief.text).replace(/\n/g, '<br>')}</p>
    ${brief.rec ? chatCard(brief.rec.m.id) : ''}
  </div>

  ${climbHomeCard()}

  <div class="section-title">
    ${remoteRecs ? `今日精选 <small>📡 GitHub 推荐引擎 · ${esc(remoteRecs.forDate)} 更新${remoteRecs.weatherEnabled ? ' · 看天推荐' : ''}</small>` : `为你推荐 <small>风景评分最高</small>`}
  </div>
  ${remoteRecs
    ? `<div class="h-scroll">${remoteRecs.trending.map((r) => {
        const m = recMountain(r.id);
        return m ? mountainMini(m, r.reason, s.ids.has(r.id)) : '';
      }).join('')}</div>
    <div class="section-title">当季最佳 <small>${remoteRecs.week} 周 · 季节与热度评分</small></div>
    <div class="chips-row">
      ${remoteRecs.seasonal.map((r) => `<button type="button" class="chip" data-action="open-mountain" data-id="${r.id}" title="${esc(r.reason)}">${r.emoji} ${esc(r.name)}</button>`).join('')}
    </div>
    ${Array.isArray(remoteRecs.weekend) && remoteRecs.weekend.length ? `
    <div class="section-title">周末就出发 <small>${esc(remoteRecs.weekendOf || '')} 周末 · 结合天气预报</small></div>
    <div class="h-scroll">${remoteRecs.weekend.map((r) => {
      const m = recMountain(r.id);
      return m ? mountainMini(m, r.reason, s.ids.has(r.id)) : '';
    }).join('')}</div>` : ''}`
    : `<div class="h-scroll">${featured.map((m) => mountainMini(m)).join('')}</div>`}

  <div class="section-title">热门主题 <small>点击直达</small></div>
  <div class="chips-row">
    ${themes.map((t) => `<button type="button" class="chip" data-action="theme" data-tag="${esc(t)}"># ${esc(t)}</button>`).join('')}
  </div>

  <div class="section-title">最近打卡 <small>${s.count} 条记录</small></div>
  ${latest.length
    ? latest.map((r) => feedItem(r)).join('')
    : `<div class="card empty"><div class="empty-icon">🥾</div>还没有打卡记录<br>从登顶第一座山开始吧<div><button class="btn btn-primary" data-action="checkin">✓ 立即打卡</button></div></div>`}
  `;
}

/* ================= 视图：发现 ================= */
const exploreState = { q: '', region: '全部', diff: '全部', sort: 'hot', tag: '' };

function filteredMountains() {
  let list = [...MOUNTAINS];
  const q = exploreState.q.trim();
  if (q) {
    list = list.filter((m) =>
      [m.name, m.province, m.subtitle, ...m.tags].join(' ').toLowerCase().includes(q.toLowerCase())
    );
  }
  if (exploreState.region !== '全部') list = list.filter((m) => m.region === exploreState.region);
  const d = DIFFS.find((x) => x.key === exploreState.diff);
  if (d) list = list.filter((m) => m.difficulty >= d.min && m.difficulty <= d.max);
  if (exploreState.tag) list = list.filter((m) => m.tags.includes(exploreState.tag));
  if (exploreState.sort === 'elev') list.sort((a, b) => b.elevation - a.elevation);
  else if (exploreState.sort === 'easy') list.sort((a, b) => a.difficulty - b.difficulty || b.scenery - a.scenery);
  else if (exploreState.sort === 'near' && state.lastPos) {
    list.sort((a, b) => (distToMountain(a) ?? Infinity) - (distToMountain(b) ?? Infinity));
  } else list.sort((a, b) => b.scenery - a.scenery);
  return list;
}

function viewExplore() {
  const list = filteredMountains();
  return `
  <div class="search-bar">
    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>
    <input id="explore-search" type="search" placeholder="搜山名、地区或标签…" value="${esc(exploreState.q)}">
    <button type="button" class="loc-btn ${state.lastPos ? 'on' : ''}" data-action="locate" title="${state.lastPos ? `已定位（精度 ±${state.lastPos.accuracy} 米），点击重新定位` : '精确定位我的位置'}">
      <span aria-hidden="true">📍</span>
      <small>${state.lastPos ? `±${state.lastPos.accuracy}m` : '定位'}</small>
    </button>
  </div>

  ${!state.lastPos ? `
  <div class="loc-banner" id="loc-banner" data-status="loading">
    <span class="lb-icon" aria-hidden="true">📍</span>
    <div class="lb-txt">
      <b>打开定位功能</b>
      <small id="loc-banner-sub">显示每座山与你的实时距离，还能按“离我最近”排序</small>
    </div>
    <button type="button" class="btn btn-primary lb-btn" data-action="locate">立即定位</button>
  </div>` : ''}

  <div class="filter-label">难度</div>
  <div class="chips-row">
    ${DIFFS.map((d) => `<button type="button" class="chip ${exploreState.diff === d.key ? 'on' : ''}" data-action="f-diff" data-key="${d.key}" aria-pressed="${exploreState.diff === d.key}">${d.label}</button>`).join('')}
  </div>

  <div class="filter-label">地区</div>
  <div class="chips-row">
    ${REGIONS.map((r) => `<button type="button" class="chip ${exploreState.region === r ? 'on' : ''}" data-action="f-region" data-key="${r}" aria-pressed="${exploreState.region === r}">${r}</button>`).join('')}
  </div>

  <div class="filter-label" style="display:flex;justify-content:space-between;align-items:center">
    <span>排序</span>
    <select id="explore-sort" class="control" style="width:auto;padding:5px 10px;font-size:12.5px;border:1.5px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);outline:none">
      <option value="hot" ${exploreState.sort === 'hot' ? 'selected' : ''}>人气推荐</option>
      <option value="elev" ${exploreState.sort === 'elev' ? 'selected' : ''}>海拔最高</option>
      <option value="easy" ${exploreState.sort === 'easy' ? 'selected' : ''}>难度最低</option>
      <option value="near" ${exploreState.sort === 'near' ? 'selected' : ''}>离我最近 📍</option>
    </select>
  </div>

  ${exploreState.tag ? `<div class="result-count" style="display:flex;align-items:center;gap:6px">
    主题「${esc(exploreState.tag)}」筛选中
    <button type="button" class="chip" data-action="clear-tag" style="padding:2px 10px;font-size:11px">✕ 清除</button>
  </div>` : ''}

  <div class="result-count">共 ${list.length} 座山</div>
  ${list.length
    ? `<div class="m-grid">${list.map(mountainCard).join('')}</div>`
    : `<div class="card empty"><div class="empty-icon">🔍</div>没有找到符合条件的山<br>换个关键词试试</div>`}
  `;
}

/* ================= 视图：详情 ================= */
function viewMountain(m) {
  const s = computeStats();
  const climbed = s.ids.has(m.id);
  const times = state.records.filter((r) => r.mountainId === m.id).length;
  const d = distToMountain(m);
  return `
  <div class="detail-hero">
    <div class="scene-wrap">${mountainScene(m)}</div>
    <div class="overlay">
      <button class="back-btn" data-action="back" aria-label="返回">
        <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>
      </button>
      <div class="d-title">
        <h1>${m.emoji} ${esc(m.name)}</h1>
        <div class="d-sub">${esc(m.subtitle)} · ${esc(m.province)}</div>
        <div class="d-tags">${m.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
      </div>
    </div>
  </div>

  <div class="stat-strip">
    <div class="st"><b>${fmtNum(m.elevation)}m</b><span>海拔</span></div>
    <div class="st"><b>${DIFF_LABELS[m.difficulty]}</b><span>难度 ${m.difficulty}/5</span></div>
    <div class="st"><b>${m.duration.replace(/（.*?）/, '')}</b><span>参考耗时</span></div>
    <div class="st"><b>${m.distance}km</b><span>路线里程</span></div>
  </div>

  ${d !== null ? `
  <div class="dist-banner">
    <span>📍 这座山距你约 <b>${fmtDist(d)}</b>（直线距离）</span>
    <button type="button" class="chip" data-action="locate" style="padding:3px 11px;font-size:11.5px">重新定位</button>
  </div>` : `
  <div class="dist-banner dim">
    <span>📍 打开定位，查看这座山与你的距离</span>
    <button type="button" class="chip" data-action="locate" style="padding:3px 11px;font-size:11.5px">立即定位</button>
  </div>`}

  ${climbed ? `
  <div class="my-climb-banner">
    <span>🎉 你已登顶 ${times} 次，累计贡献海拔 ${fmtNum(m.elevation * times)} 米</span>
    <span class="badge">已打卡</span>
  </div>` : ''}

  <div class="d-section">
    <h3><span class="ico">📝</span>山峰介绍</h3>
    <p>${esc(m.description)}</p>
    <p class="kv" style="margin-top:10px"><b>最佳季节</b>${esc(m.bestSeason)}　<b>风景评分</b><span class="stars">${starRow(5)}</span> ${m.scenery.toFixed(1)}</p>
  </div>

  <div class="d-section">
    <h3><span class="ico">📈</span>海拔剖面（示意）</h3>
    <div class="profile-card">${elevationProfile(m)}</div>
  </div>

  <div class="d-section">
    <h3><span class="ico">🧗</span>登山贴士</h3>
    <ul class="tips-list">${m.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
  </div>

  <div style="height:70px"></div>
  <div class="detail-actions">
    <button class="btn btn-primary" data-action="checkin" data-id="${m.id}">✓ 登顶打卡</button>
    <button class="btn btn-ghost" data-action="back">返回列表</button>
  </div>
  `;
}

/* ================= 视图：记录 ================= */
function viewRecords() {
  const s = computeStats();
  const list = sortedRecords();
  return `
  <div class="summary-card">
    <div class="row">
      <div>
        <h2>我的登山手账</h2>
        <div class="sub">${esc(state.nickname)} · 每一步都算数</div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0">
        <button class="btn btn-ghost" data-action="import-gpx" title="导入两步路/绿野游踪等 App 导出的 GPX 轨迹">📥 GPX</button>
        <button class="btn btn-primary" data-action="checkin" style="padding:9px 16px">＋ 打卡</button>
      </div>
    </div>
    <div class="summary-grid">
      <div class="sg"><b>${s.count}</b><span>打卡次数</span></div>
      <div class="sg"><b>${s.distinct}</b><span>登顶山峰</span></div>
      <div class="sg"><b>${fmtNum(s.elev)}</b><span>累计海拔(米)</span></div>
    </div>
  </div>

  <div class="section-title">全部记录 <small>共 ${list.length} 条</small></div>
  ${list.length
    ? list.map((r) => feedItem(r, { deletable: true })).join('')
    : `<div class="card empty"><div class="empty-icon">📔</div>手账还是空的<br>去山顶写下第一页吧<div><a class="btn btn-primary" href="#/explore">去发现名山</a></div></div>`}
  `;
}

/* ================= 视图：我的 ================= */
function viewProfile() {
  const s = computeStats();
  const unlocked = new Set(unlockedIds());
  const days = Math.max(1, Math.ceil((Date.now() - (state.joinedAt || Date.now())) / 864e5));
  const firstClimb = new Map();
  for (const r of sortedRecords()) if (!firstClimb.has(r.mountainId)) firstClimb.set(r.mountainId, r.date);
  const climbedCount = firstClimb.size;
  return `
  <div class="me-card" role="button" tabindex="0" aria-label="编辑资料" data-action="edit-profile" title="编辑资料">
    <div class="avatar">${avatarHtml(state.avatar)}</div>
    <div class="me-info">
      <div class="nick">${esc(state.nickname)} <span class="edit-hint">✏️ 编辑资料</span></div>
      <div class="motto">${esc(state.motto)} · 已同行 ${days} 天</div>
    </div>
  </div>

  <div class="me-stats">
    <div class="ms"><b>${s.count}</b><span>打卡次数</span></div>
    <div class="ms"><b>${s.distinct}</b><span>登顶山峰</span></div>
    <div class="ms"><b>${fmtNum(s.elev)}m</b><span>累计海拔</span></div>
  </div>

  <div class="section-title">成就徽章 <small>${unlocked.size}/${ACHIEVEMENTS.length} 已解锁</small></div>
  <div class="ach-list">
    ${ACHIEVEMENTS.map((a) => `
    <div class="ach ${unlocked.has(a.id) ? 'on' : 'off'}">
      <div class="ach-ico">${a.icon}</div>
      <div>
        <div class="ach-name">${a.name}</div>
        <div class="ach-desc">${a.desc}</div>
      </div>
      <div class="ach-state">${unlocked.has(a.id) ? '已解锁' : '🔒'}</div>
    </div>`).join('')}
  </div>

  <div class="section-title">山峰护照 <small>${climbedCount}/${MOUNTAINS.length} 已集章</small></div>
  <div class="passport">
    ${MOUNTAINS.map((m) => {
      const date = firstClimb.get(m.id);
      return date
        ? `<div class="seal" role="button" tabindex="0" data-action="open-mountain" data-id="${m.id}" title="${esc(m.name)} · ${date}">
            <span class="seal-emoji">${m.emoji}</span><span class="seal-name">${esc(m.name)}</span><span class="seal-date">巅·${date.slice(5).replace('-', '.')}</span>
          </div>`
        : `<div class="seal seal-empty" role="button" tabindex="0" data-action="open-mountain" data-id="${m.id}" title="${esc(m.name)} · 待登顶">
            <span class="seal-emoji">${m.emoji}</span><span class="seal-name">${esc(m.name)}</span><span class="seal-date">待登顶</span>
          </div>`;
    }).join('')}
  </div>

  <div class="section-title">数据管理 <small>资料与记录永久保留在本机</small></div>
  <div class="data-zone">
    <button class="btn btn-ghost" data-action="export">⬇️ 导出备份</button>
    <button class="btn btn-ghost" data-action="import">⬆️ 导入恢复</button>
    <button class="btn btn-ghost" data-action="import-gpx">📥 导入 GPX 轨迹</button>
    <button class="btn btn-danger-ghost" data-action="clear">🗑️ 清空记录</button>
  </div>
  <div style="text-align:center;font-size:11.5px;color:var(--muted);margin-top:22px">爬山趣 v2.0 · 步步登峰 · 数据仅保存在本机</div>
  `;
}

/* ================= 路由 ================= */
const VIEWS = { home: viewHome, explore: viewExplore, records: viewRecords, profile: viewProfile, climb: viewClimb };

function route() {
  const hash = location.hash || '#/home';
  const page = $('#page');
  const tabbar = $('#tabbar');
  $$('.tab', tabbar).forEach((t) => t.classList.remove('on'));

  const mdetail = hash.match(/^#\/mountain\/([\w-]+)$/);
  if (mdetail && mountainById(mdetail[1])) {
    page.innerHTML = viewMountain(mountainById(mdetail[1]));
    tabbar.classList.add('hidden');
    const fab = $('#chat-fab');
    if (fab) fab.classList.add('hide');
    window.scrollTo(0, 0);
    return;
  }

  const fab = $('#chat-fab');
  if (fab) fab.classList.remove('hide');

  const name = (hash.replace('#/', '').split('/'))[0] || 'home';
  const view = VIEWS[name] || viewHome;
  page.innerHTML = view();
  tabbar.classList.remove('hidden');
  const tab = $(`.tab[data-tab="${name}"]`) || $(`.tab[data-tab="home"]`);
  tab.classList.add('on');
  if (name !== 'explore') window.scrollTo(0, 0);

  if (name === 'explore' && !state.lastPos) {
    maybeAutoLocate();
    locPermState().then((st) => {
      const banner = $('#loc-banner');
      if (!banner) return;
      banner.dataset.status = st;
      const sub = $('#loc-banner-sub');
      if (st === 'denied' && sub) {
        sub.textContent = '权限已被浏览器拒绝：点击地址栏左侧 ⚙️/🔒 图标，把“位置”设为允许后刷新页面';
      }
    });
  }
}

/* ================= 弹窗：打卡 ================= */
let modalRate = 5;

function openCheckinModal(mountainId = null) {
  const preselected = mountainId && mountainById(mountainId) ? mountainId : '';
  modalRate = 5;
  $('#modal-root').innerHTML = `
  <div class="modal-mask" data-action="close-modal-bg">
    <div class="modal-sheet" data-stop="1">
      <div class="m-head">
        <h3>🥾 登顶打卡</h3>
        <button class="m-close" data-action="close-modal">✕</button>
      </div>
      <div class="form-row">
        <label>打卡山峰</label>
        <select id="ck-mountain" class="control">
          <option value="" disabled ${preselected ? '' : 'selected'}>选择一座山…</option>
          ${MOUNTAINS.map((m) => `<option value="${m.id}" ${m.id === preselected ? 'selected' : ''}>${m.emoji} ${esc(m.name)} · ${fmtNum(m.elevation)}m</option>`).join('')}
        </select>
      </div>
      <div class="form-cols">
        <div class="form-row">
          <label>登山日期</label>
          <input id="ck-date" class="control" type="date" value="${todayStr()}">
        </div>
        <div class="form-row">
          <label>用时（小时，可选）</label>
          <input id="ck-duration" class="control" type="number" min="0" max="200" step="0.5" placeholder="如 5.5">
        </div>
      </div>
      <div class="form-row">
        <label>体验评分</label>
        <div class="star-picker" id="ck-stars">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-rate="${n}" class="${n <= modalRate ? 'on' : ''}">★</button>`).join('')}
        </div>
      </div>
      <div class="form-row">
        <label>登山心得（可选）</label>
        <textarea id="ck-notes" class="control" placeholder="山顶的风景、路上的故事…" maxlength="300"></textarea>
      </div>
      <button class="btn btn-primary btn-block" data-action="save-record">✓ 保存打卡</button>
    </div>
  </div>`;
}

function closeModal() {
  $('#modal-root').innerHTML = '';
}

/* ================= 弹窗：编辑资料 ================= */
const AVATARS = ['🧗', '⛰️', '🥾', '🎒', '🧭', '⛺', '🔥', '🌅', '🍁', '🐘', '🦌', '🦅'];
let editingAvatar = null;

function openProfileModal() {
  editingAvatar = state.avatar;
  $('#modal-root').innerHTML = `
  <div class="modal-mask" data-action="close-modal-bg">
    <div class="modal-sheet" data-stop="1">
      <div class="m-head">
        <h3>✏️ 编辑资料</h3>
        <button class="m-close" data-action="close-modal">✕</button>
      </div>
      <div class="form-row">
        <label>头像（支持自定义照片）</label>
        <div class="pf-ava-row">
          <div class="pf-preview" id="pf-preview">${avatarHtml(editingAvatar)}</div>
          <div class="pf-ava-btns">
            <button type="button" class="btn btn-ghost" data-action="pick-photo">📷 上传照片</button>
            <button type="button" class="btn btn-ghost" data-action="reset-ava">😀 用表情头像</button>
          </div>
        </div>
        <div class="ava-grid" id="pf-avatars">
          ${AVATARS.map((a) => `<button type="button" class="ava-opt ${a === editingAvatar ? 'on' : ''}" data-ava="${a}">${a}</button>`).join('')}
        </div>
      </div>
      <div class="form-row">
        <label>昵称</label>
        <input id="pf-nick" class="control" type="text" maxlength="16" value="${esc(state.nickname)}" placeholder="给自己起个登山昵称">
      </div>
      <div class="form-row">
        <label>个性签名</label>
        <input id="pf-motto" class="control" type="text" maxlength="30" value="${esc(state.motto)}" placeholder="一句话说说你和山的故事">
      </div>
      <button class="btn btn-primary btn-block" data-action="save-profile">✓ 保存资料</button>
    </div>
  </div>`;
}

function saveProfile() {
  const nick = ($('#pf-nick')?.value || '').trim();
  const motto = ($('#pf-motto')?.value || '').trim();
  if (!nick) { toast('昵称不能为空'); return; }
  state.nickname = nick.slice(0, 16);
  state.motto = motto.slice(0, 30) || defaultState().motto;
  if (editingAvatar && okAvatar(editingAvatar)) state.avatar = editingAvatar;
  saveState();
  closeModal();
  route();
  toast('资料已保存 ✅');
}

/* ================= 备份导入 ================= */
function applyImport(data) {
  if (!data || typeof data !== 'object') { toast('备份文件格式不正确'); return; }
  const recs = Array.isArray(data.records)
    ? data.records.filter((r) => r && typeof r.mountainId === 'string' && mountainById(r.mountainId) && typeof r.date === 'string')
    : [];
  if (!recs.length && typeof data.nickname !== 'string') { toast('备份文件里没有可导入的数据'); return; }
  if (!confirm(`将导入 ${recs.length} 条打卡记录并覆盖当前数据，确定吗？`)) return;
  const d = defaultState();
  state = {
    nickname: typeof data.nickname === 'string' && data.nickname.trim() ? data.nickname.trim().slice(0, 16) : d.nickname,
    avatar: okAvatar(data.avatar) ? data.avatar : d.avatar,
    motto: typeof data.motto === 'string' && data.motto.trim() ? data.motto.trim().slice(0, 30) : d.motto,
    joinedAt: Number.isFinite(data.joinedAt) ? data.joinedAt : d.joinedAt,
    lastPos: data.lastPos && Number.isFinite(data.lastPos.lat) && Number.isFinite(data.lastPos.lng) ? data.lastPos : null,
    tts: data.tts === true,
    climb: data.climb && typeof data.climb.cid === 'string' && Array.isArray(data.climb.log)
      ? { cid: data.climb.cid, startedAt: Number.isFinite(data.climb.startedAt) ? data.climb.startedAt : Date.now(), log: data.climb.log.filter((l) => l && Number.isFinite(+l.meters)) }
      : null,
    climbHistory: Array.isArray(data.climbHistory)
      ? data.climbHistory.filter((h) => h && typeof h.cid === 'string' && Number.isFinite(h.startedAt) && Number.isFinite(h.finishedAt))
      : [],
    records: recs.map((r, i) => ({
      id: typeof r.id === 'string' ? r.id : 'imp' + Date.now() + '-' + i,
      mountainId: r.mountainId,
      date: r.date,
      duration: Number.isFinite(+r.duration) && +r.duration > 0 ? +r.duration : null,
      rating: Math.min(5, Math.max(1, Math.round(+r.rating) || 5)),
      notes: typeof r.notes === 'string' ? r.notes.slice(0, 300) : '',
      createdAt: Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
    })),
  };
  saveState();
  route();
  toast(`导入成功，${state.records.length} 条记录已恢复 🎉`);
}

function notifyNewAchievements(before) {
  const after = unlockedIds().filter((id) => !before.has(id));
  after.forEach((id, i) => {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    setTimeout(() => toast(`🏅 解锁成就「${a.name}」`, true), 700 + i * 900);
  });
  return after.length;
}

function saveRecord() {
  const mId = $('#ck-mountain')?.value;
  const date = $('#ck-date')?.value;
  if (!mId) { toast('请先选择一座山 🏔️'); return; }
  if (!date) { toast('请选择登山日期 📅'); return; }
  const durVal = parseFloat($('#ck-duration')?.value);
  const m = mountainById(mId);

  const before = new Set(unlockedIds());
  state.records.push({
    id: 'r' + Date.now() + Math.floor(Math.random() * 1000),
    mountainId: mId,
    date,
    duration: Number.isFinite(durVal) && durVal > 0 ? durVal : null,
    rating: modalRate,
    notes: ($('#ck-notes')?.value || '').trim(),
    createdAt: Date.now(),
  });
  saveState();
  closeModal();
  confetti();
  toast(`打卡成功！登顶 ${m.name} ${m.emoji}`);
  notifyNewAchievements(before);

  const hash = location.hash || '#/home';
  if (hash.startsWith('#/mountain/')) route();
  else if (hash.startsWith('#/records') || hash.startsWith('#/home')) route();
}

/* ================= 山灵 · AI 登山搭子 ================= */
const QUICK_QUESTIONS = ['想看云海去哪？', '带爸妈休闲爬，求推荐', '我的攀登进度怎么样？', '想挑战 5000 米雪山', '离我近的有哪些？', '我打卡几次了？'];

const TAG_SEASON = { 红叶: [9, 10, 11], 草甸: [5, 6, 9, 10], 雪山: [5, 6, 9, 10], 云海: [3, 4, 5, 9, 10, 11], 星空: [6, 7, 8, 9] };

function parseIntent(t) {
  return {
    easy: /轻松|休闲|简单|新手|带娃|爸妈|父母|老人|亲子|遛弯|小白|入门/.test(t),
    hard: /挑战|硬核|雪山|大佬|高手|征服|进阶|难度高|5000|五千米/.test(t),
    near: /附近|周边|离我|最近|近一点|不远/.test(t),
    interests: ['日出', '云海', '红叶', '草甸', '露营', '星空', '佛教', '道教', '瀑布', '索道', '夜爬', '雪山', '温泉', '亲子'].filter((k) => t.includes(k)),
    region: REGIONS.find((r) => r !== '全部' && t.includes(r)),
    named: MOUNTAINS.find((m) => t.includes(m.name.replace('大峰', ''))),
  };
}

function recommendMountains(intent, n = 3) {
  const month = new Date().getMonth() + 1;
  const climbed = computeStats().ids;
  const scored = MOUNTAINS.map((m) => {
    let score = m.scenery * 2;
    const reasons = [];
    const d = distToMountain(m);
    if (intent.easy) {
      if (m.difficulty <= 2) { score += 7; reasons.push(`难度${DIFF_LABELS[m.difficulty]}，很适合休闲出行`); }
      else if (m.difficulty >= 4) score -= 7;
    }
    if (intent.hard) {
      if (m.difficulty >= 4) { score += 7; reasons.push(`难度${DIFF_LABELS[m.difficulty]}，够劲的挑战`); }
      else score -= 3;
      if (m.elevation >= 4000) { score += 3; reasons.push(`海拔 ${fmtNum(m.elevation)} 米，高海拔体验拉满`); }
    }
    const hitTags = intent.interests.filter((k) => m.tags.some((tag) => tag.includes(k) || k.includes(tag)));
    if (hitTags.length) {
      score += 5 * hitTags.length;
      reasons.push(`“${hitTags.join('、')}”正是它的招牌`);
      const ss = TAG_SEASON[hitTags[0]];
      if (ss && ss.includes(month)) { score += 3; reasons.push(`当前 ${month} 月正当季`); }
    }
    if (intent.near) {
      if (d !== null) {
        if (d < 200) { score += 8; reasons.push(`距你仅 ${fmtDist(d)}，说走就走`); }
        else if (d < 600) { score += 3; reasons.push(`距你 ${fmtDist(d)}`); }
        else score -= 4;
      } else {
        reasons.push('打开定位后我能按距离精准推荐');
      }
    } else if (d !== null && d < 200) {
      score += 2;
      reasons.push(`距你只有 ${fmtDist(d)}`);
    }
    if (intent.region && m.region === intent.region) { score += 4; reasons.push(`就在${intent.region}地区`); }
    if (climbed.has(m.id)) score -= 4;
    else reasons.push('你还没打卡过');
    if (!reasons.length) reasons.push(`风景评分 ${m.scenery.toFixed(1)}，经典之选`);
    return { m, score, d, reasons: reasons.slice(0, 3) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n);
}

function nextGoalHint() {
  const s = computeStats();
  if (s.distinct < 3) return `再登顶 ${3 - s.distinct} 座即可解锁「渐入佳境」`;
  if (s.distinct < 5) return `再登顶 ${5 - s.distinct} 座即可解锁「登山达人」`;
  const left = WUYUE_IDS.filter((id) => !s.ids.has(id));
  if (left.length) return `五岳还差：${left.map((id) => mountainById(id).name).join('、')}`;
  if (s.elev < 20000) return `累计登顶海拔还差 ${fmtNum(20000 - s.elev)} 米解锁「海拔收藏家」`;
  return '阶段性目标全部达成，向着大满贯进发！';
}

function chatGreeting() {
  const s = computeStats();
  const near = nearestMountain();
  let t = '你好呀，我是山灵 🏔️ 你的 AI 登山搭子。';
  t += s.count
    ? `你已登顶 ${s.distinct} 座山、累计爬升 ${fmtNum(s.elev)} 米，脚步不停！`
    : '手账还是空白的，随时问我“去哪爬”，我来帮你规划。';
  if (near) t += `现在离你最近的是${near.m.name}（约 ${fmtDist(near.d)}）。`;
  t += '\n可以问我风景、难度、距离——比如“想看云海去哪？”';
  return t;
}

function climbStatusText() {
  const hist = state.climbHistory || [];
  const info = climbInfo();
  let t = '';
  if (info) {
    t = `步步登峰 · ${info.ch.emoji} ${info.ch.name}：已爬升 ${fmtNum(info.climbed)}m / ${fmtNum(info.ch.elevation)}m（${Math.round(info.frac * 100)}%），当前位于「${info.pos ? info.pos.name : '山脚'}」`;
    if (info.next) t += `，下一站「${info.next.name}」还差 ${fmtNum(info.next.alt - info.climbed)}m`;
    if (info.eta) t += `。按日均 ${fmtNum(info.daily)}m 推算，预计 ${info.eta} 登顶`;
  } else if (hist.length) {
    const last = challengeById(hist[hist.length - 1]?.cid);
    t = `你已完成 ${hist.length} 次虚拟登顶${last ? `（最近：${last.name}）` : ''}，要不要开启下一座？珠峰 8848m 在等你 👑`;
  } else {
    t = '你还没开始虚拟攀登——去「步步登峰」选一座山，把每天爬的楼梯记进去，就能沿真实山径一路登顶！';
  }
  return t;
}

function chatReply(text) {
  const intent = parseIntent(text);
  if (/你好|您好|hi|hello|在吗/i.test(text)) return { text: chatGreeting() };
  if (/谢谢|感谢|辛苦/.test(text)) return { text: '不客气～愿你山高路远，脚步不停 ⛰️ 还想了解哪座山，随时问我。' };
  if (/攀登|步步|爬升|虚拟登顶/.test(text) && !intent.named) {
    return { text: climbStatusText() };
  }
  if (intent.named) {
    const m = intent.named;
    const d = distToMountain(m);
    const times = state.records.filter((r) => r.mountainId === m.id).length;
    return {
      text: `${m.emoji} ${m.name} · ${m.subtitle}\n海拔 ${fmtNum(m.elevation)} 米｜难度 ${DIFF_LABELS[m.difficulty]}（${m.difficulty}/5）｜建议 ${m.duration}${d !== null ? `｜距你约 ${fmtDist(d)}` : ''}${times ? `｜你已打卡 ${times} 次` : ''}\n\n${m.description}\n\n📅 最佳季节：${m.bestSeason}\n💡 ${m.tips[0]}`,
      cards: [m.id],
    };
  }
  if (/打卡|记录|几次|成就|进度|统计/.test(text)) {
    const s = computeStats();
    const un = unlockedIds().length;
    let t = `你目前打卡 ${s.count} 次，登顶 ${s.distinct} 座山，累计海拔 ${fmtNum(s.elev)} 米，成就解锁 ${un}/${ACHIEVEMENTS.length} 枚。\n\n🎯 下一步：${nextGoalHint()}`;
    if (state.climb || (state.climbHistory || []).length) t += `\n\n🧗 ${climbStatusText()}`;
    return { text: t };
  }
  const picks = recommendMountains(intent);
  const intro = intent.easy ? '轻松休闲的路线，我帮你挑了这几座：'
    : intent.hard ? '想来点硬核的？这几座够你喝一壶：'
    : intent.near ? '按离你的距离，这几座最方便：'
    : '根据你的口味，我推荐这几座：';
  const detail = picks.map((p, i) =>
    `${i + 1}. ${p.m.emoji} ${p.m.name}（${p.m.province}）\n${p.reasons.map((r) => `   · ${r}`).join('\n')}`
  ).join('\n');
  return {
    text: `${intro}\n\n${detail}\n\n点击卡片可看路线详情，也可以直接问我“XX山怎么爬”。`,
    cards: picks.map((p) => p.m.id),
  };
}

function agentBriefing() {
  const s = computeStats();
  const near = nearestMountain();
  const h = new Date().getHours();
  const greet = h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
  const bits = [];
  if (s.count) bits.push(`你已登顶 ${s.distinct} 座、累计 ${fmtNum(s.elev)} 米。${nextGoalHint()}`);
  else bits.push('手账还是空白的——不如这个周末就去登顶第一座山');
  if (near) bits.push(`离你最近的是${near.m.name}（约 ${fmtDist(near.d)}）`);
  if (state.climb) {
    const ci = climbInfo();
    if (ci) bits.push(`步步登峰已爬升 ${Math.round(ci.frac * 100)}%，当前在${ci.pos ? ci.pos.name : '山脚'}`);
  }
  const rec = recommendMountains(parseIntent(''), 1)[0];
  return { text: `${greet}，${state.nickname}！${bits.join('。')}。今日推荐 ↓`, rec };
}

/* ================= 山灵 · 聊天界面 ================= */
const chatCard = (id) => {
  const m = mountainById(id);
  if (!m) return '';
  const d = distToMountain(m);
  return `
  <div class="chat-card" role="button" tabindex="0" data-action="open-mountain" data-id="${m.id}">
    <span class="cc-emoji">${m.emoji}</span>
    <span class="cc-info"><b>${esc(m.name)}</b><small>${esc(m.province)} · ${fmtNum(m.elevation)}m · ${DIFF_LABELS[m.difficulty]}${d !== null ? ` · ${fmtDist(d)}` : ''}</small></span>
    <span class="cc-go" aria-hidden="true">›</span>
  </div>`;
};

function pushChatMsg(msg) {
  state.chats.push(msg);
  if (state.chats.length > 60) state.chats = state.chats.slice(-60);
  saveState();
}

const chatBubble = (m) => `
  <div class="msg ${m.role}">
    ${m.role === 'bot' ? '<div class="msg-ava">🏔️</div>' : ''}
    <div class="bubble">${esc(m.text).replace(/\n/g, '<br>')}${(m.cards || []).map(chatCard).join('')}</div>
  </div>`;

function scrollChat() {
  const body = $('#chat-body');
  if (body) body.scrollTop = body.scrollHeight;
}

function renderChatBody() {
  const body = $('#chat-body');
  if (!body) return;
  body.innerHTML = state.chats.map(chatBubble).join('');
  scrollChat();
}

let chatStreamTimer = null;

function streamLastMsg() {
  const body = $('#chat-body');
  if (!body || !state.chats.length) return;
  const last = state.chats[state.chats.length - 1];
  const nodes = $$('.msg', body);
  const el = nodes[nodes.length - 1];
  if (!el || last.role !== 'bot') return;
  const bubble = $('.bubble', el);
  const cards = (last.cards || []).map(chatCard).join('');
  const full = esc(last.text);
  let i = 0;
  clearInterval(chatStreamTimer);
  bubble.innerHTML = '';
  chatStreamTimer = setInterval(() => {
    i = Math.min(full.length, i + 2);
    bubble.innerHTML = full.slice(0, i).replace(/\n/g, '<br>') + (i < full.length ? '<span class="caret"></span>' : cards);
    scrollChat();
    if (i >= full.length) {
      clearInterval(chatStreamTimer);
      speakText(last.text);
    }
  }, 16);
}

function openChat() {
  if (!state.chats.length) {
    pushChatMsg({ role: 'bot', text: chatGreeting(), at: Date.now() });
  }
  $('#chat-root').innerHTML = `
  <div class="chat-overlay" role="dialog" aria-label="山灵对话">
    <div class="chat-head">
      <div class="ch-ava" aria-hidden="true">🏔️</div>
      <div class="ch-info"><b>山灵</b><small>AI 登山搭子 · 在线</small></div>
      <button class="ch-tts ${state.tts ? 'on' : ''}" data-action="toggle-tts" title="${state.tts ? '关闭语音播报' : '开启语音播报山灵回复'}">${state.tts ? '🔊' : '🔇'}</button>
      <button class="m-close" data-action="close-chat" aria-label="关闭对话">✕</button>
    </div>
    <div class="chat-body" id="chat-body"></div>
    <div class="chat-quick">
      ${QUICK_QUESTIONS.map((q) => `<button type="button" class="chip" data-action="chat-quick" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
    </div>
    <div class="chat-input-bar">
      <button type="button" class="mic-btn" id="chat-mic" data-action="voice" aria-label="语音输入" title="按一下开始说话，说完自动发送">🎤</button>
      <input id="chat-input" type="text" placeholder="问问山灵：想看云海去哪？" maxlength="120">
      <button type="button" class="btn btn-primary" data-action="chat-send">发送</button>
    </div>
  </div>`;
  renderChatBody();
}

function closeChat() {
  clearInterval(chatStreamTimer);
  $('#chat-root').innerHTML = '';
}

function sendChat(text) {
  text = (text || '').trim();
  if (!text) return;
  const input = $('#chat-input');
  if (input) input.value = '';
  clearInterval(chatStreamTimer);
  pushChatMsg({ role: 'user', text, at: Date.now() });
  renderChatBody();
  const body = $('#chat-body');
  const typing = document.createElement('div');
  typing.className = 'msg bot typing';
  typing.innerHTML = '<div class="msg-ava">🏔️</div><div class="bubble"><i></i><i></i><i></i></div>';
  body.appendChild(typing);
  scrollChat();
  setTimeout(() => {
    typing.remove();
    const reply = chatReply(text);
    pushChatMsg({ role: 'bot', text: reply.text, cards: reply.cards || [], at: Date.now() });
    renderChatBody();
    streamLastMsg();
  }, 600 + Math.random() * 500);
}

/* ================= GPX 真实轨迹导入 ================= */
/* 把轨迹列表识别为打卡候选：先按名称匹配，再按起终点与山顶的距离（25km 内）匹配 */
function gpxCandidates(tracks) {
  return tracks.map((tr) => {
    const pts = (tr.points || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (!pts.length) return null;
    let m = null;
    let byName = false;
    const hay = tr.name || '';
    m = MOUNTAINS.find((mm) => hay.includes(mm.name.replace('大峰', '')));
    if (m) {
      byName = true;
    } else {
      let bestD = Infinity, bestM = null;
      for (const mm of MOUNTAINS) {
        const c = COORDS[mm.id];
        if (!c) continue;
        const d = Math.min(
          haversine(pts[0].lat, pts[0].lng, c[0], c[1]),
          haversine(pts[pts.length - 1].lat, pts[pts.length - 1].lng, c[0], c[1])
        );
        if (d < bestD) { bestD = d; bestM = mm; }
      }
      if (bestM && bestD <= 25) m = bestM;
    }
    const times = pts.map((p) => p.time).filter(Boolean).sort();
    const start = times.length ? new Date(times[0]) : null;
    const end = times.length ? new Date(times[times.length - 1]) : null;
    let durationH = null;
    if (start && end && end > start) durationH = Math.round(((end - start) / 36e5) * 2) / 2;
    let distKm = null;
    if (pts.length > 1) {
      let s = 0;
      for (let i = 1; i < pts.length; i++) s += haversine(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
      distKm = Math.round(s);
    }
    const date = start && !Number.isNaN(start.getTime())
      ? `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
      : todayStr();
    return m
      ? { m, byName, date, durationH, distKm, trackName: tr.name || '未命名轨迹' }
      : { unmatched: true, trackName: tr.name || '未命名轨迹' };
  }).filter(Boolean);
}

function parseGpxText(text) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(text, 'application/xml');
  } catch {
    return [];
  }
  if (!doc || doc.getElementsByTagName('parsererror').length) return [];
  const tracks = [];
  for (const trk of Array.from(doc.getElementsByTagName('trk'))) {
    const name = (trk.getElementsByTagName('name')[0]?.textContent || '').trim();
    const points = Array.from(trk.getElementsByTagName('trkpt')).map((p) => ({
      lat: parseFloat(p.getAttribute('lat')),
      lng: parseFloat(p.getAttribute('lon')),
      time: p.getElementsByTagName('time')[0]?.textContent || '',
    }));
    if (points.length) tracks.push({ name, points });
  }
  if (!tracks.length) {
    const wpts = Array.from(doc.getElementsByTagName('wpt'));
    if (wpts.length) {
      const name = wpts.map((w) => w.getElementsByTagName('name')[0]?.textContent || '').join(' ').trim();
      const points = wpts.map((w) => ({
        lat: parseFloat(w.getAttribute('lat')),
        lng: parseFloat(w.getAttribute('lon')),
        time: w.getElementsByTagName('time')[0]?.textContent || '',
      }));
      tracks.push({ name, points });
    }
  }
  return gpxCandidates(tracks);
}

let gpxPending = [];
let gpxFileName = '';

function openGpxModal(cands, fileName) {
  gpxPending = cands;
  gpxFileName = fileName || '轨迹文件';
  const matched = cands.filter((c) => !c.unmatched);
  $('#modal-root').innerHTML = `
  <div class="modal-mask" data-action="close-modal-bg">
    <div class="modal-sheet" data-stop="1">
      <div class="m-head">
        <h3>📥 导入真实轨迹</h3>
        <button class="m-close" data-action="close-modal">✕</button>
      </div>
      <p class="gpx-file-info">📄 ${esc(gpxFileName)} · 识别到 ${matched.length} 条可导入轨迹${cands.length - matched.length ? ` · ${cands.length - matched.length} 条未匹配山峰（跳过）` : ''}</p>
      <div id="gpx-list">
        ${cands.map((c, i) => {
          if (c.unmatched) {
            return `<div class="gpx-item off"><div><b>未识别</b><small>来源：${esc(c.trackName)} · 没有匹配到 15 座名山，已跳过</small></div></div>`;
          }
          const dup = state.records.some((r) => r.mountainId === c.m.id && r.date === c.date);
          return `
          <label class="gpx-item">
            <input type="checkbox" ${dup ? '' : 'checked'} data-idx="${i}">
            <div>
              <b>${c.m.emoji} ${esc(c.m.name)}</b>
              <span class="badge">${c.byName ? '名称匹配' : '位置匹配'}</span>
              ${dup ? '<span class="badge" style="background:#fdeecb;color:#a06b00">疑与已有记录重复</span>' : ''}
              <small>${esc(c.date)}${c.durationH ? ` · 用时约 ${c.durationH} 小时` : ''}${c.distKm !== null ? ` · 轨迹 ${c.distKm}km` : ''} · 来源：${esc(c.trackName)}</small>
            </div>
          </label>`;
        }).join('')}
      </div>
      ${matched.length
        ? `<button class="btn btn-primary btn-block" data-action="gpx-confirm" style="margin-top:6px">✓ 导入选中轨迹</button>`
        : `<p class="gpx-file-info">💡 提示：轨迹名称含山名（如“泰山夜爬”）或起终点距山顶 25km 内即可自动识别。</p>`}
    </div>
  </div>`;
}

function confirmGpxImport() {
  const boxes = $$('#gpx-list input[type="checkbox"]:checked');
  if (!boxes.length) { toast('请至少选择一条轨迹'); return; }
  const before = new Set(unlockedIds());
  let n = 0;
  boxes.forEach((b) => {
    const c = gpxPending[+b.dataset.idx];
    if (!c || c.unmatched) return;
    state.records.push({
      id: 'g' + Date.now() + '-' + n,
      mountainId: c.m.id,
      date: c.date,
      duration: c.durationH,
      rating: 5,
      notes: `GPX 轨迹导入：${c.trackName}`,
      createdAt: Date.now(),
    });
    n++;
  });
  saveState();
  closeModal();
  route();
  if (n) confetti();
  toast(`成功导入 ${n} 条真实登山记录 🎉`);
  notifyNewAchievements(before);
}

/* ================= 步步登峰 · 虚拟攀登 ================= */
const climbSum = (log) => (log || []).reduce((a, b) => a + (+b.meters || 0), 0);

function climbInfo() {
  const c = state.climb;
  if (!c) return null;
  const ch = challengeById(c.cid);
  if (!ch) return null;
  const climbed = climbSum(c.log);
  const frac = Math.min(1, climbed / ch.elevation);
  let pos = null, next = null;
  for (let i = 0; i < ch.waypoints.length; i++) {
    if (ch.waypoints[i].alt <= climbed) pos = ch.waypoints[i];
    else { next = ch.waypoints[i]; break; }
  }
  const days = Math.max(1, Math.ceil((Date.now() - c.startedAt) / 864e5));
  const daily = Math.round(climbed / days);
  const remaining = Math.max(0, ch.elevation - climbed);
  let eta = null;
  if (daily > 0 && remaining > 0) {
    const d = new Date(Date.now() + Math.ceil(remaining / daily) * 864e5);
    eta = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  }
  return { ch, climbed, frac, pos, next, daily, remaining, eta, days, log: c.log, startedAt: c.startedAt };
}

/* 山径剖面：横轴按地标等距，纵轴按海拔；已爬路段高亮 */
function climbProfileSvg(info) {
  const { ch, frac, pos } = info;
  const W = 340, H = 138, padX = 10, padT = 22, padB = 30;
  const n = ch.waypoints.length;
  const px = (i) => padX + (i / (n - 1)) * (W - 2 * padX);
  const py = (alt) => H - padB - (alt / ch.elevation) * (H - padT - padB);
  const pts = ch.waypoints.map((w, i) => [px(i), py(w.alt)]);
  // 当前位置（在两段之间按海拔线性插值）
  let seg = 0, t = 0;
  for (let i = 0; i < n - 1; i++) {
    const a = ch.waypoints[i].alt / ch.elevation, b = ch.waypoints[i + 1].alt / ch.elevation;
    if (frac <= b) { seg = i; t = b === a ? 1 : Math.max(0, (frac - a) / (b - a)); break; }
    if (i === n - 2) { seg = i; t = 1; }
  }
  const cur = [px(seg) + t * (px(seg + 1) - px(seg)), py(frac * ch.elevation)];
  const donePts = pts.slice(0, seg + 1).concat([cur]);
  const doneLine = donePts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const fullLine = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaD = `M${px(0)},${H - padB} L${doneLine} L${cur[0].toFixed(1)},${H - padB} Z`;
  const gid = `cg-${ch.id}-${uid()}`;
  const labels = ch.waypoints.map((w, i) => {
    const up = i % 2 === 0;
    return `
    <line x1="${px(i)}" y1="${py(w.alt)}" x2="${px(i)}" y2="${H - padB}" stroke="#d9e5dc" stroke-width="1" stroke-dasharray="2 3"/>
    <circle cx="${px(i)}" cy="${py(w.alt)}" r="3" fill="${i <= seg ? ch.colors[3] : '#c6d4ca'}"/>
    <text x="${px(i)}" y="${up ? H - 19 : H - 6}" font-size="8.5" fill="${i <= seg ? ch.colors[3] : '#93a89b'}" text-anchor="middle" font-weight="${i <= seg ? 700 : 400}">${w.name}</text>`;
  }).join('');
  return `
  <svg viewBox="0 0 ${W} ${H}" class="climb-svg" aria-label="攀登进度剖面">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${ch.colors[2]}" stop-opacity=".45"/>
        <stop offset="1" stop-color="${ch.colors[2]}" stop-opacity=".06"/>
      </linearGradient>
    </defs>
    <polyline points="${fullLine}" fill="none" stroke="#d5e1d8" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${areaD}" fill="url(#${gid})"/>
    <polyline points="${doneLine}" fill="none" stroke="${ch.colors[3]}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    ${labels}
    <line x1="${cur[0]}" y1="${cur[1]}" x2="${cur[0]}" y2="${H - padB}" stroke="${ch.colors[3]}" stroke-width="1.2" opacity=".5"/>
    <text x="${Math.min(W - 12, Math.max(12, cur[0]))}" y="${Math.max(12, cur[1] - 8)}" font-size="13" text-anchor="middle">🧗</text>
    <text x="2" y="12" font-size="9" fill="#8ba397">累计爬升 ${fmtNum(info.climbed)} m</text>
    <text x="${W - 2}" y="12" font-size="9" fill="#8ba397" text-anchor="end">${Math.round(info.frac * 100)}%</text>
  </svg>`;
}

function startChallenge(cid) {
  const ch = challengeById(cid);
  if (!ch) return;
  if (state.climb && climbSum(state.climb.log) > 0) {
    const cur = challengeById(state.climb.cid);
    if (!confirm(`正在攀登${cur ? cur.name : ''}，切换挑战将放弃当前进度，确定吗？`)) return;
  }
  state.climb = { cid, startedAt: Date.now(), log: [] };
  saveState();
  route();
  toast(`开始了「${ch.name}」的虚拟攀登 ${ch.emoji} 每天记录爬升，向 ${fmtNum(ch.elevation)}m 进发！`);
}

function addClimbLog(meters, date) {
  meters = Math.round(+meters || 0);
  if (meters <= 0) { toast('请输入有效的爬升量（层数或米数二选一）'); return; }
  if (!state.climb) { toast('先在上方选择一座山开始挑战'); return; }
  const c = state.climb;
  const ch = challengeById(c.cid);
  const before = new Set(unlockedIds());
  const old = climbSum(c.log);
  c.log.push({ id: 'l' + Date.now(), date: date || todayStr(), meters });
  const now = old + meters;
  if (now >= ch.elevation && old < ch.elevation) {
    state.climbHistory.push({ cid: c.cid, startedAt: c.startedAt, finishedAt: Date.now(), meters: now });
    state.climb = null;
    saveState();
    confetti();
    toast(`🎉 恭喜！你用日常爬升登顶了${ch.name} ${ch.emoji}`);
    notifyNewAchievements(before);
    route();
    return;
  }
  saveState();
  route();
  const crossed = ch.waypoints.filter((w) => w.alt > old && w.alt <= now && w.alt < ch.elevation);
  crossed.forEach((w, i) => setTimeout(() => toast(`📍 已抵达「${w.name}」· 海拔 ${fmtNum(w.alt)}m`), 300 + i * 700));
  notifyNewAchievements(before);
}

/* 登顶证书 */
function certSvg(h) {
  const ch = challengeById(h.cid);
  const days = Math.max(1, Math.ceil((h.finishedAt - h.startedAt) / 864e5));
  const d = new Date(h.finishedAt);
  const dateStr = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="750" height="1000" viewBox="0 0 750 1000">
  <rect width="750" height="1000" fill="#fbf7ee"/>
  <rect x="28" y="28" width="694" height="944" fill="none" stroke="#1b4332" stroke-width="3"/>
  <rect x="40" y="40" width="670" height="920" fill="none" stroke="#b8860b" stroke-width="1.5"/>
  <text x="375" y="150" text-anchor="middle" font-size="72" font-weight="900" fill="#1b4332" font-family="KaiTi, STKaiti, 'Noto Serif SC', serif" letter-spacing="18">登顶证书</text>
  <text x="375" y="196" text-anchor="middle" font-size="20" fill="#8ba397" letter-spacing="6">CLIMBING CERTIFICATE · 步步登峰</text>
  <line x1="180" y1="222" x2="570" y2="222" stroke="#b8860b" stroke-width="1"/>
  <text x="375" y="300" text-anchor="middle" font-size="26" fill="#44554c">兹证明</text>
  <text x="375" y="368" text-anchor="middle" font-size="48" font-weight="800" fill="#123527">${esc(state.nickname)}</text>
  <text x="375" y="428" text-anchor="middle" font-size="24" fill="#44554c">以日常累计爬升 ${fmtNum(h.meters)} 米</text>
  <text x="375" y="470" text-anchor="middle" font-size="24" fill="#44554c">成功虚拟登顶</text>
  <text x="375" y="545" text-anchor="middle" font-size="52" font-weight="900" fill="${ch.colors[3]}" font-family="KaiTi, STKaiti, serif">${ch.emoji} ${ch.name}</text>
  <text x="375" y="595" text-anchor="middle" font-size="24" fill="#8ba397">海拔 ${fmtNum(ch.elevation)} 米</text>
  <line x1="180" y1="640" x2="570" y2="640" stroke="#d9cfb8" stroke-width="1"/>
  <text x="255" y="690" text-anchor="middle" font-size="20" fill="#44554c">用时 ${days} 天</text>
  <text x="375" y="690" text-anchor="middle" font-size="20" fill="#44554c">日均 ${fmtNum(Math.round(h.meters / days))} 米</text>
  <text x="495" y="690" text-anchor="middle" font-size="20" fill="#44554c">${dateStr}</text>
  <g transform="translate(600,780)">
    <circle r="62" fill="none" stroke="#c0392b" stroke-width="4"/>
    <circle r="52" fill="none" stroke="#c0392b" stroke-width="1.5"/>
    <text y="-12" text-anchor="middle" font-size="26" fill="#c0392b" font-weight="900" font-family="KaiTi, STKaiti, serif">登顶</text>
    <text y="24" text-anchor="middle" font-size="17" fill="#c0392b" font-weight="700" font-family="KaiTi, STKaiti, serif">${esc(ch.name)}</text>
  </g>
  <text x="150" y="850" font-size="15" fill="#8ba397">爬山趣 · 山灵认证</text>
  <text x="150" y="878" font-size="15" fill="#8ba397">凭日常脚步，抵山川之巅</text>
</svg>`;
}

function downloadCert(h) {
  const svgStr = certSvg(h);
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  const ch = challengeById(h.cid);
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 750;
    canvas.height = 1000;
    canvas.getContext('2d').drawImage(img, 0, 0, 750, 1000);
    URL.revokeObjectURL(url);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `登顶证书-${ch.name}.png`;
    a.click();
    toast('证书已保存到下载 📜');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('证书生成失败，请重试'); };
  img.src = url;
}

function openCertModal(h) {
  const ch = challengeById(h.cid);
  $('#modal-root').innerHTML = `
  <div class="modal-mask" data-action="close-modal-bg">
    <div class="modal-sheet" data-stop="1">
      <div class="m-head">
        <h3>📜 ${ch.emoji} ${ch.name} 登顶证书</h3>
        <button class="m-close" data-action="close-modal">✕</button>
      </div>
      <div class="cert-wrap">${certSvg(h)}</div>
      <button class="btn btn-primary btn-block" data-action="cert-download" style="margin-top:12px">⬇️ 下载证书图片</button>
    </div>
  </div>`;
}

/* ================= 视图：步步登峰 ================= */
function viewClimb() {
  const info = climbInfo();
  const hist = [...(state.climbHistory || [])].reverse();
  const last = hist[0];
  return `
  <div class="climb-head">
    <h2>🧗 步步登峰</h2>
    <p>把每天爬的楼梯，变成登顶名山的旅程</p>
  </div>

  <div class="chips-row" style="margin-bottom:14px">
    ${CHALLENGES.map((c) => {
      const done = (state.climbHistory || []).some((h) => h.cid === c.id);
      const active = state.climb?.cid === c.id;
      return `<button type="button" class="chip ${active ? 'on' : ''}" data-action="start-challenge" data-id="${c.id}">${done ? '✅' : c.emoji} ${c.name} ${fmtNum(c.elevation)}m</button>`;
    }).join('')}
  </div>

  ${info ? (() => {
    const { ch } = info;
    return `
    <div class="card climb-card">
      <div class="climb-title">
        <div><b>${ch.emoji} ${ch.name}</b><small>${esc(ch.desc)}</small></div>
        <span class="climb-pct">${Math.round(info.frac * 100)}%</span>
      </div>
      ${climbProfileSvg(info)}
      <div class="climb-now">
        📍 当前位置：<b>${info.pos ? info.pos.name : '山脚'}</b>
        ${info.next ? ` · 下一站「${info.next.name}」还差 <b>${fmtNum(info.next.alt - info.climbed)}m</b>` : ''}
      </div>
      <div class="climb-stats">
        <div><b>${fmtNum(info.climbed)}m</b><span>已爬升</span></div>
        <div><b>${fmtNum(info.remaining)}m</b><span>距登顶</span></div>
        <div><b>${fmtNum(info.daily)}m</b><span>日均</span></div>
        <div><b>${info.eta ? info.eta : '—'}</b><span>预计登顶</span></div>
      </div>
    </div>

    <div class="card climb-log-card">
      <div class="form-row" style="margin:0">
        <label>记录今日爬升（手机健康 App 的“爬楼”数据即可）</label>
        <div class="form-cols">
          <div class="form-row" style="margin:0">
            <input id="cl-floors" class="control" type="number" min="0" step="1" placeholder="爬楼层数">
          </div>
          <div class="form-row" style="margin:0">
            <input id="cl-meters" class="control" type="number" min="0" step="1" placeholder="或直接填米数">
          </div>
        </div>
        <p class="climb-hint">1 层 ≈ 3 米 · 两栏填一个就行</p>
        <button class="btn btn-primary btn-block" data-action="climb-log">＋ 记录爬升</button>
      </div>
      ${info.log.length ? `
      <div class="section-title" style="margin:14px 0 8px">爬升日志 <small>共 ${info.log.length} 条</small></div>
      ${[...info.log].reverse().slice(0, 10).map((l) => `
        <div class="climb-log-item">
          <span>${esc(l.date)}</span>
          <b>+${l.meters}m</b>
          <button class="del" data-action="del-climb-log" data-id="${l.id}" aria-label="删除">✕</button>
        </div>`).join('')}` : ''}
    </div>`;
  })() : `
    <div class="card climb-card">
      <div class="empty" style="padding:30px 20px">
        <div class="empty-icon">🧗</div>
        还没有进行中的挑战<br>选一座山，从今天的楼梯开始
      </div>
    </div>`}

  ${last ? `
  <div class="climb-done card">
    <div class="cd-left">${challengeById(last.cid)?.emoji || '🏔️'}</div>
    <div class="cd-mid">
      <b>已登顶 ${challengeById(last.cid)?.name || ''}</b>
      <small>${new Date(last.finishedAt).toLocaleDateString('zh-CN')} · 累计 ${fmtNum(last.meters)}m</small>
    </div>
    <button class="btn btn-ghost" data-action="show-cert">📜 证书</button>
  </div>` : ''}

  ${(state.climbHistory || []).length > 1 ? `
  <div class="section-title">攀登履历 <small>${state.climbHistory.length} 座</small></div>
  <div class="chips-row">
    ${(state.climbHistory || []).map((h) => {
      const c = challengeById(h.cid);
      return c ? `<span class="chip">✅ ${c.emoji} ${c.name}</span>` : '';
    }).join('')}
  </div>` : ''}
  `;
}
let voiceRecog = null;
const getSR = () => window.SpeechRecognition || window.webkitSpeechRecognition;

function toggleVoice() {
  const SR = getSR();
  if (!SR) { toast('当前浏览器不支持语音输入，试试 Chrome / Edge 🎤'); return; }
  const mic = $('#chat-mic');
  if (voiceRecog) { voiceRecog.stop(); return; }
  voiceRecog = new SR();
  voiceRecog.lang = 'zh-CN';
  voiceRecog.interimResults = true;
  voiceRecog.maxAlternatives = 1;
  voiceRecog.onresult = (e) => {
    let text = '';
    for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
    const input = $('#chat-input');
    if (input) input.value = text;
    if (e.results[e.results.length - 1].isFinal) {
      setTimeout(() => sendChat(text), 250);
    }
  };
  voiceRecog.onend = () => { voiceRecog = null; if (mic) mic.classList.remove('listening'); };
  voiceRecog.onerror = (e) => {
    toast(e.error === 'not-allowed' ? '麦克风权限被拒绝，请在浏览器中允许后重试' : '没听清，请再试一次 🎤');
  };
  voiceRecog.start();
  if (mic) mic.classList.add('listening');
  toast('🎤 正在聆听…说完自动发送');
}

function speakText(text) {
  if (!state.tts || !window.speechSynthesis) return;
  const plain = String(text).replace(/[^\u4e00-\u9fa5a-zA-Z0-9，。！？、：；,.!?:%\-—…·（）()\s]/g, ' ').slice(0, 400).trim();
  if (!plain) return;
  const u = new SpeechSynthesisUtterance(plain);
  u.lang = 'zh-CN';
  u.rate = 1.05;
  const zh = window.speechSynthesis.getVoices().find((v) => v.lang && v.lang.startsWith('zh'));
  if (zh) u.voice = zh;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}
function confetti() {
  const root = $('#confetti-root');
  if (!root) return;
  const colors = ['#52b788', '#f5a623', '#d64545', '#4ea8de', '#ffd9a3'];
  for (let i = 0; i < 30; i++) {
    const p = document.createElement('i');
    p.style.left = (Math.random() * 100).toFixed(1) + '%';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = (Math.random() * 0.35).toFixed(2) + 's';
    p.style.animationDuration = (1.5 + Math.random() * 1).toFixed(2) + 's';
    root.appendChild(p);
  }
  setTimeout(() => { root.innerHTML = ''; }, 3000);
}
function toast(msg, gold = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (gold ? ' gold' : '');
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 350);
  }, gold ? 2600 : 2200);
}

/* ================= 事件 ================= */
function handleAction(t) {
  const { action } = t.dataset;
  switch (action) {
    case 'open-mountain':
      closeChat();
      location.hash = `#/mountain/${t.dataset.id}`;
      break;
    case 'open-chat':
      openChat();
      break;
    case 'close-chat':
      closeChat();
      break;
    case 'chat-send':
      sendChat($('#chat-input')?.value);
      break;
    case 'chat-quick':
      sendChat(t.dataset.q || '');
      break;
    case 'voice':
      toggleVoice();
      break;
    case 'toggle-tts': {
      state.tts = !state.tts;
      saveState();
      const btn = $('.ch-tts');
      if (btn) {
        btn.textContent = state.tts ? '🔊' : '🔇';
        btn.classList.toggle('on', state.tts);
      }
      if (!state.tts && window.speechSynthesis) window.speechSynthesis.cancel();
      toast(state.tts ? '已开启语音播报，山灵会把回复读给你 🔊' : '已关闭语音播报 🔇');
      break;
    }
    case 'import-gpx': {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.gpx,application/gpx+xml,text/xml';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const cands = parseGpxText(String(reader.result || ''));
          if (!cands.length) { toast('没有解析出轨迹，请确认是 GPX 文件'); return; }
          openGpxModal(cands, file.name);
        };
        reader.readAsText(file, 'utf-8');
      };
      input.click();
      break;
    }
    case 'gpx-confirm':
      confirmGpxImport();
      break;
    case 'goto-climb':
      location.hash = '#/climb';
      break;
    case 'start-challenge':
      startChallenge(t.dataset.id);
      break;
    case 'climb-log': {
      const floors = parseFloat($('#cl-floors')?.value);
      const meters = parseFloat($('#cl-meters')?.value);
      const date = todayStr();
      if (Number.isFinite(meters) && meters > 0) addClimbLog(meters, date);
      else if (Number.isFinite(floors) && floors > 0) addClimbLog(floors * 3, date);
      else toast('请填写爬楼层数或米数');
      break;
    }
    case 'del-climb-log':
      if (state.climb) {
        state.climb.log = state.climb.log.filter((l) => l.id !== t.dataset.id);
        saveState();
        route();
        toast('已删除该条爬升记录');
      }
      break;
    case 'show-cert': {
      const last = [...(state.climbHistory || [])].reverse()[0];
      if (last) openCertModal(last);
      break;
    }
    case 'cert-download': {
      const last = [...(state.climbHistory || [])].reverse()[0];
      if (last) downloadCert(last);
      break;
    }
    case 'back':
      history.length > 1 ? history.back() : (location.hash = '#/explore');
      break;
    case 'theme': {
      exploreState.tag = t.dataset.tag;
      exploreState.q = ''; exploreState.region = '全部'; exploreState.diff = '全部';
      location.hash = '#/explore';
      if ((location.hash || '') === '#/explore') route();
      break;
    }
    case 'clear-tag':
      exploreState.tag = '';
      route();
      break;
    case 'f-diff':
      exploreState.diff = t.dataset.key;
      route();
      break;
    case 'f-region':
      exploreState.region = t.dataset.key;
      route();
      break;
    case 'checkin':
      openCheckinModal(t.dataset.id || null);
      break;
    case 'close-modal':
      closeModal();
      break;
    case 'save-record':
      saveRecord();
      break;
    case 'locate':
      requestLocation();
      break;
    case 'edit-profile':
      openProfileModal();
      break;
    case 'save-profile':
      saveProfile();
      break;
    case 'pick-photo': {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { toast('请选择图片文件 📷'); return; }
        if (file.size > 8 * 1024 * 1024) { toast('图片太大，请选择 8MB 以内的图片'); return; }
        fileToAvatarDataUrl(file, (url) => {
          if (!url) { toast('图片读取失败，请换一张试试'); return; }
          editingAvatar = url;
          const pv = $('#pf-preview');
          if (pv) pv.innerHTML = avatarHtml(url);
          $$('#pf-avatars .ava-opt').forEach((b) => b.classList.remove('on'));
          toast('照片已就绪，点击“保存资料”生效 ✅');
        });
      };
      input.click();
      break;
    }
    case 'reset-ava':
      editingAvatar = '🧗';
      { const pv = $('#pf-preview'); if (pv) pv.innerHTML = avatarHtml(editingAvatar); }
      $$('#pf-avatars .ava-opt').forEach((b) => b.classList.toggle('on', b.dataset.ava === editingAvatar));
      break;
    case 'del-record':
      if (confirm('确定删除这条打卡记录吗？')) {
        state.records = state.records.filter((r) => r.id !== t.dataset.id);
        saveState();
        route();
        toast('记录已删除');
      }
      break;
    case 'export': {
      const blob = new Blob([JSON.stringify({ app: '爬山趣', exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `爬山趣备份-${todayStr()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('备份已导出 ⬇️');
      break;
    }
    case 'import': {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            applyImport(JSON.parse(reader.result));
          } catch {
            toast('备份文件格式不正确');
          }
        };
        reader.readAsText(file, 'utf-8');
      };
      input.click();
      break;
    }
    case 'clear':
      if (confirm('确定清空所有打卡与攀登记录吗？（个人资料会保留）')) {
        state.records = [];
        state.lastPos = null;
        state.climb = null;
        state.climbHistory = [];
        saveState();
        route();
        toast('记录已清空，资料已保留');
      }
      break;
  }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  if (e.target.closest('[data-stop]') && t.dataset.action === 'close-modal-bg') return;
  handleAction(t);
});

/* role=button 卡片的键盘操作（Enter / 空格） */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'chat-input') {
    e.preventDefault();
    sendChat(e.target.value);
    return;
  }
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target.closest?.('[data-action][role="button"]');
  if (!t) return;
  e.preventDefault();
  handleAction(t);
});

/* 弹窗内星级评分 */
document.addEventListener('click', (e) => {
  const b = e.target.closest('#ck-stars [data-rate]');
  if (!b) return;
  modalRate = parseInt(b.dataset.rate, 10);
  $$('#ck-stars button').forEach((btn) => btn.classList.toggle('on', parseInt(btn.dataset.rate, 10) <= modalRate));
});

/* 资料弹窗头像选择 */
document.addEventListener('click', (e) => {
  const b = e.target.closest('#pf-avatars [data-ava]');
  if (!b) return;
  editingAvatar = b.dataset.ava;
  $$('#pf-avatars .ava-opt').forEach((btn) => btn.classList.toggle('on', btn.dataset.ava === editingAvatar));
});

/* 发现页搜索与排序 */
document.addEventListener('input', (e) => {
  if (e.target.id === 'explore-search') {
    exploreState.q = e.target.value;
    const grid = $('.m-grid');
    if (grid) {
      const list = filteredMountains();
      const count = $('.result-count');
      if (count) count.textContent = `共 ${list.length} 座山`;
      grid.outerHTML = list.length
        ? `<div class="m-grid">${list.map(mountainCard).join('')}</div>`
        : `<div class="card empty"><div class="empty-icon">🔍</div>没有找到符合条件的山<br>换个关键词试试</div>`;
    }
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'explore-sort') {
    exploreState.sort = e.target.value;
    route();
    if (e.target.value === 'near' && !state.lastPos) requestLocation();
  }
});

window.addEventListener('hashchange', route);
fetchRecs();
route();
