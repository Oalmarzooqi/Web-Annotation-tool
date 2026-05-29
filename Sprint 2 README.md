# OCT Image Annotator

Browser-based annotation tool for OCT (Optical Coherence Tomography) retinal volumes. Annotate slices across TIFF stacks, single images, and uncompressed DICOM files using **point**, **polygon** (filled), **line**, **freehand**, and **edit** tools. All annotations are stored in **original image coordinates** and export to a versioned **JSON schema**. See `Docs/Moduls.txt` for the full module list and `Docs/Sprint2/TechnicalReport.md` for the Sprint 2 implementation report.

## Stack

| Area | Tech |
|------|------|
| UI | React (Vite), TypeScript, Tailwind-style tokens in CSS |
| API | Node, Prisma (see `backend/`) |
| Workers | Off-thread decode: `frontend/src/workers/tiffWorker.ts`, `dicomWorker.ts` |
| Client storage | IndexedDB for cached volume blobs per project |

## Prerequisites (install on your machine)

| Software | Why |
|----------|-----|
| **Git** | Clone this repository |
| **Node.js + npm** | Frontend (Vite) and backend (Express + Prisma). Use a current **20.x** or **22.x** LTS (Prisma 7 expects a supported Node range). |
| **Python 3** | Optional tooling / scripts: `run.sh` can create a **venv** and install `requirements.txt` (NumPy, Pillow, pydicom for experiments). |

On macOS, [Homebrew](https://brew.sh) is a common way to install Node and Python: `brew install node python3`.

## Development

### One command (frontend + backend)

```bash
./run.sh
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8787`

This script ensures **npm dependencies** are installed when needed, runs **`prisma generate`** when the Prisma schema changes, creates **`venv/`** (if missing) and installs **Python requirements** when `requirements.txt` changes, then starts both servers.

### Setup only

```bash
./run.sh setup
```

**What `setup` does:**

1. **Frontend:** `npm ci` if `frontend/package-lock.json` exists, otherwise `npm install` (skips if lockfile unchanged — see `.run-cache/`).
2. **Backend:** same for `backend/`, then **`npx prisma generate`** if the client is missing or `prisma/schema.prisma` changed.
3. **Python:** creates `./venv` with `python3 -m venv venv` if it does not exist, then `pip install -r requirements.txt` (skips if `requirements.txt` unchanged).

**Manual equivalent** (if you do not use `run.sh`):

```bash
cd frontend && npm install
cd ../backend && npm install && npx prisma generate --schema prisma/schema.prisma
cd .. && python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
```
 
### Frontend only

```bash
./run.sh frontend
```

### Frontend lint + production build

```bash
./run.sh frontend:build
```

### Backend only

```bash
./run.sh backend
```

### Database migrations

```bash
./run.sh backend:migrate
```

## Repository layout

- `frontend/` — Vite app (annotate canvas, projects UI)
- `backend/` — API and Prisma schema
- `Docs/` — module checklist (`Moduls.txt`), requirements mapping, project notes
- `Docs/Sprint1/` — Sprint 1 artefacts (technical report §A–B, showcase slides, team artefacts)
- `Docs/Sprint2/` — **Sprint 2** technical report §C–E (`TechnicalReport.md`) and showcase slides (`ShowcaseSlides.md`)

## Annotate UI

### Slice navigation
Buttons, slider, trackpad horizontal scroll / two-finger swipe (where supported).

### Drawing tools

| Tool | How to use |
|------|------------|
| **Point** | Single click — places a dot |
| **Line** | Two clicks — first sets start, second commits the segment |
| **Polygon** | Click to add vertices; double-click / Enter / Finish button closes shape |
| **Freehand** | Click-drag — live polyline follows cursor; release commits; **Esc** cancels mid-stroke |
| **Edit** | Click near a vertex to select; drag to move; Delete/Backspace removes annotation |
| **Pan** | Hand tool — click-drag scrolls the viewport |
| **Magnifier** | Hover lens renders a magnified sub-region; zoom level adjustable via slider |

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo |
| `Ctrl+S` / `Cmd+S` | Save to cloud |
| `Enter` | Finish polygon (when 3+ points placed) |
| `Esc` | Cancel draft / deselect edit selection / return to point mode |
| `Delete` / `Backspace` | Delete selected annotation (edit mode) |

### Label palette

- **Default labels:** ILM (`#1d4ed8`), RPE (`#c2410c`), NFL (`#6d28d9`)
- Click a label to **activate** it — new annotations inherit its color; click again to deactivate.
- **Add:** type a name and press Enter or click Add — random saturated color assigned.
- **Delete:** confirmation dialog; removes the label and all its annotations across every slice.
- **Show All Layers** toggle: show all labels simultaneously or only the active label.

### Save / Load / Export

| Action | How |
|--------|-----|
| **Save (cloud)** | `Ctrl+S` — pushes to backend database |
| **Save As** | Toolbar button — native OS dialog (Chrome/Edge) or browser download fallback |
| **Load** | Toolbar button — pick a `.json` file to restore annotations and labels |
| **Clear all** | Toolbar trash button — confirmation required |

The **Python venv** is for optional local tooling (see `requirements.txt`); the main app runs on **Node** only.

## JSON Export Schema

Exported annotation files conform to the following JSON structure:

```json
{
  "version": 1,
  "projectName": "Example OCT Project",
  "labels": [
    {
      "id": "cmo0lccqt0002oo4ventioizz",
      "name": "ILM",
      "color": "#10b981"
    }
  ],
  "annotationsBySlice": {
    "0": [
      {
        "id": "ann-1713218204000",
        "labelId": "cmo0lccqt0002oo4ventioizz",
        "type": "point",
        "points": [
          { "x": 120.5, "y": 340.2 }
        ]
      },
      {
        "id": "ann-1713218215000",
        "labelId": "cmo0lccqt0002oo4ventioizz",
        "type": "polygon",
        "points": [
          { "x": 100, "y": 100 },
          { "x": 150, "y": 100 },
          { "x": 150, "y": 150 },
          { "x": 100, "y": 150 }
        ]
      }
    ]
  }
}
```

### Fields Description

- **`version`**: Schema format version number.
- **`projectName`**: Name of the annotated project.
- **`labels`**: Array of layer/surface definitions, each with a unique `id`, human-readable `name`, and hex `color` code.
- **`annotationsBySlice`**: Map of zero-indexed slice numbers to an array of shape annotations.
  - **`id`**: Unique identifier for the annotation.
  - **`labelId`**: Reference to the layer definition in the `labels` array.
  - **`type`**: The drawing mode used (`point`, `line`, `polygon`, `freehand`).
  - **`points`**: Array of `{ x, y }` coordinates in original image space.
