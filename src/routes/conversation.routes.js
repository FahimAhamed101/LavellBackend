const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const conversationController = require('../controllers/conversationController');

// List conversations
router.get('/', auth, conversationController.getConversations);

// Get or create conversation (user -> provider)
router.post('/providers/:providerId', auth, conversationController.getOrCreateConversation);

// Messages in conversation
router.get('/:id/messages', auth, conversationController.getMessages);

// Mark conversation as read
router.patch('/:id/read', auth, conversationController.markConversationRead);

module.exports = router;
