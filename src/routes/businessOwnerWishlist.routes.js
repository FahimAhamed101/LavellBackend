const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const businessOwnerWishlistController = require('../controllers/businessOwnerWishlistController');

// All routes require business owner auth
router.use(auth);

// Get wishlist
router.get('/', businessOwnerWishlistController.getWishlist);

// Clear wishlist
router.delete('/clear', businessOwnerWishlistController.clearWishlist);

// Add employee to wishlist
router.post('/employees/:employeeId', businessOwnerWishlistController.addEmployee);

// Remove employee from wishlist
router.delete('/employees/:employeeId', businessOwnerWishlistController.removeEmployee);

// Check if employee is in wishlist
router.get('/check/:employeeId', businessOwnerWishlistController.checkEmployee);

module.exports = router;
