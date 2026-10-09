/* =========================================================================
   story.js: the case study's interactions. Every chat answer on the page
   comes from engine.js (the prototype's real routing, tools and renderer);
   nothing here writes an assistant reply by hand. The two exceptions are
   labelled where they appear: gift vouchers need the supplier proxy, so
   they show a screenshot recorded in the app, and the AI-down ladder,
   which a static page cannot reproduce.
   ========================================================================= */
(function () {
  'use strict';
  var WP = window.WP;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var wait = function (ms) { return new Promise(function (ok) { setTimeout(ok, reduced ? 0 : ms); }); };

  /* Every demo outside "Try it yourself" plays itself: show(i) for each step
     in turn, looping, and only while it is on screen. */
  function autoplay(el, count, show, ms) {
    var i = -1, t = null;
    var tick = function () { i = (i + 1) % count; show(i); t = setTimeout(tick, typeof ms === 'function' ? ms(i) : ms); };
    new IntersectionObserver(function (es) {
      if (es[0].isIntersecting) { if (!t) tick(); }
      else { clearTimeout(t); t = null; }
    }, { threshold: 0.25 }).observe(el);
  }


  /* --------------------------------------------------------- reveals
     Only the statements marked .rv move; everything else is simply there. */
  /* A statement starts fully clipped, which an observer reads as having no
     area, so its parent is watched instead. */
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      (e.target.rvChild || e.target).classList.add('in'); io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0 });
  $$('.rv').forEach(function (n) { var w = n.parentElement; w.rvChild = n; io.observe(w); });
  $$('.settle').forEach(function (n) { io.observe(n); });

  /* --------------------------------------------------------- counters */
  var cio = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      cio.unobserve(e.target);
      var n = e.target, to = Number(n.getAttribute('data-count'));
      if (reduced) { n.textContent = to; return; }
      var t0 = performance.now(), dur = 1300;
      (function tick(t) {
        var k = Math.min(1, (t - t0) / dur), ease = 1 - Math.pow(1 - k, 3);
        n.textContent = Math.round(to * ease);
        if (k < 1) requestAnimationFrame(tick);
      })(t0);
    });
  }, { threshold: 0.6 });
  $$('[data-count]').forEach(function (n) { n.textContent = '0'; cio.observe(n); });


  /* ================================================================ phones */
  /* One phone, the way the app's chat screen shapes it: status bar, title,
     the thread, and (when interactive) the input. */
  var phones = {};
  var VOUCHER_SHOT = { src: 'public/screens/06-voucher-catalogue.webp',
    note: 'Recorded in the app. Vouchers come from the supplier through a server-side proxy, which this page doesn’t have: brands, values and stock, read at the moment of asking. Buying is a step on the voucher screen.' };

  function Phone(root) {
    var self = this;
    this.root = root;
    root.innerHTML =
      '<div class="ph-screen">' +
        '<div class="ph-status" aria-hidden="true"><span>9:41</span><i></i></div>' +
        '<div class="ph-bar"><span class="ph-back" aria-hidden="true">&lsaquo;</span><span><b>WorkPerks AI</b><em>Live from your benefits catalogue</em></span></div>' +
        '<div class="ph-thread" role="log" aria-live="polite" aria-label="Conversation with the assistant"></div>' +
        '<form class="ph-form" autocomplete="off"><input class="ph-input" type="text" placeholder="Ask anything" aria-label="Ask the assistant a question"><button type="submit" class="ph-send"><span aria-hidden="true">&rarr;</span><span class="vh">Send</span></button></form>' +
      '</div>';
    this.thread = $('.ph-thread', root);
    this.input = $('.ph-input', root);
    this.busy = false;
    var interactive = root.hasAttribute('data-interactive');
    if (!interactive) {
      this.input.setAttribute('tabindex', '-1'); this.input.readOnly = true; root.classList.add('is-show');
      $('.ph-send', root).tabIndex = -1;
      new MutationObserver(function () { $$('button', self.thread).forEach(function (b) { b.tabIndex = -1; }); })
        .observe(this.thread, { childList: true, subtree: true });
    }
    $('.ph-form', root).addEventListener('submit', function (e) {
      e.preventDefault();
      if (!interactive) return;
      var v = self.input.value; self.input.value = '';
      self.ask(v);
    });
    root.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-ask]');
      if (chip && root.contains(chip)) { self.ask(chip.getAttribute('data-ask')); return; }
      var go = e.target.closest('[data-route]');
      if (go && root.contains(go)) self.follow(go.getAttribute('data-route'));
    });
    this.greet();
  }
  Phone.prototype.greet = function () {
    this.gen = (this.gen || 0) + 1; this.busy = false;
    this.thread.textContent = '';
    WP.render(this.thread, WP.blocks('__greeting__', {}));
  };
  Phone.prototype.me = function (text) {
    var t = WP.el('div', 'ph-turn ph-me');
    t.appendChild(WP.el('span', null, text));
    this.thread.appendChild(t);
    this.scroll();
  };
  Phone.prototype.scroll = function () { this.thread.scrollTop = this.thread.scrollHeight; };
  Phone.prototype.anchor = function (turn) {
    this.thread.scrollTop += turn.getBoundingClientRect().top - this.thread.getBoundingClientRect().top - 8;
  };
  Phone.prototype.thinking = function () {
    var t = WP.el('div', 'dm-turn dm-ai ph-typing');
    t.setAttribute('aria-hidden', 'true');
    t.innerHTML = '<span class="dm-av"></span><div class="dm-bub"><i></i><i></i><i></i></div>';
    this.thread.appendChild(t);
    this.scroll();
    return t;
  };
  /* answer `q` through the engine, or show the given blocks for a direct tool run */
  Phone.prototype.ask = function (q, direct) {
    var self = this;
    q = String(q || '').trim();
    if (!q || this.busy) return Promise.resolve();
    this.busy = true;
    this.me(q);
    var a = direct ? { route: direct, blocks: WP.blocks(direct.tool, WP.runTool(direct)) } : WP.answer(q);
    var dots = this.thinking(), gen = this.gen;
    return wait(650).then(function () {
      dots.remove();
      if (gen !== self.gen) return a;
      var turn;
      if (a.route.tool === '__vouchers__' || a.route.tool === 'search_vouchers') turn = self.shot(VOUCHER_SHOT);
      else turn = WP.render(self.thread, a.blocks);
      turn.classList.add('ph-new');
      self.anchor(turn);
      self.busy = false;
      return a;
    });
  };
  /* a recorded screen from the app, labelled as such, in place of an answer */
  Phone.prototype.shot = function (s) {
    var t = WP.el('div', 'dm-turn dm-ai');
    var av = WP.el('span', 'dm-av'); t.appendChild(av);
    var bub = WP.el('div', 'dm-bub ph-shot');
    var img = document.createElement('img');
    img.src = s.src; img.alt = 'The voucher answer in the app: brands with their values and stock, read live from the supplier.';
    img.loading = 'lazy'; img.decoding = 'async';
    bub.appendChild(img);
    bub.appendChild(WP.el('p', 'ph-shot-note', s.note));
    t.appendChild(bub);
    this.thread.appendChild(t);
    return t;
  };
  Phone.prototype.follow = function (route) {
    var m = /^detail:(.+)$/.exec(route);
    if (m) {
      var b = WP.CTX.benefits.filter(function (x) { return x.id === m[1]; })[0];
      if (b) { this.ask('Tell me about ' + b.title, { tool: 'benefit_detail', args: { id: b.id } }); return; }
    }
    var label = WP.SCREEN_LABEL[route] || route;
    var turn = WP.render(this.thread, [{ kind: 'note', variant: 'info', title: 'This is where the app takes over',
      body: 'In the employee app this opens ' + label + '. The assistant never books, buys or cancels anything, so the last step is always a screen.' }]);
    this.anchor(turn);
  };
  /* type a question into the bar, then send it: the hero's "alive" loop */
  Phone.prototype.typeAndAsk = function (q, alive) {
    var self = this;
    alive = alive || function () { return true; };
    if (reduced) return alive() ? self.ask(q) : Promise.resolve();
    var i = 0;
    self.input.value = '';
    return new Promise(function (ok) {
      (function step() {
        if (!alive()) { self.input.value = ''; ok(); return; }
        self.input.value = q.slice(0, ++i);
        if (i < q.length) setTimeout(step, 38 + Math.random() * 40);
        else setTimeout(function () { self.input.value = ''; if (alive()) self.ask(q).then(ok); else ok(); }, 260);
      })();
    });
  };

  $$('.phone').forEach(function (n) { phones[n.id] = new Phone(n); });
  /* on a narrow screen the phone sits below the controls, so bring the answer up */
  function bringIntoView(n) {
    if (window.innerWidth < 900 && n) n.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }
  /* only the "Try it yourself" phone takes questions from the visitor */
  $$('[data-for]').forEach(function (b) {
    b.addEventListener('click', function () {
      var p = phones[b.getAttribute('data-for')];
      if (p) { p.ask(b.getAttribute('data-ask')); bringIntoView(p.root); }
    });
  });

  /* the opening phone works through the five questions beside it, in turn */
  (function () {
    var p = phones['phone-hero'], rows = $$('#built-asks li'), gen = 0;
    if (!p || !rows.length) return;
    autoplay(p.root, rows.length, function (i) {
      var g = ++gen;
      rows.forEach(function (li, k) { li.classList.toggle('is-now', k === i); });
      p.greet();
      p.typeAndAsk(rows[i].getAttribute('data-q'), function () { return g === gen; });
    }, 6500);
  })();

  /* ================================================== the pinned sequences
     Each [data-pin] section is tall, with a sticky stage inside. Scrolling
     through it sets --p from 0 to 1 (over the first `data-span` of the
     scroll, then it holds). Narrow screens and reduced motion get the end
     state as a static layout instead (.no-pin). */
  var root = document.documentElement;
  var narrow = window.matchMedia('(max-width: 900px)');
  var clamp = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var pins = $$('[data-pin]');
  var actA = $('.act-a'), actC = $('.act-c'), actE = $('.act-e');
  var sysLis = $$('#sys li');
  var noPin = false;
  function setMode() {
    noPin = narrow.matches || reduced;
    root.classList.toggle('no-pin', noPin);
    if (actA) {
      actA.classList.toggle('is-settled', noPin);
      $('.a-built', actA).inert = !noPin;
      measureA();
    }
    if (actC) actC.classList.toggle('is-after', noPin);
    sysLis.forEach(function (li) { li.classList.toggle('is-on', noPin); li.style.setProperty('--f', noPin ? 1 : 0); });
  }

  /* A: the dark stage starts as a panel around the phone, then grows */
  function measureA() {
    if (!actA || noPin) return;
    var st = $('.a-stage', actA).getBoundingClientRect(), ph = $('#phone-hero').getBoundingClientRect();
    var cap = $('.a-phone', actA).getBoundingClientRect(), copy = $('.a-hero', actA).getBoundingClientRect();
    var pad = Math.min(90, Math.max(32, (ph.left - copy.right) / 2));
    actA.style.setProperty('--l0', Math.max(12, ph.left - st.left - pad) + 'px');
    actA.style.setProperty('--r0', Math.max(12, st.right - ph.right - pad) + 'px');
    actA.style.setProperty('--t0', Math.max(12, ph.top - st.top - 36) + 'px');
    actA.style.setProperty('--b0', Math.max(12, st.bottom - cap.bottom - 28) + 'px');
  }
  function drawA(p, q) {
    actA.style.setProperty('--q', q.toFixed(4));
    var settled = p > 0.97;
    if (settled !== actA.classList.contains('is-settled')) {
      actA.classList.toggle('is-settled', settled);
      $('.a-built', actA).inert = !settled;
    }
  }

  /* C: the line runs between the first and last remaining dots */
  function drawC(p) {
    var ol = $('.c-steps', actC), dots = $$('.c-steps li i', actC);
    var r = ol.getBoundingClientRect(), a = dots[0].getBoundingClientRect(), b = dots[dots.length - 1].getBoundingClientRect();
    ol.style.setProperty('--ll', (a.left + a.width / 2 - r.left) + 'px');
    ol.style.setProperty('--lr', (r.right - b.left - b.width / 2) + 'px');
    actC.classList.toggle('is-after', p > 0.6);
  }

  /* E: each layer lights, then the line to the next one fills */
  function drawE(p) {
    var k = p * (sysLis.length + 0.4);
    sysLis.forEach(function (li, i) {
      li.classList.toggle('is-on', k >= i + 0.25);
      li.style.setProperty('--f', clamp(k - i - 0.45).toFixed(3));
    });
  }

  var bar = $('.bar-progress i'), ticking = false;
  function frame() {
    ticking = false;
    var vh = window.innerHeight;
    if (bar) bar.style.transform = 'scaleX(' + (root.scrollTop / Math.max(1, root.scrollHeight - root.clientHeight)).toFixed(4) + ')';
    if (noPin) return;
    pins.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 1.5) return;
      var span = Number(el.getAttribute('data-span')) || 1;
      var p = clamp((-r.top) / Math.max(1, r.height - vh) / span);
      el.style.setProperty('--p', p.toFixed(4));
      if (el === actA) drawA(p, clamp((vh - r.bottom) / vh));
      else if (el === actC) drawC(p);
      else if (el === actE) drawE(p);
    });
  }
  var onScroll = function () { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };

  /* "What I built" lives inside the pinned opening, so a link to it scrolls
     to the point where that chapter has settled, then moves focus there. */
  $$('a[href="#built"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      if (noPin || !actA) return;
      e.preventDefault();
      var span = Number(actA.getAttribute('data-span')) || 1;
      var y = actA.offsetTop + (actA.offsetHeight - window.innerHeight) * Math.min(1, span + 0.04);
      window.scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
      setTimeout(function () { $('#built-h').focus({ preventScroll: true }); }, reduced ? 0 : 700);
    });
  });

  /* C: once the steps have become one place to ask, real questions are typed into it */
  var typed = $('#c-typed');
  if (typed && actC && !reduced) {
    var QS = ['Can I use this for Cult?', 'Do I have a wellness benefit?', 'Where do I update my dependents?', 'Get me a voucher.'];
    var started = false;
    var cycle = function (n) {
      var q = QS[n % QS.length], i = 0;
      typed.textContent = '';
      (function type() {
        typed.textContent = q.slice(0, ++i);
        if (i < q.length) { setTimeout(type, 45 + Math.random() * 35); return; }
        setTimeout(function erase() {
          typed.textContent = typed.textContent.slice(0, -1);
          if (typed.textContent) setTimeout(erase, 18); else setTimeout(function () { cycle(n + 1); }, 300);
        }, 1800);
      })();
    };
    var kick = function () {
      if (started || !actC.classList.contains('is-after')) return;
      started = true; window.removeEventListener('scroll', kick); cycle(0);
    };
    window.addEventListener('scroll', kick, { passive: true });
    new IntersectionObserver(function (es) { if (es[0].isIntersecting) kick(); }, { threshold: 0.6 }).observe($('.c-ask'));
  }

  /* G: one learning at a time */
  var learnIO = new IntersectionObserver(function (es) {
    es.forEach(function (e) { e.target.classList.toggle('is-on', e.isIntersecting); });
  }, { rootMargin: '-38% 0px -38% 0px' });
  $$('#learn li').forEach(function (li) { if (reduced) li.classList.add('is-on'); else learnIO.observe(li); });

  /* ================================================== the 268, by kind, in turn */
  var FAM = [['variant', 104, 'What is Yoga?'], ['benefit', 70, 'Tell me about gym memberships'], ['edge case', 25, 'asdfgh · an emoji · book me a gym'],
    ['category', 20, 'What is in Health & Clinical Care?'], ['voucher', 19, 'Anything near Agra?'], ['about the app', 10, 'Who can see my questions?'],
    ['funding', 10, 'What is flexi?'], ['money', 7, 'How much do I have?'], ['orders', 3, 'What have I booked?']];
  var fam = $('#families'), famQ = $('#family-q');
  if (fam) {
    var famRows = FAM.map(function (f) {
      var b = WP.el('div', 'fam');
      b.style.setProperty('--w', (f[1] / 104 * 100).toFixed(1) + '%');
      b.appendChild(WP.el('span', 'fam-n', f[0])); b.appendChild(WP.el('i')); b.appendChild(WP.el('b', null, String(f[1])));
      fam.appendChild(b);
      return b;
    });
    autoplay(fam, FAM.length, function (i) {
      famRows.forEach(function (x, k) { x.classList.toggle('is-on', k === i); });
      famQ.textContent = FAM[i][1] + ' ' + FAM[i][0] + ' scenarios, like “' + FAM[i][2] + '”';
    }, 2600);
  }


  /* ================================================== the hero's cards
     Dealt from the engine: the question, its answer, the first benefit it
     found, and the button that benefit's answer ends on. */
  (function () {
    var fan = $('#fan');
    if (!fan) return;
    var q = 'What can I get?', a = WP.answer(q);
    var head = a.blocks.filter(function (b) { return b.kind === 'header'; })[0];
    var rows = a.blocks.filter(function (b) { return b.kind === 'rows'; })[0];
    var row = rows && rows.rows[0];
    var id = row && /^detail:(.+)$/.exec(row.route)[1];
    var detail = id ? WP.blocks('benefit_detail', WP.runTool({ tool: 'benefit_detail', args: { id: id } })) : [];
    var act = detail.filter(function (b) { return b.kind === 'actions'; })[0];
    var put = function (key, nodes) { var box = $('[data-fan="' + key + '"]', fan); nodes.forEach(function (n) { box.appendChild(n); }); };
    put('ask', [WP.el('p', 'fc-me', q)]);
    if (head) put('answer', [WP.el('p', 'fc-h', head.title)]);
    if (row) put('row', [WP.el('p', 'fc-label', row.label), WP.el('p', 'fc-value', row.value)]);
    if (act) put('action', [WP.el('span', 'fc-btn', act.actions[0].label), WP.el('p', 'fc-value', 'a screen the app confirmed it has')]);
    setTimeout(function () { fan.classList.add('dealt'); }, reduced ? 0 : 250);
  })();

  /* ================================================== conversational design
     The phone stays in place. As each decision comes into view, its
     conversation replays through engine.js from a clean thread. */
  var fmtRoute = function (r) {
    var ks = Object.keys(r.args || {});
    return r.tool + (ks.length ? ' { ' + ks.map(function (k) { return k + ': ' + JSON.stringify(r.args[k]); }).join(', ') + ' }' : '');
  };
  var STEPS = [
    { asks: ['How much do I have left?'], hl: '.dm-chips' },
    { asks: ['How much do I have left?', 'How many coins do I have?'], hl: '.dm-head' },
    { asks: ['Can you cancel my gym booking?'], hl: '.dm-actions', app: 'public/screens/07-orders-screen.webp' },
    { asks: ['Tell me about Gym & fitness memberships'], direct: { tool: 'benefit_detail', args: { id: 'b00' } }, hl: ['.dm-p', '.dm-rows'], app: 'public/screens/08-gym-detail.webp' }
  ];
  var cdP = phones['phone-cd'], stepEls = $$('#story-steps li'), stick = $('.story-stick'), cdApp = $('#cd-app');
  var stGen = 0, stCur = -1;
  function hlLast(sel) {
    $$('.dm-hl', cdP.thread).forEach(function (n) { n.classList.remove('dm-hl'); });
    var turns = $$('.dm-ai', cdP.thread), t = turns[turns.length - 1];
    if (sel && t) [].concat(sel).forEach(function (s) { var n = $(s, t); if (n) n.classList.add('dm-hl'); });
  }
  function runStep(i) {
    if (!cdP || i === stCur) return;
    stCur = i;
    var s = STEPS[i], g = ++stGen, alive = function () { return g === stGen; };
    stepEls.forEach(function (li, k) { li.classList.toggle('is-on', k === i); });
    stick.classList.remove('is-app');
    if (s.app) $('img', cdApp).src = s.app;
    cdP.greet();
    var chain = Promise.resolve();
    s.asks.forEach(function (q, k) {
      var last = k === s.asks.length - 1;
      chain = chain.then(function () { return alive() ? wait(k ? 500 : 250) : null; })
        .then(function () { return alive() ? cdP.ask(q, last ? s.direct : null) : null; });
    });
    chain.then(function () {
      if (!alive()) return;
      hlLast(s.hl);
      if (s.app) return wait(1600).then(function () { if (alive()) stick.classList.add('is-app'); });
    });
  }
  stepEls.forEach(function (li, i) {
    var s = STEPS[i], q = s.asks[s.asks.length - 1], code = $('.st-route', li);
    if (code) code.textContent = fmtRoute(s.direct || WP.route(q));
  });
  if (cdP && stepEls.length) {
    if (narrow.matches || reduced) {
      autoplay(stick, STEPS.length, function (i) { stCur = -1; runStep(i); }, 9000);
    } else {
      var stTimer = null;
      var stIO = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return;
          var i = stepEls.indexOf(e.target);
          clearTimeout(stTimer);
          stTimer = setTimeout(function () { runStep(i); }, 150);
        });
      }, { rootMargin: '-42% 0px -42% 0px' });
      stepEls.forEach(function (li) { stIO.observe(li); });
    }
  }

  /* phrasings converge on one tool. The route is worked out here, for each one. */
  var cv = $('#cv');
  if (cv) {
    var SAYS = ['How many coins do I have?', 'What’s my Health Coins balance?', 'Coins left?', 'Show my coin balance', 'What’s my balance?'];
    var says = $('.cv-says', cv), svg = $('.cv-lines', cv), outs = $$('.cv-out', cv), cvBtns = [];
    var outFor = function (q) { return WP.route(q).args.currency === 'coins' ? 'coins' : 'ask'; };
    SAYS.forEach(function (q, i) {
      var li = WP.el('li'), b = WP.el('span', null, q);
      li.appendChild(b); says.appendChild(li); cvBtns.push(b);
    });
    var cvLines = function () {
      if (getComputedStyle(svg).display === 'none') return;
      var box = cv.getBoundingClientRect();
      svg.setAttribute('viewBox', '0 0 ' + box.width + ' ' + box.height);
      svg.innerHTML = '';
      cvBtns.forEach(function (b, i) {
        var a = b.getBoundingClientRect(), o = $('[data-out="' + outFor(SAYS[i]) + '"]', cv).getBoundingClientRect();
        var x1 = a.right - box.left + 6, y1 = a.top + a.height / 2 - box.top, x2 = o.left - box.left - 6, y2 = o.top + o.height / 2 - box.top, xm = (x1 + x2) / 2;
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M' + x1 + ' ' + y1 + ' C' + xm + ' ' + y1 + ' ' + xm + ' ' + y2 + ' ' + x2 + ' ' + y2);
        if (b.classList.contains('is-on')) path.setAttribute('class', 'is-on');
        svg.appendChild(path);
      });
    };
    var cvPick = function (i) {
      var r = WP.route(SAYS[i]), key = outFor(SAYS[i]);
      cvBtns.forEach(function (b, k) { b.classList.toggle('is-on', k === i); });
      outs.forEach(function (o) {
        var on = o.getAttribute('data-out') === key;
        o.classList.toggle('is-on', on);
        if (on) $('.cv-tool', o).innerHTML = r.tool + ' <i>' + (r.args.currency ? 'currency: ' + r.args.currency : 'currency: not given') + '</i>';
      });
      cvLines();
    };
    cvPick(0);
    autoplay(cv, SAYS.length, cvPick, 2400);
    window.addEventListener('resize', cvLines);
  }

  /* before and after: each version in turn, the fix held longer */
  var ba = $('#ba');
  if (ba) {
    var baSet = function (v) {
      ba.classList.toggle('is-after', v === 'after');
      $$('[data-ba]').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-ba') === v); });
    };
    autoplay(ba, 2, function (i) { baSet(i ? 'after' : 'before'); }, function (i) { return i ? 5500 : 3500; });
  }

  /* the voice examples are the renderer's own output, first block only */
  $$('[data-voice]').forEach(function (v) {
    var a = WP.answer(v.getAttribute('data-voice'));
    var q = WP.el('p', 'voice-q', v.getAttribute('data-voice'));
    var lab = $('.label', v);
    if (lab) lab.insertAdjacentElement('afterend', q); else v.insertBefore(q, v.firstChild);
    WP.render(v, a.blocks.slice(0, Number(v.getAttribute('data-take')) || 1));
    $$('button', v).forEach(function (b) { b.tabIndex = -1; });
  });


  setMode();
  if (narrow.addEventListener) narrow.addEventListener('change', function () { setMode(); onScroll(); });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () { measureA(); onScroll(); });
  onScroll();
})();
