// AAVORAA motion: a slow gold particle field behind the app, two drifting light orbs,
// and an intro where the logo draws itself (once per session, click to skip). Respects "reduce motion".
(function () {
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // --- background orbs + particle canvas
  for (const c of ['a', 'b']) { const o = document.createElement('div'); o.className = 'orb ' + c; document.body.prepend(o); }
  if (!reduce) {
    const cv = document.createElement('canvas'); cv.id = 'fx'; document.body.prepend(cv);
    const ctx = cv.getContext('2d'); const RGB = (getComputedStyle(document.documentElement).getPropertyValue('--fx') || '242,209,139').trim(); let W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1), mx = -9999, my = -9999;
    const N = Math.round(Math.min(70, (innerWidth * innerHeight) / 26000));
    const P = Array.from({ length: N }, () => ({ x: Math.random(), y: Math.random(), vx: (Math.random() - .5) * .00018, vy: (Math.random() - .5) * .00018 - .00006, r: Math.random() * 1.6 + .4, t: Math.random() * 6.28 }));
    const size = () => { W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size(); addEventListener('resize', size);
    addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
    let last = 0;
    const frame = now => {
      requestAnimationFrame(frame);
      if (document.hidden || now - last < 33) return; // ~30 fps is plenty for a background
      last = now; ctx.clearRect(0, 0, W, H);
      for (const p of P) {
        p.x += p.vx; p.y += p.vy; p.t += .02;
        if (p.x < -.02) p.x = 1.02; if (p.x > 1.02) p.x = -.02; if (p.y < -.02) p.y = 1.02; if (p.y > 1.02) p.y = -.02;
        const x = p.x * W, y = p.y * H, d = Math.hypot(x - mx, y - my);
        const a = .35 + Math.sin(p.t) * .25 + (d < 160 ? (1 - d / 160) * .5 : 0);
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, 6.283); ctx.fillStyle = `rgba(${RGB},${a})`; ctx.shadowColor = `rgba(${RGB},.6)`; ctx.shadowBlur = 6; ctx.fill();
      }
      ctx.shadowBlur = 0;
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
        const dx = (P[i].x - P[j].x) * W, dy = (P[i].y - P[j].y) * H, d = dx * dx + dy * dy;
        if (d < 14000) { ctx.strokeStyle = `rgba(${RGB},${.16 * (1 - d / 14000)})`; ctx.lineWidth = .6; ctx.beginPath(); ctx.moveTo(P[i].x * W, P[i].y * H); ctx.lineTo(P[j].x * W, P[j].y * H); ctx.stroke(); }
      }
    };
    requestAnimationFrame(frame);
  }
  // --- intro, once per session
  let seen = false; try { seen = sessionStorage.getItem('aav_intro') === '1'; sessionStorage.setItem('aav_intro', '1'); } catch (e) {}
  if (reduce || seen) return;
  const el = document.createElement('div'); el.id = 'intro'; el.setAttribute('aria-hidden', 'true');
  const letters = 'ΛΛVORΛΛ'.split('').map((c, i) => `<span style="animation-delay:${.9 + i * .08}s">${c}</span>`).join('');
  const sparks = Array.from({ length: 18 }, (_, i) => { const ang = i / 18 * 6.283, r = 130 + Math.random() * 60; return `<i class="sparkle" style="--dx:${Math.cos(ang) * r}px;--dy:${Math.sin(ang) * r}px;animation-delay:${1.1 + Math.random() * .4}s"></i>`; }).join('');
  el.innerHTML = `<div class="stage"><svg class="ring" viewBox="0 0 250 250"><defs><linearGradient id="ig" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a33a55"/><stop offset=".5" stop-color="#7a1f35"/><stop offset="1" stop-color="#8f9c8c"/></linearGradient></defs><circle cx="125" cy="125" r="120"/></svg>${sparks}<img src="/logo-mark.png" alt=""><div class="wm">${letters}</div><div class="tl">BEYOND POSSIBILITIES</div></div>`;
  document.body.appendChild(el);
  const done = () => { el.classList.add('out'); setTimeout(() => el.remove(), 800); };
  el.onclick = done; setTimeout(done, 3400);
})();
