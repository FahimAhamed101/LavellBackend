const jwt = require('jsonwebtoken');

// Legacy function for backward compatibility
const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

// Generate access token (short-lived)
const generateAccessToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m'
  });
};

// Generate refresh token (long-lived)
const generateRefreshToken = (payload) => {
  return jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
    }
  );
};

// Verify access token
const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};

// Verify refresh token
const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
};

// Get token expiration time in seconds
const getTokenExpiresIn = (type = 'access') => {
  if (type === 'refresh') {
    const expires = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
    return parseExpiration(expires);
  }
  const expires = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
  return parseExpiration(expires);
};

// Parse expiration string to seconds
const parseExpiration = (expiresIn) => {
  const regex = /^(\d+)([smhd])$/;
  const match = expiresIn.match(regex);

  if (!match) return 900; // Default 15 minutes

  const value = parseInt(match[1]);
  const unit = match[2];

  const multipliers = {
    's': 1,
    'm': 60,
    'h': 3600,
    'd': 86400
  };

  return value * (multipliers[unit] || 60);
};

module.exports = {
  generateToken,
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  verifyRefreshToken,
  getTokenExpiresIn
};