/* ABK Clinic — логика сайта: языки, прайс, подбор чек-апа, запись через WhatsApp, листалки, цели аналитики. */
(function () {
  "use strict";

  const A = window.ABK;
  const LANGS = ["ru", "kk", "en"];
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const desktop = window.matchMedia("(min-width: 960px)");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const behavior = () => (reduceMotion.matches ? "auto" : "smooth");
  const onMedia = (mq, fn) => (mq.addEventListener ? mq.addEventListener("change", fn) : mq.addListener(fn));

  const state = {
    lang: "ru",
    kids: false,       // фильтр «Детям» в прайсе
    query: "",         // поиск по прайсу
    page: "diag",      // открытый раздел прайса на телефоне
    pageAll: {},       // раскрытые длинные разделы прайса
    who: null,
    focus: null,
    slipsAll: false,   // «Показать все программы» на компьютере
  };

  /* ---------------- аналитика: цели для Яндекс Метрики / Google Tag Manager ----------------
     Все кнопки с data-goal отправляют событие. Номер счётчика — в i18n.js (config.metrikaId). */
  window.dataLayer = window.dataLayer || [];
  function track(goal, params) {
    window.dataLayer.push(Object.assign({ event: goal, lang: state.lang }, params || {}));
    if (A.config.metrikaId && typeof window.ym === "function") {
      window.ym(A.config.metrikaId, "reachGoal", goal, params || {});
    }
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-goal]");
    if (el) track(el.dataset.goal);
  });
  const depthMarks = { 50: false, 90: false };
  window.addEventListener("scroll", () => {
    const h = document.documentElement;
    const pct = (h.scrollTop + window.innerHeight) / h.scrollHeight * 100;
    for (const m of Object.keys(depthMarks)) {
      if (!depthMarks[m] && pct >= Number(m)) { depthMarks[m] = true; track("scroll_" + m); }
    }
    $("#header").classList.toggle("is-scrolled", h.scrollTop > 8);
  }, { passive: true });

  /* ---------------- тексты ---------------- */
  const t = (key) => (A.i18n[state.lang] && A.i18n[state.lang][key]) || A.i18n.ru[key] || key;
  const nm = (obj) => (obj && (obj[state.lang] || obj.ru)) || "";

  function money(n) {
    return new Intl.NumberFormat(state.lang === "en" ? "en-US" : "ru-RU").format(n).replace(/ | /g, " ") + " ₸";
  }
  function price(n, from) {
    const m = money(n);
    if (!from) return m;
    if (state.lang === "kk") return m + " бастап";
    if (state.lang === "en") return "from " + m;
    return "от " + m;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function applyStatic() {
    document.documentElement.lang = state.lang;
    document.title = t("meta.title");
    const desc = $('meta[name="description"]');
    if (desc) desc.setAttribute("content", t("meta.desc"));
    $$("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); el.setAttribute("aria-label", t(el.dataset.i18nPlaceholder)); });
    $$("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
    $$("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === state.lang)));
    $$("[data-price]").forEach((el) => { el.textContent = price(Number(el.dataset.price), el.dataset.from === "1"); });
    const quick = "https://wa.me/" + A.config.whatsapp + "?text=" + encodeURIComponent(t("wa.quick"));
    $$(".wa-link").forEach((a) => { a.href = quick; });
    burger.setAttribute("aria-label", t(menu.hidden ? "nav.menu" : "nav.close"));
  }

  /* ---------------- листалки: ряды карточек, которые листаются в сторону (на телефоне) ---------------- */
  const railUpdaters = [];
  function setupRail(rail) {
    const ui = document.querySelector('.rail-ui[data-for="' + rail.id + '"]');
    if (!ui) return;
    const thumb = $(".rail-bar span", ui);
    const prev = $('[data-dir="-1"]', ui);
    const next = $('[data-dir="1"]', ui);
    function update() {
      const max = rail.scrollWidth - rail.clientWidth;
      const scrollable = !desktop.matches && max > 4;
      ui.hidden = !scrollable;
      if (!scrollable) return;
      const ratio = rail.clientWidth / rail.scrollWidth;
      const pos = Math.min(1, Math.max(0, rail.scrollLeft / max));
      thumb.style.width = (ratio * 100).toFixed(2) + "%";
      thumb.style.transform = "translateX(" + (pos * (1 - ratio) / ratio * 100).toFixed(2) + "%)";
      prev.disabled = rail.scrollLeft < 4;
      next.disabled = rail.scrollLeft > max - 4;
    }
    let frame = 0;
    rail.addEventListener("scroll", () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); }, { passive: true });
    ui.addEventListener("click", (e) => {
      const b = e.target.closest("[data-dir]");
      if (!b) return;
      const item = rail.firstElementChild;
      const gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
      const col = item ? item.getBoundingClientRect().width + gap : rail.clientWidth * 0.8;
      const step = Math.max(col, Math.floor((rail.clientWidth - gap) / col) * col);
      rail.scrollBy({ left: Number(b.dataset.dir) * step, behavior: behavior() });
    });
    railUpdaters.push(update);
    update();
  }
  const refreshRails = () => railUpdaters.forEach((fn) => fn());

  /* ---------------- форма записи: список услуг ---------------- */
  function renderServiceSelect() {
    const sel = $("#f-service");
    const current = sel.value;
    let html = `<option value="">${esc(t("booking.servicePlaceholder"))}</option>`;
    for (const g of ["diag", "doc", "proc"]) {
      html += `<optgroup label="${esc(t("prices.group." + g))}">`;
      for (const s of A.services.filter((x) => x.group === g)) {
        html += `<option value="s:${s.id}">${esc(nm(s.name))}</option>`;
      }
      html += "</optgroup>";
    }
    html += `<optgroup label="${esc(t("checkup.title"))}">`;
    for (const c of A.checkups) html += `<option value="c:${c.id}">${esc(nm(c.name))}</option>`;
    html += "</optgroup>";
    sel.innerHTML = html;
    sel.value = current;
  }

  /* ---------------- 16 направлений: нажатие сразу открывает запись к врачу ---------------- */
  function renderDirections() {
    const byId = Object.fromEntries(A.services.map((s) => [s.id, s]));
    $("#dir-grid").innerHTML = A.directions.map((d) => {
      const s = byId[d.service];
      return `<li><button class="dir" type="button" data-target="${s.id}">
        <span class="dir-icon"><svg class="ic" aria-hidden="true"><use href="#${s.icon}"/></svg></span>
        <span class="dir-name">${esc(nm(d.name))}</span>
        <span class="dir-meta"><span>${esc(price(s.price, s.from))}</span>${s.kids ? `<span class="kids-pill">${esc(t("directions.kids"))}</span>` : ""}</span>
      </button></li>`;
    }).join("");
  }
  $("#dir-grid").addEventListener("click", (e) => {
    const b = e.target.closest(".dir");
    if (b) openBooking("s:" + b.dataset.target, "open_direction", b);
  });

  /* ---------------- прайс: на телефоне разделы — вкладки, которые листаются свайпом ---------------- */
  const GROUPS = ["diag", "doc", "proc"];
  const CAP = 6; // столько строк показываем в длинном разделе до кнопки «Показать ещё»
  const pager = $("#price-list");
  const tabsEl = $("#price-tabs");
  const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е");
  function matchesQuery(s) {
    if (!state.query) return true;
    const hay = norm([s.name.ru, s.name.kk, s.name.en, s.note && s.note.ru, s.note && s.note.kk, s.note && s.note.en].join(" "));
    return norm(state.query).split(/\s+/).every((w) => hay.includes(w));
  }
  const matchesAge = (s) => !state.kids || !!s.kids;
  const isStacked = () => desktop.matches || !!state.query; // на компьютере и при поиске — обычный список

  function renderPrices() {
    const stacked = isStacked();
    let total = 0, tabs = "", pages = "";
    const shown = [];
    for (const g of GROUPS) {
      const items = A.services.filter((s) => s.group === g && matchesAge(s) && matchesQuery(s));
      total += items.length;
      if (!items.length) continue;
      shown.push(g);
      const long = !stacked && items.length > CAP;
      const open = !!state.pageAll[g];
      tabs += `<button type="button" class="ptab" data-page="${g}" aria-controls="pg-${g}" aria-pressed="false">${esc(t("prices.tab." + g))}<span class="count">${items.length}</span></button>`;
      pages += `<section class="ppage" id="pg-${g}" data-page="${g}" aria-labelledby="pgh-${g}">
        <h3 class="ppage-title" id="pgh-${g}">${esc(t("prices.group." + g))}<span class="count">${items.length}</span></h3>
        <ul class="plist">${items.map((s, i) => rowHtml(s, long && !open && i >= CAP)).join("")}</ul>
        ${long ? `<button type="button" class="pmore" data-more="${g}" aria-expanded="${open}">${esc(open ? t("prices.less") : t("prices.more").replace("{n}", items.length - CAP))}</button>` : ""}
      </section>`;
    }
    tabsEl.innerHTML = tabs;
    tabsEl.hidden = stacked || shown.length < 2;
    pager.innerHTML = pages;
    pager.classList.toggle("is-stacked", stacked);
    $("#price-empty").hidden = total > 0;
    if (!shown.includes(state.page)) state.page = shown[0] || GROUPS[0];
    goToPage(state.page, false);
  }
  function rowHtml(s, hidden) {
    const note = s.note ? `<span class="pnote-text">${esc(nm(s.note))}</span>` : "";
    const kids = s.kids && !s.kidsOnly ? `<span class="kids-pill">${esc(t("prices.kidsBadge"))}</span>` : "";
    return `<li class="prow${hidden ? " is-hidden" : ""}" id="row-${s.id}">
      <div class="pline"><span class="pname">${esc(nm(s.name))}</span><span class="leader" aria-hidden="true"></span><span class="pprice">${esc(price(s.price, s.from))}</span>${kids ? kids.replace('class="kids-pill"', 'class="kids-pill pkids"') : ""}</div>
      ${note || kids ? `<div class="pnote">${note}${kids}</div>` : ""}
      <button class="pbook" type="button" data-book="${s.id}" aria-label="${esc(t("prices.book"))}: ${esc(nm(s.name))}">
        <svg class="ic" aria-hidden="true"><use href="#calendar-check"/></svg><span class="label">${esc(t("prices.book"))}</span>
      </button>
    </li>`;
  }

  const pageStep = (pages) => (pages.length > 1 ? pages[1].offsetLeft - pages[0].offsetLeft : pager.clientWidth) || 1;
  function markTabs() {
    $$(".ptab", tabsEl).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.page === state.page)));
  }
  // высота ленты плавно подстраивается под раздел, к которому её пролистали
  function syncPager() {
    const pages = $$(".ppage", pager);
    if (pager.classList.contains("is-stacked") || !pages.length) { pager.style.height = ""; markTabs(); return; }
    const x = pager.scrollLeft / pageStep(pages);
    const i = Math.max(0, Math.min(pages.length - 1, Math.floor(x)));
    const f = Math.max(0, Math.min(1, x - i));
    const h1 = pages[i].offsetHeight;
    const h2 = (pages[i + 1] || pages[i]).offsetHeight;
    pager.style.height = Math.round(h1 + (h2 - h1) * f) + "px";
    state.page = pages[Math.max(0, Math.min(pages.length - 1, Math.round(x)))].dataset.page;
    markTabs();
  }
  function goToPage(g, animate) {
    const pages = $$(".ppage", pager);
    const idx = pages.findIndex((p) => p.dataset.page === g);
    state.page = g;
    if (pager.classList.contains("is-stacked") || idx < 0) { syncPager(); return; }
    const left = idx * pageStep(pages);
    if (animate) { pager.scrollTo({ left, behavior: behavior() }); markTabs(); }
    else { pager.scrollLeft = left; syncPager(); }
  }
  let pagerFrame = 0;
  pager.addEventListener("scroll", () => { cancelAnimationFrame(pagerFrame); pagerFrame = requestAnimationFrame(syncPager); }, { passive: true });
  tabsEl.addEventListener("click", (e) => {
    const b = e.target.closest(".ptab");
    if (b) { goToPage(b.dataset.page, true); track("price_tab", { group: b.dataset.page }); }
  });
  pager.addEventListener("click", (e) => {
    const m = e.target.closest("[data-more]");
    if (!m) return;
    const g = m.dataset.more;
    state.pageAll[g] = !state.pageAll[g];
    renderPrices();
    const again = $('[data-more="' + g + '"]', pager);
    if (again) again.focus({ preventScroll: true });
    if (!state.pageAll[g] && tabsEl.getBoundingClientRect().top < 0) tabsEl.scrollIntoView({ behavior: behavior(), block: "start" });
  });
  $("#price-search").addEventListener("input", (e) => { state.query = e.target.value.trim(); renderPrices(); });
  $("#kids-toggle").addEventListener("click", (e) => {
    state.kids = !state.kids;
    e.currentTarget.setAttribute("aria-pressed", String(state.kids));
    renderPrices();
    track("price_kids", { on: state.kids });
  });

  /* ---------------- подбор чек-апа ---------------- */
  const WHO = ["self", "mom", "dad", "family"];
  const FOCUS = ["general", "gi", "heart", "hormones", "kidney", "women", "men", "neuro", "ent"];
  const FOCUS_ICON = {
    general: "activity", gi: "i-stomach", heart: "heart", hormones: "droplet", kidney: "bean",
    women: "venus", men: "mars", neuro: "brain", ent: "ear",
  };
  function renderQuiz() {
    $("#q-who").innerHTML = WHO.map((w) => `<button type="button" class="chip" data-who="${w}" aria-pressed="${state.who === w}">${esc(t("who." + w))}</button>`).join("");
    $("#q-focus").innerHTML = FOCUS.map((f) => `<button type="button" class="ftile" data-focus="${f}" aria-pressed="${state.focus === f}">
      <svg class="ic" aria-hidden="true"><use href="#${FOCUS_ICON[f]}"/></svg><span>${esc(t("focus." + f))}</span></button>`).join("");
    $("#quiz-reset").hidden = !(state.who || state.focus);
  }
  function score(c) {
    let s = 0;
    if (state.who && c.who.includes(state.who)) s += 2;
    if (state.focus && c.focus.includes(state.focus)) s += 3;
    if (state.who === "family" && c.id === "family") s += 3;
    return s;
  }
  function renderSlips() {
    const active = !!(state.who || state.focus);
    const items = A.checkups.map((c, i) => ({ c, i, s: score(c) }));
    // «Подходит» — только если программа подходит под все выбранные ответы
    const isMatch = (x) => active
      && (!state.who || x.c.who.includes(state.who))
      && (!state.focus || x.c.focus.includes(state.focus));
    if (active) items.sort((a, b) => (isMatch(b) - isMatch(a)) || b.s - a.s || a.i - b.i);
    const limit = desktop.matches && !state.slipsAll ? 6 : items.length; // на телефоне все программы в одной ленте
    $("#slips").innerHTML = items.slice(0, limit).map((x) => {
      const m = isMatch(x);
      return `<li><article class="slip${m ? " is-match" : ""}">
        <div class="slip-top"><span>${esc(t("checkup.slip"))}</span>${m ? `<span class="slip-badge">${esc(t("checkup.match"))}</span>` : ""}</div>
        <h3>${esc(nm(x.c.name))}</h3>
        <p class="slip-price">${esc(price(x.c.price, x.c.from))}</p>
        <button class="btn ${m ? "btn-book" : "btn-line"} btn-wide" type="button" data-checkup="${x.c.id}">${esc(t("checkup.book"))}</button>
      </article></li>`;
    }).join("");
    const more = $("#slips-more");
    more.textContent = state.slipsAll ? t("checkup.less") : t("checkup.more");
    more.setAttribute("aria-expanded", String(state.slipsAll));
    const n = active ? items.filter(isMatch).length : 0;
    $("#quiz-result").textContent = !active ? "" : n ? t("checkup.found").replace("{n}", n) : t("checkup.none");
    refreshRails();
  }
  $("#quiz").addEventListener("click", (e) => {
    const w = e.target.closest("[data-who]");
    const f = e.target.closest("[data-focus]");
    const reset = e.target.closest("#quiz-reset");
    if (!w && !f && !reset) return;
    if (w) state.who = state.who === w.dataset.who ? null : w.dataset.who;
    if (f) state.focus = state.focus === f.dataset.focus ? null : f.dataset.focus;
    if (reset) { state.who = null; state.focus = null; }
    renderQuiz();
    renderSlips();
    $("#slips").scrollTo({ left: 0, behavior: behavior() }); // подходящие программы — в начале ленты
    if (state.who && state.focus) track("quiz_complete", { who: state.who, focus: state.focus });
  });
  $("#slips-more").addEventListener("click", () => { state.slipsAll = !state.slipsAll; renderSlips(); });

  /* ---------------- кто о вас позаботится ----------------
     Пока у карточек нет имени и фото, они показывают специальность. Данные — в i18n.js → team. */
  function renderTeam() {
    const quick = "https://wa.me/" + A.config.whatsapp + "?text=" + encodeURIComponent(t("wa.quick"));
    let named = 0;
    $("#team-grid").innerHTML = A.team.map((m) => {
      if (m.name) named += 1;
      const title = m.name ? nm(m.name) : nm(m.role);
      const sub = m.name ? [nm(m.role), m.exp ? nm(m.exp) : ""].filter(Boolean).join(" · ") : nm(m.text);
      const avatar = m.photo
        ? `<img src="${esc(m.photo)}" alt="" loading="lazy">`
        : `<svg class="ic" aria-hidden="true"><use href="#${m.icon}"/></svg>`;
      const action = m.wa
        ? `<a class="btn btn-solid tm-btn wa-link" href="${quick}" target="_blank" rel="noopener" data-goal="click_whatsapp"><svg class="ic" aria-hidden="true"><use href="#message-circle"/></svg>${esc(t("team.write"))}</a>`
        : `<button class="btn btn-line tm-btn" type="button" data-book="${m.service}">${esc(t("prices.book"))}</button>`;
      return `<li><article class="tm${m.wa ? " tm-wa" : ""}">
        <span class="tm-avatar${m.photo ? " has-photo" : ""}">${avatar}</span>
        <h3>${esc(title)}</h3>
        <p>${esc(sub)}</p>
        ${action}
      </article></li>`;
    }).join("");
    // подпись «здесь появятся фото врачей» нужна, только пока врачей с именами нет
    $("#team-note").hidden = named > 0;
  }

  /* ---------------- логотип клиники ----------------
     Путь к файлу — в i18n.js → config.logo. Логотип встаёт в шапку, подвал и на вкладку браузера. */
  function applyLogo() {
    const src = A.config.logo;
    if (!src) return;
    $$("[data-logo]").forEach((slot) => {
      slot.innerHTML = `<img src="${esc(src)}" alt="">`;
      slot.hidden = false;
    });
    document.documentElement.classList.add("has-logo");
    if (A.config.logoWithName) document.documentElement.classList.add("logo-has-name");
    const icon = $("#favicon");
    if (icon) icon.href = src;
  }

  /* ---------------- запись ----------------
     На компьютере форма стоит на первом экране. На телефоне она — шторка снизу (<dialog>),
     которую открывают все кнопки «Записаться», направления, строки прайса и программы. */
  const form = $("#booking");
  const dlg = $("#booking-dialog");
  const sel = $("#f-service");
  const isSheet = () => !desktop.matches;
  let returnFocus = null;

  function placeBooking() {
    if (!desktop.matches) return;
    let modal = false;
    try { modal = dlg.matches(":modal"); } catch (e) { modal = false; }
    if (modal) dlg.close();
    if (!dlg.open) dlg.show();
  }
  function openBooking(value, goal, trigger) {
    if (value) { sel.value = value; clearErr(sel, $("#e-service")); }
    if (goal) track(goal, value ? { item: value } : undefined);
    closeMenu();
    if (isSheet()) {
      returnFocus = trigger || document.activeElement;
      if (dlg.open) dlg.close();
      try { dlg.showModal(); } catch (e) { dlg.show(); }
      document.documentElement.classList.add("is-locked");
      form.scrollTop = 0;
      track("booking_open");
    } else {
      form.scrollIntoView({ behavior: behavior(), block: "center" });
      form.classList.remove("is-flash"); void form.offsetWidth; form.classList.add("is-flash");
      setTimeout(() => $("#f-name").focus({ preventScroll: true }), 450);
    }
  }
  function closeBooking() { if (isSheet() && dlg.open) dlg.close(); }
  dlg.addEventListener("close", () => {
    document.documentElement.classList.remove("is-locked");
    form.style.transform = "";
    if (isSheet() && returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  });
  // нажатие на затемнение вокруг шторки закрывает её
  dlg.addEventListener("click", (e) => { if (e.target === dlg && isSheet()) dlg.close(); });
  document.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open-booking]");
    if (open) { e.preventDefault(); openBooking(null, null, open); return; }
    if (e.target.closest("[data-close-booking]")) { closeBooking(); return; }
    const b = e.target.closest("[data-book]");
    if (b) { openBooking("s:" + b.dataset.book, "price_book", b); return; }
    const c = e.target.closest("[data-checkup]");
    if (c) openBooking("c:" + c.dataset.checkup, "checkup_book", c);
  });

  // шторку можно смахнуть вниз за верхнюю часть
  (function swipeToClose() {
    const head = $(".booking-head");
    let y0 = null, dy = 0;
    head.addEventListener("touchstart", (e) => {
      if (!isSheet() || !dlg.open) return;
      y0 = e.touches[0].clientY; dy = 0; form.style.transition = "none";
    }, { passive: true });
    head.addEventListener("touchmove", (e) => {
      if (y0 === null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      form.style.transform = "translateY(" + dy + "px)";
    }, { passive: true });
    const end = () => {
      if (y0 === null) return;
      y0 = null;
      form.style.transition = "";
      if (dy > 90) dlg.close(); else form.style.transform = "";
    };
    head.addEventListener("touchend", end);
    head.addEventListener("touchcancel", end);
  })();

  // маска телефона +7 (XXX) XXX-XX-XX
  const phone = $("#f-phone");
  function phoneDigits(v) {
    let d = v.replace(/\D/g, "");
    if (d.startsWith("8")) d = "7" + d.slice(1);
    if (!d.startsWith("7")) d = "7" + d;
    return d.slice(0, 11);
  }
  phone.addEventListener("input", () => {
    const d = phoneDigits(phone.value);
    const p = d.slice(1);
    let out = "+7";
    if (p.length) out += " (" + p.slice(0, 3);
    if (p.length >= 3) out += ")";
    if (p.length > 3) out += " " + p.slice(3, 6);
    if (p.length > 6) out += "-" + p.slice(6, 8);
    if (p.length > 8) out += "-" + p.slice(8, 10);
    phone.value = out;
  });
  phone.addEventListener("focus", () => { if (!phone.value) phone.value = "+7 ("; });

  function setErr(input, errEl, msgKey) {
    input.setAttribute("aria-invalid", "true");
    errEl.textContent = t(msgKey);
    errEl.hidden = false;
    input.setAttribute("aria-describedby", errEl.id);
  }
  function clearErr(input, errEl) { input.removeAttribute("aria-invalid"); errEl.hidden = true; }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#f-name"), consent = $("#f-consent");
    let firstBad = null;
    [[sel, "#e-service"], [name, "#e-name"], [phone, "#e-phone"], [consent, "#e-consent"]].forEach(([i, er]) => clearErr(i, $(er)));
    if (!sel.value) { setErr(sel, $("#e-service"), "booking.errService"); firstBad = firstBad || sel; }
    if (name.value.trim().length < 2) { setErr(name, $("#e-name"), "booking.errName"); firstBad = firstBad || name; }
    if (phoneDigits(phone.value).length !== 11) { setErr(phone, $("#e-phone"), "booking.errPhone"); firstBad = firstBad || phone; }
    if (!consent.checked) { setErr(consent, $("#e-consent"), "booking.errConsent"); firstBad = firstBad || consent; }
    if (firstBad) { firstBad.focus(); track("booking_error"); return; }

    const [kind, id] = sel.value.split(":");
    const item = kind === "s" ? A.services.find((s) => s.id === id) : A.checkups.find((c) => c.id === id);
    const when = form.querySelector('input[name="when"]:checked').value;
    const whenLabel = t({ today: "booking.today", tomorrow: "booking.tomorrow", later: "booking.later" }[when]);
    const text = [
      t("booking.msgHello"),
      `${t("booking.msgService")}: ${nm(item.name)}`,
      `${t("booking.msgWhen")}: ${whenLabel}`,
      `${t("booking.msgName")}: ${name.value.trim()}`,
      `${t("booking.msgPhone")}: ${phone.value}`,
      `(${t("booking.msgSource")})`,
    ].join("\n");
    const url = "https://wa.me/" + A.config.whatsapp + "?text=" + encodeURIComponent(text);
    track("booking_submit", { item: sel.value, when });
    const win = window.open(url, "_blank", "noopener");
    if (!win) window.location.href = url;
    closeBooking();
    toast(t("booking.done"));
  });

  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
  }

  /* ---------------- меню на телефоне: карточка под шапкой ---------------- */
  const menu = $("#site-menu"), burger = $(".burger"), header = $("#header");
  function setMenu(open) {
    menu.hidden = !open;
    burger.setAttribute("aria-expanded", String(open));
    $("use", burger).setAttribute("href", open ? "#x" : "#menu");
    burger.setAttribute("aria-label", t(open ? "nav.close" : "nav.menu"));
    header.classList.toggle("menu-open", open);
  }
  function closeMenu() { if (!menu.hidden) setMenu(false); }
  burger.addEventListener("click", () => {
    const open = menu.hidden;
    setMenu(open);
    if (open) { const first = $("a", menu); if (first) first.focus({ preventScroll: true }); }
  });
  document.addEventListener("click", (e) => { if (!menu.hidden && !e.target.closest("#site-menu, .burger")) setMenu(false); });
  menu.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { setMenu(false); burger.focus(); } });

  /* ---------------- окна ---------------- */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-open]");
    if (!b) return;
    const d = document.getElementById(b.dataset.open);
    if (d && typeof d.showModal === "function") d.showModal();
  });

  /* ---------------- нижняя панель и кнопка WhatsApp ----------------
     Пока виден первый экран, панели нет, а у круглой кнопки есть подпись «WhatsApp».
     Дальше появляется панель «Позвонить / Записаться», кнопка становится кружком. */
  const fab = $("#wa-fab");
  let pastHero = false;
  function setPastHero(past) {
    pastHero = past;
    document.body.classList.toggle("bar-on", past && !desktop.matches);
    fab.classList.toggle("is-compact", past);
  }

  /* ---------------- подсветка раздела в меню, карта ---------------- */
  if ("IntersectionObserver" in window) {
    // кнопки первого экрана ушли под шапку или выше — показываем панель
    new IntersectionObserver(([en]) => setPastHero(!en.isIntersecting && en.boundingClientRect.bottom < window.innerHeight / 2), { rootMargin: "-80px 0px 0px 0px" })
      .observe($("#hero-actions"));

    const links = $$(".main-nav a");
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        links.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === "#" + en.target.id));
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    ["directions", "gastro", "prices", "checkup", "contacts"].forEach((id) => { const s = document.getElementById(id); if (s) io.observe(s); });

    // карта загружается, только когда до неё долистали
    const map = $("#map");
    const mio = new IntersectionObserver((entries) => {
      if (!entries.some((en) => en.isIntersecting)) return;
      mio.disconnect();
      const f = document.createElement("iframe");
      f.title = t("contacts.mapTitle");
      f.loading = "lazy";
      f.referrerPolicy = "no-referrer-when-downgrade";
      f.src = "https://www.google.com/maps?q=" + encodeURIComponent(A.config.mapQuery) + "&z=16&output=embed";
      map.appendChild(f);
    }, { rootMargin: "300px" });
    mio.observe(map);
  } else {
    setPastHero(true);
  }

  /* ---------------- язык ---------------- */
  function setLang(lang, fromUser) {
    if (!LANGS.includes(lang)) lang = "ru";
    state.lang = lang;
    applyStatic();
    renderServiceSelect();
    renderDirections();
    renderPrices();
    renderQuiz();
    renderSlips();
    renderTeam();
    refreshRails();
    try { localStorage.setItem("abk-lang", lang); } catch (e) { /* без сохранения */ }
    if (fromUser) {
      try {
        const u = new URL(window.location.href);
        u.searchParams.set("lang", lang);
        history.replaceState(null, "", u);
      } catch (e) { /* адресная строка не меняется — не страшно */ }
      track("lang_switch", { to: lang });
    }
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-lang]");
    if (b) setLang(b.dataset.lang, true);
  });

  /* ---------------- старт ---------------- */
  /* ---------------- заставка с логотипом ---------------- */
  (function intro() {
    const el = $("#intro");
    if (!el || document.documentElement.classList.contains("no-intro")) { if (el) el.remove(); return; }
    try { sessionStorage.setItem("abk-intro", "1"); } catch (e) { /* без запоминания */ }
    const start = performance.now();
    const finish = () => {
      setTimeout(() => {
        el.classList.add("is-done");
        setTimeout(() => el.remove(), 500);
      }, Math.max(0, 1650 - (performance.now() - start)));
    };
    if (document.readyState === "complete") finish(); else window.addEventListener("load", finish, { once: true });
  })();

  applyLogo();
  $$(".rail").forEach(setupRail);
  let initial = new URLSearchParams(window.location.search).get("lang");
  if (!initial) { try { initial = localStorage.getItem("abk-lang"); } catch (e) { initial = null; } }
  if (!initial && /^kk/i.test(navigator.language || "")) initial = "kk";
  setLang(initial || "ru", false);
  placeBooking();

  onMedia(desktop, () => {
    placeBooking();
    if (desktop.matches) { document.documentElement.classList.remove("is-locked"); closeMenu(); }
    setPastHero(pastHero);
    renderPrices();
    renderSlips();
  });
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { refreshRails(); goToPage(state.page, false); }, 120);
  });
})();
