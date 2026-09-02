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


  // ── The tooth chart ───────────────────────────────────────────────────────
  // An FDI chart, NOT a 3D model. A 3D scene on a marketing page is megabytes
  // of library and a WebGL context for a job that two rows of buttons do better
  // on a phone: pick the teeth, see the price. The numbering is the one every
  // dentist already uses, so what the patient picks is what the clinic reads.
  var FDI_UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
  var FDI_LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

  var CALC_CSS = [
    '.wv-calc{margin:.5rem 0 1rem}',
    '.wv-arch{display:flex;gap:2px;justify-content:center;margin:.25rem 0}',
    '.wv-t{flex:1 1 0;min-width:0;aspect-ratio:3/4;border:1px solid var(--wv-line);',
    'border-radius:4px;background:var(--wv-bg);color:var(--wv-muted);font:inherit;',
    'font-size:.6rem;cursor:pointer;padding:0;line-height:1;margin:0}',
    '.wv-t[aria-pressed="true"]{background:var(--wv-accent);border-color:var(--wv-accent);',
    'color:#fff;font-weight:700}',
    '.wv-mid{width:6px;flex:0 0 6px}',
    '.wv-jaw{font-size:.68rem;color:var(--wv-muted);text-align:center;margin:.35rem 0 .1rem}',
    '.wv-sum{margin-top:.75rem;padding:.7rem .8rem;border-radius:var(--wv-radius);',
    'background:var(--wv-bg);border:1px solid var(--wv-line)}',
    '.wv-total{font-size:1.25rem;font-weight:700}',
    '.wv-line{font-size:.78rem;color:var(--wv-muted);margin-top:.15rem}',
    '.wv-warn{font-size:.7rem;color:var(--wv-muted);margin-top:.5rem;line-height:1.45}',
    '.wv-addons{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem}',
    '.wv-addons label{display:inline-flex;align-items:center;gap:.3rem;margin:0;',
    'font-weight:400;font-size:.78rem;cursor:pointer}',
    '.wv-addons input{width:auto}',
  ].join('')

  /**
   * The calculator: renders a chart, asks the server what it costs, prints what
   * the server said.
   *
   * It never multiplies anything. A price on a public page is a commercial
   * statement, and two pieces of code arriving at one separately will one day
   * disagree — after a price change, in front of a patient.
   */
  function mountCalculator(host, services) {
    var calculable = services.filter(function (s) { return !!s.kalkulaator })
    if (calculable.length === 0) return null

    var box = el('div', { class: 'wv-calc' })
    host.appendChild(box)

    box.appendChild(el('label', { for: 'wv-calc-service', text: 'Mida on vaja?' }))
    var pick = el('select', { id: 'wv-calc-service' })
    calculable.forEach(function (s) {
      pick.appendChild(el('option', { value: s.id, text: s.nimi }))
    })
    box.appendChild(pick)

    var chosen = {}
    var current = calculable[0].id
    var buttons = {}

    function state() {
      if (!chosen[current]) chosen[current] = { teeth: {}, lisad: {} }
      return chosen[current]
    }

    function arch(list) {
      var row = el('div', { class: 'wv-arch' })
      list.forEach(function (fdi, i) {
        if (i === 8) row.appendChild(el('span', { class: 'wv-mid' }))
        var b = el('button', {
          type: 'button', class: 'wv-t', 'aria-pressed': 'false',
          'aria-label': 'Hammas ' + fdi, text: String(fdi),
        })
        b.addEventListener('click', function () {
          var st = state()
          if (st.teeth[fdi]) delete st.teeth[fdi]
          else st.teeth[fdi] = true
          paint()
          refresh()
        })
        buttons[fdi] = b
        row.appendChild(b)
      })
      return row
    }

    box.appendChild(el('div', { class: 'wv-jaw', text: 'Ülemine lõualuu' }))
    box.appendChild(arch(FDI_UPPER))
    box.appendChild(el('div', { class: 'wv-jaw', text: 'Alumine lõualuu' }))
    box.appendChild(arch(FDI_LOWER))

    var addonsBox = el('div', { class: 'wv-addons' })
    box.appendChild(addonsBox)

    var sum = el('div', { class: 'wv-sum' })
    box.appendChild(sum)

    function paint() {
      var st = state()
      Object.keys(buttons).forEach(function (fdi) {
        buttons[fdi].setAttribute('aria-pressed', st.teeth[fdi] ? 'true' : 'false')
      })
      var svc = calculable.filter(function (s) { return s.id === current })[0]
      addonsBox.innerHTML = ''
      var lisad = (svc && svc.kalkulaator && svc.kalkulaator.lisad) || []
      lisad.forEach(function (a) {
        var id = 'wv-lisa-' + current + '-' + a.id
        var cb = el('input', { type: 'checkbox', id: id })
        if (st.lisad[a.id]) cb.setAttribute('checked', 'checked')
        cb.addEventListener('change', function () {
          if (st.lisad[a.id]) delete st.lisad[a.id]
          else st.lisad[a.id] = true
          refresh()
        })
        var lab = el('label', { for: id })
        lab.appendChild(cb)
        lab.appendChild(document.createTextNode(a.nimi))
        addonsBox.appendChild(lab)
      })
    }

    /** The selection, in the shape /quote takes. */
    function selection() {
      return Object.keys(chosen).map(function (sid) {
        return {
          serviceId: sid,
          hambad: Object.keys(chosen[sid].teeth),
          lisad: Object.keys(chosen[sid].lisad),
        }
      }).filter(function (x) { return x.hambad.length > 0 })
    }

    var pending = null
    function refresh() {
      var sel = selection()
      if (sel.length === 0) { sum.innerHTML = ''; return }

      // Tapping across an arch fires a dozen changes. Answering only the last
      // keeps the figure honest and the server quiet.
      clearTimeout(pending)
      pending = setTimeout(function () {
        fetch(cfg.base + '/quote?clinic=' + encodeURIComponent(cfg.clinic), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ valik: sel }),
        })
          .then(function (r) { return r.json() })
          .then(function (body) {
            if (!body || !body.ok) throw new Error('quote failed')
            var d = body.data
            sum.innerHTML = ''
            ;(d.probleemid || []).forEach(function (p) {
              sum.appendChild(el('div', { class: 'wv-line', text: p }))
            })
            if (d.read.length) {
              // Every string here was formatted BY THE SERVER.
              sum.appendChild(el('div', { class: 'wv-total', text: d.kokkuTekst }))
              d.read.forEach(function (l) {
                sum.appendChild(el('div', { class: 'wv-line', text: l.nimi + ': ' + l.tekst }))
                ;(l.lisad || []).forEach(function (a) {
                  sum.appendChild(el('div', { class: 'wv-line', text: '+ ' + a.nimi }))
                })
              })
            }
            // Always, never conditionally: an estimate must not read as a quote.
            sum.appendChild(el('div', { class: 'wv-warn', text: d.hoiatus }))
          })
          .catch(function () {
            sum.innerHTML = ''
            sum.appendChild(el('div', { class: 'wv-line', text:
              'Hinda ei õnnestunud arvutada. Saada taotlus ära — me ütleme hinna.' }))
          })
      }, 220)
    }

    pick.addEventListener('change', function () {
      current = pick.value
      paint()
      refresh()
    })

    paint()
    return { selection: selection }
  }


  var SLOT_CSS = [
    '.wv-slots{margin:.5rem 0}',
    '.wv-days{display:flex;gap:.35rem;overflow-x:auto;padding-bottom:.25rem}',
    '.wv-day{flex:0 0 auto;border:1px solid var(--wv-line);border-radius:var(--wv-radius);',
    'background:var(--wv-bg);color:var(--wv-ink);font:inherit;font-size:.75rem;',
    'padding:.4rem .6rem;cursor:pointer;text-align:center;line-height:1.25}',
    '.wv-day[aria-pressed="true"]{background:var(--wv-accent);border-color:var(--wv-accent);color:#fff}',
    '.wv-day small{display:block;font-size:.65rem;opacity:.75}',
    '.wv-times{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.5rem}',
    '.wv-time{border:1px solid var(--wv-line);border-radius:var(--wv-radius);background:var(--wv-bg);',
    'color:var(--wv-ink);font:inherit;font-size:.8rem;padding:.35rem .6rem;cursor:pointer}',
    '.wv-time[aria-pressed="true"]{background:var(--wv-accent);border-color:var(--wv-accent);',
    'color:#fff;font-weight:600}',
    '.wv-none{font-size:.8rem;color:var(--wv-muted);padding:.5rem 0}',
    // ── Steps ───────────────────────────────────────────────────────────────
    '.wv-step[hidden]{display:none}',
    '.wv-dots{display:flex;gap:.3rem;margin:.25rem 0 1rem}',
    '.wv-dot{height:3px;flex:1;border-radius:2px;background:var(--wv-line)}',
    '.wv-dot.on{background:var(--wv-accent)}',
    '.wv-nav{display:flex;gap:.5rem;margin-top:1rem}',
    '.wv-nav button{margin-top:0}',
    '.wv-back{background:transparent;color:var(--wv-muted);border:1px solid var(--wv-line)}',
  ].join('')

  var WEEKDAYS = ['P', 'E', 'T', 'K', 'N', 'R', 'L']
  var MONTHS = ['jaan', 'veebr', 'märts', 'apr', 'mai', 'juuni',
                'juuli', 'aug', 'sept', 'okt', 'nov', 'dets']

  /** '2026-09-07' → 'E 7. sept'. Parsed as UTC so no zone can shift the day. */
  function dayLabel(iso) {
    var p = iso.split('-')
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]))
    return WEEKDAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + '. ' + MONTHS[d.getUTCMonth()]
  }

  /**
   * The time picker.
   *
   * It asks the server which times are free and renders the answer. It never
   * decides that itself: the opening hours, the diary and the load rules all
   * live on the server, and two answers to "is this hour free" is a double
   * booking.
   */
  function mountSlots(host, onPick, onLoaded) {
    var box = el('div', { class: 'wv-slots' })
    host.appendChild(box)

    var label = el('label', { text: 'Vali aeg' })
    var days = el('div', { class: 'wv-days' })
    var times = el('div', { class: 'wv-times' })
    var note = el('div', { class: 'wv-none' })
    box.appendChild(label); box.appendChild(days)
    box.appendChild(times); box.appendChild(note)

    var data = []
    var chosenDay = null
    var chosen = null
    var serviceId = null

    function clear() {
      days.innerHTML = ''; times.innerHTML = ''; note.textContent = ''
      chosenDay = null; chosen = null
      onPick(null)
    }

    function paintTimes() {
      times.innerHTML = ''
      var day = data.filter(function (d) { return d.kuupaev === chosenDay })[0]
      if (!day) return
      day.kellad.forEach(function (kell) {
        var b = el('button', {
          type: 'button', class: 'wv-time', 'aria-pressed': 'false', text: kell,
        })
        b.addEventListener('click', function () {
          chosen = { kuupaev: chosenDay, kell: kell, serviceId: serviceId }
          Array.prototype.forEach.call(times.children, function (c) {
            c.setAttribute('aria-pressed', c === b ? 'true' : 'false')
          })
          onPick(chosen)
        })
        times.appendChild(b)
      })
    }

    function paintDays() {
      days.innerHTML = ''
      data.forEach(function (d) {
        var b = el('button', { type: 'button', class: 'wv-day', 'aria-pressed': 'false' })
        b.appendChild(document.createTextNode(dayLabel(d.kuupaev)))
        b.appendChild(el('small', { text: d.kellad.length + ' aega' }))
        b.addEventListener('click', function () {
          chosenDay = d.kuupaev
          chosen = null
          onPick(null)
          Array.prototype.forEach.call(days.children, function (c) {
            c.setAttribute('aria-pressed', c === b ? 'true' : 'false')
          })
          paintTimes()
        })
        days.appendChild(b)
      })
    }

    function load(id) {
      serviceId = id
      clear()
      if (!id) {
        // Times depend on the service, so there is nothing honest to show yet.
        // Saying why beats an empty space the visitor has to interpret.
        note.textContent = 'Vali kõigepealt teenus, siis näitame vabu aegu.'
        return
      }
      note.textContent = 'Otsin vabu aegu…'
      fetch(cfg.base + '/slots?clinic=' + encodeURIComponent(cfg.clinic)
        + '&service=' + encodeURIComponent(id))
        .then(function (r) { return r.json() })
        .then(function (body) {
          if (!body || !body.ok) throw new Error('slots failed')
          data = body.data.paevad || []
          note.textContent = ''
          // The caller owns the heading; `sub` is not in scope here and reaching
          // for it would have been a ReferenceError the syntax check cannot see.
          if (onLoaded) onLoaded(data.length)
          if (data.length === 0) {
            // Says what to do next rather than only that there is nothing.
            note.textContent = body.data.pohjus
              || 'Vabu aegu hetkel ei ole. Saada taotlus — pakume aja ise.'
            return
          }
          paintDays()
        })
        .catch(function () {
          // The form still works without it. Losing the request because the
          // diary was unreachable would be the worse trade.
          data = []
          note.textContent = 'Aegu ei õnnestunud laadida. Saada taotlus — pakume aja ise.'
        })
    }

    return { load: load, chosen: function () { return chosen } }
  }

  function mount(root) {
    var idempotencyKey = newKey()

    if (!cfg.base || !cfg.clinic) {
      root.appendChild(el('div', { class: 'wv-err', text:
        'Vormi seadistus on puudulik (data-wivo-base / data-wivo-clinic).' }))
      return
    }

    var style = el('style', { text: CSS + CALC_CSS + SLOT_CSS })
    var wrap = el('div', { class: 'wv' })
    root.appendChild(style)
    root.appendChild(wrap)

    wrap.appendChild(el('h2', { text: cfg.pealkiri }))
    // Rewritten once the diary answers: promising a callback while showing a
    // list of free times is two different offers on one screen.
    var sub = el('p', { class: 'wv-sub', text:
      'Jäta oma kontakt ja me võtame ühendust, et aeg kokku leppida.' })
    wrap.appendChild(sub)

    var form = el('form', { novalidate: 'novalidate' })
    wrap.appendChild(form)

    /**
     * One question at a time, the way adding a job works in Wivo.
     *
     * A single long form asks a stranger for their phone number before it has
     * told them anything. In steps, the page earns the contact details: what do
     * you need, what does it cost, when can you come — and only then, who are
     * you.
     *
     * A step with nothing to show is SKIPPED, never shown empty. A service
     * without per-tooth pricing has no calculator step; a clinic with no diary
     * has no time step.
     */
    var dots = el('div', { class: 'wv-dots' })
    wrap.appendChild(dots)

    var steps = []
    function step(title) {
      var box = el('div', { class: 'wv-step' })
      box.hidden = true
      if (title) box.appendChild(el('h3', { text: title }))
      form.appendChild(box)
      steps.push(box)
      return box
    }

    var serviceWrap = step('Mida on vaja?')
    var calcWrap = step('Vali hambad')
    var slotWrap = step('Vali aeg')
    var contactWrap = step('Sinu kontakt')

    var calc = null
    var slots = null
    var chosenSlot = null

    function field(target, name, label, type, hint) {
      target.appendChild(el('label', { for: 'wv-' + name, text: label }))
      var input = type === 'textarea'
        ? el('textarea', { id: 'wv-' + name, name: name, maxlength: String(SONUM_MAX) })
        : el('input', { id: 'wv-' + name, name: name, type: type })
      target.appendChild(input)
      if (hint) target.appendChild(el('div', { class: 'wv-hint', html: hint }))
      return input
    }

    var nimi = field(contactWrap, 'nimi', 'Nimi *', 'text')
    var telefon = field(contactWrap, 'telefon', 'Telefon *', 'tel', 'Sellel numbril me helistame.')
    var email = field(contactWrap, 'email', 'E-post', 'email')
    // Kept as a fallback for whoever finds no suitable slot, or arrives before
    // the clinic has filled in its hours.
    var aeg = field(contactWrap, 'eelistatudAeg', 'Kui slotti ei sobinud, siis millal?', 'text',
      'Vabas vormis, näiteks „kolmapäeva hommikul".')

    var sonum = field(contactWrap, 'sonum', 'Lisainfo', 'textarea', null)
    // Said out loud, and the field is short enough to make it awkward to ignore.
    // Free text on a public form is the biggest art. 9 risk there is: what a
    // person volunteers about their health, we have then collected.
    var counter = el('span', { class: 'wv-count', text: '0/' + SONUM_MAX })
    var sonumHint = el('div', { class: 'wv-hint' })
    sonumHint.appendChild(document.createTextNode(
      'Palun ära kirjuta siia terviseandmeid — neid räägime vastuvõtul. '))
    sonumHint.appendChild(counter)
    contactWrap.appendChild(sonumHint)
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
    contactWrap.appendChild(hp)

    contactWrap.appendChild(el('div', { class: 'wv-hint', text:
      'Saates nõustud, et võtame sinuga ühendust. Andmeid kasutame ainult '
      + 'vastuvõtu kokkuleppimiseks.' }))

    // ── Navigation ──────────────────────────────────────────────────────────
    var nav = el('div', { class: 'wv-nav' })
    var back = el('button', { type: 'button', class: 'wv-back', text: 'Tagasi' })
    var next = el('button', { type: 'button', text: 'Edasi' })
    var button = el('button', { type: 'submit', text: 'Saada taotlus' })
    nav.appendChild(back); nav.appendChild(next); nav.appendChild(button)
    form.appendChild(nav)

    var errBox = el('div')
    form.appendChild(errBox)

    /**
     * Which steps have anything to show. Recomputed on every move, because the
     * answer changes with the service: picking a crown adds a tooth chart that
     * a hygiene visit does not have.
     */
    function visibleSteps() {
      return steps.filter(function (b) {
        if (b === calcWrap) return !!calc && calcHasService()
        if (b === slotWrap) return !!slots
        return b.children.length > 1   // a heading alone is not a step
      })
    }

    function calcHasService() {
      // The chart only helps when the CHOSEN service is priced per tooth.
      return !!chosenService && calcServices.indexOf(chosenService) !== -1
    }

    var at = 0
    function show() {
      var list = visibleSteps()
      if (at >= list.length) at = Math.max(0, list.length - 1)
      steps.forEach(function (b) { b.hidden = true })
      if (list[at]) list[at].hidden = false

      dots.innerHTML = ''
      list.forEach(function (_, i) {
        dots.appendChild(el('div', { class: 'wv-dot' + (i <= at ? ' on' : '') }))
      })

      var last = at === list.length - 1
      back.hidden = at === 0
      next.hidden = last
      button.hidden = !last
      errBox.innerHTML = ''
    }

    back.addEventListener('click', function () { at = Math.max(0, at - 1); show() })
    next.addEventListener('click', function () {
      // Nothing is required to move on except the contact step's own check at
      // submit: a person who cannot find a suitable time should still be able
      // to reach the form and ask.
      at = Math.min(visibleSteps().length - 1, at + 1)
      show()
    })

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
    var calcServices = []
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
        select.addEventListener('change', function () {
          chosenService = select.value || null
          // Times depend on the service: a 30-minute check-up and a two-hour
          // case do not fit the same gaps.
          if (slots) slots.load(chosenService)
          // The tooth chart appears or disappears with the choice, so the step
          // count changes with it.
          show()
        })
        serviceWrap.appendChild(select)

        // The chart, when at least one service is priced per tooth. Services
        // without per-tooth pricing keep the range they already had.
        calcServices = services
          .filter(function (x) { return !!x.kalkulaator })
          .map(function (x) { return x.id })
        calc = mountCalculator(calcWrap, services)

        slots = mountSlots(
          slotWrap,
          function (picked) { chosenSlot = picked },
          function (count) {
            // Promising a callback while showing a list of free times is two
            // different offers on one screen.
            if (count > 0) {
              sub.textContent = 'Vali endale sobiv aeg — näitame ainult neid, mis on vabad.'
            }
          },
        )
        slots.load(chosenService)
        show()
      })
      .catch(function () {
        // Fallback 1: no catalogue, no picker, form still works. Silent on
        // purpose — a price list that failed to load is our problem, not the
        // visitor's, and an error about it would only stop them asking.
        show()
      })

    // Paint immediately so the form is usable before the catalogue answers.
    show()

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
          // What they priced. The clinic reads FDI numbers, so the request
          // carries the selection rather than only the total — a number with no
          // teeth behind it cannot be checked by anybody.
          valik: calc ? calc.selection() : [],
          // The chosen time. The server checks it is STILL free before storing
          // it — this list was a snapshot.
          aeg: chosenSlot,
          veebileht: hpInput.value,
          // The SAME key for every attempt from this page load. Pressing send
          // again after a timeout is safe: the server keeps one row.
          idempotencyKey: idempotencyKey,
        }),
      })
        .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b } }) })
        .then(function (res) {
          if (res.body && res.body.ok) {
            // A visit fee, when the clinic asks for one. Straight to the bank —
            // an intermediate "click here to pay" screen is a step where people
            // stop, and the request is stored either way.
            var pay = res.body.data && res.body.data.maksmiseks
            if (pay) { window.location.href = pay; return }
            wrap.innerHTML = ''
            var ok = el('div', { class: 'wv-ok' })
            var d = res.body.data || {}
            if (d.kinnitatud) {
              // A real visit exists. Saying "we will be in touch" here made
              // people ring to ask about a booking they already had.
              ok.appendChild(el('strong', { text: 'Aeg on broneeritud.' }))
              ok.appendChild(el('div', {
                text: d.aeg
                  ? dayLabel(d.aeg.kuupaev) + ' kell ' + d.aeg.kell
                  : 'Ootame sind kokkulepitud ajal.',
              }))
              ok.appendChild(el('div', { text: 'Kui midagi muutub, anna palun teada.' }))
            } else {
              ok.appendChild(el('strong', { text: 'Taotlus on saadetud.' }))
              ok.appendChild(el('div', {
                text: chosenSlot
                  ? 'Kinnitame valitud aja ja võtame sinuga ühendust.'
                  : 'Võtame sinuga peagi ühendust.',
              }))
            }
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
