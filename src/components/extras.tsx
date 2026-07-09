/**
 * SponsorStrip — the "Supported by" / "Partners" section (tasteful, small,
 * clearly separated from rescue content; see MONETIZATION.md for the model).
 *
 * PrivacyPage — plain-language privacy policy in all three locales, written
 * to be honest rather than legalistic: what's collected, who can see it,
 * that nothing is sold.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchSponsors } from '../lib/api';
import { getLocale, t } from '../i18n';
import { IconBack } from './Icons';
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
      ['What PawLine collects',
        'Reports include a photo, a description, and the location you place on the map. If you create an account we also store your email, display name, and — if you enable it — a home area and radius for nearby-case alerts, plus a push-notification address for this device. Chats and case updates you write are stored so others involved in a rescue can read them.'],
      ['What is public',
        'While a rescuer is transporting an animal, their shared live location appears on that case until delivery, then it is removed. Case reports (photo, description, location, status) are public — that is the whole point: rescuers must be able to see them. Case group chats are also publicly readable. Your display name and level are public. Your email, exact home area, notification settings, and direct messages are not public.'],
      ['Who can see your data',
        'Direct messages can be read only by the people in the conversation. Platform administrators can access stored data (including reported messages) when reviewing abuse reports, verifying vet clinics, or fixing technical problems — never for advertising.'],
      ['What PawLine does NOT do',
        'PawLine does not sell your data, does not show targeted advertising, and does not process payments. If a vet shares bank details in a case chat, any payment happens directly between you and the clinic, outside PawLine.'],
      ['Guest reports',
        'You can report without an account. Your device gets an anonymous technical identity used only to prevent spam. The optional name you type is shown on the report.'],
      ['Deleting your data',
        'You can delete your account and messages by contacting the PawLine team; case reports may remain (anonymized) because they document an animal’s rescue history.'],
    ],
  },
  az: {
    title: 'Məxfilik siyasəti',
    sections: [
      ['PawLine nə toplayır',
        'Bildirişlərə foto, təsvir və xəritədə qoyduğunuz yer daxildir. Hesab yaratsanız, e-poçtunuzu, adınızı və — aktiv etsəniz — yaxınlıqdakı hadisə bildirişləri üçün ərazi və radiusu, həmçinin bu cihaz üçün push-bildiriş ünvanını saxlayırıq. Yazdığınız çat mesajları və hadisə yenilikləri xilasetmədə iştirak edən digərlərinin oxuya bilməsi üçün saxlanılır.'],
      ['Nə açıqdır',
        'Xilasedici heyvanı apararkən paylaşdığı canlı yer həmin hadisədə çatdırılmaya qədər görünür, sonra silinir. Hadisə bildirişləri (foto, təsvir, yer, status) açıqdır — məqsəd elə budur: xilasedicilər onları görməlidir. Hadisə qrup çatları da açıq oxunur. Adınız və səviyyəniz açıqdır. E-poçtunuz, dəqiq əraziniz, bildiriş parametrləriniz və şəxsi mesajlarınız açıq deyil.'],
      ['Məlumatlarınızı kim görə bilər',
        'Şəxsi mesajları yalnız söhbətdəki insanlar oxuya bilər. Platforma adminləri şikayətləri araşdırarkən, baytar klinikalarını yoxlayarkən və ya texniki problemləri həll edərkən saxlanılan məlumatlara (şikayət edilən mesajlar daxil olmaqla) baxa bilər — heç vaxt reklam üçün yox.'],
      ['PawLine nə ETMİR',
        'PawLine məlumatlarınızı satmır, hədəflənmiş reklam göstərmir və ödənişləri emal etmir. Baytar hadisə çatında bank rekvizitlərini paylaşırsa, ödəniş birbaşa siz və klinika arasında, PawLine-dan kənarda baş verir.'],
      ['Qonaq bildirişləri',
        'Hesabsız bildirə bilərsiniz. Cihazınız yalnız spamın qarşısını almaq üçün istifadə olunan anonim texniki kimlik alır. Yazdığınız ad (istəyə bağlı) bildirişdə göstərilir.'],
      ['Məlumatların silinməsi',
        'PawLine komandası ilə əlaqə saxlayaraq hesabınızı və mesajlarınızı silə bilərsiniz; hadisə bildirişləri heyvanın xilasetmə tarixçəsini sənədləşdirdiyi üçün (anonimləşdirilmiş şəkildə) qala bilər.'],
    ],
  },
  tr: {
    title: 'Gizlilik politikası',
    sections: [
      ['PawLine ne toplar',
        'Bildirimler fotoğraf, açıklama ve haritada işaretlediğiniz konumu içerir. Hesap oluşturursanız e-postanızı, adınızı ve — açarsanız — yakın vaka uyarıları için bölge ve yarıçapı, ayrıca bu cihaz için bir anlık bildirim adresini saklarız. Yazdığınız sohbet mesajları ve vaka güncellemeleri, kurtarmaya katılan diğer kişilerin okuyabilmesi için saklanır.'],
      ['Ne herkese açıktır',
        'Bir kurtarıcı hayvanı taşırken paylaştığı canlı konum, teslimata kadar o vakada görünür ve sonra kaldırılır. Vaka bildirimleri (fotoğraf, açıklama, konum, durum) herkese açıktır — amaç zaten bu: kurtarıcılar onları görebilmeli. Vaka grup sohbetleri de herkese açık okunur. Adınız ve seviyeniz herkese açıktır. E-postanız, tam bölgeniz, bildirim ayarlarınız ve özel mesajlarınız herkese açık değildir.'],
      ['Verilerinizi kim görebilir',
        'Özel mesajları yalnızca sohbetteki kişiler okuyabilir. Platform yöneticileri şikayetleri incelerken, veteriner kliniklerini doğrularken veya teknik sorunları çözerken saklanan verilere (şikayet edilen mesajlar dahil) erişebilir — asla reklam için değil.'],
      ['PawLine ne YAPMAZ',
        'PawLine verilerinizi satmaz, hedefli reklam göstermez ve ödeme işlemez. Bir veteriner vaka sohbetinde banka bilgilerini paylaşırsa, ödeme doğrudan siz ve klinik arasında, PawLine dışında gerçekleşir.'],
      ['Misafir bildirimleri',
        'Hesapsız bildirebilirsiniz. Cihazınız yalnızca spam’i önlemek için kullanılan anonim bir teknik kimlik alır. Yazdığınız ad (isteğe bağlı) bildirimde gösterilir.'],
      ['Verilerin silinmesi',
        'PawLine ekibiyle iletişime geçerek hesabınızı ve mesajlarınızı silebilirsiniz; vaka bildirimleri bir hayvanın kurtarma geçmişini belgelediği için (anonimleştirilmiş olarak) kalabilir.'],
    ],
  },
};

export function PrivacyPage() {
  const navigate = useNavigate();
  const content = PRIVACY[getLocale()] ?? PRIVACY.en;

  return (
    <div className="page">
      <button className="back-btn" onClick={() => navigate(-1)}>
        <IconBack size={18} /> {t('common.back')}
      </button>
      <h1 className="page-title">{content.title}</h1>
      {content.sections.map(([heading, body]) => (
        <div key={heading} style={{ marginTop: 18 }}>
          <h3 style={{ fontSize: 17, marginBottom: 6 }}>{heading}</h3>
          <p style={{ fontSize: 14.5, color: 'var(--ink-soft)' }}>{body}</p>
        </div>
      ))}
    </div>
  );
}
