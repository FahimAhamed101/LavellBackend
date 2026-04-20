const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  // Category name (e.g., "Home Services", "Plumbing", "Electrical")
  name: {
    type: String,
    required: [true, 'Category name is required'],
    trim: true,
    unique: true,
    maxlength: [100, 'Category name cannot exceed 100 characters']
  },
  // URL-friendly slug (auto-generated from name)
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true
  },
  // Description of the category
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  // Icon or image URL for the category
  icon: {
    type: String,
    trim: true
  },
  // Parent category for nested categories (optional)
  parentCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null
  },
  // Whether the category is active/visible to users
  isActive: {
    type: Boolean,
    default: true
  },
  // Display order for sorting
  displayOrder: {
    type: Number,
    default: 0
  },
  // Admin who created this category
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  }
}, {
  timestamps: true
});

// Index for faster queries
// Note: name and slug already have unique: true which creates indexes automatically
categorySchema.index({ isActive: 1 });
categorySchema.index({ parentCategory: 1 });

// Generate slug from name before saving
categorySchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  next();
});

// Virtual to get subcategories
categorySchema.virtual('subcategories', {
  ref: 'Category',
  localField: '_id',
  foreignField: 'parentCategory'
});

// Ensure virtuals are included when converting to JSON
categorySchema.set('toJSON', { virtuals: true });
categorySchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Category', categorySchema);
