const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const categoryController = require('../controllers/categoryController');
const serviceController = require('../controllers/serviceController');
const businessOwnerController = require('../controllers/businessOwnerController');

/**
 * USER ROUTES - Authenticated user endpoints
 * All routes require Bearer token authentication
 */

/**
 * @route   GET /api/user/categories
 * @desc    Get all active categories for authenticated users
 * @access  Private (Requires user authentication)
 * @query   parentOnly=true (optional) - Only show parent categories
 */
router.get('/categories', auth, categoryController.getAllCategoriesForUser);

/**
 * @route   GET /api/user/categories/:slug
 * @desc    Get category by slug for authenticated users
 * @access  Private (Requires user authentication)
 */
router.get('/categories/:slug', auth, categoryController.getCategoryBySlug);

/**
 * @route   GET /api/user/services/:id
 * @desc    Get service details with provider info (authenticated user)
 * @access  Private (Requires user authentication)
 */
router.get('/services/:id', auth, serviceController.getServiceDetailForUser);

/**
 * @route   GET /api/user/providers/:providerId/profile
 * @desc    Get provider profile with services, reviews, and portfolio (authenticated user)
 * @access  Private (Requires user authentication)
 */
router.get('/providers/:providerId/profile', auth, serviceController.getProviderProfileForUser);

/**
 * @route   GET /api/user/top-businesses
 * @desc    Get top businesses by rating
 * @access  Private (Requires user authentication)
 */
router.get('/top-businesses', auth, businessOwnerController.getTopBusinesses);

/**
 * @route   GET /api/user/business-owner-profiles
 * @desc    Get all business owner role profiles for authenticated users
 * @access  Private (Requires user authentication)
 */
router.get(
  '/business-owner-profiles',
  auth,
  businessOwnerController.getAllBusinessOwnerProfiles
);

/**
 * @route   GET /api/user/businesses/:businessOwnerId/details
 * @desc    Get business details with team, services, reviews
 * @access  Private (Requires user authentication)
 */
router.get('/businesses/:businessOwnerId/details', auth, businessOwnerController.getBusinessDetailsForUser);

/**
 * @route   GET /api/user/employees/:employeeId/profile
 * @desc    Get employee profile with services and reviews
 * @access  Private (Requires user authentication)
 */
router.get('/employees/:employeeId/profile', auth, businessOwnerController.getEmployeeProfileForUser);

module.exports = router;
