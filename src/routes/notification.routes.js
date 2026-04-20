const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const notificationController = require('../controllers/notificationController');
const deviceTokenController = require('../controllers/deviceTokenController');

// Device token registration for push notifications
router.post('/token', auth, deviceTokenController.registerToken);
router.delete('/token', auth, deviceTokenController.removeToken);

// In-app notifications
router.get('/', auth, notificationController.getNotifications);
router.patch('/read-all', auth, notificationController.markAllAsRead);
router.patch('/:id/read', auth, notificationController.markAsRead);
router.delete('/:id', auth, notificationController.deleteNotification);

module.exports = router;
