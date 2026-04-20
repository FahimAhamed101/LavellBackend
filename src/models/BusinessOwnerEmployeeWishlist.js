const mongoose = require('mongoose');

const wishlistItemSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
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
  businessOwnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BusinessOwner',
    required: true,
    unique: true
  },
  items: [wishlistItemSchema]
}, {
  timestamps: true
});

wishlistSchema.index({ businessOwnerId: 1 });
wishlistSchema.index({ 'items.employeeId': 1 });

wishlistSchema.methods.addItem = async function(employeeId, notes = '') {
  const exists = this.items.find(item => item.employeeId.toString() === employeeId.toString());
  if (exists) {
    throw new Error('Employee already in wishlist');
  }
  this.items.push({ employeeId, notes });
  return this.save();
};

wishlistSchema.methods.removeItem = async function(employeeId) {
  const initialLength = this.items.length;
  this.items = this.items.filter(item => item.employeeId.toString() !== employeeId.toString());
  if (this.items.length === initialLength) {
    throw new Error('Employee not in wishlist');
  }
  return this.save();
};

wishlistSchema.methods.hasItem = function(employeeId) {
  return this.items.some(item => item.employeeId.toString() === employeeId.toString());
};

wishlistSchema.statics.getOrCreateForBusinessOwner = async function(businessOwnerId) {
  let wishlist = await this.findOne({ businessOwnerId });
  if (!wishlist) {
    wishlist = await this.create({ businessOwnerId, items: [] });
  }
  return wishlist;
};

module.exports = mongoose.model('BusinessOwnerEmployeeWishlist', wishlistSchema);
