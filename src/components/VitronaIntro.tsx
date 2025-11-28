
'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export default function VitronaIntro() {
  return (
    <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="text-[64px] text-purple-500 font-headline tracking-wider"
      >
        vitrona
      </motion.div>
    </div>
  );
}
