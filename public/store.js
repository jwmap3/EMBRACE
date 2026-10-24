/* Embrace data layer.
 * Two backends with the same interface:
 *   - FirebaseStore: Google sign-in + Firestore, live-synced between every elder's phone.
 *   - LocalStore: demo mode, data stays on this device (used when no Firebase config is set).
 */
(function () {
  'use strict';

  var FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------------- Demo / local store ---------------- */
  function LocalStore(seedRoster) {
    var KEY = 'embrace-demo-v1';
    var mem = null;
    var listeners = [];
    var authCb = null;
    var me = { email: 'you@demo', name: 'You' };

    function load() {
      if (mem) return mem;
      try { mem = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { mem = null; }
      if (!mem) {
        mem = {
          signedIn: true,
          publishers: [],
          visits: [],
          elders: [{ id: me.email, email: me.email, name: 'You (demo)', admin: true }],
          settings: { overdueDays: 180 }
        };
        if (seedRoster && seedRoster.length) {
          mem.publishers = seedRoster.map(function (p) { return Object.assign({ id: uid() }, p); });
        }
        save();
      }
      return mem;
    }
    function save() {
      try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* storage blocked: keep in memory */ }
    }
    function emit() {
      var d = load();
      listeners.forEach(function (cb) {
        cb({ publishers: d.publishers.slice(), visits: d.visits.slice(), elders: d.elders.slice(), settings: d.settings });
      });
    }
    function commit() { save(); emit(); return Promise.resolve(); }

    return {
      mode: 'demo',
      init: function (cb) {
        authCb = cb;
        var d = load();
        cb(d.signedIn ? { status: 'in', user: me } : { status: 'out' });
      },
      signIn: function () { load().signedIn = true; save(); authCb({ status: 'in', user: me }); return Promise.resolve(); },
      signOut: function () { load().signedIn = false; save(); authCb({ status: 'out' }); return Promise.resolve(); },
      subscribe: function (cb) { listeners.push(cb); emit(); },
      addVisit: function (v) {
        load().visits.push(Object.assign({ id: uid(), createdBy: me.email, createdAt: Date.now() }, v));
        return commit();
      },
      deleteVisit: function (id) {
        var d = load(); d.visits = d.visits.filter(function (v) { return v.id !== id; }); return commit();
      },
      savePublisher: function (p) {
        var d = load();
        if (p.id) {
          d.publishers = d.publishers.map(function (x) { return x.id === p.id ? Object.assign({}, x, p) : x; });
        } else {
          d.publishers.push(Object.assign({}, p, { id: uid() }));
        }
        return commit();
      },
      deletePublisher: function (id) {
        var d = load();
        d.publishers = d.publishers.filter(function (x) { return x.id !== id; });
        d.visits = d.visits.filter(function (v) { return v.publisherId !== id; });
        return commit();
      },
      importRoster: function (rows) {
        var d = load();
        rows.forEach(function (p) { d.publishers.push(Object.assign({ id: uid() }, p)); });
        return commit();
      },
      saveElder: function (e) {
        var d = load(); var email = e.email.toLowerCase();
        var found = false;
        d.elders = d.elders.map(function (x) { if (x.email === email) { found = true; return Object.assign({}, x, e, { email: email, id: email }); } return x; });
        if (!found) d.elders.push(Object.assign({}, e, { email: email, id: email }));
        return commit();
      },
      removeElder: function (email) {
        var d = load(); d.elders = d.elders.filter(function (x) { return x.email !== email; }); return commit();
      },
      saveSettings: function (s) { var d = load(); d.settings = Object.assign({}, d.settings, s); return commit(); },
      resetDemo: function () {
        try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
        mem = null; load(); return commit();
      }
    };
  }

  /* ---------------- Firebase store ---------------- */
  function FirebaseStore(config) {
    var m = {};           // loaded SDK modules
    var app, auth, db, me = null;
    var listeners = [];
    var data = { publishers: [], visits: [], elders: [], settings: { overdueDays: 180 } };
    var unsubs = [];
    var authCb = null;

    function emit() {
      listeners.forEach(function (cb) {
        cb({ publishers: data.publishers, visits: data.visits, elders: data.elders, settings: data.settings });
      });
    }

    function load() {
      return Promise.all([
        import(FB + 'firebase-app.js'),
        import(FB + 'firebase-auth.js'),
        import(FB + 'firebase-firestore.js')
      ]).then(function (mods) {
        m.app = mods[0]; m.auth = mods[1]; m.fs = mods[2];
        var cfg = Object.assign({}, config);
        // Signing in on iPhone works most reliably when the sign-in helper lives on the
        // same site as the app, which Firebase Hosting provides automatically.
        var h = location.hostname;
        if (/\.(web\.app|firebaseapp\.com)$/.test(h)) cfg.authDomain = h;
        app = m.app.initializeApp(cfg);
        auth = m.auth.getAuth(app);
        try {
          db = m.fs.initializeFirestore(app, {
            localCache: m.fs.persistentLocalCache({ tabManager: m.fs.persistentMultipleTabManager() })
          });
        } catch (e) {
          db = m.fs.getFirestore(app);
        }
      });
    }

    function stopListening() {
      unsubs.forEach(function (u) { u(); }); unsubs = [];
      data = { publishers: [], visits: [], elders: [], settings: { overdueDays: 180 } };
    }

    function listen() {
      var fs = m.fs;
      function snapTo(key) {
        return function (snap) {
          data[key] = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
          emit();
        };
      }
      unsubs.push(fs.onSnapshot(fs.collection(db, 'publishers'), snapTo('publishers')));
      unsubs.push(fs.onSnapshot(fs.collection(db, 'visits'), snapTo('visits')));
      unsubs.push(fs.onSnapshot(fs.collection(db, 'elders'), snapTo('elders')));
      unsubs.push(fs.onSnapshot(fs.doc(db, 'settings', 'app'), function (d) {
        data.settings = Object.assign({ overdueDays: 180 }, d.exists() ? d.data() : {});
        emit();
      }));
    }

    return {
      mode: 'live',
      init: function (cb) {
        authCb = cb;
        cb({ status: 'loading' });
        load().then(function () {
          m.auth.getRedirectResult(auth).catch(function (e) { cb({ status: 'out', error: friendly(e) }); });
          m.auth.onAuthStateChanged(auth, function (u) {
            stopListening();
            if (!u) { me = null; cb({ status: 'out' }); return; }
            var email = (u.email || '').toLowerCase();
            me = { email: email, name: u.displayName || email };
            m.fs.getDoc(m.fs.doc(db, 'elders', email)).then(function (d) {
              if (!d.exists()) { cb({ status: 'denied', user: me }); return; }
              me.name = d.data().name || me.name;
              listen();
              cb({ status: 'in', user: me });
            }).catch(function () { cb({ status: 'denied', user: me }); });
          });
        }).catch(function () {
          cb({ status: 'out', error: 'Could not reach the server. Check your internet connection and reopen Embrace.' });
        });
      },
      signIn: function () {
        var p = new m.auth.GoogleAuthProvider();
        p.setCustomParameters({ prompt: 'select_account' });
        return m.auth.signInWithPopup(auth, p).catch(function (e) {
          if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
            return m.auth.signInWithRedirect(auth, p);
          }
          if (e && e.code === 'auth/popup-closed-by-user') return;
          throw new Error(friendly(e));
        });
      },
      signOut: function () { return m.auth.signOut(auth); },
      subscribe: function (cb) { listeners.push(cb); emit(); },
      addVisit: function (v) {
        return m.fs.addDoc(m.fs.collection(db, 'visits'), Object.assign({}, v, {
          createdBy: me.email, createdAt: m.fs.serverTimestamp()
        }));
      },
      deleteVisit: function (id) { return m.fs.deleteDoc(m.fs.doc(db, 'visits', id)); },
      savePublisher: function (p) {
        var body = Object.assign({}, p); delete body.id;
        body.updatedAt = m.fs.serverTimestamp();
        if (p.id) return m.fs.setDoc(m.fs.doc(db, 'publishers', p.id), body, { merge: true });
        return m.fs.addDoc(m.fs.collection(db, 'publishers'), body);
      },
      deletePublisher: function (id) {
        var b = m.fs.writeBatch(db);
        b.delete(m.fs.doc(db, 'publishers', id));
        data.visits.filter(function (v) { return v.publisherId === id; }).forEach(function (v) {
          b.delete(m.fs.doc(db, 'visits', v.id));
        });
        return b.commit();
      },
      importRoster: function (rows) {
        var chunks = [];
        for (var i = 0; i < rows.length; i += 400) chunks.push(rows.slice(i, i + 400));
        return chunks.reduce(function (pr, chunk) {
          return pr.then(function () {
            var b = m.fs.writeBatch(db);
            chunk.forEach(function (p) { b.set(m.fs.doc(m.fs.collection(db, 'publishers')), p); });
            return b.commit();
          });
        }, Promise.resolve());
      },
      saveElder: function (e) {
        var email = e.email.toLowerCase();
        var body = { name: e.name, admin: !!e.admin };
        return m.fs.setDoc(m.fs.doc(db, 'elders', email), body, { merge: true });
      },
      removeElder: function (email) { return m.fs.deleteDoc(m.fs.doc(db, 'elders', email)); },
      saveSettings: function (s) { return m.fs.setDoc(m.fs.doc(db, 'settings', 'app'), s, { merge: true }); }
    };
  }

  function friendly(e) {
    var code = (e && e.code) || '';
    if (code === 'auth/network-request-failed') return 'No internet connection. Try again when you have signal.';
    if (code === 'auth/unauthorized-domain') return 'This web address is not approved for sign-in yet. Add it in Firebase › Authentication › Settings › Authorized domains.';
    if (code === 'permission-denied') return 'Your account is not on the elders list. Ask the coordinator to add your Gmail address.';
    return (e && e.message) || 'Something went wrong. Please try again.';
  }

  window.EmbraceStore = {
    create: function () {
      var cfg = window.EMBRACE_FIREBASE_CONFIG;
      if (cfg && cfg.apiKey && cfg.projectId) return FirebaseStore(cfg);
      return LocalStore(window.EMBRACE_DEMO_ROSTER || []);
    },
    friendly: friendly
  };
})();
