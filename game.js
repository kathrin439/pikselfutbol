(() => {
  'use strict';

  // ---------- Sekme Bazlı Token ----------
  let tabToken = sessionStorage.getItem('haxball_tab_token');

  if (!tabToken) {
    tabToken =
      'token_' +
      Math.random().toString(36).substr(2, 9) +
      '_' +
      Date.now();

    sessionStorage.setItem('haxball_tab_token', tabToken);
  }

  // ---------- Socket.io ----------
  const sock = io({
    query: { token: tabToken }
  });

  const $ = id => document.getElementById(id);
  const cv = $('c');
  const ctx = cv ? cv.getContext('2d') : null;

  const COL = {
    1: '#ff4d4d',
    2: '#3d8bff'
  };

  const TN = {
    1: 'KIRMIZI',
    2: 'MAVİ'
  };

  const LINE = 'rgba(234,255,234,.92)';
  const TAU = Math.PI * 2;

  const ls = {
    get: key => {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },

    set: (key, value) => {
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        // Yoksay
      }
    }
  };

  let cfg = null;
  let me = 0;

  let dpr = 1;
  let vw = 0;
  let vh = 0;
  let scale = 1;
  let ox = 0;
  let oy = 0;

  let kb = 0;
  let mk = false;
  let sent = 0;
  let bannerKey = '';

  let roster = new Map();
  let ents = new Map();
  let rings = [];

  const ball = {
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
    rot: 0,
    r: 0,
    ok: false
  };

  let ballVisible = true;
  let activeModifier = null;
  let wheelHideTimer = null;
  let isAdmin = false;

  const MODIFIER_LABELS = {
    fire: 'ATEŞLİ ŞUT',
    speed: 'HIZ',
    giant: 'DEV TOP',
    reverse: 'TERS KONTROL',
    magnet: 'MIKNATIS',
    invisible: 'GÖRÜNMEZ TOP',
    lowgravity: 'HAFİF TOP'
  };

  function updateModifierStatus() {
    const status = $('modifier-status');

    if (!status) return;

    if (!activeModifier) {
      status.classList.remove('active');
      status.textContent = '';
      return;
    }

    status.textContent =
      'AKTİF GÜÇ: ' +
      (MODIFIER_LABELS[activeModifier] || activeModifier);

    status.classList.add('active');
  }

  const nick = $('nick');

  if (document.fonts) {
    [
      '700 13px "Chakra Petch"',
      '8px "Press Start 2P"'
    ].forEach(font => document.fonts.load(font));
  }

  // ---------- Oyuna Katıl ----------
  const joinModal = $('joinModal');
  const joinBtn = $('joinBtn');
  const joinNickInput = $('joinNickInput');

  if (joinBtn) {
    joinBtn.onclick = () => {
      const name = joinNickInput
        ? joinNickInput.value.trim()
        : '';

      sock.emit('join_game', name);
    };
  }

  if (joinNickInput) {
    joinNickInput.addEventListener('keydown', event => {
      event.stopPropagation();

      if (event.key === 'Enter') {
        const name = joinNickInput.value.trim();
        sock.emit('join_game', name);
      }
    });

    joinNickInput.addEventListener('keyup', event => {
      event.stopPropagation();
    });
  }

  sock.on('joined_success', data => {
    me = data.id;

    if (joinModal) {
      joinModal.style.display = 'none';
    }
  });

  // ---------- Gol Sesi ----------
  const playGoalSound = () => {
    try {
      const AudioCtx =
        window.AudioContext ||
        window.webkitAudioContext;

      if (!AudioCtx) return;

      const ctxAud = new AudioCtx();

      const notes = [
        261.63,
        329.63,
        392.00,
        523.25
      ];

      notes.forEach((freq, index) => {
        const osc = ctxAud.createOscillator();
        const gain = ctxAud.createGain();

        osc.type = 'triangle';
        osc.frequency.value = freq;

        gain.gain.setValueAtTime(
          0.15,
          ctxAud.currentTime + index * 0.1
        );

        gain.gain.exponentialRampToValueAtTime(
          0.01,
          ctxAud.currentTime + index * 0.1 + 0.25
        );

        osc.connect(gain);
        gain.connect(ctxAud.destination);

        osc.start(ctxAud.currentTime + index * 0.1);
        osc.stop(ctxAud.currentTime + index * 0.1 + 0.25);
      });
    } catch (e) {
      // Yoksay
    }
  };

  // ---------- Kontroller ----------
  const KEYS = {
    ArrowUp: 1,
    KeyW: 1,
    ArrowDown: 2,
    KeyS: 2,
    ArrowLeft: 4,
    KeyA: 4,
    ArrowRight: 8,
    KeyD: 8,
    Space: 16,
    KeyX: 16
  };

  const send = () => {
    const value = kb | (mk ? 16 : 0);

    if (value !== sent) {
      sent = value;
      sock.emit('in', value);
    }
  };

  addEventListener('keydown', event => {
    if (
      ['INPUT', 'TEXTAREA'].includes(
        event.target.tagName
      )
    ) return;

    const key = KEYS[event.code];

    if (key) {
      event.preventDefault();
      kb |= key;
      send();
    }
  });

  addEventListener('keyup', event => {
    if (
      ['INPUT', 'TEXTAREA'].includes(
        event.target.tagName
      )
    ) return;

    const key = KEYS[event.code];

    if (key) {
      event.preventDefault();
      kb &= ~key;
      send();
    }
  });

  addEventListener('mousedown', event => {
    if (event.button === 0 && event.target !== nick) {
      mk = true;
      send();
    }
  });

  addEventListener('mouseup', event => {
    if (event.button === 0) {
      mk = false;
      send();
    }
  });

  addEventListener('blur', () => {
    kb = 0;
    mk = false;
    send();
  });

  addEventListener('contextmenu', event => {
    event.preventDefault();
  });

  if (nick) {
    nick.addEventListener('keydown', event => {
      event.stopPropagation();

      if (event.key === 'Enter') {
        nick.blur();
      }
    });

    nick.addEventListener('keyup', event => {
      event.stopPropagation();
    });

    nick.addEventListener('change', () => {
      const name = nick.value.trim();

      if (name) {
        ls.set('nick', name);
        sock.emit('nick', name);
      }
    });

    nick.value = ls.get('nick') || '';
  }

  // ---------- Socket Dinleyicileri ----------
  sock.on('connect', () => {
    const off = $('off');

    if (off) {
      off.classList.remove('on');
    }
  });

  sock.on('disconnect', () => {
    const off = $('off');

    if (off) {
      off.classList.add('on');
    }

    ents.clear();
  });

  // ---------- Modifier Çarkı ----------
  sock.on('modifier_wheel', data => {
    const modal = $('modifier-wheel-modal');
    const wheel = $('modifier-wheel');
    const title = $('modifier-wheel-title');
    const result = $('modifier-wheel-result');

    if (!modal || !wheel || !title || !result) return;

    if (wheelHideTimer) {
      clearTimeout(wheelHideTimer);
      wheelHideTimer = null;
    }

    modal.classList.remove('result');
    modal.classList.add('show');

    title.textContent = 'MODIFIER ÇARKI';
    result.textContent = 'ŞANSINI DENE!';

    wheel.style.transition = 'none';
    wheel.style.transform = 'rotate(0deg)';

    void wheel.offsetWidth;

    const index = Number.isInteger(data.index)
      ? data.index
      : 0;

    requestAnimationFrame(() => {
      const rotation =
        1440 +
        ((360 - (index * 45 + 22.5) + 360) % 360);

      wheel.style.transition =
        'transform 1.35s cubic-bezier(.12,.75,.12,1)';

      wheel.style.transform = `rotate(${rotation}deg)`;
    });
  });

  sock.on('modifier_applied', data => {
    activeModifier = data.modifier;
    updateModifierStatus();

    const modal = $('modifier-wheel-modal');
    const title = $('modifier-wheel-title');
    const result = $('modifier-wheel-result');

    if (title) {
      title.textContent = 'MODIFIER KAZANILDI!';
    }

    if (result) {
      result.textContent =
        MODIFIER_LABELS[data.modifier] || data.modifier;
    }

    if (modal) {
      modal.classList.add('result');
    }

    if (wheelHideTimer) {
      clearTimeout(wheelHideTimer);
    }

    wheelHideTimer = setTimeout(() => {
      if (modal) {
        modal.classList.remove('show');
        modal.classList.remove('result');
      }

      wheelHideTimer = null;
    }, 950);
  });

  sock.on('modifier_state', data => {
    activeModifier =
      data && data.modifier
        ? data.modifier
        : null;

    updateModifierStatus();
  });

  // ---------- Başlangıç ----------
  sock.on('init', data => {
    cfg = data;

    if (data.id) {
      me = data.id;
    }

    resize();

    sent = 0;

    const savedNick = ls.get('nick');

    if (savedNick) {
      sock.emit('nick', savedNick);
    }

    send();
  });

  // ---------- Oyuncu Listesi ----------
  sock.on('r', data => {
    roster = new Map(
      data.map(([id, name, team]) => [
        id,
        { n: name, t: team }
      ])
    );

    for (const id of [...ents.keys()]) {
      const player = roster.get(id);

      if (!player || !player.t) {
        ents.delete(id);
      }
    }

    [1, 2].forEach(team => {
      const ul = team === 1 ? $('rl') : $('bl');

      if (!ul) return;

      ul.textContent = '';

      data
        .filter(player => player[2] === team)
        .sort((a, b) => a[0] - b[0])
        .forEach(player => {
          const li = document.createElement('li');

          li.textContent = player[1];

          if (player[0] === me) {
            li.className = 'me';
          }

          ul.appendChild(li);
        });
    });

    const myPlayer = roster.get(me);
    const spectators = data.filter(player => !player[2]).length;
    const role = $('role');

    if (role) {
      role.textContent = !myPlayer
        ? ''
        : myPlayer.t
          ? TN[myPlayer.t] + ' TAKIMI'
          : 'İZLEYİCİ MODU' +
            (spectators ? ' (' + spectators + ')' : '');

      role.style.color =
        myPlayer && myPlayer.t
          ? COL[myPlayer.t]
          : '#ffe14d';
    }

    // Admin oyuncu listesi
    if (isAdmin) {
      const adminList = $('admin-player-list');

      if (adminList) {
        adminList.textContent = '';

        data.forEach(([id, name]) => {
          const li = document.createElement('li');
          const nameSpan = document.createElement('span');
          const kickButton = document.createElement('button');

          nameSpan.textContent = name;

          kickButton.className = 'kick-btn';
          kickButton.textContent = 'At';

          kickButton.addEventListener('click', () => {
            sock.emit('admin_cmd', {
              type: 'kick',
              targetId: String(id)
            });
          });

          li.append(
            nameSpan,
            document.createTextNode(' '),
            kickButton
          );

          adminList.appendChild(li);
        });
      }
    }
  });

  sock.on('k', id => {
    rings.push({
      id,
      t: performance.now()
    });
  });

  // ---------- Oyun Durumu ----------
  sock.on('s', data => {
    const seen = new Set();

    for (const [id, x, y, kick] of data.p) {
      seen.add(id);

      let entity = ents.get(id);

      if (!entity) {
        entity = {
          x,
          y,
          tx: x,
          ty: y,
          k: 0
        };

        ents.set(id, entity);
      }

      entity.tx = x;
      entity.ty = y;
      entity.k = kick;
    }

    for (const id of [...ents.keys()]) {
      if (!seen.has(id)) {
        ents.delete(id);
      }
    }

    ball.tx = data.b[0];
    ball.ty = data.b[1];

    ballVisible = data.ballVisible !== false;
    activeModifier = data.mod || null;

    ball.r = data.br || (cfg ? cfg.BR : 10);

    updateModifierStatus();

    if (!ball.ok) {
      ball.x = ball.tx;
      ball.y = ball.ty;
      ball.ok = true;
    }

    if ($('rs')) {
      $('rs').textContent = data.s[0];
    }

    if ($('bs')) {
      $('bs').textContent = data.s[1];
    }

    const minutes = Math.floor(data.t / 60);
    const seconds = data.t % 60;

    if ($('tm')) {
      $('tm').textContent = data.ot
        ? '00:00'
        : String(minutes).padStart(2, '0') +
          ':' +
          String(seconds).padStart(2, '0');
    }

    if ($('sub')) {
      $('sub').textContent = data.ot
        ? 'ALTIN GOL'
        : 'İLK ' + (cfg ? cfg.LIMIT : 5) + ' GOL';
    }

    const key = data.ph
      ? data.ph +
        '-' +
        data.w +
        '-' +
        data.s.join(':') +
        '-' +
        (data.sc_name || '')
      : '';

    if (key !== bannerKey) {
      bannerKey = key;

      const banner = $('banner');

      if (banner) {
        if (!data.ph) {
          banner.className = '';
        } else {
          if (data.ph === 1) {
            playGoalSound();
          }

          const scorerText = data.sc_name
            ? ' (' + data.sc_name + ')'
            : '';

          const title = data.ph === 1
            ? 'GOL!' + scorerText
            : 'MAÇ BİTTİ';

          const subtitle = data.ph === 1
            ? TN[data.w] + ' TAKIM SKORU BULDU'
            : TN[data.w] + ' TAKIM KAZANDI';

          banner.innerHTML = '<div></div><small></small>';

          banner.firstChild.textContent = title;
          banner.lastChild.textContent = subtitle;

          banner.firstChild.style.color = COL[data.w];
          banner.className = 'show';
        }
      }
    }
  });

  // ---------- Admin Paneli ----------
  const modal = $('admin-modal');
  const loginSec = $('admin-login-sec');
  const panelSec = $('admin-panel-sec');

  addEventListener('keydown', event => {
    if (
      event.ctrlKey &&
      event.shiftKey &&
      event.code === 'KeyA'
    ) {
      event.preventDefault();

      if (modal) {
        modal.style.display =
          modal.style.display === 'none'
            ? 'flex'
            : 'none';
      }
    }
  });

  if ($('admin-close')) {
    $('admin-close').onclick = () => {
      if (modal) {
        modal.style.display = 'none';
      }
    };
  }

  if ($('admin-login-btn')) {
    $('admin-login-btn').onclick = () => {
      const password = $('admin-pass')
        ? $('admin-pass').value
        : '';

      sock.emit('admin_login', password);
    };
  }

  sock.on('admin_auth', success => {
    if (success) {
      isAdmin = true;

      if (loginSec) {
        loginSec.style.display = 'none';
      }

      if (panelSec) {
        panelSec.style.display = 'block';
      }

      alert('Admin girişi başarılı!');
    } else {
      alert('Hatalı şifre!');
    }
  });

  if ($('adm-reset-ball')) {
    $('adm-reset-ball').onclick = () => {
      sock.emit('admin_cmd', {
        type: 'reset_ball'
      });
    };
  }

  if ($('adm-reset-time')) {
    $('adm-reset-time').onclick = () => {
      sock.emit('admin_cmd', {
        type: 'reset_time'
      });
    };
  }

  if ($('adm-score-red')) {
    $('adm-score-red').onclick = () => {
      sock.emit('admin_cmd', {
        type: 'add_score',
        team: 1
      });
    };
  }

  if ($('adm-score-blue')) {
    $('adm-score-blue').onclick = () => {
      sock.emit('admin_cmd', {
        type: 'add_score',
        team: 2
      });
    };
  }

  if ($('adm-ann-btn')) {
    $('adm-ann-btn').onclick = () => {
      const input = $('adm-ann-text');

      if (input && input.value) {
        sock.emit('admin_cmd', {
          type: 'announce',
          msg: input.value
        });

        input.value = '';
      }
    };
  }

  // Admin inputlarında oyun tuşlarını engelle
  ['adm-ann-text', 'admin-pass'].forEach(id => {
    const element = $(id);

    if (!element) return;

    element.addEventListener('keydown', event => {
      event.stopPropagation();

      if (event.key === 'Enter') {
        if (
          id === 'adm-ann-text' &&
          $('adm-ann-btn')
        ) {
          $('adm-ann-btn').click();
        }

        if (
          id === 'admin-pass' &&
          $('admin-login-btn')
        ) {
          $('admin-login-btn').click();
        }
      }
    });

    element.addEventListener('keyup', event => {
      event.stopPropagation();
    });
  });

  // ---------- Duyuru ----------
  sock.on('announcement', message => {
    const banner = $('banner');

    if (!banner) return;

    banner.innerHTML = '<div>DUYURU</div><small></small>';

    banner.firstChild.textContent = 'DUYURU';
    banner.firstChild.style.color = '#ffe14d';
    banner.lastChild.textContent = message;

    banner.className = 'show';

    setTimeout(() => {
      if (
        banner.firstChild &&
        banner.firstChild.textContent === 'DUYURU'
      ) {
        banner.className = '';
      }
    }, 4000);
  });

  // ---------- Ekran Boyutu ----------
  function resize() {
    dpr = window.devicePixelRatio || 1;
    vw = innerWidth;
    vh = innerHeight;

    if (!cv) return;

    cv.width = Math.round(vw * dpr);
    cv.height = Math.round(vh * dpr);

    if (!cfg) return;

    const top = 88;
    const bottom = 64;

    scale = Math.min(
      vw / (cfg.W + cfg.GD * 2 + 50),
      (vh - top - bottom) / (cfg.H + 36)
    );

    ox = (vw - cfg.W * scale) / 2;

    oy =
      top +
      (vh - top - bottom - cfg.H * scale) / 2;
  }

  addEventListener('resize', resize);

  const circ = (x, y, radius) => {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
  };

  // ---------- Kale Çizimi ----------
  function side(team) {
    const {
      W,
      H,
      GD,
      GY1,
      GY2,
      POST
    } = cfg;

    ctx.save();

    if (team === 2) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }

    const color = COL[team];

    ctx.fillStyle = 'rgba(255,255,255,.14)';
    ctx.fillRect(-GD, GY1, GD, GY2 - GY1);

    ctx.save();

    ctx.beginPath();
    ctx.rect(-GD, GY1, GD, GY2 - GY1);
    ctx.clip();

    ctx.strokeStyle = 'rgba(255,255,255,.38)';
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = -GD; x <= 0; x += 9) {
      ctx.moveTo(x, GY1);
      ctx.lineTo(x, GY2);
    }

    for (let y = GY1; y <= GY2; y += 9) {
      ctx.moveTo(-GD, y);
      ctx.lineTo(0, y);
    }

    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.beginPath();

    ctx.moveTo(0, GY1);
    ctx.lineTo(-GD, GY1);
    ctx.lineTo(-GD, GY2);
    ctx.lineTo(0, GY2);

    ctx.stroke();

    ctx.strokeStyle = LINE;
    ctx.lineWidth = 3;

    ctx.strokeRect(0, H / 2 - 220, 190, 440);
    ctx.strokeRect(0, H / 2 - 150, 70, 300);

    ctx.beginPath();
    ctx.arc(130, H / 2, 80, -0.7227, 0.7227);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI / 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, H, 22, -Math.PI / 2, 0);
    ctx.stroke();

    ctx.fillStyle = LINE;
    circ(130, H / 2, 4);
    ctx.fill();

    for (const y of [GY1, GY2]) {
      circ(0, y, POST);

      ctx.fillStyle = color;
      ctx.fill();

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }

    ctx.restore();
  }

  // ---------- Saha ----------
  function drawField() {
    const { W, H, GD } = cfg;

    ctx.fillStyle = '#14502a';

    ctx.fillRect(
      -GD - 22,
      -18,
      W + GD * 2 + 44,
      H + 36
    );

    const count = 14;
    const stripeWidth = W / count;

    for (let i = 0; i < count; i++) {
      ctx.fillStyle =
        i % 2 ? '#2b8a45' : '#34a14f';

      ctx.fillRect(
        i * stripeWidth,
        0,
        stripeWidth + 1,
        H
      );
    }

    ctx.strokeStyle = LINE;
    ctx.lineWidth = 3;

    ctx.strokeRect(0, 0, W, H);

    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();

    circ(W / 2, H / 2, 90);
    ctx.stroke();

    ctx.fillStyle = LINE;
    circ(W / 2, H / 2, 4);
    ctx.fill();

    side(1);
    side(2);
  }

  // ---------- Oyuncular ----------
  function drawPlayers(now) {
    const { PR } = cfg;

    ents.forEach((entity, id) => {
      const player = roster.get(id);

      if (!player || !player.t) return;

      ctx.fillStyle = 'rgba(0,0,0,.28)';

      circ(
        entity.x + 2,
        entity.y + 4,
        PR
      );

      ctx.fill();

      circ(entity.x, entity.y, PR);

      ctx.fillStyle = COL[player.t];
      ctx.fill();

      ctx.lineWidth = entity.k ? 3.5 : 2;
      ctx.strokeStyle = entity.k ? '#fff' : '#0a0a0a';
      ctx.stroke();

      if (id === me) {
        ctx.save();

        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -now / 60;
        ctx.strokeStyle = '#ffe14d';
        ctx.lineWidth = 2;

        circ(entity.x, entity.y, PR + 6);
        ctx.stroke();

        ctx.restore();
      }

      ctx.textAlign = 'center';

      ctx.font = '8px "Press Start 2P", monospace';
      ctx.fillStyle = '#fff';

      ctx.fillText(
        player.n.charAt(0).toUpperCase(),
        entity.x + 0.5,
        entity.y + 4
      );

      ctx.font = '700 13px "Chakra Petch", sans-serif';

      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,.75)';

      ctx.strokeText(
        player.n,
        entity.x,
        entity.y - PR - 8
      );

      ctx.fillStyle =
        id === me ? '#ffe14d' : '#fff';

      ctx.fillText(
        player.n,
        entity.x,
        entity.y - PR - 8
      );
    });
  }

  // ---------- Şut Efektleri ----------
  function drawRings(now) {
    const { PR } = cfg;

    rings = rings.filter(ring => now - ring.t < 320);

    for (const ring of rings) {
      const entity = ents.get(ring.id);

      if (!entity) continue;

      const progress = (now - ring.t) / 320;

      ctx.save();

      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 18;

      ctx.fillStyle =
        'rgba(255,255,255,' +
        (0.35 * (1 - progress)) +
        ')';

      circ(entity.x, entity.y, PR + 2);
      ctx.fill();

      ctx.strokeStyle =
        'rgba(255,255,255,' +
        (1 - progress) +
        ')';

      ctx.lineWidth = 5 * (1 - progress) + 1;

      circ(
        entity.x,
        entity.y,
        PR + 3 + progress * 20
      );

      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------- Top ----------
  function drawBall() {
    if (activeModifier === 'invisible' && !ballVisible) {
      return;
    }

    const BR = ball.r || cfg.BR;

    ctx.fillStyle = 'rgba(0,0,0,.3)';

    circ(ball.x + 2, ball.y + 4, BR);
    ctx.fill();

    circ(ball.x, ball.y, BR);

    ctx.fillStyle = '#fff';
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#111';
    ctx.stroke();

    ctx.save();

    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.rot);

    ctx.fillStyle = '#111';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.2;

    ctx.beginPath();

    for (let i = 0; i < 5; i++) {
      const angle = i * TAU / 5;

      ctx.lineTo(
        Math.cos(angle) * 4.2,
        Math.sin(angle) * 4.2
      );
    }

    ctx.closePath();
    ctx.fill();

    ctx.beginPath();

    for (let i = 0; i < 5; i++) {
      const angle = i * TAU / 5;

      ctx.moveTo(
        Math.cos(angle) * 4.2,
        Math.sin(angle) * 4.2
      );

      ctx.lineTo(
        Math.cos(angle) * BR * 0.92,
        Math.sin(angle) * BR * 0.92
      );
    }

    ctx.stroke();
    ctx.restore();
  }

  // ---------- Ana Çizim Döngüsü ----------
  let lt = performance.now();

  function frame(now) {
    const dt = Math.min((now - lt) / 1000, 0.1);
    lt = now;

    if (cfg && ctx) {
      const factor = 1 - Math.exp(-dt * 28);

      ents.forEach(entity => {
        if (
          Math.abs(entity.tx - entity.x) +
          Math.abs(entity.ty - entity.y) > 120
        ) {
          entity.x = entity.tx;
          entity.y = entity.ty;
        } else {
          entity.x += (entity.tx - entity.x) * factor;
          entity.y += (entity.ty - entity.y) * factor;
        }
      });

      const previousX = ball.x;
      const previousY = ball.y;

      if (
        Math.abs(ball.tx - previousX) +
        Math.abs(ball.ty - previousY) > 150
      ) {
        ball.x = ball.tx;
        ball.y = ball.ty;
      } else {
        ball.x += (ball.tx - previousX) * factor;
        ball.y += (ball.ty - previousY) * factor;
      }

      ball.rot +=
        (ball.x - previousX + ball.y - previousY) / cfg.BR;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, vw, vh);

      ctx.setTransform(
        dpr * scale,
        0,
        0,
        dpr * scale,
        dpr * ox,
        dpr * oy
      );

      drawField();
      drawPlayers(now);
      drawRings(now);

      if (ball.ok) {
        drawBall();
      }
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();