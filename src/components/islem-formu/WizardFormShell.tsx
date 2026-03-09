'use client';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import './wizard-form.css';

/** Light single-tap haptic feedback */
export const haptic = () => {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(1);
  }
};

export type WizardHeading = {
  id: string;
  label: string;
  isComplete: boolean;
  /** If true, this heading is rendered inline (side-by-side) with other inline headings */
  inline?: boolean;
  /** Small sublabel shown below the heading when complete */
  completedSublabel?: string;
};

type WizardView = { type: 'list' } | { type: 'detail'; headingId: string } | { type: 'save_confirm' };

type TransitionState = 'idle' | 'exiting-to-detail' | 'entering-detail' | 'exiting-to-list' | 'entering-list';

interface WizardFormShellProps {
  headings: WizardHeading[];
  /** Render the detail content for a given heading id */
  renderDetail: (headingId: string, goBack: () => void) => React.ReactNode;
  /** Render the save confirmation screen */
  renderSaveConfirm?: (goBack: () => void) => React.ReactNode;
  /** Called when user clicks a heading */
  onHeadingClick?: (headingId: string) => void;
  /** Called when user clicks Kaydet */
  onSave?: () => void;
  /** Called when user clicks Ara Kayıt */
  onSaveDraft?: () => void;
  /** Whether saving is in progress */
  isSaving?: boolean;
  isSavingDraft?: boolean;
  /** Whether the save button should be disabled */
  saveDisabled?: boolean;
  /** Use grid layout on tablets */
  useGrid?: boolean;
  /** Custom class for the content area */
  className?: string;
}

export default function WizardFormShell({
  headings,
  renderDetail,
  renderSaveConfirm,
  onHeadingClick,
  onSave,
  onSaveDraft,
  isSaving = false,
  isSavingDraft = false,
  saveDisabled = false,
  useGrid = true,
  className = '',
}: WizardFormShellProps) {
  const [view, setView] = useState<WizardView>({ type: 'list' });
  const [transition, setTransition] = useState<TransitionState>('idle');
  const contentRef = useRef<HTMLDivElement>(null);
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
    };
  }, []);

  const navigateToDetail = useCallback((headingId: string) => {
    if (transition !== 'idle') return;
    haptic();
    onHeadingClick?.(headingId);
    setTransition('exiting-to-detail');
    animationTimeoutRef.current = setTimeout(() => {
      setView({ type: 'detail', headingId });
      setTransition('entering-detail');
      animationTimeoutRef.current = setTimeout(() => {
        setTransition('idle');
      }, 300);
    }, 280);
  }, [transition, onHeadingClick]);

  const navigateToList = useCallback(() => {
    if (transition !== 'idle') return;
    haptic();
    setTransition('exiting-to-list');
    animationTimeoutRef.current = setTimeout(() => {
      setView({ type: 'list' });
      setTransition('entering-list');
      animationTimeoutRef.current = setTimeout(() => {
        setTransition('idle');
      }, 300);
    }, 250);
  }, [transition]);

  const navigateToSaveConfirm = useCallback(() => {
    if (transition !== 'idle') return;
    haptic();
    setTransition('exiting-to-detail');
    animationTimeoutRef.current = setTimeout(() => {
      setView({ type: 'save_confirm' });
      setTransition('entering-detail');
      animationTimeoutRef.current = setTimeout(() => {
        setTransition('idle');
      }, 300);
    }, 280);
  }, [transition]);

  // Group inline headings together
  const renderHeadingContent = (heading: WizardHeading, small = false) => (
    <>
      <span className="wizard-heading-arrow wizard-heading-arrow-right" aria-hidden="true">→</span>
      <span className="wizard-heading-arrow wizard-heading-arrow-left" aria-hidden="true">→</span>
      <span className="wizard-heading-circle" aria-hidden="true" />
      <div className="wizard-heading-content">
        <div className={`wizard-heading-label ${small ? 'wizard-heading-label-small' : ''}`}>{heading.label}</div>
        {heading.isComplete && heading.completedSublabel && (
          <div className="wizard-heading-sublabel">{heading.completedSublabel}</div>
        )}
      </div>
      {heading.isComplete && (
        <div className="wizard-checkmark" aria-label="Tamamlandı">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      )}
    </>
  );

  const renderHeadingList = () => {
    const groups: Array<WizardHeading | WizardHeading[]> = [];
    let inlineBuffer: WizardHeading[] = [];

    headings.forEach((h, i) => {
      if (h.inline) {
        inlineBuffer.push(h);
        // Check if next heading is not inline - flush buffer
        const next = headings[i + 1];
        if (!next || !next.inline) {
          groups.push([...inlineBuffer]);
          inlineBuffer = [];
        }
      } else {
        groups.push(h);
      }
    });

    const exitClass = transition === 'exiting-to-detail' ? 'wizard-heading-exit' : '';
    const enterClass = transition === 'entering-list' ? 'wizard-heading-enter' : '';

    return (
      <div className={`wizard-heading-list ${useGrid ? 'wizard-grid-mode' : ''} ${exitClass} ${enterClass}`}>
        {groups.map((group, idx) => {
          if (Array.isArray(group)) {
            // Inline group
            return (
              <div key={`inline-${idx}`} className="wizard-inline-row wizard-stagger-item" style={{ animationDelay: `${idx * 50}ms` }}>
                {group.map(h => (
                  <div
                    key={h.id}
                    className="wizard-heading-row wizard-heading-row-inline"
                    onClick={() => navigateToDetail(h.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && navigateToDetail(h.id)}
                  >
                    {renderHeadingContent(h, true)}
                  </div>
                ))}
              </div>
            );
          }

          // Regular heading
          const h = group;
          return (
            <div
              key={h.id}
              className="wizard-heading-row wizard-stagger-item"
              style={{ animationDelay: `${idx * 50}ms` }}
              onClick={() => navigateToDetail(h.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigateToDetail(h.id)}
            >
              {renderHeadingContent(h)}
            </div>
          );
        })}

        {/* Bottom buttons */}
        <div className="wizard-bottom-buttons">
          <button
            className="wizard-btn wizard-btn-secondary"
            onClick={() => { haptic(); onSaveDraft?.(); }}
            disabled={isSavingDraft || isSaving}
          >
            {isSavingDraft ? 'Kaydediliyor...' : 'ARA KAYIT'}
          </button>
          <button
            className="wizard-btn wizard-btn-primary"
            onClick={() => { haptic(); (renderSaveConfirm ? navigateToSaveConfirm : onSave)?.(); }}
            disabled={saveDisabled || isSaving}
          >
            {isSaving ? 'Kaydediliyor...' : 'KAYDET'}
          </button>
        </div>
      </div>
    );
  };

  const renderDetailView = () => {
    if (view.type !== 'detail') return null;
    const heading = headings.find(h => h.id === view.headingId);
    if (!heading) return null;

    const animClass = transition === 'entering-detail' ? 'wizard-detail-enter' : transition === 'exiting-to-list' ? 'wizard-detail-exit' : '';

    return (
      <div className={`wizard-detail-screen ${animClass}`}>
        <div className="wizard-detail-header">
          <button className="wizard-back-button" onClick={navigateToList} aria-label="Geri dön">
            <ArrowLeft size={22} />
          </button>
          <span className="wizard-detail-title">{heading.label}</span>
        </div>
        <div className="wizard-detail-body">
          {renderDetail(view.headingId, navigateToList)}
        </div>
      </div>
    );
  };

  const renderSaveConfirmView = () => {
    if (view.type !== 'save_confirm' || !renderSaveConfirm) return null;

    const animClass = transition === 'entering-detail' ? 'wizard-detail-enter' : transition === 'exiting-to-list' ? 'wizard-detail-exit' : '';

    return (
      <div className={`wizard-detail-screen ${animClass}`}>
        <div className="wizard-detail-header">
          <button className="wizard-back-button" onClick={navigateToList} aria-label="Geri dön">
            <ArrowLeft size={22} />
          </button>
          <span className="wizard-detail-title">KAYDET</span>
        </div>
        <div className="wizard-detail-body">
          {renderSaveConfirm(navigateToList)}
        </div>
      </div>
    );
  };

  const handleHapticCapture = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const interactive = target.closest('button, [role="button"], [role="radio"], .wizard-option-item, .wizard-heading-row, .wizard-action-item-delete, .wizard-sub-tab, .wizard-add-button, .wizard-personel-item, [onclick], [data-haptic]');
    if (interactive) haptic();
  }, []);

  return (
    <div className={`wizard-content-area ${className}`} ref={contentRef} onClickCapture={handleHapticCapture}>
      {view.type === 'list' && renderHeadingList()}
      {view.type === 'detail' && renderDetailView()}
      {view.type === 'save_confirm' && renderSaveConfirmView()}
    </div>
  );
}
