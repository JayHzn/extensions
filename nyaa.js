import AbstractSource from './abstract.js'

const BASE = 'https://nyaa.si/?page=rss&c=1_2'
const QUALITIES = ['1080', '720', '540', '480']

export default new class Nyaa extends AbstractSource {
  url = BASE

  buildQuery ({ title, resolution, exclusions, uploader }) {
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
    const u = uploader ? `&u=${encodeURIComponent(uploader)}` : ''
    return `${this.url}&f=0&q=${encodeURIComponent(q)}${u}`
  }

  /**
   * Parse un flux RSS de nyaa.si
   * @param {string} xml
   * @returns {import('./').TorrentResult[]}
   */
  parse (xml) {
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
      const sizeStr = stripCdata(get('<torrent:contentLength>', '</torrent:contentLength>'))
      const seeders = parseInt(stripCdata(get('<torrent:seeds>', '</torrent:seeds>')) || '0', 10)
      const leechers = parseInt(stripCdata(get('<torrent:peers>', '</torrent:peers>')) || '0', 10)
      const dateStr = stripCdata(get('<pubDate>', '</pubDate>'))

      items.push({
        title,
        link: magnet || link,
        seeders,
        leechers,
        downloads: 0,
        hash: undefined,
        size: sizeStr ? Number(sizeStr) : undefined,
        accuracy: 'medium',
        type: undefined,
        date: dateStr ? new Date(dateStr) : undefined
      })
    }
    return items
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
  async single ({ title, resolution, exclusions, uploader }) {
    if (!title) throw new Error('No title provided')
    const url = this.buildQuery({ title, resolution, exclusions, uploader })
    const res = await fetch(url, { headers: { Accept: 'application/rss+xml,text/xml,*/*' } })
    const xml = await res.text()
    return this.postFilter(this.parse(xml), { resolution, exclusions })
  }

  /** @type {import('./').SearchFunction} */
  async batch ({ title, resolution, exclusions, uploader }) {
    if (!title) throw new Error('No title provided')
    const url = this.buildQuery({ title: `${title} batch`, resolution, exclusions, uploader })
    const res = await fetch(url, { headers: { Accept: 'application/rss+xml,text/xml,*/*' } })
    const xml = await res.text()
    const list = this.postFilter(this.parse(xml), { resolution, exclusions })
    // hint: type=batch pour aider le scoring de l’app
    return list.map(x => ({ ...x, type: 'batch' }))
  }

  /** @type {import('./').SearchFunction} */
  async movie ({ title, resolution, exclusions, uploader }) {
    if (!title) throw new Error('No title provided')
    const url = this.buildQuery({ title, resolution, exclusions, uploader })
    const res = await fetch(url, { headers: { Accept: 'application/rss+xml,text/xml,*/*' } })
    const xml = await res.text()
    return this.postFilter(this.parse(xml), { resolution, exclusions })
  }

  async test () {
    const res = await fetch(this.url, { headers: { Accept: 'application/rss+xml,text/xml,*/*' } })
    return res.ok
  }
}()
