/**
 * Smaller pages grouped together:
 *  - UserProfilePage:  public profile with a "Message" button (chat system 1)
 *  - VetPublicPage:    public clinic page with contact + message
 *  - VetSetupPage:     clinic onboarding (public contact, private manager
 *                      contact, accepted animals, hours, map pin, C1
 *                      verification documents)
 *  - VetDashboardPage: incoming requests + active cases for a clinic
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  blockUser,
  deleteVetDocument,
  fetchMyVet,
  fetchProfile,
  fetchVet,
  fetchVetDocuments,
  getOrCreateDm,
  getVetDocumentUrl,
  isUserBlocked,
  unblockUser,
  uploadVetDocument,
  upsertVet,
} from '../lib/api';
import { useCases } from '../hooks/useRealtime';
import { CaseCard, ScreenHeader, useToast, vetHoursBadge } from '../components/ui';
import { PinDropMap } from '../components/maps';
import { IconBlock, IconStethoscope, VetTag } from '../components/Icons';
import { DEFAULT_CENTER, getCurrentPosition, type LatLng } from '../lib/geo';
import { t } from '../i18n';
import type { AnimalType, Profile, Vet, VetDocument } from '../lib/types';

// ---------------------------------------------------------------------------
/**
 * The single guest / signed-out call to action used across this file: the
 * reason, plus an actual tappable route to sign-in. The two vet screens below
 * previously showed the reason with no way to act on it, which left a guest
 * stranded; every prompt in the app now offers the same way out.
 */
function SignInCta() {
  return (
    <>
      {t('dm.signIn')}
      <div style={{ marginTop: 14 }}>
        <Link to="/auth" className="btn btn--primary">{t('auth.signIn')}</Link>
      </div>
    </>
  );
}

export function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { user, isGuest, profile: me } = useAuth();
  // This page stays PUBLIC for guests — only the actions need an account.
  // DMs are user → approved clinic only (migration 032): there is no Message
  // button for a regular user's profile at all, and on a clinic's profile it
  // is offered only to regular users. get_or_create_dm() enforces the same
  // rule server-side; this just doesn't offer what would be refused.
  const isRegistered = !!user && !isGuest;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (id) fetchProfile(id).then(setProfile).catch(() => {});
  }, [id]);

  // B4: reflect current block state so the button reads Block vs Unblock.
  useEffect(() => {
    if (isRegistered && id && user.id !== id) {
      isUserBlocked(user.id, id).then(setBlocked).catch(() => {});
    }
  }, [user, isRegistered, id]);

  if (!profile) return <div className="page"><div className="spinner" /></div>;

  const message = async () => {
    if (!isRegistered) return navigate('/auth');
    try {
      navigate(`/messages/${await getOrCreateDm(profile.id)}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    }
  };

  const toggleBlock = async () => {
    if (!isRegistered) return navigate('/auth');
    setBusy(true);
    try {
      if (blocked) {
        await unblockUser(user.id, profile.id);
        setBlocked(false);
      } else {
        if (!window.confirm(t('settings.blockConfirm', { name: profile.display_name }))) return;
        await blockUser(user.id, profile.id);
        setBlocked(true);
        toast(t('settings.blocked_done'));
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page profile">
      <ScreenHeader title={t('nav.profile')} />
      <div className="profile__id">
        <div className="profile__avatar" aria-hidden="true">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" />
          ) : (
            profile.display_name.trim().charAt(0).toUpperCase() || '?'
          )}
        </div>
        <div className="profile__id-text">
          <h2 className="profile__name">
            {profile.display_name}
            {profile.role === 'vet' && <VetTag />}
          </h2>
          <div className="profile__role">{profile.role === 'vet' ? t('auth.roleVet') : t('profile.roleRescuer')}</div>
        </div>
      </div>

      {/* No tier badge: XP is off every user-facing surface until the
          ledger / ranking display replaces it. Animals helped stays. */}
      <div className="v2-stats profile__stats">
        <div className="v2-stat">
          <div className="v2-stat__value profile__stat--helped">{profile.cases_helped}</div>
          <div className="v2-stat__label">{t('profile.casesHelped')}</div>
        </div>
      </div>

      {!isRegistered && (
        <div style={{ marginTop: 14 }}>
          <SignInCta />
        </div>
      )}
      {isRegistered && user.id !== profile.id && (
        <div className="vet-page__actions">
          {profile.role === 'vet' && me?.role === 'user' && (
            <button className="btn btn--primary" onClick={() => void message()}>
              {t('dm.messageClinic')}
            </button>
          )}
          <button
            className="btn btn--secondary"
            aria-pressed={blocked}
            disabled={busy}
            onClick={() => void toggleBlock()}
          >
            <IconBlock size={18} /> {blocked ? t('settings.unblock') : t('settings.block')}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
/**
 * The clinic's stated daily hours, as a rescuer reads them. Mirrors how the
 * server's vet_within_hours() (010) interprets the same four columns, so the
 * label never disagrees with open_now:
 *   - is_24_7, or opens_at == closes_at (00:00–00:00)  → round the clock
 *   - closes_at < opens_at                             → overnight window
 *   - either time missing                              → hours not set (the
 *     server treats that as open, so this says so rather than implying closed)
 * Times are wall-clock in the CLINIC's timezone; the zone is named only when
 * it differs from the viewer's, where the times would otherwise mislead.
 */
function VetHours({ vet }: { vet: Vet }) {
  const hhmm = (s: string) => s.slice(0, 5);
  const allDay = vet.is_24_7 || (!!vet.opens_at && vet.opens_at === vet.closes_at);
  const set = !!vet.opens_at && !!vet.closes_at;
  const overnight = set && !allDay && vet.closes_at! < vet.opens_at!;

  let viewerTz = '';
  try {
    viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* no Intl zone support — just don't label */
  }
  const showTz = set && !allDay && !!vet.timezone && vet.timezone !== viewerTz;
  const tzCity = (vet.timezone || '').split('/').pop()?.replace(/_/g, ' ') ?? '';

  return (
    <div className="vet-hours">
      <div className="vet-hours__label">{t('vets.hoursTitle')}</div>
      <div className="vet-hours__value">
        {allDay ? (
          <span className="tag tag--always">{t('vets.hours247')}</span>
        ) : set ? (
          <>
            <span className="vet-hours__range">
              {hhmm(vet.opens_at!)}–{hhmm(vet.closes_at!)}
            </span>
            {overnight && <span className="vet-hours__note"> · {t('vets.hoursOvernight')}</span>}
          </>
        ) : (
          <span className="vet-hours__note">{t('vets.hoursNotSet')}</span>
        )}
        {vet.open_now && vet.is_open !== false && (
          <span className="vet-hours__open">● {t('vets.openNow')}</span>
        )}
      </div>
      {showTz && <div className="vet-hours__tz">{t('vets.hoursTz', { tz: tzCity })}</div>}
    </div>
  );
}

export function VetPublicPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isGuest, profile: me } = useAuth();
  // Public for guests; only messaging the clinic needs an account (same
  // get_or_create_dm() restriction as UserProfilePage above).
  const isRegistered = !!user && !isGuest;
  const [vet, setVet] = useState<Vet | null>(null);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (!id) return;
    fetchVet(id).then(setVet).catch(() => {});
    // No fetchProfile here any more: the profiles row was read only to render
    // a tier badge, and vets have no XP to tier (023). One less query per view.
  }, [id]);

  if (!vet) return <div className="page"><div className="spinner" /></div>;

  const message = async () => {
    if (!isRegistered) return navigate('/auth');
    try {
      navigate(`/messages/${await getOrCreateDm(vet.id)}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    }
  };

  const badge = vetHoursBadge(vet);
  return (
    <div className="page vet-page">
      <ScreenHeader title={t('vetsBrowse.title')} fallback="/vets" />

      <div className="vet-page__hero">
        <div className="vet-page__tile" aria-hidden="true">
          <IconStethoscope size={30} />
        </div>
        <h2 className="vet-page__name">{vet.clinic_name}</h2>
        <p className="vet-page__addr">{vet.address}</p>
        {badge && <span className={`v2-badge v2-badge--${badge.tone}`}>{badge.label}</span>}
      </div>

      <dl className="case-detail__kv vet-page__kv">
        {vet.contact_phone && (
          <div>
            <dt>{t('vets.phone')}</dt>
            <dd><a href={`tel:${vet.contact_phone}`}>{vet.contact_phone}</a></dd>
          </div>
        )}
        {vet.contact_email && (
          <div>
            <dt>{t('vets.email')}</dt>
            <dd><a href={`mailto:${vet.contact_email}`}>{vet.contact_email}</a></dd>
          </div>
        )}
        {vet.accepted_animals?.length > 0 && (
          <div>
            <dt>{t('vets.accepts')}</dt>
            <dd>{vet.accepted_animals.map((a) => t(`animal.${a}` as const)).join(' · ')}</dd>
          </div>
        )}
        {/* C2: rating, once the clinic has at least one */}
        {!!vet.rating_count && (
          <div>
            <dt>{t('vets.rating')}</dt>
            <dd>★ {vet.rating_avg?.toFixed(1)} · {t('vets.ratingCount', { n: vet.rating_count })}</dd>
          </div>
        )}
      </dl>

      {/* No tier badge here: this page is always a clinic, and vets earn no
          XP (023). The star rating above is a clinic's standing. */}
      <VetHours vet={vet} />

      <div className="vet-page__actions">
        {!isRegistered && <SignInCta />}
        {/* Any regular user can start a DM with a clinic; clinics can reply
            but never start one (get_or_create_dm refuses it, 032), so another
            vet isn't offered the button. */}
        {isRegistered && user.id !== vet.id && me?.role !== 'vet' && (
          <button className="btn btn--primary" onClick={() => void message()}>
            {t('dm.messageClinic')}
          </button>
        )}
        {vet.contact_phone && (
          <a className="btn btn--secondary" href={`tel:${vet.contact_phone}`}>{t('vets.call')}</a>
        )}
        <a
          className="btn btn--secondary"
          href={`https://www.google.com/maps/search/?api=1&query=${vet.lat},${vet.lng}`}
        >
          {t('case.getDirections')}
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
const ANIMAL_TYPES: AnimalType[] = ['dog', 'cat', 'other'];

export function VetSetupPage() {
  const { user, isGuest, profile } = useAuth();
  const [vetStatus, setVetStatus] = useState<'pending' | 'approved' | 'rejected' | null>(null);
  // Whether a `vets` row for this user actually exists yet — vet_documents.vet_id
  // is a FK into vets, so document upload must never fire before this is true
  // (otherwise it 23503s on vet_documents_vet_id_fkey).
  const [hasClinic, setHasClinic] = useState(false);

  // Public contact
  const [clinicName, setClinicName] = useState('');
  const [address, setAddress] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [acceptedAnimals, setAcceptedAnimals] = useState<AnimalType[]>(['dog', 'cat', 'other']);

  // Private — the clinic's internal contact, not necessarily the account holder
  const [managerName, setManagerName] = useState('');
  const [managerSurname, setManagerSurname] = useState('');
  const [managerPhone, setManagerPhone] = useState('');

  const [isOpen, setIsOpen] = useState(true);
  const [opensAt, setOpensAt] = useState('09:00');
  const [closesAt, setClosesAt] = useState('18:00');
  const [is247, setIs247] = useState(false);
  const [location, setLocation] = useState<LatLng>(DEFAULT_CENTER);
  const [busy, setBusy] = useState(false);

  // C1: verification documents — optional, no required types/validation.
  const [documents, setDocuments] = useState<VetDocument[]>([]);
  const [uploading, setUploading] = useState(false);

  const navigate = useNavigate();
  const toast = useToast();

  const reloadDocuments = () => {
    if (user) fetchVetDocuments(user.id).then(setDocuments).catch(() => {});
  };

  // Prefill from the vet's own full row (incl. private fields — fetchVet()
  // reads vets_public, which no longer carries manager_*/contact_email).
  useEffect(() => {
    if (!user) return;
    fetchMyVet().then((v) => {
      if (v) {
        setHasClinic(true);
        setVetStatus(v.status);
        setClinicName(v.clinic_name);
        setAddress(v.address);
        setContactPhone(v.contact_phone);
        setContactEmail(v.contact_email);
        setAcceptedAnimals(v.accepted_animals?.length ? v.accepted_animals : ['dog', 'cat', 'other']);
        setManagerName(v.manager_name ?? '');
        setManagerSurname(v.manager_surname ?? '');
        setManagerPhone(v.manager_phone ?? '');
        setIsOpen(v.is_open);
        // 'HH:MM:SS' from Postgres → 'HH:MM' for <input type="time">
        if (v.opens_at) setOpensAt(v.opens_at.slice(0, 5));
        if (v.closes_at) setClosesAt(v.closes_at.slice(0, 5));
        setIs247(v.is_24_7);
        setLocation({ lat: v.lat, lng: v.lng });
      } else {
        getCurrentPosition().then(setLocation).catch(() => {});
      }
    });
    reloadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Gate on a real ACCOUNT, not merely a session: a guest (anonymous session
  // minted by browsing) has a `user` but never a profiles row, so letting them
  // past here dropped them into the `!profile` spinner below forever. A
  // still-loading profile for a genuinely signed-in user still gets a spinner,
  // not an error (same class of bug as the ProfilePage sign-in gate).
  if (!user || isGuest) {
    return <div className="page"><div className="empty-state"><SignInCta /></div></div>;
  }
  if (!profile) {
    return <div className="page"><div className="spinner" /></div>;
  }
  if (profile.role !== 'vet') {
    return <div className="page"><div className="empty-state">{t('common.error')}</div></div>;
  }

  const toggleAnimal = (a: AnimalType) => {
    setAcceptedAnimals((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
    );
  };

  const save = async () => {
    if (!clinicName.trim()) return;
    setBusy(true);
    try {
      await upsertVet({
        clinic_name: clinicName.trim(),
        address: address.trim(),
        contact_phone: contactPhone.trim(),
        contact_email: contactEmail.trim(),
        manager_name: managerName.trim(),
        manager_surname: managerSurname.trim(),
        manager_phone: managerPhone.trim(),
        accepted_animals: acceptedAnimals,
        lat: location.lat,
        lng: location.lng,
        is_open: isOpen,
        // A 24/7 clinic's hours are irrelevant; store them anyway so the
        // clinic keeps its settings if it ever turns 24/7 back off.
        opens_at: `${opensAt}:00`,
        closes_at: `${closesAt}:00`,
        is_24_7: is247,
        // Wall-clock hours are meaningless without a zone. Baku is the launch
        // market default; Turkish clinics are an hour behind.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Baku',
      });
      // Only now does the vets row (which vet_documents.vet_id references)
      // actually exist — document upload stays gated until this succeeds.
      setHasClinic(true);
      navigate('/vet-dashboard');
    } catch (e) {
      toast(t('vetSetup.saveFailed').replace('{error}', e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const onUploadDocument = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !user) return;
    // Guard against the FK violation: vet_documents.vet_id references vets.id,
    // so there must be a saved clinic row before a document can attach to it.
    if (!hasClinic) {
      toast(t('vetSetup.saveBeforeUpload'));
      return;
    }
    setUploading(true);
    try {
      await uploadVetDocument(file, user.id);
      reloadDocuments();
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setUploading(false);
    }
  };

  const onDeleteDocument = async (doc: VetDocument) => {
    try {
      await deleteVetDocument(doc.id, doc.path);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    }
  };

  const viewDocument = (doc: VetDocument) => {
    void getVetDocumentUrl(doc.path)
      .then((url) => window.open(url, '_blank', 'noopener'))
      .catch(() => toast(t('common.error')));
  };

  return (
    <div className="page vet-setup">
      <ScreenHeader title={t('vetSetup.title')} fallback="/profile" />
      <p className="v2-sub">{t('vetSetup.subtitle')}</p>

      {vetStatus === 'pending' && <div className="banner banner--warn">{t('vetSetup.pending')}</div>}
      {vetStatus === 'rejected' && <div className="banner banner--warn">{t('vetSetup.rejected')}</div>}

      {/* Public contact — what rescuers and the public see. */}
      <div className="section-label">{t('vetSetup.publicSection')}</div>
      <label className="field">
        <span className="field__label">{t('vetSetup.clinicName')}</span>
        <input value={clinicName} onChange={(e) => setClinicName(e.target.value)} maxLength={100} />
      </label>
      <label className="field">
        <span className="field__label">{t('vetSetup.address')}</span>
        <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} />
      </label>
      <label className="field">
        <span className="field__label">{t('vetSetup.contactPhone')}</span>
        <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} maxLength={30} inputMode="tel" />
      </label>
      <label className="field">
        <span className="field__label">{t('vetSetup.contactEmail')}</span>
        <input
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          maxLength={120}
        />
      </label>

      <span className="field__label">{t('vetSetup.acceptedAnimals')}</span>
      <div className="segmented" style={{ margin: '6px 0 16px' }}>
        {ANIMAL_TYPES.map((a) => (
          <button
            key={a}
            type="button"
            className={`segmented__option${acceptedAnimals.includes(a) ? ' active' : ''}`}
            onClick={() => toggleAnimal(a)}
          >
            {t(`animal.${a}` as const)}
          </button>
        ))}
      </div>

      <span className="field__label">{t('vetSetup.pin')}</span>
      <div style={{ margin: '8px 0 16px' }}>
        <PinDropMap value={location} onChange={setLocation} />
      </div>

      {/* Private — the clinic's internal contact, kept off the public page. */}
      <div className="section-label">{t('vetSetup.privateSection')}</div>
      <p className="page-subtitle" style={{ marginTop: -4 }}>{t('vetSetup.privateSectionSub')}</p>
      <div style={{ display: 'flex', gap: 12 }}>
        <label className="field" style={{ flex: 1 }}>
          <span className="field__label">{t('vetSetup.managerName')}</span>
          <input value={managerName} onChange={(e) => setManagerName(e.target.value)} maxLength={60} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span className="field__label">{t('vetSetup.managerSurname')}</span>
          <input value={managerSurname} onChange={(e) => setManagerSurname(e.target.value)} maxLength={60} />
        </label>
      </div>
      <label className="field">
        <span className="field__label">{t('vetSetup.managerPhone')}</span>
        <input value={managerPhone} onChange={(e) => setManagerPhone(e.target.value)} maxLength={30} inputMode="tel" />
      </label>

      {/* Opening hours — the whole point: rescuers stop being sent here the
          moment the clinic closes, WITHOUT anyone remembering to flip a
          switch at 8pm. */}
      <div className="section-label">{t('vetSetup.hours')}</div>
      <p className="page-subtitle" style={{ marginTop: -4 }}>{t('vetSetup.hoursSub')}</p>

      <label
        style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0 14px', fontWeight: 700, fontSize: 14 }}
      >
        <input
          type="checkbox"
          checked={is247}
          onChange={(e) => setIs247(e.target.checked)}
          style={{ width: 18, height: 18 }}
        />
        {t('vetSetup.is247')}
      </label>

      {!is247 && (
        <>
          <div style={{ display: 'flex', gap: 12 }}>
            <label className="field" style={{ flex: 1 }}>
              <span className="field__label">{t('vetSetup.opensAt')}</span>
              <input type="time" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span className="field__label">{t('vetSetup.closesAt')}</span>
              <input type="time" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
            </label>
          </div>
          <p className="page-subtitle" style={{ marginTop: -6, marginBottom: 16 }}>
            {t('vetSetup.overnightNote')}
          </p>
        </>
      )}

      {/* Capacity is now a DIFFERENT thing from hours, and says so. */}
      <div className="section-label">{t('vetSetup.capacity')}</div>
      <label
        style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0 6px', fontWeight: 700, fontSize: 14 }}
      >
        <input
          type="checkbox"
          checked={isOpen}
          onChange={(e) => setIsOpen(e.target.checked)}
          style={{ width: 18, height: 18 }}
        />
        {t('vetSetup.capacity')}
      </label>
      <p className="page-subtitle" style={{ marginBottom: 16 }}>{t('vetSetup.capacitySub')}</p>

      <button className="btn btn--primary" onClick={() => void save()} disabled={busy || !clinicName.trim()}>
        {t('vetSetup.save')}
      </button>

      {/* C1: verification documents — optional, any file, no validation.
          Admin reviews these in the Vet approvals queue and can approve
          with or without them. */}
      <div className="section-label" style={{ marginTop: 24 }}>{t('vetSetup.documents')}</div>
      <p className="page-subtitle" style={{ marginTop: -4 }}>{t('vetSetup.documentsSub')}</p>
      <div className="card" style={{ padding: 14 }}>
        {documents.length === 0 && (
          <p className="page-subtitle" style={{ margin: 0 }}>{t('vetSetup.noDocuments')}</p>
        )}
        {documents.map((d) => (
          <div key={d.id} className="list-row" style={{ boxShadow: 'none' }}>
            <button
              type="button"
              className="link-btn"
              style={{ flex: 1, textAlign: 'left' }}
              onClick={() => viewDocument(d)}
            >
              📄 {d.filename || d.path}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => void onDeleteDocument(d)}
            >
              {t('common.cancel')}
            </button>
          </div>
        ))}
        {hasClinic ? (
          <label className="btn btn--secondary btn--small" style={{ marginTop: documents.length ? 10 : 0, display: 'inline-block' }}>
            {uploading ? t('common.loading') : t('vetSetup.uploadDocument')}
            <input
              type="file"
              hidden
              disabled={uploading}
              onChange={(e) => void onUploadDocument(e.target.files)}
            />
          </label>
        ) : (
          <p className="page-subtitle" style={{ margin: documents.length ? '10px 0 0' : 0 }}>
            {t('vetSetup.saveBeforeUpload')}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
/**
 * Persistent (not dismissible) reminder that an unapproved clinic is
 * invisible to rescuers — shown on the vet's profile and dashboard, the two
 * places a vet might otherwise assume everything is fine. VetSetupPage
 * already shows a pending/rejected banner on the form itself; this covers
 * the pages that previously showed nothing at all.
 */
export function VetVisibilityNotice() {
  const { user, profile } = useAuth();
  const [vet, setVet] = useState<Vet | null>(null);
  const [docCount, setDocCount] = useState<number | null>(null);

  useEffect(() => {
    if (!user || profile?.role !== 'vet') return;
    fetchMyVet().then(setVet).catch(() => {});
  }, [user, profile?.role]);

  useEffect(() => {
    if (!user || !vet) return;
    fetchVetDocuments(user.id).then((docs) => setDocCount(docs.length)).catch(() => {});
  }, [user, vet]);

  if (!vet || vet.status === 'approved') return null;

  const missingDetails = !vet.address.trim() || !vet.contact_phone.trim();
  const message =
    vet.status === 'rejected'
      ? t('vetSetup.rejected')
      : missingDetails
      ? t('vetVisibility.needsDetails')
      : docCount === 0
      ? t('vetVisibility.needsDocuments')
      : t('vetSetup.pending');

  return (
    <div className="banner banner--warn" role="status" style={{ marginBottom: 14 }}>
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function VetDashboardPage() {
  const { user, isGuest } = useAuth();
  // A guest has a `user` but no account, so fetchVet() below would find no
  // clinic, set hasClinic=false, and bounce them to /vet-setup — which is
  // itself account-only. Treat them as not signed in instead.
  const isRegistered = !!user && !isGuest;
  const { cases } = useCases(); // live — new requests appear instantly
  const [hasClinic, setHasClinic] = useState<boolean | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isRegistered) fetchVet(user.id).then((v) => setHasClinic(!!v));
  }, [user, isRegistered]);

  useEffect(() => {
    // A vet account without a clinic row can't receive animals — route
    // them to setup first.
    if (hasClinic === false) navigate('/vet-setup');
  }, [hasClinic, navigate]);

  // Same prompt VetSetupPage uses — a guest or signed-out visitor got a
  // permanent spinner here before.
  if (!isRegistered) {
    return <div className="page"><div className="empty-state"><SignInCta /></div></div>;
  }

  const mine = cases.filter((c) => c.vet_id === user.id);
  const incoming = mine.filter((c) => c.status === 'vet_selected');
  const active = mine.filter((c) => ['vet_confirmed', 'en_route'].includes(c.status));
  const past = mine.filter((c) => c.status === 'resolved');

  return (
    <div className="page">
      <ScreenHeader title={t('vetDash.title')} fallback="/profile" />
      <VetVisibilityNotice />

      <div className="v2-stats vet-dash__stats">
        <div className="v2-stat">
          <div className="v2-stat__value vet-dash__n--incoming">{incoming.length}</div>
          <div className="v2-stat__label">{t('vetDash.incoming')}</div>
        </div>
        <div className="v2-stat">
          <div className="v2-stat__value vet-dash__n--active">{active.length}</div>
          <div className="v2-stat__label">{t('vetDash.active')}</div>
        </div>
        <div className="v2-stat">
          <div className="v2-stat__value vet-dash__n--past">{past.length}</div>
          <div className="v2-stat__label">{t('status.resolved')}</div>
        </div>
      </div>

      <h2 className="v2-h2">{t('vetDash.incoming')}</h2>
      {incoming.length === 0 && <p className="v2-sub" style={{ marginTop: 0 }}>{t('vetDash.none')}</p>}
      {incoming.map((c) => (
        <CaseCard key={c.id} caseData={c} userLocation={null} />
      ))}

      {active.length > 0 && (
        <>
          <h2 className="v2-h2">{t('vetDash.active')}</h2>
          {active.map((c) => (
            <CaseCard key={c.id} caseData={c} userLocation={null} />
          ))}
        </>
      )}

      {past.length > 0 && (
        <>
          <h2 className="v2-h2">{t('status.resolved')}</h2>
          {past.map((c) => (
            <CaseCard key={c.id} caseData={c} userLocation={null} />
          ))}
        </>
      )}
    </div>
  );
}
