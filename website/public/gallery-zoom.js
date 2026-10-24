"use strict";

// Klavierhaus original-resolution image viewer. Fit first, then deliberate zoom.
// The pointer and pan limits are based on the *rendered image*, not the viewport.
(() => {
  const triggers = [...document.querySelectorAll("[data-gallery-open]")];
  if (!triggers.length || typeof HTMLDialogElement === "undefined") return;

  const photos = triggers.map((element) => {
    const thumbnail = element.querySelector("img");
    return {
      url: element.dataset.galleryFull || thumbnail?.getAttribute("data-original") || thumbnail?.getAttribute("src") || "",
      alt: thumbnail?.alt || element.getAttribute("aria-label") || ""
    };
  }).filter((photo) => photo.url);
  if (!photos.length) return;

  const language = document.documentElement.lang.toLowerCase().startsWith("hu") ? "hu" : "en";
  const tr = (en, hu) => language === "hu" ? hu : en;
  const dialog = document.createElement("dialog");
  dialog.className = "piano-lightbox";
  dialog.setAttribute("aria-label", tr("Piano photo gallery", "Zongorafotók galériája"));
  dialog.innerHTML = '<div class="piano-lightbox__frame">' +
    '<div class="piano-lightbox__bar">' +
      '<span class="piano-lightbox__counter" data-zoom-counter aria-live="polite"></span>' +
      '<div class="piano-lightbox__actions">' +
        '<button type="button" data-zoom-out aria-label="' + tr("Zoom out", "Kicsinyítés") + '" title="' + tr("Zoom out", "Kicsinyítés") + '">−</button>' +
        '<button type="button" data-zoom-reset aria-label="' + tr("Fit entire photo to screen", "Teljes kép a képernyőre") + '" title="' + tr("Fit entire photo to screen", "Teljes kép a képernyőre") + '">100%</button>' +
        '<button type="button" data-zoom-in aria-label="' + tr("Zoom in", "Nagyítás") + '" title="' + tr("Zoom in", "Nagyítás") + '">+</button>' +
        '<button type="button" data-zoom-close aria-label="' + tr("Close gallery", "Galéria bezárása") + '" title="' + tr("Close gallery", "Galéria bezárása") + '">×</button>' +
      '</div>' +
    '</div>' +
    '<div class="piano-lightbox__stage" data-zoom-stage>' +
      '<img class="piano-lightbox__image" data-zoom-image alt="" draggable="false" decoding="async">' +
      '<button type="button" class="piano-lightbox__nav piano-lightbox__nav--prev" data-zoom-prev aria-label="' + tr("Previous photo", "Előző kép") + '">‹</button>' +
      '<button type="button" class="piano-lightbox__nav piano-lightbox__nav--next" data-zoom-next aria-label="' + tr("Next photo", "Következő kép") + '">›</button>' +
    '</div>' +
    '<div class="piano-lightbox__caption-row">' +
      '<span class="piano-lightbox__caption" data-zoom-caption></span>' +
      '<span class="piano-lightbox__source" data-zoom-source aria-live="polite"></span>' +
    '</div>' +
    '<div class="piano-lightbox__strip" data-zoom-strip aria-label="' + tr("Choose a photo", "Fotó kiválasztása") + '"></div>' +
    '</div>';
  document.body.appendChild(dialog);

  const stage = dialog.querySelector("[data-zoom-stage]");
  const image = dialog.querySelector("[data-zoom-image]");
  const counter = dialog.querySelector("[data-zoom-counter]");
  const caption = dialog.querySelector("[data-zoom-caption]");
  const source = dialog.querySelector("[data-zoom-source]");
  const strip = dialog.querySelector("[data-zoom-strip]");
  const zoomInButton = dialog.querySelector("[data-zoom-in]");
  const zoomOutButton = dialog.querySelector("[data-zoom-out]");
  const resetButton = dialog.querySelector("[data-zoom-reset]");
  const previousButton = dialog.querySelector("[data-zoom-prev]");
  const nextButton = dialog.querySelector("[data-zoom-next]");
  const pointers = new Map();
  const MAX_ZOOM = 5;
  let current = 0;
  let scale = 1;
  let offsetX = 0, offsetY = 0;
  let fittedWidth = 0, fittedHeight = 0;
  let opener = null, originalPageOverflow = "";
  let gesture = null, freezeMouseFollow = false;

  function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }
  function bounds() {
    return {
      x: Math.max(0, (fittedWidth * scale - stage.clientWidth) / 2),
      y: Math.max(0, (fittedHeight * scale - stage.clientHeight) / 2)
    };
  }
  function paint({ immediate = false } = {}) {
    const limit = bounds();
    offsetX = clamp(offsetX, -limit.x, limit.x);
    offsetY = clamp(offsetY, -limit.y, limit.y);
    stage.classList.toggle("is-zoomed", scale > 1.001);
    stage.classList.toggle("is-instant", immediate);
    image.style.transform = "translate3d(" + offsetX + "px," + offsetY + "px,0) scale(" + scale + ")";
    resetButton.textContent = Math.round(scale * 100) + "%";
    zoomOutButton.disabled = scale <= 1.001;
    zoomInButton.disabled = scale >= MAX_ZOOM - .001;
    if (image.naturalWidth && fittedWidth) {
      const exceeding = fittedWidth * scale > image.naturalWidth * 1.01 ||
        fittedHeight * scale > image.naturalHeight * 1.01;
      source.textContent = image.naturalWidth + " × " + image.naturalHeight + " px" +
        (scale > 1 && exceeding ? " · " + tr("Source resolution limit", "A forráskép felbontási határa") : "");
    }
  }
  function resizeToFit() {
    if (!dialog.open || !image.naturalWidth || !image.naturalHeight) return;
    const width = stage.clientWidth, height = stage.clientHeight;
    if (width <= 0 || height <= 0) return;
    // Preserve original pixels at 1:1 rather than upscaling a small source.
    const fit = Math.min(width / image.naturalWidth, height / image.naturalHeight, 1);
    fittedWidth = image.naturalWidth * fit;
    fittedHeight = image.naturalHeight * fit;
    image.style.width = fittedWidth + "px";
    image.style.height = fittedHeight + "px";
    paint({ immediate: true });
  }
  function reset() {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
    freezeMouseFollow = false;
    paint({ immediate: true });
  }
  function zoomTo(next, point = null) {
    const target = clamp(next, 1, MAX_ZOOM);
    const oldScale = scale;
    if (Math.abs(target - oldScale) < .001) return;
    const rect = stage.getBoundingClientRect();
    // Keep the point under the cursor/fingers fixed while changing magnification.
    if (point && rect.width && rect.height) {
      const localX = point.x - rect.left - rect.width / 2;
      const localY = point.y - rect.top - rect.height / 2;
      offsetX = localX - (localX - offsetX) * target / oldScale;
      offsetY = localY - (localY - offsetY) * target / oldScale;
    }
    scale = target;
    if (scale === 1) { offsetX = 0; offsetY = 0; }
    freezeMouseFollow = false;
    paint({ immediate: true });
  }
  function followMouse(event) {
    if (event.pointerType !== "mouse" || pointers.size || freezeMouseFollow || scale <= 1 ||
      event.target.closest("button")) return;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const limit = bounds();
    // Move in both axes only if enlarged pixels exist beyond the visible viewport.
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    offsetX = (1 - 2 * x) * limit.x;
    offsetY = (1 - 2 * y) * limit.y;
    paint();
  }
  const chooseButtons = photos.map((photo, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "piano-lightbox__thumb";
    button.setAttribute("aria-label", tr("Show photo", "Fotó megnyitása") + " " + (index + 1));
    const thumb = document.createElement("img");
    thumb.src = photo.url;
    thumb.alt = "";
    thumb.loading = "lazy";
    thumb.decoding = "async";
    button.appendChild(thumb);
    button.addEventListener("click", () => choose(index));
    strip.appendChild(button);
    return button;
  });
  if (photos.length <= 1) strip.hidden = true;

  function choose(index) {
    current = (index + photos.length) % photos.length;
    pointers.clear();
    gesture = null;
    freezeMouseFollow = false;
    stage.classList.remove("is-panning");
    fittedWidth = 0;
    fittedHeight = 0;
    image.style.width = "";
    image.style.height = "";
    image.style.transform = "";
    image.alt = photos[current].alt;
    image.src = photos[current].url; // CMS original file, never a downscaled preview.
    caption.textContent = photos[current].alt;
    source.textContent = tr("Loading original photo…", "Eredeti kép betöltése…");
    counter.textContent = (current + 1) + " / " + photos.length;
    previousButton.disabled = photos.length < 2;
    nextButton.disabled = photos.length < 2;
    chooseButtons.forEach((button, i) => {
      button.classList.toggle("is-active", i === current);
      if (i === current) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
    scale = 1;
    offsetX = 0;
    offsetY = 0;
    paint({ immediate: true });
    if (image.complete && image.naturalWidth) resizeToFit();
    if (photos.length > 1) {
      // Preload only adjacent originals to keep page bandwidth bounded.
      for (const next of new Set([(current + 1) % photos.length, (current + photos.length - 1) % photos.length])) {
        if (next !== current) {
          const preload = new Image();
          preload.decoding = "async";
          preload.src = photos[next].url;
          // Browser cache retains the original without generating a resized copy.
        }
      }
    }
  }
  function open(index, element) {
    opener = element;
    originalPageOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    choose(index);
    dialog.querySelector("[data-zoom-close]").focus();
  }
  image.addEventListener("load", resizeToFit);
  image.addEventListener("error", () => {
    source.textContent = tr("Original image unavailable", "Az eredeti kép nem érhető el");
  });
  if (typeof ResizeObserver === "function") new ResizeObserver(resizeToFit).observe(stage);
  else window.addEventListener("resize", resizeToFit);
  window.visualViewport?.addEventListener("resize", resizeToFit);

  const hoverAvailable = window.matchMedia("(hover: hover) and (pointer: fine)");
  for (const trigger of triggers) {
    trigger.addEventListener("pointermove", (event) => {
      if (!hoverAvailable.matches || event.pointerType !== "mouse") return;
      const rect = trigger.getBoundingClientRect();
      trigger.style.setProperty("--gallery-hover-x", clamp((event.clientX - rect.left) / rect.width, 0, 1) * 100 + "%");
      trigger.style.setProperty("--gallery-hover-y", clamp((event.clientY - rect.top) / rect.height, 0, 1) * 100 + "%");
    });
    trigger.addEventListener("pointerleave", () => {
      trigger.style.removeProperty("--gallery-hover-x");
      trigger.style.removeProperty("--gallery-hover-y");
    });
    trigger.addEventListener("click", () => {
      const full = trigger.dataset.galleryFull || trigger.querySelector("img")?.getAttribute("data-original") ||
        trigger.querySelector("img")?.getAttribute("src");
      const index = photos.findIndex((photo) => photo.url === full);
      open(Math.max(index, 0), trigger);
    });
  }

  dialog.querySelector("[data-zoom-close]").addEventListener("click", () => dialog.close());
  zoomInButton.addEventListener("click", () => zoomTo(scale + .5));
  zoomOutButton.addEventListener("click", () => zoomTo(scale - .5));
  resetButton.addEventListener("click", reset);
  previousButton.addEventListener("click", () => choose(current - 1));
  nextButton.addEventListener("click", () => choose(current + 1));
  dialog.addEventListener("close", () => {
    pointers.clear();
    gesture = null;
    stage.classList.remove("is-panning");
    document.documentElement.style.overflow = originalPageOverflow;
    opener?.focus();
  });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); choose(current - 1); }
    if (event.key === "ArrowRight") { event.preventDefault(); choose(current + 1); }
    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomTo(scale + .5); }
    if (event.key === "-") { event.preventDefault(); zoomTo(scale - .5); }
    if (event.key === "0") { event.preventDefault(); reset(); }
  });
  stage.addEventListener("wheel", (event) => {
    if (!dialog.open) return;
    event.preventDefault();
    zoomTo(scale * (event.deltaY < 0 ? 1.16 : .87), { x: event.clientX, y: event.clientY });
  }, { passive: false });
  stage.addEventListener("dblclick", (event) => {
    if (event.target.closest("button")) return;
    zoomTo(scale > 1 ? 1 : 2, { x: event.clientX, y: event.clientY });
  });
  stage.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") freezeMouseFollow = false;
  });
  stage.addEventListener("pointerleave", () => {
    if (!pointers.size) freezeMouseFollow = false;
  });
  function centerOfPointers() {
    const values = [...pointers.values()];
    return {
      x: values.reduce((sum, pointer) => sum + pointer.x, 0) / values.length,
      y: values.reduce((sum, pointer) => sum + pointer.y, 0) / values.length
    };
  }
  function distanceOfPointers() {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
  stage.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button") || (event.pointerType === "mouse" && event.button !== 0)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    stage.setPointerCapture?.(event.pointerId);
    if (pointers.size >= 2) {
      gesture = { kind: "pinch", startDistance: distanceOfPointers(),
        startScale: scale, startCenter: centerOfPointers(), startX: offsetX, startY: offsetY };
    } else {
      gesture = { kind: "drag", startX: event.clientX, startY: event.clientY,
        startOffsetX: offsetX, startOffsetY: offsetY, moved: false };
    }
    stage.classList.add("is-panning");
  });
  stage.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) { followMouse(event); return; }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    if (pointers.size >= 2 && gesture?.kind === "pinch" && gesture.startDistance > 0) {
      const next = clamp(gesture.startScale * distanceOfPointers() / gesture.startDistance, 1, MAX_ZOOM);
      const start = gesture.startCenter, now = centerOfPointers();
      const rect = stage.getBoundingClientRect();
      const x0 = start.x - rect.left - rect.width / 2;
      const y0 = start.y - rect.top - rect.height / 2;
      const x1 = now.x - rect.left - rect.width / 2;
      const y1 = now.y - rect.top - rect.height / 2;
      scale = next;
      offsetX = x1 - (x0 - gesture.startX) * next / gesture.startScale;
      offsetY = y1 - (y0 - gesture.startY) * next / gesture.startScale;
      paint({ immediate: true });
    } else if (gesture?.kind === "drag") {
      const distanceX = event.clientX - gesture.startX;
      const distanceY = event.clientY - gesture.startY;
      if (Math.abs(distanceX) > 5 || Math.abs(distanceY) > 5) gesture.moved = true;
      if (scale > 1) {
        offsetX = gesture.startOffsetX + distanceX;
        offsetY = gesture.startOffsetY + distanceY;
        paint({ immediate: true });
      }
    }
  });
  function pointerFinished(event, canceled = false) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    const swipe = !canceled && gesture?.kind === "drag" && scale <= 1.001 &&
      Math.abs(event.clientX - gesture.startX) > 60 &&
      Math.abs(event.clientX - gesture.startX) > Math.abs(event.clientY - gesture.startY) * 1.3;
    if (!pointers.size) {
      const direction = gesture?.kind === "drag" && event.clientX < gesture.startX ? 1 : -1;
      freezeMouseFollow = Boolean(gesture?.kind === "drag" && gesture.moved && scale > 1);
      stage.classList.remove("is-panning");
      gesture = null;
      if (swipe) choose(current + direction);
    } else if (pointers.size === 1) {
      const single = [...pointers.values()][0];
      gesture = { kind: "drag", startX: single.x, startY: single.y,
        startOffsetX: offsetX, startOffsetY: offsetY, moved: false };
    }
  }
  stage.addEventListener("pointerup", (event) => pointerFinished(event));
  stage.addEventListener("pointercancel", (event) => pointerFinished(event, true));
})();
