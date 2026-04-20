const express = require('express');
const router = express.Router();
const providerBookingController = require('../controllers/providerBookingController');
const auth = require('../middleware/auth');

/**
 * PROVIDER APPOINTMENT MANAGEMENT ROUTES
 * All routes require authentication
 */

/**
 * @route   GET /api/providers/appointments
 * @desc    Get all appointments for provider's services
 * @access  Private (Provider)
 * @query   status, date, page, limit
 */
router.get('/', auth, providerBookingController.getProviderAppointments);

/**
 * @route   GET /api/providers/appointments/:id
 * @desc    Get single appointment details
 * @access  Private (Provider)
 */
router.get('/:id', auth, providerBookingController.getAppointmentDetails);

/**
 * @route   PATCH /api/providers/appointments/:id/accept
 * @desc    Accept/Confirm an appointment request
 * @access  Private (Provider)
 * @body    { providerNotes } (optional)
 */
router.patch('/:id/accept', auth, providerBookingController.acceptAppointment);

/**
 * @route   PATCH /api/providers/appointments/:id/reject
 * @desc    Reject/Cancel an appointment request
 * @access  Private (Provider)
 * @body    { cancellationReason }
 */
router.patch('/:id/reject', auth, providerBookingController.rejectAppointment);

/**
 * @route   PATCH /api/providers/appointments/:id/reschedule
 * @desc    Reschedule an appointment
 * @access  Private (Provider)
 * @body    { appointmentDate, timeSlot: { startTime, endTime }, providerNotes }
 */
router.patch('/:id/reschedule', auth, providerBookingController.rescheduleAppointment);

/**
 * @route   PATCH /api/providers/appointments/:id/start
 * @desc    Mark appointment as in progress
 * @access  Private (Provider)
 */
router.patch('/:id/start', auth, providerBookingController.startAppointment);

/**
 * @route   PATCH /api/providers/appointments/:id/complete
 * @desc    Mark appointment as completed
 * @access  Private (Provider)
 */
router.patch('/:id/complete', auth, providerBookingController.completeAppointment);

/**
 * @route   PATCH /api/providers/appointments/:id/no-show
 * @desc    Mark user as no-show for appointment
 * @access  Private (Provider)
 */
router.patch('/:id/no-show', auth, providerBookingController.markNoShow);

module.exports = router;
