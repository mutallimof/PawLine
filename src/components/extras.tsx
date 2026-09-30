/**
 * SponsorStrip — the "Supported by" / "Partners" section (tasteful, small,
 * clearly separated from rescue content; see MONETIZATION.md for the model).
 *
 * PrivacyPage — plain-language privacy policy in all three locales, written
 * to be honest rather than legalistic: what's collected, who can see it,
 * that nothing is sold.
 */
import { useEffect, useState } from 'react';
import { fetchSponsors } from '../lib/api';
import { getLocale, t } from '../i18n';
import { ScreenHeader } from './ui';
import type { Sponsor } from '../lib/types';

// ---------------------------------------------------------------------------
export function SponsorStrip() {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);

  useEffect(() => {
    fetchSponsors().then((all) => setSponsors(all.filter((s) => s.active))).catch(() => {});
  }, []);

  if (sponsors.length === 0) return null;

  const paying = sponsors.filter((s) => s.kind === 'sponsor');
  const partners = sponsors.filter((s) => s.kind === 'partner');

  const row = (list: Sponsor[], label: string) =>
    list.length > 0 && (
      <div style={{ marginBottom: 10 }}>
        <div className="section-label" style={{ margin: '0 0 8px', textAlign: 'center' }}>
          {label}
        </div>
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', alignItems: 'center' }}>
          {list.map((s) => (
            <a
              key={s.id}
              /* S11: defense-in-depth — never render javascript:/data: URLs
                 even from admin-entered content */
              href={/^https?:\/\//i.test(s.url) ? s.url : undefined}
              target="_blank"
              rel="noopener noreferrer sponsored"
              style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: 0.85 }}
            >
              {s.logo_url ? (
                <img src={s.logo_url} alt={s.name} style={{ height: 28, maxWidth: 110, objectFit: 'contain' }} />
              ) : (
                <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--ink-soft)' }}>{s.name}</span>
              )}
            </a>
          ))}
        </div>
      </div>
    );

  return (
    <div style={{ padding: '18px 16px 6px', borderTop: '1px solid var(--line)', marginTop: 18 }}>
      {row(paying, t('sponsors.title'))}
      {row(partners, t('partners.title'))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Privacy policy content. Long-form text lives here (not the i18n dictionary,
// which is for short UI strings). Same honest content in all three languages.
// ---------------------------------------------------------------------------

const PRIVACY: Record<string, { title: string; sections: [string, string][] }> = {
  en: {
    title: 'Privacy policy',
    sections: [
      ['Who runs Stray’s Call',
        'Stray’s Call is run by Fikrat Mutallimov, an individual, who is responsible for the personal data described here. Contact: fikretmutallimov@gmail.com.'],
      ['What we collect and why',
        'Your account: email and password (to sign you in); first name, last name and optional phone (so clinics and rescuers know who they are dealing with); a display name built from your name; your language. With Google sign-in we receive your name, email and profile picture from Google. Alert settings: if you choose alerts near you, the home area and radius you set. Reports: photos, description, the animal’s condition and urgency, the exact spot you place on the map, an optional landmark, and a street address we look up from that spot; as a guest, the optional name you type. Rescues: your role on a case and, only while you are driving an animal to a clinic, your device’s location about every 45 seconds. Messages you write in case chats and in direct messages with clinics. Ratings, blocks and content reports you make. Copies of the notifications we send you and, if you turn on push, a technical address for your device. When you confirmed you are 18+ and accepted the Terms and this policy, and which version. Clinics also provide clinic details, a private manager contact and verification documents. Technical data: a session identity for your device (also for guests), a bot check (Cloudflare Turnstile) and error reports (Sentry). We use this data only to run the rescue service: publishing reports, alerting nearby helpers, coordinating rescues and clinics, keeping the platform safe (bot checks, spam limits, moderation) and providing your account.'],
      ['Legal basis',
        'We process your data on the basis of your consent: when you create an account (the required boxes “I am 18 or older” and “I agree to the Terms and the Privacy Policy”, recorded with the date and version); as a guest, on each report (the same boxes, recorded with the report); for location while transporting an animal, by starting the transport; for push notifications, by turning them on.'],
      ['What is public',
        'Public means anyone can see it, even without an account. For a case that is: the animal, description, condition, urgency, the exact location and street address, landmark, status and its times, the guest name if one was given, the case timeline, the case chat, and which accounts reported, rescued and treated it. Everyone using the app can see the photos of a case. Also public: your display name, profile picture, role, join date, “animals helped” count and partner organisation; clinic ratings, including who left them; approved clinics’ public details. Not public: which device or guest session submitted a report; consent records; cases hidden by moderators; and the rescuer’s live location, which only the people on that case (reporter, rescuer, clinic) and administrators can see.'],
      ['Who else can see your data',
        'Direct messages are visible to the two people in the conversation and to administrators. Only you and administrators can see your email, name and phone, home area and alert settings, language, notifications, block list, the content reports you filed and your consent records. Administrators can see all users’ email addresses, all direct messages, content reports, hidden content, clinic verification documents and manager contacts; they use this only to review abuse reports, approve clinics and fix problems. As the database operator, the person running Stray’s Call has technical access to all stored data.'],
      ['Where your data is stored',
        'Our database, files and sign-in service are hosted by Supabase in the European Union (Paris, France), outside Azerbaijan. The app’s files are delivered by Vercel’s global network. Maps, place search and street-address lookups are provided by Google, the bot check by Cloudflare, error reports go to Sentry, and push notifications go through your browser’s push service. By using Stray’s Call you consent to this transfer.'],
      ['How long we keep it',
        'Your account and profile: until you delete your account. Reports and case timelines: kept as the rescue record; open reports nobody takes are closed after 24 hours, not deleted. Case chats: deleted 90 days after the case is resolved or closed (a message under review by moderators is kept until the review ends). Photos: currently kept with the case; we will add a deletion period here when automatic photo cleanup is in place. Your live location while transporting: deleted when the animal is delivered, the rescue is dropped, or the rescue is reopened after 75 minutes without progress. Direct messages: until you or the other person deletes their account, when the whole conversation is deleted. Notifications: 90 days. Guest sessions: deleted after 30 days unless you still have an open report; your finished reports stay, no longer linked to the session. Clinic verification documents: while the clinic’s account exists. Push device addresses: until you turn push off, the device stops accepting pushes, or you delete your account. On your device: your session, settings and any unsent offline reports stay in your browser until sent or until you clear its data; cached photos for up to 7 days.'],
      ['Your rights',
        'See and export your data: Settings → Data & account → Export my data. Correct it: Settings → Personal information, and alerts, area and language in Settings. Delete your account: Settings → Data & account → Delete my account. This permanently removes your sign-in and email, profile, alert settings, notifications, push devices, block list, the content reports you filed, “not here” flags, watched cases, the clinic ratings you left, every direct-message conversation you are in (for both people), and for clinics the clinic and its verification documents. Your case-chat messages stay in the case, shown as “Deleted account”. Reports you created or rescued stay as rescue history, no longer linked to you. If you were in the middle of a rescue, the case reopens for other rescuers; if your clinic was expecting an animal, the rescuer is asked to choose another clinic. Withdraw consent by deleting your account (for location or push: stop the transport or turn push off). For anything else, write to fikretmutallimov@gmail.com.'],
      ['18+ only',
        'Stray’s Call is only for people aged 18 and over. Everyone confirms this before creating an account or submitting a report as a guest.'],
      ['Photos and location',
        'Photos are resized and re-encoded on your device before upload, which removes hidden metadata such as GPS position; if that can’t be done, the photo is not uploaded. Clinic verification documents are uploaded as they are and are visible only to the clinic and administrators. We use location only for: the pin you place on a report (public); your chosen home area for alerts (private); your device location while you transport an animal (visible only to the people on that case and administrators, deleted at the end of the transport); and centring the map and showing distances on your device (not stored). Report locations are sent to Google to look up a street address.'],
      ['What Stray’s Call does NOT do',
        'Stray’s Call does not sell your data, does not show targeted advertising, and does not process payments. If a clinic shares bank details in a case chat, any payment happens directly between you and the clinic, outside Stray’s Call.'],
      ['Changes to this policy',
        'When we change the Terms or this policy materially, we update the version, and everyone with an account is asked to accept again before continuing. Guests accept the current version with each report.'],
    ],
  },
  az: {
    title: 'Məxfilik siyasəti',
    sections: [
      ['Stray’s Call nə toplayır',
        'Bildirişlərə foto, təsvir və xəritədə qoyduğunuz yer daxildir. Hesab yaratsanız, e-poçtunuzu, adınızı və — aktiv etsəniz — yaxınlıqdakı hadisə bildirişləri üçün ərazi və radiusu, həmçinin bu cihaz üçün push-bildiriş ünvanını saxlayırıq. Yazdığınız çat mesajları və hadisə yenilikləri xilasetmədə iştirak edən digərlərinin oxuya bilməsi üçün saxlanılır.'],
      ['Nə açıqdır',
        'Xilasedici heyvanı apararkən paylaşdığı canlı yer həmin hadisədə çatdırılmaya qədər görünür, sonra silinir. Hadisə bildirişləri (foto, təsvir, yer, status) açıqdır — məqsəd elə budur: xilasedicilər onları görməlidir. Hadisə qrup çatları da açıq oxunur. Adınız və səviyyəniz açıqdır. E-poçtunuz, dəqiq əraziniz, bildiriş parametrləriniz və şəxsi mesajlarınız açıq deyil.'],
      ['Məlumatlarınızı kim görə bilər',
        'Şəxsi mesajları yalnız söhbətdəki insanlar oxuya bilər. Platforma adminləri şikayətləri araşdırarkən, baytar klinikalarını təsdiqləyərkən və ya texniki problemləri həll edərkən saxlanılan məlumatlara (şikayət edilən mesajlar daxil olmaqla) baxa bilər — heç vaxt reklam üçün yox.'],
      ['Stray’s Call nə ETMİR',
        'Stray’s Call məlumatlarınızı satmır, hədəflənmiş reklam göstərmir və ödənişləri emal etmir. Baytar hadisə çatında bank rekvizitlərini paylaşırsa, ödəniş birbaşa siz və klinika arasında, Stray’s Call-dan kənarda baş verir.'],
      ['Qonaq bildirişləri',
        'Hesabsız bildirə bilərsiniz. Cihazınız yalnız spamın qarşısını almaq üçün istifadə olunan anonim texniki kimlik alır. Yazdığınız ad (istəyə bağlı) bildirişdə göstərilir.'],
      ['Məlumatların silinməsi',
        'Stray’s Call komandası ilə əlaqə saxlayaraq hesabınızı və mesajlarınızı silə bilərsiniz; hadisə bildirişləri heyvanın xilasetmə tarixçəsini sənədləşdirdiyi üçün (anonimləşdirilmiş şəkildə) qala bilər.'],
    ],
  },
  tr: {
    title: 'Gizlilik politikası',
    sections: [
      ['Stray’s Call ne toplar',
        'Bildirimler fotoğraf, açıklama ve haritada işaretlediğiniz konumu içerir. Hesap oluşturursanız e-postanızı, adınızı ve — açarsanız — yakın vaka uyarıları için bölge ve yarıçapı, ayrıca bu cihaz için bir anlık bildirim adresini saklarız. Yazdığınız sohbet mesajları ve vaka güncellemeleri, kurtarmaya katılan diğer kişilerin okuyabilmesi için saklanır.'],
      ['Ne herkese açıktır',
        'Bir kurtarıcı hayvanı taşırken paylaştığı canlı konum, teslimata kadar o vakada görünür ve sonra kaldırılır. Vaka bildirimleri (fotoğraf, açıklama, konum, durum) herkese açıktır — amaç zaten bu: kurtarıcılar onları görebilmeli. Vaka grup sohbetleri de herkese açık okunur. Adınız ve seviyeniz herkese açıktır. E-postanız, tam bölgeniz, bildirim ayarlarınız ve özel mesajlarınız herkese açık değildir.'],
      ['Verilerinizi kim görebilir',
        'Özel mesajları yalnızca sohbetteki kişiler okuyabilir. Platform yöneticileri şikayetleri incelerken, veteriner kliniklerini onaylarken veya teknik sorunları çözerken saklanan verilere (şikayet edilen mesajlar dahil) erişebilir — asla reklam için değil.'],
      ['Stray’s Call ne YAPMAZ',
        'Stray’s Call verilerinizi satmaz, hedefli reklam göstermez ve ödeme işlemez. Bir veteriner vaka sohbetinde banka bilgilerini paylaşırsa, ödeme doğrudan siz ve klinik arasında, Stray’s Call dışında gerçekleşir.'],
      ['Misafir bildirimleri',
        'Hesapsız bildirebilirsiniz. Cihazınız yalnızca spam’i önlemek için kullanılan anonim bir teknik kimlik alır. Yazdığınız ad (isteğe bağlı) bildirimde gösterilir.'],
      ['Verilerin silinmesi',
        'Stray’s Call ekibiyle iletişime geçerek hesabınızı ve mesajlarınızı silebilirsiniz; vaka bildirimleri bir hayvanın kurtarma geçmişini belgelediği için (anonimleştirilmiş olarak) kalabilir.'],
    ],
  },
};

export function PrivacyPage() {
  const content = PRIVACY[getLocale()] ?? PRIVACY.en;

  return (
    <div className="page doc-page">
      <ScreenHeader title={content.title} fallback="/settings" />
      {content.sections.map(([heading, body]) => (
        <div key={heading} className="doc-section">
          <h2>{heading}</h2>
          <p>{body}</p>
        </div>
      ))}
    </div>
  );
}
