window.GameSprites = (() => {
  const ASSET = {
    characters: '/assets/Characters/player-logos.png',
    items: '/assets/Items/resources.png',
    ui: '/assets/UI/policy-icons.png',
    buildings: '/assets/Buildings/decorations.png',
    tiles: {
      island: '/assets/Tiles/island-map.png',
    },
  };

  const SHEETS = {
    logos: { src: ASSET.characters, cols: 4, rows: 3 },
    icons: { src: ASSET.items, cols: 4, rows: 3 },
    policy: { src: ASSET.ui, cols: 4, rows: 4 },
    buildings: { src: ASSET.buildings, cols: 5, rows: 2 },
  };

  const LOGO_OPTIONS = [
    { id: 0, name: 'Tài chính' },
    { id: 1, name: 'Công nghệ' },
    { id: 2, name: 'Nước sạch' },
    { id: 3, name: 'Điện lực' },
    { id: 4, name: 'Đối tác' },
    { id: 5, name: 'Thành lũy' },
    { id: 6, name: 'Vương quốc' },
    { id: 7, name: 'Xanh hóa' },
    { id: 8, name: 'Hạ tầng' },
    { id: 9, name: 'Ngôi sao' },
    { id: 10, name: 'Tăng trưởng' },
    { id: 11, name: 'Doanh nghiệp' },
  ];

  const RESOURCE_SPRITE = {
    capital: 0,
    tech: 2,
    customer: 4,
    license: 6,
  };

  const RESOURCE_STYLE = {
    capital: { fill: 'rgba(250, 204, 21, .34)', ring: '#fde047', glow: 'rgba(250, 204, 21, .62)' },
    tech: { fill: 'rgba(45, 212, 191, .32)', ring: '#2dd4bf', glow: 'rgba(45, 212, 191, .58)' },
    customer: { fill: 'rgba(244, 114, 182, .30)', ring: '#f472b6', glow: 'rgba(244, 114, 182, .56)' },
    license: { fill: 'rgba(251, 146, 60, .34)', ring: '#fb923c', glow: 'rgba(251, 146, 60, .62)' },
  };

  const INFRA_SPRITE = {
    electricity: 8,
    water: 9,
  };

  const EXPLAIN_SPRITES = [
    { title: 'Vốn', sub: 'Tích tụ tư bản', sheet: 'policy', index: 14 },
    { title: 'Công nghệ', sub: 'Lực lượng sản xuất', sheet: 'icons', index: 2 },
    { title: 'Lưới điện', sub: 'Hạ tầng chiến lược', sheet: 'policy', index: 11 },
    { title: 'Đường ống', sub: 'Độc quyền tự nhiên', sheet: 'policy', index: 12 },
  ];

  // Đường kính logo / hitbox — dùng chung host & player
  const LOGO_DIAMETER_SCALE = 1.82;
  const RESOURCE_DIAMETER_SCALE = 2.35;
  // Nhân vật luôn chiếm ~21% chiều ngang màn player (giống Agar.io)
  const PLAYER_SCREEN_RADIUS_RATIO = 0.105;

  const MAP_DECORATIONS = [
    { sheet: 'buildings', index: 0, x: 360, y: 280, size: 110 },
    { sheet: 'buildings', index: 1, x: 620, y: 220, size: 120 },
    { sheet: 'buildings', index: 2, x: 1180, y: 260, size: 130 },
    { sheet: 'buildings', index: 3, x: 1580, y: 340, size: 125 },
    { sheet: 'buildings', index: 4, x: 480, y: 820, size: 115 },
    { sheet: 'buildings', index: 5, x: 900, y: 900, size: 105 },
    { sheet: 'buildings', index: 6, x: 1320, y: 180, size: 100 },
    { sheet: 'buildings', index: 7, x: 1680, y: 780, size: 118 },
    { sheet: 'buildings', index: 8, x: 260, y: 620, size: 112 },
    { sheet: 'buildings', index: 9, x: 1760, y: 520, size: 108 },
  ];

  const images = {};
  let ready = false;
  let loadPromise = null;

  function loadAll() {
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all(
      Object.entries(SHEETS).map(([, sheet]) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { images[sheet.src] = img; resolve(); };
        img.onerror = reject;
        img.src = sheet.src;
      }))
    ).then(() => { ready = true; });
    return loadPromise;
  }

  function frame(sheetName, index) {
    const sheet = SHEETS[sheetName];
    const image = images[sheet.src];
    if (!sheet || !image) return null;
    const col = index % sheet.cols;
    const row = Math.floor(index / sheet.cols);
    const sw = image.width / sheet.cols;
    const sh = image.height / sheet.rows;
    return { image, sx: col * sw, sy: row * sh, sw, sh };
  }

  function drawSprite(ctx, sheetName, index, x, y, size, opts = {}) {
    const f = frame(sheetName, index);
    if (!f) return;
    const { alpha = 1, rotation = 0 } = opts;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (rotation) {
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.translate(-x, -y);
    }
    ctx.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, x - size / 2, y - size / 2, size, size);
    ctx.restore();
  }

  function playerViewHalf(radius, screenMin = 400) {
    const r = Math.max(16, radius || 18);
    const half = r / (2 * PLAYER_SCREEN_RADIUS_RATIO);
    const maxHalf = Math.max(200, screenMin * 0.95);
    return Math.max(75, Math.min(maxHalf, half));
  }

  function drawPlayerWorld(ctx, player, x, y, radius, opts = {}) {
    const logoIndex = Number.isInteger(player.logoIndex) ? player.logoIndex : 0;
    const diameter = radius * LOGO_DIAMETER_SCALE;
    const clipR = radius * 1.04;
    ctx.save();
    ctx.globalAlpha = player.alive === false ? 0.28 : 1;
    ctx.beginPath();
    ctx.arc(x, y, clipR, 0, Math.PI * 2);
    ctx.clip();
    ctx.shadowColor = 'rgba(0,0,0,.4)';
    ctx.shadowBlur = 6;
    drawSprite(ctx, 'logos', logoIndex, x, y, diameter);
    ctx.shadowBlur = 0;
    if (opts.highlight) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(56,189,248,.95)';
      ctx.lineWidth = Math.max(2, radius * 0.08);
      ctx.arc(x, y, clipR + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlayerScreen(ctx, player, sx, sy, screenRadius, opts = {}) {
    const logoIndex = Number.isInteger(player.logoIndex) ? player.logoIndex : 0;
    const diameter = screenRadius * LOGO_DIAMETER_SCALE;
    const clipR = screenRadius * 1.04;
    ctx.save();
    ctx.globalAlpha = player.alive === false ? 0.28 : 1;
    ctx.beginPath();
    ctx.arc(sx, sy, clipR, 0, Math.PI * 2);
    ctx.clip();
    ctx.shadowColor = 'rgba(0,0,0,.4)';
    ctx.shadowBlur = 5;
    drawSprite(ctx, 'logos', logoIndex, sx, sy, diameter);
    ctx.shadowBlur = 0;
    if (opts.highlight) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(56,189,248,.95)';
      ctx.lineWidth = 2.5;
      ctx.arc(sx, sy, clipR + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlayer(ctx, player, x, y, radius, opts = {}) {
    drawPlayerWorld(ctx, player, x, y, radius, opts);
  }

  function drawResource(ctx, resource, x, y, radius) {
    const sprite = RESOURCE_SPRITE[resource.type] ?? 0;
    const size = Math.max(radius * RESOURCE_DIAMETER_SCALE, 12);
    const style = RESOURCE_STYLE[resource.type] || RESOURCE_STYLE.capital;
    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.ring;
    ctx.lineWidth = Math.max(1.5, radius * 0.18);
    ctx.shadowColor = style.glow;
    ctx.shadowBlur = Math.max(5, radius * 0.7);
    ctx.arc(x, y, radius * 1.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowColor = 'rgba(0,0,0,.5)';
    ctx.shadowBlur = 4;
    drawSprite(ctx, 'icons', sprite, x, y, size);
    ctx.restore();
  }

  function drawResourceScreen(ctx, resource, sx, sy, screenRadius, opts = {}) {
    const sprite = RESOURCE_SPRITE[resource.type] ?? 0;
    const size = Math.max(screenRadius * RESOURCE_DIAMETER_SCALE, 8);
    const style = RESOURCE_STYLE[resource.type] || RESOURCE_STYLE.capital;
    const lite = opts.lite; // bỏ shadowBlur khi vẽ số lượng lớn (màn host) để giữ FPS
    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.ring;
    ctx.lineWidth = Math.max(1.5, screenRadius * 0.18);
    if (!lite) {
      ctx.shadowColor = style.glow;
      ctx.shadowBlur = Math.max(5, screenRadius * 0.7);
    }
    ctx.arc(sx, sy, screenRadius * 1.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (!lite) {
      ctx.shadowColor = 'rgba(0,0,0,.5)';
      ctx.shadowBlur = 4;
    }
    drawSprite(ctx, 'icons', sprite, sx, sy, size);
    ctx.restore();
  }

  function drawInfrastructure(ctx, infra, x, y, radius) {
    const sprite = INFRA_SPRITE[infra.type] ?? 8;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.4)';
    ctx.shadowBlur = 6;
    drawSprite(ctx, 'icons', sprite, x, y, radius * 1.35);
    ctx.shadowBlur = 0;
    ctx.font = `800 ${Math.max(11, radius * 0.28)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,.75)';
    ctx.lineWidth = 3;
    ctx.strokeText(infra.label, x, y + radius + 18);
    ctx.fillText(infra.label, x, y + radius + 18);
    if (infra.ownerName) {
      ctx.fillStyle = infra.color;
      ctx.font = `700 ${Math.max(10, radius * 0.22)}px sans-serif`;
      ctx.fillText(`Kiểm soát: ${infra.ownerName}`, x, y + radius + 38);
    }
    ctx.restore();
  }

  // Bộ đệm snapshot để nội suy vị trí (chống giật khi server chỉ gửi 30Hz)
  function createSnapshotBuffer(options = {}) {
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const delay = options.delay ?? 80;
    const max = options.max ?? 16;
    const snapThreshold = options.snap ?? 300;
    const snapSq = snapThreshold * snapThreshold;
    const buffer = [];

    function push(players) {
      buffer.push({ t: now(), players: players || [] });
      if (buffer.length > max) buffer.shift();
    }

    function sample(nowTs) {
      const t = (nowTs ?? now()) - delay;
      if (buffer.length === 0) return [];
      if (buffer.length === 1) return buffer[0].players;

      let older = buffer[0];
      let newer = buffer[buffer.length - 1];
      if (t >= newer.t) {
        older = buffer[buffer.length - 2];
      } else {
        for (let i = 0; i < buffer.length - 1; i++) {
          if (buffer[i].t <= t && buffer[i + 1].t >= t) { older = buffer[i]; newer = buffer[i + 1]; break; }
        }
      }

      const span = newer.t - older.t || 1;
      let alpha = (t - older.t) / span;
      alpha = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;

      const olderById = new Map();
      for (const p of older.players) olderById.set(p.id, p);

      return newer.players.map((np) => {
        const op = olderById.get(np.id);
        if (!op) return np;
        const dx = np.x - op.x;
        const dy = np.y - op.y;
        // Nhảy quá xa (respawn/teleport) → không nội suy để tránh trượt ngang màn
        if (dx * dx + dy * dy > snapSq) return np;
        return {
          ...np,
          x: op.x + dx * alpha,
          y: op.y + dy * alpha,
          radius: op.radius + (np.radius - op.radius) * alpha,
        };
      });
    }

    function reset() { buffer.length = 0; }

    return { push, sample, reset };
  }

  function buildLogoPicker(container, onSelect, initial = 0) {
    container.innerHTML = '';
    let selected = initial;
    LOGO_OPTIONS.forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'logo-option' + (opt.id === selected ? ' selected' : '');
      btn.title = opt.name;
      btn.dataset.logo = opt.id;
      btn.addEventListener('click', () => {
        selected = opt.id;
        container.querySelectorAll('.logo-option').forEach(el => el.classList.toggle('selected', Number(el.dataset.logo) === selected));
        onSelect(selected);
      });
      container.appendChild(btn);
    });
    return () => selected;
  }

  return {
    ASSET,
    SHEETS,
    LOGO_OPTIONS,
    EXPLAIN_SPRITES,
    MAP_DECORATIONS,
    RESOURCE_SPRITE,
    RESOURCE_STYLE,
    LOGO_DIAMETER_SCALE,
    RESOURCE_DIAMETER_SCALE,
    PLAYER_SCREEN_RADIUS_RATIO,
    loadAll,
    isReady: () => ready,
    drawSprite,
    drawPlayer,
    drawPlayerWorld,
    drawPlayerScreen,
    drawResource,
    drawResourceScreen,
    drawInfrastructure,
    buildLogoPicker,
    createSnapshotBuffer,
    playerViewHalf,
    frame,
  };
})();
