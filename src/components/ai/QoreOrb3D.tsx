'use client';

import { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';

interface QoreOrb3DProps {
  /** Reserved for future "processing" state — currently the orb is always idle. */
  isProcessing?: boolean;
  className?: string;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Shared GLSL — 3D Simplex noise (public-domain, Ashima Arts)             */
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
/* Inner volumetric core — colored swirls visible THROUGH the glass shell  */
/* ──────────────────────────────────────────────────────────────────────── */

const CORE_FRAG = /* glsl */ `
precision highp float;

varying vec3 vWorldPos;
varying vec3 vNormal;

uniform float uTime;
uniform float uFlow;
uniform vec3 uViolet;
uniform vec3 uMagenta;
uniform vec3 uBlue;
uniform vec3 uCyan;

${NOISE_GLSL}

// fBM (4 octaves) for richer swirls
float fbm(vec3 p){
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * snoise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main(){
  vec3 p = vWorldPos * 1.6;
  // Two displaced noise fields advected by time, in different directions.
  vec3 q = vec3(
    fbm(p + vec3(0.0, uTime * uFlow * 0.40, uTime * uFlow * 0.18)),
    fbm(p + vec3(uTime * uFlow * 0.32, 0.0, uTime * uFlow * 0.21)),
    fbm(p + vec3(uTime * uFlow * 0.25, uTime * uFlow * 0.30, 0.0))
  );
  float swirl = fbm(p + q * 1.5);
  float band = abs(swirl);
  float ribbon = smoothstep(0.45, 0.20, band) * 1.4;        // bright ribbons
  float deep   = smoothstep(0.95, 0.55, band);              // dark gaps

  // Color rampa
  vec3 col = mix(uBlue, uViolet, smoothstep(-0.4, 0.6, swirl));
  col = mix(col, uCyan,    smoothstep(0.05, 0.35, swirl));
  col = mix(col, uMagenta, ribbon * 0.7);

  // Inner depth darkening so swirls feel volumetric.
  col *= mix(0.35, 1.4, ribbon);
  col = mix(col, vec3(0.02, 0.0, 0.06), deep * 0.6);

  // Brighten centre slightly so the bubble has internal "soul".
  float radial = 1.0 - length(vWorldPos);
  col += uCyan * pow(max(radial, 0.0), 3.0) * 0.25;

  gl_FragColor = vec4(col, 1.0);
}
`;

const CORE_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;

void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

function VolumetricCore({ isProcessing }: { isProcessing: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uFlow: { value: 0.22 },
      uViolet: { value: new THREE.Color('#6d28d9') },
      uMagenta: { value: new THREE.Color('#d946ef') },
      uBlue: { value: new THREE.Color('#2563eb') },
      uCyan: { value: new THREE.Color('#22d3ee') },
    }),
    [],
  );
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: CORE_VERT,
        fragmentShader: CORE_FRAG,
        uniforms,
        side: THREE.DoubleSide,
        transparent: false,
      }),
    [uniforms],
  );
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(0.82, 4), []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    uniforms.uTime.value = t;
    uniforms.uFlow.value = isProcessing ? 0.55 : 0.22;
    if (meshRef.current) {
      // Inner core spins the opposite direction → swirls cross over the shell's motion
      meshRef.current.rotation.y -= delta * 0.09;
      meshRef.current.rotation.x = Math.cos(t * 0.07) * 0.18;
    }
  });

  return <mesh ref={meshRef} geometry={geometry} material={material} />;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Glass shell — MeshPhysicalMaterial with transmission + iridescence +    */
/* asymmetric vertex displacement for the irregular bubble silhouette.     */
/* ──────────────────────────────────────────────────────────────────────── */

function GlassShell({ isProcessing }: { isProcessing: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const shaderRef = useRef<{ uniforms: Record<string, { value: number }> } | null>(null);

  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1.0, 6), []);

  const material = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#b89cff'),
      roughness: 0.08,
      metalness: 0.0,
      transmission: 0.95,
      thickness: 1.4,
      ior: 1.35,
      attenuationColor: new THREE.Color('#7c3aed'),
      attenuationDistance: 0.9,
      iridescence: 1.0,
      iridescenceIOR: 1.3,
      iridescenceThicknessRange: [120, 540],
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      transparent: true,
      side: THREE.FrontSide,
      envMapIntensity: 1.4,
    });

    // Inject animated, asymmetric vertex displacement into the PBR vertex shader.
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uDisp = { value: 0.18 };
      shader.uniforms.uFlow = { value: 0.14 };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime;
           uniform float uDisp;
           uniform float uFlow;
           ${NOISE_GLSL}`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3(position);
           // Asymmetric noise — different scales per axis so the form is NOT a perfect sphere.
           float n1 = snoise(transformed * vec3(1.30, 0.95, 1.12) + vec3(uTime * uFlow * 0.85, uTime * uFlow * 0.40, uTime * uFlow * 0.60));
           float n2 = snoise(transformed * vec3(2.30, 2.70, 1.90) + vec3(-uTime * uFlow * 0.55, uTime * uFlow * 0.35, 0.0));
           float n3 = snoise(transformed * 0.55 + vec3(uTime * uFlow * 0.20));
           float disp = (n1 * 0.65 + n2 * 0.25 + n3 * 0.35) * uDisp;
           transformed += normal * disp;`,
        );
      shaderRef.current = shader;
    };
    // Force shader recompile on first render
    m.needsUpdate = true;
    return m;
  }, []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (shaderRef.current?.uniforms) {
      shaderRef.current.uniforms.uTime.value = t;
      shaderRef.current.uniforms.uFlow.value = isProcessing ? 0.45 : 0.14;
      shaderRef.current.uniforms.uDisp.value = isProcessing ? 0.28 : 0.18;
    }
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.14;
      groupRef.current.rotation.x = Math.sin(t * 0.09) * 0.16;
      groupRef.current.rotation.z = Math.cos(t * 0.07) * 0.08;
      const breath = 1 + Math.sin(t * 0.45) * 0.012;
      groupRef.current.scale.setScalar(breath);
    }
  });

  return (
    <group ref={groupRef}>
      <VolumetricCore isProcessing={isProcessing} />
      <mesh ref={meshRef} geometry={geometry} material={material} />
    </group>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Outer additive halo — neon aura around the bubble                       */
/* ──────────────────────────────────────────────────────────────────────── */

const HALO_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vViewDir;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uTime;

void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.4);
  // Hue shift between magenta and cyan over time → "iridescent" halo motion
  float t = 0.5 + 0.5 * sin(uTime * 0.4 + vWorldPos.y * 1.5);
  vec3 col = mix(uColorA, uColorB, t);
  gl_FragColor = vec4(col * rim, rim * 0.85);
}
`;

const HALO_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vViewDir;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = viewMatrix * wp;
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

function NeonHalo() {
  const meshRef = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color('#d946ef') }, // magenta
      uColorB: { value: new THREE.Color('#22d3ee') }, // cyan
    }),
    [],
  );
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: HALO_VERT,
        fragmentShader: HALO_FRAG,
        uniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
      }),
    [uniforms],
  );
  const geometry = useMemo(() => new THREE.SphereGeometry(1.35, 64, 64), []);

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    if (meshRef.current) {
      const s = 1 + Math.sin(state.clock.elapsedTime * 0.5) * 0.03;
      meshRef.current.scale.setScalar(s);
    }
  });

  return <mesh ref={meshRef} geometry={geometry} material={material} />;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Camera                                                                   */
/* ──────────────────────────────────────────────────────────────────────── */

function CameraRig() {
  const { camera } = useThree();
  useMemo(() => {
    camera.position.set(0, 0, 3.1);
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
      {/* CSS atmospheric bloom — soft purple + cyan radial behind the canvas. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: '-15%',
          pointerEvents: 'none',
          background:
            'radial-gradient(circle at 40% 30%, rgba(168, 85, 247, 0.45), transparent 55%),' +
            'radial-gradient(circle at 65% 75%, rgba(34, 211, 238, 0.40), transparent 60%),' +
            'radial-gradient(circle at 50% 50%, rgba(217, 70, 239, 0.22), transparent 65%)',
          filter: 'blur(28px)',
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
        camera={{ fov: 42, near: 0.1, far: 100, position: [0, 0, 3.1] }}
        style={{ position: 'relative', zIndex: 1 }}
      >
        <CameraRig />
        {/* Environment provides reflections for transmission (NOT shown as background). */}
        <Environment preset="night" background={false} environmentIntensity={0.8} />
        {/* Three colored point lights — accent the bubble like the reference. */}
        <pointLight position={[2.5, 2.5, 2.0]} intensity={3.5} color="#d946ef" />
        <pointLight position={[-2.5, -1.5, 2.0]} intensity={3.0} color="#22d3ee" />
        <pointLight position={[0, 0, -2.5]} intensity={1.5} color="#7c3aed" />
        <ambientLight intensity={0.15} />

        <NeonHalo />
        <GlassShell isProcessing={isProcessing} />
      </Canvas>
    </div>
  );
}
