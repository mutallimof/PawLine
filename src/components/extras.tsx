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
        'Stray’s Call is run by Fikrat Mutallimov, an individual, who is responsible for the personal data described here. We can be contacted by email only: fikretmutallimov@gmail.com.'],
      ['What we collect and why',
        'Your account: email and password (to sign you in); first name, last name and optional phone (so clinics and rescuers know who they are dealing with); a display name built from your name; your language. With Google sign-in we receive your name, email and profile picture from Google. Alert settings: if you choose alerts near you, the home area and radius you set. Reports: photos, description, the animal’s condition and urgency, the exact spot you place on the map, an optional landmark, and a street address we look up from that spot; as a guest, the optional name you type. Rescues: your role on a case and, only while you are driving an animal to a clinic, your device’s location about every 45 seconds. Messages you write in case chats and in direct messages with clinics. Ratings, blocks and content reports you make. Copies of the notifications we send you and, if you turn on push, a technical address for your device. When you confirmed you are 18+ and accepted the Terms and this policy, and which version. Clinics also provide clinic details, a private manager contact and verification documents. Technical data: a session identity for your device (also for guests), a bot check (Cloudflare Turnstile) and error reports (Sentry). We use this data only to run the rescue service: publishing reports, alerting nearby helpers, coordinating rescues and clinics, keeping the platform safe (bot checks, spam limits, moderation) and providing your account.'],
      ['Legal basis',
        'We process your data on the basis of your consent, and of what is necessary to run the service and keep it safe. Consent: when you create an account (the required boxes “I am 18 or older” and “I agree to the Terms of Service and the Privacy policy”, recorded with the date and version); as a guest, on each report (the same boxes, recorded with the report); for location while transporting an animal, by starting the transport; for push notifications, by turning them on. Necessary to run the service and keep it safe: bot checks, spam limits, moderation, and keeping rescue history in anonymised form after an account is deleted.'],
      ['What is public',
        'Public means anyone can see it, even without an account. For a case that is: the animal, description, condition, urgency, the exact location and street address, landmark, status and its times, the guest name if one was given, the case timeline, the case chat, and which accounts reported, rescued and treated it. Everyone using the app can see the photos of a case. Also public: your display name, profile picture, role, join date, “animals helped” count and partner organisation; clinic ratings, including who left them; approved clinics’ public details. Not public: which device or guest session submitted a report; consent records; cases hidden by moderators; and the rescuer’s live location, which only the people on that case (reporter, rescuer, clinic) and administrators can see.'],
      ['Who else can see your data',
        'Direct messages are visible to the two people in the conversation and to administrators. Only you and administrators can see your email, name and phone, home area and alert settings, language, notifications, block list, the content reports you filed and your consent records. Administrators can see all users’ email addresses, all direct messages, content reports, hidden content, clinic verification documents and manager contacts; they use this only to review abuse reports, approve clinics and fix problems. As the database operator, the person running Stray’s Call has technical access to all stored data.'],
      ['Where your data is stored',
        'Our database, files and sign-in service are hosted by Supabase in the European Union (Paris, France), outside Azerbaijan. The app’s files are delivered by Vercel’s global network; Vercel keeps request logs briefly for security. Maps, place search and street-address lookups are provided by Google, and the bot check by Cloudflare; error reports go to Sentry, which keeps them for its standard period; push notifications go through your browser’s push service. Your data is stored in the EU (France) and processed by these providers around the world. By using Stray’s Call you consent to this transfer.'],
      ['How long we keep it',
        'Your account and profile: until you delete your account. Reports and case timelines: kept as the rescue record; open reports nobody takes are closed after 24 hours, not deleted. Case chats: deleted 90 days after the case is resolved or closed (a message under review by moderators is kept until the review ends). Photos: currently kept with the case; we will add a deletion period here when automatic photo cleanup is in place. Your live location while transporting: deleted when the animal is delivered, the rescue is dropped, or the rescue is reopened after 75 minutes without progress. Direct messages: until you or the other person deletes their account, when the whole conversation is deleted. Notifications: 90 days. Guest sessions: deleted after 30 days unless you still have an open report; your finished reports stay, no longer linked to the session. Clinic verification documents: while the clinic’s account exists. Push device addresses: until you turn push off, the device stops accepting pushes, or you delete your account. On your device: your session, settings and any unsent offline reports stay in your browser until sent or until you clear its data; cached photos for up to 7 days.'],
      ['Your rights',
        'See and export your data: Settings → Data & account → Export my data. Correct it: Settings → Personal information, and alerts, area and language in Settings. Delete your account: Settings → Data & account → Delete my account. This permanently removes your sign-in and email, profile, alert settings, notifications, push devices, block list, the content reports you filed, “not here” flags, watched cases, the clinic ratings you left, every direct-message conversation you are in (for both people), and for clinics the clinic and its verification documents. Your case-chat messages stay in the case, shown as “Deleted account”. Reports you created or rescued stay as rescue history, no longer linked to you. If you were in the middle of a rescue, the case reopens for other rescuers; if your clinic was expecting an animal, the rescuer is asked to choose another clinic. Withdraw consent by deleting your account (for location or push: stop the transport or turn push off). For anything else, write to fikretmutallimov@gmail.com. We’ll respond as soon as we can, within any time limit the law sets. You can also complain to the data protection authority in your country.'],
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
      ['Stray’s Call-u kim idarə edir',
        'Stray’s Call fiziki şəxs Fikrat Mutallimov tərəfindən idarə olunur; burada təsvir edilən şəxsi məlumatlara görə məsuliyyət onun üzərindədir. Bizimlə yalnız e-poçt vasitəsilə əlaqə saxlaya bilərsiniz: fikretmutallimov@gmail.com.'],
      ['Nə toplayırıq və nə üçün',
        'Hesabınız: e-poçt və şifrə (daxil olmağınız üçün); ad, soyad və istəyə bağlı telefon nömrəsi (klinikalar və xilasedicilər kiminlə əlaqədə olduqlarını bilsinlər deyə); adınızdan yaradılan görünən ad; diliniz. Google ilə daxil olsanız, Google-dan adınızı, e-poçtunuzu və profil şəklinizi alırıq. Xəbərdarlıq parametrləri: yaxınlıqdakı hadisələr barədə xəbərdarlıq almağı seçsəniz, təyin etdiyiniz ərazi və radius. Hadisə bildirişləri: fotolar, təsvir, heyvanın vəziyyəti və təcililiyi, xəritədə qeyd etdiyiniz dəqiq yer, istəyə bağlı nişanə və həmin yerə əsasən müəyyən etdiyimiz küçə ünvanı; qonaq kimi yazdığınız istəyə bağlı ad. Xilasetmə: hadisədəki rolunuz və yalnız heyvanı klinikaya apararkən təxminən hər 45 saniyədən bir cihazınızın yeri. Hadisə çatlarında və klinikalarla şəxsi mesajlarda yazdıqlarınız. Verdiyiniz qiymətləndirmələr, bloklamalar və şikayətlər. Sizə göndərdiyimiz bildirişlərin surətləri və push-bildirişləri aktiv etsəniz, cihazınızın texniki ünvanı. 18 yaşınızın tamam olduğunu təsdiqlədiyiniz, İstifadə Şərtlərini və bu siyasəti qəbul etdiyiniz vaxt və versiya. Klinikalar əlavə olaraq klinika məlumatlarını, menecerin şəxsi əlaqə məlumatlarını və təsdiq sənədlərini təqdim edir. Texniki məlumatlar: cihazınız üçün sessiya identifikatoru (qonaqlar üçün də), bot yoxlaması (Cloudflare Turnstile) və xəta hesabatları (Sentry). Bu məlumatlardan yalnız xilasetmə xidmətini işlətmək üçün istifadə edirik: hadisələri dərc etmək, yaxınlıqdakı köməkçiləri xəbərdar etmək, xilasetmələri və klinikaları əlaqələndirmək, platformanı təhlükəsiz saxlamaq (bot yoxlamaları, spam limitləri, moderasiya) və hesabınızı təmin etmək.'],
      ['Hüquqi əsas',
        'Məlumatlarınızı sizin razılığınız, həmçinin xidməti işlətmək və təhlükəsiz saxlamaq üçün zəruri olanlar əsasında emal edirik. Razılıq: hesab yaratdıqda («18 yaşım tamam olub» və «İstifadə Şərtləri və Məxfilik siyasəti ilə razıyam» məcburi xanaları; tarix və versiya ilə qeydə alınır); qonaq kimi hər bildirişdə (eyni xanalar, bildirişlə birlikdə qeydə alınır); heyvanı apararkən yer üçün daşımanı başlatmaqla; push-bildirişlər üçün onları aktiv etməklə. Xidməti işlətmək və təhlükəsiz saxlamaq üçün zəruri olanlar: bot yoxlamaları, spam limitləri, moderasiya və hesab silindikdən sonra xilasetmə tarixçəsinin anonim şəkildə saxlanması.'],
      ['Nə açıqdır',
        'Açıq o deməkdir ki, hesabı olmayanlar da daxil olmaqla hər kəs onu görə bilər. Hadisə üçün bunlardır: heyvan, təsvir, vəziyyət, təcililik, dəqiq yer və küçə ünvanı, nişanə, status və onun vaxtları, verilibsə qonağın adı, hadisənin xronologiyası, hadisə çatı, həmçinin hadisəni hansı hesabların bildirdiyi, xilas etdiyi və müalicə etdiyi. Tətbiqdən istifadə edən hər kəs hadisənin fotolarını görə bilər. Həmçinin açıqdır: görünən adınız, profil şəkliniz, rolunuz, qoşulma tarixiniz, «kömək edilən heyvanlar» sayınız və tərəfdaş təşkilatınız; klinika qiymətləndirmələri, o cümlədən onları kimin verdiyi; təsdiqlənmiş klinikaların açıq məlumatları. Açıq deyil: bildirişi hansı cihazın və ya qonaq sessiyasının göndərdiyi; razılıq qeydləri; moderatorların gizlətdiyi hadisələr; və xilasedicinin canlı yeri — onu yalnız həmin hadisənin iştirakçıları (bildirən, xilasedici, klinika) və administratorlar görə bilər.'],
      ['Məlumatlarınızı başqa kim görə bilər',
        'Şəxsi mesajları söhbətdəki iki nəfər və administratorlar görə bilər. E-poçtunuzu, ad, soyad və telefonunuzu, ərazinizi və xəbərdarlıq parametrlərinizi, dilinizi, bildirişlərinizi, blok siyahınızı, göndərdiyiniz şikayətləri və razılıq qeydlərinizi yalnız siz və administratorlar görə bilər. Administratorlar bütün istifadəçilərin e-poçt ünvanlarını, bütün şəxsi mesajları, şikayətləri, gizlədilmiş məzmunu, klinikaların təsdiq sənədlərini və menecer əlaqə məlumatlarını görə bilər; bundan yalnız şikayətləri araşdırmaq, klinikaları təsdiqləmək və problemləri həll etmək üçün istifadə edirlər. Verilənlər bazasının operatoru kimi Stray’s Call-u idarə edən şəxsin saxlanılan bütün məlumatlara texniki çıxışı var.'],
      ['Məlumatlarınız harada saxlanılır',
        'Verilənlər bazamız, fayllarımız və giriş xidmətimiz Supabase tərəfindən Avropa İttifaqında (Paris, Fransa), Azərbaycandan kənarda yerləşdirilir. Tətbiqin faylları Vercel-in qlobal şəbəkəsi vasitəsilə çatdırılır; Vercel təhlükəsizlik məqsədilə sorğu qeydlərini qısa müddət saxlayır. Xəritələr, yer axtarışı və küçə ünvanının müəyyən edilməsi Google, bot yoxlaması isə Cloudflare tərəfindən təmin olunur; xəta hesabatları Sentry-yə göndərilir və orada provayderin standart müddəti ərzində saxlanılır; push-bildirişlər brauzerinizin push xidməti vasitəsilə çatdırılır. Məlumatlarınız Aİ-də (Fransa) saxlanılır və bu provayderlər tərəfindən dünyanın müxtəlif yerlərində emal olunur. Stray’s Call-dan istifadə etməklə bu ötürülməyə razılıq verirsiniz.'],
      ['Nə qədər saxlayırıq',
        'Hesabınız və profiliniz: hesabınızı silənə qədər. Hadisə bildirişləri və xronologiyaları: xilasetmə qeydi kimi saxlanılır; heç kimin götürmədiyi açıq hadisələr 24 saatdan sonra bağlanır, silinmir. Hadisə çatları: hadisə həll edildikdən və ya bağlandıqdan 90 gün sonra silinir (moderatorların yoxladığı mesaj yoxlama bitənə qədər saxlanılır). Fotolar: hazırda hadisə ilə birlikdə saxlanılır; fotoların avtomatik silinməsi işə düşdükdə silinmə müddətini bura əlavə edəcəyik. Heyvanı apararkən canlı yeriniz: heyvan çatdırıldıqda, xilasetmədən imtina edildikdə və ya 75 dəqiqə irəliləyiş olmadığı üçün xilasetmə yenidən açıldıqda silinir. Şəxsi mesajlar: siz və ya qarşı tərəf hesabını silənə qədər; bu zaman bütün söhbət silinir. Bildirişlər: 90 gün. Qonaq sessiyaları: açıq bildirişiniz yoxdursa, 30 gündən sonra silinir; tamamlanmış bildirişləriniz qalır, lakin artıq sessiya ilə əlaqələndirilmir. Klinikaların təsdiq sənədləri: klinikanın hesabı mövcud olduğu müddətdə. Push cihaz ünvanları: push-bildirişləri söndürənə, cihaz onları qəbul etməyi dayandırana və ya hesabınızı silənə qədər. Cihazınızda: sessiyanız, parametrləriniz və göndərilməmiş oflayn bildirişləriniz göndərilənə və ya brauzer məlumatlarını təmizləyənə qədər brauzerinizdə qalır; keşlənmiş fotolar 7 günə qədər saxlanılır.'],
      ['Hüquqlarınız',
        'Məlumatlarınıza baxmaq və ixrac etmək: Parametrlər → Məlumat və hesab → Məlumatlarımı ixrac et. Düzəliş etmək: Parametrlər → Şəxsi məlumatlar; xəbərdarlıqlar, ərazi və dil də Parametrlərdədir. Hesabınızı silmək: Parametrlər → Məlumat və hesab → Hesabımı sil. Bu, giriş məlumatlarınızı və e-poçtunuzu, profilinizi, xəbərdarlıq parametrlərinizi, bildirişlərinizi, push cihazlarınızı, blok siyahınızı, göndərdiyiniz şikayətləri, «heyvan burada yoxdur» qeydlərinizi, izlədiyiniz hadisələri, verdiyiniz klinika qiymətləndirmələrini, iştirak etdiyiniz bütün şəxsi yazışmaları (hər iki tərəf üçün) və klinikalar üçün klinikanı və onun təsdiq sənədlərini həmişəlik silir. Hadisə çatlarındakı mesajlarınız hadisədə qalır və «Silinmiş hesab» kimi göstərilir. Yaratdığınız və ya xilas etdiyiniz hadisələr xilasetmə tarixçəsi kimi qalır, lakin artıq sizinlə əlaqələndirilmir. Xilasetmənin ortasında idinizsə, hadisə digər xilasedicilər üçün yenidən açılır; klinikanız heyvanı gözləyirdisə, xilasedicidən başqa klinika seçməsi xahiş olunur. Razılığınızı geri götürmək üçün hesabınızı silin (yer və ya push üçün: daşımanı dayandırın və ya push-bildirişləri söndürün). Digər məsələlər üçün fikretmutallimov@gmail.com ünvanına yazın. Mümkün qədər tez, qanunun müəyyən etdiyi müddət ərzində cavab verəcəyik. Ölkənizdəki məlumatların qorunması üzrə səlahiyyətli orqana da şikayət edə bilərsiniz.'],
      ['Yalnız 18+',
        'Stray’s Call yalnız 18 yaş və yuxarı şəxslər üçündür. Hər kəs hesab yaratmazdan və ya qonaq kimi bildiriş göndərməzdən əvvəl bunu təsdiqləyir.'],
      ['Fotolar və yer',
        'Fotolar yüklənmədən əvvəl cihazınızda kiçildilir və yenidən kodlaşdırılır, bu da GPS mövqeyi kimi gizli metaməlumatları silir; bu mümkün olmadıqda foto yüklənmir. Klinikaların təsdiq sənədləri olduğu kimi yüklənir və yalnız klinikaya və administratorlara görünür. Yer məlumatından yalnız bunlar üçün istifadə edirik: bildirişdə qoyduğunuz nişan (açıq); xəbərdarlıqlar üçün seçdiyiniz ərazi (şəxsi); heyvanı apararkən cihazınızın yeri (yalnız həmin hadisənin iştirakçılarına və administratorlara görünür, daşıma bitəndə silinir); və cihazınızda xəritəni mərkəzləşdirmək və məsafələri göstərmək (saxlanılmır). Küçə ünvanını müəyyən etmək üçün bildirişin yeri Google-a göndərilir.'],
      ['Stray’s Call nə ETMİR',
        'Stray’s Call məlumatlarınızı satmır, hədəflənmiş reklam göstərmir və ödənişləri emal etmir. Klinika hadisə çatında bank rekvizitlərini paylaşırsa, ödəniş birbaşa siz və klinika arasında, Stray’s Call-dan kənarda baş verir.'],
      ['Bu siyasətdəki dəyişikliklər',
        'İstifadə Şərtlərini və ya bu siyasəti əhəmiyyətli dərəcədə dəyişdikdə versiyanı yeniləyirik və hesabı olan hər kəsdən davam etməzdən əvvəl onları yenidən qəbul etməsi istənilir. Qonaqlar hər bildirişdə cari versiyanı qəbul edir.'],
    ],
  },
  tr: {
    title: 'Gizlilik politikası',
    sections: [
      ['Stray’s Call’u kim işletiyor',
        'Stray’s Call, bir birey olarak Fikrat Mutallimov tarafından işletilmektedir; burada açıklanan kişisel verilerden o sorumludur. Bize yalnızca e-posta ile ulaşabilirsiniz: fikretmutallimov@gmail.com.'],
      ['Ne topluyoruz ve neden',
        'Hesabınız: e-posta ve şifre (giriş yapabilmeniz için); ad, soyad ve isteğe bağlı telefon (klinikler ve kurtarıcılar kiminle muhatap olduklarını bilsin diye); adınızdan oluşturulan görünen ad; diliniz. Google ile giriş yaparsanız Google’dan adınızı, e-postanızı ve profil fotoğrafınızı alırız. Uyarı ayarları: yakınınızdaki vakalar için uyarı almayı seçerseniz belirlediğiniz bölge ve yarıçap. Vaka bildirimleri: fotoğraflar, açıklama, hayvanın durumu ve aciliyeti, haritada işaretlediğiniz tam konum, isteğe bağlı bir yer tarifi ve bu konumdan bulduğumuz sokak adresi; misafir olarak yazdığınız isteğe bağlı ad. Kurtarmalar: vakadaki rolünüz ve yalnızca bir hayvanı kliniğe götürürken, yaklaşık 45 saniyede bir cihazınızın konumu. Vaka sohbetlerinde ve kliniklerle özel mesajlarda yazdıklarınız. Yaptığınız değerlendirmeler, engellemeler ve şikayetler. Size gönderdiğimiz bildirimlerin kopyaları ve anlık bildirimleri açarsanız cihazınızın teknik adresi. 18 yaşında veya daha büyük olduğunuzu onayladığınız, Kullanım Şartlarını ve bu politikayı kabul ettiğiniz zaman ve sürüm. Klinikler ayrıca klinik bilgilerini, yöneticinin özel iletişim bilgilerini ve doğrulama belgelerini sağlar. Teknik veriler: cihazınız için bir oturum kimliği (misafirler için de), bir bot kontrolü (Cloudflare Turnstile) ve hata raporları (Sentry). Bu verileri yalnızca kurtarma hizmetini yürütmek için kullanırız: vakaları yayınlamak, yakındaki gönüllüleri uyarmak, kurtarmaları ve klinikleri koordine etmek, platformu güvende tutmak (bot kontrolleri, spam sınırları, moderasyon) ve hesabınızı sağlamak.'],
      ['Hukuki dayanak',
        'Verilerinizi rızanıza ve hizmeti yürütmek ve güvende tutmak için gerekli olanlara dayanarak işleriz. Rıza: hesap oluştururken («18 yaşında veya daha büyüğüm» ve «Kullanım Şartları ve Gizlilik politikası’nı kabul ediyorum» zorunlu kutuları; tarih ve sürümle kaydedilir); misafir olarak her bildirimde (aynı kutular, bildirimle birlikte kaydedilir); hayvanı taşırken konum için taşımayı başlatarak; anlık bildirimler için onları açarak. Hizmeti yürütmek ve güvende tutmak için gerekli olanlar: bot kontrolleri, spam sınırları, moderasyon ve bir hesap silindikten sonra kurtarma geçmişinin anonim olarak saklanması.'],
      ['Ne herkese açıktır',
        'Herkese açık, hesabı olmayanlar dahil herkesin görebileceği anlamına gelir. Bir vaka için bunlar: hayvan, açıklama, durum, aciliyet, tam konum ve sokak adresi, yer tarifi, vaka durumu ve zamanları, verilmişse misafirin adı, vakanın zaman çizelgesi, vaka sohbeti ve vakayı hangi hesapların bildirdiği, kurtardığı ve tedavi ettiği. Uygulamayı kullanan herkes bir vakanın fotoğraflarını görebilir. Ayrıca herkese açık olanlar: görünen adınız, profil fotoğrafınız, rolünüz, katılma tarihiniz, «yardım edilen hayvanlar» sayınız ve ortak kuruluşunuz; kimin yaptığı dahil klinik değerlendirmeleri; onaylı kliniklerin herkese açık bilgileri. Herkese açık olmayanlar: bir bildirimi hangi cihazın veya misafir oturumunun gönderdiği; rıza kayıtları; moderatörlerin gizlediği vakalar; ve kurtarıcının canlı konumu — bunu yalnızca o vakadaki kişiler (bildiren, kurtarıcı, klinik) ve yöneticiler görebilir.'],
      ['Verilerinizi başka kim görebilir',
        'Özel mesajları sohbetteki iki kişi ve yöneticiler görebilir. E-postanızı, ad, soyad ve telefonunuzu, bölgenizi ve uyarı ayarlarınızı, dilinizi, bildirimlerinizi, engellenenler listenizi, gönderdiğiniz şikayetleri ve rıza kayıtlarınızı yalnızca siz ve yöneticiler görebilir. Yöneticiler tüm kullanıcıların e-posta adreslerini, tüm özel mesajları, şikayetleri, gizlenen içeriği, kliniklerin doğrulama belgelerini ve yönetici iletişim bilgilerini görebilir; bunları yalnızca şikayetleri incelemek, klinikleri onaylamak ve sorunları çözmek için kullanırlar. Veritabanı işletmecisi olarak Stray’s Call’u işleten kişinin saklanan tüm verilere teknik erişimi vardır.'],
      ['Verileriniz nerede saklanıyor',
        'Veritabanımız, dosyalarımız ve giriş hizmetimiz Supabase tarafından Avrupa Birliği’nde (Paris, Fransa), Azerbaycan dışında barındırılır. Uygulamanın dosyaları Vercel’in küresel ağı üzerinden sunulur; Vercel güvenlik amacıyla istek kayıtlarını kısa bir süre saklar. Haritalar, yer arama ve sokak adresi bulma Google, bot kontrolü ise Cloudflare tarafından sağlanır; hata raporları Sentry’ye gider ve sağlayıcının standart süresi boyunca saklanır; anlık bildirimler tarayıcınızın bildirim hizmeti üzerinden iletilir. Verileriniz AB’de (Fransa) saklanır ve bu sağlayıcılar tarafından dünyanın farklı yerlerinde işlenir. Stray’s Call’u kullanarak bu aktarıma rıza göstermiş olursunuz.'],
      ['Ne kadar süre saklıyoruz',
        'Hesabınız ve profiliniz: hesabınızı silene kadar. Vaka bildirimleri ve zaman çizelgeleri: kurtarma kaydı olarak saklanır; kimsenin üstlenmediği açık vakalar 24 saat sonra kapatılır, silinmez. Vaka sohbetleri: vaka çözüldükten veya kapatıldıktan 90 gün sonra silinir (moderatörlerin incelediği bir mesaj inceleme bitene kadar saklanır). Fotoğraflar: şu anda vakayla birlikte saklanır; otomatik fotoğraf temizliği devreye girdiğinde silme süresini buraya ekleyeceğiz. Taşıma sırasındaki canlı konumunuz: hayvan teslim edildiğinde, kurtarmadan vazgeçildiğinde veya 75 dakika ilerleme olmadığı için kurtarma yeniden açıldığında silinir. Özel mesajlar: siz veya karşı taraf hesabını silene kadar; o zaman tüm sohbet silinir. Bildirimler: 90 gün. Misafir oturumları: açık bir bildiriminiz yoksa 30 gün sonra silinir; tamamlanmış bildirimleriniz kalır, ancak artık oturumla ilişkilendirilmez. Kliniklerin doğrulama belgeleri: kliniğin hesabı var olduğu sürece. Anlık bildirim cihaz adresleri: anlık bildirimleri kapatana, cihaz bildirim almayı bırakana veya hesabınızı silene kadar. Cihazınızda: oturumunuz, ayarlarınız ve gönderilmemiş çevrimdışı bildirimleriniz gönderilene veya tarayıcı verilerinizi temizleyene kadar tarayıcınızda kalır; önbelleğe alınan fotoğraflar en fazla 7 gün saklanır.'],
      ['Haklarınız',
        'Verilerinizi görmek ve dışa aktarmak: Ayarlar → Veri ve hesap → Verilerimi dışa aktar. Düzeltmek: Ayarlar → Kişisel bilgiler; uyarılar, bölge ve dil de Ayarlar’dadır. Hesabınızı silmek: Ayarlar → Veri ve hesap → Hesabımı sil. Bu işlem giriş bilgilerinizi ve e-postanızı, profilinizi, uyarı ayarlarınızı, bildirimlerinizi, anlık bildirim cihazlarınızı, engellenenler listenizi, gönderdiğiniz şikayetleri, «hayvan burada değil» işaretlerinizi, takip ettiğiniz vakaları, yaptığınız klinik değerlendirmelerini, dahil olduğunuz tüm özel sohbetleri (iki taraf için de) ve klinikler için kliniği ve doğrulama belgelerini kalıcı olarak siler. Vaka sohbetlerindeki mesajlarınız vakada kalır ve «Silinmiş hesap» olarak gösterilir. Oluşturduğunuz veya kurtardığınız vakalar kurtarma geçmişi olarak kalır, ancak artık sizinle ilişkilendirilmez. Bir kurtarmanın ortasındaysanız vaka diğer kurtarıcılara yeniden açılır; kliniğiniz bir hayvan bekliyorsa kurtarıcıdan başka bir klinik seçmesi istenir. Rızanızı geri çekmek için hesabınızı silin (konum veya anlık bildirimler için: taşımayı durdurun veya anlık bildirimleri kapatın). Diğer her şey için fikretmutallimov@gmail.com adresine yazın. Mümkün olan en kısa sürede ve yasanın öngördüğü süre içinde yanıt vereceğiz. Ülkenizdeki veri koruma otoritesine de şikayette bulunabilirsiniz.'],
      ['Yalnızca 18+',
        'Stray’s Call yalnızca 18 yaş ve üzeri kişiler içindir. Herkes bir hesap oluşturmadan veya misafir olarak bildirim göndermeden önce bunu onaylar.'],
      ['Fotoğraflar ve konum',
        'Fotoğraflar yüklenmeden önce cihazınızda küçültülür ve yeniden kodlanır, bu da GPS konumu gibi gizli meta verileri kaldırır; bu yapılamazsa fotoğraf yüklenmez. Kliniklerin doğrulama belgeleri olduğu gibi yüklenir ve yalnızca kliniğe ve yöneticilere görünür. Konumu yalnızca şunlar için kullanırız: bir bildirime koyduğunuz işaret (herkese açık); uyarılar için seçtiğiniz bölge (gizli); bir hayvanı taşırken cihazınızın konumu (yalnızca o vakadaki kişilere ve yöneticilere görünür, taşıma bitince silinir); ve cihazınızda haritayı ortalamak ve mesafeleri göstermek (saklanmaz). Sokak adresini bulmak için bildirim konumları Google’a gönderilir.'],
      ['Stray’s Call ne YAPMAZ',
        'Stray’s Call verilerinizi satmaz, hedefli reklam göstermez ve ödeme işlemez. Bir klinik vaka sohbetinde banka bilgilerini paylaşırsa, ödeme doğrudan siz ve klinik arasında, Stray’s Call dışında gerçekleşir.'],
      ['Bu politikadaki değişiklikler',
        'Kullanım Şartlarını veya bu politikayı önemli ölçüde değiştirdiğimizde sürümü güncelleriz ve hesabı olan herkesin devam etmeden önce yeniden kabul etmesi istenir. Misafirler her bildirimde geçerli sürümü kabul eder.'],
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
