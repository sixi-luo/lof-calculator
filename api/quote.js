import { fetchData } from './dataSources.js'

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const code = searchParams.get('code')
  const market = searchParams.get('market') || null

  if (!code) {
    return res.status(400).json({ error: 'Missing code parameter' })
  }

  try {
    const data = await fetchData(code, market)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cache-Control', 'public, max-age=10')
    return res.status(200).json(data)
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to fetch data' })
  }
}