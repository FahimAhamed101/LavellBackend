const ABSOLUTE_URL_PATTERN = /^(?:https?:)?\/\//i;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;
const UPLOADS_SEGMENT = '/uploads/';

const getBaseUrl = (req) => {
  const forwardedProtoHeader = req.headers['x-forwarded-proto'];
  const forwardedProto = typeof forwardedProtoHeader === 'string'
    ? forwardedProtoHeader.split(',')[0].trim()
    : req.protocol;
  const host = req.get('host');

  if (!host) {
    return '';
  }

  return `${forwardedProto || 'http'}://${host}`;
};

const normalizeImagePath = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  if (ABSOLUTE_URL_PATTERN.test(trimmedValue)) {
    return trimmedValue.startsWith('//') ? `https:${trimmedValue}` : trimmedValue;
  }

  let normalizedValue = trimmedValue.replace(/\\/g, '/');

  if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(trimmedValue)) {
    const lowerCasedValue = normalizedValue.toLowerCase();
    const uploadsIndex = lowerCasedValue.lastIndexOf(UPLOADS_SEGMENT);
    if (uploadsIndex !== -1) {
      normalizedValue = normalizedValue.slice(uploadsIndex);
    }
  }

  const lowerCasedValue = normalizedValue.toLowerCase();
  const uploadsIndex = lowerCasedValue.lastIndexOf(UPLOADS_SEGMENT);

  if (uploadsIndex !== -1) {
    return normalizedValue.slice(uploadsIndex);
  }

  if (lowerCasedValue.startsWith('uploads/')) {
    return `/${normalizedValue}`;
  }

  if (normalizedValue.startsWith('/')) {
    return normalizedValue;
  }

  return `/uploads/${normalizedValue}`;
};

const buildImageUrl = (req, value) => {
  const normalizedValue = normalizeImagePath(value);
  if (!normalizedValue) {
    return null;
  }

  if (ABSOLUTE_URL_PATTERN.test(normalizedValue)) {
    return normalizedValue;
  }

  const baseUrl = getBaseUrl(req);
  return baseUrl ? `${baseUrl}${normalizedValue}` : normalizedValue;
};

const buildImageUrls = (req, values) => {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => buildImageUrl(req, value))
    .filter((value) => Boolean(value));
};

module.exports = {
  buildImageUrl,
  buildImageUrls
};
