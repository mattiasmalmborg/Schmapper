import React, { useState, useCallback, useMemo, useRef } from 'react';
import { Download, Upload, Play, Trash2, Plus, Database, FolderOpen, Eye, Save, FileText, AlertCircle } from 'lucide-react';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8000';

// Constants
const MAX_LOG_ENTRIES = 1000; // Prevent memory issues with logs
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB max file size
const DEBOUNCE_DELAY = 300; // ms for input debouncing
const NOTIFICATION_TIMEOUT = 3000;

// Utility functions
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return '';
  // Remove potential XSS vectors
  return input.replace(/<script[^>]*>.*?<\/script>/gi, '')
              .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '')
              .replace(/javascript:/gi, '')
              .replace(/on\w+\s*=/gi, '');
};

const validatePath = (path) => {
  if (!path || typeof path !== 'string') return false;
  // Basic path validation - adjust based on OS requirements
  const invalidChars = /[<>"|?*]/;
  return !invalidChars.test(path) && path.length > 0 && path.length < 260;
};

const debounce = (func, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
};

const SchemaMapper = () => {
  // State management
  const [sourceSchema, setSourceSchema] = useState(null);
  const [targetSchema, setTargetSchema] = useState(null);
  const [mappings, setMappings] = useState([]);
  const [draggedField, setDraggedField] = useState(null);
  const [selectedMapping, setSelectedMapping] = useState(null);
  const [hoveredTarget, setHoveredTarget] = useState(null);
  const [hoveredMapping, setHoveredMapping] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [sourcePath, setSourcePath] = useState('');
  const [targetPath, setTargetPath] = useState('');
  const [processing, setProcessing] = useState(false);
  const [notification, setNotification] = useState(null);
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const [folderNaming, setFolderNaming] = useState('guid');
  const [folderNamingFields, setFolderNamingFields] = useState([]);
  const [showFolderSettings, setShowFolderSettings] = useState(false);
  const [showConstantModal, setShowConstantModal] = useState(false);
  const [constantName, setConstantName] = useState('');
  const [constantValue, setConstantValue] = useState('');
  const [constants, setConstants] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Refs for optimization
  const notificationTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Logging with size limit
  const addLog = useCallback((level, message, data = null) => {
    const timestamp = new Date().toISOString();
    const logEntry = {
      id: `${timestamp}-${Math.random()}`,
      timestamp,
      level,
      message: sanitizeInput(message),
      data: data ? JSON.stringify(data, null, 2).substring(0, 1000) : null // Limit data size
    };
    
    setLogs(prev => {
      const newLogs = [...prev, logEntry];
      // Keep only last MAX_LOG_ENTRIES
      if (newLogs.length > MAX_LOG_ENTRIES) {
        return newLogs.slice(-MAX_LOG_ENTRIES);
      }
      return newLogs;
    });
    
    console.log(`[${level.toUpperCase()}] ${message}`, data || '');
  }, []);

  const downloadLogs = useCallback(() => {
    try {
      const logText = logs.map(log => 
        `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}${log.data ? '\n' + log.data : ''}`
      ).join('\n\n');
      
      const blob = new Blob([logText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `schmapper-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showNotification('Logg nedladdad');
    } catch (error) {
      addLog('error', 'Failed to download logs', { error: error.message });
      showNotification('Kunde inte ladda ner logg', 'error');
    }
  }, [logs]);

  const clearLogs = useCallback(() => {
    setLogs([]);
    showNotification('Loggar rensade');
  }, []);

  const transforms = useMemo(() => [
    { id: 'none', name: 'Direkt', icon: '→' },
    { id: 'uppercase', name: 'VERSALER', icon: 'AA' },
    { id: 'lowercase', name: 'gemener', icon: 'aa' },
    { id: 'trim', name: 'Ta bort mellanslag', icon: '✂' },
    { id: 'concat', name: 'Slå ihop', icon: '+' },
    { id: 'format', name: 'Formatera', icon: '⚙' },
    { id: 'replace', name: 'Ersätt', icon: '↔' },
    { id: 'regex', name: 'Regex', icon: '.*' },
    { id: 'default', name: 'Standardvärde', icon: '📌' }
  ], []);

  const aggregationModes = useMemo(() => [
    { id: 'foreach', name: 'För varje (1:1)', description: 'Ett målelement per källelement' },
    { id: 'merge', name: 'Slå ihop alla', description: 'Alla källvärden i samma målelement' }
  ], []);

  const showNotification = useCallback((message, type = 'success') => {
    // Clear existing timeout
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }
    
    setNotification({ message: sanitizeInput(message), type });
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(null);
      notificationTimeoutRef.current = null;
    }, NOTIFICATION_TIMEOUT);
  }, []);

  const createConstant = useCallback(() => {
    const sanitizedName = sanitizeInput(constantName.trim());
    const sanitizedValue = sanitizeInput(constantValue.trim());
    
    if (!sanitizedName || !sanitizedValue) {
      showNotification('Ange både namn och värde', 'error');
      return;
    }
    
    // Check for duplicate names
    if (constants.some(c => c.name === sanitizedName)) {
      showNotification('Ett värde med detta namn finns redan', 'error');
      return;
    }
    
    const newConstant = {
      id: `const-${Date.now()}-${Math.random()}`,
      name: sanitizedName,
      value: sanitizedValue,
      type: 'constant'
    };
    
    setConstants(prev => [...prev, newConstant]);
    setConstantName('');
    setConstantValue('');
    setShowConstantModal(false);
    addLog('info', `Constant created: ${sanitizedName}`);
    showNotification(`Konstant "${sanitizedName}" skapad`);
  }, [constantName, constantValue, constants, showNotification, addLog]);

  const deleteConstant = useCallback((constId) => {
    setConstants(prev => prev.filter(c => c.id !== constId));
    setMappings(prev => prev.map(m => ({
      ...m,
      source: m.source.filter(s => s !== constId)
    })).filter(m => m.source.length > 0));
    addLog('info', `Constant deleted: ${constId}`);
    showNotification('Konstant borttagen');
  }, [addLog, showNotification]);

  const validateFile = (file) => {
    if (!file) {
      throw new Error('Ingen fil vald');
    }
    
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`Filen är för stor (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }
    
    const fileName = file.name.toLowerCase();
    const validExtensions = ['.csv', '.xsd', '.xml'];
    const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext));
    
    if (!hasValidExtension) {
      throw new Error('Ogiltig filtyp. Använd .csv, .xsd eller .xml');
    }
    
    return true;
  };

  const loadSchema = useCallback(async (file, type) => {
    addLog('info', `Loading schema: ${file.name}`, { type, fileSize: file.size });
    
    try {
      validateFile(file);
      
      const formData = new FormData();
      formData.append('file', file);

      const fileName = file.name.toLowerCase();
      let endpoint;
      
      if (fileName.endsWith('.csv')) {
        endpoint = '/api/parse-csv-schema';
      } else if (fileName.endsWith('.xsd') || fileName.endsWith('.xml')) {
        endpoint = type === 'target' ? '/api/parse-xsd-schema' : '/api/parse-csv-schema';
      }

      addLog('info', `Calling endpoint: ${API_BASE_URL}${endpoint}`);
      
      // Create abort controller for this request
      abortControllerRef.current = new AbortController();
      
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        body: formData,
        signal: abortControllerRef.current.signal,
        // Add timeout
        timeout: 60000 // 60 seconds
      });

      if (!response.ok) {
        const errorText = await response.text();
        addLog('error', 'Schema parsing failed', { status: response.status, error: errorText });
        throw new Error(`Failed to parse schema: ${errorText}`);
      }

      const schema = await response.json();
      
      // Validate schema structure
      if (!schema.fields || !Array.isArray(schema.fields)) {
        throw new Error('Invalid schema structure');
      }
      
      // Add unique IDs if missing
      schema.fields = schema.fields.map((field, idx) => ({
        ...field,
        id: field.id || `field-${idx}-${Date.now()}`,
        path: field.path || field.name
      }));
      
      addLog('success', 'Schema loaded successfully', { 
        fields: schema.fields.length,
        type: schema.type 
      });
      
      return schema;
    } catch (error) {
      if (error.name === 'AbortError') {
        addLog('warn', 'Schema loading cancelled');
        showNotification('Laddning avbruten', 'error');
      } else {
        addLog('error', 'Error loading schema', { 
          error: error.message, 
          stack: error.stack 
        });
        showNotification('Kunde inte ladda schema: ' + error.message, 'error');
      }
      return null;
    }
  }, [addLog, showNotification]);

  const handleSourceUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsLoading(true);
    try {
      const schema = await loadSchema(file, 'source');
      if (schema) {
        setSourceSchema(schema);
        // Reset folder settings when new source is loaded
        if (schema.type === 'csv') {
          setShowFolderSettings(false);
          setFolderNaming('guid');
          setFolderNamingFields([]);
          
          // Auto-populate source path with the directory of the CSV file
          // This works in Electron/desktop apps where file.path is available
          // In browsers, we can't get the actual path for security reasons,
          // but we'll still try to extract it if available
          let dirPath = '';
          
          if (file.path) {
            // Electron/desktop app - file has a path property
            const fullPath = file.path.replace(/\\/g, '/'); // Normalize to forward slashes
            const lastSlash = fullPath.lastIndexOf('/');
            if (lastSlash !== -1) {
              dirPath = fullPath.substring(0, lastSlash);
            }
          } else if (file.webkitRelativePath) {
            // Browser with webkitRelativePath (from directory picker)
            const fullPath = file.webkitRelativePath.replace(/\\/g, '/');
            const lastSlash = fullPath.lastIndexOf('/');
            if (lastSlash !== -1) {
              dirPath = fullPath.substring(0, lastSlash);
            }
          }
          
          if (dirPath) {
            setSourcePath(dirPath);
            addLog('info', `Source path auto-populated: ${dirPath}`);
            showNotification(`Källmapp autofylld: ${dirPath}`);
          } else {
            // In browser, we can't get the path, so just log it
            addLog('info', 'Could not auto-populate source path (browser security restriction). Please enter path manually.');
          }
        }
        showNotification(`Källschema laddat: ${file.name}`);
      }
    } finally {
      setIsLoading(false);
      // Reset input to allow same file to be selected again
      e.target.value = '';
    }
  }, [loadSchema, showNotification, addLog]);

  const handleTargetUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsLoading(true);
    try {
      const schema = await loadSchema(file, 'target');
      if (schema) {
        setTargetSchema(schema);
        showNotification(`Målschema laddat: ${file.name}`);
      }
    } finally {
      setIsLoading(false);
      // Reset input
      e.target.value = '';
    }
  }, [loadSchema, showNotification]);

  const handleDragStart = useCallback((e, field, type) => {
    e.dataTransfer.effectAllowed = 'copy';
    setDraggedField({ ...field, type });
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e, targetField) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedField) return;
    
    if (draggedField.type === 'source' || draggedField.type === 'constant') {
      const existingMapping = mappings.find(m => m.target === targetField.id);
      
      if (existingMapping && !existingMapping.source.includes(draggedField.id)) {
        // Add to existing mapping
        setMappings(prev => prev.map(m =>
          m.id === existingMapping.id
            ? { 
                ...m, 
                source: [...m.source, draggedField.id], 
                transform: 'concat',
                params: { ...m.params, separator: m.params?.separator || ' ' }
              }
            : m
        ));
        setSelectedMapping(existingMapping.id);
        addLog('info', 'Source field added to existing mapping');
        showNotification('Källfält tillagt till befintlig mappning');
      } else if (!existingMapping) {
        // Create new mapping
        const newMapping = {
          id: `m-${Date.now()}-${Math.random()}`,
          source: [draggedField.id],
          target: targetField.id,
          transform: 'none',
          params: { separator: ' ' },
          aggregation: 'foreach'
        };
        setMappings(prev => [...prev, newMapping]);
        setSelectedMapping(newMapping.id);
        addLog('info', 'New mapping created', { mapping: newMapping });
        showNotification('Mappning skapad');
      }
    }
    
    setDraggedField(null);
    setHoveredTarget(null);
  }, [draggedField, mappings, addLog, showNotification]);

  const handleDropOnMapping = useCallback((e, mappingId) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedField || draggedField.type !== 'source') return;
    
    const mapping = mappings.find(m => m.id === mappingId);
    if (mapping && !mapping.source.includes(draggedField.id)) {
      setMappings(prev => prev.map(m =>
        m.id === mappingId
          ? { 
              ...m, 
              source: [...m.source, draggedField.id], 
              transform: 'concat',
              params: { ...m.params, separator: m.params?.separator || ' ' }
            }
          : m
      ));
      addLog('info', 'Source field added to mapping');
      showNotification('Källfält tillagt - Slå ihop aktiverat');
    }
    
    setDraggedField(null);
    setHoveredMapping(null);
  }, [draggedField, mappings, addLog, showNotification]);

  const handleDeleteMapping = useCallback((mappingId) => {
    setMappings(prev => prev.filter(m => m.id !== mappingId));
    if (selectedMapping === mappingId) {
      setSelectedMapping(null);
    }
    addLog('info', `Mapping deleted: ${mappingId}`);
    showNotification('Mappning borttagen');
  }, [selectedMapping, addLog, showNotification]);

  const handleTransformChange = useCallback((mappingId, transform) => {
    setMappings(prev => prev.map(m => 
      m.id === mappingId ? { ...m, transform } : m
    ));
  }, []);

  const getSourceFieldName = useCallback((fieldId) => {
    const constant = constants.find(c => c.id === fieldId);
    if (constant) return `"${constant.value}"`;
    
    if (!sourceSchema) return '';
    const field = sourceSchema.fields.find(f => f.id === fieldId);
    return field ? field.name : '';
  }, [constants, sourceSchema]);

  const getTargetFieldName = useCallback((fieldId) => {
    if (!targetSchema) return '';
    const field = targetSchema.fields.find(f => f.id === fieldId);
    return field ? field.name : '';
  }, [targetSchema]);

  const getMappingsForTarget = useCallback((targetId) => {
    return mappings.filter(m => m.target === targetId);
  }, [mappings]);

  const getAllMappedSourceIds = useMemo(() => {
    const mapped = new Set();
    mappings.forEach(m => {
      m.source.forEach(s => mapped.add(s));
    });
    return mapped;
  }, [mappings]);

  const getPreviewText = useCallback((mapping) => {
    if (!sourceSchema) return '';
    const fieldNames = mapping.source.map(s => getSourceFieldName(s));
    
    if (mapping.transform === 'concat' && fieldNames.length > 1) {
      const sep = mapping.params?.separator || ' ';
      return fieldNames.join(sep);
    }
    
    return fieldNames.join(' + ');
  }, [sourceSchema, getSourceFieldName]);

  const generatePreview = useCallback(async () => {
    if (!sourceSchema || !targetSchema || mappings.length === 0) {
      showNotification('Ladda schema och skapa mappningar först', 'error');
      return;
    }

    try {
      // Generate sample data
      const sampleData = [];
      const numRows = 2;
      
      for (let i = 0; i < numRows; i++) {
        const row = {};
        sourceSchema.fields.forEach(field => {
          const fieldName = field.name.toLowerCase();
          if (fieldName.includes('name') || fieldName.includes('namn')) {
            row[field.name] = i === 0 ? 'Anna' : 'Erik';
          } else if (fieldName.includes('family') || fieldName.includes('efternamn') || fieldName.includes('surname')) {
            row[field.name] = i === 0 ? 'Andersson' : 'Eriksson';
          } else if (fieldName.includes('given') || fieldName.includes('förnamn') || fieldName.includes('firstname')) {
            row[field.name] = i === 0 ? 'Anna' : 'Erik';
          } else if (fieldName.includes('email') || fieldName.includes('mail')) {
            row[field.name] = i === 0 ? 'anna@example.com' : 'erik@example.com';
          } else if (fieldName.includes('phone') || fieldName.includes('telefon')) {
            row[field.name] = i === 0 ? '0701234567' : '0709876543';
          } else if (fieldName.includes('id') || fieldName.includes('number')) {
            row[field.name] = `${1000 + i}`;
          } else if (fieldName.includes('date') || fieldName.includes('datum')) {
            row[field.name] = i === 0 ? '2024-01-15' : '2024-02-20';
          } else if (fieldName.includes('gender') || fieldName.includes('kön')) {
            row[field.name] = i === 0 ? 'F' : 'M';
          } else {
            row[field.name] = `Exempel${i + 1}`;
          }
        });
        sampleData.push(row);
      }

      const transformed = sampleData.map(row => {
        const result = {};
        mappings.forEach(mapping => {
          const targetField = targetSchema.fields.find(f => f.id === mapping.target);
          if (!targetField) return;

          let value = mapping.source.map(srcId => {
            const constant = constants.find(c => c.id === srcId);
            if (constant) return constant.value;
            
            const srcField = sourceSchema.fields.find(f => f.id === srcId);
            return srcField ? (row[srcField.name] || '') : '';
          });

          switch (mapping.transform) {
            case 'uppercase':
              value = value.map(v => String(v).toUpperCase());
              break;
            case 'lowercase':
              value = value.map(v => String(v).toLowerCase());
              break;
            case 'trim':
              value = value.map(v => String(v).trim());
              break;
            case 'concat':
              value = [value.join(mapping.params?.separator || ' ')];
              break;
            case 'replace':
              if (mapping.params?.from) {
                value = value.map(v => String(v).replace(
                  new RegExp(mapping.params.from, 'g'),
                  mapping.params.to || ''
                ));
              }
              break;
            case 'default':
              value = value.map(v => v || mapping.params?.defaultValue || '');
              break;
          }

          result[targetField.name] = value.join('');
        });
        return result;
      });

      setPreviewData({ source: sampleData, transformed });
      setShowPreview(true);
      addLog('info', 'Preview generated successfully');
    } catch (error) {
      addLog('error', 'Failed to generate preview', { error: error.message });
      showNotification('Kunde inte generera preview', 'error');
    }
  }, [sourceSchema, targetSchema, mappings, constants, addLog, showNotification]);

  const saveMappingConfig = useCallback(async () => {
    try {
      if (!sourceSchema || !targetSchema) {
        showNotification('Ladda både käll- och målschema först', 'error');
        return;
      }
      
      const config = {
        version: '1.1',
        timestamp: new Date().toISOString(),
        sourceSchema: {
          name: sourceSchema.name,
          type: sourceSchema.type,
          fields: sourceSchema.fields
        },
        targetSchema: {
          name: targetSchema.name,
          type: targetSchema.type,
          fields: targetSchema.fields
        },
        mappings: mappings.map(m => ({
          id: m.id,
          source: m.source,
          target: m.target,
          transform: m.transform,
          params: m.params,
          aggregation: m.aggregation
        })),
        constants: constants.map(c => ({
          id: c.id,
          name: c.name,
          value: c.value,
          type: c.type
        })),
        folderNaming: folderNaming,
        folderNamingFields: folderNamingFields,
        sourcePath: sourcePath,
        targetPath: targetPath
      };

      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `schmapper-config-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      addLog('info', 'Full configuration saved with schemas');
      showNotification('Komplett konfiguration sparad (inkl. scheman)');
    } catch (error) {
      addLog('error', 'Failed to save configuration', { error: error.message });
      showNotification('Kunde inte spara konfiguration', 'error');
    }
  }, [sourceSchema, targetSchema, mappings, constants, folderNaming, folderNamingFields, sourcePath, targetPath, addLog, showNotification]);

  const loadMappingConfig = useCallback(async (file) => {
    try {
      const text = await file.text();
      const config = JSON.parse(text);
      
      // Validate config
      if (!config.version) {
        throw new Error('Invalid configuration file - missing version');
      }
      
      // Load schemas (if available in config v1.1+)
      if (config.sourceSchema && typeof config.sourceSchema === 'object' && config.sourceSchema.fields) {
        setSourceSchema(config.sourceSchema);
        addLog('info', `Loaded source schema: ${config.sourceSchema.name} (${config.sourceSchema.fields.length} fields)`);
        
        // Reset folder settings based on schema type
        if (config.sourceSchema.type === 'csv') {
          setShowFolderSettings(false);
        }
      } else if (config.sourceSchema) {
        // Old format (v1.0) - just schema name
        showNotification(`OBS: Gammalt format. Ladda "${config.sourceSchema}" manuellt först.`, 'error');
        return;
      }
      
      if (config.targetSchema && typeof config.targetSchema === 'object' && config.targetSchema.fields) {
        setTargetSchema(config.targetSchema);
        addLog('info', `Loaded target schema: ${config.targetSchema.name} (${config.targetSchema.fields.length} fields)`);
      } else if (config.targetSchema) {
        // Old format (v1.0) - just schema name
        showNotification(`OBS: Gammalt format. Ladda "${config.targetSchema}" manuellt först.`, 'error');
        return;
      }
      
      // Load constants
      if (config.constants && Array.isArray(config.constants)) {
        setConstants(config.constants.map(c => ({
          ...c,
          type: c.type || 'constant'
        })));
        addLog('info', `Loaded ${config.constants.length} constants`);
      }
      
      // Load mappings
      if (config.mappings && Array.isArray(config.mappings)) {
        setMappings(config.mappings);
        addLog('info', `Loaded ${config.mappings.length} mappings`);
      }
      
      // Load folder settings
      if (config.folderNaming) {
        setFolderNaming(config.folderNaming);
      }
      if (config.folderNamingFields && Array.isArray(config.folderNamingFields)) {
        setFolderNamingFields(config.folderNamingFields);
      }
      
      // Load paths
      if (config.sourcePath) {
        setSourcePath(config.sourcePath);
      }
      if (config.targetPath) {
        setTargetPath(config.targetPath);
      }
      
      showNotification(`Konfiguration laddad: ${config.mappings?.length || 0} mappningar, ${config.constants?.length || 0} konstanter`);
      addLog('success', 'Configuration loaded successfully');
      
    } catch (error) {
      addLog('error', 'Failed to load configuration', { error: error.message });
      showNotification('Kunde inte ladda konfiguration: ' + error.message, 'error');
    }
  }, [addLog, showNotification]);

  const handleLoadConfig = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) {
      loadMappingConfig(file);
      e.target.value = ''; // Reset input
    }
  }, [loadMappingConfig]);

  const executeBatchMapping = useCallback(async () => {
    // Validation
    if (!validatePath(sourcePath) || !validatePath(targetPath)) {
      addLog('error', 'Invalid source or target path');
      showNotification('Ogiltiga sökvägar', 'error');
      return;
    }

    if (!sourceSchema || !targetSchema || mappings.length === 0) {
      addLog('error', 'Missing schema or mappings');
      showNotification('Komplettera schema och mappningar först', 'error');
      return;
    }

    if (sourceSchema.type === 'csv' && folderNaming === 'field' && folderNamingFields.length === 0) {
      addLog('error', 'No fields selected for folder naming');
      showNotification('Välj fält för mappnamn eller använd GUID', 'error');
      return;
    }

    setProcessing(true);
    addLog('info', 'Starting batch process', {
      sourcePath,
      targetPath,
      mappingsCount: mappings.length,
      folderNaming,
      folderNamingFields
    });
    
    try {
      const requestBody = {
        source_path: sourcePath,
        target_path: targetPath,
        source_schema: sourceSchema,
        target_schema: targetSchema,
        mappings: mappings,
        folder_naming: folderNaming,
        folder_naming_fields: folderNamingFields,
        constants: constants
      };

      addLog('info', 'Sending batch request');

      // Create abort controller
      abortControllerRef.current = new AbortController();

      const response = await fetch(`${API_BASE_URL}/api/batch-process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: abortControllerRef.current.signal
      });

      const responseText = await response.text();
      addLog('info', 'Batch response received', { 
        status: response.status, 
        statusText: response.statusText
      });

      if (!response.ok) {
        addLog('error', 'Batch process failed', {
          status: response.status,
          error: responseText
        });
        throw new Error(responseText || 'Batch process failed');
      }

      const result = JSON.parse(responseText);
      addLog('success', 'Batch process completed', result);
      showNotification(
        `Batch-process slutförd! ${result.processed_files || 0} filer, ${result.processed_records || 0} poster processade.`
      );
    } catch (error) {
      if (error.name === 'AbortError') {
        addLog('warn', 'Batch process cancelled');
        showNotification('Process avbruten', 'error');
      } else {
        addLog('error', 'Batch process error', {
          message: error.message
        });
        showNotification('Fel vid batch-process: ' + error.message, 'error');
      }
    } finally {
      setProcessing(false);
      abortControllerRef.current = null;
    }
  }, [sourcePath, targetPath, sourceSchema, targetSchema, mappings, folderNaming, folderNamingFields, constants, addLog, showNotification]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (notificationTimeoutRef.current) {
        clearTimeout(notificationTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return (
    <div className="h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white flex flex-col">
      {/* Notification */}
      {notification && (
        <div 
          className={`absolute top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-slide-in ${
            notification.type === 'error' ? 'bg-red-600' : 'bg-green-600'
          }`}
          role="alert"
        >
          <AlertCircle className="w-5 h-5" />
          <span>{notification.message}</span>
        </div>
      )}

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40">
          <div className="bg-slate-800 rounded-lg p-6 flex items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            <span>Laddar schema...</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database className="w-6 h-6 text-blue-400" />
          <h1 className="text-xl font-bold">Schmapper</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded flex items-center gap-2 transition disabled:opacity-50"
            disabled={isLoading || processing}
          >
            <FileText className="w-4 h-4" />
            Loggar ({logs.length})
          </button>
          <button
            onClick={generatePreview}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded flex items-center gap-2 transition disabled:opacity-50"
            disabled={isLoading || processing || !sourceSchema || !targetSchema || mappings.length === 0}
          >
            <Eye className="w-4 h-4" />
            Preview
          </button>
          <label className="cursor-pointer px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded flex items-center gap-2 transition disabled:opacity-50">
            <Upload className="w-4 h-4" />
            Ladda config
            <input
              type="file"
              accept=".json"
              onChange={handleLoadConfig}
              className="hidden"
              disabled={processing || isLoading}
            />
          </label>
          <button
            onClick={saveMappingConfig}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded flex items-center gap-2 transition disabled:opacity-50"
            disabled={isLoading || processing || mappings.length === 0}
          >
            <Save className="w-4 h-4" />
            Spara config
          </button>
          <button
            onClick={executeBatchMapping}
            disabled={processing || isLoading}
            className={`px-4 py-2 rounded flex items-center gap-2 transition ${
              processing || isLoading
                ? 'bg-gray-600 cursor-not-allowed' 
                : 'bg-green-600 hover:bg-green-500'
            }`}
          >
            <Play className="w-4 h-4" />
            {processing ? 'Processar...' : 'Kör batch'}
          </button>
        </div>
      </div>

      {/* Path Configuration */}
      <div className="bg-slate-800 border-b border-slate-700 p-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Källmapp (hela mappen)</label>
            <input
              type="text"
              value={sourcePath}
              onChange={(e) => setSourcePath(e.target.value)}
              placeholder="C:\temp\Schmapper_test\IN"
              className="w-full bg-slate-700 px-3 py-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={processing}
            />
            <p className="text-xs text-slate-500 mt-1">
              {sourceSchema?.type === 'csv' ? 'Autofylls från CSV-filens plats (desktop-app)' : 'Ange mapp, inte specifik fil'}
            </p>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Målmapp</label>
            <input
              type="text"
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
              placeholder="C:\temp\Schmapper_test\UT"
              className="w-full bg-slate-700 px-3 py-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={processing}
            />
          </div>
          {sourceSchema && (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">
                {sourceSchema.type === 'csv' ? 'Mappstruktur (varje rad → egen mapp)' : 'Mappstruktur (varje fil → egen mapp)'}
              </label>
              <button
                onClick={() => setShowFolderSettings(!showFolderSettings)}
                className="w-full bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded text-sm text-left flex items-center justify-between transition disabled:opacity-50"
                disabled={processing}
              >
                <span>{folderNaming === 'guid' ? '🎲 GUID (unik ID)' : `📋 Fältbaserad (${folderNamingFields.length} fält)`}</span>
                <span className="text-slate-400">{showFolderSettings ? '▲' : '▼'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Folder Settings */}
      {showFolderSettings && sourceSchema && (
        <div className="bg-slate-800 border-b border-slate-700 p-4">
          <div className="bg-slate-900 rounded p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-purple-400 mb-2">Mappnamn</h3>
              <p className="text-xs text-slate-400 mb-3">
                {sourceSchema.type === 'csv' 
                  ? 'Varje CSV-rad blir en XML-fil i sin egen mapp' 
                  : 'Varje XML-fil läggs i sin egen mapp'}
              </p>
              
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="folderNaming"
                    value="guid"
                    checked={folderNaming === 'guid'}
                    onChange={(e) => setFolderNaming(e.target.value)}
                    className="text-purple-600"
                    disabled={processing}
                  />
                  <span className="text-sm">Använd GUID (unik slumpmässig ID)</span>
                </label>
                
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="folderNaming"
                    value="field"
                    checked={folderNaming === 'field'}
                    onChange={(e) => setFolderNaming(e.target.value)}
                    className="text-purple-600"
                    disabled={processing}
                  />
                  <span className="text-sm">Basera på fältvärden från {sourceSchema.type === 'csv' ? 'CSV' : 'XML'}</span>
                </label>
                
                {sourceSchema.type === 'xml' && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="folderNaming"
                      value="filename"
                      checked={folderNaming === 'filename'}
                      onChange={(e) => setFolderNaming(e.target.value)}
                      className="text-purple-600"
                      disabled={processing}
                    />
                    <span className="text-sm">Använd källfilens namn</span>
                  </label>
                )}
              </div>
            </div>

            {folderNaming === 'field' && (
              <div>
                <label className="text-xs text-slate-400 mb-2 block">Välj fält för mappnamn:</label>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {sourceSchema.fields.map(field => (
                    <label key={field.id} className="flex items-center gap-2 cursor-pointer p-2 hover:bg-slate-800 rounded">
                      <input
                        type="checkbox"
                        checked={folderNamingFields.includes(field.name)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFolderNamingFields(prev => [...prev, field.name]);
                          } else {
                            setFolderNamingFields(prev => prev.filter(f => f !== field.name));
                          }
                        }}
                        className="text-purple-600"
                        disabled={processing}
                      />
                      <span className="text-sm">{field.name}</span>
                    </label>
                  ))}
                </div>
                {folderNamingFields.length > 0 && (
                  <div className="mt-3 p-2 bg-slate-800 rounded text-xs">
                    <span className="text-slate-400">Exempel mappnamn: </span>
                    <span className="text-green-400">{folderNamingFields.join('_')}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Source Schema Panel */}
        <div className="w-1/3 bg-slate-800 border-r border-slate-700 flex flex-col">
          <div className="p-4 border-b border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-lg text-blue-400">Källschema</h2>
              <label className="cursor-pointer px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm flex items-center gap-1 transition disabled:opacity-50 disabled:cursor-not-allowed">
                <Upload className="w-3 h-3" />
                Ladda
                <input
                  type="file"
                  accept=".csv,.xsd,.xml"
                  onChange={handleSourceUpload}
                  className="hidden"
                  disabled={processing || isLoading}
                />
              </label>
            </div>
            {sourceSchema && (
              <p className="text-sm text-slate-400 flex items-center gap-1">
                <FileText className="w-3 h-3" />
                {sourceSchema.name}
              </p>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {!sourceSchema ? (
              <div className="text-center text-slate-500 mt-8">
                <Upload className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Ladda ett källschema</p>
                <p className="text-xs">(CSV, XSD eller XML)</p>
              </div>
            ) : (
              <>
                {/* Constants section */}
                {constants.length > 0 && (
                  <div className="mb-4">
                    <div className="text-xs font-semibold text-purple-400 mb-2">Fasta värden</div>
                    {constants.map(constant => (
                      <div
                        key={constant.id}
                        draggable={!processing}
                        onDragStart={(e) => handleDragStart(e, constant, 'constant')}
                        className="bg-purple-900 bg-opacity-30 hover:bg-opacity-50 p-3 rounded cursor-move transition group border border-purple-500"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm text-purple-300">{constant.name}</span>
                          <button
                            onClick={() => deleteConstant(constant.id)}
                            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition"
                            disabled={processing}
                            aria-label="Ta bort konstant"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="text-xs text-purple-200 font-mono bg-purple-950 px-2 py-1 rounded break-all">
                          = "{constant.value}"
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Add constant button */}
                <button
                  onClick={() => setShowConstantModal(true)}
                  className="w-full mb-4 p-3 border-2 border-dashed border-purple-500 rounded hover:bg-purple-900 hover:bg-opacity-20 transition flex items-center justify-center gap-2 text-purple-400 disabled:opacity-50"
                  disabled={processing}
                >
                  <Plus className="w-4 h-4" />
                  Nytt fast värde
                </button>
                
                {/* Schema fields */}
                <div className="text-xs font-semibold text-blue-400 mb-2">Källfält</div>
                {sourceSchema.fields.map(field => {
                  const isMapped = getAllMappedSourceIds.has(field.id);
                  const displayName = field.name;
                  const fullPath = field.path || field.name;
                  
                  return (
                    <div
                      key={field.id}
                      draggable={!processing}
                      onDragStart={(e) => handleDragStart(e, field, 'source')}
                      className={`bg-slate-700 hover:bg-slate-600 p-3 rounded cursor-move transition group ${
                        isMapped ? 'border-l-4 border-green-500' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-blue-300 mb-1 truncate" title={displayName}>
                            {displayName}
                          </div>
                          <div className="text-xs text-slate-400 font-mono bg-slate-800 px-2 py-1 rounded inline-block break-all">
                            {fullPath}
                          </div>
                        </div>
                        <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded ml-2 flex-shrink-0">
                          {field.type}
                        </span>
                      </div>
                      {isMapped && (
                        <div className="text-xs text-green-400 flex items-center gap-1">
                          <span>✓</span> Mappad
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Mappings Panel */}
        <div className="flex-1 bg-slate-900 flex flex-col">
          <div className="p-4 border-b border-slate-700">
            <h2 className="font-semibold text-lg text-purple-400">Mappningar</h2>
            <p className="text-sm text-slate-400">
              Dra fält från vänster till höger, eller till befintlig mappning för att slå ihop
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {mappings.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-500">
                <div className="text-center">
                  <Plus className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>Inga mappningar ännu</p>
                  <p className="text-sm">Dra ett källfält till ett målfält för att börja</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {mappings.map(mapping => (
                  <div
                    key={mapping.id}
                    className={`bg-slate-800 rounded-lg p-4 border-2 transition ${
                      selectedMapping === mapping.id
                        ? 'border-purple-500'
                        : 'border-slate-700 hover:border-slate-600'
                    } ${
                      hoveredMapping === mapping.id && draggedField ? 'ring-2 ring-blue-400 bg-slate-750' : ''
                    }`}
                    onClick={() => setSelectedMapping(mapping.id)}
                    onDragOver={(e) => {
                      if (!processing) {
                        e.preventDefault();
                        e.stopPropagation();
                        setHoveredMapping(mapping.id);
                      }
                    }}
                    onDragLeave={(e) => {
                      e.stopPropagation();
                      setHoveredMapping(null);
                    }}
                    onDrop={(e) => !processing && handleDropOnMapping(e, mapping.id)}
                  >
                    {draggedField && draggedField.type === 'source' && !processing && (
                      <div className="mb-3 p-2 bg-blue-900 bg-opacity-30 border border-blue-500 border-dashed rounded text-xs text-blue-300 text-center">
                        ↓ Släpp här för att lägga till i mappningen
                      </div>
                    )}

                    <div className="flex items-center justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          {mapping.source.map((srcId, idx) => (
                            <React.Fragment key={srcId}>
                              {idx > 0 && <span className="text-slate-500 text-xs">+</span>}
                              <div className="bg-blue-600 px-3 py-1 rounded text-sm font-medium truncate max-w-xs" title={getSourceFieldName(srcId)}>
                                {getSourceFieldName(srcId)}
                              </div>
                            </React.Fragment>
                          ))}
                          <span className="text-slate-400">→</span>
                          <div className="bg-green-600 px-3 py-1 rounded text-sm font-medium truncate max-w-xs" title={getTargetFieldName(mapping.target)}>
                            {getTargetFieldName(mapping.target)}
                          </div>
                        </div>
                        {mapping.source.length > 1 && (
                          <div className="text-xs text-slate-400 bg-slate-900 px-2 py-1 rounded inline-block break-all">
                            Resultat: "{getPreviewText(mapping)}"
                          </div>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteMapping(mapping.id);
                        }}
                        className="text-slate-400 hover:text-red-400 transition ml-2 flex-shrink-0 disabled:opacity-50"
                        disabled={processing}
                        aria-label="Ta bort mappning"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 mb-3">
                      {transforms.map(t => (
                        <button
                          key={t.id}
                          onClick={() => handleTransformChange(mapping.id, t.id)}
                          className={`px-3 py-1 rounded text-xs transition disabled:opacity-50 ${
                            mapping.transform === t.id
                              ? 'bg-purple-600 text-white'
                              : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                          }`}
                          disabled={processing}
                        >
                          <span className="mr-1">{t.icon}</span>
                          {t.name}
                        </button>
                      ))}
                    </div>

                    {mapping.transform === 'concat' && mapping.source.length > 1 && (
                      <div className="pt-3 border-t border-slate-700">
                        <label className="text-xs text-slate-400">Separator:</label>
                        <input
                          type="text"
                          value={mapping.params?.separator || ' '}
                          onChange={(e) => {
                            setMappings(prev => prev.map(m =>
                              m.id === mapping.id
                                ? { ...m, params: { ...m.params, separator: e.target.value } }
                                : m
                            ));
                          }}
                          className="ml-2 bg-slate-700 px-2 py-1 rounded text-sm w-20 focus:outline-none focus:ring-2 focus:ring-purple-500"
                          placeholder="' '"
                          disabled={processing}
                        />
                      </div>
                    )}

                    {mapping.transform === 'replace' && (
                      <div className="pt-3 border-t border-slate-700 space-y-2">
                        <div>
                          <label className="text-xs text-slate-400">Från:</label>
                          <input
                            type="text"
                            value={mapping.params?.from || ''}
                            onChange={(e) => {
                              setMappings(prev => prev.map(m =>
                                m.id === mapping.id
                                  ? { ...m, params: { ...m.params, from: e.target.value } }
                                  : m
                              ));
                            }}
                            className="ml-2 bg-slate-700 px-2 py-1 rounded text-sm w-full focus:outline-none focus:ring-2 focus:ring-purple-500"
                            placeholder="Text att ersätta"
                            disabled={processing}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400">Till:</label>
                          <input
                            type="text"
                            value={mapping.params?.to || ''}
                            onChange={(e) => {
                              setMappings(prev => prev.map(m =>
                                m.id === mapping.id
                                  ? { ...m, params: { ...m.params, to: e.target.value } }
                                  : m
                              ));
                            }}
                            className="ml-2 bg-slate-700 px-2 py-1 rounded text-sm w-full focus:outline-none focus:ring-2 focus:ring-purple-500"
                            placeholder="Ny text"
                            disabled={processing}
                          />
                        </div>
                      </div>
                    )}

                    {mapping.transform === 'regex' && (
                      <div className="pt-3 border-t border-slate-700 space-y-2">
                        <div>
                          <label className="text-xs text-slate-400">Pattern (regex):</label>
                          <input
                            type="text"
                            value={mapping.params?.pattern || ''}
                            onChange={(e) => {
                              setMappings(prev => prev.map(m =>
                                m.id === mapping.id
                                  ? { ...m, params: { ...m.params, pattern: e.target.value } }
                                  : m
                              ));
                            }}
                            className="ml-2 bg-slate-700 px-2 py-1 rounded text-sm w-full font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                            placeholder="t.ex. .*(\d{12}).*"
                            disabled={processing}
                          />
                          <p className="text-xs text-slate-500 mt-1 ml-2">Exempel: .*(\d{`{12}`}).* hittar 12 siffror</p>
                        </div>
                        <div>
                          <label className="text-xs text-slate-400">Replacement:</label>
                          <input
                            type="text"
                            value={mapping.params?.replacement || ''}
                            onChange={(e) => {
                              setMappings(prev => prev.map(m =>
                                m.id === mapping.id
                                  ? { ...m, params: { ...m.params, replacement: e.target.value } }
                                  : m
                              ));
                            }}
                            className="ml-2 bg-slate-700 px-2 py-1 rounded text-sm w-full font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                            placeholder="t.ex. $1"
                            disabled={processing}
                          />
                          <p className="text-xs text-slate-500 mt-1 ml-2">Använd $1, $2 etc för grupper</p>
                        </div>
                      </div>
                    )}

                    {mapping.transform === 'format' && (
                      <div className="pt-3 border-t border-slate-700 space-y-2">
                        <div>
                          <label className="text-xs text-slate-400">Format-sträng:</label>
                          <input
                            type="text"
                            value={mapping.params?.format || ''}
                            onChange={(e) => {
                              setMappings(prev => prev.map(m =>
                                m.id === mapping.id
                                  ? { ...m, params: { ...m.params, format: e.target.value } }
                                  : m
                              ));
                            }}
                            className="ml-2 bg-slate-700 px-2 py-1 rounded text-sm w-full font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                            placeholder="t.ex. {0}-{1}-{2}"
                            disabled={processing}
                          />
                          <p className="text-xs text-slate-500 mt-1 ml-2">{`Använd {0}, {1} etc som platshållare`}</p>
                        </div>
                        <div>
                          <label className="text-xs text-slate-400">Dela vid positioner:</label>
                          <input
                            type="text"
                            value={mapping.params?.split_at || ''}
                            onChange={(e) => {
                              setMappings(prev => prev.map(m =>
                                m.id === mapping.id
                                  ? { ...m, params: { ...m.params, split_at: e.target.value } }
                                  : m
                              ));
                            }}
                            className="ml-2 bg-slate-700 px-2 py-1 rounded text-sm w-full font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                            placeholder="t.ex. 4,6,8"
                            disabled={processing}
                          />
                          <p className="text-xs text-slate-500 mt-1 ml-2">Dela "19500101" vid 4,6,8 → "1950", "01", "01"</p>
                        </div>
                      </div>
                    )}

                    {mapping.transform === 'default' && (
                      <div className="pt-3 border-t border-slate-700">
                        <label className="text-xs text-slate-400">Standardvärde:</label>
                        <input
                          type="text"
                          value={mapping.params?.defaultValue || ''}
                          onChange={(e) => {
                            setMappings(prev => prev.map(m =>
                              m.id === mapping.id
                                ? { ...m, params: { ...m.params, defaultValue: e.target.value } }
                                : m
                            ));
                          }}
                          className="ml-2 bg-slate-700 px-2 py-1 rounded text-sm w-full focus:outline-none focus:ring-2 focus:ring-purple-500"
                          placeholder="Värde om källan är tom"
                          disabled={processing}
                        />
                      </div>
                    )}
                    
                    {/* Aggregation mode */}
                    {mapping.source.length === 1 && (
                      <div className="pt-3 border-t border-slate-700">
                        <label className="text-xs text-slate-400 block mb-2">Aggregering:</label>
                        <div className="space-y-1">
                          {aggregationModes.map(mode => (
                            <label key={mode.id} className="flex items-start gap-2 cursor-pointer p-2 hover:bg-slate-750 rounded">
                              <input
                                type="radio"
                                name={`agg-${mapping.id}`}
                                value={mode.id}
                                checked={(mapping.aggregation || 'foreach') === mode.id}
                                onChange={(e) => {
                                  setMappings(prev => prev.map(m =>
                                    m.id === mapping.id
                                      ? { ...m, aggregation: e.target.value }
                                      : m
                                  ));
                                }}
                                className="mt-1"
                                disabled={processing}
                              />
                              <div>
                                <div className="text-xs font-medium">{mode.name}</div>
                                <div className="text-xs text-slate-500">{mode.description}</div>
                              </div>
                            </label>
                          ))}
                        </div>
                        {mapping.aggregation === 'merge' && (
                          <div className="mt-2">
                            <label className="text-xs text-slate-400">Separator:</label>
                            <input
                              type="text"
                              value={mapping.params?.mergeSeparator || ', '}
                              onChange={(e) => {
                                setMappings(prev => prev.map(m =>
                                  m.id === mapping.id
                                    ? { ...m, params: { ...m.params, mergeSeparator: e.target.value } }
                                    : m
                                ));
                              }}
                              className="ml-2 bg-slate-700 px-2 py-1 rounded text-sm w-20 focus:outline-none focus:ring-2 focus:ring-purple-500"
                              placeholder="', '"
                              disabled={processing}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Target Schema Panel */}
        <div className="w-1/3 bg-slate-800 border-l border-slate-700 flex flex-col">
          <div className="p-4 border-b border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-lg text-green-400">Målschema</h2>
              <label className="cursor-pointer px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-sm flex items-center gap-1 transition disabled:opacity-50 disabled:cursor-not-allowed">
                <Upload className="w-3 h-3" />
                Ladda
                <input
                  type="file"
                  accept=".xsd,.xml"
                  onChange={handleTargetUpload}
                  className="hidden"
                  disabled={processing || isLoading}
                />
              </label>
            </div>
            {targetSchema && (
              <p className="text-sm text-slate-400 flex items-center gap-1">
                <FileText className="w-3 h-3" />
                {targetSchema.name}
              </p>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {!targetSchema ? (
              <div className="text-center text-slate-500 mt-8">
                <Upload className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Ladda ett målschema</p>
                <p className="text-xs">(XSD eller XML)</p>
              </div>
            ) : (
              targetSchema.fields.map(field => {
                const fieldMappings = getMappingsForTarget(field.id);
                const isHovered = hoveredTarget === field.id;
                const fullPath = field.path || field.name;
                
                return (
                  <div
                    key={field.id}
                    onDragOver={!processing ? handleDragOver : undefined}
                    onDrop={!processing ? (e) => handleDrop(e, field) : undefined}
                    onDragEnter={() => !processing && setHoveredTarget(field.id)}
                    onDragLeave={() => setHoveredTarget(null)}
                    className={`bg-slate-700 p-3 rounded transition ${
                      isHovered && !processing ? 'ring-2 ring-green-400 bg-slate-600' : ''
                    } ${
                      fieldMappings.length > 0 ? 'border-l-4 border-green-500' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-green-300 mb-1 truncate" title={field.name}>
                          {field.name}
                        </div>
                        <div className="text-xs text-slate-400 font-mono bg-slate-800 px-2 py-1 rounded inline-block break-all">
                          {fullPath}
                        </div>
                      </div>
                      <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded ml-2 flex-shrink-0">
                        {field.type}
                      </span>
                    </div>
                    {fieldMappings.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-600 text-xs text-green-400 truncate" title={fieldMappings.map(m => 
                          m.source.map(s => getSourceFieldName(s)).join(' + ')
                        ).join(', ')}>
                        ← {fieldMappings.map(m => 
                          m.source.map(s => getSourceFieldName(s)).join(' + ')
                        ).join(', ')}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Constant Modal */}
      {showConstantModal && (
        <div 
          className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
          onClick={() => setShowConstantModal(false)}
        >
          <div 
            className="bg-slate-800 rounded-lg w-96 flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Nytt fast värde</h3>
              <button
                onClick={() => setShowConstantModal(false)}
                className="text-slate-400 hover:text-white transition"
                aria-label="Stäng"
              >
                ✕
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="text-sm text-slate-300 block mb-1">Namn</label>
                <input
                  type="text"
                  value={constantName}
                  onChange={(e) => setConstantName(e.target.value)}
                  placeholder="t.ex. Standard_Land"
                  className="w-full bg-slate-700 px-3 py-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  autoFocus
                  maxLength={100}
                />
              </div>
              <div>
                <label className="text-sm text-slate-300 block mb-1">Värde</label>
                <input
                  type="text"
                  value={constantValue}
                  onChange={(e) => setConstantValue(e.target.value)}
                  placeholder="t.ex. Sverige"
                  className="w-full bg-slate-700 px-3 py-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  onKeyPress={(e) => e.key === 'Enter' && createConstant()}
                  maxLength={500}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowConstantModal(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm transition"
                >
                  Avbryt
                </button>
                <button
                  onClick={createConstant}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded text-sm transition"
                >
                  Skapa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && previewData && (
        <div 
          className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
          onClick={() => setShowPreview(false)}
        >
          <div 
            className="bg-slate-800 rounded-lg w-4/5 h-4/5 flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Data Preview</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-slate-400 hover:text-white transition"
                aria-label="Stäng"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-semibold text-blue-400 mb-2">Källdata</h4>
                <pre className="bg-slate-900 p-3 rounded text-xs overflow-auto h-full">
                  {JSON.stringify(previewData.source, null, 2)}
                </pre>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-green-400 mb-2">Transformerad data</h4>
                <pre className="bg-slate-900 p-3 rounded text-xs overflow-auto h-full">
                  {JSON.stringify(previewData.transformed, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Logs Modal */}
      {showLogs && (
        <div 
          className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
          onClick={() => setShowLogs(false)}
        >
          <div 
            className="bg-slate-800 rounded-lg w-4/5 h-4/5 flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Loggar</h3>
              <div className="flex gap-2">
                <button
                  onClick={downloadLogs}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm transition"
                >
                  <Download className="w-4 h-4 inline mr-1" />
                  Ladda ner
                </button>
                <button
                  onClick={clearLogs}
                  className="px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-sm transition"
                >
                  <Trash2 className="w-4 h-4 inline mr-1" />
                  Rensa
                </button>
                <button
                  onClick={() => setShowLogs(false)}
                  className="text-slate-400 hover:text-white transition"
                  aria-label="Stäng"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {logs.length === 0 ? (
                <div className="text-center text-slate-500 mt-8">
                  <p>Inga loggar ännu</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {logs.map((log) => (
                    <div 
                      key={log.id}
                      className={`p-3 rounded text-xs ${
                        log.level === 'error' ? 'bg-red-900 bg-opacity-30 border border-red-500' :
                        log.level === 'success' ? 'bg-green-900 bg-opacity-30 border border-green-500' :
                        log.level === 'warn' ? 'bg-yellow-900 bg-opacity-30 border border-yellow-500' :
                        'bg-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-1">
                        <span className={`font-semibold ${
                          log.level === 'error' ? 'text-red-400' :
                          log.level === 'success' ? 'text-green-400' :
                          log.level === 'warn' ? 'text-yellow-400' :
                          'text-blue-400'
                        }`}>
                          [{log.level.toUpperCase()}]
                        </span>
                        <span className="text-slate-500">{new Date(log.timestamp).toLocaleString('sv-SE')}</span>
                      </div>
                      <div className="text-slate-200 break-words">{log.message}</div>
                      {log.data && (
                        <pre className="mt-2 text-slate-400 overflow-auto max-h-40 break-all whitespace-pre-wrap">
                          {log.data}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer Status Bar */}
      <div className="bg-slate-800 border-t border-slate-700 px-4 py-2 flex items-center justify-between text-sm">
        <div className="text-slate-400">
          {mappings.length} mappning{mappings.length !== 1 ? 'ar' : ''} • 
          {sourceSchema ? ` Källa: ${sourceSchema.name}` : ' Ingen källa'} • 
          {targetSchema ? ` Mål: ${targetSchema.name}` : ' Inget mål'}
        </div>
        {targetSchema && (
          <div className="text-slate-400">
            {targetSchema.fields.length - mappings.length} fält kvar att mappa
          </div>
        )}
      </div>
    </div>
  );
};

export default SchemaMapper;