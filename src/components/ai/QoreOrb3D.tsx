'use client';

import { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface QoreOrb3DProps {
  /** Reserved for future "processing" state — currently the orb is always idle. */
  isProcessing?: boolean;
  className?: string;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* GLSL shader source                                                       */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * 3D Simplex noise (Ashima Arts / Stefan Gustavson, public-domain).
 * Used for both vertex displacement and fragment colour flow.
 */
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

const VERTEX_SHADER = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vViewDir;
varying float vNoise;

uniform float uTime;
uniform float uDisplacement;
uniform float uFlowSpeed;

${NOISE_GLSL}

void main() {
  vec3 pos = position;

  // Low-frequency wobble (large soft bulges) — preserves spherical form.
  float n1 = snoise(pos * 1.1 + vec3(0.0, uTime * uFlowSpeed * 0.6, uTime * uFlowSpeed * 0.4));
  // Higher frequency micro-ripple — gives the jelly "skin" feel.
  float n2 = snoise(pos * 2.4 + vec3(uTime * uFlowSpeed * 0.3, 0.0, 0.0));

  vNoise = n1 * 0.7 + n2 * 0.3;
  float disp = (n1 * 0.65 + n2 * 0.35) * uDisplacement;
  pos += normal * disp;

  // Normal stays approximately correct because displacement is small.
  vNormal = normalize(normalMatrix * normal);

  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;
  vec4 mvPos = viewMatrix * worldPos;
  vViewDir = normalize(-mvPos.xyz);
  gl_Position = projectionMatrix * mvPos;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vViewDir;
varying float vNoise;

uniform float uTime;
uniform vec3 uColorA; // deep violet  (#5b21b6)
uniform vec3 uColorB; // magenta hi   (#c026d3)
uniform vec3 uColorC; // royal blue   (#1d4ed8)
uniform vec3 uColorD; // cyan glow    (#22d3ee)
uniform float uFlowSpeed;

${NOISE_GLSL}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);

  // Two flowing noise layers determine where each colour dominates.
  float nA = snoise(vWorldPos * 1.4 + vec3(uTime * uFlowSpeed * 0.5, uTime * uFlowSpeed * 0.4, uTime * uFlowSpeed * 0.3));
  float nB = snoise(vWorldPos * 0.7 - vec3(uTime * uFlowSpeed * 0.35, 0.0, uTime * uFlowSpeed * 0.25));
  float tA = clamp(0.5 + nA * 0.5, 0.0, 1.0);
  float tB = clamp(0.5 + nB * 0.5, 0.0, 1.0);

  // Two cross gradients, then blended.
  vec3 grad1 = mix(uColorA, uColorB, tA); // violet → magenta
  vec3 grad2 = mix(uColorC, uColorD, tA); // blue → cyan
  vec3 baseColor = mix(grad1, grad2, tB);

  // Inject a brighter "swirl" highlight where noise is positive — bright cyan/magenta veins.
  float veins = smoothstep(0.55, 0.95, abs(nA + nB) * 0.5);
  baseColor = mix(baseColor, mix(uColorB, uColorD, tB), veins * 0.45);

  // Lighting — soft top-front key light, bottom-back fill (cyan).
  vec3 keyDir  = normalize(vec3(0.45, 0.65, 0.85));
  vec3 fillDir = normalize(vec3(-0.55, -0.25, 0.30));

  float key  = max(dot(N, keyDir), 0.0);
  float fill = max(dot(N, fillDir), 0.0);

  // Smooth wrap for the jelly softness.
  float wrap = pow(0.5 + 0.5 * dot(N, keyDir), 1.4);

  // Specular highlight (top-left glossy spot).
  vec3 H = normalize(keyDir + V);
  float spec = pow(max(dot(N, H), 0.0), 40.0);

  // Fresnel rim — makes the silhouette glow brightly.
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.2);

  vec3 ambient  = baseColor * 0.30;
  vec3 diffuse  = baseColor * (wrap * 0.65 + fill * 0.18);
  vec3 specCol  = vec3(1.0, 0.92, 1.0) * spec * 0.55;
  vec3 rim      = mix(uColorB, uColorD, tB) * fresnel * 0.95;

  // Subtle depth darkening near the centre for "thickness".
  float thickness = smoothstep(0.0, 1.0, 1.0 - fresnel);
  vec3 inner = mix(uColorA, vec3(0.05, 0.02, 0.10), thickness * 0.45);
  vec3 finalCol = ambient + diffuse + specCol + rim;
  finalCol = mix(finalCol, finalCol * 0.85 + inner * 0.15, thickness * 0.4);

  // Soft tone shape — keep highlights from blowing out, deepen mids.
  finalCol = pow(finalCol, vec3(0.92));

  gl_FragColor = vec4(finalCol, 1.0);
}
`;

/* ──────────────────────────────────────────────────────────────────────── */
/* Jelly orb mesh                                                           */
/* ──────────────────────────────────────────────────────────────────────── */

function JellyOrb({ isProcessing }: { isProcessing: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uDisplacement: { value: 0.075 }, // small — form preserved
      uFlowSpeed: { value: 0.18 }, // slow flow inside the orb
      uColorA: { value: new THREE.Color('#5b21b6') }, // deep violet
      uColorB: { value: new THREE.Color('#c026d3') }, // magenta highlight
      uColorC: { value: new THREE.Color('#1d4ed8') }, // royal blue
      uColorD: { value: new THREE.Color('#22d3ee') }, // cyan glow
    }),
    [],
  );

  // High-detail icosahedron so vertex displacement looks smooth.
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1, 5), []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms,
        transparent: false,
      }),
    [uniforms],
  );

  // Slow rotation around its own axes + gentle pitch/roll.
  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    uniforms.uTime.value = t;

    // Future hook: speed up flow when processing. Idle stays slow.
    uniforms.uFlowSpeed.value = isProcessing ? 0.45 : 0.18;

    if (groupRef.current) {
      // Primary spin on Y — visible but slow (≈ 1 turn / 42 s)
      groupRef.current.rotation.y += delta * 0.15;
      // Subtle pitch and roll so it feels alive, not mechanical
      groupRef.current.rotation.x = Math.sin(t * 0.08) * 0.12;
      groupRef.current.rotation.z = Math.cos(t * 0.06) * 0.06;
      // Tiny breathing scale (≤2%)
      const breath = 1 + Math.sin(t * 0.5) * 0.015;
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
/* Soft outer glow halo                                                     */
/* ──────────────────────────────────────────────────────────────────────── */

function GlowHalo() {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    const s = 1.25 + Math.sin(t * 0.6) * 0.025;
    meshRef.current.scale.setScalar(s);
  });
  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1, 32, 32]} />
      <meshBasicMaterial
        color="#7c3aed"
        transparent
        opacity={0.07}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.BackSide}
      />
    </mesh>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Camera setup                                                             */
/* ──────────────────────────────────────────────────────────────────────── */

function CameraRig() {
  const { camera } = useThree();
  useMemo(() => {
    camera.position.set(0, 0, 3.0);
    camera.lookAt(0, 0, 0);
  }, [camera]);
  return null;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Public component                                                         */
/* ──────────────────────────────────────────────────────────────────────── */

export default function QoreOrb3D({ isProcessing = false, className }: QoreOrb3DProps) {
  return (
    <div className={className} style={{ width: '100%', height: '100%' }}>
      <Canvas
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        camera={{ fov: 45, near: 0.1, far: 100, position: [0, 0, 3.0] }}
      >
        <CameraRig />
        <GlowHalo />
        <JellyOrb isProcessing={isProcessing} />
      </Canvas>
    </div>
  );
}
