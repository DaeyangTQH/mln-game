  const express = require('express');
const http = require('http');
const os = require('os');
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
const RADIUS_GROWTH_SCALE = 1.5;       // ↑ lớn hơn = phình to nhanh hơn khi tăng mass
const RESOURCE_MASS_GAIN = 5;         // ↑ lớn hơn = ăn tài nguyên tăng quy mô nhanh hơn
const INFRA_PASSIVE_GAIN = 0.009;       // ↑ lớn hơn = thu nhập thụ động từ hạ tầng nhanh hơn
const SWALLOW_MASS_TRANSFER = 0.45;     // ↑ lớn hơn = thâu tóm đối thủ cho nhiều mass hơn
const RESOURCE_HITBOX_SCALE = 1.18;
const MONOPOLY_SHARE_WARNING = 0.45;
const MONOPOLY_SHARE_DANGER = 0.65;
const RESOURCE_SYNC_EVERY = 3;

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
    manualPhaseOverride: false,
    sessionDurationMs: MATCH_DURATION_MS,
    customJoinUrl: opts.customJoinUrl || null,
    players: {},
    resources: [],
    ejected: [],
    spItems: [],
    pointBags: [],
    lastSpDropAt: 0,
    topLeaderId: null,
    topLeaderSince: 0,
    infrastructures: [
      { id: 'grid', type: 'electricity', label: 'Lưới điện', x: WORLD.width * 0.34, y: WORLD.height * 0.5, radius: 110, ownerId: null, capturedAt: null, color: '#facc15' },
      { id: 'pipe', type: 'water', label: 'Đường ống nước', x: WORLD.width * 0.66, y: WORLD.height * 0.5, radius: 110, ownerId: null, capturedAt: null, color: '#38bdf8' },
    ],
    events: [],
    votes: {},
    metrics: {
      concentration: 0,
      topShare: 0,
      swallowed: 0,
      priceIndex: 100,
      citizenHappiness: 100,
      monopolyLevel: 'Thấp',
      infrastructureRisk: 'Chưa xuất hiện',
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
  return game.gameStarted && game.startedAt ? Date.now() - game.startedAt : 0;
}

function phaseForElapsed(ms) {
  if (ms < 2 * 60 * 1000) return { phase: 1, name: 'Cạnh tranh tự do' };
  if (ms < 7 * 60 * 1000) return { phase: 2, name: 'Tích tụ tư bản' };
  if (ms < 12 * 60 * 1000) return { phase: 3, name: 'Độc quyền' };
  if (ms < 13 * 60 * 1000) return { phase: 4, name: 'Chuyển tiếp điều tiết' };
  return { phase: 5, name: 'Độc quyền nhà nước' };
}

function updatePhaseByTime() {
  if (!game.gameStarted) return;
  if (game.manualPhaseOverride) return;
  const next = phaseForElapsed(elapsedMs());
  if (game.phase !== next.phase) {
    game.phase = next.phase;
    game.phaseName = next.name;
    if (game.phase === 5) game.votes = {};
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
  io.to(playerId).emit('notice', { message, kind, at: Date.now(), scope: 'personal' });
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

  for (const cell of p.cells) {
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
  p.respawnAt = Date.now() + 4200;
  p.monopolySupervised = false;
  p.monopolyPenaltyDueAt = 0;
  syncLegacyFields(p);
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
    for (let i = game.resources.length - 1; i >= 0; i--) {
      const r = game.resources[i];
      const d = Math.hypot(cell.x - r.x, cell.y - r.y);
      if (d < cr + resourceHitRadius(r)) {
        const mult = resourceMultiplier(p);
        cell.mass += r.value * RESOURCE_MASS_GAIN * mult;
        p.score += r.value * mult;
        game.resources.splice(i, 1);
        game.resources.push(newResource());
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

function handleInfra(p) {
  if (game.phase < 2) return;
  const c = centroid(p);
  const tm = totalMass(p);
  const pr = radiusFromMass(tm);

  for (const infra of game.infrastructures) {
    const d = Math.hypot(c.x - infra.x, c.y - infra.y);
    if (d < infra.radius + pr * 0.55) {
      if (infra.ownerId !== p.id && pr > 27) {
        infra.ownerId = p.id;
        infra.capturedAt = Date.now();
        addEvent(`${p.name} kiểm soát ${infra.label}`, infra.id === 'grid' ? 'electricity' : 'water');
      }
    }
    if (infra.ownerId === p.id && p.alive) {
      p.score += 0.02;
      const lc = largestCell(p);
      if (lc) lc.mass += INFRA_PASSIVE_GAIN;
      syncLegacyFields(p);
    }
  }
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
      for (let i = game.ejected.length - 1; i >= 0; i--) {
        const e = game.ejected[i];
        const er = ejectedRadius(e.mass);
        const d = Math.hypot(cell.x - e.x, cell.y - e.y);
        if (d < cr + er * 0.85) {
          cell.mass += e.mass;
          addScore(p, ejectedScoreValue(e));
          game.ejected.splice(i, 1);
        }
      }
    }
    syncLegacyFields(p);
  }
}

function handleSwallowing() {
  if (game.gameStarted && elapsedMs() < 2 * 60 * 1000) return;

  const alive = Object.values(game.players).filter(p => p.alive && p.cells.length);
  const allCells = [];
  for (const p of alive) {
    for (const c of p.cells) allCells.push({ cell: c, player: p });
  }

  for (let i = 0; i < allCells.length; i++) {
    for (let j = i + 1; j < allCells.length; j++) {
      const { cell: a, player: pa } = allCells[i];
      const { cell: b, player: pb } = allCells[j];
      if (pa.id === pb.id) continue;

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

      bigCell.mass += smallCell.mass * SWALLOW_MASS_TRANSFER;
      smallPlayer.cells = smallPlayer.cells.filter(c => c.id !== smallCell.id);

      if (!smallPlayer.cells.length) {
        bigPlayer.score += 18;
        bigPlayer.swallowed += 1;
        smallPlayer.swallowedBy += 1;
        game.metrics.swallowed += 1;
        addEvent(`${bigPlayer.name} thâu tóm ${smallPlayer.name}`, 'danger');
        killPlayer(smallPlayer);
        for (const infra of game.infrastructures) {
          if (infra.ownerId === smallPlayer.id) infra.ownerId = bigPlayer.id;
        }
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
  handleInfra(p);
  mergeCells(p);
}

function nextPhase() {
  game.manualPhaseOverride = true;
  if (game.phase < 5) game.phase += 1;
  else game.phase = 1;
  const names = {
    1: 'Cạnh tranh tự do',
    2: 'Độc quyền hạ tầng điện/nước',
    3: 'Chính sách: Bán hay không bán?',
  };
  names[4] = 'Chuyển tiếp điều tiết';
  names[5] = 'Độc quyền nhà nước';
  game.phaseName = names[game.phase];
  if (game.phase === 5) game.votes = {};
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

  const ownedInfra = game.infrastructures.filter(i => i.ownerId).length;
  let infraRisk = 'Chưa rõ';
  if (game.phase < 2) infraRisk = 'Chưa xuất hiện';
  else if (ownedInfra === 0) infraRisk = 'Thấp';
  else if (ownedInfra === 1) infraRisk = 'Cao';
  else infraRisk = 'Rất cao';

  const priceIndex = Math.round(100 + topShare * 78 + ownedInfra * 16);
  const citizenHappiness = Math.max(20, Math.round(100 - topShare * 50 - ownedInfra * 12));

  game.metrics = {
    ...game.metrics,
    concentration: Number(hhi.toFixed(3)),
    topShare: Number(topShare.toFixed(3)),
    topPlayer: top ? top.name : '-',
    priceIndex,
    citizenHappiness,
    monopolyLevel: level,
    infrastructureRisk: infraRisk,
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

  const voteCounts = { A: 0, B: 0, C: 0 };
  for (const option of Object.values(game.votes)) voteCounts[option] += 1;

  const grid = game.infrastructures.find(i => i.id === 'grid');
  const pipe = game.infrastructures.find(i => i.id === 'pipe');
  const gridOwner = grid?.ownerId && game.players[grid.ownerId] ? game.players[grid.ownerId].name : null;
  const pipeOwner = pipe?.ownerId && game.players[pipe.ownerId] ? game.players[pipe.ownerId].name : null;

  const elapsedMs = game.gameStarted && game.startedAt ? Date.now() - game.startedAt : 0;
  const remainingMs = game.gameStarted && game.startedAt
    ? Math.max(0, game.sessionDurationMs - elapsedMs)
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
    world: WORLD,
    phase: game.phase,
    phaseName: game.phaseName,
    running: game.running,
    gameStarted: game.gameStarted,
    gameEnded: game.gameEnded,
    elapsedMs,
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
    infrastructures: game.infrastructures.map(i => ({ ...i, ownerName: i.ownerId && game.players[i.ownerId] ? game.players[i.ownerId].name : null })),
    leaderboard,
    events: game.events,
    metrics: {
      ...game.metrics,
      gridOwner,
      pipeOwner,
    },
    voteCounts,
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

io.on('connection', (socket) => {
  socket.emit('serverInfo', {
    port: PORT,
    lan: getLANAddresses(),
    world: WORLD,
  });

  socket.on('joinGame', ({ name, logoIndex, color }) => {
    game.players[socket.id] = createPlayer(socket.id, name, logoIndex, color);
    addEvent(`${game.players[socket.id].name} gia nhập thị trường`, 'info');
    socket.emit('joined', { id: socket.id, player: serializePlayer(game.players[socket.id]), world: WORLD });
  });

  socket.on('control', ({ x = 0, y = 0 }) => {
    const p = game.players[socket.id];
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

  socket.on('action', ({ action }) => {
    const p = game.players[socket.id];
    if (!p || !game.gameStarted || !game.running || !p.alive) return;
    if (action === 'split') splitPlayer(p);
    if (action === 'eject') ejectMass(p);
  });

  socket.on('vote', ({ option }) => {
    const p = game.players[socket.id];
    if (!p || !['A', 'B', 'C'].includes(option)) return;
    game.votes[socket.id] = option;
    addEvent(`${p.name} vote phương án ${option}`, 'vote');
  });

  socket.on('hostAction', (payload) => {
    const action = typeof payload === 'string' ? payload : payload?.action;
    const data = typeof payload === 'object' ? payload : {};

    if (action === 'startGame') {
      if (!game.gameStarted) {
        game.gameStarted = true;
        game.running = true;
        game.gameEnded = false;
        game.startedAt = Date.now();
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
      game.running = !game.running;
      addEvent(game.running ? 'Tiếp tục trò chơi' : 'Tạm dừng trò chơi', 'info');
    }
    if (action === 'setJoinUrl') {
      const url = String(data.url || '').trim();
      game.customJoinUrl = url || null;
    }
    if (action === 'reset') {
      const customJoinUrl = game.customJoinUrl;
      const oldPlayers = Object.values(game.players).map(p => ({ id: p.id, name: p.name, color: p.color, logoIndex: p.logoIndex }));
      game = createGame({ customJoinUrl });
      for (const old of oldPlayers) {
        game.players[old.id] = createPlayer(old.id, old.name, old.logoIndex, old.color);
      }
      addEvent('Đã chơi lại từ đầu — đang chờ bắt đầu', 'warn');
    }
  });

  socket.on('disconnect', () => {
    if (game.players[socket.id]) {
      addEvent(`${game.players[socket.id].name} rời thị trường`, 'warn');
      delete game.players[socket.id];
      delete game.votes[socket.id];
    }
  });
});

let tickCount = 0;
setInterval(() => {
  if (game.running && game.gameStarted) {
    updatePhaseByTime();
    for (const p of Object.values(game.players)) updatePlayer(p);
    updateEjected();
    updateTemporaryObjects();
    handleEjectedCollisions();
    handleSwallowing();
    updateAutoMonopoly();
    updateMetrics();
    endMatchIfNeeded();
  }
  tickCount++;
  io.emit('state', publicState(tickCount % RESOURCE_SYNC_EVERY === 0));
  for (const p of Object.values(game.players)) {
    io.to(p.id).emit('personalState', personalState(p));
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
