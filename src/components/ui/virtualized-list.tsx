'use client';

/**
 * @fileoverview Virtualized List Component
 * @description High-performance virtualized list using @tanstack/react-virtual
 * for rendering large datasets efficiently. Only renders visible items.
 */

import React, { useRef, useCallback, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';

// =============================================================================
// TYPES
// =============================================================================

export interface VirtualizedListProps<T> {
  /** Array of items to render */
  items: T[];
  /** Height of each item in pixels */
  estimateSize: number;
  /** Height of the container */
  height: number | string;
  /** Render function for each item */
  renderItem: (item: T, index: number, isScrolling: boolean) => React.ReactNode;
  /** Optional key extractor */
  getItemKey?: (item: T, index: number) => string | number;
  /** Optional class name for container */
  className?: string;
  /** Overscan count - how many items to render outside visible area */
  overscan?: number;
  /** Optional empty state */
  emptyState?: React.ReactNode;
  /** Gap between items */
  gap?: number;
}

// =============================================================================
// COMPONENT
// =============================================================================

function VirtualizedListInner<T>({
  items,
  estimateSize,
  height,
  renderItem,
  getItemKey,
  className,
  overscan = 5,
  emptyState,
  gap = 0,
}: VirtualizedListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize + gap,
    overscan,
    getItemKey: getItemKey
      ? (index) => getItemKey(items[index], index)
      : undefined,
  });

  const virtualItems = virtualizer.getVirtualItems();

  if (items.length === 0 && emptyState) {
    return (
      <div
        className={cn("flex items-center justify-center", className)}
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
      >
        {emptyState}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={cn("overflow-auto", className)}
      style={{ height: typeof height === 'number' ? `${height}px` : height }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index];
          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {renderItem(item, virtualItem.index, false)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const VirtualizedList = memo(VirtualizedListInner) as typeof VirtualizedListInner;

// =============================================================================
// MEMOIZED ROW WRAPPER
// =============================================================================

export interface MemoizedRowProps<T> {
  item: T;
  index: number;
  renderContent: (item: T, index: number) => React.ReactNode;
}

/**
 * Memoized row wrapper to prevent unnecessary re-renders
 */
export function createMemoizedRow<T>() {
  return memo(function MemoizedRow({ item, index, renderContent }: MemoizedRowProps<T>) {
    return <>{renderContent(item, index)}</>;
  }, (prevProps, nextProps) => {
    // Only re-render if item reference changes
    return prevProps.item === nextProps.item && prevProps.index === nextProps.index;
  });
}

export default VirtualizedList;
