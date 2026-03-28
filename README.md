# hackmisso-tech

RoostGuard — security posture questionnaire with FastAPI scoring, optional Gemini-powered recommendations, and a React (Vite) frontend.

## Repository layout

| Path | Description |
|------|-------------|
| `main.py` | FastAPI app (`/api/analyze`) |
| `requirements.txt` | Python dependencies |
| `frontend/` | React + Vite UI |
| `stitch_clearrisk_assessment_view/` | Additional Stitch / design exports (ClearRisk flows) |

## Prerequisites

- Python 3.11+ recommended  
- Node.js 18+ and npm  

## Backend

```bash
python -m venv .venv
.venv\Scripts\activate   # Windows
# source .venv/bin/activate   # macOS / Linux

pip install -r requirements.txt
```

Optional — AI recommendations (otherwise the API uses built-in fallbacks):

```bash
set GEMINI_API_KEY=your_key_here
set GEMINI_MODEL=gemini-1.5-flash
```

Run the API:

```bash
uvicorn main:app --reload --port 8000
```

## Frontend

```bash
npm run install:all
# or: cd frontend && npm install

npm run dev
```

Opens the Vite dev server (default port `5173`) with `/api` proxied to `http://127.0.0.1:8000`. Start the backend first so analysis requests succeed.

Production build:

```bash
npm run build
```

## License

See repository owner for licensing.
