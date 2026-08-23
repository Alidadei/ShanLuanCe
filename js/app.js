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

/* ================= 存储 ================= */
const STORE_KEY = 'pashanqu.v1';

const defaultState = () => ({ nickname: '山中客', records: [] });

let state = (() => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return {
      nickname: typeof parsed.nickname === 'string' && parsed.nickname.trim() ? parsed.nickname : '山中客',
      records: Array.isArray(parsed.records) ? parsed.records : [],
    };
  } catch {
    return defaultState();
  }
})();

const saveState = () => localStorage.setItem(STORE_KEY, JSON.stringify(state));

const mountainById = (id) => MOUNTAINS.find((m) => m.id === id);

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
  return { count: state.records.length, distinct: ids.size, ids, elev };
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
    <circle cx="${sunX}" cy="${sunY}" r="19" fill="#fff6dd" opacity=".92"/>
    <circle cx="${sunX}" cy="${sunY}" r="30" fill="#fff6dd" opacity=".18"/>
    <g fill="rgba(255,255,255,.5)">
      <ellipse cx="${(sunX + 150) % 360 + 20}" cy="36" rx="34" ry="8"/>
      <ellipse cx="${(sunX + 150) % 360 + 40}" cy="42" rx="22" ry="6"/>
      <ellipse cx="${(sunX + 290) % 340 + 20}" cy="66" rx="26" ry="6"/>
    </g>
    <path fill="${back}" opacity=".92" d="M-10,152 L52,76 L94,110 L148,42 L204,114 L252,82 L300,142 L346,106 L410,152 L410,200 L-10,200 Z"/>
    <path fill="${front}" d="M-10,176 L58,122 L118,164 L184,98 L252,160 L314,124 L372,168 L410,142 L410,200 L-10,200 Z"/>
    <g stroke="rgba(255,255,255,.85)" fill="none" stroke-width="2" stroke-linecap="round">
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
  return `
  <div class="m-card" role="button" tabindex="0" aria-label="${esc(m.name)}" data-action="open-mountain" data-id="${m.id}">
    <div class="art">${mountainScene(m)}<span class="elev-tag">${fmtNum(m.elevation)}m</span></div>
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

function mountainMini(m) {
  return `
  <div class="m-mini" role="button" tabindex="0" aria-label="${esc(m.name)}" data-action="open-mountain" data-id="${m.id}">
    <div class="art">${mountainScene(m)}</div>
    <div class="body">
      <div class="name">${m.emoji} ${esc(m.name)}</div>
      <div class="sub">${esc(m.province)} · ${fmtNum(m.elevation)}m</div>
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
          ${deletable ? `<button class="del" data-action="del-record" data-id="${r.id}" title="删除记录">✕</button>` : ''}
        </span>
      </div>
    </div>
  </div>`;
}

/* ================= 视图：首页 ================= */
function viewHome() {
  const s = computeStats();
  const featured = [...MOUNTAINS].sort((a, b) => b.scenery - a.scenery).slice(0, 6);
  const themes = ['看日出', '夜爬', '云海', '红叶', '高山草甸', '佛教名山', '道教名山', '五岳'];
  const latest = sortedRecords().slice(0, 3);
  return `
  <div class="hero">
    <div class="scene-wrap">
      ${mountainScene({ id: 'hero', colors: ['#1b4332', '#52b788', '#2d6a4f', '#123527'] })}
      <div class="hero-content">
        <div class="hello">你好，${esc(state.nickname)} 🌤️</div>
        <h1>爬山趣</h1>
        <div class="slogan">会当凌绝顶，一览众山小</div>
        <div class="hero-stats">
          <div class="hstat"><b>${s.count}</b><span>打卡次数</span></div>
          <div class="hstat"><b>${s.distinct}</b><span>登顶山峰</span></div>
          <div class="hstat"><b>${fmtNum(s.elev)}m</b><span>累计海拔</span></div>
        </div>
      </div>
    </div>
  </div>

  <div class="section-title">为你推荐 <small>风景评分最高</small></div>
  <div class="h-scroll">${featured.map(mountainMini).join('')}</div>

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
  else list.sort((a, b) => b.scenery - a.scenery);
  return list;
}

function viewExplore() {
  const list = filteredMountains();
  return `
  <div class="search-bar">
    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>
    <input id="explore-search" type="search" placeholder="搜山名、地区或标签…" value="${esc(exploreState.q)}">
  </div>

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
      <button class="btn btn-primary" data-action="checkin" style="padding:9px 16px">＋ 打卡</button>
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
  return `
  <div class="me-card">
    <div class="avatar">🧗</div>
    <div class="me-info">
      <div class="nick">${esc(state.nickname)}
        <button data-action="edit-nick" title="修改昵称">✏️</button>
      </div>
      <div class="motto">山不在高，爬了就行 ⛰️</div>
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

  <div class="section-title">数据管理</div>
  <div class="data-zone">
    <button class="btn btn-ghost" data-action="export">⬇️ 导出备份</button>
    <button class="btn btn-danger-ghost" data-action="clear">🗑️ 清空数据</button>
  </div>
  <div style="text-align:center;font-size:11.5px;color:var(--muted);margin-top:22px">爬山趣 v1.0 · 数据仅保存在本机浏览器</div>
  `;
}

/* ================= 路由 ================= */
const VIEWS = { home: viewHome, explore: viewExplore, records: viewRecords, profile: viewProfile };

function route() {
  const hash = location.hash || '#/home';
  const page = $('#page');
  const tabbar = $('#tabbar');
  $$('.tab', tabbar).forEach((t) => t.classList.remove('on'));

  const mdetail = hash.match(/^#\/mountain\/([\w-]+)$/);
  if (mdetail && mountainById(mdetail[1])) {
    page.innerHTML = viewMountain(mountainById(mdetail[1]));
    tabbar.classList.add('hidden');
    window.scrollTo(0, 0);
    return;
  }

  const name = (hash.replace('#/', '').split('/'))[0] || 'home';
  const view = VIEWS[name] || viewHome;
  page.innerHTML = view();
  tabbar.classList.remove('hidden');
  const tab = $(`.tab[data-tab="${name}"]`) || $(`.tab[data-tab="home"]`);
  tab.classList.add('on');
  if (name !== 'explore') window.scrollTo(0, 0);
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
  toast(`打卡成功！登顶 ${m.name} ${m.emoji}`);

  const after = unlockedIds().filter((id) => !before.has(id));
  after.forEach((id, i) => {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    setTimeout(() => toast(`🏅 解锁成就「${a.name}」`, true), 700 + i * 900);
  });

  const hash = location.hash || '#/home';
  if (hash.startsWith('#/mountain/')) route();
  else if (hash.startsWith('#/records') || hash.startsWith('#/home')) route();
}

/* ================= Toast ================= */
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
      location.hash = `#/mountain/${t.dataset.id}`;
      break;
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
    case 'del-record':
      if (confirm('确定删除这条打卡记录吗？')) {
        state.records = state.records.filter((r) => r.id !== t.dataset.id);
        saveState();
        route();
        toast('记录已删除');
      }
      break;
    case 'edit-nick': {
      const name = prompt('给自己起个登山昵称吧：', state.nickname);
      if (name && name.trim()) {
        state.nickname = name.trim().slice(0, 16);
        saveState();
        route();
        toast('昵称已更新 ✅');
      }
      break;
    }
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
    case 'clear':
      if (confirm('确定清空所有打卡记录吗？此操作不可恢复！')) {
        state = defaultState();
        saveState();
        route();
        toast('数据已清空');
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
  }
});

window.addEventListener('hashchange', route);
route();
