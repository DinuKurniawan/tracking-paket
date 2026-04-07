import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet'
import './App.css'

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

const DELIVERY_STEPS = [
  { key: 'picked_up', label: 'Diproses' },
  { key: 'in_transit', label: 'Dalam Perjalanan' },
  { key: 'out_for_delivery', label: 'Sedang Diantar' },
  { key: 'delivered', label: 'Terkirim' },
]

const TRACKING_COURIER_CODES = ['jne', 'jnt', 'sicepat', 'pos', 'tiki', 'anteraja']
const COURIERS = [
  { label: 'Auto Deteksi', value: 'auto' },
  { label: 'JNE', value: 'jne' },
  { label: 'J&T', value: 'jnt' },
  { label: 'SiCepat', value: 'sicepat' },
  { label: 'POS Indonesia', value: 'pos' },
  { label: 'TIKI', value: 'tiki' },
  { label: 'AnterAja', value: 'anteraja' },
]

const DEFAULT_MAP_CENTER = [-6.2, 106.816666]

const statusVariant = {
  picked_up: 'warning',
  in_transit: 'info',
  out_for_delivery: 'warning',
  delivered: 'success',
}

const buildFriendlyApiMessage = (rawMessage) => {
  const message = String(rawMessage || '').trim()
  const normalized = message.toLowerCase()

  if (
    normalized.includes('invalid api key') ||
    normalized.includes('key not found')
  ) {
    return 'API key tidak cocok dengan endpoint tracking. Gunakan RAJAONGKIR_SHIPPING_COST_API_KEY untuk Tracking AWB umum dan RAJAONGKIR_SHIPPING_DELIVERY_API_KEY untuk history-airway-bill.'
  }

  if (normalized.includes('belum diset') || normalized.includes('not set')) {
    if (normalized.includes('shipping_cost_api_key')) {
      return 'RAJAONGKIR_SHIPPING_COST_API_KEY belum diset. Tambahkan key Shipping Cost di .env.local lalu restart npm run dev.'
    }

    if (normalized.includes('shipping_delivery_api_key')) {
      return 'RAJAONGKIR_SHIPPING_DELIVERY_API_KEY belum diset. Tambahkan key Shipping Delivery di .env.local lalu restart npm run dev.'
    }

    return 'RAJAONGKIR_API_KEY belum diset. Tambahkan key di file .env.local lalu restart npm run dev.'
  }

  if (
    normalized.includes('invalid cnote/airway bill') ||
    normalized.includes('awb not found') ||
    normalized.includes('checking awb not found')
  ) {
    return 'Nomor resi tidak ditemukan oleh kurir. Cek kembali resi dan kurir yang dipilih.'
  }

  if (normalized.includes('endpoint api ini sudah tidak aktif')) {
    return 'Endpoint RajaOngkir lama sudah nonaktif. Gunakan endpoint baru RajaOngkir by Komerce.'
  }

  return message || 'Terjadi kesalahan saat mengambil data tracking.'
}

const firstFilledValue = (...values) =>
  values.find((value) => {
    if (typeof value === 'string') {
      return value.trim().length > 0
    }

    return value !== null && value !== undefined
  })

const asArray = (value) => (Array.isArray(value) ? value : [])
const hasFailedApiStatus = (status) => ['failed', 'error'].includes(status)
const isInvalidKeyMessage = (rawMessage) =>
  String(rawMessage || '').toLowerCase().includes('key not found') ||
  String(rawMessage || '').toLowerCase().includes('invalid api key')

const inferStepIndex = (statusText) => {
  const normalized = String(statusText).toLowerCase()

  if (normalized.includes('delivered') || normalized.includes('terkirim')) {
    return 3
  }

  if (
    normalized.includes('out for delivery') ||
    normalized.includes('diantar') ||
    normalized.includes('kurir')
  ) {
    return 2
  }

  if (
    normalized.includes('transit') ||
    normalized.includes('sortir') ||
    normalized.includes('dikirim')
  ) {
    return 1
  }

  return 0
}

const inferStatusKey = (stepIndex) => {
  if (stepIndex >= 3) {
    return 'delivered'
  }

  if (stepIndex === 2) {
    return 'out_for_delivery'
  }

  if (stepIndex === 1) {
    return 'in_transit'
  }

  return 'picked_up'
}

const normalizeTrackingResponse = (responsePayload, requestedAwb, courierCode) => {
  const root =
    responsePayload?.data?.result ??
    responsePayload?.data ??
    responsePayload?.result ??
    responsePayload?.results ??
    responsePayload

  const summary = root?.summary ?? root?.waybill?.summary ?? {}
  const details = root?.details ?? root?.waybill?.details ?? {}
  const deliveryStatus =
    root?.delivery_status ?? root?.deliveryStatus ?? root?.status_detail ?? {}

  const rawManifest = asArray(
    root?.manifest ?? root?.history ?? root?.tracking ?? root?.events ?? root?.waybill?.manifest,
  )

  const parsedManifest = rawManifest
    .map((item) => {
      const date = firstFilledValue(
        item?.manifest_date,
        item?.date,
        item?.datetime,
        item?.updated_at,
        item?.timestamp,
      )
      const time = firstFilledValue(item?.manifest_time, item?.time)
      const timestamp = [date, time].filter(Boolean).join(' ').trim()

      return {
        timestamp: timestamp || '-',
        location: firstFilledValue(
          item?.city_name,
          item?.city,
          item?.location,
          item?.manifest_city,
          item?.warehouse_name,
          'Lokasi tidak tersedia',
        ),
        description: firstFilledValue(
          item?.manifest_description,
          item?.description,
          item?.status,
          item?.desc,
          'Update perjalanan paket',
        ),
      }
    })
    .filter((item) => item.location || item.description)

  if (parsedManifest.length > 1) {
    const firstDate = Date.parse(parsedManifest[0].timestamp)
    const lastDate = Date.parse(parsedManifest[parsedManifest.length - 1].timestamp)

    if (!Number.isNaN(firstDate) && !Number.isNaN(lastDate) && firstDate < lastDate) {
      parsedManifest.reverse()
    }
  }

  const fallbackStatus = firstFilledValue(
    deliveryStatus?.status,
    summary?.status,
    parsedManifest[0]?.description,
    'Dalam proses',
  )

  const stepIndex = inferStepIndex(fallbackStatus)
  const statusKey = inferStatusKey(stepIndex)
  const trackingNumber = String(
    firstFilledValue(
      summary?.waybill_number,
      details?.waybill_number,
      root?.waybill_number,
      requestedAwb,
    ),
  ).toUpperCase()

  const origin = firstFilledValue(details?.origin, summary?.origin, root?.origin, '-')
  const destination = firstFilledValue(
    details?.destination,
    summary?.destination,
    root?.destination,
    '-',
  )

  const latestLocation = firstFilledValue(
    parsedManifest[0]?.location,
    deliveryStatus?.pod_receiver,
    destination,
    origin,
    '-',
  )

  const updatedAt = firstFilledValue(
    parsedManifest[0]?.timestamp,
    root?.updated_at,
    summary?.waybill_date,
    '-',
  )

  const eta = firstFilledValue(
    summary?.estimated_delivery,
    summary?.eta,
    deliveryStatus?.pod_date ? `Diterima ${deliveryStatus.pod_date}` : null,
    '-',
  )

  const sender = firstFilledValue(
    details?.shipper_name,
    details?.shipper,
    summary?.shipper_name,
    '-',
  )

  const recipient = firstFilledValue(
    details?.receiver_name,
    details?.receiver,
    summary?.receiver_name,
    '-',
  )

  const weightValue = firstFilledValue(details?.weight, summary?.weight, root?.weight)
  const weight = weightValue ? `${weightValue} gram` : '-'

  const events =
    parsedManifest.length > 0
      ? parsedManifest
      : [
          {
            timestamp: updatedAt,
            location: latestLocation,
            description: String(fallbackStatus),
          },
        ]

  return {
    trackingNumber,
    courierName: String(
      firstFilledValue(summary?.courier_name, summary?.courier_code, courierCode),
    ).toUpperCase(),
    status: String(fallbackStatus),
    statusKey,
    stepIndex,
    eta: String(eta),
    updatedAt: String(updatedAt),
    sender: String(sender),
    recipient: String(recipient),
    origin: String(origin),
    destination: String(destination),
    latestLocation: String(latestLocation),
    weight: String(weight),
    events,
    source: 'shipping-cost',
  }
}

const normalizeDeliveryHistoryResponse = (responsePayload, requestedAwb, courierCode) => {
  const root = responsePayload?.data ?? {}
  const rawHistory = asArray(root?.history)
  const parsedHistory = rawHistory
    .map((item) => ({
      timestamp: String(firstFilledValue(item?.date, item?.datetime, '-')),
      location: String(firstFilledValue(item?.status, item?.code, 'Riwayat kurir')),
      description: String(
        firstFilledValue(item?.desc, item?.description, item?.status, 'Update perjalanan paket'),
      ),
    }))
    .filter((item) => item.description)

  if (parsedHistory.length > 1) {
    const firstDate = Date.parse(parsedHistory[0].timestamp)
    const lastDate = Date.parse(parsedHistory[parsedHistory.length - 1].timestamp)

    if (!Number.isNaN(firstDate) && !Number.isNaN(lastDate) && firstDate < lastDate) {
      parsedHistory.reverse()
    }
  }

  const fallbackStatus = firstFilledValue(
    root?.last_status,
    parsedHistory[0]?.description,
    'Dalam proses',
  )
  const stepIndex = inferStepIndex(fallbackStatus)
  const statusKey = inferStatusKey(stepIndex)
  const latestLocation = firstFilledValue(parsedHistory[0]?.location, '-')
  const updatedAt = firstFilledValue(parsedHistory[0]?.timestamp, '-')

  const events =
    parsedHistory.length > 0
      ? parsedHistory
      : [
          {
            timestamp: String(updatedAt),
            location: String(latestLocation),
            description: String(fallbackStatus),
          },
        ]

  return {
    trackingNumber: String(firstFilledValue(root?.airway_bill, requestedAwb)).toUpperCase(),
    courierName: String(courierCode).toUpperCase(),
    status: String(fallbackStatus),
    statusKey,
    stepIndex,
    eta: '-',
    updatedAt: String(updatedAt),
    sender: '-',
    recipient: '-',
    origin: '-',
    destination: '-',
    latestLocation: String(latestLocation),
    weight: '-',
    events,
    source: 'shipping-delivery',
  }
}

const geocodeLocation = async (locationText) => {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=id&q=${encodeURIComponent(locationText)}`,
    { headers: { 'Accept-Language': 'id' } },
  )

  if (!response.ok) {
    throw new Error('Gagal mengubah lokasi menjadi koordinat peta.')
  }

  const results = await response.json()

  if (!results.length) {
    return null
  }

  return {
    lat: Number(results[0].lat),
    lng: Number(results[0].lon),
  }
}

function FitMapBounds({ points }) {
  const map = useMap()

  useEffect(() => {
    if (!points.length) {
      return
    }

    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 10)
      return
    }

    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng]))
    map.fitBounds(bounds, { padding: [28, 28] })
  }, [map, points])

  return null
}

function App() {
  const [trackingInput, setTrackingInput] = useState('')
  const [courier, setCourier] = useState('auto')
  const [activeShipment, setActiveShipment] = useState(null)
  const [mapPoints, setMapPoints] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [isMapLoading, setIsMapLoading] = useState(false)
  const [feedback, setFeedback] = useState({
    type: 'neutral',
    text: 'Masukkan nomor resi dan pilih kurir untuk mengambil data tracking real-time.',
  })

  const activeStepIndex = useMemo(
    () => (activeShipment ? activeShipment.stepIndex : -1),
    [activeShipment],
  )

  const mapCenter = useMemo(() => {
    if (!mapPoints.length) {
      return DEFAULT_MAP_CENTER
    }

    const totalLat = mapPoints.reduce((sum, point) => sum + point.lat, 0)
    const totalLng = mapPoints.reduce((sum, point) => sum + point.lng, 0)

    return [totalLat / mapPoints.length, totalLng / mapPoints.length]
  }, [mapPoints])

  const resolveMapPoints = async (shipment) => {
    setIsMapLoading(true)

    try {
      const candidates = [
        { title: 'Asal', value: shipment.origin },
        { title: 'Posisi Terakhir', value: shipment.latestLocation },
        { title: 'Tujuan', value: shipment.destination },
      ]
        .filter((item) => item.value && item.value !== '-')
        .filter(
          (item, index, array) =>
            array.findIndex(
              (candidate) =>
                candidate.value.toLowerCase() === item.value.toLowerCase(),
            ) === index,
        )

      const points = []
      let hasMapError = false

      for (const candidate of candidates) {
        try {
          const coordinates = await geocodeLocation(`${candidate.value}, Indonesia`)
          if (coordinates) {
            points.push({
              ...coordinates,
              label: `${candidate.title}: ${candidate.value}`,
            })
          }
        } catch {
          hasMapError = true
        }
      }

      setMapPoints(points)
      if (hasMapError) {
        setFeedback({
          type: 'neutral',
          text: 'Data tracking berhasil dimuat, namun sebagian titik peta tidak ditemukan.',
        })
      }
    } finally {
      setIsMapLoading(false)
    }
  }

  const fetchShippingCostTracking = async (trackingNumber, courierCode) => {
    const query = new URLSearchParams({
      awb: trackingNumber,
      courier: courierCode,
    })

    const response = await fetch(`/api/rajaongkir/track/waybill?${query.toString()}`, {
      method: 'POST',
    })

    const payload = await response.json().catch(() => ({}))
    const apiStatus = String(payload?.meta?.status ?? '').toLowerCase()

    if (!response.ok || hasFailedApiStatus(apiStatus)) {
      throw new Error(
        String(
          firstFilledValue(
            payload?.meta?.message,
            payload?.message,
            'Gagal mengambil data tracking dari Shipping Cost API.',
          ),
        ),
      )
    }

    return normalizeTrackingResponse(payload, trackingNumber, courierCode)
  }

  const fetchShippingDeliveryTracking = async (trackingNumber, courierCode) => {
    const query = new URLSearchParams({
      shipping: courierCode,
      airway_bill: trackingNumber,
    })

    const response = await fetch(
      `/api/shipping-delivery/orders/history-airway-bill?${query.toString()}`,
      {
        method: 'GET',
      },
    )

    const payload = await response.json().catch(() => ({}))
    const apiStatus = String(payload?.meta?.status ?? '').toLowerCase()

    if (!response.ok || hasFailedApiStatus(apiStatus)) {
      throw new Error(
        String(
          firstFilledValue(
            payload?.meta?.message,
            payload?.message,
            'Gagal mengambil data tracking dari Shipping Delivery API.',
          ),
        ),
      )
    }

    return normalizeDeliveryHistoryResponse(payload, trackingNumber, courierCode)
  }

  const tryTrackingAcrossCouriers = async (
    trackingFetcher,
    trackingNumber,
    courierCandidates,
  ) => {
    let lastError = null

    for (const courierCode of courierCandidates) {
      try {
        return await trackingFetcher(trackingNumber, courierCode)
      } catch (error) {
        lastError = error
        const rawMessage = error instanceof Error ? error.message : ''
        const normalizedMessage = rawMessage.toLowerCase()

        if (
          isInvalidKeyMessage(rawMessage) ||
          normalizedMessage.includes('belum diset') ||
          normalizedMessage.includes('not set')
        ) {
          throw error
        }
      }
    }

    throw (
      lastError ?? new Error('Nomor resi tidak ditemukan untuk kurir yang dipilih.')
    )
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const trimmedTracking = trackingInput.trim()

    if (!trimmedTracking) {
      setFeedback({ type: 'error', text: 'Nomor resi wajib diisi.' })
      return
    }

    setIsLoading(true)
    setActiveShipment(null)
    setMapPoints([])
    setFeedback({
      type: 'neutral',
      text: 'Mengambil data tracking real-time...',
    })

    try {
      const courierCandidates =
        courier === 'auto' ? TRACKING_COURIER_CODES : [courier]

      let normalizedShipment = null
      let shippingCostError = null

      try {
        normalizedShipment = await tryTrackingAcrossCouriers(
          fetchShippingCostTracking,
          trimmedTracking,
          courierCandidates,
        )
      } catch (costError) {
        shippingCostError = costError
      }

      if (!normalizedShipment) {
        try {
          normalizedShipment = await tryTrackingAcrossCouriers(
            fetchShippingDeliveryTracking,
            trimmedTracking,
            courierCandidates,
          )
        } catch (deliveryError) {
          throw shippingCostError ?? deliveryError
        }
      }

      setActiveShipment(normalizedShipment)
      const sourceLabel =
        normalizedShipment.source === 'shipping-delivery'
          ? 'Shipping Delivery API'
          : 'Shipping Cost API'
      setFeedback({
        type: 'success',
        text: `Data tracking untuk resi ${normalizedShipment.trackingNumber} berhasil dimuat (${sourceLabel}, kurir: ${normalizedShipment.courierName}).`,
      })
      await resolveMapPoints(normalizedShipment)
    } catch (error) {
      const rawErrorMessage =
        error instanceof Error
          ? error.message
          : 'Terjadi kesalahan saat mengambil data tracking.'

      setFeedback({
        type: 'error',
        text: buildFriendlyApiMessage(rawErrorMessage),
      })
      setActiveShipment(null)
      setMapPoints([])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="app-shell">
      <div className="bg-accent"></div>
      <header className="top-bar">
        <p className="brand">Traccking Paket</p>
        <span className="tag">Realtime RajaOngkir + Map</span>
      </header>

      <main className="dashboard">
        <section className="panel hero-panel">
          <h1>Lacak paket real-time dengan peta perjalanan.</h1>
          <p className="hero-text">
            Data diambil langsung dari API RajaOngkir by Komerce dan dipetakan
            ke lokasi aktual menggunakan OpenStreetMap.
          </p>

          <form className="tracking-form" onSubmit={handleSubmit}>
            <div className="field-stack">
              <label htmlFor="tracking-number">Nomor Resi</label>
              <input
                id="tracking-number"
                type="text"
                value={trackingInput}
                onChange={(event) => setTrackingInput(event.target.value)}
                placeholder="Contoh: JNE1234567890"
                aria-label="Nomor resi"
              />
            </div>

            <div className="field-stack courier-field">
              <label htmlFor="courier">Kurir</label>
              <select
                id="courier"
                value={courier}
                onChange={(event) => setCourier(event.target.value)}
              >
                {COURIERS.map((courierOption) => (
                  <option key={courierOption.value} value={courierOption.value}>
                    {courierOption.label}
                  </option>
                ))}
              </select>
            </div>

            <button type="submit" disabled={isLoading}>
              {isLoading ? 'Melacak...' : 'Lacak Paket'}
            </button>
          </form>

          <p className={`feedback ${feedback.type}`}>{feedback.text}</p>
          <p className="api-note">
            Sumber data: RajaOngkir by Komerce API. Data tampil sesuai respons
            langsung dari provider.
          </p>
        </section>

        <section className="content-grid">
          <article className="panel summary-panel">
            <h2>Ringkasan Pengiriman</h2>

            {activeShipment ? (
              <>
                <div className="summary-head">
                  <span
                    className={`status-badge ${statusVariant[activeShipment.statusKey] ?? 'info'}`}
                  >
                    {activeShipment.status}
                  </span>
                  <span className="eta">Estimasi: {activeShipment.eta}</span>
                </div>

                <p className="tracking-title">
                  {activeShipment.trackingNumber} · {activeShipment.courierName}
                </p>

                <div className="meta-grid">
                  <div>
                    <p className="meta-label">Pengirim</p>
                    <p>{activeShipment.sender}</p>
                  </div>
                  <div>
                    <p className="meta-label">Penerima</p>
                    <p>{activeShipment.recipient}</p>
                  </div>
                  <div>
                    <p className="meta-label">Rute</p>
                    <p>
                      {activeShipment.origin} → {activeShipment.destination}
                    </p>
                  </div>
                  <div>
                    <p className="meta-label">Berat</p>
                    <p>{activeShipment.weight}</p>
                  </div>
                </div>

                <ol className="stepper">
                  {DELIVERY_STEPS.map((step, index) => {
                    const isComplete = activeStepIndex >= 0 && index <= activeStepIndex
                    return (
                      <li key={step.key} className={isComplete ? 'step complete' : 'step'}>
                        <span>{step.label}</span>
                      </li>
                    )
                  })}
                </ol>

                <p className="updated-at">
                  Terakhir diperbarui: {activeShipment.updatedAt}
                </p>
              </>
            ) : (
              <p className="empty-state">
                Data tracking akan tampil di sini setelah pencarian berhasil.
              </p>
            )}
          </article>

          <article className="panel map-panel">
            <h3>Peta Perjalanan Paket</h3>
            <div className="map-shell">
              <MapContainer
                center={mapCenter}
                zoom={mapPoints.length > 0 ? 6 : 5}
                scrollWheelZoom={false}
              >
                <TileLayer
                  attribution="&copy; OpenStreetMap contributors"
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {mapPoints.length > 0 ? <FitMapBounds points={mapPoints} /> : null}
                {mapPoints.map((point) => (
                  <Marker key={point.label} position={[point.lat, point.lng]}>
                    <Popup>{point.label}</Popup>
                  </Marker>
                ))}
                {mapPoints.length > 1 ? (
                  <Polyline positions={mapPoints.map((point) => [point.lat, point.lng])} />
                ) : null}
              </MapContainer>

              {mapPoints.length === 0 ? (
                <div className="map-overlay">
                  {isMapLoading
                    ? 'Menentukan titik lokasi di peta...'
                    : 'Peta aktif. Lokasi perjalanan akan muncul setelah tracking berhasil.'}
                </div>
              ) : null}
            </div>
          </article>

          <article className="panel timeline-panel">
            <h3>Riwayat Tracking</h3>
            {activeShipment ? (
              <ol className="timeline">
                {activeShipment.events.map((event, index) => (
                  <li
                    key={`${event.timestamp}-${event.description}-${index}`}
                    className="timeline-item"
                  >
                    <div className="timeline-dot" aria-hidden="true"></div>
                    <div>
                      <p className="timeline-time">
                        {event.timestamp} · {event.location}
                      </p>
                      <p className={index === 0 ? 'timeline-title latest' : 'timeline-title'}>
                        {event.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="empty-state">Belum ada riwayat tracking untuk ditampilkan.</p>
            )}
          </article>
        </section>
      </main>
    </div>
  )
}

export default App
