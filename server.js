  const express = require('express');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public', { index: false }));

app.get('/', (_req, res) => {
  res.redirect('/host');
});

app.get('/host', (_req, res) => {
  res.sendFile(__dirname + '/public/host.html');
});

app.get('/player', (_req, res) => {
  res.sendFile(__dirname + '/public/player.html');
});

const PORT = process.env.PORT || 3000;
const HOST_PIN = String(process.env.HOST_PIN || '2468');
const HOST_RECONNECT_GRACE_MS = Math.max(5000, Number(process.env.HOST_RECONNECT_GRACE_MS) || 30000);
const PLAYER_RECONNECT_GRACE_MS = Math.max(30000, Number(process.env.PLAYER_RECONNECT_GRACE_MS) || 5 * 60 * 1000);
const MAX_PLAYERS = Math.max(1, Number.parseInt(process.env.MAX_PLAYERS || '50', 10) || 50);
const hostAccess = {
  deviceTokenHash: null,
  socketId: null,
  connected: false,
  claimedAt: null,
  disconnectedAt: null,
  releaseTimer: null,
};

function hashHostToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function hashPlayerToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function tokenOwnsHost(token) {
  return !!hostAccess.deviceTokenHash && safeEqual(hashHostToken(token), hostAccess.deviceTokenHash);
}

function isAuthorizedHost(socket) {
  return hostAccess.connected && hostAccess.socketId === socket.id;
}

function cancelHostRelease() {
  if (hostAccess.releaseTimer) clearTimeout(hostAccess.releaseTimer);
  hostAccess.releaseTimer = null;
}

function releaseHostLease() {
  cancelHostRelease();
  hostAccess.deviceTokenHash = null;
  hostAccess.socketId = null;
  hostAccess.connected = false;
  hostAccess.claimedAt = null;
  hostAccess.disconnectedAt = null;
  io.emit('host:availability', { available: true });
}

function authorizeHostSocket(socket) {
  cancelHostRelease();
  socket.join('hosts');
  hostAccess.socketId = socket.id;
  hostAccess.connected = true;
  hostAccess.disconnectedAt = null;
  socket.emit('host:authorized', { reconnectGraceMs: HOST_RECONNECT_GRACE_MS });
}

const WORLD = { width: 6144, height: 3456 };
const TICK_RATE = 30;
const TICK_MS = 1000 / TICK_RATE;
const OGAR_TICK_MS = 40;
const TICK_SCALE = OGAR_TICK_MS / TICK_MS;
const PLAYER_SPEED = 30;
const RESOURCE_COUNT = 680;
const PLAYER_START_RADIUS = 18;
const PLAYER_START_MASS = Number(process.env.PLAYER_START_MASS) || 100;
const MATCH_DURATION_MS = 15 * 60 * 1000;
const PHASE_TIMELINE = [
  { phase: 1, name: 'Cạnh tranh tự do', startMs: 0 },
  { phase: 2, name: 'Tích tụ tư bản', startMs: 2 * 60 * 1000 },
  { phase: 3, name: 'Độc quyền', startMs: 7 * 60 * 1000 },
  { phase: 4, name: 'Độc quyền nhà nước', startMs: 12 * 60 * 1000 },
];
const RADIUS_GROWTH_SCALE = 1.5;       // ↑ lớn hơn = phình to nhanh hơn khi tăng mass
const RESOURCE_MASS_GAIN = 5;         // ↑ lớn hơn = ăn tài nguyên tăng quy mô nhanh hơn
const SWALLOW_MASS_TRANSFER = 0.45;     // ↑ lớn hơn = thâu tóm đối thủ cho nhiều mass hơn
const RESOURCE_HITBOX_SCALE = 1.18;
const MONOPOLY_SHARE_WARNING = 0.45;
const MONOPOLY_SHARE_DANGER = 0.65;
const RESOURCE_SYNC_EVERY = 3;
const PLAYER_NETWORK_RATE = Math.max(1, Math.min(TICK_RATE, Number(process.env.PLAYER_NETWORK_RATE) || 30));
const HOST_NETWORK_RATE = Math.max(1, Math.min(TICK_RATE, Number(process.env.HOST_NETWORK_RATE) || 30));
const IDLE_NETWORK_RATE = Math.max(1, Math.min(TICK_RATE, Number(process.env.IDLE_NETWORK_RATE) || 2));
const PERSONAL_STATE_RATE = Math.max(1, Math.min(TICK_RATE, Number(process.env.PERSONAL_STATE_RATE) || 5));
const PLAYER_AOI_RADIUS = Math.max(400, Number(process.env.PLAYER_AOI_RADIUS) || 900);
const PLAYER_RESOURCE_RATE = Math.max(1, Number(process.env.PLAYER_RESOURCE_RATE) || 3);
const HOST_RESOURCE_RATE = Math.max(1, Number(process.env.HOST_RESOURCE_RATE) || 5);
const PLAYER_NETWORK_EVERY = Math.max(1, Math.round(TICK_RATE / PLAYER_NETWORK_RATE));
const HOST_NETWORK_EVERY = Math.max(1, Math.round(TICK_RATE / HOST_NETWORK_RATE));
const IDLE_NETWORK_EVERY = Math.max(1, Math.round(TICK_RATE / IDLE_NETWORK_RATE));
const PERSONAL_STATE_EVERY = Math.max(1, Math.round(TICK_RATE / PERSONAL_STATE_RATE));
const PLAYER_RESOURCE_EVERY = Math.max(1, Math.round(PLAYER_NETWORK_RATE / PLAYER_RESOURCE_RATE));
const HOST_RESOURCE_EVERY = Math.max(1, Math.round(HOST_NETWORK_RATE / HOST_RESOURCE_RATE));

const MAX_CELLS = 8;
const MIN_SPLIT_MASS = 200;
const SPLIT_COOLDOWN_MS = 0;
const MERGE_BASE_MS = 30000;
const COLLISION_RESTORE_TICKS = 15;
const OWN_CELL_COLLISION_ITERATIONS = 3;
const OWN_CELL_COLLISION_PADDING = 1.5;
const MIN_EJECT_MASS = 100;
const EJECT_COST = 14;
const EJECT_GIVE = 12;
const EJECT_SPEED = 30;
const SPLIT_IMPULSE = 24;
const EJECT_COOLDOWN_MS = 100;
const EJECT_ANGLE_JITTER = 0.3;
const EJECTED_TTL_MS = 12000;
const MAX_EJECTED_PER_PLAYER = Math.max(1, Number.parseInt(process.env.MAX_EJECTED_PER_PLAYER || '32', 10) || 32);
const MAX_EJECTED_GLOBAL = Math.max(MAX_EJECTED_PER_PLAYER, Number.parseInt(process.env.MAX_EJECTED_GLOBAL || '500', 10) || 500);
const CELL_IMPULSE_DECAY = 0.86;
const SP_DROP_COOLDOWN_MS = 2 * 60 * 1000;
const SP_ITEM_MIN_TTL_MS = 30 * 1000;
const SP_ITEM_MAX_TTL_MS = 45 * 1000;
const POINT_BAG_MIN_TTL_MS = 30 * 1000;
const POINT_BAG_MAX_TTL_MS = 45 * 1000;
const AUTO_MONOPOLY_START_MS = 7 * 60 * 1000;
const AUTO_MONOPOLY_HOLD_MS = 30 * 1000;
const AUTO_MONOPOLY_CHECK_MS = 30 * 1000;
const RESPAWN_BUFF_MS = 10 * 1000;
const EFFECT_MS = 15 * 1000;
const CAPTURE_DURATION_MS = 5 * 1000;
const CAPTURE_RADIUS = 150;
const CAPTURE_REWARD_INTERVAL_MS = 10 * 1000;
const CAPTURE_REWARD_LEVEL_INTERVAL_MS = 60 * 1000;
const CAPTURE_REWARD_BASE_POINTS = 50;
const CAPTURE_MAX_REWARD_LEVEL = 15;

function createCapturePoints() {
  const marginX = 760;
  const marginY = 570;
  return [
    { id: 'A', name: 'Nhà máy', icon: '⚙', x: marginX, y: marginY },
    { id: 'B', name: 'Mỏ kim loại', icon: '⛏', x: WORLD.width - marginX, y: marginY },
    { id: 'C', name: 'Khu tài nguyên', icon: '▣', x: marginX, y: WORLD.height - marginY },
    { id: 'D', name: 'Kho hàng', icon: '▤', x: WORLD.width - marginX, y: WORLD.height - marginY },
  ].map(point => ({
    ...point,
    radius: CAPTURE_RADIUS,
    ownerPlayerId: null,
    ownerPlayerName: null,
    ownerColor: '#94A3B8',
    capturedAt: null,
    lastRewardAt: null,
    rewardLevel: 0,
    capturingPlayerId: null,
    progressMs: 0,
    contested: false,
    decaying: false,
    enteredAt: {},
  }));
}

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function safeColor(color, fallback) {
  const value = String(color || '').trim();
  return HEX_COLOR_RE.test(value) ? value.toUpperCase() : fallback;
}

const resourceTypes = [
  { type: 'capital', label: 'Vốn', value: 2.2, color: '#f6c85f', weight: 0.38 },
  { type: 'tech', label: 'Công nghệ', value: 3.2, color: '#7bdff2', weight: 0.22 },
  { type: 'customer', label: 'Khách hàng', value: 2.6, color: '#b2f7ef', weight: 0.3 },
  { type: 'license', label: 'Giấy phép', value: 4.5, color: '#ff9f1c', weight: 0.1 },
];

const LOGO_COUNT = 12;

const spItemTypes = [
  { type: 'innovation', label: 'Đổi mới công nghệ', rarity: 'common', weight: 30, color: '#2dd4bf', icon: 'x2', effect: { kind: 'resourceBoost', durationMs: EFFECT_MS } },
  { type: 'distribution', label: 'Mở rộng phân phối', rarity: 'common', weight: 25, color: '#60a5fa', icon: '>>', effect: { kind: 'speedBoost', durationMs: EFFECT_MS, multiplier: 1.25 } },
  { type: 'shield', label: 'Khiên bảo hộ', rarity: 'uncommon', weight: 20, color: '#a78bfa', icon: 'SH', effect: { kind: 'shield', durationMs: EFFECT_MS } },
  { type: 'credit', label: 'Vốn vay ưu đãi', rarity: 'rare', weight: 12, color: '#facc15', icon: '+%', effect: { kind: 'scorePercent' } },
  { type: 'crisis', label: 'Khủng hoảng kinh tế', rarity: 'rare', weight: 8, color: '#fb7185', icon: '-%', effect: { kind: 'scoreLoss' } },
  { type: 'antitrust', label: 'Luật chống độc quyền', rarity: 'legendary', weight: 5, color: '#f97316', icon: 'LAW', effect: { kind: 'antitrust' } },
];

const palette = [
  '#FDE68A', '#93C5FD', '#86EFAC', '#FCA5A5', '#C4B5FD', '#67E8F9',
  '#FDA4AF', '#FDBA74', '#A7F3D0', '#DDD6FE', '#BFDBFE', '#FBCFE8'
];

let game = createGame();
let nextCellId = 1;

let cachedLan = getLANAddresses();
let cachedPreferredLan = getPreferredLanIp();
setInterval(() => {
  cachedLan = getLANAddresses();
  cachedPreferredLan = getPreferredLanIp();
}, 15000);

function createGame(opts = {}) {
  return {
    phase: 1,
    phaseName: 'Cạnh tranh tự do',
    running: false,
    gameStarted: false,
    gameEnded: false,
    startedAt: null,
    pausedAt: null,
    totalPausedMs: 0,
    manualPhaseOverride: false,
    sessionDurationMs: MATCH_DURATION_MS,
    customJoinUrl: opts.customJoinUrl || null,
    players: {},
    resources: [],
    ejected: [],
    spItems: [],
    pointBags: [],
    capturePoints: createCapturePoints(),
    lastSpDropAt: 0,
    topLeaderId: null,
    topLeaderSince: 0,
    events: [],
    metrics: {
      concentration: 0,
      topShare: 0,
      swallowed: 0,
      priceIndex: 100,
      citizenHappiness: 100,
      monopolyLevel: 'Thấp',
    },
  };
}

function getLANAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) addresses.push(iface.address);
    }
  }
  return addresses;
}

function getPreferredLanIp() {
  const addrs = getLANAddresses();
  const score = (ip) => {
    if (ip.startsWith('192.168.')) return 4;
    if (ip.startsWith('10.')) return 3;
    if (ip.startsWith('172.16.') || ip.startsWith('172.17.')) return 0;
    if (ip.startsWith('172.')) return 1;
    return 2;
  };
  return addrs.sort((a, b) => score(b) - score(a))[0] || null;
}

function getJoinUrl(g) {
  if (g.customJoinUrl) return g.customJoinUrl;
  const ip = cachedPreferredLan;
  const base = ip ? `http://${ip}:${PORT}` : `http://localhost:${PORT}`;
  return `${base}/player`;
}

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function randomTtl(minMs, maxMs) {
  return randomInt(minMs, maxMs);
}

function elapsedMs() {
  if (!game.gameStarted || !game.startedAt) return 0;
  const currentPauseMs = game.pausedAt ? Date.now() - game.pausedAt : 0;
  return Math.max(0, Date.now() - game.startedAt - game.totalPausedMs - currentPauseMs);
}

function phaseForElapsed(ms) {
  return PHASE_TIMELINE.slice().reverse().find(item => ms >= item.startMs) || PHASE_TIMELINE[0];
}

function updatePhaseByTime() {
  if (!game.gameStarted) return;
  if (game.manualPhaseOverride) return;
  const next = phaseForElapsed(elapsedMs());
  if (game.phase !== next.phase) {
    game.phase = next.phase;
    game.phaseName = next.name;
    addEvent(`Giai đoạn ${game.phase}: ${game.phaseName}`, 'phase');
  }
}

function activeUntil(p, key, now = Date.now()) {
  return Number(p.effects?.[key] || 0) > now;
}

function setTimedEffect(p, key, durationMs, now = Date.now()) {
  if (!p.effects) p.effects = {};
  p.effects[key] = now + durationMs;
}

function clearExpiredEffects(p, now = Date.now()) {
  if (!p.effects) p.effects = {};
  for (const key of Object.keys(p.effects)) {
    if (key.endsWith('Until') && p.effects[key] <= now) p.effects[key] = 0;
  }
}

function scoreRankings() {
  return Object.values(game.players)
    .filter(p => p.alive)
    .sort((a, b) => (b.score - a.score) || (totalMass(b) - totalMass(a)));
}

function topPlayer() {
  return scoreRankings()[0] || null;
}

function topThreeIds() {
  return new Set(scoreRankings().slice(0, 3).map(p => p.id));
}

function scoreBase(p) {
  return Math.max(1, p.score || 0);
}

function addScore(p, amount) {
  p.score = Math.max(0, (p.score || 0) + amount);
}

function ejectedScoreValue(e) {
  const value = Number(e?.value);
  return Number.isFinite(value) ? Math.max(0, value) : EJECT_COST;
}

function subtractScorePercent(p, percent, redistribute = false) {
  const amount = round1(scoreBase(p) * percent);
  if (amount <= 0) return 0;
  addScore(p, -amount);
  if (redistribute) spawnPointBags(amount);
  return amount;
}

function notifyPlayer(playerId, message, kind = 'info') {
  io.to(`player:${playerId}`).emit('notice', { message, kind, at: Date.now(), scope: 'personal' });
}

function notifyAll(message, kind = 'info') {
  io.emit('notice', { message, kind, at: Date.now(), scope: 'global' });
  addEvent(message, kind);
}

function chooseResourceType() {
  const total = resourceTypes.reduce((s, r) => s + r.weight, 0);
  let roll = Math.random() * total;
  for (const r of resourceTypes) {
    roll -= r.weight;
    if (roll <= 0) return r;
  }
  return resourceTypes[0];
}

function generateResources() {
  return Array.from({ length: RESOURCE_COUNT }, (_, i) => newResource(i));
}

function newResource(id = `${Date.now()}-${Math.random()}`) {
  const rt = chooseResourceType();
  return {
    id,
    type: rt.type,
    label: rt.label,
    value: rt.value,
    color: rt.color,
    radius: 8 + Math.random() * 4,
    x: 60 + Math.random() * (WORLD.width - 120),
    y: 60 + Math.random() * (WORLD.height - 120),
  };
}

function randomMapPosition(margin = 80) {
  return {
    x: margin + Math.random() * (WORLD.width - margin * 2),
    y: margin + Math.random() * (WORLD.height - margin * 2),
  };
}

function chooseSpItemType(allowAntitrust, antitrustAlreadyPicked = false) {
  let pool = spItemTypes;
  if (!allowAntitrust || antitrustAlreadyPicked) {
    pool = spItemTypes.filter(i => i.type !== 'antitrust');
  }
  const total = pool.reduce((s, i) => s + i.weight, 0);
  let roll = Math.random() * total;
  for (const item of pool) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return pool[0];
}

function makeSpItem(def, now = Date.now()) {
  const ttl = randomTtl(SP_ITEM_MIN_TTL_MS, SP_ITEM_MAX_TTL_MS);
  const position = randomMapPosition();
  return {
    id: `sp-${now}-${Math.random()}`,
    type: def.type,
    label: def.label,
    position,
    x: position.x,
    y: position.y,
    radius: 22,
    duration: ttl,
    rarity: def.rarity,
    effect: def.effect,
    icon: def.icon,
    color: def.color,
    spawnTime: now,
    expireTime: now + ttl,
  };
}

function dropSpItems() {
  const now = Date.now();
  if (now - game.lastSpDropAt < SP_DROP_COOLDOWN_MS) return false;

  const playerCount = Object.keys(game.players).length;
  const count = playerCount <= 8 ? randomInt(8, 12) : randomInt(15, 20);
  const allowAntitrust = elapsedMs() >= AUTO_MONOPOLY_START_MS;
  let hasAntitrust = false;
  const items = [];

  for (let i = 0; i < count; i++) {
    const def = chooseSpItemType(allowAntitrust, hasAntitrust);
    if (def.type === 'antitrust') hasAntitrust = true;
    items.push(makeSpItem(def, now));
  }

  game.spItems.push(...items);
  game.lastSpDropAt = now;
  notifyAll(`Thả SP Item: ${items.length} vật phẩm đã rơi trên bản đồ`, 'phase');
  return true;
}

function spawnPointBags(totalValue) {
  if (totalValue <= 0) return;
  const now = Date.now();
  const count = randomInt(5, 12);
  const weights = Array.from({ length: count }, () => 0.25 + Math.random());
  const sum = weights.reduce((s, w) => s + w, 0);
  let allocated = 0;
  const bags = weights.map((w, idx) => {
    const value = idx === weights.length - 1 ? totalValue - allocated : totalValue * (w / sum);
    allocated += value;
    const ttl = randomTtl(POINT_BAG_MIN_TTL_MS, POINT_BAG_MAX_TTL_MS);
    const position = randomMapPosition();
    return {
      id: `bag-${now}-${idx}-${Math.random()}`,
      type: 'pointBag',
      label: 'Túi điểm điều tiết',
      position,
      x: position.x,
      y: position.y,
      radius: 18,
      value: Math.max(0, value),
      duration: ttl,
      spawnTime: now,
      expireTime: now + ttl,
      color: '#fbbf24',
    };
  }).filter(b => b.value > 0);
  game.pointBags.push(...bags);
}

function radiusFromMass(mass) {
  const growth = Math.max(0, Math.sqrt(mass) - Math.sqrt(PLAYER_START_MASS));
  return PLAYER_START_RADIUS + growth * RADIUS_GROWTH_SCALE;
}

function ejectedRadius(mass) {
  return Math.max(5, 4 + Math.sqrt(mass) * 1.25);
}

function ogarSize(mass) {
  return Math.max(1, Math.floor(Math.sqrt(100 * mass)));
}

function speedMultiplier(p, now = Date.now()) {
  let mult = 1;
  if (activeUntil(p, 'speedBoostUntil', now)) mult *= p.effects?.speedBoostMult || 1.25;
  if (activeUntil(p, 'monopolySlowUntil', now)) mult *= 0.8;
  if (p.monopolySupervised) mult *= 0.9;
  return mult;
}

function resourceMultiplier(p, now = Date.now()) {
  return activeUntil(p, 'resourceBoostUntil', now) ? 2 : 1;
}

function cellMoveSpeed(mass, p) {
  const size = ogarSize(mass);
  return (PLAYER_SPEED * 1.6 / Math.pow(size, 0.32)) * TICK_SCALE * speedMultiplier(p);
}

function calcMergeAt(mass, now) {
  return now + MERGE_BASE_MS + Math.floor(mass * 20);
}

function cellAngleToMouse(cell, p) {
  let angle = Math.atan2(p.mouseY - cell.y, p.mouseX - cell.x);
  if (angle === 0 || Number.isNaN(angle)) angle = Math.PI / 2;
  return angle;
}

function moveCellTowardMouse(cell, p) {
  const speed = cellMoveSpeed(cell.mass, p);
  const dx = p.mouseX - cell.x;
  const dy = p.mouseY - cell.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 0.5 && speed > 0) {
    const step = Math.min(dist, speed);
    cell.x += (dx / dist) * step;
    cell.y += (dy / dist) * step;
  }
}

function resourceHitRadius(resource) {
  return resource.radius * RESOURCE_HITBOX_SCALE;
}

function safeName(name) {
  const text = String(name || '').replace(/<[^>]*>?/gm, '').trim();
  return text.slice(0, 24) || 'Doanh nghiệp mới';
}

function randomSpawn() {
  return {
    x: 120 + Math.random() * (WORLD.width - 240),
    y: 120 + Math.random() * (WORLD.height - 240),
  };
}

function newCellId(ownerId) {
  nextCellId += 1;
  return `${ownerId}-${nextCellId}`;
}

function totalMass(p) {
  return p.cells.reduce((s, c) => s + c.mass, 0);
}

function largestCell(p) {
  if (!p.cells.length) return null;
  return p.cells.reduce((a, b) => (b.mass > a.mass ? b : a), p.cells[0]);
}

function enforceMaxCells(p) {
  if (!p?.cells || p.cells.length <= MAX_CELLS) return;
  const sorted = p.cells.slice().sort((a, b) => b.mass - a.mass);
  const keep = sorted.slice(0, MAX_CELLS);
  const overflow = sorted.slice(MAX_CELLS);
  const target = keep[0];
  for (const cell of overflow) {
    target.mass += cell.mass;
  }
  p.cells = keep;
  syncLegacyFields(p);
}

function centroid(p) {
  const m = totalMass(p) || 1;
  let x = 0;
  let y = 0;
  for (const c of p.cells) {
    x += c.x * c.mass;
    y += c.y * c.mass;
  }
  return { x: x / m, y: y / m };
}

function syncLegacyFields(p) {
  const lc = largestCell(p);
  if (!lc) {
    p.mass = 0;
    p.radius = PLAYER_START_RADIUS;
    p.x = 0;
    p.y = 0;
    return;
  }
  p.mass = totalMass(p);
  p.x = lc.x;
  p.y = lc.y;
  p.radius = radiusFromMass(lc.mass);
}

function makeCell(ownerId, x, y, mass = PLAYER_START_MASS) {
  return {
    id: newCellId(ownerId),
    x,
    y,
    mass,
    vx: 0,
    vy: 0,
    canMergeAt: 0,
    collisionRestoreTicks: 0,
  };
}

function createPlayer(socketId, name, logoIndex = 0, color = null) {
  const spawn = randomSpawn();
  const index = Object.keys(game.players).length;
  const safeLogo = Number.isInteger(logoIndex) ? Math.max(0, Math.min(LOGO_COUNT - 1, logoIndex)) : 0;
  const fallbackColor = palette[index % palette.length];
  const p = {
    id: socketId,
    name: safeName(name),
    logoIndex: safeLogo,
    cells: [makeCell(socketId, spawn.x, spawn.y, PLAYER_START_MASS)],
    mouseX: spawn.x,
    mouseY: spawn.y,
    dirX: 0,
    dirY: 0,
    lastDirX: 1,
    lastDirY: 0,
    score: PLAYER_START_MASS,
    swallowed: 0,
    swallowedBy: 0,
    color: safeColor(color, fallbackColor),
    alive: true,
    respawnAt: 0,
    joinedAt: Date.now(),
    lastSplitAt: 0,
    lastEjectAt: 0,
    networkSendCount: 0,
    socketId: null,
    resumeTokenHash: null,
    disconnectedAt: null,
    disconnectTimer: null,
    effects: {
      resourceBoostUntil: 0,
      shieldUntil: 0,
      speedBoostUntil: 0,
      speedBoostMult: 1,
      monopolySlowUntil: 0,
      noSwallowUntil: 0,
    },
    monopolySupervised: false,
    monopolyPenaltyDueAt: 0,
  };
  syncLegacyFields(p);
  return p;
}


function clampCell(cell) {
  const r = radiusFromMass(cell.mass);
  cell.x = Math.max(r, Math.min(WORLD.width - r, cell.x));
  cell.y = Math.max(r, Math.min(WORLD.height - r, cell.y));
}

function splitPlayer(p) {
  const now = Date.now();
  enforceMaxCells(p);
  if (SPLIT_COOLDOWN_MS && now - p.lastSplitAt < SPLIT_COOLDOWN_MS) return;
  if (p.cells.length >= MAX_CELLS) return;

  const sources = [...p.cells];
  let splitCount = 0;

  for (const cell of sources) {
    if (p.cells.length >= MAX_CELLS) break;
    if (cell.mass < MIN_SPLIT_MASS) continue;

    const half = cell.mass / 2;
    cell.mass = half;
    const angle = cellAngleToMouse(cell, p);
    const impulse = SPLIT_IMPULSE;

    p.cells.push({
      id: newCellId(p.id),
      x: cell.x,
      y: cell.y,
      mass: half,
      vx: Math.cos(angle) * impulse,
      vy: Math.sin(angle) * impulse,
      canMergeAt: calcMergeAt(half, now),
      collisionRestoreTicks: COLLISION_RESTORE_TICKS,
    });
    cell.canMergeAt = calcMergeAt(half, now);
    cell.collisionRestoreTicks = COLLISION_RESTORE_TICKS;
    splitCount += 1;
  }

  if (splitCount > 0) p.lastSplitAt = now;
  enforceMaxCells(p);
  syncLegacyFields(p);
}

function ejectMass(p) {
  const now = Date.now();
  if (now - p.lastEjectAt < EJECT_COOLDOWN_MS) return;

  let ejected = false;
  let totalCost = 0;
  let ownerEjectedCount = game.ejected.reduce((count, item) => count + (item.ownerId === p.id ? 1 : 0), 0);

  for (const cell of p.cells) {
    if (game.ejected.length >= MAX_EJECTED_GLOBAL || ownerEjectedCount >= MAX_EJECTED_PER_PLAYER) break;
    if (cell.mass < MIN_EJECT_MASS) continue;

    const scoreValue = Math.min(EJECT_COST, Math.max(0, (p.score || 0) - totalCost));
    if (scoreValue <= 0) continue;
    cell.mass -= EJECT_COST;
    totalCost += scoreValue;
    let angle = cellAngleToMouse(cell, p);
    angle += (Math.random() * EJECT_ANGLE_JITTER * 2) - EJECT_ANGLE_JITTER;
    const r = radiusFromMass(cell.mass);
    const offset = r * 1.15 + 10;

    game.ejected.push({
      id: `ej-${now}-${Math.random()}`,
      ownerId: p.id,
      x: cell.x + Math.cos(angle) * offset,
      y: cell.y + Math.sin(angle) * offset,
      mass: EJECT_GIVE,
      value: scoreValue,
      vx: Math.cos(angle) * EJECT_SPEED,
      vy: Math.sin(angle) * EJECT_SPEED,
      color: p.color,
      spawnedAt: now,
    });
    ownerEjectedCount += 1;
    ejected = true;
  }

  if (ejected) {
    p.lastEjectAt = now;
    p.score = Math.max(0, (p.score || 0) - totalCost);
    p.cells = p.cells.filter(c => c.mass > 1);
    if (!p.cells.length) killPlayer(p);
    syncLegacyFields(p);
  }
}

function killPlayer(p) {
  p.alive = false;
  p.cells = [];
  p.score = PLAYER_START_MASS;
  p.respawnAt = Date.now() + 4200;
  p.monopolySupervised = false;
  p.monopolyPenaltyDueAt = 0;
  syncLegacyFields(p);
}

function playerInsideCapturePoint(player, point) {
  if (!player?.alive || !player.cells?.length) return false;
  return player.cells.some(cell => Math.hypot(cell.x - point.x, cell.y - point.y) <= point.radius);
}

function resetCaptureAttempt(point) {
  point.capturingPlayerId = null;
  point.progressMs = 0;
  point.contested = false;
  point.decaying = false;
}

function captureRewardLevel() {
  return Math.min(
    CAPTURE_MAX_REWARD_LEVEL,
    Math.floor(elapsedMs() / CAPTURE_REWARD_LEVEL_INTERVAL_MS) + 1,
  );
}

function addCaptureReward(player, points) {
  if (!player?.alive || points <= 0) return 0;
  addScore(player, points);
  const cell = largestCell(player);
  const massGain = points;
  if (cell) cell.mass += massGain;
  syncLegacyFields(player);
  return massGain;
}

function grantCaptureReward(point, now) {
  if (!point.lastRewardAt || now - point.lastRewardAt < CAPTURE_REWARD_INTERVAL_MS) return;
  const rewardCount = Math.floor((now - point.lastRewardAt) / CAPTURE_REWARD_INTERVAL_MS);
  point.lastRewardAt += rewardCount * CAPTURE_REWARD_INTERVAL_MS;
  point.rewardLevel = captureRewardLevel();
  const reward = rewardCount * point.rewardLevel * CAPTURE_REWARD_BASE_POINTS;

  const owner = point.ownerPlayerId && game.players[point.ownerPlayerId];
  if (!owner?.alive || reward <= 0) return;
  const massGain = addCaptureReward(owner, reward);
  notifyPlayer(owner.id, `${point.name} · mốc ${point.rewardLevel}: +${reward} điểm, +${massGain} mass`, 'success');
}

function updateCapturePoints() {
  const now = Date.now();
  const players = Object.values(game.players);

  for (const point of game.capturePoints) {
    grantCaptureReward(point, now);
    const occupants = players.filter(player => playerInsideCapturePoint(player, point));
    const occupantIds = new Set(occupants.map(player => player.id));

    for (const player of occupants) {
      if (!point.enteredAt[player.id]) point.enteredAt[player.id] = now;
    }
    for (const playerId of Object.keys(point.enteredAt)) {
      if (!occupantIds.has(playerId)) delete point.enteredAt[playerId];
    }

    if (point.capturingPlayerId) {
      const capturer = game.players[point.capturingPlayerId];
      if (!capturer) resetCaptureAttempt(point);
    }

    if (!point.capturingPlayerId) {
      const eligible = occupants
        .filter(player => player.id !== point.ownerPlayerId)
        .sort((a, b) => (point.enteredAt[a.id] || now) - (point.enteredAt[b.id] || now));
      if (eligible.length) point.capturingPlayerId = eligible[0].id;
    }

    const capturer = point.capturingPlayerId && game.players[point.capturingPlayerId];
    if (!capturer) {
      point.contested = false;
      point.decaying = false;
      continue;
    }

    const capturerInside = playerInsideCapturePoint(capturer, point);
    if (!capturerInside) {
      point.contested = false;
      point.decaying = true;
      point.progressMs = Math.max(0, point.progressMs - TICK_MS);
      if (point.progressMs <= 0) resetCaptureAttempt(point);
      continue;
    }

    point.decaying = false;
    point.contested = occupants.some(player => player.id !== capturer.id);
    if (point.contested) continue;

    point.progressMs = Math.min(CAPTURE_DURATION_MS, point.progressMs + TICK_MS);
    if (point.progressMs < CAPTURE_DURATION_MS) continue;

    const previousOwnerId = point.ownerPlayerId;
    const previousOwnerName = point.ownerPlayerName;
    point.ownerPlayerId = capturer.id;
    point.ownerPlayerName = capturer.name;
    point.ownerColor = capturer.color;
    point.capturedAt = now;
    point.lastRewardAt = now;
    point.rewardLevel = captureRewardLevel();
    const captureReward = point.rewardLevel * CAPTURE_REWARD_BASE_POINTS;
    const massGain = addCaptureReward(capturer, captureReward);
    notifyPlayer(
      capturer.id,
      `Chiếm ${point.name} · mốc ${point.rewardLevel}: +${captureReward} điểm, +${massGain} mass; tiếp tục nhận sau mỗi 10 giây`,
      'success',
    );
    const wasStolen = previousOwnerId && previousOwnerId !== capturer.id;
    const message = wasStolen
      ? `${capturer.name.toUpperCase()} ĐÃ CƯỚP ${point.name.toUpperCase()} TỪ ${String(previousOwnerName || 'NGƯỜI CHƠI KHÁC').toUpperCase()}!`
      : `${capturer.name.toUpperCase()} ĐÃ CHIẾM ${point.name.toUpperCase()}!`;
    notifyAll(`${point.icon} ${message}`, 'capture');
    resetCaptureAttempt(point);
  }
}

function respawnPlayer(p) {
  const now = Date.now();
  const spawn = randomSpawn();
  p.cells = [makeCell(p.id, spawn.x, spawn.y, PLAYER_START_MASS)];
  p.mouseX = spawn.x;
  p.mouseY = spawn.y;
  p.alive = true;
  p.dirX = 0;
  p.dirY = 0;
  setTimedEffect(p, 'shieldUntil', RESPAWN_BUFF_MS, now);
  setTimedEffect(p, 'resourceBoostUntil', RESPAWN_BUFF_MS, now);
  setTimedEffect(p, 'speedBoostUntil', RESPAWN_BUFF_MS, now);
  p.effects.speedBoostMult = 1.2;
  notifyPlayer(p.id, 'Hồi sinh: khiên 10s, tăng tốc 20%, x2 điểm tài nguyên', 'success');
  syncLegacyFields(p);
}

function addEvent(message, severity = 'info') {
  game.events.unshift({ id: Date.now() + Math.random(), message, severity, at: Date.now() });
  game.events = game.events.slice(0, 12);
}

function updateCells(p) {
  for (const cell of p.cells) {
    moveCellTowardMouse(cell, p);

    if (cell.vx || cell.vy) {
      cell.x += cell.vx;
      cell.y += cell.vy;
      cell.vx *= CELL_IMPULSE_DECAY;
      cell.vy *= CELL_IMPULSE_DECAY;
      if (Math.hypot(cell.vx, cell.vy) < 0.05) {
        cell.vx = 0;
        cell.vy = 0;
      }
    }

    if (cell.collisionRestoreTicks > 0) cell.collisionRestoreTicks -= 1;
    clampCell(cell);
  }
  syncLegacyFields(p);
}

function resolveOwnCellCollisions(p) {
  const now = Date.now();
  if (p.cells.length < 2) return;

  for (let pass = 0; pass < OWN_CELL_COLLISION_ITERATIONS; pass++) {
    let moved = false;
    for (let i = 0; i < p.cells.length; i++) {
      for (let j = i + 1; j < p.cells.length; j++) {
        const a = p.cells[i];
        const b = p.cells[j];
        if (now >= a.canMergeAt && now >= b.canMergeAt) continue;

        const ra = radiusFromMass(a.mass);
        const rb = radiusFromMass(b.mass);
        const minDist = ra + rb + OWN_CELL_COLLISION_PADDING;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);

        if (dist >= minDist) continue;
        if (dist < 0.001) {
          const angle = ((i * 131 + j * 73) % 360) * Math.PI / 180;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dist = 1;
        }

        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;
        const totalMass = a.mass + b.mass || 1;
        const pushA = overlap * (b.mass / totalMass);
        const pushB = overlap * (a.mass / totalMass);

        a.x -= nx * pushA;
        a.y -= ny * pushA;
        b.x += nx * pushB;
        b.y += ny * pushB;

        const relVx = b.vx - a.vx;
        const relVy = b.vy - a.vy;
        const closingSpeed = relVx * nx + relVy * ny;
        if (closingSpeed < 0) {
          const damp = closingSpeed * 0.5;
          a.vx += nx * damp * (b.mass / totalMass);
          a.vy += ny * damp * (b.mass / totalMass);
          b.vx -= nx * damp * (a.mass / totalMass);
          b.vy -= ny * damp * (a.mass / totalMass);
        }

        clampCell(a);
        clampCell(b);
        moved = true;
      }
    }
    if (!moved) break;
  }
}

class UniformSpatialGrid {
  constructor(cellSize = 256) {
    this.cellSize = cellSize;
    this.buckets = new Map();
    this.objectKeys = new Map();
  }

  keyFor(x, y) {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }

  insert(object) {
    if (!object || !Number.isFinite(object.x) || !Number.isFinite(object.y)) return;
    const key = this.keyFor(object.x, object.y);
    const bucket = this.buckets.get(key) || [];
    bucket.push(object);
    this.buckets.set(key, bucket);
    this.objectKeys.set(object, key);
  }

  remove(object) {
    const key = this.objectKeys.get(object);
    if (key === undefined) return;
    const bucket = this.buckets.get(key);
    if (bucket) {
      const index = bucket.indexOf(object);
      if (index >= 0) bucket.splice(index, 1);
      if (!bucket.length) this.buckets.delete(key);
    }
    this.objectKeys.delete(object);
  }

  queryCircle(x, y, radius) {
    const candidates = [];
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize);
    const maxY = Math.floor((y + radius) / this.cellSize);
    for (let gx = minX; gx <= maxX; gx += 1) {
      for (let gy = minY; gy <= maxY; gy += 1) {
        const bucket = this.buckets.get(`${gx},${gy}`);
        if (bucket) candidates.push(...bucket);
      }
    }
    return candidates;
  }

  static from(objects, cellSize = 256) {
    const grid = new UniformSpatialGrid(cellSize);
    for (const object of objects) grid.insert(object);
    return grid;
  }
}

let tickResourceGrid = null;
let tickEjectedGrid = null;

function updateEjected() {
  const now = Date.now();
  game.ejected = game.ejected.filter(e => {
    e.x += e.vx;
    e.y += e.vy;
    e.vx *= CELL_IMPULSE_DECAY;
    e.vy *= CELL_IMPULSE_DECAY;
    if (Math.abs(e.vx) < 0.05) e.vx = 0;
    if (Math.abs(e.vy) < 0.05) e.vy = 0;
    const r = ejectedRadius(e.mass);
    if (e.x < -r || e.x > WORLD.width + r || e.y < -r || e.y > WORLD.height + r) return false;
    return now - e.spawnedAt < EJECTED_TTL_MS;
  });
}

function collectResources(p) {
  for (const cell of p.cells) {
    const cr = radiusFromMass(cell.mass);
    const candidates = tickResourceGrid
      ? tickResourceGrid.queryCircle(cell.x, cell.y, cr + 16)
      : game.resources;
    for (const r of candidates) {
      const i = game.resources.indexOf(r);
      if (i < 0) continue;
      const d = Math.hypot(cell.x - r.x, cell.y - r.y);
      if (d < cr + resourceHitRadius(r)) {
        const mult = resourceMultiplier(p);
        cell.mass += r.value * RESOURCE_MASS_GAIN * mult;
        p.score += r.value * mult;
        game.resources.splice(i, 1);
        if (tickResourceGrid) tickResourceGrid.remove(r);
        const replacement = newResource();
        game.resources.push(replacement);
        if (tickResourceGrid) tickResourceGrid.insert(replacement);
      }
    }
  }
  syncLegacyFields(p);
}

function applySpItem(p, item) {
  const now = Date.now();
  if (item.type === 'innovation') {
    setTimedEffect(p, 'resourceBoostUntil', EFFECT_MS, now);
    notifyPlayer(p.id, 'Đổi mới công nghệ: x2 điểm/tăng trưởng tài nguyên trong 15s', 'success');
    return;
  }

  if (item.type === 'distribution') {
    setTimedEffect(p, 'speedBoostUntil', EFFECT_MS, now);
    p.effects.speedBoostMult = 1.25;
    notifyPlayer(p.id, 'Mở rộng phân phối: +25% tốc độ trong 15s', 'success');
    return;
  }

  if (item.type === 'shield') {
    setTimedEffect(p, 'shieldUntil', EFFECT_MS, now);
    notifyPlayer(p.id, 'Khiên bảo hộ: không bị thâu tóm trong 15s', 'success');
    return;
  }

  if (item.type === 'credit') {
    const top3 = topThreeIds();
    const percent = top3.has(p.id) ? 0.05 : 0.1;
    const amount = round1(scoreBase(p) * percent);
    addScore(p, amount);
    notifyPlayer(p.id, `Vốn vay ưu đãi: +${Math.round(percent * 100)}% điểm (+${amount})`, 'success');
    return;
  }

  if (item.type === 'crisis') {
    const amount = subtractScorePercent(p, 0.1, false);
    notifyPlayer(p.id, `Khủng hoảng kinh tế: mất 10% điểm (-${amount})`, 'warn');
    return;
  }

  if (item.type === 'antitrust') {
    applyAntitrustItem(p);
  }
}

function applyAntitrustItem(collector) {
  const target = topPlayer();
  if (!target) return;
  const roll = randomInt(1, 3);
  let detail = '';

  if (roll === 1) {
    const amount = subtractScorePercent(target, 0.1, true);
    detail = `${target.name} mất 10% điểm (-${amount}), điểm bị chia thành túi trên bản đồ`;
  } else if (roll === 2) {
    setTimedEffect(target, 'monopolySlowUntil', EFFECT_MS);
    detail = `${target.name} bị giảm tốc 20% trong 15s`;
    notifyPlayer(target.id, 'Luật chống độc quyền: bạn bị giảm tốc 20% trong 15s', 'warn');
  } else {
    setTimedEffect(target, 'noSwallowUntil', EFFECT_MS);
    detail = `${target.name} không được thâu tóm người khác trong 15s`;
    notifyPlayer(target.id, 'Luật chống độc quyền: tạm thời không được thâu tóm trong 15s', 'warn');
  }

  notifyAll(`Luật chống độc quyền được ${collector.name} kích hoạt: ${detail}`, 'danger');
}

function collectSpItems(p) {
  for (const cell of p.cells) {
    const cr = radiusFromMass(cell.mass);
    for (let i = game.spItems.length - 1; i >= 0; i--) {
      const item = game.spItems[i];
      const d = Math.hypot(cell.x - item.x, cell.y - item.y);
      if (d < cr + item.radius) {
        game.spItems.splice(i, 1);
        applySpItem(p, item);
      }
    }
  }
}

function collectPointBags(p) {
  for (const cell of p.cells) {
    const cr = radiusFromMass(cell.mass);
    for (let i = game.pointBags.length - 1; i >= 0; i--) {
      const bag = game.pointBags[i];
      const d = Math.hypot(cell.x - bag.x, cell.y - bag.y);
      if (d < cr + bag.radius) {
        addScore(p, bag.value);
        cell.mass += Math.max(1, bag.value * 0.25);
        game.pointBags.splice(i, 1);
        notifyPlayer(p.id, `Nhận túi điểm điều tiết: +${round1(bag.value)} điểm`, 'success');
      }
    }
  }
  syncLegacyFields(p);
}

function mergeCells(p) {
  const now = Date.now();
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < p.cells.length; i++) {
      for (let j = i + 1; j < p.cells.length; j++) {
        const a = p.cells[i];
        const b = p.cells[j];
        if (now < a.canMergeAt || now < b.canMergeAt) continue;
        if (a.collisionRestoreTicks > 0 || b.collisionRestoreTicks > 0) continue;
        const ra = radiusFromMass(a.mass);
        const rb = radiusFromMass(b.mass);
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d >= ra + rb - 4) continue;

        const big = a.mass >= b.mass ? a : b;
        const small = big === a ? b : a;
        big.mass += small.mass;
        big.x = (big.x * 0.6 + small.x * 0.4);
        big.y = (big.y * 0.6 + small.y * 0.4);
        p.cells = p.cells.filter(c => c.id !== small.id);
        merged = true;
        break;
      }
      if (merged) break;
    }
  }
  syncLegacyFields(p);
}

function handleEjectedCollisions() {
  for (const p of Object.values(game.players)) {
    if (!p.alive) continue;
    for (const cell of p.cells) {
      const cr = radiusFromMass(cell.mass);
      const candidates = tickEjectedGrid
        ? tickEjectedGrid.queryCircle(cell.x, cell.y, cr + 40)
        : game.ejected;
      for (const e of candidates) {
        const i = game.ejected.indexOf(e);
        if (i < 0) continue;
        const er = ejectedRadius(e.mass);
        const d = Math.hypot(cell.x - e.x, cell.y - e.y);
        if (d < cr + er * 0.85) {
          cell.mass += e.mass;
          addScore(p, ejectedScoreValue(e));
          game.ejected.splice(i, 1);
          if (tickEjectedGrid) tickEjectedGrid.remove(e);
        }
      }
    }
    syncLegacyFields(p);
  }
}

function handleSwallowing() {
  if (game.gameStarted && elapsedMs() < PHASE_TIMELINE[1].startMs) return;

  const alive = Object.values(game.players).filter(p => p.alive && p.cells.length);
  const allCells = [];
  const swallowedCellIds = new Set();
  for (const p of alive) {
    for (const c of p.cells) allCells.push({ cell: c, player: p });
  }

  for (let i = 0; i < allCells.length; i++) {
    for (let j = i + 1; j < allCells.length; j++) {
      const { cell: a, player: pa } = allCells[i];
      const { cell: b, player: pb } = allCells[j];
      if (pa.id === pb.id) continue;
      if (swallowedCellIds.has(a.id) || swallowedCellIds.has(b.id)) continue;
      if (!pa.cells.some(cell => cell.id === a.id) || !pb.cells.some(cell => cell.id === b.id)) continue;

      const ra = radiusFromMass(a.mass);
      const rb = radiusFromMass(b.mass);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d >= Math.max(ra, rb) * 0.82) continue;

      let bigCell = null;
      let smallCell = null;
      let bigPlayer = null;
      let smallPlayer = null;

      if (a.mass > b.mass * 1.18) {
        bigCell = a; smallCell = b; bigPlayer = pa; smallPlayer = pb;
      } else if (b.mass > a.mass * 1.18) {
        bigCell = b; smallCell = a; bigPlayer = pb; smallPlayer = pa;
      }
      if (!bigCell) continue;
      const now = Date.now();
      if (activeUntil(smallPlayer, 'shieldUntil', now)) continue;
      if (activeUntil(bigPlayer, 'noSwallowUntil', now)) continue;

      const smallPlayerMassBefore = totalMass(smallPlayer);
      const swallowedScore = smallPlayerMassBefore > 0
        ? smallPlayer.score * (smallCell.mass / smallPlayerMassBefore)
        : 0;
      const transferredScore = swallowedScore * SWALLOW_MASS_TRANSFER;

      bigCell.mass += smallCell.mass * SWALLOW_MASS_TRANSFER;
      smallPlayer.cells = smallPlayer.cells.filter(c => c.id !== smallCell.id);
      swallowedCellIds.add(smallCell.id);

      if (smallPlayer.cells.length) {
        addScore(smallPlayer, -swallowedScore);
        addScore(bigPlayer, transferredScore);
        notifyPlayer(
          bigPlayer.id,
          `Ăn một cell của ${smallPlayer.name}: +${Math.round(transferredScore)} điểm`,
          'success',
        );
        notifyPlayer(
          smallPlayer.id,
          `Một cell bị ${bigPlayer.name} ăn: -${Math.round(swallowedScore)} điểm`,
          'warn',
        );
      } else {
        bigPlayer.score += 18;
        bigPlayer.swallowed += 1;
        smallPlayer.swallowedBy += 1;
        game.metrics.swallowed += 1;
        addEvent(`${bigPlayer.name} thâu tóm ${smallPlayer.name}`, 'danger');
        killPlayer(smallPlayer);
      }
      syncLegacyFields(bigPlayer);
      syncLegacyFields(smallPlayer);
    }
  }
}

function updatePlayer(p) {
  if (!game.gameStarted || !game.running) return;
  clearExpiredEffects(p);
  if (!p.alive) {
    if (Date.now() > p.respawnAt) respawnPlayer(p);
    return;
  }
  if (!p.cells.length) {
    killPlayer(p);
    return;
  }
  enforceMaxCells(p);

  updateCells(p);
  resolveOwnCellCollisions(p);
  collectResources(p);
  collectSpItems(p);
  collectPointBags(p);
  mergeCells(p);
}

function nextPhase() {
  game.manualPhaseOverride = true;
  if (game.phase < 4) game.phase += 1;
  else game.phase = 1;
  const names = {
    1: 'Cạnh tranh tự do',
    2: 'Tích tụ tư bản',
    3: 'Độc quyền',
    4: 'Độc quyền nhà nước',
  };
  game.phaseName = names[game.phase];
  addEvent(`Chuyển sang giai đoạn ${game.phase}: ${game.phaseName}`, 'phase');
}

function updateTemporaryObjects() {
  const now = Date.now();
  game.spItems = game.spItems.filter(item => item.expireTime > now);
  game.pointBags = game.pointBags.filter(bag => bag.expireTime > now);
}

function updateAutoMonopoly() {
  if (!game.gameStarted || !game.running) return;
  const now = Date.now();
  if (elapsedMs() < AUTO_MONOPOLY_START_MS) {
    game.topLeaderId = null;
    game.topLeaderSince = 0;
    for (const p of Object.values(game.players)) {
      p.monopolySupervised = false;
      p.monopolyPenaltyDueAt = 0;
    }
    return;
  }

  const top = topPlayer();
  if (!top) return;

  if (game.topLeaderId !== top.id) {
    for (const p of Object.values(game.players)) {
      if (p.id !== top.id && p.monopolySupervised) {
        p.monopolySupervised = false;
        p.monopolyPenaltyDueAt = 0;
        notifyPlayer(p.id, 'Đã thoát trạng thái giám sát độc quyền', 'success');
        addEvent(`${p.name} không còn là top 1, gỡ giám sát độc quyền`, 'info');
      }
    }
    game.topLeaderId = top.id;
    game.topLeaderSince = now;
    return;
  }

  for (const p of Object.values(game.players)) {
    if (p.id !== top.id && p.monopolySupervised) {
      p.monopolySupervised = false;
      p.monopolyPenaltyDueAt = 0;
      notifyPlayer(p.id, 'Đã thoát trạng thái giám sát độc quyền', 'success');
    }
  }

  if (!top.monopolySupervised && now - game.topLeaderSince >= AUTO_MONOPOLY_HOLD_MS) {
    top.monopolySupervised = true;
    top.monopolyPenaltyDueAt = now + AUTO_MONOPOLY_CHECK_MS;
    notifyPlayer(top.id, 'Bạn đang bị giám sát độc quyền: -10% tốc độ, kiểm tra mỗi 30s', 'warn');
    notifyAll(`${top.name} giữ top 1 quá 30s và bị giám sát độc quyền`, 'danger');
    return;
  }

  if (top.monopolySupervised && now >= top.monopolyPenaltyDueAt) {
    const amount = subtractScorePercent(top, 0.05, true);
    top.monopolyPenaltyDueAt = now + AUTO_MONOPOLY_CHECK_MS;
    notifyPlayer(top.id, `Bị phạt độc quyền: -5% điểm (-${amount})`, 'warn');
    notifyAll(`${top.name} bị trừ 5% điểm do duy trì vị thế độc quyền`, 'danger');
  }
}

function endMatchIfNeeded() {
  if (!game.gameStarted || game.gameEnded) return;
  if (elapsedMs() < game.sessionDurationMs) return;
  game.running = false;
  game.gameEnded = true;
  const winner = scoreRankings()[0];
  notifyAll(winner ? `Hết giờ! Người thắng: ${winner.name} với ${Math.round(winner.score)} điểm` : 'Hết giờ! Chưa có người thắng', 'phase');
}

function updateMetrics() {
  const alivePlayers = Object.values(game.players).filter(p => p.alive);
  for (const p of alivePlayers) syncLegacyFields(p);
  const totalAllMass = alivePlayers.reduce((s, p) => s + totalMass(p), 0) || 1;
  const sorted = alivePlayers.slice().sort((a, b) => totalMass(b) - totalMass(a));
  const top = sorted[0];
  const topShare = top ? totalMass(top) / totalAllMass : 0;
  const hhi = alivePlayers.reduce((s, p) => s + Math.pow(totalMass(p) / totalAllMass, 2), 0);

  let level = 'Thấp';
  if (topShare >= 0.25) level = 'Trung bình';
  if (topShare >= MONOPOLY_SHARE_WARNING) level = 'Cao';
  if (topShare >= MONOPOLY_SHARE_DANGER) level = 'Rất cao';

  const priceIndex = Math.round(100 + topShare * 78);
  const citizenHappiness = Math.max(20, Math.round(100 - topShare * 50));

  game.metrics = {
    ...game.metrics,
    concentration: Number(hhi.toFixed(3)),
    topShare: Number(topShare.toFixed(3)),
    topPlayer: top ? top.name : '-',
    priceIndex,
    citizenHappiness,
    monopolyLevel: level,
  };
}

function serializePlayer(p) {
  syncLegacyFields(p);
  const lc = largestCell(p);
  return {
    id: p.id,
    name: p.name,
    x: lc ? round2(lc.x) : 0,
    y: lc ? round2(lc.y) : 0,
    radius: lc ? round1(radiusFromMass(lc.mass)) : PLAYER_START_RADIUS,
    mass: Math.round(totalMass(p)),
    score: Math.round(p.score),
    swallowed: p.swallowed,
    swallowedBy: p.swallowedBy,
    color: p.color,
    logoIndex: p.logoIndex,
    alive: p.alive,
    monopolySupervised: !!p.monopolySupervised,
    shieldActive: activeUntil(p, 'shieldUntil'),
    cells: p.cells.map(c => ({
      id: c.id,
      x: round2(c.x),
      y: round2(c.y),
      mass: Math.round(c.mass),
      radius: round1(radiusFromMass(c.mass)),
    })),
  };
}

function personalState(p) {
  const now = Date.now();
  const effects = [];
  const push = (key, label, until) => {
    const remainingMs = Math.max(0, until - now);
    if (remainingMs > 0) effects.push({ key, label, remainingMs });
  };
  push('resourceBoost', 'x2 tài nguyên', p.effects?.resourceBoostUntil || 0);
  push('shield', 'Khiên bảo hộ', p.effects?.shieldUntil || 0);
  push('speedBoost', 'Tăng tốc', p.effects?.speedBoostUntil || 0);
  push('monopolySlow', 'Giảm tốc độc quyền', p.effects?.monopolySlowUntil || 0);
  push('noSwallow', 'Cấm thâu tóm', p.effects?.noSwallowUntil || 0);
  if (p.monopolySupervised) {
    effects.push({
      key: 'supervised',
      label: 'Bị giám sát độc quyền',
      remainingMs: Math.max(0, (p.monopolyPenaltyDueAt || now) - now),
    });
  }
  return { effects, monopolySupervised: !!p.monopolySupervised };
}

function publicState(includeResources = true) {
  const players = Object.values(game.players).map(serializePlayer);

  const leaderboard = players
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((p, idx) => ({
      rank: idx + 1,
      name: p.name,
      score: p.score,
      share: players.reduce((s, pp) => s + pp.mass, 0) ? Math.round((p.mass / players.reduce((s, pp) => s + pp.mass, 0)) * 100) : 0,
      color: p.color,
      logoIndex: p.logoIndex,
      alive: p.alive,
    }));

  const elapsed = elapsedMs();
  const remainingMs = game.gameStarted && game.startedAt
    ? Math.max(0, game.sessionDurationMs - elapsed)
    : game.sessionDurationMs;

  const ejected = game.ejected.map(e => ({
    id: e.id,
    x: Math.round(e.x),
    y: Math.round(e.y),
    mass: Math.round(e.mass),
    value: round1(ejectedScoreValue(e)),
    radius: round1(ejectedRadius(e.mass)),
    color: e.color,
    ownerId: e.ownerId,
  }));

  const payload = {
    seq: tickCount,
    serverTime: Date.now(),
    world: WORLD,
    phase: game.phase,
    phaseName: game.phaseName,
    running: game.running,
    gameStarted: game.gameStarted,
    gameEnded: game.gameEnded,
    elapsedMs: elapsed,
    remainingMs,
    sessionDurationMs: game.sessionDurationMs,
    joinUrl: getJoinUrl(game),
    players,
    ejected,
    spItems: game.spItems.map(item => ({
      id: item.id,
      type: item.type,
      label: item.label,
      x: Math.round(item.x),
      y: Math.round(item.y),
      position: { x: Math.round(item.x), y: Math.round(item.y) },
      radius: item.radius,
      rarity: item.rarity,
      effect: item.effect,
      duration: item.duration,
      spawnTime: item.spawnTime,
      expireTime: item.expireTime,
      color: item.color,
      icon: item.icon,
    })),
    pointBags: game.pointBags.map(bag => ({
      id: bag.id,
      type: bag.type,
      label: bag.label,
      x: Math.round(bag.x),
      y: Math.round(bag.y),
      position: { x: Math.round(bag.x), y: Math.round(bag.y) },
      radius: bag.radius,
      value: round1(bag.value),
      duration: bag.duration,
      spawnTime: bag.spawnTime,
      expireTime: bag.expireTime,
      color: bag.color,
    })),
    spDropCooldownMs: Math.max(0, SP_DROP_COOLDOWN_MS - (Date.now() - game.lastSpDropAt)),
    capturePoints: game.capturePoints.map(point => {
      const capturer = point.capturingPlayerId && game.players[point.capturingPlayerId];
      const progress = Math.min(100, Math.round((point.progressMs / CAPTURE_DURATION_MS) * 100));
      return {
        id: point.id,
        name: point.name,
        icon: point.icon,
        x: point.x,
        y: point.y,
        radius: point.radius,
        ownerPlayerId: point.ownerPlayerId,
        ownerPlayerName: point.ownerPlayerName,
        ownerColor: point.ownerColor,
        capturingPlayerId: point.capturingPlayerId,
        capturingPlayerName: capturer?.name || null,
        capturingColor: capturer?.color || null,
        progress,
        remainingMs: point.decaying
          ? Math.max(0, point.progressMs)
          : Math.max(0, CAPTURE_DURATION_MS - point.progressMs),
        contested: point.contested,
        decaying: point.decaying,
        rewardBasePoints: CAPTURE_REWARD_BASE_POINTS,
        rewardLevel: point.rewardLevel,
        maxRewardLevel: CAPTURE_MAX_REWARD_LEVEL,
        nextRewardPoints: point.rewardLevel < CAPTURE_MAX_REWARD_LEVEL
          ? Math.min(CAPTURE_MAX_REWARD_LEVEL, Math.floor(elapsed / CAPTURE_REWARD_LEVEL_INTERVAL_MS) + 1) * CAPTURE_REWARD_BASE_POINTS
          : CAPTURE_MAX_REWARD_LEVEL * CAPTURE_REWARD_BASE_POINTS,
        rewardIntervalMs: CAPTURE_REWARD_INTERVAL_MS,
        nextRewardMs: point.ownerPlayerId && point.lastRewardAt
          ? Math.max(0, CAPTURE_REWARD_INTERVAL_MS - (Date.now() - point.lastRewardAt))
          : null,
        status: point.contested ? 'contested' : point.decaying ? 'decaying' : point.capturingPlayerId ? 'capturing' : point.ownerPlayerId ? 'captured' : 'neutral',
      };
    }),
    leaderboard,
    events: game.events,
    metrics: game.metrics,
    playerCount: Object.keys(game.players).length,
    lan: cachedLan,
    preferredLan: cachedPreferredLan,
    port: PORT,
  };

  if (includeResources) {
    payload.resources = game.resources.map(r => ({
      id: r.id,
      type: r.type,
      color: r.color,
      radius: round1(r.radius),
      x: Math.round(r.x),
      y: Math.round(r.y),
    }));
  }

  return payload;
}

function insideArea(object, center, radius = PLAYER_AOI_RADIUS) {
  const x = Number(object?.x);
  const y = Number(object?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const extra = Math.max(0, Number(object.radius) || 0);
  const dx = x - center.x;
  const dy = y - center.y;
  return dx * dx + dy * dy <= (radius + extra) ** 2;
}

function serializedPlayerInsideArea(player, center, radius) {
  return (player.cells || []).some(cell => insideArea(cell, center, radius));
}

function playerStateFor(player, includeResources, sharedState = null) {
  const payload = { ...(sharedState || publicState(false)) };
  const center = player.alive && player.cells.length ? centroid(player) : { x: player.x || 0, y: player.y || 0 };
  const lc = largestCell(player);
  const radius = PLAYER_AOI_RADIUS + (lc ? radiusFromMass(lc.mass) : PLAYER_START_RADIUS);

  payload.players = payload.players.filter(other => other.id === player.id || serializedPlayerInsideArea(other, center, radius));
  payload.ejected = payload.ejected.filter(object => insideArea(object, center, radius));
  payload.spItems = payload.spItems.filter(object => insideArea(object, center, radius));
  payload.pointBags = payload.pointBags.filter(object => insideArea(object, center, radius));
  payload.aoi = { x: round2(center.x), y: round2(center.y), radius: round1(radius) };
  delete payload.lan;
  delete payload.preferredLan;
  delete payload.joinUrl;
  delete payload.spDropCooldownMs;
  delete payload.events;
  delete payload.metrics;
  delete payload.port;

  if (includeResources) {
    payload.resources = game.resources
      .filter(resource => insideArea(resource, center, radius))
      .map(resource => ({
        id: resource.id,
        type: resource.type,
        color: resource.color,
        radius: round1(resource.radius),
        x: Math.round(resource.x),
        y: Math.round(resource.y),
      }));
  }
  return payload;
}

io.on('connection', (socket) => {
  socket.emit('serverInfo', {
    port: PORT,
    lan: getLANAddresses(),
    world: WORLD,
  });

  socket.on('diagnostic:ping', (clientSentAt, acknowledge) => {
    if (typeof acknowledge === 'function') acknowledge({ clientSentAt, serverTime: Date.now() });
  });

  socket.on('host:status', () => {
    socket.emit('host:status', {
      status: hostAccess.deviceTokenHash ? 'occupied' : 'available',
      reconnectGraceMs: HOST_RECONNECT_GRACE_MS,
    });
  });

  socket.on('host:claim', (payload = {}) => {
    const pin = payload && typeof payload === 'object' ? payload.pin : '';
    if (!safeEqual(pin, HOST_PIN)) {
      socket.emit('host:denied', { code: 'INVALID_PIN', message: 'Mã PIN Host không đúng.' });
      return;
    }
    if (hostAccess.deviceTokenHash) {
      socket.emit('host:denied', { code: 'HOST_OCCUPIED', message: 'Một thiết bị khác đang giữ quyền Host.' });
      return;
    }
    const deviceToken = crypto.randomBytes(32).toString('hex');
    hostAccess.deviceTokenHash = hashHostToken(deviceToken);
    hostAccess.claimedAt = Date.now();
    io.emit('host:availability', { available: false });
    authorizeHostSocket(socket);
    socket.emit('host:token', { deviceToken });
  });

  socket.on('host:resume', (payload = {}) => {
    const deviceToken = payload && typeof payload === 'object' ? payload.deviceToken : '';
    if (!tokenOwnsHost(deviceToken)) {
      socket.emit('host:denied', {
        code: hostAccess.deviceTokenHash ? 'HOST_OCCUPIED' : 'TOKEN_EXPIRED',
        message: hostAccess.deviceTokenHash ? 'Một thiết bị khác đang giữ quyền Host.' : 'Phiên Host đã hết hạn.',
      });
      return;
    }
    if (hostAccess.connected && hostAccess.socketId !== socket.id) {
      const previousSocket = io.sockets.sockets.get(hostAccess.socketId);
      if (previousSocket) previousSocket.disconnect(true);
    }
    authorizeHostSocket(socket);
  });

  socket.on('host:release', (payload = {}) => {
    const deviceToken = payload && typeof payload === 'object' ? payload.deviceToken : '';
    if (!isAuthorizedHost(socket) || !tokenOwnsHost(deviceToken)) {
      socket.emit('host:denied', { code: 'NOT_AUTHORIZED', message: 'Bạn không có quyền giải phóng Host.' });
      return;
    }
    releaseHostLease();
    socket.emit('host:released');
  });

  function bindPlayer(player) {
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
    player.disconnectedAt = null;
    player.socketId = socket.id;
    socket.data.playerId = player.id;
    socket.join('players');
    socket.join(`player:${player.id}`);
  }

  socket.on('player:resume', (payload = {}) => {
    const resumeToken = payload && typeof payload === 'object' ? payload.resumeToken : '';
    const tokenHash = hashPlayerToken(resumeToken);
    const player = Object.values(game.players).find(p => p.resumeTokenHash && safeEqual(tokenHash, p.resumeTokenHash));
    if (!player) {
      socket.emit('player:resumeDenied', { message: 'Phiên người chơi không còn tồn tại.' });
      return;
    }
    if (player.socketId && player.socketId !== socket.id) {
      const previousSocket = io.sockets.sockets.get(player.socketId);
      if (previousSocket) previousSocket.disconnect(true);
    }
    bindPlayer(player);
    socket.emit('joined', { id: player.id, player: serializePlayer(player), world: WORLD, resumed: true });
  });

  socket.on('joinGame', (payload = {}) => {
    const { name, logoIndex, color } = payload && typeof payload === 'object' ? payload : {};
    if (socket.data.playerId && game.players[socket.data.playerId]) {
      socket.emit('joinDenied', { code: 'ALREADY_JOINED', message: 'Thiết bị này đã ở trong phòng.' });
      return;
    }
    if (game.gameStarted) {
      socket.emit('joinDenied', {
        code: 'GAME_ALREADY_STARTED',
        message: game.gameEnded
          ? 'Trận đấu đã kết thúc. Vui lòng chờ Host chọn Chơi lại.'
          : 'Phòng đang có trận đấu diễn ra. Vui lòng chờ Host bắt đầu lượt chơi mới.',
      });
      return;
    }
    if (Object.keys(game.players).length >= MAX_PLAYERS) {
      socket.emit('joinDenied', { code: 'ROOM_FULL', message: `Phòng đã đủ ${MAX_PLAYERS} người chơi.` });
      return;
    }
    const playerId = crypto.randomUUID();
    const resumeToken = crypto.randomBytes(32).toString('hex');
    const player = createPlayer(playerId, name, logoIndex, color);
    player.resumeTokenHash = hashPlayerToken(resumeToken);
    game.players[playerId] = player;
    bindPlayer(player);
    addEvent(`${player.name} gia nhập thị trường`, 'info');
    socket.emit('joined', { id: playerId, player: serializePlayer(player), world: WORLD, resumeToken });
  });

  socket.on('control', (payload = {}) => {
    const { x = 0, y = 0 } = payload && typeof payload === 'object' ? payload : {};
    const p = game.players[socket.data.playerId];
    if (!p || !game.gameStarted) return;
    p.mouseX = x;
    p.mouseY = y;
    const lc = largestCell(p);
    const refX = lc ? lc.x : p.x;
    const refY = lc ? lc.y : p.y;
    const dx = x - refX;
    const dy = y - refY;
    const len = Math.hypot(dx, dy);
    if (len > 0.05) {
      p.lastDirX = dx / len;
      p.lastDirY = dy / len;
    }
  });

  socket.on('action', (payload = {}) => {
    const action = payload && typeof payload === 'object' ? payload.action : '';
    const p = game.players[socket.data.playerId];
    if (!p || !game.gameStarted || !game.running || !p.alive) return;
    if (action === 'split') splitPlayer(p);
    if (action === 'eject') ejectMass(p);
  });

  socket.on('hostAction', (payload) => {
    if (!isAuthorizedHost(socket)) {
      socket.emit('host:denied', { code: 'NOT_AUTHORIZED', message: 'Bạn không có quyền Host.' });
      return;
    }
    const action = typeof payload === 'string' ? payload : payload?.action;
    const data = typeof payload === 'object' ? payload : {};

    if (action === 'startGame') {
      if (!game.gameStarted) {
        game.gameStarted = true;
        game.running = true;
        game.gameEnded = false;
        game.startedAt = Date.now();
        game.pausedAt = null;
        game.totalPausedMs = 0;
        game.manualPhaseOverride = false;
        game.resources = generateResources();
        game.ejected = [];
        addEvent('Trò chơi chính thức bắt đầu!', 'phase');
      }
    }
    if (action === 'nextPhase') nextPhase();
    if (action === 'dropSpItems') {
      if (!game.gameStarted || game.gameEnded) return;
      const ok = dropSpItems();
      if (!ok) socket.emit('notice', { message: 'Thả SP Item đang hồi chiêu', kind: 'warn', at: Date.now(), scope: 'host' });
    }
    if (action === 'pause') {
      if (!game.gameStarted) return;
      if (game.running) {
        game.running = false;
        game.pausedAt = Date.now();
      } else {
        const pauseDuration = game.pausedAt ? Date.now() - game.pausedAt : 0;
        game.totalPausedMs += pauseDuration;
        for (const point of game.capturePoints) {
          if (point.lastRewardAt) point.lastRewardAt += pauseDuration;
        }
        if (game.topLeaderSince) game.topLeaderSince += pauseDuration;
        for (const player of Object.values(game.players)) {
          if (player.monopolyPenaltyDueAt) player.monopolyPenaltyDueAt += pauseDuration;
        }
        game.pausedAt = null;
        game.running = true;
      }
      addEvent(game.running ? 'Tiếp tục trò chơi' : 'Tạm dừng trò chơi', 'info');
    }
    if (action === 'setJoinUrl') {
      const url = String(data.url || '').trim();
      game.customJoinUrl = url || null;
    }
    if (action === 'reset') {
      const customJoinUrl = game.customJoinUrl;
      const oldPlayers = Object.values(game.players).map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        logoIndex: p.logoIndex,
        socketId: p.socketId,
        resumeTokenHash: p.resumeTokenHash,
        disconnectedAt: p.disconnectedAt,
        disconnectTimer: p.disconnectTimer,
      }));
      game = createGame({ customJoinUrl });
      for (const old of oldPlayers) {
        const player = createPlayer(old.id, old.name, old.logoIndex, old.color);
        player.socketId = old.socketId;
        player.resumeTokenHash = old.resumeTokenHash;
        player.disconnectedAt = old.disconnectedAt;
        player.disconnectTimer = old.disconnectTimer;
        game.players[old.id] = player;
      }
      addEvent('Đã chơi lại từ đầu — đang chờ bắt đầu', 'warn');
    }
  });

  socket.on('disconnect', () => {
    if (hostAccess.socketId === socket.id) {
      hostAccess.connected = false;
      hostAccess.socketId = null;
      hostAccess.disconnectedAt = Date.now();
      cancelHostRelease();
      hostAccess.releaseTimer = setTimeout(() => {
        if (!hostAccess.connected && hostAccess.disconnectedAt) releaseHostLease();
      }, HOST_RECONNECT_GRACE_MS);
    }
    const playerId = socket.data.playerId;
    const player = game.players[playerId];
    if (player && player.socketId === socket.id) {
      player.socketId = null;
      player.disconnectedAt = Date.now();
      player.dirX = 0;
      player.dirY = 0;
      const reconnectGraceMs = game.gameStarted
        ? Math.max(PLAYER_RECONNECT_GRACE_MS, game.sessionDurationMs + 60 * 1000)
        : PLAYER_RECONNECT_GRACE_MS;
      player.disconnectTimer = setTimeout(() => {
        const current = game.players[playerId];
        if (current && !current.socketId && current.disconnectedAt) {
          addEvent(`${current.name} rời thị trường`, 'warn');
          delete game.players[playerId];
        }
      }, reconnectGraceMs);
    }
  });
});

let tickCount = 0;
let hostBroadcastCount = 0;
setInterval(() => {
  if (game.running && game.gameStarted) {
    updatePhaseByTime();
    const simulationPlayers = Object.values(game.players);
    const offset = simulationPlayers.length ? tickCount % simulationPlayers.length : 0;
    const simulationOrder = simulationPlayers.slice(offset).concat(simulationPlayers.slice(0, offset));
    tickResourceGrid = UniformSpatialGrid.from(game.resources);
    for (const p of simulationOrder) updatePlayer(p);
    tickResourceGrid = null;
    updateEjected();
    updateTemporaryObjects();
    tickEjectedGrid = UniformSpatialGrid.from(game.ejected);
    handleEjectedCollisions();
    tickEjectedGrid = null;
    handleSwallowing();
    updateCapturePoints();
    updateAutoMonopoly();
    updateMetrics();
    endMatchIfNeeded();
  }
  tickCount++;

  const activeGame = game.running && game.gameStarted;
  const playerEvery = activeGame ? PLAYER_NETWORK_EVERY : IDLE_NETWORK_EVERY;
  const networkPlayers = Object.values(game.players);
  const scheduledPlayers = networkPlayers.filter((_player, index) => (tickCount + index) % playerEvery === 0);
  if (scheduledPlayers.length) {
    const sharedState = publicState(false);
    for (const player of scheduledPlayers) {
      const includeResources = (player.networkSendCount || 0) % PLAYER_RESOURCE_EVERY === 0;
      io.to(`player:${player.id}`).volatile.emit('playerState', playerStateFor(player, includeResources, sharedState));
      player.networkSendCount = (player.networkSendCount || 0) + 1;
    }
  }

  const hostEvery = activeGame ? HOST_NETWORK_EVERY : IDLE_NETWORK_EVERY;
  if (tickCount % hostEvery === 0) {
    const includeResources = hostBroadcastCount % HOST_RESOURCE_EVERY === 0;
    io.to('hosts').volatile.emit('hostState', publicState(includeResources));
    hostBroadcastCount += 1;
  }

  const personalEvery = activeGame ? PERSONAL_STATE_EVERY : IDLE_NETWORK_EVERY;
  for (let index = 0; index < networkPlayers.length; index += 1) {
    if ((tickCount + index + 2) % personalEvery !== 0) continue;
    const player = networkPlayers[index];
    io.to(`player:${player.id}`).volatile.emit('personalState', personalState(player));
  }
}, 1000 / TICK_RATE);

server.listen(PORT, '0.0.0.0', () => {
  const lan = getLANAddresses();
  console.log(`\nMonopoly Market Arena running!`);
  console.log(`Host screen: http://localhost:${PORT}/host`);
  console.log(`Player screen: http://localhost:${PORT}/player`);
  if (lan.length) {
    console.log(`\nLocal network URLs:`);
    lan.forEach(ip => console.log(`Host:   http://${ip}:${PORT}/host\nPlayer: http://${ip}:${PORT}/player`));
  }
});
