const io = require('socket.io-client');

const URL = process.env.SMOKE_URL || 'http://127.0.0.1:3000';

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function joinClient(name) {
  const socket = io(URL, { transports: ['polling'] });
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 5000);
  });
  socket.emit('joinGame', { name, logoIndex: 0 });
  await new Promise((resolve) => {
    socket.once('joined', resolve);
  });
  return socket;
}

function waitState(socket, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('state timeout')), timeoutMs);
    socket.once('state', (s) => {
      clearTimeout(t);
      resolve(s);
    });
  });
}

async function main() {
  const host = await joinClient('HostSmoke');
  host.emit('hostAction', 'startGame');
  await wait(300);

  const a = await joinClient('PlayerA');
  await joinClient('PlayerB');
  await wait(400);

  let s = await waitState(a);
  let pa = s.players.find(p => p.name === 'PlayerA');
  if (!pa || pa.mass < 120) {
    throw new Error(`Need start mass >= 120 for smoke (set PLAYER_START_MASS=150). Got ${pa?.mass}`);
  }

  a.emit('control', { x: 1, y: 0 });
  a.emit('action', { action: 'eject' });
  await wait(400);
  s = await waitState(a);
  if (!(s.ejected?.length)) {
    throw new Error('Eject failed: no ejected mass');
  }
  console.log('OK eject:', s.ejected.length, 'blobs');

  a.emit('action', { action: 'split' });
  await wait(700);
  s = await waitState(a);
  pa = s.players.find(p => p.name === 'PlayerA');
  if (!pa || (pa.cells?.length || 0) < 2) {
    throw new Error(`Split failed: cells=${pa?.cells?.length}, mass=${pa?.mass}`);
  }
  console.log('OK split:', pa.cells.length, 'cells');

  for (let i = 0; i < 4; i++) {
    a.emit('action', { action: 'split' });
    await wait(700);
  }
  s = await waitState(a);
  pa = s.players.find(p => p.name === 'PlayerA');
  if ((pa.cells?.length || 0) > 4) {
    throw new Error(`Max cells exceeded: ${pa.cells.length}`);
  }
  console.log('OK max cells cap:', pa.cells.length);

  a.disconnect();
  host.disconnect();
  console.log('Smoke test passed');
  process.exit(0);
}

main().catch(err => {
  console.error('Smoke test failed:', err.message);
  process.exit(1);
});
