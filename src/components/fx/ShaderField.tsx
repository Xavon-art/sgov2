"use client";

import { useEffect, useRef, useState } from "react";
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
  const [ready, setReady] = useState(false);
  const [supported, setSupported] = useState(true);

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

    if (!gl) {
      setSupported(false);
      return;
    }

    const octaves = mode === "low" ? 3 : 5;
    const precision = mode === "low" ? "mediump" : "highp";

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT);
    let fs = compileShader(gl, gl.FRAGMENT_SHADER, makeFrag(precision, octaves));
    if (!fs) {
      fs = compileShader(gl, gl.FRAGMENT_SHADER, makeFrag("mediump", 3));
    }
    if (!vs || !fs) {
      setSupported(false);
      return;
    }

    const program = gl.createProgram();
    if (!program) {
      setSupported(false);
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "a_pos");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      setSupported(false);
      return;
    }
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
    const maxDpr = mode === "low" ? 1.15 : 1.5;
    let resScale = mode === "low" ? 0.7 : 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(deviceDpr, maxDpr) * resScale;
      const w = Math.max(1, Math.round(rect.width * scale));
      const h = Math.max(1, Math.round(rect.height * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const draw = (time: number) => {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, time);
      gl.uniform2f(uPointer, pointer.x, pointer.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const pointer = { x: 0.5, y: 0.5 };
    const target = { x: 0.5, y: 0.5 };

    const teardown: Array<() => void> = [
      () => ro.disconnect(),
      () => {
        gl.deleteProgram(program);
        gl.deleteShader(vs);
        if (fs) gl.deleteShader(fs);
        gl.deleteBuffer(buf);
      },
    ];

    if (mode === "static") {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, 14.2);
      gl.uniform2f(uPointer, 0.5, 0.5);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      setReady(true);
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

      let raf = 0;
      let visible = true;
      let started = 0;
      let last = 0;
      let acc = 0;
      let frames = 0;
      let downgrades = 0;

      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        if (!visible || document.hidden) return;

        if (!started) started = now;
        const seconds = (now - started) / 1000;

        pointer.x += (target.x - pointer.x) * 0.045;
        pointer.y += (target.y - pointer.y) * 0.045;

        draw(seconds);
        if (!last) {
          setReady(true);
          last = now;
        }

        if (downgrades < 2) {
          acc += now - last;
          last = now;
          frames++;
          if (frames >= 45) {
            const avg = acc / frames;
            acc = 0;
            frames = 0;
            if (avg > 21) {
              downgrades++;
              resScale = downgrades === 1 ? 0.72 : 0.5;
              resize();
            } else {
              downgrades = 2;
            }
          }
        }
      };

      const io = new IntersectionObserver(
        ([entry]) => {
          visible = entry.isIntersecting;
        },
        { threshold: 0 },
      );
      io.observe(canvas);
      teardown.push(() => io.disconnect());

      raf = requestAnimationFrame(loop);
      teardown.push(() => cancelAnimationFrame(raf));
    }

    return () => {
      for (const fn of teardown) fn();
    };
  }, [strength, scale, speed, quality, interactive]);

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      {supported ? (
        <canvas
          ref={canvasRef}
          className="h-full w-full transition-opacity duration-[1400ms] ease-out"
          style={{ opacity: ready ? 1 : 0 }}
        />
      ) : null}
      {!supported ? (
        <div
          className="h-full w-full"
          style={{
            background:
              "radial-gradient(60% 55% at 22% 18%, #eef2f7 0%, transparent 60%)," +
              "radial-gradient(50% 50% at 82% 28%, #f6efe0 0%, transparent 62%)," +
              "radial-gradient(70% 60% at 50% 96%, #e6edf4 0%, transparent 65%)," +
              "linear-gradient(180deg, #fcfcfa 0%, #f4f2ea 100%)",
          }}
        />
      ) : null}
    </div>
  );
}
