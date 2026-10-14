/* Transforma: the house tour.
   Each table-to-table transition is a pre-rendered 24 fps clip (Blender, EEVEE).
   One scroll, swipe or key press plays the whole transition to the next table;
   scrolling back plays a reversed clip. After the last table the page scrolls normally. */
(() => {
  const stage = document.getElementById('stage');
  const media = document.getElementById('media');
  const chapters = [...document.querySelectorAll('.chapter')];
  const dots = [...document.querySelectorAll('.dots [data-chapter]')];
  const bar = document.getElementById('loadbar');
  const cue = document.getElementById('cue');
  const dlg = document.getElementById('wl');
  const N = chapters.length;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = Math.min(screen.width, screen.height) < 600 || innerWidth < 820;
  const Q = small ? 'sd' : 'hd';
  const RATE = 1.25;
  // Phones and tablets: the page scrolls natively and each table owns one screen of scroll;
  // crossing into the next screen plays that transition once. Nothing ever blocks the scroll.
  const TOUCH = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const story = document.getElementById('story');
  if (TOUCH) document.documentElement.classList.add('touch');
  const probe = document.createElement('video');
  const EXT = 'mp4'; // H.264 plays in every current browser; others fall back to still frames
  // Video clips are served full-quality from the repo's CDN mirror (keeps the deployed
  // site itself tiny and fast; images/posters still ship with the page as before).
  const CLIP_BASE = 'https://cdn.jsdelivr.net/gh/sarrah608-cell/transforma-site@main/';
  const posterSrc = i => `posters/${Q}/p${i}.jpg`;

  let cur = 0, busy = false, pending = 0, needNewGesture = false, lastWheel = 0;

  // ---- posters (still frames at each table) ----
  const poster = new Image();
  poster.className = 'poster'; poster.alt = ''; poster.decoding = 'async';
  poster.src = `posters/${Q}/start.jpg`;
  media.appendChild(poster);
  [0, 1, 2, 3, 4].forEach(i => { const im = new Image(); im.src = posterSrc(i); });

  function crossfadeTo(src, done) {
    const next = new Image(); next.className = 'poster next'; next.alt = ''; next.src = src;
    const go = () => {
      media.appendChild(next);
      requestAnimationFrame(() => requestAnimationFrame(() => next.classList.remove('next')));
      media.querySelectorAll('video.on').forEach(v => v.classList.remove('on'));
      setTimeout(() => { poster.src = src; next.remove(); pool.forEach(release); done && done(); }, 750);
    };
    next.decode ? next.decode().then(go, go) : (next.onload = go);
  }

  // ---- diagnostics: add ?debug=1 to the address to see what the film is doing on this device ----
  const DEBUG = /[?&]debug\b/.test(location.search);
  const T0 = performance.now();
  const lines = [];
  let dbgBox = null;
  function log(msg) {
    if (!DEBUG) return;
    lines.push(((performance.now() - T0) / 1000).toFixed(1) + 's ' + msg);
    if (lines.length > 40) lines.shift();
    if (!dbgBox) {
      dbgBox = document.createElement('pre');
      dbgBox.style.cssText = 'position:fixed;left:6px;right:6px;top:6px;z-index:99999;margin:0;padding:8px;max-height:46vh;overflow:auto;background:rgba(0,0,0,.82);color:#7CFC9A;font:11px/1.35 ui-monospace,monospace;white-space:pre-wrap;border-radius:8px;pointer-events:none';
      document.body.appendChild(dbgBox);
    }
    dbgBox.textContent = lines.join('\n');
  }
  if (DEBUG) {
    const c = navigator.connection || {};
    log('touch=' + TOUCH + ' reducedMotion=' + reduced + ' quality=' + Q + ' h264=' + (probe.canPlayType('video/mp4; codecs="avc1.64001F"') || 'no'));
    log('net=' + (c.effectiveType || '?') + ' saveData=' + !!c.saveData + ' screen=' + screen.width + 'x' + screen.height);
  }

  // ---- clips ----
  // Each clip is downloaded in the background so later transitions start instantly. If a clip
  // isn't fully downloaded yet when it's needed, the player streams it straight from the CDN
  // instead of waiting (the files are built to start playing before they finish downloading).
  // Only TWO <video> elements ever exist: many phones can hardware-decode just a few videos at
  // once, so two pooled players ping-pong and the idle one is emptied to free its decoder.
  const names = ['intro', 'f0', 'f1', 'f2', 'f3', 'r0', 'r1', 'r2', 'r3'];
  const clipUrl = name => `${CLIP_BASE}clips/${Q}/${name}.${EXT}`;
  const blobs = {}, readySrc = {};
  function fetchClip(name, onProgress) {
    if (blobs[name]) return blobs[name];
    const url = clipUrl(name), t = performance.now();
    blobs[name] = fetch(url).then(async r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const total = +r.headers.get('content-length') || 0;
      if (!r.body || !total || !onProgress) return r.blob();
      const reader = r.body.getReader(); const parts = []; let got = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onProgress(got / total); }
      return new Blob(parts, { type: 'video/' + EXT });
    }).then(b => {
      readySrc[name] = URL.createObjectURL(b);
      log('downloaded ' + name + ' ' + Math.round(b.size / 1024) + 'KB in ' + Math.round(performance.now() - t) + 'ms');
      return readySrc[name];
    }).catch(err => { log('download FAILED ' + name + ': ' + err.message); return url; });
    return blobs[name];
  }
  const pool = [0, 1].map(() => {
    const v = document.createElement('video');
    v.muted = true; v.defaultMuted = true; v.playsInline = true;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    v.preload = 'auto'; v.disablePictureInPicture = true;
    media.appendChild(v);
    return v;
  });
  let slot = 0;
  function release(v) {
    if (!v.getAttribute('src')) return;
    try { v.pause(); } catch (e) {}
    v.classList.remove('on'); v.removeAttribute('src'); try { v.load(); } catch (e) {}
  }

  // Some phones refuse to start video without a tap (iPhone Low Power Mode, some data savers).
  // If that happens, a small "Tap to play" prompt appears; one tap unlocks both players.
  let blocked = false;
  const tapHint = document.createElement('button');
  tapHint.type = 'button'; tapHint.className = 'tap-hint'; tapHint.textContent = 'Tap to play the animation';
  tapHint.style.cssText = 'position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);z-index:4;display:none;border:0;border-radius:999px;padding:12px 20px;background:rgba(251,248,242,.95);color:#0e1a2b;font-family:inherit;font-weight:600;font-size:.9rem;line-height:1;box-shadow:0 6px 24px rgba(0,0,0,.3);cursor:pointer';
  stage.appendChild(tapHint);
  const unlocked = new Set();
  function unlock() {
    if (blocked) { blocked = false; tapHint.style.display = 'none'; }
    if (busy) return; // a transition is running: try again on the next tap
    pool.forEach(v => {
      if (unlocked.has(v) || v.classList.contains('on') || v.getAttribute('src')) return;
      const s = readySrc.intro || clipUrl('intro');
      v.src = s;
      const pr = v.play();
      if (pr && pr.then) pr.then(() => {
        unlocked.add(v);
        if (v.getAttribute('src') === s && !v.classList.contains('on')) { v.pause(); release(v); }
        log('player ' + pool.indexOf(v) + ' unlocked by tap');
        if (unlocked.size === pool.length) ['touchend', 'click', 'keydown'].forEach(ev => removeEventListener(ev, unlock, true));
      }, e => log('unlock skipped: ' + e.name));
    });
  }
  ['touchend', 'click', 'keydown'].forEach(ev => addEventListener(ev, unlock, { capture: true, passive: true }));
  tapHint.addEventListener('click', e => { e.stopPropagation(); unlock(); });

  let p1 = 0, p2 = 0;
  const showProgress = () => { if (bar) bar.style.transform = `scaleX(${Math.min(1, (p1 + p2) / 2)})`; };
  const first = Promise.all([
    fetchClip('intro', p => { p1 = p; showProgress(); }),
    fetchClip('f0', p => { p2 = p; showProgress(); }),
  ]);
  // the rest download quietly in order; on phones, only once the browser is idle so the
  // download never competes with the clip that is playing or with the user's scroll
  const rest = () => names.slice(2).reduce((chain, n) => chain.then(() => fetchClip(n)), Promise.resolve());
  first.then(() => (TOUCH && 'requestIdleCallback' in window) ? requestIdleCallback(rest, { timeout: 3000 }) : rest());
  let started = false;
  function start() {
    if (started) return; started = true;
    document.body.classList.add('ready');
    setChapter(0);
    if (reduced) { log('reduced motion is ON in this phone\'s settings: showing stills only'); crossfadeTo(posterSrc(0)); return; }
    busy = true;
    play('intro', () => { busy = false; TOUCH ? syncToScroll() : flushPending(); });
  }
  const posterReady = new Promise(res => { if (poster.complete && poster.naturalWidth) res(); else { poster.onload = res; poster.onerror = res; } });
  posterReady.then(() => { if (bar) bar.style.transform = 'scaleX(1)'; setTimeout(start, 250); });
  setTimeout(start, 3000); // never hold the page hostage to a slow connection

  // ---- playback ----
  function play(name, done) {
    const to = name === 'intro' ? 0 : (name[0] === 'f' ? +name[1] + 1 : +name[1]);
    const v = pool[slot], other = pool[1 - slot]; slot = 1 - slot;
    const t = performance.now();
    let over = false; // exactly one outcome: the clip plays through, or we fall back to a still
    const waitT = setTimeout(() => stage.classList.add('waiting'), 180);
    const settle = () => { clearTimeout(waitT); clearTimeout(stallT); stage.classList.remove('waiting'); };
    const fail = why => {
      if (over) return; over = true; settle(); release(v);
      log('play ' + name + ' -> still image (' + why + ')');
      crossfadeTo(posterSrc(to), done);
    };
    // never let a stuck clip freeze the page: after 10s with no picture, show the still
    const stallT = setTimeout(() => fail('no picture after 10s'), 10000);
    const src = readySrc[name] || clipUrl(name); // downloaded copy if ready, otherwise stream it
    if (!readySrc[name]) fetchClip(name);
    const go = () => {
      if (over) return;
      try { v.currentTime = 0; } catch (e) {}
      v.playbackRate = RATE;
      let finished = false;
      const finish = () => { if (finished || over) return; finished = true; over = true; v.removeEventListener('ended', finish); done && done(); };
      v.addEventListener('ended', finish);
      v.addEventListener('playing', () => {
        if (over) return;
        settle();
        log('play ' + name + ' OK (' + (readySrc[name] === src ? 'downloaded' : 'streamed') + ', started in ' + Math.round(performance.now() - t) + 'ms)');
        v.classList.add('on');
        release(other); // the previous clip is now hidden: free its decoder
        // safety net if 'ended' never fires
        const dur = (isFinite(v.duration) && v.duration ? v.duration : 6) / RATE;
        setTimeout(finish, dur * 1000 + 1500);
      }, { once: true });
      const pr = v.play();
      if (pr && pr.catch) pr.catch(err => {
        v.removeEventListener('ended', finish);
        if (err && err.name === 'NotAllowedError') { blocked = true; tapHint.style.display = 'block'; }
        fail('play() refused: ' + (err && err.name));
      });
    };
    v.src = src;
    if (v.readyState >= 2) go();
    else {
      v.addEventListener('loadeddata', go, { once: true });
      v.addEventListener('error', () => fail('video error ' + (v.error && v.error.code)), { once: true });
      v.load();
    }
  }

  function setChapter(i) {
    chapters.forEach((el, k) => el.classList.toggle('on', k === i));
    dots.forEach(d => { const on = +d.dataset.chapter === i; d.classList.toggle('on', on); d.setAttribute('aria-current', on ? 'step' : 'false'); });
    cue.querySelector('.mono').textContent = i < N - 1 ? 'Scroll' : 'Explore';
  }
  function hideChapters() { chapters.forEach(el => el.classList.remove('on')); }

  function step(d) {
    const target = cur + d;
    if (target < 0 || target >= N) return;
    busy = true;
    hideChapters();
    dots.forEach(x => x.classList.toggle('on', +x.dataset.chapter === target));
    const name = d > 0 ? `f${cur}` : `r${target}`;
    const clipLen = 6 / RATE;
    const tIn = setTimeout(() => setChapter(target), clipLen * 1000 * 0.62);
    if (reduced) {
      crossfadeTo(posterSrc(target), () => { clearTimeout(tIn); end(target); });
      return;
    }
    play(name, () => { clearTimeout(tIn); end(target); });
  }
  function end(target) {
    cur = target; setChapter(cur);
    poster.src = posterSrc(cur);
    busy = false; needNewGesture = true;
    TOUCH ? syncToScroll() : flushPending();
  }
  function flushPending() {
    const p = pending; pending = 0;
    if (p > 0 && cur < N - 1) step(1);
    else if (p < 0 && cur > 0) step(-1);
  }
  function intent(d) {
    if (busy) { pending = d; return; }
    if (d > 0 && cur < N - 1) step(1);
    else if (d < 0 && cur > 0) step(-1);
  }
  // ---- touch devices: the scroll position picks the table ----
  const chapterTop = j => story.offsetTop + j * innerHeight;
  function desired() {
    const rel = (scrollY - story.offsetTop) / Math.max(1, innerHeight);
    return Math.min(N - 1, Math.max(0, Math.floor(rel + 0.7)));
  }
  function syncToScroll() {
    if (!TOUCH || busy || !started) return;
    const d = desired();
    if (d === cur) return;
    if (Math.abs(d - cur) === 1) { step(d - cur); return; }
    busy = true; hideChapters();
    dots.forEach(x => x.classList.toggle('on', +x.dataset.chapter === d));
    crossfadeTo(posterSrc(d), () => end(d));
  }
  if (TOUCH) {
    let ticking = false;
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; syncToScroll(); }); } }, { passive: true });
  }
  function goTo(j, scrollUp) {
    if (TOUCH) { scrollTo({ top: chapterTop(j), behavior: reduced ? 'auto' : 'smooth' }); return; }
    const run = () => {
      if (j === cur || busy) return;
      if (Math.abs(j - cur) === 1) { step(j - cur); return; }
      busy = true; hideChapters();
      dots.forEach(x => x.classList.toggle('on', +x.dataset.chapter === j));
      crossfadeTo(posterSrc(j), () => end(j));
    };
    if (scrollUp && scrollY > 2) {
      scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
      const t0 = performance.now();
      const wait = () => { if (scrollY <= 2 || performance.now() - t0 > 1600) setTimeout(run, 120); else requestAnimationFrame(wait); };
      requestAnimationFrame(wait);
    } else run();
  }
  window.__film = { goTo, get chapter() { return cur; } };

  const atTop = () => scrollY <= 2;
  const modalOpen = () => dlg && dlg.open;
  const toIdea = () => document.getElementById('idea').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });

  // ---- wheel / trackpad: one gesture = one transition ----
  if (!TOUCH) addEventListener('wheel', e => {
    const now = performance.now(); const gap = now - lastWheel; lastWheel = now;
    if (modalOpen() || !atTop() || e.ctrlKey) return;
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    const fresh = gap > 220;
    const down = e.deltaY > 0;
    if (needNewGesture) {
      if (!fresh) { if (down ? true : cur > 0) e.preventDefault(); return; }
      needNewGesture = false;
    }
    if (down) {
      if (cur < N - 1 || busy) { e.preventDefault(); if (fresh) intent(1); }
      // on the last table a fresh scroll simply continues down the page
    } else {
      if (cur > 0 || busy) { e.preventDefault(); if (fresh) intent(-1); }
    }
  }, { passive: false });

  // ---- touch: one swipe = one transition ----
  let ty = null, tx = 0;
  if (!TOUCH) stage.addEventListener('touchstart', e => { if (e.touches.length === 1) { ty = e.touches[0].clientY; tx = e.touches[0].clientX; } else ty = null; }, { passive: true });
  if (!TOUCH) stage.addEventListener('touchmove', e => { if (ty !== null && e.cancelable) e.preventDefault(); }, { passive: false });
  if (!TOUCH) stage.addEventListener('touchend', e => {
    if (ty === null) return;
    const t = e.changedTouches[0]; const dy = ty - t.clientY, dx = tx - t.clientX; ty = null;
    if (Math.abs(dy) < 34 || Math.abs(dy) < Math.abs(dx)) return;
    if (!atTop()) { dy > 0 ? toIdea() : scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (dy > 0) { if (cur < N - 1 || busy) intent(1); else toIdea(); }
    else intent(-1);
  }, { passive: true });

  // ---- keyboard ----
  addEventListener('keydown', e => {
    if (modalOpen() || !atTop() || e.altKey || e.metaKey || e.ctrlKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !e.shiftKey && tag !== 'BUTTON')) {
      if (cur < N - 1 || busy) { e.preventDefault(); intent(1); }
    } else if (k === 'ArrowUp' || k === 'PageUp' || (k === ' ' && e.shiftKey)) {
      if (cur > 0 || busy) { e.preventDefault(); intent(-1); }
    }
  });

  dots.forEach(d => d.addEventListener('click', () => goTo(+d.dataset.chapter)));
  cue.addEventListener('click', () => { if (TOUCH) { cur < N - 1 ? goTo(cur + 1) : toIdea(); return; } if (cur < N - 1) intent(1); else toIdea(); });

  // pause clips while the tab is hidden; nothing runs once the story is scrolled away
  document.addEventListener('visibilitychange', () => { if (document.hidden) media.querySelectorAll('video').forEach(v => { if (!v.paused && !busy) v.pause(); }); });
})();
