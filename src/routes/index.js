const express = require('express');
const router = express.Router();

// Import auth routes
const authRoutes = require('./auth');
const oauthRoutes = require('./auth.oauth.routes');
const providerRoutes = require('./provider.routes');
const adminRoutes = require('./admin.routes');
const categoryRoutes = require('./category.routes');
const serviceRoutes = require('./service.routes');
const publicServiceRoutes = require('./service.public.routes');
const bookingRoutes = require('./booking.routes');
const appointmentRoutes = require('./appointment.routes');
const wishlistRoutes = require('./wishlist.routes');
const providerBookingRoutes = require('./provider.booking.routes');
const providerAppointmentRoutes = require('./provider.appointment.routes');
const businessOwnerRoutes = require('./businessOwner.routes');
const eventManagerRoutes = require('./eventManager.routes');
const homeRoutes = require('./home.routes');
const userRoutes = require('./user.routes');
const employeeRoutes = require('./employee.routes');
const businessOwnerBookingRoutes = require('./businessOwnerBooking.routes');
const businessOwnerAppointmentRoutes = require('./businessOwnerAppointment.routes');
const notificationRoutes = require('./notification.routes');
const conversationRoutes = require('./conversation.routes');
const businessOwnerWishlistRoutes = require('./businessOwnerWishlist.routes');
const paymentRoutes = require('./payment.routes');
const eventTicketController = require('../controllers/eventTicketController');
const auth = require('../middleware/auth');

// Use auth routes
router.use('/auth', authRoutes);

// Use OAuth routes (merged into /auth)
router.use('/auth', oauthRoutes);

// Use provider routes
router.use('/providers', providerRoutes);

// Use provider service routes
router.use('/providers/services', serviceRoutes);

// Use provider booking management routes
router.use('/providers/bookings', providerBookingRoutes);

// Use provider appointment management routes
router.use('/providers/appointments', providerAppointmentRoutes);

// Use admin routes
router.use('/admin', adminRoutes);

// Use category routes (public)
router.use('/categories', categoryRoutes);

// Use public service routes
router.use('/services', publicServiceRoutes);

// Use booking routes (for regular service bookings)
router.use('/bookings', bookingRoutes);

// Use appointment routes (for appointment-based bookings)
router.use('/appointments', appointmentRoutes);

// Use business owner booking routes (for employee services)
router.use('/business-owner-bookings', businessOwnerBookingRoutes);

// Use business owner appointment routes (for employee services)
router.use('/business-owner-appointments', businessOwnerAppointmentRoutes);

// Use wishlist routes
router.use('/wishlist', wishlistRoutes);

// Use business owner routes
router.use('/business-owners', businessOwnerRoutes);

// Use employee routes (nested under business-owners)
router.use('/business-owners/employees', employeeRoutes);

// Use event manager routes
router.use('/event-managers', eventManagerRoutes);

// Use home routes (public)
router.use('/home', homeRoutes);

// Use user routes (authenticated)
router.use('/user', userRoutes);

// Use notifications routes (authenticated)
router.use('/notifications', notificationRoutes);

// Use conversation routes (authenticated)
router.use('/conversations', conversationRoutes);

// Public payment configuration routes
router.use('/payments', paymentRoutes);

// Event ticket purchase (user)
router.post('/events/:id/buy-tickets', auth, eventTicketController.buyTickets);
router.get('/events/my-tickets', auth, eventTicketController.getMyTicketPurchases);
router.get('/events/tickets/:id', auth, eventTicketController.getTicketPurchaseById);

// Business owner employee wishlist routes
router.use('/business-owners/wishlist', businessOwnerWishlistRoutes);

// Public settings route (Terms & Conditions, Privacy Policy, etc.)
const adminController = require('../controllers/adminController');
router.get('/settings/:key', adminController.getPublicSettings);

module.exports = router;
