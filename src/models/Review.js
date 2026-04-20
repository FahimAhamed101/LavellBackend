const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  // Reference to the provider being reviewed
  providerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Provider',
    required: true
  },
  // Reference to the user who wrote the review
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Reference to the service (optional - can be general provider review)
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    default: null
  },
  // Reference to the booking (optional)
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    default: undefined
  },
  // Reference to the appointment (optional)
  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment',
    default: undefined
  },
  // Rating (1-5 stars)
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  // Review text
  comment: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  moderationStatus: {
    type: String,
    enum: ['active', 'hidden_by_admin'],
    default: 'active',
    index: true
  },
  moderationReason: {
    type: String,
    trim: true,
    maxlength: 500,
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

// Indexes for faster queries
reviewSchema.index({ providerId: 1, createdAt: -1 });
reviewSchema.index({ userId: 1 });
reviewSchema.index({ serviceId: 1 });
reviewSchema.index({ rating: 1 });
reviewSchema.index({ moderationStatus: 1, createdAt: -1 });

// Prevent duplicate reviews from same user for same booking
reviewSchema.index({ userId: 1, bookingId: 1 }, {
  unique: true,
  sparse: true // Allow multiple null bookingIds
});
reviewSchema.index({ userId: 1, appointmentId: 1 }, {
  unique: true,
  sparse: true // Allow multiple null appointmentIds
});

// Virtual to get user details
reviewSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Virtual to get provider details
reviewSchema.virtual('provider', {
  ref: 'Provider',
  localField: 'providerId',
  foreignField: '_id',
  justOne: true
});

// Virtual to get service details
reviewSchema.virtual('service', {
  ref: 'Service',
  localField: 'serviceId',
  foreignField: '_id',
  justOne: true
});

// Ensure virtuals are included when converting to JSON
reviewSchema.set('toJSON', { virtuals: true });
reviewSchema.set('toObject', { virtuals: true });

// Update provider rating after review is saved
reviewSchema.post('save', async function() {
  try {
    const Review = this.constructor;
    const Provider = mongoose.model('Provider');

    // Calculate average rating for this provider
    const stats = await Review.aggregate([
      {
        $match: {
          providerId: this.providerId,
          isActive: true,
          moderationStatus: 'active'
        }
      },
      {
        $group: {
          _id: '$providerId',
          avgRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 }
        }
      }
    ]);

    if (stats.length > 0) {
      await Provider.findByIdAndUpdate(this.providerId, {
        rating: Math.round(stats[0].avgRating * 10) / 10, // Round to 1 decimal
        totalReviews: stats[0].totalReviews
      });
    }
  } catch (error) {
    console.error('Error updating provider rating:', error);
  }
});

// Update provider rating after review is deleted
reviewSchema.post('findOneAndDelete', async function(doc) {
  if (doc) {
    try {
      const Review = mongoose.model('Review');
      const Provider = mongoose.model('Provider');

      // Recalculate average rating
      const stats = await Review.aggregate([
        {
          $match: {
            providerId: doc.providerId,
            isActive: true,
            moderationStatus: 'active'
          }
        },
        {
          $group: {
            _id: '$providerId',
            avgRating: { $avg: '$rating' },
            totalReviews: { $sum: 1 }
          }
        }
      ]);

      if (stats.length > 0) {
        await Provider.findByIdAndUpdate(doc.providerId, {
          rating: Math.round(stats[0].avgRating * 10) / 10,
          totalReviews: stats[0].totalReviews
        });
      } else {
        // No reviews left
        await Provider.findByIdAndUpdate(doc.providerId, {
          rating: 0,
          totalReviews: 0
        });
      }
    } catch (error) {
      console.error('Error updating provider rating after delete:', error);
    }
  }
});

module.exports = mongoose.model('Review', reviewSchema);
