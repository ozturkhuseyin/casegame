# Şüpheli Ölüm — Web Multiplayer

Durum simülasyonu tabanlı, çok oyunculu sosyal çıkarım oyunu. Bir ölüm gerçekleşir; oyuncular evin içindeki nesneler, izler ve birbirleri üzerinden gerçeği (cinayet / kaza / intihar) çözmeye çalışır.

Tasarım dokümanı v4'e dayanır. Bu repo, dokümandaki geliştirme yol haritasının (Bölüm 23) çekirdek adımlarını uygular: sunucu-otoriteli World State + Event Log, lobi & multiplayer senkronizasyon, ev krokisi + AP ile hareket, oda içeriği & araştırma, anahtar/çevre rol sistemi + sır/amaç, yakınlık/görünürlük & tanıklık, envanter & sahte delil (izli/temiz), announce, proximity (yakınlık) metin sohbeti, oylama ve ifşa fazı (tüm event log).

## Mimari

- **Sunucu:** Node.js + Express (statik client) + Socket.IO (gerçek zamanlı). Tek gerçek kaynağı (World State) sunucudadır; istemcilere yalnızca **görebildikleri** filtrelenmiş olarak gönderilir (anti-cheat). Event log yalnızca İfşa Fazında açılır.
- **İstemci:** Derleme gerektirmeyen vanilla HTML/CSS/JS. Socket.IO istemcisi sunucudan (`/socket.io/socket.io.js`) servis edilir — internet gerekmez.

```
server/
  index.js      Express + Socket.IO + oda kayıt defteri
  game.js       Game state machine (fazlar, AP, eylemler, görünürlük)
  scenario.js   Senaryo üretim hattı + çözülebilirlik denetimi
  data.js       Ev krokisi, nesneler, roller, envanter, AP maliyetleri, ölçekleme
public/
  index.html, css/style.css, js/app.js
```

## Kurulum & Çalıştırma

Gereksinim: Node.js 18+ (yerleşik `--watch` ve ESM için).

```bash
npm install
npm start
```

Sunucu açılınca terminale bağlanılabilecek adresleri yazar (yerel, LAN ve varsa Hamachi).

## Hamachi Üzerinden Multiplayer (ilk test)

1. **Host** (sunucuyu çalıştıran kişi):
   - [LogMeIn Hamachi](https://www.vpn.net/) kur, bir ağ oluştur (Network → Create a new network), ağ ID + şifresini arkadaşlarınla paylaş.
   - `npm start` ile sunucuyu başlat.
   - Terminalde `HAMACHI →  http://25.x.x.x:3000` satırını gör. Bu adresi paylaş. (Hamachi adresleri `25.` ile başlar.)
   - macOS/Windows güvenlik duvarının 3000 portuna gelen bağlantıya izin verdiğinden emin ol.
2. **Diğer oyuncular:**
   - Hamachi'yi kurup host'un ağına **Join** ile katıl.
   - Tarayıcıda host'un Hamachi adresini aç: `http://25.x.x.x:3000`
3. Bir kişi **Oda Kur** der, oda kodunu paylaşır; diğerleri **Katıl** ile koda girer.
4. Host **Oyunu Başlat** der. Roller gizlice dağıtılır.

> Hamachi yerine aynı yerel ağdaysanız `LAN: http://192.168.x.x:3000` adresi de çalışır. İnternet üzerinden host'luk için port yönlendirme veya bir tünel (ngrok vb.) gerekir.

## Nasıl Oynanır (özet)

- **Aksiyon Puanı (AP):** Her tur başında yenilenir, devretmez. Hareket, araştırma, nesne alma, sahte delil bırakma AP harcar.
- **Ev krokisi (orta):** Odaya tıkla → geç (komşu 1 AP, uzak 2 AP). Bulunduğun ve komşu odalardaki oyuncuları görürsün; uzaktakileri görmezsin.
- **Oda içeriği (sağ üst):** Nesneleri araştır (derin detay açılır) veya envantere al (tanık bırakır).
- **Envanter (alt sol):** Eşyayı odaya bırak (izli ucuz / temiz pahalı = sahte delil) ya da aynı odadaki birine ver.
- **Metin sohbeti (alt):** Aynı odadakilerle net yazışırsın; yan oda seni **boğuk** (kelimeler seçilmez) görür; uzak oda hiç görmez. **İlan Et** ile herkese duyuru yapılır ve dileyenler o odaya **ücretsiz** ışınlanır.
- **Sesli sohbet (🎙️ üst şerit):** "Ses: Açık" deyince WebRTC ile sese katılırsın. Aynı oda net, yan oda boğuk/kısık, uzak oda susturulmuş duyulur (Web Audio mesafe filtresi).
- **Duvar dinleme (👂 krokide yan oda):** AP harcayarak yan odayı netleştirirsin; o sırada "meşgul" görünürsün ve o odadakiler seni dinliyor olarak fark edebilir.
- **Telefon (📱 üst şerit, telefonlu roller):** Mesaj gönder (1 AP), sesli arama (2 AP, mesafe-bağımsız), mesaj sil (1 AP — **silme izi** loga düşer). Yakındaki birinin telefonunu **ele geçirip** mesajlarını okuyabilirsin.
- **Birlikte arama:** Aynı odadaki biriyle AP'yi bölüşerek derin arama → yalnızca bu yolla açılan **gizli nesneler** ortaya çıkar.
- **Boş yuvalar:** Yoruma açık öğelere (örn. "belirsiz ses") kendi iddianı eklersin; herkes görür → tartışma malzemesi.
- **Baskı turu:** Bazı turlar kısa süreli + bol AP + kurgu tetikleyicisi ("Işıklar gidiyor!") ile gelir.
- **Kürsü (tartışma fazı):** Büyük gruplarda "Söz İste" ile sırayla konuşma; söz kimde olduğu herkese gösterilir.
- **Not defteri (sağ alt):** Sana özel, gizli.
- **Fazlar:** Keşif → Tartışma turları (×N, bazıları baskı turu) → Son Oylama (cinayet/kaza/intihar + fail) → İfşa (gerçeklik + tüm event log).
- **Kazanma (asimetrik):** Çevre roller gerçeği doğru tespit etmeye; anahtar roller sırrını ifşa ettirmeden amacını tamamlamaya; katil şüpheyi başkasına yıkmaya çalışır.

## Uygulanan Sistemler (tasarım dokümanı v4)

Lobi/oda kodu + reconnect; oyuncu sayısına göre tur/AP/süre/anahtar-rol ölçekleme; senaryo üretimi + çözüm zinciri + çözülebilirlik denetimi; uzak bağlantılar; anahtar/çevre roller + sır/amaç; AP ekonomisi; hareket; araştırma; nesne alma; sahte delil (izli/temiz) + tanıklık; envanter & eşya verme; **birlikte arama (AP paylaşımı + gizli nesne)**; **boş yuva yanıltıcıları**; announce + ücretsiz toplanma; **yakınlık tabanlı metin + WebRTC sesli sohbet (boğuk yan-oda + duvar dinleme)**; **telefon sistemi (mesaj/sesli arama/silme izi/ele geçirme)**; **baskı turları**; **kürsü/söz hakkı**; gizli not defteri; oylama; ifşa + tam event log.

### Sesli sohbet hakkında not (anti-cheat)
Ses, P2P mesh + **istemci tarafı** mesafe filtresiyle çalışır (doküman Bölüm 8.4'teki iki seçenekten pragmatik olanı; arkadaş/Hamachi oyunu için uygun). İdeal anti-cheat (sunucu-karıştırmalı ses) ileride eklenebilir. Hamachi sanal ağında eşler birbirine doğrudan ulaştığı için STUN/internet olmadan da host adaylarıyla bağlantı kurulabilir.

## Test

Çekirdek döngü ve tüm yeni sistemler doğrulandı: senaryo üretimi, rol dağıtımı, hareket/AP, araştırma, telefon (gönder/sil/ele geçir/oku), birlikte arama, boş yuva, baskı turu ölçeklemesi, kürsü; ve iki gerçek istemciyle uçtan uca soket testi (oda kur/katıl, voice roster, WebRTC sinyal relay, chat/announce yayını).
