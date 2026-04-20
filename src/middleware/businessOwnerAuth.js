const { verifyToken } = require('../utility/jwt');
const User = require('../models/User');
const BusinessOwner = require('../models/BusinessOwner');

/**
 * Middleware to authenticate Business Owners only
 * Verifies JWT token and ensures user has a business owner profile
 */
const businessOwnerAuth = async (req, res, next) => {
  try {
    // First, extract and verify token
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    // Verify token
    const decoded = verifyToken(token);

    // Find user
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Token is invalid.'
      });
    }

    // Check if user account is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated.'
      });
    }

    // Check if user is a business owner
    if (user.userType !== 'businessOwner') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only business owners can access this resource.'
      });
    }

    // Verify business owner profile exists
    const businessOwner = await BusinessOwner.findOne({ userId: user._id });

    if (!businessOwner) {
      return res.status(403).json({
        success: false,
        message: 'Business owner profile not found.'
      });
    }

    // Attach user and business owner to request
    req.user = user;
    req.businessOwner = businessOwner;

    next();
  } catch (error) {
    // Handle specific JWT errors
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired. Please refresh your token.',
        code: 'TOKEN_EXPIRED'
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Token is invalid.',
        code: 'TOKEN_INVALID'
      });
    }

    res.status(401).json({
      success: false,
      message: 'Authentication failed.',
      code: 'AUTH_FAILED'
    });
  }
};

module.exports = businessOwnerAuth;
