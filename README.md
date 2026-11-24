# Ular Tangga 3D

Game ular tangga 3D yang berjalan penuh di browser. Semua model 3D digambar prosedural dengan Three.js dan semua musik serta efek suara digenerasi langsung dengan WebAudio, jadi tidak ada file aset gambar atau audio sama sekali.

**Main langsung: https://mochinho14.github.io/ular-tangga/**

## Fitur

- Dua dunia: **Bahtera** (geladak kapal bajak laut di tengah laut, ular bermotif) dan **Orbit** (papan neon melayang di antariksa, cacing angkasa bercincin cahaya). Tiap dunia punya lagu, palet, dan pencahayaan sendiri.
- Papan zig-zag 100 petak, menang pas di petak 100.
- Dadu 3D terlempar dengan animasi, plus mekanik **charge**: tahan tombol dan lepas di zona hijau buat lemparan sempurna, kelebihan tenaga membuat giliran hangus.
- Lawan komputer 1 sampai 3 AI, atau mode Bersama Teman 2 sampai 4 pemain di satu perangkat (bisa ditambah pemain komputer).
- 6 karakter prosedural: Kucing, Beruang, Kelinci, Bebek, Kodok, Robot.
- 4 layout papan: Mudah, Normal, Kacau, Acak (dibangkitkan dari seed, dijamin tanpa siklus ular-tangga).
- Aturan bisa diatur: angka 6 lempar lagi, tiga angka 6 berturut gugur, pantulan bila melewati 100.
- Kamera sinematik mengikuti bidak, bisa diseret dan di-zoom manual, tombol kamera buat kembali ke tampilan penuh.
- Pengaturan volume musik/SFX, kualitas grafis, percepat giliran komputer, tersimpan di localStorage.
- Responsif, bisa dimainkan di HP maupun desktop. Jalan dari hosting statis mana pun, termasuk dibuka langsung dari file.

## Cara menjalankan lokal

Cukup layani folder ini dengan server statis apa pun, contoh:

```
python3 -m http.server 8000
```

lalu buka http://localhost:8000 di browser modern.

## Teknologi

Satu halaman statis: `index.html`, `style.css`, `game.js`, dan Three.js r152 yang disertakan lokal di folder `lib/` supaya tetap jalan tanpa CDN.

Dibuat oleh mochinho.
