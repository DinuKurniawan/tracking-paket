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
  if (req.method !== 'GET') {
    return sendJson(res, 405, createFailedPayload('Method not allowed. Use GET.', 405))
  }

  const apiKey = readEnvValue(
    'RAJAONGKIR_SHIPPING_DELIVERY_API_KEY',
    'VITE_RAJAONGKIR_SHIPPING_DELIVERY_API_KEY',
    'RAJAONGKIR_API_KEY',
    'VITE_RAJAONGKIR_API_KEY',
  )

  if (!apiKey) {
    return sendJson(
      res,
      500,
      createFailedPayload(
        'RAJAONGKIR_SHIPPING_DELIVERY_API_KEY belum diset di environment Vercel.',
      ),
    )
  }

  const baseUrl =
    readEnvValue(
      'RAJAONGKIR_DELIVERY_BASE_URL',
      'VITE_RAJAONGKIR_DELIVERY_BASE_URL',
    ) || 'https://api-sandbox.collaborator.komerce.id/order/api/v1'

  const shipping = sanitizeEnvValue(pickQueryValue(req.query.shipping)).toLowerCase()
  const airwayBill = sanitizeEnvValue(pickQueryValue(req.query.airway_bill))

  if (!shipping || !airwayBill) {
    return sendJson(
      res,
      400,
      createFailedPayload(
        'Missing required query params: shipping and airway_bill.',
        400,
      ),
    )
  }

  const endpoint = `${baseUrl.replace(/\/$/, '')}/orders/history-airway-bill?shipping=${encodeURIComponent(shipping)}&airway_bill=${encodeURIComponent(airwayBill)}`

  try {
    const upstreamResponse = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
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
      createFailedPayload(
        'Failed to reach RajaOngkir Shipping Delivery API.',
        502,
      ),
    )
  }
}
