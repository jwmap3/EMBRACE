/* Embrace — shepherding visit tracker for the body of elders. */
(function () {
  'use strict';

  var VERSION = '3.1';
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
    late: { label: 'Overdue', long: 'Overdue for a visit', color: 'var(--st-late)' },
    none: { label: 'Not yet', long: 'Not visited yet', color: 'var(--st-none)' }
  };
  var ORDER = ['fresh', 'soon', 'late', 'none'];
  var PREVIEW = !!window.EMBRACE_PREVIEW;
  var store = window.EmbraceStore.create();

  var S = {
    status: 'loading', error: '', loaded: false,
    data: { publishers: [], visits: [], settings: { overdueDays: 180 } },
    tab: 'home', mode: 'priority', group: 'all', query: '',
    pubId: null, sheet: null, hop: null, scroll: {},
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
  function od() { return +(S.data.settings && S.data.settings.overdueDays) || 180; }
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
    settings: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
    search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    back: '<svg width="12" height="20" viewBox="0 0 11 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2L2 9l7 7"/></svg>',
    chev: '<svg class="chev" width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1l6 6-6 6"/></svg>',
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
    var w = waiting(p), st = state(p);
    var dot = '<i class="dot" style="background:' + STATUS[st].color + '"></i>';
    var t = w === null ? 'Never' : w <= 0 ? 'Today' : w + (w === 1 ? ' day' : ' days');
    return '<span class="end' + (st === 'late' || st === 'none' ? ' late' : '') + '">' + dot + t + I.chev + '</span>';
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

  /* ---------------- main views ---------------- */
  function viewHome() {
    var m = me(), cong = (S.data.settings && S.data.settings.congregationName) || 'Northwood Congregation';
    var all = flock(), counts = { fresh: 0, soon: 0, late: 0, none: 0 };
    all.forEach(function (p) { counts[state(p)]++; });
    var seen = counts.fresh + counts.soon;
    var pri = all.filter(isPriority), priDone = pri.filter(function (p) { var s = state(p); return s === 'fresh' || s === 'soon'; }).length;
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
      '<button class="pill-search glass rise" data-action="find">' + I.search + 'Find someone</button>';
    if (pri.length) {
      h += '<div class="glass pri"><div class="row"><b>Pioneers &amp; appointed</b><span>' + priDone + ' of ' + pri.length + '</span></div>' +
        '<div class="bar"><i style="width:' + Math.round(priDone / pri.length * 100) + '%"></i></div></div>';
    }
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
    } else {
      var g = {};
      list.forEach(function (p) { (g[p.group || 'No group'] = g[p.group || 'No group'] || []).push(p); });
      Object.keys(g).sort(function (a, b) { return a === 'No group' ? 1 : b === 'No group' ? -1 : a.localeCompare(b); })
        .forEach(function (k) { h += block(k === 'No group' ? k : k + ' group', g[k].sort(byName)); });
    }
    return h;
  }
  function viewFlock() {
    var opts = '<option value="all">All groups</option>' + idx.groups.map(function (g) {
      return '<option value="' + esc(g) + '"' + (S.group === g ? ' selected' : '') + '>' + esc(g) + '</option>';
    }).join('');
    return '<div class="screen"><div class="top"><h1 class="title">The Flock</h1><span class="sub">' + S.data.publishers.length + ' people · longest wait first</span></div>' +
      '<label class="search glass">' + I.search + '<span class="sr">Find a name</span><input id="search" type="search" autocomplete="off" placeholder="Find a name" value="' + esc(S.query) + '"></label>' +
      '<div class="filters"><div class="seg glass" role="group" aria-label="Sort">' +
      '<button data-action="mode" data-mode="priority" aria-pressed="' + (S.mode === 'priority') + '">Who\'s next</button>' +
      '<button data-action="mode" data-mode="everyone" aria-pressed="' + (S.mode === 'everyone') + '">By group</button></div>' +
      (idx.groups.length ? '<select class="pick glass" id="group-pick" aria-label="Field service group">' + opts + '</select>' : '') + '</div>' +
      '<div id="results" style="display:flex;flex-direction:column;gap:18px">' + flockList() + '</div></div>';
  }

  function viewPerson(p) {
    var vs = idx.byPub[p.id] || [], l = vs[0], w = l ? daysSince(l.date) : null, st = state(p);
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
      '<div class="stat"><small>' + STATUS[st].label + '</small><b style="color:' + STATUS[st].color + '">' +
      (w === null ? '—' : w <= 0 ? 'Today' : w + (w === 1 ? ' day' : ' days')) + '</b></div></div></div>' +
      '<button class="cta rise" data-action="log" data-id="' + esc(p.id) + '">' + I.plus + 'Log a Visit</button>' +
      (vs.length ? '<div class="glass list"><div class="card-head"><h2>Visits</h2></div>' + vs.map(function (v) { return noteRow(v, false); }).join('') + '</div>'
        : '<div class="glass empty"><span>No visits yet.</span></div>') +
      '<p class="foot">Notes are seen only by the elders.</p></div>';
  }

  function viewSettings() {
    var m = me(), cong = (S.data.settings && S.data.settings.congregationName) || 'Northwood Congregation', els = elders();
    var h = '<div class="screen"><div class="top"><h1 class="title">Settings</h1></div>' +
      '<div class="glass list">' +
      (m ? '<div class="cell"><span class="av" aria-hidden="true">' + esc(initials(m.name)) + '</span><span class="txt"><b>' + esc(m.name) + '</b><small>Using Embrace on this phone</small></span></div>' : '') +
      '<button class="action" data-action="switch">Not you? Choose your name</button></div>' +
      '<h2 class="label">Congregation</h2><div class="glass list">' +
      '<div class="field"><label for="s-cong">Name</label><input id="s-cong" type="text" value="' + esc(cong) + '" placeholder="Congregation name"></div>' +
      '<div class="field"><label for="s-od">Overdue after</label><select id="s-od">' + [[90, '3 months'], [120, '4 months'], [180, '6 months'], [365, '1 year']].map(function (o) {
        return '<option value="' + o[0] + '"' + (od() === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></div></div>' +
      '<h2 class="label">Elders</h2>' +
      (els.length ? '<div class="glass list">' + els.map(function (p) { return cell(p); }).join('') + '</div>' : '') +
      '<p class="foot" style="text-align:left;margin-top:-8px">Anyone marked Elder can pick his name the first time he opens Embrace.</p>' +
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
    return '<div class="tabs"><nav aria-label="Main">' + [['home', 'Home'], ['flock', 'Flock'], ['settings', 'Settings']].map(function (t) {
      return '<button data-action="tab" data-tab="' + t[0] + '"' + (S.tab === t[0] ? ' aria-current="page"' : '') + (S.hop === t[0] ? ' class="hop"' : '') + '>' + I[t[0]] + t[1] + '</button>';
    }).join('') + '</nav></div>';
  }

  /* ---------------- sheets ---------------- */
  function head(title, right, leftLabel) {
    return '<div class="grab" aria-hidden="true"></div><div class="sheet-head"><button class="link" data-action="close" style="justify-self:start">' + (leftLabel || 'Cancel') + '</button>' +
      '<h2 id="sheet-title">' + esc(title) + '</h2>' + (right || '<span></span>') + '</div>';
  }
  function pickResults(q, forLog) {
    var list = needOrder(S.data.publishers.filter(function (p) { return (p.rank !== 'Removed' || q) && (!q || p.name.toLowerCase().indexOf(q) >= 0); })).slice(0, q ? 40 : 6);
    if (!list.length) return '<div class="glass empty"><span>No name matches.</span></div>';
    return (q ? '' : '<h2 class="label" style="margin-bottom:8px">Waiting the longest</h2>') +
      '<div class="glass list">' + list.map(function (p) { return cell(p, forLog ? 'pick' : 'open'); }).join('') + '</div>';
  }
  function sheetPick(forLog) {
    var q = (S.sheet.q || '').trim().toLowerCase();
    return head(forLog ? 'Who did you visit?' : 'Find someone', null, 'Close') +
      '<label class="search glass">' + I.search + '<span class="sr">Find a name</span><input id="pick-search" type="search" autocomplete="off" placeholder="Type a name" value="' + esc(S.sheet.q || '') + '"></label>' +
      '<div id="pick-list">' + pickResults(q, forLog) + '</div>';
  }
  function sheetLog(p) {
    var sh = S.sheet, els = elders();
    if (S.meId && me() && !els.some(function (e) { return e.id === S.meId; })) els.unshift(me());
    els.sort(function (a, b) { return a.id === S.meId ? -1 : b.id === S.meId ? 1 : byName(a, b); });
    return head('Log a Visit', '<button class="link" data-action="save-visit">Save</button>') +
      '<div class="hero" style="padding:4px 0 0;gap:4px"><span class="av" aria-hidden="true">' + esc(initials(p.name)) + '</span><h1 style="font-size:24px;margin-top:4px">' + esc(p.name) + '</h1></div>' +
      '<h2 class="label">Who went with you?</h2><div class="glass"><div class="chips" role="group" aria-label="Elders on this visit">' +
      els.map(function (e) {
        return '<button class="chip" data-action="with" data-id="' + esc(e.id) + '" aria-pressed="' + (sh.with.indexOf(e.id) >= 0) + '">' + esc(e.id === S.meId ? 'Me' : e.name) + '</button>';
      }).join('') + '</div></div>' +
      '<h2 class="label">What day?</h2><div class="glass" id="cal">' + calendar() + '</div>' +
      '<h2 class="label"><label for="v-notes">Notes</label></h2><div class="glass list"><textarea id="v-notes" placeholder="What was shared, how they are doing, anything to follow up on"></textarea>' +
      '<label class="field" for="v-fu"><span>Needs a follow-up</span><input class="switch" id="v-fu" type="checkbox"></label></div>' +
      '<p class="err" id="v-err" role="alert" hidden></p>' +
      '<button class="cta" data-action="save-visit">Save Visit</button>';
  }
  function calendar() {
    var sh = S.sheet, y = sh.calY, m = sh.calM, today = todayStr(), now = new Date();
    var startDow = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    var canNext = y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth());
    var h = '<div class="cal"><div class="cal-head"><button class="link" data-action="cal" data-step="-1" aria-label="Previous month">' + I.left + '</button>' +
      '<b>' + MON[m] + ' ' + y + '</b><button class="link" data-action="cal" data-step="1" aria-label="Next month"' + (canNext ? '' : ' disabled style="opacity:.25"') + '>' + I.right + '</button></div>' +
      '<div class="cal-grid">' + ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (d) { return '<span class="dow">' + d + '</span>'; }).join('');
    for (var i = 0; i < startDow; i++) h += '<span></span>';
    for (var d = 1; d <= days; d++) {
      var s = y + '-' + pad(m + 1) + '-' + pad(d);
      h += '<button data-action="day" data-date="' + s + '"' + (s === today ? ' class="today"' : '') + (s > today ? ' disabled' : '') +
        ' aria-pressed="' + (s === sh.date) + '" aria-label="' + MON[m] + ' ' + d + '">' + d + '</button>';
    }
    return h + '</div></div>';
  }
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
    h += S.sheet.confirm
      ? '<div class="glass list"><div class="row-plain"><span>Delete this visit?</span></div><button class="action red" data-action="delete-visit" data-id="' + esc(v.id) + '">Delete</button><button class="action" data-action="unconfirm">Keep it</button></div>'
      : '<button class="quiet red" data-action="confirm">Delete visit</button>';
    return h;
  }
  function sheetStatus(st) {
    var list = needOrder(flock().filter(function (p) { return state(p) === st; }));
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
    var ups = sh.updates || [], vs = sh.visits || [];
    var rows = [['New people', sh.rows.length], ['Privileges updated', ups.length], ['Earlier visits recorded', vs.length], ['Already up to date', sh.skipped]];
    var any = sh.rows.length || ups.length || vs.length;
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
      $main.innerHTML = p ? viewPerson(p) : S.tab === 'home' ? viewHome() : S.tab === 'flock' ? viewFlock() : viewSettings();
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
    else if (sh.type === 'find') body = sheetPick(false);
    else if (sh.type === 'log') { var p = pub(sh.id); if (!p) return closeSheet(); body = sheetLog(p); }
    else if (sh.type === 'visit') { var v = visit(sh.id); if (!v) return closeSheet(); body = sheetVisit(v); }
    else if (sh.type === 'status') body = sheetStatus(sh.st);
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
  function logSheet(id) {
    var now = new Date();
    return { type: 'log', id: id, with: S.meId ? [S.meId] : [], date: todayStr(), calY: now.getFullYear(), calM: now.getMonth() };
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
    open: function (el) { openPerson(el.dataset.id); },
    back: function () { pop(function () { S.pubId = null; render(); window.scrollTo(0, S.scroll[S.tab] || 0); }); },
    'log-start': function () { openSheet({ type: 'pick', q: '' }); focusLater('pick-search'); },
    find: function () { openSheet({ type: 'find', q: '' }); focusLater('pick-search'); },
    status: function (el) { openSheet({ type: 'status', st: el.dataset.st }); },
    'all-visits': function () { openSheet({ type: 'visits' }); },
    pick: function (el) { swapSheet(logSheet(el.dataset.id)); },
    log: function (el) { openSheet(logSheet(el.dataset.id)); },
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
    day: function (el) { S.sheet.date = el.dataset.date; document.getElementById('cal').innerHTML = calendar(); },
    'save-visit': function () {
      var sh = S.sheet, p = pub(sh.id);
      if (!p || S.busy) return;
      if (!sh.with.length) return showErr('v-err', 'Tap at least one name under "Who went with you?"');
      if (sh.date > todayStr()) return showErr('v-err', 'Pick a day that has already happened.');
      var names = sh.with.map(function (id) { var e = pub(id); return e ? e.name : ''; }).filter(Boolean);
      S.busy = true;
      store.addVisit({
        publisherId: p.id, publisherName: p.name, date: sh.date, elders: names, elderIds: sh.with.slice(),
        notes: document.getElementById('v-notes').value.trim(), followUp: document.getElementById('v-fu').checked, by: S.meId
      }).then(function () { S.busy = false; closeSheet(); trot(firstName(p.name) + '’s visit saved'); }, fail('v-err'));
    },
    visit: function (el) { openSheet({ type: 'visit', id: el.dataset.id }); },
    'delete-visit': function (el) { store.deleteVisit(el.dataset.id).then(function () { closeSheet(); toast('Visit deleted'); }); },
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
        group: document.getElementById('p-group').value.trim(), note: document.getElementById('p-note').value.trim() };
      if (S.sheet.id) p.id = S.sheet.id;
      store.savePublisher(p).then(function () { closeSheet(); toast(p.id ? 'Saved' : firstName(name) + ' added'); }, fail('p-err'));
    },
    'delete-person': function () {
      var id = S.sheet.id;
      store.deletePublisher(id).then(function () { S.sheet = null; renderSheet(); S.pubId = null; render(); toast('Removed'); });
    },
    'import-pick': function () { var f = document.getElementById('import-file'); if (f) f.click(); },
    'do-import': function () {
      var rows = S.sheet.rows, ups = S.sheet.updates || [], vs = S.sheet.visits || [];
      store.importRoster(rows)
        .then(function () { return ups.length ? store.updateMany(ups) : null; })
        .then(function () { return vs.length ? store.addVisits(vs) : null; })
        .then(function () {
          closeSheet(); S.ringDrawn = false;
          toast([rows.length ? rows.length + ' added' : '', ups.length ? ups.length + ' updated' : '', vs.length ? vs.length + ' visits' : ''].filter(Boolean).join(' · ') || 'Nothing changed');
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
    var fresh = [], updates = [], visits = [];
    var stampId = function () { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9); };
    rows.forEach(function (r) {
      var cur = byName[r.name.toLowerCase()], id;
      if (!cur) {
        id = stampId();
        var add = { id: id, name: r.name, rank: r.rank, pioneer: r.pioneer, roles: r.roles, appointedWife: r.appointedWife, group: r.group, note: r.note };
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
    return { type: 'import', rows: fresh, updates: updates, visits: visits, skipped: rows.length - fresh.length - updates.length };
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
      var rank = normRank(get('rank'), get('status')), pioneer = normPioneer(get('pioneer'));
      if (/Pioneer$/.test(rank)) { pioneer = pioneer || rank; rank = 'Publisher'; }
      if (/inactive/i.test(get('status')) && rank === 'Publisher' && !pioneer) rank = 'Inactive';
      var roles = get('roles').split(/[;|\/]/).map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) {
        for (var i = 0; i < ROLES.length; i++) if (ROLES[i].toLowerCase() === x.toLowerCase()) return ROLES[i];
        return x;
      });
      var lv = get('last_visit');
      out.push({ name: name, rank: rank, pioneer: pioneer, roles: roles, appointedWife: /^(y|yes|true|x|1)$/i.test(get('appointed_wife')),
        group: get('group'), note: get('note'), lastVisit: /^\d{4}-\d{2}-\d{2}$/.test(lv) ? lv : '' });
    });
    return out;
  }
  window.EmbraceParseRoster = parseRoster;

  /* ---------------- boot ---------------- */
  var subscribed = false;
  store.init(function (st) {
    S.status = st.status; S.error = st.error || '';
    if (st.status === 'ready' && !subscribed) {
      subscribed = true;
      store.subscribe(function (d) {
        S.data = { publishers: d.publishers.map(norm), visits: d.visits, settings: d.settings };
        S.loaded = d.ready !== false; rebuild();
        if (S.meId && S.loaded && !pub(S.meId)) { S.meId = null; lsSet('embrace-me', null); }
        render();
        if (S.sheet && (S.sheet.type === 'visit' || S.sheet.type === 'status')) renderSheet();
      });
    }
    render();
  });
})();
