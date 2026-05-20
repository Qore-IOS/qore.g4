'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface QoreOrb3DProps {
  isProcessing?: boolean;
  className?: string;
}

const PARTICLE_COUNT = 4500;

const COLOR_PURPLE = new THREE.Color('#a855f7');
const COLOR_VIOLET = new THREE.Color('#7c3aed');
const COLOR_BLUE = new THREE.Color('#3b82f6');
const COLOR_CYAN = new THREE.Color('#22d3ee');

function fibonacciSphere(count: number) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const offsets = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const golden = Math.PI * (3 - Math.sqrt(5));

  const tmp = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const theta = golden * i;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;

    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Gradient: top-left purple → bottom-right cyan, with violet/blue midtones
    const mixA = (x + 1) * 0.5;
    const mixB = (y + 1) * 0.5;
    tmp.copy(COLOR_PURPLE).lerp(COLOR_VIOLET, mixB);
    const tmp2 = COLOR_BLUE.clone().lerp(COLOR_CYAN, mixA);
    tmp.lerp(tmp2, 1 - mixB * 0.7);

    colors[i * 3 + 0] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;

    // Random scatter offset (where each particle drifts to when "processing")
    const sx = (Math.random() - 0.5) * 2.0;
    const sy = (Math.random() - 0.5) * 2.0;
    const sz = (Math.random() - 0.5) * 2.0;
    offsets[i * 3 + 0] = sx;
    offsets[i * 3 + 1] = sy;
    offsets[i * 3 + 2] = sz;

    seeds[i] = Math.random() * 1000;
  }

  return { positions, colors, offsets, seeds };
}

function ParticleOrb({ isProcessing }: { isProcessing: boolean }) {
  const pointsRef = useRef<THREE.Points>(null);
  const groupRef = useRef<THREE.Group>(null);
  const data = useMemo(() => fibonacciSphere(PARTICLE_COUNT), []);

  // Animation state (smoothly lerps between 0 = idle / 1 = processing)
  const stateRef = useRef(0);
  // Smooth random target rotations for idle wandering
  const targetRotation = useRef({ x: 0, y: 0, z: 0 });
  const currentRotation = useRef({ x: 0, y: 0, z: 0 });
  const wanderTimer = useRef(0);
  const baseTime = useRef(Math.random() * 100);

  const geometryRef = useRef<THREE.BufferGeometry>(null);

  // Build geometry once
  useEffect(() => {
    if (!geometryRef.current) return;
    geometryRef.current.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(data.positions), 3),
    );
    geometryRef.current.setAttribute(
      'color',
      new THREE.BufferAttribute(data.colors, 3),
    );
  }, [data]);

  // Build particle texture (soft round sprite) once
  const particleTexture = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }, []);

  useFrame((state, delta) => {
    if (!geometryRef.current || !pointsRef.current || !groupRef.current) return;
    const dt = Math.min(delta, 0.06);
    const t = state.clock.elapsedTime + baseTime.current;

    // Smoothly approach the desired state (0 = idle, 1 = scattered)
    const target = isProcessing ? 1 : 0;
    stateRef.current += (target - stateRef.current) * Math.min(1, dt * 2.2);
    const s = stateRef.current;

    // ── Idle: pick new random rotation targets occasionally for smooth wandering
    wanderTimer.current -= dt;
    if (wanderTimer.current <= 0) {
      wanderTimer.current = 2.5 + Math.random() * 2.5;
      targetRotation.current.x += (Math.random() - 0.5) * 0.7;
      targetRotation.current.y += (Math.random() - 0.5) * 1.6;
      targetRotation.current.z += (Math.random() - 0.5) * 0.4;
    }

    // Smooth rotation lerp (additional global rotation increases when processing)
    const idleSpeed = 0.7;
    const procBoost = 1 + s * 2.5;
    currentRotation.current.x += (targetRotation.current.x - currentRotation.current.x) * dt * idleSpeed;
    currentRotation.current.y += (targetRotation.current.y - currentRotation.current.y) * dt * idleSpeed;
    currentRotation.current.z += (targetRotation.current.z - currentRotation.current.z) * dt * idleSpeed;

    groupRef.current.rotation.x = currentRotation.current.x + t * 0.05 * procBoost;
    groupRef.current.rotation.y = currentRotation.current.y + t * 0.12 * procBoost;
    groupRef.current.rotation.z = currentRotation.current.z + Math.sin(t * 0.2) * 0.08;

    // Breathing scale (subtle when idle, more pronounced when processing)
    const breath = 1 + Math.sin(t * 0.8) * (0.03 + s * 0.04);
    groupRef.current.scale.setScalar(breath);

    // Update each particle's position
    const positions = geometryRef.current.attributes.position.array as Float32Array;
    const base = data.positions;
    const offsets = data.offsets;
    const seeds = data.seeds;

    // Idle radius slightly < 1; scatter pushes outward up to ~2.2
    const idleRadius = 1.0;
    const scatterRadius = 2.2;
    const easeS = s * s * (3 - 2 * s); // smoothstep

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      const bx = base[i3 + 0];
      const by = base[i3 + 1];
      const bz = base[i3 + 2];

      const ox = offsets[i3 + 0];
      const oy = offsets[i3 + 1];
      const oz = offsets[i3 + 2];

      const seed = seeds[i];

      // Smooth flowing distortion of the sphere surface (idle "fluid" look)
      const wob = Math.sin(t * 0.9 + seed * 0.07) * 0.04
                + Math.cos(t * 0.6 + seed * 0.13) * 0.04;

      // Increased turbulence during processing
      const turb = easeS * (
          Math.sin(t * 3.2 + seed * 0.5) * 0.4 +
          Math.cos(t * 2.7 + seed * 0.3) * 0.35
        );

      // Idle target: slightly wobbling sphere
      const ix = bx * (idleRadius + wob);
      const iy = by * (idleRadius + wob);
      const iz = bz * (idleRadius + wob);

      // Scatter target: pushed along its own offset vector + turbulence
      const sx = bx * scatterRadius + ox * 0.9 + Math.sin(t * 1.5 + seed) * 0.25;
      const sy = by * scatterRadius + oy * 0.9 + Math.cos(t * 1.4 + seed * 0.9) * 0.25;
      const sz = bz * scatterRadius + oz * 0.9 + Math.sin(t * 1.7 + seed * 1.1) * 0.25;

      positions[i3 + 0] = ix + (sx - ix) * easeS + turb * 0.1;
      positions[i3 + 1] = iy + (sy - iy) * easeS + turb * 0.1;
      positions[i3 + 2] = iz + (sz - iz) * easeS + turb * 0.1;
    }

    geometryRef.current.attributes.position.needsUpdate = true;

    // Material adjustments
    const mat = pointsRef.current.material as THREE.PointsMaterial;
    if (mat) {
      mat.opacity = 0.85 + s * 0.1;
      mat.size = 0.045 + s * 0.018;
    }
  });

  return (
    <group ref={groupRef}>
      <points ref={pointsRef}>
        <bufferGeometry ref={geometryRef} />
        <pointsMaterial
          size={0.05}
          vertexColors
          transparent
          opacity={0.9}
          depthWrite={false}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          map={particleTexture ?? undefined}
        />
      </points>
    </group>
  );
}

function GlowSphere({ isProcessing }: { isProcessing: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const stateRef = useRef(0);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const target = isProcessing ? 1 : 0;
    stateRef.current += (target - stateRef.current) * Math.min(1, delta * 2.2);
    const t = state.clock.elapsedTime;
    const breath = 1.05 + Math.sin(t * 0.7) * 0.035;
    meshRef.current.scale.setScalar(breath);
    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    if (mat) mat.opacity = (0.18 - stateRef.current * 0.13);
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.92, 32, 32]} />
      <meshBasicMaterial color="#6d28d9" transparent opacity={0.18} blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}

function CameraRig() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 0, 3.2);
    camera.lookAt(0, 0, 0);
  }, [camera]);
  return null;
}

export default function QoreOrb3D({ isProcessing = false, className }: QoreOrb3DProps) {
  return (
    <div className={className} style={{ width: '100%', height: '100%' }}>
      <Canvas
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        camera={{ fov: 50, near: 0.1, far: 100, position: [0, 0, 3.2] }}
      >
        <CameraRig />
        <ambientLight intensity={0.3} />
        <GlowSphere isProcessing={isProcessing} />
        <ParticleOrb isProcessing={isProcessing} />
      </Canvas>
    </div>
  );
}
