const express = require('express');
const router = express.Router();
const eventManagerController = require('../controllers/eventManagerController');
const eventController = require('../controllers/eventController');
const { uploadEventManagerFiles, uploadProfilePicture, uploadEventImage, handleUploadError } = require('../middleware/upload');
const auth = require('../middleware/auth');

/**
 * @route   POST /api/event-managers/register
 * @desc    Register a new event manager with ID card uploads
 * @access  Public
 */
router.post(
  '/register',
  uploadEventManagerFiles,
  handleUploadError,
  eventManagerController.registerEventManager
);

/**
 * @route   POST /api/event-managers/register/verify-otp
 * @desc    Verify registration OTP and complete event manager registration
 * @access  Public
 */
router.post('/register/verify-otp', eventManagerController.verifyEventManagerRegistrationOTP);

/**
 * @route   POST /api/event-managers/login
 * @desc    Login event manager
 * @access  Public
 */
router.post('/login', eventManagerController.loginEventManager);

/**
 * @route   POST /api/event-managers/logout
 * @desc    Logout event manager (revoke refresh token)
 * @access  Public
 */
router.post('/logout', eventManagerController.logout);

/**
 * @route   POST /api/event-managers/logout-all
 * @desc    Logout event manager from all devices
 * @access  Private (Event Manager only)
 */
router.post('/logout-all', auth, eventManagerController.logoutAll);

// ============ PASSWORD RESET ROUTES ============

/**
 * @route   POST /api/event-managers/forgot-password
 * @desc    Request password reset - Send OTP to email
 * @access  Public
 */
router.post('/forgot-password', eventManagerController.forgotPassword);

/**
 * @route   POST /api/event-managers/verify-otp
 * @desc    Verify OTP code
 * @access  Public
 */
router.post('/verify-otp', eventManagerController.verifyOTP);

/**
 * @route   POST /api/event-managers/reset-password
 * @desc    Reset password with OTP verification
 * @access  Public
 */
router.post('/reset-password', eventManagerController.resetPasswordWithOTP);

/**
 * @route   GET /api/event-managers/me
 * @desc    Get current event manager profile
 * @access  Private (Event Manager only)
 */
router.get('/me', auth, eventManagerController.getEventManagerProfile);

/**
 * @route   DELETE /api/event-managers/me
 * @desc    Delete event manager account
 * @access  Private (Event Manager only)
 */
router.delete('/me', auth, eventManagerController.deleteEventManagerAccount);

/**
 * @route   PUT /api/event-managers/me
 * @desc    Update current event manager profile (including password change)
 * @access  Private (Event Manager only)
 * @note    Password fields (currentPassword, newPassword, confirmPassword) are optional
 *          Only include them when you want to change the password
 */
router.put('/me', auth, uploadProfilePicture, handleUploadError, eventManagerController.updateEventManagerProfile);

/**
 * @route   GET /api/event-managers/bank-information
 * @desc    Get event manager bank information
 * @access  Private (Event Manager only)
 */
router.get('/bank-information', auth, eventManagerController.getBankInformation);

/**
 * @route   POST /api/event-managers/bank-information
 * @desc    Save event manager bank information
 * @access  Private (Event Manager only)
 */
router.post('/bank-information', auth, eventManagerController.saveBankInformation);

/**
 * @route   PUT /api/event-managers/bank-information
 * @desc    Update event manager bank information
 * @access  Private (Event Manager only)
 */
router.put('/bank-information', auth, eventManagerController.updateBankInformation);

/**
 * @route   GET /api/event-managers/notifications
 * @desc    Get event manager notifications
 * @access  Private (Event Manager only)
 * @query   isRead - true|false (optional)
 * @query   page - Page number (default: 1)
 * @query   limit - Items per page (default: 20, max: 100)
 */
router.get('/notifications', auth, eventManagerController.getNotifications);

/**
 * @route   PATCH /api/event-managers/notifications/read-all
 * @desc    Mark all event manager notifications as read
 * @access  Private (Event Manager only)
 */
router.patch('/notifications/read-all', auth, eventManagerController.markAllNotificationsAsRead);

/**
 * @route   PATCH /api/event-managers/notifications/:id/read
 * @desc    Mark one event manager notification as read
 * @access  Private (Event Manager only)
 */
router.patch('/notifications/:id/read', auth, eventManagerController.markNotificationAsRead);

/**
 * @route   DELETE /api/event-managers/notifications/:id
 * @desc    Delete one event manager notification
 * @access  Private (Event Manager only)
 */
router.delete('/notifications/:id', auth, eventManagerController.deleteNotification);

// ============ PRIVACY POLICY & TERMS ROUTES ============

/**
 * @route   GET /api/event-managers/privacy-policy
 * @desc    Get privacy policy
 * @access  Private (Event Manager only)
 */
router.get('/privacy-policy', auth, eventManagerController.getPrivacyPolicy);

/**
 * @route   GET /api/event-managers/terms-and-conditions
 * @desc    Get terms and conditions
 * @access  Private (Event Manager only)
 */
router.get('/terms-and-conditions', auth, eventManagerController.getTermsAndConditions);

// ============ EVENT MANAGEMENT ROUTES ============

/**
 * @route   POST /api/event-managers/events
 * @desc    Create a new event (draft)
 * @access  Private (Event Manager only)
 */
router.post('/events', auth, uploadEventImage, handleUploadError, eventController.createEvent);

/**
 * @route   GET /api/event-managers/events/stats
 * @desc    Get event statistics for the authenticated event manager
 * @access  Private (Event Manager only)
 */
router.get('/events/stats', auth, eventController.getEventStats);

/**
 * @route   GET /api/event-managers/events
 * @desc    Get all events for the authenticated event manager
 * @access  Private (Event Manager only)
 * @query   status - Filter by event status (draft, published, cancelled, completed)
 * @query   page - Page number (default: 1)
 * @query   limit - Items per page (default: 10)
 */
router.get('/events', auth, eventController.getMyEvents);

/**
 * @route   GET /api/event-managers/events/sales-overview
 * @desc    Get event sales overview (monthly/all-time)
 * @access  Private (Event Manager only)
 * @query   period - monthly | all_time (default: monthly)
 * @query   month - 1..12 (monthly only, must be used with year)
 * @query   year - 4-digit year (monthly only, must be used with month)
 * @query   monthOffset - 0=current month, 1=previous month, 2=two months ago (fallback)
 */
router.get('/events/sales-overview', auth, eventController.getSalesOverview);

/**
 * @route   GET /api/event-managers/events/:id
 * @desc    Get a single event by ID
 * @access  Private (Event Manager only)
 */
router.get('/events/:id', auth, eventController.getEventById);

/**
 * @route   GET /api/event-managers/events/:id/attendees
 * @desc    Get attendees list for a specific event
 * @access  Private (Event Manager only)
 * @query   page - Page number (default: 1)
 * @query   limit - Items per page (default: 20)
 */
router.get('/events/:id/attendees', auth, eventController.getEventAttendees);

/**
 * @route   PUT /api/event-managers/events/:id
 * @desc    Update an event (draft or published without tickets sold)
 * @access  Private (Event Manager only)
 */
router.put('/events/:id', auth, uploadEventImage, handleUploadError, eventController.updateEvent);

/**
 * @route   PUT /api/event-managers/events/:id/publish
 * @desc    Publish an event (change status from draft to published)
 * @access  Private (Event Manager only)
 */
router.put('/events/:id/publish', auth, eventController.publishEvent);

/**
 * @route   PUT /api/event-managers/events/:id/cancel
 * @desc    Cancel an event
 * @access  Private (Event Manager only)
 * @body    cancellationReason - Reason for cancellation
 */
router.put('/events/:id/cancel', auth, eventController.cancelEvent);

/**
 * @route   DELETE /api/event-managers/events/:id
 * @desc    Delete an event (only drafts with no tickets sold)
 * @access  Private (Event Manager only)
 */
router.delete('/events/:id', auth, eventController.deleteEvent);

module.exports = router;
