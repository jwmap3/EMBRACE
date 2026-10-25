/* Embrace data layer.
 *   FirebaseStore: live-synced between every elder's phone. Each phone signs in silently
 *                  (anonymous Firebase account) and unlocks once with the congregation code.
 *   LocalStore:    preview mode, data stays on this device (used when no Firebase config is set).
 */
(function () {
  'use strict';

  var FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function blank() { return { publishers: [], visits: [], plans: [], settings: { overdueDays: 365 } }; }

  /* ---------------- Preview / local store ---------------- */
  function LocalStore(seed) {
    var KEY = 'embrace-demo-v2';
    var mem = null, listeners = [];

    function load() {
      if (mem) return mem;
      try { mem = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { mem = null; }
      if (!mem) {
        mem = blank();
        (seed || []).forEach(function (p) { mem.publishers.push(Object.assign({ id: uid() }, p)); });
        (window.EMBRACE_DEMO_VISITS || []).forEach(function (v) { mem.visits.push(Object.assign({ id: uid(), createdAt: 0 }, v)); });
        save();
      }
      return mem;
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* blocked: memory only */ } }
    function emit() {
      var d = load();
      listeners.forEach(function (cb) { cb({ publishers: d.publishers.slice(), visits: d.visits.slice(), plans: (d.plans || []).slice(), settings: d.settings }); });
    }
    function commit() { save(); emit(); return Promise.resolve(); }

    return {
      mode: 'demo',
      init: function (cb) { cb({ status: 'ready' }); },
      subscribe: function (cb) { listeners.push(cb); emit(); },
      addVisit: function (v) { load().visits.push(Object.assign({ id: uid(), createdAt: Date.now() }, v)); return commit(); },
      deleteVisit: function (id) { var d = load(); d.visits = d.visits.filter(function (v) { return v.id !== id; }); return commit(); },
      savePublisher: function (p) {
        var d = load(), id = p.id || uid();
        if (p.id) d.publishers = d.publishers.map(function (x) { return x.id === p.id ? Object.assign({}, x, p) : x; });
        else d.publishers.push(Object.assign({}, p, { id: id }));
        return commit().then(function () { return id; });
      },
      deletePublisher: function (id) {
        var d = load();
        d.publishers = d.publishers.filter(function (x) { return x.id !== id; });
        d.visits = d.visits.filter(function (v) { return v.publisherId !== id; });
        return commit();
      },
      importRoster: function (rows) { var d = load(); rows.forEach(function (p) { d.publishers.push(Object.assign({ id: uid() }, p)); }); return commit(); },
      updateMany: function (list) {
        var d = load(), by = {};
        list.forEach(function (u) { by[u.id] = u; });
        d.publishers = d.publishers.map(function (p) { return by[p.id] ? Object.assign({}, p, by[p.id]) : p; });
        return commit();
      },
      addVisits: function (list) {
        var d = load();
        list.forEach(function (v) { d.visits.push(Object.assign({ id: uid(), createdAt: Date.now() }, v)); });
        return commit();
      },
      saveSettings: function (s) { var d = load(); d.settings = Object.assign({}, d.settings, s); return commit(); },
      addPlan: function (x) { var d = load(); d.plans = d.plans || []; d.plans.push(Object.assign({ id: 'plan_' + uid(), createdAt: Date.now() }, x)); return commit(); },
      deletePlan: function (id) { var d = load(); d.plans = (d.plans || []).filter(function (x) { return x.id !== id; }); return commit(); },
      resetDemo: function () { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } mem = null; load(); return commit(); }
    };
  }

  /* ---------------- Firebase store ---------------- */
  function FirebaseStore(config) {
    var m = {}, app, auth, db, user = null;
    var listeners = [], unsubs = [], data = blank(), stateCb = null, gotPublishers = false;

    function emit() {
      listeners.forEach(function (cb) { cb({ publishers: data.publishers, visits: data.visits, plans: data.plans || [], settings: data.settings, ready: gotPublishers }); });
    }
    function ref(path) { return m.fs.doc.apply(null, [db].concat(path.split('/'))); }
    function col(name) { return m.fs.collection(db, name); }

    function listen() {
      function into(key) {
        return function (snap) {
          data[key] = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
          if (key === 'publishers') gotPublishers = true;
          emit();
        };
      }
      unsubs.push(m.fs.onSnapshot(col('publishers'), into('publishers')));
      unsubs.push(m.fs.onSnapshot(col('visits'), into('visits')));
      // Settings and the shared calendar of planned visits share the "settings" collection.
      unsubs.push(m.fs.onSnapshot(col('settings'), function (snap) {
        var st = {}, pl = [];
        snap.docs.forEach(function (d) {
          if (d.id === 'app') st = d.data();
          else if (d.id.indexOf('plan_') === 0) pl.push(Object.assign({ id: d.id }, d.data()));
        });
        data.settings = Object.assign({ overdueDays: 365 }, st); data.plans = pl; emit();
      }));
    }

    // Firestore accepts up to 500 writes per batch; stay well under it.
    function batched(items, add) {
      var chunks = [];
      for (var i = 0; i < items.length; i += 400) chunks.push(items.slice(i, i + 400));
      return chunks.reduce(function (pr, chunk) {
        return pr.then(function () {
          var b = m.fs.writeBatch(db);
          chunk.forEach(function (it) { add(b, it); });
          return b.commit();
        });
      }, Promise.resolve());
    }

    // Is this phone unlocked? If not, has a congregation code been created yet?
    function check() {
      return m.fs.getDoc(ref('devices/' + user.uid)).then(function (d) {
        if (d.exists()) { listen(); stateCb({ status: 'ready' }); return; }
        return m.fs.getDoc(ref('config/public')).then(function (p) {
          stateCb({ status: p.exists() && p.data().codeSet ? 'code' : 'setcode' });
        });
      });
    }

    return {
      mode: 'live',
      init: function (cb) {
        stateCb = cb;
        cb({ status: 'loading' });
        Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')])
          .then(function (mods) {
            m.app = mods[0]; m.auth = mods[1]; m.fs = mods[2];
            app = m.app.initializeApp(config);
            auth = m.auth.getAuth(app);
            try {
              db = m.fs.initializeFirestore(app, { localCache: m.fs.persistentLocalCache({ tabManager: m.fs.persistentMultipleTabManager() }) });
            } catch (e) { db = m.fs.getFirestore(app); }
            m.auth.onAuthStateChanged(auth, function (u) {
              if (!u) { m.auth.signInAnonymously(auth).catch(function (e) { cb({ status: 'error', error: friendly(e) }); }); return; }
              user = u;
              check().catch(function (e) { cb({ status: 'error', error: friendly(e) }); });
            });
          })
          .catch(function () { cb({ status: 'error', error: 'Could not reach the server. Check your internet connection and open Embrace again.' }); });
      },
      enterCode: function (code) {
        return m.fs.setDoc(ref('devices/' + user.uid), { code: code, at: m.fs.serverTimestamp() })
          .then(function () { listen(); stateCb({ status: 'ready' }); })
          .catch(function (e) {
            if (e && e.code === 'permission-denied') throw new Error('That code is not right. Check with the other elders and try again.');
            throw new Error(friendly(e));
          });
      },
      createCode: function (code) {
        var b = m.fs.writeBatch(db);
        b.set(ref('config/access'), { code: code });
        b.set(ref('config/public'), { codeSet: true });
        b.set(ref('devices/' + user.uid), { code: code, at: m.fs.serverTimestamp() });
        return b.commit().then(function () { listen(); stateCb({ status: 'ready' }); }, function (e) { throw new Error(friendly(e)); });
      },
      changeCode: function (code) { return m.fs.setDoc(ref('config/access'), { code: code }); },
      subscribe: function (cb) { listeners.push(cb); emit(); },
      addVisit: function (v) { return m.fs.addDoc(col('visits'), Object.assign({}, v, { createdAt: m.fs.serverTimestamp() })); },
      deleteVisit: function (id) { return m.fs.deleteDoc(ref('visits/' + id)); },
      savePublisher: function (p) {
        var body = Object.assign({}, p); delete body.id;
        if (p.id) return m.fs.setDoc(ref('publishers/' + p.id), body, { merge: true }).then(function () { return p.id; });
        return m.fs.addDoc(col('publishers'), body).then(function (r) { return r.id; });
      },
      deletePublisher: function (id) {
        var b = m.fs.writeBatch(db);
        b.delete(ref('publishers/' + id));
        data.visits.filter(function (v) { return v.publisherId === id; }).forEach(function (v) { b.delete(ref('visits/' + v.id)); });
        return b.commit();
      },
      importRoster: function (rows) {
        return batched(rows, function (b, p) {
          var body = Object.assign({}, p); delete body.id;
          b.set(p.id ? ref('publishers/' + p.id) : m.fs.doc(col('publishers')), body);
        });
      },
      updateMany: function (list) {
        return batched(list, function (b, u) {
          var body = Object.assign({}, u); delete body.id;
          b.set(ref('publishers/' + u.id), body, { merge: true });
        });
      },
      addVisits: function (list) {
        return batched(list, function (b, v) {
          b.set(m.fs.doc(col('visits')), Object.assign({}, v, { createdAt: m.fs.serverTimestamp() }));
        });
      },
      saveSettings: function (s) { return m.fs.setDoc(ref('settings/app'), s, { merge: true }); },
      addPlan: function (x) {
        var id = 'plan_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        return m.fs.setDoc(ref('settings/' + id), Object.assign({ kind: 'plan' }, x, { createdAt: m.fs.serverTimestamp() }));
      },
      deletePlan: function (id) { return m.fs.deleteDoc(ref('settings/' + id)); }
    };
  }

  function friendly(e) {
    var code = (e && e.code) || '';
    if (code === 'auth/network-request-failed' || code === 'unavailable') return 'No internet connection. Try again when you have signal.';
    if (code === 'auth/admin-restricted-operation' || code === 'auth/operation-not-allowed') return 'Embrace is not fully set up yet: turn on Anonymous sign-in in Firebase › Authentication.';
    if (code === 'permission-denied') return 'This phone is not unlocked. Close Embrace, open it again, and enter the congregation code.';
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
