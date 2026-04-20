const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

/**
 * Middleware to verify admin JWT token
 */
const verifyAdminToken = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if it's an admin token
    if (!decoded.adminId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Invalid token type.'
      });
    }

    // Get admin from database
    const admin = await Admin.findById(decoded.adminId);

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Admin not found. Token is invalid.'
      });
    }

    // Check if admin is active
    if (!admin.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your admin account has been deactivated.'
      });
    }

    // Attach admin to request
    req.admin = admin;
    next();

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired.'
      });
    }

    console.error('Admin auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

/**
 * Middleware to check specific admin permissions
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
    }

    // Super-admin has all permissions
    if (req.admin.role === 'super-admin') {
      return next();
    }

    // Check specific permission
    if (!req.admin.permissions[permission]) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to perform this action.'
      });
    }

    next();
  };
};

/**
 * Middleware to require super-admin role
 */
const requireSuperAdmin = (req, res, next) => {
  if (!req.admin) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.'
    });
  }

  if (req.admin.role !== 'super-admin') {
    return res.status(403).json({
      success: false,
      message: 'Only super-admins can perform this action.'
    });
  }

  next();
};

module.exports = {
  verifyAdminToken,
  requirePermission,
  requireSuperAdmin
};
