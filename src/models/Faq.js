const mongoose = require('mongoose');

const faqSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true,
    trim: true,
    maxlength: [300, 'Question cannot exceed 300 characters']
  },
  answer: {
    type: String,
    required: true,
    trim: true,
    maxlength: [2000, 'Answer cannot exceed 2000 characters']
  },
  order: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

faqSchema.index({ isActive: 1, order: 1, createdAt: -1 });

module.exports = mongoose.model('Faq', faqSchema);
