const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  providerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Provider',
    required: true,
    index: true
  },
  lastMessageAt: {
    type: Date,
    default: Date.now
  },
  lastMessage: {
    type: String,
    trim: true,
    maxlength: 1000
  }
}, {
  timestamps: true
});

conversationSchema.index({ userId: 1, providerId: 1 }, { unique: true });
conversationSchema.index({ userId: 1, lastMessageAt: -1 });
conversationSchema.index({ providerId: 1, lastMessageAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
