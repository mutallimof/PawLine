/**
 * Report button with a structured reason picker (B2).
 *
 * Shared by CaseDetailPage (target_type: 'case') and CaseChatPage
 * (target_type: 'case_message') — the two content_reports target types the
 * schema actually supports today (see the note in CaseChatPage about DMs).
 */
import { useState } from 'react';
import { reportContent } from '../lib/api';
import { t } from '../i18n';
import { useToast } from './ui';

const REASONS = ['wrong_content', 'not_animal', 'scam', 'duplicate', 'other'] as const;
type Reason = (typeof REASONS)[number];

/**
 * The report form itself, as a modal sheet.
 *
 * Exported separately from ReportButton so a caller that already has its own
 * trigger — the case chat's ⋯ menu — can close that menu and open the form
 * somewhere with room. Rendered inline inside a dropdown it was unusable: the
 * panel is anchored to a chat bubble, so on a phone it spilled off the left
 * edge and clipped both the question and the reason labels.
 */
export function ReportSheet({
  reporterId,
  targetType,
  targetCase,
  targetMessage,
  targetProfile,
  onClose,
}: {
  reporterId: string;
  targetType: 'case' | 'case_message';
  targetCase?: string;
  targetMessage?: number;
  targetProfile?: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<Reason | null>(null);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const canSubmit = reason && (reason !== 'other' || other.trim().length >= 3);

  const submit = async () => {
    if (!canSubmit || !reason) return;
    setBusy(true);
    try {
      await reportContent({
        reporterId,
        targetType,
        targetCase,
        targetMessage,
        targetProfile,
        reason: reason === 'other' ? other.trim() : t(`mod.reason.${reason}` as const),
      });
      toast(t('mod.reported'));
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('mod.reportPrompt')}
      onClick={onClose}
    >
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-sheet__title">{t('mod.reportPrompt')}</h2>
        {/* chip-row, not .segmented: that track gives each option 1/n of the
            width with nowrap + ellipsis, which cut five reasons down to
            "S…", "D…", "O…". Chips size to their label and wrap. */}
        <div className="chip-row" style={{ justifyContent: 'center', marginBottom: 14 }}>
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              className={`chip${reason === r ? ' active' : ''}`}
              onClick={() => setReason(r)}
            >
              {t(`mod.reason.${r}` as const)}
            </button>
          ))}
        </div>
        {reason === 'other' && (
          <input
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder={t('mod.reasonOtherPlaceholder')}
            maxLength={500}
            style={{ marginBottom: 12, width: '100%' }}
          />
        )}
        <button
          type="button"
          className="btn btn--danger"
          disabled={busy || !canSubmit}
          onClick={() => void submit()}
        >
          {t('mod.report')}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          style={{ marginTop: 8 }}
          onClick={onClose}
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

/** Trigger + sheet, for callers that want the whole affordance in one piece. */
export function ReportButton({
  reporterId,
  targetType,
  targetCase,
  targetMessage,
  targetProfile,
  small,
}: {
  reporterId: string;
  targetType: 'case' | 'case_message';
  targetCase?: string;
  targetMessage?: number;
  targetProfile?: string;
  small?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={small ? undefined : 'btn btn--ghost btn--small'}
        style={
          small
            ? { marginLeft: 8, fontSize: 11, color: 'var(--ink-soft)' }
            : { alignSelf: 'flex-end' }
        }
        title={t('mod.report')}
        aria-label={t('mod.report')}
        onClick={() => setOpen(true)}
      >
        ⚑{small ? '' : ` ${t('mod.report')}`}
      </button>
      {open && (
        <ReportSheet
          reporterId={reporterId}
          targetType={targetType}
          targetCase={targetCase}
          targetMessage={targetMessage}
          targetProfile={targetProfile}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
