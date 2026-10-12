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
     in turn, looping, and only while it is on screen. Reduced motion gets the
     last step (the fix, the full answer), still. Given an element, a
     Pause / Play button follows it. */
  function autoplay(el, count, show, ms, after) {
    if (reduced) { show(count - 1); return; }
    var i = -1, t = null, seen = false, stopped = false;
    var gap = function () { return typeof ms === 'function' ? ms(i) : ms; };
    var tick = function () { i = (i + 1) % count; show(i); t = setTimeout(tick, gap()); };
    var halt = function () { clearTimeout(t); t = null; };
    var run = function () { if (seen && !stopped && !t) { if (i < 0) tick(); else t = setTimeout(tick, gap()); } };
    new IntersectionObserver(function (es) {
      seen = es[0].isIntersecting;
      if (seen) run(); else halt();
    }, { threshold: 0.25 }).observe(el);
    if (!after) return;
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'ap-toggle'; btn.textContent = 'Pause demo';
    btn.addEventListener('click', function () {
      stopped = !stopped;
      btn.textContent = stopped ? 'Play demo' : 'Pause demo';
      if (stopped) halt(); else run();
    });
    after.insertAdjacentElement('afterend', btn);
  }


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
        /* only the phone the visitor types into announces its replies */
        '<div class="ph-thread"' + (root.hasAttribute('data-interactive') ? ' role="log" aria-live="polite"' : '') + ' aria-label="Conversation with the assistant"></div>' +
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
    }, 6500, p.root);
  })();

  /* ================================================== the pinned sequences
     Each [data-pin] section is tall, with a sticky stage inside. Scrolling
     through it sets --p from 0 to 1 (over the first `data-span` of the
     scroll, then it holds). Narrow screens and reduced motion get the end
     state as a static layout instead (.no-pin). */
  var root = document.documentElement;
  var narrow = window.matchMedia('(max-width: 900px)');
  var clamp = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var actC = $('.act-c'), actE = $('.act-e');
  var sysLis = $$('#sys li');
  var noPin = false;
  function setMode() {
    noPin = narrow.matches || reduced;
    root.classList.toggle('no-pin', noPin);
    if (actC) actC.classList.toggle('is-after', noPin);
    sysLis.forEach(function (li) { li.classList.toggle('is-on', noPin); li.style.setProperty('--f', noPin ? 1 : 0); });
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

  var bar = $('.bar-progress i');

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
  /* wide screens with motion: ScrollTrigger plays each step (see the end).
     Everything else shows the first step and plays another on request, so
     nothing changes while it is being read. */
  if (cdP && stepEls.length && (narrow.matches || reduced || !window.ScrollTrigger)) {
    stepEls.forEach(function (li, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ap-toggle st-play'; b.textContent = 'Play in the phone';
      b.addEventListener('click', function () {
        stCur = -1; runStep(i);
        stick.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
      });
      li.appendChild(b);
    });
    runStep(0);
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
    autoplay(cv, SAYS.length, cvPick, 2400, $('.phr-l > :last-child'));
    window.addEventListener('resize', cvLines);
  }

  /* before and after: each version in turn, the fix held longer */
  var ba = $('#ba');
  if (ba) {
    var baSet = function (v) {
      ba.classList.toggle('is-after', v === 'after');
      $$('[data-ba]').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-ba') === v); });
    };
    autoplay(ba, 2, function (i) { baSet(i ? 'after' : 'before'); }, function (i) { return i ? 5500 : 3500; }, $('.ba-switch'));
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


  /* ================================================== scroll animation, with GSAP
     ScrollTrigger drives every scroll-linked moment: the reading bar, the
     statement reveals, cards settling into their tilt, the hero's restrained
     parallax, the count-ups, the two pinned sequences and the story steps.
     Reduced motion gets none of it. Narrow screens keep the reveals and the
     settling, and the pinned sequences sit in their end state (.no-pin). */
  var stTimer = null;
  function initScroll() {
    if (!window.gsap || !window.ScrollTrigger) return;
    var gsap = window.gsap, ST = window.ScrollTrigger;
    gsap.registerPlugin(ST);
    var mm = gsap.matchMedia();
    mm.add({ motion: '(prefers-reduced-motion: no-preference)', wide: '(min-width: 901px)' }, function (ctx) {
      var c = ctx.conditions;
      if (bar) gsap.fromTo(bar, { scaleX: 0 }, { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } });
      if (!c.motion) { $$('#loop li').forEach(function (li) { li.classList.add('is-lit'); }); return; }

      /* a statement rises out of a mask, once */
      $$('.rv').forEach(function (el) {
        gsap.fromTo(el, { clipPath: 'inset(0% 0% 100% 0%)', y: '0.35em' },
          { clipPath: 'inset(-20% 0% -30% 0%)', y: 0, duration: 1.1, ease: 'expo.out',
            scrollTrigger: { trigger: el.parentElement, start: 'top 85%', once: true } });
      });

      /* rows and columns rise into place, a beat apart */
      [['.figs', 'div'], ['.facts', 'div'], ['.metrics', '.m-row'], ['.disc', 'li'], ['.cv-rec', 'li'],
        ['.scope', 'div'], ['.who', 'div'], ['.screens', '.scr']].forEach(function (g) {
        $$(g[0]).forEach(function (box) {
          gsap.from($$(g[1], box), { y: 40, opacity: 0, duration: 1, ease: 'expo.out', stagger: 0.08,
            scrollTrigger: { trigger: box, start: 'top 85%', once: true } });
        });
      });

      /* the build loop lights one step at a time */
      var loopLis = $$('#loop li');
      if (loopLis.length) ST.create({ trigger: '#loop', start: 'top 80%', once: true, onEnter: function () {
        loopLis.forEach(function (li, i) { setTimeout(function () { li.classList.add('is-lit'); }, i * 180); });
      } });

      /* the real screens open out of a crop and drift at slightly different speeds */
      $$('.scr img').forEach(function (img, i) {
        gsap.fromTo(img, { clipPath: 'inset(16% 10% 16% 10% round 34px)' }, { clipPath: 'inset(0% 0% 0% 0% round 34px)', ease: 'none',
          scrollTrigger: { trigger: '.screens', start: 'top 90%', end: 'top 35%', scrub: 0.5 } });
        gsap.to(img.closest('.scr'), { y: [-10, -28, -16][i] || -14, ease: 'none', scrollTrigger: { trigger: '.screens', start: 'top bottom', end: 'bottom top', scrub: true } });
      });

      /* count-ups, once each */
      $$('[data-count]').forEach(function (n) {
        var to = Number(n.getAttribute('data-count')), o = { v: 0 };
        n.textContent = '0';
        gsap.to(o, { v: to, duration: 1.4, ease: 'power3.out', onUpdate: function () { n.textContent = Math.round(o.v); },
          scrollTrigger: { trigger: n, start: 'top 88%', once: true } });
      });


      if (!c.wide) return;

      /* product -> problem: as the opening stage leaves, the phone recedes */
      gsap.to('.act-a .a-phone .phone', { scale: 0.88, opacity: 0.3, y: -50, ease: 'none',
        scrollTrigger: { trigger: '.act-a', start: 'bottom bottom', end: 'bottom 20%', scrub: true } });

      /* the pinned sequences: --p scrubbed from 0 to 1 over the first `data-span` of the scroll */
      [[$('.act-a'), function () {}], [actC, drawC], [actE, drawE]].forEach(function (pair) {
        var el = pair[0], draw = pair[1];
        if (!el) return;
        var span = Number(el.getAttribute('data-span')) || 1, state = { p: 0 };
        gsap.to(state, { p: 1, ease: 'none',
          onUpdate: function () { el.style.setProperty('--p', state.p.toFixed(4)); draw(state.p); },
          scrollTrigger: { trigger: el, start: 'top top', scrub: 0.6, invalidateOnRefresh: true,
            end: function () { return '+=' + Math.max(1, (el.offsetHeight - window.innerHeight) * span); } } });
      });

      /* the story: a step plays once it has held the middle of the screen briefly */
      if (cdP) stepEls.forEach(function (li, i) {
        ST.create({ trigger: li, start: 'top 58%', end: 'bottom 42%',
          onToggle: function (self) {
            if (!self.isActive) return;
            clearTimeout(stTimer);
            stTimer = setTimeout(function () { runStep(i); }, 150);
          } });
      });
    });
    /* fonts and images change heights after load */
    window.addEventListener('load', function () { ST.refresh(); });
  }

  /* below 1080px the chapter links fold into a Chapters menu under the bar:
     Escape or a chosen chapter closes it, and focus goes back to the button */
  function chapterMenu() {
    var bar = $('.bar'), nav = $('.bar-nav'), cta = $('.bar .btn');
    if (!bar || !nav) return;
    nav.id = nav.id || 'chapters';
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'bar-menu'; btn.textContent = 'Chapters';
    btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', nav.id);
    bar.insertBefore(btn, cta || null);
    var set = function (open, refocus) {
      nav.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
      if (!open && refocus) btn.focus();
    };
    btn.addEventListener('click', function () { set(!nav.classList.contains('is-open')); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) set(false, true);
    });
    document.addEventListener('click', function (e) {
      if (nav.classList.contains('is-open') && !bar.contains(e.target)) set(false);
    });
  }

  chapterMenu();
  setMode();
  if (narrow.addEventListener) narrow.addEventListener('change', setMode);
  initScroll();
})();
