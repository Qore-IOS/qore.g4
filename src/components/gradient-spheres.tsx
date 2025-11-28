'use client';
import React from 'react';

export function GradientSpheres() {
  return (
    <div className="gradient-spheres">
      <div className="sphere sphere-purple" />
      <div className="sphere sphere-blue" />
      <div className="sphere sphere-orange" />
      <div className="pointer-events-none fixed top-0 left-0 z-0 w-[400px] h-[400px] rounded-full bg-purple-500 opacity-30 blur-3xl animate-pulse-slow" />
      <div className="pointer-events-none fixed top-1/2 right-0 z-0 w-[500px] h-[500px] rounded-full bg-blue-500 opacity-30 blur-3xl animate-move-x" />
      <div className="pointer-events-none fixed bottom-[20%] left-1/4 z-0 w-[300px] h-[300px] rounded-full bg-red-500 opacity-30 blur-3xl animate-pulse-slower" />
    </div>
  );
}
