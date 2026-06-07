// ============================================================================
//  SENARYO ÜRETİM HATTI (Bölüm 4)
//  Seed seçimi → zorunlu nesne enjeksiyonu → çözüm zinciri → uzak bağlantılar
//  → rol/sır atama → tutarlılık & çözülebilirlik denetimi.
// ============================================================================

import {
  ROOMS, DEATH_SEEDS, NOISE_OBJECTS, OBJECT_DEFS,
  ROLE_DEFS, START_ROOM, HIDDEN_OBJECT_DEFS, SLOT_DEFS,
} from './data.js';

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Nesnelerin tercih edilen odaları (tutarlılık için).
const OBJECT_ROOM_PREF = {
  kanli_bicak: ['salon', 'calisma_odasi'],
  parmak_izi: ['calisma_odasi', 'salon'],
  bogusma_izi: ['salon', 'calisma_odasi'],
  kan_sicramasi: ['salon', 'merdiven'],
  bardak_kalintisi: ['salon', 'mutfak'],
  ilac_sisesi: ['banyo', 'mutfak'],
  mutfak_izi: ['mutfak'],
  yastik_lifi: ['salon', 'cati_kati'],
  tirnak_izi: ['salon'],
  boyun_morlugu: ['banyo'],
  kirik_korkuluk: ['merdiven'],
  islak_zemin: ['merdiven'],
  ayakkabi_izi: ['merdiven', 'bahce'],
  ciplak_kablo: ['garaj', 'banyo'],
  atmis_sigorta: ['garaj'],
  curuk_korkuluk: ['cati_kati', 'merdiven'],
  gevsek_vida: ['cati_kati', 'garaj'],
  yagmur_izi: ['bahce', 'merdiven'],
  el_yazisi_not: ['calisma_odasi', 'cati_kati'],
  kilitli_oda: ['banyo'],
  bos_ilac_kutusu: ['banyo', 'mutfak'],
  temizlik_notu: ['mutfak'],
  garaj_paspas: ['garaj'],
  et_kanli_bicak: ['mutfak'],
  cam_parcasi: ['bahce', 'salon'],
  eski_gazete: ['salon', 'calisma_odasi'],
  toz_izi: ['cati_kati', 'calisma_odasi'],
  bos_kupa: ['mutfak', 'salon'],
  kitap: ['calisma_odasi', 'salon'],
};

const ROOM_IDS = Object.keys(ROOMS);

function placeObject(roomObjects, objId) {
  const prefs = OBJECT_ROOM_PREF[objId] || ROOM_IDS;
  // Tercih edilen odalardan birini seç (varsa).
  const room = rand(prefs.filter((r) => ROOMS[r])) || rand(ROOM_IDS);
  if (!roomObjects[room]) roomObjects[room] = [];
  if (!roomObjects[room].includes(objId)) roomObjects[room].push(objId);
  return room;
}

// Bir nesnenin hangi odada olduğunu bul.
function findObjectRoom(roomObjects, objId) {
  for (const [room, objs] of Object.entries(roomObjects)) {
    if (objs.includes(objId)) return room;
  }
  return null;
}

// ---------------------------------------------------------------------------
//  ROL ATAMA — oyuncu sayısına ve anahtar rol tavanına göre
// ---------------------------------------------------------------------------
function assignRoles(players, maxKeyRoles, isMurder) {
  const keyRoleIds = Object.values(ROLE_DEFS).filter((r) => r.type === 'key').map((r) => r.id);
  const ambientRoleIds = Object.values(ROLE_DEFS).filter((r) => r.type === 'ambient').map((r) => r.id);

  const n = players.length;
  const keyCount = Math.min(maxKeyRoles, Math.max(1, Math.floor(n / 2)), keyRoleIds.length);

  const chosenKeys = shuffle(keyRoleIds).slice(0, keyCount);
  const chosenAmbient = shuffle(ambientRoleIds).slice(0, n - keyCount);
  const roleOrder = shuffle([...chosenKeys, ...chosenAmbient]);

  // Cinayetse, anahtar rollerden biri katil olur.
  let murdererIndex = -1;
  if (isMurder && chosenKeys.length > 0) {
    const keyPositions = roleOrder
      .map((rid, i) => (chosenKeys.includes(rid) ? i : -1))
      .filter((i) => i >= 0);
    murdererIndex = rand(keyPositions);
  }

  return players.map((p, i) => {
    const rid = roleOrder[i];
    const def = ROLE_DEFS[rid];
    const isMurderer = i === murdererIndex;
    return {
      playerId: p.id,
      roleId: rid,
      roleName: def.name,
      type: def.type,
      secret: def.secretTemplate,
      goal: def.goalTemplate,
      suspiciousBehavior: def.suspiciousBehavior,
      hasPhone: def.hasPhone,
      isMurderer,
      inventory: def.inventory.map((itemId, idx) => ({
        uid: `${p.id}_item_${idx}`,
        itemId,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
//  ÇÖZÜLEBİLİRLİK DENETİMİ (Bölüm 4 Adım 5)
//  Çözüm zincirinin her halkası bir odada erişilebilir olmalı.
// ---------------------------------------------------------------------------
function verifySolvable(roomObjects, solutionChain) {
  const issues = [];
  for (const link of solutionChain) {
    const room = findObjectRoom(roomObjects, link);
    if (!room) issues.push(`Çözüm halkası '${link}' hiçbir odada bulunamadı!`);
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
//  ANA ÜRETİCİ
// ---------------------------------------------------------------------------
export function generateScenario(players, scaling) {
  // Adım 1 — Çekirdek (seed) seçimi
  const seedKey = rand(Object.keys(DEATH_SEEDS));
  const seed = DEATH_SEEDS[seedKey];
  const isMurder = seed.type === 'cinayet';

  // Adım 2 — Zorunlu + destekleyici nesne enjeksiyonu
  const roomObjects = {};
  ROOM_IDS.forEach((r) => { roomObjects[r] = []; });

  const solutionChain = [...seed.mandatory];
  seed.mandatory.forEach((o) => placeObject(roomObjects, o));
  (seed.supporting || []).forEach((o) => placeObject(roomObjects, o));

  // Gürültü nesneleri serpiştir (Bölüm 3.3 — bağlantı keşfini tatmin edici kılar)
  const noise = shuffle(NOISE_OBJECTS).slice(0, 4 + Math.floor(Math.random() * 2));
  noise.forEach((o) => placeObject(roomObjects, o));

  // Gizli nesneler — yalnızca birlikte arama ile açılır (Bölüm 16.1)
  const hiddenByRoom = {};
  const hiddenPool = shuffle(Object.keys(HIDDEN_OBJECT_DEFS)).slice(0, 2);
  const hiddenRooms = shuffle(ROOM_IDS).slice(0, hiddenPool.length);
  hiddenPool.forEach((h, i) => {
    const room = hiddenRooms[i];
    if (!hiddenByRoom[room]) hiddenByRoom[room] = [];
    hiddenByRoom[room].push(h);
  });

  // Boş yuvalar — sistem açar, oyuncular doldurur (Bölüm 4 Adım 4)
  const slots = {};
  const slotPool = shuffle(Object.keys(SLOT_DEFS)).slice(0, 2);
  const slotRooms = shuffle(ROOM_IDS).slice(0, slotPool.length);
  slotPool.forEach((s, i) => {
    const room = slotRooms[i];
    if (!slots[room]) slots[room] = [];
    slots[room].push({ slotId: s, fills: [] });
  });

  // Adım: Uzak bağlantılar (Bölüm 3) — yerleştirilen nesnelerden köprü kur
  const distantLinks = buildDistantLinks(roomObjects, seed);

  // Adım 3 — Rol & sır atama
  const characters = assignRoles(players, scaling.maxKeyRoles, isMurder);

  // Adım 5 — Çözülebilirlik denetimi
  const check = verifySolvable(roomObjects, solutionChain);

  const groundTruth = {
    type: seed.type,
    cause: seed.cause,
    label: seed.label,
    timeOfDeath: '21:40',
    murdererPlayerId: characters.find((c) => c.isMurderer)?.playerId || null,
  };

  return {
    seedKey,
    groundTruth,
    solutionChain,
    distantLinks,
    roomObjects,
    hiddenByRoom,
    slots,
    characters,
    solvability: check,
  };
}

function buildDistantLinks(roomObjects, seed) {
  const links = [];
  const placed = new Set();
  Object.values(roomObjects).forEach((objs) => objs.forEach((o) => placed.add(o)));

  // Klasik kaza zinciri köprüsü
  if (placed.has('islak_zemin') && placed.has('temizlik_notu')) {
    const nodes = ['islak_zemin', 'temizlik_notu'];
    if (placed.has('garaj_paspas')) nodes.push('garaj_paspas');
    links.push({ nodes, implication: 'Zemin ölümden hemen önce ıslaktı → kaza tezi güçlenir.' });
  }
  // Et kanı yanıltıcısı
  if (placed.has('et_kanli_bicak')) {
    links.push({ nodes: ['et_kanli_bicak'], implication: 'Kanlı bıçak korkutucu görünür ama kan et kanı olabilir (yanıltıcı).' });
  }
  // Cam köprüsü
  if (placed.has('cam_parcasi')) {
    links.push({ nodes: ['cam_parcasi'], implication: 'Cam parçaları başka bir odadaki kırılmayla eşleşebilir.' });
  }
  return links;
}

// Bir nesnenin görünen + (araştırıldıysa) derin bilgisini döndürür.
export function describeObject(objId, investigated) {
  const def = OBJECT_DEFS[objId] || HIDDEN_OBJECT_DEFS[objId];
  if (!def) return { id: objId, name: objId, surface: '', deep: null };
  return {
    id: objId,
    name: def.name,
    surface: def.surface,
    deep: investigated ? def.deep : null,
    hidden: !!HIDDEN_OBJECT_DEFS[objId],
  };
}
