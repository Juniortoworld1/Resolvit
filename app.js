/* ==========================================================
   ResolveIt - app.js
   One script for all pages. Data is kept in the browser's
   localStorage as a small database with two tables:
     users       - registered accounts
     complaints  - every complaint, with its status and update log
   Add this line before </body> on every page:
     <script src="app.js"></script>
   ========================================================== */
(function () {
  'use strict';

  var DB_KEY = 'resolveit_db_v1';
  var SESSION_KEY = 'resolveit_session_v1';
  var STAGES = ['Pending', 'Under review', 'Assigned', 'In progress', 'Resolved'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var BASE_RECEIVED = 1284;   // historical figures shown on the home page
  var BASE_RESOLVED = 1040;
  var memory = {};            // fallback if storage is blocked

  /* ---------- small helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function normPhone(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2);
    if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1);
    return d;
  }
  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  function isPhone(v) { return /^\d{10}$/.test(normPhone(v)); }

  /* ---------- storage layer ---------- */
  function lsGet(area, key) {
    try { return window[area].getItem(key); } catch (e) { return memory[area + key] || null; }
  }
  function lsSet(area, key, val) {
    try { window[area].setItem(key, val); } catch (e) { memory[area + key] = val; }
  }
  function lsDel(area, key) {
    try { window[area].removeItem(key); } catch (e) { delete memory[area + key]; }
  }
  function getDB() {
    var raw = lsGet('localStorage', DB_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function saveDB(db) { lsSet('localStorage', DB_KEY, JSON.stringify(db)); }

  /* ---------- password hashing (demo level) ---------- */
  function hash(str) {
    var data = 'resolveit:' + str;
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('');
      });
    }
    var h = 5381;
    for (var i = 0; i < data.length; i++) h = ((h << 5) + h + data.charCodeAt(i)) | 0;
    return Promise.resolve('x' + (h >>> 0).toString(16));
  }

  /* ---------- first-run data ---------- */
  function seedComplaints() {
    function c(id, issue, cat, date, status, log) {
      return {
        id: id, issue: issue, details: issue, category: cat, priority: 'Normal',
        location: '', name: 'Anonymous', contact: '', anonymous: true, userId: null,
        fileName: '', status: status, createdAt: date, log: log, rating: null, seed: true
      };
    }
    return [
      c('CMP-0478', 'Pothole on main road', 'Roads', '2026-10-23', 'Assigned', [
        { date: '2026-10-23', text: 'Complaint registered.' },
        { date: '2026-10-24', text: 'Reviewed and sent to the Roads department.' },
        { date: '2026-10-25', text: 'Assigned to an officer.' }
      ]),
      c('CMP-0479', 'Garbage not collected', 'Sanitation', '2026-10-18', 'Resolved', [
        { date: '2026-10-18', text: 'Complaint registered.' },
        { date: '2026-10-19', text: 'Reviewed and sent to the Sanitation department.' },
        { date: '2026-10-20', text: 'Collection team visited the area.' },
        { date: '2026-10-21', text: 'Issue fixed and complaint closed.' }
      ]),
      c('CMP-0480', 'Water pipe leakage', 'Water supply', '2026-10-25', 'Under review', [
        { date: '2026-10-25', text: 'Complaint registered.' },
        { date: '2026-10-26', text: 'Under review by the Water supply department.' }
      ]),
      c('CMP-0481', 'Street light not working', 'Electricity', '2026-10-20', 'In progress', [
        { date: '2026-10-20', text: 'Complaint registered.' },
        { date: '2026-10-21', text: 'Reviewed and sent to the Electricity department.' },
        { date: '2026-10-22', text: 'Assigned to an officer.' },
        { date: '2026-10-24', text: 'Technician visit scheduled.' }
      ])
    ];
  }

  function init() {
    if (getDB()) return Promise.resolve();
    return Promise.all([hash('admin123'), hash('officer123')]).then(function (h) {
      saveDB({
        users: [
          { id: 'u-admin', name: 'Administrator', email: 'admin@resolveit.example', phone: '', role: 'admin', pass: h[0] },
          { id: 'u-officer', name: 'Help Desk Officer', email: 'officer@resolveit.example', phone: '', role: 'staff', pass: h[1] }
        ],
        complaints: seedComplaints()
      });
    });
  }

  /* ---------- session ---------- */
  function setSession(userId, remember) {
    lsDel('localStorage', SESSION_KEY);
    lsDel('sessionStorage', SESSION_KEY);
    lsSet(remember ? 'localStorage' : 'sessionStorage', SESSION_KEY, userId);
  }
  function clearSession() {
    lsDel('localStorage', SESSION_KEY);
    lsDel('sessionStorage', SESSION_KEY);
  }
  function currentUser() {
    var id = lsGet('sessionStorage', SESSION_KEY) || lsGet('localStorage', SESSION_KEY);
    if (!id) return null;
    var db = getDB();
    if (!db) return null;
    for (var i = 0; i < db.users.length; i++) if (db.users[i].id === id) return db.users[i];
    return null;
  }
  function isStaff(u) { return !!u && (u.role === 'staff' || u.role === 'admin'); }

  function updateNav() {
    var link = document.querySelector('.menu a[href="login.html"]');
    var u = currentUser();
    if (!link || !u) return;
    link.textContent = 'Logout (' + u.name.split(' ')[0] + ')';
    link.addEventListener('click', function (e) {
      e.preventDefault();
      clearSession();
      window.location.href = 'login.html';
    });
  }

  /* ---------- complaint helpers ---------- */
  function nextId(db) {
    var max = 0;
    db.complaints.forEach(function (c) {
      var n = parseInt(c.id.replace(/\D/g, ''), 10);
      if (n > max) max = n;
    });
    return 'CMP-' + ('0000' + (max + 1)).slice(-4);
  }
  function normalizeId(v) {
    v = String(v || '').trim().toUpperCase();
    var m = v.match(/^(?:CMP)?[-\s]*(\d{1,6})$/);
    if (!m) return v;
    return 'CMP-' + ('0000' + m[1]).slice(-Math.max(4, m[1].length));
  }
  function findComplaint(db, id) {
    for (var i = 0; i < db.complaints.length; i++) if (db.complaints[i].id === id) return db.complaints[i];
    return null;
  }
  function addLog(c, text) { c.log.push({ date: new Date().toISOString(), text: text }); }

  /* ---------- messages inside forms ---------- */
  function showMsg(form, text, ok) {
    var el = form.querySelector('.form-msg');
    if (!el) {
      el = document.createElement('p');
      el.className = 'form-msg';
      el.setAttribute('role', 'alert');
      form.appendChild(el);
    }
    el.className = 'form-msg ' + (ok ? 'note' : 'error');
    el.textContent = text;
  }

  /* ==========================================================
     LOGIN PAGE
     ========================================================== */
  function setupLogin() {
    var lf = document.querySelector('.login-form');
    var rf = document.querySelector('.register-form');
    if (!lf || !rf) return;

    var note = document.querySelector('.note');
    if (note) note.textContent = 'Accounts and complaints are saved in this browser.';

    var roleMap = { 'Complainant': 'complainant', 'Staff / Officer': 'staff', 'Administrator': 'admin' };

    lf.addEventListener('submit', function (e) {
      e.preventDefault();
      var roleLabel = $('login-role').value;
      var idRaw = $('login-email').value.trim();
      var pass = $('login-pass').value;
      var remember = lf.querySelector('input[type="checkbox"]').checked;
      if (!idRaw || !pass) { showMsg(lf, 'Enter your email or phone and your password.'); return; }

      var db = getDB();
      var idLower = idRaw.toLowerCase();
      var phone = normPhone(idRaw);
      var user = null;
      db.users.forEach(function (u) {
        if (u.email.toLowerCase() === idLower || (u.phone && phone && u.phone === phone)) user = u;
      });
      if (!user) { showMsg(lf, 'No account matches those details.'); return; }

      hash(pass).then(function (h) {
        if (h !== user.pass) { showMsg(lf, 'Incorrect password.'); return; }
        if (user.role !== roleMap[roleLabel]) {
          showMsg(lf, 'This account is not registered as "' + roleLabel + '".');
          return;
        }
        setSession(user.id, remember);
        showMsg(lf, 'Welcome, ' + user.name + '. Redirecting...', true);
        setTimeout(function () {
          window.location.href = user.role === 'complainant' ? 'submit.html' : 'track.html';
        }, 700);
      });
    });

    rf.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('reg-name').value.trim();
      var email = $('reg-email').value.trim().toLowerCase();
      var phone = normPhone($('reg-phone').value);
      var p1 = $('reg-pass').value;
      var p2 = $('reg-pass2').value;
      var agreed = rf.querySelector('input[type="checkbox"]').checked;

      if (!name) return showMsg(rf, 'Please enter your full name.');
      if (!isEmail(email)) return showMsg(rf, 'Please enter a valid email address.');
      if (!/^\d{10}$/.test(phone)) return showMsg(rf, 'Please enter a 10-digit mobile number.');
      if (p1.length < 6) return showMsg(rf, 'Password must be at least 6 characters.');
      if (p1 !== p2) return showMsg(rf, 'The two passwords do not match.');
      if (!agreed) return showMsg(rf, 'You need to agree to the terms of use.');

      var db = getDB();
      var taken = db.users.some(function (u) { return u.email.toLowerCase() === email || (u.phone && u.phone === phone); });
      if (taken) return showMsg(rf, 'An account with this email or phone already exists.');

      hash(p1).then(function (h) {
        var db2 = getDB();
        var user = { id: 'u-' + Date.now(), name: name, email: email, phone: phone, role: 'complainant', pass: h };
        db2.users.push(user);
        saveDB(db2);
        setSession(user.id, false);
        showMsg(rf, 'Account created. Redirecting...', true);
        setTimeout(function () { window.location.href = 'submit.html'; }, 800);
      });
    });
  }

  /* ==========================================================
     SUBMIT PAGE
     ========================================================== */
  function setupSubmit() {
    var form = $('complaintForm');
    if (!form) return;
    var errEl = $('formError');

    function prefill() {
      var u = currentUser();
      if (u && u.role === 'complainant') {
        $('name').value = u.name;
        $('contact').value = u.email || u.phone;
      }
    }
    prefill();

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errEl.textContent = '';

      var anon = form.querySelector('input[type="checkbox"]').checked;
      var name = $('name').value.trim();
      var contact = $('contact').value.trim();
      var category = $('category').value;
      var details = $('details').value.trim();
      var fileInput = $('file');
      var file = fileInput.files && fileInput.files[0];

      if (!anon) {
        if (!name) { errEl.textContent = 'Please enter your full name, or tick "Submit anonymously".'; return; }
        if (!contact) { errEl.textContent = 'Please enter your email or phone.'; return; }
        if (!isEmail(contact) && !isPhone(contact)) { errEl.textContent = 'Enter a valid email address or a 10-digit phone number.'; return; }
      }
      if (!category) { errEl.textContent = 'Please select a category.'; return; }
      if (details.length < 10) { errEl.textContent = 'Please describe the problem in at least 10 characters.'; return; }
      if (file && file.size > 5 * 1024 * 1024) { errEl.textContent = 'The supporting document must be under 5 MB.'; return; }

      var db = getDB();
      var user = currentUser();
      var now = new Date().toISOString();
      var id = nextId(db);
      var issue = details.replace(/\s+/g, ' ');
      if (issue.length > 60) issue = issue.slice(0, 57) + '...';

      db.complaints.push({
        id: id,
        issue: issue,
        details: details,
        category: category,
        priority: $('priority').value,
        location: $('location').value.trim(),
        name: anon ? 'Anonymous' : name,
        contact: anon ? '' : contact,
        anonymous: anon,
        userId: user ? user.id : null,
        fileName: file ? file.name : '',
        status: 'Pending',
        createdAt: now,
        log: [{ date: now, text: 'Complaint registered.' }],
        rating: null,
        seed: false
      });
      saveDB(db);

      $('newId').textContent = id;
      var link = $('done').querySelector('a');
      if (link) link.href = 'track.html?id=' + encodeURIComponent(id);
      $('done').hidden = false;
      form.reset();
      prefill();
      $('done').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  /* ==========================================================
     TRACK PAGE
     ========================================================== */
  function setupTrack() {
    var form = $('trackForm');
    if (!form) return;
    var input = $('trackId');
    var msg = $('msg');
    var box = $('result');

    // "Your complaints" list for logged-in complainants
    var user = currentUser();
    if (user && user.role === 'complainant') {
      var mine = getDB().complaints.filter(function (c) { return c.userId === user.id; });
      if (mine.length) {
        var p = document.createElement('p');
        p.innerHTML = 'Your complaints: ' + mine.map(function (c) {
          return '<button type="button" class="small secondary" data-id="' + esc(c.id) + '">' + esc(c.id) + '</button>';
        }).join(' ');
        box.parentNode.insertBefore(p, box);
      }
    }

    function render(id) {
      msg.textContent = '';
      var db = getDB();
      var c = findComplaint(db, id);
      if (!c) {
        box.innerHTML = '';
        msg.textContent = 'No complaint found with ID "' + id + '". Check the ID and try again.';
        return;
      }
      var u = currentUser();
      var staff = isStaff(u);
      var cur = STAGES.indexOf(c.status);
      var resolved = c.status === 'Resolved';

      var steps = STAGES.map(function (s, i) {
        var cls = (resolved || i < cur) ? 'done' : (i === cur ? 'current' : '');
        return '<li class="' + cls + '">' + s + '</li>';
      }).join('');

      var log = c.log.map(function (l) {
        return '<li>' + esc(fmtDate(l.date)) + ' \u2013 ' + esc(l.text) + '</li>';
      }).join('');

      var meta = [c.category, 'Priority: ' + c.priority, c.location, 'Filed ' + fmtDate(c.createdAt)]
        .filter(Boolean).map(esc).join(' \u00b7 ');

      var html = '<div class="result">' +
        '<h2>' + esc(c.id) + ' \u2013 ' + esc(c.issue) + '</h2>' +
        '<p class="meta">' + meta + '</p>';

      if (staff) {
        html += '<p class="meta">Filed by: ' + esc(c.name) + (c.contact ? ' (' + esc(c.contact) + ')' : '') +
          (c.fileName ? ' \u00b7 Attachment: ' + esc(c.fileName) : '') + '</p>' +
          '<p>' + esc(c.details) + '</p>';
      }

      html += '<ul class="progress">' + steps + '</ul>' +
        '<p><strong>Updates</strong></p><ul class="log">' + log + '</ul>';

      if (staff) {
        html += '<label for="stStatus">Change status</label><select id="stStatus">' +
          STAGES.map(function (s) {
            return '<option' + (s === c.status ? ' selected' : '') + '>' + s + '</option>';
          }).join('') + '</select>' +
          '<label for="stNote">Note (optional)</label><input type="text" id="stNote">' +
          '<button type="button" class="small" id="stBtn" style="margin-top:12px">Save update</button>';
      } else if (resolved) {
        var stars = '';
        for (var i = 1; i <= 5; i++) {
          stars += '<button type="button" data-star="' + i + '"' + (c.rating && i <= c.rating ? ' class="on"' : '') + '>\u2605</button>';
        }
        html += '<p><strong>' + (c.rating ? 'Thanks for your feedback. Your rating:' : 'Rate how this was handled:') + '</strong></p>' +
          '<div class="stars">' + stars + '</div>' +
          '<button type="button" class="small secondary" id="reviewBtn" style="margin-top:14px">Not fixed? Ask for a review</button>';
      }
      html += '</div>';
      box.innerHTML = html;

      // staff: update status
      var stBtn = $('stBtn');
      if (stBtn) stBtn.addEventListener('click', function () {
        var db2 = getDB();
        var c2 = findComplaint(db2, id);
        var newStatus = $('stStatus').value;
        var note = $('stNote').value.trim();
        if (newStatus !== c2.status) {
          addLog(c2, 'Status changed to "' + newStatus + '".' + (note ? ' ' + note : ''));
        } else if (note) {
          addLog(c2, note);
        } else { return; }
        c2.status = newStatus;
        saveDB(db2);
        render(id);
      });

      // complainant: star rating
      box.querySelectorAll('.stars button').forEach(function (b) {
        b.addEventListener('click', function () {
          var db2 = getDB();
          var c2 = findComplaint(db2, id);
          c2.rating = parseInt(b.getAttribute('data-star'), 10);
          saveDB(db2);
          render(id);
        });
      });

      // complainant: ask for a review
      var rb = $('reviewBtn');
      if (rb) rb.addEventListener('click', function () {
        var db2 = getDB();
        var c2 = findComplaint(db2, id);
        c2.status = 'In progress';
        c2.rating = null;
        addLog(c2, 'Review requested by the complainant. Complaint reopened.');
        saveDB(db2);
        render(id);
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var raw = input.value;
      if (!raw.trim()) { box.innerHTML = ''; msg.textContent = 'Please enter a tracking ID.'; return; }
      var id = normalizeId(raw);
      input.value = id;
      render(id);
    });

    // demo / "your complaints" buttons
    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-id]') : null;
      if (!b) return;
      input.value = b.getAttribute('data-id');
      render(input.value);
    });

    // open from a link like track.html?id=CMP-0482
    var q = new URLSearchParams(window.location.search).get('id');
    if (q) { input.value = normalizeId(q); render(input.value); }
  }

  /* ==========================================================
     RECENT PAGE
     ========================================================== */
  function setupRecent() {
    var tbody = document.querySelector('.table-scroll tbody');
    if (!tbody || !document.querySelector('.table-scroll thead')) return;
    var list = getDB().complaints.slice().sort(function (a, b) {
      return parseInt(b.id.replace(/\D/g, ''), 10) - parseInt(a.id.replace(/\D/g, ''), 10);
    }).slice(0, 10);
    tbody.innerHTML = list.map(function (c) {
      return '<tr><td><a href="track.html?id=' + encodeURIComponent(c.id) + '">' + esc(c.id) + '</a></td>' +
        '<td>' + esc(c.issue) + '</td><td>' + esc(c.category) + '</td>' +
        '<td>' + esc(fmtDate(c.createdAt)) + '</td><td>' + esc(c.status) + '</td></tr>';
    }).join('');
  }

  /* ==========================================================
     HOME PAGE (live numbers)
     ========================================================== */
  function setupHome() {
    var ths = document.querySelectorAll('table th');
    if (!ths.length || !document.querySelector('.step-label') ||
        document.querySelector('.step-label').textContent.indexOf('Page 1') !== 0) return;
    var all = getDB().complaints.filter(function (c) { return !c.seed; });
    var received = BASE_RECEIVED + all.length;
    var resolved = BASE_RESOLVED + all.filter(function (c) { return c.status === 'Resolved'; }).length;
    ths.forEach(function (th) {
      var td = th.nextElementSibling;
      if (!td) return;
      if (th.textContent.trim() === 'Complaints received') td.textContent = received.toLocaleString('en-US');
      if (th.textContent.trim() === 'Complaints resolved') td.textContent = resolved.toLocaleString('en-US');
    });
  }

  /* ---------- start ---------- */
  function start() {
    updateNav();
    setupLogin();
    setupSubmit();
    setupTrack();
    setupRecent();
    setupHome();
  }
  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  onReady(function () { init().then(start); });
})();