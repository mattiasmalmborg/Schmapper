from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator, model_validator
from typing import List, Dict, Any, Optional
import pandas as pd
import lxml.etree as ET
from pathlib import Path
import re
import io
import uuid
import os
from collections import defaultdict

# Security constants
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
MAX_REGEX_LENGTH = 500
MAX_XML_SIZE = 50 * 1024 * 1024  # 50MB
ALLOWED_FILE_EXTENSIONS = {'.csv', '.xsd', '.xml'}
MAX_BATCH_FILES = 100000

ROOT_DIRECTORY = os.environ.get('SCHMAPPER_ROOT_DIR', None)
DEBUG = os.environ.get('SCHMAPPER_DEBUG', 'False').lower() == 'true'

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# PYDANTIC MODELS (unchanged)
# ============================================================================

class SchemaField(BaseModel):
    id: str
    name: str
    type: str
    path: str
    repeatable: Optional[bool] = False
    maxOccurs: Optional[str] = "1"
    order: Optional[int] = 999999  # XSD sequence order for correct element positioning

class Schema(BaseModel):
    name: str
    type: str
    fields: List[SchemaField]
    repeating_elements: Optional[List[Dict[str, Any]]] = []
    namespace: Optional[str] = None

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

class MappingCondition(BaseModel):
    """Condition for filtering which source elements to map"""
    field: str  # Which field to check: "@name", "value", "@dataType", etc.
    operator: str  # "equals", "contains", "startswith", "regex", "exists"
    value: Optional[str] = None  # Value to compare against (not needed for "exists")

class Mapping(BaseModel):
    id: str
    source: List[str]
    target: str
    transform: Optional[str] = None
    transforms: Optional[List[str]] = None
    params: MappingParams = MappingParams()
    aggregation: Optional[str] = "foreach"
    loop_element_path: Optional[str] = None
    target_wrapper_path: Optional[str] = None
    is_relative_path: Optional[bool] = False
    is_container: Optional[bool] = False
    child_mappings: Optional[List[str]] = []
    parent_repeat_container: Optional[str] = None
    repeat_to_single: Optional[bool] = False
    conditions: Optional[List[MappingCondition]] = None  # Filter conditions for conditional mapping

    @model_validator(mode='before')
    @classmethod
    def extract_params_from_transforms(cls, data):
        """Extract params from transform objects BEFORE field validation

        Frontend sends: transforms=[{id, type, params}, ...]
        We need to:
        1. Extract params from each transform object
        2. Merge them into the params field
        3. Convert transform objects to strings

        This runs before all field validators so we have access to raw transform objects.
        """
        if not isinstance(data, dict):
            return data

        transforms = data.get('transforms', [])
        params = data.get('params', {})

        # Initialize params dict if needed
        if params is None:
            params = {}
        elif not isinstance(params, dict):
            params = {}

        # Extract params from transform objects
        if transforms and isinstance(transforms, list):
            if DEBUG:
                print(f"[MODEL VALIDATOR] Processing {len(transforms)} transforms")

            converted_transforms = []
            for i, item in enumerate(transforms):
                if isinstance(item, dict):
                    # Extract type for transforms list
                    transform_type = item.get('type', '')
                    converted_transforms.append(transform_type)

                    # Extract params and merge
                    if 'params' in item and isinstance(item['params'], dict):
                        if DEBUG:
                            print(f"[MODEL VALIDATOR] Transform {i} ({transform_type}): merging params {item['params']}")
                        params.update(item['params'])
                else:
                    # Already a string
                    converted_transforms.append(item)

            # Update transforms with converted list
            data['transforms'] = converted_transforms

        # Update params
        data['params'] = params

        if DEBUG:
            print(f"[MODEL VALIDATOR] Final params: {params}")

        return data

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


# ============================================================================
# SECURITY HELPERS (unchanged)
# ============================================================================

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
    if len(content) > max_size:
        raise HTTPException(
            status_code=400, 
            detail=f"File too large. Maximum size is {max_size / 1024 / 1024}MB"
        )


def validate_file_extension(filename: str) -> None:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_FILE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(ALLOWED_FILE_EXTENSIONS)}"
        )


def create_safe_xml_parser():
    return ET.XMLParser(
        resolve_entities=False,
        no_network=True,
        huge_tree=False,
        remove_comments=True,
        remove_pis=True
    )


def sanitize_xpath(xpath: str) -> str:
    dangerous_chars = [';', '|', '&', '$', '`']
    for char in dangerous_chars:
        xpath = xpath.replace(char, '')
    return xpath


def deduplicate_fields(fields: List[Dict]) -> List[Dict]:
    seen_paths = {}
    unique_fields = []

    for field in fields:
        path = field.get('path', field.get('name', ''))

        if path not in seen_paths:
            seen_paths[path] = True
            unique_fields.append(field)
        elif DEBUG:
            print(f"  [DEDUP] Removing duplicate: {path}")

    if DEBUG:
        print(f"[DEDUP] {len(fields)} -> {len(unique_fields)} unique fields")
    return unique_fields


def extract_namespace(root: ET._Element) -> str:
    """Extract namespace from root element tag."""
    tag = root.tag
    if '}' in tag:
        ns_uri = tag.split('}')[0].strip('{')
        if DEBUG:
            print(f"[NAMESPACE] Detected namespace: {ns_uri}")
        return ns_uri
    return None


# ============================================================================
# IMPROVED PATH MATCHING (NEW)
# ============================================================================

class PathMatcher:
    """
    Improved path matching with multiple strategies.
    Handles various path formats for robust source data matching.
    """
    
    def __init__(self):
        self._cache: Dict[str, Dict[str, Optional[str]]] = {}
    
    def find_value(self, data: Dict[str, str], field_path: str, field_name: str = None) -> Optional[str]:
        """
        Find a value in data using multiple matching strategies.
        """
        # Strategy 1: Exact path match
        if field_path in data:
            return data[field_path]
        
        # Strategy 2: Field name match
        if field_name and field_name in data:
            return data[field_name]
        
        # Strategy 3: Partial paths (from end to beginning)
        path_parts = field_path.split('/')
        for i in range(len(path_parts)):
            partial = '/'.join(path_parts[i:])
            if partial in data:
                return data[partial]
        
        # Strategy 4: Case-insensitive field name match
        if field_name:
            field_name_lower = field_name.lower()
            for key in data:
                key_last_part = key.split('/')[-1].lower()
                if key_last_part == field_name_lower:
                    return data[key]
        
        return None
    
    def clear_cache(self):
        self._cache.clear()


# Global path matcher
path_matcher = PathMatcher()


# ============================================================================
# ELEMENT ORDER TRACKING (NEW)
# ============================================================================

class ElementOrderTracker:
    """
    Track element order based on target schema for correct XML element positioning.
    This ensures elements are inserted in XSD-compliant order.

    FIXED: Now uses 'order' field from XSD parsing to correctly position all elements,
    including repeating_elements wrappers.
    """

    def __init__(self, schema: Schema):
        # Build complete ordering from both fields AND repeating_elements
        # using the 'order' field set during XSD parsing
        all_elements = []

        # Add field paths with their order
        for idx, f in enumerate(schema.fields):
            # Handle both Pydantic models and dicts
            if hasattr(f, 'path'):
                path = f.path
                order = getattr(f, 'order', idx)  # Fallback to index if order missing
            else:
                path = f.get('path', '')
                order = f.get('order', idx)
            all_elements.append({'path': path, 'order': order})

        # Add repeating element wrapper paths with their order
        if hasattr(schema, 'repeating_elements') and schema.repeating_elements:
            for rep_elem in schema.repeating_elements:
                wrapper_path = rep_elem.get('wrapper_path') or rep_elem.get('path')
                order = rep_elem.get('order', 999999)
                if wrapper_path:
                    all_elements.append({'path': wrapper_path, 'order': order})

        # Sort by order to get correct XSD sequence
        all_elements.sort(key=lambda x: x['order'])

        self.field_paths = [e['path'] for e in all_elements]
        self._path_to_index = {path: i for i, path in enumerate(self.field_paths)}

        if DEBUG:
            print(f"[ORDER TRACKER] Initialized with {len(self.field_paths)} paths (sorted by XSD order)")
            for i, e in enumerate(all_elements[:25]):
                print(f"  {i}: {e['path']} (order={e['order']})")
    
    def get_order_index(self, path: str) -> int:
        """Get the schema-defined order index for a path."""
        if path in self._path_to_index:
            return self._path_to_index[path]
        
        # Try partial match
        for schema_path, idx in self._path_to_index.items():
            if schema_path.endswith('/' + path.split('/')[-1]):
                return idx
        
        return 999999  # Unknown paths go at end
    
    def get_insertion_index(self, parent: ET._Element, child_tag: str, parent_path: str = "") -> int:
        """
        Calculate correct insertion index for a child element.
        Returns the index where the new element should be inserted.
        """
        child_path = f"{parent_path}/{child_tag}" if parent_path else child_tag
        target_order = self.get_order_index(child_path)
        
        for i, existing_child in enumerate(parent):
            existing_tag = existing_child.tag.split('}')[-1] if '}' in existing_child.tag else existing_child.tag
            existing_path = f"{parent_path}/{existing_tag}" if parent_path else existing_tag
            existing_order = self.get_order_index(existing_path)
            
            if target_order < existing_order:
                return i
        
        return len(parent)
    
    def find_or_create_with_order(self, parent: ET._Element, tag: str, parent_path: str = "") -> ET._Element:
        """
        Find existing child or create new one at correct position.
        """
        # Check if exists
        for child in parent:
            child_tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag
            if child_tag == tag:
                return child
        
        # Create at correct position
        insert_idx = self.get_insertion_index(parent, tag, parent_path)
        new_elem = ET.Element(tag)
        parent.insert(insert_idx, new_elem)
        return new_elem


# ============================================================================
# REPEATING ELEMENT DETECTION (unchanged)
# ============================================================================

def detect_repeating_elements(root: ET._Element) -> List[Dict]:
    repeating = []
    processed_paths = set()
    
    def traverse(element, path=''):
        current_path = f"{path}/{element.tag}" if path else element.tag
        if '}' in current_path:
            current_path = re.sub(r'\{[^}]+\}', '', current_path)
        
        children_by_tag = defaultdict(list)
        for child in element:
            tag = child.tag
            if '}' in tag:
                tag = tag.split('}')[1]
            children_by_tag[tag].append(child)
        
        for tag, children in children_by_tag.items():
            if len(children) > 1:
                child_path = f"{current_path}/{tag}"
                
                if child_path in processed_paths:
                    continue
                processed_paths.add(child_path)
                
                sample_fields = extract_repeating_element_fields(children[0], child_path)
                
                repeating.append({
                    'path': child_path,
                    'parent_path': current_path,
                    'tag': tag,
                    'count': len(children),
                    'fields': sample_fields,
                    'sample_data': extract_sample_data(children[0])
                })
        
        for tag, children in children_by_tag.items():
            traverse(children[0], current_path)
    
    traverse(root)
    return repeating


def extract_repeating_element_fields(element: ET._Element, base_path: str) -> List[Dict]:
    fields = []
    
    def traverse_fields(elem, path, is_root=False):
        tag = elem.tag
        if '}' in tag:
            tag = tag.split('}')[1]
        
        current_path = path if is_root else f"{path}/{tag}"
        relative_path = f"./{tag}" if not is_root else "."
        
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
        
        for child in elem:
            traverse_fields(child, current_path, False)
    
    traverse_fields(element, base_path, True)
    return fields


def extract_sample_data(element: ET._Element) -> Dict:
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


# ============================================================================
# API ENDPOINTS - Schema parsing (unchanged structure, added field order)
# ============================================================================

@app.get("/")
async def root():
    return {"message": "Schmapper Backend API"}


@app.post("/api/parse-csv-schema")
async def parse_csv_schema(file: UploadFile = File(...)):
    """Parse CSV and extract schema"""
    try:
        validate_file_extension(file.filename)
        content = await file.read()
        validate_file_size(content)
        
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
                "path": path,
                "repeatable": False,
                "maxOccurs": "1",
                "order": idx  # Preserve column order from CSV
            })
        
        fields = deduplicate_fields(fields)
        
        return {
            "name": file.filename,
            "type": "csv",
            "fields": fields,
            "repeating_elements": [],
            "namespace": None
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error parsing CSV: {str(e)}")


async def parse_xml_as_source(content: bytes, filename: str):
    """Parse XML/XSD for source schema with repeating element detection and namespace"""
    try:
        validate_file_size(content, MAX_XML_SIZE)
        parser = create_safe_xml_parser()
        root = ET.fromstring(content, parser=parser)

        namespace = extract_namespace(root)

        xsd_ns = 'http://www.w3.org/2001/XMLSchema'
        
        fields = []
        idx = 0
        named_types = {}
        element_order = [0]  # Use list to allow modification in nested function

        is_xsd = root.tag.endswith('schema') or xsd_ns in root.tag
        
        if is_xsd:
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
                            current_order = element_order[0]
                            element_order[0] += 1
                            field_id = f"field-{base_path.replace('/', '-')}-{child_name}"
                            extracted_fields.append({
                                'id': field_id,
                                'path': f"{base_path}/{child_name}",
                                'relative_path': f"./{child_name}",
                                'type': child_type.split(':')[-1] if ':' in child_type else child_type,
                                'tag': child_name,
                                'name': child_name,
                                'order': current_order
                            })
                return extracted_fields
            
            def process_element(elem, path_so_far):
                nonlocal idx

                current_order = element_order[0]
                element_order[0] += 1

                name = elem.get('name')
                if not name:
                    return

                current_path = f"{path_so_far}/{name}" if path_so_far else name
                
                inline_ct = elem.find(f'{{{xsd_ns}}}complexType')
                type_ref = elem.get('type')
                
                # Check if element has complex content (child elements)
                has_complex_content = False
                if inline_ct is not None:
                    seq = inline_ct.find(f'{{{xsd_ns}}}sequence')
                    has_complex_content = seq is not None and len(seq) > 0
                elif type_ref:
                    clean_type = type_ref.split(':')[-1]
                    type_def = named_types.get(clean_type)
                    if type_def is not None:
                        seq = type_def.find(f'{{{xsd_ns}}}sequence')
                        has_complex_content = seq is not None and len(seq) > 0
                
                # Only treat as repeating WRAPPER if it has children
                if is_repeatable(elem) and has_complex_content:
                    print(f"[SOURCE XSD] Found repeatable WRAPPER: {current_path} (maxOccurs={elem.get('maxOccurs')})")
                    
                    repeating_info = {
                        'id': f'rep-src-{len(repeating_elements_info)}',
                        'path': current_path,
                        'parent_path': path_so_far,
                        'tag': name,
                        'name': name,
                        'count': elem.get('maxOccurs', 'unbounded'),
                        'fields': [],
                        'wrapper_path': current_path,
                        'sample_data': {}
                    }
                    
                    if inline_ct is not None:
                        repeating_info['fields'] = extract_fields_from_complex_type(current_path, inline_ct)
                    elif type_ref:
                        clean_type = type_ref.split(':')[-1]
                        type_def = named_types.get(clean_type)
                        if type_def is not None:
                            repeating_info['fields'] = extract_fields_from_complex_type(current_path, type_def)

                    # Sort fields by order to ensure correct XSD sequence
                    if repeating_info.get('fields'):
                        repeating_info['fields'] = sorted(
                            repeating_info['fields'],
                            key=lambda f: f.get('order', 999999)
                        )

                    repeating_elements_info.append(repeating_info)
                elif is_repeatable(elem):
                    print(f"[SOURCE XSD] Found repeatable FIELD (no wrapper): {current_path}")
                
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
                            "path": current_path,
                            "repeatable": False,
                            "maxOccurs": "1",
                            "order": current_order
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
                                "path": current_path,
                                "repeatable": False,
                                "maxOccurs": "1",
                                "order": current_order
                            })
                            idx += 1
                    else:
                        fields.append({
                            "id": f"src-{idx}",
                            "name": name,
                            "type": clean_type,
                            "path": current_path,
                            "repeatable": False,
                            "maxOccurs": "1",
                            "order": current_order
                        })
                        idx += 1
                else:
                    fields.append({
                        "id": f"src-{idx}",
                        "name": name,
                        "type": "string",
                        "path": current_path,
                        "repeatable": False,
                        "maxOccurs": "1",
                        "order": current_order
                    })
                    idx += 1
            
            root_elements = root.findall(f'{{{xsd_ns}}}element[@name]')
            print(f"[SOURCE XSD] Found {len(root_elements)} root elements")
            
            for root_elem in root_elements:
                process_element(root_elem, "")
            
            repeating_elements = repeating_elements_info
            print(f"[SOURCE XSD] Detected {len(repeating_elements)} repeatable elements from maxOccurs")
        else:
            print(f"[SOURCE XML] Parsing data XML")
            
            def extract_fields_from_data(elem, path=""):
                nonlocal idx

                current_order = element_order[0]
                element_order[0] += 1

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
                        "path": current_path,
                        "repeatable": False,
                        "maxOccurs": "1",
                        "order": current_order
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
            "repeating_elements": repeating_elements,
            "namespace": namespace
        }
        
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/parse-xsd-schema")
async def parse_xsd_schema(file: UploadFile = File(...)):
    """Parse XSD for target schema with namespace detection"""
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
        
        target_namespace = root.get('targetNamespace')
        print(f"[TARGET XSD] Target namespace: {target_namespace}")
        
        fields = []
        idx = 0
        named_types = {}
        repeating_elements_info = []
        element_order = [0]  # Use list to allow modification in nested function

        for ct in root.findall(f'{{{xsd_ns}}}complexType[@name]'):
            type_name = ct.get('name')
            if type_name:
                named_types[type_name] = ct

        print(f"[TARGET XSD] Found {len(named_types)} named types")

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
                        current_order = element_order[0]
                        element_order[0] += 1
                        field_id = f"field-{base_path.replace('/', '-')}-{child_name}"
                        extracted_fields.append({
                            'id': field_id,
                            'path': f"{base_path}/{child_name}",
                            'relative_path': f"./{child_name}",
                            'type': child_type.split(':')[-1] if ':' in child_type else child_type,
                            'tag': child_name,
                            'name': child_name,
                            'order': current_order  # Assign XSD sequence order
                        })
            return extracted_fields

        # Maximum recursion depth to prevent infinite loops from circular references
        MAX_RECURSION_DEPTH = 15  # Lowered - true recursion detection handles the rest

        def process_element(elem, path_so_far, depth=0, visited_types=None):
            """
            Process XSD element with TRUE recursion detection.

            Args:
                elem: XML element to process
                path_so_far: Current path in XSD hierarchy
                depth: Current nesting depth
                visited_types: Set of type names already visited in current path chain.
                              When same type appears again = recursion detected.
            """
            nonlocal idx

            # Initialize visited_types on first call
            if visited_types is None:
                visited_types = set()

            # Prevent infinite recursion from circular schema references (fallback)
            if depth > MAX_RECURSION_DEPTH:
                print(f"[TARGET XSD] WARNING: Max recursion depth ({MAX_RECURSION_DEPTH}) reached at path: {path_so_far}")
                return

            current_order = element_order[0]
            element_order[0] += 1

            name = elem.get('name')
            if not name:
                return

            current_path = f"{path_so_far}/{name}" if path_so_far else name
            max_occurs = elem.get('maxOccurs', '1')
            is_field_repeatable = max_occurs == 'unbounded' or (max_occurs.isdigit() and int(max_occurs) > 1)

            inline_ct = elem.find(f'{{{xsd_ns}}}complexType')
            type_ref = elem.get('type')

            # === TRUE RECURSION DETECTION ===
            current_type_name = None
            if type_ref:
                current_type_name = type_ref.split(':')[-1]
            elif inline_ct is not None:
                # For inline complexTypes, use a unique identifier based on element name
                current_type_name = f"inline:{name}"

            # Check if this type was already visited in this path chain
            if current_type_name and current_type_name in visited_types:
                print(f"[TARGET XSD] RECURSIVE TYPE detected: {current_type_name} at {current_path}")
                fields.append({
                    "id": f"tgt-{idx}",
                    "name": name,
                    "type": current_type_name,
                    "path": current_path,
                    "repeatable": is_field_repeatable,
                    "maxOccurs": max_occurs,
                    "order": current_order,
                    "isRecursive": True,  # Frontend uses this to show ↻ icon
                    "recursiveType": current_type_name  # Which type is recursive
                })
                idx += 1
                return  # STOP - don't expand this type further to avoid infinite loop

            # Create new visited set including current type for children
            new_visited = visited_types.copy()
            if current_type_name:
                new_visited.add(current_type_name)
            
            # CRITICAL: Check if element has complex content (child elements)
            # Only elements WITH children should be treated as repeating WRAPPERS
            # Elements WITHOUT children are just repeatable FIELDS
            has_complex_content = False
            if inline_ct is not None:
                seq = inline_ct.find(f'{{{xsd_ns}}}sequence')
                has_complex_content = seq is not None and len(seq) > 0
            elif type_ref:
                clean_type = type_ref.split(':')[-1]
                type_def = named_types.get(clean_type)
                if type_def is not None:
                    seq = type_def.find(f'{{{xsd_ns}}}sequence')
                    has_complex_content = seq is not None and len(seq) > 0
            
            # Only add to repeating_elements if it's a WRAPPER (has children)
            if is_repeatable(elem) and has_complex_content:
                print(f"[TARGET XSD] Found repeatable WRAPPER element: {current_path} (maxOccurs={max_occurs}, order={current_order})")

                repeating_info = {
                    'id': f'rep-tgt-{len(repeating_elements_info)}',
                    'path': current_path,
                    'parent_path': path_so_far,
                    'tag': name,
                    'name': name,
                    'maxOccurs': max_occurs,
                    'count': max_occurs,
                    'fields': [],
                    'wrapper_path': current_path,
                    'sample_data': {},
                    'order': current_order  # Track XSD sequence order
                }

                if inline_ct is not None:
                    repeating_info['fields'] = extract_fields_from_complex_type(current_path, inline_ct)
                elif type_ref:
                    clean_type = type_ref.split(':')[-1]
                    type_def = named_types.get(clean_type)
                    if type_def is not None:
                        repeating_info['fields'] = extract_fields_from_complex_type(current_path, type_def)

                # Sort fields by order to ensure correct XSD sequence
                if repeating_info.get('fields'):
                    repeating_info['fields'] = sorted(
                        repeating_info['fields'],
                        key=lambda f: f.get('order', 999999)
                    )

                repeating_elements_info.append(repeating_info)
                print(f"[TARGET XSD] Repeatable wrapper has {len(repeating_info['fields'])} child fields")
                # Don't return - continue processing to find nested repeating elements
                # We'll use path-based deduplication to avoid duplicates in the main fields array
            elif is_field_repeatable:
                # This is a repeatable FIELD (no children) - NOT a wrapper
                print(f"[TARGET XSD] Found repeatable FIELD (no wrapper): {current_path} (maxOccurs={max_occurs})")

            if inline_ct is not None:
                seq = inline_ct.find(f'{{{xsd_ns}}}sequence')
                if seq is not None:
                    for child_elem in seq.findall(f'{{{xsd_ns}}}element'):
                        process_element(child_elem, current_path, depth + 1, new_visited)
                else:
                    clean_type = type_ref.split(':')[-1] if type_ref else "string"
                    fields.append({
                        "id": f"tgt-{idx}",
                        "name": name,
                        "type": clean_type,
                        "path": current_path,
                        "repeatable": is_field_repeatable,
                        "maxOccurs": max_occurs,
                        "order": current_order
                    })
                    idx += 1
            elif type_ref:
                clean_type = type_ref.split(':')[-1]
                type_def = named_types.get(clean_type)

                if type_def is not None:
                    seq = type_def.find(f'{{{xsd_ns}}}sequence')
                    if seq is not None:
                        for child_elem in seq.findall(f'{{{xsd_ns}}}element'):
                            process_element(child_elem, current_path, depth + 1, new_visited)
                    else:
                        fields.append({
                            "id": f"tgt-{idx}",
                            "name": name,
                            "type": clean_type,
                            "path": current_path,
                            "repeatable": is_field_repeatable,
                            "maxOccurs": max_occurs,
                            "order": current_order
                        })
                        idx += 1
                else:
                    fields.append({
                        "id": f"tgt-{idx}",
                        "name": name,
                        "type": clean_type,
                        "path": current_path,
                        "repeatable": is_field_repeatable,
                        "maxOccurs": max_occurs,
                        "order": current_order
                    })
                    idx += 1
            else:
                fields.append({
                    "id": f"tgt-{idx}",
                    "name": name,
                    "type": "string",
                    "path": current_path,
                    "repeatable": is_field_repeatable,
                    "maxOccurs": max_occurs,
                    "order": current_order
                })
                idx += 1
        
        root_elements = root.findall(f'{{{xsd_ns}}}element[@name]')
        print(f"[TARGET XSD] Found {len(root_elements)} root elements")

        for root_elem in root_elements:
            process_element(root_elem, "", depth=0, visited_types=set())
        
        print(f"[TARGET XSD] Parsed {len(fields)} fields before dedup")
        print(f"[TARGET XSD] Fields BEFORE dedup:")
        for f in fields[:20]:
            print(f"  - {f['path']}")

        fields = deduplicate_fields(fields)

        print(f"[TARGET XSD] Fields AFTER dedup ({len(fields)} total):")
        for f in fields[:20]:
            print(f"  - {f['path']}")

        # Filter out fields that are part of repeating wrapper elements
        # These should only be accessible through the repeating_elements structure
        repeating_paths = {rep['path'] for rep in repeating_elements_info}
        fields_before_filter = len(fields)
        fields = [f for f in fields if not any(f['path'].startswith(rep_path + '/') or f['path'] == rep_path for rep_path in repeating_paths)]
        if fields_before_filter != len(fields):
            print(f"[TARGET XSD] Filtered out {fields_before_filter - len(fields)} fields that are part of repeating wrappers")

        print(f"[TARGET XSD] Final field count: {len(fields)}")
        print(f"[TARGET XSD] Found {len(repeating_elements_info)} repeatable elements")
        for rep in repeating_elements_info:
            print(f"  - {rep['path']} (maxOccurs={rep['maxOccurs']}, {len(rep['fields'])} fields)")
            for child_field in rep['fields']:
                print(f"    > {child_field['path']}")
        
        repeatable_fields = [f for f in fields if f.get('repeatable')]
        print(f"[TARGET XSD] Found {len(repeatable_fields)} repeatable fields (for repeat-to-single)")
        for f in repeatable_fields[:5]:
            print(f"  - {f['name']}: {f['path']} (maxOccurs={f.get('maxOccurs')})")
        
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
            "repeating_elements": repeating_elements_info,
            "namespace": target_namespace
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=400, detail=f"Error parsing XSD: {str(e)}")


# ============================================================================
# TRANSFORM FUNCTIONS (unchanged)
# ============================================================================

def validate_and_transform_value(value: str, field_type: str, field_name: str) -> str:
    if not value or value == '':
        return ''
    
    value_str = str(value).strip()
    
    try:
        if field_type in ['string', 'xs:string']:
            cleaned = re.sub(r'[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]', '', value_str)
            return cleaned
        
        elif field_type in ['date', 'xs:date']:
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
            cleaned = re.sub(r'[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]', '', value_str)
            return cleaned
            
    except Exception as e:
        print(f"  [VALIDATION ERROR] Error validating '{value_str}': {e}")
        return ''


def apply_transform(value: str, transform: str, params: Dict[str, Any]) -> str:
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

        if DEBUG:
            print(f"  [TRANSFORM DEBUG] Replace params: from_='{from_val}' (type: {type(from_val).__name__}), to='{to_val}'")

        # Ensure strings (not None)
        if from_val is None:
            from_val = ''
        if to_val is None:
            to_val = ''

        if from_val and len(from_val) > MAX_REGEX_LENGTH:
            print(f"  [TRANSFORM ERROR] 'from' value too long")
            return value

        if from_val:
            result = value.replace(from_val, to_val)
            if DEBUG:
                print(f"  [TRANSFORM] Replace: '{value}' -> '{result}'")
            return result
        return value
    
    elif transform == 'regex':
        pattern = params.get('pattern', '') or ''
        replacement = params.get('replacement', '') or ''

        if pattern and len(pattern) > MAX_REGEX_LENGTH:
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
        format_string = params.get('format', '') or ''
        if format_string:
            try:
                split_at = params.get('split_at', '') or ''
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
        return value if value else (params.get('defaultValue', '') or '')

    elif transform == 'sanitize':
        allowed_chars = params.get('allowed_chars', 'a-zA-Z0-9\\s\\-_.,') or 'a-zA-Z0-9\\s\\-_.,'
        pattern = f'[^{allowed_chars}]'
        return re.sub(pattern, '', value)
    
    return value


# ============================================================================
# MAPPING APPLICATION (IMPROVED PATH MATCHING)
# ============================================================================

def apply_mappings_to_row(row: Dict, mappings: List[Mapping], source_schema: Schema, target_schema: Schema, constants: List[Constant] = None) -> Dict[str, str]:
    """Apply mappings with IMPROVED path matching"""
    result = {}
    
    source_fields_by_id = {f.id: f for f in source_schema.fields}
    target_fields_by_id = {f.id: f for f in target_schema.fields}
    constants_by_id = {c.id: c for c in (constants or [])}
    
    # Add repeating element fields to lookups
    if source_schema.repeating_elements:
        for rep_elem in source_schema.repeating_elements:
            for field in rep_elem.get('fields', []):
                if field.get('id'):
                    source_fields_by_id[field['id']] = field
    
    if target_schema.repeating_elements:
        for rep_elem in target_schema.repeating_elements:
            for field in rep_elem.get('fields', []):
                if field.get('id'):
                    target_fields_by_id[field['id']] = field
    
    print(f"\n[MAPPING] Processing row with {len(row)} source values")
    print(f"[MAPPING] Applying {len(mappings)} mappings")
    
    for mapping in mappings:
        # Skip container mappings and child mappings (those with parent_repeat_container)
        if mapping.is_container or mapping.parent_repeat_container:
            continue
        
        source_values = []
        
        for src_id in mapping.source:
            if src_id.startswith('const-'):
                const = constants_by_id.get(src_id)
                if const:
                    source_values.append(const.value)
                    print(f"  [CONSTANT] {const.name} = '{const.value}'")
                else:
                    source_values.append('')
            else:
                source_field = source_fields_by_id.get(src_id)
                if not source_field:
                    print(f"  [WARNING] Source field ID not found: {src_id}")
                    source_values.append('')
                    continue
                
                # Get field info (handle both dict and object)
                if isinstance(source_field, dict):
                    field_path = source_field.get('path', '')
                    field_name = source_field.get('name', '')
                else:
                    field_path = source_field.path
                    field_name = source_field.name
                
                # Use improved path matcher
                value = path_matcher.find_value(row, field_path, field_name)
                
                if value is not None:
                    source_values.append(str(value))
                    print(f"  [FIELD] {field_name} = '{value}' (found)")
                else:
                    print(f"  [MISSING] {field_name} (path: {field_path}) NOT FOUND in source data")
                    # Show similar keys for debugging
                    similar_keys = [k for k in row.keys() if field_name.lower() in k.lower()][:5]
                    if similar_keys:
                        print(f"    Similar keys: {similar_keys}")
                    source_values.append('')
        
        # Apply transforms
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
                old_value = value
                value = apply_transform(value, transform, mapping.params.dict())
                if old_value != value:
                    print(f"  [TRANSFORM] {transform}: '{old_value}' -> '{value}'")
        
        target_field = target_fields_by_id.get(mapping.target)
        if target_field:
            if isinstance(target_field, dict):
                field_type = target_field.get('type', 'string')
                field_name = target_field.get('name', '')
                field_path = target_field.get('path', '')
            else:
                field_type = target_field.type
                field_name = target_field.name
                field_path = target_field.path
            
            validated_value = validate_and_transform_value(value, field_type, field_name)
            result[field_path] = validated_value
            if validated_value:
                print(f"  -> TARGET: {field_name} = '{validated_value}'")
            else:
                print(f"  -> TARGET: {field_name} = <empty>")
        else:
            print(f"  [WARNING] Target field not found: {mapping.target}")
    
    return result


# ============================================================================
# XML CREATION WITH CORRECT ELEMENT ORDERING
# ============================================================================

def create_xml_from_data(
    data: Dict[str, str], 
    schema: Schema, 
    root_element_name: str = "Record",
    namespace: str = None
) -> ET.Element:
    """
    Create XML with default namespace and correct element ordering.
    """
    print(f"\n[XML CREATE] Creating XML with {len(data)} mapped fields")
    if namespace:
        print(f"[XML CREATE] Using default namespace: {namespace}")
    
    root = None
    elements = {}
    
    nsmap = {None: namespace} if namespace else None
    
    # Get repeating wrapper paths to skip
    repeating_wrapper_paths = set()
    if hasattr(schema, 'repeating_elements') and schema.repeating_elements:
        for rep_elem in schema.repeating_elements:
            wrapper_path = rep_elem.get('wrapper_path') or rep_elem.get('path')
            if wrapper_path:
                repeating_wrapper_paths.add(wrapper_path)
    
    print(f"[XML CREATE] Skipping {len(repeating_wrapper_paths)} repeating wrapper paths")

    # Sort fields by their XSD order before processing
    sorted_fields = sorted(schema.fields, key=lambda f: getattr(f, 'order', 999999))

    # Process fields in schema order
    for field in sorted_fields:
        path_parts = field.path.split('/')
        value = data.get(field.path, '')
        
        is_repeatable = getattr(field, 'repeatable', False) or getattr(field, 'maxOccurs', '1') == 'unbounded'
        is_in_repeating_wrapper = any(field.path.startswith(wrapper_path + '/') or field.path == wrapper_path
                                       for wrapper_path in repeating_wrapper_paths)

        if is_in_repeating_wrapper:
            continue

        # Skip fields without values (don't create empty elements)
        if not value:
            continue
        
        for i in range(len(path_parts)):
            partial_path = '/'.join(path_parts[:i+1])
            
            if partial_path in repeating_wrapper_paths:
                continue
            
            if partial_path not in elements:
                elem_name = path_parts[i]
                
                if i == 0:
                    elem = ET.Element(elem_name, nsmap=nsmap)
                    root = elem
                else:
                    parent_path = '/'.join(path_parts[:i])
                    if parent_path in elements:
                        elem = ET.SubElement(elements[parent_path], elem_name)
                    else:
                        continue
                
                elements[partial_path] = elem
        
        if not is_repeatable and field.path in elements:
            leaf_elem = elements[field.path]
            field_type = getattr(field, 'type', 'string')

            # For date/dateTime types, don't set empty string (it's invalid)
            # Instead, remove the element if optional and empty
            if value:
                leaf_elem.text = str(value)
                print(f"  {field.path} = '{value}'")
            elif field_type in ['date', 'xs:date', 'dateTime', 'xs:dateTime']:
                # Empty date is invalid - remove element if it was created
                try:
                    parent_path = '/'.join(path_parts[:-1])
                    parent = elements.get(parent_path)
                    if parent is not None:
                        try:
                            parent.remove(leaf_elem)
                            del elements[field.path]
                            print(f"  {field.path} = <skipped - empty date>")
                        except ValueError:
                            # Element not found in parent, just skip
                            print(f"  {field.path} = <empty date, could not remove>")
                except Exception as e:
                    print(f"  {field.path} = <error removing empty date: {e}>")
            else:
                # For non-date types, empty string is acceptable
                leaf_elem.text = ""
        elif is_repeatable and field.path in elements:
            # Remove placeholder for repeatable fields
            parent_path = '/'.join(path_parts[:-1])
            parent = elements.get(parent_path)
            placeholder = elements[field.path]
            if parent is not None and placeholder in parent:
                parent.remove(placeholder)
            del elements[field.path]
    
    if root is None:
        root = ET.Element(root_element_name, nsmap=nsmap)
    
    return root


def parse_xml_to_dict(xml_content: bytes) -> Dict[str, str]:
    """
    Parse XML content to flat dictionary with MULTIPLE path variations.
    """
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
                # Store with FULL path (always)
                result[current_path] = elem.text.strip()

                # Store with partial paths (always overwrite to get most recent)
                # This allows flexible matching while avoiding ambiguity from first-match
                # BUT skip single-part paths (bare tag names) to avoid ambiguity
                parts = current_path.split('/')
                for i in range(1, len(parts) - 1):  # Stop before creating bare tag name
                    partial = '/'.join(parts[i:])
                    result[partial] = elem.text.strip()

                # DO NOT store bare tag name to avoid ambiguity with duplicate tag names
                # PathMatcher will use full paths and partial paths for matching

                print(f"  [PARSE] {current_path} = '{elem.text.strip()}'")
            
            for child in elem:
                extract_with_path(child, current_path)
        
        extract_with_path(root, "")
        
        print(f"\n[PARSE] Extracted {len(result)} unique paths")
        print(f"[PARSE] Sample keys: {list(result.keys())[:10]}")
        
        return result
        
    except Exception as e:
        import traceback
        print(f"[XML PARSE ERROR] {e}")
        print(traceback.format_exc())
        raise Exception(f"Failed to parse XML: {str(e)}")


# ============================================================================
# CONDITIONAL MAPPING - EVALUATE CONDITIONS ON ELEMENTS
# ============================================================================

def evaluate_condition(condition: MappingCondition, element_data: Dict[str, str]) -> bool:
    """
    Evaluate a single condition against element data.

    Args:
        condition: The condition to evaluate
        element_data: Dictionary with element attributes and values
                     Keys can be: "@name", "@dataType", "value", "property", etc.

    Returns:
        True if condition matches, False otherwise
    """
    field_value = element_data.get(condition.field, "")

    if condition.operator == "exists":
        # Check if field exists and is not empty
        return condition.field in element_data and element_data[condition.field] != ""

    if condition.operator == "equals":
        return field_value == condition.value

    if condition.operator == "contains":
        return condition.value in field_value

    if condition.operator == "startswith":
        return field_value.startswith(condition.value)

    if condition.operator == "regex":
        try:
            if len(condition.value) > MAX_REGEX_LENGTH:
                print(f"[CONDITION] Regex too long: {len(condition.value)}")
                return False
            return bool(re.match(condition.value, field_value))
        except Exception as e:
            print(f"[CONDITION] Regex error: {e}")
            return False

    # Unknown operator
    print(f"[CONDITION] Unknown operator: {condition.operator}")
    return False


def evaluate_conditions(conditions: List[MappingCondition], element_data: Dict[str, str]) -> bool:
    """
    Evaluate all conditions (AND logic).

    Args:
        conditions: List of conditions to evaluate
        element_data: Dictionary with element attributes and values

    Returns:
        True if ALL conditions match, False if any fails
    """
    if not conditions:
        return True  # No conditions = always match

    for condition in conditions:
        if not evaluate_condition(condition, element_data):
            return False

    return True


# ============================================================================
# REPEATING MAPPINGS - ALL MODES PRESERVED + CORRECT ORDERING
# ============================================================================

def apply_repeating_mappings_to_xml(
    source_root: ET._Element, 
    target_root: ET._Element,
    mappings: List[Mapping],
    source_schema: Schema,
    target_schema: Schema,
    constants: List[Constant] = None,
    target_namespace: str = None
) -> int:
    """
    Apply repeating element mappings with ALL modes preserved:
    1. NORMAL mode: wrapper-to-wrapper (repeating source -> repeating target wrapper)
    2. REPEAT-TO-SINGLE mode: repeating source -> repeatable target field (no wrapper)
    
    FIXED: Elements are now inserted at correct position based on schema order.
    """
    total_instances = 0
    
    # Create element order tracker for correct positioning
    order_tracker = ElementOrderTracker(target_schema)

    # Process ALL container mappings (repeat, merge, first, last)
    container_mappings = [m for m in mappings if m.is_container]
    
    for container in container_mappings:
        if not container.loop_element_path:
            continue
        
        child_mappings = [m for m in mappings if m.parent_repeat_container == container.id]
        
        if not child_mappings:
            print(f"[REPEAT] No child mappings for container {container.id}")
            continue
        
        safe_loop_path = sanitize_xpath(container.loop_element_path)
        search_path = safe_loop_path.lstrip('/')
        
        # Namespace-agnostic XPath
        path_parts = search_path.split('/')
        ns_agnostic_xpath = '//' + '//'.join([f"*[local-name()='{part}']" for part in path_parts])
        
        print(f"[REPEAT] Original path: {safe_loop_path}")
        print(f"[REPEAT] Path parts: {path_parts}")
        print(f"[REPEAT] Namespace-agnostic XPath: {ns_agnostic_xpath}")
        
        try:
            loop_elements = source_root.xpath(ns_agnostic_xpath)
            print(f"[REPEAT] XPath returned {len(loop_elements)} elements")
            
            if not loop_elements:
                print(f"[REPEAT] Trying simplified XPath...")
                last_part = path_parts[-1]
                simple_xpath = f".//*[local-name()='{last_part}']"
                loop_elements = source_root.xpath(simple_xpath)
                print(f"[REPEAT] Simplified XPath found {len(loop_elements)} elements")
            
            if not loop_elements:
                print(f"[REPEAT] No elements found at path: {safe_loop_path}")
                continue
            
            print(f"[REPEAT] Found {len(loop_elements)} instances of {container.loop_element_path}")
            
            # Build field lookups
            source_fields_by_id = {f.id: f for f in source_schema.fields}
            target_fields_by_id = {f.id: f for f in target_schema.fields}
            
            if source_schema.repeating_elements:
                for rep_elem in source_schema.repeating_elements:
                    if rep_elem.get('fields'):
                        for field in rep_elem['fields']:
                            source_fields_by_id[field['id']] = field
            
            if target_schema.repeating_elements:
                for rep_elem in target_schema.repeating_elements:
                    if rep_elem.get('fields'):
                        for field in rep_elem['fields']:
                            target_fields_by_id[field['id']] = field
            
            print(f"[REPEAT] Source fields lookup: {len(source_fields_by_id)} fields")
            print(f"[REPEAT] Target fields lookup: {len(target_fields_by_id)} fields")
            
            constants_by_id = {c.id: c for c in (constants or [])}

            # Determine aggregation mode
            aggregation_mode = container.aggregation or 'repeat'
            print(f"[REPEAT] Aggregation mode: {aggregation_mode}")

            # Get merge separator if in merge mode
            merge_separator = getattr(container.params, 'mergeSeparator', ', ') if container.params and aggregation_mode == 'merge' else ', '

            # Filter loop elements based on aggregation mode
            elements_to_process = loop_elements
            if aggregation_mode == 'first':
                elements_to_process = [loop_elements[0]] if loop_elements else []
                print(f"[REPEAT] Using FIRST element only")
            elif aggregation_mode == 'last':
                elements_to_process = [loop_elements[-1]] if loop_elements else []
                print(f"[REPEAT] Using LAST element only")
            elif aggregation_mode == 'merge':
                # For merge, we'll collect all values from all elements and combine them
                print(f"[REPEAT] Will MERGE all {len(loop_elements)} elements with separator: '{merge_separator}'")

            # Determine mode
            has_wrapper = container.target_wrapper_path is not None
            # In merge mode, always treat as repeat-to-single (no wrapper creation)
            is_repeat_to_single = aggregation_mode == 'merge' or container.repeat_to_single or not has_wrapper

            print(f"[REPEAT] Mode: {'REPEAT-TO-SINGLE' if is_repeat_to_single else 'NORMAL (with wrapper)'}")

            # Special handling for MERGE mode
            if aggregation_mode == 'merge':
                # Collect all values from all instances for each child mapping
                merged_values = {}  # mapping_id -> [values from all instances]

                for idx, loop_elem in enumerate(loop_elements):
                    print(f"\n[MERGE] Collecting values from instance {idx + 1}/{len(loop_elements)}")

                    # Extract data from this source instance
                    instance_data = {}

                    def extract_from_element(elem, path=""):
                        tag = elem.tag
                        if '}' in tag:
                            tag = tag.split('}')[1]

                        current_path = f"{path}/{tag}" if path else tag

                        if elem.text and elem.text.strip():
                            instance_data[current_path] = elem.text.strip()
                            # Also store with partial path variations for flexible matching
                            # But DON'T store bare tag names to avoid ambiguity
                            parts = current_path.split('/')
                            for i in range(1, len(parts) - 1):  # Stop before creating bare tag name
                                partial = '/'.join(parts[i:])
                                instance_data[partial] = elem.text.strip()

                        for attr, val in elem.attrib.items():
                            instance_data[f"{current_path}/@{attr}"] = val
                            # Store attribute with partial paths but not bare tag
                            parts = current_path.split('/')
                            for i in range(1, len(parts) - 1):  # Stop before creating bare tag name
                                partial = '/'.join(parts[i:])
                                instance_data[f"{partial}/@{attr}"] = val

                        for child in elem:
                            extract_from_element(child, current_path)

                    extract_from_element(loop_elem, "")

                    # Collect values for each child mapping
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

                                field_name = source_field.get('name', '') if isinstance(source_field, dict) else source_field.name
                                field_path = source_field.get('path', '') if isinstance(source_field, dict) else source_field.path

                                # Use improved path matcher
                                value = path_matcher.find_value(instance_data, field_path, field_name)
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

                        # Store value for this instance
                        if mapping.id not in merged_values:
                            merged_values[mapping.id] = []
                        if value:  # Only add non-empty values
                            merged_values[mapping.id].append(value)

                # Now create ONE target element with all merged values
                print(f"\n[MERGE] Creating single target element with merged values")

                wrapper_elem = None
                target_parts = []

                if has_wrapper and not is_repeat_to_single:
                    target_parts = container.target_wrapper_path.strip('/').split('/')
                    print(f"  [MERGE] Navigating wrapper path: {target_parts}")

                    current = target_root
                    root_tag = target_root.tag.split('}')[-1] if '}' in target_root.tag else target_root.tag

                    start_idx = 1 if len(target_parts) > 0 and target_parts[0] == root_tag else 0

                    for i in range(start_idx, len(target_parts) - 1):
                        part = target_parts[i]
                        child = None
                        for c in current:
                            c_tag = c.tag.split('}')[-1] if '}' in c.tag else c.tag
                            if c_tag == part:
                                child = c
                                break

                        if child is None:
                            child = ET.Element(part)
                            current.append(child)

                        current = child

                    # Create wrapper element at correct position
                    final_tag = target_parts[-1]
                    parent_path = '/'.join(target_parts[:-1]) if len(target_parts) > 1 else ""
                    insert_idx = order_tracker.get_insertion_index(current, final_tag, parent_path)
                    wrapper_elem = ET.Element(final_tag)
                    current.insert(insert_idx, wrapper_elem)
                    total_instances += 1
                    print(f"  [MERGE] Created wrapper: {final_tag} at index {insert_idx}")
                else:
                    wrapper_elem = target_root
                    print(f"  [MERGE] Using root as wrapper")

                # Apply merged values to target fields
                for mapping in child_mappings:
                    values = merged_values.get(mapping.id, [])
                    if not values:
                        continue

                    # Combine all values with the merge separator
                    combined_value = merge_separator.join(values)
                    print(f"  [MERGE] Mapping {mapping.id}: {len(values)} values -> '{combined_value[:50]}...'")

                    # Get target field
                    target_field = target_fields_by_id.get(mapping.target)
                    if target_field:
                        field_type = target_field.get('type', 'string') if isinstance(target_field, dict) else target_field.type
                        field_name = target_field.get('name', '') if isinstance(target_field, dict) else target_field.name
                        field_path = target_field.get('path', '') if isinstance(target_field, dict) else target_field.path

                        validated_value = validate_and_transform_value(combined_value, field_type, field_name)

                        if is_repeat_to_single:
                            # REPEAT-TO-SINGLE: Insert at correct position
                            target_path_parts = field_path.split('/')

                            current_elem = target_root
                            current_path = target_root.tag.split('}')[-1] if '}' in target_root.tag else target_root.tag

                            # Navigate/create path to parent
                            root_tag = current_path
                            start_idx = 1 if len(target_path_parts) > 0 and target_path_parts[0] == root_tag else 0

                            for i in range(start_idx, len(target_path_parts) - 1):
                                part = target_path_parts[i]

                                # Find existing child
                                child = None
                                for c in current_elem:
                                    c_tag = c.tag.split('}')[-1] if '}' in c.tag else c.tag
                                    if c_tag == part:
                                        child = c
                                        break

                                if child is None:
                                    # Create at correct position
                                    insert_idx = order_tracker.get_insertion_index(current_elem, part, current_path)
                                    child = ET.Element(part)
                                    current_elem.insert(insert_idx, child)

                                current_path = f"{current_path}/{part}"
                                current_elem = child

                            # Create final element at correct position
                            final_tag = target_path_parts[-1]
                            parent_path = '/'.join(target_path_parts[:-1])
                            insert_idx = order_tracker.get_insertion_index(current_elem, final_tag, parent_path)
                            target_elem = ET.Element(final_tag)
                            target_elem.text = validated_value
                            current_elem.insert(insert_idx, target_elem)
                            print(f"  [MERGE] Created {final_tag} = '{validated_value[:50]}...' at index {insert_idx}")
                        else:
                            # NORMAL mode: Add to wrapper
                            final_tag = field_name
                            insert_idx = order_tracker.get_insertion_index(wrapper_elem, final_tag, '/'.join(target_parts))
                            target_elem = ET.Element(final_tag)
                            target_elem.text = validated_value
                            wrapper_elem.insert(insert_idx, target_elem)
                            print(f"  [MERGE] Added {final_tag} = '{validated_value[:50]}...' at index {insert_idx}")

                # Skip the regular loop since we've handled merge mode
                continue

            # Regular processing for repeat/first/last modes
            for idx, loop_elem in enumerate(elements_to_process):
                print(f"\n[REPEAT] Processing instance {idx + 1}/{len(loop_elements)}")
                
                # Extract data from this source instance
                instance_data = {}
                
                def extract_from_element(elem, path=""):
                    tag = elem.tag
                    if '}' in tag:
                        tag = tag.split('}')[1]

                    current_path = f"{path}/{tag}" if path else tag

                    if elem.text and elem.text.strip():
                        instance_data[current_path] = elem.text.strip()
                        # Also store with partial path variations for flexible matching
                        # But DON'T store bare tag names to avoid ambiguity
                        parts = current_path.split('/')
                        for i in range(1, len(parts) - 1):  # Stop before creating bare tag name
                            partial = '/'.join(parts[i:])
                            instance_data[partial] = elem.text.strip()

                    for attr, val in elem.attrib.items():
                        instance_data[f"{current_path}/@{attr}"] = val
                        # Store attribute with partial paths but not bare tag
                        parts = current_path.split('/')
                        for i in range(1, len(parts) - 1):  # Stop before creating bare tag name
                            partial = '/'.join(parts[i:])
                            instance_data[f"{partial}/@{attr}"] = val

                    for child in elem:
                        extract_from_element(child, current_path)
                
                extract_from_element(loop_elem, "")

                # ============================================================
                # CHECK CONDITIONS - Skip if conditions don't match
                # ============================================================
                if container.conditions:
                    # Build element_data dict with attributes and child values
                    element_data = {}

                    # Add attributes from the loop element itself
                    for attr, val in loop_elem.attrib.items():
                        element_data[f"@{attr}"] = val

                    # Add child element values (like <value>Anna</value>)
                    for child in loop_elem:
                        child_tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag
                        if child.text and child.text.strip():
                            element_data[child_tag] = child.text.strip()

                    # Check if conditions match
                    if not evaluate_conditions(container.conditions, element_data):
                        print(f"  [CONDITION] Skipping instance {idx + 1} - conditions not met")
                        print(f"  [CONDITION] Element data: {element_data}")
                        print(f"  [CONDITION] Required conditions: {[(c.field, c.operator, c.value) for c in container.conditions]}")
                        continue
                    else:
                        print(f"  [CONDITION] Instance {idx + 1} matches conditions")
                        print(f"  [CONDITION] Element data: {element_data}")

                wrapper_elem = None
                target_parts = []
                
                # ============================================================
                # MODE: NORMAL (wrapper-to-wrapper)
                # ============================================================
                if has_wrapper and not is_repeat_to_single:
                    target_parts = container.target_wrapper_path.strip('/').split('/')
                    
                    print(f"  [NORMAL] Navigating wrapper path: {target_parts}")
                    
                    current = target_root
                    
                    root_tag = target_root.tag.split('}')[-1] if '}' in target_root.tag else target_root.tag
                    start_index = 1 if target_parts[0] == root_tag else 0
                    
                    print(f"  [NORMAL] Starting from index {start_index}")
                    
                    # Navigate to parent of wrapper
                    current_path = root_tag
                    for i in range(start_index, len(target_parts) - 1):
                        part = target_parts[i]
                        
                        child = None
                        for c in current:
                            c_tag = c.tag.split('}')[-1] if '}' in c.tag else c.tag
                            if c_tag == part:
                                child = c
                                break
                        
                        if child is None:
                            # Create parent at correct position
                            insert_idx = order_tracker.get_insertion_index(current, part, current_path)
                            child = ET.Element(part)
                            current.insert(insert_idx, child)
                            print(f"  [NORMAL] Created parent: {part} at index {insert_idx}")
                        
                        current_path = f"{current_path}/{part}"
                        current = child
                    
                    # Create wrapper element at correct position
                    final_tag = target_parts[-1]
                    parent_path = '/'.join(target_parts[:-1]) if len(target_parts) > 1 else ""
                    insert_idx = order_tracker.get_insertion_index(current, final_tag, parent_path)
                    wrapper_elem = ET.Element(final_tag)
                    current.insert(insert_idx, wrapper_elem)
                    total_instances += 1
                    print(f"  [NORMAL] Created wrapper: {final_tag} at index {insert_idx}")
                
                # ============================================================
                # MODE: REPEAT-TO-SINGLE (no wrapper)
                # ============================================================
                else:
                    wrapper_elem = target_root
                    print(f"  [REPEAT-TO-SINGLE] Using root as wrapper")
                
                # Process child mappings
                for mapping in child_mappings:
                    source_values = []
                    
                    for src_id in mapping.source:
                        if src_id.startswith('const-'):
                            const = constants_by_id.get(src_id)
                            value = const.value if const else ''
                        else:
                            source_field = source_fields_by_id.get(src_id)
                            if not source_field:
                                print(f"  [REPEAT WARNING] Source field not found: {src_id}")
                                continue
                            
                            field_name = source_field.get('name', '') if isinstance(source_field, dict) else source_field.name
                            field_path = source_field.get('path', '') if isinstance(source_field, dict) else source_field.path
                            
                            # Use improved path matcher
                            value = path_matcher.find_value(instance_data, field_path, field_name)
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
                    
                    # Get target field
                    target_field = target_fields_by_id.get(mapping.target)
                    if target_field:
                        field_type = target_field.get('type', 'string') if isinstance(target_field, dict) else target_field.type
                        field_name = target_field.get('name', '') if isinstance(target_field, dict) else target_field.name
                        field_path = target_field.get('path', '') if isinstance(target_field, dict) else target_field.path
                        
                        validated_value = validate_and_transform_value(value, field_type, field_name)
                        
                        if is_repeat_to_single:
                            # ================================================
                            # REPEAT-TO-SINGLE: Insert at correct position
                            # ================================================
                            target_path_parts = field_path.split('/')
                            
                            current_elem = target_root
                            current_path = target_root.tag.split('}')[-1] if '}' in target_root.tag else target_root.tag
                            
                            # Navigate/create path to parent
                            root_tag = current_path
                            start_idx = 1 if len(target_path_parts) > 0 and target_path_parts[0] == root_tag else 0
                            
                            for i in range(start_idx, len(target_path_parts) - 1):
                                part = target_path_parts[i]
                                
                                # Find existing child
                                child = None
                                for c in current_elem:
                                    c_tag = c.tag.split('}')[-1] if '}' in c.tag else c.tag
                                    if c_tag == part:
                                        child = c
                                        break
                                
                                if child is None:
                                    # Create at correct position
                                    insert_idx = order_tracker.get_insertion_index(current_elem, part, current_path)
                                    child = ET.Element(part)
                                    current_elem.insert(insert_idx, child)
                                
                                current_path = f"{current_path}/{part}"
                                current_elem = child
                            
                            # Create final element at correct position
                            final_tag = target_path_parts[-1]
                            parent_path = '/'.join(target_path_parts[:-1])
                            insert_idx = order_tracker.get_insertion_index(current_elem, final_tag, parent_path)
                            final_elem = ET.Element(final_tag)
                            final_elem.text = validated_value
                            current_elem.insert(insert_idx, final_elem)
                            
                            print(f"  [REPEAT-TO-SINGLE] Created {final_tag} = {validated_value} at index {insert_idx}")
                            
                            total_instances += 1
                        else:
                            # ================================================
                            # NORMAL: Create within wrapper
                            # ================================================
                            target_path_parts = field_path.split('/')
                            wrapper_depth = len(target_parts)
                            relative_parts = target_path_parts[wrapper_depth:]
                            
                            current_elem = wrapper_elem
                            for part in relative_parts[:-1]:
                                child = None
                                for c in current_elem:
                                    c_tag = c.tag.split('}')[-1] if '}' in c.tag else c.tag
                                    if c_tag == part:
                                        child = c
                                        break
                                
                                if child is None:
                                    child = ET.SubElement(current_elem, part)
                                current_elem = child
                            
                            final_tag = relative_parts[-1] if relative_parts else field_name
                            final_elem = None
                            for c in current_elem:
                                c_tag = c.tag.split('}')[-1] if '}' in c.tag else c.tag
                                if c_tag == final_tag:
                                    final_elem = c
                                    break
                            
                            if final_elem is None:
                                final_elem = ET.SubElement(current_elem, final_tag)
                            final_elem.text = validated_value
                            
                            print(f"  [REPEAT] Set {final_tag} = {validated_value}")
            
        except Exception as e:
            import traceback
            print(f"[REPEAT ERROR] {e}")
            print(traceback.format_exc())
    
    return total_instances


# ============================================================================
# BATCH PROCESSING
# ============================================================================

@app.post("/api/batch-process")
async def batch_process(request: BatchProcessRequest):
    """Process all files with all mapping modes supported"""
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
        
        direct_mappings = [m for m in request.mappings if not m.is_container]
        container_mappings = [m for m in request.mappings if m.is_container]
        
        target_namespace = getattr(request.target_schema, 'namespace', None)
        print(f"[BATCH] Target namespace: {target_namespace}")
        
        print(f"\n[BATCH] {len(direct_mappings)} direct mappings")
        print(f"[BATCH] {len(container_mappings)} container mappings")
        
        # Clear path matcher cache
        path_matcher.clear_cache()
        
        if request.source_schema.type == 'csv':
            csv_files = list(source_path.glob("*.csv"))[:MAX_BATCH_FILES]
            
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
                        
                        if request.folder_naming == "guid":
                            folder_name = str(uuid.uuid4())
                        elif request.folder_naming == "filename":
                            folder_name = csv_file.stem
                        elif request.folder_naming_fields:
                            # Build name->path map for target fields
                            target_name_to_path = {}
                            for f in request.target_schema.fields:
                                target_name_to_path[f.name] = f.path

                            name_parts = []
                            for field_name in request.folder_naming_fields:
                                # Convert field name to path
                                field_path = target_name_to_path.get(field_name, field_name)
                                value = transformed.get(field_path, '')
                                if value:
                                    name_parts.append(str(value).replace(' ', '_').replace('/', '_').replace('\\', '_'))

                            if name_parts:
                                folder_name = '_'.join(name_parts)
                            else:
                                folder_name = str(uuid.uuid4())
                        else:
                            folder_name = str(uuid.uuid4())
                        
                        output_folder = target_path / folder_name
                        output_folder.mkdir(parents=True, exist_ok=True)
                        
                        xml_root = create_xml_from_data(
                            transformed, 
                            request.target_schema, 
                            "Record",
                            namespace=target_namespace
                        )
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
        
        elif request.source_schema.type == 'xml':
            xml_files = list(source_path.glob("*.xml"))[:MAX_BATCH_FILES]
            
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
                    
                    if request.folder_naming == "guid":
                        folder_name = str(uuid.uuid4())
                    elif request.folder_naming == "filename":
                        folder_name = xml_file.stem
                    elif request.folder_naming_fields:
                        # Build name->path map for target fields
                        target_name_to_path = {}
                        for f in request.target_schema.fields:
                            target_name_to_path[f.name] = f.path

                        name_parts = []
                        for field_name in request.folder_naming_fields:
                            # Convert field name to path
                            field_path = target_name_to_path.get(field_name, field_name)
                            value = transformed.get(field_path, '')
                            if value:
                                name_parts.append(str(value).replace(' ', '_').replace('/', '_').replace('\\', '_'))

                        if name_parts:
                            folder_name = '_'.join(name_parts)
                        else:
                            folder_name = str(uuid.uuid4())
                    else:
                        folder_name = str(uuid.uuid4())
                    
                    output_folder = target_path / folder_name
                    output_folder.mkdir(parents=True, exist_ok=True)
                    print(f"[XML] Created output folder: {output_folder}")

                    # Create XML structure
                    print(f"[XML] Creating XML structure...")
                    target_root = create_xml_from_data(
                        transformed,
                        request.target_schema,
                        "Record",
                        namespace=target_namespace
                    )
                    print(f"[XML] XML structure created, root tag: {target_root.tag if target_root is not None else 'None'}")

                    # Apply ALL repeating mappings (both modes)
                    print(f"[XML] Applying repeating mappings...")
                    instances = apply_repeating_mappings_to_xml(
                        source_root,
                        target_root,
                        request.mappings,
                        request.source_schema,
                        request.target_schema,
                        constants,
                        target_namespace=target_namespace
                    )

                    if instances > 0:
                        print(f"[XML] Created {instances} repeating element instances")

                    tree = ET.ElementTree(target_root)
                    output_file = output_folder / f"{folder_name}.xml"
                    print(f"[XML] Writing XML to: {output_file}")
                    tree.write(
                        str(output_file),
                        encoding='utf-8',
                        xml_declaration=True,
                        pretty_print=True
                    )
                    print(f"[XML] Successfully wrote XML file")

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
    print("Starting Schmapper Backend v3.1 (All Mapping Modes + Fixed Element Ordering)...")
    print("API docs: http://localhost:8000/docs")
    uvicorn.run(app, host="0.0.0.0", port=8000)