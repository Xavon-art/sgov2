"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type Quality = "auto" | "high" | "low" | "static";

type Props = {
  /** 0..1 — how strongly the mesh reads. Flow pages use a low value to keep forms legible. */
  strength?: number;
  /** spatial frequency of the noise field */
  scale?: number;
  /** animation speed multiplier */
  speed?: number;
  quality?: Quality;
  interactive?: boolean;
  className?: string;
};

const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const makeFrag = (precision: string, octaves: number) => `
precision ${precision} float;

uniform vec2  u_res;
uniform float u_time;
uniform vec2  u_pointer;
uniform float u_strength;
uniform float u_scale;
uniform float u_speed;

#define OCTAVES ${octaves}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < OCTAVES; i++) {
    v += amp * vnoise(p);
    p = rot * p * 2.03;
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 p = (frag - 0.5 * u_res) / min(u_res.x, u_res.y);

  p *= u_scale;
  float t = u_time * u_speed;

  p += (u_pointer - 0.5) * 0.26;

  vec2 q = vec2(
    fbm(p * 1.10 + vec2(0.0, t)),
    fbm(p * 1.10 + vec2(4.70, -t * 0.82))
  );
  vec2 r = vec2(
    fbm(p * 1.45 + 2.15 * q + vec2(1.30, 8.20) + t * 0.58),
    fbm(p * 1.45 + 2.15 * q + vec2(7.40, 2.60) - t * 0.44)
  );
  float f = fbm(p * 1.85 + 2.35 * r);

  vec3 cIvory = vec3(0.988, 0.984, 0.972);
  vec3 cMist  = vec3(0.937, 0.949, 0.957);
  vec3 cBlue  = vec3(0.847, 0.894, 0.945);
  vec3 cNavy  = vec3(0.204, 0.337, 0.478);
  vec3 cBrass = vec3(0.906, 0.792, 0.541);

  float n = clamp(f, 0.0, 1.0);

  vec3 col = mix(cIvory, cMist, smoothstep(0.30, 0.62, n));
  col = mix(col, cBlue, smoothstep(0.47, 0.80, n) * 0.88);
  col = mix(col, cNavy, smoothstep(0.76, 0.99, n) * 0.38);

  float gold = smoothstep(0.44, 0.14, n) * (0.30 + 0.70 * q.x);
  col = mix(col, cBrass, gold * 0.20);

  col += vec3(0.040, 0.034, 0.022) * exp(-2.10 * length(p - vec2(-0.38, 0.26)));
  col -= vec3(0.012, 0.014, 0.018) * exp(-1.70 * length(p - vec2(0.52, -0.34)));

  col = mix(col * 0.962, col, smoothstep(1.30, 0.26, length(p)));

  col = mix(vec3(0.988, 0.985, 0.976), col, u_strength);

  float g = hash21(frag + fract(u_time) * 131.0);
  col += (g - 0.5) * 0.0065;

  gl_FragColor = vec4(col, 1.0);
}
`;

/** Fixed sample for the still frame, so a static field is deterministic. */
const STATIC_TIME = 14.2;

/**
 * Repaints per second. The field drifts over roughly fifteen seconds, so this is
 * well below the threshold where the motion reads as stepped -- and it is the
 * number that matters, because every changed frame forces the backdrop blurs
 * and blend modes stacked above the canvas to be recomputed.
 */
const FRAME_MS = 1000 / 20;

/**
 * Intervals to average before judging the device. Kept deliberately short: the
 * previous window of 45 meant a device actually drawing at 12fps had to run for
 * 3.6s before the first downscale landed, so most of a first visit was spent
 * paying for a frame rate the device was never going to reach.
 */
const SAMPLE_FRAMES = 10;

/**
 * A single frame interval this far over budget means no cheaper tier will
 * rescue the frame either, so drop straight to the floor rather than spending a
 * second sample window rediscovering the same thing.
 */
const BAIL_GAP = FRAME_MS * 4;

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  src: string,
): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export default function ShaderField({
  strength = 1,
  scale = 1.6,
  speed = 0.035,
  quality = "auto",
  interactive = true,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const narrow = window.innerWidth < 768;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;

    let mode: Quality = quality;
    if (mode === "auto") {
      if (reduced) mode = "static";
      else if (narrow || coarse) mode = "low";
      else mode = "high";
    }

    // No WebGL, or a shader that will not build: leave the canvas transparent
    // and the gradient base layer underneath it shows through instead. Nothing
    // needs to be torn down, so every early return below is a plain `return`.
    const gl =
      (canvas.getContext("webgl", {
        antialias: false,
        alpha: false,
        depth: false,
        stencil: false,
        powerPreference: "high-performance",
      }) as WebGLRenderingContext | null) ??
      (canvas.getContext(
        "experimental-webgl",
      ) as WebGLRenderingContext | null);

    if (!gl) return;

    const octaves = mode === "low" ? 3 : 5;
    const precision = mode === "low" ? "mediump" : "highp";

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT);
    let fs = compileShader(gl, gl.FRAGMENT_SHADER, makeFrag(precision, octaves));
    if (!fs) {
      fs = compileShader(gl, gl.FRAGMENT_SHADER, makeFrag("mediump", 3));
    }
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "a_pos");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "u_res");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uPointer = gl.getUniformLocation(program, "u_pointer");
    gl.uniform1f(gl.getUniformLocation(program, "u_strength"), strength);
    gl.uniform1f(gl.getUniformLocation(program, "u_scale"), scale);
    gl.uniform1f(gl.getUniformLocation(program, "u_speed"), speed);

    const deviceDpr = window.devicePixelRatio || 1;
    const maxDpr = mode === "low" ? 1.15 : 1.25;
    let resScale = mode === "low" ? 0.7 : 0.85;

    const pointer = { x: 0.5, y: 0.5 };
    const target = { x: 0.5, y: 0.5 };

    // Loop state is declared up here rather than inside the branch below,
    // because resize() needs to read it in order to repaint.
    let raf = 0;
    let running = false;
    let visible = true;
    let started = 0;
    let firstFrame = true;
    let lastDraw = 0;
    let acc = 0;
    let samples = 0;
    let downgrades = 0;
    let warmup = 2;

    const draw = (time: number) => {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, time);
      gl.uniform2f(uPointer, pointer.x, pointer.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    // Reassigning canvas.width or canvas.height reallocates the drawing
    // buffer, and WebGL fills a fresh buffer with opaque black. That resize can
    // land while this field is parked -- scrolled out of view, or the tab in the
    // background -- and with no loop running nothing would ever put the pixels
    // back, so the user would scroll down to a black rectangle. Repaint in
    // every mode.
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(deviceDpr, maxDpr) * resScale;
      const w = Math.max(1, Math.round(rect.width * scale));
      const h = Math.max(1, Math.round(rect.height * scale));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      if (mode === "static") draw(STATIC_TIME);
      else draw(started ? (lastDraw - started) / 1000 : 0);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const teardown: Array<() => void> = [
      () => ro.disconnect(),
      () => {
        gl.deleteProgram(program);
        gl.deleteShader(vs);
        if (fs) gl.deleteShader(fs);
        gl.deleteBuffer(buf);
        // Hand the context slot back explicitly. Left to the garbage collector,
        // every page visit leaks one, and browsers cap how many live WebGL
        // contexts they will hold; on reaching the cap the driver drops the
        // oldest one and the surviving field blacks out mid-page.
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      },
    ];

    if (mode === "static") {
      draw(STATIC_TIME);
      canvas.style.opacity = "1";
    } else {
      const onPointer = (e: PointerEvent) => {
        target.x = e.clientX / Math.max(window.innerWidth, 1);
        target.y = 1 - e.clientY / Math.max(window.innerHeight, 1);
      };

      if (interactive && !coarse) {
        window.addEventListener("pointermove", onPointer, { passive: true });
        teardown.push(() =>
          window.removeEventListener("pointermove", onPointer),
        );
      }

      const loop = (now: number) => {
        raf = 0;

        if (document.hidden) {
          running = false;
          return;
        }

        // Cap the repaint rate. Everything stacked on top of this canvas has to
        // be recomposited whenever the field changes: the .paper backdrop blur
        // and the hero's grain blend, both full-section. That cost is per
        // changed frame, not per frame. The field is a slow ambient wash, so
        // 20fps is indistinguishable from 60 and costs a third as much
        // compositing.
        if (lastDraw && now - lastDraw < FRAME_MS) {
          raf = requestAnimationFrame(loop);
          return;
        }

        if (!started) started = now;
        const seconds = (now - started) / 1000;
        const gap = lastDraw ? now - lastDraw : 0;

        // The first couple of gaps are dominated by shader compilation and the
        // first-frame JIT, not by steady-state cost. Averaging them in would
        // downgrade machines that are in fact keeping up, which is a real
        // quality regression, so they are dropped instead. `samples` counts only
        // the gaps that reach `acc`, so the two stay in step.
        if (gap > 0 && warmup > 0) warmup--;
        else if (gap > 0) {
          acc += gap;
          samples++;
        }
        lastDraw = now;

        pointer.x += (target.x - pointer.x) * 0.045;
        pointer.y += (target.y - pointer.y) * 0.045;

        draw(seconds);

        if (firstFrame) {
          firstFrame = false;
          canvas.style.opacity = "1";
        }

        if (downgrades < 2) {
          // Judged on a single interval, not the running total: a device holding
          // the 20fps cap accumulates past any fixed total within a few frames
          // while every one of its intervals is perfectly healthy.
          const hopeless = gap > BAIL_GAP;
          if (hopeless || samples >= SAMPLE_FRAMES) {
            const avg = acc / samples;
            acc = 0;
            samples = 0;
            // Compare against our own budget: the 20fps cap makes the average
            // spacing FRAME_MS by design, so the old 21ms threshold would
            // downscale on every capable machine.
            if (hopeless || avg > FRAME_MS * 1.5) {
              downgrades = hopeless ? 2 : downgrades + 1;
              resScale = downgrades === 1 ? 0.72 : 0.5;
              resize();
            } else {
              downgrades = 2;
            }
          }
        }

        raf = requestAnimationFrame(loop);
      };

      const start = () => {
        if (running || raf) return;
        running = true;
        raf = requestAnimationFrame(loop);
      };

      const stop = () => {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        running = false;
      };
      // The loop is the only thing holding this component's work alive, and
      // nothing else in the teardown reaches it: the IntersectionObserver is
      // disconnected and the context is lost, so no callback would ever fire
      // again to park it. Without this the chain kept re-arming at 60fps
      // after navigation, drawing into a context that no longer exists.
      teardown.push(stop);

      // Park the loop whenever the field is scrolled away or the tab is in the
      // background. Previously it kept re-arming requestAnimationFrame at 60fps
      // just to return early, and the landing page runs two of these at once --
      // a full-screen five-octave fbm each, which is what made the page stutter.
      const io = new IntersectionObserver(
        ([entry]) => {
          visible = entry.isIntersecting;
          if (visible && !document.hidden) start();
          else stop();
        },
        { threshold: 0 },
      );
      io.observe(canvas);
      teardown.push(() => io.disconnect());

      const onVisibility = () => {
        if (document.hidden) stop();
        else if (visible) start();
      };
      document.addEventListener("visibilitychange", onVisibility);
      teardown.push(() =>
        document.removeEventListener("visibilitychange", onVisibility),
      );

      start();
    }

    // The browser also reclaims GPU contexts on its own under memory pressure,
    // and announces it with webglcontextlost. Without preventDefault the
    // context can never be restored and the field stays black for good.
    const onContextLost = (event: Event) => {
      event.preventDefault();
    };
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    teardown.push(() =>
      canvas.removeEventListener("webglcontextlost", onContextLost),
    );

    return () => {
      for (const fn of teardown) fn();
    };
  }, [strength, scale, speed, quality, interactive]);

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      {/*
        Base layer, always present. A device without WebGL therefore shows the
        same gradient rather than an empty box, and the canvas can fade in over
        it on its first painted frame without any conditional rendering -- which
        also keeps the markup identical on the server and the client.
      */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 55% at 22% 18%, #eef2f7 0%, transparent 60%)," +
            "radial-gradient(50% 50% at 82% 28%, #f6efe0 0%, transparent 62%)," +
            "radial-gradient(70% 60% at 50% 96%, #e6edf4 0%, transparent 65%)," +
            "linear-gradient(180deg, #fcfcfa 0%, #f4f2ea 100%)",
        }}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full transition-opacity duration-[700ms] ease-out"
        style={{ opacity: 0 }}
      />
    </div>
  );
}
