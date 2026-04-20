const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Provider = require('../models/Provider');

const getProviderFromUser = async (userId) => {
  const provider = await Provider.findOne({ userId });
  if (!provider) {
    const err = new Error('Provider profile not found');
    err.status = 404;
    throw err;
  }
  return provider;
};

/**
 * Get conversations for current user/provider
 * GET /api/conversations
 */
exports.getConversations = async (req, res) => {
  try {
    let query = {};

    if (req.user.userType === 'provider') {
      const provider = await getProviderFromUser(req.user._id);
      query.providerId = provider._id;
    } else {
      query.userId = req.user._id;
    }

    const conversations = await Conversation.find(query)
      .sort({ lastMessageAt: -1 })
      .populate({
        path: 'userId',
        select: 'fullName profilePicture'
      })
      .populate({
        path: 'providerId',
        select: 'rating totalReviews',
        populate: { path: 'userId', select: 'fullName profilePicture' }
      });

    res.status(200).json({
      success: true,
      data: { conversations }
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Error fetching conversations'
    });
  }
};

/**
 * Get or create conversation for a user with provider
 * POST /api/conversations/providers/:providerId
 */
exports.getOrCreateConversation = async (req, res) => {
  try {
    const { providerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(providerId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid provider id'
      });
    }

    const conversation = await Conversation.findOneAndUpdate(
      { userId: req.user._id, providerId },
      { $setOnInsert: { userId: req.user._id, providerId } },
      { new: true, upsert: true }
    );

    res.status(200).json({
      success: true,
      data: { conversation }
    });
  } catch (error) {
    console.error('Get or create conversation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating conversation',
      error: error.message
    });
  }
};

/**
 * Get messages for a conversation
 * GET /api/conversations/:id/messages
 */
exports.getMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid conversation id'
      });
    }

    const conversation = await Conversation.findById(id);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    if (req.user.userType === 'provider') {
      const provider = await getProviderFromUser(req.user._id);
      if (conversation.providerId.toString() !== provider._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized'
        });
      }
    } else if (conversation.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const messages = await Message.find({ conversationId: id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Message.countDocuments({ conversationId: id });

    res.status(200).json({
      success: true,
      data: {
        messages: messages.reverse(),
        total,
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching messages',
      error: error.message
    });
  }
};

/**
 * Mark all messages in conversation as read
 * PATCH /api/conversations/:id/read
 */
exports.markConversationRead = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid conversation id'
      });
    }

    const conversation = await Conversation.findById(id);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    let recipientId = req.user._id;
    if (req.user.userType === 'provider') {
      const provider = await getProviderFromUser(req.user._id);
      if (conversation.providerId.toString() !== provider._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
      }
      recipientId = provider._id;
    } else if (conversation.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await Message.updateMany(
      { conversationId: id, recipientId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    res.status(200).json({
      success: true,
      message: 'Conversation marked as read'
    });
  } catch (error) {
    console.error('Mark conversation read error:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking conversation as read',
      error: error.message
    });
  }
};
