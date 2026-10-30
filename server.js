'use strict';
require('dotenv').config();

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(__dirname));

// ---------- Admin Şifresi ----------
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// ---------- Sekme Bazlı Çoklu Açılış Engelleme ----------
const activeSessions = new Set();
const CHAT_HISTORY_LIMIT = 40;
const chatHistory = [];
const mutedPlayers = new Set();

// ---------- Saha ve oyun sabitleri ----------
const W = 1500, H = 750;
const GD = 45;
const GY1 = H / 2 - 110, GY2 = H / 2 + 110;
const POST = 7;
const PR = 15, BR = 10;
const MAX = 10;
const LIMIT = 5;
const MATCH_TICKS = 5 * 60 * 60;
const STEP = 1000 / 60;
const KICK = 11.5, KICK_RANGE = 13.5, E = 0.5;
const POSTS = [[0, GY1], [0, GY2], [W, GY1], [W, GY2]];
const SX = [
  W / 2 - 100, W / 2 - 200, W / 2 - 200,
  W / 2 - 320, W / 2 - 320, W / 2 - 320,
  W / 2 - 420, W / 2 - 420, W / 2 - 420, 100
];
const SY = [
  H / 2, H / 2 - 120, H / 2 + 120,
  H / 2 - 180, H / 2, H / 2 + 180,
  H / 2 - 220, H / 2, H / 2 + 220, H / 2
];

// ---------- Oyuncu fizik ayarları ----------
const PLAYER_CONFIG = {
  radius: 24.5,
  acceleration: 0.37,
  damping: 0.88,
  maxSpeed: 7.0
};

// ---------- Oyun durumu ----------
const players = new Map();
const ball = {
  x: W / 2, y: H / 2, vx: 0, vy: 0,
  r: BR, im: 1, d: 0.98, lastTouch: null
};
let nid = 0, ord = 0, cnt = [0, 0, 0];
let sc = [0, 0], tl = MATCH_TICKS, ot = false;
let ph = 0, pt = 0, winner = 0, scorer = '';

// ---------- Modifier Çarkı ----------
// Süper Kalkan tamamen kaldırıldı.
const MODIFIERS = [
  'fire', 'speed', 'giant', 'reverse', 'magnet', 'invisible', 'lowgravity'
];

let activeModifier = null;
let wheelPaused = false;
let wheelSequence = 0;
let invisibleStartTime = null;

function setModifier(modifier) {
  activeModifier = modifier;
  invisibleStartTime = null;
  ball.r = modifier === 'giant' ? BR * 1.65 : BR;

  io.emit('modifier_state', { modifier: activeModifier });
}

const list = team => [...players.values()]
  .filter(player => player.t === team)
  .sort((a, b) => a.ord - b.ord);

function slot(player) {
  const index = list(player.t).indexOf(player);
  if (index < 0 || index >= MAX) return;
  player.x = player.t === 1 ? SX[index] : W - SX[index];
  player.y = SY[index];
  player.vx = player.vy = 0;
}

function kickoff() {
  ball.x = W / 2;
  ball.y = H / 2;
  ball.vx = ball.vy = 0;
  ball.lastTouch = null;
  players.forEach(player => { if (player.t) slot(player); });
}

function roster() {
  cnt = [0, 0, 0];
  players.forEach(player => cnt[player.t]++);
  io.emit('r', [...players.values()].map(player => [player.id, player.n, player.t]));
}

function move(player, team) {
  player.t = team;
  slot(player);
}

function rebalance() {
  for (let guard = 0; guard < 40; guard++) {
    const red = list(1).length;
    const blue = list(2).length;
    const smallerTeam = red <= blue ? 1 : 2;
    const smallerCount = smallerTeam === 1 ? red : blue;
    const spectator = list(0)[0];

    if (spectator && smallerCount < MAX) {
      move(spectator, smallerTeam);
    } else if (Math.abs(red - blue) >= 2) {
      const larger = list(red > blue ? 1 : 2);
      move(larger[larger.length - 1], smallerTeam);
    } else {
      break;
    }
  }
}

// ---------- Fizik ----------
function bounds(object) {
  const radius = object.r;
  const inGoal = object.y > GY1 && object.y < GY2;
  const x0 = inGoal ? -GD + radius : radius;
  const x1 = inGoal ? W + GD - radius : W - radius;

  if (object.x < x0) {
    object.x = x0;
    if (object.vx < 0) object.vx *= -E;
  } else if (object.x > x1) {
    object.x = x1;
    if (object.vx > 0) object.vx *= -E;
  }

  const inNet = object.x < 0 || object.x > W;
  const y0 = inNet ? GY1 + radius : radius;
  const y1 = inNet ? GY2 - radius : H - radius;

  if (object.y < y0) {
    object.y = y0;
    if (object.vy < 0) object.vy *= -E;
  } else if (object.y > y1) {
    object.y = y1;
    if (object.vy > 0) object.vy *= -E;
  }

  for (const [px, py] of POSTS) {
    const dx = object.x - px;
    const dy = object.y - py;
    const distance = Math.hypot(dx, dy);
    const minimum = object.r + POST;

    if (distance < minimum && distance > 0) {
      const nx = dx / distance;
      const ny = dy / distance;
      object.x = px + nx * minimum;
      object.y = py + ny * minimum;
      const normalVelocity = object.vx * nx + object.vy * ny;

      if (normalVelocity < 0) {
        object.vx -= (1 + E) * normalVelocity * nx;
        object.vy -= (1 + E) * normalVelocity * ny;
      }
    }
  }
}

function collide(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  const minimum = a.r + b.r;

  if (distance >= minimum || distance === 0) return;
  if (a.n && b === ball) ball.lastTouch = a.n;

  const nx = dx / distance;
  const ny = dy / distance;
  const inverseMass = a.im + b.im;
  const overlap = minimum - distance;

  a.x -= nx * overlap * a.im / inverseMass;
  a.y -= ny * overlap * a.im / inverseMass;
  b.x += nx * overlap * b.im / inverseMass;
  b.y += ny * overlap * b.im / inverseMass;

  const relativeVelocity = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (relativeVelocity < 0) {
    const impulse = -(1 + E) * relativeVelocity / inverseMass;
    a.vx -= impulse * a.im * nx;
    a.vy -= impulse * a.im * ny;
    b.vx += impulse * b.im * nx;
    b.vy += impulse * b.im * ny;
  }
}

function endMatch() {
  ph = 2;
  pt = 420;
  winner = sc[0] > sc[1] ? 1 : 2;
}

function step() {
  if (wheelPaused) return;

  const activePlayers = [];
  players.forEach(player => {
    if (!player.t) return;
    activePlayers.push(player);

    let ix = (player.in & 8 ? 1 : 0) - (player.in & 4 ? 1 : 0);
    let iy = (player.in & 2 ? 1 : 0) - (player.in & 1 ? 1 : 0);

    if (activeModifier === 'reverse') {
      ix = -ix;
      iy = -iy;
    }

    const length = Math.hypot(ix, iy);
    if (length) {
      ix /= length;
      iy /= length;
    }

    const speedMultiplier = activeModifier === 'speed' ? 1.45 : 1;
    const acceleration = PLAYER_CONFIG.acceleration * speedMultiplier;
    player.vx += ix * acceleration;
    player.vy += iy * acceleration;
  });

  // Mıknatıs: topu yakınındaki oyuncuya doğru çeker.
  if (activeModifier === 'magnet' && activePlayers.length) {
    let nearest = null;
    let nearestDistance = Infinity;

    for (const player of activePlayers) {
      const dx = player.x - ball.x;
      const dy = player.y - ball.y;
      const distance = Math.hypot(dx, dy);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = { dx, dy, distance };
      }
    }

    if (nearest && nearest.distance > 0 && nearest.distance < 260) {
      ball.vx += nearest.dx / nearest.distance * 0.16;
      ball.vy += nearest.dy / nearest.distance * 0.16;
    }
  }

  [ball, ...activePlayers].forEach(object => {
    object.x += object.vx;
    object.y += object.vy;

    const damping = object === ball && activeModifier === 'lowgravity'
      ? 0.995
      : (object.d !== undefined ? object.d : PLAYER_CONFIG.damping);

    object.vx *= damping;
    object.vy *= damping;
  });

  activePlayers.forEach(player => {
    if (player.in & 16) {
      if (!player.lock) {
        const dx = ball.x - player.x;
        const dy = ball.y - player.y;
        const distance = Math.hypot(dx, dy);

        if (distance > 0 && distance <= PR + BR + KICK_RANGE) {
          const angle = Math.atan2(dy, dx);
          const kickMultiplier = activeModifier === 'fire' ? 1.75 : 1;
          ball.vx += Math.cos(angle) * KICK * kickMultiplier;
          ball.vy += Math.sin(angle) * KICK * kickMultiplier;
          player.lock = true;
          ball.lastTouch = player.n;
          io.emit('k', player.id);
        }
      }
    } else {
      player.lock = false;
    }
  });

  for (let i = 0; i < activePlayers.length; i++) {
    collide(activePlayers[i], ball);
    for (let j = i + 1; j < activePlayers.length; j++) {
      collide(activePlayers[i], activePlayers[j]);
    }
  }

  activePlayers.forEach(bounds);
  bounds(ball);

  if (ph === 0) {
    if (!ot && --tl <= 0) {
      tl = 0;
      if (sc[0] !== sc[1]) endMatch();
      else ot = true;
    }

    if (ph === 0) {
      const goalTeam = ball.x < 0 ? 2 : ball.x > W ? 1 : 0;
      if (goalTeam) {
        sc[goalTeam - 1]++;
        winner = goalTeam;
        scorer = ball.lastTouch || '';
        const totalGoals = sc[0] + sc[1];

        if (totalGoals % 2 === 0) {
          const index = Math.floor(Math.random() * MODIFIERS.length);
          const modifier = MODIFIERS[index];
          const sequence = ++wheelSequence;

          wheelPaused = true;
          setModifier(modifier);

          io.emit('modifier_wheel', {
            modifier,
            index,
            goalCount: totalGoals,
            duration: 1500
          });

          setTimeout(() => {
            if (sequence !== wheelSequence) return;
            wheelPaused = false;
            if (modifier === 'invisible') invisibleStartTime = Date.now();
            io.emit('modifier_applied', { modifier, goalCount: totalGoals });
          }, 1500);
        } else {
          setModifier(null);
        }

        if (ot || sc[goalTeam - 1] >= LIMIT) {
          endMatch();
        } else {
          ph = 1;
          pt = 150;
        }
      }
    }
  } else if (--pt <= 0) {
    if (ph === 2) {
      sc = [0, 0];
      tl = MATCH_TICKS;
      ot = false;
      setModifier(null);
      wheelPaused = false;
      wheelSequence++;
    }
    ph = 0;
    kickoff();
  }
}

const round1 = value => Math.round(value * 10) / 10;

function snapshot() {
  const positions = [];
  players.forEach(player => {
    if (player.t) positions.push([
      player.id, round1(player.x), round1(player.y), player.in & 16 ? 1 : 0
    ]);
  });

  const ballVisible = activeModifier !== 'invisible' ||
    invisibleStartTime === null ||
    (Date.now() - invisibleStartTime) % 5000 < 1500;

  io.volatile.emit('s', {
    ballVisible,
    p: positions,
    b: [round1(ball.x), round1(ball.y)],
    s: sc,
    t: Math.ceil(tl / 60),
    ph,
    w: winner,
    ot,
    sc_name: scorer,
    mod: activeModifier,
    br: ball.r
  });
}

let last = Date.now();
let accumulator = 0;
setInterval(() => {
  const now = Date.now();
  accumulator = Math.min(accumulator + now - last, 100);
  last = now;

  let ticks = 0;
  while (accumulator >= STEP) {
    step();
    accumulator -= STEP;
    ticks++;
  }
  if (ticks) snapshot();
}, 4);

// ---------- Bağlantılar ----------
io.on('connection', socket => {
  let playerRef = null;
  const token = typeof socket.handshake.query.token === 'string'
    ? socket.handshake.query.token
    : null;

  // Aynı sekme token'ı ile ikinci bağlantıyı engelle.
  if (token && activeSessions.has(token)) {
    socket.disconnect(true);
    return;
  }
  if (token) {
    activeSessions.add(token);
    socket.clientToken = token;
  }

  socket.emit('init', { W, H, GD, GY1, GY2, POST, PR, BR, LIMIT });
  roster();

  // Oyuncu yalnızca katıl butonuna basınca oluşturulur.
  socket.on('join_game', nickname => {
    if (playerRef) return;

    let cleanNick = typeof nickname === 'string'
      ? nickname.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 14)
      : '';
    if (!cleanNick) {
      cleanNick = 'Oyuncu' + (1000 + Math.floor(Math.random() * 9000));
    }

    playerRef = {
      id: ++nid,
      n: cleanNick,
      t: 0,
      ord: ++ord,
      x: 0, y: 0, vx: 0, vy: 0,
      r: PR, im: 0.5, d: PLAYER_CONFIG.damping,
      in: 0, lock: false, lastChatAt: 0
    };

    players.set(socket.id, playerRef);
    socket.emit('joined_success', { id: playerRef.id });
    socket.emit('chat_history', chatHistory);
    rebalance();
    roster();
  });

  socket.on('in', value => {
    if (playerRef) playerRef.in = (Number(value) | 0) & 31;
  });

  socket.on('nick', nickname => {
    if (!playerRef || typeof nickname !== 'string') return;
    const cleanNick = nickname.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 14);
    if (cleanNick) {
      playerRef.n = cleanNick;
      roster();
    }
  });

  socket.on('chat_send', rawMessage => {
    if (!playerRef || !playerRef.t || mutedPlayers.has(playerRef.id)) return;
    const now = Date.now();
    if (now - playerRef.lastChatAt < 700) return;
    if (typeof rawMessage !== 'string') return;
    const message = rawMessage.replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, 160);
    if (!message) return;
    playerRef.lastChatAt = now;
    const item = { id: playerRef.id, nick: playerRef.n, team: playerRef.t, message, time: now };
    chatHistory.push(item);
    if (chatHistory.length > CHAT_HISTORY_LIMIT) chatHistory.shift();
    io.emit('chat_message', item);
  });

  socket.on('admin_login', password => {
    if (ADMIN_PASSWORD && password === ADMIN_PASSWORD) {
      socket.isAdmin = true;
      socket.emit('admin_auth', true);
    } else {
      socket.emit('admin_auth', false);
    }
  });

  socket.on('admin_cmd', data => {
    if (!socket.isAdmin || !data || typeof data.type !== 'string') return;

    if (data.type === 'reset_ball') {
      ball.x = W / 2;
      ball.y = H / 2;
      ball.vx = ball.vy = 0;
      ball.lastTouch = null;
    } else if (data.type === 'add_score') {
      if (data.team === 1) sc[0]++;
      if (data.team === 2) sc[1]++;
    } else if (data.type === 'reset_time') {
      tl = MATCH_TICKS;
      ot = false;
    } else if (data.type === 'kick') {
      const targetId = Number(data.targetId);
      for (const [socketId, player] of players.entries()) {
        if (player.id === targetId) {
          const targetSocket = io.sockets.sockets.get(socketId);
          if (targetSocket) targetSocket.disconnect(true);
          players.delete(socketId);
          if (socketId === socket.id) playerRef = null;
          rebalance();
          roster();
          break;
        }
      }
    } else if (data.type === 'team' && [1, 2, 0].includes(Number(data.team))) {
      const targetId = Number(data.targetId);
      for (const [socketId, player] of players.entries()) {
        if (player.id === targetId) {
          move(player, Number(data.team));
          rebalance(); roster(); break;
        }
      }
    } else if (data.type === 'mute' || data.type === 'unmute') {
      const targetId = Number(data.targetId);
      if (data.type === 'mute') mutedPlayers.add(targetId);
      else mutedPlayers.delete(targetId);
      io.emit('announcement', data.type === 'mute' ? 'Bir oyuncunun sohbet yetkisi kapatıldı.' : 'Bir oyuncunun sohbet yetkisi açıldı.');
    } else if (data.type === 'announce') {
      if (typeof data.msg === 'string' && data.msg.trim()) {
        io.emit('announcement', data.msg.trim().slice(0, 300));
      }
    }
  });

  socket.on('disconnect', () => {
    if (socket.clientToken) activeSessions.delete(socket.clientToken);
    if (playerRef) {
      players.delete(socket.id);
      mutedPlayers.delete(playerRef.id);
      playerRef = null;
      rebalance();
      roster();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('Piksel Futbol çalışıyor: http://localhost:' + PORT);
});
