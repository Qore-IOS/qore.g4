'use client';

import { useEffect } from 'react';

const NOTEBOOKLM_URL = 'https://notebooklm.google.com/notebook/14f0834f-3273-4d94-afc7-f8c2b931e4c2';

interface QoreAIPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function QoreAIPanel({ open, onClose }: QoreAIPanelProps) {
  useEffect(() => {
    if (open) {
      window.open(NOTEBOOKLM_URL, '_blank', 'noopener,noreferrer');
      onClose();
    }
  }, [open, onClose]);

  return null;
}
