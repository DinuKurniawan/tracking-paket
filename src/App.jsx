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
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import { Select } from './components/ui/select'
import { cn } from './lib/utils'

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
  { label: 'Deteksi Otomatis', value: 'auto' },
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
    return 'Kunci API tidak cocok dengan endpoint pelacakan. Gunakan RAJAONGKIR_SHIPPING_COST_API_KEY untuk pelacakan AWB umum dan RAJAONGKIR_SHIPPING_DELIVERY_API_KEY untuk history-airway-bill.'
  }

  if (normalized.includes('belum diset') || normalized.includes('not set')) {
    if (normalized.includes('shipping_cost_api_key')) {
      return 'RAJAONGKIR_SHIPPING_COST_API_KEY belum diset. Tambahkan kunci API Shipping Cost di .env.local lalu restart npm run dev.'
    }

    if (normalized.includes('shipping_delivery_api_key')) {
      return 'RAJAONGKIR_SHIPPING_DELIVERY_API_KEY belum diset. Tambahkan kunci API Shipping Delivery di .env.local lalu restart npm run dev.'
    }

    return 'RAJAONGKIR_API_KEY belum diset. Tambahkan kunci API di file .env.local lalu restart npm run dev.'
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

  return message || 'Terjadi kesalahan saat mengambil data pelacakan.'
}

const firstFilledValue = (...values) =>
  values.find((value) => {
    if (typeof value === 'string') {
      return value.trim().length > 0
    }

    return value !== null && value !== undefined
  })

const asArray = (value) => (Array.isArray(value) ? value : [])
const LOCATION_NOT_AVAILABLE = 'Lokasi tidak tersedia'
const hasFailedApiStatus = (status) => ['failed', 'error'].includes(status)
const isInvalidKeyMessage = (rawMessage) =>
  String(rawMessage || '').toLowerCase().includes('key not found') ||
  String(rawMessage || '').toLowerCase().includes('invalid api key')
const sanitizeText = (value) => String(value ?? '').trim()
const sanitizeLocationText = (value) => {
  const text = sanitizeText(value)
  if (
    !text ||
    text === '-' ||
    text.toLowerCase() === 'null' ||
    text.toLowerCase() === LOCATION_NOT_AVAILABLE.toLowerCase()
  ) {
    return ''
  }

  return text
}
const isMaskedPersonName = (value) => /\*{2,}/.test(sanitizeText(value))
const extractNameFromAddress = (addressValue) => {
  const address = sanitizeText(addressValue)
  if (!address || address === '-') {
    return ''
  }

  const firstPart = address.split(',')[0]?.trim() ?? ''
  if (firstPart.length < 3 || isMaskedPersonName(firstPart) || /\d/.test(firstPart)) {
    return ''
  }

  const normalized = firstPart.toLowerCase()
  const streetHints = ['jl', 'jalan', 'gang', 'blok', 'komplek', 'rt', 'rw', 'no']
  if (streetHints.some((hint) => normalized === hint || normalized.startsWith(`${hint} `))) {
    return ''
  }

  return firstPart
}
const pickBestPersonName = (...values) => {
  const candidates = values
    .map((value) => sanitizeText(value))
    .filter((value) => value.length > 0 && value !== '-')

  if (!candidates.length) {
    return '-'
  }

  const unmaskedName = candidates.find((value) => !isMaskedPersonName(value))
  return unmaskedName ?? candidates[0]
}
const cleanLocationLabel = (locationText) =>
  sanitizeLocationText(locationText)
    .replace(/\*{2,}/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim()
const joinAddressParts = (...parts) => {
  const uniqueParts = []

  for (const part of parts) {
    const cleanedPart = cleanLocationLabel(part)
    if (!cleanedPart) {
      continue
    }

    const normalized = cleanedPart.toLowerCase()
    if (!uniqueParts.some((item) => item.toLowerCase() === normalized)) {
      uniqueParts.push(cleanedPart)
    }
  }

  return uniqueParts.join(', ')
}
const buildLocationQueries = (locationText) => {
  const cleaned = cleanLocationLabel(locationText)
  if (!cleaned) {
    return []
  }

  const firstSegment = cleaned.split(/[;|/]/)[0]?.trim()
  const dashParts = cleaned.split('-').map((part) => part.trim()).filter(Boolean)
  const firstDashSegment = dashParts[0]
  const lastDashSegment = dashParts.length ? dashParts[dashParts.length - 1] : ''
  const commaParts = cleaned
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const cityAndProvince =
    commaParts.length >= 2 ? commaParts.slice(-2).join(', ') : ''
  const cityOnly = commaParts.length ? commaParts[commaParts.length - 1] : ''

  const queries = [
    cleaned,
    firstSegment,
    firstDashSegment,
    lastDashSegment,
    cityAndProvince,
    cityOnly,
  ]
    .map((value) => sanitizeLocationText(value))
    .filter(Boolean)

  return [...new Map(queries.map((value) => [value.toLowerCase(), value])).values()]
}
const isGeocodableLocation = (value) => {
  const location = sanitizeLocationText(value).toLowerCase()
  if (!location) {
    return false
  }

  const statusKeywords = [
    'paket',
    'status',
    'dikirim',
    'diterima',
    'proses',
    'kurir',
    'transit',
    'delivery',
    'delivered',
  ]
  const hasStatusKeyword = statusKeywords.some((keyword) => location.includes(keyword))
  const hasLocationHint =
    location.includes(',') ||
    location.includes('kota') ||
    location.includes('kab') ||
    location.includes('kec') ||
    location.includes('prov')
  const hasLocationPhrase = /\b(di|kota|kab|kec|prov|jl|jalan)\b/.test(location)

  if (hasStatusKeyword && !hasLocationHint && !hasLocationPhrase) {
    return false
  }

  return true
}

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
          LOCATION_NOT_AVAILABLE,
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

  const origin = firstFilledValue(
    details?.origin,
    details?.shipper_city,
    summary?.origin,
    root?.origin,
    root?.shipper_city,
    '-',
  )
  const destination = firstFilledValue(
    details?.destination,
    details?.receiver_city,
    summary?.destination,
    root?.destination,
    root?.receiver_city,
    '-',
  )
  const originAddress = joinAddressParts(
    details?.shipper_address1,
    details?.shipper_address2,
    details?.shipper_address3,
    details?.shipper_city,
    origin,
  )
  const destinationAddress = joinAddressParts(
    details?.receiver_address1,
    details?.receiver_address2,
    details?.receiver_address3,
    details?.receiver_city,
    destination,
  )

  const latestLocation = firstFilledValue(
    sanitizeLocationText(parsedManifest[0]?.location),
    deliveryStatus?.pod_city,
    deliveryStatus?.city_name,
    deliveryStatus?.pod_location,
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

  const sender = pickBestPersonName(
    details?.shipper,
    details?.shipper_name,
    summary?.shipper_name,
    root?.shipper_name,
    root?.sender_name,
  )

  const recipient = pickBestPersonName(
    details?.receiver,
    details?.receiver_name,
    summary?.receiver_name,
    root?.receiver_name,
    root?.recipient_name,
    deliveryStatus?.pod_receiver,
  )
  const senderFromAddress = extractNameFromAddress(
    firstFilledValue(
      details?.shipper_address1,
      details?.shipper_address2,
      details?.shipper_address3,
    ),
  )
  const recipientFromAddress = extractNameFromAddress(
    firstFilledValue(
      details?.receiver_address1,
      details?.receiver_address2,
      details?.receiver_address3,
    ),
  )
  const resolvedSender =
    isMaskedPersonName(sender) && senderFromAddress ? senderFromAddress : sender
  const resolvedRecipient =
    isMaskedPersonName(recipient) && recipientFromAddress
      ? recipientFromAddress
      : recipient

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
    sender: String(resolvedSender),
    recipient: String(resolvedRecipient),
    origin: String(origin),
    destination: String(destination),
    originAddress: originAddress || String(origin),
    destinationAddress: destinationAddress || String(destination),
    recipientAddressDetail: buildRecipientAddressDetail({}, destinationAddress || String(destination)),
    latestLocation: String(latestLocation),
    weight: String(weight),
    events,
    source: 'shipping-cost',
  }
}

const normalizeDeliveryHistoryResponse = (responsePayload, requestedAwb, courierCode) => {
  const root = responsePayload?.data ?? responsePayload?.result ?? {}
  const rawHistory = asArray(root?.history)
  const parsedHistory = rawHistory
    .map((item) => ({
      timestamp: String(firstFilledValue(item?.date, item?.datetime, '-')),
      location: String(
        firstFilledValue(
          item?.location,
          item?.city_name,
          item?.city,
          item?.district,
          item?.subdistrict,
          item?.branch,
          item?.branch_name,
          item?.warehouse_name,
          item?.manifest_city,
          LOCATION_NOT_AVAILABLE,
        ),
      ),
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
  const latestLocation = firstFilledValue(
    sanitizeLocationText(parsedHistory[0]?.location),
    root?.last_location,
    root?.destination,
    root?.destination_city,
    root?.receiver_city,
    root?.sender_city,
    '-',
  )
  const updatedAt = firstFilledValue(parsedHistory[0]?.timestamp, '-')
  const sender = pickBestPersonName(
    root?.sender_name,
    root?.shipper_name,
    root?.sender,
    root?.shipper,
  )
  const recipient = pickBestPersonName(
    root?.receiver_name,
    root?.recipient_name,
    root?.receiver,
    root?.recipient,
  )
  const origin = firstFilledValue(root?.origin, root?.origin_city, root?.sender_city, '-')
  const destination = firstFilledValue(
    root?.destination,
    root?.destination_city,
    root?.receiver_city,
    '-',
  )
  const originAddress = joinAddressParts(
    root?.sender_address,
    root?.shipper_address,
    root?.origin_address,
    root?.sender_city,
    origin,
  )
  const destinationAddress = joinAddressParts(
    root?.receiver_address,
    root?.recipient_address,
    root?.destination_address,
    root?.receiver_city,
    destination,
  )

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
    sender: String(sender),
    recipient: String(recipient),
    origin: String(origin),
    destination: String(destination),
    originAddress: originAddress || String(origin),
    destinationAddress: destinationAddress || String(destination),
    recipientAddressDetail: buildRecipientAddressDetail({}, destinationAddress || String(destination)),
    latestLocation: String(latestLocation),
    weight: '-',
    events,
    source: 'shipping-delivery',
  }
}

const geocodeLocation = async (locationText) => {
  const queries = buildLocationQueries(locationText)

  for (const query of queries) {
    const normalizedQuery = query.toLowerCase().includes('indonesia')
      ? query
      : `${query}, Indonesia`
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=3&countrycodes=id&q=${encodeURIComponent(normalizedQuery)}`,
      { headers: { 'Accept-Language': 'id' } },
    )

    if (!response.ok) {
      throw new Error('Gagal mengubah lokasi menjadi koordinat peta.')
    }

    const results = await response.json()
    if (!results.length) {
      continue
    }

    const preferredResult =
      results.find((result) =>
        String(result?.display_name ?? '')
          .toLowerCase()
          .includes('indonesia'),
      ) ?? results[0]

    return {
      lat: Number(preferredResult.lat),
      lng: Number(preferredResult.lon),
    }
  }

  return null
}

const extractByRegex = (text, regex) => {
  const match = String(text ?? '').match(regex)
  return match?.[1]?.trim() || ''
}

const buildRecipientAddressDetail = (address = {}, fallbackText = '') => {
  const fullText = [fallbackText, address?.display_name].filter(Boolean).join(' ')
  const road = firstFilledValue(
    [address?.house_number, address?.road].filter(Boolean).join(' ').trim(),
    address?.pedestrian,
    address?.residential,
    '-',
  )
  const rt = extractByRegex(fullText, /\bRT[\s.:/-]*([0-9]{1,3})\b/i) || '-'
  const rw = extractByRegex(fullText, /\bRW[\s.:/-]*([0-9]{1,3})\b/i) || '-'
  const kelurahan = firstFilledValue(
    address?.suburb,
    address?.quarter,
    address?.village,
    address?.hamlet,
    '-',
  )
  const kecamatan = firstFilledValue(address?.city_district, address?.municipality, address?.county, '-')
  const kodePos = firstFilledValue(address?.postcode, '-')

  return {
    road: String(road),
    rt: String(rt),
    rw: String(rw),
    kelurahan: String(kelurahan),
    kecamatan: String(kecamatan),
    kodePos: String(kodePos),
  }
}

const reverseGeocodeRecipient = async (lat, lng, fallbackText = '') => {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`,
    { headers: { 'Accept-Language': 'id' } },
  )

  if (!response.ok) {
    return buildRecipientAddressDetail({}, fallbackText)
  }

  const payload = await response.json().catch(() => ({}))
  return buildRecipientAddressDetail(payload?.address ?? {}, payload?.display_name ?? fallbackText)
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

    const recipientPoint = points.find((point) => point.role === 'destination')
    if (recipientPoint) {
      map.setView([recipientPoint.lat, recipientPoint.lng], 13)
      return
    }

    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng]))
    map.fitBounds(bounds, { padding: [28, 28] })
  }, [map, points])

  return null
}

function EnsureMapVisible() {
  const map = useMap()

  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize()
    }, 0)

    return () => clearTimeout(timer)
  }, [map])

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
    text: 'Masukkan nomor resi dan pilih kurir untuk mengambil data pelacakan waktu nyata.',
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
        { title: 'Asal', source: 'origin-address', value: shipment.originAddress },
        { title: 'Asal', source: 'origin', value: shipment.origin },
        { title: 'Posisi Terakhir', source: 'latest', value: shipment.latestLocation },
        { title: 'Tujuan', source: 'destination-address', value: shipment.destinationAddress },
        { title: 'Tujuan', source: 'destination', value: shipment.destination },
        ...asArray(shipment.events).slice(0, 6).map((event, index) => ({
          title: index === 0 ? 'Riwayat Terbaru' : 'Riwayat',
          source: 'event',
          value: event?.location || event?.description,
        })),
      ]
        .map((item) => ({
          ...item,
          value: cleanLocationLabel(item.value),
        }))
        .filter((item) => isGeocodableLocation(item.value))
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
          const coordinates = await geocodeLocation(candidate.value)
          if (coordinates) {
            const role =
              candidate.source === 'destination-address' || candidate.source === 'destination'
                ? 'destination'
                : candidate.source === 'origin-address' || candidate.source === 'origin'
                  ? 'origin'
                  : candidate.source === 'latest'
                    ? 'latest'
                    : 'event'
            points.push({
              ...coordinates,
              role,
              label: `${candidate.title}: ${candidate.value}`,
            })
          }
        } catch {
          hasMapError = true
        }
      }

      const fallbackOrigin = firstFilledValue(
        sanitizeLocationText(shipment.originAddress),
        sanitizeLocationText(shipment.origin),
        candidates.find((item) => item.source === 'origin-address')?.value,
        candidates.find((item) => item.source === 'origin')?.value,
        candidates.find((item) => item.source === 'event')?.value,
        '-',
      )
      const fallbackDestination = firstFilledValue(
        sanitizeLocationText(shipment.destinationAddress),
        sanitizeLocationText(shipment.destination),
        candidates.find((item) => item.source === 'destination-address')?.value,
        candidates.find((item) => item.source === 'destination')?.value,
        candidates.find((item) => item.source === 'latest')?.value,
        [...candidates].reverse().find((item) => item.source === 'event')?.value,
        '-',
      )
      const fallbackLatest = firstFilledValue(
        sanitizeLocationText(shipment.latestLocation),
        candidates.find((item) => item.source === 'latest')?.value,
        candidates.find((item) => item.source === 'event')?.value,
        fallbackDestination,
        '-',
      )
      const destinationPoint = points.find((point) => point.role === 'destination')
      const recipientAddressDetail = destinationPoint
        ? await reverseGeocodeRecipient(
            destinationPoint.lat,
            destinationPoint.lng,
            String(fallbackDestination),
          )
        : buildRecipientAddressDetail({}, String(fallbackDestination))
      const enrichedShipment = {
        ...shipment,
        origin: String(fallbackOrigin),
        destination: String(fallbackDestination),
        originAddress: String(fallbackOrigin),
        destinationAddress: String(fallbackDestination),
        latestLocation: String(fallbackLatest),
        recipientAddressDetail,
      }

      setMapPoints(points)
      if (!points.length && !hasMapError) {
        setFeedback({
          type: 'neutral',
          text: 'Alamat detail pada data resi belum tersedia, sehingga titik peta belum bisa dipastikan.',
        })
      } else if (hasMapError) {
        setFeedback({
          type: 'neutral',
          text: 'Data pelacakan berhasil dimuat, namun sebagian titik peta tidak ditemukan.',
        })
      }
      return enrichedShipment
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
            'Gagal mengambil data pelacakan dari API Shipping Cost.',
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
            'Gagal mengambil data pelacakan dari API Shipping Delivery.',
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
      text: 'Mengambil data pelacakan waktu nyata...',
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
          ? 'API Shipping Delivery'
          : 'API Shipping Cost'
      setFeedback({
        type: 'success',
        text: `Data pelacakan untuk resi ${normalizedShipment.trackingNumber} berhasil dimuat (${sourceLabel}, kurir: ${normalizedShipment.courierName}).`,
      })
      const shipmentWithResolvedAddress = await resolveMapPoints(normalizedShipment)
      setActiveShipment(shipmentWithResolvedAddress)
    } catch (error) {
      const rawErrorMessage =
        error instanceof Error
          ? error.message
          : 'Terjadi kesalahan saat mengambil data pelacakan.'

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
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-8">
        <header className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Pelacakan Paket</p>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
              Dashboard Pelacakan Resi
            </h1>
          </div>
          <Badge variant="outline" className="w-fit">
            Waktu Nyata RajaOngkir + Peta
          </Badge>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Lacak Paket</CardTitle>
            <CardDescription>
              Gunakan nomor resi untuk menampilkan ringkasan, peta koordinat, dan riwayat pengiriman.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="grid gap-3 md:grid-cols-[1fr_220px_auto] md:items-end"
              onSubmit={handleSubmit}
            >
              <div className="space-y-2">
                <Label htmlFor="tracking-number">Nomor Resi</Label>
                <Input
                  id="tracking-number"
                  type="text"
                  value={trackingInput}
                  onChange={(event) => setTrackingInput(event.target.value)}
                  placeholder="Contoh: JNE1234567890"
                  aria-label="Nomor resi"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="courier">Kurir</Label>
                <Select
                  id="courier"
                  value={courier}
                  onChange={(event) => setCourier(event.target.value)}
                >
                  {COURIERS.map((courierOption) => (
                    <option key={courierOption.value} value={courierOption.value}>
                      {courierOption.label}
                    </option>
                  ))}
                </Select>
              </div>

              <Button type="submit" disabled={isLoading} className="md:min-w-[140px]">
                {isLoading ? 'Melacak...' : 'Lacak Paket'}
              </Button>
            </form>

            <p
              className={cn(
                'text-sm',
                feedback.type === 'success' && 'text-emerald-700',
                feedback.type === 'error' && 'text-rose-700',
                feedback.type === 'neutral' && 'text-slate-600',
              )}
            >
              {feedback.text}
            </p>
            <p className="text-xs text-slate-500">
              Sumber data: RajaOngkir by Komerce API. Data tampil sesuai respons langsung dari
              penyedia.
            </p>
          </CardContent>
        </Card>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Ringkasan Pengiriman</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {activeShipment ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge variant={statusVariant[activeShipment.statusKey] ?? 'info'}>
                      {activeShipment.status}
                    </Badge>
                    <span className="text-sm text-slate-600">Estimasi: {activeShipment.eta}</span>
                  </div>

                  <p className="text-base font-semibold text-slate-900">
                    {activeShipment.trackingNumber} · {activeShipment.courierName}
                  </p>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pengirim</p>
                      <p className="text-sm text-slate-800">{activeShipment.sender}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Penerima</p>
                      <p className="text-sm text-slate-800">{activeShipment.recipient}</p>
                    </div>
                    <div className="sm:col-span-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Rute</p>
                      <p className="break-words text-sm leading-6 text-slate-800">
                        {activeShipment.originAddress ?? activeShipment.origin} →{' '}
                        {activeShipment.destinationAddress ?? activeShipment.destination}
                      </p>
                    </div>
                    <div className="sm:col-span-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Alamat Penerima Detail</p>
                      <div className="mt-2 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 sm:grid-cols-2">
                        <p className="break-words sm:col-span-2">
                          <span className="font-medium">Jalan:</span>{' '}
                          {activeShipment.recipientAddressDetail?.road ?? '-'}
                        </p>
                        <p>
                          <span className="font-medium">RT:</span>{' '}
                          {activeShipment.recipientAddressDetail?.rt ?? '-'}
                        </p>
                        <p>
                          <span className="font-medium">RW:</span>{' '}
                          {activeShipment.recipientAddressDetail?.rw ?? '-'}
                        </p>
                        <p>
                          <span className="font-medium">Kelurahan:</span>{' '}
                          {activeShipment.recipientAddressDetail?.kelurahan ?? '-'}
                        </p>
                        <p>
                          <span className="font-medium">Kecamatan:</span>{' '}
                          {activeShipment.recipientAddressDetail?.kecamatan ?? '-'}
                        </p>
                        <p className="sm:col-span-2">
                          <span className="font-medium">Kode Pos:</span>{' '}
                          {activeShipment.recipientAddressDetail?.kodePos ?? '-'}
                        </p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Berat</p>
                      <p className="text-sm text-slate-800">{activeShipment.weight}</p>
                    </div>
                  </div>

                  <ol className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    {DELIVERY_STEPS.map((step, index) => {
                      const isComplete = activeStepIndex >= 0 && index <= activeStepIndex
                      return (
                        <li
                          key={step.key}
                          className={cn(
                            'rounded-md border px-3 py-2 text-center text-xs font-medium',
                            isComplete
                              ? 'border-sky-200 bg-sky-50 text-sky-700'
                              : 'border-slate-200 bg-slate-50 text-slate-500',
                          )}
                        >
                          {step.label}
                        </li>
                      )
                    })}
                  </ol>

                  <p className="text-xs text-slate-500">Terakhir diperbarui: {activeShipment.updatedAt}</p>
                </>
              ) : (
                <p className="text-sm text-slate-500">
                  Data pelacakan akan tampil di sini setelah pencarian berhasil.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Peta Perjalanan Paket</CardTitle>
              <CardDescription>Titik koordinat dipetakan berdasarkan alamat/lokasi dari data resi.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative h-[360px] overflow-hidden rounded-lg border border-slate-200">
                <MapContainer
                  center={mapCenter}
                  zoom={mapPoints.length > 0 ? 6 : 5}
                  scrollWheelZoom={false}
                  className="h-full w-full"
                  style={{ height: '100%', width: '100%' }}
                >
                  <EnsureMapVisible />
                  <TileLayer
                    attribution="&copy; Kontributor OpenStreetMap"
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
                  <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-md border border-slate-200 bg-white/90 px-3 py-2 text-center text-xs text-slate-600 backdrop-blur-sm">
                    {isMapLoading
                      ? 'Menentukan titik lokasi di peta...'
                      : 'Peta aktif. Lokasi perjalanan akan muncul setelah pelacakan berhasil.'}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Riwayat Pelacakan</CardTitle>
          </CardHeader>
          <CardContent>
            {activeShipment ? (
              <ol className="relative border-s border-slate-200 pl-5">
                {activeShipment.events.map((event, index) => (
                  <li key={`${event.timestamp}-${event.description}-${index}`} className="relative mb-5 pl-5 last:mb-0">
                    <span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full border border-sky-200 bg-sky-500" />
                    <p className="text-xs text-slate-500">
                      {event.timestamp} · {event.location}
                    </p>
                    <p
                      className={cn(
                        'mt-1 text-sm font-medium',
                        index === 0 ? 'text-sky-700' : 'text-slate-800',
                      )}
                    >
                      {event.description}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-slate-500">Belum ada riwayat pelacakan untuk ditampilkan.</p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

export default App
