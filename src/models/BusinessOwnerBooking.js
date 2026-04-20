const mongoose = require('mongoose');

/**
 * Business Owner Booking Model - For employee services (appointmentEnabled = false)
 */
const businessOwnerBookingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required']
  },
  employeeServiceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EmployeeService',
    required: [true, 'Employee service ID is required']
  },
  businessOwnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BusinessOwner',
    required: [true, 'Business owner ID is required']
  },
  bookingDate: {
    type: Date,
    required: [true, 'Booking date is required'],
    validate: {
      validator: function(v) {
        // Enforce only when creating or explicitly changing bookingDate.
        if (!this.isNew && !this.isModified('bookingDate')) {
          return true;
        }
        return v >= new Date();
      },
      message: 'Booking date must be in the future'
    }
  },
  serviceSnapshot: {
    serviceName: String,
    servicePhoto: String,
    basePrice: {
      type: Number,
      required: true
    },
    categories: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category'
    }]
  },
  downPayment: {
    type: Number,
    required: [true, 'Down payment is required'],
    min: [0, 'Down payment cannot be negative']
  },
  platformFee: {
    type: Number,
    default: 0,
    min: 0
  },
  businessOwnerPayoutFromDownPayment: {
    type: Number,
    default: 0,
    min: 0
  },
  dueAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  remainingAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'authorized', 'partial', 'due_requested', 'completed', 'offline_paid', 'refunded'],
    default: 'pending'
  },
  paymentIntentId: {
    type: String,
    default: null
  },
  paymentIntentStatus: {
    type: String,
    default: null
  },
  checkoutSessionId: {
    type: String,
    default: null
  },
  checkoutSessionUrl: {
    type: String,
    default: null
  },
  duePaymentIntentId: {
    type: String,
    default: null
  },
  duePaymentIntentStatus: {
    type: String,
    default: null
  },
  dueRequestedAt: {
    type: Date,
    default: null
  },
  duePaidAt: {
    type: Date,
    default: null
  },
  offlinePaidAt: {
    type: Date,
    default: null
  },
  paidVia: {
    type: String,
    enum: ['online', 'offline', null],
    default: null
  },
  bookingStatus: {
    type: String,
    enum: ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'rejected'],
    default: 'pending'
  },
  userNotes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  },
  providerNotes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  },
  cancellationReason: {
    type: String,
    trim: true
  },
  cancelledBy: {
    type: String,
    enum: ['user', 'business_owner', 'admin']
  },
  cancelledAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  rating: {
    type: Number,
    min: 0,
    max: 5
  },
  review: {
    type: String,
    trim: true,
    maxlength: [500, 'Review cannot exceed 500 characters']
  },
  reviewedAt: {
    type: Date
  },
  moderationStatus: {
    type: String,
    enum: ['active', 'hidden_by_admin'],
    default: 'active'
  },
  moderationReason: {
    type: String,
    trim: true,
    maxlength: [500, 'Moderation reason cannot exceed 500 characters'],
    default: null
  },
  moderatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  moderatedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

businessOwnerBookingSchema.index({ userId: 1, createdAt: -1 });
businessOwnerBookingSchema.index({ businessOwnerId: 1, createdAt: -1 });
businessOwnerBookingSchema.index({ employeeServiceId: 1 });
businessOwnerBookingSchema.index({ bookingStatus: 1 });
businessOwnerBookingSchema.index({ bookingDate: 1 });
businessOwnerBookingSchema.index({ moderationStatus: 1, reviewedAt: -1 });

businessOwnerBookingSchema.pre('validate', function(next) {
  // Skip this rule on unrelated updates (status/payment sync, etc.).
  if (!this.isNew && !this.isModified('downPayment') && !this.isModified('totalAmount')) {
    return next();
  }

  if (this.downPayment && this.totalAmount) {
    const minimumDownPayment = this.totalAmount * 0.3;
    if (this.downPayment < minimumDownPayment) {
      return next(new Error(`Down payment must be at least 30% of total amount (minimum: $${minimumDownPayment.toFixed(2)})`));
    }
  }
  next();
});

businessOwnerBookingSchema.pre('save', function(next) {
  if (this.totalAmount !== undefined && this.downPayment !== undefined) {
    const baseRemaining = Math.max(this.totalAmount - this.downPayment, 0);

    if (
      this.paymentStatus === 'completed' ||
      this.paymentStatus === 'offline_paid' ||
      this.paymentStatus === 'refunded'
    ) {
      this.remainingAmount = 0;
    } else if (this.paymentStatus === 'due_requested') {
      const dueRemaining = this.dueAmount !== undefined && this.dueAmount !== null
        ? Number(this.dueAmount)
        : baseRemaining;
      this.remainingAmount = Math.max(dueRemaining, 0);
    } else {
      this.remainingAmount = baseRemaining;
    }

    if (this.remainingAmount <= 0 && this.paymentStatus !== 'due_requested') {
      this.paymentStatus = 'completed';
    } else if (!this.paymentStatus) {
      this.paymentStatus = 'pending';
    }
  }
  next();
});

businessOwnerBookingSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

businessOwnerBookingSchema.virtual('service', {
  ref: 'EmployeeService',
  localField: 'employeeServiceId',
  foreignField: '_id',
  justOne: true
});

businessOwnerBookingSchema.virtual('businessOwner', {
  ref: 'BusinessOwner',
  localField: 'businessOwnerId',
  foreignField: '_id',
  justOne: true
});

businessOwnerBookingSchema.set('toJSON', { virtuals: true });
businessOwnerBookingSchema.set('toObject', { virtuals: true });

businessOwnerBookingSchema.methods.cancel = function(reason, cancelledBy) {
  this.bookingStatus = 'cancelled';
  this.cancellationReason = reason;
  this.cancelledBy = cancelledBy;
  this.cancelledAt = new Date();
  return this.save();
};

businessOwnerBookingSchema.methods.confirm = function() {
  this.bookingStatus = 'confirmed';
  return this.save();
};

businessOwnerBookingSchema.methods.complete = function() {
  this.bookingStatus = 'completed';
  this.completedAt = new Date();
  return this.save();
};

module.exports = mongoose.model('BusinessOwnerBooking', businessOwnerBookingSchema);
