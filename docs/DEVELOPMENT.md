# Development notes

## Where things live

| What you want to change | File or folder |
|-------------------------|----------------|
| Question text, options, risk **scores** | `assessment_questions.json` (repo root) |
| API routes, scoring math, Gemini prompts | `main.py` |
| Domain scan (DNS, SPF, HTTPS, etc.) | `domain_security.py` |
| UI, questionnaire flow, report, PDF export | `frontend/src/` (especially `App.jsx`, `pdfExport.js`) |
| Verify Gemini key from the server | `scripts/verify_gemini.py` |

## Local run order

1. **Backend:** `uvicorn main:app --reload --port 8000` (from repo root, after `pip install -r requirements.txt` and optional `.env`).
2. **Frontend:** `npm run install:all` then `npm run dev` (or `cd frontend && npm install && npm run dev`).

The Vite dev server proxies `/api/*` to `http://127.0.0.1:8000` — start the API first.

## Production split

- **Vercel:** deploy only the `frontend/` folder; set `VITE_API_BASE` to your API origin.
- **Render (or similar):** deploy repo root for FastAPI; use `runtime.txt` for Python version.

Details are in the main **README.md**.
