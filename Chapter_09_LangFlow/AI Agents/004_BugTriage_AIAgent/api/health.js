import { getHealth } from '../server/langflow-service.js'

export const config = { maxDuration: 15 }

export default async function handler(req, res) {
  const { status, body } = await getHealth()
  res.setHeader('Cache-Control', 'no-store')
  return res.status(status).json(body)
}
