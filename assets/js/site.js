/* OCCPL Logistics website: menu, tracking (OCCPL courier platform public API), scan to track, calculators. */
(function () {
  'use strict';
  var cfg = window.OCCPL_CONFIG || {};
  var API = (cfg.apiBase || '/api/v1').replace(/\/$/, '');
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clean(v) { return String(v || '').trim().toUpperCase().replace(/\s+/g, ''); }

  // ---- menu
  var hd = $('#hd'), menu = $('.menu');
  if (menu) menu.addEventListener('click', function () {
    var open = hd.classList.toggle('open');
    menu.setAttribute('aria-expanded', String(open));
    menu.textContent = open ? '✕' : '☰';
  });

  // ---- any "track" form: go to the Track page with the number
  $$('form[data-track-form]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var n = clean(f.querySelector('input').value);
      if (!n) { f.querySelector('input').focus(); return; }
      if ($('#track-app') && f.hasAttribute('data-inline')) { history.replaceState(null, '', '?awb=' + encodeURIComponent(n)); track(n); }
      else location.href = '/track/?awb=' + encodeURIComponent(n);
    });
  });

  // ---- scan to track: the camera reads a barcode / QR and tracks its number
  var scan = $('#scan'), video = $('#scan-video'), msg = $('#scan-msg'), stream = null, stop = false;
  function detectorFactory() {
    if ('BarcodeDetector' in window) return Promise.resolve(window.BarcodeDetector);
    // Browsers without a built-in reader (e.g. iPhone Safari): a reader based on ZXing, loaded only when needed.
    return import('https://cdn.jsdelivr.net/npm/barcode-detector@2.3.1/pure/+esm').then(function (m) { return m.BarcodeDetector; });
  }
  function numberFrom(raw) {
    var v = String(raw || '').trim();
    try { var u = new URL(v); var p = u.searchParams.get('awb') || u.searchParams.get('number') || u.searchParams.get('q'); if (p) return clean(p); var seg = u.pathname.split('/').filter(Boolean).pop(); if (seg) return clean(seg); } catch (e) { /* not a link */ }
    return clean(v);
  }
  function closeScan() {
    stop = true;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    if (scan) scan.classList.remove('open');
  }
  function openScan() {
    if (!scan) return;
    stop = false;
    scan.classList.add('open');
    msg.textContent = 'Starting the camera…';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = 'This browser cannot use the camera. Type the number instead.'; return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
      stream = s; video.srcObject = s; return video.play();
    }).then(detectorFactory).then(function (Detector) {
      var det = new Detector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'codabar', 'itf', 'data_matrix', 'pdf417'] });
      msg.textContent = 'Point the camera at the barcode or QR on your receipt or shipment label.';
      (function loop() {
        if (stop) return;
        det.detect(video).then(function (codes) {
          var hit = codes && codes[0] && numberFrom(codes[0].rawValue);
          if (hit) {
            msg.textContent = '✓ Read ' + hit + ' · opening…';
            closeScan();
            if ($('#track-app')) { history.replaceState(null, '', '?awb=' + encodeURIComponent(hit)); $$('form[data-track-form] input').forEach(function (i) { i.value = hit; }); track(hit); }
            else location.href = '/track/?awb=' + encodeURIComponent(hit);
          } else setTimeout(loop, 250);
        }).catch(function () { setTimeout(loop, 400); });
      })();
    }).catch(function (e) {
      msg.textContent = e && e.name === 'NotAllowedError'
        ? 'Camera permission was refused. Allow the camera for this site, or type the number.'
        : 'Could not start the scanner on this device. Type the number instead.';
    });
  }
  $$('[data-scan]').forEach(function (b) { b.addEventListener('click', openScan); });
  $$('[data-scan-close]').forEach(function (b) { b.addEventListener('click', closeScan); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && scan && scan.classList.contains('open')) closeScan(); });

  // ---- tracking page
  var STEPS = [
    ['BOOKED', 'Booked', 'Shipment booked at the branch'],
    ['READY_FOR_MANIFEST', 'Ready for dispatch', 'Packed and added to the load sheet'],
    ['MANIFEST_CREATED', 'Manifested', 'Assigned to a vehicle'],
    ['DISPATCHED', 'In transit', 'On the way to the delivery branch'],
    ['IN_SCAN', 'Reached delivery branch', 'Received at the destination branch'],
    ['OUT_FOR_DELIVERY', 'Out for delivery', 'With our delivery partner today'],
    ['DELIVERED', 'Delivered', 'Handed over to the receiver']
  ];
  var LABEL = {}; STEPS.forEach(function (s) { LABEL[s[0]] = s[1]; });
  LABEL.RETURNED = 'Returned to sender'; LABEL.CANCELLED = 'Cancelled';
  var BADGE = { DELIVERED: 'p-green', RETURNED: 'p-amber', CANCELLED: 'p-red' };
  function fmtDate(d) { if (!d) return '—'; var x = new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')); return isNaN(x) ? d : x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function fmtTime(t) { if (!t) return ''; var x = new Date(t); return isNaN(x) ? '' : x.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  var TIMEOUT_MS = 15000; // covers the whole request, including reading the body
  function api(path, opts) {
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, TIMEOUT_MS);
    function done() { clearTimeout(timer); }
    var p = fetch(API + path, Object.assign({ headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, signal: ctl.signal }, opts || {}))
      .then(function (r) {
        return r.json().catch(function (e) { if (ctl.signal.aborted) throw e; return {}; })
          .then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
      });
    p.then(done, done);
    return p;
  }
  function slow(e) { return !!e && e.name === 'AbortError'; }
  var app = $('#track-app'), current = null;
  function track(n) {
    if (!app) return;
    current = n;
    app.innerHTML = '<div class="skel" aria-label="Loading"></div>';
    api('/track/' + encodeURIComponent(n)).then(function (r) {
      if (current !== n) return;
      if (!r.ok) {
        app.innerHTML = '<div class="err" role="alert">' + esc(r.status === 404 ? 'No shipment found for ' + n + '. Check the AWB / docket number on your receipt.' : (r.body && r.body.message) || 'Tracking is not available right now. Please try again in a moment.') + '</div>';
        return;
      }
      render(r.body.data || r.body);
    }).catch(function (e) {
      if (current !== n) return;
      app.innerHTML = '<div class="err" role="alert">' + (slow(e) ? 'Tracking is taking too long to respond.' : 'Could not reach the tracking service. Check your connection and try again.') + '</div><p><button class="btn btn--red" type="button" id="retry">Try again</button></p>';
      $('#retry').addEventListener('click', function () { track(n); });
    });
  }
  function render(t) {
    var status = t.status, idx = -1;
    STEPS.forEach(function (s, i) { if (s[0] === status) idx = i; });
    var when = {}; (t.timeline || []).forEach(function (e) { when[e.status] = e.changedAt; });
    var bad = status === 'CANCELLED' || status === 'RETURNED';
    var pct = status === 'DELIVERED' ? 100 : idx < 0 ? 8 : Math.round((idx + 0.5) / STEPS.length * 100);
    var steps = STEPS.map(function (s, i) {
      var done = idx >= 0 && i < idx || status === 'DELIVERED', now = i === idx && status !== 'DELIVERED';
      var cls = done ? '' : now ? 'now' : 'todo';
      return '<div class="' + (done ? '' : 'todo') + '"><span class="dot ' + cls + '">' + (done ? '✓' : now ? '●' : '') + '</span><span><b' + (cls === 'todo' ? ' style="color:var(--muted)"' : '') + '>' + s[1] + '</b><br><span>' + s[2] + '</span></span><time>' + esc(fmtTime(when[s[0]])) + '</time></div>';
    }).join('');
    if (bad) steps += '<div><span class="dot bad">!</span><span><b>' + LABEL[status] + '</b><br><span>' + (status === 'RETURNED' ? 'The shipment went back to the sender' : 'This booking was cancelled') + '</span></span><time>' + esc(fmtTime(when[status])) + '</time></div>';
    var partner = t.carrier ? '<p class="note" style="margin-top:16px">Delivered by our partner <b>' + esc(t.carrier) + '</b>' + (t.latestStatus ? ': ' + esc(t.latestStatus) + (t.latestLocation ? ' · ' + esc(t.latestLocation) : '') : '') + '</p>' : '';
    app.innerHTML =
      '<div class="tgrid"><div class="panel">' +
        '<div class="st-top"><div class="awb"><small>AWB number</small><div>' + esc(t.trackingNumber || t.shipmentNumber) + '</div>' + (t.shipmentNumber && t.shipmentNumber !== t.trackingNumber ? '<small>Shipment ' + esc(t.shipmentNumber) + '</small>' : '') + '</div>' +
        '<span class="pill ' + (BADGE[status] || 'p-info') + '">● ' + esc(LABEL[status] || status) + '</span></div>' +
        '<div class="route"><div><small>From</small><b>' + esc(t.fromCity || '—') + '</b></div><div class="prog" aria-hidden="true"><span style="width:' + pct + '%"></span></div><div style="text-align:right"><small>To</small><b>' + esc(t.toCity || '—') + '</b></div></div>' +
        '<div class="meta"><div><small>Booked on</small><b>' + fmtDate(t.bookingDate) + '</b></div><div><small>Expected delivery</small><b style="color:var(--success)">' + (status === 'DELIVERED' ? 'Delivered' : fmtDate(t.expectedDeliveryDate)) + '</b></div><div><small>Current status</small><b>' + esc(LABEL[status] || status) + '</b></div></div>' +
        partner + '<h2 style="font-size:18px;margin:28px 0 16px">Shipment journey</h2><div class="tl">' + steps + '</div></div>' +
      '<div style="display:grid;gap:24px"><div class="panel"><h2 style="font-size:18px">See full details</h2><p style="color:var(--muted);margin:8px 0 14px">Enter the <b>last 4 digits of the receiver\'s mobile number</b> to see addresses, current location and the proof of delivery.</p>' +
        '<form id="verify" class="row" style="display:flex;gap:10px"><label class="sr" for="last4">Last 4 digits</label><input id="last4" class="input" inputmode="numeric" maxlength="4" pattern="\\d{4}" placeholder="e.g. 4321" required><button class="btn btn--red" type="submit">Verify</button></form><div id="detail" style="margin-top:14px"></div></div>' +
        '<div class="panel help"><h2 style="font-size:18px">Need help?</h2><a href="#" id="complain">Raise a complaint about this shipment <span>→</span></a><a href="tel:+919370721219">Call customer care <span style="color:var(--primary-strong)">93707 21219</span></a><a href="mailto:info@occpllogistics.com">Email us <span>info@occpllogistics.com</span></a></div></div></div>';
    $('#verify').addEventListener('submit', function (e) { e.preventDefault(); verify(); });
    $('#complain').addEventListener('click', function (e) { e.preventDefault(); var d = $('#detail'); if (!d.dataset.ok) { $('#last4').focus(); d.innerHTML = '<p class="note">Verify with the last 4 digits first, then you can raise a complaint.</p>'; } else complaintForm(); });
  }
  var last4 = '';
  function verify() {
    var v = $('#last4').value.trim(), d = $('#detail');
    if (!/^\d{4}$/.test(v)) { d.innerHTML = '<div class="err">Enter exactly 4 digits.</div>'; return; }
    d.innerHTML = '<p class="hint">Checking…</p>';
    api('/track/' + encodeURIComponent(current) + '/verify', { method: 'POST', body: JSON.stringify({ phoneLast4: v }) }).then(function (r) {
      if (!r.ok) { d.innerHTML = '<div class="err" role="alert">' + esc((r.body && r.body.message) || 'Those digits do not match this shipment.') + '</div>'; return; }
      last4 = v; d.dataset.ok = '1';
      var x = r.body.data || r.body, pod = x.pod;
      d.innerHTML = '<div class="kv"><div><small>Sender</small><span>' + esc(x.senderName) + '<br>' + esc(x.senderAddress) + '</span></div><div><small>Receiver</small><span>' + esc(x.receiverName) + '<br>' + esc(x.receiverAddress) + '</span></div>' +
        (x.currentLocation ? '<div><small>Now at</small><span>' + esc(x.currentLocation) + '</span></div>' : '') + '</div>' +
        (pod ? '<h3 style="font-size:16px;margin-top:16px">Proof of delivery</h3><p class="hint">Delivered ' + esc(fmtTime(pod.deliveredAt)) + (pod.deliveredBy ? ' by ' + esc(pod.deliveredBy) : '') + '</p><div class="pod">' +
          (pod.photoUrl ? '<a href="' + esc(pod.photoUrl) + '" target="_blank" rel="noopener"><img src="' + esc(pod.photoUrl) + '" alt="Delivery photo"></a>' : '') +
          (pod.signatureUrl ? '<a href="' + esc(pod.signatureUrl) + '" target="_blank" rel="noopener"><img src="' + esc(pod.signatureUrl) + '" alt="Receiver signature"></a>' : '') + '</div>' : '') +
        ((x.tickets || []).length ? '<h3 style="font-size:16px;margin-top:16px">Your complaints</h3>' + x.tickets.map(function (k) { return '<p class="hint"><b>' + esc(k.ticketNumber) + '</b> · ' + esc(k.subject) + ' · <span class="pill p-grey">' + esc(k.status) + '</span></p>'; }).join('') : '');
    }).catch(function (e) { d.innerHTML = '<div class="err" role="alert">' + (slow(e) ? 'This is taking too long.' : 'Could not reach the tracking service.') + ' Please try Verify again.</div>'; });
  }
  function complaintForm() {
    var d = $('#detail');
    var box = document.createElement('form'); box.className = 'form'; box.style.marginTop = '16px';
    box.innerHTML = '<h3 style="font-size:16px">Raise a complaint</h3><label>Subject<input class="input" name="subject" maxlength="150" required></label><label>Message<textarea class="input" name="message" rows="4" maxlength="2000" required></textarea></label><button class="btn btn--red" type="submit">Send</button><div class="out"></div>';
    d.appendChild(box);
    box.addEventListener('submit', function (e) {
      e.preventDefault();
      var out = box.querySelector('.out'), btn = box.querySelector('button');
      btn.disabled = true;
      out.innerHTML = '<p class="hint">Sending…</p>';
      api('/track/' + encodeURIComponent(current) + '/tickets', { method: 'POST', body: JSON.stringify({ phoneLast4: last4, subject: box.subject.value.trim(), message: box.message.value.trim() }) }).then(function (r) {
        var k = r.body && (r.body.data || r.body);
        out.innerHTML = r.ok ? '<p class="pill p-green">✓ Complaint registered' + (k && k.ticketNumber ? ': ' + esc(k.ticketNumber) : '') + '. Our customer care will contact you within 3 working days.</p>' : '<div class="err">' + esc((r.body && r.body.message) || 'Could not send. Please call 93707 21219.') + '</div>';
        btn.disabled = r.ok;
      }).catch(function () {
        btn.disabled = false;
        out.innerHTML = '<div class="err" role="alert">We could not confirm your complaint was received. To avoid sending it twice, press Verify again to see your complaints, or call 93707 21219.</div>';
      });
    });
  }
  if (app) {
    var q = new URLSearchParams(location.search).get('awb');
    if (q) { q = clean(q); $$('form[data-track-form] input').forEach(function (i) { i.value = q; }); track(q); }
  }

  // ---- volumetric weight calculator (cm, divisor 5000 for courier / 4000 for cargo)
  var vol = $('#vol-calc');
  if (vol) {
    var calc = function () {
      var l = +vol.l.value || 0, w = +vol.w.value || 0, h = +vol.h.value || 0, n = Math.max(1, +vol.n.value || 1), a = +vol.a.value || 0, div = +vol.div.value || 5000;
      var v = l * w * h / div * n, c = Math.max(v, a);
      $('#vol-out').innerHTML = '<div><b>' + v.toFixed(2) + ' kg</b><span>Volumetric weight</span></div><div><b>' + a.toFixed(2) + ' kg</b><span>Actual weight</span></div><div><b>' + c.toFixed(2) + ' kg</b><span>Chargeable weight</span></div>';
    };
    vol.addEventListener('input', calc); calc();
  }
  var conv = $('#conv');
  if (conv) {
    var cv = function () { var v = +conv.v.value || 0, k = conv.u.value; var r = k === 'kg-lb' ? v * 2.20462 : k === 'lb-kg' ? v / 2.20462 : k === 'cm-in' ? v / 2.54 : v * 2.54; $('#conv-out').textContent = r.toFixed(3); };
    conv.addEventListener('input', cv); cv();
  }

  // ---- enquiry forms: open the customer's email app with the details filled in (no data stored on this website)
  $$('form[data-mail]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var lines = $$('input,select,textarea', f).filter(function (i) { return i.name && i.type !== 'checkbox'; }).map(function (i) { return i.getAttribute('data-label') + ': ' + i.value; });
      location.href = 'mailto:info@occpllogistics.com?subject=' + encodeURIComponent(f.getAttribute('data-mail')) + '&body=' + encodeURIComponent(lines.join('\n'));
    });
  });
})();
