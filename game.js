(() => {
  'use strict';

  // ---------- Sekme Bazlı Token Üretimi ----------
  let tabToken = sessionStorage.getItem('haxball_tab_token');
  if (!tabToken) {
    tabToken = 'token_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    sessionStorage.setItem('haxball_tab_token', tabToken);
  }

  // ---------- Socket.io Bağlantısı (Token ile) ----------
  const sock = io({
    query: { token: tabToken }
  });

  const $ = id => document.getElementById(id);
  const cv = $('c'), ctx = cv ? cv.getContext('2d') : null;
  const COL = { 1: '#ff4d4d', 2: '#3d8bff' }, TN = { 1: 'KIRMIZI', 2: 'MAVİ' };
  const LINE = 'rgba(234,255,234,.92)', TAU = Math.PI * 2;
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* yoksay */ } }
  };

  let cfg = null, me = 0, dpr = 1, vw = 0, vh = 0, scale = 1, ox = 0, oy = 0;
  let kb = 0, mk = false, sent = 0, bannerKey = '';
  let roster = new Map(), ents = new Map(), rings = [];
  const ball = { x: 0, y: 0, tx: 0, ty: 0, rot: 0, r: 0, ok: false };
  let ballVisible = true;
  let activeModifier = null;
  let wheelHideTimer = null;

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
    'AKTİF GÜÇ: ' + (MODIFIER_LABELS[activeModifier] || activeModifier);

  status.classList.add('active');
}
  const nick = $('nick');

  if (document.fonts) ['700 13px "Chakra Petch"', '8px "Press Start 2P"'].forEach(f => document.fonts.load(f));

  // ---------- Oyuna Katıl (Join Modal) Mantığı ----------
  const joinModal = $('joinModal');
  const joinBtn = $('joinBtn');
  const joinNickInput = $('joinNickInput');

  if (joinBtn) {
    joinBtn.onclick = () => {
      const n = joinNickInput ? joinNickInput.value.trim() : '';
      sock.emit('join_game', n);
    };
  }

  if (joinNickInput) {
    joinNickInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const n = joinNickInput.value.trim();
        sock.emit('join_game', n);
      }
    });
    joinNickInput.addEventListener('keyup', e => e.stopPropagation());
  }

  const updateLogModal = $('update-log-modal');
  const updateLogClose = $('update-log-close');
  function closeUpdateLog() {
    if (updateLogModal) updateLogModal.classList.add('is-closed');
  }
  if (updateLogClose) updateLogClose.addEventListener('click', closeUpdateLog);
  if (updateLogModal) updateLogModal.addEventListener('click', event => {
    if (event.target === updateLogModal) closeUpdateLog();
  });
  addEventListener('keydown', event => {
    if (event.key === 'Escape' && updateLogModal && !updateLogModal.classList.contains('is-closed')) closeUpdateLog();
  });

  sock.on('joined_success', data => {
    me = data.id;
    if (joinModal) joinModal.style.display = 'none';
  });

  // ---------- Ses Efekti Üreteci ----------
  const playGoalSound = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctxAud = new AudioCtx();
      const notes = [261.63, 329.63, 392.00, 523.25];
      notes.forEach((freq, i) => {
        const osc = ctxAud.createOscillator();
        const gain = ctxAud.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, ctxAud.currentTime + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.01, ctxAud.currentTime + i * 0.1 + 0.25);
        osc.connect(gain);
        gain.connect(ctxAud.destination);
        osc.start(ctxAud.currentTime + i * 0.1);
        osc.stop(ctxAud.currentTime + i * 0.1 + 0.25);
      });
    } catch (e) { /* yoksay */ }
  };

  // ---------- Girdi (Kontroller) ----------
  const KEYS = { ArrowUp: 1, KeyW: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 4, KeyA: 4, ArrowRight: 8, KeyD: 8, Space: 16, KeyX: 16 };
  const send = () => {
    const v = kb | (mk ? 16 : 0);
    if (v !== sent) { sent = v; sock.emit('in', v); }
  };

  addEventListener('keydown', e => { 
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
    const b = KEYS[e.code]; 
    if (b) { e.preventDefault(); kb |= b; send(); } 
  });
  
  addEventListener('keyup', e => { 
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
    const b = KEYS[e.code]; 
    if (b) { e.preventDefault(); kb &= ~b; send(); } 
  });

  addEventListener('mousedown', e => { if (e.button === 0 && !e.target.closest('button, input, textarea, .modal, #chat-panel')) { mk = true; send(); } });
  addEventListener('mouseup', e => { if (e.button === 0) { mk = false; send(); } });
  // Mobil dokunmatik yön ve şut tuşları; klavye fiziğiyle aynı input bitlerini kullanır.
  const touchBits = new Map();
  document.querySelectorAll('#touch-controls [data-bit]').forEach(button => {
    const bit = Number(button.dataset.bit);
    const down = event => { event.preventDefault(); touchBits.set(bit, true); kb |= bit; send(); };
    const up = event => { event.preventDefault(); touchBits.delete(bit); if (![...touchBits.keys()].includes(bit)) kb &= ~bit; send(); };
    button.addEventListener('pointerdown', down);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => button.addEventListener(type, up));
  });
  addEventListener('blur', () => { kb = 0; mk = false; send(); });
  addEventListener('contextmenu', e => e.preventDefault());

  if (nick) {
    nick.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') nick.blur(); });
    nick.addEventListener('keyup', e => e.stopPropagation());
    nick.addEventListener('change', () => {
      const n = nick.value.trim();
      if (n) { ls.set('nick', n); sock.emit('nick', n); }
    });
    nick.value = ls.get('nick') || '';
  }

  // ---------- Socket Dinleyicileri ----------
  sock.on('connect', () => $('off') && $('off').classList.remove('on'));
  sock.on('connect_error', error => console.error('[Socket] Bağlantı hatası:', error.message));
  sock.on('disconnect', reason => {
    console.warn('[Socket] Bağlantı koptu:', reason);
    $('off') && $('off').classList.add('on');
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

    // Her dönüşte animasyonu baştan başlat.
    wheel.style.transition = 'none';
    wheel.style.transform = 'rotate(0deg)';
    void wheel.offsetWidth;

    const index = Number.isInteger(data.index) ? data.index : 0;

    requestAnimationFrame(() => {
      // Dört tam tur ve seçilen dilime göre bitiş açısı.
      const slice = 360 / 7;
      const rotation = 1440 + ((360 - (index * slice + slice / 2) + 360) % 360);

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

  if (title) title.textContent = 'MODIFIER KAZANILDI!';
  if (result) {
    result.textContent = MODIFIER_LABELS[data.modifier] || data.modifier;
  }

  if (modal) modal.classList.add('result');

  if (wheelHideTimer) clearTimeout(wheelHideTimer);

  wheelHideTimer = setTimeout(() => {
    if (modal) {
      modal.classList.remove('show');
      modal.classList.remove('result');
    }

    wheelHideTimer = null;
  }, 950);
});

sock.on('modifier_state', data => {
  activeModifier = data && data.modifier ? data.modifier : null;
  updateModifierStatus();
});
  
  sock.on('init', d => {
    cfg = d; 
    if (d.id) me = d.id; 
    resize();
    sent = 0;
    const n = ls.get('nick');
    if (n) sock.emit('nick', n);
    send();
  });

  sock.on('r', a => {
    roster = new Map(a.map(([id, n, t, muted]) => [id, { n, t, muted: !!muted }]));
    for (const id of [...ents.keys()]) { const r = roster.get(id); if (!r || !r.t) ents.delete(id); }
    
    [1, 2].forEach(t => {
      const ul = t === 1 ? $('rl') :$('bl');
      if (!ul) return;
      ul.textContent = '';
      a.filter(r => r[2] === t).sort((x, y) => x[0] - y[0]).forEach(r => {
        const li = document.createElement('li');
        li.textContent = r[1];
        if (r[0] === me) li.className = 'me';
        ul.appendChild(li);
      });
    });

    const m = roster.get(me), spec = a.filter(r => !r[2]).length, role = $('role');
    if (role) {
      role.textContent = !m ? '' : m.t ? TN[m.t] + ' TAKIMI' : 'İZLEYİCİ MODU' + (spec ? ' (' + spec + ')' : '');
      role.style.color = m && m.t ? COL[m.t] : '#ffe14d';
    }

    // Admin paneli: canlı sayaçlar, arama ve oyuncu işlemleri
    if (isAdmin) {
      const counts = { all: a.length, red: a.filter(r => Number(r[2]) === 1).length, blue: a.filter(r => Number(r[2]) === 2).length, spec: a.filter(r => !Number(r[2])).length };
      [['adm-count-all', counts.all], ['adm-count-red', counts.red], ['adm-count-blue', counts.blue], ['adm-count-spec', counts.spec]].forEach(([id, value]) => { const el = $(id); if (el) el.textContent = value; });
      const admUl = $('admin-player-list');
      if (admUl) {
        admUl.textContent = '';
        const query = (($('admin-player-search') || {}).value || '').trim().toLocaleLowerCase('tr');
        const filtered = a.filter(row => String(row[1] || '').toLocaleLowerCase('tr').includes(query));
        if (!filtered.length) {
          const empty = document.createElement('li'); empty.className = 'admin-empty'; empty.textContent = query ? 'Aramayla eşleşen oyuncu yok.' : 'Henüz oyuncu yok.'; admUl.appendChild(empty);
        }
        filtered.forEach(([id, name, team, muted]) => {
          const li = document.createElement('li'); li.className = 'admin-player-row';
          const info = document.createElement('div'); info.className = 'admin-player-info';
          const nameSpan = document.createElement('b'); nameSpan.textContent = name;
          const meta = document.createElement('small'); meta.textContent = Number(team) === 1 ? 'KIRMIZI TAKIM' : Number(team) === 2 ? 'MAVİ TAKIM' : 'İZLEYİCİ';
          meta.className = Number(team) === 1 ? 'admin-red-label' : Number(team) === 2 ? 'admin-blue-label' : '';
          info.append(nameSpan, meta);
          const actions = document.createElement('div'); actions.className = 'admin-player-actions';
          const addAction = (label, type, extra = {}) => {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
            if (type === 'kick') button.className = 'kick-btn';
            button.addEventListener('click', () => {
              if (type === 'kick' && !confirm(name + ' oyuncusunu sunucudan atmak istiyor musun?')) return;
              sock.emit('admin_cmd', { type, targetId: String(id), ...extra });
              const feedback = $('admin-feedback'); if (feedback) feedback.textContent = name + ' için işlem gönderildi: ' + label;
            });
            actions.appendChild(button);
          };
          addAction('KIRMIZI', 'team', { team: 1 });
          addAction('MAVİ', 'team', { team: 2 });
          addAction('İZLEYİCİ', 'team', { team: 0 });
          addAction(muted ? 'SUSTURMAYI AÇ' : 'SUSTUR', muted ? 'unmute' : 'mute');
          addAction('AT', 'kick');
          li.append(info, actions); admUl.appendChild(li);
        });
      }
    }
  });

  sock.on('k', id => rings.push({ id, t: performance.now() }));

  sock.on('s', d => {
    const seen = new Set();
    for (const [id, x, y, k] of d.p) {
      seen.add(id);
      let e = ents.get(id);
      if (!e) { e = { x, y, tx: x, ty: y, k: 0 }; ents.set(id, e); }
      e.tx = x; e.ty = y; e.k = k;
    }
    for (const id of [...ents.keys()]) if (!seen.has(id)) ents.delete(id);
    ball.tx = d.b[0]; ball.ty = d.b[1];
    ballVisible = d.ballVisible !== false;
    activeModifier = d.mod || null;
    ball.r = d.br || (cfg ? cfg.BR : 10);
    updateModifierStatus();
    if (!ball.ok) { ball.x = ball.tx; ball.y = ball.ty; ball.ok = true; }

    if ($('rs'))$('rs').textContent = d.s[0];
    if ($('bs'))$('bs').textContent = d.s[1];
    const mm = Math.floor(d.t / 60), ss = d.t % 60;
    if ($('tm'))$('tm').textContent = d.ot ? '00:00' : String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    if ($('sub'))$('sub').textContent = d.ot ? 'ALTIN GOL' : 'İLK ' + (cfg ? cfg.LIMIT : 5) + ' GOL';

    const key = d.ph ? d.ph + '-' + d.w + '-' + d.s.join(':') + '-' + (d.sc_name || '') : '';
    if (key !== bannerKey) {
      bannerKey = key;
      const b = $('banner');
      if (b) {
        if (!d.ph) b.className = '';
        else {
          if (d.ph === 1) playGoalSound();

          const scorerText = d.sc_name ? ' (' + d.sc_name + ')' : '';
          const t = d.ph === 1 ? 'GOL!' + scorerText : 'MAÇ BİTTİ';
          const s = d.ph === 1 ? TN[d.w] + ' TAKIM SKORU BULDU' : TN[d.w] + ' TAKIM KAZANDI';

          b.innerHTML = '<div></div><small></small>';
          b.firstChild.textContent = t;
          b.lastChild.textContent = s;
          b.firstChild.style.color = COL[d.w];
          b.className = 'show';
        }
      }
    }
  });

  // ---------- Oyun Sohbeti ----------
  const chatForm = $('chat-form');
  const chatInput = $('chat-input');
  const chatMessages = $('chat-messages');
  const chatPanel = $('chat-panel');
  const chatToggle = $('chat-toggle');

  function addChatMessage(item) {
    if (!chatMessages || !item || typeof item !== 'object') return;
    const row = document.createElement('div');
    row.className = 'chat-line team-' + (Number(item.team) || 0);
    const time = document.createElement('span');
    time.className = 'chat-time';
    time.textContent = new Date(Number(item.time) || Date.now()).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const name = document.createElement('b');
    name.textContent = String(item.nick || 'Oyuncu').slice(0, 14) + ': ';
    const message = document.createElement('span');
    message.textContent = String(item.message || '').slice(0, 160);
    row.append(time, name, message);
    chatMessages.appendChild(row);
    while (chatMessages.children.length > 40) chatMessages.firstChild.remove();
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function addChatNotice(message) {
    if (!chatMessages) return;
    const notice = document.createElement('div');
    notice.className = 'chat-notice';
    notice.textContent = message;
    chatMessages.appendChild(notice);
    while (chatMessages.children.length > 40) chatMessages.firstChild.remove();
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function sendChatMessage() {
    if (!chatInput) return;
    const value = chatInput.value.trim();
    if (!value) return;
    if (!sock.connected) {
      addChatNotice('Bağlantı yok, mesaj gönderilemedi.');
      return;
    }
    sock.emit('chat_send', value, response => {
      if (!response || !response.ok) {
        addChatNotice(response && response.message ? response.message : 'Mesaj gönderilemedi.');
      } else {
        chatInput.value = '';
      }
    });
  }

  sock.on('chat_history', items => {
    if (chatMessages) chatMessages.textContent = '';
    (Array.isArray(items) ? items : []).forEach(addChatMessage);
  });
  sock.on('chat_message', addChatMessage);

  if (chatForm) {
    chatForm.addEventListener('submit', event => {
      event.preventDefault();
      event.stopPropagation();
      sendChatMessage();
      if (chatInput) chatInput.focus();
    });
  }
  if (chatInput) {
    chatInput.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
      }
    });
    chatInput.addEventListener('keyup', event => event.stopPropagation());
    chatInput.addEventListener('keypress', event => event.stopPropagation());
  }
  if (chatToggle && chatPanel) chatToggle.addEventListener('click', () => {
    chatPanel.classList.toggle('collapsed');
    chatToggle.textContent = chatPanel.classList.contains('collapsed') ? '+' : '_';
  });

  // ---------- Admin Paneli Mantığı ----------
  let isAdmin = false;
  const modal = $('admin-modal');
  const loginSec = $('admin-login-sec');
  const panelSec = $('admin-panel-sec');

  addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyA') {
      e.preventDefault();
      if (modal) modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
    }
  });

  if ($('admin-close'))$('admin-close').onclick = () => modal.style.display = 'none';

  if ($('admin-login-btn')) {$('admin-login-btn').onclick = () => {
      const pass = $('admin-pass') ?$('admin-pass').value : '';
      sock.emit('admin_login', pass);
    };
  }

  sock.on('admin_auth', success => {
    if (success) {
      isAdmin = true;
      if (loginSec) loginSec.style.display = 'none';
      if (panelSec) panelSec.style.display = 'block';
      alert('Admin girişi başarılı!');
    } else {
      alert('Hatalı şifre!');
    }
  });

  if ($('adm-reset-ball'))$('adm-reset-ball').onclick = () => sock.emit('admin_cmd', { type: 'reset_ball' });
  if ($('adm-reset-time'))$('adm-reset-time').onclick = () => sock.emit('admin_cmd', { type: 'reset_time' });
  if ($('adm-pause')) $('adm-pause').onclick = () => sock.emit('admin_cmd', { type: 'toggle_pause' });
  if ($('adm-reset-match')) $('adm-reset-match').onclick = () => {
    if (confirm('Maç sıfırlansın mı? Skorlar da sıfırlanacak.')) sock.emit('admin_cmd', { type: 'reset_match' });
  };
  if ($('adm-clear-chat')) $('adm-clear-chat').onclick = () => {
    if (confirm('Tüm sohbet geçmişi silinsin mi?')) sock.emit('admin_cmd', { type: 'clear_chat' });
  };
  sock.on('admin_state', state => {
    const button = $('adm-pause');
    if (button && state) {
      button.textContent = state.paused ? 'MAÇA DEVAM ET' : 'MAÇI DURAKLAT';
      button.classList.toggle('admin-danger', !!state.paused);
    }
  });
  sock.on('chat_clear', () => {
    if ($('chat-messages')) $('chat-messages').textContent = '';
    addChatNotice('Sohbet geçmişi yönetici tarafından temizlendi.');
  });
  if ($('adm-score-red'))$('adm-score-red').onclick = () => sock.emit('admin_cmd', { type: 'add_score', team: 1 });
  if ($('adm-score-blue'))$('adm-score-blue').onclick = () => sock.emit('admin_cmd', { type: 'add_score', team: 2 });
  if ($('adm-score-red-minus'))$('adm-score-red-minus').onclick = () => sock.emit('admin_cmd', { type: 'remove_score', team: 1 });
  if ($('adm-score-blue-minus'))$('adm-score-blue-minus').onclick = () => sock.emit('admin_cmd', { type: 'remove_score', team: 2 });

  const adminSearch = $('admin-player-search');
  if (adminSearch) adminSearch.addEventListener('input', () => {
    // Son roster verisini kullanarak filtreyi anında uygula.
    const rows = [...roster.entries()].map(([id, player]) => [id, player.n, player.t, player.muted]);
    const list = $('admin-player-list'); if (!list) return;
    list.textContent = '';
    const q = adminSearch.value.trim().toLocaleLowerCase('tr');
    const matches = rows.filter(row => String(row[1] || '').toLocaleLowerCase('tr').includes(q));
    matches.forEach(([id, name, team, muted]) => {
      const li = document.createElement('li'); li.className = 'admin-player-row';
      const info = document.createElement('div'); info.className = 'admin-player-info';
      const b = document.createElement('b'); b.textContent = name;
      const meta = document.createElement('small'); meta.textContent = Number(team) === 1 ? 'KIRMIZI TAKIM' : Number(team) === 2 ? 'MAVİ TAKIM' : 'İZLEYİCİ';
      info.append(b, meta); const actions = document.createElement('div'); actions.className = 'admin-player-actions';
      [['KIRMIZI','team',{team:1}],['MAVİ','team',{team:2}],['İZLEYİCİ','team',{team:0}],[muted ? 'SUSTURMAYI AÇ' : 'SUSTUR', muted ? 'unmute' : 'mute', {}],['AT','kick',{}]].forEach(([label,type,extra]) => { const btn=document.createElement('button'); btn.type='button'; btn.textContent=label; if(type==='kick')btn.className='kick-btn'; btn.onclick=()=>{ if(type==='kick'&&!confirm(name+' oyuncusunu sunucudan atmak istiyor musun?'))return; sock.emit('admin_cmd',{type,targetId:String(id),...extra}); }; actions.appendChild(btn); });
      li.append(info,actions); list.appendChild(li);
    });
    if (!matches.length) { const li=document.createElement('li'); li.className='admin-empty'; li.textContent='Aramayla eşleşen oyuncu yok.'; list.appendChild(li); }
  });

  if ($('adm-ann-btn')) {$('adm-ann-btn').onclick = () => {
      const msgInput = $('adm-ann-text');
      if (msgInput && msgInput.value) {
        sock.emit('admin_cmd', { type: 'announce', msg: msgInput.value });
        msgInput.value = '';
      }
    };
  }

  // Yazı yazarken tuşların oyuna yayılmasını engelleme
  ['adm-ann-text', 'admin-pass'].forEach(id => {
    const el = $(id);
    if (el) {
      el.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          if (id === 'adm-ann-text' && $('adm-ann-btn'))$('adm-ann-btn').click();
          if (id === 'admin-pass' && $('admin-login-btn'))$('admin-login-btn').click();
        }
      });
      el.addEventListener('keyup', e => e.stopPropagation());
    }
  });

  sock.on('announcement', msg => {
    const b = $('banner');
    if (b) {
      b.innerHTML = '<div>DUYURU</div><small></small>';
      b.firstChild.textContent = 'DUYURU';
      b.firstChild.style.color = '#ffe14d';
      b.lastChild.textContent = msg;
      b.className = 'show';

      setTimeout(() => {
        if (b.firstChild && b.firstChild.textContent === 'DUYURU') {
          b.className = '';
        }
      }, 4000);
    }
  });

  // ---------- Çizim ve Döngü ----------
  function resize() {
    dpr = window.devicePixelRatio || 1; vw = innerWidth; vh = innerHeight;
    if (!cv) return;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    if (!cfg) return;
    const top = 88, bot = 64;
    scale = Math.min(vw / (cfg.W + cfg.GD * 2 + 50), (vh - top - bot) / (cfg.H + 36));
    ox = (vw - cfg.W * scale) / 2;
    oy = top + (vh - top - bot - cfg.H * scale) / 2;
  }
  addEventListener('resize', resize);

  const circ = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); };

  function side(c) {
    const { W, H, GD, GY1, GY2, POST } = cfg;
    ctx.save();
    if (c === 2) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    const col = COL[c];

    ctx.fillStyle = 'rgba(255,255,255,.14)';
    ctx.fillRect(-GD, GY1, GD, GY2 - GY1);
    ctx.save();
    ctx.beginPath(); ctx.rect(-GD, GY1, GD, GY2 - GY1); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.38)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = -GD; x <= 0; x += 9) { ctx.moveTo(x, GY1); ctx.lineTo(x, GY2); }
    for (let y = GY1; y <= GY2; y += 9) { ctx.moveTo(-GD, y); ctx.lineTo(0, y); }
    ctx.stroke(); ctx.restore();

    ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.beginPath();
    ctx.moveTo(0, GY1); ctx.lineTo(-GD, GY1); ctx.lineTo(-GD, GY2); ctx.lineTo(0, GY2);
    ctx.stroke();

    ctx.strokeStyle = LINE; ctx.lineWidth = 3;
    ctx.strokeRect(0, H / 2 - 220, 190, 440);
    ctx.strokeRect(0, H / 2 - 150, 70, 300);
    ctx.beginPath(); ctx.arc(130, H / 2, 80, -0.7227, 0.7227); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI / 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, H, 22, -Math.PI / 2, 0); ctx.stroke();
    ctx.fillStyle = LINE; circ(130, H / 2, 4); ctx.fill();

    for (const y of [GY1, GY2]) {
      circ(0, y, POST); ctx.fillStyle = col; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
    ctx.restore();
  }

  function drawField() {
    const { W, H, GD } = cfg;
    ctx.fillStyle = '#14502a';
    ctx.fillRect(-GD - 22, -18, W + GD * 2 + 44, H + 36);
    const n = 14, sw = W / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? '#2b8a45' : '#34a14f';
      ctx.fillRect(i * sw, 0, sw + 1, H);
    }
    ctx.strokeStyle = LINE; ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, W, H);
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    circ(W / 2, H / 2, 90); ctx.stroke();
    ctx.fillStyle = LINE; circ(W / 2, H / 2, 4); ctx.fill();
    side(1); side(2);
  }

  function drawPlayers(now) {
    const { PR } = cfg;
    ents.forEach((e, id) => {
      const r = roster.get(id);
      if (!r || !r.t) return;
      ctx.fillStyle = 'rgba(0,0,0,.28)'; circ(e.x + 2, e.y + 4, PR); ctx.fill();
      circ(e.x, e.y, PR); ctx.fillStyle = COL[r.t]; ctx.fill();
      ctx.lineWidth = e.k ? 3.5 : 2; ctx.strokeStyle = e.k ? '#fff' : '#0a0a0a'; ctx.stroke();
      if (id === me) {
        ctx.save(); ctx.setLineDash([4, 4]); ctx.lineDashOffset = -now / 60;
        ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2; circ(e.x, e.y, PR + 6); ctx.stroke(); ctx.restore();
      }
      ctx.textAlign = 'center';
      ctx.font = '8px "Press Start 2P", monospace'; ctx.fillStyle = '#fff';
      ctx.fillText(r.n.charAt(0).toUpperCase(), e.x + 0.5, e.y + 4);
      ctx.font = '700 13px "Chakra Petch", sans-serif';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.strokeText(r.n, e.x, e.y - PR - 8);
      ctx.fillStyle = id === me ? '#ffe14d' : '#fff';
      ctx.fillText(r.n, e.x, e.y - PR - 8);
    });
  }

  function drawRings(now) {
    const { PR } = cfg;
    rings = rings.filter(r => now - r.t < 320);
    for (const r of rings) {
      const e = ents.get(r.id);
      if (!e) continue;
      const a = (now - r.t) / 320;
      ctx.save();
      ctx.shadowColor = '#fff'; ctx.shadowBlur = 18;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.35 * (1 - a)) + ')';
      circ(e.x, e.y, PR + 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,' + (1 - a) + ')';
      ctx.lineWidth = 5 * (1 - a) + 1;
      circ(e.x, e.y, PR + 3 + a * 20); ctx.stroke();
      ctx.restore();
    }
  }

  function drawBall() {
    if (activeModifier === 'invisible' && !ballVisible) return;
   const BR = ball.r || cfg.BR;
    ctx.fillStyle = 'rgba(0,0,0,.3)'; circ(ball.x + 2, ball.y + 4, BR); ctx.fill();
    circ(ball.x, ball.y, BR); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#111'; ctx.stroke();
    ctx.save();
    ctx.translate(ball.x, ball.y); ctx.rotate(ball.rot);
    ctx.fillStyle = '#111'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) { const a = i * TAU / 5; ctx.lineTo(Math.cos(a) * 4.2, Math.sin(a) * 4.2); }
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = i * TAU / 5;
      ctx.moveTo(Math.cos(a) * 4.2, Math.sin(a) * 4.2); ctx.lineTo(Math.cos(a) * BR * 0.92, Math.sin(a) * BR * 0.92);
    }
    ctx.stroke(); ctx.restore();
  }

  let lt = performance.now();
  function frame(now) {
    const dt = Math.min((now - lt) / 1000, 0.1); lt = now;
    if (cfg && ctx) {
      const f = 1 - Math.exp(-dt * 28);
      ents.forEach(e => {
        if (Math.abs(e.tx - e.x) + Math.abs(e.ty - e.y) > 120) { e.x = e.tx; e.y = e.ty; }
        else { e.x += (e.tx - e.x) * f; e.y += (e.ty - e.y) * f; }
      });
      const px = ball.x, py = ball.y;
      if (Math.abs(ball.tx - px) + Math.abs(ball.ty - py) > 150) { ball.x = ball.tx; ball.y = ball.ty; }
      else { ball.x += (ball.tx - px) * f; ball.y += (ball.ty - py) * f; }
      ball.rot += (ball.x - px + ball.y - py) / cfg.BR;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, vw, vh);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
      drawField();
      drawPlayers(now);
      drawRings(now);
      if (ball.ok) drawBall();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
