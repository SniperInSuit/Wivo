/**
 * Wivo visiiditaotluse vorm — üks fail, mille saab panna ükskõik millisele
 * kodulehele.
 *
 * ── Miks tavaline JavaScript, mitte React-komponent ──────────────────────────
 * Sest kliiniku koduleht võib olla Framer, WordPress, Wix või käsitsi tehtud
 * HTML, ja üks `<script>` töötab neis kõigis. Ehitusetappi ei ole, sõltuvusi ei
 * ole, ja fail, mille sisse tuleb `npm install`, ei jõua kunagi kellegi
 * kodulehele.
 *
 * ── SEE VORM EI ARVUTA MITTE MIDAGI ──────────────────────────────────────────
 * Hinnad tulevad serverist juba vormindatud tekstina (`hind.tekst`), sest
 * hinnakirja vormindamine kahes kohas tähendab kaht erinevat hinda. Sama
 * kehtib valideerimise kohta: vorm kontrollib ainult seda, kas väli on tühi
 * (see on kasutajamugavus), ja KÕIK ülejäänud vastused tulevad serverilt ning
 * kuvatakse nii, nagu server need saatis. Nii ei saa reegel siin ja reegel seal
 * lahku minna — siin ei ole reeglit.
 *
 * ── Kolm varuastet ───────────────────────────────────────────────────────────
 * 1. Teenuste nimekiri ei laadi → vorm ilmub ILMA teenusevalikuta. Katkine
 *    hinnakiri ei tohi takistada inimest aega küsimast; see on ainus asi, mida
 *    see leht üldse teeb.
 * 2. Saatmine aegub → EI korrata automaatselt. Kordamine on see, kuidas üks
 *    inimene tekitab registratuuri viis taotlust.
 * 3. Inimene vajutab ise uuesti → sama idempotentsusvõti, mis tekkis vormi
 *    AVAMISEL. Server tunneb korduse ära ja hoiab ühe rea.
 *
 * ── Paigaldus ────────────────────────────────────────────────────────────────
 *   <div id="wivo-broneering"></div>
 *   <script src="https://.../wivo-booking.js"
 *           data-wivo-base="https://<ref>.functions.supabase.co/public-booking"
 *           data-wivo-clinic="<kliiniku-slug>"
 *           data-wivo-target="#wivo-broneering"></script>
 *
 * Kujundus käib CSS-muutujatega (vt WIVO_CSS) — kliinik saab värvi ja nurgad
 * oma lehe järgi seada ilma seda faili puutumata.
 */
(function () {
  'use strict'

  var script = document.currentScript
  var cfg = {
    base:   (script && script.getAttribute('data-wivo-base')) || '',
    clinic: (script && script.getAttribute('data-wivo-clinic')) || '',
    target: (script && script.getAttribute('data-wivo-target')) || '#wivo-broneering',
    pealkiri: (script && script.getAttribute('data-wivo-title')) || 'Küsi vastuvõtuaega',
  }

  var SONUM_MAX = 300

  var CSS = [
    '.wv{--wv-accent:#0AB6C4;--wv-ink:#1b2733;--wv-muted:#64748b;--wv-line:#dfe5ec;',
    '--wv-bg:#fff;--wv-radius:12px;font-family:inherit;color:var(--wv-ink);max-width:520px}',
    '.wv *{box-sizing:border-box}',
    '.wv h2{font-size:1.15rem;margin:0 0 .25rem}',
    '.wv p.wv-sub{color:var(--wv-muted);font-size:.85rem;margin:0 0 1rem}',
    '.wv label{display:block;font-size:.8rem;font-weight:600;margin:.75rem 0 .25rem}',
    '.wv input,.wv select,.wv textarea{width:100%;padding:.6rem .7rem;border:1px solid var(--wv-line);',
    'border-radius:var(--wv-radius);font:inherit;font-size:.9rem;background:var(--wv-bg);color:inherit}',
    '.wv textarea{min-height:80px;resize:vertical}',
    '.wv input:focus,.wv select:focus,.wv textarea:focus{outline:2px solid var(--wv-accent);outline-offset:1px;border-color:transparent}',
    '.wv .wv-hint{font-size:.72rem;color:var(--wv-muted);margin-top:.25rem}',
    '.wv .wv-count{float:right}',
    '.wv button{margin-top:1rem;width:100%;padding:.7rem 1rem;border:0;border-radius:var(--wv-radius);',
    'background:var(--wv-accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}',
    '.wv button[disabled]{opacity:.55;cursor:progress}',
    '.wv .wv-err{margin-top:.75rem;padding:.6rem .7rem;border-radius:var(--wv-radius);',
    'background:#fdeaea;color:#a12525;font-size:.85rem}',
    '.wv .wv-err ul{margin:.35rem 0 0;padding-left:1.1rem}',
    '.wv .wv-ok{padding:1rem;border-radius:var(--wv-radius);background:#e8f7ee;color:#1c6b3f}',
    '.wv .wv-ok strong{display:block;margin-bottom:.25rem}',
    // The honeypot. Hidden from people AND from screen readers, present in the
    // DOM for anything that fills every input it can find.
    '.wv .wv-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}',
  ].join('')

  function el(tag, attrs, kids) {
    var n = document.createElement(tag)
    for (var k in attrs || {}) {
      if (k === 'text') n.textContent = attrs[k]
      else if (k === 'html') n.innerHTML = attrs[k]
      else n.setAttribute(k, attrs[k])
    }
    ;(kids || []).forEach(function (c) { n.appendChild(c) })
    return n
  }

  /**
   * Made ONCE, when the form is built — not when it is sent.
   * A key made at send time is new on every click, so a double-click becomes two
   * requests, which is the exact case idempotency exists to prevent.
   */
  function newKey() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID()
    return 'k-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10)
  }

  function mount(root) {
    var idempotencyKey = newKey()

    if (!cfg.base || !cfg.clinic) {
      root.appendChild(el('div', { class: 'wv-err', text:
        'Vormi seadistus on puudulik (data-wivo-base / data-wivo-clinic).' }))
      return
    }

    var style = el('style', { text: CSS })
    var wrap = el('div', { class: 'wv' })
    root.appendChild(style)
    root.appendChild(wrap)

    wrap.appendChild(el('h2', { text: cfg.pealkiri }))
    var sub = el('p', { class: 'wv-sub', text:
      'Jäta oma kontakt ja me võtame ühendust, et aeg kokku leppida.' })
    wrap.appendChild(sub)

    var form = el('form', { novalidate: 'novalidate' })
    wrap.appendChild(form)

    // Service picker. Added only once the catalogue actually arrives — see
    // fallback 1 in the header comment.
    var serviceWrap = el('div')
    form.appendChild(serviceWrap)

    function field(name, label, type, hint) {
      form.appendChild(el('label', { for: 'wv-' + name, text: label }))
      var input = type === 'textarea'
        ? el('textarea', { id: 'wv-' + name, name: name, maxlength: String(SONUM_MAX) })
        : el('input', { id: 'wv-' + name, name: name, type: type })
      form.appendChild(input)
      if (hint) form.appendChild(el('div', { class: 'wv-hint', html: hint }))
      return input
    }

    var nimi = field('nimi', 'Nimi *', 'text')
    var telefon = field('telefon', 'Telefon *', 'tel', 'Sellel numbril me helistame.')
    var email = field('email', 'E-post', 'email')
    var aeg = field('eelistatudAeg', 'Sobiv aeg', 'text',
      'Vabas vormis, näiteks „kolmapäeva hommikul" või „nii pea kui võimalik".')

    var sonum = field('sonum', 'Lisainfo', 'textarea', null)
    // Said out loud, and the field is short enough to make it awkward to ignore.
    // Free text on a public form is the biggest art. 9 risk there is: what a
    // person volunteers about their health, we have then collected.
    var counter = el('span', { class: 'wv-count', text: '0/' + SONUM_MAX })
    var sonumHint = el('div', { class: 'wv-hint' })
    sonumHint.appendChild(document.createTextNode(
      'Palun ära kirjuta siia terviseandmeid — neid räägime vastuvõtul. '))
    sonumHint.appendChild(counter)
    form.appendChild(sonumHint)
    sonum.addEventListener('input', function () {
      counter.textContent = sonum.value.length + '/' + SONUM_MAX
    })

    // Honeypot. Off-screen, not `display:none` — some bots skip what is hidden
    // that way. autocomplete off so a browser never fills it for a real person.
    var hp = el('div', { class: 'wv-hp', 'aria-hidden': 'true' })
    var hpInput = el('input', {
      type: 'text', name: 'veebileht', tabindex: '-1', autocomplete: 'off',
    })
    hp.appendChild(el('label', { for: 'wv-veebileht', text: 'Veebileht' }))
    hp.appendChild(hpInput)
    form.appendChild(hp)

    var button = el('button', { type: 'submit', text: 'Saada taotlus' })
    form.appendChild(button)

    var errBox = el('div')
    form.appendChild(errBox)

    form.appendChild(el('div', { class: 'wv-hint', text:
      'Saates nõustud, et võtame sinuga ühendust. Andmeid kasutame ainult '
      + 'vastuvõtu kokkuleppimiseks.' }))

    function showError(message, details) {
      errBox.innerHTML = ''
      var box = el('div', { class: 'wv-err' })
      box.appendChild(el('div', { text: message }))
      if (details && details.length) {
        var ul = el('ul')
        details.forEach(function (d) { ul.appendChild(el('li', { text: d })) })
        box.appendChild(ul)
      }
      errBox.appendChild(box)
    }

    // ── The catalogue. Optional by design. ──────────────────────────────────
    var chosenService = null
    fetch(cfg.base + '/services?clinic=' + encodeURIComponent(cfg.clinic))
      .then(function (r) { return r.json() })
      .then(function (body) {
        if (!body || !body.ok || !body.data || !body.data.services.length) return
        var services = body.data.services
        serviceWrap.appendChild(el('label', { for: 'wv-service', text: 'Teenus' }))
        var select = el('select', { id: 'wv-service' })
        select.appendChild(el('option', { value: '', text: 'Ei oska veel öelda' }))
        services.forEach(function (s) {
          // `s.hind.tekst` is pre-formatted BY THE SERVER. Do not format money
          // here — two formatters mean two prices.
          var label = s.hind && s.hind.tekst ? s.nimi + ' — ' + s.hind.tekst : s.nimi
          select.appendChild(el('option', { value: s.id, text: label }))
        })
        select.addEventListener('change', function () { chosenService = select.value || null })
        serviceWrap.appendChild(select)
      })
      .catch(function () {
        // Fallback 1: no catalogue, no picker, form still works. Silent on
        // purpose — a price list that failed to load is our problem, not the
        // visitor's, and an error about it would only stop them asking.
      })

    // ── Sending ─────────────────────────────────────────────────────────────
    var sending = false
    form.addEventListener('submit', function (e) {
      e.preventDefault()
      if (sending) return
      errBox.innerHTML = ''

      // Presence only. Everything else is the server's answer, shown verbatim —
      // see the header: this file holds no validation rules of its own.
      var missing = []
      if (!nimi.value.trim()) missing.push('Nimi on puudu.')
      if (!telefon.value.trim()) missing.push('Telefoninumber on puudu.')
      if (missing.length) { showError('Palun kontrolli vormi.', missing); return }

      sending = true
      button.disabled = true
      button.textContent = 'Saadan…'

      fetch(cfg.base + '/request?clinic=' + encodeURIComponent(cfg.clinic), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serviceId: chosenService || '',
          nimi: nimi.value,
          telefon: telefon.value,
          email: email.value,
          eelistatudAeg: aeg.value,
          sonum: sonum.value,
          veebileht: hpInput.value,
          // The SAME key for every attempt from this page load. Pressing send
          // again after a timeout is safe: the server keeps one row.
          idempotencyKey: idempotencyKey,
        }),
      })
        .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b } }) })
        .then(function (res) {
          if (res.body && res.body.ok) {
            wrap.innerHTML = ''
            var ok = el('div', { class: 'wv-ok' })
            ok.appendChild(el('strong', { text: 'Taotlus on saadetud.' }))
            ok.appendChild(el('div', { text: 'Võtame sinuga peagi ühendust.' }))
            wrap.appendChild(ok)
            return
          }
          var err = (res.body && res.body.error) || {}
          showError(err.et || 'Saatmine ebaõnnestus. Palun helista meile.', err.details)
        })
        .catch(function () {
          // Fallback 2: no automatic retry. The person may press send again and
          // the same key makes that safe.
          showError('Ühendus ebaõnnestus. Vajuta uuesti või helista meile.')
        })
        .then(function () {
          sending = false
          button.disabled = false
          button.textContent = 'Saada taotlus'
        })
    })
  }

  function start() {
    var root = document.querySelector(cfg.target)
    if (root) mount(root)
    else if (console && console.warn) {
      console.warn('[wivo] ei leidnud elementi', cfg.target)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
