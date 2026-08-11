"use strict";

document.documentElement.classList.remove("no-js");
document.documentElement.classList.add("js");

document.querySelectorAll("[data-current-year]").forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

const header = document.querySelector("[data-site-header]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const navigationPanel = document.querySelector("[data-navigation-panel]");

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
function updateHeader() {
  if (header) header.classList.toggle("is-scrolled", window.scrollY > 24);
  scrollQueued = false;
}

window.addEventListener("scroll", () => {
  if (!scrollQueued) {
    scrollQueued = true;
    window.requestAnimationFrame(updateHeader);
  }
}, { passive: true });
updateHeader();

const revealElements = document.querySelectorAll("[data-reveal]");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
