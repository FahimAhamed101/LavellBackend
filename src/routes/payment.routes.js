const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

/**
 * @route   GET /api/payments/config
 * @desc    Get Stripe client configuration
 * @access  Public
 */
router.get('/config', paymentController.getPaymentConfig);

module.exports = router;
