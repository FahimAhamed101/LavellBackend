const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const auth = require('../middleware/auth');

/**
 * APPOINTMENT ROUTES - For appointment-based service bookings (appointmentEnabled = true)
 */

/**
 * @route   POST /api/appointments
 * @desc    Create a new appointment for a service
 * @access  Private (User must be authenticated)
 * @body    { serviceId, appointmentDate, timeSlot: { startTime, endTime }, slotId, downPayment, userNotes }
 */
router.post('/', auth, bookingController.createAppointment);

/**
 * @route   GET /api/appointments/my-appointments
 * @desc    Get current user's appointments
 * @access  Private
 * @query   status, page, limit
 */
router.get('/my-appointments', auth, bookingController.getMyAppointments);

/**
 * @route   GET /api/appointments/available-slots/:serviceId
 * @desc    Get available appointment slots for a service on a specific date
 * @access  Public
 * @query   date (YYYY-MM-DD format)
 */
router.get('/available-slots/:serviceId', bookingController.getAvailableSlots);

/**
 * @route   GET /api/appointments/:id
 * @desc    Get single appointment by ID
 * @access  Private (Owner only)
 */
router.get('/:id', auth, bookingController.getAppointmentById);

/**
 * @route   PATCH /api/appointments/:id/reschedule
 * @desc    Reschedule an appointment
 * @access  Private (Owner only)
 * @body    { appointmentDate, timeSlot: { startTime, endTime }, userNotes }
 */
router.patch('/:id/reschedule', auth, bookingController.rescheduleAppointment);

/**
 * @route   GET /api/appointments/:id/checkout-session
 * @desc    Get Stripe payment client secret for appointment payment
 * @access  Private (User)
 */
router.get('/:id/checkout-session', auth, bookingController.getAppointmentCheckoutSession);

/**
 * @route   POST /api/appointments/:id/review
 * @desc    Add review for a completed appointment
 * @access  Private (Owner only)
 * @body    { rating, comment }
 */
router.post('/:id/review', auth, bookingController.addAppointmentReview);

module.exports = router;
