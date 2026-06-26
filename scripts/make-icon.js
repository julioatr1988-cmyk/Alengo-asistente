const fs   = require('fs')
const path = require('path')
const zlib = require('zlib')

const W = 256, H = 256

// Row of 256 pixels in RGBA: color #0F1E3C (brand dark blue)
const row = Buffer.alloc(W * 4)
for (let x = 0; x < W; x++) {
  row[x * 4]     = 0x0F
  row[x * 4 + 1] = 0x1E
  row[x * 4 + 2] = 0x3C
  row[x * 4 + 3] = 0xFF
}

const raw = Buffer.alloc(H * (1 + W * 4))
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0
  row.copy(raw, y * (1 + W * 4) + 1)
}
const compressed = zlib.deflateSync(raw, { level: 9 })

// CRC32 table
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
  const typeBytes = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([len, typeBytes, data, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', compressed),
  chunk('IEND', Buffer.alloc(0)),
])

// ICO with embedded PNG (modern format)
const icoHeader = Buffer.alloc(6)
icoHeader.writeUInt16LE(0, 0)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(1, 4)

const dirEntry = Buffer.alloc(16)
dirEntry[0] = 0; dirEntry[1] = 0; dirEntry[2] = 0; dirEntry[3] = 0
dirEntry.writeUInt16LE(1, 4)
dirEntry.writeUInt16LE(32, 6)
dirEntry.writeUInt32LE(png.length, 8)
dirEntry.writeUInt32LE(22, 12)

const ico = Buffer.concat([icoHeader, dirEntry, png])
const outPath = path.join(__dirname, '..', 'assets', 'icon.ico')
fs.writeFileSync(outPath, ico)
console.log('icon.ico creado:', ico.length, 'bytes')
