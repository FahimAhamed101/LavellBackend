const mongoose = require('mongoose');

const eventManagerSchema = new mongoose.Schema({
  // Reference to User model
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },

  dateOfBirth: {
    type: Date,
    required: true,
    validate: {
      validator: function(value) {
        return !value || value < new Date();
      },
      message: 'Date of birth must be in the past'
    }
  },

  // ID Type Selection
  idType: {
    type: String,
    required: true,
    enum: ['passport', 'national_id', 'driver_license'],
    trim: true
  },

  // Identification Number
  identificationNumber: {
    type: String,
    required: true,
    trim: true,
    minlength: [5, 'Identification number must be at least 5 characters'],
    maxlength: [50, 'Identification number cannot exceed 50 characters']
  },

  // ID Card Information (front and back photos)
  idCard: {
    frontImage: {
      type: String, // Cloudinary URL for ID card front image
      required: false,
      default: null
    },
    backImage: {
      type: String, // Cloudinary URL for ID card back image
      required: false,
      default: null
    }
  },

  // Category (text field)
  category: {
    type: String,
    trim: true,
    maxlength: [100, 'Category cannot exceed 100 characters'],
    default: ''
  },

  // Business Address
  businessAddress: {
    type: String,
    trim: true,
    maxlength: [200, 'Business address cannot exceed 200 characters'],
    default: ''
  }
}, {
  timestamps: true
});

// Index for faster queries
eventManagerSchema.index({ userId: 1 });
eventManagerSchema.index({ identificationNumber: 1 });

// Virtual populate to get user details
eventManagerSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Ensure virtuals are included when converting to JSON
eventManagerSchema.set('toJSON', { virtuals: true });
eventManagerSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('EventManager', eventManagerSchema);
