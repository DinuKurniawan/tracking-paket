# Traccking Paket (React + Vite)

Aplikasi tracking paket dengan:

- Integrasi **RajaOngkir by Komerce API** (data real-time dari endpoint tracking)
- **Peta perjalanan paket** memakai OpenStreetMap + Leaflet
- UI modern, responsif, dan ringan

## Setup

1. Install dependency:

   ```bash
   npm install
   ```

2. Buat file `.env.local` dari `.env.example`:

   ```bash
   copy .env.example .env.local
   ```

3. Isi API key RajaOngkir di `.env.local`:

   ```env
   # Opsional key umum (fallback):
   RAJAONGKIR_API_KEY=

   # Disarankan isi key spesifik:
   RAJAONGKIR_SHIPPING_COST_API_KEY=api_key_shipping_cost
   RAJAONGKIR_SHIPPING_DELIVERY_API_KEY=api_key_shipping_delivery

   RAJAONGKIR_BASE_URL=https://rajaongkir.komerce.id/api/v1
   RAJAONGKIR_DELIVERY_BASE_URL=https://api-sandbox.collaborator.komerce.id/order/api/v1
   ```

4. Jalankan app:

   ```bash
   npm run dev
   ```

5. Jika mengubah isi `.env.local`, **restart** server dev agar key terbaca ulang.

## Catatan jenis API key

1. Untuk tracking AWB umum (seperti di cekresi), gunakan **Shipping Cost API key**.
2. Untuk tracking order Komship (`history-airway-bill`), gunakan **Shipping Delivery API key**.
3. App otomatis:
   - coba Shipping Cost API dulu,
   - kalau gagal, fallback ke Shipping Delivery API,
   - dan bisa **Auto Deteksi** kurir.

## Cara pakai

1. Masukkan nomor resi.
2. Pilih kurir.
3. Klik **Lacak Paket**.

App akan menampilkan ringkasan status, timeline tracking, dan marker lokasi pada peta.
