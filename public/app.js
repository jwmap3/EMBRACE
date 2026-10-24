/* Embrace — shepherding visit tracker for the body of elders. */
(function () {
  'use strict';

  var VERSION = '2.0';
  var RANKS = ['Elder', 'Ministerial Servant', 'Regular Pioneer', 'Auxiliary Pioneer', 'Publisher', 'Inactive', 'Removed'];
  var PREVIEW = !!window.EMBRACE_PREVIEW;
  var store = window.EmbraceStore.create();

  var S = {
    status: 'loading', error: '', loaded: false,
    data: { publishers: [], visits: [], settings: { overdueDays: 180 } },
    tab: 'flock', mode: 'priority', group: 'all', query: '',
    pubId: null, sheet: null, hop: null, flockScroll: 0,
    meId: null, whoAll: false, whoQuery: '', busy: false
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
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayStr() { return ymd(new Date()); }
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
  function isPriority(p) { return isActive(p) && (p.rank === 'Elder' || p.rank === 'Ministerial Servant' || p.rank === 'Regular Pioneer' || !!p.appointedWife); }
  function pub(id) { for (var i = 0; i < S.data.publishers.length; i++) if (S.data.publishers[i].id === id) return S.data.publishers[i]; return null; }
  function visit(id) { for (var i = 0; i < S.data.visits.length; i++) if (S.data.visits[i].id === id) return S.data.visits[i]; return null; }
  function me() { return S.meId ? pub(S.meId) : null; }
  function elders() { return S.data.publishers.filter(function (p) { return p.rank === 'Elder'; }).sort(byName); }
  function stamp(t) { return !t ? 0 : typeof t === 'number' ? t : t.toMillis ? t.toMillis() : 0; }
  function visitOrder(a, b) { return a.date !== b.date ? (a.date < b.date ? 1 : -1) : stamp(b.createdAt) - stamp(a.createdAt); }
  function who(v) { return (v.elders || []).join(' & ') || '—'; }

  function rebuild() {
    var byPub = {}, groups = {};
    S.data.visits.slice().sort(visitOrder).forEach(function (v) { (byPub[v.publisherId] = byPub[v.publisherId] || []).push(v); });
    S.data.publishers.forEach(function (p) { if (p.group) groups[p.group] = 1; });
    idx = { byPub: byPub, groups: Object.keys(groups).sort() };
  }
  function last(p) { var l = idx.byPub[p.id]; return l ? l[0] : null; }
  function waiting(p) { var l = last(p); return l ? daysSince(l.date) : null; }
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

  /* ---------------- art ---------------- */
  function sheep(size, extra) {
    return '<svg class="sheep ' + (extra || '') + '" width="' + size + '" height="' + Math.round(size * 0.8) + '" viewBox="0 0 30 24" aria-hidden="true">' +
      '<path class="leg" d="M11 18.5v4.2M20 18.5v4.2"/>' +
      '<path class="wool" d="M8.6 9.2a4.6 4.6 0 0 1 7.6-2.6 4.6 4.6 0 0 1 7.4 1.2 4.2 4.2 0 0 1 2.6 6.6 4.2 4.2 0 0 1-4.6 4.2H11.4a4.2 4.2 0 0 1-4-3.6 3.8 3.8 0 0 1 1.2-5.8z"/>' +
      '<ellipse class="face" cx="5.6" cy="11.6" rx="3.6" ry="2.9"/><circle class="eye" cx="4.5" cy="11" r=".6"/></svg>';
  }
  var I = {
    flock: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 8.5a2.6 2.6 0 0 1 4.2-1.2 2.6 2.6 0 0 1 4.3.6 2.6 2.6 0 0 1 1.7 4.4 2.6 2.6 0 0 1-2.6 3.2H9.2A2.6 2.6 0 0 1 7 12.6"/><ellipse cx="5.4" cy="10.6" rx="2.4" ry="2"/><path d="M9.5 15.5v3.5M15.5 15.5v3.5"/></svg>',
    visits: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21V8a4 4 0 0 1 8 0v1.5"/><path d="M17 9.5a1.4 1.4 0 0 1-2.8 0"/></svg>',
    settings: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
    search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    back: '<svg width="12" height="20" viewBox="0 0 11 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2L2 9l7 7"/></svg>',
    chev: '<svg class="chev" width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1l6 6-6 6"/></svg>',
    plus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    left: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>'
  };

  /* ---------------- pieces ---------------- */
  function subline(p, opts) {
    var bits = [];
    if (p.rank && p.rank !== 'Publisher') bits.push(p.rank);
    if (p.appointedWife) bits.push('Appointed wife');
    if (opts && opts.group && p.group) bits.push(p.group + ' group');
    var l = last(p); if (l && l.followUp) bits.push('Follow up');
    return bits.join(' · ');
  }
  function endHtml(p) {
    var w = waiting(p);
    if (w === null) return '<span class="end over">Never' + I.chev + '</span>';
    if (w <= 0) return '<span class="end">Today' + I.chev + '</span>';
    return '<span class="end' + (w > od() ? ' over' : '') + '">' + w + (w === 1 ? ' day' : ' days') + I.chev + '</span>';
  }
  function cell(p, action) {
    var sub = subline(p);
    return '<button class="cell" data-action="' + (action || 'open') + '" data-id="' + esc(p.id) + '">' +
      '<span class="av" aria-hidden="true">' + esc(initials(p.name)) + '</span>' +
      '<span class="txt"><b>' + esc(p.name) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
      (action === 'iam' ? '' : endHtml(p)) + '</button>';
  }
  function block(title, list, action) {
    if (!list.length) return '';
    return '<h2 class="label">' + esc(title) + '</h2><div class="group">' + list.map(function (p) { return cell(p, action); }).join('') + '</div>';
  }
  function empty(title, text, btn) {
    return '<div class="group empty">' + sheep(64, 'bob') + '<b>' + esc(title) + '</b><span>' + esc(text) + '</span>' + (btn || '') + '</div>';
  }
  function centeredHead(title, sub) {
    return '<header style="display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center">' + sheep(46, 'bob') +
      '<h1 class="title">' + esc(title) + '</h1>' + (sub ? '<p class="sub" style="margin:0">' + esc(sub) + '</p>' : '') + '</header>';
  }

  /* ---------------- main views ---------------- */
  function flockList() {
    var all = S.data.publishers;
    if (!all.length) return empty('No publishers yet', 'Add your publisher list in Settings.', '<button class="quiet-btn" data-action="tab" data-tab="settings">Open Settings</button>');
    var q = S.query.trim().toLowerCase();
    var list = all.filter(function (p) {
      return (S.group === 'all' || (p.group || '') === S.group) && (!q || p.name.toLowerCase().indexOf(q) >= 0);
    });
    if (!list.length) return empty('No one found', q ? 'No name matches "' + S.query.trim() + '".' : 'No one in this group yet.');
    if (q) return '<div class="group">' + needOrder(list).map(function (p) { return cell(p); }).join('') + '</div>';

    var h = '';
    if (S.mode === 'priority') {
      var pri = list.filter(isPriority).sort(byNeed);
      var rest = list.filter(function (p) { return isActive(p) && !isPriority(p); }).sort(byNeed);
      var cur = function (p) { var w = waiting(p); return w !== null && w <= od(); };
      h += pri.length
        ? '<p class="summary">' + pri.filter(cur).length + ' of ' + pri.length + ' pioneers and appointed visited in the last ' + odText() + '.</p>'
        : '<p class="summary">Tip: open a person and tap Edit to mark elders, servants, pioneers and appointed wives. They will rise to the top.</p>';
      h += block('Pioneers & appointed', pri);
      h += block('Publishers', rest);
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
    var cong = (S.data.settings && S.data.settings.congregationName) || '';
    var opts = '<option value="all">All groups</option>' + idx.groups.map(function (g) {
      return '<option value="' + esc(g) + '"' + (S.group === g ? ' selected' : '') + '>' + esc(g) + '</option>';
    }).join('');
    return '<div class="screen">' +
      centeredHead('Embrace', cong || 'Shepherding visits') +
      '<button class="big-btn" data-action="log-start" style="display:flex;align-items:center;justify-content:center;gap:8px">' + I.plus + 'Log a Visit</button>' +
      '<label class="search">' + I.search + '<span class="sr">Find a name</span><input id="search" type="search" autocomplete="off" placeholder="Find a name" value="' + esc(S.query) + '"></label>' +
      '<div class="filters"><div class="seg" role="group" aria-label="Sort">' +
      '<button data-action="mode" data-mode="priority" aria-pressed="' + (S.mode === 'priority') + '">Who\'s next</button>' +
      '<button data-action="mode" data-mode="everyone" aria-pressed="' + (S.mode === 'everyone') + '">By group</button></div>' +
      (idx.groups.length ? '<select class="pick" id="group-pick" aria-label="Field service group">' + opts + '</select>' : '') + '</div>' +
      '<div id="results" style="display:flex;flex-direction:column;gap:16px">' + flockList() + '</div></div>';
  }

  function viewPerson(p) {
    var vs = idx.byPub[p.id] || [], l = vs[0], w = l ? daysSince(l.date) : null;
    var sub = [p.rank || 'Publisher', p.appointedWife ? 'Appointed wife' : '', p.group ? p.group + ' group' : ''].filter(Boolean).join(' · ');
    return '<div class="screen">' +
      '<div class="nav"><button class="link" data-action="back">' + I.back + ' Flock</button><button class="link" data-action="edit" data-id="' + esc(p.id) + '">Edit</button></div>' +
      '<div class="hero"><span class="av big" aria-hidden="true">' + esc(initials(p.name)) + '</span><h1>' + esc(p.name) + '</h1><p>' + esc(sub) + '</p>' +
      (p.note ? '<p>' + esc(p.note) + '</p>' : '') + '</div>' +
      '<div class="group"><div class="row-plain"><span>Last visit</span><span>' + (l ? esc(fmtDate(l.date)) : 'Never') + '</span></div>' +
      '<div class="row-plain"><span>Waiting</span><span' + (w === null || w > od() ? ' style="color:var(--warn);font-weight:600"' : '') + '>' +
      (w === null ? 'Not visited yet' : w <= 0 ? 'Visited today' : w + (w === 1 ? ' day' : ' days')) + '</span></div></div>' +
      '<button class="big-btn" data-action="log" data-id="' + esc(p.id) + '">Log a Visit</button>' +
      '<h2 class="label">Visits</h2>' +
      (vs.length ? '<div class="group">' + vs.map(function (v) {
        return '<button class="note" data-action="visit" data-id="' + esc(v.id) + '"><span class="top"><b>' + esc(fmtDate(v.date)) + '</b>' +
          (v.followUp ? '<span class="flag">Follow up</span>' : '') + '</span><span class="who">' + esc(who(v)) + '</span>' +
          (v.notes ? '<p>' + esc(v.notes) + '</p>' : '') + '</button>';
      }).join('') + '</div>' : '<div class="group empty"><span>No visits yet.</span></div>') +
      '<p class="foot">Notes are seen only by the elders.</p></div>';
  }

  function viewVisits() {
    var sy = serviceYear(), mine = S.meId;
    var year = S.data.visits.filter(function (v) { return v.date >= sy.start && v.date <= sy.end; });
    var byMe = year.filter(function (v) { return (v.elderIds || []).indexOf(mine) >= 0; }).length;
    var seen = {}; year.forEach(function (v) { seen[v.publisherId] = 1; });
    var follow = S.data.publishers.filter(function (p) { var l = last(p); return l && l.followUp; }).sort(byNeed);
    var recent = S.data.visits.slice().sort(visitOrder).slice(0, 40);
    var h = '<div class="screen">' + centeredHead('Visits', sy.label + ' service year') +
      '<div class="group"><div class="row-plain"><span>Visits this year</span><span>' + year.length + '</span></div>' +
      '<div class="row-plain"><span>Visits you went on</span><span>' + byMe + '</span></div>' +
      '<div class="row-plain"><span>Publishers seen</span><span>' + Object.keys(seen).length + '</span></div></div>';
    h += block('Needs a follow-up', follow);
    h += '<h2 class="label">Recent</h2>';
    h += recent.length ? '<div class="group">' + recent.map(function (v) {
      var p = pub(v.publisherId);
      return '<button class="note" data-action="visit" data-id="' + esc(v.id) + '"><span class="top"><b>' + esc(p ? p.name : v.publisherName) + '</b><span>' + esc(fmtDate(v.date, true)) + '</span></span>' +
        '<span class="who">' + esc(who(v)) + '</span></button>';
    }).join('') + '</div>' : empty('No visits yet', 'Tap Log a Visit on the Flock tab to add the first one.');
    return h + '</div>';
  }

  function viewSettings() {
    var m = me(), cong = (S.data.settings && S.data.settings.congregationName) || '';
    var els = elders();
    var h = '<div class="screen">' + centeredHead('Settings') +
      '<h2 class="label">You</h2><div class="group">' +
      (m ? '<div class="cell"><span class="av" aria-hidden="true">' + esc(initials(m.name)) + '</span><span class="txt"><b>' + esc(m.name) + '</b><small>Using Embrace on this phone</small></span></div>' : '') +
      '<button class="action" data-action="switch">Not you? Choose your name</button></div>' +
      '<h2 class="label">Congregation</h2><div class="group">' +
      '<div class="field"><label for="s-cong">Name</label><input id="s-cong" type="text" value="' + esc(cong) + '" placeholder="Congregation name"></div>' +
      '<div class="field"><label for="s-od">Overdue after</label><select id="s-od">' + [[90, '3 months'], [120, '4 months'], [180, '6 months'], [365, '1 year']].map(function (o) {
        return '<option value="' + o[0] + '"' + (od() === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></div></div>' +
      '<h2 class="label">Elders</h2>' +
      (els.length ? '<div class="group">' + els.map(function (p) { return cell(p); }).join('') + '</div>' : '') +
      '<p class="foot" style="text-align:left;margin-top:-6px">Anyone marked Elder can pick his name when he first opens Embrace.</p>' +
      '<h2 class="label">Publishers</h2><div class="group">' +
      '<button class="action" data-action="new">Add a person</button>' +
      '<button class="action" data-action="import-pick">Import a list (CSV)</button>' +
      '<div class="row-plain"><span>Total</span><span>' + S.data.publishers.length + '</span></div></div>' +
      '<input id="import-file" type="file" accept=".csv,text/csv,text/plain" hidden>';
    if (store.mode === 'live') h += '<div class="group"><button class="action" data-action="code-change">Change congregation code</button></div>';
    else h += '<div class="group">' + (S.confirmReset
      ? '<div class="row-plain"><span>Erase everything in this preview?</span></div><button class="action red" data-action="do-reset">Erase preview</button><button class="action" data-action="cancel-reset">Keep it</button>'
      : '<button class="action red" data-action="reset">Reset preview</button>') + '</div>';
    return h + '<p class="foot">Embrace ' + VERSION + (store.mode === 'demo' ? ' · Preview: changes stay on this phone' : '') + '</p></div>';
  }

  /* ---------------- first open ---------------- */
  function viewGate() {
    if (S.status === 'loading' || (S.status === 'ready' && !S.loaded)) {
      return '<div class="welcome">' + sheep(96, 'bob') + '<h1>Embrace</h1><p>Opening…</p></div>';
    }
    if (S.status === 'error') {
      return '<div class="welcome">' + sheep(96, 'bob') + '<h1>Embrace</h1><p>' + esc(S.error) + '</p><button class="big-btn" data-action="reload">Try again</button></div>';
    }
    if (S.status === 'code' || S.status === 'setcode') {
      var setting = S.status === 'setcode';
      return '<div class="welcome">' + sheep(96, 'bob') + '<h1>' + (setting ? 'Create a code' : 'Welcome') + '</h1>' +
        '<p>' + (setting ? 'Make up a 4-digit code and give it to the other elders. Each phone enters it once.' : 'Enter the 4-digit congregation code. You only do this once on this phone.') + '</p>' +
        '<label class="sr" for="gate-code">Congregation code</label><input id="gate-code" class="code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" spellcheck="false" placeholder="••••">' +
        '<p class="err" id="gate-err" role="alert" hidden></p>' +
        '<button class="big-btn" data-action="' + (setting ? 'code-create' : 'code-enter') + '"' + (S.busy ? ' disabled' : '') + '>Continue</button></div>';
    }
    // Who are you?
    var els = elders(), h = '<div class="welcome">' + sheep(96, 'bob') + '<h1>Who are you?</h1><p>Tap your name. Embrace will remember you on this phone.</p>';
    if (!S.whoAll && els.length) {
      h += '<div class="group list">' + els.map(function (p) { return cell(p, 'iam'); }).join('') + '</div>' +
        '<button class="quiet-btn" data-action="who-all">My name is not here</button>';
    } else if (S.data.publishers.length) {
      var q = S.whoQuery.trim().toLowerCase();
      var list = S.data.publishers.filter(function (p) { return isActive(p) && (!q || p.name.toLowerCase().indexOf(q) >= 0); }).sort(byName).slice(0, 60);
      h += '<label class="search" style="width:100%;max-width:420px">' + I.search + '<span class="sr">Find your name</span><input id="who-search" type="search" autocomplete="off" placeholder="Find your name" value="' + esc(S.whoQuery) + '"></label>' +
        '<div class="group list" id="who-list">' + list.map(function (p) { return cell(p, 'iam'); }).join('') + '</div>' +
        (els.length ? '<button class="quiet-btn" data-action="who-elders">Show only elders</button>' : '');
    } else {
      h += '<div class="group list"><div class="field"><label for="who-name">Your name</label><input id="who-name" type="text" placeholder="First and last name" autocomplete="name"></div></div>' +
        '<button class="big-btn" data-action="iam-new">Continue</button>';
    }
    return h + '</div>';
  }

  function tabs() {
    return '<div class="tabs"><nav aria-label="Main">' + [['flock', 'Flock'], ['visits', 'Visits'], ['settings', 'Settings']].map(function (t) {
      return '<button data-action="tab" data-tab="' + t[0] + '"' + (S.tab === t[0] ? ' aria-current="page"' : '') + (S.hop === t[0] ? ' class="hop"' : '') + '>' + I[t[0]] + t[1] + '</button>';
    }).join('') + '</nav></div>';
  }

  /* ---------------- sheets ---------------- */
  function head(title, right, leftLabel) {
    return '<div class="grab" aria-hidden="true"></div><div class="sheet-head"><button class="link" data-action="close" style="justify-self:start">' + (leftLabel || 'Cancel') + '</button>' +
      '<h2 id="sheet-title">' + esc(title) + '</h2>' + (right || '<span></span>') + '</div>';
  }
  function sheetPick() {
    var q = (S.sheet.q || '').trim().toLowerCase();
    var list = needOrder(S.data.publishers.filter(function (p) { return p.rank !== 'Removed' || q; })
      .filter(function (p) { return !q || p.name.toLowerCase().indexOf(q) >= 0; })).slice(0, 50);
    return head('Who did you visit?') +
      '<label class="search">' + I.search + '<span class="sr">Find a name</span><input id="pick-search" type="search" autocomplete="off" placeholder="Type a name" value="' + esc(S.sheet.q || '') + '"></label>' +
      '<div id="pick-list">' + pickList(list, q) + '</div>';
  }
  function pickList(list, q) {
    if (!list.length) return '<div class="group empty"><span>No name matches.</span></div>';
    return (q ? '' : '<h2 class="label" style="margin-bottom:8px">Waiting the longest</h2>') +
      '<div class="group">' + list.map(function (p) { return cell(p, 'pick'); }).join('') + '</div>';
  }
  function sheetLog(p) {
    var sh = S.sheet;
    var els = elders();
    if (S.meId && !els.some(function (e) { return e.id === S.meId; }) && me()) els.unshift(me());
    els.sort(function (a, b) { return a.id === S.meId ? -1 : b.id === S.meId ? 1 : byName(a, b); });
    return head('Log a Visit', '<button class="link" data-action="save-visit">Save</button>') +
      '<div class="hero" style="gap:2px"><span class="av" aria-hidden="true">' + esc(initials(p.name)) + '</span><h1 style="font-size:22px">' + esc(p.name) + '</h1></div>' +
      '<h2 class="label">Who went with you?</h2><div class="group"><div class="chips" role="group" aria-label="Elders on this visit">' +
      els.map(function (e) {
        var on = sh.with.indexOf(e.id) >= 0;
        return '<button class="chip" data-action="with" data-id="' + esc(e.id) + '" aria-pressed="' + on + '">' + esc(e.id === S.meId ? 'Me' : e.name) + '</button>';
      }).join('') + '</div></div>' +
      '<h2 class="label">What day?</h2><div class="group" id="cal">' + calendar() + '</div>' +
      '<h2 class="label"><label for="v-notes">Notes</label></h2><div class="group"><textarea id="v-notes" placeholder="What was shared, how they are doing, anything to follow up on"></textarea>' +
      '<label class="field" for="v-fu"><span>Needs a follow-up</span><input class="switch" id="v-fu" type="checkbox"></label></div>' +
      '<p class="err" id="v-err" role="alert" hidden></p>' +
      '<button class="big-btn" data-action="save-visit">Save Visit</button>';
  }
  function calendar() {
    var sh = S.sheet, y = sh.calY, m = sh.calM;
    var first = new Date(y, m, 1), startDow = first.getDay(), days = new Date(y, m + 1, 0).getDate();
    var today = todayStr(), now = new Date();
    var canNext = y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth());
    var h = '<div style="padding:10px 10px 14px"><div style="display:flex;align-items:center;justify-content:space-between;padding:0 4px 8px">' +
      '<button class="link" data-action="cal" data-step="-1" aria-label="Previous month">' + I.left + '</button>' +
      '<b style="font-size:18px">' + MON[m] + ' ' + y + '</b>' +
      '<button class="link" data-action="cal" data-step="1" aria-label="Next month"' + (canNext ? '' : ' disabled style="opacity:.3"') + '>' + I.right + '</button></div>' +
      '<div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;text-align:center">' +
      ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (d) { return '<span style="font-size:13px;color:var(--fg2);font-weight:600;padding-bottom:4px">' + d + '</span>'; }).join('');
    for (var i = 0; i < startDow; i++) h += '<span></span>';
    for (var d = 1; d <= days; d++) {
      var s = y + '-' + pad(m + 1) + '-' + pad(d), future = s > today, sel = s === sh.date, isToday = s === today;
      h += '<button data-action="day" data-date="' + s + '"' + (future ? ' disabled' : '') + ' aria-pressed="' + sel + '" aria-label="' + MON[m] + ' ' + d + '"' +
        ' style="height:44px;border:none;border-radius:22px;font-size:17px;font-variant-numeric:tabular-nums;' +
        (sel ? 'background:var(--accent);color:var(--accent-ink);font-weight:700;' : isToday ? 'background:transparent;color:var(--accent);font-weight:700;box-shadow:inset 0 0 0 2px var(--accent);' : 'background:transparent;') +
        (future ? 'opacity:.3;' : '') + '">' + d + '</button>';
    }
    return h + '</div></div>';
  }
  function sheetVisit(v) {
    var p = pub(v.publisherId);
    var h = head('Visit', null, 'Close') +
      '<div class="group"><div class="row-plain"><span>Visited</span><span>' + esc(p ? p.name : v.publisherName) + '</span></div>' +
      '<div class="row-plain"><span>Date</span><span>' + esc(fmtDate(v.date)) + '</span></div>' +
      '<div class="row-plain"><span>Who went</span><span>' + esc(who(v)) + '</span></div>' +
      (v.followUp ? '<div class="row-plain"><span>Follow-up</span><span class="flag">Needed</span></div>' : '') + '</div>' +
      '<h2 class="label">Notes</h2><div class="group" style="padding:14px 16px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5">' +
      (v.notes ? esc(v.notes) : '<span style="color:var(--fg2)">No notes.</span>') + '</div>';
    if (p && S.pubId !== p.id) h += '<button class="quiet-btn" data-action="open" data-id="' + esc(p.id) + '">Open ' + esc(firstName(p.name)) + '\'s page</button>';
    h += S.sheet.confirm
      ? '<div class="group"><div class="row-plain"><span>Delete this visit?</span></div><button class="action red" data-action="delete-visit" data-id="' + esc(v.id) + '">Delete</button><button class="action" data-action="unconfirm">Keep it</button></div>'
      : '<button class="quiet-btn red" data-action="confirm">Delete visit</button>';
    return h;
  }
  function sheetEdit(p) {
    var isNew = !p; p = p || { name: '', rank: 'Publisher', group: S.group !== 'all' ? S.group : '', appointedWife: false, note: '' };
    var h = head(isNew ? 'Add a Person' : 'Edit', '<button class="link" data-action="save-person">Save</button>') +
      '<div class="group">' +
      '<div class="field"><label for="p-name">Name</label><input id="p-name" type="text" value="' + esc(p.name) + '" placeholder="Full name" autocomplete="off"></div>' +
      '<div class="field"><label for="p-rank">Privilege</label><select id="p-rank">' + RANKS.map(function (r) { return '<option' + (r === (p.rank || 'Publisher') ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></div>' +
      '<label class="field" for="p-wife"><span>Appointed wife</span><input class="switch" id="p-wife" type="checkbox"' + (p.appointedWife ? ' checked' : '') + '></label>' +
      '<div class="field"><label for="p-group">Group</label><input id="p-group" type="text" list="p-groups" value="' + esc(p.group || '') + '" placeholder="Overseer\'s name"></div>' +
      '<datalist id="p-groups">' + idx.groups.map(function (g) { return '<option value="' + esc(g) + '"></option>'; }).join('') + '</datalist>' +
      '<div class="field"><label for="p-note">Note</label><input id="p-note" type="text" value="' + esc(p.note || '') + '" placeholder="e.g. Away until April"></div></div>' +
      '<p class="err" id="p-err" role="alert" hidden></p><button class="big-btn" data-action="save-person">Save</button>';
    if (!isNew) {
      h += S.sheet.confirm
        ? '<div class="group"><div class="row-plain"><span>Remove ' + esc(firstName(p.name)) + ' and their visits?</span></div><button class="action red" data-action="delete-person">Remove</button><button class="action" data-action="unconfirm">Keep</button></div>'
        : '<button class="quiet-btn red" data-action="confirm">Remove from Embrace</button>';
    }
    return h;
  }
  function sheetImport(sh) {
    var g = {}; sh.rows.forEach(function (r) { g[r.group || 'No group'] = (g[r.group || 'No group'] || 0) + 1; });
    return head('Import', null, 'Close') + '<div class="group">' + Object.keys(g).sort().map(function (k) {
      return '<div class="row-plain"><span>' + esc(k) + '</span><span>' + g[k] + '</span></div>';
    }).join('') + '</div>' +
      (sh.skipped ? '<p class="foot">' + sh.skipped + ' already in Embrace will be skipped.</p>' : '') +
      (sh.rows.length ? '<button class="big-btn" data-action="do-import">Add ' + sh.rows.length + ' people</button>' : '<p class="foot">Nothing new to add.</p>');
  }
  function sheetCode() {
    return head('Congregation Code', '<button class="link" data-action="code-save">Save</button>') +
      '<div class="group"><div class="field"><label for="new-code">New code</label><input id="new-code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="4 digits"></div></div>' +
      '<p class="foot">Phones already using Embrace stay unlocked. New phones need the new code.</p>' +
      '<p class="err" id="c-err" role="alert" hidden></p><button class="big-btn" data-action="code-save">Save</button>';
  }

  /* ---------------- render ---------------- */
  var root = document.getElementById('app');
  root.innerHTML = '<main id="main"></main><div id="tabs"></div><div id="sheet"></div><div id="fx" aria-live="polite"></div>';
  var $main = document.getElementById('main'), $tabs = document.getElementById('tabs'), $sheet = document.getElementById('sheet'), $fx = document.getElementById('fx');

  function needsGate() { return S.status !== 'ready' || !S.loaded || !me(); }
  function render() {
    var a = document.activeElement, keep = a && (a.id === 'search' || a.id === 'who-search') ? [a.id, a.selectionStart] : null;
    if (needsGate()) { $main.innerHTML = viewGate(); $tabs.innerHTML = ''; }
    else {
      var p = S.pubId ? pub(S.pubId) : null;
      if (S.pubId && !p) S.pubId = null;
      $main.innerHTML = S.tab === 'flock' ? (p ? viewPerson(p) : viewFlock()) : S.tab === 'visits' ? viewVisits() : viewSettings();
      $tabs.innerHTML = tabs();
      S.hop = null;
    }
    if (keep) { var el = document.getElementById(keep[0]); if (el) { el.focus(); try { el.setSelectionRange(keep[1], keep[1]); } catch (e) { /* ignore */ } } }
  }
  function renderSheet() {
    var sh = S.sheet, body = '';
    if (!sh) { $sheet.innerHTML = ''; document.body.style.overflow = ''; return; }
    if (sh.type === 'pick') body = sheetPick();
    else if (sh.type === 'log') { var p = pub(sh.id); if (!p) return closeSheet(); body = sheetLog(p); }
    else if (sh.type === 'visit') { var v = visit(sh.id); if (!v) return closeSheet(); body = sheetVisit(v); }
    else if (sh.type === 'edit') body = sheetEdit(sh.id ? pub(sh.id) : null);
    else if (sh.type === 'import') body = sheetImport(sh);
    else if (sh.type === 'code') body = sheetCode();
    $sheet.innerHTML = '<div class="scrim" data-action="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' + body + '</div>';
    document.body.style.overflow = 'hidden';
  }
  function toast(msg) {
    $fx.innerHTML = '<div class="toast">' + esc(msg) + '</div>';
    clearTimeout(toast.t); toast.t = setTimeout(function () { $fx.innerHTML = ''; }, 2200);
  }
  function trot(msg) {
    $fx.innerHTML = '<div class="trot"><div class="runner">' + sheep(56) + '</div><div class="msg">' + esc(msg) + '</div></div>';
    clearTimeout(toast.t); toast.t = setTimeout(function () { $fx.innerHTML = ''; }, 2000);
  }

  /* back button (Android) and swipe-back (iPhone) close sheets and pages */
  var layers = 0;
  function push() { if (PREVIEW) return; try { history.pushState({ embrace: ++layers }, ''); } catch (e) { layers = Math.max(0, layers - 1); } }
  function pop(fallback) { if (!PREVIEW && layers > 0) history.back(); else fallback(); }
  window.addEventListener('popstate', function () {
    if (layers > 0) layers--;
    if (S.sheet) { S.sheet = null; renderSheet(); }
    else if (S.pubId) { S.pubId = null; render(); window.scrollTo(0, S.flockScroll); }
  });
  function openSheet(sh) { var had = !!S.sheet; S.sheet = sh; renderSheet(); if (!had) push(); }
  function swapSheet(sh) { S.sheet = sh; renderSheet(); }
  function closeSheet() { pop(function () { S.sheet = null; renderSheet(); }); }
  function openPerson(id) {
    if (S.sheet) { S.sheet = null; renderSheet(); if (!PREVIEW && layers > 0) { layers--; try { history.replaceState({ embrace: layers }, ''); } catch (e) { /* ignore */ } } }
    var was = !!S.pubId;
    if (!S.pubId && S.tab === 'flock') S.flockScroll = window.scrollY;
    S.tab = 'flock'; S.pubId = id; render(); window.scrollTo(0, 0);
    if (!was) push();
  }
  function logSheet(id) {
    var now = new Date();
    return { type: 'log', id: id, with: S.meId ? [S.meId] : [], date: todayStr(), calY: now.getFullYear(), calM: now.getMonth() };
  }
  function showErr(id, msg) { var el = document.getElementById(id); if (el) { el.textContent = msg; el.hidden = false; } }
  function fail(id) { return function (e) { S.busy = false; showErr(id, window.EmbraceStore.friendly(e)); }; }
  function setMe(id) { S.meId = id; lsSet('embrace-me', id); S.whoAll = false; S.whoQuery = ''; S.tab = 'flock'; }

  /* ---------------- actions ---------------- */
  var A = {
    tab: function (el) { S.tab = el.dataset.tab; S.hop = el.dataset.tab; S.pubId = null; S.confirmReset = false; render(); window.scrollTo(0, 0); },
    mode: function (el) { S.mode = el.dataset.mode; saveUi(); render(); },
    open: function (el) { openPerson(el.dataset.id); },
    back: function () { pop(function () { S.pubId = null; render(); window.scrollTo(0, S.flockScroll); }); },
    'log-start': function () { openSheet({ type: 'pick', q: '' }); setTimeout(function () { var s = document.getElementById('pick-search'); if (s) s.focus(); }, 300); },
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
    edit: function (el) { openSheet({ type: 'edit', id: el.dataset.id }); },
    new: function () { openSheet({ type: 'edit', id: null }); },
    confirm: function () { S.sheet.confirm = true; renderSheet(); },
    unconfirm: function () { S.sheet.confirm = false; renderSheet(); },
    close: function () { closeSheet(); },
    'save-person': function () {
      var name = document.getElementById('p-name').value.trim().replace(/\s+/g, ' ');
      if (!name) return showErr('p-err', 'Type the person\'s name.');
      var p = { name: name, rank: document.getElementById('p-rank').value, appointedWife: document.getElementById('p-wife').checked,
        group: document.getElementById('p-group').value.trim(), note: document.getElementById('p-note').value.trim() };
      if (S.sheet.id) p.id = S.sheet.id;
      store.savePublisher(p).then(function () { closeSheet(); toast(p.id ? 'Saved' : firstName(name) + ' added'); }, fail('p-err'));
    },
    'delete-person': function () {
      var id = S.sheet.id;
      store.deletePublisher(id).then(function () { S.sheet = null; renderSheet(); S.pubId = null; render(); toast('Removed'); });
    },
    'import-pick': function () { var f = document.getElementById('import-file'); if (f) f.click(); },
    'do-import': function () { var rows = S.sheet.rows; store.importRoster(rows).then(function () { closeSheet(); toast(rows.length + ' people added'); }); },
    switch: function () { S.meId = null; lsSet('embrace-me', null); S.pubId = null; render(); window.scrollTo(0, 0); },
    iam: function (el) {
      var id = el.dataset.id, p = pub(id);
      el.classList.add('picked');
      var go = function () { setMe(id); render(); window.scrollTo(0, 0); toast('Welcome, ' + firstName(p.name)); };
      if (p && p.rank !== 'Elder') store.savePublisher({ id: id, rank: 'Elder' }).then(function () { setTimeout(go, 450); });
      else setTimeout(go, 450);
    },
    'iam-new': function () {
      var n = (document.getElementById('who-name').value || '').trim().replace(/\s+/g, ' ');
      if (!n) return;
      store.savePublisher({ name: n, rank: 'Elder', group: '', appointedWife: false, note: '' }).then(function (id) { setMe(id); render(); toast('Welcome, ' + firstName(n)); });
    },
    'who-all': function () { S.whoAll = true; render(); },
    'who-elders': function () { S.whoAll = false; render(); },
    'code-enter': function () { gateCode(store.enterCode); },
    'code-create': function () { gateCode(store.createCode); },
    'code-change': function () { openSheet({ type: 'code' }); },
    'code-save': function () {
      var c = (document.getElementById('new-code').value || '').replace(/\D/g, '');
      if (c.length !== 4) return showErr('c-err', 'The code must be 4 digits.');
      store.changeCode(c).then(function () { closeSheet(); toast('Code changed'); }, fail('c-err'));
    },
    reload: function () { location.reload(); },
    reset: function () { S.confirmReset = true; render(); },
    'cancel-reset': function () { S.confirmReset = false; render(); },
    'do-reset': function () { S.confirmReset = false; S.meId = null; lsSet('embrace-me', null); store.resetDemo().then(function () { render(); }); }
  };
  function gateCode(fn) {
    var c = (document.getElementById('gate-code').value || '').replace(/\D/g, '');
    if (c.length !== 4) return showErr('gate-err', 'The code is 4 digits.');
    if (S.busy) return;
    S.busy = true;
    fn(c).then(function () { S.busy = false; }, function (e) { S.busy = false; render(); showErr('gate-err', e.message); });
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
    if (t.id === 'who-search') { S.whoQuery = t.value; render(); }
    if (t.id === 'gate-code') {
      t.value = t.value.replace(/\D/g, '').slice(0, 4);
      if (t.value.length === 4) A[S.status === 'setcode' ? 'code-create' : 'code-enter']();
    }
    if (t.id === 'pick-search') {
      S.sheet.q = t.value;
      var q = t.value.trim().toLowerCase();
      var list = needOrder(S.data.publishers.filter(function (p) { return (p.rank !== 'Removed' || q) && (!q || p.name.toLowerCase().indexOf(q) >= 0); })).slice(0, 50);
      document.getElementById('pick-list').innerHTML = pickList(list, q);
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
        var rows = parseRoster(String(r.result)), have = {};
        S.data.publishers.forEach(function (p) { have[p.name.toLowerCase()] = 1; });
        var fresh = rows.filter(function (p) { return !have[p.name.toLowerCase()]; });
        openSheet({ type: 'import', rows: fresh, skipped: rows.length - fresh.length }); t.value = '';
      };
      r.readAsText(t.files[0]);
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && S.sheet) closeSheet();
    if (ev.key === 'Enter' && ev.target.id === 'gate-code') A[S.status === 'setcode' ? 'code-create' : 'code-enter']();
  });

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
    var alias = { rp: 'Regular Pioneer', ap: 'Auxiliary Pioneer', ms: 'Ministerial Servant', 'aux pioneer': 'Auxiliary Pioneer' };
    if (alias[s]) return alias[s];
    return /inactive/i.test(status || '') ? 'Inactive' : 'Publisher';
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
      var rank = normRank(get('rank'), get('status'));
      if (/inactive/i.test(get('status')) && rank === 'Publisher') rank = 'Inactive';
      out.push({ name: name, rank: rank, appointedWife: /^(y|yes|true|x|1)$/i.test(get('appointed_wife')), group: get('group'), note: get('note') });
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
        S.data = d; S.loaded = d.ready !== false; rebuild();
        if (S.meId && S.loaded && !pub(S.meId)) { S.meId = null; lsSet('embrace-me', null); }
        render();
        if (S.sheet && S.sheet.type === 'visit') renderSheet();
      });
    }
    render();
  });
})();
