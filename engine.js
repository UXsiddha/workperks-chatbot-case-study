/* =========================================================================
   engine.js: the prototype's own keyword routing, tools and renderer,
   lifted from the WorkPerks build (lib/last-resort.ts, the tools, and
   lib/render.ts) and run against the catalogue inlined in the page as
   #demo-context. No model runs here; the AI step in the real app is the
   one thing that cannot come into a static page.
   ========================================================================= */
(function () {
  var ctxEl = document.getElementById('demo-context');
  if (!ctxEl) return;
  var CTX = JSON.parse(ctxEl.textContent);
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------- helpers */
  var fold = function (t) {
    return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  };
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var inr = function (n) { return n.toLocaleString('en-IN'); };
  var rx = function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
  var wordIn = function (hay, w) {
    return new RegExp('(^|[^a-z0-9])' + rx(w) + '([^a-z0-9]|$)').test(hay);
  };

  var STOP = new Set(('the and for any can get with have has had does did are was were what some that this these those you your yours there here from into ' +
    'about anything something everything nothing anyone someone them they their our ours mine his her hers its who whom which when where why how ' +
    'not but than then too very just also been being will would should could shall may might must over under out off own all both each ' +
    'more most less least other another same such only still even ever new old good best better great nice bad big small long short ' +
    'need needs needed want wants wanted like look looking find finding thing things stuff way ways one two lot lots bit kind sort type ' +
    'please help know think make made take taken give given put use used going goes come coming say said tell told ask asked').split(' '));

  var NOT_LIVE = {
    soon: 'Coming soon — not something you can book yet.',
    nocity: 'Not available in your city yet.',
    notplan: 'Not part of your plan.'
  };
  var CLOSED = new Set(['done', 'completed', 'rejected', 'cancelled', 'canceled', 'expired', 'declined']);
  var OFFER = "I can find a benefit, explain one, tell you what you've booked, your balance, or anything about gift vouchers.";
  var noContext = { unavailable: "The app didn't send its catalogue with this question." };

  /* ============================================================ tools */

  /* search_benefits — tools/app.ts */
  function searchBenefits(args) {
    var all = CTX.benefits;
    var pool = all;
    var rescued = [];
    function narrow(label, value, keep) {
      if (!value) return;
      var next = pool.filter(keep);
      if (next.length) { pool = next; return; }
      rescued.push(value);
    }
    narrow('category', args.category, function (b) {
      return b.category.toLowerCase().indexOf((args.category || '').toLowerCase()) >= 0;
    });
    narrow('funding', args.funding, function (b) {
      return b.funding.toLowerCase() === (args.funding || '').toLowerCase();
    });
    if (args.bookable_only !== false) pool = pool.filter(function (b) { return b.availability === 'live'; });

    var q = fold([args.query || ''].concat(rescued).join(' ')).replace(/[^a-z0-9 ]/g, ' ');
    var words = q.split(/\s+/).filter(function (w) { return w.length > 2 && !STOP.has(w); });

    function scoreOf(b) {
      var title = fold(b.title);
      var termHay = fold((b.terms || []).join(' | '));
      var hay = fold([b.title, b.category, b.status, b.amount, b.funding,
        (b.vendors || []).join(' '), (b.variants || []).join(' '), (b.terms || []).join(' ')].join(' '));
      var score = 0;
      words.forEach(function (w) {
        var stem = w.length > 4 ? w.slice(0, -1) : w;
        if (wordIn(title, w) || wordIn(title, stem)) score += 4;
        else if (wordIn(termHay, w) || wordIn(termHay, stem)) score += 3;
        else if (wordIn(hay, w)) score += 2;
        else if (wordIn(hay, stem)) score += 1;
      });
      return score;
    }

    if (!words.length)
      return { results: pool.slice(0, 8), total: pool.length, searched: pool.length, matched: false };

    var scored = pool.map(function (b) {
      var c = Object.assign({}, b); c.score = scoreOf(b); return c;
    }).filter(function (b) { return b.score > 0; }).sort(function (a, b) { return b.score - a.score; });

    var bestScore = scored.length ? scored[0].score : 0;
    var weak = scored.length > 0 && bestScore < Math.min(3, Math.max(2, words.length * 0.9));
    if (scored.length) scored = scored.filter(function (b) { return b.score >= bestScore * 0.35; });

    var alsoNotLive = [];
    if (args.bookable_only !== false) {
      var about = function (b) { return fold(b.title + ' ' + b.category + ' ' + (b.terms || []).join(' ')); };
      var df = function (w) { return all.filter(function (b) { return about(b).indexOf(w) >= 0; }).length; };
      var cap = Math.max(2, Math.ceil(all.length * 0.15));
      var distinctive = words.filter(function (w) { var d = df(w); return d > 0 && d <= cap; });
      alsoNotLive = all.filter(function (b) { return b.availability !== 'live'; })
        .map(function (b) {
          var hay = about(b);
          var hits = distinctive.filter(function (w) { return hay.indexOf(w) >= 0 || hay.indexOf(w.replace(/s$/, '')) >= 0; }).length;
          return { b: b, hits: hits, score: scoreOf(b) };
        })
        .filter(function (e) { return e.hits > 0; })
        .sort(function (a, b) { return b.score - a.score; })
        .map(function (e) { return e.b.title; })
        .slice(0, 3);
    }
    return { results: scored.slice(0, 8), total: scored.length, searched: pool.length, matched: true, weak: weak, alsoNotLive: alsoNotLive };
  }

  /* get_balance — one currency per answer, enforced in the tool */
  function getBalance(args) {
    if (args.currency !== 'rupees' && args.currency !== 'coins')
      return { unavailable: 'ask-which' };
    if (args.currency === 'coins')
      return { currency: 'coins', display: inr(CTX.coins) + ' coins' };
    return { currency: 'rupees', display: '₹' + inr(CTX.rewardBalanceInr) };
  }

  /* get_wallet — the purses, deliberately without figures */
  function getWallet(args) {
    if (args.currency === 'rupees')
      return { currency: 'rupees', display: '₹' + inr(CTX.rewardBalanceInr),
        what: 'Your reward balance. Spend it on gift vouchers from the reward store.', missing: ['when it expires'] };
    if (args.currency === 'coins')
      return { currency: 'coins', display: inr(CTX.coins) + ' coins',
        what: 'Health Coins, earned from activity. They are not rupees and cannot be withdrawn.', missing: ['when they expire'] };
    if (args.currency === 'flexi') {
      var f = CTX.funding.flexi;
      return { currency: 'flexi', what: f.eligibility + ' ' + f.how,
        missing: ['how much you declared', 'what you have spent', 'the declaration cut-off'] };
    }
    return { purses: [
      { name: 'Reward balance', what: 'Rupees for gift vouchers', ask: 'What is my reward balance?' },
      { name: 'Health Coins', what: 'Earned from activity', ask: 'How many coins do I have?' },
      { name: 'Flexi allowance', what: 'What you set aside in your declaration', ask: 'What is my flexi allowance?' }
    ] };
  }

  /* my_orders */
  function myOrders() {
    var byId = {};
    CTX.benefits.forEach(function (b) { byId[b.id] = b.title; });
    var open = CTX.orders.filter(function (o) { return !CLOSED.has(String(o.status).toLowerCase()); }).length;
    return {
      orders: CTX.orders.map(function (o) { var c = Object.assign({}, o); c.title = byId[o.benefitId]; return c; }),
      total: CTX.orders.length, open: open, closed: CTX.orders.length - open
    };
  }

  /* benefit_detail */
  function benefitDetail(args) {
    var wanted = (args.title || '').toLowerCase();
    var b = CTX.benefits.filter(function (x) { return x.id === args.id; })[0] ||
      (wanted ? CTX.benefits.filter(function (x) { return x.title.toLowerCase().indexOf(wanted) >= 0; })[0] : null);
    if (!b) return { unavailable: 'Nothing in the catalogue matches "' + (args.id || args.title || '') + '".' };
    var live = b.availability === 'live';
    var d = Object.assign({}, b);
    d.live = live;
    d.notLiveReason = live ? undefined : (NOT_LIVE[b.availability] || 'Not switched on for you yet.');
    d.openScreen = 'detail:' + b.id;
    return d;
  }

  /* explain — definitions come from the app's own copy, never written here */
  function describeBenefit(b) {
    var f = CTX.funding[b.funding];
    if (b.availability !== 'live')
      return { term: b.title, kind: 'benefit', summary: NOT_LIVE[b.availability] || 'Not switched on for you yet.',
        detail: 'It is in the catalogue, but not switched on for you yet — so there is nothing to book and no price to quote.',
        related: (b.variants || []).slice(0, 3), notLive: true };
    return { term: b.title, kind: 'benefit',
      summary: b.status + (f ? ' — ' + f.eligibility : ''),
      detail: b.amount + '. You ' + b.action.toLowerCase() + ' it' + ((b.vendors || [])[0] ? ' through ' + b.vendors[0] : '') + '.',
      related: (b.variants || []).slice(0, 3), id: b.id };
  }
  function describeCategory(c) {
    var inIt = CTX.benefits.filter(function (b) { return b.category === c.name && b.availability === 'live'; });
    return { term: c.name, kind: 'category', summary: c.description,
      detail: inIt.length ? inIt.length + ' of these are available to you right now.' : undefined,
      members: inIt.slice(0, 5).map(function (b) { return { title: b.title, id: b.id, note: b.amount + ' · ' + b.action }; }) };
  }
  function describeFunding(f, key) {
    var paid = CTX.benefits.filter(function (b) { return b.funding === key && b.availability === 'live'; });
    var labels = Object.keys(CTX.funding).map(function (k) { return CTX.funding[k].label; });
    return { term: f.label, kind: 'how it is paid for', key: key, summary: f.eligibility, detail: f.how,
      related: labels.filter(function (l) { return l !== f.label; }).slice(0, 3),
      members: paid.slice(0, 5).map(function (b) { return { title: b.title, id: b.id, note: b.amount + ' · ' + b.action }; }) };
  }
  function asVariant(v, b) {
    var d = describeBenefit(b);
    d.term = v; d.kind = 'one way of taking ' + b.title;
    d.related = (b.variants || []).filter(function (x) { return x !== v; }).slice(0, 3);
    d.openLabel = b.title;
    return d;
  }
  var FUND_ALIAS = { flexi: 'flexi', allowance: 'flexi', declaration: 'flexi', policy: 'policy',
    'company policy': 'policy', budget: 'budget', free: 'budget', insurance: 'ins', ins: 'ins',
    'cashless cover': 'ins', cashless: 'ins', member: 'member', 'corporate rate': 'member', 'member rate': 'member' };

  function explain(args) {
    var q = (args.term || '').trim().toLowerCase();
    if (!q) return { unavailable: 'No term was given to explain.' };
    var i, b, v;

    var exactBenefit = CTX.benefits.filter(function (x) { return x.title.toLowerCase() === q; })[0];
    if (exactBenefit) return describeBenefit(exactBenefit);
    var exactCat = CTX.categoryNotes.filter(function (c) { return c.name.toLowerCase() === q; })[0];
    if (exactCat) return describeCategory(exactCat);
    for (i = 0; i < CTX.benefits.length; i++) {
      b = CTX.benefits[i];
      v = (b.variants || []).filter(function (x) { return x.toLowerCase() === q; })[0];
      if (v) return asVariant(v, b);
    }
    var fkeys = Object.keys(CTX.funding);
    for (i = 0; i < fkeys.length; i++)
      if (fkeys[i] === q || CTX.funding[fkeys[i]].label.toLowerCase() === q)
        return describeFunding(CTX.funding[fkeys[i]], fkeys[i]);

    var named = CTX.benefits.filter(function (x) { return q.length > 6 && x.title.toLowerCase().indexOf(q) >= 0; })[0] ||
      CTX.benefits.filter(function (x) { return x.title.toLowerCase().indexOf(q) >= 0 && q.length > 3 && x.title.toLowerCase().indexOf(q) === 0; })[0];
    if (named) return describeBenefit(named);

    var aliases = Object.keys(FUND_ALIAS);
    for (i = 0; i < aliases.length; i++) {
      var key = FUND_ALIAS[aliases[i]];
      if (new RegExp('(^|[^a-z])' + rx(aliases[i]) + '([^a-z]|$)', 'i').test(q) && CTX.funding[key])
        return describeFunding(CTX.funding[key], key);
    }

    if (q.length >= 12) {
      for (i = 0; i < CTX.benefits.length; i++) {
        b = CTX.benefits[i];
        v = (b.variants || []).filter(function (x) { return x.toLowerCase().indexOf(q) === 0 || x.toLowerCase().indexOf(q) >= 0; })[0];
        if (v) return asVariant(v, b);
      }
      var pt = CTX.benefits.filter(function (x) { return x.title.toLowerCase().indexOf(q) === 0; })[0];
      if (pt) return describeBenefit(pt);
    }

    var catScored = CTX.categoryNotes.map(function (c) {
      var name = c.name.toLowerCase();
      if (name.indexOf(q) >= 0 || q.indexOf(name) >= 0) return { c: c, score: 50 };
      var ws = name.split(/[^a-z]+/).filter(function (w) { return w.length > 3; });
      return { c: c, score: ws.filter(function (w) { return q.indexOf(w) >= 0; }).length };
    }).filter(function (e) { return e.score > 0; }).sort(function (a, b) { return b.score - a.score; });
    var best = catScored[0];
    var ambiguous = catScored[1] && best && catScored[1].score === best.score && best.score < 50;
    if (best && !ambiguous) return describeCategory(best.c);

    var whole = new RegExp('(^|[^a-z0-9])' + rx(q) + '([^a-z0-9]|$)', 'i');
    for (i = 0; i < CTX.benefits.length; i++) {
      b = CTX.benefits[i];
      v = (b.variants || []).filter(function (x) { return whole.test(x.toLowerCase()); })[0];
      if (v) return asVariant(v, b);
    }
    var loose = CTX.benefits.filter(function (x) { return x.title.toLowerCase().indexOf(q) >= 0; })[0];
    if (loose) return describeBenefit(loose);

    var words = q.split(/[^a-z0-9]+/).filter(function (w) { return w.length > 3 && !STOP.has(w); });
    if (words.length) {
      var sc = CTX.benefits.map(function (x) {
        var t = x.title.toLowerCase();
        return { x: x, score: words.filter(function (w) { return t.indexOf(w) >= 0 || t.indexOf(w.replace(/s$/, '')) >= 0; }).length };
      }).filter(function (e) { return e.score > 0; }).sort(function (a, c) { return c.score - a.score; });
      if (sc.length && sc[0].score >= Math.min(2, words.length)) return describeBenefit(sc[0].x);
    }
    var labels = Object.keys(CTX.funding).map(function (k) { return CTX.funding[k].label; });
    return { unavailable: 'I don’t have a definition for "' + args.term + '". I can explain how things are paid for (' +
      labels.join(', ') + '), any category, or a specific benefit.' };
  }

  /* ========================================================== routing */

  var GREETING_ONLY = /^(hi|hey|hello|yo|hiya|howdy|ok|okay|k|thanks|thank you|ty|ta|cheers|bye|good (morning|afternoon|evening|day))$/i;
  function isGreeting(text) {
    var t = text.trim().replace(/[\s!.,?~-]+$/, '').replace(/^[\s!.,?~-]+/, '');
    if (!/[\p{L}\p{N}]/u.test(text)) return true;
    return GREETING_ONLY.test(t);
  }

  var ACT = /\b(book|buy|purchase|order|cancel|reschedule|rebook|renew|claim|apply|enrol|enroll|subscribe|redeem|change|update|add|remove|delete)\b/i;
  var ASKING_YOU_TO = [
    /\b(can|could|would|will|please)\s+(you|u)\b/i,
    /\b(for|on behalf of)\s+me\b/i,
    /^\s*(please\s+)?[a-z]+\s+me\b/i,
    new RegExp('^\\s*(please\\s+)?' + ACT.source.replace(/\\b/g, ''), 'i'),
    /\bdo it for me\b/i
  ];
  var ABOUT_STATE = [/\bhave i\b/i, /\bdid i\b/i, /\bwhat (have|did|is|are)\b/i,
    /\bhow (do|can) i\b/i, /\bwhere (do|can) i\b/i, /\bstatus\b/i];

  function isActionRequest(text) {
    var q = text.trim();
    if (!ACT.test(q)) return false;
    if (ABOUT_STATE.some(function (r) { return r.test(q); })) return false;
    return ASKING_YOU_TO.some(function (r) { return r.test(q); });
  }
  function actionPhrase(text) {
    var t = text.trim().replace(/[?.!]+$/, '');
    t = t.replace(/^\s*(please\s+)?(can|could|would|will)\s+(you|u)\s+(please\s+)?/i, '');
    t = t.replace(/^\s*please\s+/i, '');
    t = t.replace(/\s+(for|on behalf of)\s+me\b/i, '');
    t = t.replace(/^\s*([a-z]+)\s+me\s+(a|an|the)\s+/i, '$1 a ');
    t = t.replace(/^\s*([a-z]+)\s+me\b/i, '$1');
    return t.trim() || text.trim();
  }
  function screenForAction(phrase) {
    var p = phrase.toLowerCase();
    if (/\bcancel|reschedule|renew|my (order|booking)\b/.test(p)) return 'orders';
    if (/\bvoucher|gift card\b/.test(p)) return 'rewards';
    if (/\bsave|saved|wishlist\b/.test(p)) return 'saved';
    if (/\bdeclaration|flexi\b/.test(p)) return 'profile';
    if (/\bbook|buy|subscribe|enrol|enroll|order|claim|apply|redeem\b/.test(p)) return 'benefits';
    return undefined;
  }
  var SCREEN_LABEL = { orders: 'Your orders', rewards: 'Reward store', saved: 'Saved items',
    profile: 'Your profile', benefits: 'Browse all benefits' };

  /* lastResortRoute — lib/last-resort.ts, minus the voucher branch, which
     needs the supplier proxy and cannot run in a page. */
  function lastResortRoute(question) {
    var s = question.toLowerCase().trim();
    if (!s) return null;
    if (/\b(balance|coins|points|allowance|wallet|how much (do|have) i|left to spend)\b/.test(s)) {
      var cur = /\bcoin|point\b/.test(s) ? 'coins' : /\brupee|reward|₹\b/.test(s) ? 'rupees' : null;
      if (/\bwallet|purse\b/.test(s)) {
        var wc = cur || (/\bflexi|allowance\b/.test(s) ? 'flexi' : null);
        return { tool: 'get_wallet', args: wc ? { currency: wc } : {} };
      }
      if (!cur && /\bflexi|allowance\b/.test(s)) return { tool: 'get_wallet', args: { currency: 'flexi' } };
      return { tool: 'get_balance', args: cur ? { currency: cur } : {} };
    }
    if (/\bvoucher|gift card\b/.test(s)) return { tool: '__vouchers__', args: {} };
    if (/\b(booked|booking|my orders|orders|on the go)\b/.test(s)) return { tool: 'my_orders', args: {} };
    var term = /\b(?:what is|what are|what does|explain|tell me about)\s+(?:an?\s+|the\s+)?([^?.!]{2,40})/i.exec(question);
    if (term) return { tool: 'explain', args: { term: term[1].trim() } };
    if (/\b(get|find|anything|available|offer|benefit|help with|need|looking for)\b/.test(s))
      return { tool: 'search_benefits', args: { query: question } };
    return null;
  }

  function route(question) {
    if (isGreeting(question)) return { tool: '__greeting__', args: {} };
    if (isActionRequest(question)) {
      var thing = actionPhrase(question);
      return { tool: 'cannot_do', args: { thing: thing, screen: screenForAction(thing) } };
    }
    return lastResortRoute(question) || { tool: '__none__', args: {} };
  }

  /* ========================================================= gerund */
  /* "I can't do X myself" needs X as a gerund, normalised here rather
     than left to whatever the model wrote. Shortened from lib/render.ts. */
  /* The verbs that reach here are a closed set, the same one ACT matches, so
     they are spelled out rather than inferred. A rule that doubles the last
     consonant cannot tell "order" from "prefer" without knowing where the
     stress falls, and it turned "order a laptop" into "orderring a laptop". */
  var GERUND = {
    book: 'booking', buy: 'buying', purchase: 'purchasing', order: 'ordering',
    cancel: 'cancelling', reschedule: 'rescheduling', rebook: 'rebooking',
    renew: 'renewing', claim: 'claiming', apply: 'applying', enrol: 'enrolling',
    enroll: 'enrolling', subscribe: 'subscribing', redeem: 'redeeming',
    change: 'changing', update: 'updating', add: 'adding', remove: 'removing',
    delete: 'deleting'
  };
  function gerund(phrase) {
    var t = phrase.trim();
    var m = /^([a-z]+)\b/i.exec(t);
    if (!m) return t;
    var w = m[1].toLowerCase();
    if (/^(a|an|the|any|your|my)$/.test(w)) return t;
    var ing = GERUND[w];
    if (!ing) ing = /e$/.test(w) && !/ee$/.test(w) ? w.slice(0, -1) + 'ing' : w + 'ing';
    return ing + t.slice(m[1].length);
  }
  function toSecondPerson(s) {
    return s.replace(/\bmy\b/gi, 'your').replace(/\bme\b/gi, 'you').replace(/\bmine\b/gi, 'yours');
  }

  /* ======================================================== renderer */
  /* Six block kinds, exactly as lib/render.ts builds them. */

  function runTool(r) {
    switch (r.tool) {
      case 'search_benefits': return searchBenefits(r.args);
      case 'get_balance': return getBalance(r.args);
      case 'get_wallet': return getWallet(r.args);
      case 'my_orders': return myOrders();
      case 'benefit_detail': return benefitDetail(r.args);
      case 'explain': return explain(r.args);
      case 'cannot_do': {
        var screen = r.args.screen;
        return { thing: r.args.thing || 'that',
          route: screen ? { label: SCREEN_LABEL[screen] || screen, route: screen } : null };
      }
      default: return {};
    }
  }

  function blocks(tool, r) {
    if (tool === '__greeting__')
      return [{ kind: 'text', text: OFFER },
        { kind: 'chips', items: ['What can I get?', 'What have I booked?', 'How many coins do I have?'] }];

    if (tool === '__none__')
      return [{ kind: 'text', text: "I'm not sure what you're after." },
        { kind: 'text', text: OFFER },
        { kind: 'chips', items: ['What can I get?', 'What have I booked?', 'How many coins do I have?'] }];

    if (tool === '__vouchers__')
      return [{ kind: 'note', variant: 'info', title: 'The vouchers need a server',
        body: 'Gift vouchers come from a supplier reached through a server-side proxy, and a page like this one has none. In the app the same question returns brands, denominations and stock, read at the moment of asking.' },
        { kind: 'chips', items: ['What can I get?', 'What is my reward balance?'] }];

    if (r.unavailable === 'ask-which')
      return [{ kind: 'text', text: 'Which balance do you mean — your reward balance in rupees, or your Health Coins? They are separate, and I only ever show one at a time.' },
        { kind: 'text', text: 'Your flexi allowance is a third, separate thing. I can explain how it works, but I cannot total it here.' },
        { kind: 'chips', items: ['What is my reward balance?', 'How many coins do I have?'] }];

    if (typeof r.unavailable === 'string')
      return [{ kind: 'note', variant: 'error', title: "I can't answer that right now", body: r.unavailable }];

    switch (tool) {
      case 'search_benefits': {
        var rs = r.results || [], notLive = r.alsoNotLive || [];
        var notLiveLine = function (xs) {
          return xs.join(', ') + ' ' + (xs.length === 1 ? 'matches' : 'match') + ', but ' +
            (xs.length === 1 ? 'it is' : 'they are') + ' not switched on for you yet.';
        };
        if (!rs.length && notLive.length)
          return [{ kind: 'text', text: notLiveLine(notLive) },
            { kind: 'text', text: 'I only offer things you can actually book today.' },
            { kind: 'actions', actions: [{ label: 'Browse all benefits', route: 'benefits' }] }];
        if (!rs.length)
          return [{ kind: 'text', text: "I'm not sure what you're after — nothing in the catalogue matched those words." },
            { kind: 'text', text: 'There are ' + r.searched + ' benefits across categories like Fitness, Health, Learning, Devices and Travel. Tell me the problem rather than the product — "my knee hurts", "I’m moving city" — or browse them all.' },
            { kind: 'actions', actions: [{ label: 'Browse all benefits', route: 'benefits' }] }];
        var total = typeof r.total === 'number' ? r.total : rs.length;
        var shown = Math.min(5, rs.length);
        var headline = r.matched === false
          ? 'Here are ' + shown + ' of the ' + r.searched + ' things you can book — tell me what you need and I’ll narrow it down'
          : r.weak
            ? 'Nothing matched that closely. The nearest ' + (shown === 1 ? 'thing' : shown + ' things') + ' I have:'
            : total + ' of your ' + r.searched + ' benefits match' + (total > shown ? ', closest ' + shown + ' first' : '');
        var out = [
          { kind: 'header', title: headline.replace(/\.$/, ''), subtitle: notLive.length ? notLiveLine(notLive) : undefined },
          { kind: 'rows', title: 'Available to you', rows: rs.slice(0, 5).map(function (b) {
            return { label: b.title, value: b.amount + ' · ' + b.action + ' · ' + ((b.vendors || [])[0] || b.category), route: 'detail:' + b.id };
          }) }
        ];
        if (total > shown) out.push({ kind: 'actions', actions: [{ label: 'Browse all ' + r.searched + ' benefits', route: 'benefits' }] });
        out.push({ kind: 'chips', items: ['Tell me about ' + rs[0].title]
          .concat(rs[0].funding ? ['What is ' + rs[0].funding + '?'] : [])
          .concat(rs[1] ? ['Tell me about ' + rs[1].title] : []).slice(0, 3) });
        return out;
      }

      case 'benefit_detail':
        if (r.live === false)
          return [{ kind: 'text', text: r.title + ' — ' + (r.notLiveReason || 'not switched on for you yet.') },
            { kind: 'text', text: 'It is in the catalogue, but there is nothing to book yet.' },
            { kind: 'actions', actions: [{ label: 'Browse all benefits', route: 'benefits' }] }];
        return [{ kind: 'text', text: r.title + ' — ' + r.amount + '. ' + r.status },
          { kind: 'rows', title: 'Details', rows: [
            { label: 'How you get it', value: r.action },
            { label: 'Paid from', value: r.funding },
            { label: 'Providers', value: (r.vendors || []).join(', ') || 'not listed' }] },
          { kind: 'actions', actions: [{ label: 'Open ' + r.title, route: r.openScreen }] }];

      case 'my_orders': {
        var os = r.orders || [];
        return [
          { kind: 'header', title: r.open + ' thing' + (r.open === 1 ? '' : 's') + ' on the go',
            subtitle: r.closed ? r.closed + ' more ' + (r.closed === 1 ? 'is' : 'are') + ' finished or closed — they are in the list too.' : 'Everything you have booked.' },
          { kind: 'rows', title: 'Booked', rows: os.map(function (o) {
            return { label: o.title || o.benefitId, value: o.status + ' · ' + o.when + ' · ' + o.detail, route: 'detail:' + o.benefitId };
          }) },
          { kind: 'actions', actions: [{ label: 'Your orders', route: 'orders' }] }
        ];
      }

      case 'get_balance':
        return [
          { kind: 'header', title: r.display, subtitle: r.currency === 'coins'
            ? 'Health Coins, earned from activity. Not rupees, and not withdrawable.'
            : 'Your reward balance, for gift vouchers from the reward store.' },
          { kind: 'chips', items: r.currency === 'rupees'
            ? ['What vouchers can I get?', 'What have I booked?']
            : ['What have I booked?', 'What can I get?'] }
        ];

      case 'get_wallet': {
        if (r.purses)
          return [{ kind: 'header', title: 'Your wallet', subtitle: 'Three separate purses. They never mix.' },
            { kind: 'rows', title: 'What you have', rows: r.purses.map(function (p) { return { label: p.name, value: p.what }; }) },
            { kind: 'chips', items: r.purses.map(function (p) { return p.ask; }) }];
        var w = [{ kind: 'header', title: r.display || 'Your flexi allowance', subtitle: r.what }];
        if (r.missing && r.missing.length)
          w.push({ kind: 'note', variant: 'info', title: 'Not shown here', body: 'This app does not tell me ' + r.missing.join(', ') + '.' });
        w.push({ kind: 'chips', items: r.currency === 'rupees'
          ? ['What vouchers can I get?', 'How many coins do I have?']
          : r.currency === 'coins' ? ['What have I booked?', 'What is my reward balance?']
          : ['What is a flexi benefit?', 'What is my reward balance?'] });
        return w;
      }

      case 'explain': {
        var head = String(r.term).indexOf('—') >= 0 ? r.term + ': ' + r.summary : r.term + ' — ' + r.summary;
        var e = [{ kind: 'text', text: head }];
        if (r.detail) e.push({ kind: 'text', text: r.detail });
        if (r.members && r.members.length && r.kind === 'benefit')
          e.push({ kind: 'rows', title: 'Ways to take it', rows: r.members.map(function (m) {
            return { label: m.title, value: m.note || '', route: 'detail:' + m.id }; }) });
        if (r.id && !r.notLive)
          e.push({ kind: 'actions', actions: [{ label: 'Open ' + (r.openLabel || r.term), route: 'detail:' + r.id }] });
        if (r.members && r.members.length && r.kind !== 'benefit')
          e.push({ kind: 'chips', items: [r.kind === 'category' ? 'What can I get in ' + r.term + '?' : 'Show me ' + (r.key || r.term) + ' benefits']
            .concat(r.members.slice(0, 2).map(function (m) { return 'Tell me about ' + m.title; })) });
        else if (r.related && r.related.length)
          e.push({ kind: 'chips', items: r.related.slice(0, 3).map(function (x) { return 'What is ' + x + '?'; }) });
        return e;
      }

      case 'cannot_do': {
        var deed = toSecondPerson(gerund(r.thing));
        var c = [{ kind: 'text', text: r.route
          ? "I can't do " + deed + ' myself — I can explain anything and take you to where it happens.'
          : "I can't do " + deed + ' myself, and there is no screen in this app for it. I can explain how it works, or find you something else.' }];
        if (r.route) c.push({ kind: 'actions', actions: [r.route] });
        return c;
      }

      default:
        return [{ kind: 'text', text: "I'm not sure what you're after." }];
    }
  }

  /* ====================================================== shared rendering */
  /* One renderer, four widgets. It takes the container rather than closing
     over the demo's thread, so the ladder and the hero can call it too. */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* The four-point spark the app puts on the avatar. */
  function spark() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M12 1.6l1.9 6.7 6.5 1.9-6.5 1.9-1.9 6.7-1.9-6.7L3.6 10.2l6.5-1.9z');
    svg.appendChild(p);
    return svg;
  }

  /* One assistant turn, shaped the way Chat.tsx shapes it: .chatai wraps the
     .cav avatar and the .cbub card, and every block inside the card keeps the
     app's own class semantics - .sec and .esub for a header, .p for prose,
     .note for a caveat, .row for a fact, .cchip for a follow-up, .crgo for an
     action. */
  function render(container, bs) {
    var turn = el('div', 'dm-turn dm-ai');
    var av = el('span', 'dm-av');
    av.appendChild(spark());
    turn.appendChild(av);

    var bub = el('div', 'dm-bub');
    bs.forEach(function (b) {
      if (b.kind === 'header') {
        var h = el('div', 'dm-head');
        /* .sec is the app's section LABEL, sized for "Available to you". A
           title long enough to be a sentence drops to body scale so a note
           about the answer never outranks the answer. */
        h.appendChild(el('p', 'dm-sec' + (b.title.length > 40 ? ' is-qual' : ''), b.title));
        if (b.subtitle) h.appendChild(el('p', 'dm-esub', b.subtitle));
        bub.appendChild(h);
      } else if (b.kind === 'text') {
        bub.appendChild(el('p', 'dm-p', b.text));
      } else if (b.kind === 'note') {
        var n = el('div', 'dm-note' + (b.variant === 'error' ? ' is-error' : ''));
        n.appendChild(el('p', 'dm-n-title', b.title));
        n.appendChild(el('p', 'dm-n-body', b.body));
        bub.appendChild(n);
      } else if (b.kind === 'rows') {
        var box = el('div', 'dm-rows');
        if (b.title) box.appendChild(el('p', 'dm-r-title', b.title));
        b.rows.forEach(function (r) {
          var row = el(r.route ? 'button' : 'div', 'dm-row');
          if (r.route) { row.type = 'button'; row.setAttribute('data-route', r.route); }
          var left = el('span');
          left.appendChild(el('span', 'dm-r-label', r.label));
          left.appendChild(el('span', 'dm-r-value', r.value));
          row.appendChild(left);
          if (r.route) row.appendChild(el('span', 'dm-chev', '\u203A'));
          box.appendChild(row);
        });
        bub.appendChild(box);
      } else if (b.kind === 'actions') {
        var acts = el('div', 'dm-actions');
        b.actions.forEach(function (a) {
          var btn = el('button', 'dm-action', a.label);
          btn.type = 'button';
          btn.setAttribute('data-route', a.route);
          acts.appendChild(btn);
        });
        bub.appendChild(acts);
      } else if (b.kind === 'chips') {
        var chips = el('div', 'dm-chips');
        b.items.forEach(function (t) {
          var c = el('button', 'dm-chip', t);
          c.type = 'button';
          c.setAttribute('data-ask', t);
          chips.appendChild(c);
        });
        bub.appendChild(chips);
      }
    });
    turn.appendChild(bub);
    container.appendChild(turn);
    return turn;
  }

  /* What every widget is allowed to call. `supplied` stands in for the query a
     model would have written, and is always labelled as such where it is used. */
  function answer(question, supplied) {
    var r = supplied ? { tool: 'search_benefits', args: { query: supplied } } : route(question);
    return { route: r, blocks: blocks(r.tool, runTool(r)) };
  }

  var WP = {
    answer: answer,
    render: render,
    fallback: function () { return blocks('__none__', {}); },
    ask: function () {}
  };
  WP.blocks = blocks; WP.runTool = runTool; WP.route = route; WP.el = el; WP.CTX = CTX;
  WP.SCREEN_LABEL = SCREEN_LABEL; WP.OFFER = OFFER;
  window.WP = WP;
})();



