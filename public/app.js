/* Embrace — shepherding visit tracker for the body of elders. */
(function () {
  'use strict';

  var VERSION = '5.2';
  // A person has one privilege, an optional pioneer status, and any number of roles.
  var RANKS = ['Elder', 'Ministerial Servant', 'Publisher', 'Unbaptized Publisher', 'Inactive', 'Removed'];
  var PIONEERS = ['', 'Auxiliary Pioneer', 'Regular Pioneer', 'Special Pioneer'];
  var ROLES = ['Coordinator', 'Secretary', 'Service Overseer', 'Group Overseer', 'Circuit Overseer'];
  // The circuit overseer can sign in and go on visits, but isn't part of the congregation's flock.
  function isVisitor(p) { return (p.roles || []).indexOf('Circuit Overseer') >= 0; }
  // Older records kept the pioneer status in the privilege field.
  function norm(p) {
    var q = Object.assign({ pioneer: '', roles: [] }, p);
    if (q.rank === 'Regular Pioneer' || q.rank === 'Auxiliary Pioneer' || q.rank === 'Special Pioneer') { q.pioneer = q.pioneer || q.rank; q.rank = 'Publisher'; }
    if (!q.rank) q.rank = 'Publisher';
    if (!Array.isArray(q.roles)) q.roles = [];
    return q;
  }
  var STATUS = {
    fresh: { label: 'Visited', long: 'Visited recently', color: 'var(--st-fresh)' },
    soon: { label: 'Due soon', long: 'Due for a visit soon', color: 'var(--st-soon)' },
    late: { label: 'Waiting', long: 'Waiting for a visit', color: 'var(--st-late)' },
    none: { label: 'Not yet', long: 'Not yet visited', color: 'var(--st-none)' }
  };
  // Two simple states everywhere on screen: visited within the window, or not yet.
  var ORDER = ['fresh', 'none'];
  function homeState(p) { var s = state(p); return s === 'fresh' || s === 'soon' ? 'fresh' : 'none'; }
  var PREVIEW = !!window.EMBRACE_PREVIEW;
  var store = window.EmbraceStore.create();

  var S = {
    status: 'loading', error: '', loaded: false,
    data: { publishers: [], visits: [], settings: { overdueDays: 365 } },
    tab: 'home', mode: 'priority', group: 'all', query: '',
    pubId: null, sheet: null, hop: null, scroll: {}, open: {}, homeCal: { y: new Date().getFullYear(), m: new Date().getMonth() }, tYear: new Date().getFullYear(), tPart: 'year',
    meId: null, whoAll: false, whoQuery: '', busy: false, ringDrawn: false
  };
  var idx = { byPub: {}, groups: [] };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* blocked */ } }
  S.meId = lsGet('embrace-me');
  try { var ui = JSON.parse(lsGet('embrace-ui') || '{}'); if (ui.mode) S.mode = ui.mode; if (ui.group) S.group = ui.group; } catch (e) { /* ignore */ }
  function saveUi() { lsSet('embrace-ui', JSON.stringify({ mode: S.mode, group: S.group })); }

  /* ---------------- helpers ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDay(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function daysSince(s) { return Math.round((parseDay(todayStr()) - parseDay(s)) / 86400000); }
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function fmtDate(s, short) {
    if (!s) return '';
    if (s === todayStr()) return 'Today';
    var d = parseDay(s), t = MON[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
    return short && d.getFullYear() === new Date().getFullYear() ? t : t + ', ' + d.getFullYear();
  }
  var SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv)$/i;
  function words(n) { return String(n || '').replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(function (w) { return w && !SUFFIX.test(w); }); }
  function initials(n) { var w = words(n); return w.length ? (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase() : '?'; }
  function firstName(n) { return words(n)[0] || n; }
  function lastName(n) { var w = words(n); return (w[w.length - 1] || '').toLowerCase(); }
  function byName(a, b) { return lastName(a.name).localeCompare(lastName(b.name)) || String(a.name).localeCompare(String(b.name)); }
  function serviceYear() {
    var d = new Date(), y = d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear();
    return { label: y, start: (y - 1) + '-09-01', end: y + '-08-31' };
  }
  function od() { return +(S.data.settings && S.data.settings.overdueDays) || 365; }
  function odText() { var d = od(); return d >= 365 ? 'year' : Math.round(d / 30) + ' months'; }
  function isActive(p) { return p.rank !== 'Inactive' && p.rank !== 'Removed'; }
  function isPriority(p) {
    return isActive(p) && (p.rank === 'Elder' || p.rank === 'Ministerial Servant' || p.pioneer === 'Regular Pioneer' || p.pioneer === 'Special Pioneer' || !!p.appointedWife);
  }
  function titles(p) {
    var t = [];
    if (p.rank && p.rank !== 'Publisher') t.push(p.rank);
    (p.roles || []).forEach(function (r) { t.push(r); });
    if (p.pioneer) t.push(p.pioneer);
    if (p.appointedWife) t.push('Appointed wife');
    return t;
  }
  function pub(id) { for (var i = 0; i < S.data.publishers.length; i++) if (S.data.publishers[i].id === id) return S.data.publishers[i]; return null; }
  function visit(id) { for (var i = 0; i < S.data.visits.length; i++) if (S.data.visits[i].id === id) return S.data.visits[i]; return null; }
  function me() { return S.meId ? pub(S.meId) : null; }
  function elders() { return S.data.publishers.filter(function (p) { return p.rank === 'Elder'; }).sort(byName); }
  function stamp(t) { return !t ? 0 : typeof t === 'number' ? t : t.toMillis ? t.toMillis() : 0; }
  function visitOrder(a, b) { return a.date !== b.date ? (a.date < b.date ? 1 : -1) : stamp(b.createdAt) - stamp(a.createdAt); }
  function who(v) { return (v.elders || []).join(' & ') || 'Recorded before Embrace'; }
  function greeting() { var h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

  function rebuild() {
    var byPub = {}, groups = {};
    S.data.visits.slice().sort(visitOrder).forEach(function (v) { (byPub[v.publisherId] = byPub[v.publisherId] || []).push(v); });
    S.data.publishers.forEach(function (p) { if (p.group) groups[p.group] = 1; });
    idx = { byPub: byPub, groups: Object.keys(groups).sort() };
  }
  function last(p) { var l = idx.byPub[p.id]; return l ? l[0] : null; }
  function waiting(p) { var l = last(p); return l ? daysSince(l.date) : null; }
  function state(p) { var w = waiting(p); return w === null ? 'none' : w > od() ? 'late' : w > od() - 30 ? 'soon' : 'fresh'; }
  // Never visited first, then whoever has waited longest. A fresh visit sinks a person down the list.
  function byNeed(a, b) {
    var wa = waiting(a), wb = waiting(b);
    if (wa === null && wb !== null) return -1;
    if (wb === null && wa !== null) return 1;
    if (wa !== null && wb !== null && wa !== wb) return wb - wa;
    return byName(a, b);
  }
  function needOrder(list) {
    return list.slice().sort(function (a, b) {
      var pa = isPriority(a) ? 0 : isActive(a) ? 1 : 2, pb = isPriority(b) ? 0 : isActive(b) ? 1 : 2;
      return pa - pb || byNeed(a, b);
    });
  }
  function flock() { return S.data.publishers.filter(function (p) { return p.rank !== 'Removed' && !isVisitor(p); }); }

  /* ---------------- art ---------------- */
  function sheep(size, extra, flip) {
    return '<svg class="sheep ' + (extra || '') + '" width="' + size + '" height="' + Math.round(size * 0.8) + '" viewBox="0 0 30 24" aria-hidden="true"' + (flip ? ' style="transform:scaleX(-1)"' : '') + '>' +
      '<path class="leg" d="M11 18.5v4.2M20 18.5v4.2"/>' +
      '<path class="wool" d="M8.6 9.2a4.6 4.6 0 0 1 7.6-2.6 4.6 4.6 0 0 1 7.4 1.2 4.2 4.2 0 0 1 2.6 6.6 4.2 4.2 0 0 1-4.6 4.2H11.4a4.2 4.2 0 0 1-4-3.6 3.8 3.8 0 0 1 1.2-5.8z"/>' +
      '<ellipse class="ear" cx="7.6" cy="9.4" rx="1.6" ry=".8" transform="rotate(-30 7.6 9.4)"/>' +
      '<ellipse class="face" cx="5.6" cy="11.8" rx="3.4" ry="2.8"/><circle class="eye" cx="4.5" cy="11.2" r=".6"/></svg>';
  }
  function scene() {
    var stars = '';
    var pts = [[8, 6], [18, 14], [27, 4], [36, 11], [47, 7], [58, 16], [66, 5], [74, 12], [83, 8], [91, 15], [13, 22], [52, 25], [70, 24], [95, 4], [40, 19], [30, 27]];
    pts.forEach(function (p, i) { stars += '<circle cx="' + p[0] + '%" cy="' + p[1] + '%" r="' + (i % 3 === 0 ? 1.4 : 0.9) + '"/>'; });
    var cloud = function (c) {
      return '<svg class="cloud ' + c + '" viewBox="0 0 220 70" aria-hidden="true"><ellipse cx="70" cy="44" rx="58" ry="22"/><ellipse cx="120" cy="34" rx="50" ry="28"/><ellipse cx="165" cy="46" rx="44" ry="18"/></svg>';
    };
    return '<div class="scene" aria-hidden="true"><svg class="stars" width="100%" height="100%">' + stars + '</svg><div class="moon"></div>' +
      cloud('c1') + cloud('c2') + cloud('c3') +
      '<svg class="hills" viewBox="0 0 400 240" preserveAspectRatio="none">' +
      '<path class="far" d="M0 120 C 70 80, 150 92, 220 108 S 340 84, 400 100 L 400 240 L 0 240 Z"/>' +
      '<path class="mid" d="M0 158 C 90 120, 170 132, 250 150 S 360 128, 400 140 L 400 240 L 0 240 Z"/>' +
      '<path class="near" d="M0 196 C 110 168, 210 178, 290 192 S 370 180, 400 186 L 400 240 L 0 240 Z"/></svg>' +
      '<div class="grazer"><div class="walker">' + sheep(34) + '</div><div class="walker w2">' + sheep(34, '', true) + '</div><div class="walker w3">' + sheep(40) + '</div></div></div>';
  }
  var I = {
    home: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 8.5a2.6 2.6 0 0 1 4.2-1.2 2.6 2.6 0 0 1 4.3.6 2.6 2.6 0 0 1 1.7 4.4 2.6 2.6 0 0 1-2.6 3.2H9.2A2.6 2.6 0 0 1 7 12.6"/><ellipse cx="5.4" cy="10.6" rx="2.4" ry="2"/><path d="M9.5 15.5v3.5M15.5 15.5v3.5"/></svg>',
    flock: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21V8a4 4 0 0 1 8 0v1.5"/><path d="M17 9.5a1.4 1.4 0 0 1-2.8 0"/></svg>',
    talks: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4"/><path d="M6.5 9h11l-1.5 8h-8z"/><path d="M12 3.5v3"/></svg>',
    upcoming: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none"/></svg>',
    settings: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
    search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    back: '<svg width="12" height="20" viewBox="0 0 11 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2L2 9l7 7"/></svg>',
    chev: '<svg class="chev" width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1l6 6-6 6"/></svg>',
    chat: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    phone: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/></svg>',
    plus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    left: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>'
  };

  /* ---------------- pieces ---------------- */
  function subline(p) {
    var bits = titles(p);
    var l = last(p); if (l && l.followUp) bits.push('Follow up');
    return bits.join(' · ');
  }
  function endHtml(p) {
    var w = waiting(p), st = homeState(p);
    var dot = '<i class="dot" style="background:' + STATUS[st].color + '"></i>';
    var t = w === null ? 'Never' : w <= 0 ? 'Today' : w + (w === 1 ? ' day' : ' days');
    return '<span class="end' + (st === 'none' ? ' late' : '') + '">' + dot + t + I.chev + '</span>';
  }
  function cell(p, action, plain) {
    var sub = subline(p);
    return '<button class="cell" data-action="' + (action || 'open') + '" data-id="' + esc(p.id) + '">' +
      '<span class="av" aria-hidden="true">' + esc(initials(p.name)) + '</span>' +
      '<span class="txt"><b>' + esc(p.name) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
      (plain ? '' : endHtml(p)) + '</button>';
  }
  function block(title, list) {
    if (!list.length) return '';
    return '<h2 class="label">' + esc(title) + '</h2><div class="glass list">' + list.map(function (p) { return cell(p); }).join('') + '</div>';
  }
  function empty(title, text, btn) {
    return '<div class="glass empty">' + sheep(70, 'bob') + '<b>' + esc(title) + '</b><span>' + esc(text) + '</span>' + (btn || '') + '</div>';
  }
  function noteRow(v, showName) {
    var p = pub(v.publisherId);
    return '<button class="note" data-action="visit" data-id="' + esc(v.id) + '"><span class="top2"><b>' +
      esc(showName ? (p ? p.name : v.publisherName) : fmtDate(v.date)) + '</b><span>' + (showName ? esc(fmtDate(v.date, true)) : (v.followUp ? '<span class="flag">Follow up</span>' : '')) + '</span></span>' +
      '<span class="who">' + esc(who(v)) + '</span>' + (!showName && v.notes ? '<p>' + esc(v.notes) + '</p>' : '') + '</button>';
  }

  /* The floating flock ring: one segment per status, drawn in on first view. */
  function ringSvg(counts, total) {
    var r = 108, sw = 24, gap = total > 0 ? 3.6 : 0;
    var nonzero = ORDER.filter(function (k) { return counts[k] > 0; });
    var h = '<svg class="ring" viewBox="0 0 260 260" role="img" aria-label="' + ORDER.map(function (k) { return counts[k] + ' ' + STATUS[k].label; }).join(', ') + '">' +
      '<circle class="track" cx="130" cy="130" r="' + r + '" stroke-width="' + sw + '"/>';
    if (!total) return h + '</svg>';
    var start = 0;
    ORDER.forEach(function (k) {
      if (!counts[k]) return;
      var share = counts[k] / total * 100;
      var len = nonzero.length === 1 ? 100 : Math.max(0.01, share - gap);
      var cap = nonzero.length === 1 ? 'butt' : 'round';
      var final = len + ' ' + (100 - len);
      h += '<circle class="seg" cx="130" cy="130" r="' + r + '" pathLength="100" stroke-width="' + sw + '" stroke="' + STATUS[k].color + '"' +
        ' stroke-linecap="' + cap + '" stroke-dashoffset="' + (-(start + (nonzero.length === 1 ? 0 : gap / 2))) + '"' +
        ' data-final="' + final + '" stroke-dasharray="' + (S.ringDrawn ? final : '0 100') + '"/>';
      start += share;
    });
    return h + '</svg>';
  }
  function drawRing() {
    if (S.ringDrawn) return;
    var segs = document.querySelectorAll('.ring .seg');
    if (!segs.length) return;
    S.ringDrawn = true;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        Array.prototype.forEach.call(segs, function (s, i) {
          s.style.transitionDelay = (0.15 + i * 0.18) + 's';
          s.setAttribute('stroke-dasharray', s.getAttribute('data-final'));
        });
      });
    });
  }

  /* The two priority groups, each a tappable tile on Home. */
  var GROUPS = {
    pioneers: { title: 'Pioneers', sub: 'Regular and special pioneers',
      test: function (p) { return isActive(p) && (p.pioneer === 'Regular Pioneer' || p.pioneer === 'Special Pioneer'); },
      parts: [['Regular pioneers', function (p) { return p.pioneer === 'Regular Pioneer'; }], ['Special pioneers', function (p) { return p.pioneer === 'Special Pioneer'; }]] },
    appointed: { title: 'Appointed', sub: 'Elders, servants and their wives',
      test: function (p) { return isActive(p) && (p.rank === 'Elder' || p.rank === 'Ministerial Servant' || !!p.appointedWife); },
      parts: [['Elders', function (p) { return p.rank === 'Elder'; }], ['Ministerial servants', function (p) { return p.rank === 'Ministerial Servant'; }],
        ['Appointed wives', function (p) { return p.appointedWife && p.rank !== 'Elder' && p.rank !== 'Ministerial Servant'; }]] },
    publishers: { title: 'Publishers', sub: 'Everyone else who is active',
      test: function (p) { return isActive(p) && !GROUPS.pioneers.test(p) && !GROUPS.appointed.test(p); },
      parts: [['Auxiliary pioneers', function (p) { return p.pioneer === 'Auxiliary Pioneer'; }],
        ['Publishers', function (p) { return p.pioneer !== 'Auxiliary Pioneer'; }]] },
    inactive: { title: 'Inactive', sub: 'Inactive and removed ones', all: true,
      test: function (p) { return p.rank === 'Inactive' || p.rank === 'Removed'; },
      parts: [['Inactive', function (p) { return p.rank === 'Inactive'; }], ['Removed', function (p) { return p.rank === 'Removed'; }]] }
  };
  function members(g) { return (GROUPS[g].all ? S.data.publishers : flock()).filter(GROUPS[g].test); }
  function seenCount(list) { return list.filter(function (p) { var s = state(p); return s === 'fresh' || s === 'soon'; }).length; }
  function tile(g) {
    var list = members(g), done = seenCount(list), pct = Math.round(done / list.length * 100);
    return '<button class="glass tile" data-action="group-sheet" data-g="' + g + '"><span class="tile-label">' + GROUPS[g].title + I.chev + '</span>' +
      '<b>' + done + '<small> of ' + list.length + '</small></b><span class="bar"><i style="width:' + pct + '%"></i></span>' +
      '<span class="tile-sub">visited</span></button>';
  }
  function sheetGroup(g) {
    var G = GROUPS[g], list = members(g), done = seenCount(list), h = '';
    G.parts.forEach(function (part) {
      var ppl = needOrder(list.filter(part[1]));
      if (ppl.length) h += '<h2 class="label">' + part[0] + ' · ' + seenCount(ppl) + ' of ' + ppl.length + '</h2><div class="glass list">' + ppl.map(function (p) { return cell(p); }).join('') + '</div>';
    });
    return head(G.title, null, 'Close') +
      '<p class="sub" style="margin-top:-6px">' + done + ' of ' + list.length + ' visited in the last ' + odText() + '</p>' + h;
  }

  /* ---------------- phones and planned visits ---------------- */
  function digits(n) { var d = String(n || '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? d.slice(1) : d; }
  function fmtPhone(n) { var d = digits(n); return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : n || ''; }
  function brothers() {
    return S.data.publishers.filter(function (p) { return p.rank === 'Elder' || p.rank === 'Ministerial Servant'; }).sort(byName);
  }
  function plans() {
    var t = todayStr();
    return (S.data.plans || []).filter(function (x) { return x.date >= t; }).sort(function (a, b) {
      return a.date !== b.date ? (a.date < b.date ? -1 : 1) : String(a.time || '').localeCompare(String(b.time || ''));
    });
  }
  function fmtTime(t) {
    if (!t) return '';
    var p = t.split(':'), h = +p[0], m = p[1] || '00';
    return (h % 12 || 12) + ':' + m + (h < 12 ? ' AM' : ' PM');
  }
  var DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function longDate(s) { var d = parseDay(s); return DOW[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate(); }
  function joinNames(list) { return list.length < 2 ? (list[0] || '') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1]; }
  function draftText(sh) {
    var bros = sh.withIds.map(pub).filter(Boolean), visit = sh.visitIds.map(pub).filter(Boolean), m = me();
    var hi = bros.length ? 'Hi ' + joinNames(bros.map(function (b) { return firstName(b.name); })) : 'Hi';
    var whom = visit.length ? ' to see ' + joinNames(visit.map(function (p) { return p.name; })) : '';
    var when = sh.date ? ' on ' + longDate(sh.date) + (sh.time ? ' at ' + fmtTime(sh.time) : '') : '';
    return hi + ', would you be available to go on a shepherding visit with me' + whom + when + '? Let me know if that works for you. Thank you!' + (m ? ' - ' + firstName(m.name) : '');
  }
  var IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function smsLink(nums, body) {
    var b = encodeURIComponent(body);
    if (IOS) return nums.length > 1 ? 'sms:/open?addresses=' + nums.join(',') + '&body=' + b : 'sms:' + nums[0] + '&body=' + b;
    return 'sms:' + nums.join(',') + '?body=' + b;
  }
  function planCell(x) {
    var visit = (x.visitNames || []).join(', ') || 'Shepherding visit';
    var who = [x.byName].concat(x.withNames || []).filter(Boolean).join(' & ');
    var d = parseDay(x.date);
    return '<button class="cell" data-action="plan" data-id="' + esc(x.id) + '">' +
      '<span class="datechip" aria-hidden="true"><small>' + MON[d.getMonth()].slice(0, 3) + '</small><b>' + d.getDate() + '</b></span>' +
      '<span class="txt"><b>' + esc(visit) + '</b><small>' + esc(DOW[d.getDay()] + (x.time ? ' · ' + fmtTime(x.time) : '') + (who ? ' · ' + who : '')) + '</small></span>' + I.chev + '</button>';
  }
  /* The shared calendar at the bottom of Home. */
  function homeCalendar() {
    var c = S.homeCal, y = c.y, m = c.m, today = todayStr(), up = plans();
    var days = {};
    (S.data.plans || []).forEach(function (x) { days[x.date] = (days[x.date] || 0) + 1; });
    var startDow = new Date(y, m, 1).getDay(), n = new Date(y, m + 1, 0).getDate();
    var h = '<div class="cal" style="padding-top:4px"><div class="cal-head"><button class="link" data-action="hcal" data-step="-1" aria-label="Previous month">' + I.left + '</button>' +
      '<b>' + MON[m] + ' ' + y + '</b><button class="link" data-action="hcal" data-step="1" aria-label="Next month">' + I.right + '</button></div>' +
      '<div class="cal-grid">' + ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (d) { return '<span class="dow">' + d + '</span>'; }).join('');
    for (var i = 0; i < startDow; i++) h += '<span></span>';
    for (var d = 1; d <= n; d++) {
      var s = y + '-' + pad(m + 1) + '-' + pad(d);
      h += '<button data-action="plan-day" data-date="' + s + '" class="' + (s === today ? 'today ' : '') + (days[s] ? 'has' : '') + '" aria-label="' + MON[m] + ' ' + d + (days[s] ? ', ' + days[s] + ' planned' : '') + '"' +
        (s < today ? ' disabled' : '') + '>' + d + '</button>';
    }
    h += '</div></div>';
    return '<div class="glass list" id="home-cal"><div class="card-head"><h2>Upcoming visits</h2><button data-action="plan-new">Add</button></div>' + h +
      (up.length ? up.slice(0, 8).map(planCell).join('') : '<div class="empty" style="padding:6px 18px 20px"><span>No visits planned yet. Tap a day or Add to put one on the calendar for all the brothers.</span></div>') + '</div>';
  }
  function askSheet(opts) {
    var now = new Date(), d = opts && opts.date ? parseDay(opts.date) : now;
    return { type: 'ask', withIds: [], visitIds: (opts && opts.visitIds) || [], q: '', date: (opts && opts.date) || '', time: '', future: true,
      calY: d.getFullYear(), calM: d.getMonth(), text: !(opts && opts.noText), share: true, edited: false };
  }
  function sheetAsk() {
    var sh = S.sheet, bros = brothers().filter(function (b) { return b.id !== S.meId; });
        var chip = function (b) {
      var has = digits(b.phone).length >= 10;
      return '<button class="chip" data-action="ask-with" data-id="' + esc(b.id) + '" aria-pressed="' + (sh.withIds.indexOf(b.id) >= 0) + '">' + esc(b.name) + (has || !sh.text ? '' : ' <span class="nonum">no number</span>') + '</button>';
    };
    var el = bros.filter(function (b) { return b.rank === 'Elder'; }), sv = bros.filter(function (b) { return b.rank === 'Ministerial Servant'; });
    var chosen = sh.visitIds.map(pub).filter(Boolean);
    var h = head(sh.text ? 'Ask a Brother' : 'Plan a Visit', null, 'Cancel') +
      '<h2 class="label">Who would you like to go with?</h2><div class="glass">' +
      (el.length ? '<div class="chips-label">Elders</div><div class="chips">' + el.map(chip).join('') + '</div>' : '') +
      (sv.length ? '<div class="chips-label">Ministerial servants</div><div class="chips">' + sv.map(chip).join('') + '</div>' : '') + '</div>' +
      (sh.text ? sh.withIds.map(pub).filter(function (b) { return b && digits(b.phone).length < 10; }).map(function (b) {
        return '<div class="glass list"><div class="field"><label for="askph-' + esc(b.id) + '">' + esc(firstName(b.name)) + '’s phone</label>' +
          '<input id="askph-' + esc(b.id) + '" data-pid="' + esc(b.id) + '" class="ask-phone" type="tel" inputmode="tel" placeholder="(419) 555-1234" style="flex:1;min-width:0;height:42px;border:none;background:transparent;font-size:17px;text-align:right;color:var(--fg)"></div></div>';
      }).join('') : '') +
      '<h2 class="label">Who are you visiting?</h2><div class="glass list">' +
      (chosen.length ? '<div class="chips">' + chosen.map(function (p) { return '<button class="chip" data-action="ask-visit" data-id="' + esc(p.id) + '" aria-pressed="true">' + esc(p.name) + ' ✕</button>'; }).join('') + '</div>' : '') +
      '<label class="search" style="border-radius:0">' + I.search + '<span class="sr">Find a name</span><input id="ask-search" type="search" autocomplete="off" placeholder="Type a name" value="' + esc(sh.q) + '"></label>' +
      '<div id="ask-results">' + askResults() + '</div></div>' +
      '<h2 class="label">What day?</h2><div class="glass" id="cal">' + calendar() + '</div>' +
      '<div class="glass list"><div class="field"><label for="ask-time">Time (optional)</label><input id="ask-time" type="time" value="' + esc(sh.time) + '" style="height:42px;border:none;background:transparent;font-size:17px;color:var(--fg)"></div>' +
      '<label class="field" for="ask-text"><span>Send a text message</span><input class="switch" id="ask-text" type="checkbox"' + (sh.text ? ' checked' : '') + '></label>' +
      '<label class="field" for="ask-share"><span>Put on the shared calendar</span><input class="switch" id="ask-share" type="checkbox"' + (sh.share ? ' checked' : '') + '></label></div>';
    if (sh.text) h += '<h2 class="label"><label for="ask-msg">Message</label></h2><div class="glass"><textarea id="ask-msg" style="min-height:120px">' + esc(sh.edited ? sh.msg : draftText(sh)) + '</textarea></div>';
    h += '<p class="err" id="ask-err" role="alert" hidden></p>' +
      '<button class="cta" data-action="ask-send">' + (sh.text ? (sh.share ? 'Send Text & Add to Calendar' : 'Send Text') : 'Add to Calendar') + '</button>';
    return h;
  }
  function askResults() {
    var q = S.sheet.q.trim().toLowerCase();
    if (q.length < 2) return '';
    var list = S.data.publishers.filter(function (p) { return p.rank !== 'Removed' && S.sheet.visitIds.indexOf(p.id) < 0 && p.name.toLowerCase().indexOf(q) >= 0; }).sort(byName).slice(0, 6);
    return list.map(function (p) {
      return '<button class="cell" data-action="ask-visit" data-id="' + esc(p.id) + '"><span class="av" aria-hidden="true">' + esc(initials(p.name)) + '</span><span class="txt"><b>' + esc(p.name) + '</b></span>' + I.plus + '</button>';
    }).join('');
  }
  function sheetPlan(x) {
    var bros = (x.withIds || []).map(pub).filter(Boolean);
    var nums = bros.map(function (b) { return digits(b.phone); }).filter(function (n) { return n.length >= 10; });
    var h = head('Planned Visit', null, 'Close') +
      '<div class="glass list"><div class="row-plain"><span>Day</span><span>' + esc(longDate(x.date)) + (x.time ? ', ' + esc(fmtTime(x.time)) : '') + '</span></div>' +
      '<div class="row-plain"><span>Visiting</span><span>' + esc((x.visitNames || []).join(', ') || '—') + '</span></div>' +
      '<div class="row-plain"><span>Planned by</span><span>' + esc(x.byName || '—') + '</span></div>' +
      '<div class="row-plain"><span>Going with</span><span>' + esc((x.withNames || []).join(', ') || '—') + '</span></div></div>' +
      ((x.visitIds || []).length ? '<button class="cta" data-action="plan-log" data-id="' + esc(x.id) + '">' + I.plus + 'Log this visit</button>' : '') +
      (nums.length ? '<button class="quiet glass" data-action="plan-text" data-id="' + esc(x.id) + '">Text ' + esc(joinNames(bros.map(function (b) { return firstName(b.name); }))) + '</button>' : '');
    h += S.sheet.confirm
      ? '<div class="glass list"><div class="row-plain"><span>Take this off the calendar?</span></div><button class="action red" data-action="plan-delete" data-id="' + esc(x.id) + '">Remove</button><button class="action" data-action="unconfirm">Keep it</button></div>'
      : '<button class="quiet red" data-action="confirm">Remove from calendar</button>';
    return h;
  }
  function planById(id) { var l = S.data.plans || []; for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }

  /* ---------------- Talks: public talk schedule ----------------
     A year of weekends with the incoming speaker for each, and our brothers giving talks elsewhere.
     Stored in the shared "settings" collection: talk_in_YYYY-MM-DD, talk_out_<id>, talktitles, talkcfg. */
  function tDocs() { return S.data.talks || {}; }
  function tCfg() { return Object.assign({ day: 0, time: '10:00' }, tDocs().talkcfg || {}); }
  function tTitles() { return (tDocs().talktitles && tDocs().talktitles.map) || {}; }
  function tCong() { return (S.data.settings && S.data.settings.congregationName) || 'Northwood Congregation'; }
  function tShortCong() { return tCong().replace(/\s+Congregation$/i, ''); }
  function tLast(n) { var w = words(n); return w[w.length - 1] || n; }
  function tShort(s) { var d = parseDay(s); return MON[d.getMonth()].slice(0, 3) + ' ' + d.getDate(); }
  function tSpeakers() {
    return S.data.publishers.filter(function (p) { return (p.rank === 'Elder' || p.rank === 'Ministerial Servant') && !isVisitor(p); }).sort(byName);
  }
  function tIn(date) { return tDocs()['talk_in_' + date] || null; }
  function tOutAll() {
    var out = [], docs = tDocs();
    Object.keys(docs).forEach(function (k) { if (k.indexOf('talk_out_') === 0) out.push(Object.assign({ id: k }, docs[k])); });
    return out.sort(function (a, b) { return a.date !== b.date ? (a.date < b.date ? -1 : 1) : String(a.time || '').localeCompare(String(b.time || '')); });
  }
  function tWeekends(year) {
    var d = new Date(year, 0, 1), out = [], day = tCfg().day;
    while (d.getDay() !== day) d.setDate(d.getDate() + 1);
    while (d.getFullYear() === year) { out.push(ymd(d)); d.setDate(d.getDate() + 7); }
    return out;
  }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  // The meeting day of the Monday-to-Sunday week a date falls in.
  function tWeekKey(s) {
    var d = parseDay(s), back = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - back + (tCfg().day + 6) % 7);
    return ymd(d);
  }
  function tOutByWeek() {
    var map = {};
    tOutAll().forEach(function (o) { var k = tWeekKey(o.date); (map[k] = map[k] || []).push(o); });
    return map;
  }
  function tCongs() {
    var seen = {}, docs = tDocs();
    Object.keys(docs).forEach(function (k) {
      if (k.indexOf('talk_in_') === 0 && docs[k].fromCong) seen[docs[k].fromCong] = 1;
      if (k.indexOf('talk_out_') === 0 && docs[k].toCong) seen[docs[k].toCong] = 1;
    });
    return Object.keys(seen).sort();
  }
  function tLabel(t) {
    if (!t) return '';
    return [t.number ? '#' + t.number : '', t.title ? '“' + t.title + '”' : ''].filter(Boolean).join(' ');
  }
  function tFilled(t) { return !!(t && (t.type === 'none' || t.speaker)); }
  function tChip(date, past) {
    var d = parseDay(date);
    return '<span class="datechip' + (past ? ' past' : '') + '" aria-hidden="true"><small>' + MON[d.getMonth()].slice(0, 3) + '</small><b>' + d.getDate() + '</b></span>';
  }
  function tWeekRow(date, outs) {
    var t = tIn(date), past = date < todayStr(), main = null, sub = [];
    if (t && t.type === 'none') { main = t.reason || 'No public talk'; sub.push('No talk this week'); }
    else if (t && t.speaker) {
      main = t.speaker;
      sub.push(tLabel(t) || 'Talk not chosen yet');
      sub.push(t.type === 'local' ? 'Our speaker' : (t.fromCong || ''));
      if (!t.confirmed && t.type !== 'local') sub.push('Not confirmed');
    }
    var away = (outs || []).map(function (o) { var b = pub(o.brotherId); return (b ? b.name : o.brotherName || 'Brother') + (o.toCong ? ' → ' + o.toCong : ''); });
    return '<button class="cell week' + (past ? ' past' : '') + '" data-action="t-week" data-date="' + date + '">' + tChip(date, past) +
      '<span class="txt">' + (main ? '<b>' + esc(main) + '</b>' : past ? '<b>Nothing recorded</b>' : '<b class="open">Open · needs a speaker</b>') +
      (sub.filter(Boolean).length ? '<small>' + esc(sub.filter(Boolean).join(' · ')) + '</small>' : '') +
      (away.length ? '<small class="out-line">Away: ' + esc(away.join(', ')) + '</small>' : '') + '</span>' +
      (t && t.speaker && !t.confirmed && t.type !== 'local' ? '<i class="dot pend" title="Not confirmed"></i>' : '') + I.chev + '</button>';
  }
  function tOutRow(o) {
    var b = pub(o.brotherId), past = o.date < todayStr();
    return '<button class="cell' + (past ? ' past' : '') + '" data-action="t-out-edit" data-id="' + esc(o.id) + '">' + tChip(o.date, past) +
      '<span class="txt"><b>' + esc(b ? b.name : o.brotherName || 'Brother') + '</b><small>' +
      esc([o.toCong || 'Congregation not set', DOW[parseDay(o.date).getDay()].slice(0, 3) + (o.time ? ' ' + fmtTime(o.time) : ''), tLabel(o)].filter(Boolean).join(' · ')) +
      '</small></span>' + I.chev + '</button>';
  }

  function viewTalks() {
    var part = S.tPart || 'year';
    var h = '<div class="screen"><div class="top"><h1 class="title">Talks</h1><span class="sub">Public talk schedule</span></div>' +
      '<div class="seg glass" role="group" aria-label="Show">' + [['year', 'Year'], ['in', 'Incoming'], ['out', 'Outgoing']].map(function (o) {
        return '<button data-action="t-part" data-part="' + o[0] + '" aria-pressed="' + (part === o[0]) + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    if (part === 'year') h += tYearView();
    else if (part === 'in') h += tInView();
    else h += tOutView();
    h += '<button class="quiet glass" data-action="t-import">' + I.plus + ' Import talks</button><button class="quiet glass" data-action="t-settings">Talk settings</button>';
    return h + '</div>';
  }
  function tYearView() {
    var y = S.tYear, wk = tWeekends(y), byW = tOutByWeek(), today = todayStr();
    var have = wk.filter(function (d) { return tFilled(tIn(d)); }).length;
    var horizon = ymd(new Date(Date.now() + 91 * 864e5));
    var soon = wk.filter(function (d) { return d >= today && d <= horizon && !tFilled(tIn(d)); });
    var outCount = tOutAll().filter(function (o) { return o.date.slice(0, 4) === String(y); }).length;
    var h = '<div class="yearbar glass"><button class="link" data-action="t-year" data-step="-1" aria-label="Previous year">' + I.left + '</button>' +
      '<b>' + y + '</b><button class="link" data-action="t-year" data-step="1" aria-label="Next year">' + I.right + '</button></div>' +
      '<div class="duo"><div class="glass tile" style="cursor:default"><span class="tile-label">Incoming</span><b>' + have + '<small> of ' + wk.length + '</small></b>' +
      '<span class="bar"><i style="width:' + Math.round(have / wk.length * 100) + '%"></i></span><span class="tile-sub">weekends planned</span></div>' +
      '<div class="glass tile" style="cursor:default"><span class="tile-label">Outgoing</span><b>' + outCount + '</b><span class="tile-sub">talks by our brothers</span></div></div>';
    if (y === new Date().getFullYear() && soon.length) {
      h += '<button class="cta" data-action="t-week" data-date="' + soon[0] + '">' + I.plus + 'Fill ' + esc(longDate(soon[0])) + '</button>' +
        '<p class="foot" style="margin-top:-8px">' + soon.length + (soon.length === 1 ? ' weekend' : ' weekends') + ' in the next 3 months still need a speaker.</p>';
    }
    for (var m = 0; m < 12; m++) {
      var days = wk.filter(function (d) { return +d.slice(5, 7) === m + 1; });
      if (days.length) h += '<h2 class="label" id="tm-' + m + '">' + MON[m] + '</h2><div class="glass list">' + days.map(function (d) { return tWeekRow(d, byW[d]); }).join('') + '</div>';
    }
    return h + '<button class="quiet glass" data-action="t-copy">Copy the ' + y + ' schedule</button>';
  }
  function tInView() {
    var today = todayStr(), y = new Date().getFullYear();
    var list = tWeekends(y).concat(tWeekends(y + 1)).filter(function (d) { return d >= today; });
    var planned = list.filter(function (d) { return tFilled(tIn(d)); }).slice(0, 30);
    var open = list.filter(function (d) { return !tFilled(tIn(d)); }).slice(0, 12);
    return '<button class="quiet glass" data-action="t-import" data-dir="in">' + I.plus + ' Import incoming speakers</button><h2 class="label">Needs a speaker</h2>' + (open.length ? '<div class="glass list">' + open.map(function (d) { return tWeekRow(d, []); }).join('') + '</div>'
      : '<div class="glass empty"><b>All set</b><span>Every coming weekend has a speaker.</span></div>') +
      '<h2 class="label">Coming up</h2>' + (planned.length ? '<div class="glass list">' + planned.map(function (d) { return tWeekRow(d, []); }).join('') + '</div>'
      : '<div class="glass empty"><span>No incoming speakers planned yet.</span></div>');
  }
  function tOutView() {
    var today = todayStr(), all = tOutAll();
    var up = all.filter(function (o) { return o.date >= today; }), past = all.filter(function (o) { return o.date < today; }).reverse().slice(0, 15);
    var h = '<button class="cta" data-action="t-out-new">' + I.plus + 'Assign an outgoing talk</button>' +
      '<button class="quiet glass" data-action="t-import" data-dir="out">' + I.plus + ' Import outgoing speakers</button>' +
      '<h2 class="label">Coming up</h2>' + (up.length ? '<div class="glass list">' + up.map(tOutRow).join('') + '</div>'
      : '<div class="glass empty"><span>No outgoing talks planned yet.</span></div>');
    if (past.length) h += '<h2 class="label">Recently given</h2><div class="glass list">' + past.map(tOutRow).join('') + '</div>';
    return h;
  }

  function tHead(title, right, back) {
    return '<div class="grab" aria-hidden="true"></div><div class="sheet-head"><button class="link" data-action="' + (back ? 't-back' : 'close') + '" style="justify-self:start">' + (back ? 'Cancel' : 'Close') + '</button>' +
      '<h2 id="sheet-title">' + esc(title) + '</h2>' + (right || '<span></span>') + '</div>';
  }
  function sheetTWeek(date) {
    var t = tIn(date), outs = tOutByWeek()[date] || [], c = tCfg();
    var h = tHead(longDate(date)) + '<p class="sub" style="margin-top:-8px">' + esc(tShortCong()) + ' meeting at ' + esc(fmtTime(c.time)) + '</p><h2 class="label">Incoming</h2>';
    if (t && t.type === 'none') {
      h += '<div class="glass list"><div class="row-plain"><span>No public talk</span><span>' + esc(t.reason || '') + '</span></div>' +
        '<button class="action" data-action="t-in-edit" data-date="' + date + '">Change</button></div>';
    } else if (t && t.speaker) {
      var num = digits(t.phone);
      h += '<div class="glass list"><div class="row-plain"><span>Speaker</span><span>' + esc(t.speaker) + '</span></div>' +
        '<div class="row-plain"><span>From</span><span>' + esc(t.type === 'local' ? 'Our congregation' : (t.fromCong || '—')) + '</span></div>' +
        '<div class="row-plain"><span>Talk</span><span>' + esc(tLabel(t) || 'Not chosen yet') + '</span></div>' +
        (t.type !== 'local' ? '<div class="row-plain"><span>Confirmed</span><span>' + (t.confirmed ? 'Yes' : '<span class="flag">Not yet</span>') + '</span></div>' : '') +
        (num.length >= 10 ? '<div class="row-plain"><span>Phone</span><span>' + esc(fmtPhone(num)) + '</span></div>' : '') +
        (t.notes ? '<div class="row-plain" style="white-space:pre-wrap"><span>Notes</span><span>' + esc(t.notes) + '</span></div>' : '') +
        '<button class="action" data-action="t-in-edit" data-date="' + date + '">Edit</button>' +
        (num.length >= 10 ? '<button class="action" data-action="t-in-text" data-date="' + date + '">Text ' + esc(t.type === 'local' ? firstName(t.speaker) : 'Brother ' + tLast(t.speaker)) + ' to confirm</button>' : '') + '</div>';
    } else {
      h += '<button class="cta" data-action="t-in-edit" data-date="' + date + '">' + I.plus + 'Assign the speaker</button>';
    }
    return h + '<h2 class="label">Our brothers away</h2>' + (outs.length ? '<div class="glass list">' + outs.map(tOutRow).join('') + '</div>' : '') +
      '<button class="quiet glass" data-action="t-out-new" data-date="' + date + '">' + I.plus + ' Add an outgoing talk</button>';
  }
  function sheetTIn(sh) {
    var t = tIn(sh.date) || {}, kind = sh.kind, cs = tCongs();
    var h = tHead(tShort(sh.date) + ' · Incoming', '<button class="link" data-action="t-in-save">Save</button>', true) +
      '<div class="seg glass" role="group" aria-label="Kind">' + [['visitor', 'Visiting'], ['local', 'Our speaker'], ['none', 'No talk']].map(function (o) {
        return '<button data-action="t-in-kind" data-kind="' + o[0] + '" aria-pressed="' + (kind === o[0]) + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    if (kind === 'none') {
      h += '<div class="glass list"><div class="field"><label for="ti-reason">Why</label><input id="ti-reason" type="text" list="t-reasons" value="' + esc(t.reason || '') + '" placeholder="e.g. Circuit assembly"></div></div>' +
        '<datalist id="t-reasons"><option value="Circuit overseer visit"></option><option value="Circuit assembly"></option><option value="Regional convention"></option><option value="Memorial week"></option><option value="Special talk"></option></datalist>';
    } else {
      if (kind === 'local') {
        h += '<h2 class="label">Which brother?</h2><div class="glass"><div class="chips">' + tSpeakers().map(function (b) {
          return '<button class="chip" data-action="t-in-local" data-id="' + esc(b.id) + '" aria-pressed="' + (sh.localId === b.id) + '">' + esc(b.name) + '</button>';
        }).join('') + '</div></div>';
      }
      var vis = kind === 'visitor';
      h += '<div class="glass list">' +
        (vis ? '<div class="field"><label for="ti-speaker">Speaker</label><input id="ti-speaker" type="text" value="' + esc(t.type === 'visitor' ? t.speaker || '' : '') + '" placeholder="Full name" autocomplete="off"></div>' +
          '<div class="field"><label for="ti-cong">From</label><input id="ti-cong" type="text" list="t-congs" value="' + esc(t.fromCong || '') + '" placeholder="Congregation"></div>' : '') +
        '<div class="field"><label for="ti-num">Talk number</label><input id="ti-num" type="text" inputmode="numeric" value="' + esc(t.number || '') + '" placeholder="#" style="max-width:120px"></div>' +
        '<div class="field"><label for="ti-title">Title</label><input id="ti-title" type="text" value="' + esc(t.title || '') + '" placeholder="Talk title"></div>' +
        (vis ? '<div class="field"><label for="ti-phone">Phone</label><input id="ti-phone" type="text" inputmode="tel" value="' + esc(fmtPhone(t.phone || '')) + '" placeholder="(419) 555-1234"></div>' +
          '<label class="field" for="ti-ok"><span>Confirmed</span><input class="switch" id="ti-ok" type="checkbox"' + (t.confirmed ? ' checked' : '') + '></label>' : '') + '</div>' +
        '<h2 class="label"><label for="ti-notes">Notes</label></h2><div class="glass"><textarea id="ti-notes" style="min-height:90px" placeholder="Hospitality, who is hosting lunch, anything to remember">' + esc(t.notes || '') + '</textarea></div>' +
        '<datalist id="t-congs">' + cs.map(function (c) { return '<option value="' + esc(c) + '"></option>'; }).join('') + '</datalist>';
    }
    h += '<p class="err" id="ti-err" role="alert" hidden></p><button class="cta" data-action="t-in-save">Save</button>';
    if (tIn(sh.date)) {
      h += sh.confirm ? '<div class="glass list"><div class="row-plain"><span>Clear this weekend?</span></div><button class="action red" data-action="t-in-delete">Clear</button><button class="action" data-action="t-unconfirm">Keep</button></div>'
        : '<button class="quiet red" data-action="t-confirm">Clear this weekend</button>';
    }
    return h;
  }
  function sheetTOut(sh) {
    var o = sh.id ? tDocs()[sh.id] || {} : {}, cs = tCongs(), wk = tWeekKey(sh.date || o.date || todayStr());
    var h = tHead(sh.id ? 'Outgoing Talk' : 'New Outgoing Talk', '<button class="link" data-action="t-out-save">Save</button>', true) +
      '<h2 class="label">Which brother?</h2><div class="glass"><div class="chips">' + tSpeakers().map(function (b) {
        return '<button class="chip" data-action="t-out-bro" data-id="' + esc(b.id) + '" aria-pressed="' + (sh.brotherId === b.id) + '">' + esc(b.name) + '</button>';
      }).join('') + '</div></div>';
    if (sh.brotherId) {
      var clash = tOutAll().some(function (x) { return x.id !== sh.id && x.brotherId === sh.brotherId && tWeekKey(x.date) === wk; });
      var home = tIn(wk); home = home && home.type === 'local' && home.localId === sh.brotherId;
      if (clash || home) h += '<p class="err" style="margin:0">' + (clash ? 'He already has an outgoing talk that weekend.' : 'He is giving the talk here that weekend.') + '</p>';
    }
    h += '<div class="glass list">' +
      '<div class="field"><label for="to-cong">Congregation</label><input id="to-cong" type="text" list="t-congs" value="' + esc(o.toCong || '') + '" placeholder="Where he is going"></div>' +
      '<div class="field"><label for="to-date">Date</label><input id="to-date" type="date" value="' + esc(sh.date || o.date || '') + '" style="height:42px;border:none;background:transparent;font-size:17px;color:var(--fg)"></div>' +
      '<div class="field"><label for="to-time">Time</label><input id="to-time" type="time" value="' + esc(o.time || '') + '" style="height:42px;border:none;background:transparent;font-size:17px;color:var(--fg)"></div>' +
      '<div class="field"><label for="to-num">Talk number</label><input id="to-num" type="text" inputmode="numeric" value="' + esc(o.number || '') + '" placeholder="#" style="max-width:120px"></div>' +
      '<div class="field"><label for="to-title">Title</label><input id="to-title" type="text" value="' + esc(o.title || '') + '" placeholder="Talk title"></div></div>' +
      '<h2 class="label"><label for="to-notes">Address and notes</label></h2><div class="glass"><textarea id="to-notes" style="min-height:90px" placeholder="Kingdom Hall address, who to contact">' + esc(o.notes || '') + '</textarea></div>' +
      '<datalist id="t-congs">' + cs.map(function (c) { return '<option value="' + esc(c) + '"></option>'; }).join('') + '</datalist>' +
      '<p class="err" id="to-err" role="alert" hidden></p><button class="cta" data-action="t-out-save">Save</button>';
    if (sh.id) {
      var b = pub(o.brotherId);
      if (b && digits(b.phone).length >= 10) h += '<button class="quiet glass" data-action="t-out-text">' + I.chat + ' Text ' + esc(firstName(b.name)) + ' a reminder</button>';
      h += sh.confirm ? '<div class="glass list"><div class="row-plain"><span>Remove this talk?</span></div><button class="action red" data-action="t-out-delete">Remove</button><button class="action" data-action="t-unconfirm">Keep</button></div>'
        : '<button class="quiet red" data-action="t-confirm">Remove</button>';
    }
    return h;
  }
  function sheetTSettings() {
    var c = tCfg(), n = Object.keys(tTitles()).length;
    return tHead('Talk Settings') +
      '<div class="glass list"><div style="padding:12px 18px;display:flex;flex-direction:column;gap:8px"><span>Public meeting day</span><div class="seg" role="group" aria-label="Meeting day">' +
      [[6, 'Saturday'], [0, 'Sunday']].map(function (o) { return '<button data-action="t-day" data-day="' + o[0] + '" aria-pressed="' + (c.day === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="field"><label for="t-time">Meeting time</label><input id="t-time" type="time" value="' + esc(c.time) + '" style="height:42px;border:none;background:transparent;font-size:17px;color:var(--fg)"></div></div>' +
      '<h2 class="label">Talk titles · ' + n + ' saved</h2><div class="glass"><textarea id="t-titles" style="min-height:200px" placeholder="One talk per line, number first:&#10;1 First title&#10;2 Second title"></textarea></div>' +
      '<p class="foot" style="text-align:left;margin-top:-8px">Paste your list of talk outlines here. After that, typing a talk number fills in its title.</p>' +
      '<p class="err" id="ts-err" role="alert" hidden></p><button class="cta" data-action="t-titles-save">Save titles</button>';
  }
  function tScheduleText(y) {
    var c = tCfg(), byW = tOutByWeek(), lines = [tCong() + ' public talks ' + y, ''];
    tWeekends(y).forEach(function (d) {
      var t = tIn(d), line = tShort(d) + ': ';
      if (t && t.type === 'none') line += t.reason || 'No public talk';
      else if (t && t.speaker) line += t.speaker + (t.type !== 'local' && t.fromCong ? ' (' + t.fromCong + ')' : '') + (tLabel(t) ? ' ' + tLabel(t) : '');
      else line += 'Open';
      (byW[d] || []).forEach(function (o) { var b = pub(o.brotherId); line += '\n    Away: ' + (b ? b.name : 'Brother') + (o.toCong ? ' at ' + o.toCong : ''); });
      lines.push(line);
    });
    return lines.join('\n') + '\n\nMeeting at ' + fmtTime(c.time) + '.';
  }
  function sheetTCopy(y) {
    return tHead(y + ' Schedule') + '<div class="glass"><textarea id="t-copy-text" readonly style="min-height:320px;font-size:15px">' + esc(tScheduleText(y)) + '</textarea></div>' +
      '<button class="cta" data-action="t-copy-now">Copy</button>';
  }
  // Keep typed values when an edit card redraws (choosing a kind or a brother).
  function tKeep() {
    var sh = S.sheet; if (!sh) return;
    sh.kept = sh.kept || {};
    ['ti-speaker', 'ti-cong', 'ti-num', 'ti-title', 'ti-phone', 'ti-notes', 'ti-reason', 'to-cong', 'to-date', 'to-time', 'to-num', 'to-title', 'to-notes'].forEach(function (i) {
      var el = document.getElementById(i); if (el) sh.kept[i] = el.value;
    });
    var ok = document.getElementById('ti-ok'); if (ok) sh.kept['ti-ok'] = ok.checked;
  }
  function tRestore() {
    var k = S.sheet && S.sheet.kept; if (!k) return;
    Object.keys(k).forEach(function (i) { var el = document.getElementById(i); if (!el) return; if (el.type === 'checkbox') el.checked = k[i]; else el.value = k[i]; });
  }
  function tRedraw() { tKeep(); renderSheet(); tRestore(); }
  function tVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function tSaveTitle(num, title) {
    var map = tTitles();
    if (!num || !title || map[num] === title) return Promise.resolve();
    var next = Object.assign({}, map); next[num] = title;
    return store.putTalk('talktitles', { map: next });
  }
  function tFillTitle(numId, titleId) {
    var t = tTitles()[tVal(numId).replace(/\D/g, '')], el = document.getElementById(titleId);
    if (t && el && !el.dataset.typed) el.value = t;
  }
  function tBack() { var b = S.sheet && S.sheet.back; if (b) swapSheet(b); else closeSheet(); }
  var TA = {
    't-part': function (el) { S.tPart = el.dataset.part; render(); },
    't-year': function (el) { S.tYear += +el.dataset.step; render(); },
    't-week': function (el) { openSheet({ type: 't-week', date: el.dataset.date }); },
    't-back': function () { tBack(); },
    't-confirm': function () { S.sheet.confirm = true; tRedraw(); },
    't-unconfirm': function () { S.sheet.confirm = false; tRedraw(); },
    't-settings': function () { openSheet({ type: 't-settings' }); },
    't-in-edit': function (el) {
      var t = tIn(el.dataset.date) || {}, sh = { type: 't-in', date: el.dataset.date, kind: t.type || 'visitor', localId: t.localId || '', back: S.sheet && S.sheet.type === 't-week' ? S.sheet : null };
      if (S.sheet) swapSheet(sh); else openSheet(sh);
    },
    't-in-kind': function (el) { S.sheet.kind = el.dataset.kind; tRedraw(); },
    't-in-local': function (el) { S.sheet.localId = el.dataset.id; tRedraw(); },
    't-in-save': function () {
      var sh = S.sheet, body = { type: sh.kind, date: sh.date };
      if (sh.kind === 'none') body.reason = tVal('ti-reason') || 'No public talk';
      else {
        if (sh.kind === 'local') {
          var b = pub(sh.localId);
          if (!b) return showErr('ti-err', 'Tap the brother giving the talk.');
          body.speaker = b.name; body.localId = b.id; body.phone = digits(b.phone); body.confirmed = true;
        } else {
          body.speaker = tVal('ti-speaker').replace(/\s+/g, ' ');
          if (!body.speaker) return showErr('ti-err', 'Type the speaker\'s name.');
          body.fromCong = tVal('ti-cong'); body.phone = digits(tVal('ti-phone'));
          body.confirmed = !!(document.getElementById('ti-ok') || {}).checked;
        }
        body.number = tVal('ti-num').replace(/\D/g, ''); body.title = tVal('ti-title'); body.notes = tVal('ti-notes');
      }
      store.putTalk('talk_in_' + sh.date, body).then(function () { return tSaveTitle(body.number, body.title); })
        .then(function () { tBack(); toast('Saved'); }, function (e) { showErr('ti-err', window.EmbraceStore.friendly(e)); });
    },
    't-in-delete': function () { store.removeTalk('talk_in_' + S.sheet.date).then(function () { tBack(); toast('Weekend cleared'); }); },
    't-in-text': function (el) {
      var t = tIn(el.dataset.date), m = me(); if (!t) return;
      var body = (t.type === 'local' ? 'Hi ' + firstName(t.speaker) : 'Hi Brother ' + tLast(t.speaker)) + ', ' +
        (m && t.type !== 'local' ? 'this is ' + m.name + ' from the ' + tCong() + '. ' : '') +
        'Just confirming your public talk' + (t.type === 'local' ? '' : ' with us') + ' on ' + longDate(t.date) + ' at ' + fmtTime(tCfg().time) +
        (tLabel(t) ? ': ' + tLabel(t) : '') + '. Thank you!' + (m && t.type === 'local' ? ' - ' + firstName(m.name) : '');
      window.location.href = smsLink([digits(t.phone)], body);
    },
    't-out-new': function (el) {
      var sh = { type: 't-out', id: null, date: el.dataset.date || '', brotherId: '', back: S.sheet && S.sheet.type === 't-week' ? S.sheet : null };
      if (S.sheet) swapSheet(sh); else openSheet(sh);
    },
    't-out-edit': function (el) {
      var o = tDocs()[el.dataset.id] || {}, sh = { type: 't-out', id: el.dataset.id, date: o.date, brotherId: o.brotherId || '', back: S.sheet && S.sheet.type === 't-week' ? S.sheet : null };
      if (S.sheet) swapSheet(sh); else openSheet(sh);
    },
    't-out-bro': function (el) { S.sheet.brotherId = el.dataset.id; tRedraw(); },
    't-out-save': function () {
      var sh = S.sheet, b = pub(sh.brotherId), date = tVal('to-date');
      if (!b) return showErr('to-err', 'Tap the brother giving the talk.');
      if (!date) return showErr('to-err', 'Pick the date.');
      var body = { brotherId: b.id, brotherName: b.name, toCong: tVal('to-cong'), date: date, time: tVal('to-time'),
        number: tVal('to-num').replace(/\D/g, ''), title: tVal('to-title'), notes: tVal('to-notes') };
      store.putTalk(sh.id || 'talk_out_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), body)
        .then(function () { return tSaveTitle(body.number, body.title); })
        .then(function () { tBack(); toast('Saved'); }, function (e) { showErr('to-err', window.EmbraceStore.friendly(e)); });
    },
    't-out-delete': function () { store.removeTalk(S.sheet.id).then(function () { tBack(); toast('Removed'); }); },
    't-out-text': function () {
      var o = tDocs()[S.sheet.id], b = o && pub(o.brotherId), m = me(); if (!b) return;
      var body = 'Hi ' + firstName(b.name) + ', reminder: your public talk' + (tLabel(o) ? ' ' + tLabel(o) : '') + (o.toCong ? ' at ' + o.toCong : '') +
        ' is on ' + longDate(o.date) + (o.time ? ' at ' + fmtTime(o.time) : '') + '.' + (o.notes ? ' ' + o.notes : '') + ' Thank you!' + (m ? ' - ' + firstName(m.name) : '');
      window.location.href = smsLink([digits(b.phone)], body);
    },
    't-day': function (el) {
      var c = tCfg(); c.day = +el.dataset.day;
      store.putTalk('talkcfg', { day: c.day, time: c.time }).then(function () { renderSheet(); });
    },
    't-titles-save': function () {
      var map = Object.assign({}, tTitles()), n = 0;
      tVal('t-titles').split(/\r?\n/).forEach(function (line) {
        var mm = /^\s*#?(\d{1,3})[\s.:)\-–]+(.+?)\s*$/.exec(line);
        if (mm) { map[String(+mm[1])] = mm[2].replace(/^["“]|["”]$/g, ''); n++; }
      });
      if (!n) return showErr('ts-err', 'Put the talk number first on each line, then the title.');
      store.putTalk('talktitles', { map: map }).then(function () { renderSheet(); toast(n + (n === 1 ? ' title saved' : ' titles saved')); });
    },
    't-copy': function () { openSheet({ type: 't-copy', year: S.tYear }); },
    't-copy-now': function () {
      var ta = document.getElementById('t-copy-text');
      var sel = function () { ta.focus(); ta.select(); toast('Selected. Use Copy from your menu.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(function () { toast('Copied'); }, sel);
      else sel();
    }
  };

  /* ---------------- main views ---------------- */
  function viewHome() {
    var m = me(), cong = (S.data.settings && S.data.settings.congregationName) || 'Northwood Congregation';
    var all = flock(), counts = { fresh: 0, soon: 0, late: 0, none: 0 };
    all.forEach(function (p) { counts[homeState(p)]++; });
    var seen = counts.fresh + counts.soon;
    var next = needOrder(all.filter(function (p) { return state(p) !== 'fresh'; })).slice(0, 3);
    var follow = S.data.publishers.filter(function (p) { var l = last(p); return l && l.followUp; }).sort(byNeed);
    var recent = S.data.visits.slice().sort(visitOrder).slice(0, 3);

    var h = '<div class="screen home">' +
      '<div class="top rise"><span class="hello">' + greeting() + (m ? ', ' + esc(firstName(m.name)) : '') + '</span><h1 class="brand">Embrace</h1>' + (cong ? '<span class="sub">' + esc(cong) + '</span>' : '') + '</div>';
    // Until the congregation's list is in, the first thing on Home is the button to bring it in.
    if (S.data.publishers.length < 10) {
      h += '<div class="glass empty rise">' + sheep(70, 'bob') + '<b>Bring in your publishers</b>' +
        '<span>Tap below and choose the roster file (embrace-roster.csv). Everyone will appear here at once.</span>' +
        '<button class="cta" data-action="import-pick" style="margin-top:8px">Import publisher list</button>' +
        '<input id="import-file" type="file" accept=".csv,text/csv,text/plain,text/comma-separated-values,*/*" hidden></div>';
      if (!all.length) return h + '</div>';
    }
    h += '<div class="home-left"><div class="ring-wrap rise"><div class="ring-float"><div class="ring-glow"></div>' + ringSvg(counts, all.length) +
      '<div class="ring-center"><b>' + seen + '</b><span>of ' + all.length + ' visited in the last ' + odText() + '</span></div></div></div>' +
      '<div class="legend rise">' + ORDER.map(function (k) {
        return '<button class="key glass" data-action="status" data-st="' + k + '"><i style="background:' + STATUS[k].color + '"></i><span>' + STATUS[k].label + '</span><b>' + counts[k] + '</b></button>';
      }).join('') + '</div>' +
      '<button class="cta rise" data-action="log-start">' + I.plus + 'Log a Visit</button>' +
      '</div><div class="home-right">';
    var tiles = ['pioneers', 'appointed', 'publishers', 'inactive'].filter(function (g) { return members(g).length; });
    if (tiles.length) h += '<div class="duo rise">' + tiles.map(tile).join('') + '</div>';
    if (follow.length) {
      h += '<div class="glass list"><div class="card-head"><h2>Needs a follow-up</h2></div>' + follow.slice(0, 5).map(function (p) { return cell(p); }).join('') + '</div>';
    }
    if (next.length) {
      h += '<div class="glass list"><div class="card-head"><h2>Next to visit</h2><button data-action="tab" data-tab="flock">See all</button></div>' +
        next.map(function (p) { return cell(p); }).join('') + '</div>';
    }
    h += '<div class="glass list"><div class="card-head"><h2>Recent visits</h2>' + (recent.length ? '<button data-action="all-visits">See all</button>' : '') + '</div>' +
      (recent.length ? recent.map(function (v) { return noteRow(v, true); }).join('') : '<div class="empty" style="padding:8px 18px 22px"><span>No visits yet. Tap Log a Visit to add the first one.</span></div>') + '</div>';
    return h + '</div></div>';
  }

  function flockList() {
    var all = S.data.publishers.filter(function (p) { return !isVisitor(p); });
    if (!all.length) return empty('No publishers yet', 'Add your publisher list in Settings.');
    var q = S.query.trim().toLowerCase();
    var list = all.filter(function (p) { return (S.group === 'all' || (p.group || '') === S.group) && (!q || p.name.toLowerCase().indexOf(q) >= 0); });
    if (!list.length) return empty('No one found', q ? 'No name matches "' + S.query.trim() + '".' : 'No one in this group yet.');
    if (q) return '<div class="glass list">' + needOrder(list).map(function (p) { return cell(p); }).join('') + '</div>';
    var h = '';
    if (S.mode === 'priority') {
      h += block('Pioneers & appointed', list.filter(isPriority).sort(byNeed));
      h += block('Publishers', list.filter(function (p) { return isActive(p) && !isPriority(p); }).sort(byNeed));
      h += block('Inactive', list.filter(function (p) { return p.rank === 'Inactive'; }).sort(byNeed));
      h += block('Removed', list.filter(function (p) { return p.rank === 'Removed'; }).sort(byNeed));
    } else if (S.mode === 'families') {
      h += familyBlocks(list);
    } else {
      var g = {};
      list.forEach(function (p) { (g[p.group || 'No group'] = g[p.group || 'No group'] || []).push(p); });
      Object.keys(g).sort(function (a, b) { return a === 'No group' ? 1 : b === 'No group' ? -1 : a.localeCompare(b); })
        .forEach(function (k) { h += fold('grp:' + k, k === 'No group' ? k : k + ' group', g[k].sort(byNeed)); });
    }
    return h;
  }
  /* A folded section: shows its name and visited count; tap to open. */
  function fold(key, title, ppl) {
    var open = !!S.open[key], done = seenCount(ppl);
    return '<div class="glass list fold' + (open ? ' open' : '') + '"><button class="cell fold-head" data-action="fold" data-key="' + esc(key) + '" aria-expanded="' + open + '">' +
      '<span class="txt"><b>' + esc(title) + '</b><small>' + done + ' of ' + ppl.length + ' visited</small></span>' +
      '<span class="fold-bar" aria-hidden="true"><i style="width:' + Math.round(done / ppl.length * 100) + '%"></i></span>' +
      '<svg class="fold-chev" width="14" height="9" viewBox="0 0 14 9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1.5l6 6 6-6"/></svg></button>' +
      (open ? ppl.map(function (p) { return cell(p); }).join('') : '') + '</div>';
  }

  /* Families: people who share a last name in the same field service group. */
  function familyBlocks(list) {
    var fam = {};
    list.forEach(function (p) {
      var key = lastName(p.name) + '|' + (p.group || '');
      (fam[key] = fam[key] || []).push(p);
    });
    var keys = Object.keys(fam), many = keys.filter(function (k) { return fam[k].length > 1; }), ones = [];
    keys.forEach(function (k) { if (fam[k].length === 1) ones.push(fam[k][0]); });
    many.sort(function (a, b) { return a.localeCompare(b); });
    var h = many.map(function (k) {
      var ppl = fam[k].slice().sort(function (a, b) { return byNeed(a, b); });
      var surname = words(ppl[0].name).slice(-1)[0] || ppl[0].name;
      var grp = ppl[0].group ? ' · ' + ppl[0].group + ' group' : '';
      return fold('fam:' + k, surname + ' family' + grp, ppl);
    }).join('');
    if (ones.length) h += fold('fam:individuals', 'Individuals', ones.sort(byName));
    return h;
  }

  function viewFlock() {
    var opts = '<option value="all">All groups</option>' + idx.groups.map(function (g) {
      return '<option value="' + esc(g) + '"' + (S.group === g ? ' selected' : '') + '>' + esc(g) + '</option>';
    }).join('');
    return '<div class="screen"><div class="top"><h1 class="title">The Flock</h1><span class="sub">' + S.data.publishers.length + ' people · longest wait first</span></div>' +
      '<label class="search glass">' + I.search + '<span class="sr">Find a name</span><input id="search" type="search" autocomplete="off" placeholder="Find a name" value="' + esc(S.query) + '"></label>' +
      '<div class="filters"><div class="seg glass" role="group" aria-label="Sort">' +
      '<button data-action="mode" data-mode="everyone" aria-pressed="' + (S.mode === 'everyone') + '">Groups</button>' +
      '<button data-action="mode" data-mode="priority" aria-pressed="' + (S.mode === 'priority') + '">All</button>' +
      '<button data-action="mode" data-mode="families" aria-pressed="' + (S.mode === 'families') + '">Families</button></div>' +
      (idx.groups.length ? '<select class="pick glass" id="group-pick" aria-label="Field service group">' + opts + '</select>' : '') + '</div>' +
      '<div id="results" style="display:flex;flex-direction:column;gap:18px">' + flockList() + '</div></div>';
  }

  function viewPerson(p) {
    var vs = idx.byPub[p.id] || [], l = vs[0], w = l ? daysSince(l.date) : null, st = homeState(p);
    var t = titles(p);
    var sub = (t.length ? t : ['Publisher']).concat(p.group ? [p.group + ' group'] : []).join(' · ');
    var frac = w === null ? 1 : Math.min(1, Math.max(0.02, w / od()));
    var arc = '<svg class="arc" viewBox="0 0 116 116" aria-hidden="true"><circle cx="58" cy="58" r="54" fill="none" stroke="var(--fill)" stroke-width="5"/>' +
      '<circle cx="58" cy="58" r="54" fill="none" stroke="' + STATUS[st].color + '" stroke-width="5" stroke-linecap="round" pathLength="100" stroke-dasharray="' + (frac * 100) + ' 100"/></svg>';
    return '<div class="screen">' +
      '<div class="nav"><button class="link" data-action="back">' + I.back + ' Back</button><button class="link" data-action="edit" data-id="' + esc(p.id) + '">Edit</button></div>' +
      '<div class="glass hero rise"><span class="av big" aria-hidden="true">' + arc + esc(initials(p.name)) + '</span><h1>' + esc(p.name) + '</h1><p>' + esc(sub) + '</p>' +
      (p.note ? '<p>' + esc(p.note) + '</p>' : '') +
      '<div class="stat-row"><div class="stat"><small>Last visit</small><b>' + (l ? esc(fmtDate(l.date)) : 'Never') + '</b></div>' +
      '<div class="stat"><small>Days since visit</small><b style="color:' + (st === 'none' ? 'var(--st-late)' : STATUS[st].color) + '">' +
      (w === null ? '—' : w <= 0 ? 'Today' : w + (w === 1 ? ' day' : ' days')) + '</b></div></div></div>' +
      '<button class="cta rise" data-action="log" data-id="' + esc(p.id) + '">' + I.plus + 'Log a Visit</button>' +
      (digits(p.phone).length >= 10 ? '<div class="duo"><a class="pill-search glass" href="tel:' + digits(p.phone) + '" style="text-decoration:none;color:var(--accent);font-weight:600;justify-content:center">' + I.phone + 'Call</a>' +
        '<a class="pill-search glass" href="sms:' + digits(p.phone) + '" style="text-decoration:none;color:var(--accent);font-weight:600;justify-content:center">' + I.chat + 'Text</a></div>' +
        '<p class="foot" style="margin-top:-8px">' + esc(fmtPhone(p.phone)) + '</p>' : '') +
      (vs.length ? '<div class="glass list"><div class="card-head"><h2>Visits</h2></div>' + vs.map(function (v) { return noteRow(v, false); }).join('') + '</div>'
        : '<div class="glass empty"><span>No visits yet.</span></div>') +
      '<p class="foot">Notes are seen only by the elders.</p></div>';
  }

  function viewUpcoming() {
    return '<div class="screen"><div class="top"><h1 class="title">Upcoming</h1><span class="sub">Shepherding visits the brothers have planned</span></div>' +
      '<button class="cta rise" data-action="ask">' + I.chat + 'Ask a brother</button>' + homeCalendar() + '</div>';
  }

  function viewSettings() {
    var m = me(), cong = (S.data.settings && S.data.settings.congregationName) || 'Northwood Congregation', els = elders();
    var svs = S.data.publishers.filter(function (p) { return p.rank === 'Ministerial Servant'; }).sort(byName);
    var h = '<div class="screen"><div class="top"><h1 class="title">Settings</h1></div>' +
      '<div class="glass list">' +
      (m ? '<div class="cell"><span class="av" aria-hidden="true">' + esc(initials(m.name)) + '</span><span class="txt"><b>' + esc(m.name) + '</b><small>Using Embrace on this phone</small></span></div>' : '') +
      (m ? '<div class="field"><label for="s-phone">Your phone</label><input id="s-phone" type="text" inputmode="tel" value="' + esc(fmtPhone(m.phone || '')) + '" placeholder="(419) 555-1234"></div>' : '') +
      '<button class="action" data-action="switch">Not you? Choose your name</button></div>' +
      '<h2 class="label">Congregation</h2><div class="glass list">' +
      '<div class="field"><label for="s-cong">Name</label><input id="s-cong" type="text" value="' + esc(cong) + '" placeholder="Congregation name"></div>' +
      '<div class="field"><label for="s-od">Visit every</label><select id="s-od">' + [[90, '3 months'], [120, '4 months'], [180, '6 months'], [365, '1 year']].map(function (o) {
        return '<option value="' + o[0] + '"' + (od() === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></div></div>' +
      '<h2 class="label">Elders · ' + els.length + '</h2><div class="glass list">' + els.map(function (p) { return cell(p); }).join('') +
      '<button class="action" data-action="assign" data-rank="Elder">Mark someone as an elder</button></div>' +
      '<p class="foot" style="text-align:left;margin-top:-8px">Elders can pick their name the first time they open Embrace.</p>' +
      '<h2 class="label">Ministerial servants · ' + svs.length + '</h2><div class="glass list">' + svs.map(function (p) { return cell(p); }).join('') +
      '<button class="action" data-action="assign" data-rank="Ministerial Servant">Mark someone as a servant</button></div>' +
      '<p class="foot" style="text-align:left;margin-top:-8px">Elders and servants can be picked under "Who went with you?"</p>' +
      '<h2 class="label">Publishers</h2><div class="glass list">' +
      '<button class="action" data-action="new">Add a person</button>' +
      '<button class="action" data-action="import-pick">Import a list (CSV)</button>' +
      '<div class="row-plain"><span>Total</span><span>' + S.data.publishers.length + '</span></div></div>' +
      '<input id="import-file" type="file" accept=".csv,text/csv,text/plain" hidden>';
    if (store.mode === 'live') h += '<div class="glass list"><button class="action" data-action="code-change">Change congregation code</button></div>';
    else h += '<div class="glass list">' + (S.confirmReset
      ? '<div class="row-plain"><span>Erase everything in this preview?</span></div><button class="action red" data-action="do-reset">Erase preview</button><button class="action" data-action="cancel-reset">Keep it</button>'
      : '<button class="action red" data-action="reset">Reset preview</button>') + '</div>';
    return h + '<p class="foot">Embrace ' + VERSION + (store.mode === 'demo' ? ' · Preview: changes stay on this phone' : '') + '</p></div>';
  }

  /* ---------------- first open ---------------- */
  function pinBoxes(v) {
    var h = '';
    for (var i = 0; i < 4; i++) h += '<span class="glass' + (i === v.length ? ' on' : '') + '">' + (v[i] ? '•' : '') + '</span>';
    return h;
  }
  function viewGate() {
    if (S.status === 'loading' || (S.status === 'ready' && !S.loaded)) {
      return '<div class="welcome">' + sheep(110, 'bob') + '<h1>Embrace</h1><p>Opening…</p></div>';
    }
    if (S.status === 'error') {
      return '<div class="welcome">' + sheep(110, 'bob') + '<h1>Embrace</h1><p>' + esc(S.error) + '</p><button class="cta" data-action="reload">Try again</button></div>';
    }
    if (S.status === 'code' || S.status === 'setcode') {
      var setting = S.status === 'setcode';
      return '<div class="welcome">' + sheep(110, 'bob') + '<h1>' + (setting ? 'Create a code' : 'Welcome') + '</h1>' +
        '<p>' + (setting ? 'Choose a 4-digit code for your elders. Each phone enters it once.' : 'Enter the 4-digit congregation code. You only do this once.') + '</p>' +
        '<label class="pin" id="pin" for="gate-code">' + pinBoxes('') + '</label>' +
        '<input id="gate-code" class="pin-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" aria-label="Congregation code">' +
        '<p class="err" id="gate-err" role="alert" hidden></p></div>';
    }
    // Only elders who have not yet picked their name on any phone are offered.
    // New elders first; elders already using Embrace on another phone or computer stay available below.
    var els = elders().filter(function (p) { return !p.claimed; }), h = '<div class="welcome">' + sheep(110, 'bob') + '<h1>Who are you?</h1>';
    var again = elders().filter(function (p) { return p.claimed; });
    if (!S.whoAll && (els.length || again.length)) {
      return h + '<p>Tap your name. Embrace will remember you on this device.</p>' +
        (els.length ? '<div class="glass list">' + els.map(function (p) { return cell(p, 'iam', true); }).join('') + '</div>' : '') +
        (again.length ? '<h2 class="label" style="align-self:stretch;max-width:420px;width:100%;margin:6px auto -10px;text-align:left">Already using Embrace on another device</h2>' +
          '<div class="glass list">' + again.map(function (p) { return cell(p, 'iam', true); }).join('') + '</div>' : '') +
        '<button class="quiet" data-action="who-all">My name isn\'t here</button></div>';
    }
    h += '<p>Type your name. Embrace will remember you on this phone.</p>' +
      '<label class="search glass">' + I.search + '<span class="sr">Your name</span><input id="who-search" type="search" autocomplete="off" placeholder="Your name" value="' + esc(S.whoQuery) + '"></label>' +
      '<div id="who-list" style="width:100%;max-width:420px">' + whoResults() + '</div>';
    if (els.length) h += '<button class="quiet" data-action="who-elders">Show the elders</button>';
    return h + '</div>';
  }
  function whoResults() {
    var q = S.whoQuery.trim().toLowerCase();
    if (q.length < 2) return '';
    var list = S.data.publishers.filter(function (p) { return p.name.toLowerCase().indexOf(q) >= 0; }).sort(byName).slice(0, 6);
    var h = list.length ? '<div class="glass list">' + list.map(function (p) { return cell(p, 'iam', true); }).join('') + '</div>' : '';
    if (!list.length) h += '<button class="cta" data-action="iam-new" style="margin-top:4px">Continue as ' + esc(S.whoQuery.trim()) + '</button>';
    return h;
  }

  function tabs() {
    return '<div class="tabs"><nav aria-label="Main">' + [['home', 'Home'], ['flock', 'Flock'], ['upcoming', 'Upcoming'], ['settings', 'Settings'], ['talks', 'Talks']].map(function (t) {
      return '<button data-action="tab" data-tab="' + t[0] + '"' + (S.tab === t[0] ? ' aria-current="page"' : '') + (S.hop === t[0] ? ' class="hop"' : '') + '>' + I[t[0]] + t[1] + '</button>';
    }).join('') + '</nav></div>';
  }

  /* ---------------- sheets ---------------- */
  function head(title, right, leftLabel) {
    return '<div class="grab" aria-hidden="true"></div><div class="sheet-head"><button class="link" data-action="close" style="justify-self:start">' + (leftLabel || 'Cancel') + '</button>' +
      '<h2 id="sheet-title">' + esc(title) + '</h2>' + (right || '<span></span>') + '</div>';
  }
  function pickResults(q, forLog) {
    if (S.sheet && S.sheet.type === 'assign') {
      var r = S.sheet.rank;
      var cand = S.data.publishers.filter(function (p) { return p.rank !== r && p.rank !== 'Removed' && (!q || p.name.toLowerCase().indexOf(q) >= 0); }).sort(byName).slice(0, q ? 40 : 0);
      if (!q) return '<p class="foot">Type a name to find him.</p>';
      return cand.length ? '<div class="glass list">' + cand.map(function (p) { return cell(p, 'make', true); }).join('') + '</div>' : '<div class="glass empty"><span>No name matches.</span></div>';
    }
    var list = needOrder(S.data.publishers.filter(function (p) { return (p.rank !== 'Removed' || q) && (!q || p.name.toLowerCase().indexOf(q) >= 0); })).slice(0, q ? 40 : 6);
    var sel = forLog ? S.sheet.sel : [];
    var chosen = forLog && sel.length ? '<h2 class="label" style="margin-bottom:8px">Chosen · ' + sel.length + '</h2><div class="glass"><div class="chips">' +
      sel.map(function (id) { var p = pub(id); return p ? '<button class="chip" data-action="pick" data-id="' + esc(id) + '" aria-pressed="true">' + esc(p.name) + ' ✕</button>' : ''; }).join('') + '</div></div>' : '';
    if (!list.length) return chosen + '<div class="glass empty"><span>No name matches.</span></div>';
    return chosen + (q ? '' : '<h2 class="label" style="margin-bottom:8px">Waiting the longest</h2>') +
      '<div class="glass list">' + list.map(function (p) { return forLog ? pickCell(p, sel.indexOf(p.id) >= 0) : cell(p, 'open'); }).join('') + '</div>' +
      (forLog && sel.length ? '<div class="sheet-foot"><button class="cta" data-action="pick-done">Continue with ' + sel.length + (sel.length === 1 ? ' person' : ' people') + '</button></div>' : '');
  }
  // A row in "Who did you visit?": tap to tick, tap again to untick.
  function pickCell(p, on) {
    var sub = subline(p);
    return '<button class="cell' + (on ? ' ticked' : '') + '" data-action="pick" data-id="' + esc(p.id) + '" aria-pressed="' + on + '">' +
      '<span class="av" aria-hidden="true">' + esc(initials(p.name)) + '</span>' +
      '<span class="txt"><b>' + esc(p.name) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
      '<span class="tick" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span></button>';
  }
  function familyOf(p) {
    return S.data.publishers.filter(function (x) { return x.id !== p.id && x.rank !== 'Removed' && x.group === p.group && lastName(x.name) === lastName(p.name); });
  }
  function sheetPick(forLog) {
    var q = (S.sheet.q || '').trim().toLowerCase();
    var title = S.sheet.type === 'assign' ? (S.sheet.rank === 'Elder' ? 'Add an Elder' : 'Add a Servant') : forLog ? 'Who did you visit?' : 'Find someone';
    var hint = S.sheet.type === 'pick' ? '<p class="sub" style="margin-top:-8px">Tap everyone you visited. You can pick a whole family.</p>' : '';
    return head(title, null, 'Close') + hint +
      '<label class="search glass">' + I.search + '<span class="sr">Find a name</span><input id="pick-search" type="search" autocomplete="off" placeholder="Type a name" value="' + esc(S.sheet.q || '') + '"></label>' +
      '<div id="pick-list">' + pickResults(q, forLog) + '</div>';
  }
  function sheetLog() {
    var sh = S.sheet, els = elders();
    var people = sh.ids.map(pub).filter(Boolean);
    if (S.meId && me() && !els.some(function (e) { return e.id === S.meId; })) els.unshift(me());
    els.sort(function (a, b) { return a.id === S.meId ? -1 : b.id === S.meId ? 1 : byName(a, b); });
    var servants = S.data.publishers.filter(function (x) { return x.rank === 'Ministerial Servant' && x.id !== S.meId; }).sort(byName);
    var chip = function (e) {
      return '<button class="chip" data-action="with" data-id="' + esc(e.id) + '" aria-pressed="' + (sh.with.indexOf(e.id) >= 0) + '">' + esc(e.id === S.meId ? 'Me' : e.name) + '</button>';
    };
    var extra = {};
    people.forEach(function (p) { familyOf(p).forEach(function (x) { if (sh.ids.indexOf(x.id) < 0) extra[x.id] = x; }); });
    var extraList = Object.keys(extra).map(function (k) { return extra[k]; });
    var top = people.length === 1
      ? '<div class="hero" style="padding:4px 0 0;gap:4px"><span class="av" aria-hidden="true">' + esc(initials(people[0].name)) + '</span><h1 style="font-size:24px;margin-top:4px">' + esc(people[0].name) + '</h1></div>'
      : '<h2 class="label">Visiting ' + people.length + ' people</h2><div class="glass"><div class="chips">' + people.map(function (p) {
          return '<span class="chip" aria-pressed="true" style="display:inline-flex;align-items:center">' + esc(p.name) + '</span>';
        }).join('') + '</div></div>';
    if (extraList.length && !sh.editId) {
      top += '<button class="quiet glass" data-action="add-family">Add the rest of the family: ' + esc(extraList.map(function (x) { return firstName(x.name); }).join(', ')) + '</button>';
    }
    return head(sh.editId ? 'Edit Visit' : 'Log a Visit', '<button class="link" data-action="save-visit">Save</button>') + top +
      '<h2 class="label">Who went with you?</h2><div class="glass">' +
      '<div class="chips-label">Elders</div><div class="chips" role="group" aria-label="Elders on this visit">' + els.map(chip).join('') + '</div>' +
      (servants.length ? '<div class="chips-label">Ministerial servants</div><div class="chips" role="group" aria-label="Ministerial servants on this visit">' + servants.map(chip).join('') + '</div>' : '') +
      '</div>' +
      '<h2 class="label">What day?</h2><div class="glass" id="cal">' + calendar() + '</div>' +
      '<h2 class="label"><label for="v-notes">Notes</label></h2><div class="glass list"><textarea id="v-notes" placeholder="What was shared, how they are doing, anything to follow up on">' + esc(sh.notes || '') + '</textarea>' +
      '<label class="field" for="v-fu"><span>Needs a follow-up</span><input class="switch" id="v-fu" type="checkbox"' + (sh.followUp ? ' checked' : '') + '></label></div>' +
      '<p class="err" id="v-err" role="alert" hidden></p>' +
      '<button class="cta" data-action="save-visit">Save Visit</button>';
  }
  function calendar() {
    var sh = S.sheet, y = sh.calY, m = sh.calM, today = todayStr(), now = new Date();
    var startDow = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    var fut = !!sh.future;
    var canNext = fut || y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth());
    var canPrev = !fut || y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth());
    var h = '<div class="cal"><div class="cal-head"><button class="link" data-action="cal" data-step="-1" aria-label="Previous month"' + (canPrev ? '' : ' disabled style="opacity:.25"') + '>' + I.left + '</button>' +
      '<b>' + MON[m] + ' ' + y + '</b><button class="link" data-action="cal" data-step="1" aria-label="Next month"' + (canNext ? '' : ' disabled style="opacity:.25"') + '>' + I.right + '</button></div>' +
      '<div class="cal-grid">' + ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (d) { return '<span class="dow">' + d + '</span>'; }).join('');
    for (var i = 0; i < startDow; i++) h += '<span></span>';
    for (var d = 1; d <= days; d++) {
      var s = y + '-' + pad(m + 1) + '-' + pad(d);
      h += '<button data-action="day" data-date="' + s + '"' + (s === today ? ' class="today"' : '') + ((fut ? s < today : s > today) ? ' disabled' : '') +
        ' aria-pressed="' + (s === sh.date) + '" aria-label="' + MON[m] + ' ' + d + '">' + d + '</button>';
    }
    return h + '</div></div>';
  }
  function canChange() { return true; }
  function sheetVisit(v) {
    var p = pub(v.publisherId);
    var h = head('Visit', null, 'Close') +
      '<div class="glass list"><div class="row-plain"><span>Visited</span><span>' + esc(p ? p.name : v.publisherName) + '</span></div>' +
      '<div class="row-plain"><span>Date</span><span>' + esc(fmtDate(v.date)) + '</span></div>' +
      '<div class="row-plain"><span>Who went</span><span>' + esc(who(v)) + '</span></div>' +
      (v.followUp ? '<div class="row-plain"><span>Follow-up</span><span class="flag">Needed</span></div>' : '') + '</div>' +
      '<h2 class="label">Notes</h2><div class="glass" style="padding:16px 18px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5">' +
      (v.notes ? esc(v.notes) : '<span style="color:var(--fg2)">No notes.</span>') + '</div>';
    if (p && S.pubId !== p.id) h += '<button class="quiet glass" data-action="open" data-id="' + esc(p.id) + '">Open ' + esc(firstName(p.name)) + '\'s page</button>';
    if (canChange(v)) {
      h += S.sheet.confirm
      ? '<div class="glass list"><div class="row-plain"><span>Delete this visit?</span></div><button class="action red" data-action="delete-visit" data-id="' + esc(v.id) + '">Delete</button><button class="action" data-action="unconfirm">Keep it</button></div>'
      : '<button class="quiet glass" data-action="edit-visit" data-id="' + esc(v.id) + '">Edit visit</button><button class="quiet red" data-action="confirm">Delete visit</button>';
    }
    return h;
  }
  function sheetStatus(st) {
    var list = needOrder(flock().filter(function (p) { return homeState(p) === st; }));
    return head(STATUS[st].long, null, 'Close') +
      '<p class="sub" style="margin-top:-6px">' + list.length + (list.length === 1 ? ' person' : ' people') + '</p>' +
      (list.length ? '<div class="glass list">' + list.map(function (p) { return cell(p); }).join('') + '</div>' : '<div class="glass empty"><span>No one here right now.</span></div>');
  }
  function sheetAllVisits() {
    var sy = serviceYear();
    var year = S.data.visits.filter(function (v) { return v.date >= sy.start && v.date <= sy.end; });
    var mine = year.filter(function (v) { return (v.elderIds || []).indexOf(S.meId) >= 0; }).length;
    var all = S.data.visits.slice().sort(visitOrder).slice(0, 100);
    return head('Visits', null, 'Close') +
      '<div class="glass list"><div class="row-plain"><span>This service year</span><span>' + year.length + '</span></div>' +
      '<div class="row-plain"><span>Visits you went on</span><span>' + mine + '</span></div></div>' +
      (all.length ? '<div class="glass list">' + all.map(function (v) { return noteRow(v, true); }).join('') + '</div>' : '');
  }
  function sheetEdit(p) {
    var isNew = !p; p = p || { name: '', rank: 'Publisher', group: S.group !== 'all' ? S.group : '', appointedWife: false, note: '' };
    var h = head(isNew ? 'Add a Person' : 'Edit', '<button class="link" data-action="save-person">Save</button>') +
      '<div class="glass list">' +
      '<div class="field"><label for="p-name">Name</label><input id="p-name" type="text" value="' + esc(p.name) + '" placeholder="Full name" autocomplete="off"></div>' +
      '<div class="field"><label for="p-rank">Privilege</label><select id="p-rank">' + RANKS.map(function (r) { return '<option' + (r === (p.rank || 'Publisher') ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="p-pioneer">Pioneer</label><select id="p-pioneer">' + PIONEERS.map(function (r) { return '<option value="' + r + '"' + (r === (p.pioneer || '') ? ' selected' : '') + '>' + (r || 'No') + '</option>'; }).join('') + '</select></div>' +
      '<label class="field" for="p-wife"><span>Appointed wife</span><input class="switch" id="p-wife" type="checkbox"' + (p.appointedWife ? ' checked' : '') + '></label>' +
      '<div class="chips" role="group" aria-label="Roles">' + ROLES.map(function (r) {
        return '<button class="chip" data-action="role" data-role="' + r + '" aria-pressed="' + (S.sheet.roles.indexOf(r) >= 0) + '">' + r + '</button>';
      }).join('') + '</div>' +
      '<div class="field"><label for="p-group">Group</label><input id="p-group" type="text" list="p-groups" value="' + esc(p.group || '') + '" placeholder="Overseer\'s name"></div>' +
      '<datalist id="p-groups">' + idx.groups.map(function (g) { return '<option value="' + esc(g) + '"></option>'; }).join('') + '</datalist>' +
      '<div class="field"><label for="p-phone">Phone</label><input id="p-phone" type="text" inputmode="tel" value="' + esc(fmtPhone(p.phone || '')) + '" placeholder="(419) 555-1234" autocomplete="off"></div>' +
      '<div class="field"><label for="p-note">Note</label><input id="p-note" type="text" value="' + esc(p.note || '') + '" placeholder="e.g. Away until April"></div></div>' +
      '<p class="err" id="p-err" role="alert" hidden></p><button class="cta" data-action="save-person">Save</button>';
    if (!isNew) {
      h += S.sheet.confirm
        ? '<div class="glass list"><div class="row-plain"><span>Remove ' + esc(firstName(p.name)) + ' and their visits?</span></div><button class="action red" data-action="delete-person">Remove</button><button class="action" data-action="unconfirm">Keep</button></div>'
        : '<button class="quiet red" data-action="confirm">Remove from Embrace</button>';
    }
    return h;
  }
  function sheetImport(sh) {
    var ups = sh.updates || [], vs = sh.visits || [], rm = sh.removes || [];
    var rows = [['New people', sh.rows.length], ['Details updated', ups.length], ['Earlier visits recorded', vs.length], ['Taken off the list', rm.length], ['Already up to date', sh.skipped]];
    var any = sh.rows.length || ups.length || vs.length || rm.length;
    return head('Import', null, 'Close') + '<div class="glass list">' + rows.map(function (r) {
      return '<div class="row-plain"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>';
    }).join('') + '</div>' +
      (any ? '<button class="cta" data-action="do-import">Bring it in</button>' : '<p class="foot">Everything in this list is already in Embrace.</p>');
  }
  function sheetCode() {
    return head('Congregation Code', '<button class="link" data-action="code-save">Save</button>') +
      '<div class="glass list"><div class="field"><label for="new-code">New code</label><input id="new-code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="4 digits"></div></div>' +
      '<p class="foot">Phones already using Embrace stay unlocked. New phones need the new code.</p>' +
      '<p class="err" id="c-err" role="alert" hidden></p><button class="cta" data-action="code-save">Save</button>';
  }

  /* ---------------- render ---------------- */
  var root = document.getElementById('app');
  root.insertAdjacentHTML('beforebegin', scene());
  root.innerHTML = '<main id="main"></main><div id="tabs"></div><div id="sheet"></div><div id="fx" aria-live="polite"></div>';
  var $main = document.getElementById('main'), $tabs = document.getElementById('tabs'), $sheet = document.getElementById('sheet'), $fx = document.getElementById('fx');

  function needsGate() { return S.status !== 'ready' || !S.loaded || !me(); }
  function render() {
    var a = document.activeElement, keep = a && (a.id === 'search' || a.id === 'who-search') ? [a.id, a.selectionStart] : null;
    if (needsGate()) { $main.innerHTML = viewGate(); $tabs.innerHTML = ''; }
    else {
      var p = S.pubId ? pub(S.pubId) : null;
      if (S.pubId && !p) S.pubId = null;
      $main.innerHTML = p ? viewPerson(p) : S.tab === 'home' ? viewHome() : S.tab === 'flock' ? viewFlock() : S.tab === 'upcoming' ? viewUpcoming() : S.tab === 'talks' ? viewTalks() : viewSettings();
      $tabs.innerHTML = tabs();
      S.hop = null;
      if (!p && S.tab === 'talks' && (S.tPart || 'year') === 'year' && !S.tScrolled && S.tYear === new Date().getFullYear()) {
        S.tScrolled = true;
        var tm = document.getElementById('tm-' + new Date().getMonth());
        if (tm && new Date().getMonth() > 0 && tm.scrollIntoView) setTimeout(function () { tm.scrollIntoView({ block: 'start' }); window.scrollBy(0, -12); }, 60);
      }
      if (!p && S.tab === 'home') drawRing();
    }
    if (keep) { var el = document.getElementById(keep[0]); if (el) { el.focus(); try { el.setSelectionRange(keep[1], keep[1]); } catch (e) { /* ignore */ } } }
  }
  function renderSheet() {
    var sh = S.sheet, body = '';
    if (!sh) { $sheet.innerHTML = ''; document.body.style.overflow = ''; return; }
    if (sh.type === 'pick') body = sheetPick(true);
    else if (sh.type === 'find' || sh.type === 'assign') body = sheetPick(false);
    else if (sh.type === 'log') { if (!sh.ids.map(pub).filter(Boolean).length) return closeSheet(); body = sheetLog(); }
    else if (sh.type === 'visit') { var v = visit(sh.id); if (!v) return closeSheet(); body = sheetVisit(v); }
    else if (sh.type === 'status') body = sheetStatus(sh.st);
    else if (sh.type === 'group') body = sheetGroup(sh.g);
    else if (sh.type === 'ask') body = sheetAsk();
    else if (sh.type === 't-week') body = sheetTWeek(sh.date);
    else if (sh.type === 't-in') body = sheetTIn(sh);
    else if (sh.type === 't-out') body = sheetTOut(sh);
    else if (sh.type === 't-settings') body = sheetTSettings();
    else if (sh.type === 't-copy') body = sheetTCopy(sh.year);
    else if (sh.type === 't-import') body = sheetTImport(sh);
    else if (sh.type === 'plan') { var pl = planById(sh.id); if (!pl) return closeSheet(); body = sheetPlan(pl); }
    else if (sh.type === 'visits') body = sheetAllVisits();
    else if (sh.type === 'edit') body = sheetEdit(sh.id ? pub(sh.id) : null);
    else if (sh.type === 'import') body = sheetImport(sh);
    else if (sh.type === 'code') body = sheetCode();
    $sheet.innerHTML = '<div class="scrim" data-action="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' + body + '</div>';
    document.body.style.overflow = 'hidden';
  }
  function toast(msg) {
    $fx.innerHTML = '<div class="toast glass">' + esc(msg) + '</div>';
    clearTimeout(toast.t); toast.t = setTimeout(function () { $fx.innerHTML = ''; }, 2300);
  }
  function trot(msg) {
    $fx.innerHTML = '<div class="trot"><div class="runner">' + sheep(64) + '</div><div class="msg glass">' + esc(msg) + '</div></div>';
    clearTimeout(toast.t); toast.t = setTimeout(function () { $fx.innerHTML = ''; }, 2400);
  }

  /* back button (Android) and swipe-back (iPhone) close sheets and pages */
  var layers = 0;
  function push() { if (PREVIEW) return; try { history.pushState({ embrace: ++layers }, ''); } catch (e) { layers = Math.max(0, layers - 1); } }
  function pop(fallback) { if (!PREVIEW && layers > 0) history.back(); else fallback(); }
  window.addEventListener('popstate', function () {
    if (layers > 0) layers--;
    if (S.sheet) { S.sheet = null; renderSheet(); }
    else if (S.pubId) { S.pubId = null; render(); window.scrollTo(0, S.scroll[S.tab] || 0); }
  });
  function openSheet(sh) { var had = !!S.sheet; S.sheet = sh; renderSheet(); if (!had) push(); }
  function swapSheet(sh) { S.sheet = sh; renderSheet(); }
  function closeSheet() { pop(function () { S.sheet = null; renderSheet(); }); }
  function openPerson(id) {
    if (S.sheet) { S.sheet = null; renderSheet(); if (!PREVIEW && layers > 0) { layers--; try { history.replaceState({ embrace: layers }, ''); } catch (e) { /* ignore */ } } }
    var was = !!S.pubId;
    if (!S.pubId) S.scroll[S.tab] = window.scrollY;
    if (S.tab === 'settings') S.tab = 'flock';
    S.pubId = id; render(); window.scrollTo(0, 0);
    if (!was) push();
  }
  function logSheet(ids) {
    var now = new Date();
    return { type: 'log', ids: ids.slice(), with: S.meId ? [S.meId] : [], date: todayStr(), calY: now.getFullYear(), calM: now.getMonth() };
  }
  function keepAsk() {
    var sh = S.sheet; if (!sh || sh.type !== 'ask') return;
    var t = document.getElementById('ask-time'); if (t) sh.time = t.value;
    var msg = document.getElementById('ask-msg'); if (msg && sh.edited) sh.msg = msg.value;
  }
  function refreshMsg() {
    var sh = S.sheet; if (!sh || sh.type !== 'ask' || sh.edited) return;
    var msg = document.getElementById('ask-msg'); if (msg) msg.value = draftText(sh);
  }
  function showErr(id, msg) { var el = document.getElementById(id); if (el) { el.textContent = msg; el.hidden = false; } }
  function fail(id) { return function (e) { S.busy = false; showErr(id, window.EmbraceStore.friendly(e)); }; }
  function setMe(id) { S.meId = id; lsSet('embrace-me', id); S.whoAll = false; S.whoQuery = ''; S.tab = 'home'; S.ringDrawn = false; }
  function focusLater(id) { setTimeout(function () { var s = document.getElementById(id); if (s) s.focus(); }, 380); }

  /* ---------------- actions ---------------- */
  var A = {
    tab: function (el) {
      var t = el.dataset.tab;
      if (S.sheet) { S.sheet = null; renderSheet(); }
      S.tab = t; S.hop = t; S.pubId = null; S.confirmReset = false;
      render(); window.scrollTo(0, 0);
    },
    mode: function (el) { S.mode = el.dataset.mode; saveUi(); render(); },
    fold: function (el) {
      var k = el.dataset.key; S.open[k] = !S.open[k];
      var r = document.getElementById('results'); if (r) r.innerHTML = flockList();
    },
    open: function (el) { openPerson(el.dataset.id); },
    back: function () { pop(function () { S.pubId = null; render(); window.scrollTo(0, S.scroll[S.tab] || 0); }); },
    'log-start': function () { openSheet({ type: 'pick', q: '', sel: [] }); },
    find: function () { openSheet({ type: 'find', q: '' }); focusLater('pick-search'); },
    status: function (el) { openSheet({ type: 'status', st: el.dataset.st }); },
    'group-sheet': function (el) { openSheet({ type: 'group', g: el.dataset.g }); },
    'all-visits': function () { openSheet({ type: 'visits' }); },
    pick: function (el) {
      var sel = S.sheet.sel, id = el.dataset.id, i = sel.indexOf(id);
      if (i >= 0) sel.splice(i, 1); else sel.push(id);
      var box = document.getElementById('pick-list');
      if (box) box.innerHTML = pickResults((S.sheet.q || '').trim().toLowerCase(), true);
    },
    'pick-done': function () { if (S.sheet.sel.length) swapSheet(logSheet(S.sheet.sel)); },
    'add-family': function () {
      var sh = S.sheet, notes = document.getElementById('v-notes'), fu = document.getElementById('v-fu');
      var keep = { notes: notes ? notes.value : '', fu: fu ? fu.checked : false };
      sh.ids.map(pub).filter(Boolean).forEach(function (p) { familyOf(p).forEach(function (x) { if (sh.ids.indexOf(x.id) < 0) sh.ids.push(x.id); }); });
      renderSheet();
      document.getElementById('v-notes').value = keep.notes; document.getElementById('v-fu').checked = keep.fu;
    },
    assign: function (el) { openSheet({ type: 'assign', rank: el.dataset.rank, q: '' }); focusLater('pick-search'); },
    make: function (el) {
      var p = pub(el.dataset.id), r = S.sheet.rank;
      store.savePublisher({ id: p.id, rank: r }).then(function () { closeSheet(); toast(firstName(p.name) + ' is now ' + (r === 'Elder' ? 'an elder' : 'a servant')); });
    },
    log: function (el) { openSheet(logSheet([el.dataset.id])); },
    with: function (el) {
      var w = S.sheet.with, id = el.dataset.id, i = w.indexOf(id);
      if (i >= 0) w.splice(i, 1); else w.push(id);
      el.setAttribute('aria-pressed', String(i < 0));
    },
    cal: function (el) {
      var sh = S.sheet, m = sh.calM + (+el.dataset.step), y = sh.calY;
      if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
      sh.calM = m; sh.calY = y; document.getElementById('cal').innerHTML = calendar();
    },
    day: function (el) {
      S.sheet.date = el.dataset.date; document.getElementById('cal').innerHTML = calendar();
      if (S.sheet.type === 'ask') refreshMsg();
    },
    ask: function () { openSheet(askSheet()); },
    'plan-new': function () { openSheet(askSheet({ noText: true })); },
    'plan-day': function (el) { openSheet(askSheet({ noText: true, date: el.dataset.date })); },
    hcal: function (el) {
      var c = S.homeCal, m = c.m + (+el.dataset.step), y = c.y;
      if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
      S.homeCal = { y: y, m: m };
      var box = document.getElementById('home-cal'); if (box) box.outerHTML = homeCalendar();
    },
    'ask-with': function (el) {
      var w = S.sheet.withIds, id = el.dataset.id, i = w.indexOf(id);
      if (i >= 0) w.splice(i, 1); else w.push(id);
      keepAsk(); renderSheet();
    },
    'ask-visit': function (el) {
      var v = S.sheet.visitIds, id = el.dataset.id, i = v.indexOf(id);
      if (i >= 0) v.splice(i, 1); else v.push(id);
      keepAsk(); S.sheet.q = ''; renderSheet();
    },
    'ask-send': function () {
      var sh = S.sheet; keepAsk();
      if (!sh.date) return showErr('ask-err', 'Tap a day on the calendar.');
      var bros = sh.withIds.map(pub).filter(Boolean), typed = {};
      Array.prototype.forEach.call(document.querySelectorAll('.ask-phone'), function (inp) {
        var n = digits(inp.value); if (n.length >= 10) { typed[inp.dataset.pid] = n; store.savePublisher({ id: inp.dataset.pid, phone: n }); }
      });
      var nums = bros.map(function (b) { return digits(b.phone).length >= 10 ? digits(b.phone) : typed[b.id] || ''; }).filter(function (n) { return n.length >= 10; });
      if (sh.text && nums.length < bros.length) return showErr('ask-err', 'Type a phone number for each brother you picked.');
      if (sh.text && !nums.length) return showErr('ask-err', 'Tap at least one brother who has a phone number.');
      if (!sh.text && !sh.share) return showErr('ask-err', 'Turn on the text message or the shared calendar.');
      var msg = sh.text ? (document.getElementById('ask-msg').value || draftText(sh)) : '';
      var visit = sh.visitIds.map(pub).filter(Boolean), m = me();
      var done = function () {
        closeSheet();
        if (sh.text) setTimeout(function () { window.location.href = smsLink(nums, msg); }, 250);
        toast(sh.share ? 'Added to the calendar' : 'Opening your messages');
      };
      if (!sh.share) return done();
      store.addPlan({ date: sh.date, time: sh.time || '', withIds: bros.map(function (b) { return b.id; }), withNames: bros.map(function (b) { return b.name; }),
        visitIds: visit.map(function (p) { return p.id; }), visitNames: visit.map(function (p) { return p.name; }),
        by: S.meId || '', byName: m ? m.name : '' }).then(done, fail('ask-err'));
    },
    plan: function (el) { openSheet({ type: 'plan', id: el.dataset.id }); },
    'plan-delete': function (el) { store.deletePlan(el.dataset.id).then(function () { closeSheet(); toast('Removed from the calendar'); }); },
    'plan-text': function (el) {
      var x = planById(el.dataset.id); if (!x) return;
      var bros = (x.withIds || []).map(pub).filter(Boolean);
      var nums = bros.map(function (b) { return digits(b.phone); }).filter(function (n) { return n.length >= 10; });
      var body = 'Reminder: shepherding visit' + ((x.visitNames || []).length ? ' with ' + joinNames(x.visitNames) : '') + ' on ' + longDate(x.date) + (x.time ? ' at ' + fmtTime(x.time) : '') + '.';
      window.location.href = smsLink(nums, body);
    },
    'plan-log': function (el) {
      var x = planById(el.dataset.id); if (!x) return;
      var ls = logSheet(x.visitIds || []);
      ls.with = [S.meId].concat(x.withIds || []).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
      if (x.date <= todayStr()) { ls.date = x.date; var d = parseDay(x.date); ls.calY = d.getFullYear(); ls.calM = d.getMonth(); }
      ls.fromPlan = x.id;
      swapSheet(ls);
    },
    'save-visit': function () {
      var sh = S.sheet, people = sh.ids.map(pub).filter(Boolean);
      if (!people.length || S.busy) return;
      if (!sh.with.length && !sh.editId) return showErr('v-err', 'Tap at least one name under "Who went with you?"');
      if (sh.date > todayStr()) return showErr('v-err', 'Pick a day that has already happened.');
      var names = sh.with.map(function (id) { var e = pub(id); return e ? e.name : ''; }).filter(Boolean);
      S.busy = true;
      var notes = document.getElementById('v-notes').value.trim(), fu = document.getElementById('v-fu').checked;
      if (sh.editId) {
        return store.updateVisit(sh.editId, { date: sh.date, elders: names, elderIds: sh.with.slice(), notes: notes, followUp: fu }).then(function () {
          S.busy = false; closeSheet(); toast('Visit updated');
        }, fail('v-err'));
      }
      store.addVisits(people.map(function (p) {
        return { publisherId: p.id, publisherName: p.name, date: sh.date, elders: names, elderIds: sh.with.slice(), notes: notes, followUp: fu, by: S.meId };
      })).then(function () {
        S.busy = false;
        if (sh.fromPlan) store.deletePlan(sh.fromPlan);
        closeSheet();
        trot(people.length === 1 ? firstName(people[0].name) + '’s visit saved' : people.length + ' visits saved');
      }, fail('v-err'));
    },
    visit: function (el) { openSheet({ type: 'visit', id: el.dataset.id }); },
    'edit-visit': function (el) {
      var v = visit(el.dataset.id); if (!v || !canChange(v)) return;
      var ls = logSheet([v.publisherId]), d = parseDay(v.date);
      ls.editId = v.id; ls.with = (v.elderIds || []).slice(); ls.date = v.date; ls.calY = d.getFullYear(); ls.calM = d.getMonth();
      ls.notes = v.notes || ''; ls.followUp = !!v.followUp;
      swapSheet(ls);
    },
    'delete-visit': function (el) { var v = visit(el.dataset.id); if (!v || !canChange(v)) return; store.deleteVisit(el.dataset.id).then(function () { closeSheet(); toast('Visit deleted'); }); },
    edit: function (el) { var p = pub(el.dataset.id); openSheet({ type: 'edit', id: el.dataset.id, roles: ((p && p.roles) || []).slice() }); },
    new: function () { openSheet({ type: 'edit', id: null, roles: [] }); },
    role: function (el) {
      var r = S.sheet.roles, v = el.dataset.role, i = r.indexOf(v);
      if (i >= 0) r.splice(i, 1); else r.push(v);
      el.setAttribute('aria-pressed', String(i < 0));
    },
    confirm: function () { S.sheet.confirm = true; renderSheet(); },
    unconfirm: function () { S.sheet.confirm = false; renderSheet(); },
    close: function () { closeSheet(); },
    'save-person': function () {
      var name = document.getElementById('p-name').value.trim().replace(/\s+/g, ' ');
      if (!name) return showErr('p-err', 'Type the person\'s name.');
      var p = { name: name, rank: document.getElementById('p-rank').value, pioneer: document.getElementById('p-pioneer').value,
        roles: S.sheet.roles.slice(), appointedWife: document.getElementById('p-wife').checked,
        group: document.getElementById('p-group').value.trim(), note: document.getElementById('p-note').value.trim(),
        phone: digits(document.getElementById('p-phone').value) };
      if (S.sheet.id) p.id = S.sheet.id;
      store.savePublisher(p).then(function () { closeSheet(); toast(p.id ? 'Saved' : firstName(name) + ' added'); }, fail('p-err'));
    },
    'delete-person': function () {
      var id = S.sheet.id;
      store.deletePublisher(id).then(function () { S.sheet = null; renderSheet(); S.pubId = null; render(); toast('Removed'); });
    },
    'import-pick': function () { var f = document.getElementById('import-file'); if (f) f.click(); },
    'do-import': function () {
      var rows = S.sheet.rows, ups = S.sheet.updates || [], vs = S.sheet.visits || [], rm = S.sheet.removes || [];
      store.importRoster(rows)
        .then(function () { return ups.length ? store.updateMany(ups) : null; })
        .then(function () { return vs.length ? store.addVisits(vs) : null; })
        .then(function () { return rm.reduce(function (pr, id) { return pr.then(function () { return store.deletePublisher(id); }); }, Promise.resolve()); })
        .then(function () {
          closeSheet(); S.ringDrawn = false;
          toast([rows.length ? rows.length + ' added' : '', ups.length ? ups.length + ' updated' : '', vs.length ? vs.length + ' visits' : '', rm.length ? rm.length + ' removed' : ''].filter(Boolean).join(' · ') || 'Nothing changed');
        }, function (e) { toast(window.EmbraceStore.friendly(e)); });
    },
    switch: function () { S.meId = null; lsSet('embrace-me', null); S.pubId = null; render(); window.scrollTo(0, 0); },
    iam: function (el) {
      var id = el.dataset.id, p = pub(id);
      el.classList.add('picked');
      var go = function () { setMe(id); render(); window.scrollTo(0, 0); toast('Welcome, ' + firstName(p.name)); };
      store.savePublisher({ id: id, rank: 'Elder', claimed: true, claimedOn: todayStr() }).then(function () { setTimeout(go, 450); }, function () { setTimeout(go, 450); });
    },
    'iam-new': function () {
      var n = S.whoQuery.trim().replace(/\s+/g, ' ');
      if (n.length < 2) return;
      store.savePublisher({ name: n, rank: 'Elder', group: '', appointedWife: false, note: '', claimed: true, claimedOn: todayStr() }).then(function (id) { setMe(id); render(); toast('Welcome, ' + firstName(n)); });
    },
    'who-all': function () { S.whoAll = true; render(); focusLater('who-search'); },
    'who-elders': function () { S.whoAll = false; render(); },
    'code-change': function () { openSheet({ type: 'code' }); },
    'code-save': function () {
      var c = (document.getElementById('new-code').value || '').replace(/\D/g, '');
      if (c.length !== 4) return showErr('c-err', 'The code must be 4 digits.');
      store.changeCode(c).then(function () { closeSheet(); toast('Code changed'); }, fail('c-err'));
    },
    reload: function () { location.reload(); },
    reset: function () { S.confirmReset = true; render(); },
    'cancel-reset': function () { S.confirmReset = false; render(); },
    'do-reset': function () { S.confirmReset = false; S.meId = null; S.ringDrawn = false; lsSet('embrace-me', null); store.resetDemo().then(function () { render(); }); }
  };
  /* ---------------- Talks: import ----------------
     Paste rows (from a spreadsheet, a CSV file, or typed: date, speaker, congregation, talk number, title)
     or the text a meeting-schedule app copies (blocks with Speaker / Congregation / Title / Away Speakers). */
  var T_MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var T_NONE = /^(no talk|none|no public talk|no meeting|circuit assembly|regional convention|convention|assembly|co visit|circuit overseer|memorial|special talk)/i;
  function tParseDate(raw) {
    var s = String(raw || '').trim().replace(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s*/i, '');
    if (!s || s.length > 40) return '';
    var y, m, d, x;
    if ((x = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +x[1]; m = +x[2]; d = +x[3]; }
    else if ((x = s.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?(?:\s+\d{1,2}:\d{2}.*)?$/))) { m = +x[1]; d = +x[2]; y = x[3] ? +x[3] : 0; if (y && y < 100) y += 2000; }
    else if ((x = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?(?:\s+.*)?$/i)) && T_MON.indexOf(x[1].slice(0, 3).toLowerCase()) >= 0) { m = T_MON.indexOf(x[1].slice(0, 3).toLowerCase()) + 1; d = +x[2]; y = x[3] ? +x[3] : 0; }
    else if ((x = s.match(/^(\d{1,2})\s+([a-z]{3,9})\.?,?\s*(\d{4})?$/i)) && T_MON.indexOf(x[2].slice(0, 3).toLowerCase()) >= 0) { d = +x[1]; m = T_MON.indexOf(x[2].slice(0, 3).toLowerCase()) + 1; y = x[3] ? +x[3] : 0; }
    else if (/^\d{5}$/.test(s) && +s > 40000 && +s < 60000) { var ex = new Date(1899, 11, 30); ex.setDate(ex.getDate() + +s); return ymd(ex); }
    else return '';
    if (!y) {
      y = new Date().getFullYear();
      if (new Date(y, m - 1, d) < new Date(Date.now() - 120 * 864e5)) y++;
    }
    var dt = new Date(y, m - 1, d);
    if (m < 1 || m > 12 || dt.getMonth() !== m - 1 || dt.getDate() !== d) return '';
    return ymd(dt);
  }
  function tSplitTalk(s) {
    s = String(s || '').trim(); var x;
    if ((x = s.match(/^(.*\S)\s*\(#?(\d{1,3})\)$/))) return { number: x[2], title: x[1] };
    if ((x = s.match(/^(?:no\.?\s*|#)?(\d{1,3})(?:[\s.:\-–]+(.*))?$/i))) return { number: x[1], title: (x[2] || '').trim() };
    return { number: '', title: s };
  }
  function tNormName(n) { return String(n || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function tFindBro(name) {
    var n = String(name || '').trim(); if (!n) return null;
    if (n.indexOf(',') > 0) { var p = n.split(','); n = p[1].trim() + ' ' + p[0].trim(); }
    var want = tNormName(n), w = want.split(' ');
    var pool = tSpeakers().concat(S.data.publishers.filter(function (p) { return !isVisitor(p); }));
    var hit = pool.filter(function (p) { return tNormName(p.name) === want; })[0];
    if (hit || w.length < 2) return hit || null;
    // first and last name, ignoring a middle name or nickname
    var two = pool.filter(function (p) { var q = tNormName(p.name).split(' '); return q[0] === w[0] && q[q.length - 1] === w[w.length - 1]; });
    return two.length === 1 ? two[0] : null;
  }
  function tDirWord(s) {
    var v = String(s || '').trim().toLowerCase();
    if (/^(in|incoming|visiting|visitor|home)$/.test(v)) return 'in';
    if (/^(out|outgoing|away|away speaker)$/.test(v)) return 'out';
    return '';
  }
  var T_COLS = [
    ['dir', /^(type|direction|in\/out|in or out)$/],
    ['date', /date|^day$|^week/],
    ['time', /time/],
    ['number', /^(talk\s*)?(no|num|number|#|outline)\.?$|talk\s*(#|no|num)|outline|s-?34/],
    ['title', /title|theme|subject|topic/],
    ['speaker', /speaker|name|brother|who/],
    ['cong', /cong|from|^to$|where|hall/],
    ['notes', /note|comment|hospitality|remark/],
    ['talk', /^talk$|public talk/]
  ];
  function tColOf(h) {
    var v = String(h || '').trim().toLowerCase();
    for (var i = 0; i < T_COLS.length; i++) if (T_COLS[i][1].test(v)) return T_COLS[i][0];
    return '';
  }
  function tTableRows(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    var tab = lines.some(function (l) { return l.indexOf('\t') >= 0; });
    var delim = tab ? '\t' : lines.some(function (l) { return l.indexOf(',') >= 0; }) ? ',' : lines.some(function (l) { return l.indexOf(';') >= 0; }) ? ';' : lines.some(function (l) { return l.indexOf('|') >= 0; }) ? '|' : null;
    if (delim === ',') return parseCsv(text);
    return lines.map(function (l) { return delim ? l.split(delim) : [l]; });
  }
  function tBlocks(text) {
    var LABEL = /^(title|speaker|congregation|talk|date|notes?|chairman|hospitality|closing prayer|opening prayer|away speakers?|reader|conductor|watchtower reader)\s*:?\s*(.*)$/i;
    var blocks = [], cur = null, label = '', bad = [];
    text.split(/\r?\n/).forEach(function (raw, i) {
      var l = raw.trim(); if (!l) return;
      var dt = tParseDate(l.replace(/\s+at\s+.*$/i, ''));
      if (dt) { cur = { date: dt, f: {}, line: i + 1, extra: [] }; blocks.push(cur); label = ''; return; }
      if (!cur) { cur = { date: '', f: {}, line: i + 1, extra: [] }; blocks.push(cur); }
      var m = l.match(LABEL);
      if (m && (m[2] === '' || l.indexOf(':') > 0)) {
        label = m[1].toLowerCase().replace(/s$/, '').replace('away speaker', 'away');
        if (label === 'note') label = 'notes';
        if (m[2]) { (cur.f[label] = cur.f[label] || []).push(m[2]); if (label !== 'away') label = ''; }
        return;
      }
      if (/^[A-Z0-9 &\-]{4,}$/.test(l) || /^\d{1,2}:\d{2}\s*(am|pm)?$/i.test(l)) { label = ''; return; }   // section headers, meeting time
      if (label && !/^none$/i.test(l) && !/^request$/i.test(l)) { (cur.f[label] = cur.f[label] || []).push(l); if (label !== 'away') label = ''; return; }
      cur.extra.push(l); label = '';
    });
    var items = [];
    blocks.forEach(function (b) {
      var f = function (k) { return (b.f[k] || [])[0] || ''; };
      var none = !f('speaker') && b.extra.filter(function (x) { return T_NONE.test(x); })[0];
      if (!b.date) { if (f('speaker') || (b.f.away || []).length) bad.push({ line: b.line, why: 'No date found', text: f('speaker') }); return; }
      if (f('speaker') || none) {
        var t = tSplitTalk(f('title') || f('talk'));
        var notes = [['Chairman', f('chairman')], ['Opening prayer', f('opening prayer')], ['Closing prayer', f('closing prayer')], ['Hospitality', f('hospitality')]]
          .filter(function (x) { return x[1]; }).map(function (x) { return x[0] + ': ' + x[1]; }).concat(b.f.notes || []).join('. ');
        items.push(none ? { dir: 'in', date: b.date, none: true, reason: none, line: b.line }
          : { dir: 'in', date: b.date, speaker: f('speaker'), cong: f('congregation'), number: t.number, title: t.title, notes: notes, line: b.line });
      }
      (b.f.away || []).forEach(function (a) {
        var x = a.match(/^(.*?)\s*\((.*)\)\s*$/);
        items.push({ dir: 'out', date: b.date, speaker: x ? x[1] : a, cong: x ? x[2] : '', line: b.line });
      });
    });
    return { items: items, bad: bad };
  }
  function tParseImport(text, defDir) {
    text = String(text || '');
    if (!text.trim()) return { items: [], bad: [] };
    if (/^\s*(speaker|congregation|title|away speakers?)\s*:?\s*$/im.test(text) || /^\s*(speaker|congregation)\s*:\s*\S/im.test(text)) return tBlocks(text);
    var rows = tTableRows(text), items = [], bad = [], map = null, start = 0;
    var first = rows[0] || [];
    if (!first.some(function (c) { return tParseDate(c); })) {
      var cols = first.map(tColOf);
      if (cols.filter(Boolean).length >= 2) { map = cols; start = 1; }
    }
    for (var r = start; r < rows.length; r++) {
      var cells = rows[r].map(function (c) { return String(c || '').trim(); }), it = { dir: defDir, line: r + 1 }, texts = [];
      if (map) {
        cells.forEach(function (c, i) {
          var k = map[i]; if (!c || !k) return;
          if (k === 'date') it.date = tParseDate(c);
          else if (k === 'dir') it.dir = tDirWord(c) || defDir;
          else if (k === 'number') it.number = c.replace(/\D/g, '');
          else if (k === 'talk' || (k === 'title' && /\(\d{1,3}\)$/.test(c))) { var tt = tSplitTalk(c); if (tt.number) it.number = tt.number; it.title = tt.title; }
          else it[k] = c;
        });
        if (it.speaker && T_NONE.test(it.speaker)) { it.none = true; it.reason = /^(no talk|none|no public talk)$/i.test(it.speaker) ? (it.notes || it.title || it.cong || 'No public talk') : it.speaker; }
      } else {
        cells.forEach(function (c) {
          if (!c) return;
          var dt = !it.date && tParseDate(c);
          if (dt) { it.date = dt; return; }
          if (!it.number && /^(#|no\.?\s*)?\d{1,3}$/i.test(c)) { it.number = c.replace(/\D/g, ''); return; }
          if (tDirWord(c)) { it.dir = tDirWord(c); return; }
          if (/^\d{1,2}:\d{2}\s*(am|pm)?$/i.test(c)) { it.time = c; return; }
          texts.push(c);
        });
        if (texts[0] && T_NONE.test(texts[0])) {
          it.none = true;
          it.reason = /^(no talk|none|no public talk)$/i.test(texts[0]) ? (texts[1] || 'No public talk') : texts[0];
        } else {
          it.speaker = texts[0] || ''; it.cong = texts[1] || '';
          if (texts[2]) { var t2 = tSplitTalk(texts[2]); it.title = t2.title; if (t2.number && !it.number) it.number = t2.number; }
          it.notes = texts.slice(3).join(', ');
        }
      }
      if (!it.date) { bad.push({ line: r + 1, why: 'No date found', text: cells.filter(Boolean).join(', ') }); continue; }
      if (!it.none && !it.speaker) { bad.push({ line: r + 1, why: 'No speaker', text: cells.filter(Boolean).join(', ') }); continue; }
      items.push(it);
    }
    return { items: items, bad: bad };
  }
  function tTime24(s) {
    var x = String(s || '').trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i); if (!x) return '';
    var h = +x[1]; if (x[3] && /pm/i.test(x[3]) && h < 12) h += 12; if (x[3] && /am/i.test(x[3]) && h === 12) h = 0;
    return pad(h) + ':' + x[2];
  }
  // Turn parsed lines into what will be saved, with a reason for anything left out.
  function tPlanImport(text, defDir, replace) {
    var p = tParseImport(text, defDir), plan = { ins: [], outs: [], skip: p.bad.slice() }, seenIn = {}, seenOut = {};
    var outs = tOutAll();
    p.items.forEach(function (it) {
      if (it.dir === 'out') {
        var b = tFindBro(it.speaker);
        if (!b) return plan.skip.push({ line: it.line, why: 'Not one of our brothers', text: it.speaker });
        var key = b.id + '|' + it.date;
        if (seenOut[key] || outs.some(function (o) { return o.brotherId === b.id && o.date === it.date; })) return plan.skip.push({ line: it.line, why: 'Already in Embrace', text: b.name + ', ' + tShort(it.date) });
        seenOut[key] = 1;
        plan.outs.push({ brotherId: b.id, brotherName: b.name, toCong: it.cong || '', date: it.date, time: tTime24(it.time), number: it.number || '', title: it.title || '', notes: it.notes || '' });
        return;
      }
      var wk = tWeekKey(it.date);
      if (seenIn[wk]) return plan.skip.push({ line: it.line, why: 'Same weekend twice', text: tShort(wk) });
      seenIn[wk] = 1;
      var had = tFilled(tIn(wk));
      if (had && !replace) return plan.skip.push({ line: it.line, why: 'Weekend already planned', text: tShort(wk) + ': ' + (tIn(wk).speaker || tIn(wk).reason || '') });
      var body = { date: wk };
      if (it.none) { body.type = 'none'; body.reason = it.reason || 'No public talk'; }
      else {
        var ours = tFindBro(it.speaker), home = !it.cong || tNormName(it.cong).indexOf(tNormName(tShortCong())) >= 0;
        if (ours && home && (ours.rank === 'Elder' || ours.rank === 'Ministerial Servant')) { body.type = 'local'; body.speaker = ours.name; body.localId = ours.id; body.phone = digits(ours.phone); body.confirmed = true; }
        else { body.type = 'visitor'; body.speaker = it.speaker.replace(/\s+/g, ' '); body.fromCong = it.cong || ''; body.phone = ''; body.confirmed = false; }
        body.number = it.number || ''; body.title = it.title || (it.number && tTitles()[it.number]) || ''; body.notes = it.notes || '';
      }
      plan.ins.push({ body: body, replaces: had });
    });
    return plan;
  }
  function tImpPreviewHtml(plan) {
    var rows = plan.ins.map(function (x) {
      var b = x.body;
      return '<div class="row-plain"><span style="white-space:nowrap">' + esc(tShort(b.date)) + ' · In</span><span>' + esc(b.type === 'none' ? b.reason : b.speaker + (b.type === 'local' ? ' (our speaker)' : b.fromCong ? ' (' + b.fromCong + ')' : '') + (b.number ? ' #' + b.number : '')) + (x.replaces ? ' <span class="flag">replaces</span>' : '') + '</span></div>';
    }).concat(plan.outs.map(function (o) {
      return '<div class="row-plain"><span style="white-space:nowrap">' + esc(tShort(o.date)) + ' · Out</span><span>' + esc(o.brotherName + (o.toCong ? ' → ' + o.toCong : '') + (o.number ? ' #' + o.number : '')) + '</span></div>';
    }));
    var h = rows.length ? '<h2 class="label" style="margin:16px 18px 8px">Ready to add · ' + rows.length + '</h2><div class="glass list">' + rows.join('') + '</div>' : '';
    if (plan.skip.length) {
      h += '<h2 class="label" style="margin:16px 18px 8px">Left out · ' + plan.skip.length + '</h2><div class="glass list">' + plan.skip.map(function (s) {
        return '<div class="row-plain"><span class="flag">' + esc(s.why) + '</span><span>' + esc((s.text || '').slice(0, 60)) + '</span></div>';
      }).join('') + '</div>';
    }
    return h;
  }
  function tImpRefresh() {
    var sh = S.sheet; if (!sh || sh.type !== 't-import') return;
    var el = document.getElementById('t-imp-text'); if (el) sh.text = el.value;
    var rp = document.getElementById('t-imp-replace'); sh.replace = !!(rp && rp.checked);
    var plan = tPlanImport(sh.text || '', sh.dir, sh.replace), n = plan.ins.length + plan.outs.length;
    var pv = document.getElementById('t-imp-preview'); if (pv) pv.innerHTML = tImpPreviewHtml(plan);
    var go = document.getElementById('t-imp-go');
    if (go) { go.disabled = !n; go.textContent = n ? 'Add ' + n + (n === 1 ? ' talk' : ' talks') : 'Add talks'; }
  }
  function sheetTImport(sh) {
    var ex = sh.dir === 'out' ? '11/15/2026, John Smith, Riverside, 172, Talk title, 1:00 PM' : '11/15/2026, John Smith, Riverside, 172, Talk title\n11/8/2026, No talk, Circuit assembly';
    return tHead('Import Talks') +
      '<div class="seg glass" role="group" aria-label="Import">' + [['in', 'Incoming speakers'], ['out', 'Outgoing speakers']].map(function (o) {
        return '<button data-action="t-imp-dir" data-dir="' + o[0] + '" aria-pressed="' + (sh.dir === o[0]) + '">' + o[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="glass"><textarea id="t-imp-text" style="min-height:170px;font-size:15px" placeholder="Paste here. One talk per line:&#10;' + esc(ex).replace(/\n/g, '&#10;') + '">' + esc(sh.text || '') + '</textarea></div>' +
      '<p class="foot" style="text-align:left;margin-top:-8px">One talk per line: <b>date, ' + (sh.dir === 'out' ? 'our brother' : 'speaker') + ', congregation, talk number, title</b>' + (sh.dir === 'out' ? ', time' : '') +
      '. You can copy rows straight from a spreadsheet, choose a CSV file, or paste what your meeting schedule app copies.' + (sh.dir === 'in' ? ' For a week with no talk, write <b>No talk</b> and the reason.' : '') + '</p>' +
      '<label class="quiet glass" style="display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer">' + I.plus + ' Choose a file<input id="t-imp-file" type="file" accept=".csv,.txt,.tsv,text/csv,text/plain,*/*" hidden></label>' +
      '<div class="glass list"><label class="field" for="t-imp-replace"><span>Replace weekends already planned</span><input class="switch" id="t-imp-replace" type="checkbox"' + (sh.replace ? ' checked' : '') + '></label></div>' +
      '<div id="t-imp-preview"></div><button class="cta" id="t-imp-go" data-action="t-imp-go" disabled>Add talks</button>';
  }
  var TA_IMPORT = {
    't-import': function (el) { var sh = { type: 't-import', dir: el.dataset.dir || (S.tPart === 'out' ? 'out' : 'in'), text: '', replace: false }; if (S.sheet) swapSheet(sh); else openSheet(sh); setTimeout(tImpRefresh, 0); },
    't-imp-dir': function (el) { tImpRefresh(); S.sheet.dir = el.dataset.dir; renderSheet(); tImpRefresh(); },
    't-imp-go': function () {
      tImpRefresh();
      var sh = S.sheet, plan = tPlanImport(sh.text || '', sh.dir, sh.replace), jobs = [], titles = Object.assign({}, tTitles()), nt = false;
      var n = plan.ins.length + plan.outs.length; if (!n) return;
      plan.ins.forEach(function (x) {
        jobs.push(store.putTalk('talk_in_' + x.body.date, x.body));
        if (x.body.number && x.body.title && titles[x.body.number] !== x.body.title) { titles[x.body.number] = x.body.title; nt = true; }
      });
      plan.outs.forEach(function (o, i) {
        jobs.push(store.putTalk('talk_out_' + Date.now().toString(36) + i + Math.random().toString(36).slice(2, 6), o));
        if (o.number && o.title && titles[o.number] !== o.title) { titles[o.number] = o.title; nt = true; }
      });
      if (nt) jobs.push(store.putTalk('talktitles', { map: titles }));
      var first = plan.ins.map(function (x) { return x.body.date; }).concat(plan.outs.map(function (o) { return o.date; })).sort()[0];
      Promise.all(jobs).then(function () {
        closeSheet(); S.tPart = plan.ins.length ? 'year' : 'out'; if (first) S.tYear = +first.slice(0, 4); S.tScrolled = false; render();
        toast(n + (n === 1 ? ' talk' : ' talks') + ' added');
      }, function (e) { toast(window.EmbraceStore.friendly(e)); });
    }
  };
  Object.keys(TA_IMPORT).forEach(function (k) { TA[k] = TA_IMPORT[k]; });

  Object.keys(TA).forEach(function (k) { A[k] = TA[k]; });
  function gateCode(c) {
    if (S.busy) return;
    S.busy = true;
    var fn = S.status === 'setcode' ? store.createCode : store.enterCode;
    fn(c).then(function () { S.busy = false; }, function (e) {
      S.busy = false; render();
      var pin = document.getElementById('pin'); if (pin) pin.classList.add('shake');
      showErr('gate-err', e.message);
    });
  }

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-action]');
    if (!el || el.disabled) return;
    var fn = A[el.dataset.action];
    if (fn) { ev.preventDefault(); fn(el); }
  });
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.id === 'search') { S.query = t.value; var r = document.getElementById('results'); if (r) r.innerHTML = flockList(); }
    if (t.id === 'who-search') { S.whoQuery = t.value; var w = document.getElementById('who-list'); if (w) w.innerHTML = whoResults(); }
    if (t.id === 'ask-search') { S.sheet.q = t.value; document.getElementById('ask-results').innerHTML = askResults(); }
    if (t.id === 'ask-msg') { S.sheet.edited = true; S.sheet.msg = t.value; }
    if (t.id === 'ask-time') { S.sheet.time = t.value; refreshMsg(); }
    if (t.id === 'ti-num') tFillTitle('ti-num', 'ti-title');
    if (t.id === 'to-num') tFillTitle('to-num', 'to-title');
    if (t.id === 'ti-title' || t.id === 'to-title') t.dataset.typed = t.value ? '1' : '';
    if (t.id === 'to-date' && S.sheet) S.sheet.date = t.value;
    if (t.id === 't-imp-text') tImpRefresh();
    if (t.id === 'pick-search') {
      S.sheet.q = t.value;
      document.getElementById('pick-list').innerHTML = pickResults(t.value.trim().toLowerCase(), S.sheet.type === 'pick');
    }
    if (t.id === 'gate-code') {
      t.value = t.value.replace(/\D/g, '').slice(0, 4);
      var pin = document.getElementById('pin');
      if (pin) { pin.classList.remove('shake'); pin.innerHTML = pinBoxes(t.value); }
      if (t.value.length === 4) gateCode(t.value);
    }
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.id === 'group-pick') { S.group = t.value; saveUi(); render(); }
    if (t.id === 's-cong') store.saveSettings({ congregationName: t.value.trim() });
    if (t.id === 's-od') store.saveSettings({ overdueDays: +t.value });
    if (t.id === 't-time') { var tc = tCfg(); store.putTalk('talkcfg', { day: tc.day, time: t.value || '10:00' }).then(function () { toast('Saved'); }); }
    if (t.id === 's-phone' && me()) store.savePublisher({ id: S.meId, phone: digits(t.value) }).then(function () { toast('Saved'); });
    if (t.classList && t.classList.contains('ask-phone')) {
      var num = digits(t.value), pid = t.dataset.pid;
      if (num.length >= 10) store.savePublisher({ id: pid, phone: num }).then(function () { keepAsk(); renderSheet(); toast('Number saved'); });
    }
    if (t.id === 'ask-text' || t.id === 'ask-share') { keepAsk(); S.sheet[t.id === 'ask-text' ? 'text' : 'share'] = t.checked; renderSheet(); }
    if (t.id === 't-imp-replace') tImpRefresh();
    if (t.id === 't-imp-file' && t.files && t.files[0]) {
      var fr = new FileReader();
      fr.onload = function () { var ta = document.getElementById('t-imp-text'); if (ta) ta.value = String(fr.result).replace(/^\ufeff/, ''); t.value = ''; tImpRefresh(); };
      fr.readAsText(t.files[0]);
    }
    if (t.id === 'import-file' && t.files && t.files[0]) {
      var r = new FileReader();
      r.onload = function () {
        openSheet(planImport(parseRoster(String(r.result)))); t.value = '';
      };
      r.readAsText(t.files[0]);
    }
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && S.sheet) closeSheet(); });

  /* ---------------- CSV import ---------------- */
  function parseCsv(text) {
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = ''; if (row.some(function (x) { return x.trim(); })) rows.push(row); row = [];
      } else f += c;
    }
    row.push(f); if (row.some(function (x) { return x.trim(); })) rows.push(row);
    return rows;
  }
  function normRank(r, status) {
    var s = String(r || '').trim().toLowerCase();
    for (var i = 0; i < RANKS.length; i++) if (RANKS[i].toLowerCase() === s) return RANKS[i];
    var alias = { ms: 'Ministerial Servant', servant: 'Ministerial Servant', rp: 'Regular Pioneer', ap: 'Auxiliary Pioneer', 'aux pioneer': 'Auxiliary Pioneer',
      'regular pioneer': 'Regular Pioneer', 'auxiliary pioneer': 'Auxiliary Pioneer', 'special pioneer': 'Special Pioneer' };
    if (alias[s]) return alias[s];
    return /inactive/i.test(status || '') ? 'Inactive' : /removed/i.test(status || '') ? 'Removed' : 'Publisher';
  }
  function normPioneer(s) {
    s = String(s || '').trim().toLowerCase();
    if (!s || s === 'no' || s === 'none') return '';
    if (/^(rp|regular|regular pioneer|pioneer|yes|y)$/.test(s)) return 'Regular Pioneer';
    if (/^(ap|aux|auxiliary|auxiliary pioneer)$/.test(s)) return 'Auxiliary Pioneer';
    if (/special/.test(s)) return 'Special Pioneer';
    return '';
  }
  /* Compare an imported list with who is already in Embrace: add new people, update
     privileges/pioneer/roles of people already here (matched by name), and record any
     earlier visit dates the list carries. */
  function planImport(rows) {
    var byName = {};
    S.data.publishers.forEach(function (p) { byName[p.name.toLowerCase()] = p; });
    var fresh = [], updates = [], visits = [], removes = [];
    var stampId = function () { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9); };
    rows.forEach(function (r) {
      var cur = byName[r.name.toLowerCase()], id;
      if (r.remove) { if (cur && cur.id) removes.push(cur.id); return; }
      if (!cur) {
        id = stampId();
        var add = { id: id, name: r.name, rank: r.rank, pioneer: r.pioneer, roles: r.roles, appointedWife: r.appointedWife, group: r.group, note: r.note, phone: r.phone || '' };
        fresh.push(add); byName[r.name.toLowerCase()] = add;
      } else {
        id = cur.id;
        var up = { id: id }, changed = false;
        // A plain "Publisher" in an older list never demotes someone already marked Elder or Servant here.
        var keep = r.rank === 'Publisher' && (cur.rank === 'Elder' || cur.rank === 'Ministerial Servant');
        if (r.rank !== cur.rank && !keep) { up.rank = r.rank; changed = true; }
        if ((r.pioneer || '') !== (cur.pioneer || '')) { up.pioneer = r.pioneer; changed = true; }
        if (r.roles.join('|') !== (cur.roles || []).join('|')) { up.roles = r.roles; changed = true; }
        if (r.appointedWife && !cur.appointedWife) { up.appointedWife = true; changed = true; }
        if (r.group && r.group !== cur.group) { up.group = r.group; changed = true; }
        if (r.phone && r.phone !== digits(cur.phone)) { up.phone = r.phone; changed = true; }
        if (changed) updates.push(up);
      }
      if (r.lastVisit) {
        var l = cur ? last(cur) : null;
        if (!l || l.date < r.lastVisit) {
          visits.push({ publisherId: id, publisherName: r.name, date: r.lastVisit, elders: [], elderIds: [],
            notes: 'Recorded when the list was brought into Embrace (visit made before Embrace).', followUp: false, by: S.meId || '' });
        }
      }
    });
    var plain = rows.filter(function (r) { return !r.remove; }).length;
    return { type: 'import', rows: fresh, updates: updates, visits: visits, removes: removes, skipped: plain - fresh.length - updates.length };
  }
  function parseRoster(text) {
    var rows = parseCsv(text.replace(/^﻿/, ''));
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return h.trim().toLowerCase().replace(/\s+/g, '_'); });
    var col = function (n) { return head.indexOf(n); }, hasHead = col('name') >= 0, iName = hasHead ? col('name') : 0, out = [];
    (hasHead ? rows.slice(1) : rows).forEach(function (r) {
      var name = (r[iName] || '').trim().replace(/\s+/g, ' ');
      if (!name) return;
      var get = function (n) { var i = col(n); return i >= 0 ? (r[i] || '').trim() : ''; };
      if (/^(delete|deceased|remove from embrace)$/i.test(get('status'))) { out.push({ name: name, remove: true, roles: [] }); return; }
      var rank = normRank(get('rank'), get('status')), pioneer = normPioneer(get('pioneer'));
      if (/Pioneer$/.test(rank)) { pioneer = pioneer || rank; rank = 'Publisher'; }
      if (/inactive/i.test(get('status')) && rank === 'Publisher' && !pioneer) rank = 'Inactive';
      var roles = get('roles').split(/[;|\/]/).map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) {
        for (var i = 0; i < ROLES.length; i++) if (ROLES[i].toLowerCase() === x.toLowerCase()) return ROLES[i];
        return x;
      });
      var lv = get('last_visit');
      out.push({ name: name, rank: rank, pioneer: pioneer, roles: roles, appointedWife: /^(y|yes|true|x|1)$/i.test(get('appointed_wife')),
        group: get('group'), note: get('note'), phone: digits(get('phone')), lastVisit: /^\d{4}-\d{2}-\d{2}$/.test(lv) ? lv : '' });
    });
    return out;
  }
  window.EmbraceParseRoster = parseRoster;

  /* ---------------- phone numbers from a shared link ----------------
     A link ending in #phones=... carries "name:number" pairs (never stored in the code).
     Once this phone is unlocked and the list has loaded, matching people get their numbers. */
  var pendingPerson = null;
  (function () {
    var h = location.hash || '';
    if (h.indexOf('#person=') !== 0) return;
    try {
      var bits = decodeURIComponent(h.slice(8)).split('|');
      if (bits[0] && bits[0].trim()) { pendingPerson = { name: bits[0].trim(), rank: bits[1] || 'Elder', role: bits[2] || '' }; lsSet('embrace-person', JSON.stringify(pendingPerson)); }
    } catch (e) { /* bad link */ }
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  })();
  if (!pendingPerson) { try { pendingPerson = JSON.parse(lsGet('embrace-person') || 'null'); } catch (e) { pendingPerson = null; } }
  function applyPendingPerson() {
    if (!pendingPerson || !S.loaded) return;
    var want = pendingPerson; pendingPerson = null; lsSet('embrace-person', null);
    var have = S.data.publishers.filter(function (p) { return p.name.toLowerCase() === want.name.toLowerCase(); })[0];
    var roles = want.role ? [want.role] : [];
    if (have) {
      if (have.rank !== want.rank || (want.role && (have.roles || []).indexOf(want.role) < 0)) {
        store.savePublisher({ id: have.id, rank: want.rank, roles: (have.roles || []).concat(roles).filter(function (r, i, a) { return a.indexOf(r) === i; }) });
      }
      return;
    }
    store.savePublisher({ name: want.name, rank: want.rank, roles: roles, pioneer: '', group: '', appointedWife: false, note: '' })
      .then(function () { toast(firstName(want.name) + ' can now sign in'); });
  }

  var pendingPhones = null;
  (function () {
    var h = location.hash || '';
    if (h.indexOf('#phones=') !== 0) return;
    try {
      var raw = decodeURIComponent(h.slice(8)), out = {};
      raw.split(';').forEach(function (pair) { var i = pair.lastIndexOf(':'); if (i > 0) out[pair.slice(0, i).trim().toLowerCase()] = digits(pair.slice(i + 1)); });
      pendingPhones = out;
      lsSet('embrace-phones', JSON.stringify(out));
    } catch (e) { /* bad link */ }
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  })();
  if (!pendingPhones) { try { pendingPhones = JSON.parse(lsGet('embrace-phones') || 'null'); } catch (e) { pendingPhones = null; } }
  function applyPendingPhones() {
    if (!pendingPhones || !S.loaded || !S.data.publishers.length) return;
    var ups = [], left = {};
    var byName = {}; S.data.publishers.forEach(function (p) { byName[p.name.toLowerCase()] = p; });
    Object.keys(pendingPhones).forEach(function (k) {
      var p = byName[k], n = pendingPhones[k];
      if (!p) { left[k] = n; return; }               // not in the list yet: keep for later
      if (n.length >= 10 && digits(p.phone) !== n) ups.push({ id: p.id, phone: n });
    });
    pendingPhones = Object.keys(left).length ? left : null;
    lsSet('embrace-phones', pendingPhones ? JSON.stringify(pendingPhones) : null);
    if (ups.length) store.updateMany(ups).then(function () { toast(ups.length + (ups.length === 1 ? ' phone number added' : ' phone numbers added')); });
  }

  /* ---------------- talks from a shared link ----------------
     A link ending in #talks=... carries a schedule as JSON (never stored in the code):
     { cfg: {day, time}, in: [{date, type, speaker, fromCong, number, title, notes, reason, confirmed}] }.
     type 'local' finds our brother by name. Weekends that already have something are left alone. */
  var pendingTalks = null;
  (function () {
    var h = location.hash || '';
    if (h.indexOf('#talks=') !== 0) return;
    try { pendingTalks = JSON.parse(decodeURIComponent(h.slice(7))); lsSet('embrace-talks', JSON.stringify(pendingTalks)); } catch (e) { /* bad link */ }
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  })();
  if (!pendingTalks) { try { pendingTalks = JSON.parse(lsGet('embrace-talks') || 'null'); } catch (e) { pendingTalks = null; } }
  function applyPendingTalks() {
    if (!pendingTalks || !S.loaded || !S.data.publishers.length) return;
    var p = pendingTalks; pendingTalks = null; lsSet('embrace-talks', null);
    var jobs = [], titles = Object.assign({}, tTitles()), added = 0, newTitles = false;
    if (p.cfg && (p.cfg.time || p.cfg.day != null)) {
      var c = tCfg();
      jobs.push(store.putTalk('talkcfg', { day: p.cfg.day != null ? +p.cfg.day : c.day, time: p.cfg.time || c.time }));
    }
    (p.in || []).forEach(function (t) {
      if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t.date || '') || tFilled(tIn(t.date))) return;
      var body = { type: t.type === 'none' || t.type === 'local' ? t.type : 'visitor', date: t.date };
      if (body.type === 'none') body.reason = t.reason || 'No public talk';
      else {
        if (body.type === 'local') {
          var b = S.data.publishers.filter(function (x) { return x.name.toLowerCase() === String(t.speaker || '').toLowerCase(); })[0];
          if (b) { body.speaker = b.name; body.localId = b.id; body.phone = digits(b.phone); }
          else { body.type = 'visitor'; body.speaker = t.speaker; body.fromCong = tCong(); }
          body.confirmed = true;
        } else {
          body.speaker = String(t.speaker || '').trim(); body.fromCong = t.fromCong || ''; body.phone = digits(t.phone || '');
          body.confirmed = !!t.confirmed;
        }
        if (!body.speaker) return;
        body.number = String(t.number || '').replace(/\D/g, ''); body.title = t.title || ''; body.notes = t.notes || '';
        if (body.number && body.title && titles[body.number] !== body.title) { titles[body.number] = body.title; newTitles = true; }
      }
      added++;
      jobs.push(store.putTalk('talk_in_' + t.date, body));
    });
    if (newTitles) jobs.push(store.putTalk('talktitles', { map: titles }));
    Promise.all(jobs).then(function () {
      if (added) { S.tab = 'talks'; S.tPart = 'year'; render(); toast(added + (added === 1 ? ' weekend' : ' weekends') + ' added to Talks'); }
    });
  }

  /* ---------------- boot ---------------- */
  var subscribed = false;
  store.init(function (st) {
    S.status = st.status; S.error = st.error || '';
    if (st.status === 'ready' && !subscribed) {
      subscribed = true;
      store.subscribe(function (d) {
        S.data = { publishers: d.publishers.map(norm), visits: d.visits, settings: d.settings, plans: d.plans || [], talks: d.talks || {} };
        S.loaded = d.ready !== false; rebuild();
        if (S.meId && S.loaded && !pub(S.meId)) { S.meId = null; lsSet('embrace-me', null); }
        render();
        applyPendingPhones();
        applyPendingPerson();
        applyPendingTalks();
        if (S.sheet && (S.sheet.type === 'visit' || S.sheet.type === 'status' || S.sheet.type === 'group' || S.sheet.type === 'plan' || S.sheet.type === 't-week' || S.sheet.type === 't-settings')) renderSheet();
      });
    }
    render();
  });
})();
