/**
 * "Needs" on Case Detail (migration 041): what would help on the ground —
 * a fixed list, so everyone reads it in their own language. Public; only
 * the reporter (or the guest session that reported it) and the current
 * rescuer get the Edit control, and set_case_needs() checks exactly that
 * on the server — this only decides whether to offer the button.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n';
import { isCaseCreator, setCaseNeeds } from '../lib/api';
import { CASE_NEEDS, type CaseNeed, type CaseWithDetails } from '../lib/types';
import { useToast } from './ui';

export function NeedsPicker({ value, onChange }: { value: CaseNeed[]; onChange: (next: CaseNeed[]) => void }) {
  return (
    <div className="chip-row">
      {CASE_NEEDS.map((k) => {
        const on = value.includes(k);
        return (
          <button
            key={k}
            type="button"
            className={`chip${on ? ' active' : ''}`}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== k) : [...value, k])}
          >
            {t(`need.${k}` as const)}
          </button>
        );
      })}
    </div>
  );
}

export function CaseNeeds({ caseData, onSaved }: { caseData: CaseWithDetails; onSaved: () => void }) {
  const { user, profile } = useAuth();
  const toast = useToast();
  const needs = caseData.needs ?? [];
  const live = caseData.status !== 'resolved' && caseData.status !== 'closed';
  // A guest reporter has no reporter_id; their session is the case's
  // creator_uid, which is server-only — ask the server.
  const [creator, setCreator] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CaseNeed[]>(needs);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || caseData.reporter_id || !live) return setCreator(false);
    let alive = true;
    isCaseCreator(caseData.id).then((v) => alive && setCreator(v), () => {});
    return () => {
      alive = false;
    };
  }, [user, caseData.id, caseData.reporter_id, live]);

  // The column arrives with migration 041; before that there's nothing to show.
  if (caseData.needs === undefined) return null;

  const canEdit =
    live &&
    !!user &&
    !profile?.banned &&
    (user.id === caseData.reporter_id || user.id === caseData.rescuer_id || creator);

  if (needs.length === 0 && !canEdit) return null;

  const save = async () => {
    setBusy(true);
    try {
      await setCaseNeeds(caseData.id, draft);
      setEditing(false);
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="case-needs" aria-labelledby="case-needs-title">
      <div className="case-needs__head">
        <h2 id="case-needs-title" className="v2-h2">{t('need.title')}</h2>
        {canEdit && !editing && (
          <button
            type="button"
            className="case-needs__edit"
            onClick={() => {
              setDraft(needs);
              setEditing(true);
            }}
          >
            {needs.length ? t('need.edit') : t('need.add')}
          </button>
        )}
      </div>
      {editing ? (
        <>
          <NeedsPicker value={draft} onChange={setDraft} />
          <div className="case-needs__actions">
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void save()}>
              {busy ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </>
      ) : needs.length ? (
        <ul className="case-needs__list">
          {CASE_NEEDS.filter((k) => needs.includes(k)).map((k) => (
            <li key={k} className="v2-tag">{t(`need.${k}` as const)}</li>
          ))}
        </ul>
      ) : (
        <p className="page-subtitle">{t('need.none')}</p>
      )}
    </section>
  );
}
