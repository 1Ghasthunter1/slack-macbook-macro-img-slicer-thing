import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'

const TILE_SIZE = 128 // Slack renders custom emoji at most 128px; keeps files tiny
const MACOS_MACRO_LIMIT = 2000 // macOS text-replacement phrases cap at 2,000 chars

const PRESETS = [
  { label: '3×3', cols: 3, rows: 3 },
  { label: '4×4', cols: 4, rows: 4 },
  { label: '5×5', cols: 5, rows: 5 },
  { label: '6×4', cols: 6, rows: 4 },
]

function sanitizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

type LoadedImage = { el: HTMLImageElement; url: string; fileName: string }

function App() {
  const [image, setImage] = useState<LoadedImage | null>(null)
  const [name, setName] = useState('')
  const [cols, setCols] = useState(4)
  const [rows, setRows] = useState(4)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadFile = useCallback((file: File | null | undefined) => {
    if (!file || !file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    const el = new Image()
    el.onload = () => {
      setImage((prev) => {
        if (prev) URL.revokeObjectURL(prev.url)
        return { el, url, fileName: file.name }
      })
      setName((prev) =>
        prev ? prev : sanitizeName(file.name.replace(/\.[^.]+$/, '')),
      )
    }
    el.src = url
  }, [])

  // Paste an image anywhere on the page
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/'),
      )
      if (item) loadFile(item.getAsFile())
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [loadFile])

  // Tiles are always square: use the largest square cell that fits the grid
  // inside the image, centered, and crop the excess.
  const crop = useMemo(() => {
    if (!image) return null
    const { naturalWidth: w, naturalHeight: h } = image.el
    const cell = Math.min(w / cols, h / rows)
    return {
      cell,
      w,
      h,
      offX: (w - cell * cols) / 2,
      offY: (h - cell * rows) / 2,
    }
  }, [image, cols, rows])

  const macro = useMemo(() => {
    if (!name) return ''
    const lines: string[] = []
    for (let r = 1; r <= rows; r++) {
      let line = ''
      for (let c = 1; c <= cols; c++) line += `:${name}-${r}-${c}:`
      lines.push(line)
    }
    return lines.join('\n')
  }, [name, rows, cols])

  const exportZip = async () => {
    if (!image || !name || !crop || busy) return
    setBusy(true)
    try {
      const { el } = image
      const { cell, offX, offY } = crop
      const zip = new JSZip()
      const canvas = document.createElement('canvas')
      canvas.width = TILE_SIZE
      canvas.height = TILE_SIZE
      const ctx = canvas.getContext('2d')!

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE)
          ctx.drawImage(
            el,
            offX + c * cell,
            offY + r * cell,
            cell,
            cell,
            0,
            0,
            TILE_SIZE,
            TILE_SIZE,
          )
          const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
              'image/png',
            ),
          )
          zip.file(`${name}-${r + 1}-${c + 1}.png`, blob)
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(zipBlob)
      a.download = `${name}-emoji.zip`
      a.click()
      URL.revokeObjectURL(a.href)
    } finally {
      setBusy(false)
    }
  }

  const copyMacro = async () => {
    await navigator.clipboard.writeText(macro)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const clampGrid = (v: number) => Math.max(1, Math.min(20, Math.round(v) || 1))

  return (
    <main>
      <header>
        <h1>Slack Emoji Slicer</h1>
        <p>
          Slice an image into a grid of emoji, upload them to Slack, and paste
          one macro to rebuild the whole picture.
        </p>
      </header>

      <div className="layout">
        <div className="left">
          <div
            className={`dropzone ${dragging ? 'dragging' : ''} ${image ? 'has-image' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              loadFile(e.dataTransfer.files[0])
            }}
          >
            {image && crop ? (
              <div className="preview">
                <img src={image.url} alt={image.fileName} />
                <div
                  className="grid-overlay"
                  style={{
                    left: `${(crop.offX / crop.w) * 100}%`,
                    top: `${(crop.offY / crop.h) * 100}%`,
                    width: `${((crop.cell * cols) / crop.w) * 100}%`,
                    height: `${((crop.cell * rows) / crop.h) * 100}%`,
                    backgroundSize: `${100 / cols}% ${100 / rows}%`,
                  }}
                />
              </div>
            ) : (
              <div className="dropzone-hint">
                <span className="big">Drop an image here</span>
                <span>or click to browse — pasting works too</span>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                loadFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>

          {image && crop && (
            <div className="tiles-section">
              <h2>Tile preview</h2>
              <div
                className="tiles"
                style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
              >
                {Array.from({ length: rows * cols }, (_, i) => {
                  const r = Math.floor(i / cols)
                  const c = i % cols
                  const { cell, w, h, offX, offY } = crop
                  const posX =
                    w === cell ? 0 : ((offX + c * cell) / (w - cell)) * 100
                  const posY =
                    h === cell ? 0 : ((offY + r * cell) / (h - cell)) * 100
                  return (
                    <div
                      key={i}
                      className="tile"
                      style={{
                        backgroundImage: `url(${image.url})`,
                        backgroundSize: `${(w / cell) * 100}% ${(h / cell) * 100}%`,
                        backgroundPosition: `${posX}% ${posY}%`,
                      }}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="right">
          <section className="controls">
            <label className="field">
              <span>Emoji name</span>
              <input
                type="text"
                value={name}
                placeholder="e.g. office-dog"
                onChange={(e) => setName(sanitizeName(e.target.value))}
              />
            </label>

            <div className="field">
              <span>Grid (cols × rows)</span>
              <div className="grid-inputs">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={cols}
                  onChange={(e) => setCols(clampGrid(e.target.valueAsNumber))}
                />
                <span className="times">×</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={rows}
                  onChange={(e) => setRows(clampGrid(e.target.valueAsNumber))}
                />
                <div className="presets">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className={
                        p.cols === cols && p.rows === rows
                          ? 'preset active'
                          : 'preset'
                      }
                      onClick={() => {
                        setCols(p.cols)
                        setRows(p.rows)
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              className="export"
              disabled={!image || !name || busy}
              onClick={exportZip}
            >
              {busy ? 'Slicing…' : `Export ${cols * rows} tiles (.zip)`}
            </button>
          </section>

          {name && (
            <section className="macro">
              <div className="macro-header">
                <h2>Slack macro</h2>
                <button type="button" onClick={copyMacro}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre>{macro}</pre>
              {macro.length > MACOS_MACRO_LIMIT && (
                <p className="warning">
                  This macro is {macro.length.toLocaleString()} characters —
                  over macOS's {MACOS_MACRO_LIMIT.toLocaleString()}-character
                  text-replacement limit. Use a smaller grid or a shorter
                  name, or split it into one replacement per row.
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  )
}

export default App
