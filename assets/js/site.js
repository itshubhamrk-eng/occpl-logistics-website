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

  // ---- WhatsApp: phones open the app from the wa.me link; computers go straight to WhatsApp Web
  var onPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  $$('a[href^="https://wa.me/"]').forEach(function (a) {
    if (onPhone) { a.removeAttribute('target'); return; }
    a.href = a.href.replace(/^https:\/\/wa\.me\/(\d+)\?/, 'https://web.whatsapp.com/send?phone=$1&');
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
  var TIMEOUT_MS = 15000, OLD_TIMEOUT_MS = 30000; // cover the whole request, including reading the body
  function api(path, opts) { return request(API + path, opts, TIMEOUT_MS); }
  function request(url, opts, ms) {
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, ms);
    function done() { clearTimeout(timer); }
    var p = fetch(url, Object.assign({ headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, signal: ctl.signal }, opts || {}))
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
      if (r.status === 404) return trackOld(n);
      if (!r.ok) {
        app.innerHTML = '<div class="err" role="alert">' + esc((r.body && r.body.message) || 'Tracking is not available right now. Please try again in a moment.') + '</div>';
        return;
      }
      render(r.body.data || r.body);
    }).catch(function (e) {
      if (current !== n) return;
      app.innerHTML = '<div class="err" role="alert">' + (slow(e) ? 'Tracking is taking too long to respond.' : 'Could not reach the tracking service. Check your connection and try again.') + '</div><p><button class="btn btn--red" type="button" id="retry">Try again</button></p>';
      $('#retry').addEventListener('click', function () { track(n); });
    });
  }
  // Shipments booked in the old system (what the old website tracked): asked only when the courier platform has no such number.
  function trackOld(n) {
    var none = '<div class="err" role="alert">' + esc('No shipment found for ' + n + '. Check the AWB / docket number on your receipt.') + '</div>';
    if (!/^[A-Z0-9_-]{4,30}$/.test(n)) { app.innerHTML = none; return; }
    return request('/api/old-track/' + n, {}, OLD_TIMEOUT_MS).then(function (r) {
      if (current !== n) return;
      if (r.status === 404) { app.innerHTML = none; return; }
      if (!r.ok || !r.body || (!r.body.internal_status && !r.body.shipway_status)) {
        app.innerHTML = '<div class="err" role="alert">' + (r.status === 429 ? 'Too many searches. Please wait a minute and try again.' : 'Tracking is not available right now. Please try again in a moment.') + '</div>';
        return;
      }
      renderOld(r.body, n);
    });
  }
  function renderOld(d, n) {
    var o = d.internal_status, s = d.shipway_status, photo = '', carrier = '<p class="hint">No shipment data available.</p>';
    function rows(list) { return '<div class="kv">' + list.map(function (x) { return '<div><small>' + x[0] + '</small><span>' + (x[1] ? esc(x[1]) : 'N/A') + '</span></div>'; }).join('') + '</div>'; }
    var order = o ? rows([['Awb No', o.awb_no], ['Consignor', o.consignor], ['Consignee', o.consignee], ['Consignee Address', o.consignee_address],
      ['Consignee City', o.consignee_city], ['Consignee Contact', o.consignee_contact], ['Forwarding Associate', o.forwarding_associate],
      ['Forwarding No', o.forwarding_no], ['Action', o.action], ['Booking Date', o.booking_date], ['Status Date', o.status_date],
      ['Proof', o.proof], ['Remarks', o.remarks]]) : '<p class="hint">No data available.</p>';
    if (o && /^[A-Za-z0-9+/=\s]+$/.test(o.photo_base64 || '')) photo = '<h3 style="font-size:16px;margin-top:16px">Proof of delivery</h3><img src="data:image/jpeg;base64,' + o.photo_base64.replace(/\s+/g, '') + '" alt="Proof of delivery" style="margin-top:10px;border-radius:12px">';
    if (s && !s.error) {
      var x = s.extra_fields || {}, list = [['AWB No', s.awbno], ['Order ID', s.order_id], ['Carrier', s.carrier], ['Pickup Date', s.pickup_date], ['Current Status', s.current_status]];
      if (s.extra_fields) list.push(['Recipient', x.reciever], ['Last Center Name', x.lastCenterName], ['Last Center Phone', x.lastCenterph], ['Expected Delivery Date', x.expected_delivery_date]);
      carrier = rows(list) + (/^https?:\/\//i.test(s.tracking_url || '') ? '<p style="margin:14px 0 0"><a class="btn btn--soft" href="' + esc(s.tracking_url) + '" target="_blank" rel="noopener noreferrer">Track with the carrier</a></p>' : '');
      if (Array.isArray(s.scan) && s.scan.length) carrier += '<h3 style="font-size:16px;margin-top:20px">Scan events</h3>' + rows(s.scan.map(function (e) { return [esc(fmtTime(e.time) || e.time), (e.status_detail || '') + (e.location ? ' at ' + e.location : '')]; }));
    }
    app.innerHTML = '<div class="tgrid old"><div class="panel"><div class="awb"><small>AWB number</small><div>' + esc((o && o.awb_no) || n) + '</div></div>' +
      (o && o.action ? '<p style="margin:12px 0 0"><span class="pill p-info" style="white-space:normal;overflow-wrap:anywhere">' + esc(o.action) + '</span></p>' : '') +
      '<h2 style="font-size:18px;margin-top:22px">Order details</h2>' + order + photo + '</div>' +
      '<div style="display:grid;gap:24px"><div class="panel"><h2 style="font-size:18px">Shipment details</h2>' + carrier + '</div>' +
      '<div class="panel help"><h2 style="font-size:18px">Need help?</h2><a href="tel:+919370321219">Call customer care <span style="color:var(--primary-strong)">93703 21219</span></a><a href="mailto:info@occpllogistics.com">Email us <span>info@occpllogistics.com</span></a></div></div></div>';
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
        '<div class="panel help"><h2 style="font-size:18px">Need help?</h2><a href="#" id="complain">Raise a complaint about this shipment <span>→</span></a><a href="tel:+919370321219">Call customer care <span style="color:var(--primary-strong)">93703 21219</span></a><a href="mailto:info@occpllogistics.com">Email us <span>info@occpllogistics.com</span></a></div></div></div>';
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
        out.innerHTML = r.ok ? '<p class="pill p-green">✓ Complaint registered' + (k && k.ticketNumber ? ': ' + esc(k.ticketNumber) : '') + '. Our customer care will contact you within 3 working days.</p>' : '<div class="err">' + esc((r.body && r.body.message) || 'Could not send. Please call 93703 21219.') + '</div>';
        btn.disabled = r.ok;
      }).catch(function () {
        btn.disabled = false;
        out.innerHTML = '<div class="err" role="alert">We could not confirm your complaint was received. To avoid sending it twice, press Verify again to see your complaints, or call 93703 21219.</div>';
      });
    });
  }
  if (app) {
    var q = new URLSearchParams(location.search).get('awb');
    if (q) { q = clean(q); $$('form[data-track-form] input').forEach(function (i) { i.value = q; }); track(q); }
  }

  // ---- rate calculator: the courier platform's zone tariff (public rates API)
  var rc = $('#rate-calc');
  if (rc) {
    var rout = $('#rate-out'), rbtn = rc.querySelector('button'), rseq = 0;
    var inr = function (v) { return '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var PKG = { DOC: 'Document', NONDOC: 'Parcel', NON_DOC: 'Parcel' };
    var rerr = function (m) { rout.innerHTML = '<div class="err" role="alert" style="margin-top:18px">' + esc(m) + '</div>'; };
    rc.addEventListener('input', function () { rseq++; rout.innerHTML = ''; rbtn.disabled = false; rbtn.textContent = 'Check rates'; });
    rc.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = rc.elements, pin = /^[1-9][0-9]{5}$/, num = function (n) { return f[n].value === '' ? null : +f[n].value; };
      var bad = function (n, m) { rerr(m); f[n].focus(); };
      f.from.value = clean(f.from.value); f.to.value = clean(f.to.value);
      if (!pin.test(f.from.value)) return bad('from', 'Enter a 6-digit from pincode.');
      if (!pin.test(f.to.value)) return bad('to', 'Enter a 6-digit to pincode.');
      if (!(num('kg') > 0) || !f.kg.checkValidity()) return bad('kg', 'Enter the weight in kg, above 0, with up to 3 decimals.');
      if (num('value') === null || !f.value.checkValidity()) return bad('value', 'Enter the value of the goods in rupees.');
      var more = ['pieces', 'l', 'w', 'h'].filter(function (n) { return !f[n].checkValidity(); })[0];
      if (!more && ['l', 'w', 'h'].some(function (n) { return f[n].value; })) more = ['l', 'w', 'h'].filter(function (n) { return !f[n].value; })[0];
      if (more) { rc.querySelector('details').open = true; return bad(more, 'Check the boxes and enter all three dimensions, or leave all three empty.'); }
      var my = ++rseq;
      rbtn.disabled = true; rbtn.textContent = 'Checking…';
      rout.innerHTML = '<div class="skel" style="margin-top:18px" aria-label="Loading"></div>';
      api('/public/rates', { method: 'POST', body: JSON.stringify({ originPincode: f.from.value, destinationPincode: f.to.value, actualWeightKg: num('kg'), declaredValue: num('value'),
        pieces: num('pieces') || 1, lengthCm: num('l'), widthCm: num('w'), heightCm: num('h'), cod: f.cod.checked }) }).then(function (r) {
        if (my !== rseq) return;
        var d = r.body && (r.body.data || r.body);
        if (!r.ok || !d || !Array.isArray(d.rates)) {
          rerr(r.status === 429 ? 'Too many rate checks. Please wait a minute and try again.' : r.status === 422 && r.body && r.body.message ? r.body.message : 'Rates are not available right now. Please try again, or call 93703 21219.');
          return;
        }
        rout.innerHTML = '<div class="rate-grid">' + d.rates.map(function (o, i) {
          var row = function (a, b) { return '<tr><td>' + esc(a) + '</td><td>' + inr(b) + '</td></tr>'; };
          return '<article class="rate-card"><div class="rate-top"><h3>' + esc(o.service) + '</h3>' + (i === 0 ? '<span class="pill p-green">Lowest</span>' : '') + '</div>' +
            '<p>' + esc(PKG[o.packageType] || o.packageType) + (o.deliveryDays == null ? '' : ' · about ' + (o.deliveryDays === 0 ? 'same day' : esc(o.deliveryDays) + (o.deliveryDays === 1 ? ' day' : ' days'))) + (o.remoteArea ? ' · remote area' : '') + '</p>' +
            '<strong>' + inr(o.total) + '</strong><small>' + esc(o.chargeableWeightKg) + ' kg chargeable · including GST</small>' +
            '<details><summary>View breakup</summary><table>' + row('Freight', o.freight) + o.charges.map(function (c) { return row(c.name, c.amount); }).join('') +
            o.taxes.map(function (t) { return row(t.code + ' ' + t.percent + '%', t.amount); }).join('') + (+o.roundOff ? row('Round off', o.roundOff) : '') + '<tr class="sum"><td>Total</td><td>' + inr(o.total) + '</td></tr></table></details></article>';
        }).join('') + '</div><p class="hint">Estimated rates for today. The weight, size and service at booking decide the final charge and delivery date.</p>';
      }).catch(function (e) { if (my === rseq) rerr(slow(e) ? 'This is taking too long. Please try again.' : 'Could not reach the rate service. Check your connection and try again.'); })
        .then(function () { if (my === rseq) { rbtn.disabled = false; rbtn.textContent = 'Check rates'; } });
    });
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
