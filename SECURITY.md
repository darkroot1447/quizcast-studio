# Güvenlik notları

- `.env`, SQLite verisi, lisanslar ve özel anahtarlar git’e alınmaz.
- `EULER_API_KEY` yalnızca backend’de tutulur; client bundle’a yazılmaz.
- Admin API HttpOnly/SameSite oturum çerezi ister. Overlay yalnızca döndürülebilir token ile salt-okunur SSE/state alır.
- Overlay’e cevap ve açıklama, soru süresi bitmeden gönderilmez.
- Cevap kimliği, olay kimliği ve ilk cevap ilkeleri backend’de doğrulanır; tarayıcı puan gönderemez.
- Kullanıcı isimleri ve yorumlar sınırlandırılır, upstream ham bağlantı hataları loglanmaz.
- CSV hücreleri formül enjeksiyonuna karşı nötrlenir.
- Üretimde yedekleri şifrele, işletim sistemi kullanıcı izinlerini sınırla, admin panelini localhost dışında yayınlama.
- Gerçek internet erişimli dağıtım eklenirse TLS, CSRF koruması, reverse proxy allow-list, merkezi kimlik/lisans, audit log ve tenant izolasyonu eklenmeden satışa açma.
