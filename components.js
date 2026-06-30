import {
  Camera,
  Mesh,
  Plane,
  Program,
  Renderer,
  Texture,
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
const lerp = (p1, p2, t) => p1 + (p2 - p1) * t;
const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    if (document.hidden) return;
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

function createTextTexture(gl, text, font = "bold 30px Geist", color = "#ffffff") {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context.font = font;
  const metrics = context.measureText(text);
  const textWidth = Math.ceil(metrics.width);
  const textHeight = Math.ceil(getFontSize(font) * 1.2);
  canvas.width = textWidth + 24;
  canvas.height = textHeight + 24;
  context.font = font;
  context.fillStyle = color;
  context.textBaseline = "middle";
  context.textAlign = "center";
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new Texture(gl, { generateMipmaps: false });
  texture.image = canvas;
  return { texture, width: canvas.width, height: canvas.height };
}

class GalleryTitle {
  constructor({ gl, plane, text, textColor, font }) {
    const { texture, width, height } = createTextTexture(gl, text, font, textColor);
    const geometry = new Plane(gl);
    const program = new Program(gl, {
      vertex: `
        attribute vec3 position;
        attribute vec2 uv;
        uniform mat4 modelViewMatrix;
        uniform mat4 projectionMatrix;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragment: `
        precision highp float;
        uniform sampler2D tMap;
        varying vec2 vUv;
        void main() {
          vec4 color = texture2D(tMap, vUv);
          if (color.a < 0.1) discard;
          gl_FragColor = color;
        }
      `,
      uniforms: { tMap: { value: texture } },
      transparent: true,
    });

    this.mesh = new Mesh(gl, { geometry, program });
    const aspect = width / height;
    const textHeight = plane.scale.y * 0.14;
    this.mesh.scale.set(textHeight * aspect, textHeight, 1);
    this.mesh.position.y = -plane.scale.y * 0.5 - textHeight * 0.58 - 0.05;
    this.mesh.setParent(plane);
  }
}

class GalleryMedia {
  constructor({
    geometry,
    gl,
    image,
    index,
    length,
    scene,
    screen,
    text,
    viewport,
    bend,
    textColor,
    borderRadius,
    font,
  }) {
    Object.assign(this, {
      extra: 0,
      geometry,
      gl,
      image,
      index,
      length,
      scene,
      screen,
      text,
      viewport,
      bend,
      textColor,
      borderRadius,
      font,
    });
    this.createShader();
    this.createMesh();
    this.onResize();
    this.createTitle();
  }

  createShader() {
    const texture = new Texture(this.gl, { generateMipmaps: true });
    this.program = new Program(this.gl, {
      depthTest: false,
      depthWrite: false,
      vertex: `
        precision highp float;
        attribute vec3 position;
        attribute vec2 uv;
        uniform mat4 modelViewMatrix;
        uniform mat4 projectionMatrix;
        uniform float uTime;
        uniform float uSpeed;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          p.z = (sin(p.x * 4.0 + uTime) * 1.5 + cos(p.y * 2.0 + uTime) * 1.5) * (0.1 + uSpeed * 0.5);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragment: `
        precision highp float;
        uniform vec2 uImageSizes;
        uniform vec2 uPlaneSizes;
        uniform sampler2D tMap;
        uniform float uBorderRadius;
        varying vec2 vUv;

        float roundedBoxSDF(vec2 p, vec2 b, float r) {
          vec2 d = abs(p) - b;
          return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0) - r;
        }

        void main() {
          vec2 ratio = vec2(
            min((uPlaneSizes.x / uPlaneSizes.y) / (uImageSizes.x / uImageSizes.y), 1.0),
            min((uPlaneSizes.y / uPlaneSizes.x) / (uImageSizes.y / uImageSizes.x), 1.0)
          );
          vec2 uv = vec2(vUv.x * ratio.x + (1.0 - ratio.x) * 0.5, vUv.y * ratio.y + (1.0 - ratio.y) * 0.5);
          vec4 color = texture2D(tMap, uv);
          float d = roundedBoxSDF(vUv - 0.5, vec2(0.5 - uBorderRadius), uBorderRadius);
          float alpha = 1.0 - smoothstep(-0.002, 0.002, d);
          gl_FragColor = vec4(color.rgb, alpha);
        }
      `,
      uniforms: {
        tMap: { value: texture },
        uPlaneSizes: { value: [0, 0] },
        uImageSizes: { value: [1, 1] },
        uSpeed: { value: 0 },
        uTime: { value: 100 * Math.random() },
        uBorderRadius: { value: this.borderRadius },
      },
      transparent: true,
    });

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = this.image;
    img.onload = () => {
      texture.image = img;
      this.program.uniforms.uImageSizes.value = [img.naturalWidth, img.naturalHeight];
    };
  }

  createMesh() {
    this.plane = new Mesh(this.gl, {
      geometry: this.geometry,
      program: this.program,
    });
    this.plane.setParent(this.scene);
  }

  createTitle() {
    this.title = new GalleryTitle({
      gl: this.gl,
      plane: this.plane,
      text: this.text,
      textColor: this.textColor,
      font: this.font,
    });
  }

  onResize({ screen, viewport } = {}) {
    if (screen) this.screen = screen;
    if (viewport) this.viewport = viewport;

    this.scale = this.screen.height / 1500;
    this.plane.scale.y = (this.viewport.height * (900 * this.scale)) / this.screen.height;
    this.plane.scale.x = (this.viewport.width * (700 * this.scale)) / this.screen.width;
    this.plane.program.uniforms.uPlaneSizes.value = [this.plane.scale.x, this.plane.scale.y];
    this.padding = 2;
    this.width = this.plane.scale.x + this.padding;
    this.widthTotal = this.width * this.length;
    this.x = this.width * this.index;
  }

  update(scroll, direction) {
    this.plane.position.x = this.x - scroll.current - this.extra;
    const x = this.plane.position.x;
    const halfWidth = this.viewport.width / 2;

    if (this.bend === 0) {
      this.plane.position.y = 0;
      this.plane.rotation.z = 0;
    } else {
      const bendAbs = Math.abs(this.bend);
      const radius = (halfWidth * halfWidth + bendAbs * bendAbs) / (2 * bendAbs);
      const effectiveX = Math.min(Math.abs(x), halfWidth);
      const arc = radius - Math.sqrt(radius * radius - effectiveX * effectiveX);

      this.plane.position.y = this.bend > 0 ? -arc : arc;
      this.plane.rotation.z =
        (this.bend > 0 ? -1 : 1) * Math.sign(x) * Math.asin(effectiveX / radius);
    }

    this.speed = scroll.current - scroll.last;
    this.program.uniforms.uTime.value += 0.04;
    this.program.uniforms.uSpeed.value = this.speed;

    const planeOffset = this.plane.scale.x / 2;
    const viewportOffset = this.viewport.width / 2;
    const isBefore = this.plane.position.x + planeOffset < -viewportOffset;
    const isAfter = this.plane.position.x - planeOffset > viewportOffset;

    if (direction === "right" && isBefore) this.extra -= this.widthTotal;
    if (direction === "left" && isAfter) this.extra += this.widthTotal;
  }
}

class CircularGallery {
  constructor(container, options = {}) {
    this.container = container;
    this.items = options.items;
    this.bend = Number(options.bend || 3);
    this.textColor = options.textColor || "#ffffff";
    this.borderRadius = Number(options.borderRadius || 0.05);
    this.font = options.font || "bold 30px Geist";
    this.scrollSpeed = Number(options.scrollSpeed || 2);
    this.scroll = {
      ease: Number(options.scrollEase || 0.05),
      current: 0,
      target: 0,
      last: 0,
    };
    this.onCheckDebounce = debounce(this.onCheck.bind(this), 200);
    this.init();
  }

  init() {
    this.renderer = new Renderer({
      alpha: true,
      antialias: true,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    });
    this.gl = this.renderer.gl;
    this.gl.clearColor(0, 0, 0, 0);
    this.container.appendChild(this.gl.canvas);
    this.camera = new Camera(this.gl);
    this.camera.fov = 45;
    this.camera.position.z = 20;
    this.scene = new Transform();
    this.onResize();
    this.planeGeometry = new Plane(this.gl, { heightSegments: 50, widthSegments: 100 });
    this.createMedias();
    this.addEventListeners();
    this.update();
  }

  createMedias() {
    const fallbackItems = [
      { image: "images/ChessSense-AI.png", text: "Camera to Decision" },
      { image: "images/Edge Inference Optimization.png", text: "Edge Optimization" },
      { image: "images/POC-to-Production Translation.png", text: "Technical Scoping" },
      { image: "images/Services Computer Vision Systems.png", text: "Vision Systems" },
      { image: "images/Services GenAI Prototypes.png", text: "GenAI Prototypes" },
      { image: "images/Process Section Deployment Support.png", text: "Deployment Support" },
    ];
    const galleryItems = this.items?.length ? this.items : fallbackItems;
    this.mediasImages = galleryItems.concat(galleryItems);
    this.medias = this.mediasImages.map(
      (data, index) =>
        new GalleryMedia({
          geometry: this.planeGeometry,
          gl: this.gl,
          image: data.image,
          index,
          length: this.mediasImages.length,
          scene: this.scene,
          screen: this.screen,
          text: data.text,
          viewport: this.viewport,
          bend: this.bend,
          textColor: this.textColor,
          borderRadius: this.borderRadius,
          font: this.font,
        }),
    );
  }

  onResize() {
    this.screen = {
      width: this.container.clientWidth,
      height: this.container.clientHeight,
    };
    if (!this.screen.width || !this.screen.height) return;

    this.renderer.setSize(this.screen.width, this.screen.height);
    this.camera.perspective({ aspect: this.screen.width / this.screen.height });
    const fov = (this.camera.fov * Math.PI) / 180;
    const height = 2 * Math.tan(fov / 2) * this.camera.position.z;
    const width = height * this.camera.aspect;
    this.viewport = { width, height };
    this.medias?.forEach((media) => media.onResize({ screen: this.screen, viewport: this.viewport }));
  }

  onTouchDown(event) {
    this.isDown = true;
    this.scroll.position = this.scroll.current;
    this.start = event.touches ? event.touches[0].clientX : event.clientX;
  }

  onTouchMove(event) {
    if (!this.isDown) return;
    const x = event.touches ? event.touches[0].clientX : event.clientX;
    const distance = (this.start - x) * (this.scrollSpeed * 0.025);
    this.scroll.target = this.scroll.position + distance;
  }

  onTouchUp() {
    this.isDown = false;
    this.onCheck();
  }

  onWheel(event) {
    if (!this.container.matches(":hover")) return;
    const delta = event.deltaY || event.wheelDelta || event.detail;
    this.scroll.target += (delta > 0 ? this.scrollSpeed : -this.scrollSpeed) * 0.2;
    this.onCheckDebounce();
  }

  onKeyDown(event) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      this.scroll.target += this.scrollSpeed * 5;
      this.onCheckDebounce();
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.scroll.target -= this.scrollSpeed * 5;
      this.onCheckDebounce();
    }
    if (event.key === "Home") {
      event.preventDefault();
      this.scroll.target = 0;
      this.onCheckDebounce();
    }
  }

  onCheck() {
    if (!this.medias?.[0]) return;
    const width = this.medias[0].width;
    const itemIndex = Math.round(Math.abs(this.scroll.target) / width);
    const item = width * itemIndex;
    this.scroll.target = this.scroll.target < 0 ? -item : item;
  }

  update() {
    if (document.hidden) {
      this.raf = requestAnimationFrame(this.update.bind(this));
      return;
    }

    this.scroll.current = lerp(this.scroll.current, this.scroll.target, this.scroll.ease);
    const direction = this.scroll.current > this.scroll.last ? "right" : "left";
    this.medias?.forEach((media) => media.update(this.scroll, direction));
    this.renderer.render({ scene: this.scene, camera: this.camera });
    this.scroll.last = this.scroll.current;
    this.raf = requestAnimationFrame(this.update.bind(this));
  }

  addEventListeners() {
    this.boundOnResize = this.onResize.bind(this);
    this.boundOnWheel = this.onWheel.bind(this);
    this.boundOnTouchDown = this.onTouchDown.bind(this);
    this.boundOnTouchMove = this.onTouchMove.bind(this);
    this.boundOnTouchUp = this.onTouchUp.bind(this);
    this.boundOnKeyDown = this.onKeyDown.bind(this);

    window.addEventListener("resize", this.boundOnResize);
    this.container.addEventListener("wheel", this.boundOnWheel, { passive: true });
    this.container.addEventListener("mousedown", this.boundOnTouchDown);
    window.addEventListener("mousemove", this.boundOnTouchMove);
    window.addEventListener("mouseup", this.boundOnTouchUp);
    this.container.addEventListener("touchstart", this.boundOnTouchDown, { passive: true });
    window.addEventListener("touchmove", this.boundOnTouchMove, { passive: true });
    window.addEventListener("touchend", this.boundOnTouchUp);
    this.container.addEventListener("keydown", this.boundOnKeyDown);
  }
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
  if (!container || prefersReducedMotion) return;

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

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
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

    const setSize = () => {
      const width = container.getBoundingClientRect().width;
      title.style.fontSize = `${Math.max(width / (chars.length / 1.8), minFontSize)}px`;
    };

    const animate = () => {
      mouse.x += (cursor.x - mouse.x) / 15;
      mouse.y += (cursor.y - mouse.y) / 15;
      const titleRect = title.getBoundingClientRect();
      const maxDist = titleRect.width / 2;

      spans.forEach((span) => {
        const rect = span.getBoundingClientRect();
        const dx = mouse.x - (rect.left + rect.width / 2);
        const dy = mouse.y - (rect.top + rect.height / 2);
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
    window.addEventListener("resize", debounce(setSize, 100));
    setSize();
    animate();
  });
}

function initVisualComponents() {
  initFloatingLines();
  initTiltedCards();
  initTextPressure();
  initPillNav();

  document.querySelectorAll("[data-metaballs]").forEach((element) => {
    if (prefersReducedMotion) return;
    new MetaBalls(element, datasetOptions(element));
  });

  document.querySelectorAll("[data-circular-gallery]").forEach((element) => {
    if (document.fonts?.load) {
      document.fonts.load("bold 30px Geist").finally(() => {
        new CircularGallery(element, datasetOptions(element));
      });
      return;
    }

    new CircularGallery(element, datasetOptions(element));
  });
}

initVisualComponents();
