# scanline

**Sıfırdan yazılmış bir software rasterizer.** WebGL yok, canvas 2D dışında hiçbir çizim API'si yok, tek bir bağımlılık yok. Ekrandaki her piksel — üçgen taraması, z-buffer, gölge haritası, aydınlatma, tonemapping — düz JavaScript ile hesaplanıyor. `canvas` yalnızca hazır piksel dizisini ekrana basmak için kullanılıyor (`putImageData`).

## Canlı demo

- **GitHub Pages:** https://umutseve4.github.io/scanline/
- **Tek dosya:** `dist/scanline.html` — indir, çift tıkla, çalışır. Sunucu, kurulum, internet gerekmez.

## Ne yapıyor?

Döner bir (2,3) torus knot, zıplayan bir küre, dönen bir küp ve satranç tahtası zemin; yönlü ışık, 3x3 PCF yumuşak gölge, Blinn-Phong specular ve ACES tonemap ile gerçek zamanlı çiziliyor.

Arayüzden kontrol edilebilenler:

| Kontrol | Açıklama |
| --- | --- |
| Mod | `shaded`, `normals`, `depth` (linearize edilmiş), `uv` |
| Gölge haritası | 768×768 shadow map + PCF açık/kapalı |
| Wireframe | Bresenham çizgilerle tel kafes overlay |
| Çözünürlük | 0.25x – 1.0x iç render ölçeği (performans/kalite dengesi) |
| Pozlama | ACES öncesi exposure 0.30 – 2.50 |
| PNG kaydet | O anki kareyi indirir |

Kısayollar: `W` wireframe, `S` gölge, `Space` duraklat, `1`–`4` render modu. Fare ile sürükle = yörünge, tekerlek = zoom.

HUD canlı olarak fps, kare süresi, çözünürlük, rasterize edilen üçgen sayısı, shade edilen fragment sayısı, clip edilen üçgen sayısı ve pass başına milisaniye gösterir.

## Pipeline

Gerçek bir GPU'nun yaptığı işin elle yazılmış hali (`src/raster.js`):

1. **Vertex transform** — model → world → clip space; normaller inverse-transpose matrisle taşınır (non-uniform scale altında dik kalsınlar diye).
2. **Near-plane clipping** — homojen uzayda Sutherland–Hodgman; kameranın arkasına taşan üçgenler kırpılır, sonuç fan-triangulate edilir.
3. **Perspective divide + viewport map** — NDC → piksel koordinatları.
4. **Backface culling** — işaretli ekran alanı ile.
5. **Edge-function scan** — bounding box üzerinde artımsal kenar fonksiyonları; kapsama testi tamsayı-dostu 3 karşılaştırma.
6. **Perspective-correct interpolation** — attribute/w interpolasyonu, sonra 1/w'ye bölme. (Affine interpolasyon zeminde belirgin şekilde eğrilirdi.)
7. **Z-buffer** — Float32Array derinlik tamponu.
8. **Shadow pass** — ışık için ortografik derinlik render'ı, ardından 3×3 PCF ve eğime bağlı depth bias (`0.0016 + 0.006 * (1 - N·L)`) ile shadow acne engelleniyor.
9. **Shading** — hemisphere ambient + Lambert diffuse + Blinn-Phong specular + Fresnel rim; prosedürel checker/stripe albedo.
10. **Resolve** — ACES filmic tonemap, vignette, gamma 2.2.

Sıcak döngüde hiç allocation yok: vertex, clip ve fragment yapıları modül seviyesinde bir kez ayrılıp yeniden kullanılıyor.

## Dosya yapısı

```
src/math.js         4x4 matris/vektör katmanı (lookAt, perspective, ortho, normalMatrix)
src/framebuffer.js  linear renk + derinlik hedefleri, ACES resolve
src/geometry.js     prosedürel plane / box / sphere / torus knot
src/raster.js       rasterizer: clipping, culling, edge scan, z-test, çizgi çizimi
src/scene.js        sahne grafiği, ışık, gölge pass'i, shading modeli, kare döngüsü
src/main.js         tarayıcı katmanı: canvas blit, orbit kontrol, HUD, UI
tools/              headless render, PNG encoder, testler, tek-dosya build
```

Renderer'ın DOM'dan haberi yok — bu yüzden aynı kod Node'da da çalışıp PNG üretebiliyor.

## Çalıştırma

```bash
# tarayıcıda (ES modülleri için basit bir sunucu yeterli)
python3 -m http.server 8000   # sonra http://localhost:8000

# headless still render + smoke test
npm run still

# tüm debug modlarını tek bir contact sheet olarak üret
npm run modes

# tek dosyalık dağıtım üret ve gerçekten piksel çizdiğini doğrula
npm run build && npm run verify

# matematik katmanının birim testleri (18 assertion)
npm test
```

Bağımlılık yok — sadece Node 18+.

## Doğrulama

CI (`.github/workflows/ci.yml`) her push'ta beş adım çalıştırır ve hiçbiri "derlendi, demek ki çalışıyor" varsayımına dayanmaz:

- **`test`** — 18 matematik assertion'ı: `lookAt` kamerayı origin'e taşıyor mu, `perspective` near/far düzlemlerini tam olarak -1/+1'e mi eşliyor, `normalMatrix` non-uniform scale altında dikliği koruyor mu, tekil matriste identity'ye düşüyor mu.
- **`still`** — headless kare render eder ve piksel istatistiklerini denetler: rasterize edilen üçgen sayısı, shade edilen fragment sayısı, maksimum parlaklık ve konu kapsama oranı. Siyah veya düz bir kare CI'ı düşürür.
- **`modes`** — dört render modunu ayrı ayrı render edip hash'lerinin farklı olduğunu doğrular (bozuk bir mod switch'i dört aynı kare üretirdi).
- **`build`** — altı ES modülünü tek bir HTML'e gömer; artıkta kalan `import`/`export` varsa hata verir.
- **`verify`** — üretilen tek dosyayı Node'un `vm`'inde minimal bir DOM stub'ıyla **çalıştırır**, `putImageData`'ya giden gerçek pikselleri yakalar ve kapsama/parlaklık eşiklerini kontrol eder. Yani "bundle parse oluyor" değil, "bundle görüntü çiziyor" test ediliyor.

Referans ölçüm (Node 20, tek çekirdek, 1000×620, 20.485 üçgen, 556.189 fragment): shadow pass ~36 ms, geometry+shading ~174 ms, resolve ~57 ms. Tarayıcıda varsayılan 0.75x ölçekte etkileşimli hızda döner; ağır sahnelerde çözünürlük kaydırıcısını düşürmek doğrusala yakın kazanç verir.

## Neden ilginç?

Bir GPU'nun sizin için sessizce yaptığı her şey burada görünür durumda: perspective-correct interpolation'ı çıkarırsanız dokular kayar, depth bias'ı sıfırlarsanız shadow acne çıkar, near-plane clipping'i atlarsanız kameranın arkasındaki üçgenler ekranı yırtar. Kod bu yüzden "kısa" değil, **okunabilir** olacak şekilde yazıldı.

## Lisans

MIT
