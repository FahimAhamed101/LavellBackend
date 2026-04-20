const mongoose = require('mongoose');

const appointmentSlotSchema = new mongoose.Schema({
  duration: {
    type: Number, // Duration in minutes (e.g., 30, 60, 90)
    required: true,
    min: 1
  },
  durationUnit: {
    type: String,
    enum: ['minutes', 'hours'],
    default: 'minutes'
  },
  price: {
    type: Number,
    required: true,
    min: 0
  }
}, { _id: true });

const whyChooseUsSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 300
  }
}, { _id: false });

const serviceSchema = new mongoose.Schema({
  // Reference to Provider
  providerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Provider',
    required: true
  },
  // Service Photo
  servicePhoto: {
    type: String, // URL or path to uploaded image
    required: [true, 'Service photo is required']
  },
  // Category
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Category is required']
  },
  // Headline
  headline: {
    type: String,
    required: [true, 'Headline is required'],
    trim: true,
    maxlength: [200, 'Headline cannot exceed 200 characters']
  },
  // About this service (500 char description)
  description: {
    type: String,
    required: [true, 'Service description is required'],
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  // Why Choose Us - 4 sections
  whyChooseUs: {
    twentyFourSeven: {
      type: String,
      trim: true,
      maxlength: 200,
      default: ''
    },
    efficientAndFast: {
      type: String,
      trim: true,
      maxlength: 200,
      default: ''
    },
    affordablePrices: {
      type: String,
      trim: true,
      maxlength: 200,
      default: ''
    },
    expertTeam: {
      type: String,
      trim: true,
      maxlength: 200,
      default: ''
    }
  },
  // Base Service Pricing (when appointment is OFF)
  basePrice: {
    type: Number,
    min: 0,
    default: 0
  },
  // Make an Appointment Toggle
  appointmentEnabled: {
    type: Boolean,
    default: false
  },
  // Appointment Slots (when appointment is ON)
  appointmentSlots: [appointmentSlotSchema],
  // Service Status
  isActive: {
    type: Boolean,
    default: true
  },
  // Views/Stats
  views: {
    type: Number,
    default: 0
  },
  bookings: {
    type: Number,
    default: 0
  },
  // Rating
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  totalReviews: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes for faster queries
serviceSchema.index({ providerId: 1 });
serviceSchema.index({ category: 1 });
serviceSchema.index({ isActive: 1 });
serviceSchema.index({ rating: -1 });
serviceSchema.index({ createdAt: -1 });

// Validation: If appointment is enabled, must have at least one slot
serviceSchema.pre('save', function(next) {
  if (this.appointmentEnabled) {
    if (!this.appointmentSlots || this.appointmentSlots.length === 0) {
      return next(new Error('At least one appointment slot is required when appointment is enabled'));
    }
  } else {
    // If appointment is disabled, ensure base price is set
    if (!this.basePrice || this.basePrice <= 0) {
      return next(new Error('Base price is required when appointment is disabled'));
    }
  }
  next();
});

// Virtual to get provider details
serviceSchema.virtual('provider', {
  ref: 'Provider',
  localField: 'providerId',
  foreignField: '_id',
  justOne: true
});

// Ensure virtuals are included when converting to JSON
serviceSchema.set('toJSON', { virtuals: true });
serviceSchema.set('toObject', { virtuals: true });

// Method to increment views
serviceSchema.methods.incrementViews = function() {
  this.views += 1;
  return this.save();
};

module.exports = mongoose.model('Service', serviceSchema);
