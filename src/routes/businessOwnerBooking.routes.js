const express = require('express');
const router = express.Router();
const businessOwnerBookingController = require('../controllers/businessOwnerBookingController');
const auth = require('../middleware/auth');

/**
 * @route   POST /api/business-owner-bookings
 * @desc    Create a booking for a business owner service
 * @access  Private (User)
 */
router.post('/', auth, businessOwnerBookingController.createBusinessOwnerBooking);

/**
 * @route   GET /api/business-owner-bookings/my-bookings
 * @desc    Get current user's business owner bookings
 * @access  Private (User)
 */
router.get('/my-bookings', auth, businessOwnerBookingController.getMyBusinessOwnerBookings);

/**
 * @route   GET /api/business-owner-bookings/:id/payment-status
 * @desc    Get payment status for a booking
 * @access  Private (User)
 */
router.get('/:id/payment-status', auth, businessOwnerBookingController.getBusinessOwnerBookingPaymentStatus);

/**
 * @route   GET /api/business-owner-bookings/:id/checkout-session
 * @desc    Get payment client secret for booking down payment
 * @access  Private (User)
 */
router.get('/:id/checkout-session', auth, businessOwnerBookingController.getBusinessOwnerBookingCheckoutSession);

/**
 * @route   GET /api/business-owner-bookings/:id/due/intent
 * @desc    Get due payment client secret
 * @access  Private (User)
 */
router.get('/:id/due/intent', auth, businessOwnerBookingController.getBusinessOwnerDuePaymentIntent);

/**
 * @route   POST /api/business-owner-bookings/:id/due/confirm
 * @desc    Confirm due payment
 * @access  Private (User)
 */
router.post('/:id/due/confirm', auth, businessOwnerBookingController.confirmBusinessOwnerDuePayment);

/**
 * @route   GET /api/business-owner-bookings/:id
 * @desc    Get business owner booking by ID
 * @access  Private (User)
 */
router.get('/:id', auth, businessOwnerBookingController.getBusinessOwnerBookingById);

/**
 * @route   PATCH /api/business-owner-bookings/:id/cancel
 * @desc    Cancel a business owner booking
 * @access  Private (User)
 */
router.patch('/:id/cancel', auth, businessOwnerBookingController.cancelBusinessOwnerBooking);

/**
 * @route   POST /api/business-owner-bookings/:id/review
 * @desc    Add review for a completed business owner booking
 * @access  Private (User)
 * @body    { rating, comment }
 */
router.post('/:id/review', auth, businessOwnerBookingController.addBusinessOwnerBookingReview);

module.exports = router;
