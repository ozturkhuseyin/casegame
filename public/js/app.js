/* ============================================================
   Şüpheli Ölüm — istemci uygulaması
   Socket.IO ile sunucu-otoriteli durumu alır ve UI'ı çizer.
   ============================================================ */

const socket = io();

// Kalıcı oyuncu kimliği (reconnect için)
let playerId = localStorage.getItem('so_playerId');
if (!playerId) {
  playerId = 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem('so_playerId', playerId);
}

let state = null;          // sunucudan gelen son durum
let currentCode = null;
let selectedVerdict = null;
let timerInterval = null;

// Sesli sohbet modülünü başlat (Bölüm 8)
Voice.init(socket, playerId, (on) => {
  $('btn-voice').textContent = on ? '🎙️ Ses: Açık' : '🎙️ Ses: Kapalı';
  $('btn-voice').classList.toggle('voice-on', on);
});

// ---------- yardımcılar ----------
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(id).classList.add('active');
}
function notify(text) {
  const t = $('notify-toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 3500);
}

// ---------- LOBİ ----------
$('btn-create').onclick = () => {
  const name = $('input-name').value.trim();
  if (!name) return ($('lobby-error').textContent = 'Önce ismini gir.');
  socket.emit('lobby:create', { name, playerId }, (res) => {
    if (res.error) return ($('lobby-error').textContent = res.error);
    currentCode = res.code;
    localStorage.setItem('so_lastCode', res.code);
  });
};
$('btn-join').onclick = () => {
  const name = $('input-name').value.trim();
  const code = $('input-code').value.trim().toUpperCase();
  if (!name) return ($('lobby-error').textContent = 'Önce ismini gir.');
  if (!code) return ($('lobby-error').textContent = 'Oda kodu gir.');
  socket.emit('lobby:join', { name, code, playerId }, (res) => {
    if (res.error) return ($('lobby-error').textContent = res.error);
    currentCode = res.code;
    localStorage.setItem('so_lastCode', res.code);
  });
};

// otomatik yeniden bağlanma denemesi
const lastCode = localStorage.getItem('so_lastCode');
if (lastCode) {
  socket.emit('lobby:reconnect', { code: lastCode, playerId }, (res) => {
    if (res && res.ok) currentCode = res.code;
  });
}

$('btn-start').onclick = () => {
  const rounds = $('select-rounds').value ? Number($('select-rounds').value) : undefined;
  socket.emit('game:start', { rounds }, (res) => {
    if (res.error) notify(res.error);
  });
};
$('btn-skip').onclick = () => socket.emit('action:skipPhase', {}, (r) => { if (r.error) notify(r.error); });
$('btn-back-lobby').onclick = () => location.reload();

// ---------- DURUM ALMA ----------
socket.on('state', (s) => {
  state = s;
  currentCode = s.code;
  render();
  Voice.updateRouting(s); // proximity ses yönlendirmesini güncelle
});

socket.on('announce', (a) => {
  if (a.fromId === playerId) return;
  showAnnounceToast(a);
});

socket.on('pressure', ({ trigger }) => showPressureBanner(trigger));

socket.on('chat:relay', (msg) => receiveChat(msg));

// Ses aç/kapat
$('btn-voice').onclick = () => Voice.toggle();

// ============================================================
//  RENDER
// ============================================================
function render() {
  if (!state) return;
  $('topbar-code') && ($('topbar-code').textContent = 'Oda: ' + state.code);

  if (state.phase === 'lobby') {
    renderWaiting();
  } else if (state.phase === 'explore' || state.phase === 'discussion') {
    renderGame();
  } else if (state.phase === 'vote') {
    renderVote();
  } else if (state.phase === 'reveal') {
    renderReveal();
  }
}

// ---------- Bekleme odası ----------
function renderWaiting() {
  showScreen('screen-waiting');
  $('room-code').textContent = state.code;
  const list = $('waiting-players');
  list.innerHTML = '';
  (state.lobbyPlayers || []).forEach((p) => {
    const li = el('li');
    li.appendChild(el('span', null, p.name + (p.id === playerId ? ' (sen)' : '')));
    if (p.isHost) li.appendChild(el('span', 'badge-host', 'HOST'));
    list.appendChild(li);
  });
  const amHost = state.lobbyPlayers?.find((p) => p.id === playerId)?.isHost;
  $('host-controls').classList.toggle('hidden', !amHost);
  $('waiting-hint').classList.toggle('hidden', !!amHost);
}

// ---------- Oyun ekranı ----------
function renderGame() {
  showScreen('screen-game');
  const you = state.you;

  // Üst şerit
  const pressure = state.isPressureRound;
  $('phase-label').textContent = state.phase === 'explore'
    ? (pressure ? 'BASKI TURU' : 'Keşif Fazı')
    : 'Tartışma Fazı';
  $('phase-label').classList.toggle('pressure', !!pressure);
  $('round-label').textContent = `Tur ${state.round} / ${state.totalRounds}`;
  $('btn-skip').classList.toggle('hidden', !you.isHost);
  startTimer();

  // Telefon butonu (sadece telefonu olanlara / ele geçirene)
  $('btn-phone').classList.toggle('hidden', !state.phone.has);

  // Kürsü kontrolü (sadece tartışma fazı)
  renderFloor();

  // Baskı banner'ı (state ile senkron)
  if (pressure && state.pressureTrigger) showPressureBanner(state.pressureTrigger, true);
  else $('pressure-banner').classList.add('hidden');

  // Odanı dinleyenler uyarısı (Bölüm 8.2 — yakalanma)
  const lw = $('listeners-warning');
  if (state.listenersOnYourRoom && state.listenersOnYourRoom.length) {
    lw.textContent = '👂 Birileri bu odayı dinliyor: ' + state.listenersOnYourRoom.join(', ');
    lw.classList.remove('hidden');
  } else lw.classList.add('hidden');

  // Rol kartı
  $('role-name').textContent = you.roleName || '—';
  $('role-type').textContent = you.roleType === 'key' ? 'Anahtar Rol' : 'Çevre Rol';
  $('role-secret').textContent = you.secret ? 'Sır: ' + you.secret : '';
  $('role-secret').classList.toggle('hidden', !you.secret);
  $('role-goal').textContent = you.goal ? 'Amaç: ' + you.goal : '';
  $('role-goal').classList.toggle('hidden', !you.goal);
  $('role-behavior').textContent = you.suspiciousBehavior ? '“' + you.suspiciousBehavior + '”' : '';

  // AP
  $('ap-value').textContent = you.ap;

  renderPlayerList();
  renderHouseMap();
  renderRoomContent();
  renderInventory();

  // Not defteri (odak değiştirmeden senkron tut)
  const nb = $('notebook');
  if (document.activeElement !== nb) nb.value = you.notebook || '';

  // Tartışma fazında eylemler kısıtlı; sadece bilgi/iletişim
  const isExplore = state.phase === 'explore';
  document.querySelectorAll('.act-explore').forEach((b) => (b.disabled = !isExplore));

  // Açıksa telefon modalını tazele
  if (!$('phone-modal').classList.contains('hidden')) renderPhone();
}

function renderPlayerList() {
  const ul = $('player-list');
  ul.innerHTML = '';
  state.players.forEach((p) => {
    const li = el('li');
    if (!p.connected) li.classList.add('disconnected');
    const dotCls = p.visibility === 'self' ? 'you'
      : p.visibility === 'same' ? 'same'
      : p.visibility === 'adjacent' ? 'adj' : 'hidden-dot';
    li.appendChild(el('span', 'dot ' + dotCls));
    li.appendChild(el('span', null, p.name + (p.visibility === 'self' ? ' (sen)' : '')));
    if (p.busy) li.appendChild(el('span', 'busy-tag', ' meşgul'));
    if (p.position) {
      const room = state.rooms.find((r) => r.id === p.position);
      li.appendChild(el('span', 'pl-loc', room ? room.name : ''));
    } else if (p.visibility === 'hidden') {
      li.appendChild(el('span', 'pl-loc', '?'));
    }
    // Telefon ele geçirme (aynı odadaki başka oyuncu — Bölüm 9.4)
    if (p.visibility === 'same' && state.phase === 'explore') {
      const seize = el('button', 'mini-btn act-explore', '📱');
      seize.title = `Telefonu ele geçir (${state.apCosts.seize_phone} AP)`;
      seize.onclick = () => socket.emit('action:phoneSeize', { targetId: p.id }, (r) => {
        if (r.error) notify(r.error);
        else notify('Telefon ele geçirildi! ' + (r.witnesses?.length ? 'Tanıklar: ' + r.witnesses.join(', ') : ''));
      });
      li.appendChild(seize);
    }
    ul.appendChild(li);
  });
}

function renderHouseMap() {
  const map = $('house-map');
  map.innerHTML = '';
  const you = state.you;
  const myRoom = you.position;
  const adj = state.rooms.find((r) => r.id === myRoom)?.adjacent || [];

  state.rooms.forEach((r) => {
    const cell = el('div', 'room-cell');
    cell.style.gridColumn = r.grid.col + 1;
    cell.style.gridRow = r.grid.row + 1;
    if (r.id === myRoom) cell.classList.add('current');
    else if (adj.includes(r.id)) cell.classList.add('adjacent');

    cell.appendChild(el('div', 'rc-name', r.name));
    cell.appendChild(el('div', 'rc-role', r.role));

    // Hareket maliyeti rozeti
    if (r.id !== myRoom) {
      const cost = adj.includes(r.id) ? state.apCosts.move_adjacent : state.apCosts.move_far;
      cell.appendChild(el('div', 'rc-cost', cost + ' AP'));
    }

    // Görünür oyuncular
    const pc = el('div', 'rc-players');
    state.players.forEach((p) => {
      if (p.position === r.id) {
        const chip = el('span', 'pchip' + (p.visibility === 'self' ? ' you' : '') + (p.busy ? ' busy' : ''), p.name + (p.busy ? ' 👂' : ''));
        pc.appendChild(chip);
      }
    });
    cell.appendChild(pc);

    // Duvar dinleme butonu (yan odalar — Bölüm 8.2)
    if (adj.includes(r.id)) {
      const listening = state.myEavesdropTarget === r.id;
      const ear = el('button', 'ear-btn' + (listening ? ' active' : ''), listening ? '👂 Dinliyorsun' : `👂 Dinle (${state.apCosts.eavesdrop} AP)`);
      ear.onclick = (e) => {
        e.stopPropagation();
        socket.emit('action:eavesdrop', { targetRoom: r.id }, (res) => { if (res.error) notify(res.error); });
      };
      cell.appendChild(ear);
    }

    cell.onclick = () => {
      if (r.id === myRoom) return;
      if (state.phase !== 'explore') return notify('Sadece Keşif Fazında hareket edebilirsin.');
      socket.emit('action:move', { room: r.id }, (res) => { if (res.error) notify(res.error); });
    };
    map.appendChild(cell);
  });
}

function renderRoomContent() {
  $('room-title').textContent = state.currentRoom.name;
  $('room-role').textContent = state.currentRoom.role;
  const ul = $('object-list');
  ul.innerHTML = '';

  // Birlikte arama (Bölüm 16) — odada başka oyuncu varsa
  const others = state.players.filter((p) => p.visibility === 'same');
  if (state.jointInvite) {
    const inv = el('li', 'joint-bar');
    inv.innerHTML = `<b>${esc(state.jointInvite.initiatorName)}</b> birlikte arama çağırıyor (${state.jointInvite.eachCost} AP).`;
    const acc = el('button', 'small announce act-explore', 'Katıl');
    acc.onclick = () => socket.emit('action:jointAccept', {}, (r) => {
      if (r.error) notify(r.error);
      else if (r.found?.length) notify('Gizli bulgu: ' + r.found.join(', '));
    });
    inv.appendChild(acc);
    ul.appendChild(inv);
  } else if (others.length) {
    const ji = el('li', 'joint-bar');
    ji.innerHTML = `Bu odayı biriyle <b>birlikte ara</b> (gizli bulguları açar, AP bölünür).`;
    const b = el('button', 'small act-explore', 'Birlikte Ara Çağrısı');
    b.onclick = () => socket.emit('action:jointInvite', {}, (r) => { if (r.error) notify(r.error); else notify('Davet gönderildi.'); });
    ji.appendChild(b);
    ul.appendChild(ji);
  }

  if (!state.roomObjects.length && !state.roomSlots.length) {
    ul.appendChild(el('li', 'empty-note', 'Bu odada dikkat çeken bir şey yok.'));
  }

  state.roomObjects.forEach((o) => {
    const li = el('li', 'obj-item' + (o.hidden ? ' hidden-obj' : ''));
    li.appendChild(el('div', 'obj-name', (o.hidden ? '🔒 ' : '') + o.name));
    li.appendChild(el('div', 'obj-surface', o.surface));
    if (o.deep) li.appendChild(el('div', 'obj-deep', o.deep));
    const actions = el('div', 'obj-actions');
    if (!o.deep) {
      const b = el('button', 'small act-explore', `Araştır (${state.apCosts.investigate} AP)`);
      b.onclick = () => socket.emit('action:investigate', { objId: o.id }, (r) => { if (r.error) notify(r.error); });
      actions.appendChild(b);
    }
    const t = el('button', 'small act-explore', `Al (${state.apCosts.take_object} AP)`);
    t.onclick = () => socket.emit('action:take', { objId: o.id }, (r) => {
      if (r.error) notify(r.error);
      else if (r.witnesses?.length) notify('Tanıklar: ' + r.witnesses.join(', '));
    });
    actions.appendChild(t);
    li.appendChild(actions);
    ul.appendChild(li);
  });

  // Boş yuvalar (Bölüm 4) — oyuncular doldurur
  state.roomSlots.forEach((s) => {
    const li = el('li', 'obj-item slot-item');
    li.appendChild(el('div', 'obj-name', '❓ ' + s.name));
    li.appendChild(el('div', 'obj-surface', s.prompt));
    s.fills.forEach((f) => {
      li.appendChild(el('div', 'slot-fill', `<b>${esc(f.name)}:</b> ${esc(f.text)}`));
    });
    const row = el('div', 'obj-actions');
    const input = el('input', 'slot-input');
    input.placeholder = 'İddianı yaz...';
    input.maxLength = 160;
    const b = el('button', 'small act-explore', `Ekle (${state.apCosts.fill_slot} AP)`);
    b.onclick = () => {
      if (!input.value.trim()) return;
      socket.emit('action:fillSlot', { slotId: s.slotId, text: input.value.trim() }, (r) => { if (r.error) notify(r.error); });
      input.value = '';
    };
    row.appendChild(input); row.appendChild(b);
    li.appendChild(row);
    ul.appendChild(li);
  });
}

function renderInventory() {
  const wrap = $('inventory-items');
  wrap.innerHTML = '';
  if (!state.you.inventory.length) {
    wrap.appendChild(el('span', 'empty-note', 'Boş.'));
    return;
  }
  state.you.inventory.forEach((it) => {
    const item = el('div', 'inv-item', it.name);
    const menu = el('div', 'inv-menu');

    // Bırak (izli)
    const dropDirty = el('button', null, `Bırak — izli (${state.apCosts.plant_dirty} AP)`);
    dropDirty.classList.add('act-explore');
    dropDirty.onclick = (e) => { e.stopPropagation(); socket.emit('action:plant', { itemUid: it.uid, clean: false }, (r) => { if (r.error) notify(r.error); else closeMenus(); }); };
    menu.appendChild(dropDirty);

    // Bırak (temiz)
    const dropClean = el('button', null, `Bırak — temiz (${state.apCosts.plant_clean} AP)`);
    dropClean.classList.add('act-explore');
    dropClean.onclick = (e) => { e.stopPropagation(); socket.emit('action:plant', { itemUid: it.uid, clean: true }, (r) => { if (r.error) notify(r.error); else closeMenus(); }); };
    menu.appendChild(dropClean);

    // Ver (aynı odadaki oyunculara)
    const sameRoom = state.players.filter((p) => p.visibility === 'same');
    sameRoom.forEach((p) => {
      const give = el('button', null, `Ver → ${p.name}`);
      give.classList.add('act-explore');
      give.onclick = (e) => { e.stopPropagation(); socket.emit('action:give', { itemUid: it.uid, targetId: p.id }, (r) => { if (r.error) notify(r.error); else closeMenus(); }); };
      menu.appendChild(give);
    });

    item.appendChild(menu);
    item.onclick = () => {
      const wasOpen = item.classList.contains('open');
      closeMenus();
      if (!wasOpen) item.classList.add('open');
    };
    wrap.appendChild(item);
  });
}
function closeMenus() { document.querySelectorAll('.inv-item.open').forEach((i) => i.classList.remove('open')); }
document.addEventListener('click', (e) => { if (!e.target.closest('.inv-item')) closeMenus(); });

// ---------- Not defteri senkronu ----------
let nbTimer = null;
$('notebook').addEventListener('input', (e) => {
  clearTimeout(nbTimer);
  const text = e.target.value;
  nbTimer = setTimeout(() => socket.emit('action:notebook', { text }), 500);
});

// ---------- Sohbet ----------
function sendChat() {
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chat:send', { text }, (r) => { if (r.error) notify(r.error); });
  input.value = '';
}
$('btn-chat-send').onclick = sendChat;
$('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

function receiveChat(msg) {
  if (!state) return;
  const myRoom = state.you.position;
  const adj = state.rooms.find((r) => r.id === myRoom)?.adjacent || [];
  let cls = 'cm';
  let display;
  if (msg.room === myRoom) {
    display = `<span class="who">${esc(msg.fromName)}:</span> ${esc(msg.text)}`;
  } else if (adj.includes(msg.room)) {
    // Yan oda: boğuk — kelimeler seçilmez (Bölüm 8.1)
    cls += ' muffled';
    display = `<span class="who">(yan odadan)</span> ${muffle(msg.text)}`;
  } else {
    return; // uzak oda: hiç duyulmaz
  }
  const box = $('chat-messages');
  const line = el('div', cls, display);
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}
function muffle(text) {
  return text.split(/\s+/).map((w) => '·'.repeat(Math.min(w.length, 6))).join(' ');
}
function esc(s) { return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------- Announce ----------
$('btn-announce').onclick = () => {
  const text = $('chat-input').value.trim() || 'Bir şey buldum!';
  socket.emit('action:announce', { message: text }, (r) => {
    if (r.error) notify(r.error);
    else $('chat-input').value = '';
  });
};
function showAnnounceToast(a) {
  const t = $('announce-toast');
  t.innerHTML = '';
  t.appendChild(el('div', null, `<span class="ann-from">${esc(a.fromName)}</span> — ${esc(a.roomName)}: "${esc(a.message)}"`));
  const actions = el('div', 'toast-actions');
  const go = el('button', 'small announce', 'Odaya Git (ücretsiz)');
  go.onclick = () => {
    socket.emit('action:goto', { room: a.room }, (r) => { if (r.error) notify(r.error); });
    t.classList.add('hidden');
  };
  const ignore = el('button', 'small', 'Yoksay');
  ignore.onclick = () => t.classList.add('hidden');
  actions.appendChild(go); actions.appendChild(ignore);
  t.appendChild(actions);
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 10000);
}

// ---------- Baskı turu banner'ı (Bölüm 12.2) ----------
function showPressureBanner(text, persist) {
  const b = $('pressure-banner');
  b.textContent = '⚠️ ' + text;
  b.classList.remove('hidden');
  clearTimeout(b._timer);
  if (!persist) b._timer = setTimeout(() => b.classList.add('hidden'), 6000);
}

// ---------- Kürsü / söz hakkı (Bölüm 12.5) ----------
function renderFloor() {
  const btn = $('btn-floor');
  const ind = $('floor-indicator');
  if (state.phase !== 'discussion') {
    btn.classList.add('hidden');
    ind.classList.add('hidden');
    return;
  }
  btn.classList.remove('hidden');
  const holder = state.floorHolderId;
  if (holder === state.you.id) {
    btn.textContent = 'Sözü Bırak';
    btn.onclick = () => socket.emit('action:floorRelease', {}, (r) => { if (r.error) notify(r.error); });
    ind.textContent = '🎤 Söz sende';
    ind.classList.remove('hidden');
  } else if (holder) {
    btn.textContent = 'Söz İste';
    btn.disabled = true;
    ind.textContent = '🎤 Söz: ' + (state.floorHolderName || '');
    ind.classList.remove('hidden');
  } else {
    btn.textContent = 'Söz İste';
    btn.disabled = false;
    btn.onclick = () => socket.emit('action:floorRequest', {}, (r) => { if (r.error) notify(r.error); });
    ind.classList.add('hidden');
  }
}

// ---------- Telefon (Bölüm 9) ----------
$('btn-phone').onclick = () => { $('phone-modal').classList.remove('hidden'); renderPhone(); };
$('phone-close').onclick = () => $('phone-modal').classList.add('hidden');
$('phone-send').onclick = () => {
  const to = $('phone-to').value;
  const text = $('phone-text').value.trim();
  if (!to || !text) return;
  socket.emit('action:phoneSend', { toOwnerId: to, text }, (r) => {
    if (r.error) notify(r.error);
    else { $('phone-text').value = ''; renderPhone(); }
  });
};
$('phone-call').onclick = () => {
  const to = $('phone-to').value;
  if (state.callPartnerId) {
    socket.emit('action:callEnd', {}, () => {});
  } else if (to) {
    socket.emit('action:callStart', { toOwnerId: to }, (r) => { if (r.error) notify(r.error); });
  }
};
function renderPhone() {
  if (!state || !state.phone) return;
  const wrap = $('phone-devices');
  wrap.innerHTML = '';
  state.phone.devices.forEach((d) => {
    const dev = el('div', 'phone-device');
    dev.appendChild(el('div', 'phone-device-head', (d.isOwn ? '📱 Senin telefonun' : `🔓 ${esc(d.ownerName)} (ele geçirildi)`)));
    if (!d.messages.length) dev.appendChild(el('div', 'phone-empty', 'Mesaj yok.'));
    d.messages.forEach((m) => {
      const row = el('div', 'phone-msg ' + m.dir + (m.deleted ? ' deleted' : ''));
      if (m.deleted) {
        row.innerHTML = `<i>[silinmiş mesaj]</i>`;
      } else {
        const label = m.dir === 'in' ? `← ${esc(m.other)}` : `→ ${esc(m.other)}`;
        row.innerHTML = `<span class="pm-label">${label}</span> ${esc(m.text)}`;
        const del = el('button', 'mini-btn', '🗑');
        del.title = `Sil (${state.apCosts.phone_delete} AP, iz bırakır)`;
        del.onclick = () => socket.emit('action:phoneDelete', { msgId: m.id }, (r) => { if (r.error) notify(r.error); else renderPhone(); });
        row.appendChild(del);
      }
      dev.appendChild(row);
    });
    wrap.appendChild(dev);
  });
  // Kişiler
  const sel = $('phone-to');
  sel.innerHTML = '';
  (state.phone.contacts || []).forEach((c) => {
    const opt = el('option', null, c.ownerName);
    opt.value = c.ownerId;
    sel.appendChild(opt);
  });
  // Arama durumu
  $('phone-call').textContent = state.callPartnerId ? 'Aramayı Bitir' : 'Ara';
  $('phone-call-status').textContent = state.callPartnerId
    ? '🔊 Sesli arama aktif (mesafe-bağımsız). Sesi duymak için "Ses: Açık" olmalı.'
    : `Arama ${state.apCosts.phone_call} AP, mesaj ${state.apCosts.phone_message} AP.`;
}

// ---------- Timer ----------
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  const update = () => {
    if (!state.phaseEndsAt) { $('timer').textContent = '--:--'; return; }
    const ms = state.phaseEndsAt - Date.now();
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    $('timer').textContent = `${m}:${String(s % 60).padStart(2, '0')}`;
    $('timer').classList.toggle('urgent', s <= 15);
  };
  update();
  timerInterval = setInterval(update, 500);
}

// ---------- Oylama ----------
function renderVote() {
  showScreen('screen-vote');
  startTimer();
  document.querySelectorAll('.verdict').forEach((b) => {
    b.classList.toggle('selected', b.dataset.verdict === selectedVerdict);
    b.onclick = () => {
      selectedVerdict = b.dataset.verdict;
      $('suspect-section').classList.toggle('hidden', selectedVerdict !== 'cinayet');
      $('btn-cast-vote').disabled = false;
      renderVote();
    };
  });
  // Şüpheli listesi
  const sel = $('suspect-select');
  if (!sel.dataset.filled) {
    sel.innerHTML = '';
    state.players.forEach((p) => {
      const opt = el('option', null, p.name + (p.visibility === 'self' ? ' (sen)' : ''));
      opt.value = p.id;
      sel.appendChild(opt);
    });
    sel.dataset.filled = '1';
  }
  $('vote-status').textContent = state.you.vote ? 'Oyun kaydedildi. Diğerleri bekleniyor...' : '';
}
$('btn-cast-vote').onclick = () => {
  if (!selectedVerdict) return;
  const suspectId = selectedVerdict === 'cinayet' ? $('suspect-select').value : null;
  socket.emit('action:vote', { verdict: selectedVerdict, suspectId }, (r) => {
    if (r.error) notify(r.error);
    else { $('btn-cast-vote').disabled = true; $('vote-status').textContent = 'Oyun kaydedildi.'; }
  });
};

// ---------- İfşa ----------
const VERDICT_TR = { cinayet: 'Cinayet', kaza: 'Kaza', intihar: 'İntihar' };
function renderReveal() {
  showScreen('screen-reveal');
  if (timerInterval) clearInterval(timerInterval);
  const res = state.results;
  if (!res) return;

  const sum = $('reveal-summary');
  sum.innerHTML = '';
  sum.appendChild(el('div', 'big', 'Gerçeklik: ' + res.groundTruth.label));
  sum.appendChild(el('div', null, `Çoğunluk kararı: <b>${VERDICT_TR[res.majorityVerdict]}</b> ` +
    `<span class="${res.verdictCorrect ? 'verdict-correct' : 'verdict-wrong'}">(${res.verdictCorrect ? 'DOĞRU' : 'YANLIŞ'})</span>`));
  if (res.groundTruth.type === 'cinayet') {
    const m = state.players.find((p) => p.id === res.groundTruth.murdererPlayerId);
    sum.appendChild(el('div', null, `Gerçek fail: <b>${m ? m.name : '—'}</b>`));
    sum.appendChild(el('div', null, `Fail yakalandı mı? <span class="${res.culpritCaught ? 'verdict-correct' : 'verdict-wrong'}">${res.culpritCaught ? 'EVET' : 'HAYIR'}</span>`));
  }
  sum.appendChild(el('div', null, `Oylar — Cinayet: ${res.tally.cinayet}, Kaza: ${res.tally.kaza}, İntihar: ${res.tally.intihar}`));
  sum.appendChild(el('div', null, `<br>Çözüm zinciri: ${res.solutionChain.join(' → ')}`));

  const secrets = $('reveal-secrets');
  secrets.innerHTML = '';
  res.revealedSecrets.forEach((s) => {
    const li = el('li');
    li.innerHTML = `<b>${esc(s.name || '?')}</b> (${esc(s.roleName)})` +
      (s.isMurderer ? ' <span class="murderer-tag">— KATİL</span>' : '') +
      `<br>Sır: ${esc(s.secret)}<br>Amaç: ${esc(s.goal || '—')}`;
    secrets.appendChild(li);
  });

  const log = $('reveal-log');
  log.innerHTML = '';
  (state.eventLog || []).forEach((e) => {
    const li = el('li', 'type-' + e.type);
    li.innerHTML = `<span class="lt">#${e.t}</span>[T${e.round}/${e.phase}] ${esc(e.text)}`;
    log.appendChild(li);
  });
}
