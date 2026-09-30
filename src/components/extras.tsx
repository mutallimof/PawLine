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

/** A section body: one paragraph, or a lead sentence + bullet list + closing sentence. */
type DocBody = string | { lead: string; items: string[]; outro?: string };

const PRIVACY: Record<string, { title: string; effective: string; intro: string; sections: [string, DocBody][] }> = {
  en: {
    title: 'Privacy Policy',
    effective: 'Effective date: 1 October 2026',
    intro: 'This Privacy Policy describes how personal data is processed in connection with the Stray’s Call web application and its related services.',
    sections: [
      ['1. Data Controller',
        'The data controller responsible for the processing of personal data described in this Policy is Fikrat Mutallimov, an individual (the “Controller”, “we”, “us”). The Controller may be contacted by email only, at hello@strayscall.com.'],
      ['2. Personal Data We Process and Purposes', {
        lead: 'We process the following categories of personal data:',
        items: [
          'Account data: email address and password; first name, last name and, optionally, telephone number, so that clinics and rescuers can identify the persons with whom they are dealing; a display name derived from the first and last name; and the selected language. Where you sign in with Google, we receive your name, email address and profile picture from Google.',
          'Alert settings: where you elect to receive alerts about nearby cases, the home area and radius you specify.',
          'Report data: photographs, description, the animal’s condition and urgency, the exact location marked on the map, an optional landmark, and a street address derived from that location; for guest reports, the name optionally provided.',
          'Rescue data: your role in a case and, solely while you are transporting an animal to a clinic, the location of your device at intervals of approximately 45 seconds.',
          'The content of messages you send in case chats and in direct messages with clinics.',
          'Ratings, blocks and content reports you submit.',
          'Copies of notifications sent to you and, where you enable push notifications, a technical address of your device.',
          'Consent records: the date and version of your confirmation that you are at least 18 years of age and of your acceptance of the Terms of Service and this Policy.',
          'For clinics, in addition: clinic details, the private contact details of a manager, and verification documents.',
          'Technical data: a session identifier for your device (including for guests), data processed for automated bot detection (Cloudflare Turnstile), and error reports (Sentry).',
        ],
        outro: 'Personal data is processed solely for the purposes of operating the rescue service: publishing reports, alerting nearby helpers, coordinating rescues and clinics, maintaining the security of the platform (bot detection, spam limits and moderation), and providing your account.',
      }],
      ['3. Legal Basis for Processing',
        'Personal data is processed on the basis of your consent and where processing is necessary to operate the service and maintain its security. Consent is given: when you create an account, by ticking the mandatory boxes “I am 18 or older” and “I agree to the Terms of Service and the Privacy policy”, which are recorded together with the date and version; for guest reports, by ticking the same boxes for each report, which are recorded with the report; for location data during transport, by starting the transport; and for push notifications, by enabling them. Processing necessary to operate the service and maintain its security comprises bot detection, spam limits, moderation, and the retention of rescue history in anonymised form after an account has been deleted.'],
      ['4. Publicly Visible Information',
        'Information described as public may be viewed by anyone, including persons without an account. In respect of a case, the following information is public: the animal, description, condition, urgency, exact location and street address, landmark, status and associated times, the guest name where provided, the case timeline, the case chat, and the accounts that reported, rescued and treated the animal. Photographs of a case are visible to all users of the application. The following information is also public: your display name, profile picture, role, date of joining, number of animals helped and partner organisation; clinic ratings, including the identity of the person who submitted them; and the public details of approved clinics. The following information is not public: the device or guest session from which a report was submitted; consent records; cases hidden by moderators; and the live location of the rescuer, which is accessible only to the participants in the case concerned (the reporter, the rescuer and the clinic) and to administrators.'],
      ['5. Access to Personal Data and Recipients',
        'Direct messages are accessible to the two participants in the conversation and to administrators. Your email address, name and telephone number, home area and alert settings, language, notifications, block list, content reports submitted by you and consent records are accessible only to you and to administrators. Administrators have access to the email addresses of all users, all direct messages, content reports, hidden content, clinic verification documents and manager contact details, and use such access solely to review abuse reports, approve clinics and resolve technical issues. In its capacity as database operator, the Controller has technical access to all stored data. The recipients of personal data are the service providers listed in Section 6.'],
      ['6. Storage Location and International Transfers',
        'The database, files and authentication service are hosted by Supabase in the European Union (Paris, France), outside the Republic of Azerbaijan. The application’s files are delivered through Vercel’s global network; Vercel retains request logs for a short period for security purposes. Maps, place search and street-address lookups are provided by Google, and bot detection by Cloudflare. Error reports are transmitted to Sentry and retained for its standard retention period. Push notifications are delivered through the push service of your browser. Personal data is stored in the European Union (France) and processed by the above providers in various countries. By using Stray’s Call, you consent to this international transfer of personal data.'],
      ['7. Retention Periods',
        'Personal data is retained for the following periods: account and profile data — until the account is deleted; reports and case timelines — retained as the rescue record, and open reports that are not taken up are closed after 24 hours and are not deleted; case chats — deleted 90 days after the case is resolved or closed, save that a message under review by moderators is retained until the review is completed; photographs — currently retained together with the case, and a retention period will be added to this Policy once automated deletion of photographs is in place; live location during transport — deleted upon delivery of the animal, withdrawal from the rescue, or automatic reopening of the rescue after 75 minutes without progress; direct messages — until either participant deletes their account, whereupon the entire conversation is deleted; notifications — 90 days; guest sessions — deleted after 30 days unless an open report exists, while completed reports are retained without any link to the session; clinic verification documents — for as long as the clinic’s account exists; push device addresses — until push notifications are disabled, the device ceases to accept them, or the account is deleted. Data stored on your device (session, settings and unsent offline reports) remains in your browser until it is sent or the browser data is cleared; cached photographs are kept for up to 7 days.'],
      ['8. Your Rights',
        'You have the right to access your personal data and obtain a copy of it via Settings → Data & account → Export my data, and to rectify it via Settings → Personal information; alert, area and language settings may be changed in Settings. You may delete your account via Settings → Data & account → Delete my account. Deletion permanently removes your sign-in credentials and email address, profile, alert settings, notifications, push devices, block list, content reports submitted by you, “not here” flags, watched cases, clinic ratings submitted by you, all direct-message conversations in which you participate (for both participants) and, in the case of clinics, the clinic and its verification documents. Messages you have posted in case chats remain in the case and are displayed as “Deleted account”. Cases you created or rescued are retained as rescue history without any link to you. Where a rescue in which you are participating is in progress, the case is reopened to other rescuers; where your clinic is expecting an animal, the rescuer is asked to select another clinic. You may withdraw your consent by deleting your account or, in respect of location data or push notifications, by stopping the transport or disabling push notifications. Any other request may be sent to hello@strayscall.com. We will respond as soon as possible and within any time limit prescribed by law. You also have the right to lodge a complaint with the data protection authority in your country.'],
      ['9. Age Requirement',
        'Stray’s Call is intended solely for persons aged 18 and over. Each user confirms that they meet this requirement before creating an account or submitting a report as a guest.'],
      ['10. Photographs and Location Data',
        'Photographs are resized and re-encoded on your device before upload, which removes embedded metadata such as GPS position; where this cannot be done, the photograph is not uploaded. Clinic verification documents are uploaded in their original form and are accessible only to the clinic concerned and to administrators. Location data is used solely for the following purposes: the location marked on a report (public); the home area selected for alerts (not public); the location of your device while transporting an animal (accessible only to the participants in the case concerned and to administrators, and deleted at the end of the transport); and centring the map and displaying distances on your device (not stored). Report locations are transmitted to Google in order to determine a street address.'],
      ['11. Our Commitments',
        'We do not sell personal data, do not display targeted advertising and do not process payments. Where a clinic shares bank details in a case chat, any payment is made directly between you and the clinic, outside Stray’s Call.'],
      ['12. Changes to This Policy',
        'In the event of material changes to the Terms of Service or this Policy, the version will be updated and all account holders will be asked to accept the updated version before continuing to use the service. Guests accept the version in force when submitting each report.'],
    ],
  },
  az: {
    title: 'Məxfilik siyasəti',
    effective: 'Qüvvəyə minmə tarixi: 1 oktyabr 2026',
    intro: 'Bu Məxfilik siyasəti Stray’s Call veb-tətbiqi və onunla bağlı xidmətlər çərçivəsində fərdi məlumatların emalı qaydasını müəyyən edir.',
    sections: [
      ['1. Fərdi məlumatların operatoru',
        'Bu Siyasətdə təsvir edilən fərdi məlumatların emalına görə məsuliyyət daşıyan operator fiziki şəxs Fikrət Mütəllimovdur (bundan sonra — «Operator», «biz»). Operatorla yalnız elektron poçt vasitəsilə əlaqə saxlanıla bilər: hello@strayscall.com.'],
      ['2. Emal olunan fərdi məlumatlar və emalın məqsədləri', {
        lead: 'Aşağıdakı fərdi məlumat kateqoriyaları emal olunur:',
        items: [
          'Hesab məlumatları: elektron poçt ünvanı və şifrə; klinikaların və xilasedicilərin əlaqədə olduqları şəxsi müəyyən edə bilməsi üçün ad, soyad və könüllü olaraq telefon nömrəsi; ad və soyad əsasında formalaşan görünən ad; seçilmiş dil. Google vasitəsilə daxil olduqda Google-dan adınız, elektron poçt ünvanınız və profil şəkliniz əldə edilir.',
          'Xəbərdarlıq parametrləri: yaxınlıqdakı hadisələr barədə xəbərdarlıq almağı seçdiyiniz halda müəyyən etdiyiniz ərazi və radius.',
          'Hadisə bildirişlərinin məlumatları: fotoşəkillər, təsvir, heyvanın vəziyyəti və təcililik dərəcəsi, xəritədə qeyd edilmiş dəqiq yer, könüllü olaraq göstərilən nişanə və həmin yer əsasında müəyyən edilən küçə ünvanı; qonaq bildirişlərində könüllü olaraq göstərilən ad.',
          'Xilasetmə məlumatları: hadisədəki rolunuz və yalnız heyvanı klinikaya daşıdığınız müddətdə, təxminən 45 saniyəlik fasilələrlə cihazınızın yeri.',
          'Hadisə üzrə yazışmalarda və klinikalarla şəxsi yazışmalarda göndərdiyiniz mesajların məzmunu.',
          'Təqdim etdiyiniz qiymətləndirmələr, bloklamalar və şikayətlər.',
          'Sizə göndərilən bildirişlərin surətləri və push-bildirişləri aktivləşdirdiyiniz halda cihazınızın texniki ünvanı.',
          'Razılıq qeydləri: 18 yaşınızın tamam olduğunu təsdiqlədiyiniz, İstifadə Şərtlərini və bu Siyasəti qəbul etdiyiniz tarix və versiya.',
          'Klinikalar üçün əlavə olaraq: klinikanın məlumatları, menecerin şəxsi əlaqə məlumatları və təsdiqedici sənədlər.',
          'Texniki məlumatlar: cihazınız üçün sessiya identifikatoru (qonaqlar daxil olmaqla), avtomatlaşdırılmış bot yoxlaması (Cloudflare Turnstile) üçün emal olunan məlumatlar və xəta hesabatları (Sentry).',
        ],
        outro: 'Fərdi məlumatlar yalnız xilasetmə xidmətinin fəaliyyəti məqsədilə emal olunur: hadisə bildirişlərinin dərc edilməsi, yaxınlıqdakı könüllülərin xəbərdar edilməsi, xilasetmələrin və klinikaların əlaqələndirilməsi, platformanın təhlükəsizliyinin təmin edilməsi (bot yoxlaması, spam məhdudiyyətləri və moderasiya) və hesabınıza xidmət göstərilməsi.',
      }],
      ['3. Emalın hüquqi əsası',
        'Fərdi məlumatlar Sizin razılığınız əsasında, habelə xidmətin fəaliyyəti və təhlükəsizliyinin təmin edilməsi üçün zəruri olduğu hallarda emal olunur. Razılıq aşağıdakı qaydada verilir: hesab yaradılarkən «18 yaşım tamam olub» və «İstifadə Şərtləri və Məxfilik siyasəti ilə razıyam» məcburi xanalarının qeyd edilməsi ilə (tarix və versiya ilə birlikdə qeydə alınır); qonaq bildirişlərində hər bildiriş zamanı eyni xanaların qeyd edilməsi ilə (bildirişlə birlikdə qeydə alınır); daşıma zamanı yer məlumatları üçün daşımanın başladılması ilə; push-bildirişlər üçün onların aktivləşdirilməsi ilə. Xidmətin fəaliyyəti və təhlükəsizliyinin təmin edilməsi üçün zəruri olan emala bot yoxlaması, spam məhdudiyyətləri, moderasiya və hesab silindikdən sonra xilasetmə tarixçəsinin anonimləşdirilmiş formada saxlanması aiddir.'],
      ['4. İctimaiyyətə açıq məlumatlar',
        'İctimaiyyətə açıq məlumatlarla hesabı olmayan şəxslər də daxil olmaqla hər kəs tanış ola bilər. Hadisəyə dair aşağıdakı məlumatlar ictimaiyyətə açıqdır: heyvan, təsvir, vəziyyət, təcililik dərəcəsi, dəqiq yer və küçə ünvanı, nişanə, status və müvafiq vaxtlar, göstərildiyi halda qonağın adı, hadisənin xronologiyası, hadisə üzrə yazışmalar, habelə heyvan barədə bildiriş verən, onu xilas edən və müalicə edən hesablar. Hadisənin fotoşəkilləri tətbiqin bütün istifadəçiləri üçün əlçatandır. Həmçinin aşağıdakılar ictimaiyyətə açıqdır: görünən adınız, profil şəkliniz, rolunuz, qoşulma tarixiniz, kömək edilən heyvanların sayı və tərəfdaş təşkilatınız; qiymətləndirməni verən şəxs göstərilməklə klinika qiymətləndirmələri; təsdiqlənmiş klinikaların açıq məlumatları. Aşağıdakı məlumatlar ictimaiyyətə açıq deyil: bildirişin hansı cihazdan və ya qonaq sessiyasından göndərildiyi; razılıq qeydləri; moderatorlar tərəfindən gizlədilmiş hadisələr; xilasedicinin canlı yeri — bu məlumat yalnız müvafiq hadisənin iştirakçıları (bildiriş verən, xilasedici və klinika) və administratorlar üçün əlçatandır.'],
      ['5. Fərdi məlumatlara çıxış və alıcılar',
        'Şəxsi yazışmalar yalnız yazışmanın iki iştirakçısı və administratorlar üçün əlçatandır. Elektron poçt ünvanınız, adınız, soyadınız və telefon nömrəniz, ərazi və xəbərdarlıq parametrləriniz, diliniz, bildirişləriniz, blok siyahınız, təqdim etdiyiniz şikayətlər və razılıq qeydləriniz yalnız Sizin və administratorlar üçün əlçatandır. Administratorların bütün istifadəçilərin elektron poçt ünvanlarına, bütün şəxsi yazışmalara, şikayətlərə, gizlədilmiş məzmuna, klinikaların təsdiqedici sənədlərinə və menecerlərin əlaqə məlumatlarına çıxışı var; bu çıxışdan yalnız şikayətlərin araşdırılması, klinikaların təsdiqlənməsi və texniki problemlərin aradan qaldırılması məqsədilə istifadə olunur. Verilənlər bazasının idarəçisi qismində Operatorun saxlanılan bütün məlumatlara texniki çıxışı var. Fərdi məlumatların alıcıları 6-cı bölmədə göstərilən üçüncü şəxslər — xidmət təminatçılarıdır.'],
      ['6. Saxlanma yeri və transsərhəd ötürmə',
        'Verilənlər bazası, fayllar və autentifikasiya xidməti Azərbaycan Respublikasının hüdudlarından kənarda, Avropa İttifaqında (Paris, Fransa) Supabase tərəfindən yerləşdirilir. Tətbiqin faylları Vercel-in qlobal şəbəkəsi vasitəsilə çatdırılır; Vercel sorğu jurnallarını təhlükəsizlik məqsədilə qısa müddət ərzində saxlayır. Xəritələr, yer axtarışı və küçə ünvanının müəyyən edilməsi xidmətləri Google, bot yoxlaması isə Cloudflare tərəfindən təmin edilir. Xəta hesabatları Sentry-yə ötürülür və onun standart saxlanma müddəti ərzində saxlanılır. Push-bildirişlər brauzerinizin push xidməti vasitəsilə çatdırılır. Fərdi məlumatlar Avropa İttifaqında (Fransa) saxlanılır və yuxarıda göstərilən təminatçılar tərəfindən müxtəlif ölkələrdə emal olunur. Stray’s Call-dan istifadə etməklə Siz fərdi məlumatlarınızın bu transsərhəd ötürülməsinə razılıq verirsiniz.'],
      ['7. Saxlanma müddətləri',
        'Fərdi məlumatlar aşağıdakı müddətlər ərzində saxlanılır: hesab və profil məlumatları — hesab silinənədək; hadisə bildirişləri və xronologiyalar — xilasetmə qeydi kimi saxlanılır, heç kim tərəfindən götürülməyən açıq hadisələr isə 24 saatdan sonra bağlanır və silinmir; hadisə üzrə yazışmalar — hadisə həll edildikdən və ya bağlandıqdan 90 gün sonra silinir, moderatorlar tərəfindən yoxlanılan mesaj isə yoxlama başa çatanadək saxlanılır; fotoşəkillər — hazırda hadisə ilə birlikdə saxlanılır, fotoşəkillərin avtomatik silinməsi tətbiq edildikdən sonra saxlanma müddəti bu Siyasətə əlavə ediləcək; daşıma zamanı canlı yer — heyvan çatdırıldıqda, xilasetmədən imtina edildikdə və ya 75 dəqiqə ərzində irəliləyiş olmadığı üçün xilasetmə avtomatik olaraq yenidən açıldıqda silinir; şəxsi yazışmalar — iştirakçılardan biri hesabını silənədək, bundan sonra bütün yazışma silinir; bildirişlər — 90 gün; qonaq sessiyaları — açıq bildiriş olmadıqda 30 gündən sonra silinir, tamamlanmış bildirişlər isə sessiya ilə əlaqəsi olmadan saxlanılır; klinikaların təsdiqedici sənədləri — klinikanın hesabı mövcud olduğu müddətdə; push cihaz ünvanları — push-bildirişlər söndürülənədək, cihaz onları qəbul etməyi dayandıranadək və ya hesab silinənədək. Cihazınızda saxlanılan məlumatlar (sessiya, parametrlər və göndərilməmiş oflayn bildirişlər) göndərilənədək və ya brauzer məlumatları təmizlənənədək brauzerinizdə qalır; keşlənmiş fotoşəkillər 7 günədək saxlanılır.'],
      ['8. Subyektin hüquqları',
        'Fərdi məlumatların subyekti kimi Siz fərdi məlumatlarınızla tanış olmaq və onların surətini əldə etmək hüququna maliksiniz: Parametrlər → Məlumat və hesab → Məlumatlarımı ixrac et. Məlumatlarınız Parametrlər → Şəxsi məlumatlar bölməsində düzəldilə bilər; xəbərdarlıq, ərazi və dil parametrləri Parametrlər bölməsində dəyişdirilir. Hesabınızı Parametrlər → Məlumat və hesab → Hesabımı sil vasitəsilə silə bilərsiniz. Hesabın silinməsi giriş məlumatlarınızı və elektron poçt ünvanınızı, profilinizi, xəbərdarlıq parametrlərinizi, bildirişlərinizi, push cihazlarınızı, blok siyahınızı, təqdim etdiyiniz şikayətləri, «heyvan burada yoxdur» qeydlərinizi, izlədiyiniz hadisələri, verdiyiniz klinika qiymətləndirmələrini, iştirak etdiyiniz bütün şəxsi yazışmaları (hər iki iştirakçı üçün), klinikalar üçün isə klinikanı və onun təsdiqedici sənədlərini birdəfəlik silir. Hadisə üzrə yazışmalarda göndərdiyiniz mesajlar hadisədə qalır və «Silinmiş hesab» kimi göstərilir. Yaratdığınız və ya xilas etdiyiniz hadisələr Sizinlə əlaqəsi olmadan xilasetmə tarixçəsi kimi saxlanılır. İştirak etdiyiniz xilasetmə davam edirsə, hadisə digər xilasedicilər üçün yenidən açılır; klinikanız heyvanı gözləyirsə, xilasedicidən başqa klinika seçməsi xahiş olunur. Razılığınızı hesabınızı silməklə, yer məlumatları və ya push-bildirişlər baxımından isə daşımanı dayandırmaqla və ya push-bildirişləri söndürməklə geri götürə bilərsiniz. Digər müraciətlər hello@strayscall.com ünvanına göndərilə bilər. Müraciətlərə mümkün qədər qısa müddətdə və qanunvericiliklə müəyyən edilmiş müddət ərzində cavab veriləcək. Siz həmçinin ölkənizdəki fərdi məlumatların qorunması üzrə səlahiyyətli orqana şikayət etmək hüququna maliksiniz.'],
      ['9. Yaş məhdudiyyəti',
        'Stray’s Call yalnız 18 yaşına çatmış şəxslər üçün nəzərdə tutulub. Hər bir istifadəçi hesab yaratmazdan və ya qonaq kimi bildiriş göndərməzdən əvvəl bu tələbə cavab verdiyini təsdiqləyir.'],
      ['10. Fotoşəkillər və məkan məlumatları',
        'Fotoşəkillər yüklənmədən əvvəl cihazınızda kiçildilir və yenidən kodlaşdırılır; bu zaman GPS mövqeyi kimi daxili metaməlumatlar silinir. Bunu etmək mümkün olmadıqda fotoşəkil yüklənmir. Klinikaların təsdiqedici sənədləri ilkin formada yüklənir və yalnız müvafiq klinika və administratorlar üçün əlçatandır. Məkan məlumatları yalnız aşağıdakı məqsədlərlə istifadə olunur: bildirişdə qeyd edilən yer (ictimaiyyətə açıq); xəbərdarlıqlar üçün seçilmiş ərazi (ictimaiyyətə açıq deyil); heyvanın daşınması zamanı cihazınızın yeri (yalnız müvafiq hadisənin iştirakçıları və administratorlar üçün əlçatandır və daşıma başa çatdıqda silinir); cihazınızda xəritənin mərkəzləşdirilməsi və məsafələrin göstərilməsi (saxlanılmır). Küçə ünvanının müəyyən edilməsi üçün bildirişin yeri Google-a ötürülür.'],
      ['11. Öhdəliklərimiz',
        'Biz fərdi məlumatları satmırıq, hədəflənmiş reklam göstərmirik və ödənişləri emal etmirik. Klinika hadisə üzrə yazışmalarda bank rekvizitlərini paylaşdıqda istənilən ödəniş Stray’s Call-dan kənarda, birbaşa Siz və klinika arasında həyata keçirilir.'],
      ['12. Siyasətə edilən dəyişikliklər',
        'İstifadə Şərtlərinə və ya bu Siyasətə əhəmiyyətli dəyişikliklər edildikdə versiya yenilənir və bütün hesab sahiblərindən xidmətdən istifadəni davam etdirməzdən əvvəl yenilənmiş versiyanı qəbul etmələri tələb olunur. Qonaqlar hər bildiriş zamanı qüvvədə olan versiyanı qəbul edirlər.'],
    ],
  },
  tr: {
    title: 'Gizlilik Politikası',
    effective: 'Yürürlük tarihi: 1 Ekim 2026',
    intro: 'Bu Gizlilik Politikası, Stray’s Call web uygulaması ve ilgili hizmetler kapsamında kişisel verilerin nasıl işlendiğini açıklamaktadır.',
    sections: [
      ['1. Veri Sorumlusu',
        'Bu Politikada açıklanan kişisel verilerin işlenmesinden sorumlu veri sorumlusu, gerçek kişi Fikrat Mutallimov’dur (“Veri Sorumlusu”, “biz”). Veri Sorumlusu ile yalnızca e-posta yoluyla, hello@strayscall.com adresi üzerinden iletişime geçilebilir.'],
      ['2. İşlenen Kişisel Veriler ve İşleme Amaçları', {
        lead: 'Aşağıdaki kişisel veri kategorileri işlenmektedir:',
        items: [
          'Hesap verileri: e-posta adresi ve şifre; kliniklerin ve kurtarıcıların muhatap oldukları kişiyi tanıyabilmesi için ad, soyad ve isteğe bağlı olarak telefon numarası; ad ve soyaddan oluşturulan görünen ad; seçilen dil. Google ile giriş yapılması hâlinde Google’dan ad, e-posta adresi ve profil fotoğrafı alınır.',
          'Uyarı ayarları: yakındaki vakalara ilişkin uyarı almayı seçmeniz hâlinde belirlediğiniz bölge ve yarıçap.',
          'Vaka bildirimi verileri: fotoğraflar, açıklama, hayvanın durumu ve aciliyeti, haritada işaretlenen tam konum, isteğe bağlı yer tarifi ve bu konumdan belirlenen sokak adresi; misafir bildirimlerinde isteğe bağlı olarak belirtilen ad.',
          'Kurtarma verileri: vakadaki rolünüz ve yalnızca bir hayvanı kliniğe taşıdığınız süre boyunca, yaklaşık 45 saniyelik aralıklarla cihazınızın konumu.',
          'Vaka sohbetlerinde ve kliniklerle özel mesajlarda gönderdiğiniz mesajların içeriği.',
          'Yaptığınız değerlendirmeler, engellemeler ve şikayetler.',
          'Size gönderilen bildirimlerin kopyaları ve anlık bildirimleri etkinleştirmeniz hâlinde cihazınızın teknik adresi.',
          'Rıza kayıtları: 18 yaşında veya daha büyük olduğunuzu onayladığınız ve Kullanım Şartları ile bu Politikayı kabul ettiğiniz tarih ve sürüm.',
          'Klinikler için ayrıca: klinik bilgileri, yöneticinin özel iletişim bilgileri ve doğrulama belgeleri.',
          'Teknik veriler: cihazınız için bir oturum kimliği (misafirler dahil), otomatik bot tespiti (Cloudflare Turnstile) amacıyla işlenen veriler ve hata raporları (Sentry).',
        ],
        outro: 'Kişisel veriler yalnızca kurtarma hizmetinin yürütülmesi amacıyla işlenir: vaka bildirimlerinin yayımlanması, yakındaki gönüllülerin uyarılması, kurtarmaların ve kliniklerin koordinasyonu, platform güvenliğinin sağlanması (bot tespiti, spam sınırları ve moderasyon) ve hesabınıza hizmet sunulması.',
      }],
      ['3. İşlemenin Hukuki Sebepleri',
        'Kişisel veriler, açık rızanıza ve hizmetin yürütülmesi ile güvenliğinin sağlanması için zorunlu olması hukuki sebeplerine dayanılarak işlenir. Rıza şu şekilde verilir: hesap oluşturulurken «18 yaşında veya daha büyüğüm» ve «Kullanım Şartları ve Gizlilik politikası’nı kabul ediyorum» zorunlu kutularının işaretlenmesiyle (tarih ve sürümle birlikte kaydedilir); misafir bildirimlerinde her bildirimde aynı kutuların işaretlenmesiyle (bildirimle birlikte kaydedilir); taşıma sırasındaki konum verileri için taşımanın başlatılmasıyla; anlık bildirimler için bunların etkinleştirilmesiyle. Hizmetin yürütülmesi ve güvenliğinin sağlanması için zorunlu olan işleme faaliyetleri; bot tespiti, spam sınırları, moderasyon ve hesap silindikten sonra kurtarma geçmişinin anonim hâle getirilmiş olarak saklanmasıdır.'],
      ['4. Kamuya Açık Bilgiler',
        'Kamuya açık bilgiler, hesabı olmayanlar dahil herkes tarafından görüntülenebilir. Bir vakaya ilişkin şu bilgiler kamuya açıktır: hayvan, açıklama, durum, aciliyet, tam konum ve sokak adresi, yer tarifi, vaka durumu ve ilgili zamanlar, belirtilmişse misafirin adı, vakanın zaman çizelgesi, vaka sohbeti ile hayvanı bildiren, kurtaran ve tedavi eden hesaplar. Bir vakanın fotoğrafları uygulamanın tüm kullanıcıları tarafından görüntülenebilir. Ayrıca şu bilgiler de kamuya açıktır: görünen adınız, profil fotoğrafınız, rolünüz, katılım tarihiniz, yardım edilen hayvan sayısı ve ortak kuruluşunuz; değerlendirmeyi yapan kişi belirtilerek klinik değerlendirmeleri; onaylı kliniklerin kamuya açık bilgileri. Şu bilgiler kamuya açık değildir: bir bildirimin hangi cihazdan veya misafir oturumundan gönderildiği; rıza kayıtları; moderatörler tarafından gizlenen vakalar; kurtarıcının canlı konumu — bu bilgiye yalnızca ilgili vakanın katılımcıları (bildiren, kurtarıcı ve klinik) ile yöneticiler erişebilir.'],
      ['5. Kişisel Verilere Erişim ve Alıcılar',
        'Özel mesajlara yalnızca yazışmanın iki tarafı ve yöneticiler erişebilir. E-posta adresinize, adınıza, soyadınıza ve telefon numaranıza, bölge ve uyarı ayarlarınıza, dilinize, bildirimlerinize, engellenenler listenize, gönderdiğiniz şikayetlere ve rıza kayıtlarınıza yalnızca siz ve yöneticiler erişebilir. Yöneticiler tüm kullanıcıların e-posta adreslerine, tüm özel mesajlara, şikayetlere, gizlenen içeriklere, kliniklerin doğrulama belgelerine ve yönetici iletişim bilgilerine erişebilir ve bu erişimi yalnızca şikayetlerin incelenmesi, kliniklerin onaylanması ve teknik sorunların giderilmesi amacıyla kullanır. Veri Sorumlusu, veritabanı işletmecisi sıfatıyla saklanan tüm verilere teknik olarak erişebilir. Kişisel verilerin alıcıları, 6. bölümde belirtilen hizmet sağlayıcılardır.'],
      ['6. Saklama Yeri ve Yurt Dışına Aktarım',
        'Veritabanı, dosyalar ve kimlik doğrulama hizmeti, Azerbaycan Cumhuriyeti dışında, Avrupa Birliği’nde (Paris, Fransa) Supabase tarafından barındırılmaktadır. Uygulamanın dosyaları Vercel’in küresel ağı üzerinden sunulur; Vercel istek kayıtlarını güvenlik amacıyla kısa bir süre saklar. Harita, yer arama ve sokak adresi belirleme hizmetleri Google, bot tespiti ise Cloudflare tarafından sağlanır. Hata raporları Sentry’ye aktarılır ve Sentry’nin standart saklama süresi boyunca saklanır. Anlık bildirimler tarayıcınızın bildirim hizmeti aracılığıyla iletilir. Kişisel veriler Avrupa Birliği’nde (Fransa) saklanır ve yukarıda belirtilen sağlayıcılar tarafından çeşitli ülkelerde işlenir. Stray’s Call’u kullanarak kişisel verilerinizin bu şekilde yurt dışına aktarılmasına rıza göstermiş olursunuz.'],
      ['7. Saklama Süreleri',
        'Kişisel veriler aşağıdaki süreler boyunca saklanır: hesap ve profil verileri — hesap silinene kadar; vaka bildirimleri ve zaman çizelgeleri — kurtarma kaydı olarak saklanır, kimse tarafından üstlenilmeyen açık vakalar ise 24 saat sonra kapatılır ve silinmez; vaka sohbetleri — vaka çözüldükten veya kapatıldıktan 90 gün sonra silinir, ancak moderatörlerce incelenen bir mesaj inceleme tamamlanana kadar saklanır; fotoğraflar — şu anda vakayla birlikte saklanmaktadır, fotoğrafların otomatik olarak silinmesi uygulamaya konulduğunda saklama süresi bu Politikaya eklenecektir; taşıma sırasındaki canlı konum — hayvan teslim edildiğinde, kurtarmadan vazgeçildiğinde veya 75 dakika boyunca ilerleme olmaması nedeniyle kurtarma otomatik olarak yeniden açıldığında silinir; özel mesajlar — taraflardan biri hesabını silene kadar, bu durumda yazışmanın tamamı silinir; bildirimler — 90 gün; misafir oturumları — açık bir bildirim bulunmadığı takdirde 30 gün sonra silinir, tamamlanmış bildirimler ise oturumla ilişkilendirilmeksizin saklanır; kliniklerin doğrulama belgeleri — kliniğin hesabı var olduğu sürece; anlık bildirim cihaz adresleri — anlık bildirimler kapatılana, cihaz bildirim almayı bırakana veya hesap silinene kadar. Cihazınızda tutulan veriler (oturum, ayarlar ve gönderilmemiş çevrimdışı bildirimler) gönderilene veya tarayıcı verileri temizlenene kadar tarayıcınızda kalır; önbelleğe alınan fotoğraflar en fazla 7 gün saklanır.'],
      ['8. İlgili Kişinin Hakları',
        'İlgili kişi olarak kişisel verilerinize erişme ve bunların bir kopyasını alma hakkına sahipsiniz: Ayarlar → Veri ve hesap → Verilerimi dışa aktar. Verileriniz Ayarlar → Kişisel bilgiler bölümünden düzeltilebilir; uyarı, bölge ve dil ayarları Ayarlar bölümünden değiştirilebilir. Hesabınızı Ayarlar → Veri ve hesap → Hesabımı sil yoluyla silebilirsiniz. Hesabın silinmesi; giriş bilgilerinizi ve e-posta adresinizi, profilinizi, uyarı ayarlarınızı, bildirimlerinizi, anlık bildirim cihazlarınızı, engellenenler listenizi, gönderdiğiniz şikayetleri, «hayvan burada değil» işaretlerinizi, takip ettiğiniz vakaları, yaptığınız klinik değerlendirmelerini, taraf olduğunuz tüm özel yazışmaları (her iki taraf için) ve klinikler bakımından kliniği ve doğrulama belgelerini kalıcı olarak siler. Vaka sohbetlerinde gönderdiğiniz mesajlar vakada kalır ve «Silinmiş hesap» olarak gösterilir. Oluşturduğunuz veya kurtardığınız vakalar, sizinle ilişkilendirilmeksizin kurtarma geçmişi olarak saklanır. Katıldığınız bir kurtarma devam ediyorsa vaka diğer kurtarıcılara yeniden açılır; kliniğiniz bir hayvan bekliyorsa kurtarıcıdan başka bir klinik seçmesi istenir. Rızanızı hesabınızı silerek, konum verileri veya anlık bildirimler bakımından ise taşımayı durdurarak ya da anlık bildirimleri kapatarak geri alabilirsiniz. Diğer talepler hello@strayscall.com adresine iletilebilir. Talepler mümkün olan en kısa sürede ve mevzuatta öngörülen süreler içinde yanıtlanacaktır. Ayrıca ülkenizdeki veri koruma otoritesine şikâyette bulunma hakkına sahipsiniz.'],
      ['9. Yaş Sınırı',
        'Stray’s Call yalnızca 18 yaşını doldurmuş kişilere yöneliktir. Her kullanıcı, hesap oluşturmadan veya misafir olarak bildirim göndermeden önce bu şartı karşıladığını onaylar.'],
      ['10. Fotoğraflar ve Konum Verileri',
        'Fotoğraflar yüklenmeden önce cihazınızda yeniden boyutlandırılır ve yeniden kodlanır; bu işlem GPS konumu gibi gömülü meta verileri kaldırır. Bu işlemin gerçekleştirilemediği durumlarda fotoğraf yüklenmez. Kliniklerin doğrulama belgeleri orijinal hâliyle yüklenir ve bunlara yalnızca ilgili klinik ile yöneticiler erişebilir. Konum verileri yalnızca şu amaçlarla kullanılır: bir bildirimde işaretlenen konum (kamuya açık); uyarılar için seçilen bölge (kamuya açık değil); bir hayvanın taşınması sırasında cihazınızın konumu (yalnızca ilgili vakanın katılımcıları ve yöneticiler erişebilir ve taşıma sona erdiğinde silinir); cihazınızda haritanın ortalanması ve mesafelerin gösterilmesi (saklanmaz). Sokak adresinin belirlenmesi amacıyla bildirim konumları Google’a aktarılır.'],
      ['11. Taahhütlerimiz',
        'Kişisel verileri satmayız, hedefli reklam göstermeyiz ve ödeme işlemi yürütmeyiz. Bir klinik vaka sohbetinde banka bilgilerini paylaştığında, her türlü ödeme Stray’s Call dışında, doğrudan sizinle klinik arasında gerçekleştirilir.'],
      ['12. Politikadaki Değişiklikler',
        'Kullanım Şartlarında veya bu Politikada önemli değişiklikler yapılması hâlinde sürüm güncellenir ve tüm hesap sahiplerinden hizmeti kullanmaya devam etmeden önce güncellenmiş sürümü kabul etmeleri istenir. Misafirler her bildirimde yürürlükteki sürümü kabul eder.'],
    ],
  },
};

export function PrivacyPage() {
  const content = PRIVACY[getLocale()] ?? PRIVACY.en;

  return (
    <div className="page doc-page">
      <ScreenHeader title={content.title} fallback="/settings" />
      <p className="doc-updated">{content.effective}</p>
      <p className="doc-intro">{content.intro}</p>
      {content.sections.map(([heading, body]) => (
        <div key={heading} className="doc-section">
          <h2>{heading}</h2>
          {typeof body === 'string' ? (
            <p>{body}</p>
          ) : (
            <>
              <p>{body.lead}</p>
              <ul>
                {body.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {body.outro && <p>{body.outro}</p>}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
