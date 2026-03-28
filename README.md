# hackmisso-tech

**ClearRisk** — cyber safety questionnaire (HackMISSO-style A–D questions), FastAPI scoring, optional **Gemini 2.5 Flash** recommendations, passive **domain / email-auth / HTTPS** checks, and a React (Vite) frontend.

## Repository layout

| Path | Description |
|------|-------------|
| `main.py` | FastAPI app (`/api/analyze`, `/api/domain-scan`) |
| `domain_security.py` | DNS / SPF / DMARC / HTTPS / TLS helpers |
| `assessment_questions.json` | Question text, categories, options, and risk weights |
| `requirements.txt` | Python dependencies |
| `frontend/` | React + Vite UI |
| `stitch_clearrisk_assessment_view/` | Additional Stitch / design exports |

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

Optional — AI recommendations (otherwise the API uses built-in fallbacks). Set environment variables **before** starting uvicorn (see `.env.example`):

```bash
set GEMINI_API_KEY=your_key_here
set GEMINI_MODEL=gemini-2.5-flash
```

Never commit API keys. If a key was shared in chat or checked into git, **revoke it** in Google AI Studio and create a new one.

Run the API:

```bash
uvicorn main:app --reload --port 8000
```

## API

- `POST /api/analyze` — JSON body: one answer per question id (`q1`…`q20`), values `A` | `B` | `C` | `D`.
- `POST /api/domain-scan` — JSON body: `{ "domain": "example.com" }` (URL or hostname accepted).

## Frontend

```bash
npm run install:all
# or: cd frontend && npm install

npm run dev
```

Opens the Vite dev server (default port `5173`) with `/api` proxied to `http://127.0.0.1:8000`. Start the backend first so analysis and domain scan succeed.

Production build:

```bash
npm run build
```

## License

See repository owner for licensing.
