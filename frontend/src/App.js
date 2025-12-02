import React, { useState, useCallback, useMemo, useRef } from 'react';
import { Download, Upload, Play, Trash2, Plus, Database, Save, FileText, AlertCircle, Repeat, Moon, Sun, Settings, Edit, ArrowRight } from 'lucide-react';

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
  const [editingConstantId, setEditingConstantId] = useState(null);
  const [constants, setConstants] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState({});
  const [lightMode, setLightMode] = useState(false);
  const [showTransformModal, setShowTransformModal] = useState(false);
  const [currentMappingForTransform, setCurrentMappingForTransform] = useState(null);
  const [editingTransform, setEditingTransform] = useState(null);
  const [transformParams, setTransformParams] = useState({});
  const [editingInstanceId, setEditingInstanceId] = useState(null);

  // Condition Editor States
  const [showConditionModal, setShowConditionModal] = useState(false);
  const [currentMappingForCondition, setCurrentMappingForCondition] = useState(null);
  const [editingConditions, setEditingConditions] = useState([]);

  // Refs
  const notificationTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);
  const hoverThrottleRef = useRef(null);
  const lastHoveredRef = useRef(null);

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

    if (process.env.NODE_ENV === 'development') {
      console.log(`[${level.toUpperCase()}] ${message}`, data || '');
    }
  }, []);

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

  // Throttled hover handling for better drag-and-drop performance with large schemas
  const setHoveredTargetThrottled = useCallback((id) => {
    // Skip if same as last hovered (avoid unnecessary updates)
    if (lastHoveredRef.current === id) return;

    lastHoveredRef.current = id;

    // Clear existing throttle timer
    if (hoverThrottleRef.current) {
      clearTimeout(hoverThrottleRef.current);
    }

    // Throttle to max once per 50ms (20 updates/sec)
    hoverThrottleRef.current = setTimeout(() => {
      setHoveredTarget(id);
      hoverThrottleRef.current = null;
    }, 50);
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
  }, [logs, addLog, showNotification]);

  const clearLogs = useCallback(() => {
    setLogs([]);
    showNotification('Loggar rensade');
  }, [showNotification]);

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

  const createConstant = useCallback(() => {
    const sanitizedName = sanitizeInput(constantName.trim());
    const sanitizedValue = sanitizeInput(constantValue.trim());

    if (!sanitizedName || !sanitizedValue) {
      showNotification('Ange både namn och värde', 'error');
      return;
    }

    // If editing, check for duplicate names excluding the current constant
    if (constants.some(c => c.name === sanitizedName && c.id !== editingConstantId)) {
      showNotification('Ett värde med detta namn finns redan', 'error');
      return;
    }

    if (editingConstantId) {
      // Update existing constant
      setConstants(prev => prev.map(c =>
        c.id === editingConstantId
          ? { ...c, name: sanitizedName, value: sanitizedValue }
          : c
      ));
      addLog('info', `Constant updated: ${sanitizedName}`);
      showNotification(`Konstant "${sanitizedName}" uppdaterad`);
    } else {
      // Create new constant
      const newConstant = {
        id: `const-${Date.now()}-${Math.random()}`,
        name: sanitizedName,
        value: sanitizedValue,
        type: 'constant'
      };

      setConstants(prev => [...prev, newConstant]);
      addLog('info', `Constant created: ${sanitizedName}`);
      showNotification(`Konstant "${sanitizedName}" skapad`);
    }

    setConstantName('');
    setConstantValue('');
    setEditingConstantId(null);
    setShowConstantModal(false);
  }, [constantName, constantValue, constants, editingConstantId, showNotification, addLog]);

  const deleteConstant = useCallback((constId) => {
    setConstants(prev => prev.filter(c => c.id !== constId));
    setMappings(prev => prev.map(m => ({
      ...m,
      source: m.source.filter(s => s !== constId)
    })).filter(m => m.source.length > 0));
    addLog('info', `Constant deleted: ${constId}`);
    showNotification('Konstant borttagen');
  }, [addLog, showNotification]);

  // Helper to get repeating container mapping
  const getRepeatingContainerForElement = useCallback((elemPath) => {
    return mappings.find(m =>
      m.is_container &&
      m.loop_element_path === elemPath
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
        // Always use XSD parser for XSD files (both source and target)
        endpoint = '/api/parse-xsd-schema';
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
        // Don't reset folder naming settings when uploading new schema
        // setFolderNaming('guid');
        // setFolderNamingFields([]);
        setShowFolderSettings(false);

        // Expand all nodes by default
        const expandedKeys = getAllNodeKeys(schema, 'source');
        setExpandedNodes(expandedKeys);

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
  }, [loadSchema, showNotification, addLog]); // eslint-disable-line react-hooks/exhaustive-deps

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
        // Don't reset folder naming settings when uploading new schema
        // setFolderNaming('guid');
        // setFolderNamingFields([]);
        setShowFolderSettings(false);

        // Expand all nodes by default
        setExpandedNodes(prev => ({
          ...prev,
          ...getAllNodeKeys(schema, 'target')
        }));

        addLog('info', 'New target schema loaded - all mappings cleared');
        showNotification(`Målschema laddat: ${file.name}`);
      }
    } finally {
      setIsLoading(false);
      e.target.value = '';
    }
  }, [loadSchema, showNotification, addLog]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragStart = useCallback((e, field, type) => {
    e.dataTransfer.effectAllowed = 'copy';
    setDraggedField({ ...field, type });

    // Hide the default ghost/drag image
    const dragImage = document.createElement('div');
    dragImage.style.opacity = '0';
    dragImage.style.position = 'absolute';
    dragImage.style.top = '-1000px';
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 0, 0);

    // Clean up after drag
    setTimeout(() => document.body.removeChild(dragImage), 0);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e, targetField) => {
    e.preventDefault();
    e.stopPropagation();
    
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
      setExpandedNodes(prev => ({
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
      const parentRepeating = draggedField.parentRepeatingPath || draggedField.parentRepeating;
      const repContainer = parentRepeating ? getRepeatingContainerForElement(parentRepeating) : null;

      // Check if target is a repeatable field (for repeat-to-single)
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
        }
      }

      // If source is from repeating element AND target is repeatable field, create/use repeat-to-single container
      if (parentRepeating && isTargetRepeatable && !repContainer) {
        // Need to create a repeat-to-single container first
        const sourceRepElem = sourceSchema?.repeating_elements?.find(r => r.path === parentRepeating);

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
          setExpandedNodes(prev => ({
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
  }, [draggedField, mappings, sourceSchema, targetSchema, getRepeatingContainerForElement, addLog, showNotification]);

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

  // Helper to normalize transforms to instance format
  const normalizeTransforms = useCallback((transforms) => {
    if (!transforms) return [];
    return transforms.map(t => {
      if (typeof t === 'string') {
        return { id: `${t}-${Date.now()}-${Math.random()}`, type: t };
      }
      return t;
    });
  }, []);

  // Helper to get transform instances for a mapping
  const getTransformInstances = useCallback((mapping) => {
    if (!mapping) return [];
    let transforms = mapping.transforms || (mapping.transform && mapping.transform !== 'none' ? [mapping.transform] : []);
    return normalizeTransforms(transforms);
  }, [normalizeTransforms]);

  // Add or update a transform instance
  const saveTransformInstance = useCallback((mappingId, transformType, params = {}) => {
    setMappings(prev => prev.map(m => {
      if (m.id !== mappingId) return m;

      const instances = getTransformInstances(m);
      const newInstance = {
        id: `${transformType}-${Date.now()}-${Math.random()}`,
        type: transformType,
        params: Object.keys(params).length > 0 ? params : undefined
      };

      return { ...m, transforms: [...instances, newInstance] };
    }));
  }, [getTransformInstances]);

  // Remove a transform instance
  const removeTransformInstance = useCallback((mappingId, instanceId) => {
    setMappings(prev => prev.map(m => {
      if (m.id !== mappingId) return m;

      const instances = getTransformInstances(m);
      const newInstances = instances.filter(inst => inst.id !== instanceId);

      return { ...m, transforms: newInstances };
    }));
  }, [getTransformInstances]);

  // Update a transform instance's parameters
  const updateTransformInstance = useCallback((mappingId, instanceId, params) => {
    setMappings(prev => prev.map(m => {
      if (m.id !== mappingId) return m;

      const instances = getTransformInstances(m);
      const newInstances = instances.map(inst =>
        inst.id === instanceId ? { ...inst, params } : inst
      );

      return { ...m, transforms: newInstances };
    }));
  }, [getTransformInstances]);

  // Save conditions to a mapping
  const saveConditions = useCallback((mappingId, conditions) => {
    setMappings(prev => prev.map(m => {
      if (m.id !== mappingId) return m;
      return { ...m, conditions: conditions && conditions.length > 0 ? conditions : null };
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

  // Build hierarchical tree structure from flat fields
  const buildFieldTree = useCallback((schema) => {
    if (!schema || !schema.fields) return [];

    const tree = [];
    const pathMap = new Map(); // Map of path -> tree node

    // Combine all fields including those in repeating elements
    // Use Map to deduplicate by path
    const fieldMap = new Map();

    // First, add all regular fields
    schema.fields.forEach(field => {
      const path = field.path || field.name;
      if (path) {
        fieldMap.set(path, { ...field });
      }
    });

    // Then, update fields that are in repeating elements with parent info
    if (schema.repeating_elements) {
      schema.repeating_elements.forEach(repElem => {
        if (repElem.fields) {
          repElem.fields.forEach(field => {
            const path = field.path || field.name;
            if (path) {
              // Update existing field or add new one
              const existingField = fieldMap.get(path);
              fieldMap.set(path, {
                ...(existingField || field),
                parentRepeatingPath: repElem.path,
                isInRepeating: true
              });
            }
          });
        }
      });
    }

    // Convert Map back to array
    const allFields = Array.from(fieldMap.values());

    // Sort fields by their order (XSD sequence) if available, otherwise by path
    allFields.sort((a, b) => {
      // First try to sort by order field from XSD
      if (a.order !== undefined && b.order !== undefined) {
        return a.order - b.order;
      }
      // Fallback to path sorting
      const pathA = a.path || a.name || '';
      const pathB = b.path || b.name || '';
      return pathA.localeCompare(pathB);
    });

    allFields.forEach(field => {
      const fullPath = field.path || field.name;
      if (!fullPath) return;

      const parts = fullPath.split('/').filter(p => p);
      let currentPath = '';
      let parentNode = null;

      // Build parent nodes if they don't exist
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        currentPath += (currentPath ? '/' : '') + part;

        if (!pathMap.has(currentPath)) {
          // Check if this path is a repeating element
          const isRepeating = schema.repeating_elements?.some(r => r.path === currentPath);
          const repeatingInfo = schema.repeating_elements?.find(r => r.path === currentPath);

          const node = {
            id: `parent-${currentPath}`,
            name: part,
            path: currentPath,
            type: 'object',
            isParent: true,
            isRepeating: isRepeating,
            maxOccurs: repeatingInfo?.maxOccurs || repeatingInfo?.count,
            order: repeatingInfo?.order || field.order, // Inherit order from repeating info or current field
            children: []
          };

          if (parentNode) {
            parentNode.children.push(node);
          } else {
            tree.push(node);
          }

          pathMap.set(currentPath, node);
        }

        parentNode = pathMap.get(currentPath);
      }

      // Check if this field itself is repeating
      const isFieldRepeating = schema.repeating_elements?.some(r => r.path === fullPath);
      const repeatingInfo = schema.repeating_elements?.find(r => r.path === fullPath);

      // Add the actual field node
      const fieldNode = {
        ...field,
        isParent: false,
        isRepeating: isFieldRepeating || field.maxOccurs === 'unbounded' || (field.maxOccurs && field.maxOccurs > 1),
        maxOccurs: repeatingInfo?.maxOccurs || repeatingInfo?.count || field.maxOccurs,
        children: []
      };

      if (parentNode) {
        parentNode.children.push(fieldNode);
      } else {
        tree.push(fieldNode);
      }

      pathMap.set(fullPath, fieldNode);
    });

    // Recursively sort children by order
    const sortChildren = (node) => {
      if (node.children && node.children.length > 0) {
        node.children.sort((a, b) => {
          if (a.order !== undefined && b.order !== undefined) {
            return a.order - b.order;
          }
          const nameA = a.name || '';
          const nameB = b.name || '';
          return nameA.localeCompare(nameB);
        });
        node.children.forEach(sortChildren);
      }
    };

    // Sort top-level tree by order
    tree.sort((a, b) => {
      if (a.order !== undefined && b.order !== undefined) {
        return a.order - b.order;
      }
      const nameA = a.name || '';
      const nameB = b.name || '';
      return nameA.localeCompare(nameB);
    });

    // Sort all children recursively
    tree.forEach(sortChildren);

    // After building the tree, add nested repeating elements as children
    // This handles cases where a field like "Handlingar" contains a nested repeating element "Handling"
    if (schema.repeating_elements) {
      schema.repeating_elements.forEach(repElem => {
        const repPath = repElem.path;
        const pathParts = repPath.split('/').filter(p => p);

        if (pathParts.length > 1) {
          // Get parent path (e.g., "ArendeExport/Arenden/Arende/Handlingar" for "ArendeExport/Arenden/Arende/Handlingar/Handling")
          const parentPath = pathParts.slice(0, -1).join('/');
          const parentNode = pathMap.get(parentPath);

          // Check if this repeating element is not already in the tree
          if (parentNode && !pathMap.has(repPath)) {
            // Mark parent as having children so it's expandable
            parentNode.isParent = true;

            // Create node for the nested repeating element
            const repNode = {
              id: `repeating-${repPath}`,
              name: pathParts[pathParts.length - 1],
              path: repPath,
              type: 'object',
              isParent: true,
              isRepeating: true,
              maxOccurs: repElem.maxOccurs || repElem.count,
              children: []
            };

            // Add fields from the repeating element as children
            if (repElem.fields) {
              repElem.fields.forEach(field => {
                repNode.children.push({
                  ...field,
                  isParent: false,
                  parentRepeatingPath: repPath,
                  isInRepeating: true,
                  children: []
                });
              });

              // Sort children by order
              sortChildren(repNode);
            }

            // Add the repeating element node as a child of its parent
            parentNode.children.push(repNode);
            pathMap.set(repPath, repNode);
          }
        }
      });

      // Sort children again after adding nested repeating elements
      tree.forEach(sortChildren);
    }


    // Final pass: Ensure all nodes with children are marked as parents
    const markParents = (node) => {
      if (node.children && node.children.length > 0) {
        node.isParent = true;
        node.children.forEach(markParents);
      }
    };
    tree.forEach(markParents);

    return tree;
  }, []);

  // Memoize source and target trees to prevent rebuilding on every render (PERFORMANCE OPTIMIZATION for large schemas like FHIR)
  const sourceTree = useMemo(() => {
    return sourceSchema ? buildFieldTree(sourceSchema) : [];
  }, [sourceSchema, buildFieldTree]);

  const targetTree = useMemo(() => {
    return targetSchema ? buildFieldTree(targetSchema) : [];
  }, [targetSchema, buildFieldTree]);

  // Helper function to get all node keys for expanding
  const getAllNodeKeys = useCallback((schema, prefix) => {
    const keys = {};
    const tree = buildFieldTree(schema);

    const collectKeys = (node) => {
      const nodeKey = `${prefix}-${node.path || node.id}`;
      if (node.children && node.children.length > 0) {
        keys[nodeKey] = true;
        node.children.forEach(child => collectKeys(child));
      }
    };

    // Skip root level if single container
    if (tree.length === 1 && tree[0].isParent && tree[0].children) {
      tree[0].children.forEach(node => collectKeys(node));
    } else {
      tree.forEach(node => collectKeys(node));
    }

    return keys;
  }, [buildFieldTree]);

  // Recursive function to render tree nodes
  const renderTreeNode = useCallback((node, level = 0, prefix = 'source') => {
    const nodeKey = `${prefix}-${node.path || node.id}`;
    const isExpanded = expandedNodes[nodeKey];
    const isMapped = node.id && getAllMappedSourceIds.has(node.id);
    const hasChildren = node.children && node.children.length > 0;
    const isRepeating = node.isRepeating || node.maxOccurs === 'unbounded' || (node.maxOccurs && node.maxOccurs > 1);
    const isRecursive = node.isRecursive === true;  // TRUE recursion detected by backend

    const toggleExpand = (e) => {
      e.stopPropagation();
      setExpandedNodes(prev => ({
        ...prev,
        [nodeKey]: !prev[nodeKey]
      }));
    };

    // For parent nodes (objects with children)
    if (hasChildren && node.isParent) {
      return (
        <div key={nodeKey} style={{ marginLeft: level > 0 ? '8px' : '0px' }}>
          <div
            draggable={!processing && isRepeating}
            onDragStart={(e) => {
              if (!processing && isRepeating) {
                handleDragStart(e, { repeatingElement: { path: node.path, name: node.name, fields: node.children } }, 'repeating-source');
              }
            }}
            className={`group relative ${lightMode ? 'bg-gradient-to-r from-blue-50/60 to-blue-100/40 hover:from-blue-100/60 hover:to-blue-200/40 border border-blue-100 hover:border-blue-300 shadow-sm hover:shadow' : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500'} p-2 rounded-lg mb-2 transition-all ${
              isMapped ? 'border-l-4 border-l-emerald-500' : ''
            } ${isRecursive ? 'border-l-4 border-l-orange-500' : ''}`}
          >
            <div className="flex items-center gap-2">
              <button
                onClick={toggleExpand}
                className={`flex-shrink-0 ${lightMode ? 'text-gray-600 hover:text-gray-900' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {isExpanded ? '▼' : '▶'}
              </button>
              {isRepeating && (
                <Repeat className="w-4 h-4 text-pink-400 flex-shrink-0" title="Upprepande element" />
              )}
              {isRecursive && (
                <span className="text-orange-500 text-base flex-shrink-0" title={`Rekursiv typ: ${node.recursiveType || node.type}`}>↻</span>
              )}
              <div className="flex-1 min-w-0">
                <div className={`font-medium text-sm truncate flex items-center gap-2 ${lightMode ? 'text-gray-900' : 'text-white'}`} title={node.name}>
                  {node.name}
                  {isRepeating && node.maxOccurs && (
                    <span className="text-xs bg-pink-500 bg-opacity-20 text-pink-400 px-2 py-0.5 rounded">
                      {node.maxOccurs === 'unbounded' ? '∞' : `${node.maxOccurs}x`}
                    </span>
                  )}
                </div>
                <div className={`text-xs font-mono truncate ${lightMode ? 'text-gray-500' : 'text-slate-400'}`}>
                  {node.path}
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded ${lightMode ? 'bg-gray-200 text-gray-600' : 'bg-slate-600 text-slate-300'} flex-shrink-0`}>
                {node.type}
              </span>
            </div>
          </div>
          {isExpanded && (
            <div>
              {node.children.map(child => renderTreeNode(child, level + 1, prefix))}
            </div>
          )}
        </div>
      );
    }

    // For leaf nodes (actual fields)
    return (
      <div key={nodeKey} style={{ marginLeft: level > 0 ? '8px' : '0px' }}>
        <div
          draggable={!processing}
          onDragStart={(e) => handleDragStart(e, node, 'source')}
          className={`group relative ${lightMode ? 'bg-gradient-to-r from-blue-50/60 to-blue-100/40 hover:from-blue-100/60 hover:to-blue-200/40 border border-blue-100 hover:border-blue-300 shadow-sm hover:shadow' : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500'} p-2 rounded-lg mb-2 cursor-move transition-all ${
            isMapped ? 'border-l-4 border-l-emerald-500' : ''
          } ${isRecursive ? 'border-l-4 border-l-orange-500' : ''}`}
        >
          <div className="flex items-center gap-2">
            {isRepeating && (
              <Repeat className="w-4 h-4 text-pink-400 flex-shrink-0" title="Upprepande element" />
            )}
            {isRecursive && (
              <span className="text-orange-500 text-base flex-shrink-0" title={`Rekursiv typ: ${node.recursiveType || node.type}`}>↻</span>
            )}
            <div className="flex-1 min-w-0">
              <div className={`font-medium text-sm truncate flex items-center gap-2 ${lightMode ? 'text-gray-900' : 'text-white'}`} title={node.name}>
                {node.name}
                {isRepeating && node.maxOccurs && (
                  <span className="text-xs bg-pink-500 bg-opacity-20 text-pink-400 px-2 py-0.5 rounded">
                    {node.maxOccurs === 'unbounded' ? '∞' : `${node.maxOccurs}x`}
                  </span>
                )}
              </div>
              <div className={`text-xs font-mono truncate ${lightMode ? 'text-gray-500' : 'text-slate-400'}`}>
                {node.path}
              </div>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded ${lightMode ? 'bg-gray-100 text-gray-600' : 'bg-slate-700 text-slate-400'} flex-shrink-0`}>
              {node.type}
            </span>
          </div>
        </div>
      </div>
    );
  }, [expandedNodes, getAllMappedSourceIds, processing, lightMode, handleDragStart, setExpandedNodes]);

  // Recursive function to render target tree nodes (with drop handling)
  const renderTargetTreeNode = useCallback((node, level = 0, prefix = 'target') => {
    const nodeKey = `${prefix}-${node.path || node.id}`;
    const isExpanded = expandedNodes[nodeKey];
    const fieldMappings = node.id ? getMappingsForTarget(node.id) : [];
    const isHovered = hoveredTarget === node.id;
    const hasChildren = node.children && node.children.length > 0;
    const isRepeating = node.isRepeating || node.maxOccurs === 'unbounded' || (node.maxOccurs && node.maxOccurs > 1);
    const isRecursive = node.isRecursive === true;  // TRUE recursion detected by backend

    const toggleExpand = (e) => {
      e.stopPropagation();
      setExpandedNodes(prev => ({
        ...prev,
        [nodeKey]: !prev[nodeKey]
      }));
    };

    // For parent nodes
    if (hasChildren && node.isParent) {
      return (
        <div key={nodeKey} style={{ marginLeft: level > 0 ? '8px' : '0px' }}>
          <div
            onDragOver={!processing ? handleDragOver : undefined}
            onDrop={!processing && isRepeating ? (e) => {
              e.preventDefault();
              if (draggedField && draggedField.repeatingElement) {
                const sourceRep = draggedField.repeatingElement;
                const newContainer = {
                  id: `container-${Date.now()}`,
                  source: [],
                  target: node.id,
                  aggregation: 'repeat',
                  loop_element_path: sourceRep.path,
                  target_wrapper_path: node.path,
                  is_container: true,
                  transforms: [],
                  params: {}
                };
                setMappings(prev => [...prev, newContainer]);
              }
            } : undefined}
            className={`group relative ${lightMode ? 'bg-gradient-to-r from-emerald-50/60 to-emerald-100/40 hover:from-emerald-100/60 hover:to-emerald-200/40 border border-emerald-100 hover:border-emerald-300 shadow-sm hover:shadow' : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-green-500'} p-2 rounded-lg mb-2 transition-all ${
              fieldMappings.length > 0 ? 'border-l-4 border-l-emerald-500' : ''
            } ${isRecursive ? 'border-l-4 border-l-orange-500' : ''}`}
          >
            <div className="flex items-center gap-2">
              <button
                onClick={toggleExpand}
                className={`flex-shrink-0 ${lightMode ? 'text-gray-600 hover:text-gray-900' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {isExpanded ? '▼' : '▶'}
              </button>
              {isRepeating && (
                <Repeat className="w-4 h-4 text-pink-400 flex-shrink-0" title="Upprepande element" />
              )}
              {isRecursive && (
                <span className="text-orange-500 text-base flex-shrink-0" title={`Rekursiv typ: ${node.recursiveType || node.type}`}>↻</span>
              )}
              <div className="flex-1 min-w-0">
                <div className={`font-medium text-sm truncate flex items-center gap-2 ${lightMode ? 'text-gray-900' : 'text-white'}`} title={node.name}>
                  {node.name}
                  {isRepeating && node.maxOccurs && (
                    <span className="text-xs bg-pink-500 bg-opacity-20 text-pink-400 px-2 py-0.5 rounded">
                      {node.maxOccurs === 'unbounded' ? '∞' : `${node.maxOccurs}x`}
                    </span>
                  )}
                </div>
                <div className={`text-xs font-mono truncate ${lightMode ? 'text-gray-500' : 'text-slate-400'}`}>
                  {node.path}
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded ${lightMode ? 'bg-gray-200 text-gray-600' : 'bg-slate-600 text-slate-300'} flex-shrink-0`}>
                {node.type}
              </span>
            </div>
          </div>
          {isExpanded && (
            <div>
              {node.children.map(child => renderTargetTreeNode(child, level + 1, prefix))}
            </div>
          )}
        </div>
      );
    }

    // For leaf nodes
    return (
      <div key={nodeKey} style={{ marginLeft: level > 0 ? '8px' : '0px' }}>
        <div
          onDragOver={!processing ? handleDragOver : undefined}
          onDrop={!processing ? (e) => handleDrop(e, node) : undefined}
          onDragEnter={() => !processing && setHoveredTargetThrottled(node.id)}
          onDragLeave={() => setHoveredTarget(null)}
          className={`group relative ${lightMode ? 'bg-gradient-to-r from-emerald-50/60 to-emerald-100/40 hover:from-emerald-100/60 hover:to-emerald-200/40 border border-emerald-100 hover:border-emerald-300 shadow-sm hover:shadow' : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-green-500'} p-2 rounded-lg mb-2 transition-all ${
            isHovered && !processing ? lightMode ? 'ring-2 ring-emerald-300' : 'ring-2 ring-green-400' : ''
          } ${
            fieldMappings.length > 0 ? 'border-l-4 border-l-emerald-500' : ''
          } ${isRecursive ? 'border-l-4 border-l-orange-500' : ''}`}
        >
          <div className="flex items-center gap-2">
            {isRepeating && (
              <Repeat className="w-4 h-4 text-pink-400 flex-shrink-0" title="Upprepande element" />
            )}
            {isRecursive && (
              <span className="text-orange-500 text-base flex-shrink-0" title={`Rekursiv typ: ${node.recursiveType || node.type}`}>↻</span>
            )}
            <div className="flex-1 min-w-0">
              <div className={`font-medium text-sm truncate flex items-center gap-2 ${lightMode ? 'text-gray-900' : 'text-white'}`} title={node.name}>
                {node.name}
                {isRepeating && node.maxOccurs && (
                  <span className="text-xs bg-pink-500 bg-opacity-20 text-pink-400 px-2 py-0.5 rounded">
                    {node.maxOccurs === 'unbounded' ? '∞' : `${node.maxOccurs}x`}
                  </span>
                )}
              </div>
              <div className={`text-xs font-mono truncate ${lightMode ? 'text-gray-500' : 'text-slate-400'}`}>
                {node.path}
              </div>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded ${lightMode ? 'bg-gray-100 text-gray-600' : 'bg-slate-700 text-slate-400'} flex-shrink-0`}>
              {node.type}
            </span>
          </div>
          {fieldMappings.length > 0 && (
            <div className="mt-2 pt-2 border-t border-green-600 text-xs text-green-400 truncate" title={fieldMappings.map(m =>
                m.source.map(s => getSourceFieldName(s)).join(' + ')
              ).join(', ')}>
              ← {fieldMappings.map(m =>
                m.source.map(s => getSourceFieldName(s)).join(' + ')
              ).join(', ')}
            </div>
          )}
        </div>
      </div>
    );
  }, [expandedNodes, getMappingsForTarget, hoveredTarget, processing, lightMode, handleDragOver, handleDrop, setHoveredTarget, setHoveredTargetThrottled, setExpandedNodes, draggedField, setMappings, getSourceFieldName]);

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

    // Debug logging
    console.log('[BATCH DEBUG] folderNaming:', folderNaming);
    console.log('[BATCH DEBUG] folderNamingFields:', folderNamingFields);

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
    <div className={`h-screen ${lightMode ? 'bg-gray-50 light-mode' : 'bg-[#0F172A]'} text-slate-100 flex flex-col transition-colors`}>
      {/* Notification */}
      {notification && (
        <div
          className={`absolute top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-right ${
            notification.type === 'error'
              ? 'bg-red-500 text-white'
              : 'bg-green-500 text-white'
          }`}
        >
          <AlertCircle className="w-5 h-5" />
          <span className="font-medium">{notification.message}</span>
        </div>
      )}

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex items-center justify-center z-40">
          <div className={`${lightMode ? 'bg-white' : 'bg-slate-800'} rounded-2xl p-8 flex flex-col items-center gap-4 shadow-2xl`}>
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-purple-200 border-t-purple-600"></div>
            <span className={`font-medium ${lightMode ? 'text-gray-900' : 'text-white'}`}>Laddar schema...</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className={`${lightMode ? 'bg-gradient-to-r from-gray-100 to-gray-50 border-gray-200 shadow-sm' : 'bg-gradient-to-r from-slate-900 to-slate-800 border-slate-700'} border-b px-6 py-4 flex items-center justify-between transition-colors overflow-x-auto`} style={{ minWidth: '1300px' }}>
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0">
              <Database className="w-6 h-6 text-white" />
            </div>
            <div className="flex-shrink-0">
              <h1 className={`text-lg font-semibold whitespace-nowrap ${lightMode ? 'text-gray-900' : 'text-white'}`}>Schmapper</h1>
              <p className={`text-xs whitespace-nowrap ${lightMode ? 'text-gray-500' : 'text-slate-400'}`}>XML Schema Mapper</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setLightMode(!lightMode)}
            className={`p-2.5 rounded-lg transition ${lightMode ? 'bg-gray-200 hover:bg-gray-300 text-gray-700' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'}`}
            title={lightMode ? 'Mörkt läge' : 'Ljust läge'}
          >
            {lightMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setShowLogs(!showLogs)}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 disabled:opacity-50 ${lightMode ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'}`}
            disabled={isLoading || processing}
          >
            <FileText className="w-4 h-4" />
            Loggar ({logs.length})
          </button>
          <label className={`cursor-pointer px-3.5 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${processing || isLoading ? 'opacity-50 cursor-not-allowed' : ''} ${lightMode ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'}`}>
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
            className={`px-3.5 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 disabled:opacity-50 ${lightMode ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'}`}
            disabled={isLoading || processing || mappings.length === 0}
            title="Spara mappningskonfiguration"
          >
            <Save className="w-4 h-4" />
            Spara config
          </button>
          <button
            onClick={() => {
              if (window.confirm('Är du säker på att du vill rensa alla mappningar?')) {
                setMappings([]);
                setConstants([]);
                setSourceSchema(null);
                setTargetSchema(null);
              }
            }}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 disabled:opacity-50 ${lightMode ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'}`}
            disabled={isLoading || processing}
            title="Rensa allt"
          >
            <Trash2 className="w-4 h-4" />
            Rensa allt
          </button>
          <button
            onClick={executeBatchMapping}
            disabled={processing || isLoading}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${
              processing || isLoading
                ? 'bg-gray-400 cursor-not-allowed text-gray-600'
                : lightMode ? 'bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white' : 'bg-gradient-to-r from-green-700 to-green-600 hover:from-green-600 hover:to-green-500 text-white'
            }`}
          >
            <Play className="w-4 h-4" />
            {processing ? 'Processar...' : 'Kör batch'}
          </button>
        </div>
      </div>

      {/* Path Configuration */}
      <div className={`${lightMode ? 'bg-gradient-to-r from-gray-100 to-gray-50' : 'bg-gradient-to-r from-slate-900 to-slate-800'} py-3 transition-colors overflow-x-auto`} style={{ minWidth: '1300px' }}>
        <div className="flex gap-0 min-w-[1250px]">
          <div className="flex-shrink-0 flex-grow basis-[450px] min-w-[400px] max-w-[550px] px-5">
            <label className={`text-xs font-medium mb-1.5 block ${lightMode ? 'text-gray-700' : 'text-slate-300'}`}>Källmapp</label>
            <input
              type="text"
              value={sourcePath}
              onChange={(e) => setSourcePath(e.target.value)}
              placeholder="C:\\temp\\Schmapper_test\\IN"
              className={`w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${lightMode ? 'bg-white border border-gray-300 text-gray-900 placeholder-gray-400' : 'bg-slate-800 border border-slate-700 text-white placeholder-slate-500'}`}
              disabled={processing}
            />
          </div>
          <div className="flex-1 min-w-[500px] px-6">
            <label className={`text-xs font-medium mb-1.5 block ${lightMode ? 'text-gray-700' : 'text-slate-300'}`}>Målmapp</label>
            <input
              type="text"
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
              placeholder="C:\\temp\\Schmapper_test\\UT"
              className={`w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${lightMode ? 'bg-white border border-gray-300 text-gray-900 placeholder-gray-400' : 'bg-slate-800 border border-slate-700 text-white placeholder-slate-500'}`}
              disabled={processing}
            />
          </div>
          {sourceSchema && (
            <div className="flex-shrink-0 flex-grow basis-[450px] min-w-[400px] max-w-[550px] px-5">
              <label className={`text-xs font-medium mb-1.5 block ${lightMode ? 'text-gray-700' : 'text-slate-300'}`}>Mappstruktur</label>
              <button
                onClick={() => setShowFolderSettings(!showFolderSettings)}
                className={`w-full px-3 py-2 rounded-lg text-sm text-left flex items-center justify-between transition ${lightMode ? 'bg-white hover:bg-gray-50 border border-gray-300 text-gray-900' : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white'}`}
                disabled={processing}
              >
                <span>
                  {folderNaming === 'guid' && '🎲 GUID'}
                  {folderNaming === 'field' && '📋 Fältbaserad'}
                  {folderNaming === 'filename' && '📄 Källfilens namn'}
                </span>
                <span className={lightMode ? 'text-gray-400' : 'text-slate-400'}>{showFolderSettings ? '▲' : '▼'}</span>
              </button>
              {showFolderSettings && (
                <div className={`mt-2 p-3 rounded-lg border ${lightMode ? 'bg-white border-gray-200' : 'bg-slate-800 border-slate-700'}`}>
                  <div className="space-y-2">
                    <button
                      onClick={() => {
                        setFolderNaming('guid');
                        setFolderNamingFields([]);
                      }}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition ${
                        folderNaming === 'guid'
                          ? lightMode ? 'bg-blue-100 text-blue-900 font-medium' : 'bg-blue-900 text-blue-100 font-medium'
                          : lightMode ? 'hover:bg-gray-100 text-gray-700' : 'hover:bg-slate-700 text-slate-300'
                      }`}
                    >
                      🎲 GUID (Unika ID per fil)
                    </button>
                    <button
                      onClick={() => setFolderNaming('field')}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition ${
                        folderNaming === 'field'
                          ? lightMode ? 'bg-blue-100 text-blue-900 font-medium' : 'bg-blue-900 text-blue-100 font-medium'
                          : lightMode ? 'hover:bg-gray-100 text-gray-700' : 'hover:bg-slate-700 text-slate-300'
                      }`}
                    >
                      📋 Fältbaserad (Välj fält nedan)
                    </button>
                    <button
                      onClick={() => {
                        setFolderNaming('filename');
                        setFolderNamingFields([]);
                      }}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition ${
                        folderNaming === 'filename'
                          ? lightMode ? 'bg-blue-100 text-blue-900 font-medium' : 'bg-blue-900 text-blue-100 font-medium'
                          : lightMode ? 'hover:bg-gray-100 text-gray-700' : 'hover:bg-slate-700 text-slate-300'
                      }`}
                    >
                      📄 Källfilens namn
                    </button>
                    {folderNaming === 'field' && targetSchema && (
                      <div className={`mt-2 p-2 rounded ${lightMode ? 'bg-gray-50' : 'bg-slate-900'}`}>
                        <label className={`text-xs font-medium block mb-2 ${lightMode ? 'text-gray-700' : 'text-slate-300'}`}>
                          Välj målfält för mappnamn:
                        </label>
                        <select
                          multiple
                          value={folderNamingFields}
                          onChange={(e) => {
                            const selected = Array.from(e.target.selectedOptions).map(o => o.value);
                            console.log('[FOLDER NAMING] Selected fields:', selected);
                            setFolderNamingFields(selected);
                          }}
                          className={`w-full px-2 py-1.5 rounded text-xs border ${lightMode ? 'bg-white border-gray-300 text-gray-900' : 'bg-slate-800 border-slate-600 text-white'}`}
                          size={Math.min(5, (() => {
                            const mappedTargetIds = new Set();
                            mappings.forEach(m => {
                              if (m.target) {
                                mappedTargetIds.add(m.target);
                              }
                            });
                            return targetSchema.fields.filter(f => mappedTargetIds.has(f.id)).length;
                          })())}
                        >
                          {(() => {
                            const mappedTargetIds = new Set();
                            mappings.forEach(m => {
                              if (m.target) {
                                mappedTargetIds.add(m.target);
                              }
                            });
                            return targetSchema.fields.filter(f => mappedTargetIds.has(f.id));
                          })().map(field => (
                            <option key={field.id} value={field.name}>
                              {field.name}
                            </option>
                          ))}
                        </select>
                        <p className={`text-xs mt-1 ${lightMode ? 'text-gray-500' : 'text-slate-400'}`}>
                          Håll Ctrl/Cmd för att välja flera (endast mappade målfält visas)
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-x-auto" style={{ minWidth: '1300px' }}>
        {/* Source Panel */}
        <div className={`flex-shrink-0 flex-grow basis-[450px] min-w-[400px] max-w-[550px] ${lightMode ? 'bg-gradient-to-b from-blue-50/40 to-white border-blue-100' : 'bg-gradient-to-b from-slate-950 to-slate-900 border-slate-700'} border-r flex flex-col transition-colors`}>
          <div className={`px-5 py-4 ${lightMode ? 'bg-gradient-to-r from-blue-50 to-blue-100/50 border-b border-blue-100' : 'bg-gradient-to-r from-blue-900/20 to-blue-800/20 border-slate-700'} border-b`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-lg ${lightMode ? 'bg-blue-50' : 'bg-blue-500 bg-opacity-20'} flex items-center justify-center`}>
                  <Database className={`w-4 h-4 ${lightMode ? 'text-blue-600' : 'text-blue-400'}`} />
                </div>
                <h2 className={`font-semibold text-sm ${lightMode ? 'text-gray-900' : 'text-white'}`}>Källschema</h2>
              </div>
            </div>
            <p className={`text-xs mb-3 ${lightMode ? 'text-gray-500' : 'text-slate-400'}`}>Dra element för att skapa mappningar</p>
            {!sourceSchema ? (
              <label className={`cursor-pointer w-full px-3 py-2 rounded-lg text-xs font-medium transition flex items-center justify-center gap-2 ${lightMode ? 'bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}>
                <Upload className="w-3.5 h-3.5" />
                Ladda schema
                <input
                  type="file"
                  accept=".csv,.xsd,.xml"
                  onChange={handleSourceUpload}
                  className="hidden"
                  disabled={processing || isLoading}
                />
              </label>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <p className={`text-xs truncate ${lightMode ? 'text-gray-700' : 'text-slate-300'}`}>{sourceSchema.name}</p>
                <button
                  onClick={() => {
                    if (window.confirm('Ta bort källschema?')) {
                      setSourceSchema(null);
                      setMappings([]);
                    }
                  }}
                  className={`flex-shrink-0 p-1.5 rounded transition ${lightMode ? 'hover:bg-red-50 text-red-600' : 'hover:bg-red-900 hover:bg-opacity-20 text-red-400'}`}
                  disabled={processing || isLoading}
                  title="Ta bort schema"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
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
                        className={`group relative ${lightMode ? 'bg-gradient-to-r from-purple-50 to-purple-100 hover:from-purple-100 hover:to-purple-200 border border-purple-200 hover:border-purple-300' : 'bg-gradient-to-r from-purple-500/40 to-purple-500/40 hover:from-purple-800/50 hover:to-purple-700/50 border border-purple-500 hover:border-purple-400'} p-3 rounded-lg mb-2 cursor-move transition-all`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            <div className={`font-medium text-sm truncate ${lightMode ? 'text-purple-900' : 'text-purple-300'}`} title={constant.name}>
                              {constant.name}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 ml-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConstantName(constant.name);
                                setConstantValue(constant.value);
                                setEditingConstantId(constant.id);
                                setShowConstantModal(true);
                              }}
                              className={`p-1 rounded hover:bg-purple-500 hover:bg-opacity-20 transition ${lightMode ? 'text-purple-600 hover:text-purple-700' : 'text-purple-400 hover:text-purple-300'}`}
                              disabled={processing}
                              aria-label="Redigera konstant"
                              title="Redigera"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteConstant(constant.id);
                              }}
                              className={`p-1 rounded hover:bg-red-500 hover:bg-opacity-20 transition ${lightMode ? 'text-red-600 hover:text-red-700' : 'text-red-400 hover:text-red-300'}`}
                              disabled={processing}
                              aria-label="Ta bort konstant"
                              title="Ta bort"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className={`text-xs font-mono px-2 py-1.5 rounded break-all ${lightMode ? 'bg-purple-100 text-purple-800' : 'bg-purple-950/50 text-purple-200'}`}>
                          = "{constant.value}"
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                <button
                  onClick={() => {
                    setConstantName('');
                    setConstantValue('');
                    setEditingConstantId(null);
                    setShowConstantModal(true);
                  }}
                  className="w-full mb-4 p-3 border-2 border-dashed border-purple-500 rounded hover:bg-purple-900 hover:bg-opacity-20 transition flex items-center justify-center gap-2 text-purple-400 disabled:opacity-50"
                  disabled={processing}
                >
                  <Plus className="w-4 h-4" />
                  Nytt fast värde
                </button>
                
                {/* Hierarchical Field Tree - Using memoized tree for performance */}
                {(() => {
                  // Skip root level if there's only one root node (container)
                  if (sourceTree.length === 1 && sourceTree[0].isParent && sourceTree[0].children) {
                    return sourceTree[0].children.map(node => renderTreeNode(node, 0, 'source'));
                  }
                  return sourceTree.map(node => renderTreeNode(node, 0, 'source'));
                })()}
              </>
            )}
          </div>
        </div>

        {/* Mappings Panel */}
        <div className={`flex-1 min-w-[500px] ${lightMode ? 'bg-gradient-to-b from-purple-50/20 to-gray-50' : 'bg-gradient-to-b from-slate-950 to-slate-900'} flex flex-col transition-colors`}>
          <div className={`px-6 py-4 ${lightMode ? 'bg-gradient-to-r from-purple-50/50 to-white border-purple-100/50 shadow-sm' : 'bg-[#1E293B] border-slate-700'} border-b transition-colors`}>
            <h2 className={`font-semibold text-base mb-1 ${lightMode ? 'text-gray-900' : 'text-white'}`}>Mappningar</h2>
            <p className={`text-xs ${lightMode ? 'text-gray-500' : 'text-slate-400'}`}>
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
              <div className="space-y-6">
                {/* Regular mappings (non-container, non-child) */}
                {mappings.filter(m => !m.is_container && !m.parent_repeat_container).map(mapping => {
                  return (
                    <div
                      key={mapping.id}
                      className={`${lightMode ? 'bg-gradient-to-br from-white to-gray-50/30 border-gray-100 hover:border-gray-200 shadow-sm hover:shadow-md' : 'bg-slate-800 border-slate-700 hover:border-slate-600'} rounded-xl p-4 border transition-all cursor-pointer ${
                        selectedMapping === mapping.id
                          ? lightMode ? 'border-purple-300 shadow-lg ring-1 ring-purple-100' : 'border-purple-500 shadow-xl'
                          : ''
                      } ${
                        hoveredMapping === mapping.id && draggedField ? lightMode ? 'ring-2 ring-blue-300 bg-gradient-to-br from-blue-50/50 to-blue-100/50' : 'ring-2 ring-blue-400 bg-slate-750' : ''
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
                                {idx > 0 && <span className={`text-xs ${lightMode ? 'text-gray-400' : 'text-slate-500'}`}>+</span>}
                                <div className={`px-3 py-1.5 rounded-lg text-sm font-medium truncate max-w-xs ${lightMode ? 'bg-gradient-to-r from-blue-500 to-blue-400 text-white' : 'bg-gradient-to-r from-blue-700 to-blue-600 text-white'}`} title={getSourceFieldName(srcId)}>
                                  {getSourceFieldName(srcId)}
                                </div>
                              </React.Fragment>
                            ))}
                            <ArrowRight className={`${lightMode ? 'text-gray-400' : 'text-slate-400'}`} size={24} />
                            <div className={`px-3 py-1.5 rounded-lg text-sm font-medium truncate max-w-xs ${lightMode ? 'bg-gradient-to-r from-emerald-500 to-emerald-400 text-white' : 'bg-gradient-to-r from-emerald-700 to-emerald-600 text-white'}`} title={getTargetFieldName(mapping.target)}>
                              {getTargetFieldName(mapping.target)}
                            </div>
                          </div>
                          {mapping.source.length > 1 && (
                            <div className={`text-xs px-2 py-1.5 rounded inline-block break-all ${lightMode ? 'bg-gray-100 text-gray-600' : 'bg-slate-900 text-slate-400'}`}>
                              Resultat: "{getPreviewText(mapping)}"
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setCurrentMappingForTransform(mapping.id);
                              setShowTransformModal(true);
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 disabled:opacity-50 ${lightMode ? 'bg-gradient-to-r from-purple-300 to-purple-200 hover:from-purple-700 hover:to-purple-600 text-black' : 'bg-gradient-to-r from-purple-800 to-purple-700 hover:from-purple-600 hover:to-purple-500 text-white'}`}
                            disabled={processing}
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Transformera
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setCurrentMappingForCondition(mapping.id);
                              setEditingConditions(mapping.conditions || []);
                              setShowConditionModal(true);
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 disabled:opacity-50 ${
                              mapping.conditions && mapping.conditions.length > 0
                                ? lightMode
                                  ? 'bg-gradient-to-r from-amber-400 to-amber-300 hover:from-amber-600 hover:to-amber-500 text-black'
                                  : 'bg-gradient-to-r from-amber-700 to-amber-600 hover:from-amber-500 hover:to-amber-400 text-white'
                                : lightMode
                                  ? 'bg-gradient-to-r from-amber-200 to-amber-100 hover:from-amber-400 hover:to-amber-300 text-black'
                                  : 'bg-gradient-to-r from-amber-900 to-amber-800 hover:from-amber-700 hover:to-amber-600 text-white'
                            }`}
                            disabled={processing}
                            title={mapping.conditions && mapping.conditions.length > 0 ? `${mapping.conditions.length} villkor aktiva` : 'Lägg till villkor'}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                            </svg>
                            Villkor
                            {mapping.conditions && mapping.conditions.length > 0 && (
                              <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${lightMode ? 'bg-amber-600 text-white' : 'bg-amber-400 text-black'}`}>
                                {mapping.conditions.length}
                              </span>
                            )}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteMapping(mapping.id);
                            }}
                            className={`p-1.5 rounded hover:bg-red-500 hover:bg-opacity-10 transition flex-shrink-0 disabled:opacity-50 ${lightMode ? 'text-red-600' : 'text-red-400'}`}
                            disabled={processing}
                            aria-label="Ta bort mappning"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      
                      {getTransformInstances(mapping).length > 0 && (
                        <div className="mb-3">
                          <div className="flex items-center gap-2 mb-2">
                            <Settings className={`w-3.5 h-3.5 ${lightMode ? 'text-purple-600' : 'text-purple-400'}`} />
                            <span className={`text-xs font-semibold ${lightMode ? 'text-gray-700' : 'text-slate-300'}`}>Aktiva transformeringar</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {getTransformInstances(mapping).map(instance => {
                              const transform = transforms.find(t => t.id === instance.type);
                              const needsParams = ['replace', 'regex', 'format', 'default', 'concat'].includes(instance.type);
                              return transform ? (
                                <div
                                  key={instance.id}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                                    lightMode ? 'bg-gradient-to-r from-purple-600 to-purple-400 text-white' : 'bg-gradient-to-r from-purple-600 to-purple-400 text-white'
                                  } ${needsParams ? 'cursor-pointer hover:from-purple-700 hover:to-purple-500' : ''}`}
                                  onClick={(e) => {
                                    if (needsParams) {
                                      e.stopPropagation();
                                      setEditingTransform(instance.type);
                                      setTransformParams(instance.params || {});
                                      setEditingInstanceId(instance.id);
                                      setCurrentMappingForTransform(mapping.id);
                                      setShowTransformModal(true);
                                    }
                                  }}
                                  title={needsParams ? 'Klicka för att redigera' : ''}
                                >
                                  <span>{transform.icon}</span>
                                  <span>{transform.name}</span>
                                  {instance.params && Object.keys(instance.params).length > 0 && (
                                    <span className={`text-[10px] opacity-75`}>
                                      ({Object.values(instance.params).filter(v => v).slice(0, 1).join(', ').substring(0, 15)}{Object.values(instance.params).filter(v => v).join('').length > 15 ? '...' : ''})
                                    </span>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeTransformInstance(mapping.id, instance.id);
                                    }}
                                    className="ml-1 hover:bg-white hover:bg-opacity-20 rounded px-1 transition"
                                    disabled={processing}
                                    title="Ta bort transformering"
                                  >
                                    ×
                                  </button>
                                </div>
                              ) : null;
                            })}
                          </div>
                        </div>
                      )}


                      {/* Aggregation mode */}
                      {mapping.source.length === 1 && (
                        <div className={`pt-3 border-t ${lightMode ? 'border-gray-100' : 'border-slate-700'}`}>
                          <div className="flex items-center gap-4">
                            <label className={`text-xs ${lightMode ? 'text-gray-600' : 'text-slate-400'}`}>Aggregering:</label>
                            <div className="flex gap-2">
                              {aggregationModes.map(mode => (
                                <button
                                  key={mode.id}
                                  onClick={() => handleAggregationChange(mapping.id, mode.id)}
                                  className={`px-3 py-1.5 rounded-lg text-xs transition ${
                                    (mapping.aggregation || 'foreach') === mode.id
                                      ? 'bg-gradient-to-r from-orange-800 to-orange-700 text-white'
                                      : lightMode ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
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
                                className="ml-2 bg-slate-700 px-2 py-1.5 rounded text-sm w-20 focus:outline-none focus:ring-2 focus:ring-purple-500"
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
                        <div className="flex items-center gap-3">
                          <Repeat className="w-5 h-5 text-pink-400" />
                          <span className="font-medium text-pink-300">{sourceElemName}</span>
                          <ArrowRight className="text-pink-400" size={24} />
                          <span className="font-medium text-pink-300">{targetElemName}</span>
                          {isRepeatToSingle && (
                            <span className="text-xs bg-pink-700 px-2 py-0.5 rounded">
                              Upprepa-till-Enskild
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteMapping(container.id)}
                          className="text-pink-400 hover:text-red-400"
                          disabled={processing}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Merge Separator - Only show if target is not repeatable */}
                      {(() => {
                        // Check if target is repeatable
                        const targetField = targetSchema?.fields?.find(f => f.path === container.target_wrapper_path);
                        const isTargetNonRepeatable = targetField && (targetField.maxOccurs === "1" || targetField.repeatable === false);

                        if (isTargetNonRepeatable) {
                          // Automatically set aggregation to 'merge' for non-repeatable targets
                          if (container.aggregation !== 'merge') {
                            setMappings(prev => prev.map(m =>
                              m.id === container.id
                                ? { ...m, aggregation: 'merge', params: { ...m.params, mergeSeparator: m.params?.mergeSeparator || ', ' } }
                                : m
                            ));
                          }

                          return (
                            <div className={`text-xs ${lightMode ? 'text-pink-700' : 'text-pink-400'} flex items-center gap-3 mb-3`}>
                              <span>Målfältet kan bara förekomma 1 gång - alla instanser kombineras.</span>
                              <span className="whitespace-nowrap">Separator:</span>
                              <input
                                type="text"
                                value={container.params?.mergeSeparator || ', '}
                                onChange={(e) => {
                                  setMappings(prev => prev.map(m =>
                                    m.id === container.id
                                      ? { ...m, params: { ...m.params, mergeSeparator: e.target.value } }
                                      : m
                                  ));
                                }}
                                className={`px-2 py-1 rounded text-xs w-20 ${lightMode ? 'bg-white border border-pink-300 text-gray-900' : 'bg-slate-800 border border-pink-600 text-white'}`}
                                placeholder=", "
                                disabled={processing}
                              />
                            </div>
                          );
                        }
                        return null;
                      })()}

                      <div className="ml-4 space-y-3 pl-4">
                        {childMappings.map(mapping => {
                          const isSelected = selectedMapping === mapping.id;

                          return (
                            <div
                              key={mapping.id}
                              className={`${lightMode ? 'bg-gradient-to-br from-white to-gray-50/30 border-gray-100 hover:border-gray-200 shadow-sm hover:shadow-md' : 'bg-slate-800 border-slate-700 hover:border-slate-600'} rounded-xl p-4 border transition-all cursor-pointer ${
                                isSelected
                                  ? lightMode ? 'border-purple-300 shadow-lg ring-1 ring-purple-100' : 'border-slate-400 shadow-xl'
                                  : ''
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
                                        className={`px-2 py-1.5 rounded text-xs text-white ${
                                          constant ? 'bg-gradient-to-r from-purple-800 to-purple-700' : 'bg-gradient-to-r from-blue-600 to-blue-500'
                                        }`}
                                      >
                                        {constant ? constant.name : getSourceFieldName(srcId)}
                                      </div>
                                    );
                                  })}
                                  <ArrowRight className="text-slate-400" size={24} />
                                  <div className="bg-gradient-to-r from-emerald-600 to-emerald-500 px-2 py-1.5 rounded text-xs text-white">
                                    {getTargetFieldName(mapping.target)}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCurrentMappingForTransform(mapping.id);
                                      setShowTransformModal(true);
                                    }}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 disabled:opacity-50 ${lightMode ? 'bg-gradient-to-r from-purple-300 to-purple-200 hover:from-purple-700 hover:to-purple-600 text-black' : 'bg-gradient-to-r from-purple-800 to-purple-700 hover:from-purple-600 hover:to-purple-500 text-white'}`}
                                    disabled={processing}
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                    Transformera
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteMapping(mapping.id);
                                    }}
                                    className={`p-1.5 rounded hover:bg-red-500 hover:bg-opacity-10 transition flex-shrink-0 disabled:opacity-50 ${lightMode ? 'text-red-600' : 'text-red-400'}`}
                                    disabled={processing}
                                    aria-label="Ta bort mappning"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>

                              {getTransformInstances(mapping).length > 0 && (
                                <div className="mb-3">
                                  <div className="flex items-center gap-2 mb-2">
                                    <Settings className={`w-3.5 h-3.5 ${lightMode ? 'text-purple-600' : 'text-purple-400'}`} />
                                    <span className={`text-xs font-semibold ${lightMode ? 'text-gray-700' : 'text-slate-300'}`}>Aktiva transformeringar</span>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {getTransformInstances(mapping).map(instance => {
                                      const transform = transforms.find(t => t.id === instance.type);
                                      const needsParams = ['replace', 'regex', 'format', 'default', 'concat'].includes(instance.type);
                                      return transform ? (
                                        <div
                                          key={instance.id}
                                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                                            lightMode ? 'bg-gradient-to-r from-purple-600 to-purple-400 text-white' : 'bg-gradient-to-r from-purple-600 to-purple-400 text-white'
                                          } ${needsParams ? 'cursor-pointer hover:from-purple-700 hover:to-purple-500' : ''}`}
                                          onClick={(e) => {
                                            if (needsParams) {
                                              e.stopPropagation();
                                              setEditingTransform(instance.type);
                                              setTransformParams(instance.params || {});
                                              setEditingInstanceId(instance.id);
                                              setCurrentMappingForTransform(mapping.id);
                                              setShowTransformModal(true);
                                            }
                                          }}
                                          title={needsParams ? 'Klicka för att redigera' : ''}
                                        >
                                          <span>{transform.icon}</span>
                                          <span>{transform.name}</span>
                                          {instance.params && Object.keys(instance.params).length > 0 && (
                                            <span className={`text-[10px] opacity-75`}>
                                              ({Object.values(instance.params).filter(v => v).slice(0, 1).join(', ').substring(0, 15)}{Object.values(instance.params).filter(v => v).join('').length > 15 ? '...' : ''})
                                            </span>
                                          )}
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              removeTransformInstance(mapping.id, instance.id);
                                            }}
                                            className="ml-1 hover:bg-white hover:bg-opacity-20 rounded px-1 transition"
                                            disabled={processing}
                                            title="Ta bort transformering"
                                          >
                                            ×
                                          </button>
                                        </div>
                                      ) : null;
                                    })}
                                  </div>
                                </div>
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
        <div className={`flex-shrink-0 flex-grow basis-[450px] min-w-[400px] max-w-[550px] ${lightMode ? 'bg-gradient-to-b from-emerald-50/40 to-white border-emerald-100' : 'bg-gradient-to-b from-slate-950 to-slate-900 border-slate-700'} border-l flex flex-col transition-colors`}>
          <div className={`px-5 py-4 ${lightMode ? 'bg-gradient-to-r from-emerald-50 to-emerald-100/50 border-b border-emerald-100' : 'bg-gradient-to-r from-green-900/20 to-green-800/20 border-slate-700'} border-b`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-lg ${lightMode ? 'bg-green-50' : 'bg-green-500 bg-opacity-20'} flex items-center justify-center`}>
                  <Database className={`w-4 h-4 ${lightMode ? 'text-green-600' : 'text-green-400'}`} />
                </div>
                <h2 className={`font-semibold text-sm ${lightMode ? 'text-gray-900' : 'text-white'}`}>Målschema</h2>
              </div>
            </div>
            <p className={`text-xs mb-3 ${lightMode ? 'text-gray-500' : 'text-slate-400'}`}>Släpp här för att mappa element</p>
            {!targetSchema ? (
              <label className={`cursor-pointer w-full px-3 py-2 rounded-lg text-xs font-medium transition flex items-center justify-center gap-2 ${processing || isLoading ? 'opacity-50 cursor-not-allowed' : ''} ${lightMode ? 'bg-green-50 hover:bg-green-100 text-green-700 border border-green-200' : 'bg-green-600 hover:bg-green-500 text-white'}`}>
                <Upload className="w-3.5 h-3.5" />
                Ladda schema
                <input
                  type="file"
                  accept=".xsd,.xml"
                  onChange={handleTargetUpload}
                  className="hidden"
                  disabled={processing || isLoading}
                />
              </label>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <p className={`text-xs truncate ${lightMode ? 'text-gray-700' : 'text-slate-300'}`}>{targetSchema.name}</p>
                <button
                  onClick={() => {
                    if (window.confirm('Ta bort målschema?')) {
                      setTargetSchema(null);
                      setMappings([]);
                    }
                  }}
                  className={`flex-shrink-0 p-1.5 rounded transition ${lightMode ? 'hover:bg-red-50 text-red-600' : 'hover:bg-red-900 hover:bg-opacity-20 text-red-400'}`}
                  disabled={processing || isLoading}
                  title="Ta bort schema"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
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
                {/* Hierarchical Field Tree - Using memoized tree for performance */}
                {(() => {
                  // Skip root level if there's only one root node (container)
                  if (targetTree.length === 1 && targetTree[0].isParent && targetTree[0].children) {
                    return targetTree[0].children.map(node => renderTargetTreeNode(node, 0, 'target'));
                  }
                  return targetTree.map(node => renderTargetTreeNode(node, 0, 'target'));
                })()}

                {/* Regular Fields - REMOVED: Causes duplicates since tree already shows all fields */}
                {false && targetSchema.fields.map(field => {
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
                    className={`group relative ${lightMode ? 'bg-gray-50 hover:bg-green-50 border border-gray-200 hover:border-green-300' : 'bg-slate-800 hover:bg-slate-700 border border-slate-600 hover:border-green-500'} p-3 rounded-lg transition-all ${
                      isHovered && !processing ? lightMode ? 'ring-2 ring-green-400 bg-green-50' : 'ring-2 ring-green-400 bg-slate-600' : ''
                    } ${
                      fieldMappings.length > 0 ? 'border-l-4 border-l-green-500' : ''
                    } ${
                      isInRepeatingContainer ? 'border-l-4 border-l-pink-500' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {isPotentialRepeating && (
                        <Repeat className="w-4 h-4 text-pink-400 flex-shrink-0" title="Kan vara upprepande wrapper" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className={`font-medium text-sm truncate flex items-center gap-2 ${lightMode ? 'text-gray-900' : 'text-white'}`} title={field.name}>
                          {field.name}
                          {isRepeatable && (
                            <span className="text-xs bg-pink-500 bg-opacity-20 text-pink-400 px-2 py-0.5 rounded" title={`maxOccurs: ${field.maxOccurs || 'unbounded'}`}>
                              Upprepande
                            </span>
                          )}
                        </div>
                        <div className={`text-xs font-mono truncate ${lightMode ? 'text-gray-500' : 'text-slate-400'}`}>
                          {fullPath}
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded ${lightMode ? 'bg-gray-100 text-gray-600' : 'bg-slate-700 text-slate-400'} flex-shrink-0`}>
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

      {/* Transform Modal */}
      {showTransformModal && currentMappingForTransform && (
        <div
          className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
          onClick={() => {
            setShowTransformModal(false);
            setCurrentMappingForTransform(null);
            setEditingTransform(null);
            setTransformParams({});
            setEditingInstanceId(null);
          }}
        >
          <div
            className={`${lightMode ? 'bg-white' : 'bg-slate-800'} rounded-xl w-[600px] max-h-[85vh] flex flex-col shadow-2xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`px-6 py-4 ${lightMode ? 'border-gray-200' : 'border-slate-700'} border-b flex items-center justify-between`}>
              <h3 className={`text-lg font-semibold ${lightMode ? 'text-gray-900' : 'text-white'}`}>
                {editingTransform ? `Konfigurera ${transforms.find(t => t.id === editingTransform)?.name}` : 'Lägg till transformering'}
              </h3>
              <button
                onClick={() => {
                  setShowTransformModal(false);
                  setCurrentMappingForTransform(null);
                  setEditingTransform(null);
                  setTransformParams({});
                  setEditingInstanceId(null);
                }}
                className={`${lightMode ? 'text-gray-400 hover:text-gray-600' : 'text-slate-400 hover:text-white'} transition`}
              >
                ✕
              </button>
            </div>

            {!editingTransform ? (
              <div className="p-6 overflow-y-auto">
                <p className={`text-sm mb-6 ${lightMode ? 'text-gray-600' : 'text-slate-400'}`}>Välj en transformering att tillämpa på mappade data</p>
                <div className="grid grid-cols-2 gap-4">
                  {transforms.filter(t => t.id !== 'none').map(transform => {
                    const gradientColors = {
                      'trim': lightMode ? 'bg-gradient-to-br from-blue-400 to-blue-600' : 'bg-gradient-to-br from-blue-500 to-blue-700',
                      'uppercase': lightMode ? 'bg-gradient-to-br from-green-400 to-green-600' : 'bg-gradient-to-br from-green-500 to-green-700',
                      'lowercase': lightMode ? 'bg-gradient-to-br from-pink-400 to-pink-600' : 'bg-gradient-to-br from-pink-500 to-pink-700',
                      'regex': lightMode ? 'bg-gradient-to-br from-orange-400 to-orange-600' : 'bg-gradient-to-br from-orange-500 to-orange-700',
                      'replace': lightMode ? 'bg-gradient-to-br from-rose-400 to-rose-600' : 'bg-gradient-to-br from-rose-500 to-rose-700',
                      'format': lightMode ? 'bg-gradient-to-br from-purple-400 to-purple-600' : 'bg-gradient-to-br from-purple-500 to-purple-700',
                      'concat': lightMode ? 'bg-gradient-to-br from-indigo-400 to-indigo-600' : 'bg-gradient-to-br from-indigo-500 to-indigo-700',
                      'default': lightMode ? 'bg-gradient-to-br from-amber-400 to-amber-600' : 'bg-gradient-to-br from-amber-500 to-amber-700'
                    };

                    const needsParams = ['replace', 'regex', 'format', 'default', 'concat'].includes(transform.id);

                    return (
                      <button
                        key={transform.id}
                        onClick={() => {
                          if (needsParams) {
                            setEditingTransform(transform.id);
                            setTransformParams({});
                          } else {
                            saveTransformInstance(currentMappingForTransform, transform.id);
                            setTimeout(() => {
                              setShowTransformModal(false);
                              setCurrentMappingForTransform(null);
                            }, 150);
                          }
                        }}
                        className={`p-5 rounded-2xl border-2 text-left transition-all ${
                          lightMode
                            ? 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-md'
                            : 'border-slate-700 bg-slate-800 bg-opacity-50 hover:border-slate-600 hover:shadow-lg'
                        }`}
                      >
                        <div className="flex items-start gap-3 mb-3">
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white text-xl font-bold shadow-md ${gradientColors[transform.id] || (lightMode ? 'bg-gradient-to-br from-gray-400 to-gray-600' : 'bg-gradient-to-br from-slate-500 to-slate-700')}`}>
                            {transform.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`font-semibold text-base mb-1 ${lightMode ? 'text-gray-900' : 'text-white'}`}>
                              {transform.name}
                            </div>
                          </div>
                        </div>
                        <p className={`text-xs leading-relaxed ${lightMode ? 'text-gray-600' : 'text-slate-400'}`}>
                          {transform.id === 'uppercase' && 'Konvertera text till versaler'}
                          {transform.id === 'lowercase' && 'Konvertera text till gemener'}
                          {transform.id === 'trim' && 'Ta bort mellanslag före och efter'}
                          {transform.id === 'concat' && 'Slå ihop flera värden'}
                          {transform.id === 'replace' && 'Ersätt specifik text'}
                          {transform.id === 'regex' && 'Använd reguljära uttryck för transformering'}
                          {transform.id === 'format' && 'Formatera text med anpassat mönster'}
                          {transform.id === 'default' && 'Sätt standardvärde om tomt'}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="p-6 overflow-y-auto">
                <div className="space-y-4">
                  {editingTransform === 'replace' && (
                    <>
                      <div>
                        <label className={`text-sm font-medium block mb-2 ${lightMode ? 'text-gray-700' : 'text-slate-300'}`}>Från (text att ersätta):</label>
                        <input
                          type="text"
                          value={transformParams.from_ || ''}
                          onChange={(e) => setTransformParams(prev => ({ ...prev, from_: e.target.value }))}
                          className={`w-full px-3 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2 focus:ring-purple-500 ${lightMode ? 'bg-white border-gray-300 text-gray-900' : 'bg-slate-700 border-slate-600 text-white'}`}
                          placeholder="Text att ersätta"
                        />
                      </div>
                      <div>
                        <label className={`text-sm font-medium block mb-2 ${lightMode ? 'text-gray-700' : 'text-slate-300'}`}>Till (ny text):</label>
                        <input
                          type="text"
                          value={transformParams.to || ''}
                          onChange={(e) => setTransformParams(prev => ({ ...prev, to: e.target.value }))}
                          className={`w-full px-3 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2 focus:ring-purple-500 ${lightMode ? 'bg-white border-gray-300 text-gray-900' : 'bg-slate-700 border-slate-600 text-white'}`}
                          placeholder="Ny text"
                        />
                      </div>
                    </>
                  )}

                  {editingTransform === 'regex' && (
                    <>
                      <div>
                        <label className={`text-sm font-medium block mb-2 ${lightMode ? 'text-gray-700' : 'text-slate-300'}`}>Mönster (regex):</label>
                        <input
                          type="text"
                          value={transformParams.pattern || ''}
                          onChange={(e) => setTransformParams(prev => ({ ...prev, pattern: e.target.value }))}
                          className={`w-full px-3 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono ${lightMode ? 'bg-white border-gray-300 text-gray-900' : 'bg-slate-700 border-slate-600 text-white'}`}
                          placeholder="t.ex. [0-9]+"
                        />
                      </div>
                      <div>
                        <label className={`text-sm font-medium block mb-2 ${lightMode ? 'text-gray-700' : 'text-slate-300'}`}>Ersättning:</label>
                        <input
                          type="text"
                          value={transformParams.replacement || ''}
                          onChange={(e) => setTransformParams(prev => ({ ...prev, replacement: e.target.value }))}
                          className={`w-full px-3 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono ${lightMode ? 'bg-white border-gray-300 text-gray-900' : 'bg-slate-700 border-slate-600 text-white'}`}
                          placeholder="Ersättningstext"
                        />
                      </div>
                    </>
                  )}

                  {editingTransform === 'format' && (
                    <div>
                      <label className={`text-sm font-medium block mb-2 ${lightMode ? 'text-gray-700' : 'text-slate-300'}`}>Format:</label>
                      <input
                        type="text"
                        value={transformParams.format || ''}
                        onChange={(e) => setTransformParams(prev => ({ ...prev, format: e.target.value }))}
                        className={`w-full px-3 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2 focus:ring-purple-500 ${lightMode ? 'bg-white border-gray-300 text-gray-900' : 'bg-slate-700 border-slate-600 text-white'}`}
                        placeholder="t.ex. {value} kr"
                      />
                    </div>
                  )}

                  {editingTransform === 'default' && (
                    <div>
                      <label className={`text-sm font-medium block mb-2 ${lightMode ? 'text-gray-700' : 'text-slate-300'}`}>Standardvärde:</label>
                      <input
                        type="text"
                        value={transformParams.defaultValue || ''}
                        onChange={(e) => setTransformParams(prev => ({ ...prev, defaultValue: e.target.value }))}
                        className={`w-full px-3 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2 focus:ring-purple-500 ${lightMode ? 'bg-white border-gray-300 text-gray-900' : 'bg-slate-700 border-slate-600 text-white'}`}
                        placeholder="Värde om fältet är tomt"
                      />
                    </div>
                  )}

                  {editingTransform === 'concat' && (
                    <div>
                      <label className={`text-sm font-medium block mb-2 ${lightMode ? 'text-gray-700' : 'text-slate-300'}`}>Separator:</label>
                      <input
                        type="text"
                        value={transformParams.separator || ' '}
                        onChange={(e) => setTransformParams(prev => ({ ...prev, separator: e.target.value }))}
                        className={`w-full px-3 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2 focus:ring-purple-500 ${lightMode ? 'bg-white border-gray-300 text-gray-900' : 'bg-slate-700 border-slate-600 text-white'}`}
                        placeholder="Mellanslag"
                      />
                    </div>
                  )}
                </div>

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => {
                      setEditingTransform(null);
                      setTransformParams({});
                      setEditingInstanceId(null);
                    }}
                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition ${
                      lightMode
                        ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                        : 'bg-slate-700 hover:bg-slate-600 text-white'
                    }`}
                  >
                    Tillbaka
                  </button>
                  <button
                    onClick={() => {
                      if (editingInstanceId) {
                        updateTransformInstance(currentMappingForTransform, editingInstanceId, transformParams);
                      } else {
                        saveTransformInstance(currentMappingForTransform, editingTransform, transformParams);
                      }
                      setShowTransformModal(false);
                      setCurrentMappingForTransform(null);
                      setEditingTransform(null);
                      setTransformParams({});
                      setEditingInstanceId(null);
                    }}
                    className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-purple-600 to-purple-400 hover:from-purple-700 hover:to-purple-500 text-white transition"
                  >
                    Spara
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Condition Editor Modal */}
      {showConditionModal && currentMappingForCondition && (
        <div
          className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
          onClick={() => {
            setShowConditionModal(false);
            setCurrentMappingForCondition(null);
            setEditingConditions([]);
          }}
        >
          <div
            className={`${lightMode ? 'bg-white' : 'bg-slate-800'} rounded-xl w-[650px] max-h-[85vh] flex flex-col shadow-2xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`px-6 py-4 ${lightMode ? 'border-gray-200' : 'border-slate-700'} border-b flex items-center justify-between`}>
              <h3 className={`text-lg font-semibold ${lightMode ? 'text-gray-900' : 'text-white'}`}>
                Villkor för mappning
              </h3>
              <button
                onClick={() => {
                  setShowConditionModal(false);
                  setCurrentMappingForCondition(null);
                  setEditingConditions([]);
                }}
                className={`${lightMode ? 'text-gray-400 hover:text-gray-600' : 'text-slate-400 hover:text-white'} transition`}
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <p className={`text-sm mb-4 ${lightMode ? 'text-gray-600' : 'text-slate-400'}`}>
                Lägg till villkor för att filtrera vilka källelement som ska mappas. Alla villkor måste vara uppfyllda (AND-logik).
              </p>

              {editingConditions.length === 0 ? (
                <div className={`text-center py-8 ${lightMode ? 'text-gray-400' : 'text-slate-500'}`}>
                  <p>Inga villkor tillagda ännu</p>
                  <p className="text-xs mt-2">Klicka på "Lägg till villkor" nedan</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {editingConditions.map((condition, index) => (
                    <div
                      key={index}
                      className={`p-4 rounded-lg border ${
                        lightMode
                          ? 'bg-amber-50 border-amber-200'
                          : 'bg-amber-900 bg-opacity-20 border-amber-700'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 space-y-3">
                          <div>
                            <label className={`text-xs font-medium block mb-1 ${lightMode ? 'text-gray-700' : 'text-slate-300'}`}>
                              Fält
                            </label>
                            <select
                              value={condition.field}
                              onChange={(e) => {
                                const newConditions = [...editingConditions];
                                newConditions[index] = { ...condition, field: e.target.value };
                                setEditingConditions(newConditions);
                              }}
                              className={`w-full px-3 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                                lightMode
                                  ? 'bg-white border-gray-300 text-gray-900'
                                  : 'bg-slate-700 border-slate-600 text-white'
                              }`}
                            >
                              <option value="@name">@name (attribut)</option>
                              <option value="@dataType">@dataType (attribut)</option>
                              <option value="value">value (elementvärde)</option>
                              <option value="property">property (egenskap)</option>
                              <option value="@id">@id (attribut)</option>
                              <option value="@type">@type (attribut)</option>
                            </select>
                          </div>

                          <div>
                            <label className={`text-xs font-medium block mb-1 ${lightMode ? 'text-gray-700' : 'text-slate-300'}`}>
                              Operator
                            </label>
                            <select
                              value={condition.operator}
                              onChange={(e) => {
                                const newConditions = [...editingConditions];
                                newConditions[index] = {
                                  ...condition,
                                  operator: e.target.value,
                                  value: e.target.value === 'exists' ? null : condition.value
                                };
                                setEditingConditions(newConditions);
                              }}
                              className={`w-full px-3 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                                lightMode
                                  ? 'bg-white border-gray-300 text-gray-900'
                                  : 'bg-slate-700 border-slate-600 text-white'
                              }`}
                            >
                              <option value="equals">= (lika med)</option>
                              <option value="contains">innehåller</option>
                              <option value="startswith">börjar med</option>
                              <option value="regex">regex (reguljärt uttryck)</option>
                              <option value="exists">existerar (finns)</option>
                            </select>
                          </div>

                          {condition.operator !== 'exists' && (
                            <div>
                              <label className={`text-xs font-medium block mb-1 ${lightMode ? 'text-gray-700' : 'text-slate-300'}`}>
                                Värde
                              </label>
                              <input
                                type="text"
                                value={condition.value || ''}
                                onChange={(e) => {
                                  const newConditions = [...editingConditions];
                                  newConditions[index] = { ...condition, value: e.target.value };
                                  setEditingConditions(newConditions);
                                }}
                                placeholder={condition.operator === 'regex' ? 't.ex. ^[A-Z].*' : 'Ange värde'}
                                className={`w-full px-3 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                                  condition.operator === 'regex' ? 'font-mono' : ''
                                } ${
                                  lightMode
                                    ? 'bg-white border-gray-300 text-gray-900'
                                    : 'bg-slate-700 border-slate-600 text-white'
                                }`}
                              />
                            </div>
                          )}
                        </div>

                        <button
                          onClick={() => {
                            const newConditions = editingConditions.filter((_, i) => i !== index);
                            setEditingConditions(newConditions);
                          }}
                          className={`mt-6 p-2 rounded-lg transition ${
                            lightMode
                              ? 'text-red-600 hover:bg-red-50'
                              : 'text-red-400 hover:bg-red-900 hover:bg-opacity-20'
                          }`}
                          title="Ta bort villkor"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>

                      {/* Preview of condition */}
                      <div className={`mt-3 pt-3 border-t text-xs ${
                        lightMode ? 'border-amber-200 text-amber-700' : 'border-amber-700 text-amber-300'
                      }`}>
                        <span className="font-mono">
                          {condition.field} {condition.operator === 'equals' ? '=' : condition.operator} {condition.operator !== 'exists' ? `"${condition.value || ''}"` : '(finns)'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => {
                  setEditingConditions([
                    ...editingConditions,
                    { field: '@name', operator: 'equals', value: '' }
                  ]);
                }}
                className={`mt-4 w-full px-4 py-2 rounded-lg text-sm font-medium border-2 border-dashed transition ${
                  lightMode
                    ? 'border-gray-300 hover:border-amber-400 hover:bg-amber-50 text-gray-700'
                    : 'border-slate-600 hover:border-amber-500 hover:bg-amber-900 hover:bg-opacity-20 text-slate-300'
                }`}
              >
                + Lägg till villkor
              </button>
            </div>

            <div className={`px-6 py-4 ${lightMode ? 'border-gray-200' : 'border-slate-700'} border-t flex gap-3`}>
              <button
                onClick={() => {
                  setShowConditionModal(false);
                  setCurrentMappingForCondition(null);
                  setEditingConditions([]);
                }}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition ${
                  lightMode
                    ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                Avbryt
              </button>
              <button
                onClick={() => {
                  // Validate conditions before saving
                  const validConditions = editingConditions.filter(c =>
                    c.field && c.operator && (c.operator === 'exists' || c.value)
                  );

                  saveConditions(currentMappingForCondition, validConditions.length > 0 ? validConditions : null);
                  setShowConditionModal(false);
                  setCurrentMappingForCondition(null);
                  setEditingConditions([]);
                }}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-amber-600 to-amber-400 hover:from-amber-700 hover:to-amber-500 text-white transition"
              >
                Spara villkor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Constant Modal */}
      {showConstantModal && (
        <div
          className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 "
          onClick={() => {
            setShowConstantModal(false);
            setEditingConstantId(null);
            setConstantName('');
            setConstantValue('');
          }}
        >
          <div
            className="bg-slate-800 rounded-lg w-96 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                {editingConstantId ? 'Redigera fast värde' : 'Nytt fast värde'}
              </h3>
              <button
                onClick={() => {
                  setShowConstantModal(false);
                  setEditingConstantId(null);
                  setConstantName('');
                  setConstantValue('');
                }}
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
                  onClick={() => {
                    setShowConstantModal(false);
                    setEditingConstantId(null);
                    setConstantName('');
                    setConstantValue('');
                  }}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm"
                >
                  Avbryt
                </button>
                <button
                  onClick={createConstant}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded text-sm"
                >
                  {editingConstantId ? 'Uppdatera' : 'Skapa'}
                </button>
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
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm flex items-center gap-1"
                >
                  <Download className="w-4 h-4" />
                  Ladda ner
                </button>
                <button
                  onClick={clearLogs}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-sm flex items-center gap-1"
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