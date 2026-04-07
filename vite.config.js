import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const sanitizeEnvValue = (value = '') =>
  String(value).trim().replace(/^['"]|['"]$/g, '')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const defaultApiKey = sanitizeEnvValue(
    env.RAJAONGKIR_API_KEY || env.VITE_RAJAONGKIR_API_KEY || '',
  )
  const shippingCostApiKey = sanitizeEnvValue(
    env.RAJAONGKIR_SHIPPING_COST_API_KEY ||
      env.VITE_RAJAONGKIR_SHIPPING_COST_API_KEY ||
      defaultApiKey,
  )
  const shippingDeliveryApiKey = sanitizeEnvValue(
    env.RAJAONGKIR_SHIPPING_DELIVERY_API_KEY ||
      env.VITE_RAJAONGKIR_SHIPPING_DELIVERY_API_KEY ||
      defaultApiKey,
  )
  const apiBaseUrl = sanitizeEnvValue(
    env.RAJAONGKIR_BASE_URL ||
      env.VITE_RAJAONGKIR_BASE_URL ||
      'https://rajaongkir.komerce.id/api/v1',
  )
  const deliveryBaseUrl = sanitizeEnvValue(
    env.RAJAONGKIR_DELIVERY_BASE_URL ||
      env.VITE_RAJAONGKIR_DELIVERY_BASE_URL ||
      'https://api-sandbox.collaborator.komerce.id/order/api/v1',
  )
  const apiUrl = new URL(apiBaseUrl)
  const basePath = apiUrl.pathname.endsWith('/')
    ? apiUrl.pathname.slice(0, -1)
    : apiUrl.pathname
  const deliveryUrl = new URL(deliveryBaseUrl)
  const deliveryBasePath = deliveryUrl.pathname.endsWith('/')
    ? deliveryUrl.pathname.slice(0, -1)
    : deliveryUrl.pathname

  const keyGuardPlugin = {
    name: 'rajaongkir-key-guard',
    configureServer(server) {
      const guardByKey = (requiredKey, missingKeyMessage) => (_, res, next) => {
        if (requiredKey) {
          next()
          return
        }

        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(
          JSON.stringify({
            meta: {
              message: missingKeyMessage,
              code: 500,
              status: 'failed',
            },
            data: null,
          }),
        )
      }

      server.middlewares.use(
        '/api/rajaongkir',
        guardByKey(
          shippingCostApiKey,
          'RAJAONGKIR_SHIPPING_COST_API_KEY belum diset. Isi .env.local lalu restart npm run dev.',
        ),
      )
      server.middlewares.use(
        '/api/shipping-delivery',
        guardByKey(
          shippingDeliveryApiKey,
          'RAJAONGKIR_SHIPPING_DELIVERY_API_KEY belum diset. Isi .env.local lalu restart npm run dev.',
        ),
      )
    },
  }

  return {
    plugins: [react(), keyGuardPlugin],
    server: {
      proxy: {
        '/api/rajaongkir': {
          target: `${apiUrl.protocol}//${apiUrl.host}`,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/rajaongkir/, basePath),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('key', shippingCostApiKey)
            })
          },
        },
        '/api/shipping-delivery': {
          target: `${deliveryUrl.protocol}//${deliveryUrl.host}`,
          changeOrigin: true,
          secure: true,
          rewrite: (path) =>
            path.replace(/^\/api\/shipping-delivery/, deliveryBasePath),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('x-api-key', shippingDeliveryApiKey)
            })
          },
        },
      },
    },
  }
})
