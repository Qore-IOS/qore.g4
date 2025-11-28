'use client';
import { motion, AnimatePresence } from 'framer-motion';
import React, { useEffect, useState } from 'react';

interface AnimatedProductBoxProps {
  productName?: string;
  triggerAnimation: boolean;
  onAnimationEnd?: () => void;
}

const boxVariants = {
  closed: { rotateX: 0 },
  open: { rotateX: -120, transition: { duration: 0.6 } },
};

export default function AnimatedProductBox({ productName, triggerAnimation, onAnimationEnd }: AnimatedProductBoxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    if (triggerAnimation) {
      setIsOpen(true);
      setTimeout(() => setShowText(true), 600);
      setTimeout(() => {
        setIsOpen(false);
        setShowText(false);
        onAnimationEnd?.();
      }, 2200);
    }
  }, [triggerAnimation, onAnimationEnd]);

  return (
    <div className="relative w-64 h-40 bg-white rounded-md shadow-lg border border-gray-300">
      <motion.div
        className="absolute top-0 left-0 w-full h-1/2 bg-white border-b border-gray-300 origin-top"
        animate={isOpen ? 'open' : 'closed'}
        variants={boxVariants}
        style={{ transformStyle: 'preserve-3d' }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <AnimatePresence>
          {showText && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="text-center text-lg font-semibold text-green-700 border-t border-b border-green-500 px-4 py-2"
            >
              {productName}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
