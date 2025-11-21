import React, { useState, useCallback, useMemo, useRef } from 'react';
import { Download, Upload, Play, Trash2, Plus, Database, Eye, Save, FileText, AlertCircle, Repeat, Link, ChevronDown, ChevronRight, X } from 'lucide-react';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8000';

// Constants
const MAX_LOG_ENTRIES = 1000;
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const NOTIFICATION_TIMEOUT = 3000;
const FETCH_TIMEOUT = 60000;

// Utility functions
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return '';
  return input.replace(/<script[^>]*>.*?<\/script>/gi, '')
              .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '')
              .replace(/javascript:/gi, '')
              .replace(/on\w+\s*=/gi, '');
};

const validatePath = (path) => {
  if (!path || typeof path !== 'string') return false;
  const invalidChars = /[<>"|?*]/;
  return !invalidChars.test(path) && path.length > 0 && path.length < 260;
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
  const [expandedRepeatingElements, setExpandedRepeatingElements] = useState({});

  // Refs
  const notificationTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Logging
  const addLog = useCallback((level, message, data = null) => {
    const timestamp = new Date().toISOString();
    const logEntry = {
      id: `${timestamp}-${Math.random()}`,
      timestamp,
      level,
      message: sanitizeInput(message),
      data: data ? JSON.stringify(data, null, 2).substring(0, 1000) : null
    };
    
    setLogs(prev => {
      const newLogs = [...prev, logEntry];
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
    { id: 'repeat', name: 'Repetera (1:n)', description: 'Ett målelement per upprepning i källan', icon: <Repeat className="w-3 h-3" /> },
    { id: 'merge', name: 'Slå ihop alla', description: 'Alla källvärden i samma målelement' }
  ], []);

  const showNotification = useCallback((message, type = 'success') => {
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

  // Helper to check if a source field belongs to a repeating element
  const getRepeatingElementForField = useCallback((fieldPath) => {
    if (!sourceSchema?.repeating_elements) return null;
    
    for (const elem of sourceSchema.repeating_elements) {
      if (fieldPath.startsWith(elem.path + '/')) {
        return elem;
      }
    }
    return null;
  }, [sourceSchema]);

  // Helper to get repeating container mapping
  const getRepeatingContainerForElement = useCallback((elemPath) => {
    return mappings.find(m => 
      m.aggregation === 'repeat' && 
      m.loop_element_path === elemPath &&
      m.is_container
    );
  }, [mappings]);

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
    
    let timeoutId;
    try {
      validateFile(file);
      
      const formData = new FormData();
      formData.append('file', file);

      const fileName = file.name.toLowerCase();
      let endpoint;

      if (fileName.endsWith('.csv')) {
        endpoint = '/api/parse-csv-schema';
      } else if (fileName.endsWith('.xsd')) {
        endpoint = type === 'target' ? '/api/parse-xsd-schema' : '/api/parse-csv-schema';
      } else if (fileName.endsWith('.xml')) {
        endpoint = type === 'target' ? '/api/parse-xsd-schema' : '/api/parse-csv-schema';
      }

      addLog('info', `Calling endpoint: ${API_BASE_URL}${endpoint}`);
      
      abortControllerRef.current = new AbortController();
      timeoutId = setTimeout(() => {
        abortControllerRef.current.abort();
        addLog('error', 'Request timeout after 60 seconds');
      }, FETCH_TIMEOUT);
      
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        body: formData,
        signal: abortControllerRef.current.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        addLog('error', 'Schema parsing failed', { status: response.status, error: errorText });
        throw new Error(`Failed to parse schema: ${errorText}`);
      }

      const schema = await response.json();
      
      if (!schema.fields || !Array.isArray(schema.fields)) {
        throw new Error('Invalid schema structure');
      }
      
      schema.fields = schema.fields.map((field, idx) => ({
        ...field,
        id: field.id || `field-${idx}-${Date.now()}`,
        path: field.path || field.name
      }));
      
      addLog('success', 'Schema loaded successfully', { 
        fields: schema.fields.length,
        type: schema.type,
        repeating: schema.repeating_elements?.length || 0
      });
      
      return schema;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        addLog('warn', 'Schema loading cancelled or timed out');
        showNotification('Laddning avbruten eller timeout', 'error');
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
        setMappings([]);
        setSelectedMapping(null);
        setFolderNaming('guid');
        setFolderNamingFields([]);
        setShowFolderSettings(false);
        setExpandedRepeatingElements({});
        
        addLog('info', 'New source schema loaded - all mappings cleared');
        
        if (schema.type === 'csv' && file.path) {
          const fullPath = file.path.replace(/\\/g, '/');
          const lastSlash = fullPath.lastIndexOf('/');
          if (lastSlash !== -1) {
            const dirPath = fullPath.substring(0, lastSlash);
            setSourcePath(dirPath);
            addLog('info', `Source path auto-populated: ${dirPath}`);
          }
        }
        
        showNotification(`Källschema laddat: ${file.name} (${schema.repeating_elements?.length || 0} upprepande)`);
      }
    } finally {
      setIsLoading(false);
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
        setMappings([]);
        setSelectedMapping(null);
        setFolderNaming('guid');
        setFolderNamingFields([]);
        setShowFolderSettings(false);
        
        addLog('info', 'New target schema loaded - all mappings cleared');
        showNotification(`Målschema laddat: ${file.name}`);
      }
    } finally {
      setIsLoading(false);
      e.target.value = '';
    }
  }, [loadSchema, showNotification, addLog]);

  const handleDragStart = useCallback((e, field, type) => {
    console.log('[DRAG START]', { field, type });
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
    
    console.log('[DROP]', { draggedField, targetField });
    
    if (!draggedField) return;
    
    // Handle repeating wrapper -> wrapper mapping
    if (draggedField.type === 'repeating-source') {
      const repeatingElem = draggedField.repeatingElement;
      
      // Check if container already exists for this source element
      const existingContainer = getRepeatingContainerForElement(repeatingElem.path);
      if (existingContainer) {
        showNotification('Denna wrapper är redan mappad', 'error');
        setDraggedField(null);
        setHoveredTarget(null);
        return;
      }
      
      // NEW: Check if target is a repeatable field (not wrapper)
      const isTargetRepeatable = targetField.repeatable || targetField.maxOccurs === 'unbounded' || 
        (targetField.maxOccurs && parseInt(targetField.maxOccurs) > 1);
      
      // Create container mapping
      const containerMapping = {
        id: `m-repeat-${Date.now()}-${Math.random()}`,
        source: [],
        target: '',
        transforms: [],
        params: {},
        aggregation: 'repeat',
        loop_element_path: repeatingElem.path,
        target_wrapper_path: isTargetRepeatable ? null : targetField.path,  // NEW: null if no wrapper
        is_relative_path: true,
        is_container: true,
        repeating_element: repeatingElem,
        child_mappings: [],
        repeat_to_single: isTargetRepeatable  // NEW: Flag for repeat-to-single
      };

      setMappings(prev => [...prev, containerMapping]);
      setSelectedMapping(containerMapping.id);
      
      // Auto-expand source element
      setExpandedRepeatingElements(prev => ({
        ...prev,
        [repeatingElem.path]: true
      }));
      
      const mappingType = isTargetRepeatable ? 'repeat-to-single' : 'repeat-to-wrapper';
      addLog('info', `Created ${mappingType} container: ${repeatingElem.path} → ${targetField.path}`);
      showNotification(`Upprepande mappning skapad: ${repeatingElem.tag} → ${targetField.name}`, 'success');
      
      setDraggedField(null);
      setHoveredTarget(null);
      return;
    }
    
    // Handle regular field or constant
    if (draggedField.type === 'source' || draggedField.type === 'constant') {
      // Check if source field is from repeating element
      const sourceField = draggedField.type === 'source' ? sourceSchema?.fields.find(f => f.id === draggedField.id) : null;
      const parentRepeating = draggedField.parentRepeating;
      const repContainer = parentRepeating ? getRepeatingContainerForElement(parentRepeating) : null;

      console.log('[DROP DEBUG]', {
        draggedFieldId: draggedField.id,
        parentRepeating,
        hasContainer: !!repContainer,
        targetField: targetField.name,
        targetRepeatable: targetField.repeatable,
        targetMaxOccurs: targetField.maxOccurs
      });

      // NEW: Check if target is a repeatable field (for repeat-to-single)
      // Check both field properties AND if it exists in repeating_elements
      let isTargetRepeatable = targetField.repeatable || targetField.maxOccurs === 'unbounded' || 
        (targetField.maxOccurs && parseInt(targetField.maxOccurs) > 1);
      
      // Also check if target schema has this as a repeating element (wrapper-less)
      if (!isTargetRepeatable && targetSchema?.repeating_elements) {
        const targetAsRepeating = targetSchema.repeating_elements.find(r => 
          r.path === targetField.path || r.name === targetField.name
        );
        if (targetAsRepeating) {
          isTargetRepeatable = true;
          console.log('[DROP DEBUG] Target found in repeating_elements:', targetAsRepeating);
        }
      }
      
      console.log('[DROP DEBUG] isTargetRepeatable:', isTargetRepeatable, 'will create repeat-to-single:', parentRepeating && isTargetRepeatable && !repContainer);
      
      // NEW: If source is from repeating element AND target is repeatable field, create/use repeat-to-single container
      if (parentRepeating && isTargetRepeatable && !repContainer) {
        console.log('[DROP DEBUG] Creating repeat-to-single container...');
        // Need to create a repeat-to-single container first
        const sourceRepElem = sourceSchema?.repeating_elements?.find(r => r.path === parentRepeating);
        
        console.log('[DROP DEBUG] sourceRepElem:', sourceRepElem);
        
        if (sourceRepElem) {
          // Create repeat-to-single container
          const newContainer = {
            id: `container-${Date.now()}`,
            source: [],
            target: '',
            aggregation: 'repeat',
            loop_element_path: sourceRepElem.path,
            target_wrapper_path: null,  // No wrapper for repeat-to-single
            is_container: true,
            transforms: [],
            params: {},
            repeat_to_single: true,
            repeating_element: sourceRepElem,  // NEW: Add for UI display
            child_mappings: []
          };
          
          // Create the field mapping
          const newMapping = {
            id: `m-${Date.now()}-${Math.random()}`,
            source: [draggedField.id],
            target: targetField.id,
            transforms: [],
            params: { separator: ' ' },
            aggregation: 'foreach',
            parent_repeat_container: newContainer.id
          };
          
          // Add both
          setMappings(prev => [...prev, newContainer, newMapping]);
          
          // Link child to container
          newContainer.child_mappings = [newMapping.id];
          
          // Auto-expand
          setExpandedRepeatingElements(prev => ({
            ...prev,
            [sourceRepElem.path]: true
          }));
          
          addLog('info', `Created repeat-to-single container and mapping: ${sourceRepElem.path} → ${targetField.name}`);
          showNotification(`Repeat-to-single mappning skapad: ${sourceRepElem.tag} → ${targetField.name}`, 'success');
          setSelectedMapping(newMapping.id);
          setDraggedField(null);
          setHoveredTarget(null);
          return;
        }
      }

      const existingMapping = mappings.find(m => m.target === targetField.id);
      
      if (existingMapping && !existingMapping.source.includes(draggedField.id)) {
        // Add to existing mapping
        setMappings(prev => prev.map(m =>
          m.id === existingMapping.id
            ? { 
                ...m, 
                source: [...m.source, draggedField.id],
                transforms: m.transforms && m.transforms.includes('concat') 
                  ? m.transforms 
                  : [...(m.transforms || []), 'concat'],
                params: { ...m.params, separator: m.params?.separator || ' ' },
                parent_repeat_container: repContainer?.id || m.parent_repeat_container
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
          transforms: [],
          params: { separator: ' ' },
          aggregation: 'foreach',
          parent_repeat_container: repContainer?.id || null
        };
        
        setMappings(prev => [...prev, newMapping]);
        
        // If part of repeating container, link it
        if (repContainer) {
          setMappings(prev => prev.map(m => 
            m.id === repContainer.id
              ? { ...m, child_mappings: [...(m.child_mappings || []), newMapping.id] }
              : m
          ));
          addLog('info', `New mapping created in repeating container: ${parentRepeating}`);
          showNotification(`Mappning skapad i ${repContainer.repeating_element?.tag}`, 'success');
        } else {
          addLog('info', 'New mapping created');
          showNotification('Mappning skapad');
        }
        
        setSelectedMapping(newMapping.id);
      }
    }
    
    setDraggedField(null);
    setHoveredTarget(null);
  }, [draggedField, mappings, sourceSchema, getRepeatingContainerForElement, addLog, showNotification]);

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
    const mapping = mappings.find(m => m.id === mappingId);
    
    // If it's a container, delete all child mappings too
    if (mapping?.is_container) {
      const childIds = mapping.child_mappings || [];
      setMappings(prev => prev.filter(m => m.id !== mappingId && !childIds.includes(m.id)));
      addLog('info', `Deleted repeating container and ${childIds.length} child mappings`);
    } else {
      setMappings(prev => prev.filter(m => m.id !== mappingId));
      
      // Remove from parent container if linked
      if (mapping?.parent_repeat_container) {
        setMappings(prev => prev.map(m =>
          m.id === mapping.parent_repeat_container
            ? { ...m, child_mappings: (m.child_mappings || []).filter(id => id !== mappingId) }
            : m
        ));
      }
    }
    
    if (selectedMapping === mappingId) {
      setSelectedMapping(null);
    }
    
    showNotification('Mappning borttagen');
  }, [mappings, selectedMapping, addLog, showNotification]);

  const handleRemoveSourceFromMapping = useCallback((mappingId, sourceId) => {
    setMappings(prev => prev.map(m => {
      if (m.id === mappingId) {
        const newSource = m.source.filter(s => s !== sourceId);
        if (newSource.length === 0) {
          return null;
        }
        return { ...m, source: newSource };
      }
      return m;
    }).filter(Boolean));
    addLog('info', 'Source removed from mapping');
  }, [addLog]);

  const handleUpdateMappingTransforms = useCallback((mappingId, transforms) => {
    setMappings(prev => prev.map(m =>
      m.id === mappingId ? { ...m, transforms } : m
    ));
  }, []);

  const handleUpdateMappingParams = useCallback((mappingId, params) => {
    setMappings(prev => prev.map(m =>
      m.id === mappingId ? { ...m, params: { ...m.params, ...params } } : m
    ));
  }, []);

  const handleTransformChange = useCallback((mappingId, transformId) => {
    setMappings(prev => prev.map(m => {
      if (m.id !== mappingId) return m;
      
      let currentTransforms = m.transforms || (m.transform && m.transform !== 'none' ? [m.transform] : []);
      
      let newTransforms;
      if (currentTransforms.includes(transformId)) {
        newTransforms = currentTransforms.filter(t => t !== transformId);
      } else {
        newTransforms = [...currentTransforms, transformId];
      }
      
      return { ...m, transforms: newTransforms };
    }));
  }, []);

  const handleAggregationChange = useCallback((mappingId, newAggregation) => {
    setMappings(prev => prev.map(m => {
      if (m.id !== mappingId) return m;
      return { ...m, aggregation: newAggregation };
    }));
  }, []);

  const getSourceFieldName = useCallback((fieldId) => {
    const constant = constants.find(c => c.id === fieldId);
    if (constant) return `"${constant.value}"`;
    
    if (!sourceSchema) return '';
    
    // Search in regular fields
    let field = sourceSchema.fields.find(f => f.id === fieldId);
    if (field) return field.name;
    
    // Search in repeating elements child fields
    if (sourceSchema.repeating_elements) {
      for (const repElem of sourceSchema.repeating_elements) {
        if (repElem.fields) {
          field = repElem.fields.find(f => f.id === fieldId);
          if (field) return field.name || field.tag;
        }
      }
    }
    
    return fieldId;
  }, [constants, sourceSchema]);

  const getTargetFieldName = useCallback((fieldId) => {
    if (!targetSchema) return '';
    
    // Search in regular fields
    let field = targetSchema.fields.find(f => f.id === fieldId);
    if (field) return field.name;
    
    // Search in repeating elements child fields
    if (targetSchema.repeating_elements) {
      for (const repElem of targetSchema.repeating_elements) {
        if (repElem.fields) {
          field = repElem.fields.find(f => f.id === fieldId);
          if (field) return field.name || field.tag;
        }
      }
    }
    
    return fieldId;
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
    const currentTransforms = mapping.transforms || (mapping.transform && mapping.transform !== 'none' ? [mapping.transform] : []);
    
    if (currentTransforms.includes('concat') && fieldNames.length > 1) {
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
      const sampleData = [];
      const numRows = 2;
      
      for (let i = 0; i < numRows; i++) {
        const row = {};
        sourceSchema.fields.forEach(field => {
          const fieldName = field.name.toLowerCase();
          if (fieldName.includes('name') || fieldName.includes('namn')) {
            row[field.name] = i === 0 ? 'Anna' : 'Erik';
          } else if (fieldName.includes('family') || fieldName.includes('efternamn')) {
            row[field.name] = i === 0 ? 'Andersson' : 'Eriksson';
          } else if (fieldName.includes('email')) {
            row[field.name] = i === 0 ? 'anna@example.com' : 'erik@example.com';
          } else {
            row[field.name] = `Exempel${i + 1}`;
          }
        });
        sampleData.push(row);
      }

      const transformed = sampleData.map(row => {
        const result = {};
        mappings.filter(m => !m.is_container).forEach(mapping => {
          const targetField = targetSchema.fields.find(f => f.id === mapping.target);
          if (!targetField) return;

          let value = mapping.source.map(srcId => {
            const constant = constants.find(c => c.id === srcId);
            if (constant) return constant.value;
            
            const srcField = sourceSchema.fields.find(f => f.id === srcId);
            return srcField ? (row[srcField.name] || '') : '';
          });

          const transforms = mapping.transforms || (mapping.transform && mapping.transform !== 'none' ? [mapping.transform] : []);
          
          if (transforms.includes('concat') && value.length > 1) {
            value = [value.join(mapping.params?.separator || ' ')];
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
        version: '2.0',
        timestamp: new Date().toISOString(),
        sourceSchema: {
          name: sourceSchema.name,
          type: sourceSchema.type,
          fields: sourceSchema.fields,
          repeating_elements: sourceSchema.repeating_elements || []
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
          transforms: m.transforms,
          params: m.params,
          aggregation: m.aggregation,
          loop_element_path: m.loop_element_path,
          target_wrapper_path: m.target_wrapper_path,
          is_relative_path: m.is_relative_path,
          is_container: m.is_container,
          child_mappings: m.child_mappings,
          parent_repeat_container: m.parent_repeat_container
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
      
      addLog('info', 'Configuration v2.0 saved with repeating elements');
      showNotification('Konfiguration v2.0 sparad');
    } catch (error) {
      addLog('error', 'Failed to save configuration', { error: error.message });
      showNotification('Kunde inte spara konfiguration', 'error');
    }
  }, [sourceSchema, targetSchema, mappings, constants, folderNaming, folderNamingFields, sourcePath, targetPath, addLog, showNotification]);

  const loadMappingConfig = useCallback(async (file) => {
    try {
      const text = await file.text();
      const config = JSON.parse(text);
      
      if (!config.version) {
        throw new Error('Invalid configuration file');
      }
      
      if (config.sourceSchema && typeof config.sourceSchema === 'object' && config.sourceSchema.fields) {
        setSourceSchema(config.sourceSchema);
        addLog('info', `Loaded source schema: ${config.sourceSchema.name}`);
      }
      
      if (config.targetSchema && typeof config.targetSchema === 'object' && config.targetSchema.fields) {
        setTargetSchema(config.targetSchema);
        addLog('info', `Loaded target schema: ${config.targetSchema.name}`);
      }
      
      if (config.constants && Array.isArray(config.constants)) {
        setConstants(config.constants);
        addLog('info', `Loaded ${config.constants.length} constants`);
      }
      
      if (config.mappings && Array.isArray(config.mappings)) {
        setMappings(config.mappings);
        addLog('info', `Loaded ${config.mappings.length} mappings`);
      }
      
      if (config.folderNaming) {
        setFolderNaming(config.folderNaming);
      }
      if (config.folderNamingFields) {
        setFolderNamingFields(config.folderNamingFields);
      }
      if (config.sourcePath) {
        setSourcePath(config.sourcePath);
      }
      if (config.targetPath) {
        setTargetPath(config.targetPath);
      }
      
      showNotification(`Konfiguration v${config.version} laddad`);
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
      e.target.value = '';
    }
  }, [loadMappingConfig]);

  const executeBatchMapping = useCallback(async () => {
    if (!validatePath(sourcePath) || !validatePath(targetPath)) {
      addLog('error', 'Invalid paths');
      showNotification('Ogiltiga sökvägar', 'error');
      return;
    }

    if (!sourceSchema || !targetSchema || mappings.length === 0) {
      addLog('error', 'Missing schema or mappings');
      showNotification('Komplettera schema och mappningar först', 'error');
      return;
    }

    setProcessing(true);
    addLog('info', 'Starting batch process');
    
    let timeoutId;
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

      abortControllerRef.current = new AbortController();
      timeoutId = setTimeout(() => {
        abortControllerRef.current.abort();
      }, FETCH_TIMEOUT);

      const response = await fetch(`${API_BASE_URL}/api/batch-process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: abortControllerRef.current.signal
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(responseText || 'Batch process failed');
      }

      const result = JSON.parse(responseText);
      addLog('success', 'Batch completed', result);
      showNotification(`Klart! ${result.processed_files} filer, ${result.processed_records} poster`);
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      addLog('error', 'Batch error', { message: error.message });
      showNotification('Fel: ' + error.message, 'error');
    } finally {
      setProcessing(false);
      abortControllerRef.current = null;
    }
  }, [sourcePath, targetPath, sourceSchema, targetSchema, mappings, folderNaming, folderNamingFields, constants, addLog, showNotification]);

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
          className={`absolute top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 ${
            notification.type === 'error' ? 'bg-red-600' : 'bg-green-600'
          }`}
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
          <h1 className="text-xl font-bold">Schmapper v2.1</h1>
          {sourceSchema?.repeating_elements && sourceSchema.repeating_elements.length > 0 && (
            <span className="text-xs bg-pink-600 px-2 py-1 rounded flex items-center gap-1">
              <Repeat className="w-3 h-3" />
              {sourceSchema.repeating_elements.length} upprepande element
            </span>
          )}
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
            <label className="text-xs text-slate-400 mb-1 block">Källmapp</label>
            <input
              type="text"
              value={sourcePath}
              onChange={(e) => setSourcePath(e.target.value)}
              placeholder="C:\\temp\\Schmapper_test\\IN"
              className="w-full bg-slate-700 px-3 py-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={processing}
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Målmapp</label>
            <input
              type="text"
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
              placeholder="C:\\temp\\Schmapper_test\\UT"
              className="w-full bg-slate-700 px-3 py-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={processing}
            />
          </div>
          {sourceSchema && (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Mappstruktur</label>
              <button
                onClick={() => setShowFolderSettings(!showFolderSettings)}
                className="w-full bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded text-sm text-left flex items-center justify-between transition"
                disabled={processing}
              >
                <span>{folderNaming === 'guid' ? '🎲 GUID' : `📋 Fältbaserad`}</span>
                <span className="text-slate-400">{showFolderSettings ? '▲' : '▼'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Source Panel */}
        <div className="w-1/3 bg-slate-800 border-r border-slate-700 flex flex-col">
          <div className="p-4 border-b border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-lg text-blue-400">Källschema</h2>
              <label className="cursor-pointer px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm flex items-center gap-1 transition">
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
              <p className="text-sm text-slate-400">{sourceSchema.name}</p>
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
                {/* Constants */}
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
                
                <button
                  onClick={() => setShowConstantModal(true)}
                  className="w-full mb-4 p-3 border-2 border-dashed border-purple-500 rounded hover:bg-purple-900 hover:bg-opacity-20 transition flex items-center justify-center gap-2 text-purple-400 disabled:opacity-50"
                  disabled={processing}
                >
                  <Plus className="w-4 h-4" />
                  Nytt fast värde
                </button>
                
                {/* Repeating Elements Section */}
                {sourceSchema.repeating_elements && sourceSchema.repeating_elements.length > 0 && (
                  <div className="mb-4">
                    <div className="text-xs font-semibold text-pink-400 mb-2 flex items-center gap-2">
                      <Repeat className="w-4 h-4" />
                      Upprepande element ({sourceSchema.repeating_elements.length})
                    </div>
                    {sourceSchema.repeating_elements.map((repeatingElem, idx) => {
                      const container = getRepeatingContainerForElement(repeatingElem.path);
                      const isExpanded = expandedRepeatingElements[repeatingElem.path];
                      
                      console.log('[REPEATING ELEM]', repeatingElem.tag, 'container:', container?.id, 'isExpanded:', isExpanded);
                      
                      return (
                        <div key={`repeat-${idx}`} className="mb-2">
                          <div
                            draggable={!processing}
                            onDragStart={(e) => handleDragStart(e, { repeatingElement: repeatingElem }, 'repeating-source')}
                            className={`bg-slate-700 hover:bg-slate-600 p-3 rounded cursor-move transition group ${
                              container ? 'border-l-4 border-pink-500' : ''
                            }`}
                          >
                            <div className="flex items-center mb-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedRepeatingElements(prev => ({
                                    ...prev,
                                    [repeatingElem.path]: !prev[repeatingElem.path]
                                  }));
                                }}
                                className="text-pink-400 hover:text-pink-300 transition mr-2 flex-shrink-0"
                                title="Visa/dölj barn-element"
                              >
                                {isExpanded ? '▼' : '▶'}
                              </button>
                              <Repeat className="w-4 h-4 text-pink-400 flex-shrink-0 mr-2" title="Upprepande element" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm text-blue-300 mb-1 truncate flex items-center gap-2" title={repeatingElem.tag}>
                                  {repeatingElem.tag}
                                  <span className="text-xs bg-pink-600 px-2 py-0.5 rounded">{repeatingElem.count}x</span>
                                </div>
                                <div className="text-xs text-slate-400 font-mono bg-slate-800 px-2 py-1 rounded inline-block break-all">
                                  {repeatingElem.path}
                                </div>
                              </div>
                            </div>
                            {container && (
                              <div className="text-xs text-pink-400 flex items-center gap-1 ml-10">
                                <span>✓</span> Mappad till {container.target_wrapper_path?.split('/').pop()}
                              </div>
                            )}
                          </div>
                          
                          {/* Child fields */}
                          {isExpanded && repeatingElem.fields && (
                            <div className="ml-6 mt-2 space-y-1 border-l-2 border-pink-500 pl-3">
                              {repeatingElem.fields.map((childField, childIdx) => {
                                const childFieldObj = {
                                  id: childField.id,
                                  name: childField.name || childField.tag,
                                  path: childField.path,
                                  type: childField.type || 'string',
                                  parentRepeating: repeatingElem.path
                                };
                                const isChildMapped = getAllMappedSourceIds.has(childField.id);
                                // NEW: Always draggable (for repeat-to-single support)
                                const isDraggable = !processing;
                                
                                console.log('[CHILD FIELD]', childFieldObj.name, 'container:', !!container, 'draggable:', isDraggable);
                                
                                return (
                                  <div
                                    key={childIdx}
                                    draggable={isDraggable}
                                    onDragStart={(e) => isDraggable && handleDragStart(e, childFieldObj, 'source')}
                                    className={`bg-slate-700 hover:bg-slate-600 p-2 rounded text-xs transition ${
                                      isDraggable ? 'cursor-move' : 'opacity-50 cursor-not-allowed'
                                    } ${isChildMapped ? 'border-l-2 border-green-500' : ''}`}
                                    title={isDraggable ? 'Dra för att mappa (skapar container automatiskt)' : 'Processing...'}
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex-1 min-w-0">
                                        <div className="text-blue-200 truncate">{childFieldObj.name}</div>
                                        <div className="text-slate-500 font-mono truncate">{childField.relative_path || childField.path}</div>
                                      </div>
                                      <span className="text-slate-500 ml-2">{childFieldObj.type}</span>
                                    </div>
                                    {isChildMapped && (
                                      <div className="text-green-400 mt-1">✓ Mappad</div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                
                {/* Regular Fields Section */}
                <div className="text-xs font-semibold text-blue-400 mb-2">Källfält</div>
                {sourceSchema.fields.map(field => {
                  const isMapped = getAllMappedSourceIds.has(field.id);
                  const displayName = field.name;
                  const fullPath = field.path || field.name;
                  
                  // Skip if this field is part of any repeating element
                  const isPartOfRepeating = sourceSchema.repeating_elements?.some(r => 
                    fullPath.startsWith(r.path)
                  );
                  
                  if (isPartOfRepeating) {
                    return null; // Already shown in repeating elements section
                  }
                  
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
                {/* Regular mappings (non-container, non-child) */}
                {mappings.filter(m => !m.is_container && !m.parent_repeat_container).map(mapping => {
                  const currentTransforms = mapping.transforms || (mapping.transform && mapping.transform !== 'none' ? [mapping.transform] : []);
                  
                  return (
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
                        {transforms.map(t => {
                          const isActive = currentTransforms.includes(t.id);
                          
                          return (
                            <button
                              key={t.id}
                              onClick={() => handleTransformChange(mapping.id, t.id)}
                              className={`px-3 py-1 rounded text-xs transition disabled:opacity-50 ${
                                isActive
                                  ? 'bg-purple-600 text-white'
                                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                              }`}
                              disabled={processing}
                            >
                              <span className="mr-1">{t.icon}</span>
                              {t.name}
                            </button>
                          );
                        })}
                      </div>

                      {/* Transform parameters */}
                      {currentTransforms.includes('concat') && mapping.source.length > 1 && (
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

                      {currentTransforms.includes('replace') && (
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

                      {currentTransforms.includes('regex') && (
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
                          </div>
                        </div>
                      )}

                      {currentTransforms.includes('format') && (
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
                          </div>
                        </div>
                      )}

                      {currentTransforms.includes('default') && (
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
                          <div className="flex items-center gap-4">
                            <label className="text-xs text-slate-400">Aggregering:</label>
                            <div className="flex gap-2">
                              {aggregationModes.map(mode => (
                                <button
                                  key={mode.id}
                                  onClick={() => handleAggregationChange(mapping.id, mode.id)}
                                  className={`px-3 py-1 rounded text-xs transition ${
                                    (mapping.aggregation || 'foreach') === mode.id
                                      ? 'bg-orange-600 text-white'
                                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                  }`}
                                  disabled={processing}
                                  title={mode.description}
                                >
                                  {mode.name}
                                </button>
                              ))}
                            </div>
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
                  );
                })}
                
                {/* Repeating Containers */}
                {mappings.filter(m => m.is_container).map(container => {
                  const childMappings = mappings.filter(m => m.parent_repeat_container === container.id);
                  const sourceElemName = container.loop_element_path?.split('/').pop() || 'Element';
                  const targetElemName = container.target_wrapper_path?.split('/').pop() || 
                    (container.repeat_to_single ? '(Flera fält)' : 'Element');
                  const isRepeatToSingle = container.repeat_to_single;
                  
                  return (
                    <div
                      key={container.id}
                      className="bg-pink-900 bg-opacity-20 border-2 border-pink-500 rounded-lg p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Repeat className="w-5 h-5 text-pink-400" />
                          <div>
                            <div className="font-medium text-pink-300 flex items-center gap-2">
                              {sourceElemName} → {targetElemName}
                              {isRepeatToSingle && (
                                <span className="text-xs bg-pink-700 px-2 py-0.5 rounded">
                                  Repeat-to-Single
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-pink-400 mt-1">
                              {container.loop_element_path} → {container.target_wrapper_path || '(flera upprepade fält)'}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteMapping(container.id)}
                          className="text-pink-400 hover:text-red-400"
                          disabled={processing}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <div className="ml-4 space-y-3 border-l-2 border-pink-500 pl-4">
                        {childMappings.map(mapping => {
                          const currentTransforms = mapping.transforms || [];
                          const isSelected = selectedMapping === mapping.id;
                          
                          return (
                            <div 
                              key={mapping.id} 
                              className={`bg-slate-700 rounded p-3 transition ${
                                isSelected ? 'ring-2 ring-purple-400' : ''
                              }`}
                              onClick={() => setSelectedMapping(mapping.id)}
                            >
                              {/* Source and Target Badges */}
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2 flex-1 flex-wrap">
                                  {mapping.source.map(srcId => {
                                    const constant = constants.find(c => c.id === srcId);
                                    return (
                                      <div 
                                        key={srcId} 
                                        className={`px-2 py-1 rounded text-xs ${
                                          constant ? 'bg-purple-600' : 'bg-blue-600'
                                        }`}
                                      >
                                        {constant ? constant.name : getSourceFieldName(srcId)}
                                      </div>
                                    );
                                  })}
                                  <span className="text-slate-400 text-xs">→</span>
                                  <div className="bg-green-600 px-2 py-1 rounded text-xs">
                                    {getTargetFieldName(mapping.target)}
                                  </div>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteMapping(mapping.id);
                                  }}
                                  className="text-slate-400 hover:text-red-400 ml-2"
                                  disabled={processing}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                              
                              {/* Transform Buttons */}
                              <div className="flex flex-wrap gap-1 mb-2">
                                {transforms.map(transform => (
                                  <button
                                    key={transform.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const newTransforms = currentTransforms.includes(transform.id)
                                        ? currentTransforms.filter(t => t !== transform.id)
                                        : [...currentTransforms, transform.id];
                                      handleUpdateMappingTransforms(mapping.id, newTransforms);
                                    }}
                                    className={`px-2 py-1 text-xs rounded transition ${
                                      currentTransforms.includes(transform.id)
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                                    }`}
                                    disabled={processing}
                                  >
                                    {transform.name}
                                  </button>
                                ))}
                              </div>
                              
                              {/* Transform Parameters */}
                              {currentTransforms.includes('concat') && (
                                <input
                                  type="text"
                                  placeholder="Separator (default: mellanslag)"
                                  value={mapping.params?.separator || ' '}
                                  onChange={(e) => handleUpdateMappingParams(mapping.id, { separator: e.target.value })}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-xs mb-1"
                                />
                              )}
                              
                              {currentTransforms.includes('replace') && (
                                <div className="space-y-1 mb-1">
                                  <input
                                    type="text"
                                    placeholder="Från (text att ersätta)"
                                    value={mapping.params?.from_ || ''}
                                    onChange={(e) => handleUpdateMappingParams(mapping.id, { from_: e.target.value })}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-xs"
                                  />
                                  <input
                                    type="text"
                                    placeholder="Till (ny text)"
                                    value={mapping.params?.to || ''}
                                    onChange={(e) => handleUpdateMappingParams(mapping.id, { to: e.target.value })}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-xs"
                                  />
                                </div>
                              )}
                              
                              {currentTransforms.includes('regex') && (
                                <div className="space-y-1 mb-1">
                                  <input
                                    type="text"
                                    placeholder="Pattern (t.ex. ^(\d{8})(\d{4})$)"
                                    value={mapping.params?.pattern || ''}
                                    onChange={(e) => handleUpdateMappingParams(mapping.id, { pattern: e.target.value })}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-xs font-mono"
                                  />
                                  <input
                                    type="text"
                                    placeholder="Replacement (t.ex. $1-$2)"
                                    value={mapping.params?.replacement || ''}
                                    onChange={(e) => handleUpdateMappingParams(mapping.id, { replacement: e.target.value })}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-xs font-mono"
                                  />
                                </div>
                              )}
                              
                              {currentTransforms.includes('format') && (
                                <div className="space-y-1 mb-1">
                                  <input
                                    type="text"
                                    placeholder="Format-sträng (t.ex. {0}-{1}-{2})"
                                    value={mapping.params?.format || ''}
                                    onChange={(e) => handleUpdateMappingParams(mapping.id, { format: e.target.value })}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-xs"
                                  />
                                  <input
                                    type="text"
                                    placeholder="Dela vid positioner (t.ex. 4,6)"
                                    value={mapping.params?.split_at || ''}
                                    onChange={(e) => handleUpdateMappingParams(mapping.id, { split_at: e.target.value })}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-xs"
                                  />
                                </div>
                              )}
                              
                              {currentTransforms.includes('default') && (
                                <input
                                  type="text"
                                  placeholder="Standardvärde"
                                  value={mapping.params?.defaultValue || ''}
                                  onChange={(e) => handleUpdateMappingParams(mapping.id, { defaultValue: e.target.value })}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-xs mb-1"
                                />
                              )}
                            </div>
                          );
                        })}
                        {childMappings.length === 0 && (
                          <div className="text-slate-500 text-sm italic">
                            Inga fältmappningar - dra fält från {sourceElemName}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Target Panel */}
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
              <>
                {/* Repeating Elements Section */}
                {targetSchema.repeating_elements && targetSchema.repeating_elements.length > 0 && (
                  <div className="mb-4">
                    <div className="text-xs font-semibold text-pink-400 mb-2 flex items-center gap-2">
                      <Repeat className="w-4 h-4" />
                      Upprepande element ({targetSchema.repeating_elements.length})
                    </div>
                    {targetSchema.repeating_elements.map((repElem, idx) => {
                      const isExpanded = expandedRepeatingElements[`target-${repElem.path}`];
                      const container = mappings.find(m => 
                        m.is_container && m.target_wrapper_path === repElem.wrapper_path
                      );
                      
                      return (
                        <div key={`target-rep-${idx}`} className="mb-2">
                          <div
                            onDragOver={!processing ? handleDragOver : undefined}
                            onDrop={!processing ? (e) => {
                              e.preventDefault();
                              if (draggedField && draggedField.repeatingElement) {
                                const sourceRep = draggedField.repeatingElement;
                                const newContainer = {
                                  id: `container-${Date.now()}`,
                                  source: [],
                                  target: repElem.id || `tgt-rep-${idx}`,
                                  aggregation: 'repeat',
                                  loop_element_path: sourceRep.path,
                                  target_wrapper_path: repElem.wrapper_path || repElem.path,
                                  is_container: true,
                                  transforms: [],
                                  params: {}
                                };
                                setMappings(prev => [...prev, newContainer]);
                              }
                            } : undefined}
                            className={`bg-slate-700 hover:bg-slate-600 p-3 rounded transition cursor-pointer ${
                              container ? 'border-l-4 border-pink-500' : ''
                            }`}
                          >
                            <div className="flex items-center mb-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedRepeatingElements(prev => ({
                                    ...prev,
                                    [`target-${repElem.path}`]: !prev[`target-${repElem.path}`]
                                  }));
                                }}
                                className="text-pink-400 hover:text-pink-300 transition mr-2 flex-shrink-0"
                                title="Visa/dölj barn-element"
                              >
                                {isExpanded ? '▼' : '▶'}
                              </button>
                              <Repeat className="w-4 h-4 text-pink-400 flex-shrink-0 mr-2" title="Upprepande element" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm text-green-300 mb-1 truncate flex items-center gap-2" title={repElem.name}>
                                  {repElem.name}
                                  <span className="text-xs bg-pink-600 px-2 py-0.5 rounded">{repElem.maxOccurs || repElem.count || 'unbounded'}</span>
                                </div>
                                <div className="text-xs text-slate-400 font-mono bg-slate-800 px-2 py-1 rounded inline-block break-all">
                                  {repElem.path}
                                </div>
                              </div>
                            </div>
                            {container && (
                              <div className="text-xs text-pink-400 flex items-center gap-1 ml-10">
                                <span>✓</span> Mappad från {container.loop_element_path?.split('/').pop()}
                              </div>
                            )}
                          </div>
                          
                          {/* Child Fields */}
                          {isExpanded && repElem.fields && repElem.fields.length > 0 && (
                            <div className="ml-6 mt-2 space-y-1 border-l-2 border-pink-500 pl-3">
                              {repElem.fields.map((childField, cidx) => {
                                const childFieldObj = {
                                  id: childField.id || `tgt-child-${idx}-${cidx}`,
                                  name: childField.name,
                                  path: childField.path,
                                  type: childField.type || 'string',
                                  parentRepeating: repElem.path
                                };
                                const fieldMappings = getMappingsForTarget(childFieldObj.id);
                                
                                return (
                                  <div
                                    key={cidx}
                                    onDragOver={!processing ? handleDragOver : undefined}
                                    onDrop={!processing ? (e) => handleDrop(e, childFieldObj) : undefined}
                                    className={`bg-slate-700 hover:bg-slate-600 p-2 rounded text-xs transition cursor-pointer ${
                                      fieldMappings.length > 0 ? 'border-l-2 border-green-500' : ''
                                    }`}
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex-1 min-w-0">
                                        <div className="text-green-200 truncate">{childFieldObj.name}</div>
                                        <div className="text-slate-500 font-mono truncate">{childField.relative_path || childField.path}</div>
                                      </div>
                                      <span className="text-slate-500 ml-2">{childFieldObj.type}</span>
                                    </div>
                                    {fieldMappings.length > 0 && (
                                      <div className="text-green-400 mt-1">✓ Mappad</div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                
                {/* Regular Fields */}
                {targetSchema.fields.map(field => {
                const fieldMappings = getMappingsForTarget(field.id);
                const isHovered = hoveredTarget === field.id;
                const fullPath = field.path || field.name;
                
                // Skip if this field is part of any repeating element
                const isPartOfRepeating = targetSchema.repeating_elements?.some(r => 
                  fullPath.startsWith(r.path + '/') || fullPath === r.path
                );
                
                if (isPartOfRepeating) {
                  return null; // Already shown in repeating elements section
                }
                
                // NEW: Check if field is repeatable
                const isRepeatable = field.repeatable || field.maxOccurs === 'unbounded' || 
                  (field.maxOccurs && parseInt(field.maxOccurs) > 1);
                
                // Check if this is a potential repeating target
                const isPotentialRepeating = sourceSchema?.repeating_elements?.some(r => 
                  r.tag.toLowerCase() === field.name.toLowerCase() || 
                  r.path.split('/').pop().toLowerCase() === field.name.toLowerCase()
                );
                
                // Check if this target is part of an existing repeating container
                const isInRepeatingContainer = mappings.some(m => 
                  m.is_container && m.target_wrapper_path && fullPath.startsWith(m.target_wrapper_path)
                );
                
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
                    } ${
                      isInRepeatingContainer ? 'border-l-4 border-pink-500' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {isPotentialRepeating && (
                          <Repeat className="w-4 h-4 text-pink-400 flex-shrink-0" title="Kan vara upprepande wrapper" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-green-300 mb-1 truncate flex items-center gap-2" title={field.name}>
                            {field.name}
                            {isRepeatable && (
                              <span className="text-xs bg-pink-600 px-2 py-0.5 rounded" title={`maxOccurs: ${field.maxOccurs || 'unbounded'}`}>
                                Upprepningsbar
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 font-mono bg-slate-800 px-2 py-1 rounded inline-block break-all">
                            {fullPath}
                          </div>
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
                    {isInRepeatingContainer && !fieldMappings.length && (
                      <div className="mt-2 pt-2 border-t border-pink-600 text-xs text-pink-400">
                        Del av upprepande struktur
                      </div>
                    )}
                  </div>
                );
              })}
              </>
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
            className="bg-slate-800 rounded-lg w-96 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Nytt fast värde</h3>
              <button
                onClick={() => setShowConstantModal(false)}
                className="text-slate-400 hover:text-white"
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
                  placeholder="Standard_Land"
                  className="w-full bg-slate-700 px-3 py-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-sm text-slate-300 block mb-1">Värde</label>
                <input
                  type="text"
                  value={constantValue}
                  onChange={(e) => setConstantValue(e.target.value)}
                  placeholder="Sverige"
                  className="w-full bg-slate-700 px-3 py-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  onKeyPress={(e) => e.key === 'Enter' && createConstant()}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowConstantModal(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm"
                >
                  Avbryt
                </button>
                <button
                  onClick={createConstant}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded text-sm"
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
            className="bg-slate-800 rounded-lg w-4/5 h-4/5 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Preview</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-semibold text-blue-400 mb-2">Källa</h4>
                <pre className="bg-slate-900 p-3 rounded text-xs overflow-auto">
                  {JSON.stringify(previewData.source, null, 2)}
                </pre>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-green-400 mb-2">Resultat</h4>
                <pre className="bg-slate-900 p-3 rounded text-xs overflow-auto">
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
            className="bg-slate-800 rounded-lg w-4/5 h-4/5 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Loggar</h3>
              <div className="flex gap-2">
                <button
                  onClick={downloadLogs}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm flex items-center gap-1"
                >
                  <Download className="w-4 h-4" />
                  Ladda ner
                </button>
                <button
                  onClick={clearLogs}
                  className="px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-sm flex items-center gap-1"
                >
                  <Trash2 className="w-4 h-4" />
                  Rensa
                </button>
                <button
                  onClick={() => setShowLogs(false)}
                  className="text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {logs.length === 0 ? (
                <div className="text-center text-slate-500 mt-8">Inga loggar</div>
              ) : (
                <div className="space-y-2">
                  {logs.map((log) => (
                    <div 
                      key={log.id}
                      className={`p-3 rounded text-xs ${
                        log.level === 'error' ? 'bg-red-900 bg-opacity-30' :
                        log.level === 'success' ? 'bg-green-900 bg-opacity-30' :
                        log.level === 'warn' ? 'bg-yellow-900 bg-opacity-30' :
                        'bg-slate-700'
                      }`}
                    >
                      <div className="flex justify-between mb-1">
                        <span className="font-semibold">[{log.level.toUpperCase()}]</span>
                        <span className="text-slate-500">{new Date(log.timestamp).toLocaleString('sv-SE')}</span>
                      </div>
                      <div>{log.message}</div>
                      {log.data && (
                        <pre className="mt-2 text-slate-400 overflow-auto max-h-40">
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
    </div>
  );
};

export default SchemaMapper;