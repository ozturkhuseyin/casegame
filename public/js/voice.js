/* ============================================================
   Proximity Sesli Sohbet (Bölüm 8)
   WebRTC mesh (P2P) + Web Audio API ile mesafe tabanlı ses filtresi.
   - Aynı oda: net, tam ses.
   - Yan oda (pasif): boğuk, kısık (low-pass + düşük gain).
   - Yan oda (aktif dinleme/eavesdrop): daha anlaşılır.
   - Uzak oda: susturulur (gain 0).
   - Telefon araması: mesafeden bağımsız tam ses (Bölüm 9.2).
   Sinyalleşme sunucu üzerinden; ses akışı doğrudan eşler arası.
   ============================================================ */
(function () {
  const RTC_CONFIG = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], // internet yoksa host adayları kullanılır
  };

  const Voice = {
    socket: null,
    myId: null,
    enabled: false,
    localStream: null,
    audioCtx: null,
    peers: new Map(),     // playerId -> { pc, audioEl, source, filter, gain }
    roster: [],
    lastState: null,
    onStatus: null,
  };

  Voice.init = function (socket, myId, onStatus) {
    Voice.socket = socket;
    Voice.myId = myId;
    Voice.onStatus = onStatus;

    socket.on('voice:roster', ({ roster }) => {
      Voice.roster = roster || [];
      if (Voice.enabled) Voice.roster.forEach((r) => { if (r.playerId !== myId) Voice._ensurePeer(r.playerId); });
    });

    socket.on('rtc:signal', async ({ fromPlayerId, signal }) => {
      if (!Voice.enabled) return; // sese katılmadıysan yok say
      const peer = Voice._ensurePeer(fromPlayerId);
      try {
        if (signal.type === 'offer') {
          await peer.pc.setRemoteDescription(signal);
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          Voice._send(fromPlayerId, peer.pc.localDescription);
        } else if (signal.type === 'answer') {
          await peer.pc.setRemoteDescription(signal);
        } else if (signal.candidate) {
          await peer.pc.addIceCandidate(signal).catch(() => {});
        }
      } catch (e) { /* sinyal hatası yok say */ }
    });
  };

  Voice.toggle = async function () {
    if (Voice.enabled) { Voice._disable(); return false; }
    try {
      Voice.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      Voice.audioCtx = Voice.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (Voice.audioCtx.state === 'suspended') await Voice.audioCtx.resume();
      Voice.enabled = true;
      Voice.socket.emit('voice:ready');
      // Mevcut roster'daki herkese bağlan
      Voice.roster.forEach((r) => { if (r.playerId !== Voice.myId) Voice._ensurePeer(r.playerId); });
      if (Voice.lastState) Voice.updateRouting(Voice.lastState);
      if (Voice.onStatus) Voice.onStatus(true);
      return true;
    } catch (e) {
      alert('Mikrofona erişilemedi: ' + e.message);
      return false;
    }
  };

  Voice._disable = function () {
    Voice.enabled = false;
    Voice.peers.forEach((peer) => { try { peer.pc.close(); } catch (e) {} if (peer.audioEl) peer.audioEl.remove(); });
    Voice.peers.clear();
    if (Voice.localStream) { Voice.localStream.getTracks().forEach((t) => t.stop()); Voice.localStream = null; }
    if (Voice.onStatus) Voice.onStatus(false);
  };

  Voice._send = function (toPlayerId, signal) {
    Voice.socket.emit('rtc:signal', { toPlayerId, signal });
  };

  Voice._ensurePeer = function (otherId) {
    if (Voice.peers.has(otherId)) return Voice.peers.get(otherId);
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const peer = { pc, audioEl: null, source: null, filter: null, gain: null };
    Voice.peers.set(otherId, peer);

    // Yerel mikrofonu ekle
    if (Voice.localStream) {
      Voice.localStream.getTracks().forEach((t) => pc.addTrack(t, Voice.localStream));
    }

    pc.onicecandidate = (e) => { if (e.candidate) Voice._send(otherId, e.candidate); };
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      // Chrome için: sessiz <audio> elementine bağla, ama çıkışı Web Audio üzerinden ver
      const audioEl = document.createElement('audio');
      audioEl.srcObject = stream; audioEl.autoplay = true; audioEl.muted = true;
      document.body.appendChild(audioEl);
      const source = Voice.audioCtx.createMediaStreamSource(stream);
      const filter = Voice.audioCtx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 20000;
      const gain = Voice.audioCtx.createGain(); gain.gain.value = 0;
      source.connect(filter); filter.connect(gain); gain.connect(Voice.audioCtx.destination);
      peer.audioEl = audioEl; peer.source = source; peer.filter = filter; peer.gain = gain;
      if (Voice.lastState) Voice.updateRouting(Voice.lastState);
    };
    pc.onnegotiationneeded = async () => {
      // Glare önleme: yalnızca "küçük" kimlik teklif başlatır
      if (Voice.myId > otherId) return;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        Voice._send(otherId, pc.localDescription);
      } catch (e) {}
    };

    // Eğer biz initiator isek ve onnegotiationneeded tetiklenmezse (track yoksa) elle teklif
    if (Voice.myId < otherId && Voice.localStream) {
      // onnegotiationneeded track eklenince tetiklenir; ek garanti:
      setTimeout(async () => {
        if (pc.signalingState === 'stable' && !pc.localDescription) {
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            Voice._send(otherId, pc.localDescription);
          } catch (e) {}
        }
      }, 300);
    }
    return peer;
  };

  // Durum güncellenince her eş için mesafe tabanlı ses yönlendirmesi
  Voice.updateRouting = function (state) {
    Voice.lastState = state;
    if (!Voice.enabled || !Voice.audioCtx) return;
    const myRoom = state.you.position;
    const adj = (state.rooms.find((r) => r.id === myRoom)?.adjacent) || [];
    const eavesTarget = state.myEavesdropTarget;
    const callPartner = state.callPartnerId;

    Voice.peers.forEach((peer, otherId) => {
      if (!peer.gain) return;
      const pInfo = state.players.find((x) => x.id === otherId);
      const theirRoom = pInfo ? pInfo.position : null; // same/adjacent ise dolu

      let gain = 0, cutoff = 20000;
      if (otherId === callPartner) {
        gain = 1.0; cutoff = 20000;                 // telefon araması: tam ses
      } else if (theirRoom && theirRoom === myRoom) {
        gain = 1.0; cutoff = 20000;                 // aynı oda: net
      } else if (theirRoom && adj.includes(theirRoom)) {
        if (eavesTarget === theirRoom) { gain = 0.85; cutoff = 2200; } // aktif dinleme
        else { gain = 0.28; cutoff = 500; }          // pasif sızıntı: boğuk
      } else {
        gain = 0;                                    // uzak / görünmez: sustur
      }
      try {
        peer.gain.gain.setTargetAtTime(gain, Voice.audioCtx.currentTime, 0.08);
        peer.filter.frequency.setTargetAtTime(cutoff, Voice.audioCtx.currentTime, 0.08);
      } catch (e) {}
    });
  };

  window.Voice = Voice;
})();
