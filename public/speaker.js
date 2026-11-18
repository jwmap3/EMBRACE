/* The visiting speaker's page: speaker.html#<invite id>
 * Shows the details of his talk with us and a short form. His answers go straight to Embrace
 * (the talk coordinator sees them on that weekend). He can only open his own invite and save his own reply.
 * Nothing about any person lives in this file; it all comes from the invite. */
(function () {
  'use strict';
  var FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
  var DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var page = document.getElementById('page');
  var id = (location.hash || '').replace(/^#/, '').trim();
  var inv = null, form = { attending: 'yes', phone: '', hosp: '', hospCount: '', diet: '', song: '', media: '', notes: '' }, sent = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function longDate(s) { var d = day(s); return DOW[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  function last(n) { var w = String(n || '').trim().split(/\s+/); return w[w.length - 1] || ''; }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function phone(s) { var d = digits(s); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : s; }
  function talk(i) {
    var t = i.title ? (/^["“”']/.test(i.title) ? i.title : '“' + i.title + '”') : '';
    return [i.number ? '#' + i.number : '', t].filter(Boolean).join(' ');
  }

  /* data: Firebase, or a stand-in for tests (window.EMBRACE_SPEAKER_MOCK) */
  function backend() {
    if (window.EMBRACE_SPEAKER_MOCK) return Promise.resolve(window.EMBRACE_SPEAKER_MOCK);
    var cfg = window.EMBRACE_FIREBASE_CONFIG;
    if (!cfg || !cfg.apiKey) return Promise.reject(new Error('setup'));
    return Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]).then(function (m) {
      var app = m[0].initializeApp(cfg, 'speaker'), auth = m[1].getAuth(app), db = m[2].getFirestore(app), fs = m[2];
      return new Promise(function (ok, bad) {
        var stop = m[1].onAuthStateChanged(auth, function (u) {
          if (!u) { m[1].signInAnonymously(auth).catch(bad); return; }
          stop();
          ok({
            uid: u.uid,
            getInvite: function (k) { return fs.getDoc(fs.doc(db, 'invites', k)).then(function (d) { return d.exists() ? d.data() : null; }); },
            getReply: function (k) { return fs.getDoc(fs.doc(db, 'replies', k)).then(function (d) { return d.exists() ? d.data() : null; }, function () { return null; }); },
            saveReply: function (k, body) { return fs.setDoc(fs.doc(db, 'replies', k), body); }
          });
        });
      });
    });
  }

  function details() {
    var rows = [['Date', '<b>' + esc(longDate(inv.date)) + '</b>'], ['Time', '<b>' + esc(inv.time || '') + '</b>']];
    if (talk(inv)) rows.push(['Talk', esc(talk(inv))]);
    if (inv.hall) rows.push(['Location', esc((inv.hallName ? inv.hallName + ', ' : '') + inv.hall) + '<br><a href="https://maps.google.com/?q=' + encodeURIComponent(inv.hall) + '" target="_blank" rel="noopener">Directions</a>']);
    if (inv.zoom) rows.push(['Zoom', esc(inv.zoom)]);
    if (inv.coordName) rows.push(['Contact', esc(inv.coordName) + (inv.coordPhone ? '<br><a href="tel:' + digits(inv.coordPhone) + '">' + esc(phone(inv.coordPhone)) + '</a>' : '')]);
    if (inv.mediaEmail) rows.push(['Media', 'Please email any videos or pictures for your talk to <a href="mailto:' + esc(inv.mediaEmail) + '?subject=' + encodeURIComponent('Media for my public talk on ' + longDate(inv.date)) + '">' + esc(inv.mediaEmail) + '</a>']);
    return '<div class="card">' + rows.map(function (r) { return '<div class="row"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>'; }).join('') + '</div>';
  }
  function choice(key, a, b) {
    return '<div class="choices">' + [a, b].map(function (o) {
      return '<button type="button" data-k="' + key + '" data-v="' + o[0] + '" aria-pressed="' + (form[key] === o[0]) + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }
  function render() {
    if (sent) {
      page.innerHTML = '<div class="top"><div class="cong">' + esc(inv.cong || '') + '</div></div><div class="card done"><div class="tick" aria-hidden="true">✓</div><h2>Thank you, Brother ' + esc(last(inv.speaker)) + '!</h2>' +
        '<p>' + esc(inv.coordName ? 'Brother ' + last(inv.coordName) : 'The talk coordinator') + ' has your answers.</p><p>We look forward to your talk on ' + esc(longDate(inv.date)) + '.</p>' +
        '<button class="cta" data-act="pdf">Download my talk details (PDF)</button>' +
        '<button class="cta" data-act="cal" style="background:var(--fill);color:var(--accent)">Add it to my calendar</button>' +
        '<button class="link" data-act="edit">Change my answers</button></div>' + details();
      return;
    }
    page.innerHTML = '<div class="top"><div class="cong">' + esc(inv.cong || '') + '</div><h1>Hi Brother ' + esc(last(inv.speaker)) + '!</h1><p>Here are the details for your public talk with us.</p></div>' +
      details() +
      '<div class="label">A few quick questions</div><div class="card">' +
      '<div class="q"><b>Will you be able to give your talk on this date?</b>' + choice('attending', ['yes', 'Yes, I’ll be there'], ['no', 'I need to reschedule']) + '</div>' +
      '<div class="q"><b>Would you like to accept hospitality after the meeting?</b>' + choice('hosp', ['yes', 'Yes, thank you'], ['no', 'No, thank you']) +
        '<div class="sub"' + (form.hosp === 'yes' ? '' : ' hidden') + '><label>How many will be with you, counting yourself?<input id="hospCount" class="small" inputmode="numeric" maxlength="3" value="' + esc(form.hospCount) + '"></label>' +
        '<label>Any food allergies or needs?<input id="diet" maxlength="400" value="' + esc(form.diet) + '" placeholder="None"></label></div></div>' +
      '<div class="q"><b>Which song would you like us to sing after your talk?</b><input id="song" class="small" inputmode="numeric" maxlength="4" placeholder="Song number" value="' + esc(form.song) + '"></div>' +
      '<div class="q"><b>Will you have media (videos or pictures) for your talk?</b>' + choice('media', ['yes', 'Yes, I’ll email it'], ['no', 'No media']) + '</div>' +
      '<div class="q"><b>Best phone number to reach you</b><input id="phone" type="tel" inputmode="tel" maxlength="30" value="' + esc(form.phone) + '" placeholder="(419) 555-1234"></div>' +
      '<div class="q"><b>Anything else we should know?</b><textarea id="notes" rows="3" maxlength="1500">' + esc(form.notes) + '</textarea></div></div>' +
      '<button class="cta" data-act="send">Send my answers</button><p class="err" id="err" role="alert" hidden></p>' +
      '<p class="note">Only ' + esc(inv.coordName ? 'Brother ' + last(inv.coordName) + ' and the elders' : 'the elders') + ' of the ' + esc(inv.cong || 'congregation') + ' see your answers.</p>';
  }
  /* ---- the PDF he keeps: our details, his talk, and what he told us ---- */
  var JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  function loadPdfLib() {
    if (window.jspdf) return Promise.resolve(window.jspdf);
    return new Promise(function (ok, bad) {
      var s = document.createElement('script'); s.src = JSPDF; s.onload = function () { window.jspdf ? ok(window.jspdf) : bad(); }; s.onerror = bad;
      document.head.appendChild(s);
    });
  }
  function plain(s) { return String(s == null ? '' : s).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7E\n]/g, ''); }
  function answers() {
    var r = [];
    r.push(['Coming', form.attending === 'no' ? 'I need to reschedule' : 'Yes, I will be there']);
    if (form.attending !== 'no') {
      r.push(['Hospitality', form.hosp === 'yes' ? 'Yes, thank you' + (form.hospCount ? ' (' + form.hospCount + (form.hospCount === '1' ? ' person)' : ' people)') : '') : form.hosp === 'no' ? 'No, thank you' : 'Not answered']);
      if (form.hosp === 'yes' && form.diet) r.push(['Food needs', form.diet]);
      r.push(['Song after the talk', form.song ? 'Song ' + form.song : 'Not chosen yet']);
      r.push(['Media', form.media === 'yes' ? 'Yes - I will email it' + (inv.mediaEmail ? ' to ' + inv.mediaEmail : '') : form.media === 'no' ? 'No media' : 'Not answered']);
    }
    if (form.phone) r.push(['My phone', phone(form.phone)]);
    if (form.notes) r.push(['Notes', form.notes]);
    return r;
  }
  function makePdf() {
    return loadPdfLib().then(function (lib) {
      var doc = new lib.jsPDF({ unit: 'pt', format: 'letter' }), W = 612, M = 54, y = 64;
      var green = [47, 110, 76], ink = [29, 38, 32], grey = [92, 102, 94], line = [213, 219, 212], soft = [238, 243, 238];
      var t = function (s, x, size, style, color, opt) { doc.setFont('helvetica', style || 'normal'); doc.setFontSize(size); doc.setTextColor.apply(doc, color || ink); doc.text(plain(s), x, y, opt || {}); };
      var wrap = function (s, w, size) { doc.setFontSize(size); return doc.splitTextToSize(plain(s), w); };
      t(inv.cong || 'Public Talk', W / 2, 22, 'bold', ink, { align: 'center' }); y += 20;
      t('YOUR PUBLIC TALK', W / 2, 10.5, 'bold', green, { align: 'center', charSpace: 1 }); y += 34;
      doc.setFillColor.apply(doc, soft); doc.roundedRect(M, y - 26, W - 2 * M, 64, 10, 10, 'F');
      t(longDate(inv.date), W / 2, 20, 'bold', ink, { align: 'center' }); y += 24;
      t(inv.time || '', W / 2, 15, 'normal', green, { align: 'center' }); y += 44;
      function section(title, rows) {
        t(title.toUpperCase(), M, 10, 'bold', green, { charSpace: 0.8 }); y += 7;
        doc.setDrawColor.apply(doc, green); doc.setLineWidth(1.2); doc.line(M, y, W - M, y); y += 18;
        rows.forEach(function (r) {
          var lines = wrap(r[1], W - 2 * M - 130, 12);
          t(r[0], M, 11, 'bold', grey);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor.apply(doc, ink); doc.text(lines, M + 130, y);
          y += 16 * lines.length + 4;
        });
        y += 12;
      }
      section('Your talk', [['Speaker', 'Brother ' + inv.speaker + (inv.fromCong ? ' (' + inv.fromCong + ')' : '')]].concat(talk(inv) ? [['Outline', talk(inv)]] : []));
      section('Where', [].concat(inv.hall ? [['Kingdom Hall', (inv.hallName ? inv.hallName + '\n' : '') + inv.hall]] : [], inv.zoom ? [['Zoom', inv.zoom]] : []));
      section('Contact', [].concat(inv.coordName ? [['Talk coordinator', inv.coordName + (inv.coordPhone ? '   ' + phone(inv.coordPhone) : '')]] : [], inv.mediaEmail ? [['Send media to', inv.mediaEmail]] : []));
      section('What you told us', answers());
      doc.setDrawColor.apply(doc, line); doc.setLineWidth(0.6); doc.line(M, 740, W - M, 740);
      y = 758; t('Thank you for coming to serve with us - we look forward to your visit!', W / 2, 10.5, 'italic', grey, { align: 'center' });
      var d = day(inv.date);
      doc.save('Public-Talk-' + MON[d.getMonth()].slice(0, 3) + '-' + d.getDate() + '-' + d.getFullYear() + '.pdf');
    });
  }
  // A calendar event for the meeting (opens Calendar on iPhone, Google Calendar or similar on Android).
  function addToCalendar() {
    var d = day(inv.date), m = String(inv.time || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i), h = m ? +m[1] : 10, mi = m ? +m[2] : 0;
    if (m && m[3] && /pm/i.test(m[3]) && h < 12) h += 12; if (m && m[3] && /am/i.test(m[3]) && h === 12) h = 0;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var start = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + 'T' + p(h) + p(mi) + '00', endH = h + 2;
    var end = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + 'T' + p(endH > 23 ? 23 : endH) + p(mi) + '00';
    var e = function (s) { return plain(s).replace(/[,;\\]/g, function (c) { return '\\' + c; }).replace(/\n/g, '\\n'); };
    var desc = [talk(inv) ? 'Your talk: ' + talk(inv) : '', inv.zoom ? 'Zoom: ' + inv.zoom : '', inv.coordName ? 'Contact: ' + inv.coordName + (inv.coordPhone ? ' ' + phone(inv.coordPhone) : '') : '',
      inv.mediaEmail ? 'Send media to: ' + inv.mediaEmail : '', form.song ? 'Song after the talk: ' + form.song : ''].filter(Boolean).join('\n');
    var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Embrace//Speaker//EN', 'BEGIN:VEVENT', 'UID:' + id + '@embrace', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z',
      'DTSTART:' + start, 'DTEND:' + end, 'SUMMARY:' + e('Public talk - ' + (inv.cong || '')), 'LOCATION:' + e((inv.hallName ? inv.hallName + ', ' : '') + (inv.hall || '')), 'DESCRIPTION:' + e(desc),
      'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:Public talk tomorrow', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    var url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })), a = document.createElement('a');
    a.href = url; a.download = 'public-talk.ics'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  function read() {
    ['hospCount', 'diet', 'song', 'phone', 'notes'].forEach(function (k) { var el = document.getElementById(k); if (el) form[k] = el.value.trim(); });
  }
  function fail(title, msg) { page.innerHTML = '<div class="top"><h1>' + esc(title) + '</h1><p>' + esc(msg) + '</p></div>'; }

  page.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.k) { read(); form[b.dataset.k] = b.dataset.v; render(); return; }
    if (b.dataset.act === 'edit') { sent = false; render(); return; }
    if (b.dataset.act === 'pdf') { b.disabled = true; makePdf().then(function () { b.disabled = false; }, function () { b.disabled = false; b.textContent = 'Couldn’t make the PDF – try again'; }); return; }
    if (b.dataset.act === 'cal') { addToCalendar(); return; }
    if (b.dataset.act === 'send') {
      read();
      var err = document.getElementById('err');
      if (!form.hosp && form.attending === 'yes') { err.hidden = false; err.textContent = 'Please let us know about hospitality.'; return; }
      b.disabled = true; b.textContent = 'Sending…';
      var body = { uid: api.uid, attending: form.attending, phone: form.phone, hosp: form.hosp, hospCount: form.hosp === 'yes' ? form.hospCount.replace(/\D/g, '').slice(0, 3) : '',
        diet: form.hosp === 'yes' ? form.diet : '', song: form.song.replace(/\D/g, '').slice(0, 4), media: form.media, notes: form.notes, at: Date.now() };
      api.saveReply(id, body).then(function () { sent = true; render(); window.scrollTo(0, 0); }, function () {
        b.disabled = false; b.textContent = 'Send my answers';
        err.hidden = false; err.textContent = 'That didn’t go through. Check your internet connection and try again.';
      });
    }
  });

  var api = null;
  if (!id) { fail('Link not complete', 'Please open the full link from your text message.'); return; }
  backend().then(function (a) {
    api = a;
    return Promise.all([a.getInvite(id), a.getReply(id)]);
  }).then(function (r) {
    inv = r[0];
    if (!inv) { fail('This link isn’t active', 'Please ask the talk coordinator to send it again.'); return; }
    document.title = 'Your Public Talk · ' + (inv.cong || '');
    if (r[1]) { Object.keys(form).forEach(function (k) { if (r[1][k] != null) form[k] = String(r[1][k]); }); sent = true; }
    render();
  }).catch(function () { fail('Couldn’t open', 'Check your internet connection and open the link again.'); });
})();
