'use client';

import { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface QoreOrb3DProps {
  /** Reserved for future "processing" state. */
  isProcessing?: boolean;
  className?: string;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Public-domain 3D Simplex noise (Ashima Arts / Stefan Gustavson)          */
/* ──────────────────────────────────────────────────────────────────────── */

const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`;

/* ──────────────────────────────────────────────────────────────────────── */
/* Bubble shell — single shader produces folds + iridescent ribbons + rim  */
/* ──────────────────────────────────────────────────────────────────────── */

const VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vViewDir;
varying vec3 vOriginalPos;
varying float vCurv;

uniform float uTime;
uniform float uDisp;
uniform float uFlow;

${NOISE_GLSL}

// Compute noise gradient by central differences (cheap normal recalc).
vec3 noiseGrad(vec3 p, float eps){
  float nX = snoise(p + vec3(eps, 0.0, 0.0)) - snoise(p - vec3(eps, 0.0, 0.0));
  float nY = snoise(p + vec3(0.0, eps, 0.0)) - snoise(p - vec3(0.0, eps, 0.0));
  float nZ = snoise(p + vec3(0.0, 0.0, eps)) - snoise(p - vec3(0.0, 0.0, eps));
  return vec3(nX, nY, nZ) / (2.0 * eps);
}

void main(){
  vec3 pos = position;
  vOriginalPos = pos;

  // Smooth, low-frequency fold pattern (broad swooshing curves, NOT bumpy)
  vec3 q1 = pos * 0.85 + vec3(uTime * uFlow * 0.45, uTime * uFlow * 0.22, uTime * uFlow * 0.30);
  vec3 q2 = pos * 1.40 + vec3(-uTime * uFlow * 0.20, uTime * uFlow * 0.35, uTime * uFlow * 0.15);

  float n1 = snoise(q1);
  float n2 = snoise(q2) * 0.45;
  float n  = n1 + n2;

  // Asymmetric per-axis scaling so the silhouette isn't a perfect sphere.
  float disp = n * uDisp;
  pos += normal * disp;

  // Recompute normal from gradient → sharp specular reads the actual fold direction.
  vec3 grad = noiseGrad(q1, 0.5);
  vec3 N = normalize(normal - grad * uDisp * 1.8);

  // Curvature proxy: how much the normal differs from the original — drives the
  // "ribbon" brightness later (bright where surface curves strongly).
  vCurv = clamp(length(grad) * uDisp * 2.4, 0.0, 1.5);

  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(normalMatrix * N);
  vec4 mv = viewMatrix * wp;
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;

varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vViewDir;
varying vec3 vOriginalPos;
varying float vCurv;

uniform float uTime;
uniform vec3 uViolet;
uniform vec3 uMagenta;
uniform vec3 uBlue;
uniform vec3 uCyan;

${NOISE_GLSL}

// Sharp specular band — high exponent gives the "ribbon" look.
float band(vec3 N, vec3 L, float power, float gain){
  float d = max(dot(N, normalize(L)), 0.0);
  return pow(d, power) * gain;
}

void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);

  // Subtle dark interior — gives the bubble its "deep" feeling.
  float swirl = snoise(vOriginalPos * 1.8 + vec3(uTime * 0.10, uTime * 0.07, 0.0));
  vec3 interiorTop    = mix(uBlue * 0.35,    uViolet * 0.40, smoothstep(-1.0, 1.0, swirl));
  vec3 interiorBottom = mix(uCyan * 0.20,    uBlue   * 0.30, smoothstep(-1.0, 1.0, swirl));
  vec3 interior = mix(interiorBottom, interiorTop, smoothstep(-1.0, 1.0, vOriginalPos.y));

  // ── Anisotropic-style "ribbons" — multiple lights with different colours and
  // narrow specular bands; together they trace bright curves along the folds.
  vec3 L1 = vec3( 0.55,  0.75,  0.85); // upper-right magenta
  vec3 L2 = vec3(-0.60, -0.20,  0.85); // lower-left cyan
  vec3 L3 = vec3( 0.00,  0.55,  0.95); // top centre violet
  vec3 L4 = vec3(-0.45,  0.65,  0.80); // upper-left magenta-pink

  float b1 = band(N, L1, 36.0, 1.6);
  float b2 = band(N, L2, 28.0, 1.4);
  float b3 = band(N, L3, 60.0, 1.0);
  float b4 = band(N, L4, 40.0, 1.0);

  vec3 ribbons = uMagenta * b1 + uCyan * b2 + uViolet * b3 + uMagenta * (b4 * 0.7);

  // Ribbons are brighter where the surface curves strongly (fold ridges).
  ribbons *= (0.7 + vCurv * 0.9);

  // ── Fresnel neon rim — defines the silhouette in the reference.
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);
  vec3 rimColor = mix(uMagenta, uCyan, 0.5 + 0.5 * sin(vOriginalPos.y * 2.0 + uTime * 0.3));
  vec3 rim = rimColor * fres * 2.0;

  // ── Inner glow visible through translucency near the rim.
  float innerGlow = pow(fres, 4.0) * 0.45;
  vec3 glow = mix(uViolet, uCyan, 0.5 + 0.5 * sin(uTime * 0.4)) * innerGlow;

  // Compose
  vec3 col = interior * (1.0 - fres * 0.7);
  col += ribbons;
  col += rim;
  col += glow;

  // Very small ambient lift so the bubble isn't pitch black where unlit
  col += interior * 0.10;

  gl_FragColor = vec4(col, 1.0);
}
`;

function BubbleShell({ isProcessing }: { isProcessing: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uDisp: { value: 0.18 },
      uFlow: { value: 0.14 },
      uViolet:  { value: new THREE.Color('#7c3aed') },
      uMagenta: { value: new THREE.Color('#e879f9') },
      uBlue:    { value: new THREE.Color('#3b82f6') },
      uCyan:    { value: new THREE.Color('#22d3ee') },
    }),
    [],
  );
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms,
        transparent: false,
        side: THREE.FrontSide,
      }),
    [uniforms],
  );
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1.0, 7), []); // 20480 faces — smooth folds

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    uniforms.uTime.value = t;
    uniforms.uFlow.value = isProcessing ? 0.42 : 0.14;
    uniforms.uDisp.value = isProcessing ? 0.26 : 0.18;
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.14;
      groupRef.current.rotation.x = Math.sin(t * 0.09) * 0.16;
      groupRef.current.rotation.z = Math.cos(t * 0.07) * 0.08;
      const breath = 1 + Math.sin(t * 0.45) * 0.014;
      groupRef.current.scale.setScalar(breath);
    }
  });

  return (
    <group ref={groupRef}>
      <mesh ref={meshRef} geometry={geometry} material={material} />
    </group>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Inner back-shell — emits a subtle dark colour visible through the shell  */
/* (additive, BackSide → only the FAR side of the bubble is seen behind     */
/*  the front, creating the "you can see inside" depth illusion).           */
/* ──────────────────────────────────────────────────────────────────────── */

function InnerDepth() {
  const meshRef = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uA: { value: new THREE.Color('#0d0526') },
      uB: { value: new THREE.Color('#2a0a4f') },
    }),
    [],
  );
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          varying vec3 vWorldPos;
          void main(){
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldPos = wp.xyz;
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          precision highp float;
          varying vec3 vNormal;
          varying vec3 vWorldPos;
          uniform vec3 uA;
          uniform vec3 uB;
          void main(){
            float t = 0.5 + 0.5 * vWorldPos.y;
            vec3 col = mix(uA, uB, t);
            gl_FragColor = vec4(col, 1.0);
          }`,
        uniforms,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    [uniforms],
  );
  useFrame((state) => { uniforms.uTime.value = state.clock.elapsedTime; });
  return <mesh ref={meshRef} geometry={useMemo(() => new THREE.IcosahedronGeometry(0.96, 3), [])} material={material} />;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* SoftHalo — backside additive sphere with view-aligned Fresnel falloff.   */
/* Stacked at 3 radii to fake a post-process bloom around the orb.          */
/* ──────────────────────────────────────────────────────────────────────── */

function SoftHalo({ radius, intensity, hue }: { radius: number; intensity: number; hue: string }) {
  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(hue) },
      uIntensity: { value: intensity },
    }),
    [hue, intensity],
  );
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          varying vec3 vViewDir;
          void main(){
            vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vViewDir = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          precision highp float;
          varying vec3 vNormal;
          varying vec3 vViewDir;
          uniform vec3 uColor;
          uniform float uIntensity;
          void main(){
            float rim = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), 2.2);
            // BackSide rendering inverts dot; bias so the silhouette glows.
            float alpha = rim * uIntensity;
            gl_FragColor = vec4(uColor * alpha, alpha);
          }`,
        uniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
      }),
    [uniforms],
  );
  const geometry = useMemo(() => new THREE.SphereGeometry(radius, 48, 48), [radius]);
  return <mesh geometry={geometry} material={material} />;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Camera                                                                   */
/* ──────────────────────────────────────────────────────────────────────── */

function CameraRig() {
  const { camera } = useThree();
  useMemo(() => {
    camera.position.set(0, 0, 3.05);
    camera.lookAt(0, 0, 0);
  }, [camera]);
  return null;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Public component                                                         */
/* ──────────────────────────────────────────────────────────────────────── */

export default function QoreOrb3D({ isProcessing = false, className }: QoreOrb3DProps) {
  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* CSS halo — broad atmospheric glow behind the canvas. */}
      {/* Strengthened CSS halo — compensates for the postprocessing bloom we
          removed. Three radial gradients with strong opacity + heavy blur. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: '-18%',
          pointerEvents: 'none',
          background:
            'radial-gradient(circle at 36% 30%, rgba(168, 85, 247, 0.75), transparent 50%),' +
            'radial-gradient(circle at 72% 78%, rgba(34, 211, 238, 0.62), transparent 55%),' +
            'radial-gradient(circle at 50% 50%, rgba(217, 70, 239, 0.32), transparent 70%)',
          filter: 'blur(48px)',
        }}
      />
      <Canvas
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        dpr={[1, 2]}
        camera={{ fov: 42, near: 0.1, far: 100, position: [0, 0, 3.05] }}
        style={{ position: 'relative', zIndex: 1 }}
      >
        <CameraRig />
        <InnerDepth />
        <BubbleShell isProcessing={isProcessing} />
        {/* Multi-layer additive halos approximate a bloom pass without
            requiring the postprocessing pipeline (which had peer-dep
            issues at build time). Three concentric BackSide spheres at
            increasing radius + decreasing opacity create a soft neon
            "spread" around the orb. */}
        <SoftHalo radius={1.16} intensity={0.55} hue="#d946ef" />
        <SoftHalo radius={1.32} intensity={0.35} hue="#22d3ee" />
        <SoftHalo radius={1.55} intensity={0.18} hue="#7c3aed" />
      </Canvas>
    </div>
  );
}
