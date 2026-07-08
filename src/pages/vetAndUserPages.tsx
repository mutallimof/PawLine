/**
 * Smaller pages grouped together:
 *  - UserProfilePage:  public profile with a "Message" button (chat system 1)
 *  - VetPublicPage:    public clinic page with contact + message
 *  - VetSetupPage:     clinic onboarding (name, address, phone, map pin)
 *  - VetDashboardPage: incoming requests + active cases for a clinic
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  fetchProfile,
  fetchVet,
  getOrCreateDm,
  upsertVet,
} from '../lib/api';
import { useCases } from '../hooks/useRealtime';
import { Avatar, CaseCard, TierBadge, useToast } from '../components/ui';
import { PinDropMap } from '../components/maps';
import { IconBack } from '../components/Icons';
import { DEFAULT_CENTER, getCurrentPosition, type LatLng } from '../lib/geo';
import { t } from '../i18n';
import type { Profile, Vet } from '../lib/types';

// ---------------------------------------------------------------------------
export function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (id) fetchProfile(id).then(setProfile).catch(() => {});
  }, [id]);

  if (!profile) return <div className="page"><div className="spinner" /></div>;

  const message = async () => {
    if (!user) return navigate('/auth');
    try {
      navigate(`/messages/${await getOrCreateDm(profile.id)}`);
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
          <button className="btn btn--primary" onClick={() => void message()}>
            💬 {t('dm.messageUser')}
          </button>
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
        {vet.phone && (
          <a href={`tel:${vet.phone}`} style={{ fontWeight: 800, color: 'var(--coral-deep)' }}>
            {vet.phone}
          </a>
        )}
        {profile && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, margin: '12px 0' }}>
            <TierBadge xp={profile.xp} />
          </div>
        )}
        {!vet.is_open && <div className="banner banner--warn">{t('vets.closed')}</div>}
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
export function VetSetupPage() {
  const { user, profile } = useAuth();
  const [vetStatus, setVetStatus] = useState<'pending' | 'approved' | 'rejected' | null>(null);
  const [clinicName, setClinicName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [isOpen, setIsOpen] = useState(true);
  const [location, setLocation] = useState<LatLng>(DEFAULT_CENTER);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  // Prefill from an existing clinic row (editing) or sensible defaults.
  useEffect(() => {
    if (!user) return;
    fetchVet(user.id).then((v) => {
      if (v) {
        setVetStatus(v.status);
        setClinicName(v.clinic_name);
        setAddress(v.address);
        setPhone(v.phone);
        setIsOpen(v.is_open);
        setLocation({ lat: v.lat, lng: v.lng });
      } else {
        if (profile) setClinicName(profile.display_name);
        getCurrentPosition().then(setLocation).catch(() => {});
      }
    });
  }, [user, profile]);

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

  const save = async () => {
    if (!clinicName.trim()) return;
    setBusy(true);
    try {
      await upsertVet({
        id: user.id,
        clinic_name: clinicName.trim(),
        address: address.trim(),
        phone: phone.trim(),
        lat: location.lat,
        lng: location.lng,
        is_open: isOpen,
      });
      navigate('/vet-dashboard');
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">{t('vetSetup.title')}</h1>
      <p className="page-subtitle">{t('vetSetup.subtitle')}</p>

      {vetStatus === 'pending' && <div className="banner banner--warn">{t('vetSetup.pending')}</div>}
      {vetStatus === 'rejected' && <div className="banner banner--warn">{t('vetSetup.rejected')}</div>}

      <label className="field">
        <span className="field__label">{t('vetSetup.clinicName')}</span>
        <input value={clinicName} onChange={(e) => setClinicName(e.target.value)} maxLength={100} />
      </label>
      <label className="field">
        <span className="field__label">{t('vetSetup.address')}</span>
        <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} />
      </label>
      <label className="field">
        <span className="field__label">{t('vetSetup.phone')}</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} inputMode="tel" />
      </label>

      <span className="field__label">{t('vetSetup.pin')}</span>
      <div style={{ margin: '8px 0 16px' }}>
        <PinDropMap value={location} onChange={setLocation} />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, fontWeight: 700, fontSize: 14 }}>
        <input type="checkbox" checked={isOpen} onChange={(e) => setIsOpen(e.target.checked)} style={{ width: 18, height: 18 }} />
        {t('vetSetup.isOpen')}
      </label>

      <button className="btn btn--primary" onClick={() => void save()} disabled={busy || !clinicName.trim()}>
        {t('vetSetup.save')}
      </button>
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
