const mongoose = require('mongoose');

const businessOwnerSchema = new mongoose.Schema({
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

  businessName: {
    type: String,
    required: true,
    trim: true,
    minlength: [4, 'Business name must be at least 4 characters'],
    maxlength: [50, 'Business name cannot exceed 100 characters']
  },

  businessCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true
  },

  businessAddress: {
    fullAddress:{
      type: String,
      required: true,
      trim: true}
  },

  businessPhoto: {
    type: String, // Cloudinary URL for business photo
    required: false,
    default: null
  },

  // Business Profile fields (separate from personal profile)
  businessProfile: {
    coverPhoto: {
      type: String, // Cloudinary URL for business cover photo
      default: null
    },
    name: {
      type: String, // Can be different from businessName
      trim: true,
      maxlength: [100, 'Business profile name cannot exceed 100 characters']
    },
    categories: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category'
    }],
    location: {
      type: String,
      trim: true,
      maxlength: [200, 'Business location cannot exceed 200 characters']
    },
    about: {
      type: String,
      trim: true,
      maxlength: [1000, 'About section cannot exceed 1000 characters']
    },
    photos: [{
      type: String // Array of Cloudinary URLs for business photos
    }]
  },

  // ID Card Information
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

  // Bank Information
  bankInformation: {
    accountHolderName: {
      type: String,
      trim: true,
      maxlength: [100, 'Account holder name cannot exceed 100 characters']
    },
    bankName: {
      type: String,
      trim: true,
      maxlength: [100, 'Bank name cannot exceed 100 characters']
    },
    accountNumber: {
      type: String,
      trim: true,
      maxlength: [50, 'Account number cannot exceed 50 characters']
    },
    routingNumber: {
      type: String,
      trim: true,
      maxlength: [50, 'Routing number cannot exceed 50 characters']
    },
    accountHolderType: {
      type: String,
      trim: true,
      maxlength: [50, 'Account holder type cannot exceed 50 characters']
    }
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
businessOwnerSchema.index({ userId: 1 });
businessOwnerSchema.index({ 'discoveryPin.isPinned': 1, 'discoveryPin.pinOrder': 1 });

// Virtual populate to get user details
businessOwnerSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Ensure virtuals are included when converting to JSON
businessOwnerSchema.set('toJSON', { virtuals: true });
businessOwnerSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('BusinessOwner', businessOwnerSchema);
