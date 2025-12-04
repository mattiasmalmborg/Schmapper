# Schmapper - Quickstart Guide

## Using Claude Code with This Project

### Starting Claude Code

```bash
# Navigate to the project root directory
cd C:\dev\Schmapper

# Start Claude Code (from project root)
claude code
```

Claude Code will:
- Load the project context from `CLAUDE.md`
- Have access to all project files
- Help with code modifications, debugging, and development

### Useful Claude Code Commands

While in Claude Code session:
- `/help` - Get help with Claude Code features
- Ask about code: "explain how the batch processing works"
- Request changes: "add error handling to the upload endpoint"
- Debug issues: "why is the backend connection failing?"

## Prerequisites

- Python 3.8+ with pip
- Node.js 14+ with npm
- Git (optional, for version control)
- Claude Code CLI (for AI-assisted development)

## First Time Setup

### 1. Backend Setup

```bash
# Navigate to backend directory
cd backend

# Install Python dependencies
pip install -r requirements.txt

# Configure environment variables (optional)
# Edit backend/.env to customize settings
```

### 2. Frontend Setup

```bash
# Navigate to frontend directory
cd frontend

# Install Node dependencies
npm install
```

## Starting the Application

### Start Backend Server

```bash
cd backend
python main.py
```

The backend API will be available at:
- **API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

### Start Frontend Development Server

```bash
cd frontend
npm start
```

The frontend will open automatically at http://localhost:3000

## Environment Configuration

Edit `backend/.env` to customize settings:

### Debug Mode
```env
# Enable detailed logging (default: False)
SCHMAPPER_DEBUG=True
```

### CORS Settings
```env
# Allowed origins for API access (default: http://localhost:3000)
# For production, specify your domain:
ALLOWED_ORIGINS=https://yourdomain.com

# Multiple origins (comma-separated):
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
```

## Common Tasks

### Running Tests (Frontend)
```bash
cd frontend
npm test
```

### Production Build (Frontend)
```bash
cd frontend
npm run build
```

### Viewing API Documentation
Start the backend and visit: http://localhost:8000/docs

## Troubleshooting

### Backend Connection Error
If frontend shows `ERR_CONNECTION_REFUSED`:
1. Ensure backend is running (`cd backend && python main.py`)
2. Check that port 8000 is not in use
3. Verify CORS settings in `.env`

### Backend Not Loading Changes
After code changes, restart the backend:
1. Stop current process (Ctrl+C)
2. Restart: `python main.py`

### Port Already in Use
- Backend (8000): Check for other FastAPI instances
- Frontend (3000): React will offer alternative port

## Project Structure

```
Schmapper/
├── backend/
│   ├── main.py          # FastAPI application
│   ├── requirements.txt # Python dependencies
│   └── .env            # Environment configuration
├── frontend/
│   ├── src/
│   │   └── App.js      # React application
│   └── package.json    # Node dependencies
└── Schemas/            # XSD schema files
```

## Key Features

- **Schema Parsing**: Upload CSV or XSD schemas
- **Field Mapping**: Map source to target fields with transforms
- **Batch Processing**: Process multiple files at once
- **Transform Functions**: uppercase, lowercase, trim, concat, replace, etc.
- **Repeating Elements**: Handle complex XML structures

## Next Steps

For detailed architecture and development information, see:
- `CLAUDE.md` - Project overview and architecture
- Frontend README: `frontend/README.md`
- API documentation: http://localhost:8000/docs (when backend is running)
