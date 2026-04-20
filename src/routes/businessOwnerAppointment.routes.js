const express = require('express');
const router = express.Router();
const businessOwnerBookingController = require('../controllers/businessOwnerBookingController');
const auth = require('../middleware/auth');

/**
 * @route   POST /api/business-owner-appointments
 * @desc    Create an appointment for a business owner service
 * @access  Private (User)
 */
router.post('/', auth, businessOwnerBookingController.createBusinessOwnerAppointment);

/**
 * @route   GET /api/business-owner-appointments/my-appointments
 * @desc    Get current user's business owner appointments
 * @access  Private (User)
 */
router.get('/my-appointments', auth, businessOwnerBookingController.getMyBusinessOwnerAppointments);

/**
 * @route   GET /api/business-owner-appointments/:id/checkout-session
 * @desc    Get payment client secret for appointment payment
 * @access  Private (User)
 */
router.get('/:id/checkout-session', auth, businessOwnerBookingController.getBusinessOwnerAppointmentCheckoutSession);

/**
 * @route   GET /api/business-owner-appointments/available-slots/:serviceId
 * @desc    Get available appointment slots for a business owner service
 * @access  Public
 */
router.get('/available-slots/:serviceId', businessOwnerBookingController.getAvailableBusinessOwnerSlots);

/**
 * @route   GET /api/business-owner-appointments/:id
 * @desc    Get business owner appointment by ID
 * @access  Private (User)
 */
router.get('/:id', auth, businessOwnerBookingController.getBusinessOwnerAppointmentById);

/**
 * @route   POST /api/business-owner-appointments/:id/review
 * @desc    Add review for a completed business owner appointment
 * @access  Private (User)
 * @body    { rating, comment }
 */
router.post('/:id/review', auth, businessOwnerBookingController.addBusinessOwnerAppointmentReview);

module.exports = router;
