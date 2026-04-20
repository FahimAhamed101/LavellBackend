const mongoose = require('mongoose');

const portfolioSchema = new mongoose.Schema({
  // Reference to Provider
  providerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Provider',
    required: true
  },
  // Portfolio item title
  title: {
    type: String,
    required: [true, 'Portfolio title is required'],
    trim: true,
    maxlength: [150, 'Title cannot exceed 150 characters']
  },
  // Before image URL
  beforeImage: {
    type: String,
    required: [true, 'Before image is required']
  },
  // After image URL
  afterImage: {
    type: String,
    required: [true, 'After image is required']
  },
  // About/description field - supports Markdown for rich text
  // Frontend should render this using a Markdown renderer
  // Supports: **bold**, *italic*, - bullet points, 1. numbered lists
  about: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  // Optional category/service type for this portfolio item
  serviceType: {
    type: String,
    trim: true,
    maxlength: [100, 'Service type cannot exceed 100 characters']
  },
  // Display order for sorting
  displayOrder: {
    type: Number,
    default: 0
  },
  // Visibility
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for faster queries
portfolioSchema.index({ providerId: 1 });
portfolioSchema.index({ providerId: 1, isActive: 1 });
portfolioSchema.index({ providerId: 1, displayOrder: 1 });

// Virtual populate to get provider details
portfolioSchema.virtual('provider', {
  ref: 'Provider',
  localField: 'providerId',
  foreignField: '_id',
  justOne: true
});

// Ensure virtuals are included when converting to JSON
portfolioSchema.set('toJSON', { virtuals: true });
portfolioSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Portfolio', portfolioSchema);
