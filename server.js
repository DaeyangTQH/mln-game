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
const WORLD = { width: 4096, height: 2304 };
const TICK_RATE = 30;
const MAX_SPEED = 6.2;
const RESOURCE_COUNT = 680;
const PLAYER_START_RADIUS = 18;
const PLAYER_START_MASS = 90;
const RADIUS_GROWTH_SCALE = 1.25;
const RESOURCE_MASS_GAIN = 3.2;
const INFRA_PASSIVE_GAIN = 0.006;
const SWALLOW_MASS_TRANSFER = 0.24;
const RESOURCE_HITBOX_SCALE = 1.18;
const MOVEMENT_ACCELERATION = 0.32;
const MOVEMENT_FRICTION = 0.72;
const MONOPOLY_SHARE_WARNING = 0.45;
const MONOPOLY_SHARE_DANGER = 0.65;
// Tài nguyên gần như tĩnh → chỉ gửi lại mỗi vài tick để tiết kiệm băng thông
const RESOURCE_SYNC_EVERY = 3;

const round1 = (n) => Math.round(n * 10) / 10;

const resourceTypes = [
  { type: 'capital', label: 'Vốn', value: 2.2, color: '#f6c85f', weight: 0.38 },
  { type: 'tech', label: 'Công nghệ', value: 3.2, color: '#7bdff2', weight: 0.22 },
  { type: 'customer', label: 'Khách hàng', value: 2.6, color: '#b2f7ef', weight: 0.3 },
  { type: 'license', label: 'Giấy phép', value: 4.5, color: '#ff9f1c', weight: 0.1 },
];

const LOGO_COUNT = 12;

const palette = [
  '#FDE68A', '#93C5FD', '#86EFAC', '#FCA5A5', '#C4B5FD', '#67E8F9',
  '#FDA4AF', '#FDBA74', '#A7F3D0', '#DDD6FE', '#BFDBFE', '#FBCFE8'
];

let game = createGame();

// Địa chỉ LAN gần như không đổi → cache thay vì quét mỗi tick (30 lần/giây)
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
    startedAt: null,
    sessionDurationMs: 5 * 60 * 1000,
    customJoinUrl: opts.customJoinUrl || null,
    players: {},
    resources: [],
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

function getJoinUrl(game) {
  if (game.customJoinUrl) return game.customJoinUrl;
  const ip = cachedPreferredLan;
  const base = ip ? `http://${ip}:${PORT}` : `http://localhost:${PORT}`;
  return `${base}/player`;
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

function radiusFromMass(mass) {
  const growth = Math.max(0, Math.sqrt(mass) - Math.sqrt(PLAYER_START_MASS));
  return PLAYER_START_RADIUS + growth * RADIUS_GROWTH_SCALE;
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

function createPlayer(socketId, name, logoIndex = 0) {
  const spawn = randomSpawn();
  const index = Object.keys(game.players).length;
  const safeLogo = Number.isInteger(logoIndex) ? Math.max(0, Math.min(LOGO_COUNT - 1, logoIndex)) : 0;
  return {
    id: socketId,
    name: safeName(name),
    logoIndex: safeLogo,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    dirX: 0,
    dirY: 0,
    radius: PLAYER_START_RADIUS,
    mass: PLAYER_START_MASS,
    score: 0,
    swallowed: 0,
    swallowedBy: 0,
    color: palette[index % palette.length],
    alive: true,
    respawnAt: 0,
    joinedAt: Date.now(),
  };
}

function addEvent(message, severity = 'info') {
  game.events.unshift({ id: Date.now() + Math.random(), message, severity, at: Date.now() });
  game.events = game.events.slice(0, 12);
}

io.on('connection', (socket) => {
  socket.emit('serverInfo', {
    port: PORT,
    lan: getLANAddresses(),
    world: WORLD,
  });

  socket.on('joinGame', ({ name, logoIndex }) => {
    game.players[socket.id] = createPlayer(socket.id, name, logoIndex);
    addEvent(`${game.players[socket.id].name} gia nhập thị trường`, 'info');
    socket.emit('joined', { id: socket.id, player: game.players[socket.id], world: WORLD });
  });

  socket.on('control', ({ x = 0, y = 0 }) => {
    const p = game.players[socket.id];
    if (!p || !game.gameStarted) return;
    const len = Math.hypot(x, y);
    if (len < 0.05) {
      p.dirX = 0;
      p.dirY = 0;
      return;
    }
    p.dirX = x / len;
    p.dirY = y / len;
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
        game.startedAt = Date.now();
        game.resources = generateResources();
        addEvent('Trò chơi chính thức bắt đầu!', 'phase');
      }
    }
    if (action === 'nextPhase') nextPhase();
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
        game.players[old.id] = { ...createPlayer(old.id, old.name, old.logoIndex), color: old.color };
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

function nextPhase() {
  if (game.phase < 3) game.phase += 1;
  else game.phase = 1;
  const names = {
    1: 'Cạnh tranh tự do',
    2: 'Độc quyền hạ tầng điện/nước',
    3: 'Chính sách: Bán hay không bán?',
  };
  game.phaseName = names[game.phase];
  if (game.phase === 3) game.votes = {};
  addEvent(`Chuyển sang giai đoạn ${game.phase}: ${game.phaseName}`, 'phase');
}

function updatePlayer(p) {
  if (!game.gameStarted || !game.running) return;
  if (!p.alive) {
    if (Date.now() > p.respawnAt) {
      const spawn = randomSpawn();
      p.x = spawn.x;
      p.y = spawn.y;
      p.radius = PLAYER_START_RADIUS;
      p.mass = PLAYER_START_MASS;
      p.alive = true;
      p.dirX = 0;
      p.dirY = 0;
    }
    return;
  }

  const speed = Math.max(2.1, MAX_SPEED - p.radius / 28);
  const targetVx = p.dirX * speed;
  const targetVy = p.dirY * speed;
  const smoothing = p.dirX || p.dirY ? MOVEMENT_ACCELERATION : 1 - MOVEMENT_FRICTION;
  p.vx += (targetVx - p.vx) * smoothing;
  p.vy += (targetVy - p.vy) * smoothing;
  if (!p.dirX && Math.abs(p.vx) < 0.03) p.vx = 0;
  if (!p.dirY && Math.abs(p.vy) < 0.03) p.vy = 0;
  p.x = Math.max(p.radius, Math.min(WORLD.width - p.radius, p.x + p.vx));
  p.y = Math.max(p.radius, Math.min(WORLD.height - p.radius, p.y + p.vy));

  for (let i = game.resources.length - 1; i >= 0; i--) {
    const r = game.resources[i];
    const d = Math.hypot(p.x - r.x, p.y - r.y);
    if (d < p.radius + resourceHitRadius(r)) {
      p.mass += r.value * RESOURCE_MASS_GAIN;
      p.score += r.value;
      p.radius = radiusFromMass(p.mass);
      game.resources.splice(i, 1);
      game.resources.push(newResource());
    }
  }

  if (game.phase >= 2) {
    for (const infra of game.infrastructures) {
      const d = Math.hypot(p.x - infra.x, p.y - infra.y);
      if (d < infra.radius + p.radius * 0.55) {
        if (infra.ownerId !== p.id && p.radius > 27) {
          infra.ownerId = p.id;
          infra.capturedAt = Date.now();
          addEvent(`${p.name} kiểm soát ${infra.label}`, infra.id === 'grid' ? 'electricity' : 'water');
        }
      }
      if (infra.ownerId === p.id && p.alive) {
        p.score += 0.02;
        p.mass += INFRA_PASSIVE_GAIN;
        p.radius = radiusFromMass(p.mass);
      }
    }
  }
}

function handleSwallowing() {
  const players = Object.values(game.players).filter(p => p.alive);
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < Math.max(a.radius, b.radius) * 0.82) {
        let big = null;
        let small = null;
        if (a.radius > b.radius * 1.18) { big = a; small = b; }
        if (b.radius > a.radius * 1.18) { big = b; small = a; }
        if (big && small) {
          big.mass += small.mass * SWALLOW_MASS_TRANSFER;
          big.radius = radiusFromMass(big.mass);
          big.score += 18;
          big.swallowed += 1;
          small.swallowedBy += 1;
          small.alive = false;
          small.respawnAt = Date.now() + 4200;
          game.metrics.swallowed += 1;
          addEvent(`${big.name} thâu tóm ${small.name}`, 'danger');

          for (const infra of game.infrastructures) {
            if (infra.ownerId === small.id) infra.ownerId = big.id;
          }
        }
      }
    }
  }
}

function updateMetrics() {
  const alivePlayers = Object.values(game.players).filter(p => p.alive);
  const totalMass = alivePlayers.reduce((s, p) => s + p.mass, 0) || 1;
  const sorted = alivePlayers.slice().sort((a, b) => b.mass - a.mass);
  const top = sorted[0];
  const topShare = top ? top.mass / totalMass : 0;
  const hhi = alivePlayers.reduce((s, p) => s + Math.pow(p.mass / totalMass, 2), 0);

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

function publicState(includeResources = true) {
  const players = Object.values(game.players).map(p => ({
    id: p.id,
    name: p.name,
    x: Math.round(p.x),
    y: Math.round(p.y),
    radius: round1(p.radius),
    mass: Math.round(p.mass),
    score: Math.round(p.score),
    swallowed: p.swallowed,
    swallowedBy: p.swallowedBy,
    color: p.color,
    logoIndex: p.logoIndex,
    alive: p.alive,
  }));

  const leaderboard = players
    .slice()
    .sort((a, b) => b.mass - a.mass)
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

  const payload = {
    world: WORLD,
    phase: game.phase,
    phaseName: game.phaseName,
    running: game.running,
    gameStarted: game.gameStarted,
    elapsedMs,
    remainingMs,
    sessionDurationMs: game.sessionDurationMs,
    joinUrl: getJoinUrl(game),
    players,
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

let tickCount = 0;
setInterval(() => {
  if (game.running && game.gameStarted) {
    for (const p of Object.values(game.players)) updatePlayer(p);
    handleSwallowing();
    updateMetrics();
  }
  tickCount++;
  io.emit('state', publicState(tickCount % RESOURCE_SYNC_EVERY === 0));
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
