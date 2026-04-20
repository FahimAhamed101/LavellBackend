const mongoose = require('mongoose');

const wishlistItemSchema = new mongoose.Schema({
  itemType: {
    type: String,
    enum: ['service', 'appointment'],
    required: [true, 'Item type is required']
  },
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service'
  },
  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment'
  },
  addedAt: {
    type: Date,
    default: Date.now
  },
  notes: {
    type: String,
    maxlength: [200, 'Notes cannot exceed 200 characters']
  }
});

const wishlistSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    unique: true
  },
  items: [wishlistItemSchema]
}, {
  timestamps: true
});

// Validation to ensure correct reference based on itemType
wishlistItemSchema.pre('validate', function(next) {
  if (this.itemType === 'service' && !this.serviceId) {
    next(new Error('Service ID is required for service items'));
  } else if (this.itemType === 'appointment' && !this.appointmentId) {
    next(new Error('Appointment ID is required for appointment items'));
  } else {
    next();
  }
});

// Index for faster queries
// Note: userId already has unique: true which creates an index automatically
wishlistSchema.index({ 'items.serviceId': 1 });
wishlistSchema.index({ 'items.appointmentId': 1 });

// Method to add item to wishlist
wishlistSchema.methods.addItem = async function(itemType, itemId, notes = '') {
  const existingItem = this.items.find(item => {
    if (itemType === 'service') {
      return item.itemType === 'service' && item.serviceId?.toString() === itemId.toString();
    } else {
      return item.itemType === 'appointment' && item.appointmentId?.toString() === itemId.toString();
    }
  });

  if (existingItem) {
    throw new Error(`This ${itemType} is already in your wishlist`);
  }

  const newItem = {
    itemType,
    notes
  };

  if (itemType === 'service') {
    newItem.serviceId = itemId;
  } else {
    newItem.appointmentId = itemId;
  }

  this.items.push(newItem);
  return this.save();
};

// Method to remove item from wishlist
wishlistSchema.methods.removeItem = async function(itemType, itemId) {
  const initialLength = this.items.length;

  this.items = this.items.filter(item => {
    if (itemType === 'service') {
      return !(item.itemType === 'service' && item.serviceId?.toString() === itemId.toString());
    } else {
      return !(item.itemType === 'appointment' && item.appointmentId?.toString() === itemId.toString());
    }
  });

  if (this.items.length === initialLength) {
    throw new Error(`This ${itemType} is not in your wishlist`);
  }

  return this.save();
};

// Method to check if item exists in wishlist
wishlistSchema.methods.hasItem = function(itemType, itemId) {
  return this.items.some(item => {
    if (itemType === 'service') {
      return item.itemType === 'service' && item.serviceId?.toString() === itemId.toString();
    } else {
      return item.itemType === 'appointment' && item.appointmentId?.toString() === itemId.toString();
    }
  });
};

// Static method to get or create wishlist for user
wishlistSchema.statics.getOrCreateForUser = async function(userId) {
  let wishlist = await this.findOne({ userId });
  if (!wishlist) {
    wishlist = await this.create({ userId, items: [] });
  }
  return wishlist;
};

const Wishlist = mongoose.model('Wishlist', wishlistSchema);

module.exports = Wishlist;
