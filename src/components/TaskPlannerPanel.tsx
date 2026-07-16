'use client';

import { useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TaskPlannerPanelProps {
  open: boolean;
  onClose: () => void;
}

const PLANNER_BASE_URL = 'https://qore-flow-task-manager-667720086890.us-west1.run.app/';

export default function TaskPlannerPanel({ open, onClose }: TaskPlannerPanelProps) {
  const plannerUrl = useMemo(() => {
    const url = new URL(PLANNER_BASE_URL);

    // The planner is hosted as an embedded micro-frontend. These flags let the
    // planner render its desktop split layout and mobile gesture/round-control
    // fixes when it is opened from the Qore shell, while remaining harmless for
    // older deployments that do not know the flags yet.
    url.searchParams.set('embed', 'qore');
    url.searchParams.set('layout', 'today-calendar-tasks');
    url.searchParams.set('desktopSidebar', 'calendar-tasks');
    url.searchParams.set('mobileControls', 'compact-round');
    url.searchParams.set('mobileSwipeDays', '1');

    return url.toString();
  }, []);

  // ESC tuşu ile kapatma
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onClose]);

  // Body scroll'u kilitle
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const broadcastViewport = () => {
      const frame = document.getElementById('task-planner-frame') as HTMLIFrameElement | null;
      frame?.contentWindow?.postMessage(
        {
          source: 'qore-shell',
          type: 'qore-planner-viewport',
          payload: {
            width: window.innerWidth,
            height: window.innerHeight,
            isMobile: window.matchMedia('(max-width: 767px)').matches,
            requestedFeatures: {
              desktopUnifiedTodayCalendarTasks: true,
              mobileRoundActionControls: true,
              mobileSwipeDayNavigation: true,
            },
          },
        },
        PLANNER_BASE_URL
      );
    };

    broadcastViewport();
    window.addEventListener('resize', broadcastViewport);
    return () => window.removeEventListener('resize', broadcastViewport);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm',
        'animate-in fade-in-0 duration-200'
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        className={cn(
          'absolute right-3 top-3 z-20 h-10 w-10 rounded-full',
          'bg-background/80 shadow-lg backdrop-blur-md hover:bg-background'
        )}
      >
        <X className="h-5 w-5" />
        <span className="sr-only">Kapat</span>
      </Button>

      {/* İframe Container */}
      <div className="h-full w-full overflow-hidden">
        <iframe
          id="task-planner-frame"
          src={plannerUrl}
          className="h-dvh w-screen border-0"
          title="Task Planner"
          allow="clipboard-read; clipboard-write; fullscreen; web-share; vibrate"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={(event) => {
            event.currentTarget.contentWindow?.postMessage(
              { source: 'qore-shell', type: 'qore-planner-ready' },
              PLANNER_BASE_URL
            );
          }}
        />
      </div>
    </div>
  );
}
