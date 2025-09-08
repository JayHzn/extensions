import AbstractSource from './abstract.js'

const RSS_BASE = 'https://subsplease.org/rss/?t&r='
const RESOLUTIONS = [1080, 720] // on essaie 1080p puis 720p

function parseRssItems(xml) {
  return xml.split('<item>').slice(1).map(raw => {
    const title = (raw.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || '').trim()
    const link = (raw.match(/<link>(.*?)<\/link>/)?.[1] || '').trim()
    const pubDate = (raw.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '').trim()
    return { title, link, pubDate }
  }).filter(it => it.title && it.link)
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

function titleMatches(anyTitles, candidate) {
  const s = candidate.toLowerCase()
  return anyTitles.some(t => s.includes(String(t).toLowerCase()))
}

function extractMagnet(htmlOrXml) {
  const m = htmlOrXml.match(/(magnet:\?xt=urn:btih:[^"'<> ]+)/i)
  return m ? m[1] : null
}

function infoHashFromMagnet(magnet) {
  const m = magnet.match(/btih:([A-Fa-f0-9]{40}|[A-Za-z0-9]{32})/)
  return m ? m[1] : null
}

export default new class SubsPlease extends AbstractSource {
  url = null

  /** @type {import('./').SearchFunction} */
  async single({ anilistId, titles, episodeCount }) {
    if (!titles?.length) throw new Error('No titles provided')

    const out = []
    const seenHashes = new Set()

    for (const r of RESOLUTIONS) {
      const feedUrl = `${RSS_BASE}${r}`
      let xml
      try {
        xml = await fetch(feedUrl).then(r => r.text())
      } catch { continue }

      const items = parseRssItems(xml)
      const candidates = items.filter(it => titleMatches(titles, it.title))

      for (const it of candidates) {
        let magnet = extractMagnet(it.link)
        if (!magnet) {
          try {
            const html = await fetchText(it.link)
            magnet = extractMagnet(html)
          } catch {
            continue
          }
        }
        if (!magnet) continue
        const infoHash = infoHashFromMagnet(magnet)
        if (!infoHash || seenHashes.has(infoHash)) continue
        seenHashes.add(infoHash)

        out.push({
          hash: infoHash,
          link: magnet,
          title: it.title,
          size: 0,
          type: 'alt',
          date: it.pubDate ? new Date(it.pubDate) : new Date(),
          seeders: 0,
          leechers: 0,
          downloads: 0,
          accuracy: 'medium'
        })
      }
    }

    if (episodeCount && episodeCount !== 1) {
      return out.filter(t => !/\b(batch|complete)\b/i.test(t.title))
    }
    return out
  }

  batch = this.single
  movie = this.single

  async test() {
    try {
      const res = await fetch(`${RSS_BASE}1080`)
      return res.ok
    } catch {
      return false
    }
  }
}()
