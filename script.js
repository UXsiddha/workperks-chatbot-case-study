/* ---------------------------------------------------------------------------
   Wellness Store, case study page behaviour. The same script as the
   Generative EMR case study, without its demonstration.

   0. Top bar: current section, reading progress, light/dark tone, index panel,
      and the side rail. Navigation, so it runs for everyone.
   Everything after the reduced-motion gate is ambient:
   1. Hero visual scale on scroll.
   2. Scroll reveals, with count-ups for the figures inside them.
   --------------------------------------------------------------------------- */

(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }


  /* ---- 0. Top bar ------------------------------------------------------ */
  (function () {
    var bar = document.querySelector('.topbar');
    if (!bar) return;

    var num      = bar.querySelector('.tb-num');
    var name     = bar.querySelector('.tb-name');
    var progress = bar.querySelector('.tb-progress span');
    var button   = bar.querySelector('.tb-index');
    var panel    = document.getElementById('index-panel');
    var links    = document.querySelectorAll('#index-panel a, .rail a');
    var rail     = document.querySelector('.rail');
    var hero     = document.querySelector('.hero');

    var sections = Array.prototype.slice.call(document.querySelectorAll('main > section[id]'));
    var tones    = Array.prototype.slice.call(document.querySelectorAll('.hero, main > section, .end'));
    var active   = null;
    var queued   = false;

    function sync() {
      queued = false;
      var vh = window.innerHeight;
      var y = window.scrollY;

      /* tone: whatever sits under the bar */
      var probe = bar.offsetHeight / 2;
      var tone = 'light';
      for (var i = 0; i < tones.length; i++) {
        var r = tones[i].getBoundingClientRect();
        if (r.top <= probe && r.bottom > probe) {
          tone = tones[i].classList.contains('dark') ? 'dark' : 'light';
          break;
        }
      }
      bar.setAttribute('data-tone', tone);
      bar.classList.toggle('at-top', y < 8);

      /* the side rail joins once the hero is mostly gone */
      if (rail && hero) rail.classList.toggle('on', hero.getBoundingClientRect().bottom < vh * 0.5);

      /* progress */
      var max = document.documentElement.scrollHeight - vh;
      if (progress) progress.style.setProperty('--p', max > 0 ? clamp(y / max, 0, 1).toFixed(4) : 0);

      /* current section */
      var line = vh * 0.35;
      var current = null;
      sections.forEach(function (el) {
        if (el.getBoundingClientRect().top <= line) current = el;
      });
      var id = current ? current.id : null;
      if (id === active) return;
      active = id;

      if (current) {
        var k = sections.indexOf(current) + 1;
        num.textContent = (k < 10 ? '0' : '') + k;
        /* the rail's short name fits a phone-width bar; the long title is the fallback */
        var short = rail && rail.querySelector('a[href="#' + id + '"] .r-name');
        name.textContent = short ? short.textContent : (current.getAttribute('data-title') || current.id);
      } else {
        num.textContent = '';
        name.textContent = 'Index';
      }
      Array.prototype.forEach.call(links, function (a) {
        if (a.hash === '#' + id) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    }

    function request() {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(sync);
    }

    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request, { passive: true });
    sync();

    /* the index panel */
    if (!button || !panel) return;

    function open() {
      panel.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      var first = panel.querySelector('a[aria-current="true"]') || panel.querySelector('a');
      if (first) first.focus({ preventScroll: true });
    }
    function close(returnFocus) {
      if (panel.hidden) return;
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (returnFocus) button.focus({ preventScroll: true });
    }

    button.addEventListener('click', function () {
      if (panel.hidden) open(); else close(false);
    });
    Array.prototype.forEach.call(panel.querySelectorAll('a'), function (a) {
      a.addEventListener('click', function () { close(false); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close(true);
    });
    document.addEventListener('click', function (e) {
      if (panel.hidden) return;
      if (panel.contains(e.target) || button.contains(e.target)) return;
      close(false);
    });
  })();


  /* ---- Everything below is ambient motion. ---------------------------- */
  if (reduced) return;


  /* ---- 1. Hero visual: settles from 0.92 to full size over the first
           screen of scroll. Transform only. ----------------------------- */
  (function () {
    var scaler = document.querySelector('.hv-scale');
    if (!scaler) return;
    var queued = false;
    function sync() {
      queued = false;
      var p = clamp(window.scrollY / (window.innerHeight * 0.7), 0, 1);
      scaler.style.setProperty('--hv', (0.92 + 0.08 * p).toFixed(4));
    }
    window.addEventListener('scroll', function () {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(sync);
    }, { passive: true });
    sync();
  })();


  /* ---- 2. Scroll reveals and count-ups.

           Two safety nets, both load-bearing: threshold 0 rather than a
           ratio, because an element taller than the viewport never reaches
           one; and a scroll sweep plus a timeout, so reveal-on-scroll is
           never the only thing between the visitor and the content. ------ */
  if (!('IntersectionObserver' in window)) return;

  var targets = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
  if (!targets.length) return;

  root.classList.add('js-motion');

  /* figures count up from zero the first time their block is shown */
  var counters = Array.prototype.slice.call(document.querySelectorAll('[data-count]'));
  counters.forEach(function (el) {
    el.setAttribute('data-final', el.textContent);
  });

  function format(el, v) {
    var locale = el.getAttribute('data-locale');
    return locale ? Math.round(v).toLocaleString(locale) : String(Math.round(v));
  }

  function count(el) {
    if (el.getAttribute('data-counted')) return;
    el.setAttribute('data-counted', '1');
    var end = Number(el.getAttribute('data-count'));
    var final = el.getAttribute('data-final');
    var t0 = null;
    var dur = 1400;
    el.textContent = format(el, 0);
    function frame(t) {
      if (t0 === null) t0 = t;
      var p = clamp((t - t0) / dur, 0, 1);
      var eased = 1 - Math.pow(1 - p, 4);
      el.textContent = p < 1 ? format(el, end * eased) : final;
      if (p < 1) window.requestAnimationFrame(frame);
    }
    window.requestAnimationFrame(frame);
  }

  function show(el) {
    el.classList.add('shown');
    el.querySelectorAll('[data-count]').forEach(count);
  }

  var delivered = false;

  /* "delivered" means the observer is alive: it reports every target once on
     observe, in view or not. Nothing on screen at load (the hero fills the
     first viewport) is normal, not a failure. */
  var revealIO = new IntersectionObserver(function (entries) {
    delivered = true;
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      show(entry.target);
      revealIO.unobserve(entry.target);
      var k = targets.indexOf(entry.target);
      if (k > -1) targets.splice(k, 1);
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0 });

  targets.slice().forEach(function (el) { revealIO.observe(el); });

  function sweep() {
    var line = window.innerHeight * 0.92;
    for (var i = targets.length - 1; i >= 0; i--) {
      if (targets[i].getBoundingClientRect().top < line) {
        show(targets[i]);
        revealIO.unobserve(targets[i]);
        targets.splice(i, 1);
      }
    }
    if (!targets.length) {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    }
  }

  var pending = false;
  function onScroll() {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(function () { pending = false; sweep(); });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  sweep();

  /* and if the observer never reported at all, drop the ambient layer
     rather than leave a blank page; figures keep their final values */
  window.setTimeout(function () {
    if (delivered || !targets.length) return;
    root.classList.remove('js-motion');
    revealIO.disconnect();
    counters.forEach(function (el) {
      if (!el.getAttribute('data-counted')) el.textContent = el.getAttribute('data-final');
    });
  }, 2500);
})();
