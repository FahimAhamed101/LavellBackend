const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const auth = require('../middleware/auth');




router.post('/', auth, bookingController.createBooking);


router.get('/my-bookings', auth, bookingController.getMyBookings);


router.get('/:id/payment-status', auth, bookingController.getBookingPaymentStatus);


router.get('/:id', auth, bookingController.getBookingById);


router.patch('/:id/cancel', auth, bookingController.cancelBooking);


router.post('/:id/review', auth, bookingController.addBookingReview);


router.get('/:id/due/intent', auth, bookingController.getDuePaymentIntent);


router.post('/:id/due/confirm', auth, bookingController.confirmDuePayment);


router.get('/:id/checkout-session', auth, bookingController.getCheckoutSession);

module.exports = router;
