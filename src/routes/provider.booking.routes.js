const express = require('express');
const router = express.Router();
const providerBookingController = require('../controllers/providerBookingController');
const auth = require('../middleware/auth');

/**
 * PROVIDER BOOKING MANAGEMENT ROUTES
 * All routes require authentication
 */

// ==================== STATISTICS ====================

/**
 * @route   GET /api/providers/bookings/stats
 * @desc    Get provider's booking and appointment statistics
 * @access  Private (Provider)
 */
router.get('/stats', auth, providerBookingController.getProviderStats);

// ==================== BOOKING ROUTES ====================

/**
 * @route   GET /api/providers/bookings
 * @desc    Get all bookings for provider's services
 * @access  Private (Provider)
 * @query   status, page, limit
 */
router.get('/', auth, providerBookingController.getProviderBookings);

/**
 * @route   GET /api/providers/bookings/transactions
 * @desc    Get provider transaction history (bookings + appointments)
 * @access  Private (Provider)
 * @query   status, source, page, limit, search, from, to
 */
router.get('/transactions', auth, providerBookingController.getProviderTransactions);

/**
 * @route   GET /api/providers/bookings/:id
 * @desc    Get single booking details
 * @access  Private (Provider)
 */
router.get('/:id', auth, providerBookingController.getBookingDetails);

/**
 * @route   GET /api/providers/bookings/:id/payment-status
 * @desc    Get payment status for a booking (provider)
 * @access  Private (Provider)
 */
router.get('/:id/payment-status', auth, providerBookingController.getProviderBookingPaymentStatus);

/**
 * @route   PATCH /api/providers/bookings/:id/accept
 * @desc    Accept/Confirm a booking request
 * @access  Private (Provider)
 * @body    { providerNotes } (optional)
 */
router.patch('/:id/accept', auth, providerBookingController.acceptBooking);

/**
 * @route   PATCH /api/providers/bookings/:id/reject
 * @desc    Reject/Cancel a booking request
 * @access  Private (Provider)
 * @body    { cancellationReason }
 */
router.patch('/:id/reject', auth, providerBookingController.rejectBooking);

/**
 * @route   PATCH /api/providers/bookings/:id/start
 * @desc    Mark booking as in progress
 * @access  Private (Provider)
 */
router.patch('/:id/start', auth, providerBookingController.startBooking);

/**
 * @route   PATCH /api/providers/bookings/:id/complete
 * @desc    Mark booking as completed
 * @access  Private (Provider)
 */
router.patch('/:id/complete', auth, providerBookingController.completeBooking);

/**
 * @route   POST /api/providers/bookings/:id/request-due
 * @desc    Request due payment after completion
 * @access  Private (Provider)
 */
router.post('/:id/request-due', auth, providerBookingController.requestDuePayment);

/**
 * @route   POST /api/providers/bookings/:id/mark-offline-paid
 * @desc    Mark due payment as paid offline
 * @access  Private (Provider)
 */
router.post('/:id/mark-offline-paid', auth, providerBookingController.markOfflinePaid);

module.exports = router;
