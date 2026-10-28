import { frameManifest } from './frame-manifest.js';

/**
 * More Than Coffee — production-minded front-end controller.
 * Keeps the existing HTML, CSS, frame-manifest.js and data/products.json structure.
 */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const money = (value) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD',
}).format(Number(value) || 0);

const els = {
  canvas: $('#cinematic-canvas'),
  hero: $('#hero'),
  heroShell: $('.hero-canvas-shell'),
  heroCopy: $('.hero-copy'),
  coffeeOverlay: $('#coffee-overlay'),
  cartButton: $('.nav-cart'),
  cartCount: $('[data-cart-count]'),
  cartPanel: $('#cart-panel'),
  cartItems: $('#cart-items'),
  cartSubtotal: $('#cart-subtotal'),
  closeCart: $('.close-cart'),
  productGrid: $('#product-grid'),
  filterBar: $('#filter-bar'),
  search: $('#menu-search'),
};

const ctx = els.canvas?.getContext('2d', { alpha: false });
const frames = Array.isArray(frameManifest?.sequence) ? frameManifest.sequence : [];
const imageCache = new Map();
const MAX_DPR = 2;
const CACHE_RADIUS = 18;
let currentFrame = 0;
let lastDrawnFrame = -1;
let activeImage = null;
let canvasWidth = 0;
let canvasHeight = 0;
let scrollTriggerInstance = null;
let resizeObserver = null;
let products = [];
let category = 'All';
let searchTerm = '';
let cart = readCart();
let renderQueued = false;

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

function setCanvasSize() {
  if (!els.canvas || !ctx) return;
  const rect = els.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
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

function imageFor(index) {
  if (!frames.length || index < 0 || index >= frames.length) return null;
  const src = frames[index];
  if (imageCache.has(src)) return imageCache.get(src);

  const image = new Image();
  image.decoding = 'async';
  image.loading = 'eager';
  imageCache.set(src, image);

  image.onload = async () => {
    try {
      if (typeof image.decode === 'function') await image.decode();
    } catch {
      // onload still means the image can normally be drawn.
    }
    if (index === currentFrame) requestDraw();
  };
  image.onerror = () => {
    imageCache.set(src, null);
    console.warn(`Could not load cinematic frame: ${src}`);
  };
  image.src = src;
  return image;
}

function drawCover(image) {
  if (!ctx || !image || !image.complete || !(image.naturalWidth || image.width)) return;

  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  const scale = Math.max(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const x = (canvasWidth - width) / 2;
  const y = (canvasHeight - height) / 2;

  ctx.fillStyle = '#120d0b';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.drawImage(image, x, y, width, height);
}

function requestDraw() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    drawCurrentFrame();
  });
}

function drawCurrentFrame() {
  if (!ctx || !frames.length || !canvasWidth || !canvasHeight) return;
  const target = imageFor(currentFrame);

  // Keep the last valid frame visible while the requested frame is loading.
  if (target?.complete && (target.naturalWidth || target.width)) {
    activeImage = target;
    drawCover(target);
    lastDrawnFrame = currentFrame;
    return;
  }

  if (activeImage?.complete && (activeImage.naturalWidth || activeImage.width)) {
    drawCover(activeImage);
  } else if (lastDrawnFrame < 0) {
    ctx.fillStyle = '#120d0b';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }
}

function warmFrames(index) {
  if (!frames.length) return;
  const start = Math.max(0, index - CACHE_RADIUS);
  const end = Math.min(frames.length - 1, index + CACHE_RADIUS);
  for (let i = start; i <= end; i += 1) imageFor(i);
}

function updateStory(progress) {
  const overlayStart = 0.84;
  const overlayEnd = 0.96;
  const overlayProgress = clamp((progress - overlayStart) / (overlayEnd - overlayStart), 0, 1);

  if (els.coffeeOverlay) {
    els.coffeeOverlay.style.opacity = String(overlayProgress);
    els.coffeeOverlay.style.transform = `translateY(${(1 - overlayProgress) * 16}px) scale(${0.98 + overlayProgress * 0.02})`;
    els.coffeeOverlay.classList.toggle('visible', overlayProgress > 0.01);
    els.coffeeOverlay.setAttribute('aria-hidden', overlayProgress < 0.95 ? 'true' : 'false');
  }

  els.heroCopy?.classList.toggle('visible', progress < 0.82);
}

function setProgress(progress) {
  if (!frames.length) return;
  const normalized = clamp(progress, 0, 1);
  currentFrame = Math.round(normalized * (frames.length - 1));
  warmFrames(currentFrame);
  requestDraw();
  updateStory(normalized);
}

function initCinematicScroll() {
  if (!els.hero || !els.heroShell || !frames.length) {
    if (els.canvas && ctx) {
      ctx.fillStyle = '#120d0b';
      ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
    }
    console.warn('Cinematic sequence is empty. Check frame-manifest.js.');
    return;
  }

  const hasGsap = Boolean(window.gsap && window.ScrollTrigger);
  if (hasGsap) {
    window.gsap.registerPlugin(window.ScrollTrigger);
    window.gsap.set(els.heroShell, { y: 0 });

    scrollTriggerInstance = window.ScrollTrigger.create({
      trigger: els.hero,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.35,
      invalidateOnRefresh: true,
      onUpdate: (self) => setProgress(self.progress),
      onRefresh: (self) => setProgress(self.progress),
    });
    return;
  }

  // Consistent fallback: progress runs through the hero's pinned-height region.
  const updateFromScroll = () => {
    const rect = els.hero.getBoundingClientRect();
    const scrollableDistance = Math.max(1, els.hero.offsetHeight - window.innerHeight);
    const progress = clamp(-rect.top / scrollableDistance, 0, 1);
    setProgress(progress);
  };
  window.addEventListener('scroll', updateFromScroll, { passive: true });
  window.addEventListener('resize', updateFromScroll);
  updateFromScroll();
}

async function loadProducts() {
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
    if (els.productGrid) {
      els.productGrid.textContent = 'The menu is temporarily unavailable. Please try again shortly.';
    }
  }
}

function createElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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

function renderProducts() {
  if (!els.productGrid) return;
  const query = searchTerm.trim().toLocaleLowerCase();
  const visible = products.filter((product) => {
    const matchesCategory = category === 'All' || product.category === category;
    const matchesSearch = !query || `${product.name} ${product.description} ${product.category}`.toLocaleLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });

  els.productGrid.replaceChildren();
  if (!visible.length) {
    els.productGrid.appendChild(createElement('p', 'menu-empty', 'No drinks match your search. Try another term or category.'));
    return;
  }

  visible.forEach((product) => {
    const card = createElement('article', 'product-card');
    const imageWrap = createElement('div', 'product-image');
    if (product.image) {
      const image = document.createElement('img');
      image.src = product.image;
      image.alt = product.name;
      image.loading = 'lazy';
      image.decoding = 'async';
      imageWrap.appendChild(image);
    }

    const info = createElement('div', 'product-info');
    const meta = createElement('div', 'product-meta');
    meta.append(createElement('h3', '', product.name), createElement('span', 'product-price', money(product.price)));
    info.appendChild(meta);
    info.appendChild(createElement('p', '', product.description));

    const actions = createElement('div', 'product-actions');
    actions.appendChild(createElement('span', 'product-variants', 'Hot & iced'));
    const addButton = createElement('button', 'add-cart', 'Add to cart');
    addButton.type = 'button';
    addButton.dataset.productId = product.id;
    addButton.setAttribute('aria-label', `Add ${product.name} to cart`);
    actions.appendChild(addButton);
    info.appendChild(actions);
    card.append(imageWrap, info);
    els.productGrid.appendChild(card);
  });
}

function renderMenu() {
  renderFilters();
  renderProducts();
}

function addToCart(productId) {
  const product = products.find((item) => item.id === productId);
  if (!product) return;
  const existing = cart.find((item) => item.id === productId);
  if (existing) existing.quantity = clamp(existing.quantity + 1, 1, 99);
  else cart.push({ id: product.id, name: product.name, price: product.price, quantity: 1 });
  updateCart();
  els.cartPanel?.classList.add('open');
  els.cartPanel?.setAttribute('aria-hidden', 'false');
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

function closeCart() {
  els.cartPanel?.classList.remove('open');
  els.cartPanel?.setAttribute('aria-hidden', 'true');
}

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

  els.cartButton?.addEventListener('click', () => {
    const isOpen = els.cartPanel?.classList.toggle('open');
    els.cartPanel?.setAttribute('aria-hidden', String(!isOpen));
  });
  els.closeCart?.addEventListener('click', closeCart);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeCart();
  });

  document.addEventListener('click', (event) => {
    if (!els.cartPanel?.classList.contains('open')) return;
    if (event.target.closest('#cart-panel, .nav-cart')) return;
    closeCart();
  });
}

function initCanvasResize() {
  if ('ResizeObserver' in window && els.canvas) {
    resizeObserver = new ResizeObserver(setCanvasSize);
    resizeObserver.observe(els.canvas);
  } else {
    window.addEventListener('resize', setCanvasSize, { passive: true });
  }
  setCanvasSize();
}

async function init() {
  bindEvents();
  initCanvasResize();
  updateCart();

  // Load the opening frame immediately, then nearby frames while the page initializes.
  if (frames.length) {
    imageFor(0);
    warmFrames(0);
  }

  await loadProducts();
  renderMenu();
  initCinematicScroll();
  els.heroCopy?.classList.add('visible');

  // Refresh after fonts/layout settle so ScrollTrigger measures the final page geometry.
  if (window.ScrollTrigger) {
    requestAnimationFrame(() => window.ScrollTrigger.refresh());
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

window.addEventListener('pagehide', () => {
  resizeObserver?.disconnect();
  scrollTriggerInstance?.kill();
});
