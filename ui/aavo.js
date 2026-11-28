// Aavo: the little robot assistant in the corner. Type or talk to it; it answers out loud and can do things in the app.
(function () {
  const ROBOT = `<svg class="robot" viewBox="0 0 120 120" aria-hidden="true">
    <defs><linearGradient id="rb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9b3450"/><stop offset="1" stop-color="#5c1426"/></linearGradient>
      <radialGradient id="rg" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#e8f0e4"/><stop offset="1" stop-color="#9fb09b"/></radialGradient></defs>
    <g class="r-all">
      <line x1="60" y1="10" x2="60" y2="24" stroke="#5c1426" stroke-width="3" stroke-linecap="round"/>
      <circle class="r-ant" cx="60" cy="9" r="5" fill="url(#rg)"/>
      <rect x="18" y="44" width="8" height="20" rx="4" fill="#8f9c8c"/><rect x="94" y="44" width="8" height="20" rx="4" fill="#8f9c8c"/>
      <rect x="24" y="22" width="72" height="62" rx="22" fill="url(#rb)"/>
      <rect x="32" y="32" width="56" height="40" rx="14" fill="#1d1418"/>
      <g class="r-eyes"><ellipse class="r-eye" cx="48" cy="50" rx="6" ry="7" fill="url(#rg)"/><ellipse class="r-eye" cx="72" cy="50" rx="6" ry="7" fill="url(#rg)"/></g>
      <rect class="r-mouth" x="52" y="62" width="16" height="3.5" rx="1.75" fill="#9fb09b"/>
      <rect x="40" y="86" width="40" height="22" rx="10" fill="#8f9c8c"/>
      <circle cx="60" cy="97" r="4.5" fill="url(#rb)"/>
    </g></svg>`;
  const css = `
  #aavo-fab{position:fixed;right:22px;bottom:22px;z-index:70;width:74px;height:74px;border-radius:50%;border:0;padding:6px;cursor:pointer;background:radial-gradient(circle at 50% 35%,#ffffff,#e9ede6);box-shadow:0 14px 34px -12px rgba(92,20,38,.55),0 0 0 1px rgba(122,31,53,.15);display:grid;place-items:center;transition:transform .25s}
  #aavo-fab:hover{transform:translateY(-3px) scale(1.04)}
  #aavo-fab .robot{width:62px;height:62px}
  #aavo-fab .hi{position:absolute;right:82px;bottom:20px;background:#2b2326;color:#fff;font-size:12.5px;padding:7px 11px;border-radius:12px 12px 2px 12px;white-space:nowrap;opacity:0;transform:translateX(8px);transition:.35s;pointer-events:none}
  #aavo-fab:hover .hi,#aavo-fab.greet .hi{opacity:1;transform:none}
  .robot .r-all{animation:rbob 3.2s ease-in-out infinite;transform-origin:60px 60px}
  @keyframes rbob{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-3px) rotate(-2deg)}}
  .robot .r-eye{animation:rblink 4.5s infinite;transform-box:fill-box;transform-origin:center}
  @keyframes rblink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
  .robot .r-ant{animation:rglow 2s ease-in-out infinite}
  @keyframes rglow{0%,100%{filter:drop-shadow(0 0 0 #9fb09b)}50%{filter:drop-shadow(0 0 6px #b9cbb4)}}
  .aavo-talking .robot .r-mouth{animation:rtalk .18s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:center}
  @keyframes rtalk{from{transform:scaleY(1)}to{transform:scaleY(3.2)}}
  .aavo-thinking .robot .r-eyes{animation:rlook 1.2s ease-in-out infinite}
  @keyframes rlook{0%,100%{transform:translateX(-3px)}50%{transform:translateX(3px)}}
  .aavo-listening #aavo-fab,.aavo-listening .aavo-head .robot{box-shadow:0 0 0 0 rgba(122,31,53,.5);animation:rlisten 1.2s infinite}
  @keyframes rlisten{0%{box-shadow:0 0 0 0 rgba(122,31,53,.45)}100%{box-shadow:0 0 0 18px rgba(122,31,53,0)}}
  #aavo{position:fixed;right:22px;bottom:108px;z-index:70;width:min(400px,calc(100vw - 32px));height:min(600px,calc(100vh - 140px));display:flex;flex-direction:column;background:rgba(255,255,255,.96);backdrop-filter:blur(14px);border:1px solid #e2e6de;border-radius:22px;box-shadow:0 30px 80px -30px rgba(60,20,30,.45);overflow:hidden;transform-origin:bottom right;transition:transform .3s cubic-bezier(.2,.8,.2,1),opacity .3s}
  #aavo.closed{transform:scale(.6) translateY(30px);opacity:0;pointer-events:none}
  .aavo-head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:linear-gradient(135deg,#7a1f35,#5c1426);color:#fff}
  .aavo-head .robot{width:44px;height:44px;background:#fff;border-radius:50%;padding:3px}
  .aavo-head b{display:block;font-size:15px}.aavo-head span{font-size:11.5px;opacity:.8}
  .aavo-head button{margin-left:auto;background:rgba(255,255,255,.14);border:0;color:#fff;width:32px;height:32px;border-radius:10px;cursor:pointer;font-size:15px}
  .aavo-head button+button{margin-left:6px}
  .aavo-msgs{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:linear-gradient(180deg,#f7f8f4,#fff)}
  .am{max-width:86%;padding:9px 12px;border-radius:14px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word;animation:rise .3s both}
  .am.u{align-self:flex-end;background:linear-gradient(135deg,#7a1f35,#5c1426);color:#fff;border-bottom-right-radius:4px}
  .am.a{align-self:flex-start;background:#eef1ec;color:#2b2326;border-bottom-left-radius:4px}
  .am .cf{margin-top:8px;display:flex;gap:6px}
  .am .cf button{border:0;border-radius:9px;padding:6px 12px;cursor:pointer;font-weight:600}
  .am .cf .yes{background:#7a1f35;color:#fff}.am .cf .no{background:#dfe5dc;color:#2b2326}
  .typing{display:inline-flex;gap:4px}.typing i{width:6px;height:6px;border-radius:50%;background:#8f9c8c;animation:tdot 1s infinite}.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
  @keyframes tdot{0%,100%{opacity:.3;transform:translateY(0)}50%{opacity:1;transform:translateY(-3px)}}
  .aavo-chips{display:flex;gap:6px;flex-wrap:wrap;padding:8px 12px 0}
  .aavo-chips button{border:1px solid #cdd4c8;background:#fbfcf9;border-radius:999px;padding:5px 10px;font-size:12px;cursor:pointer;color:#4f5a4d}
  .aavo-chips button:hover{border-color:#7a1f35;color:#7a1f35}
  .aavo-in{display:flex;gap:8px;padding:10px 12px 12px;align-items:flex-end}
  .aavo-in textarea{flex:1;min-height:40px;max-height:110px;height:40px;resize:none;border-radius:12px;padding:9px 12px;font-size:13.5px}
  .aavo-in button{width:40px;height:40px;border-radius:12px;border:0;cursor:pointer;flex:none;font-size:16px}
  .aavo-mic{background:#dfe5dc;color:#5c1426}.aavo-mic.on{background:#b3364a;color:#fff;animation:rlisten 1.2s infinite}
  .aavo-rec{display:flex;align-items:center;gap:8px;margin:8px 12px 0;padding:8px 10px;border-radius:12px;background:#fbeef1;border:1px solid rgba(122,31,53,.25);font-size:12px;color:#5c1426}
  .aavo-rec .dot{width:9px;height:9px;border-radius:50%;background:#b3364a;animation:rlisten 1s infinite;flex:none}
  .aavo-rec .lvl{flex:0 0 90px;height:6px;border-radius:6px;background:#e7d6db;overflow:hidden}.aavo-rec .lvl b{display:block;height:100%;width:0;background:linear-gradient(90deg,#8f9c8c,#7a1f35);transition:width .08s}
  .aavo-rec .tm{font-variant-numeric:tabular-nums;font-weight:600}.aavo-rec .hint{opacity:.85;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .aavo-in textarea{line-height:1.4;overflow-y:auto}
  .aavo-send{background:linear-gradient(135deg,#9b3450,#5c1426);color:#fff}
  @media (prefers-reduced-motion:reduce){.robot *{animation:none!important}}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const fab = document.createElement('button'); fab.id = 'aavo-fab'; fab.title = 'Aavo, your assistant'; fab.setAttribute('aria-label', 'Open Aavo, your assistant');
  fab.innerHTML = ROBOT + '<span class="hi">Hi! I\'m Aavo. Ask me anything 👋</span>';
  const box = document.createElement('section'); box.id = 'aavo'; box.className = 'closed'; box.setAttribute('aria-label', 'Aavo assistant');
  box.innerHTML = `<div class="aavo-head">${ROBOT}<div><b>Aavo</b><span>Your lead assistant · type or talk</span></div><button id="aavoAuto" title="Do it straight away: Aavo carries out your commands without asking first">⚡</button><button id="aavoVoice" title="Speak answers out loud">🔊</button><button id="aavoX" title="Close">✕</button></div>
    <div class="aavo-msgs" id="aavoMsgs" aria-live="polite"></div>
    <div class="aavo-chips">${['Pitch everything now', "Today's numbers", 'Email all LinkedIn leads', 'Connect all on LinkedIn', 'Answer all replies', 'Send all emails now', 'Find new leads now', 'Any alarms?'].map(c => `<button>${c}</button>`).join('')}</div>
    <div class="aavo-in"><button class="aavo-mic" id="aavoMic" title="Talk (click, speak, click again)">🎤</button><textarea id="aavoTxt" placeholder="Type a message…" rows="1"></textarea><button class="aavo-send" id="aavoGo" title="Send">➤</button></div>`;
  document.body.append(fab, box);
  const $m = box.querySelector('#aavoMsgs'), $t = box.querySelector('#aavoTxt');
  const store = { get(k, d) { try { const v = JSON.parse(sessionStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  let auto = (() => { try { return localStorage.getItem('aavo_auto') !== 'off'; } catch (e) { return true; } })();
  let hist = store.get('aavo_hist', []), speak = (() => { try { return localStorage.getItem('aavo_voice') !== 'off'; } catch (e) { return true; } })(), busy = false;
  const mood = m => { document.body.classList.toggle('aavo-thinking', m === 'think'); document.body.classList.toggle('aavo-talking', m === 'talk'); document.body.classList.toggle('aavo-listening', m === 'listen'); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function draw() {
    $m.innerHTML = (hist.length ? hist : [{ role: 'aavo', text: "Hi, I'm Aavo! 👋 Tell me what to do and I'll do it. For example:\n• \"send mail to all in LinkedIn\"\n• \"connect 10 people on LinkedIn\"\n• \"find dentists in Dubai\"\n• \"answer all replies\"\n• \"send all emails now\"\n• \"set daily limit to 40\"\nType, or click 🎤 and talk. ⚡ on = I do it straight away; ⚡ off = I ask first." }])
      .map((h, i) => `<div class="am ${h.role === 'user' ? 'u' : 'a'}">${esc(h.text)}${h.confirm && !h.done ? `<div class="cf"><button class="yes" data-i="${i}">Confirm</button><button class="no" data-i="${i}">Cancel</button></div>` : ''}</div>`).join('') + (busy ? '<div class="am a"><span class="typing"><i></i><i></i><i></i></span></div>' : '');
    $m.scrollTop = $m.scrollHeight;
    $m.querySelectorAll('.cf button').forEach(b => b.onclick = () => decide(+b.dataset.i, b.classList.contains('yes')));
    box.querySelector('#aavoVoice').textContent = speak ? '🔊' : '🔇';
    const ab = box.querySelector('#aavoAuto'); ab.style.background = auto ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.14)'; ab.style.color = auto ? '#7a1f35' : '#fff'; ab.title = auto ? 'Do it straight away is ON: I carry out your commands without asking. Click to make me ask first.' : 'Do it straight away is OFF: I ask before sending or changing anything. Click to turn on.';
  }
  function say(text) {
    if (!speak || !window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text).replace(/[\u{1F300}-\u{1FAFF}☀-➿★✉⚠✓·•…]/gu, ' ').replace(/\n+/g, '. ').slice(0, 600));
      const vs = speechSynthesis.getVoices(); u.voice = vs.find(v => /en-IN/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null; u.rate = 1.03; u.pitch = 1.1;
      u.onstart = () => mood('talk'); u.onend = u.onerror = () => mood('');
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  function add(m) { hist.push(m); hist = hist.slice(-30); store.set('aavo_hist', hist); draw(); }
  function handle(r) {
    add({ role: 'aavo', text: r.text || 'Okay.', confirm: r.confirm, draft: r.draft });
    say(r.confirm ? (r.text || 'Please confirm.') : r.text);
    if (r.page) setTimeout(() => { location.hash = '#/' + r.page; }, 500);
  }
  async function send(text) {
    text = String(text || '').trim(); if (!text || busy) return;
    let settle = null; const pend = [...hist].reverse().find(h => h.role !== 'user'); if (pend && pend.confirm && !pend.done && /^(yes|yeah|yep|ok|okay|sure|confirm|do it|go|go ahead|send|seri|sari|aama|aamaa|haan|ha|podu|pannu|anuppu|no|cancel|stop|venam|vendam|illa)\b/i.test(text)) settle = pend;
    add({ role: 'user', text }); $t.value = ''; $t.style.height = '40px'; $t.focus(); busy = true; mood('think'); draw();
    try { handle(await api('/assistant/chat', { method: 'POST', body: { auto, history: hist.map(h => ({ role: h.role, text: h.text, draft: h.draft, confirm: h.confirm, done: h.done })), page: (location.hash.replace(/^#\/?/, '') || 'dashboard') } })); }
    catch (e) { add({ role: 'aavo', text: 'Sorry, something went wrong: ' + e.message }); }
    finally { if (settle) { settle.done = true; store.set('aavo_hist', hist); } busy = false; if (!document.body.classList.contains('aavo-talking')) mood(''); draw(); }
  }
  async function decide(i, yes) {
    const h = hist[i]; if (!h || !h.confirm) return; h.done = true; store.set('aavo_hist', hist);
    if (!yes) { add({ role: 'aavo', text: 'Okay, cancelled.' }); return; }
    busy = true; mood('think'); draw();
    try { handle(await api('/assistant/confirm', { method: 'POST', body: h.confirm })); } catch (e) { add({ role: 'aavo', text: 'That did not work: ' + e.message }); }
    finally { busy = false; mood(''); draw(); }
  }
  // ---- voice in: record the microphone as WAV (16 kHz mono, what the AI understands best), then the AI writes down what was said.
  // A live level meter + timer shows it is really hearing you; it stops by itself after 2 seconds of silence (or 30 seconds).
  let rec = null;
  function wav(samples, rate) {
    const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) { const x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
    return new Uint8Array(buf);
  }
  function down(chunks, from, to) { // join the recorded pieces and resample to 16 kHz
    const len = chunks.reduce((a, c) => a + c.length, 0), all = new Float32Array(len); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    const ratio = from / to, out = new Float32Array(Math.floor(len / ratio));
    for (let i = 0; i < out.length; i++) { const a = Math.floor(i * ratio), b = Math.min(len, Math.floor((i + 1) * ratio)); let s = 0; for (let j = a; j < b; j++) s += all[j]; out[i] = s / Math.max(1, b - a); }
    return out;
  }
  const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  async function mic() {
    const btn = box.querySelector('#aavoMic');
    if (rec) { rec.stop(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
    catch (e) { add({ role: 'aavo', text: e.name === 'NotAllowedError' ? 'Windows is blocking the microphone. Open Windows Settings → Privacy & security → Microphone, and allow desktop apps to use it.' : e.name === 'NotFoundError' ? 'No microphone was found. Plug one in (or check your headset) and try again.' : 'I cannot use the microphone: ' + (e.message || e.name) }); return; }
    try { speechSynthesis.cancel(); } catch (e) {}
    const ctx = new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') await ctx.resume();
    const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(4096, 1, 1), mute = ctx.createGain(); mute.gain.value = 0;
    const chunks = []; let heard = false, quietSince = Date.now(), t0 = Date.now();
    const meter = document.createElement('div'); meter.className = 'aavo-rec'; meter.innerHTML = '<i class="dot"></i><span class="lvl"><b></b></span><span class="tm">0:00</span><span class="hint">Listening… speak now (click 🎤 to stop)</span>';
    box.querySelector('.aavo-in').before(meter);
    proc.onaudioprocess = e => {
      const d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d));
      let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] * d[i]; const rms = Math.sqrt(sum / (d.length / 4));
      meter.querySelector('b').style.width = Math.min(100, rms * 900) + '%';
      const s = Math.floor((Date.now() - t0) / 1000); meter.querySelector('.tm').textContent = `0:${String(s).padStart(2, '0')}`;
      if (rms > 0.02) { heard = true; quietSince = Date.now(); meter.querySelector('.hint').textContent = 'Hearing you…'; }
      if ((heard && Date.now() - quietSince > 2000) || Date.now() - t0 > 30000) rec && rec.stop();
    };
    src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
    btn.classList.add('on'); mood('listen');
    rec = { stop: async () => {
      if (!rec) return; rec = null;
      proc.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop()); const rate = ctx.sampleRate; ctx.close().catch(() => {});
      btn.classList.remove('on'); mood(''); meter.remove();
      if (!heard) { add({ role: 'aavo', text: "I didn't hear anything. Check the microphone is not muted, then click 🎤 and speak a little louder." }); return; }
      busy = true; mood('think'); draw();
      try {
        const v = await api('/assistant/voice', { method: 'POST', body: { audio: b64(wav(down(chunks, rate, 16000), 16000)), mime: 'audio/wav' } });
        busy = false;
        if (v.text && v.text.trim()) { speak = true; send(v.text); } else { draw(); add({ role: 'aavo', text: "I couldn't make out the words. Please try again, a bit closer to the microphone." }); }
      } catch (e) { busy = false; mood(''); draw(); add({ role: 'aavo', text: 'Voice did not work: ' + e.message + ' You can type instead.' }); }
    } };
  }
  // ---- wiring
  const toggle = open => { box.classList.toggle('closed', !open); fab.classList.remove('greet'); if (open) { draw(); setTimeout(() => $t.focus(), 200); } else { try { speechSynthesis.cancel(); } catch (e) {} } };
  fab.onclick = () => toggle(box.classList.contains('closed'));
  box.querySelector('#aavoX').onclick = () => toggle(false);
  box.querySelector('#aavoGo').onclick = () => send($t.value);
  box.querySelector('#aavoMic').onclick = mic;
  box.querySelector('#aavoAuto').onclick = () => { auto = !auto; try { localStorage.setItem('aavo_auto', auto ? 'on' : 'off'); } catch (e) {} add({ role: 'aavo', text: auto ? '⚡ Do it straight away is ON: I will carry out your commands without asking.' : 'Okay, I will ask you before sending or changing anything.' }); };
  box.querySelector('#aavoVoice').onclick = () => { speak = !speak; try { localStorage.setItem('aavo_voice', speak ? 'on' : 'off'); } catch (e) {} if (!speak) try { speechSynthesis.cancel(); } catch (e) {} draw(); };
  box.querySelectorAll('.aavo-chips button').forEach(b => b.onclick = () => send(b.textContent));
  $t.addEventListener('input', () => { $t.style.height = '40px'; $t.style.height = Math.min(110, $t.scrollHeight) + 'px'; });
  $t.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($t.value); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !box.classList.contains('closed')) toggle(false); });
  // only for people who are logged in
  setInterval(() => { const on = typeof S !== 'undefined' && !!S.me && !document.querySelector('#scrim'); fab.style.display = on ? '' : 'none'; if (!on) box.classList.add('closed'); }, 700);
  setTimeout(() => { fab.classList.add('greet'); setTimeout(() => fab.classList.remove('greet'), 4000); }, 4500);
  draw();
})();
