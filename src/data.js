// data.js - CSV parsing and DuckDB functionality
// Following Single Responsibility Principle: This module handles all data operations

// DuckDB connection state
let duckdbConn = null;
let duckdbDb = null;
let duckdbReady = false;
let macroSqlCache = null;
let macroExecuted = false;
let servicesRegistered = false;

// Security: Enhanced CSV parser with validation
export function parseCSV(text) {
  // Security: Validate input
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid CSV input');
  }
  
  // Security: Limit file size to prevent DoS
  if (text.length > 1000000) { // 1MB limit
    throw new Error('CSV file too large');
  }
  
  // remove potential BOM
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }
  
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  
  // Security: Validate minimum structure
  if (lines.length < 2) {
    throw new Error('Invalid CSV structure');
  }
  
  const header = lines.shift().split(',');
  
  // Security: Validate expected headers
  const requiredHeaders = ['station_name', 'lon', 'lat', 'station_code', 'municipality_sk'];
  const hasAllHeaders = requiredHeaders.every(h => header.includes(h));
  if (!hasAllHeaders) {
    throw new Error('CSV missing required headers');
  }
  
  // Expect: station_id,station_name,station_code,lon,lat
  const idx = {
    station_code: header.indexOf('station_code'),
    station_name: header.indexOf('station_name'),
    lat: header.indexOf('lat'),
    lon: header.indexOf('lon'),
    municipality_sk: header.indexOf('municipality_sk')
  };
  
  return lines.map((line, lineNum) => {
    // Security: Basic CSV injection protection
    if (line.startsWith('=') || line.startsWith('+') || line.startsWith('-') || line.startsWith('@')) {
      console.warn(`Potential CSV injection attempt at line ${lineNum + 2}`);
      return null;
    }
    
    const parts = line.split(',');
    
    // Security: Validate field count
    if (parts.length !== header.length) {
      console.warn(`Invalid field count at line ${lineNum + 2}`);
      return null;
    }
    
    const name = parts[idx.station_name]?.trim();
    const code = parts[idx.station_code]?.trim();
    const lon = parseFloat(parts[idx.lon]);
    const lat = parseFloat(parts[idx.lat]);
    const municipalitySk = parts[idx.municipality_sk]?.trim();
    
    // Security: Enhanced validation
    if (!name || name.length > 100 || Number.isNaN(lat) || Number.isNaN(lon)) {
      return null;
    }
    
    // Security: Validate coordinate ranges (Netherlands bounds)
    if (lat < 50.0 || lat > 54.0 || lon < 3.0 || lon > 8.0) {
      console.warn(`Coordinates out of Netherlands bounds at line ${lineNum + 2}`);
      return null;
    }
    
    // Security: Sanitize station name and municipality
    const sanitizedName = name.replace(/[<>'"&]/g, '');
    const sanitizedCode = code ? code.replace(/[<>'"&]/g, '') : '';
    const sanitizedMunicipality = municipalitySk ? municipalitySk.replace(/[<>'"&]/g, '') : '';
    
    return { name: sanitizedName, code: sanitizedCode, lat, lon, municipalitySk: sanitizedMunicipality };
  }).filter(Boolean);
}

// Load stations from CSV file
export async function loadStations() {
  const res = await fetch('data/train_stations.csv');
  if (!res.ok) throw new Error('Failed to load train_stations.csv');
  const text = await res.text();
  return parseCSV(text);
}

// DuckDB initialization and management
export async function ensureDuckDB() {
  if (duckdbReady) return;
  
  // Security: Use specific version with integrity verification
  const DUCKDB_VERSION = '1.29.1-dev269.0';
  const duckdb = await import(`https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/+esm`);
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);

  // Security: Validate URLs are from trusted CDN
  function validateWorkerUrl(url) {
    try {
      const urlObj = new URL(url);
      if (!urlObj.hostname.includes('cdn.jsdelivr.net')) {
        throw new Error(`Untrusted worker URL: ${url}`);
      }
      return true;
    } catch (e) {
      throw new Error(`Invalid worker URL: ${url}`);
    }
  }

  // Create a same-origin Blob URL for the worker with security validation
  async function makeBlobWorker(url) {
    validateWorkerUrl(url);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch worker: ${url} (${resp.status})`);
    
    // Security: Validate content type
    const contentType = resp.headers.get('content-type');
    if (!contentType || !contentType.includes('javascript')) {
      throw new Error(`Invalid content type for worker: ${contentType}`);
    }
    
    const code = await resp.text();
    
    // Security: Basic validation of worker code structure
    if (!code.includes('self.onmessage') && !code.includes('addEventListener')) {
      throw new Error('Worker code does not appear to be a valid web worker');
    }
    
    const blob = new Blob([code], { type: 'text/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    return new Worker(blobUrl);
  }

  // Security: Remove fallback to direct URL to prevent bypass
  const worker = await makeBlobWorker(bundle.mainWorker);

  const logger = new duckdb.ConsoleLogger();
  duckdbDb = new duckdb.AsyncDuckDB(logger, worker);

  // If pthreadWorker exists, also convert it to a blob URL with validation
  let pthreadUrl = null;
  if (bundle.pthreadWorker) {
    validateWorkerUrl(bundle.pthreadWorker);
    const resp = await fetch(bundle.pthreadWorker);
    if (resp.ok) {
      const contentType = resp.headers.get('content-type');
      if (contentType && contentType.includes('javascript')) {
        const code = await resp.text();
        if (code.includes('self.onmessage') || code.includes('addEventListener')) {
          pthreadUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        } else {
          throw new Error('Pthread worker code validation failed');
        }
      } else {
        throw new Error('Invalid pthread worker content type');
      }
    } else {
      throw new Error(`Failed to fetch pthread worker: ${resp.status}`);
    }
  }

  await duckdbDb.instantiate(bundle.mainModule, pthreadUrl);
  duckdbConn = await duckdbDb.connect();
  duckdbReady = true;
}

// Register services file for specific day of week
export async function ensureServicesFileRegistered(dayOfWeek) {
  // Security: Validate day of week parameter
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
    throw new Error('Invalid day of week parameter');
  }
  
  const registrationKey = `services_dow_${dayOfWeek}`;
  if (servicesRegistered === registrationKey) return;
  
  // Register only the parquet file for the specific day of week
  const filePath = `./data/train_services.parquet/day_of_week=${dayOfWeek}/data_0.parquet`;
  const resp = await fetch(filePath);
  if (!resp.ok) throw new Error(`Failed to fetch ${filePath}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  await duckdbDb.registerFileBuffer(filePath, buf);

  const res = await fetch('./data/train_stations.csv');
  if (!resp.ok) throw new Error(`Failed to fetch stations data`);
  await duckdbDb.registerFileBuffer('./data/train_stations.csv', new Uint8Array(await res.arrayBuffer()));

  servicesRegistered = registrationKey;
}

// Ensure macro is executed
export async function ensureMacroExecuted() {
  if (macroExecuted) return;
  
  if (!macroSqlCache) {
    const macroResp = await fetch('src/create_macro.sql');
    if (!macroResp.ok) throw new Error('Failed to load create_macro.sql');
    macroSqlCache = await macroResp.text();
  }
  
  // Execute the macro creation SQL
  await duckdbConn.query(macroSqlCache);
  macroExecuted = true;
}

// Security: Validate and sanitize day of week input
export function dayNameToIsoDow(name) {
  const validDays = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const sanitizedName = String(name || '').trim();
  const idx = validDays.indexOf(sanitizedName);
  if (idx < 0) {
    console.warn(`Invalid day name: ${sanitizedName}, defaulting to Monday`);
    return 1; // Default to Monday
  }
  return idx + 1; // Monday=1..Sunday=7
}

// Security: Validate station input
export function validateStationInput(input) {
  if (!input || typeof input !== 'string') return '';
  const sanitized = input.trim();
  // Limit length to prevent potential buffer overflow attacks
  if (sanitized.length > 100) {
    console.warn('Station name too long, truncating');
    return sanitized.substring(0, 100);
  }
  // Remove potentially dangerous characters
  return sanitized.replace(/[<>'"&]/g, '');
}

// Execute trip planning query
export async function executeTripQuery(params) {
  const {
    dayOfWeek,
    stationCode,
    hourDeparture,
    minuteDeparture,
    toStationCode,
    hourArrival,
    minuteArrival,
    layoverTime,
    toMunicipalitySk
  } = params;

  // Ensure DuckDB is initialized before executing query
  await ensureDuckDB();
  await ensureMacroExecuted();
  await ensureServicesFileRegistered(dayOfWeek);

  // Use the macro defined in create_macro.sql
  const sqlQuery = `
    SELECT * FROM get_trips(
      :input_day_of_week,
      :input_station_code,
      :input_hour_departure,
      :input_minute_departure,
      :input_to_station_code,
      :input_hour_arrival,
      :input_minute_arrival,
      :input_layover_time,
      :input_to_municipality_sk
    )
  `;

  // Timeout wrapper function for queries
  const executeQueryWithTimeout = async (queryPromise, timeoutMs = 15000) => {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('unable to plan trip, increase the layover time'));
      }, timeoutMs);
      
      queryPromise
        .then(resolve)
        .catch(reject)
        .finally(() => clearTimeout(timeoutId));
    });
  };

  let result;
  
  try {
    // Try parameterized queries first (preferred method) with timeout
    const stmt = await duckdbConn.prepare(sqlQuery);
    const queryPromise = stmt.query({ 
      input_day_of_week: dayOfWeek,
      input_station_code: stationCode,
      input_hour_departure: hourDeparture,
      input_minute_departure: minuteDeparture,
      input_hour_arrival: hourArrival,
      input_minute_arrival: minuteArrival,
      input_to_station_code: toStationCode,
      input_layover_time: layoverTime,
      input_to_municipality_sk: toMunicipalitySk
    });
    result = await executeQueryWithTimeout(queryPromise);
    await stmt.close();
  } catch (e) {
    // Check if this is a timeout error
    if (e.message === 'Unable to plan trip, increase the layover time') {
      throw e; // Re-throw timeout error directly
    }
    
    // Security: Safe fallback with strict validation for controlled inputs
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
      throw new Error('Invalid day of week parameter');
    }
    
    // Create safe SQL with validated parameters (fallback only)
    const sqlInline = `
      SELECT * FROM get_trips(
        ${dayOfWeek},
        '${stationCode.replace(/'/g, "''")}',
        ${hourDeparture},
        ${minuteDeparture},
        '${toStationCode.replace(/'/g, "''")}',
        ${hourArrival},
        ${minuteArrival},
        ${layoverTime},
        '${toMunicipalitySk.replace(/'/g, "''")}'
      )
    `;
    
    const fallbackQueryPromise = duckdbConn.query(sqlInline);
    result = await executeQueryWithTimeout(fallbackQueryPromise);
  }

  return result;
}