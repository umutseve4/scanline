<h1 align="center">scanline</h1>

<p align="center">
  GPU kullanmadan, her pikseli JavaScript'te tek tek hesaplayan bir 3D renderer.<br>
  Üçgen taraması, z-buffer, gölge haritası, aydınlatma, tonemapping. Hepsi elle yazıldı.<br>
  <code>canvas</code> yalnızca hazır piksel dizisini ekrana basmak için var.
</p>

<p align="center">
  <a href="https://umutseve4.github.io/scanline/"><b>Canlı demo</b></a>
</p>

<p align="center">
  <a href="https://github.com/umutseve4/scanline/actions"><img src="https://github.com/umutseve4/scanline/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/CI%20ad%C4%B1m%C4%B1-5-FF4D4F?style=flat-square" alt="5 CI adımı">
  <img src="https://img.shields.io/badge/ba%C4%9F%C4%B1ml%C4%B1l%C4%B1k-0-FF4D4F?style=flat-square" alt="0 bağımlılık">
  <img src="https://img.shields.io/badge/pipeline%20a%C5%9Famas%C4%B1-10-FF4D4F?style=flat-square" alt="10 aşama">
</p>

---

## 30 saniyede ne oluyor?

```bash
git clone https://github.com/umutseve4/scanline && cd scanline
npm run build      # → dist/scanline.html
```

Çıkan tek dosyayı çift tıkla. Sunucu, kurulum, internet gerekmez.

Kaynaktan çalıştırmak istersen (ES modülleri için basit bir sunucu yeterli):

```bash
python3 -m http.server 8000   # sonra http://localhost:8000
```

Ekranda: dönen bir (2,3) torus knot, zıplayan bir küre, dönen bir küp ve satranç
tahtası zemin; yönlü ışık, 3×3 PCF yumuşak gölge, Blinn-Phong specular ve ACES
tonemap ile gerçek zamanlı çiziliyor.

## Kontroller

| Kontrol | Açıklama |
| --- | --- |
| Mod | `shaded`, `normals`, `depth` (linearize edilmiş), `uv` |
| Gölge haritası | 768×768 shadow map + PCF açık/kapalı |
| Wireframe | Bresenham çizgilerle tel kafes overlay |
| Çözünürlük | 0.25x ile 1.0x iç render ölçeği |
| Pozlama | ACES öncesi exposure 0.30 ile 2.50 |
| PNG kaydet | O anki kareyi indirir |

Kısayollar: `W` wireframe, `S` gölge, `Space` duraklat, `1` ile `4` render modu.
Fare ile sürükle = yörünge, tekerlek = zoom. HUD canlı olarak fps, kare süresi,
çözünürlük, rasterize edilen üçgen, shade edilen fragment, clip edilen üçgen ve
pass başına milisaniye gösterir.

## Ölçülen referans değerler

Node 24, tek çekirdek, 960×600, **20.485 üçgen**, **527.240 fragment**, 2 üçgen
near-plane'de kırpıldı:

| Pass | Süre |
| --- | --- |
| Shadow pass | 43.63 ms |
| Geometry + shading | 178.76 ms |
| Resolve | 53.52 ms |
| **Toplam** | **275.91 ms** |

Aynı koşuda konu kapsama oranı **%66.0**, ortalama parlaklık **81.99/255**. Bundle
doğrulaması 675×420'de **%65.1** kapsama ve **223.67** maksimum luma ile geçti.

## Doğrulama

CI (`.github/workflows/ci.yml`) her push'ta beş adım çalıştırır ve hiçbiri
"derlendi, demek ki çalışıyor" varsayımına dayanmaz:

| Adım | Ne kanıtlıyor |
| --- | --- |
| `test` | 18 matematik assertion'ı: `lookAt` kamerayı origin'e taşıyor mu, `perspective` near/far düzlemlerini tam olarak −1/+1'e eşliyor mu, `normalMatrix` non-uniform scale altında dikliği koruyor mu, tekil matriste identity'ye düşüyor mu |
| `still` | Headless kare render eder, piksel istatistiklerini denetler. **Siyah veya düz bir kare CI'ı düşürür** |
| `modes` | Dört render modunu ayrı ayrı render edip hash'lerinin farklı olduğunu doğrular (bozuk mod switch'i dört aynı kare üretirdi) |
| `build` | Altı ES modülünü tek HTML'e gömer; artıkta `import`/`export` kalırsa hata verir |
| `verify` | Üretilen tek dosyayı Node'un `vm`'inde minimal DOM stub'ıyla **çalıştırır**, `putImageData`'ya giden gerçek pikselleri yakalar, kapsama/parlaklık eşiklerini kontrol eder |

Yani test edilen "bundle parse oluyor" değil, **"bundle görüntü çiziyor"**.

<details>
<summary><b>Pipeline: bir GPU'nun sessizce yaptığı işin elle yazılmış hali</b></summary>

`src/raster.js` içinde:

1. **Vertex transform.** Model → world → clip space; normaller inverse-transpose matrisle taşınır (non-uniform scale altında dik kalsınlar diye).
2. **Near-plane clipping.** Homojen uzayda Sutherland-Hodgman; kameranın arkasına taşan üçgenler kırpılır, sonuç fan-triangulate edilir.
3. **Perspective divide + viewport map.** NDC → piksel koordinatları.
4. **Backface culling.** İşaretli ekran alanı ile.
5. **Edge-function scan.** Bounding box üzerinde artımsal kenar fonksiyonları; kapsama testi 3 karşılaştırma.
6. **Perspective-correct interpolation.** Attribute/w interpolasyonu, sonra 1/w'ye bölme. (Affine interpolasyon zeminde belirgin şekilde eğrilirdi.)
7. **Z-buffer.** Float32Array derinlik tamponu.
8. **Shadow pass.** Işık için ortografik derinlik render'ı, ardından 3×3 PCF ve eğime bağlı depth bias (`0.0016 + 0.006 * (1 - N·L)`) ile shadow acne engelleniyor.
9. **Shading.** Hemisphere ambient + Lambert diffuse + Blinn-Phong specular + Fresnel rim; prosedürel checker/stripe albedo.
10. **Resolve.** ACES filmic tonemap, vignette, gamma 2.2.

Sıcak döngüde hiç allocation yok: vertex, clip ve fragment yapıları modül
seviyesinde bir kez ayrılıp yeniden kullanılıyor.

</details>

<details>
<summary><b>Dosya yapısı ve diğer komutlar</b></summary>

```
src/math.js         4x4 matris/vektör katmanı (lookAt, perspective, ortho, normalMatrix)
src/framebuffer.js  linear renk + derinlik hedefleri, ACES resolve
src/geometry.js     prosedürel plane / box / sphere / torus knot
src/raster.js       rasterizer: clipping, culling, edge scan, z-test, çizgi çizimi
src/scene.js        sahne grafiği, ışık, gölge pass'i, shading modeli, kare döngüsü
src/main.js         tarayıcı katmanı: canvas blit, orbit kontrol, HUD, UI
tools/              headless render, PNG encoder, testler, tek-dosya build
```

Renderer'ın DOM'dan haberi yok, bu yüzden aynı kod Node'da da çalışıp PNG üretebiliyor.

```bash
npm run still     # headless still render + smoke test
npm run modes     # tüm debug modlarını tek contact sheet olarak üret
npm test          # matematik katmanının birim testleri (18 assertion)
```

</details>

## Neden ilginç?

Bir GPU'nun sizin için sessizce yaptığı her şey burada görünür durumda:
perspective-correct interpolation'ı çıkarırsanız dokular kayar, depth bias'ı
sıfırlarsanız shadow acne çıkar, near-plane clipping'i atlarsanız kameranın
arkasındaki üçgenler ekranı yırtar. Kod bu yüzden "kısa" değil, **okunabilir**
olacak şekilde yazıldı.

## Sınırlar

- **Gerçek zamanlı değil, gerçekçi zamanlı.** Yukarıdaki 275.91 ms tek çekirdekli bir CPU ölçümüdür; bir GPU aynı kareyi mikrosaniyelerle çizer. Bu proje hız için değil, görünürlük için yazıldı.
- Yalnızca Node 18+ ile çalışır; bağımlılık yok ama platform gereksinimi var.
- Canlı demo tarayıcıda çalışır, ancak yayınlanan dosya `npm run build` çıktısının aynısıdır; tarayıcıdaki kare hızı ölçülmedi ve hiçbir yerde fps iddiası yayınlanmıyor.
- Doku dosyası, malzeme sistemi, animasyon içe aktarma ve saydamlık sıralaması yok; albedo prosedürel.
- CI piksel çizildiğini kanıtlar; tarayıcıdaki görsel doğruluk, erişilebilirlik ve kare hızı davranışı ayrı bir kabul turu ister.

---

MIT
