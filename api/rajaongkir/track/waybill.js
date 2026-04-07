import process from 'node:process'

const sanitizeEnvValue = (value = '') =>
  String(value).trim().replace(/^['"]|['"]$/g, '')

const pickQueryValue = (value) => (Array.isArray(value) ? value[0] : value)

const readEnvValue = (...keys) => {
  for (const key of keys) {
    const value = sanitizeEnvValue(process.env[key] || '')
    if (value) {
      return value
    }
  }

  return ''
}

const sendJson = (res, statusCode, payload) => {
  res.status(statusCode).setHeader('Content-Type', 'application/json; charset=utf-8')
  res.send(JSON.stringify(payload))
}

const createFailedPayload = (message, code = 500) => ({
  meta: {
    message,
    code,
    status: 'failed',
  },
  data: null,
})

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return sendJson(
      res,
      405,
      createFailedPayload('Method not allowed. Use POST or GET.', 405),
    )
  }

  const apiKey = readEnvValue(
    'RAJAONGKIR_SHIPPING_COST_API_KEY',
    'VITE_RAJAONGKIR_SHIPPING_COST_API_KEY',
    'RAJAONGKIR_API_KEY',
    'VITE_RAJAONGKIR_API_KEY',
  )

  if (!apiKey) {
    return sendJson(
      res,
      500,
      createFailedPayload(
        'RAJAONGKIR_SHIPPING_COST_API_KEY belum diset di environment Vercel.',
      ),
    )
  }

  const baseUrl =
    readEnvValue('RAJAONGKIR_BASE_URL', 'VITE_RAJAONGKIR_BASE_URL') ||
    'https://rajaongkir.komerce.id/api/v1'

  const awb = sanitizeEnvValue(pickQueryValue(req.query.awb))
  const courier = sanitizeEnvValue(pickQueryValue(req.query.courier)).toLowerCase()

  if (!awb || !courier) {
    return sendJson(
      res,
      400,
      createFailedPayload('Missing required query params: awb and courier.', 400),
    )
  }

  const endpoint = `${baseUrl.replace(/\/$/, '')}/track/waybill?awb=${encodeURIComponent(awb)}&courier=${encodeURIComponent(courier)}`

  try {
    const upstreamResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        key: apiKey,
      },
    })

    const rawBody = await upstreamResponse.text()

    let payload
    try {
      payload = JSON.parse(rawBody)
    } catch {
      payload = createFailedPayload('Upstream returned non-JSON response.', upstreamResponse.status)
    }

    return sendJson(res, upstreamResponse.status, payload)
  } catch {
    return sendJson(
      res,
      502,
      createFailedPayload('Failed to reach RajaOngkir Shipping Cost API.', 502),
    )
  }
}
