import { frameManifest } from './frame-manifest.js';

/**
 * More Than Coffee — front-end controller.
 *
 * How the cinematic hero works:
 *  - CSS gives .hero a tall scroll runway (--runway) and pins the canvas with position: sticky.
 *  - A single scroll listener turns "how far through the runway" into a 0 → 1 progress value.
 *  - Progress is eased, mapped to a frame index, and painted to the canvas.
 *  - Story "beats" fade in and out at fixed progress ranges.
 * No GSAP / ScrollTrigger is required, so there is one less thing that can break.
 */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const money = (value) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD',
}).format(Number(value) || 0);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const els = {
  canvas: $('#cinematic-canvas'),
  hero: $('#hero'),
  header: $('.site-header'),
  cue: $('.scroll-cue'),
  rail: $('.progress-rail span'),
  loader: $('#loader'),
  loaderBar: $('#loader-bar'),
  loaderCount: $('#loader-count'),
  cartButton: $('.nav-cart'),
  cartCount: $('[data-cart-count]'),
  cartPanel: $('#cart-panel'),
  cartBackdrop: $('#cart-backdrop'),
  cartItems: $('#cart-items'),
  cartSubtotal: $('#cart-subtotal'),
  closeCart: $('.close-cart'),
  productGrid: $('#product-grid'),
  filterBar: $('#filter-bar'),
  search: $('#menu-search'),
  toast: $('#toast'),
};

/* --------------------------------------------------------------------------
   Frames
   -------------------------------------------------------------------------- */

function resolveFrames(manifest) {
  const list = Array.isArray(manifest?.sequence) ? manifest.sequence
    : Array.isArray(manifest?.frames) ? manifest.frames
      : Array.isArray(manifest) ? manifest : [];
  return list.filter((src) => typeof src === 'string' && src);
}

const frames = resolveFrames(frameManifest);
const ctx = els.canvas?.getContext('2d', { alpha: false });
if (ctx) ctx.imageSmoothingQuality = 'high';

const MAX_DPR = 2;
const MAX_CANVAS_PIXELS = 4.2e6;   // keeps huge / retina screens from repainting 5K canvases
const WARM_BEHIND = 10;            // frames kept ready behind the playhead
const WARM_AHEAD = 28;             // frames kept ready ahead of the playhead
const KEEP_RADIUS = 70;            // frames outside this window are dropped from memory
const KEY_STEP = 8;                // every Nth frame is permanent, so fast scrubs never go blank
const OPENING_FRAMES = 14;         // frames to wait for behind the loader
const LOADER_TIMEOUT = 7000;

const cache = new Map();           // index -> { img, ready, failed, promise }
let currentFrame = 0;
let lastWarmCenter = -999;
let canvasWidth = 0;
let canvasHeight = 0;
let resizeObserver = null;
let drawQueued = false;

const isKeyframe = (i) => i % KEY_STEP === 0 || i === frames.length - 1;

function loadFrame(index) {
  if (index < 0 || index >= frames.length) return null;
  const existing = cache.get(index);
  if (existing) return existing;

  const img = new Image();
  img.decoding = 'async';
  const entry = { img, ready: false, failed: false, promise: null };
  entry.promise = new Promise((resolve) => {
    img.onload = async () => {
      try { if (typeof img.decode === 'function') await img.decode(); } catch { /* still drawable */ }
      entry.ready = true;
      if (Math.abs(index - currentFrame) <= 1) requestDraw();
      resolve(entry);
    };
    img.onerror = () => {
      entry.failed = true;
      console.warn(`Could not load cinematic frame: ${frames[index]}`);
      resolve(entry);
    };
  });
  img.src = frames[index];
  cache.set(index, entry);
  return entry;
}

function warmFrames(center) {
  if (!frames.length || Math.abs(center - lastWarmCenter) < 2) return;
  lastWarmCenter = center;

  const start = Math.max(0, center - WARM_BEHIND);
  const end = Math.min(frames.length - 1, center + WARM_AHEAD);
  for (let i = start; i <= end; i += 1) loadFrame(i);

  if (cache.size > KEEP_RADIUS * 2) {
    for (const index of cache.keys()) {
      if (!isKeyframe(index) && Math.abs(index - center) > KEEP_RADIUS) cache.delete(index);
    }
  }
}

function preloadKeyframes() {
  const run = () => {
    for (let i = 0; i < frames.length; i += 1) if (isKeyframe(i)) loadFrame(i);
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 2500 });
  else setTimeout(run, 800);
}

/** The exact frame if it is ready, otherwise the closest one that is, so scrubbing never freezes. */
function nearestReady(index) {
  for (let d = 0; d <= 14; d += 1) {
    const before = cache.get(index - d);
    if (before?.ready && !before.failed) return before;
    const after = cache.get(index + d);
    if (after?.ready && !after.failed) return after;
  }
  return null;
}

/* --------------------------------------------------------------------------
   Canvas
   -------------------------------------------------------------------------- */

function setCanvasSize() {
  if (!els.canvas || !ctx) return;
  const rect = els.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  let dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  dpr = Math.max(1, Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / (rect.width * rect.height))));
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (width === canvasWidth && height === canvasHeight) {
    requestDraw();
    return;
  }

  canvasWidth = width;
  canvasHeight = height;
  els.canvas.width = width;
  els.canvas.height = height;
  requestDraw();
}

function drawFrame() {
  if (!ctx || !canvasWidth || !canvasHeight) return;
  ctx.fillStyle = '#0b0705';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const entry = nearestReady(currentFrame);
  if (!entry) return;

  const image = entry.img;
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  if (!iw || !ih) return;

  // "cover" fit, centred
  const scale = Math.max(canvasWidth / iw, canvasHeight / ih);
  const w = iw * scale;
  const h = ih * scale;
  ctx.drawImage(image, (canvasWidth - w) / 2, (canvasHeight - h) / 2, w, h);
}

function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    drawFrame();
  });
}

function initCanvasResize() {
  if ('ResizeObserver' in window && els.canvas) {
    resizeObserver = new ResizeObserver(() => { setCanvasSize(); onScroll(); });
    resizeObserver.observe(els.canvas);
  } else {
    window.addEventListener('resize', () => { setCanvasSize(); onScroll(); }, { passive: true });
  }
  setCanvasSize();
}

/* --------------------------------------------------------------------------
   Scroll → progress → frame + story beats
   -------------------------------------------------------------------------- */

const beats = $$('.beat').map((el) => ({
  el,
  start: Number(el.dataset.start),
  end: Number(el.dataset.end),
  on: null,
}));

const BEAT_FADE = 0.05;
const BEAT_TRAVEL = 36; // px of vertical drift while a beat fades in / out

function updateStory(progress) {
  for (const beat of beats) {
    const fadeIn = clamp((progress - beat.start) / BEAT_FADE, 0, 1);
    const fadeOut = clamp((beat.end - progress) / BEAT_FADE, 0, 1);
    const visibility = Math.min(fadeIn, fadeOut);
    const middle = (beat.start + beat.end) / 2;
    const shift = progress < middle ? (1 - fadeIn) * BEAT_TRAVEL : -(1 - fadeOut) * BEAT_TRAVEL;

    beat.el.style.opacity = visibility.toFixed(3);
    beat.el.style.transform = `translate3d(0, ${shift.toFixed(1)}px, 0)`;

    const on = visibility > 0.5;
    if (on !== beat.on) {
      beat.on = on;
      beat.el.setAttribute('aria-hidden', on ? 'false' : 'true');
    }
  }

  els.cue?.classList.toggle('is-hidden', progress > 0.02);
  if (els.rail) els.rail.style.transform = `scaleY(${progress.toFixed(4)})`;
}

let targetProgress = 0;
let shownProgress = 0;
let loopId = 0;
let lastTick = 0;

function applyProgress(progress) {
  if (frames.length) {
    const next = Math.round(clamp(progress, 0, 1) * (frames.length - 1));
    if (next !== currentFrame) {
      currentFrame = next;
      warmFrames(currentFrame);
    }
    drawFrame();
  }
  updateStory(progress);
}

function tick(now) {
  loopId = 0;
  const dt = Math.min(0.1, (now - lastTick) / 1000 || 0.016);
  lastTick = now;

  // Frame-rate independent easing toward the real scroll position.
  shownProgress += (targetProgress - shownProgress) * (1 - Math.exp(-dt * 14));
  if (Math.abs(targetProgress - shownProgress) < 0.0002) shownProgress = targetProgress;

  applyProgress(shownProgress);
  if (shownProgress !== targetProgress) loopId = requestAnimationFrame(tick);
}

function setTarget(progress) {
  targetProgress = clamp(progress, 0, 1);
  if (reduceMotion) {
    shownProgress = targetProgress;
    applyProgress(shownProgress);
    return;
  }
  if (!loopId) {
    lastTick = performance.now();
    loopId = requestAnimationFrame(tick);
  }
}

function readProgress() {
  if (!els.hero) return 0;
  const rect = els.hero.getBoundingClientRect();
  const distance = Math.max(1, els.hero.offsetHeight - window.innerHeight);
  return clamp(-rect.top / distance, 0, 1);
}

let lastScrollY = window.scrollY;

function updateHeader() {
  if (!els.header) return;
  const y = window.scrollY;
  const delta = y - lastScrollY;
  els.header.classList.toggle('is-scrolled', y > 40);

  // The header steps aside while the film plays, but stays put on the menu so the cart is always reachable.
  const inFilm = els.hero ? y < els.hero.offsetHeight - window.innerHeight : false;

  if (y < 120 || !inFilm || document.documentElement.classList.contains('is-loading')) {
    els.header.classList.remove('is-hidden');
  } else if (delta > 3 && !cartOpen) {
    els.header.classList.add('is-hidden');      // scrolling down through the film: get out of the way
  } else if (delta < -3) {
    els.header.classList.remove('is-hidden');   // scrolling up: bring it back
  }
  lastScrollY = y;
}

function onScroll() {
  setTarget(readProgress());
  updateHeader();
}

function initScrollRunway() {
  if (!els.hero) return;
  // More frames → a little more scroll distance, so each frame gets a fair amount of travel.
  if (frames.length) {
    const vh = clamp(Math.round(frames.length * 5), 420, 900);
    els.hero.style.setProperty('--runway', `${vh}vh`);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  shownProgress = targetProgress = readProgress();
  currentFrame = Math.round(shownProgress * Math.max(0, frames.length - 1));
  warmFrames(currentFrame);
  applyProgress(shownProgress);
}

/* --------------------------------------------------------------------------
   Smooth scrolling (Lenis, optional) + anchor links
   -------------------------------------------------------------------------- */

let lenis = null;
let lenisRaf = 0;

function initSmoothScroll() {
  if (reduceMotion || !window.Lenis) return;
  try {
    lenis = new window.Lenis({ lerp: 0.1, wheelMultiplier: 0.95, smoothWheel: true });
    const raf = (time) => {
      lenis.raf(time);
      lenisRaf = requestAnimationFrame(raf);
    };
    lenisRaf = requestAnimationFrame(raf);
  } catch (error) {
    console.warn('Smooth scrolling unavailable, using native scroll.', error);
    lenis = null;
  }
}

function scrollToTarget(target) {
  const offset = -((els.header?.offsetHeight || 0) - 1);
  if (lenis) {
    lenis.scrollTo(target, { offset, duration: 1.8, easing: (t) => 1 - Math.pow(1 - t, 4) });
  } else {
    const top = target.getBoundingClientRect().top + window.scrollY + offset;
    window.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
  }
}

function bindAnchors() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const id = link.getAttribute('href');
    if (!id || id === '#') return;
    const target = id === '#hero' ? document.body : $(id);
    if (!target) return;
    event.preventDefault();
    if (id === '#hero') {
      if (lenis) lenis.scrollTo(0, { duration: 1.8 });
      else window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    } else {
      scrollToTarget(target);
    }
  });
}

/* --------------------------------------------------------------------------
   Reveal on scroll
   -------------------------------------------------------------------------- */

let revealObserver = null;

function observeReveal(el) {
  if (!el) return;
  if (!revealObserver) { el.classList.add('in'); return; }
  revealObserver.observe(el);
}

function initReveal() {
  if (reduceMotion || !('IntersectionObserver' in window)) {
    $$('[data-reveal]').forEach((el) => el.classList.add('in'));
    return;
  }
  revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('in');
      revealObserver.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
  $$('[data-reveal]').forEach((el) => revealObserver.observe(el));
}

/* --------------------------------------------------------------------------
   Loader
   -------------------------------------------------------------------------- */

function setLoader(ratio) {
  const value = clamp(ratio, 0, 1);
  if (els.loaderBar) els.loaderBar.style.transform = `scaleX(${value})`;
  if (els.loaderCount) els.loaderCount.textContent = String(Math.round(value * 100));
}

function preloadOpening() {
  const count = Math.min(OPENING_FRAMES, frames.length);
  if (!count) { setLoader(1); return Promise.resolve(); }

  let done = 0;
  const tasks = [];
  for (let i = 0; i < count; i += 1) {
    tasks.push(loadFrame(i).promise.then(() => {
      done += 1;
      setLoader(done / count);
    }));
  }
  return Promise.race([Promise.all(tasks), wait(LOADER_TIMEOUT)]);
}

function finishLoader() {
  setLoader(1);
  document.documentElement.classList.remove('is-loading');
  document.body.classList.add('is-ready');
  els.loader?.classList.add('is-done');
  window.setTimeout(() => els.loader?.remove(), 1500);
}

/* --------------------------------------------------------------------------
   Products + menu
   -------------------------------------------------------------------------- */

let products = [];
let category = 'All';
let searchTerm = '';

function createElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showSkeletons() {
  if (!els.productGrid) return;
  els.productGrid.replaceChildren(...Array.from({ length: 6 }, () => createElement('div', 'skeleton')));
}

async function loadProducts() {
  showSkeletons();
  try {
    const response = await fetch('./data/products.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Products request failed (${response.status})`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new TypeError('products.json must contain an array');

    products = data.filter((item) => item && item.id != null && item.name)
      .map((item) => ({
        id: String(item.id),
        name: String(item.name),
        category: String(item.category || 'Coffee'),
        description: String(item.description || ''),
        image: String(item.image || ''),
        price: Math.max(0, Number(item.price) || 0),
      }));
  } catch (error) {
    console.error('Could not load menu products.', error);
    products = [];
    els.productGrid?.replaceChildren(
      createElement('p', 'menu-empty', 'The menu is temporarily unavailable. Please try again shortly.'),
    );
  }
}

function renderFilters() {
  if (!els.filterBar) return;
  const categories = ['All', ...new Set(products.map((item) => item.category))];
  els.filterBar.replaceChildren();

  categories.forEach((name) => {
    const button = createElement('button', `filter-chip${name === category ? ' active' : ''}`, name);
    button.type = 'button';
    button.dataset.filter = name;
    button.setAttribute('aria-pressed', String(name === category));
    els.filterBar.appendChild(button);
  });
}

function buildCard(product, index) {
  const card = createElement('article', 'product-card');
  card.style.setProperty('--i', String(index % 6));

  const imageWrap = createElement('div', 'product-image');
  imageWrap.dataset.initial = product.name.charAt(0).toUpperCase();
  if (product.image) {
    const image = document.createElement('img');
    image.alt = product.name;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('load', () => image.classList.add('loaded'));
    image.addEventListener('error', () => { image.remove(); imageWrap.classList.add('no-image'); });
    image.src = product.image;
    imageWrap.appendChild(image);
  } else {
    imageWrap.classList.add('no-image');
  }
  imageWrap.appendChild(createElement('span', 'product-tag', product.category));

  const info = createElement('div', 'product-info');
  const meta = createElement('div', 'product-meta');
  meta.append(createElement('h3', '', product.name), createElement('span', 'product-price', money(product.price)));
  info.append(meta, createElement('p', '', product.description));

  const actions = createElement('div', 'product-actions');
  actions.appendChild(createElement('span', 'product-variants', 'Hot & iced'));
  const addButton = createElement('button', 'add-cart', 'Add to cart');
  addButton.type = 'button';
  addButton.dataset.productId = product.id;
  addButton.setAttribute('aria-label', `Add ${product.name} to cart`);
  actions.appendChild(addButton);
  info.appendChild(actions);

  card.append(imageWrap, info);
  return card;
}

function renderProducts() {
  if (!els.productGrid) return;
  const query = searchTerm.trim().toLocaleLowerCase();
  const visible = products.filter((product) => {
    const matchesCategory = category === 'All' || product.category === category;
    const matchesSearch = !query
      || `${product.name} ${product.description} ${product.category}`.toLocaleLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });

  if (!visible.length) {
    els.productGrid.replaceChildren(
      createElement('p', 'menu-empty', 'No drinks match your search. Try another term or category.'),
    );
    return;
  }
  els.productGrid.replaceChildren(...visible.map(buildCard));
}

function renderMenu() {
  renderFilters();
  renderProducts();
}

/* --------------------------------------------------------------------------
   Cart
   -------------------------------------------------------------------------- */

function readCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem('coffee-cart') || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === 'string')
      .map((item) => ({
        id: item.id,
        name: String(item.name || 'Coffee'),
        price: Math.max(0, Number(item.price) || 0),
        quantity: clamp(Math.floor(Number(item.quantity) || 1), 1, 99),
      }));
  } catch {
    return [];
  }
}

function persistCart() {
  try {
    localStorage.setItem('coffee-cart', JSON.stringify(cart));
  } catch (error) {
    console.warn('Cart could not be saved in this browser.', error);
  }
}

let cart = readCart();
let cartOpen = false;
let toastTimer = 0;

function showToast(message) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), 2200);
}

function setCartOpen(open) {
  cartOpen = open;
  els.cartPanel?.classList.toggle('open', open);
  els.cartPanel?.setAttribute('aria-hidden', String(!open));
  els.cartBackdrop?.classList.toggle('show', open);
  els.cartButton?.setAttribute('aria-expanded', String(open));
  if (open) {
    lenis?.stop();
    els.closeCart?.focus({ preventScroll: true });
  } else {
    lenis?.start();
  }
}

function addToCart(productId) {
  const product = products.find((item) => item.id === productId);
  if (!product) return;
  const existing = cart.find((item) => item.id === productId);
  if (existing) existing.quantity = clamp(existing.quantity + 1, 1, 99);
  else cart.push({ id: product.id, name: product.name, price: product.price, quantity: 1 });

  updateCart();
  showToast(`${product.name} added to your order`);
  if (els.cartCount) {
    els.cartCount.classList.remove('bump');
    void els.cartCount.offsetWidth; // restart the animation
    els.cartCount.classList.add('bump');
  }
}

function updateCart() {
  cart = cart.filter((item) => item.quantity > 0);
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.quantity * item.price, 0);
  if (els.cartCount) els.cartCount.textContent = String(count);
  if (els.cartSubtotal) els.cartSubtotal.textContent = money(subtotal);
  if (!els.cartItems) return;

  els.cartItems.replaceChildren();
  if (!cart.length) {
    els.cartItems.appendChild(createElement('p', 'cart-empty', 'Your cart is empty. Add a drink from the menu to get started.'));
  } else {
    cart.forEach((item) => {
      const row = createElement('div', 'cart-item');
      const details = createElement('div', 'cart-item-details');
      details.appendChild(createElement('div', 'cart-item-name', item.name));

      const controls = createElement('div', 'cart-item-controls');
      const decrease = createElement('button', 'qty-btn', '−');
      decrease.type = 'button'; decrease.dataset.action = 'decrease'; decrease.dataset.id = item.id;
      decrease.setAttribute('aria-label', `Decrease ${item.name} quantity`);
      const quantity = createElement('span', 'cart-item-quantity', String(item.quantity));
      const increase = createElement('button', 'qty-btn', '+');
      increase.type = 'button'; increase.dataset.action = 'increase'; increase.dataset.id = item.id;
      increase.setAttribute('aria-label', `Increase ${item.name} quantity`);
      controls.append(decrease, quantity, increase);
      details.appendChild(controls);

      const priceColumn = createElement('div', 'cart-item-price-column');
      priceColumn.appendChild(createElement('strong', '', money(item.price * item.quantity)));
      const remove = createElement('button', 'remove-item', 'Remove');
      remove.type = 'button'; remove.dataset.action = 'remove'; remove.dataset.id = item.id;
      remove.setAttribute('aria-label', `Remove ${item.name} from cart`);
      priceColumn.appendChild(remove);

      row.append(details, priceColumn);
      els.cartItems.appendChild(row);
    });
  }
  persistCart();
}

/* --------------------------------------------------------------------------
   Events
   -------------------------------------------------------------------------- */

function bindEvents() {
  els.filterBar?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    category = button.dataset.filter || 'All';
    renderMenu();
  });

  els.search?.addEventListener('input', () => {
    searchTerm = els.search.value;
    renderProducts();
  });

  els.productGrid?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-product-id]');
    if (button) addToCart(button.dataset.productId);
  });

  // Soft light that follows the pointer across a card.
  if (finePointer) {
    els.productGrid?.addEventListener('pointermove', (event) => {
      const card = event.target.closest('.product-card');
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      card.style.setProperty('--my', `${event.clientY - rect.top}px`);
    });
  }

  els.cartItems?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action][data-id]');
    if (!button) return;
    const item = cart.find((entry) => entry.id === button.dataset.id);
    if (!item) return;

    if (button.dataset.action === 'increase') item.quantity = clamp(item.quantity + 1, 1, 99);
    if (button.dataset.action === 'decrease') item.quantity -= 1;
    if (button.dataset.action === 'remove') item.quantity = 0;
    updateCart();
  });

  els.cartButton?.addEventListener('click', () => setCartOpen(!cartOpen));
  els.closeCart?.addEventListener('click', () => setCartOpen(false));
  els.cartBackdrop?.addEventListener('click', () => setCartOpen(false));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && cartOpen) {
      setCartOpen(false);
      els.cartButton?.focus({ preventScroll: true });
    }
  });

  bindAnchors();
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

async function init() {
  initReveal();
  bindEvents();
  initCanvasResize();
  updateCart();

  if (!frames.length) console.warn('Cinematic sequence is empty. Check frame-manifest.js.');

  // Wait for the opening frames and the menu (and a short beat so the loader never just flashes).
  await Promise.all([preloadOpening(), loadProducts(), wait(700)]);
  renderMenu();
  initScrollRunway();
  initSmoothScroll();
  finishLoader();
  preloadKeyframes();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

window.addEventListener('pagehide', () => {
  resizeObserver?.disconnect();
  cancelAnimationFrame(lenisRaf);
  cancelAnimationFrame(loopId);
  lenis?.destroy();
});