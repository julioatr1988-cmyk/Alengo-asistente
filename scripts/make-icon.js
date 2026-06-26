const fs   = require('fs')
const path = require('path')
const zlib = require('zlib')

// Brand color #0F1E3C
const R = 0x0F, G = 0x1E, B = 0x3C

// ── BMP-format entry for 16×16, 32×32, 48×48 ─────────────────────────────────
// ICO embeds BMP without the BITMAPFILEHEADER; biHeight is doubled (XOR+AND maps).
function makeBmpEntry(size) {
  const HEADER    = 40
  const pixelBytes = size * size * 4
  const maskRow   = Math.ceil(size / 32) * 4  // AND-mask row aligned to 4 bytes
  const maskBytes = maskRow * size
  const buf       = Buffer.alloc(HEADER + pixelBytes + maskBytes)

  // BITMAPINFOHEADER
  buf.writeInt32LE(40, 0)
  buf.writeInt32LE(size, 4)
  buf.writeInt32LE(size * 2, 8)   // biHeight×2 = XOR pixels + AND mask
  buf.writeUInt16LE(1, 12)         // biPlanes
  buf.writeUInt16LE(32, 14)        // biBitCount
  buf.writeInt32LE(0, 16)          // biCompression = BI_RGB
  buf.writeInt32LE(pixelBytes, 20) // biSizeImage

  // Pixel data: BGRA, bottom-up (all brand blue, fully opaque)
  let off = HEADER
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      buf[off++] = B; buf[off++] = G; buf[off++] = R; buf[off++] = 0xFF
    }
  }
  // AND mask: already zeroed (0 = opaque)
  return buf
}

// ── PNG-format entry for 256×256 ──────────────────────────────────────────────
function makePngEntry(size) {
  const row = Buffer.alloc(size * 4)
  for (let x = 0; x < size; x++) {
    row[x * 4] = R; row[x * 4 + 1] = G; row[x * 4 + 2] = B; row[x * 4 + 3] = 0xFF
  }
  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0  // filter: None
    row.copy(raw, y * (1 + size * 4) + 1)
  }
  const compressed = zlib.deflateSync(raw, { level: 9 })

  const table = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c
  }
  function crc32(buf) {
    let c = 0xFFFFFFFF
    for (const b of buf) c = table[(c ^ b) & 0xFF] ^ (c >>> 8)
    return (c ^ 0xFFFFFFFF) >>> 0
  }
  function chunk(type, data) {
    const tb  = Buffer.from(type, 'ascii')
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])))
    return Buffer.concat([len, tb, data, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6  // 8 bits/channel, RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── Assemble ICO ──────────────────────────────────────────────────────────────
// Windows uses 16/32/48 (BMP) for taskbar/desktop/folder; 256 (PNG) for large views.
const images = [
  { w: 16,  data: makeBmpEntry(16) },
  { w: 32,  data: makeBmpEntry(32) },
  { w: 48,  data: makeBmpEntry(48) },
  { w: 0,   data: makePngEntry(256) },  // 0 = 256 in ICO directory
]

const count    = images.length
const dirStart = 6 + count * 16  // ICO header (6) + directory entries (16 each)
let   offset   = dirStart

const dirs = images.map(img => {
  const d = Buffer.alloc(16)
  d[0] = img.w; d[1] = img.w  // 0×0 encodes 256×256
  d[2] = 0;     d[3] = 0      // color count, reserved
  d.writeUInt16LE(1,  4)       // planes
  d.writeUInt16LE(32, 6)       // bits per pixel
  d.writeUInt32LE(img.data.length, 8)
  d.writeUInt32LE(offset, 12)
  offset += img.data.length
  return d
})

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)     // reserved
header.writeUInt16LE(1, 2)     // type = ICO
header.writeUInt16LE(count, 4) // number of images

const ico = Buffer.concat([header, ...dirs, ...images.map(i => i.data)])
const outPath = path.join(__dirname, '..', 'assets', 'icon.ico')
fs.writeFileSync(outPath, ico)
console.log(`icon.ico: ${count} imágenes, ${ico.length} bytes`)
