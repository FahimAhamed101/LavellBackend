const express = require('express');
const router = express.Router();
const serviceController = require('../controllers/serviceController');
const auth = require('../middleware/auth');
const { uploadServicePhoto, handleUploadError } = require('../middleware/upload');

/**
 * PROVIDER ROUTES - For providers to manage their services
 * All routes require authentication and provider role
 */

/**
 * @route   POST /api/providers/services
 * @desc    Create new service (with image upload)
 * @access  Private (Provider)
 */
router.post('/', auth, uploadServicePhoto, handleUploadError, serviceController.createService);

/**
 * @route   GET /api/providers/services
 * @desc    Get all services by current provider
 * @access  Private (Provider)
 */
router.get('/', auth, serviceController.getProviderServices);

/**
 * @route   GET /api/providers/services/:id
 * @desc    Get single service by ID (provider's own)
 * @access  Private (Provider)
 */
router.get('/:id', auth, serviceController.getProviderServiceById);

/**
 * @route   PUT /api/providers/services/:id
 * @desc    Update service
 * @access  Private (Provider)
 */
router.put('/:id', auth, uploadServicePhoto, handleUploadError, serviceController.updateService);

/**
 * @route   PUT /api/providers/services/:id/toggle-status
 * @desc    Toggle service active/inactive status
 * @access  Private (Provider)
 */
router.put('/:id/toggle-status', auth, serviceController.toggleServiceStatus);

/**
 * @route   DELETE /api/providers/services/:id
 * @desc    Delete service
 * @access  Private (Provider)
 */
router.delete('/:id', auth, serviceController.deleteService);

module.exports = router;
