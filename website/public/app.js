"use strict";

document.documentElement.classList.remove("no-js");
document.documentElement.classList.add("js");

document.querySelectorAll("[data-current-year]").forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

const header = document.querySelector("[data-site-header]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const navigationPanel = document.querySelector("[data-navigation-panel]");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function setMenuState(open) {
  if (!menuToggle || !navigationPanel) return;
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.setAttribute("aria-label", open ? menuToggle.dataset.closeLabel : menuToggle.dataset.openLabel);
  document.body.classList.toggle("menu-open", open);
  navigationPanel.classList.toggle("is-open", open);
}

if (menuToggle && navigationPanel) {
  menuToggle.addEventListener("click", () => {
    setMenuState(menuToggle.getAttribute("aria-expanded") !== "true");
  });

  navigationPanel.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setMenuState(false));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuToggle.getAttribute("aria-expanded") === "true") {
      setMenuState(false);
      menuToggle.focus();
    }
  });

  window.addEventListener("resize", () => {
    if (window.matchMedia("(min-width: 1081px)").matches) setMenuState(false);
  }, { passive: true });
}

let scrollQueued = false;
let previousScrollY = window.scrollY;
function updateHeader() {
  const currentScrollY = window.scrollY;
  if (header) {
    header.classList.toggle("is-scrolled", currentScrollY > 24);
    const menuOpen = menuToggle?.getAttribute("aria-expanded") === "true";
    const scrollingDown = currentScrollY > previousScrollY + 7;
    const scrollingUp = currentScrollY < previousScrollY - 7;
    if (currentScrollY < 72 || scrollingUp || menuOpen) header.classList.remove("is-hidden");
    else if (scrollingDown && currentScrollY > header.offsetHeight + 24) header.classList.add("is-hidden");
  }
  previousScrollY = currentScrollY;
  scrollQueued = false;
}

window.addEventListener("scroll", () => {
  if (!scrollQueued) {
    scrollQueued = true;
    window.requestAnimationFrame(updateHeader);
  }
}, { passive: true });
updateHeader();

document.querySelectorAll("[data-event-carousel]").forEach((carousel) => {
  const track = carousel.querySelector(".public-event-grid--home");
  const controls = carousel.parentElement?.querySelector(".event-carousel__controls");
  if (!track || !controls) return;
  const move = (direction) => {
    const vertical = window.matchMedia("(max-width: 1100px)").matches;
    track.scrollBy(vertical
      ? { top: direction * Math.max(320, track.clientHeight * 0.85), behavior: reducedMotion ? "auto" : "smooth" }
      : { left: direction * Math.max(280, track.clientWidth * 0.82), behavior: reducedMotion ? "auto" : "smooth" });
  };
  controls.querySelector("[data-event-carousel-previous]")?.addEventListener("click", () => move(-1));
  controls.querySelector("[data-event-carousel-next]")?.addEventListener("click", () => move(1));
});

document.querySelectorAll("[data-ticket-quantity]").forEach((control) => {
  const input = control.querySelector('input[name="quantity"]');
  const output = control.querySelector("[data-ticket-total]");
  if (!input) return;
  const clamp = (value) => Math.max(Number(input.min || 1), Math.min(Number(input.max || Number.MAX_SAFE_INTEGER), Math.trunc(Number(value) || 1)));
  const update = (value) => {
    input.value = String(clamp(value));
    if (output) {
      const amount = Number(control.dataset.unitPrice || 0) * Number(input.value);
      const formatted = new Intl.NumberFormat(control.dataset.locale || "en-US", { style: "currency", currency: control.dataset.currency || "USD" }).format(amount / 100);
      const label = output.querySelector("small")?.textContent || "";
      output.innerHTML = `<small>${label}</small> ${formatted}`;
    }
  };
  control.querySelector("[data-quantity-minus]")?.addEventListener("click", () => update(Number(input.value) - 1));
  control.querySelector("[data-quantity-plus]")?.addEventListener("click", () => update(Number(input.value) + 1));
  input.addEventListener("change", () => update(input.value));
  update(input.value);
});

document.querySelectorAll("[data-review-carousel]").forEach((carousel) => {
  const track = carousel.querySelector(".review-track");
  const cards = [...carousel.querySelectorAll("[data-review-card]")];
  const dots = carousel.querySelector("[data-review-dots]");
  if (!track || !cards.length) return;
  let activeIndex = 0;
  const renderDots = () => {
    if (!dots) return;
    dots.innerHTML = cards.map((_, index) => `<button type="button" aria-label="${index + 1}" aria-current="${index === activeIndex ? "true" : "false"}"></button>`).join("");
    [...dots.children].forEach((dot, index) => dot.addEventListener("click", () => show(index)));
  };
  const show = (index) => {
    activeIndex = (index + cards.length) % cards.length;
    cards[activeIndex].scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", inline: "start", block: "nearest" });
    renderDots();
  };
  carousel.querySelector("[data-review-previous]")?.addEventListener("click", () => show(activeIndex - 1));
  carousel.querySelector("[data-review-next]")?.addEventListener("click", () => show(activeIndex + 1));
  renderDots();
});

const revealElements = document.querySelectorAll("[data-reveal]");

if (reducedMotion || !("IntersectionObserver" in window)) {
  revealElements.forEach((element) => element.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver((entries, activeObserver) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      activeObserver.unobserve(entry.target);
    });
  }, {
    rootMargin: "0px 0px -8%",
    threshold: 0.08
  });

  revealElements.forEach((element) => observer.observe(element));
}
