// ============================================================================
//  VERİ KATMANI
//  Ev krokisi, oda komşulukları, nesne havuzu, roller, envanter, ölüm türleri.
//  (Tasarım dokümanı v4 — Bölüm 4, 5, 15, 21)
// ============================================================================

// ---------------------------------------------------------------------------
//  EV KROKİSİ — Odalar + grid konumu (UI) + komşuluk (oyun mantığı)
//  Grid: col 0..2, row 0..2. Komşuluk hareket maliyetini belirler (Bölüm 14).
// ---------------------------------------------------------------------------
export const ROOMS = {
  cati_kati: {
    id: 'cati_kati',
    name: 'Çatı Katı',
    grid: { col: 0, row: 0 },
    adjacent: ['merdiven'],
    role: 'İzole; gizli eylem için ideal ama erişimi pahalı',
  },
  calisma_odasi: {
    id: 'calisma_odasi',
    name: 'Çalışma Odası',
    grid: { col: 2, row: 0 },
    adjacent: ['mutfak'],
    role: 'Belge/sır çatışma alanı',
  },
  merdiven: {
    id: 'merdiven',
    name: 'Merdiven / Koridor',
    grid: { col: 0, row: 1 },
    adjacent: ['cati_kati', 'salon', 'bahce'],
    role: 'Geçiş + kaza mahali',
  },
  salon: {
    id: 'salon',
    name: 'Salon',
    grid: { col: 1, row: 1 },
    adjacent: ['merdiven', 'mutfak', 'banyo'],
    role: 'Merkezî buluşma, yüksek görünürlük',
  },
  mutfak: {
    id: 'mutfak',
    name: 'Mutfak',
    grid: { col: 2, row: 1 },
    adjacent: ['calisma_odasi', 'salon', 'garaj'],
    role: 'Masum görünen tehlikeli oda',
  },
  bahce: {
    id: 'bahce',
    name: 'Bahçe',
    grid: { col: 0, row: 2 },
    adjacent: ['merdiven', 'banyo'],
    role: 'Dış iz kaynağı',
  },
  banyo: {
    id: 'banyo',
    name: 'Banyo',
    grid: { col: 1, row: 2 },
    adjacent: ['salon', 'bahce', 'garaj'],
    role: 'Sabote edilebilir kapı, gizlenme',
  },
  garaj: {
    id: 'garaj',
    name: 'Garaj',
    grid: { col: 2, row: 2 },
    adjacent: ['mutfak', 'banyo'],
    role: 'Sahte delil hammaddesi',
  },
};

export const START_ROOM = 'salon';

// ---------------------------------------------------------------------------
//  NESNE TANIMLARI
//  Her nesnenin: ad, kısa açıklama (yüzey), derin detay (araştırınca açılır).
// ---------------------------------------------------------------------------
export const OBJECT_DEFS = {
  // --- Cinayet / Bıçak ---
  kanli_bicak: { name: 'Kanlı Bıçak', surface: 'Üzerinde kuru kan lekeleri olan bir bıçak.', deep: 'Kan tipi belirsiz. Sap kısmı silinmiş gibi temiz.' },
  parmak_izi: { name: 'Parmak İzi', surface: 'Bir yüzeyde net bir parmak izi.', deep: 'İz taze; son birkaç saat içinde bırakılmış.' },
  bogusma_izi: { name: 'Boğuşma İzi', surface: 'Devrilmiş eşyalar, dağınık halı.', deep: 'Mücadele yer seviyesinde olmuş; iki kişi olabilir.' },
  kan_sicramasi: { name: 'Kan Sıçraması', surface: 'Duvarda ince kan sıçraması deseni.', deep: 'Sıçrama açısı ayakta biri tarafından yapıldığını gösteriyor.' },

  // --- Cinayet / Zehir ---
  bardak_kalintisi: { name: 'Bardak Kalıntısı', surface: 'Dipte tortu kalmış bir bardak.', deep: 'Tortu acımsı kokuyor; sıradan içecek değil.' },
  ilac_sisesi: { name: 'İlaç Şişesi', surface: 'Etiketsiz, yarı boş bir ilaç şişesi.', deep: 'İçerik reçeteyle uyuşmuyor; doz aşımına yetecek miktar eksik.' },
  mutfak_izi: { name: 'Mutfak İzi', surface: 'Tezgâhta dökülmüş toz izi.', deep: 'Toz, ilaç şişesindeki maddeyle aynı.' },

  // --- Cinayet / Boğma ---
  yastik_lifi: { name: 'Yastık Lifi', surface: 'Yerde dağılmış yastık lifleri.', deep: 'Lifler bastırılmış; yastık güç uygulanarak kullanılmış.' },
  tirnak_izi: { name: 'Tırnak İzi', surface: 'Bir yüzeyde tırnak çizikleri.', deep: 'Çizikler savunma amaçlı; kurban direnmiş.' },
  boyun_morlugu: { name: 'Boyun Morluğu (rapor)', surface: 'Boyun bölgesine dair bir not.', deep: 'Morluk deseni el değil, yumuşak baskı (yastık) gösteriyor.' },

  // --- Kaza / Merdiven ---
  kirik_korkuluk: { name: 'Kırık Korkuluk', surface: 'Merdiven korkuluğu kırılmış.', deep: 'Kırık taze ve içeriden dışarı; biri ağırlık verince kırılmış.' },
  islak_zemin: { name: 'Islak/Kaygan Zemin', surface: 'Zemin hâlâ nemli ve kaygan.', deep: 'Su tabakası ince ve eşit; yakın zamanda silinmiş.' },
  ayakkabi_izi: { name: 'Ayakkabı İzi', surface: 'Zeminde kayma yönlü ayakkabı izi.', deep: 'İz kayma anını gösteriyor; tek kişiye ait.' },

  // --- Kaza / Elektrik ---
  ciplak_kablo: { name: 'Çıplak Kablo', surface: 'Yalıtımı sıyrılmış bir kablo.', deep: 'Sıyrılma eski değil; kasıtlı ya da yıpranma belirsiz.' },
  atmis_sigorta: { name: 'Atmış Sigorta', surface: 'Sigorta kutusunda atmış bir sigorta.', deep: 'Atma zamanı ölüm saatiyle örtüşüyor.' },

  // --- Kaza / Balkon ---
  curuk_korkuluk: { name: 'Çürük Korkuluk', surface: 'Balkon korkuluğu çürümüş görünüyor.', deep: 'Vidalar gevşek; uzun süredir bakımsız.' },
  gevsek_vida: { name: 'Gevşek Vida', surface: 'Yerde birkaç gevşek vida.', deep: 'Vidalar yakın zamanda sökülmüş gibi temiz dişli.' },
  yagmur_izi: { name: 'Yağmur İzi', surface: 'Islaklık ve çamur izi.', deep: 'İz dışarıdan içeri taşınmış.' },

  // --- İntihar ---
  el_yazisi_not: { name: 'El Yazısı Not', surface: 'Katlanmış bir el yazısı not.', deep: 'Yazı titrek; ya stresli ya taklit edilmiş.' },
  kilitli_oda: { name: 'İçeriden Kilitli Oda (iz)', surface: 'Kapı içeriden kilitlenmiş gibi.', deep: 'Kilit mekanizması sağlam; dışarıdan müdahale izi yok... ya da çok temiz.' },
  bos_ilac_kutusu: { name: 'Boş İlaç Kutusu', surface: 'Tamamen boşaltılmış ilaç kutusu.', deep: 'Kutu tek seferde boşaltılmış.' },

  // --- Destekleyici / Uzak bağlantı nesneleri ---
  temizlik_notu: { name: 'Temizlik Notu', surface: 'Hizmetçinin "21:30 zemini sildim" notu.', deep: 'Not, ölüm saatinden hemen önceye işaret ediyor.' },
  garaj_paspas: { name: 'Islak Paspas', surface: 'Garajda hâlâ ıslak bir paspas.', deep: 'Paspas yakın zamanda kullanılmış; merdiven zeminiyle bağlantılı olabilir.' },
  et_kanli_bicak: { name: 'Et Kanlı Bıçak', surface: 'Mutfakta üzerinde kan olan bir bıçak.', deep: 'Kan analizi: hayvan (et) kanı. Yanıltıcı.' },
  cam_parcasi: { name: 'Cam Parçası', surface: 'Yerde kırık cam parçaları.', deep: 'Parçalar başka bir odadaki kırık camla eşleşiyor.' },

  // --- Gürültü (tek başına önemsiz) ---
  eski_gazete: { name: 'Eski Gazete', surface: 'Birkaç günlük eski bir gazete.', deep: 'İçinde anlamlı bir şey yok.' },
  toz_izi: { name: 'Toz İzi', surface: 'Eşya kaldırılmış gibi bir toz boşluğu.', deep: 'Bir şey buradan alınmış olabilir; ne olduğu belirsiz.' },
  bos_kupa: { name: 'Boş Kupa', surface: 'Soğumuş kahve kalıntılı bir kupa.', deep: 'Sıradan; özel bir iz yok.' },
  kitap: { name: 'Açık Kitap', surface: 'Yarısı açık bırakılmış bir kitap.', deep: 'Sayfa arasında bir şey yok.' },
};

// ---------------------------------------------------------------------------
//  ÖLÜM TÜRLERİ → ALT SEBEP → ZORUNLU NESNELER (çözüm zinciri çekirdeği)
//  (Bölüm 4 — Üretim hattı)
// ---------------------------------------------------------------------------
export const DEATH_SEEDS = {
  cinayet_bicak: {
    type: 'cinayet', cause: 'bicak', label: 'Cinayet — Bıçak',
    mandatory: ['kanli_bicak', 'parmak_izi', 'kan_sicramasi'],
    supporting: ['bogusma_izi'],
  },
  cinayet_zehir: {
    type: 'cinayet', cause: 'zehir', label: 'Cinayet — Zehir',
    mandatory: ['bardak_kalintisi', 'ilac_sisesi', 'mutfak_izi'],
    supporting: ['bos_ilac_kutusu'],
  },
  cinayet_bogma: {
    type: 'cinayet', cause: 'bogma', label: 'Cinayet — Boğma',
    mandatory: ['yastik_lifi', 'tirnak_izi', 'boyun_morlugu'],
    supporting: ['bogusma_izi'],
  },
  kaza_merdiven: {
    type: 'kaza', cause: 'merdiven', label: 'Kaza — Merdivenden Düşme',
    mandatory: ['kirik_korkuluk', 'islak_zemin', 'temizlik_notu'],
    supporting: ['ayakkabi_izi', 'garaj_paspas'],
  },
  kaza_elektrik: {
    type: 'kaza', cause: 'elektrik', label: 'Kaza — Elektrik Çarpması',
    mandatory: ['ciplak_kablo', 'islak_zemin', 'atmis_sigorta'],
    supporting: ['garaj_paspas'],
  },
  kaza_balkon: {
    type: 'kaza', cause: 'balkon', label: 'Kaza — Balkondan Düşme',
    mandatory: ['curuk_korkuluk', 'gevsek_vida', 'yagmur_izi'],
    supporting: ['ayakkabi_izi'],
  },
  intihar: {
    type: 'intihar', cause: 'intihar', label: 'İntihar',
    mandatory: ['el_yazisi_not', 'kilitli_oda', 'bos_ilac_kutusu'],
    supporting: ['ilac_sisesi'],
  },
};

// Gürültü nesneleri havuzu (her senaryoya serpiştirilir)
export const NOISE_OBJECTS = ['eski_gazete', 'toz_izi', 'bos_kupa', 'kitap', 'et_kanli_bicak', 'cam_parcasi'];

// ---------------------------------------------------------------------------
//  ROLLER (Bölüm 5.1) — Anahtar (key) ve Çevre (ambient)
//  secret/goal alanları senaryo üretiminde nesnelere bağlanır.
// ---------------------------------------------------------------------------
export const ROLE_DEFS = {
  doktor: {
    id: 'doktor', name: 'Doktor', type: 'key', hasPhone: true,
    secretTemplate: 'Çantanızda reçetesiz bir ilaç kutusu var.',
    goalTemplate: 'İlaç kutusunu fark edilmeden yerine koymak / saklamak.',
    suspiciousBehavior: 'Banyo ve çalışma odası arasında gidip gelir.',
    inventory: ['tibbi_canta', 'receteli_ilac', 'eldiven'],
  },
  gazeteci: {
    id: 'gazeteci', name: 'Gazeteci', type: 'key', hasPhone: true,
    secretTemplate: 'Çalışma odasındaki bir dosyayı zaten aldınız.',
    goalTemplate: 'Dosyayı evden çıkarmadan saklamak.',
    suspiciousBehavior: 'Sürekli çalışma odasını karıştırır.',
    inventory: ['fotograf_makinesi', 'not_blogu', 'kayit_cihazi'],
  },
  avukat: {
    id: 'avukat', name: 'Avukat', type: 'key', hasPhone: false,
    secretTemplate: 'Kasadaki vasiyet zarfını açtınız.',
    goalTemplate: 'Kasayı tekrar kilitli/dokunulmamış göstermek.',
    suspiciousBehavior: 'Belirli bir odaya erişimi kapatmaya çalışır.',
    inventory: ['evrak_cantasi', 'kasa_anahtari'],
  },
  eski_ortak: {
    id: 'eski_ortak', name: 'Eski Ortak', type: 'key', hasPhone: true,
    secretTemplate: 'Salondaki ortaklık sözleşmesini değiştirmek istiyorsunuz.',
    goalTemplate: 'Sözleşme sayfasını fark edilmeden değiştirmek.',
    suspiciousBehavior: 'Salonda fazla oyalanır.',
    inventory: ['kalem', 'sahte_sayfa'],
  },
  yegen: {
    id: 'yegen', name: 'Yeğen', type: 'key', hasPhone: false,
    secretTemplate: 'Yatak odasındaki/çatıdaki takıyı aldınız.',
    goalTemplate: 'Takıyı geri koymak veya saklamak.',
    suspiciousBehavior: 'Üst kata çıkıp iner.',
    inventory: ['takı'],
  },
  hizmetci: {
    id: 'hizmetci', name: 'Hizmetçi', type: 'ambient', hasPhone: false,
    secretTemplate: null,
    goalTemplate: 'Rutin temizlik işini bitirmek.',
    suspiciousBehavior: 'Islak zemin, taşınmış eşyalar — masum ama şüpheli görünür.',
    inventory: ['anahtar_destesi', 'temizlik_bezi'],
  },
  asci: {
    id: 'asci', name: 'Aşçı', type: 'ambient', hasPhone: false,
    secretTemplate: null,
    goalTemplate: null,
    suspiciousBehavior: 'Mutfaktaki kanlı(!) bıçak aslında et kanı.',
    inventory: ['mutfak_bicagi', 'eldiven'],
  },
  komsu: {
    id: 'komsu', name: 'Komşu', type: 'ambient', hasPhone: false,
    secretTemplate: null,
    goalTemplate: null,
    suspiciousBehavior: '"Gürültü duydum" der ama saati karıştırır.',
    inventory: [],
  },
  bahcivan: {
    id: 'bahcivan', name: 'Bahçıvan', type: 'ambient', hasPhone: false,
    secretTemplate: null,
    goalTemplate: null,
    suspiciousBehavior: 'Çamurlu ayakkabı izi içeri taşınmış.',
    inventory: ['bahce_makasi', 'camurlu_bot'],
  },
  sofor: {
    id: 'sofor', name: 'Şoför', type: 'ambient', hasPhone: false,
    secretTemplate: null,
    goalTemplate: null,
    suspiciousBehavior: 'Garajda görülmüş, alibi belirsiz.',
    inventory: [],
  },
};

// Envanter eşyası görünen adları
export const ITEM_NAMES = {
  tibbi_canta: 'Tıbbi Çanta', receteli_ilac: 'Reçeteli İlaç', eldiven: 'Eldiven',
  fotograf_makinesi: 'Fotoğraf Makinesi', not_blogu: 'Not Bloğu', kayit_cihazi: 'Kayıt Cihazı',
  evrak_cantasi: 'Evrak Çantası', kasa_anahtari: 'Kasa Anahtarı',
  kalem: 'Kalem', sahte_sayfa: 'Sahte Sayfa', taki: 'Takı',
  anahtar_destesi: 'Anahtar Destesi', temizlik_bezi: 'Temizlik Bezi',
  mutfak_bicagi: 'Mutfak Bıçağı', bahce_makasi: 'Bahçe Makası', camurlu_bot: 'Çamurlu Bot',
  telefon: 'Telefon',
};

// ---------------------------------------------------------------------------
//  AKSİYON PUANI MALİYETLERİ (Bölüm 14.1, 9.2, 8.2, 16.1)
// ---------------------------------------------------------------------------
export const AP_COSTS = {
  move_adjacent: 1,     // Komşu odaya geçiş
  move_far: 2,          // Uzak odaya geçiş (koridor üzerinden)
  investigate: 1,       // Bir nesneyi araştırma (detay açma)
  take_object: 2,       // Nesneyi taşıma / envantere alma
  plant_dirty: 2,       // Sahte delil üretme (izli, ucuz)
  plant_clean: 4,       // Sahte delil üretme (temiz, izsiz)
  private_talk: 1,      // Yakındaki oyuncuyla özel konuşma
  // --- Telefon (Bölüm 9.2) ---
  phone_message: 1,     // Mesaj gönderme
  phone_call: 2,        // Sesli arama (telefonlular arası)
  phone_delete: 1,      // Mesaj silme (silme işlemi iz bırakır)
  phone_read: 1,        // Ele geçirilen telefonu okuma
  seize_phone: 2,       // Yakındaki birinin telefonunu ele geçirme
  // --- Duvar dinleme (Bölüm 8.2) ---
  eavesdrop: 1,         // Yan odayı netleştirerek dinleme (tur başına)
  // --- Birlikte arama (Bölüm 16.1) ---
  joint_search: 4,      // Toplam maliyet; katılımcılar arasında bölünür
  // --- Boş yuva doldurma (Bölüm 4) ---
  fill_slot: 1,         // Yoruma açık yuvaya iddia ekleme
};

// ---------------------------------------------------------------------------
//  GİZLİ NESNELER — yalnızca BİRLİKTE ARAMA ile açığa çıkar (Bölüm 16.1)
// ---------------------------------------------------------------------------
export const HIDDEN_OBJECT_DEFS = {
  kasa_cift_taban: { name: 'Kasanın Çift Tabanı', surface: 'Kasanın tabanında gizli bir bölme.', deep: 'İçinde imzasız bir belge; tek kişi açamaz, iki kişi gerekti.' },
  gizli_dosya: { name: 'Gizli Dosya', surface: 'Raf arkasına saklanmış bir dosya.', deep: 'Dosyada eksik bir sayfa var — biri çıkarmış.' },
  doseme_alti: { name: 'Döşeme Altı Boşluk', surface: 'Gevşek bir döşeme tahtası.', deep: 'Altında saklanmış küçük bir nesne izi.' },
};

// Boş yuva tanımları — sistem açar, oyuncu doldurur (Bölüm 4 Adım 4)
export const SLOT_DEFS = {
  belirsiz_ses: { name: 'Belirsiz Ses Kaynağı', prompt: 'Buradan bir ses geldiği söyleniyor ama kaynağı belirsiz. Sence neydi?' },
  acik_pencere: { name: 'Açık Pencere', prompt: 'Pencere açık bırakılmış. Neden açık olabilir?' },
  yarim_icecek: { name: 'Yarım İçecek', prompt: 'Yarısı içilmiş bir içecek. Kime ait, neden bırakılmış?' },
};

// ---------------------------------------------------------------------------
//  OYUNCU SAYISINA GÖRE ÖLÇEKLEME (Bölüm 12.3)
// ---------------------------------------------------------------------------
export function scalingFor(playerCount) {
  if (playerCount <= 6) {
    // Az oyuncu → AP baskısı baskın, zaman bol, baskı turu az (Bölüm 12.4)
    return {
      rounds: 4, apPerRound: 6, exploreSeconds: 360, discussionSeconds: 210,
      voteSeconds: 240, maxKeyRoles: 2, pressureRounds: 1,
      pressureExploreSeconds: 150, pressureApPerRound: 9,
    };
  }
  // Çok oyuncu → zaman baskısı baskın, AP kıt, baskı turu çok (Bölüm 12.5)
  return {
    rounds: 5, apPerRound: 5, exploreSeconds: 360, discussionSeconds: 240,
    voteSeconds: 240, maxKeyRoles: 4, pressureRounds: 2,
    pressureExploreSeconds: 150, pressureApPerRound: 8,
  };
}

// Tur tiplerini planla: keşif (false) / baskı (true). Baskı turları sona yakın
// yerleştirilir (doruk noktası — Bölüm 12.2/12.4).
export function planRoundTypes(rounds, pressureCount) {
  const types = new Array(rounds).fill(false);
  let placed = 0;
  // Sondan başlayarak baskı turları serpiştir (son tur hariç doruk için sondan bir önceki tercih)
  for (let i = rounds - 1; i >= 0 && placed < pressureCount; i--) {
    // İlk turu baskı yapma (oyuncular önce bilgi toplamalı)
    if (i === 0) continue;
    types[i] = true;
    placed++;
  }
  return types;
}

// Baskı turu kurgu tetikleyicileri (Bölüm 12.2)
export const PRESSURE_TRIGGERS = [
  'Işıklar gidiyor! Karanlık bastırmadan acele edin.',
  'Bir araba yaklaşıyor — birileri eve geliyor!',
  'Deliller kayboluyor gibi... vakit daralıyor.',
  'Fırtına çıktı, elektrik kesilmek üzere.',
  'Polis sirenleri duyuldu — herkes hızlanmalı.',
];
