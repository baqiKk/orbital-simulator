// All user-visible text lives in this one dictionary; no strings in code.
// _(key, params) fills {name} placeholders. Values that are arrays/objects (glossary, apsis names)
// are structured data read directly from DICT. HTML markup is allowed only where noted in the key's comment.
// To add a language: add I18N.<code> with the same keys and change LANG.
const I18N = {
  tr: {
    'meta.lang': 'tr',
    'meta.locale': 'tr-TR',
    'meta.title': 'Yörünge Transfer Simülatörü',
    'meta.description': 'Tarayıcıda çalışan yörünge transfer simülatörü: Dünya–Ay serbest dönüş, Dünya–Mars Hohmann transferi ve daha fazlası.',

    // ---- static page (index.html, via data-i18n* attributes) ----
    'ui.aria.params': 'Parametreler',
    'ui.eyebrow': 'Kısıtlı N-cisim · düzlemsel',
    'ui.title': 'Yörünge Transfer Simülatörü',
    'ui.lede': 'Gök cisimlerini ve yanmayı seç; araç yolunu tarayıcıda hesaplar ve oynatır.',
    'ui.sec.scenario': 'Senaryo',
    'ui.scenario': 'Hazır görev',
    'ui.sec.bodies': 'Gök cisimleri',
    'ui.addBody': '+ Cisim ekle',
    'ui.sec.mission': 'Görev',
    'ui.missionType': 'Görev tipi',
    'ui.mode.flyby': 'Geçiş',
    'ui.mode.capture': 'Yörüngeye giriş',
    'ui.mode.free': 'Serbest dönüş',
    'ui.side': 'Hedef etrafında geçiş yönü',
    'ui.sideAria': 'Geçiş yönü',
    'ui.side.any': 'Fark etmez',
    'ui.side.pro': 'Prograd',
    'ui.side.retro': 'Retrograd',
    'ui.sideHint': 'Serbest dönüşte retrograd geçiş dönen çerçevede 8 (S) biçimini verir.',
    'ui.park': 'Park irtifası (km)',
    'ui.t0': 'Kalkış anı t₀ (gün)',
    'ui.theta': 'Yanma açısı θ (°) · kalkış→hedef doğrultusuna göre',
    'ui.thetaRange': 'Yanma açısı kaydırıcı',
    'ui.thetaNum': 'Yanma açısı',
    'ui.dv': 'Kalkış Δv (m/s) · teğetsel, prograd',
    'ui.dvRange': 'Δv kaydırıcı',
    'ui.dvNum': 'Δv',
    'ui.dur': 'Simülasyon süresi (gün)',
    'ui.auto': 'Otomatik süre',
    'ui.hohmann': 'Hohmann tahmini',
    'ui.solve': 'Hedefe göre çöz',
    'ui.stop': 'Durdur',
    'ui.sec.results': 'Sonuçlar',
    'ui.sec.model': 'Model',
    'ui.model1': 'Gök cisimleri seçilen ebeveynleri etrafında dairesel Kepler yörüngelerinde analitik olarak ilerler; ağırlık merkezleri korunur. Yalnızca araç sayısal olarak entegre edilir (Dormand–Prince 5(4), uyarlamalı adım), tüm cisimlerin çekimi hesaba katılır.',
    'ui.model2': 'Yanmalar anlıktır. Çözücü önce yanma açısını tarar, ardından Levenberg–Marquardt ile Δv, θ ve gerekirse t₀ değerini hedef irtifalara oturtur.',
    'ui.canvas': 'Yörünge görselleştirmesi',
    'ui.frameAria': 'Görünüm çerçevesi',
    'ui.followAria': 'Kamera takibi',
    'ui.glossTitle': 'Terimler sözlüğü',
    'ui.fit': 'Sığdır',
    'ui.soi': 'Etki küreleri',
    'ui.tracks': 'Cisim izleri',
    'ui.tplusInit': 'T+ 0g 00:00:00',
    'ui.scrub': 'Zaman çizelgesi',
    'ui.speed': 'Oynatma hızı',
    'ui.focus': 'Olay odaklı',
    'ui.focusTip': 'Yakın geçişlerde yavaşlar, boş yolculukta hızlanır',
    'ui.loop': 'Döngü',
    'ui.loopTip': 'Açıksa sonda baştan başlar; kapalıyken yakalanan araç yörüngede dönmeye devam eder',
    'ui.glossEyebrow': 'Sözlük',
    'ui.glossHead': 'Yörünge terimleri',
    'ui.close': 'Kapat',
    'ui.glossSearch': 'Terim ara',
    'ui.glossPlaceholder': 'Terim ara: SOI, aphelion, Δv…',

    // ---- units / formats ----
    'unit.d': 'g',
    'unit.au': 'AU',
    'hud.tplus': 'T+ {t}',

    // ---- bodies ----
    'body.sun': 'Güneş',
    'body.mercury': 'Merkür',
    'body.venus': 'Venüs',
    'body.earth': 'Dünya',
    'body.moon': 'Ay',
    'body.mars': 'Mars',
    'body.phobos': 'Phobos',
    'body.jupiter': 'Jüpiter',
    'body.europa': 'Europa',
    'body.custom': 'Özel cisim',
    'body.default': 'Cisim',
    'body.role.dep': 'Kalkış',
    'body.role.tgt': 'Hedef',
    'body.role.extra': 'Ek',
    'body.select': 'Cisim seçimi',
    'body.remove': 'Cismi kaldır',
    'body.name': 'Ad',
    'body.mass': 'Kütle (kg)',
    'body.radius': 'Yarıçap (km)',
    'body.parent': 'Etrafında döner',
    'body.parentRoot': 'Merkez (sabit)',
    'body.a': 'Yörünge yarıçapı (km)',
    'body.phase': 'Başlangıç fazı (°)',
    // HTML: {name} and {parent} are pre-escaped / trusted
    'body.hint': '{name} normalde {parent} etrafında döner.',
    'body.hintAdd': 'Ekle: {parent}',

    // Apsis names per body key: [nearest, farthest]. Bodies without a special name use 'periapsis'.
    // A missing second entry keeps the body out of the glossary table.
    'apsis': {
      earth: ['perigee', 'apogee'], moon: ['perilune', 'apolune'], sun: ['perihelion', 'aphelion'],
      mars: ['periareion', 'apoareion'], venus: ['pericytherion', 'apocytherion'],
      mercury: ['perihermion'], jupiter: ['perijove', 'apojove'],
    },
    'apsis.generic': 'periapsis',
    'apsis.table.body': 'Cisim',
    'apsis.table.near': 'En yakın',
    'apsis.table.far': 'En uzak',

    // ---- scenarios ----
    'sc.em_free.name': 'Dünya → Ay · Serbest dönüş (8 / S)',
    'sc.em_free.note': 'Apollo tipi serbest dönüş: Ay\'ın arkasından retrograd geçip motor yakmadan Dünya\'ya döner. Dönen çerçevede 8 biçimi görünür.',
    'sc.em_cap.name': 'Dünya → Ay · Yörüngeye giriş',
    'sc.em_cap.note': 'Translunar enjeksiyon, ardından 100 km dairesel Ay yörüngesine giriş yanması.',
    'sc.em_sun.name': 'Dünya → Ay · Güneş etkisiyle (3 cisim)',
    'sc.em_sun.note': 'Aynı serbest dönüş, üçüncü cisim olarak Güneş\'in çekimi eklenmiş. Güneş, Dünya merkezli tanımda 1 AU yörüngede görünür.',
    'sc.e_mars.name': 'Dünya → Mars · Hohmann + yakalama',
    'sc.e_mars.note': 'Güneş merkezli Hohmann transferi. Kalkış anı, Mars\'ın doğru faz açısında olduğu pencereye ayarlı.',
    'sc.moon_mars.name': 'Ay → Mars · 4 cisim',
    'sc.moon_mars.note': 'Alçak Ay yörüngesinden kalkış: önce Ay\'dan, sonra Dünya\'nın kuyusundan kaçış, ardından Mars.',
    'sc.e_venus.name': 'Dünya → Venüs · Geçiş',
    'sc.e_venus.note': 'İçe doğru Hohmann transferi ve 500 km irtifada Venüs yakın geçişi.',

    // ---- core.js errors and event labels ----
    'err.mass': '{name}: kütle pozitif olmalı.',
    'err.radius': '{name}: yarıçap pozitif olmalı.',
    'err.parent': 'Geçersiz yörünge ebeveyni.',
    'err.noRoot': 'Bir cisim merkezde sabit olmalı ("Merkez" seçin).',
    'err.multiRoot': 'Yalnızca bir cisim merkezde olabilir; diğerleri bir cismin etrafında dönmeli.',
    'err.cycle': 'Yörünge zinciri döngüsel; ebeveyn seçimlerini kontrol edin.',
    'err.orbit': '{name}: yörünge yarıçapı iki cismin yarıçap toplamından büyük olmalı.',
    'err.parkNeg': 'Park irtifası negatif olamaz.',
    'err.fix': 'Cisim ayarlarını düzeltin: {e}',
    'ev.depart': 'Kalkış yanması',
    'ev.targetPeri': 'Hedef periapsis',
    'ev.capture': 'Yörüngeye giriş yanması',
    'ev.returnPeri': 'Dönüş {peri}',
    'ev.impact': 'Çarpma',

    // ---- mission labels (peri = body-specific apsis name) ----
    'm.target': 'Hedef {peri} (km)',
    'm.return': 'Dönüş {peri} (km)',

    // ---- map markers ----
    'mk.dv': 'Δv {v} m/s',
    'mk.capDv': 'Giriş Δv {v} m/s',
    'mk.entry': ' · atmosfer girişi',
    'mk.impact': 'Çarpma · {name}',
    'tick.title': '{label} · T+ {t}',

    // ---- frames / camera ----
    'fr.inertial': 'Eylemsiz',
    'fr.centered': '{name} merkezli',
    'fr.rot': 'Dönen {a}–{b}',
    'fo.free': 'Serbest',
    'fo.craft': 'Araç',

    // ---- playback ----
    'play.pause': 'Duraklat',
    'play.play': 'Oynat',

    // ---- results ----
    'res.fail': 'Hesaplanamadı',
    'chip.impact': '{name} yüzeyine çarptı',
    'chip.captured': '{name} yörüngesine girildi',
    'chip.freeDone': 'Serbest dönüş tamam',
    'chip.noReturn': '{name} geçişi var, dönüş yok',
    'chip.flyby': '{name} yakın geçişi',
    'chip.missed': '{name} ıskalandı · en yakın {d}',
    'res.dv': 'Kalkış Δv',
    'res.capDv': 'Giriş Δv',
    'res.totDv': 'Toplam Δv',
    'res.c3': 'C3 · {name}',
    'res.arrival': '{name} varış süresi',
    'res.periAlt': '{peri} irtifası',
    'res.pro': 'prograd',
    'res.retro': 'retrograd',
    'res.periSpeed': '{peri} hızı',
    'res.vinf': 'v∞ · {name}',
    'res.bound': 'bağlı',
    'res.closest': 'En yakın yaklaşım',
    'res.altUnit': 'irtifa',
    'res.time': 'Zamanı',
    'res.retPeri': 'Dönüş {peri}',
    'res.noReturn': 'dönmüyor',
    'res.hohmann': 'Hohmann referansı',
    'res.integration': 'Entegrasyon',
    'res.steps': 'adım',
    'res.hohmannUnit': 'm/s · {days} g',

    // ---- HUD ----
    'hud.alt': 'İrtifa · {name}',
    'hud.rel': 'Bağıl hız · {name}',
    'hud.lap': ' · yörüngede {n}. tur',
    'canvas.soi': 'SOI',

    // ---- status line / solver ----
    'st.side': 'Geçiş yönü çözücüde kullanılır: "Hedefe göre çöz" ile uygulayın.',
    'st.noHohmann': 'Bu yapılandırma için Hohmann tahmini üretilemedi.',
    'st.hohmann': 'Hohmann: Δv {dv} m/s · transfer {days} gün',
    'st.hohmannT0': ' · t₀ {t0} g',
    'st.hohmannTail': '. İnce ayar için "Hedefe göre çöz".',
    'st.solving': 'Çözülüyor…',
    'st.progress': 'Çözülüyor… {n} yörünge denendi',
    'st.solved': 'Çözüldü',
    'st.nearest': 'Tam çözüm bulunamadı, en yakın sonuç uygulandı',
    'st.solvedInfo': ' · {evals} yörünge · {secs} s',
    'st.cancelled': 'Durduruldu; değerler değişmedi.',
    'st.solverErr': 'Çözücü hata verdi: {e}',

    // ---- glossary ----
    'gloss.none': 'Bu aramayla eşleşen terim yok.',
    // [group, [[term, subtitle, HTML description] | ['__APSIS__']]]
    'gloss': [
      ['Yörünge noktaları', [
        ['Periapsis / Apoapsis', 'peri- / apo-', 'Bir yörüngenin merkez cisme en yakın (periapsis) ve en uzak (apoapsis) noktaları. Genel isimdir; cisme göre özel adlar kullanılır (aşağıdaki tablo).'],
        ['__APSIS__'],
        ['Perigee / Apogee', 'Dünya', 'Dünya etrafındaki yörüngenin en yakın ve en uzak noktası. Serbest dönüşte "dönüş perigee" atmosfere giriş irtifasıdır.'],
        ['Perilune / Apolune', 'Ay', 'Ay etrafındaki en yakın ve en uzak nokta. Apollo görevlerinde "pericynthion" da denir.'],
        ['Perihelion / Aphelion', 'Güneş', 'Güneş etrafındaki yörüngede en yakın ve en uzak nokta. Dünya–Mars Hohmann transferinde kalkış perihelion, varış aphelion noktasındadır.'],
      ]],
      ['Manevralar', [
        ['Δv (delta-v)', 'm/s', 'Bir manevra için gereken hız değişimi. Roket denklemiyle doğrudan yakıt miktarına bağlıdır: <code>Δv = Isp·g₀·ln(m₀/m₁)</code>.'],
        ['Hohmann transferi', '', 'İki dairesel yörünge arasında, iki teğetsel yanmayla yapılan en az enerjili transfer. Transfer elipsi bir yörüngeye periapsisinde, diğerine apoapsisinde değer.'],
        ['Park yörüngesi', '', 'Transferden önce aracın beklediği alçak dairesel yörünge. Kalkış yanması buradan yapılır.'],
        ['TLI', 'Trans-Lunar Injection', 'Dünya park yörüngesinden Ay\'a gönderen kalkış yanması. Alçak yörüngede yaklaşık 3,1 km/s.'],
        ['Yörüngeye giriş', 'capture', 'Hedefe varışta aracı yavaşlatıp hedefin etrafında kapalı bir yörüngeye sokan yanma. Uygulamada periapsiste, dairesel yörüngeye anlık yanma olarak modellenir.'],
        ['Prograd / Retrograd', '', 'Prograd: yörünge hareketi yönünde. Retrograd: ters yönde. Hedefin etrafında retrograd geçiş, serbest dönüşte 8 (S) biçimini verir.'],
        ['Anlık yanma', 'impulsive burn', 'Motor yanma süresinin yörünge periyoduna göre çok kısa olduğu varsayımı; hız bir anda değişir. Düşük itkili motorlarda geçerli değildir.'],
      ]],
      ['Görev tipleri', [
        ['Serbest dönüş', 'free return', 'Hedefin yanından geçip ek yanma yapmadan başlangıç cismine geri dönen yörünge. Apollo 13 bu yörüngeyle kurtarıldı.'],
        ['Yakın geçiş', 'flyby', 'Hedefin yanından yörüngeye girmeden geçmek. Hedefin çekimi aracın yönünü ve hızını değiştirir (kütleçekim yardımı).'],
        ['Kütleçekim yardımı', 'gravity assist', 'Bir gezegenin yanından geçerken onun yörünge hareketinden hız ödünç almak. Hedefe göre hız aynı kalır, Güneş\'e göre değişir.'],
        ['Cycler', '', 'İki cisim arasında periyodik olarak gidip gelen, kendini tekrarlayan yörünge (ör. Aldrin cycler, Dünya–Mars). Korunması için küçük düzeltme yanmaları gerekir.'],
        ['Atmosfer girişi', 'entry interface', 'Dünya için yaklaşık 120 km irtifa. Dönüş perigee\'si bu koridorun içine nişanlanırsa sürtünme aracı yakalar.'],
      ]],
      ['Hız ve enerji', [
        ['v∞', 'hiperbolik fazla hız', 'Aracın bir cismin etki küresinden çıkarken (ya da girerken) o cisme göre sahip olduğu artık hız. Kaçış hızını aşan kısımdır.'],
        ['C3', 'karakteristik enerji, km²/s²', 'Kalkıştaki yörünge enerjisinin iki katı: <code>C3 = v∞²</code>. Negatifse araç cisme bağlıdır (Ay transferi), pozitifse kaçar (Mars transferi).'],
        ['Kaçış hızı', '', 'Bir cismin çekiminden kurtulmak için gereken en düşük hız: <code>v = √(2μ/r)</code>. Dünya yüzeyinde ≈ 11,2 km/s.'],
        ['μ (mu)', 'GM, m³/s²', 'Standart kütleçekim parametresi; cismin kütlesi ile G\'nin çarpımı. Kütleden çok daha hassas bilinir.'],
      ]],
      ['Model ve görünüm', [
        ['SOI', 'Sphere of Influence · etki küresi', 'Bir cismin çekiminin baskın sayıldığı bölge: <code>r ≈ a·(m/M)^(2/5)</code>. Ay\'ın SOI\'si ≈ 66.000 km, Dünya\'nınki (Güneş\'e göre) ≈ 925.000 km.'],
        ['Faz açısı', 'fırlatma penceresi', 'Kalkış anında hedefin, kalkış cismine göre önde olması gereken açı. Dünya–Mars için ≈ 44°; bu geometri yaklaşık her 26 ayda bir tekrarlar.'],
        ['Eylemsiz çerçeve', '', 'Dönmeyen, sabit yıldızlara göre tanımlı görünüm. Yörüngeler "gerçek" şekilleriyle görünür.'],
        ['Dönen çerçeve', 'sinodik', 'İki cismi aynı yerde sabit tutan, onlarla birlikte dönen görünüm. Serbest dönüşün 8 biçimi yalnızca burada görünür.'],
        ['Kısıtlı N-cisim', '', 'Aracın kütlesinin ihmal edildiği model: cisimler aracı çeker, araç cisimleri çekmez. Bu uygulamanın kullandığı modeldir.'],
        ['Patched conic', 'yamalı konikler', 'Yörüngeyi her SOI\'de tek bir cismin Kepler yörüngesi olarak hesaplayıp sınırlarda birleştiren yaklaşım. "Hohmann tahmini" bununla yapılır.'],
      ]],
    ],
  },
};

let LANG = 'tr';
const DICT = I18N[LANG];

function _(key, params) {
  const s = DICT[key];
  if (typeof s !== 'string') return key;
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m)) : s;
}

// Fill static markup: data-i18n -> textContent, data-i18n-<attr> -> attribute (aria-label, title, placeholder, content).
function applyI18n() {
  document.documentElement.lang = DICT['meta.lang'];
  document.title = DICT['meta.title'];
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = _(el.dataset.i18n);
  for (const el of document.querySelectorAll('*')) {
    for (const a of el.getAttributeNames()) {
      if (a.startsWith('data-i18n-')) el.setAttribute(a.slice(10), _(el.getAttribute(a)));
    }
  }
}
