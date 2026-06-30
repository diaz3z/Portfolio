(() => {
  const root = document.documentElement;
  const body = document.body;
  const nav = document.getElementById("site-nav");
  const progressBar = document.getElementById("scroll-progress");
  const navToggle = document.querySelector(".nav-toggle");
  const mobileMenu = document.getElementById("mobile-menu");
  const mobileMenuLinks = mobileMenu
    ? mobileMenu.querySelectorAll(".mobile-menu-link")
    : [];
  const reveals = document.querySelectorAll(".reveal");
  const statNumbers = document.querySelectorAll(".stat-num");
  const isTouch = window.matchMedia("(hover: none), (pointer: coarse)").matches;
  const prefersReduced = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  const updateNavAndProgress = () => {
    if (nav) {
      nav.classList.toggle("scrolled", window.scrollY > 24);
    }

    if (!progressBar) {
      return;
    }

    const scrollableHeight =
      document.documentElement.scrollHeight - window.innerHeight;
    const progress =
      scrollableHeight <= 0
        ? 100
        : (window.scrollY / scrollableHeight) * 100;

    progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
  };

  updateNavAndProgress();
  window.addEventListener("scroll", updateNavAndProgress, { passive: true });
  window.addEventListener("resize", updateNavAndProgress);

  const closeMobileMenu = () => {
    if (!navToggle || !mobileMenu) {
      return;
    }

    navToggle.classList.remove("active");
    navToggle.setAttribute("aria-expanded", "false");
    mobileMenu.classList.remove("open");
    mobileMenu.setAttribute("aria-hidden", "true");
  };

  if (navToggle && mobileMenu) {
    navToggle.addEventListener("click", () => {
      const isOpen = navToggle.classList.toggle("active");
      navToggle.setAttribute("aria-expanded", String(isOpen));
      mobileMenu.classList.toggle("open", isOpen);
      mobileMenu.setAttribute("aria-hidden", String(!isOpen));
    });

    mobileMenuLinks.forEach((link) => {
      link.addEventListener("click", closeMobileMenu);
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 768) {
        closeMobileMenu();
      }
    });
  }

  if (reveals.length) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -32px 0px" },
    );

    reveals.forEach((element) => revealObserver.observe(element));
  }

  const easeOutCubic = (progress) => 1 - Math.pow(1 - progress, 3);

  const animateStat = (element) => {
    if (element.dataset.counted === "true") {
      return;
    }

    const numberNode = Array.from(element.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
    );

    if (!numberNode) {
      element.dataset.counted = "true";
      return;
    }

    const finalValue = parseInt(numberNode.textContent.trim(), 10);

    if (Number.isNaN(finalValue)) {
      element.dataset.counted = "true";
      return;
    }

    element.dataset.counted = "true";

    if (prefersReduced) {
      numberNode.textContent = String(finalValue);
      return;
    }

    const duration = 1400;
    const start = performance.now();

    const step = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      const currentValue = Math.round(finalValue * eased);

      numberNode.textContent = String(currentValue);

      if (progress < 1) {
        window.requestAnimationFrame(step);
      } else {
        numberNode.textContent = String(finalValue);
      }
    };

    window.requestAnimationFrame(step);
  };

  if (statNumbers.length) {
    if (prefersReduced) {
      statNumbers.forEach((element) => animateStat(element));
    } else {
      const statObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              animateStat(entry.target);
              statObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.5 },
      );

      statNumbers.forEach((element) => statObserver.observe(element));
    }
  }

  if (isTouch) {
    return;
  }

  const dot = document.getElementById("cursor-dot");
  const ring = document.getElementById("cursor-ring");

  if (!dot || !ring) {
    return;
  }

  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;

  const placeDot = (x, y) => {
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
  };

  const placeRing = (x, y) => {
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
  };

  const setMouseGlow = (x, y, opacity = 0.55) => {
    root.style.setProperty("--mouse-x", `${x}px`);
    root.style.setProperty("--mouse-y", `${y}px`);
    root.style.setProperty("--mouse-opacity", `${opacity}`);
  };

  const activateCursor = () => {
    body.classList.add("cursor-active");
  };

  const deactivateCursor = () => {
    body.classList.remove("cursor-active", "cursor-hover", "cursor-click");
    root.style.setProperty("--mouse-opacity", "0.32");
  };

  const handleMouseMove = (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;

    placeDot(mouseX, mouseY);
    setMouseGlow(mouseX, mouseY, 0.58);
    activateCursor();
  };

  const interactiveElements = document.querySelectorAll(
    "a, button, .btn, .contact-item, .nav-cta, .nav-links a, .mobile-menu-link",
  );

  interactiveElements.forEach((element) => {
    element.addEventListener("mouseenter", () =>
      body.classList.add("cursor-hover"),
    );
    element.addEventListener("mouseleave", () =>
      body.classList.remove("cursor-hover"),
    );
  });

  document.addEventListener("mousemove", handleMouseMove, { passive: true });
  window.addEventListener("mousedown", () => body.classList.add("cursor-click"));
  window.addEventListener("mouseup", () => body.classList.remove("cursor-click"));
  document.addEventListener("mouseleave", deactivateCursor);
  window.addEventListener("blur", deactivateCursor);

  placeDot(mouseX, mouseY);
  placeRing(mouseX, mouseY);
  setMouseGlow(mouseX, mouseY, 0.4);

  let ringX = mouseX;
  let ringY = mouseY;

  const animateCursor = () => {
    placeDot(mouseX, mouseY);

    ringX += (mouseX - ringX) * 0.12;
    ringY += (mouseY - ringY) * 0.12;

    placeRing(ringX, ringY);
    window.requestAnimationFrame(animateCursor);
  };

  animateCursor();

  if (prefersReduced) {
    return;
  }

  const tiltTargets = document.querySelectorAll(
    ".value-cell, .service-cell, .project-cell, .about-card, .contact-item, .fit-card, .process-step",
  );

  tiltTargets.forEach((element) => {
    const maxRotate = element.classList.contains("contact-item") ? 4 : 6;

    element.addEventListener("pointermove", (event) => {
      const rect = element.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      const rotateY = ((offsetX / rect.width) - 0.5) * (maxRotate * 2);
      const rotateX = (0.5 - (offsetY / rect.height)) * (maxRotate * 2);

      element.style.setProperty("--tilt-x", `${rotateX.toFixed(2)}deg`);
      element.style.setProperty("--tilt-y", `${rotateY.toFixed(2)}deg`);
      element.style.setProperty("--glow-x", `${offsetX}px`);
      element.style.setProperty("--glow-y", `${offsetY}px`);
      element.style.setProperty("--glow-opacity", "1");
    });

    element.addEventListener("pointerleave", () => {
      element.style.setProperty("--tilt-x", "0deg");
      element.style.setProperty("--tilt-y", "0deg");
      element.style.setProperty("--glow-opacity", "0");
    });
  });

  const magneticTargets = document.querySelectorAll(".btn, .nav-cta");

  magneticTargets.forEach((element) => {
    const strength = element.classList.contains("nav-cta") ? 10 : 14;

    element.addEventListener("pointermove", (event) => {
      const rect = element.getBoundingClientRect();
      const offsetX = event.clientX - (rect.left + rect.width / 2);
      const offsetY = event.clientY - (rect.top + rect.height / 2);
      const moveX = (offsetX / rect.width) * strength;
      const moveY = (offsetY / rect.height) * strength;

      element.style.setProperty("--mag-x", `${moveX.toFixed(2)}px`);
      element.style.setProperty("--mag-y", `${moveY.toFixed(2)}px`);
    });

    element.addEventListener("pointerleave", () => {
      element.style.setProperty("--mag-x", "0px");
      element.style.setProperty("--mag-y", "0px");
    });
  });

  const portraitBlock = document.querySelector(".portrait-block");

  if (portraitBlock) {
    portraitBlock.addEventListener("pointermove", (event) => {
      const rect = portraitBlock.getBoundingClientRect();
      const percentX = ((event.clientX - rect.left) / rect.width) - 0.5;
      const percentY = ((event.clientY - rect.top) / rect.height) - 0.5;
      const imageX = percentX * 18;
      const imageY = percentY * 12;
      const captionX = percentX * 8;
      const captionY = percentY * 4;

      portraitBlock.style.setProperty("--parallax-x", `${imageX.toFixed(2)}px`);
      portraitBlock.style.setProperty("--parallax-y", `${imageY.toFixed(2)}px`);
      portraitBlock.style.setProperty("--caption-x", `${captionX.toFixed(2)}px`);
      portraitBlock.style.setProperty("--caption-y", `${captionY.toFixed(2)}px`);
    });

    portraitBlock.addEventListener("pointerleave", () => {
      portraitBlock.style.setProperty("--parallax-x", "0px");
      portraitBlock.style.setProperty("--parallax-y", "0px");
      portraitBlock.style.setProperty("--caption-x", "0px");
      portraitBlock.style.setProperty("--caption-y", "0px");
    });
  }

  const sections = document.querySelectorAll("section[id]");
  const navSectionLinks = document.querySelectorAll(".nav-links a[href^='#']");

  if (sections.length && navSectionLinks.length) {
    const navSectionMap = new Map(
      Array.from(navSectionLinks).map((link) => [link.getAttribute("href"), link]),
    );

    const setActiveNavLink = (id) => {
      navSectionLinks.forEach((link) => {
        const isActive = link.getAttribute("href") === `#${id}`;
        link.classList.toggle("active", isActive);
        link.classList.toggle("is-active", isActive);
      });

      document.querySelectorAll(".mobile-menu-link[href^='#']").forEach((link) => {
        const isActive = link.getAttribute("href") === `#${id}`;
        link.classList.toggle("active", isActive);
        link.classList.toggle("is-active", isActive);
      });
    };

    const visibleSections = new Map();

    const activeSectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const targetId = entry.target.getAttribute("id");

          if (!targetId || !navSectionMap.has(`#${targetId}`)) {
            return;
          }

          if (entry.isIntersecting) {
            visibleSections.set(targetId, entry.intersectionRatio);
          } else {
            visibleSections.delete(targetId);
          }
        });

        let bestMatchId = "";
        let bestRatio = 0;

        visibleSections.forEach((ratio, id) => {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestMatchId = id;
          }
        });

        if (bestMatchId) {
          setActiveNavLink(bestMatchId);
        }
      },
      { threshold: 0.3 },
    );

    sections.forEach((section) => activeSectionObserver.observe(section));
  }
})();
