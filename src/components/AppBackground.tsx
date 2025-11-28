
'use client';

import React from 'react';
import { useTheme } from "next-themes";
import Beams from './Beams';
import Orb from '@/components/Orb';
import { useAuth } from '@/contexts/auth-context';
import { GradientSpheres } from './gradient-spheres';

export default function AppBackground() {
    const { resolvedTheme } = useTheme();
    const { isOrbAnimationEnabled } = useAuth();

    if (resolvedTheme === 'qore-dark') {
        return (
            <div className="fixed inset-0 -z-10">
                <Beams 
                    beamWidth={2}
                    beamHeight={15}
                    beamNumber={12}
                    lightColor="#ffffff"
                    speed={2}
                    noiseIntensity={1.75}
                    scale={0.2}
                    rotation={0}
                />
            </div>
        );
    }

    if (resolvedTheme === 'dark' && isOrbAnimationEnabled) {
      return (
        <>
          <div className="fixed inset-0 -z-10">
              <Orb
                hoverIntensity={0.5}
                rotateOnHover={true}
                hue={220}
                forceHoverState={false}
              />
          </div>
          <GradientSpheres />
        </>
      );
    }
    
    // For light theme or when orb animation is disabled, return null.
    return null;
}
