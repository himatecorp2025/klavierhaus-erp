"use strict";

// Full-resolution image viewer for piano gallery thumbnails and the main piano photograph.
// Desktop: click, arrows, wheel zoom, +/- and drag. Mobile: tap, swipe, pinch and pan.
(() => {
  const thumbnails = [...document.querySelectorAll("[data-gallery-open]")];
  if (!thumbnails.length || typeof HTMLDialogElement === "undefined") return;

  const items = thumbnails.map((element) => {
    const image = element.querySelector("img");
    return { url: image?.currentSrc || image?.src || "", alt: image?.alt || element.getAttribute("aria-label") || "" };
  }).filter((item) => item.url);
  if (!items.length) return;

  const language = document.documentElement.lang.toLowerCase().startsWith("hu") ? "hu" : "en";
  const tr = (en, hu) => language === "hu" ? hu : en;
  const dialog = document.createElement("dialog");
  dialog.className = "piano-lightbox";
  dialog.setAttribute("aria-label", tr("Piano image viewer", "Zongoraképek nagyítója"));
  dialog.innerHTML = '<div class="piano-lightbox__frame">' +
    '<div class="piano-lightbox__bar"><span data-zoom-counter></span><div class="piano-lightbox__actions">' +
    '<button type="button" data-zoom-out aria-label="' + tr("Zoom out", "Kicsinyítés") + '">−</button>' +
    '<button type="button" data-zoom-reset aria-label="' + tr("Fit image", "Teljes kép") + '">1:1</button>' +
    '<button type="button" data-zoom-in aria-label="' + tr("Zoom in", "Nagyítás") + '">+</button>' +
    '<button type="button" data-zoom-close aria-label="' + tr("Close", "Bezárás") + '">×</button>' +
    '</div></div><div class="piano-lightbox__stage" data-zoom-stage>' +
    '<button type="button" class="piano-lightbox__nav piano-lightbox__nav--prev" data-zoom-prev aria-label="' + tr("Previous photo", "Előző kép") + '">‹</button>' +
    '<img class="piano-lightbox__image" data-zoom-image alt="" draggable="false">' +
    '<button type="button" class="piano-lightbox__nav piano-lightbox__nav--next" data-zoom-next aria-label="' + tr("Next photo", "Következő kép") + '">›</button>' +
    '</div><p class="piano-lightbox__caption" data-zoom-caption></p></div>';
  document.body.appendChild(dialog);
  const stage = dialog.querySelector("[data-zoom-stage]");
  const image = dialog.querySelector("[data-zoom-image]");
  const counter = dialog.querySelector("[data-zoom-counter]");
  const caption = dialog.querySelector("[data-zoom-caption]");
  const resetButton = dialog.querySelector("[data-zoom-reset]");
  let current = 0, scale = 1, x = 0, y = 0, opener = null;
  const activePointers = new Map();
  let pointerStart = null, pinchStart = null;

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function applyTransform() {
    const limitX = Math.max(0, stage.clientWidth * (scale - 1) * .5);
    const limitY = Math.max(0, stage.clientHeight * (scale - 1) * .5);
    x = clamp(x, -limitX, limitX);
    y = clamp(y, -limitY, limitY);
    image.style.transform = "translate(" + x + "px," + y + "px) scale(" + scale + ")";
    resetButton.textContent = Math.round(scale * 100) + "%";
  }
  function reset() { scale = 1; x = 0; y = 0; applyTransform(); }
  function select(index) {
    current = (index + items.length) % items.length;
    image.src = items[current].url;
    image.alt = items[current].alt;
    caption.textContent = items[current].alt;
    counter.textContent = (current + 1) + " / " + items.length;
    dialog.querySelector("[data-zoom-prev]").disabled = items.length <= 1;
    dialog.querySelector("[data-zoom-next]").disabled = items.length <= 1;
    activePointers.clear();
    reset();
  }
  function changeZoom(nextScale) { scale = clamp(nextScale, 1, 5); if (scale === 1) { x = 0; y = 0; } applyTransform(); }
  function open(index, element) {
    opener = element;
    select(index);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector("[data-zoom-close]")?.focus();
  }
  thumbnails.forEach((button) => button.addEventListener("click", () => {
    const imageElement = button.querySelector("img");
    const match = items.findIndex((item) => item.url === (imageElement?.currentSrc || imageElement?.src));
    open(Math.max(0, match), button);
  }));
  dialog.querySelector("[data-zoom-close]").addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-zoom-in]").addEventListener("click", () => changeZoom(scale + .5));
  dialog.querySelector("[data-zoom-out]").addEventListener("click", () => changeZoom(scale - .5));
  resetButton.addEventListener("click", reset);
  dialog.querySelector("[data-zoom-prev]").addEventListener("click", () => select(current - 1));
  dialog.querySelector("[data-zoom-next]").addEventListener("click", () => select(current + 1));
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => { activePointers.clear(); image.removeAttribute("src"); opener?.focus(); });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); select(current - 1); }
    if (event.key === "ArrowRight") { event.preventDefault(); select(current + 1); }
    if (event.key === "+" || event.key === "=") { event.preventDefault(); changeZoom(scale + .5); }
    if (event.key === "-") { event.preventDefault(); changeZoom(scale - .5); }
  });
  stage.addEventListener("wheel", (event) => {
    if (!dialog.open) return;
    event.preventDefault();
    changeZoom(scale * (event.deltaY < 0 ? 1.14 : .88));
  }, { passive: false });
  function distance() {
    const pointers = [...activePointers.values()];
    if (pointers.length < 2) return 0;
    return Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
  }
  stage.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stage.setPointerCapture?.(event.pointerId);
    if (activePointers.size >= 2) {
      pinchStart = { distance: distance(), scale };
      pointerStart = null;
    } else {
      pointerStart = { x: event.clientX, y: event.clientY, offsetX: x, offsetY: y };
      stage.classList.add("is-panning");
    }
  });
  stage.addEventListener("pointermove", (event) => {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size >= 2 && pinchStart?.distance) {
      changeZoom(pinchStart.scale * distance() / pinchStart.distance);
    } else if (pointerStart && scale > 1) {
      x = pointerStart.offsetX + event.clientX - pointerStart.x;
      y = pointerStart.offsetY + event.clientY - pointerStart.y;
      applyTransform();
    }
  });
  const finishPointer = (event) => {
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) pinchStart = null;
    if (!activePointers.size) {
      if (pointerStart && scale === 1 && Math.abs(event.clientX - pointerStart.x) > 65) {
        select(current + (event.clientX < pointerStart.x ? 1 : -1));
      }
      pointerStart = null;
      stage.classList.remove("is-panning");
    } else if (activePointers.size === 1) {
      const pointer = [...activePointers.values()][0];
      pointerStart = { ...pointer, offsetX: x, offsetY: y };
    }
  };
  stage.addEventListener("pointerup", finishPointer);
  stage.addEventListener("pointercancel", finishPointer);
  image.addEventListener("error", () => { caption.textContent = tr("This photo could not be loaded.", "A kép nem tölthető be."); });
})();
