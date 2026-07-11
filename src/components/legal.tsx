/**
 * Legal & trust pages — Terms, Safety Guide, Community Guidelines, About,
 * Contact, FAQ. Trilingual, same honest plain-language pattern as the
 * Privacy Policy. Long-form copy lives here (not the i18n dict, which is
 * for short UI strings) keyed by locale; the page chrome uses t().
 *
 * Also exports the app-wide ErrorBoundary and NotFound page.
 */
import { Component, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getLocale, t, type LocaleCode } from '../i18n';
import { IconBack } from './Icons';
import { captureBoundaryError } from '../lib/monitoring';

type Section = [heading: string, body: string | string[]];
type Doc = { title: string; updated?: string; intro?: string; sections: Section[] };
type LocalizedDoc = Record<LocaleCode, Doc>;

function DocView({ doc }: { doc: LocalizedDoc }) {
  const navigate = useNavigate();
  const d = doc[getLocale()] ?? doc.en;
  return (
    <div className="page doc-page">
      <button className="back-btn" onClick={() => navigate(-1)}>
        <IconBack size={18} /> {t('common.back')}
      </button>
      <h1 className="page-title">{d.title}</h1>
      {d.updated && <p className="doc-updated">{d.updated}</p>}
      {d.intro && <p>{d.intro}</p>}
      {d.sections.map(([heading, body], i) => (
        <div key={i}>
          <h2>{heading}</h2>
          {Array.isArray(body) ? (
            <ul>{body.map((li, j) => <li key={j}>{li}</li>)}</ul>
          ) : (
            <p>{body}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ===========================================================================
// TERMS OF SERVICE
// ===========================================================================
const TERMS: LocalizedDoc = {
  en: {
    title: 'Terms of Service',
    updated: 'Plain-language summary — last updated at launch.',
    intro:
      'PawLine is a free tool that helps people find and coordinate help for injured street animals. By using it, you agree to these terms. We tried to keep them honest and readable rather than full of legal traps.',
    sections: [
      ['What PawLine is — and isn’t',
        'PawLine is a coordination platform only. It is NOT a rescue service, a veterinary service, an emergency responder, or an animal-control authority. We connect people who want to help; we don’t employ rescuers or vets, and we can’t guarantee that any report gets a response.'],
      ['Who can use it',
        'You must be old enough to enter a binding agreement where you live. Report responsibly, act lawfully, and treat animals and people humanely.'],
      ['Your responsibilities',
        [
          'Report honestly — no fake, duplicate, or malicious reports.',
          'If you choose to rescue an animal, you do so at your own risk (see the Safety Guide).',
          'Money for an animal’s treatment is arranged directly between you and a vet clinic — never through PawLine. We never touch, hold, or process payments.',
          'Don’t use PawLine to harass, scam, defraud, impersonate, or endanger anyone.',
        ]],
      ['Vets and clinics',
        'Clinics are independent businesses. We verify basic identity before a clinic appears publicly, but we don’t supervise their medical care, pricing, or conduct. Choose and pay a clinic at your own discretion.'],
      ['Content you post',
        'You keep ownership of your photos and messages, but grant PawLine permission to display them within the app for coordination. Don’t post anything illegal, or anything you don’t have the right to share.'],
      ['Moderation and bans',
        'We may hide content or ban accounts that break these terms or the Community Guidelines — especially scams and harassment. Serious or repeated violations can be permanent.'],
      ['No warranty; limits',
        'PawLine is provided “as is,” with no guarantee it will be available, accurate, or that help will arrive. To the fullest extent the law allows, we aren’t liable for injuries, losses, or damages arising from using the app, coordinating a rescue, or dealing with an animal or another user.'],
      ['Changes',
        'We may update these terms as PawLine grows. Material changes will be surfaced in the app. Continuing to use PawLine means you accept the current terms.'],
      ['Contact',
        'Questions about these terms? See the Contact page.'],
    ],
  },
  az: {
    title: 'İstifadə Şərtləri',
    updated: 'Sadə dildə xülasə — buraxılışda yeniləndi.',
    intro:
      'PawLine yaralı küçə heyvanlarına kömək tapmağa və əlaqələndirməyə kömək edən pulsuz vasitədir. Ondan istifadə etməklə bu şərtləri qəbul edirsiniz.',
    sections: [
      ['PawLine nədir — və nə deyil',
        'PawLine yalnız əlaqələndirmə platformasıdır. O, xilasetmə, baytarlıq, təcili yardım xidməti və ya heyvanlara nəzarət orqanı DEYİL. Biz kömək etmək istəyən insanları birləşdiririk; xilasedici və ya baytar işə götürmürük və hər bildirişə cavab veriləcəyinə zəmanət verə bilmərik.'],
      ['Kim istifadə edə bilər',
        'Yaşadığınız yerdə bağlayıcı razılaşma bağlamaq üçün kifayət qədər yaşlı olmalısınız. Məsuliyyətlə bildirin, qanuna uyğun hərəkət edin.'],
      ['Sizin məsuliyyətiniz',
        [
          'Dürüst bildirin — saxta, təkrar və ya zərərli bildirişlər yoxdur.',
          'Heyvanı xilas etməyi seçsəniz, bunu öz riskinizlə edirsiniz (Təhlükəsizlik Bələdçisinə baxın).',
          'Müalicə üçün pul birbaşa sizinlə klinika arasında razılaşdırılır — heç vaxt PawLine vasitəsilə yox.',
          'PawLine-dan təqib, fırıldaq, saxtakarlıq və ya təhlükə yaratmaq üçün istifadə etməyin.',
        ]],
      ['Baytarlar və klinikalar',
        'Klinikalar müstəqil bizneslərdir. Klinika açıq görünməzdən əvvəl əsas kimliyi yoxlayırıq, lakin onların tibbi qulluğuna və ya qiymətlərinə nəzarət etmirik.'],
      ['Paylaşdığınız məzmun',
        'Fotolarınızın və mesajlarınızın sahibliyi sizdə qalır, lakin PawLine-a onları tətbiq daxilində göstərmək icazəsi verirsiniz. Qanunsuz heç nə paylaşmayın.'],
      ['Moderasiya və bloklar',
        'Bu şərtləri və ya İcma Qaydalarını pozan məzmunu gizlədə və ya hesabları bloklaya bilərik — xüsusən fırıldaq və təqib.'],
      ['Zəmanət yoxdur; məhdudiyyətlər',
        'PawLine “olduğu kimi” təqdim olunur, onun əlçatan və ya dəqiq olacağına zəmanət yoxdur. Qanunun icazə verdiyi dərəcədə, tətbiqdən istifadədən yaranan zədə və ya itkilərə görə məsuliyyət daşımırıq.'],
      ['Dəyişikliklər',
        'PawLine böyüdükcə bu şərtləri yeniləyə bilərik. Əhəmiyyətli dəyişikliklər tətbiqdə göstəriləcək.'],
      ['Əlaqə',
        'Suallarınız var? Əlaqə səhifəsinə baxın.'],
    ],
  },
  tr: {
    title: 'Kullanım Şartları',
    updated: 'Sade dilde özet — lansmanda güncellendi.',
    intro:
      'PawLine, yaralı sokak hayvanlarına yardım bulmaya ve koordine etmeye yardımcı olan ücretsiz bir araçtır. Kullanarak bu şartları kabul edersiniz.',
    sections: [
      ['PawLine nedir — ve ne değildir',
        'PawLine yalnızca bir koordinasyon platformudur. Bir kurtarma, veterinerlik, acil müdahale hizmeti veya hayvan kontrol otoritesi DEĞİLDİR. Yardım etmek isteyen insanları bağlarız; kurtarıcı veya veteriner çalıştırmayız ve her bildirimin yanıtlanacağını garanti edemeyiz.'],
      ['Kimler kullanabilir',
        'Yaşadığınız yerde bağlayıcı bir anlaşma yapacak yaşta olmalısınız. Sorumlu bildirin, yasalara uygun davranın.'],
      ['Sorumluluklarınız',
        [
          'Dürüst bildirin — sahte, mükerrer veya kötü niyetli bildirim yok.',
          'Bir hayvanı kurtarmayı seçerseniz, bunu kendi riskinizle yaparsınız (Güvenlik Kılavuzu’na bakın).',
          'Tedavi parası doğrudan sizinle klinik arasında ayarlanır — asla PawLine üzerinden değil.',
          'PawLine’ı taciz, dolandırıcılık, sahtekârlık veya tehlike için kullanmayın.',
        ]],
      ['Veterinerler ve klinikler',
        'Klinikler bağımsız işletmelerdir. Bir klinik herkese açık görünmeden önce temel kimliği doğrularız, ancak tıbbi bakımlarını veya fiyatlandırmalarını denetlemeyiz.'],
      ['Paylaştığınız içerik',
        'Fotoğraflarınızın ve mesajlarınızın sahipliği sizde kalır, ancak PawLine’a bunları uygulama içinde gösterme izni verirsiniz. Yasa dışı hiçbir şey paylaşmayın.'],
      ['Moderasyon ve yasaklar',
        'Bu şartları veya Topluluk Kurallarını ihlal eden içeriği gizleyebilir veya hesapları yasaklayabiliriz — özellikle dolandırıcılık ve taciz.'],
      ['Garanti yok; sınırlar',
        'PawLine “olduğu gibi” sunulur, kullanılabilir veya doğru olacağına dair garanti yoktur. Yasaların izin verdiği ölçüde, uygulamayı kullanmaktan doğan yaralanma veya kayıplardan sorumlu değiliz.'],
      ['Değişiklikler',
        'PawLine büyüdükçe bu şartları güncelleyebiliriz. Önemli değişiklikler uygulamada gösterilecektir.'],
      ['İletişim',
        'Sorularınız mı var? İletişim sayfasına bakın.'],
    ],
  },
};

// ===========================================================================
// SAFETY GUIDE
// ===========================================================================
const SAFETY: LocalizedDoc = {
  en: {
    title: 'Safety Guide',
    intro:
      'Helping an injured animal is generous — and carries real physical risk. Please read this before your first rescue. PawLine is a coordination tool, not a rescue or veterinary service; your safety is your own responsibility.',
    sections: [
      ['The real risks',
        'A hurt or frightened animal doesn’t know you’re helping. Bites and scratches are common and can be serious. Some street animals carry diseases (including rabies in this region) or parasites. Roadsides and traffic are dangerous for you too.'],
      ['Before you approach',
        [
          'Move slowly and calmly. Don’t corner the animal or stare directly.',
          'Keep children and your own pets well back.',
          'Assess traffic and your own safety first — never step into a road.',
          'If the animal is aggressive, very large, or clearly dangerous, wait for someone experienced or a local organization.',
        ]],
      ['Handling',
        [
          'Use a towel or blanket to gently cover and lift; wear gloves if you have them.',
          'Support the body; avoid the injured area.',
          'A cardboard box or carrier is safer than your arms for transport.',
        ]],
      ['Protect yourself',
        'If you’re bitten or scratched, wash the wound immediately with soap and water and seek medical care — in this region, rabies risk means a bite is a medical matter, not something to shrug off.'],
      ['When NOT to intervene',
        'If it isn’t safe, it’s okay to stay back, keep the report open for someone equipped, and share the location. A second injured person doesn’t help the animal.'],
      ['This is your decision',
        'By accepting a rescue you accept these risks yourself. PawLine, its team, and partner organizations are not liable for injury or loss from handling an animal.'],
    ],
  },
  az: {
    title: 'Təhlükəsizlik Bələdçisi',
    intro:
      'Yaralı heyvana kömək etmək comərdlikdir — və real fiziki risk daşıyır. İlk xilasetmədən əvvəl bunu oxuyun. PawLine əlaqələndirmə vasitəsidir, xilasetmə xidməti deyil; təhlükəsizliyiniz öz məsuliyyətinizdir.',
    sections: [
      ['Real risklər',
        'Yaralı və ya qorxmuş heyvan kömək etdiyinizi bilmir. Dişləmə və cırmaqlar ciddi ola bilər. Bəzi küçə heyvanları xəstəlik (bu bölgədə quduzluq daxil) daşıyır. Yol və nəqliyyat sizin üçün də təhlükəlidir.'],
      ['Yaxınlaşmadan əvvəl',
        [
          'Yavaş və sakit hərəkət edin. Heyvanı küncə sıxışdırmayın.',
          'Uşaqları və ev heyvanlarınızı uzaq tutun.',
          'Əvvəlcə nəqliyyatı və təhlükəsizliyinizi qiymətləndirin — heç vaxt yola çıxmayın.',
          'Heyvan aqressiv və ya təhlükəlidirsə, təcrübəli birini gözləyin.',
        ]],
      ['Tutma',
        [
          'Yumşaq örtmək və qaldırmaq üçün dəsmal və ya ədyaldan istifadə edin; mümkünsə əlcək geyin.',
          'Bədəni dəstəkləyin; yaralı nahiyədən çəkinin.',
          'Karton qutu qollarınızdan daha təhlükəsizdir.',
        ]],
      ['Özünüzü qoruyun',
        'Dişlənsəniz və ya cırmaqlansanız, yaranı dərhal sabun və su ilə yuyun və tibbi yardım alın — bu bölgədə quduzluq riski var.'],
      ['Nə vaxt müdaxilə ETMƏMƏLİ',
        'Təhlükəsiz deyilsə, geri durmaq normaldır — bildirişi açıq saxlayın və yeri paylaşın.'],
      ['Bu sizin qərarınızdır',
        'Xilasetməni qəbul etməklə bu riskləri özünüz qəbul edirsiniz. PawLine məsuliyyət daşımır.'],
    ],
  },
  tr: {
    title: 'Güvenlik Kılavuzu',
    intro:
      'Yaralı bir hayvana yardım etmek cömertçedir — ve gerçek fiziksel risk taşır. İlk kurtarmanızdan önce bunu okuyun. PawLine bir koordinasyon aracıdır, kurtarma hizmeti değil; güvenliğiniz kendi sorumluluğunuzdadır.',
    sections: [
      ['Gerçek riskler',
        'Yaralı veya korkmuş bir hayvan yardım ettiğinizi bilmez. Isırık ve tırmıklar ciddi olabilir. Bazı sokak hayvanları hastalık (bu bölgede kuduz dahil) taşır. Trafik sizin için de tehlikelidir.'],
      ['Yaklaşmadan önce',
        [
          'Yavaş ve sakin hareket edin. Hayvanı köşeye sıkıştırmayın.',
          'Çocukları ve evcil hayvanlarınızı uzak tutun.',
          'Önce trafiği ve güvenliğinizi değerlendirin — asla yola çıkmayın.',
          'Hayvan saldırgan veya tehlikeliyse, deneyimli birini bekleyin.',
        ]],
      ['Taşıma',
        [
          'Nazikçe örtmek ve kaldırmak için havlu veya battaniye kullanın; varsa eldiven giyin.',
          'Vücudu destekleyin; yaralı bölgeden kaçının.',
          'Karton kutu kollarınızdan daha güvenlidir.',
        ]],
      ['Kendinizi koruyun',
        'Isırılır veya tırmalanırsanız, yarayı hemen sabun ve suyla yıkayın ve tıbbi yardım alın — bu bölgede kuduz riski vardır.'],
      ['Ne zaman müdahale ETMEMELİ',
        'Güvenli değilse, geri durmak normaldir — bildirimi açık tutun ve konumu paylaşın.'],
      ['Bu sizin kararınız',
        'Bir kurtarmayı kabul ederek bu riskleri kendiniz kabul edersiniz. PawLine sorumlu değildir.'],
    ],
  },
};

// ===========================================================================
// COMMUNITY GUIDELINES
// ===========================================================================
const CONDUCT: LocalizedDoc = {
  en: {
    title: 'Community Guidelines',
    intro: 'PawLine only works if people trust each other. These rules keep it safe. Breaking them can get your content hidden or your account banned.',
    sections: [
      ['Be kind and honest', 'Treat everyone with respect. No harassment, threats, hate speech, or abuse — toward reporters, rescuers, vets, or anyone.'],
      ['No fake or spam reports', 'Report real animals in real need. Fake, duplicate-on-purpose, or joke reports take help away from animals that need it.'],
      ['Fundraising rules — read this',
        [
          'Money for treatment goes DIRECTLY to a vet clinic, never through PawLine.',
          'Only a case’s confirmed clinic should share bank details for that animal’s treatment.',
          'Anyone else posting “send money to my account” for a case is almost certainly a scam — report them with the ⚑ button.',
          'Never send money to an individual claiming to be a rescuer or vet without verifying the clinic independently.',
        ]],
      ['No impersonation', 'Don’t pretend to be a vet, clinic, official, or another person. Verified clinics that change their identity are re-checked automatically.'],
      ['What gets you banned', 'Scams, harassment, impersonation, repeated fake reports, or endangering people or animals. Serious cases are permanent and may be reported to authorities.'],
      ['Reporting problems', 'Use the ⚑ report button on any case or message. Admins review every report.'],
    ],
  },
  az: {
    title: 'İcma Qaydaları',
    intro: 'PawLine yalnız insanlar bir-birinə güvəndikdə işləyir. Bu qaydalar onu təhlükəsiz saxlayır. Onları pozmaq məzmununuzun gizlədilməsinə və ya hesabınızın bloklanmasına səbəb ola bilər.',
    sections: [
      ['Mehriban və dürüst olun', 'Hər kəsə hörmətlə yanaşın. Təqib, hədə, nifrət nitqi və ya sui-istifadə yoxdur.'],
      ['Saxta və ya spam bildirişlər yoxdur', 'Real ehtiyacı olan real heyvanları bildirin. Saxta və ya zarafat bildirişlər kömək lazım olan heyvanlardan yardımı alır.'],
      ['Vəsait toplama qaydaları — bunu oxuyun',
        [
          'Müalicə üçün pul BİRBAŞA klinikaya gedir, heç vaxt PawLine vasitəsilə yox.',
          'Yalnız hadisənin təsdiqlənmiş klinikası bank rekvizitlərini paylaşmalıdır.',
          'Hadisə üçün “mənim hesabıma pul göndər” yazan hər kəs demək olar ki, fırıldaqçıdır — ⚑ düyməsi ilə şikayət edin.',
          'Klinikanı müstəqil yoxlamadan heç vaxt fərdə pul göndərməyin.',
        ]],
      ['Saxtakarlıq yoxdur', 'Baytar, klinika, rəsmi şəxs və ya başqası kimi özünüzü göstərməyin. Kimliyini dəyişən klinikalar avtomatik yenidən yoxlanılır.'],
      ['Nə üçün bloklanırsınız', 'Fırıldaq, təqib, saxtakarlıq, təkrar saxta bildirişlər və ya insanları təhlükəyə atmaq.'],
      ['Problemləri bildirmək', 'İstənilən hadisə və ya mesajda ⚑ düyməsindən istifadə edin. Adminlər hər şikayəti nəzərdən keçirir.'],
    ],
  },
  tr: {
    title: 'Topluluk Kuralları',
    intro: 'PawLine yalnızca insanlar birbirine güvendiğinde çalışır. Bu kurallar onu güvende tutar. Bunları ihlal etmek içeriğinizin gizlenmesine veya hesabınızın yasaklanmasına yol açabilir.',
    sections: [
      ['Nazik ve dürüst olun', 'Herkese saygıyla davranın. Taciz, tehdit, nefret söylemi veya istismar yok.'],
      ['Sahte veya spam bildirim yok', 'Gerçekten ihtiyacı olan gerçek hayvanları bildirin. Sahte veya şaka bildirimler yardımı gerçek hayvanlardan alır.'],
      ['Bağış toplama kuralları — bunu okuyun',
        [
          'Tedavi parası DOĞRUDAN kliniğe gider, asla PawLine üzerinden değil.',
          'Yalnızca vakanın onaylı kliniği banka bilgilerini paylaşmalıdır.',
          'Bir vaka için “hesabıma para gönder” diyen herkes neredeyse kesinlikle dolandırıcıdır — ⚑ ile bildirin.',
          'Kliniği bağımsız olarak doğrulamadan asla bir kişiye para göndermeyin.',
        ]],
      ['Kimliğe bürünme yok', 'Bir veteriner, klinik, yetkili veya başka biri gibi davranmayın. Kimliğini değiştiren klinikler otomatik olarak yeniden kontrol edilir.'],
      ['Sizi ne yasaklatır', 'Dolandırıcılık, taciz, kimliğe bürünme, tekrarlanan sahte bildirimler veya insanları tehlikeye atmak.'],
      ['Sorunları bildirme', 'Herhangi bir vaka veya mesajda ⚑ düğmesini kullanın. Yöneticiler her bildirimi inceler.'],
    ],
  },
};

// ===========================================================================
// ABOUT · CONTACT · FAQ
// ===========================================================================
const ABOUT: LocalizedDoc = {
  en: { title: 'About PawLine', sections: [
    ['Our mission', 'PawLine exists so that no injured street animal dies simply because the people willing to help couldn’t find each other in time. We turn a scattered network of kind strangers, rescuers, and vet clinics into one fast, trustworthy chain: report → rescuer → verified vet.'],
    ['How it started', 'It began in Baku, where street-animal rescue already happens every day — but scattered across social media, drowning in duplicates, with no way to know if anyone actually went. PawLine gives that goodwill a structure.'],
    ['Not-for-profit in spirit', 'We take no cut of anything. Money for treatment flows directly between people and clinics. PawLine sustains itself through sponsorships and partnerships, never by charging the vulnerable or selling data.'],
    ['Partners', 'We work with local animal-welfare organizations and clinics rather than competing with them. If your organization wants to join, see Contact.'],
  ]},
  az: { title: 'PawLine haqqında', sections: [
    ['Missiyamız', 'PawLine ona görə mövcuddur ki, heç bir yaralı küçə heyvanı kömək etmək istəyənlər vaxtında bir-birini tapa bilmədiyi üçün ölməsin. Biz mehriban qəriblərin, xilasedicilərin və klinikaların dağınıq şəbəkəsini bir sürətli zəncirə çeviririk: bildiriş → xilasedici → təsdiqlənmiş baytar.'],
    ['Necə başladı', 'Bu, Bakıda başladı — küçə heyvanlarının xilası hər gün baş verir, lakin sosial mediada dağınıq şəkildə. PawLine bu xoş niyyətə struktur verir.'],
    ['Ruhən qeyri-kommersiya', 'Biz heç nədən pay götürmürük. Müalicə pulu birbaşa insanlar və klinikalar arasında axır. PawLine sponsorluq və tərəfdaşlıqlarla dolanır.'],
    ['Tərəfdaşlar', 'Yerli heyvan rifahı təşkilatları ilə rəqabət deyil, əməkdaşlıq edirik. Qoşulmaq istəyirsinizsə, Əlaqə səhifəsinə baxın.'],
  ]},
  tr: { title: 'PawLine Hakkında', sections: [
    ['Misyonumuz', 'PawLine, yardım etmeye istekli insanlar birbirini zamanında bulamadığı için hiçbir yaralı sokak hayvanı ölmesin diye var. Nazik yabancıların, kurtarıcıların ve kliniklerin dağınık ağını tek bir hızlı zincire dönüştürüyoruz: bildirim → kurtarıcı → onaylı veteriner.'],
    ['Nasıl başladı', 'Bakü’de başladı — sokak hayvanı kurtarma her gün oluyor ama sosyal medyada dağınık halde. PawLine bu iyi niyete bir yapı kazandırıyor.'],
    ['Ruhen kâr amacı gütmeyen', 'Hiçbir şeyden pay almıyoruz. Tedavi parası doğrudan insanlar ve klinikler arasında akar. PawLine sponsorluk ve ortaklıklarla ayakta durur.'],
    ['Ortaklar', 'Yerel hayvan refahı kuruluşlarıyla rekabet etmek yerine iş birliği yapıyoruz. Katılmak isterseniz İletişim sayfasına bakın.'],
  ]},
};

const CONTACT: LocalizedDoc = {
  en: { title: 'Contact Us', sections: [
    ['Get in touch', 'For questions, problems, partnership requests, or to report something urgent that the in-app tools can’t handle, email us:'],
    ['Email', 'hello@pawline.app  (replace with your real address before launch)'],
    ['Partner organizations & clinics', 'If you run an animal-welfare organization or a vet clinic and want to join PawLine, we’d love to hear from you — email the address above with a short introduction.'],
    ['Urgent safety issues', 'PawLine is not an emergency service. For an animal in immediate danger, also contact a local rescue organization or the relevant authorities directly.'],
  ]},
  az: { title: 'Bizimlə əlaqə', sections: [
    ['Əlaqə saxlayın', 'Suallar, problemlər, tərəfdaşlıq müraciətləri və ya təcili bir şey üçün bizə e-poçt göndərin:'],
    ['E-poçt', 'hello@pawline.app  (buraxılışdan əvvəl real ünvanla əvəz edin)'],
    ['Tərəfdaş təşkilatlar və klinikalar', 'Heyvan rifahı təşkilatı və ya klinika işlədirsinizsə və qoşulmaq istəyirsinizsə, yuxarıdakı ünvana yazın.'],
    ['Təcili təhlükəsizlik məsələləri', 'PawLine təcili yardım xidməti deyil. Təhlükədə olan heyvan üçün yerli təşkilatla və ya orqanlarla birbaşa əlaqə saxlayın.'],
  ]},
  tr: { title: 'Bize Ulaşın', sections: [
    ['İletişime geçin', 'Sorular, sorunlar, ortaklık talepleri veya acil bir şey için bize e-posta gönderin:'],
    ['E-posta', 'hello@pawline.app  (lansmandan önce gerçek adresle değiştirin)'],
    ['Ortak kuruluşlar ve klinikler', 'Bir hayvan refahı kuruluşu veya klinik işletiyorsanız ve katılmak istiyorsanız, yukarıdaki adrese yazın.'],
    ['Acil güvenlik sorunları', 'PawLine bir acil durum hizmeti değildir. Tehlikedeki bir hayvan için yerel bir kuruluşla veya yetkililerle doğrudan iletişime geçin.'],
  ]},
};

const FAQ: LocalizedDoc = {
  en: { title: 'FAQ', sections: [
    ['Do I need an account to report?', 'No. Anyone can report an animal with just a photo and a location. An account lets you follow the case, rescue animals, and chat.'],
    ['Does PawLine take money?', 'Never. We don’t process payments. Money for treatment is arranged directly between you and a vet clinic.'],
    ['Someone asked me to send money — is that safe?', 'Be very careful. Only a case’s confirmed clinic should share bank details. Anyone else is likely a scam — report them with ⚑.'],
    ['What if two people report the same animal?', 'The app flags likely duplicates for review, but never blocks a report — a real second animal always gets through.'],
    ['What happens if nobody helps?', 'After 30 minutes we alert more people nearby; after 24 hours an unclaimed case is archived so the map stays current.'],
    ['Is my location private?', 'Your exact home area is never public. Case locations are public because rescuers need them. See the Privacy Policy.'],
    ['How do I delete my account or data?', 'Settings → Account. You can export all your data or delete your account there.'],
  ]},
  az: { title: 'Tez-tez verilən suallar', sections: [
    ['Bildirmək üçün hesab lazımdır?', 'Xeyr. İstənilən şəxs yalnız foto və yerlə heyvan bildirə bilər. Hesab hadisəni izləməyə, xilas etməyə və söhbətə imkan verir.'],
    ['PawLine pul götürür?', 'Heç vaxt. Ödənişləri emal etmirik. Müalicə pulu birbaşa sizinlə klinika arasında razılaşdırılır.'],
    ['Kimsə pul göndərməyi xahiş etdi — təhlükəsizdir?', 'Çox diqqətli olun. Yalnız təsdiqlənmiş klinika bank rekvizitlərini paylaşmalıdır. Başqası çox güman fırıldaqçıdır — ⚑ ilə şikayət edin.'],
    ['İki nəfər eyni heyvanı bildirsə?', 'Tətbiq mümkün təkrarları qeyd edir, lakin heç vaxt bildirişi bloklamır.'],
    ['Heç kim kömək etməsə nə olur?', '30 dəqiqədən sonra yaxınlıqdakı daha çox insanı xəbərdar edirik; 24 saatdan sonra sahibsiz hadisə arxivlənir.'],
    ['Yerim məxfidir?', 'Dəqiq ev əraziniz heç vaxt açıq deyil. Hadisə yerləri açıqdır, çünki xilasedicilərə lazımdır. Məxfilik Siyasətinə baxın.'],
    ['Hesabımı və ya məlumatlarımı necə silim?', 'Parametrlər → Hesab. Orada bütün məlumatlarınızı ixrac edə və ya hesabınızı silə bilərsiniz.'],
  ]},
  tr: { title: 'Sıkça Sorulan Sorular', sections: [
    ['Bildirmek için hesap gerekir mi?', 'Hayır. Herkes sadece bir fotoğraf ve konumla hayvan bildirebilir. Hesap; vakayı takip etmenizi, kurtarmanızı ve sohbet etmenizi sağlar.'],
    ['PawLine para alıyor mu?', 'Asla. Ödeme işlemiyoruz. Tedavi parası doğrudan sizinle klinik arasında ayarlanır.'],
    ['Biri para göndermemi istedi — güvenli mi?', 'Çok dikkatli olun. Yalnızca onaylı klinik banka bilgilerini paylaşmalıdır. Başkası büyük olasılıkla dolandırıcıdır — ⚑ ile bildirin.'],
    ['İki kişi aynı hayvanı bildirirse?', 'Uygulama olası mükerrerleri işaretler ama asla bir bildirimi engellemez.'],
    ['Kimse yardım etmezse ne olur?', '30 dakika sonra yakındaki daha fazla kişiyi uyarırız; 24 saat sonra sahipsiz vaka arşivlenir.'],
    ['Konumum gizli mi?', 'Tam ev bölgeniz asla herkese açık değildir. Vaka konumları herkese açıktır çünkü kurtarıcıların ihtiyacı vardır. Gizlilik Politikası’na bakın.'],
    ['Hesabımı veya verilerimi nasıl silerim?', 'Ayarlar → Hesap. Orada tüm verilerinizi dışa aktarabilir veya hesabınızı silebilirsiniz.'],
  ]},
};

export const TermsPage = () => <DocView doc={TERMS} />;
export const SafetyPage = () => <DocView doc={SAFETY} />;

// ===========================================================================
// First-rescue safety acknowledgment gate
// ---------------------------------------------------------------------------
// Shown ONCE, right before a user accepts their very first case — where the
// risk actually begins, not buried in a menu. localStorage is the fast gate;
// the server also records it durably (recordSafetyAck) so consent survives a
// cleared browser and can be shown to have happened.
// ===========================================================================
const ACK_KEY = 'pawline-safety-ack-v1';

export function hasAcceptedSafety(): boolean {
  try {
    return localStorage.getItem(ACK_KEY) === 'yes';
  } catch {
    return true; // storage blocked → don't trap the user in a loop
  }
}

export function SafetyAck({
  onAccept,
  onCancel,
}: {
  onAccept: () => void;
  onCancel: () => void;
}) {
  const doc = SAFETY[getLocale()] ?? SAFETY.en;
  const accept = () => {
    try {
      localStorage.setItem(ACK_KEY, 'yes');
    } catch {
      /* best effort */
    }
    onAccept();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={doc.title}>
      <div className="modal-sheet">
        <div className="modal-sheet__icon" aria-hidden="true">🛡️</div>
        <h2 className="modal-sheet__title">{doc.title}</h2>
        <p className="modal-sheet__intro">{t('safety.ackIntro')}</p>

        <ul className="safety-ack__list">
          {doc.sections.slice(0, 3).map(([heading]) => (
            <li key={heading}>{heading}</li>
          ))}
        </ul>

        <p className="modal-sheet__fineprint">{t('safety.ackFine')}</p>

        <button className="btn btn--primary" onClick={accept}>
          {t('safety.ackConfirm')}
        </button>
        <button className="link-btn" onClick={onCancel} style={{ marginTop: 8, width: '100%' }}>
          {t('common.cancel')}
        </button>

        <Link
          to="/safety"
          style={{ display: 'block', textAlign: 'center', marginTop: 12, fontSize: 13, fontWeight: 700, color: 'var(--ink-soft)' }}
        >
          {t('safety.readFull')}
        </Link>
      </div>
    </div>
  );
}
export const ConductPage = () => <DocView doc={CONDUCT} />;
export const AboutPage = () => <DocView doc={ABOUT} />;
export const ContactPage = () => <DocView doc={CONTACT} />;
export const FaqPage = () => <DocView doc={FAQ} />;

// ===========================================================================
// 404
// ===========================================================================
export function NotFoundPage() {
  return (
    <div className="page">
      <div className="fullscreen-msg">
        <div className="fullscreen-msg__icon" aria-hidden="true">🐾</div>
        <h1>{t('notfound.title')}</h1>
        <p>{t('notfound.body')}</p>
        <Link to="/" className="btn btn--primary" style={{ marginTop: 8 }}>
          {t('notfound.home')}
        </Link>
      </div>
    </div>
  );
}

// ===========================================================================
// Error boundary — catches uncaught render crashes app-wide
// ===========================================================================
export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    // Boundary-caught render errors never hit window.onerror, so Sentry
    // must be told explicitly — otherwise the crashes users actually SEE
    // are the ones monitoring never records.
    captureBoundaryError(error);
    console.error('PawLine uncaught error:', error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="fullscreen-msg" style={{ minHeight: '100dvh' }}>
          <div className="fullscreen-msg__icon" aria-hidden="true">🐾</div>
          <h1>{t('error.title')}</h1>
          <p>{t('error.body')}</p>
          <button
            className="btn btn--primary"
            style={{ marginTop: 8 }}
            onClick={() => window.location.assign('/')}
          >
            {t('error.reload')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
