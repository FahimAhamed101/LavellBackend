const mongoose = require('mongoose');
const User = require('./User');

const providerSchema = new mongoose.Schema({
  // Reference to User model
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  businessOwnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BusinessOwner',
    default: null,
    index: true
  },
  // ID Card Information
  idCard: {
    frontImage: {
      type: String, // URL or path to uploaded image (optional - just stored)
      required: false,
      default: null
    },
    backImage: {
      type: String, // URL or path to uploaded image (optional - just stored)
      required: false,
      default: null
    },
    idNumber: {
      type: String, // To be filled manually by admin after review
      required: false,
      trim: true
    },
    fullNameOnId: {
      type: String,
      required: false,
      trim: true
    },
    dateOfBirth: {
      type: Date
    },
    expiryDate: {
      type: Date
    },
    issuedDate: {
      type: Date
    },
    nationality: {
      type: String,
      trim: true
    },
    address: {
      type: String,
      trim: true
    }
  },
  // Verification Status
  verificationStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'verified'],
    default: 'verified'
  },
  idVerifiedAt: {
    type: Date
  },
  verificationNotes: {
    type: String,
    trim: true
  },
  // Occupation (Optional)
  occupation: {
    type: String,
    trim: true,
    maxlength: [100, 'Occupation cannot exceed 100 characters']
  },
  // Reference ID (Optional)
  referenceId: {
    type: String,
    trim: true,
    sparse: true // Allow null but unique when present
  },
  // Provider-specific fields
  // Categories this provider belongs to
  categories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  servicesOffered: [{
    type: String,
    trim: true
  }],
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  totalReviews: {
    type: Number,
    default: 0
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  completedJobs: {
    type: Number,
    default: 0
  },
  isPaidForHomeScreen: {
    type: Boolean,
    default: false
  },
  paidHomeScreenExpiresAt: {
    type: Date,
    default: null
  },
  activityTime: {
    type: String, // e.g., "9:00 AM - 5:00 PM" or "24/7"
    trim: true,
    default: ''
  },
  discoveryPin: {
    isPinned: {
      type: Boolean,
      default: false
    },
    pinOrder: {
      type: Number,
      default: null
    },
    pinnedAt: {
      type: Date,
      default: null
    },
    pinnedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null
    }
  }
}, {
  timestamps: true
});

// Index for faster queries
// Note: userId already has unique: true which creates an index automatically
// Note: idCard.idNumber already has a sparse unique index defined in the schema field (line 27)
providerSchema.index({ verificationStatus: 1 });
providerSchema.index({ categories: 1 });
providerSchema.index({ isPaidForHomeScreen: 1, paidHomeScreenExpiresAt: 1 });
providerSchema.index({ 'discoveryPin.isPinned': 1, 'discoveryPin.pinOrder': 1 });

// Virtual populate to get user details
providerSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Ensure virtuals are included when converting to JSON
providerSchema.set('toJSON', { virtuals: true });
providerSchema.set('toObject', { virtuals: true });

// Method to approve provider
providerSchema.methods.approve = function() {
  this.verificationStatus = 'verified';
  this.idVerifiedAt = new Date();
  return this.save();
};

// Method to reject provider
providerSchema.methods.reject = function(reason) {
  this.verificationStatus = 'rejected';
  this.verificationNotes = reason;
  return this.save();
};

module.exports = mongoose.model('Provider', providerSchema);
