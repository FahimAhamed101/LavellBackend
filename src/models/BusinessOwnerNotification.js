const mongoose = require('mongoose');

const businessOwnerNotificationSchema = new mongoose.Schema({
  businessOwnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BusinessOwner',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    trim: true
  },
  type: {
    type: String,
    default: 'general',
    trim: true
  },
  isRead: {
    type: Boolean,
    default: false
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

businessOwnerNotificationSchema.index({ businessOwnerId: 1, createdAt: -1 });
businessOwnerNotificationSchema.index({ businessOwnerId: 1, isRead: 1 });

module.exports = mongoose.model('BusinessOwnerNotification', businessOwnerNotificationSchema);
