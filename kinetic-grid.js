/*
 * The hover grid from Sathya's Framer splash ("Kinetic Grid"), redrawn in ink
 * on paper sections (and in Framer's white on dark ones): a 60px lattice of faint lines and dots that darkens
 * around the cursor and bends in towards it; holding the mouse down pushes it
 * back out. Same settings as the Framer build and the portfolio splash.
 *
 * It runs behind EVERY section of the page. The script adds it itself: each
 * <section> gets a .kgrid-wrap holding one canvas. The canvas is only as tall
 * as the screen and sticks while its section scrolls past, and it only holds
 * pixels while its section is on screen, so a page of fourteen sections costs
 * what two or three screens cost. The lattice is anchored to the page, so it
 * scrolls with the content and lines up from one section to the next.
 * It never runs behind text: every heading, paragraph, list item, caption
 * and label in the section is cut out of the grid with a little padding,
 * so the lines stop short of the words. Those boxes are measured relative
 * to the section and re-measured every half second while it is on screen,
 * which keeps up with images loading and reveal animations settling.
 * Reduced motion and touch-only screens get one still frame.
 */
(function () {
  var GRID = 60, RADIUS = 350, REPULSION = -0.65 * 25, CLICK = 0.5 * 100;
  var DOT = 1.5, LINE = 0.5, FAR = 0.09;
  // how strong the glow under the cursor gets (Framer goes to 1; toned down so it stays behind the reading)
  var PEAK = 0.4;
  // the clear space kept around text, in px
  var TEXT_PAD = 14;
  var TEXT = "h1,h2,h3,h4,h5,h6,p,li,dt,dd,figcaption,blockquote,label,td,th,.label,.chip,.btn,button,a";
  var STIFF = 0.02 + 0.5 * 0.06, DAMP = 0.7 + 0.5 * 0.05;
  // on paper it is drawn in ink; on a dark section, in Framer's own colours
  var INK = { line: [16, 17, 20], dot: [16, 17, 20], hover: [16, 17, 20] };
  var NIGHT = { line: [120, 120, 120], dot: [255, 255, 255], hover: [250, 250, 250] };

  // every section gets one; an existing hand-placed canvas is reused
  Array.prototype.forEach.call(document.querySelectorAll("section"), function (sec) {
    if (sec.closest(".dm-frame, .emr, [hidden]")) return;
    var canvas = sec.querySelector(":scope > canvas.kgrid, :scope > .kgrid-wrap > canvas.kgrid");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "kgrid";
      canvas.setAttribute("aria-hidden", "true");
    }
    if (!canvas.parentElement || !canvas.parentElement.classList.contains("kgrid-wrap")) {
      var wrap = document.createElement("div");
      wrap.className = "kgrid-wrap";
      wrap.setAttribute("aria-hidden", "true");
      wrap.appendChild(canvas);
      sec.insertBefore(wrap, sec.firstChild);
    }
    sec.classList.add("has-kgrid");
  });

  var canvases = document.querySelectorAll("canvas.kgrid");
  if (!canvases.length) return;
  var still =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    !window.matchMedia("(hover: hover)").matches;

  var cursor = null, down = false;
  if (!still) {
    window.addEventListener("mousemove", function (e) { cursor = { x: e.clientX, y: e.clientY }; }, { passive: true });
    document.addEventListener("mouseleave", function () { cursor = null; });
    window.addEventListener("mousedown", function () { down = true; });
    window.addEventListener("mouseup", function () { down = false; });
  }

  function mix(a, b, t) {
    return Math.round(a[0] + (b[0] - a[0]) * t) + "," + Math.round(a[1] + (b[1] - a[1]) * t) + "," + Math.round(a[2] + (b[2] - a[2]) * t);
  }

  Array.prototype.forEach.call(canvases, function (canvas) {
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    var tone = canvas.closest(".dark") ? NIGHT : INK;
    var w = 0, h = 0, cols = 0, rows = 0, pts = [], mouse = null, raf = 0, onScreen = false, live = false, oy = 0;
    var sec = canvas.closest("section"), holes = [], measured = 0;

    // where the text sits, relative to the section's top left corner
    function measure() {
      measured = performance.now();
      holes = [];
      if (!sec) return;
      var s = sec.getBoundingClientRect();
      Array.prototype.forEach.call(sec.querySelectorAll(TEXT), function (el) {
        var b = el.getBoundingClientRect();
        if (!b.width || !b.height || !el.textContent.trim()) return;
        holes.push({ x: b.left - s.left, y: b.top - s.top, w: b.width, h: b.height });
      });
    }

    // cut the text boxes out of what has been drawn
    function clearText(r) {
      if (!sec || !holes.length) return;
      var s = sec.getBoundingClientRect();
      var dx = s.left - r.left, dy = s.top - r.top;
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "#000";
      ctx.beginPath();
      for (var i = 0; i < holes.length; i++) {
        var o = holes[i];
        var x = o.x + dx - TEXT_PAD, y = o.y + dy - TEXT_PAD, bw = o.w + TEXT_PAD * 2, bh = o.h + TEXT_PAD * 2;
        if (y > h || y + bh < 0 || x > w || x + bw < 0) continue;
        if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, 10); else ctx.rect(x, y, bw, bh);
      }
      ctx.fill();
      ctx.restore();
    }

    // pixels are allocated only while the section is on screen
    function build() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth || 1;
      h = canvas.clientHeight || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pts = []; cols = 0;
      for (var x = -GRID; x < w + GRID * 2; x += GRID) {
        rows = 0;
        for (var y = -GRID; y < h + GRID * 2; y += GRID) {
          pts.push({ hx: x, hy: y, x: x, y: y, vx: 0, vy: 0, size: DOT });
          rows++;
        }
        cols++;
      }
      live = true;
    }
    function release() {
      canvas.width = 0;
      canvas.height = 0;
      pts = [];
      live = false;
    }

    // the lattice belongs to the page, not the screen: shift it by where the
    // sticky canvas currently sits, so it scrolls with the content
    function anchor(r) {
      var top = r.top + window.scrollY;
      oy = -(((top % GRID) + GRID) % GRID);
    }

    // 1 under the cursor, falling off steeply to 0 at the radius
    function glow(x, y) {
      if (!mouse) return 0;
      var d = Math.hypot(x - mouse.x, y - mouse.y);
      return d > RADIUS ? 0 : Math.pow(1 - d / RADIUS, 3.5);
    }

    function push(x, y) {
      if (!mouse) return [0, 0];
      var dx = x - mouse.x, dy = y - mouse.y, d = Math.hypot(dx, dy);
      if (d === 0) return [0, 0];
      var fall = Math.pow(1 - Math.min(d / 400, 1), 2);
      var f = fall * REPULSION + (down ? fall * CLICK : 0);
      return [(dx / d) * f, (dy / d) * f];
    }

    function draw(r) {
      if (!live) return;
      r = r || canvas.getBoundingClientRect();
      if (performance.now() - measured > 500) measure();
      ctx.save();
      ctx.clearRect(0, 0, w, h);
      ctx.translate(0, oy);
      var lit = pts.map(function (p) { return glow(p.x, p.y); });
      function line(a, b) {
        var t = (lit[a] + lit[b]) / 2;
        ctx.beginPath();
        ctx.moveTo(pts[a].x, pts[a].y);
        ctx.lineTo(pts[b].x, pts[b].y);
        ctx.lineWidth = LINE + t * 1.2;
        ctx.strokeStyle = "rgba(" + mix(tone.line, tone.hover, t) + "," + (FAR + (PEAK - FAR) * t) + ")";
        ctx.stroke();
      }
      for (var c = 0; c < cols; c++)
        for (var r = 0; r < rows; r++) {
          var i = c * rows + r;
          if (c + 1 < cols) line(i, i + rows);
          if (r + 1 < rows) line(i, i + 1);
        }
      pts.forEach(function (p, i) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(DOT * 0.5, p.size), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(" + mix(tone.dot, tone.hover, lit[i]) + "," + (FAR + (PEAK - FAR) * lit[i]) + ")";
        ctx.fill();
      });
      ctx.restore();
      clearText(r);
    }

    function tick() {
      var r = canvas.getBoundingClientRect();
      anchor(r);
      mouse = cursor && cursor.x >= r.left && cursor.x <= r.right && cursor.y >= r.top && cursor.y <= r.bottom
        ? { x: cursor.x - r.left, y: cursor.y - r.top - oy } : null;
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i], f = push(p.hx, p.hy);
        p.vx = (p.vx + (p.hx + f[0] - p.x) * STIFF) * DAMP;
        p.vy = (p.vy + (p.hy + f[1] - p.y) * STIFF) * DAMP;
        p.x += p.vx;
        p.y += p.vy;
        p.size += (DOT + glow(p.x, p.y) * DOT - p.size) * 0.15;
      }
      draw(r);
      raf = requestAnimationFrame(tick);
    }

    function run() {
      cancelAnimationFrame(raf);
      if (!still && onScreen && !document.hidden) raf = requestAnimationFrame(tick);
    }

    function still1() { var r = canvas.getBoundingClientRect(); anchor(r); measure(); draw(r); }

    new ResizeObserver(function () {
      if (onScreen) { build(); still1(); }
    }).observe(canvas);
    new IntersectionObserver(function (entries) {
      onScreen = entries[entries.length - 1].isIntersecting;  // the newest entry, not a stale one
      if (onScreen) { if (!live) build(); still1(); }
      else release();
      run();
    }, { rootMargin: "200px 0px" }).observe(canvas);
    if (still) {
      // a still frame drawn once would stay pinned to the screen; keep it on the page
      var queued = false;
      window.addEventListener("scroll", function () {
        if (!onScreen || queued) return;
        queued = true;
        requestAnimationFrame(function () { queued = false; still1(); });
      }, { passive: true });
      return;
    }
    document.addEventListener("visibilitychange", run);
  });
})();
