const mongoose = require('mongoose');

// Appointment Slot Schema (for duration-based pricing)
const appointmentSlotSchema = new mongoose.Schema({
  duration: {
    type: Number,
    required: true,
    enum: {
      values: [15, 30, 45, 60],
      message: 'Duration must be 15, 30, 45, or 60 minutes'
    }
  },
  durationUnit: {
    type: String,
    enum: ['minutes'],
    default: 'minutes'
  },
  price: {
    type: Number,
    required: true,
    min: [0, 'Price cannot be negative']
  }
}, { _id: true });

const employeeServiceSchema = new mongoose.Schema({
  // Reference to Employee
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: [true, 'Employee is required'],
    index: true
  },
  // Reference to Business Owner (for direct queries)
  businessOwnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BusinessOwner',
    required: [true, 'Business owner is required'],
    index: true
  },
  // Service Photo
  servicePhoto: {
    type: String,
    required: [true, 'Service photo is required']
  },
  // Categories (multiple allowed)
  categories: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'Category',
    required: [true, 'At least one category is required'],
    validate: {
      validator: function(v) {
        return v && v.length > 0;
      },
      message: 'At least one category is required'
    }
  },
  // Headline
  headline: {
    type: String,
    required: [true, 'Headline is required'],
    trim: true,
    maxlength: [200, 'Headline cannot exceed 200 characters']
  },
  // Description (About this service)
  description: {
    type: String,
    required: [true, 'Service description is required'],
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  // Why Choose This Service (4 reasons)
  whyChooseService: {
    reason1: {
      type: String,
      trim: true,
      maxlength: [200, 'Reason 1 cannot exceed 200 characters'],
      default: ''
    },
    reason2: {
      type: String,
      trim: true,
      maxlength: [200, 'Reason 2 cannot exceed 200 characters'],
      default: ''
    },
    reason3: {
      type: String,
      trim: true,
      maxlength: [200, 'Reason 3 cannot exceed 200 characters'],
      default: ''
    },
    reason4: {
      type: String,
      trim: true,
      maxlength: [200, 'Reason 4 cannot exceed 200 characters'],
      default: ''
    }
  },
  // Pricing Structure
  basePrice: {
    type: Number,
    min: [0, 'Base price cannot be negative'],
    default: 0
  },
  // Appointment Toggle
  appointmentEnabled: {
    type: Boolean,
    default: false
  },
  // Appointment Slots (when appointment is enabled)
  appointmentSlots: [appointmentSlotSchema],
  // Service Status
  isActive: {
    type: Boolean,
    default: true
  },
  // Statistics
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
    min: [0, 'Rating cannot be less than 0'],
    max: [5, 'Rating cannot be more than 5']
  },
  totalReviews: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
employeeServiceSchema.index({ employeeId: 1 });
employeeServiceSchema.index({ businessOwnerId: 1, isActive: 1 });
employeeServiceSchema.index({ categories: 1 });
employeeServiceSchema.index({ isActive: 1, rating: -1 });

// Conditional Pricing Validation (following Service model pattern)
employeeServiceSchema.pre('save', function(next) {
  if (this.appointmentEnabled) {
    // When appointment is enabled, require at least one slot
    if (!this.appointmentSlots || this.appointmentSlots.length === 0) {
      return next(new Error('At least one appointment slot is required when appointment is enabled'));
    }
    // Validate all durations are from the allowed set
    const validDurations = [15, 30, 45, 60];
    for (const slot of this.appointmentSlots) {
      if (!validDurations.includes(slot.duration)) {
        return next(new Error(`Invalid duration: ${slot.duration}. Must be 15, 30, 45, or 60 minutes`));
      }
    }
  } else {
    // When appointment is disabled, require base price
    if (!this.basePrice || this.basePrice <= 0) {
      return next(new Error('Base price is required when appointment is disabled'));
    }
  }
  next();
});

// Virtual to get employee details
employeeServiceSchema.virtual('employee', {
  ref: 'Employee',
  localField: 'employeeId',
  foreignField: '_id',
  justOne: true
});

// Virtual to get business owner details
employeeServiceSchema.virtual('businessOwner', {
  ref: 'BusinessOwner',
  localField: 'businessOwnerId',
  foreignField: '_id',
  justOne: true
});

// Ensure virtuals are included when converting to JSON
employeeServiceSchema.set('toJSON', { virtuals: true });
employeeServiceSchema.set('toObject', { virtuals: true });

// Method to increment views
employeeServiceSchema.methods.incrementViews = function() {
  this.views += 1;
  return this.save();
};

module.exports = mongoose.model('EmployeeService', employeeServiceSchema);
