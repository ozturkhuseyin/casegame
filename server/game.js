// ============================================================================
//  OYUN STATE MACHINE — Sunucu otoriteli World State + Event Log + Fazlar
//  (Bölüm 11 akış, 13 multiplayer, 14 AP, 7 yakınlık, 22 veri yapısı)
// ============================================================================

import {
  ROOMS, START_ROOM, AP_COSTS, scalingFor, OBJECT_DEFS, ITEM_NAMES, ROLE_DEFS,
  HIDDEN_OBJECT_DEFS, SLOT_DEFS, planRoundTypes, PRESSURE_TRIGGERS,
} from './data.js';
import { generateScenario, describeObject } from './scenario.js';

export const PHASE = {
  LOBBY: 'lobby',
  EXPLORE: 'explore',
  DISCUSSION: 'discussion',
  VOTE: 'vote',
  REVEAL: 'reveal',
};

let GAME_CLOCK = 0; // artan zaman damgası (in-game)

export class Game {
  constructor(code, hostId, broadcast) {
    this.code = code;
    this.hostId = hostId;
    this.broadcast = broadcast; // (event, payload) => void  — odaya yayınlar
    this.players = new Map();   // playerId -> player
    this.phase = PHASE.LOBBY;
    this.round = 0;
    this.scaling = scalingFor(0);
    this.scenario = null;
    this.investigated = new Set();   // global araştırılmış nesneler
    this.roomObjects = {};           // room -> [objId] (taşınabilir)
    this.eventLog = [];
    this.phaseEndsAt = null;
    this.timer = null;
    this.settings = { rounds: null, exploreSeconds: null, discussionSeconds: null };
    this.chat = []; // {round, room, fromId, fromName, text, t}

    // --- Genişletilmiş sistemler ---
    this.roundTypes = [];          // [bool] tur baskı turu mu (Bölüm 12.2)
    this.pressureTrigger = null;   // aktif baskı turu tetikleyici metni
    this.hiddenByRoom = {};        // room -> [objId] (birlikte arama ile açılır, Bölüm 16)
    this.revealedHidden = new Set(); // açığa çıkmış gizli nesneler
    this.slots = {};               // room -> [{slotId, fills:[{name, text}]}] (Bölüm 4)
    this.phones = new Map();       // deviceOwnerId -> { holderId, messages:[] } (Bölüm 9)
    this.calls = [];               // [{a, b}] aktif sesli aramalar (mesafe-bağımsız)
    this.jointInvites = new Map(); // room -> { id, initiatorId, initiatorName, t }
    this.eavesdrop = new Map();    // playerId -> targetRoom (duvar dinleme, Bölüm 8.2)
    this.floorHolderId = null;     // kürsü sahibi (Bölüm 12.5)
    this.floorTimer = null;
  }

  // -------------------------------------------------------------------------
  //  OYUNCU YÖNETİMİ
  // -------------------------------------------------------------------------
  addPlayer(id, name) {
    if (this.players.has(id)) {
      this.players.get(id).connected = true;
      return this.players.get(id);
    }
    const player = {
      id, name,
      connected: true,
      isHost: id === this.hostId,
      position: START_ROOM,
      ap: 0,
      roleId: null,
      inventory: [],
      notebook: '',
      vote: null,        // { verdict, suspectId }
      busy: false,       // dinleme/eylem göstergesi (Bölüm 8.2)
    };
    this.players.set(id, player);
    return player;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.phase === PHASE.LOBBY) {
      this.players.delete(id);
    } else {
      p.connected = false; // oyun içinde: yeniden bağlanabilsin (Bölüm 13.3)
    }
  }

  reassignHostIfNeeded() {
    if (this.players.has(this.hostId) && this.players.get(this.hostId).connected) return;
    const next = [...this.players.values()].find((p) => p.connected);
    if (next) {
      this.hostId = next.id;
      this.players.forEach((p) => { p.isHost = p.id === next.id; });
    }
  }

  log(type, text, playerId = null, extra = {}) {
    GAME_CLOCK += 1;
    this.eventLog.push({
      t: GAME_CLOCK,
      round: this.round,
      phase: this.phase,
      playerId,
      type,
      text,
      ...extra,
    });
  }

  // -------------------------------------------------------------------------
  //  OYUN BAŞLATMA — Senaryo üretimi + rol dağıtımı (Bölüm 13.1)
  // -------------------------------------------------------------------------
  start(options = {}) {
    if (this.phase !== PHASE.LOBBY) return { error: 'Oyun zaten başladı.' };
    const playerList = [...this.players.values()];
    if (playerList.length < 2) return { error: 'En az 2 oyuncu gerekli.' };

    this.scaling = scalingFor(playerList.length);
    if (options.rounds) this.scaling.rounds = options.rounds;

    const scenario = generateScenario(playerList, this.scaling);
    this.scenario = scenario;
    this.roomObjects = JSON.parse(JSON.stringify(scenario.roomObjects));
    this.hiddenByRoom = JSON.parse(JSON.stringify(scenario.hiddenByRoom || {}));
    this.slots = JSON.parse(JSON.stringify(scenario.slots || {}));

    // Tur tiplerini planla (keşif/baskı — Bölüm 12.2)
    this.roundTypes = planRoundTypes(this.scaling.rounds, this.scaling.pressureRounds);

    // Rolleri + envanteri + başlangıç durumunu oyunculara işle
    scenario.characters.forEach((c) => {
      const p = this.players.get(c.playerId);
      if (!p) return;
      p.roleId = c.roleId;
      p.inventory = c.inventory.map((it) => ({ uid: it.uid, itemId: it.itemId }));
      p.position = START_ROOM;
      p.ap = this.scaling.apPerRound;
      // Telefonlu rollere bir telefon cihazı oluştur (Bölüm 9.1)
      if (c.hasPhone) {
        this.phones.set(c.playerId, { holderId: c.playerId, ownerName: p.name, messages: [] });
      }
    });

    this.round = 1;
    this.log('system', `Oyun başladı. Bir ölüm gerçekleşti. Gerçeği bulun.`);
    this._enterPhase(PHASE.EXPLORE);
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  //  FAZ DÖNGÜSÜ (Bölüm 11)
  // -------------------------------------------------------------------------
  _enterPhase(phase) {
    this.phase = phase;
    if (this.timer) clearTimeout(this.timer);

    let seconds = 0;
    // Eavesdrop & kürsü her faz geçişinde sıfırlanır
    this.eavesdrop.clear();
    this._clearFloor();

    if (phase === PHASE.EXPLORE) {
      const isPressure = this.roundTypes[this.round - 1] === true;
      this.pressureTrigger = null;
      if (isPressure) {
        // Baskı turu: kısa süre, bol AP, kurgu tetikleyici (Bölüm 12.2)
        seconds = this.scaling.pressureExploreSeconds;
        this.players.forEach((p) => { p.ap = this.scaling.pressureApPerRound; p.busy = false; });
        this.pressureTrigger = PRESSURE_TRIGGERS[Math.floor(Math.random() * PRESSURE_TRIGGERS.length)];
        this.log('system', `Tur ${this.round} — BASKI TURU! ${this.pressureTrigger}`);
        this.broadcast('pressure', { trigger: this.pressureTrigger });
      } else {
        seconds = this.scaling.exploreSeconds;
        this.players.forEach((p) => { p.ap = this.scaling.apPerRound; p.busy = false; });
        this.log('system', `Tur ${this.round} — Keşif Fazı başladı.`);
      }
    } else if (phase === PHASE.DISCUSSION) {
      seconds = this.scaling.discussionSeconds;
      this.log('system', `Tur ${this.round} — Tartışma Fazı başladı.`);
    } else if (phase === PHASE.VOTE) {
      seconds = this.scaling.voteSeconds;
      this.log('system', `Son Oylama başladı.`);
    } else if (phase === PHASE.REVEAL) {
      this._computeResults();
      this.log('system', `İfşa Fazı — gerçeklik ve tüm event log açıldı.`);
    }

    if (phase !== PHASE.REVEAL) {
      this.phaseEndsAt = Date.now() + seconds * 1000;
      this.timer = setTimeout(() => this._advancePhase(), seconds * 1000);
    } else {
      this.phaseEndsAt = null;
    }
    this._pushState();
  }

  _advancePhase() {
    if (this.phase === PHASE.EXPLORE) {
      this._enterPhase(PHASE.DISCUSSION);
    } else if (this.phase === PHASE.DISCUSSION) {
      if (this.round >= this.scaling.rounds) {
        this._enterPhase(PHASE.VOTE);
      } else {
        this.round += 1;
        this._enterPhase(PHASE.EXPLORE);
      }
    } else if (this.phase === PHASE.VOTE) {
      this._enterPhase(PHASE.REVEAL);
    }
  }

  // Host fazı erken bitirebilir
  skipPhase(playerId) {
    if (playerId !== this.hostId) return { error: 'Sadece host fazı atlayabilir.' };
    if (this.phase === PHASE.LOBBY || this.phase === PHASE.REVEAL) return { error: 'Bu fazda atlanamaz.' };
    this._advancePhase();
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  //  YAKINLIK & GÖRÜNÜRLÜK (Bölüm 7)
  // -------------------------------------------------------------------------
  _playersInRoom(room) {
    return [...this.players.values()].filter((p) => p.position === room);
  }

  _visiblePlayers(viewer) {
    // Aynı oda: tam görünür. Komşu oda: geçiş/varlık. Uzak: görünmez.
    const adj = ROOMS[viewer.position]?.adjacent || [];
    return [...this.players.values()].map((p) => {
      let visibility = 'hidden';
      if (p.id === viewer.id) visibility = 'self';
      else if (p.position === viewer.position) visibility = 'same';
      else if (adj.includes(p.position)) visibility = 'adjacent';
      return {
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        connected: p.connected,
        visibility,
        // Konum yalnızca aynı/komşu odadaysa ifşa edilir (anti-cheat, Bölüm 13.2)
        position: visibility === 'same' || visibility === 'adjacent' ? p.position : null,
        busy: visibility === 'same' || visibility === 'adjacent' ? p.busy : false,
        roleName: this.phase === PHASE.REVEAL ? ROLE_DEFS[p.roleId]?.name : null,
        ap: p.id === viewer.id ? p.ap : null,
      };
    });
  }

  // -------------------------------------------------------------------------
  //  EYLEMLER (AP ekonomisi — Bölüm 14)
  // -------------------------------------------------------------------------
  _requireExplore(p) {
    if (this.phase !== PHASE.EXPLORE) return 'Eylemler yalnızca Keşif Fazında yapılabilir.';
    if (!p) return 'Oyuncu bulunamadı.';
    return null;
  }

  move(playerId, targetRoom) {
    const p = this.players.get(playerId);
    const err = this._requireExplore(p);
    if (err) return { error: err };
    if (!ROOMS[targetRoom]) return { error: 'Geçersiz oda.' };
    if (targetRoom === p.position) return { error: 'Zaten bu odadasın.' };

    const adjacent = ROOMS[p.position].adjacent.includes(targetRoom);
    const cost = adjacent ? AP_COSTS.move_adjacent : AP_COSTS.move_far;
    if (p.ap < cost) return { error: `Yetersiz AP (gerekli: ${cost}).` };

    p.ap -= cost;
    const from = p.position;
    p.position = targetRoom;
    this.eavesdrop.delete(playerId); // oda değişti → dinleme iptal
    p.busy = false;
    this.log('move', `${p.name}, ${ROOMS[from].name} → ${ROOMS[targetRoom].name} odasına geçti.`, playerId, { from, to: targetRoom });
    this._pushState();
    return { ok: true };
  }

  investigate(playerId, objId) {
    const p = this.players.get(playerId);
    const err = this._requireExplore(p);
    if (err) return { error: err };
    const objs = this.roomObjects[p.position] || [];
    if (!objs.includes(objId)) return { error: 'Bu nesne bu odada değil.' };
    if (this.investigated.has(objId)) return { error: 'Bu nesne zaten araştırıldı.' };
    if (p.ap < AP_COSTS.investigate) return { error: 'Yetersiz AP.' };

    p.ap -= AP_COSTS.investigate;
    this.investigated.add(objId);
    const def = OBJECT_DEFS[objId];
    this.log('investigate', `${p.name}, "${def?.name || objId}" nesnesini araştırdı.`, playerId, { objId, room: p.position });
    this._pushState();
    return { ok: true, deep: def?.deep };
  }

  takeObject(playerId, objId) {
    const p = this.players.get(playerId);
    const err = this._requireExplore(p);
    if (err) return { error: err };
    const objs = this.roomObjects[p.position] || [];
    if (!objs.includes(objId)) return { error: 'Bu nesne bu odada değil.' };
    if (p.ap < AP_COSTS.take_object) return { error: 'Yetersiz AP.' };

    p.ap -= AP_COSTS.take_object;
    this.roomObjects[p.position] = objs.filter((o) => o !== objId);
    p.inventory.push({ uid: `${playerId}_taken_${Date.now()}`, itemId: objId, isObject: true });
    // Yakınlık izi: aynı odadaki tanıklar (Bölüm 7.1)
    const witnesses = this._playersInRoom(p.position).filter((w) => w.id !== playerId).map((w) => w.name);
    this.log('take', `${p.name}, bir nesneyi (${OBJECT_DEFS[objId]?.name || objId}) odadan aldı.`, playerId,
      { objId, room: p.position, witnesses });
    this._pushState();
    return { ok: true, witnesses };
  }

  // Envanterdeki eşyayı/nesneyi odaya bırak — sahte delil üretmenin yolu (Bölüm 15.2)
  plantItem(playerId, itemUid, clean) {
    const p = this.players.get(playerId);
    const err = this._requireExplore(p);
    if (err) return { error: err };
    const idx = p.inventory.findIndex((it) => it.uid === itemUid);
    if (idx < 0) return { error: 'Bu eşya envanterinde yok.' };
    const cost = clean ? AP_COSTS.plant_clean : AP_COSTS.plant_dirty;
    if (p.ap < cost) return { error: `Yetersiz AP (gerekli: ${cost}).` };

    p.ap -= cost;
    const item = p.inventory.splice(idx, 1)[0];
    // Eşya bir oda nesnesine dönüşür
    const objId = item.itemId;
    if (!this.roomObjects[p.position]) this.roomObjects[p.position] = [];
    this.roomObjects[p.position].push(objId);

    const witnesses = this._playersInRoom(p.position).filter((w) => w.id !== playerId).map((w) => w.name);
    // İz bırakma (Bölüm 6): temiz = izsiz; izli = event log + yakınlık
    if (clean) {
      this.log('plant_clean', `${p.name}, ${p.position} odasına bir eşya bıraktı (temiz).`, playerId,
        { objId, room: p.position, witnesses, hidden: true });
    } else {
      this.log('plant_dirty', `${p.name}, ${ROOMS[p.position].name} odasına bir eşya bıraktı ve iz bıraktı.`, playerId,
        { objId, room: p.position, witnesses });
    }
    this._pushState();
    return { ok: true, witnesses };
  }

  // Yakındaki oyuncuya eşya verme (Bölüm 15.2)
  giveItem(playerId, itemUid, targetId) {
    const p = this.players.get(playerId);
    const t = this.players.get(targetId);
    const err = this._requireExplore(p);
    if (err) return { error: err };
    if (!t) return { error: 'Hedef oyuncu yok.' };
    if (t.position !== p.position) return { error: 'Oyuncu aynı odada değil.' };
    const idx = p.inventory.findIndex((it) => it.uid === itemUid);
    if (idx < 0) return { error: 'Bu eşya envanterinde yok.' };

    const item = p.inventory.splice(idx, 1)[0];
    t.inventory.push(item);
    this.log('give', `${p.name}, ${t.name} oyuncusuna bir eşya verdi.`, playerId, { targetId, itemId: item.itemId });
    this._pushState();
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  //  ANNOUNCE (Bölüm 10) — ücretsiz toplanma
  // -------------------------------------------------------------------------
  announce(playerId, message) {
    const p = this.players.get(playerId);
    if (!p) return { error: 'Oyuncu yok.' };
    if (this.phase !== PHASE.EXPLORE && this.phase !== PHASE.DISCUSSION) {
      return { error: 'Bu fazda ilan yapılamaz.' };
    }
    const text = (message || '').slice(0, 140);
    this.log('announce', `${p.name} (${ROOMS[p.position].name}): "${text}"`, playerId, { room: p.position });
    this.broadcast('announce', {
      fromId: playerId,
      fromName: p.name,
      room: p.position,
      roomName: ROOMS[p.position].name,
      message: text,
    });
    this._pushState();
    return { ok: true };
  }

  // İlana uyarak ücretsiz ışınlanma (Bölüm 10.2)
  goToAnnounced(playerId, room) {
    const p = this.players.get(playerId);
    if (!p) return { error: 'Oyuncu yok.' };
    if (!ROOMS[room]) return { error: 'Geçersiz oda.' };
    p.position = room; // AP harcamaz
    this.log('move', `${p.name}, ilan üzerine ${ROOMS[room].name} odasına geldi (ücretsiz).`, playerId, { to: room, free: true });
    this._pushState();
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  //  PROXIMITY METİN SOHBETİ (Bölüm 7/8 — yakınlık tabanlı)
  // -------------------------------------------------------------------------
  sendChat(playerId, text) {
    const p = this.players.get(playerId);
    if (!p) return { error: 'Oyuncu yok.' };
    const msg = {
      room: p.position,
      fromId: playerId,
      fromName: p.name,
      text: (text || '').slice(0, 300),
      round: this.round,
      t: Date.now(),
    };
    this.chat.push(msg);
    // Yakınlık filtresi yayında uygulanır (aynı oda net, yan oda boğuk)
    this.broadcast('chat:relay', msg);
    return { ok: true };
  }

  setBusy(playerId, busy) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.busy = !!busy;
    this._pushState();
  }

  // -------------------------------------------------------------------------
  //  DUVARA DAYANIP DİNLEME (Bölüm 8.2) — yan odayı netleştir, AP harca
  // -------------------------------------------------------------------------
  toggleEavesdrop(playerId, targetRoom) {
    const p = this.players.get(playerId);
    if (!p) return { error: 'Oyuncu yok.' };
    if (this.phase !== PHASE.EXPLORE && this.phase !== PHASE.DISCUSSION) {
      return { error: 'Bu fazda dinlenemez.' };
    }
    // Kapatma
    if (this.eavesdrop.get(playerId) === targetRoom) {
      this.eavesdrop.delete(playerId);
      p.busy = false;
      this.log('eavesdrop_stop', `${p.name} dinlemeyi bıraktı.`, playerId);
      this._pushState();
      return { ok: true, listening: false };
    }
    // Hedef oda komşu mu?
    const adj = ROOMS[p.position]?.adjacent || [];
    if (!adj.includes(targetRoom)) return { error: 'Sadece yan odayı dinleyebilirsin.' };
    if (p.ap < AP_COSTS.eavesdrop) return { error: 'Yetersiz AP.' };
    p.ap -= AP_COSTS.eavesdrop;
    this.eavesdrop.set(playerId, targetRoom);
    p.busy = true; // krokide meşgul görünür → yakalanma riski (Bölüm 8.2)
    this.log('eavesdrop', `${p.name}, ${ROOMS[targetRoom].name} odasını dinlemeye başladı.`, playerId, { targetRoom });
    this._pushState();
    return { ok: true, listening: true };
  }

  // -------------------------------------------------------------------------
  //  BOŞ YUVA DOLDURMA (Bölüm 4 Adım 4)
  // -------------------------------------------------------------------------
  fillSlot(playerId, slotId, text) {
    const p = this.players.get(playerId);
    const err = this._requireExplore(p);
    if (err) return { error: err };
    const slotsHere = this.slots[p.position] || [];
    const slot = slotsHere.find((s) => s.slotId === slotId);
    if (!slot) return { error: 'Bu yuva burada değil.' };
    if (p.ap < AP_COSTS.fill_slot) return { error: 'Yetersiz AP.' };
    p.ap -= AP_COSTS.fill_slot;
    const claim = { name: p.name, playerId, text: (text || '').slice(0, 160) };
    slot.fills.push(claim);
    this.log('slot_fill', `${p.name}, "${SLOT_DEFS[slotId]?.name || slotId}" hakkında bir iddia ekledi: "${claim.text}"`, playerId, { slotId, room: p.position });
    this._pushState();
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  //  BİRLİKTE ARAMA (Bölüm 16) — AP paylaşımı + gizli nesne ifşası
  // -------------------------------------------------------------------------
  jointInvite(playerId) {
    const p = this.players.get(playerId);
    const err = this._requireExplore(p);
    if (err) return { error: err };
    const others = this._playersInRoom(p.position).filter((x) => x.id !== playerId && x.connected);
    if (!others.length) return { error: 'Odada birlikte arayacak kimse yok.' };
    const invite = { id: 'ji_' + Date.now(), initiatorId: playerId, initiatorName: p.name, t: Date.now() };
    this.jointInvites.set(p.position, invite);
    this.log('joint_invite', `${p.name}, birlikte arama başlattı.`, playerId, { room: p.position });
    this._pushState();
    // 30 sn sonra davet düşer
    setTimeout(() => {
      const cur = this.jointInvites.get(p.position);
      if (cur && cur.id === invite.id) { this.jointInvites.delete(p.position); this._pushState(); }
    }, 30000);
    return { ok: true };
  }

  jointAccept(playerId) {
    const p = this.players.get(playerId);
    const err = this._requireExplore(p);
    if (err) return { error: err };
    const invite = this.jointInvites.get(p.position);
    if (!invite) return { error: 'Bu odada aktif davet yok.' };
    if (invite.initiatorId === playerId) return { error: 'Kendi davetini kabul edemezsin.' };
    const initiator = this.players.get(invite.initiatorId);
    if (!initiator || initiator.position !== p.position) return { error: 'Başlatan artık odada değil.' };

    const each = Math.ceil(AP_COSTS.joint_search / 2); // maliyet bölünür (Bölüm 16.1)
    if (p.ap < each) return { error: `Yetersiz AP (gerekli: ${each}).` };
    if (initiator.ap < each) return { error: 'Başlatanın AP\'si yetersiz.' };

    p.ap -= each; initiator.ap -= each;
    this.jointInvites.delete(p.position);

    // Daha derin sonuç: bu odadaki gizli nesneleri açığa çıkar + tüm nesneleri araştırılmış say
    const room = p.position;
    const hidden = this.hiddenByRoom[room] || [];
    hidden.forEach((h) => {
      this.revealedHidden.add(h);
      this.investigated.add(h);
      if (!this.roomObjects[room]) this.roomObjects[room] = [];
      if (!this.roomObjects[room].includes(h)) this.roomObjects[room].push(h);
    });
    (this.roomObjects[room] || []).forEach((o) => this.investigated.add(o));

    const found = hidden.map((h) => HIDDEN_OBJECT_DEFS[h]?.name).filter(Boolean);
    this.log('joint_search', `${initiator.name} ve ${p.name}, ${ROOMS[room].name} odasını birlikte aradı.` +
      (found.length ? ` Gizli bulgu: ${found.join(', ')}.` : ''), playerId,
      { room, partners: [invite.initiatorId, playerId], found });
    this._pushState();
    return { ok: true, found };
  }

  // -------------------------------------------------------------------------
  //  TELEFON SİSTEMİ (Bölüm 9)
  // -------------------------------------------------------------------------
  _phoneHeldBy(playerId) {
    // Bu oyuncunun elinde tuttuğu cihazlar
    const held = [];
    for (const [ownerId, dev] of this.phones.entries()) {
      if (dev.holderId === playerId) held.push({ ownerId, ownerName: dev.ownerName });
    }
    return held;
  }

  sendPhoneMessage(playerId, toOwnerId, text) {
    const p = this.players.get(playerId);
    if (!p) return { error: 'Oyuncu yok.' };
    if (this.phase === PHASE.LOBBY || this.phase === PHASE.REVEAL) return { error: 'Bu fazda olmaz.' };
    const myDevices = this._phoneHeldBy(playerId);
    if (!myDevices.length) return { error: 'Telefonun yok.' };
    const fromDev = this.phones.get(myDevices[0].ownerId);
    const toDev = this.phones.get(toOwnerId);
    if (!toDev) return { error: 'Alıcının telefonu yok.' };
    if (p.ap < AP_COSTS.phone_message) return { error: 'Yetersiz AP.' };
    p.ap -= AP_COSTS.phone_message;
    const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
    const body = (text || '').slice(0, 200);
    // Alıcı cihazına gelen, gönderen cihazına giden kayıt (Bölüm 9.2)
    toDev.messages.push({ id, dir: 'in', other: fromDev.ownerName, text: body, deleted: false, t: Date.now() });
    fromDev.messages.push({ id: id + '_o', dir: 'out', other: toDev.ownerName, text: body, deleted: false, t: Date.now() });
    this.log('phone_msg', `${p.name}, ${toDev.ownerName}'in telefonuna mesaj gönderdi.`, playerId, { toOwnerId });
    this._pushState();
    return { ok: true };
  }

  deletePhoneMessage(playerId, msgId) {
    const p = this.players.get(playerId);
    if (!p) return { error: 'Oyuncu yok.' };
    const myDevices = this._phoneHeldBy(playerId);
    if (!myDevices.length) return { error: 'Telefonun yok.' };
    if (p.ap < AP_COSTS.phone_delete) return { error: 'Yetersiz AP.' };
    let found = false;
    for (const d of myDevices) {
      const dev = this.phones.get(d.ownerId);
      const m = dev.messages.find((x) => x.id === msgId && !x.deleted);
      if (m) { m.deleted = true; m.text = null; found = true; break; }
    }
    if (!found) return { error: 'Mesaj bulunamadı.' };
    p.ap -= AP_COSTS.phone_delete;
    // Silme İŞLEMİ iz bırakır (Bölüm 9.3) → İfşa fazında görünür
    this.log('phone_delete', `${p.name}, bir telefon mesajını sildi.`, playerId);
    this._pushState();
    return { ok: true };
  }

  seizePhone(playerId, targetId) {
    const p = this.players.get(playerId);
    const t = this.players.get(targetId);
    const err = this._requireExplore(p);
    if (err) return { error: err };
    if (!t) return { error: 'Hedef yok.' };
    if (t.position !== p.position) return { error: 'Oyuncu aynı odada değil.' };
    // Hedefin elindeki bir cihazı bul
    const targetDevices = this._phoneHeldBy(targetId);
    if (!targetDevices.length) return { error: 'Bu oyuncuda telefon yok.' };
    if (p.ap < AP_COSTS.seize_phone) return { error: 'Yetersiz AP.' };
    p.ap -= AP_COSTS.seize_phone;
    const dev = this.phones.get(targetDevices[0].ownerId);
    dev.holderId = playerId; // delil hazinesi ele geçti (Bölüm 9.4)
    const witnesses = this._playersInRoom(p.position).filter((w) => w.id !== playerId).map((w) => w.name);
    this.log('seize_phone', `${p.name}, ${t.name}'in telefonunu ele geçirdi.`, playerId, { targetId, witnesses });
    this._pushState();
    return { ok: true, witnesses };
  }

  startCall(playerId, toOwnerId) {
    const p = this.players.get(playerId);
    if (!p) return { error: 'Oyuncu yok.' };
    if (this.phase !== PHASE.EXPLORE && this.phase !== PHASE.DISCUSSION) return { error: 'Bu fazda olmaz.' };
    if (!this._phoneHeldBy(playerId).length) return { error: 'Telefonun yok.' };
    const toDev = this.phones.get(toOwnerId);
    if (!toDev) return { error: 'Alıcı telefonu yok.' };
    const otherHolder = toDev.holderId;
    if (otherHolder === playerId) return { error: 'Kendini arayamazsın.' };
    if (p.ap < AP_COSTS.phone_call) return { error: 'Yetersiz AP.' };
    if (this.calls.some((c) => c.a === playerId || c.b === playerId)) return { error: 'Zaten bir aramadasın.' };
    p.ap -= AP_COSTS.phone_call;
    this.calls.push({ a: playerId, b: otherHolder });
    this.log('phone_call', `${p.name}, ${toDev.ownerName}'i aradı (sesli, mesafe-bağımsız).`, playerId, { toOwnerId });
    this._pushState();
    return { ok: true };
  }

  endCall(playerId) {
    const before = this.calls.length;
    this.calls = this.calls.filter((c) => c.a !== playerId && c.b !== playerId);
    if (this.calls.length !== before) {
      this.log('phone_call_end', `${this.players.get(playerId)?.name} aramayı bitirdi.`, playerId);
      this._pushState();
    }
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  //  KÜRSÜ / SÖZ HAKKI (Bölüm 12.5) — tartışma fazı koordinasyonu
  // -------------------------------------------------------------------------
  requestFloor(playerId) {
    const p = this.players.get(playerId);
    if (!p) return { error: 'Oyuncu yok.' };
    if (this.phase !== PHASE.DISCUSSION) return { error: 'Kürsü yalnızca Tartışma Fazında.' };
    if (this.floorHolderId && this.floorHolderId !== playerId) {
      return { error: 'Kürsü şu an başkasında.' };
    }
    this.floorHolderId = playerId;
    if (this.floorTimer) clearTimeout(this.floorTimer);
    this.floorTimer = setTimeout(() => this._clearFloor(true), 45000); // 45 sn sonra otomatik bırakılır
    this.log('floor', `${p.name} söz aldı (kürsü).`, playerId);
    this._pushState();
    return { ok: true };
  }

  releaseFloor(playerId) {
    if (this.floorHolderId !== playerId) return { error: 'Kürsü sende değil.' };
    this._clearFloor(true);
    return { ok: true };
  }

  _clearFloor(push = false) {
    this.floorHolderId = null;
    if (this.floorTimer) { clearTimeout(this.floorTimer); this.floorTimer = null; }
    if (push) this._pushState();
  }

  // -------------------------------------------------------------------------
  //  NOT DEFTERİ (Bölüm 17.4) — kişiye özel
  // -------------------------------------------------------------------------
  setNotebook(playerId, text) {
    const p = this.players.get(playerId);
    if (!p) return { error: 'Oyuncu yok.' };
    p.notebook = (text || '').slice(0, 5000);
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  //  OYLAMA (Bölüm 18)
  // -------------------------------------------------------------------------
  castVote(playerId, verdict, suspectId) {
    const p = this.players.get(playerId);
    if (!p) return { error: 'Oyuncu yok.' };
    if (this.phase !== PHASE.VOTE) return { error: 'Şu an oylama fazı değil.' };
    if (!['cinayet', 'kaza', 'intihar'].includes(verdict)) return { error: 'Geçersiz karar.' };
    p.vote = { verdict, suspectId: verdict === 'cinayet' ? suspectId || null : null };
    this.log('vote', `${p.name} oyunu kullandı.`, playerId);
    // Herkes oy verdiyse erken bitir
    const all = [...this.players.values()].filter((x) => x.connected);
    if (all.every((x) => x.vote)) {
      if (this.timer) clearTimeout(this.timer);
      this._enterPhase(PHASE.REVEAL);
    } else {
      this._pushState();
    }
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  //  SONUÇ HESABI (Bölüm 18, 19)
  // -------------------------------------------------------------------------
  _computeResults() {
    const gt = this.scenario.groundTruth;
    const votes = [...this.players.values()].map((p) => ({
      playerId: p.id, name: p.name, vote: p.vote,
    }));
    const tally = { cinayet: 0, kaza: 0, intihar: 0 };
    votes.forEach((v) => { if (v.vote) tally[v.vote.verdict] += 1; });

    const majorityVerdict = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
    const verdictCorrect = majorityVerdict === gt.type;

    // Şüpheli oy çoğunluğu (cinayetse)
    let suspectTally = {};
    votes.forEach((v) => {
      if (v.vote?.verdict === 'cinayet' && v.vote.suspectId) {
        suspectTally[v.vote.suspectId] = (suspectTally[v.vote.suspectId] || 0) + 1;
      }
    });
    const topSuspect = Object.entries(suspectTally).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const culpritCaught = gt.type === 'cinayet' && topSuspect === gt.murdererPlayerId;

    // Garantili ifşa (Bölüm 19): en az bir anahtar rolün sırrı açıklanır
    const revealedSecrets = this.scenario.characters
      .filter((c) => c.type === 'key' && c.secret)
      .map((c) => ({
        playerId: c.playerId,
        name: this.players.get(c.playerId)?.name,
        roleName: c.roleName,
        secret: c.secret,
        goal: c.goal,
        isMurderer: c.isMurderer,
      }));

    this.results = {
      groundTruth: gt,
      tally,
      majorityVerdict,
      verdictCorrect,
      topSuspect,
      culpritCaught,
      revealedSecrets,
      solutionChain: this.scenario.solutionChain,
      distantLinks: this.scenario.distantLinks,
    };
  }

  // -------------------------------------------------------------------------
  //  İSTEMCİYE DURUM GÖNDERME — oyuncuya özel filtrelenmiş görünüm
  // -------------------------------------------------------------------------
  buildStateFor(playerId) {
    const p = this.players.get(playerId);
    if (!p) return null;

    const reveal = this.phase === PHASE.REVEAL;

    // Bulunulan odadaki nesneler (yüzey + araştırıldıysa derin).
    // Gizli nesneler yalnızca birlikte aramayla açılmışsa görünür.
    const roomObjs = (this.roomObjects[p.position] || [])
      .filter((objId) => !HIDDEN_OBJECT_DEFS[objId] || this.revealedHidden.has(objId))
      .map((objId) => describeObject(objId, this.investigated.has(objId)));

    // Bu odadaki boş yuvalar (Bölüm 4)
    const roomSlots = (this.slots[p.position] || []).map((s) => ({
      slotId: s.slotId,
      name: SLOT_DEFS[s.slotId]?.name || s.slotId,
      prompt: SLOT_DEFS[s.slotId]?.prompt || '',
      fills: s.fills.map((f) => ({ name: f.name, text: f.text })),
    }));

    // Birlikte arama daveti (bu odada, başkası başlattıysa)
    const invite = this.jointInvites.get(p.position);
    const jointInvite = invite && invite.initiatorId !== p.id
      ? { initiatorName: invite.initiatorName, eachCost: Math.ceil(AP_COSTS.joint_search / 2) }
      : null;

    // Telefon görünümü (elde tutulan tüm cihazların mesajları)
    const heldDevices = this._phoneHeldBy(p.id).map((d) => {
      const dev = this.phones.get(d.ownerId);
      return {
        ownerId: d.ownerId,
        ownerName: d.ownerName,
        isOwn: d.ownerId === p.id,
        messages: dev.messages.map((m) => ({
          id: m.id, dir: m.dir, other: m.other,
          text: m.deleted ? null : m.text, deleted: m.deleted,
        })),
      };
    });
    const phoneContacts = [...this.phones.entries()]
      .filter(([ownerId]) => ownerId !== p.id || true)
      .map(([ownerId, dev]) => ({ ownerId, ownerName: dev.ownerName }))
      .filter((c) => c.ownerId !== p.id); // kendine mesaj atamaz
    const hasPhone = heldDevices.length > 0;

    // Aktif arama partneri (sesli, mesafe-bağımsız — Bölüm 9.2)
    const call = this.calls.find((c) => c.a === p.id || c.b === p.id);
    const callPartnerId = call ? (call.a === p.id ? call.b : call.a) : null;

    // Dinleme durumu: kendi hedefim + odamı dinleyenler (yakalanma — Bölüm 8.2)
    const myEavesdropTarget = this.eavesdrop.get(p.id) || null;
    const listenersOnYourRoom = [...this.eavesdrop.entries()]
      .filter(([lid, room]) => room === p.position && lid !== p.id)
      .map(([lid]) => this.players.get(lid)?.name)
      .filter(Boolean);

    // Ev krokisi (statik) + komşu görünür oyuncu sayıları
    const rooms = Object.values(ROOMS).map((r) => ({
      id: r.id, name: r.name, grid: r.grid, adjacent: r.adjacent, role: r.role,
    }));

    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      totalRounds: this.scaling.rounds,
      phaseEndsAt: this.phaseEndsAt,
      you: {
        id: p.id,
        name: p.name,
        isHost: p.id === this.hostId,
        position: p.position,
        ap: p.ap,
        roleId: p.roleId,
        roleName: ROLE_DEFS[p.roleId]?.name || null,
        roleType: ROLE_DEFS[p.roleId]?.type || null,
        secret: this._secretFor(p.id),
        goal: this._goalFor(p.id),
        suspiciousBehavior: ROLE_DEFS[p.roleId]?.suspiciousBehavior || null,
        hasPhone: ROLE_DEFS[p.roleId]?.hasPhone || false,
        isMurderer: reveal ? this._isMurderer(p.id) : undefined,
        inventory: p.inventory.map((it) => ({
          uid: it.uid,
          itemId: it.itemId,
          name: ITEM_NAMES[it.itemId] || OBJECT_DEFS[it.itemId]?.name || it.itemId,
          isObject: !!it.isObject,
        })),
        notebook: p.notebook,
        vote: p.vote,
      },
      rooms,
      currentRoom: { id: p.position, name: ROOMS[p.position].name, role: ROOMS[p.position].role },
      roomObjects: roomObjs,
      roomSlots,
      jointInvite,
      players: this._visiblePlayers(p),
      apCosts: AP_COSTS,
      // Genişletilmiş sistemler
      isPressureRound: this.phase === PHASE.EXPLORE && this.roundTypes[this.round - 1] === true,
      pressureTrigger: this.pressureTrigger,
      phone: { has: hasPhone, devices: heldDevices, contacts: phoneContacts },
      callPartnerId,
      myEavesdropTarget,
      listenersOnYourRoom,
      floorHolderId: this.phase === PHASE.DISCUSSION ? this.floorHolderId : null,
      floorHolderName: this.floorHolderId ? this.players.get(this.floorHolderId)?.name : null,
      // Event log SADECE ifşa fazında (Bölüm 13.2)
      eventLog: reveal ? this.eventLog : null,
      results: reveal ? this.results : null,
      lobbyPlayers: this.phase === PHASE.LOBBY
        ? [...this.players.values()].map((x) => ({ id: x.id, name: x.name, isHost: x.id === this.hostId, connected: x.connected }))
        : null,
    };
  }

  _secretFor(playerId) {
    const c = this.scenario?.characters.find((x) => x.playerId === playerId);
    return c?.secret || null;
  }
  _goalFor(playerId) {
    const c = this.scenario?.characters.find((x) => x.playerId === playerId);
    return c?.goal || null;
  }
  _isMurderer(playerId) {
    const c = this.scenario?.characters.find((x) => x.playerId === playerId);
    return !!c?.isMurderer;
  }

  _pushState() {
    // Her bağlı oyuncuya kendi filtrelenmiş durumunu gönder
    this.players.forEach((p) => {
      if (!p.connected) return;
      this.broadcast('state', this.buildStateFor(p.id), p.id);
    });
  }

  pushStateTo(playerId) {
    this.broadcast('state', this.buildStateFor(playerId), playerId);
  }
}
