'use client';
import React, { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Button } from './ui/button';
import { Redo, Trash2 } from 'lucide-react';

interface SignaturePadProps {
  width?: number;
  height?: number;
  className?: string;
}

export interface SignaturePadRef {
  getSignature: () => string | undefined;
  clear: () => void;
}

const SignaturePad = forwardRef<SignaturePadRef, SignaturePadProps>(({ width = 500, height = 200, className }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const history = useRef<ImageData[]>([]);
  const historyStep = useRef(-1);

  const getContext = () => canvasRef.current?.getContext('2d');

  const saveState = () => {
    const ctx = getContext();
    if (!ctx || !canvasRef.current) return;
    // Trim history if we've undone
    if (historyStep.current < history.current.length - 1) {
        history.current = history.current.slice(0, historyStep.current + 1);
    }
    history.current.push(ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height));
    historyStep.current = history.current.length - 1;
  };

  const undo = () => {
    const ctx = getContext();
    if (!ctx || historyStep.current <= 0) return;
    historyStep.current -= 1;
    ctx.putImageData(history.current[historyStep.current], 0, 0);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = getContext();
    if (!ctx) return;

    // Set initial canvas size and context properties
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'hsl(var(--foreground))';

    saveState(); // Save initial blank state

    const getPosition = (e: MouseEvent | TouchEvent) => {
        const rect = canvas.getBoundingClientRect();
        const event = 'touches' in e ? e.touches[0] : e;
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
    };

    const startDrawing = (e: MouseEvent | TouchEvent) => {
        e.preventDefault();
        const { x, y } = getPosition(e);
        isDrawing.current = true;
        ctx.beginPath();
        ctx.moveTo(x, y);
    };

    const draw = (e: MouseEvent | TouchEvent) => {
        if (!isDrawing.current) return;
        e.preventDefault();
        const { x, y } = getPosition(e);
        ctx.lineTo(x, y);
        ctx.stroke();
    };

    const endDrawing = () => {
        if (!isDrawing.current) return;
        isDrawing.current = false;
        ctx.closePath();
        saveState();
    };

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', endDrawing);
    canvas.addEventListener('mouseleave', endDrawing);

    canvas.addEventListener('touchstart', startDrawing);
    canvas.addEventListener('touchmove', draw);
    canvas.addEventListener('touchend', endDrawing);

    return () => {
        canvas.removeEventListener('mousedown', startDrawing);
        canvas.removeEventListener('mousemove', draw);
        canvas.removeEventListener('mouseup', endDrawing);
        canvas.removeEventListener('mouseleave', endDrawing);

        canvas.removeEventListener('touchstart', startDrawing);
        canvas.removeEventListener('touchmove', draw);
        canvas.removeEventListener('touchend', endDrawing);
    };
  }, [width, height]);

  useImperativeHandle(ref, () => ({
    getSignature: () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Check if canvas is blank
      const ctx = getContext();
      if (!ctx) return;
      const pixelBuffer = new Uint32Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
      const isBlank = !pixelBuffer.some(color => color !== 0);
      if (isBlank) return undefined;

      return canvas.toDataURL('image/png');
    },
    clear: () => {
      const ctx = getContext();
      if (!ctx || !canvasRef.current) return;
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      history.current = [ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height)];
      historyStep.current = 0;
    },
  }));

  return (
    <div className={`relative w-[${width}px] h-[${height}px] ${className}`}>
      <canvas ref={canvasRef} className="border rounded-md bg-background" />
      <div className="absolute top-2 right-2 flex gap-1">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={undo} title="Geri Al">
            <Redo className="h-4 w-4" style={{transform: 'scaleX(-1)'}} />
        </Button>
      </div>
    </div>
  );
});

SignaturePad.displayName = 'SignaturePad';

export default SignaturePad;
