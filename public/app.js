/* Embrace — shepherding visit tracker for a congregation's body of elders. */
(function () {
  'use strict';

  var VERSION = '1.0';
  var RANKS = ['Elder', 'Ministerial Servant', 'Regular Pioneer', 'Auxiliary Pioneer', 'Publisher', 'Inactive', 'Removed'];
  var BADGE = {
    'Elder': 'b-elder', 'Ministerial Servant': 'b-ms', 'Regular Pioneer': 'b-rp',
    'Auxiliary Pioneer': 'b-ap', 'Publisher': 'b-pub', 'Inactive': 'b-in', 'Removed': 'b-rm'
  };
  var HOW = ['In person', 'Phone', 'Video'];
  var PREVIEW = !!window.EMBRACE_PREVIEW;

  var store = window.EmbraceStore.create();
  var S = {
    auth: { status: 'loading' },
    data: { publishers: [], visits: [], elders: [], settings: { overdueDays: 180 } },
    tab: 'flock', mode: 'priority', group: 'all', query: '',
    pubId: null, sheet: null, toast: null, flockScroll: 0
  };
  var idx = { byPub: {}, groups: [] };

  try {
    var ui = JSON.parse(localStorage.getItem('embrace-ui') || '{}');
    if (ui.mode) S.mode = ui.mode;
    if (ui.group) S.group = ui.group;
  } catch (e) { /* storage blocked */ }
  function saveUi() {
    try { localStorage.setItem('embrace-ui', JSON.stringify({ mode: S.mode, group: S.group })); } catch (e) { /* ignore */ }
  }

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
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(s, short) {
    if (!s) return '';
    var d = parseDay(s);
    var t = MON[d.getMonth()] + ' ' + d.getDate();
    return short && d.getFullYear() === new Date().getFullYear() ? t : t + ', ' + d.getFullYear();
  }
  var SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv)$/i;
  function words(name) {
    return String(name || '').replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(function (w) { return w && !SUFFIX.test(w); });
  }
  function initials(name) {
    var w = words(name);
    if (!w.length) return '?';
    return (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
  }
  function lastName(name) { var w = words(name); return (w[w.length - 1] || '').toLowerCase(); }
  function byName(a, b) {
    return lastName(a.name).localeCompare(lastName(b.name)) || String(a.name).localeCompare(String(b.name));
  }
  function serviceYear() {
    var d = new Date(); var y = d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear();
    return { label: y, start: (y - 1) + '-09-01', end: y + '-08-31' };
  }
  function overdueDays() { return +(S.data.settings && S.data.settings.overdueDays) || 180; }
  function isActive(p) { return p.rank !== 'Inactive' && p.rank !== 'Removed'; }
  function isPriority(p) {
    return isActive(p) && (p.rank === 'Elder' || p.rank === 'Ministerial Servant' || p.rank === 'Regular Pioneer' || !!p.appointedWife);
  }
  function me() { return S.auth.user || { email: '', name: '' }; }
  function meElder() {
    var e = me().email;
    for (var i = 0; i < S.data.elders.length; i++) if (S.data.elders[i].email === e || S.data.elders[i].id === e) return S.data.elders[i];
    return null;
  }
  function isAdmin() { var e = meElder(); return !!(e && e.admin); }
  function pubById(id) {
    for (var i = 0; i < S.data.publishers.length; i++) if (S.data.publishers[i].id === id) return S.data.publishers[i];
    return null;
  }
  function visitById(id) {
    for (var i = 0; i < S.data.visits.length; i++) if (S.data.visits[i].id === id) return S.data.visits[i];
    return null;
  }
  function visitOrder(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (stamp(b.createdAt) - stamp(a.createdAt));
  }
  function stamp(t) { if (!t) return 0; if (typeof t === 'number') return t; if (t.toMillis) return t.toMillis(); return 0; }
  function elderNames(v) { return (v.elders || []).join(' & ') || 'Unknown'; }

  function rebuildIndex() {
    var byPub = {};
    S.data.visits.slice().sort(visitOrder).forEach(function (v) {
      (byPub[v.publisherId] = byPub[v.publisherId] || []).push(v);
    });
    var groups = {};
    S.data.publishers.forEach(function (p) { if (p.group) groups[p.group] = true; });
    idx = { byPub: byPub, groups: Object.keys(groups).sort() };
  }
  function last(p) { var l = idx.byPub[p.id]; return l && l[0] ? l[0] : null; }
  function waiting(p) { var l = last(p); return l ? daysSince(l.date) : null; }
  // Never visited first, then whoever has waited longest.
  function byNeed(a, b) {
    var wa = waiting(a), wb = waiting(b);
    if (wa === null && wb !== null) return -1;
    if (wb === null && wa !== null) return 1;
    if (wa !== null && wb !== null && wa !== wb) return wb - wa;
    return byName(a, b);
  }

  /* ---------------- icons ---------------- */
  var I = {
    sheep: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 8.5a2.6 2.6 0 0 1 4.2-1.2 2.6 2.6 0 0 1 4.3.6 2.6 2.6 0 0 1 1.7 4.4 2.6 2.6 0 0 1-2.6 3.2H9.2A2.6 2.6 0 0 1 7 12.6"/><ellipse cx="5.4" cy="10.6" rx="2.4" ry="2"/><path d="M9.5 15.5v3.5M15.5 15.5v3.5"/></svg>',
    crook: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21V8a4 4 0 0 1 8 0v1.5"/><path d="M17 9.5a1.4 1.4 0 0 1-2.8 0"/></svg>',
    gear: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
    search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    back: '<svg width="12" height="20" viewBox="0 0 11 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2L2 9l7 7"/></svg>',
    plus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    lock: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
  };
  var HILLS = '<svg class="hills" viewBox="0 0 260 150" aria-hidden="true">' +
    '<path class="h1" d="M60 112 C 110 70, 170 64, 260 88 L 260 150 L 30 150 Z"/>' +
    '<path class="h2" d="M120 128 C 170 100, 220 98, 260 110 L 260 150 L 100 150 Z"/>' +
    sheepArt(188, 70, 1) + sheepArt(142, 90, 0.7) + '</svg>';
  function sheepArt(x, y, s) {
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' +
      '<path class="wool" stroke-width="1.4" stroke-linejoin="round" d="M6 8a5 5 0 0 1 8-3 5 5 0 0 1 8 1 4.6 4.6 0 0 1 2 8 4.6 4.6 0 0 1-5 4H9a4.6 4.6 0 0 1-4.4-5"/>' +
      '<ellipse class="face" cx="3.6" cy="10.5" rx="3.6" ry="3"/>' +
      '<path class="leg" stroke-width="1.8" stroke-linecap="round" d="M10 18v5M18 18v5"/></g>';
  }

  /* ---------------- pieces ---------------- */
  function badges(p, withFollow) {
    var h = '<span class="badge ' + (BADGE[p.rank] || 'b-pub') + '">' + esc(p.rank || 'Publisher') + '</span>';
    if (p.appointedWife) h += '<span class="badge b-wife">Appointed wife</span>';
    if (withFollow) { var l = last(p); if (l && l.followUp) h += '<span class="badge b-fu">Follow up</span>'; }
    return h;
  }
  function dueHtml(p) {
    var w = waiting(p);
    if (w === null) return '<span class="due"><b class="over">Never</b><small>visited</small></span>';
    var cls = w > overdueDays() ? 'over' : 'fine';
    if (w <= 0) return '<span class="due"><b class="fine">Today</b><small>visited</small></span>';
    return '<span class="due"><b class="' + cls + '">' + w + (w === 1 ? ' day' : ' days') + '</b><small>since visit</small></span>';
  }
  function row(p) {
    return '<button class="row-btn" data-action="open" data-id="' + esc(p.id) + '">' +
      '<span class="av' + (isActive(p) ? '' : ' plain') + '" aria-hidden="true">' + esc(initials(p.name)) + '</span>' +
      '<span class="who"><span class="name">' + esc(p.name) + '</span><span class="badges">' + badges(p, true) + '</span></span>' +
      dueHtml(p) + '</button>';
  }
  function section(title, list, note) {
    if (!list.length) return '';
    return '<div class="section"><span>' + esc(title) + '</span><span>' + (note || list.length) + '</span></div>' +
      '<div class="card list">' + list.map(row).join('') + '</div>';
  }
  function emptyBox(title, text, extra) {
    return '<div class="card empty">' + I.sheep + '<b>' + esc(title) + '</b><span>' + esc(text) + '</span>' + (extra || '') + '</div>';
  }

  /* ---------------- views ---------------- */
  function flockResults() {
    var all = S.data.publishers;
    if (!all.length) {
      return emptyBox('Your flock is empty', isAdmin()
        ? 'Import your publisher list or add publishers one at a time in Settings.'
        : 'An elder with admin access needs to add the publishers first.',
        isAdmin() ? '<button class="secondary" data-action="tab" data-tab="settings">Go to Settings</button>' : '');
    }
    var q = S.query.trim().toLowerCase();
    var list = all.filter(function (p) {
      if (S.group !== 'all' && (p.group || '') !== S.group) return false;
      if (q && String(p.name).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    if (!list.length) return emptyBox('No one found', q ? 'No publisher matches "' + S.query.trim() + '".' : 'No publishers in this group yet.');

    var od = overdueDays();
    var h = '';
    if (S.mode === 'priority') {
      var pri = list.filter(isPriority).sort(byNeed);
      var pubs = list.filter(function (p) { return isActive(p) && !isPriority(p); }).sort(byNeed);
      var inact = list.filter(function (p) { return p.rank === 'Inactive'; }).sort(byNeed);
      var rem = list.filter(function (p) { return p.rank === 'Removed'; }).sort(byNeed);
      if (!q) {
        var cur = function (p) { var w = waiting(p); return w !== null && w <= od; };
        var priDone = pri.filter(cur).length;
        var actAll = pri.concat(pubs);
        var actDone = actAll.filter(cur).length;
        h += '<div class="card pad progress">' +
          progressRow('Pioneers & appointed', priDone, pri.length) +
          progressRow('All active publishers', actDone, actAll.length) +
          '<span class="muted" style="font-size:14px">Counted as visited if seen in the last ' + od + ' days.</span></div>';
      }
      h += section('Pioneers & appointed', pri);
      h += section('Publishers', pubs);
      h += section('Inactive', inact);
      h += section('Removed', rem);
      if (!pri.length && !q) h = '<p class="hint" style="margin:0">Mark elders, ministerial servants, regular pioneers and appointed wives on each publisher\'s page so they rise to the top.</p>' + h;
    } else if (S.mode === 'everyone') {
      var groups = {};
      list.forEach(function (p) { (groups[p.group || 'No group'] = groups[p.group || 'No group'] || []).push(p); });
      Object.keys(groups).sort(function (a, b) {
        if (a === 'No group') return 1; if (b === 'No group') return -1; return a.localeCompare(b);
      }).forEach(function (g) {
        var title = g === 'No group' ? g : g + ' group';
        h += section(title, groups[g].sort(byName));
      });
    } else {
      var never = list.filter(function (p) { return waiting(p) === null && p.rank !== 'Removed'; });
      var nPri = never.filter(isPriority).sort(byName);
      var nRest = never.filter(function (p) { return !isPriority(p); }).sort(byName);
      if (!never.length) return emptyBox('Everyone has been visited', 'Every publisher here has at least one shepherding visit logged.');
      h += section('Pioneers & appointed', nPri);
      h += section('Everyone else', nRest);
    }
    return h;
  }
  function progressRow(label, done, total) {
    var pct = total ? Math.round(done / total * 100) : 0;
    return '<div class="row"><strong>' + esc(label) + '</strong><span>' + done + ' of ' + total + '</span></div>' +
      '<div class="bar" role="img" aria-label="' + esc(label) + ': ' + done + ' of ' + total + ' visited"><i style="width:' + pct + '%"></i></div>';
  }

  function viewFlock() {
    var cong = (S.data.settings && S.data.settings.congregationName) || 'Congregation';
    var modes = [['priority', 'Priority'], ['everyone', 'Everyone'], ['never', 'Not visited']];
    var chips = '<button class="chip" data-action="group" data-group="all" aria-pressed="' + (S.group === 'all') + '">All groups</button>' +
      idx.groups.map(function (g) {
        return '<button class="chip" data-action="group" data-group="' + esc(g) + '" aria-pressed="' + (S.group === g) + '">' + esc(g) + '</button>';
      }).join('');
    return '<div class="screen">' + HILLS +
      '<div class="head"><div><div class="eyebrow">' + esc(cong) + '</div><h1 class="title">Shepherding</h1></div>' +
      '<button class="avatar-btn" data-action="tab" data-tab="settings" aria-label="Your account and settings">' + esc(initials(meElder() ? meElder().name : me().name)) + '</button></div>' +
      (store.mode === 'demo' ? '<div class="banner">Preview mode. Changes stay on this phone until Embrace is connected to your Google database.</div>' : '') +
      '<label class="search">' + I.search + '<span class="sr">Find a publisher</span><input id="search" type="search" autocomplete="off" placeholder="Find a publisher" value="' + esc(S.query) + '"></label>' +
      '<div class="seg" role="group" aria-label="Show">' + modes.map(function (m) {
        return '<button data-action="mode" data-mode="' + m[0] + '" aria-pressed="' + (S.mode === m[0]) + '">' + m[1] + '</button>';
      }).join('') + '</div>' +
      (idx.groups.length ? '<div class="chips" role="group" aria-label="Field service group">' + chips + '</div>' : '') +
      '<div id="flock-results" style="display:flex;flex-direction:column;gap:12px">' + flockResults() + '</div></div>';
  }

  function viewPublisher(p) {
    var visits = idx.byPub[p.id] || [];
    var l = visits[0];
    var w = l ? daysSince(l.date) : null;
    var sub = [p.group ? p.group + ' group' : '', p.note || ''].filter(Boolean).map(esc).join(' · ');
    return '<div class="screen">' +
      '<div class="nav"><button class="link" data-action="back">' + I.back + ' Flock</button>' +
      '<button class="link" data-action="edit-pub" data-id="' + esc(p.id) + '">Edit</button></div>' +
      '<div class="profile"><span class="av" aria-hidden="true">' + esc(initials(p.name)) + '</span>' +
      '<h1>' + esc(p.name) + '</h1><div class="badges" style="justify-content:center">' + badges(p, true) + '</div>' +
      (sub ? '<p>' + sub + '</p>' : '') + '</div>' +
      '<div class="stats"><div class="stat"><small>Last visit</small><b>' + (l ? esc(fmtDate(l.date)) : 'Never') + '</b></div>' +
      '<div class="stat"><small>Waiting</small><b class="' + (w === null || w > overdueDays() ? 'over' : 'fine') + '">' +
      (w === null ? 'No visit yet' : w <= 0 ? 'Visited today' : w + (w === 1 ? ' day' : ' days')) + '</b></div></div>' +
      '<button class="primary" data-action="log" data-id="' + esc(p.id) + '">' + I.plus + ' Log Shepherding Visit</button>' +
      '<div class="section"><span>Visit history</span><span class="lock">' + I.lock + ' Elders only</span></div>' +
      (visits.length ? '<div class="card list">' + visits.map(function (v) {
        return '<button class="visit" data-action="visit" data-id="' + esc(v.id) + '"><span class="top"><b>' + esc(fmtDate(v.date)) + '</b><span>' + esc(v.how || '') + '</span></span>' +
          '<span class="by">' + esc(elderNames(v)) + '</span>' +
          (v.followUp ? '<span class="badges"><span class="badge b-fu">Needs follow-up</span></span>' : '') +
          (v.notes ? '<p>' + esc(v.notes) + '</p>' : '') + '</button>';
      }).join('') + '</div>'
        : '<div class="card empty"><b>No visits yet</b><span>The first visit you log will show here.</span></div>') +
      '</div>';
  }

  function viewActivity() {
    var sy = serviceYear();
    var inYear = S.data.visits.filter(function (v) { return v.date >= sy.start && v.date <= sy.end; });
    var counts = {};
    S.data.elders.forEach(function (e) { counts[e.name] = 0; });
    inYear.forEach(function (v) { (v.elders || []).forEach(function (n) { counts[n] = (counts[n] || 0) + 1; }); });
    var names = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    var max = Math.max.apply(null, names.map(function (n) { return counts[n]; }).concat([1]));
    var visitedPeople = {};
    inYear.forEach(function (v) { visitedPeople[v.publisherId] = true; });

    var follow = S.data.publishers.filter(function (p) { var l = last(p); return l && l.followUp; }).sort(byNeed);
    var recent = S.data.visits.slice().sort(visitOrder).slice(0, 30);

    var h = '<div class="screen">' + HILLS +
      '<div class="head"><div><div class="eyebrow">' + sy.label + ' service year</div><h1 class="title">Activity</h1></div></div>' +
      '<div class="card pad" style="display:flex;flex-direction:column;gap:14px">' +
      '<div style="display:flex;align-items:center;gap:14px"><span class="av" style="width:56px;height:56px;border-radius:28px" aria-hidden="true">' + I.sheep + '</span>' +
      '<div><div style="font-size:34px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums">' + inYear.length + '</div>' +
      '<div class="muted">visits · ' + Object.keys(visitedPeople).length + ' publishers seen</div></div></div>' +
      names.map(function (n) {
        return '<div style="display:flex;flex-direction:column;gap:6px"><div class="progress"><div class="row"><strong>' + esc(n) + '</strong><span>' + counts[n] + (counts[n] === 1 ? ' visit' : ' visits') + '</span></div></div>' +
          '<div class="bar"><i style="width:' + Math.round(counts[n] / max * 100) + '%"></i></div></div>';
      }).join('') + '</div>';
    if (follow.length) h += section('Needs follow-up', follow);
    h += '<div class="section"><span>Recent visits</span></div>';
    if (!recent.length) {
      h += emptyBox('No visits yet', 'Open a publisher in Flock and tap Log Shepherding Visit.');
    } else {
      h += '<div class="card list">' + recent.map(function (v) {
        var p = pubById(v.publisherId);
        return '<button class="visit" data-action="visit" data-id="' + esc(v.id) + '"><span class="top"><b>' + esc(p ? p.name : v.publisherName) + '</b><span>' + esc(fmtDate(v.date, true)) + '</span></span>' +
          '<span class="by">' + esc(elderNames(v)) + (v.how ? ' · ' + esc(v.how) : '') + '</span></button>';
      }).join('') + '</div>';
    }
    return h + '</div>';
  }

  function viewSettings() {
    var u = me(); var mine = meElder(); var admin = isAdmin();
    var od = overdueDays();
    var cong = (S.data.settings && S.data.settings.congregationName) || '';
    var elders = S.data.elders.slice().sort(byName);
    var h = '<div class="screen">' +
      '<div class="head"><div><div class="eyebrow">Embrace ' + VERSION + '</div><h1 class="title">Settings</h1></div></div>' +
      '<div class="card"><div class="field" style="justify-content:flex-start"><span class="av" aria-hidden="true">' + esc(initials(mine ? mine.name : u.name)) + '</span>' +
      '<div style="min-width:0"><div class="name">' + esc(mine ? mine.name : u.name) + '</div><div class="muted" style="font-size:15px;overflow-wrap:anywhere">' + esc(u.email) + (admin ? ' · Admin' : '') + '</div></div></div></div>' +
      (store.mode === 'live' ? '<button class="secondary" data-action="sign-out">Sign out</button>' : '') +

      '<div class="section"><span>Congregation</span></div><div class="card list">' +
      '<div class="field"><label for="s-cong">Name</label><input id="s-cong" type="text" value="' + esc(cong) + '" placeholder="Congregation name"' + (admin ? '' : ' disabled') + '></div>' +
      '<div class="stack"><span>Overdue after</span><div class="seg" role="group" aria-label="Overdue after">' +
      [90, 120, 180, 365].map(function (d) {
        return '<button data-action="overdue" data-days="' + d + '" aria-pressed="' + (od === d) + '"' + (admin ? '' : ' disabled') + '>' + (d === 365 ? '1 year' : (d / 30) + ' mo') + '</button>';
      }).join('') + '</div></div></div>' +
      '<p class="hint">Publishers turn orange when they have waited longer than this.</p>' +

      '<div class="section"><span>Elders</span><span>' + elders.length + '</span></div><div class="card list">' +
      elders.map(function (e) {
        var inner = '<span class="av" aria-hidden="true">' + esc(initials(e.name)) + '</span><span class="who"><span class="name">' + esc(e.name) + '</span>' +
          '<span class="muted" style="font-size:15px;overflow-wrap:anywhere">' + esc(e.email || e.id) + '</span></span>' + (e.admin ? '<span class="badge b-elder">Admin</span>' : '');
        return admin ? '<button class="row-btn" data-action="edit-elder" data-id="' + esc(e.email || e.id) + '">' + inner + '</button>'
          : '<div class="row-btn" style="cursor:default">' + inner + '</div>';
      }).join('') +
      (admin ? '<button class="row-btn" data-action="new-elder" style="color:var(--accent);font-weight:600;min-height:56px">' + I.plus + ' Add an elder</button>' : '') +
      '</div><p class="hint">Only elders on this list can sign in. Each one signs in with the Gmail address shown.</p>';

    if (admin) {
      h += '<div class="section"><span>Publishers</span><span>' + S.data.publishers.length + '</span></div><div class="card list">' +
        '<button class="row-btn" data-action="new-pub" style="color:var(--accent);font-weight:600;min-height:56px">' + I.plus + ' Add a publisher</button>' +
        '<button class="row-btn" data-action="import-pick" style="color:var(--accent);font-weight:600;min-height:56px">Import a publisher list (CSV)</button>' +
        '</div><input id="import-file" type="file" accept=".csv,text/csv,text/plain" hidden>';
    }
    if (store.mode === 'demo') {
      h += '<div class="section"><span>Preview</span></div>' +
        (S.sheet === null && S.confirmReset
          ? '<div class="confirm"><button class="secondary" data-action="cancel-reset">Keep</button><button class="danger" data-action="do-reset">Erase preview data</button></div>'
          : '<button class="danger" data-action="reset-demo">Reset preview</button>');
    }
    h += '<p class="hint" style="margin-top:4px">Visit notes are confidential and can only be read by the elders listed above.</p>';
    return h + '</div>';
  }

  function viewSignin() {
    var a = S.auth;
    var msg = '';
    if (a.status === 'loading') msg = '<p>Opening…</p>';
    else if (a.status === 'denied') {
      msg = '<p><strong>' + esc(a.user.email) + '</strong> is not on the elders list yet. Ask the coordinator to add this Gmail address in Settings, then sign in again.</p>' +
        '<button class="secondary" data-action="sign-out" style="max-width:320px">Use a different account</button>';
    } else {
      msg = '<p>For the body of elders. Sign in with the Gmail address the coordinator added for you.</p>' +
        '<button class="primary" data-action="sign-in">Sign in with Google</button>' +
        (a.error ? '<p class="error" role="alert">' + esc(a.error) + '</p>' : '');
    }
    return '<div class="signin"><span class="av" style="width:96px;height:96px;border-radius:48px" aria-hidden="true">' +
      I.sheep.replace(/width="28" height="28"/, 'width="56" height="56"') + '</span><h1>Embrace</h1>' + msg + '</div>';
  }

  function tabsHtml() {
    var t = [['flock', 'Flock', I.sheep], ['activity', 'Activity', I.crook], ['settings', 'Settings', I.gear]];
    return '<div class="tabs"><nav aria-label="Main">' + t.map(function (x) {
      return '<button data-action="tab" data-tab="' + x[0] + '"' + (S.tab === x[0] ? ' aria-current="page"' : '') + '>' + x[2] + x[1] + '</button>';
    }).join('') + '</nav></div>';
  }

  /* ---------------- sheets ---------------- */
  function sheetHead(title, right) {
    return '<div class="grabber" aria-hidden="true"></div><div class="sheet-head">' +
      '<button class="link" data-action="close-sheet" style="justify-self:start">' + (right ? 'Cancel' : 'Close') + '</button>' +
      '<h2 id="sheet-title">' + esc(title) + '</h2>' + (right || '<span></span>') + '</div>';
  }
  function sheetLog(p) {
    var mine = me().email;
    var elders = S.data.elders.slice().sort(function (a, b) {
      var am = (a.email || a.id) === mine, bm = (b.email || b.id) === mine;
      return am === bm ? byName(a, b) : (am ? -1 : 1);
    });
    return sheetHead('Log Visit', '<button class="link" data-action="save-visit" data-id="' + esc(p.id) + '">Save</button>') +
      '<div class="card list"><div class="field"><span>Publisher</span><span class="muted" style="text-align:right">' + esc(p.name) + '</span></div>' +
      '<div class="field"><label for="v-date">Date</label><input id="v-date" type="date" value="' + todayStr() + '" max="' + todayStr() + '"></div>' +
      '<div class="stack"><span>How</span><div class="seg" role="group" aria-label="How">' + HOW.map(function (h, i) {
        return '<button data-action="seg" data-group="how" data-value="' + h + '" aria-pressed="' + (i === 0) + '">' + h + '</button>';
      }).join('') + '</div></div></div>' +
      '<div class="section"><span>Elders on this visit</span></div><div class="card list">' +
      elders.map(function (e, i) {
        var em = e.email || e.id;
        return '<label class="field" for="v-e' + i + '"><span>' + esc(e.name) + (em === mine ? ' <span class="muted">(you)</span>' : '') + '</span>' +
          '<input class="check v-elder" id="v-e' + i + '" type="checkbox" data-name="' + esc(e.name) + '" data-email="' + esc(em) + '"' + (em === mine ? ' checked' : '') + '></label>';
      }).join('') + '</div>' +
      '<div class="section"><label for="v-notes">Notes</label><span class="lock">' + I.lock + ' Elders only</span></div>' +
      '<div class="card list"><textarea id="v-notes" placeholder="Scriptures shared, encouragement given, anything to follow up on"></textarea>' +
      '<label class="field" for="v-fu"><span>Needs follow-up</span><input class="check" id="v-fu" type="checkbox"></label></div>' +
      '<p class="error" id="v-err" role="alert" hidden></p>' +
      '<button class="primary" data-action="save-visit" data-id="' + esc(p.id) + '">Save Visit</button>';
  }
  function sheetVisit(v) {
    var p = pubById(v.publisherId);
    var canDelete = isAdmin() || v.createdBy === me().email;
    var h = sheetHead('Visit') +
      '<div class="card list"><div class="field"><span>Publisher</span><span class="muted" style="text-align:right">' + esc(p ? p.name : v.publisherName) + '</span></div>' +
      '<div class="field"><span>Date</span><span class="muted">' + esc(fmtDate(v.date)) + '</span></div>' +
      '<div class="field"><span>How</span><span class="muted">' + esc(v.how || '—') + '</span></div>' +
      '<div class="field"><span>Elders</span><span class="muted" style="text-align:right">' + esc(elderNames(v)) + '</span></div>' +
      (v.followUp ? '<div class="field"><span>Follow-up</span><span class="badge b-fu">Needed</span></div>' : '') + '</div>' +
      '<div class="section"><span>Notes</span><span class="lock">' + I.lock + ' Elders only</span></div>' +
      '<div class="card pad" style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:17px;line-height:1.5">' + (v.notes ? esc(v.notes) : '<span class="muted">No notes were added.</span>') + '</div>';
    if (p && S.pubId !== p.id) h += '<button class="secondary" data-action="open" data-id="' + esc(p.id) + '">Open ' + esc(p.name) + '</button>';
    if (canDelete) {
      h += S.sheet.confirm
        ? '<p class="hint" style="margin:0;text-align:center">Delete this visit? This cannot be undone.</p><div class="confirm"><button class="secondary" data-action="unconfirm">Keep</button><button class="danger" data-action="delete-visit" data-id="' + esc(v.id) + '">Delete</button></div>'
        : '<button class="danger" data-action="confirm">Delete visit</button>';
    }
    return h;
  }
  function sheetEditPub(p) {
    var isNew = !p; p = p || { name: '', rank: 'Publisher', group: S.group !== 'all' ? S.group : '', appointedWife: false, note: '' };
    var h = sheetHead(isNew ? 'New Publisher' : 'Edit Publisher', '<button class="link" data-action="save-pub" data-id="' + esc(p.id || '') + '">Save</button>') +
      '<div class="card list">' +
      '<div class="field"><label for="p-name">Name</label><input id="p-name" type="text" value="' + esc(p.name) + '" placeholder="Full name" autocomplete="off"></div>' +
      '<div class="field"><label for="p-rank">Privilege</label><select id="p-rank">' + RANKS.map(function (r) {
        return '<option' + (r === (p.rank || 'Publisher') ? ' selected' : '') + '>' + r + '</option>';
      }).join('') + '</select></div>' +
      '<label class="field" for="p-wife"><span>Appointed wife</span><input class="check" id="p-wife" type="checkbox"' + (p.appointedWife ? ' checked' : '') + '></label>' +
      '<div class="field"><label for="p-group">Group</label><input id="p-group" type="text" list="p-groups" value="' + esc(p.group || '') + '" placeholder="Group overseer"></div>' +
      '<datalist id="p-groups">' + idx.groups.map(function (g) { return '<option value="' + esc(g) + '"></option>'; }).join('') + '</datalist>' +
      '<div class="field"><label for="p-note">Note</label><input id="p-note" type="text" value="' + esc(p.note || '') + '" placeholder="e.g. Away until April 2027"></div>' +
      '</div><p class="error" id="p-err" role="alert" hidden></p>' +
      '<button class="primary" data-action="save-pub" data-id="' + esc(p.id || '') + '">Save</button>';
    if (!isNew && isAdmin()) {
      h += S.sheet.confirm
        ? '<p class="hint" style="margin:0;text-align:center">Remove ' + esc(p.name) + ' and all of their visits? This cannot be undone.</p><div class="confirm"><button class="secondary" data-action="unconfirm">Keep</button><button class="danger" data-action="delete-pub" data-id="' + esc(p.id) + '">Remove</button></div>'
        : '<button class="danger" data-action="confirm">Remove from Embrace</button>';
    }
    return h;
  }
  function sheetElder(e) {
    var isNew = !e; e = e || { name: '', email: '', admin: false };
    var email = e.email || e.id || '';
    var self = email === me().email;
    var h = sheetHead(isNew ? 'Add Elder' : 'Edit Elder', '<button class="link" data-action="save-elder" data-id="' + esc(email) + '">Save</button>') +
      '<div class="card list">' +
      '<div class="field"><label for="e-name">Name</label><input id="e-name" type="text" value="' + esc(e.name) + '" placeholder="Full name"></div>' +
      '<div class="field"><label for="e-email">Gmail</label><input id="e-email" type="email" value="' + esc(email) + '" placeholder="name@gmail.com"' + (isNew ? '' : ' disabled') + ' autocomplete="off" autocapitalize="off"></div>' +
      '<label class="field" for="e-admin"><span>Admin</span><input class="check" id="e-admin" type="checkbox"' + (e.admin ? ' checked' : '') + (self ? ' disabled' : '') + '></label></div>' +
      '<p class="hint">Admins can add elders and publishers and change settings. The coordinator and secretary are good choices.</p>' +
      '<p class="error" id="e-err" role="alert" hidden></p>' +
      '<button class="primary" data-action="save-elder" data-id="' + esc(email) + '">Save</button>';
    if (!isNew && !self) {
      h += S.sheet.confirm
        ? '<div class="confirm"><button class="secondary" data-action="unconfirm">Keep</button><button class="danger" data-action="remove-elder" data-id="' + esc(email) + '">Remove access</button></div>'
        : '<button class="danger" data-action="confirm">Remove ' + esc(e.name) + '</button>';
    }
    return h;
  }
  function sheetImport(sh) {
    var rows = sh.rows;
    var groups = {};
    rows.forEach(function (r) { groups[r.group || 'No group'] = (groups[r.group || 'No group'] || 0) + 1; });
    return sheetHead('Import Publishers') +
      '<div class="card list">' + Object.keys(groups).sort().map(function (g) {
        return '<div class="field"><span>' + esc(g) + '</span><span class="muted">' + groups[g] + '</span></div>';
      }).join('') + '</div>' +
      (sh.skipped ? '<p class="hint" style="margin:0">' + sh.skipped + ' name' + (sh.skipped === 1 ? ' is' : 's are') + ' already in Embrace and will be skipped.</p>' : '') +
      (rows.length ? '<button class="primary" data-action="do-import">Add ' + rows.length + ' publishers</button>'
        : '<p class="hint" style="margin:0">Nothing new to add.</p>');
  }

  /* ---------------- rendering ---------------- */
  var root = document.getElementById('app');
  root.innerHTML = '<main id="main"></main><div id="tabs"></div><div id="sheet-root"></div><div id="toast-root" aria-live="polite"></div>';
  var $main = document.getElementById('main');
  var $tabs = document.getElementById('tabs');
  var $sheet = document.getElementById('sheet-root');
  var $toast = document.getElementById('toast-root');

  function render() {
    if (S.auth.status !== 'in') {
      $main.innerHTML = viewSignin(); $tabs.innerHTML = ''; $sheet.innerHTML = ''; return;
    }
    var active = document.activeElement;
    var refocus = active && active.id === 'search' ? active.selectionStart : null;
    var p = S.pubId ? pubById(S.pubId) : null;
    if (S.pubId && !p) S.pubId = null;
    if (S.tab === 'flock') $main.innerHTML = p ? viewPublisher(p) : viewFlock();
    else if (S.tab === 'activity') $main.innerHTML = viewActivity();
    else $main.innerHTML = viewSettings();
    $tabs.innerHTML = tabsHtml();
    if (refocus !== null) {
      var s = document.getElementById('search');
      if (s) { s.focus(); try { s.setSelectionRange(refocus, refocus); } catch (e) { /* ignore */ } }
    }
  }
  function renderSheet() {
    var sh = S.sheet;
    if (!sh) { $sheet.innerHTML = ''; document.body.style.overflow = ''; return; }
    var body = '';
    if (sh.type === 'log') { var p = pubById(sh.id); if (!p) return closeSheet(); body = sheetLog(p); }
    else if (sh.type === 'visit') { var v = visitById(sh.id); if (!v) return closeSheet(); body = sheetVisit(v); }
    else if (sh.type === 'pub') body = sheetEditPub(sh.id ? pubById(sh.id) : null);
    else if (sh.type === 'elder') {
      var e = null;
      S.data.elders.forEach(function (x) { if ((x.email || x.id) === sh.id) e = x; });
      body = sheetElder(e);
    } else if (sh.type === 'import') body = sheetImport(sh);
    $sheet.innerHTML = '<div class="scrim" data-action="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' + body + '</div>';
    document.body.style.overflow = 'hidden';
  }
  function toast(msg) {
    $toast.innerHTML = '<div class="toast">' + esc(msg) + '</div>';
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { $toast.innerHTML = ''; }, 2200);
  }

  /* back button support (Android back, iPhone swipe) */
  var layers = 0;
  function pushLayer() {
    if (PREVIEW) return;
    try { history.pushState({ embrace: ++layers }, ''); } catch (e) { layers = Math.max(0, layers - 1); }
  }
  function popLayer(fallback) {
    if (!PREVIEW && layers > 0) { history.back(); } else { fallback(); }
  }
  window.addEventListener('popstate', function () {
    if (layers > 0) layers--;
    if (S.sheet) { S.sheet = null; renderSheet(); }
    else if (S.pubId) { S.pubId = null; render(); window.scrollTo(0, S.flockScroll); }
  });

  function openSheet(sh) { var had = !!S.sheet; S.sheet = sh; renderSheet(); if (!had) pushLayer(); }
  function closeSheet() { popLayer(function () { S.sheet = null; renderSheet(); }); }
  function openPub(id) {
    var wasOpen = !!S.pubId;
    if (S.sheet) { S.sheet = null; renderSheet(); if (!PREVIEW && layers > 0) { layers--; try { history.replaceState({ embrace: layers }, ''); } catch (e) { /* ignore */ } } }
    if (!S.pubId && S.tab === 'flock') S.flockScroll = window.scrollY;
    S.tab = 'flock'; S.pubId = id; render(); window.scrollTo(0, 0);
    if (!wasOpen) pushLayer();
  }
  function goBack() {
    popLayer(function () { S.pubId = null; render(); window.scrollTo(0, S.flockScroll); });
  }

  function showErr(id, msg) { var el = document.getElementById(id); if (el) { el.textContent = msg; el.hidden = false; } }
  function fail(id) { return function (e) { showErr(id, window.EmbraceStore.friendly(e)); }; }

  /* ---------------- actions ---------------- */
  var actions = {
    tab: function (el) {
      S.tab = el.dataset.tab; S.pubId = null; S.confirmReset = false;
      render(); window.scrollTo(0, 0);
    },
    mode: function (el) { S.mode = el.dataset.mode; saveUi(); render(); },
    group: function (el) { S.group = el.dataset.group; saveUi(); render(); },
    open: function (el) { openPub(el.dataset.id); },
    back: function () { goBack(); },
    log: function (el) { openSheet({ type: 'log', id: el.dataset.id }); },
    visit: function (el) { openSheet({ type: 'visit', id: el.dataset.id }); },
    'edit-pub': function (el) { openSheet({ type: 'pub', id: el.dataset.id }); },
    'new-pub': function () { openSheet({ type: 'pub', id: null }); },
    'new-elder': function () { openSheet({ type: 'elder', id: null }); },
    'edit-elder': function (el) { openSheet({ type: 'elder', id: el.dataset.id }); },
    'close-sheet': function () { closeSheet(); },
    confirm: function () { S.sheet.confirm = true; renderSheet(); },
    unconfirm: function () { S.sheet.confirm = false; renderSheet(); },
    seg: function (el) {
      var box = el.parentNode;
      Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(b === el)); });
    },
    'save-visit': function (el) {
      var p = pubById(el.dataset.id); if (!p) return;
      var date = document.getElementById('v-date').value;
      var howEl = $sheet.querySelector('[data-group="how"][aria-pressed="true"]');
      var picked = Array.prototype.filter.call($sheet.querySelectorAll('.v-elder'), function (c) { return c.checked; });
      if (!date) return showErr('v-err', 'Pick the date of the visit.');
      if (date > todayStr()) return showErr('v-err', 'The visit date cannot be in the future.');
      if (!picked.length) return showErr('v-err', 'Tick at least one elder who went on the visit.');
      var v = {
        publisherId: p.id, publisherName: p.name, date: date, how: howEl ? howEl.dataset.value : 'In person',
        elders: picked.map(function (c) { return c.dataset.name; }),
        elderEmails: picked.map(function (c) { return c.dataset.email; }),
        notes: document.getElementById('v-notes').value.trim(),
        followUp: document.getElementById('v-fu').checked
      };
      store.addVisit(v).then(function () { closeSheet(); toast('Visit saved'); }, fail('v-err'));
    },
    'delete-visit': function (el) {
      store.deleteVisit(el.dataset.id).then(function () { closeSheet(); toast('Visit deleted'); });
    },
    'save-pub': function (el) {
      var name = document.getElementById('p-name').value.trim().replace(/\s+/g, ' ');
      if (!name) return showErr('p-err', 'Enter the publisher\'s name.');
      var p = {
        name: name, rank: document.getElementById('p-rank').value,
        appointedWife: document.getElementById('p-wife').checked,
        group: document.getElementById('p-group').value.trim(),
        note: document.getElementById('p-note').value.trim()
      };
      if (el.dataset.id) p.id = el.dataset.id;
      store.savePublisher(p).then(function () { closeSheet(); toast(p.id ? 'Saved' : name + ' added'); }, fail('p-err'));
    },
    'delete-pub': function (el) {
      var id = el.dataset.id;
      store.deletePublisher(id).then(function () {
        S.sheet = null; renderSheet(); S.pubId = null; render(); toast('Removed');
      });
    },
    'save-elder': function (el) {
      var name = document.getElementById('e-name').value.trim();
      var email = (el.dataset.id || document.getElementById('e-email').value).trim().toLowerCase();
      if (!name) return showErr('e-err', 'Enter the elder\'s name.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr('e-err', 'Enter the Gmail address he will sign in with.');
      var admin = document.getElementById('e-admin').checked;
      if (email === me().email) admin = true;
      store.saveElder({ name: name, email: email, admin: admin }).then(function () { closeSheet(); toast('Saved'); }, fail('e-err'));
    },
    'remove-elder': function (el) {
      store.removeElder(el.dataset.id).then(function () { closeSheet(); toast('Access removed'); });
    },
    overdue: function (el) { store.saveSettings({ overdueDays: +el.dataset.days }); },
    'import-pick': function () { var f = document.getElementById('import-file'); if (f) f.click(); },
    'do-import': function () {
      var rows = S.sheet.rows;
      store.importRoster(rows).then(function () { closeSheet(); toast(rows.length + ' publishers added'); });
    },
    'sign-in': function () {
      store.signIn().catch(function (e) { S.auth = { status: 'out', error: e.message }; render(); });
    },
    'sign-out': function () { store.signOut(); },
    'reset-demo': function () { S.confirmReset = true; render(); },
    'cancel-reset': function () { S.confirmReset = false; render(); },
    'do-reset': function () { S.confirmReset = false; store.resetDemo().then(function () { toast('Preview reset'); }); }
  };

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-action]');
    if (!el || el.disabled) return;
    var fn = actions[el.dataset.action];
    if (fn) { ev.preventDefault(); fn(el); }
  });
  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'search') {
      S.query = ev.target.value;
      var box = document.getElementById('flock-results');
      if (box) box.innerHTML = flockResults();
    }
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.id === 's-cong') store.saveSettings({ congregationName: t.value.trim() });
    if (t.id === 'import-file' && t.files && t.files[0]) {
      var r = new FileReader();
      r.onload = function () {
        var rows = parseRoster(String(r.result));
        var have = {};
        S.data.publishers.forEach(function (p) { have[p.name.toLowerCase()] = true; });
        var fresh = rows.filter(function (p) { return !have[p.name.toLowerCase()]; });
        openSheet({ type: 'import', rows: fresh, skipped: rows.length - fresh.length });
        t.value = '';
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
      if (q) {
        if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
        else if (c === '"') q = false;
        else f += c;
      } else if (c === '"') q = true;
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
    var alias = { rp: 'Regular Pioneer', ap: 'Auxiliary Pioneer', ms: 'Ministerial Servant', 'aux pioneer': 'Auxiliary Pioneer', 'regular pioneer': 'Regular Pioneer', 'disfellowshipped': 'Removed' };
    if (alias[s]) return alias[s];
    if (/inactive/i.test(status || '')) return 'Inactive';
    return 'Publisher';
  }
  function parseRoster(text) {
    var rows = parseCsv(text.replace(/^﻿/, ''));
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return h.trim().toLowerCase().replace(/\s+/g, '_'); });
    var col = function (n) { return head.indexOf(n); };
    var hasHead = col('name') >= 0;
    var iName = hasHead ? col('name') : 0;
    var out = [];
    (hasHead ? rows.slice(1) : rows).forEach(function (r) {
      var name = (r[iName] || '').trim().replace(/\s+/g, ' ');
      if (!name) return;
      var get = function (n) { var i = col(n); return i >= 0 ? (r[i] || '').trim() : ''; };
      var rank = normRank(get('rank'), get('status'));
      if (/inactive/i.test(get('status')) && (rank === 'Publisher')) rank = 'Inactive';
      out.push({
        name: name, rank: rank,
        appointedWife: /^(y|yes|true|x|1)$/i.test(get('appointed_wife')),
        group: get('group'), note: get('note')
      });
    });
    return out;
  }
  window.EmbraceParseRoster = parseRoster; // exposed for testing

  /* ---------------- boot ---------------- */
  store.init(function (a) {
    S.auth = a;
    if (a.status === 'in' && !boot.subscribed) {
      boot.subscribed = true;
      store.subscribe(function (d) {
        S.data = d; rebuildIndex(); render();
        if (S.sheet && S.sheet.type === 'visit') renderSheet();
      });
    }
    if (a.status !== 'in') { S.pubId = null; S.sheet = null; renderSheet(); }
    render();
  });
  function boot() {}
})();
