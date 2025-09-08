import AbstractSource from './abstract.js'

const SP_RSS = 'https://subsplease.org/rss/?t='
const NYAA_BASE = 'https://nyaa.si/?page=rss&c=1_2&f=0&u=subsplease'
const QUALITIES = ['1080', '720', '540', '480']

export default new class SubsPlease extends AbstractSource {
  buildSubsPleaseUrl (resolution) {
    const q = QUALITIES.includes(resolution) ? (resolution === '540' ? '720' : resolution) : '1080'
    return SP_RSS + q
  }

  /**
   * Parse RSS SubsPlease (magnet dans description/content)
   * @param {string} xml
   * @returns {import('./').TorrentResult[]}
   */
  parseSP (xml) {
    const items = []
    const chunks = xml.split('<item>').slice(1)
    for (const raw of chunks) {
      const get = (a, b) => {
        const i = raw.indexOf(a); if (i === -1) return ''
        const j = raw.indexOf(b, i + a.length); if (j === -1) return ''
        return raw.slice(i + a.length, j)
      }
      const stripCdata = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').trim()
      const title = stripCdata(get('<title>', '</title>'))
      const link = stripCdata(get('<link>', '</link>'))
      const desc = get('<description>', '</description>')
      const content = get('<content:encoded>', '</content:encoded>')
      const blob = [desc, content].join('\n')
      const m = blob.match(/magnet:\?xt=urn:[^"'<\s]+/i)
      const magnet = m ? m[0] : ''
      const dateStr = stripCdata(get('<pubDate>', '</pubDate>'))

      items.push({
        title,
        link: magnet || link,
        seeders: 0,
        leechers: 0,
        downloads: 0,
        hash: undefined,
        size: undefined,
        accuracy: 'medium',
        type: undefined,
        date: dateStr ? new Date(dateStr) : undefined
      })
    }
    return items
  }

  /**
   * Fallback: RSS Nyaa filtré sur uploader=subsplease
   * @param {string} xml
   * @returns {import('./').TorrentResult[]}
   */
  parseNyaa (xml) {
    const items = []
    const chunks = xml.split('<item>').slice(1)
    for (const raw of chunks) {
      const get = (a, b) => {
        const i = raw.indexOf(a); if (i === -1) return ''
        const j = raw.indexOf(b, i + a.length); if (j === -1) return ''
        return raw.slice(i + a.length, j)
      }
      const stripCdata = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').trim()
      const title = stripCdata(get('<title>', '</title>'))
      const link = stripCdata(get('<link>', '</link>'))
      const magnetNs = stripCdata(get('<torrent:magnetURI>', '</torrent:magnetURI>'))
      const guid = stripCdata(get('<guid>', '</guid>'))
      const magnet = magnetNs || (guid.startsWith('magnet:') ? guid : '')
      const seeds = parseInt(stripCdata(get('<torrent:seeds>', '</torrent:seeds>')) || '0', 10)
      const peers = parseInt(stripCdata(get('<torrent:peers>', '</torrent:peers>')) || '0', 10)
      const dateStr = stripCdata(get('<pubDate>', '</pubDate>'))

      items.push({
        title,
        link: magnet || link,
        seeders: seeds,
        leechers: peers,
        downloads: 0,
        hash: undefined,
        size: undefined,
        accuracy: 'medium',
        type: undefined,
        date: dateStr ? new Date(dateStr) : undefined
      })
    }
    return items
  }

  buildNyaaQuery ({ title, resolution, exclusions }) {
    const terms = []
    if (title) terms.push(title)
    if (resolution) terms.push(resolution + 'p')
    if (exclusions?.length) {
      for (const ex of exclusions) {
        if (!ex) continue
        terms.push(`-${ex}`)
      }
    }
    const q = terms.join(' ').trim()
    return `${NYAA_BASE}&q=${encodeURIComponent(q)}`
  }

  postFilter (entries, { resolution, exclusions }) {
    const exclSet = new Set((exclusions || []).map(s => (s || '').toLowerCase()))
    return entries.filter(e => {
      const t = (e.title || '').toLowerCase()
      if (exclSet.size) {
        for (const ex of exclSet) {
          if (ex && t.includes(ex)) return false
        }
      }
      if (!resolution) return true
      const bad = QUALITIES.filter(q => q !== resolution)
      for (const b of bad) {
        if (t.includes(b + 'p')) return false
      }
      return true
    })
  }

  /** @type {import('./').SearchFunction} */
  async single ({ title, resolution, exclusions }) {
    if (!title) throw new Error('No title provided')
    const spUrl = this.buildSubsPleaseUrl(resolution)
    const spRes = await fetch(spUrl, { headers: { Accept: 'application/rss+xml,text/xml,*/*' } })
    const spXml = await spRes.text()
    const fromSp = this.postFilter(
      this.parseSP(spXml).filter(i => i.title?.toLowerCase().includes(title.toLowerCase())),
      { resolution, exclusions }
    )
    if (fromSp.length) return fromSp

    const nyaaUrl = this.buildNyaaQuery({ title, resolution, exclusions })
    const nyaaRes = await fetch(nyaaUrl, { headers: { Accept: 'application/rss+xml,text/xml,*/*' } })
    const nyaaXml = await nyaaRes.text()
    return this.postFilter(this.parseNyaa(nyaaXml), { resolution, exclusions })
  }

  /** @type {import('./').SearchFunction} */
  async batch ({ title, resolution, exclusions }) {
    if (!title) throw new Error('No title provided')
    // rechercher "Batch" d’abord via Nyaa (u=subsplease), c’est ce qui marche le mieux
    const nyaaUrl = this.buildNyaaQuery({ title: `${title} batch`, resolution, exclusions })
    const nyaaRes = await fetch(nyaaUrl, { headers: { Accept: 'application/rss+xml,text/xml,*/*' } })
    const nyaaXml = await nyaaRes.text()
    const list = this.postFilter(this.parseNyaa(nyaaXml), { resolution, exclusions })
    return list.map(x => ({ ...x, type: 'batch' }))
  }

  /** @type {import('./').SearchFunction} */
  async movie ({ title, resolution, exclusions }) {
    if (!title) throw new Error('No title provided')
    // même logique que single, sur le terme du film
    const spUrl = this.buildSubsPleaseUrl(resolution)
    const spRes = await fetch(spUrl, { headers: { Accept: 'application/rss+xml,text/xml,*/*' } })
    const spXml = await spRes.text()
    const fromSp = this.postFilter(
      this.parseSP(spXml).filter(i => i.title?.toLowerCase().includes(title.toLowerCase())),
      { resolution, exclusions }
    )
    if (fromSp.length) return fromSp

    const nyaaUrl = this.buildNyaaQuery({ title, resolution, exclusions })
    const nyaaRes = await fetch(nyaaUrl, { headers: { Accept: 'application/rss+xml,text/xml,*/*' } })
    const nyaaXml = await nyaaRes.text()
    return this.postFilter(this.parseNyaa(nyaaXml), { resolution, exclusions })
  }

  async test () {
    const res = await fetch(this.buildSubsPleaseUrl('1080'), { headers: { Accept: 'application/rss+xml,text/xml,*/*' } })
    return res.ok
  }
}()
