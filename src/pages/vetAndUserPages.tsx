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
import { useNavigate, useParams } from 'react-router-dom';
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
import { Avatar, CaseCard, TierBadge, useToast } from '../components/ui';
import { PinDropMap } from '../components/maps';
import { IconBack } from '../components/Icons';
import { DEFAULT_CENTER, getCurrentPosition, type LatLng } from '../lib/geo';
import { t } from '../i18n';
import type { AnimalType, Profile, Vet, VetDocument } from '../lib/types';

// ---------------------------------------------------------------------------
export function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
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
    if (user && id && user.id !== id) {
      isUserBlocked(user.id, id).then(setBlocked).catch(() => {});
    }
  }, [user, id]);

  if (!profile) return <div className="page"><div className="spinner" /></div>;

  const message = async () => {
    if (!user) return navigate('/auth');
    try {
      navigate(`/messages/${await getOrCreateDm(profile.id)}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    }
  };

  const toggleBlock = async () => {
    if (!user) return navigate('/auth');
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
    <div className="page">
      <button className="back-btn" onClick={() => navigate(-1)}>
        <IconBack size={18} /> {t('common.back')}
      </button>
      <div className="card" style={{ padding: 18, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
          <Avatar name={profile.display_name} url={profile.avatar_url} />
        </div>
        <h1 className="page-title" style={{ fontSize: 24 }}>
          {profile.display_name}
          {profile.role === 'vet' ? ' 🏥' : ''}
        </h1>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, margin: '10px 0 14px' }}>
          <TierBadge xp={profile.xp} />
          <span className="tier-badge" style={{ background: 'var(--ink-soft)' }}>
            {t('profile.casesHelped')}: {profile.cases_helped}
          </span>
        </div>
        {user && user.id !== profile.id && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
            <button className="btn btn--primary" onClick={() => void message()}>
              💬 {t('dm.messageUser')}
            </button>
            <button
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => void toggleBlock()}
            >
              🚫 {blocked ? t('settings.unblock') : t('settings.block')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function VetPublicPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [vet, setVet] = useState<Vet | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (!id) return;
    fetchVet(id).then(setVet).catch(() => {});
    fetchProfile(id).then(setProfile).catch(() => {});
  }, [id]);

  if (!vet) return <div className="page"><div className="spinner" /></div>;

  const message = async () => {
    if (!user) return navigate('/auth');
    try {
      navigate(`/messages/${await getOrCreateDm(vet.id)}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    }
  };

  return (
    <div className="page">
      <button className="back-btn" onClick={() => navigate(-1)}>
        <IconBack size={18} /> {t('common.back')}
      </button>
      <div className="card" style={{ padding: 18, textAlign: 'center' }}>
        <div style={{ fontSize: 42 }}>🏥</div>
        <h1 className="page-title" style={{ fontSize: 24 }}>{vet.clinic_name}</h1>
        <p className="page-subtitle">{vet.address}</p>
        {vet.contact_phone && (
          <a href={`tel:${vet.contact_phone}`} style={{ fontWeight: 800, color: 'var(--coral-deep)' }}>
            {vet.contact_phone}
          </a>
        )}
        {vet.contact_email && (
          <p className="page-subtitle" style={{ marginTop: 4 }}>
            <a href={`mailto:${vet.contact_email}`}>{vet.contact_email}</a>
          </p>
        )}
        {/* C2: rating, once the clinic has at least one */}
        {!!vet.rating_count && (
          <p style={{ fontWeight: 700, margin: '8px 0 0' }}>
            ★ {vet.rating_avg?.toFixed(1)} · {t('vets.ratingCount', { n: vet.rating_count })}
          </p>
        )}
        {vet.accepted_animals?.length > 0 && (
          <p className="page-subtitle" style={{ marginTop: 6 }}>
            {vet.accepted_animals.map((a) => t(`animal.${a}` as const)).join(' · ')}
          </p>
        )}
        {profile && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, margin: '12px 0' }}>
            <TierBadge xp={profile.xp} />
          </div>
        )}
        {vet.open_now === false ? (
          <div className="banner banner--warn">
            {vet.opens_at
              ? t('vets.closedUntil').replace('{time}', vet.opens_at.slice(0, 5))
              : t('vets.closed')}
          </div>
        ) : vet.is_open === false ? (
          <div className="banner banner--warn">{t('vets.atCapacity')}</div>
        ) : null}
        {user && user.id !== vet.id && (
          <button className="btn btn--primary" onClick={() => void message()}>
            💬 {t('dm.messageUser')}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
const ANIMAL_TYPES: AnimalType[] = ['dog', 'cat', 'other'];

export function VetSetupPage() {
  const { user, profile } = useAuth();
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

  // Gate on `user` for auth; a still-loading profile gets a spinner, not an
  // error (same class of bug as the ProfilePage sign-in gate).
  if (!user) {
    return <div className="page"><div className="empty-state">{t('dm.signIn')}</div></div>;
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
    <div className="page">
      <h1 className="page-title">{t('vetSetup.title')}</h1>
      <p className="page-subtitle">{t('vetSetup.subtitle')}</p>

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
  const { user } = useAuth();
  const { cases } = useCases(); // live — new requests appear instantly
  const [hasClinic, setHasClinic] = useState<boolean | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (user) fetchVet(user.id).then((v) => setHasClinic(!!v));
  }, [user]);

  useEffect(() => {
    // A vet account without a clinic row can't receive animals — route
    // them to setup first.
    if (hasClinic === false) navigate('/vet-setup');
  }, [hasClinic, navigate]);

  if (!user) return <div className="page"><div className="spinner" /></div>;

  const mine = cases.filter((c) => c.vet_id === user.id);
  const incoming = mine.filter((c) => c.status === 'vet_selected');
  const active = mine.filter((c) => ['vet_confirmed', 'en_route'].includes(c.status));
  const past = mine.filter((c) => c.status === 'resolved');

  return (
    <div className="page">
      <h1 className="page-title">{t('vetDash.title')}</h1>
      <VetVisibilityNotice />

      <div className="section-label">{t('vetDash.incoming')}</div>
      {incoming.length === 0 && <p className="page-subtitle">{t('vetDash.none')}</p>}
      {incoming.map((c) => (
        <CaseCard key={c.id} caseData={c} userLocation={null} />
      ))}

      {active.length > 0 && (
        <>
          <div className="section-label">{t('vetDash.active')}</div>
          {active.map((c) => (
            <CaseCard key={c.id} caseData={c} userLocation={null} />
          ))}
        </>
      )}

      {past.length > 0 && (
        <>
          <div className="section-label">{t('home.filter.resolved')}</div>
          {past.map((c) => (
            <CaseCard key={c.id} caseData={c} userLocation={null} />
          ))}
        </>
      )}
    </div>
  );
}
