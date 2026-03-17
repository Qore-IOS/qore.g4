'use client';

import React, { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, RoundedBox, Environment } from '@react-three/drei';
import * as THREE from 'three';

// ─── Types ───────────────────────────────────────────────────────────
interface SampleRack3DProps {
  /** 100-element array: null = empty, string = specimen ID */
  specimens: (string | null)[];
  /** Index of the last placed specimen (triggers animation) */
  lastPlacedIndex: number | null;
  /** Grid columns (default 10) */
  cols?: number;
  /** Grid rows (default 10) */
  rows?: number;
  /** Callback when a slot is clicked */
  onSlotClick?: (index: number) => void;
}

// ─── Constants ───────────────────────────────────────────────────────
const SLOT_SPACING = 0.55;
const TUBE_RADIUS = 0.12;
const TUBE_HEIGHT = 0.7;
const RACK_PADDING = 0.3;
const RACK_THICKNESS = 0.15;
const RACK_HEIGHT = 0.35;
const DROP_HEIGHT = 4;
const DROP_DURATION = 0.6; // seconds

// ─── Helpers ─────────────────────────────────────────────────────────
const idxToPos = (index: number, cols = 10) => {
  const row = String.fromCharCode(65 + Math.floor(index / cols));
  const col = (index % cols) + 1;
  return `${row}${col}`;
};

// Ease-out bounce for drop animation
function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

// ─── TestTube component ──────────────────────────────────────────────
function TestTube({
  position,
  color,
  animate,
  label,
}: {
  position: [number, number, number];
  color: string;
  animate: boolean;
  label: string;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const progressRef = useRef(animate ? 0 : 1);
  const [hovered, setHovered] = useState(false);

  const targetY = position[1];
  const startY = targetY + DROP_HEIGHT;

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    if (progressRef.current < 1) {
      progressRef.current = Math.min(progressRef.current + delta / DROP_DURATION, 1);
      const easedProgress = easeOutBounce(progressRef.current);
      groupRef.current.position.y = startY + (targetY - startY) * easedProgress;
      // Slight rotation during drop
      groupRef.current.rotation.y = (1 - progressRef.current) * Math.PI * 2;
    }
  });

  return (
    <group
      ref={groupRef}
      position={animate ? [position[0], startY, position[2]] : position}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {/* Tube body */}
      <mesh position={[0, TUBE_HEIGHT / 2, 0]}>
        <cylinderGeometry args={[TUBE_RADIUS, TUBE_RADIUS * 0.85, TUBE_HEIGHT, 16]} />
        <meshPhysicalMaterial
          color={hovered ? '#ffffff' : color}
          transparent
          opacity={0.75}
          roughness={0.1}
          metalness={0.05}
          transmission={0.3}
          thickness={0.5}
        />
      </mesh>
      {/* Tube cap */}
      <mesh position={[0, TUBE_HEIGHT + 0.05, 0]}>
        <cylinderGeometry args={[TUBE_RADIUS * 1.15, TUBE_RADIUS * 1.15, 0.1, 16]} />
        <meshStandardMaterial color="#e74c3c" roughness={0.4} />
      </mesh>
      {/* Liquid inside */}
      <mesh position={[0, TUBE_HEIGHT * 0.28, 0]}>
        <cylinderGeometry args={[TUBE_RADIUS * 0.82, TUBE_RADIUS * 0.7, TUBE_HEIGHT * 0.5, 16]} />
        <meshStandardMaterial color="#c0392b" transparent opacity={0.6} />
      </mesh>
      {/* Label on hover */}
      {hovered && (
        <Text
          position={[0, TUBE_HEIGHT + 0.35, 0]}
          fontSize={0.15}
          color="#ffffff"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.01}
          outlineColor="#000000"
        >
          {label}
        </Text>
      )}
    </group>
  );
}

// ─── EmptySlot component ─────────────────────────────────────────────
function EmptySlot({
  position,
  label,
  onClick,
}: {
  position: [number, number, number];
  label: string;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <group position={position}>
      {/* Slot hole */}
      <mesh
        position={[0, RACK_HEIGHT + 0.01, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <ringGeometry args={[TUBE_RADIUS * 0.5, TUBE_RADIUS * 1.1, 16]} />
        <meshStandardMaterial
          color={hovered ? '#3498db' : '#555555'}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Slot label */}
      <Text
        position={[0, RACK_HEIGHT + 0.08, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.08}
        color={hovered ? '#3498db' : '#888888'}
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
    </group>
  );
}

// ─── RackBase component ──────────────────────────────────────────────
function RackBase({ rows, cols }: { rows: number; cols: number }) {
  const width = cols * SLOT_SPACING + RACK_PADDING * 2;
  const depth = rows * SLOT_SPACING + RACK_PADDING * 2;

  return (
    <group>
      {/* Main rack body */}
      <RoundedBox
        args={[width, RACK_THICKNESS, depth]}
        radius={0.05}
        position={[
          (cols - 1) * SLOT_SPACING * 0.5,
          RACK_HEIGHT - RACK_THICKNESS / 2,
          (rows - 1) * SLOT_SPACING * 0.5,
        ]}
      >
        <meshStandardMaterial color="#f0f0f0" roughness={0.3} metalness={0.1} />
      </RoundedBox>
      {/* Bottom support */}
      <RoundedBox
        args={[width, RACK_THICKNESS * 0.5, depth]}
        radius={0.03}
        position={[
          (cols - 1) * SLOT_SPACING * 0.5,
          RACK_THICKNESS * 0.25,
          (rows - 1) * SLOT_SPACING * 0.5,
        ]}
      >
        <meshStandardMaterial color="#e0e0e0" roughness={0.4} metalness={0.05} />
      </RoundedBox>
      {/* Support pillars at corners */}
      {[
        [-RACK_PADDING * 0.5, (rows - 1) * SLOT_SPACING + RACK_PADDING * 0.5],
        [cols * SLOT_SPACING - SLOT_SPACING + RACK_PADDING * 0.5, (rows - 1) * SLOT_SPACING + RACK_PADDING * 0.5],
        [-RACK_PADDING * 0.5, -RACK_PADDING * 0.5],
        [cols * SLOT_SPACING - SLOT_SPACING + RACK_PADDING * 0.5, -RACK_PADDING * 0.5],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, RACK_HEIGHT / 2, z]}>
          <cylinderGeometry args={[0.06, 0.06, RACK_HEIGHT, 8]} />
          <meshStandardMaterial color="#cccccc" roughness={0.3} />
        </mesh>
      ))}

      {/* Row labels (A, B, C...) on the left side */}
      {Array.from({ length: rows }).map((_, r) => (
        <Text
          key={`row-${r}`}
          position={[
            -RACK_PADDING * 1.2,
            RACK_HEIGHT + 0.08,
            r * SLOT_SPACING,
          ]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.14}
          color="#666666"
          anchorX="center"
          anchorY="middle"
          fontWeight="bold"
        >
          {String.fromCharCode(65 + r)}
        </Text>
      ))}

      {/* Column labels (1, 2, 3...) on front */}
      {Array.from({ length: cols }).map((_, c) => (
        <Text
          key={`col-${c}`}
          position={[
            c * SLOT_SPACING,
            RACK_HEIGHT + 0.08,
            -RACK_PADDING * 1.2,
          ]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.14}
          color="#666666"
          anchorX="center"
          anchorY="middle"
          fontWeight="bold"
        >
          {String(c + 1)}
        </Text>
      ))}
    </group>
  );
}

// ─── Scene ───────────────────────────────────────────────────────────
function Scene({
  specimens,
  lastPlacedIndex,
  cols,
  rows,
  onSlotClick,
}: SampleRack3DProps) {
  const effectiveCols = cols ?? 10;
  const effectiveRows = rows ?? 10;

  // Track which indices have been animated
  const animatedRef = useRef<Set<number>>(new Set());

  // When lastPlacedIndex changes, mark it for animation
  useEffect(() => {
    if (lastPlacedIndex !== null && !animatedRef.current.has(lastPlacedIndex)) {
      animatedRef.current.add(lastPlacedIndex);
    }
  }, [lastPlacedIndex]);

  const tubeColors = useMemo(
    () => [
      '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
      '#1abc9c', '#e67e22', '#2980b9', '#27ae60', '#c0392b',
    ],
    []
  );

  // Calculate slot positions
  const slotPositions: [number, number, number][] = useMemo(() => {
    return Array.from({ length: effectiveRows * effectiveCols }).map((_, i) => {
      const row = Math.floor(i / effectiveCols);
      const col = i % effectiveCols;
      return [col * SLOT_SPACING, 0, row * SLOT_SPACING] as [number, number, number];
    });
  }, [effectiveRows, effectiveCols]);

  // Center offset
  const centerOffset: [number, number, number] = useMemo(
    () => [
      -((effectiveCols - 1) * SLOT_SPACING) / 2,
      0,
      -((effectiveRows - 1) * SLOT_SPACING) / 2,
    ],
    [effectiveCols, effectiveRows]
  );

  return (
    <group position={centerOffset}>
      <RackBase rows={effectiveRows} cols={effectiveCols} />

      {slotPositions.map((pos, i) => {
        const specimen = specimens[i];
        if (specimen) {
          const shouldAnimate: boolean = lastPlacedIndex === i && animatedRef.current.has(i);
          const tubePos: [number, number, number] = [pos[0], RACK_HEIGHT, pos[2]];
          const color: string = tubeColors[i % tubeColors.length];
          return (
            <TestTube
              key={`tube-${i}-${specimen}`}
              position={tubePos}
              color={color}
              animate={shouldAnimate}
              label={`${idxToPos(i, effectiveCols)}: ${specimen}`}
            />
          );
        }
        const slotPos: [number, number, number] = [pos[0], pos[1], pos[2]];
        return (
          <EmptySlot
            key={`slot-${i}`}
            position={slotPos}
            label={idxToPos(i, effectiveCols)}
            onClick={() => onSlotClick?.(i)}
          />
        );
      })}
    </group>
  );
}

// ─── Main export ─────────────────────────────────────────────────────
export default function SampleRack3D(props: SampleRack3DProps) {
  const cols = props.cols ?? 10;
  const rows = props.rows ?? 10;

  return (
    <div className="w-full h-[500px] rounded-xl overflow-hidden border bg-gradient-to-b from-gray-900 to-gray-950">
      <Canvas
        camera={{ position: [0, 5, 6], fov: 45 }}
        shadows
        dpr={[1, 2]}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 8, 5]} intensity={1} castShadow />
        <directionalLight position={[-3, 4, -3]} intensity={0.3} />
        <pointLight position={[0, 6, 0]} intensity={0.5} color="#3498db" />

        <Scene {...props} cols={cols} rows={rows} />

        <OrbitControls
          makeDefault
          minPolarAngle={0.2}
          maxPolarAngle={Math.PI / 2.2}
          minDistance={3}
          maxDistance={12}
          enablePan={true}
          target={[0, 0.5, 0]}
        />

        {/* Ground plane */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color="#1a1a2e" />
        </mesh>
      </Canvas>
    </div>
  );
}
