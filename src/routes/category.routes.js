const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');

/**
 * PUBLIC ROUTES - For users to view categories
 */

/**
 * @route   GET /api/categories
 * @desc    Get all active categories (public)
 * @access  Public
 * @query   parentOnly=true (optional) - Only show parent categories
 */
router.get('/', categoryController.getAllCategories);

/**
 * @route   GET /api/categories/:slug
 * @desc    Get category by slug (public)
 * @access  Public
 */
router.get('/:slug', categoryController.getCategoryBySlug);

module.exports = router;
