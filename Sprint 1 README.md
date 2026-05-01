# OCT Image Annotator

## Development

### One command

```bash
./run.sh
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8787`

### Setup only

```bash
./run.sh setup
```

### Frontend only

```bash
./run.sh frontend
```

### Backend only

```bash
./run.sh backend
```

Next.js UI is in `web/`. Install: `cd web && npm install`, then `npm run dev`.

Python venv (optional tooling): `python3 -m venv venv && ./venv/bin/pip install -r requirements.txt`.
