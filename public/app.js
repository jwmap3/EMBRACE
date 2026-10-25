/* Embrace — shepherding visit tracker for the body of elders. */
(function () {
  'use strict';

  var VERSION = '4.6';
  // A person has one privilege, an optional pioneer status, and any number of roles.
  var RANKS = ['Elder', 'Ministerial Servant', 'Publisher', 'Unbaptized Publisher', 'Inactive', 'Removed'];
  var PIONEERS = ['', 'Auxiliary Pioneer', 'Regular Pioneer', 'Special Pioneer'];
  var ROLES = ['Coordinator', 'Secretary', 'Service Overseer', 'Group Overseer'];
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
    pubId: null, sheet: null, hop: null, scroll: {}, open: {}, homeCal: { y: new Date().getFullYear(), m: new Date().getMonth() },
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
  function flock() { return S.data.publishers.filter(function (p) { return p.rank !== 'Removed'; }); }

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

  /* ---------------- main views ---------------- */
  function viewHome() {
    var m = me(), cong = (S.data.settings && S.data.settings.congregationName) || 'Northwood Congregation';
    var all = flock(), counts = { fresh: 0, soon: 0, late: 0, none: 0 };
    all.forEach(function (p) { counts[homeState(p)]++; });
    var seen = counts.fresh + counts.soon;
    var next = needOrder(all.filter(function (p) { return state(p) !== 'fresh'; })).slice(0, 3);
    var follow = S.data.publishers.filter(function (p) { var l = last(p); return l && l.followUp; }).sort(byNeed);
    var recent = S.data.visits.slice().sort(visitOrder).slice(0, 3);

    var h = '<div class="screen">' +
      '<div class="top rise"><span class="hello">' + greeting() + (m ? ', ' + esc(firstName(m.name)) : '') + '</span><h1 class="brand">Embrace</h1>' + (cong ? '<span class="sub">' + esc(cong) + '</span>' : '') + '</div>';
    // Until the congregation's list is in, the first thing on Home is the button to bring it in.
    if (S.data.publishers.length < 10) {
      h += '<div class="glass empty rise">' + sheep(70, 'bob') + '<b>Bring in your publishers</b>' +
        '<span>Tap below and choose the roster file (embrace-roster.csv). Everyone will appear here at once.</span>' +
        '<button class="cta" data-action="import-pick" style="margin-top:8px">Import publisher list</button>' +
        '<input id="import-file" type="file" accept=".csv,text/csv,text/plain,text/comma-separated-values,*/*" hidden></div>';
      if (!all.length) return h + '</div>';
    }
    h += '<div class="ring-wrap rise"><div class="ring-float"><div class="ring-glow"></div>' + ringSvg(counts, all.length) +
      '<div class="ring-center"><b>' + seen + '</b><span>of ' + all.length + ' visited in the last ' + odText() + '</span></div></div></div>' +
      '<div class="legend rise">' + ORDER.map(function (k) {
        return '<button class="key glass" data-action="status" data-st="' + k + '"><i style="background:' + STATUS[k].color + '"></i><span>' + STATUS[k].label + '</span><b>' + counts[k] + '</b></button>';
      }).join('') + '</div>' +
      '<button class="cta rise" data-action="log-start">' + I.plus + 'Log a Visit</button>' +
      '<div class="duo rise"><button class="pill-search glass" data-action="find">' + I.search + 'Find someone</button>' +
      '<button class="pill-search glass" data-action="ask" style="color:var(--accent);font-weight:600">' + I.chat + 'Ask a brother</button></div>';
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
    return h + '</div>';
  }

  function flockList() {
    var all = S.data.publishers;
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
    var els = elders().filter(function (p) { return !p.claimed; }), h = '<div class="welcome">' + sheep(110, 'bob') + '<h1>Who are you?</h1>';
    if (!S.whoAll && els.length) {
      return h + '<p>Tap your name. Embrace will remember you on this phone.</p>' +
        '<div class="glass list">' + els.map(function (p) { return cell(p, 'iam', true); }).join('') + '</div>' +
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
    return '<div class="tabs"><nav aria-label="Main">' + [['home', 'Home'], ['flock', 'Flock'], ['upcoming', 'Upcoming'], ['settings', 'Settings']].map(function (t) {
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
      $main.innerHTML = p ? viewPerson(p) : S.tab === 'home' ? viewHome() : S.tab === 'flock' ? viewFlock() : S.tab === 'upcoming' ? viewUpcoming() : viewSettings();
      $tabs.innerHTML = tabs();
      S.hop = null;
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
    if (t.id === 's-phone' && me()) store.savePublisher({ id: S.meId, phone: digits(t.value) }).then(function () { toast('Saved'); });
    if (t.classList && t.classList.contains('ask-phone')) {
      var num = digits(t.value), pid = t.dataset.pid;
      if (num.length >= 10) store.savePublisher({ id: pid, phone: num }).then(function () { keepAsk(); renderSheet(); toast('Number saved'); });
    }
    if (t.id === 'ask-text' || t.id === 'ask-share') { keepAsk(); S.sheet[t.id === 'ask-text' ? 'text' : 'share'] = t.checked; renderSheet(); }
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

  /* ---------------- boot ---------------- */
  var subscribed = false;
  store.init(function (st) {
    S.status = st.status; S.error = st.error || '';
    if (st.status === 'ready' && !subscribed) {
      subscribed = true;
      store.subscribe(function (d) {
        S.data = { publishers: d.publishers.map(norm), visits: d.visits, settings: d.settings, plans: d.plans || [] };
        S.loaded = d.ready !== false; rebuild();
        if (S.meId && S.loaded && !pub(S.meId)) { S.meId = null; lsSet('embrace-me', null); }
        render();
        applyPendingPhones();
        if (S.sheet && (S.sheet.type === 'visit' || S.sheet.type === 'status' || S.sheet.type === 'group' || S.sheet.type === 'plan')) renderSheet();
      });
    }
    render();
  });
})();
