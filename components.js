import {
  Camera,
  Mesh,
  Program,
  Renderer,
  Transform,
  Triangle,
  Vec3,
} from "https://esm.sh/ogl@1.0.11";
import { gsap } from "https://esm.sh/gsap@3.13.0";
import {
  Clock,
  Mesh as ThreeMesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "https://esm.sh/three@0.165.0";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isCoarsePointer = window.matchMedia("(hover: none), (pointer: coarse)").matches;

function parseHexColor(hex) {
  const fallback = "#ffffff";
  const color = /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback;
  const c = color.replace("#", "");
  return [
    parseInt(c.substring(0, 2), 16) / 255,
    parseInt(c.substring(2, 4), 16) / 255,
    parseInt(c.substring(4, 6), 16) / 255,
  ];
}

function fract(x) {
  return x - Math.floor(x);
}

function hash31(p) {
  const r = [p * 0.1031, p * 0.103, p * 0.0973].map(fract);
  const rYzx = [r[1], r[2], r[0]];
  const dotVal =
    r[0] * (rYzx[0] + 33.33) +
    r[1] * (rYzx[1] + 33.33) +
    r[2] * (rYzx[2] + 33.33);

  for (let i = 0; i < 3; i += 1) {
    r[i] = fract(r[i] + dotVal);
  }

  return r;
}

function hash33(v) {
  const p = [v[0] * 0.1031, v[1] * 0.103, v[2] * 0.0973].map(fract);
  const pYxz = [p[1], p[0], p[2]];
  const dotVal =
    p[0] * (pYxz[0] + 33.33) +
    p[1] * (pYxz[1] + 33.33) +
    p[2] * (pYxz[2] + 33.33);

  for (let i = 0; i < 3; i += 1) {
    p[i] = fract(p[i] + dotVal);
  }

  const pXxy = [p[0], p[0], p[1]];
  const pYxx = [p[1], p[0], p[0]];
  const pZyx = [p[2], p[1], p[0]];

  return pXxy.map((value, i) => fract((value + pYxx[i]) * pZyx[i]));
}

const metaballsVertex = `#version 300 es
precision highp float;
layout(location = 0) in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const metaballsFragment = `#version 300 es
precision highp float;
uniform vec3 iResolution;
uniform float iTime;
uniform vec3 iMouse;
uniform vec3 iColor;
uniform vec3 iCursorColor;
uniform float iAnimationSize;
uniform int iBallCount;
uniform float iCursorBallSize;
uniform vec3 iMetaBalls[50];
uniform float iClumpFactor;
uniform bool enableTransparency;
out vec4 outColor;

float getMetaBallValue(vec2 c, float r, vec2 p) {
  vec2 d = p - c;
  float dist2 = max(dot(d, d), 0.0001);
  return (r * r) / dist2;
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  float scale = iAnimationSize / iResolution.y;
  vec2 coord = (fc - iResolution.xy * 0.5) * scale;
  vec2 mouseW = (iMouse.xy - iResolution.xy * 0.5) * scale;
  float m1 = 0.0;

  for (int i = 0; i < 50; i++) {
    if (i >= iBallCount) break;
    m1 += getMetaBallValue(iMetaBalls[i].xy, iMetaBalls[i].z, coord);
  }

  float m2 = getMetaBallValue(mouseW, iCursorBallSize, coord);
  float total = m1 + m2;
  float f = smoothstep(-1.0, 1.0, (total - 1.3) / min(1.0, fwidth(total)));
  vec3 cFinal = vec3(0.0);

  if (total > 0.0) {
    float alpha1 = m1 / total;
    float alpha2 = m2 / total;
    cFinal = iColor * alpha1 + iCursorColor * alpha2;
  }

  outColor = vec4(cFinal * f, enableTransparency ? f : 1.0);
}
`;

class MetaBalls {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      color: options.color || "#ffffff",
      cursorBallColor: options.cursorBallColor || "#ffffff",
      cursorBallSize: Number(options.cursorBallSize || 3),
      ballCount: clamp(Number(options.ballCount || 15), 1, 50),
      animationSize: Number(options.animationSize || 30),
      enableMouseInteraction: options.enableMouseInteraction !== false,
      enableTransparency: options.enableTransparency !== false,
      hoverSmoothness: Number(options.hoverSmoothness || 0.05),
      clumpFactor: Number(options.clumpFactor || 1),
      speed: Number(options.speed || 0.3),
    };

    this.mouseBallPos = { x: 0, y: 0 };
    this.pointerInside = false;
    this.pointerX = 0;
    this.pointerY = 0;
    this.init();
  }

  init() {
    const dpr = 1;
    this.renderer = new Renderer({ dpr, alpha: true, premultipliedAlpha: false });
    this.gl = this.renderer.gl;
    this.gl.clearColor(0, 0, 0, this.options.enableTransparency ? 0 : 1);
    this.container.appendChild(this.gl.canvas);

    this.camera = new Camera(this.gl, {
      left: -1,
      right: 1,
      top: 1,
      bottom: -1,
      near: 0.1,
      far: 10,
    });
    this.camera.position.z = 1;

    const [r1, g1, b1] = parseHexColor(this.options.color);
    const [r2, g2, b2] = parseHexColor(this.options.cursorBallColor);

    this.metaBallsUniform = Array.from({ length: 50 }, () => new Vec3(0, 0, 0));
    this.program = new Program(this.gl, {
      vertex: metaballsVertex,
      fragment: metaballsFragment,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Vec3(0, 0, 0) },
        iMouse: { value: new Vec3(0, 0, 0) },
        iColor: { value: new Vec3(r1, g1, b1) },
        iCursorColor: { value: new Vec3(r2, g2, b2) },
        iAnimationSize: { value: this.options.animationSize },
        iBallCount: { value: this.options.ballCount },
        iCursorBallSize: { value: this.options.cursorBallSize },
        iMetaBalls: { value: this.metaBallsUniform },
        iClumpFactor: { value: this.options.clumpFactor },
        enableTransparency: { value: this.options.enableTransparency },
      },
    });

    this.scene = new Transform();
    this.mesh = new Mesh(this.gl, {
      geometry: new Triangle(this.gl),
      program: this.program,
    });
    this.mesh.setParent(this.scene);

    this.ballParams = Array.from({ length: this.options.ballCount }, (_, i) => {
      const h1 = hash31(i + 1);
      const h2 = hash33(h1);
      return {
        st: h1[0] * Math.PI * 2,
        dtFactor: 0.1 * Math.PI + h1[1] * (0.4 * Math.PI - 0.1 * Math.PI),
        baseScale: 5 + h1[1] * 10,
        toggle: Math.floor(h2[0] * 2),
        radius: 0.5 + h2[2] * 1.5,
      };
    });

    this.onResize = this.resize.bind(this);
    this.onPointerMove = this.pointerMove.bind(this);
    this.onPointerEnter = () => {
      if (this.options.enableMouseInteraction) this.pointerInside = true;
    };
    this.onPointerLeave = () => {
      if (this.options.enableMouseInteraction) this.pointerInside = false;
    };

    window.addEventListener("resize", this.onResize);
    this.container.addEventListener("pointermove", this.onPointerMove);
    this.container.addEventListener("pointerenter", this.onPointerEnter);
    this.container.addEventListener("pointerleave", this.onPointerLeave);

    this.running = true;
    this.visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        this.running = entry.isIntersecting;
      },
      { rootMargin: "240px" },
    );
    this.visibilityObserver.observe(this.container);

    this.resize();
    this.startTime = performance.now();
    this.raf = requestAnimationFrame(this.update.bind(this));
  }

  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;

    this.renderer.setSize(width, height);
    this.gl.canvas.style.width = `${width}px`;
    this.gl.canvas.style.height = `${height}px`;
    this.program.uniforms.iResolution.value.set(this.gl.canvas.width, this.gl.canvas.height, 0);
  }

  pointerMove(event) {
    if (!this.options.enableMouseInteraction) return;

    const rect = this.container.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    this.pointerX = (px / rect.width) * this.gl.canvas.width;
    this.pointerY = (1 - py / rect.height) * this.gl.canvas.height;
  }

  update(now) {
    this.raf = requestAnimationFrame(this.update.bind(this));
    if (!this.running || document.hidden) return;
    const elapsed = (now - this.startTime) * 0.001;
    this.program.uniforms.iTime.value = elapsed;

    this.ballParams.forEach((p, i) => {
      const dt = elapsed * this.options.speed * p.dtFactor;
      const th = p.st + dt;
      this.metaBallsUniform[i].set(
        Math.cos(th) * p.baseScale * this.options.clumpFactor,
        Math.sin(th + dt * p.toggle) * p.baseScale * this.options.clumpFactor,
        p.radius,
      );
    });

    const cx = this.gl.canvas.width * 0.5;
    const cy = this.gl.canvas.height * 0.5;
    const targetX = this.pointerInside
      ? this.pointerX
      : cx + Math.cos(elapsed * this.options.speed) * this.gl.canvas.width * 0.15;
    const targetY = this.pointerInside
      ? this.pointerY
      : cy + Math.sin(elapsed * this.options.speed) * this.gl.canvas.height * 0.15;

    this.mouseBallPos.x += (targetX - this.mouseBallPos.x) * this.options.hoverSmoothness;
    this.mouseBallPos.y += (targetY - this.mouseBallPos.y) * this.options.hoverSmoothness;
    this.program.uniforms.iMouse.value.set(this.mouseBallPos.x, this.mouseBallPos.y, 0);
    this.renderer.render({ scene: this.scene, camera: this.camera });
  }
}

function initPillNav() {
  const root = document.querySelector("[data-pill-nav]");
  if (!root) return;

  const circles = Array.from(root.querySelectorAll(".hover-circle"));
  const timelines = [];
  const activeTweens = [];
  const ease = "power3.out";
  const logo = root.querySelector(".pill-logo");
  const logoMark = logo?.querySelector("span");
  const mobileButton = root.querySelector(".mobile-menu-button");
  const mobileMenu = root.querySelector(".mobile-menu-popover");
  const mobileLinks = Array.from(root.querySelectorAll(".mobile-menu-link"));
  let mobileOpen = false;

  const layout = () => {
    circles.forEach((circle, index) => {
      const pill = circle.parentElement;
      if (!pill) return;

      const { width: w, height: h } = pill.getBoundingClientRect();
      const radius = ((w * w) / 4 + h * h) / (2 * h);
      const diameter = Math.ceil(2 * radius) + 2;
      const delta = Math.ceil(radius - Math.sqrt(Math.max(0, radius * radius - (w * w) / 4))) + 1;
      const originY = diameter - delta;
      const label = pill.querySelector(".pill-label");
      const hover = pill.querySelector(".pill-label-hover");

      circle.style.width = `${diameter}px`;
      circle.style.height = `${diameter}px`;
      circle.style.bottom = `-${delta}px`;

      gsap.set(circle, {
        xPercent: -50,
        scale: 0,
        transformOrigin: `50% ${originY}px`,
      });
      gsap.set(label, { y: 0 });
      gsap.set(hover, { y: Math.ceil(h + 100), opacity: 0 });

      timelines[index]?.kill();
      const timeline = gsap.timeline({ paused: true });
      timeline.to(circle, { scale: 1.18, xPercent: -50, duration: 2, ease, overwrite: "auto" }, 0);
      timeline.to(label, { y: -(h + 8), duration: 2, ease, overwrite: "auto" }, 0);
      timeline.to(hover, { y: 0, opacity: 1, duration: 2, ease, overwrite: "auto" }, 0);
      timelines[index] = timeline;
    });
  };

  circles.forEach((circle, index) => {
    const pill = circle.parentElement;
    pill.addEventListener("mouseenter", () => {
      activeTweens[index]?.kill();
      activeTweens[index] = timelines[index]?.tweenTo(timelines[index].duration(), {
        duration: 0.3,
        ease,
        overwrite: "auto",
      });
    });
    pill.addEventListener("mouseleave", () => {
      activeTweens[index]?.kill();
      activeTweens[index] = timelines[index]?.tweenTo(0, {
        duration: 0.2,
        ease,
        overwrite: "auto",
      });
    });
  });

  logo?.addEventListener("mouseenter", () => {
    gsap.fromTo(logoMark, { rotate: 0 }, { rotate: 360, duration: 0.26, ease, overwrite: "auto" });
  });

  const setMobileOpen = (nextState) => {
    mobileOpen = nextState;
    mobileButton?.setAttribute("aria-expanded", String(mobileOpen));
    mobileMenu?.setAttribute("aria-hidden", String(!mobileOpen));

    const lines = mobileButton?.querySelectorAll(".hamburger-line") || [];
    if (lines.length === 2) {
      gsap.to(lines[0], { rotation: mobileOpen ? 45 : 0, y: mobileOpen ? 3 : 0, duration: 0.25, ease });
      gsap.to(lines[1], { rotation: mobileOpen ? -45 : 0, y: mobileOpen ? -3 : 0, duration: 0.25, ease });
    }

    if (!mobileMenu) return;

    if (mobileOpen) {
      gsap.set(mobileMenu, { visibility: "visible" });
      gsap.fromTo(mobileMenu, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.28, ease });
    } else {
      gsap.to(mobileMenu, {
        opacity: 0,
        y: 10,
        duration: 0.2,
        ease,
        onComplete: () => gsap.set(mobileMenu, { visibility: "hidden" }),
      });
    }
  };

  mobileButton?.addEventListener("click", () => setMobileOpen(!mobileOpen));
  mobileLinks.forEach((link) => link.addEventListener("click", () => setMobileOpen(false)));
  window.addEventListener("resize", () => {
    layout();
    if (window.innerWidth > 768) setMobileOpen(false);
  });

  gsap.fromTo(
    root.querySelector(".pill-nav-items"),
    { opacity: 0, y: -8 },
    { opacity: 1, y: 0, duration: 0.55, ease },
  );
  gsap.fromTo(logo, { scale: 0 }, { scale: 1, duration: 0.55, ease });
  gsap.set(mobileMenu, { visibility: "hidden", opacity: 0 });
  layout();
  document.fonts?.ready?.then(layout).catch(() => {});
}

function getFontSize(font) {
  const match = font.match(/(\d+)px/);
  return match ? parseInt(match[1], 10) : 30;
}



function datasetOptions(element) {
  return Object.fromEntries(
    Object.entries(element.dataset).map(([key, value]) => {
      if (value === "true") return [key, true];
      if (value === "false") return [key, false];
      if (value !== "" && !Number.isNaN(Number(value))) return [key, Number(value)];
      return [key, value];
    }),
  );
}

function initTiltedCards() {
  if (prefersReducedMotion) return;

  document.querySelectorAll("[data-tilted-card]").forEach((card) => {
    const image = card.querySelector(".portrait-img");
    const caption = card.querySelector(".tilted-card-caption");
    const rotateAmplitude = Number(card.dataset.rotateAmplitude || 12);
    const scaleOnHover = Number(card.dataset.scaleOnHover || 1.08);
    let lastY = 0;
    let current = { rx: 0, ry: 0, scale: 1, captionRotate: 0 };
    let target = { rx: 0, ry: 0, scale: 1, captionRotate: 0 };
    let mouse = { x: 0, y: 0 };
    let active = false;
    let raf = 0;

    const animate = () => {
      current.rx += (target.rx - current.rx) * 0.12;
      current.ry += (target.ry - current.ry) * 0.12;
      current.scale += (target.scale - current.scale) * 0.12;
      current.captionRotate += (target.captionRotate - current.captionRotate) * 0.16;
      card.style.setProperty("--tilt-rx", `${current.rx.toFixed(2)}deg`);
      card.style.setProperty("--tilt-ry", `${current.ry.toFixed(2)}deg`);
      card.style.setProperty("--tilt-scale", current.scale.toFixed(3));

      if (caption) {
        caption.style.left = `${mouse.x}px`;
        caption.style.top = `${mouse.y}px`;
        caption.style.opacity = active ? "1" : "0";
        caption.style.transform = `translate(14px, 14px) rotate(${current.captionRotate.toFixed(2)}deg)`;
      }

      raf = requestAnimationFrame(animate);
    };

    card.addEventListener("pointermove", (event) => {
      const rect = card.getBoundingClientRect();
      const offsetX = event.clientX - rect.left - rect.width / 2;
      const offsetY = event.clientY - rect.top - rect.height / 2;
      mouse = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      target.rx = (offsetY / (rect.height / 2)) * -rotateAmplitude;
      target.ry = (offsetX / (rect.width / 2)) * rotateAmplitude;
      target.captionRotate = -(offsetY - lastY) * 0.35;
      lastY = offsetY;
      image?.style.setProperty("--tilt-img-x", `${(-offsetX * 0.012).toFixed(2)}px`);
      image?.style.setProperty("--tilt-img-y", `${(-offsetY * 0.012).toFixed(2)}px`);
    });

    card.addEventListener("pointerenter", () => {
      active = true;
      target.scale = scaleOnHover;
      if (!raf) animate();
    });

    card.addEventListener("pointerleave", () => {
      active = false;
      target = { rx: 0, ry: 0, scale: 1, captionRotate: 0 };
      image?.style.setProperty("--tilt-img-x", "0px");
      image?.style.setProperty("--tilt-img-y", "0px");
    });
  });
}

const floatingLinesVertex = `
precision highp float;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const floatingLinesFragment = `
precision highp float;
uniform float iTime;
uniform vec3 iResolution;
uniform vec2 iMouse;
uniform float bendInfluence;
uniform vec2 parallaxOffset;
uniform vec3 lineGradient[3];

mat2 rotate(float r) {
  return mat2(cos(r), sin(r), -sin(r), cos(r));
}

float wave(vec2 uv, float offset, vec2 screenUv, vec2 mouseUv, float strength) {
  float y = sin(uv.x + offset + iTime * 0.08) * (0.12 + sin(offset + iTime * 0.18) * 0.08);
  vec2 d = screenUv - mouseUv;
  y += (mouseUv.y - screenUv.y) * exp(-dot(d, d) * 4.6) * strength * bendInfluence;
  return 0.012 / max(abs(uv.y - y) + 0.012, 0.001);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - iResolution.xy) / iResolution.y;
  uv.y *= -1.0;
  uv += parallaxOffset;
  vec2 mouseUv = (2.0 * iMouse - iResolution.xy) / iResolution.y;
  mouseUv.y *= -1.0;
  vec3 col = vec3(0.0);

  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    vec2 ruv = uv * rotate(-0.18 * log(length(uv) + 1.0));
    col += lineGradient[0] * wave(ruv + vec2(0.09 * fi + 0.2, -0.65), 1.2 + fi * 0.17, uv, mouseUv, -0.45) * 0.12;
  }

  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    vec2 ruv = uv * rotate(0.14 * log(length(uv) + 1.0));
    col += lineGradient[1] * wave(ruv + vec2(0.08 * fi + 4.8, 0.0), 2.0 + fi * 0.14, uv, mouseUv, -0.32) * 0.18;
  }

  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    vec2 ruv = uv * rotate(-0.3 * log(length(uv) + 1.0));
    ruv.x *= -1.0;
    col += lineGradient[2] * wave(ruv + vec2(0.12 * fi + 9.0, 0.58), 1.0 + fi * 0.2, uv, mouseUv, -0.22) * 0.08;
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

function initFloatingLines() {
  const container = document.querySelector("[data-floating-lines]");
  if (!container || prefersReducedMotion || isCoarsePointer) return;

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const renderer = new WebGLRenderer({ antialias: false, alpha: true, powerPreference: "low-power" });
  const clock = new Clock();
  const targetMouse = new Vector2(-1000, -1000);
  const currentMouse = new Vector2(-1000, -1000);
  const targetParallax = new Vector2(0, 0);
  const currentParallax = new Vector2(0, 0);
  let targetInfluence = 0;
  let currentInfluence = 0;

  renderer.setPixelRatio(1);
  renderer.domElement.style.mixBlendMode = "screen";
  container.appendChild(renderer.domElement);

  const uniforms = {
    iTime: { value: 0 },
    iResolution: { value: new Vector3(1, 1, 1) },
    iMouse: { value: currentMouse },
    bendInfluence: { value: 0 },
    parallaxOffset: { value: currentParallax },
    lineGradient: {
      value: [new Vector3(0.78, 0.94, 0.38), new Vector3(0.93, 0.9, 0.84), new Vector3(0.34, 0.42, 0.25)],
    },
  };

  const material = new ShaderMaterial({ uniforms, vertexShader: floatingLinesVertex, fragmentShader: floatingLinesFragment, transparent: true });
  const geometry = new PlaneGeometry(2, 2);
  scene.add(new ThreeMesh(geometry, material));

  const resize = () => {
    const width = window.innerWidth || 1;
    const height = window.innerHeight || 1;
    renderer.setSize(width, height, false);
    uniforms.iResolution.value.set(renderer.domElement.width, renderer.domElement.height, 1);
  };

  const pointerMove = (event) => {
    const dpr = renderer.getPixelRatio();
    targetMouse.set(event.clientX * dpr, (window.innerHeight - event.clientY) * dpr);
    targetInfluence = 1;
    targetParallax.set((event.clientX / window.innerWidth - 0.5) * 0.08, -(event.clientY / window.innerHeight - 0.5) * 0.08);
  };

  const render = () => {
    if (document.hidden) {
      requestAnimationFrame(render);
      return;
    }

    uniforms.iTime.value = clock.getElapsedTime();
    currentMouse.lerp(targetMouse, 0.045);
    currentParallax.lerp(targetParallax, 0.035);
    currentInfluence += (targetInfluence - currentInfluence) * 0.045;
    uniforms.bendInfluence.value = currentInfluence;
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  };

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", pointerMove, { passive: true });
  window.addEventListener("pointerleave", () => {
    targetInfluence = 0;
  });
  render();
}

function initTextPressure() {
  document.querySelectorAll("[data-text-pressure]").forEach((container) => {
    const text = container.dataset.text || "Applied Vision";
    const minFontSize = Number(container.dataset.minFontSize || 24);
    const chars = text.split("");
    const title = document.createElement("h2");
    title.className = "text-pressure-title";
    title.style.color = container.dataset.textColor || "#ffffff";
    title.innerHTML = chars.map((char) => `<span data-char="${char}">${char === " " ? "&nbsp;" : char}</span>`).join("");
    container.appendChild(title);

    const spans = Array.from(title.querySelectorAll("span"));
    const cursor = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const mouse = { ...cursor };
    let charCenters = [];
    let maxDist = 1;

    const setSize = () => {
      const width = container.getBoundingClientRect().width;
      title.style.fontSize = `${Math.max(width / (chars.length / 1.8), minFontSize)}px`;
    };

    const measure = () => {
      const titleRect = title.getBoundingClientRect();
      maxDist = Math.max(titleRect.width / 2, 1);
      charCenters = spans.map((span) => {
        const rect = span.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
    };

    let scrollPending = false;
    const scheduleMeasure = () => {
      if (scrollPending) return;
      scrollPending = true;
      requestAnimationFrame(() => {
        measure();
        scrollPending = false;
      });
    };

    const animate = () => {
      mouse.x += (cursor.x - mouse.x) / 15;
      mouse.y += (cursor.y - mouse.y) / 15;

      spans.forEach((span, i) => {
        const center = charCenters[i] || { x: 0, y: 0 };
        const dx = mouse.x - center.x;
        const dy = mouse.y - center.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const force = clamp(1 - distance / maxDist, 0, 1);
        const weight = Math.round(160 + force * 720);
        const width = Math.round(70 + force * 90);
        const italic = (force * 0.85).toFixed(2);
        span.style.fontVariationSettings = `'wght' ${weight}, 'wdth' ${width}, 'ital' ${italic}`;
        span.style.opacity = String(0.42 + force * 0.58);
      });

      if (!prefersReducedMotion) requestAnimationFrame(animate);
    };

    window.addEventListener("pointermove", (event) => {
      cursor.x = event.clientX;
      cursor.y = event.clientY;
    }, { passive: true });
    window.addEventListener("resize", debounce(() => { setSize(); measure(); }, 100));
    window.addEventListener("scroll", scheduleMeasure, { passive: true });
    document.fonts?.ready?.then(() => { setSize(); measure(); }).catch(() => {});
    setSize();
    measure();
    animate();
  });
}

function initVisualComponents() {
  const guard = (label, fn) => {
    try {
      fn();
    } catch (error) {
      console.warn(`[${label}] skipped`, error);
    }
  };

  guard("floating-lines", initFloatingLines);
  guard("tilted-cards", initTiltedCards);
  guard("text-pressure", initTextPressure);
  guard("pill-nav", initPillNav);

  document.querySelectorAll("[data-metaballs]").forEach((element) => {
    if (prefersReducedMotion || isCoarsePointer) return;
    guard("metaballs", () => new MetaBalls(element, datasetOptions(element)));
  });
}

initVisualComponents();
