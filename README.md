# WNERSDEV ULTIMATE — Abone Rol Sistemi + YouTube Doğrulama Modülü

Discord abonelik/plan/rol yönetimi, ödeme mimarisi ve YouTube kanal doğrulama +
Gemini AI risk analizi içeren tam kapsamlı bir Discord bot sistemi.

## Kurulum

```bash
npm install
```

`ayarlar.json` dosyasını doldurun (bkz. aşağıdaki bölümler). Ardından:

```bash
node wnersdev.js
```

Ana giriş dosyası her zaman `wnersdev.js`'dir.

## Yapılandırma (ayarlar.json)

| Bölüm | Açıklama |
|---|---|
| `discord` | Bot token, clientId, owner/manager/staff rol ID'leri |
| `mongodb` | MongoDB bağlantı URI'si — boşsa sistem "sınırlı mod"da çalışır |
| `subscription` | İptal davranışı, duraklatma, grace period |
| `payment` | Ödeme sağlayıcısı (şu an: stripe), webhook sunucusu |
| `youtube` | YouTube Data API v3 anahtarı, quota, timeout |
| `gemini` | Gemini API anahtarı, model, eşzamanlılık limiti |
| `captcha` | Turnstile / hCaptcha / reCAPTCHA yapılandırması |
| `verification` | Kilit zaman aşımı, cooldown'lar, anomali eşikleri |
| `scheduler` | Tüm periyodik işlerin çalışma aralıkları |

Herhangi bir dış servis (MongoDB, ödeme, YouTube API, Gemini, CAPTCHA)
yapılandırılmamışsa sistem bunu **açıkça "Yapılandırılmamış" olarak bildirir**
ve o özelliği devre dışı bırakır — asla sahte/başarılı sonuç üretmez.

## Mimari

```
wnersdev.js              → tek giriş noktası
src/commands/             → yalnızca komut/controller katmanı (business logic YOK)
src/services/             → tüm iş mantığı burada
src/database/models/      → Mongoose şemaları
src/components/           → Discord Components V2 panelleri + buton/select handler'ları
src/core/                 → cache, queue, scheduler, commandLoader, componentRouter
src/jobs/                 → zamanlanmış arka plan işleri
src/events/               → Discord.js olay dinleyicileri
src/utils/                → logger, hata sınıfları, doğrulama, formatlama, izin sistemi
```

## Abonelik Sistemi

- `/abonelik` — durum, planlar, yenile, iptal, geçmiş (kullanıcı)
- `/plan` — olustur, listele, sil, aktif (yönetici)
- `/abone` — ver, uzat, iptal, duraklat, devam, sil, kontrol, senkronize, istatistik, sistem, yedekle, disa-aktar (yönetici)
- `/panel` — Components V2 tabanlı yönetim paneli

Plan sistemi tamamen MongoDB üzerinden yönetilir, hard-code değildir. Her
sunucu (`guildId`) kendi planlarına, ayarlarına ve verilerine sahiptir —
tam izolasyon sağlanır.

Ödeme sağlayıcısı yapılandırılmadan **hiçbir zaman** başarılı ödeme kaydı
oluşturulmaz. Şu an gerçek entegrasyonu hazır olan sağlayıcı: **Stripe**
(checkout session + webhook). `payment.webhookServer.enabled = true` yapılıp
port açıldığında `/webhook/stripe` yoluna gelen istekler HMAC imza
doğrulamasından geçirilir; imza geçersizse istek reddedilir.

## YouTube Doğrulama Sistemi

- `/youtube dogrula`, `durum`, `tekrar-tara`, `gecmis`, `kanal-degistir` (kullanıcı)
- `/youtube tara`, `istatistik`, `sistem`, `otomatik-tarama-durdur/baslat`, `guvenli-mod-kapat` (yönetici)
- `/inceleme liste`, `onayla`, `reddet`, `tekrar-tara`, `askiya-al` (yönetici)
- `/youtube-ayar` — kural motoru / policy ayarları (rol, min abone, min video, tarama aralığı, grace period, duplicate politikası)

### Akış

Kanal girdisi (URL/@handle/Channel ID) → güvenli parse (yalnızca youtube.com/youtu.be,
HTTPS zorunlu) → **gerçek YouTube Data API v3** çağrısı → deterministik kural motoru
(AND/OR/NOT, karşılaştırma operatörleri, `VerificationPolicy` üzerinden
sunucuya özel ve versiyonlanmış) → deterministik risk skoru → (yapılandırılmışsa)
Gemini AI risk analizi (yalnızca **analiz**, asla karar) → nihai durum
(`PASSED`/`FAILED`/`GRACE_PERIOD`/`MANUAL_REVIEW`) → rol/seviye güncelleme →
audit log → Türkçe bildirim.

**Karar önceliği:** Gerçek API verisi → Deterministik kurallar → Güvenlik
kontrolleri (duplicate kanal, kilit, cooldown) → AI risk analizi (yardımcı
sinyal) → gerekiyorsa manuel inceleme. AI hiçbir zaman tek başına rol
verme/kaldırma kararı vermez; AI'nin cevabı şemaya uymuyorsa veya doğrudan
eylem komutu içeriyorsa reddedilir.

### Güvenlik / Fail-safe

- **Verification Lock**: MongoDB TTL-index tabanlı, aynı kullanıcı aynı anda
  ikinci doğrulama başlatamaz.
- **Mass Failure / Anomaly Detection**: Bir taramada beklenenden çok yüksek
  başarısızlık oranı tespit edilirse **Safe Mode** devreye girer, otomatik
  rol kaldırma durur, mevcut roller korunur.
- **Kill Switch**: `ROLE_ASSIGNMENT`, `ROLE_REMOVAL`, `AUTO_SCAN`,
  `AI_ANALYSIS` ayrı ayrı kapatılabilir.
- **Prompt Injection Koruması**: Gemini'ye giden istekte kullanıcı verisi
  ayrı bir "güvenilmeyen veri" bloğu olarak gönderilir; system instruction
  ile karıştırılmaz.
- **Idempotency**: Ödeme webhook'ları ve abonelik oluşturma işlemleri
  `idempotencyKey` ile korunur, aynı istek iki kez işlenmez.

## Abone-Foto Kanalı (AI Moderasyonlu)

`ayarlar.json -> photoVerification`:

```json
"photoVerification": {
  "enabled": true,
  "channelId": "KANAL_ID",
  "requiredRoleId": "ABONE_ROL_ID",
  "moderationMode": "manuel",
  "staffMentionRoleIds": ["YETKILI_ROL_ID"],
  "deleteUnauthorizedMessages": true,
  "aiRiskRejectThreshold": 70,
  "aiRiskReviewThreshold": 40
}
```

- `requiredRoleId` rolüne sahip olmayan kullanıcıların bu kanaldaki mesajları
  otomatik silinir ve kısa süreli bir uyarı bırakılır.
- Rol sahibi bir kullanıcı fotoğraf attığında (Gemini yapılandırılmışsa)
  görsel AI ile taranır (risk skoru + kısa gerekçe).
- `moderationMode: "manuel"` ise sonuç ne olursa olsun mesaj kanalda
  `staffMentionRoleIds` etiketlenerek **Evet/Hayır** butonlu bir inceleme
  kartı bırakılır; yalnızca yönetici/yetkili tıklayabilir.
- `moderationMode: "otomatik"` ise deterministik eşiklere göre karar verilir
  (`aiRiskRejectThreshold`/`aiRiskReviewThreshold`); AI yapılandırılmamışsa
  veya cevabı geçersizse sistem **asla körlemesine onaylamaz** — güvenlik
  gereği otomatik olarak yetkili incelemesine düşer.
- Tüm gönderimler `PhotoSubmission` koleksiyonunda ve `AuditLog`'da izlenir.



Bu proje bir sohbet/ajan ortamında, **canlı Discord/MongoDB/YouTube
API/Gemini API bağlantısı olmadan** geliştirilmiştir. Yapılabilen ve
yapılamayan kontroller:

**Yapıldı:**
- 91 JS dosyasının tamamında `node --check` ile syntax doğrulaması — hepsi geçti.
- Tüm göreli `require()` yollarının gerçek dosyalara işaret ettiği script ile doğrulandı.
- Komut adı, component namespace, scheduler görev adı, Mongoose model adı
  çakışması olmadığı statik olarak doğrulandı.
- Kod içinde TODO/FIXME/mock/placeholder/fake veri taraması yapıldı — bulunamadı.

**Yapılamadı (canlı altyapı gerektirir):**
- `npm install` bu ortamda ağ erişimi kapalı olduğu için başarısız oldu —
  `discord.js` ve `mongoose` paketleri hiç kurulamadı, dolayısıyla
  gerçek bir Node process'i başlatıp modülleri gerçekten import etmek /
  Discord.js Components V2 builder'larının (ContainerBuilder vb.) kullanılan
  API yüzeyiyle birebir uyuştuğunu çalışma zamanında doğrulamak mümkün olmadı.
- Discord sunucusunda canlı test edilmedi.
- Gerçek MongoDB ile doğrulanmadı.
- Gerçek Stripe webhook'u test edilmedi.
- Gerçek YouTube Data API / Gemini API çağrıları test edilmedi.

Bu nedenle ilk çalıştırmada `npm install` sonrası küçük API-yüzeyi
uyumsuzlukları (özellikle Components V2 builder metod isimleri, discord.js
sürüm gereksinimleri) çıkabilir; kod mantığı ve mimari tamamdır ancak
"canlı ortamda sıfır hatayla çalışır" garantisi bu ortamdan verilemez.

## Bu Oturumda Kapsam Dışı Bırakılanlar (dürüst rapor)

İkinci ek prompt (77+50 madde) son derece geniş bir kapsam tanımlıyordu.
Aşağıdaki maddeler **gerçek, çalışan çekirdek** olarak uygulandı: Rule
Engine, Policy Versioning, Verification Lock, Risk Engine, Safe Mode/Kill
Switch, Anomaly/Mass-Failure Detection, Gemini AI entegrasyonu (schema
validation + prompt injection koruması), CAPTCHA abstraction, Manuel
İnceleme kuyruğu, Grace Period, Rol kademelendirme (VerificationLevel).

Aşağıdaki ikincil maddeler bu oturumda **uygulanmadı** (yarım/sahte
uygulamaktansa dürüstçe dışarıda bırakıldı):

- Screenshot/kanıt yükleme + OCR + perceptual-hash duplicate kanıt tespiti
- Appeal (itiraz) sistemi ve appeal rate limit
- CSV/JSON export/import akışı için ayrı komut + schema validation + rollback UI'ı (backup servisindeki genel JSON export/import mekanizması mevcut, ancak verification'a özel export/import komutu yok)
- Zaman serisi / geçmiş grafik analitiği
- Request coalescing için tam production-grade dağıtık kilitleme (şu an process-içi `Map` ile yapılıyor; tek process için yeterli, çoklu process/shard için genişletilmesi gerekir)

Bu maddeler eklenmek istenirse ayrı bir oturumda, aynı servis mimarisi
üzerine (yeni servis dosyaları + modeller) inşa edilebilir.
