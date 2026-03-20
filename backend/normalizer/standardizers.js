/**
 * Standardizers — Reusable data standardization functions
 * Normalizes raw CRM field values into consistent formats
 */

// ---- PHONE (E.164) ----
export function standardizePhone(raw) {
  if (!raw || typeof raw !== 'string') return null;

  // Strip everything except digits and leading +
  let digits = raw.replace(/[^\d+]/g, '');
  
  // If no digits remain, return null
  if (!digits || digits.replace(/\+/g, '').length === 0) return null;
  
  // Remove leading + for processing
  const hasPlus = digits.startsWith('+');
  digits = digits.replace(/^\+/, '');
  
  // If 10 digits, assume US/CA and prepend 1
  if (digits.length === 10) {
    digits = '1' + digits;
  }
  
  // If 11+ digits, format as E.164
  if (digits.length >= 7 && digits.length <= 15) {
    return '+' + digits;
  }
  
  // Return cleaned version even if not perfect E.164
  return hasPlus ? '+' + digits : digits;
}

// ---- EMAIL ----
export function standardizeEmail(raw) {
  if (!raw || typeof raw !== 'string') return null;
  
  const cleaned = raw.trim().toLowerCase();
  
  // Basic RFC-5322 validation
  const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!pattern.test(cleaned)) return null;
  
  return cleaned;
}

/**
 * Validate email format without modifying it
 */
export function isValidEmail(email) {
  if (!email) return false;
  const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return pattern.test(email);
}

// ---- NAME ----
export function standardizeName(raw) {
  if (!raw || typeof raw !== 'string') return null;
  
  const trimmed = raw.trim();
  if (!trimmed) return null;
  
  // Title Case: capitalize first letter of each word
  return trimmed
    .toLowerCase()
    .replace(/(?:^|\s|[-'])\w/g, char => char.toUpperCase());
}

/**
 * Split a full name into first + last
 */
export function splitFullName(fullName) {
  if (!fullName || typeof fullName !== 'string') {
    return { firstName: null, lastName: null };
  }
  
  const parts = fullName.trim().split(/\s+/);
  
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  };
}

// ---- ADDRESS ----
export function standardizeAddress(raw) {
  if (!raw) return null;
  
  // If it's already a structured object, normalize its fields
  if (typeof raw === 'object') {
    return {
      street:  raw.street  || raw.Street  || raw.line1     || raw.address_line_1 || null,
      city:    raw.city    || raw.City    || null,
      state:   raw.state   || raw.State   || raw.province  || raw.region         || null,
      zip:     raw.zip     || raw.Zip     || raw.postal_code || raw.postalCode   || null,
      country: raw.country || raw.Country || raw.country_code || null,
    };
  }
  
  // If it's a string, store as street and leave rest null
  if (typeof raw === 'string') {
    return {
      street: raw.trim(),
      city: null,
      state: null,
      zip: null,
      country: null,
    };
  }
  
  return null;
}

// ---- CURRENCY ----
const CURRENCY_ALIASES = {
  '$': 'USD', 'usd': 'USD', 'dollar': 'USD', 'dollars': 'USD',
  '€': 'EUR', 'eur': 'EUR', 'euro': 'EUR', 'euros': 'EUR',
  '£': 'GBP', 'gbp': 'GBP', 'pound': 'GBP',
  '¥': 'JPY', 'jpy': 'JPY', 'yen': 'JPY',
  '₹': 'INR', 'inr': 'INR', 'rupee': 'INR', 'rupees': 'INR',
  'cad': 'CAD', 'aud': 'AUD', 'chf': 'CHF', 'cny': 'CNY',
};

export function standardizeCurrency(raw) {
  if (!raw || typeof raw !== 'string') return null;
  
  const cleaned = raw.trim().toLowerCase();
  
  // Check aliases
  if (CURRENCY_ALIASES[cleaned]) return CURRENCY_ALIASES[cleaned];
  
  // If it's already a 3-letter ISO code
  if (/^[a-z]{3}$/i.test(cleaned)) return cleaned.toUpperCase();
  
  return null;
}

// ---- DATE (ISO 8601) ----
export function standardizeDate(raw) {
  if (!raw) return null;
  
  // If it's already a Date object
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : raw.toISOString();
  }
  
  // If it's a Unix timestamp (seconds)
  if (typeof raw === 'number') {
    // If > year 2100 in seconds, assume milliseconds
    const ms = raw > 4102444800 ? raw : raw * 1000;
    const date = new Date(ms);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }
  
  if (typeof raw !== 'string') return null;
  
  const trimmed = raw.trim();
  if (!trimmed) return null;
  
  // Try parsing as-is
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) return parsed.toISOString();
  
  // Try common formats: MM/DD/YYYY, DD/MM/YYYY
  const slashParts = trimmed.split('/');
  if (slashParts.length === 3) {
    const [a, b, c] = slashParts.map(Number);
    // If first part > 12, treat as DD/MM/YYYY
    if (a > 12) {
      const date = new Date(c, b - 1, a);
      if (!isNaN(date.getTime())) return date.toISOString();
    } else {
      // Assume MM/DD/YYYY
      const date = new Date(c, a - 1, b);
      if (!isNaN(date.getTime())) return date.toISOString();
    }
  }
  
  return null;
}

// ---- DOMAIN ----
export function standardizeDomain(raw) {
  if (!raw || typeof raw !== 'string') return null;
  
  let domain = raw.trim().toLowerCase();
  
  // Strip protocol
  domain = domain.replace(/^https?:\/\//i, '');
  
  // Strip trailing slash
  domain = domain.replace(/\/.*$/, '');
  
  // Strip www.
  domain = domain.replace(/^www\./i, '');
  
  return domain || null;
}

// ---- TRANSFORM DISPATCHER ----
const TRANSFORM_MAP = {
  direct:          (v) => v,
  lowercase:       (v) => typeof v === 'string' ? v.trim().toLowerCase() : v,
  titlecase:       standardizeName,
  phone_e164:      standardizePhone,
  email_normalize: standardizeEmail,
  date_iso:        standardizeDate,
  currency_iso:    standardizeCurrency,
  json_extract:    (v) => v,  // handled at field resolution level
  concat:          (v) => v,  // handled at field resolution level
  custom:          (v) => v,  // handled by external functions
};

/**
 * Apply a named transform to a value
 */
export function applyTransform(transformType, value, config = {}) {
  const fn = TRANSFORM_MAP[transformType];
  if (!fn) {
    console.warn(`Unknown transform type: ${transformType}`);
    return value;
  }
  return fn(value, config);
}

/**
 * Resolve a nested field path from an object
 * Supports dot notation and array indexing: "properties.email.value", "email[0].value"
 */
export function resolveFieldPath(obj, path) {
  if (!obj || !path) return undefined;
  
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  
  return current;
}
