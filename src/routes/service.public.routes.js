const express = require('express');
const router = express.Router();
const serviceController = require('../controllers/serviceController');

/**
 * PUBLIC ROUTES - For users to view services
 * No authentication required
 */

/**
 * @route   GET /api/services
 * @desc    Get all active services with filters
 * @access  Public
 * @query   category, minPrice, maxPrice, sortBy, order, page, limit, search
 */
router.get('/', serviceController.getAllServices);

/**
 * @route   GET /api/services/category/:categoryId
 * @desc    Get services by category
 * @access  Public
 */
router.get('/category/:categoryId', serviceController.getServicesByCategory);

/**
 * @route   GET /api/services/:id
 * @desc    Get single service by ID
 * @access  Public
 */
router.get('/:id', serviceController.getServiceById);

module.exports = router;
