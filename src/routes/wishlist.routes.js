const express = require('express');
const router = express.Router();
const wishlistController = require('../controllers/wishlistController');
const auth = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// Get user's wishlist
router.get('/', wishlistController.getWishlist);

// Clear all items from wishlist
router.delete('/clear', wishlistController.clearWishlist);

// Service wishlist operations
router.post('/services/:serviceId', wishlistController.addService);
router.delete('/services/:serviceId', wishlistController.removeService);

// Appointment wishlist operations
router.post('/appointments/:appointmentId', wishlistController.addAppointment);
router.delete('/appointments/:appointmentId', wishlistController.removeAppointment);

// Check if item is in wishlist
router.get('/check/:itemType/:itemId', wishlistController.checkItem);

// Update notes for a wishlist item
router.patch('/items/:itemId/notes', wishlistController.updateNotes);

module.exports = router;
