const express = require('express');
const router = express.Router();
const businessOwnerController = require('../controllers/businessOwnerController');
const employeeController = require('../controllers/employeeController');
const faqController = require('../controllers/faqController');
const businessOwnerBookingController = require('../controllers/businessOwnerBookingController');
const { uploadIdCards, uploadBusinessOwnerFiles, uploadProfilePicture, uploadBusinessProfileFiles, uploadEmployeeServicePhoto, handleUploadError } = require('../middleware/upload');
const businessOwnerAuth = require('../middleware/businessOwnerAuth');

/**
 * @route   POST /api/business-owners/register
 * @desc    Register a new business owner with ID card uploads
 * @access  Public
 */
router.post(
  '/register',
  uploadBusinessOwnerFiles,
  handleUploadError,
  businessOwnerController.registerBusinessOwner
);

/**
 * @route   POST /api/business-owners/register/verify-otp
 * @desc    Verify registration OTP and complete business owner registration
 * @access  Public
 */
router.post('/register/verify-otp', businessOwnerController.verifyBusinessOwnerRegistrationOTP);

/**
 * @route   POST /api/business-owners/login
 * @desc    Login business owner
 * @access  Public
 */
router.post('/login', businessOwnerController.loginBusinessOwner);

/**
 * @route   POST /api/business-owners/logout
 * @desc    Logout business owner (revoke refresh token)
 * @access  Public
 */
router.post('/logout', businessOwnerController.logout);

/**
 * @route   POST /api/business-owners/logout-all
 * @desc    Logout business owner from all devices
 * @access  Private (Business Owner only)
 */
router.post('/logout-all', businessOwnerAuth, businessOwnerController.logoutAll);

// ============ PASSWORD RESET ROUTES ============

/**
 * @route   POST /api/business-owners/forgot-password
 * @desc    Request password reset - Send OTP to email
 * @access  Public
 */
router.post('/forgot-password', businessOwnerController.forgotPassword);

/**
 * @route   POST /api/business-owners/verify-otp
 * @desc    Verify OTP code
 * @access  Public
 */
router.post('/verify-otp', businessOwnerController.verifyOTP);

/**
 * @route   POST /api/business-owners/reset-password
 * @desc    Reset password with OTP verification
 * @access  Public
 */
router.post('/reset-password', businessOwnerController.resetPasswordWithOTP);

/**
 * @route   GET /api/business-owners/me
 * @desc    Get current business owner profile
 * @access  Private (Business Owner only)
 */
router.get('/me', businessOwnerAuth, businessOwnerController.getBusinessOwnerProfile);

/**
 * @route   PUT /api/business-owners/me
 * @desc    Update current business owner profile (including password change)
 * @access  Private (Business Owner only)
 * @note    Password fields (currentPassword, newPassword, confirmPassword) are optional
 *          Only include them when you want to change the password
 */
router.put('/me', businessOwnerAuth, uploadProfilePicture, handleUploadError, businessOwnerController.updateBusinessOwnerProfile);

// ============ BUSINESS PROFILE ROUTES ============

/**
 * @route   GET /api/business-owners/business-profile
 * @desc    Get business profile (separate from personal profile)
 * @access  Private (Business Owner only)
 */
router.get('/business-profile', businessOwnerAuth, businessOwnerController.getBusinessProfile);

/**
 * @route   POST /api/business-owners/business-profile
 * @desc    Create business profile (first time setup)
 * @access  Private (Business Owner only)
 * @note    Required fields: name, categories (array), location
 *          Optional fields: about, coverPhoto (file), businessPhotos (files - max 10)
 */
router.post('/business-profile', businessOwnerAuth, uploadBusinessProfileFiles, handleUploadError, businessOwnerController.createBusinessProfile);

/**
 * @route   PUT /api/business-owners/business-profile
 * @desc    Update existing business profile (cover photo, name, categories, location, about, photos)
 * @access  Private (Business Owner only)
 * @note    Business profile must be created first using POST
 */
router.put('/business-profile', businessOwnerAuth, uploadBusinessProfileFiles, handleUploadError, businessOwnerController.updateBusinessProfile);

/**
 * @route   DELETE /api/business-owners/business-profile/photos/:photoIndex
 * @desc    Delete a specific business profile photo by index
 * @access  Private (Business Owner only)
 */
router.delete('/business-profile/photos/:photoIndex', businessOwnerAuth, businessOwnerController.deleteBusinessProfilePhoto);

/**
 * @route   GET /api/business-owners/stats
 * @desc    Get business owner stats
 * @access  Private (Business Owner only)
 */
router.get('/stats', businessOwnerAuth, businessOwnerController.getBusinessOwnerStats);

/**
 * @route   GET /api/business-owners/activities
 * @desc    Get business owner activities
 * @access  Private (Business Owner only)
 */
router.get('/activities', businessOwnerAuth, businessOwnerController.getBusinessOwnerActivities);

/**
 * @route   GET /api/business-owners/notifications
 * @desc    Get business owner notifications
 * @access  Private (Business Owner only)
 * @query   isRead, page, limit
 */
router.get('/notifications', businessOwnerAuth, businessOwnerController.getBusinessOwnerNotifications);

// ============ BANK INFORMATION ROUTES ============

/**
 * @route   GET /api/business-owners/bank-information
 * @desc    Get business owner's bank information
 * @access  Private (Business Owner only)
 */
router.get('/bank-information', businessOwnerAuth, businessOwnerController.getBankInformation);

/**
 * @route   POST /api/business-owners/bank-information
 * @desc    Save business owner's bank information (create)
 * @access  Private (Business Owner only)
 */
router.post('/bank-information', businessOwnerAuth, businessOwnerController.saveBankInformation);

/**
 * @route   PUT /api/business-owners/bank-information
 * @desc    Update business owner's bank information
 * @access  Private (Business Owner only)
 */
router.put('/bank-information', businessOwnerAuth, businessOwnerController.updateBankInformation);

/**
 * @route   DELETE /api/business-owners/bank-information/document
 * @desc    Delete bank verification document
 * @access  Private (Business Owner only)
 */
router.delete('/bank-information/document', businessOwnerAuth, businessOwnerController.deleteBankVerificationDocument);

// ============ FAQ ROUTES ============

/**
 * @route   GET /api/business-owners/faqs
 * @desc    Get active FAQs
 * @access  Private (Business Owner only)
 */
router.get('/faqs', businessOwnerAuth, faqController.getActiveFaqs);

// ============ PRIVACY POLICY ROUTE ============

/**
 * @route   GET /api/business-owners/privacy-policy
 * @desc    Get privacy policy
 * @access  Private (Business Owner only)
 */
router.get('/privacy-policy', businessOwnerAuth, businessOwnerController.getPrivacyPolicy);

// ============ TERMS AND CONDITIONS ROUTE ============

/**
 * @route   GET /api/business-owners/terms-and-conditions
 * @desc    Get terms and conditions
 * @access  Private (Business Owner only)
 */
router.get('/terms-and-conditions', businessOwnerAuth, businessOwnerController.getTermsAndConditions);

// ============ BUSINESS OWNER BOOKING MANAGEMENT ============

/**
 * @route   GET /api/business-owners/bookings
 * @desc    Get all bookings for business owner's services
 * @access  Private (Business Owner only)
 */
router.get('/bookings', businessOwnerAuth, businessOwnerBookingController.getBusinessOwnerBookings);

/**
 * @route   GET /api/business-owners/bookings/transactions
 * @desc    Get business owner transaction history (bookings + appointments)
 * @access  Private (Business Owner only)
 * @query   status, source, page, limit, search, from, to
 */
router.get('/bookings/transactions', businessOwnerAuth, businessOwnerBookingController.getBusinessOwnerTransactions);

/**
 * @route   GET /api/business-owners/bookings/:id
 * @desc    Get booking details
 * @access  Private (Business Owner only)
 */
router.get('/bookings/:id', businessOwnerAuth, businessOwnerBookingController.getBusinessOwnerBookingDetails);

/**
 * @route   PATCH /api/business-owners/bookings/:id/accept
 * @desc    Accept a booking request
 * @access  Private (Business Owner only)
 */
router.patch('/bookings/:id/accept', businessOwnerAuth, businessOwnerBookingController.acceptBusinessOwnerBooking);

/**
 * @route   POST /api/business-owners/bookings/:id/request-due
 * @desc    Request due payment for a completed booking
 * @access  Private (Business Owner)
 */
router.post('/bookings/:id/request-due', businessOwnerAuth, businessOwnerBookingController.requestBusinessOwnerDuePayment);

/**
 * @route   POST /api/business-owners/bookings/:id/mark-offline-paid
 * @desc    Mark due payment as paid offline
 * @access  Private (Business Owner)
 */
router.post('/bookings/:id/mark-offline-paid', businessOwnerAuth, businessOwnerBookingController.markBusinessOwnerOfflinePaid);

/**
 * @route   GET /api/business-owners/bookings/:id/payment-status
 * @desc    Get payment status for a booking (business owner)
 * @access  Private (Business Owner)
 */
router.get('/bookings/:id/payment-status', businessOwnerAuth, businessOwnerBookingController.getBusinessOwnerBookingPaymentStatusForOwner);

/**
 * @route   PATCH /api/business-owners/bookings/:id/reject
 * @desc    Reject a booking request
 * @access  Private (Business Owner only)
 */
router.patch('/bookings/:id/reject', businessOwnerAuth, businessOwnerBookingController.rejectBusinessOwnerBooking);

/**
 * @route   PATCH /api/business-owners/bookings/:id/start
 * @desc    Mark booking as in progress
 * @access  Private (Business Owner only)
 */
router.patch('/bookings/:id/start', businessOwnerAuth, businessOwnerBookingController.startBusinessOwnerBooking);

/**
 * @route   PATCH /api/business-owners/bookings/:id/complete
 * @desc    Mark booking as completed
 * @access  Private (Business Owner only)
 */
router.patch('/bookings/:id/complete', businessOwnerAuth, businessOwnerBookingController.completeBusinessOwnerBooking);

// ============ BUSINESS OWNER APPOINTMENT MANAGEMENT ============

/**
 * @route   GET /api/business-owners/appointments
 * @desc    Get all appointments for business owner's services
 * @access  Private (Business Owner only)
 */
router.get('/appointments', businessOwnerAuth, businessOwnerBookingController.getBusinessOwnerAppointments);

/**
 * @route   GET /api/business-owners/appointments/:id
 * @desc    Get appointment details
 * @access  Private (Business Owner only)
 */
router.get('/appointments/:id', businessOwnerAuth, businessOwnerBookingController.getBusinessOwnerAppointmentDetails);

/**
 * @route   PATCH /api/business-owners/appointments/:id/accept
 * @desc    Accept an appointment request
 * @access  Private (Business Owner only)
 */
router.patch('/appointments/:id/accept', businessOwnerAuth, businessOwnerBookingController.acceptBusinessOwnerAppointment);

/**
 * @route   PATCH /api/business-owners/appointments/:id/reject
 * @desc    Reject an appointment request
 * @access  Private (Business Owner only)
 */
router.patch('/appointments/:id/reject', businessOwnerAuth, businessOwnerBookingController.rejectBusinessOwnerAppointment);

/**
 * @route   PATCH /api/business-owners/appointments/:id/reschedule
 * @desc    Reschedule an appointment
 * @access  Private (Business Owner only)
 */
router.patch('/appointments/:id/reschedule', businessOwnerAuth, businessOwnerBookingController.rescheduleBusinessOwnerAppointment);

/**
 * @route   PATCH /api/business-owners/appointments/:id/start
 * @desc    Mark appointment as in progress
 * @access  Private (Business Owner only)
 */
router.patch('/appointments/:id/start', businessOwnerAuth, businessOwnerBookingController.startBusinessOwnerAppointment);

/**
 * @route   PATCH /api/business-owners/appointments/:id/complete
 * @desc    Mark appointment as completed
 * @access  Private (Business Owner only)
 */
router.patch('/appointments/:id/complete', businessOwnerAuth, businessOwnerBookingController.completeBusinessOwnerAppointment);

/**
 * @route   PATCH /api/business-owners/appointments/:id/no-show
 * @desc    Mark appointment as no-show
 * @access  Private (Business Owner only)
 */
router.patch('/appointments/:id/no-show', businessOwnerAuth, businessOwnerBookingController.markBusinessOwnerNoShow);

// ============ SERVICE MANAGEMENT ============

/**
 * @route   POST /api/business-owners/services
 * @desc    Create service with optional employee ID
 * @access  Private (Business Owner only)
 * @body    {
 *            headline: string (required),
 *            description: string (required),
 *            categories: JSON array (required),
 *            employeeId: ObjectId (optional - if provided, service is assigned to employee),
 *            basePrice: number (optional - required if appointmentEnabled is false),
 *            appointmentEnabled: boolean (default: false),
 *            appointmentSlots: JSON array (optional - required if appointmentEnabled is true),
 *            whyChooseService: JSON object (optional)
 *          }
 * @file    servicePhoto (required)
 */
router.post(
  '/services',
  businessOwnerAuth,
  uploadEmployeeServicePhoto,
  handleUploadError,
  employeeController.createServiceWithOptionalEmployee
);

module.exports = router;
