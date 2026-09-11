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
      setOpen(false);
      setReason(null);
      setOther('');
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
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
    );
  }

  return (
    <div className="card" style={{ padding: 12, marginTop: small ? 6 : 0 }}>
      <div className="field__label" style={{ marginBottom: 8 }}>{t('mod.reportPrompt')}</div>
      <div className="segmented" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
        {REASONS.map((r) => (
          <button
            key={r}
            type="button"
            className={`segmented__option${reason === r ? ' active' : ''}`}
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
          style={{ marginBottom: 8, width: '100%' }}
        />
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn--danger btn--small"
          disabled={busy || !canSubmit}
          onClick={() => void submit()}
        >
          {t('mod.report')}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => {
            setOpen(false);
            setReason(null);
            setOther('');
          }}
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
