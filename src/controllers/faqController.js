const Faq = require('../models/Faq');

const parseBoolean = (value) => {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
};

/**
 * Create FAQ (Admin)
 * POST /api/admin/faqs
 */
exports.createFaq = async (req, res) => {
  try {
    const { question, answer, order, isActive } = req.body;

    if (!question || !answer) {
      return res.status(400).json({
        success: false,
        message: 'Question and answer are required'
      });
    }

    let parsedOrder = 0;
    if (order !== undefined) {
      parsedOrder = Number(order);
      if (Number.isNaN(parsedOrder)) {
        return res.status(400).json({
          success: false,
          message: 'Order must be a number'
        });
      }
    }

    const parsedIsActive = isActive !== undefined ? parseBoolean(isActive) : true;
    if (isActive !== undefined && parsedIsActive === undefined) {
      return res.status(400).json({
        success: false,
        message: 'isActive must be a boolean'
      });
    }

    const faq = new Faq({
      question,
      answer,
      order: parsedOrder,
      isActive: parsedIsActive,
      createdBy: req.admin?._id,
      updatedBy: req.admin?._id
    });

    await faq.save();

    res.status(201).json({
      success: true,
      message: 'FAQ created successfully',
      data: {
        faq
      }
    });
  } catch (error) {
    console.error('Create FAQ error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while creating FAQ',
      error: error.message
    });
  }
};

/**
 * Get all FAQs (Admin)
 * GET /api/admin/faqs
 */
exports.getAllFaqs = async (req, res) => {
  try {
    const faqs = await Faq.find()
      .sort({ order: 1, createdAt: -1 });

    res.status(200).json({
      success: true,
      data: {
        faqs
      }
    });
  } catch (error) {
    console.error('Get FAQs error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching FAQs',
      error: error.message
    });
  }
};

/**
 * Update FAQ (Admin)
 * PUT /api/admin/faqs/:id
 */
exports.updateFaq = async (req, res) => {
  try {
    const { id } = req.params;
    const { question, answer, order, isActive } = req.body;

    const faq = await Faq.findById(id);
    if (!faq) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found'
      });
    }

    let hasUpdates = false;

    if (question !== undefined) {
      faq.question = question;
      hasUpdates = true;
    }
    if (answer !== undefined) {
      faq.answer = answer;
      hasUpdates = true;
    }
    if (order !== undefined) {
      const parsedOrder = Number(order);
      if (Number.isNaN(parsedOrder)) {
        return res.status(400).json({
          success: false,
          message: 'Order must be a number'
        });
      }
      faq.order = parsedOrder;
      hasUpdates = true;
    }
    if (isActive !== undefined) {
      const parsedIsActive = parseBoolean(isActive);
      if (parsedIsActive === undefined) {
        return res.status(400).json({
          success: false,
          message: 'isActive must be a boolean'
        });
      }
      faq.isActive = parsedIsActive;
      hasUpdates = true;
    }

    if (!hasUpdates) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields provided for update'
      });
    }

    faq.updatedBy = req.admin?._id;

    await faq.save();

    res.status(200).json({
      success: true,
      message: 'FAQ updated successfully',
      data: {
        faq
      }
    });
  } catch (error) {
    console.error('Update FAQ error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while updating FAQ',
      error: error.message
    });
  }
};

/**
 * Delete FAQ (Admin)
 * DELETE /api/admin/faqs/:id
 */
exports.deleteFaq = async (req, res) => {
  try {
    const { id } = req.params;

    const faq = await Faq.findByIdAndDelete(id);
    if (!faq) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'FAQ deleted successfully'
    });
  } catch (error) {
    console.error('Delete FAQ error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting FAQ',
      error: error.message
    });
  }
};

/**
 * Get active FAQs (Business Owner)
 * GET /api/business-owners/faqs
 */
exports.getActiveFaqs = async (req, res) => {
  try {
    const faqs = await Faq.find({ isActive: true })
      .sort({ order: 1, createdAt: -1 })
      .select('question answer order');

    res.status(200).json({
      success: true,
      data: {
        faqs
      }
    });
  } catch (error) {
    console.error('Get active FAQs error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching FAQs',
      error: error.message
    });
  }
};
