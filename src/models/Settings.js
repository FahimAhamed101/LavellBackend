const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  // Unique key to identify the setting
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    enum: ['terms_and_conditions', 'privacy_policy', 'about_us', 'faq']
  },
  // Title of the content
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  // HTML content from rich text editor
  // Frontend sends HTML, we sanitize and store it
  content: {
    type: String,
    required: true
  },
  // Track who last updated
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // Is this content active/published?
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index for faster lookups
// Note: key already has unique: true which creates an index automatically

module.exports = mongoose.model('Settings', settingsSchema);
