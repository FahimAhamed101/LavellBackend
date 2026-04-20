const express = require('express');
const router = express.Router();
const providerController = require('../controllers/providerController');
const { uploadIdCards, uploadProfilePicture, uploadPortfolioImages, handleUploadError } = require('../middleware/upload');
const auth = require('../middleware/auth');

/**
 * @route   POST /api/providers/register
 * @desc    Register a new provider with ID card verification
 * @access  Public
 */
router.post(
  '/register',
  uploadIdCards,
  handleUploadError,
  providerController.registerProvider
);

/**
 * @route   POST /api/providers/register/verify-otp
 * @desc    Verify provider registration OTP
 * @access  Public
 */
router.post('/register/verify-otp', providerController.verifyProviderRegistrationOTP);

/**
 * @route   POST /api/providers/login
 * @desc    Login provider
 * @access  Public
 */
router.post('/login', providerController.loginProvider);

/**
 * @route   POST /api/providers/logout
 * @desc    Logout provider (revoke refresh token)
 * @access  Public
 */
router.post('/logout', providerController.logout);

/**
 * @route   POST /api/providers/logout-all
 * @desc    Logout provider from all devices
 * @access  Private (Provider only)
 */
router.post('/logout-all', auth, providerController.logoutAll);

/**
 * @route   POST /api/providers/forgot-password
 * @desc    Send OTP for provider password reset
 * @access  Public
 */
router.post('/forgot-password', providerController.forgotPassword);

/**
 * @route   POST /api/providers/verify-otp
 * @desc    Verify OTP for provider password reset
 * @access  Public
 */
router.post('/verify-otp', providerController.verifyOTP);

/**
 * @route   POST /api/providers/reset-password
 * @desc    Reset provider password using reset token
 * @access  Public
 */
router.post('/reset-password', providerController.resetPasswordWithOTP);

/**
 * @route   GET /api/providers/me
 * @desc    Get current provider profile
 * @access  Private (Provider only)
 */
router.get('/me', auth, providerController.getProviderProfile);

/**
 * @route   PUT /api/providers/me
 * @desc    Update current provider profile
 * @access  Private (Provider only)
 */
router.put('/me', auth, uploadProfilePicture, handleUploadError, providerController.updateProviderProfile);

/**
 * @route   POST /api/providers/change-password
 * @desc    Change provider password
 * @access  Private (Provider only)
 */
router.post('/change-password', auth, providerController.changePassword);

/**
 * @route   POST /api/providers/portfolio
 * @desc    Add a new portfolio item
 * @access  Private (Provider only)
 */
router.post(
  '/portfolio',
  auth,
  uploadPortfolioImages,
  handleUploadError,
  providerController.addPortfolioItem
);

/**
 * @route   GET /api/providers/portfolio
 * @desc    Get all portfolio items for current provider
 * @access  Private (Provider only)
 */
router.get('/portfolio', auth, providerController.getMyPortfolio);

/**
 * @route   GET /api/providers/portfolio/:id
 * @desc    Get single portfolio item
 * @access  Private (Provider only)
 */
router.get('/portfolio/:id', auth, providerController.getPortfolioItem);

/**
 * @route   PUT /api/providers/portfolio/:id
 * @desc    Update portfolio item
 * @access  Private (Provider only)
 */
router.put(
  '/portfolio/:id',
  auth,
  uploadPortfolioImages,
  handleUploadError,
  providerController.updatePortfolioItem
);

/**
 * @route   DELETE /api/providers/portfolio/:id
 * @desc    Delete portfolio item
 * @access  Private (Provider only)
 */
router.delete('/portfolio/:id', auth, providerController.deletePortfolioItem);

/**
 * @route   GET /api/providers/:providerId/portfolio
 * @desc    Get public portfolio for a provider (for users to view)
 * @access  Public
 */
router.get('/:providerId/portfolio', providerController.getProviderPortfolio);

module.exports = router;
