import { useEffect, useMemo, useRef, useState } from 'react';
import { zipSync } from 'fflate';
import { FaFillDrip, FaUndo, FaRedo } from 'react-icons/fa';

type RGB = [number, number, number];
type Bead = { name: string; hex: string; rgb: RGB };

const colors: [string, string][] = [
  ['Negro', '#1c1c20'],
  ['Blanco', '#ffffff'],
  ['Gris claro', '#c9c8c8'],
  ['Gris oscuro', '#77767b'],
  ['Crema', '#f7e6cb'],
  ['Piel clara', '#f6c9a9'],
  ['Piel media', '#df9d77'],
  ['Rosa claro', '#f5a4b7'],
  ['Rosa fuerte', '#e85b85'],
  ['Rojo', '#dc3545'],
  ['Rojo vino', '#842c3b'],
  ['Naranja', '#f28c42'],
  ['Amarillo', '#f5d84c'],
  ['Verde claro', '#8acb74'],
  ['Verde', '#329b63'],
  ['Verde oscuro', '#21654b'],
  ['Azul claro', '#85c9e9'],
  ['Azul', '#367fc6'],
  ['Azul oscuro', '#24447c'],
  ['Turquesa', '#41b9b1'],
  ['Lila', '#c3a0ec'],
  ['Morado', '#9763ce'],
  ['Morado oscuro', '#5e378b'],
  ['Café claro', '#c58a56'],
  ['Café', '#8d5137'],
  ['Café oscuro', '#51312c'],
];
const palette: Bead[] = colors.map(([name, hex]) => ({
  name,
  hex,
  rgb: [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as RGB,
}));
const gridSizes = [20, 30, 40] as const;
const cellSize = 24;
const coordinateMargin = 30;
type GridSize = (typeof gridSizes)[number];
type Edits = Map<number, number>;
type EditHistory = {
  past: Edits[];
  current: Edits;
  future: Edits[];
  strokeId?: number;
};
const emptyHistory: EditHistory = { past: [], current: new Map(), future: [] };

const detailLevels = {
  simple: { maxColors: 8, contrast: 110 },
  balanced: { maxColors: 14, contrast: 82 },
  detailed: { maxColors: palette.length, contrast: 58 },
};
type Detail = keyof typeof detailLevels;
type Cell = { x: number; y: number };

function lineCells(start: Cell, end: Cell, size: GridSize) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const steps = Math.max(1, Math.abs(dx), Math.abs(dy));
  return Array.from({ length: steps + 1 }, (_, step) => {
    const x = start.x + Math.round(dx * step / steps);
    const y = start.y + Math.round(dy * step / steps);
    return y * size + x;
  });
}

function fillRegion(base: number[], edits: Edits, size: GridSize, start: number, color: number) {
  const original = edits.get(start) ?? base[start];
  if (original === color) return edits;

  const next = new Map(edits);
  const pending = [start];
  next.set(start, color);

  while (pending.length > 0) {
    const index = pending.pop()!;
    const x = index % size;
    const neighbors = [];
    if (x > 0) neighbors.push(index - 1);
    if (x < size - 1) neighbors.push(index + 1);
    if (index >= size) neighbors.push(index - size);
    if (index + size < base.length) neighbors.push(index + size);

    for (const neighbor of neighbors) {
      if ((next.get(neighbor) ?? base[neighbor]) !== original) continue;
      next.set(neighbor, color);
      pending.push(neighbor);
    }
  }

  return next;
}
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

function srgb(value: number) {
  const channel = value / 255;
  return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
}

function dist(a: RGB, b: RGB) {
  return .2126 * (srgb(a[0]) - srgb(b[0])) ** 2
    + .7152 * (srgb(a[1]) - srgb(b[1])) ** 2
    + .0722 * (srgb(a[2]) - srgb(b[2])) ** 2;
}

function nearest(rgb: RGB) {
  let best = 0;
  let score = Infinity;
  palette.forEach((color, index) => {
    const distance = dist(rgb, color.rgb);
    if (distance < score) {
      score = distance;
      best = index;
    }
  });
  return best;
}

function convert(img: HTMLImageElement, size: GridSize, outline: boolean, detail: Detail) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  const scale = size / Math.max(img.naturalWidth, img.naturalHeight);
  const width = img.naturalWidth * scale;
  const height = img.naturalHeight * scale;
  ctx.drawImage(img, (size - width) / 2, (size - height) / 2, width, height);
  const { data } = ctx.getImageData(0, 0, size, size);
  const result = Array<number>(size * size).fill(-1);
  const luminance = new Array<number>(result.length);
  const settings = detailLevels[detail];

  for (let i = 0; i < result.length; i++) {
    const k = i * 4;
    if (data[k + 3] < 70) continue;
    const rgb: RGB = [data[k], data[k + 1], data[k + 2]];
    luminance[i] = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
    result[i] = nearest(rgb);
  }

  if (outline) {
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        if (result[i] < 0) continue;
        const neighbors = [i - 1, i + 1, i - size, i + size];
        const border = neighbors.some(n => result[n] < 0);
        const contrast = neighbors.some(n => Math.abs(luminance[n] - luminance[i]) > settings.contrast);
        if (border || (contrast && luminance[i] < 135)) result[i] = 0;
      }
    }
  }

  const frequencies = Array<number>(palette.length).fill(0);
  for (const color of result) {
    if (color >= 0) frequencies[color]++;
  }
  const used = frequencies.map((count, color) => ({ count, color }))
    .filter(entry => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .map(entry => entry.color);
  if (used.length <= settings.maxColors) return result;

  const retained = used.slice(0, settings.maxColors);
  if (outline && frequencies[0] > 0 && !retained.includes(0)) {
    retained[retained.length - 1] = 0;
  }
  const replacements = palette.map(({ rgb }) => retained.reduce((best, color) =>
    dist(rgb, palette[color].rgb) < dist(rgb, palette[best].rgb) ? color : best,
  ));
  return result.map(color => color < 0 ? color : replacements[color]);
}
function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function draw(
  canvas: HTMLCanvasElement,
  grid: number[],
  size: GridSize,
  showGrid: boolean,
  beads: boolean,
) {
  const cell = cellSize;
  canvas.width = coordinateMargin + size * cell;
  canvas.height = coordinateMargin + size * cell;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#4a3564';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < size; i++) {
    const center = coordinateMargin + (i + .5) * cell;
    const label = String(i + 1);
    ctx.fillText(label, center, coordinateMargin / 2);
    ctx.fillText(label, coordinateMargin / 2, center);
  }

  grid.forEach((color, index) => {
    const x = coordinateMargin + (index % size) * cell;
    const y = coordinateMargin + Math.floor(index / size) * cell;

    if (color >= 0) {
      ctx.fillStyle = palette[color].hex;
      if (beads) {
        const centerX = x + cell / 2;
        const centerY = y + cell / 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, cell * .45, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(centerX, centerY, cell * .13, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, cell, cell);
      }
    }

    if (showGrid) {
      ctx.strokeStyle = 'rgba(70,70,90,.22)';
      ctx.lineWidth = .55;
      ctx.strokeRect(x + .25, y + .25, cell, cell);
    }
  });
}

function renderPNG(grid: number[], size: GridSize, showGrid: boolean, beads: boolean) {
  const output = document.createElement('canvas');
  draw(output, grid, size, showGrid, beads);
  return canvasPNG(output);
}

function canvasPNG(output: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    output.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('No se pudo generar el PNG.'));
    }, 'image/png');
  });
}

type Count = Bead & { count: number };

function countCSV(counts: Count[], total: number) {
  const rows = [
    'Color,Codigo HEX,Cantidad',
    ...counts.map(c => `"${c.name}",${c.hex},${c.count}`),
    'TOTAL,,' + total,
  ];
  return new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

function countPNG(counts: Count[], total: number, capacity: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 520;
  canvas.height = 120 + counts.length * 36;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#28233b';
  ctx.font = 'bold 23px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('Conteo por color', 24, 32);

  counts.forEach(({ name, hex, count }, index) => {
    const y = 64 + 36 * index;
    ctx.fillStyle = hex;
    ctx.fillRect(24, y - 8, 16, 16);
    ctx.strokeStyle = '#ded5e9';
    ctx.strokeRect(24, y - 8, 16, 16);
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#28233b';
    ctx.fillText(name, 52, y);
    ctx.textAlign = 'right';
    ctx.fillText(hex, 416, y);
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(String(count), 496, y);
    ctx.textAlign = 'left';
  });

  const summaryY = canvas.height - 32;
  ctx.fillStyle = '#f5effc';
  ctx.fillRect(24, summaryY - 18, 472, 36);
  ctx.fillStyle = '#28233b';
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText('Total', 36, summaryY);
  ctx.textAlign = 'right';
  ctx.fillText(`${total} / ${capacity}`, 484, summaryY);
  return canvasPNG(canvas);
}

type ProjectFile = {
  format: 'hama-beads-studio';
  version: 1;
  size: GridSize;
  source: string | null;
  detail: Detail;
  outline: boolean;
  showGrid: boolean;
  beads: boolean;
  edits: Partial<Record<GridSize, [number, number][]>>;
};

function readProject(text: string) {
  const project = JSON.parse(text) as Partial<ProjectFile> | null;
  if (!project || project.format !== 'hama-beads-studio' || project.version !== 1 ||
    project.size === undefined || !gridSizes.includes(project.size) ||
    project.detail === undefined || !Object.hasOwn(detailLevels, project.detail) ||
    typeof project.outline !== 'boolean' || typeof project.showGrid !== 'boolean' ||
    typeof project.beads !== 'boolean' ||
    (project.source !== null && (typeof project.source !== 'string' ||
      !/^data:(?:image\/(?:png|jpeg|webp)|application\/octet-stream)?;base64,/i.test(project.source))) ||
    !project.edits || typeof project.edits !== 'object' || Array.isArray(project.edits)) {
    throw new Error('Formato de proyecto inválido.');
  }

  const histories: Partial<Record<GridSize, EditHistory>> = {};
  for (const size of gridSizes) {
    const edits = project.edits[size];
    if (edits === undefined) continue;
    if (!Array.isArray(edits) || edits.length > size * size || edits.some(entry =>
      !Array.isArray(entry) || entry.length !== 2 ||
      !Number.isInteger(entry[0]) || entry[0] < 0 || entry[0] >= size * size ||
      !Number.isInteger(entry[1]) || entry[1] < -1 || entry[1] >= palette.length
    )) {
      throw new Error('Celdas de proyecto inválidas.');
    }
    histories[size] = { past: [], current: new Map(edits), future: [] };
  }
  return { project: project as ProjectFile, histories };
}

export default function App() {
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [size, setSize] = useState<GridSize>(40);
  const [histories, setHistories] = useState<Partial<Record<GridSize, EditHistory>>>({});
  const [outline, setOutline] = useState(true);
  const [detail, setDetail] = useState<Detail>('balanced');
  const [showGrid, setShowGrid] = useState(true);
  const [beads, setBeads] = useState(true);
  const [selected, setSelected] = useState(0);
  const [bucket, setBucket] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const uploadId = useRef(0);
  const stroke = useRef<{ pointerId: number; cell: Cell; id: number; lineColor?: number } | null>(null);
  const strokeId = useRef(0);
  const [linePreview, setLinePreview] = useState<{ cells: number[]; color: number } | null>(null);

  const base = useMemo(() => source ? convert(source, size, outline, detail) : Array<number>(size * size).fill(-1),
    [source, size, outline, detail]);
  const history = histories[size] ?? emptyHistory;
  const edits = history.current;
  const grid = useMemo(() => base.map((color, i) => edits.get(i) ?? color), [base, edits]);
  const counts = useMemo(() => palette.map((c, i) => ({ ...c, count: grid.filter(v => v === i).length }))
    .filter(c => c.count > 0).sort((a, b) => b.count - a.count), [grid]);
  const total = counts.reduce((n, c) => n + c.count, 0);

  const estimatedCm = (size * 0.26).toFixed(1);

  useEffect(() => {
    if (!canvas.current) return;
    const preview = linePreview ? [...grid] : grid;
    if (linePreview) {
      for (const index of linePreview.cells) preview[index] = linePreview.color;
    }
    draw(canvas.current, preview, size, showGrid, beads);
  }, [grid, size, showGrid, beads, linePreview]);

  function cancelStroke() {
    stroke.current = null;
    setLinePreview(null);
  }

  async function upload(file?: File) {
    if (!file) return;
    const id = ++uploadId.current;
    if (!imageTypes.has(file.type) && (file.type || !/\.(png|jpe?g|webp)$/i.test(file.name))) {
      setError('Selecciona una imagen PNG, JPG o WebP.');
      return;
    }
    setError('');

    try {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reader.onabort = reject;
        reader.readAsDataURL(file);
      });
      if (id !== uploadId.current) return;
      const image = new Image();
      image.src = url;
      await image.decode();
      if (id !== uploadId.current) return;
      setSource(image);
      cancelStroke();
      setHistories({});
    } catch {
      if (id === uploadId.current) {
        setError('No se pudo abrir la imagen. Se conservó el patrón actual.');
      }
    }
  }

  function paint(e: React.PointerEvent<HTMLCanvasElement>) {
    const target = e.currentTarget;
    const previous = stroke.current;
    const startingLine = e.type === 'pointerdown' && e.button === 2;
    if (e.type === 'pointerdown') {
      if ((e.button !== 0 && !startingLine) || previous) return;
    } else if (previous?.pointerId !== e.pointerId) {
      return;
    }

    const bounds = target.getBoundingClientRect();
    const toCell = (offset: number, length: number, pixels: number) =>
      Math.floor((offset / length * pixels - coordinateMargin) / cellSize);
    const x = toCell(e.clientX - bounds.left - target.clientLeft, target.clientWidth, target.width);
    const y = toCell(e.clientY - bounds.top - target.clientTop, target.clientHeight, target.height);
    if (e.type === 'pointerdown') {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      if (startingLine || !bucket) target.setPointerCapture(e.pointerId);
    }
    const cell = {
      x: Math.max(0, Math.min(size - 1, x)),
      y: Math.max(0, Math.min(size - 1, y)),
    };
    if (startingLine) {
      stroke.current = { pointerId: e.pointerId, cell, id: ++strokeId.current, lineColor: selected };
      setLinePreview({ cells: [cell.y * size + cell.x], color: selected });
      return;
    }
    if (previous?.lineColor !== undefined) {
      const cells = lineCells(previous.cell, cell, size);
      if (e.type === 'pointerup') commitCells(cells, previous.lineColor, previous.id);
      else setLinePreview({ cells, color: previous.lineColor });
      return;
    }
    if (bucket) {
      setHistories(old => {
        const current = old[size] ?? emptyHistory;
        const next = fillRegion(base, current.current, size, cell.y * size + cell.x, selected);
        if (next === current.current) return old;
        return {
          ...old,
          [size]: {
            past: [...current.past, current.current],
            current: next,
            future: [],
          },
        };
      });
      return;
    }

    const id = previous?.id ?? ++strokeId.current;
    stroke.current = { pointerId: e.pointerId, cell, id };
    commitCells(lineCells(previous?.cell ?? cell, cell, size), selected, id);
  }

  function commitCells(cells: number[], color: number, id: number) {
    setHistories(old => {
      const current = old[size] ?? emptyHistory;
      const next = new Map(current.current);
      let changed = false;
      for (const index of cells) {
        if (next.get(index) !== color) {
          next.set(index, color);
          changed = true;
        }
      }
      if (!changed) return old;
      return {
        ...old,
        [size]: {
          past: current.strokeId === id ? current.past : [...current.past, current.current],
          current: next,
          future: [],
          strokeId: id,
        },
      };
    });
  }

  function finishStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    if (stroke.current?.pointerId !== e.pointerId) return;
    if (e.type === 'pointerup' && stroke.current.lineColor !== undefined) paint(e);
    cancelStroke();
  }

  function clearPattern() {
    cancelStroke();
    setHistories(old => {
      const current = old[size] ?? emptyHistory;
      if (base.every((color, index) => (current.current.get(index) ?? color) === -1)) return old;
      return {
        ...old,
        [size]: {
          past: [...current.past, current.current],
          current: new Map(base.map((_, index) => [index, -1])),
          future: [],
        },
      };
    });
  }

  function undo() {
    cancelStroke();
    setHistories(old => {
      const current = old[size] ?? emptyHistory;
      const previous = current.past.at(-1);
      if (!previous) return old;
      return {
        ...old,
        [size]: {
          past: current.past.slice(0, -1),
          current: previous,
          future: [...current.future, current.current],
        },
      };
    });
  }

  function redo() {
    cancelStroke();
    setHistories(old => {
      const current = old[size] ?? emptyHistory;
      const next = current.future.at(-1);
      if (!next) return old;
      return {
        ...old,
        [size]: {
          past: [...current.past, current.current],
          current: next,
          future: current.future.slice(0, -1),
        },
      };
    });
  }

  async function exportPNG() {
    try {
      const png = await renderPNG(grid, size, showGrid, beads);
      download(`patron-hama-${size}x${size}.png`, png);
    } catch {
      setError('No se pudo generar el PNG.');
    }
  }

  async function exportVariants() {
    setExporting(true);
    try {
      const variants = [
        { grid: true, beads: true, name: 'con-cuadricula-circulares' },
        { grid: true, beads: false, name: 'con-cuadricula-cuadradas' },
        { grid: false, beads: true, name: 'sin-cuadricula-circulares' },
        { grid: false, beads: false, name: 'sin-cuadricula-cuadradas' },
      ];
      const prefix = `patron-hama-${size}x${size}`;
      const entries = await Promise.all(variants.map(async variant => {
        const png = await renderPNG(grid, size, variant.grid, variant.beads);
        return [`${prefix}-${variant.name}.png`, new Uint8Array(await png.arrayBuffer())] as const;
      }));
      const [csv, countImage] = await Promise.all([
        countCSV(counts, total).arrayBuffer(),
        countPNG(counts, total, grid.length).then(png => png.arrayBuffer()),
      ]);
      const zip = zipSync({
        ...Object.fromEntries(entries),
        'conteo-hama.csv': new Uint8Array(csv),
        'conteo-hama.png': new Uint8Array(countImage),
      }, { level: 0 });
      download(`${prefix}-variantes.zip`, new Blob([Uint8Array.from(zip)], { type: 'application/zip' }));
    } catch {
      setError('No se pudo generar el paquete ZIP.');
    } finally {
      setExporting(false);
    }
  }
  function exportCSV() {
    download('conteo-hama.csv', countCSV(counts, total));
  }

  function exportProject() {
    const edits: ProjectFile['edits'] = {};
    for (const gridSize of gridSizes) {
      const current = histories[gridSize]?.current;
      if (current?.size) edits[gridSize] = [...current];
    }
    const project: ProjectFile = {
      format: 'hama-beads-studio',
      version: 1,
      size,
      source: source?.src ?? null,
      detail,
      outline,
      showGrid,
      beads,
      edits,
    };
    download(`patron-hama-${size}x${size}.hama`, new Blob([JSON.stringify(project)], {
      type: 'application/json',
    }));
  }

  async function importProject(file?: File) {
    if (!file) return;
    const id = ++uploadId.current;
    setError('');
    try {
      const { project, histories: savedHistories } = readProject(await file.text());
      let image: HTMLImageElement | null = null;
      if (project.source) {
        image = new Image();
        image.src = project.source;
        await image.decode();
      }
      if (id !== uploadId.current) return;
      cancelStroke();
      setSource(image);
      setSize(project.size);
      setDetail(project.detail);
      setOutline(project.outline);
      setShowGrid(project.showGrid);
      setBeads(project.beads);
      setHistories(savedHistories);
    } catch {
      if (id === uploadId.current) {
        setError('No se pudo abrir el proyecto. Selecciona un archivo .hama válido.');
      }
    }
  }

  return (
    <main>
      <header>
        <div>
          <span className="eyebrow">HAMA BEADS STUDIO · V0.2.0</span>
          <h1>De imagen a patrón de cuentas</h1>
          <p>Convierte, ajusta y cuenta cada cuenta de tu diseño.</p>
        </div>
        <span className="chip">{size} × {size}</span>
      </header>

      <div className="layout">
        <section className="panel preview">
          <div className="panelhead">
            <h2>Patrón editable</h2>
            <div className="history-actions">
              <button
                onClick={undo}
                disabled={history.past.length === 0}
                aria-label="Deshacer"
                title="Revierte el último cambio en esta cuadrícula."
              >
                <FaUndo aria-hidden="true" />
              </button>
              <button
                onClick={redo}
                disabled={history.future.length === 0}
                aria-label="Rehacer"
                title="Vuelve a aplicar el último cambio que deshiciste."
              >
                <FaRedo aria-hidden="true" />
              </button>
              <button
                onClick={() => {
                  cancelStroke();
                  setBucket(active => !active);
                }}
                aria-label="Cubeta de relleno"
                aria-pressed={bucket}
                title={bucket
                  ? 'Desactiva la cubeta y vuelve al pincel.'
                  : 'Rellena una zona conectada del mismo color con un clic.'}
              >
                <FaFillDrip aria-hidden="true" />
              </button>
            </div>
            <span>{total} cuentas</span>
          </div>
          <div className="canvaswrap">
            <canvas
              ref={canvas}
              onPointerDown={paint}
              onContextMenu={e => e.preventDefault()}
              onPointerMove={paint}
              onPointerUp={finishStroke}
              onPointerCancel={finishStroke}
              onLostPointerCapture={finishStroke}
              aria-label={`Patrón editable de ${size} por ${size}`}
              title="Usa el botón izquierdo para pintar y arrastra con el derecho para trazar una línea recta."
            />
          </div>
          <div className="actions">
            <button onClick={exportPNG} title="Descarga el patrón con las opciones de vista actuales.">
              Descargar PNG
            </button>
            <button
              onClick={exportVariants}
              disabled={exporting}
              title="Descarga las cuatro variantes del patrón y el conteo por color en un ZIP."
            >
              {exporting ? 'Preparando ZIP…' : 'Descargar variantes ZIP'}
            </button>
            <button onClick={exportCSV} title="Descarga una tabla con la cantidad de cuentas de cada color.">
              Exportar CSV
            </button>
            <button onClick={exportProject} title="Guarda un archivo .hama editable con la imagen, las opciones y tus retoques.">
              Guardar proyecto
            </button>
            <button onClick={clearPattern} title="Vacía la cuadrícula actual. Puedes revertirlo con Deshacer.">
              Limpiar
            </button>
          </div>
          <div className="actions">
            <input
              ref={projectInput}
              type="file"
              accept=".hama"
              hidden
              onChange={e => {
                void importProject(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => projectInput.current?.click()}
              title="Abre un archivo .hama y reemplaza el proyecto actual por el guardado."
            >
              Abrir proyecto
            </button>
          </div>
          <p className="hint">
            Tamaño estimado con cuentas de 2.6 mm: {estimatedCm} × {estimatedCm} cm. El tamaño real depende de la
            separación entre clavijas.
          </p>
        </section>

        <section className="panel controls">
          <h2>Imagen de origen</h2>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={e => {
              void upload(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            className="primary"
            onClick={() => input.current?.click()}
            title="Elige una imagen PNG, JPG o WebP para convertirla en un patrón."
          >
            Subir imagen
          </button>
          <div
            className="drop"
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              upload(e.dataTransfer.files[0]);
            }}
          >
            {source ? (
              <img src={source.src} alt="Imagen cargada" />
            ) : (
              <div>
                Arrastra una imagen aquí
                <br />
                <small>PNG · JPG · WebP</small>
              </div>
            )}
          </div>
          {error && <p className="error" role="alert">{error}</p>}

          <h2>Conversión</h2>
          <label title="Elige cuántas filas y columnas tendrá el patrón.">
            Tamaño de cuadrícula
            <select
              value={size}
              onChange={e => {
                const nextSize = gridSizes.find(option => String(option) === e.target.value);
                if (nextSize === undefined) return;
                cancelStroke();
                setSize(nextSize);
              }}
            >
              {gridSizes.map(option => (
                <option key={option} value={option}>{option} × {option}</option>
              ))}
            </select>
          </label>
          <label title="Ajusta el máximo de colores de la conversión automática.">
            Nivel de detalle
            <select value={detail} onChange={e => setDetail(e.target.value as Detail)}>
              <option value="simple">Simple (hasta 8 colores)</option>
              <option value="balanced">Equilibrado (hasta 14 colores)</option>
              <option value="detailed">Detallado (hasta 26 colores)</option>
            </select>
          </label>
          <label className="toggle" title="Resalta con negro los bordes detectados en la imagen.">
            <input type="checkbox" checked={outline} onChange={e => setOutline(e.target.checked)} />
            {' Priorizar contornos negros'}
          </label>
          <label className="toggle" title="Muestra u oculta las líneas que separan las celdas.">
            <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} />
            {' Mostrar cuadrícula'}
          </label>
          <label className="toggle" title="Alterna entre cuentas circulares y celdas cuadradas.">
            <input type="checkbox" checked={beads} onChange={e => setBeads(e.target.checked)} />
            {' Mostrar cuentas circulares'}
          </label>
          <p className="hint">
            La imagen se ajusta sin deformarse. Los espacios transparentes quedan vacíos.
            Haz clic o arrastra para pintar. Arrastra con el botón derecho para trazar una línea recta.
          </p>
        </section>

        <section className="panel palette">
          <h2>Paleta y materiales</h2>
          <p className="hint">
            Selecciona un color para pintar el patrón. El cuadro blanco con una X borra cuentas.
          </p>
          <div className="swatches">
            <button
              className={selected === -1 ? 'active' : ''}
              onClick={() => setSelected(-1)}
              title="Selecciona el borrador para quitar cuentas del patrón."
            >
              ×
            </button>
            {palette.map((c, i) => (
              <button
                key={c.hex}
                className={selected === i ? 'active' : ''}
                style={{ background: c.hex }}
                onClick={() => setSelected(i)}
                title={`Selecciona ${c.name} (${c.hex}) para pintar o rellenar.`}
                aria-label={c.name}
              />
            ))}
          </div>

          <h3>Conteo por color</h3>
          {counts.length === 0 ? (
            <p className="hint">Carga una imagen para ver el conteo.</p>
          ) : (
            <div className="countlist">
              {counts.map(c => (
                <div key={c.hex} className="countrow">
                  <span className="dot" style={{ background: c.hex }} />
                  <span>{c.name}</span>
                  <small>{c.hex}</small>
                  <strong>{c.count}</strong>
                </div>
              ))}
            </div>
          )}
          <div className="total">
            <span>Total</span>
            <strong>{total} / {grid.length}</strong>
          </div>
          <p className="hint">
            Paleta genérica de 26 colores. Los nombres y tonos no equivalen todavía a los
            códigos comerciales Babeefly.
          </p>
        </section>
      </div>

      <footer>Prototipo local · Sin subida de imágenes a servidores</footer>
    </main>
  );
}
