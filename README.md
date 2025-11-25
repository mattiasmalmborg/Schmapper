# Schmapper

A visual data schema mapping tool that transforms CSV data to XML format with flexible field mapping and transformations.

## Features

- **Visual Schema Mapping** - Drag-and-drop interface for mapping CSV columns to XML elements
- **Transform Functions** - Built-in transforms (uppercase, lowercase, trim, concat, replace, regex, format, default, sanitize)
- **Repeating Elements** - Support for complex nested structures with multiple aggregation modes
- **Batch Processing** - Process multiple files at once with configurable folder naming
- **Constants Management** - Define reusable constant values across mappings

## Installation

### Backend
```bash
pip install -r backend/requirements.txt
```

### Frontend
```bash
cd frontend
npm install
```

## Usage

### Start Backend
```bash
cd backend
python main.py
```
Backend runs on `http://localhost:8000`

### Start Frontend
```bash
cd frontend
npm start
```
Frontend runs on `http://localhost:3000`

## How It Works

1. Upload CSV and XSD schemas
2. Map source fields to target fields using drag-and-drop
3. Configure transforms and aggregation modes
4. Process batch of CSV files to generate XML output

## Tech Stack

**Backend**
- FastAPI
- Python 3.x
- lxml (XML processing)

**Frontend**
- React 19
- Tailwind CSS
- Lucide React (icons)

## API Documentation

Visit `http://localhost:8000/docs` when backend is running for interactive API documentation.
