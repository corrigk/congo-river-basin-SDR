import './style.css';
import './s3/s3.css';
import './s3/v2/v2.css'; // tokens and labels (.vtag) used across the tabs
import { ICON, MARK } from './icons.js';
import * as V from './s3/views.js';
import { createOffline } from './s3/offline.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');

// Three tabs. Research (where things happen, what exists, the gaps) and Design (what S-3 builds) are steps of one
// map view (src/s3/conops), so → walks the story across both; Trades is the SDR workbench (src/sdr).
const TABS = ['research', 'design', 'trades'];
const STORY = [['research', 'why'], ['research', 'today'], ['design', 'what']];
const VIEW_OF = { research: 'conops', design: 'conops', trades: 'sdr' };
const STEP_TITLE = { why: 'Research: why the basin needs S-3', today: 'Research: today, without S-3', what: 'Design: what we build, where, and how many' };

// ---------- static chrome ----------
$('#brand-mark').innerHTML = MARK;
$('[data-act="fullscreen"]').innerHTML = ICON.expand;
$('[data-act="help"]').innerHTML = ICON.help;
$('[data-act="present"]').innerHTML = ICON.present;
$('[data-act="sources"]').innerHTML = ICON.book;
$('#help').innerHTML = V.helpView();

// ---------- state ----------
const state = { tab: 'research', step: 'why', sdrSlide: null, panel: null };
const offline = createOffline($('.offline'));
const pref = {
  present: () => { try { return localStorage.getItem('srr-present') === '1'; } catch { return false; } },
  setPresent: v => { try { localStorage.setItem('srr-present', v ? '1' : '0'); } catch { /* private mode: no memory */ } },
};

// ---------- routing: #research, #research/today, #design, #trades, #trades/present/3 ----------
// SRR-era links still land: #conops[/today|/what] → Research or Design, #sdr[/present/N] → Trades, anything else → Research.
function readHash() {
  const [tab, sub, n] = location.hash.slice(1).split('/');
  const slide = sub === 'present' ? Math.max(0, (+n || 1) - 1) : null;
  if (tab === 'trades' || tab === 'sdr') { state.tab = 'trades'; state.sdrSlide = slide; return; }
  if (tab === 'design' || (tab === 'conops' && sub === 'what')) { state.tab = 'design'; state.step = 'what'; return; }
  state.tab = 'research';
  state.step = sub === 'today' ? 'today' : 'why';
}
function writeHash() {
  const h = state.tab === 'trades' ? `#trades${state.sdrSlide != null ? `/present/${state.sdrSlide + 1}` : ''}`
    : state.tab === 'design' ? '#design' : `#research${state.step === 'today' ? '/today' : ''}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}
addEventListener('hashchange', () => { readHash(); render(); });

// ---------- render ----------
function render() {
  app.dataset.view = state.tab;
  for (const t of $$('.tabs [role="tab"]')) {
    const on = t.dataset.view === state.tab;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
  }
  $('#view-conops').hidden = VIEW_OF[state.tab] !== 'conops';
  $('#view-sdr').hidden = VIEW_OF[state.tab] !== 'sdr';
  $('#view-conops').setAttribute('aria-labelledby', `tab-${state.tab === 'design' ? 'design' : 'research'}`);
  moveInk();
  renderPanel();
  renderConops();
  renderSdr();
  writeHash();
}

function renderPanel() {
  const panel = $('#panel');
  const html = state.panel === 'sources' ? V.sourcesPanel() : '';
  if (html && panel.dataset.k !== state.panel) {
    panel.innerHTML = `<div class="p-inner">${html}</div>`;
    panel.scrollTop = 0;
    $('#announce').textContent = $('.p-title', panel)?.textContent || '';
  }
  panel.dataset.k = html ? state.panel : '';
  panel.classList.toggle('is-open', !!html);
  $('[data-act="sources"]').setAttribute('aria-expanded', state.panel === 'sources');
  app.classList.toggle('has-panel', !!html);
}

// ---------- Research and Design: the map view (loaded the first time it is shown) ----------
let conops = null;
function renderConops() {
  if (VIEW_OF[state.tab] !== 'conops') return;
  (conops ||= import('./s3/conops/view.js').then(async m => { await m.mount($('#view-conops'), state.step); return m; }))
    .then(m => { if (VIEW_OF[state.tab] === 'conops') m.setStep(state.step); });
}
// One story across both tabs: Why → Today (Research) → With S-3 (Design).
function goStory(delta) {
  const i = STORY.findIndex(([t, s]) => t === state.tab && s === state.step);
  const [tab, step] = STORY[Math.max(0, Math.min(STORY.length - 1, i + delta))];
  setStep(step, tab);
}
function setStep(step, tab = step === 'what' ? 'design' : 'research') {
  if (step === state.step && tab === state.tab) return;
  const tabChanged = tab !== state.tab;
  state.step = step;
  state.tab = tab;
  if (tabChanged) render();
  else { writeHash(); conops?.then(m => m.setStep(step)); }
  $('#announce').textContent = STEP_TITLE[step];
}

// ---------- Trades: the SDR workbench (loaded the first time it is opened) ----------
let sdr = null;
function renderSdr() {
  if (state.tab !== 'trades') return;
  const first = !sdr;
  sdr ||= import('./sdr/view.js').then(async m => {
    await m.mount($('#view-sdr'), { slide: state.sdrSlide, onSlide: i => { state.sdrSlide = i; writeHash(); } });
    return m;
  });
  if (!first) sdr.then(m => m.present(state.sdrSlide));
}

let resizeT;
addEventListener('resize', () => {
  moveInk();
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { if (VIEW_OF[state.tab] === 'conops') conops?.then(m => m.refit()); }, 200);
});

function setTab(t) {
  if (!TABS.includes(t) || t === state.tab) return;
  state.tab = t;
  if (t === 'design') state.step = 'what';
  else if (t === 'research' && state.step === 'what') state.step = 'why';
  render();
}
function togglePanel(p) { state.panel = state.panel === p ? null : p; renderPanel(); }

function moveInk() {
  const t = $(`.tabs [role="tab"][data-view="${state.tab}"]`), ink = $('.tabs-ink');
  if (t) Object.assign(ink.style, { width: `${t.offsetWidth}px`, transform: `translateX(${t.offsetLeft - 4}px)` });
}

// Presenter mode: larger type, higher contrast, no keyboard hints. ?present in the link turns it on.
// Slide mode (H / ?slide): the top bar disappears so the page fills the screen for a clean screenshot.
function setSlide(on) {
  app.classList.toggle('is-slide', on);
  $('.slide-exit').hidden = !on;
  requestAnimationFrame(() => { moveInk(); if (VIEW_OF[state.tab] === 'conops') conops?.then(m => m.refit()); });
}
function setPresent(on) {
  app.classList.toggle('is-present', on);
  $('[data-act="present"]').setAttribute('aria-pressed', on);
  pref.setPresent(on);
  requestAnimationFrame(moveInk);
}

// Theme: html[data-theme] when the presenter picked one (L), else the system setting. Modules that paint with
// the tokens (the map canvas) listen for 'srr-theme' (the key and event name are shared with the SRR site).
const systemLight = matchMedia('(prefers-color-scheme: light)');
const isLight = () => (document.documentElement.dataset.theme || (systemLight.matches ? 'light' : 'dark')) === 'light';
function syncTheme() {
  const b = $('[data-act="theme"]'), light = isLight();
  b.innerHTML = light ? ICON.moon : ICON.sun;
  b.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
  $('meta[name="theme-color"]').content = light ? '#FAF8F2' : '#0A0A0A';
  dispatchEvent(new Event('srr-theme'));
}
function toggleTheme() {
  const next = isLight() ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('srr-theme', next); } catch { /* no memory */ }
  syncTheme();
  $('#announce').textContent = `${next === 'light' ? 'Light' : 'Dark'} theme`;
}
systemLight.addEventListener('change', syncTheme);

function toggleHelp() {
  const h = $('#help');
  h.hidden = !h.hidden;
  if (!h.hidden) $('button', h)?.focus();
}
function fullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}

// ---------- events ----------
document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-act]');
  if (!t) return;
  const d = t.dataset;
  if (d.act) {
    switch (d.act) {
      case 'close': state.panel = null; renderPanel(); return;
      case 'help': toggleHelp(); return;
      case 'fullscreen': fullscreen(); return;
      case 'preload': offline.preload(); return;
      case 'present': setPresent(!app.classList.contains('is-present')); return;
      case 'slide': setSlide(!app.classList.contains('is-slide')); return;
      case 'theme': toggleTheme(); return;
      case 'skip': { const v = $(`#view-${VIEW_OF[state.tab]}`); v.tabIndex = -1; v.focus(); return; }
      case 'sources': togglePanel('sources'); return;
    }
  }
  if (d.view && t.getAttribute('role') === 'tab') { setTab(d.view); return; }
  if (d.coStep) setStep(d.coStep);
});
document.addEventListener('pointerdown', e => {
  const h = $('#help');
  if (!h.hidden && !h.contains(e.target) && !e.target.closest('[data-act="help"]')) h.hidden = true;
});

// Keyboard (presentation clickers send PageUp / PageDown or arrows). The Trades deck handles its own arrows.
document.addEventListener('keydown', e => {
  if (e.target.closest?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key, lk = k.toLowerCase();
  const onControl = e.target.closest?.('button, summary, a, [role="tab"]');
  if ((k === ' ' || k === 'Enter') && onControl) return;
  if ((k === 'ArrowRight' || k === 'ArrowLeft') && e.target.closest?.('[role="tab"]')) {
    e.preventDefault();
    const tabs = $$('.tabs [role="tab"]'), i = tabs.indexOf(e.target.closest('[role="tab"]'));
    const next = tabs[(i + (k === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next.focus(); setTab(next.dataset.view);
    return;
  }
  if (/^[1-3]$/.test(k)) { setTab(TABS[+k - 1]); return; }
  if (VIEW_OF[state.tab] === 'conops' && (k === 'ArrowRight' || k === 'PageDown' || k === ' ')) { e.preventDefault(); goStory(1); return; }
  if (VIEW_OF[state.tab] === 'conops' && (k === 'ArrowLeft' || k === 'PageUp')) { e.preventDefault(); goStory(-1); return; }
  if (lk === 'f') { fullscreen(); return; }
  if (lk === 'p') { setPresent(!app.classList.contains('is-present')); return; }
  if (lk === 'h') { setSlide(!app.classList.contains('is-slide')); return; }
  if (lk === 'l') { toggleTheme(); return; }
  if (lk === 's') { togglePanel('sources'); return; }
  if (k === '?') { toggleHelp(); return; }
  if (k === 'Escape') {
    if (!$('#help').hidden) $('#help').hidden = true;
    else if (state.panel) { state.panel = null; renderPanel(); }
  }
});

readHash();
syncTheme();
setPresent(new URLSearchParams(location.search).has('present') || pref.present());
setSlide(new URLSearchParams(location.search).has('slide'));
render();
requestAnimationFrame(() => { moveInk(); app.classList.add('is-ready'); });
window.__sdr = { state, render };
