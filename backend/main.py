# backend/main.py
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import pandas as pd
import lxml.etree as ET
from pathlib import Path
import json
import re
import io
import uuid
import os
from collections import defaultdict

# Security constants
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
MAX_REGEX_LENGTH = 500  # Maximum length for regex patterns
MAX_XML_SIZE = 50 * 1024 * 1024  # 50MB for XML files
ALLOWED_FILE_EXTENSIONS = {'.csv', '.xsd', '.xml'}

# Optional: Root directory restriction (set via environment variable)
ROOT_DIRECTORY = os.environ.get('SCHMAPPER_ROOT_DIR', None)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class SchemaField(BaseModel):
    id: str
    name: str
    type: str
    path: str

class Schema(BaseModel):
    name: str
    type: str
    fields: List[SchemaField]
    repeating_elements: Optional[List[Dict[str, Any]]] = []  # NEW

class MappingParams(BaseModel):
    separator: Optional[str] = None
    from_: Optional[str] = None
    to: Optional[str] = None
    defaultValue: Optional[str] = None
    pattern: Optional[str] = None
    replacement: Optional[str] = None
    format: Optional[str] = None
    split_at: Optional[str] = None
    allowed_chars: Optional[str] = None
    mergeSeparator: Optional[str] = None

class Mapping(BaseModel):
    id: str
    source: List[str]
    target: str
    transform: Optional[str] = None
    transforms: Optional[List[str]] = None
    params: MappingParams = MappingParams()
    aggregation: Optional[str] = "foreach"
    # NEW: For repeating element support
    loop_element_path: Optional[str] = None
    target_wrapper_path: Optional[str] = None
    is_relative_path: Optional[bool] = False
    is_container: Optional[bool] = False
    child_mappings: Optional[List[str]] = []
    parent_repeat_container: Optional[str] = None

class Constant(BaseModel):
    id: str
    name: str
    value: str
    type: Optional[str] = "constant"

class BatchProcessRequest(BaseModel):
    source_path: str
    target_path: str
    source_schema: Schema
    target_schema: Schema
    mappings: List[Mapping]
    folder_naming: str = "guid"
    folder_naming_fields: Optional[List[str]] = None
    constants: Optional[List[Constant]] = None

# Security helper functions
def validate_path(path: str) -> Path:
    """Validate and resolve a file system path."""
    try:
        resolved_path = Path(path).resolve()
        
        if '..' in str(path):
            raise HTTPException(status_code=400, detail="Path traversal detected")
        
        if ROOT_DIRECTORY:
            root = Path(ROOT_DIRECTORY).resolve()
            if not str(resolved_path).startswith(str(root)):
                raise HTTPException(
                    status_code=400, 
                    detail=f"Path must be within {ROOT_DIRECTORY}"
                )
        
        return resolved_path
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=400, detail=f"Invalid path: {str(e)}")

def validate_file_size(content: bytes, max_size: int = MAX_FILE_SIZE) -> None:
    """Validate that file content doesn't exceed maximum size."""
    if len(content) > max_size:
        raise HTTPException(
            status_code=400, 
            detail=f"File too large. Maximum size is {max_size / 1024 / 1024}MB"
        )

def validate_file_extension(filename: str) -> None:
    """Validate that file has an allowed extension."""
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_FILE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(ALLOWED_FILE_EXTENSIONS)}"
        )

def create_safe_xml_parser():
    """Create a secure XML parser that prevents XXE and XML bomb attacks."""
    return ET.XMLParser(
        resolve_entities=False,
        no_network=True,
        huge_tree=False,
        remove_comments=True,
        remove_pis=True
    )

def sanitize_xpath(xpath: str) -> str:
    """Sanitize XPath to prevent injection attacks"""
    dangerous_chars = [';', '|', '&', '$', '`']
    for char in dangerous_chars:
        xpath = xpath.replace(char, '')
    return xpath

def deduplicate_fields(fields: List[Dict]) -> List[Dict]:
    """Remove duplicate fields based on XPath (path)"""
    seen_paths = {}
    unique_fields = []
    
    for field in fields:
        path = field.get('path', field.get('name', ''))
        
        if path not in seen_paths:
            seen_paths[path] = True
            unique_fields.append(field)
        else:
            print(f"  [DEDUP] Removing duplicate: {path}")
    
    print(f"[DEDUP] {len(fields)} → {len(unique_fields)} unique fields")
    return unique_fields

# NEW: Repeating element detection functions
def detect_repeating_elements(root: ET._Element) -> List[Dict]:
    """
    Detect which elements repeat in the XML structure.
    Returns list of repeating element info with their fields and sample data.
    """
    repeating = []
    processed_paths = set()
    
    def traverse(element, path=''):
        current_path = f"{path}/{element.tag}" if path else element.tag
        
        # Group children by tag
        children_by_tag = defaultdict(list)
        for child in element:
            tag = child.tag
            if '}' in tag:
                tag = tag.split('}')[1]
            children_by_tag[tag].append(child)
        
        # Check for repeating children
        for tag, children in children_by_tag.items():
            if len(children) > 1:
                child_path = f"{current_path}/{tag}"
                
                if child_path in processed_paths:
                    continue
                processed_paths.add(child_path)
                
                # Analyze structure of first instance
                sample_fields = extract_repeating_element_fields(children[0], child_path)
                
                repeating.append({
                    'path': child_path,
                    'parent_path': current_path,
                    'tag': tag,
                    'count': len(children),
                    'fields': sample_fields,
                    'sample_data': extract_sample_data(children[0])
                })
        
        # Continue traversing
        for tag, children in children_by_tag.items():
            traverse(children[0], current_path)
    
    traverse(root)
    return repeating

def extract_repeating_element_fields(element: ET._Element, base_path: str) -> List[Dict]:
    """Extract all fields from a repeating element with relative paths"""
    fields = []
    
    def traverse_fields(elem, path, is_root=False):
        tag = elem.tag
        if '}' in tag:
            tag = tag.split('}')[1]
        
        current_path = path if is_root else f"{path}/{tag}"
        relative_path = f"./{tag}" if not is_root else "."
        
        # Add text content if exists
        if elem.text and elem.text.strip():
            field_id = f"field-{current_path.replace('/', '-')}"
            fields.append({
                'id': field_id,
                'path': current_path,
                'relative_path': relative_path,
                'type': 'string',
                'tag': tag,
                'name': tag
            })
        
        # Add attributes
        for attr in elem.attrib:
            field_id = f"field-{current_path.replace('/', '-')}-{attr}"
            fields.append({
                'id': field_id,
                'path': f"{current_path}/@{attr}",
                'relative_path': f"{relative_path}/@{attr}",
                'type': 'string',
                'tag': f"{tag}@{attr}",
                'name': f"{tag}@{attr}"
            })
        
        # Traverse children
        for child in elem:
            traverse_fields(child, current_path, False)
    
    traverse_fields(element, base_path, True)
    return fields

def extract_sample_data(element: ET._Element) -> Dict:
    """Extract sample data from an element"""
    data = {}
    
    tag = element.tag
    if '}' in tag:
        tag = tag.split('}')[1]
    
    if element.text and element.text.strip():
        data['_text'] = element.text.strip()[:100]
    
    for attr, value in element.attrib.items():
        data[f"@{attr}"] = str(value)[:100]
    
    child_counts = defaultdict(int)
    for child in element:
        child_tag = child.tag
        if '}' in child_tag:
            child_tag = child_tag.split('}')[1]
        child_counts[child_tag] += 1
    
    for child in element:
        child_tag = child.tag
        if '}' in child_tag:
            child_tag = child_tag.split('}')[1]
        
        if child_counts[child_tag] == 1:
            if child.text and child.text.strip():
                data[child_tag] = child.text.strip()[:100]
    
    return data

@app.get("/")
async def root():
    return {"message": "Schmapper Backend API", "version": "2.1 (Repeating Elements)"}

@app.post("/api/parse-csv-schema")
async def parse_csv_schema(file: UploadFile = File(...)):
    """Parse CSV and extract schema"""
    try:
        validate_file_extension(file.filename)
        content = await file.read()
        validate_file_size(content)
        
        # Try to parse as XML first
        try:
            parser = create_safe_xml_parser()
            root = ET.fromstring(content, parser=parser)
            return await parse_xml_as_source(content, file.filename)
        except:
            pass
        
        df = pd.read_csv(io.BytesIO(content), nrows=0)
        
        fields = []
        for idx, col in enumerate(df.columns):
            path = col
            display_name = col
            
            if '_' in col or '/' in col:
                parts = col.replace('_', '/').split('/')
                display_name = parts[-1]
                path = col.replace('_', '/')
            
            fields.append({
                "id": f"src-{idx}",
                "name": display_name,
                "type": "string",
                "path": path
            })
        
        fields = deduplicate_fields(fields)
        
        return {
            "name": file.filename,
            "type": "csv",
            "fields": fields,
            "repeating_elements": []
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error parsing CSV: {str(e)}")

async def parse_xml_as_source(content: bytes, filename: str):
    """Parse XML/XSD for source schema with repeating element detection"""
    try:
        validate_file_size(content, MAX_XML_SIZE)
        parser = create_safe_xml_parser()
        root = ET.fromstring(content, parser=parser)
        xsd_ns = 'http://www.w3.org/2001/XMLSchema'
        
        fields = []
        idx = 0
        named_types = {}
        
        is_xsd = root.tag.endswith('schema') or xsd_ns in root.tag
        
        if is_xsd:
            # Parse as XSD schema
            for ct in root.findall(f'{{{xsd_ns}}}complexType[@name]'):
                type_name = ct.get('name')
                if type_name:
                    named_types[type_name] = ct
            
            print(f"[SOURCE XSD] Found {len(named_types)} named types")
            
            repeating_elements_info = []
            
            def is_repeatable(elem):
                max_occurs = elem.get('maxOccurs', '1')
                return max_occurs == 'unbounded' or (max_occurs.isdigit() and int(max_occurs) > 1)
            
            def extract_fields_from_complex_type(base_path, ct_elem):
                extracted_fields = []
                seq = ct_elem.find(f'{{{xsd_ns}}}sequence')
                if seq is not None:
                    for child_elem in seq.findall(f'{{{xsd_ns}}}element'):
                        child_name = child_elem.get('name')
                        child_type = child_elem.get('type', 'string')
                        if child_name:
                            field_id = f"field-{base_path.replace('/', '-')}-{child_name}"
                            extracted_fields.append({
                                'id': field_id,
                                'path': f"{base_path}/{child_name}",
                                'relative_path': f"./{child_name}",
                                'type': child_type.split(':')[-1] if ':' in child_type else child_type,
                                'tag': child_name,
                                'name': child_name
                            })
                return extracted_fields
            
            def process_element(elem, path_so_far):
                nonlocal idx
                
                name = elem.get('name')
                if not name:
                    return
                
                current_path = f"{path_so_far}/{name}" if path_so_far else name
                
                # Check if repeatable
                if is_repeatable(elem):
                    print(f"[SOURCE XSD] Found repeatable element: {current_path} (maxOccurs={elem.get('maxOccurs')})")
                    
                    repeating_info = {
                        'path': current_path,
                        'parent_path': path_so_far,
                        'tag': name,
                        'count': elem.get('maxOccurs', 'unbounded'),
                        'fields': [],
                        'sample_data': {}
                    }
                    
                    inline_ct = elem.find(f'{{{xsd_ns}}}complexType')
                    type_ref = elem.get('type')
                    
                    if inline_ct is not None:
                        repeating_info['fields'] = extract_fields_from_complex_type(current_path, inline_ct)
                    elif type_ref:
                        clean_type = type_ref.split(':')[-1]
                        type_def = named_types.get(clean_type)
                        if type_def is not None:
                            repeating_info['fields'] = extract_fields_from_complex_type(current_path, type_def)
                    
                    repeating_elements_info.append(repeating_info)
                
                inline_ct = elem.find(f'{{{xsd_ns}}}complexType')
                type_ref = elem.get('type')
                
                if inline_ct is not None:
                    seq = inline_ct.find(f'{{{xsd_ns}}}sequence')
                    if seq is not None:
                        for child_elem in seq.findall(f'{{{xsd_ns}}}element'):
                            process_element(child_elem, current_path)
                    else:
                        fields.append({
                            "id": f"src-{idx}",
                            "name": name,
                            "type": type_ref.split(':')[-1] if type_ref else "string",
                            "path": current_path
                        })
                        idx += 1
                elif type_ref:
                    clean_type = type_ref.split(':')[-1]
                    type_def = named_types.get(clean_type)
                    
                    if type_def is not None:
                        seq = type_def.find(f'{{{xsd_ns}}}sequence')
                        if seq is not None:
                            for child_elem in seq.findall(f'{{{xsd_ns}}}element'):
                                process_element(child_elem, current_path)
                        else:
                            fields.append({
                                "id": f"src-{idx}",
                                "name": name,
                                "type": clean_type,
                                "path": current_path
                            })
                            idx += 1
                    else:
                        fields.append({
                            "id": f"src-{idx}",
                            "name": name,
                            "type": clean_type,
                            "path": current_path
                        })
                        idx += 1
                else:
                    fields.append({
                        "id": f"src-{idx}",
                        "name": name,
                        "type": "string",
                        "path": current_path
                    })
                    idx += 1
            
            root_elements = root.findall(f'{{{xsd_ns}}}element[@name]')
            print(f"[SOURCE XSD] Found {len(root_elements)} root elements")
            
            for root_elem in root_elements:
                process_element(root_elem, "")
            
            repeating_elements = repeating_elements_info
            print(f"[SOURCE XSD] Detected {len(repeating_elements)} repeatable elements from maxOccurs")
        else:
            # Parse as data XML
            print(f"[SOURCE XML] Parsing data XML")
            
            def extract_fields_from_data(elem, path=""):
                nonlocal idx
                
                tag = elem.tag
                if '}' in tag:
                    tag = tag.split('}')[1]
                
                current_path = f"{path}/{tag}" if path else tag
                
                has_text = elem.text and elem.text.strip()
                has_children = len(elem) > 0
                
                if has_text and not has_children:
                    fields.append({
                        "id": f"src-{idx}",
                        "name": tag,
                        "type": "string",
                        "path": current_path
                    })
                    idx += 1
                
                for child in elem:
                    extract_fields_from_data(child, current_path)
            
            extract_fields_from_data(root, "")
            
            repeating_elements = detect_repeating_elements(root)
            print(f"[SOURCE XML] Found {len(repeating_elements)} repeating element types")
        
        print(f"[SOURCE] Parsed {len(fields)} fields before dedup")
        fields = deduplicate_fields(fields)
        
        for f in fields[:10]:
            print(f"  {f['name']}: {f['path']}")
        
        return {
            "name": filename,
            "type": "xml",
            "fields": fields,
            "repeating_elements": repeating_elements
        }
        
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/parse-xsd-schema")
async def parse_xsd_schema(file: UploadFile = File(...)):
    """Parse XSD for target schema"""
    try:
        validate_file_extension(file.filename)
        content = await file.read()
        validate_file_size(content, MAX_XML_SIZE)
        
        try:
            parser = create_safe_xml_parser()
            root = ET.fromstring(content, parser=parser)
        except ET.XMLSyntaxError as e:
            raise HTTPException(status_code=400, detail=f"Invalid XML/XSD: {str(e)}")
        
        xsd_ns = 'http://www.w3.org/2001/XMLSchema'
        
        fields = []
        idx = 0
        named_types = {}
        
        for ct in root.findall(f'{{{xsd_ns}}}complexType[@name]'):
            type_name = ct.get('name')
            if type_name:
                named_types[type_name] = ct
        
        print(f"[TARGET] Found {len(named_types)} named types")
        
        def process_element(elem, path_so_far):
            nonlocal idx
            
            name = elem.get('name')
            if not name:
                return
            
            current_path = f"{path_so_far}/{name}" if path_so_far else name
            
            inline_ct = elem.find(f'{{{xsd_ns}}}complexType')
            type_ref = elem.get('type')
            
            if inline_ct is not None:
                seq = inline_ct.find(f'{{{xsd_ns}}}sequence')
                if seq is not None:
                    for child_elem in seq.findall(f'{{{xsd_ns}}}element'):
                        process_element(child_elem, current_path)
                else:
                    fields.append({
                        "id": f"tgt-{idx}",
                        "name": name,
                        "type": type_ref.split(':')[-1] if type_ref else "string",
                        "path": current_path
                    })
                    idx += 1
            elif type_ref:
                clean_type = type_ref.split(':')[-1]
                type_def = named_types.get(clean_type)
                
                if type_def is not None:
                    seq = type_def.find(f'{{{xsd_ns}}}sequence')
                    if seq is not None:
                        for child_elem in seq.findall(f'{{{xsd_ns}}}element'):
                            process_element(child_elem, current_path)
                    else:
                        fields.append({
                            "id": f"tgt-{idx}",
                            "name": name,
                            "type": clean_type,
                            "path": current_path
                        })
                        idx += 1
                else:
                    fields.append({
                        "id": f"tgt-{idx}",
                        "name": name,
                        "type": clean_type,
                        "path": current_path
                    })
                    idx += 1
            else:
                fields.append({
                    "id": f"tgt-{idx}",
                    "name": name,
                    "type": "string",
                    "path": current_path
                })
                idx += 1
        
        root_elements = root.findall(f'{{{xsd_ns}}}element[@name]')
        print(f"[TARGET] Found {len(root_elements)} root elements")
        
        for root_elem in root_elements:
            process_element(root_elem, "")
        
        print(f"[TARGET] Parsed {len(fields)} fields before dedup")
        fields = deduplicate_fields(fields)
        
        for f in fields[:10]:
            print(f"  {f['name']}: {f['path']}")
        
        if not fields:
            raise HTTPException(
                status_code=400,
                detail="Could not parse XSD. No elements found."
            )
        
        return {
            "name": file.filename,
            "type": "xml",
            "fields": fields,
            "repeating_elements": []
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=400, detail=f"Error parsing XSD: {str(e)}")

def validate_and_transform_value(value: str, field_type: str, field_name: str) -> str:
    """Validate and transform value according to XSD type"""
    
    if not value or value == '':
        return ''
    
    value_str = str(value).strip()
    
    try:
        if field_type in ['string', 'xs:string']:
            import re
            cleaned = re.sub(r'[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]', '', value_str)
            return cleaned
        
        elif field_type in ['date', 'xs:date']:
            import re
            if re.match(r'^\d{4}-\d{2}-\d{2}$', value_str):
                from datetime import datetime
                try:
                    datetime.strptime(value_str, '%Y-%m-%d')
                    return value_str
                except ValueError:
                    print(f"  [VALIDATION WARNING] Invalid date '{value_str}' for {field_name}")
                    return ''
            else:
                if re.match(r'^\d{8}$', value_str):
                    try:
                        return f"{value_str[0:4]}-{value_str[4:6]}-{value_str[6:8]}"
                    except:
                        pass
                print(f"  [VALIDATION WARNING] Date '{value_str}' for {field_name} doesn't match format")
                return ''
        
        elif field_type in ['dateTime', 'xs:dateTime']:
            import re
            if re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}', value_str):
                return value_str
            else:
                print(f"  [VALIDATION WARNING] DateTime '{value_str}' for {field_name} doesn't match format")
                return ''
        
        elif field_type in ['int', 'integer', 'xs:int', 'xs:integer']:
            try:
                int(value_str)
                return value_str
            except ValueError:
                import re
                numbers = re.findall(r'\d+', value_str)
                if numbers:
                    print(f"  [VALIDATION WARNING] Extracted integer '{numbers[0]}' from '{value_str}'")
                    return numbers[0]
                print(f"  [VALIDATION WARNING] Value '{value_str}' is not integer")
                return ''
        
        elif field_type in ['decimal', 'float', 'double', 'xs:decimal', 'xs:float', 'xs:double']:
            try:
                float(value_str)
                return value_str
            except ValueError:
                print(f"  [VALIDATION WARNING] Value '{value_str}' is not number")
                return ''
        
        elif field_type in ['boolean', 'xs:boolean']:
            lower_val = value_str.lower()
            if lower_val in ['true', '1', 'yes', 'ja']:
                return 'true'
            elif lower_val in ['false', '0', 'no', 'nej']:
                return 'false'
            else:
                print(f"  [VALIDATION WARNING] Value '{value_str}' is not boolean")
                return ''
        
        else:
            import re
            cleaned = re.sub(r'[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]', '', value_str)
            return cleaned
            
    except Exception as e:
        print(f"  [VALIDATION ERROR] Error validating '{value_str}': {e}")
        return ''

def apply_transform(value: str, transform: str, params: Dict[str, Any]) -> str:
    """Apply transformation to value"""
    if not value:
        value = ""
    
    if transform == 'none':
        return value
    
    elif transform == 'uppercase':
        return value.upper()
    
    elif transform == 'lowercase':
        return value.lower()
    
    elif transform == 'trim':
        return value.strip()
    
    elif transform == 'replace':
        from_val = params.get('from_', params.get('from', ''))
        to_val = params.get('to', '')
        
        if len(from_val) > MAX_REGEX_LENGTH:
            print(f"  [TRANSFORM ERROR] 'from' value too long")
            return value
        
        if from_val:
            return value.replace(from_val, to_val)
        return value
    
    elif transform == 'regex':
        pattern = params.get('pattern', '')
        replacement = params.get('replacement', '')
        
        if len(pattern) > MAX_REGEX_LENGTH:
            print(f"  [TRANSFORM ERROR] Regex pattern too long")
            return value
        
        if pattern:
            try:
                python_replacement = replacement
                for i in range(10):
                    python_replacement = python_replacement.replace(f'${i}', f'\\{i}')
                
                return re.sub(pattern, python_replacement, value)
            except Exception as e:
                print(f"  [TRANSFORM ERROR] Regex failed: {e}")
                return value
        return value
    
    elif transform == 'format':
        format_string = params.get('format', '')
        if format_string:
            try:
                split_at = params.get('split_at', '')
                if split_at:
                    positions = [int(x.strip()) for x in split_at.split(',')]
                    parts = []
                    last_pos = 0
                    for pos in positions:
                        parts.append(value[last_pos:pos])
                        last_pos = pos
                    parts.append(value[last_pos:])
                    return format_string.format(*parts)
                else:
                    return format_string.format(value)
            except Exception as e:
                print(f"  [TRANSFORM ERROR] Format failed: {e}")
                return value
        return value
    
    elif transform == 'default':
        return value if value else params.get('defaultValue', '')
    
    elif transform == 'sanitize':
        allowed_chars = params.get('allowed_chars', 'a-zA-Z0-9\\s\\-_.,')
        pattern = f'[^{allowed_chars}]'
        return re.sub(pattern, '', value)
    
    return value

def apply_mappings_to_row(row: Dict, mappings: List[Mapping], source_schema: Schema, target_schema: Schema, constants: List[Constant] = None) -> Dict[str, str]:
    """Apply mappings to a single row of data"""
    result = {}
    
    source_fields_by_id = {f.id: f for f in source_schema.fields}
    target_fields_by_id = {f.id: f for f in target_schema.fields}
    constants_by_id = {c.id: c for c in (constants or [])}
    
    print(f"\n[MAPPING] Processing row with {len(row)} fields")
    
    for mapping in mappings:
        # Skip container mappings (they don't map data directly)
        if mapping.is_container:
            continue
            
        source_values = []
        
        for src_id in mapping.source:
            if src_id.startswith('const-'):
                const = constants_by_id.get(src_id)
                if const:
                    source_values.append(const.value)
                    print(f"  [CONSTANT] {const.name} = {const.value}")
                else:
                    source_values.append('')
            else:
                source_field = source_fields_by_id.get(src_id)
                if source_field:
                    value = None
                    
                    if source_field.path in row:
                        value = row[source_field.path]
                    elif source_field.name in row:
                        value = row[source_field.name]
                    else:
                        path_parts = source_field.path.split('/')
                        for i in range(len(path_parts)):
                            partial_path = '/'.join(path_parts[i:])
                            if partial_path in row:
                                value = row[partial_path]
                                break
                    
                    if value is not None:
                        source_values.append(str(value))
                        print(f"  [FIELD] {source_field.name} = {value}")
                    else:
                        source_values.append('')
        
        transforms_to_apply = []
        if mapping.transforms:
            transforms_to_apply = mapping.transforms
        elif mapping.transform:
            transforms_to_apply = [mapping.transform]
        
        if 'concat' in transforms_to_apply:
            separator = mapping.params.separator if mapping.params.separator is not None else ' '
            value = separator.join(source_values)
            transforms_to_apply = [t for t in transforms_to_apply if t != 'concat']
        else:
            value = source_values[0] if source_values else ''
        
        for transform in transforms_to_apply:
            if transform and transform != 'none':
                value = apply_transform(value, transform, mapping.params.dict())
        
        target_field = target_fields_by_id.get(mapping.target)
        if target_field:
            validated_value = validate_and_transform_value(value, target_field.type, target_field.name)
            result[target_field.path] = validated_value
            print(f"  → TARGET: {target_field.name} = {validated_value}")
    
    return result

def create_xml_from_data(data: Dict[str, str], schema: Schema, root_element_name: str = "Record") -> ET.Element:
    """Create XML element from data dictionary following schema field order"""
    
    print(f"\n[XML CREATE] Creating XML with {len(data)} mapped fields")
    
    root = None
    elements = {}
    
    for field in schema.fields:
        path_parts = field.path.split('/')
        value = data.get(field.path, '')
        
        for i in range(len(path_parts)):
            partial_path = '/'.join(path_parts[:i+1])
            
            if partial_path not in elements:
                elem_name = path_parts[i]
                elem = ET.Element(elem_name)
                elements[partial_path] = elem
                
                if i == 0:
                    root = elem
                else:
                    parent_path = '/'.join(path_parts[:i])
                    parent = elements.get(parent_path)
                    if parent is not None:
                        parent.append(elem)
        
        leaf_elem = elements[field.path]
        leaf_elem.text = str(value) if value else ""
        
        if value:
            print(f"  {field.path} = '{value}'")
    
    if root is None:
        root = ET.Element(root_element_name)
    
    return root

def parse_xml_to_dict(xml_content: bytes) -> Dict[str, str]:
    """Parse XML content to flat dictionary with full paths as keys"""
    try:
        validate_file_size(xml_content, MAX_XML_SIZE)
        parser = create_safe_xml_parser()
        root = ET.fromstring(xml_content, parser=parser)
        result = {}
        
        def extract_with_path(elem, path=""):
            tag = elem.tag
            if '}' in tag:
                tag = tag.split('}')[1]
            
            current_path = f"{path}/{tag}" if path else tag
            
            has_text = elem.text and elem.text.strip()
            has_children = len(elem) > 0
            
            if has_text and not has_children:
                result[current_path] = elem.text.strip()
            
            for child in elem:
                extract_with_path(child, current_path)
        
        extract_with_path(root, "")
        return result
        
    except Exception as e:
        import traceback
        print(f"[XML PARSE ERROR] {e}")
        print(traceback.format_exc())
        raise Exception(f"Failed to parse XML: {str(e)}")

# NEW: Apply repeating element mappings
def apply_repeating_mappings_to_xml(
    source_root: ET._Element, 
    target_root: ET._Element,
    mappings: List[Mapping],
    source_schema: Schema,
    target_schema: Schema,
    constants: List[Constant] = None
) -> int:
    """
    Apply repeating element mappings to XML.
    Returns the number of instances created.
    """
    total_instances = 0
    
    # Get all container mappings
    container_mappings = [m for m in mappings if m.is_container and m.aggregation == 'repeat']
    
    for container in container_mappings:
        if not container.loop_element_path or not container.target_wrapper_path:
            continue
        
        # Find child mappings
        child_mappings = [m for m in mappings if m.parent_repeat_container == container.id]
        
        if not child_mappings:
            print(f"[REPEAT] No child mappings for container {container.id}")
            continue
        
        safe_loop_path = sanitize_xpath(container.loop_element_path)
        search_path = safe_loop_path.lstrip('/')
        
        try:
            loop_elements = source_root.xpath(f".//{search_path}")
            
            if not loop_elements:
                print(f"[REPEAT] No elements found at path: {safe_loop_path}")
                continue
            
            print(f"[REPEAT] Found {len(loop_elements)} instances of {container.loop_element_path}")
            
            source_fields_by_id = {f.id: f for f in source_schema.fields}
            target_fields_by_id = {f.id: f for f in target_schema.fields}
            constants_by_id = {c.id: c for c in (constants or [])}
            
            for idx, loop_elem in enumerate(loop_elements):
                print(f"\n[REPEAT] Processing instance {idx + 1}")
                
                # Extract data from this instance
                instance_data = {}
                
                def extract_from_element(elem, path=""):
                    tag = elem.tag
                    if '}' in tag:
                        tag = tag.split('}')[1]
                    
                    current_path = f"{path}/{tag}" if path else tag
                    
                    if elem.text and elem.text.strip():
                        instance_data[current_path] = elem.text.strip()
                        instance_data[tag] = elem.text.strip()
                    
                    for attr, val in elem.attrib.items():
                        instance_data[f"{current_path}/@{attr}"] = val
                        instance_data[f"{tag}/@{attr}"] = val
                    
                    for child in elem:
                        extract_from_element(child, current_path)
                
                extract_from_element(loop_elem, "")
                
                # Create target wrapper element
                target_parts = container.target_wrapper_path.strip('/').split('/')
                current = target_root
                
                for i, part in enumerate(target_parts[:-1]):
                    child = current.find(part)
                    if child is None:
                        child = ET.SubElement(current, part)
                    current = child
                
                wrapper_elem = ET.SubElement(current, target_parts[-1])
                total_instances += 1
                
                # Apply child mappings for this instance
                for mapping in child_mappings:
                    source_values = []
                    
                    for src_id in mapping.source:
                        if src_id.startswith('const-'):
                            const = constants_by_id.get(src_id)
                            value = const.value if const else ''
                        else:
                            source_field = source_fields_by_id.get(src_id)
                            if not source_field:
                                continue
                            
                            value = None
                            
                            if source_field.path in instance_data:
                                value = instance_data[source_field.path]
                            elif source_field.name in instance_data:
                                value = instance_data[source_field.name]
                            else:
                                path_parts = source_field.path.split('/')
                                for i in range(len(path_parts)):
                                    partial = '/'.join(path_parts[i:])
                                    if partial in instance_data:
                                        value = instance_data[partial]
                                        break
                            
                            if value is None:
                                value = ''
                        
                        source_values.append(str(value))
                    
                    # Apply transforms
                    transforms_to_apply = mapping.transforms if mapping.transforms else ([mapping.transform] if mapping.transform else [])
                    
                    if 'concat' in transforms_to_apply:
                        separator = mapping.params.separator if mapping.params.separator is not None else ' '
                        value = separator.join(source_values)
                        transforms_to_apply = [t for t in transforms_to_apply if t != 'concat']
                    else:
                        value = source_values[0] if source_values else ''
                    
                    for transform in transforms_to_apply:
                        if transform and transform != 'none':
                            value = apply_transform(value, transform, mapping.params.dict())
                    
                    # Set in target
                    target_field = target_fields_by_id.get(mapping.target)
                    if target_field:
                        validated_value = validate_and_transform_value(value, target_field.type, target_field.name)
                        
                        target_path_parts = target_field.path.split('/')
                        wrapper_depth = len(target_parts)
                        relative_parts = target_path_parts[wrapper_depth:]
                        
                        current_elem = wrapper_elem
                        for part in relative_parts[:-1]:
                            child = current_elem.find(part)
                            if child is None:
                                child = ET.SubElement(current_elem, part)
                            current_elem = child
                        
                        final_tag = relative_parts[-1]
                        final_elem = current_elem.find(final_tag)
                        if final_elem is None:
                            final_elem = ET.SubElement(current_elem, final_tag)
                        final_elem.text = validated_value
                        
                        print(f"  [REPEAT] Set {target_field.path} = {validated_value}")
            
        except Exception as e:
            import traceback
            print(f"[REPEAT ERROR] {e}")
            print(traceback.format_exc())
    
    return total_instances

@app.post("/api/batch-process")
async def batch_process(request: BatchProcessRequest):
    """Process all files in source directory with repeating element support"""
    try:
        constants = request.constants or []
        
        source_path = validate_path(request.source_path)
        target_path = validate_path(request.target_path)
        
        if not source_path.exists():
            raise HTTPException(status_code=404, detail=f"Source path not found: {source_path}")
        
        if not source_path.is_dir():
            raise HTTPException(status_code=400, detail="Source path must be a directory")
        
        target_path.mkdir(parents=True, exist_ok=True)
        
        processed_files = 0
        processed_records = 0
        errors = []
        
        # Separate mappings by type
        direct_mappings = [m for m in request.mappings if not m.is_container]
        
        print(f"\n[BATCH] {len(direct_mappings)} direct mappings")
        
        # Handle CSV files
        if request.source_schema.type == 'csv':
            csv_files = list(source_path.glob("*.csv"))
            
            if not csv_files:
                raise HTTPException(status_code=404, detail="No CSV files found")
            
            for csv_file in csv_files:
                try:
                    print(f"\n[CSV] Processing: {csv_file.name}")
                    df = pd.read_csv(csv_file)
                    
                    for idx, row in df.iterrows():
                        transformed = apply_mappings_to_row(
                            row.to_dict(), 
                            direct_mappings, 
                            request.source_schema, 
                            request.target_schema,
                            constants
                        )
                        
                        # Create folder name
                        if request.folder_naming == "guid":
                            folder_name = str(uuid.uuid4())
                        else:
                            if request.folder_naming_fields:
                                name_parts = []
                                for field_path in request.folder_naming_fields:
                                    value = transformed.get(field_path, '')
                                    name_parts.append(str(value))
                                folder_name = '_'.join(name_parts).replace(' ', '_')
                            else:
                                folder_name = str(uuid.uuid4())
                        
                        output_folder = target_path / folder_name
                        output_folder.mkdir(parents=True, exist_ok=True)
                        
                        xml_root = create_xml_from_data(transformed, request.target_schema, "Record")
                        tree = ET.ElementTree(xml_root)
                        output_file = output_folder / f"{folder_name}.xml"
                        tree.write(str(output_file), encoding='utf-8', xml_declaration=True, pretty_print=True)
                        
                        processed_records += 1
                    
                    processed_files += 1
                
                except Exception as e:
                    import traceback
                    error_msg = f"Error processing {csv_file.name}: {str(e)}"
                    print(f"[ERROR] {error_msg}")
                    print(traceback.format_exc())
                    errors.append(error_msg)
        
        # Handle XML files
        elif request.source_schema.type == 'xml':
            xml_files = list(source_path.glob("*.xml"))
            
            if not xml_files:
                raise HTTPException(status_code=404, detail="No XML files found")
            
            for xml_file in xml_files:
                try:
                    print(f"\n[XML] Processing: {xml_file.name}")
                    
                    with open(xml_file, 'rb') as f:
                        xml_content = f.read()
                    
                    parser = create_safe_xml_parser()
                    source_root = ET.fromstring(xml_content, parser=parser)
                    
                    source_data = parse_xml_to_dict(xml_content)
                    
                    transformed = apply_mappings_to_row(
                        source_data,
                        direct_mappings,
                        request.source_schema,
                        request.target_schema,
                        constants
                    )
                    
                    # Create folder name
                    if request.folder_naming == "guid":
                        folder_name = str(uuid.uuid4())
                    elif request.folder_naming == "filename":
                        folder_name = xml_file.stem
                    else:
                        if request.folder_naming_fields:
                            name_parts = []
                            for field_path in request.folder_naming_fields:
                                value = transformed.get(field_path, '')
                                name_parts.append(str(value))
                            folder_name = '_'.join(name_parts).replace(' ', '_')
                        else:
                            folder_name = str(uuid.uuid4())
                    
                    output_folder = target_path / folder_name
                    output_folder.mkdir(parents=True, exist_ok=True)
                    
                    target_root = create_xml_from_data(transformed, request.target_schema, "Record")
                    
                    # Apply repeating element mappings
                    instances = apply_repeating_mappings_to_xml(
                        source_root,
                        target_root,
                        request.mappings,
                        request.source_schema,
                        request.target_schema,
                        constants
                    )
                    
                    if instances > 0:
                        print(f"[XML] Created {instances} repeating element instances")
                    
                    tree = ET.ElementTree(target_root)
                    output_file = output_folder / f"{folder_name}.xml"
                    tree.write(str(output_file), encoding='utf-8', xml_declaration=True, pretty_print=True)
                    
                    processed_files += 1
                    processed_records += 1
                
                except Exception as e:
                    import traceback
                    error_msg = f"Error processing {xml_file.name}: {str(e)}"
                    print(f"[ERROR] {error_msg}")
                    print(traceback.format_exc())
                    errors.append(error_msg)
        
        return {
            "success": True,
            "processed_files": processed_files,
            "processed_records": processed_records,
            "output_path": str(target_path),
            "errors": errors if errors else None
        }
    
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[BATCH ERROR] {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Batch process error: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    print("Starting Schmapper Backend v2.1 (Repeating Elements Support)...")
    print("API docs: http://localhost:8000/docs")
    uvicorn.run(app, host="0.0.0.0", port=8000)